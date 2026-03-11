'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { EchoItem } from '@/types'

/** Pause threshold in ms before ribbon updates (shown in hint). */
export const RIBBON_PAUSE_SEC = 2

interface SemanticCloudProps {
  echoes: EchoItem[]
  batchKey: number
  /** Number of ribbon slots (5–8). Layout adapts to avoid overlap. */
  slotCount?: 5 | 6 | 7 | 8
  currentBlockId?: string | null
  hasApiKey?: boolean
  hasKnowledge?: boolean
  isGenerating?: boolean
  onCardClick?: (item: EchoItem) => void
  /** Currently focused/selected echo for right-panel detail. Alt+Q cycles through cells. */
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
}

function getEmptyMessage(hasApiKey: boolean, hasKnowledge: boolean): string {
  if (!hasApiKey && !hasKnowledge) {
    return '点击右上角 ⚙️ 配置 AI，或 📚 导入知识库'
  }
  if (hasApiKey && !hasKnowledge) {
    return '开始写作，AI 将为你生成灵感碎片...'
  }
  if (!hasApiKey && hasKnowledge) {
    return '开始写作，知识库将为你提供共鸣...'
  }
  return '开始写作，灵感随时在这里...'
}

function contentFontSize(len: number): string {
  if (len <= 6) return 'text-lg'
  if (len <= 12) return 'text-base'
  if (len <= 24) return 'text-sm'
  return 'text-xs'
}

function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function getCardVariant(item: EchoItem): 'ai' | 'knowledge' {
  return item.source === 'AI' ? 'ai' : 'knowledge'
}

// No fixed slot positions: layout is auto flow (flex-wrap) to avoid overlap for any slot count and content length.

const FLOAT_EASE = [0.37, 0, 0.2, 1] as const

// CSS keyframe for smooth 60fps float; avoids JS-driven animation jank.
const ribbonFloatStyle = `
  @keyframes ribbon-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  .ribbon-float { animation: ribbon-float 4s ease-in-out infinite; will-change: transform; }
` as const

function EchoFragment({
  item,
  index,
  onCardClick,
  selectedEchoId,
  onRibbonSelect,
}: {
  item: EchoItem
  index: number
  onCardClick?: (item: EchoItem) => void
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
}) {
  const len = item.content.length
  const variant = getCardVariant(item)
  const isAi = variant === 'ai'
  const isSelected = selectedEchoId === item.id

  const handleClick = useCallback(() => {
    if (onCardClick) {
      onCardClick(item)
    } else {
      navigator.clipboard.writeText(item.content).then(
        () => toast.success('已复制到剪贴板'),
        () => toast.error('复制失败'),
      )
    }
    onRibbonSelect?.(item)
  }, [item, onCardClick, onRibbonSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleClick()
      }
      // Arrow L/R handled by container so we don't need to pass refs
    },
    [handleClick],
  )

  const handleFocus = useCallback(() => {
    onRibbonSelect?.(item)
  }, [item, onRibbonSelect])

  return (
    <motion.div
      className="ribbon-float shrink-0 w-full min-w-0 max-w-[min(100%,14rem)] pointer-events-auto"
      style={{ animationDelay: `${index * 0.15}s` }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 0.55 }}
      exit={{ opacity: 0, x: -60, transition: { duration: 0.35, ease: 'easeIn' } }}
      transition={{ opacity: { duration: 0.6, delay: index * 0.08, ease: FLOAT_EASE } }}
    >
      <div
        role="button"
        tabIndex={-1}
        data-ribbon-cell
        aria-label={`织带 ${index + 1}`}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={`relative px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 hover:ring-1 hover:ring-[var(--color-border)] hover:scale-[1.02] h-full min-h-[3.5rem] ${
          isSelected ? 'ring-2 ring-[var(--color-accent)]' : ''
        }`}
      >
        <p
          className={`font-serif tracking-wide leading-relaxed text-[var(--color-ink)] ${contentFontSize(len)} line-clamp-3`}
        >
          {item.content}
        </p>
        <span
          className={`block mt-0.5 text-[10px] tracking-widest truncate ${
            isAi ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]'
          }`}
        >
          {isAi ? getSourceLabel(item.source) : `来自 ${getSourceLabel(item.source)}`}
        </span>
      </div>
    </motion.div>
  )
}

