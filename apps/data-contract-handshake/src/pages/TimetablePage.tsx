/**
 * Timetable: every line's services on a calendar, two weeks back to six weeks ahead. Running services sit on their
 * departure day (coloured by status) with the final-call window behind breaking changes; drafts wait in the depot as
 * dashed outlines; closed services are faint. Owners announce a change from here. Phones get an agenda by week.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Megaphone } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { DAY, plural, useAsync, usePolling, utcDay } from '@x10/shared/lib';
import { DataState, EmptyState, LinkButton, Menu, PageHeader, Skeleton, Button, useIsDesktop, cx } from '@x10/shared/ui';

import { rules } from '../config';
import { loadSnapshot, withHealth } from '../domain/contracts';
import { daysUntil, formatDay, localToday, shiftDays } from '../domain/days';
import type { Health } from '../domain/health';
import type { ChangeNotice, ChangeType, Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';
import { countdown, remarkMeta, typeColor } from '../metro/meta';
import { buildNetwork, type NetLine } from '../metro/network';

const BACK = 14;
const AHEAD = 42;

interface Slot {
  notice: ChangeNotice;
  line: NetLine;
  days: number;
  health: Health | null;
}

export function TimetablePage() {
  const { store, me } = useApp<Schema>();
  const data = useAsync(async () => {
    const s = await loadSnapshot(store);
    const today = localToday();
    const net = buildNetwork(s, today);
    const health = new Map(withHealth(s.notices, s.acks, today).map((n) => [n.notice.id, n.health.health]));
    const slots: Slot[] = s.notices
      .map((n) => ({
        notice: n,
        line: net.lines.find((l) => l.id === n.contractId)!,
        days: daysUntil(n.effectiveDate, today),
        health: n.status === 'published' ? (health.get(n.id) ?? null) : null,
      }))
      .filter((x) => x.line)
      .sort((a, b) => a.notice.effectiveDate.localeCompare(b.notice.effectiveDate));
    return { net, slots, today };
  }, [store]);
  usePolling(data.reload, rules.pollMs);
  const desktop = useIsDesktop();
  const navigate = useNavigate();

  const mine = useMemo(() => data.data?.net.lines.filter((l) => l.contract.ownerSub === me.sub) ?? [], [data.data, me.sub]);

  const announce =
    mine.length === 1 ? (
      <LinkButton to={`/contracts/${mine[0].id}/notices/new`} variant="primary" icon={<Megaphone />}>
        Announce a change
      </LinkButton>
    ) : mine.length > 1 ? (
      <Menu
        label="Choose a line"
        trigger={
          <Button variant="primary" icon={<Megaphone />}>
            Announce a change
          </Button>
        }
        items={mine.map((l) => ({ label: l.contract.name, description: l.contract.sourceRef, onSelect: () => navigate(`/contracts/${l.id}/notices/new`) }))}
      />
    ) : null;

  return (
    <>
      <PageHeader
        title="Timetable"
        meta={
          data.data ? (
            <span className="num">
              {plural(data.data.slots.filter((s) => s.notice.status === 'published').length, 'service')} running ·{' '}
              {plural(data.data.slots.filter((s) => s.notice.status === 'draft').length, 'draft')} in the depot
            </span>
          ) : undefined
        }
        actions={announce}
      />
      <DataState
        state={data}
        isEmpty={(d) => d.net.lines.length === 0}
        empty={
          <EmptyState icon={<CalendarClock />} title="No lines to timetable" action={<LinkButton to="/lines">Register a contract</LinkButton>}>
            Register a contract first; its changes are scheduled here.
          </EmptyState>
        }
        skeleton={<Skeleton height={420} />}
      >
        {({ net, slots, today }) => (desktop ? <Chart lines={net.lines} slots={slots} today={today} /> : <Agenda slots={slots} />)}
      </DataState>
      {data.data && mine.length === 0 && (
        <p className="m-0 mt-4 text-xs text-muted">Only a line's owner can announce a change on it. Register a contract to own a line.</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ desktop chart */

