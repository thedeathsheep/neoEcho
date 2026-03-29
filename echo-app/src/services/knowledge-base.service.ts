/**
 * Knowledge base service for local RAG.
 * Manages file ingestion, text chunking, and persistence.
 * Chunk data (including embeddings) is stored in IndexedDB via chunk-storage; bases metadata in localStorage.
 * Supports multiple knowledge bases with mandatory book search.
 */

import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'

import {
  clearChunks as clearChunksInIdb,
  loadAllChunks as loadAllChunksFromIdb,
  loadChunksForBase as loadChunksForBaseFromIdb,
  saveAllChunks as saveAllChunksToIdb,
} from '@/lib/chunk-storage'
import { createLogger } from '@/lib/logger'
import { generateId } from '@/lib/utils/crypto'

import {
  createImageryAtoms,
  type ImageryAtom,
  normalizeChunkContentForDedup,
} from './chunking.service'
import { embedBatch } from './embedding.service'
import {
  parseFile,
  type ParseResult,
  type PdfOcrFailedDetail,
  type PdfOcrFinishedDetail,
  type PdfOcrProgressDetail,
  type PdfOcrStartedDetail,
} from './file-parser.service'
import { OcrError } from './ocr.service'

const logger = createLogger('knowledge-base')

// Legacy storage keys (for migration; chunk data now in IndexedDB via chunk-storage)
const LEGACY_STORAGE_KEY = 'echo-knowledge-base'
const LEGACY_CHUNKS_KEY = 'echo-knowledge-chunks'

// Multi-base storage keys (bases and active id only; chunks in IndexedDB)
const BASES_KEY = 'echo-knowledge-bases'
const CHUNKS_KEY = 'echo-knowledge-chunks-v2'
const ACTIVE_BASE_ID_KEY = 'echo-active-knowledge-base-id'

function dispatchKnowledgeImportEvent<T>(eventName: string, detail: T): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

function getOcrUserMessage(error: OcrError): string {
  switch (error.code) {
    case 'OCR_NOT_CONFIGURED':
      return '这份 PDF 看起来是扫描件，当前还没配置 OCR 模型。请先在设置里填写支持图片识别的 OCR 模型名。'
    case 'OCR_TIMEOUT':
      return '扫描件 OCR 超时了，请稍后重试，或换一个响应更快的视觉/OCR 模型。'
    case 'OCR_UNAUTHORIZED':
      return 'OCR 配置无效，请检查主模型的 API Key、服务地址，或确认该 OCR 模型可用。'
    case 'OCR_RATE_LIMITED':
      return 'OCR 请求过于频繁或额度不足，请稍后再试。'
    case 'OCR_MODEL_UNSUPPORTED':
      return '当前 OCR 模型不支持图片识别，请换成支持视觉输入的模型。'
    case 'OCR_API_ERROR':
      return `OCR 失败：${error.message || '服务暂时不可用'}`
    case 'OCR_EMPTY_RESULT':
      return 'OCR 没有识别到可用文字，请确认这份扫描件是否清晰可读。'
    default:
      return '扫描件 OCR 失败，请稍后重试。'
  }
}

export interface KnowledgeFile {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  importedAt: string
  totalChunks: number
  totalChars: number
  parseResult?: ParseResult
  baseId: string // Added: which knowledge base this file belongs to
}

export interface KnowledgeChunk extends ImageryAtom {
  fileId: string
  baseId: string // Added: which knowledge base this chunk belongs to
  importedAt: string
  /** Local embedding vector (from transformers.js) for semantic search */
  embedding?: number[]
}

/** Max number of ribbon slots (out of 5) that can be filled by mandatory books. 1 = at most 1, 3 = at most 3. */
export type MandatoryMaxSlots = 1 | 2 | 3

export interface KnowledgeBase {
  id: string // Unique ID for this knowledge base
  name: string // Display name
  files: KnowledgeFile[]
  mandatoryBooks: string[] // File IDs (KnowledgeFile.id) that must be included in search (1-3 books)
  mandatoryMaxSlots?: MandatoryMaxSlots // Max slots from mandatory books (default 1)
  lastUpdated: string
}

