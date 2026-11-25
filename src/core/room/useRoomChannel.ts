import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { roomApi } from './api'

const HEARTBEAT_MS = 15_000

/**
 * Live connection to a room: reports changes, tracks who is online (Presence)
 * and sends heartbeats. Nothing secret goes over this channel; it only says
 * "something changed" and who is connected.
 */
export function useRoomChannel(
  roomId: string | undefined,
  userId: string | undefined,
  onChange: () => void,
) {
  const [online, setOnline] = useState<ReadonlySet<string> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!roomId || !userId) return
    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: userId } },
    })
    channel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        () => onChangeRef.current(),
      )
      .on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        void channel.track({})
        onChangeRef.current() // catch up on anything missed while connecting
      })
    return () => {
      setOnline(null)
      void supabase.removeChannel(channel)
    }
  }, [roomId, userId])

  useEffect(() => {
    if (!roomId) return
    const beat = () => {
      if (document.visibilityState === 'visible') {
        roomApi.heartbeat(roomId).catch(() => {})
      }
    }
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [roomId])

  return online
}
