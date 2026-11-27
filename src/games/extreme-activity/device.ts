// What the game phone needs from its device: a countdown, a screen that stays
// on and an alarm. Wake lock, sound and vibration are optional: where the
// browser lacks them, the game works without.
import { useEffect, useState } from 'react'

/** Milliseconds left until `deadline`, or `frozen` while the clock stands. */
export function useCountdown(deadline: number, running: boolean, frozen: number) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!running) return
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 200)
    return () => clearInterval(timer)
  }, [running, deadline])
  return running ? Math.max(0, deadline - Math.max(now, deadline - 60_000)) : frozen
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    let done = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (done) void next.release()
        else lock = next
      } catch {
        // For example on low battery.
      }
    }
    void acquire()
    // The browser drops the lock whenever the page is hidden.
    document.addEventListener('visibilitychange', acquire)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [active])
}

let audio: AudioContext | undefined

/** Browsers only allow sound after a tap: call this from one. */
export function unlockSound() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch {
    // No sound.
  }
}

export function alarm() {
  navigator.vibrate?.([400, 150, 400])
  if (!audio) return
  for (let i = 0; i < 3; i++) {
    const tone = audio.createOscillator()
    const volume = audio.createGain()
    tone.type = 'square'
    tone.frequency.value = 880
    volume.gain.value = 0.25
    tone.connect(volume).connect(audio.destination)
    const at = audio.currentTime + i * 0.35
    tone.start(at)
    tone.stop(at + (i === 2 ? 0.6 : 0.2))
  }
}
