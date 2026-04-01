export interface KnowledgeBaseFileRef {
  id: string
  filePath: string
}

export interface KnowledgeBaseState {
  id: string
  name: string
  files: KnowledgeBaseFileRef[]
  mandatoryBooks: string[]
  mandatoryMaxSlots?: 1 | 2 | 3
  lastUpdated: string
}

export function createKnowledgeBaseState(
  bases: KnowledgeBaseState[],
  name: string,
  id: string,
  nowIso: string,
): {
  bases: KnowledgeBaseState[]
  activeBaseId: string | null
} {
  const nextBase: KnowledgeBaseState = {
    id,
    name: name || '新共鸣库',
    files: [],
    mandatoryBooks: [],
    mandatoryMaxSlots: 1,
    lastUpdated: nowIso,
  }

  return {
    bases: [...bases, nextBase],
    activeBaseId: bases.length === 0 ? id : null,
  }
}

export function deleteKnowledgeBaseState(
  bases: KnowledgeBaseState[],
  activeBaseId: string | null,
  baseId: string,
): {
  bases: KnowledgeBaseState[]
  activeBaseId: string | null
} {
  const nextBases = bases.filter((base) => base.id !== baseId)
  if (activeBaseId !== baseId) {
    return {
      bases: nextBases,
      activeBaseId,
    }
  }

  return {
    bases: nextBases,
    activeBaseId: nextBases[0]?.id ?? null,
  }
}

export function setMandatoryBooksState(
  bases: KnowledgeBaseState[],
  baseId: string,
  fileIds: string[],
  nowIso: string,
): KnowledgeBaseState[] {
  return bases.map((base) => {
    if (base.id !== baseId) return base
    const validFileIds = fileIds.filter((id) => base.files.some((file) => file.id === id))
    return {
      ...base,
      mandatoryBooks: validFileIds.slice(0, 3),
      lastUpdated: nowIso,
    }
  })
}

export function setMandatoryMaxSlotsState(
  bases: KnowledgeBaseState[],
  baseId: string,
  slots: 1 | 2 | 3,
  nowIso: string,
): KnowledgeBaseState[] {
  return bases.map((base) => {
    if (base.id !== baseId) return base
    return {
      ...base,
      mandatoryMaxSlots: slots,
      lastUpdated: nowIso,
    }
  })
}

export function getMandatoryFilePathsState(base: KnowledgeBaseState | null): string[] {
  if (!base || !base.mandatoryBooks.length) return []
  return base.files.filter((file) => base.mandatoryBooks.includes(file.id)).map((file) => file.filePath)
}

export function removeFileFromKnowledgeBaseState(
  bases: KnowledgeBaseState[],
  baseId: string,
  fileId: string,
  nowIso: string,
): KnowledgeBaseState[] {
  return bases.map((base) => {
    if (base.id !== baseId) return base
    return {
      ...base,
      files: base.files.filter((file) => file.id !== fileId),
      mandatoryBooks: base.mandatoryBooks.filter((id) => id !== fileId),
      lastUpdated: nowIso,
    }
  })
}
