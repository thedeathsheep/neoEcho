import { devLog } from '@/lib/dev-log'
import { createLogger } from '@/lib/logger'
import { generateId } from '@/lib/utils/crypto'
import { now } from '@/lib/utils/time'
import { searchVectors } from '@/lib/vector-store'
import type { EchoItem, EchoType, RagCandidate } from '@/types'

import { embed } from './embedding.service'
import {
  getChunksByBase,
  getChunksByFiles,
  getMandatoryFilePaths,
  type KnowledgeChunk,
} from './knowledge-base.service'

const logger = createLogger('rag.service')

/**
 * Hybrid RAG: vector search (when embeddings exist) + keyword + jitter.
 * Supports mandatory book search (1-3 books must appear in results).
 * Intended to run in browser where localStorage chunks live.
 */

const JITTER_FACTOR = 0.2
const MAX_RESULTS = 5
const VECTOR_WEIGHT = 0.7
const CANDIDATES_MAX = 15
const KEYWORD_WEIGHT = 0.3
/** Minimum hybrid score to consider "strongly relevant"; reserve top-2 slots for these when possible. */
const STRONG_RELEVANCE_MIN = 0.25
/** Only add random fill when we have at least one result above this (avoid diluting strong relevance). */
const RANDOM_FILL_MIN_SCORE = 0.20

interface ScoredChunk {
  chunk: KnowledgeChunk
  score: number
  type: EchoType
}

/** Max slots (out of 5) that mandatory books can fill. Default 1. */
export type MandatoryMaxSlots = 1 | 2 | 3

interface SearchOptions {
  knowledgeBaseId?: string
  mandatoryBookIds?: string[]
  /** Cap how many of the 5 slots can come from mandatory books (default 1) */
  mandatoryMaxSlots?: MandatoryMaxSlots
}

/**
 * Simple keyword matching for BM25-like scoring
 * Optimized for Chinese context
 */
function keywordScore(query: string, content: string): number {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return 0

  let score = 0
  const contentLower = content.toLowerCase()

  // Exact match bonus
  if (contentLower.includes(q)) {
    score += 5
  }

  // Partial match (first 2 chars) for Chinese phrases
  if (q.length >= 2 && contentLower.includes(q.slice(0, 2))) {
    score += 2
  }

  // Character overlap ratio
  let overlap = 0
  for (const char of q) {
    if (contentLower.includes(char)) overlap++
  }
  score += (overlap / q.length) * 2

  // Normalize by length to favor concise matches
  return score / (content.length + 20)
}

/** Extract current sentence (last segment by sentence-ending punctuation) for view B. */
function extractCurrentSentence(fullText: string): string {
  const t = fullText.trim()
  if (t.length === 0) return ''
  const parts = t.split(/[。！？.!?]\s*/)
  const last = parts[parts.length - 1]?.trim()
  if (last && last.length > 0) return last.slice(0, 120)
  return t.slice(0, 80)
}

/** Extract short keyword-style string for view C (no punctuation, leading chars). */
function extractKeywordView(fullText: string): string {
  const t = fullText.replace(/[\s\p{P}]/gu, ' ').trim().slice(0, 80)
  return t.split(/\s+/).filter(Boolean).join(' ').slice(0, 60) || fullText.trim().slice(0, 40)
}

/**
 * Apply semantic jitter for creative variation
 */
function applySemanticJitter(scored: ScoredChunk[]): ScoredChunk[] {
  return scored.map((item) => ({
    ...item,
    score: item.score * (1 - JITTER_FACTOR * Math.random()),
  }))
}

/**
 * Take up to 2 by raw score (no jitter) when they meet STRONG_RELEVANCE_MIN, so top slots are truly relevant.
 * Fill the rest from jittered pool. Ensures the first one or two slots are strongly relevant when available.
 */