function Chart({ lines, slots, today }: { lines: NetLine[]; slots: Slot[]; today: string }) {
  const span = BACK + AHEAD;
  const x = (days: number) => `${((days + BACK) / span) * 100}%`;
  const weeks: number[] = [];
  const t0 = utcDay(today);
  for (let d = -BACK; d <= AHEAD; d++) {
    if (new Date(t0 + d * DAY).getUTCDay() === 1) weeks.push(d);
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface" role="table" aria-label="Timetable by line">
      <div role="row" className="grid grid-cols-[220px_minmax(0,1fr)] border-b border-line bg-surface-sunken">
        <div role="columnheader" className="x-legend-label px-4 py-2.5 text-muted">
          Line
        </div>
        <div role="columnheader" className="relative h-9" aria-label="Days">
          {weeks.map((d) => (
            <span key={d} className="absolute top-2.5 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted" style={{ left: x(d) }}>
              {formatDay(shiftDays(today, d)).replace(/,? \d{4}$/, '')}
            </span>
          ))}
        </div>
      </div>
      {lines.map((l) => {
        const mine = slots.filter((s) => s.line.id === l.id && s.days >= -BACK && s.days <= AHEAD);
        const later = slots.filter((s) => s.line.id === l.id && s.days > AHEAD).length;
        // stack labels so they never overlap: each takes about eleven days of track
        const lanes: number[] = [];
        const placed = mine.map((s) => {
          let lane = lanes.findIndex((end) => end <= s.days);
          if (lane < 0) lane = lanes.length;
          lanes[lane] = s.days + 11;
          return { s, lane };
        });
        const rows = Math.max(1, lanes.length);
        return (
          <div role="row" key={l.id} className="grid grid-cols-[220px_minmax(0,1fr)] border-b border-line last:border-0">
            <div role="rowheader" className="flex min-w-0 items-start gap-2.5 px-4 py-3.5">
              <LineBullet line={l} size={22} />
              <div className="min-w-0">
                <Link to={`/contracts/${l.id}`} className="block truncate text-sm font-medium text-fg">
                  {l.contract.name}
                </Link>
                <div className="truncate text-xs text-muted">{l.contract.producerTeam}</div>
              </div>
            </div>
            <div role="cell" className="relative" style={{ height: 20 + rows * 34 }}>
              {weeks.map((d) => (
                <span key={d} aria-hidden="true" className="absolute inset-y-0 w-px bg-[var(--line)]" style={{ left: x(d) }} />
              ))}
              <span aria-hidden="true" className="absolute inset-y-0 w-[2px] bg-accent-9" style={{ left: x(0) }} />
              <span aria-hidden="true" className="absolute left-0 right-0 top-[27px] h-[5px] rounded-full opacity-25" style={{ background: l.color }} />
              {placed.map(({ s, lane }) => {
                const top = 18 + lane * 34;
                const draft = s.notice.status === 'draft';
                const closed = s.notice.status === 'closed';
                const color = s.health ? remarkMeta[s.health].color : draft ? 'var(--gray-9)' : 'var(--gray-7)';
                const finalCall = s.notice.status === 'published' && (rules.atRiskTypes as readonly ChangeType[]).includes(s.notice.changeType) && s.days >= 0;
                return (
                  <div key={s.notice.id}>
                    {finalCall && (
                      <span
                        aria-hidden="true"
                        className="absolute h-[18px] rounded-[4px] bg-warn-soft ring-1 ring-inset ring-[var(--warn-line)]"
                        style={{ left: x(Math.max(-BACK, s.days - rules.atRiskDays)), width: `calc(${x(s.days)} - ${x(Math.max(-BACK, s.days - rules.atRiskDays))})`, top: top - 9 }}
                        title="Final call window"
                      />
                    )}
                    <Link
                      to={`/notices/${s.notice.id}`}
                      className={cx('group absolute flex max-w-[220px] -translate-y-1/2 items-center gap-1.5 no-underline', closed && 'opacity-50')}
                      style={{ left: `calc(${x(s.days)} - 9px)`, top }}
                      aria-label={`${s.notice.title}, ${s.notice.status}, ${formatDay(s.notice.effectiveDate)}`}
                    >
                      <span
                        className={cx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ring-2 ring-[var(--surface)] transition-transform group-hover:scale-110', draft && 'border-2 border-dashed bg-surface')}
                        style={draft ? { borderColor: color } : { background: color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: draft ? color : typeColor[s.notice.changeType], boxShadow: '0 0 0 1.5px var(--surface)' }} />
                      </span>
                      <span className="truncate rounded-md bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] px-1 text-xs text-fg group-hover:underline">
                        {s.notice.title}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted">{draft ? 'depot' : closed ? 'gone' : countdown(s.days)}</span>
                    </Link>
                  </div>
                );
              })}
              {later > 0 && <span className="absolute right-2 top-2 font-mono text-[10.5px] text-muted">+{later} later</span>}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-[2px] bg-accent-9" /> Today
        </span>
        {(['waiting', 'at_risk', 'overdue', 'blocked', 'ok'] as Health[]).map((h) => (
          <span key={h} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: remarkMeta[h].color }} /> {remarkMeta[h].board.toLowerCase()}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-dashed border-[var(--gray-9)]" /> draft
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-[3px] bg-warn-soft ring-1 ring-inset ring-[var(--warn-line)]" /> final call window
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ phone agenda */

function Agenda({ slots }: { slots: Slot[] }) {
  const upcoming = slots.filter((s) => s.notice.status !== 'closed' || s.days >= -BACK);
  const groups = new Map<string, Slot[]>(['Departed', 'This week', 'Next week', 'Within six weeks', 'Further out', 'In the depot'].map((k) => [k, []]));
  for (const s of upcoming) {
    const label =
      s.notice.status === 'draft' ? 'In the depot' : s.days < 0 ? 'Departed' : s.days <= 6 ? 'This week' : s.days <= 13 ? 'Next week' : s.days <= 41 ? 'Within six weeks' : 'Further out';
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return (
    <div className="flex flex-col gap-6">
      {[...groups].filter(([, list]) => list.length > 0).map(([label, list]) => (
        <section key={label} aria-label={label}>
          <h2 className="x-legend-label m-0 mb-2 text-muted">{label}</h2>
          <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0">
            {list.map((s) => (
              <li key={s.notice.id}>
                <Link to={`/notices/${s.notice.id}`} className={cx('flex items-center gap-3 py-3 text-fg no-underline', s.notice.status === 'closed' && 'opacity-60')}>
                  <span className="w-12 shrink-0 font-mono text-sm font-semibold num">{s.notice.status === 'draft' ? 'Depot' : countdown(s.days)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.notice.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <LineBullet line={s.line} size={14} />
                      <span className="truncate">{s.line.contract.name}</span>
                    </span>
                  </span>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.health ? remarkMeta[s.health].color : 'var(--gray-7)' }} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
