/**
 * Live Blender bridge for the DeepSeek Harness.
 *
 * Speaks the `blender_mcp` add-on's protocol: a TCP socket on localhost that
 * accepts null-byte-delimited JSON `{"type":"execute","code":...,"strict_json":true}`
 * requests, `exec`s the Python inside Blender's main thread, and replies with
 * `{"status":"ok"|"error","result":{...},"stdout":...,"stderr":...}` plus a
 * trailing NUL.
 *
 * The add-on polls from a Blender timer, so replies arrive only while Blender's
 * main loop is free; a long render therefore needs a longer timeout.
 *
 * The same socket also feeds the live viewport stream: a prefix route on the
 * Harness web server answers `GET /x-blender-live/frame.jpg` with the newest
 * viewport render, and the bundle's Client half shows it beside a reference
 * image, the way a video editor pairs a reference monitor with a program
 * monitor. That route is registered only when the web server exists, so a
 * headless profile still gets every tool.
 *
 * The reference image is whatever `reference.json` in the temp directory points
 * at, so the agent can set it with an ordinary file write; pinning the current
 * frame overwrites that pointer with a still of the live viewport.
 *
 * @module @local/dsh-blender-live
 */

import net from 'node:net'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

export const name = 'blender-live'
export const inject = ['tools']

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 9876
const DEFAULT_TIMEOUT_MS = 30_000

const NO_SERVER_HINT =
  'No Blender is listening. Open Blender 5.3, enable the blender_mcp add-on, and start its server ' +
  '(View3D sidebar -> Blender MCP -> Start, or the add-on preference that starts it on load). ' +
  'The bridge does not launch Blender itself.'

/** One request/response round trip on the add-on socket. */
function socketRequest(payload, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    let buffered = Buffer.alloc(0)
    const socket = net.createConnection({ host, port })

    const timer = setTimeout(() => {
      finish(new Error(`Blender did not answer within ${timeoutMs} ms on ${host}:${port}. It may be busy (rendering) or waiting on a modal dialog.`))
    }, timeoutMs)

    function finish(error, value) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }

    socket.on('connect', () => {
      socket.write(payload)
    })

    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf(0)
      if (end === -1) return
      const text = buffered.subarray(0, end).toString('utf8')
      let reply
      try {
        reply = JSON.parse(text)
      } catch (error) {
        finish(new Error(`Blender sent a reply that is not JSON: ${error.message}`))
        return
      }
      finish(null, reply)
    })

    socket.on('error', (error) => {
      if (error && error.code === 'ECONNREFUSED') finish(new Error(NO_SERVER_HINT))
      else finish(error)
    })

    socket.on('close', () => {
      finish(new Error('Blender closed the connection before sending a complete reply.'))
    })
  })
}

/** Execute Python inside the running Blender and return the raw reply object. */
async function execInBlender(code, host, port, timeoutMs) {
  const payload = Buffer.from(`${JSON.stringify({ type: 'execute', code, strict_json: true })}\0`, 'utf8')
  const reply = await socketRequest(payload, host, port, timeoutMs)
  if (reply === null || typeof reply !== 'object') {
    throw new Error('Blender replied with a non-object payload.')
  }
  return reply
}

/**
 * Redraw nudge appended to executed code so the user watching the viewport sees
 * the change immediately instead of on the next incidental event.
 */
const REDRAW_SUFFIX = `

# --- dsh-blender-live: push the result to the viewport -----------------------
try:
    import bpy as _dsh_bpy
    _dsh_bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
except Exception:
    pass
`

function withRedraw(code, redraw) {
  return redraw === false ? code : `${code}${REDRAW_SUFFIX}`
}

