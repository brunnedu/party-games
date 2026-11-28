// The seating order in the lobby: the host arranges the names, everyone sees them.
import type { Player } from '../room/api'
import { t } from '../strings.de'
import { Avatar } from './Avatar'
import './game.css'

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

export function SeatOrder({
  order,
  players,
  isHost,
  busy,
  onChange,
}: {
  order: string[]
  players: Player[]
  isHost: boolean
  busy: boolean
  onChange: (order: string[]) => void
}) {
  function move(index: number, step: -1 | 1) {
    const next = [...order]
    ;[next[index], next[index + step]] = [next[index + step]!, next[index]!]
    onChange(next)
  }

  return (
    <>
      <h2>{t.seatOrderTitle}</h2>
      <p className="muted">{isHost ? t.seatOrderHelpHost : t.seatOrderHelp}</p>
      <ol className="seat-list">
        {order.map((id, i) => {
          const player = players.find((p) => p.user_id === id)
          const name = player?.name ?? '…'
          return (
            <li key={id}>
              <span className="muted">{i + 1}.</span>
              <Avatar player={player} small />
              <span className="player-name">{name}</span>
              {isHost && (
                <span className="seat-buttons">
                  <button
                    aria-label={t.moveUp(name)}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ▲
                  </button>
                  <button
                    aria-label={t.moveDown(name)}
                    disabled={busy || i === order.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ▼
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {isHost && (
        <button
          className="button secondary"
          disabled={busy || order.length < 2}
          onClick={() => onChange(shuffled(order))}
        >
          {t.shuffleOrder}
        </button>
      )}
    </>
  )
}
