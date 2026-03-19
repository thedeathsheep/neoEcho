'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// Extend Window interface for custom event
declare global {
  interface WindowEventMap {
    'knowledge-base-updated': CustomEvent
  }
}
import { toast } from 'sonner'

import { EchoEditor } from '@/components/editor/echo-editor'
import { AmbientRibbon } from '@/components/ribbon/ambient-ribbon'
import { RibbonDetailPanel } from '@/components/ribbon/ribbon-detail-panel'
import { KnowledgePanel } from '@/components/ui/knowledge-panel'
import { DevPanel } from '@/components/ui/dev-panel'
import { DocumentPanel } from '@/components/ui/document-panel'
import { documentStorage } from '@/lib/document-storage'
import { devLog } from '@/lib/dev-log'
import { flowHistory } from '@/lib/flow-history'
import { useSettings, BUILTIN_RIBBON_MODULES } from '@/lib/settings-context'
import { debounce } from '@/lib/utils/time'
import { generateId } from '@/lib/utils/crypto'
import { useHeartbeat } from '@/hooks/use-heartbeat'
import { ragService, generateCandidatesByViews, type MandatoryMaxSlots } from '@/services/rag.service'
import {
  generateEchoes,
  generateEchoesForModule,
  generateBatchEchoesForModules,
  probeChatCompletions,
  expandQueryForRAG,
  filterRibbonCandidates,
  rerankRagCandidates,
  correctRagResultsForContext,
  summarizeRagChunks,
  type ModuleGenerationResult,
} from '@/services/client-ai.service'
import {
  knowledgeBaseService,
  getKnowledgeStats,
  getChunksByBase,
  type KnowledgeBase,
} from '@/services/knowledge-base.service'
import { allocateSlots, createLoadingPlaceholders, type ModuleResult } from '@/lib/ribbon-allocator'
import { detectCliches, type ClicheMatch } from '@/lib/cliche-detector'
import { adoptionStore } from '@/services/adoption-store'
import { expandSensoryZoom } from '@/services/sensory-zoom.service'
import type { Document, EchoItem, RibbonModuleConfig, PlaceholderItem } from '@/types'

const AUTO_SAVE_MS = 2000
const ERROR_THROTTLE_MS = 60_000
const DISPLAY_ECHOES_KEY = 'echo-display-echoes'
const DISPLAY_BATCH_KEY = 'echo-display-batch'
/** Max wait per ribbon module so one slow module does not block the whole refresh. */
const RIBBON_MODULE_TIMEOUT_MS = 12_000
const RIBBON_MODULE_TIMEOUT_RELIABLE_MS = 60_000