function takeTopWithReservedStrong(
  scored: ScoredChunk[],
  limit: number,
): ScoredChunk[] {
  const byScore = scored.filter((s) => s.score > 0.001).sort((a, b) => b.score - a.score)
  const strong = byScore.filter((s) => s.score >= STRONG_RELEVANCE_MIN)
  const top2 = strong.slice(0, 2)
  const top2Ids = new Set(top2.map((t) => t.chunk.id))
  const rest = byScore.filter((s) => !top2Ids.has(s.chunk.id))
  const jitteredRest = applySemanticJitter(rest).sort((a, b) => b.score - a.score)
  const filled = [...top2, ...jitteredRest.slice(0, Math.max(0, limit - top2.length))]
  return filled.slice(0, limit)
}

function toEchoItem(scored: ScoredChunk, blockId?: string): EchoItem {
  const full = extractReadableRagPassage(scored.chunk.content)
  return {
    id: generateId(),
    type: scored.type,
    content: full.slice(0, 200),
    source: scored.chunk.sourceFile,
    blockId,
    createdAt: now(),
    originalText: full,
  }
}

function extractReadableRagPassage(rawText: string): string {
  const normalized = rawText
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，。、；：！？"'“”‘’\]】）\s]+/u, '')
    .replace(/^(的是|而是|或者|并且|而且|因此|所以|如果|因为|然后|于是)/u, '')
    .trim()

  if (!normalized) return ''

  const sentenceLike = normalized.match(/[^。！？!?]+[。！？!?]?/gu) ?? [normalized]
  const complete = sentenceLike
    .map((part) => part.trim())
    .filter((part) => part.length >= 12 && /[。！？!?]$/u.test(part))

  if (complete.length > 0) {
    const preferred = complete.slice(0, 2).join('')
    if (preferred.length <= 220) return preferred
    const chunk = preferred.slice(0, 220)
    const boundary = Math.max(chunk.lastIndexOf('。'), chunk.lastIndexOf('！'), chunk.lastIndexOf('？'))
    if (boundary >= 24) return chunk.slice(0, boundary + 1).trim()
    return `${chunk.trim()}…`
  }

  if (normalized.length <= 220) return normalized

  const chunk = normalized.slice(0, 220)
  const boundary = Math.max(
    chunk.lastIndexOf('。'),
    chunk.lastIndexOf('！'),
    chunk.lastIndexOf('？'),
    chunk.lastIndexOf('；'),
    chunk.lastIndexOf('，'),
  )
  if (boundary >= 24) return chunk.slice(0, boundary + 1).trim()
  return `${chunk.trim()}…`
}

/**
 * Score chunks by keyword only (no embed). Used for sentence/keyword views in multi-view retrieval.
 */
function scoreChunksKeywordOnly(
  chunks: KnowledgeChunk[],
  query: string,
): ScoredChunk[] {
  if (query.trim().length < 1) return chunks.map((chunk) => ({ chunk, score: 0, type: 'lit' as EchoType }))
  return chunks.map((chunk) => {
    const s = keywordScore(query, chunk.content)
    return {
      chunk,
      score: Math.min(s * 10, 1),
      type: s > 0.05 ? 'lit' : 'fact',
    }
  })
}

/**
 * Score and rank chunks using hybrid approach
 */
async function scoreChunks(
  chunks: KnowledgeChunk[],
  query: string,
  hasEmbeddings: boolean,
): Promise<ScoredChunk[]> {
  // Vector search when embeddings available
  const vectorScores = new Map<string, number>()

  if (hasEmbeddings) {
    try {
      const t0 = Date.now()
      const queryEmbedding = await embed(query)
      devLog.push('rag', 'embed done', { ms: Date.now() - t0 })
      const t1 = Date.now()
      const vectorResults = searchVectors(queryEmbedding, chunks, chunks.length)
      vectorResults.forEach(({ item, score }) => {
        vectorScores.set(item.id, score)
      })
      devLog.push('rag', 'vector score done', { ms: Date.now() - t1, chunks: chunks.length })
    } catch (e) {
      logger.warn('Vector search skipped', { error: e })
    }
  }

  // Score all chunks
  return chunks.map((chunk) => {
    const keywordS = keywordScore(query, chunk.content)
    const vectorS = vectorScores.get(chunk.id) ?? 0

    const type: EchoType =
      keywordS > 0.05 || vectorS > 0.15 ? 'lit' : 'fact'

    const hybridScore =
      hasEmbeddings && vectorScores.has(chunk.id)
        ? VECTOR_WEIGHT * vectorS +
          KEYWORD_WEIGHT * Math.min(keywordS * 10, 1)
        : keywordS

    return {
      chunk,
      score: hybridScore,
      type,
    }
  })
}

