import type { GameDefinition } from '../../core/game'
import { imposterApi } from './api'
import { ImposterGame } from './ImposterGame'
import { s } from './strings.de'

export const imposter: GameDefinition = {
  id: 'imposter',
  name: s.name,
  description: s.description,
  icon: '🕵️',
  color: '#c9b3dd',
  minPlayers: 3,
  maxPlayers: 10,
  start: imposterApi.start,
  View: ImposterGame,
}
