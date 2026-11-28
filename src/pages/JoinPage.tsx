import { useEffect, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { roomApi } from '../core/room/api'
import { errorText } from '../core/rpc'
import { t } from '../core/strings.de'
import { Notice, Page } from '../core/ui/components'
import { PasswordForm } from '../core/ui/PasswordForm'
import { findGame } from '../games/registry'

/** Generic join link (used by the QR code): finds the room's game and redirects. */
export function JoinPage() {
  const code = (useParams().roomCode ?? '').toUpperCase()
  const invite = useSearchParams()[0].get('k') ?? ''
  const [result, setResult] = useState<{ to?: string; message?: string; locked?: boolean }>({})
  // Raised after unlocking, to look the room up again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setResult({})
    roomApi
      .info(code, invite)
      .then((info) => {
        if (info?.access_required) return { locked: true }
        const game = findGame(info?.game_type)
        // The invite goes along: joining needs it too.
        const query = invite ? `?k=${encodeURIComponent(invite)}` : ''
        return game
          ? { to: `/${game.id}/${code}${query}` }
          : { message: t.errors.room_not_found }
      })
      .catch((e) => ({ message: errorText(e) }))
      .then((r) => !cancelled && setResult(r))
    return () => {
      cancelled = true
    }
  }, [code, invite, attempt])

  if (result.to) return <Navigate to={result.to} replace />
  if (result.locked) {
    return (
      <Page title={t.joinRoomTitle(code)}>
        <PasswordForm invalidInvite={Boolean(invite)} onUnlocked={() => setAttempt((n) => n + 1)} />
      </Page>
    )
  }
  return <Notice>{result.message ?? t.loading}</Notice>
}
