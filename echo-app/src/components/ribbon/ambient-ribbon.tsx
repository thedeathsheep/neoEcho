'use client'

import { AnimatePresence, motion } from 'framer-motion'
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
  if (!hasApiKey && !hasKnowledge) return '先配置 AI 或导入共鸣库，织带才会开始浮现内容。'
  if (hasApiKey && !hasKnowledge) return '继续写作，停笔后 AI 回声会逐渐浮到这里。'
  if (!hasApiKey && hasKnowledge) return '继续写作，相关资料片段会先从共鸣库浮上来。'
  return '继续写，最贴近当前段落的线索会在这里慢慢聚拢。'
}

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function contentFontSize(len: number): string {
  if (len <= 10) return 'text-[1rem]'
  if (len <= 22) return 'text-[0.96rem]'
  if (len <= 34) return 'text-[0.92rem]'
  return 'text-[0.88rem]'
}

function getSlotStyle(slotCount: number): CSSProperties {
  const gapPx = 14
  return {
    flexBasis: `calc((100% - ${(slotCount - 1) * gapPx}px) / ${slotCount})`,
    maxWidth: `calc((100% - ${(slotCount - 1) * gapPx}px) / ${slotCount})`,
    minWidth: 0,
  }
}

function getRibbonTrackStyle(slotCount: number): CSSProperties {
  const gapPx = 14
  return {
    paddingInline: `calc(((100% - ${(slotCount - 1) * gapPx}px) / ${slotCount}) / 2)`,
  }
}

function makeRibbonExcerpt(item: EchoItem): string {
  const raw = sanitizeForDisplay(
    (item.ribbonText ?? item.content ?? item.originalText ?? '').trim(),
  )
  if (!raw) return ''

  let normalized = raw
    .replace(/^[\s，。、“”‘’（）【】《》—…]+/u, '')
    .replace(/^(的是|而是|并且|而且|因此|所以|如果|因为)/u, '')
    .trim()

  const sentenceMatch = normalized.match(/^(.{0,90}?[。！？])/u)
  if (sentenceMatch?.[1]) normalized = sentenceMatch[1].trim()

  if (normalized.length > 66) {
    const chunk = normalized.slice(0, 66)
    const lastBoundary = Math.max(
      chunk.lastIndexOf('。'),
      chunk.lastIndexOf('！'),
      chunk.lastIndexOf('？'),
      chunk.lastIndexOf('；'),
      chunk.lastIndexOf('，'),
      chunk.lastIndexOf('、'),
    )
    if (lastBoundary >= 18) return `${chunk.slice(0, lastBoundary + 1).trim()}…`
    return `${chunk.trim()}…`
  }

  return normalized
}

function summarizeRibbonSlot(item: EchoItem | null, index: number) {
  if (!item) return { slot: index, empty: true }
  const text = sanitizeForDisplay(
    (item.ribbonText ?? item.content ?? item.originalText ?? '').replace(/\s+/g, ' ').trim(),
  )
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
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleClick()
      }
    },
    [handleClick],
  )

  const handleFocus = useCallback(() => {
    onRibbonSelect?.(item)
  }, [item, onRibbonSelect])

  return (
    <motion.div
      layout="position"
      className="min-w-0"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        layout
        role="button"
        tabIndex={0}
        data-ribbon-cell
        aria-label={`织带 ${index + 1}`}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={`h-[100px] overflow-hidden rounded-2xl px-2.5 py-1.5 text-left transition-all duration-200 ${
          isSelected
            ? 'bg-[var(--color-ink)]/[0.04] opacity-100'
            : 'bg-transparent opacity-62 hover:bg-[var(--color-ink)]/[0.018] hover:opacity-90'
        }`}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <p
          className={`${
            slotCount <= 6 ? 'line-clamp-4' : 'line-clamp-5'
          } font-serif leading-[1.58] tracking-[0.01em] text-[var(--color-ink)] ${contentFontSize(len)}`}
        >
          {sanitizeForDisplay(displayText)}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[10px] tracking-[0.08em] text-[var(--color-ink-faint)]/82">
          {isSelected ? (
            <span className="h-1 w-1 rounded-full bg-[var(--color-accent)]/75" />
          ) : (
            <span className="h-1 w-1 rounded-full bg-[var(--color-ink-faint)]/35" />
          )}
          <span className="truncate">
            {isAi ? getSourceLabel(item.source) : `来自 ${getSourceLabel(item.source)}`}
          </span>
        </div>
      </motion.div>
    </motion.div>
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
    const handler = (event: KeyboardEvent) => {
      if (!(event.altKey && (event.key === 'q' || event.key === 'Q'))) return
      const currentEchoes = echoesRef.current
      if (currentEchoes.length === 0) return

      event.preventDefault()
      event.stopPropagation()
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
    <div className="relative z-30 flex h-full min-h-0 flex-col px-3 py-1.5">
      <div className="relative mx-auto flex h-full w-full max-w-[1420px] items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--color-paper)] via-[var(--color-paper)]/82 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--color-paper)] via-[var(--color-paper)]/82 to-transparent" />
        {!hasContent && !suppressEmptyHint ? (
          <div className="mx-auto px-6 py-4 text-center text-[0.92rem] italic tracking-wide text-[var(--color-ink-faint)]/55">
            {getEmptyMessage(hasApiKey, hasKnowledge)}
          </div>
        ) : (
          <div
            className="flex w-full items-center justify-center gap-3.5 overflow-hidden"
            style={getRibbonTrackStyle(slotCount)}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {slotItems.map((echo, index) => (
                <motion.div
                  key={echo?.id ?? `slot-${index}`}
                  layout="position"
                  style={getSlotStyle(slotCount)}
                  className="min-w-0 flex-1"
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                >
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
                    <motion.div
                      layout
                      className="h-[100px]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
