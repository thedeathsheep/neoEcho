'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

import { documentStorage } from '@/lib/document-storage'
import { generateId } from '@/lib/utils/crypto'
import type { Document } from '@/types'

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

  const handleNew = () => {
    onNewDocument()
    setIsOpen(false)
    toast.success('已新建文档')
  }

  const handleOpen = (id: string) => {
    if (id === currentDocumentId) {
      setIsOpen(false)
      return
    }
    onOpenDocument(id)
    setIsOpen(false)
    toast.success('已切换文档')
  }

  const handleDelete = (id: string, title: string) => {
    if (docs.length <= 1) {
      toast.error('至少需要保留一个文档')
      return
    }
    if (!confirm(`确定要删除「${title}」吗？`)) return

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
      toast.success('已删除')
    }
  }

  if (!isOpen) {
    return (
      <div className="fixed top-6 left-8 z-[60]">
        <button
          onClick={() => setIsOpen(true)}
          className="w-10 h-10 rounded-full bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] shadow-sm flex items-center justify-center text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
          title="文档管理"
        >
          <span className="text-lg">📄</span>
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
        className="fixed top-6 left-8 w-72 bg-[var(--color-surface)]/90 backdrop-blur-xl border border-[var(--color-border)] rounded-xl shadow-lg z-[60] overflow-hidden max-h-[calc(100vh-3rem)] flex flex-col"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--color-ink)]">
            文档
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-3 border-b border-[var(--color-border)]">
          <button
            onClick={handleNew}
            className="w-full py-2.5 px-3 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] text-sm rounded-lg hover:opacity-90 transition-opacity"
          >
            + 新建文档
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {docs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
              暂无文档
            </div>
          ) : (
            <ul className="py-2">
              {docs.map((doc) => {
                const isCurrent = doc.id === currentDocumentId
                return (
                  <li
                    key={doc.id}
                    className={`group px-4 py-2.5 flex items-center justify-between gap-2 ${
                      isCurrent
                        ? 'bg-[var(--color-ink)]/10'
                        : 'hover:bg-[var(--color-ink)]/10'
                    }`}
                  >
                    <button
                      onClick={() => handleOpen(doc.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm text-[var(--color-ink)] truncate font-medium">
                        {doc.title || '无题'}
                      </div>
                      <div className="text-[10px] text-[var(--color-ink-faint)] mt-0.5">
                        {formatDate(doc.updatedAt)}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isCurrent && (
                        <span className="text-[10px] text-[var(--color-ink)] px-1.5 py-0.5 rounded bg-[var(--color-ink)]/10">
                          当前
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(doc.id, doc.title)}
                        disabled={docs.length <= 1}
                        className="p-1 text-[var(--color-ink-faint)] hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="删除"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-ink-faint)]">
          共 {docs.length} 篇 · 自动保存到本地
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
