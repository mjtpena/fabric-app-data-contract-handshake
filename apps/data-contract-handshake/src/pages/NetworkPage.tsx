/**
 * Home: the transit network. Contracts are lines, consumer teams are stations, open change notices are trains with a
 * departure countdown. Lenses (1–4), view as producer or consumer team (V), Today (fly to what needs attention),
 * the list view (L) and keyboard shortcuts (?).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CloudOff, List as ListIcon, Map as MapIcon, RefreshCw, Search, TrainFront } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { normKey, plural, useAsync, usePolling } from '@x10/shared/lib';
import {
  Badge,
  Button,
  Dialog,
  FilterSelect,
  Input,
  Kbd,
  Legend,
  LensBar,
  LinkButton,
  Spinner,
  StageMessage,
  StagePage,
  Table,
  TableWrap,
  Td,
  Th,
  TodayPanel,
  Tr,
  ViewAsSwitch,
  ViewToggle,
  useHotkeys,
  useIsDesktop,
  type StageView,
  type TodayItem,
} from '@x10/shared/ui';

import { rules } from '../config';
import { loadSnapshot } from '../domain/contracts';
import { formatDay, localToday } from '../domain/days';
import { ackMeta, changeTypeMeta, healthMeta } from '../domain/health';
import { myScope } from '../domain/teams';
import type { Schema } from '../model';
import { DeparturesBoard, LineBullet, SignalLamps } from '../metro/DeparturesBoard';
import { MetroMap } from '../metro/MetroMap';
import { LENSES, countdown, legendFor, remarkMeta, signalMeta } from '../metro/meta';
import {
  MY_LINES,
  buildNetwork,
  buildToday,
  perspective,
  producerTeams,
  searchNetwork,
  servicesFor,
  type FocusTarget,
  type LensKey,
  type Network,
  type ViewAs,
} from '../metro/network';
import { SplitFlap } from '../metro/SplitFlap';

export function NetworkPage() {
  const { store, me } = useApp<Schema>();
  const data = useAsync(async () => {
    const [snapshot, scope] = await Promise.all([loadSnapshot(store), myScope(store, me.sub)]);
    return { net: buildNetwork(snapshot, localToday()), scope };
  }, [store, me]);
  usePolling(data.reload, rules.pollMs);

  const [lens, setLens] = useState<LensKey>('signal');
  const [view, setView] = useState<StageView>('stage');
  const [viewAs, setViewAs] = useState<ViewAs>('all');
  const [subject, setSubject] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [q, setQ] = useState('');
  const [help, setHelp] = useState(false);
  const desktop = useIsDesktop();
  const search = useRef<HTMLInputElement>(null);

  const net = data.data?.net;
  const scope = data.data?.scope;

  // default subject per perspective: the viewer's own producer team or consumer team
  const ownsLines = !!net?.lines.some((l) => l.contract.ownerSub === me.sub);
  const subjectOptions = !net
    ? []
    : viewAs === 'producer'
      ? [...(ownsLines ? [{ value: MY_LINES, label: 'My lines' }] : []), ...producerTeams(net).map((o) => ({ value: o, label: o }))]
      : net.stations.map((s) => ({ value: s.name, label: s.name }));
  useEffect(() => {
    if (!net || viewAs === 'all') return;
    if (subject && subjectOptions.some((o) => normKey(o.value) === normKey(subject))) return;
    const mine = viewAs === 'producer' ? (ownsLines ? MY_LINES : undefined) : scope?.teams.find((t) => net.stations.some((s) => s.key === normKey(t)));
    setSubject(mine ?? subjectOptions[0]?.value ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, viewAs, subject, scope, ownsLines]);

  useHotkeys({
    'shift+?': () => setHelp(true),
    escape: () => setFocus(null),
    '/': () => search.current?.focus(),
  });

  const subj = viewAs === 'all' ? null : subject;
  const lit = useMemo(
    () => (net ? perspective(net, viewAs, subj, me.sub) : { lines: new Set<string>(), stations: new Set<string>() }),
    [net, viewAs, subj, me.sub],
  );
  const today = useMemo(() => (net ? buildToday(net, viewAs, subj, 5, me.sub) : []), [net, viewAs, subj, me.sub]);

  const choose = (t: FocusTarget | null, lensFor?: LensKey) => {
    setFocus(t);
    if (lensFor) setLens(lensFor);
  };

  const fly = () => {
    if (!net) return;
    const hit = searchNetwork(net, q);
    if (hit) {
      choose(hit);
      if (view === 'list') setView('stage');
    }
  };

  const viewAsOptions = [
    { value: 'all' as const, label: 'All' },
    { value: 'producer' as const, label: 'Producer' },
    { value: 'consumer' as const, label: 'Team' },
  ];

  const subjectSelect =
    net && viewAs !== 'all' && subject ? (
      <FilterSelect
        label={viewAs === 'producer' ? 'Producer' : 'Team'}
        value={subject}
        onChange={(v) => {
          setSubject(v);
          setFocus(null);
        }}
        options={subjectOptions}
        className={view === 'stage' ? 'x-glass max-w-[240px] rounded-full!' : 'max-w-[240px]'}
      />
    ) : null;

  const focusedTitle = net && focus ? titleOf(net, focus) : null;
  const svcs = net ? servicesFor(net, viewAs, subj, me.sub) : [];
  const next = svcs.find((s) => s.health.daysLeft >= 0) ?? svcs[0];

  const legend = net ? legendFor(lens, net) : null;
  const todayItems: TodayItem[] = today.map((t) => ({
    id: t.id,
    title: t.title,
    severity: t.severity,
    value: t.value,
    unit: t.unit,
    lens: LENSES.find((l) => l.value === t.lens)?.label,
    meta: t.meta,
  }));
  const activeToday = focus ? today.find((t) => t.target.kind === focus.kind && t.target.id === focus.id)?.id ?? null : null;

  const stage = data.error && !net ? (
    <StageMessage icon={<CloudOff />} title="The network did not load" action={<Button icon={<RefreshCw />} onClick={() => void data.reload()}>Retry</Button>}>
      {data.error.message}
    </StageMessage>
  ) : !net ? (
    <StageMessage icon={<Spinner small />} title="Laying track…" />
  ) : net.lines.length === 0 ? (
    <StageMessage icon={<TrainFront />} title="No lines yet" action={<LinkButton to="/lines" variant="primary">Register a contract</LinkButton>}>
      Each contract you register becomes a line; each consumer team, a station.
    </StageMessage>
  ) : (
    <MetroMap
      net={net}
      lens={lens}
      focus={focus}
      onFocus={(t) => setFocus(t)}
      lit={lit}
      insets={desktop ? { top: 132, bottom: 96, left: 40, right: 72 } : { top: 64, bottom: 56, left: 16, right: 56 }}
      className="inset-y-0! left-0 right-auto! w-[calc(100%-var(--side-w,0px))]"
    />
  );

  return (
    <>
      <StagePage
        label="Transit map"
        view={view}
        breadcrumb={
          focusedTitle
            ? [{ label: 'Network', onClick: () => setFocus(null) }, { label: focusedTitle.kind }]
            : undefined
        }
        title={focusedTitle ? focusedTitle.name : 'The network'}
        meta={
          net ? (
            <span className="flex min-w-0 flex-col gap-2">
              <span className="num">
                {plural(net.lines.length, 'line')} · {plural(net.stations.length, 'station')} · {plural(net.services.length, 'service')} running
              </span>
              {next && view === 'stage' && !focus && (
                <Link
                  to={`/notices/${next.id}`}
                  className="dch-board inline-flex max-w-full items-center gap-2 self-start rounded-lg px-2 py-1.5 no-underline"
                  aria-label={`Next departure: ${next.notice.title}, ${countdown(next.health.daysLeft)}`}
                  data-testid="next-departure"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--board-muted)]">Next</span>
                  <SplitFlap text={countdown(next.health.daysLeft)} className="text-[12px]" color="var(--board-amber)" />
                  <SplitFlap text={next.notice.title} length={desktop ? 22 : 18} className="text-[12px]" delay={120} />
                </Link>
              )}
            </span>
          ) : (
            'Loading the network'
          )
        }
        topRight={
          <>
            <form
              role="search"
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                fly();
              }}
            >
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-faint" />
              <label htmlFor="fly-to" className="sr-only">
                Fly to a line, station or service
              </label>
              <Input
                ref={search}
                id="fly-to"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Fly to…"
                className={view === 'stage' ? 'x-glass w-44 rounded-full! pl-8' : 'w-44 pl-8'}
              />
            </form>
            {subjectSelect}
            <ViewToggle value={view} onChange={setView} glass={view === 'stage'} stageLabel="Map" listLabel="List" stageIcon={<MapIcon />} listIcon={<ListIcon />} />
          </>
        }
        lenses={<LensBar lenses={LENSES} value={lens} onChange={setLens} />}
        legend={legend && <Legend title={legend.title} items={legend.items} collapsible defaultOpen={desktop} />}
        bottomRight={
          <ViewAsSwitch
            options={viewAsOptions}
            value={viewAs}
            onChange={(v) => {
              setViewAs(v);
              setFocus(null);
            }}
          />
        }
        side={
          net ? (
            <div className="flex flex-col gap-4">
              <TodayPanel
                bare
                items={todayItems}
                date={new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())}
                activeId={activeToday}
                empty="Every signal on these lines is green."
                onSelect={(it) => {
                  const t = today.find((x) => x.id === it.id);
                  if (t) {
                    choose(t.target, t.lens);
                    if (view === 'list') setView('stage');
                  }
                }}
              />
              {focus && <FocusCard net={net} focus={focus} myTeams={scope?.teams ?? []} meSub={me.sub} onClear={() => setFocus(null)} />}
            </div>
          ) : undefined
        }
        sideCount={today.length}
        stage={stage}
        list={net ? <NetworkList net={net} viewAs={viewAs} subject={subj} meSub={me.sub} /> : null}
      >
        {!desktop && net && focus && <FocusCard net={net} focus={focus} myTeams={scope?.teams ?? []} meSub={me.sub} onClear={() => setFocus(null)} />}
        {!desktop && net && view === 'stage' && <DeparturesBoard lines={net.lines} services={svcs.slice(0, 4)} title="Next departures" className="mt-4" />}
      </StagePage>
      <CheatSheet open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function titleOf(net: Network, f: FocusTarget): { name: string; kind: string } | null {
  if (f.kind === 'service') {
    const s = net.services.find((x) => x.id === f.id);
    return s ? { name: s.notice.title, kind: 'Service' } : null;
  }
  if (f.kind === 'line') {
    const l = net.lines.find((x) => x.id === f.id);
    return l ? { name: l.contract.name, kind: 'Line' } : null;
  }
  const st = net.stations.find((x) => x.key === f.id);
  return st ? { name: st.name, kind: st.lineIds.length > 1 ? 'Interchange' : 'Station' } : null;
}

/* ------------------------------------------------------------------ focus card */

