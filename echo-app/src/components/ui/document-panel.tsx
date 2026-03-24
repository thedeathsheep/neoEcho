'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
    const d = new Date(iso)
    const now = new Date()
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    if (sameDay) {
      return d.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    return d.toLocaleDateString('zh-CN', {
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
  const [docs, setDocs] = useState<DocumentMeta[]>([])
  const [isOpen, setIsOpen] = useState(false)

  const refreshList = useCallback(() => {
    setDocs(documentStorage.list())
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList, currentDocumentId, isOpen])

  const currentDoc = docs.find((doc) => doc.id === currentDocumentId) ?? docs[0] ?? null

  const handleNew = () => {
    onNewDocument()
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
    if (!confirm(`确定删除「${title || '未命名文稿'}」吗？`)) return

    if (documentStorage.delete(id)) {
      refreshList()
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

  if (!isOpen) {
    return (
      <div className="fixed top-6 left-8 z-[60]">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group flex min-w-[212px] items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/92 px-4 py-3 text-left shadow-sm backdrop-blur transition-all hover:border-[var(--color-ink-faint)] hover:bg-[var(--color-paper)]"
          title="文稿管理"
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">文稿</div>
            <div className="mt-1 truncate text-sm font-medium text-[var(--color-ink)]">
              {currentDoc?.title || '未命名文稿'}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
              {currentDoc ? `最近编辑 ${formatDate(currentDoc.updatedAt)}` : '打开文稿列表'}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] px-2.5 py-1 text-[11px] text-[var(--color-ink-light)] transition-colors group-hover:text-[var(--color-ink)]">
            {docs.length}
          </span>
        </button>
      </div>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="fixed top-6 left-8 z-[60] flex max-h-[calc(100vh-3rem)] w-72 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 shadow-lg backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--color-ink)]">文稿</h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
              共 {docs.length} 篇，本地自动保存
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            ×
          </button>
        </div>

        <div className="border-b border-[var(--color-border)] p-3">
          <button
            type="button"
            onClick={handleNew}
            className="w-full rounded-lg bg-[var(--color-btn-primary-bg)] px-3 py-2.5 text-sm text-[var(--color-btn-primary-text)] transition-opacity hover:opacity-90"
          >
            + 新建文稿
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {docs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
              暂无文稿
            </div>
          ) : (
            <ul className="py-2">
              {docs.map((doc) => {
                const isCurrent = doc.id === currentDocumentId
                return (
                  <li
                    key={doc.id}
                    className={`group flex items-center justify-between gap-2 px-4 py-2.5 ${
                      isCurrent ? 'bg-[var(--color-ink)]/10' : 'hover:bg-[var(--color-ink)]/10'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpen(doc.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-[var(--color-ink)]">
                        {doc.title || '未命名'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">
                        {formatDate(doc.updatedAt)}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {isCurrent && (
                        <span className="rounded bg-[var(--color-ink)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-ink)]">
                          当前
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id, doc.title)}
                        disabled={docs.length <= 1}
                        className="p-1 text-[var(--color-ink-faint)] disabled:cursor-not-allowed disabled:opacity-30 hover:text-red-500"
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
