'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useSettings, BUILTIN_RIBBON_MODULES } from '@/lib/settings-context'
import { validateApiKey } from '@/services/client-ai.service'
import { validateEmbeddingApi } from '@/services/embedding.service'
import { KnowledgeBaseManager } from '@/components/ui/knowledge-base-manager'
import { CustomPromptManager } from '@/components/ui/custom-prompt-manager'
import { knowledgeBaseService } from '@/services/knowledge-base.service'
import { customPromptService } from '@/services/custom-prompt.service'
import type { CustomPrompt, RibbonModuleConfig, RibbonSlotCount } from '@/types'

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
}: {
  ribbonModules: RibbonModuleConfig[]
  setRibbonModules: React.Dispatch<React.SetStateAction<RibbonModuleConfig[]>>
}) {
  const byId = new Map(ribbonModules.map((m) => [m.id, m]))
  const activeBase = knowledgeBaseService.getActive()
  const ragFixedCount = Math.min(RAG_PINNED_MAX, activeBase?.mandatoryBooks?.length ?? 0)
  const customPrompts = customPromptService.getAll()

  const builtin = BUILTIN_RIBBON_MODULES.map((b) => ({
    ...b,
    enabled: byId.get(b.id)?.enabled ?? (b.id === 'rag' || b.id === 'ai:imagery'),
    pinned: byId.get(b.id)?.pinned ?? false,
  }))
  const custom = customPrompts.map((p) => ({
    id: p.id,
    type: 'custom' as const,
    label: p.name,
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
      <p className="text-xs text-[var(--color-ink-faint)] mb-2">
        固定 {totalPinned}/{MAX_PINNED}（共鸣库强制检索在「共鸣库管理」中设置，最多 {RAG_PINNED_MAX} 本）
      </p>
      {displayModules.map((mod) => (
        <div key={mod.id} className="flex items-center gap-4 py-1.5">
          <input
            type="checkbox"
            id={`ribbon-enable-${mod.id}`}
            checked={mod.enabled}
            onChange={(e) => updateModule(mod.id, { enabled: e.target.checked })}
            className="rounded border-[var(--color-border)]"
          />
          <label htmlFor={`ribbon-enable-${mod.id}`} className="flex-1 text-sm text-[var(--color-ink)] min-w-0 truncate">
            {mod.label}
          </label>
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
  const [activeCustomPrompt, setActiveCustomPrompt] = useState<CustomPrompt | null>(null)
  const [semanticExpansion, setSemanticExpansion] = useState(settings.semanticExpansion ?? false)
  const [ribbonAiFilter, setRibbonAiFilter] = useState(settings.ribbonAiFilter ?? false)
  const [ribbonFilterModel, setRibbonFilterModel] = useState(settings.ribbonFilterModel ?? '')
  const [ribbonPauseSeconds, setRibbonPauseSeconds] = useState(settings.ribbonPauseSeconds ?? 2)
  const [ribbonSlotCount, setRibbonSlotCount] = useState<RibbonSlotCount>(
    (settings.ribbonSettings?.slotCount ?? 5) as RibbonSlotCount
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
  const [kbStats, setKbStats] = useState({ baseCount: 0, totalFiles: 0 })

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

  // Load custom prompt for display in management section
  useEffect(() => {
    const prompt = customPromptService.getActive()
    setActiveCustomPrompt(prompt)
  }, [showPromptManager])

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
        modules: ribbonModules,
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

  const handlePromptSelect = (promptId: string) => {
    customPromptService.setActive(promptId)
    const prompt = customPromptService.get(promptId)
    setActiveCustomPrompt(prompt)
    setShowPromptManager(false)
    toast.success('已选择自定义提示词')
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
              <h2 className="text-lg font-medium text-[var(--color-ink)]">
                AI 配置
              </h2>
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
              嵌入模型（织带语义检索）
            </h2>
            <p className="text-xs text-[var(--color-ink-faint)] mb-4">
              使用 API 嵌入可显著提升中文语义检索效果；不配置则使用本地模型（易失败或效果一般）。
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
              织带过滤模型（织带结果 AI 过滤）
            </h2>
            <p className="text-xs text-[var(--color-ink-faint)] mb-4">
              使用主 API（上方对话接口），仅模型可不同。留空则使用主模型；可填小模型名（如 deepseek-chat、qwen-turbo）以提速。需先在「织带偏好」中开启「织带结果经 AI 过滤」。
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

              {/* Ribbon content modules */}
              <div>
                <label className="block text-sm text-[var(--color-ink-light)] mb-2">
                  内容模块（启用多个同时生效，固定来源最多 5 个）
                </label>
                <RibbonModulesEditor
                  ribbonModules={ribbonModules}
                  setRibbonModules={setRibbonModules}
                />
                <p className="text-xs text-[var(--color-ink-faint)] mt-2">
                  勾选的模块会同时生效，风格由各模块决定（意象 / 润色 / 叙事 / 引用等）。
                </p>
              </div>

              {/* Semantic expansion for RAG */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="semanticExpansion"
                  checked={semanticExpansion}
                  onChange={(e) => setSemanticExpansion(e.target.checked)}
                  className="mt-1 rounded border-[var(--color-border)]"
                />
                <label htmlFor="semanticExpansion" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    语义扩展（织带检索）
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1">
                    用 AI 将当前输入扩展为相关词再检索，例如写「春天」时也能匹配到描写春天但未出现该词的段落。需配置 API 且会多一次轻量请求。
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

              {/* Custom Prompt Management (for custom modules in content modules) */}
              <div className="pt-4 border-t border-[var(--color-border)]">
                <label className="block text-sm text-[var(--color-ink-light)] mb-3">
                  自定义提示词
                </label>

                {activeCustomPrompt ? (
                    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-[var(--color-ink)]">
                            {activeCustomPrompt.name}
                          </h4>
                          {activeCustomPrompt.description && (
                            <p className="text-xs text-[var(--color-ink-faint)]">
                              {activeCustomPrompt.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs px-2 py-1 bg-[var(--color-ink)]/10 rounded text-[var(--color-ink)]">
                          当前选中
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-ink-faint)] line-clamp-2">
                        {activeCustomPrompt.content.slice(0, 100)}
                        {activeCustomPrompt.content.length > 100 ? '...' : ''}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-[var(--color-paper-warm)] border border-[var(--color-border)] rounded-lg p-4 text-sm text-[var(--color-ink-light)]">
                      还没有选择自定义提示词
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setShowPromptManager(true)}
                      className="flex-1 px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 transition-colors"
                    >
                      {activeCustomPrompt ? '切换提示词' : '选择提示词'}
                    </button>
                    <button
                      onClick={() => setShowPromptManager(true)}
                      className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 transition-colors"
                    >
                      管理全部
                    </button>
                  </div>

                <p className="text-xs text-[var(--color-ink-faint)] mt-2">
                  创建的自定义提示词会出现在上方内容模块列表中，勾选后即可在织带中使用。
                </p>
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

          <div className="flex justify-end pt-4">
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
        onSelect={handlePromptSelect}
        selectedId={activeCustomPrompt?.id ?? undefined}
      />
    </div>
  )
}
