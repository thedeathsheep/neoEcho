'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

declare global {
  interface WindowEventMap {
    'knowledge-base-updated': CustomEvent
  }
}

import { toast } from 'sonner'

import { EchoEditor, type EchoEditorHandle } from '@/components/editor/echo-editor'
import { AmbientRibbon } from '@/components/ribbon/ambient-ribbon'
import { RibbonDetailPanel } from '@/components/ribbon/ribbon-detail-panel'
import { DevPanel } from '@/components/ui/dev-panel'
import { DocumentPanel } from '@/components/ui/document-panel'
import { KnowledgePanel } from '@/components/ui/knowledge-panel'
import { type TabKey,WritingAssistantPanel } from '@/components/ui/writing-assistant-panel'
import { useHeartbeat } from '@/hooks/use-heartbeat'
import { type ClicheMatch,detectCliches } from '@/lib/cliche-detector'
import { devLog } from '@/lib/dev-log'
import { documentStorage } from '@/lib/document-storage'
import { flowHistory } from '@/lib/flow-history'
import { BUILTIN_RIBBON_MODULES, sanitizeRibbonModules, useSettings } from '@/lib/settings-context'
import { generateId } from '@/lib/utils/crypto'
import { debounce } from '@/lib/utils/time'
import { writingWorkspaceStorage } from '@/lib/writing-workspace-storage'
import { adoptionStore } from '@/services/adoption-store'
import {
  generateCharacterConsistency,
  generateEchoesForModule,
  generateImitationDrill,
  generatePlotProgression,
  generateRevisionRadar,
  generateSceneMemoryMap,
  getModuleDisplayLabel,
} from '@/services/client-ai.service'
import { customPromptService } from '@/services/custom-prompt.service'
import { getChunksByBase, getKnowledgeStats, type KnowledgeBase,knowledgeBaseService } from '@/services/knowledge-base.service'
import { generateCandidatesByViews, type MandatoryMaxSlots,ragService } from '@/services/rag.service'
import { ribbonEngine } from '@/services/ribbon-engine.service'
import { expandSensoryZoom } from '@/services/sensory-zoom.service'
import type {
  CharacterWatchStatus,
  Document,
  DocumentSnapshot,
  EchoItem,
  MaterialStatus,
  PracticeDrillStatus,
  RevisionTask,
  RevisionTaskPriority,
  RibbonEngineState,
  RibbonModuleConfig,
  RibbonSlotCount,
  SceneCard,
  WritingAssistKind,
  WritingAssistResult,
  WritingProfileSummary,
  WritingWorkspaceData,
} from '@/types'

const AUTO_SAVE_MS = 2000
const ERROR_THROTTLE_MS = 60_000
const DISPLAY_ECHOES_KEY = 'echo-display-echoes'
const DISPLAY_ECHOES_DOC_ID_KEY = 'echo-display-echoes-doc-id'
const HOME_UI_STATE_KEY = 'echo-home-ui-state'
const RIBBON_MODULE_SOFT_TIMEOUT_MS = 12_000
const RIBBON_MODULE_SOFT_TIMEOUT_RELIABLE_MS = 18_000
const RIBBON_MODULE_HARD_TIMEOUT_MS = 45_000
const RIBBON_MODULE_HARD_TIMEOUT_RELIABLE_MS = 60_000
const RIBBON_CUSTOM_MODULE_SOFT_TIMEOUT_MS = 18_000
const RIBBON_CUSTOM_MODULE_SOFT_TIMEOUT_RELIABLE_MS = 30_000
const RIBBON_CUSTOM_MODULE_HARD_TIMEOUT_MS = 60_000
const RIBBON_CUSTOM_MODULE_HARD_TIMEOUT_RELIABLE_MS = 75_000
const RIBBON_NETWORK_RETRY_DELAY_MS = 900
const RIBBON_BACKGROUND_CONCURRENCY = 2

function summarizeRevisionContext(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, 96)
}

function revisionPriorityFromSeverity(
  kind: 'manual' | 'radar' | 'plot' | 'character' | 'cliche',
  severity?: 'gentle' | 'watch' | 'strong',
): RevisionTaskPriority {
  if (kind === 'manual') return 'soon'
  if (severity === 'strong') return 'now'
  if (severity === 'watch') return 'soon'
  if (kind === 'radar' || kind === 'character') return 'watch'
  return 'soon'
}

