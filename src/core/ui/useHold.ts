import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react'

/**
 * "Press and hold to peek" for secrets. Spread `holdProps` onto a button with
 * the class "hold-button".
 */
export function useHold() {
  const [held, setHeld] = useState(false)

  // Never stay open when the app goes to the background.
  useEffect(() => {
    const hide = () => setHeld(false)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [])

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    setHeld(down)
  }
  const release = () => setHeld(false)

  return {
    held,
    holdProps: {
      onPointerDown: () => setHeld(true),
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
      onKeyDown: onKey(true),
      onKeyUp: onKey(false),
      onBlur: release,
      onContextMenu: (e: SyntheticEvent) => e.preventDefault(),
    },
  }
}
