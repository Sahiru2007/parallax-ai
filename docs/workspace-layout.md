# Workspace window layout

The graphite/citron palette and bundled Barlow, Barlow Condensed, and IBM Plex Mono fonts are preserved. This refinement changes the browser workspace layout; it does not package the desktop app or change runner/provider behavior.

## Replay

At desktop widths (1,000px and above), active sessions fill the viewport. The title, scenario controls, candidate selection, browser capture, timeline, and result toolbar share that fixed height. Activity and inspectors scroll within their panes. The short session title has a keyboard-accessible **Full task** disclosure containing the original instruction.

- At 1,920 × 1,080, the event inspector sits beside the captured browser and timeline. All three timeline tracks remain visible.
- At 1,280 × 720, event details default to a closable drawer. **Details**, **Collapse activity**, and **Focus replay** reclaim space without dropping the selected event. Compact and wide inspector choices are remembered independently.
- Drag the horizontal rule between browser and timeline. Keyboard users can focus **Resize browser and timeline** and use Up/Down (2 percentage points), Shift+Up/Down (5 points), Home (30%), or End (70%). The preferred split persists after reload. Minimum track heights reserve room for response arrows and timestamps, so the actual split is constrained when space is limited.
- Captures scale with their original aspect ratio. **Open full frame** opens the original recording image. **Browser at actual size** retains the existing detailed inspection option.
- Candidate switches retain the aligned checkpoint. Response arrows and dragging still edit the real delivery order; Replay verifies that order. Edited scenarios or orders retain stale-evidence feedback.
- Open **Replay scenario** for the guided/advanced editor. It overlays the evidence area while editing and preserves drafts. App-command approval remains in the agent pane; the temporary setup disclosure closes when approval is resolved, leaving cancellation accessible during execution. Startup failures reopen setup.
- **Compare & export** contains candidate-generation and export actions. The compact result disclosure retains execution errors, captured output, and revision details.
- AI interruption and patch verification remain separate. Recovery opens a bounded, closable panel without covering candidate/replay buttons.

Below 1,000px, the existing stacked, scrolling layout remains available. A compact browser capture can be small; collapse activity or open the full frame for detailed reading.

## Code and settings

The composer and pending approval stay anchored while conversation, commands, and diff panes scroll. Long command output and diff lines scroll inside their own surfaces; paths wrap without widening the document. Existing pane resize/collapse preferences are retained.

Provider settings put key entry, connection testing/status, exact model selection, tool checking, and default-model selection first. Development environment controls, agent limits, and longer credential/tool explanations live in expandable details. Credential storage and project-command environments are unchanged.

## Verification and captures

Evidence is in `artifacts/layout/`, including paired `*-viewport.png` and `*-full.png` captures. Viewport captures use actual Playwright viewport dimensions, not resized full-page images.

- `replay-1920-viewport.png`, `replay-1280-viewport.png`: retained real browser evidence; all replay surfaces fit, with compact details collapsed at 1,280px.
- `replay-1280-details-viewport.png`: compact inspector open.
- `replay-fit-1920-viewport.png`, `replay-fit-1280-viewport.png`: newly executed separate dashboard comparison with the explicitly labeled scripted provider.
- `active-coding-1280-viewport.png`, `active-coding-1920-viewport.png`: real pending project-command approval and anchored composer on a separate test repo.
- `provider-ready-1280-viewport.png`: connected provider protocol double with completed harmless tool check.
- `providers-1280-viewport.png`, `providers-1920-viewport.png`: existing configured Gemini settings, opened without a provider call.
- `initial-1280.png`, `initial-1920.png`: initial workspace viewport captures.

`viewport-proof.json` records in-window geometry, split limits, keyboard response reordering after resizing, scrubbing, aligned candidate switching, full-frame opening, and absence of mutating API calls while inspecting retained evidence. Automated coding acceptance also drags the split, reloads to confirm persistence, and executes the real replay, approvals, stale-evidence, regression-export, and restart/recovery paths using controlled providers. No live model verification was needed for these layout changes.

### Executed checks

- Production build (including TypeScript), standalone type check, lint, formatting, and `git diff --check`: passed.
- Runner suite: **55 passed** (`runner-check.log`).
- Browser suite: **15 passed** (`browser-stable-final.log`), including the pickup investigation, independent export, offline fonts, contrast, keyboard navigation, and narrow windows.
- Production browser suite: **5 passed** (`production-final.log`), including offline font loading and CSP checks.
- All **five controlled coding acceptance scenarios passed across the suite and targeted reruns**: feature/follow-up/apply/restart, dashboard guided replay/comparison/export, Gemini protocol, OpenAI/Ollama protocols, and interruption/recovery. Logs: `coding-final.log` for protocol checks, `replay-recovery-final.log` for the corrected dashboard flow, and `code-recovery-final.log` for the final feature and recovery checks. Earlier layout failures in the first logs were fixed and rerun; two opt-in live Gemini cases were skipped.
- Eight font/license manifest hashes match. Existing palette/typography files and font assets match the pre-task backup.

The controlled dashboard replay failed the buggy baseline only when Month arrived before Week; the opposite order passed. Both distinct fixes passed both orders. The standalone exported regression failed on baseline and passed on the chosen fix. The flow also exercised execution-error feedback, cancellation, candidate/source staleness, legacy JSON scenarios, unsaved guided edits, split persistence, and aligned checkpoints after resizing. Provider calls in routine acceptance used explicit test doubles, not live models.

One recovery-panel bug found during verification was fixed: a previously selected B could hide the single candidate's recovery state in a new session. Recovery now follows the displayed candidate. Scenario setup also stops covering replay/cancellation controls once app approval is resolved.

Local changes remain uncommitted. No Git push, dependency installation, or desktop packaging was performed.
