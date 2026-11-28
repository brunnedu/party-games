import type { GameDefinition, GameViewProps } from '../game'
import { roomApi } from '../room/api'
import { t } from '../strings.de'
import { ErrorMessage } from './components'
import { useConfirm } from './ConfirmDialog'
import { Invite } from './Invite'
import { PlayerList } from './PlayerList'
import { useAction } from './useAction'

export function Lobby({
  game,
  room,
  players,
  userId,
  online,
  refresh,
}: GameViewProps & { game: GameDefinition }) {
  const { busy, error, run } = useAction(refresh)
  const confirm = useConfirm()
  const isHost = room.host_id === userId
  const missing = game.minPlayers - players.length

  return (
    <>
      <section className="card center stack">
        <p className="muted">{t.scanOrEnter}</p>
        <p className="room-code" aria-label={t.roomCode}>
          {room.code}
        </p>
        <Invite room={room} />
      </section>

      {game.LobbySettings && (
        <game.LobbySettings
          room={room}
          players={players}
          userId={userId}
          online={online}
          refresh={refresh}
        />
      )}

      <section className="card stack">
        <h2>{t.playersInRoom(players.length)}</h2>
        <PlayerList
          room={room}
          players={players}
          userId={userId}
          online={online}
          onKick={
            isHost
              ? (p) =>
                  confirm.ask(t.confirmKick(p.name), () =>
                    void run(() => roomApi.kick(room.id, p.user_id)),
                  )
              : undefined
          }
        />
        {isHost ? (
          <button
            className="button"
            disabled={busy || missing > 0}
            onClick={() => void run(() => game.start(room.id))}
          >
            {missing > 0 ? t.needPlayers(missing) : t.startGame}
          </button>
        ) : (
          <p className="muted center">{t.waitingForHost}</p>
        )}
        <ErrorMessage>{error}</ErrorMessage>
      </section>
      {confirm.dialog}
    </>
  )
}
