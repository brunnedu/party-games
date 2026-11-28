import { roomApi, type Player, type Room } from '../../core/room/api'
import { t } from '../../core/strings.de'
import { Avatar } from '../../core/ui/Avatar'
import { Confetti } from '../../core/ui/Confetti'
import type { Snapshot } from './api'
import { finalRanking } from './scoring'
import { s } from './strings.de'

export function GameOver({
  snapshot: { scores },
  room,
  players,
  userId,
  busy,
  run,
}: {
  snapshot: Snapshot
  room: Room
  players: Player[]
  userId: string
  busy: boolean
  run: (action: () => Promise<unknown>) => void
}) {
  const ranked = finalRanking(players, scores)
  const winners = ranked.filter((r) => r.rank === 1 && r.score > 0)
  // Someone else has the same total: the best single round decided.
  const tieAtTheTop = winners.length > 0 && ranked.filter((r) => r.score === ranked[0]!.score).length > 1

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
        {tieAtTheTop && <p className="muted">{s.tieNote}</p>}
      </section>
      <section className="card">
        <h2>{s.scores}</h2>
        <ol className="player-list scoreboard">
          {ranked.map(({ player, score, rank }) => (
            <li key={player.user_id}>
              <span className="rank">{rank}.</span>
              <Avatar player={player} small />
              <span className="dito-final-name">
                <span className="player-name">{player.name}</span>
                <span className="muted">
                  {s.bestRound(scores[player.user_id]?.best_round ?? 0)}
                </span>
              </span>
              {player.user_id === userId && <span className="tag">{t.you}</span>}
              <strong className="score">{score}</strong>
            </li>
          ))}
        </ol>
      </section>
      {room.host_id === userId ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => run(() => roomApi.returnToLobby(room.id))}
        >
          {s.playAgain}
        </button>
      ) : (
        <p className="muted center">{s.waitingForRematch}</p>
      )}
    </>
  )
}
