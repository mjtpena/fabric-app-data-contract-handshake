/**
 * Octilinear metro-map layout (pure, deterministic). Terminals (one per line) and stations sit on grid cells; every
 * edge between consecutive stops is drawn horizontal, vertical or at 45°, or as a straight–diagonal–straight dog-leg
 * when the two cells are not on an octilinear ray. A seeded simulated annealing moves nodes between cells to minimise
 * length, bends, sharp turns at stations, crossings, shared track between different stops and lines running through
 * stations they do not stop at. Small networks (tens of nodes) settle in well under 100 ms.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface LayoutLine {
  id: string;
  /** Station keys this line stops at (order is decided by the layout). */
  stations: string[];
}

export interface Layout {
  /** Node id → grid cell. Node ids: `T:<lineId>` (terminals) and `S:<stationKey>` (stations). */
  pos: Map<string, Pt>;
  /** Line id → node ids in travel order, terminal first. */
  routes: Map<string, string[]>;
  cols: number;
  rows: number;
  cost: number;
}

export const terminalNode = (lineId: string) => `T:${lineId}`;
export const stationNode = (key: string) => `S:${key}`;

/* ------------------------------------------------------------------ random */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ routing */

/**
 * Octilinear route between two cells (grid units). On a ray: one segment. Otherwise straight, 45°, straight with the
 * diagonal in the middle, which reads as the calm dog-leg of a schematic map.
 */
export function routeEdge(a: Pt, b: Pt): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (dx === 0 || dy === 0 || adx === ady) return [a, b];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (adx > ady) {
    const h = (adx - ady) / 2;
    return [a, { x: a.x + sx * h, y: a.y }, { x: b.x - sx * h, y: b.y }, b];
  }
  const v = (ady - adx) / 2;
  return [a, { x: a.x, y: a.y + sy * v }, { x: b.x, y: b.y - sy * v }, b];
}

const octDist = (a: Pt, b: Pt) => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
};

/** Stop order of a line: nearest neighbour from the terminal. */
function orderStops(terminal: Pt, stations: { id: number; p: Pt }[]): number[] {
  const left = [...stations];
  const out: number[] = [];
  let cur = terminal;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = octDist(cur, left[i].p);
      if (d < bd - 1e-9) {
        bd = d;
        bi = i;
      }
    }
    const next = left.splice(bi, 1)[0];
    out.push(next.id);
    cur = next.p;
  }
  return out;
}

/* ------------------------------------------------------------------ geometry tests */

type Seg = [number, number, number, number];

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;
}

/** 1 = proper crossing, 2 = collinear overlap with positive length, 0 = neither (touching ends is fine). */
function segRelation(s: Seg, t: Seg): number {
  const [ax, ay, bx, by] = s;
  const [cx, cy, dx, dy] = t;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 === 0 && o2 === 0) {
    // collinear: project on the dominant axis
    const useX = Math.abs(bx - ax) >= Math.abs(by - ay);
    const a0 = useX ? Math.min(ax, bx) : Math.min(ay, by);
    const a1 = useX ? Math.max(ax, bx) : Math.max(ay, by);
    const b0 = useX ? Math.min(cx, dx) : Math.min(cy, dy);
    const b1 = useX ? Math.max(cx, dx) : Math.max(cy, dy);
    return Math.min(a1, b1) - Math.max(a0, b0) > 0.05 ? 2 : 0;
  }
  if (o1 * o2 < 0 && o3 * o4 < 0) return 1;
  return 0;
}

function distToSeg(px: number, py: number, s: Seg) {
  const [ax, ay, bx, by] = s;
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L));
  const qx = ax + t * vx - px;
  const qy = ay + t * vy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function turnPenalty(ix: number, iy: number, ox: number, oy: number): number {
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (!li || !lo) return 0;
  const cos = (ix * ox + iy * oy) / (li * lo);
  if (cos > 0.99) return 0; // straight through
  if (cos > 0.6) return 0.6; // 45°
  if (cos > -0.1) return 2.2; // 90°
  if (cos > -0.8) return 7; // 135°: a hairpin
  return 14; // reversal
}

/* ------------------------------------------------------------------ layout */

