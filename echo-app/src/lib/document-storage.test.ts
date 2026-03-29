import assert from 'node:assert/strict'
import test from 'node:test'

import type { Document } from '../types'
// @ts-expect-error Node test runner resolves this file via strip-types.
import { documentStorage } from './document-storage.ts'

class MemoryStorage {
  #store = new Map<string, string>()

  get length() {
    return this.#store.size
  }

  clear() {
    this.#store.clear()
  }

  getItem(key: string): string | null {
    return this.#store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, value)
  }
}

const localStorageMock = new MemoryStorage()

function installStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  })

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: localStorageMock },
  })
}

function createDoc(id: string, title: string, content: string, updatedAt: string): Document {
  return {
    id,
    title,
    content,
    createdAt: updatedAt,
    updatedAt,
  }
}

test.beforeEach(() => {
  localStorageMock.clear()
  installStorage()
})

test('documentStorage saves and restores a document', () => {
  const doc = createDoc('doc-1', '功能说明', 'hello world', '2026-03-29T08:00:00.000Z')

  documentStorage.save(doc)
  const restored = documentStorage.get('doc-1')

  assert.ok(restored)
  assert.equal(restored.id, doc.id)
  assert.equal(restored.title, doc.title)
  assert.equal(restored.content, doc.content)
})

test('documentStorage list sorts by updated time and falls back to untitled', () => {
  localStorage.setItem(
    'echo-doc:older',
    JSON.stringify(createDoc('older', '', 'old', '2026-03-29T08:00:00.000Z')),
  )
  localStorage.setItem(
    'echo-doc:newer',
    JSON.stringify(createDoc('newer', '新文档', 'new', '2026-03-29T09:00:00.000Z')),
  )

  const docs = documentStorage.list()

  assert.equal(docs.length, 2)
  assert.equal(docs[0].id, 'newer')
  assert.equal(docs[1].id, 'older')
  assert.equal(docs[1].title, '无题')
})

test('documentStorage delete re-points last document id to a remaining document', () => {
  localStorage.setItem(
    'echo-doc:first',
    JSON.stringify(createDoc('first', '第一篇', 'a', '2026-03-29T08:00:00.000Z')),
  )
  localStorage.setItem(
    'echo-doc:second',
    JSON.stringify(createDoc('second', '第二篇', 'b', '2026-03-29T09:00:00.000Z')),
  )
  documentStorage.setLastDocumentId('second')

  const deleted = documentStorage.delete('second')

  assert.equal(deleted, true)
  assert.equal(documentStorage.get('second'), null)
  assert.equal(documentStorage.getLastDocumentId(), 'first')
})

test('documentStorage listIds keeps only the latest 100 stored ids', () => {
  for (let index = 0; index < 105; index += 1) {
    localStorage.setItem(
      `echo-doc:doc-${index}`,
      JSON.stringify(
        createDoc(`doc-${index}`, `文档 ${index}`, 'x', `2026-03-29T08:${String(index % 60).padStart(2, '0')}:00.000Z`),
      ),
    )
  }

  const ids = documentStorage.listIds()

  assert.equal(ids.length, 100)
  assert.equal(ids[0], 'doc-5')
  assert.equal(ids.at(-1), 'doc-104')
})
