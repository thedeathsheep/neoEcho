'use client'

import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { NodeIdExtension } from './node-id-extension'

export interface EchoEditorHandle {
  focusBlock: (blockId: string) => boolean
}

interface EchoEditorProps {
  initialContent?: string
  contentVersion?: number
  onUpdate?: (text: string, blockId: string | null) => void
  onContentChange?: (html: string) => void
  onSave?: () => void
  onInspire?: () => void
  /** Called when selection changes; provides selected text for e.g. sensory zoom. */
  onSelectionChange?: (selectedText: string) => void
  /** Called when user triggers sensory zoom (e.g. Alt+Z). Page should run zoom with current selection. */
  onSensoryZoom?: () => void
  /** Called when cursor/selection moves; provides current paragraph text and doc positions for cliché detection. */
  onParagraphChange?: (paragraphText: string, from: number, to: number) => void
}

function escapeNodeId(blockId: string): string {
  return blockId.replace(/["\\]/g, '\\$&')
}

export const EchoEditor = forwardRef<EchoEditorHandle, EchoEditorProps>(function EchoEditor({
  initialContent = '',
  contentVersion = 0,
  onUpdate,
  onContentChange,
  onSave,
  onInspire,
  onSelectionChange,
  onSensoryZoom,
  onParagraphChange,
}: EchoEditorProps, ref) {
  const handleUpdate = useCallback(
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
      const { state } = editor
      const nodeId = state.selection.$anchor.parent.attrs.nodeId ?? null
      onUpdate?.(editor.getText(), nodeId)
      onContentChange?.(editor.getHTML())
      const selectedText = state.doc.textBetween(state.selection.from, state.selection.to).trim()
      onSelectionChange?.(selectedText)
      const from = state.selection.$anchor.start()
      const to = state.selection.$anchor.end()
      const paragraphText = state.doc.textBetween(from, to)
      onParagraphChange?.(paragraphText, from, to)
    },
    [onUpdate, onContentChange, onSelectionChange, onParagraphChange],
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
          return '在此处开始游荡…'
        },
      }),
      NodeIdExtension,
    ],
    content: initialContent || undefined,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none text-xl leading-[2] text-[var(--color-ink)]',
      },
      handleKeyDown: (_view, event) => {
        if (event.ctrlKey && event.key === 's') {
          event.preventDefault()
          onSave?.()
          return true
        }
        if (event.altKey && event.key.toLowerCase() === 'i') {
          event.preventDefault()
          onInspire?.()
          return true
        }
        if (event.altKey && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          onSensoryZoom?.()
          return true
        }
        return false
      },
    },
    onUpdate: handleUpdate,
    onSelectionUpdate: handleUpdate,
  })

  // Track if initial content has been reported to prevent unnecessary updates
  const hasReportedInitialContent = useRef(false)

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
    }),
    [editor],
  )

  useEffect(() => {
    if (editor && !editor.isDestroyed && !hasReportedInitialContent.current) {
      hasReportedInitialContent.current = true
      // Only report content change (for save), don't trigger ribbon update
      onContentChange?.(editor.getHTML())
    }
  }, [editor, onContentChange])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const nextContent = initialContent || ''
    if (editor.getHTML() === nextContent) return
    editor.commands.setContent(nextContent, { emitUpdate: false })
  }, [contentVersion, editor, initialContent])

  return (
    <div className="w-full max-w-2xl mx-auto min-h-[50vh]">
      <EditorContent editor={editor} />
    </div>
  )
})
