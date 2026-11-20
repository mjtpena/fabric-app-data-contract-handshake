/**
 * The transit network: the app's data re-read as a metro map (pure, unit-tested).
 *
 * - A contract is a line. Its producer is the line's terminal.
 * - A consumer team is a station. A team that consumes several contracts is an interchange.
 * - A consumer registration (contract × team) is a stop of that line at that station.
 * - A published change notice is a train (a "service") on its line; its effective date is the departure.
 * - Each ack is a signal at a stop: acknowledged, migrated, objected or pending.
 */
import { normKey } from '@x10/shared/lib';

import { withHealth, type Snapshot } from '../domain/contracts';
import { worstHealth, type Health, type HealthResult } from '../domain/health';
import type { Ack, AckStatus, ChangeNotice, ChangeType, Consumer, Contract } from '../model';

export type Signal = AckStatus | 'none';

/** Line colours, in order of the contract's registration. Named ramps, step 9 (both themes). */
export const LINE_RAMPS = ['blue', 'gold', 'teal', 'plum', 'coral', 'cyan', 'violet', 'amber', 'indigo', 'ember'] as const;

export interface NetService {
  id: string;
  notice: ChangeNotice;
  lineId: string;
  health: HealthResult;
  acks: Ack[];
  counts: Record<AckStatus, number>;
}

export interface NetStop {
  lineId: string;
  stationKey: string;
  consumer: Consumer;
  /** Worst signal of this team over the line's open services ('none' when the line has none). */
  signal: Signal;
  pending: number;
}

export interface NetLine {
  id: string;
  contract: Contract;
  /** Two-letter code drawn on the terminal ("OF" for Orders fact table). */
  code: string;
  ramp: (typeof LINE_RAMPS)[number];
  color: string;
  /** Station keys of the line's consumers, in registration order. */
  stationKeys: string[];
  stops: NetStop[];
  /** Open (published) services, soonest departure first. */
  services: NetService[];
  drafts: ChangeNotice[];
  closed: ChangeNotice[];
  worst: Health | null;
  /** Most severe change type among open services. */
  severestType: ChangeType | null;
  /** Days to the soonest open departure (negative when late). */
  soonest: number | null;
}

export interface NetStation {
  key: string;
  name: string;
  lineIds: string[];
  stops: NetStop[];
  pending: number;
  objected: number;
  signal: Signal;
}

export interface Network {
  lines: NetLine[];
  stations: NetStation[];
  /** Every open service on the network, soonest departure first. */
  services: NetService[];
  today: string;
}

const signalRank: Record<Signal, number> = { none: 0, migrated: 1, acknowledged: 2, pending: 3, objected: 4 };

export function worstSignal(list: Signal[]): Signal {
  return list.reduce<Signal>((w, s) => (signalRank[s] > signalRank[w] ? s : w), 'none');
}

const typeRank: Record<ChangeType, number> = { additive: 1, deprecation: 2, breaking: 3 };

