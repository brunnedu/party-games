import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useConfirm, type Confirmation } from '../../core/ui/ConfirmDialog'
import { Confetti } from '../../core/ui/Confetti'
import { PlayerList } from '../../core/ui/PlayerList'
import { useAction } from '../../core/ui/useAction'
import { activityApi, turnActions } from './api'
import { Result, Spectator } from './Board'
import { useWakeLock } from './device'
import { GamePhone } from './GamePhone'
import { PhoneChoice } from './Settings'
import { s } from './strings.de'
import { WordEntry } from './WordEntry'
import '../../core/ui/game.css'
import './extreme-activity.css'

export function ActivityGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => activityApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  const phase = snapshot?.game.phase
  const isPhone = snapshot?.phone_id === userId
  const inTurns = phase !== undefined && phase !== 'writing' && phase !== 'game_over'
  useWakeLock(isPhone && inTurns)
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game } = snapshot
  const isHost = room.host_id === userId
  const nameOf = (id: string) => players.find((p) => p.user_id === id)?.name ?? '…'
  const over = game.phase === 'game_over'

  const confirmThen = (question: Confirmation, action: () => Promise<unknown>) => () =>
    hostConfirm.ask(question, () => void run(action))

  let content
  if (game.phase === 'writing') {
    content = (
      <WordEntry
        roomId={room.id}
        snapshot={snapshot}
        players={players}
        ownName={nameOf(userId)}
        isHost={isHost}
        busy={busy}
        run={run}
      />
    )
  } else if (over) {
    content = (
      <>
        <Confetti />
        <Result snapshot={snapshot} />
        {isHost ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(() => roomApi.returnToLobby(room.id))}
          >
            {s.playAgain}
          </button>
        ) : (
          <p className="muted center">{s.waitingForRematch}</p>
        )}
      </>
    )
  } else if (isPhone) {
    content = (
      <>
        <GamePhone
          // A new key per turn and screen resets local state.
          key={`${game.turn_no}:${game.phase}`}
          snapshot={snapshot}
          actions={turnActions(room.id, game.turn_no)}
          busy={busy}
          error={error}
          run={(action) => void run(action)}
          reload={async () => {
            await Promise.all([refresh(), query.refresh()])
          }}
        />
        <p className="muted center">{s.gamePhoneYours}</p>
      </>
    )
  } else {
    content = <Spectator snapshot={snapshot} phoneName={nameOf(snapshot.phone_id)} />
  }

  return (
    <>
      {content}
      <ErrorMessage>{error}</ErrorMessage>

      <details className="card">
        <summary>{t.playersInRoom(players.length)}</summary>
        <PlayerList
          room={room}
          players={players}
          userId={userId}
          online={online}
          onKick={
            isHost
              ? (p) => confirmThen(t.confirmKick(p.name), () => roomApi.kick(room.id, p.user_id))()
              : undefined
          }
        />
      </details>

      {isHost && !over && (
        <details className="card">
          <summary>{s.hostTools}</summary>
          <div className="stack">
            <PhoneChoice
              players={players}
              phoneId={snapshot.phone_id}
              disabled={busy}
              onChange={(id) => void run(() => activityApi.setPhone(room.id, id))}
            />
            <p className="muted">{s.changePhoneHelp}</p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={confirmThen(s.confirmAbort, () => roomApi.returnToLobby(room.id))}
            >
              {s.abort}
            </button>
          </div>
        </details>
      )}
      {hostConfirm.dialog}
    </>
  )
}
