'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { devLog, type DevLogEntry } from '@/lib/dev-log'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const t = d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${t}.${ms}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function DevPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<DevLogEntry[]>([])
  const [activeTab, setActiveTab] = useState<'logs' | 'perf'>('logs')

  useEffect(() => {
    if (!isOpen) return
    return devLog.subscribe(setLogs)
  }, [isOpen])

  const perfStats =
    activeTab === 'perf'
      ? devLog.getAverageRibbonTime(10)
      : {
          avg: 0,
          count: 0,
          details: [] as Array<{ start: number; end: number; duration: number; textLen: number }>,
        }
  const breakdown = activeTab === 'perf' ? devLog.getLastRibbonBreakdown() : []

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 text-xs font-mono text-[var(--color-ink-faint)] shadow-sm backdrop-blur transition-colors hover:text-[var(--color-ink)]"
        title="开发者日志"
      >
        Dev
      </button>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-20 top-6 z-[60] flex max-h-[calc(100vh-5rem)] w-[420px] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 shadow-lg backdrop-blur-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-mono text-sm font-medium text-[var(--color-ink)]">开发者面板</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('logs')}
                className={`rounded border border-[var(--color-border)] px-2 py-1 text-[10px] transition-colors ${
                  activeTab === 'logs'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
                }`}
              >
                日志
              </button>
              <button
                onClick={() => setActiveTab('perf')}
                className={`rounded border border-[var(--color-border)] px-2 py-1 text-[10px] transition-colors ${
                  activeTab === 'perf'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
                }`}
              >
                性能
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'logs' && (
              <button
                type="button"
                onClick={() => devLog.clear()}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                清空
              </button>
            )}
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              ×
            </button>
          </div>
        </div>

        {activeTab === 'logs' ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-paper)]/50 font-mono text-[11px]">
            {logs.length === 0 ? (
              <div className="px-4 py-6 text-center text-[var(--color-ink-faint)]">
                暂无日志，输入停顿后会触发织带更新。
              </div>
            ) : (
              <ul className="space-y-1 px-3 py-2">
                {logs.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-[var(--color-border)]/50 pb-1.5 last:border-0"
                  >
                    <span className="mr-2 text-[var(--color-ink-faint)]">
                      {formatTime(entry.ts)}
                    </span>
                    <span className="font-semibold text-[var(--color-accent)]" title={entry.tag}>
                      [{entry.tag}]
                    </span>
                    <span className="ml-1 text-[var(--color-ink)]">{entry.message}</span>
                    {entry.payload && Object.keys(entry.payload).length > 0 && (
                      <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all pl-4 text-[10px] text-[var(--color-ink-faint)]">
                        {JSON.stringify(entry.payload)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-paper)]/50 p-4">
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <h4 className="mb-2 text-xs font-medium text-[var(--color-ink)]">
                  平均织带刷新时间
                </h4>
                {perfStats.count > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-2xl text-[var(--color-accent)]">
                        {formatDuration(perfStats.avg)}
                      </span>
                      <span className="text-xs text-[var(--color-ink-faint)]">
                        (最近 {perfStats.count} 次)
                      </span>
                    </div>
                    <div className="space-y-1 text-[10px] text-[var(--color-ink-faint)]">
                      {perfStats.details
                        .slice(-5)
                        .reverse()
                        .map((d, i) => (
                          <div key={i} className="flex justify-between">
                            <span>{d.textLen} 字输入</span>
                            <span className="font-mono">{formatDuration(d.duration)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    暂无数据，输入停顿触发织带刷新后即可查看。
                  </p>
                )}
              </div>

              {breakdown.length > 0 && (
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <h4 className="mb-2 text-xs font-medium text-[var(--color-ink)]">
                    上次刷新耗时拆解
                  </h4>
                  <div className="space-y-1">
                    {breakdown.map((stage, i) => (
                      <div key={i} className="flex justify-between text-[10px]">
                        <span className="max-w-[70%] truncate text-[var(--color-ink-faint)]">
                          {stage.stage}
                        </span>
                        <span className="font-mono text-[var(--color-ink)]">
                          {formatDuration(stage.ms)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-1.5 text-[10px] text-[var(--color-ink-faint)]">
          {activeTab === 'logs' ? `共 ${logs.length} 条` : '性能统计基于最近 10 次织带更新'}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
