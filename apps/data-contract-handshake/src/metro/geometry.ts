/**
 * Turns a grid layout into drawable geometry in pixels: one polyline per line (parallel lanes where several lines
 * share track between the same stops), rounded corners, station marker points (interchange capsules), terminal
 * blocks, stub lines for lines without stations, and label boxes placed to avoid lines and each other.
 */
import { routeEdge, stationNode, terminalNode, type Layout, type Pt } from './layout';

export const CELL = 96;
export const LANE = 10;
export const MARGIN = 40;

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text anchor point and alignment. */
  tx: number;
  ty: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface LineGeom {
  id: string;
  points: Pt[];
  /** Rounded SVG path through `points`. */
  d: string;
  /** Arc length along `points` where the line reaches each of its stations. */
  stationAt: Map<string, number>;
  length: number;
  /** A line with no stations ends in a short dashed stub and a buffer stop. */
  stub: { from: Pt; to: Pt } | null;
}

export interface StationGeom {
  key: string;
  center: Pt;
  /** Lane points of every line at this station, sorted along the capsule axis. */
  marker: Pt[];
  /** Where each line passes the station (its signal lamp). */
  lamps: Map<string, Pt>;
  label: LabelBox;
}

export interface TerminalGeom {
  lineId: string;
  center: Pt;
  label: LabelBox;
}

export interface Geometry {
  lines: Map<string, LineGeom>;
  stations: Map<string, StationGeom>;
  terminals: Map<string, TerminalGeom>;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface GeometryInput {
  layout: Layout;
  /** Lines in drawing order (lane order follows it). */
  lines: { id: string; name: string; sub: string; stations: string[]; trains?: number }[];
  stations: { key: string; name: string }[];
  /** Label font size in px (labels grow on phones). */
  font?: number;
  /**
   * How strongly labels prefer to stay inside the track's bounding box (cost per px outside). Phones fit the track,
   * not the labels, so they keep labels inside; desktops only nudge.
   */
  contain?: number;
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

/** Offset a polyline sideways by `d` (mitred joins). */
export function offsetPolyline(pts: Pt[], d: number): Pt[] {
  if (d === 0 || pts.length < 2) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const nIn = i > 0 ? perp(norm(sub(pts[i], pts[i - 1]))) : null;
    const nOut = i < pts.length - 1 ? perp(norm(sub(pts[i + 1], pts[i]))) : null;
    if (nIn && nOut) {
      const m = norm(add(nIn, nOut));
      const cos = m.x * nIn.x + m.y * nIn.y || 1;
      out.push(add(pts[i], mul(m, d / cos)));
    } else out.push(add(pts[i], mul((nIn ?? nOut)!, d)));
  }
  return out;
}

/** Remove consecutive duplicates and collinear midpoints. */
function simplify(pts: Pt[]): Pt[] {
  const a: Pt[] = [];
  for (const p of pts) if (!a.length || len(sub(p, a[a.length - 1])) > 0.5) a.push(p);
  const out: Pt[] = [];
  for (let i = 0; i < a.length; i++) {
    if (i > 0 && i < a.length - 1) {
      const u = norm(sub(a[i], a[i - 1]));
      const v = norm(sub(a[i + 1], a[i]));
      if (u.x * v.x + u.y * v.y > 0.9999) continue;
    }
    out.push(a[i]);
  }
  return out;
}

/** SVG path through `pts` with rounded corners of up to `r` px. */
export function roundedPath(pts: Pt[], r = 22): string {
  if (pts.length === 0) return '';
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = sub(pts[i - 1], p);
    const b = sub(pts[i + 1], p);
    const rr = Math.min(r, len(a) / 2, len(b) / 2);
    const p1 = add(p, mul(norm(a), rr));
    const p2 = add(p, mul(norm(b), rr));
    d += `L${f(p1.x)},${f(p1.y)}Q${f(p.x)},${f(p.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last.x)},${f(last.y)}`;
}

export function polylineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
  return s;
}

