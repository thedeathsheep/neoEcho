export type AIProvider = 'openai' | 'anthropic' | 'deepseek'

export type AIMode = 'polish' | 'narrative' | 'imagery' | 'quote' | 'custom'

/** Ribbon content module type: rag = 共鸣库; ai:* = built-in AI; custom = custom prompt; quick = quick response (no RAG) */
export type RibbonModuleType = 'rag' | 'ai:polish' | 'ai:narrative' | 'ai:imagery' | 'ai:quote' | 'custom' | 'quick'

export interface RibbonModuleConfig {
  id: string
  type: RibbonModuleType
  label: string
  enabled: boolean
  pinned: boolean
  /** Custom prompt override for built-in AI modules (ai:imagery, ai:polish, etc.) */
  prompt?: string
  /** Custom model for this module (optional, falls back to global model) */
  model?: string
}

export type RibbonSlotCount = 5 | 6 | 7 | 8

/** Ribbon content allocation mode */
export type AllocationMode = 'balanced' | 'rag_priority' | 'ai_priority' | 'custom_priority'

export interface RibbonSettings {
  slotCount: RibbonSlotCount
  modules: RibbonModuleConfig[]
  allocationMode?: AllocationMode  // Defaults to 'balanced' if not set
}

/** Placeholder item for failed or loading modules */
export interface PlaceholderItem {
  id: string
  type: 'placeholder'
  moduleId: string
  moduleLabel: string
  status: 'loading' | 'error' | 'empty'
  message?: string
  retryable: boolean
}

/** Unified ribbon item type */
export type RibbonItem = EchoItem | PlaceholderItem

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

export type EchoType = 'lit' | 'fact' | 'tag'

export interface EchoItem {
  id: string
  type: EchoType
  content: string
  source?: string
  moduleId?: string
  moduleLabel?: string
  snapshotId?: string
  ribbonText?: string
  detailText?: string
  blockId?: string
  createdAt: string
  /** Full source text for RAG items (for right-panel traceability). Omitted for AI. */
  originalText?: string
  /** Short summary for RAG context (20–40 chars). Filled by summarizeRagChunks. */
  shortSummary?: string
  /** Optional tag (4–6 chars) for RAG context. */
  tag?: string
}

/** RAG candidate with score for reranking pipeline. baseScore from retrieval; finalScore after optional rerank. */
export type RibbonEchoOrigin =
  | 'rag'
  | 'anchor'
  | 'history'
  | 'user_bias'
  | 'ai_imagery'
  | 'ai_tag'
  | 'ai_custom'

export interface RibbonContextSnapshot {
  id: string
  documentId: string
  text: string
  blockId?: string | null
  createdAt: string
}

export interface RibbonEchoCandidate {
  key: string
  item: EchoItem
  origin: RibbonEchoOrigin
  snapshotId: string
  relevanceScore: number
  noveltyScore: number
  isDisplayed: boolean
  isAdopted: boolean
  isHistory: boolean
  createdAt: string
  displayedAt?: string
}

export interface RibbonRenderEntry {
  candidateKey: string
  item: EchoItem
  enteredAt: string
}

export type RibbonJobType = 'imagery' | 'tag' | 'custom'
export type RibbonJobStatus = 'queued' | 'running' | 'soft_timed_out' | 'done' | 'failed' | 'cancelled'

export interface RibbonJob {
  id: string
  snapshotId: string
  type: RibbonJobType
  moduleId: string
  status: RibbonJobStatus
  createdAt: string
  completedAt?: string
  error?: string
}

export interface RibbonEngineState {
  currentSnapshot: RibbonContextSnapshot | null
  pool: RibbonEchoCandidate[]
  renderQueue: RibbonRenderEntry[]
  jobs: RibbonJob[]
  pinnedModuleIds: string[]
}

export interface RagCandidate extends EchoItem {
  baseScore: number
  finalScore?: number
}