const STATUS_CODE = `
import bpy
_scene = bpy.context.scene
result = {
    "blender_version": bpy.app.version_string,
    "background": bool(bpy.app.background),
    "blend_file": bpy.data.filepath or None,
    "blend_name": bpy.path.basename(bpy.data.filepath) if bpy.data.filepath else None,
    "dirty": bool(bpy.data.is_dirty),
    "scene": _scene.name,
    "render_engine": _scene.render.engine,
    "frame": _scene.frame_current,
    "objects": len(bpy.data.objects),
    "meshes": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "collections": [c.name for c in bpy.data.collections],
    "unit_system": _scene.unit_settings.system,
    "unit_scale": _scene.unit_settings.scale_length,
}
`

/**
 * Python for the snapshot tool. Every interpolated value is a JSON literal,
 * which is also a valid Python literal, so no string-concatenation injection.
 */
function snapshotCode(path, mode, width, height) {
  const pathLiteral = JSON.stringify(path)
  const modeLiteral = JSON.stringify(mode)
  const widthPx = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  const heightPx = Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  return `
import bpy
import os

_path = ${pathLiteral}
_mode = ${modeLiteral}

_parent = os.path.dirname(_path)
if _parent and not os.path.isdir(_parent):
    os.makedirs(_parent, exist_ok=True)

if _mode == "window":
    if bpy.app.background:
        result = {"status": "error", "message": "A window screenshot needs a GUI Blender session; use mode='render' instead."}
    else:
        bpy.ops.screen.screenshot(filepath=_path)
        result = {"status": "ok", "mode": _mode, "filepath": _path}
else:
    _scene = bpy.context.scene
    _render = _scene.render
    _render.filepath = _path
    _render.image_settings.file_format = "PNG"
    _render.resolution_percentage = 100
    if ${widthPx} > 0:
        _render.resolution_x = ${widthPx}
    if ${heightPx} > 0:
        _render.resolution_y = ${heightPx}
    bpy.ops.render.render(write_still=True)
    result = {
        "status": "ok",
        "mode": _mode,
        "filepath": _path,
        "width": _render.resolution_x,
        "height": _render.resolution_y,
        "engine": _scene.render.engine,
    }

if os.path.isfile(_path):
    result["bytes"] = os.path.getsize(_path)
else:
    result["bytes"] = 0
    if result.get("status") == "ok":
        result["status"] = "error"
        result["message"] = "Blender reported success but no file exists at the target path."
`
}

const portParameter = {
  type: 'number',
  description: `TCP port of the blender_mcp add-on socket. Defaults to ${DEFAULT_PORT}.`
}

const timeoutParameter = {
  type: 'number',
  description: `Milliseconds to wait for Blender to answer. Defaults to ${DEFAULT_TIMEOUT_MS}; raise it for renders and simulations.`
}

const redrawParameter = {
  type: 'boolean',
  description: 'Force a viewport redraw after the code runs so the user sees the change immediately. Defaults to true.'
}

function resolveTarget(args) {
  const host = DEFAULT_HOST
  const port = Number.isFinite(args.port) && args.port > 0 ? Math.round(args.port) : DEFAULT_PORT
  const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? Math.round(args.timeoutMs) : DEFAULT_TIMEOUT_MS
  return { host, port, timeoutMs }
}

function describeReply(reply) {
  const lines = []
  if (reply.status === 'error') {
    lines.push('Blender reported an error.')
    if (typeof reply.message === 'string' && reply.message) lines.push(reply.message)
  } else {
    lines.push('Blender finished the request.')
    if (reply.result !== undefined) lines.push(`result: ${JSON.stringify(reply.result)}`)
  }
  if (typeof reply.stdout === 'string' && reply.stdout.trim()) lines.push(`stdout:\n${reply.stdout.trimEnd()}`)
  if (typeof reply.stderr === 'string' && reply.stderr.trim()) lines.push(`stderr:\n${reply.stderr.trimEnd()}`)
  return lines.join('\n')
}

