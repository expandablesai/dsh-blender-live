"""DSH Blender Live Connector.

Dependency-free socket server that lets the `dsh-blender-live` Harness plugin
run Python inside this Blender session and pull viewport frames.

Nothing else needs installing: this file is the whole Blender side.

Protocol, loopback only, one request per connection:

  request   {"type": "execute", "code": "<python>", "strict_json": true} + NUL
  reply     {"status": "ok", "result": {...}} or
            {"status": "error", "message": "<traceback>"}                + NUL

The Python runs on Blender's main thread (from a timer), so `bpy` calls are
always safe. Code is expected to assign a JSON-serialisable dict to `result`.

Install: zip this folder and use Blender -> Preferences -> Get Extensions ->
Install from Disk, or copy it into your Blender extensions/user_default folder.
"""

bl_info = {
    "name": "DSH Blender Live Connector",
    "author": "The dsh-blender-live authors",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > DSH",
    "description": "Socket bridge that lets the DeepSeek Harness drive Blender and watch its viewport",
    "category": "Development",
}

import contextlib
import io
import json
import socket
import time
import traceback

import bpy

HOST = "127.0.0.1"
# 9876 is what the DeepSeek Harness plugin expects and what the older
# blender_mcp add-on uses. Occupied ports are skipped, so having both installed
# never breaks either one.
PORT_CANDIDATES = (9876, 9877, 9878, 9879, 9880, 9881)
IDLE_SECONDS = 90.0
MAX_REQUEST_BYTES = 8 * 1024 * 1024

_state = {
    "server": None,
    "clients": [],
    "port": 0,
    "timer_started": False,
}


# --------------------------------------------------------------------------- #
# execution
# --------------------------------------------------------------------------- #

def _execute(request_bytes):
    """Run one request and build the reply object."""
    try:
        request = json.loads(request_bytes.decode("utf-8", "replace"))
    except Exception:
        return {"status": "error", "message": traceback.format_exc()}

    if request.get("type") != "execute":
        return {"status": "error", "message": "Unknown request type: %r" % (request.get("type"),)}

    code = request.get("code", "")
    if not isinstance(code, str):
        return {"status": "error", "message": "`code` must be a string."}

    strict_json = request.get("strict_json")
    if not isinstance(strict_json, bool):
        return {
            "status": "error",
            "message": "The request must include `strict_json` as a boolean.",
        }

    namespace = {"result": {}}
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            exec(compile(code, "<dsh-blender-live>", "exec"), namespace)
        except Exception:
            response = {"status": "error", "message": traceback.format_exc()}
            if stdout.getvalue():
                response["stdout"] = stdout.getvalue()
            if stderr.getvalue():
                response["stderr"] = stderr.getvalue()
            return response

    result = namespace.get("result", {})
    if not isinstance(result, dict):
        response = {
            "status": "error",
            "message": "`result` must be a dict, not %s. Wrap the value: result = {'key': value}"
            % type(result).__name__,
        }
    else:
        try:
            json.dumps(result)
            response = {"status": "ok", "result": result}
        except (TypeError, ValueError) as error:
            if strict_json:
                response = {
                    "status": "error",
                    "message": "`result` is not JSON-serialisable: %s" % error,
                }
            else:
                response = {"status": "ok", "result": json.loads(json.dumps(result, default=repr))}

    if stdout.getvalue():
        response["stdout"] = stdout.getvalue()
    if stderr.getvalue():
        response["stderr"] = stderr.getvalue()
    return response


# --------------------------------------------------------------------------- #
# socket plumbing (non-blocking, drained by a Blender timer)
# --------------------------------------------------------------------------- #

def _close_client(client):
    try:
        client["sock"].close()
    except OSError:
        pass
    if client in _state["clients"]:
        _state["clients"].remove(client)


def _reply(conn, response):
    payload = (json.dumps(response) + "\0").encode("utf-8")
    try:
        conn.settimeout(5.0)
        conn.sendall(payload)
    except OSError:
        pass


