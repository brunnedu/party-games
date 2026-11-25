import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../core/ui/components'
import { t } from '../core/strings.de'
import { GAMES } from '../games/registry'

export function HubPage() {
  return (
    <Page title={t.appName}>
      <p className="muted">{t.tagline}</p>
      <ul className="game-grid">
        {GAMES.map((game) => (
          <li key={game.id}>
            <Link to={`/${game.id}`} className="card game-card">
              <span
                className="game-art"
                style={{ '--game-color': game.color } as CSSProperties}
                aria-hidden
              >
                {game.icon}
              </span>
              <h2>{game.name}</h2>
              <p>{game.description}</p>
              <p className="muted">{t.players(game.minPlayers, game.maxPlayers)}</p>
            </Link>
          </li>
        ))}
        <li>
          <div className="card game-card upcoming">
            <span className="game-art" aria-hidden>
              ?
            </span>
            <p className="muted center">{t.moreGames}</p>
          </div>
        </li>
      </ul>
    </Page>
  )
}
