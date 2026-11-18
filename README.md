# dsh-blender-live

**Full Blender access for the DeepSeek Harness — with a video-editor style reference | live viewport in the Web GUI.**

One repo, two installs, nothing else:

| # | Piece | Runs in |
|---|---|---|
| 1 | **Blender connector** (dependency-free add-on, ships here) | Blender 4.2+ |
| 2 | **DSH bundle** (tools + viewer) | DeepSeek Harness |

No separate download, no npm package, no second port, no external service.

📖 **Manuals: [English](docs/INSTALL.md) · [简体中文](docs/INSTALL.zh-CN.md)**

```
┌──────────────────────────────────────────────────────────┐
│ ● BLENDER MONITOR · CYCLES · 741 obj · f 450          ⤢  │
├──────────────────────────┬───────────────────────────────┤
│ REFERENCE      ◀ ▶ ⏺     │ LIVE PROGRAM             ● LIVE│
│  ┌────────────────────┐  │  ┌─────────────────────────┐  │
│  │ the drawing being  │  │  │ the live Blender         │  │
│  │ matched            │  │  │ viewport                 │  │
│  └────────────────────┘  │  └─────────────────────────┘  │
├──────────────────────────┴───────────────────────────────┤
│ ⏸ ⟳ 00:12:34 #07 ━━━━░░ 174 ms          1s 2s 4s 8s     │
└──────────────────────────────────────────────────────────┘
```

---

## What you get

### Agent tools (Host)

| Tool | Purpose |
|---|---|
| `blender_status` | Connection, Blender version, open `.blend`, scene, engine, object/material/collection counts. Never throws when Blender is absent. |
| `blender_run` | Execute Python inside the running Blender on its main thread. Assign a JSON-serialisable dict to `result` to return data. |
| `blender_run_script` | Execute a Python **file** from disk — keeps build scripts editable and re-runnable. |
| `blender_snapshot` | Capture a PNG: `mode: "window"` (whole UI) or `mode: "render"` (active camera). |

### Live viewer (Client)

- **Reference pane** — the image the reference pointer names, with `◀ ▶` to walk its folder and `⏺` to pin the current live frame as the new reference (A/B comparing).
- **Live pane** — the viewport re-rendered on your cadence (`1s / 2s / 4s / 8s`), with pause, single-shot capture, a capture meter, last-capture latency and a running timecode.
- Captures stop on their own when the tab is hidden or capture is paused.

### Blender connector (`blender/dsh_blender_live/`)

The Blender side is part of this repository — a single-file add-on with no dependencies:

- listens on `127.0.0.1`, port `9876` (falls back to `9877–9881` if taken, so it coexists with older add-ons),
- executes code on Blender's main thread from a timer, so `bpy` is always safe,
- **View3D → Sidebar → DSH** tab with Start/Stop and the actual port,
- auto-starts when Blender loads (configurable).

### HTTP routes (same-origin, loopback only)

| Route | Returns |
|---|---|
| `GET /x-blender-live/frame.jpg?w=&h=&q=&force=1` | Latest viewport render (JPEG). `w`/`h` clamped to 240–2048, `q` to 30–95. `force=1` bypasses the cache. |
| `GET /x-blender-live/status` | JSON: blend file, engine, object count, scene frame, last capture ms, reference pointer state. |
| `GET /x-blender-live/reference` | The reference image bytes. |
| `POST /x-blender-live/reference/step?dir=±1` | Move the reference pointer to the neighbouring image in its folder. |
| `POST /x-blender-live/reference/pin` | Copy the current live frame into the reference slot. |

---

## Quick install

Full detail, including the Chinese manual and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)** · **[docs/INSTALL.zh-CN.md](docs/INSTALL.zh-CN.md)**

1. **Blender** — zip `blender/dsh_blender_live/` (root contains `blender_manifest.toml`) and **Preferences → Get Extensions → Install from Disk**, then tick *DSH Blender Live Connector* in **Preferences → Add-ons**. Check the `N` sidebar → **DSH** tab says *Listening on 127.0.0.1:9876*.
2. **DSH** — keep the clone somewhere permanent, then tell the agent:

   > install the bundle at `D:\path\to\repo`