def _poll():
    """Timer callback: accept connections, execute complete requests, reply."""
    server = _state["server"]
    if server is None:
        _state["timer_started"] = False
        return None

    for _ in range(8):
        try:
            conn, _address = server.accept()
        except (BlockingIOError, InterruptedError):
            break
        except OSError:
            break
        conn.setblocking(False)
        _state["clients"].append({"sock": conn, "buffer": bytearray(), "since": time.monotonic()})

    now = time.monotonic()
    for client in list(_state["clients"]):
        conn = client["sock"]
        if now - client["since"] > IDLE_SECONDS:
            _close_client(client)
            continue
        try:
            chunk = conn.recv(65536)
        except (BlockingIOError, InterruptedError):
            continue
        except OSError:
            _close_client(client)
            continue
        if not chunk:
            _close_client(client)
            continue
        client["buffer"] += chunk
        if len(client["buffer"]) > MAX_REQUEST_BYTES:
            _close_client(client)
            continue
        if 0 not in client["buffer"]:
            continue
        end = client["buffer"].index(0)
        raw = bytes(client["buffer"][:end])
        _reply(conn, _execute(raw))
        _close_client(client)

    return 0.05


def _start(port_preference=None):
    """Bind the first free candidate port and start the timer."""
    if _state["server"] is not None:
        return _state["port"]

    candidates = list(PORT_CANDIDATES)
    if port_preference:
        candidates.insert(0, int(port_preference))

    for port in candidates:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind((HOST, port))
            server.listen(8)
        except OSError:
            server.close()
            continue
        server.setblocking(False)
        _state["server"] = server
        _state["port"] = port
        if not _state["timer_started"]:
            bpy.app.timers.register(_poll, first_interval=0.1, persistent=True)
            _state["timer_started"] = True
        print("[dsh-blender-live] listening on %s:%d" % (HOST, port))
        return port

    print("[dsh-blender-live] every candidate port is busy: %s" % (candidates,))
    return 0


def _stop():
    for client in list(_state["clients"]):
        _close_client(client)
    _state["clients"].clear()
    if _state["server"] is not None:
        try:
            _state["server"].close()
        except OSError:
            pass
        _state["server"] = None
    if _state["timer_started"]:
        try:
            bpy.app.timers.unregister(_poll)
        except (ValueError, RuntimeError):
            pass
        _state["timer_started"] = False
    _state["port"] = 0
    print("[dsh-blender-live] stopped")


# --------------------------------------------------------------------------- #
# UI
# --------------------------------------------------------------------------- #

def _preferences(context):
    addon = context.preferences.addons.get(__name__)
    return addon.preferences if addon is not None else None


class DSHBL_OT_start(bpy.types.Operator):
    bl_idname = "dsh_blender_live.start"
    bl_label = "Start DSH connector"
    bl_description = "Listen for the DeepSeek Harness on 127.0.0.1 so it can drive Blender"

    def execute(self, context):
        preferences = _preferences(context)
        port = _start(preferences.port if preferences else None)
        if port:
            self.report({"INFO"}, "DSH connector listening on 127.0.0.1:%d" % port)
        else:
            self.report({"ERROR"}, "No free port for the DSH connector")
        return {"FINISHED"}


class DSHBL_OT_stop(bpy.types.Operator):
    bl_idname = "dsh_blender_live.stop"
    bl_label = "Stop DSH connector"
    bl_description = "Close the socket the DeepSeek Harness talks to"

    def execute(self, context):
        _stop()
        self.report({"INFO"}, "DSH connector stopped")
        return {"FINISHED"}


class DSHBL_PT_panel(bpy.types.Panel):
    bl_label = "DSH Blender Live"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "DSH"

    def draw(self, context):
        layout = self.layout
        running = _state["server"] is not None
        if running:
            layout.label(text="Listening on %s:%d" % (HOST, _state["port"]), icon="LINKED")
            layout.operator(DSHBL_OT_stop.bl_idname, icon="CANCEL")
        else:
            layout.label(text="Connector is stopped", icon="UNLINKED")
            layout.operator(DSHBL_OT_start.bl_idname, icon="PLAY")
        layout.label(text="Port 9876 is what the Harness expects.", icon="INFO")


class DSHBL_AddonPreferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    port: bpy.props.IntProperty(
        name="Preferred port",
        description="Port to listen on. Occupied ports are skipped automatically",
        default=9876,
        min=1024,
        max=65535,
    )
    auto_start: bpy.props.BoolProperty(
        name="Start when Blender loads",
        description="Open the socket as soon as this add-on is enabled",
        default=True,
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "port")
        layout.prop(self, "auto_start")


_CLASSES = (
    DSHBL_OT_start,
    DSHBL_OT_stop,
    DSHBL_PT_panel,
    DSHBL_AddonPreferences,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    preferences = _preferences(bpy.context)
    if preferences is None or preferences.auto_start:
        _start(preferences.port if preferences else None)


def unregister():
    _stop()
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
