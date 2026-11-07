# Guided browser replay setup

Start `npm.cmd run dev` and open http://127.0.0.1:1420. Open a Git checkout, describe the bug, select **Investigate browser behavior**, and start the investigation. An existing coding session can use **Add browser replay**. Scenario setup and Baseline replay do not call an AI provider.

## Five steps

1. **App setup**: name the scenario and enter the start command, worktree-relative directory, local HTTP origin, and page path. **Detected setup suggestions** inspect the captured baseline's package scripts and simple Node server entry points. **Use suggestion** copies editable values; it executes nothing. Use `{PORT}` in both the command and origin when the app accepts a port argument. Under **Startup options**, configure the readiness endpoint and optional preparation command. Each preparation and app launch still requires separate approval showing the actual argv and working directory. A failed startup links back to this step and retains its output.
2. **User actions**: add clicks, fills, and selects. Give each action a readable name and an element selector. Fill uses exact text; select uses the option's value attribute. **Use an empty value** deliberately clears a field or selects an empty option. Choose **Wait for request** when the next action should wait for a request to be sent. It does not release that response. Move actions with the earlier/later buttons, or Tab to a button and press Enter. Removing a row focuses an adjacent row or the Add button.
3. **Controlled requests**: name each response, select its HTTP method, enter an exact URL, and edit its JSON response fixture. Under **Request matching options**, configure the response status, optional exact request body, and stable request ID. Exact empty body and Any body are distinct. Renaming an ID updates its gates and delivery order. Removing a referenced request leaves an actionable missing-gate error instead of silently changing the assertion. Readable names appear in review and the existing replay timeline.
4. **Expected behavior**: enter a description, the visible-DOM selector, and one exact expected text per matching element in DOM order. The assertion reads each visible match's `textContent`, including whitespace, line breaks, and descendant text. Add zero texts to expect no matching elements. Choose **Start checking after response** for an assertion that must remain true after that response and every later response, or choose final checkpoint only. **Checkpoint timing** retains the existing settle delay and timeout. Review shows the exact assertion and checkpoint rule.
5. **Review and run**: review the command, action sequence, fixtures, delivery order, and assertion. Reorder delivery using earlier/later controls. **Save scenario** stores a revision without running commands. **Save and replay Baseline** saves, then requests the existing preparation/start approvals. Once saved, the editor collapses and the browser frame/timeline take focus. **Replay Baseline**, timeline reordering, **Generate two fixes** / **Generate Candidate A first**, **Replay all**, patch review/apply, and regression export keep the existing workflow.

Arguments are passed literally without a shell. Quote arguments containing spaces; single-quoted Windows paths avoid double-quote backslash escaping. Example: `node 'server folder/app.cjs' {PORT}`. The runner accepts the existing supported executable list, not arbitrary shell programs or command pipelines.

## Drafts, JSON, and proposals

**Advanced JSON** edits the same scenario as the guided fields. All supported fields round-trip, including preparation argv, optional click values, empty fill/select values, request gates and IDs, null versus exact body strings, primitive JSON fixtures, response status, assertion checkpoint, and timing. Unknown fields are reported explicitly because the engine would otherwise discard them. A malformed JSON document stays in the advanced view for correction. A malformed fixture or incomplete command stays in its guided field until it can be represented in the advanced document; switching views never silently discards it.

Unsaved fields and malformed input are retained per session in this browser's local storage. Reopening the session restores that draft. Failed saves and failed replays preserve entered values. **Discard draft and restore saved** explicitly restores the runner's saved scenario. Drafts are local to this browser/profile; saved scenarios, revision history, and completed evidence belong to the runner session and survive restart.

Editing a saved scenario immediately makes its displayed evidence stale, including the candidate's verification summary. Saving creates a new revision only when the configuration changes. Earlier recordings keep their original scenario definitions. An unchanged restored draft does not require a new revision. If another view saves first, saving an older base revision is rejected; load the latest saved configuration or explicitly keep your draft against that revision before saving again.

