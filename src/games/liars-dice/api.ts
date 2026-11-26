import { rpc } from '../../core/rpc'

export type Phase = 'rolling' | 'bidding' | 'revealed' | 'game_over'
export type Verdict = 'doubter_loses' | 'accused_loses'

export interface Game {
  phase: Phase
  round_no: number
  /** Seating order, including players who are out. */
  order_ids: string[]
  dice_counts: Record<string, number>
  starter_id: string
  rolled_ids: string[]
  /** Players without dice, first one out first. */
  eliminated_ids: string[]
  doubter_id: string | null
  accused_id: string | null
  verdict: Verdict | null
  /** Everyone's dice; null until somebody doubts. */
  revealed: Record<string, number[]> | null
}

export interface Snapshot {
  game: Game
  own_dice: number[] | null
}

export interface LobbySetup {
  order_ids: string[]
  start_dice: number
}

export const liarsApi = {
  start: (roomId: string) => rpc('liars_start', { p_room_id: roomId }),
  snapshot: (roomId: string) => rpc<Snapshot | null>('liars_snapshot', { p_room_id: roomId }),
  lobby: (roomId: string) => rpc<LobbySetup | null>('liars_lobby', { p_room_id: roomId }),
  setOrder: (roomId: string, order: string[]) =>
    rpc('liars_set_settings', { p_room_id: roomId, p_order: order }),
  setStartDice: (roomId: string, dice: number) =>
    rpc('liars_set_settings', { p_room_id: roomId, p_start_dice: dice }),
}

/** In-game actions, bound to one room and round. */
export function roundActions(roomId: string, roundNo: number) {
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    rpc(`liars_${fn}`, { p_room_id: roomId, p_round_no: roundNo, ...args })
  return {
    roll: () => call('roll'),
    doubt: () => call('doubt'),
    setVerdict: (verdict: Verdict) => call('set_verdict', { p_verdict: verdict }),
    nextRound: (verdict: Verdict) => call('next_round', { p_verdict: verdict }),
    reroll: () => call('reroll'),
  }
}

export type RoundActions = ReturnType<typeof roundActions>
