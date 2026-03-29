/**
 * Embedding service: local (Transformers.js) or API (OpenAI-compatible).
 * When useEmbeddingApi + baseUrl + apiKey are set, uses API; otherwise local.
 */

import {
  type EmbeddingConfig,
  getEmbeddingConfig,
  isEmbeddingApiConfigured,
} from '@/lib/embedding-config'
import { createLogger } from '@/lib/logger'

const logger = createLogger('embedding')

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const MAX_TEXT_LENGTH = 512
const API_BATCH_SIZE = 32

export function embeddingApiUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const hasV1 = base.endsWith('/v1')
  return hasV1 ? `${base}/embeddings` : `${base}/v1/embeddings`
}

export interface ValidateEmbeddingResult {
  valid: boolean
  error?: string
}

/**
 * Validate embedding API config by sending a minimal embeddings request.
 */
export async function validateEmbeddingApi(config: {
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
}): Promise<ValidateEmbeddingResult> {
  const { embeddingBaseUrl, embeddingApiKey, embeddingModel } = config
  if (!embeddingBaseUrl.trim()) {
    return { valid: false, error: '请输入服务地址' }
  }
  if (!embeddingApiKey.trim()) {
    return { valid: false, error: '请输入 API Key' }
  }
  if (!embeddingModel.trim()) {
    return { valid: false, error: '请输入嵌入模型名称' }
  }

  try {
    const url = embeddingApiUrl(embeddingBaseUrl)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: 'test',
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'API Key 无效或已过期' }
    }
    if (res.status === 429) {
      return { valid: false, error: '请求频率超限或额度不足' }
    }
    if (res.status === 404) {
      return { valid: false, error: '模型不存在或路径错误，请检查服务地址与模型名' }
    }
    if (res.status === 503) {
      return { valid: false, error: '服务过载，请稍后重试' }
    }
    if (res.status === 504) {
      return { valid: false, error: '服务响应超时，请稍后重试' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { valid: false, error: `服务返回错误 (${res.status}): ${text.slice(0, 120)}` }
    }

    const data = (await res.json()) as EmbeddingsResponse
    if (data.error?.message) {
      return { valid: false, error: data.error.message }
    }
    const embedding = data.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { valid: false, error: '返回格式异常，未得到有效向量' }
    }

    return { valid: true }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return {
        valid: false,
        error:
          '连接超时（25 秒）。请检查：① 服务地址是否为 https://api.siliconflow.cn/v1；② 网络/代理/防火墙；③ 稍后重试。',
      }
    }
    if (err instanceof TypeError) {
      return { valid: false, error: '无法连接到 API 服务，请检查服务地址或 CORS/网络' }
    }
    return { valid: false, error: `验证失败: ${(err as Error).message}` }
  }
}

/** OpenAI-compatible embeddings response */
interface EmbeddingsResponse {
  data?: { embedding: number[] }[]
  error?: { message?: string }
}

async function embedViaApi(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const url = embeddingApiUrl(config.embeddingBaseUrl)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embeddingApiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text.slice(0, 8000).trim(),
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Embedding API ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = (await res.json()) as EmbeddingsResponse
  if (data.error?.message) throw new Error(data.error.message)
  const embedding = data.data?.[0]?.embedding
  if (!Array.isArray(embedding)) throw new Error('Invalid embedding response')
  return embedding
}

async function embedBatchViaApi(
  texts: string[],
  config: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += API_BATCH_SIZE) {
    const batch = texts.slice(i, i + API_BATCH_SIZE)
    const url = embeddingApiUrl(config.embeddingBaseUrl)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.embeddingApiKey}`,
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: batch.map((t) => t.slice(0, 8000).trim()),
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Embedding API ${res.status}: ${errBody.slice(0, 200)}`)
    }

    const data = (await res.json()) as EmbeddingsResponse
    if (data.error?.message) throw new Error(data.error.message)
    const items = data.data ?? []
    if (items.length !== batch.length) {
      throw new Error(`Embedding API returned ${items.length} vs ${batch.length} requested`)
    }
    items.forEach((item) => results.push(item.embedding))
    onProgress?.(Math.min(i + API_BATCH_SIZE, texts.length), texts.length)
  }
  return results
}

