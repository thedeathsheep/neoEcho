/**
 * Client-side document persistence (localStorage).
 * Used for document title + content auto-save until backend is available.
 */

import type { Document } from '@/types'

const PREFIX = 'echo-doc:'
const LAST_ID_KEY = 'echo-last-document-id'
const MAX_ITEMS = 100

function key(id: string) {
  return `${PREFIX}${id}`
}

export const documentStorage = {
  get(id: string): Document | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(key(id))
      if (!raw) return null
      return JSON.parse(raw) as Document
    } catch {
      return null
    }
  },

  save(doc: Document): void {
    if (typeof window === 'undefined') return
    try {
      const toSave = { ...doc, updatedAt: new Date().toISOString() }
      localStorage.setItem(key(doc.id), JSON.stringify(toSave))
    } catch {
      // ignore quota or parse errors
    }
  },

  getLastDocumentId(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(LAST_ID_KEY)
  },

  setLastDocumentId(id: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(LAST_ID_KEY, id)
  },

  listIds(): string[] {
    if (typeof window === 'undefined') return []
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length))
    }
    return ids.slice(-MAX_ITEMS)
  },

  /**
   * List all documents with id, title, updatedAt (sorted by updatedAt desc)
   */
  list(): { id: string; title: string; updatedAt: string }[] {
    if (typeof window === 'undefined') return []
    const ids = this.listIds()
    const docs = ids
      .map((id) => this.get(id))
      .filter((doc): doc is Document => doc != null)
      .map((doc) => ({
        id: doc.id,
        title: doc.title || '无题',
        updatedAt: doc.updatedAt,
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    return docs
  },

  delete(id: string): boolean {
    if (typeof window === 'undefined') return false
    try {
      localStorage.removeItem(key(id))
      if (this.getLastDocumentId() === id) {
        const remaining = this.listIds().filter((i) => i !== id)
        if (remaining.length > 0) {
          this.setLastDocumentId(remaining[0])
        } else {
          localStorage.removeItem(LAST_ID_KEY)
        }
      }
      return true
    } catch {
      return false
    }
  },
}
