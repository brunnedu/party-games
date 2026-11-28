import { useEffect, useState } from 'react'

/**
 * True once `ms` have passed since this phone first saw `key`. The database
 * checks the same times, so this only keeps the button from failing.
 */
export function useUnlock(key: string, ms: number): boolean {
  const [unlocked, setUnlocked] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setUnlocked(key), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return unlocked === key
}
