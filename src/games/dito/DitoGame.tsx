import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useConfirm } from '../../core/ui/ConfirmDialog'
import { PlayerList } from '../../core/ui/PlayerList'
import { useAction } from '../../core/ui/useAction'
import { ditoApi, stepActions, type Phase } from './api'
import { GameOver } from './GameOver'
import { RoundEnd, type PhaseProps } from './phases'
import { Reveal } from './Reveal'
import { s } from './strings.de'
import { Choosing, Writing } from './Writing'
import '../../core/ui/game.css'
import './dito.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  choosing: Choosing,
  writing: Writing,
  reveal: Reveal,
  round_end: RoundEnd,
}

export function DitoGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => ditoApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game } = snapshot
  const isHost = room.host_id === userId
  const playerOf = (id: string) => players.find((p) => p.user_id === id)
  const nameOf = (id: string) => playerOf(id)?.name ?? s.unknownPlayer
  const actions = stepActions(room.id, game.step)
  const over = game.phase === 'game_over'
  const offline = (id: string | null) =>
    id !== null && id !== userId && online !== null && !online.has(id)

  // Who the game is waiting for, if the host may pass over them.
  const waitingFor =
    game.phase === 'choosing'
      ? game.chooser_id
      : game.phase === 'reveal' && game.read_cell === null
        ? game.reader_id
        : null
  const readerGone =
    game.phase === 'reveal' && game.read_cell !== null && offline(game.reader_id)

  let content
  if (game.phase === 'game_over') {
    content = (
      <GameOver
        snapshot={snapshot}
        room={room}
        players={players}
        userId={userId}
        busy={busy}
        run={(action) => void run(action)}
      />
    )
  } else {
    const PhaseView = PHASES[game.phase]
    content = (
      // A new key per screen resets inputs and selections.
      <PhaseView
        key={game.step}
        snapshot={snapshot}
        players={players}
        userId={userId}
        nameOf={nameOf}
        playerOf={playerOf}
        isHost={isHost}
        actions={actions}
        busy={busy}
        run={(action) => void run(action)}
      />
    )
  }

  return (
    <>
      {!over && (
        <div className="status-bar">
          <span>{s.round(game.round_no)}</span>
          {game.phase !== 'round_end' && game.phase !== 'reveal' && (
            <span>{s.category(game.category_no)}</span>
          )}
        </div>
      )}
      {content}
      <ErrorMessage>{error}</ErrorMessage>

      {(game.phase === 'choosing' || game.phase === 'writing') && (
        <p className="muted center">{s.credit}</p>
      )}

      <details className="card">
        <summary>{t.playersInRoom(players.length)}</summary>
        <PlayerList
          room={room}
          players={players}
          userId={userId}
          online={online}
          onKick={
            isHost
              ? (p) =>
                  hostConfirm.ask(t.confirmKick(p.name), () =>
                    void run(() => roomApi.kick(room.id, p.user_id)),
                  )
              : undefined
          }
        />
      </details>

      {isHost && !over && (
        <details className="card">
          <summary>{s.hostTools}</summary>
          <div className="stack">
            {game.phase === 'writing' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.forceContinue)}
              >
                {s.forceContinue}
              </button>
            )}
            {offline(waitingFor) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.skip)}
              >
                {s.skip(nameOf(waitingFor!))}
              </button>
            )}
            {readerGone && (
              <button
                className="button secondary"
                disabled={busy || Boolean(game.objection)}
                onClick={() => void run(() => actions.confirm(game.revision))}
              >
                {s.confirmForReader(nameOf(game.reader_id!))}
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                hostConfirm.ask(s.confirmAbort, () =>
                  void run(() => roomApi.returnToLobby(room.id)),
                )
              }
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
