'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'

import { sanitizeForDisplay } from '@/lib/utils/text-sanitize'
import type { EchoItem } from '@/types'

function segmentForDisplay(text: string): string {
  const sanitized = sanitizeForDisplay(text ?? '')
  if (!sanitized.trim()) return ''
  const sentences = sanitized.split(/(?<=[.!?。！？])\s*/).filter(Boolean)
  if (sentences.length <= 1) return sanitized
  const paragraphs: string[] = []
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2).join('').trim())
  }
  return paragraphs.join('\n\n').trim()
}

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function hasOriginalText(item: EchoItem): boolean {
  return item.source !== 'AI' && item.originalText != null && item.originalText !== ''
}

function hasDetailText(item: EchoItem): boolean {
  return (item.detailText ?? '').trim().length > 0
}

interface RibbonDetailPanelProps {
  item: EchoItem | null
  currentSceneLabel?: string | null
  onCaptureMaterial?: (item: EchoItem) => void
  onCreateRevision?: (item: EchoItem) => void
  onConvertToMemory?: (item: EchoItem) => void
  onClose: () => void
}

export function RibbonDetailPanel({
  item,
  currentSceneLabel,
  onCaptureMaterial,
  onCreateRevision,
  onConvertToMemory,
  onClose,
}: RibbonDetailPanelProps) {
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
          aria-label="Ribbon detail"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'tween', duration: 0.2 }}
          className="fixed right-0 top-1/2 z-50 flex max-h-[50vh] w-80 -translate-y-1/2 flex-col overflow-hidden rounded-l-lg border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
              {hasDetailText(item) ? 'Detail' : hasOriginalText(item) ? 'Original' : item.source === 'AI' ? 'AI' : 'Echo'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]"
              aria-label="Close"
            >
              x
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {(onCaptureMaterial || onCreateRevision || onConvertToMemory) && (
              <div className="mb-3 border-b border-[var(--color-border)]/70 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    Flow
                  </span>
                  {onCaptureMaterial && (
                    <button
                      type="button"
                      onClick={() => item && onCaptureMaterial(item)}
                      className="rounded-full border border-[var(--color-border)]/75 px-2.5 py-1 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-paper)]/50"
                    >
                      {currentSceneLabel ? '收进当前场景素材' : '收进素材箱'}
                    </button>
                  )}
                  {onCreateRevision && (
                    <button
                      type="button"
                      onClick={() => item && onCreateRevision(item)}
                      className="rounded-full border border-[var(--color-border)]/75 px-2.5 py-1 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-paper)]/50"
                    >
                      加入修订
                    </button>
                  )}
                  {onConvertToMemory && (
                    <button
                      type="button"
                      onClick={() => item && onConvertToMemory(item)}
                      className="rounded-full border border-[var(--color-border)]/75 px-2.5 py-1 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-paper)]/50"
                    >
                      转成记忆
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--color-ink-faint)]">
                  {currentSceneLabel ? `回流到“${currentSceneLabel}”` : '先入素材箱，稍后再挂场景'}
                </p>
              </div>
            )}

            {hasDetailText(item) ? (
              <>
                {item.source && (
                  <p className="mb-2 text-[10px] tracking-widest text-[var(--color-ink-faint)]">
                    {getSourceLabel(item.source)}
                  </p>
                )}
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.detailText ?? '')}
                </p>
              </>
            ) : hasOriginalText(item) ? (
              <>
                {item.source && (
                  <p className="mb-2 text-[10px] tracking-widest text-[var(--color-ink-faint)]">
                    From {getSourceLabel(item.source)}
                  </p>
                )}
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.originalText ?? item.content ?? '')}
                </p>
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.content ?? '')}
                </p>
                <p className="mt-3 text-[10px] text-[var(--color-ink-faint)]">
                  Click a ribbon item to copy it.
                </p>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
