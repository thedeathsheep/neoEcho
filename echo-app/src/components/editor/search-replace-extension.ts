'use client'

import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

export interface SearchMatch {
  from: number
  to: number
  text: string
}

interface SearchState {
  query: string
  caseSensitive: boolean
  activeIndex: number
  matches: SearchMatch[]
  decorations: DecorationSet
}

interface SearchMeta {
  query?: string
  caseSensitive?: boolean
  activeIndex?: number
}

export const searchReplacePluginKey = new PluginKey<SearchState>('echo-search-replace')

function normalizeForCompare(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase()
}

function buildMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return []
  const target = normalizeForCompare(query, caseSensitive)
  const matches: SearchMatch[] = []

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return

    const source = normalizeForCompare(node.text, caseSensitive)
    let index = 0
    while (index <= source.length - target.length) {
      const foundAt = source.indexOf(target, index)
      if (foundAt === -1) break

      matches.push({
        from: position + foundAt,
        to: position + foundAt + query.length,
        text: node.text.slice(foundAt, foundAt + query.length),
      })

      index = foundAt + Math.max(query.length, 1)
    }
  })

  return matches
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: SearchMatch[],
  activeIndex: number,
): DecorationSet {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class:
        index === activeIndex
          ? 'editor-search-match editor-search-match-active'
          : 'editor-search-match',
    }),
  )

  return DecorationSet.create(doc, decorations)
}

function nextSearchState(
  doc: ProseMirrorNode,
  previous: SearchState,
  meta?: SearchMeta,
): SearchState {
  const query = meta?.query ?? previous.query
  const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive
  const matches =
    meta?.query !== undefined || meta?.caseSensitive !== undefined || previous.matches.length === 0
      ? buildMatches(doc, query, caseSensitive)
      : previous.matches

  const desiredIndex = meta?.activeIndex ?? previous.activeIndex
  const activeIndex =
    matches.length === 0 ? -1 : Math.min(Math.max(desiredIndex, 0), matches.length - 1)

  return {
    query,
    caseSensitive,
    activeIndex,
    matches,
    decorations: buildDecorations(doc, matches, activeIndex),
  }
}

export const SearchReplaceExtension = Extension.create({
  name: 'searchReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchReplacePluginKey,
        state: {
          init: (_, state) =>
            nextSearchState(state.doc, {
              query: '',
              caseSensitive: false,
              activeIndex: -1,
              matches: [],
              decorations: DecorationSet.empty,
            }),
          apply: (transaction, pluginState, _oldState, newState) => {
            const meta = transaction.getMeta(searchReplacePluginKey) as SearchMeta | undefined
            if (!transaction.docChanged && !meta) return pluginState

            if (transaction.docChanged) {
              return nextSearchState(newState.doc, pluginState, meta)
            }

            return nextSearchState(newState.doc, pluginState, meta)
          },
        },
        props: {
          decorations(state) {
            return searchReplacePluginKey.getState(state)?.decorations ?? null
          },
        },
      }),
    ]
  },
})

export function getSearchState(editor: Editor): SearchState {
  return (
    searchReplacePluginKey.getState(editor.state) ?? {
      query: '',
      caseSensitive: false,
      activeIndex: -1,
      matches: [],
      decorations: DecorationSet.empty,
    }
  )
}

export function setSearchQuery(
  editor: Editor,
  query: string,
  options?: { caseSensitive?: boolean; activeIndex?: number },
) {
  const state = getSearchState(editor)
  const matches = buildMatches(
    editor.state.doc,
    query,
    options?.caseSensitive ?? state.caseSensitive,
  )
  const activeIndex =
    options?.activeIndex !== undefined ? options.activeIndex : matches.length > 0 ? 0 : -1

  editor.view.dispatch(
    editor.state.tr.setMeta(searchReplacePluginKey, {
      query,
      caseSensitive: options?.caseSensitive ?? state.caseSensitive,
      activeIndex,
    }),
  )
}

export function clearSearch(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(searchReplacePluginKey, {
      query: '',
      activeIndex: -1,
    }),
  )
}

export function activateSearchMatch(
  editor: Editor,
  index: number,
  options?: { focusEditor?: boolean },
) {
  const state = getSearchState(editor)
  if (state.matches.length === 0) return

  const nextIndex = ((index % state.matches.length) + state.matches.length) % state.matches.length
  const match = state.matches[nextIndex]
  editor.view.dispatch(
    editor.state.tr
      .setMeta(searchReplacePluginKey, { activeIndex: nextIndex })
      .setSelection(TextSelection.create(editor.state.doc, match.from, match.to))
      .scrollIntoView(),
  )
  if (options?.focusEditor ?? true) {
    editor.commands.focus()
  }
}

export function moveToAdjacentSearchMatch(
  editor: Editor,
  direction: 1 | -1,
  options?: { focusEditor?: boolean },
) {
  const state = getSearchState(editor)
  if (state.matches.length === 0) return

  const nextIndex = state.activeIndex < 0 ? 0 : state.activeIndex + direction
  activateSearchMatch(editor, nextIndex, options)
}

export function replaceCurrentSearchMatch(
  editor: Editor,
  replacement: string,
  options?: { focusEditor?: boolean },
) {
  const state = getSearchState(editor)
  if (state.activeIndex < 0 || state.activeIndex >= state.matches.length) return

  const match = state.matches[state.activeIndex]
  editor.commands.insertContentAt({ from: match.from, to: match.to }, replacement)

  const nextMatches = buildMatches(editor.state.doc, state.query, state.caseSensitive)
  const nextIndex =
    nextMatches.length === 0 ? -1 : Math.min(state.activeIndex, nextMatches.length - 1)

  editor.view.dispatch(
    editor.state.tr.setMeta(searchReplacePluginKey, {
      activeIndex: nextIndex,
    }),
  )

  if (nextIndex >= 0) {
    activateSearchMatch(editor, nextIndex, options)
  }
}

export function replaceAllSearchMatches(editor: Editor, replacement: string) {
  const state = getSearchState(editor)
  if (state.matches.length === 0) return

  const tr = editor.state.tr
  for (let index = state.matches.length - 1; index >= 0; index -= 1) {
    const match = state.matches[index]
    tr.insertText(replacement, match.from, match.to)
  }
  editor.view.dispatch(tr)

  const nextMatches = buildMatches(editor.state.doc, state.query, state.caseSensitive)
  editor.view.dispatch(
    editor.state.tr.setMeta(searchReplacePluginKey, {
      activeIndex: nextMatches.length > 0 ? 0 : -1,
    }),
  )
}
