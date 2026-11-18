# Install & Setup — English

**dsh-blender-live** connects the DeepSeek Harness (DSH) to Blender and shows a
video-editor style **reference | live viewport** in the DSH Web GUI.

There are exactly **two things to install**, and both live in this repository:

| # | What | Where it runs |
|---|---|---|
| 1 | The **Blender connector** (a small add-on) | inside Blender |
| 2 | The **DSH bundle** (the plugin itself) | inside DSH |

Nothing else: no separate download, no npm package, no second port, no external
service.

---

## 0 · Prerequisites

- **Blender 4.2 or newer** (developed against 5.3).
- **DeepSeek Harness** with a Web profile that opens `http://127.0.0.1:3080`.
- Both running on **the same machine**. The bridge talks over loopback only.

---

## 1 · Install the Blender connector

The connector is the folder `blender/dsh_blender_live/` (it holds
`__init__.py` and `blender_manifest.toml`). Pick **one** of the two methods.

### Method A — zip and install (recommended)

1. Open the cloned repository, go to `blender/`.
2. Create a zip whose **root contains** `__init__.py` and `blender_manifest.toml`
   (zip the *contents* of `dsh_blender_live/`, not the folder itself).

   PowerShell:

   ```powershell
   cd <repo>\blender\dsh_blender_live
   Compress-Archive -Path * -DestinationPath ..\dsh_blender_live.zip -Force
   ```

   macOS / Linux:

   ```bash
   cd <repo>/blender/dsh_blender_live
   zip -r ../dsh_blender_live.zip . -x '__pycache__/*'
   ```

3. In Blender: **Edit → Preferences → Get Extensions → ⌄ (top-right) → Install from Disk…**
4. Choose `dsh_blender_live.zip` and confirm.
5. In **Preferences → Add-ons**, search for `DSH` and **tick “DSH Blender Live Connector”**.

### Method B — copy the folder (no zip)

1. Press `Win + R`, paste `%APPDATA%\Blender Foundation\Blender`, press Enter.
2. Open the folder for your Blender version (for example `5.3`), then `extensions\user_default`.
   If `user_default` does not exist, create it.
3. Copy the whole `dsh_blender_live` folder into it so you have:

   ```
   …\Blender\5.3\extensions\user_default\dsh_blender_live\blender_manifest.toml
   …\Blender\5.3\extensions\user_default\dsh_blender_live\__init__.py
   ```

4. **Restart Blender**, then **Preferences → Add-ons → search `DSH` → tick it**.

### Confirm the connector is listening

In the 3D Viewport press `N` → the **DSH** tab shows:

```
Listening on 127.0.0.1:9876     [Stop]
```

Port **9876** is what DSH expects. If 9876 is already taken (for example by an
older `blender_mcp` add-on), the connector automatically falls back to
9877–9881 and shows the port it picked. If it picked something other than 9876,
set the environment variable `DSH_BLENDER_LIVE_PORT` to that port before
starting DSH.

> The connector auto-starts whenever Blender loads. You can turn that off in
> **Preferences → Add-ons → DSH Blender Live Connector → Preferences**
> (“Start when Blender loads”), or change the preferred port there.

---

## 2 · Install the DSH bundle

1. Keep the cloned repository somewhere permanent (DSH links to the folder, so
   moving or deleting it breaks the plugin).
2. In the DSH chat, ask the agent:

   > install the bundle at `D:\path\to\repo`

   The agent calls the plugin manager, which links the directory into your DSH
   profile and enables the bundle.
3. **Restart the Harness** — Host code and the Web-GUI bundle are only re-read on
   restart. Close the terminal running `dsh web` and start it again.
4. Your chat is preserved; reopen it from the sidebar.

---

## 3 · Check that it works

1. **Host route** — open in a browser or run:

   ```powershell
   (Invoke-WebRequest http://127.0.0.1:3080/x-blender-live/status).Content
   ```

   Expected JSON (values differ):

   ```json
   {"ok":true,"port":9876,"blend":"my_scene.blend","engine":"CYCLES","objects":741,"frame":450,...}
   ```

2. **Viewer** — in the DSH chat, scroll to the very bottom of the conversation:
   directly **above the message box** there is a strip with two panes,
   **REFERENCE** on the left and **LIVE PROGRAM** on the right.

