import type { ComponentType } from 'react'
import type { Player, Room } from './room/api'

export interface LogoProps {
  className?: string
}

/** What every game screen gets from the room. */
export interface GameViewProps {
  room: Room
  players: Player[]
  userId: string
  /** Who is connected right now; null while that is still unknown. */
  online: ReadonlySet<string> | null
  /** Re-load the room after an action. */
  refresh: () => Promise<void>
}

export interface GameDefinition {
  /** Used in URLs and as rooms.game_type; must exist in the game_types table. */
  id: string
  name: string
  description: string
  /** Drawn as SVG, shown on the hub, the landing page and above the game. */
  Logo: ComponentType<LogoProps>
  /** Background color of the game's picture on the hub. */
  color: string
  /** Keep in sync with the game_types table, which enforces these. */
  minPlayers: number
  maxPlayers: number
  /** Replaces the "2–10 Personen" line, if phones and people differ. */
  playersLabel?: string
  /** Starts the game for a room (host only). */
  start: (roomId: string) => Promise<unknown>
  /** Optional extra card in the lobby, e.g. for settings the host chooses. */
  LobbySettings?: ComponentType<GameViewProps>
  /** Shown while the room is "playing" or "finished". */
  View: ComponentType<GameViewProps>
}
