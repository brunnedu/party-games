import { rpc } from '../../core/rpc'

export type Phase =
  | 'choosing_word'
  | 'writing_clues'
  | 'reviewing_clues'
  | 'guessing'
  | 'round_result'
  | 'game_over'

export type Result = 'correct' | 'wrong' | 'pass'

export interface Game {
  phase: Phase
  round_no: number
  guesser_id: string
  cards_total: number
  cards_used: number
  score: number
  submitted_ids: string[]
  confirmed_ids: string[]
}

export interface Clue {
  player_id: string
  clue: string
  auto_cancelled: boolean
  manual_cancelled: boolean
}

export interface HistoryEntry {
  round_no: number
  guess: string | null
  result: Result
  word: string | null
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** null for the guesser until the round is over. */
  word: string | null
  clues: Clue[]
  history: HistoryEntry[]
}

export const justOneApi = {
  start: (roomId: string) => rpc('just_one_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('just_one_snapshot', { p_room_id: roomId }),
}

/** In-game actions, bound to one room and round. */
export function roundActions(roomId: string, roundNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`just_one_${fn}`, { p_room_id: roomId, p_round_no: roundNo, ...args })
  return {
    acceptWord: () => call('accept_word'),
    skipWord: (word: string) => call('skip_word', { p_word: word }),
    submitClue: (clue: string) => call('submit_clue', { p_clue: clue }),
    toggleClue: (playerId: string) => call('toggle_clue', { p_player_id: playerId }),
    confirmReview: () => call('confirm_review'),
    submitGuess: (guess: string | null) => call('submit_guess', { p_guess: guess }),
    acceptGuess: () => call('accept_guess'),
    nextRound: () => call('next_round'),
    forceContinue: () => call('force_continue'),
    skipRound: () => call('skip_round'),
  }
}

export type RoundActions = ReturnType<typeof roundActions>
