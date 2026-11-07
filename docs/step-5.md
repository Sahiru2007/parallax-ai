# Recovering interrupted coding work

Run `npm.cmd run dev` and open http://127.0.0.1:1420. Reopen work through **Saved coding sessions**. Select the candidate in **File changes, project checks, and apply**, or select its replay version.

The candidate panel reports **AI turn** and **Patch verification** independently. An interrupted AI turn can have a passing replay. Checks remain attached to their source digest; changing source, scenario, or response order makes affected evidence stale. Conversation, command output, approvals, patches, and completed browser evidence remain available after cancellation or runner restart.

## Resume and limits

Choose **Resume AI turn** to continue the latest interrupted instruction in its existing worktree. The runner pins its original provider, exact selected model ID, and conversation. Changing the default model does not change this turn. Completed tool results are returned from the durable receipt journal rather than executing the operation again. Model-native messages, function call IDs, and Gemini thought signatures are retained privately by the runner. Credentials are never stored in those checkpoints or returned to the renderer.

The UI displays cumulative rounds, requests, continuations, automatic retries, waiting time, and API-reported token usage. Reaching the configured round allowance requires an explicit **Continue AI with N more rounds** action. Each additional allowance accepts 1 to 24 rounds. An unsuccessful HTTP request can consume a round even when no tokens are reported; requests include HTTP retry attempts. These are execution bounds, not a cost ceiling.

Legacy sessions created before durable checkpoints display a warning: their exact historical provider context cannot be reconstructed. Resume inspects the retained patch and known completed checks. It cannot guarantee reconstruction of unrecorded historical operations. If an acknowledged new checkpoint is missing or corrupt, exact resume is blocked instead of silently starting fresh.

## Interrupted operations and approvals

Tool intent is persisted before execution, and results before the next model request. A cancelled approval is not reused: resume requests fresh approval with the command and directory visible. File writes interrupted between mutation and receipt are inspected against their intended contents. Known completed command receipts are reused only at the recorded source digest when the model asks for the same command again.

An interrupted command without a durable exit result is **uncertain**, even if output looks successful. Resume inspects the patch, recorded check/output, and recorded process ID. Review **Retained tool receipts and approvals**. **Acknowledge inspection and skip** preserves an explicitly unverified result. **Request a fresh approved rerun** requires inspection, an ended recorded process, and a new command approval. It never silently reruns a command whose outcome is unknown.

This does not provide transactional rollback or exactly-once external side effects for arbitrary project commands. A killed runner can leave a child process running; verify it has ended before rerunning. A recorded PID is an observation, not a general process-ownership guarantee. The original checkout remains outside agent tool writes; applying a patch still uses the existing explicit review/apply flow.

## Rate limits

For HTTP 429 before a successful model response, the shared runner honors `Retry-After` and Gemini `google.rpc.RetryInfo`. Explicit minute/second limits can trigger exponential backoff with jitter. There are at most **two automatic retries and 60 seconds of retry waiting per allowance**, including retry request time. A longer provider delay stays visible and requires an explicit later resume; the runner does not send a request early. **Cancel turn** stops retry waiting. Resume enforces a retained provider delay even after restart.

Explicit exhausted credits/account quotas, daily/monthly limits, and zero quota allocations stop without automatic retry. A 429 without enough structured information is labelled ambiguous and stays visible for user action. Partial or failed response streams are not automatically replayed. No recovery switches providers. See [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Google retry guidance](https://cloud.google.com/storage/docs/retry-strategy), and [OpenAI rate-limit guidance](https://platform.openai.com/docs/guides/rate-limits).

## Generate A, then B

In **Compare approaches**, enable **Generate A, then B manually**. For a saved browser investigation, use **Generate Candidate A first**. After reviewing A, select **Generate Candidate B from same baseline**. Both worktrees retain the comparison baseline. B's interruption does not discard A or its evidence. A newer follow-up supersedes older queued generation, preventing an obsolete B task from running later.

## Repeatable verification

```powershell
node --test runner/recovery.test.ts
npx.cmd playwright test --config playwright.coding.config.ts tests/coding/recovery.spec.ts
npm.cmd run test:runner
npm.cmd test
npm.cmd run test:coding
npm.cmd run test:production
npm.cmd run typecheck
npm.cmd run lint
```

Recovery tests use explicitly controlled provider responses. They exercise actual worktrees, file changes, approved Node commands, browser requests, replay assertions, cancellation, and runner restart. They do not require live API quota. The browser test leaves screenshots and evidence under ignored `artifacts/step5-browser`, with its latest location in `artifacts/step5-browser-latest.json`. Live Gemini continuation evidence is reported separately in `artifacts/step5-report.md`; routine tests never opt into live requests.
