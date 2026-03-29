'use client'

import { Extension, InputRule, markInputRule, markPasteRule } from '@tiptap/core'

function normalizeMarkdownUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function createMarkdownLinkInputRule() {
  return new InputRule({
    find: /\[([^\]]+)\]\(([^)\s]+)\)$/,
    handler: ({ state, range, match }) => {
      const linkText = match[1]?.trim()
      const href = normalizeMarkdownUrl(match[2] ?? '')
      const linkType = state.schema.marks.link

      if (!linkType || !linkText || !href) return null

      const { tr } = state
      const fullMatch = match[0]
      const startSpaces = fullMatch.search(/\S/)
      const textStart = range.from + fullMatch.indexOf(linkText)
      const textEnd = textStart + linkText.length

      if (textEnd < range.to) {
        tr.delete(textEnd, range.to)
      }
      if (textStart > range.from) {
        tr.delete(range.from + startSpaces, textStart)
      }

      const markStart = range.from + startSpaces
      const markEnd = markStart + linkText.length
      tr.addMark(markStart, markEnd, linkType.create({ href }))
      tr.removeStoredMark(linkType)
    },
  })
}

export const MarkdownShortcutsExtension = Extension.create({
  name: 'markdownShortcuts',

  addInputRules() {
    const rules = []
    const { marks } = this.editor.schema

    if (marks.bold) {
      rules.push(
        markInputRule({
          find: /(?<!\*)\*\*([^*\n]+)\*\*$/,
          type: marks.bold,
        }),
        markInputRule({
          find: /(?<!_)__([^_\n]+)__$/,
          type: marks.bold,
        }),
      )
    }

    if (marks.italic) {
      rules.push(
        markInputRule({
          find: /(?<!\*)\*([^*\n]+)\*$/,
          type: marks.italic,
        }),
        markInputRule({
          find: /(?<!_)_([^_\n]+)_$/,
          type: marks.italic,
        }),
      )
    }

    if (marks.strike) {
      rules.push(
        markInputRule({
          find: /~~([^~\n]+)~~$/,
          type: marks.strike,
        }),
      )
    }

    if (marks.code) {
      rules.push(
        markInputRule({
          find: /`([^`\n]+)`$/,
          type: marks.code,
        }),
      )
    }

    if (marks.link) {
      rules.push(createMarkdownLinkInputRule())
    }

    return rules
  },

  addPasteRules() {
    const rules = []
    const { marks } = this.editor.schema

    if (marks.bold) {
      rules.push(
        markPasteRule({
          find: /(?<!\*)\*\*([^*\n]+)\*\*/g,
          type: marks.bold,
        }),
        markPasteRule({
          find: /(?<!_)__([^_\n]+)__/g,
          type: marks.bold,
        }),
      )
    }

    if (marks.italic) {
      rules.push(
        markPasteRule({
          find: /(?<!\*)\*([^*\n]+)\*/g,
          type: marks.italic,
        }),
        markPasteRule({
          find: /(?<!_)_([^_\n]+)_/g,
          type: marks.italic,
        }),
      )
    }

    if (marks.strike) {
      rules.push(
        markPasteRule({
          find: /~~([^~\n]+)~~/g,
          type: marks.strike,
        }),
      )
    }

    if (marks.code) {
      rules.push(
        markPasteRule({
          find: /`([^`\n]+)`/g,
          type: marks.code,
        }),
      )
    }

    return rules
  },
})
