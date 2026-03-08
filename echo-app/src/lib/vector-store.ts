/**
 * In-memory vector store with cosine similarity search.
 * Chunks (with embeddings) are stored in IndexedDB; this module scores in-memory arrays.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Find top-k items by vector similarity.
 */
export function searchVectors<T extends { embedding?: number[] }>(
  queryEmbedding: number[],
  items: T[],
  k: number,
): Array<{ item: T; score: number }> {
  const withScores = items
    .filter((item): item is T & { embedding: number[] } => !!item.embedding?.length)
    .map((item) => ({
      item,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    }))
    .filter((x) => x.score > 0)

  withScores.sort((a, b) => b.score - a.score)
  return withScores.slice(0, k)
}
