import type { Settings } from '@/lib/settings-context'
import { BUILTIN_RIBBON_MODULES } from '@/lib/settings-context'
import { devLog } from '@/lib/dev-log'
import { sanitizeForDisplay } from '@/lib/utils/text-sanitize'
import type { AIMode, EchoItem, RagCandidate } from '@/types'
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
  choices: { message: { content: string }; finish_reason?: string }[]
}

interface ModelsResponse {
  data: { id: string }[]
}

function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const hasV1 = base.endsWith('/v1')
  return hasV1 ? `${base}${path}` : `${base}/v1${path}`
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(ms)
  // Merge caller cancellation with a hard timeout
  return (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([
    signal,
    AbortSignal.timeout(ms),
  ])
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
export const DEFAULT_SYSTEM_PROMPTS: Record<Exclude<AIMode, 'custom'>, string> = {
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

// Default prompt for quick response module (no RAG)
const DEFAULT_QUICK_PROMPT = `你是文思泉涌的灵感助手。基于用户正在写作的内容，给出简短、有用的建议或反馈，帮助用户改进写作。
规则：
- 回复控制在50字以内
- 不要编号、不要解释过多
- 直接给出建议
- 聚焦：写作技巧、情感表达、结构优化
- 风格：简洁、启发性、有文学感`

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
  const clamp = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)
  const withBudgetGuardrails = (s: string): string => {
    const base = clamp((s || '').trim(), 2400)
    if (!base) return base
    // Hard guardrails to keep latency predictable (especially for “百科解释” style prompts).
    return `${base}\n\n【输出预算（必须遵守）】\n- 总长度不超过400字\n- 最多3段\n- 只输出正文，不要编号/标题/前后缀\n`
  }
  if (type === 'quick') {
    // quick modules use customPrompt directly, or fall back to default
    if (customPrompt?.trim()) return withBudgetGuardrails(customPrompt)
    return DEFAULT_QUICK_PROMPT
  }
  if (type === 'custom') {
    // For custom type, try to get from service
    const prompt = customPromptService.get(id)
    if (prompt?.content?.trim()) return withBudgetGuardrails(prompt.content)
    devLog.push('ai', 'custom prompt not found, using fallback', { moduleId: id })
    return DEFAULT_SYSTEM_PROMPTS.imagery
  }
  if (type.startsWith('ai:')) {
    // Use custom prompt override if provided
    if (customPrompt?.trim()) return withBudgetGuardrails(customPrompt)
    const mode = type.replace('ai:', '') as Exclude<AIMode, 'custom'>
    if (mode in DEFAULT_SYSTEM_PROMPTS) return DEFAULT_SYSTEM_PROMPTS[mode]
  }
  return DEFAULT_SYSTEM_PROMPTS.imagery
}

/** Map ribbon module type to AIMode for user prompt building. */
function ribbonTypeToAIMode(type: RibbonModuleType): AIMode {
  if (type === 'custom' || type === 'quick') return 'custom'
  if (type === 'rag') return 'imagery'
  if (type.startsWith('ai:')) {
    const m = type.replace('ai:', '') as Exclude<AIMode, 'custom'>
    if (m in DEFAULT_SYSTEM_PROMPTS) return m
  }
  return 'imagery'
}

/** Get default system prompt for a module type (for settings UI). */
export function getDefaultPromptForModule(type: RibbonModuleType): string | null {
  if (type === 'custom') return null
  if (type === 'quick') return DEFAULT_QUICK_PROMPT
  if (type.startsWith('ai:')) {
    const mode = type.replace('ai:', '') as Exclude<AIMode, 'custom'>
    if (mode in DEFAULT_SYSTEM_PROMPTS) return DEFAULT_SYSTEM_PROMPTS[mode]
  }
  return null
}

