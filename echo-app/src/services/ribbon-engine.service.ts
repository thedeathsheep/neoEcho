'use client'

import { generateId } from '@/lib/utils/crypto'
import { now } from '@/lib/utils/time'
import type {
  EchoItem,
  RibbonContextSnapshot,
  RibbonEchoCandidate,
  RibbonEchoOrigin,
  RibbonEngineState,
  RibbonJob,
  RibbonJobStatus,
  RibbonJobType,
  RibbonRenderEntry,
  RibbonSlotCount,
} from '@/types'

const MAX_POOL_SIZE = 120
const MAX_RENDER_HISTORY = 48

function moduleKeyForItem(item: EchoItem): string {
  const moduleId = (item.moduleId ?? '').trim()
  if (moduleId) return moduleId
  const source = (item.source ?? 'Echo').trim() || 'Echo'
  return `legacy:${source}`
}

function candidateKeyFor(item: EchoItem, origin: RibbonEchoOrigin): string {
  const text = (item.ribbonText ?? item.originalText ?? item.content ?? '').trim().toLowerCase()
  return `${origin}:${moduleKeyForItem(item)}:${text.slice(0, 120)}`
}

function scoreNovelty(existing: RibbonEchoCandidate[], item: EchoItem): number {
  const text = (item.originalText ?? item.content ?? '').trim().toLowerCase()
  const seen = existing.some((candidate) => {
    const other = (candidate.item.originalText ?? candidate.item.content ?? '').trim().toLowerCase()
    return other.includes(text.slice(0, 40)) || text.includes(other.slice(0, 40))
  })
  return seen ? 0.3 : 1
}

function toRenderEntries(items: RibbonEchoCandidate[]): RibbonRenderEntry[] {
  return items.map((candidate) => ({
    candidateKey: candidate.key,
    item: candidate.item,
    enteredAt: now(),
  }))
}

function orderSelectedForStableSlots(
  selected: RibbonEchoCandidate[],
  previousQueue: RibbonRenderEntry[],
): RibbonEchoCandidate[] {
  if (selected.length === 0 || previousQueue.length === 0) return selected

  const remainingByKey = new Map(selected.map((candidate) => [candidate.key, candidate]))
  const remainingByModule = new Map<string, RibbonEchoCandidate[]>()

  for (const candidate of selected) {
    const moduleKey = moduleKeyForItem(candidate.item)
    const bucket = remainingByModule.get(moduleKey) ?? []
    bucket.push(candidate)
    remainingByModule.set(moduleKey, bucket)
  }

  const ordered: RibbonEchoCandidate[] = []

  const takeCandidate = (candidate: RibbonEchoCandidate | undefined) => {
    if (!candidate) return
    if (!remainingByKey.has(candidate.key)) return
    remainingByKey.delete(candidate.key)
    const moduleKey = moduleKeyForItem(candidate.item)
    const bucket = remainingByModule.get(moduleKey)
    if (bucket) {
      const nextBucket = bucket.filter((entry) => entry.key !== candidate.key)
      if (nextBucket.length > 0) remainingByModule.set(moduleKey, nextBucket)
      else remainingByModule.delete(moduleKey)
    }
    ordered.push(candidate)
  }

  for (const entry of previousQueue) {
    const sameCandidate = remainingByKey.get(entry.candidateKey)
    if (sameCandidate) {
      takeCandidate(sameCandidate)
      continue
    }

    const previousModuleKey = moduleKeyForItem(entry.item)
    const sameModuleCandidate = remainingByModule.get(previousModuleKey)?.[0]
    if (sameModuleCandidate) takeCandidate(sameModuleCandidate)
  }

  for (const candidate of selected) {
    takeCandidate(candidate)
  }

  return ordered
}

function selectPinnedCandidates(
  candidates: RibbonEchoCandidate[],
  pinnedModuleIds: string[],
  slotCount: number,
): RibbonEchoCandidate[] {
  if (pinnedModuleIds.length === 0 || slotCount <= 0) return []

  const chosen: RibbonEchoCandidate[] = []
  const chosenKeys = new Set<string>()
  const chosenModules = new Set<string>()

  for (const moduleId of pinnedModuleIds) {
    if (chosen.length >= slotCount) break
    const candidate = candidates.find((entry) => {
      if (chosenKeys.has(entry.key)) return false
      const candidateModuleId = entry.item.moduleId ?? ''
      if (candidateModuleId !== moduleId) return false
      return !chosenModules.has(candidateModuleId)
    })
    if (!candidate) continue
    chosen.push(candidate)
    chosenKeys.add(candidate.key)
    chosenModules.add(candidate.item.moduleId ?? '')
  }

  return chosen
}

