# Benchmark repair verification — 0.1.0-alpha.2

This local release includes the benchmark repairs and an additional follow-up conversation isolation fix. No new live benchmark tasks were run. The original BugsJS report and evidence remain unchanged.

## Changes

- A and B share the captured baseline and user instructions. Provider context contains only the current candidate's conversation, patch, command results, and replay evidence, plus shared baseline replay evidence. Both candidates remain available in the human review UI, with labeled conversations.
- New assistant messages and checkpoints record their candidate owner. Untagged historical messages remain visible but are excluded from comparison provider history. Historical comparison checkpoints without verified ownership cannot be resumed as provider context; their files, conversation, and receipts remain intact, and a new follow-up can continue from the retained worktrees.
- Windows Git operations enable `core.longpaths` per invocation. No global Git configuration or Windows registry setting is changed.
- Diff generation rejects access errors even when Git returns exit code 1, and rejects empty output when source files changed. Review can rebuild a previously lost export from retained changes without a model call.

## Verification

The expanded controlled test covers initial A/B generation, shared task/baseline, private tool output and conversation, follow-ups, persistence/restart, resume without duplicated tools, cross-worktree path rejection, and retention of both versions for review. Restoring the original A-patch injection in an isolated source copy reproduces the targeted failure. A separate before-fix check reproduced the additional follow-up history leak.

The full runner suite passed **63/63** on repeat. Its first run had one Windows `EPERM` while replacing session JSON during concurrent build I/O; that failure is retained, and the exact OS locking cause was not isolated. The extended final isolation test, production build/typecheck, lint, and formatting checks also passed.

The normally installed app was tested through its WebView2 controls using a labeled loopback Gemini protocol double. No live provider or real key was used. Both candidates were reviewed, restarted, followed up, and exported. Five downloaded patches applied to clean copies of the exact baseline, matched the candidate source trees byte-for-byte, and passed project and independent acceptance checks. A fresh single-implementation session was included.

The controlled repository has an unchanged tracked fixture at 201 characters in the original checkout and 290 characters in app worktrees. Disabling long-path support reproduces both the original checkout failure and the original Git diff access error. The successful exports preserve that fixture.

The initial independent-clone check caught Git's default CRLF conversion. The corrected verifier sets `core.autocrlf=false` only in each disposable clone and verifies baseline bytes before applying a patch. The failed attempt remains available.

## Build and reproduce

```powershell
npm run test:runner
npm run desktop:build

$env:PARALLAX_INSTALLED_EXE = Join-Path $env:LOCALAPPDATA 'Programs\Parallax AI Desktop\parallax-ai.exe'
$env:PARALLAX_REPAIR_EVIDENCE = 'E:\benchmarks\parallax-repair-verification-20261109'
node scripts/verify-benchmark-repairs.mjs
```

Install the newly built NSIS installer before the installed-app check. Each verification run creates its own repository, profile, artifacts, and controlled endpoint; original user sessions and credentials are not test fixtures. The bridge uses launch-scoped loopback CDP9232 and normal UI controls, with read-only session queries for assertions.

Installer: `src-tauri/target/release/bundle/nsis/PARALLAX AI_0.1.0-alpha.2_x64-setup.exe`.

SHA256: `0093ded057c7aebd31301cb92ab52eb57e35231fd4f72a15bae1147e1521216d`.

Detailed report, seven-trace audit, original-evidence hashes, command logs, installed context proof, screenshots, and independently applied patches are under `E:\benchmarks\parallax-repair-verification-20261109`. The original installer remains available separately as `0.1.0-alpha.1`.

This verification used the development Windows PC. Clean-machine installation, live-provider acceptance, additional public bugs, and browser replay execution were outside this step. Approved commands are not an OS sandbox. No Parallax commit or push was performed.
