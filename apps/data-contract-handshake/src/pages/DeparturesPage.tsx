/**
 * Departures: the split-flap board of every open service (published change notice), soonest departure first, with a
 * signal lamp per consumer team. Filter by line, station and change type; W opens the wall screen.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tv, X } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { normKey, plural, useAsync, useNow, usePolling } from '@x10/shared/lib';
import {
  Button,
  DataState,
  EmptyState,
  FilterSelect,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Stat,
  StatStrip,
  Toolbar,
  useHotkeys,
} from '@x10/shared/ui';

import { rules } from '../config';
import { loadSnapshot } from '../domain/contracts';
import { daysUntil, formatDay, localToday } from '../domain/days';
import { atRiskTypesLabel } from '../domain/health';
import type { ChangeType, Schema } from '../model';
import { DeparturesBoard, LineBullet } from '../metro/DeparturesBoard';
import { buildNetwork } from '../metro/network';

type TypeFilter = 'all' | ChangeType;

export function DeparturesPage() {
  const { store } = useApp<Schema>();
  const data = useAsync(async () => buildNetwork(await loadSnapshot(store), localToday()), [store]);
  usePolling(data.reload, rules.pollMs);
  const now = useNow(15_000);
  const [line, setLine] = useState('all');
  const [station, setStation] = useState('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [wall, setWall] = useState(false);
  useHotkeys({ w: () => setWall((w) => !w), escape: () => setWall(false) }, { allowInDialogs: true });

  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);

  return (
    <>
      <PageHeader
        title="Departures"
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="dch-lamp" data-blink="true" style={{ ['--lamp' as string]: 'var(--ok-solid)', width: 7, height: 7 }} />
              Live, refreshes every {rules.pollMs / 1000} s
            </span>
            <span>{atRiskTypesLabel()} changes get a final call {rules.atRiskDays} days out</span>
          </>
        }
        actions={
          <Button icon={<Tv />} onClick={() => setWall(true)} aria-keyshortcuts="w">
            Wall screen
          </Button>
        }
      />
      <DataState
        state={data}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton height={88} />
            <Skeleton height={360} />
          </div>
        }
      >
        {(net) => {
          const shown = net.services.filter(
            (s) =>
              (line === 'all' || s.lineId === line) &&
              (station === 'all' || s.acks.some((a) => normKey(a.teamName) === station)) &&
              (type === 'all' || s.notice.changeType === type),
          );
          const count = (h: string) => net.services.filter((s) => s.health.health === h).length;
          const drafts = net.lines.flatMap((l) => l.drafts.map((d) => ({ d, l }))).sort((a, b) => a.d.effectiveDate.localeCompare(b.d.effectiveDate));
          return (
            <>
              <StatStrip className="mb-6">
                <Stat label="Services running" value={net.services.length} hint={`${plural(net.lines.length, 'line')}`} />
                <Stat label="Final call" value={count('at_risk')} tone={count('at_risk') ? 'warn' : undefined} hint="At risk" />
                <Stat label="Delayed" value={count('overdue')} tone={count('overdue') ? 'bad' : undefined} hint="Overdue" />
                <Stat label="Held at a signal" value={count('blocked')} tone={count('blocked') ? 'bad' : undefined} hint="Blocked by an objection" />
              </StatStrip>
              <Toolbar>
                <FilterSelect
                  label="Line"
                  value={line}
                  onChange={setLine}
                  options={[{ value: 'all', label: 'All lines' }, ...net.lines.map((l) => ({ value: l.id, label: l.contract.name }))]}
                />
                <FilterSelect
                  label="Station"
                  value={station}
                  onChange={setStation}
                  options={[{ value: 'all', label: 'All stations' }, ...net.stations.map((s) => ({ value: s.key, label: s.name }))]}
                />
                <SegmentedControl<TypeFilter>
                  label="Change type"
                  value={type}
                  onChange={setType}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'breaking', label: 'Breaking' },
                    { value: 'deprecation', label: 'Deprecation' },
                    { value: 'additive', label: 'Additive' },
                  ]}
                />
              </Toolbar>
              {net.services.length === 0 ? (
                <EmptyState title="No services running" action={<Link to="/timetable">Open the timetable</Link>}>
                  Published change notices show up here with their departure date.
                </EmptyState>
              ) : (
                <DeparturesBoard services={shown} lines={net.lines} clock={clock} empty="No departures match these filters" />
              )}

              {drafts.length > 0 && (
                <section className="mt-10" aria-labelledby="depot">
                  <h2 id="depot" className="m-0 text-base font-semibold">
                    In the depot
                  </h2>
                  <p className="m-0 mt-0.5 text-ui text-muted">Drafts nobody has been asked about yet.</p>
                  <ul className="m-0 mt-3 list-none divide-y divide-[var(--line)] border-y border-line p-0">
                    {drafts.map(({ d, l }) => {
                      const left = daysUntil(d.effectiveDate, localToday());
                      return (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <LineBullet line={l} size={18} />
                            <Link to={`/notices/${d.id}`} className="min-w-0 truncate font-medium">
                              {d.title}
                            </Link>
                          </span>
                          <span className="flex items-center gap-3 text-ui text-muted">
                            <span>{l.contract.name}</span>
                            <span className={left < 0 ? 'font-mono text-bad-text num' : 'font-mono num'}>{formatDay(d.effectiveDate)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {wall && (
                <div className="dch-board dch-wall flex flex-col p-6 md:p-10" role="dialog" aria-modal="true" aria-label="Departures wall screen">
                  <div className="mb-4 flex justify-end">
                    <Button variant="ghost" icon={<X />} onClick={() => setWall(false)} className="text-[var(--board-ink)]! hover:bg-[var(--board-2)]!">
                      Exit wall screen
                    </Button>
                  </div>
                  <DeparturesBoard services={net.services} lines={net.lines} clock={clock} size="lg" className="flex-1 shadow-none" />
                </div>
              )}
            </>
          );
        }}
      </DataState>
    </>
  );
}
