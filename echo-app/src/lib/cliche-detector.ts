/**
 * Lightweight cliché detection for stylistic entropy. Returns spans (start, end, phrase) in paragraph text.
 */

const CLICHE_PHRASES = [
  '心如刀绞',
  '如释重负',
  '时间仿佛静止',
  '心跳如鼓',
  '泪如雨下',
  '目瞪口呆',
  '恍然大悟',
  '心潮澎湃',
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
  '历历在目',
  '仿佛时间',
  '仿佛世界',
  '世界仿佛',
  '时间仿佛',
  '像一道光',
  '像一盆冷水',
  '晴天霹雳',
  '五雷轰顶',
  '当头棒喝',
  '醍醐灌顶',
  '如梦初醒',
  '恍然大悟',
  '茅塞顿开',
]

export interface ClicheMatch {
  start: number
  end: number
  phrase: string
}

/**
 * Find cliché phrases in paragraph text. Returns matches with byte-offset-like positions (char indices).
 */
export function detectCliches(paragraph: string): ClicheMatch[] {
  const text = paragraph.trim()
  if (text.length < 2) return []
  const matches: ClicheMatch[] = []
  const seen = new Set<string>()
  for (const phrase of CLICHE_PHRASES) {
    if (phrase.length < 2) continue
    let idx = 0
    for (;;) {
      const pos = text.indexOf(phrase, idx)
      if (pos === -1) break
      const key = `${pos}-${pos + phrase.length}`
      if (!seen.has(key)) {
        seen.add(key)
        matches.push({ start: pos, end: pos + phrase.length, phrase })
      }
      idx = pos + 1
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}
