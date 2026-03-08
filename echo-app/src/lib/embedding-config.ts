/**
 * Read current embedding config from persisted settings (no React dependency).
 * Used by embedding.service and RAG to decide API vs local.
 */

const STORAGE_KEY = 'echo-settings'

export interface EmbeddingConfig {
  useEmbeddingApi: boolean
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
}

const DEFAULT: EmbeddingConfig = {
  useEmbeddingApi: false,
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  embeddingModel: 'BAAI/bge-m3',
}

export function getEmbeddingConfig(): EmbeddingConfig {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      useEmbeddingApi: Boolean(parsed.useEmbeddingApi),
      embeddingBaseUrl: String(parsed.embeddingBaseUrl ?? '').trim(),
      embeddingApiKey: String(parsed.embeddingApiKey ?? '').trim(),
      embeddingModel: String(parsed.embeddingModel ?? DEFAULT.embeddingModel).trim() || DEFAULT.embeddingModel,
    }
  } catch {
    return DEFAULT
  }
}

export function isEmbeddingApiConfigured(): boolean {
  const c = getEmbeddingConfig()
  return c.useEmbeddingApi && c.embeddingBaseUrl.length > 0 && c.embeddingApiKey.length > 0
}
