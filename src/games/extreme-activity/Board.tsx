// What everybody may see: the other phones during play, and the final result.
import type { Snapshot, TimedSnapshot, Team } from './api'
import { useCountdown } from './device'
import { ModeInfo } from './GamePhone'
import { clockText, modePoints, teamTotal } from './scoring'
import { s } from './strings.de'

const TEAMS: readonly Team[] = [0, 1]

export function ScoreTable({ points }: { points: Snapshot['points'] }) {
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th />
          {TEAMS.map((team) => (
            <th key={team} scope="col">
              <span className={`team-tag team-${team}`}>{s.teams[team]}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {s.modes.map((mode, i) => (
          <tr key={mode.name}>
            <th scope="row">{mode.name}</th>
            {TEAMS.map((team) => (
              <td key={team}>{modePoints(points, team, i + 1)}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{s.total_}</th>
          {TEAMS.map((team) => (
            <td key={team}>{teamTotal(points, team)}</td>
          ))}
        </tr>
      </tfoot>
    </table>
  )
}

/** The phones that are not passed around. Never shows a word. */
export function Spectator({
  snapshot,
  phoneName,
}: {
  snapshot: TimedSnapshot
  phoneName: string
}) {
  const { game } = snapshot
  const left = useCountdown(snapshot.deadline, game.phase === 'playing', game.time_left_ms)
  if (game.phase === 'writing' || game.phase === 'game_over') return null
  const showClock = game.phase !== 'ready' && game.phase !== 'summary'

  return (
    <>
      <section className={`card center team-edge team-${game.team}`}>
        <p className="result-headline">{s.turnOf(s.teams[game.team])}</p>
        <p>{s.states[game.phase]}</p>
        {showClock && <p className="final-score">{clockText(left)}</p>}
        <ModeInfo mode={game.mode} />
        <strong>{s.inBucket(snapshot.words_left)}</strong>
        {game.phase !== 'ready' && (
          <p className="muted">{s.turnPointsSoFar(snapshot.turn_points)}</p>
        )}
      </section>
      <section className="card">
        <h2>{s.scoreTitle}</h2>
        <ScoreTable points={snapshot.points} />
      </section>
      <p className="muted center">{s.gamePhoneIs(phoneName)}</p>
    </>
  )
}

export function Result({ snapshot }: { snapshot: Snapshot }) {
  const red = teamTotal(snapshot.points, 0)
  const blue = teamTotal(snapshot.points, 1)
  return (
    <>
      <section className="card center secret">
        <h2>{s.gameOver}</h2>
        <p className="result-headline">
          {red === blue ? s.tie : s.winner(s.teams[red > blue ? 0 : 1])}
        </p>
        <p className="final-score">
          {red} : {blue}
        </p>
      </section>
      <section className="card">
        <ScoreTable points={snapshot.points} />
      </section>
      <section className="card">
        <h2>{s.allWords}</h2>
        <ul className="word-reveal">
          {snapshot.all_words?.map((w, i) => (
            <li key={i}>
              <strong>{w.text}</strong>
              <span className="muted">{w.author}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
