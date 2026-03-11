/**
 * Text chunking service for RAG.
 * Implements "imagery atomization" - splitting text into meaningful chunks
 * with overlap for context preservation.
 */

import { createLogger } from '@/lib/logger'

const logger = createLogger('chunking')

export interface ChunkOptions {
  maxChunkSize?: number // max chars per chunk
  minChunkSize?: number // min chars to be a valid chunk
  overlap?: number // overlap between chunks
  splitOn?: RegExp // where to split
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 280,  // ~300 chars for more complete semantic units (was 200)
  minChunkSize: 30,   // Keep short meaningful phrases
  overlap: 100,       // 50% overlap for better context preservation (was 30)
  splitOn: /[。！？.!?\n]/, // sentence or line boundaries
}

/**
 * Split text into sentence-level chunks
 */
function splitIntoSentences(text: string, splitOn: RegExp): string[] {
  const parts = text.split(splitOn)
  const sentences: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    // Add back the delimiter if it was captured
    const delimiter = text.match(splitOn)?.[0] || ''
    const sentence = part + (i < parts.length - 1 ? delimiter : '')

    if (sentence.length > 0) {
      sentences.push(sentence)
    }
  }

  return sentences
}

/**
 * Merge sentences into chunks respecting size limits
 */
function mergeSentencesIntoChunks(
  sentences: string[],
  maxSize: number,
  minSize: number,
  overlap: number,
): string[] {
  const chunks: string[] = []
  let currentChunk = ''

  for (const sentence of sentences) {
    // If single sentence exceeds max size, split it by punctuation
    if (sentence.length > maxSize) {
      if (currentChunk.length >= minSize) {
        chunks.push(currentChunk.trim())
        currentChunk = currentChunk.slice(-overlap)
      }

      // Split long sentence by commas and semicolons
      const parts = sentence.split(/([，；,;])/)
      for (const part of parts) {
        if (currentChunk.length + part.length > maxSize) {
          if (currentChunk.length >= minSize) {
            chunks.push(currentChunk.trim())
          }
          currentChunk = currentChunk.slice(-overlap) + part
        } else {
          currentChunk += part
        }
      }
      continue
    }

    // Try to add to current chunk
    if (currentChunk.length + sentence.length > maxSize) {
      // Current chunk is full
      if (currentChunk.length >= minSize) {
        chunks.push(currentChunk.trim())
      }
      // Start new chunk with overlap
      currentChunk = currentChunk.slice(-overlap) + sentence
    } else {
      currentChunk += sentence
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length >= minSize) {
    chunks.push(currentChunk.trim())
  }

  return chunks.filter((c) => c.length > 0)
}

/**
 * Chunk text into "imagery atoms"
 * - Respects sentence boundaries
 * - Maintains context overlap
 * - Filters out too-short chunks
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  logger.debug('Chunking text', {
    inputLength: text.length,
    maxChunkSize: opts.maxChunkSize,
  })

  // Clean up text
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()

  if (cleaned.length < opts.minChunkSize!) {
    return cleaned.length > 0 ? [cleaned] : []
  }

  const sentences = splitIntoSentences(cleaned, opts.splitOn!)
  const chunks = mergeSentencesIntoChunks(
    sentences,
    opts.maxChunkSize!,
    opts.minChunkSize!,
    opts.overlap!,
  )

  logger.debug('Chunking complete', {
    inputLength: text.length,
    chunks: chunks.length,
    avgChunkSize: Math.round(
      chunks.reduce((a, b) => a + b.length, 0) / chunks.length || 0,
    ),
  })

  return chunks
}

/**
 * Process parsed file content into chunks suitable for embedding
 */
export interface ImageryAtom {
  id: string
  content: string
  sourceFile: string
  pageNumber?: number
  chunkIndex: number
  totalChunks: number
  charStart: number
  charEnd: number
}

/** Normalize for deduplication: trim, collapse spaces. Exported for cross-page dedup in import. */
export function normalizeChunkContentForDedup(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Detect low-value text units (headers, footers, watermarks, metadata) to filter from RAG.
 * Returns true if the content should be excluded from the ribbon.
 */
export function isLowValueChunkContent(content: string): boolean {
  const t = content.trim()
  if (t.length < 2) return true

  // URL or domain
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t) || /\.(com|cn|net|org)\s*$/i.test(t)) {
    return true
  }
  if (/\bwww\.[^\s]{2,}\.(\w{2,})\b/.test(t)) return true

  // Common PDF metadata / source labels (Chinese and English)
  if (/^来自\s*[^\s]{0,80}(\.pdf|\.PDF)?\s*$/.test(t)) return true
  if (/^汇总\s*[:：]/.test(t) || /^下载汇总\s*[:：]?/.test(t)) return true
  if (/^来自\s*设计模式/.test(t) || /^来自\s*[\w\s]+\.pdf\s*$/i.test(t)) return true
  if (/^第\s*\d+\s*页\s*$/i.test(t) || /^page\s*\d+\s*$/i.test(t)) return true

  // Ends with file-like suffix and very short
  if (t.length <= 50 && /\.(pdf|PDF|doc|DOC)\s*$/.test(t)) return true

  // Very short and mostly non-content (numbers, punctuation, single repeated char)
  if (t.length <= 20) {
    const meaningful = t.replace(/[\s\d\p{P}]/gu, '')
    if (meaningful.length <= 2) return true
  }

  // High ratio of punctuation/symbols
  const symbolOrDigit = (t.match(/[\d\s\p{P}\p{S}]/gu) || []).length
  if (t.length >= 10 && symbolOrDigit / t.length > 0.6) return true

  return false
}

/**
 * Filter atoms to remove low-value and duplicate content (e.g. repeated headers/footers).
 */
export function filterLowValueAtoms(atoms: ImageryAtom[]): ImageryAtom[] {
  const seen = new Set<string>()
  const out: ImageryAtom[] = []
  let index = 0
  for (const atom of atoms) {
    if (isLowValueChunkContent(atom.content)) continue
    const key = normalizeChunkContentForDedup(atom.content)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      ...atom,
      chunkIndex: index,
      totalChunks: 0, // will be set after
    })
    index++
  }
  out.forEach((a, i) => {
    a.totalChunks = out.length
  })
  return out
}

export function createImageryAtoms(
  fileName: string,
  content: string,
  pageNumber?: number,
): ImageryAtom[] {
  const chunks = chunkText(content)
  let charPos = 0

  const atoms = chunks.map((chunk, index) => {
    const atom: ImageryAtom = {
      id: `${fileName}#${pageNumber || 1}-${index}`,
      content: chunk,
      sourceFile: fileName,
      pageNumber,
      chunkIndex: index,
      totalChunks: chunks.length,
      charStart: charPos,
      charEnd: charPos + chunk.length,
    }
    charPos += chunk.length
    return atom
  })

  return filterLowValueAtoms(atoms)
}
