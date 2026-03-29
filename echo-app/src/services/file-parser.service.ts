/**
 * File parser service for local RAG.
 * Supports PDF, Markdown, and TXT files.
 */

import type { PDFPageProxy } from 'pdfjs-dist'

import { createLogger } from '@/lib/logger'
import { isOcrConfigured } from '@/lib/ocr-config'
import { extractTextFromImage, OcrError, type OcrErrorCode } from '@/services/ocr.service'

const logger = createLogger('file-parser')

// Polyfill Buffer for browser environment
import { Buffer as BufferPolyfill } from 'buffer'
if (typeof window !== 'undefined' && !globalThis.Buffer) {
  globalThis.Buffer = BufferPolyfill as typeof Buffer
}

// Dynamic import iconv-lite to avoid SSR issues
async function getIconv() {
  const iconv = await import('iconv-lite')
  return iconv.default
}

const UTF8_REPLACEMENT = '\uFFFD'

/**
 * Check if text looks like valid readable content (not gibberish from wrong encoding).
 */
function isValidText(text: string): boolean {
  // Contains replacement characters = definitely wrong
  if (text.includes(UTF8_REPLACEMENT)) return false

  // Check first 300 chars
  const sample = text.slice(0, 300)

  let privateUse = 0 // Private Use Area - strong indicator of wrong encoding
  let cjkIdeographs = 0
  let basicLatin = 0
  let controlChars = 0

  for (const char of sample) {
    const code = char.charCodeAt(0)

    // Control characters (except common whitespace)
    if (code < 32 && ![9, 10, 13].includes(code)) controlChars++

    // CJK Unified Ideographs (Chinese)
    if (code >= 0x4e00 && code <= 0x9fff) cjkIdeographs++

    // Basic Latin
    if (code >= 32 && code <= 126) basicLatin++

    // Private Use Area - happens when GBK decoded as UTF-8
    if ((code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) privateUse++
  }

  const total = sample.length
  if (total === 0) return true

  // If many private use chars or control chars, encoding is wrong
  if (privateUse > 2 || controlChars > 3) return false

  // Valid if has reasonable amount of readable chars
  return (cjkIdeographs + basicLatin) / total > 0.5
}

/**
 * Decode bytes to string. Tries UTF-8 first; if result looks like gibberish,
 * tries common Chinese encodings (GB18030, GBK, Big5).
 */
async function decodeText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const uint8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes

  // Try UTF-8 first
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(uint8)
  if (isValidText(utf8)) {
    logger.debug('Decoded as UTF-8', { length: utf8.length, preview: utf8.slice(0, 50) })
    return utf8
  }

  logger.debug('UTF-8 looks invalid, trying Chinese encodings...')

  // Try other encodings with iconv-lite
  const iconv = await getIconv()

  // Try GB18030 first (superset of GBK, handles more edge cases)
  try {
    const decoded = iconv.decode(Buffer.from(uint8), 'gb18030')
    if (isValidText(decoded)) {
      logger.info('Decoded as GB18030', { length: decoded.length, preview: decoded.slice(0, 50) })
      return decoded
    }
  } catch {
    // Continue
  }

  // Try GBK
  try {
    const decoded = iconv.decode(Buffer.from(uint8), 'gbk')
    if (isValidText(decoded)) {
      logger.info('Decoded as GBK', { length: decoded.length, preview: decoded.slice(0, 50) })
      return decoded
    }
  } catch {
    // Continue
  }

  // Try Big5 (Traditional Chinese)
  try {
    const decoded = iconv.decode(Buffer.from(uint8), 'big5')
    if (isValidText(decoded)) {
      logger.info('Decoded as Big5', { length: decoded.length, preview: decoded.slice(0, 50) })
      return decoded
    }
  } catch {
    // Fall back
  }

  logger.warn('All encodings failed, returning UTF-8 (may have issues)', {
    preview: utf8.slice(0, 100),
  })
  return utf8
}

// Dynamic import for pdf.js to avoid SSR issues
async function getPDFJS() {
  const pdfjs = await import('pdfjs-dist')
  // Use the worker from node_modules
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  return pdfjs
}

export interface ParsedChunk {
  content: string
  pageNumber?: number
  sourceFile: string
  chunkType: 'lit' | 'fact'
}

export interface ParseResult {
  fileName: string
  chunks: ParsedChunk[]
  totalPages?: number
  totalChars: number
  ocrUsed?: boolean
  ocrAttempted?: boolean
}

