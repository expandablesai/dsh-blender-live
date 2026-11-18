# Architecture

Two halves in one DSH bundle. The Host owns Blender and the file system; the Client owns pixels and cadence.

```
┌──────────────── DSH Harness process ────────────────┐        ┌─────────┐
│  index.js (Host)                                    │        │ Blender │
│    ctx.tools.register ×4  ───────────────────────┐   │        │ 5.x     │
│    webServer.register('/x-blender-live')          │   │  TCP   │         │
│      GET  /frame.jpg ── captureViewport ──────────┼───┼───────>│ timer  │
│      GET  /status                                 │   │ 9876   │ polls   │
│      GET  /reference                              │   │ JSON+  │ socket  │
│      POST /reference/step|pin                     │   │ NUL    │         │
│         │                                         │   │        │         │
│         │  writes JPEG                        │   │        │         │
│         ▼                                         │   │        └─────────┘
│   %TEMP%\dsh-blender-live\frame.jpg ──────────────┘   │
│   %TEMP%\dsh-blender-live\reference.json (pointer)    │
└──────────────────────────────────────────────────────┘
                 ▲ same-origin <img src> + fetch (cookie-authed)
                 │
┌────────────────┴──────────────────────────────────────┐
│  client.js (Client)                                   │
│    conversation.input.dock → <Viewer/>                │
│      reference pane  ← GET /reference                 │
│      live pane       ← GET /frame.jpg (cadence)       │
│      transport       → POST /reference/step|pin      │
└───────────────────────────────────────────────────────┘
```

## Wire protocol to Blender

The `blender_mcp` add-on accepts NUL-terminated JSON on a TCP socket:

```json
{"type": "execute", "code": "result = {...}", "strict_json": true}
```

and replies with one NUL-terminated JSON object:

```json
{"status": "ok", "result": {...}, "stdout": "...", "stderr": "..."}
```

The add-on executes on Blender's main thread from a timer, so a busy Blender delays the reply — hence a 30 s timeout rather than a short one. `strict_json` is required by the add-on; omitting it yields an explicit "the tool that generated this code is broken" error.

Interpolated values are always emitted with `JSON.stringify`, which is also a valid Python literal — so a Windows path can never be re-parsed as an escape sequence, and there is no string-concatenation injection.

## Frame capture

```python
r.set(...)                     # save: filepath, format, colour mode, quality,
                               #       resolution, borders, overwrite
settings.file_format = "JPEG"
with bpy.context.temp_override(window=..., area=..., region=...):
    bpy.ops.render.opengl(view_context=True, write_still=True)
finally:
    r.set(...)                 # restore every saved value
```

`view_context=True` renders the 3D viewport as the user sees it (shading mode, materials) without UI overlays, at the scene resolution requested by the caller. The `finally` block is load-bearing: it is what makes "six captures leave the scene untouched" true.

## Cache and concurrency

- **Single flight** — concurrent requests await one in-progress capture instead of queueing renders.
- **400 ms fresh window** — a just-written frame is streamed from disk, turning a 349 ms render into ~19 ms.
- **`force=1`** — bypasses the window for a deliberate single-shot.

## Same-origin images

Routes are registered on the Harness's existing HTTP server (`ctx.webServer.register` with a `prefix` route), so the browser's session cookie applies and no CORS, second port or token plumbing is needed. Only additive paths under `/x-blender-live` are claimed.

## The reference pointer

The Host never stores UI state. The reference is one JSON file in the temp directory:

```json
{ "path": "…\\ref09_nose_cutaway_side.png", "label": "nose cutaway - side - 8 m" }
```

Consequences:

- the **agent** re-points the pane with an ordinary file write — no extra tool, no RPC,
- `◀ ▶` walk the same folder, turning a `refs/` directory into a browsable bin,
- `⏺` copies `frame.jpg` to `reference-pinned.jpg` and rewrites the pointer,
- an unreadable or unsupported pointer degrades to `NO REFERENCE` instead of an error.

## Client rendering

Plain `React.createElement` (no JSX transform) inside `window.__ModuleLoader__`. One component serves both seats:

- **compact** — fixed 116 px viewers, used in the composer dock (always visible while composing, and short enough not to push the composer off-screen);
- **panel** — `flex: 1` viewers with `height: 100%`, used for the `main` key.

Cadence, pause, hidden-tab suppression and failure backoff live in the component; the Host is never asked for a frame the user cannot see.

## Verification recipe

The properties above are checkable without trusting the UI:

```powershell
# route + timing
(Invoke-WebRequest http://127.0.0.1:3080/x-blender-live/status).Content
# reference identity
Get-FileHash <source.png>; (Invoke-WebRequest .../reference).Content → hash
# scene integrity: compare render settings before/after a burst of captures
```

A pixel-level check that the Client really draws the pointer's image: write a synthetic magenta PNG as the reference pointer, screenshot, count magenta pixels, restore the pointer, count again (0).
