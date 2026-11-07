# Compare and Replay on local web projects

Launch the browser app from `E:\projects\parallax-ai`:

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:1420. Windows packaging and the app-wide redesign are outside this step. The existing coding, follow-up, diff, export/apply, and `/pickup` workflows remain available.

## Investigate your own app

1. Enter your Git checkout root and click **Open repository**. Review its branch, exact HEAD, and dirty-baseline notice. Enter the bug in plain English, check **Investigate browser behavior**, and click **Start investigation**. This prepares the isolated implementation without generating fixes yet. Manual scenario configuration and Baseline replay do not require a provider key.
2. Expand **Replay scenario** and use the [guided editor](step-6.md). **Advanced JSON** remains available. Optionally use **Ask agent for scenario**, **Review agent proposal**, then **Use proposal as draft** when a provider is configured. Proposal requests are read-only: source edits and commands are blocked until the proposal request ends. Review and change individual fields before **Save scenario**.
3. Configure the app executable/argv/cwd, local origin, readiness path, and page path. Use `{PORT}` in the command and origin so each isolated app can use a free port. Existing running apps are not attached silently. A fixed port already in use produces an execution error.
4. Configure fixed browser actions, controlled requests, JSON response fixtures, and the expected visible DOM text. Actions support **click**, **fill**, and **select** using unique Playwright selectors. `waitForRequest` lets an action wait for its outgoing request gate before the next action. Request matching uses exact normalized URL, method, and optional exact `postData`; overlapping or repeated matches are errors.
5. Press **Replay Baseline**. Approve the actual app command and working directory. If `app.prepare` is configured, approve that command separately first. Dependencies are not linked to the original checkout; `app.prepare` can run a project installation/build inside the isolated worktree. It runs before every launch when configured. Lockfiles and tracked source must remain unchanged; generated output should be ignored.
6. The runner launches real Chromium, performs the configured actions, holds requests behind explicit gates, and releases them in the selected order. The browser frame and aligned tracks show actual action/response/UI checkpoints. The amber playhead selects corresponding event IDs when switching versions. Use the native slider's arrow keys to scrub.
7. Drag a network-response clip onto another clip, or focus **Move response … earlier/later** and press Enter. The changed order marks earlier evidence stale. Press **Replay Baseline** again. The actions, request fixtures, and assertion remain fixed when only the delivery order changes.
8. Use **First unexpected state** to jump to the first checked observation that violates the expectation. The inspector shows the request, fixture, recorded expected behavior, and actual DOM values. A cancelled request is explicitly labelled as not consumed. Intermediate states before `expected.afterRequest` are observations, not failing assertions; the final checkpoint is always checked.
9. After a current Baseline run completes, click **Generate two fixes**. The configured provider receives the original task, saved scenario, actual Baseline evidence, and the first approach's diff when producing the second. Both worktrees share the captured baseline. Project commands and replay app launches still require approval.
10. Press **Replay all**. Compare Baseline, Candidate A, and Candidate B under the same saved scenario and selected order. Identical observed results are a **tie**; no winner is invented. Cancelled/missing/extra requests produce a **coverage changed** warning and prevent an equivalent-evidence tie. A scenario execution error is distinct from a product assertion failure.
11. The relevant diff stays below the timeline. **File changes, project checks, and apply** expands the existing file-by-file review and explicit **Apply to checkout** flow. Apply retains its baseline/conflict preflight and index-preserving behavior.

An existing coding session can add this workflow through **Add browser replay**. Saved sessions retain scenarios, scenario revision history, recordings, frames, source digests, and candidate edits across reload/restart. Editing a candidate, saving a different scenario, or changing the order marks affected evidence stale until replayed. Old recordings retain their own scenario definition instead of borrowing current fixtures.

## Scenario example

This example belongs to the acceptance dashboard, not pickup search:

```json
{
  "name": "Previous-period metrics overwrite the active month",
  "app": {
    "executable": "node",
    "args": ["dashboard.cjs", "{PORT}"],
    "cwd": ".",
    "origin": "http://127.0.0.1:{PORT}",
    "page": "/dashboard",
    "readyPath": "/health",
    "prepare": { "executable": "node", "args": ["--check", "dashboard.js"] }
  },
  "actions": [
    {
      "id": "choose-week",
      "label": "Choose Week",
      "kind": "click",
      "selector": "[data-period=\"week\"]",
      "waitForRequest": "week"
    },
    {
      "id": "choose-month",
      "label": "Choose Month",
      "kind": "click",
      "selector": "[data-period=\"month\"]",
      "waitForRequest": "month"
    }
  ],
  "requests": [
    {
      "id": "week",
      "label": "Weekly metrics",
      "method": "GET",
      "url": "/metrics/snapshot?period=week",
      "postData": null,
      "status": 200,
      "json": { "rows": ["Weekly revenue $12,000", "Weekly invoices 72"] }
    },
    {
      "id": "month",
      "label": "Monthly metrics",
      "method": "GET",
      "url": "/metrics/snapshot?period=month",
      "postData": null,
      "status": 200,
      "json": { "rows": ["Monthly revenue $45,000", "Monthly invoices 310"] }
    }
  ],
  "order": ["month", "week"],
  "expected": {
    "description": "Active monthly metrics must survive every later response.",
    "selector": "#metric-list li",
    "texts": ["Monthly revenue $45,000", "Monthly invoices 310"],
    "afterRequest": "month"
  },
  "settleMs": 80,
  "timeoutMs": 4000
}
```

