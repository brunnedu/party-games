import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useConfirm, type Confirmation } from '../../core/ui/ConfirmDialog'
import { Confetti } from '../../core/ui/Confetti'
import { PlayerList } from '../../core/ui/PlayerList'
import { ranking } from '../../core/ui/ranking'
import { Scoreboard } from '../../core/ui/Scoreboard'
import { useAction } from '../../core/ui/useAction'
import { imposterApi, roundActions, type Phase } from './api'
import { Guessing, Hints, RoundResult, Voting, type PhaseProps } from './phases'
import { s } from './strings.de'
import '../../core/ui/game.css'
import './imposter.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  hints: Hints,
  voting: Voting,
  guessing: Guessing,
  round_result: RoundResult,
}

export function ImposterGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => imposterApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))
  // A question about the round is outdated once its action is no longer possible.
  const roundConfirm = useConfirm(
    `${snapshot?.game.round_no}:${['hints', 'voting'].includes(snapshot?.game.phase ?? '')}`,
  )

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game, scores } = snapshot
  const isHost = room.host_id === userId
  const playerOf = (id: string) => players.find((p) => p.user_id === id)
  const nameOf = (id: string) => playerOf(id)?.name ?? s.unknownPlayer
  const actions = roundActions(room.id, game.round_no)
  const over = game.phase === 'game_over'
  const inRound = !over && game.phase !== 'round_result'

  const confirmThen = (question: Confirmation, action: () => Promise<unknown>) => () =>
    hostConfirm.ask(question, () => void run(action))
  const confirmRoundThen = (question: Confirmation, action: () => Promise<unknown>) => () =>
    roundConfirm.ask(question, () => void run(action))

  let content
  if (game.phase === 'game_over') {
    const winners = ranking(players, scores).filter((r) => r.rank === 1 && r.score > 0)
    content = (
      <>
        {winners.some((w) => w.player.user_id === userId) && <Confetti />}
        <section className="card center secret">
          <h2>{s.gameOver}</h2>
          <p className="result-headline">
            {winners.length > 0
              ? s.winners(winners.map((w) => w.player.name).join(' & '), winners.length > 1)
              : s.noWinner}
          </p>
        </section>
        <section className="card">
          <h2>{s.scores}</h2>
          <Scoreboard players={players} scores={scores} userId={userId} />
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
      // A new key per round, phase and vote resets selections.
      <PhaseView
        key={`${game.round_no}:${game.phase}:${game.vote_no}`}
        snapshot={snapshot}
        room={room}
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
          <strong>{s.round(game.round_no)}</strong>
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
            {game.phase === 'voting' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.closeVoting)}
              >
                {s.closeVoting}
              </button>
            )}
            {game.phase === 'guessing' && game.imposter_id !== userId && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.skipGuess)}
              >
                {s.skipGuess}
              </button>
            )}
            {inRound && game.phase !== 'guessing' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={confirmRoundThen(s.confirmCancelRound, actions.cancelRound)}
              >
                {s.cancelRound}
              </button>
            )}
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
