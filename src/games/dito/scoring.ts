import type { Ranked } from '../../core/ui/ranking'
import type { Score } from './api'

/** Bonus points for a full row, from the top. The database does the counting. */
export const ROW_BONUS = [3, 2, 1] as const
/** And for a full column, from the left. */
export const COLUMN_BONUS = [1, 2, 3] as const

/**
 * Most points first; a tie goes to the better single round. Equal on both, they
 * share a rank.
 */
export function finalRanking<T extends { user_id: string }>(
  players: T[],
  scores: Record<string, Score>,
): Ranked<T>[] {
  const of = (p: T) => scores[p.user_id] ?? { score: 0, best_round: 0 }
  const compare = (a: T, b: T) =>
    of(b).score - of(a).score || of(b).best_round - of(a).best_round
  const sorted = [...players].sort(compare)
  return sorted.map((player) => ({
    player,
    score: of(player).score,
    rank: 1 + sorted.findIndex((other) => compare(other, player) === 0),
  }))
}
