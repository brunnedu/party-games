import type { GameDefinition } from '../core/game'
import { imposter } from './imposter'
import { justOne } from './just-one'
import { wavelength } from './wavelength'

export const GAMES: readonly GameDefinition[] = [justOne, imposter, wavelength]

export function findGame(id: string | undefined) {
  return GAMES.find((g) => g.id === id)
}
