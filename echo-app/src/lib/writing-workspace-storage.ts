'use client'

import { generateId } from '@/lib/utils/crypto'
import type {
  CharacterWatchItem,
  CharacterWatchStatus,
  DocumentSnapshot,
  MaterialItem,
  MaterialStatus,
  MemoryNode,
  MemoryNodeStatus,
  PracticeDrill,
  PracticeDrillStatus,
  RevisionTask,
  RevisionTaskPriority,
  RevisionTaskStatus,
  SceneCard,
  WritingWorkspaceData,
} from '@/types'

const PREFIX = 'echo-writing-workspace:'
const MAX_MATERIALS = 160
const MAX_REVISIONS = 200
const MAX_SCENES = 80
const MAX_CHARACTER_WATCH = 120
const MAX_MEMORY_NODES = 200
const MAX_PRACTICE_DRILLS = 120
const MAX_SNAPSHOTS = 24

function storageKey(documentId: string): string {
  return `${PREFIX}${documentId}`
}

function emptyWorkspace(): WritingWorkspaceData {
  return {
    materials: [],
    revisions: [],
    scenes: [],
    characterWatchItems: [],
    memoryNodes: [],
    practiceDrills: [],
    snapshots: [],
  }
}

function normalizeRevisionPriority(priority?: string | null): RevisionTaskPriority {
  if (priority === 'now' || priority === 'watch') return priority
  return 'soon'
}

function normalizeRevision(item: RevisionTask): RevisionTask {
  return {
    ...item,
    priority: normalizeRevisionPriority(item.priority),
    contextExcerpt: item.contextExcerpt?.trim() || undefined,
  }
}

function normalizeCharacterWatch(item: CharacterWatchItem): CharacterWatchItem {
  return {
    ...item,
    status: item.status === 'resolved' ? 'resolved' : 'open',
    characterName: item.characterName?.trim() || undefined,
    detail: item.detail?.trim() || '',
    blockId: item.blockId ?? null,
    sceneId: item.sceneId ?? null,
  }
}

function normalizeMaterialStatus(status?: string | null): MaterialStatus {
  if (status === 'queued' || status === 'used' || status === 'archived') return status
  return 'inbox'
}