export function layoutNetwork(
  lines: LayoutLine[],
  opts: { aspect?: number; seed?: number; seedKey?: string; restarts?: number } = {},
): Layout {
  const aspect = opts.aspect ?? 1.6;
  const nodeIds: string[] = [];
  const index = new Map<string, number>();
  const add = (id: string) => {
    if (!index.has(id)) {
      index.set(id, nodeIds.length);
      nodeIds.push(id);
    }
  };
  for (const l of lines) add(terminalNode(l.id));
  for (const l of lines) for (const s of l.stations) add(stationNode(s));
  const n = nodeIds.length;
  const lineNodes = lines.map((l) => ({
    t: index.get(terminalNode(l.id))!,
    stations: [...new Set(l.stations)].map((s) => index.get(stationNode(s))!),
  }));

  if (n === 0) return { pos: new Map(), routes: new Map(), cols: 0, rows: 0, cost: 0 };

  const area = Math.max(16, n * 4.6);
  const cols = Math.max(4, Math.round(Math.sqrt(area * aspect)));
  const rows = Math.max(3, Math.ceil(area / cols));
  const degree = new Array<number>(n).fill(0);
  for (const l of lineNodes) for (const s of l.stations) degree[s]++;

  const seedBase = opts.seed ?? hashString(opts.seedKey ?? lines.map((l) => `${l.id}:${l.stations.join(',')}`).join('|'));
  const restarts = opts.restarts ?? 3;

  let best: { xs: Int16Array; ys: Int16Array; cost: number } | null = null;
  for (let r = 0; r < restarts; r++) {
    const res = anneal(seedBase + r * 7919);
    if (!best || res.cost < best.cost - 1e-9) best = res;
  }

  function initial(rnd: () => number) {
    const xs = new Int16Array(n);
    const ys = new Int16Array(n);
    const used = new Set<number>();
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const cells: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, d: Math.hypot((x - cx) / aspect, y - cy) + rnd() * 0.3 });
    const inner = [...cells].sort((a, b) => a.d - b.d);
    const stations = nodeIds.map((_, i) => i).filter((i) => nodeIds[i].startsWith('S:'));
    stations.sort((a, b) => degree[b] - degree[a] || a - b);
    let k = 0;
    for (const s of stations) {
      // leave a gap between stations on the first pass so lines have room to bend
      while (k < inner.length && (used.has(inner[k].y * cols + inner[k].x) || (inner[k].x + inner[k].y) % 2 === 1)) k++;
      const c = k < inner.length ? inner[k] : inner.find((q) => !used.has(q.y * cols + q.x))!;
      xs[s] = c.x;
      ys[s] = c.y;
      used.add(c.y * cols + c.x);
    }
    const outer = [...cells].sort((a, b) => b.d - a.d);
    for (let li = 0; li < lineNodes.length; li++) {
      const l = lineNodes[li];
      let tx = cx;
      let ty = cy;
      if (l.stations.length) {
        tx = l.stations.reduce((s, i) => s + xs[i], 0) / l.stations.length;
        ty = l.stations.reduce((s, i) => s + ys[i], 0) / l.stations.length;
      }
      // push outward from the centre through the stations' centroid
      const ang = Math.atan2(ty - cy + (rnd() - 0.5) * 0.4, (tx - cx) / aspect + (rnd() - 0.5) * 0.4 + (li % 2 ? 0.01 : -0.01));
      let bestCell = outer.find((q) => !used.has(q.y * cols + q.x))!;
      let bestScore = Infinity;
      for (const q of outer) {
        if (used.has(q.y * cols + q.x)) continue;
        const qa = Math.atan2(q.y - cy, (q.x - cx) / aspect);
        let da = Math.abs(qa - ang);
        if (da > Math.PI) da = 2 * Math.PI - da;
        const score = da * 3 - q.d;
        if (score < bestScore) {
          bestScore = score;
          bestCell = q;
        }
      }
      xs[l.t] = bestCell.x;
      ys[l.t] = bestCell.y;
      used.add(bestCell.y * cols + bestCell.x);
    }
    return { xs, ys };
  }

  function evaluate(xs: Int16Array, ys: Int16Array): number {
    let cost = 0;
    const segs: Seg[] = [];
    const segEdge: number[] = [];
    const segOwner: number[][] = []; // endpoints (node indices) of the edge a segment belongs to
    const edgeIds = new Map<string, number>();
    for (const l of lineNodes) {
      const order = orderStops(
        { x: xs[l.t], y: ys[l.t] },
        l.stations.map((i) => ({ id: i, p: { x: xs[i], y: ys[i] } })),
      );
      const path = [l.t, ...order];
      let prevDir: [number, number] | null = null;
      for (let k = 0; k + 1 < path.length; k++) {
        const a = path[k];
        const b = path[k + 1];
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = `${lo}-${hi}`;
        let eid = edgeIds.get(key);
        const fresh = eid === undefined;
        if (eid === undefined) {
          eid = edgeIds.size;
          edgeIds.set(key, eid);
        }
        const pts = routeEdge({ x: xs[lo], y: ys[lo] }, { x: xs[hi], y: ys[hi] });
        const forward = a === lo;
        const seq = forward ? pts : [...pts].reverse();
        let len = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
          if (fresh) {
            segs.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y]);
            segEdge.push(eid);
            segOwner.push([lo, hi]);
          }
        }
        const bends = pts.length - 2;
        const cheb = Math.max(Math.abs(xs[a] - xs[b]), Math.abs(ys[a] - ys[b]));
        cost += len * 0.35 + Math.abs(len - 2) * 0.9 + bends * 0.7 + (cheb === 1 ? 1.6 : 0) + (len > 3.5 ? (len - 3.5) * 1.2 : 0);
        // turn at the stop between the previous edge and this one
        const d0: [number, number] = [seq[1].x - seq[0].x, seq[1].y - seq[0].y];
        if (prevDir) cost += turnPenalty(prevDir[0], prevDir[1], d0[0], d0[1]);
        const m = seq.length;
        prevDir = [seq[m - 1].x - seq[m - 2].x, seq[m - 1].y - seq[m - 2].y];
      }
      if (path.length === 1) {
        // a line with no stations needs a free neighbour for its stub
        let free = 0;
        for (let i = 0; i < n; i++) if (i !== l.t && Math.max(Math.abs(xs[i] - xs[l.t]), Math.abs(ys[i] - ys[l.t])) <= 1) free++;
        cost += free * 1.5;
        // and should sit near the rest of the network, not drift to a corner
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < n; i++) {
          sx += xs[i];
          sy += ys[i];
        }
        cost += Math.hypot(xs[l.t] - sx / n, ys[l.t] - sy / n) * 0.9;
      }
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segEdge[i] === segEdge[j]) continue;
        const rel = segRelation(segs[i], segs[j]);
        if (rel === 1) cost += 6;
        else if (rel === 2) cost += 9;
      }
      for (let v = 0; v < n; v++) {
        if (v === segOwner[i][0] || v === segOwner[i][1]) continue;
        if (distToSeg(xs[v], ys[v], segs[i]) < 0.42) cost += 12;
      }
    }
    // gentle pull toward a compact, centred drawing
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, xs[i]);
      maxX = Math.max(maxX, xs[i]);
      minY = Math.min(minY, ys[i]);
      maxY = Math.max(maxY, ys[i]);
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    cost += (w * h) * 0.05 + Math.abs(w / Math.max(1, h) - aspect) * 0.8;
    return cost;
  }

  function anneal(seed: number) {
    const rnd = mulberry32(seed);
    const { xs, ys } = initial(rnd);
    const grid = new Int16Array(cols * rows).fill(-1);
    for (let i = 0; i < n; i++) grid[ys[i] * cols + xs[i]] = i;
    let cur = evaluate(xs, ys);
    let bestCost = cur;
    let bestXs = xs.slice();
    let bestYs = ys.slice();
    const iters = n > 40 ? 2500 : 3000 + n * 260;
    const T0 = 4;
    const T1 = 0.03;
    for (let it = 0; it < iters; it++) {
      const T = T0 * Math.pow(T1 / T0, it / iters);
      const a = Math.floor(rnd() * n);
      const ax = xs[a];
      const ay = ys[a];
      let nx: number;
      let ny: number;
      if (rnd() < 0.25) {
        const b = Math.floor(rnd() * n);
        nx = xs[b];
        ny = ys[b];
      } else {
        const r = T > 1 ? 3 : 2;
        nx = ax + Math.round((rnd() * 2 - 1) * r);
        ny = ay + Math.round((rnd() * 2 - 1) * r);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      }
      if (nx === ax && ny === ay) continue;
      const b = grid[ny * cols + nx];
      // apply
      xs[a] = nx;
      ys[a] = ny;
      grid[ny * cols + nx] = a;
      if (b >= 0) {
        xs[b] = ax;
        ys[b] = ay;
        grid[ay * cols + ax] = b;
      } else grid[ay * cols + ax] = -1;
      const c = evaluate(xs, ys);
      if (c <= cur || rnd() < Math.exp((cur - c) / T)) {
        cur = c;
        if (c < bestCost - 1e-9) {
          bestCost = c;
          bestXs = xs.slice();
          bestYs = ys.slice();
        }
      } else {
        // revert
        xs[a] = ax;
        ys[a] = ay;
        grid[ay * cols + ax] = a;
        if (b >= 0) {
          xs[b] = nx;
          ys[b] = ny;
          grid[ny * cols + nx] = b;
        } else grid[ny * cols + nx] = -1;
      }
    }
    return { xs: bestXs, ys: bestYs, cost: bestCost };
  }

  const { xs, ys, cost } = best!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxX = Math.max(maxX, xs[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const pos = new Map<string, Pt>();
  for (let i = 0; i < n; i++) pos.set(nodeIds[i], { x: xs[i] - minX, y: ys[i] - minY });
  const routes = new Map<string, string[]>();
  lines.forEach((l, li) => {
    const ln = lineNodes[li];
    const order = orderStops(
      pos.get(nodeIds[ln.t])!,
      ln.stations.map((i) => ({ id: i, p: pos.get(nodeIds[i])! })),
    );
    routes.set(l.id, [nodeIds[ln.t], ...order.map((i) => nodeIds[i])]);
  });
  return { pos, routes, cols: maxX - minX + 1, rows: maxY - minY + 1, cost };
}
