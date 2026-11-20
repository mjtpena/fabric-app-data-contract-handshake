/**
 * The transit map (SVG). Lines are contracts drawn octilinear with parallel lanes, stations are consumer teams
 * (interchange capsules where several lines stop), terminals are the producers, and every open change notice is a
 * train waiting at its terminal with a departure countdown. Lenses re-paint the same map; pending signals travel down
 * the line toward the station that still has to answer. Drag to pan, wheel or the buttons to zoom; selecting a thing
 * flies the camera to it. Reduced motion: no pulses or blinking, and the camera jumps instead of flying.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';

import { IconButton, cx, useHotkeys, useReducedMotion } from '@x10/shared/ui';

import { buildGeometry, pointAt, roundedPath, truncate, type Geometry } from './geometry';
import { layoutNetwork, type Pt } from './layout';
import { countdown, departureColor, remarkMeta, signalMeta, typeColor } from './meta';
import type { FocusTarget, LensKey, NetLine, NetService, Network } from './network';

type Box = { x: number; y: number; w: number; h: number };
type Insets = { top: number; right: number; bottom: number; left: number };

export interface MetroMapProps {
  net: Network;
  lens: LensKey;
  focus: FocusTarget | null;
  onFocus: (t: FocusTarget | null) => void;
  /** Lines and stations lit by the current perspective (view as). */
  lit: { lines: Set<string>; stations: Set<string> };
  /** Screen space covered by floating panels, kept clear when fitting (px). */
  insets?: Partial<Insets>;
  className?: string;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function fitBox(target: Box, W: number, H: number, insets: Insets, maxScale = 1.35): Box {
  const aw = Math.max(40, W - insets.left - insets.right);
  const ah = Math.max(40, H - insets.top - insets.bottom);
  const s = Math.min(aw / Math.max(1, target.w), ah / Math.max(1, target.h), maxScale);
  const w = W / s;
  const h = H / s;
  const x = target.x + target.w / 2 - (insets.left + aw / 2) / s;
  const y = target.y + target.h / 2 - (insets.top + ah / 2) / s;
  return { x, y, w, h };
}

function bboxOf(points: Pt[], pad = 0): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

function trainColor(lens: LensKey, svc: NetService): string {
  if (lens === 'type') return typeColor[svc.notice.changeType];
  if (lens === 'departure') return departureColor(svc.health.daysLeft);
  if (svc.health.health === 'waiting') return 'var(--world-ink)';
  return remarkMeta[svc.health.health].color;
}

function lineStroke(lens: LensKey, l: NetLine): string {
  if (lens === 'type') return l.severestType ? typeColor[l.severestType] : 'var(--gray-7)';
  return l.color;
}

