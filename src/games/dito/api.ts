import { rpc } from '../../core/rpc'

export type Phase = 'choosing' | 'writing' | 'reveal' | 'round_end' | 'game_over'
export type CellState = 'open' | 'circled' | 'crossed'

export interface Cell {
  /** 0..8, row by row. */
  cell: number
  answer: string
  state: CellState
  star: boolean
}

export interface OwnCell extends Cell {
  category_no: number
}

export interface Objection {
  no: number
  target_id: string
  by_id: string
  voted_ids: string[]
  opened_at: string
}

export interface LastReading {
  reader_id: string
  answer: string
  matches: { player_id: string; answer: string }[]
}

export interface PlayerRound {
  circles: number
  stars: number
  star_points: number
  bonus: number
  points: number
  cells: Cell[]
}

export interface Game {
  phase: Phase
  /** Counts every new screen. */
  step: number
  round_no: number
  category_no: number
  order_ids: string[]
  three_players: boolean
  chooser_id: string
  /** The categories chosen in this round so far. */
  categories: string[]
  submitted_ids: string[]
  reader_id: string | null
  /** null while the reader is choosing an answer. */
  read_cell: number | null
  /** Counts every change to the claims. */
  revision: number
  objection: Objection | null
  open_counts: Record<string, number>
  last_reading: LastReading | null
  /** Everyone's grid and points, once the round is over. */
  summary: Record<string, PlayerRound> | null
}

/** One player's part in the current reading. */
export interface Claim {
  player_id: string
  /** The answer they circle; null for none. */
  cell: number | null
  answer: string | null
  /** Their other answers that mean the same; these get crossed out. */
  also: number[]
  also_text: string[]
  /** What the app preselected. */
  auto_cell: number | null
  rev: number
  settled: boolean
  rejected: { cell: number | null; also: number[] }[]
}

export interface Score {
  score: number
  best_round: number
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** The two categories on the card, for the chooser only. */
  options: string[] | null
  own: OwnCell[]
  claims: Claim[]
  scores: Record<string, Score>
}

export const ditoApi = {
  start: (roomId: string) => rpc('dito_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('dito_snapshot', { p_room_id: roomId }),
  lobby: (roomId: string) =>
    rpc<{ order_ids: string[] } | null>('dito_lobby', { p_room_id: roomId }),
  setOrder: (roomId: string, order: string[]) =>
    rpc('dito_set_order', { p_room_id: roomId, p_order: order }),
}

/** In-game actions, bound to one room and screen. */
export function stepActions(roomId: string, step: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`dito_${fn}`, { p_room_id: roomId, p_step: step, ...args })
  return {
    choose: (category: string) => call('choose', { p_category: category }),
    submit: (cells: number[], answers: string[]) =>
      call('submit', { p_cells: cells, p_answers: answers }),
    read: (cell: number) => call('read', { p_cell: cell }),
    claim: (cell: number | null, also: number[]) =>
      call('claim', { p_cell: cell, p_also: also }),
    object: (target: string, rev: number) => call('object', { p_target: target, p_rev: rev }),
    vote: (objection: number, accept: boolean) =>
      call('vote', { p_objection: objection, p_accept: accept }),
    closeVote: (objection: number) => call('close_vote', { p_objection: objection }),
    confirm: (revision: number) => call('confirm', { p_revision: revision }),
    nextRound: () => call('next_round'),
    skip: () => call('skip'),
    forceContinue: () => call('force_continue'),
  }
}

export type StepActions = ReturnType<typeof stepActions>
