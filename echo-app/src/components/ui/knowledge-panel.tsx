'use client'

import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  getKnowledgeStats,
  type KnowledgeBase,
  knowledgeBaseService,
  type KnowledgeFile,
  selectFiles,
} from '@/services/knowledge-base.service'

type AiStatus = 'idle' | 'unconfigured' | 'loading' | 'connected' | 'error'

interface KnowledgePanelProps {
  aiStatus?: AiStatus
}

interface KnowledgePanelStats {
  fileCount: number
  chunkCount: number
  totalChars: number
  baseCount: number
}

function getInitialKnowledgePanelState(): {
  activeBase: KnowledgeBase | null
  files: KnowledgeFile[]
  stats: KnowledgePanelStats
} {
  const activeBase = knowledgeBaseService.getActive()
  const files = activeBase?.files ?? []

  return {
    activeBase,
    files,
    stats: {
      fileCount: files.length,
      chunkCount: files.reduce((sum, file) => sum + file.totalChunks, 0),
      totalChars: files.reduce((sum, file) => sum + file.totalChars, 0),
      baseCount: knowledgeBaseService.getAll().length,
    },
  }
}

function getAiStatusLabel(status: AiStatus): string {
  if (status === 'loading') return '生成中'
  if (status === 'connected') return '已连接'
  if (status === 'error') return '连接异常'
  if (status === 'unconfigured') return '待配置'
  return '待机'
}

export function KnowledgePanel({ aiStatus = 'idle' }: KnowledgePanelProps) {
  const [activeBase, setActiveBase] = useState<KnowledgeBase | null>(
    () => getInitialKnowledgePanelState().activeBase,
  )
  const [files, setFiles] = useState<KnowledgeFile[]>(() => getInitialKnowledgePanelState().files)
  const [stats, setStats] = useState<KnowledgePanelStats>(
    () => getInitialKnowledgePanelState().stats,
  )
  const [isImporting, setIsImporting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

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
    return () => window.removeEventListener('knowledge-base-updated', handleUpdate)
  }, [refreshStats])

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

  const handleImport = async () => {
    const base = knowledgeBaseService.getActive()
    if (!base) {
      toast.error('请先创建一个共鸣库')
      return
    }

    setIsImporting(true)
    const onEmbeddingSkipped = () => {
      toast.warning('文件已导入，但向量生成失败，织带会退回关键词检索')
    }

    window.addEventListener('embedding-skipped', onEmbeddingSkipped)
    const ocrToastId = `ocr-import-${Date.now()}`
    let ocrFailed = false

    const onOcrStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ fileName: string; totalPages: number }>).detail
      toast.loading(`正在 OCR 提取文字 · ${detail.fileName}（1/${detail.totalPages} 页）`, {
        id: ocrToastId,
      })
    }

    const onOcrProgress = (event: Event) => {
      const detail = (
        event as CustomEvent<{ fileName: string; currentPage: number; totalPages: number }>
      ).detail
      toast.loading(
        `正在 OCR 提取文字 · ${detail.fileName}（${detail.currentPage}/${detail.totalPages} 页）`,
        { id: ocrToastId },
      )
    }

    const onOcrFinished = (event: Event) => {
      const detail = (
        event as CustomEvent<{ fileName: string; extractedPages: number; totalPages: number }>
      ).detail
      toast.success(
        `OCR 提取完成 · ${detail.fileName}（${detail.extractedPages}/${detail.totalPages} 页）`,
        { id: ocrToastId },
      )
    }

    const onOcrFailed = (event: Event) => {
      ocrFailed = true
      const detail = (event as CustomEvent<{ message: string }>).detail
      toast.error(detail.message || 'OCR 提取失败', { id: ocrToastId })
    }

    window.addEventListener('ocr-started', onOcrStarted)
    window.addEventListener('ocr-progress', onOcrProgress)
    window.addEventListener('ocr-finished', onOcrFinished)
    window.addEventListener('ocr-failed', onOcrFailed)

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
      if (!ocrFailed) {
        toast.error(error instanceof Error ? error.message : '导入文件失败')
      }
      console.error(error)
    } finally {
      setIsImporting(false)
      window.removeEventListener('embedding-skipped', onEmbeddingSkipped)
      window.removeEventListener('ocr-started', onOcrStarted)
      window.removeEventListener('ocr-progress', onOcrProgress)
      window.removeEventListener('ocr-finished', onOcrFinished)
      window.removeEventListener('ocr-failed', onOcrFailed)
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

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-transparent bg-transparent px-1 py-0.5 text-left transition-[border-color,background-color,color] hover:border-[var(--color-border)]/75 hover:bg-[var(--color-ink)]/[0.02]"
        title="共鸣库"
      >
        <span className="text-[0.74rem] text-[var(--color-ink-faint)]">共鸣库</span>
        <span className="max-w-[13rem] truncate text-[0.82rem] text-[var(--color-ink)]">
          {activeBase?.name || '未选择'}
        </span>
        <span className="rounded-full bg-[var(--color-ink)]/[0.045] px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-faint)]">
          {stats.fileCount > 0 ? `${stats.fileCount}` : getAiStatusLabel(aiStatus)}
        </span>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[344px] max-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-[20px] border border-[var(--color-border)]/65 bg-[var(--color-paper)]/98 shadow-[0_10px_26px_rgba(15,23,42,0.06)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)]/45 px-4 py-3">
              <div>
                <h3 className="text-[0.92rem] font-medium text-[var(--color-ink)]">
                  {activeBase?.name || '共鸣库'}
                </h3>
                <p className="mt-0.5 text-[0.76rem] text-[var(--color-ink-faint)]">
                  AI {getAiStatusLabel(aiStatus)}
                  {stats.baseCount > 1 ? ` · 共 ${stats.baseCount} 个库` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[0.8rem] text-[var(--color-ink-light)] transition-colors hover:text-[var(--color-ink)]"
              >
                收起
              </button>
            </div>

            <div className="px-4 py-2 text-[0.76rem] leading-6 text-[var(--color-ink-faint)]">
              {stats.fileCount} 文件 · {stats.chunkCount} 片段 ·{' '}
              {Math.round(stats.totalChars / 1000)}K 字符
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {files.length === 0 ? (
                <div className="px-4 py-6 text-[0.86rem] text-[var(--color-ink-faint)]">
                  还没有导入文件
                  <div className="mt-1 text-[0.74rem]">支持 PDF、Markdown、TXT</div>
                </div>
              ) : (
                <div className="space-y-1">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 transition-[background-color,opacity] hover:bg-[var(--color-ink)]/[0.02] hover:opacity-100"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[0.9rem] text-[var(--color-ink)]">
                          {file.fileName}
                        </div>
                        <div className="mt-0.5 text-[0.74rem] text-[var(--color-ink-faint)]">
                          {file.totalChunks} 片段 · {Math.round(file.totalChars / 1000)}K 字符
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(file.id)}
                        className="text-[0.76rem] text-[var(--color-ink-faint)] transition-colors hover:text-red-500"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-[var(--color-border)]/50 px-4 py-3">
              <button
                type="button"
                onClick={handleImport}
                disabled={isImporting || !activeBase}
                className="text-[0.82rem] text-[var(--color-ink)] transition-opacity hover:opacity-70 disabled:opacity-40"
              >
                {isImporting ? '导入中...' : '导入文件'}
              </button>
              <Link
                href="/settings"
                className="text-[0.8rem] text-[var(--color-ink-light)] transition-colors hover:text-[var(--color-ink)]"
                onClick={() => setIsOpen(false)}
              >
                {activeBase ? '设置' : '创建'}
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
