import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { roomApi } from '../core/room/api'
import { errorText } from '../core/rpc'
import { t } from '../core/strings.de'
import { Notice } from '../core/ui/components'
import { findGame } from '../games/registry'

/** Generic join link (used by the QR code): finds the room's game and redirects. */
export function JoinPage() {
  const code = (useParams().roomCode ?? '').toUpperCase()
  const [result, setResult] = useState<{ to?: string; message?: string }>({})

  useEffect(() => {
    let cancelled = false
    setResult({})
    roomApi
      .info(code)
      .then((info) => {
        const game = findGame(info?.game_type)
        return game ? { to: `/${game.id}/${code}` } : { message: t.errors.room_not_found }
      })
      .catch((e) => ({ message: errorText(e) }))
      .then((r) => !cancelled && setResult(r))
    return () => {
      cancelled = true
    }
  }, [code])

  if (result.to) return <Navigate to={result.to} replace />
  return <Notice>{result.message ?? t.loading}</Notice>
}
