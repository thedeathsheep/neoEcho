'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'

import type { RibbonModuleConfig, RibbonSettings } from '@/types'

export interface Settings {
  apiKey: string
  model: string
  baseUrl: string
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'medium' | 'large'
  activeKnowledgeBaseId: string | null
  /** Use AI to expand query for RAG (e.g. "春天" -> "春天 花开 温暖 春风") for better semantic recall */
  semanticExpansion: boolean
  /** Use API for embeddings (better quality, especially for Chinese) */
  useEmbeddingApi: boolean
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  /** Use small/quick model to filter low-value snippets from ribbon after retrieval */
  ribbonAiFilter: boolean
  /** Model used for ribbon filter only; empty = use main model (slower). Use a small/fast model here for speed. */
  ribbonFilterModel: string
  /** Seconds of typing pause before ribbon refreshes (1–10). */
  ribbonPauseSeconds: number
  /** Ribbon content modules and slot count (5–8). */
  ribbonSettings: RibbonSettings
}

export const BUILTIN_RIBBON_MODULES: Omit<RibbonModuleConfig, 'enabled' | 'pinned'>[] = [
  { id: 'rag', type: 'rag', label: '共鸣库检索' },
  { id: 'ai:imagery', type: 'ai:imagery', label: 'AI 意象' },
  { id: 'ai:polish', type: 'ai:polish', label: 'AI 润色' },
  { id: 'ai:narrative', type: 'ai:narrative', label: 'AI 叙事' },
  { id: 'ai:quote', type: 'ai:quote', label: 'AI 引用' },
  { id: 'quick:helper', type: 'quick', label: '快速助手' },
]

function getDefaultRibbonSettings(): RibbonSettings {
  return {
    slotCount: 5,
    modules: BUILTIN_RIBBON_MODULES.map((m) => ({
      ...m,
      enabled: m.id === 'rag' || m.id === 'ai:imagery',
      pinned: false,
    })),
  }
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  theme: 'light',
  fontSize: 'medium',
  activeKnowledgeBaseId: null,
  semanticExpansion: false,
  useEmbeddingApi: false,
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'BAAI/bge-m3',
  ribbonAiFilter: false,
  ribbonFilterModel: '',
  ribbonPauseSeconds: 2,
  ribbonSettings: getDefaultRibbonSettings(),
}

const STORAGE_KEY = 'echo-settings'

interface SettingsContextType {
  settings: Settings
  updateSettings: (updates: Partial<Settings>) => void
  resetSettings: () => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        const merged = { ...DEFAULT_SETTINGS, ...parsed }
        if (!merged.ribbonSettings?.slotCount || !Array.isArray(merged.ribbonSettings?.modules)) {
          merged.ribbonSettings = getDefaultRibbonSettings()
        }
        setSettings(merged)
      }
    } catch (e) {
      console.error('Failed to load settings', e)
    } finally {
      setLoaded(true)
    }
  }, [])

  // Save settings to localStorage whenever they change
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.error('Failed to save settings', e)
    }
  }, [settings, loaded])

  // Apply theme and fontSize to DOM (after load so we don't overwrite inline script before hydrate)
  useEffect(() => {
    if (!loaded) return
    const { theme, fontSize } = settings
    const resolvedTheme =
      theme === 'system'
        ? (typeof window !== 'undefined' &&
           window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
          ? 'dark'
          : 'light')
        : theme
    document.documentElement.setAttribute('data-theme', resolvedTheme)
    document.documentElement.setAttribute('data-font-size', fontSize)
  }, [loaded, settings.theme, settings.fontSize])

  // Subscribe to system preference when theme is 'system'
  useEffect(() => {
    if (!loaded || settings.theme !== 'system') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => {
      const resolved = mq.matches ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', resolved)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [loaded, settings.theme])

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...updates }))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  return (
    <SettingsContext.Provider
      value={{ settings, updateSettings, resetSettings }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