// Migration flag
let migrationChecked = false

/**
 * Check and migrate from legacy single-base to multi-base structure
 */
function checkAndMigrate(): void {
  if (typeof window === 'undefined') return
  if (migrationChecked) return
  migrationChecked = true

  try {
    // Check if already migrated
    const existingBases = localStorage.getItem(BASES_KEY)
    if (existingBases) return

    // Check for legacy data
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    const legacyChunksRaw = localStorage.getItem(LEGACY_CHUNKS_KEY)

    if (!legacyRaw) return

    const legacy = JSON.parse(legacyRaw)
    const newBaseId = generateId()

    // Create new knowledge base from legacy data
    const newBase: KnowledgeBase = {
      id: newBaseId,
      name: '默认共鸣库',
      files: (legacy.files || []).map((f: Omit<KnowledgeFile, 'baseId'>) => ({
        ...f,
        baseId: newBaseId,
      })),
      mandatoryBooks: [],
      mandatoryMaxSlots: 1,
      lastUpdated: legacy.lastUpdated || new Date().toISOString(),
    }

    // Migrate chunks if they exist
    if (legacyChunksRaw) {
      const legacyChunks = JSON.parse(legacyChunksRaw)
      const migratedChunks = legacyChunks.map((c: Omit<KnowledgeChunk, 'baseId'>) => ({
        ...c,
        baseId: newBaseId,
      }))
      localStorage.setItem(CHUNKS_KEY, JSON.stringify(migratedChunks))
    }

    // Save new structure
    localStorage.setItem(BASES_KEY, JSON.stringify([newBase]))
    localStorage.setItem(ACTIVE_BASE_ID_KEY, newBaseId)

    logger.info('Migrated legacy knowledge base to multi-base structure', {
      baseId: newBaseId,
      files: newBase.files.length,
    })

    // Optionally clean up legacy data (commented out for safety)
    // localStorage.removeItem(LEGACY_STORAGE_KEY)
    // localStorage.removeItem(LEGACY_CHUNKS_KEY)
  } catch (e) {
    logger.error('Failed to migrate knowledge base', { error: e })
  }
}

/**
 * Load all knowledge bases from localStorage
 */
function loadAllBases(): KnowledgeBase[] {
  checkAndMigrate()

  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(BASES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as KnowledgeBase[]
  } catch {
    return []
  }
}

/**
 * Save all knowledge bases to localStorage
 */
function saveAllBases(bases: KnowledgeBase[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(BASES_KEY, JSON.stringify(bases))
    window.dispatchEvent(new CustomEvent('knowledge-base-updated'))
  } catch {
    logger.error('Failed to save knowledge bases')
  }
}

/**
 * Get active knowledge base ID
 */
function getActiveBaseId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(ACTIVE_BASE_ID_KEY)
  } catch {
    return null
  }
}

/**
 * Set active knowledge base ID
 */
function setActiveBaseId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ACTIVE_BASE_ID_KEY, id)
    window.dispatchEvent(new CustomEvent('knowledge-base-updated'))
  } catch {
    logger.error('Failed to set active base id')
  }
}

/** Load chunks for a knowledge base from IndexedDB. */
async function loadChunksForBase(baseId: string): Promise<KnowledgeChunk[]> {
  const list = await loadChunksForBaseFromIdb(baseId)
  return list as KnowledgeChunk[]
}

/** Load all chunks from IndexedDB. */
async function loadAllChunks(): Promise<KnowledgeChunk[]> {
  const list = await loadAllChunksFromIdb()
  return list as KnowledgeChunk[]
}

/** Save all chunks to IndexedDB; on failure dispatch chunks-save-failed and throw. */
async function saveAllChunks(chunks: KnowledgeChunk[]): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    await saveAllChunksToIdb(chunks as import('@/lib/chunk-storage').StoredChunk[])
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    const isQuota = err.name === 'QuotaExceededError' || err.message?.includes('QuotaExceeded')
    logger.error('Failed to save chunks', {
      name: err.name,
      message: err.message,
      chunkCount: chunks.length,
      isQuotaExceeded: isQuota,
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('chunks-save-failed', {
          detail: {
            reason: isQuota ? 'storage_quota' : 'unknown',
            message: isQuota
              ? '存储空间不足，无法保存更多片段。请删除部分已导入文件后再试，或改用本地嵌入。'
              : err.message,
          },
        }),
      )
    }
    throw err
  }
}

