/**
 * Sensory Zoom: expand vague sensory descriptions with micro-level details from RAG + optional LLM.
 * Trigger: user selects text and hits button or Alt+Z.
 */

import type { Settings } from '@/lib/settings-context'
import { generateCandidatesByViews } from '@/services/rag.service'
import type { EchoItem, RagCandidate } from '@/types'
import { devLog } from '@/lib/dev-log'

function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const hasV1 = base.endsWith('/v1')
  return hasV1 ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

const SENSORY_ZOOM_TIMEOUT_MS = 8000

const SENSORY_SYSTEM = `你是感官细节助手。用户选中了一句模糊的感官描写，并提供了若干知识库片段。请基于选中句和片段，生成3-5条「微观感官细节」：触觉、听觉、视觉、嗅觉等具体可感的描述。每条一行，20-40字，不要编号、不要解释。`

/**
 * Fetch RAG candidates for the selected phrase, then optionally synthesize sensory details via LLM.
 * On LLM timeout/failure returns RAG candidates as EchoItem[] (source: 感官放大).
 */
export async function expandSensoryZoom(
  selectedText: string,
  context: string,
  knowledgeBaseId: string,
  settings: Pick<Settings, 'apiKey' | 'baseUrl' | 'model' | 'ribbonFilterModel'>,
): Promise<EchoItem[]> {
  const query = selectedText.trim().slice(0, 300)
  if (!query) return []

  const candidates = await generateCandidatesByViews(query, { knowledgeBaseId })
  const ragItems: EchoItem[] = candidates.map(({ baseScore: _b, finalScore: _f, ...item }) => ({
    ...item,
    source: item.source ? `感官放大 · ${item.source}` : '感官放大',
  }))

  if (!settings.apiKey || candidates.length === 0) return ragItems

  const refs = candidates
    .slice(0, 5)
    .map((c) => (c.originalText ?? c.content ?? '').toString().trim().slice(0, 150))
    .join('\n')
  const userContent = `用户选中的句子：「${query}」\n\n上下文：${context.slice(0, 200)}\n\n知识库参考：\n${refs}\n\n请生成3-5条微观感官细节，每行一条：`

  try {
    const model = (settings.ribbonFilterModel || '').trim() || settings.model
    const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SENSORY_SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.6,
        max_tokens: 320,
      }),
      signal: AbortSignal.timeout(SENSORY_ZOOM_TIMEOUT_MS),
    })
    if (!res.ok) {
      devLog.push('sensory', 'expandSensoryZoom API not ok', { status: res.status })
      return ragItems
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = (data.choices?.[0]?.message?.content ?? '').trim()
    const lines = raw
      .split(/\n/)
      .map((s) => s.replace(/^\s*[\d、.]+\s*/, '').trim())
      .filter((s) => s.length > 0 && s.length <= 80)
      .slice(0, 5)
    if (lines.length === 0) return ragItems
    const now = new Date().toISOString()
    return lines.map((content, i) => ({
      id: `sensory-${Date.now()}-${i}`,
      type: 'lit' as const,
      content,
      source: '感官放大',
      createdAt: now,
      originalText: content,
    }))
  } catch (err) {
    devLog.push('sensory', 'expandSensoryZoom error', { err: (err as Error).message })
    return ragItems
  }
}
