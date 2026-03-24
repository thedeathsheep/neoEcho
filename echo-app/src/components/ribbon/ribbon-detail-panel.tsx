'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'

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
  const handleCopy = useCallback(() => {
    if (!item) return
    const text = item.detailText ?? item.originalText ?? item.content ?? ''
    navigator.clipboard.writeText(text).then(
      () => toast.success('已复制这条内容'),
      () => toast.error('复制失败'),
    )
  }, [item])

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

  const sectionLabel = item
    ? hasDetailText(item)
      ? 'Detail'
      : hasOriginalText(item)
        ? 'Original'
        : item.source === 'AI'
          ? 'AI'
          : 'Echo'
    : 'Echo'

  return (
    <AnimatePresence>
      {item && (
        <motion.aside
          role="complementary"
          aria-label="Ribbon detail"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'tween', duration: 0.2 }}
          className="fixed right-0 top-1/2 z-50 flex max-h-[68vh] w-[360px] -translate-y-1/2 flex-col overflow-hidden rounded-l-[24px] border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
          onKeyDown={handleKeyDown}
        >
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">
                  {sectionLabel}
                </p>
                <h3 className="mt-1 truncate text-sm font-medium text-[var(--color-ink)]">
                  {item.moduleLabel ?? getSourceLabel(item.source)}
                </h3>
                {currentSceneLabel && (
                  <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                    当前场景：{currentSceneLabel}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

          <div className="border-b border-[var(--color-border)] bg-[var(--color-paper)]/55 px-5 py-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-full border border-[var(--color-border)]/80 px-3 py-1.5 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface)]"
              >
                复制正文
              </button>
              {onCaptureMaterial && (
                <button
                  type="button"
                  onClick={() => onCaptureMaterial(item)}
                  className="rounded-full border border-[var(--color-border)]/80 px-3 py-1.5 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface)]"
                >
                  {currentSceneLabel ? '收进当前场景' : '收进素材'}
                </button>
              )}
              {onCreateRevision && (
                <button
                  type="button"
                  onClick={() => onCreateRevision(item)}
                  className="rounded-full border border-[var(--color-border)]/80 px-3 py-1.5 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface)]"
                >
                  加入修订
                </button>
              )}
              {onConvertToMemory && (
                <button
                  type="button"
                  onClick={() => onConvertToMemory(item)}
                  className="rounded-full border border-[var(--color-border)]/80 px-3 py-1.5 text-[11px] text-[var(--color-ink-light)] transition-colors hover:bg-[var(--color-surface)]"
                >
                  转成记忆
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {hasDetailText(item) ? (
              <>
                <p className="mb-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">详细内容</p>
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.detailText ?? '')}
                </p>
              </>
            ) : hasOriginalText(item) ? (
              <>
                <p className="mb-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">原文片段</p>
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.originalText ?? item.content ?? '')}
                </p>
              </>
            ) : (
              <>
                <p className="mb-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">内容摘录</p>
                <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-[var(--color-ink)]">
                  {segmentForDisplay(item.content ?? '')}
                </p>
              </>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
