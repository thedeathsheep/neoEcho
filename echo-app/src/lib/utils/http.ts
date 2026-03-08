import { createLogger } from '@/lib/logger'

const logger = createLogger('http')

interface FetchOptions extends RequestInit {
  timeout?: number
  retries?: number
  retryDelay?: number
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
  ) {
    super(`HTTP ${status}: ${statusText}`)
    this.name = 'HttpError'
  }
}

export async function request<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { timeout = 30_000, retries = 0, retryDelay = 1000, ...fetchOptions } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!response.ok) {
        const body = await response.text().catch(() => undefined)
        throw new HttpError(response.status, response.statusText, body)
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt)
        logger.warn(`Request failed, retrying in ${delay}ms`, {
          url,
          attempt: attempt + 1,
          error: lastError.message,
        })
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  logger.error('Request failed after all retries', { url, error: lastError?.message })
  throw lastError
}