export interface PdfOcrStartedDetail {
  filePath: string
  fileName: string
  totalPages: number
}

export interface PdfOcrProgressDetail extends PdfOcrStartedDetail {
  currentPage: number
}

export interface PdfOcrFailedDetail extends PdfOcrStartedDetail {
  reason: OcrErrorCode
  message: string
}

export interface PdfOcrFinishedDetail extends PdfOcrStartedDetail {
  extractedPages: number
}

export interface ParseOptions {
  onPdfOcrStarted?: (detail: PdfOcrStartedDetail) => void
  onPdfOcrProgress?: (detail: PdfOcrProgressDetail) => void
  onPdfOcrFailed?: (detail: PdfOcrFailedDetail) => void
  onPdfOcrFinished?: (detail: PdfOcrFinishedDetail) => void
}

/**
 * Ensure we have a contiguous ArrayBuffer for pdf.js (avoids view/detached buffer issues).
 */
function toArrayBufferForPDF(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input.byteLength ? input.slice(0) : input
  }
  const u8 = input as Uint8Array
  if (u8.byteLength === 0) return u8.buffer as ArrayBuffer
  if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer.slice(0) as ArrayBuffer
  }
  return u8.slice(0).buffer as ArrayBuffer
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function createRenderCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('OCR rendering requires a browser environment')
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

async function renderPdfPageToImageDataUrl(page: PDFPageProxy): Promise<string> {
  const baseViewport = page.getViewport({ scale: 1 })
  const longestEdge = Math.max(baseViewport.width, baseViewport.height)
  const scale = Math.min(2, Math.max(1.25, 1600 / Math.max(longestEdge, 1)))
  const viewport = page.getViewport({ scale })
  const canvas = createRenderCanvas(viewport.width, viewport.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create canvas context for OCR rendering')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({
    canvasContext: context,
    canvas,
    viewport,
  }).promise

  const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  canvas.width = 0
  canvas.height = 0
  return dataUrl
}

function normalizeOcrPageText(text: string): string {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .trim()

  if (!normalized) return ''

  const rawLines = normalized.split('\n').map((line) => line.replace(/\s+/g, ' ').trim())

  const paragraphs: string[] = []
  let buffer = ''

  const flush = () => {
    if (!buffer) return
    paragraphs.push(buffer.trim())
    buffer = ''
  }

  for (const line of rawLines) {
    if (!line) {
      flush()
      continue
    }

    if (!buffer) {
      buffer = line
      continue
    }

    const prevEndsSentence = /[\u3002\uff01\uff1f.!?:;\uff1a\uff1b\uff09)\]】」』]$/.test(buffer)
    const nextStartsList = /^[-*•\d]+[.)\u3001\s]/.test(line)
    const needsSpace = /[A-Za-z0-9]$/.test(buffer) && /^[A-Za-z0-9]/.test(line)

    if (!prevEndsSentence && !nextStartsList) {
      buffer = `${buffer}${needsSpace ? ' ' : ''}${line}`
    } else {
      flush()
      buffer = line
    }
  }

  flush()

  return paragraphs.join('\n\n').trim()
}

function isMeaningfulOcrText(text: string): boolean {
  const readableChars = (text.match(/[A-Za-z0-9\u4e00-\u9fff]/g) ?? []).length
  return readableChars >= 6
}

/**
 * Parse PDF file using pdf.js
 */
