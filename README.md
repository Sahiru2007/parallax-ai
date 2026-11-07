# PARALLAX AI

A local coding-agent workspace. Open a Git checkout, describe a task, continue with follow-ups in an isolated worktree, review real build/test evidence, and export or explicitly apply the patch. The pickup-search investigation also provides an editable browser execution timeline for timing bugs.

**Provider settings:** Connect OpenAI or local Ollama, check tool capability, and choose a model from the task composer. Saved keys use Windows Credential Manager on the runner. See [provider setup and verification](docs/providers.md).

**Step 3:** Compare and Replay now works inside ordinary project sessions for local Chromium apps using HTTP fetch/XHR. See [the project replay guide](docs/step-3.md) for scenario configuration, keyboard/mouse controls, standalone exports, and the separate dashboard acceptance example. `/pickup` remains runnable.

The main screen is the everyday coding workspace. The **pickup-address search race** remains accessible from its sample button or `/pickup`, with the existing two-candidate replay workflow. The earlier seven-screen foundation remains available at `/legacy`. Its native setup reference is preserved in [docs/phase-1-native.md](docs/phase-1-native.md).

## Launch

Use **Node.js 24 LTS**, Git, and the existing npm dependencies. From this repository:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run dev
```

Open **http://127.0.0.1:1420**. On other shells, use `npm` / `npx` without `.cmd`. `npm run dev` starts both Vite and the local runner at `127.0.0.1:4317`. The browser accesses the runner through Vite's same-origin `/api` proxy. The bundled pickup workflow requires no API key. Ordinary coding uses the configured live provider. No desktop toolchain changes are required. Chromium need only be installed once.

## Everyday coding — Step 2

1. Enter an existing local Git checkout root in **Local repository path** and click **Open repository**. The workspace shows its path, branch, exact HEAD, and whether local source edits will be included. The checkout needs an existing commit. Source credentials and ignored files are excluded.
2. Enter a normal coding task and click **Start coding**. One implementation is the default. **Compare approaches** creates two independent candidate worktrees from the same baseline. For browser timing investigations, select **Investigate browser behavior** and configure the session's saved scenario before generating fixes.
3. The agent reads repository `AGENTS.md` instructions (including inherited instructions), searches and reads source, creates/edits/deletes files, inspects the actual multi-file diff, and requests project commands. The conversation displays tool activity and streamed stdout/stderr. Provider credentials stay in the runner and are stripped from command environments.
4. Every project command requires an explicit **Approve command** or **Skip command** decision. The panel shows the executable, exact arguments, working directory, and npm lifecycle scripts when applicable. Approval applies once. If source changes while approval is pending, the command is skipped and must be requested again. Commands run without shell interpolation and use the existing deadline/process-tree cancellation support. Worktrees are not an OS sandbox; approved commands execute project code.
5. Send a **Follow-up instruction** after a turn ends. It uses the same candidate files, prior conversation, diff, and test evidence. No clean checkout replaces the earlier edits. A stopped/interrupted turn can be continued the same way.
6. Review **Changed files**, select each actual diff, and inspect **Build and test evidence**. Failed and skipped commands stay visible. Source digests mark earlier evidence **STALE** after edits, including external worktree edits detected by review refresh. **Export patch** downloads the current patch. **Apply to checkout** is a separate explicit action with an editable target checkout path.
7. Apply preflight requires the same baseline HEAD and unchanged touched files. It runs `git apply --check` before Git's default atomic apply, never `--index`, `--cached`, or `--reject`. Conflicts preserve local files and staged changes. There is no automatic merge or automatic application. A target whose touched files already differ from the captured baseline is conservatively rejected.

**Saved coding sessions** reopens the conversation, retained candidate source, file diffs, and completed checks. Atomic checkpoints preserve active work. An open UI detects runner outages even when the development proxy holds its event stream open; it reconnects, refreshes its mutation token, and displays interrupted turns without a page reload. Earlier completed sessions remain available. Interrupted commands are shown as skipped, never passed.

Everyday sessions, captured baselines, diffs, and worktrees are retained under `%USERPROFILE%\.parallax\coding-sessions\<session-id>` by default. `PARALLAX_STATE_DIR` can override that runner-side location. Dependencies are not linked to the original checkout; projects needing installation must request approval to install into their candidate worktree. The pickup sample continues reusing its installed dependencies as before.

The first implementation handles repositories with up to 25 MB of nonignored source (5 MB per source file), edits up to 200 KB per text file, and review patches under 150 KB. Model file tools exclude credentials, Git metadata, dependencies, and paths through links outside the worktree. Symlinked source is not materialized. Large repositories, automatic merges, automatic worktree cleanup for everyday sessions, and OS-level execution isolation are not implemented.

### Live and test providers

Use **Manage providers** to configure OpenAI or loopback Ollama and choose a model. The connection test and harmless coding-agent tool check have separate results. The default applies to new sessions; existing sessions retain their model. `OPENAI_API_KEY` and `PARALLAX_MODEL` in the ignored runner `.env` remain supported for development. The existing OpenAI Responses loop and new Ollama adapter use the same repository tools, approvals, saved conversation, and 24-response turn limit. No credentials are returned by the browser API. See [the setup guide](docs/providers.md) for key removal, restart behavior, and verification limits.

With no credentials, normal tasks report the missing configuration. They never silently use bundled recipes. The **scripted test provider** is available only when the runner has both `PARALLAX_ENABLE_TEST_PROVIDER=1` and `PARALLAX_TEST_PROVIDER_FILE` set to an explicit JSON fixture. It is labelled **NO MODEL** throughout the UI, executes the same repository tools and approvals, and does not interpret arbitrary English requests. It is for verification, not a model substitute.

```powershell
npm.cmd run test:coding
```

This acceptance suite starts its own browser app/runner and clean clones of the unrelated public [is-number repository](https://github.com/jonschlinkert/is-number), cached under ignored `artifacts/step2-seed`. First use requires access to that public repository; no fixture commits or dependency installs are created. It implements BigInt support across five files, continues with an opt-in requirement, runs the existing predicate cases through Node's test runner plus new tests, applies to a clean clone, verifies a conflicting clone's source/index preservation, and kills/restarts the runner with the UI open. It also checks denied approvals, compare worktrees, stale verification, changed-source approval invalidation, and a real failing command. Artifacts and provider mode are recorded in `artifacts/step2-acceptance/<id>/proof.json`.

**Live API verification remains outstanding when credentials are absent.** The acceptance suite chooses live mode for the feature/follow-up if credentials are already configured; otherwise it explicitly uses the scripted test provider. Restart/denial/failure probes always use the scripted provider.

## Run the pickup-search example

1. Click **Fix the pickup-search race**, then **Start investigation**.
2. Watch the session stream: revision capture, actual file reads, detached worktree creation, applied prewritten recipes, TypeScript checks, contract tests, Playwright runs, and actual patch diffs. Expand a tool event to read its output. The task composer stays docked so you can add steering notes, and **Cancel** interrupts active tools.
3. The baseline fails for **B → A**: type `Col`, type `Colombo`, release B, then release A. The late `Col` response overwrites the `Colombo` results. Baseline passes for **A → B**. Both candidate implementations are checked against both orders.
4. Use **Baseline**, **Candidate A**, and **Candidate B** above the browser recording. Switching preserves the selected order and displays that version's recorded outcome. Select an event to inspect the actual request, fixed payload, observed suggestions, elapsed time, and captured browser frame.
5. Drag one network response onto the other, or use its **Move earlier / Move later** buttons. **Replay all versions** launches fresh real Chromium runs for the selected schedule. Editing the order marks previous evidence **STALE**. Each replay has a new attempt ID; old recordings remain inspectable but cannot provide the current attempt's pass/fail badge.
6. Open **Review patch**, compare the two actual diffs, and **Export this patch** for your chosen candidate. **Save regression test** downloads a standalone Playwright test for the selected order. The runner executes that same exported test against both candidates.

Candidate A uses a **latest-request guard**. Candidate B stores **results by query** and renders only the active query's entry. They change only `fixtures/pickup-search/src/useAddressSearch.ts` in their own worktrees. The bundled mode labels these fixes as **prewritten**, never as model output. Its worktrees, browser runs, observations, diffs, and assertions are real.

The browser panel displays actual captured frames. Playback and the shared playhead navigate those observations; **Replay all versions** performs execution. The three tracks are user actions, network responses, and observed UI state. Response-to-state links are recorded after the response JSON is consumed and the browser has two animation frames to commit. The harness reads the actual DOM; it does not ask a model to judge the result. The full screenshot can be opened from the browser toolbar.

## What is held constant

Both user actions and both JSON bodies come from `shared/scenario.ts` and stay identical when the order changes. Playwright intercepts both requests and holds each behind an explicit release gate. After every delivery it waits for JSON handling, reads the rendered suggestions, and captures a frame. After **both** deliveries, every version faces the same executable assertion: visible suggestions must match the active `Colombo` query.

Missing, duplicate, incomplete, or otherwise unexecutable schedules produce an explicit error. A failing behavior assertion is distinct from an execution error. No invented timing, test counts, confidence scores, or agent execution are displayed.

## Pickup baseline and preservation of your work

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

Reloading the page reconnects to the session and preserves an edited response order. The runner checkpoints active sessions through atomic manifest replacement and saves the initial checkpoint before acknowledging a start/replay request. Completed evidence survives runner restarts; interrupted runs are marked interrupted, never completed. The UI refreshes its local mutation token when the runner reconnects.

**Retry** starts a new investigation with new worktrees, session ID, and attempt ID. It does not reuse previous run/check results. Active tools must finish stopping before retry or cleanup can begin. Commands have a two-minute deadline, and cancellation/timeout stop their process tree before releasing the run. Browser startup has a 15-second deadline and produces an execution error, separately from a failing behavior assertion.

Worktrees remain available for review until you choose **Clean up** in the session status row. Cleanup removes only that session's candidate worktrees and preserves screenshots, manifests, diffs, exported tests, and the original checkout. Replaying a cleaned session requires a fresh investigation. There is no automatic cleanup. Use `git worktree list` to inspect retained worktrees.

The HTTP runner registers the current repository by default. To launch it for another checkout (including a path with spaces), set `PARALLAX_REPO_ROOT` in the runner environment. It must name a Git checkout root containing the pickup fixture and installed dependencies; nested directories and invalid repositories are rejected. The browser selector still exposes one registered repository.

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

## Optional pickup live agent

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

The pickup investigation remains a separate runnable example with its immutable shared checks and restricted live hook edits. The main workspace supports saved, explicitly configured local Chromium HTTP fetch/XHR scenarios, two-candidate replay, general repository tools, and explicit apply. Automatic interaction recording, general shell interpreters, browser video recording, remote/HTTPS replay, and automatic patch application are not implemented.

The runner binds to loopback, validates request origins/hosts, requires a random local token on mutations, excludes credential files, and confines model file access to source in the candidate worktree. Browser replays block network traffic outside their fixture origin. Exported-test outputs are isolated from the repository's own test reports. These boundaries support trusted local development; detached Git worktrees are not an OS-level execution sandbox.

The existing Tauri project and native setup work are preserved. This rebuild is browser-runnable first; native packaging of the Node runner as a desktop sidecar is not implemented, and the native release binary was not rebuilt in this task.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:runner
npm.cmd test
npm.cmd run test:coding
npm.cmd run build
npm.cmd run test:production
npm.cmd run format:check
```

The browser suite includes the complete new workflow and the existing seven-screen tests at `/legacy`. The runner suite also exercises a repository path with spaces and staged/unstaged/untracked edits, cleanup safety, cancellation of a real command and its descendant, command timeout, browser startup failure, provider failures using test doubles, retry isolation, and actual HTTP runner process restarts during a command and immediately after start acknowledgement. An independent exported test fails on an isolated buggy baseline, then passes after the exported patch is applied to that same worktree. The original checkout's HEAD, index, status, and source digest are compared throughout. Reliability fixtures and proof outputs are retained under ignored `artifacts/reliability/`.

The browser workflow checks both reorder controls, stale-result labels across reload, matching replay actions/payloads/assertions, snapshot preservation, patch exports, independently executable downloaded tests, retry/cleanup controls, cancellation, invalid repository selection, and origin/token rejection. Production checks retain the earlier CSP/responsive checks and verify the workspace under its browser CSP. Screenshots are saved under ignored `artifacts/`.

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
