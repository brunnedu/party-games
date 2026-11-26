import { rpc } from '../../core/rpc'

export type Phase = 'clue' | 'guessing' | 'reveal' | 'game_over'
export type Mode = 'shared' | 'individual'

export interface Game {
  phase: Phase
  round_no: number
  rounds_played: number
  rounds_total: number
  points: number
  giver_id: string
  left_label: string
  right_label: string
  /** null if the clue was said out loud. */
  clue: string | null
  mode: Mode
  /** Position of the shared dial, 0-100. */
  dial: number
  done_ids: string[]
  /** null until the reveal. */
  target: number | null
  round_points: number | null
}

export interface Guess {
  player_id: string
  position: number
  points: number | null
}

export interface HistoryEntry {
  round_no: number
  left_label: string
  right_label: string
  clue: string | null
  target: number
  points: number
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** Only the clue-giver gets this. */
  secret_target: number | null
  guesses: Guess[]
  history: HistoryEntry[]
}

export const wavelengthApi = {
  start: (roomId: string) => rpc('wavelength_start', { p_room_id: roomId }),
  snapshot: (roomId: string) =>
    rpc<Snapshot | null>('wavelength_snapshot', { p_room_id: roomId }),
}

/** In-game actions, bound to one room and round. */
export function roundActions(roomId: string, roundNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`wavelength_${fn}`, { p_room_id: roomId, p_round_no: roundNo, ...args })
  return {
    giveClue: (mode: Mode, clue: string) => call('give_clue', { p_mode: mode, p_clue: clue }),
    moveDial: (position: number) => call('move_dial', { p_position: position }),
    confirm: (position: number) => call('confirm', { p_position: position }),
    submitGuess: (position: number) => call('submit_guess', { p_position: position }),
    forceReveal: () => call('force_reveal'),
    skipRound: () => call('skip_round'),
    nextRound: () => call('next_round'),
  }
}

export type RoundActions = ReturnType<typeof roundActions>