/** Point and unit direction at arc length `s` along a polyline. */
export function pointAt(pts: Pt[], s: number): { p: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = sub(pts[i], pts[i - 1]);
    const l = len(seg);
    if (acc + l >= s || i === pts.length - 1) {
      const t = l ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      return { p: add(pts[i - 1], mul(seg, t)), dir: norm(seg) };
    }
    acc += l;
  }
  return { p: pts[0] ?? { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
}

/** The polyline from the start to arc length `s`. */
export function truncate(pts: Pt[], s: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len(sub(pts[i], pts[i - 1]));
    if (acc + l >= s) {
      out.push(pointAt(pts, s).p);
      return out;
    }
    out.push(pts[i]);
    acc += l;
  }
  return out;
}

const DIRS: { v: Pt; pref: number }[] = [
  { v: { x: 1, y: 0 }, pref: 0 },
  { v: { x: -1, y: 0 }, pref: 0.4 },
  { v: { x: 0, y: 1 }, pref: 0.8 },
  { v: { x: 0, y: -1 }, pref: 0.8 },
  { v: { x: 1, y: 1 }, pref: 1.2 },
  { v: { x: 1, y: -1 }, pref: 1.2 },
  { v: { x: -1, y: 1 }, pref: 1.4 },
  { v: { x: -1, y: -1 }, pref: 1.4 },
];

