# Changelog

Changes are grouped by application version. Prereleases are experimental.

## 0.1.0-alpha.3 — 2026-11-19

- Publish a Windows x64 prerelease from current source, with an installer and SHA-256 checksum.
- Replace the phase-by-phase README with a product guide, real screenshots, architecture, setup, limits, and release information.
- Include candidate conversation/tool/patch isolation and Windows long-path worktree/export repairs verified after the first desktop build.
- Bound model-facing file/search/command observations while retaining complete redacted logs. Add paged/ranged inspection, log tools, and serialized Gemini request-size diagnostics.
- Preserve provider-native context and completed tools across resume; retry transient Windows checkpoint replacement failures within bounds.
- Extend bounded, visible, cancellable recovery to HTTP 503 using the existing temporary-429 mechanism.
- Keep interrupted AI-turn status separate from patch verification, with configurable round allowances and usage.

See [alpha.3 release notes](docs/releases/v0.1.0-alpha.3.md) for checks actually executed for this release.

## 0.1.0-alpha.2 — local verification build

- Verify independent A/B context, follow-ups, and retained comparison visibility.
- Repair Windows long-path Git operations and reject incomplete/failed patch exports.
- Build and exercise an updated local installer with controlled providers. Original installer and benchmark evidence remain separate.

See [the repair-verification record](docs/benchmark-repair-verification.md). This was a local build, not a previously published GitHub release.

## 0.1.0-alpha.1 — local desktop build

- Package the React workspace and TypeScript runner with Tauri 2 and per-user NSIS.
- Bundle Node/npm, MinGit, the no-key demo, Chromium headless shell, FFmpeg, production assets, and offline fonts.
- Add a native folder picker, private runner bridge, per-user data, process ownership, and desktop recovery.
- Include coding, provider settings, guided scenarios, Compare and Replay, patch review/apply, and standalone regression export.

Historical verification and limitations are recorded in [Windows desktop](docs/windows-desktop.md). This was a local build, not a previously published GitHub release.
