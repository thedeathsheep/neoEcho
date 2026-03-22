'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { AboutModal } from '@/components/help/about-modal'
import { CustomPromptManager } from '@/components/ui/custom-prompt-manager'
import { KnowledgeBaseManager } from '@/components/ui/knowledge-base-manager'
import {
  BUILTIN_RIBBON_MODULES,
  getAmbientCustomPrompts,
  MAX_ENABLED_AMBIENT_MODULES,
  RECOMMENDED_ENABLED_AMBIENT_MODULES,
  sanitizeRibbonModules,
  useSettings,
} from '@/lib/settings-context'
import { generatePromptFromDescription,getDefaultPromptForModule, validateApiKey } from '@/services/client-ai.service'
import { customPromptService } from '@/services/custom-prompt.service'
import { validateEmbeddingApi } from '@/services/embedding.service'
import { knowledgeBaseService } from '@/services/knowledge-base.service'
import type { AllocationMode,RibbonModuleConfig, RibbonModuleType, RibbonSlotCount } from '@/types'

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

function countEnabledAmbientModules(modules: RibbonModuleConfig[]): number {
  return modules.filter((module) => module.type !== 'rag' && module.enabled).length
}

function buildRibbonModulesForSettings(modules: RibbonModuleConfig[]): RibbonModuleConfig[] {
  const byId = new Map(modules.map((module) => [module.id, module]))
  const builtin = BUILTIN_RIBBON_MODULES.filter((module) => module.type !== 'quick').map((module) => {
    const saved = byId.get(module.id)
    return {
      ...module,
      label: saved?.label ?? module.label,
      enabled: saved?.enabled ?? (module.id === 'rag' || module.id === 'ai:imagery'),
      pinned: saved?.pinned ?? false,
      prompt: saved?.prompt,
      model: saved?.model,
    }
  })
  const custom = getAmbientCustomPrompts().map((prompt) => {
    const saved = byId.get(prompt.id)
    return {
      id: prompt.id,
      type: 'custom' as const,
      label: saved?.label ?? prompt.name,
      enabled: saved?.enabled ?? false,
      pinned: saved?.pinned ?? false,
      prompt: saved?.prompt,
      model: saved?.model,
    }
  })
  return sanitizeRibbonModules([...builtin, ...custom])
}

function isSameRibbonModuleState(left: RibbonModuleConfig[], right: RibbonModuleConfig[]) {
  if (left.length !== right.length) return false
  return left.every((module, index) => {
    const peer = right[index]
    return (
      module.id === peer.id &&
      module.type === peer.type &&
      module.label === peer.label &&
      module.enabled === peer.enabled &&
      module.pinned === peer.pinned &&
      module.prompt === peer.prompt &&
      module.model === peer.model
    )
  })
}

