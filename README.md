# dsh-blender-live

**Full Blender access for the DeepSeek Harness — plus a video-editor style reference | live viewport in the Web GUI.**

One bundle, two halves:

- **Host** — talks to a running Blender over the `blender_mcp` add-on's localhost socket, registers four agent tools, and serves two same-origin HTTP routes for images.
- **Client** — renders the viewer in the Web GUI: the **reference drawing on the left**, the **live Blender viewport on the right**, exactly like a reference/program monitor pair in an NLE.

No Blender add-on of its own, no extra port, no browser extension, no external services.

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

- **Reference pane** — shows whatever image the reference pointer names, with `◀ ▶` to step through the images in that folder and `⏺` to pin the current live frame as the new reference (A/B comparing).
- **Live pane** — the viewport re-rendered on a cadence you choose (`1s / 2s / 4s / 8s`), with pause, single-shot capture, a capture meter, last-capture latency, and a running timecode.
- Captures stop automatically when the tab is hidden or capture is paused — Blender's main thread is never rendered on behind your back.

### HTTP routes (same-origin, loopback only)

| Route | Returns |
|---|---|
| `GET /x-blender-live/frame.jpg?w=&h=&q=&force=1` | Latest viewport render (JPEG). `w`/`h` clamped to 240–2048, `q` to 30–95. `force=1` bypasses the cache. |
| `GET /x-blender-live/status` | JSON: blend file, engine, object count, scene frame, last capture ms, reference pointer state. |
| `GET /x-blender-live/reference` | The reference image bytes. |
| `POST /x-blender-live/reference/step?dir=±1` | Move the reference pointer to the neighbouring image in its folder. |
| `POST /x-blender-live/reference/pin` | Copy the current live frame into the reference slot. |

---

## Requirements

- **Blender 4.x/5.x** with the `blender_mcp` add-on enabled and its server started (default `127.0.0.1:9876`). The bridge does **not** launch Blender.
- **DeepSeek Harness** with a Web profile (developed and verified against `0.2.1-rc.2`).

## Install

The bundle is a DSH package: `package.json` declares `dsh.bundle.patch`, and the patch inserts one Loader row.

1. Clone this repository anywhere on the machine that runs both Blender and DSH.
2. Ask DSH to install it as a bundle from that directory:

   > "install the bundle at `<absolute path to this repo>`"

   which runs `plugin_manager` → `install_bundle` with the directory as the target. It links the directory into your profile, so later edits take effect after a Harness restart.
3. **Restart the Harness** — Host modules and the Client bundle are only re-read on restart.

Verify: `GET http://127.0.0.1:3080/x-blender-live/status` returns JSON, and the rail/sidebar shows the monitor entry.

## Uninstall

`plugin_manager` → `remove_bundle` with the package name, then restart.

---

## Pointing the reference pane at an image

The Host reads one small pointer file:

```
%TEMP%\dsh-blender-live\reference.json
```

```json
{ "path": "D:\\project\\refs\\nose_cutaway_side.png", "label": "nose cutaway - side - 8 m" }
```

PNG, JPEG, WebP, GIF, BMP and TIFF are accepted. Delete the file (or point it at a missing path) and the pane shows **NO REFERENCE** — it never breaks the card.

`◀ ▶` walk the images in the same folder sorted by filename, so a `refs/` folder becomes a browsable reference bin.

## Matching the viewport to a reference

The bridge does not guess; ask for it. A typical agent exchange:

> "match the viewport to ref09's angle"

which becomes, inside Blender:

```python
r3d = area.spaces.active.region_3d
r3d.view_perspective = 'ORTHO'
# nose along -X? then FRONT puts +X right and the nose left, like the drawing
bpy.ops.view3d.view_axis(type='FRONT')
r3d.view_location = (4.6, 0.0, 2.3)
r3d.view_distance = 8.0
```

---

## Cost, cache and safety

- A frame is a real `bpy.ops.render.opengl(view_context=True)` on Blender's **main thread** — roughly 150–400 ms on a 700+ object scene.
- Concurrent requests share one capture, and a frame younger than **400 ms** is served from disk (measured: 349 ms render → 19 ms cached).
- Every render setting the capture touches (`filepath`, format, colour mode, quality, resolution, borders, overwrite) is restored in a `finally`, so a failed capture cannot leave your scene reconfigured.
- Frames are written under `%TEMP%\dsh-blender-live\` — nothing in your project directory.
- Routes are **loopback only** (non-loopback requests get `403`) and read-only by default; the two `POST`s only move a pointer inside that temp folder.
- The add-on's own socket has no authentication: anyone who can reach port 9876 can run Python in your Blender. Keep Blender's server bound to localhost.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BLENDER_LIVE_PORT` | `9876` | Port of the `blender_mcp` add-on socket. |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `NO SIGNAL` in the live pane | Blender not running, or its MCP server not started. Start it in the View3D sidebar → Blender MCP → Start. |
| `NO REFERENCE` | `reference.json` missing, pointing at a missing file, or an unsupported image type. |
| Route returns 404 | The Harness was not restarted after install/upgrade. |
| Viewer missing entirely | Stale Client bundle: restart the Harness (a page reload alone is not enough). |
| Capture timeout after 30 s | Blender is busy (a long render) or blocked by a modal dialog. |

## Known limitations

- **Panel view is experimental.** A full-size `main`-panel variant is registered under the `blender-live` key and a "Blender monitor" row appears in the sidebar, but whether the shell switches to it via `layout.selectPanel()` depends on the DSH build; the compact in-composer viewer is the supported surface. Do not rely on the panel yet.
- Client code changes require a **Harness restart** to reach the browser in profiles where the bundle is `link:`ed.
- One viewport render per frame means very heavy scenes have a visible cost at the 1 s cadence.

## Project layout

```
index.js            Host half: socket bridge, four tools, HTTP routes
client.js           Client half: reference | live viewer
cordis.patch.yml    Bundle patch that inserts the loader row
locale/en.json      Display metadata (title/description)
locale/zh.json      Display metadata (Chinese)
icon.svg            Plugin icon
docs/ARCHITECTURE.md  How the pieces fit together
docs/DECISIONS.md     Locked design decisions and why
```

## License

MIT — see [LICENSE](LICENSE).
