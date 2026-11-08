# Windows desktop release

PARALLAX AI uses one packaging path: **Tauri 2 with a per-user NSIS installer**. This keeps the existing React frontend and TypeScript runner, uses the standard Tauri installer/update layout, and avoids a second packaging system. The choice follows the official [Windows installer](https://v2.tauri.app/distribute/windows-installer/) and [resource bundling](https://v2.tauri.app/develop/resources/) guidance.

## Build

On an x64 Windows development PC:

```powershell
npm ci
npx playwright install chromium --only-shell
npm run desktop:build
```

The build runs the frontend production build, stages the desktop resources, compiles the native shell, and creates:

```text
E:\projects\parallax-ai\src-tauri\target\release\bundle\nsis\PARALLAX AI_0.1.0-alpha.1_x64-setup.exe
```

Build prerequisites are Node/npm, Rust with the MSVC target, Microsoft C++ Build Tools, and a Windows SDK. This machine already had Node **24.22.1**, Rust/Cargo **1.99.1**, Visual Studio 2022 MSVC **14.41.34120**, Windows SDK **10.0.22621.0**, and WebView2. No compiler/toolchain reinstall was needed. Allow several GB for the build resources and Rust caches. First preparation downloads Node/MinGit and Tauri downloads its installer tooling; later builds reuse the caches.

`scripts/prepare-desktop.mjs` assembles ignored resources under `src-tauri/resources/desktop`. It uses the installed lockfile dependencies, checksum-verifies the official Node distribution and pinned MinGit release, and copies the matching Playwright headless Chromium and FFmpeg. The generated `runtime-manifest.json` records versions, sources, and hashes. Runtime licenses accompany the distributions. The installer also embeds Microsoft's offline WebView2 installer for machines without that runtime.

## Installed behavior

- The Start menu entry is **PARALLAX AI**. The normal installer offers a desktop shortcut on its finish page. Both use the Parallax icon generated from the approved SVG.
- The release opens a native Tauri/WebView2 window at the stable `parallax` application origin. Bundled production assets are served through a native protocol bridge. It never loads the PARALLAX development server.
- The native process starts its bundled Node runner on an OS-assigned loopback port and authenticates the private bridge with a fresh secret. An occupied port 1420 does not affect startup. Direct unauthenticated access to that private runner returns 403.
- There is no global Node/npm/Git prerequisite for the installed demo or tested Node projects: those runtimes are included. Other project languages and project-specific dependencies still require their own tools/install steps. Ollama remains an external loopback service.
- **Browse folders…** opens the real Windows repository folder picker. Git validation still happens through the existing runner.
- Normal desktop data lives under `%LOCALAPPDATA%\dev.parallax-ai.desktop`: `sessions` contains coding conversations, worktrees, approvals, journals, checks and replay evidence; `demo-repository` contains the isolated demo checkout and its investigations; `webview` stores UI preferences; `logs` contains runner/startup logs. Moving the installation repairs only the app-owned demo dependency junction and preserves real directories.
- Gemini, OpenAI, Ollama, model selection, tool approvals and continuation use the existing provider implementation. Keys remain in Windows Credential Manager (`PARALLAX AI/Gemini` and `PARALLAX AI/OpenAI`), with environment-variable support retained for development. Keys and the native bootstrap secret are excluded from project-command environments.
- Native activity updates poll the retained runner state every 350 ms during a session; the browser app retains its SSE transport. The application origin and WebView data location stay stable when the private port changes.
- Full-frame inspection opens a dedicated native window restricted to recorded PNG endpoints. General popup navigation is denied; privileged commands check the main window and its exact origin.
- Windows Job Object ownership covers this instance and its descendants. Normal exit checkpoints/cancels work before shutdown; an unexpected termination also stops owned commands and browsers. Relaunch restores completed evidence and marks interrupted work correctly. If the runner stops unexpectedly, close and reopen the app; there is no automatic runner-restart loop.

Development browser data remains in its existing location and is not automatically migrated into the separate desktop profile. Existing Windows Credential Manager keys are reused. This avoids simultaneous development and installed runners writing the same sessions.

## Verification

Tests used **this development PC: Windows 11 Pro, x64, build 26300**. This was **not a clean Windows VM**. VS Code stayed open at the user's request because it hosts the Codex session. PARALLAX's Vite development server and development runner were stopped; installed acceptance also deliberately occupied port 1420 and launched with a system-only PATH before the native app prepended its bundled tools. Replay target servers were started by the installed runner itself.

The local index `artifacts/desktop/release-evidence.json` identifies the exact final installer, installation path, proof files, logs, and screenshots. Verification scripts attach to the installed WebView2 rather than opening a replacement Chromium UI. Remote debugging flags are scoped to verification launches; they are not enabled by the installer or normal application.

Executed checks include the production build/type check, lint, formatting, **59 runner tests**, **five controlled coding scenarios** (two opt-in live cases skipped in that suite), **15 browser tests**, **five production tests**, **two Rust origin/frame tests**, and the existing **native seven-screen interaction test**. Controlled providers exercise real files, approvals, commands, worktrees, browsers, diffs and exports; their results are labeled separately from live inference.

Installed acceptance exercised a fresh multi-file Node feature, an approved test, follow-up edits/checks, patch review, cancellation, completed-session restoration, and forced termination during an active command. The no-key pickup demo ran both response orders. The main workspace also configured a separate dashboard scenario, reproduced the baseline bug, reordered responses, generated two distinct scripted fixes, replayed all versions, opened a native full-frame image, and downloaded the standalone regression. In both examples the baseline failed only when the older response arrived last; both fixes passed both orders.

A live task used the selected alias **`models/gemini-flash-lite-latest`**, resolved by the API to **`gemini-3.5-flash-lite`**. It inspected instructions/files, changed `greet.mjs` and `greeting.test.mjs`, inspected its diff, and passed the approved `node --test greeting.test.mjs`. The first four rounds stopped at the configured limit; an explicit six-round allowance resumed the same session. It completed in **nine rounds total**, within the ten-round bound. No additional live feature task was needed. The older listed `models/gemini-2.5-flash-lite` failed its readiness probe with HTTP 404; the working configured alias was selected explicitly.

Startup-failure verification temporarily renamed only the installed test runtime, observed the native actionable error dialog and startup log, and restored the runtime with its original hash. Installation paths containing spaces were tested, including reinstalling into another folder and reopening retained comparison evidence before running the no-key demo again.

## Uninstall and limits

Default/silent uninstall removes the program and its shortcuts while **retaining saved data and credentials**. Verification compared 640 saved files byte-for-byte across uninstall and confirmed retention of both isolated test credentials. The uninstaller's optional **Delete app data** checkbox removes the application's AppData directories; that destructive option was inspected rather than executed because existing user data was present. It does not delete Windows Credential Manager entries. Remove real keys through Manage providers before uninstalling if desired. Cleanup removes only credentials created in this verification's `PARALLAX AI/Test/<uuid>` namespaces; real provider keys and existing development data are preserved.

The installer is **unsigned**; no signing certificate was configured. SmartScreen/reputation on a downloaded installer, first-time offline WebView2 provisioning, and execution on a clean Windows environment remain unverified. VS Code-fully-closed execution was not directly exercised; the separate Start-menu launch, installed resource paths, private port, and bundled-tool tests verify independence from the development servers and checkout. Browser development remains available with `npm run dev`.

Generated installers, bundled runtimes, and verification artifacts remain local and are excluded from Git.