function takePinnedFallbackCandidates(
  candidates: RibbonEchoCandidate[],
  pinnedModuleIds: string[],
  alreadySelected: RibbonEchoCandidate[],
  slotCount: number,
): RibbonEchoCandidate[] {
  if (pinnedModuleIds.length === 0 || slotCount <= 0) return []

  const selectedKeys = new Set(alreadySelected.map((candidate) => candidate.key))
  const selectedModules = new Set(alreadySelected.map((candidate) => candidate.item.moduleId ?? ''))
  const fallback: RibbonEchoCandidate[] = []

  for (const moduleId of pinnedModuleIds) {
    if (alreadySelected.length + fallback.length >= slotCount) break
    if (selectedModules.has(moduleId)) continue
    const candidate = candidates.find((entry) => {
      if (selectedKeys.has(entry.key)) return false
      return (entry.item.moduleId ?? '') === moduleId
    })
    if (!candidate) continue
    fallback.push(candidate)
    selectedKeys.add(candidate.key)
    selectedModules.add(moduleId)
  }

  return fallback
}

function countMissingPinnedModules(
  candidates: RibbonEchoCandidate[],
  pinnedModuleIds: string[],
): number {
  if (pinnedModuleIds.length === 0) return 0
  const availableModules = new Set(
    candidates
      .map((candidate) => candidate.item.moduleId ?? '')
      .filter((moduleId) => moduleId.length > 0),
  )
  return pinnedModuleIds.filter((moduleId) => !availableModules.has(moduleId)).length
}

function selectBaselineModuleCandidates(
  candidates: RibbonEchoCandidate[],
  slotCount: number,
  initialSelected: RibbonEchoCandidate[] = [],
): RibbonEchoCandidate[] {
  const chosen: RibbonEchoCandidate[] = [...initialSelected]
  const chosenKeys = new Set(chosen.map((candidate) => candidate.key))
  const seenModules = new Set(chosen.map((candidate) => moduleKeyForItem(candidate.item)))

  if (chosen.length >= slotCount) return chosen.slice(0, slotCount)

  for (const candidate of candidates) {
    if (chosen.length >= slotCount) break
    if (chosenKeys.has(candidate.key)) continue
    const moduleKey = moduleKeyForItem(candidate.item)
    if (seenModules.has(moduleKey)) continue
    chosen.push(candidate)
    chosenKeys.add(candidate.key)
    seenModules.add(moduleKey)
  }

  return chosen
}

function fillRemainingCandidates(
  candidates: RibbonEchoCandidate[],
  slotCount: number,
  initialSelected: RibbonEchoCandidate[] = [],
): RibbonEchoCandidate[] {
  const chosen: RibbonEchoCandidate[] = [...initialSelected]
  const chosenKeys = new Set(chosen.map((candidate) => candidate.key))
  const distinctModuleCount = new Set(candidates.map((candidate) => moduleKeyForItem(candidate.item))).size
  const allowExpandedPerModule = distinctModuleCount > 0 && distinctModuleCount * 2 < slotCount
  const maxPerModule = allowExpandedPerModule
    ? Math.max(2, Math.ceil(slotCount / Math.max(1, distinctModuleCount)))
    : 2

  for (const candidate of candidates) {
    if (chosen.length >= slotCount) break
    if (chosenKeys.has(candidate.key)) continue
    const moduleKey = moduleKeyForItem(candidate.item)
    const moduleCount = chosen.filter((entry) => moduleKeyForItem(entry.item) === moduleKey).length
    if (moduleCount >= maxPerModule) continue
    const lastTwo = chosen.slice(-2).map((item) => moduleKeyForItem(item.item))
    if (lastTwo.length === 2 && lastTwo[0] === moduleKey && lastTwo[1] === moduleKey) continue
    chosen.push(candidate)
    chosenKeys.add(candidate.key)
  }

  return chosen
}

