import { useRef, useState } from 'react'
import { errorText } from '../rpc'

/** Runs one user action at a time and keeps its error message. */
export function useAction(after?: () => unknown) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)

  async function run(action: () => Promise<unknown>) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      // A click on an outdated screen needs no message: reloading below fixes it.
      const outdated = (e as { message?: string } | null)?.message === 'wrong_phase'
      if (!outdated) setError(errorText(e))
    } finally {
      await after?.()
      running.current = false
      setBusy(false)
    }
  }

  return { busy, error, run }
}
