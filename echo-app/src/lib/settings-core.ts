import type { RibbonModuleConfig, RibbonSettings } from '@/types'

export interface AmbientPromptLike {
  id: string
  name: string
}

export interface SettingsShape {
  apiKey: string
  model: string
  baseUrl: string
  ocrModel: string
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'medium' | 'large'
  activeKnowledgeBaseId: string | null
  ribbonRunProfile: 'balanced' | 'fast' | 'reliable'
  semanticExpansion: boolean
  useEmbeddingApi: boolean
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  ribbonAiFilter: boolean
  ribbonFilterModel: string
  ribbonPauseSeconds: number
  ribbonSettings: RibbonSettings
  ragRerankEnabled: boolean
  lowLatencyMode: boolean
  sensoryZoomEnabled: boolean
  clicheDetectionEnabled: boolean
  reliableRibbonMode: boolean
}

export const BUILTIN_RIBBON_MODULES: Omit<RibbonModuleConfig, 'enabled' | 'pinned'>[] = [
  { id: 'rag', type: 'rag', label: '共鸣库检索' },
  { id: 'ai:imagery', type: 'ai:imagery', label: '意象' },
  { id: 'ai:polish', type: 'ai:polish', label: '润色' },
  { id: 'ai:narrative', type: 'ai:narrative', label: '叙事' },
  { id: 'ai:quote', type: 'ai:quote', label: '引用' },
]

export const RECOMMENDED_ENABLED_AMBIENT_MODULES = 3
export const MAX_ENABLED_AMBIENT_MODULES = 4

export function sanitizeRibbonModulesWithAmbientPrompts(
  modules: RibbonModuleConfig[],
  ambientCustomIds: Set<string>,
): RibbonModuleConfig[] {
  const filtered = modules.filter(
    (module) =>
      module.id !== 'quick:helper' && (module.type !== 'custom' || ambientCustomIds.has(module.id)),
  )
  const enabledAmbientModules = filtered
    .map((module, index) => ({ module, index }))
    .filter(({ module }) => module.type !== 'rag' && module.enabled)
    .sort((left, right) => {
      if (left.module.pinned !== right.module.pinned) return left.module.pinned ? -1 : 1
      return left.index - right.index
    })
  const keepEnabledIds = new Set(
    enabledAmbientModules.slice(0, MAX_ENABLED_AMBIENT_MODULES).map(({ module }) => module.id),
  )

  return filtered.map((module) => {
    if (module.type === 'rag') return module
    if (module.enabled && !keepEnabledIds.has(module.id)) {
      return { ...module, enabled: false, pinned: false }
    }
    return module
  })
}

export function getDefaultRibbonSettings(): RibbonSettings {
  return {
    slotCount: 5,
    allocationMode: 'balanced',
    modules: BUILTIN_RIBBON_MODULES.map((module) => ({
      ...module,
      enabled: module.id === 'rag' || module.id === 'ai:imagery',
      pinned: false,
    })),
  }
}

export const DEFAULT_SETTINGS: SettingsShape = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  ocrModel: '',
  theme: 'light',
  fontSize: 'medium',
  activeKnowledgeBaseId: null,
  ribbonRunProfile: 'balanced',
  semanticExpansion: false,
  useEmbeddingApi: false,
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'BAAI/bge-m3',
  ribbonAiFilter: false,
  ribbonFilterModel: '',
  ribbonPauseSeconds: 2,
  ribbonSettings: getDefaultRibbonSettings(),
  ragRerankEnabled: false,
  lowLatencyMode: false,
  sensoryZoomEnabled: true,
  clicheDetectionEnabled: false,
  reliableRibbonMode: false,
}

type StoredSettings<TSettings extends SettingsShape> = Partial<TSettings> & {
  ribbonRunProfile?: TSettings['ribbonRunProfile']
  lowLatencyMode?: boolean
  reliableRibbonMode?: boolean
}

export function normalizeStoredSettings<TSettings extends SettingsShape = SettingsShape>(
  parsed: unknown,
  ambientCustomPrompts: AmbientPromptLike[],
  defaults: TSettings = DEFAULT_SETTINGS as TSettings,
): TSettings {
  const rawSettings: StoredSettings<TSettings> =
    parsed && typeof parsed === 'object' ? (parsed as StoredSettings<TSettings>) : {}
  const merged = {
    ...defaults,
    ...rawSettings,
  } as StoredSettings<TSettings>

  if (!rawSettings.ribbonRunProfile) {
    if (rawSettings.reliableRibbonMode) merged.ribbonRunProfile = 'reliable'
    else if (rawSettings.lowLatencyMode) merged.ribbonRunProfile = 'fast'
    else merged.ribbonRunProfile = 'balanced'
  }

  merged.lowLatencyMode = merged.ribbonRunProfile === 'fast'
  merged.reliableRibbonMode = merged.ribbonRunProfile === 'reliable'

  if (!merged.ribbonSettings?.slotCount || !Array.isArray(merged.ribbonSettings?.modules)) {
    merged.ribbonSettings = getDefaultRibbonSettings()
    return merged as TSettings
  }

  const savedModules = (merged.ribbonSettings.modules as RibbonModuleConfig[]).filter(
    (module) => module.id !== 'quick:helper',
  )
  const byId = new Map(savedModules.map((module) => [module.id, module]))
  const builtinAiIds = BUILTIN_RIBBON_MODULES.filter((module) => module.type.startsWith('ai:')).map(
    (module) => module.id,
  )
  const allAiDisabled =
    builtinAiIds.length > 0 && builtinAiIds.every((id) => byId.get(id)?.enabled === false)
  const ambientCustomIds = new Set(ambientCustomPrompts.map((prompt) => prompt.id))
  const savedCustom = savedModules.filter(
    (module) => module.type === 'custom' && ambientCustomIds.has(module.id),
  )
  const savedCustomIds = new Set(savedCustom.map((module) => module.id))
  const newCustom = ambientCustomPrompts
    .filter((prompt) => !savedCustomIds.has(prompt.id))
    .map((prompt) => ({
      id: prompt.id,
      type: 'custom' as const,
      label: prompt.name,
      enabled: false,
      pinned: false,
    }))
  const normalizedModules = [
    ...BUILTIN_RIBBON_MODULES.map((module) => {
      let enabled = byId.get(module.id)?.enabled ?? (module.id === 'rag' || module.id === 'ai:imagery')
      if (allAiDisabled && module.type.startsWith('ai:') && module.id === 'ai:imagery') {
        enabled = true
      }
      return { ...module, enabled, pinned: byId.get(module.id)?.pinned ?? false }
    }),
    ...savedCustom,
    ...newCustom,
  ]

  merged.ribbonSettings = {
    ...merged.ribbonSettings,
    modules: sanitizeRibbonModulesWithAmbientPrompts(normalizedModules, ambientCustomIds),
    allocationMode: merged.ribbonSettings.allocationMode ?? 'balanced',
  }

  return merged as TSettings
}
