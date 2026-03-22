'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import type {
  CharacterWatchItem,
  CharacterWatchStatus,
  DocumentSnapshot,
  EchoItem,
  MaterialItem,
  MemoryNode,
  PracticeDrill,
  PracticeDrillStatus,
  RevisionTask,
  RevisionTaskKind,
  RevisionTaskPriority,
  RevisionTaskStatus,
  SceneCard,
  WritingAssistKind,
  WritingAssistResult,
  WritingProfileSummary,
  WritingSuggestion,
  WritingWorkspaceData,
} from '@/types'

export type TabKey = 'today' | 'memory' | 'revisions' | 'materials' | 'scenes' | 'snapshots'

interface WritingAssistantPanelProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  profile: WritingProfileSummary
  workspace: WritingWorkspaceData
  selectedText: string
  selectedEcho: EchoItem | null
  currentParagraph: string
  currentBlockId: string | null
  currentScene: SceneCard | null
  assistResults: Partial<Record<WritingAssistKind, WritingAssistResult | null>>
  assistLoading: Partial<Record<WritingAssistKind, boolean>>
  onRunRevisionRadar: () => void
  onRunPlotProgression: () => void
  onRunCharacterConsistency: () => void
  onRunImitationDrill: () => void
  onRunSceneMemoryMap: () => void
  onCaptureSelection: () => void
  onCaptureEcho: () => void
  onAddManualMaterial: (input: { content: string; note?: string; tags?: string[] }) => void
  onUpdateMaterialTags: (materialId: string, tags: string[]) => void
  onAssignMaterialToCurrentScene: (materialId: string) => void
  onUpdateMaterialStatus: (materialId: string, status: 'inbox' | 'queued' | 'used' | 'archived') => void
  onMoveMaterialToInbox: (materialId: string) => void
  onLinkMaterialToRevision: (materialId: string) => void
  onConvertMaterialToMemory: (materialId: string) => void
  onRemoveMaterial: (materialId: string) => void
  onAddRevision: (input: { title: string; detail?: string; kind?: RevisionTaskKind; tags?: string[]; priority?: RevisionTaskPriority }) => void
  onUpdateRevisionStatus: (revisionId: string, status: RevisionTaskStatus) => void
  onRemoveRevision: (revisionId: string) => void
  onFocusRevisionBlock: (revision: RevisionTask) => void
  onAddSceneFromCurrent: () => void
  onAddScene: (input: { chapterTitle?: string; title: string; summary: string; goal?: string; tension?: string; blockId?: string | null; contextExcerpt?: string; lastReviewedAt?: string }) => void
  onUpdateScene: (sceneId: string, updates: Partial<Pick<SceneCard, 'chapterTitle' | 'title' | 'summary' | 'goal' | 'tension' | 'order' | 'blockId' | 'contextExcerpt' | 'lastReviewedAt'>>) => void
  onRemoveScene: (sceneId: string) => void
  onAddCharacterWatch: (input: { title: string; characterName?: string; detail: string; sceneId?: string | null; blockId?: string | null }) => void
  onUpdateCharacterWatchStatus: (watchId: string, status: CharacterWatchStatus) => void
  onRemoveCharacterWatch: (watchId: string) => void
  onAddMemoryNode: (input: { type: 'character' | 'relationship' | 'motif' | 'imagery' | 'timeline'; title: string; detail?: string; sceneId?: string | null; blockId?: string | null; source?: string }) => void
  onRemoveMemoryNode: (nodeId: string) => void
  onAddPracticeDrill: (input: { title: string; detail: string; focus?: string; sceneId?: string | null; blockId?: string | null }) => void
  onUpdatePracticeDrillStatus: (drillId: string, status: PracticeDrillStatus) => void
  onRemovePracticeDrill: (drillId: string) => void
  onApplyStructureInsightToCurrentScene: (detail: string) => void
  onCreateSnapshot: (note?: string) => void
  onRestoreSnapshot: (snapshot: DocumentSnapshot) => void
  onRemoveSnapshot: (snapshotId: string) => void
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function parseTags(raw: string): string[] {
  return raw.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 6)
}

function issueKindLabel(kind: RevisionTaskKind): string {
  if (kind === 'radar') return '雷达'
  if (kind === 'plot') return '结构'
  if (kind === 'character') return '人物'
  if (kind === 'cliche') return '表达'
  return '手动'
}

function priorityLabel(priority: RevisionTaskPriority): string {
  if (priority === 'now') return '现在'
  if (priority === 'watch') return '观察'
  return '稍后'
}

function priorityRank(priority: RevisionTaskPriority): number {
  if (priority === 'now') return 0
  if (priority === 'soon') return 1
  return 2
}

function priorityTone(priority: RevisionTaskPriority): string {
  if (priority === 'now') return 'bg-rose-50 text-rose-700'
  if (priority === 'watch') return 'bg-amber-50 text-amber-700'
  return 'bg-[var(--color-surface)] text-[var(--color-ink-light)]'
}

function suggestionPriority(item: WritingSuggestion, fallback: RevisionTaskPriority = 'soon'): RevisionTaskPriority {
  if (item.severity === 'strong') return 'now'
  if (item.severity === 'watch') return 'soon'
  return fallback
}

