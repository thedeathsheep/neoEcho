'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  type KnowledgeBase,
  knowledgeBaseService,
  selectFiles,
} from '@/services/knowledge-base.service'

interface KnowledgeBaseManagerProps {
  isOpen: boolean
  onClose: () => void
}

export function KnowledgeBaseManager({ isOpen, onClose }: KnowledgeBaseManagerProps) {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [activeBaseId, setActiveBaseId] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [newBaseName, setNewBaseName] = useState('')
  const [showNewBaseInput, setShowNewBaseInput] = useState(false)
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const refreshData = useCallback(() => {
    const allBases = knowledgeBaseService.getAll()
    const active = knowledgeBaseService.getActive()
    setBases(allBases)
    setActiveBaseId(active?.id || null)
  }, [])

  useEffect(() => {
    if (isOpen) {
      refreshData()
    }
  }, [isOpen, refreshData])

  const handleCreateBase = () => {
    if (!newBaseName.trim()) {
      toast.error('请输入共鸣库名称')
      return
    }

    const newBase = knowledgeBaseService.create(newBaseName.trim())
    if (newBase) {
      toast.success(`创建共鸣库 "${newBase.name}"`)
      setNewBaseName('')
      setShowNewBaseInput(false)
      refreshData()

      // If this is the first base, activate it
      if (bases.length === 0) {
        knowledgeBaseService.setActive(newBase.id)
        setActiveBaseId(newBase.id)
      }
    }
  }

  const handleDeleteBase = async (baseId: string) => {
    const base = bases.find((b) => b.id === baseId)
    if (!base) return

    if (confirm(`确定要删除共鸣库 "${base.name}" 吗？\n库中的所有书籍和意象都将被删除。`)) {
      const deleted = await knowledgeBaseService.delete(baseId)
      if (deleted) {
        toast.success('共鸣库已删除')
        refreshData()
      }
    }
  }

  const handleSetActive = (baseId: string) => {
    if (knowledgeBaseService.setActive(baseId)) {
      setActiveBaseId(baseId)
      toast.success('已切换共鸣库')
    }
  }

  const handleImportFiles = async (baseId: string) => {
    setIsImporting(true)
    const onEmbeddingSkipped = () => {
      toast.warning('文件已导入，但本地向量生成失败，织带将仅使用关键词检索')
    }
    window.addEventListener('embedding-skipped', onEmbeddingSkipped)
    const ocrToastId = `ocr-import-${Date.now()}`
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
        {
          id: ocrToastId,
        },
      )
    }
    const onOcrFinished = (event: Event) => {
      const detail = (
        event as CustomEvent<{ fileName: string; extractedPages: number; totalPages: number }>
      ).detail
      toast.success(
        `OCR 提取完成 · ${detail.fileName}（${detail.extractedPages}/${detail.totalPages} 页）`,
        {
          id: ocrToastId,
        },
      )
    }
    const onOcrFailed = (event: Event) => {
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
        const results = await knowledgeBaseService.importFiles(selected, baseId)
        if (results.length > 0) {
          toast.success(`成功导入 ${results.length} 个文件`)
          refreshData()
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
      window.removeEventListener('ocr-started', onOcrStarted)
      window.removeEventListener('ocr-progress', onOcrProgress)
      window.removeEventListener('ocr-finished', onOcrFinished)
      window.removeEventListener('ocr-failed', onOcrFailed)
    }
  }

  const handleRemoveFile = async (baseId: string, fileId: string) => {
    const removed = await knowledgeBaseService.removeFile(fileId, baseId)
    if (removed) {
      toast.success('文件已移除')
      refreshData()
    }
  }

  const handleToggleMandatory = (baseId: string, fileId: string) => {
    const base = bases.find((b) => b.id === baseId)
    if (!base) return

    const currentMandatory = base.mandatoryBooks || []
    const isMandatory = currentMandatory.includes(fileId)

    let newMandatory: string[]
    if (isMandatory) {
      // Remove from mandatory
      newMandatory = currentMandatory.filter((id) => id !== fileId)
    } else {
      // Add to mandatory (max 3)
      if (currentMandatory.length >= 3) {
        toast.error('最多只能设置3本强制检索书籍')
        return
      }
      newMandatory = [...currentMandatory, fileId]
    }

    try {
      knowledgeBaseService.setMandatoryBooks(baseId, newMandatory)
      refreshData()
      toast.success(isMandatory ? '已取消强制检索' : '已设为强制检索')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleStartEditName = (base: KnowledgeBase) => {
    setEditingBaseId(base.id)
    setEditingName(base.name)
  }

  const handleSaveName = (baseId: string) => {
    if (!editingName.trim()) {
      toast.error('名称不能为空')
      return
    }

    if (knowledgeBaseService.updateName(baseId, editingName.trim())) {
      toast.success('名称已更新')
      setEditingBaseId(null)
      refreshData()
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="text-lg font-medium text-[var(--color-ink)]">共鸣库管理</h2>
            <button
              onClick={onClose}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {bases.length === 0 ? (
              <div className="text-center py-12 text-[var(--color-ink-faint)]">
                <p>还没有创建任何共鸣库</p>
                <p className="text-sm mt-2">点击下方按钮创建第一个共鸣库</p>
              </div>
            ) : (
              bases.map((base) => (
                <div
                  key={base.id}
                  className={`border rounded-lg overflow-hidden ${
                    activeBaseId === base.id
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/5'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  {/* Base Header */}
                  <div className="px-4 py-3 bg-[var(--color-paper)] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {editingBaseId === base.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="px-2 py-1 border rounded text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveName(base.id)
                              if (e.key === 'Escape') setEditingBaseId(null)
                            }}
                          />
                          <button
                            onClick={() => handleSaveName(base.id)}
                            className="text-green-600 text-sm"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingBaseId(null)}
                            className="text-[var(--color-ink-light)] text-sm"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <>
                          <h3 className="font-medium text-[var(--color-ink)]">{base.name}</h3>
                          <button
                            onClick={() => handleStartEditName(base)}
                            className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                          >
                            编辑
                          </button>
                        </>
                      )}
                      {activeBaseId === base.id && (
                        <span className="text-xs px-2 py-0.5 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded">
                          使用中
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {activeBaseId !== base.id && (
                        <button
                          onClick={() => handleSetActive(base.id)}
                          className="text-xs px-3 py-1.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-ink)]/5 transition-colors"
                        >
                          切换到此库
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBase(base.id)}
                        className="text-xs px-3 py-1.5 text-red-500 border border-red-200 rounded hover:bg-red-50 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {/* Mandatory max slots (when any book is mandatory) */}
                  {base.mandatoryBooks && base.mandatoryBooks.length > 0 && (
                    <div className="px-4 py-3 bg-[var(--color-ink)]/5 border-t border-[var(--color-border)] flex items-center justify-between">
                      <span className="text-xs text-[var(--color-ink-light)]">
                        织带中强制书籍最多占
                      </span>
                      <div className="flex gap-1">
                        {([1, 2, 3] as const).map((n) => (
                          <button
                            key={n}
                            onClick={() => {
                              knowledgeBaseService.setMandatoryMaxSlots(base.id, n)
                              refreshData()
                              toast.success(`已设为最多 ${n} 条`)
                            }}
                            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                              (base.mandatoryMaxSlots ?? 1) === n
                                ? 'border-[var(--color-btn-primary-bg)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]'
                                : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)]'
                            }`}
                          >
                            {n} 条
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files List */}
                  <div className="divide-y divide-[var(--color-border)]">
                    {base.files.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">
                        还没有导入任何文件
                      </div>
                    ) : (
                      base.files.map((file) => {
                        const isMandatory = base.mandatoryBooks?.includes(file.id)
                        return (
                          <div
                            key={file.id}
                            className="px-4 py-3 flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isMandatory}
                                onChange={() => handleToggleMandatory(base.id, file.id)}
                                className="w-4 h-4 rounded border-[var(--color-border)]"
                                title="设为强制检索（每次必出）"
                              />
                              <div>
                                <div className="text-sm text-[var(--color-ink)]">
                                  {file.fileName}
                                </div>
                                <div className="text-xs text-[var(--color-ink-faint)]">
                                  {file.totalChunks} 意象 · {Math.round(file.totalChars / 1000)}K
                                  字符
                                  {isMandatory && (
                                    <span className="ml-2 text-[var(--color-ink)] font-medium">
                                      [强制检索]
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveFile(base.id, file.id)}
                              className="text-[var(--color-ink-faint)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              title="删除"
                            >
                              🗑
                            </button>
                          </div>
                        )
                      })
                    )}

                    {/* Import Button */}
                    <div className="px-4 py-3 bg-[var(--color-paper-warm)]">
                      <button
                        onClick={() => handleImportFiles(base.id)}
                        disabled={isImporting}
                        className="text-sm text-[var(--color-ink-light)] hover:text-[var(--color-ink)] flex items-center gap-2"
                      >
                        <span>+</span>
                        {isImporting ? '导入中...' : '导入新书籍'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* Create New Base */}
            <div className="pt-4 border-t border-[var(--color-border)]">
              {!showNewBaseInput ? (
                <button
                  onClick={() => setShowNewBaseInput(true)}
                  className="w-full py-3 border-2 border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink)]/30 transition-colors"
                >
                  + 创建新共鸣库
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newBaseName}
                    onChange={(e) => setNewBaseName(e.target.value)}
                    placeholder="输入共鸣库名称"
                    className="flex-1 px-3 py-2 border rounded-lg"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateBase()
                      if (e.key === 'Escape') {
                        setShowNewBaseInput(false)
                        setNewBaseName('')
                      }
                    }}
                  />
                  <button
                    onClick={handleCreateBase}
                    className="px-4 py-2 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded-lg"
                  >
                    创建
                  </button>
                  <button
                    onClick={() => {
                      setShowNewBaseInput(false)
                      setNewBaseName('')
                    }}
                    className="px-4 py-2 border rounded-lg"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Footer Info */}
          <div className="px-6 py-3 bg-[var(--color-paper-warm)] border-t border-[var(--color-border)] text-xs text-[var(--color-ink-faint)]">
            <p>
              勾选书籍为「强制检索」后，可设置「织带中强制书籍最多占 1/2/3
              条」；其余条数来自其他书籍，避免单本书占满织带。
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
