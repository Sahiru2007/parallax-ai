import { useEffect, useState } from 'react'

export function useDeskPreference<T extends boolean | number>(
  key: string,
  fallback: T,
  bounds: { min: number; max: number } = { min: 240, max: 640 },
): [T, (value: T) => void] {
  const [value, set] = useState<T>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`parallax-desk-${key}`) ?? 'null') as unknown
      if (
        typeof stored === typeof fallback &&
        (typeof stored !== 'number' ||
          (Number.isFinite(stored) && stored >= bounds.min && stored <= bounds.max))
      )
        return stored as T
    } catch {
      /* An invalid layout preference must not prevent opening the desk. */
    }
    return fallback
  })
  return [
    value,
    (next: T) => {
      set(next)
      try {
        localStorage.setItem(`parallax-desk-${key}`, JSON.stringify(next))
      } catch {
        /* Layout still works without persistent storage. */
      }
    },
  ]
}

export function useCompactWindow() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1600px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1600px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}
