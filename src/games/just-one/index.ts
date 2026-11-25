import type { GameDefinition } from '../../core/game'
import { justOneApi } from './api'
import { JustOneGame } from './JustOneGame'
import { s } from './strings.de'

export const justOne: GameDefinition = {
  id: 'just-one',
  name: s.name,
  description: s.description,
  icon: '☝️',
  color: '#9ec9b4',
  minPlayers: 3,
  maxPlayers: 10,
  start: justOneApi.start,
  View: JustOneGame,
}
