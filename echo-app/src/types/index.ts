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

export interface RibbonSettings {
  slotCount: RibbonSlotCount
  modules: RibbonModuleConfig[]
}

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
  blockId?: string
  createdAt: string
  /** Full source text for RAG items (for right-panel traceability). Omitted for AI. */
  originalText?: string
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
}
