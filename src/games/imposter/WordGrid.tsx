import type { Game } from './api'
import { s } from './strings.de'

export function WordGrid({
  game,
  highlight,
  wrong,
  selected,
  onSelect,
}: {
  game: Game
  /** The secret word, if it may be shown right now. */
  highlight?: string | null
  /** A wrong guess. */
  wrong?: string | null
  selected?: string
  /** Makes the words tappable (for the imposter's guess). */
  onSelect?: (word: string) => void
}) {
  return (
    <section className="word-grid-section">
      <h2>
        <span className="muted word-grid-label">{s.category}: </span>
        {game.category}
      </h2>
      <ul className="word-grid">
        {game.grid.map((word) => {
          const classes = [
            'word-tile',
            word === highlight && 'secret-tile',
            word === wrong && 'wrong-tile',
            word === selected && 'selected-tile',
          ]
          const className = classes.filter(Boolean).join(' ')
          return (
            <li key={word}>
              {onSelect ? (
                <button
                  className={className}
                  aria-pressed={word === selected}
                  onClick={() => onSelect(word)}
                >
                  {word}
                </button>
              ) : (
                <span className={className}>{word}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
