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
}
