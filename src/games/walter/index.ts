import type { GameDefinition } from '../../core/game'
import { walterApi } from './api'
import { WalterLogo } from './Logo'
import { s } from './strings.de'
import { WalterGame } from './WalterGame'

export const walter: GameDefinition = {
  id: 'walter',
  name: s.name,
  description: s.description,
  Logo: WalterLogo,
  color: '#e6a49a',
  minPlayers: 3,
  maxPlayers: 10,
  start: walterApi.start,
  View: WalterGame,
}
