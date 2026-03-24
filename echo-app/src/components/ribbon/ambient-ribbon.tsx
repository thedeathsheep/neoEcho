'use client'

import type { CSSProperties } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { devLog } from '@/lib/dev-log'
import { sanitizeForDisplay } from '@/lib/utils/text-sanitize'
import type { EchoItem } from '@/types'

export const RIBBON_PAUSE_SEC = 2

interface SemanticCloudProps {
  echoes: EchoItem[]
  slots?: Array<EchoItem | null>
  freezeLayout?: boolean
  suppressEmptyHint?: boolean
  slotCount?: 5 | 6 | 7 | 8
  currentBlockId?: string | null
  hasApiKey?: boolean
  hasKnowledge?: boolean
  onCardClick?: (item: EchoItem) => void
  onEchoCopied?: (item: EchoItem) => void
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
}

function getEmptyMessage(hasApiKey: boolean, hasKnowledge: boolean): string {
  if (!hasApiKey && !hasKnowledge) return '先配置 AI 或导入共鸣库，织带才会逐渐活起来。'
  if (hasApiKey && !hasKnowledge) return '开始写作后，AI 回声会在停笔时自然出现。'
  if (!hasApiKey && hasKnowledge) return '开始写作后，共鸣库会先把相关片段推到这里。'
  return '继续写，停笔后最贴近当前段落的线索会在这里浮上来。'
}

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function contentFontSize(len: number): string {
  if (len <= 10) return 'text-lg'
  if (len <= 20) return 'text-base'
  if (len <= 32) return 'text-sm'
  return 'text-xs'
}

function getSlotStyle(slotCount: number): CSSProperties {
  const gapPx = 6
  return {
    flexBasis: `calc((100% - ${(slotCount - 1) * gapPx}px) / ${slotCount})`,
    maxWidth: `calc((100% - ${(slotCount - 1) * gapPx}px) / ${slotCount})`,
    minWidth: 0,
  }
}