export function MetroMap({ net, lens, focus, onFocus, lit, insets: insetsProp, className }: MetroMapProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hover, setHover] = useState<FocusTarget | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const portrait = size.w > 0 && size.w / Math.max(1, size.h) < 0.95;
  const font = size.w > 0 && size.w < 560 ? 15 : 14;
  const structure = JSON.stringify(net.lines.map((l) => [l.id, l.stationKeys]));

  const layout = useMemo(
    () =>
      layoutNetwork(
        net.lines.map((l) => ({ id: l.id, stations: l.stationKeys })),
        // seeded by names, not ids, so the same network always draws the same map
        { aspect: portrait ? 0.62 : 1.1, seedKey: net.lines.map((l) => `${l.contract.name}:${l.stationKeys.join(',')}`).join('|') },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure, portrait],
  );
  const names = JSON.stringify([net.lines.map((l) => [l.contract.name, l.contract.producerTeam, l.services.length]), net.stations.map((s) => s.name)]);
  const geo: Geometry = useMemo(
    () =>
      buildGeometry({
        layout,
        font,
        contain: font >= 15 ? 0.25 : 0,
        lines: net.lines.map((l) => ({ id: l.id, name: l.contract.name, sub: l.contract.producerTeam, stations: l.stationKeys, trains: l.services.length })),
        stations: net.stations.map((s) => ({ key: s.key, name: s.name })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, font, names],
  );

  const insets: Insets = {
    top: insetsProp?.top ?? 24,
    right: insetsProp?.right ?? 24,
    bottom: insetsProp?.bottom ?? 24,
    left: insetsProp?.left ?? 24,
  };
  const insetKey = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;

  /* ------------------------------------------------------------ camera */

  const [vb, setVb] = useState<Box>({ x: 0, y: 0, w: 800, h: 500 });
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const anim = useRef(0);
  const flyTo = useCallback(
    (to: Box, instant = false) => {
      cancelAnimationFrame(anim.current);
      if (instant || reduced) {
        setVb(to);
        return;
      }
      const from = vbRef.current;
      const t0 = performance.now();
      const dur = 700;
      const step = (t: number) => {
        const k = ease(Math.min(1, (t - t0) / dur));
        setVb({
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          w: from.w + (to.w - from.w) * k,
          h: from.h + (to.h - from.h) * k,
        });
        if (k < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [reduced],
  );
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  const phone = size.w > 0 && size.w < 560;
  const fitAll = useCallback(() => {
    if (!size.w || !size.h) return null;
    if (phone) {
      // phones: fit the track, not the labels, so names stay readable; drag to see the rest
      const pts: Pt[] = [...[...geo.lines.values()].flatMap((g) => g.points), ...[...geo.terminals.values()].map((t) => t.center)];
      return fitBox(bboxOf(pts, 28), size.w, size.h, insets, 1.1);
    }
    return fitBox(geo.bbox, size.w, size.h, insets, 1.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, size.w, size.h, insetKey]);

  const focusBox = useCallback((): Box | null => {
    if (!focus || !size.w) return null;
    let pts: Pt[] = [];
    if (focus.kind === 'station') {
      const g = geo.stations.get(focus.id);
      if (!g) return null;
      pts = [g.center, { x: g.label.x, y: g.label.y }, { x: g.label.x + g.label.w, y: g.label.y + g.label.h }];
      const lines = net.stations.find((s) => s.key === focus.id)?.lineIds ?? [];
      for (const id of lines) {
        const t = geo.terminals.get(id);
        if (t) pts.push(t.center);
      }
      return fitBox(bboxOf(pts, 60), size.w, size.h, insets, 1.3);
    }
    const lineId = focus.kind === 'line' ? focus.id : net.services.find((s) => s.id === focus.id)?.lineId;
    const lg = lineId ? geo.lines.get(lineId) : null;
    const tg = lineId ? geo.terminals.get(lineId) : null;
    if (!lg || !tg) return null;
    pts = [...lg.points, { x: tg.label.x, y: tg.label.y }, { x: tg.label.x + tg.label.w, y: tg.label.y + tg.label.h }];
    for (const key of net.lines.find((l) => l.id === lineId)?.stationKeys ?? []) {
      const sg = geo.stations.get(key);
      if (sg) pts.push({ x: sg.label.x, y: sg.label.y }, { x: sg.label.x + sg.label.w, y: sg.label.y + sg.label.h });
    }
    return fitBox(bboxOf(pts, 40), size.w, size.h, insets, 1.4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.kind, focus?.id, geo, size.w, size.h, insetKey, net]);

  // first frame and resizes: jump; focus changes: fly
  const first = useRef(true);
  useEffect(() => {
    const target = focusBox() ?? fitAll();
    if (!target) return;
    flyTo(target, first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.kind, focus?.id, geo, size.w, size.h, insetKey]);

  const zoomBy = useCallback(
    (k: number, around?: Pt) => {
      const v = vbRef.current;
      const fit = fitAll();
      const minW = (fit?.w ?? v.w) / 5;
      const maxW = (fit?.w ?? v.w) * 1.8;
      const w = Math.max(minW, Math.min(maxW, v.w * k));
      const kk = w / v.w;
      const c = around ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      flyTo({ x: c.x - (c.x - v.x) * kk, y: c.y - (c.y - v.y) * kk, w, h: v.h * kk }, true);
    },
    [fitAll, flyTo],
  );

  useHotkeys({
    '=': () => zoomBy(0.8),
    '+': () => zoomBy(0.8),
    '-': () => zoomBy(1.25),
    '0': () => {
      const f = fitAll();
      if (f) flyTo(f);
    },
  });

  const toSvg = (clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = vbRef.current;
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.pow(1.0018, e.deltaY), toSvg(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const drag = useRef<{ x: number; y: number; vb: Box; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vb: vbRef.current, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) svgRef.current?.setPointerCapture(e.pointerId);
    d.moved = true;
    cancelAnimationFrame(anim.current);
    const r = svgRef.current!.getBoundingClientRect();
    setVb({ ...d.vb, x: d.vb.x - (dx / r.width) * d.vb.w, y: d.vb.y - (dy / r.height) * d.vb.h });
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      svgRef.current?.releasePointerCapture(e.pointerId);
      // swallow the click that ends a drag
      const stop = (ev: Event) => ev.stopPropagation();
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    }
  };

  /* ------------------------------------------------------------ emphasis */

  const em = hover ?? focus;
  const emLines = useMemo(() => {
    if (!em) return null;
    if (em.kind === 'line') return new Set([em.id]);
    if (em.kind === 'service') {
      const s = net.services.find((x) => x.id === em.id);
      return new Set(s ? [s.lineId] : []);
    }
    return new Set(net.stations.find((s) => s.key === em.id)?.lineIds ?? []);
  }, [em, net]);
  const lineActive = (id: string) => lit.lines.has(id) && (!emLines || emLines.has(id));
  const stationLevel = (key: string): number => {
    const st = net.stations.find((s) => s.key === key);
    const onActive = st?.lineIds.some(lineActive) ?? false;
    if (em?.kind === 'station') return em.id === key ? 1 : onActive ? 0.6 : 0.16;
    if (lit.stations.has(key) && onActive) return 1;
    return onActive ? 0.6 : 0.16;
  };

  const lineById = useMemo(() => new Map(net.lines.map((l) => [l.id, l])), [net]);

  const act = (t: FocusTarget) => ({
    role: 'button' as const,
    tabIndex: 0,
    style: { cursor: 'pointer' },
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onFocus(focus && focus.kind === t.kind && focus.id === t.id ? null : t);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onFocus(t);
      }
    },
    onPointerEnter: () => setHover(t),
    onPointerLeave: () => setHover((h) => (h && h.kind === t.kind && h.id === t.id ? null : h)),
    onFocus: () => setHover(t),
    onBlur: () => setHover(null),
    'aria-pressed': !!focus && focus.kind === t.kind && focus.id === t.id,
  });

  const showPulses = !reduced && (lens === 'signal' || lens === 'team');
  const halo = 'var(--world-sky)';
  const ink = 'var(--world-ink)';

  /* ------------------------------------------------------------ trains along each line */

  const trains = useMemo(() => {
    const out: { svc: NetService; line: NetLine; p: Pt; dir: Pt; labelAt: Pt }[] = [];
    for (const l of net.lines) {
      const g = geo.lines.get(l.id);
      if (!g || !l.services.length) continue;
      const firstStop = Math.min(...[...g.stationAt.values()], g.length);
      const s0 = 34;
      const room = Math.max(0, firstStop - 26 - s0);
      const gap = l.services.length > 1 ? Math.max(30, Math.min(40, room / (l.services.length - 1))) : 0;
      l.services.forEach((svc, k) => {
        const { p, dir } = pointAt(g.points, s0 + k * gap);
        // label on the side of the line facing up (or right for vertical track)
        let n = { x: -dir.y, y: dir.x };
        if (n.y > 0.01 || (Math.abs(n.y) <= 0.01 && n.x < 0)) n = { x: -n.x, y: -n.y };
        out.push({ svc, line: l, p, dir, labelAt: { x: p.x + n.x * 17, y: p.y + n.y * 17 } });
      });
    }
    return out;
  }, [net, geo]);

  /* ------------------------------------------------------------ render */

  const lineW = 8.5;
  const casing = 13;

  return (
    <div ref={wrap} className={cx('absolute inset-0', className)}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full select-none"
        style={{ touchAction: 'none', cursor: drag.current?.moved ? 'grabbing' : 'grab' }}
        role="group"
        aria-label={`Transit map: ${net.lines.length} lines, ${net.stations.length} stations, ${net.services.length} services running`}
        data-testid="metro-map"
        data-lens={lens}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClick={() => onFocus(null)}
      >
        <defs>
          <pattern id={`${uid}-dots`} width={26} height={26} patternUnits="userSpaceOnUse">
            <circle cx={1.2} cy={1.2} r={1.2} fill="var(--world-grid)" />
          </pattern>
          <linearGradient id={`${uid}-comet`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--warn-solid)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--warn-solid)" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <rect x={vb.x - 2000} y={vb.y - 2000} width={vb.w + 4000} height={vb.h + 4000} fill={`url(#${uid}-dots)`} pointerEvents="none" />

        {/* focus glow under the focused line */}
        {emLines &&
          [...emLines].map((id) => {
            const g = geo.lines.get(id);
            const l = lineById.get(id);
            if (!g || !l || !lit.lines.has(id)) return null;
            return (
              <path key={`glow-${id}`} d={g.d} fill="none" stroke={lineStroke(lens, l)} strokeOpacity={0.18} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
            );
          })}

        {/* casings, then colours, so crossings read cleanly */}
        {net.lines.map((l) => {
          const g = geo.lines.get(l.id);
          if (!g || g.stub) return null;
          return <path key={`c-${l.id}`} d={g.d} fill="none" stroke={halo} strokeWidth={casing} strokeLinecap="round" strokeLinejoin="round" className="dch-map-dim" opacity={lineActive(l.id) ? 1 : 0.5} />;
        })}
        {net.lines.map((l) => {
          const g = geo.lines.get(l.id);
          if (!g) return null;
          const active = lineActive(l.id);
          const op = !active ? 0.14 : lens === 'departure' ? 0.38 : 1;
          if (g.stub) {
            const { from, to } = g.stub;
            const dir = { x: (to.x - from.x) / g.length, y: (to.y - from.y) / g.length };
            const n = { x: -dir.y * 9, y: dir.x * 9 };
            return (
              <g key={`l-${l.id}`} className="dch-map-dim" opacity={op} {...act({ kind: 'line', id: l.id })} aria-label={`${l.contract.name} line, no stations`}>
                <title>{`${l.contract.name}: no consumer teams registered`}</title>
                <path d={`M${from.x},${from.y}L${to.x},${to.y}`} stroke={lineStroke(lens, l)} strokeWidth={lineW} strokeDasharray="2 9" strokeLinecap="round" />
                <path d={`M${to.x - n.x},${to.y - n.y}L${to.x + n.x},${to.y + n.y}`} stroke={ink} strokeWidth={3} strokeLinecap="round" />
              </g>
            );
          }
          return (
            <path
              key={`l-${l.id}`}
              d={g.d}
              fill="none"
              stroke={lineStroke(lens, l)}
              strokeWidth={focus?.kind === 'line' && focus.id === l.id ? lineW + 2 : lineW}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="dch-map-dim"
              opacity={op}
              {...act({ kind: 'line', id: l.id })}
              aria-label={`${l.contract.name} line`}
              data-testid="map-line"
              data-line={l.contract.name}
            >
              <title>{`${l.contract.name} · ${l.contract.producerTeam}`}</title>
            </path>
          );
        })}

        {/* pending signals travelling down the line to the station that still has to answer */}
        {showPulses &&
          net.lines.flatMap((l) => {
            const g = geo.lines.get(l.id);
            if (!g || !lineActive(l.id) || !l.services.length) return [];
            return l.stops
              .filter((s) => s.pending > 0)
              .map((s, i) => {
                const at = g.stationAt.get(s.stationKey);
                if (at === undefined) return null;
                const d = roundedPath(truncate(g.points, at));
                const dur = Math.max(1.8, at / 110);
                return (
                  <g key={`p-${l.id}-${s.stationKey}`} pointerEvents="none">
                    <g>
                      <animateMotion dur={`${dur}s`} begin={`${-(i * 0.7)}s`} repeatCount="indefinite" path={d} rotate="auto" />
                      <rect x={-22} y={-2.5} width={24} height={5} rx={2.5} fill={`url(#${uid}-comet)`} />
                      <circle r={3} fill="var(--world-glow)" stroke="var(--warn-solid)" strokeWidth={1.2} />
                    </g>
                  </g>
                );
              });
          })}

        {/* stations */}
        {net.stations.map((st) => {
          const g = geo.stations.get(st.key);
          if (!g) return null;
          const level = stationLevel(st.key);
          const m = g.marker;
          const focused = focus?.kind === 'station' && focus.id === st.key;
          const ext = m.length > 1 ? Math.hypot(m[m.length - 1].x - m[0].x, m[m.length - 1].y - m[0].y) / 2 : 0;
          const capsule = m.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
          const summary = st.stops
            .map((s) => `${lineById.get(s.lineId)?.contract.name}: ${signalMeta[s.signal].label.toLowerCase()}`)
            .join('; ');
          return (
            <g
              key={`s-${st.key}`}
              className="dch-map-dim"
              opacity={level}
              {...act({ kind: 'station', id: st.key })}
              aria-label={`${st.name} station${st.lineIds.length > 1 ? ', interchange' : ''}. ${summary}`}
              data-testid="map-station"
              data-station={st.name}
            >
              <title>{`${st.name}\n${summary}`}</title>
              {lens === 'team' && st.pending > 0 && (
                <circle cx={g.center.x} cy={g.center.y} r={ext + 16 + Math.sqrt(st.pending) * 9} fill="var(--accent-9)" fillOpacity={0.14} stroke="var(--accent-9)" strokeOpacity={0.45} strokeWidth={1.5} />
              )}
              {focused && (
                <circle cx={g.center.x} cy={g.center.y} r={ext + 19} fill="none" stroke="var(--accent-9)" strokeWidth={2.5} strokeDasharray="5 5">
                  {!reduced && <animateTransform attributeName="transform" type="rotate" from={`0 ${g.center.x} ${g.center.y}`} to={`360 ${g.center.x} ${g.center.y}`} dur="12s" repeatCount="indefinite" />}
                </circle>
              )}
              <g data-testid="station-marker">
                {m.length > 1 ? (
                  <>
                    <path d={capsule} stroke={ink} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <path d={capsule} stroke="var(--surface)" strokeWidth={15.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </>
                ) : (
                  <circle cx={m[0].x} cy={m[0].y} r={8.5} fill="var(--surface)" stroke={ink} strokeWidth={3.25} />
                )}
              </g>
              {lens === 'signal' &&
                st.stops.map((s) => {
                  const p = g.lamps.get(s.lineId);
                  if (!p) return null;
                  const sm = signalMeta[s.signal];
                  return (
                    <circle key={s.lineId} cx={p.x} cy={p.y} r={s.signal === 'none' ? 2.8 : 5} fill={sm.color} className={s.signal === 'pending' && !reduced ? 'dch-train-lamp' : undefined}>
                      <title>{`${lineById.get(s.lineId)?.contract.name}: ${sm.label}`}</title>
                    </circle>
                  );
                })}
              {lens === 'team' && st.pending > 0 && (
                <g>
                  <circle cx={g.center.x + ext + 11} cy={g.center.y - 13} r={9.5} fill="var(--accent-9)" stroke={halo} strokeWidth={2} />
                  <text x={g.center.x + ext + 11} y={g.center.y - 9.2} textAnchor="middle" fill="var(--accent-contrast)" style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {st.pending}
                  </text>
                </g>
              )}
              <text
                x={g.label.tx}
                y={g.label.ty + font * 0.98}
                textAnchor={g.label.anchor}
                fill={ink}
                stroke={halo}
                strokeWidth={4}
                paintOrder="stroke"
                strokeLinejoin="round"
                style={{ fontSize: font, fontWeight: focused ? 700 : 600, letterSpacing: '-0.005em' }}
              >
                {st.name}
              </text>
            </g>
          );
        })}

        {/* terminals: the producers */}
        {net.lines.map((l) => {
          const t = geo.terminals.get(l.id);
          if (!t) return null;
          const active = lineActive(l.id);
          const focused = focus?.kind === 'line' && focus.id === l.id;
          return (
            <g
              key={`t-${l.id}`}
              className="dch-map-dim"
              opacity={active ? 1 : 0.2}
              {...act({ kind: 'line', id: l.id })}
              aria-label={`${l.contract.name} terminal, produced by ${l.contract.producerTeam}`}
              data-testid="map-terminal"
            >
              <title>{`${l.contract.name}\n${l.contract.sourceRef}\n${l.contract.producerTeam}`}</title>
              {focused && <rect x={t.center.x - 23} y={t.center.y - 23} width={46} height={46} rx={14} fill="none" stroke="var(--accent-9)" strokeWidth={2.5} />}
              <rect x={t.center.x - 16} y={t.center.y - 16} width={32} height={32} rx={9} fill={l.color} stroke={halo} strokeWidth={3} />
              <text x={t.center.x} y={t.center.y + 4.2} textAnchor="middle" fill={`var(--${l.ramp}-contrast)`} style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '0.02em' }}>
                {l.code}
              </text>
              <text
                x={t.label.tx}
                y={t.label.ty + (font + 1.5) * 0.98}
                textAnchor={t.label.anchor}
                fill={ink}
                stroke={halo}
                strokeWidth={4}
                paintOrder="stroke"
                strokeLinejoin="round"
                style={{ fontSize: font + 1.5, fontWeight: 650, letterSpacing: '-0.01em' }}
              >
                {l.contract.name}
              </text>
              <text
                x={t.label.tx}
                y={t.label.ty + (font + 1.5) * 1.05 + (font - 3) * 1.25}
                textAnchor={t.label.anchor}
                fill="var(--world-ink-muted)"
                stroke={halo}
                strokeWidth={3}
                paintOrder="stroke"
                style={{ fontSize: font - 3, fontWeight: 500, fontFamily: 'var(--mono)', letterSpacing: '0.05em', textTransform: 'uppercase' }}
              >
                {l.contract.producerTeam}
              </text>
            </g>
          );
        })}

        {/* trains: open services waiting at the terminal, soonest first */}
        {trains.map(({ svc, line, p, dir, labelAt }) => {
          const active = lineActive(line.id);
          const focused = focus?.kind === 'service' && focus.id === svc.id;
          const color = trainColor(lens, svc);
          const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
          const urgent = svc.health.health === 'at_risk' || svc.health.health === 'overdue' || svc.health.health === 'blocked';
          const showLabel = lens === 'departure' || focused || urgent || em?.kind === 'line';
          return (
            <g
              key={`tr-${svc.id}`}
              className="dch-map-dim"
              opacity={active ? 1 : 0.15}
              {...act({ kind: 'service', id: svc.id })}
              aria-label={`Service ${svc.notice.title}, departs ${countdown(svc.health.daysLeft)}, ${remarkMeta[svc.health.health].board.toLowerCase()}`}
              data-testid="map-train"
              data-health={svc.health.health}
            >
              <title>{`${svc.notice.title}\n${countdown(svc.health.daysLeft)} · ${remarkMeta[svc.health.health].board}`}</title>
              {focused && <circle cx={p.x} cy={p.y} r={24} fill="var(--accent-9)" fillOpacity={0.14} stroke="var(--accent-9)" strokeWidth={2} />}
              <g transform={`translate(${p.x} ${p.y}) rotate(${angle})`}>
                <rect x={-16} y={-7} width={32} height={14} rx={7} fill={color} stroke={halo} strokeWidth={2.5} data-testid="train-body" />
                {[-9, -3, 3].map((x) => (
                  <rect key={x} x={x} y={-2.6} width={4.4} height={5.2} rx={1.2} fill="var(--surface)" opacity={0.88} />
                ))}
                <circle cx={11.5} cy={0} r={2} fill="var(--world-glow)" className={urgent && !reduced ? 'dch-train-lamp' : undefined} />
              </g>
              {showLabel && (
                <text
                  x={labelAt.x}
                  y={labelAt.y + 4}
                  textAnchor="middle"
                  fill={svc.health.daysLeft < 0 ? 'var(--bad-text)' : svc.health.daysLeft <= 7 ? 'var(--warn-text)' : ink}
                  stroke={halo}
                  strokeWidth={4}
                  paintOrder="stroke"
                  style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }}
                >
                  {countdown(svc.health.daysLeft)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1 md:bottom-auto md:right-4 md:top-1/2 md:-translate-y-1/2">
        <div className="x-glass pointer-events-auto flex flex-col gap-0.5 rounded-full! p-1">
          <IconButton size="sm" label="Zoom in (+)" icon={<Plus />} onClick={() => zoomBy(0.75)} />
          <IconButton size="sm" label="Zoom out (−)" icon={<Minus />} onClick={() => zoomBy(1.33)} />
          <IconButton
            size="sm"
            label="Fit the network (0)"
            icon={<Maximize2 />}
            onClick={() => {
              onFocus(null);
              const f = fitAll();
              if (f) flyTo(f);
            }}
          />
        </div>
      </div>
    </div>
  );
}
