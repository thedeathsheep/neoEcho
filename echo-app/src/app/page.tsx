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
import { useSettings } from '@/lib/settings-context'
import { debounce } from '@/lib/utils/time'
import { generateId } from '@/lib/utils/crypto'
import { useHeartbeat } from '@/hooks/use-heartbeat'
import { ragService, type MandatoryMaxSlots } from '@/services/rag.service'
import {
  generateEchoes,
  generateEchoesForModule,
  expandQueryForRAG,
  filterRibbonCandidates,
} from '@/services/client-ai.service'
import {
  knowledgeBaseService,
  getKnowledgeStats,
  getChunksByBase,
  type KnowledgeBase,
} from '@/services/knowledge-base.service'
import type { Document, EchoItem, RibbonModuleConfig } from '@/types'

const AUTO_SAVE_MS = 2000
const ERROR_THROTTLE_MS = 60_000
const DISPLAY_ECHOES_KEY = 'echo-display-echoes'
const DISPLAY_BATCH_KEY = 'echo-display-batch'

export type AiStatus = 'idle' | 'unconfigured' | 'loading' | 'connected' | 'error'

export default function Home() {
  const { settings } = useSettings()
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [echoes, setEchoes] = useState<EchoItem[]>([])
  const [displayEchoes, setDisplayEchoes] = useState<EchoItem[]>([])
  const [batchKey, setBatchKey] = useState(0)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle')
  const [isRibbonRefreshing, setIsRibbonRefreshing] = useState(false)
  const [selectedRibbonEcho, setSelectedRibbonEcho] = useState<EchoItem | null>(null)
  const selectedRibbonEchoRef = useRef<EchoItem | null>(null)

  useEffect(() => {
    selectedRibbonEchoRef.current = selectedRibbonEcho
  }, [selectedRibbonEcho])

  const currentBlockIdRef = useRef<string | null>(null)
  const lastTextRef = useRef('')
  const lastProcessedTextRef = useRef('')
  const lastRefreshedTextRef = useRef('')
  const lastErrorTimeRef = useRef<Record<string, number>>({})

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
    lastTextRef.current = text
    devLog.push('ribbon', 'handlePause invoked', { textLen: text.length })

    if (selectedRibbonEchoRef.current !== null) {
      devLog.push('ribbon', 'handlePause skipped: detail panel open (ribbon frozen)', {})
      return
    }
    if (text.trim().length < 2) {
      devLog.push('ribbon', 'handlePause early exit: text too short', {})
      return
    }
    if (text === lastRefreshedTextRef.current) {
      devLog.push('ribbon', 'handlePause early exit: same as lastRefreshed', {})
      return
    }
    lastProcessedTextRef.current = text
    setIsRibbonRefreshing(true)

    const bid = currentBlockIdRef.current ?? undefined
    const ribbonSettings = settings.ribbonSettings ?? { slotCount: 5, modules: [] }
    const slotCount = Math.min(8, Math.max(5, ribbonSettings.slotCount)) as 5 | 6 | 7 | 8
    const enabledModules = (ribbonSettings.modules ?? []).filter((m: RibbonModuleConfig) => m.enabled)

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

      // Parallel: query expansion (API) and chunk load (IndexedDB) so total wait ≈ max(expand, load)
      const tParallel = Date.now()
      const expandPromise =
        settings.semanticExpansion && hasApiKey
          ? expandQueryForRAG(text, settings)
          : Promise.resolve(text.trim())
      const chunksPromise =
        ragModule?.enabled && activeBase?.id
          ? getChunksByBase(activeBase.id)
          : Promise.resolve([] as Awaited<ReturnType<typeof getChunksByBase>>)

      const [searchQuery, preloadedChunks] = await Promise.all([
        expandPromise,
        chunksPromise,
      ])

      devLog.push('ribbon', 'expand + chunks (parallel)', { ms: Date.now() - tParallel })
      devLog.push('ribbon', 'RAG query', {
        queryLen: searchQuery.length,
        semanticExpansion: settings.semanticExpansion,
      })

      let ragResults: EchoItem[] = []
      if (ragModule?.enabled && activeBase?.id) {
        ragResults = await ragService.search(
          searchQuery,
          {
            knowledgeBaseId: activeBase.id,
            mandatoryBookIds,
            mandatoryMaxSlots,
          },
          bid,
          preloadedChunks.length > 0 ? preloadedChunks : undefined,
        )
        if (settings.ribbonAiFilter && hasApiKey && ragResults.length > 0) {
          ragResults = await filterRibbonCandidates(text, ragResults, settings)
        }
        devLog.push('ribbon', 'RAG done', { count: ragResults.length })
      }

      const ragFixedCount =
        mandatoryBookIds.length > 0 && ragModule?.enabled
          ? Math.min(mandatoryMaxSlots, mandatoryBookIds.length)
          : 0
      const fixedPool: EchoItem[] = ragResults.slice(0, ragFixedCount)

      const aiModules = enabledModules.filter((m: RibbonModuleConfig) => m.type !== 'rag' && (m.type.startsWith('ai:') || m.type === 'custom'))
      const aiResultsByModuleId: Record<string, EchoItem[]> = {}

      if (hasApiKey && aiModules.length > 0) {
        setAiStatus('loading')
        devLog.push('ribbon', 'AI modules start', { count: aiModules.length })
        // Parallel: one key can handle concurrent requests; run all AI modules at once
        const aiPromises = aiModules.map(async (mod) => {
          try {
            const items = await generateEchoesForModule(
              text,
              ragResults,
              { apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model },
              { type: mod.type, id: mod.id },
              bid,
            )
            return { mod, items }
          } catch {
            return { mod, items: [] as EchoItem[] }
          }
        })
        const aiResultsList = await Promise.all(aiPromises)
        aiResultsList.forEach(({ mod, items }) => {
          aiResultsByModuleId[mod.id] = items
          if (mod.pinned && items.length > 0) {
            fixedPool.push(items[0])
          }
        })
        setAiStatus('connected')
        devLog.push('ribbon', 'AI modules done', {
          byModule: Object.fromEntries(
            Object.entries(aiResultsByModuleId).map(([k, v]) => [k, v.length]),
          ),
        })
      }

      const allResults: EchoItem[] = [...ragResults, ...Object.values(aiResultsByModuleId).flat()]
      const fixedIds = new Set(fixedPool.map((x) => x.id))
      const randomPool = allResults.filter((x) => !fixedIds.has(x.id))
      const shuffled = shuffle(randomPool)
      const final = [...fixedPool, ...shuffled.slice(0, slotCount - fixedPool.length)].slice(0, slotCount)

      const applyRibbonUpdate = (nextList: EchoItem[]) => {
        const ids = new Set(nextList.map((e) => e.id))
        if (selectedRibbonEchoRef.current && !ids.has(selectedRibbonEchoRef.current.id)) {
          selectedRibbonEchoRef.current = null
          setSelectedRibbonEcho(null)
        }
      }

      if (final.length > 0 && documentId) {
        devLog.push('ribbon', 'setDisplayEchoes (final)', {
          count: final.length,
          batchKey: batchKey + 1,
        })
        setEchoes((prev) => flowHistory.append(documentId, final, prev))
        setDisplayEchoes(final)
        setBatchKey((k) => k + 1)
        lastRefreshedTextRef.current = text
        applyRibbonUpdate(final)
      } else if (ragResults.length > 0 && documentId) {
        const fallback = ragResults.slice(0, slotCount)
        devLog.push('ribbon', 'setDisplayEchoes (fallback RAG)', {
          count: fallback.length,
          batchKey: batchKey + 1,
        })
        setEchoes((prev) => flowHistory.append(documentId, fallback, prev))
        setDisplayEchoes(fallback)
        setBatchKey((k) => k + 1)
        lastRefreshedTextRef.current = text
        applyRibbonUpdate(fallback)
      }
    } catch (err) {
      if (hasApiKey) setAiStatus('error')
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
      setIsRibbonRefreshing(false)
    }
  }, [documentId, hasApiKey, settings, throttledErrorToast])

  const pauseMs = Math.min(10, Math.max(1, settings.ribbonPauseSeconds ?? 2)) * 1000
  const { beat } = useHeartbeat({
    pauseThreshold: pauseMs,
    onPause: handlePause,
  })

  const handleEditorUpdate = useCallback(
    (text: string, blockId: string | null) => {
      lastTextRef.current = text
      currentBlockIdRef.current = blockId
      setCurrentBlockId(blockId)
      beat(text)
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
    <div className="min-h-screen relative bg-[var(--color-paper)]">
      <DocumentPanel
        currentDocumentId={documentId}
        onOpenDocument={handleOpenDocument}
        onNewDocument={handleNewDocument}
      />
      <div className="fixed top-6 right-8 flex flex-col gap-4 z-[60]">
        <KnowledgePanel aiStatus={aiStatus} />
        <DevPanel />
      </div>

      <AmbientRibbon
        echoes={content.trim().length === 0 ? [] : displayEchoes}
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
      />

      <RibbonDetailPanel
        item={selectedRibbonEcho}
        onClose={() => {
          selectedRibbonEchoRef.current = null
          setSelectedRibbonEcho(null)
        }}
      />

      <main className="relative z-40 flex flex-col items-center pt-80 pb-32">
        <div className="w-full max-w-3xl px-8 mb-12">
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

        <EchoEditor
          key={documentId}
          initialContent={content}
          onUpdate={handleEditorUpdate}
          onContentChange={handleContentChange}
          onSave={handleManualSave}
          onInspire={handleInspire}
        />
      </main>
    </div>
  )
}
