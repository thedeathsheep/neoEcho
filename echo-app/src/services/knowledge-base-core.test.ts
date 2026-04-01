import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node test runner resolves this file via strip-types.
import {
  createKnowledgeBaseState,
  deleteKnowledgeBaseState,
  getMandatoryFilePathsState,
  removeFileFromKnowledgeBaseState,
  setMandatoryBooksState,
  setMandatoryMaxSlotsState,
} from './knowledge-base-core.ts'

function createBase(id: string, name: string) {
  return {
    id,
    name,
    files: [],
    mandatoryBooks: [],
    mandatoryMaxSlots: 1 as const,
    lastUpdated: '2026-03-29T08:00:00.000Z',
  }
}

test('createKnowledgeBaseState activates the first base automatically', () => {
  const result = createKnowledgeBaseState([], '资料库', 'base-1', '2026-03-29T08:00:00.000Z')

  assert.equal(result.bases.length, 1)
  assert.equal(result.bases[0].name, '资料库')
  assert.equal(result.activeBaseId, 'base-1')
})

test('deleteKnowledgeBaseState switches to the next remaining base when active base is removed', () => {
  const result = deleteKnowledgeBaseState(
    [createBase('base-1', '第一库'), createBase('base-2', '第二库')],
    'base-1',
    'base-1',
  )

  assert.equal(result.bases.length, 1)
  assert.equal(result.bases[0].id, 'base-2')
  assert.equal(result.activeBaseId, 'base-2')
})

test('setMandatoryBooksState keeps only valid file ids and caps the list at three', () => {
  const base = {
    ...createBase('base-1', '资料库'),
    files: [
      { id: 'file-1', filePath: '/a.md' },
      { id: 'file-2', filePath: '/b.md' },
      { id: 'file-3', filePath: '/c.md' },
      { id: 'file-4', filePath: '/d.md' },
    ],
  }

  const result = setMandatoryBooksState(
    [base],
    'base-1',
    ['file-1', 'missing', 'file-2', 'file-3', 'file-4'],
    '2026-03-29T08:10:00.000Z',
  )

  assert.deepEqual(result[0].mandatoryBooks, ['file-1', 'file-2', 'file-3'])
  assert.equal(result[0].lastUpdated, '2026-03-29T08:10:00.000Z')
})

test('setMandatoryMaxSlotsState updates the max slot cap for a base', () => {
  const result = setMandatoryMaxSlotsState(
    [createBase('base-1', '资料库')],
    'base-1',
    3,
    '2026-03-29T08:15:00.000Z',
  )

  assert.equal(result[0].mandatoryMaxSlots, 3)
  assert.equal(result[0].lastUpdated, '2026-03-29T08:15:00.000Z')
})

test('getMandatoryFilePathsState returns only mandatory file paths in file order', () => {
  const base = {
    ...createBase('base-1', '资料库'),
    files: [
      { id: 'file-2', filePath: '/b.md' },
      { id: 'file-1', filePath: '/a.md' },
      { id: 'file-3', filePath: '/c.md' },
    ],
    mandatoryBooks: ['file-1', 'file-3'],
  }

  const result = getMandatoryFilePathsState(base)

  assert.deepEqual(result, ['/a.md', '/c.md'])
})

test('removeFileFromKnowledgeBaseState removes the file and clears it from mandatory books', () => {
  const base = {
    ...createBase('base-1', '资料库'),
    files: [
      { id: 'file-1', filePath: '/a.md' },
      { id: 'file-2', filePath: '/b.md' },
    ],
    mandatoryBooks: ['file-2'],
  }

  const result = removeFileFromKnowledgeBaseState(
    [base],
    'base-1',
    'file-2',
    '2026-03-29T08:20:00.000Z',
  )

  assert.equal(result[0].files.length, 1)
  assert.deepEqual(result[0].files.map((file) => file.id), ['file-1'])
  assert.deepEqual(result[0].mandatoryBooks, [])
  assert.equal(result[0].lastUpdated, '2026-03-29T08:20:00.000Z')
})
