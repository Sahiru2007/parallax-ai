# Step 7 — The precision editing desk

Parallax's browser workspace now uses warm paper surfaces, dark ink, fine rules, compact Inter typography and JetBrains Mono for source, commands, times and model IDs. The two offset planes in the wordmark and favicon reference the product's name. Vermilion marks the main action, selected version rule and replay playhead; green, amber and red remain paired with explicit evidence/status text.

## Working layouts

- The entry screen prioritizes the task composer with the selected repository, branch, exact baseline, model picker and coding/investigation choices close together. Recent sessions live in a compact rail.
- Coding uses connected conversation/activity and source-review panes. Activity entries have readable titles and timestamps; command output has its own view with real check results and source-staleness markers. Follow-up text stays editable while a turn runs; submission still waits for the runner to become available.
- Drag the vertical separator, or focus it and use Left/Right (Shift for larger increments), Home or End. Pane widths and rail/activity visibility persist in this browser profile. Secondary panes stack on narrow windows.
- Compare & Replay connects Baseline, A and B to the same baseline revision. The version controls show AI-turn and replay outcomes independently. **Focus replay** hides the session rail and activity pane. **Show activity** and the rail control restore them.
- Captured browser state and the dark timeline share the main surface. The event inspector and selected candidate's diff sit alongside on wide layouts and below on narrow layouts. The inspector can be resized or hidden. The playhead remains aligned when switching versions. Large timelines scroll horizontally so labels and reorder controls remain usable.
- **Browser at actual size** provides a scrollable native-resolution recording; **Fit browser frame** restores an overview. The original full frame remains available through its existing link.
- The guided scenario editor, provider settings, command approvals, patch review and recovery controls use the same typography and working surfaces. Completed-turn receipts collapse; interrupted recovery stays open with its next action. Provider settings returns keyboard focus to its opener on close.
- Task drafts and per-session follow-up drafts survive reload. Stable activity entries preserve expanded output, text selection and scroll position as state updates arrive. Saved sessions, scenarios, model selection, patches and exports retain their existing formats.
- The runnable `/pickup` example shares the palette and mark. `/legacy` remains the historical design archive.

## Reproduce the verification

Run `npm run dev` and open `http://127.0.0.1:1420`.

1. Open a local Git checkout, select a provider/model, and submit a task. The tests use explicitly labeled scripted/protocol doubles and separate Git repositories; no live API requests are needed.
2. Review actual activity, approve a displayed command and working directory, then inspect **Command output**, file changes and checks. Type a follow-up while work is active. Resize the activity pane, reload, and reopen the saved session.
3. Start an investigation in the separate dashboard repository. Configure its Node start command, Week/Month clicks, `/metrics/snapshot?period=week` and `?period=month` fixtures, and monthly visible-DOM assertion through the five-step editor.
4. Deliver Month then Week: the baseline fails the assertion. Deliver Week then Month: the baseline passes. Generate the two scripted fixes, replay all under both orders, and inspect the tie. Reorder with drag/drop or focus a response's earlier/later control and press Enter. Scenario/order/source edits retain stale evidence until rerun.
5. Switch Baseline/A/B without losing the checkpoint. Inspect the event and relevant diff together, export the patch/regression, and use the existing reviewed apply flow.
6. Cancel an approved/in-flight turn or interrupt the runner, then inspect separate AI/evidence statuses and resume retained work. Existing recovery acceptance also verifies bounded retry cancellation and sequential A/B generation.

The production browser suite uses runner port **4318**, separate from development's 4317, with its own session store. This prevents preview verification from colliding with a running development workspace.

## Evidence

Screenshots are generated under `artifacts/step7/` (ignored by Git):

- `initial-1280.png`, `initial-1920.png`, `initial-780.png`, `initial-390.png`
- `active-coding-approval.png`, `coding-1280.png`, `coding-1920.png`, `coding-command-output.png`
- `comparison-1280.png`, `comparison-1920.png`, `comparison-detail-1920.png`, `comparison-780.png`, `comparison-390.png`
- `providers-1280.png`, `providers-1920.png`, `providers-390.png`
- `accessibility-proof.json` records core foreground/background contrast measurements. Keyboard focus, reduced motion, retained drafts, resize/collapse persistence, version alignment and horizontal-overflow checks run in the browser tests.

The screenshots and command logs record actual sessions and executed browser/check evidence. They are not model-generated images or simulated outcomes. Live-provider behavior is outside this visual verification; Gemini/OpenAI/Ollama routine coverage uses labeled controlled providers.

This step changes browser presentation and interaction only. It introduces no packages or runner/provider protocol changes, does not package Windows binaries, and does not commit or push.

## Executed checks

| Check                                                                        | Result                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| `npm run test:runner`                                                        | 55 passed                                    |
| `npm test`                                                                   | 14 passed                                    |
| `npm run test:coding`                                                        | 5 passed, 2 opt-in live Gemini tests skipped |
| Final ordinary-coding and dashboard acceptance after interaction refinements | 2 passed in one process                      |
| `npm run test:production`                                                    | 4 passed, including production CSP           |
| `npm run build`                                                              | Passed on the final source                   |
| Type checking, lint, formatting and diff whitespace checks                   | Passed                                       |

The separate coding repo exercised multiple-file edits, an approved build/test, a changed follow-up requirement, continued work in the same worktree, continuous UI reconnection after runner restart, exported patch review, successful apply/test in a clean checkout and rejected apply preserving a conflicting checkout's staged/unstaged changes. Focused coverage also checks a draft typed during a delayed follow-up submission, activity scroll/selection retention, current session-rail status and persisted pane preferences.

The dashboard flow exercised the guided editor, approval, browser recordings, mouse and keyboard reordering, both fixes under both orders, stale scenario/source/order evidence, distinct execution errors, patch review and independent regression export. Results:

| Response delivery | Baseline         | Candidate A | Candidate B |
| ----------------- | ---------------- | ----------- | ----------- |
| Week then Month   | Passed           | Passed      | Passed      |
| Month then Week   | Assertion failed | Passed      | Passed      |

The exported standalone regression failed the buggy baseline and passed the chosen fix. The recovery UI test exercised interruption/resume, separate AI/replay status, sequential candidate generation, retained approvals/evidence and cancellation of bounded retry waiting. Provider verification uses labeled Gemini/OpenAI/Ollama protocol doubles; no live-provider claim is made for Step 7.

Layouts were exercised at 1920×1080, 1280×720, 780px and 390px widths. Core desk foreground/background pairs measured 5.22:1–13.73:1 contrast. Keyboard focus, dialog focus restoration, reduced motion, real pointer/keyboard resizing, narrow-window overflow and checkpoint alignment were checked. These targeted checks are not a full screen-reader audit.

Remaining presentation limits: layout and unsaved text preferences are browser-profile local; narrow layouts stack working panes and scroll long timelines horizontally; large browser captures may need **Browser at actual size** or the original full-frame link. The historical `/legacy` archive retains its earlier design. Windows packaging remains outside this step.

The local screenshot/log index is `artifacts/step7/evidence.json`; core contrast and geometry evidence is `artifacts/step7/accessibility-proof.json`.
