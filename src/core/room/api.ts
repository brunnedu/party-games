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

export const CODE_LENGTH = 5

export const roomApi = {
  create: (gameType: string, name: string) =>
    rpc<string>('create_room', { p_game_type: gameType, p_name: name }),
  join: (code: string, name: string) => rpc<string>('join_room', { p_code: code, p_name: name }),
  info: async (code: string) => {
    const rows = await rpc<{ game_type: string; status: Room['status'] }[]>('get_room_info', {
      p_code: code,
    })
    return rows[0] ?? null
  },
  snapshot: (code: string) => rpc<RoomSnapshot | null>('room_snapshot', { p_code: code }),
  heartbeat: (roomId: string) => rpc('heartbeat', { p_room_id: roomId }),
  leave: (roomId: string) => rpc('leave_room', { p_room_id: roomId }),
  kick: (roomId: string, userId: string) =>
    rpc('kick_player', { p_room_id: roomId, p_user_id: userId }),
  claimHost: (roomId: string) => rpc('claim_host', { p_room_id: roomId }),
  returnToLobby: (roomId: string) => rpc('return_to_lobby', { p_room_id: roomId }),
}
