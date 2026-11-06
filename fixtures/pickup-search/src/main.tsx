import { createRoot } from 'react-dom/client'
import { useAddressSearch } from './useAddressSearch'
import './style.css'

export function PickupSearch() {
  const { query, results, search } = useAddressSearch()
  return (
    <div className="pickup-shell">
      <header>
        <span className="pickup-symbol">↗</span>
        <strong>
          CITY PICKUP<span>COLOMBO</span>
        </strong>
        <span className="pickup-status">LOCAL FIXTURE</span>
      </header>
      <main>
        <div className="pickup-eyebrow">A BETTER WAY THROUGH THE CITY</div>
        <h1>
          Where are we
          <br />
          picking you up?
        </h1>
        <p>Find your place. We’ll take it from here.</p>
        <label htmlFor="pickup">PICKUP ADDRESS</label>
        <div className="pickup-input">
          <span>⌕</span>
          <input
            id="pickup"
            aria-label="Pickup address"
            placeholder="Search for an address"
            value={query}
            onChange={(event) => search(event.target.value)}
          />
          <span className="input-dot" />
        </div>
        <div className="suggestion-meta">
          <span>NEARBY SUGGESTIONS</span>
          <span data-testid="active-query">{query || 'Start typing'}</span>
        </div>
        <ul data-testid="suggestions">
          {results.map((result, index) => (
            <li key={result}>
              <span className="place-dot">{index + 1}</span>
              <span>
                <span data-testid="place-name">{result}</span>
                <small>Colombo, Sri Lanka</small>
              </span>
              <b>↗</b>
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <div className="pickup-empty">Your next journey starts with a place.</div>
        )}
        <footer>
          <span>◈</span> Address search · React fixture
        </footer>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<PickupSearch />)
