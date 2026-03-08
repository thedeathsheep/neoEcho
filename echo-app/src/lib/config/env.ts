import { z } from 'zod/v4'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'deepseek']).default('openai'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4o'),
  AI_BASE_URL: z.url().optional(),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  NEXT_PUBLIC_APP_NAME: z.string().default('Echo'),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Environment validation failed:', result.error.format())
    throw new Error('Invalid environment configuration')
  }
  return result.data
}

export const env = loadEnv()

export const isDev = env.NODE_ENV === 'development'
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
