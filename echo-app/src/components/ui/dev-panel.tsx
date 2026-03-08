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

export function DevPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<DevLogEntry[]>([])

  useEffect(() => {
    if (!isOpen) return
    return devLog.subscribe(setLogs)
  }, [isOpen])

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
          <h3 className="text-sm font-medium text-[var(--color-ink)] font-mono">
            工作流日志
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => devLog.clear()}
              className="text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] px-2 py-1 rounded border border-[var(--color-border)]"
            >
              清空
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              ✕
            </button>
          </div>
        </div>
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
        <div className="px-4 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-ink-faint)] shrink-0">
          共 {logs.length} 条
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