/** Generate a prompt from description using AI. */
export async function generatePromptFromDescription(
  description: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
): Promise<string> {
  if (!settings.apiKey || !description.trim()) {
    throw new Error('API Key 或描述不能为空')
  }

  const systemPrompt = `你是提示词工程师。请根据用户的描述，生成一段「系统提示词」的纯文本内容。

【应用场景】
这段提示词将用于一个「写作助手织带」：用户写作时，AI 会收到用户当前段落（及可选的知识库片段），并需回复多行短句；每行会作为一条独立内容展示在织带中。因此提示词必须约束 AI：输出多行、每行简短、不编号、不解释。

【输出要求】
- 只输出可被直接用作系统提示词的纯文本，不要任何前置说明、不要「系统提示词」「角色定义」「任务描述」等小标题或 Markdown 标题（如 #、##）。
- 内容结构建议：先一句话定义角色与任务（如「你是……。基于用户正在写作的内容，提供/生成……」），再写「规则：」并用短句列出输出格式（如每条不超过多少字、不要编号、直接输出用换行分隔、风格等）。
- 风格与现有内置提示词一致：简洁、可执行、强调「每条不超过 X 字」「不要编号、不要解释、不要开头语」「直接输出，用换行分隔」。
- 使用中文。

【重要】
生成的提示词必须紧密围绕用户的具体需求描述，体现该模块的独特功能（如百科解释、诗歌润色、情节推进等），而不是生成一个通用的写作助手提示词。`

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `我需要创建一个自定义模块，具体需求如下：\n\n${description.trim()}\n\n请根据以上描述，生成一段专门的系统提示词。提示词要体现「${description.trim().slice(0, 20)}」这个模块的独特功能，不要生成通用的写作助手提示词。` },
        ],
        temperature: 0.7,
        max_tokens: 512,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`API 错误 (${res.status}): ${errorText.slice(0, 200)}`)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const content = (data.choices?.[0]?.message?.content ?? '').trim()
    if (!content) {
      throw new Error('API 返回空内容')
    }
    return content
  } catch (err) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error('网络请求失败')
  }
}

/** Get display label for a ribbon module (shown in ribbon cell). */
function getModuleDisplayLabel(type: RibbonModuleType, id: string): string {
  if (type === 'custom') {
    const prompt = customPromptService.get(id)
    if (prompt?.name) return `自定义-${prompt.name}`
    return '自定义'
  }
  if (type === 'quick') {
    // Quick modules use their label directly
    const builtin = BUILTIN_RIBBON_MODULES.find(m => m.id === id)
    if (builtin?.label) return builtin.label
    return '快速助手'
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

const RAG_CORRECT_SYSTEM = `你是文本校对助手。知识库检索片段可能含OCR错误、断行异常、断头标点、多余空格等。请校对为符合正常文本表现的版本，保持原意，仅修正格式和明显错误。
输出格式：每段一行，以 --- 分隔，顺序与输入一致。不要添加任何解释或编号。`

const RAG_SUMMARIZE_TOP_N = 6
const RAG_SUMMARIZE_TIMEOUT_MS = 3500

const RAG_SUMMARIZE_SYSTEM = `你为每条知识库片段生成一行：简短摘要（20-40字，概括要点）| 标签（4-6字）。每段一行，不要编号。格式示例：
春天来了，花开草长。| 春景
若无法概括则用原文前30字作摘要，标签用「摘录」。`

/**
 * Attach shortSummary and optional tag to RAG items for structured AI context. Uses top RAG_SUMMARIZE_TOP_N.
 * On timeout or parse error returns items unchanged.
 */
export async function summarizeRagChunks(
  items: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
  signal?: AbortSignal,
): Promise<EchoItem[]> {
  if (!settings.apiKey || items.length === 0) return items
  const model = (settings.ribbonFilterModel || '').trim() || settings.model
  const toSummarize = items.slice(0, RAG_SUMMARIZE_TOP_N)
  const list = toSummarize
    .map((r, i) => `${i + 1}. ${((r.originalText ?? r.content ?? '').toString().trim().slice(0, 200).replace(/\n/g, ' '))}`)
    .join('\n')
  const userContent = `为以下每条片段输出一行：摘要（20-40字）| 标签（4-6字）。仅输出这些行，不要其他内容。\n\n${list}`

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
          { role: 'system', content: RAG_SUMMARIZE_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
      signal: withTimeout(signal, RAG_SUMMARIZE_TIMEOUT_MS),
    })
    if (!res.ok) return items

    const data = (await res.json()) as ChatCompletionResponse
    const raw = (data.choices?.[0]?.message?.content ?? '').trim()
    const lines = raw.split(/\n/).map((s) => s.trim()).filter(Boolean)

    const out = items.map((r, i) => {
      if (i >= toSummarize.length) return { ...r }
      const line = lines[i] ?? ''
      const [summary, tag] = line.split(/\s*\|\s*/).map((s) => s.trim().slice(0, 60))
      return {
        ...r,
        shortSummary: summary?.slice(0, 40) || undefined,
        tag: tag?.slice(0, 6) || undefined,
      }
    })
    return out
  } catch {
    return items
  }
}