function statusTool() {
  return {
    name: 'blender_status',
    description:
      'Report the live Blender connection: whether the socket answers, Blender version, open .blend file, scene name, render engine and datablock counts. Never throws when Blender is absent; returns connected=false with a hint instead.',
    parameters: {
      type: 'object',
      properties: { port: portParameter },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          connected: { type: 'boolean' },
          port: { type: 'number' },
          error: { type: 'string' },
          scene: { type: 'string' },
          blenderVersion: { type: 'string' },
          blendFile: { type: 'string' },
          renderEngine: { type: 'string' },
          objects: { type: 'number' },
          materials: { type: 'number' },
          collections: { type: 'array', items: { type: 'string' } }
        },
      },
      render: (args, value) => {
        if (!value.connected) {
          return [{ type: 'text', text: `Blender is not reachable on port ${value.port}.\n${value.error ?? ''}`.trim() }]
        }
        return [{
          type: 'text',
          text: [
            `Connected to Blender ${value.blenderVersion} on 127.0.0.1:${value.port}`,
            `file: ${value.blendFile || '(unsaved)'}`,
            `scene: ${value.scene}  engine: ${value.renderEngine}`,
            `objects: ${value.objects}  materials: ${value.materials}`,
            `collections: ${(value.collections ?? []).join(', ') || '(none)'}`
          ].join('\n')
        }]
      }
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const { host, port, timeoutMs } = resolveTarget(args ?? {})
      try {
        const reply = await execInBlender(STATUS_CODE, host, port, timeoutMs)
        if (reply.status === 'error') {
          return { connected: false, port, error: reply.message ?? 'Blender reported an error for the status request.' }
        }
        const info = reply.result ?? {}
        return {
          connected: true,
          port,
          scene: String(info.scene ?? ''),
          blenderVersion: String(info.blender_version ?? ''),
          blendFile: String(info.blend_file ?? ''),
          renderEngine: String(info.render_engine ?? ''),
          objects: Number(info.objects ?? 0),
          materials: Number(info.materials ?? 0),
          collections: Array.isArray(info.collections) ? info.collections.map(String) : []
        }
      } catch (error) {
        return { connected: false, port, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }
}

function runTool() {
  return {
    name: 'blender_run',
    description:
      'Execute Python inside the running Blender 5.3 and return its result, stdout and stderr. The code runs on Blender\'s main thread. Assign a dict to `result` to return structured data; anything else is an error. Use this for real-time modelling: each call is applied to the live scene the user is looking at.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python source to execute in Blender. Must assign a JSON-serializable dict to a variable named `result` when a return value is needed.'
        },
        port: portParameter,
        timeoutMs: timeoutParameter,
        redraw: redrawParameter
      },
      required: ['code'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          message: { type: 'string' },
          result: { type: 'object' },
          stdout: { type: 'string' },
          stderr: { type: 'string' }
        },
      },
      render: (args, value) => [{ type: 'text', text: describeReply(value) }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const input = args ?? {}
      const code = typeof input.code === 'string' ? input.code : ''
      if (!code.trim()) throw new Error('blender_run needs non-empty Python in `code`.')
      const { host, port, timeoutMs } = resolveTarget(input)
      const reply = await execInBlender(withRedraw(code, input.redraw), host, port, timeoutMs)
      const out = { status: String(reply.status ?? 'error') }
      if (typeof reply.message === 'string') out.message = reply.message
      if (reply.result !== undefined && reply.result !== null && typeof reply.result === 'object' && !Array.isArray(reply.result)) out.result = reply.result
      if (typeof reply.stdout === 'string' && reply.stdout) out.stdout = reply.stdout
      if (typeof reply.stderr === 'string' && reply.stderr) out.stderr = reply.stderr
      return out
    }
  }
}