/**
 * Open file dialog and select files
 */
export async function selectFiles(): Promise<string[]> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'Knowledge Files',
          extensions: ['pdf', 'md', 'txt'],
        },
      ],
    })

    if (!selected) return []
    return Array.isArray(selected) ? selected : [selected]
  } catch (error) {
    logger.error('Failed to open file dialog', { error })
    return []
  }
}

/**
 * Import a single file into a specific knowledge base
 */
export async function importFile(filePath: string, baseId?: string): Promise<KnowledgeFile | null> {
  const targetBaseId = baseId || getActiveBaseId()
  if (!targetBaseId) {
    logger.error('No active knowledge base')
    return null
  }

  logger.info('Importing file', { filePath, baseId: targetBaseId })

  try {
    const bases = loadAllBases()
    const targetBase = bases.find((b) => b.id === targetBaseId)
    if (!targetBase) {
      logger.error('Target knowledge base not found', { baseId: targetBaseId })
      return null
    }

    // Check if already imported in this base
    if (targetBase.files.some((f) => f.filePath === filePath)) {
      logger.warn('File already imported in this base', { filePath, baseId: targetBaseId })
      return null
    }

    // Read file content
    const fileData = await readFile(filePath)
    const fileSize = fileData.length

    // Parse file
    const parseResult = await parseFile(filePath, fileData, {
      onPdfOcrStarted: (detail: PdfOcrStartedDetail) => {
        dispatchKnowledgeImportEvent('ocr-started', detail)
      },
      onPdfOcrProgress: (detail: PdfOcrProgressDetail) => {
        dispatchKnowledgeImportEvent('ocr-progress', detail)
      },
      onPdfOcrFailed: (detail: PdfOcrFailedDetail) => {
        dispatchKnowledgeImportEvent('ocr-failed', detail)
      },
      onPdfOcrFinished: (detail: PdfOcrFinishedDetail) => {
        dispatchKnowledgeImportEvent('ocr-finished', detail)
      },
    })

    // No extractable text (e.g. scanned PDF, or empty file)
    if (!parseResult.chunks?.length || (parseResult.totalChars ?? 0) === 0) {
      logger.warn('No text extracted from file', {
        filePath,
        chunks: parseResult.chunks?.length ?? 0,
        totalChars: parseResult.totalChars,
      })
      const err = new Error('NO_TEXT_EXTRACTED') as Error & { code?: string }
      err.code = 'NO_TEXT_EXTRACTED'
      throw err
    }

    // Load all chunks from IndexedDB
    const allChunks = await loadAllChunks()
    let totalAtoms = 0

    const newChunks: KnowledgeChunk[] = []
    const seenContent = new Set<string>()

    for (const chunk of parseResult.chunks) {
      const atoms = createImageryAtoms(parseResult.fileName, chunk.content, chunk.pageNumber)

      for (const atom of atoms) {
        const dedupKey = normalizeChunkContentForDedup(atom.content)
        if (seenContent.has(dedupKey)) continue
        seenContent.add(dedupKey)

        newChunks.push({
          ...atom,
          fileId: filePath,
          baseId: targetBaseId,
          importedAt: new Date().toISOString(),
        })
      }
      totalAtoms = newChunks.length
    }

    // Generate embeddings in browser (optional; failure => keyword-only retrieval)
    let embeddingSkipped = false
    try {
      if (typeof window !== 'undefined' && newChunks.length > 0) {
        const texts = newChunks.map((c) => c.content)
        const vectors = await embedBatch(texts)
        vectors.forEach((vec, i) => {
          if (newChunks[i] && vec.length) newChunks[i].embedding = vec
        })
      }
    } catch (e) {
      embeddingSkipped = true
      const err = e instanceof Error ? e : new Error(String(e))
      logger.warn('Skipping embeddings for this import', { message: err.message })
    }

    if (embeddingSkipped && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('embedding-skipped'))
    }

    allChunks.push(...newChunks)
    await saveAllChunks(allChunks)

    // Create file record
    const knowledgeFile: KnowledgeFile = {
      id: generateId(),
      fileName: parseResult.fileName,
      filePath,
      fileSize,
      importedAt: new Date().toISOString(),
      totalChunks: totalAtoms,
      totalChars: parseResult.totalChars,
      parseResult,
      baseId: targetBaseId,
    }

    // Update knowledge base
    targetBase.files.push(knowledgeFile)
    targetBase.lastUpdated = new Date().toISOString()
    saveAllBases(bases)

    logger.info('File imported successfully', {
      filePath,
      baseId: targetBaseId,
      chunks: totalAtoms,
      chars: parseResult.totalChars,
    })

    return knowledgeFile
  } catch (error) {
    const err = error as Error & { code?: string }
    if (error instanceof OcrError) {
      throw error
    }
    if (err?.code === 'NO_TEXT_EXTRACTED') {
      throw err
    }
    const isQuota =
      err.name === 'QuotaExceededError' ||
      (err.message &&
        (err.message.includes('QuotaExceeded') || err.message.includes('存储空间不足')))
    if (isQuota) {
      const userErr = new Error(
        '存储空间不足，无法保存更多片段。请删除部分已导入文件后再试，或关闭「启用 API 嵌入」改用本地嵌入。',
      ) as Error & { code?: string }
      userErr.code = 'CHUNKS_SAVE_FAILED'
      throw userErr
    }
    logger.error('Failed to import file', { filePath, error })
    return null
  }
}