/**
 * Search knowledge base with optional mandatory book inclusion.
 * mandatoryMaxSlots caps how many of the 5 results can come from mandatory books.
 * Remaining slots are filled only from non-mandatory books to avoid one book dominating.
 */
async function searchWithMandatoryBooks(
  query: string,
  baseId: string,
  mandatoryBookIds: string[],
  mandatoryMaxSlots: MandatoryMaxSlots,
  blockId?: string,
  allChunks?: KnowledgeChunk[],
): Promise<EchoItem[]> {
  const MAX_RESULTS = 5
  const results: EchoItem[] = []
  const usedChunkIds = new Set<string>()
  const mandatoryFilePaths = getMandatoryFilePaths(baseId)

  // Step 1: Get at most mandatoryMaxSlots from mandatory books (best per book, then take top N)
  if (mandatoryBookIds.length > 0 && mandatoryMaxSlots >= 1) {
    const mandatoryChunks =
      allChunks != null
        ? allChunks.filter((c) => mandatoryFilePaths.includes(c.fileId))
        : await getChunksByFiles(mandatoryBookIds, baseId)
    const hasMandatoryEmbeddings = mandatoryChunks.some(
      (c) => c.embedding?.length,
    )

    const scoredMandatory = await scoreChunks(
      mandatoryChunks,
      query,
      hasMandatoryEmbeddings,
    )
    const jitteredMandatory = applySemanticJitter(scoredMandatory)

    // One best per mandatory book, then take top mandatoryMaxSlots by score
    const fileGroups = new Map<string, ScoredChunk[]>()
    jitteredMandatory.forEach((s) => {
      const list = fileGroups.get(s.chunk.fileId) || []
      list.push(s)
      fileGroups.set(s.chunk.fileId, list)
    })

    const bestPerBook: ScoredChunk[] = []
    for (const [, bookChunks] of fileGroups) {
      const sorted = [...bookChunks].sort((a, b) => b.score - a.score)
      if (sorted.length > 0) bestPerBook.push(sorted[0])
    }

    const topMandatory = bestPerBook
      .sort((a, b) => b.score - a.score)
      .slice(0, mandatoryMaxSlots)

    topMandatory.forEach((s) => {
      if (!usedChunkIds.has(s.chunk.id)) {
        results.push(toEchoItem(s, blockId))
        usedChunkIds.add(s.chunk.id)
      }
    })
  }

  // Step 2: Fill remaining slots only from non-mandatory books (so one book doesn't dominate)
  const remainingSlots = MAX_RESULTS - results.length

  if (remainingSlots > 0) {
    const restChunks =
      allChunks != null
        ? allChunks
        : await getChunksByBase(baseId)
    const availableChunks = restChunks.filter(
      (c) =>
        !usedChunkIds.has(c.id) &&
        !mandatoryFilePaths.includes(c.fileId),
    )

    const hasEmbeddings = availableChunks.some((c) => c.embedding?.length)
    const scored = await scoreChunks(
      availableChunks,
      query,
      hasEmbeddings,
    )
    const topResults = takeTopWithReservedStrong(scored, remainingSlots)

    topResults.forEach((r) => {
      results.push(toEchoItem(r, blockId))
    })

    // If still not enough (e.g. base has only mandatory books), fill from pool only when we have some relevance
    const bestScoreInRest = topResults.length > 0 ? Math.max(...topResults.map((r) => r.score)) : 0
    const allowFallbackFill = bestScoreInRest >= RANDOM_FILL_MIN_SCORE
    if (results.length < MAX_RESULTS && allowFallbackFill) {
      const fallbackPool = allChunks != null ? allChunks : await getChunksByBase(baseId)
      const usedIds = new Set(results.map((r) => r.id))
      const fallbackChunks = fallbackPool.filter(
        (c) => !usedIds.has(c.id),
      )
      const shuffled = [...fallbackChunks].sort(
        () => Math.random() - 0.5,
      )
      const needed = MAX_RESULTS - results.length

      shuffled.slice(0, needed).forEach((chunk) => {
        const full = chunk.content
        results.push({
          id: generateId(),
          type: 'lit',
          content: full.slice(0, 200),
          source: chunk.sourceFile,
          blockId,
          createdAt: now(),
          originalText: full,
        })
      })
    }
  }

  return results
}

