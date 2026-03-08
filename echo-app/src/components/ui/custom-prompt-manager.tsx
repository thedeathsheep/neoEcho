'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

import { customPromptService } from '@/services/custom-prompt.service'
import type { CustomPrompt } from '@/types'

interface CustomPromptManagerProps {
  isOpen: boolean
  onClose: () => void
  onSelect?: (promptId: string) => void
  selectedId?: string | null
}

export function CustomPromptManager({
  isOpen,
  onClose,
  onSelect,
  selectedId,
}: CustomPromptManagerProps) {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([])
  const [activeId, setActiveId] = useState<string | null>(selectedId || null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form states
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formContent, setFormContent] = useState('')
  const [showForm, setShowForm] = useState(false)

  const refreshPrompts = useCallback(() => {
    const allPrompts = customPromptService.getAll()
    const active = customPromptService.getActive()
    setPrompts(allPrompts)
    setActiveId(active?.id || null)
  }, [])

  useEffect(() => {
    if (isOpen) {
      refreshPrompts()
    }
  }, [isOpen, refreshPrompts])

  const handleCreate = () => {
    if (!formName.trim() || !formContent.trim()) {
      toast.error('请输入名称和内容')
      return
    }

    const newPrompt = customPromptService.create(
      formName.trim(),
      formContent.trim(),
      formDescription.trim() || undefined,
    )

    toast.success(`创建提示词 "${newPrompt.name}"`)
    resetForm()
    refreshPrompts()
  }

  const handleUpdate = () => {
    if (!editingId || !formName.trim() || !formContent.trim()) {
      toast.error('请输入名称和内容')
      return
    }

    const updated = customPromptService.update(editingId, {
      name: formName.trim(),
      content: formContent.trim(),
      description: formDescription.trim() || undefined,
    })

    if (updated) {
      toast.success('提示词已更新')
      resetForm()
      refreshPrompts()
    }
  }

  const handleDelete = (id: string) => {
    const prompt = prompts.find((p) => p.id === id)
    if (!prompt) return

    if (confirm(`确定要删除提示词 "${prompt.name}" 吗？`)) {
      try {
        if (customPromptService.delete(id)) {
          toast.success('提示词已删除')
          refreshPrompts()
        }
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
  }

  const handleDuplicate = (id: string) => {
    const duplicated = customPromptService.duplicate(id)
    if (duplicated) {
      toast.success(`已复制为 "${duplicated.name}"`)
      refreshPrompts()
    }
  }

  const handleSelect = (id: string) => {
    if (onSelect) {
      onSelect(id)
    } else {
      customPromptService.setActive(id)
      setActiveId(id)
      toast.success('已切换提示词')
    }
  }

  const startEdit = (prompt: CustomPrompt) => {
    setEditingId(prompt.id)
    setFormName(prompt.name)
    setFormDescription(prompt.description || '')
    setFormContent(prompt.content)
    setShowForm(true)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormContent('')
    setEditingId(null)
    setShowForm(false)
  }

  const handleExport = () => {
    const json = customPromptService.export()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `echo-custom-prompts-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('提示词已导出')
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        if (customPromptService.import(text)) {
          toast.success('提示词已导入')
          refreshPrompts()
        } else {
          toast.error('导入失败，文件格式不正确')
        }
      } catch {
        toast.error('导入失败')
      }
    }
    input.click()
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
          className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-[var(--color-ink)]">
                自定义提示词管理
              </h2>
              <p className="text-xs text-[var(--color-ink-faint)]">
                共 {prompts.length} 个提示词
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Prompt List */}
            {prompts.map((prompt) => {
              const isActive = activeId === prompt.id
              const isSelected = selectedId === prompt.id

              return (
                <div
                  key={prompt.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    isActive || isSelected
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)]'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-[var(--color-ink)]">
                          {prompt.name}
                        </h3>
                        {(isActive || isSelected) && (
                          <span className="text-xs px-2 py-0.5 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded">
                            {onSelect ? '已选择' : '使用中'}
                          </span>
                        )}
                      </div>
                      {prompt.description && (
                        <p className="text-sm text-[var(--color-ink-faint)] mt-1">
                          {prompt.description}
                        </p>
                      )}
                      <p className="text-xs text-[var(--color-ink-faint)] mt-2 line-clamp-2">
                        {prompt.content.slice(0, 100)}
                        {prompt.content.length > 100 ? '...' : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 ml-4">
                      <button
                        onClick={() => handleSelect(prompt.id)}
                        className="px-2 py-1 text-xs border rounded hover:bg-[var(--color-ink)]/5"
                        title="选择此提示词"
                      >
                        选择
                      </button>
                      <button
                        onClick={() => startEdit(prompt)}
                        className="px-2 py-1 text-xs border rounded hover:bg-[var(--color-ink)]/5"
                        title="编辑"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDuplicate(prompt.id)}
                        className="px-2 py-1 text-xs border rounded hover:bg-[var(--color-ink)]/5"
                        title="复制"
                      >
                        复制
                      </button>
                      <button
                        onClick={() => handleDelete(prompt.id)}
                        className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50"
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Form */}
            {showForm && (
              <div className="border-2 border-[var(--color-ink)]/20 rounded-lg p-4 space-y-4">
                <h4 className="font-medium text-[var(--color-ink)]">
                  {editingId ? '编辑提示词' : '新建提示词'}
                </h4>

                <div>
                  <label className="block text-xs text-[var(--color-ink-light)] mb-1">
                    名称
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如：科幻写作助手"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-ink-light)] mb-1">
                    描述（可选）
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="简短描述这个提示词的用途"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[var(--color-ink-light)] mb-1">
                    系统提示词内容
                  </label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="输入系统提示词，告诉AI它应该扮演什么角色、提供什么样的建议..."
                    className="w-full px-3 py-2 border rounded-lg text-sm min-h-[150px] resize-y"
                  />
                  <p className="text-xs text-[var(--color-ink-faint)] mt-1">
                    提示：系统提示词用于设定AI的角色和行为。建议说明AI的角色、输出格式、风格要求等。
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={resetForm}
                    className="px-4 py-2 border rounded-lg text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={editingId ? handleUpdate : handleCreate}
                    className="px-4 py-2 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded-lg text-sm"
                  >
                    {editingId ? '保存' : '创建'}
                  </button>
                </div>
              </div>
            )}

            {/* Add Button */}
            {!showForm && (
              <button
                onClick={startCreate}
                className="w-full py-3 border-2 border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink)]/30 transition-colors"
              >
                + 创建新提示词
              </button>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-3 bg-[var(--color-paper-warm)] border-t border-[var(--color-border)] flex justify-between">
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-3 py-1.5 text-xs border rounded-lg hover:bg-[var(--color-surface)]"
              >
                导出全部
              </button>
              <button
                onClick={handleImport}
                className="px-3 py-1.5 text-xs border rounded-lg hover:bg-[var(--color-surface)]"
              >
                导入
              </button>
            </div>
            <button
              onClick={() => {
                if (
                  confirm(
                    '确定要重置为默认提示词吗？这将删除所有自定义提示词。',
                  )
                ) {
                  customPromptService.resetToDefaults()
                  refreshPrompts()
                  toast.success('已重置为默认提示词')
                }
              }}
              className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
            >
              重置默认
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
