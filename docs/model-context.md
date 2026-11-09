# Coding-agent context budgets

Gemini request measurements are collected at the serialized `fetch` boundary. `ProviderRun.requestSizes` contains byte counts, round/message counts, and fixed tool categories only. It does not contain request bodies, headers, source text, signatures, commands, or credentials. Retries are measured separately. The recovery panel shows the last request size.

Repository tools retain normal UI evidence while returning bounded observations to the model:

- `read_file` returns up to 120 lines within a character budget, with the actual delivered range. `read_file_range` retrieves another range. Large source files remain bounded by the existing 5 MB snapshot file limit. `search_file` can locate text inside a long line.
- Searches/file listings return at most 40 entries within the result budget. `search_files_page`, `list_files_page`, and `search_file` expose explicit offsets so truncation does not make later results inaccessible.
- Commands retain a redacted complete log under the session's `check-output` directory. The UI keeps a scrolling excerpt and a **Download complete output** link. `read_check_output` and `search_check_output` retrieve bounded excerpts, restricted to the current candidate's checks. Old sessions whose complete logs were never retained explicitly report that limitation.
- Model command observations contain actual status, exit code, source digest, available test statistics, selected output, and a check ID. Duplicate stdout/stderr copies are not sent. Original failing/skipped checks are not represented as passing.
- `replace_in_file` replaces exactly one matching snippet. Missing/ambiguous text fails. Its expected content hash is checkpointed before the write, allowing an interrupted replacement to be recovered by inspection. `inspect_file_diff` retrieves selected patch ranges.

The Gemini adapter projects its own tool-result bodies before serialization. It retains the latest three observations at the normal budget and compacts older bodies to smaller excerpts. It preserves the original user tasks, instructions, provider-native model parts, function-call IDs and opaque thought signatures. It never merges or drops signed parts or tool call/response pairs. A request still exceeding 512 KB stops with an explicit blocker rather than dropping mandatory context.

Complete tool receipts and current worktree edits remain durable. Candidate-owned history stays isolated. Canonical argument comparison ignores object property order when reusing completed commands/edits in a logical turn. Equivalent unchanged-source inspections produce visible progress feedback referencing prior reads and checks; the agent is encouraged to inspect a focused reproduction, make a justified edit, or identify a blocker. It is not required to invent a patch. Malformed executable/argv combinations fail before command approval and include a corrected argument shape.

Session/checkpoint replacement retries transient Windows sharing errors for a bounded interval without deleting the acknowledged state file. Unrecoverable persistence failures remain errors. Request measurement must persist before a Gemini request proceeds.

Temporary HTTP 503 responses use the existing HTTP 429 recovery budget: at most two automatic retries and 60 seconds of retry waiting/request time per explicit continuation. Retry-After and Google RetryInfo delays are honored within that budget; longer delays stop visibly for an explicit later resume. Retries reuse the same serialized request and logical round. They preserve the selected model, worktree and completed tool receipts. The recovery panel shows the wait and permits cancellation. An explicit resume retains the original round ceiling unless the user selects an additional allowance.

Verification:

```powershell
npm.cmd run test:runner
npx.cmd playwright test --config playwright.coding.config.ts tests/coding/context.spec.ts
npx.cmd playwright test --config playwright.coding.config.ts tests/coding/service-recovery.spec.ts
npm.cmd run build
npm.cmd run lint
```

`runner/context-budget.test.ts` covers native protocol preservation, actual-body byte measurements, source-free diagnostics, pagination, large output, precise edit/test execution and restart/resume. `runner/state-files.test.ts` covers bounded replacement retries. The browser test downloads the complete log and retrieves it again after runner restart.

`runner/service-recovery.test.ts` covers transient/persistent 503 responses, delay guidance, cancellation, identical request retries, completed-effect reuse, restart/resume and A/B isolation. Its browser companion checks visible waiting, keyboard cancellation and resume with a controlled HTTP provider, without live API calls.

The separately retained diagnostic report is `E:\benchmarks\parallax-context-diagnostic-20261109\REPORT.md`. It records the immutable installed alpha.2 comparison, controlled request sizes, and the one subsequent live diagnostic. The installed build and original seed-43 scores are not updated by these workspace changes.

Protocol references: Google's [function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling) and [thought signature guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures).
