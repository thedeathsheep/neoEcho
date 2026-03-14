/**
 * Sanitize text for display: fix orphaned punctuation, improper spaces.
 * Does not modify the original data; use only at render time.
 */
export function sanitizeForDisplay(text: string): string {
  if (!text || typeof text !== 'string') return text ?? ''

  let s = text.trim()

  // 1. Collapse consecutive whitespace (spaces, tabs) to single space
  s = s.replace(/\s{2,}/g, ' ')

  // 2. Remove space before Chinese punctuation (。，、；：！？)
  s = s.replace(/\s+([。，、；：！？])/g, '$1')

  // 3. Remove orphaned punctuation at line/paragraph start (断头标)
  s = s.replace(/(^|\n)\s*[。，、；：！？]+/g, '$1')

  // 4. Normalize full-width space to regular space
  s = s.replace(/\u3000/g, ' ')

  // 5. Collapse any new double spaces from step 4
  s = s.replace(/\s{2,}/g, ' ')

  return s.trim()
}
