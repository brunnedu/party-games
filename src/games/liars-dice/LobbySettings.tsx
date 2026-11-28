import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { SeatOrder } from '../../core/ui/SeatOrder'
import { useAction } from '../../core/ui/useAction'
import { liarsApi } from './api'
import { s } from './strings.de'
import './liars-dice.css'

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

  return (
    <section className="card stack">
      <SeatOrder
        order={order}
        players={players}
        isHost={isHost}
        busy={busy}
        onChange={(next) => void run(() => liarsApi.setOrder(room.id, next))}
      />
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
