import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../core/supabase'

const SEND_EVERY_MS = 120
const FORGET_AFTER_MS = 3000

/**
 * Shows the shared dial moving while somebody else drags it. These messages
 * (Realtime Broadcast) are only a preview and carry nothing secret: the real
 * position is saved in the database when the needle is let go.
 */
export function useLiveDial(roomId: string, roundNo: number, saved: number) {
  const [preview, setPreview] = useState<number | null>(null)
  const send = useRef<(position: number) => void>(() => {})

  useEffect(() => {
    let ready = false
    let lastSent = 0
    let forget: ReturnType<typeof setTimeout> | undefined
    const channel = supabase.channel(`wavelength:${roomId}`)
    channel
      .on('broadcast', { event: 'dial' }, ({ payload }) => {
        const { round, position } = payload as { round: number; position: number }
        if (round !== roundNo || !Number.isFinite(position)) return
        setPreview(Math.min(100, Math.max(0, position)))
        clearTimeout(forget)
        forget = setTimeout(() => setPreview(null), FORGET_AFTER_MS)
      })
      .subscribe((status) => {
        ready = status === 'SUBSCRIBED'
      })

    send.current = (position) => {
      const now = Date.now()
      if (!ready || now - lastSent < SEND_EVERY_MS) return
      lastSent = now
      void channel.send({
        type: 'broadcast',
        event: 'dial',
        payload: { round: roundNo, position },
      })
    }
    return () => {
      send.current = () => {}
      clearTimeout(forget)
      setPreview(null)
      void supabase.removeChannel(channel)
    }
  }, [roomId, roundNo])

  // A newly saved position replaces the preview.
  useEffect(() => setPreview(null), [saved])

  return { preview, send: useCallback((position: number) => send.current(position), []) }
}
