import type { GameDefinition } from '../../core/game'
import { imposterApi } from './api'
import { ImposterGame } from './ImposterGame'
import { ImposterLogo } from './Logo'
import { s } from './strings.de'

export const imposter: GameDefinition = {
  id: 'imposter',
  name: s.name,
  description: s.description,
  Logo: ImposterLogo,
  color: '#c9b3dd',
  minPlayers: 3,
  maxPlayers: 10,
  rejoin: 'between-rounds',
  start: imposterApi.start,
  View: ImposterGame,
}
