/**
 * Lightweight cliche detection for stylistic entropy.
 * Returns phrase matches within the current paragraph.
 */

const CLICHE_PHRASES = [
  '心如刀割',
  '如释重负',
  '时间仿佛静止',
  '时间像是静止',
  '心跳如鼓',
  '泪如雨下',
  '目瞪口呆',
  '恍然大悟',
  '惊涛骇浪',
  '心里掀起了惊涛骇浪',
  '空气仿佛凝固',
  '热血沸腾',
  '心灰意冷',
  '心旷神怡',
  '心有余悸',
  '心如止水',
  '心照不宣',
  '心猿意马',
  '一见钟情',
  '刻骨铭心',
  '挥之不去',
  '历历在目',
  '记忆犹新',
  '难以忘怀',
  '情不自禁',
  '不由自主',
  '不知不觉',
  '说不出的',
  '莫名的',
  '一股暖流',
  '一股寒意',
  '一股酸楚',
  '涌上心头',
  '浮现在脑海',
  '浮现在眼前',
  '在脑海中浮现',
  '仿佛时间',
  '仿佛世界',
  '世界仿佛',
  '像一道光',
  '像一盆冷水',
  '晴天霹雳',
  '五雷轰顶',
  '当头棒喝',
  '醍醐灌顶',
  '如梦初醒',
  '茅塞顿开',
]

export interface ClicheMatch {
  start: number
  end: number
  phrase: string
}

const CLICHE_PATTERNS = CLICHE_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'),
}))

function normalizeForDetection(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, '')
}

export function detectCliches(paragraph: string): ClicheMatch[] {
  const text = normalizeForDetection(paragraph.trim())
  if (text.length < 2) return []

  const matches: ClicheMatch[] = []
  const seen = new Set<string>()

  for (const { phrase, pattern } of CLICHE_PATTERNS) {
    if (phrase.length < 2) continue

    pattern.lastIndex = 0
    for (const result of text.matchAll(pattern)) {
      const position = result.index ?? -1
      if (position < 0) continue
      const key = `${position}-${position + phrase.length}`
      if (!seen.has(key)) {
        seen.add(key)
        matches.push({
          start: position,
          end: position + phrase.length,
          phrase,
        })
      }
    }
  }

  return matches.sort((left, right) => left.start - right.start)
}