/**
 * Import multiple files into current knowledge base
 */
export async function importFiles(filePaths: string[], baseId?: string): Promise<KnowledgeFile[]> {
  const results: KnowledgeFile[] = []

  for (const filePath of filePaths) {
    try {
      const file = await importFile(filePath, baseId)
      if (file) results.push(file)
    } catch (e: unknown) {
      const err = e as Error & { code?: string }
      if (e instanceof OcrError) {
        if (e.code === 'OCR_EMPTY_RESULT') {
          throw new Error('OCR 没有识别到可用文字，请确认这份扫描件是否清晰可读。')
        }
        throw new Error(getOcrUserMessage(e))
      }
      if (err?.code === 'NO_TEXT_EXTRACTED') {
        throw new Error(
          '该 PDF 可能为扫描件，无法提取文字；请使用含文字层的 PDF，或稍后支持 OCR 后再试。',
        )
      }
      if (err?.code === 'CHUNKS_SAVE_FAILED') {
        throw err
      }
      throw e
    }
  }

  return results
}

/**
 * Create a new knowledge base
 */
export function createKnowledgeBase(name: string): KnowledgeBase {
  const newBase: KnowledgeBase = {
    id: generateId(),
    name: name || '新共鸣库',
    files: [],
    mandatoryBooks: [],
    mandatoryMaxSlots: 1,
    lastUpdated: new Date().toISOString(),
  }

  const bases = loadAllBases()
  bases.push(newBase)
  saveAllBases(bases)

  // If this is the first base, set it as active
  if (bases.length === 1) {
    setActiveBaseId(newBase.id)
  }

  logger.info('Created new knowledge base', { baseId: newBase.id, name })
  return newBase
}

/**
 * Delete a knowledge base
 */
export async function deleteKnowledgeBase(baseId: string): Promise<boolean> {
  const bases = loadAllBases()
  const baseIndex = bases.findIndex((b) => b.id === baseId)

  if (baseIndex === -1) return false

  const allChunks = await loadAllChunks()
  const remainingChunks = allChunks.filter((c) => c.baseId !== baseId)
  await saveAllChunks(remainingChunks)

  bases.splice(baseIndex, 1)
  saveAllBases(bases)

  const activeId = getActiveBaseId()
  if (activeId === baseId) {
    if (bases.length > 0) {
      setActiveBaseId(bases[0].id)
    } else {
      localStorage.removeItem(ACTIVE_BASE_ID_KEY)
    }
  }

  logger.info('Deleted knowledge base', { baseId })
  return true
}

