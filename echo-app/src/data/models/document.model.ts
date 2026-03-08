import { z } from 'zod/v4'

export const documentSchema = z.object({
  id: z.string(),
  title: z.string().default('无题'),
  content: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DocumentModel = z.infer<typeof documentSchema>

export const echoRecordSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  blockId: z.string().optional(),
  type: z.enum(['lit', 'fact', 'tag']),
  content: z.string(),
  source: z.string().optional(),
  createdAt: z.string(),
})

export type EchoRecordModel = z.infer<typeof echoRecordSchema>
