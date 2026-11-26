export interface Ranked<T> {
  player: T
  score: number
  /** Equal scores share a rank: 1, 1, 3, … */
  rank: number
}

export function ranking<T extends { user_id: string }>(
  players: T[],
  scores: Record<string, number>,
): Ranked<T>[] {
  const sorted = players
    .map((player) => ({ player, score: scores[player.user_id] ?? 0 }))
    .sort((a, b) => b.score - a.score)
  return sorted.map((entry) => ({
    ...entry,
    rank: 1 + sorted.findIndex((other) => other.score === entry.score),
  }))
}
