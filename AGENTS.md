# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Project snapshot

Audio Editor is a static, local-first browser application. There is no backend, compilation step, package installation step, or checked-in CI workflow. GitHub Pages serves the repository files directly.

The app uses plain HTML, CSS, and JavaScript. Runtime audio processing stays in the browser. Node is used only for the built-in test runner and syntax checks.

## Repository map

- `index.html`: application markup, third-party script tags, and runtime load order.
- `styles.css`: all application styling and responsive rules.
- `script.js`: DOM coordination, editor state, waveform UI, presets, and user operations.
- `audio-editor-core.js`: browser-independent editing, selection, history, filename, preset, and validation logic.
- `audio-engine.js`: the shared real-time Tone.js/Web Audio processing graph and audio-session startup.
- `export-engine.js`: offline rendering and WAV/MP3/FLAC/M4A encoding.
- `tests/`: Node tests for core logic, export helpers, DOM references, and static dependency order.
- `vendor/mediabunny-1.53.0/`: pinned third-party generated/minified files plus their MPL-2.0 license.
- `pitch-shifter-processor.js` and `pitch-worklet.js`: legacy worklet files; verify current references before changing or removing them.
- Image and favicon files: static site assets.

## Setup and run

No dependency installation is required. The repository does not contain a lockfile, and `package.json` declares scripts but no npm dependencies.

Requirements:

- Node.js with support for `node --test`. The repository does not pin a Node version.
- Python 3 only if using the documented local static server.

From the repository root:

    npm test
    npm run check
    python3 -m http.server 4173

Then open `http://localhost:4173/`.

Do not open `index.html` only through a `file://` URL when validating changes; use an HTTP server so browser loading behavior matches GitHub Pages more closely.

## Available verification

- `npm test`: runs `node --test tests/*.test.js`.
- `npm run check`: runs syntax checks for `script.js`, `audio-editor-core.js`, `audio-engine.js`, and `export-engine.js`.
- Browser smoke test: load an audio file, exercise the affected controls, confirm playback, and export at least one affected format.

There are currently no repository commands for build, lint, formatting, type checking, or end-to-end browser tests. Do not invent substitutes or report those checks as passing. There is also no checked-in GitHub Actions workflow; GitHub Pages configuration is external repository state.

## Architecture and invariants

- Keep `originalBuffer` immutable. Destructive edits replace `workingBuffer`; effects remain non-destructive.
- Preserve the processing order documented in `README.md`.
- Keep monitor volume out of exported audio. Processing Gain is included in exports.
- Keep real-time playback and offline export on the shared processing graph. A new effect is incomplete until both paths behave consistently.
- Preserve the single shared audio-context/session startup path, especially for iOS user-gesture requirements.
- Keep pure, browser-independent behavior in `audio-editor-core.js` so it remains testable under Node.
- Preserve the static dependency order in `index.html`: codec libraries, core module, audio engine, export engine, then `script.js`.
- Keep DOM `id` values unique and synchronized with `$()` references in `script.js`.
- Keep user-facing interface copy in English unless a task explicitly introduces localization.
- Preserve local-only processing: do not add uploads, telemetry, or backend calls without explicit product direction.
- Maintain pointer, touch, keyboard, and narrow-screen behavior for UI changes.

## Dependencies and generated files

- Do not hand-edit minified files under `vendor/mediabunny-1.53.0/`.
- Do not remove or alter `vendor/mediabunny-1.53.0/LICENSE`.
- Keep vendored Mediabunny files on the documented `1.53.0` version unless a dependency-upgrade task explicitly changes the version, files, license notes, and `index.html` references together.
- Treat favicon/PNG assets as generated binary assets; replace them only when the task explicitly requires it.
- External runtime libraries in `index.html` are version-pinned. Preserve their versions and integrity/cross-origin attributes unless deliberately upgrading them.
- Preserve the existing cache-busting query-string pattern on local CSS and JavaScript references; update the relevant value when a served asset change must invalidate browser caches.

## Code and test conventions

- Follow the existing plain JavaScript style: strict mode where present, two-space indentation, semicolons, single quotes in JavaScript, and descriptive camelCase names.
- Keep the UMD-style browser/CommonJS exports in core and engine modules so browser use and Node tests both continue to work.
- Prefer small pure helpers for buffer calculations and validation.
- Never mutate an input audio buffer unless the function contract explicitly requires it.
- Add or update tests in `tests/core.test.js`, `tests/export.test.js`, or `tests/static-integration.test.js` for changed behavior.
- For markup changes, verify accessible names, keyboard operation, status announcements, unique IDs, and the script-to-DOM reference test.

## Working rules for Codex

1. Inspect the relevant source, tests, and documentation before editing.
2. Keep changes scoped; do not change application behavior during documentation-only tasks.
3. Do not invent commands, supported formats, browser guarantees, or deployment conventions.
4. Avoid unrelated cleanup, especially in vendored, binary, or legacy worklet files.
5. Run the narrowest relevant checks while iterating, then run all available automated checks before finishing.
6. If browser or platform-specific behavior changed, perform and report a manual browser smoke test when a browser is available.
7. If a check cannot run, state the exact blocker and leave it unresolved rather than implying success.

## Done when

For every task:

- The requested behavior or documentation is complete and scoped.
- `npm test` and `npm run check` pass, or any blocker is reported explicitly.
- Relevant tests cover behavior changes.
- Documentation matches actual commands, architecture, and supported behavior.
- No vendored/minified or binary files changed unintentionally.
- The final handoff lists files changed, verification performed and results, blockers or unverified areas, and recommended follow-up.

Additional criteria by change type:

- Audio/effect changes: playback and offline export remain consistent; monitor-only controls stay out of exports.
- Editing changes: `originalBuffer` remains unchanged; undo/redo and selection behavior are verified.
- UI changes: desktop and narrow mobile layouts, keyboard interaction, and accessible status/labels are checked.
- Dependency changes: pins, load order, licenses, vendored files, documentation, and affected export/import flows are updated together.
- Documentation-only changes: commands are traced to repository scripts/configuration and links resolve.

## Known gaps

- No Node version is pinned.
- No lint, formatter, type-check, build, or end-to-end test command is configured.
- No GitHub Actions workflow is checked in.
- GitHub Pages publishing settings are not documented in the repository.
- Automated tests do not exercise real browser audio playback, mobile Safari audio-session behavior, or full codec export flows.