For Vite, for example, use `npm` with `args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "{PORT}"]`. If dependencies are absent, an optional preparation is `{"executable":"npm","args":["ci"]}`; it requires approval and is not silently installed. A preparation/start command that changes captured source is reported as an execution error rather than verified against an altered baseline.

`expected.texts` is an exact array, one string per visible matching element. `afterRequest: null` checks only the final state; a request ID starts checking subsequent observed states after that response is consumed. Each response observation waits for fetch body consumption or XHR loadend, two animation frames, and `settleMs`. Choose an interval appropriate to delayed UI work; this is an explicit observational checkpoint protocol, not a model's interpretation of an image.

## Reproduce the scripted dashboard acceptance

```powershell
npm.cmd run test:coding
```

This runs the existing ordinary feature acceptance and the new dashboard flow. The dashboard is created as local source edits in its own independent Git clone, with no fixture commits. It uses different controls and endpoints from pickup. It has no npm runtime dependencies. The scripted provider creates a latest-generation guard and a results-by-period map, while browsers, approvals, worktrees, diffs, assertions, and exports execute for real.

The suite writes `artifacts/step3-latest.json`, identifying its repo, session directory, provider fixture, and `scenario.json`. To inspect the completed example in the normal app, stop any existing dev/preview launcher, then use:

```powershell
$demo = Get-Content -LiteralPath artifacts\step3-latest.json -Raw | ConvertFrom-Json
$env:PARALLAX_STATE_DIR = $demo.stateDir
$env:PARALLAX_ENABLE_TEST_PROVIDER = '1'
$env:PARALLAX_TEST_PROVIDER_FILE = $demo.providerFile
npm.cmd run dev
```

Open http://127.0.0.1:1420 and choose the operations dashboard in **Saved coding sessions**. Or open the repo path printed by `$demo.repo`, start a new investigation, ask for/review the scenario proposal, and follow the numbered steps above. The JSON is also available at `$demo.scenarioFile`.

These environment flags deliberately enable a **SCRIPTED TEST PROVIDER — NO MODEL** recipe for this acceptance fixture. They do not create a general English-language model. Clear them and use normal runner state when returning to ordinary live coding. The original `/pickup` example remains available because the replay demo does not replace the bundled repository root.

The acceptance checks these outcomes with identical actions, fixtures, and expectations:

| Delivery order | Baseline                                                    | Latest-generation guard | Results by period |
| -------------- | ----------------------------------------------------------- | ----------------------- | ----------------- |
| Month → Week   | Product bug: stale weekly metrics overwrite monthly metrics | Pass                    | Pass              |
| Week → Month   | Pass                                                        | Pass                    | Pass              |

It also checks source staleness, scenario edits, mouse/keyboard reorder, keyboard scrubbing, playhead alignment, cancellation during browser work, changed coverage from request cancellation, an unmatched-request execution error, and an independently executed exported regression. Focused runner tests cover XHR POST bodies, cross-origin interception/preflight, repeated matches, immutable scenario revisions, and read-only proposals.

If credentials are already configured, the acceptance chooses the live provider for proposals/fixes. Otherwise it explicitly uses the scripted provider. Do not interpret scripted results as model-generated fixes; live verification must be reported separately.

## Standalone regression export

Select the chosen fix and use **Export chosen patch** and **Export regression test**. The `.spec.ts` file contains the saved fixture bodies, actions, exact order, the same browser driver, assertion, and setup/run instructions. It imports only Playwright, with no PARALLAX source dependency. Its strict coverage check deliberately fails if an implementation cancels or changes expected requests.

In the target repo, install Playwright if needed, run the configured preparation/start command in its app directory, put the exported file in `parallax-regression`, and set the actual local origin:

```powershell
$env:PARALLAX_BASE_URL = 'http://127.0.0.1:YOUR-APP-PORT'
npx.cmd playwright test --config ./parallax-regression parallax-regression.spec.ts --output ./parallax-regression/results
```

The acceptance executes the downloaded file independently against both the buggy Baseline and chosen fix: Baseline must fail the product assertion and the fix must pass. The patch is checked with `git apply --check`; applying remains explicit through the existing UI or your own Git command.

## Limits

- Local loopback HTTP apps in Chromium, with JSON fixtures for 1–6 controlled fetch/XHR requests and up to 20 click/fill/select actions. URL/method/body matching is exact; configure every fetch/XHR used by the scenario. Unmatched API calls are blocked and reported.
- Browser workers/service-worker interception, streaming bodies, WebSockets, server-side requests, remote/HTTPS apps, native/mobile execution, automatic interaction recording, persisted authentication setup, and performance benchmarking are outside this implementation. External static origins are blocked; serve required assets locally.
- Checkpoints observe visible DOM text after the declared handling/settling protocol. Delayed application work beyond that interval needs an appropriate scenario adjustment. Screenshots are real recordings, not live remote browsing or simulated verification.
- Live provider verification depends on configured credentials. Dependency installs and other project stacks require their own verification; the acceptance app uses only Node built-ins. Source/diff/edit limits and conservative apply conflicts from Step 2 remain unchanged.
- Session worktrees, history, and evidence are retained. No commits, pushes, auto-merges, Windows packaging, or app-wide redesign are part of this step.

Implementation reference: [official Playwright network interception documentation](https://playwright.dev/docs/network).
