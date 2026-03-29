import { createLogger } from '@/lib/logger'
import type { EchoItem } from '@/types'

import { ragService } from './rag.service'

const logger = createLogger('inspire.service')

/**
 * Legacy server-side inspire service.
 * In the Tauri desktop app, inspiration is handled client-side
 * via client-ai.service.ts. This file is retained for a potential
 * future web version that uses Next.js API routes.
 * No prototype/placeholder content - returns only RAG results.
 */

export const inspireService = {
  async getEchoes(
    context: string,
    blockId?: string,
    _apiKey?: string,
    _model?: string,
  ): Promise<EchoItem[]> {
    logger.info('Generating echoes', { contextLength: context.length, blockId })

    const ragResults = await ragService.search(context, {}, blockId)
    return ragResults
  },
}
