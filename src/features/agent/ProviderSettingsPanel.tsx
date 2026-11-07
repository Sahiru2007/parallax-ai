import { useEffect, useRef, useState } from 'react'
import type { ProviderId, ProviderSettings } from '../../../shared/providers'
import { providerName } from '../../../shared/providers'
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
  const roundInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  const current = settings?.[provider]
  const cloud = provider === 'ollama' ? undefined : settings?.[provider]
  const chosen = current?.models.includes(model)
    ? model
    : settings?.selection?.provider === provider &&
        current?.models.includes(settings.selection.model)
      ? settings.selection.model
      : (current?.models[0] ?? '')
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
        {(['gemini', 'openai', 'ollama'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            disabled={Boolean(pending)}
            aria-selected={provider === id}
            onClick={() => {
              if (keyInput.current) keyInput.current.value = ''
              setProvider(id)
              setModel('')
              setError('')
            }}
          >
            {providerName(id)}
          </button>
        ))}
      </div>
      {provider !== 'ollama' ? (
        <>
          <p>
            Key: {cloud?.keySource ?? 'none'}. Saved keys use Windows Credential Manager. Keys are
            never returned to the app.
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
              {provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key
              <input
                ref={keyInput}
                aria-label={`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter or replace API key"
                disabled={Boolean(pending) || !cloud?.credentialStore}
              />
            </label>
            <button disabled={Boolean(pending) || !cloud?.credentialStore}>Save API key</button>
          </form>
          {!cloud?.credentialStore && (
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
          {provider === 'gemini' && (
            <p>
              Test connection loads the generation models available to this key. Available
              Flash-Lite models appear first for lighter use. The exact model ID is shown below;
              listing models does not start a coding task or verify tool support.
            </p>
          )}
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
              {providerName(provider)} · {id}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p>
          Exact model ID: <code>{chosen}</code>
        </p>
      )}
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
          ? `${providerName(settings.selection.provider)} · ${settings.selection.model}`
          : 'No model selected'}
        . Existing sessions keep their original provider and model.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void act('round-limit', { limit: Number(roundInput.current?.value) })
        }}
      >
        <label>
          Agent round limit
          <input
            key={settings?.maxToolRounds}
            ref={roundInput}
            aria-label="Agent round limit"
            type="number"
            min={2}
            max={24}
            step={1}
            defaultValue={settings?.maxToolRounds ?? 12}
            disabled={Boolean(pending)}
          />
        </label>
        <button disabled={Boolean(pending)}>Save round limit</button>
      </form>
      <p>
        Limit: {settings?.maxToolRounds ?? 12} model-response rounds per candidate and instruction.
        A round may request multiple tools. New sessions use this limit; active sessions retain
        theirs. Reaching the limit stops the agent and retains partial evidence. Token usage is
        reported when provided by the API; this is not a spending limit.
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
