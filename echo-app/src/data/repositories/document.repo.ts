import { db } from '@/data/db'
import type { DocumentModel, EchoRecordModel } from '@/data/models/document.model'
import { generateId } from '@/lib/utils/crypto'
import { now } from '@/lib/utils/time'

const TABLE = 'documents'
const ECHO_TABLE = 'echo_records'

export const documentRepo = {
  create(title?: string): DocumentModel {
    const doc: DocumentModel = {
      id: generateId(),
      title: title ?? '无题',
      content: '',
      createdAt: now(),
      updatedAt: now(),
    }
    db.insert(TABLE, doc.id, doc as unknown as Record<string, unknown>)
    return doc
  },

  findById(id: string): DocumentModel | undefined {
    return db.findById(TABLE, id) as DocumentModel | undefined
  },

  findAll(): DocumentModel[] {
    return db.findAll(TABLE) as unknown as DocumentModel[]
  },

  update(id: string, data: Partial<Pick<DocumentModel, 'title' | 'content'>>): DocumentModel | undefined {
    return db.update(TABLE, id, { ...data, updatedAt: now() }) as DocumentModel | undefined
  },

  delete(id: string): boolean {
    return db.delete(TABLE, id)
  },
}

export const echoRecordRepo = {
  create(record: Omit<EchoRecordModel, 'id' | 'createdAt'>): EchoRecordModel {
    const echo: EchoRecordModel = {
      ...record,
      id: generateId(),
      createdAt: now(),
    }
    db.insert(ECHO_TABLE, echo.id, echo as unknown as Record<string, unknown>)
    return echo
  },

  findByDocumentId(documentId: string): EchoRecordModel[] {
    return db.findAll(ECHO_TABLE).filter(
      (r) => (r as unknown as EchoRecordModel).documentId === documentId,
    ) as unknown as EchoRecordModel[]
  },
}
