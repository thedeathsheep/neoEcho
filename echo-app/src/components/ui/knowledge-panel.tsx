'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'

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

function getAiStatusLabel(status: AiStatus): string {
  if (status === 'loading') return '正在生成'
  if (status === 'connected') return '已连接'
  if (status === 'error') return '连接异常'
  if (status === 'unconfigured') return '待配置'
  return '待机'
}

function AiStatusDot({ status }: { status: AiStatus }) {
  if (status === 'idle' || status === 'unconfigured') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-accent)]"
        title="AI 待配置"
      />
    )
  }
  if (status === 'loading') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-yellow-400 animate-pulse"
        title="AI 正在生成"
      />
    )
  }
  if (status === 'connected') {
    return (
      <span
        className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500"
        title="AI 已连接"
      />
    )
  }
  return (
    <span
      className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-red-400"
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
      toast.warning('文件已导入，但本地向量生成失败，织带将退回关键词检索')
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
          toast.info('没有导入新文件，可能已经存在')
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
      <div className="flex flex-col gap-2">
        <Link
          href="/settings"
          className="group relative flex min-w-[172px] items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/92 px-4 py-3 shadow-sm backdrop-blur transition-all hover:border-[var(--color-ink-faint)] hover:bg-[var(--color-paper)]"
          title="设置"
        >
          <div className="min-w-0 text-left">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">模型</div>
            <div className="mt-1 text-sm font-medium text-[var(--color-ink)]">{getAiStatusLabel(aiStatus)}</div>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] px-2.5 py-1 text-[11px] text-[var(--color-ink-light)] transition-colors group-hover:text-[var(--color-ink)]">
            设置
          </span>
          <AiStatusDot status={aiStatus} />
        </Link>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex min-w-[172px] items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/92 px-4 py-3 text-left shadow-sm backdrop-blur transition-all hover:border-[var(--color-ink-faint)] hover:bg-[var(--color-paper)]"
          title="共鸣库"
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">共鸣库</div>
            <div className="mt-1 truncate text-sm font-medium text-[var(--color-ink)]">
              {activeBase?.name || '尚未选择'}
            </div>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] px-2.5 py-1 text-[11px] text-[var(--color-ink-light)]">
            {stats.fileCount} 文件
          </span>
        </button>
      </div>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed top-6 right-20 z-[60] flex max-h-[calc(100vh-3rem)] w-80 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 shadow-lg backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--color-ink)]">
              {activeBase?.name || '共鸣库'}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-ink-faint)]">
              {stats.baseCount > 1 && <span>共 {stats.baseCount} 个库</span>}
              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
                AI {getAiStatusLabel(aiStatus)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="text-xs text-[var(--color-ink-faint)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              onClick={() => setIsOpen(false)}
            >
              管理
            </Link>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
              ×
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-[var(--color-border)] px-4 py-3 text-center">
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">{stats.fileCount}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">文件</div>
          </div>
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">{stats.chunkCount}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">片段</div>
          </div>
          <div>
            <div className="text-lg font-medium text-[var(--color-ink)]">{Math.round(stats.totalChars / 1000)}K</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">字符</div>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {files.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
              还没有导入文件
              <br />
              <span className="mt-1 block text-xs">支持 PDF、Markdown、TXT</span>
            </div>
          ) : (
            <>
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group border-b border-[var(--color-border)] px-4 py-3 last:border-0"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[var(--color-ink)]">{file.fileName}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">
                        {file.totalChunks} 片段 · {Math.round(file.totalChars / 1000)}K 字符
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(file.id)}
                      className="ml-2 opacity-0 transition-all group-hover:opacity-100 text-[var(--color-ink-faint)] hover:text-red-500"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {activeBase && activeBase.mandatoryBooks.length > 0 && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-ink)]/5 px-4 py-2">
            <p className="text-xs text-[var(--color-ink-light)]">
              强制检索 {activeBase.mandatoryBooks.length} 本
            </p>
          </div>
        )}

        <div className="flex gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={handleImport}
            disabled={isImporting || !activeBase}
            className="flex-1 rounded-lg bg-[var(--color-btn-primary-bg)] px-3 py-2 text-sm text-[var(--color-btn-primary-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isImporting ? '导入中…' : '导入文件'}
          </button>
          {!activeBase && (
            <Link
              href="/settings"
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-ink-light)] transition-colors hover:text-[var(--color-ink)]"
              onClick={() => setIsOpen(false)}
            >
              创建
            </Link>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
