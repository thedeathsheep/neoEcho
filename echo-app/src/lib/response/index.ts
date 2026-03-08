import { NextResponse } from 'next/server'

import { AppError, isAppError } from '@/lib/errors'
import { createLogger } from '@/lib/logger'

const logger = createLogger('response')

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
  timestamp: string
}

export function ok<T>(data: T, status: number = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    { status },
  )
}

export function fail(
  error: string | AppError,
  status: number = 500,
): NextResponse<ApiResponse<never>> {
  if (isAppError(error)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        timestamp: new Date().toISOString(),
      },
      { status: error.status },
    )
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error,
      },
      timestamp: new Date().toISOString(),
    },
    { status },
  )
}

type RouteHandler = (request: Request) => Promise<NextResponse | Response>

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request: Request) => {
    try {
      return await handler(request)
    } catch (error) {
      if (isAppError(error)) {
        logger.warn(`Handled error: ${error.code}`, { message: error.message })
        return fail(error)
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Unhandled error', { message, stack: error instanceof Error ? error.stack : undefined })
      return fail(message)
    }
  }
}
