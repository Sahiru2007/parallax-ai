import { useState } from 'react'

// Deliberately buggy baseline: every completed request replaces the visible results.
export function useAddressSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])

  function search(nextQuery: string) {
    setQuery(nextQuery)
    void fetch(`/api/places?q=${encodeURIComponent(nextQuery)}`)
      .then((response) => response.json())
      .then((payload: { items: string[] }) => {
        setResults(payload.items)
      })
  }

  return { query, results, search }
}
