import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CODE_LENGTH, roomApi } from '../core/room/api'
import { errorCode } from '../core/rpc'
import { load } from '../core/storage'
import { t } from '../core/strings.de'
import { Page } from '../core/ui/components'
import { JoinForm } from '../core/ui/JoinForm'
import { PasswordForm } from '../core/ui/PasswordForm'
import { findGame } from '../games/registry'

export function GameLandingPage() {
  const game = findGame(useParams().gameId)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [code, setCode] = useState('')
  // What to try again once the password has been entered.
  const [locked, setLocked] = useState<() => Promise<void>>()
  if (!game) return <Navigate to="/" replace />

  const lastRoom = load(`last-room:${game.id}`)

  async function enter(name: string) {
    if (mode === 'create') {
      const created = await roomApi.create(game!.id, name)
      navigate(`/${game!.id}/${created}`)
    } else {
      await roomApi.join(code, name)
      navigate(`/join/${code}`)
    }
  }

  // The password is only asked for when the database wants it.
  async function submit(name: string) {
    try {
      await enter(name)
    } catch (e) {
      if (errorCode(e) !== 'access_required') throw e
      setLocked(() => () => enter(name))
    }
  }

  return (
    <Page title={game.name}>
      <span
        className="game-art landing-art"
        style={{ '--game-color': game.color } as React.CSSProperties}
        aria-hidden
      >
        <game.Logo />
      </span>
      <p className="muted">{game.description}</p>
      {lastRoom && (
        <Link to={`/join/${lastRoom}`} className="button secondary">
          {t.rejoin(lastRoom)}
        </Link>
      )}
      {locked ? (
        <PasswordForm onUnlocked={locked} onBack={() => setLocked(undefined)} />
      ) : (
        <>
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
        </>
      )}
    </Page>
  )
}