/**
 * Regular search without mandatory books
 */
async function searchRegular(
  query: string,
  baseId: string,
  blockId?: string,
  allChunks?: KnowledgeChunk[],
): Promise<EchoItem[]> {
  const chunks = allChunks ?? await getChunksByBase(baseId)
  const allChunksRes = chunks

  if (allChunksRes.length === 0) {
    return []
  }

  const hasEmbeddings = allChunksRes.some((c) => c.embedding?.length)
  const scored = await scoreChunks(allChunksRes, query, hasEmbeddings)
  const topResults = takeTopWithReservedStrong(scored, MAX_RESULTS)

  // Only add random fill when we already have at least one reasonably relevant result (avoid diluting strong relevance)
  const bestScore = topResults.length > 0 ? Math.max(...topResults.map((r) => r.score)) : 0
  const allowRandomFill = bestScore >= RANDOM_FILL_MIN_SCORE && topResults.length >= 2
  if (topResults.length < MAX_RESULTS && allChunksRes.length > 0 && allowRandomFill) {
    // Use semantic jitter on remaining chunks instead of pure random
    const selectedIds = new Set(topResults.map((r) => r.chunk.id))
    const availableChunks = allChunksRes.filter(
      (c) => !selectedIds.has(c.id),
    )
    // Score remaining chunks and apply jitter for variety
    const remainingScored = await scoreChunks(availableChunks, query, hasEmbeddings)
    const jitteredRemaining = applySemanticJitter(remainingScored)
      .filter((s) => s.score > 0.05) // Only consider somewhat relevant remaining chunks
      .sort((a, b) => b.score - a.score)
    const needed = MAX_RESULTS - topResults.length
    const fillPicks = jitteredRemaining.slice(0, needed)

    const fillScored: ScoredChunk[] = fillPicks.map((item) => ({
      chunk: item.chunk,
      score: item.score * 0.5, // Reduce score of filled items to indicate lower confidence
      type: 'lit',
    }))

    topResults.push(...fillScored)
  }

  return topResults.map((r) => toEchoItem(r, blockId))
}

/**
 * Multi-view candidate generation: full text, current sentence, keyword view.
 * Returns up to CANDIDATES_MAX candidates with baseScore for reranking.
 * Respects mandatory books when options.mandatoryBookIds are set.
 */
