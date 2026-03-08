import { nanoid } from 'nanoid'

export function generateId(size = 21): string {
  return nanoid(size)
}

export function generateShortId(): string {
  return nanoid(12)
}

export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)

  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const { createHash } = await import('crypto')
  return createHash('sha256').update(input).digest('hex')
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}
