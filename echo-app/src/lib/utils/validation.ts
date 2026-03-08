import type { z } from 'zod/v4'

import { ValidationError } from '@/lib/errors'

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.format())
  }
  return result.data
}

export async function parseRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ValidationError('Invalid JSON body')
  }
  return validate(schema, body)
}