function runScriptTool() {
  return {
    name: 'blender_run_script',
    description:
      'Read a Python file from this machine\'s disk and execute it inside the running Blender. Prefer this over blender_run for project build scripts: the script stays an editable file, and re-running it applies the current version to the live scene.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of the Python file to execute inside Blender (the file is read by the harness, not by Blender).'
        },
        port: portParameter,
        timeoutMs: timeoutParameter,
        redraw: redrawParameter
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          script: { type: 'string' },
          scriptBytes: { type: 'number' },
          status: { type: 'string' },
          message: { type: 'string' },
          result: { type: 'object' },
          stdout: { type: 'string' },
          stderr: { type: 'string' }
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `${value.script} (${value.scriptBytes} bytes)\n${describeReply(value)}`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const input = args ?? {}
      if (typeof input.path !== 'string' || !input.path.trim()) throw new Error('blender_run_script needs a `path`.')
      const source = await readFile(input.path, 'utf8')
      const { host, port, timeoutMs } = resolveTarget(input)
      const reply = await execInBlender(withRedraw(source, input.redraw), host, port, timeoutMs)
      const out = {
        script: input.path,
        scriptBytes: Buffer.byteLength(source, 'utf8'),
        status: String(reply.status ?? 'error')
      }
      if (typeof reply.message === 'string') out.message = reply.message
      if (reply.result !== undefined && reply.result !== null && typeof reply.result === 'object' && !Array.isArray(reply.result)) out.result = reply.result
      if (typeof reply.stdout === 'string' && reply.stdout) out.stdout = reply.stdout
      if (typeof reply.stderr === 'string' && reply.stderr) out.stderr = reply.stderr
      return out
    }
  }
}

function snapshotTool() {
  return {
    name: 'blender_snapshot',
    description:
      'Capture the running Blender to a PNG: mode "window" grabs exactly what is on screen (needs the GUI), mode "render" renders the active scene camera to the file. Returns the absolute path, byte size and pixel dimensions, ready to be viewed with the image reader.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute destination path for the PNG. Parent folders are created if missing; include the .png extension.'
        },
        mode: {
          type: 'string',
          enum: ['window', 'render'],
          description: 'window = screenshot of the Blender UI (default); render = render the active scene camera.'
        },
        width: { type: 'number', description: 'Render width in pixels (render mode only). Omit to keep the scene setting.' },
        height: { type: 'number', description: 'Render height in pixels (render mode only). Omit to keep the scene setting.' },
        port: portParameter,
        timeoutMs: timeoutParameter
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          mode: { type: 'string' },
          filepath: { type: 'string' },
          bytes: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          engine: { type: 'string' },
          message: { type: 'string' }
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.status === 'ok'
          ? `${value.mode} capture written to ${value.filepath} (${value.bytes} bytes${value.width ? `, ${value.width}x${value.height}` : ''})`
          : `capture failed: ${value.message ?? 'unknown reason'}`
      }]
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const input = args ?? {}
      if (typeof input.path !== 'string' || !input.path.trim()) throw new Error('blender_snapshot needs a `path`.')
      const mode = input.mode === 'render' ? 'render' : 'window'
      const { host, port, timeoutMs } = resolveTarget(input)
      const code = snapshotCode(input.path, mode, input.width, input.height)
      const reply = await execInBlender(code, host, port, timeoutMs)
      if (reply.status === 'error') {
        throw new Error(typeof reply.message === 'string' ? reply.message : 'Blender could not capture the snapshot.')
      }
      const info = reply.result ?? {}
      const out = {
        status: String(info.status ?? 'error'),
        mode: String(info.mode ?? mode),
        filepath: String(info.filepath ?? input.path),
        bytes: Number(info.bytes ?? 0)
      }
      if (Number.isFinite(info.width)) out.width = Number(info.width)
      if (Number.isFinite(info.height)) out.height = Number(info.height)
      if (typeof info.engine === 'string') out.engine = info.engine
      if (typeof info.message === 'string') out.message = info.message
      return out
    }
  }
}

/* -------------------------------------------------------------------------- *
 * Live viewport stream
 *
 * `GET /x-blender-live/frame.jpg?w=<px>&h=<px>` returns one JPEG of the 3D
 * viewport, rendered by Blender's own "viewport render" so it carries the
 * scene's real shading without UI overlays. `GET /x-blender-live/status`
 * reports the last frame's bookkeeping as JSON. Both answer 503 when Blender is
 * unreachable, which the browser card renders as "offline".
 *
 * Cost control matters here because the render runs on Blender's main thread
 * (~150 ms for the airframe scene): concurrent requests share one capture, and
 * a frame younger than VIEWPORT_CACHE_MS is served from disk instead of
 * re-rendered. The Client only asks while its card is expanded and the tab is
 * visible.
 * -------------------------------------------------------------------------- */