3. **Restart the Harness** (Host code and the Web bundle are only re-read on restart).
4. **Verify** — `GET http://127.0.0.1:3080/x-blender-live/status` returns JSON, and a two-pane strip appears directly above the message box.

## Pointing at a reference image

The Host reads one small pointer file:

```
%TEMP%\dsh-blender-live\reference.json
```

```json
{ "path": "D:\\project\\refs\\nose_cutaway_side.png", "label": "nose cutaway - side - 8 m" }
```

PNG, JPEG, WebP, GIF, BMP and TIFF are accepted. `◀ ▶` walk the images in the same folder, so a `refs/` directory becomes a browsable reference bin. An unreadable pointer degrades to **NO REFERENCE** instead of breaking the viewer.

## Matching the viewport to a reference

> "match the viewport to ref09's angle"

which becomes, inside Blender:

```python
r3d = area.spaces.active.region_3d
r3d.view_perspective = 'ORTHO'
bpy.ops.view3d.view_axis(type='FRONT')   # nose at -X → +X right, nose left
r3d.view_location = (4.6, 0.0, 2.3)
r3d.view_distance = 8.0
```

---

## Cost, cache and safety

- A frame is a real `bpy.ops.render.opengl(view_context=True)` on Blender's **main thread** — roughly 150–400 ms on a 700+ object scene.
- Concurrent requests share one capture, and a frame younger than **400 ms** is served from disk (measured: 349 ms render → 19 ms cached).
- Every render setting a capture touches is restored in a `finally`, so a failed capture cannot leave your scene reconfigured.
- Frames live under `%TEMP%\dsh-blender-live\` — nothing in your project directory.
- Routes are **loopback only** (non-loopback gets `403`); the two `POST`s only move a pointer inside that temp folder.
- The connector runs Python with **no authentication**. Anyone who can reach port 9876 can run code in your Blender — keep it on loopback.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BLENDER_LIVE_PORT` | `9876` | Port the Host dials. Set it if the connector fell back to another port. |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `NO SIGNAL` | Blender closed, or connector stopped. Blender → `N` sidebar → **DSH** → **Start**. |
| `NO REFERENCE` | Pointer file missing, pointing at a missing file, or an unsupported image type. |
| Route returns 404 | Harness not restarted after install/upgrade. |
| Viewer missing entirely | Stale Client bundle, or the clone was moved: re-install and restart the Harness. |
| Connector always lands on 9877 | 9876 already owned (e.g. the older `blender_mcp` add-on). Keep the old one, or export `DSH_BLENDER_LIVE_PORT=9877`. |
| Capture timeout after 30 s | Blender busy (long render) or blocked by a modal dialog. |

## Known limitations

- **Panel view is experimental.** A full-size `main`-panel variant is registered under the `blender-live` key and a "Blender monitor" row appears in the sidebar, but whether the shell switches to it via `layout.selectPanel()` depends on the DSH build. The compact in-composer viewer is the supported surface.
- Client code changes require a **Harness restart** in profiles that `link:` the bundle.
- One viewport render per frame means very heavy scenes feel the 1 s cadence; use 4 s/8 s.

## Project layout

```
index.js                          Host half: socket bridge, four tools, HTTP routes
client.js                         Client half: reference | live viewer
cordis.patch.yml                  Bundle patch that inserts the loader row
locale/en.json, locale/zh.json    Display metadata
icon.svg                          Plugin icon
blender/dsh_blender_live/         The Blender connector (add-on + manifest)
docs/INSTALL.md                   Install & setup manual (English)
docs/INSTALL.zh-CN.md             Install & setup manual (简体中文)
docs/ARCHITECTURE.md              How the pieces fit together
docs/DECISIONS.md                 Locked design decisions and why
PUBLISH.md                        How to publish this repository
```

## License

MIT — see [LICENSE](LICENSE).