function RibbonModulesEditor({
  ribbonModules,
  setRibbonModules,
  onManageCustomPrompts,
  onEditModulePrompt,
}: {
  ribbonModules: RibbonModuleConfig[]
  setRibbonModules: React.Dispatch<React.SetStateAction<RibbonModuleConfig[]>>
  onManageCustomPrompts: () => void
  onEditModulePrompt: (moduleId: string, moduleType: RibbonModuleType, currentPrompt?: string, currentModel?: string, currentLabel?: string) => void
}) {
  const activeBase = knowledgeBaseService.getActive()
  const ragFixedCount = Math.min(RAG_PINNED_MAX, activeBase?.mandatoryBooks?.length ?? 0)
  const customPrompts = getAmbientCustomPrompts()
  const isPinEligible = (mod: RibbonModuleConfig) => {
    if (mod.type === 'rag') return false
    return mod.id !== 'quick:helper'
  }

  const byId = new Map(sanitizeRibbonModules(ribbonModules).map((m) => [m.id, m]))

  const builtin = BUILTIN_RIBBON_MODULES.filter((b) => b.id !== 'quick:helper').map((b) => ({
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
  const enabledAmbientCount = countEnabledAmbientModules(displayModules)
  const isOverRecommended = enabledAmbientCount > RECOMMENDED_ENABLED_AMBIENT_MODULES
  const canEnableMore = enabledAmbientCount < MAX_ENABLED_AMBIENT_MODULES

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

  const setEnabled = (mod: RibbonModuleConfig, enabled: boolean) => {
    if (!enabled) {
      updateModule(mod.id, { enabled: false, pinned: false })
      return
    }
    if (mod.type !== 'rag' && !mod.enabled && !canEnableMore) {
      toast.error(`织带生成模块最多同时启用 ${MAX_ENABLED_AMBIENT_MODULES} 个；再多会明显拖慢刷新并放大超时。`)
      return
    }
    updateModule(mod.id, { enabled: true })
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
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs text-[var(--color-ink-faint)]">
            每启用 1 个非共鸣库模块，就会新增 1 个后台生成请求。建议保持在 {RECOMMENDED_ENABLED_AMBIENT_MODULES} 个以内，硬上限 {MAX_ENABLED_AMBIENT_MODULES} 个。
          </p>
          <p className="text-xs text-[var(--color-ink-faint)]">
            固定 {totalPinned}/{MAX_PINNED}，表示该模块有候选时优先显示；详情型自定义模块不会出现在织带里。
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onManageCustomPrompts}
            className="px-2 py-1 border border-[var(--color-border)] rounded hover:bg-[var(--color-ink)]/5 transition-colors"
          >
            自定义模块
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 ${isOverRecommended ? 'bg-amber-500/10 text-amber-600' : 'bg-[var(--color-paper)] text-[var(--color-ink-faint)]'}`}>
          已启用生成模块 {enabledAmbientCount}/{MAX_ENABLED_AMBIENT_MODULES}
        </span>
        <span className="rounded-full bg-[var(--color-paper)] px-2 py-1 text-[var(--color-ink-faint)]">
          推荐不超过 {RECOMMENDED_ENABLED_AMBIENT_MODULES}
        </span>
        <span className="rounded-full bg-[var(--color-paper)] px-2 py-1 text-[var(--color-ink-faint)]">
          ambient 自定义 {customPrompts.length}
        </span>
      </div>
      {isOverRecommended && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          当前勾选已经进入高负载区。刷新会变慢，超时和织带抖动都会明显增加；如果只是日常写作，先保留 2-3 个最常用模块更稳。
        </div>
      )}
      <div className="divide-y divide-[var(--color-border)]/60">
        {displayModules.map((mod) => (
          <div key={mod.id} className="flex items-center gap-3 py-2 group">
          <input
            type="checkbox"
            id={`ribbon-enable-${mod.id}`}
            checked={mod.enabled}
            onChange={(e) => setEnabled(mod, e.target.checked)}
            className="rounded border-[var(--color-border)]"
          />
          <label htmlFor={`ribbon-enable-${mod.id}`} className="flex-1 text-sm text-[var(--color-ink)] min-w-0 truncate">
            {getModuleLabel(mod)}
          </label>
          {/* Edit button for AI modules (built-in, custom, and quick) */}
          {isPinEligible(mod) && (
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
              强制检索 {ragFixedCount} 本
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
          {isPinEligible(mod) && (
            <label htmlFor={`ribbon-pin-${mod.id}`} className="text-xs text-[var(--color-ink-faint)]">
              固定
            </label>
          )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { settings, updateSettings } = useSettings()
  const initialRibbonRunProfile =
    settings.ribbonRunProfile ??
    (settings.reliableRibbonMode ? 'reliable' : settings.lowLatencyMode ? 'fast' : 'balanced')
  const initialRibbonSettings = settings.ribbonSettings
  const initialRibbonModules = buildRibbonModulesForSettings(
    initialRibbonSettings?.modules?.length
      ? initialRibbonSettings.modules
      : BUILTIN_RIBBON_MODULES.filter((m) => m.type !== 'quick').map((m) => ({
          ...m,
          enabled: m.id === 'rag' || m.id === 'ai:imagery',
          pinned: false,
        })),
  )

  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [ribbonRunProfile, setRibbonRunProfile] = useState<'balanced' | 'fast' | 'reliable'>(
    initialRibbonRunProfile
  )
  const [semanticExpansion, setSemanticExpansion] = useState(
    initialRibbonRunProfile === 'fast' ? false : (settings.semanticExpansion ?? false),
  )
  const [ribbonAiFilter, setRibbonAiFilter] = useState(settings.ribbonAiFilter ?? false)
  const [ragRerankEnabled, setRagRerankEnabled] = useState(
    initialRibbonRunProfile === 'fast' ? false : (settings.ragRerankEnabled ?? false),
  )
  const [sensoryZoomEnabled, setSensoryZoomEnabled] = useState(settings.sensoryZoomEnabled ?? true)
  const [clicheDetectionEnabled, setClicheDetectionEnabled] = useState(settings.clicheDetectionEnabled ?? false)
  const [ribbonFilterModel, setRibbonFilterModel] = useState(settings.ribbonFilterModel ?? '')
  const [ribbonPauseSeconds, setRibbonPauseSeconds] = useState(settings.ribbonPauseSeconds ?? 2)
  const [ribbonSlotCount, setRibbonSlotCount] = useState<RibbonSlotCount>(
    (initialRibbonSettings?.slotCount ?? 5) as RibbonSlotCount
  )
  const [allocationMode, setAllocationMode] = useState<AllocationMode>(
    (initialRibbonSettings?.allocationMode ?? 'balanced') as AllocationMode
  )
  const [ribbonModules, setRibbonModules] = useState<RibbonModuleConfig[]>(initialRibbonModules)
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

  const isFastProfile = ribbonRunProfile === 'fast'

  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle')
  const [validationMsg, setValidationMsg] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [showKbManager, setShowKbManager] = useState(false)
  const [showPromptManager, setShowPromptManager] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  // Module prompt editing
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null)
  const [editingModuleType, setEditingModuleType] = useState<RibbonModuleType>('custom')
  const [editingModulePrompt, setEditingModulePrompt] = useState('')
  const [editingModuleModel, setEditingModuleModel] = useState<string | undefined>(undefined)
  const [editingModuleLabel, setEditingModuleLabel] = useState<string | undefined>(undefined)

  const applyRibbonRunProfile = (profile: 'balanced' | 'fast' | 'reliable') => {
    setRibbonRunProfile(profile)
    if (profile === 'fast') {
      setSemanticExpansion(false)
      setRagRerankEnabled(false)
    }
  }

  const syncRibbonModulesFromCustomPrompts = useCallback(() => {
    setRibbonModules((prev) => {
      const next = buildRibbonModulesForSettings(prev)
      return isSameRibbonModuleState(prev, next) ? prev : next
    })
  }, [])

  useEffect(() => {
    const handlePromptsUpdated = () => {
      syncRibbonModulesFromCustomPrompts()
    }
    window.addEventListener('custom-prompts-updated', handlePromptsUpdated)
    return () => window.removeEventListener('custom-prompts-updated', handlePromptsUpdated)
  }, [syncRibbonModulesFromCustomPrompts])

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

  // Custom module management is now handled directly in the module editor

  const handleSave = () => {
    const effectiveSemanticExpansion = isFastProfile ? false : semanticExpansion
    const effectiveRagRerank = isFastProfile ? false : ragRerankEnabled
    const effectiveLowLatencyMode = ribbonRunProfile === 'fast'
    const effectiveReliableRibbonMode = ribbonRunProfile === 'reliable'
    const sanitizedRibbonModules = sanitizeRibbonModules(ribbonModules)
    const enabledAmbientBeforeSave = countEnabledAmbientModules(ribbonModules)
    const enabledAmbientAfterSave = countEnabledAmbientModules(sanitizedRibbonModules)
    if (enabledAmbientAfterSave !== enabledAmbientBeforeSave) {
      setRibbonModules(sanitizedRibbonModules)
    }
    updateSettings({
      apiKey,
      model,
      baseUrl,
      ribbonRunProfile,
      semanticExpansion: effectiveSemanticExpansion,
      ribbonAiFilter,
      ragRerankEnabled: effectiveRagRerank,
      lowLatencyMode: effectiveLowLatencyMode,
      sensoryZoomEnabled,
      clicheDetectionEnabled,
      reliableRibbonMode: effectiveReliableRibbonMode,
      ribbonFilterModel: ribbonFilterModel.trim(),
      ribbonPauseSeconds: Math.min(10, Math.max(1, ribbonPauseSeconds)),
      ribbonSettings: {
        slotCount: ribbonSlotCount,
        allocationMode,
        modules: [
          ...BUILTIN_RIBBON_MODULES.filter((b) => b.type !== 'quick').map((b) => {
            const saved = sanitizedRibbonModules.find((m) => m.id === b.id)
            return {
              ...b,
              enabled: saved?.enabled ?? (b.id === 'rag' || b.id === 'ai:imagery'),
              pinned: saved?.pinned ?? false,
            }
          }),
          ...sanitizedRibbonModules.filter((m) => m.type === 'custom'),
        ],
      },
      theme,
      fontSize,
      useEmbeddingApi,
      embeddingBaseUrl,
      embeddingApiKey,
      embeddingModel,
    })
    toast.success(
      enabledAmbientAfterSave !== enabledAmbientBeforeSave
        ? `设置已保存；织带模块已自动收敛到最多 ${MAX_ENABLED_AMBIENT_MODULES} 个生成来源`
        : '设置已保存',
    )
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

  const validationTone: Record<ValidationStatus, string> = {
    idle: 'text-[var(--color-ink-faint)]',
    loading: 'text-yellow-600',
    success: 'text-green-600',
    error: 'text-red-500',
  }

  const validationCopy: Record<ValidationStatus, string> = {
    idle: '尚未验证',
    loading: '正在验证连接',
    success: '连接成功',
    error: validationMsg || '连接失败',
  }
  const hasApiKey = apiKey.trim().length > 0
  const enabledAmbientModuleCount = countEnabledAmbientModules(ribbonModules)
  const ambientPromptCount = getAmbientCustomPrompts().length
  const ribbonLoadLabel =
    enabledAmbientModuleCount > RECOMMENDED_ENABLED_AMBIENT_MODULES
      ? '高负载'
      : enabledAmbientModuleCount === 0
        ? '未启用'
        : '正常'

  return (
    <div className="min-h-screen bg-[var(--color-paper)] pb-24">
      <div className="sticky top-0 z-20 border-b border-[var(--color-border)]/70 bg-[var(--color-paper)]/92 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-3xl font-serif text-[var(--color-ink)]">设置</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
              把连接、织带和界面控制在一页里，少跳转，少猜测。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAbout(true)}
              className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-ink-light)] hover:text-[var(--color-ink)] hover:bg-[var(--color-ink)]/5 transition-colors"
            >
              关于 / 帮助
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] rounded-lg hover:opacity-90 transition-opacity"
            >
              保存设置
            </button>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-6 pt-8">
        <div className="mb-8 grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper-warm)] p-4 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--color-surface)] px-4 py-3">
            <div className="text-xs text-[var(--color-ink-faint)]">主模型</div>
            <div className="mt-1 text-sm font-medium text-[var(--color-ink)]">
              {validationStatus === 'success' ? '已连接' : hasApiKey ? '待验证' : '未配置'}
            </div>
            <div className="mt-1 text-xs text-[var(--color-ink-faint)]">{model || '未填写模型名'}</div>
          </div>
          <div className="rounded-xl bg-[var(--color-surface)] px-4 py-3">
            <div className="text-xs text-[var(--color-ink-faint)]">织带负载</div>
            <div className="mt-1 text-sm font-medium text-[var(--color-ink)]">{ribbonLoadLabel}</div>
            <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
              已启用 {enabledAmbientModuleCount} 个生成模块，运行档为 {ribbonRunProfile}
            </div>
          </div>
          <div className="rounded-xl bg-[var(--color-surface)] px-4 py-3">
            <div className="text-xs text-[var(--color-ink-faint)]">自定义模块</div>
            <div className="mt-1 text-sm font-medium text-[var(--color-ink)]">{ambientPromptCount} 个 ambient 模块</div>
            <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
              detail 模块只在详情解释中使用，不会进入织带
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <section className="bg-[var(--color-paper-warm)] backdrop-blur rounded-xl border border-[var(--color-border)] p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-medium text-[var(--color-ink)]">
                  主模型配置
                </h2>
                <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">
                  用于织带AI模块生成内容（意象/润色/叙事/引用等）
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium ${validationTone[validationStatus]}`}>
                  {validationCopy[validationStatus]}
                </span>
                <button
                  onClick={handleValidate}
                  disabled={!apiKey || !baseUrl || validationStatus === 'loading'}
                  className="px-3 py-1.5 text-xs border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-ink)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
              </div>
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

              {(validationMsg || availableModels.length > 0 || validationStatus !== 'idle') && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-2 text-xs">
                  <span className={validationTone[validationStatus]}>
                    {validationStatus === 'success' ? '✓' : validationStatus === 'error' ? '✗' : '•'} {validationCopy[validationStatus]}
                  </span>
                  {validationMsg && validationStatus !== 'success' && (
                    <span className="text-[var(--color-ink-faint)]">{validationMsg}</span>
                  )}
                  {availableModels.length > 0 && (
                    <span className="text-[var(--color-ink-faint)]">
                      已发现 {availableModels.length} 个可用模型
                    </span>
                  )}
                </div>
              )}
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
                  内容模块（启用多个同时生效，固定表示有候选时优先显示）
                </label>
                <RibbonModulesEditor
                  ribbonModules={ribbonModules}
                  setRibbonModules={setRibbonModules}
                  onManageCustomPrompts={() => setShowPromptManager(true)}
                  onEditModulePrompt={(moduleId, moduleType, currentPrompt, currentModel, currentLabel) => {
                    setEditingModuleId(moduleId)
                    setEditingModuleType(moduleType)
                    setEditingModulePrompt(currentPrompt ?? '')
                    setEditingModuleModel(currentModel)
                    setEditingModuleLabel(currentLabel)
                  }}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-ink-faint)]">
                  <span>每多勾选 1 个非共鸣库模块，就会多出 1 个后台生成请求；详情型自定义模块不会进入这里。</span>
                  <span>固定只影响展示优先级，不会让该模块跳过生成或超时；新建和编辑自定义模块都统一放在「自定义模块」里。</span>
                  <button
                    onClick={() => setShowKbManager(true)}
                    className="hover:text-[var(--color-ink)] underline underline-offset-2 transition-colors"
                  >
                    管理共鸣库
                  </button>
                </div>
              </div>

              {/* Ribbon run profile */}
              <div className="space-y-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <div className="flex items-center justify-between gap-3">
                  <label className="block font-medium text-sm text-[var(--color-ink)]">
                    织带运行档
                  </label>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    单选 · 用于避免互相冲突
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { value: 'balanced' as const, title: '均衡', desc: '日常使用，按开关生效' },
                    { value: 'fast' as const, title: '低延迟', desc: '速度优先（自动关闭部分增强）' },
                    { value: 'reliable' as const, title: '可靠（调试）', desc: '稳定优先（更长超时 + 可见占位）' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => applyRibbonRunProfile(opt.value)}
                      className={`text-left px-3 py-2 border rounded-lg transition-colors ${
                        ribbonRunProfile === opt.value
                          ? 'border-[var(--color-ink)] bg-[var(--color-ink)]/10 text-[var(--color-ink)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-ink-light)] text-[var(--color-ink)]'
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.title}</div>
                      <div className="text-xs text-[var(--color-ink-faint)] mt-0.5 leading-relaxed">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
                {ribbonRunProfile === 'fast' && (
                  <p className="text-xs text-[var(--color-ink-faint)] leading-relaxed">
                    已启用低延迟：将<strong>强制关闭</strong>「智能扩展查询词」与「RAG 重排」以降低等待时间。
                  </p>
                )}
                {ribbonRunProfile === 'reliable' && (
                  <p className="text-xs text-[var(--color-ink-faint)] leading-relaxed">
                    可靠（调试）档会优先确保你能看到产出：显示“生成中”占位卡、使用更长超时、并避免因探测失败而静默跳过模块。
                  </p>
                )}
              </div>

              {/* Semantic expansion for RAG - optimized copy */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <input
                  type="checkbox"
                  id="semanticExpansion"
                  checked={semanticExpansion}
                  disabled={isFastProfile}
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
                    <span className="text-[var(--color-accent)]">
                      注意：会增加约 1-2 秒检索时间。{isFastProfile ? '低延迟档已强制关闭。' : ''}
                    </span>
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

              {/* RAG rerank (multi-view + AI rerank) */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <input
                  type="checkbox"
                  id="ragRerankEnabled"
                  checked={ragRerankEnabled}
                  disabled={isFastProfile}
                  onChange={(e) => setRagRerankEnabled(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-border)]"
                />
                <label htmlFor="ragRerankEnabled" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    启用 RAG 重排
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-faint)]">
                      {ragRerankEnabled ? '已开启' : '已关闭'}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1.5 leading-relaxed">
                    多视角检索（全文/当前句/关键词）后，用模型对候选打分重排，提升相关性。
                    {isFastProfile ? '低延迟档已强制关闭。' : ''}
                  </span>
                </label>
              </div>

              {/* Sensory zoom */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <input
                  type="checkbox"
                  id="sensoryZoomEnabled"
                  checked={sensoryZoomEnabled}
                  onChange={(e) => setSensoryZoomEnabled(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-border)]"
                />
                <label htmlFor="sensoryZoomEnabled" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    感官假肢（细节放大）
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-faint)]">
                      {sensoryZoomEnabled ? '已开启' : '已关闭'}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1.5 leading-relaxed">
                    选中模糊感官句后点「感官放大」或 Alt+Z，从共鸣库涌现触觉/听觉/视觉等微观细节。
                  </span>
                </label>
              </div>

              {/* Cliché / style entropy detection */}
              <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]">
                <input
                  type="checkbox"
                  id="clicheDetectionEnabled"
                  checked={clicheDetectionEnabled}
                  onChange={(e) => setClicheDetectionEnabled(e.target.checked)}
                  className="mt-0.5 rounded border-[var(--color-border)]"
                />
                <label htmlFor="clicheDetectionEnabled" className="flex-1 cursor-pointer">
                  <span className="block font-medium text-sm text-[var(--color-ink)]">
                    风格熵增监测（套路语）
                    <span className="ml-2 text-xs font-normal text-[var(--color-ink-faint)]">
                      {clicheDetectionEnabled ? '已开启' : '已关闭'}
                    </span>
                  </span>
                  <span className="block text-xs text-[var(--color-ink-faint)] mt-1.5 leading-relaxed">
                    检测当前段落的陈词滥调，点击「套路语」从共鸣库获取非套路化替代表达。
                  </span>
                </label>
              </div>

              {/* Echo Gallery (curator report) */}
              <div className="pt-4 border-t border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm text-[var(--color-ink-light)] mb-1">
                      灵感策展集
                    </label>
                    <p className="text-xs text-[var(--color-ink-faint)]">
                      查看已复制回响的策展报告，可导出 Markdown
                    </p>
                  </div>
                  <a
                    href="/gallery"
                    className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-ink)]/5 transition-colors inline-block"
                  >
                    查看策展报告
                  </a>
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

        </div>
      </div>

      {/* Knowledge Base Manager Modal */}
      <KnowledgeBaseManager
        isOpen={showKbManager}
        onClose={() => setShowKbManager(false)}
      />

      {/* Custom Prompt Manager Modal */}
      <CustomPromptManager
        isOpen={showPromptManager}
        onClose={() => setShowPromptManager(false)}
      />

      {/* Module Prompt Edit Modal */}
      {editingModuleId && (
        <ModulePromptEditModal
          key={`${editingModuleId}:${editingModuleType}:${editingModuleLabel ?? ''}:${editingModuleModel ?? ''}`}
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
            toast.success('已恢复预置配置')
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
  const customPrompt = moduleType === 'custom' ? customPromptService.get(moduleId) : null
  const defaultPrompt = getDefaultPromptForModule(moduleType)
  const [prompt, setPrompt] = useState(currentPrompt || getDefaultPromptForModule(moduleType) || '')
  const [model, setModel] = useState(currentModel || '')
  const [label, setLabel] = useState(currentLabel || '')
  const [useRag, setUseRag] = useState(customPrompt?.useRag ?? false)
  const [ragFallback, setRagFallback] = useState(customPrompt?.ragFallback ?? false)
  const [description, setDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [showDefault, setShowDefault] = useState(false)

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
                {currentPrompt ? '已保存当前提示词' : '当前使用预置提示词'}
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
                  清空覆盖
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--color-ink-faint)] mt-1">
              模块显示名称可单独编辑；留空则沿用当前列表名称「{moduleLabel}」
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
                  跟随主模型
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
                    {showDefault ? '隐藏预置提示词' : '查看预置提示词'}
                  </button>
                </div>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setShowDefault(false); }}
              placeholder={defaultPrompt ? "输入该模块的提示词；留空则沿用当前预置内容..." : "输入该模块的提示词..."}
              className="w-full h-48 px-3 py-2 bg-[var(--color-paper)] border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            {showDefault && defaultPrompt && (
              <div className="mt-2 p-3 bg-[var(--color-paper-warm)] rounded-lg border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-ink-faint)] mb-1">预置提示词：</p>
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
              恢复预置
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

