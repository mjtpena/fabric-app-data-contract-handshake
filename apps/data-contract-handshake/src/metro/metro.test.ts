import { createMemoryStore } from '@x10/shared/data';
import { runSeed } from '@x10/shared/runtime';

import { personas } from '../app.config';
import { loadSnapshot } from '../domain/contracts';
import { localToday } from '../domain/days';
import { defs, type Schema } from '../model';
import { seed } from '../seed';
import { buildGeometry, offsetPolyline, pointAt, roundedPath } from './geometry';
import { layoutNetwork, routeEdge, stationNode, terminalNode } from './layout';
import { countdown, dayFlap } from './meta';
import { MY_LINES, buildNetwork, buildToday, lineCode, perspective, searchNetwork, servicesFor, worstSignal } from './network';

async function seededNetwork() {
  const store = createMemoryStore<Schema>(defs);
  await runSeed(store, personas, seed);
  return buildNetwork(await loadSnapshot(store), localToday());
}

describe('network model', () => {
  it('maps contracts to lines, consumer teams to stations and published notices to services', async () => {
    const net = await seededNetwork();
    expect(net.lines).toHaveLength(5);
    expect(net.stations).toHaveLength(6);
    expect(net.services).toHaveLength(6);
    // registration order: the oldest contract gets the first colour
    expect(net.lines[0].contract.name).toBe('Orders fact table');
    expect(net.lines[0].color).toBe('var(--blue-9)');
    const marketing = net.stations.find((s) => s.name === 'Marketing Insights')!;
    expect(marketing.lineIds).toHaveLength(3);
    // Marketing objected to the name split on the customer dimension
    expect(marketing.signal).toBe('objected');
    const fx = net.lines.find((l) => l.contract.name === 'Currency rates')!;
    expect(fx.stops).toHaveLength(0);
    expect(fx.services).toHaveLength(1);
  });

  it('ranks Today: held, late, final call, busiest station, line without stations', async () => {
    const net = await seededNetwork();
    const today = buildToday(net, 'all', null);
    expect(today.map((t) => t.lens)).toEqual(['signal', 'departure', 'departure', 'team', 'team']);
    expect(today[0].title).toMatch(/Split full_name/);
    expect(today[1].value).toBe('+3');
    expect(today[2].value).toBe('5');
    expect(today[3].target).toEqual({ kind: 'station', id: 'finance analytics' });
    expect(today[4].target.kind).toBe('line');
  });

  it('perspectives light a producer’s lines or a consumer’s station', async () => {
    const net = await seededNetwork();
    const producer = perspective(net, 'producer', 'Customer Data Platform');
    expect(producer.lines.size).toBe(1);
    expect(producer.stations.size).toBe(3);
    const consumer = perspective(net, 'consumer', 'Sales Ops');
    expect(consumer.stations).toEqual(new Set(['sales ops']));
    expect(consumer.lines.size).toBe(2);
    expect(servicesFor(net, 'consumer', 'Sales Ops').every((s) => s.acks.some((a) => a.teamName === 'Sales Ops'))).toBe(true);
    // "My lines": every line the viewer owns, whatever its producer team (Morgan owns four)
    expect(perspective(net, 'producer', MY_LINES, 'demo-producer').lines.size).toBe(4);
    expect(servicesFor(net, 'producer', MY_LINES, 'demo-admin')).toHaveLength(1);
    const mine = buildToday(net, 'consumer', 'Finance Analytics');
    expect(mine).toHaveLength(2);
    expect(mine.every((t) => t.target.kind === 'service')).toBe(true);
  });

  it('searches stations, lines and services', async () => {
    const net = await seededNetwork();
    expect(searchNetwork(net, 'sales ops')).toEqual({ kind: 'station', id: 'sales ops' });
    expect(searchNetwork(net, 'inventory')?.kind).toBe('line');
    expect(searchNetwork(net, 'gross_amount')?.kind).toBe('service');
    expect(searchNetwork(net, '')).toBeNull();
  });

  it('small helpers', () => {
    expect(lineCode('Orders fact table')).toBe('OF');
    expect(lineCode('Inventory')).toBe('IN');
    expect(worstSignal(['acknowledged', 'pending', 'migrated'])).toBe('pending');
    expect(worstSignal([])).toBe('none');
    expect(countdown(5)).toBe('T-5');
    expect(countdown(-3)).toBe('T+3');
    expect(dayFlap('2026-11-27T00:00:00.000Z')).toBe('27 NOV');
  });
});

