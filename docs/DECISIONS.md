# Locked design decisions

These are settled. Each entry records the choice, why, and what was rejected —
so a future change re-opens a decision deliberately rather than by accident.

## 1. One bundle, two halves

**Locked:** a single DSH package with a Host half (`index.js`) and a Client half (`client.js`), wired by `dsh.bundle.patch` + `dsh.client`.

**Why:** the viewer is useless without the bridge and the bridge is blind without the viewer. One install, one row, one lifecycle.

## 2. Reuse the `blender_mcp` add-on socket

**Locked:** speak the add-on's existing NUL-terminated JSON protocol on `127.0.0.1:9876`. Ship no Blender-side add-on.

**Why:** users already run that add-on; adding a second server inside Blender would double the surface to install and keep in sync. The bridge stays a pure client of Blender.

**Cost accepted:** the add-on's `strict_json` requirement and main-thread timing quirks are part of our protocol contract.

## 3. HTTP routes on the existing web server, never a second server

**Locked:** `ctx.webServer.register({ kind: 'prefix', path: '/x-blender-live' })`.

**Why:** same origin means the browser's session cookie authorises the images, so no CORS, no token plumbing, no extra port, and nothing to firewall.

**Rejected:** a standalone localhost HTTP server in the plugin (second port, second auth story, second failure mode).

## 4. Temporary files, not project files

**Locked:** frames and the reference pointer live in `%TEMP%\dsh-blender-live\`.

**Why:** the plugin must never litter a user's repository. It also makes the reference channel agent-writable with a plain file write.

## 5. Additive slots only — `conversation.input.dock`, plus a registered `main` key

**Locked:** the supported surface is the composer's input dock; the full-size panel additionally registers `main[blender-live]` and a `sidebar.panellist` row.

**Why:** both are additive — a fresh dock id and a fresh panel key — so no shipped UI is replaced or shadowed.

**Rejected, with evidence:**

| Alternative | Why it failed |
|---|---|
| `shell.overlay` | Declared as `useMemo(() => renderSlot(...), [renderSlot])`; a late registration stayed `active` in the slot table yet never painted. |
| `conversation.composer.dock` | Its container carries `margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)` — an ambient seat that tucks content behind the composer card. A tall viewer is invisible there. |
| `conversation.session.header.corner` | A `single` slot already owned by a shipped control; registering would shadow shipped UI. |
| Detaching the card to `document.body` + `position: fixed` | The composer subtree's `backdrop-filter` makes it the containing block for `fixed` descendants; re-parenting painted once and vanished on the next load. Rejected as unreliable. |

## 6. Restore render settings in a `finally`

**Locked:** every capture saves and restores `filepath`, format, colour mode, quality, resolution, border/crop and overwrite, even on failure.

**Why:** "the plugin changed my render settings" is an unforgivable bug. Verified: `is_dirty: False` and identical settings before/after six captures.

## 7. Single flight + 400 ms cache

**Locked:** concurrent requests share one capture; a frame younger than 400 ms is served from disk; `force=1` bypasses.

**Why:** a capture is a real viewport render on Blender's main thread (150–400 ms on a 700+ object scene). Without this the GUI would stutter the user's modelling. Measured: 349 ms → 19 ms.

## 8. Loopback only

**Locked:** any non-loopback request gets `403`, regardless of headers.

**Why:** a viewport stream is screen-equivalent data. The server binds loopback by default; this is the belt to that suspenders.

## 9. The reference is a pointer file, not plugin state

**Locked:** `reference.json` names one image; `◀ ▶` walk its folder; `⏺` pins a still.

**Why:** the agent can drive the pane with a file write instead of a new tool, and the pointer is inspectable/debuggable with a text editor.

## 10. Cadence is the user's choice, defaulting to 2 s

**Locked:** `1s / 2s / 4s / 8s`, default `2s`.

**Why:** 1 s is useful on simple scenes; on a heavy one the user must be able to trade latency for a quiet main thread. Hidden tabs and pause stop capture entirely.

## 11. Package name stays `@local/dsh-blender-live`

**Locked:** do not rename. Publish the repository under any name you like.

**Why:** the package name is the installed profile link; renaming breaks the live install and forces remove/reinstall. `private: true` is kept so the repo cannot be published to npm by accident.

## 12. Client code changes need a Harness restart

**Accepted limitation, documented:** the client module graph picks up new bundle bytes through the HMR watch's `rebuilt()` hook, which does not cover a `link:`ed package outside the profile. A page reload alone can serve stale client code.

**Consequence for contributors:** always verify a client change after a Harness restart, not after an F5.
