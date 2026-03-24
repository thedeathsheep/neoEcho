import { devLog } from '@/lib/dev-log'
import type { Settings } from '@/lib/settings-context'
import { BUILTIN_RIBBON_MODULES } from '@/lib/settings-context'
import type { AIMode, EchoItem, RagCandidate } from '@/types'
import type { RibbonModuleType } from '@/types'
import type { WritingAssistKind, WritingAssistResult, WritingSuggestion } from '@/types'

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

export interface DetailGenerationResult {
  text: string
  usedRag: boolean
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

function debugIngest(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch('http://127.0.0.1:7776/ingest/bd75bf12-cc2c-45c2-9d32-c1c193905a25',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'626617'},body:JSON.stringify({sessionId:'626617',runId:'diag',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

export async function probeChatCompletions(
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; elapsedMs: number; status?: number; error?: string }> {
  const url = apiUrl(settings.baseUrl, '/chat/completions')
  const start = Date.now()
  try {
    debugIngest('H6', 'client-ai.service.ts:probeChatCompletions:start', 'probe start', {
      baseUrl: settings.baseUrl,
      model: settings.model,
      url,
    })
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: 'Return exactly: OK' },
          { role: 'user', content: 'OK' },
        ],
        temperature: 0,
        max_tokens: 1,
      }),
      signal: withTimeout(signal, 3000),
    })
    const elapsedMs = Date.now() - start
    debugIngest('H6', 'client-ai.service.ts:probeChatCompletions:res', 'probe response', {
      status: res.status,
      elapsedMs,
      ok: res.ok,
    })
    return { ok: res.ok, elapsedMs, status: res.status }
  } catch (e) {
    const elapsedMs = Date.now() - start
    debugIngest('H6', 'client-ai.service.ts:probeChatCompletions:catch', 'probe error', {
      elapsedMs,
      errName: (e as Error)?.name,
      errMsg: (e as Error)?.message,
      isDOMException: e instanceof DOMException,
    })
    return { ok: false, elapsedMs, error: (e as Error)?.message }
  }
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

function getCustomPromptOptions(id: string): {
  useRag: boolean
  ragFallback: boolean
  behavior: 'freeform' | 'term_list' | 'guided_terms' | 'entity_explain'
  content: string
  name: string
  description: string
} {
  const prompt = customPromptService.get(id)
  return {
    useRag: prompt?.useRag ?? false,
    ragFallback: prompt?.ragFallback ?? false,
    behavior: prompt?.behavior ?? 'freeform',
    content: prompt?.content?.trim() ?? '',
    name: prompt?.name?.trim() ?? '',
    description: prompt?.description?.trim() ?? '',
  }
}

function isParagraphOutputModule(module: { type: RibbonModuleType; id: string }): boolean {
  if (module.type !== 'custom') return false
  return customPromptService.get(module.id)?.outputShape === 'paragraph'
}

function isEntityExplanationModule(module: { type: RibbonModuleType; id: string; label?: string }): boolean {
  if (module.type !== 'custom') return false
  const prompt = customPromptService.get(module.id)
  return (prompt?.behavior ?? 'freeform') === 'entity_explain'
}

function isTermListModule(module: { type: RibbonModuleType; id: string; label?: string }): boolean {
  if (module.type !== 'custom') return false
  const prompt = customPromptService.get(module.id)
  return (prompt?.behavior ?? 'freeform') === 'term_list'
}

function isGuidedTermsModule(module: { type: RibbonModuleType; id: string; label?: string }): boolean {
  if (module.type !== 'custom') return false
  const prompt = customPromptService.get(module.id)
  return (prompt?.behavior ?? 'freeform') === 'guided_terms'
}

function isLongFormModule(module: { type: RibbonModuleType; id: string }, rawText: string): boolean {
  if (module.type !== 'custom') return false
  const prompt = customPromptService.get(module.id)
  if (prompt?.outputShape === 'paragraph') return true
  const normalized = rawText.trim()
  if (normalized.includes('\n\n')) return true
  return normalized.length >= 120
}

function makeRibbonSummary(text: string, maxLen: number = 54): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const firstParagraph = normalized.split(/\n{2,}/)[0]?.trim() ?? normalized
  const sentenceMatch = firstParagraph.match(/^(.{0,72}?[。！？.!?])/u)
  const base = (sentenceMatch?.[1] ?? firstParagraph).trim()
  if (base.length <= maxLen) return base

  const chunk = base.slice(0, maxLen)
  const boundary = Math.max(
    chunk.lastIndexOf('，'),
    chunk.lastIndexOf('。'),
    chunk.lastIndexOf('！'),
    chunk.lastIndexOf('？'),
    chunk.lastIndexOf(','),
    chunk.lastIndexOf('.'),
  )
  const clipped = boundary >= 18 ? chunk.slice(0, boundary + 1).trim() : chunk.trim()
  return `${clipped}...`
}

