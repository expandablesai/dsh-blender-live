# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-11-18

### Added
- **The Blender side now ships with this repository** (`blender/dsh_blender_live/`): a
  dependency-free add-on with `blender_manifest.toml`, so a clean machine needs nothing
  beyond Blender + DSH. No `blender_mcp` add-on required any more.
- Connector listens on `127.0.0.1:9876` and **falls back to 9877–9881** when the port is
  taken, so it coexists with older add-ons instead of fighting them.
- **View3D → Sidebar → DSH** panel with Start/Stop and the bound port; auto-start on load;
  preferences for port and auto-start.
- Install & setup manuals: `docs/INSTALL.md` (English) and `docs/INSTALL.zh-CN.md` (简体中文).
- CI also compiles the connector (`python -m py_compile`).

### Verified
- Connector protocol, end to end, inside a live Blender 5.3 session — 11 checks:
  execute round trip, stdout capture, Python traceback reporting, unknown-type rejection,
  missing `strict_json` rejection, non-dict `result` rejection, viewport capture (36 322 B
  JPEG written to disk), render settings restored (`PNG 1600x900`), and five sequential
  requests in 272 ms.
- Port fallback confirmed: with the older add-on holding 9876, the connector bound 9877.

## [1.2.0] — 2026-11-18

### Added
- Live viewer in the Web GUI: **reference drawing (left) | live Blender viewport (right)**.
- Reference pane controls: `◀ ▶` step through the images in the reference's folder, `⏺` pins the current frame as the reference.
- Host routes: `GET /frame.jpg`, `GET /status`, `GET /reference`, `POST /reference/step`, `POST /reference/pin`.
- Reference pointer file (`%TEMP%\dsh-blender-live\reference.json`) so the agent can re-point the pane with a plain file write.
- Capture cadence control (`1s/2s/4s/8s`), pause, single-shot capture, capture meter and latency readout.
- `main`-panel variant registered under the `blender-live` key (experimental — see README's known limitations).
- Size clamping (`240–2048`), quality clamping (`30–95`), `force=1` cache bypass, loopback-only guard.

### Changed
- Viewport frames render at 16:9 and are laid out side by side; capture settings are restored in a `finally`.
- Reference and live panes share one transport bar.

### Verified
- Render 349 ms → cached 19 ms; `force=1` re-renders (223 ms).
- `/reference` is byte-identical to the source image (SHA-256 match).
- Six consecutive captures leave Blender untouched (`is_dirty: False`, render settings identical).

## [1.1.0] — 2026-11-18

### Added
- `blender_snapshot` tool (`window` and `render` modes).

## [1.0.0] — 2026-11-18

### Added
- Initial bridge: `blender_status`, `blender_run`, `blender_run_script`.
- `blender_mcp` socket transport with `strict_json` replies and redraw nudge.
