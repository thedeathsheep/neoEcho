'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import Link from 'next/link'

import {
  selectFiles,
  knowledgeBaseService,
  getKnowledgeStats,
  type KnowledgeFile,
  type KnowledgeBase,
} from '@/services/knowledge-base.service'

type AiStatus = 'idle' | 'unconfigured' | 'loading' | 'connected' | 'error'

interface KnowledgePanelProps {
  aiStatus?: AiStatus
}

function AiStatusDot({ status }: { status: AiStatus }) {
  if (status === 'idle' || status === 'unconfigured') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--color-accent)] border-2 border-[var(--color-surface)]"
        title="AI 未配置"
      />
    )
  }
  if (status === 'loading') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-yellow-400 border-2 border-white animate-pulse"
        title="AI 请求中"
      />
    )
  }
  if (status === 'connected') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-white"
        title="AI 已连接"
      />
    )
  }
  return (
    <span
      className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-400 border-2 border-white"
      title="AI 连接异常"
    />
  )
}

export function KnowledgePanel({ aiStatus = 'idle' }: KnowledgePanelProps) {
  const [activeBase, setActiveBase] = useState<KnowledgeBase | null>(null)
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [stats, setStats] = useState({
    fileCount: 0,
    chunkCount: 0,
    totalChars: 0,
    baseCount: 0,
  })
  const [isImporting, setIsImporting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const refreshStats = useCallback(async () => {
    const base = knowledgeBaseService.getActive()
    setActiveBase(base)
    setFiles(base?.files || [])

    const [activeStats, globalStats] = await Promise.all([
      getKnowledgeStats(base?.id ?? undefined),
      knowledgeBaseService.getGlobalStats(),
    ])
    setStats({
      fileCount: activeStats.fileCount,
      chunkCount: activeStats.chunkCount,
      totalChars: activeStats.totalChars,
      baseCount: globalStats.baseCount,
    })
  }, [])

  useEffect(() => {
    refreshStats()

    const handleUpdate = () => refreshStats()
    window.addEventListener('knowledge-base-updated', handleUpdate)
    return () => {
      window.removeEventListener('knowledge-base-updated', handleUpdate)
    }
  }, [refreshStats])

  const handleImport = async () => {
    const base = knowledgeBaseService.getActive()
    if (!base) {
      toast.error('请先创建一个共鸣库')
      return
    }

    setIsImporting(true)
    const onEmbeddingSkipped = () => {
      toast.warning('文件已导入，但本地向量生成失败，织带将仅使用关键词检索')
    }
    window.addEventListener('embedding-skipped', onEmbeddingSkipped)
    try {
      const selected = await selectFiles()
      if (selected.length > 0) {
        const results = await knowledgeBaseService.importFiles(selected, base.id)
        if (results.length > 0) {
          toast.success(`成功导入 ${results.length} 个文件`)
          await refreshStats()
        } else {
          toast.info('未导入任何新文件（可能已存在）')
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入文件失败')
      console.error(error)
    } finally {
      setIsImporting(false)
      window.removeEventListener('embedding-skipped', onEmbeddingSkipped)
    }
  }

  const handleRemove = async (fileId: string) => {
    const base = knowledgeBaseService.getActive()
    if (!base) return

    const removed = await knowledgeBaseService.removeFile(fileId, base.id)
    if (removed) {
      toast.success('文件已移除')
      await refreshStats()
    }
  }

  if (!isOpen) {
    return (
      <>
        <Link
          href="/settings"
          className="relative w-10 h-10 rounded-full bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] shadow-sm flex items-center justify-center text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
          title="设置"
        >
          <span className="text-lg">⚙️</span>
          <AiStatusDot status={aiStatus} />
        </Link>
        <button
          onClick={() => setIsOpen(true)}
          className="w-10 h-10 rounded-full bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] shadow-sm flex items-center justify-center text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
          title="知识库"
        >
          <span className="text-lg">📚</span>
        </button>
      </>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed top-6 right-20 w-80 bg-[var(--color-surface)]/90 backdrop-blur-xl border border-[var(--color-border)] rounded-xl shadow-lg z-[60] overflow-hidden max-h-[calc(100vh-3rem)] flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-[var(--color-ink)]">
              {activeBase?.name || '共鸣库'}
            </h3>
            {stats.baseCount > 1 && (
              <p className="text-[10px] text-[var(--color-ink-faint)]">
                共 {stats.baseCount} 个库
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline underline-offset-2"
              onClick={() => setIsOpen(false)}
            >
              管理
            </Link>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center border-b border-[var(--color-border)]">
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">
              {stats.fileCount}
            </div>
            <div className="text-[10px] text-[var(--color-ink-faint)] uppercase tracking-wider">
              文件
            </div>
          </div>
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">
              {stats.chunkCount}
            </div>
            <div className="text-[10px] text-[var(--color-ink-faint)] uppercase tracking-wider">
              意象
            </div>
          </div>
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">
              {Math.round(stats.totalChars / 1000)}K
            </div>
            <div className="text-[10px] text-[var(--color-ink-faint)] uppercase tracking-wider">
              字符
            </div>
          </div>
        </div>

        {/* File List */}
        <div className="max-h-64 overflow-y-auto">
          {files.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
              还没有导入任何文件
              <br />
              <span className="text-xs mt-1 block">
                支持 PDF、Markdown、TXT
              </span>
            </div>
          ) : (
            <>
              {files.map((file) => (
                <div
                  key={file.id}
                  className="px-4 py-3 border-b border-[var(--color-border)] last:border-0 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--color-ink)] truncate">
                        {file.fileName}
                      </div>
                      <div className="text-[10px] text-[var(--color-ink-faint)] mt-0.5">
                        {file.totalChunks} 意象 · {Math.round(file.totalChars / 1000)}K 字符
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(file.id)}
                      className="ml-2 text-[var(--color-ink-faint)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="删除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Mandatory Books Indicator */}
        {activeBase && activeBase.mandatoryBooks.length > 0 && (
          <div className="px-4 py-2 bg-[var(--color-ink)]/5 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-ink-light)]">
              强制检索：{activeBase.mandatoryBooks.length} 本书
              <span className="text-[10px] text-[var(--color-ink-faint)] ml-1">
                (每次必出)
              </span>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
          <button
            onClick={handleImport}
            disabled={isImporting || !activeBase}
            className="flex-1 px-3 py-2 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] text-sm rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isImporting ? '导入中...' : '导入文件'}
          </button>
          {!activeBase && (
            <Link
              href="/settings"
              className="px-3 py-2 border border-[var(--color-border)] text-sm rounded-lg text-[var(--color-ink-light)] hover:text-[var(--color-ink)] transition-colors"
              onClick={() => setIsOpen(false)}
            >
              创建库
            </Link>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