function buildModuleEchoItems(
  module: { type: RibbonModuleType; id: string; label?: string },
  sourceLabel: string,
  rawText: string,
  blockId?: string,
): EchoItem[] {
  const createdAt = new Date().toISOString()
  const moduleLabel = module.label?.trim() || sourceLabel
  const trimmed = rawText.trim()
  if (!trimmed) return []

  if (isLongFormModule(module, trimmed)) {
    const ribbonText = makeRibbonSummary(trimmed)
    if (!ribbonText) return []
    return [
      {
        id: `ai-${module.id}-${Date.now()}-0`,
        type: 'lit',
        content: ribbonText,
        ribbonText,
        detailText: trimmed,
        source: sourceLabel,
        moduleId: module.id,
        moduleLabel,
        blockId,
        createdAt,
      },
    ]
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .map((content, index) => ({
      id: `ai-${module.id}-${Date.now()}-${index}`,
      type: 'lit' as const,
      content,
      ribbonText: content,
      detailText: undefined,
      source: sourceLabel,
      moduleId: module.id,
      moduleLabel,
      blockId,
      createdAt,
    }))
}

function buildParagraphModuleUserPrompt(
  context: string,
  ragResults: EchoItem[],
  sourceLabel: string,
): string {
  const contextPreview = context.trim().slice(0, 700)
  const references = ragResults
    .slice(0, 3)
    .map((item, index) => {
      const snippet = (item.shortSummary ?? item.originalText ?? item.content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      return snippet ? `${index + 1}. ${snippet}` : ''
    })
    .filter(Boolean)
    .join('\n')

  return [
    `模块名称：${sourceLabel}`,
    contextPreview ? `当前写作片段：\n${contextPreview}` : '',
    references ? `可参考的相关材料：\n${references}` : '',
    '请输出严格 JSON，格式如下：',
    '{"ribbonText":"顶部织带摘要，不超过36字","detailText":"1-2段完整中文正文，总长度不超过220字"}',
    '要求：',
    '- ribbonText 必须短、稳、适合顶部织带单元展示',
    '- detailText 必须完整，但不要写成长篇，不要编号，不要标题',
    '- 只输出 JSON，不要解释，不要 markdown 代码块',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildEntityExplanationUserPrompt(context: string, sourceLabel: string): string {
  const contextPreview = context.trim().slice(0, 420)
  return [
    `模块名称：${sourceLabel}`,
    contextPreview ? `当前用户片段：\n${contextPreview}` : '',
    '请按照系统提示完成该模块任务。',
    '输出格式：',
    '{"ribbonText":"不超过24字的顶部摘要","detailText":"1段完整中文正文"}',
    '元规则：',
    '- ribbonText 适合顶部织带展示，保持简短',
    '- detailText 只输出正文，不要编号、标题或 markdown',
    '- 只输出 JSON，不要前后缀',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildTermListUserPrompt(context: string, sourceLabel: string): string {
  const contextPreview = context.trim().slice(0, 420)
  return [
    `模块名称：${sourceLabel}`,
    contextPreview ? `当前用户片段：\n${contextPreview}` : '',
    '请按照系统提示完成该模块任务。',
    '元规则：',
    '- 每行只输出一个词或短语',
    '- 每项尽量控制在 2-12 个字',
    '- 只输出结果列表，不要编号，不要解释，不要前后缀',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildGuidedTermsUserPrompt(context: string, sourceLabel: string): string {
  const contextPreview = context.trim().slice(0, 420)
  return [
    `模块名称：${sourceLabel}`,
    contextPreview ? `当前用户片段：\n${contextPreview}` : '',
    '请按照系统提示完成该模块任务。',
    '元规则：',
    '- 每行只输出一个词或短语',
    '- 每项尽量控制在 2-12 个字',
    '- 只输出结果列表，不要编号，不要解释，不要前后缀',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeTermListOutput(rawText: string): string {
  const lines = rawText
    .split('\n')
    .map((line) => line.replace(/^[\-\d\.\)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return lines.slice(0, 5).join('\n')
}

function normalizeGuidedTermsOutput(rawText: string): string {
  const lines = rawText
    .split('\n')
    .map((line) => line.replace(/^[\-\d\.\)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 8)

  return lines.slice(0, 5).join('\n')
}

function normalizeModuleOutputText(
  rawText: string,
  module: { type: RibbonModuleType; id: string; label?: string },
): string {
  if (isTermListModule(module)) {
    return normalizeTermListOutput(rawText)
  }
  if (isGuidedTermsModule(module)) {
    return normalizeGuidedTermsOutput(rawText)
  }
  return rawText
}

function buildBatchUserPromptForModule(
  context: string,
  ragForAi: EchoItem[],
  module: { type: RibbonModuleType; id: string; prompt?: string; model?: string; label?: string },
): string {
  const mode = ribbonTypeToAIMode(module.type)
  const customOptions = module.type === 'custom' ? getCustomPromptOptions(module.id) : null

  if (isTermListModule(module)) {
    return buildTermListUserPrompt(
      context,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  }

  if (isGuidedTermsModule(module)) {
    return buildGuidedTermsUserPrompt(
      context,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  }

  return buildUserPromptByMode(context, module.type === 'custom' && customOptions?.useRag ? ragForAi : [], mode)
}

export function canBatchGenerateEchoesForModule(
  module: { type: RibbonModuleType; id: string; prompt?: string; model?: string; label?: string },
): boolean {
  if (!(module.type.startsWith('ai:') || module.type === 'custom')) return false
  if ((module.model ?? '').trim().length > 0) return false
  if (module.type.startsWith('ai:')) return true

  const customOptions = getCustomPromptOptions(module.id)
  if (customOptions.useRag || customOptions.ragFallback) return false
  if (isParagraphOutputModule(module) || isEntityExplanationModule(module)) return false

  return true
}

function parseParagraphModuleResult(
  rawText: string,
  module: { type: RibbonModuleType; id: string; label?: string },
  sourceLabel: string,
  blockId?: string,
): EchoItem[] {
  const trimmed = rawText.trim()
  if (!trimmed) return []

  try {
    const jsonText = extractJsonBlock(trimmed)
    const parsed = JSON.parse(jsonText) as { ribbonText?: unknown; detailText?: unknown }
    const ribbonText = typeof parsed.ribbonText === 'string'
      ? parsed.ribbonText.trim().replace(/^实体词[:：]\s*/u, '')
      : ''
    const detailText = typeof parsed.detailText === 'string' ? parsed.detailText.trim() : ''
    const safeRibbon = ribbonText || makeRibbonSummary(detailText)
    const safeDetail = detailText || trimmed
    if (!safeRibbon) return []
    return [
      {
        id: `ai-${module.id}-${Date.now()}-0`,
        type: 'lit',
        content: safeRibbon,
        ribbonText: safeRibbon,
        detailText: safeDetail,
        source: sourceLabel,
        moduleId: module.id,
        moduleLabel: module.label?.trim() || sourceLabel,
        blockId,
        createdAt: new Date().toISOString(),
      },
    ]
  } catch {
    return buildModuleEchoItems(module, sourceLabel, trimmed, blockId)
  }
}

function buildDetailUserPrompt(
  item: EchoItem,
  context: string,
  referenceText?: string,
): string {
  const focus = (item.originalText ?? item.content ?? '').trim()
  const source = (item.source ?? '').trim()
  const contextPreview = context.trim().slice(0, 800)
  const referencePreview = (referenceText ?? '').trim().slice(0, 1200)

  return [
    '请围绕这条回声做解释或背景补充。',
    focus ? `回声内容：\n${focus}` : '',
    source ? `来源：${source}` : '',
    contextPreview ? `当前写作上下文：\n${contextPreview}` : '',
    referencePreview ? `可用参考：\n${referencePreview}` : '',
    '输出要求：',
    '- 输出 1-3 段完整中文正文',
    '- 不要编号、不要标题、不要项目符号',
    '- 重点解释概念、典故、语义或背景，而不是继续生成新的织带短句',
  ]
    .filter(Boolean)
    .join('\n\n')
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
export function getModuleDisplayLabel(type: RibbonModuleType, id: string, labelOverride?: string): string {
  if (labelOverride?.trim()) return labelOverride.trim()
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

function withDetailGuardrails(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  return `${trimmed}\n\n【详情解释输出约束】\n- 输出 1-3 段完整中文正文\n- 不要短句列表，不要编号，不要标题\n- 重点解释概念、出处、背景、典故或语义`
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
  const userContent = buildUserPromptByMode(context, [], mode)

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

export function normalizeDetailError(err: unknown): string {
  if (!(err instanceof Error)) return '解释生成失败'
  if (err.message === 'DETAIL_TIMEOUT') return '解释请求超时'
  if (err.message === 'DETAIL_ABORTED') return '解释请求已取消'
  return '解释生成失败'
}

export async function generateDetailForEcho(
  item: EchoItem,
  context: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  module: { id: string; prompt?: string; model?: string },
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<DetailGenerationResult> {
  if (!settings.apiKey) {
    return { text: '', usedRag: false }
  }

  const customPrompt = customPromptService.get(module.id)
  const systemPrompt = withDetailGuardrails(
    module.prompt?.trim() || customPrompt?.content?.trim() || DEFAULT_SYSTEM_PROMPTS.imagery,
  )
  const modelToUse = module.model?.trim() || settings.model
  const customOptions = getCustomPromptOptions(module.id)
  const sourceReference =
    customOptions.useRag && item.source !== 'AI'
      ? (item.detailText ?? item.originalText ?? item.content ?? '').trim()
      : ''

  const userContent = buildDetailUserPrompt(item, context, sourceReference)

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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 768,
      }),
      signal: withTimeout(options?.signal, options?.timeoutMs ?? 20_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('DETAIL_TIMEOUT')
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('DETAIL_ABORTED')
    }
    if (err instanceof TypeError) {
      throw new Error('NETWORK_ERROR')
    }
    throw err instanceof Error ? err : new Error('DETAIL_ERROR')
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('API_KEY_INVALID')
    if (res.status === 429) throw new Error('RATE_LIMITED')
    if (res.status >= 500) throw new Error('API_SERVER_ERROR')
    throw new Error(`API_ERROR_${res.status}`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const text = (data.choices?.[0]?.message?.content ?? '').trim()
  return {
    text,
    usedRag: Boolean(sourceReference),
  }
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
  module: { type: RibbonModuleType; id: string; prompt?: string; model?: string; label?: string },
  blockId?: string,
  options?: { allowRagFallback?: boolean; skipRagPreprocess?: boolean; signal?: AbortSignal; timeoutMs?: number }
): Promise<ModuleGenerationResult> {
  // Support: ai:*, custom, quick types
  const isSupported = module.type.startsWith('ai:') || module.type === 'custom' || module.type === 'quick'
  if (!settings.apiKey || !isSupported) {
    return { items: [], usedRag: false, error: '模块不支持或未配置API' }
  }

  const systemPrompt = getSystemPromptForRibbonModule(module.type, module.id, module.prompt)
  const mode = ribbonTypeToAIMode(module.type)
  const customOptions = module.type === 'custom' ? getCustomPromptOptions(module.id) : null
  const paragraphOutput = isParagraphOutputModule(module)

  // For custom modules, try RAG context first if allowed
  let userContent: string
  let usedRag = false
  let ragForPrompt: EchoItem[] = []

  if (module.type === 'quick') {
    // Quick modules don't use RAG results
    userContent = `当前文本：\n${context}\n\n请根据以上文本，直接给出你的回应。`
  } else if (isTermListModule(module)) {
    ragForPrompt = []
    userContent = buildTermListUserPrompt(
      context,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  } else if (isGuidedTermsModule(module)) {
    ragForPrompt = []
    userContent = buildGuidedTermsUserPrompt(
      context,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  } else if (paragraphOutput && isEntityExplanationModule(module)) {
    ragForPrompt = []
    userContent = buildEntityExplanationUserPrompt(
      context,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  } else if (paragraphOutput) {
    if (ragResults.length > 0 && customOptions?.useRag) {
      usedRag = true
      const alreadySummarized = ragResults.every((r) => (r.shortSummary ?? '').trim().length > 0)
      ragForPrompt = alreadySummarized
        ? ragResults
        : await summarizeRagChunks(ragResults, settings, options?.signal)
    } else {
      ragForPrompt = []
    }
    userContent = buildParagraphModuleUserPrompt(
      context,
      ragForPrompt,
      getModuleDisplayLabel(module.type, module.id, module.label),
    )
  } else if (
    ragResults.length > 0 &&
    module.type === 'custom' &&
    (
      customOptions?.useRag ||
      (options?.allowRagFallback && customOptions?.ragFallback)
    )
  ) {
    // Custom modules opt into RAG explicitly; built-in AI modules default to user-context-only prompts.
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
    userContent = buildUserPromptByMode(context, [], mode)
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  // Use module-specific model if set, otherwise fall back to global model
  const modelToUse = module.model?.trim() || settings.model
  const maxTokens =
    module.type === 'custom'
      ? (paragraphOutput ? 240 : 320)
      : module.type === 'quick'
        ? 192
        : module.type === 'ai:quote'
          ? 192
          : 256

  const sourceLabel = getModuleDisplayLabel(module.type, module.id, module.label)
  const fetchStart = Date.now()

  debugIngest('H1', 'client-ai.service.ts:generateEchoesForModule:start', 'chat.completions start', {
    moduleId: module.id,
    sourceLabel,
    type: module.type,
    baseUrl: settings.baseUrl,
    url: apiUrl(settings.baseUrl, '/chat/completions'),
    model: modelToUse,
    systemPromptLen: systemPrompt.length,
    userContentLen: userContent.length,
    maxTokens,
    hasRag: ragResults.length > 0,
    ragCount: ragResults.length,
    signalProvided: !!options?.signal,
  })

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
        temperature: module.type === 'custom' ? (paragraphOutput ? 0.2 : 0.3) : 0.85,
        max_tokens: maxTokens,
      }),
      signal: withTimeout(options?.signal, options?.timeoutMs ?? 12000),
    })
  } catch (err) {
    const elapsed = Date.now() - fetchStart
    debugIngest('H1', 'client-ai.service.ts:generateEchoesForModule:catch', 'chat.completions error', {
      moduleId: module.id,
      sourceLabel,
      type: module.type,
      baseUrl: settings.baseUrl,
      url: apiUrl(settings.baseUrl, '/chat/completions'),
      model: modelToUse,
      elapsedMs: elapsed,
      errName: (err as Error)?.name,
      errMsg: (err as Error)?.message,
      isDOMException: err instanceof DOMException,
    })
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
  debugIngest('H1', 'client-ai.service.ts:generateEchoesForModule:ok', 'chat.completions ok', {
    moduleId: module.id,
    sourceLabel,
    type: module.type,
    model: modelToUse,
    status: res.status,
    elapsedMs: Date.now() - fetchStart,
    textLen: text.length,
    finishReason: finishReason ?? '(unknown)',
  })

  if (text.length === 0) {
    devLog.push('ai', `generateEchoesForModule [${sourceLabel}] empty API response`, {
      moduleId: module.id,
    })
    return { items: [], usedRag, error: 'API返回空内容' }
  }

  const normalizedText = normalizeModuleOutputText(text, module)

  devLog.push('ai', `generateEchoesForModule [${sourceLabel}] response`, {
    moduleId: module.id,
    textLen: text.length,
    finishReason: finishReason ?? '(unknown)',
    truncated: finishReason === 'length',
    preview: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
    normalizedPreview: normalizedText.slice(0, 120) + (normalizedText.length > 120 ? '…' : ''),
    normalizedEmpty: normalizedText.trim().length === 0,
  })

  if (normalizedText.trim().length === 0) {
    return { items: [], usedRag }
  }

  const items = paragraphOutput
    ? parseParagraphModuleResult(normalizedText, module, sourceLabel, blockId)
    : buildModuleEchoItems(module, sourceLabel, normalizedText, blockId)

  return { items, usedRag }
}

/**
 * Batch generate ribbon items for multiple modules in one chat request.
 *
 * Notes:
 * - Intended for `ai:*` + `custom` modules (quick modules are excluded).
 * - For `custom` modules we follow the existing non-RAG path: do NOT inject RAG context.
 * - For `ai:*` modules we inject the provided `ragForAi`.
 * - Output is strict JSON to keep parsing reliable.
 */
export async function generateBatchEchoesForModules(
  context: string,
  ragForAi: EchoItem[],
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
  modules: Array<{ type: RibbonModuleType; id: string; prompt?: string; model?: string; label?: string }>,
  blockId?: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ byModuleId: Record<string, EchoItem[]> }> {
  const apiKey = settings.apiKey
  if (!apiKey || modules.length === 0) return { byModuleId: {} }

  const allowedModules = modules.filter((m) => canBatchGenerateEchoesForModule(m))
  if (allowedModules.length === 0) return { byModuleId: {} }

  const maxTokens = Math.min(2048, Math.max(512, allowedModules.length * 400))
  const timeoutMs = options?.timeoutMs ?? 12_000

  const moduleSections = allowedModules
    .map((m) => {
      const sourceLabel = getModuleDisplayLabel(m.type, m.id, m.label)
      const systemPrompt = getSystemPromptForRibbonModule(m.type, m.id, m.prompt)
      const userPrompt = buildBatchUserPromptForModule(context, ragForAi, m)

      // The model must follow "module-specific system prompt + user prompt" inside this section.
      return `MODULE_ID: ${m.id}
MODULE_TYPE: ${m.type}
MODULE_SOURCE_LABEL: ${sourceLabel}
MODULE_SYSTEM_PROMPT:
${systemPrompt}
MODULE_USER_PROMPT:
${userPrompt}`
    })
    .join('\n\n')

  const outputSchema = `Output ONLY valid JSON:
{
  "results": {
    "<moduleId>": ["line1", "line2", "line3", "line4", "line5"]
  }
}
Rules:
- keys must be moduleIds exactly as provided (strings)
- arrays must contain 0-5 strings
- each string must be a single short line (no numbering, no extra explanations)
- do not wrap JSON in markdown fences`

  const start = Date.now()
  const res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: 'You generate multi-module ribbon items.' },
        {
          role: 'user',
          content:
            `You will be given module sections. Each module section includes a module-specific system prompt and a module-specific user prompt.\n` +
            `Follow each module section independently and output results only in the JSON schema.\n\n` +
            moduleSections +
            '\n\n' +
            outputSchema,
        },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
    }),
    signal: withTimeout(options?.signal, timeoutMs),
  })

  const elapsedMs = Date.now() - start
  devLog.push('ai', 'generateBatchEchoesForModules response', {
    elapsedMs,
    modulesCount: allowedModules.length,
    status: res.status,
  })

  if (!res.ok) {
    throw new Error(`API request failed (${res.status})`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const raw = (data.choices?.[0]?.message?.content ?? '').trim()

  const extractJson = (s: string): string => {
    const startIdx = s.indexOf('{')
    const endIdx = s.lastIndexOf('}')
    if (startIdx >= 0 && endIdx > startIdx) return s.slice(startIdx, endIdx + 1)
    return s
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch {
    devLog.push('ai', 'generateBatchEchoesForModules JSON parse failed', {
      preview: raw.slice(0, 120),
    })
    throw new Error('batch parse failed')
  }

  const byModuleId: Record<string, EchoItem[]> = {}
  const results = (parsed as { results?: Record<string, unknown> }).results
  if (!results || typeof results !== 'object') {
    throw new Error('batch parse failed')
  }

  for (let i = 0; i < allowedModules.length; i++) {
    const m = allowedModules[i]
    const arr = (results as Record<string, unknown>)[m.id]
    const lines = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').map((x) => (x as string).trim()) : []
    const rawText = lines.filter((x) => x.length > 0).slice(0, 5).join('\n')

    const sourceLabel = getModuleDisplayLabel(m.type, m.id, m.label)
    const normalizedText = normalizeModuleOutputText(rawText, m)

    devLog.push('ai', `generateBatchEchoesForModules [${sourceLabel}] response`, {
      moduleId: m.id,
      textLen: rawText.length,
      normalizedPreview: normalizedText.slice(0, 120) + (normalizedText.length > 120 ? '…' : ''),
      normalizedEmpty: normalizedText.trim().length === 0,
    })

    byModuleId[m.id] = normalizedText.trim().length === 0
      ? []
      : buildModuleEchoItems(m, sourceLabel, normalizedText, blockId)
  }

  return { byModuleId }
}

function extractJsonBlock(raw: string): string {
  const startIdx = raw.indexOf('{')
  const endIdx = raw.lastIndexOf('}')
  if (startIdx >= 0 && endIdx > startIdx) return raw.slice(startIdx, endIdx + 1)
  return raw
}

function normalizeWritingSuggestions(value: unknown): WritingSuggestion[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const text = item.trim()
        return text
          ? {
              id: `fallback-${index}`,
              title: text.slice(0, 18),
              detail: text,
              severity: 'watch' as const,
            }
          : null
      }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title.trim() : ''
      const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
      const tag = typeof record.tag === 'string' ? record.tag.trim() : undefined
      const severity = record.severity === 'gentle' || record.severity === 'watch' || record.severity === 'strong'
        ? record.severity
        : undefined
      if (!title && !detail) return null
      return {
        id: `suggestion-${index}-${title || detail}`.slice(0, 64),
        title: title || detail.slice(0, 18),
        detail: detail || title,
        tag,
        severity,
      }
    })
    .filter((item): item is WritingSuggestion => item != null)
}

function localRevisionRadar(context: string): WritingSuggestion[] {
  const text = context.replace(/\s+/g, ' ').trim()
  if (!text) return []

  const suggestions: WritingSuggestion[] = []
  const repeated = new Map<string, number>()
  const words = text.match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z]{4,}/g) ?? []
  for (const word of words) {
    repeated.set(word, (repeated.get(word) ?? 0) + 1)
  }
  const topRepeated = [...repeated.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])[0]

  if (topRepeated) {
    suggestions.push({
      id: 'local-repeat',
      title: '重复意象偏多',
      detail: `“${topRepeated[0]}”在这一段里反复出现，试着换成动作、触感或具体物件来分担表达。`,
      tag: '重复',
      severity: 'watch',
    })
  }

  const longSentence = text.split(/[。！？!?]/).find((sentence) => sentence.trim().length >= 70)
  if (longSentence) {
    suggestions.push({
      id: 'local-rhythm',
      title: '句势略长',
      detail: '这一段里有长句拖住节奏，可以拆成两拍：先动作，再感受或判断。',
      tag: '节奏',
      severity: 'gentle',
    })
  }

  const abstractWordCount = ['感觉', '情绪', '命运', '孤独', '温柔', '痛苦', '悲伤', '美好', '复杂']
    .reduce((sum, word) => sum + (text.match(new RegExp(word, 'g'))?.length ?? 0), 0)
  if (abstractWordCount >= 2) {
    suggestions.push({
      id: 'local-abstract',
      title: '抽象词略密',
      detail: '这段更像在概括情绪。可以补一个可见动作、环境细节或身体反应，把情绪落地。',
      tag: '落地',
      severity: 'watch',
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: 'local-keep',
      title: '先看转折点',
      detail: '这一段表面上比较平稳，可以检查是否缺一个更明确的转折、阻力或意外信息。',
      tag: '结构',
      severity: 'gentle',
    })
  }

  return suggestions.slice(0, 4)
}

async function requestWritingAssist(
  kind: WritingAssistKind,
  title: string,
  systemPrompt: string,
  userPrompt: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: { signal?: AbortSignal; timeoutMs?: number; referenceLabel?: string; fallbackItems?: WritingSuggestion[] },
): Promise<WritingAssistResult> {
  const fallbackItems = options?.fallbackItems ?? []
  if (!settings.apiKey) {
    return {
      kind,
      title,
      items: fallbackItems,
      referenceLabel: options?.referenceLabel,
      createdAt: new Date().toISOString(),
    }
  }

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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 900,
      }),
      signal: withTimeout(options?.signal, options?.timeoutMs ?? 18_000),
    })
  } catch (err) {
    if (fallbackItems.length > 0) {
      return {
        kind,
        title,
        items: fallbackItems,
        referenceLabel: options?.referenceLabel,
        createdAt: new Date().toISOString(),
      }
    }
    throw err
  }

  if (!res.ok) {
    if (fallbackItems.length > 0) {
      return {
        kind,
        title,
        items: fallbackItems,
        referenceLabel: options?.referenceLabel,
        createdAt: new Date().toISOString(),
      }
    }
    if (res.status === 401 || res.status === 403) throw new Error('API_KEY_INVALID')
    if (res.status === 429) throw new Error('RATE_LIMITED')
    throw new Error(`API_ERROR_${res.status}`)
  }

  const data = (await res.json()) as ChatCompletionResponse
  const raw = (data.choices?.[0]?.message?.content ?? '').trim()

  let parsed: { summary?: string; items?: unknown } | null = null
  try {
    parsed = JSON.parse(extractJsonBlock(raw)) as { summary?: string; items?: unknown }
  } catch {
    const lineItems = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4)
    return {
      kind,
      title,
      items: normalizeWritingSuggestions(lineItems),
      referenceLabel: options?.referenceLabel,
      createdAt: new Date().toISOString(),
    }
  }

  const items = normalizeWritingSuggestions(parsed?.items)
  return {
    kind,
    title,
    summary: typeof parsed?.summary === 'string' ? parsed.summary.trim() : undefined,
    items: items.length > 0 ? items : fallbackItems,
    referenceLabel: options?.referenceLabel,
    createdAt: new Date().toISOString(),
  }
}

export async function generateRevisionRadar(
  context: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<WritingAssistResult> {
  const trimmed = context.trim().slice(0, 1800)
  const fallbackItems = localRevisionRadar(trimmed)
  return requestWritingAssist(
    'revision_radar',
    '修改雷达',
    `你是文学写作的修订诊断器。你的任务不是代写，而是找出最值得改的 2-4 个问题点。
输出 ONLY JSON:
{"summary":"一句总判断","items":[{"title":"问题名","detail":"指出问题并给一个修改方向","tag":"2-4字标签","severity":"gentle|watch|strong"}]}
规则：
- 只说问题定位和修改方向，不给成稿
- 优先关注重复、抽象空泛、顺序混乱、节奏拖慢、人物标签化
- 每条 detail 控制在 40 字以内`,
    `当前文本：
${trimmed}

请给我短、准、低侵入的修订提醒。`,
    settings,
    { ...options, fallbackItems },
  )
}

export async function generatePlotProgression(
  context: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
    referenceText?: string
    referenceLabel?: string
    sceneTitle?: string
    sceneSummary?: string
    sceneGoal?: string
    sceneTension?: string
  },
): Promise<WritingAssistResult> {
  const trimmed = context.trim().slice(0, 1800)
  const referenceText = options?.referenceText?.trim().slice(0, 900) ?? ''
  const sceneContext = [
    options?.sceneTitle ? `场景标题：${options.sceneTitle.trim()}` : '',
    options?.sceneSummary ? `场景摘要：${options.sceneSummary.trim().slice(0, 220)}` : '',
    options?.sceneGoal ? `场景目标：${options.sceneGoal.trim().slice(0, 120)}` : '',
    options?.sceneTension ? `当前张力：${options.sceneTension.trim().slice(0, 120)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return requestWritingAssist(
    'plot',
    '结构诊断',
    `你是结构诊断器。你只指出当前场景的结构问题与推进缺口，不写正文，不代写。
输出 ONLY JSON:
{"summary":"一句判断","items":[{"title":"结构提醒","detail":"指出节奏、转折、冲突或信息顺序的问题","tag":"2-4字标签","severity":"gentle|watch|strong"}]}
规则：
- 给 2-4 条短反馈
- 优先看节奏、转折、冲突、信息顺序、揭示时机
- 不直接续写，只指出结构上哪里还不稳、可以往哪补
- detail 控制在 36 字以内`,
    [
      sceneContext ? `当前场景卡：\n${sceneContext}` : '',
      `当前场景：\n${trimmed}`,
      referenceText ? `可参考的互文材料：\n${referenceText}` : '',
      '请给出能直接进入修订或场景卡的短反馈，不要重复当前段落。',
    ].filter(Boolean).join('\n\n'),
    settings,
    { ...options, referenceLabel: options?.referenceLabel },
  )
}

export async function generateCharacterConsistency(
  context: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
    referenceText?: string
    referenceLabel?: string
    sceneTitle?: string
    sceneSummary?: string
    sceneGoal?: string
    sceneTension?: string
  },
): Promise<WritingAssistResult> {
  const trimmed = context.trim().slice(0, 1800)
  const referenceText = options?.referenceText?.trim().slice(0, 1200) ?? ''
  const sceneContext = [
    options?.sceneTitle ? `场景标题：${options.sceneTitle.trim()}` : '',
    options?.sceneSummary ? `场景摘要：${options.sceneSummary.trim().slice(0, 220)}` : '',
    options?.sceneGoal ? `场景目标：${options.sceneGoal.trim().slice(0, 120)}` : '',
    options?.sceneTension ? `场景张力：${options.sceneTension.trim().slice(0, 120)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return requestWritingAssist(
    'character',
    '人物一致性提醒',
    `你是人物一致性提醒器。你只指出可能漂移的地方，不做续写。
输出 ONLY JSON:
{"summary":"一句判断","items":[{"title":"提醒点","detail":"指出哪里可能失真或缺动机","tag":"2-4字标签","severity":"gentle|watch|strong"}]}
规则：
- 如果信息不足，也可以提醒“动机还不够显”
- 优先看语气、行为、目标、关系反应是否突然跳变
- 每条 detail 控制在 36 字以内`,
    [
      sceneContext ? `当前场景卡：\n${sceneContext}` : '',
      `当前文本：\n${trimmed}`,
      referenceText ? `人物或互文参考：\n${referenceText}` : '',
      '请围绕当前场景给我 1-3 条短提醒，不要给成稿。',
    ].filter(Boolean).join('\n\n'),
    settings,
    { ...options, referenceLabel: options?.referenceLabel },
  )
}

export async function generateImitationDrill(
  context: string,
  referenceText: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: { signal?: AbortSignal; timeoutMs?: number; referenceLabel?: string },
): Promise<WritingAssistResult> {
  const trimmed = context.trim().slice(0, 1400)
  const reference = referenceText.trim().slice(0, 1200)
  return requestWritingAssist(
    'imitation',
    '仿写陪练',
    `你是仿写陪练教练。你的任务是拆解写法，不提供答案正文。
输出 ONLY JSON:
{"summary":"一句判断","items":[{"title":"观察点","detail":"说明可以练什么、怎么练","tag":"2-4字标签","severity":"gentle|watch|strong"}]}
规则：
- 只输出观察点、拆解点和练习方向
- 不要直接写示范段落
- 优先观察节奏、视角、句法、意象组织、信息推进
- 每条 detail 控制在 40 字以内`,
    `当前文本：
${trimmed}

参考片段：
${reference}

请做成 2-4 条可练习的观察点。`,
    settings,
    { ...options, referenceLabel: options?.referenceLabel },
  )
}

export async function generateSceneMemoryMap(
  context: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model'>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
    sceneTitle?: string
    sceneSummary?: string
    sceneGoal?: string
    sceneTension?: string
    referenceText?: string
    referenceLabel?: string
  },
): Promise<WritingAssistResult> {
  const trimmed = context.trim().slice(0, 1800)
  const referenceText = options?.referenceText?.trim().slice(0, 1000) ?? ''
  const sceneContext = [
    options?.sceneTitle ? `场景标题：${options.sceneTitle.trim()}` : '',
    options?.sceneSummary ? `场景摘要：${options.sceneSummary.trim().slice(0, 220)}` : '',
    options?.sceneGoal ? `场景目标：${options.sceneGoal.trim().slice(0, 120)}` : '',
    options?.sceneTension ? `场景张力：${options.sceneTension.trim().slice(0, 120)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return requestWritingAssist(
    'memory_map',
    '作者记忆提炼',
    `你是作者记忆提炼器。你的任务是从当前场景里提炼可长期保留的记忆节点，不写正文。
输出 ONLY JSON:
{"summary":"一句总判断","items":[{"title":"记忆节点名","detail":"说明它为什么值得记住","tag":"人物|关系|母题|意象|时间线","severity":"gentle|watch|strong"}]}
规则：
- 给 3-6 条记忆节点
- 节点必须是可以长期回看的内容，不是临时润色建议
- 优先提炼人物、人物关系、母题、意象、时间线线索
- detail 控制在 32 字以内
- tag 只能是：人物、关系、母题、意象、时间线`,
    [
      sceneContext ? `当前场景卡：\n${sceneContext}` : '',
      `当前场景正文：\n${trimmed}`,
      referenceText ? `互文或参考：\n${referenceText}` : '',
      '请提炼出适合进入作者记忆图谱的节点。',
    ].filter(Boolean).join('\n\n'),
    settings,
    { ...options, referenceLabel: options?.referenceLabel },
  )
}
