import { rpc } from '../../core/rpc'

export type Phase = 'choosing' | 'writing' | 'voting' | 'reveal' | 'game_over'

export interface Game {
  phase: Phase
  round_no: number
  rounds_played: number
  rounds_total: number
  sphinx_id: string
  /** "WALTER" marks the gap; null while the Sphinx is choosing. */
  sentence: string | null
  player_ids: string[]
  submitted_ids: string[]
  voted_ids: string[]
  answer_count: number
  reveal_step: number
  reveal_steps: number
  /** null until the reveal is complete. */
  round_points: Record<string, number> | null
  sphinx_foul: boolean
}

export interface RevealEntry {
  number: number
  answer: string
  /** The next two arrive with the second step. */
  player_id?: string
  /** Whether this one is the Sphinx's own answer. */
  is_real?: boolean
}

export interface Reveal {
  position: number
  entries: RevealEntry[]
  votes: { voter_id: string; number: number }[]
  resolved: boolean
  is_truth: boolean | null
}

export interface SphinxAnswer {
  answer: string
  number: number | null
  is_real: boolean
}

export interface HistoryEntry {
  round_no: number
  sphinx_id: string
  sentence: string
  truth: string
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** The three sentences, for the Sphinx only. */
  options: string[] | null
  own: { answer: string; number: number | null } | null
  own_vote: number | null
  private: {
    /** All texts without authors, for the Sphinx only. */
    sphinx_answers: SphinxAnswer[] | null
    /** Somebody wrote the same as you. */
    has_twin: boolean
  }
  reveals: Reveal[]
  scores: Record<string, number>
  history: HistoryEntry[]
}

export const walterApi = {
  start: (roomId: string) => rpc('walter_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('walter_snapshot', { p_room_id: roomId }),
}

/** In-game actions, bound to one room and round. */
export function roundActions(roomId: string, roundNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`walter_${fn}`, { p_room_id: roomId, p_round_no: roundNo, ...args })
  return {
    choose: (sentence: string) => call('choose', { p_sentence: sentence }),
    submit: (answer: string) => call('submit', { p_answer: answer }),
    shuffle: () => call('shuffle'),
    startReading: () => call('start_reading'),
    vote: (number: number) => call('vote', { p_number: number }),
    revealNext: (step: number) => call('reveal_next', { p_step: step }),
    forceContinue: () => call('force_continue'),
    skipRound: () => call('skip_round'),
    nextRound: () => call('next_round'),
  }
}

export type RoundActions = ReturnType<typeof roundActions>