function boostVisibleStability(
  candidates: RibbonEchoCandidate[],
  previousQueue: RibbonRenderEntry[],
  currentSnapshotId?: string | null,
): RibbonEchoCandidate[] {
  if (previousQueue.length === 0) return candidates

  const order = new Map(previousQueue.map((entry, index) => [entry.candidateKey, index]))

  return [...candidates].sort((a, b) => {
    const aCurrent = currentSnapshotId != null && a.snapshotId === currentSnapshotId
    const bCurrent = currentSnapshotId != null && b.snapshotId === currentSnapshotId

    if (aCurrent && !bCurrent) return -1
    if (!aCurrent && bCurrent) return 1

    const aPrev = order.get(a.key)
    const bPrev = order.get(b.key)
    const aVisible = aPrev != null
    const bVisible = bPrev != null

    if (aVisible && !bVisible) return -1
    if (!aVisible && bVisible) return 1
    if (aVisible && bVisible) return aPrev - bPrev

    const aScore = a.relevanceScore * 0.65 + a.noveltyScore * 0.35
    const bScore = b.relevanceScore * 0.65 + b.noveltyScore * 0.35
    const gap = Math.abs(bScore - aScore)
    if (gap < 0.06) {
      const aDisplayed = a.displayedAt ? Date.parse(a.displayedAt) : 0
      const bDisplayed = b.displayedAt ? Date.parse(b.displayedAt) : 0
      if (aDisplayed !== bDisplayed) return aDisplayed - bDisplayed
      return a.createdAt < b.createdAt ? -1 : 1
    }
    return bScore - aScore
  })
}

function sortPoolForDisplay(state: RibbonEngineState): RibbonEchoCandidate[] {
  const currentSnapshotId = state.currentSnapshot?.id ?? null
  const sortedPool = [...state.pool].sort((a, b) => {
    const aCurrentBoost = currentSnapshotId != null && a.snapshotId === currentSnapshotId ? 0.25 : 0
    const bCurrentBoost = currentSnapshotId != null && b.snapshotId === currentSnapshotId ? 0.25 : 0
    const aScore = a.relevanceScore * 0.65 + a.noveltyScore * 0.35 + (a.isDisplayed ? 0.1 : 0) + aCurrentBoost
    const bScore = b.relevanceScore * 0.65 + b.noveltyScore * 0.35 + (b.isDisplayed ? 0.1 : 0) + bCurrentBoost
    return bScore - aScore
  })

  return boostVisibleStability(sortedPool, state.renderQueue, currentSnapshotId)
}

function selectVisibleCandidates(
  state: RibbonEngineState,
  slotCount: number,
  include?: (item: EchoItem) => boolean,
): RibbonEchoCandidate[] {
  if (slotCount <= 0) return []
  const poolByKey = new Map(state.pool.map((candidate) => [candidate.key, candidate]))
  return state.renderQueue
    .map((entry) => poolByKey.get(entry.candidateKey))
    .filter((candidate): candidate is RibbonEchoCandidate => candidate != null)
    .filter((candidate) => (include ? include(candidate.item) : true))
    .slice(0, slotCount)
}