export interface Document {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface InspireRequest {
  context: string
  blockId?: string
}

export interface InspireResponse {
  echoes: EchoItem[]
}

export interface GenerateRequest {
  prompt: string
  context?: string
  systemPrompt?: string
}

export interface CustomPrompt {
  id: string
  name: string
  content: string
  description?: string
  createdAt: string
  updatedAt: string
  /** Whether this module participates in the ambient ribbon or detail panel. */
  mode?: 'ambient' | 'detail'
  /** Execution contract for this custom module. */
  behavior?: 'freeform' | 'term_list' | 'guided_terms' | 'entity_explain'
  /** Expected output shape for the module. */
  outputShape?: 'short_lines' | 'paragraph'
  /** Whether to use RAG context for this custom module. Defaults to true. */
  useRag?: boolean
  /** Whether to fallback to context-only if RAG fails. Defaults to true. */
  ragFallback?: boolean
}

export type MaterialKind = 'echo' | 'selection' | 'note' | 'plot' | 'exercise'
export type MaterialStatus = 'inbox' | 'queued' | 'used' | 'archived'

export interface MaterialItem {
  id: string
  documentId: string
  kind: MaterialKind
  content: string
  source?: string
  note?: string
  sceneId?: string | null
  blockId?: string | null
  characterName?: string
  contextExcerpt?: string
  status: MaterialStatus
  usedAt?: string
  tags: string[]
  createdAt: string
}

export type RevisionTaskStatus = 'open' | 'done'
export type RevisionTaskKind = 'manual' | 'radar' | 'plot' | 'character' | 'cliche'
export type RevisionTaskPriority = 'now' | 'soon' | 'watch'

export interface RevisionTask {
  id: string
  documentId: string
  title: string
  detail?: string
  status: RevisionTaskStatus
  kind: RevisionTaskKind
  priority: RevisionTaskPriority
  blockId?: string | null
  contextExcerpt?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface SceneCard {
  id: string
  documentId: string
  chapterTitle?: string
  title: string
  summary: string
  goal?: string
  tension?: string
  blockId?: string | null
  contextExcerpt?: string
  lastReviewedAt?: string
  order: number
  createdAt: string
  updatedAt: string
}

export type CharacterWatchStatus = 'open' | 'resolved'

export interface CharacterWatchItem {
  id: string
  documentId: string
  title: string
  characterName?: string
  detail: string
  blockId?: string | null
  sceneId?: string | null
  status: CharacterWatchStatus
  createdAt: string
  updatedAt: string
}

export type MemoryNodeType = 'character' | 'relationship' | 'motif' | 'imagery' | 'timeline'
export type MemoryNodeStatus = 'active' | 'archived'

export interface MemoryNode {
  id: string
  documentId: string
  type: MemoryNodeType
  title: string
  detail?: string
  sceneId?: string | null
  blockId?: string | null
  source?: string
  status: MemoryNodeStatus
  createdAt: string
  updatedAt: string
}

export interface DocumentSnapshot {
  id: string
  documentId: string
  title: string
  content: string
  excerpt: string
  note?: string
  createdAt: string
}

export type PracticeDrillStatus = 'open' | 'done'

export interface PracticeDrill {
  id: string
  documentId: string
  title: string
  detail: string
  focus?: string
  sceneId?: string | null
  blockId?: string | null
  status: PracticeDrillStatus
  createdAt: string
  updatedAt: string
}

export interface WritingWorkspaceData {
  materials: MaterialItem[]
  revisions: RevisionTask[]
  scenes: SceneCard[]
  characterWatchItems: CharacterWatchItem[]
  memoryNodes: MemoryNode[]
  practiceDrills: PracticeDrill[]
  snapshots: DocumentSnapshot[]
}

export type WritingAssistKind = 'revision_radar' | 'plot' | 'character' | 'imitation' | 'memory_map'
export type WritingSuggestionSeverity = 'gentle' | 'watch' | 'strong'

export interface WritingSuggestion {
  id: string
  title: string
  detail: string
  tag?: string
  severity?: WritingSuggestionSeverity
}

export interface WritingAssistResult {
  kind: WritingAssistKind
  title: string
  summary?: string
  items: WritingSuggestion[]
  referenceLabel?: string
  createdAt: string
}

export interface WritingProfileSummary {
  adoptedCount: number
  materialCount: number
  openRevisionCount: number
  sceneCount: number
  openCharacterWatchCount: number
  memoryNodeCount: number
  openPracticeDrillCount: number
  snapshotCount: number
  topTags: string[]
}
