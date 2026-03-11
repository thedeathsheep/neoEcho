'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import { devLog, type DevLogEntry } from '@/lib/dev-log'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const t = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
  const [perfStats, setPerfStats] = useState({ avg: 0, count: 0, details: [] as Array<{ start: number; end: number; duration: number; textLen: number }> })
  const [breakdown, setBreakdown] = useState<Array<{ stage: string; ms: number }>>([])

  useEffect(() => {
    if (!isOpen) return
    return devLog.subscribe(setLogs)
  }, [isOpen])

  useEffect(() => {
    if (activeTab === 'perf') {
      setPerfStats(devLog.getAverageRibbonTime(10))
      setBreakdown(devLog.getLastRibbonBreakdown())
    }
  }, [activeTab, logs])

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-10 h-10 rounded-full bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] shadow-sm flex items-center justify-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors text-xs font-mono"
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
        className="fixed top-6 right-20 w-[420px] bg-[var(--color-surface)]/95 backdrop-blur-xl border border-[var(--color-border)] rounded-xl shadow-lg z-[60] overflow-hidden max-h-[calc(100vh-5rem)] flex flex-col"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-[var(--color-ink)] font-mono">
              开发者面板
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('logs')}
                className={`text-[10px] px-2 py-1 rounded border border-[var(--color-border)] transition-colors ${
                  activeTab === 'logs'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
                }`}
              >
                日志
              </button>
              <button
                onClick={() => setActiveTab('perf')}
                className={`text-[10px] px-2 py-1 rounded border border-[var(--color-border)] transition-colors ${
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
                className="text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] px-2 py-1 rounded border border-[var(--color-border)]"
              >
                清空
              </button>
            )}
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              ✕
            </button>
          </div>
        </div>

        {activeTab === 'logs' ? (
          <div className="flex-1 overflow-y-auto min-h-0 font-mono text-[11px] bg-[var(--color-paper)]/50">
            {logs.length === 0 ? (
              <div className="px-4 py-6 text-center text-[var(--color-ink-faint)]">
                暂无日志 · 输入停顿后会触发织带更新
              </div>
            ) : (
              <ul className="px-3 py-2 space-y-1">
                {logs.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-[var(--color-border)]/50 pb-1.5 last:border-0"
                  >
                    <span className="text-[var(--color-ink-faint)] mr-2">
                      {formatTime(entry.ts)}
                    </span>
                    <span
                      className="font-semibold text-[var(--color-accent)]"
                      title={entry.tag}
                    >
                      [{entry.tag}]
                    </span>
                    <span className="text-[var(--color-ink)] ml-1">
                      {entry.message}
                    </span>
                    {entry.payload && Object.keys(entry.payload).length > 0 && (
                      <pre className="mt-0.5 pl-4 text-[10px] text-[var(--color-ink-faint)] overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(entry.payload)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 bg-[var(--color-paper)]/50 p-4">
            {/* Performance Stats */}
            <div className="space-y-4">
              <div className="border border-[var(--color-border)] rounded-lg p-3">
                <h4 className="text-xs font-medium text-[var(--color-ink)] mb-2">平均织带更新时间</h4>
                {perfStats.count > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-mono text-[var(--color-accent)]">
                        {formatDuration(perfStats.avg)}
                      </span>
                      <span className="text-xs text-[var(--color-ink-faint)]">
                        (最近 {perfStats.count} 次)
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-ink-faint)] space-y-1">
                      {perfStats.details.slice(-5).reverse().map((d, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{d.textLen} 字输入</span>
                          <span className="font-mono">{formatDuration(d.duration)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-ink-faint)]">暂无数据 · 输入停顿触发织带更新后即可查看</p>
                )}
              </div>

              {breakdown.length > 0 && (
                <div className="border border-[var(--color-border)] rounded-lg p-3">
                  <h4 className="text-xs font-medium text-[var(--color-ink)] mb-2">上次更新耗时分解</h4>
                  <div className="space-y-1">
                    {breakdown.map((stage, i) => (
                      <div key={i} className="flex justify-between text-[10px]">
                        <span className="text-[var(--color-ink-faint)] truncate max-w-[70%]">{stage.stage}</span>
                        <span className="font-mono text-[var(--color-ink)]">{formatDuration(stage.ms)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="px-4 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-ink-faint)] shrink-0">
          {activeTab === 'logs' ? `共 ${logs.length} 条` : '性能统计基于最近 10 次织带更新'}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