export async function parsePDF(
  filePath: string,
  fileContent: ArrayBuffer | Uint8Array,
  options?: ParseOptions,
): Promise<ParseResult> {
  logger.info('Parsing PDF', { filePath })

  try {
    const pdfjs = await getPDFJS()
    const data = toArrayBufferForPDF(fileContent)
    const pdf = await pdfjs.getDocument({ data }).promise

    const chunks: ParsedChunk[] = []
    let totalChars = 0
    const fileName = getFileName(filePath)

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item: unknown) => {
          if (typeof item === 'object' && item && 'str' in item) {
            return (item as { str: string }).str
          }
          return ''
        })
        .join(' ')

      if (pageText.trim()) {
        chunks.push({
          content: pageText.trim(),
          pageNumber: i,
          sourceFile: filePath,
          chunkType: 'lit',
        })
        totalChars += pageText.length
      }

      page.cleanup()
    }

    if (pdf.numPages > 0 && totalChars === 0) {
      logger.warn('PDF has pages but no text extracted (likely scanned/image-only)', {
        filePath,
        pages: pdf.numPages,
      })

      if (!isOcrConfigured()) {
        const error = new OcrError(
          'OCR_NOT_CONFIGURED',
          '当前 PDF 没有文字层，且尚未配置 OCR 模型，无法识别扫描件。',
        )
        options?.onPdfOcrFailed?.({
          filePath,
          fileName,
          totalPages: pdf.numPages,
          reason: error.code,
          message: error.message,
        })
        throw error
      }

      options?.onPdfOcrStarted?.({
        filePath,
        fileName,
        totalPages: pdf.numPages,
      })

      const ocrChunks: ParsedChunk[] = []
      let ocrChars = 0
      let extractedPages = 0

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        try {
          const imageDataUrl = await renderPdfPageToImageDataUrl(page)
          const ocrText = normalizeOcrPageText(await extractTextFromImage(imageDataUrl))
          if (isMeaningfulOcrText(ocrText)) {
            ocrChunks.push({
              content: ocrText,
              pageNumber: i,
              sourceFile: filePath,
              chunkType: 'lit',
            })
            ocrChars += ocrText.length
            extractedPages += 1
          }

          options?.onPdfOcrProgress?.({
            filePath,
            fileName,
            totalPages: pdf.numPages,
            currentPage: i,
          })
        } catch (error) {
          const ocrError =
            error instanceof OcrError
              ? error
              : new OcrError('OCR_API_ERROR', error instanceof Error ? error.message : 'OCR 失败')

          options?.onPdfOcrFailed?.({
            filePath,
            fileName,
            totalPages: pdf.numPages,
            reason: ocrError.code,
            message: ocrError.message,
          })
          throw ocrError
        } finally {
          page.cleanup()
        }
      }

      if (ocrChars === 0 || ocrChunks.length === 0) {
        const error = new OcrError(
          'OCR_EMPTY_RESULT',
          'OCR 未识别到可用文字，请确认 PDF 是否清晰可读。',
        )
        options?.onPdfOcrFailed?.({
          filePath,
          fileName,
          totalPages: pdf.numPages,
          reason: error.code,
          message: error.message,
        })
        throw error
      }

      options?.onPdfOcrFinished?.({
        filePath,
        fileName,
        totalPages: pdf.numPages,
        extractedPages,
      })

      logger.info('PDF OCR fallback parsed', {
        filePath,
        pages: pdf.numPages,
        extractedPages,
        chunks: ocrChunks.length,
        chars: ocrChars,
      })

      return {
        fileName,
        chunks: ocrChunks,
        totalPages: pdf.numPages,
        totalChars: ocrChars,
        ocrUsed: true,
        ocrAttempted: true,
      }
    }

    logger.info('PDF parsed', {
      filePath,
      pages: pdf.numPages,
      chunks: chunks.length,
      chars: totalChars,
    })

    return {
      fileName,
      chunks,
      totalPages: pdf.numPages,
      totalChars,
      ocrUsed: false,
      ocrAttempted: false,
    }
  } catch (error) {
    if (error instanceof OcrError) {
      throw error
    }
    logger.error('Failed to parse PDF', { filePath, error })
    throw new Error(`PDF parsing failed: ${filePath}`)
  }
}

/**
 * Parse Markdown or TXT file
 */
export function parseTextFile(filePath: string, content: string): ParseResult {
  logger.info('Parsing text file', { filePath })

  const chunks: ParsedChunk[] = []
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  for (const para of paragraphs) {
    chunks.push({
      content: para,
      sourceFile: filePath,
      chunkType: 'lit',
    })
  }

  logger.info('Text file parsed', {
    filePath,
    chunks: chunks.length,
    chars: content.length,
  })

  return {
    fileName: filePath.split(/[\\/]/).pop() || filePath,
    chunks,
    totalChars: content.length,
  }
}

/**
 * Auto-detect file type and parse
 */
export async function parseFile(
  filePath: string,
  content: ArrayBuffer | Uint8Array | string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const ext = filePath.split('.').pop()?.toLowerCase()

  if (ext === 'pdf') {
    return parsePDF(
      filePath,
      content instanceof ArrayBuffer
        ? content
        : content instanceof Uint8Array
          ? content
          : new TextEncoder().encode(content as string),
      options,
    )
  }

  if (ext === 'md' || ext === 'txt') {
    let text: string
    if (typeof content === 'string') {
      text = content
    } else {
      // Ensure we have a Uint8Array for decoding
      const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
      text = await decodeText(bytes)
    }
    return parseTextFile(filePath, text)
  }

  throw new Error(`Unsupported file type: ${ext}`)
}
