/**
 * Adoption store: record when user copies an echo from the ribbon (copy = adopt).
 * Used for Echo Gallery (curator report) and RAG weight boost.
 */

import type { EchoItem } from '@/types'

const PREFIX = 'echo-adoptions:'
const MAX_PER_DOC = 200
const MAX_RECENT_GLOBAL = 100

export interface AdoptionRecord {
  echoId: string
  content: string
  originalText?: string
  source?: string
  copiedAt: string
}

function storageKey(documentId: string): string {
  return `${PREFIX}${documentId}`
}

export const adoptionStore = {
  recordAdoption(documentId: string, item: EchoItem): void {
    if (typeof window === 'undefined') return
    try {
      const k = storageKey(documentId)
      const raw = localStorage.getItem(k)
      const list: AdoptionRecord[] = raw ? JSON.parse(raw) : []
      const record: AdoptionRecord = {
        echoId: item.id,
        content: item.content ?? '',
        originalText: item.originalText,
        source: item.source,
        copiedAt: new Date().toISOString(),
      }
      list.unshift(record)
      const trimmed = list.slice(0, MAX_PER_DOC)
      localStorage.setItem(k, JSON.stringify(trimmed))
    } catch {
      // ignore
    }
  },

  getAdoptionsByDocument(documentId: string): AdoptionRecord[] {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(storageKey(documentId))
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  },

  /** Get recent adoptions across all documents (for personal core weight). */
  getRecentAdoptions(limit: number = MAX_RECENT_GLOBAL): AdoptionRecord[] {
    if (typeof window === 'undefined') return []
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(PREFIX)) keys.push(k)
      }
      const all: AdoptionRecord[] = []
      for (const k of keys) {
        const raw = localStorage.getItem(k)
        if (raw) {
          const list = JSON.parse(raw) as AdoptionRecord[]
          all.push(...list)
        }
      }
      all.sort((a, b) => (b.copiedAt > a.copiedAt ? 1 : -1))
      return all.slice(0, limit)
    } catch {
      return []
    }
  },

  /**
   * Reorder echo items so that those similar to adopted content (for this doc or recent global) come first.
   * Similarity: adopted text contains item text slice or item contains adopted slice (min 20 chars).
   */
  boostOrderByAdoptions<T extends { content?: string; originalText?: string }>(
    items: T[],
    documentId: string,
    recentLimit: number = 30,
  ): T[] {
    const adopted = [
      ...this.getAdoptionsByDocument(documentId),
      ...this.getRecentAdoptions(recentLimit),
    ]
    const adoptedTexts = adopted.map((a) => (a.originalText ?? a.content ?? '').trim().toLowerCase()).filter((t) => t.length >= 20)
    if (adoptedTexts.length === 0) return items
    const scored = items.map((item) => {
      const text = (item.originalText ?? item.content ?? '').trim().toLowerCase().slice(0, 300)
      const match = adoptedTexts.some((ad) => ad.includes(text.slice(0, 50)) || text.includes(ad.slice(0, 50)))
      return { item, match }
    })
    return [...scored.filter((s) => s.match).map((s) => s.item), ...scored.filter((s) => !s.match).map((s) => s.item)]
  },

  /** Get document IDs that have at least one adoption (for gallery list). */
  getDocumentIdsWithAdoptions(): string[] {
    if (typeof window === 'undefined') return []
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) keys.push(k)
    }
    return keys.map((k) => k.slice(PREFIX.length))
  },
}
