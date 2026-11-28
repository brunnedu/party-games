import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi, type Player } from '../../core/room/api'
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
import { roundActions, wavelengthApi, type Phase, type Snapshot } from './api'
import { CluePhase, Guessing, Reveal, type PhaseProps } from './phases'
import { MAX_POINTS } from './scoring'
import { s } from './strings.de'
import '../../core/ui/game.css'
import './wavelength.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  clue: CluePhase,
  guessing: Guessing,
  reveal: Reveal,
}

function History({ history, competitive }: Pick<Snapshot, 'history'> & { competitive: boolean }) {
  if (history.length === 0) return null
  return (
    <section className="card">
      <h2>{s.history}</h2>
      <ul className="player-list">
        {history.map((h) => (
          <li key={h.round_no}>
            <span className="history-round">
              <span className="player-name">{h.clue ?? s.spokenClue}</span>
              <span className="muted">
                {h.left_label} ↔ {h.right_label}
              </span>
            </span>
            <strong className="history-points">
              {competitive ? s.average(Number(h.points)) : s.points(Number(h.points))}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CompetitiveGameOver({
  snapshot: { game, history, scores },
  players,
  userId,
}: {
  snapshot: Snapshot
  players: Player[]
  userId: string
}) {
  const endedEarly = game.rounds_played < game.rounds_total
  const winners = ranking(players, scores).filter((r) => r.rank === 1 && r.score > 0)
  return (
    <>
      {winners.some((w) => w.player.user_id === userId) && <Confetti />}
      <section className="card center secret">
        <h2>{s.gameOver}</h2>
        <p className="result-headline">
          {winners.length > 0
            ? s.winners(winners.map((w) => w.player.name).join(' & '), winners.length > 1)
            : s.noWinner}
        </p>
        {endedEarly && <p>{s.endedEarlyCompetitive}</p>}
      </section>
      <section className="card">
        <h2>{s.scores}</h2>
        <Scoreboard players={players} scores={scores} userId={userId} />
      </section>
      <History history={history} competitive />
    </>
  )
}

function CooperativeGameOver({ snapshot: { game, history } }: { snapshot: Snapshot }) {
  const total = Number(game.points)
  const max = game.rounds_total * MAX_POINTS
  const endedEarly = game.rounds_played < game.rounds_total
  const percent = Math.round((100 * total) / max)
  return (
    <>
      {!endedEarly && percent >= 75 && <Confetti />}
      <section className="card center secret">
        <h2>{s.gameOver}</h2>
        <p className="final-score">{s.percent(percent)}</p>
        <p>{s.finalScore(total, max)}</p>
        <p>{endedEarly ? s.endedEarly : s.rating(percent)}</p>
      </section>
      <History history={history} competitive={false} />
    </>
  )
}

export function WavelengthGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => wavelengthApi.snapshot(room.id), `${room.id}:${room.version}`)
  const reload = () => Promise.all([refresh(), query.refresh()])
  const { busy, error, run } = useAction(reload)
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))
  // A question about the round is outdated once its action is no longer possible.
  const roundConfirm = useConfirm(
    `${snapshot?.game.round_no}:${['clue', 'guessing'].includes(snapshot?.game.phase ?? '')}`,
  )

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game } = snapshot
  const isHost = room.host_id === userId
  const isGiver = game.giver_id === userId
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
    content = (
      <>
        {game.competitive ? (
          <CompetitiveGameOver snapshot={snapshot} players={players} userId={userId} />
        ) : (
          <CooperativeGameOver snapshot={snapshot} />
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
        reload={reload}
      />
    )
  }

  // After the reveal, the round that just ended is already counted.
  const roundNumber = game.rounds_played + (game.phase === 'reveal' ? 0 : 1)

  return (
    <>
      {!over && (
        <div className="status-bar">
          <span>{s.round(roundNumber, game.rounds_total)}</span>
          <strong>
            {game.competitive
              ? s.ownScore(snapshot.scores[userId] ?? 0)
              : s.score(Number(game.points))}
          </strong>
          <div className={isGiver ? 'role highlight' : 'role'}>
            <Avatar player={playerOf(game.giver_id)} />
            {isGiver ? s.youGive : s.isGiving(nameOf(game.giver_id))}
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
            {game.phase === 'guessing' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.forceReveal)}
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
