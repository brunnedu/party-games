// What every phase gets, and the summary after a round.
import type { Player } from '../../core/room/api'
import { Avatar } from '../../core/ui/Avatar'
import { Confetti } from '../../core/ui/Confetti'
import { Scoreboard } from '../../core/ui/Scoreboard'
import type { Snapshot, StepActions } from './api'
import { ResultGrid } from './Grid'
import { s } from './strings.de'

export interface PhaseProps {
  snapshot: Snapshot
  players: Player[]
  userId: string
  nameOf: (id: string) => string
  playerOf: (id: string) => Player | undefined
  isHost: boolean
  actions: StepActions
  busy: boolean
  run: (action: () => Promise<unknown>) => void
}

export const totals = (scores: Snapshot['scores']) =>
  Object.fromEntries(Object.entries(scores).map(([id, x]) => [id, x.score]))

export function RoundEnd(props: PhaseProps) {
  const { snapshot, players, userId, nameOf, playerOf, isHost, actions, busy, run } = props
  const { game, scores } = snapshot
  const summary = game.summary ?? {}
  const ranked = game.order_ids
    .filter((id) => summary[id])
    .sort((a, b) => summary[b]!.points - summary[a]!.points)
  const best = ranked[0] ? summary[ranked[0]]!.points : 0

  return (
    <>
      {best > 0 && summary[userId]?.points === best && <Confetti />}
      <section className="card center secret">
        <h2>{s.roundOver(game.round_no)}</h2>
        {game.three_players && <p className="muted">{s.starNote}</p>}
      </section>
      <section className="card stack">
        <h2>{s.allGrids}</h2>
        {ranked.map((id) => {
          const result = summary[id]!
          return (
            <details key={id} className="dito-result" open={id === userId}>
              <summary>
                <Avatar player={playerOf(id)} small />
                <span className="player-name">{nameOf(id)}</span>
                <strong className="dito-points">{s.points(result.points)}</strong>
              </summary>
              <p className="muted">
                {s.breakdown(result.circles, result.stars, result.star_points, result.bonus)}
              </p>
              <ResultGrid label={s.gridOf(nameOf(id))} cells={result.cells} />
            </details>
          )
        })}
      </section>
      <section className="card">
        <h2>{s.scores}</h2>
        <Scoreboard players={players} scores={totals(scores)} userId={userId} />
      </section>
      {isHost ? (
        <button className="button" disabled={busy} onClick={() => run(actions.nextRound)}>
          {game.round_no >= 3 ? s.finish : s.nextRound}
        </button>
      ) : (
        <p className="muted center">{s.waitingForNext}</p>
      )}
    </>
  )
}
