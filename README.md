# PARALLAX AI

**One objective. Multiple futures. Your decision.**

PARALLAX is an experimental developer command center built around the **Development Multiverse**: explore alternative approaches, inspect their proposed changes, and compare evidence before choosing a direction.

This is the **Phase 1 foundation**, built with Tauri 2, React, strict TypeScript, Vite, Tailwind CSS 4, XYFlow / React Flow, Motion, Lucide, and Zustand. Dependencies were resolved from stable npm releases; `package-lock.json` records the verified frontend versions.

## Run the frontend

Use Node.js **24 LTS** and npm. From this directory:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://127.0.0.1:1420**. On macOS/Linux, or Windows shells without the PowerShell script restriction, use `npm` instead of `npm.cmd`. The server uses a strict port so Tauri always connects to the intended local app.

## Run the desktop application

Install the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), including:

- Rust stable through [rustup](https://rustup.rs/), with `cargo` on PATH. This scaffold requires Rust 1.90 or newer.
- On Windows: Visual Studio Build Tools with **Desktop development with C++**, the MSVC toolchain, and a Windows SDK; Microsoft Edge WebView2 runtime.
- On macOS/Linux: the corresponding Xcode or system WebKit/build dependencies documented by Tauri.

Then run:

```powershell
npm.cmd run tauri -- dev
```

Tauri starts Vite automatically. Do not start a second Vite server on the same port. To create a native release bundle:

```powershell
npm.cmd run tauri -- build
```

**Current machine limitation:** Node 24 and WebView2 are installed. Rust, Cargo, and the required MSVC/SDK components were not detected. The frontend is built and browser-tested; native compilation and desktop launch could not be verified. `tauri build` currently exits at `cargo metadata` because Cargo is unavailable. No system toolchains were installed or modified.

## Explore the prototype

- **Future Explorer:** pan with a mouse drag or scroll, zoom with a pinch or the canvas controls, and fit the complete graph. Select JWT, server-side sessions, or managed authentication to update the inspector. Nodes can also be focused with Tab and selected with Enter or Space.
- **Future inspector:** cycle alternatives, inspect strategies and dependencies, view proposed files, expand sample test explanations, and record a preferred future.
- **Dashboard:** open the sample project, inspect active-contract counts and local preferences, and use shortcuts to the other screens.
- **Behavioral Contracts:** enable or disable requirements, filter the checklist, edit acceptance conditions, and restore the examples.
- **Mission Control:** select a planned step to inspect its context, verification task, and illustrative result.
- **Development Timeline:** filter hypothetical history, select an event, and open the related screen.
- **Evidence Inspector:** compare sample test outcomes, inspect before/after code excerpts, compare a file against another alternative, and review proposed dependencies.
- **Settings:** toggle the canvas grid, reduced motion, and compact navigation; restore local defaults.
- **Command palette:** press **Ctrl+K** (or **Cmd+K**) to search screens and futures. Enter opens the first result; Tab reaches individual results; Escape dismisses the dialog.
- Collapse the sidebar, future inspector, or bottom activity panel to make room. Small browser windows use an icon rail and an overlay inspector. The native window has a 900 × 640 minimum.

### What “mock” means

The authentication experiment is hand-authored. Its strategies, test results, file paths, line counts, dependencies, and timestamps are examples. The proposed authentication files **are not actual project files**; dependency examples **are not installed**. Code excerpts are deliberately incomplete and must not be used as authentication implementations.

Editing acceptance conditions does **not** execute tests or change fixture results. Marking a future as preferred saves a local annotation and does **not** apply code. The terminal is an explicitly labeled placeholder. There is no LLM connection, autonomous execution, sandbox, real experiment runner, filesystem project connection, or backend yet.

Zustand persists contract edits, selected/preferred futures, and display preferences in browser/WebView local storage under `parallax-phase1`. Browser and desktop profiles have separate storage. Screen navigation and panel-open state reset on reload. Fonts and application assets are bundled locally; the UI does not require an external API.

## Project structure

```text
src/
  components/           Shared controls, identity, command palette
  features/
    dashboard/          Workspace overview and shortcuts
    explorer/           XYFlow graph and contextual future inspector
    contracts/          Editable acceptance-condition checklist
    mission/            Inspectable prototype plan
    timeline/           Filterable hypothetical experiment history
    evidence/           Test, file, and dependency comparison
    settings/           Local display and data controls
  hooks/                Experiment loading lifecycle
  layouts/              Application frame and activity/terminal panel
  mocks/                Explicitly hand-authored experiment fixtures
  services/             ExperimentRepository backend boundary
  stores/               Typed Zustand state and local persistence
  types/                Shared domain interfaces
  index.css             Design tokens, component styling, responsive rules
src-tauri/              Native entry points, icons, CSP, capabilities
tests/e2e/              Browser interaction and responsive checks
tests/production/       Built-asset CSP and window-size regression check
```

The UI consumes the `Experiment` domain model through `ExperimentRepository`. A future backend can replace the repository implementation without moving orchestration into React components. Local contract and preference writes currently belong to the UI store; a future persistence service can implement these separately. Screen modules load on demand.

The Tauri shell exposes **no privileged IPC capabilities** or custom commands. Its CSP permits local assets, local IPC, and inline styles required by the graph/animation libraries; development additionally permits the local Vite websocket. Native OS window controls remain available above the custom application bar.

## Verification and maintenance

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run test:production
npm.cmd run format:check
```

Playwright starts the development server automatically and tests graph selection/keyboard navigation, pan/zoom, preference persistence, editable contracts, fixture honesty, evidence comparison, mission/timeline navigation, command search, panels/settings, all seven screens, and narrow-window behavior. Screenshots are written to the ignored `artifacts/` directory. A failure includes a screenshot and trace; open `playwright-report/index.html` or run `npx.cmd playwright show-report` to inspect it.

`test:production` builds the frontend, serves it on port 1421, and applies the desktop CSP as a response header. It verifies all seven screens at widths of 1440, 900, and 390 pixels, checks panel overflow and runtime/CSP errors, and confirms that system reduced-motion preferences stop the graph animation. Assets are emitted as files so small fonts comply with the strict local-font policy.

Verified in this workspace: strict type checking, lint, formatting, production build, **10 interaction tests**, and **1 production CSP/responsive test** passed. The production check covered 21 screen/width combinations. The production dependency audit reported no known vulnerabilities. Native compilation remains unverified for the toolchain reasons above.

Use `npm.cmd run format` to format source files. `npm.cmd run preview` serves the production frontend build. `npm.cmd run tauri -- info` reports native prerequisites. Native compilation requires the platform toolchain and is separate from the frontend checks above.

## Implementation references

The setup follows the official [Tauri + Vite integration](https://v2.tauri.app/start/frontend/vite/), [Tauri CSP guidance](https://v2.tauri.app/security/csp/), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite), and [React Flow custom-node documentation](https://reactflow.dev/learn/customization/custom-nodes).
