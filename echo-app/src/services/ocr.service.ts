import { createLogger } from '@/lib/logger'
import { getOcrConfig, isOcrConfigured } from '@/lib/ocr-config'

const logger = createLogger('ocr')

const OCR_TIMEOUT_MS = 45_000
const OCR_PROMPT =
  '请只返回图片中的识别文本，不要解释，不要补写，不要加 Markdown，不要加编号。保持原有段落顺序。若这一页几乎没有可识别文字，只返回空字符串。'

export type OcrErrorCode =
  | 'OCR_NOT_CONFIGURED'
  | 'OCR_TIMEOUT'
  | 'OCR_UNAUTHORIZED'
  | 'OCR_RATE_LIMITED'
  | 'OCR_MODEL_UNSUPPORTED'
  | 'OCR_API_ERROR'
  | 'OCR_EMPTY_RESULT'

export class OcrError extends Error {
  code: OcrErrorCode
  status?: number

  constructor(code: OcrErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'OcrError'
    this.code = code
    this.status = status
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string
            text?: string
          }>
    }
  }>
}

function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const hasV1 = base.endsWith('/v1')
  return hasV1 ? `${base}${path}` : `${base}/v1${path}`
}

function extractMessageText(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => (item?.type === 'text' ? (item.text ?? '') : ''))
      .join('\n')
      .trim()
  }
  return ''
}

function classifyBadRequest(status: number, bodyText: string): OcrError {
  const normalized = bodyText.toLowerCase()
  if (
    status === 404 ||
    /model/.test(normalized) ||
    /vision/.test(normalized) ||
    /multimodal/.test(normalized) ||
    /image/.test(normalized) ||
    /input_image/.test(normalized) ||
    /image_url/.test(normalized)
  ) {
    return new OcrError(
      'OCR_MODEL_UNSUPPORTED',
      '当前 OCR 模型不支持图片识别，请换成支持视觉输入的模型。',
      status,
    )
  }
  return new OcrError('OCR_API_ERROR', `OCR 请求失败（${status}）`, status)
}

export async function extractTextFromImage(imageDataUrl: string): Promise<string> {
  if (!isOcrConfigured()) {
    throw new OcrError('OCR_NOT_CONFIGURED', '当前未配置 OCR 模型，无法识别扫描件 PDF。')
  }

  const config = getOcrConfig()
  const url = apiUrl(config.baseUrl, '/chat/completions')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ocrModel,
        messages: [
          {
            role: 'system',
            content: OCR_PROMPT,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: OCR_PROMPT,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 1800,
      }),
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    })

    if (res.status === 401 || res.status === 403) {
      throw new OcrError(
        'OCR_UNAUTHORIZED',
        'OCR 配置无效，请检查 API Key 或服务地址。',
        res.status,
      )
    }
    if (res.status === 429) {
      throw new OcrError('OCR_RATE_LIMITED', 'OCR 请求过于频繁或额度不足，请稍后再试。', res.status)
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw classifyBadRequest(res.status, bodyText)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const text = extractMessageText(data)
    return text
  } catch (error) {
    if (error instanceof OcrError) throw error
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new OcrError('OCR_TIMEOUT', 'OCR 请求超时，请稍后重试。')
    }
    logger.error('OCR request failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    throw new OcrError('OCR_API_ERROR', error instanceof Error ? error.message : 'OCR 请求失败')
  }
}