function debugIngest(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  fetch('http://127.0.0.1:7776/ingest/bd75bf12-cc2c-45c2-9d32-c1c193905a25', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '626617' },
    body: JSON.stringify({
      sessionId: '626617',
      runId: 'diag',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}

export type AiStatus = 'idle' | 'unconfigured' | 'loading' | 'connected' | 'error'

function isAiLikeSource(source?: string): boolean {
  const normalized = (source ?? '').trim().toLowerCase()
  return normalized === '' || normalized === 'echo' || normalized.includes('ai')
}

function isGeneratedRibbonModule(item: Pick<EchoItem, 'moduleId'>): boolean {
  return Boolean(item.moduleId && item.moduleId !== 'rag')
}

function filterEchoesForKnowledgeBase(items: EchoItem[], base: KnowledgeBase | null): EchoItem[] {
  if (!base) {
    return items.filter((item) => isGeneratedRibbonModule(item) || isAiLikeSource(item.source))
  }
  const allowedSources = new Set(base.files.map((file) => file.fileName))
  return items.filter(
    (item) => isGeneratedRibbonModule(item) || isAiLikeSource(item.source) || allowedSources.has(item.source ?? ''),
  )
}

function createRibbonEchoVisibilityMatcher(base: KnowledgeBase | null, modules: RibbonModuleConfig[]) {
  const enabled = modules.filter((entry) => entry.enabled)
  const ragEnabled = enabled.some((entry) => entry.type === 'rag')
  const allowedModuleIds = new Set(enabled.filter((entry) => entry.type !== 'rag').map((entry) => entry.id))
  const sourceToModule = new Map<string, { id: string; label: string }>()
  const allowedKnowledgeSources = new Set(base?.files.map((file) => file.fileName) ?? [])

  for (const entry of enabled) {
    if (entry.type === 'rag') continue
    const displayLabel = getModuleDisplayLabel(entry.type, entry.id, entry.label)
    sourceToModule.set(displayLabel, { id: entry.id, label: displayLabel })
    if (entry.label?.trim()) {
      sourceToModule.set(entry.label.trim(), { id: entry.id, label: entry.label.trim() })
      sourceToModule.set(`闁煎浜滈悾鐐▕?${entry.label.trim()}`, { id: entry.id, label: entry.label.trim() })
    }
    if (entry.type === 'custom') {
      const promptName = customPromptService.get(entry.id)?.name?.trim()
      if (promptName) {
        sourceToModule.set(promptName, { id: entry.id, label: promptName })
        sourceToModule.set(`闁煎浜滈悾鐐▕?${promptName}`, { id: entry.id, label: promptName })
      }
    }
  }

  const normalize = (item: EchoItem): EchoItem | null => {
    if (item.moduleId) {
      if (item.moduleId === 'rag') {
        const source = (item.source ?? '').trim()
        if (!base) return ragEnabled ? item : null
        return ragEnabled && (isAiLikeSource(source) || allowedKnowledgeSources.has(source)) ? item : null
      }
      return allowedModuleIds.has(item.moduleId) ? item : null
    }

    const source = (item.source ?? '').trim()
    if (!base) {
      if (!isAiLikeSource(source)) return null
    } else if (!isAiLikeSource(source) && !allowedKnowledgeSources.has(source)) {
      return null
    }

    if (!source || source === 'Echo') return item
    if (!isAiLikeSource(source)) {
      return ragEnabled ? { ...item, moduleId: 'rag' } : null
    }

    const matched = sourceToModule.get(source)
    if (!matched) return null

    return {
      ...item,
      moduleId: matched.id,
      moduleLabel: item.moduleLabel ?? matched.label,
    }
  }

  return {
    canShow(item: EchoItem) {
      return normalize(item) !== null
    },
    normalize,
  }
}

function normalizeVisibleEchoes(
  items: EchoItem[],
  normalize: (item: EchoItem) => EchoItem | null,
): EchoItem[] {
  return items.flatMap((item) => {
    const normalized = normalize(item)
    return normalized ? [normalized] : []
  })
}

function getModuleTimeouts(module: RibbonModuleConfig, reliableMode: boolean): { softTimeoutMs: number; hardTimeoutMs: number } {
  if (module.type === 'custom') {
    return reliableMode
      ? {
          softTimeoutMs: RIBBON_CUSTOM_MODULE_SOFT_TIMEOUT_RELIABLE_MS,
          hardTimeoutMs: RIBBON_CUSTOM_MODULE_HARD_TIMEOUT_RELIABLE_MS,
        }
      : {
          softTimeoutMs: RIBBON_CUSTOM_MODULE_SOFT_TIMEOUT_MS,
          hardTimeoutMs: RIBBON_CUSTOM_MODULE_HARD_TIMEOUT_MS,
        }
  }

  return reliableMode
    ? {
        softTimeoutMs: RIBBON_MODULE_SOFT_TIMEOUT_RELIABLE_MS,
        hardTimeoutMs: RIBBON_MODULE_HARD_TIMEOUT_RELIABLE_MS,
      }
    : {
        softTimeoutMs: RIBBON_MODULE_SOFT_TIMEOUT_MS,
        hardTimeoutMs: RIBBON_MODULE_HARD_TIMEOUT_MS,
      }
}

function sortRibbonModulesForExecution(modules: RibbonModuleConfig[]): RibbonModuleConfig[] {
  return [...modules].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const aBuiltin = a.type.startsWith('ai:')
    const bBuiltin = b.type.startsWith('ai:')
    if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

function pickReferenceEcho(items: EchoItem[]): EchoItem | null {
  return (
    items.find((item) => (item.originalText ?? '').trim().length > 0 && !isAiLikeSource(item.source)) ??
    items.find((item) => (item.originalText ?? item.content ?? '').trim().length > 0) ??
    null
  )
}

function buildSceneTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '未命名场景'
  return normalized.slice(0, 18)
}

function withSnapshotId(items: EchoItem[], snapshotId: string): EchoItem[] {
  return items.map((item) => ({ ...item, snapshotId }))
}

function normalizeStoredRibbonSlots(
  raw: unknown,
  slotCount: number,
): Array<EchoItem | null> | null {
  if (!Array.isArray(raw)) return null
  return Array.from({ length: slotCount }, (_, index) => {
    const item = raw[index]
    if (!item || typeof item !== 'object') return null
    return item as EchoItem
  })
}

function diffRenderedRibbonSlots(
  previous: Array<EchoItem | null>,
  next: Array<EchoItem | null>,
) {
  const max = Math.max(previous.length, next.length)
  let changed = 0
  for (let index = 0; index < max; index += 1) {
    if ((previous[index]?.id ?? null) !== (next[index]?.id ?? null)) changed += 1
  }
  return changed
}

function readStoredHomeUiState(slotCount: number): {
  documentId: string | null
  ribbonSlots: Array<EchoItem | null> | null
  writingPanelOpen: boolean
  writingPanelTab: TabKey
  selectedRibbonEcho: EchoItem | null
} {
  if (typeof window === 'undefined') {
    return {
      documentId: null,
      ribbonSlots: null,
      writingPanelOpen: true,
      writingPanelTab: 'today',
      selectedRibbonEcho: null,
    }
  }

  try {
    const savedHomeUi = localStorage.getItem(HOME_UI_STATE_KEY)
    if (!savedHomeUi) {
      return {
        documentId: null,
        ribbonSlots: null,
        writingPanelOpen: true,
        writingPanelTab: 'today',
        selectedRibbonEcho: null,
      }
    }

    const parsedUi = JSON.parse(savedHomeUi) as {
      documentId?: string
      writingPanelOpen?: boolean
      writingPanelTab?: TabKey
      selectedRibbonEchoId?: string | null
      ribbonSlots?: unknown
    }
    const ribbonSlots = normalizeStoredRibbonSlots(parsedUi.ribbonSlots, slotCount)
    const selectedRibbonEcho =
      ribbonSlots?.find((item) => item?.id === parsedUi.selectedRibbonEchoId) ?? null

    return {
      documentId: parsedUi.documentId ?? null,
      ribbonSlots,
      writingPanelOpen: parsedUi.writingPanelOpen ?? true,
      writingPanelTab: parsedUi.writingPanelTab ?? 'today',
      selectedRibbonEcho,
    }
  } catch {
    return {
      documentId: null,
      ribbonSlots: null,
      writingPanelOpen: true,
      writingPanelTab: 'today',
      selectedRibbonEcho: null,
    }
  }
}

export default function Home() {
  const { settings } = useSettings()
  const initialHomeUiRef = useRef<ReturnType<typeof readStoredHomeUiState> | null>(null)
  if (initialHomeUiRef.current === null) {
    initialHomeUiRef.current = readStoredHomeUiState(Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount)
  }
  const initialHomeUi = initialHomeUiRef.current
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [_echoes, setEchoes] = useState<EchoItem[]>([])
  const [restoredRibbonSlots, setRestoredRibbonSlots] = useState<Array<EchoItem | null> | null>(initialHomeUi.ribbonSlots)
  const [ribbonRestoreFrozen, setRibbonRestoreFrozen] = useState(Boolean(initialHomeUi.ribbonSlots))
  const [restoredRibbonDocId, setRestoredRibbonDocId] = useState<string | null>(initialHomeUi.documentId)
  const [refreshHoldSlots, setRefreshHoldSlots] = useState<Array<EchoItem | null> | null>(null)
  const [ribbonState, setRibbonState] = useState<RibbonEngineState>(() => ribbonEngine.createEmptyState())
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle')
  const [selectedRibbonEcho, setSelectedRibbonEcho] = useState<EchoItem | null>(initialHomeUi.selectedRibbonEcho)
  const [writingPanelOpen, setWritingPanelOpen] = useState(initialHomeUi.writingPanelOpen)
  const [writingPanelTab, setWritingPanelTab] = useState<TabKey>(initialHomeUi.writingPanelTab)
  const selectedRibbonEchoRef = useRef<EchoItem | null>(null)
  const skipNextKnowledgeHydrateRef = useRef<string | null>(null)
  const [selectionText, setSelectionText] = useState('')
  const [currentParagraph, setCurrentParagraph] = useState('')
  const [sensoryZoomResults, setSensoryZoomResults] = useState<EchoItem[] | null>(null)
  const [sensoryZoomLoading, setSensoryZoomLoading] = useState(false)
  const [clicheMatches, setClicheMatches] = useState<ClicheMatch[]>([])
  const [paragraphForCliche, setParagraphForCliche] = useState('')
  const [showClichePopover, setShowClichePopover] = useState(false)
  const [clicheAlternatives, setClicheAlternatives] = useState<EchoItem[]>([])
  const [clicheAlternativesLoading, setClicheAlternativesLoading] = useState(false)
  const [hasKnowledge, setHasKnowledge] = useState(false)
  const [knowledgeVersion, setKnowledgeVersion] = useState(0)
  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBase | null>(() => knowledgeBaseService.getActive())
  const [workspace, setWorkspace] = useState<WritingWorkspaceData>({
    materials: [],
    revisions: [],
    scenes: [],
    characterWatchItems: [],
    memoryNodes: [],
    practiceDrills: [],
    snapshots: [],
  })
  const [assistResults, setAssistResults] = useState<Partial<Record<WritingAssistKind, WritingAssistResult | null>>>({})
  const [assistLoading, setAssistLoading] = useState<Partial<Record<WritingAssistKind, boolean>>>({})
  const [editorContentVersion, setEditorContentVersion] = useState(0)

  const refreshRequestIdRef = useRef<string>('')
  const refreshAbortRef = useRef<AbortController | null>(null)
  const editorRef = useRef<EchoEditorHandle | null>(null)
  const backgroundJobControllersRef = useRef<Record<string, AbortController>>({})
  const backgroundJobSoftTimeoutsRef = useRef<Record<string, number>>({})
  const backgroundJobsByModuleRef = useRef<Record<string, { jobId: string; snapshotId: string }>>({})
  const lastTextRef = useRef('')
  const lastRefreshedTextRef = useRef('')
  const currentBlockIdRef = useRef<string | null>(null)
  const lastErrorTimeRef = useRef<Record<string, number>>({})
  const hasInitializedRef = useRef(false)
  const suppressNextEditorBeatRef = useRef(false)
  const paragraphTextRef = useRef('')
  const clicheEnabledRef = useRef(settings.clicheDetectionEnabled)
  const previousRibbonSlotsRef = useRef<Array<EchoItem | null>>([])

  const hasApiKey = !!settings.apiKey
  const ribbonSlotCount = useMemo(
    () => Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount,
    [settings.ribbonSettings?.slotCount],
  )
  const visibleRibbonModules = useMemo(() => {
    const savedModules = settings.ribbonSettings?.modules ?? []
    const byId = new Map(savedModules.map((m) => [m.id, m]))
    return sanitizeRibbonModules([
      ...BUILTIN_RIBBON_MODULES.filter((builtin) => builtin.type !== 'quick').map((builtin) => ({
        ...builtin,
        enabled: byId.get(builtin.id)?.enabled ?? (builtin.id === 'rag' || builtin.id === 'ai:imagery'),
        pinned: byId.get(builtin.id)?.pinned ?? false,
        prompt: byId.get(builtin.id)?.prompt,
        model: byId.get(builtin.id)?.model,
      })),
      ...savedModules.filter((entry) => entry.type === 'custom'),
    ] as RibbonModuleConfig[])
  }, [settings.ribbonSettings?.modules])
  const ribbonEchoVisibility = useMemo(
    () => createRibbonEchoVisibilityMatcher(activeKnowledgeBase, visibleRibbonModules),
    [activeKnowledgeBase, visibleRibbonModules],
  )
  const visibleRibbonEchoes = useMemo(() => {
    const visible = ribbonEngine.getVisibleEchoes(ribbonState, {
      slotCount: ribbonSlotCount,
      include: ribbonEchoVisibility.canShow,
    })
    return normalizeVisibleEchoes(visible, ribbonEchoVisibility.normalize)
  }, [ribbonEchoVisibility, ribbonSlotCount, ribbonState])
  const liveRibbonSlots = useMemo(
    () =>
      ribbonEngine
        .getVisibleSlots(ribbonState, ribbonSlotCount, { include: ribbonEchoVisibility.canShow })
        .map((item) => (item ? ribbonEchoVisibility.normalize(item) : null)),
    [ribbonEchoVisibility, ribbonSlotCount, ribbonState],
  )
  const currentSnapshotId = ribbonState.currentSnapshot?.id ?? null
  const hasCurrentSnapshotVisibleContent = useMemo(
    () => liveRibbonSlots.some((item) => item?.snapshotId === currentSnapshotId),
    [currentSnapshotId, liveRibbonSlots],
  )
  const shouldPreferFrozenRibbonSnapshot =
    ribbonRestoreFrozen &&
    restoredRibbonDocId === documentId &&
    restoredRibbonSlots !== null &&
    restoredRibbonSlots.some((item) => item !== null)
  const shouldPreferRefreshHold =
    !shouldPreferFrozenRibbonSnapshot &&
    refreshHoldSlots !== null &&
    refreshHoldSlots.some((item) => item !== null) &&
    !hasCurrentSnapshotVisibleContent
  const renderedRibbonSlots = useMemo(
    () =>
      shouldPreferFrozenRibbonSnapshot
        ? restoredRibbonSlots ?? []
        : shouldPreferRefreshHold
          ? refreshHoldSlots ?? []
          : liveRibbonSlots,
    [liveRibbonSlots, refreshHoldSlots, restoredRibbonSlots, shouldPreferFrozenRibbonSnapshot, shouldPreferRefreshHold],
  )

  useEffect(() => {
    if (hasCurrentSnapshotVisibleContent && refreshHoldSlots !== null) {
      setRefreshHoldSlots(null)
    }
  }, [hasCurrentSnapshotVisibleContent, refreshHoldSlots])

  useEffect(() => {
    selectedRibbonEchoRef.current = selectedRibbonEcho
  }, [selectedRibbonEcho])

  useEffect(() => {
    setAiStatus(hasApiKey ? 'connected' : 'unconfigured')
  }, [hasApiKey])

  useEffect(() => {
    const previous = previousRibbonSlotsRef.current
    const next = renderedRibbonSlots
    const previousKeys = previous.map((item) => item?.id ?? 'empty')
    const nextKeys = next.map((item) => item?.id ?? 'empty')
    if (previousKeys.join('|') === nextKeys.join('|')) return
    const changedSlots = diffRenderedRibbonSlots(previous, next)

    devLog.push('ribbon-ui', 'display allocation changed', {
      slotCount: ribbonSlotCount,
      changed: true,
      changedSlotCount: changedSlots,
    })

    previousRibbonSlotsRef.current = next
  }, [renderedRibbonSlots, ribbonSlotCount])

  useEffect(() => {
    if (documentId) return
    if (refreshHoldSlots !== null) setRefreshHoldSlots(null)
  }, [documentId, refreshHoldSlots])

  useEffect(() => {
    if (!documentId || visibleRibbonEchoes.length === 0) return
    setEchoes((prev) => {
      const next = flowHistory.append(documentId, visibleRibbonEchoes, prev)
      const unchanged =
        next.length === prev.length &&
        next.every((item, index) => item.id === prev[index]?.id)
      return unchanged ? prev : next
    })
  }, [documentId, visibleRibbonEchoes])

  useEffect(() => {
    if (!documentId) return
    try {
      if (renderedRibbonSlots.some((item) => item !== null)) {
        localStorage.setItem(DISPLAY_ECHOES_KEY, JSON.stringify(renderedRibbonSlots))
        localStorage.setItem(DISPLAY_ECHOES_DOC_ID_KEY, documentId)
      }
    } catch {
      // ignore
    }
  }, [documentId, renderedRibbonSlots])

  useEffect(() => {
    if (!documentId) return
    try {
      localStorage.setItem(HOME_UI_STATE_KEY, JSON.stringify({
        documentId,
        writingPanelOpen,
        writingPanelTab,
        selectedRibbonEchoId: selectedRibbonEcho?.id ?? null,
        ribbonSlotCount,
        ribbonSlots: renderedRibbonSlots,
      }))
    } catch {
      // ignore
    }
  }, [documentId, renderedRibbonSlots, ribbonSlotCount, selectedRibbonEcho?.id, writingPanelOpen, writingPanelTab])

  useEffect(() => {
    const checkKnowledge = async () => {
      try {
        const stats = await getKnowledgeStats()
        setHasKnowledge(stats.fileCount > 0)
        const base = knowledgeBaseService.getActive()
        setActiveKnowledgeBase(base)
        if (documentId) {
          setEchoes((prev) => {
            const filtered = filterEchoesForKnowledgeBase(prev, base)
            if (skipNextKnowledgeHydrateRef.current === documentId && knowledgeVersion === 0) {
              skipNextKnowledgeHydrateRef.current = null
              devLog.push('ribbon-ui', 'skip knowledge hydrate on remount', {
                documentId,
                filteredCount: filtered.length,
              })
              return filtered
            }
            setRibbonState(
              ribbonEngine.hydrate(
                filtered,
                Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount,
                documentId,
              ),
            )
            return filtered
          })
        }
      } catch {
        setHasKnowledge(false)
      }
    }

    checkKnowledge()
    const handleKnowledgeUpdate = () => {
      setKnowledgeVersion((value) => value + 1)
      checkKnowledge()
    }

    window.addEventListener('knowledge-base-updated', handleKnowledgeUpdate)
    return () => window.removeEventListener('knowledge-base-updated', handleKnowledgeUpdate)
  }, [documentId, knowledgeVersion, settings.ribbonSettings?.slotCount])

  useEffect(() => {
    clicheEnabledRef.current = settings.clicheDetectionEnabled
  }, [settings.clicheDetectionEnabled])

  const throttledErrorToast = useCallback((key: string, msg: string) => {
    const now = Date.now()
    if (now - (lastErrorTimeRef.current[key] ?? 0) < ERROR_THROTTLE_MS) return
    lastErrorTimeRef.current[key] = now
    toast.error(msg)
  }, [])

  const loadWorkspace = useCallback((docId: string | null) => {
    if (!docId) {
      setWorkspace({ materials: [], revisions: [], scenes: [], characterWatchItems: [], memoryNodes: [], practiceDrills: [], snapshots: [] })
      return
    }
    setWorkspace(writingWorkspaceStorage.load(docId))
  }, [])

  useEffect(() => {
    loadWorkspace(documentId)
  }, [documentId, loadWorkspace])

  useEffect(() => {
    setAssistResults({})
    setAssistLoading({})
  }, [documentId])

  useEffect(() => {
    setAssistResults((prev) => ({
      ...prev,
      plot: null,
      character: null,
    }))
  }, [currentBlockId])

  const profile = useMemo<WritingProfileSummary>(() => {
    const tagCounts = new Map<string, number>()
    for (const revision of workspace.revisions) {
      for (const tag of revision.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tag]) => tag)

    return {
      adoptedCount: documentId ? adoptionStore.getAdoptionsByDocument(documentId).length : 0,
      materialCount: workspace.materials.length,
      openRevisionCount: workspace.revisions.filter((item) => item.status === 'open').length,
      sceneCount: workspace.scenes.length,
      openCharacterWatchCount: workspace.characterWatchItems.filter((item) => item.status === 'open').length,
      memoryNodeCount: workspace.memoryNodes.filter((item) => item.status === 'active').length,
      openPracticeDrillCount: workspace.practiceDrills.filter((item) => item.status === 'open').length,
      snapshotCount: workspace.snapshots.length,
      topTags,
    }
  }, [documentId, workspace])

  const currentScene = useMemo<SceneCard | null>(() => {
    const blockId = currentBlockId || currentBlockIdRef.current
    if (!blockId) return null
    return workspace.scenes.find((scene) => scene.blockId === blockId) ?? null
  }, [currentBlockId, workspace.scenes])

  const recordEchoAdoption = useCallback((item: EchoItem) => {
    if (!documentId) return
    adoptionStore.recordAdoption(documentId, item)
    setRibbonState((prev) => ribbonEngine.markAdopted(prev, item))
  }, [documentId])

  const runBackgroundModule = useCallback((
    snapshotId: string,
    documentIdForJob: string,
    slotCount: RibbonSlotCount,
    text: string,
    ragResults: EchoItem[],
    module: RibbonModuleConfig,
  ) => {
    if (!hasApiKey) return Promise.resolve()

    const existingJob = backgroundJobsByModuleRef.current[module.id]
    if (
      existingJob &&
      existingJob.snapshotId === snapshotId &&
      backgroundJobControllersRef.current[existingJob.jobId]
    ) {
      devLog.push('ribbon', 'background ai job already running, skip duplicate', {
        moduleId: module.id,
        snapshotId,
        existingJobId: existingJob.jobId,
      })
      return Promise.resolve()
    }

    const type = module.type === 'custom' ? 'custom' : module.type === 'ai:quote' ? 'tag' : 'imagery'
    const jobId = generateId()
    setRibbonState((prev) => {
      const next = ribbonEngine.registerJob(prev, snapshotId, type, module.id, jobId)
      return ribbonEngine.markJobRunning(next.state, next.jobId)
    })

    const controller = new AbortController()
    backgroundJobControllersRef.current[jobId] = controller
    backgroundJobsByModuleRef.current[module.id] = { jobId, snapshotId }
    setAiStatus('loading')

    const { softTimeoutMs, hardTimeoutMs } = getModuleTimeouts(module, settings.reliableRibbonMode)

    const clearJobHandles = () => {
      const softTimeoutId = backgroundJobSoftTimeoutsRef.current[jobId]
      if (softTimeoutId != null) {
        window.clearTimeout(softTimeoutId)
        delete backgroundJobSoftTimeoutsRef.current[jobId]
      }
      delete backgroundJobControllersRef.current[jobId]
      if (backgroundJobsByModuleRef.current[module.id]?.jobId === jobId) {
        delete backgroundJobsByModuleRef.current[module.id]
      }
    }

    const runAttempt = (attempt: number): Promise<void> => {
      const attemptController = new AbortController()
      backgroundJobControllersRef.current[jobId] = attemptController
      backgroundJobSoftTimeoutsRef.current[jobId] = window.setTimeout(() => {
        if (!backgroundJobControllersRef.current[jobId]) return
        devLog.push('ribbon', 'background ai job soft timeout', {
          moduleId: module.id,
          snapshotId,
          jobId,
          softTimeoutMs,
          attempt: attempt + 1,
        })
        setRibbonState((prev) => ribbonEngine.markJobSoftTimedOut(prev, jobId, 'soft timeout, continuing'))
      }, softTimeoutMs)

      return generateEchoesForModule(
        text,
        ragResults,
        {
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          ribbonFilterModel: settings.ribbonFilterModel ?? '',
        },
        {
          type: module.type,
          id: module.id,
          prompt: module.prompt,
          model: module.model,
          label: module.label,
        },
        currentBlockIdRef.current ?? undefined,
        {
          signal: attemptController.signal,
          timeoutMs: hardTimeoutMs,
        },
      )
        .then((result) => {
          clearJobHandles()
          const taggedItems = withSnapshotId(result.items, snapshotId)
          if (taggedItems.length > 0) {
            setEchoes((prev) => flowHistory.append(documentIdForJob, taggedItems, prev))
          }
          if (refreshRequestIdRef.current !== snapshotId || taggedItems.length === 0) {
            setRibbonState((prev) => ribbonEngine.markJobDone(prev, jobId))
            return
          }

          const origin =
            module.type === 'custom'
              ? 'ai_custom'
              : module.type === 'ai:quote'
                ? 'ai_tag'
                : 'ai_imagery'

          setRibbonState((prev) => {
            const snapshot = prev.currentSnapshot
            if (!snapshot || snapshot.id !== snapshotId) return ribbonEngine.markJobDone(prev, jobId)
            const patched = ribbonEngine.ingestAi(prev, snapshot, taggedItems, origin, slotCount)
            return ribbonEngine.markJobDone(patched, jobId)
          })
        })
        .catch((err) => {
          clearJobHandles()
          const message = (err as Error)?.message ?? 'unknown'
          const retriable = message === 'NETWORK_ERROR' || message.startsWith('NETWORK_ERROR:')
          if (retriable && attempt === 0 && refreshRequestIdRef.current === snapshotId) {
            devLog.push('ribbon', 'background ai job retrying after network error', {
              moduleId: module.id,
              snapshotId,
              jobId,
              retryInMs: RIBBON_NETWORK_RETRY_DELAY_MS,
            })
            return new Promise<void>((resolve) => {
              window.setTimeout(() => {
                void runAttempt(1).finally(resolve)
              }, RIBBON_NETWORK_RETRY_DELAY_MS)
            })
          }

          devLog.push('ribbon', 'background ai job failed', {
            moduleId: module.id,
            error: message,
            attempt: attempt + 1,
          })
          setRibbonState((prev) => ribbonEngine.markJobFailed(prev, jobId, message))
        })
        .finally(() => {
          if (Object.keys(backgroundJobControllersRef.current).length === 0) {
            setAiStatus(hasApiKey ? 'connected' : 'unconfigured')
          }
        })
    }

    return runAttempt(0)
  }, [hasApiKey, settings])

  const cancelActiveRibbonJobs = useCallback((reason: string) => {
    const activeJobIds = Object.keys(backgroundJobControllersRef.current)
    if (activeJobIds.length === 0) return

    for (const timeoutId of Object.values(backgroundJobSoftTimeoutsRef.current)) {
      window.clearTimeout(timeoutId)
    }

    for (const controller of Object.values(backgroundJobControllersRef.current)) {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    }

    backgroundJobControllersRef.current = {}
    backgroundJobSoftTimeoutsRef.current = {}
    backgroundJobsByModuleRef.current = {}
    setRibbonState((prev) =>
      activeJobIds.reduce((state, jobId) => ribbonEngine.markJobCancelled(state, jobId, reason), prev),
    )
    setAiStatus(hasApiKey ? 'connected' : 'unconfigured')
    devLog.push('ribbon', 'cancelled active background jobs', {
      reason,
      count: activeJobIds.length,
    })
  }, [hasApiKey])

  const handlePause = useCallback(async (text: string) => {
    if (!documentId) return

    const trimmed = text.trim()
    lastTextRef.current = text
    setRefreshHoldSlots(renderedRibbonSlots)
    if (ribbonRestoreFrozen) {
      setRibbonRestoreFrozen(false)
      setRestoredRibbonSlots(null)
      setRestoredRibbonDocId(null)
      devLog.push('ribbon-ui', 'unfreeze restored ribbon on refresh', { documentId })
    }
    devLog.push('ribbon', 'handlePause invoked', { textLen: text.length })

    if (trimmed.length < 2) {
      devLog.push('ribbon', 'handlePause early exit: text too short', {})
      return
    }

    if (trimmed === lastRefreshedTextRef.current) {
      devLog.push('ribbon', 'handlePause early exit: same as lastRefreshed', {})
      return
    }

    try {
      refreshAbortRef.current?.abort()
    } catch {
      // ignore
    }
    cancelActiveRibbonJobs('superseded by newer ribbon refresh')

    const controller = new AbortController()
    refreshAbortRef.current = controller

    const slotCount = Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount
    const savedModules = settings.ribbonSettings?.modules ?? []
    const byId = new Map(savedModules.map((m) => [m.id, m]))
    const allModules: RibbonModuleConfig[] = [
      ...BUILTIN_RIBBON_MODULES.filter((builtin) => builtin.type !== 'quick').map((builtin) => ({
        ...builtin,
        enabled: byId.get(builtin.id)?.enabled ?? (builtin.id === 'rag' || builtin.id === 'ai:imagery'),
        pinned: byId.get(builtin.id)?.pinned ?? false,
        prompt: byId.get(builtin.id)?.prompt,
        model: byId.get(builtin.id)?.model,
      })),
      ...savedModules.filter((module) => module.type === 'custom'),
    ]
    const enabledModules = allModules.filter((module) => module.enabled)

    const snapshot = ribbonEngine.createSnapshot(documentId, trimmed, currentBlockIdRef.current)
    refreshRequestIdRef.current = snapshot.id
    setRibbonState((prev) =>
      ribbonEngine.startSnapshot(
        prev,
        snapshot,
        slotCount,
        enabledModules.filter((module) => module.type !== 'rag' && module.pinned).map((module) => module.id),
      ),
    )
    debugIngest('H2', 'page.tsx:handlePause', 'refresh start', {
      textLen: trimmed.length,
      hasApiKey,
      slotCount,
    })

    try {
      const active = knowledgeBaseService.getActive()
      const ragModuleEnabled = enabledModules.some((module) => module.type === 'rag')
      const mandatoryBookIds = active?.mandatoryBooks ?? []
      const mandatoryMaxSlots = Math.min(3, Math.max(1, active?.mandatoryMaxSlots ?? 1)) as MandatoryMaxSlots
      const chunks = ragModuleEnabled && active?.id ? await getChunksByBase(active.id) : []

      if (refreshRequestIdRef.current !== snapshot.id) return

      let stableEchoes = ragModuleEnabled && active?.id
        ? await ragService.search(
            trimmed,
            {
              knowledgeBaseId: active.id,
              mandatoryBookIds,
              mandatoryMaxSlots,
            },
            currentBlockIdRef.current ?? undefined,
            chunks.length > 0 ? chunks : undefined,
          )
        : []

      if (refreshRequestIdRef.current !== snapshot.id) return

      stableEchoes = filterEchoesForKnowledgeBase(
        adoptionStore.boostOrderByAdoptions(stableEchoes, documentId),
        active,
      ).map((item) => ({
        ...item,
        moduleId: item.moduleId ?? 'rag',
        moduleLabel: item.moduleLabel ?? '知识检索',
        ribbonText: item.ribbonText ?? item.content ?? item.shortSummary ?? item.originalText ?? '',
      }))
      devLog.push('ribbon', 'stable echoes ready', { count: stableEchoes.length })

      const taggedStableEchoes = withSnapshotId(stableEchoes, snapshot.id)
      setRibbonState((prev) => ribbonEngine.ingestStable(prev, snapshot, taggedStableEchoes, slotCount))
      lastRefreshedTextRef.current = trimmed

      if (!hasApiKey) {
        setAiStatus('unconfigured')
        return
      }

      const aiModules = sortRibbonModulesForExecution(
        enabledModules.filter((module) => module.type !== 'rag' && module.type !== 'quick'),
      )

      void (async () => {
        const queue = [...aiModules]
        const workerCount = Math.min(RIBBON_BACKGROUND_CONCURRENCY, queue.length)

        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
              if (refreshRequestIdRef.current !== snapshot.id) return
              const nextModule = queue.shift()
              if (!nextModule) return
              await runBackgroundModule(snapshot.id, documentId, slotCount, trimmed, stableEchoes, nextModule)
            }
          }),
        )
      })()
    } catch (err) {
      setAiStatus(hasApiKey ? 'error' : 'unconfigured')
      const msg = (err as Error).message
      if (msg === 'API_KEY_INVALID') {
        throttledErrorToast('auth', 'API Key 鏃犳晥鎴栧凡杩囨湡锛岃鍦ㄨ缃腑鏇存柊')
      } else if (msg === 'RATE_LIMITED') {
        throttledErrorToast('rate', 'AI 璇锋眰棰戠巼瓒呴檺锛岃绋嶅悗鍐嶈瘯')
      } else if (msg === 'NETWORK_TIMEOUT') {
        throttledErrorToast('timeout', '杩炴帴瓒呮椂锛岃妫€鏌ョ綉缁滄垨 Base URL')
      } else {
        throttledErrorToast('generic', msg.length > 60 ? '回声刷新失败，请检查当前配置' : msg)
      }
    } finally {
      refreshAbortRef.current = null
    }
  }, [cancelActiveRibbonJobs, documentId, hasApiKey, renderedRibbonSlots, ribbonRestoreFrozen, runBackgroundModule, settings, throttledErrorToast])

  const pauseMs = Math.min(10, Math.max(1, settings.ribbonPauseSeconds ?? 2)) * 1000
  const { beat, stop: stopHeartbeat } = useHeartbeat({
    pauseThreshold: pauseMs,
    onPause: handlePause,
  })

  const handleEditorUpdate = useCallback((text: string, blockId: string | null) => {
    const prevText = lastTextRef.current
    if (suppressNextEditorBeatRef.current) {
      suppressNextEditorBeatRef.current = false
      lastTextRef.current = text
      currentBlockIdRef.current = blockId
      setCurrentBlockId(blockId)
      return
    }

    lastTextRef.current = text
    currentBlockIdRef.current = blockId
    setCurrentBlockId(blockId)
    if (text !== prevText && text.trim().length >= 2) {
      beat(text)
    }
  }, [beat])

  const saveDocument = useCallback(() => {
    if (!documentId) return
    const now = new Date().toISOString()
    const existing = documentStorage.get(documentId)
    documentStorage.save({
      id: documentId,
      title: title || '鏃犻',
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    documentStorage.setLastDocumentId(documentId)
  }, [content, documentId, title])

  const saveDocumentRef = useRef(saveDocument)
  saveDocumentRef.current = saveDocument
  const debouncedSave = useRef(debounce(() => saveDocumentRef.current(), AUTO_SAVE_MS)).current

  useEffect(() => {
    if (!documentId) return
    debouncedSave()
  }, [content, debouncedSave, documentId, title])

  useEffect(() => {
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true

    const lastId = documentStorage.getLastDocumentId()
    const id = lastId || generateId()
    const doc = documentStorage.get(id)
    if (doc) {
      suppressNextEditorBeatRef.current = true
      const loaded = filterEchoesForKnowledgeBase(flowHistory.load(doc.id), knowledgeBaseService.getActive())
      try {
        const savedDocId = localStorage.getItem(DISPLAY_ECHOES_DOC_ID_KEY)
        const savedEchoes = localStorage.getItem(DISPLAY_ECHOES_KEY)
        const savedHomeUi = localStorage.getItem(HOME_UI_STATE_KEY)
        if (savedHomeUi) {
          const parsedUi = JSON.parse(savedHomeUi) as {
            documentId?: string
            writingPanelOpen?: boolean
            writingPanelTab?: TabKey
            selectedRibbonEchoId?: string | null
            ribbonSlots?: unknown
          }
          if (parsedUi.documentId === doc.id) {
            const restoredSlots =
              normalizeStoredRibbonSlots(parsedUi.ribbonSlots, ribbonSlotCount) ??
              (savedDocId === doc.id && savedEchoes ? normalizeStoredRibbonSlots(JSON.parse(savedEchoes), ribbonSlotCount) : null)
            if (restoredSlots && restoredSlots.some((item) => item !== null)) {
              setRestoredRibbonSlots(restoredSlots)
              setRestoredRibbonDocId(doc.id)
              setRibbonRestoreFrozen(true)
              devLog.push('ribbon-ui', 'restore frozen snapshot', {
                documentId: doc.id,
                slotCount: ribbonSlotCount,
              })
            }
            setWritingPanelOpen(parsedUi.writingPanelOpen ?? true)
            setWritingPanelTab(parsedUi.writingPanelTab ?? 'today')
            const selectedItem =
              restoredSlots?.find((item) => item?.id === parsedUi.selectedRibbonEchoId) ?? null
            setSelectedRibbonEcho(selectedItem)
            selectedRibbonEchoRef.current = selectedItem
          }
        }
      } catch {
        // ignore
      }
      skipNextKnowledgeHydrateRef.current = doc.id
      setDocumentId(doc.id)
      setTitle(doc.title)
      setContent(doc.content || '')
      setEchoes(loaded)
      setRibbonState(ribbonEngine.hydrate(loaded, ribbonSlotCount, doc.id))
      lastTextRef.current = doc.content || ''
      lastRefreshedTextRef.current = doc.content || ''
    } else {
      suppressNextEditorBeatRef.current = true
      setRestoredRibbonSlots(null)
      setRestoredRibbonDocId(null)
      setRibbonRestoreFrozen(false)
      setWritingPanelOpen(true)
      setWritingPanelTab('today')
      setSelectedRibbonEcho(null)
      skipNextKnowledgeHydrateRef.current = id
      setDocumentId(id)
      setTitle('鏃犻')
      setContent('')
      const created: Document = {
        id,
        title: '鏃犻',
        content: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      documentStorage.save(created)
      documentStorage.setLastDocumentId(id)
      setEchoes([])
      setRibbonState(ribbonEngine.hydrate([], ribbonSlotCount, id))
    }
  }, [ribbonSlotCount])

  const handleContentChange = useCallback((html: string) => {
    setContent(html)
  }, [])

  const handleManualSave = useCallback(() => {
    saveDocument()
    toast.success('已保存')
  }, [saveDocument])

  const handleInspire = useCallback(() => {
    handlePause(lastTextRef.current)
  }, [handlePause])

  const handleSensoryZoom = useCallback(async () => {
    if (!settings.sensoryZoomEnabled) return
    if (sensoryZoomResults && sensoryZoomResults.length > 0) {
      setSensoryZoomResults(null)
      return
    }
    const baseText = selectionText.trim() || paragraphTextRef.current.trim() || lastTextRef.current.trim()
    if (!baseText) return
    const base = knowledgeBaseService.getActive()
    if (!base?.id) {
      toast.error('请先选择知识库')
      return
    }
    setSensoryZoomLoading(true)
    setSensoryZoomResults(null)
    try {
      const items = await expandSensoryZoom(baseText, content, base.id, settings)
      setSensoryZoomResults(items)
    } catch {
      toast.error('鎰熷畼鏀惧ぇ澶辫触')
    } finally {
      setSensoryZoomLoading(false)
    }
  }, [content, selectionText, sensoryZoomResults, settings])

  const runClicheDetection = useRef(
    debounce(() => {
      const text = paragraphTextRef.current
      if (!clicheEnabledRef.current) {
        setClicheMatches([])
        setParagraphForCliche('')
        return
      }
      setParagraphForCliche(text)
      setClicheMatches(detectCliches(text))
    }, 600),
  ).current

  const handleParagraphChangeFromEditor = useCallback((paragraphText: string) => {
    paragraphTextRef.current = paragraphText
    setCurrentParagraph(paragraphText)
    runClicheDetection()
  }, [runClicheDetection])

  const handleClicheAlternatives = useCallback(async () => {
    const base = knowledgeBaseService.getActive()
    if (!base?.id) {
      toast.error('请先选择知识库')
      return
    }
    const query = (paragraphForCliche.trim().slice(0, 200) || clicheMatches[0]?.phrase) ?? ''
    if (!query) return
    setShowClichePopover(true)
    setClicheAlternativesLoading(true)
    setClicheAlternatives([])
    try {
      const candidates = await generateCandidatesByViews(query, { knowledgeBaseId: base.id })
      const items = candidates.slice(0, 5).map(({ baseScore: _b, finalScore: _f, ...item }) => item as EchoItem)
      setClicheAlternatives(items)
    } catch {
      toast.error('鑾峰彇鏇夸唬琛ㄨ揪澶辫触')
    } finally {
      setClicheAlternativesLoading(false)
    }
  }, [clicheMatches, paragraphForCliche])

  const handleCaptureSelection = useCallback(() => {
    const text = selectionText.trim()
    if (!documentId || !text) return
    setWorkspace(
      writingWorkspaceStorage.addMaterial(documentId, {
        kind: 'selection',
        content: text,
        source: '褰撳墠閫夊尯',
        tags: [],
        sceneId: currentScene?.id ?? null,
        blockId: currentBlockIdRef.current,
        contextExcerpt: summarizeRevisionContext(text),
        status: currentScene?.id ? 'queued' : 'inbox',
      }),
    )
    toast.success('宸叉敹杩涚礌鏉愮')
  }, [currentScene?.id, documentId, selectionText])

  const handleCaptureEcho = useCallback(() => {
    if (!documentId || !selectedRibbonEcho) return
    const content = (selectedRibbonEcho.originalText ?? selectedRibbonEcho.content ?? '').trim()
    setWorkspace(
      writingWorkspaceStorage.addMaterial(documentId, {
        kind: 'echo',
        content,
        source: selectedRibbonEcho.source,
        note: selectedRibbonEcho.content,
        tags: [],
        sceneId: currentScene?.id ?? null,
        blockId: currentBlockIdRef.current,
        contextExcerpt: summarizeRevisionContext(content),
        status: currentScene?.id ? 'queued' : 'inbox',
      }),
    )
    toast.success('宸叉敹杩涚礌鏉愮')
  }, [currentScene?.id, documentId, selectedRibbonEcho])

  const handleCaptureRibbonEcho = useCallback((item: EchoItem) => {
    if (!documentId) return
    const content = (item.originalText ?? item.content ?? '').trim()
    if (!content) return
    setWorkspace(
      writingWorkspaceStorage.addMaterial(documentId, {
        kind: 'echo',
        content,
        source: item.source,
        note: item.content,
        tags: item.tag ? [item.tag] : [],
        sceneId: currentScene?.id ?? null,
        blockId: currentBlockIdRef.current,
        contextExcerpt: summarizeRevisionContext(content),
        status: currentScene?.id ? 'queued' : 'inbox',
      }),
    )
    toast.success(currentScene?.id ? '已收入当前场景待用素材' : '已收入素材箱')
  }, [currentScene?.id, documentId])

  const handleCreateRevisionFromEcho = useCallback((item: EchoItem) => {
    if (!documentId) return
    const raw = (item.detailText ?? item.originalText ?? item.content ?? '').trim()
    if (!raw) return
    const title =
      item.moduleLabel?.trim() ||
      item.source?.trim() ||
      item.tag?.trim() ||
      raw.slice(0, 24) ||
      '来自回声的修订'
    const next = writingWorkspaceStorage.addRevision(documentId, {
      title,
      detail: raw,
      kind: item.source?.toLowerCase().includes('ai') ? 'plot' : 'manual',
      priority: 'soon',
      tags: [item.tag, item.moduleLabel, item.source].filter(Boolean) as string[],
      contextExcerpt: summarizeRevisionContext(raw),
      blockId: item.blockId ?? currentBlockIdRef.current,
    })
    setWorkspace(next)
    toast.success('宸查€佸叆淇娓呭崟')
  }, [documentId])

  const handleConvertEchoToMemory = useCallback((item: EchoItem) => {
    if (!documentId) return
    const raw = (item.detailText ?? item.originalText ?? item.content ?? '').trim()
    if (!raw) return
    const inferredType =
      item.tag?.includes('鎰忚薄') || item.source?.toLowerCase().includes('imagery')
        ? 'imagery'
        : item.tag?.includes('鏃堕棿')
          ? 'timeline'
          : item.tag?.includes('鍏崇郴')
            ? 'relationship'
            : 'motif'

    const next = writingWorkspaceStorage.addMemoryNode(documentId, {
      type: inferredType,
      title: item.moduleLabel?.trim() || item.tag?.trim() || item.source?.trim() || raw.slice(0, 18),
      detail: raw,
      sceneId: currentScene?.id ?? null,
      blockId: item.blockId ?? currentBlockIdRef.current,
      source: `echo:${item.moduleId ?? item.source ?? 'unknown'}`,
    })
    setWorkspace(next)
    toast.success('已转入作者记忆')
  }, [currentScene?.id, documentId])

  const handleUpdateMaterialTags = useCallback((materialId: string, tags: string[]) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.updateMaterial(documentId, materialId, { tags }))
  }, [documentId])

  const handleAssignMaterialToCurrentScene = useCallback((materialId: string) => {
    if (!documentId) return
    if (!currentScene) {
      toast.error('当前还没有场景卡，暂时无法挂载素材')
      return
    }
    setWorkspace(
      writingWorkspaceStorage.updateMaterial(documentId, materialId, {
        sceneId: currentScene.id,
        blockId: currentBlockIdRef.current,
        contextExcerpt: summarizeRevisionContext(currentParagraph || lastTextRef.current),
        status: 'queued',
      }),
    )
    toast.success('已挂到当前场景')
  }, [currentParagraph, currentScene, documentId])

  const handleUpdateMaterialStatus = useCallback((materialId: string, status: MaterialStatus) => {
    if (!documentId) return
    setWorkspace(
      writingWorkspaceStorage.updateMaterial(documentId, materialId, {
        status,
        usedAt: status === 'used' ? new Date().toISOString() : undefined,
      }),
    )
  }, [documentId])

  const handleMoveMaterialToInbox = useCallback((materialId: string) => {
    if (!documentId) return
    setWorkspace(
      writingWorkspaceStorage.updateMaterial(documentId, materialId, {
        sceneId: null,
        status: 'inbox',
        usedAt: undefined,
      }),
    )
  }, [documentId])

  const handleLinkMaterialToRevision = useCallback((materialId: string) => {
    if (!documentId) return
    const material = workspace.materials.find((item) => item.id === materialId)
    if (!material) return
    const next = writingWorkspaceStorage.addRevision(documentId, {
      title: material.note?.trim() || material.content.trim().slice(0, 24) || '浠庣礌鏉愮敓鎴愮殑淇',
      detail: material.content.trim(),
      kind: 'manual',
      priority: 'soon',
      tags: material.tags,
      contextExcerpt: material.contextExcerpt ?? summarizeRevisionContext(material.content),
      blockId: material.blockId ?? currentBlockIdRef.current,
    })
    setWorkspace(next)
    toast.success('宸查€佸叆淇娓呭崟')
  }, [documentId, workspace.materials])

  const handleConvertMaterialToMemory = useCallback((materialId: string) => {
    if (!documentId) return
    const material = workspace.materials.find((item) => item.id === materialId)
    if (!material || !material.content.trim()) return

    const loweredTags = material.tags.map((tag) => tag.toLowerCase())
    const inferredType =
      material.characterName
        ? 'character'
        : loweredTags.some((tag) => tag.includes('鍏崇郴'))
          ? 'relationship'
          : loweredTags.some((tag) => tag.includes('鎰忚薄'))
            ? 'imagery'
            : loweredTags.some((tag) => tag.includes('鏃堕棿'))
              ? 'timeline'
              : 'motif'

    const next = writingWorkspaceStorage.addMemoryNode(documentId, {
      type: inferredType,
      title: material.characterName || material.note?.trim() || material.content.trim().slice(0, 18),
      detail: material.content.trim(),
      sceneId: material.sceneId ?? currentScene?.id ?? null,
      blockId: material.blockId ?? currentBlockIdRef.current,
      source: `material:${material.kind}`,
    })
    setWorkspace(next)
    toast.success('已转入作者记忆')
  }, [currentScene?.id, documentId, workspace.materials])

  const handleRemoveMaterial = useCallback((materialId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeMaterial(documentId, materialId))
  }, [documentId])

  const handleUpdateRevisionStatus = useCallback((revisionId: string, status: 'open' | 'done') => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.updateRevision(documentId, revisionId, { status }))
  }, [documentId])

  const handleFocusRevisionBlock = useCallback((revision: RevisionTask) => {
    if (!revision.blockId) {
      toast.error('杩欐潯淇杩樻病鏈夌粦瀹氬埌鍏蜂綋娈佃惤')
      return
    }
    const focused = editorRef.current?.focusBlock(revision.blockId) ?? false
    if (!focused) {
      toast.error('原段落已变化，暂时无法直接定位')
    }
  }, [])

  const handleRemoveRevision = useCallback((revisionId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeRevision(documentId, revisionId))
  }, [documentId])

  const handleAddSceneFromCurrent = useCallback(() => {
    const summary = currentParagraph.trim() || selectionText.trim()
    if (!documentId || !summary) return
    const blockId = currentBlockIdRef.current
    const contextExcerpt = summarizeRevisionContext(summary)
    const existingScene = blockId ? workspace.scenes.find((scene) => scene.blockId === blockId) : null
    const orderedScenes = workspace.scenes.slice().sort((a, b) => a.order - b.order)
    const fallbackChapterTitle =
      currentScene?.chapterTitle?.trim() ||
      orderedScenes.at(-1)?.chapterTitle?.trim() ||
      (orderedScenes.length > 0 ? '未分章' : '第 1 章')

    const next = existingScene
      ? writingWorkspaceStorage.updateScene(documentId, existingScene.id, {
          chapterTitle: existingScene.chapterTitle ?? fallbackChapterTitle,
          title: existingScene.title?.trim() || buildSceneTitle(summary),
          summary,
          blockId,
          contextExcerpt,
          lastReviewedAt: new Date().toISOString(),
        })
      : writingWorkspaceStorage.addScene(documentId, {
          chapterTitle: fallbackChapterTitle,
          title: buildSceneTitle(summary),
          summary,
          blockId,
          contextExcerpt,
          lastReviewedAt: new Date().toISOString(),
        })

    setWorkspace(next)
    toast.success(existingScene ? '宸叉洿鏂板綋鍓嶅満鏅崱' : '宸茬敓鎴愬綋鍓嶅満鏅崱')
  }, [currentParagraph, currentScene?.chapterTitle, documentId, selectionText, workspace.scenes])

  const handleUpdateScene = useCallback((
    sceneId: string,
    updates: Partial<{
      chapterTitle: string
      title: string
      summary: string
      goal: string
      tension: string
      order: number
      blockId: string | null
      contextExcerpt: string
      lastReviewedAt: string
    }>,
  ) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.updateScene(documentId, sceneId, updates))
  }, [documentId])

  const handleRemoveScene = useCallback((sceneId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeScene(documentId, sceneId))
  }, [documentId])

  const handleAddCharacterWatch = useCallback((input: {
    title: string
    characterName?: string
    detail: string
    sceneId?: string | null
    blockId?: string | null
  }) => {
    if (!documentId || !input.title.trim() || !input.detail.trim()) return
    const next = writingWorkspaceStorage.addCharacterWatch(documentId, {
      title: input.title.trim(),
      characterName: input.characterName?.trim() || undefined,
      detail: input.detail.trim(),
      sceneId: input.sceneId ?? currentScene?.id ?? null,
      blockId: input.blockId ?? currentBlockIdRef.current,
    })
    setWorkspace(next)
    toast.success('宸茶涓轰汉鐗╂敞鎰忕偣')
  }, [currentScene?.id, documentId])

  const handleUpdateCharacterWatchStatus = useCallback((watchId: string, status: CharacterWatchStatus) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.updateCharacterWatch(documentId, watchId, { status }))
  }, [documentId])

  const handleRemoveCharacterWatch = useCallback((watchId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeCharacterWatch(documentId, watchId))
  }, [documentId])

  const handleAddMemoryNode = useCallback((input: {
    type: 'character' | 'relationship' | 'motif' | 'imagery' | 'timeline'
    title: string
    detail?: string
    sceneId?: string | null
    blockId?: string | null
    source?: string
  }) => {
    if (!documentId || !input.title.trim()) return
    const next = writingWorkspaceStorage.addMemoryNode(documentId, {
      type: input.type,
      title: input.title.trim(),
      detail: input.detail?.trim(),
      sceneId: input.sceneId ?? currentScene?.id ?? null,
      blockId: input.blockId ?? currentBlockIdRef.current,
      source: input.source ?? 'manual',
    })
    setWorkspace(next)
  }, [currentScene?.id, documentId])

  const handleRemoveMemoryNode = useCallback((nodeId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeMemoryNode(documentId, nodeId))
  }, [documentId])

  const handleAddPracticeDrill = useCallback((input: {
    title: string
    detail: string
    focus?: string
    sceneId?: string | null
    blockId?: string | null
  }) => {
    if (!documentId || !input.title.trim() || !input.detail.trim()) return
    const next = writingWorkspaceStorage.addPracticeDrill(documentId, {
      title: input.title.trim(),
      detail: input.detail.trim(),
      focus: input.focus?.trim() || undefined,
      sceneId: input.sceneId ?? currentScene?.id ?? null,
      blockId: input.blockId ?? currentBlockIdRef.current,
    })
    setWorkspace(next)
    toast.success('宸插姞鍏ョ粌涔犳祦')
  }, [currentScene?.id, documentId])

  const handleUpdatePracticeDrillStatus = useCallback((drillId: string, status: PracticeDrillStatus) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.updatePracticeDrill(documentId, drillId, { status }))
  }, [documentId])

  const handleRemovePracticeDrill = useCallback((drillId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removePracticeDrill(documentId, drillId))
  }, [documentId])

  const handleRestoreSnapshot = useCallback((snapshot: DocumentSnapshot) => {
    if (!documentId) return
    stopHeartbeat()
    suppressNextEditorBeatRef.current = true
    setTitle(snapshot.title || '未命名')
    setContent(snapshot.content)
    setEditorContentVersion((value) => value + 1)
    const plain = writingWorkspaceStorage.plainTextFromHtml(snapshot.content)
    lastTextRef.current = plain
    lastRefreshedTextRef.current = plain
    documentStorage.save({
      id: documentId,
      title: snapshot.title || '未命名',
      content: snapshot.content,
      createdAt: documentStorage.get(documentId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    toast.success('已恢复到该快照')
  }, [documentId, stopHeartbeat])

  const handleRemoveSnapshot = useCallback((snapshotId: string) => {
    if (!documentId) return
    setWorkspace(writingWorkspaceStorage.removeSnapshot(documentId, snapshotId))
  }, [documentId])

  const handleOpenDocument = useCallback((id: string) => {
    stopHeartbeat()
    saveDocumentRef.current()
    const doc = documentStorage.get(id)
    if (!doc) return

    suppressNextEditorBeatRef.current = true
    documentStorage.setLastDocumentId(id)
    const loaded = filterEchoesForKnowledgeBase(flowHistory.load(doc.id), knowledgeBaseService.getActive())
    skipNextKnowledgeHydrateRef.current = doc.id
    setDocumentId(doc.id)
    setTitle(doc.title || '鏃犻')
    setContent(doc.content || '')
    setEchoes(loaded)
    setRibbonState(ribbonEngine.hydrate(loaded, Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount, doc.id))
    try {
      const savedEchoes = localStorage.getItem(DISPLAY_ECHOES_KEY)
      const savedEchoDocId = localStorage.getItem(DISPLAY_ECHOES_DOC_ID_KEY)
      if (savedEchoDocId === doc.id && savedEchoes) {
        const parsed = JSON.parse(savedEchoes)
        const restoredSlots = normalizeStoredRibbonSlots(parsed, ribbonSlotCount)
        if (restoredSlots && restoredSlots.some((item) => item !== null)) {
          setRestoredRibbonSlots(restoredSlots)
          setRestoredRibbonDocId(doc.id)
          setRibbonRestoreFrozen(true)
        }
      } else {
        setRestoredRibbonSlots(null)
        setRestoredRibbonDocId(null)
        setRibbonRestoreFrozen(false)
      }

      const savedHomeUi = localStorage.getItem(HOME_UI_STATE_KEY)
      if (savedHomeUi) {
        const parsedUi = JSON.parse(savedHomeUi) as {
          documentId?: string
          writingPanelOpen?: boolean
          writingPanelTab?: TabKey
          selectedRibbonEchoId?: string | null
          ribbonSlots?: unknown
        }
        if (parsedUi.documentId === doc.id) {
          setWritingPanelOpen(parsedUi.writingPanelOpen ?? true)
          setWritingPanelTab(parsedUi.writingPanelTab ?? 'today')
          const restoredSlots = normalizeStoredRibbonSlots(parsedUi.ribbonSlots, ribbonSlotCount)
          const selectedItem =
            restoredSlots?.find((item) => item?.id === parsedUi.selectedRibbonEchoId) ?? null
          setSelectedRibbonEcho(selectedItem)
          selectedRibbonEchoRef.current = selectedItem
        } else {
          setWritingPanelOpen(true)
          setWritingPanelTab('today')
          setSelectedRibbonEcho(null)
          selectedRibbonEchoRef.current = null
        }
      }
    } catch {
      // ignore
    }
    setAssistResults({})
    setCurrentParagraph('')
    lastTextRef.current = doc.content || ''
    lastRefreshedTextRef.current = doc.content || ''
  }, [ribbonSlotCount, settings.ribbonSettings?.slotCount, stopHeartbeat])

  const handleNewDocument = useCallback(() => {
    stopHeartbeat()
    saveDocumentRef.current()
    const id = generateId()
    suppressNextEditorBeatRef.current = true
    skipNextKnowledgeHydrateRef.current = id
    const newDoc: Document = {
      id,
      title: '鏃犻',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    documentStorage.save(newDoc)
    documentStorage.setLastDocumentId(id)
    setDocumentId(id)
    setTitle('鏃犻')
    setContent('')
    setEchoes([])
    setRibbonState(ribbonEngine.hydrate([], Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount, id))
    setRestoredRibbonSlots(null)
    setRestoredRibbonDocId(null)
    setRibbonRestoreFrozen(false)
    setWritingPanelOpen(true)
    setWritingPanelTab('today')
    setSelectedRibbonEcho(null)
    selectedRibbonEchoRef.current = null
    setAssistResults({})
    setCurrentParagraph('')
    lastTextRef.current = ''
    lastRefreshedTextRef.current = ''
  }, [settings.ribbonSettings?.slotCount, stopHeartbeat])

  const detailAiSettings = useMemo(
    () => ({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
    }),
    [settings.apiKey, settings.baseUrl, settings.model],
  )
  const referenceEcho = useMemo(() => pickReferenceEcho(visibleRibbonEchoes), [visibleRibbonEchoes])

  const addMaterial = useCallback((input: { content: string; note?: string; tags?: string[]; source?: string; kind?: 'echo' | 'selection' | 'note' | 'plot' | 'exercise'; characterName?: string; sceneId?: string | null; blockId?: string | null; contextExcerpt?: string; status?: MaterialStatus }) => {
    if (!documentId || !input.content.trim()) return
    const fallbackSceneId = input.sceneId !== undefined ? input.sceneId : currentScene?.id ?? null
    const fallbackStatus = input.status ?? (fallbackSceneId ? 'queued' : 'inbox')
    const next = writingWorkspaceStorage.addMaterial(documentId, {
      kind: input.kind ?? 'note',
      content: input.content.trim(),
      note: input.note?.trim(),
      source: input.source,
      sceneId: fallbackSceneId,
      blockId: input.blockId ?? currentBlockIdRef.current,
      characterName: input.characterName?.trim() || undefined,
      contextExcerpt: input.contextExcerpt ?? summarizeRevisionContext(currentParagraph || input.content),
      status: fallbackStatus,
      tags: input.tags ?? [],
    })
    setWorkspace(next)
  }, [currentParagraph, currentScene?.id, documentId])

  const addRevision = useCallback((input: {
    title: string
    detail?: string
    kind?: 'manual' | 'radar' | 'plot' | 'character' | 'cliche'
    tags?: string[]
    priority?: RevisionTaskPriority
    contextExcerpt?: string
    blockId?: string | null
  }) => {
    if (!documentId || !input.title.trim()) return
    const fallbackContext = summarizeRevisionContext(selectionText || currentParagraph || lastTextRef.current)
    const next = writingWorkspaceStorage.addRevision(documentId, {
      title: input.title.trim(),
      detail: input.detail?.trim(),
      kind: input.kind ?? 'manual',
      priority: input.priority ?? revisionPriorityFromSeverity(input.kind ?? 'manual'),
      contextExcerpt: input.contextExcerpt ?? fallbackContext,
      tags: input.tags ?? [],
      blockId: input.blockId ?? currentBlockIdRef.current,
    })
    setWorkspace(next)
  }, [currentParagraph, documentId, selectionText])

  const addScene = useCallback((input: {
    chapterTitle?: string
    title: string
    summary: string
    goal?: string
    tension?: string
    blockId?: string | null
    contextExcerpt?: string
    lastReviewedAt?: string
  }) => {
    if (!documentId) return
    const summary = input.summary.trim()
    if (!summary && !input.title.trim()) return
    const orderedScenes = workspace.scenes.slice().sort((a, b) => a.order - b.order)
    const fallbackChapterTitle =
      input.chapterTitle?.trim() ||
      currentScene?.chapterTitle?.trim() ||
      orderedScenes.at(-1)?.chapterTitle?.trim() ||
      (orderedScenes.length > 0 ? '未分章' : '第 1 章')
    const next = writingWorkspaceStorage.addScene(documentId, {
      chapterTitle: fallbackChapterTitle,
      title: input.title.trim() || buildSceneTitle(summary),
      summary,
      goal: input.goal?.trim(),
      tension: input.tension?.trim(),
      blockId: input.blockId ?? null,
      contextExcerpt: input.contextExcerpt ?? summarizeRevisionContext(summary),
      lastReviewedAt: input.lastReviewedAt,
    })
    setWorkspace(next)
  }, [currentScene?.chapterTitle, documentId, workspace.scenes])

  const createSnapshot = useCallback((note?: string) => {
    if (!documentId) return
    const next = writingWorkspaceStorage.createSnapshot(documentId, {
      title: title || '未命名',
      content,
      note,
    })
    setWorkspace(next)
    toast.success('已保存快照')
  }, [content, documentId, title])

  const runAssist = useCallback(async (
    kind: WritingAssistKind,
    runner: () => Promise<WritingAssistResult>,
  ) => {
    setAssistLoading((prev) => ({ ...prev, [kind]: true }))
    try {
      const result = await runner()
      setAssistResults((prev) => ({ ...prev, [kind]: result }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '鍒嗘瀽澶辫触')
    } finally {
      setAssistLoading((prev) => ({ ...prev, [kind]: false }))
    }
  }, [])

  const handleRunRevisionRadar = useCallback(() => {
    const text = (selectionText.trim() || currentParagraph.trim() || lastTextRef.current.trim()).slice(0, 1800)
    if (!text) return
    void runAssist('revision_radar', () => generateRevisionRadar(text, detailAiSettings))
  }, [currentParagraph, detailAiSettings, runAssist, selectionText])

  const handleRunPlotProgression = useCallback(() => {
    const text = (currentParagraph.trim() || lastTextRef.current.trim()).slice(0, 1800)
    if (!text) return
    const referenceText = (selectedRibbonEcho?.originalText ?? referenceEcho?.originalText ?? referenceEcho?.content ?? '').trim()
    const referenceLabel = selectedRibbonEcho?.source ?? referenceEcho?.source ?? undefined
    void runAssist('plot', () =>
      generatePlotProgression(text, detailAiSettings, {
        referenceText,
        referenceLabel,
        sceneTitle: currentScene?.title,
        sceneSummary: currentScene?.summary,
        sceneGoal: currentScene?.goal,
        sceneTension: currentScene?.tension,
      }).then((result) => {
        if (documentId && currentScene) {
          setWorkspace(
            writingWorkspaceStorage.updateScene(documentId, currentScene.id, {
              lastReviewedAt: new Date().toISOString(),
            }),
          )
        }
        return result
      }),
    )
  }, [currentParagraph, currentScene, detailAiSettings, documentId, referenceEcho, runAssist, selectedRibbonEcho])

  const handleRunCharacterConsistency = useCallback(() => {
    const text = (currentParagraph.trim() || lastTextRef.current.trim()).slice(0, 1800)
    if (!text) return
    const referenceText = (selectedRibbonEcho?.originalText ?? referenceEcho?.originalText ?? '').trim()
    const referenceLabel = selectedRibbonEcho?.source ?? referenceEcho?.source ?? undefined
    void runAssist('character', () =>
      generateCharacterConsistency(text, detailAiSettings, {
        referenceText,
        referenceLabel,
        sceneTitle: currentScene?.title,
        sceneSummary: currentScene?.summary,
        sceneGoal: currentScene?.goal,
        sceneTension: currentScene?.tension,
      }).then((result) => {
        if (documentId && currentScene) {
          setWorkspace(
            writingWorkspaceStorage.updateScene(documentId, currentScene.id, {
              lastReviewedAt: new Date().toISOString(),
            }),
          )
        }
        return result
      }),
    )
  }, [currentParagraph, currentScene, detailAiSettings, documentId, referenceEcho, runAssist, selectedRibbonEcho])

  const handleRunSceneMemoryMap = useCallback(() => {
    const text = (currentParagraph.trim() || lastTextRef.current.trim()).slice(0, 1800)
    if (!text) return
    const referenceText = (selectedRibbonEcho?.originalText ?? referenceEcho?.originalText ?? referenceEcho?.content ?? '').trim()
    const referenceLabel = selectedRibbonEcho?.source ?? referenceEcho?.source ?? undefined
    void runAssist('memory_map', () =>
      generateSceneMemoryMap(text, detailAiSettings, {
        referenceText,
        referenceLabel,
        sceneTitle: currentScene?.title,
        sceneSummary: currentScene?.summary,
        sceneGoal: currentScene?.goal,
        sceneTension: currentScene?.tension,
      }).then((result) => {
        if (!documentId) return result
        let nextWorkspace = workspace
        for (const item of result.items) {
          const normalizedTag = (item.tag ?? '').trim()
          const type =
            normalizedTag === '浜虹墿'
              ? 'character'
              : normalizedTag === '鍏崇郴'
                ? 'relationship'
                : normalizedTag === '鎰忚薄'
                  ? 'imagery'
                  : normalizedTag === '时间线'
                    ? 'timeline'
                    : 'motif'
          nextWorkspace = writingWorkspaceStorage.addMemoryNode(documentId, {
            type,
            title: item.title,
            detail: item.detail,
            sceneId: currentScene?.id ?? null,
            blockId: currentBlockIdRef.current,
            source: 'scene_memory_map',
          })
        }
        setWorkspace(nextWorkspace)
        if (currentScene) {
          setWorkspace(
            writingWorkspaceStorage.updateScene(documentId, currentScene.id, {
              lastReviewedAt: new Date().toISOString(),
            }),
          )
        }
        return result
      }),
    )
  }, [currentParagraph, currentScene, detailAiSettings, documentId, referenceEcho, runAssist, selectedRibbonEcho, workspace])

  const handleApplyStructureInsightToCurrentScene = useCallback((detail: string) => {
    if (!documentId || !currentScene) {
      toast.error('先把当前段落变成场景卡，再写回结构判断')
      return
    }
    const nextGoal = currentScene.goal?.trim()
    const nextTension = currentScene.tension?.trim()
    const trimmed = detail.trim()
    const next = writingWorkspaceStorage.updateScene(documentId, currentScene.id, {
      goal: nextGoal || trimmed,
      tension: nextGoal ? (nextTension ? `${nextTension} / ${trimmed}` : trimmed) : nextTension,
      lastReviewedAt: new Date().toISOString(),
    })
    setWorkspace(next)
    toast.success('宸插啓鍏ュ綋鍓嶅満鏅崱')
  }, [currentScene, documentId])

  const handleRunImitationDrill = useCallback(() => {
    const text = (selectionText.trim() || currentParagraph.trim() || lastTextRef.current.trim()).slice(0, 1400)
    const referenceText = (selectedRibbonEcho?.originalText ?? referenceEcho?.originalText ?? referenceEcho?.content ?? '').trim()
    const referenceLabel = selectedRibbonEcho?.source ?? referenceEcho?.source ?? undefined
    if (!text || !referenceText) {
      toast.error('鍏堥€変竴鏉″洖澹版垨绛変簰鏂囨潗鏂欏嚭鐜帮紝鍐嶅仛浠垮啓闄粌')
      return
    }
    void runAssist('imitation', () =>
      generateImitationDrill(text, referenceText, detailAiSettings, { referenceLabel }),
    )
  }, [currentParagraph, detailAiSettings, referenceEcho, runAssist, selectedRibbonEcho, selectionText])

  if (documentId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)]">
        <p className="text-[var(--color-ink-faint)]">鍔犺浇涓?..</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-paper)]">
      <DocumentPanel
        currentDocumentId={documentId}
        onOpenDocument={handleOpenDocument}
        onNewDocument={handleNewDocument}
      />
      <div className="fixed top-6 right-8 flex flex-col gap-4 z-[60]">
        <KnowledgePanel aiStatus={aiStatus} />
        <DevPanel />
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-shrink-0 h-[14rem] min-h-[14rem] border-b border-[var(--color-border)]/70 bg-[var(--color-paper)] overflow-hidden">
          <AmbientRibbon
              echoes={
                renderedRibbonSlots.filter((item): item is EchoItem => item !== null)
              }
              slots={
                renderedRibbonSlots
              }
            freezeLayout={shouldPreferFrozenRibbonSnapshot}
            suppressEmptyHint={shouldPreferFrozenRibbonSnapshot}
            slotCount={(Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as RibbonSlotCount)}
            currentBlockId={currentBlockId}
            hasApiKey={hasApiKey}
            hasKnowledge={hasKnowledge}
            selectedEchoId={selectedRibbonEcho?.id ?? null}
            onRibbonSelect={(item) => {
              selectedRibbonEchoRef.current = item
              setSelectedRibbonEcho(item)
            }}
            onEchoCopied={recordEchoAdoption}
          />
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col items-center pt-8 pb-32 px-6">
            <div className="w-full max-w-2xl mb-12">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="鏃犻"
                className="bg-transparent border-none outline-none text-2xl font-bold placeholder:opacity-20 w-full mb-4 text-[var(--color-ink)]"
                aria-label="Document title"
              />
              <div className="w-12 h-0.5 bg-[var(--color-border)]" />
            </div>

            <div className="w-full max-w-2xl mx-auto">
              {settings.sensoryZoomEnabled && (
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={handleSensoryZoom}
                    disabled={sensoryZoomLoading}
                    className="px-3 py-1.5 text-sm rounded-md bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 disabled:opacity-50 transition-colors"
                  >
                    {sensoryZoomLoading ? '加载中…' : '感官放大 Alt+Z'}
                  </button>
                </div>
              )}
              {settings.clicheDetectionEnabled && clicheMatches.length > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={handleClicheAlternatives}
                    className="px-3 py-1.5 text-sm rounded-md border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    濂楄矾璇嶏紝鐐瑰嚮鑾峰彇鏇夸唬琛ㄨ揪
                  </button>
                </div>
              )}
              <EchoEditor
                ref={editorRef}
                key={documentId}
                initialContent={content}
                contentVersion={editorContentVersion}
                onUpdate={handleEditorUpdate}
                onContentChange={handleContentChange}
                onSave={handleManualSave}
                onInspire={handleInspire}
                onSelectionChange={setSelectionText}
                onSensoryZoom={handleSensoryZoom}
                onParagraphChange={handleParagraphChangeFromEditor}
              />
            </div>

            {sensoryZoomResults != null && sensoryZoomResults.length > 0 && (
              <div className="fixed left-6 top-1/2 -translate-y-1/2 z-50 max-w-sm w-[320px] p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg max-h-64 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-[var(--color-ink-faint)]">感官放大，点击复制</span>
                  <button
                    type="button"
                    onClick={() => setSensoryZoomResults(null)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] p-1"
                    aria-label="鍏抽棴"
                  >
                    脳
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {sensoryZoomResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-[var(--color-paper)] text-[var(--color-ink)]"
                        onClick={() => {
                          const copied = item.originalText ?? item.content ?? ''
                          navigator.clipboard.writeText(copied).then(() => toast.success('已复制'), () => {})
                        }}
                      >
                        {item.content}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {showClichePopover && (
              <div className="fixed left-6 top-1/2 -translate-y-1/2 z-50 max-w-sm w-[320px] p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg max-h-64 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-[var(--color-ink-faint)]">非套路化替代表达，点击复制</span>
                  <button
                    type="button"
                    onClick={() => setShowClichePopover(false)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] p-1"
                    aria-label="鍏抽棴"
                  >
                    脳
                  </button>
                </div>
                {clicheAlternativesLoading ? (
                  <p className="text-sm text-[var(--color-ink-faint)]">加载中…</p>
                ) : clicheAlternatives.length === 0 ? (
                  <p className="text-sm text-[var(--color-ink-faint)]">未找到相关替代表达</p>
                ) : (
                  <ul className="space-y-1.5">
                    {clicheAlternatives.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-[var(--color-paper)] text-[var(--color-ink)]"
                          onClick={() => {
                            const copied = item.originalText ?? item.content ?? ''
                            navigator.clipboard.writeText(copied).then(() => toast.success('已复制'), () => {})
                          }}
                        >
                          {item.content}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <RibbonDetailPanel
        item={selectedRibbonEcho}
        currentSceneLabel={currentScene?.title ?? null}
        onCaptureMaterial={handleCaptureRibbonEcho}
        onCreateRevision={handleCreateRevisionFromEcho}
        onConvertToMemory={handleConvertEchoToMemory}
        onClose={() => {
          selectedRibbonEchoRef.current = null
          setSelectedRibbonEcho(null)
        }}
      />
      <WritingAssistantPanel
        isOpen={writingPanelOpen}
        onOpenChange={setWritingPanelOpen}
        activeTab={writingPanelTab}
        onTabChange={setWritingPanelTab}
        profile={profile}
        workspace={workspace}
        selectedText={selectionText}
        selectedEcho={selectedRibbonEcho}
        currentParagraph={currentParagraph}
        currentBlockId={currentBlockId}
        currentScene={currentScene}
        assistResults={assistResults}
        assistLoading={assistLoading}
        onRunRevisionRadar={handleRunRevisionRadar}
        onRunPlotProgression={handleRunPlotProgression}
        onRunCharacterConsistency={handleRunCharacterConsistency}
        onRunImitationDrill={handleRunImitationDrill}
        onRunSceneMemoryMap={handleRunSceneMemoryMap}
        onCaptureSelection={handleCaptureSelection}
        onCaptureEcho={handleCaptureEcho}
        onAddManualMaterial={(input) => addMaterial({ ...input, kind: 'note' })}
        onUpdateMaterialTags={handleUpdateMaterialTags}
        onAssignMaterialToCurrentScene={handleAssignMaterialToCurrentScene}
        onUpdateMaterialStatus={handleUpdateMaterialStatus}
        onMoveMaterialToInbox={handleMoveMaterialToInbox}
        onLinkMaterialToRevision={handleLinkMaterialToRevision}
        onConvertMaterialToMemory={handleConvertMaterialToMemory}
        onRemoveMaterial={handleRemoveMaterial}
        onAddRevision={addRevision}
        onUpdateRevisionStatus={handleUpdateRevisionStatus}
        onRemoveRevision={handleRemoveRevision}
        onFocusRevisionBlock={handleFocusRevisionBlock}
        onAddSceneFromCurrent={handleAddSceneFromCurrent}
        onAddScene={addScene}
        onUpdateScene={handleUpdateScene}
        onRemoveScene={handleRemoveScene}
        onAddCharacterWatch={handleAddCharacterWatch}
        onUpdateCharacterWatchStatus={handleUpdateCharacterWatchStatus}
        onRemoveCharacterWatch={handleRemoveCharacterWatch}
        onAddMemoryNode={handleAddMemoryNode}
        onRemoveMemoryNode={handleRemoveMemoryNode}
        onAddPracticeDrill={handleAddPracticeDrill}
        onUpdatePracticeDrillStatus={handleUpdatePracticeDrillStatus}
        onRemovePracticeDrill={handleRemovePracticeDrill}
        onApplyStructureInsightToCurrentScene={handleApplyStructureInsightToCurrentScene}
        onCreateSnapshot={createSnapshot}
        onRestoreSnapshot={handleRestoreSnapshot}
        onRemoveSnapshot={handleRemoveSnapshot}
      />
    </div>
  )
}
