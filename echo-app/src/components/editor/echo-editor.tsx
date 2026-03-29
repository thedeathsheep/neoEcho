'use client'

import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { TextSelection } from '@tiptap/pm/state'
import { type Editor,EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { NodeIdExtension } from './node-id-extension'
import {
  activateSearchMatch,
  getSearchState,
  moveToAdjacentSearchMatch,
  replaceAllSearchMatches,
  replaceCurrentSearchMatch,
  SearchReplaceExtension,
  setSearchQuery,
} from './search-replace-extension'

export interface EchoEditorHandle {
  focusBlock: (blockId: string) => boolean
  getParagraphViewportMetrics: (from: number, to: number) => { top: number; bottom: number } | null
  openFind: () => void
  openReplace: () => void
  openLinkEditor: () => void
}

interface EchoEditorProps {
  initialContent?: string
  contentVersion?: number
  onUpdate?: (text: string, blockId: string | null) => void
  onActiveBlockChange?: (blockId: string | null) => void
  onContentChange?: (html: string) => void
  onSave?: () => void
  onInspire?: () => void
  onSelectionChange?: (selectedText: string) => void
  onParagraphChange?: (paragraphText: string, from: number, to: number) => void
}

type UtilityMode = 'find' | 'replace' | 'link' | null

function escapeNodeId(blockId: string): string {
  return blockId.replace(/["\\]/g, '\\$&')
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function syncLinkDraft(editor: Editor | null): string {
  if (!editor) return ''
  return (editor.getAttributes('link').href as string | undefined) ?? ''
}

function applyInlineMarkdownMark(
  editor: Editor,
  markdownPrefix: string,
  plainText: string,
  markName: 'bold' | 'italic' | 'strike' | 'code' | 'link',
  attrs?: Record<string, string>,
): boolean {
  const { state, view } = editor
  const { selection } = state
  if (!selection.empty) return false

  const { $from } = selection
  if (!$from.parent.isTextblock) return false

  const parentText = $from.parent.textContent
  const endOffset = $from.parentOffset
  const startOffset = endOffset - markdownPrefix.length
  if (startOffset < 0) return false
  if (parentText.slice(startOffset, endOffset) !== markdownPrefix) return false

  const markType = state.schema.marks[markName]
  if (!markType) return false

  const from = $from.start() + startOffset
  const to = $from.start() + endOffset
  const tr = state.tr.insertText(plainText, from, to)
  tr.addMark(from, from + plainText.length, markType.create(attrs ?? {}))
  tr.removeStoredMark(markType)
  tr.setSelection(TextSelection.create(tr.doc, from + plainText.length))
  view.dispatch(tr)
  return true
}

function handleMarkdownTextInput(editor: Editor, nextChar: string): boolean {
  const { state } = editor
  const { selection } = state
  if (!selection.empty) return false

  const { $from } = selection
  if (!$from.parent.isTextblock) return false

  const before = $from.parent.textContent.slice(0, $from.parentOffset)
  const candidate = `${before}${nextChar}`

  if (nextChar === ')') {
    const match = candidate.match(/\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (match) {
      return applyInlineMarkdownMark(editor, match[0].slice(0, -1), match[1], 'link', {
        href: normalizeUrl(match[2]),
      })
    }
  }

  if (nextChar === '*') {
    const boldMatch = candidate.match(/\*\*([^*\n]+)\*\*$/)
    if (boldMatch) {
      return applyInlineMarkdownMark(editor, boldMatch[0].slice(0, -1), boldMatch[1], 'bold')
    }

    const italicMatch = candidate.match(/\*([^*\n]+)\*$/)
    if (italicMatch) {
      return applyInlineMarkdownMark(editor, italicMatch[0].slice(0, -1), italicMatch[1], 'italic')
    }
  }

  if (nextChar === '_') {
    const boldMatch = candidate.match(/__([^_\n]+)__$/)
    if (boldMatch) {
      return applyInlineMarkdownMark(editor, boldMatch[0].slice(0, -1), boldMatch[1], 'bold')
    }

    const italicMatch = candidate.match(/_([^_\n]+)_$/)
    if (italicMatch) {
      return applyInlineMarkdownMark(editor, italicMatch[0].slice(0, -1), italicMatch[1], 'italic')
    }
  }

  if (nextChar === '`') {
    const codeMatch = candidate.match(/`([^`\n]+)`$/)
    if (codeMatch) {
      return applyInlineMarkdownMark(editor, codeMatch[0].slice(0, -1), codeMatch[1], 'code')
    }
  }

  if (nextChar === '~') {
    const strikeMatch = candidate.match(/~~([^~\n]+)~~$/)
    if (strikeMatch) {
      return applyInlineMarkdownMark(editor, strikeMatch[0].slice(0, -1), strikeMatch[1], 'strike')
    }
  }

  return false
}

function handleMarkdownBlockShortcut(editor: Editor): boolean {
  const { state } = editor
  const { selection } = state
  if (!selection.empty) return false

  const { $from } = selection
  if (!$from.parent.isTextblock) return false

  const marker = $from.parent.textContent.slice(0, $from.parentOffset).trim()
  if (!marker) return false

  const from = $from.start()
  const to = selection.from
  const runBlockCommand = (
    apply: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
  ) => {
    const command = apply(editor.chain().focus().deleteRange({ from, to }).setTextSelection(from))
    const canRun = apply(
      editor.can().chain().deleteRange({ from, to }).setTextSelection(from),
    ).run()
    if (!canRun) return false
    return command.run()
  }

  if (/^#{1,6}$/.test(marker)) {
    return runBlockCommand((chain) =>
      chain.setHeading({ level: Math.min(marker.length, 6) as 1 | 2 | 3 | 4 | 5 | 6 }),
    )
  }

  if (/^[-+*]$/.test(marker)) {
    return runBlockCommand((chain) => chain.toggleBulletList())
  }

  if (/^\d+\.$/.test(marker)) {
    return runBlockCommand((chain) => chain.toggleOrderedList())
  }

  if (marker === '>') {
    return runBlockCommand((chain) => chain.toggleBlockquote())
  }

  return false
}

function getActiveBlockId(editor: {
  state: {
    selection: {
      $anchor: {
        parent: { attrs: { nodeId?: string } }
      }
    }
  }
}): string | null {
  return editor.state.selection.$anchor.parent.attrs.nodeId ?? null
}

function reportSelectionState(
  editor: {
    state: {
      selection: {
        from: number
        to: number
        $anchor: {
          start: () => number
          end: () => number
        }
      }
      doc: { textBetween: (from: number, to: number) => string }
    }
  },
  callbacks: Pick<EchoEditorProps, 'onSelectionChange' | 'onParagraphChange'>,
) {
  const { state } = editor
  const selectedText = state.doc.textBetween(state.selection.from, state.selection.to).trim()
  callbacks.onSelectionChange?.(selectedText)
  const from = state.selection.$anchor.start()
  const to = state.selection.$anchor.end()
  const paragraphText = state.doc.textBetween(from, to)
  callbacks.onParagraphChange?.(paragraphText, from, to)
}

export const EchoEditor = forwardRef<EchoEditorHandle, EchoEditorProps>(function EchoEditor(
  {
    initialContent = '',
    contentVersion = 0,
    onUpdate,
    onActiveBlockChange,
    onContentChange,
    onSave,
    onInspire,
    onSelectionChange,
    onParagraphChange,
  }: EchoEditorProps,
  ref,
) {
  const editorInstanceRef = useRef<Editor | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const linkInputRef = useRef<HTMLInputElement | null>(null)
  const [utilityMode, setUtilityMode] = useState<UtilityMode>(null)
  const [searchQuery, setSearchQueryValue] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [linkValue, setLinkValue] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1)

  const updateSearchUi = useCallback((editor: Editor | null) => {
    if (!editor) {
      setMatchCount(0)
      setActiveMatchIndex(-1)
      return
    }
    const state = getSearchState(editor)
    setMatchCount(state.matches.length)
    setActiveMatchIndex(state.activeIndex)
  }, [])

  const openFind = useCallback(() => {
    setUtilityMode('find')
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const openReplace = useCallback(() => {
    setUtilityMode('replace')
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  const openLinkEditor = useCallback((editor?: Editor | null) => {
    const activeEditor = editor ?? editorInstanceRef.current
    setLinkValue(syncLinkDraft(activeEditor))
    setUtilityMode('link')
    requestAnimationFrame(() => linkInputRef.current?.focus())
  }, [])

  const closeUtility = useCallback(() => {
    setUtilityMode(null)
  }, [])

  const handleContentUpdate = useCallback(
    ({
      editor,
    }: {
      editor: {
        getText: () => string
        getHTML: () => string
        state: {
          selection: {
            from: number
            to: number
            $anchor: {
              parent: { attrs: { nodeId?: string } }
              start: () => number
              end: () => number
            }
          }
          doc: { textBetween: (from: number, to: number) => string }
        }
      }
    }) => {
      const nodeId = getActiveBlockId(editor)
      onUpdate?.(editor.getText(), nodeId)
      onActiveBlockChange?.(nodeId)
      onContentChange?.(editor.getHTML())
      reportSelectionState(editor, { onSelectionChange, onParagraphChange })
    },
    [onActiveBlockChange, onContentChange, onParagraphChange, onSelectionChange, onUpdate],
  )

  const handleSelectionUpdate = useCallback(
    ({
      editor,
    }: {
      editor: {
        state: {
          selection: {
            from: number
            to: number
            $anchor: {
              parent: { attrs: { nodeId?: string } }
              start: () => number
              end: () => number
            }
          }
          doc: { textBetween: (from: number, to: number) => string }
        }
      }
    }) => {
      onActiveBlockChange?.(getActiveBlockId(editor))
      reportSelectionState(editor, { onSelectionChange, onParagraphChange })
    },
    [onActiveBlockChange, onParagraphChange, onSelectionChange],
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            return '无题'
          }
          return '在此处开始写作...'
        },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          target: '_blank',
          rel: 'noreferrer noopener',
        },
      }),
      Underline,
      SearchReplaceExtension,
      NodeIdExtension,
    ],
    content: initialContent || undefined,
    editorProps: {
      attributes: {
        class:
          'prose prose-lg max-w-none focus:outline-none text-[1.125rem] leading-[1.95] tracking-[0.01em] text-[var(--color-ink)]',
      },
      handleTextInput: (_view, _from, _to, text) => {
        const activeEditor = editorInstanceRef.current
        if (!activeEditor) return false
        return handleMarkdownTextInput(activeEditor, text)
      },
      handleKeyDown: (_view, event) => {
        const activeEditor = editorInstanceRef.current
        if (!activeEditor) return false

        if (event.ctrlKey && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSave?.()
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          openFind()
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'h') {
          event.preventDefault()
          openReplace()
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          openLinkEditor(activeEditor)
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'b') {
          event.preventDefault()
          activeEditor.chain().focus().toggleBold().run()
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'i') {
          event.preventDefault()
          activeEditor.chain().focus().toggleItalic().run()
          return true
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'u') {
          event.preventDefault()
          activeEditor.chain().focus().toggleUnderline().run()
          return true
        }
        if (event.ctrlKey && event.altKey && ['1', '2', '3'].includes(event.key)) {
          event.preventDefault()
          activeEditor
            .chain()
            .focus()
            .setHeading({ level: Number(event.key) as 1 | 2 | 3 })
            .run()
          return true
        }
        if (event.ctrlKey && event.shiftKey && event.key === '7') {
          event.preventDefault()
          activeEditor.chain().focus().toggleOrderedList().run()
          return true
        }
        if (event.ctrlKey && event.shiftKey && event.key === '8') {
          event.preventDefault()
          activeEditor.chain().focus().toggleBulletList().run()
          return true
        }
        if (event.ctrlKey && event.shiftKey && event.key === '9') {
          event.preventDefault()
          activeEditor.chain().focus().toggleBlockquote().run()
          return true
        }
        if (event.key === 'Tab') {
          const didChange = event.shiftKey
            ? activeEditor.chain().focus().liftListItem('listItem').run()
            : activeEditor.chain().focus().sinkListItem('listItem').run()
          if (didChange) {
            event.preventDefault()
            return true
          }
        }
        if (event.altKey && event.key.toLowerCase() === 'i') {
          event.preventDefault()
          onInspire?.()
          return true
        }
        if (event.key === ' ' && handleMarkdownBlockShortcut(activeEditor)) {
          event.preventDefault()
          return true
        }
        if (event.key === 'Escape' && utilityMode) {
          event.preventDefault()
          closeUtility()
          return true
        }
        return false
      },
    },
    onUpdate: handleContentUpdate,
    onSelectionUpdate: handleSelectionUpdate,
  })

  const hasReportedInitialContent = useRef(false)

  useEffect(() => {
    editorInstanceRef.current = editor
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      focusBlock(blockId: string) {
        if (!editor || editor.isDestroyed || !blockId) return false

        let position: number | null = null
        editor.state.doc.descendants((node, pos) => {
          if ((node.attrs as { nodeId?: string } | undefined)?.nodeId === blockId) {
            position = pos + 1
            return false
          }
          return true
        })

        if (position === null) return false

        editor.chain().focus(position).setTextSelection(position).run()
        requestAnimationFrame(() => {
          const element = editor.view.dom.querySelector(
            `[data-node-id="${escapeNodeId(blockId)}"]`,
          ) as HTMLElement | null
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
        return true
      },
      getParagraphViewportMetrics(from: number, to: number) {
        if (!editor || editor.isDestroyed) return null
        try {
          const safeFrom = Math.max(1, Math.min(from, editor.state.doc.content.size))
          const safeTo = Math.max(safeFrom, Math.min(to, editor.state.doc.content.size))
          const start = editor.view.coordsAtPos(safeFrom)
          const end = editor.view.coordsAtPos(safeTo)
          return {
            top: start.top,
            bottom: Math.max(start.bottom, end.bottom),
          }
        } catch {
          return null
        }
      },
      openFind,
      openReplace,
      openLinkEditor: () => openLinkEditor(editor),
    }),
    [editor, openFind, openReplace, openLinkEditor],
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!hasReportedInitialContent.current) {
      hasReportedInitialContent.current = true
      onContentChange?.(editor.getHTML())
    }
  }, [editor, onContentChange])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const nextContent = initialContent || ''
    if (editor.getHTML() === nextContent) return
    editor.commands.setContent(nextContent, { emitUpdate: false })
  }, [contentVersion, editor, initialContent])

  useEffect(() => {
    if (!editor) return
    const handleTransaction = () => {
      updateSearchUi(editor)
    }
    editor.on('transaction', handleTransaction)
    handleTransaction()
    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor, updateSearchUi])

  useEffect(() => {
    if (!editor) return

    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return
      const modifierPressed = event.ctrlKey || event.metaKey
      if (!modifierPressed) return

      const key = event.key.toLowerCase()
      if (!['f', 'h', 'k'].includes(key)) return

      const target = event.target as HTMLElement | null
      const isEditorTarget = !!target?.closest('.ProseMirror')
      const isUtilityTarget =
        target === searchInputRef.current ||
        target === replaceInputRef.current ||
        target === linkInputRef.current
      const isTypingIntoAnotherField =
        !isEditorTarget &&
        !isUtilityTarget &&
        (target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          Boolean(target?.closest('[contenteditable="true"]')))

      if (isTypingIntoAnotherField) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (key === 'f') {
        openFind()
        return
      }
      if (key === 'h') {
        openReplace()
        return
      }
      openLinkEditor(editor)
    }

    window.addEventListener('keydown', handleGlobalShortcut, true)
    document.addEventListener('keydown', handleGlobalShortcut, true)
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcut, true)
      document.removeEventListener('keydown', handleGlobalShortcut, true)
    }
  }, [editor, openFind, openLinkEditor, openReplace])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQueryValue(value)
      if (!editor) return
      setSearchQuery(editor, value)
      updateSearchUi(editor)
      if (value.trim()) {
        requestAnimationFrame(() => activateSearchMatch(editor, 0, { focusEditor: false }))
      }
    },
    [editor, updateSearchUi],
  )

  const handleReplaceCurrent = useCallback(() => {
    if (!editor) return
    replaceCurrentSearchMatch(editor, replaceValue, { focusEditor: false })
    updateSearchUi(editor)
  }, [editor, replaceValue, updateSearchUi])

  const handleReplaceAll = useCallback(() => {
    if (!editor) return
    replaceAllSearchMatches(editor, replaceValue)
    updateSearchUi(editor)
  }, [editor, replaceValue, updateSearchUi])

  const handleApplyLink = useCallback(() => {
    if (!editor) return
    const href = normalizeUrl(linkValue)
    if (!href) {
      editor.chain().focus().unsetLink().run()
      closeUtility()
      return
    }

    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${href}" target="_blank" rel="noreferrer noopener">${href}</a>`)
        .run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({
          href,
          target: '_blank',
          rel: 'noreferrer noopener',
        })
        .run()
    }
    closeUtility()
  }, [closeUtility, editor, linkValue])

  return (
    <div className="echo-editor-shell w-full min-h-[50vh]">
      {(utilityMode === 'find' || utilityMode === 'replace') && (
        <div className="mb-4 flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-border)]/45 pb-2.5 text-[0.8rem] text-[var(--color-ink-light)]">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="搜索当前文档"
            className="min-w-[220px] flex-1 border-none bg-transparent px-0 py-0.5 text-[0.92rem] text-[var(--color-ink)] outline-none shadow-none placeholder:text-[var(--color-ink-faint)]"
          />
          <span className="text-[0.72rem] text-[var(--color-ink-faint)]">Esc</span>
          <span className="text-[0.78rem] text-[var(--color-ink-faint)]">
            {matchCount === 0 ? '无匹配' : `${Math.max(activeMatchIndex + 1, 1)}/${matchCount}`}
          </span>
          <button
            type="button"
            onClick={() => editor && moveToAdjacentSearchMatch(editor, -1, { focusEditor: false })}
            className="border-none bg-transparent px-0 py-1 shadow-none transition-colors hover:text-[var(--color-ink)]"
          >
            上一个
          </button>
          <button
            type="button"
            onClick={() => editor && moveToAdjacentSearchMatch(editor, 1, { focusEditor: false })}
            className="border-none bg-transparent px-0 py-1 shadow-none transition-colors hover:text-[var(--color-ink)]"
          >
            下一个
          </button>
          {utilityMode === 'replace' && (
            <>
              <input
                ref={replaceInputRef}
                type="text"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                placeholder="替换为"
                className="min-w-[180px] flex-1 border-none bg-transparent px-0 py-0.5 text-[0.92rem] text-[var(--color-ink)] outline-none shadow-none placeholder:text-[var(--color-ink-faint)]"
              />
              <button
                type="button"
                onClick={handleReplaceCurrent}
                className="border-none bg-transparent px-0 py-1 shadow-none transition-colors hover:text-[var(--color-ink)]"
              >
                替换当前
              </button>
              <button
                type="button"
                onClick={handleReplaceAll}
                className="border-none bg-transparent px-0 py-1 shadow-none transition-colors hover:text-[var(--color-ink)]"
              >
                全部替换
              </button>
            </>
          )}
        </div>
      )}

      {utilityMode === 'link' && (
        <div className="mb-4 flex w-full flex-wrap items-center gap-4 border-b border-[var(--color-border)]/45 pb-2.5 text-[0.8rem] text-[var(--color-ink-light)]">
          <input
            ref={linkInputRef}
            type="text"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            placeholder="输入链接地址"
            className="min-w-[260px] flex-1 border-none bg-transparent px-0 py-0.5 text-[0.92rem] text-[var(--color-ink)] outline-none shadow-none placeholder:text-[var(--color-ink-faint)]"
          />
          <span className="text-[0.72rem] text-[var(--color-ink-faint)]">Esc</span>
          <button
            type="button"
            onClick={handleApplyLink}
            className="border-none bg-transparent px-0 py-1 shadow-none transition-colors hover:text-[var(--color-ink)]"
          >
            应用链接
          </button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  )
})