/**
 * Get all knowledge bases
 */
export function getAllKnowledgeBases(): KnowledgeBase[] {
  return loadAllBases()
}

/**
 * Get a specific knowledge base by ID
 */
export function getKnowledgeBase(baseId: string): KnowledgeBase | null {
  const bases = loadAllBases()
  return bases.find((b) => b.id === baseId) || null
}

/**
 * Get the currently active knowledge base
 */
export function getActiveKnowledgeBase(): KnowledgeBase | null {
  const activeId = getActiveBaseId()
  if (!activeId) return null
  return getKnowledgeBase(activeId)
}

/**
 * Set the active knowledge base
 */
export function setActiveKnowledgeBase(baseId: string): boolean {
  const base = getKnowledgeBase(baseId)
  if (!base) return false

  setActiveBaseId(baseId)
  logger.info('Set active knowledge base', { baseId })
  return true
}

/**
 * Update knowledge base name
 */
export function updateKnowledgeBaseName(baseId: string, name: string): boolean {
  const bases = loadAllBases()
  const base = bases.find((b) => b.id === baseId)

  if (!base) return false

  base.name = name
  base.lastUpdated = new Date().toISOString()
  saveAllBases(bases)

  return true
}

/**
 * Set mandatory books for a knowledge base (1-3 books)
 */
export function setMandatoryBooks(baseId: string, fileIds: string[]): boolean {
  if (fileIds.length < 1 || fileIds.length > 3) {
    throw new Error('必须指定1-3本强制检索书籍')
  }

  const bases = loadAllBases()
  const base = bases.find((b) => b.id === baseId)

  if (!base) return false

  // Validate that all fileIds exist in this base
  const validFileIds = fileIds.filter((id) => base.files.some((f) => f.id === id))

  base.mandatoryBooks = validFileIds.slice(0, 3)
  base.lastUpdated = new Date().toISOString()
  saveAllBases(bases)

  logger.info('Set mandatory books', { baseId, fileIds: base.mandatoryBooks })
  return true
}

/**
 * Get mandatory books for a knowledge base
 */
export function getMandatoryBooks(baseId: string): string[] {
  const base = getKnowledgeBase(baseId)
  return base?.mandatoryBooks || []
}

/**
 * Set max slots (1-3) that mandatory books can occupy in ribbon results
 */
export function setMandatoryMaxSlots(baseId: string, slots: MandatoryMaxSlots): boolean {
  const bases = loadAllBases()
  const base = bases.find((b) => b.id === baseId)
  if (!base) return false

  base.mandatoryMaxSlots = slots
  base.lastUpdated = new Date().toISOString()
  saveAllBases(bases)
  return true
}

/**
 * Get all files from a specific knowledge base
 */
export function getImportedFiles(baseId?: string): KnowledgeFile[] {
  const targetId = baseId || getActiveBaseId()
  if (!targetId) return []

  const base = getKnowledgeBase(targetId)
  return base?.files || []
}

/**
 * Get all chunks from a specific knowledge base
 */
export async function getChunksByBase(baseId?: string): Promise<KnowledgeChunk[]> {
  const targetId = baseId || getActiveBaseId()
  if (!targetId) return []
  return loadChunksForBase(targetId)
}

/**
 * Get file paths for mandatory book IDs in a base (chunks use filePath as fileId)
 */
export function getMandatoryFilePaths(baseId: string): string[] {
  const base = getKnowledgeBase(baseId)
  if (!base || !base.mandatoryBooks?.length) return []

  return base.files.filter((f) => base.mandatoryBooks!.includes(f.id)).map((f) => f.filePath)
}

/**
 * Get chunks for specific files in a base.
 * fileIds are KnowledgeFile.id; chunks store filePath as fileId.
 */
