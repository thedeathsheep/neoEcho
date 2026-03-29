'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { documentStorage } from '@/lib/document-storage'

interface DocumentMeta {
  id: string
  title: string
  updatedAt: string
}

interface DocumentPanelProps {
  currentDocumentId: string | null
  onOpenDocument: (id: string) => void
  onNewDocument: () => void
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso)
    const now = new Date()
    const sameDay =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()

    if (sameDay) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    return date.toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function DocumentPanel({
  currentDocumentId,
  onOpenDocument,
  onNewDocument,
}: DocumentPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [_listVersion, setListVersion] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const docs = documentStorage.list() as DocumentMeta[]

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('keydown', handleEscape, true)
    }
  }, [isOpen])

  const currentDoc = docs.find((doc) => doc.id === currentDocumentId) ?? docs[0] ?? null

  const handleNew = () => {
    onNewDocument()
    setListVersion((version) => version + 1)
    setIsOpen(false)
    toast.success('已新建文稿')
  }

  const handleOpen = (id: string) => {
    if (id === currentDocumentId) {
      setIsOpen(false)
      return
    }
    onOpenDocument(id)
    setIsOpen(false)
    toast.success('已切换文稿')
  }

  const handleDelete = (id: string, title: string) => {
    if (docs.length <= 1) {
      toast.error('至少保留一篇文稿')
      return
    }
    if (!confirm(`确定删除《${title || '未命名文稿'}》吗？`)) return

    if (documentStorage.delete(id)) {
      setListVersion((version) => version + 1)
      if (id === currentDocumentId) {
        const remaining = documentStorage.list()
        if (remaining.length > 0) {
          onOpenDocument(remaining[0].id)
        } else {
          onNewDocument()
        }
      }
      toast.success('已删除文稿')
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-transparent bg-transparent px-1 py-0.5 text-left transition-[border-color,background-color,color] hover:border-[var(--color-border)]/75 hover:bg-[var(--color-ink)]/[0.02]"
        title="文稿"
      >
        <span className="text-[0.74rem] text-[var(--color-ink-faint)]">文稿</span>
        <span className="text-[0.82rem] text-[var(--color-ink)]">
          {currentDoc ? `最近编辑 ${formatDate(currentDoc.updatedAt)}` : '打开列表'}
        </span>
        <span className="rounded-full bg-[var(--color-ink)]/[0.045] px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-faint)]">
          {docs.length}
        </span>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            className="absolute left-0 top-[calc(100%+8px)] z-50 flex w-[300px] max-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-[20px] border border-[var(--color-border)]/65 bg-[var(--color-paper)]/98 shadow-[0_10px_26px_rgba(15,23,42,0.06)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)]/45 px-4 py-3">
              <div>
                <h3 className="text-[0.92rem] font-medium text-[var(--color-ink)]">文稿</h3>
                <p className="mt-0.5 text-[0.76rem] text-[var(--color-ink-faint)]">本地自动保存</p>
              </div>
              <button
                type="button"
                onClick={handleNew}
                className="text-[0.8rem] text-[var(--color-ink-light)] transition-colors hover:text-[var(--color-ink)]"
              >
                新建
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {docs.length === 0 ? (
                <div className="px-4 py-8 text-center text-[0.88rem] text-[var(--color-ink-faint)]">
                  暂无文稿
                </div>
              ) : (
                <ul className="space-y-1">
                  {docs.map((doc) => {
                    const isCurrent = doc.id === currentDocumentId
                    return (
                      <li key={doc.id}>
                        <div
                          className={`flex items-center justify-between gap-3 rounded-[18px] px-3 py-2.5 transition-[background-color,opacity] ${
                            isCurrent
                              ? 'bg-[var(--color-ink)]/[0.035] opacity-100'
                              : 'opacity-78 hover:bg-[var(--color-ink)]/[0.02] hover:opacity-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpen(doc.id)}
                            className="min-w-0 flex-1 border-none bg-transparent text-left"
                          >
                            <div className="truncate text-[0.92rem] text-[var(--color-ink)]">
                              {doc.title || '未命名'}
                            </div>
                            <div className="mt-0.5 text-[0.74rem] text-[var(--color-ink-faint)]">
                              {formatDate(doc.updatedAt)}
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            {isCurrent ? (
                              <span className="text-[0.72rem] text-[var(--color-accent)]">
                                当前
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleDelete(doc.id, doc.title)}
                              disabled={docs.length <= 1}
                              className="text-[0.76rem] text-[var(--color-ink-faint)] transition-colors hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