/**
 * Correct RAG snippets via AI so they conform to normal text presentation.
 * Returns original items on API failure.
 */
export async function correctRagResultsForContext(
  items: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
  signal?: AbortSignal,
): Promise<EchoItem[]> {
  if (!settings.apiKey || items.length === 0) return items

  const model = (settings.ribbonFilterModel || '').trim() || settings.model
  const input = items
    .map((r) => (r.originalText ?? r.content ?? '').trim().slice(0, 300))
    .join('\n---\n')
  const userContent = `请校对以下片段：\n\n${input}`

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
          { role: 'system', content: RAG_CORRECT_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
      signal: withTimeout(signal, 8000),
    })
    if (!res.ok) return items

    const data = (await res.json()) as ChatCompletionResponse
    const raw = (data.choices?.[0]?.message?.content ?? '').trim()
    const corrected = raw.split(/\s*---\s*/).map((s) => s.trim()).filter(Boolean)

    if (corrected.length !== items.length) return items

    return items.map((r, i) => ({
      ...r,
      content: corrected[i].slice(0, 200),
      originalText: corrected[i],
    }))
  } catch {
    return items
  }
}

const RAG_CONTEXT_TOP_N = 6

function buildUserPromptByMode(
  context: string,
  ragResults: EchoItem[],
  mode: AIMode,
): string {
  const userContext = (context.slice(0, 800) || '').trim()
  const topRag = ragResults.slice(0, RAG_CONTEXT_TOP_N)
  const ragContext =
    topRag.length > 0
      ? `\n\n【资料】\n${topRag
          .map(
            (r, i) =>
              `【资料${i + 1}】来自《${(r.source ?? '共鸣库').trim()}》 ${(r.shortSummary ?? (r.originalText ?? r.content ?? '').trim().slice(0, 80))}`
          )
          .join('\n')}`
      : ''

  const baseContent = `用户正在写：\n${userContext}${ragContext}`
  const contextOnly = `用户正在写：\n${userContext}`

  switch (mode) {
    case 'polish':
      return `${baseContent}\n\n请针对上述文本的用词和表达提供润色建议。`
    case 'narrative':
      return `${baseContent}\n\n请针对上述文本的叙事结构和情节发展提供引导建议。`
    case 'quote':
      return `${baseContent}\n\n请推荐与上述主题相关的经典引文或类似表达。`
    case 'custom':
      // Custom with RAG fallback uses baseContent; otherwise context only
      return ragResults.length > 0 ? baseContent : contextOnly
    case 'imagery':
    default:
      return baseContent
  }
}

const RERANK_RAG_TOP_N = 10
const RERANK_TIMEOUT_MS = 2000

const RERANK_SYSTEM = `You are a relevance rater. Given a query and a list of text snippets, output one relevance score (0.0 to 1.0) per snippet, in order. Format: one line with space-separated scores, e.g. "0.7 0.3 0.9". No other text.`

