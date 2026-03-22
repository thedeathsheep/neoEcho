/**
 * Flow history (echoes) persistence per document (localStorage).
 * Enables "心流回溯" — restore echoes when reopening a document.
 */

import type { EchoItem } from '@/types'

const PREFIX = 'echo-flow:'
const MAX_ECHOES = 200

const LEGACY_CONTENT = new Set([
  // 早期测试/原型内容
  '虚饰的宁静',
  '某种不可逆的损毁',
  '或许这一切都是他的一厢情愿',
  '被折叠的时间',
  '我们并不能完全相信',
  '他有危险了。',
  '冷光的反射',
  '被遗忘的锚点',
  '潜意识的暗流',
  '某种必然的偏离',
  '虚构的记忆',
  '镜子使人的数目倍增',
  '所有的镜子都是危险的，因为它们使人的数目倍增。',
  '三月萌蘖，叶如张掌，脉络经霜而赤。',
  // 常见的AI生成示例内容（从用户截图中发现）
  '月光在窗台上碎成银币',
  '心跳是未寄出的情书',
  '沉默比告白更接近真相',
  '雨滴在玻璃上画出迷宫',
  '尝试寻找更精准的名词',
  '意识流转换的契机',
  '心跳在寂静中回响',
  '未寄出的信封在抽屉里泛黄',
  '影子在月光下悄悄重叠',
  '影子在月光下练习拥抱',
  '月光在湖面碎成千万片银币',
  '未寄出的情书',
  '雨滴在窗上画出迷宫',
  '对视时，时间开始融化',
])

function storageKey(documentId: string) {
  return `${PREFIX}${documentId}`
}

function normalizeEchoText(item: EchoItem): string {
  return (item.ribbonText ?? item.originalText ?? item.content ?? '')
    .trim()
    .toLowerCase()
    .replace(/[：:，,。！？；、“”"'‘’（）()\[\]【】《》〈〉\-\s]/g, '')
    .slice(0, 120)
}

function characterBigramSet(text: string): Set<string> {
  if (text.length <= 1) return new Set(text ? [text] : [])
  const grams = new Set<string>()
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.add(text.slice(index, index + 2))
  }
  return grams
}

function isNearDuplicate(a: EchoItem, b: EchoItem): boolean {
  const aModule = (a.moduleId ?? a.source ?? 'Echo').trim()
  const bModule = (b.moduleId ?? b.source ?? 'Echo').trim()
  if (aModule !== bModule) return false

  const aText = normalizeEchoText(a)
  const bText = normalizeEchoText(b)
  if (!aText || !bText) return false
  if (aText === bText) return true

  const longer = Math.max(aText.length, bText.length)
  const shorter = Math.min(aText.length, bText.length)
  const similarLength = shorter / longer >= 0.82

  if (similarLength && (aText.includes(bText) || bText.includes(aText))) return true
  if (similarLength && aText.slice(0, 12) && aText.slice(0, 12) === bText.slice(0, 12)) return true

  const aGrams = characterBigramSet(aText)
  const bGrams = characterBigramSet(bText)
  let overlap = 0
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap += 1
  }
  const union = aGrams.size + bGrams.size - overlap
  if (union <= 0) return false
  return similarLength && overlap / union >= 0.9
}

function isLegacy(item: EchoItem): boolean {
  // 完全匹配
  if (LEGACY_CONTENT.has(item.content)) return true
  // 包含关键词检测（部分匹配）
  const legacyKeywords = [
    '三月萌蘖',
    '博尔赫斯',
    '镜子使人的数目倍增',
    '月光在窗台',
    '心跳是未寄出',
    '沉默比告白',
    '雨滴在玻璃',
    '雨滴在窗上',
    '意识流转换',
    '影子在月光下',
    '未寄出的信封',
    '未寄出的情书',
  ]
  return legacyKeywords.some(keyword => item.content.includes(keyword))
}

export const flowHistory = {
  load(documentId: string): EchoItem[] {
    if (typeof window === 'undefined') return []
    try {
      const k = storageKey(documentId)
      const raw = localStorage.getItem(k)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []

      const clean = parsed.filter((item: EchoItem) => !isLegacy(item))

      if (clean.length === 0) {
        localStorage.removeItem(k)
      } else if (clean.length !== parsed.length) {
        localStorage.setItem(k, JSON.stringify(clean))
      }

      return clean
    } catch {
      return []
    }
  },

  save(documentId: string, echoes: EchoItem[]): void {
    if (typeof window === 'undefined') return
    try {
      const trimmed = echoes.slice(0, MAX_ECHOES)
      localStorage.setItem(storageKey(documentId), JSON.stringify(trimmed))
    } catch {
      // ignore
    }
  },

  append(documentId: string, newEchoes: EchoItem[], existing: EchoItem[]): EchoItem[] {
    const seen = new Set<string>()
    const merged = [...newEchoes, ...existing].filter((item) => {
      const moduleKey = (item.moduleId ?? item.source ?? 'Echo').trim()
      const textKey = (item.ribbonText ?? item.originalText ?? item.content ?? '').trim().toLowerCase().slice(0, 160)
      const key = `${moduleKey}:${textKey}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const deduped: EchoItem[] = []
    for (const item of merged) {
      if (deduped.some((existingItem) => isNearDuplicate(existingItem, item))) continue
      deduped.push(item)
    }
    this.save(documentId, deduped)
    return deduped
  },
}
