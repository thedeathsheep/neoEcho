'use client'

import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--color-paper)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-ink)',
          fontFamily: 'var(--font-serif)',
        },
        className: 'font-serif',
      }}
    />
  )
}
