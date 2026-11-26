import type { GameDefinition } from '../core/game'
import { imposter } from './imposter'
import { justOne } from './just-one'
import { liarsDice } from './liars-dice'
import { walter } from './walter'
import { wavelength } from './wavelength'

export const GAMES: readonly GameDefinition[] = [justOne, imposter, wavelength, walter, liarsDice]

export function findGame(id: string | undefined) {
  return GAMES.find((g) => g.id === id)
}
