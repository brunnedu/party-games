import type { GameDefinition } from '../core/game'
import { imposter } from './imposter'
import { justOne } from './just-one'

export const GAMES: readonly GameDefinition[] = [justOne, imposter]

export function findGame(id: string | undefined) {
  return GAMES.find((g) => g.id === id)
}
