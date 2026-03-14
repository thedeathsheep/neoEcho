'use client'

import { useCallback, useEffect, useRef } from 'react'

import { devLog } from '@/lib/dev-log'

interface HeartbeatOptions {
  pauseThreshold?: number
  onPause: (text: string) => void
}

export function useHeartbeat({ pauseThreshold = 500, onPause }: HeartbeatOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textRef = useRef('')
  const beatCountRef = useRef(0)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const beat = useCallback(
    (text: string) => {
      textRef.current = text
      beatCountRef.current += 1

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        const count = beatCountRef.current
        devLog.push('heartbeat', 'onPause fired (ribbon refresh)', {
          textLen: textRef.current.length,
          beatCount: count,
        })
        onPause(textRef.current)
      }, pauseThreshold)
    },
    [pauseThreshold, onPause],
  )

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return { beat, stop }
}
