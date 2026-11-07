# Google Gemini in PARALLAX

Start `npm.cmd run dev`, open http://127.0.0.1:1420, and choose **Manage providers → Google Gemini** or **Connect Gemini**.

1. Enter your key in **Gemini API key**, then **Save API key**. The password input clears on submission. Enter another key to replace it. Never paste keys into coding tasks or repository files.
2. Press **Test connection**. The runner authenticates with the `x-goog-api-key` header, paginates Google's model catalog, and lists models advertising `generateContent`. Available stable Flash-Lite models appear first, followed by preview Flash-Lite, Flash, and other models. Catalog availability alone does not establish tool support or quota.
3. Choose an **Available model**. The exact ID appears separately under **Exact model ID**.
4. Press **Run coding-agent check** to verify a harmless function-call/result round trip. This consumes API quota and is separate from connection testing and real project verification.
5. Press **Use model for new sessions**, close settings, open your Git repository, enter a task, and start coding. Review each requested command and working directory before approval.

Keys use the current Windows user's Credential Manager at `PARALLAX AI/Gemini`, separately from OpenAI. The runner retrieves them; settings responses and renderer storage never contain the saved key. The helper receives key material over stdin, not arguments or temporary files. **Remove API key** deletes the credential and disables environment fallback. **Use development environment key** explicitly re-enables `GEMINI_API_KEY` (preferred) or `GOOGLE_API_KEY` on the runner. Both keys are stripped from project-command and replay-browser environments; known keys are redacted from streamed text, tool arguments, and command output. Existing trusted-development/worktree limits apply.

## Agent bounds and token usage

**Agent round limit** accepts 2–24, default 12. One round is one provider model response, which may request several tools. New sessions capture this limit; existing sessions and their follow-ups retain theirs. Each candidate and instruction gets a separate bounded invocation. Hitting the limit stops the agent and retains partial edits/checks without claiming completion. This bounds rounds rather than API spending or approved-command count.

Every invocation displays its requested model, returned model version, round/limit, tool-call count, status, and API-provided token counters. Counters sum requests; cumulative updates within one streamed response are counted only once using the last metadata. Input includes cached tokens; cached and thought counts are shown separately when supplied and are not added again to the API total. Missing usage remains unreported. Streamed model text and actual tool/command activity are visible; thought text and opaque signatures are not displayed.

The adapter uses Google's documented `streamGenerateContent` integration, JSON-schema function declarations, original model parts with thought signatures (including empty signed parts), and matching function responses with IDs when provided. Only complete successful responses execute tools. Cancellation, truncated streams, token exhaustion, and quota failures stop the invocation. There are no automatic API retries or provider substitutions. After a 429, inspect quota/rate limits and explicitly continue later from retained edits.

## Verification

```powershell
node --test runner/gemini-provider.test.ts
npx.cmd playwright test --config playwright.coding.config.ts tests/coding/gemini.spec.ts --grep "protocol double"
```

The double is clearly labelled; browsers, worktrees, edits, approvals, Node tests, and replay requests execute for real. Ordinary `npm.cmd run test:coding` includes it and skips real API calls.

After configuring a real key in the running app:

```powershell
npm.cmd run test:gemini:live
```

The opt-in test uses the app at ports 1420/4317 and never accepts or retrieves the API key. It opens a separate Git clone through the UI; requests a greeting edit and tests; approves the known Node test; requests an uppercase-option follow-up; independently checks behavior; configures a saved team-report replay; reproduces the baseline bug; requests two distinct Gemini fixes; and replays both response orders against Baseline/A/B. Only known fixture Node commands are approved; other commands are skipped. The original checkout is checked for preservation. Fixed 65-second pauses separate live stages to avoid combining tasks into one request-rate window; they are not automatic API retries and cannot guarantee available quota.

Evidence lives under ignored `artifacts/gemini-live/<id>`, including exact model IDs, usage, commands, screenshots, saved scenario, and session records. An interrupted full test is not a passed full test. A separate explicit browser-only finalization can validate retained real patches without generating more model requests; its proof preserves the interrupted model status.

To reproduce manually from the UI, open the repo path in that directory's `instructions.json`. Its task strings give the initial feature, follow-up, and investigation prompts. **Saved coding sessions** reopens interrupted work. For replay, check **Investigate browser behavior**, start, paste the directory's `scenario.json` into **Replay scenario JSON**, save, run Baseline and approve its Node commands, then **Generate two fixes** and **Replay all**. Use earlier/later response controls to reverse delivery order and replay again. Settings, the composer, and invocation evidence display the exact model IDs.

References checked: [Google function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), [model listing](https://ai.google.dev/api/models), [Generate Content API and usage metadata](https://ai.google.dev/api/generate-content), [thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures), and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
