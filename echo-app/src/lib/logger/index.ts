type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}

const RESET = '\x1b[0m'

const isDev = process.env.NODE_ENV !== 'production'
const minLevel: LogLevel = isDev ? 'debug' : 'info'

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
}

function formatMessage(level: LogLevel, module: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString()
  if (isDev) {
    const color = LEVEL_COLOR[level]
    const tag = `${color}[${level.toUpperCase()}]${RESET}`
    const mod = `\x1b[35m[${module}]${RESET}`
    const base = `${tag} ${timestamp} ${mod} ${message}`
    return data ? `${base} ${JSON.stringify(data)}` : base
  }
  return JSON.stringify({ level, timestamp, module, message, ...(data ? { data } : {}) })
}

function createLogger(module: string) {
  const log = (level: LogLevel, message: string, data?: unknown) => {
    if (!shouldLog(level)) return
    const formatted = formatMessage(level, module, message, data)
    if (level === 'error') console.error(formatted)
    else if (level === 'warn') console.warn(formatted)
    else console.log(formatted)
  }

  return {
    debug: (message: string, data?: unknown) => log('debug', message, data),
    info: (message: string, data?: unknown) => log('info', message, data),
    warn: (message: string, data?: unknown) => log('warn', message, data),
    error: (message: string, data?: unknown) => log('error', message, data),
  }
}

export { createLogger }
export type Logger = ReturnType<typeof createLogger>