/**
 * Rerank RAG candidates with a quick model call. Only reranks top RERANK_RAG_TOP_N;
 * finalScore = 0.5 * baseScore + 0.5 * rerankScore. On timeout or error returns candidates unchanged.
 */
export async function rerankRagCandidates(
  query: string,
  candidates: RagCandidate[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
): Promise<RagCandidate[]> {
  if (!settings.apiKey || candidates.length === 0) return candidates
  // If there is only 1 candidate, rerank is meaningless and just adds latency.
  if (candidates.length <= 1) {
    const baseMax = Math.max(...candidates.map((c) => c.baseScore), 1)
    return candidates.map((c) => ({ ...c, finalScore: c.baseScore / baseMax }))
  }
  const model = (settings.ribbonFilterModel || '').trim() || settings.model
  const toRerank = candidates.slice(0, RERANK_RAG_TOP_N)
  const list = toRerank
    .map((c, i) => `${i}. ${((c as EchoItem).originalText ?? (c as EchoItem).content ?? '').toString().slice(0, 150).replace(/\n/g, ' ')}`)
    .join('\n')
  const userContent = `Query: "${query.slice(0, 200)}"\n\nSnippets:\n${list}\n\nOutput ${toRerank.length} relevance scores (0.0-1.0), space-separated, in order:`

  const start = Date.now()
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
          { role: 'system', content: RERANK_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    })
    if (!res.ok) {
      devLog.push('ai', 'rerankRagCandidates API not ok', { status: res.status })
      return candidates
    }
    const data = (await res.json()) as ChatCompletionResponse
    const raw = (data.choices?.[0]?.message?.content ?? '').trim()
    const scores = raw.split(/\s+/).map((s) => Math.min(1, Math.max(0, parseFloat(s) || 0)))
    const elapsed = Date.now() - start
    devLog.push('ai', 'rerankRagCandidates done', { elapsedMs: elapsed, scoresCount: scores.length })

    const baseMax = Math.max(...candidates.map((c) => c.baseScore), 1)
    const withFinal = candidates.map((c, i) => {
      const baseNorm = c.baseScore / baseMax
      if (i >= toRerank.length) return { ...c, finalScore: baseNorm }
      const rerankScore = scores[i] ?? 0
      const finalScore = 0.5 * baseNorm + 0.5 * rerankScore
      return { ...c, finalScore }
    })
    const reranked = [...withFinal]
    reranked.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
    return reranked
  } catch (err) {
    const elapsed = Date.now() - start
    devLog.push('ai', 'rerankRagCandidates timeout or error', { elapsedMs: elapsed, err: (err as Error).message })
    return candidates
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
  signal?: AbortSignal,
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
      signal: withTimeout(signal, 3000),
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
  signal?: AbortSignal,
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
      signal: withTimeout(signal, 8000),
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
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(12000),
    })
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('请求超时，请重试')
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
  const choice = data.choices?.[0]
  const text = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason

  devLog.push('ai', 'generateEchoes response', {
    textLen: text.length,
    finishReason: finishReason ?? '(unknown)',
    truncated: finishReason === 'length',
    preview: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
  })

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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

export interface ModuleGenerationResult {
  items: EchoItem[]
  usedRag: boolean
  error?: string
}

/**
 * Generate echoes for a single ribbon module (AI mode or custom prompt by id).
 * Used when multiple modules are enabled; each module can be called independently.
 * Supports RAG fallback for custom modules.
 */
