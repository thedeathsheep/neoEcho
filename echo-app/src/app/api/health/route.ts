import { createLogger } from '@/lib/logger'
import { ok, withErrorHandler } from '@/lib/response'

const logger = createLogger('api.health')

export const dynamic = 'force-static'

export const GET = withErrorHandler(async () => {
  logger.info('Health check')

  return ok({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  })
})
