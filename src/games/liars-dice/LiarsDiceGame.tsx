import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { Avatar } from '../../core/ui/Avatar'
import { ErrorMessage } from '../../core/ui/components'
import { useConfirm, type Confirmation } from '../../core/ui/ConfirmDialog'
import { Confetti } from '../../core/ui/Confetti'
import { PlayerList } from '../../core/ui/PlayerList'
import { useAction } from '../../core/ui/useAction'
import { liarsApi, roundActions, type Game, type Phase } from './api'
import { Bidding, Revealed, Rolling, type PhaseProps } from './phases'
import { s } from './strings.de'
import { diceOf, standings, totalDice } from './table'
import '../../core/ui/game.css'
import './liars-dice.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  rolling: Rolling,
  bidding: Bidding,
  revealed: Revealed,
}

/** Who sits where and how many dice they have left. */
function Table({
  game,
  userId,
  nameOf,
  playerOf,
}: { game: Game; userId: string } & Pick<PhaseProps, 'nameOf' | 'playerOf'>) {
  return (
    <section className="card">
      <h2>{s.players}</h2>
      <ol className="seat-list">
        {game.order_ids.map((id) => {
          const dice = diceOf(game, id)
          return (
            <li key={id} className={dice === 0 ? 'out' : id === userId ? 'me' : undefined}>
              <Avatar player={playerOf(id)} small offline={dice === 0} />
              <span className="player-name">{nameOf(id)}</span>
              {id === userId && <span className="tag">{t.you}</span>}
              <span className="seat-dice">{dice > 0 ? s.dice(dice) : s.out}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function LiarsDiceGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => liarsApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))
  // A question about the round is outdated once its action is no longer possible.
  const roundConfirm = useConfirm(
    `${snapshot?.game.round_no}:${['rolling', 'bidding', 'revealed'].includes(snapshot?.game.phase ?? '')}`,
  )

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game } = snapshot
  const isHost = room.host_id === userId
  const playerOf = (id: string) => players.find((p) => p.user_id === id)
  const nameOf = (id: string) => playerOf(id)?.name ?? s.unknownPlayer
  const actions = roundActions(room.id, game.round_no)
  const over = game.phase === 'game_over'

  const confirmThen = (question: Confirmation, action: () => Promise<unknown>) => () =>
    hostConfirm.ask(question, () => void run(action))
  const confirmRoundThen = (question: Confirmation, action: () => Promise<unknown>) => () =>
    roundConfirm.ask(question, () => void run(action))

  let content
  if (game.phase === 'game_over') {
    const order = standings(game)
    content = (
      <>
        {order[0] === userId && <Confetti />}
        <section className="card center secret">
          <h2>{s.gameOver}</h2>
          <p className="result-headline">{s.winner(nameOf(order[0] ?? ''))}</p>
        </section>
        <section className="card">
          <h2>{s.ranking}</h2>
          <ol className="seat-list">
            {order.map((id, i) => (
              <li key={id}>
                <span className="muted">{i + 1}.</span>
                <Avatar player={playerOf(id)} small />
                <span className="player-name">{nameOf(id)}</span>
                {diceOf(game, id) > 0 && (
                  <span className="seat-dice">{s.dice(diceOf(game, id))}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
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
  } else {
    const PhaseView = PHASES[game.phase]
    content = (
      <>
        {/* A new key per round hides the dice again. */}
        <PhaseView
          key={`${game.round_no}:${game.phase}`}
          snapshot={snapshot}
          userId={userId}
          nameOf={nameOf}
          playerOf={playerOf}
          isHost={isHost}
          actions={actions}
          busy={busy}
          run={(action) => void run(action)}
        />
        <Table game={game} userId={userId} nameOf={nameOf} playerOf={playerOf} />
      </>
    )
  }

  return (
    <>
      {!over && (
        <div className="status-bar">
          <span>{s.round(game.round_no)}</span>
          <strong>{s.totalDice(totalDice(game))}</strong>
        </div>
      )}
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
            <button
              className="button secondary"
              disabled={busy}
              onClick={confirmRoundThen(s.confirmReroll, actions.reroll)}
            >
              {s.reroll}
            </button>
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
      {roundConfirm.dialog}
    </>
  )
}
