import type { Player, Room } from '../room/api'
import { t } from '../strings.de'

export function PlayerList({
  room,
  players,
  userId,
  online,
  onKick,
}: {
  room: Room
  players: Player[]
  userId: string
  online: ReadonlySet<string> | null
  onKick?: (player: Player) => void
}) {
  return (
    <ul className="player-list">
      {players.map((p) => {
        const isOnline = !online || p.user_id === userId || online.has(p.user_id)
        return (
          <li key={p.user_id}>
            <span className={isOnline ? 'dot on' : 'dot'} aria-hidden />
            <span className="player-name">{p.name}</span>
            {p.user_id === userId && <span className="tag">{t.you}</span>}
            {p.user_id === room.host_id && <span className="tag">{t.host}</span>}
            {!isOnline && <span className="muted">{t.offline}</span>}
            {onKick && p.user_id !== userId && (
              <button className="link-button" onClick={() => onKick(p)}>
                {t.kick}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
