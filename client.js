/**
 * Client half of the Blender bridge: a dedicated monitor panel for the centre
 * column, laid out the way a video editor pairs its viewers.
 *
 *   ┌─ rail ─┐ ┌──────────────────────────────────────────────────────────┐
 *   │  ▣     │ │ ● BLENDER MONITOR airframe.blend CYCLES 741 obj    ✕ Chat│
 *   │        │ ├──────────────────────────┬───────────────────────────────┤
 *   │        │ │ REFERENCE      ◀ ▶ ⏺     │ LIVE PROGRAM             ● LIVE│
 *   │        │ │ ┌──────────────────────┐ │ ┌───────────────────────────┐ │
 *   │        │ │ │ the drawing matched  │ │ │ the live Blender viewport │ │
 *   │        │ │ └──────────────────────┘ │ └───────────────────────────┘ │
 *   │        │ ├──────────────────────────┴───────────────────────────────┤
 *   │        │ │ ⏸ ⟳ 00:12:34 #07 ━░░ 174 ms  1s 2s 4s 8s               │
 *   └────────┘ └──────────────────────────────────────────────────────────┘
 *
 * Two seats, both additive and both ordinary layout — no floating, no portals:
 *
 * - `main` keyed `blender-live`: the panel itself, chosen by `selectPanel`.
 * - `sidebar.panellist`: the left-rail button that selects that panel.
 *
 * `Esc` (or the ✕ button) returns to the conversation. The Host does all
 * Blender work and serves both images; this module owns cadence, visibility and
 * presentation. Captures stop while the tab is hidden or capture is paused, so
 * Blender's main thread is never rendered on behind the user's back, and a
 * failed frame backs off to a slow retry and shows "NO SIGNAL".
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-blender-live',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NAMESPACE = 'dshBlenderLive'
    const PANEL_KEY = 'blender-live'
    const TEXT = {
      monitor: 'Blender monitor',
      open: 'Open the Blender monitor',
      backToChat: 'Back to chat',
      reference: 'Reference',
      program: 'Live program',
      live: 'LIVE',
      paused: 'PAUSED',
      offline: 'NO SIGNAL',
      offlineHint: 'Blender is not reachable on port 9876',
      noReference: 'NO REFERENCE',
      noReferenceHint: 'ask DSH to set one, or ⏺ pin the live frame',
      pin: 'Pin the current frame as the reference',
      previous: 'Previous reference image',
      next: 'Next reference image',
      pause: 'Pause capture',
      resume: 'Resume capture',
      step: 'Capture one frame now',
      altLive: 'Live Blender 3D viewport',
      altReference: 'Reference image being matched',
      rate: 'Capture rate',
      objects: 'object count',
      latency: 'last capture',
      frame: 'scene frame',
      hint: 'Escape or ✕ returns to the conversation.',
    }

    const BASE = (() => {
      try {
        return new URL('/x-blender-live/', window.location.origin).href
      } catch {
        return '/x-blender-live/'
      }
    })()
    const FRAME_URL = `${BASE}frame.jpg`
    const STATUS_URL = `${BASE}status`
    const REFERENCE_URL = `${BASE}reference`

    /** Capture cadence in milliseconds, fastest-first for the transport order. */
    const RATES = [
      { ms: 1000, label: '1s' },
      { ms: 2000, label: '2s' },
      { ms: 4000, label: '4s' },
      { ms: 8000, label: '8s' },
    ]
    const DEFAULT_RATE = 2000
    const RETRY_MS = 6000
    const STATUS_MS = 8000
    const MATTE = '#0a0c0e'
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

    const PANEL_CSS = `
@keyframes dshBlvSweep { from { width: 0% } to { width: 100% } }
.dsh-blv-sweep { animation-name: dshBlvSweep; animation-timing-function: linear; animation-fill-mode: forwards; }
.dsh-blv-split { display: flex; flex-direction: row; align-items: stretch; }
.dsh-blv-pane { flex: 1 1 50%; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsh-blv-pane + .dsh-blv-pane { border-left: 1px solid var(--dsw-alias-border-l1); }
.dsh-blv-rail { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-blv-rail:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
@media (max-width: 820px) {
  .dsh-blv-split { flex-direction: column; }
  .dsh-blv-pane + .dsh-blv-pane { border-left: none; border-top: 1px solid var(--dsw-alias-border-l1); }
}
@media (prefers-reduced-motion: reduce) { .dsh-blv-sweep { animation: none; width: 100% } }
`

    function pad(value) {
      return String(value).padStart(2, '0')
    }

    function timecode(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
    }

    function chipStyle() {
      return {
        flex: '0 0 auto',
        fontSize: 10,
        lineHeight: '15px',
        letterSpacing: 0.3,
        padding: '0 6px',
        borderRadius: 4,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        fontFamily: MONO,
        whiteSpace: 'nowrap',
      }
    }

    function buttonStyle(extra) {
      return Object.assign({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        minWidth: 24,
        height: 22,
        padding: '0 7px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 11,
        lineHeight: 1,
        cursor: 'pointer',
      }, extra)
    }

    function activeStyle() {
      return {
        borderColor: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-brand-primary)',
      }
    }

    function statusColor(state) {
      if (state === 'offline') return 'var(--dsw-alias-state-error-primary)'
      if (state === 'live') return 'var(--dsw-alias-state-success-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    function monitorIcon(size, color) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        'aria-hidden': true,
        style: { display: 'block' },
      }, [
        h('rect', {
          key: 'frame',
          x: 4,
          y: 12,
          width: 56,
          height: 40,
          rx: 7,
          fill: 'none',
          stroke: color,
          strokeWidth: 5,
        }),
        h('path', { key: 'play', d: 'M22 24.5 41 32 22 39.5Z', fill: color }),
      ])
    }

    function openPanel(layout) {
      try {
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_KEY)
      } catch {
        /* this shell refuses the key; the compact viewer still works */
      }
    }

    function paneHead(children) {
      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 24,
          padding: '1px 9px',
          background: 'var(--dsw-alias-bg-layer-1)',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
      }, children)
    }

    function paneLabel(text) {
      return {
        flex: '0 0 auto',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      }
    }

    /** The panel bound to a translate function and the layout service. */
    function createMonitorPanel(t, layout, options) {
      const compact = Boolean(options && options.compact)
      const leave = () => {
        try {
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
        } catch {
          /* stay where we are */
        }
      }

      return function MonitorPanel() {
        const [paused, setPaused] = useState(false)
        const [rate, setRate] = useState(DEFAULT_RATE)
        const [nonce, setNonce] = useState(() => Date.now())
        const [force, setForce] = useState(false)
        const [failed, setFailed] = useState(false)
        const [hidden, setHidden] = useState(() => Boolean(document.hidden))
        const [info, setInfo] = useState(null)
        const [frames, setFrames] = useState(0)
        const [clock, setClock] = useState(() => Date.now())
        const startedAt = useRef(Date.now())
        const mounted = useRef(true)

        useEffect(() => {
          mounted.current = true
          return () => { mounted.current = false }
        }, [])

        // Esc leaves the panel for the conversation.
        useEffect(() => {
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            const tag = event.target && event.target.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            leave()
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [])

        useEffect(() => {
          const onChange = () => setHidden(Boolean(document.hidden))
          document.addEventListener('visibilitychange', onChange)
          return () => document.removeEventListener('visibilitychange', onChange)
        }, [])

        const capturing = !paused && !hidden

        useEffect(() => {
          if (!capturing) return undefined
          const delay = failed ? RETRY_MS : rate
          const id = window.setInterval(() => setNonce(Date.now()), delay)
          return () => window.clearInterval(id)
        }, [capturing, failed, rate])

        useEffect(() => {
          const id = window.setInterval(() => setClock(Date.now()), 1000)
          return () => window.clearInterval(id)
        }, [])

        const loadStatus = useCallback(async () => {
          try {
            const response = await fetch(STATUS_URL, { credentials: 'same-origin' })
            if (!response.ok) return
            const body = await response.json()
            if (mounted.current) setInfo(body)
          } catch {
            /* the frame route already reports outages; stale status is harmless */
          }
        }, [])

        useEffect(() => {
          loadStatus()
          const id = window.setInterval(loadStatus, STATUS_MS)
          return () => window.clearInterval(id)
        }, [loadStatus])

        const referenceAction = useCallback(async (path) => {
          try {
            await fetch(`${REFERENCE_URL}${path}`, { method: 'POST', credentials: 'same-origin' })
          } catch {
            /* the pane keeps showing what it had */
          }
          loadStatus()
        }, [loadStatus])

        const onFrameError = useCallback(() => {
          setFailed(true)
          setForce(false)
        }, [])

        const onFrameLoad = useCallback(() => {
          setFailed(false)
          setForce(false)
          setFrames((value) => value + 1)
        }, [])

        const captureNow = useCallback(() => {
          setForce(true)
          setNonce(Date.now())
        }, [])

        const state = failed ? 'offline' : (capturing ? 'live' : 'paused')
        const frameSrc = `${FRAME_URL}?w=1600&h=900${force ? '&force=1' : ''}&n=${nonce}`
        const reference = info && info.reference && info.reference.ok ? info.reference : null
        const referenceSrc = reference ? `${REFERENCE_URL}?v=${reference.mtime}` : ''
        const latency = info && Number(info.captureMs) > 0 ? `${Math.round(info.captureMs)} ms` : ''
        const source = info && info.blend ? info.blend : ''
        const facts = [
          info && info.engine ? String(info.engine) : '',
          info && Number(info.objects) > 0 ? `${info.objects} obj` : '',
          Number.isFinite(Number(info && info.frame)) && info && info.servedAt ? `f ${pad(Number(info.frame))}` : '',
        ].filter(Boolean).join(' · ')

        return h('div', {
          title: t('hint'),
          style: compact
            ? {
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              maxWidth: 980,
              margin: '0 auto 4px',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 9,
              overflow: 'hidden',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
            }
            : {
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: '58vh',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
            },
        }, [
          h('style', { key: 'css' }, PANEL_CSS),

          // ---- header -----------------------------------------------------
          h('div', {
            key: 'header',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              rowGap: 4,
              padding: '6px 10px',
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
            },
          }, [
            h('span', {
              key: 'dot',
              'aria-hidden': true,
              style: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: statusColor(state) },
            }),
            h('span', {
              key: 'title',
              style: {
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              },
            }, t('monitor')),
            source
              ? h('span', {
                key: 'source',
                title: source,
                style: {
                  flex: '1 1 140px',
                  minWidth: 0,
                  fontSize: 11,
                  color: 'var(--dsw-alias-label-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }, source)
              : h('span', { key: 'grow', style: { flex: '1 1 auto' } }),
            info && info.engine ? h('span', { key: 'engine', style: chipStyle() }, String(info.engine)) : null,
            info && Number(info.objects) > 0
              ? h('span', { key: 'objects', title: t('objects'), style: chipStyle() }, `${info.objects} obj`)
              : null,
            facts && Number.isFinite(Number(info && info.frame)) && info && info.servedAt
              ? h('span', { key: 'frame', title: t('frame'), style: chipStyle() }, `f ${pad(Number(info.frame))}`)
              : null,
            compact
              ? h('button', {
                key: 'expand',
                type: 'button',
                onClick: () => openPanel(layout),
                title: t('open'),
                'aria-label': t('open'),
                style: buttonStyle({ marginLeft: 'auto' }),
              }, '⤢')
              : h('button', {
                key: 'back',
                type: 'button',
                onClick: leave,
                title: t('backToChat'),
                'aria-label': t('backToChat'),
                style: buttonStyle({ marginLeft: 'auto' }),
              }, ['✕ ', t('backToChat')]),
          ]),

          // ---- the two viewers --------------------------------------------
          h('div', { key: 'viewers', className: 'dsh-blv-split', style: { flex: '1 1 auto', minHeight: 0 } }, [
            h('div', { key: 'ref', className: 'dsh-blv-pane' }, [
              paneHead([
                h('span', { key: 'l', style: paneLabel(t('reference')) }, t('reference')),
                h('span', {
                  key: 'name',
                  title: reference ? reference.label : '',
                  style: {
                    flex: '1 1 auto',
                    minWidth: 0,
                    fontSize: 10.5,
                    color: 'var(--dsw-alias-label-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }, reference ? reference.label : ''),
                h('button', {
                  key: 'prev',
                  type: 'button',
                  onClick: () => referenceAction('/step?dir=-1'),
                  title: t('previous'),
                  'aria-label': t('previous'),
                  style: buttonStyle({ minWidth: 20, height: 18, padding: '0 4px' }),
                }, '◀'),
                h('button', {
                  key: 'next',
                  type: 'button',
                  onClick: () => referenceAction('/step?dir=1'),
                  title: t('next'),
                  'aria-label': t('next'),
                  style: buttonStyle({ minWidth: 20, height: 18, padding: '0 4px' }),
                }, '▶'),
                h('button', {
                  key: 'pin',
                  type: 'button',
                  onClick: () => referenceAction('/pin'),
                  title: t('pin'),
                  'aria-label': t('pin'),
                  style: buttonStyle({
                    minWidth: 20,
                    height: 18,
                    padding: '0 4px',
                    color: 'var(--dsw-alias-state-error-primary)',
                  }),
                }, '⏺'),
              ]),
              h('div', {
                key: 'body',
                style: {
                  position: 'relative',
                  flex: compact ? '0 0 auto' : '1 1 auto',
                  height: compact ? 116 : undefined,
                  minHeight: 0,
                  background: MATTE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                },
              }, reference
                ? h('img', {
                  key: 'img',
                  src: referenceSrc,
                  alt: t('altReference'),
                  draggable: false,
                  style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain', background: MATTE },
                })
                : h('div', {
                  key: 'empty',
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 12px',
                    textAlign: 'center',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                }, [
                  h('span', { key: 'a', style: { fontFamily: MONO, fontSize: 11, letterSpacing: 2.2 } }, t('noReference')),
                  h('span', { key: 'b', style: { fontSize: 11, opacity: 0.85 } }, t('noReferenceHint')),
                ])),
            ]),

            h('div', { key: 'live', className: 'dsh-blv-pane' }, [
              paneHead([
                h('span', { key: 'l', style: paneLabel(t('program')) }, t('program')),
                h('span', { key: 'sp', style: { flex: '1 1 auto' } }),
                latency
                  ? h('span', {
                    key: 'latency',
                    title: t('latency'),
                    style: { fontFamily: MONO, fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)' },
                  }, latency)
                  : null,
                h('span', {
                  key: 'state',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: 1,
                    color: statusColor(state),
                    whiteSpace: 'nowrap',
                  },
                }, [
                  h('span', {
                    key: 'd',
                    'aria-hidden': true,
                    style: { width: 5, height: 5, borderRadius: '50%', background: statusColor(state) },
                  }),
                  h('span', { key: 'x' }, state === 'offline' ? t('offline') : state === 'live' ? t('live') : t('paused')),
                ]),
              ]),
              h('div', {
                key: 'body',
                style: {
                  position: 'relative',
                  flex: compact ? '0 0 auto' : '1 1 auto',
                  height: compact ? 116 : undefined,
                  minHeight: 0,
                  background: MATTE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                },
              }, [
                h('img', {
                  key: 'img',
                  src: frameSrc,
                  alt: t('altLive'),
                  draggable: false,
                  onError: onFrameError,
                  onLoad: onFrameLoad,
                  style: {
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: MATTE,
                    opacity: state === 'paused' ? 0.85 : 1,
                  },
                }),
                state === 'offline'
                  ? h('div', {
                    key: 'nosignal',
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '0 12px',
                      textAlign: 'center',
                      background: MATTE,
                      color: 'var(--dsw-alias-label-secondary)',
                      pointerEvents: 'none',
                    },
                  }, [
                    h('span', {
                      key: 'a',
                      style: {
                        fontFamily: MONO,
                        fontSize: 12,
                        letterSpacing: 3,
                        color: 'var(--dsw-alias-state-error-primary)',
                      },
                    }, t('offline')),
                    h('span', { key: 'b', style: { fontSize: 11, opacity: 0.85 } }, t('offlineHint')),
                  ])
                  : null,
              ]),
            ]),
          ]),

          // ---- transport --------------------------------------------------
          h('div', {
            key: 'transport',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              rowGap: 6,
              padding: '6px 10px',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
            },
          }, [
            h('button', {
              key: 'play',
              type: 'button',
              onClick: () => setPaused((value) => !value),
              title: paused ? t('resume') : t('pause'),
              'aria-label': paused ? t('resume') : t('pause'),
              'aria-pressed': paused,
              style: buttonStyle({ minWidth: 30 }),
            }, paused ? '▶' : '❚❚'),
            h('button', {
              key: 'step',
              type: 'button',
              onClick: captureNow,
              title: t('step'),
              'aria-label': t('step'),
              style: buttonStyle(),
            }, '⟳'),
            h('span', {
              key: 'tc',
              style: {
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: 0.6,
                whiteSpace: 'nowrap',
                padding: '0 2px',
              },
            }, timecode(clock - startedAt.current)),
            h('span', {
              key: 'frames',
              style: { fontFamily: MONO, fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
            }, `#${pad(frames)}`),
            h('span', {
              key: 'meter',
              'aria-hidden': true,
              style: {
                flex: '1 1 120px',
                minWidth: 60,
                height: 3,
                borderRadius: 2,
                background: 'var(--dsw-alias-border-l1)',
                overflow: 'hidden',
              },
            }, state === 'live'
              ? h('span', {
                key: `fill-${nonce}`,
                className: 'dsh-blv-sweep',
                style: {
                  display: 'block',
                  height: '100%',
                  width: '0%',
                  background: 'var(--dsw-alias-state-success-primary)',
                  animationDuration: `${rate}ms`,
                },
              })
              : h('span', {
                key: 'fill-idle',
                style: {
                  display: 'block',
                  height: '100%',
                  width: state === 'offline' ? '100%' : '0%',
                  background: state === 'offline'
                    ? 'var(--dsw-alias-state-error-primary)'
                    : 'var(--dsw-alias-state-idle-primary)',
                  opacity: 0.55,
                },
              })),
            h('span', {
              key: 'rates',
              role: 'group',
              'aria-label': t('rate'),
              style: { display: 'inline-flex', gap: 3, marginLeft: 'auto' },
            }, RATES.map((entry) => h('button', {
              key: `rate-${entry.ms}`,
              type: 'button',
              onClick: () => setRate(entry.ms),
              'aria-pressed': entry.ms === rate,
              title: `${t('rate')}: ${entry.label}`,
              style: buttonStyle(entry.ms === rate ? activeStyle() : { height: 20, padding: '0 5px' }),
            }, entry.label))),
          ]),
        ])
      }
    }

    /** The left-rail button that opens the panel. */
    function createRailButton(t, layout) {
      return function RailButton() {
        return h('button', {
          type: 'button',
          className: 'dsh-blv-rail',
          onClick: () => openPanel(layout),
          title: t('open'),
          'aria-label': t('open'),
        }, monitorIcon(17, 'currentColor'))
      }
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        // English dictionary; locale lookup walks the fallback chain up to
        // English, so a non-English UI shows these strings, not missing keys.
        let t = (key) => TEXT[key] ?? key
        try {
          ctx.effect(() => ctx.locale.register(NAMESPACE, 'en', TEXT))
          t = ctx.locale.bind(NAMESPACE)
        } catch {
          // A locale problem must not cost the panel: the dictionary above still
          // renders every label.
        }

        const layout = ctx.layout

        // Normal layout seats only: the panel body and its rail trigger. Both are
        // additive — `main` gains a key and the rail gains an icon — and neither
        // floats over shipped UI, which is what made the corner variant flaky.
        // Two seats. `conversation.input.dock` is the one that has painted on
        // every load in this shell, so the viewer lives there in a compact form
        // that cannot push the composer off-screen; the full-size panel is
        // registered under its own `main` key for when the panel can be opened.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: PANEL_KEY,
          order: 2,
        }, createMonitorPanel(t, layout, { compact: true })))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_KEY,
        }, createMonitorPanel(t, layout)))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_KEY,
          order: 50,
          label: () => t('monitor'),
        }, createRailButton(t, layout)))
      },
    }
  },
})
