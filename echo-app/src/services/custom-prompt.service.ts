/**
 * Custom Prompt Service
 * Manages user-defined system prompts for AI mode
 */

import { generateId } from '@/lib/utils/crypto'
import type { CustomPrompt } from '@/types'

const STORAGE_KEY = 'echo-custom-prompts'
const ACTIVE_PROMPT_ID_KEY = 'echo-active-custom-prompt-id'

const DEFAULT_PROMPTS: CustomPrompt[] = [
  {
    id: 'default-creative',
    name: '创意写作助手',
    description: '提供富有想象力的写作建议',
    content: `你是创意写作助手。基于用户正在写作的内容，提供3-5条富有想象力的建议。
规则：
- 每条建议不超过30字
- 不要编号、不要解释、不要开头语
- 直接输出建议，用换行分隔
- 聚焦：创意点子、情节转折、角色发展
- 风格：开放、启发性、富有想象力`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-poetry',
    name: '诗歌润色师',
    description: '专注诗歌的节奏和意象',
    content: `你是诗歌润色师。基于用户正在写作的内容，提供3-5条诗歌优化建议。
规则：
- 每条建议不超过25字
- 不要编号、不要解释、不要开头语
- 直接输出建议，用换行分隔
- 聚焦：韵律节奏、意象选择、修辞手法
- 风格：诗意、凝练、富有音乐感`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'default-academic',
    name: '学术写作顾问',
    description: '严谨的学术写作建议',
    content: `你是学术写作顾问。基于用户正在写作的内容，提供3-5条学术写作建议。
规则：
- 每条建议不超过35字
- 不要编号、不要解释、不要开头语
- 直接输出建议，用换行分隔
- 聚焦：论证逻辑、术语准确、结构清晰
- 风格：严谨、专业、客观`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

/**
 * Load all custom prompts from localStorage
 */
function loadPrompts(): CustomPrompt[] {
  if (typeof window === 'undefined') return DEFAULT_PROMPTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // First time: save default prompts
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PROMPTS))
      localStorage.setItem(ACTIVE_PROMPT_ID_KEY, DEFAULT_PROMPTS[0].id)
      return DEFAULT_PROMPTS
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_PROMPTS
    }
    return parsed
  } catch {
    return DEFAULT_PROMPTS
  }
}

/**
 * Save all prompts to localStorage
 */
function savePrompts(prompts: CustomPrompt[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts))
    window.dispatchEvent(new CustomEvent('custom-prompts-updated'))
  } catch {
    console.error('Failed to save custom prompts')
  }
}

/**
 * Get active prompt ID
 */
function getActivePromptId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(ACTIVE_PROMPT_ID_KEY)
  } catch {
    return null
  }
}

/**
 * Set active prompt ID
 */
function setActivePromptId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ACTIVE_PROMPT_ID_KEY, id)
    window.dispatchEvent(new CustomEvent('custom-prompts-updated'))
  } catch {
    console.error('Failed to set active prompt id')
  }
}

// ============================================
// Public API
// ============================================

/**
 * Get all custom prompts
 */
export function getAllPrompts(): CustomPrompt[] {
  return loadPrompts()
}

/**
 * Get a specific prompt by ID
 */
export function getPrompt(id: string): CustomPrompt | null {
  const prompts = loadPrompts()
  return prompts.find((p) => p.id === id) || null
}

/**
 * Get the currently active prompt
 */
export function getActivePrompt(): CustomPrompt | null {
  const activeId = getActivePromptId()
  if (!activeId) {
    const prompts = loadPrompts()
    return prompts[0] || null
  }
  return getPrompt(activeId)
}

/**
 * Set the active prompt
 */
export function setActivePrompt(id: string): boolean {
  const prompt = getPrompt(id)
  if (!prompt) return false
  setActivePromptId(id)
  return true
}

/**
 * Create a new custom prompt
 */
export function createPrompt(
  name: string,
  content: string,
  description?: string,
): CustomPrompt {
  const now = new Date().toISOString()
  const newPrompt: CustomPrompt = {
    id: generateId(),
    name: name.trim() || '未命名提示词',
    content: content.trim(),
    description: description?.trim(),
    createdAt: now,
    updatedAt: now,
  }

  const prompts = loadPrompts()
  prompts.push(newPrompt)
  savePrompts(prompts)

  // If this is the first prompt, set it as active
  if (prompts.length === 1) {
    setActivePromptId(newPrompt.id)
  }

  return newPrompt
}

/**
 * Update an existing prompt
 */
export function updatePrompt(
  id: string,
  updates: Partial<Omit<CustomPrompt, 'id' | 'createdAt'>>,
): CustomPrompt | null {
  const prompts = loadPrompts()
  const index = prompts.findIndex((p) => p.id === id)

  if (index === -1) return null

  prompts[index] = {
    ...prompts[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  savePrompts(prompts)
  return prompts[index]
}

/**
 * Delete a prompt
 */
export function deletePrompt(id: string): boolean {
  const prompts = loadPrompts()
  const index = prompts.findIndex((p) => p.id === id)

  if (index === -1) return false

  // Don't allow deleting if it's the only prompt
  if (prompts.length <= 1) {
    throw new Error('至少需要保留一个提示词')
  }

  prompts.splice(index, 1)
  savePrompts(prompts)

  // If deleted prompt was active, switch to first available
  const activeId = getActivePromptId()
  if (activeId === id && prompts.length > 0) {
    setActivePromptId(prompts[0].id)
  }

  return true
}

/**
 * Duplicate a prompt
 */
export function duplicatePrompt(id: string): CustomPrompt | null {
  const prompt = getPrompt(id)
  if (!prompt) return null

  return createPrompt(
    `${prompt.name} (复制)`,
    prompt.content,
    prompt.description,
  )
}

/**
 * Reset to default prompts
 */
export function resetToDefaults(): void {
  savePrompts(DEFAULT_PROMPTS)
  setActivePromptId(DEFAULT_PROMPTS[0].id)
}

/**
 * Export prompts to JSON string
 */
export function exportPrompts(): string {
  return JSON.stringify(loadPrompts(), null, 2)
}

/**
 * Import prompts from JSON string
 */
export function importPrompts(jsonString: string): boolean {
  try {
    const parsed = JSON.parse(jsonString)
    if (!Array.isArray(parsed)) return false

    // Validate structure
    const valid = parsed.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.content === 'string',
    )

    if (!valid) return false

    savePrompts(parsed)
    return true
  } catch {
    return false
  }
}

// ============================================
// Service Object
// ============================================

export const customPromptService = {
  getAll: getAllPrompts,
  get: getPrompt,
  getActive: getActivePrompt,
  setActive: setActivePrompt,
  create: createPrompt,
  update: updatePrompt,
  delete: deletePrompt,
  duplicate: duplicatePrompt,
  resetToDefaults,
  export: exportPrompts,
  import: importPrompts,
}
