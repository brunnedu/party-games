// Small helpers about who sits where. The database decides; these only drive
// what is shown.
import type { Game } from './api'

export const diceOf = (game: Pick<Game, 'dice_counts'>, id: string) => game.dice_counts[id] ?? 0

/** The player with dice before `id` in the seating order, wrapping around. */
export function previousPlayer(
  game: Pick<Game, 'dice_counts' | 'order_ids'>,
  id: string,
): string | undefined {
  const order = game.order_ids
  const start = order.indexOf(id)
  if (start < 0) return undefined
  for (let step = 1; step < order.length; step++) {
    const other = order[(start - step + order.length) % order.length]!
    if (diceOf(game, other) > 0) return other
  }
  return undefined
}

export const totalDice = (game: Pick<Game, 'dice_counts'>) =>
  Object.values(game.dice_counts).reduce((sum, n) => sum + n, 0)

/** How many dice show each number, as [1s, 2s, …, 6s]. */
export function countFaces(revealed: Record<string, number[]>): number[] {
  const counts = [0, 0, 0, 0, 0, 0]
  for (const face of Object.values(revealed).flat()) counts[face - 1]!++
  return counts
}

/** Winner first, then the others in reverse order of being eliminated. */
export function standings(game: Pick<Game, 'dice_counts' | 'order_ids' | 'eliminated_ids'>) {
  const left = game.order_ids
    .filter((id) => diceOf(game, id) > 0)
    .sort((a, b) => diceOf(game, b) - diceOf(game, a))
  return [...left, ...[...game.eliminated_ids].reverse()]
}
