'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useSettings, BUILTIN_RIBBON_MODULES } from '@/lib/settings-context'
import { validateApiKey, getDefaultPromptForModule, generatePromptFromDescription, DEFAULT_SYSTEM_PROMPTS } from '@/services/client-ai.service'
import { validateEmbeddingApi } from '@/services/embedding.service'
import { KnowledgeBaseManager } from '@/components/ui/knowledge-base-manager'
import { CustomPromptManager } from '@/components/ui/custom-prompt-manager'
import { AboutModal } from '@/components/help/about-modal'
import { knowledgeBaseService } from '@/services/knowledge-base.service'
import { customPromptService } from '@/services/custom-prompt.service'
import type { RibbonModuleConfig, RibbonSlotCount, RibbonModuleType, AllocationMode } from '@/types'

const PRESETS = [
  { label: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Moonshot (Kimi)', url: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  { label: 'OpenAI', url: 'https://api.openai.com', model: 'gpt-4o' },
  { label: 'Groq', url: 'https://api.groq.com/openai', model: 'llama-3.3-70b-versatile' },
  { label: 'SiliconFlow', url: 'https://api.siliconflow.cn', model: 'deepseek-ai/DeepSeek-V3' },
] as const

const EMBEDDING_PRESETS = [
  { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/text-embedding-3-small' },
  { label: 'AIHubMix', baseUrl: 'https://aihubmix.com', model: 'text-embedding-3-small' },
] as const

type ValidationStatus = 'idle' | 'loading' | 'success' | 'error'

const MAX_PINNED = 5
const RAG_PINNED_MAX = 3

function RibbonModulesEditor({
  ribbonModules,
  setRibbonModules,
  onAddCustomPrompt,
  onManageCustomPrompts,
  onEditModulePrompt,
}: {
  ribbonModules: RibbonModuleConfig[]
  setRibbonModules: React.Dispatch<React.SetStateAction<RibbonModuleConfig[]>>
  onAddCustomPrompt: () => void
  onManageCustomPrompts: () => void
  onEditModulePrompt: (moduleId: string, moduleType: RibbonModuleType, currentPrompt?: string, currentModel?: string, currentLabel?: string) => void
}) {
  const [ragFixedCount, setRagFixedCount] = useState(0)
  const [customPrompts, setCustomPrompts] = useState<{ id: string; name: string }[]>([])

  // Load client-side data after hydration; refresh custom list when module count changes (e.g. after adding custom)
  const moduleCount = ribbonModules.length
  useEffect(() => {
    const activeBase = knowledgeBaseService.getActive()
    setRagFixedCount(Math.min(RAG_PINNED_MAX, activeBase?.mandatoryBooks?.length ?? 0))
    setCustomPrompts(customPromptService.getAll())
  }, [moduleCount])

  const byId = new Map(ribbonModules.map((m) => [m.id, m]))

  const builtin = BUILTIN_RIBBON_MODULES.map((b) => ({
    ...b,
    enabled: byId.get(b.id)?.enabled ?? (b.id === 'rag' || b.id === 'ai:imagery'),
    pinned: byId.get(b.id)?.pinned ?? false,
  }))
  const custom = customPrompts.map((p) => ({
    id: p.id,
    type: 'custom' as const,
    label: byId.get(p.id)?.label ?? p.name,
    enabled: byId.get(p.id)?.enabled ?? false,
    pinned: byId.get(p.id)?.pinned ?? false,
  }))
  const displayModules: RibbonModuleConfig[] = [...builtin, ...custom]
  const otherPinnedCount = displayModules.filter((m) => m.type !== 'rag' && m.pinned).length
  const totalPinned = ragFixedCount + otherPinnedCount
  const canPinMore = totalPinned < MAX_PINNED

  const updateModule = (id: string, patch: Partial<Pick<RibbonModuleConfig, 'enabled' | 'pinned'>>) => {
    setRibbonModules((prev) => {
      const existing = prev.find((m) => m.id === id)
      const base = existing ?? { id, type: 'rag' as const, label: '' }
      const next = { ...base, ...patch }
      if (existing) return prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
      const builtin = BUILTIN_RIBBON_MODULES.find((b) => b.id === id)
      const customP = customPrompts.find((p) => p.id === id)
      if (builtin) return [...prev, { ...builtin, enabled: next.enabled ?? false, pinned: next.pinned ?? false }]
      if (customP) return [...prev, { id: customP.id, type: 'custom', label: customP.name, enabled: next.enabled ?? false, pinned: next.pinned ?? false }]
      return prev
    })
  }

  const getModuleLabel = (mod: RibbonModuleConfig) => {
    return mod.label
  }

  const setPinned = (mod: RibbonModuleConfig, pinned: boolean) => {
    if (mod.type === 'rag') return
    if (pinned && !canPinMore) {
      toast.error(`固定来源最多 ${MAX_PINNED} 个（共鸣库强制检索最多占 ${RAG_PINNED_MAX} 个）`)
      return
    }
    updateModule(mod.id, { pinned })
  }

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-ink-faint)]">
          固定 {totalPinned}/{MAX_PINNED}（共鸣库强制检索在「共鸣库管理」中设置，最多 {RAG_PINNED_MAX} 本）
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onManageCustomPrompts}
            className="text-xs px-2 py-1 border border-[var(--color-border)] rounded hover:bg-[var(--color-ink)]/5 transition-colors"
          >
            管理自定义
          </button>
          <button
            onClick={onAddCustomPrompt}
            className="text-xs px-2 py-1 border border-[var(--color-border)] rounded hover:bg-[var(--color-ink)]/5 transition-colors flex items-center gap-1"
          >
            <span>+</span>
            <span>添加自定义</span>
          </button>
        </div>
      </div>
      {displayModules.map((mod) => (
        <div key={mod.id} className="flex items-center gap-3 py-1.5 group">
          <input
            type="checkbox"
            id={`ribbon-enable-${mod.id}`}
            checked={mod.enabled}
            onChange={(e) => updateModule(mod.id, { enabled: e.target.checked })}
            className="rounded border-[var(--color-border)]"
          />
          <label htmlFor={`ribbon-enable-${mod.id}`} className="flex-1 text-sm text-[var(--color-ink)] min-w-0 truncate">
            {getModuleLabel(mod)}
          </label>
          {/* Edit button for AI modules (built-in, custom, and quick) */}
          {mod.type !== 'rag' && (
            <button
              onClick={() => {
                const currentPrompt = mod.type === 'custom' ? (customPromptService.get(mod.id)?.content ?? '') : mod.prompt
                onEditModulePrompt(mod.id, mod.type, currentPrompt, mod.model, mod.label)
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2 py-0.5 border border-[var(--color-border)] rounded hover:bg-[var(--color-ink)]/5"
              title="编辑模块"
            >
              编辑
            </button>
          )}
          {mod.type === 'rag' ? (
            <span className="text-xs text-[var(--color-ink-faint)]">
              强制 {ragFixedCount} 本
            </span>
          ) : (
            <input
              type="checkbox"
              id={`ribbon-pin-${mod.id}`}
              checked={mod.pinned}
              disabled={!mod.enabled || (mod.pinned ? false : !canPinMore)}
              onChange={(e) => setPinned(mod, e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
          )}
          {mod.type !== 'rag' && (
            <label htmlFor={`ribbon-pin-${mod.id}`} className="text-xs text-[var(--color-ink-faint)]">
              固定
            </label>
          )}
        </div>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { settings, updateSettings } = useSettings()

  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [semanticExpansion, setSemanticExpansion] = useState(settings.semanticExpansion ?? false)
  const [ribbonAiFilter, setRibbonAiFilter] = useState(settings.ribbonAiFilter ?? false)
  const [ribbonFilterModel, setRibbonFilterModel] = useState(settings.ribbonFilterModel ?? '')
  const [ribbonPauseSeconds, setRibbonPauseSeconds] = useState(settings.ribbonPauseSeconds ?? 2)
  const [ribbonSlotCount, setRibbonSlotCount] = useState<RibbonSlotCount>(
    (settings.ribbonSettings?.slotCount ?? 5) as RibbonSlotCount
  )
  const [allocationMode, setAllocationMode] = useState<AllocationMode>(
    (settings.ribbonSettings?.allocationMode ?? 'balanced') as AllocationMode
  )
  const [ribbonModules, setRibbonModules] = useState<RibbonModuleConfig[]>(() => {
    const mods = settings.ribbonSettings?.modules
    if (mods?.length) return mods
    return BUILTIN_RIBBON_MODULES.map((m) => ({
      ...m,
      enabled: m.id === 'rag' || m.id === 'ai:imagery',
      pinned: false,
    }))
  })
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(settings.theme ?? 'light')
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>(settings.fontSize ?? 'medium')
  const [useEmbeddingApi, setUseEmbeddingApi] = useState(settings.useEmbeddingApi ?? false)
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(settings.embeddingBaseUrl ?? '')
  const [embeddingApiKey, setEmbeddingApiKey] = useState(settings.embeddingApiKey ?? '')
  const [embeddingModel, setEmbeddingModel] = useState(settings.embeddingModel ?? 'BAAI/bge-m3')
  const [showEmbeddingPresets, setShowEmbeddingPresets] = useState(false)
  const [embeddingValidationStatus, setEmbeddingValidationStatus] = useState<ValidationStatus>('idle')
  const [embeddingValidationMsg, setEmbeddingValidationMsg] = useState('')
  const [filterValidationStatus, setFilterValidationStatus] = useState<ValidationStatus>('idle')
  const [filterValidationMsg, setFilterValidationMsg] = useState('')

  useEffect(() => {
    setSemanticExpansion(settings.semanticExpansion ?? false)
  }, [settings.semanticExpansion])
  useEffect(() => {
    setRibbonAiFilter(settings.ribbonAiFilter ?? false)
  }, [settings.ribbonAiFilter])
  useEffect(() => {
    setRibbonFilterModel(settings.ribbonFilterModel ?? '')
  }, [settings.ribbonFilterModel])
  useEffect(() => {
    setRibbonPauseSeconds(Math.min(10, Math.max(1, settings.ribbonPauseSeconds ?? 2)))
  }, [settings.ribbonPauseSeconds])
  useEffect(() => {
    const rs = settings.ribbonSettings
    if (rs?.slotCount) setRibbonSlotCount(Math.min(8, Math.max(5, rs.slotCount)) as RibbonSlotCount)
    if (rs?.allocationMode) setAllocationMode(rs.allocationMode as AllocationMode)
    if (rs?.modules?.length) setRibbonModules(rs.modules)
  }, [settings.ribbonSettings])
  useEffect(() => {
    setTheme(settings.theme ?? 'light')
  }, [settings.theme])
  useEffect(() => {
    setFontSize(settings.fontSize ?? 'medium')
  }, [settings.fontSize])
  useEffect(() => {
    setUseEmbeddingApi(settings.useEmbeddingApi ?? false)
    setEmbeddingBaseUrl(settings.embeddingBaseUrl ?? '')
    setEmbeddingApiKey(settings.embeddingApiKey ?? '')
    setEmbeddingModel(settings.embeddingModel ?? 'BAAI/bge-m3')
  }, [settings.useEmbeddingApi, settings.embeddingBaseUrl, settings.embeddingApiKey, settings.embeddingModel])

  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle')
  const [validationMsg, setValidationMsg] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [showKbManager, setShowKbManager] = useState(false)
  const [showPromptManager, setShowPromptManager] = useState(false)
  const [showAddModule, setShowAddModule] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [kbStats, setKbStats] = useState({ baseCount: 0, totalFiles: 0 })

  // Module prompt editing
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null)
  const [editingModuleType, setEditingModuleType] = useState<RibbonModuleType>('custom')
  const [editingModulePrompt, setEditingModulePrompt] = useState('')
  const [editingModuleModel, setEditingModuleModel] = useState<string | undefined>(undefined)
  const [editingModuleLabel, setEditingModuleLabel] = useState<string | undefined>(undefined)

  const handlePreset = (preset: (typeof PRESETS)[number]) => {
    setBaseUrl(preset.url)
    setModel(preset.model)
    setShowPresets(false)
    setValidationStatus('idle')
  }

  const handleValidate = async () => {
    setValidationStatus('loading')
    setValidationMsg('')
    setAvailableModels([])

    const result = await validateApiKey({ apiKey, baseUrl, model })

    if (result.valid) {
      setValidationStatus('success')
      setValidationMsg('连接成功')
      setAvailableModels(result.models ?? [])
    } else {
      setValidationStatus('error')
      setValidationMsg(result.error ?? '验证失败')
    }
  }

  // Load knowledge base stats
  const refreshKbStats = useCallback(async () => {
    const stats = await knowledgeBaseService.getGlobalStats()
    setKbStats({
      baseCount: stats.baseCount,
      totalFiles: stats.totalFiles,
    })
  }, [])

  useEffect(() => {
    refreshKbStats()
    // Listen for knowledge base updates
    const handleUpdate = () => refreshKbStats()
    window.addEventListener('knowledge-base-updated', handleUpdate)
    return () => {
      window.removeEventListener('knowledge-base-updated', handleUpdate)
    }
  }, [refreshKbStats])

  // Custom module management is now handled directly in the module editor

  const handleSave = () => {
    updateSettings({
      apiKey,
      model,
      baseUrl,
      semanticExpansion,
      ribbonAiFilter,
      ribbonFilterModel: ribbonFilterModel.trim(),
      ribbonPauseSeconds: Math.min(10, Math.max(1, ribbonPauseSeconds)),
      ribbonSettings: {
        slotCount: ribbonSlotCount,
        allocationMode,
        modules: [
          ...BUILTIN_RIBBON_MODULES.map((b) => {
            const saved = ribbonModules.find((m) => m.id === b.id)
            return {
              ...b,
              enabled: saved?.enabled ?? (b.id === 'rag' || b.id === 'ai:imagery'),
              pinned: saved?.pinned ?? false,
            }
          }),
          ...ribbonModules.filter((m) => m.type === 'custom'),
        ],
      },
      theme,
      fontSize,
      useEmbeddingApi,
      embeddingBaseUrl,
      embeddingApiKey,
      embeddingModel,
    })
    toast.success('设置已保存')
  }

  const handleEmbeddingPreset = (preset: (typeof EMBEDDING_PRESETS)[number]) => {
    setEmbeddingBaseUrl(preset.baseUrl)
    setEmbeddingModel(preset.model)
    setShowEmbeddingPresets(false)
  }

  const handleValidateEmbedding = async () => {
    setEmbeddingValidationStatus('loading')
    setEmbeddingValidationMsg('')
    const result = await validateEmbeddingApi({
      embeddingBaseUrl,
      embeddingApiKey,
      embeddingModel,
    })
    if (result.valid) {
      setEmbeddingValidationStatus('success')
      setEmbeddingValidationMsg('嵌入服务连接成功')
    } else {
      setEmbeddingValidationStatus('error')
      setEmbeddingValidationMsg(result.error ?? '验证失败')
    }
  }

  const handleValidateFilter = async () => {
    setFilterValidationStatus('loading')
    setFilterValidationMsg('')
    const modelToTest = ribbonFilterModel.trim() || model
    const result = await validateApiKey({ apiKey, baseUrl, model: modelToTest })
    if (result.valid) {
      setFilterValidationStatus('success')
      setFilterValidationMsg(
        ribbonFilterModel.trim()
          ? `连接成功，过滤将使用模型: ${modelToTest}`
          : '连接成功，过滤将使用主模型',
      )
    } else {
      setFilterValidationStatus('error')
      setFilterValidationMsg(result.error ?? '验证失败')
    }
  }

  const handleAddCustomModule = (name: string, prompt: string) => {
    const created = customPromptService.create(name, prompt)
    const newModule: RibbonModuleConfig = {
      id: created.id,
      type: 'custom',
      label: created.name,
      enabled: true,
      pinned: false,
    }
    setRibbonModules(prev => [...prev, newModule])
    setShowAddModule(false)
    toast.success(`已添加自定义模块「${created.name}」`)
  }

  const statusColor: Record<ValidationStatus, string> = {
    idle: 'border-[var(--color-border)]',
    loading: 'border-yellow-400',
    success: 'border-green-400',
    error: 'border-red-400',
  }

  return (
    <div className="min-h-screen bg-[var(--color-paper)] flex flex-col items-center pt-20 pb-20">
      <div className="w-full max-w-2xl px-8">
        <div className="flex items-center justify-between mb-12">
          <h1 className="text-3xl font-serif text-[var(--color-ink)]">设置</h1>
          <button
            onClick={() => router.back()}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
          >
            返回
          </button>
        </div>

        <div className="space-y-8">
          <section
            className={`bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border-2 p-6 transition-colors ${statusColor[validationStatus]}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-medium text-[var(--color-ink)]">
                  主模型配置
                </h2>
                <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">
                  用于织带AI模块生成内容（意象/润色/叙事/引用等）
                </p>
              </div>
              {validationStatus === 'success' && (
                <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  已连接
                </span>
              )}
            </div>

            <div className="space-y-5">
              {/* Base URL */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm text-[var(--color-ink-light)]">
                    API 服务地址
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setShowPresets(!showPresets)}
                      className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline underline-offset-2 transition-colors"
                    >
                      常用预设
                    </button>
                    {showPresets && (
                      <div className="absolute right-0 top-6 w-56 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-10 py-1">
                        {PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => handlePreset(p)}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-ink)]/10 transition-colors"
                          >
                            <span className="font-medium">{p.label}</span>
                            <span className="text-[var(--color-ink-faint)] ml-2 text-xs">
                              {p.model}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value)
                    setValidationStatus('idle')
                  }}
                  placeholder="https://api.deepseek.com"
                  className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] transition-colors font-mono text-sm"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setValidationStatus('idle')
                  }}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] transition-colors font-mono text-sm"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  模型名称
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="deepseek-chat"
                  className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] transition-colors font-mono text-sm"
                />
                {availableModels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {availableModels.slice(0, 8).map((m) => (
                      <button
                        key={m}
                        onClick={() => setModel(m)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          m === model
                            ? 'border-[var(--color-btn-primary-bg)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]'
                            : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Validate Button */}
              <div>
                <button
                  onClick={handleValidate}
                  disabled={!apiKey || !baseUrl || validationStatus === 'loading'}
                  className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-ink)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {validationStatus === 'loading' ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-[var(--color-ink-faint)] border-t-transparent rounded-full animate-spin" />
                      验证中...
                    </span>
                  ) : (
                    '验证连接'
                  )}
                </button>

                {validationMsg && (
                  <p
                    className={`mt-2 text-sm ${
                      validationStatus === 'success'
                        ? 'text-green-600'
                        : 'text-red-500'
                    }`}
                  >
                    {validationStatus === 'success' ? '✓' : '✗'} {validationMsg}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-[var(--color-ink-faint)] mt-4 leading-relaxed">
              支持所有 OpenAI 兼容格式的 API 服务（DeepSeek、Moonshot、Groq、SiliconFlow 等）。
              Key 仅保存在本地，不会上传到任何服务器。
            </p>
          </section>

          {/* Embedding API Section */}
          <section className="bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-2">
              嵌入模型配置
            </h2>
            <p className="text-xs text-[var(--color-ink-faint)] mb-4">
              用于织带语义检索（RAG）。使用 API 嵌入可显著提升中文语义检索效果；不配置则使用本地模型（易失败或效果一般）。
            </p>
            <div className="flex items-start gap-3 mb-4">
              <input
                type="checkbox"
                id="useEmbeddingApi"
                checked={useEmbeddingApi}
                onChange={(e) => setUseEmbeddingApi(e.target.checked)}
                className="mt-1 rounded border-[var(--color-border)]"
              />
              <label htmlFor="useEmbeddingApi" className="flex-1 cursor-pointer text-sm text-[var(--color-ink)]">
                启用 API 嵌入
              </label>
            </div>
            {useEmbeddingApi && (
              <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm text-[var(--color-ink-light)]">服务地址</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmbeddingPresets(!showEmbeddingPresets)}
                        className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline underline-offset-2"
                      >
                        预设
                      </button>
                      {showEmbeddingPresets && (
                        <div className="absolute right-0 top-6 w-52 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-10 py-1">
                          {EMBEDDING_PRESETS.map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => handleEmbeddingPreset(p)}
                              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-ink)]/10"
                            >
                              <span className="font-medium">{p.label}</span>
                              <span className="text-[var(--color-ink-faint)] ml-2 text-xs">{p.model}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={embeddingBaseUrl}
                    onChange={(e) => {
                      setEmbeddingBaseUrl(e.target.value)
                      setEmbeddingValidationStatus('idle')
                    }}
                    placeholder="https://api.siliconflow.cn/v1"
                    className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--color-ink-light)] mb-2">API Key</label>
                  <input
                    type="password"
                    value={embeddingApiKey}
                    onChange={(e) => {
                      setEmbeddingApiKey(e.target.value)
                      setEmbeddingValidationStatus('idle')
                    }}
                    placeholder="sk-..."
                    className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--color-ink-light)] mb-2">嵌入模型名称</label>
                  <input
                    type="text"
                    value={embeddingModel}
                    onChange={(e) => {
                      setEmbeddingModel(e.target.value)
                      setEmbeddingValidationStatus('idle')
                    }}
                    placeholder="BAAI/bge-m3"
                    className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] font-mono text-sm"
                  />
                  <p className="text-xs text-[var(--color-ink-faint)] mt-1">
                    硅基流动: BAAI/bge-m3、Qwen3-Embedding-0.6B 等；OpenRouter / AIHubMix 见各平台文档。
                  </p>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={handleValidateEmbedding}
                    disabled={!embeddingBaseUrl || !embeddingApiKey || !embeddingModel || embeddingValidationStatus === 'loading'}
                    className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-ink)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {embeddingValidationStatus === 'loading' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-[var(--color-ink-faint)] border-t-transparent rounded-full animate-spin" />
                        验证中...
                      </span>
                    ) : (
                      '验证连接'
                    )}
                  </button>
                  {embeddingValidationMsg && (
                    <p
                      className={`mt-2 text-sm ${
                        embeddingValidationStatus === 'success' ? 'text-green-600' : 'text-red-500'
                      }`}
                    >
                      {embeddingValidationStatus === 'success' ? '✓' : '✗'} {embeddingValidationMsg}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Ribbon filter model (same API as main chat, optional different model) */}
          <section className="bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-2">
              过滤模型配置
            </h2>
            <p className="text-xs text-[var(--color-ink-faint)] mb-4">
              用于织带结果 AI 过滤（去除页眉页脚等低价值片段）。使用主 API（上方对话接口），仅模型可不同。留空则使用主模型；可填小模型名（如 deepseek-chat、qwen-turbo）以提速。需先在「织带偏好」中开启「织带结果经 AI 过滤」。
            </p>
            <div>
              <label className="block text-sm text-[var(--color-ink-light)] mb-2">过滤用小模型</label>
              <input
                type="text"
                value={ribbonFilterModel}
                onChange={(e) => {
                  setRibbonFilterModel(e.target.value)
                  setFilterValidationStatus('idle')
                }}
                placeholder="留空则使用主模型"
                className="w-full px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)] font-mono text-sm mb-3"
              />
              <div>
                <button
                  type="button"
                  onClick={handleValidateFilter}
                  disabled={!apiKey || !baseUrl || filterValidationStatus === 'loading'}
                  className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-ink)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {filterValidationStatus === 'loading' ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-[var(--color-ink-faint)] border-t-transparent rounded-full animate-spin" />
                      验证中...
                    </span>
                  ) : (
                    '验证连接'
                  )}
                </button>
                {filterValidationMsg && (
                  <p
                    className={`mt-2 text-sm ${
                      filterValidationStatus === 'success' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {filterValidationStatus === 'success' ? '✓' : '✗'} {filterValidationMsg}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Ribbon Preferences Section */}
          <section className="bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-4">
              织带偏好
            </h2>

            <div className="space-y-6">
              {/* Ribbon update delay */}
              <div>
                <label htmlFor="ribbonPauseSeconds" className="block text-sm text-[var(--color-ink-light)] mb-2">
                  停止输入多少秒后更新织带
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="ribbonPauseSeconds"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={ribbonPauseSeconds}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10)
                      if (!Number.isNaN(v)) setRibbonPauseSeconds(Math.min(10, Math.max(1, v)))
                    }}
                    className="w-20 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]"
                  />
                  <span className="text-sm text-[var(--color-ink-faint)]">秒（1–10）</span>
                </div>
                <p className="text-xs text-[var(--color-ink-faint)] mt-1">
                  停笔后经过该秒数即触发织带检索与更新。若感觉更新太频繁可调大（如 3–4 秒），若希望更快可调小。
                </p>
              </div>

              {/* Ribbon slot count */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  织带格数
                </label>
                <div className="flex gap-2">
                  {([5, 6, 7, 8] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRibbonSlotCount(n)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        ribbonSlotCount === n
                          ? 'border-[var(--color-btn-primary-bg)] bg-[var(--color-btn-primary-bg)]/10 text-[var(--color-ink)]'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-ink)]/5'
                      }`}
                    >
                      {n} 格
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--color-ink-faint)] mt-1">
                  织带最多显示的条目数（5–8），避免重叠。
                </p>
              </div>

              {/* Allocation mode */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  内容分配模式
                </label>
                <select
                  value={allocationMode}
                  onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
                  className="w-full px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm"
                >
                  <option value="balanced">均衡模式 - 各模块均匀分配</option>
                  <option value="rag_priority">共鸣优先 - 优先展示知识库内容</option>
                  <option value="ai_priority">灵感优先 - 优先展示AI生成内容</option>
                  <option value="custom_priority">自定义优先 - 优先展示自定义模块</option>
                </select>
                <p className="text-xs text-[var(--color-ink-faint)] mt-1">
                  {allocationMode === 'balanced' && '各模块按权重均衡分配'}
                  {allocationMode === 'rag_priority' && '知识库内容占更多槽位'}
                  {allocationMode === 'ai_priority' && 'AI 意象、润色等占更多槽位'}
                  {allocationMode === 'custom_priority' && '自定义模块（如百科）占更多槽位'}
                </p>
              </div>

              {/* Ribbon content modules */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  内容模块（启用多个同时生效，固定来源最多 5 个）
                </label>
                <RibbonModulesEditor
                  ribbonModules={ribbonModules}
                  setRibbonModules={setRibbonModules}
                  onAddCustomPrompt={() => setShowAddModule(true)}
                  onManageCustomPrompts={() => setShowPromptManager(true)}
                  onEditModulePrompt={(moduleId, moduleType, currentPrompt, currentModel, currentLabel) => {
                    setEditingModuleId(moduleId)
                    setEditingModuleType(moduleType)
                    setEditingModulePrompt(currentPrompt ?? '')
                    setEditingModuleModel(currentModel)
                    setEditingModuleLabel(currentLabel)
                  }}
                />
                <p className="text-xs text-[var(--color-ink-faint)] mt-2">
                  勾选的模块会同时生效，风格由各模块决定（意象 / 润色 / 叙事 / 引用等）。点击「+ 添加自定义」可创建新的提示词模块。
                </p>
              </div>

              {/* Semantic expansion for RAG - optimized copy */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <input
                  type="checkbox"
                  id="semanticExpansion"
                  checked={semanticExpansion}
                  onChange={(e) => setSemanticExpansion(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-border)]"
                />
                <label htmlFor="semanticExpansion" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    智能扩展查询词
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-faint)]">
                      {semanticExpansion ? '已开启 · 召回优先' : '已关闭 · 速度优先'}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1.5 leading-relaxed">
                    开启后，AI 会将「春天」扩展为「春天 花开 温暖 春风」等同义词再检索，能召回更多相关段落。
                    <span className="text-[var(--color-ink-light)]">适合：找不到相关内容时尝试开启。</span>
                    <br />
                    <span className="text-[var(--color-accent)]">注意：会增加约 1-2 秒检索时间。</span>
                  </span>
                </label>
              </div>

              {/* Ribbon AI filter (post-retrieval) */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="ribbonAiFilter"
                  checked={ribbonAiFilter}
                  onChange={(e) => setRibbonAiFilter(e.target.checked)}
                  className="mt-1 rounded border-[var(--color-border)]"
                />
                <label htmlFor="ribbonAiFilter" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    织带结果经 AI 过滤
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1">
                    检索后用模型快速过滤掉页眉页脚、水印、元数据等低价值片段。过滤用模型在上方「织带过滤模型」中配置。
                  </span>
                </label>
              </div>

              {/* Knowledge Base Management Link */}
              <div className="pt-4 border-t border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm text-[var(--color-ink-light)] mb-1">
                      共鸣库管理
                    </label>
                    <p className="text-xs text-[var(--color-ink-faint)]">
                      已创建 {kbStats.baseCount} 个库，共 {kbStats.totalFiles} 本书籍
                    </p>
                  </div>
                  <button
                    onClick={() => setShowKbManager(true)}
                    className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 transition-colors"
                  >
                    管理共鸣库
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Appearance / 界面偏好 */}
          <section className="bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border border-[var(--color-border)] p-6">
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-4">
              界面偏好
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  主题
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'light' as const, label: '浅色' },
                    { value: 'dark' as const, label: '深色' },
                    { value: 'system' as const, label: '跟随系统' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      className={`px-4 py-2 border rounded-lg text-sm transition-colors ${
                        theme === value
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/10 text-[var(--color-ink)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)] text-[var(--color-ink)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--color-ink-faint)] mt-1.5">
                  跟随系统将随系统浅色/深色自动切换
                </p>
              </div>
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  字号
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 'small' as const, label: '小' },
                    { value: 'medium' as const, label: '中' },
                    { value: 'large' as const, label: '大' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFontSize(value)}
                      className={`px-4 py-2 border rounded-lg text-sm transition-colors ${
                        fontSize === value
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/10 text-[var(--color-ink)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)] text-[var(--color-ink)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="flex justify-between items-center pt-4">
            <button
              onClick={() => setShowAbout(true)}
              className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-ink-light)] hover:text-[var(--color-ink)] hover:bg-[var(--color-ink)]/5 transition-colors"
            >
              关于 / 帮助
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded-lg hover:opacity-90 transition-opacity"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>

      {/* Knowledge Base Manager Modal */}
      <KnowledgeBaseManager
        isOpen={showKbManager}
        onClose={() => {
          setShowKbManager(false)
          refreshKbStats()
        }}
      />

      {/* Custom Prompt Manager Modal */}
      <CustomPromptManager
        isOpen={showPromptManager}
        onClose={() => setShowPromptManager(false)}
      />

      {/* Add Custom Module Modal */}
      {showAddModule && (
        <AddCustomModuleModal
          isOpen={showAddModule}
          onClose={() => setShowAddModule(false)}
          onAdd={handleAddCustomModule}
        />
      )}

      {/* Module Prompt Edit Modal */}
      {editingModuleId && (
        <ModulePromptEditModal
          isOpen={!!editingModuleId}
          onClose={() => setEditingModuleId(null)}
          moduleId={editingModuleId}
          moduleType={editingModuleType}
          moduleLabel={ribbonModules.find(m => m.id === editingModuleId)?.label ?? BUILTIN_RIBBON_MODULES.find(m => m.id === editingModuleId)?.label ?? '自定义模块'}
          currentPrompt={editingModulePrompt}
          currentModel={editingModuleModel}
          currentLabel={editingModuleLabel}
          onSave={(prompt, model, label, customOptions) => {
            if (editingModuleType === 'custom') {
              customPromptService.update(editingModuleId, {
                content: prompt,
                name: label ?? undefined,
                useRag: customOptions?.useRag,
                ragFallback: customOptions?.ragFallback,
              })
            }
            setRibbonModules(prev => prev.map(m => m.id === editingModuleId ? { ...m, prompt: editingModuleType === 'custom' ? undefined : prompt, model, label: label || m.label } : m))
            setEditingModuleId(null)
            toast.success('模块配置已保存')
          }}
          onReset={() => {
            setRibbonModules(prev => prev.map(m => m.id === editingModuleId ? { ...m, prompt: undefined, model: undefined } : m))
            setEditingModuleId(null)
            toast.success('已恢复默认配置')
          }}
        />
      )}

      {/* About / Help Modal */}
      <AboutModal
        isOpen={showAbout}
        onClose={() => setShowAbout(false)}
      />
    </div>
  )
}

// Modal for adding custom module
interface AddCustomModuleModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (name: string, prompt: string) => void
}

function AddCustomModuleModal({ isOpen, onClose, onAdd }: AddCustomModuleModalProps) {
  const { settings } = useSettings()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const [hasInitialized, setHasInitialized] = useState(false)

  useEffect(() => {
    if (isOpen && !hasInitialized) {
      setName('')
      setDescription('')
      setPrompt('')
      setHasInitialized(true)
    }
    if (!isOpen) {
      setHasInitialized(false)
    }
  }, [isOpen, hasInitialized])

  const handleGenerate = async () => {
    if (!description.trim() || !settings.apiKey) return
    setIsGenerating(true)
    try {
      const generated = await generatePromptFromDescription(description, settings)
      if (generated) {
        setPrompt(generated)
      } else {
        toast.error('生成失败，请检查 API 配置或稍后重试')
      }
    } catch (err) {
      toast.error('生成失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
    setIsGenerating(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h3 className="font-medium text-[var(--color-ink)]">添加自定义模块</h3>
          <button onClick={onClose} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">模块名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：诗歌润色"
              className="w-full px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">提示词描述（可选）</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述你想要的提示词效果，点击右侧按钮让AI生成..."
                className="flex-1 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm"
              />
              <button
                onClick={handleGenerate}
                disabled={!description.trim() || !settings.apiKey || isGenerating}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 disabled:opacity-40"
              >
                {isGenerating ? '生成中...' : 'AI生成'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">提示词内容</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入系统提示词，定义AI的角色和任务..."
              className="w-full h-48 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button onClick={onClose} className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm">取消</button>
          <button
            onClick={() => { if (name.trim() && prompt.trim()) { onAdd(name.trim(), prompt.trim()) } }}
            disabled={!name.trim() || !prompt.trim()}
            className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}

// Modal for editing module prompt
interface ModulePromptEditModalProps {
  isOpen: boolean
  onClose: () => void
  moduleId: string
  moduleType: RibbonModuleType
  moduleLabel: string
  currentPrompt: string
  currentModel?: string
  currentLabel?: string
  onSave: (prompt: string, model?: string, label?: string, customOptions?: { useRag?: boolean; ragFallback?: boolean }) => void
  onReset: () => void
}

function ModulePromptEditModal({
  isOpen,
  onClose,
  moduleId,
  moduleType,
  moduleLabel,
  currentPrompt,
  currentModel,
  currentLabel,
  onSave,
  onReset,
}: ModulePromptEditModalProps) {
  const { settings } = useSettings()
  const [prompt, setPrompt] = useState(currentPrompt || getDefaultPromptForModule(moduleType) || '')
  const [model, setModel] = useState(currentModel || '')
  const [label, setLabel] = useState(currentLabel || '')
  const [useRag, setUseRag] = useState(true)
  const [ragFallback, setRagFallback] = useState(true)
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

  const defaultPrompt = getDefaultPromptForModule(moduleType)
  const effectivePrompt = prompt || defaultPrompt || ''

  useEffect(() => {
    // If no custom prompt, fill with default prompt so user can see it
    setPrompt(currentPrompt || defaultPrompt || '')
    setModel(currentModel || '')
    setLabel(currentLabel || '')
    if (moduleType === 'custom') {
      const cp = customPromptService.get(moduleId)
      setUseRag(cp?.useRag ?? true)
      setRagFallback(cp?.ragFallback ?? true)
    }
    setShowDefault(false)
  }, [currentPrompt, currentModel, currentLabel, defaultPrompt, moduleType, moduleId])

  const handleGenerate = async () => {
    if (!description.trim() || !settings.apiKey) return
    setIsGenerating(true)
    try {
      const generated = await generatePromptFromDescription(description, settings)
      if (generated) {
        setPrompt(generated)
        setShowDefault(false)
      } else {
        toast.error('生成失败，请检查 API 配置或稍后重试')
      }
    } catch (err) {
      toast.error('生成失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
    setIsGenerating(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] shadow-lg w-full max-w-2xl max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div>
            <h3 className="font-medium text-[var(--color-ink)]">编辑模块：{moduleLabel}</h3>
            {defaultPrompt && (
              <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">
                {currentPrompt ? '已使用自定义提示词' : '使用默认提示词'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">✕</button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Module name editing */}
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">模块名称</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={moduleLabel}
                className="flex-1 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm"
              />
              {label && label !== moduleLabel && (
                <button
                  onClick={() => setLabel('')}
                  className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline"
                >
                  恢复默认
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--color-ink-faint)] mt-1">
              自定义名称，留空使用默认名称「{moduleLabel}」
            </p>
          </div>

          {/* AI Generate from description */}
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">提示词描述（可选，AI生成）</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述你想要的提示词效果..."
                className="flex-1 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm"
              />
              <button
                onClick={handleGenerate}
                disabled={!description.trim() || !settings.apiKey || isGenerating}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 disabled:opacity-40"
              >
                {isGenerating ? '生成中...' : 'AI生成'}
              </button>
            </div>
          </div>

          {/* Custom module RAG options */}
          {moduleType === 'custom' && (
            <div className="space-y-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
              <p className="text-xs font-medium text-[var(--color-ink-light)]">共鸣库（RAG）配置</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRag}
                  onChange={(e) => setUseRag(e.target.checked)}
                  className="rounded border-[var(--color-border)]"
                />
                <span className="text-sm text-[var(--color-ink)]">使用共鸣库上下文（RAG）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ragFallback}
                  onChange={(e) => setRagFallback(e.target.checked)}
                  className="rounded border-[var(--color-border)]"
                />
                <span className="text-sm text-[var(--color-ink)]">RAG 失败时自动降级为仅用户上下文</span>
              </label>
              <p className="text-xs text-[var(--color-ink-faint)]">
                开启后，自定义模块可结合知识库内容生成；失败时自动降级。
              </p>
            </div>
          )}

          {/* Model selection */}
          <div>
            <label className="block text-sm text-[var(--color-ink-light)] mb-1">使用模型（可选）</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={`留空使用主模型 (${settings.model})`}
                className="flex-1 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm font-mono"
              />
              {model && (
                <button
                  onClick={() => setModel('')}
                  className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline"
                >
                  使用默认
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--color-ink-faint)] mt-1">
              为该模块指定专用模型，留空则使用主模型配置
            </p>
          </div>

          {/* Prompt content */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-[var(--color-ink-light)]">提示词内容</label>
              {defaultPrompt && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowDefault(!showDefault)}
                    className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] underline"
                  >
                    {showDefault ? '隐藏默认提示词' : '查看默认提示词'}
                  </button>
                </div>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setShowDefault(false); }}
              placeholder={defaultPrompt ? "输入自定义提示词覆盖默认，或留空使用默认..." : "输入系统提示词..."}
              className="w-full h-48 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            {showDefault && defaultPrompt && (
              <div className="mt-2 p-3 bg-[var(--color-paper-warm)] rounded-lg border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-ink-faint)] mb-1">默认提示词：</p>
                <pre className="text-xs text-[var(--color-ink)] whitespace-pre-wrap">{defaultPrompt}</pre>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-between px-4 py-3 border-t border-[var(--color-border)]">
          {defaultPrompt ? (
            <button
              onClick={() => { setPrompt(''); setModel(''); setLabel(''); onReset(); }}
              disabled={!currentPrompt && !currentModel && !currentLabel}
              className="px-4 py-2 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] disabled:opacity-30"
            >
              恢复默认
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5">取消</button>
            <button
              onClick={() => onSave(
                prompt.trim(),
                model.trim() || undefined,
                label.trim() || undefined,
                moduleType === 'custom' ? { useRag, ragFallback } : undefined
              )}
              className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
