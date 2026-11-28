import type { GameDefinition } from '../../core/game'
import { ditoApi } from './api'
import { DitoGame } from './DitoGame'
import { DitoLobbySettings } from './LobbySettings'
import { DitoLogo } from './Logo'
import { s } from './strings.de'

export const dito: GameDefinition = {
  id: 'dito',
  name: s.name,
  description: s.description,
  Logo: DitoLogo,
  color: '#bcd6a4',
  minPlayers: 3,
  maxPlayers: 10,
  start: ditoApi.start,
  LobbySettings: DitoLobbySettings,
  View: DitoGame,
}