function recomputeRenderQueue(state: RibbonEngineState, slotCount: RibbonSlotCount): RibbonEngineState {
  const currentSnapshotId = state.currentSnapshot?.id ?? null
  const stabilizedPool = sortPoolForDisplay(state)
  const missingPinnedCount = countMissingPinnedModules(stabilizedPool, state.pinnedModuleIds)
  const effectiveSlotCount = Math.max(0, slotCount - missingPinnedCount)
  const currentSnapshotCandidates =
    currentSnapshotId == null
      ? []
      : stabilizedPool.filter((candidate) => candidate.snapshotId === currentSnapshotId)
  const currentPinnedSelected = selectPinnedCandidates(currentSnapshotCandidates, state.pinnedModuleIds, slotCount)
  const currentTargetCount = Math.min(effectiveSlotCount, currentSnapshotCandidates.length)
  const currentBaselineSelected = selectBaselineModuleCandidates(
    currentSnapshotCandidates,
    currentTargetCount,
    currentPinnedSelected,
  )
  const currentSelected = orderSelectedForStableSlots(
    fillRemainingCandidates(currentSnapshotCandidates, currentTargetCount, currentBaselineSelected),
    state.renderQueue,
  )

  if (currentSnapshotId != null) {
    const pinnedFallback = takePinnedFallbackCandidates(stabilizedPool, state.pinnedModuleIds, currentSelected, slotCount)
    const selected = [...currentSelected, ...pinnedFallback].slice(0, effectiveSlotCount)
    const selectedKeys = new Set(selected.map((candidate) => candidate.key))
    const pool = state.pool.map((candidate) =>
      selectedKeys.has(candidate.key)
        ? { ...candidate, isDisplayed: true, displayedAt: candidate.displayedAt ?? now() }
        : candidate,
    )

    return {
      ...state,
      pool,
      renderQueue: toRenderEntries(selected),
    }
  }

  const targetCount = Math.min(effectiveSlotCount, stabilizedPool.length)
  const pinnedSelected = selectPinnedCandidates(stabilizedPool, state.pinnedModuleIds, slotCount)
  const baselineSelected = selectBaselineModuleCandidates(stabilizedPool, targetCount, pinnedSelected)
  const fallbackSelected = orderSelectedForStableSlots(
    fillRemainingCandidates(stabilizedPool, targetCount, baselineSelected),
    state.renderQueue,
  )
  const selected = [...currentSelected]
  const selectedKeys = new Set(selected.map((candidate) => candidate.key))

  for (const candidate of fallbackSelected) {
    if (selected.length >= targetCount) break
    if (selectedKeys.has(candidate.key)) continue
    selected.push(candidate)
    selectedKeys.add(candidate.key)
  }
  const pool = state.pool.map((candidate) =>
    selectedKeys.has(candidate.key)
      ? { ...candidate, isDisplayed: true, displayedAt: candidate.displayedAt ?? now() }
      : candidate,
  )

  return {
    ...state,
    pool,
    renderQueue: toRenderEntries(selected),
  }
}

function mergeCandidates(
  existing: RibbonEchoCandidate[],
  items: EchoItem[],
  snapshot: RibbonContextSnapshot,
  origin: RibbonEchoOrigin,
  relevanceScore: number,
  isHistory: boolean,
): RibbonEchoCandidate[] {
  const merged = [...existing]

  for (const item of items) {
    const key = candidateKeyFor(item, origin)
    const currentIndex = merged.findIndex((candidate) => candidate.key === key)
    const candidate: RibbonEchoCandidate = {
      key,
      item,
      origin,
      snapshotId: snapshot.id,
      relevanceScore,
      noveltyScore: scoreNovelty(merged, item),
      isDisplayed: currentIndex >= 0 ? merged[currentIndex].isDisplayed : false,
      isAdopted: currentIndex >= 0 ? merged[currentIndex].isAdopted : false,
      isHistory,
      createdAt: currentIndex >= 0 ? merged[currentIndex].createdAt : now(),
      displayedAt: currentIndex >= 0 ? merged[currentIndex].displayedAt : undefined,
    }

    if (currentIndex >= 0) merged[currentIndex] = candidate
    else merged.unshift(candidate)
  }

  return merged.slice(0, MAX_POOL_SIZE)
}

function updateJobStatus(
  jobs: RibbonJob[],
  jobId: string,
  status: RibbonJobStatus,
  error?: string,
): RibbonJob[] {
  return jobs.map((job) =>
    job.id === jobId
      ? {
          ...job,
          status,
          completedAt:
            status === 'running' || status === 'queued' || status === 'soft_timed_out'
              ? job.completedAt
              : now(),
          error,
        }
      : job,
  )
}