const VIEWPORT_ROUTE = '/x-blender-live'
const VIEWPORT_DIR = join(tmpdir(), 'dsh-blender-live')
const VIEWPORT_FRAME_PATH = join(VIEWPORT_DIR, 'frame.jpg')
const VIEWPORT_REFERENCE_FILE = join(VIEWPORT_DIR, 'reference.json')
const VIEWPORT_PINNED_PATH = join(VIEWPORT_DIR, 'reference-pinned.jpg')
const VIEWPORT_CACHE_MS = 400
const VIEWPORT_MIN_SIDE = 240
const VIEWPORT_MAX_SIDE = 2048
const VIEWPORT_DEFAULT = { width: 1152, height: 648, quality: 82 }

/** Extensions the reference pane can show, and the type to serve them as. */
const REFERENCE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

/**
 * Python for one frame. Every render setting it overrides is restored in a
 * `finally`, so a failing capture cannot leave the user's scene reconfigured.
 */
function viewportCaptureCode({ outPath, width, height, quality }) {
  return `
import bpy
import os

_out = ${JSON.stringify(outPath)}
_w, _h, _q = ${width}, ${height}, ${quality}


def _dsh_capture_viewport():
    scene = bpy.context.scene
    render = scene.render
    settings = render.image_settings
    saved = (
        render.filepath, settings.file_format, settings.color_mode, settings.quality,
        render.resolution_x, render.resolution_y, render.resolution_percentage,
        render.use_border, render.use_crop_to_border, render.use_overwrite,
    )
    window = None
    area = None
    for candidate in bpy.context.window_manager.windows:
        for candidate_area in candidate.screen.areas:
            if candidate_area.type == "VIEW_3D":
                window, area = candidate, candidate_area
                break
        if area is not None:
            break
    if area is None:
        return {"status": "error", "message": "No 3D viewport is open in Blender."}
    region = next((item for item in area.regions if item.type == "WINDOW"), None)
    try:
        render.filepath = _out
        settings.file_format = "JPEG"
        settings.color_mode = "RGB"
        settings.quality = _q
        render.resolution_x = _w
        render.resolution_y = _h
        render.resolution_percentage = 100
        render.use_border = False
        render.use_crop_to_border = False
        render.use_overwrite = True
        with bpy.context.temp_override(window=window, area=area, region=region):
            bpy.ops.render.opengl(view_context=True, write_still=True)
    finally:
        (render.filepath, settings.file_format, settings.color_mode, settings.quality,
         render.resolution_x, render.resolution_y, render.resolution_percentage,
         render.use_border, render.use_crop_to_border, render.use_overwrite) = saved

    if not os.path.isfile(_out):
        return {"status": "error", "message": "Blender produced no frame file."}
    return {
        "status": "ok",
        "bytes": os.path.getsize(_out),
        "blend": os.path.basename(bpy.data.filepath) if bpy.data.filepath else "",
        "engine": render.engine,
        "objects": len(bpy.data.objects),
        "frame": int(scene.frame_current),
        "scene": scene.name,
    }


result = _dsh_capture_viewport()
`
}

const viewportState = {
  lastFrameAt: 0,
  lastBytes: 0,
  lastMs: 0,
  lastError: '',
  blend: '',
  engine: '',
  objects: 0,
  frame: 0,
  scene: ''
}

let viewportInflight = null

