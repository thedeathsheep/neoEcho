'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { sanitizeForDisplay } from '@/lib/utils/text-sanitize'
import type { EchoItem, PlaceholderItem } from '@/types'

/** Pause threshold in ms before ribbon updates (shown in hint). */
export const RIBBON_PAUSE_SEC = 2

interface SemanticCloudProps {
  echoes: EchoItem[]
  placeholders?: PlaceholderItem[]
  batchKey: number
  /** Number of ribbon slots (5–8). Layout adapts to avoid overlap. */
  slotCount?: 5 | 6 | 7 | 8
  currentBlockId?: string | null
  hasApiKey?: boolean
  hasKnowledge?: boolean
  isGenerating?: boolean
  onCardClick?: (item: EchoItem) => void
  /** Called after copy to clipboard succeeds (for adoption / curator). */
  onEchoCopied?: (item: EchoItem) => void
  /** Currently focused/selected echo for right-panel detail. Alt+Q cycles through cells. */
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
  onPlaceholderRetry?: (moduleId: string) => void
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


function getSourceLabel(source?: string): string {
  if (source && source.trim()) return source
  return 'Echo'
}

function contentFontSize(len: number): string {
  if (len <= 6) return 'text-lg'
  if (len <= 12) return 'text-base'
  if (len <= 24) return 'text-sm'
  return 'text-xs'
}

function EchoFragment({
  item,
  index,
  onCardClick,
  onEchoCopied,
  selectedEchoId,
  onRibbonSelect,
}: {
  item: EchoItem
  index: number
  onCardClick?: (item: EchoItem) => void
  onEchoCopied?: (item: EchoItem) => void
  selectedEchoId?: string | null
  onRibbonSelect?: (item: EchoItem | null) => void
}) {
  const fullText = item.originalText ?? item.content ?? ''
  // Truncate at 80 chars
  const displayText = fullText.length > 80 ? fullText.slice(0, 80) + '…' : fullText
  const len = displayText.length
  const isAi = item.source === 'AI'
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
  }, [item, fullText, onCardClick, onEchoCopied, onRibbonSelect])

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
    <div
      className="break-inside-avoid mb-2 pointer-events-auto"
    >
      <motion.div
        style={{ animationDelay: `${index * 0.15}s` }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 0.95 }}
        exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
        transition={{ opacity: { duration: 0.6, delay: index * 0.08, ease: [0.37, 0, 0.2, 1] } }}
      >
        <div
          role="button"
          tabIndex={-1}
          data-ribbon-cell
          aria-label={`织带 ${index + 1}`}
          onClick={handleClick}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className={`relative px-2 py-1.5 rounded cursor-pointer transition-all duration-150 hover:ring-1 hover:ring-[var(--color-border)] text-left block ${
            isSelected ? 'ring-2 ring-[var(--color-accent)]' : ''
          }`}
        >
          <p className={`font-serif tracking-wide leading-relaxed text-[var(--color-ink)] ${contentFontSize(len)}`}>
            {sanitizeForDisplay(displayText)}
          </p>
          <span
            className={`text-[9px] tracking-wider ${
              isAi ? 'text-[var(--color-accent)]/70' : 'text-[var(--color-ink-faint)]'
            }`}
          >
            {isAi ? getSourceLabel(item.source) : `来自 ${getSourceLabel(item.source)}`}
          </span>
        </div>
      </motion.div>
    </div>
  )
}

function PlaceholderFragment({
  item,
  index,
  onRetry,
}: {
  item: PlaceholderItem
  index: number
  onRetry?: (moduleId: string) => void
}) {
  return (
    <div
      className="break-inside-avoid mb-2 pointer-events-auto"
    >
      <motion.div
        style={{ animationDelay: `${index * 0.15}s` }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 0.8 }}
        exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
        transition={{ opacity: { duration: 0.6, delay: index * 0.08, ease: [0.37, 0, 0.2, 1] } }}
      >
        <div className="relative px-2 py-1.5 rounded text-left block bg-[var(--color-surface)]/50 border border-[var(--color-border)]/50">
          <p className="text-sm leading-snug font-serif text-[var(--color-ink-faint)]">
            {item.status === 'loading' ? '加载中...' : item.status === 'error' ? '生成失败' : '无内容'}
          </p>
          {item.status === 'error' && item.message && (
            <p className="text-[10px] text-[var(--color-ink-faint)]/80 mt-0.5 leading-tight max-w-[12rem] truncate" title={item.message}>
              {item.message}
            </p>
          )}
          <span className="text-[9px] tracking-wider text-[var(--color-ink-faint)]/50">
            {item.moduleLabel}
          </span>
          {item.retryable && onRetry && item.status === 'error' && (
            <button
              onClick={() => onRetry(item.moduleId)}
              className="ml-2 text-[9px] text-[var(--color-accent)] hover:underline"
            >
              重试
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

type IndicatorState = 'idle' | 'working' | 'done'

export function AmbientRibbon({
  echoes,
  placeholders = [],
  batchKey,
  slotCount = 5,
  hasApiKey = false,
  hasKnowledge = false,
  isGenerating = false,
  onCardClick,
  onEchoCopied,
  selectedEchoId = null,
  onRibbonSelect,
  onPlaceholderRetry,
}: SemanticCloudProps) {
  const hasContent = echoes.length > 0 || placeholders.length > 0
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
    <div className="relative w-full h-full min-h-0 py-2 px-4 z-30 flex flex-col justify-center">
      <div className="relative w-full max-w-6xl mx-auto">
        <AnimatePresence mode="sync">
          {/* State 1: empty hint */}
          {!hasContent && !isGenerating && (
            <motion.p
              key="empty-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.35 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              className="text-center text-sm italic tracking-wide text-[var(--color-ink-faint)]"
            >
              {getEmptyMessage(hasApiKey, hasKnowledge)}
            </motion.p>
          )}

          {/* State 2: CSS columns waterfall layout */}
          {hasContent && (
            <motion.div
              ref={ribbonCellsContainerRef}
              key={`batch-${batchKey}`}
              className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 w-full max-w-6xl mx-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } }}
            >
              {echoes.slice(0, slotCount).map((echo, i) => (
                <EchoFragment
                  key={echo.id}
                  item={echo}
                  index={i}
                  onCardClick={onCardClick}
                  onEchoCopied={onEchoCopied}
                  selectedEchoId={selectedEchoId}
                  onRibbonSelect={onRibbonSelect}
                />
              ))}
              {placeholders.slice(0, slotCount - Math.min(echoes.length, slotCount)).map((ph, i) => (
                <PlaceholderFragment
                  key={ph.id}
                  item={ph}
                  index={Math.min(echoes.length, slotCount) + i}
                  onRetry={onPlaceholderRetry}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status indicator: bottom-right */}
        <div
          className="absolute bottom-2 right-2 w-2 h-2 rounded-full pointer-events-none"
          aria-hidden
        >
          {indicatorState === 'idle' && (
            <span className="block w-full h-full rounded-full bg-[var(--color-ink-faint)] opacity-50" />
          )}
          {indicatorState === 'working' && (
            <motion.span
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
              className="block w-full h-full rounded-full bg-[var(--color-accent)]"
            />
          )}
          {indicatorState === 'done' && (
            <span className="block w-full h-full rounded-full bg-[var(--color-accent)]" />
          )}
        </div>
      </div>
    </div>
  )
}
