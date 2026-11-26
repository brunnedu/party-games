import type { GameDefinition } from '../../core/game'
import { justOneApi } from './api'
import { JustOneGame } from './JustOneGame'
import { JustOneLogo } from './Logo'
import { s } from './strings.de'

export const justOne: GameDefinition = {
  id: 'just-one',
  name: s.name,
  description: s.description,
  Logo: JustOneLogo,
  color: '#9ec9b4',
  minPlayers: 3,
  maxPlayers: 10,
  start: justOneApi.start,
  View: JustOneGame,
}
