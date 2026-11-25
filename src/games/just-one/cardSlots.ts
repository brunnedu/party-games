import type { Game, HistoryEntry, Result } from './api'

/** One field of the progress bar: what happened to each of the 13 cards. */
export type Slot = Result | 'lost' | 'current' | 'open'

export function cardSlots(
  game: Pick<Game, 'phase' | 'round_no' | 'cards_total'>,
  history: Pick<HistoryEntry, 'round_no' | 'result'>[],
): Slot[] {
  const slots: Slot[] = []
  let shown: Slot = game.phase === 'game_over' ? 'open' : 'current'

  for (const entry of history) {
    // The running round's card isn't counted yet, and "accept anyway" may
    // still change its result.
    if (game.phase === 'round_result' && entry.round_no === game.round_no) {
      shown = entry.result
      continue
    }
    slots.push(entry.result)
    // A wrong guess also costs the next card, if there is one.
    if (entry.result === 'wrong' && slots.length < game.cards_total) slots.push('lost')
  }

  if (slots.length < game.cards_total) slots.push(shown)
  while (slots.length < game.cards_total) slots.push('open')
  return slots.slice(0, game.cards_total)
}
