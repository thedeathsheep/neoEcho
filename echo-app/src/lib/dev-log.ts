/**
 * In-memory dev log for workflow inspection. Subscribe in DevPanel to show a live stream.
 */

export interface DevLogEntry {
  id: number
  ts: number
  tag: string
  message: string
  payload?: Record<string, unknown>
}

const MAX_ENTRIES = 300
let nextId = 1
const entries: DevLogEntry[] = []
const listeners = new Set<(entries: DevLogEntry[]) => void>()

function emit() {
  const copy = [...entries]
  listeners.forEach((cb) => cb(copy))
}

export const devLog = {
  push(tag: string, message: string, payload?: Record<string, unknown>) {
    const entry: DevLogEntry = {
      id: nextId++,
      ts: Date.now(),
      tag,
      message,
      payload,
    }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.shift()
    emit()
  },

  getEntries(): DevLogEntry[] {
    return [...entries]
  },

  clear() {
    entries.length = 0
    emit()
  },

  subscribe(callback: (entries: DevLogEntry[]) => void): () => void {
    listeners.add(callback)
    callback([...entries])
    return () => {
      listeners.delete(callback)
    }
  },

  /**
   * Calculate average ribbon refresh time from recent logs.
   * Looks for pairs of 'handlePause invoked' and 'setDisplayEchoes' entries.
   */
  getAverageRibbonTime(samples = 10): { avg: number; count: number; details: Array<{ start: number; end: number; duration: number; textLen: number }> } {
    const ribbonEntries = entries.filter(e => e.tag === 'ribbon')
    const invocations: Array<{ ts: number; textLen: number }> = []
    const completions: Array<{ ts: number }> = []

    ribbonEntries.forEach(e => {
      if (e.message === 'handlePause invoked' && e.payload?.textLen) {
        invocations.push({ ts: e.ts, textLen: e.payload.textLen as number })
      } else if (e.message.startsWith('setDisplayEchoes')) {
        completions.push({ ts: e.ts })
      }
    })

    const pairs: Array<{ start: number; end: number; duration: number; textLen: number }> = []
    let invIdx = 0
    let compIdx = 0

    while (invIdx < invocations.length && compIdx < completions.length) {
      const inv = invocations[invIdx]
      const comp = completions[compIdx]

      if (comp.ts > inv.ts) {
        pairs.push({
          start: inv.ts,
          end: comp.ts,
          duration: comp.ts - inv.ts,
          textLen: inv.textLen,
        })
        invIdx++
        compIdx++
      } else {
        compIdx++
      }
    }

    const recent = pairs.slice(-samples)
    const avg = recent.length > 0 ? recent.reduce((a, b) => a + b.duration, 0) / recent.length : 0

    return { avg, count: recent.length, details: recent }
  },

  /**
   * Get performance breakdown for the last ribbon refresh.
   */
  getLastRibbonBreakdown(): Array<{ stage: string; ms: number }> {
    const ribbonEntries = entries.filter(e => e.tag === 'ribbon' || e.tag === 'rag')
    const lastCompletionIdx = ribbonEntries.findLastIndex(e => e.message.startsWith('setDisplayEchoes'))
    if (lastCompletionIdx < 0) return []

    const relevant = ribbonEntries.slice(0, lastCompletionIdx + 1)
    const startIdx = relevant.findLastIndex(e => e.message === 'handlePause invoked')
    if (startIdx < 0) return []

    const stage = relevant.slice(startIdx)
    const result: Array<{ stage: string; ms: number }> = []
    let lastTs = stage[0]?.ts

    stage.forEach(e => {
      if (e.payload && 'ms' in e.payload) {
        result.push({ stage: e.message, ms: e.payload.ms as number })
      } else if (lastTs) {
        const duration = e.ts - lastTs
        if (duration > 10) {
          result.push({ stage: e.message, ms: duration })
        }
      }
      lastTs = e.ts
    })

    return result
  },
}
