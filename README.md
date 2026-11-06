# PARALLAX AI

A local coding-agent workspace for investigating browser timing bugs. Give it a task, watch actual repository tools run, edit response delivery order, compare competing fixes, and export a patch with its reproducible regression test.

The first complete workflow is the **pickup-address search race**. The main screen opens directly into an agent session composer. The earlier seven-screen foundation remains available at `/legacy`; it is outside the primary workflow. Its native setup reference is preserved in [docs/phase-1-native.md](docs/phase-1-native.md).

## Launch

Use **Node.js 24 LTS**, Git, and the existing npm dependencies. From this repository:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run dev
```

Open **http://127.0.0.1:1420**. On other shells, use `npm` / `npx` without `.cmd`. `npm run dev` starts both Vite and the local runner at `127.0.0.1:4317`. The browser accesses the runner through Vite's same-origin `/api` proxy. No API key, Rust build, Visual Studio installation, or desktop toolchain changes are required for this workflow. Chromium need only be installed once.

## Run the complete example

1. Click **Fix the pickup-search race**, then **Start investigation**.
2. Watch the session stream: revision capture, actual file reads, detached worktree creation, applied prewritten recipes, TypeScript checks, contract tests, Playwright runs, and actual patch diffs. Expand a tool event to read its output. The task composer stays docked so you can add steering notes, and **Cancel** interrupts active tools.
3. The baseline fails for **B → A**: type `Col`, type `Colombo`, release B, then release A. The late `Col` response overwrites the `Colombo` results. Baseline passes for **A → B**. Both candidate implementations are checked against both orders.
4. Use **Baseline**, **Candidate A**, and **Candidate B** above the browser recording. Switching preserves the selected order and displays that version's recorded outcome. Select an event to inspect the actual request, fixed payload, observed suggestions, elapsed time, and captured browser frame.
5. Drag one network response onto the other, or use its **Move earlier / Move later** buttons. **Replay all versions** launches fresh real Chromium runs for the selected schedule. Previously recorded outcomes remain visible while rerunning; they are recordings, not live simulated verification.
6. Open **Review patch**, compare the two actual diffs, and **Export this patch** for your chosen candidate. **Save regression test** downloads a standalone Playwright test for the selected order. The runner executes that same exported test against both candidates.

Candidate A uses a **latest-request guard**. Candidate B stores **results by query** and renders only the active query's entry. They change only `fixtures/pickup-search/src/useAddressSearch.ts` in their own worktrees. The bundled mode labels these fixes as **prewritten**, never as model output. Its worktrees, browser runs, observations, diffs, and assertions are real.

The browser panel displays actual captured frames. Playback and the shared playhead navigate those observations; **Replay all versions** performs execution. The three tracks are user actions, network responses, and observed UI state. Response-to-state links are recorded after the response JSON is consumed and the browser has two animation frames to commit. The harness reads the actual DOM; it does not ask a model to judge the result. The full screenshot can be opened from the browser toolbar.

## What is held constant

Both user actions and both JSON bodies come from `shared/scenario.ts` and stay identical when the order changes. Playwright intercepts both requests and holds each behind an explicit release gate. After every delivery it waits for JSON handling, reads the rendered suggestions, and captures a frame. After **both** deliveries, every version faces the same executable assertion: visible suggestions must match the active `Colombo` query.

Missing, duplicate, incomplete, or otherwise unexecutable schedules produce an explicit error. A failing behavior assertion is distinct from an execution error. No invented timing, test counts, confidence scores, or agent execution are displayed.

## Baseline and preservation of your work

An experiment is based on **the current HEAD plus a captured working-copy snapshot**, not an implicit clean checkout. The UI and session log show the exact revision, SHA-256 snapshot digest, dirty state, and source file count. Tracked edits and nonignored untracked source are included. Ignored caches, environment credentials, and build artifacts are excluded.

The runner creates three detached Git worktrees at the captured revision, then materializes the same snapshot in all three before applying candidate edits. It does not commit, reset, switch branches, push, or apply a candidate to your checkout. Diffs compare the candidate hook to the captured baseline hook, including when that fixture is still untracked in HEAD. Existing installed dependencies are reused through a worktree-local link; no candidate dependency installations occur.

Evidence, manifests, screenshots, exported tests, and retained worktrees live under the ignored directory:

```text
artifacts/investigations/<session-id>/
  session.json
  replay-<run-id>.json
  schedule.json                 # saved after a reordered replay
  frames/
  worktrees/baseline/
  worktrees/a/
  worktrees/b/
  exports/a/
  exports/b/
