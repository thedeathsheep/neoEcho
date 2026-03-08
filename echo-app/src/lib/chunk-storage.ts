/**
 * IndexedDB persistence for knowledge-base chunks.
 * Replaces localStorage for chunk storage to support much larger capacity.
 * On first use, migrates existing chunks from localStorage (echo-knowledge-chunks-v2 / echo-knowledge-chunks).
 */

const DB_NAME = 'echo-knowledge-db'
const DB_VERSION = 1
const STORE_NAME = 'chunks'
const CHUNKS_KEY = 'echo-knowledge-chunks-v2'
const LEGACY_CHUNKS_KEY = 'echo-knowledge-chunks'

/** Chunk shape stored in IDB (matches KnowledgeChunk from knowledge-base.service). */
export interface StoredChunk {
  id: string
  baseId: string
  content: string
  fileId: string
  importedAt: string
  embedding?: number[]
  sourceFile: string
  pageNumber?: number
  chunkIndex: number
  totalChunks: number
  charStart: number
  charEnd: number
  chunkType?: 'lit' | 'fact'
}

let dbInstance: IDBDatabase | null = null

function isValidChunkContent(content: string): boolean {
  if (content.includes('\uFFFD')) return false
  let privateUse = 0
  let cjkIdeographs = 0
  let basicLatin = 0
  for (const char of content.slice(0, 200)) {
    const code = char.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) cjkIdeographs++
    if (code >= 32 && code <= 126) basicLatin++
    if ((code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) privateUse++
  }
  if (privateUse > 2) return false
  return (cjkIdeographs + basicLatin) > 0
}

function openDbPromise(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB only in browser'))
  }
  if (dbInstance) return Promise.resolve(dbInstance)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      dbInstance = req.result
      resolve(dbInstance)
    }
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('baseId', 'baseId', { unique: false })
      }
    }
  })
}

/** Migrate chunks from localStorage into IndexedDB if IDB store is empty. */
async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  const countReq = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count()
  const count = await new Promise<number>((resolve, reject) => {
    countReq.onsuccess = () => resolve(countReq.result)
    countReq.onerror = () => reject(countReq.error)
  })
  if (count > 0) return

  let raw: string | null = null
  try {
    raw = localStorage.getItem(CHUNKS_KEY)
    if (!raw) raw = localStorage.getItem(LEGACY_CHUNKS_KEY)
  } catch {
    // ignore
  }
  if (!raw) return

  let parsed: StoredChunk[]
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return
    parsed = arr as StoredChunk[]
  } catch {
    return
  }

  if (parsed.length === 0) return

  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const chunk of parsed) {
    if (chunk && typeof chunk.id === 'string') {
      store.put(chunk)
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  try {
    localStorage.removeItem(CHUNKS_KEY)
    localStorage.removeItem(LEGACY_CHUNKS_KEY)
  } catch {
    // optional cleanup
  }
}

/**
 * Open DB and run migration from localStorage if needed.
 */
export async function openDb(): Promise<IDBDatabase> {
  const db = await openDbPromise()
  await migrateFromLocalStorage(db)
  return db
}

/**
 * Load all chunks from IndexedDB (after filtering invalid content).
 */
export async function loadAllChunks(): Promise<StoredChunk[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    const all = await new Promise<StoredChunk[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as StoredChunk[]) || [])
      req.onerror = () => reject(req.error)
    })
    return all.filter((c) => isValidChunkContent(c.content))
  } catch {
    return []
  }
}

/**
 * Load chunks for a single knowledge base.
 */
export async function loadChunksForBase(baseId: string): Promise<StoredChunk[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('baseId')
    const req = index.getAll(baseId)
    const list = await new Promise<StoredChunk[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as StoredChunk[]) || [])
      req.onerror = () => reject(req.error)
    })
    return list.filter((c) => isValidChunkContent(c.content))
  } catch {
    return []
  }
}

/**
 * Replace all chunks in IndexedDB with the given array.
 */
export async function saveAllChunks(chunks: StoredChunk[]): Promise<void> {
  if (typeof window === 'undefined') return
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.clear()
  for (const chunk of chunks) {
    store.put(chunk)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  window.dispatchEvent(new CustomEvent('knowledge-base-updated'))
}

/**
 * Clear all chunks from IndexedDB.
 */
export async function clearChunks(): Promise<void> {
  if (typeof window === 'undefined') return
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
