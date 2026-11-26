import { rpc } from '../../core/rpc'

export type Phase = 'hints' | 'voting' | 'guessing' | 'round_result' | 'game_over'
export type Outcome = 'escaped' | 'caught_guessed' | 'caught_missed' | 'cancelled'

export interface Game {
  phase: Phase
  round_no: number
  category: string
  grid: string[]
  /** Players of this round, in speaking order. */
  player_ids: string[]
  voted_ids: string[]
  vote_no: number
  candidate_ids: string[]
  /** The next three stay null until the round reveals them. */
  imposter_id: string | null
  word: string | null
  outcome: Outcome | null
  guess: string | null
  accused_id: string | null
}

export interface Vote {
  vote_no: number
  voter_id: string
  target_id: string
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** Own role only; null for someone who joined after the round started. */
  role: { is_imposter: boolean; word: string | null } | null
  votes: Vote[]
  scores: Record<string, number>
}

export const imposterApi = {
  start: (roomId: string) => rpc('imposter_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('imposter_snapshot', { p_room_id: roomId }),
}

/** In-game actions, bound to one room and round. */
export function roundActions(roomId: string, roundNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`imposter_${fn}`, { p_room_id: roomId, p_round_no: roundNo, ...args })
  return {
    openVoting: () => call('open_voting'),
    vote: (voteNo: number, targetId: string) =>
      call('vote', { p_vote_no: voteNo, p_target_id: targetId }),
    closeVoting: () => call('close_voting'),
    guess: (word: string) => call('guess', { p_word: word }),
    skipGuess: () => call('skip_guess'),
    cancelRound: () => call('cancel_round'),
    nextRound: () => call('next_round'),
    endGame: () => call('end_game'),
  }
}

export type RoundActions = ReturnType<typeof roundActions>
