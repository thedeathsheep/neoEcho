import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node test runner resolves this file via strip-types.
import {
  BUILTIN_RIBBON_MODULES,
  getDefaultRibbonSettings,
  MAX_ENABLED_AMBIENT_MODULES,
  normalizeStoredSettings,
} from './settings-core.ts'

test('normalizeStoredSettings migrates legacy reliable mode to reliable profile', () => {
  const settings = normalizeStoredSettings({
    reliableRibbonMode: true,
  }, [])

  assert.equal(settings.ribbonRunProfile, 'reliable')
  assert.equal(settings.reliableRibbonMode, true)
  assert.equal(settings.lowLatencyMode, false)
  assert.deepEqual(settings.ribbonSettings, getDefaultRibbonSettings())
})

test('normalizeStoredSettings keeps imagery enabled when legacy config disabled all AI modules', () => {
  const settings = normalizeStoredSettings({
    ribbonSettings: {
      slotCount: 5,
      modules: BUILTIN_RIBBON_MODULES.map((module) => ({
        ...module,
        enabled: module.type === 'rag',
        pinned: false,
      })),
    },
  }, [])

  const imagery = settings.ribbonSettings.modules.find((module) => module.id === 'ai:imagery')
  const polish = settings.ribbonSettings.modules.find((module) => module.id === 'ai:polish')

  assert.equal(imagery?.enabled, true)
  assert.equal(polish?.enabled, false)
})

test('normalizeStoredSettings limits enabled ambient modules to the supported maximum', () => {
  const settings = normalizeStoredSettings({
    ribbonSettings: {
      slotCount: 5,
      modules: [
        { id: 'rag', type: 'rag', label: '共鸣库检索', enabled: true, pinned: false },
        { id: 'ai:imagery', type: 'ai:imagery', label: '意象', enabled: true, pinned: true },
        { id: 'ai:polish', type: 'ai:polish', label: '润色', enabled: true, pinned: true },
        { id: 'ai:narrative', type: 'ai:narrative', label: '叙事', enabled: true, pinned: true },
        { id: 'ai:quote', type: 'ai:quote', label: '引用', enabled: true, pinned: true },
        { id: 'custom-1', type: 'custom', label: '自定义一', enabled: true, pinned: false },
      ],
    },
  }, [{ id: 'custom-1', name: '自定义一' }])

  const enabledAmbient = settings.ribbonSettings.modules.filter(
    (module) => module.type !== 'rag' && module.enabled,
  )
  const trimmedCustom = settings.ribbonSettings.modules.find((module) => module.id === 'custom-1')

  assert.equal(enabledAmbient.length, MAX_ENABLED_AMBIENT_MODULES)
  assert.equal(trimmedCustom?.enabled, false)
  assert.equal(trimmedCustom?.pinned, false)
})
