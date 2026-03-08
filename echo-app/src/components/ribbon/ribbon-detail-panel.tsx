'use client'

import { useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import type { EchoItem } from '@/types'

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function hasOriginalText(item: EchoItem): boolean {
  return item.source !== 'AI' && (item.originalText != null && item.originalText !== '')
}

interface RibbonDetailPanelProps {
  /** Selected ribbon echo; when null, panel is hidden. */
  item: EchoItem | null
  onClose: () => void
}

export function RibbonDetailPanel({ item, onClose }: RibbonDetailPanelProps) {
  useEffect(() => {
    if (!item) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [item, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  return (
    <AnimatePresence>
      {item && (
        <motion.aside
          role="complementary"
          aria-label="织带详情"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'tween', duration: 0.2 }}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col w-80 max-h-[50vh] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-lg overflow-hidden rounded-l-lg"
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <span className="text-xs font-medium tracking-wider text-[var(--color-ink-faint)] uppercase">
              {hasOriginalText(item) ? '原文' : item.source === 'AI' ? 'AI 灵感' : '共鸣'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-[var(--color-paper)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {hasOriginalText(item) ? (
              <>
                {item.source && (
                  <p className="text-[10px] tracking-widest text-[var(--color-ink-faint)] mb-2">
                    来自 {getSourceLabel(item.source)}
                  </p>
                )}
                <p className="font-serif text-sm leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">
                  {item.originalText ?? item.content}
                </p>
              </>
            ) : (
              <>
                <p className="font-serif text-sm leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">
                  {item.content}
                </p>
                <p className="mt-3 text-[10px] text-[var(--color-ink-faint)]">
                  可点击织带单元复制到剪贴板
                </p>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