export async function generateCandidatesByViews(
  query: string,
  options: SearchOptions = {},
  blockId?: string,
  preloadedChunks?: KnowledgeChunk[],
): Promise<RagCandidate[]> {
  const baseId = options.knowledgeBaseId
  if (!baseId) return []

  const tLoad = Date.now()
  const chunks = preloadedChunks ?? (await getChunksByBase(baseId))
  if (chunks.length === 0) return []
  if (preloadedChunks == null) {
    devLog.push('rag', 'candidatesByViews chunks loaded', { ms: Date.now() - tLoad, count: chunks.length })
  }

  const fullView = query.trim().slice(0, 500)
  const sentenceView = extractCurrentSentence(query)
  const keywordView = extractKeywordView(query)

  const hasEmbeddings = chunks.some((c) => c.embedding?.length)
  const [scoredFull, scoredSentence, scoredKeyword] = await Promise.all([
    scoreChunks(chunks, fullView, hasEmbeddings),
    Promise.resolve(scoreChunksKeywordOnly(chunks, sentenceView)),
    Promise.resolve(scoreChunksKeywordOnly(chunks, keywordView)),
  ])

  const byId = new Map<string, { chunk: KnowledgeChunk; score: number; type: EchoType }>()
  function addScored(list: ScoredChunk[]) {
    list.forEach((s) => {
      const cur = byId.get(s.chunk.id)
      const score = s.score
      if (!cur || score > cur.score) byId.set(s.chunk.id, { chunk: s.chunk, score, type: s.type })
    })
  }
  addScored(scoredFull)
  addScored(scoredSentence)
  addScored(scoredKeyword)

  const mandatoryFilePaths = getMandatoryFilePaths(baseId)
  const mandatoryBookIds = (options.mandatoryBookIds || []).slice(0, 3)
  const mandatoryMaxSlots = options.mandatoryMaxSlots ?? 1

  const merged = Array.from(byId.entries())
    .map(([_id, { chunk, score, type }]) => ({ chunk, score, type }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES_MAX)

  let result: ScoredChunk[]
  if (mandatoryBookIds.length > 0 && mandatoryMaxSlots >= 1) {
    const mandatory = merged.filter((s) => mandatoryFilePaths.includes(s.chunk.fileId))
    const rest = merged.filter((s) => !mandatoryFilePaths.includes(s.chunk.fileId))
    const topMandatory = mandatory.slice(0, mandatoryMaxSlots)
    result = [...topMandatory, ...rest].slice(0, CANDIDATES_MAX)
  } else {
    result = merged
  }

  const candidates: RagCandidate[] = result.map((s) => {
    const item = toEchoItem(s, blockId)
    return { ...item, baseScore: s.score }
  })

  devLog.push('rag', 'candidatesByViews done', { count: candidates.length })
  return candidates
}

export const ragService = {
  /**
   * Search knowledge base by text context.
   * Supports mandatory book inclusion (1-3 books will always appear in results).
   * Hybrid: vector similarity (when embeddings exist) + keyword + jitter.
   * Call from client only (chunks/embeddings in IndexedDB).
   */
  async search(
    query: string,
    options: SearchOptions = {},
    blockId?: string,
    preloadedChunks?: KnowledgeChunk[],
  ): Promise<EchoItem[]> {
    logger.debug('RAG search', {
      query: query.slice(0, 50),
      blockId,
      baseId: options.knowledgeBaseId,
      mandatoryBooks: options.mandatoryBookIds,
    })

    const baseId = options.knowledgeBaseId

    if (!baseId) {
      logger.warn('No knowledge base specified for search')
      return []
    }

    const tLoad = Date.now()
    const chunks =
      preloadedChunks ?? (await getChunksByBase(baseId))
    if (preloadedChunks == null) {
      devLog.push('rag', 'chunks loaded', { ms: Date.now() - tLoad, count: chunks.length })
    }
    if (chunks.length === 0) {
      return []
    }

    const mandatoryBookIds = (options.mandatoryBookIds || []).slice(0, 3)
    const mandatoryMaxSlots = options.mandatoryMaxSlots ?? 1
    let results: EchoItem[]

    if (mandatoryBookIds.length > 0) {
      results = await searchWithMandatoryBooks(
        query,
        baseId,
        mandatoryBookIds,
        mandatoryMaxSlots,
        blockId,
        chunks,
      )
    } else {
      results = await searchRegular(query, baseId, blockId, chunks)
    }

    logger.debug('RAG results', {
      baseId,
      totalChunks: chunks.length,
      mandatoryBooks: mandatoryBookIds.length,
      results: results.length,
    })

    return results
  },

  /**
   * Get fallback echoes when knowledge base is empty
   */
  getFallbackEchoes(_blockId?: string): EchoItem[] {
    return []
  },
}
