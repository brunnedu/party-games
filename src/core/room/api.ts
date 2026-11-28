import { rpc } from '../rpc'

export interface Room {
  id: string
  code: string
  game_type: string
  status: 'lobby' | 'playing' | 'finished'
  host_id: string
  version: number
}

export interface Player {
  user_id: string
  name: string
  seat_order: number
}

export interface RoomSnapshot {
  room: Room
  players: Player[]
}

/** What someone who may enter a room may know about it. */
export interface RoomInfo {
  game_type: string
  status: Room['status']
  /** In the lobby, and between rounds for games that allow it. */
  joinable: boolean
}

/** Without the password or a valid invite, nothing else is told. */
export type RoomLookup =
  | (RoomInfo & { access_required: false })
  | { access_required: true }

/** An empty invite is left out, so that the call also works without one. */
const withInvite = (invite: string) => (invite ? { p_invite: invite } : {})

export const CODE_LENGTH = 5

export const roomApi = {
  create: (gameType: string, name: string) =>
    rpc<string>('create_room', { p_game_type: gameType, p_name: name }),
  join: (code: string, name: string, invite = '') =>
    rpc<string>('join_room', { p_code: code, p_name: name, ...withInvite(invite) }),
  /** null: there is no such room. */
  info: async (code: string, invite = '') => {
    const rows = await rpc<RoomLookup[]>('get_room_info', {
      p_code: code,
      ...withInvite(invite),
    })
    return rows[0] ?? null
  },
  /** Throws "wrong_password" or "password_blocked". */
  unlock: async (password: string) => {
    const result = await rpc<'ok' | 'wrong' | 'blocked'>('unlock', { p_password: password })
    if (result !== 'ok') {
      throw new Error(result === 'blocked' ? 'password_blocked' : 'wrong_password')
    }
  },
  /** The secret in a room's join link, for people in the room. */
  invite: (roomId: string) => rpc<string>('room_invite', { p_room_id: roomId }),
  /** For the owner's access log. */
  noteReturn: (roomId: string) => rpc('note_return', { p_room_id: roomId }),
  snapshot: (code: string) => rpc<RoomSnapshot | null>('room_snapshot', { p_code: code }),
  heartbeat: (roomId: string) => rpc('heartbeat', { p_room_id: roomId }),
  leave: (roomId: string) => rpc('leave_room', { p_room_id: roomId }),
  kick: (roomId: string, userId: string) =>
    rpc('kick_player', { p_room_id: roomId, p_user_id: userId }),
  claimHost: (roomId: string) => rpc('claim_host', { p_room_id: roomId }),
  returnToLobby: (roomId: string) => rpc('return_to_lobby', { p_room_id: roomId }),
}