function makeRibbonExcerpt(item: EchoItem): string {
  const raw = sanitizeForDisplay((item.ribbonText ?? item.content ?? item.originalText ?? '').trim())
  if (!raw) return ''

  let normalized = raw
    .replace(/^[，。、“”"'‘’（）()\s]+/u, '')
    .replace(/^(的是|而是|或者|并且|而且|因此|所以|如果|因为)/u, '')
    .trim()

  const sentenceMatch = normalized.match(/^(.{0,90}?[。！？!?])/u)
  if (sentenceMatch?.[1]) normalized = sentenceMatch[1].trim()

  if (normalized.length > 72) {
    const chunk = normalized.slice(0, 72)
    const lastBoundary = Math.max(
      chunk.lastIndexOf('。'),
      chunk.lastIndexOf('，'),
      chunk.lastIndexOf('；'),
      chunk.lastIndexOf('？'),
      chunk.lastIndexOf('！'),
      chunk.lastIndexOf('：'),
    )
    if (lastBoundary >= 18) return `${chunk.slice(0, lastBoundary + 1).trim()}…`
    return `${chunk.trim()}…`
  }

  return normalized
}

function summarizeRibbonSlot(item: EchoItem | null, index: number) {
  if (!item) return { slot: index, empty: true }
  const text = sanitizeForDisplay((item.ribbonText ?? item.content ?? item.originalText ?? '').replace(/\s+/g, ' ').trim())
  return {
    slot: index,
    id: item.id,
    moduleId: item.moduleId ?? null,
    source: item.source ?? 'Echo',
    preview: text.slice(0, 24),
  }
}

function EchoFragment({
  item,
  index,
  slotCount,
  onCardClick,
  onEchoCopied,
  selectedEchoId,
  onRibbonSelect,
}: {
  item: EchoItem
  index: number
  slotCount: 5 | 6 | 7 | 8
  onCardClick?: (item: EchoItem) => void
  onEchoCopied?: (item: EchoItem) => void
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
}) {
  const fullText = item.detailText ?? item.originalText ?? item.content ?? ''
  const displayText = makeRibbonExcerpt(item)
  const len = displayText.length
  const isAi = (item.source ?? '').toLowerCase().includes('ai')
  const isSelected = selectedEchoId === item.id

  const handleClick = useCallback(() => {
    if (onCardClick) {
      onCardClick(item)
    } else {
      navigator.clipboard.writeText(fullText).then(
        () => {
          toast.success('已复制到剪贴板')
          onEchoCopied?.(item)
        },
        () => toast.error('复制失败'),
      )
    }
    onRibbonSelect?.(item)
  }, [fullText, item, onCardClick, onEchoCopied, onRibbonSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleClick()
      }
    },
    [handleClick],
  )

  const handleFocus = useCallback(() => {
    onRibbonSelect?.(item)
  }, [item, onRibbonSelect])

  return (
    <div className="min-w-0">
      <div
        role="button"
        tabIndex={0}
        data-ribbon-cell
        aria-label={`织带 ${index + 1}`}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={`h-[118px] overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 ${
          isSelected
            ? 'border-[var(--color-accent)]/45 bg-[var(--color-paper-warm)]/55 shadow-[0_10px_30px_rgba(15,23,42,0.08)]'
            : 'border-transparent bg-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]/6'
        }`}
      >
        <p
          className={`${
            slotCount <= 6 ? 'line-clamp-4' : 'line-clamp-5'
          } font-serif leading-[1.45] tracking-[0.01em] text-[var(--color-ink)] ${contentFontSize(len)}`}
        >
          {sanitizeForDisplay(displayText)}
        </p>
        <span
          className={`mt-2 block truncate text-[10px] tracking-[0.06em] ${
            isAi ? 'text-[var(--color-accent)]/68' : 'text-[var(--color-ink-faint)]/78'
          }`}
        >
          {isAi ? getSourceLabel(item.source) : `来自 ${getSourceLabel(item.source)}`}
        </span>
      </div>
    </div>
  )
}

export function AmbientRibbon({
  echoes,
  slots,
  suppressEmptyHint = false,
  slotCount = 5,
  hasApiKey = false,
  hasKnowledge = false,
  onCardClick,
  onEchoCopied,
  selectedEchoId = null,
  onRibbonSelect,
}: SemanticCloudProps) {
  const visibleEchoes = echoes.slice(0, slotCount)
  const slotItems = slots
    ? Array.from({ length: slotCount }, (_, index) => slots[index] ?? null)
    : Array.from({ length: slotCount }, (_, index) => visibleEchoes[index] ?? null)
  const hasContent = slotItems.some((item) => item !== null)
  const visibleCount = slotItems.filter((item) => item !== null).length
  const selectedEchoIdRef = useRef<string | null>(null)
  const echoesRef = useRef(echoes)
  const previousSlotSignatureRef = useRef('')

  useEffect(() => {
    selectedEchoIdRef.current = selectedEchoId ?? null
  }, [selectedEchoId])

  useEffect(() => {
    echoesRef.current = echoes
  }, [echoes])

  useEffect(() => {
    const signature = slotItems.map((item) => item?.id ?? 'empty').join('|')
    if (signature === previousSlotSignatureRef.current) return
    devLog.push('ribbon-ui', 'slots rendered', {
      slotCount,
      hasContent,
      slots: slotItems.map((item, index) => summarizeRibbonSlot(item, index)),
    })
    previousSlotSignatureRef.current = signature
  }, [hasContent, slotCount, slotItems])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.altKey && (e.key === 'q' || e.key === 'Q'))) return
      const currentEchoes = echoesRef.current
      if (currentEchoes.length === 0) return

      e.preventDefault()
      e.stopPropagation()
      const visible = currentEchoes.slice(0, slotCount)
      const currentId = selectedEchoIdRef.current
      const currentIdx = currentId ? visible.findIndex((echo) => echo.id === currentId) : -1

      if (currentIdx < 0) {
        if (visible[0]) onRibbonSelect?.(visible[0])
        return
      }
      if (currentIdx === visible.length - 1) {
        onRibbonSelect?.(null)
        return
      }
      if (visible[currentIdx + 1]) onRibbonSelect?.(visible[currentIdx + 1])
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onRibbonSelect, slotCount])

  return (
    <div className="relative z-30 flex h-full min-h-0 flex-col px-4 py-4">
      <div className="mx-auto mb-2 flex w-full max-w-6xl items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-faint)]">
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1">
            织带 {visibleCount}/{slotCount}
          </span>
          <span>单击查看详情</span>
        </div>
        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-ink-faint)]">
          Alt+Q 切换
        </span>
      </div>
      <div className="relative mx-auto flex h-full w-full max-w-6xl items-center overflow-hidden">
        {!hasContent && !suppressEmptyHint ? (
          <div className="mx-auto rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/40 px-5 py-4 text-center text-sm italic tracking-wide text-[var(--color-ink-faint)]/55">
            {getEmptyMessage(hasApiKey, hasKnowledge)}
          </div>
        ) : (
          <div className="flex w-full items-center justify-start gap-[6px] overflow-hidden">
            {slotItems.map((echo, index) => (
              <div key={`slot-${index}`} style={getSlotStyle(slotCount)} className="min-w-0 flex-1">
                {echo ? (
                  <EchoFragment
                    item={echo}
                    index={index}
                    slotCount={slotCount}
                    onCardClick={onCardClick}
                    onEchoCopied={onEchoCopied}
                    selectedEchoId={selectedEchoId}
                    onRibbonSelect={onRibbonSelect}
                  />
                ) : (
                  <div className="h-[118px]" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
