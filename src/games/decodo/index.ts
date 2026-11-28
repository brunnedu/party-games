import type { GameDefinition } from '../../core/game'
import { decodoApi } from './api'
import { DecodoGame } from './DecodoGame'
import { DecodoLobbySettings } from './LobbySettings'
import { DecodoLogo } from './Logo'
import { s } from './strings.de'

export const decodo: GameDefinition = {
  id: 'decodo',
  name: s.name,
  description: s.description,
  Logo: DecodoLogo,
  color: '#b9c9d9',
  minPlayers: 4,
  maxPlayers: 8,
  start: decodoApi.start,
  LobbySettings: DecodoLobbySettings,
  View: DecodoGame,
}