function normalizeMaterial(item: MaterialItem): MaterialItem {
  return {
    ...item,
    note: item.note?.trim() || undefined,
    sceneId: item.sceneId ?? null,
    blockId: item.blockId ?? null,
    characterName: item.characterName?.trim() || undefined,
    contextExcerpt: item.contextExcerpt?.trim() || undefined,
    status: normalizeMaterialStatus(item.status),
    usedAt: item.usedAt || undefined,
    tags: [...new Set((item.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
  }
}

function normalizeMemoryNode(item: MemoryNode): MemoryNode {
  return {
    ...item,
    type:
      item.type === 'character' ||
      item.type === 'relationship' ||
      item.type === 'motif' ||
      item.type === 'imagery' ||
      item.type === 'timeline'
        ? item.type
        : 'motif',
    status: item.status === 'archived' ? 'archived' : 'active',
    detail: item.detail?.trim() || undefined,
    blockId: item.blockId ?? null,
    sceneId: item.sceneId ?? null,
  }
}

function normalizeSceneCard(item: SceneCard): SceneCard {
  return {
    ...item,
    chapterTitle: item.chapterTitle?.trim() || undefined,
    title: item.title?.trim() || '未命名场景',
    summary: item.summary?.trim() || '',
    goal: item.goal?.trim() || undefined,
    tension: item.tension?.trim() || undefined,
    blockId: item.blockId ?? null,
    contextExcerpt: item.contextExcerpt?.trim() || undefined,
    lastReviewedAt: item.lastReviewedAt || undefined,
  }
}

function normalizePracticeDrillStatus(status?: string | null): PracticeDrillStatus {
  return status === 'done' ? 'done' : 'open'
}

function normalizePracticeDrill(item: PracticeDrill): PracticeDrill {
  return {
    ...item,
    detail: item.detail?.trim() || '',
    focus: item.focus?.trim() || undefined,
    blockId: item.blockId ?? null,
    sceneId: item.sceneId ?? null,
    status: normalizePracticeDrillStatus(item.status),
  }
}

function notify(documentId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('writing-workspace-updated', { detail: { documentId } }))
}

function load(documentId: string): WritingWorkspaceData {
  if (typeof window === 'undefined') return emptyWorkspace()
  try {
    const raw = localStorage.getItem(storageKey(documentId))
    if (!raw) return emptyWorkspace()
    const parsed = JSON.parse(raw) as Partial<WritingWorkspaceData>
    return {
      materials: Array.isArray(parsed.materials)
        ? parsed.materials.map((item) => normalizeMaterial(item as MaterialItem))
        : [],
      revisions: Array.isArray(parsed.revisions)
        ? parsed.revisions.map((item) => normalizeRevision(item as RevisionTask))
        : [],
      scenes: Array.isArray(parsed.scenes)
        ? parsed.scenes.map((item) => normalizeSceneCard(item as SceneCard))
        : [],
      characterWatchItems: Array.isArray(parsed.characterWatchItems)
        ? parsed.characterWatchItems.map((item) => normalizeCharacterWatch(item as CharacterWatchItem))
        : [],
      memoryNodes: Array.isArray(parsed.memoryNodes)
        ? parsed.memoryNodes.map((item) => normalizeMemoryNode(item as MemoryNode))
        : [],
      practiceDrills: Array.isArray(parsed.practiceDrills)
        ? parsed.practiceDrills.map((item) => normalizePracticeDrill(item as PracticeDrill))
        : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    }
  } catch {
    return emptyWorkspace()
  }
}

function save(documentId: string, data: WritingWorkspaceData): WritingWorkspaceData {
  if (typeof window === 'undefined') return data
  const normalized: WritingWorkspaceData = {
    materials: data.materials.map((item) => normalizeMaterial(item)).slice(0, MAX_MATERIALS),
    revisions: data.revisions.slice(0, MAX_REVISIONS),
    scenes: data.scenes
      .sort((a, b) => a.order - b.order)
      .slice(0, MAX_SCENES),
    characterWatchItems: data.characterWatchItems.slice(0, MAX_CHARACTER_WATCH),
    memoryNodes: data.memoryNodes.slice(0, MAX_MEMORY_NODES),
    practiceDrills: data.practiceDrills.slice(0, MAX_PRACTICE_DRILLS),
    snapshots: data.snapshots.slice(0, MAX_SNAPSHOTS),
  }
  localStorage.setItem(storageKey(documentId), JSON.stringify(normalized))
  notify(documentId)
  return normalized
}

function plainTextFromHtml(html: string): string {
  if (!html) return ''
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function dedupeMaterial(existing: MaterialItem[], next: MaterialItem): MaterialItem[] {
  const seen = new Set<string>()
  return [next, ...existing].filter((item) => {
    const key = `${item.kind}:${(item.content ?? '').trim().toLowerCase().slice(0, 200)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const writingWorkspaceStorage = {
  load,
  save,
  plainTextFromHtml,

  addMaterial(
    documentId: string,
    input: Omit<MaterialItem, 'id' | 'documentId' | 'createdAt'>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: MaterialItem = {
      id: generateId(),
      documentId,
      createdAt: new Date().toISOString(),
      ...input,
      note: input.note?.trim(),
      sceneId: input.sceneId ?? null,
      blockId: input.blockId ?? null,
      characterName: input.characterName?.trim() || undefined,
      contextExcerpt: input.contextExcerpt?.trim() || undefined,
      status: normalizeMaterialStatus(input.status),
      usedAt: input.usedAt || undefined,
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
    }
    return save(documentId, {
      ...current,
      materials: dedupeMaterial(current.materials, next),
    })
  },

  updateMaterial(
    documentId: string,
    materialId: string,
    updates: Partial<Pick<MaterialItem, 'note' | 'tags' | 'sceneId' | 'blockId' | 'characterName' | 'contextExcerpt' | 'status' | 'usedAt'>>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      materials: current.materials.map((item) =>
        item.id === materialId
          ? {
              ...item,
              ...updates,
              note: updates.note !== undefined ? updates.note?.trim() || undefined : item.note,
              sceneId: updates.sceneId !== undefined ? updates.sceneId ?? null : item.sceneId,
              blockId: updates.blockId !== undefined ? updates.blockId ?? null : item.blockId,
              characterName:
                updates.characterName !== undefined
                  ? updates.characterName?.trim() || undefined
                  : item.characterName,
              contextExcerpt:
                updates.contextExcerpt !== undefined
                  ? updates.contextExcerpt?.trim() || undefined
                  : item.contextExcerpt,
              status: updates.status ? normalizeMaterialStatus(updates.status) : item.status,
              usedAt: updates.usedAt !== undefined ? updates.usedAt || undefined : item.usedAt,
              tags: updates.tags
                ? [...new Set(updates.tags.map((tag) => tag.trim()).filter(Boolean))]
                : item.tags,
            }
          : item,
      ),
    })
  },

  removeMaterial(documentId: string, materialId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      materials: current.materials.filter((item) => item.id !== materialId),
    })
  },

  addRevision(
    documentId: string,
    input: Omit<RevisionTask, 'id' | 'documentId' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: RevisionTaskStatus
    },
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: RevisionTask = {
      id: generateId(),
      documentId,
      title: input.title.trim(),
      detail: input.detail?.trim(),
      kind: input.kind,
      priority: normalizeRevisionPriority(input.priority),
      blockId: input.blockId ?? null,
      contextExcerpt: input.contextExcerpt?.trim() || undefined,
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
      status: input.status ?? 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return save(documentId, {
      ...current,
      revisions: [next, ...current.revisions],
    })
  },

  updateRevision(
    documentId: string,
    revisionId: string,
    updates: Partial<
      Pick<RevisionTask, 'title' | 'detail' | 'status' | 'tags' | 'priority' | 'contextExcerpt' | 'blockId'>
    >,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      revisions: current.revisions.map((item) =>
        item.id === revisionId
          ? {
              ...item,
              ...updates,
              priority: updates.priority ? normalizeRevisionPriority(updates.priority) : item.priority,
              contextExcerpt:
                updates.contextExcerpt !== undefined
                  ? updates.contextExcerpt?.trim() || undefined
                  : item.contextExcerpt,
              tags: updates.tags
                ? [...new Set(updates.tags.map((tag) => tag.trim()).filter(Boolean))]
                : item.tags,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
  },

  removeRevision(documentId: string, revisionId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      revisions: current.revisions.filter((item) => item.id !== revisionId),
    })
  },

  addScene(
    documentId: string,
    input: Omit<SceneCard, 'id' | 'documentId' | 'createdAt' | 'updatedAt' | 'order'>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: SceneCard = {
      id: generateId(),
      documentId,
      chapterTitle: input.chapterTitle?.trim() || undefined,
      title: input.title.trim() || '未命名场景',
      summary: input.summary.trim(),
      goal: input.goal?.trim(),
      tension: input.tension?.trim(),
      blockId: input.blockId ?? null,
      contextExcerpt: input.contextExcerpt?.trim() || undefined,
      lastReviewedAt: input.lastReviewedAt,
      order: current.scenes.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return save(documentId, {
      ...current,
      scenes: [...current.scenes, next],
    })
  },

  updateScene(
    documentId: string,
    sceneId: string,
    updates: Partial<
      Pick<SceneCard, 'chapterTitle' | 'title' | 'summary' | 'goal' | 'tension' | 'order' | 'blockId' | 'contextExcerpt' | 'lastReviewedAt'>
    >,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      scenes: current.scenes.map((item) =>
        item.id === sceneId
          ? {
              ...item,
              ...updates,
              chapterTitle:
                updates.chapterTitle !== undefined
                  ? updates.chapterTitle?.trim() || undefined
                  : item.chapterTitle,
              title: updates.title !== undefined ? updates.title.trim() || item.title : item.title,
              summary: updates.summary !== undefined ? updates.summary.trim() : item.summary,
              goal: updates.goal !== undefined ? updates.goal?.trim() || undefined : item.goal,
              tension:
                updates.tension !== undefined ? updates.tension?.trim() || undefined : item.tension,
              contextExcerpt:
                updates.contextExcerpt !== undefined
                  ? updates.contextExcerpt?.trim() || undefined
                  : item.contextExcerpt,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
  },

  removeScene(documentId: string, sceneId: string): WritingWorkspaceData {
    const current = load(documentId)
    const remaining = current.scenes.filter((item) => item.id !== sceneId)
    return save(documentId, {
      ...current,
      scenes: remaining.map((item, index) => ({ ...item, order: index })),
      materials: current.materials.map((item) =>
        item.sceneId === sceneId
          ? {
              ...item,
              sceneId: null,
              status: item.status === 'queued' ? 'inbox' : item.status,
            }
          : item,
      ),
      characterWatchItems: current.characterWatchItems.map((item) =>
        item.sceneId === sceneId ? { ...item, sceneId: null, updatedAt: new Date().toISOString() } : item,
      ),
      memoryNodes: current.memoryNodes.map((item) =>
        item.sceneId === sceneId ? { ...item, sceneId: null, updatedAt: new Date().toISOString() } : item,
      ),
      practiceDrills: current.practiceDrills.map((item) =>
        item.sceneId === sceneId ? { ...item, sceneId: null, updatedAt: new Date().toISOString() } : item,
      ),
    })
  },

  addCharacterWatch(
    documentId: string,
    input: Omit<CharacterWatchItem, 'id' | 'documentId' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: CharacterWatchStatus
    },
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: CharacterWatchItem = {
      id: generateId(),
      documentId,
      title: input.title.trim(),
      characterName: input.characterName?.trim() || undefined,
      detail: input.detail.trim(),
      blockId: input.blockId ?? null,
      sceneId: input.sceneId ?? null,
      status: input.status ?? 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return save(documentId, {
      ...current,
      characterWatchItems: [next, ...current.characterWatchItems],
    })
  },

  updateCharacterWatch(
    documentId: string,
    watchId: string,
    updates: Partial<Pick<CharacterWatchItem, 'title' | 'characterName' | 'detail' | 'status' | 'sceneId' | 'blockId'>>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      characterWatchItems: current.characterWatchItems.map((item) =>
        item.id === watchId
          ? {
              ...item,
              ...updates,
              characterName:
                updates.characterName !== undefined
                  ? updates.characterName?.trim() || undefined
                  : item.characterName,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
  },

  removeCharacterWatch(documentId: string, watchId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      characterWatchItems: current.characterWatchItems.filter((item) => item.id !== watchId),
    })
  },

  addMemoryNode(
    documentId: string,
    input: Omit<MemoryNode, 'id' | 'documentId' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: MemoryNodeStatus
    },
  ): WritingWorkspaceData {
    const current = load(documentId)
    const nextKey = `${input.type}:${input.title.trim().toLowerCase()}:${input.sceneId ?? ''}:${input.blockId ?? ''}`
    const existing = current.memoryNodes.find((item) => {
      const itemKey = `${item.type}:${item.title.trim().toLowerCase()}:${item.sceneId ?? ''}:${item.blockId ?? ''}`
      return itemKey === nextKey
    })

    if (existing) {
      return save(documentId, {
        ...current,
        memoryNodes: current.memoryNodes.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                detail: input.detail?.trim() || item.detail,
                source: input.source ?? item.source,
                sceneId: input.sceneId ?? item.sceneId,
                blockId: input.blockId ?? item.blockId,
                status: input.status ?? 'active',
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      })
    }

    const next: MemoryNode = {
      id: generateId(),
      documentId,
      type: input.type,
      title: input.title.trim(),
      detail: input.detail?.trim() || undefined,
      sceneId: input.sceneId ?? null,
      blockId: input.blockId ?? null,
      source: input.source,
      status: input.status ?? 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return save(documentId, {
      ...current,
      memoryNodes: [next, ...current.memoryNodes],
    })
  },

  updateMemoryNode(
    documentId: string,
    nodeId: string,
    updates: Partial<Pick<MemoryNode, 'title' | 'detail' | 'status' | 'sceneId' | 'blockId' | 'source'>>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      memoryNodes: current.memoryNodes.map((item) =>
        item.id === nodeId
          ? {
              ...item,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
  },

  removeMemoryNode(documentId: string, nodeId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      memoryNodes: current.memoryNodes.filter((item) => item.id !== nodeId),
    })
  },

  addPracticeDrill(
    documentId: string,
    input: Omit<PracticeDrill, 'id' | 'documentId' | 'createdAt' | 'updatedAt' | 'status'> & {
      status?: PracticeDrillStatus
    },
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: PracticeDrill = {
      id: generateId(),
      documentId,
      title: input.title.trim(),
      detail: input.detail.trim(),
      focus: input.focus?.trim() || undefined,
      sceneId: input.sceneId ?? null,
      blockId: input.blockId ?? null,
      status: input.status ?? 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return save(documentId, {
      ...current,
      practiceDrills: [next, ...current.practiceDrills],
    })
  },

  updatePracticeDrill(
    documentId: string,
    drillId: string,
    updates: Partial<Pick<PracticeDrill, 'title' | 'detail' | 'focus' | 'status' | 'sceneId' | 'blockId'>>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      practiceDrills: current.practiceDrills.map((item) =>
        item.id === drillId
          ? {
              ...item,
              ...updates,
              title: updates.title !== undefined ? updates.title.trim() : item.title,
              detail: updates.detail !== undefined ? updates.detail.trim() : item.detail,
              focus: updates.focus !== undefined ? updates.focus?.trim() || undefined : item.focus,
              sceneId: updates.sceneId !== undefined ? updates.sceneId ?? null : item.sceneId,
              blockId: updates.blockId !== undefined ? updates.blockId ?? null : item.blockId,
              status: updates.status ? normalizePracticeDrillStatus(updates.status) : item.status,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    })
  },

  removePracticeDrill(documentId: string, drillId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      practiceDrills: current.practiceDrills.filter((item) => item.id !== drillId),
    })
  },

  createSnapshot(
    documentId: string,
    input: Pick<DocumentSnapshot, 'title' | 'content' | 'note'>,
  ): WritingWorkspaceData {
    const current = load(documentId)
    const next: DocumentSnapshot = {
      id: generateId(),
      documentId,
      title: input.title.trim() || '未命名快照',
      content: input.content,
      excerpt: plainTextFromHtml(input.content).slice(0, 120),
      note: input.note?.trim(),
      createdAt: new Date().toISOString(),
    }
    return save(documentId, {
      ...current,
      snapshots: [next, ...current.snapshots],
    })
  },

  removeSnapshot(documentId: string, snapshotId: string): WritingWorkspaceData {
    const current = load(documentId)
    return save(documentId, {
      ...current,
      snapshots: current.snapshots.filter((item) => item.id !== snapshotId),
    })
  },
}
