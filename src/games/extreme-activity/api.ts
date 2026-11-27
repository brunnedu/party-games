import { rpc } from '../../core/rpc'

export type Phase =
  | 'writing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'new_mode'
  | 'summary'
  | 'game_over'

export type Team = 0 | 1

export interface Game {
  phase: Phase
  turn_no: number
  /** 1–5; 6 once every word has been played in all modes. */
  mode: number
  /** The last mode in which the current turn saw a word. */
  played_mode: number
  team: Team
  time_left_ms: number
}

export interface SummaryRow {
  id: number
  text: string
  mode: number
  counted: boolean
}

export interface Snapshot {
  game: Game
  phone_id: string
  max_words: number
  words_total: number
  /** Still to be guessed in the current mode. */
  words_left: number
  turn_points: number
  writers: { name: string; count: number }[]
  own_submitted: boolean
  points: { team: Team; mode: number; points: number }[]
  /** Only on the game phone while the clock runs. */
  word: { id: number; text: string } | null
  /** Only on the game phone between "time is up" and passing it on. */
  summary: SummaryRow[] | null
  /** Only once the game is over. */
  all_words: { text: string; author: string }[] | null
}

/** A snapshot plus the moment (on this device's clock) the time runs out. */
export type TimedSnapshot = Snapshot & { deadline: number }

export interface LobbySetup {
  phone_id: string
  max_words: number
}

export const activityApi = {
  start: (roomId: string) => rpc('activity_start', { p_room_id: roomId }),
  snapshot: async (roomId: string): Promise<TimedSnapshot | null> => {
    const data = await rpc<Snapshot | null>('activity_snapshot', { p_room_id: roomId })
    return data && { ...data, deadline: performance.now() + data.game.time_left_ms }
  },
  lobby: (roomId: string) => rpc<LobbySetup | null>('activity_lobby', { p_room_id: roomId }),
  setMaxWords: (roomId: string, max: number) =>
    rpc('activity_set_settings', { p_room_id: roomId, p_max_words: max }),
  setPhone: (roomId: string, phoneId: string) =>
    rpc('activity_set_settings', { p_room_id: roomId, p_phone_id: phoneId }),
  submit: (roomId: string, words: string[], name: string | null) =>
    rpc('activity_submit', { p_room_id: roomId, p_words: words, p_name: name }),
  play: (roomId: string) => rpc('activity_play', { p_room_id: roomId }),
}

/** Actions of the game phone, bound to one room and turn. */
export function turnActions(roomId: string, turnNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`activity_${fn}`, { p_room_id: roomId, p_turn_no: turnNo, ...args })
  return {
    begin: () => call('begin_turn'),
    guessed: (wordId: number) => call('guessed', { p_word_id: wordId }),
    undoMode: () => call('undo_mode'),
    pause: () => call('pause'),
    resume: () => call('resume'),
    timeUp: () => call('time_up'),
    setCounted: (pointId: number, counted: boolean) =>
      call('set_counted', { p_point_id: pointId, p_counted: counted }),
    passOn: () => call('pass_on'),
  }
}

export type TurnActions = ReturnType<typeof turnActions>