/** Capture one viewport frame and return its JPEG bytes. */
async function captureViewport({ width, height, quality, force }) {
  const cacheable = viewportState.lastBytes > 0 && Date.now() - viewportState.lastFrameAt < VIEWPORT_CACHE_MS
  if (cacheable && !force) return readFile(VIEWPORT_FRAME_PATH)

  if (viewportInflight) return viewportInflight

  viewportInflight = (async () => {
    const startedAt = Date.now()
    await mkdir(join(tmpdir(), 'dsh-blender-live'), { recursive: true })
    const { host, port, timeoutMs } = resolveTarget({})
    const reply = await execInBlender(
      viewportCaptureCode({ outPath: VIEWPORT_FRAME_PATH, width, height, quality }),
      host,
      port,
      timeoutMs,
    )
    if (reply.status === 'error') {
      throw new Error(typeof reply.message === 'string' && reply.message
        ? reply.message
        : 'Blender could not capture the viewport.')
    }
    const info = reply.result ?? {}
    if (info.status !== 'ok') {
      throw new Error(typeof info.message === 'string' ? info.message : 'Blender could not capture the viewport.')
    }
    const file = await stat(VIEWPORT_FRAME_PATH)
    viewportState.lastFrameAt = Date.now()
    viewportState.lastBytes = file.size
    viewportState.lastMs = viewportState.lastFrameAt - startedAt
    viewportState.lastError = ''
    viewportState.blend = typeof info.blend === 'string' ? info.blend : ''
    viewportState.engine = typeof info.engine === 'string' ? info.engine : ''
    viewportState.objects = Number(info.objects) || 0
    viewportState.frame = Number(info.frame) || 0
    viewportState.scene = typeof info.scene === 'string' ? info.scene : ''
    return readFile(VIEWPORT_FRAME_PATH)
  })()

  try {
    return await viewportInflight
  } finally {
    viewportInflight = null
  }
}

/**
 * Resolve the reference image the way a reference monitor does: one pointer
 * file names the image, and anything unreadable means "no reference" rather
 * than an error the card has to explain.
 */
async function readReference() {
  let parsed
  try {
    parsed = JSON.parse(await readFile(VIEWPORT_REFERENCE_FILE, 'utf8'))
  } catch {
    return null
  }
  const path = typeof parsed?.path === 'string' ? parsed.path.trim() : ''
  const mime = REFERENCE_MIME[extname(path).toLowerCase()]
  if (!path || !mime) return null
  try {
    const file = await stat(path)
    if (!file.isFile() || file.size === 0) return null
    return {
      path,
      mime,
      mtime: Math.round(file.mtimeMs),
      bytes: file.size,
      label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label.trim() : basename(path)
    }
  } catch {
    return null
  }
}