let pipelineInstance: Awaited<ReturnType<typeof createPipeline>> | null = null

async function createPipeline() {
  const { pipeline } = await import('@xenova/transformers')
  return pipeline('feature-extraction', DEFAULT_MODEL, {
    quantized: true,
    progress_callback: (progress: { status?: string }) => {
      if (progress.status) logger.debug('Model load', progress)
    },
  })
}

async function getPipeline() {
  if (pipelineInstance) return pipelineInstance
  pipelineInstance = await createPipeline()
  return pipelineInstance
}

async function embedLocal(text: string): Promise<number[]> {
  const truncated = text.slice(0, MAX_TEXT_LENGTH).trim()
  if (!truncated) return []

  const extractor = await getPipeline()
  const output = await extractor(truncated, {
    pooling: 'mean',
    normalize: true,
  })
  return Array.from(output.data as Float32Array)
}

const EMBED_CACHE_MAX_ENTRIES = 5
const EMBED_CACHE_TTL_MS = 60_000

const embedCache = new Map<string, { vec: number[]; ts: number }>()

export function isEmbeddingTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError'
  }
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('timed out') || message.includes('timeout')
}

function getCachedEmbed(trimmed: string): number[] | null {
  const key = trimmed.slice(0, 300)
  const entry = embedCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > EMBED_CACHE_TTL_MS) {
    embedCache.delete(key)
    return null
  }
  return entry.vec
}

function setCachedEmbed(trimmed: string, vec: number[]): void {
  const key = trimmed.slice(0, 300)
  if (embedCache.size >= EMBED_CACHE_MAX_ENTRIES) {
    const oldest = [...embedCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) embedCache.delete(oldest[0])
  }
  embedCache.set(key, { vec, ts: Date.now() })
}

/**
 * Generate embedding vector for a single text.
 * Uses API when configured, else local Transformers.js.
 * Short-lived cache for same query to avoid repeated work (e.g. double refresh).
 */
export async function embed(text: string): Promise<number[]> {
  if (typeof window === 'undefined') {
    throw new Error('Embedding runs only in browser')
  }

  const trimmed = text.trim()
  if (!trimmed) return []

  const cached = getCachedEmbed(trimmed)
  if (cached) return cached

  const config = getEmbeddingConfig()
  let vec: number[]
  if (isEmbeddingApiConfigured()) {
    try {
      vec = await embedViaApi(trimmed, config)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (isEmbeddingTimeoutError(err)) {
        logger.warn('Embedding API timed out', { message: err.message })
      } else {
        logger.error('Embedding API failed', { message: err.message })
      }
      throw err
    }
  } else {
    try {
      vec = await embedLocal(trimmed)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Embedding failed', {
        message: err.message,
        name: err.name,
        textLength: text.length,
      })
      throw err
    }
  }
  setCachedEmbed(trimmed, vec)
  return vec
}

/**
 * Generate embeddings for multiple texts.
 * Uses API when configured (batched), else local (sequential).
 */
export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const config = getEmbeddingConfig()
  if (isEmbeddingApiConfigured() && texts.length > 0) {
    try {
      return await embedBatchViaApi(texts, config, onProgress)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (isEmbeddingTimeoutError(err)) {
        logger.warn('Embedding API batch timed out', { message: err.message })
      } else {
        logger.error('Embedding API batch failed', { message: err.message })
      }
      throw err
    }
  }

  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i++) {
    const vec = await embedLocal(texts[i])
    vectors.push(vec)
    onProgress?.(i + 1, texts.length)
  }
  return vectors
}

/**
 * Check if embedding is available (browser + WASM).
 */
export function isEmbeddingAvailable(): boolean {
  return typeof window !== 'undefined'
}

/**
 * Preload local model (call early to reduce first-query latency).
 * No-op when API embedding is configured.
 */
export async function preloadModel(): Promise<void> {
  if (!isEmbeddingAvailable() || isEmbeddingApiConfigured()) return
  try {
    await getPipeline()
    logger.info('Embedding model ready')
  } catch (error) {
    logger.warn('Embedding model preload failed', { error })
  }
}
