import { rpc } from '../../core/rpc'

export type Phase = 'writing' | 'guessing' | 'reveal' | 'tiebreak' | 'judging' | 'game_over'
/** 0 is Rot, 1 is Blau. Rot's code is guessed first. */
export type Team = 0 | 1
export const TEAMS: readonly Team[] = [0, 1]
export const otherTeam = (team: Team): Team => (team === 0 ? 1 : 0)

export interface Outcome {
  /** null: shared, or nobody if a team ran out of players. */
  winner: Team | null
  reason: 'interceptions' | 'misses' | 'points' | 'words' | 'left'
}

export interface Game {
  phase: Phase
  /** Counts every new screen. */
  step: number
  round_no: number
  /** Whose code is next to be guessed. */
  turn: Team
  red_ids: string[]
  blue_ids: string[]
  red_encryptor: string
  blue_encryptor: string
  red_submitted: boolean
  blue_submitted: boolean
  /** Which guessing teams have locked their guess in. */
  locked: [boolean, boolean]
  interceptions: [number, number]
  misses: [number, number]
  outcome: Outcome | null
  /** Both teams' words, once they are no longer secret. */
  final_words: [string[], string[]] | null
}

/** One revealed set of clues. */
export interface ClueSet {
  round_no: number
  team: Team
  clues: string[]
  /** null until the code is revealed. */
  code: number[] | null
  /** The team's own guess; null if nobody could make one. */
  own_guess: number[] | null
  /** The other team's attempt; null in round 1. */
  other_guess: number[] | null
}

export interface TiebreakRow {
  /** The team that guessed. */
  team: Team
  guesses: string[]
  /** What the other team counts as correct. */
  marks: boolean[] | null
}

/** What the database lets *this* player see. */
export interface Snapshot {
  game: Game
  /** Seconds left for the second clue-giver; null while no timer runs. */
  timer_left: number | null
  /** The own team's four words. */
  words: string[] | null
  /** For the clue-giver only. */
  code: number[] | null
  /** The clue-giver's submitted, still hidden clues. */
  pending: string[] | null
  /** The own team's guess, 0 for an empty place. */
  guess: number[] | null
  history: ClueSet[]
  tiebreak: TiebreakRow[]
}

export const decodoApi = {
  start: (roomId: string) => rpc('decodo_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('decodo_snapshot', { p_room_id: roomId }),
  lobby: (roomId: string) =>
    rpc<Record<string, Team>>('decodo_lobby', { p_room_id: roomId }),
  setTeam: (roomId: string, userId: string, team: Team) =>
    rpc('decodo_set_team', { p_room_id: roomId, p_user_id: userId, p_team: team }),
  shuffleTeams: (roomId: string) => rpc('decodo_shuffle_teams', { p_room_id: roomId }),
}

/** In-game actions, bound to one room and screen. */
export function stepActions(roomId: string, step: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`decodo_${fn}`, { p_room_id: roomId, p_step: step, ...args })
  return {
    submit: (clues: string[]) => call('submit', { p_clues: clues }),
    pick: (position: number, digit: number) =>
      call('pick', { p_position: position, p_digit: digit }),
    lock: (digits: number[]) => call('lock', { p_digits: digits }),
    skipGuess: (team: Team) => call('skip_guess', { p_team: team }),
    next: () => call('next'),
    replaceEncryptor: (team: Team) => call('replace_encryptor', { p_team: team }),
    tiebreakGuess: (guesses: string[]) => call('tiebreak_guess', { p_guesses: guesses }),
    judge: (marks: boolean[]) => call('judge', { p_marks: marks }),
  }
}

export type StepActions = ReturnType<typeof stepActions>
