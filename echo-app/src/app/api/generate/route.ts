import { z } from 'zod/v4'

import { createLogger } from '@/lib/logger'
import { withErrorHandler } from '@/lib/response'
import { parseRequestBody } from '@/lib/utils/validation'
import { aiService } from '@/services/ai.service'

const logger = createLogger('api.generate')

export const dynamic = 'force-static'

const generateSchema = z.object({
  prompt: z.string().min(1),
  context: z.string().optional(),
  systemPrompt: z.string().optional(),
})

const DEFAULT_SYSTEM_PROMPT = `Act as a silent collector of memories. Your output must be RAW snippets from the provided context. No intros, no explanations. If generating a tag, use max 6 words of high poetic tension.`

export const POST = withErrorHandler(async (request: Request) => {
  const body = await parseRequestBody(request, generateSchema)

  logger.info('Generate request', { promptLength: body.prompt.length })

  const system = body.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const prompt = body.context ? `Context:\n${body.context}\n\nUser:\n${body.prompt}` : body.prompt

  const result = aiService.stream({
    system,
    prompt,
  })

  return (await result).toTextStreamResponse()
})