/** Point the reference pane at whatever the current frame looks like right now. */
async function pinReferenceFrame(res) {
  try {
    const file = await stat(VIEWPORT_FRAME_PATH)
    if (!file.isFile() || file.size === 0) throw new Error('capture a frame before pinning one')
    await mkdir(VIEWPORT_DIR, { recursive: true })
    await copyFile(VIEWPORT_FRAME_PATH, VIEWPORT_PINNED_PATH)
    await writeFile(
      VIEWPORT_REFERENCE_FILE,
      JSON.stringify({ path: VIEWPORT_PINNED_PATH, label: 'Pinned frame' }, null, 2),
      'utf8',
    )
    return sendJson(res, 200, { ok: true, reference: await readReference() })
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Move the reference pointer to the neighbouring image in its own folder, so a
 * reference bin (one folder per design lock) can be browsed from the card.
 */
async function stepReference(res, direction) {
  try {
    const current = await readReference()
    if (!current) return sendJson(res, 404, { ok: false, error: 'no reference image is set' })
    const folder = dirname(current.path)
    const entries = (await readdir(folder))
      .filter((name) => REFERENCE_MIME[extname(name).toLowerCase()])
      .sort((left, right) => left.localeCompare(right))
    if (entries.length === 0) return sendJson(res, 404, { ok: false, error: 'the reference folder holds no images' })
    const index = entries.findIndex((name) => join(folder, name) === current.path)
    const next = entries[((index < 0 ? 0 : index) + direction + entries.length) % entries.length]
    await writeFile(
      VIEWPORT_REFERENCE_FILE,
      JSON.stringify({ path: join(folder, next), label: next.replace(/\.[^.]+$/, '') }, null, 2),
      'utf8',
    )
    return sendJson(res, 200, { ok: true, reference: await readReference() })
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function serveReference(res, method) {
  const reference = await readReference()
  if (!reference) return sendJson(res, 404, { ok: false, error: 'no reference image is set' })
  try {
    const bytes = await readFile(reference.path)
    res.writeHead(200, {
      'content-type': reference.mime,
      'content-length': bytes.length,
      'cache-control': 'no-store'
    })
    if (method === 'HEAD') return res.end()
    return res.end(bytes)
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function clampSide(raw, fallback) {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(VIEWPORT_MAX_SIDE, Math.max(VIEWPORT_MIN_SIDE, Math.round(value)))
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store'
  })
  res.end(text)
}

/** Only this machine's own browser may read the stream. */
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function handleViewportRoute(req, res) {
  if (!isLoopbackRequest(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })

  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const action = url.pathname.slice(VIEWPORT_ROUTE.length).replace(/^\/+/, '')
  const method = req.method ?? 'GET'

  if (action === 'reference/pin') {
    if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    return pinReferenceFrame(res)
  }

  if (action === 'reference/step') {
    if (method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    return stepReference(res, Number.parseInt(url.searchParams.get('dir') ?? '', 10) < 0 ? -1 : 1)
  }

  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'GET only' })
  }

  if (action === 'reference') return serveReference(res, method)

  if (action === '' || action === 'status') {
    const reference = await readReference()
    return sendJson(res, 200, {
      ok: true,
      port: DEFAULT_PORT,
      servedAt: viewportState.lastFrameAt,
      bytes: viewportState.lastBytes,
      captureMs: viewportState.lastMs,
      blend: viewportState.blend,
      engine: viewportState.engine,
      objects: viewportState.objects,
      frame: viewportState.frame,
      scene: viewportState.scene,
      reference: reference
        ? { ok: true, label: reference.label, mtime: reference.mtime, bytes: reference.bytes }
        : { ok: false },
      error: viewportState.lastError
    })
  }

  if (action !== 'frame.jpg' && action !== 'frame') {
    return sendJson(res, 404, { ok: false, error: `unknown route ${url.pathname}` })
  }

  try {
    const frame = await captureViewport({
      width: clampSide(url.searchParams.get('w'), VIEWPORT_DEFAULT.width),
      height: clampSide(url.searchParams.get('h'), VIEWPORT_DEFAULT.height),
      quality: Math.min(95, Math.max(30, Number.parseInt(url.searchParams.get('q') ?? '', 10) || VIEWPORT_DEFAULT.quality)),
      force: url.searchParams.get('force') === '1'
    })
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': frame.length,
        'cache-control': 'no-store'
      })
      return res.end()
    }
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': frame.length,
      'cache-control': 'no-store',
      'x-dsh-blender-live-ms': String(viewportState.lastMs)
    })
    return res.end(frame)
  } catch (error) {
    viewportState.lastError = error instanceof Error ? error.message : String(error)
    return sendJson(res, 503, { ok: false, error: viewportState.lastError, port: DEFAULT_PORT })
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(statusTool()),
      ctx.tools.register(runTool()),
      ctx.tools.register(runScriptTool()),
      ctx.tools.register(snapshotTool())
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // A disposer that already ran must not block the rest of the cleanup.
        }
      }
    }
  })

  // Optional seat: the tools above must keep working in a profile that has no
  // web server, so the viewport route is claimed only where one exists.
  ctx.inject(['webServer'], (viewerCtx) => {
    viewerCtx.effect(() => viewerCtx.webServer.register({
      kind: 'prefix',
      path: VIEWPORT_ROUTE,
      handler: handleViewportRoute
    }))
  })
}
