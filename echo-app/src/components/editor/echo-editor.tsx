'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useCallback, useEffect, useRef } from 'react'

import { NodeIdExtension } from './node-id-extension'

interface EchoEditorProps {
  initialContent?: string
  onUpdate?: (text: string, blockId: string | null) => void
  onContentChange?: (html: string) => void
  onSave?: () => void
  onInspire?: () => void
}

export function EchoEditor({
  initialContent = '',
  onUpdate,
  onContentChange,
  onSave,
  onInspire,
}: EchoEditorProps) {
  const handleUpdate = useCallback(
    ({
      editor,
    }: {
      editor: {
        getText: () => string
        getHTML: () => string
        state: { selection: { $anchor: { parent: { attrs: { nodeId?: string } } } } }
      }
    }) => {
      const nodeId = editor.state.selection.$anchor.parent.attrs.nodeId ?? null
      onUpdate?.(editor.getText(), nodeId)
      onContentChange?.(editor.getHTML())
    },
    [onUpdate, onContentChange],
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
        return false
      },
    },
    onUpdate: handleUpdate,
    onSelectionUpdate: handleUpdate,
  })

  // Track if initial content has been reported to prevent unnecessary updates
  const hasReportedInitialContent = useRef(false)

  useEffect(() => {
    if (editor && !editor.isDestroyed && !hasReportedInitialContent.current) {
      hasReportedInitialContent.current = true
      const nodeId = editor.state.selection.$anchor.parent.attrs.nodeId ?? null
      onUpdate?.(editor.getText(), nodeId)
    }
  }, [editor, onUpdate])

  return (
    <div className="w-full max-w-3xl mx-auto px-8 min-h-[50vh]">
      <EditorContent editor={editor} />
    </div>
  )
}
