import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { SeatOrder } from '../../core/ui/SeatOrder'
import { useAction } from '../../core/ui/useAction'
import { ditoApi } from './api'

/** The seating order, which is the order of play. */
export function DitoLobbySettings({ room, players, userId, refresh }: GameViewProps) {
  const query = useQuery(
    () => ditoApi.lobby(room.id),
    `${room.id}:${room.version}:${players.length}`,
  )
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  if (!query.data) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  return (
    <section className="card stack">
      <SeatOrder
        order={query.data.order_ids}
        players={players}
        isHost={room.host_id === userId}
        busy={busy}
        onChange={(next) => void run(() => ditoApi.setOrder(room.id, next))}
      />
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
