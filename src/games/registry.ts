import type { GameDefinition } from '../core/game'
import { justOne } from './just-one'

export const GAMES: readonly GameDefinition[] = [justOne]

export function findGame(id: string | undefined) {
  return GAMES.find((g) => g.id === id)
}