export async function getChunksByFiles(
  fileIds: string[],
  baseId?: string,
): Promise<KnowledgeChunk[]> {
  const targetId = baseId || getActiveBaseId()
  if (!targetId || fileIds.length === 0) return []

  const base = getKnowledgeBase(targetId)
  if (!base) return []

  const filePaths = base.files.filter((f) => fileIds.includes(f.id)).map((f) => f.filePath)

  if (filePaths.length === 0) return []

  const allChunks = await loadAllChunks()
  return allChunks.filter((c) => c.baseId === targetId && filePaths.includes(c.fileId))
}

/**
 * Remove a file from knowledge base
 */
export async function removeFile(fileId: string, baseId?: string): Promise<boolean> {
  const targetId = baseId || getActiveBaseId()
  if (!targetId) return false

  const bases = loadAllBases()
  const base = bases.find((b) => b.id === targetId)

  if (!base) return false

  const fileIndex = base.files.findIndex((f) => f.id === fileId)
  if (fileIndex === -1) return false

  const filePath = base.files[fileIndex].filePath

  const allChunks = await loadAllChunks()
  const remainingChunks = allChunks.filter((c) => !(c.baseId === targetId && c.fileId === filePath))
  await saveAllChunks(remainingChunks)

  base.files.splice(fileIndex, 1)

  const mandatoryIndex = base.mandatoryBooks.indexOf(fileId)
  if (mandatoryIndex > -1) {
    base.mandatoryBooks.splice(mandatoryIndex, 1)
  }

  base.lastUpdated = new Date().toISOString()
  saveAllBases(bases)

  logger.info('File removed', { fileId, baseId: targetId, filePath })
  return true
}

/**
 * Clear all knowledge bases and chunks
 */
export async function clearAllKnowledgeBases(): Promise<void> {
  if (typeof window === 'undefined') return
  await clearChunksInIdb()
  localStorage.removeItem(BASES_KEY)
  localStorage.removeItem(ACTIVE_BASE_ID_KEY)
  logger.info('All knowledge bases cleared')
}

/**
 * Get knowledge base stats
 */
export async function getKnowledgeStats(baseId?: string): Promise<{
  fileCount: number
  chunkCount: number
  totalChars: number
  lastUpdated: string
  mandatoryBookCount: number
}> {
  const targetId = baseId || getActiveBaseId()
  const base = targetId ? getKnowledgeBase(targetId) : null
  const chunks = targetId ? await loadChunksForBase(targetId) : []

  return {
    fileCount: base?.files.length || 0,
    chunkCount: chunks.length,
    totalChars: base?.files.reduce((sum, f) => sum + f.totalChars, 0) || 0,
    lastUpdated: base?.lastUpdated || new Date().toISOString(),
    mandatoryBookCount: base?.mandatoryBooks.length || 0,
  }
}

/**
 * Get global stats across all bases
 */
export async function getGlobalStats(): Promise<{
  baseCount: number
  totalFiles: number
  totalChunks: number
  totalChars: number
}> {
  const bases = loadAllBases()
  const allChunks = await loadAllChunks()

  return {
    baseCount: bases.length,
    totalFiles: bases.reduce((sum, b) => sum + b.files.length, 0),
    totalChunks: allChunks.length,
    totalChars: bases.reduce(
      (sum, b) => sum + b.files.reduce((fSum, f) => fSum + f.totalChars, 0),
      0,
    ),
  }
}

// Export service object for convenience
export const knowledgeBaseService = {
  create: createKnowledgeBase,
  delete: deleteKnowledgeBase,
  getAll: getAllKnowledgeBases,
  get: getKnowledgeBase,
  getActive: getActiveKnowledgeBase,
  setActive: setActiveKnowledgeBase,
  updateName: updateKnowledgeBaseName,
  setMandatoryBooks,
  getMandatoryBooks,
  setMandatoryMaxSlots,
  getMandatoryFilePaths,
  importFile,
  importFiles,
  removeFile,
  getFiles: getImportedFiles,
  getChunks: getChunksByBase,
  getChunksByFiles,
  getStats: getKnowledgeStats,
  getGlobalStats,
  clearAll: clearAllKnowledgeBases,
}