function debugIngest(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch('http://127.0.0.1:7776/ingest/bd75bf12-cc2c-45c2-9d32-c1c193905a25',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'626617'},body:JSON.stringify({sessionId:'626617',runId:'diag',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

/** Resolve with fallback after ms so Promise.all does not wait for the slowest. */
function raceWithTimeout<T>(ms: number, promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/** Pick up to maxSlots RAG items with diversity: same source at most 2 consecutive. */
function selectDiverseRagForRibbon(items: EchoItem[], maxSlots: number): EchoItem[] {
  const out: EchoItem[] = []
  for (const item of items) {
    if (out.length >= maxSlots) break
    const source = item.source ?? ''
    const lastTwo = out.slice(-2).map((x) => x.source ?? '')
    if (lastTwo.length === 2 && lastTwo[0] === source && lastTwo[1] === source) continue
    out.push(item)
  }
  return out
}

export type AiStatus = 'idle' | 'unconfigured' | 'loading' | 'connected' | 'error'

export default function Home() {
  const { settings } = useSettings()
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [echoes, setEchoes] = useState<EchoItem[]>([])
  const [displayEchoes, setDisplayEchoes] = useState<EchoItem[]>([])
  const [displayPlaceholders, setDisplayPlaceholders] = useState<PlaceholderItem[]>([])
  const [batchKey, setBatchKey] = useState(0)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle')
  const [isRibbonRefreshing, setIsRibbonRefreshing] = useState(false)
  const [selectedRibbonEcho, setSelectedRibbonEcho] = useState<EchoItem | null>(null)
  const selectedRibbonEchoRef = useRef<EchoItem | null>(null)
  const [selectionText, setSelectionText] = useState('')
  const [sensoryZoomResults, setSensoryZoomResults] = useState<EchoItem[] | null>(null)
  const [sensoryZoomLoading, setSensoryZoomLoading] = useState(false)
  const [clicheMatches, setClicheMatches] = useState<ClicheMatch[]>([])
  const [paragraphForCliche, setParagraphForCliche] = useState('')
  const [showClichePopover, setShowClichePopover] = useState(false)
  const [clicheAlternatives, setClicheAlternatives] = useState<EchoItem[]>([])
  const [clicheAlternativesLoading, setClicheAlternativesLoading] = useState(false)

  // Request ID for concurrency control
  const refreshRequestIdRef = useRef<string>('')
  const refreshAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    selectedRibbonEchoRef.current = selectedRibbonEcho
  }, [selectedRibbonEcho])

  const currentBlockIdRef = useRef<string | null>(null)
  const lastTextRef = useRef('')
  const lastProcessedTextRef = useRef('')
  const lastRefreshedTextRef = useRef('')
  const lastRefreshHadErrorsRef = useRef(false)
  const lastErrorTimeRef = useRef<Record<string, number>>({})
  const isRibbonRefreshingRef = useRef(false)

  const hasApiKey = !!settings.apiKey
  const [hasKnowledge, setHasKnowledge] = useState(false)
  const [knowledgeVersion, setKnowledgeVersion] = useState(0)
  const [activeBase, setActiveBase] = useState<KnowledgeBase | null>(null)

  // Check knowledge base status periodically and when echoes change
  useEffect(() => {
    const checkKnowledge = async () => {
      try {
        const stats = await getKnowledgeStats()
        setHasKnowledge(stats.fileCount > 0)

        const base = knowledgeBaseService.getActive()
        setActiveBase(base)
      } catch {
        setHasKnowledge(false)
        setActiveBase(null)
      }
    }
    checkKnowledge()

    const handleKnowledgeUpdate = () => {
      setKnowledgeVersion((v) => v + 1)
      checkKnowledge()
    }

    window.addEventListener('knowledge-base-updated', handleKnowledgeUpdate)
    return () => {
      window.removeEventListener('knowledge-base-updated', handleKnowledgeUpdate)
    }
  }, [echoes, knowledgeVersion])

  useEffect(() => {
    setAiStatus(hasApiKey ? 'connected' : 'unconfigured')
  }, [hasApiKey])

  const throttledErrorToast = useCallback((key: string, msg: string) => {
    const now = Date.now()
    if (now - (lastErrorTimeRef.current[key] ?? 0) < ERROR_THROTTLE_MS) return
    lastErrorTimeRef.current[key] = now
    toast.error(msg)
  }, [])

  const handlePause = useCallback(async (text: string) => {
    const requestId = generateId()
    refreshRequestIdRef.current = requestId
    lastTextRef.current = text
    devLog.push('ribbon', 'handlePause invoked', { textLen: text.length })

    const isReliable = !!settings.reliableRibbonMode

    // If a refresh is already in progress:
    // - normal mode: cancel and restart (latest wins)
    // - reliable mode: keep running (so we can actually get output)
    if (isRibbonRefreshingRef.current && !isReliable) {
      devLog.push('ribbon', 'handlePause: refresh in progress, aborting previous and restarting', {})
      try {
        refreshAbortRef.current?.abort()
      } catch {
        // ignore
      }
      // mark not refreshing so the new run can proceed
      isRibbonRefreshingRef.current = false
    } else if (isRibbonRefreshingRef.current && isReliable) {
      devLog.push('ribbon', 'handlePause skipped: refresh in progress (reliable mode)', {})
      return
    }

    // Cancel previous refresh in-flight requests to avoid queue buildup (only when we are actually starting)
    try {
      refreshAbortRef.current?.abort()
    } catch {
      // ignore
    }
    const controller = new AbortController()
    refreshAbortRef.current = controller
    const signal = controller.signal
    debugIngest('H2', 'page.tsx:handlePause', 'refresh start', {
      textLen: text.length,
      baseUrl: settings.baseUrl,
      model: settings.model,
      semanticExpansion: settings.semanticExpansion,
      lowLatencyMode: settings.lowLatencyMode,
      ragRerankEnabled: settings.ragRerankEnabled,
    })
    if (text.trim().length < 2) {
      devLog.push('ribbon', 'handlePause early exit: text too short', {})
      return
    }
    // If last refresh for the same text had errors/timeouts (placeholders), allow retry.
    if (text === lastRefreshedTextRef.current && !lastRefreshHadErrorsRef.current) {
      devLog.push('ribbon', 'handlePause early exit: same as lastRefreshed', {})
      return
    }
    isRibbonRefreshingRef.current = true
    lastProcessedTextRef.current = text
    setIsRibbonRefreshing(true)

    const bid = currentBlockIdRef.current ?? undefined
    const ribbonSettings = settings.ribbonSettings ?? { slotCount: 5, modules: [] }
    const slotCount = Math.min(8, Math.max(5, ribbonSettings.slotCount)) as 5 | 6 | 7 | 8
    const allocationMode = (ribbonSettings.allocationMode ?? 'balanced') as import('@/types').AllocationMode
    const savedModules = ribbonSettings.modules ?? []
    const isCurrentRequest = () => refreshRequestIdRef.current === requestId
    const byId = new Map(savedModules.map((m: RibbonModuleConfig) => [m.id, m]))
    const allModules: RibbonModuleConfig[] = [
      ...BUILTIN_RIBBON_MODULES.map((b) => ({
        ...b,
        enabled: byId.get(b.id)?.enabled ?? (b.id === 'rag' || b.id === 'ai:imagery'),
        pinned: byId.get(b.id)?.pinned ?? false,
      })),
      ...savedModules.filter((m: RibbonModuleConfig) => m.type === 'custom'),
    ]
    const enabledModules = allModules.filter((m: RibbonModuleConfig) => m.enabled)
    // Show loading placeholders immediately for visibility (reliable mode only).
    if (isReliable) {
      setDisplayPlaceholders(createLoadingPlaceholders(enabledModules))
    }

    const shuffle = <T,>(arr: T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]]
      }
      return out
    }

    try {
      const activeBase = knowledgeBaseService.getActive()
      const ragModule = enabledModules.find((m: RibbonModuleConfig) => m.type === 'rag')
      const mandatoryBookIds = activeBase?.mandatoryBooks ?? []
      const mandatoryMaxSlots = Math.min(3, Math.max(1, activeBase?.mandatoryMaxSlots ?? 1)) as MandatoryMaxSlots

      // Parallel: query expansion (API) and chunk load (IndexedDB). Skip expansion in lowLatencyMode.
      const tParallel = Date.now()
      const expandPromise =
        !settings.lowLatencyMode && settings.semanticExpansion && hasApiKey
          ? expandQueryForRAG(text, settings, signal)
          : Promise.resolve(text.trim())
      const chunksPromise =
        ragModule?.enabled && activeBase?.id
          ? getChunksByBase(activeBase.id)
          : Promise.resolve([] as Awaited<ReturnType<typeof getChunksByBase>>)

      const [searchQuery, preloadedChunks] = await Promise.all([
        expandPromise,
        chunksPromise,
      ])

      if (!isCurrentRequest()) return

      devLog.push('ribbon', 'expand + chunks (parallel)', { ms: Date.now() - tParallel })
      devLog.push('ribbon', 'RAG query', {
        queryLen: searchQuery.length,
        semanticExpansion: settings.semanticExpansion,
      })

      const quickModules = enabledModules.filter((m: RibbonModuleConfig) => m.type === 'quick')
      const customModules = enabledModules.filter((m: RibbonModuleConfig) => m.type === 'custom')
      const aiModulesNeedRag = enabledModules.filter(
        (m: RibbonModuleConfig) =>
          (m.type || m.id || '').startsWith('ai:') && m.type !== 'rag' && m.type !== 'quick',
      )
      const batchModules = [...aiModulesNeedRag, ...customModules]
      devLog.push('ribbon', 'module counts', {
        enabledTotal: enabledModules.length,
        aiNeedRag: aiModulesNeedRag.length,
        aiIds: aiModulesNeedRag.map((m) => m.id),
        hasApiKey: !!hasApiKey,
      })
      const quickResultsByModuleId: Record<string, EchoItem[]> = {}

      // Probe chat endpoint once per refresh to avoid wasting time when provider is stalled.
      // In reliable mode, do not skip AI even if probe fails (we want real output for debugging).
      const probe = hasApiKey
        ? await probeChatCompletions({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model }, signal)
        : { ok: false, elapsedMs: 0 }
      // Important: probe may time out due to slowness, not because the provider is fully stalled.
      // If we treat probe timeouts as "stalled" we will incorrectly skip AI/custom modules.
      const isProbeTimeout =
        typeof probe.error === 'string' && probe.error.toLowerCase().includes('timed out')
      const aiProviderStalled = !isReliable && hasApiKey && !probe.ok && !isProbeTimeout
      debugIngest('H6', 'page.tsx:handlePause', 'probe result', { ...probe, aiProviderStalled, isReliable })
      if (hasApiKey && !probe.ok) {
        devLog.push('ribbon', 'probe failed, AI/custom may be skipped', {
          ok: probe.ok,
          elapsedMs: probe.elapsedMs,
          error: probe.error,
          isProbeTimeout,
          aiProviderStalled,
          isReliable,
        })
      }

      // RAG: multi-view + rerank when enabled and not low-latency; else legacy search
      const useRerankPipeline = ragModule?.enabled && activeBase?.id && settings.ragRerankEnabled && !settings.lowLatencyMode && hasApiKey
      const tRagPromiseStart = Date.now()
      const ragPromise: Promise<EchoItem[]> =
        ragModule?.enabled && activeBase?.id
          ? useRerankPipeline
            ? generateCandidatesByViews(
                searchQuery,
                {
                  knowledgeBaseId: activeBase.id,
                  mandatoryBookIds,
                  mandatoryMaxSlots,
                },
                bid,
                preloadedChunks.length > 0 ? preloadedChunks : undefined,
              )
                .then((candidates) => rerankRagCandidates(searchQuery, candidates, settings))
                .then((candidates) =>
                  candidates.map(({ baseScore: _b, finalScore: _f, ...item }) => item as EchoItem)
                )
                .then(async (results) => {
                  if (settings.ribbonAiFilter && hasApiKey && results.length > 0) {
                    return filterRibbonCandidates(text, results, settings, signal)
                  }
                  return results
                })
            : ragService
                .search(
                  searchQuery,
                  {
                    knowledgeBaseId: activeBase.id,
                    mandatoryBookIds,
                    mandatoryMaxSlots,
                  },
                  bid,
                  preloadedChunks.length > 0 ? preloadedChunks : undefined,
                )
                .then(async (results) => {
                  if (settings.ribbonAiFilter && hasApiKey && results.length > 0) {
                    return filterRibbonCandidates(text, results, settings, signal)
                  }
                  return results
                })
          : Promise.resolve([])
      ragPromise.then((r) => {
        debugIngest('H7', 'page.tsx:ragPromise', 'ragPromise resolved', {
          ms: Date.now() - tRagPromiseStart,
          count: r.length,
        })
        return r
      }).catch((e) => {
        debugIngest('H7', 'page.tsx:ragPromise', 'ragPromise rejected', {
          ms: Date.now() - tRagPromiseStart,
          errName: (e as Error)?.name,
          errMsg: (e as Error)?.message,
        })
      })

      // -------------------------
      // Phase A: wait for RAG + Quick, render immediately.
      // -------------------------
      const noRagPromises: Array<Promise<{ mod: RibbonModuleConfig; items: EchoItem[]; error?: string }>> = []
      if (hasApiKey && !aiProviderStalled && quickModules.length > 0) {
        noRagPromises.push(
          ...quickModules.map((mod) =>
            raceWithTimeout(
              isReliable ? RIBBON_MODULE_TIMEOUT_RELIABLE_MS : RIBBON_MODULE_TIMEOUT_MS,
              (async () => {
                try {
                  const result = await generateEchoesForModule(
                    text,
                    [],
                    { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model, ribbonFilterModel: settings.ribbonFilterModel ?? '' },
                    { type: mod.type, id: mod.id, prompt: mod.prompt, model: mod.model },
                    bid,
                    { signal, timeoutMs: isReliable ? RIBBON_MODULE_TIMEOUT_RELIABLE_MS : undefined },
                  )
                  return { mod, items: result.items }
                } catch (err) {
                  return { mod, items: [], error: (err as Error).message }
                }
              })(),
              { mod, items: [], error: '请求超时' },
            ),
          ),
        )
      }

      if (hasApiKey && aiProviderStalled && quickModules.length > 0) {
        noRagPromises.push(
          ...quickModules.map((mod) =>
            Promise.resolve({ mod, items: [], error: 'AI 服务当前不可用（探针失败），已跳过生成' }),
          ),
        )
      }

      if (hasApiKey && (ragModule?.enabled || noRagPromises.length > 0)) {
        setAiStatus('loading')
        devLog.push('ribbon', 'RAG + Quick (phaseA parallel)', {
          rag: !!ragModule?.enabled,
          quickCount: quickModules.length,
          batchCount: batchModules.length,
        })
      }

      const tJoinStart = Date.now()
      debugIngest('H8', 'page.tsx:handlePause', 'await join (rag + quick) start', {
        noRagPromises: noRagPromises.length,
      })
      const [ragResults, ...noRagResultsList] = await Promise.all([ragPromise, ...noRagPromises])
      debugIngest('H8', 'page.tsx:handlePause', 'await join (rag + quick) done', {
        ms: Date.now() - tJoinStart,
        ragCount: ragResults.length,
        quickCount: noRagResultsList.length,
      })

      if (!isCurrentRequest()) return

      const ragResultsOrdered = documentId
        ? adoptionStore.boostOrderByAdoptions(ragResults, documentId)
        : ragResults

      if (ragModule?.enabled && activeBase?.id) {
        devLog.push('ribbon', 'RAG done', { count: ragResultsOrdered.length })
      }
      noRagResultsList.forEach(({ mod, items }) => {
        if (mod.type === 'quick') quickResultsByModuleId[mod.id] = items
      })

      const applyRibbonUpdate = (nextList: EchoItem[]) => {
        const ids = new Set(nextList.map((e) => e.id))
        if (selectedRibbonEchoRef.current && !ids.has(selectedRibbonEchoRef.current.id)) {
          selectedRibbonEchoRef.current = null
          setSelectedRibbonEcho(null)
        }
      }

      const tPhaseA = Date.now()
      const ragFixedCount =
        mandatoryBookIds.length > 0 && ragModule?.enabled
          ? Math.min(mandatoryMaxSlots, mandatoryBookIds.length)
          : 0

      const fixedPoolA: EchoItem[] = ragResultsOrdered.slice(0, ragFixedCount)
      noRagResultsList.forEach(({ mod, items }) => {
        if (mod.pinned && items.length > 0) fixedPoolA.push(items[0])
      })

      const ragNonFixedA = selectDiverseRagForRibbon(
        ragResultsOrdered.slice(ragFixedCount),
        slotCount,
      )

      const moduleResultsA: ModuleResult[] = [
        ...(ragModule?.enabled && ragNonFixedA.length > 0
          ? [{ mod: ragModule, items: ragNonFixedA } as ModuleResult]
          : []),
        ...noRagResultsList.map((r) => ({ mod: r.mod, items: r.items, error: (r as { error?: string }).error })),
      ]

      const { items: allocatedItemsA, placeholders: placeholdersA } = allocateSlots(
        moduleResultsA,
        slotCount,
        allocationMode,
        fixedPoolA,
      )

      const loadingBatchPlaceholders = createLoadingPlaceholders(batchModules)
      setDisplayEchoes(allocatedItemsA)
      setDisplayPlaceholders([...loadingBatchPlaceholders, ...placeholdersA])
      setBatchKey((k) => k + 1)

      devLog.push('ribbon', 'Phase A rendered', {
        ms: Date.now() - tPhaseA,
        echoCount: allocatedItemsA.length,
        batchLoadingCount: loadingBatchPlaceholders.length,
      })

      if (!isCurrentRequest()) return

      // -------------------------
      // Phase B: one-call batch generation for ai:* + custom.
      // -------------------------
      let ragForAi = ragResultsOrdered
      const tRagPre = Date.now()
      try {
        ragForAi = await raceWithTimeout(
          2500,
          summarizeRagChunks(ragResultsOrdered, settings, signal),
          ragResultsOrdered,
        )
      } catch {
        ragForAi = ragResultsOrdered
      }
      devLog.push('ribbon', 'RAG preprocess for batch (shared)', { ms: Date.now() - tRagPre })

      const batchTimeoutMs = isReliable ? RIBBON_MODULE_TIMEOUT_RELIABLE_MS : RIBBON_MODULE_TIMEOUT_MS
      const skipMessage = 'AI 服务当前不可用（探针失败），已跳过生成'

      let batchError: string | undefined
      let batchByModuleId: Record<string, EchoItem[]> = {}

      if (hasApiKey && batchModules.length > 0) {
        if (aiProviderStalled) {
          batchError = skipMessage
          devLog.push('ribbon', 'batch skipped due to aiProviderStalled', { batchCount: batchModules.length })
        } else {
          try {
            devLog.push('ribbon', 'batch generation start', { batchCount: batchModules.length, timeoutMs: batchTimeoutMs })
            const tBatch = Date.now()
            const batchRes = await generateBatchEchoesForModules(
              text,
              ragForAi,
              { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model, ribbonFilterModel: settings.ribbonFilterModel ?? '' },
              batchModules.map((m) => ({ type: m.type, id: m.id, prompt: m.prompt, model: m.model })),
              bid,
              { signal, timeoutMs: batchTimeoutMs },
            )
            batchByModuleId = batchRes.byModuleId
            devLog.push('ribbon', 'batch generation done', {
              ms: Date.now() - tBatch,
              byModule: Object.fromEntries(Object.entries(batchByModuleId).map(([k, v]) => [k, v.length])),
            })
          } catch (err) {
            batchError = (err as Error)?.message ?? 'batch generation failed'
            devLog.push('ribbon', 'batch generation error', { error: batchError })
          }
        }
      }

      const fixedPoolB: EchoItem[] = ragResultsOrdered.slice(0, ragFixedCount)
      noRagResultsList.forEach(({ mod, items }) => {
        if (mod.pinned && items.length > 0) fixedPoolB.push(items[0])
      })
      for (const mod of batchModules) {
        const items = batchByModuleId[mod.id] ?? []
        if (mod.pinned && items.length > 0) fixedPoolB.push(items[0])
      }

      const ragNonFixedB = selectDiverseRagForRibbon(
        ragResultsOrdered.slice(ragFixedCount),
        slotCount,
      )
      const moduleResultsB: ModuleResult[] = [
        ...(ragModule?.enabled && ragNonFixedB.length > 0
          ? [{ mod: ragModule, items: ragNonFixedB } as ModuleResult]
          : []),
        ...noRagResultsList.map((r) => ({ mod: r.mod, items: r.items, error: (r as { error?: string }).error })),
        ...batchModules.map((mod) => ({
          mod,
          items: batchByModuleId[mod.id] ?? [],
          error: batchError,
        })),
      ]

      if (!isCurrentRequest()) return

      const { items: final, placeholders } = allocateSlots(
        moduleResultsB,
        slotCount,
        allocationMode,
        fixedPoolB,
      )

      devLog.push('ribbon', 'allocation (phaseB)', {
        mode: allocationMode,
        fixedCount: fixedPoolB.length,
        allocatedCount: final.length,
        placeholderCount: placeholders.length,
      })

      if (final.length > 0 && documentId) {
        devLog.push('ribbon', 'setDisplayEchoes (final)', {
          count: final.length,
          batchKey: batchKey + 1,
        })
        setEchoes((prev) => flowHistory.append(documentId, final, prev))
        setDisplayEchoes(final)
        setDisplayPlaceholders(placeholders)
        setBatchKey((k) => k + 1)
        lastRefreshedTextRef.current = text
        lastRefreshHadErrorsRef.current =
          placeholders.length > 0 || moduleResultsB.some((r) => !!(r as { error?: string }).error)
        applyRibbonUpdate(final)
      } else if (ragResultsOrdered.length > 0 && documentId) {
        const fallback = ragResultsOrdered.slice(0, slotCount)
        devLog.push('ribbon', 'setDisplayEchoes (fallback RAG)', {
          count: fallback.length,
          batchKey: batchKey + 1,
        })
        setEchoes((prev) => flowHistory.append(documentId, fallback, prev))
        setDisplayEchoes(fallback)
        setDisplayPlaceholders([])
        setBatchKey((k) => k + 1)
        lastRefreshedTextRef.current = text
        lastRefreshHadErrorsRef.current = true
        applyRibbonUpdate(fallback)
      }
    } catch (err) {
      if (hasApiKey) setAiStatus('error')
      setDisplayPlaceholders([])
      const msg = (err as Error).message
      if (msg === 'API_KEY_INVALID') {
        throttledErrorToast('auth', 'API Key 无效或已过期，请在设置中更新')
      } else if (msg === 'RATE_LIMITED') {
        throttledErrorToast('rate', 'AI 请求频率超限，稍后再试')
      } else if (msg === 'INSUFFICIENT_BALANCE') {
        throttledErrorToast('balance', 'API 余额不足')
      } else if (msg === 'NETWORK_TIMEOUT') {
        throttledErrorToast('timeout', '连接超时，请检查网络或 Base URL')
      } else if (msg === 'NETWORK_ERROR' || msg.startsWith('NETWORK_ERROR:')) {
        throttledErrorToast('network', '无法连接 API，请检查 Base URL 或网络')
      } else if (msg === 'API_BAD_REQUEST') {
        throttledErrorToast('badreq', '请求参数有误，请检查设置中的模型名称')
      } else if (msg === 'API_NOT_FOUND') {
        throttledErrorToast('notfound', '接口或模型不存在，请检查 Base URL 和模型名')
      } else if (msg === 'API_SERVER_ERROR') {
        throttledErrorToast('server', 'AI 服务暂时不可用，请稍后再试')
      } else if (msg.startsWith('API_ERROR_')) {
        throttledErrorToast('apierr', '接口返回错误，请检查 Base URL 与模型名')
      } else {
        throttledErrorToast('generic', msg.length > 60 ? 'AI 灵感生成失败，请检查设置中的 Base URL 与模型名' : msg)
      }
    } finally {
      isRibbonRefreshingRef.current = false
      setIsRibbonRefreshing(false)
    }
  }, [documentId, hasApiKey, settings, throttledErrorToast])

  const handlePlaceholderRetry = useCallback(() => {
    handlePause(lastTextRef.current)
  }, [handlePause])

  const pauseMs = Math.min(10, Math.max(1, settings.ribbonPauseSeconds ?? 2)) * 1000
  const { beat } = useHeartbeat({
    pauseThreshold: pauseMs,
    onPause: handlePause,
  })

  const handleEditorUpdate = useCallback(
    (text: string, blockId: string | null) => {
      const prevText = lastTextRef.current
      lastTextRef.current = text
      currentBlockIdRef.current = blockId
      setCurrentBlockId(blockId)
      // Only start pause timer when the content actually changes.
      // Selection/cursor moves trigger editor updates too; those should not refresh the ribbon.
      if (text !== prevText && text.trim().length >= 2) {
        beat(text)
      }
    },
    [beat],
  )

  const saveDocument = useCallback(() => {
    if (!documentId) return
    const now = new Date().toISOString()
    const existing = documentStorage.get(documentId)
    documentStorage.save({
      id: documentId,
      title: title || '无题',
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    documentStorage.setLastDocumentId(documentId)
  }, [documentId, title, content])

  const handleManualSave = useCallback(() => {
    saveDocument()
    toast.success('已保存')
  }, [saveDocument])

  const handleSensoryZoom = useCallback(async () => {
    if (!settings.sensoryZoomEnabled) return
    // Toggle off if panel is already open
    if (sensoryZoomResults && sensoryZoomResults.length > 0) {
      setSensoryZoomResults(null)
      return
    }
    const baseText =
      selectionText.trim() ||
      paragraphTextRef.current.trim() ||
      lastTextRef.current.trim()
    if (!baseText) return
    const base = knowledgeBaseService.getActive()
    if (!base?.id) {
      toast.error('请先选择共鸣库')
      return
    }
    setSensoryZoomLoading(true)
    setSensoryZoomResults(null)
    try {
      const items = await expandSensoryZoom(baseText, content, base.id, settings)
      setSensoryZoomResults(items)
    } catch {
      toast.error('感官放大失败')
    } finally {
      setSensoryZoomLoading(false)
    }
  }, [selectionText, content, settings])

  const paragraphTextRef = useRef('')
  const clicheEnabledRef = useRef(settings.clicheDetectionEnabled)
  useEffect(() => {
    clicheEnabledRef.current = settings.clicheDetectionEnabled
  }, [settings.clicheDetectionEnabled])

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

  const handleParagraphChangeFromEditor = useCallback(
    (paragraphText: string) => {
      paragraphTextRef.current = paragraphText
      runClicheDetection()
    },
    [runClicheDetection],
  )

  const handleClicheAlternatives = useCallback(async () => {
    const base = knowledgeBaseService.getActive()
    if (!base?.id) {
      toast.error('请先选择共鸣库')
      return
    }
    const query = (paragraphForCliche.trim().slice(0, 200) || clicheMatches[0]?.phrase) ?? ''
    if (!query) return
    setShowClichePopover(true)
    setClicheAlternativesLoading(true)
    setClicheAlternatives([])
    try {
      const candidates = await generateCandidatesByViews(query, { knowledgeBaseId: base.id })
      const items = candidates
        .slice(0, 5)
        .map(({ baseScore: _b, finalScore: _f, ...item }) => item as EchoItem)
      setClicheAlternatives(items)
    } catch {
      toast.error('获取替代表达失败')
    } finally {
      setClicheAlternativesLoading(false)
    }
  }, [paragraphForCliche, clicheMatches])

  const saveDocumentRef = useRef(saveDocument)
  saveDocumentRef.current = saveDocument
  const debouncedSave = useRef(
    debounce(() => saveDocumentRef.current(), AUTO_SAVE_MS),
  ).current

  useEffect(() => {
    if (!documentId) return
    debouncedSave()
  }, [documentId, title, content, debouncedSave])

  // Load saved display echoes on mount (preserves RAG results when returning from settings)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DISPLAY_ECHOES_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDisplayEchoes(parsed)
        }
      }
      const savedBatch = localStorage.getItem(DISPLAY_BATCH_KEY)
      if (savedBatch) {
        setBatchKey(parseInt(savedBatch, 10) || 0)
      }
    } catch {
      // ignore
    }
  }, [])

  // Save display echoes whenever they change
  useEffect(() => {
    try {
      if (displayEchoes.length > 0) {
        localStorage.setItem(DISPLAY_ECHOES_KEY, JSON.stringify(displayEchoes))
        localStorage.setItem(DISPLAY_BATCH_KEY, String(batchKey))
      }
    } catch {
      // ignore
    }
  }, [displayEchoes, batchKey])

  // Track if we've already initialized to prevent re-triggering on route changes
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    // Prevent re-initialization when returning from settings page
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true

    const lastId = documentStorage.getLastDocumentId()
    const id = lastId || generateId()
    const doc = documentStorage.get(id)
    if (doc) {
      const loaded = flowHistory.load(doc.id)
      setDocumentId(doc.id)
      setTitle(doc.title)
      setContent(doc.content || '')
      setEchoes(loaded)
      lastTextRef.current = doc.content || ''
      lastProcessedTextRef.current = doc.content || ''
      lastRefreshedTextRef.current = doc.content || ''
    } else {
      setDocumentId(id)
      setTitle('无题')
      setContent('')
      const created: Document = {
        id,
        title: '无题',
        content: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      documentStorage.save(created)
      documentStorage.setLastDocumentId(id)
      setEchoes([])
    }
  }, [])

  const handleContentChange = useCallback((html: string) => {
    setContent(html)
  }, [])

  const handleInspire = useCallback(() => {
    handlePause(lastTextRef.current)
  }, [handlePause])

  const handleOpenDocument = useCallback(
    (id: string) => {
      saveDocumentRef.current()
      const doc = documentStorage.get(id)
      if (!doc) return

      documentStorage.setLastDocumentId(id)
      const loadedEchoes = flowHistory.load(doc.id)
      setDocumentId(doc.id)
      setTitle(doc.title || '无题')
      setContent(doc.content || '')
      setEchoes(loadedEchoes)
      setDisplayEchoes(loadedEchoes.slice(0, 5))
      setBatchKey((k) => k + 1)
      lastTextRef.current = doc.content || ''
      lastProcessedTextRef.current = doc.content || ''
      lastRefreshedTextRef.current = doc.content || ''
    },
    [],
  )

  const handleNewDocument = useCallback(() => {
    saveDocumentRef.current()
    const id = generateId()
    const newDoc: Document = {
      id,
      title: '无题',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    documentStorage.save(newDoc)
    documentStorage.setLastDocumentId(id)
    setDocumentId(id)
    setTitle('无题')
    setContent('')
    setEchoes([])
    lastTextRef.current = ''
    lastProcessedTextRef.current = ''
    lastRefreshedTextRef.current = ''
    setDisplayEchoes([])
    setDisplayPlaceholders([])
    setBatchKey(0)
  }, [])

  if (documentId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)]">
        <p className="text-[var(--color-ink-faint)]">加载中...</p>
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
        <div className="flex-shrink-0 h-[14rem] min-h-[14rem] border-b border-[var(--color-border)] bg-[var(--color-paper)] overflow-hidden">
          <AmbientRibbon
            echoes={content.trim().length === 0 ? [] : displayEchoes}
            placeholders={displayPlaceholders}
            batchKey={batchKey}
            slotCount={(Math.min(8, Math.max(5, settings.ribbonSettings?.slotCount ?? 5)) as 5 | 6 | 7 | 8)}
            currentBlockId={currentBlockId}
            hasApiKey={hasApiKey}
            hasKnowledge={hasKnowledge}
            isGenerating={isRibbonRefreshing}
            selectedEchoId={selectedRibbonEcho?.id ?? null}
            onRibbonSelect={(item) => {
              selectedRibbonEchoRef.current = item
              setSelectedRibbonEcho(item)
            }}
            onEchoCopied={
              documentId
                ? (item) => adoptionStore.recordAdoption(documentId, item)
                : undefined
            }
            onPlaceholderRetry={handlePlaceholderRetry}
          />
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col items-center pt-8 pb-32 px-6">
            <div className="w-full max-w-2xl mb-12">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="无题"
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
                  {sensoryZoomLoading ? '涌现中…' : '感官放大 Alt+Z'}
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
                  套路语 · 点击获取替代表达
                </button>
              </div>
            )}
            <EchoEditor
              key={documentId}
              initialContent={content}
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
                <span className="text-xs font-medium text-[var(--color-ink-faint)]">感官放大 · 点击复制</span>
                <button
                  type="button"
                  onClick={() => setSensoryZoomResults(null)}
                  className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] p-1"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
              <ul className="space-y-1.5">
                {sensoryZoomResults.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-[var(--color-paper)] text-[var(--color-ink)]"
                      onClick={() => {
                        const t = item.originalText ?? item.content ?? ''
                        navigator.clipboard.writeText(t).then(() => toast.success('已复制'), () => {})
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
                <span className="text-xs font-medium text-[var(--color-ink-faint)]">非套路化替代表达 · 点击复制</span>
                <button
                  type="button"
                  onClick={() => setShowClichePopover(false)}
                  className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] p-1"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
              {clicheAlternativesLoading ? (
                <p className="text-sm text-[var(--color-ink-faint)]">加载中…</p>
              ) : clicheAlternatives.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-faint)]">未找到相关替代</p>
              ) : (
                <ul className="space-y-1.5">
                  {clicheAlternatives.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-[var(--color-paper)] text-[var(--color-ink)]"
                        onClick={() => {
                          const t = item.originalText ?? item.content ?? ''
                          navigator.clipboard.writeText(t).then(() => toast.success('已复制'), () => {})
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
        onClose={() => {
          selectedRibbonEchoRef.current = null
          setSelectedRibbonEcho(null)
        }}
      />
    </div>
  )
}