export async function generateEchoesForModule(
  context: string,
  ragResults: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
  module: { type: RibbonModuleType; id: string; prompt?: string; model?: string },
  blockId?: string,
  options?: { allowRagFallback?: boolean; skipRagPreprocess?: boolean; signal?: AbortSignal }
): Promise<ModuleGenerationResult> {
  // Support: ai:*, custom, quick types
  const isSupported = module.type.startsWith('ai:') || module.type === 'custom' || module.type === 'quick'
  if (!settings.apiKey || !isSupported) {
    return { items: [], usedRag: false, error: '模块不支持或未配置API' }
  }

  const systemPrompt = getSystemPromptForRibbonModule(module.type, module.id, module.prompt)
  const mode = ribbonTypeToAIMode(module.type)

  // For custom modules, try RAG context first if allowed
  let userContent: string
  let usedRag = false
  let ragForPrompt = ragResults

  if (module.type === 'quick') {
    // Quick modules don't use RAG results
    userContent = `当前文本：\n${context}\n\n请根据以上文本，直接给出你的回应。`
  } else if (ragResults.length > 0 && (module.type.startsWith('ai:') || (module.type === 'custom' && options?.allowRagFallback))) {
    // AI modules and custom (with RAG fallback): correct → summarize (for structured context) → build prompt
    usedRag = true
    const alreadySummarized = ragResults.every((r) => (r.shortSummary ?? '').trim().length > 0)
    if (!options?.skipRagPreprocess) {
      ragForPrompt = await correctRagResultsForContext(ragResults, settings, options?.signal)
      ragForPrompt = alreadySummarized ? ragForPrompt : await summarizeRagChunks(ragForPrompt, settings, options?.signal)
    } else {
      ragForPrompt = ragResults
    }
    userContent = buildUserPromptByMode(context, ragForPrompt, mode)
  } else {
    userContent = buildUserPromptByMode(context, ragResults, mode)
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  // Use module-specific model if set, otherwise fall back to global model
  const modelToUse = module.model?.trim() || settings.model
  const maxTokens =
    module.type === 'custom'
      ? 256
      : module.type === 'quick'
        ? 192
        : module.type === 'ai:quote'
          ? 192
          : 256

  const sourceLabel = getModuleDisplayLabel(module.type, module.id)
  const fetchStart = Date.now()

  // #region agent log
  fetch('http://127.0.0.1:7776/ingest/bd75bf12-cc2c-45c2-9d32-c1c193905a25',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'626617'},body:JSON.stringify({sessionId:'626617',location:'client-ai.service.ts:fetchStart',message:'generateEchoesForModule fetch start',data:{moduleId:module.id,sourceLabel,model:modelToUse},hypothesisId:'A',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  let res: Response
  try {
    res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        temperature: module.type === 'custom' ? 0.3 : 0.85,
        max_tokens: maxTokens,
      }),
      signal: withTimeout(options?.signal, 12000),
    })
  } catch (err) {
    const elapsed = Date.now() - fetchStart
    devLog.push('ai', `generateEchoesForModule [${sourceLabel}] fetch error`, {
      moduleId: module.id,
      errName: (err as Error)?.name,
      errMsg: (err as Error)?.message,
      elapsedMs: elapsed,
      isDOMException: err instanceof DOMException,
    })
    if (err instanceof DOMException) {
      if (err.name === 'TimeoutError') {
        throw new Error('请求超时，请重试')
      }
      if (err.name === 'AbortError') {
        throw new Error('请求被取消，请重试')
      }
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
  const choice = data.choices?.[0]
  const text = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason

  devLog.push('ai', `generateEchoesForModule [${sourceLabel}] response`, {
    moduleId: module.id,
    textLen: text.length,
    finishReason: finishReason ?? '(unknown)',
    truncated: finishReason === 'length',
    preview: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
  })

  if (text.length === 0) {
    devLog.push('ai', `generateEchoesForModule [${sourceLabel}] empty API response`, {
      moduleId: module.id,
    })
    return { items: [], usedRag, error: 'API返回空内容' }
  }

  const items = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .map((content, i) => ({
      id: `ai-${module.id}-${Date.now()}-${i}`,
      type: 'lit' as const,
      content,
      source: sourceLabel,
      blockId,
      createdAt: new Date().toISOString(),
    }))

  return { items, usedRag }
}
