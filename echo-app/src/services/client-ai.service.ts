import type { Settings } from '@/lib/settings-context'
import type { AIMode, EchoItem } from '@/types'
import type { RibbonModuleType } from '@/types'
import { customPromptService } from './custom-prompt.service'

interface ValidateResult {
  valid: boolean
  error?: string
  models?: string[]
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[]
}

interface ModelsResponse {
  data: { id: string }[]
}

function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const hasV1 = base.endsWith('/v1')
  return hasV1 ? `${base}${path}` : `${base}/v1${path}`
}

export async function validateApiKey(
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
): Promise<ValidateResult> {
  if (!settings.apiKey) {
    return { valid: false, error: '请输入 API Key' }
  }

  try {
    const res = await fetch(apiUrl(settings.baseUrl, '/models'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'API Key 无效或已过期' }
    }

    if (res.status === 429) {
      return { valid: false, error: '请求频率超限或额度不足' }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { valid: false, error: `服务返回错误 (${res.status}): ${text.slice(0, 120)}` }
    }

    const data = (await res.json()) as ModelsResponse
    const models = Array.isArray(data?.data)
      ? data.data.map((m) => m.id).slice(0, 20)
      : []

    return { valid: true, models }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { valid: false, error: '连接超时，请检查 Base URL 是否正确' }
    }
    if (err instanceof TypeError) {
      return { valid: false, error: '无法连接到 API 服务，请检查 Base URL' }
    }
    return { valid: false, error: `验证失败: ${(err as Error).message}` }
  }
}

// Default system prompts for preset AI modes
const DEFAULT_SYSTEM_PROMPTS: Record<Exclude<AIMode, 'custom'>, string> = {
  polish: `你是词语炼金师。基于用户正在写作的内容，提供3-5条词语润色建议。
规则：
- 每条建议不超过25字
- 不要编号、不要解释、不要开头语
- 直接输出建议，用换行分隔
- 聚焦：精准用词、修辞优化、节奏调整
- 风格：简洁、专业、切中要害
- 示例：将"他走了"改为"他转身离去，脚步声渐远"`,

  narrative: `你是叙事引导者。基于用户正在写作的内容，提供3-5条叙事方向建议。
规则：
- 每条建议不超过30字
- 不要编号、不要解释、不要开头语
- 直接输出建议，用换行分隔
- 聚焦：情节转折、视角切换、悬念设置、时间跳跃
- 风格：启发性、开放、有张力
- 示例：切换至配角视角，揭示主角未知的真相`,

  imagery: `你是沉默的灵感收集者。基于用户正在写作的内容和相关的知识库片段，生成3-5条简短的灵感碎片。
规则：
- 每条不超过30字
- 不要编号、不要解释、不要开头语
- 直接输出碎片，用换行分隔
- 碎片应是意象、联想、反问或隐喻
- 风格：诗意、克制、有张力`,

  quote: `你是引文捕手。基于用户正在写作的内容和知识库片段，推荐3-5条可能相关的经典引文或表达。
规则：
- 每条引文不超过40字
- 不要编号、不要解释、不要开头语
- 直接输出引文，用换行分隔
- 可以引用经典作家、哲学家、诗人的名言，或提供类似的诗意表达
- 风格：经典、深刻、共鸣感强
- 格式："引文内容"——作者《作品》`,
}

// Get system prompt based on mode and custom prompt
function getSystemPrompt(mode: AIMode): string {
  if (mode === 'custom') {
    const activePrompt = customPromptService.getActive()
    if (activePrompt?.content?.trim()) {
      return activePrompt.content.trim()
    }
    return DEFAULT_SYSTEM_PROMPTS.imagery
  }
  return DEFAULT_SYSTEM_PROMPTS[mode]
}

/** Get system prompt for a ribbon module (by type and id for custom). */
function getSystemPromptForRibbonModule(type: RibbonModuleType, id: string, customPrompt?: string): string {
  if (type === 'custom') {
    const prompt = customPromptService.get(id)
    if (prompt?.content?.trim()) return prompt.content.trim()
    return DEFAULT_SYSTEM_PROMPTS.imagery
  }
  if (type.startsWith('ai:')) {
    // Use custom prompt override if provided
    if (customPrompt?.trim()) return customPrompt.trim()
    const mode = type.replace('ai:', '') as Exclude<AIMode, 'custom'>
    if (mode in DEFAULT_SYSTEM_PROMPTS) return DEFAULT_SYSTEM_PROMPTS[mode]
  }
  return DEFAULT_SYSTEM_PROMPTS.imagery
}

