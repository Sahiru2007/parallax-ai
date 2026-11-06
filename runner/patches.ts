export const latestRequestGuard = `import { useRef, useState } from 'react'

// Prewritten candidate A: only the latest request may update visible suggestions.
export function useAddressSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<string[]>([])
  const latestRequest = useRef(0)

  function search(nextQuery: string) {
    setQuery(nextQuery)
    const requestId = ++latestRequest.current
    void fetch(\x60/api/places?q=\x24{encodeURIComponent(nextQuery)}\x60)
      .then((response) => response.json())
      .then((payload: { items: string[] }) => {
        if (requestId === latestRequest.current) setResults(payload.items)
      })
  }

  return { query, results, search }
}
`

export const queryKeyedResults = `import { useState } from 'react'

// Prewritten candidate B: responses populate a query-keyed cache, never a shared list.
export function useAddressSearch() {
  const [query, setQuery] = useState('')
  const [resultsByQuery, setResultsByQuery] = useState<Record<string, string[]>>({})

  function search(nextQuery: string) {
    setQuery(nextQuery)
    void fetch(\x60/api/places?q=\x24{encodeURIComponent(nextQuery)}\x60)
      .then((response) => response.json())
      .then((payload: { items: string[] }) => {
        setResultsByQuery((previous) => ({ ...previous, [nextQuery]: payload.items }))
      })
  }

  return { query, results: resultsByQuery[query] ?? [], search }
}
`
