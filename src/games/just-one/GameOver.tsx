import type { Snapshot } from './api'
import { s } from './strings.de'

const ICONS = { correct: '✅', wrong: '❌', pass: '⏭️' }

export function GameOver({ snapshot: { game, history } }: { snapshot: Snapshot }) {
  const endedEarly = game.cards_used < game.cards_total
  return (
    <>
      <section className="card center">
        <h2>{s.gameOver}</h2>
        <p className="final-score">{s.finalScore(game.score, game.cards_total)}</p>
        <p>{endedEarly ? s.endedEarly : s.rating(game.score)}</p>
      </section>
      {history.length > 0 && (
        <section className="card">
          <h2>{s.history}</h2>
          <ul className="player-list">
            {history.map((h) => (
              <li key={h.round_no}>
                <span aria-label={h.result}>{ICONS[h.result]}</span>
                <span className="player-name">{h.word ?? '?'}</span>
                {h.guess && h.result === 'wrong' && (
                  <span className="muted">{s.guessWas(h.guess)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
