'use client'

import { motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'

import { sanitizeForDisplay } from '@/lib/utils/text-sanitize'
import type { EchoItem } from '@/types'

export interface ContextPanelState {
  mode: 'echo'
  item: EchoItem
}

function segmentForDisplay(text: string): string {
  const sanitized = sanitizeForDisplay(text ?? '')
  if (!sanitized.trim()) return ''

  const sentences = sanitized.split(/[.!?。！？]\s*/).filter(Boolean)
  if (sentences.length <= 1) return sanitized

  const paragraphs: string[] = []
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(
      sentences
        .slice(index, index + 2)
        .join('。')
        .trim(),
    )
  }

  return paragraphs.join('\n\n').trim()
}

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function getDetailBody(item: EchoItem): string {
  return item.detailText ?? item.originalText ?? item.content ?? ''
}

interface RibbonDetailPanelProps {
  panel: ContextPanelState | null
  onClose: () => void
}

export function RibbonDetailPanel({ panel, onClose }: RibbonDetailPanelProps) {
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('已复制'),
      () => toast.error('复制失败'),
    )
  }, [])

  useEffect(() => {
    if (!panel) return

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, panel])

  if (!panel) return null

  return (
    <motion.section
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14 }}
      className="border-l border-[var(--color-border)]/80 pl-4"
    >
      <div className="pb-3">
        <p className="text-[0.7rem] tracking-[0.08em] text-[var(--color-ink-faint)]">
          {getSourceLabel(panel.item.source)}
        </p>
      </div>

      <div className="max-h-[min(24rem,calc(100vh-15rem))] overflow-y-auto pr-2">
        <p className="whitespace-pre-wrap font-serif text-[0.92rem] leading-[2.05] text-[var(--color-ink)]">
          {segmentForDisplay(getDetailBody(panel.item))}
        </p>
      </div>

      <div className="flex items-center gap-4 pt-3 text-[0.76rem] text-[var(--color-ink-faint)]">
        <button
          type="button"
          onClick={() => handleCopy(getDetailBody(panel.item))}
          className="border-none bg-transparent px-0 py-1 transition-colors hover:text-[var(--color-ink)]"
        >
          复制
        </button>
        <button
          type="button"
          onClick={onClose}
          className="border-none bg-transparent px-0 py-1 transition-colors hover:text-[var(--color-ink)]"
        >
          收起
        </button>
      </div>
    </motion.section>
  )
}