3. **Blender tools** — ask the agent:

   > what does blender_status say?

   It should report the open `.blend`, scene, engine and object count.

---

## 4 · Using it

### The viewer

| Control | Meaning |
|---|---|
| `❚❚ / ▶` | Pause / resume automatic capture |
| `⟳` | Capture exactly one frame now |
| timecode `00:01:23` | How long this viewer has been open |
| `#07` | Frames captured so far |
| meter | Capture cadence (“next frame is coming”) |
| `174 ms` | Render time of the last frame |
| `1s 2s 4s 8s` | Capture interval — slower is kinder to a heavy scene |
| `◀ ▶` | Previous / next reference image (same folder) |
| `⏺` | Pin the current live frame as the reference (A/B compare) |
| `⤢` | Open the full-size panel (experimental) |

Captures stop by themselves when the browser tab is hidden.

### Pointing at a reference image

Ask the agent:

> set the reference to `D:\refs\nose_cutaway_side.png`

which writes this file:

```
%TEMP%\dsh-blender-live\reference.json
```

```json
{ "path": "D:\\refs\\nose_cutaway_side.png", "label": "nose cutaway - side - 8 m" }
```

You can edit it by hand too: press `Win + R`, type `%TEMP%`, open
`dsh-blender-live`, edit `reference.json`, and the viewer picks it up within a
few seconds. PNG, JPEG, WebP, GIF, BMP and TIFF are accepted. `◀ ▶` walks every
image in that file's folder, so one `refs\` folder becomes a browsable bin.

### Matching the camera to the drawing

> match the viewport angle to the reference

The agent can set an orthographic side view, frame the same section, and the two
panes then line up. Nothing is forced on your scene: you can always move the
viewport yourself and the live pane simply follows.

### Agent tools

| Tool | Example request |
|---|---|
| `blender_status` | “is Blender connected?” |
| `blender_run` | “make the cabin lights 20 % brighter” |
| `blender_run_script` | “run `scripts/build_cockpit.py`” |
| `blender_snapshot` | “save a render of the current camera to `out.png`” |

---

## 5 · Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **NO SIGNAL** in the live pane | Blender is closed, or the connector is off. Open Blender → `N` sidebar → **DSH** tab → **Start**. |
| **NO REFERENCE** | `reference.json` is missing, points at a missing file, or names an unsupported image type. |
| Viewer missing entirely | The Harness has not been restarted since install, or the clone was moved. Re-install the bundle, restart DSH. |
| `/x-blender-live/...` returns **404** | Harness not restarted after install/upgrade. |
| `/status` says `"error": "…did not answer within 30000 ms"` | Blender is busy (a long render) or blocked by a modal dialog. Dismiss it and retry. |
| Connector always lands on 9877 | Something already owns 9876 (e.g. the older `blender_mcp` add-on). Either keep using the old add-on on 9876, or set `DSH_BLENDER_LIVE_PORT=9877` before starting DSH. |
| Frames feel laggy while modelling | Lower the cadence to `4s`/`8s`, or press `❚❚` while you drag heavy geometry. |
| Blank/garbled DSH UI after an upgrade | Client bundle is stale: restart the Harness (a page reload is not enough in profiles that link the folder). |

---

## 6 · What it touches on your machine

- **Reads/writes** only Blender state you ask it to change, plus these temp files:

  ```
  %TEMP%\dsh-blender-live\frame.jpg              latest viewport frame
  %TEMP%\dsh-blender-live\reference-pinned.jpg   a pinned frame (if you use ⏺)
  %TEMP%\dsh-blender-live\reference.json         pointer to the reference image
  ```

- **Restores** every render setting a capture touches (file path, format, colour
  mode, quality, resolution, borders, overwrite) — even when a capture fails.
- **Listens** on `127.0.0.1:9876` only; requests from other machines are refused.
- The connector runs Python inside Blender with **no authentication**. Anyone who
  can reach that port can run code in your session. Keep it on loopback.

## 7 · Uninstall

1. DSH: ask the agent to remove the bundle, or use the Plugins page, then restart the Harness.
2. Blender: **Preferences → Add-ons** → untick **DSH Blender Live Connector** (and remove it if you like).
3. Optional: delete `%TEMP%\dsh-blender-live\`.
