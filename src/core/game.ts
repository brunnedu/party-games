import type { ComponentType } from 'react'
import type { Player, Room } from './room/api'

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
  icon: string
  /** Background color of the game's picture on the hub. */
  color: string
  /** Keep in sync with the game_types table, which enforces these. */
  minPlayers: number
  maxPlayers: number
  /** Starts the game for a room (host only). */
  start: (roomId: string) => Promise<unknown>
  /** Shown while the room is "playing" or "finished". */
  View: ComponentType<GameViewProps>
}