/** Map ribbon module type to AIMode for user prompt building. */
function ribbonTypeToAIMode(type: RibbonModuleType): AIMode {
  if (type === 'custom') return 'custom'
  if (type === 'rag') return 'imagery'
  if (type.startsWith('ai:')) {
    const m = type.replace('ai:', '') as Exclude<AIMode, 'custom'>
    if (m in DEFAULT_SYSTEM_PROMPTS) return m
  }
  return 'imagery'
}

/** Get display label for a ribbon module (shown in ribbon cell). */
function getModuleDisplayLabel(type: RibbonModuleType, id: string): string {
  if (type === 'custom') {
    const prompt = customPromptService.get(id)
    if (prompt?.name) return `自定义-${prompt.name}`
    return '自定义'
  }
  const labels: Record<string, string> = {
    'ai:imagery': 'AI 意象',
    'ai:polish': 'AI 润色',
    'ai:narrative': 'AI 叙事',
    'ai:quote': 'AI 引用',
  }
  if (type.startsWith('ai:')) {
    return labels[type] || 'AI 生成'
  }
  return 'AI 生成'
}

function buildUserPromptByMode(
  context: string,
  ragResults: EchoItem[],
  mode: AIMode,
): string {
  const ragContext =
    ragResults.length > 0
      ? `\n\n相关知识库片段：\n${ragResults.map((r) => `- ${r.content}`).join('\n')}`
      : ''

  const baseContent = `用户正在写：\n${context.slice(0, 800)}${ragContext}`

  switch (mode) {
    case 'polish':
      return `${baseContent}\n\n请针对上述文本的用词和表达提供润色建议。`
    case 'narrative':
      return `${baseContent}\n\n请针对上述文本的叙事结构和情节发展提供引导建议。`
    case 'quote':
      return `${baseContent}\n\n请推荐与上述主题相关的经典引文或类似表达。`
    case 'custom':
      // For custom mode, the user prompt is the same as imagery (just context)
      return baseContent
    case 'imagery':
    default:
      return baseContent
  }
}

const QUERY_EXPAND_SYSTEM = `You are a semantic search helper. Given a short writer's prompt or keyword (in any language), output 3-5 related words or short phrases in the SAME language, for finding relevant passages. No explanation, no numbering. Separate by spaces or commas. Example: "春天" -> "春天 花开 温暖 春风 复苏 三月"`

/**
 * Expand query with AI for better semantic RAG recall (e.g. "春天" matches passages about spring without the word).
 * Returns original query + expanded terms, or original on failure.
 */
export async function expandQueryForRAG(
  query: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
): Promise<string> {
  if (!settings.apiKey || query.trim().length < 1) return query.trim()

  try {
    const res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: QUERY_EXPAND_SYSTEM },
          { role: 'user', content: query.trim().slice(0, 200) },
        ],
        temperature: 0.3,
        max_tokens: 80,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return query.trim()

    const data = (await res.json()) as ChatCompletionResponse
    const expansion = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!expansion) return query.trim()

    const terms = expansion.replace(/,/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
    const combined = [query.trim(), ...terms].filter(Boolean).join(' ')
    return combined.slice(0, 400)
  } catch {
    return query.trim()
  }
}

const RIBBON_FILTER_SYSTEM = `You are a filter. Given a list of text snippets from document retrieval, output which ones to KEEP (valuable for writing inspiration). Exclude: headers, footers, watermarks, URLs, "来自...", "汇总:", metadata, repetitive or empty content.
Output only the zero-based indices to keep, comma-separated (e.g. 0,2,4). If all are valuable, output ALL. No other text.`

/**
 * Filter ribbon candidates with a quick model call to drop low-value snippets.
 * Returns original list on API failure or parse error.
 */
