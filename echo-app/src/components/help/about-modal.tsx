'use client'

import { useState } from 'react'

import { GUIDE_SECTIONS } from '@/lib/onboarding-content'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [activeSection, setActiveSection] = useState(GUIDE_SECTIONS[0]?.id ?? 'getting-started')

  if (!isOpen) return null

  const activeSectionData =
    GUIDE_SECTIONS.find((section) => section.id === activeSection) ?? GUIDE_SECTIONS[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <div className="flex w-48 flex-col border-r border-[var(--color-border)] bg-[var(--color-paper)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="font-medium text-[var(--color-ink)]">帮助中心</h3>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {GUIDE_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  activeSectionData.id === section.id
                    ? 'bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-light)] hover:bg-[var(--color-ink)]/5'
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="font-medium text-[var(--color-ink)]">{activeSectionData.title}</h3>
            <button
              onClick={onClose}
              className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
              aria-label="关闭帮助"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--color-ink)]">
              {activeSectionData.content}
            </pre>
          </div>
          <div className="border-t border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-3">
            <p className="text-xs text-[var(--color-ink-faint)]">
              NeoEcho v0.1.0 · 首次启动会附带一篇“功能说明”文档，方便随时回看。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
