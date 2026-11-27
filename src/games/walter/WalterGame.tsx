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
import { ranking } from '../../core/ui/ranking'
import { Scoreboard } from '../../core/ui/Scoreboard'
import { useAction } from '../../core/ui/useAction'
import { roundActions, walterApi, type Phase } from './api'
import { Choosing, Revealing, Voting, Writing, type PhaseProps } from './phases'
import { Sentence } from './Sentence'
import { s } from './strings.de'
import '../../core/ui/game.css'
import './walter.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  choosing: Choosing,
  writing: Writing,
  voting: Voting,
  reveal: Revealing,
}

export function WalterGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => walterApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))
  // A question about the round is outdated once its action is no longer possible.
  const roundConfirm = useConfirm(
    `${snapshot?.game.round_no}:${['choosing', 'writing', 'voting'].includes(snapshot?.game.phase ?? '')}`,
  )

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game, scores, history } = snapshot
  const isHost = room.host_id === userId
  const isSphinx = game.sphinx_id === userId
  const playerOf = (id: string) => players.find((p) => p.user_id === id)
  const nameOf = (id: string) => playerOf(id)?.name ?? s.unknownPlayer
  const actions = roundActions(room.id, game.round_no)
  const over = game.phase === 'game_over'
  const revealing = game.phase === 'reveal' && game.reveal_step < game.reveal_steps
  const sphinxOffline = online !== null && !isSphinx && !online.has(game.sphinx_id)

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
        {history.length > 0 && (
          <section className="card">
            <h2>{s.history}</h2>
            <ul className="walter-history">
              {history.map((h) => (
                <li key={h.round_no}>
                  <span className="muted">{nameOf(h.sphinx_id)}</span>
                  <Sentence text={h.sentence} />
                  <strong className="answer-text">{h.truth}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
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
      // A new key per round and phase resets inputs.
      <PhaseView
        key={`${game.round_no}:${game.phase}`}
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

  // Once the reveal is complete, the round that just ended is already counted.
  const complete = game.phase === 'reveal' && !revealing
  const roundNumber = game.rounds_played + (complete ? 0 : 1)

  return (
    <>
      {!over && (
        <div className="status-bar">
          <span>{s.round(roundNumber, game.rounds_total)}</span>
          <div className={isSphinx ? 'role highlight' : 'role'}>
            <Avatar player={playerOf(game.sphinx_id)} />
            {isSphinx ? s.youAreSphinx : s.isSphinx(nameOf(game.sphinx_id))}
          </div>
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
            {(game.phase === 'writing' || game.phase === 'voting') && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.forceContinue)}
              >
                {s.forceContinue}
              </button>
            )}
            {revealing && sphinxOffline && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(() => actions.revealNext(game.reveal_step))}
              >
                {s.forceReveal}
              </button>
            )}
            {game.phase !== 'reveal' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={confirmRoundThen(s.confirmSkipRound, actions.skipRound)}
              >
                {s.skipRound}
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