type IndicatorState = 'idle' | 'working' | 'done'

export function AmbientRibbon({
  echoes,
  batchKey,
  slotCount = 5,
  hasApiKey = false,
  hasKnowledge = false,
  isGenerating = false,
  onCardClick,
  selectedEchoId = null,
  onRibbonSelect,
}: SemanticCloudProps) {
  const hasContent = echoes.length > 0
  const [indicatorState, setIndicatorState] = useState<IndicatorState>('idle')
  const prevGeneratingRef = useRef(isGenerating)
  const ribbonCellsContainerRef = useRef<HTMLDivElement>(null)
  const selectedEchoIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedEchoIdRef.current = selectedEchoId ?? null
  }, [selectedEchoId])

  useEffect(() => {
    if (isGenerating) {
      setIndicatorState('working')
    } else if (prevGeneratingRef.current) {
      setIndicatorState('done')
      const t = setTimeout(() => setIndicatorState('idle'), 1500)
      return () => clearTimeout(t)
    }
    prevGeneratingRef.current = isGenerating
  }, [isGenerating])

  // Alt+Q: enter browse (show first) -> cycle selection -> on last cell one more Alt+Q exits.
  // Use ref for echoes to avoid re-binding on every render when array reference changes.
  const echoesRef = useRef(echoes)
  useEffect(() => {
    echoesRef.current = echoes
  }, [echoes])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.altKey && (e.key === 'q' || e.key === 'Q'))) return
      // Check hasContent via ref to avoid dependency churn
      const currentEchoes = echoesRef.current
      const hasAnyContent = currentEchoes.length > 0
      if (!hasAnyContent) return
      e.preventDefault()
      e.stopPropagation()
      const visible = currentEchoes.slice(0, slotCount)
      if (visible.length === 0) return

      const currentId = selectedEchoIdRef.current
      const currentIdx = currentId ? visible.findIndex((item) => item.id === currentId) : -1

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
    // Only re-bind when slotCount or onRibbonSelect changes (stable references)
  }, [slotCount, onRibbonSelect])

  return (
    <div className="absolute inset-x-0 top-16 h-56 z-30 pointer-events-none overflow-hidden max-w-3xl mx-auto left-0 right-0">
      <style dangerouslySetInnerHTML={{ __html: ribbonFloatStyle }} />
      <AnimatePresence mode="sync">
        {/* State 1: empty hint */}
        {!hasContent && !isGenerating && (
          <motion.p
            key="empty-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="absolute top-1/3 left-1/2 -translate-x-1/2 text-center text-sm italic tracking-wide text-[var(--color-ink-faint)] whitespace-nowrap"
          >
            {getEmptyMessage(hasApiKey, hasKnowledge)}
          </motion.p>
        )}

        {/* State 2: current batch of echoes (keep showing while generating to avoid flash) */}
        {hasContent && (
          <motion.div
            ref={ribbonCellsContainerRef}
            key={`batch-${batchKey}`}
            className="absolute inset-0 flex flex-wrap content-start gap-x-3 gap-y-2 justify-center items-start px-2 py-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -80, transition: { duration: 0.4, ease: 'easeIn' } }}
          >
            {echoes.slice(0, slotCount).map((echo, i) => (
              <EchoFragment
                key={echo.id}
                item={echo}
                index={i}
                onCardClick={onCardClick}
                selectedEchoId={selectedEchoId}
                onRibbonSelect={onRibbonSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always-visible status indicator (idle / working / done) */}
      <div
        className="absolute bottom-4 right-2 w-2.5 h-2 rounded-full pointer-events-none flex items-center justify-center"
        aria-hidden
      >
        {indicatorState === 'idle' && (
          <motion.span
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0.5 }}
            className="w-full h-full rounded-full bg-[var(--color-ink-faint)]"
          />
        )}
        {indicatorState === 'working' && (
          <motion.span
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
            className="w-full h-full rounded-full bg-[var(--color-accent)]"
          />
        )}
        {indicatorState === 'done' && (
          <motion.span
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            className="w-full h-full rounded-full bg-[var(--color-accent)]"
          />
        )}
      </div>

      {/* bottom fade mask */}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-[var(--color-paper)] pointer-events-none" />
    </div>
  )
}