export async function filterRibbonCandidates(
  context: string,
  items: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
): Promise<EchoItem[]> {
  if (!settings.apiKey || items.length === 0) return items
  const model = (settings.ribbonFilterModel || '').trim() || settings.model

  const list = items
    .map((item, i) => `${i}. ${(item.content || '').slice(0, 120).replace(/\n/g, ' ')}`)
    .join('\n')
  const userContent = `Current writing context: "${context.slice(0, 100)}"\n\nSnippets:\n${list}\n\nOutput indices to keep (comma-separated) or ALL:`

  try {
    const res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: RIBBON_FILTER_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return items

    const data = (await res.json()) as ChatCompletionResponse
    const raw = (data.choices?.[0]?.message?.content ?? '').trim().toUpperCase()
    if (raw.includes('ALL')) return items

    const indices = new Set<number>()
    raw
      .replace(/\s/g, '')
      .split(',')
      .forEach((s) => {
        const n = parseInt(s, 10)
        if (!Number.isNaN(n) && n >= 0 && n < items.length) indices.add(n)
      })
    if (indices.size === 0) return items

    return items.filter((_, i) => indices.has(i))
  } catch {
    return items
  }
}

/**
 * Single-style echo generation (legacy). Prefer ribbon modules + generateEchoesForModule.
 * @deprecated Ribbon uses content modules and generateEchoesForModule instead.
 */
export async function generateEchoes(
  context: string,
  ragResults: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'> & { aiMode?: AIMode },
  blockId?: string,
): Promise<EchoItem[]> {
  if (!settings.apiKey) return []

  const mode = settings.aiMode ?? 'imagery'
  const systemPrompt = getSystemPrompt(mode)
  const userContent = buildUserPromptByMode(context, ragResults, mode)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  let res: Response
  try {
    res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0.85,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('NETWORK_TIMEOUT')
    }
    if (err instanceof TypeError) {
      throw new Error('NETWORK_ERROR')
    }
    throw new Error(`NETWORK_ERROR:${(err as Error).message}`)
  }

  if (!res.ok) {
    const status = res.status
    let body = ''
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    if (status === 401 || status === 403) throw new Error('API_KEY_INVALID')
    if (status === 429) throw new Error('RATE_LIMITED')
    if (status === 402) throw new Error('INSUFFICIENT_BALANCE')
    if (status === 400) throw new Error('API_BAD_REQUEST')
    if (status === 404) throw new Error('API_NOT_FOUND')
    if (status >= 500) throw new Error('API_SERVER_ERROR')
    throw new Error(`API_ERROR_${status}:${body.slice(0, 80)}`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const text = data.choices?.[0]?.message?.content ?? ''

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 60)
    .slice(0, 5)
    .map((content, i) => ({
      id: `ai-${Date.now()}-${i}`,
      type: 'lit' as const,
      content,
      source: 'AI',
      blockId,
      createdAt: new Date().toISOString(),
    }))
}

/**
 * Generate echoes for a single ribbon module (AI mode or custom prompt by id).
 * Used when multiple modules are enabled; each module can be called independently.
 */
export async function generateEchoesForModule(
  context: string,
  ragResults: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  module: { type: RibbonModuleType; id: string; prompt?: string },
  blockId?: string,
): Promise<EchoItem[]> {
  if (!settings.apiKey || (module.type !== 'custom' && !module.type.startsWith('ai:'))) {
    return []
  }
  const systemPrompt = getSystemPromptForRibbonModule(module.type, module.id, module.prompt)
  const mode = ribbonTypeToAIMode(module.type)
  const userContent = buildUserPromptByMode(context, ragResults, mode)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  let res: Response
  try {
    res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0.85,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('NETWORK_TIMEOUT')
    }
    if (err instanceof TypeError) {
      throw new Error('NETWORK_ERROR')
    }
    throw new Error(`NETWORK_ERROR:${(err as Error).message}`)
  }

  if (!res.ok) {
    const status = res.status
    let body = ''
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    if (status === 401 || status === 403) throw new Error('API_KEY_INVALID')
    if (status === 429) throw new Error('RATE_LIMITED')
    if (status === 402) throw new Error('INSUFFICIENT_BALANCE')
    if (status === 400) throw new Error('API_BAD_REQUEST')
    if (status === 404) throw new Error('API_NOT_FOUND')
    if (status >= 500) throw new Error('API_SERVER_ERROR')
    throw new Error(`API_ERROR_${status}:${body.slice(0, 80)}`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const text = data.choices?.[0]?.message?.content ?? ''
  // Map module type to display label
  const sourceLabel = getModuleDisplayLabel(module.type, module.id)

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 60)
    .slice(0, 5)
    .map((content, i) => ({
      id: `ai-${module.id}-${Date.now()}-${i}`,
      type: 'lit' as const,
      content,
      source: sourceLabel,
      blockId,
      createdAt: new Date().toISOString(),
    }))
}
