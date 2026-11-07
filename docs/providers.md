# Provider settings and model selection

Run `npm.cmd run dev` and open http://127.0.0.1:1420. The main workspace offers **Connect OpenAI**, **Connect Ollama**, and **Try the demo · no model** when no model is selected. **Manage providers** remains available in the header and task-composer dropdown.

## OpenAI

1. Open **Connect OpenAI** or **Manage providers → OpenAI**.
2. Enter the API key in the password field and press **Save API key**. The field clears on submission. Entering another key replaces the stored credential.
3. Press **Test connection** to authenticate and list models available to that API key. This does not verify coding or tool capability.
4. Select an available model and press **Run coding-agent check**. This sends a harmless in-memory tool and verifies a call/result round trip. It does not access repositories or execute commands; it can consume API tokens.
5. Press **Use model for new sessions**, close settings, open a repository, enter a task, and press **Start coding**. Review each requested project command and working directory before approving it.

**Remove API key** deletes the Windows credential and disables environment fallback. **Use development environment key** removes the saved credential and explicitly re-enables `OPENAI_API_KEY` from the runner environment. Existing `OPENAI_API_KEY` / `PARALLAX_MODEL` environment configuration remains supported for development, including the older `/pickup` live mode. No API key is stored in `.env` by the settings UI.

The Windows runner uses Generic Credentials through `CredWriteW`, `CredReadW`, and `CredDeleteW`, in the current Windows user's Credential Manager (`PARALLAX AI/OpenAI`). It invokes a bundled helper with JSON over stdin; key material is never a command argument or temporary file. The helper's execution-policy setting is process-scoped and does not change machine or user policy. Other operating systems fail closed for key saving; their runner environment support remains available. There is no plaintext storage fallback.

## Ollama

1. Start your local Ollama server and install a local model that supports tool calls.
2. Open **Connect Ollama**. The default server is `http://127.0.0.1:11434`. Save a different loopback HTTP origin if needed. Remote URLs, credentials, URL paths, and redirects are rejected.
3. **Test connection** lists installed models. An unreachable server, empty local-model list, and failed tool check have distinct messages. Models named with the `:cloud` suffix are excluded.
4. Choose a model, run the harmless **coding-agent check**, and select **Use model for new sessions** after it passes.
5. Start a task normally. Ollama uses the same isolated worktrees, repository instructions, file tools, diff review, and command approvals as OpenAI. A stopped server stops the turn with an error and retains changes; there is no cloud fallback.

The loopback server is trusted to serve the model you select. PARALLAX does not install Ollama, download models, or verify how a separately configured Ollama server itself performs inference.

## Selection, evidence, and recovery

The task dropdown displays provider and model together. Selecting a listed model saves the default for new sessions. Existing sessions, their active turns, follow-ups, and Compare and Replay generation remain pinned to their original selection; changing the default never reroutes them. Each provider invocation records the requested provider/model, returned model identifier when supplied, candidate, turn, and completion status in the session evidence. Older sessions without this metadata remain identified as legacy sessions.

Non-secret settings live in `%USERPROFILE%\.parallax\coding-sessions\providers.json`, or the directory selected by `PARALLAX_STATE_DIR`. The default selection and model lists survive app/runner restarts. Readiness checks intentionally reset on runner restart; rerun the harmless tool check before a new coding turn. Completed session evidence is retained. Environment-configured development models preserve their previous opt-in behavior without requiring a settings check.

Keys are retrieved only by the runner. They are excluded from API responses, renderer persistence, sessions, patches, and provider metadata. Project command environments exclude OpenAI credentials; known keys are redacted from provider text/tool arguments and command output, including split output chunks. Worktrees remain a trusted-development boundary rather than an OS sandbox: approved project code runs as your Windows user and could access that user's own credential store independently.

## Verification

`npm.cmd run test:coding` includes the settings acceptance. It creates a separate Git clone and two explicitly labelled **protocol test doubles — no live model**, uses a temporary real Windows Credential Manager target, configures both providers through the UI, performs harmless tool checks, executes file edits and approved Node tests through both adapters, changes the default during an active turn, verifies pinned follow-ups, restarts the runner with the UI open, reloads the app, and verifies secret exclusion and local-provider failure without cloud fallback. Test credentials are inert and removed in cleanup. Doubles are not evidence of real model capability.

Focused checks: `node --test runner/provider-settings.test.ts runner/provider.test.ts runner/process.test.ts`. Existing coding, pickup, Compare and Replay, and production/CSP suites remain part of verification.

Real OpenAI and Ollama acceptance requires an available real API key/local model. No installer was found in the Step 4B starting environment, so installed-Windows-app verification must remain outstanding; browser acceptance does not substitute for it. Windows packaging is unchanged.

References: [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list), [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Ollama installed models](https://docs.ollama.com/api/tags), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [Windows credential writing](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew).