function normalizeCharacterKey(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function inferCharacterNameFromText(input: { title?: string; detail?: string; tag?: string; fallback?: string }): string | undefined {
  const genericTags = new Set(['人物', '角色', '语气', '目标', '关系', '反应', '动机', '一致性', '提醒'])
  const tag = input.tag?.trim()
  if (tag && tag.length >= 2 && tag.length <= 8 && !genericTags.has(tag)) return tag

  const texts = [input.title, input.detail, input.fallback].filter(Boolean) as string[]
  const patterns = [
    /(?:人物|角色)[:：]\s*([A-Za-z\u4e00-\u9fa5]{2,12})/,
    /“([^”]{2,12})”/,
    /"([^"]{2,12})"/,
    /([A-Za-z\u4e00-\u9fa5]{2,12})(?:的|在|对|把|让|会|与|和|跟)/,
  ]

  for (const text of texts) {
    const trimmed = text.trim()
    for (const pattern of patterns) {
      const match = trimmed.match(pattern)
      const candidate = match?.[1]?.trim()
      if (candidate && candidate.length >= 2 && candidate.length <= 12 && !genericTags.has(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

function sceneChapterLabel(scene: Pick<SceneCard, 'chapterTitle'> | null | undefined): string {
  return scene?.chapterTitle?.trim() || '未分章'
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs transition-colors ${active ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'bg-[var(--color-paper)] text-[var(--color-ink-light)] hover:text-[var(--color-ink)]'}`}>{label}</button>
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-2"><div className="text-lg font-semibold text-[var(--color-ink)]">{value}</div><div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-faint)]">{label}</div></div>
}

function TinyButton({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[10px] text-[var(--color-ink-light)] disabled:opacity-35">{children}</button>
}

function ProfileSignalCard({
  title,
  detail,
  tone = 'neutral',
}: {
  title: string
  detail: string
  tone?: 'neutral' | 'watch' | 'steady'
}) {
  const toneClass =
    tone === 'watch'
      ? 'border-amber-200 bg-amber-50/70'
      : tone === 'steady'
        ? 'border-emerald-200 bg-emerald-50/70'
        : 'border-[var(--color-border)] bg-[var(--color-paper)]'

  return (
    <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{detail}</p>
    </div>
  )
}

function MicroExerciseCard({
  title,
  detail,
  ctaLabel,
  onClick,
}: {
  title: string
  detail: string
  ctaLabel: string
  onClick: () => void
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{detail}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]"
      >
        {ctaLabel}
      </button>
    </div>
  )
}

function RevisionRow({ item, onUpdateStatus, onRemove, onFocusBlock }: { item: RevisionTask; onUpdateStatus: (revisionId: string, status: RevisionTaskStatus) => void; onRemove: (revisionId: string) => void; onFocusBlock: (revision: RevisionTask) => void }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={`text-sm font-medium ${item.status === 'done' ? 'line-through text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>{item.title}</p><span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{issueKindLabel(item.kind)}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${priorityTone(item.priority)}`}>{priorityLabel(item.priority)}</span></div>{item.detail && <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.detail}</p>}{item.contextExcerpt && <p className="mt-2 text-[11px] leading-6 text-[var(--color-ink-faint)]">关联段落：{item.contextExcerpt}</p>}</div><div className="flex shrink-0 flex-col gap-2">{item.blockId && <TinyButton onClick={() => onFocusBlock(item)}>跳到正文</TinyButton>}<TinyButton onClick={() => onUpdateStatus(item.id, item.status === 'done' ? 'open' : 'done')}>{item.status === 'done' ? '重开' : '完成'}</TinyButton><TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div></div></div>
}

function MaterialRow({
  item,
  onUpdateTags,
  onAssignToCurrentScene,
  onMarkUsed,
  onMoveToInbox,
  onLinkToRevision,
  onConvertToMemory,
  onRemove,
}: {
  item: MaterialItem
  onUpdateTags: (materialId: string, tags: string[]) => void
  onAssignToCurrentScene?: (materialId: string) => void
  onMarkUsed?: (materialId: string) => void
  onMoveToInbox?: (materialId: string) => void
  onLinkToRevision?: (materialId: string) => void
  onConvertToMemory?: (materialId: string) => void
  onRemove: (materialId: string) => void
}) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm leading-7 text-[var(--color-ink)]">{item.content}</p><span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{item.status === 'queued' ? '待用' : item.status === 'used' ? '已用' : item.status === 'archived' ? '归档' : '待分配'}</span>{item.characterName && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{item.characterName}</span>}</div><p className="mt-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">{item.source || item.kind} · {formatTime(item.createdAt)}</p>{item.contextExcerpt && <p className="mt-1 text-[11px] leading-6 text-[var(--color-ink-faint)]">关联段落：{item.contextExcerpt}</p>}<input type="text" defaultValue={item.tags.join(', ')} onBlur={(event) => onUpdateTags(item.id, parseTags(event.target.value))} placeholder="标签：人物, 场景, 意象" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" /></div><div className="flex shrink-0 flex-col gap-2"><TinyButton onClick={() => { navigator.clipboard.writeText(item.content).then(() => toast.success('已复制到剪贴板'), () => toast.error('复制失败')) }}>复制</TinyButton>{onAssignToCurrentScene && item.status === 'inbox' && <TinyButton onClick={() => onAssignToCurrentScene(item.id)}>挂到当前场景</TinyButton>}{onMarkUsed && item.status !== 'used' && <TinyButton onClick={() => onMarkUsed(item.id)}>标记已用</TinyButton>}{onMoveToInbox && item.status !== 'inbox' && <TinyButton onClick={() => onMoveToInbox(item.id)}>移回收件箱</TinyButton>}{onLinkToRevision && <TinyButton onClick={() => onLinkToRevision(item.id)}>加入修订</TinyButton>}{onConvertToMemory && <TinyButton onClick={() => onConvertToMemory(item.id)}>转记忆</TinyButton>}<TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div></div></div>
}

function _SceneRow({ item, isCurrent, onUpdate, onRemove }: { item: SceneCard; isCurrent: boolean; onUpdate: (sceneId: string, updates: Partial<Pick<SceneCard, 'title' | 'summary' | 'goal' | 'tension' | 'order' | 'blockId' | 'contextExcerpt' | 'lastReviewedAt'>>) => void; onRemove: (sceneId: string) => void }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-[10px] tracking-[0.18em] text-[var(--color-ink-faint)]">场景 {item.order + 1}</span>{isCurrent && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-light)]">当前</span>}</div><TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div><input type="text" defaultValue={item.title} onBlur={(event) => onUpdate(item.id, { title: event.target.value })} className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none" /><textarea defaultValue={item.summary} onBlur={(event) => onUpdate(item.id, { summary: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none" /><div className="mt-2 grid grid-cols-2 gap-2"><input type="text" defaultValue={item.goal ?? ''} onBlur={(event) => onUpdate(item.id, { goal: event.target.value })} placeholder="场景目标" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" /><input type="text" defaultValue={item.tension ?? ''} onBlur={(event) => onUpdate(item.id, { tension: event.target.value })} placeholder="张力 / 阻力" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" /></div>{item.contextExcerpt && <p className="mt-2 text-[11px] leading-6 text-[var(--color-ink-faint)]">绑定段落：{item.contextExcerpt}</p>}{item.lastReviewedAt && <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">最近检查：{formatTime(item.lastReviewedAt)}</p>}</div>
}

function SnapshotRow({ item, onRestore, onRemove }: { item: DocumentSnapshot; onRestore: (snapshot: DocumentSnapshot) => void; onRemove: (snapshotId: string) => void }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.excerpt || '空白快照'}</p><p className="mt-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">{formatTime(item.createdAt)}</p></div><div className="flex shrink-0 flex-col gap-2"><TinyButton onClick={() => onRestore(item)}>恢复</TinyButton><TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div></div></div>
}

function WatchRow({ item, onResolve, onRemove, onFocusBlock }: { item: CharacterWatchItem; onResolve: (watchId: string, status: CharacterWatchStatus) => void; onRemove: (watchId: string) => void; onFocusBlock: (blockId: string | null | undefined) => void }) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className={`text-sm font-medium ${item.status === 'resolved' ? 'line-through text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>{item.title}</p><span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">人物注意点</span>{item.characterName && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{item.characterName}</span>}</div><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.detail}</p></div><div className="flex shrink-0 flex-col gap-2">{item.blockId && <TinyButton onClick={() => onFocusBlock(item.blockId)}>跳到正文</TinyButton>}<TinyButton onClick={() => onResolve(item.id, item.status === 'resolved' ? 'open' : 'resolved')}>{item.status === 'resolved' ? '重开' : '已解决'}</TinyButton><TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div></div></div>
}

function MemoryNodeRow({ item, onRemove }: { item: MemoryNode; onRemove: (nodeId: string) => void }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
              {item.type === 'character'
                ? '人物'
                : item.type === 'relationship'
                  ? '关系'
                  : item.type === 'imagery'
                    ? '意象'
                    : item.type === 'timeline'
                      ? '时间线'
                      : '母题'}
            </span>
          </div>
          {item.detail && <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.detail}</p>}
          <p className="mt-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">{formatTime(item.updatedAt)}</p>
        </div>
        <TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton>
      </div>
    </div>
  )
}

function PracticeDrillRow({
  item,
  onUpdateStatus,
  onRemove,
  onFocusBlock,
}: {
  item: PracticeDrill
  onUpdateStatus: (drillId: string, status: PracticeDrillStatus) => void
  onRemove: (drillId: string) => void
  onFocusBlock: (blockId: string | null | undefined) => void
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-medium ${item.status === 'done' ? 'line-through text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>
              {item.title}
            </p>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
              练习
            </span>
            {item.focus && (
              <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                {item.focus}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.detail}</p>
          <p className="mt-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">{formatTime(item.updatedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          {item.blockId && <TinyButton onClick={() => onFocusBlock(item.blockId)}>跳到正文</TinyButton>}
          <TinyButton onClick={() => onUpdateStatus(item.id, item.status === 'done' ? 'open' : 'done')}>
            {item.status === 'done' ? '重开' : '完成'}
          </TinyButton>
          <TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton>
        </div>
      </div>
    </div>
  )
}

function CharacterMemoryCard({
  item,
  onFocusBlock,
}: {
  item: {
    key: string
    name: string
    watchItems: CharacterWatchItem[]
    characterNodes: MemoryNode[]
    relationshipNodes: MemoryNode[]
    sceneCount: number
    latestAt: string
    latestBlockId?: string | null
    summary?: string
  }
  onFocusBlock: (blockId: string | null | undefined) => void
}) {
  const openWatchCount = item.watchItems.filter((watch) => watch.status === 'open').length

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-ink)]">{item.name}</p>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">记忆 {item.characterNodes.length}</span>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">关系 {item.relationshipNodes.length}</span>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">提醒 {openWatchCount}</span>
            <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">场景 {item.sceneCount}</span>
          </div>
          {item.summary && <p className="mt-2 text-xs leading-6 text-[var(--color-ink-light)]">{item.summary}</p>}
          <p className="mt-2 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">最近更新 {formatTime(item.latestAt)}</p>
        </div>
        {item.latestBlockId && <TinyButton onClick={() => onFocusBlock(item.latestBlockId)}>跳到正文</TinyButton>}
      </div>

      {item.watchItems.length > 0 && (
        <div className="mt-3 space-y-2">
          {item.watchItems.slice(0, 2).map((watch) => (
            <div key={watch.id} className="rounded-xl bg-[var(--color-surface)] px-3 py-2 text-[11px] leading-6 text-[var(--color-ink-light)]">
              {watch.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function _SceneBlueprintRow({
  item,
  isCurrent,
  stats,
  onUpdate,
  onRemove,
  onFocusBlock,
}: {
  item: SceneCard
  isCurrent: boolean
  stats: {
    openRevisionCount: number
    openWatchCount: number
    queuedMaterialCount: number
    memoryCount: number
    nextAction: string
  }
  onUpdate: (sceneId: string, updates: Partial<Pick<SceneCard, 'chapterTitle' | 'title' | 'summary' | 'goal' | 'tension' | 'order' | 'blockId' | 'contextExcerpt' | 'lastReviewedAt'>>) => void
  onRemove: (sceneId: string) => void
  onFocusBlock: (blockId: string | null | undefined) => void
}) {
  return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><div className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-[10px] tracking-[0.18em] text-[var(--color-ink-faint)]">场景 {item.order + 1}</span>{isCurrent && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-light)]">当前</span>}</div><div className="flex items-center gap-2">{item.blockId && <TinyButton onClick={() => onFocusBlock(item.blockId)}>跳到正文</TinyButton>}<TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton></div></div><input type="text" defaultValue={item.title} onBlur={(event) => onUpdate(item.id, { title: event.target.value })} className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none" /><textarea defaultValue={item.summary} onBlur={(event) => onUpdate(item.id, { summary: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none" /><div className="mt-2 grid grid-cols-2 gap-2"><input type="text" defaultValue={item.goal ?? ''} onBlur={(event) => onUpdate(item.id, { goal: event.target.value })} placeholder="场景目标" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" /><input type="text" defaultValue={item.tension ?? ''} onBlur={(event) => onUpdate(item.id, { tension: event.target.value })} placeholder="张力 / 阻力" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" /></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-ink-faint)]"><span className="rounded-full bg-[var(--color-surface)] px-2 py-1">修订 {stats.openRevisionCount}</span><span className="rounded-full bg-[var(--color-surface)] px-2 py-1">人物 {stats.openWatchCount}</span><span className="rounded-full bg-[var(--color-surface)] px-2 py-1">待用素材 {stats.queuedMaterialCount}</span><span className="rounded-full bg-[var(--color-surface)] px-2 py-1">记忆 {stats.memoryCount}</span></div><div className="mt-2 rounded-xl bg-[var(--color-surface)] px-3 py-2 text-[11px] leading-6 text-[var(--color-ink-light)]">下一步：{stats.nextAction}</div>{item.contextExcerpt && <p className="mt-2 text-[11px] leading-6 text-[var(--color-ink-faint)]">绑定段落：{item.contextExcerpt}</p>}{item.lastReviewedAt && <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">最近检查：{formatTime(item.lastReviewedAt)}</p>}</div>
}

function ChapterSceneCard({
  item,
  isCurrent,
  stats,
  onUpdate,
  onRemove,
  onFocusBlock,
}: {
  item: SceneCard
  isCurrent: boolean
  stats: {
    openRevisionCount: number
    openWatchCount: number
    queuedMaterialCount: number
    memoryCount: number
    nextAction: string
  }
  onUpdate: (sceneId: string, updates: Partial<Pick<SceneCard, 'chapterTitle' | 'title' | 'summary' | 'goal' | 'tension' | 'order' | 'blockId' | 'contextExcerpt' | 'lastReviewedAt'>>) => void
  onRemove: (sceneId: string) => void
  onFocusBlock: (blockId: string | null | undefined) => void
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.18em] text-[var(--color-ink-faint)]">场景 {item.order + 1}</span>
          <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{sceneChapterLabel(item)}</span>
          {isCurrent && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-light)]">当前</span>}
        </div>
        <div className="flex items-center gap-2">
          {item.blockId && <TinyButton onClick={() => onFocusBlock(item.blockId)}>跳到正文</TinyButton>}
          <TinyButton onClick={() => onRemove(item.id)}>删除</TinyButton>
        </div>
      </div>

      <div className="grid grid-cols-[1.1fr_1.9fr] gap-2">
        <input
          type="text"
          defaultValue={item.chapterTitle ?? ''}
          onBlur={(event) => onUpdate(item.id, { chapterTitle: event.target.value })}
          placeholder="所属章节"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none"
        />
        <input
          type="text"
          defaultValue={item.title}
          onBlur={(event) => onUpdate(item.id, { title: event.target.value })}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
        />
      </div>
      <textarea
        defaultValue={item.summary}
        onBlur={(event) => onUpdate(item.id, { summary: event.target.value })}
        rows={3}
        className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type="text"
          defaultValue={item.goal ?? ''}
          onBlur={(event) => onUpdate(item.id, { goal: event.target.value })}
          placeholder="场景目标"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none"
        />
        <input
          type="text"
          defaultValue={item.tension ?? ''}
          onBlur={(event) => onUpdate(item.id, { tension: event.target.value })}
          placeholder="张力 / 阻力"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-ink-faint)]">
        <span className="rounded-full bg-[var(--color-surface)] px-2 py-1">修订 {stats.openRevisionCount}</span>
        <span className="rounded-full bg-[var(--color-surface)] px-2 py-1">人物 {stats.openWatchCount}</span>
        <span className="rounded-full bg-[var(--color-surface)] px-2 py-1">待用素材 {stats.queuedMaterialCount}</span>
        <span className="rounded-full bg-[var(--color-surface)] px-2 py-1">记忆 {stats.memoryCount}</span>
      </div>
      <div className="mt-2 rounded-xl bg-[var(--color-surface)] px-3 py-2 text-[11px] leading-6 text-[var(--color-ink-light)]">下一步：{stats.nextAction}</div>
      {item.contextExcerpt && <p className="mt-2 text-[11px] leading-6 text-[var(--color-ink-faint)]">绑定段落：{item.contextExcerpt}</p>}
      {item.lastReviewedAt && <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">最近检查：{formatTime(item.lastReviewedAt)}</p>}
    </div>
  )
}

function ResultSection({ result, emptyText, primaryLabel, secondaryLabel, onPrimary, onSecondary }: { result: WritingAssistResult | null | undefined; emptyText: string; primaryLabel: string; secondaryLabel?: string; onPrimary: (item: WritingSuggestion) => void; onSecondary?: (item: WritingSuggestion) => void }) {
  if (!result || result.items.length === 0) {
    return <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">{emptyText}</div>
  }

  return (
    <div className="space-y-3">
      {result.summary && <div className="rounded-xl bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink-light)]">{result.summary}</div>}
      {result.items.map((item) => (
        <div key={item.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
            {item.tag && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{item.tag}</span>}
          </div>
          <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{item.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TinyButton onClick={() => onPrimary(item)}>{primaryLabel}</TinyButton>
            {secondaryLabel && onSecondary && <TinyButton onClick={() => onSecondary(item)}>{secondaryLabel}</TinyButton>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function WritingAssistantPanel(props: WritingAssistantPanelProps) {
  const {
    profile,
    workspace,
    selectedText,
    selectedEcho,
    currentParagraph,
    currentBlockId,
    currentScene,
    assistResults,
    assistLoading,
    onRunRevisionRadar,
    onRunPlotProgression,
    onRunCharacterConsistency,
    onRunImitationDrill,
    onRunSceneMemoryMap,
    onCaptureSelection,
    onCaptureEcho,
    onAddManualMaterial,
    onUpdateMaterialTags,
    onAssignMaterialToCurrentScene,
    onUpdateMaterialStatus,
    onMoveMaterialToInbox,
    onLinkMaterialToRevision,
    onConvertMaterialToMemory,
    onRemoveMaterial,
    onAddRevision,
    onUpdateRevisionStatus,
    onRemoveRevision,
    onFocusRevisionBlock,
    onAddSceneFromCurrent,
    onAddScene,
    onUpdateScene,
    onRemoveScene,
    onAddCharacterWatch,
    onUpdateCharacterWatchStatus,
    onRemoveCharacterWatch,
    onAddMemoryNode,
    onRemoveMemoryNode,
    onAddPracticeDrill,
    onUpdatePracticeDrillStatus,
    onRemovePracticeDrill,
    onApplyStructureInsightToCurrentScene,
    onCreateSnapshot,
    onRestoreSnapshot,
    onRemoveSnapshot,
    isOpen,
    onOpenChange,
    activeTab,
    onTabChange,
  } = props

  const setIsOpen = onOpenChange
  const tab = activeTab
  const setTab = onTabChange

  const [manualMaterial, setManualMaterial] = useState('')
  const [manualMaterialTags, setManualMaterialTags] = useState('')
  const [manualRevisionTitle, setManualRevisionTitle] = useState('')
  const [manualRevisionDetail, setManualRevisionDetail] = useState('')
  const [manualRevisionPriority, setManualRevisionPriority] = useState<RevisionTaskPriority>('soon')
  const [sceneChapter, setSceneChapter] = useState('')
  const [sceneTitle, setSceneTitle] = useState('')
  const [sceneSummary, setSceneSummary] = useState('')
  const [sceneGoal, setSceneGoal] = useState('')
  const [sceneTension, setSceneTension] = useState('')
  const [snapshotNote, setSnapshotNote] = useState('')

  const openRevisions = useMemo(() => workspace.revisions.filter((item) => item.status === 'open').slice().sort((a, b) => {
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  }), [workspace.revisions])
  const nowRevisions = useMemo(() => openRevisions.filter((item) => item.priority === 'now').slice(0, 3), [openRevisions])
  const pendingRevisions = useMemo(() => openRevisions.filter((item) => !nowRevisions.some((candidate) => candidate.id === item.id)), [nowRevisions, openRevisions])
  const completedRevisions = useMemo(() => workspace.revisions.filter((item) => item.status === 'done').slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5), [workspace.revisions])
  const orderedScenes = useMemo(() => workspace.scenes.slice().sort((a, b) => a.order - b.order), [workspace.scenes])
  const chapterCount = useMemo(
    () => new Set(orderedScenes.map((scene) => sceneChapterLabel(scene))).size,
    [orderedScenes],
  )
  const latestSnapshot = workspace.snapshots[0] ?? null
  const currentSceneId = currentScene?.id ?? null
  const needsSnapshotGuard = useMemo(() => {
    if (nowRevisions.length === 0) return false
    if (!latestSnapshot) return true
    return new Date(latestSnapshot.createdAt).getTime() < Math.max(...nowRevisions.map((item) => new Date(item.updatedAt).getTime()))
  }, [latestSnapshot, nowRevisions])
  const currentSceneWatchItems = useMemo(() => workspace.characterWatchItems.filter((item) => {
    if (currentSceneId) return item.sceneId === currentSceneId || item.blockId === currentBlockId
    if (currentBlockId) return item.blockId === currentBlockId
    return false
  }).slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  }), [currentBlockId, currentSceneId, workspace.characterWatchItems])
  const currentSceneMemoryNodes = useMemo(() => workspace.memoryNodes.filter((item) => item.status === 'active').filter((item) => {
    if (currentSceneId) return item.sceneId === currentSceneId || item.blockId === currentBlockId
    if (currentBlockId) return item.blockId === currentBlockId
    return true
  }).slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [currentBlockId, currentSceneId, workspace.memoryNodes])
  const memoryTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of workspace.materials) {
      for (const tag of material.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    for (const revision of workspace.revisions) {
      for (const tag of revision.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [workspace.materials, workspace.revisions])
  const sceneMemoryRows = useMemo(() => orderedScenes.map((scene) => {
    const revisionCount = workspace.revisions.filter((item) => item.blockId && scene.blockId && item.blockId === scene.blockId).length
    const watchCount = workspace.characterWatchItems.filter((item) => item.sceneId === scene.id || (item.blockId && scene.blockId && item.blockId === scene.blockId)).length
    return {
      scene,
      revisionCount,
      watchCount,
    }
  }), [orderedScenes, workspace.characterWatchItems, workspace.revisions])
  const sceneBlueprintRows = useMemo(() => orderedScenes.map((scene) => {
    const openRevisionCount = workspace.revisions.filter((item) => item.status === 'open').filter((item) => item.blockId && scene.blockId && item.blockId === scene.blockId).length
    const openWatchCount = workspace.characterWatchItems.filter((item) => item.status === 'open').filter((item) => item.sceneId === scene.id || (item.blockId && scene.blockId && item.blockId === scene.blockId)).length
    const queuedMaterialCount = workspace.materials.filter((item) => item.status === 'queued' && item.sceneId === scene.id).length
    const memoryCount = workspace.memoryNodes.filter((item) => item.status === 'active' && item.sceneId === scene.id).length
    const nextAction = !scene.goal
      ? '先写清这场要推进什么'
      : !scene.tension
        ? '补上这场的阻力或张力'
        : openRevisionCount > 0
          ? '先收口这场的修订问题'
          : openWatchCount > 0
            ? '处理人物漂移提醒'
            : queuedMaterialCount > 0
              ? '消化待用素材，把这一场写实'
              : '这一场目前较稳，可以继续往后写'

    return {
      scene,
      stats: {
        openRevisionCount,
        openWatchCount,
        queuedMaterialCount,
        memoryCount,
        nextAction,
      },
    }
  }), [orderedScenes, workspace.characterWatchItems, workspace.materials, workspace.memoryNodes, workspace.revisions])
  const currentSceneBlueprint = useMemo(
    () => sceneBlueprintRows.find((item) => item.scene.id === currentScene?.id) ?? null,
    [currentScene?.id, sceneBlueprintRows],
  )
  const chapterGroups = useMemo(() => {
    const groups = new Map<string, {
      title: string
      rows: typeof sceneBlueprintRows
      openRevisionCount: number
      openWatchCount: number
      queuedMaterialCount: number
      memoryCount: number
    }>()

    for (const row of sceneBlueprintRows) {
      const title = sceneChapterLabel(row.scene)
      const existing = groups.get(title) ?? {
        title,
        rows: [],
        openRevisionCount: 0,
        openWatchCount: 0,
        queuedMaterialCount: 0,
        memoryCount: 0,
      }
      existing.rows.push(row)
      existing.openRevisionCount += row.stats.openRevisionCount
      existing.openWatchCount += row.stats.openWatchCount
      existing.queuedMaterialCount += row.stats.queuedMaterialCount
      existing.memoryCount += row.stats.memoryCount
      groups.set(title, existing)
    }

    return [...groups.values()].sort((a, b) => {
      const aOrder = a.rows[0]?.scene.order ?? 0
      const bOrder = b.rows[0]?.scene.order ?? 0
      return aOrder - bOrder
    })
  }, [sceneBlueprintRows])
  const currentChapterGroup = useMemo(
    () => chapterGroups.find((group) => group.rows.some((row) => row.scene.id === currentScene?.id)) ?? null,
    [chapterGroups, currentScene?.id],
  )
  const openCharacterWatchItems = useMemo(
    () => workspace.characterWatchItems.filter((item) => item.status === 'open').slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 6),
    [workspace.characterWatchItems],
  )
  const recentMemoryMaterials = useMemo(() => workspace.materials.slice(0, 6), [workspace.materials])
  const currentSceneQueuedMaterials = useMemo(() => workspace.materials.filter((item) => item.status === 'queued').filter((item) => {
    if (currentSceneId) return item.sceneId === currentSceneId
    if (currentBlockId) return item.blockId === currentBlockId
    return false
  }).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [currentBlockId, currentSceneId, workspace.materials])
  const currentScenePracticeDrills = useMemo(() => workspace.practiceDrills.filter((item) => {
    if (currentSceneId) return item.sceneId === currentSceneId
    if (currentBlockId) return item.blockId === currentBlockId
    return false
  }).slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  }), [currentBlockId, currentSceneId, workspace.practiceDrills])
  const inboxMaterials = useMemo(() => workspace.materials.filter((item) => item.status === 'inbox' || !item.sceneId).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [workspace.materials])
  const recentlyUsedMaterials = useMemo(() => workspace.materials.filter((item) => item.status === 'used').slice().sort((a, b) => new Date(b.usedAt ?? b.createdAt).getTime() - new Date(a.usedAt ?? a.createdAt).getTime()).slice(0, 6), [workspace.materials])
  const extractedMemoryResult = assistResults.memory_map
  const characterMemoryCards = useMemo(() => {
    const activeNodes = workspace.memoryNodes.filter((item) => item.status === 'active')
    const characterNodes = activeNodes.filter((item) => item.type === 'character')
    const relationshipNodes = activeNodes.filter((item) => item.type === 'relationship')
    const cards = new Map<string, {
      key: string
      name: string
      watchItems: CharacterWatchItem[]
      characterNodes: MemoryNode[]
      relationshipNodes: MemoryNode[]
      sceneIds: Set<string>
      latestAt: string
      latestBlockId?: string | null
      summary?: string
    }>()

    const ensureCard = (name: string) => {
      const key = normalizeCharacterKey(name)
      const existing = cards.get(key)
      if (existing) return existing
      const created = {
        key,
        name,
        watchItems: [],
        characterNodes: [],
        relationshipNodes: [],
        sceneIds: new Set<string>(),
        latestAt: new Date(0).toISOString(),
        latestBlockId: null as string | null,
        summary: undefined as string | undefined,
      }
      cards.set(key, created)
      return created
    }

    for (const node of characterNodes) {
      const name = node.title.trim()
      if (!name) continue
      const card = ensureCard(name)
      card.characterNodes.push(node)
      if (node.sceneId) card.sceneIds.add(node.sceneId)
      if (new Date(node.updatedAt).getTime() >= new Date(card.latestAt).getTime()) {
        card.latestAt = node.updatedAt
        card.latestBlockId = node.blockId ?? card.latestBlockId
        card.summary = node.detail ?? card.summary
      }
    }

    for (const watch of workspace.characterWatchItems) {
      const name = watch.characterName ?? inferCharacterNameFromText({ title: watch.title, detail: watch.detail })
      if (!name) continue
      const card = ensureCard(name)
      card.watchItems.push(watch)
      if (watch.sceneId) card.sceneIds.add(watch.sceneId)
      if (new Date(watch.updatedAt).getTime() >= new Date(card.latestAt).getTime()) {
        card.latestAt = watch.updatedAt
        card.latestBlockId = watch.blockId ?? card.latestBlockId
        card.summary = watch.detail || card.summary
      }
    }

    for (const relation of relationshipNodes) {
      const haystack = `${relation.title} ${relation.detail ?? ''}`
      for (const card of cards.values()) {
        if (!haystack.includes(card.name)) continue
        card.relationshipNodes.push(relation)
        if (relation.sceneId) card.sceneIds.add(relation.sceneId)
        if (new Date(relation.updatedAt).getTime() >= new Date(card.latestAt).getTime()) {
          card.latestAt = relation.updatedAt
          card.latestBlockId = relation.blockId ?? card.latestBlockId
          card.summary = relation.detail ?? card.summary
        }
      }
    }

    return [...cards.values()]
      .map((item) => ({
        ...item,
        sceneCount: item.sceneIds.size,
      }))
      .sort((a, b) => {
        const watchDiff = b.watchItems.filter((item) => item.status === 'open').length - a.watchItems.filter((item) => item.status === 'open').length
        if (watchDiff !== 0) return watchDiff
        const nodeDiff = b.characterNodes.length - a.characterNodes.length
        if (nodeDiff !== 0) return nodeDiff
        return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
      })
    }, [workspace.characterWatchItems, workspace.memoryNodes])

  const sceneWithoutGoalCount = useMemo(
    () => workspace.scenes.filter((item) => !(item.goal ?? '').trim()).length,
    [workspace.scenes],
  )
  const sceneWithoutTensionCount = useMemo(
    () => workspace.scenes.filter((item) => !(item.tension ?? '').trim()).length,
    [workspace.scenes],
  )
  const queuedMaterialCount = useMemo(
    () => workspace.materials.filter((item) => item.status === 'queued').length,
    [workspace.materials],
  )
  const profileSignals = useMemo(() => {
    const signals: Array<{ id: string; title: string; detail: string; tone?: 'neutral' | 'watch' | 'steady' }> = []

    if (profile.openRevisionCount >= 6) {
      signals.push({
        id: 'revision-pressure',
        title: '当前进入收口期',
        detail: `还有 ${profile.openRevisionCount} 条未完成修订，先收住现在最要紧的 1-3 条会更稳。`,
        tone: 'watch',
      })
    } else if (profile.openRevisionCount > 0) {
      signals.push({
        id: 'revision-steady',
        title: '修订规模还在可控范围',
        detail: `当前有 ${profile.openRevisionCount} 条开放修订，适合边写边收口，不必等到最后一起改。`,
        tone: 'steady',
      })
    }

    if (profile.openCharacterWatchCount > 0) {
      signals.push({
        id: 'character-watch',
        title: '人物稳定性需要继续盯紧',
        detail: `还有 ${profile.openCharacterWatchCount} 条人物注意点没解决，说明这轮写作的人物语气或目标还在晃动。`,
        tone: 'watch',
      })
    }

    if (sceneWithoutGoalCount > 0 || sceneWithoutTensionCount > 0) {
      signals.push({
        id: 'scene-bone',
        title: '场景骨架还没完全立起来',
        detail: `${sceneWithoutGoalCount} 场缺目标，${sceneWithoutTensionCount} 场缺张力。先把骨架写清，后面的诊断才会更准。`,
      })
    }

    if (queuedMaterialCount > 0) {
      signals.push({
        id: 'material-flow',
        title: '素材正在积累，适合进入消化阶段',
        detail: `有 ${queuedMaterialCount} 条待用素材还没真正进入正文，当前最值得做的是把它们挂回具体场景并用掉。`,
      })
    }

    if (signals.length === 0) {
      signals.push({
        id: 'steady',
        title: '当前写作状态比较平稳',
        detail: '修订、人物提醒和场景骨架都没有明显堆积，可以继续往后写，再用微练习补局部能力。',
        tone: 'steady',
      })
    }

    return signals.slice(0, 4)
  }, [
    profile.openCharacterWatchCount,
    profile.openRevisionCount,
    queuedMaterialCount,
    sceneWithoutGoalCount,
    sceneWithoutTensionCount,
  ])
  const microExercises = useMemo(() => {
    const exercises: Array<{ id: string; title: string; detail: string; ctaLabel: string }> = []

    if (nowRevisions[0]) {
      exercises.push({
        id: 'repair-one',
        title: '5 分钟收口一条修订',
        detail: `回到“${nowRevisions[0].title}”对应段落，只改一个问题点，不扩写、不重构整页。`,
        ctaLabel: '跳到正文',
      })
    }

    if (currentScene && (!(currentScene.goal ?? '').trim() || !(currentScene.tension ?? '').trim())) {
      exercises.push({
        id: 'scene-bone',
        title: '补齐这一场的目标和张力',
        detail: '花 3 分钟写清“这一场要推进什么”和“这一场卡在哪里”，场景会立刻稳很多。',
        ctaLabel: '打开场景卡',
      })
    }

    if (openCharacterWatchItems[0]) {
      exercises.push({
        id: 'character-voice',
        title: '校准一个人物语气',
        detail: `只盯住“${openCharacterWatchItems[0].title}”这一条提醒，回到原段落，把人物说话或反应拉回统一。`,
        ctaLabel: '处理人物提醒',
      })
    }

    if (currentSceneQueuedMaterials[0]) {
      exercises.push({
        id: 'material-use',
        title: '消化一条待用素材',
        detail: '从当前场景待用素材里挑一条最贴近这场气息的片段，把它真正写进正文，而不是继续收藏。',
        ctaLabel: '打开待用素材',
      })
    }

    if (profile.topTags.length > 0) {
      exercises.push({
        id: 'style-drill',
        title: '做一轮 5 分钟仿写陪练',
        detail: `围绕“${profile.topTags.slice(0, 2).join(' / ')}”这组高频主题做一次拆写法练习，提升表达密度而不是继续加素材。`,
        ctaLabel: '开始陪练',
      })
    }

    return exercises.slice(0, 3)
  }, [currentScene, currentSceneQueuedMaterials, nowRevisions, openCharacterWatchItems, profile.topTags])

  const focusBlockFromWatch = (blockId: string | null | undefined) => {
    if (!blockId) {
      toast.error('这条注意点还没有绑定段落')
      return
    }
    onFocusRevisionBlock({
      id: blockId,
      documentId: '',
      title: '',
      detail: '',
      status: 'open',
      kind: 'character',
      priority: 'soon',
      blockId,
      contextExcerpt: undefined,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  if (!isOpen) {
    return <div className="fixed bottom-6 left-24 z-[60]"><button type="button" onClick={() => setIsOpen(true)} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/92 px-4 py-2 text-sm text-[var(--color-ink)] shadow-sm backdrop-blur transition-colors hover:bg-[var(--color-paper)]" title="写作台">写作台</button></div>
  }

  return (
    <AnimatePresence>
      <motion.aside initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-6 left-24 z-[60] flex max-h-[78vh] w-[400px] flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-faint)]">Current Scene</p><h3 className="mt-1 text-lg font-semibold text-[var(--color-ink)]">写作台</h3><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">围绕当前这一场做结构检查、人物提醒和修订收口。</p></div>
            <TinyButton onClick={() => setIsOpen(false)}>关闭</TinyButton>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-2">
            <SummaryCard label="采纳" value={profile.adoptedCount} />
            <SummaryCard label="素材" value={profile.materialCount} />
            <SummaryCard label="修订" value={profile.openRevisionCount} />
            <SummaryCard label="场景" value={profile.sceneCount} />
            <SummaryCard label="章节" value={chapterCount} />
            <SummaryCard label="人物" value={profile.openCharacterWatchCount} />
            <SummaryCard label="快照" value={profile.snapshotCount} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <TinyButton onClick={onCaptureSelection} disabled={!selectedText.trim()}>收纳选中文本</TinyButton>
            <TinyButton onClick={onCaptureEcho} disabled={!selectedEcho}>收纳当前回声</TinyButton>
            <TinyButton onClick={onAddSceneFromCurrent} disabled={!currentParagraph.trim()}>从当前段落建卡</TinyButton>
            <TinyButton onClick={() => { onCreateSnapshot(snapshotNote); setSnapshotNote('') }}>创建快照</TinyButton>
          </div>
        </div>
        <div className="border-b border-[var(--color-border)] px-4 py-3"><div className="flex flex-wrap gap-2"><TabButton active={tab === 'today'} onClick={() => setTab('today')} label="当前场景" /><TabButton active={tab === 'memory'} onClick={() => setTab('memory')} label="记忆" /><TabButton active={tab === 'revisions'} onClick={() => setTab('revisions')} label="修订" /><TabButton active={tab === 'materials'} onClick={() => setTab('materials')} label="素材" /><TabButton active={tab === 'scenes'} onClick={() => setTab('scenes')} label="场景" /><TabButton active={tab === 'snapshots'} onClick={() => setTab('snapshots')} label="快照" /></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === 'today' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-sm font-medium text-[var(--color-ink)]">当前场景卡</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">先确认你正在写的是哪一场，再做结构和人物检查。</p></div>
                  {!currentScene && currentParagraph.trim() && <TinyButton onClick={onAddSceneFromCurrent}>从当前段落建卡</TinyButton>}
                </div>
                {currentScene ? (
                  <div className="mt-3 rounded-xl bg-[var(--color-surface)] px-3 py-3"><div className="flex items-center gap-2"><p className="text-sm font-medium text-[var(--color-ink)]">{currentScene.title}</p><span className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">当前场景</span><span className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{sceneChapterLabel(currentScene)}</span></div><p className="mt-2 text-xs leading-6 text-[var(--color-ink-light)]">{currentScene.summary}</p>{currentChapterGroup && <div className="mt-3 rounded-xl bg-[var(--color-paper)] px-3 py-2 text-[11px] leading-6 text-[var(--color-ink-light)]">所在章节：{currentChapterGroup.title} · {currentChapterGroup.rows.length} 场 · 修订 {currentChapterGroup.openRevisionCount} · 人物 {currentChapterGroup.openWatchCount}</div>}{currentScene.goal && <p className="mt-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">目标：{currentScene.goal}</p>}{currentScene.tension && <p className="mt-1 text-[11px] leading-6 text-[var(--color-ink-faint)]">张力：{currentScene.tension}</p>}{currentSceneBlueprint && <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-ink-faint)]"><span className="rounded-full bg-[var(--color-paper)] px-2 py-1">修订 {currentSceneBlueprint.stats.openRevisionCount}</span><span className="rounded-full bg-[var(--color-paper)] px-2 py-1">人物 {currentSceneBlueprint.stats.openWatchCount}</span><span className="rounded-full bg-[var(--color-paper)] px-2 py-1">待用素材 {currentSceneBlueprint.stats.queuedMaterialCount}</span><span className="rounded-full bg-[var(--color-paper)] px-2 py-1">记忆 {currentSceneBlueprint.stats.memoryCount}</span></div>}{currentSceneBlueprint && <div className="mt-2 rounded-xl bg-[var(--color-paper)] px-3 py-2 text-[11px] leading-6 text-[var(--color-ink-light)]">下一步：{currentSceneBlueprint.stats.nextAction}</div>}{currentScene.contextExcerpt && <p className="mt-2 text-[11px] leading-6 text-[var(--color-ink-faint)]">绑定段落：{currentScene.contextExcerpt}</p>}{currentScene.lastReviewedAt && <p className="mt-1 text-[10px] tracking-[0.16em] text-[var(--color-ink-faint)]">最近检查：{formatTime(currentScene.lastReviewedAt)}</p>}</div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">{currentParagraph.trim() ? '当前段落还没有绑定场景卡。先建一张卡，后面的结构诊断、人物提醒和修订会更稳定地围绕这一场工作。' : '把光标放在正文某一段，写作台就会围绕当前这一场开始工作。'}</div>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-ink)]">结构诊断</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">只看节奏、转折、冲突和信息顺序，不给正文。</p></div><TinyButton onClick={onRunPlotProgression} disabled={!currentParagraph.trim()}>{assistLoading.plot ? '检查中...' : '开始检查'}</TinyButton></div>
                <div className="mt-3"><ResultSection result={assistResults.plot} emptyText="先跑一次结构诊断，结果会直接落到这里。" primaryLabel="加入修订" secondaryLabel={currentScene ? '写进场景卡' : undefined} onPrimary={(item) => onAddRevision({ title: item.title, detail: item.detail, kind: 'plot', priority: suggestionPriority(item, 'soon'), tags: item.tag ? [item.tag] : [] })} onSecondary={(item) => onApplyStructureInsightToCurrentScene(item.detail)} /></div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-ink)]">人物一致性</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">检查语气、行为、目标和关系反应有没有突然漂移。</p></div><TinyButton onClick={onRunCharacterConsistency} disabled={!currentParagraph.trim()}>{assistLoading.character ? '检查中...' : '开始检查'}</TinyButton></div>
                <div className="mt-3"><ResultSection result={assistResults.character} emptyText="先跑一次人物一致性检查；如果没有明显问题，也会告诉你这一场暂时稳住了。" primaryLabel="加入修订" secondaryLabel="标记注意点" onPrimary={(item) => onAddRevision({ title: item.title, detail: item.detail, kind: 'character', priority: suggestionPriority(item, 'watch'), tags: item.tag ? [item.tag] : [] })} onSecondary={(item) => {
                  const characterName = inferCharacterNameFromText({ title: item.title, detail: item.detail, tag: item.tag, fallback: currentScene?.title })
                  onAddCharacterWatch({ title: item.title, characterName, detail: item.detail, sceneId: currentScene?.id, blockId: currentBlockId })
                  if (characterName) {
                    onAddMemoryNode({ type: 'character', title: characterName, detail: item.detail, sceneId: currentScene?.id, blockId: currentBlockId, source: 'character_watch' })
                  }
                }} /></div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-ink)]">人物注意点</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">这一场里需要持续留心的人物漂移点，会先留在这里。</p></div><span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{currentSceneWatchItems.length} 条</span></div>
                <div className="mt-3 space-y-3">{currentSceneWatchItems.length > 0 ? currentSceneWatchItems.map((item) => <WatchRow key={item.id} item={item} onResolve={onUpdateCharacterWatchStatus} onRemove={onRemoveCharacterWatch} onFocusBlock={focusBlockFromWatch} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">当前场景还没有人物注意点。跑一次人物一致性后，可以把值得持续关注的问题留下来。</div>}</div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-ink)]">现在先改</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">先收口最该动手的 1-3 条问题，别让修订清单一直堆着。</p></div><TinyButton onClick={() => { onCreateSnapshot(snapshotNote); setSnapshotNote('') }}>先存一份快照</TinyButton></div>
                {needsSnapshotGuard && <div className="mt-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] leading-6 text-amber-700">现在优先级修订还没留快照。动手前先存一个版本，会更敢改。</div>}
                <div className="mt-3 space-y-3">{nowRevisions.length > 0 ? nowRevisions.map((item) => <RevisionRow key={item.id} item={item} onUpdateStatus={onUpdateRevisionStatus} onRemove={onRemoveRevision} onFocusBlock={onFocusRevisionBlock} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">当前没有“现在先改”的修订。结构和人物提醒都可以一键送进这里。</div>}</div>
                {latestSnapshot && <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface)] px-3 py-2"><div><p className="text-[11px] font-medium text-[var(--color-ink)]">最近快照</p><p className="mt-1 text-[10px] tracking-[0.14em] text-[var(--color-ink-faint)]">{formatTime(latestSnapshot.createdAt)}</p></div><TinyButton onClick={() => onRestoreSnapshot(latestSnapshot)}>恢复最近快照</TinyButton></div>}
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-ink)]">当前场景待用素材</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">把这一场暂时要用的片段先堆在这里，写的时候直接消费，不让素材继续躺在总列表里。</p></div><span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{currentSceneQueuedMaterials.length} 条</span></div>
                <div className="mt-3 space-y-3">{currentSceneQueuedMaterials.length > 0 ? currentSceneQueuedMaterials.map((item) => <MaterialRow key={item.id} item={item} onUpdateTags={onUpdateMaterialTags} onMarkUsed={(materialId) => onUpdateMaterialStatus(materialId, 'used')} onMoveToInbox={onMoveMaterialToInbox} onLinkToRevision={onLinkMaterialToRevision} onConvertToMemory={onConvertMaterialToMemory} onRemove={onRemoveMaterial} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">{currentScene ? '这场还没有待用素材。你可以从选中文本、织带回声或手动记录把片段收进来。' : '先让当前段落绑定一个场景卡，素材池才会围绕这一场开始工作。'}</div>}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4"><p className="text-sm font-medium text-[var(--color-ink)]">修改雷达</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">适合先找当前段落的明显问题点。</p><button type="button" onClick={onRunRevisionRadar} className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]">{assistLoading.revision_radar ? '分析中...' : '运行雷达'}</button>{assistResults.revision_radar?.items[0] && <div className="mt-3 rounded-xl bg-[var(--color-surface)] px-3 py-2"><p className="text-xs font-medium text-[var(--color-ink)]">{assistResults.revision_radar.items[0].title}</p><p className="mt-1 text-[11px] leading-6 text-[var(--color-ink-light)]">{assistResults.revision_radar.items[0].detail}</p></div>}</div>
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4"><p className="text-sm font-medium text-[var(--color-ink)]">仿写陪练</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">需要拆写法而不是继续改结构时再开。</p><button type="button" onClick={onRunImitationDrill} className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]">{assistLoading.imitation ? '分析中...' : '开始陪练'}</button>{assistResults.imitation?.items[0] && <div className="mt-3 rounded-xl bg-[var(--color-surface)] px-3 py-2"><p className="text-xs font-medium text-[var(--color-ink)]">{assistResults.imitation.items[0].title}</p><p className="mt-1 text-[11px] leading-6 text-[var(--color-ink-light)]">{assistResults.imitation.items[0].detail}</p></div>}</div>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">仿写练习流</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      跑完一次陪练后，把值得做的练习真正收进这一场，而不是只看一眼结果。
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                    {currentScenePracticeDrills.length} 条
                  </span>
                </div>
                {assistResults.imitation?.items[0] && (
                  <div className="mt-3 rounded-xl bg-[var(--color-surface)] px-3 py-3">
                    <p className="text-xs font-medium text-[var(--color-ink)]">{assistResults.imitation.items[0].title}</p>
                    <p className="mt-1 text-[11px] leading-6 text-[var(--color-ink-light)]">{assistResults.imitation.items[0].detail}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <TinyButton onClick={() => onAddPracticeDrill({
                        title: assistResults.imitation?.items[0]?.title ?? '仿写练习',
                        detail: assistResults.imitation?.items[0]?.detail ?? '',
                        focus: assistResults.imitation?.items[0]?.tag,
                        sceneId: currentScene?.id,
                        blockId: currentBlockId,
                      })}>加入练习流</TinyButton>
                      <TinyButton onClick={() => onAddManualMaterial({
                        content: `${assistResults.imitation?.items[0]?.title ?? '仿写练习'}：${assistResults.imitation?.items[0]?.detail ?? ''}`,
                        tags: ['仿写陪练', ...(assistResults.imitation?.items[0]?.tag ? [assistResults.imitation.items[0].tag] : [])],
                      })}>收进素材箱</TinyButton>
                    </div>
                  </div>
                )}
                <div className="mt-3 space-y-3">
                  {currentScenePracticeDrills.length > 0 ? (
                    currentScenePracticeDrills.map((item) => (
                      <PracticeDrillRow key={item.id} item={item} onUpdateStatus={onUpdatePracticeDrillStatus} onRemove={onRemovePracticeDrill} onFocusBlock={focusBlockFromWatch} />
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                      当前场景还没有仿写练习。先跑一次陪练，再把值得做的练习留下来。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">写作画像</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      先看清最近卡在哪、哪一层正在变重，再决定现在该继续写、先收口，还是先补骨架。
                    </p>
                  </div>
                  {profile.topTags.length > 0 && (
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      高频标签：{profile.topTags.slice(0, 2).join(' / ')}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {profileSignals.map((item) => (
                    <ProfileSignalCard key={item.id} title={item.title} detail={item.detail} tone={item.tone} />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">微练习</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      每次只做一个 3-5 分钟动作，让修订、人物、场景和素材真正进入正文，而不是继续堆在面板里。
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                    {microExercises.length} 项
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {microExercises.length > 0 ? (
                    microExercises.map((item) => (
                      <MicroExerciseCard
                        key={item.id}
                        title={item.title}
                        detail={item.detail}
                        ctaLabel={item.ctaLabel}
                        onClick={() => {
                          if (item.id === 'repair-one' && nowRevisions[0]) {
                            onFocusRevisionBlock(nowRevisions[0])
                            return
                          }
                          if (item.id === 'scene-bone') {
                            setTab('scenes')
                            return
                          }
                          if (item.id === 'character-voice' && openCharacterWatchItems[0]) {
                            focusBlockFromWatch(openCharacterWatchItems[0].blockId)
                            return
                          }
                          if (item.id === 'material-use') {
                            setTab('today')
                            return
                          }
                          if (item.id === 'style-drill') {
                            onRunImitationDrill()
                          }
                        }}
                      />
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                      现在还没有明显堆积的问题。保持当前节奏继续写，等下一轮修订或人物提醒浮出来再做针对性练习。
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">作者记忆图谱</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      从当前场景提炼出可长期回看的记忆节点，让人物、关系、母题、意象和时间线开始沉淀下来。
                    </p>
                  </div>
                  <TinyButton onClick={onRunSceneMemoryMap} disabled={!currentParagraph.trim()}>
                    {assistLoading.memory_map ? '提炼中...' : '提炼当前场景'}
                  </TinyButton>
                </div>
                <div className="mt-3">
                  <ResultSection
                    result={extractedMemoryResult}
                    emptyText="先从当前场景提炼一次，记忆图谱会开始长出第一批节点。"
                    primaryLabel="写入记忆图谱"
                    onPrimary={(item) =>
                      onAddMemoryNode({
                        type:
                          item.tag === '人物'
                            ? 'character'
                            : item.tag === '关系'
                              ? 'relationship'
                              : item.tag === '意象'
                                ? 'imagery'
                                : item.tag === '时间线'
                                  ? 'timeline'
                                  : 'motif',
                        title: item.title,
                        detail: item.detail,
                        sceneId: currentScene?.id,
                        blockId: currentBlockId,
                        source: 'manual_memory_accept',
                      })
                    }
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">当前场景记忆</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      这一场已经沉淀下来的记忆节点会先聚在这里，方便你判断这场究竟留下了什么。
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                    {currentSceneMemoryNodes.length} 条
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {currentSceneMemoryNodes.length > 0 ? (
                    currentSceneMemoryNodes.map((item) => (
                      <MemoryNodeRow key={item.id} item={item} onRemove={onRemoveMemoryNode} />
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                      当前场景还没有记忆节点。先提炼一次，或者从素材与修订慢慢长出来。
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">正在形成的母题</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      这里会慢慢长出你这篇作品最常回返的意象、人物和主题标签。
                    </p>
                  </div>
                  {memoryTagCounts.length > 0 && (
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      {memoryTagCounts.length} 组
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {memoryTagCounts.length > 0 ? (
                    memoryTagCounts.map(([tag, count]) => (
                      <span
                        key={tag}
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-ink-light)]"
                      >
                        {tag} · {count}
                      </span>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                      先给素材和修订打一些标签，作者记忆才会开始长出稳定母题。
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-ink)]">场景骨架</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                      每一场现在积累了多少修订和人物注意点，能帮你快速看出哪几场最松。
                    </p>
                  </div>
                  {currentScene && (
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      当前：{currentScene.title}
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-3">
                  {sceneMemoryRows.length > 0 ? (
                    sceneMemoryRows.map(({ scene, revisionCount, watchCount }) => (
                      <div key={scene.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--color-ink)]">{scene.title}</p>
                          {currentScene?.id === scene.id && (
                            <span className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                              当前场景
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">{scene.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-ink-faint)]">
                          <span className="rounded-full bg-[var(--color-paper)] px-2 py-1">修订 {revisionCount}</span>
                          <span className="rounded-full bg-[var(--color-paper)] px-2 py-1">人物 {watchCount}</span>
                          {scene.goal && <span className="rounded-full bg-[var(--color-paper)] px-2 py-1">目标已写</span>}
                          {scene.tension && <span className="rounded-full bg-[var(--color-paper)] px-2 py-1">张力已写</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                      先把当前段落沉淀成场景卡，记忆层才会开始长出骨架。
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-ink)]">人物记忆卡</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                        把人物节点、关系线索和未解决的注意点收成角色视角，方便你判断谁正在变厚、谁还在漂移。
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      {characterMemoryCards.length} 人
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {characterMemoryCards.length > 0 ? (
                      characterMemoryCards.map((item) => (
                        <CharacterMemoryCard key={item.key} item={item} onFocusBlock={focusBlockFromWatch} />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                        先从人物一致性里标记几条注意点，或从当前场景提炼一次记忆，人物记忆卡就会慢慢长出来。
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-ink)]">人物线索</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                        这些是还没解决的人物漂移点，会逐渐变成作品的人物记忆层。
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      {openCharacterWatchItems.length} 条
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {openCharacterWatchItems.length > 0 ? (
                      openCharacterWatchItems.map((item) => (
                        <WatchRow
                          key={item.id}
                          item={item}
                          onResolve={onUpdateCharacterWatchStatus}
                          onRemove={onRemoveCharacterWatch}
                          onFocusBlock={focusBlockFromWatch}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                        还没有打开中的人物注意点。人物一致性检查出来的关键提醒会先留在这里。
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-ink)]">最近沉淀</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">
                        最近收进去的素材会先留在这里，方便你回看这一轮写作到底攒下了什么。
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      {recentMemoryMaterials.length} 条
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {recentMemoryMaterials.length > 0 ? (
                      recentMemoryMaterials.map((item) => (
                        <div key={item.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
                          <p className="text-sm leading-7 text-[var(--color-ink)]">{item.content}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(item.tags.length > 0 ? item.tags : [item.source || item.kind]).map((tag) => (
                              <span
                                key={`${item.id}-${tag}`}
                                className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">
                        还没有沉淀下来的素材。你从正文、织带和写作台收纳的片段都会逐渐长在这里。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'revisions' && <div className="space-y-4"><div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><p className="text-sm font-medium text-[var(--color-ink)]">新增一条稍后再改</p><input type="text" value={manualRevisionTitle} onChange={(event) => setManualRevisionTitle(event.target.value)} placeholder="例如：这里动机不够清楚" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none" /><textarea value={manualRevisionDetail} onChange={(event) => setManualRevisionDetail(event.target.value)} rows={3} placeholder="补一句你为什么想回头改它" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none" /><select value={manualRevisionPriority} onChange={(event) => setManualRevisionPriority(event.target.value as RevisionTaskPriority)} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none"><option value="now">现在先改</option><option value="soon">稍后处理</option><option value="watch">先观察</option></select><button type="button" onClick={() => { if (!manualRevisionTitle.trim()) return; onAddRevision({ title: manualRevisionTitle, detail: manualRevisionDetail, kind: 'manual', priority: manualRevisionPriority }); setManualRevisionTitle(''); setManualRevisionDetail(''); setManualRevisionPriority('soon') }} className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]">加入清单</button></div>{([['现在先改', nowRevisions], ['待处理', pendingRevisions], ['最近完成', completedRevisions]] as const).map(([label, list]) => <div key={label}><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">{label}</p><span className="text-[10px] text-[var(--color-ink-faint)]">{list.length} 条</span></div><div className="space-y-3">{list.length > 0 ? list.map((item) => <RevisionRow key={item.id} item={item} onUpdateStatus={onUpdateRevisionStatus} onRemove={onRemoveRevision} onFocusBlock={onFocusRevisionBlock} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">这里暂时还是空的。</div>}</div></div>)}</div>}

          {tab === 'materials' && <div className="space-y-4"><div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><p className="text-sm font-medium text-[var(--color-ink)]">手动收一条素材</p><textarea value={manualMaterial} onChange={(event) => setManualMaterial(event.target.value)} rows={3} placeholder="一句片段、一个意象、一个动作，或者你想留住的句子" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none" /><input type="text" value={manualMaterialTags} onChange={(event) => setManualMaterialTags(event.target.value)} placeholder="标签：人物, 场景, 意象" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none" /><button type="button" onClick={() => { if (!manualMaterial.trim()) return; onAddManualMaterial({ content: manualMaterial, tags: parseTags(manualMaterialTags) }); setManualMaterial(''); setManualMaterialTags('') }} className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]">收进素材箱</button></div><div><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">待分配</p><span className="text-[10px] text-[var(--color-ink-faint)]">{inboxMaterials.length} 条</span></div><div className="space-y-3">{inboxMaterials.length > 0 ? inboxMaterials.map((item) => <MaterialRow key={item.id} item={item} onUpdateTags={onUpdateMaterialTags} onAssignToCurrentScene={currentScene ? onAssignMaterialToCurrentScene : undefined} onLinkToRevision={onLinkMaterialToRevision} onConvertToMemory={onConvertMaterialToMemory} onRemove={onRemoveMaterial} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">暂时没有待分配素材。</div>}</div></div><div><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">当前场景待用</p><span className="text-[10px] text-[var(--color-ink-faint)]">{currentSceneQueuedMaterials.length} 条</span></div><div className="space-y-3">{currentSceneQueuedMaterials.length > 0 ? currentSceneQueuedMaterials.map((item) => <MaterialRow key={item.id} item={item} onUpdateTags={onUpdateMaterialTags} onMarkUsed={(materialId) => onUpdateMaterialStatus(materialId, 'used')} onMoveToInbox={onMoveMaterialToInbox} onLinkToRevision={onLinkMaterialToRevision} onConvertToMemory={onConvertMaterialToMemory} onRemove={onRemoveMaterial} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">当前场景还没有待用素材。</div>}</div></div><div><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">最近已用</p><span className="text-[10px] text-[var(--color-ink-faint)]">{recentlyUsedMaterials.length} 条</span></div><div className="space-y-3">{recentlyUsedMaterials.length > 0 ? recentlyUsedMaterials.map((item) => <MaterialRow key={item.id} item={item} onUpdateTags={onUpdateMaterialTags} onMoveToInbox={onMoveMaterialToInbox} onLinkToRevision={onLinkMaterialToRevision} onConvertToMemory={onConvertMaterialToMemory} onRemove={onRemoveMaterial} />) : <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-[11px] leading-6 text-[var(--color-ink-faint)]">还没有被真正用掉的素材。</div>}</div></div></div>}

          {tab === 'scenes' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
                <p className="text-sm font-medium text-[var(--color-ink)]">新建场景卡</p>
                <div className="mt-2 grid grid-cols-[1.1fr_1.9fr] gap-2">
                  <input
                    type="text"
                    value={sceneChapter}
                    onChange={(event) => setSceneChapter(event.target.value)}
                    placeholder={currentScene ? `默认：${sceneChapterLabel(currentScene)}` : '所属章节'}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none"
                  />
                  <input
                    type="text"
                    value={sceneTitle}
                    onChange={(event) => setSceneTitle(event.target.value)}
                    placeholder="这一场在干嘛"
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none"
                  />
                </div>
                <textarea
                  value={sceneSummary}
                  onChange={(event) => setSceneSummary(event.target.value)}
                  rows={3}
                  placeholder="这一段发生了什么"
                  className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-6 text-[var(--color-ink)] outline-none"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input type="text" value={sceneGoal} onChange={(event) => setSceneGoal(event.target.value)} placeholder="推进目标" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" />
                  <input type="text" value={sceneTension} onChange={(event) => setSceneTension(event.target.value)} placeholder="阻力或张力" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!sceneTitle.trim() && !sceneSummary.trim()) return
                    onAddScene({
                      chapterTitle: sceneChapter,
                      title: sceneTitle || '未命名场景',
                      summary: sceneSummary || currentParagraph,
                      goal: sceneGoal,
                      tension: sceneTension,
                    })
                    setSceneChapter('')
                    setSceneTitle('')
                    setSceneSummary('')
                    setSceneGoal('')
                    setSceneTension('')
                  }}
                  className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]"
                >
                  建卡
                </button>
              </div>

              {chapterGroups.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-faint)]">还没有场景卡。你可以直接从当前段落生成一张。</p>
              ) : (
                chapterGroups.map((group) => (
                  <div key={group.title} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[var(--color-ink)]">{group.title}</p>
                          <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-faint)]">{group.rows.length} 场</span>
                          {currentChapterGroup?.title === group.title && <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-ink-light)]">当前章节</span>}
                        </div>
                        <p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">修订 {group.openRevisionCount} · 人物 {group.openWatchCount} · 待用素材 {group.queuedMaterialCount} · 记忆 {group.memoryCount}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {group.rows.map(({ scene, stats }) => (
                        <ChapterSceneCard
                          key={scene.id}
                          item={scene}
                          stats={stats}
                          isCurrent={currentScene?.id === scene.id}
                          onUpdate={onUpdateScene}
                          onRemove={onRemoveScene}
                          onFocusBlock={focusBlockFromWatch}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'snapshots' && <div className="space-y-4"><div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-3"><p className="text-sm font-medium text-[var(--color-ink)]">轻量快照</p><p className="mt-1 text-xs leading-6 text-[var(--color-ink-light)]">在大改之前按一下，第二天想回头也不怕。</p><input type="text" value={snapshotNote} onChange={(event) => setSnapshotNote(event.target.value)} placeholder="给这次快照留一句备注" className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink)] outline-none" /><button type="button" onClick={() => { onCreateSnapshot(snapshotNote); setSnapshotNote('') }} className="mt-3 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-light)]">保存当前版本</button></div>{workspace.snapshots.length === 0 ? <p className="text-xs text-[var(--color-ink-faint)]">还没有快照。适合在重写、删改或大换结构之前留一份。</p> : workspace.snapshots.map((item) => <SnapshotRow key={item.id} item={item} onRestore={onRestoreSnapshot} onRemove={onRemoveSnapshot} />)}</div>}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
