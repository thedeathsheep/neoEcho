'use client'

import type { PlaceholderItem } from '@/types'

interface PlaceholderCardProps {
  item: PlaceholderItem
  onRetry?: () => void
}

export function PlaceholderCard({ item, onRetry }: PlaceholderCardProps) {
  const statusConfig = {
    loading: {
      icon: '⟳',
      iconClass: 'animate-spin text-[var(--color-ink-faint)] text-lg',
      bgClass: 'bg-[var(--color-surface)]/50',
      borderClass: 'border-[var(--color-border)]/50',
    },
    error: {
      icon: '⚠',
      iconClass: 'text-red-400 text-lg',
      bgClass: 'bg-red-50/50 dark:bg-red-950/20',
      borderClass: 'border-red-200/50 dark:border-red-800/50',
    },
    empty: {
      icon: '○',
      iconClass: 'text-[var(--color-ink-faint)] text-lg',
      bgClass: 'bg-[var(--color-surface)]/30',
      borderClass: 'border-[var(--color-border)]/30',
    },
  }

  const config = statusConfig[item.status]

  return (
    <div
      className={`
        relative flex flex-col items-center justify-center
        min-h-[100px] w-full px-4 py-3
        rounded-lg border border-dashed
        ${config.bgClass} ${config.borderClass}
        transition-all duration-200
      `}
      data-placeholder="true"
      data-status={item.status}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className={config.iconClass}>{config.icon}</span>

        <span className="text-xs font-medium text-[var(--color-ink-faint)]">
          {item.moduleLabel}
        </span>

        {item.message && (
          <span className="text-[10px] text-[var(--color-ink-faint)]/70 line-clamp-2">
            {item.message}
          </span>
        )}

        {item.retryable && onRetry && item.status === 'error' && (
          <button
            onClick={onRetry}
            className="
              mt-1 px-2 py-0.5
              text-[10px] text-[var(--color-accent)]
              hover:text-[var(--color-accent)]/80
              transition-colors
              border border-[var(--color-accent)]/30
              rounded
              hover:bg-[var(--color-accent)]/5
            "
          >
            重试
          </button>
        )}
      </div>
    </div>
  )
}
