import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node test runner resolves this file via strip-types.
import {
  buildBuiltinGuideDocument,
  BUILTIN_GUIDE_DOC_SLUG,
  getRibbonRunProfileCopy,
} from './onboarding-content.ts'

test('buildBuiltinGuideDocument creates the built-in guide article', () => {
  const now = '2026-03-29T08:00:00.000Z'
  const doc = buildBuiltinGuideDocument('guide-doc', now)

  assert.equal(doc.id, 'guide-doc')
  assert.equal(doc.slug, BUILTIN_GUIDE_DOC_SLUG)
  assert.equal(doc.title, '功能说明')
  assert.equal(doc.createdAt, now)
  assert.equal(doc.updatedAt, now)
  assert.match(doc.content, /欢迎使用 NeoEcho/)
  assert.match(doc.content, /你可以这样开始/)
})

test('reliable ribbon profile copy stays user-facing', () => {
  const copy = getRibbonRunProfileCopy('reliable')

  assert.equal(copy.title, '稳定优先')
  assert.doesNotMatch(copy.title, /调试/)
  assert.doesNotMatch(copy.description, /调试/)
  assert.doesNotMatch(copy.detail, /调试/)
})
