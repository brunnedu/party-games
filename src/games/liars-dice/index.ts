import type { GameDefinition } from '../../core/game'
import { liarsApi } from './api'
import { LiarsDiceGame } from './LiarsDiceGame'
import { LiarsLobbySettings } from './LobbySettings'
import { LiarsDiceLogo } from './Logo'
import { s } from './strings.de'

export const liarsDice: GameDefinition = {
  id: 'liars-dice',
  name: s.name,
  description: s.description,
  Logo: LiarsDiceLogo,
  color: '#a8c4dc',
  minPlayers: 2,
  maxPlayers: 10,
  start: liarsApi.start,
  LobbySettings: LiarsLobbySettings,
  View: LiarsDiceGame,
}