**Ask agent for scenario** is optional and can consume provider quota. It remains a read-only proposal request. **Review agent proposal** shows the proposed configuration and changed sections without replacing fields or saving it. **Use proposal as draft** explicitly loads it; correct individual fields before Save. Loading a proposal grants no permission to execute app commands.

## Reproduce the dashboard acceptance

The controlled acceptance uses a separate Git checkout with `dashboard.cjs`, `dashboard.js`, and `dashboard.html`, unrelated to pickup search. Run:

```powershell
npx.cmd playwright test --config playwright.coding.config.ts tests/coding/project-replay.spec.ts
```

It creates a new session, fills the guided editor, injects a failed save and reloads the retained draft, reviews/corrects a scripted agent proposal, and runs the real comparison/export flow. No live model is called. The latest checkout/session and evidence paths are written to ignored `artifacts/step6-latest.json`.

To configure that checkout manually:

- Task: “Clicking Week then Month lets the slow Week response replace the active monthly metrics. Reproduce and compare a generation guard with results keyed by period.”
- App: `node dashboard.cjs {PORT}`; directory `.`; origin `http://127.0.0.1:{PORT}`; page `/dashboard`; readiness `/health`; preparation `node --check dashboard.js`.
- Click **Choose Week** at `[data-period="week"]`, waiting for `week`; then **Choose Month** at `[data-period="month"]`, waiting for `month`. Request IDs are available in the collapsed matching options; action IDs are available under identifier options.
- **Weekly metrics** (`week`): GET `/metrics/snapshot?period=week`, any request body, status 200, fixture `{"rows":["Weekly revenue $12,000","Weekly invoices 72"]}`.
- **Monthly metrics** (`month`): GET `/metrics/snapshot?period=month`, any request body, status 200, fixture `{"rows":["Monthly revenue $45,000","Monthly invoices 310"]}`.
- Expected description: “Active monthly metrics must survive every later response.” Selector `#metric-list li`; expected texts `Monthly revenue $45,000` and `Monthly invoices 310`; begin checking after `month`; settle 80ms, timeout 4000ms.
- Deliver **Monthly metrics → Weekly metrics**. Baseline reproduces the bug. Deliver **Weekly metrics → Monthly metrics** and Baseline passes. Restore the reversed order, generate the fixes, and use **Replay all**. The controlled generation guard and keyed-results fixes both pass under both orders. Export the chosen patch and regression; the independent regression fails against Baseline and passes against the chosen fix.
- Reopen the saved session and change the scenario name: evidence becomes stale immediately, then remains stale at the new saved revision until rerun. The acceptance also loads a scenario in the previous JSON format, edits it in both views, and verifies no supported fields were dropped.

The acceptance's scripted recipes are private test-runner configuration, clearly labelled as a test provider. Using **Generate two fixes** in your normal app instead uses the provider you configured; it is a live operation.

## Setup limits

This edits the existing scenario format; it does not record browser gestures or discover selectors automatically. Package/Node detection is a heuristic, not proof that a command starts successfully. Confirm port handling, bind address, readiness, dependencies, and selectors. Dependency installation is an optional approved preparation command, never automatic.

Replay remains local Chromium with HTTP fetch/XHR, 1–20 actions, and 1–6 uniquely matched requests. All actions run before response delivery. Workflows requiring a response before a later action, WebSockets, authentication setup, request-header matching, wildcard URLs, and partial/semantic JSON body matching are outside the supported format. Exact URL matching sorts query parameters; body text matching does not normalize whitespace. Preflight catches overlapping configured matches and missing references, but whether a selector exists or a request is sent exactly once is established by the real browser. App startup failures and missing/repeated matches remain execution errors, separate from a failed DOM assertion.

Relevant checks: `node --test runner/scenario-editor.test.ts`, `npm.cmd run test:runner`, `npm.cmd run test:coding`, `npm.cmd test`, `npm.cmd run test:production`, `npm.cmd run typecheck`, and `npm.cmd run lint`. Step 5 recovery remains available. No desktop packaging, app-wide redesign, commit, or push is part of this step.
