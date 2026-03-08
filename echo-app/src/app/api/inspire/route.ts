import { z } from 'zod/v4'

import { createLogger } from '@/lib/logger'
import { ok, withErrorHandler } from '@/lib/response'
import { parseRequestBody } from '@/lib/utils/validation'
import { inspireService } from '@/services/inspire.service'

const logger = createLogger('api.inspire')

export const dynamic = 'force-static'

const inspireSchema = z.object({
  context: z.string().min(1),
  blockId: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

export const POST = withErrorHandler(async (request: Request) => {
  const body = await parseRequestBody(request, inspireSchema)

  logger.info('Inspire request', { contextLength: body.context.length })

  // Pass API key and model to service if provided
  const echoes = await inspireService.getEchoes(
    body.context,
    body.blockId,
    body.apiKey,
    body.model,
  )

  return ok({ echoes })
})
