import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_MS = 8000

/**
 * Loads data and keeps it fresh: again whenever `key` changes, when `refresh` is
 * called, when the tab becomes visible, and every few seconds as a fallback for
 * missed live updates. `data` is undefined until the first successful load.
 */
export function useQuery<T>(fetcher: () => Promise<T>, key: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++latest.current
    try {
      const result = await fetcherRef.current()
      // Ignore answers that were overtaken by a newer request.
      if (request !== latest.current) return
      setData(() => result)
      setError(null)
    } catch (e) {
      if (request === latest.current) setError(e)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [key, refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(onVisible, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [refresh])

  return { data, error, refresh }
}
