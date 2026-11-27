import type { GameDefinition } from '../../core/game'
import { ActivityGame } from './ActivityGame'
import { activityApi } from './api'
import { ActivityLobbySettings } from './LobbySettings'
import { ExtremeActivityLogo } from './Logo'
import { s } from './strings.de'

export const extremeActivity: GameDefinition = {
  id: 'extreme-activity',
  name: s.name,
  description: s.description,
  Logo: ExtremeActivityLogo,
  color: '#f0c27b',
  // One phone is enough; the people playing need not all have one.
  minPlayers: 1,
  maxPlayers: 10,
  playersLabel: s.playersLabel,
  start: activityApi.start,
  LobbySettings: ActivityLobbySettings,
  View: ActivityGame,
}