describe('octilinear layout', () => {
  const lines = [
    { id: 'orders', stations: ['finance', 'sales', 'marketing', 'science'] },
    { id: 'customers', stations: ['marketing', 'care', 'sales'] },
    { id: 'inventory', stations: ['supply', 'finance', 'science'] },
    { id: 'sessions', stations: ['marketing', 'science'] },
    { id: 'fx', stations: [] },
  ];

  it('routes every edge octilinearly', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 3, y: 0 }],
      [{ x: 0, y: 0 }, { x: 2, y: 2 }],
      [{ x: 0, y: 0 }, { x: 4, y: 1 }],
      [{ x: 1, y: 3 }, { x: 0, y: 0 }],
    ]) {
      const r = routeEdge(a, b);
      for (let i = 1; i < r.length; i++) {
        const dx = Math.abs(r[i].x - r[i - 1].x);
        const dy = Math.abs(r[i].y - r[i - 1].y);
        expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-9).toBe(true);
      }
      expect(r[0]).toEqual(a);
      expect(r[r.length - 1]).toEqual(b);
    }
  });

  it('is deterministic, places every node on its own cell and routes every line from its terminal', () => {
    const a = layoutNetwork(lines, { aspect: 1.2, seedKey: 'test' });
    const b = layoutNetwork(lines, { aspect: 1.2, seedKey: 'test' });
    expect([...a.pos.entries()]).toEqual([...b.pos.entries()]);
    const cells = new Set([...a.pos.values()].map((p) => `${p.x},${p.y}`));
    expect(cells.size).toBe(a.pos.size);
    expect(a.pos.size).toBe(5 + 6);
    for (const l of lines) {
      const r = a.routes.get(l.id)!;
      expect(r[0]).toBe(terminalNode(l.id));
      expect(new Set(r.slice(1))).toEqual(new Set(l.stations.map(stationNode)));
    }
  });

  it('builds geometry with lanes, station lamps and labels', () => {
    const layout = layoutNetwork(lines, { aspect: 1.2, seedKey: 'test' });
    const g = buildGeometry({
      layout,
      lines: lines.map((l) => ({ id: l.id, name: l.id, sub: 'Team', stations: l.stations })),
      stations: ['finance', 'sales', 'marketing', 'science', 'care', 'supply'].map((k) => ({ key: k, name: k })),
    });
    expect(g.lines.get('fx')!.stub).not.toBeNull();
    expect(g.stations.get('marketing')!.lamps.size).toBe(3);
    for (const l of lines) for (const s of l.stations) expect(g.lines.get(l.id)!.stationAt.has(s)).toBe(true);
    expect(g.bbox.w).toBeGreaterThan(0);
  });

  it('settles a larger network quickly', () => {
    const big = Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, stations: Array.from({ length: 4 }, (_, k) => `s${(i * 3 + k * 5) % 16}`) }));
    const t = performance.now();
    const res = layoutNetwork(big, { restarts: 1 });
    expect(performance.now() - t).toBeLessThan(4000);
    expect(res.pos.size).toBe(9 + 16);
  });
});

describe('geometry helpers', () => {
  it('offsets, rounds and walks polylines', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const off = offsetPolyline(pts, 2);
    expect(off[0]).toEqual({ x: 0, y: 2 });
    expect(roundedPath(pts, 4)).toMatch(/^M0,0L6,0Q10,0 10,4L10,10$/);
    expect(pointAt(pts, 15).p).toEqual({ x: 10, y: 5 });
  });
});
