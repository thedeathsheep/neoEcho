import { createLogger } from '@/lib/logger'

const logger = createLogger('db')

const DB_TABLES = {
  documents: `
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '无题',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  echo_records: `
    CREATE TABLE IF NOT EXISTS echo_records (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      block_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('lit', 'fact', 'tag')),
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id)
    )
  `,
  knowledge_chunks: `
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      source_file TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_type TEXT NOT NULL CHECK (chunk_type IN ('lit', 'fact')),
      metadata TEXT,
      created_at TEXT NOT NULL
    )
  `,
} as const

/**
 * Database abstraction layer.
 * This file is a reserved abstraction and is not the app's active persistence path today.
 * Current user-facing persistence lives in browser storage:
 * - documents/settings: localStorage
 * - knowledge chunks/embeddings: IndexedDB
 * The in-memory Map here only exists for future data-layer integration work.
 */
class LocalDB {
  private store = new Map<string, Map<string, Record<string, unknown>>>()
  private initialized = false

  init() {
    if (this.initialized) return
    for (const table of Object.keys(DB_TABLES)) {
      this.store.set(table, new Map())
    }
    this.initialized = true
    logger.info('Database initialized', { tables: Object.keys(DB_TABLES) })
  }

  insert(table: string, id: string, data: Record<string, unknown>) {
    this.ensureInit()
    const t = this.store.get(table)
    if (!t) throw new Error(`Table "${table}" does not exist`)
    t.set(id, { ...data, id })
    return data
  }

  findById(table: string, id: string): Record<string, unknown> | undefined {
    this.ensureInit()
    return this.store.get(table)?.get(id)
  }

  findAll(table: string): Record<string, unknown>[] {
    this.ensureInit()
    const t = this.store.get(table)
    return t ? Array.from(t.values()) : []
  }

  update(table: string, id: string, data: Partial<Record<string, unknown>>) {
    this.ensureInit()
    const t = this.store.get(table)
    if (!t) throw new Error(`Table "${table}" does not exist`)
    const existing = t.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...data }
    t.set(id, updated)
    return updated
  }

  delete(table: string, id: string): boolean {
    this.ensureInit()
    return this.store.get(table)?.delete(id) ?? false
  }

  private ensureInit() {
    if (!this.initialized) this.init()
  }
}

export const db = new LocalDB()