export const ribbonEngine = {
  createEmptyState(): RibbonEngineState {
    return {
      currentSnapshot: null,
      pool: [],
      renderQueue: [],
      jobs: [],
      pinnedModuleIds: [],
    }
  },

  createSnapshot(documentId: string, text: string, blockId?: string | null): RibbonContextSnapshot {
    return {
      id: generateId(),
      documentId,
      text,
      blockId: blockId ?? null,
      createdAt: now(),
    }
  },

  hydrate(history: EchoItem[], slotCount: RibbonSlotCount, documentId: string): RibbonEngineState {
    const snapshot = this.createSnapshot(documentId, '', null)
    const pool = mergeCandidates([], history, snapshot, 'history', 0.5, true)
    return recomputeRenderQueue(
      {
        currentSnapshot: snapshot,
        pool,
        renderQueue: [],
        jobs: [],
        pinnedModuleIds: [],
      },
      slotCount,
    )
  },

  startSnapshot(
    state: RibbonEngineState,
    snapshot: RibbonContextSnapshot,
    _slotCount: RibbonSlotCount,
    pinnedModuleIds: string[] = [],
  ): RibbonEngineState {
    return {
      ...state,
      currentSnapshot: snapshot,
      jobs: state.jobs.slice(0, MAX_RENDER_HISTORY),
      pinnedModuleIds,
    }
  },

  ingestStable(
    state: RibbonEngineState,
    snapshot: RibbonContextSnapshot,
    items: EchoItem[],
    slotCount: RibbonSlotCount,
  ): RibbonEngineState {
    const pool = mergeCandidates(state.pool, items, snapshot, 'rag', 1, false)
    return recomputeRenderQueue(
      {
        ...state,
        currentSnapshot: snapshot,
        pool,
      },
      slotCount,
    )
  },

  ingestAi(
    state: RibbonEngineState,
    snapshot: RibbonContextSnapshot,
    items: EchoItem[],
    origin: Extract<RibbonEchoOrigin, 'ai_imagery' | 'ai_tag' | 'ai_custom'>,
    slotCount: RibbonSlotCount,
  ): RibbonEngineState {
    if (!state.currentSnapshot || state.currentSnapshot.id !== snapshot.id) return state
    const pool = mergeCandidates(state.pool, items, snapshot, origin, 0.7, false)
    return recomputeRenderQueue({ ...state, pool }, slotCount)
  },

  markAdopted(state: RibbonEngineState, item: EchoItem): RibbonEngineState {
    return {
      ...state,
      pool: state.pool.map((candidate) =>
        candidate.item.id === item.id || candidate.key === candidateKeyFor(item, candidate.origin)
          ? { ...candidate, isAdopted: true, relevanceScore: Math.min(1.2, candidate.relevanceScore + 0.15) }
          : candidate,
      ),
    }
  },

  registerJob(
    state: RibbonEngineState,
    snapshotId: string,
    type: RibbonJobType,
    moduleId: string,
    jobId: string = generateId(),
  ): { state: RibbonEngineState; jobId: string } {
    const next: RibbonJob = {
      id: jobId,
      snapshotId,
      type,
      moduleId,
      status: 'queued',
      createdAt: now(),
    }
    return {
      state: {
        ...state,
        jobs: [next, ...state.jobs].slice(0, MAX_RENDER_HISTORY),
      },
      jobId,
    }
  },

  markJobRunning(state: RibbonEngineState, jobId: string): RibbonEngineState {
    return { ...state, jobs: updateJobStatus(state.jobs, jobId, 'running') }
  },

  markJobDone(state: RibbonEngineState, jobId: string): RibbonEngineState {
    return { ...state, jobs: updateJobStatus(state.jobs, jobId, 'done') }
  },

  markJobSoftTimedOut(state: RibbonEngineState, jobId: string, error?: string): RibbonEngineState {
    return { ...state, jobs: updateJobStatus(state.jobs, jobId, 'soft_timed_out', error) }
  },

  markJobFailed(state: RibbonEngineState, jobId: string, error?: string): RibbonEngineState {
    return { ...state, jobs: updateJobStatus(state.jobs, jobId, 'failed', error) }
  },

  markJobCancelled(state: RibbonEngineState, jobId: string, error?: string): RibbonEngineState {
    return { ...state, jobs: updateJobStatus(state.jobs, jobId, 'cancelled', error) }
  },

  getVisibleEchoes(
    state: RibbonEngineState,
    options?: {
      slotCount?: RibbonSlotCount
      include?: (item: EchoItem) => boolean
    },
  ): EchoItem[] {
    const slotCount = options?.slotCount ?? (state.renderQueue.length as RibbonSlotCount | number)
    return selectVisibleCandidates(state, slotCount, options?.include).map((candidate) => candidate.item)
  },

  getVisibleSlots(
    state: RibbonEngineState,
    slotCount: RibbonSlotCount,
    options?: {
      include?: (item: EchoItem) => boolean
    },
  ): Array<EchoItem | null> {
    const visible = this.getVisibleEchoes(state, { slotCount, include: options?.include })
    return Array.from({ length: slotCount }, (_, index) => visible[index] ?? null)
  },
}
