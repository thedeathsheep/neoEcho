/**
 * Read current OCR config from persisted settings (no React dependency).
 * OCR reuses the main AI endpoint/apiKey and only adds a dedicated vision model name.
 */

const STORAGE_KEY = 'echo-settings'

export interface OcrConfig {
  baseUrl: string
  apiKey: string
  ocrModel: string
}

const DEFAULT: OcrConfig = {
  baseUrl: '',
  apiKey: '',
  ocrModel: '',
}

export function getOcrConfig(): OcrConfig {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      baseUrl: String(parsed.baseUrl ?? '').trim(),
      apiKey: String(parsed.apiKey ?? '').trim(),
      ocrModel: String(parsed.ocrModel ?? '').trim(),
    }
  } catch {
    return DEFAULT
  }
}

export function isOcrConfigured(): boolean {
  const config = getOcrConfig()
  return config.baseUrl.length > 0 && config.apiKey.length > 0 && config.ocrModel.length > 0
}