```

Reloading the page reconnects to the session. Completed session manifests are restored after restarting the runner; a replay then reopens their fixture servers. Interrupted runs are marked interrupted, never completed. Worktrees are retained for review. Use `git worktree list` to inspect them; there is no automatic destructive cleanup.

## Run an exported regression independently

The downloaded test has no imports from PARALLAX or the candidate implementation. It contains the fixed actions, payloads, delivery gates, handling barrier, and final assertion.

Start the chosen worktree's fixture in one terminal:

```powershell
$env:PICKUP_WORKTREE = 'E:\projects\parallax-ai\artifacts\investigations\YOUR-SESSION\worktrees\a'
npm.cmd run fixture
```

The command prints its actual local URL. Put the downloaded `pickup-regression.spec.ts` in a folder called `regression-export`, then in another terminal:

```powershell
$env:PICKUP_BASE_URL = 'http://127.0.0.1:PORT-PRINTED-ABOVE'
npx.cmd playwright test --config ./regression-export pickup-regression.spec.ts --output ./regression-export/results
```

The end-to-end test also runs the downloaded file through this standalone CLI path and checks that the exported patch applies to the captured baseline with `git apply --check`. Applying a patch to your own checkout remains your decision.

## Optional live agent

There was no provider integration in this repository. The runner now includes one configurable **OpenAI Responses API** provider with real function tools:

- `list_files` and `read_file` inspect the captured repository.
- `write_file` edits the candidate hook inside its isolated worktree.
- `run_checks` invokes the same executable type checks and browser harness.
- `inspect_diff` reads the actual candidate patch.

Copy `.env.example` to the ignored `.env` and configure a model your account can access:

```text
OPENAI_API_KEY=your-key
PARALLAX_MODEL=your-responses-model-id
```

Restart `npm run dev`, then select **Live agent** in the composer. Keys stay in the runner, are never returned by the API, and are stripped from candidate command environments. Requests use `store: false` and preserve the complete Responses tool context. Steering notes are included at the next model tool boundary. There is a 12-turn limit. Provider failures are reported explicitly; live mode never silently substitutes prewritten patches.

**Live provider mode has not been exercised against the OpenAI API in this workspace.** Verification used the bundled mode without an API key. The live implementation and types are present; API credentials and model access are needed to verify it against the real service.

## Scope and execution boundary

This is one complete vertical slice, not a general repository agent or a security sandbox. The repository selector currently registers this repository only. Both modes use the pickup fixture and immutable shared checks; live writes are restricted to its search hook. Arbitrary app harness discovery, general shell tools, browser video recording, and automatic patch application are not implemented.

The runner binds to loopback, validates request origins/hosts, requires a random local token on mutations, excludes credential files, and confines model file access to source in the candidate worktree. Browser replays block network traffic outside their fixture origin. Exported-test outputs are isolated from the repository's own test reports. These boundaries support trusted local development; detached Git worktrees are not an OS-level execution sandbox.

The existing Tauri project and native setup work are preserved. This rebuild is browser-runnable first; native packaging of the Node runner as a desktop sidecar is not implemented, and the native release binary was not rebuilt in this task.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:runner
npm.cmd test
npm.cmd run build
npm.cmd run test:production
npm.cmd run format:check
```

The browser suite includes the complete new workflow and the existing seven-screen tests at `/legacy`. The runner suite checks schedule invariants, impossible schedules, file confinement, and provider-credential isolation. The new workflow tests verify real outcomes, both reorder controls, both candidates, snapshot preservation, exported patch applicability, independently executable downloaded tests, reload recovery, cancellation, and origin/token rejection. Production checks retain the earlier CSP/responsive checks and verify the new workspace under its browser CSP. Screenshots are saved under ignored `artifacts/`.

For a production browser preview, run `npm run build` followed by `npm run preview` and open **http://127.0.0.1:1421**. Run one dev/preview launcher at a time: both use the same runner port. Neither an OpenAI key nor any new npm dependency is required for the bundled workflow.

## Structure

```text
src/features/agent/          Composer, conversation, browser evidence, timeline, patch drawer
src/LegacyApp.tsx           Preserved Phase 1 UI at /legacy
shared/                     Typed session contract and immutable behavior scenario
runner/                     HTTP/SSE service, worktree engine, provider, browser harness
fixtures/pickup-search/     Runnable React search application with the baseline bug
scripts/                    Cross-platform development and fixture launchers
tests/e2e/agent.spec.ts     Complete browser-to-runner integration flow
tests/production/           Production CSP and responsive checks
src-tauri/                  Preserved native shell and installed-toolchain work
```

Implementation follows the official [Playwright request interception documentation](https://playwright.dev/docs/network) and [OpenAI Responses function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling).
