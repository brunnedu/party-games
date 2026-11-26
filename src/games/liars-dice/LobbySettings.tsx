import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { Avatar } from '../../core/ui/Avatar'
import { ErrorMessage } from '../../core/ui/components'
import { useAction } from '../../core/ui/useAction'
import { liarsApi } from './api'
import { s } from './strings.de'
import './liars-dice.css'

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

/** Seating order and number of dice. The host edits, everyone sees. */
export function LiarsLobbySettings({ room, players, userId, refresh }: GameViewProps) {
  const query = useQuery(
    () => liarsApi.lobby(room.id),
    `${room.id}:${room.version}:${players.length}`,
  )
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const setup = query.data
  if (!setup) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const isHost = room.host_id === userId
  const order = setup.order_ids

  function move(index: number, step: -1 | 1) {
    const next = [...order]
    ;[next[index], next[index + step]] = [next[index + step]!, next[index]!]
    void run(() => liarsApi.setOrder(room.id, next))
  }

  return (
    <section className="card stack">
      <h2>{s.orderTitle}</h2>
      <p className="muted">{isHost ? s.orderHelpHost : s.orderHelp}</p>
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
                    aria-label={s.moveUp(name)}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ▲
                  </button>
                  <button
                    aria-label={s.moveDown(name)}
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
          onClick={() => void run(() => liarsApi.setOrder(room.id, shuffled(order)))}
        >
          {s.shuffle}
        </button>
      )}
      <strong>{s.startDice}</strong>
      <div className="start-dice" role="group" aria-label={s.startDice}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            aria-pressed={setup.start_dice === n}
            disabled={!isHost || busy}
            onClick={() => void run(() => liarsApi.setStartDice(room.id, n))}
          >
            {n}
          </button>
        ))}
      </div>
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
