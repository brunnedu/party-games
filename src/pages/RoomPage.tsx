import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import type { GameDefinition } from '../core/game'
import { roomApi, type RoomSnapshot } from '../core/room/api'
import { useQuery } from '../core/room/useQuery'
import { useRoomChannel } from '../core/room/useRoomChannel'
import { errorText } from '../core/rpc'
import { save } from '../core/storage'
import { t } from '../core/strings.de'
import { ensureUserId } from '../core/supabase'
import { ErrorMessage, Notice, Page } from '../core/ui/components'
import { JoinForm } from '../core/ui/JoinForm'
import { Lobby } from '../core/ui/Lobby'
import { useAction } from '../core/ui/useAction'
import { findGame } from '../games/registry'

export function RoomPage() {
  const params = useParams()
  const game = findGame(params.gameId)
  const code = (params.roomCode ?? '').toUpperCase()
  if (!game) return <Navigate to="/" replace />
  return <RoomLoader key={code} game={game} code={code} />
}

function RoomLoader({ game, code }: { game: GameDefinition; code: string }) {
  const [userId, setUserId] = useState<string>()
  const { data, error, refresh } = useQuery(async () => {
    const id = await ensureUserId()
    setUserId(id)
    return roomApi.snapshot(code)
  }, code)
  const wasMember = useRef(false)
  const online = useRoomChannel(data?.room.id, userId, () => void refresh())

  useEffect(() => {
    if (!data) return
    wasMember.current = true
    save(`last-room:${data.room.game_type}`, data.room.code)
  }, [data])

  if (data === undefined || !userId) {
    return <Notice>{error ? errorText(error) : t.loading}</Notice>
  }
  if (data === null) {
    // Not a member: either we just got removed, or we still have to join.
    return wasMember.current ? (
      <Notice>{t.notInRoom}</Notice>
    ) : (
      <JoinGate code={code} onJoined={refresh} />
    )
  }
  if (data.room.game_type !== game.id) {
    return <Navigate to={`/join/${code}`} replace />
  }
  return (
    <RoomView
      game={game}
      snapshot={data}
      userId={userId}
      online={online}
      refresh={refresh}
      stale={Boolean(error)}
    />
  )
}

function JoinGate({ code, onJoined }: { code: string; onJoined: () => Promise<void> }) {
  const { data: info, error } = useQuery(() => roomApi.info(code), code)
  if (info === undefined) return <Notice>{error ? errorText(error) : t.loading}</Notice>
  if (info === null) return <Notice>{t.errors.room_not_found}</Notice>
  if (!info.joinable) return <Notice>{t.errors.game_running}</Notice>
  return (
    <Page title={t.joinRoomTitle(code)}>
      <JoinForm
        submitLabel={t.join}
        onSubmit={async (name) => {
          await roomApi.join(code, name)
          await onJoined()
        }}
      />
    </Page>
  )
}

function RoomView({
  game,
  snapshot: { room, players },
  userId,
  online,
  refresh,
  stale,
}: {
  game: GameDefinition
  snapshot: RoomSnapshot
  userId: string
  online: ReadonlySet<string> | null
  refresh: () => Promise<void>
  stale: boolean
}) {
  const navigate = useNavigate()
  const { busy, error, run } = useAction(refresh)
  const host = players.find((p) => p.user_id === room.host_id)
  const hostOffline = host && online && room.host_id !== userId && !online.has(room.host_id)
  const props = { room, players, userId, online, refresh }

  function leave() {
    const question = room.status === 'playing' ? t.confirmLeaveRunning : t.confirmLeave
    if (!window.confirm(question)) return
    void run(async () => {
      await roomApi.leave(room.id)
      save(`last-room:${game.id}`, '')
      navigate(`/${game.id}`)
    })
  }

  return (
    <Page
      title={
        <>
          <game.Logo className="title-logo" />
          {game.name}
        </>
      }
    >
      <ErrorMessage>{stale ? t.errors.unknown : ''}</ErrorMessage>
      {hostOffline && (
        <div className="banner">
          <span>{t.hostOffline(host.name)}</span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => roomApi.claimHost(room.id))}
          >
            {t.claimHost}
          </button>
        </div>
      )}
      {room.status === 'lobby' ? <Lobby game={game} {...props} /> : <game.View {...props} />}
      <ErrorMessage>{error}</ErrorMessage>
      <button className="link-button leave" onClick={leave} disabled={busy}>
        {t.leave}
      </button>
    </Page>
  )
}
