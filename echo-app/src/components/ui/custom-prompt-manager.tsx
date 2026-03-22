'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { customPromptService } from '@/services/custom-prompt.service'
import type { CustomPrompt } from '@/types'

interface CustomPromptManagerProps {
  isOpen: boolean
  onClose: () => void
  onSelect?: (promptId: string) => void
  selectedId?: string | null
}

type PromptModeFilter = 'all' | 'ambient' | 'detail'

function getModeLabel(mode?: CustomPrompt['mode']) {
  return (mode ?? 'ambient') === 'detail' ? '详情解释' : '织带模块'
}

function getBehaviorLabel(behavior?: CustomPrompt['behavior']) {
  switch (behavior ?? 'freeform') {
    case 'term_list':
      return '词汇提取'
    case 'guided_terms':
      return '领域联想'
    case 'entity_explain':
      return '实体解释'
    default:
      return '自由生成'
  }
}

function getShapeLabel(shape?: CustomPrompt['outputShape']) {
  return (shape ?? 'short_lines') === 'paragraph' ? '段落' : '短句'
}

export function CustomPromptManager({
  isOpen,
  onClose,
  onSelect,
  selectedId,
}: CustomPromptManagerProps) {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formMode, setFormMode] = useState<'ambient' | 'detail'>('ambient')
  const [formBehavior, setFormBehavior] = useState<'freeform' | 'term_list' | 'guided_terms' | 'entity_explain'>('freeform')
  const [formOutputShape, setFormOutputShape] = useState<'short_lines' | 'paragraph'>('short_lines')
  const [formUseRag, setFormUseRag] = useState(false)
  const [formRagFallback, setFormRagFallback] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [modeFilter, setModeFilter] = useState<PromptModeFilter>('ambient')

  const isSelecting = Boolean(onSelect)

  const refreshPrompts = useCallback(() => {
    setPrompts(customPromptService.getAll())
  }, [])

  useEffect(() => {
    if (!isOpen) return
    refreshPrompts()
  }, [isOpen, refreshPrompts])

  const ambientCount = useMemo(
    () => prompts.filter((prompt) => (prompt.mode ?? 'ambient') === 'ambient').length,
    [prompts],
  )
  const detailCount = prompts.length - ambientCount
  const visiblePrompts = useMemo(() => {
    if (modeFilter === 'all') return prompts
    return prompts.filter((prompt) => (prompt.mode ?? 'ambient') === modeFilter)
  }, [modeFilter, prompts])

  const resetForm = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormContent('')
    setFormMode(modeFilter === 'detail' ? 'detail' : 'ambient')
    setFormBehavior('freeform')
    setFormOutputShape(modeFilter === 'detail' ? 'paragraph' : 'short_lines')
    setFormUseRag(false)
    setFormRagFallback(false)
    setShowForm(false)
  }, [modeFilter])

  const applyBehaviorPreset = (behavior: NonNullable<CustomPrompt['behavior']>) => {
    setFormBehavior(behavior)
    if (behavior === 'term_list' || behavior === 'guided_terms') {
      setFormMode('ambient')
      setFormOutputShape('short_lines')
      setFormUseRag(false)
      setFormRagFallback(false)
      return
    }
    if (behavior === 'entity_explain') {
      setFormMode('ambient')
      setFormOutputShape('paragraph')
      setFormUseRag(false)
      setFormRagFallback(false)
      return
    }
    setFormUseRag(false)
    setFormRagFallback(false)
  }

  const startCreate = (mode: 'ambient' | 'detail' = modeFilter === 'detail' ? 'detail' : 'ambient') => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setFormContent('')
    setFormMode(mode)
    setFormBehavior('freeform')
    setFormOutputShape(mode === 'detail' ? 'paragraph' : 'short_lines')
    setFormUseRag(false)
    setFormRagFallback(false)
    setShowForm(true)
  }

  const startEdit = (prompt: CustomPrompt) => {
    setEditingId(prompt.id)
    setFormName(prompt.name)
    setFormDescription(prompt.description ?? '')
    setFormContent(prompt.content)
    setFormMode(prompt.mode ?? 'ambient')
    setFormBehavior(prompt.behavior ?? 'freeform')
    setFormOutputShape(prompt.outputShape ?? ((prompt.mode ?? 'ambient') === 'detail' ? 'paragraph' : 'short_lines'))
    setFormUseRag(prompt.useRag ?? false)
    setFormRagFallback(prompt.ragFallback ?? false)
    setShowForm(true)
  }

  const handleCreate = () => {
    if (!formName.trim() || !formContent.trim()) {
      toast.error('请填写模块名称和提示词内容')
      return
    }

    const created = customPromptService.create(
      formName.trim(),
      formContent.trim(),
      formDescription.trim() || undefined,
      formMode,
      formBehavior,
      formOutputShape,
      formUseRag,
      formRagFallback,
    )

    toast.success(`已创建「${created.name}」`)
    resetForm()
    refreshPrompts()
  }

  const handleUpdate = () => {
    if (!editingId || !formName.trim() || !formContent.trim()) {
      toast.error('请填写模块名称和提示词内容')
      return
    }

    const updated = customPromptService.update(editingId, {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      content: formContent.trim(),
      mode: formMode,
      behavior: formBehavior,
      outputShape: formOutputShape,
      useRag: formUseRag,
      ragFallback: formRagFallback,
    })

    if (updated) {
      toast.success(`已更新「${updated.name}」`)
      resetForm()
      refreshPrompts()
    }
  }

  const handleDelete = (id: string) => {
    const prompt = prompts.find((entry) => entry.id === id)
    if (!prompt) return

    if (!confirm(`确定删除「${prompt.name}」吗？`)) return

    try {
      if (customPromptService.delete(id)) {
        toast.success(`已删除「${prompt.name}」`)
        if (editingId === id) resetForm()
        refreshPrompts()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const handleDuplicate = (id: string) => {
    const duplicated = customPromptService.duplicate(id)
    if (!duplicated) return
    toast.success(`已复制为「${duplicated.name}」`)
    refreshPrompts()
  }

  const handleExport = () => {
    const json = customPromptService.export()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `echo-custom-prompts-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('已导出自定义模块')
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        if (!customPromptService.import(text)) {
          toast.error('导入失败，文件格式不正确')
          return
        }
        toast.success('已导入自定义模块')
        refreshPrompts()
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
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-[var(--color-border)] px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium text-[var(--color-ink)]">自定义模块</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
                  ambient 模块参与织带，detail 模块只用于详情解释。创建、编辑和导入都统一放在这里。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startCreate(modeFilter === 'detail' ? 'detail' : 'ambient')}
                  className="rounded-lg bg-[var(--color-btn-primary-bg)] px-4 py-2 text-sm text-[var(--color-btn-primary-text)] hover:opacity-90"
                >
                  新建模块
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-ink-faint)] hover:bg-[var(--color-ink)]/5 hover:text-[var(--color-ink)]"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-[var(--color-paper)] px-2.5 py-1 text-[var(--color-ink-faint)]">
                全部 {prompts.length}
              </span>
              <span className="rounded-full bg-[var(--color-paper)] px-2.5 py-1 text-[var(--color-ink-faint)]">
                ambient {ambientCount}
              </span>
              <span className="rounded-full bg-[var(--color-paper)] px-2.5 py-1 text-[var(--color-ink-faint)]">
                detail {detailCount}
              </span>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { value: 'ambient' as const, label: '织带模块' },
                  { value: 'detail' as const, label: '详情模块' },
                  { value: 'all' as const, label: '全部' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setModeFilter(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                      modeFilter === option.value
                        ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                        : 'bg-[var(--color-paper)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExport}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                >
                  导出
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                >
                  导入
                </button>
              </div>
            </div>

            {!isSelecting && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-3 text-sm text-[var(--color-ink-faint)]">
                这里只有模块管理。是否让某个 ambient 模块真的参与织带，要回到设置页里的“内容模块”勾选。
              </div>
            )}

            {showForm && (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-medium text-[var(--color-ink)]">
                      {editingId ? '编辑模块' : '新建模块'}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
                      先决定它属于织带还是详情，再定义输出形态和提示词。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                  >
                    收起
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">模块名称</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(event) => setFormName(event.target.value)}
                      placeholder="例如：百科解释"
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">一句描述</label>
                    <input
                      type="text"
                      value={formDescription}
                      onChange={(event) => setFormDescription(event.target.value)}
                      placeholder="告诉自己这个模块负责什么"
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">模块归属</label>
                    <select
                      value={formMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as 'ambient' | 'detail'
                        setFormMode(nextMode)
                        setFormOutputShape(nextMode === 'detail' ? 'paragraph' : 'short_lines')
                      }}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    >
                      <option value="ambient">织带模块</option>
                      <option value="detail">详情模块</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">行为类型</label>
                    <select
                      value={formBehavior}
                      onChange={(event) => applyBehaviorPreset(event.target.value as NonNullable<CustomPrompt['behavior']>)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    >
                      <option value="freeform">自由生成</option>
                      <option value="term_list">词汇提取</option>
                      <option value="guided_terms">领域联想</option>
                      <option value="entity_explain">实体解释</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">输出形态</label>
                    <select
                      value={formOutputShape}
                      onChange={(event) => setFormOutputShape(event.target.value as 'short_lines' | 'paragraph')}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    >
                      <option value="short_lines">短句</option>
                      <option value="paragraph">段落</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                      <input
                        type="checkbox"
                        checked={formUseRag}
                        onChange={(event) => setFormUseRag(event.target.checked)}
                        className="rounded border-[var(--color-border)]"
                      />
                      使用共鸣库上下文
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
                      <input
                        type="checkbox"
                        checked={formRagFallback}
                        onChange={(event) => setFormRagFallback(event.target.checked)}
                        className="rounded border-[var(--color-border)]"
                      />
                      RAG 不可用时允许回退
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                    只有确实依赖知识库时再打开；否则优先保持简单，避免把等待时间全堆到模块上。
                  </p>
                </div>

                <div className="mt-4">
                  <label className="mb-1.5 block text-xs text-[var(--color-ink-light)]">系统提示词</label>
                  <textarea
                    value={formContent}
                    onChange={(event) => setFormContent(event.target.value)}
                    placeholder="定义这个模块的角色、输入上下文和输出要求"
                    className="min-h-[220px] w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm resize-y"
                  />
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        resetForm()
                        startCreate(formMode)
                      }}
                      className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-ink)]/5"
                    >
                      另存为新模块
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-ink)]/5"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={editingId ? handleUpdate : handleCreate}
                    className="rounded-lg bg-[var(--color-btn-primary-bg)] px-4 py-2 text-sm text-[var(--color-btn-primary-text)] hover:opacity-90"
                  >
                    {editingId ? '保存修改' : '创建模块'}
                  </button>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {visiblePrompts.length === 0 ? (
                <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-paper)] px-6 text-center text-sm text-[var(--color-ink-faint)]">
                  当前筛选下还没有模块。先新建一个，再回到设置页里决定是否启用它。
                </div>
              ) : (
                <div className="space-y-3">
                  {visiblePrompts.map((prompt) => {
                    const selected = selectedId === prompt.id
                    const isAmbient = (prompt.mode ?? 'ambient') === 'ambient'
                    return (
                      <div
                        key={prompt.id}
                        className={`rounded-2xl border px-4 py-4 transition-colors ${
                          selected
                            ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/5'
                            : 'border-[var(--color-border)] bg-[var(--color-paper)] hover:border-[var(--color-ink-light)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-medium text-[var(--color-ink)]">{prompt.name}</h3>
                              <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                {getModeLabel(prompt.mode)}
                              </span>
                              <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                {getBehaviorLabel(prompt.behavior)}
                              </span>
                              <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                {getShapeLabel(prompt.outputShape)}
                              </span>
                              {selected && (
                                <span className="rounded-full bg-[var(--color-btn-primary-bg)] px-2 py-0.5 text-[10px] text-[var(--color-btn-primary-text)]">
                                  已选择
                                </span>
                              )}
                            </div>
                            {prompt.description && (
                              <p className="mt-1.5 text-sm text-[var(--color-ink-faint)]">{prompt.description}</p>
                            )}
                            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                              {isAmbient ? '会出现在织带候选中' : '只在详情解释里调用'}
                              {' · '}
                              共鸣库 {prompt.useRag ? '开启' : '关闭'}
                              {' · '}
                              回退 {prompt.ragFallback ? '允许' : '关闭'}
                            </p>
                            <p className="mt-2 line-clamp-3 text-xs leading-6 text-[var(--color-ink-faint)]">
                              {prompt.content}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {isSelecting && (
                              <button
                                type="button"
                                onClick={() => onSelect?.(prompt.id)}
                                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                              >
                                选择
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(prompt)}
                              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicate(prompt.id)}
                              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-ink)]/5"
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(prompt.id)}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
