import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type LanguageModel,streamText } from 'ai'

import { env } from '@/lib/config/env'
import { AIServiceError, UnauthorizedError } from '@/lib/errors'
import { createLogger } from '@/lib/logger'
import type { AIProvider } from '@/types'

const logger = createLogger('ai.service')

function getModel(provider?: AIProvider, apiKey?: string, model?: string): LanguageModel {
  const p = provider ?? env.AI_PROVIDER
  const key = apiKey ?? env.AI_API_KEY
  const m = model ?? env.AI_MODEL

  if (!key) {
    throw new UnauthorizedError('AI API key is not configured')
  }

  switch (p) {
    case 'openai':
    case 'deepseek': {
      const openai = createOpenAI({
        apiKey: key,
        ...(env.AI_BASE_URL ? { baseURL: env.AI_BASE_URL } : {}),
      })
      return openai(m)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: key })
      return anthropic(m)
    }
    default:
      throw new AIServiceError(`Unsupported AI provider: ${p}`)
  }
}

export const aiService = {
  async generate(options: {
    system?: string
    prompt: string
    provider?: AIProvider
    apiKey?: string
    model?: string
  }) {
    const { system, prompt, provider, apiKey, model: modelName } = options

    try {
      const model = getModel(provider, apiKey, modelName)
      logger.info('Generating text', { provider: provider ?? env.AI_PROVIDER })

      const result = await generateText({
        model,
        system,
        prompt,
        temperature: env.AI_TEMPERATURE,
        maxOutputTokens: env.AI_MAX_TOKENS,
      })

      return result.text
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error
      logger.error('AI generation failed', { error })
      throw new AIServiceError('Failed to generate text', error)
    }
  },

  stream(options: {
    system?: string
    prompt: string
    provider?: AIProvider
    apiKey?: string
    model?: string
  }) {
    const { system, prompt, provider, apiKey, model: modelName } = options
    const model = getModel(provider, apiKey, modelName)

    logger.info('Streaming text', { provider: provider ?? env.AI_PROVIDER })

    return streamText({
      model,
      system,
      prompt,
      temperature: env.AI_TEMPERATURE,
      maxOutputTokens: env.AI_MAX_TOKENS,
    })
  },
}
