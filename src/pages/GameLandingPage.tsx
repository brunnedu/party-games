import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CODE_LENGTH, roomApi } from '../core/room/api'
import { load } from '../core/storage'
import { t } from '../core/strings.de'
import { Page } from '../core/ui/components'
import { JoinForm } from '../core/ui/JoinForm'
import { findGame } from '../games/registry'

export function GameLandingPage() {
  const game = findGame(useParams().gameId)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [code, setCode] = useState('')
  if (!game) return <Navigate to="/" replace />

  const lastRoom = load(`last-room:${game.id}`)

  async function submit(name: string) {
    if (mode === 'create') {
      const created = await roomApi.create(game!.id, name)
      navigate(`/${game!.id}/${created}`)
    } else {
      await roomApi.join(code, name)
      navigate(`/join/${code}`)
    }
  }

  return (
    <Page title={game.name}>
      <span
        className="game-art landing-art"
        style={{ '--game-color': game.color } as React.CSSProperties}
        aria-hidden
      >
        {game.icon}
      </span>
      <p className="muted">{game.description}</p>
      {lastRoom && (
        <Link to={`/join/${lastRoom}`} className="button secondary">
          {t.rejoin(lastRoom)}
        </Link>
      )}
      <div className="tabs" role="group">
        <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>
          {t.createGame}
        </button>
        <button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
          {t.joinGame}
        </button>
      </div>
      <JoinForm
        key={mode}
        submitLabel={mode === 'create' ? t.createGame : t.join}
        onSubmit={submit}
        disabled={mode === 'join' && code.length !== CODE_LENGTH}
      >
        {mode === 'join' && (
          <label>
            {t.roomCode}
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
        )}
      </JoinForm>
    </Page>
  )
}
