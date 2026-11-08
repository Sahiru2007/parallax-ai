# Graphite-and-citron design

The active coding workspace and runnable pickup example now use graphite working surfaces, muted silver text, fine dividers, compact controls and small corner radii. Citron identifies primary actions, selected controls and the replay playhead. Success, failure, stale evidence and interrupted AI turns use distinct colors with explicit text labels.

## Typography

Five font files are bundled in `public/fonts/`: Barlow 400/500, Barlow Condensed 500 and IBM Plex Mono 400/500. Interface text is approximately 15px, main headings 28px and technical text 12–13px. Shared typography/color tokens live in `src/styles/typography.css`; values use tabular numerals. Original licenses, pinned upstream URLs and file hashes are included with the fonts. No packages were added.

## Working views

The slim rail shows the selected repository, branch, baseline, recent sessions and provider settings. The compact workspace header shows the actual task and **Code / Replay** controls.

**Code** prioritizes the conversation/composer, with file review and real check output in the adjacent pane. The active composer shows the session's pinned provider/model; **Models…** opens the existing settings. Defaults still apply only to new sessions. Tool activity, command approvals, uncertainty/retry recovery, patch review/apply, and completed evidence use the existing runner and handlers.

**Replay** retains the agent pane on the left. Baseline, Approach A and Approach B are connected to their shared baseline. Actual captured browser state sits above the editable timeline, with selected-event details and the selected patch beside it when space permits. On smaller evidence panes, inspection details stack below the timeline. Fix-generation actions follow the evidence. The existing full-frame/actual-size controls remain available.

Switching views hides rather than remounts the working editor and evidence. Scenario drafts, selected checkpoints and recordings survive the switch. The selected view is remembered per session; existing pane resize/collapse preferences remain available, and Code has its own remembered conversation width. Focus replay can still collapse secondary panes explicitly.

## Verification and screenshots

Routine acceptance uses explicitly labeled scripted or protocol providers, real separate Git repos, actual commands, Chromium recordings, request gates, assertions, patch diffs and exports. No live model calls are needed for this design change.

Screenshots and logs are under `artifacts/graphite/`:

- `initial-1280.png`, `initial-1920.png`, `initial-780.png`, `initial-390.png`
- `active-coding-1280.png`, `active-coding-1920.png`, `coding-1280.png`, `coding-1920.png`
- `coding-adjacent-command-output.png`
- `comparison-agent-1920.png`, `comparison-detail-1920.png`, `comparison-1280.png`, `comparison-780.png`, `comparison-390.png`
- `providers-1280.png`, `providers-1920.png`, `providers-390.png`
- `development-font-and-contrast-proof.json`, `production-font-and-contrast-proof.json`

Font tests block all non-loopback requests and verify five successful local font responses and exact family/weight loads. Core body, secondary, action and status text pairs measured 5.83:1–11.32:1 contrast. Keyboard focus, modal focus restoration, reduced motion, entered text/selection/scroll retention, pointer/keyboard resizing, view persistence and narrow-window overflow are covered by browser checks.

Existing saved session/scenario formats, provider credentials, runner/provider implementations and exports remain in use. The historical `/legacy` archive remains accessible. Layout/view preferences and unsaved drafts are browser-profile local; long timelines and code scroll within their panes. This task does not package Windows binaries or commit/push changes.

## Executed checks

| Check                                                                            | Result                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| Runner suite                                                                     | 55 passed                                    |
| General browser suite                                                            | 15 passed                                    |
| Coding/provider/recovery suite                                                   | 5 passed, 2 opt-in live Gemini tests skipped |
| Final coding and dashboard acceptance, including view/console/layout refinements | 2 passed                                     |
| Production suite, including offline font loading and CSP                         | 5 passed                                     |
| Type checking and lint                                                           | Passed                                       |

The ordinary task edited multiple files in a separate Git repo, ran approved build/tests, handled a changed follow-up requirement, reviewed real patches, applied/tested a clean target and rejected a conflicting target without losing local/staged changes. UI reconnection after runner restart retained completed evidence. Provider/recovery acceptance exercised retained conversation/tools, interrupted/resumed turns, command approvals, sequential generation, model pinning and bounded retry cancellation with controlled responses.

The dashboard scenario was created through the guided editor. Week→Month passed on Baseline, A and B; Month→Week failed the baseline assertion and passed both distinct fixes. Mouse/keyboard response reordering, stale source/scenario/order evidence, separate execution errors, saved editor round trips and standalone regression export were exercised. The exported test failed the buggy baseline and passed the chosen fix.

A final read-only UI check confirmed the start-command field uses IBM Plex Mono at 13px and that an unsaved guided draft survives Code/Replay switching and reload without submitting an execution action. Approval and follow-up controls were checked at both requested desktop sizes. Screenshots were captured and inspected at desktop and narrow widths.

Live-provider requests were not made for this design verification. The runner/provider protocols, package dependencies and credential handling were not changed. The prior uncommitted state was backed up under `artifacts/graphite/before/` before applying the design.