/** Approximate text width for Geist at `font` px (no DOM measuring, so layout is stable and testable). */
export function textWidth(text: string, font: number, weight = 600): number {
  let w = 0;
  for (const ch of text) {
    if (/[ il.,:;'|!]/.test(ch)) w += 0.3;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else w += 0.56;
  }
  return w * font * (weight >= 600 ? 1.04 : 1);
}

function labelBox(anchor: Pt, dir: Pt, w: number, h: number, gap: number): LabelBox {
  const dx = Math.sign(dir.x);
  const dy = Math.sign(dir.y);
  const cx = anchor.x + dx * gap;
  const cy = anchor.y + dy * gap;
  let x: number;
  let tx: number;
  let ta: LabelBox['anchor'];
  if (dx > 0) {
    x = cx;
    tx = cx;
    ta = 'start';
  } else if (dx < 0) {
    x = cx - w;
    tx = cx;
    ta = 'end';
  } else {
    x = cx - w / 2;
    tx = cx;
    ta = 'middle';
  }
  const y = dy > 0 ? cy : dy < 0 ? cy - h : cy - h / 2;
  return { x, y, w, h, tx, ty: y, anchor: ta };
}

function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function buildGeometry({ layout, lines, stations, font = 13, contain = 0.02 }: GeometryInput): Geometry {
  const px = (p: Pt): Pt => ({ x: MARGIN + p.x * CELL, y: MARGIN + p.y * CELL });
  const nodeIndex = new Map<string, number>();
  [...layout.pos.keys()].forEach((id, i) => nodeIndex.set(id, i));

  // bundles: which lines use each undirected edge, in drawing order
  const bundles = new Map<string, string[]>();
  const edgeKey = (a: string, b: string) => ((nodeIndex.get(a) ?? 0) < (nodeIndex.get(b) ?? 0) ? `${a}|${b}` : `${b}|${a}`);
  for (const l of lines) {
    const r = layout.routes.get(l.id) ?? [terminalNode(l.id)];
    for (let i = 0; i + 1 < r.length; i++) {
      const k = edgeKey(r[i], r[i + 1]);
      const list = bundles.get(k) ?? [];
      if (!list.includes(l.id)) list.push(l.id);
      bundles.set(k, list);
    }
  }

  const lineGeoms = new Map<string, LineGeom>();
  const lampPts = new Map<string, Map<string, Pt[]>>(); // station key → line id → points
  for (const l of lines) {
    const r = layout.routes.get(l.id) ?? [terminalNode(l.id)];
    const pts: Pt[] = [];
    const stationAt = new Map<string, number>();
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i];
      const b = r[i + 1];
      const k = edgeKey(a, b);
      const [lo, hi] = k.split('|');
      const bundle = bundles.get(k)!;
      const off = (bundle.indexOf(l.id) - (bundle.length - 1) / 2) * LANE;
      const canon = routeEdge(layout.pos.get(lo)!, layout.pos.get(hi)!).map(px);
      let seg = offsetPolyline(canon, off);
      if (a !== lo) seg = seg.reverse();
      pts.push(...seg);
      const keyA = a.startsWith('S:') ? a.slice(2) : null;
      const keyB = b.slice(2);
      if (keyA) {
        const m = lampPts.get(keyA) ?? new Map<string, Pt[]>();
        m.set(l.id, [...(m.get(l.id) ?? []), seg[0]]);
        lampPts.set(keyA, m);
      }
      const m = lampPts.get(keyB) ?? new Map<string, Pt[]>();
      m.set(l.id, [...(m.get(l.id) ?? []), seg[seg.length - 1]]);
      lampPts.set(keyB, m);
    }
    const simple = simplify(pts);
    // arc length of each station along the simplified polyline: nearest approach to that station's lamp point
    let total = polylineLength(simple);
    for (const s of l.stations) {
      const lp = lampPts.get(s)?.get(l.id);
      if (!lp?.length) continue;
      const target = lp[lp.length - 1];
      let acc = 0;
      let bestS = 0;
      let bestD = Infinity;
      for (let i = 1; i < simple.length; i++) {
        const a = simple[i - 1];
        const b = simple[i];
        const v = sub(b, a);
        const L = len(v);
        const t = L ? Math.max(0, Math.min(1, ((target.x - a.x) * v.x + (target.y - a.y) * v.y) / (L * L))) : 0;
        const q = add(a, mul(v, t));
        const dd = len(sub(q, target));
        if (dd < bestD - 0.01) {
          bestD = dd;
          bestS = acc + t * L;
        }
        acc += L;
      }
      stationAt.set(s, bestS);
    }
    let stub: LineGeom['stub'] = null;
    let finalPts = simple;
    if (r.length === 1) {
      // choose the freest direction for a short stub
      const t = px(layout.pos.get(terminalNode(l.id))!);
      const others = [...layout.pos.entries()].filter(([id]) => id !== terminalNode(l.id)).map(([, p]) => px(p));
      let best = DIRS[0].v;
      let bestScore = -Infinity;
      for (const { v, pref } of DIRS) {
        const end = add(t, mul(norm(v), CELL * 0.8));
        const clearance = Math.min(...others.map((o) => len(sub(o, end))), 400);
        const score = clearance - pref * 12;
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
      const end = add(t, mul(norm(best), CELL * 0.8));
      stub = { from: t, to: end };
      finalPts = [t, end];
      total = polylineLength(finalPts);
    }
    lineGeoms.set(l.id, { id: l.id, points: finalPts, d: roundedPath(finalPts), stationAt, length: total, stub });
  }

  // obstacles for labels: dense samples along every line and stub
  const samples: Pt[] = [];
  for (const l of lines) {
    const g = lineGeoms.get(l.id)!;
    for (let s = 0; s <= g.length; s += 6) samples.push(pointAt(g.points, s).p);
    // trains wait on the first stretch from the terminal, with their countdown beside them: keep labels off it
    const reach = l.trains ? 34 + (l.trains - 1) * 40 + 22 : 0;
    for (let s = 14; s <= Math.min(g.length, reach); s += 6) {
      const { p, dir } = pointAt(g.points, s);
      samples.push({ x: p.x - dir.y * 17, y: p.y + dir.x * 17 }, { x: p.x + dir.y * 17, y: p.y - dir.x * 17 });
    }
  }
  let tMinX = Infinity;
  let tMaxX = -Infinity;
  let tMinY = Infinity;
  let tMaxY = -Infinity;
  for (const g of lineGeoms.values())
    for (const p of g.points) {
      tMinX = Math.min(tMinX, p.x);
      tMaxX = Math.max(tMaxX, p.x);
      tMinY = Math.min(tMinY, p.y);
      tMaxY = Math.max(tMaxY, p.y);
    }
  const outside = (b: { x: number; y: number; w: number; h: number }) =>
    Number.isFinite(tMinX)
      ? Math.max(0, tMinX - 20 - b.x) + Math.max(0, b.x + b.w - tMaxX - 20) + Math.max(0, tMinY - 20 - b.y) + Math.max(0, b.y + b.h - tMaxY - 20)
      : 0;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const nodeBoxes: { x: number; y: number; w: number; h: number }[] = [];

  const stationGeoms = new Map<string, StationGeom>();
  for (const st of stations) {
    const c = px(layout.pos.get(stationNode(st.key))!);
    const byLine = lampPts.get(st.key) ?? new Map<string, Pt[]>();
    const lamps = new Map<string, Pt>();
    const all: Pt[] = [];
    for (const [lineId, list] of byLine) {
      const mid = list.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
      lamps.set(lineId, mul(mid, 1 / list.length));
      all.push(...list);
    }
    // dedupe and order along the axis of greatest spread
    const uniq: Pt[] = [];
    for (const p of all) if (!uniq.some((q) => len(sub(p, q)) < 1.5)) uniq.push(p);
    if (!uniq.length) uniq.push(c);
    const xs = uniq.map((p) => p.x);
    const ys = uniq.map((p) => p.y);
    const horiz = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    uniq.sort((a, b) => (horiz ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
    stationGeoms.set(st.key, { key: st.key, center: c, marker: uniq, lamps, label: { x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, anchor: 'start' } });
    const minX = Math.min(...xs, c.x) - 10;
    const minY = Math.min(...ys, c.y) - 10;
    nodeBoxes.push({ x: minX, y: minY, w: Math.max(...xs, c.x) + 10 - minX, h: Math.max(...ys, c.y) + 10 - minY });
  }
  const terminalGeoms = new Map<string, TerminalGeom>();
  for (const l of lines) {
    const c = px(layout.pos.get(terminalNode(l.id))!);
    terminalGeoms.set(l.id, { lineId: l.id, center: c, label: { x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, anchor: 'start' } });
    nodeBoxes.push({ x: c.x - 18, y: c.y - 18, w: 36, h: 36 });
  }

  const place = (anchor: Pt, w: number, h: number, gap: number, avoidDirs: Pt[]): LabelBox => {
    let best: LabelBox | null = null;
    let bestScore = Infinity;
    for (const { v, pref } of DIRS) {
      const box = labelBox(anchor, v, w, h, gap + (v.x && v.y ? -4 : 0));
      let score = pref;
      const pad = { x: box.x - 3, y: box.y - 2, w: box.w + 6, h: box.h + 4 };
      for (const p of samples) if (p.x > pad.x && p.x < pad.x + pad.w && p.y > pad.y && p.y < pad.y + pad.h) score += 3;
      for (const o of placed) score += overlapArea(pad, o) * 0.4;
      for (const o of nodeBoxes) score += overlapArea(pad, o) * 0.2;
      for (const d of avoidDirs) if (Math.sign(d.x) === Math.sign(v.x) && Math.sign(d.y) === Math.sign(v.y)) score += 6;
      score += outside(box) * contain;
      if (score < bestScore) {
        bestScore = score;
        best = box;
      }
    }
    placed.push(best!);
    return best!;
  };

  // terminals first (bigger labels), then interchanges, then single stations
  for (const l of lines) {
    const t = terminalGeoms.get(l.id)!;
    const g = lineGeoms.get(l.id)!;
    const dir = g.points.length > 1 ? norm(sub(g.points[1], g.points[0])) : { x: 1, y: 0 };
    const w = Math.max(textWidth(l.name, font + 1.5), textWidth(l.sub.toUpperCase(), font - 3, 500) + 4);
    t.label = place(t.center, w, font * 2.6, 24, [dir]);
  }
  const order = [...stations].sort((a, b) => (stationGeoms.get(b.key)!.lamps.size - stationGeoms.get(a.key)!.lamps.size) || a.name.localeCompare(b.name));
  for (const st of order) {
    const g = stationGeoms.get(st.key)!;
    const m = g.marker;
    const ext = m.length > 1 ? Math.max(len(sub(m[m.length - 1], m[0])) / 2, 0) : 0;
    const dirs: Pt[] = [];
    for (const l of lines) {
      const lg = lineGeoms.get(l.id)!;
      const s = lg.stationAt.get(st.key);
      if (s === undefined) continue;
      if (s > 1) dirs.push(mul(pointAt(lg.points, s - 2).dir, -1));
      if (s < lg.length - 1) dirs.push(pointAt(lg.points, s + 2).dir);
    }
    g.label = place(g.center, textWidth(st.name, font), font * 1.25, 14 + ext, dirs);
  }

  // bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const g of lineGeoms.values()) for (const p of g.points) grow(p.x, p.y);
  for (const b of [...placed, ...nodeBoxes]) {
    grow(b.x, b.y);
    grow(b.x + b.w, b.y + b.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 300;
  }
  return {
    lines: lineGeoms,
    stations: stationGeoms,
    terminals: terminalGeoms,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