function FocusCard({
  net,
  focus,
  myTeams,
  meSub,
  onClear,
}: {
  net: Network;
  focus: FocusTarget;
  myTeams: string[];
  meSub: string;
  onClear: () => void;
}) {
  const lineOf = (id: string) => net.lines.find((l) => l.id === id)!;
  let body: ReactNode = null;
  if (focus.kind === 'service') {
    const svc = net.services.find((s) => s.id === focus.id);
    if (!svc) return null;
    const line = lineOf(svc.lineId);
    const r = remarkMeta[svc.health.health];
    const mine = svc.acks.some((a) => a.status === 'pending' && myTeams.some((t) => normKey(t) === normKey(a.teamName)));
    body = (
      <>
        <div className="flex items-center gap-2 text-ui text-muted">
          <LineBullet line={line} size={18} />
          <span className="truncate">{line.contract.name}</span>
        </div>
        <Link to={`/notices/${svc.id}`} className="mt-1.5 block text-base font-semibold leading-6 text-fg no-underline hover:underline">
          {svc.notice.title}
        </Link>
        <div className="dch-board mt-3 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2">
          <SplitFlap text={countdown(svc.health.daysLeft)} className="text-[13px]" color="var(--board-amber)" />
          <span className="font-mono text-[11px] text-[var(--board-muted)]">{formatDay(svc.notice.effectiveDate)}</span>
          <SplitFlap text={r.board} className="text-[13px]" color={r.boardColor} />
        </div>
        <ul className="m-0 mt-3 list-none divide-y divide-[var(--line)] p-0" aria-label="Signals">
          {[...svc.acks]
            .sort((a, b) => a.teamName.localeCompare(b.teamName))
            .map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="dch-lamp" style={{ ['--lamp' as string]: signalMeta[a.status].color }} />
                  <span className="truncate">{a.teamName}</span>
                </span>
                <span className="shrink-0 text-ui text-muted">{ackMeta[a.status].label}</span>
              </li>
            ))}
        </ul>
        {svc.acks.length === 0 && <p className="m-0 mt-2 text-ui text-muted">No stations on this line, so nobody was asked.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton to={`/notices/${svc.id}`} size="sm" variant="primary" iconRight={<ArrowRight />}>
            Open service
          </LinkButton>
          {mine && (
            <LinkButton to="/inbox" size="sm">
              Answer in the signal box
            </LinkButton>
          )}
        </div>
      </>
    );
  } else if (focus.kind === 'line') {
    const line = net.lines.find((l) => l.id === focus.id);
    if (!line) return null;
    body = (
      <>
        <div className="flex items-start gap-2.5">
          <LineBullet line={line} size={28} />
          <div className="min-w-0">
            <Link to={`/contracts/${line.id}`} className="block text-base font-semibold leading-6 text-fg no-underline hover:underline">
              {line.contract.name}
            </Link>
            <div className="truncate font-mono text-xs text-muted">{line.contract.sourceRef}</div>
          </div>
        </div>
        <div className="mt-2 text-ui text-muted">
          {line.contract.producerTeam} · {line.contract.ownerName}
          {line.contract.ownerSub === meSub ? ' (you)' : ''}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {line.stops.length === 0 ? (
            <Badge tone="neutral">No stations</Badge>
          ) : (
            line.stops.map((s) => (
              <span key={s.stationKey} className="inline-flex items-center gap-1.5 rounded-md bg-gray-3 px-2 py-0.5 text-xs">
                <span className="dch-lamp" style={{ ['--lamp' as string]: signalMeta[s.signal].color, width: 7, height: 7 }} />
                {s.consumer.teamName}
              </span>
            ))
          )}
        </div>
        {line.services.length > 0 && (
          <ul className="m-0 mt-3 list-none divide-y divide-[var(--line)] p-0" aria-label="Services on this line">
            {line.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <Link to={`/notices/${s.id}`} className="min-w-0 truncate text-fg">
                  {s.notice.title}
                </Link>
                <span className="shrink-0 font-mono text-xs text-muted num">{countdown(s.health.daysLeft)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton to={`/contracts/${line.id}`} size="sm" variant="primary" iconRight={<ArrowRight />}>
            Line status
          </LinkButton>
          {line.contract.ownerSub === meSub && (
            <LinkButton to={`/contracts/${line.id}/notices/new`} size="sm">
              Announce a change
            </LinkButton>
          )}
        </div>
      </>
    );
  } else {
    const st = net.stations.find((s) => s.key === focus.id);
    if (!st) return null;
    body = (
      <>
        <div className="text-base font-semibold leading-6">{st.name}</div>
        <div className="text-ui text-muted">
          {st.lineIds.length > 1 ? `Interchange · ${plural(st.lineIds.length, 'line')}` : 'Station · 1 line'} · {plural(st.pending, 'signal')} to answer
        </div>
        <ul className="m-0 mt-3 list-none divide-y divide-[var(--line)] p-0" aria-label="Lines at this station">
          {st.stops.map((s) => {
            const line = lineOf(s.lineId);
            return (
              <li key={s.lineId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <LineBullet line={line} size={16} />
                  <Link to={`/contracts/${line.id}`} className="truncate text-fg">
                    {line.contract.name}
                  </Link>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-ui text-muted">
                  <span className="dch-lamp" style={{ ['--lamp' as string]: signalMeta[s.signal].color, width: 7, height: 7 }} />
                  {signalMeta[s.signal].label}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton to="/teams" size="sm" iconRight={<ArrowRight />}>
            Stations
          </LinkButton>
          {myTeams.some((t) => normKey(t) === st.key) && (
            <LinkButton to="/inbox" size="sm" variant="primary">
              Signal box
            </LinkButton>
          )}
        </div>
      </>
    );
  }
  return (
    <section aria-label="Selected" className="border-t border-line px-1 pt-4" data-testid="focus-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="x-legend-label text-muted">Selected</span>
        <button type="button" onClick={onClear} className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-gray-3 hover:text-fg">
          Clear <Kbd>Esc</Kbd>
        </button>
      </div>
      {body}
    </section>
  );
}

/* ------------------------------------------------------------------ list view */

function NetworkList({ net, viewAs, subject, meSub }: { net: Network; viewAs: ViewAs; subject: string | null; meSub: string }) {
  const services = servicesFor(net, viewAs, subject, meSub);
  const lit = perspective(net, viewAs, subject, meSub);
  return (
    <div className="flex flex-col gap-10" data-testid="network-list">
      <section>
        <h2 className="m-0 mb-3 text-base font-semibold">Services ({services.length})</h2>
        <TableWrap label="Services">
          <Table>
            <thead>
              <tr>
                <Th>Departs</Th>
                <Th>Service</Th>
                <Th>Line</Th>
                <Th>Type</Th>
                <Th>Remark</Th>
                <Th>Signals</Th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const line = net.lines.find((l) => l.id === s.lineId)!;
                return (
                  <Tr key={s.id}>
                    <Td className="whitespace-nowrap">
                      <span className="font-mono num">{countdown(s.health.daysLeft)}</span>
                      <div className="text-xs text-muted">{formatDay(s.notice.effectiveDate)}</div>
                    </Td>
                    <Td>
                      <Link to={`/notices/${s.id}`} className="font-medium">
                        {s.notice.title}
                      </Link>
                    </Td>
                    <Td muted>
                      <span className="inline-flex items-center gap-2">
                        <LineBullet line={line} size={16} />
                        {line.contract.name}
                      </span>
                    </Td>
                    <Td muted>{changeTypeMeta[s.notice.changeType].label}</Td>
                    <Td>
                      <Badge tone={remarkMeta[s.health.health].tone}>{healthMeta[s.health.health].label}</Badge>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <SignalLamps service={s} />
                        {s.acks.length > 0 && (
                          <span className="text-xs text-muted num">
                            {s.acks.length - s.counts.pending}/{s.acks.length} answered
                          </span>
                        )}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </section>
      <section>
        <h2 className="m-0 mb-3 text-base font-semibold">Lines and stations</h2>
        <TableWrap label="Lines">
          <Table>
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Producer</Th>
                <Th>Stations and signals</Th>
                <Th numeric>Services</Th>
              </tr>
            </thead>
            <tbody>
              {net.lines
                .filter((l) => lit.lines.has(l.id))
                .map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <LineBullet line={l} size={18} />
                        <Link to={`/contracts/${l.id}`} className="font-medium">
                          {l.contract.name}
                        </Link>
                      </span>
                    </Td>
                    <Td muted>{l.contract.producerTeam}</Td>
                    <Td>
                      {l.stops.length === 0 ? (
                        <span className="text-muted">No stations</span>
                      ) : (
                        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
                          {l.stops.map((s) => (
                            <li key={s.stationKey} className="inline-flex items-center gap-1.5 text-ui">
                              <span className="dch-lamp" style={{ ['--lamp' as string]: signalMeta[s.signal].color, width: 7, height: 7 }} />
                              {s.consumer.teamName}
                              <span className="sr-only">: {signalMeta[s.signal].label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td numeric>{l.services.length}</Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </TableWrap>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ cheat sheet */

function CheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['1 – 4', 'Switch lens: signals, change type, departure, teams'],
    ['V', 'Cycle view as: all, producer, team'],
    ['L', 'Map or list'],
    ['/', 'Fly to a line, station or service'],
    ['+  −  0', 'Zoom in, zoom out, fit the network'],
    ['Esc', 'Clear the selection'],
    ['?', 'This list'],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 divide-y divide-[var(--line)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2 text-sm">
            <dt className="text-muted">{v}</dt>
            <dd className="m-0 flex shrink-0 gap-1">
              {k.split(/\s+/).map((x) => (
                <Kbd key={x}>{x}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
