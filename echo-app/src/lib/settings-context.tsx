'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { customPromptService } from '@/services/custom-prompt.service'

import {
  BUILTIN_RIBBON_MODULES,
  DEFAULT_SETTINGS,
  getDefaultRibbonSettings,
  MAX_ENABLED_AMBIENT_MODULES,
  normalizeStoredSettings,
  RECOMMENDED_ENABLED_AMBIENT_MODULES,
  sanitizeRibbonModulesWithAmbientPrompts,
  type SettingsShape,
} from './settings-core'

export type Settings = SettingsShape

export {
  BUILTIN_RIBBON_MODULES,
  DEFAULT_SETTINGS,
  getDefaultRibbonSettings,
  MAX_ENABLED_AMBIENT_MODULES,
  normalizeStoredSettings,
  RECOMMENDED_ENABLED_AMBIENT_MODULES,
}

export function getAmbientCustomPrompts() {
  return customPromptService.getAll().filter((prompt) => (prompt.mode ?? 'ambient') === 'ambient')
}

export function sanitizeRibbonModules(modules: import('@/types').RibbonModuleConfig[]) {
  return sanitizeRibbonModulesWithAmbientPrompts(
    modules,
    new Set(getAmbientCustomPrompts().map((prompt) => prompt.id)),
  )
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        setSettings(normalizeStoredSettings(JSON.parse(saved), getAmbientCustomPrompts(), DEFAULT_SETTINGS))
      }
    } catch (e) {
      console.error('Failed to load settings', e)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.error('Failed to save settings', e)
    }
  }, [settings, loaded])

  const theme = settings.theme
  const fontSize = settings.fontSize

  useEffect(() => {
    if (!loaded) return
    const resolvedTheme =
      theme === 'system'
        ? typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
          ? 'dark'
          : 'light'
        : theme
    document.documentElement.setAttribute('data-theme', resolvedTheme)
    document.documentElement.setAttribute('data-font-size', fontSize)
  }, [fontSize, loaded, theme])

  useEffect(() => {
    if (!loaded || theme !== 'system') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => {
      const resolved = mq.matches ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', resolved)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [loaded, theme])

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates }
      if (updates.ribbonSettings?.modules) {
        next.ribbonSettings = {
          ...prev.ribbonSettings,
          ...updates.ribbonSettings,
          modules: sanitizeRibbonModules(updates.ribbonSettings.modules),
          allocationMode:
            updates.ribbonSettings.allocationMode ??
            prev.ribbonSettings.allocationMode ??
            'balanced',
        }
      }
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
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