/** "Orders fact table" → "OF"; "Web sessions" → "WS"; single words take two letters. */
export function lineCode(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Build the network from a snapshot. Lines keep registration order so colours stay stable. */
export function buildNetwork(s: Snapshot, today: string): Network {
  const all = withHealth(s.notices, s.acks, today);
  const contracts = [...s.contracts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  const stationMap = new Map<string, NetStation>();
  const services: NetService[] = [];

  const lines = contracts.map((contract, i): NetLine => {
    const ramp = LINE_RAMPS[i % LINE_RAMPS.length];
    const mine = all.filter((n) => n.notice.contractId === contract.id);
    const open = mine
      .filter((n) => n.notice.status === 'published')
      .sort((a, b) => a.notice.effectiveDate.localeCompare(b.notice.effectiveDate))
      .map(
        (n): NetService => ({
          id: n.notice.id,
          notice: n.notice,
          lineId: contract.id,
          health: n.health,
          acks: n.acks,
          counts: {
            pending: n.acks.filter((a) => a.status === 'pending').length,
            acknowledged: n.acks.filter((a) => a.status === 'acknowledged').length,
            objected: n.acks.filter((a) => a.status === 'objected').length,
            migrated: n.acks.filter((a) => a.status === 'migrated').length,
          },
        }),
      );
    services.push(...open);
    const consumers = s.consumers
      .filter((c) => c.contractId === contract.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.teamName.localeCompare(b.teamName));
    const stops = consumers.map((consumer): NetStop => {
      const acks = open.flatMap((svc) => svc.acks.filter((a) => a.consumerId === consumer.id));
      return {
        lineId: contract.id,
        stationKey: normKey(consumer.teamName),
        consumer,
        signal: worstSignal(acks.map((a) => a.status)),
        pending: acks.filter((a) => a.status === 'pending').length,
      };
    });
    for (const stop of stops) {
      let st = stationMap.get(stop.stationKey);
      if (!st) {
        st = { key: stop.stationKey, name: stop.consumer.teamName.trim().replace(/\s+/g, ' '), lineIds: [], stops: [], pending: 0, objected: 0, signal: 'none' };
        stationMap.set(stop.stationKey, st);
      }
      if (!st.lineIds.includes(contract.id)) st.lineIds.push(contract.id);
      st.stops.push(stop);
    }
    const severest = open.reduce<ChangeType | null>(
      (w, svc) => (w === null || typeRank[svc.notice.changeType] > typeRank[w] ? svc.notice.changeType : w),
      null,
    );
    return {
      id: contract.id,
      contract,
      code: lineCode(contract.name),
      ramp,
      color: `var(--${ramp}-9)`,
      stationKeys: [...new Set(stops.map((x) => x.stationKey))],
      stops,
      services: open,
      drafts: mine.filter((n) => n.notice.status === 'draft').map((n) => n.notice),
      closed: mine.filter((n) => n.notice.status === 'closed').map((n) => n.notice),
      worst: worstHealth(open.map((n) => n.health.health)),
      severestType: severest,
      soonest: open.length ? Math.min(...open.map((n) => n.health.daysLeft)) : null,
    };
  });

  for (const st of stationMap.values()) {
    st.pending = st.stops.reduce((n, x) => n + x.pending, 0);
    st.objected = st.stops.filter((x) => x.signal === 'objected').length;
    st.signal = worstSignal(st.stops.map((x) => x.signal));
  }

  return {
    lines,
    stations: [...stationMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    services: services.sort(
      (a, b) => a.notice.effectiveDate.localeCompare(b.notice.effectiveDate) || a.notice.title.localeCompare(b.notice.title),
    ),
    today,
  };
}

/* ------------------------------------------------------------------ view as */

export type ViewAs = 'all' | 'producer' | 'consumer';

/** Producer subject meaning "the lines I own" (the viewer's contracts, whatever their producer team). */
export const MY_LINES = '__mine__';

/**
 * Which lines and stations stay lit for a perspective. `subject` is a producer team (or MY_LINES with `meSub`) or a
 * consumer team / station key.
 */
export function perspective(
  net: Network,
  viewAs: ViewAs,
  subject: string | null,
  meSub?: string,
): { lines: Set<string>; stations: Set<string> } {
  if (viewAs === 'producer' && subject) {
    const lines =
      subject === MY_LINES
        ? net.lines.filter((l) => l.contract.ownerSub === meSub)
        : net.lines.filter((l) => normKey(l.contract.producerTeam) === normKey(subject));
    return { lines: new Set(lines.map((l) => l.id)), stations: new Set(lines.flatMap((l) => l.stationKeys)) };
  }
  if (viewAs === 'consumer' && subject) {
    const st = net.stations.find((s) => s.key === normKey(subject));
    return { lines: new Set(st?.lineIds ?? []), stations: new Set(st ? [st.key] : []) };
  }
  return { lines: new Set(net.lines.map((l) => l.id)), stations: new Set(net.stations.map((s) => s.key)) };
}

export function producerTeams(net: Network): string[] {
  const seen = new Map<string, string>();
  for (const l of net.lines) if (!seen.has(normKey(l.contract.producerTeam))) seen.set(normKey(l.contract.producerTeam), l.contract.producerTeam);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Services shown for a perspective: a producer's lines, or the services with a signal at the consumer's station. */
export function servicesFor(net: Network, viewAs: ViewAs, subject: string | null, meSub?: string): NetService[] {
  if (viewAs === 'all' || !subject) return net.services;
  if (viewAs === 'producer') {
    const lit = perspective(net, viewAs, subject, meSub).lines;
    return net.services.filter((s) => lit.has(s.lineId));
  }
  const key = normKey(subject);
  return net.services.filter((s) => s.acks.some((a) => normKey(a.teamName) === key));
}

/* ------------------------------------------------------------------ today */

export type FocusTarget = { kind: 'service' | 'station' | 'line'; id: string };

export type LensKey = 'signal' | 'type' | 'departure' | 'team';

export interface TodayEntry {
  id: string;
  target: FocusTarget;
  title: string;
  severity: 'bad' | 'warn' | 'info' | 'ok' | 'neutral';
  value: string;
  unit: string;
  lens: LensKey;
  meta: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The three to five things that need attention now, ranked: held services (objections), late departures with signals
 * still pending, final calls (breaking changes inside the at-risk window), the busiest station, then a line without
 * stations. In a consumer perspective, the station's own pending signals come first, soonest departure first.
 */
export function buildToday(net: Network, viewAs: ViewAs, subject: string | null, max = 5, meSub?: string): TodayEntry[] {
  const out: TodayEntry[] = [];
  const services = servicesFor(net, viewAs, subject, meSub);
  const lineOf = (id: string) => net.lines.find((l) => l.id === id);

  if (viewAs === 'consumer' && subject) {
    const key = normKey(subject);
    for (const svc of services) {
      const ack = svc.acks.find((a) => normKey(a.teamName) === key);
      if (!ack || (ack.status !== 'pending' && ack.status !== 'objected')) continue;
      const d = svc.health.daysLeft;
      out.push({
        id: `svc:${svc.id}`,
        target: { kind: 'service', id: svc.id },
        title: ack.status === 'objected' ? `${svc.notice.title}: your objection holds it` : svc.notice.title,
        severity: ack.status === 'objected' || d < 0 ? 'bad' : d <= 7 ? 'warn' : 'info',
        value: d < 0 ? `+${-d}` : String(d),
        unit: d < 0 ? (d === -1 ? 'day late' : 'days late') : d === 1 ? 'day to go' : 'days to go',
        lens: ack.status === 'objected' ? 'signal' : 'departure',
        meta: lineOf(svc.lineId)?.contract.name ?? '',
      });
    }
    return out.slice(0, max);
  }

  const by = (h: Health) => services.filter((s) => s.health.health === h);
  for (const svc of by('blocked')) {
    out.push({
      id: `svc:${svc.id}`,
      target: { kind: 'service', id: svc.id },
      title: `${svc.notice.title} is held at a signal`,
      severity: 'bad',
      value: String(svc.counts.objected),
      unit: svc.counts.objected === 1 ? 'objection' : 'objections',
      lens: 'signal',
      meta: lineOf(svc.lineId)?.contract.name ?? '',
    });
  }
  for (const svc of by('overdue')) {
    out.push({
      id: `svc:${svc.id}`,
      target: { kind: 'service', id: svc.id },
      title: `${svc.notice.title} left late, ${plural(svc.counts.pending, 'signal')} pending`,
      severity: 'bad',
      value: `+${-svc.health.daysLeft}`,
      unit: svc.health.daysLeft === -1 ? 'day late' : 'days late',
      lens: 'departure',
      meta: lineOf(svc.lineId)?.contract.name ?? '',
    });
  }
  for (const svc of by('at_risk')) {
    out.push({
      id: `svc:${svc.id}`,
      target: { kind: 'service', id: svc.id },
      title: `Final call: ${svc.notice.title}`,
      severity: 'warn',
      value: String(svc.health.daysLeft),
      unit: svc.health.daysLeft === 1 ? 'day to go' : 'days to go',
      lens: 'departure',
      meta: `${lineOf(svc.lineId)?.contract.name ?? ''} · ${plural(svc.counts.pending, 'signal')} pending`,
    });
  }
  const lit = perspective(net, viewAs, subject, meSub);
  const busiest = net.stations.filter((s) => lit.stations.has(s.key) && s.pending > 0).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name))[0];
  if (busiest) {
    out.push({
      id: `st:${busiest.key}`,
      target: { kind: 'station', id: busiest.key },
      title: `${busiest.name} has the most signals to answer`,
      severity: 'info',
      value: String(busiest.pending),
      unit: busiest.pending === 1 ? 'signal pending' : 'signals pending',
      lens: 'team',
      meta: plural(busiest.lineIds.length, 'line'),
    });
  }
  for (const line of net.lines) {
    if (!lit.lines.has(line.id) || line.stops.length > 0) continue;
    out.push({
      id: `line:${line.id}`,
      target: { kind: 'line', id: line.id },
      title: `${line.contract.name} has no stations`,
      severity: 'neutral',
      value: String(line.services.length),
      unit: line.services.length === 1 ? 'service, nobody asked' : 'services, nobody asked',
      lens: 'team',
      meta: line.contract.producerTeam,
    });
  }
  return out.slice(0, max);
}

/* ------------------------------------------------------------------ search */

/** Fly-to search over stations, lines and services. */
export function searchNetwork(net: Network, q: string): FocusTarget | null {
  const k = normKey(q);
  if (!k) return null;
  const svc = net.services.find((s) => normKey(s.notice.title).includes(k));
  const st = net.stations.find((s) => s.key.includes(k));
  const line = net.lines.find((l) => normKey(`${l.contract.name} ${l.contract.sourceRef} ${l.contract.producerTeam}`).includes(k));
  if (st && st.key.startsWith(k)) return { kind: 'station', id: st.key };
  if (line && normKey(line.contract.name).startsWith(k)) return { kind: 'line', id: line.id };
  if (st) return { kind: 'station', id: st.key };
  if (line) return { kind: 'line', id: line.id };
  if (svc) return { kind: 'service', id: svc.id };
  return null;
}
