import { useEffect, useRef, useState } from 'react'
import type { ProviderId, ProviderSettings } from '../../../shared/providers'
import './providers.css'

export function ProviderSettingsPanel({
  settings,
  initial,
  update,
  onClose,
}: {
  settings: ProviderSettings | undefined
  initial: ProviderId
  update: (data: Record<string, unknown>) => Promise<ProviderSettings>
  onClose: () => void
}) {
  const [provider, setProvider] = useState<ProviderId>(initial)
  const [model, setModel] = useState('')
  const [endpoint, setEndpoint] = useState(settings?.ollama.endpoint ?? 'http://127.0.0.1:11434')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const keyInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  const current = settings?.[provider]
  const chosen = current?.models.includes(model) ? model : (current?.models[0] ?? '')
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setPending(action)
    setError('')
    try {
      await update({ provider, action, ...extra })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Provider setup failed.')
    } finally {
      setPending('')
    }
  }
  return (
    <dialog
      ref={dialog}
      className="provider-settings"
      aria-label="Manage providers"
      onCancel={(e) => {
        e.preventDefault()
        if (!pending) onClose()
      }}
    >
      <header>
        <h2>Manage providers</h2>
        <button autoFocus disabled={Boolean(pending)} onClick={onClose}>
          Close provider settings
        </button>
      </header>
      <p>
        Connection tests list models. The coding-agent check exercises a harmless tool call and
        result. A real coding task still needs project verification.
      </p>
      {settings?.testTransport && (
        <p className="provider-test-label">PROTOCOL TEST DOUBLE — NO LIVE MODEL</p>
      )}
      <div role="tablist" aria-label="Provider settings tabs">
        {(['openai', 'ollama'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            disabled={Boolean(pending)}
            aria-selected={provider === id}
            onClick={() => {
              setProvider(id)
              setModel('')
              setError('')
            }}
          >
            {id === 'openai' ? 'OpenAI' : 'Ollama'}
          </button>
        ))}
      </div>
      {provider === 'openai' ? (
        <>
          <p>
            Key: {settings?.openai.keySource ?? 'none'}. Saved keys use Windows Credential Manager.
            Keys are never returned to the app.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const key = keyInput.current?.value ?? ''
              if (keyInput.current) keyInput.current.value = ''
              void act('save-key', { key })
            }}
          >
            <label>
              OpenAI API key
              <input
                ref={keyInput}
                aria-label="OpenAI API key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter or replace API key"
                disabled={Boolean(pending) || !settings?.openai.credentialStore}
              />
            </label>
            <button disabled={Boolean(pending) || !settings?.openai.credentialStore}>
              Save API key
            </button>
          </form>
          {!settings?.openai.credentialStore && (
            <p>
              OS credential storage is unavailable on this platform. Runner environment variables
              remain supported for development.
            </p>
          )}
          <button disabled={Boolean(pending)} onClick={() => void act('remove-key')}>
            Remove API key
          </button>
          <button disabled={Boolean(pending)} onClick={() => void act('use-environment')}>
            Use development environment key
          </button>
          <p>Removing a key also disables environment fallback. Re-enable it explicitly above.</p>
        </>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void act('endpoint', { endpoint })
            }}
          >
            <label>
              Ollama server
              <input
                aria-label="Ollama server"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                disabled={Boolean(pending)}
              />
            </label>
            <button disabled={Boolean(pending)}>Save Ollama server</button>
          </form>
          <p>
            Local loopback HTTP only. Start Ollama and install a local tool-capable model. No
            automatic cloud fallback.
          </p>
        </>
      )}
      <button disabled={Boolean(pending)} onClick={() => void act('connection')}>
        Test connection
      </button>
      {current?.connection && (
        <p
          role="status"
          className={current.connection.ok ? 'provider-success' : 'provider-failure'}
        >
          {current.connection.message}
        </p>
      )}
      <label>
        Available model
        <select
          aria-label="Available model"
          value={chosen}
          disabled={Boolean(pending) || !current?.models.length}
          onChange={(e) => setModel(e.target.value)}
        >
          {!current?.models.length && <option value="">Test connection to list models…</option>}
          {current?.models.map((id) => (
            <option key={id} value={id}>
              {provider === 'openai' ? 'OpenAI' : 'Ollama'} · {id}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={Boolean(pending) || !chosen}
        onClick={() => void act('agent-check', { model: chosen })}
      >
        Run coding-agent check
      </button>
      {current?.checks[chosen] && (
        <p
          role="status"
          className={current.checks[chosen].ok ? 'provider-success' : 'provider-failure'}
        >
          {current.checks[chosen].message}
        </p>
      )}
      <button
        disabled={Boolean(pending) || !chosen || !current?.checks[chosen]?.ok}
        onClick={() => void act('select', { model: chosen })}
      >
        Use model for new sessions
      </button>
      <p>
        Default:{' '}
        {settings?.selection
          ? `${settings.selection.provider === 'openai' ? 'OpenAI' : 'Ollama'} · ${settings.selection.model}`
          : 'No model selected'}
        . Existing sessions keep their original provider and model.
      </p>
      {pending && (
        <p role="status">
          {pending === 'agent-check'
            ? 'Checking tool-call round trip… this can take up to 90 seconds.'
            : 'Updating provider settings…'}
        </p>
      )}
      {error && (
        <p role="alert" className="provider-failure">
          {error}
        </p>
      )}
    </dialog>
  )
}
