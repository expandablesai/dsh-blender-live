# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
