'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { adoptionStore, type AdoptionRecord } from '@/services/adoption-store'
import { documentStorage } from '@/lib/document-storage'

interface DocAdoptions {
  documentId: string
  title: string
  adoptions: AdoptionRecord[]
}

export default function GalleryPage() {
  const [docs, setDocs] = useState<DocAdoptions[]>([])

  const load = useCallback(() => {
    const ids = adoptionStore.getDocumentIdsWithAdoptions()
    const list: DocAdoptions[] = ids.map((documentId) => {
      const doc = documentStorage.get(documentId)
      const adoptions = adoptionStore.getAdoptionsByDocument(documentId)
      return {
        documentId,
        title: doc?.title ?? documentId.slice(0, 8),
        adoptions,
      }
    })
    list.sort((a, b) => {
      const aLatest = a.adoptions[0]?.copiedAt ?? ''
      const bLatest = b.adoptions[0]?.copiedAt ?? ''
      return bLatest.localeCompare(aLatest)
    })
    setDocs(list)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const exportMarkdown = useCallback((d: DocAdoptions) => {
    const lines = [
      `# ${d.title}`,
      '',
      `> 灵感策展 · 本文档采纳 ${d.adoptions.length} 条回响`,
      '',
      '---',
      '',
      ...d.adoptions.map((a, i) => {
        const src = a.source ? ` *来自 ${a.source}*` : ''
        const text = (a.originalText ?? a.content ?? '').trim()
        return `${i + 1}. ${text}${src}\n   \`${a.copiedAt}\``
      }),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `策展-${d.title.slice(0, 20)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)] p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold">灵感策展集</h1>
          <Link
            href="/"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            返回写作
          </Link>
        </div>
        <p className="text-sm text-[var(--color-ink-faint)] mb-6">
          复制到剪贴板的织带回响会记录在此，便于回溯本次创作受哪些知识库影响。
        </p>
        {docs.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-faint)]">暂无采纳记录</p>
        ) : (
          <ul className="space-y-6">
            {docs.map((d) => (
              <li
                key={d.documentId}
                className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">{d.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {d.adoptions.length} 条
                    </span>
                    <button
                      type="button"
                      onClick={() => exportMarkdown(d)}
                      className="text-xs px-2 py-1 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25"
                    >
                      导出 Markdown
                    </button>
                  </div>
                </div>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {d.adoptions.slice(0, 30).map((a) => (
                    <li
                      key={a.echoId}
                      className="text-sm text-[var(--color-ink)] border-l-2 border-[var(--color-border)] pl-2"
                    >
                      {(a.originalText ?? a.content ?? '').slice(0, 120)}
                      {(a.originalText ?? a.content ?? '').length > 120 ? '…' : ''}
                      {a.source && (
                        <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
                          来自 {a.source}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {d.adoptions.length > 30 && (
                  <p className="text-xs text-[var(--color-ink-faint)] mt-2">
                    仅展示最近 30 条，导出可见全部
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
