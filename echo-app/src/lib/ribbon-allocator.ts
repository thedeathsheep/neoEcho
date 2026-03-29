import type { AllocationMode, EchoItem, PlaceholderItem, RibbonModuleConfig } from '@/types'

export interface AllocationResult {
  items: EchoItem[]
  placeholders: PlaceholderItem[]
}

export interface ModuleResult {
  mod: RibbonModuleConfig
  items: EchoItem[]
  error?: string
  usedRag?: boolean
}

/** Allocation weights for each mode */
const ALLOCATION_STRATEGIES: Record<AllocationMode, Record<string, number>> = {
  balanced: {
    rag: 0.35,
    'ai:*': 0.30,
    custom: 0.20,
    quick: 0.15,
  },
  rag_priority: {
    rag: 0.50,
    'ai:*': 0.25,
    custom: 0.15,
    quick: 0.10,
  },
  ai_priority: {
    rag: 0.20,
    'ai:*': 0.50,
    custom: 0.20,
    quick: 0.10,
  },
  custom_priority: {
    rag: 0.25,
    'ai:*': 0.25,
    custom: 0.40,
    quick: 0.10,
  },
}

/** Get module category for allocation */
function getModuleCategory(mod: RibbonModuleConfig): string {
  if (mod.type === 'rag') return 'rag'
  if (mod.type === 'custom') return 'custom'
  if (mod.type === 'quick') return 'quick'
  if (mod.type?.startsWith('ai:')) return 'ai:*'
  return 'other'
}

/** Shuffle array using Fisher-Yates algorithm */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Allocate slots to modules based on the selected allocation mode.
 * Ensures each enabled module gets at least one slot if it has results.
 */
export function allocateSlots(
  results: ModuleResult[],
  slotCount: number,
  mode: AllocationMode,
  fixedItems: EchoItem[]
): AllocationResult {
  const fixedIds = new Set(fixedItems.map((x) => x.id))
  const availableSlots = Math.max(0, slotCount - fixedItems.length)

  if (availableSlots === 0) {
    return { items: fixedItems, placeholders: [] }
  }

  const weights = ALLOCATION_STRATEGIES[mode] ?? ALLOCATION_STRATEGIES.balanced

  // Group results by module category
  const byCategory = new Map<string, EchoItem[]>()
  const placeholders: PlaceholderItem[] = []

  for (const { mod, items, error } of results) {
    const category = getModuleCategory(mod)

    if (items.length === 0) {
      // Create placeholder for failed/empty module
      if (mod.enabled) {
        placeholders.push({
          id: `placeholder-${mod.id}-${Date.now()}`,
          type: 'placeholder',
          moduleId: mod.id,
          moduleLabel: mod.label,
          status: error ? 'error' : 'empty',
          message: error || '该模块未返回结果',
          retryable: true,
        })
      }
      continue
    }

    // Filter out fixed items and shuffle
    const available = shuffle(items.filter((x) => !fixedIds.has(x.id)))

    if (!byCategory.has(category)) {
      byCategory.set(category, [])
    }
    byCategory.get(category)!.push(...available)
  }

  // Calculate target slots per category based on weights
  const categories = Array.from(byCategory.keys())
  const totalWeight = categories.reduce((sum, cat) => sum + (weights[cat] ?? 0.1), 0)

  const targetSlots = new Map<string, number>()
  for (const cat of categories) {
    const weight = weights[cat] ?? 0.1
    const target = Math.floor((weight / totalWeight) * availableSlots)
    targetSlots.set(cat, Math.max(1, target)) // At least 1 slot per category
  }

  // Adjust to fill all available slots
  let allocated = Array.from(targetSlots.values()).reduce((a, b) => a + b, 0)
  while (allocated < availableSlots) {
    // Add one to the category with most available items per slot
    let bestCat = categories[0]
    let bestRatio = -1
    for (const cat of categories) {
      const items = byCategory.get(cat) ?? []
      const slots = targetSlots.get(cat) ?? 0
      const ratio = items.length / (slots + 1)
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestCat = cat
      }
    }
    targetSlots.set(bestCat, (targetSlots.get(bestCat) ?? 0) + 1)
    allocated++
  }

  // Allocate items from each category
  const selected: EchoItem[] = []
  for (const [cat, target] of targetSlots) {
    const items = byCategory.get(cat) ?? []
    const count = Math.min(target, items.length)
    selected.push(...items.slice(0, count))
  }

  // If we still have slots, fill with remaining items round-robin
  const selectedIds = new Set(selected.map((x) => x.id))
  const remaining: EchoItem[] = []
  for (const items of byCategory.values()) {
    remaining.push(...items.filter((x) => !selectedIds.has(x.id)))
  }

  const needMore = availableSlots - selected.length
  if (needMore > 0) {
    selected.push(...shuffle(remaining).slice(0, needMore))
  }

  // Final shuffle to mix categories
  const finalItems = [...fixedItems, ...shuffle(selected)].slice(0, slotCount)

  return { items: finalItems, placeholders }
}

/**
 * Create loading placeholders for modules that are still processing.
 */
export function createLoadingPlaceholders(modules: RibbonModuleConfig[]): PlaceholderItem[] {
  return modules.map((mod) => ({
    id: `loading-${mod.id}-${Date.now()}`,
    type: 'placeholder',
    moduleId: mod.id,
    moduleLabel: mod.label,
    status: 'loading',
    message: '生成中...',
    retryable: false,
  }))
}
