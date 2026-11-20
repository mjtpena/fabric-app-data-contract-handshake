/**
 * The departures board: one row per open service (published change notice), soonest departure first. Time, service
 * and remark are split-flap displays; each consumer's answer is a signal lamp. Rows link to the service.
 */
import { Link } from 'react-router-dom';

import { cx, useIsDesktop, useReducedMotion } from '@x10/shared/ui';

import { formatDay } from '../domain/days';
import { ackMeta } from '../domain/health';
import { countdown, dayFlap, remarkMeta, signalMeta, typeShort } from './meta';
import type { NetLine, NetService } from './network';
import { SplitFlap } from './SplitFlap';

export function LineBullet({ line, size = 22, className }: { line: Pick<NetLine, 'code' | 'ramp' | 'color'>; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-grid shrink-0 place-items-center rounded-[7px] font-mono font-bold leading-none', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: line.color, color: `var(--${line.ramp}-contrast)` }}
    >
      {line.code}
    </span>
  );
}

export function SignalLamps({ service, className, max = 8 }: { service: NetService; className?: string; max?: number }) {
  const reduced = useReducedMotion();
  const acks = [...service.acks].sort((a, b) => a.teamName.localeCompare(b.teamName));
  if (!acks.length)
    return <span className={cx('font-mono text-[11px] uppercase tracking-wide opacity-70', className)}>No stations</span>;
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5', className)}>
      {acks.slice(0, max).map((a) => (
        <span
          key={a.id}
          className="dch-lamp"
          title={`${a.teamName}: ${ackMeta[a.status].label}`}
          data-blink={a.status === 'pending' && !reduced}
          style={{ ['--lamp' as string]: signalMeta[a.status].color }}
        />
      ))}
      {acks.length > max && <span className="font-mono text-[11px]">+{acks.length - max}</span>}
      <span className="sr-only">{acks.map((a) => `${a.teamName}: ${ackMeta[a.status].label}`).join(', ')}</span>
    </span>
  );
}

export function DeparturesBoard({
  services,
  lines,
  title = 'Departures',
  clock,
  size = 'md',
  empty,
  className,
}: {
  services: NetService[];
  lines: NetLine[];
  title?: string;
  /** Shown top right, e.g. the time. */
  clock?: string;
  size?: 'md' | 'lg';
  empty?: string;
  className?: string;
}) {
  const desktop = useIsDesktop();
  const lineOf = (id: string) => lines.find((l) => l.id === id);
  const big = size === 'lg';
  const titleLen = big ? 30 : desktop ? 30 : 22;
  const cell = big ? 'text-[clamp(15px,1.45vw,26px)]' : desktop ? 'text-[15px]' : 'text-[14px]';
  return (
    <section className={cx('dch-board overflow-hidden rounded-2xl shadow-2', className)} aria-label={title} data-testid="departures-board">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--board-line)] px-4 py-3 md:px-5">
        <div className="flex items-center gap-3">
          <SplitFlap text={title} className={big ? 'text-[clamp(20px,2vw,34px)]' : 'text-[17px]'} color="var(--board-amber)" />
        </div>
        {clock && <SplitFlap text={clock} className={big ? 'text-[clamp(20px,2vw,34px)]' : 'text-[17px]'} color="var(--board-ink)" label={`Time ${clock}`} />}
      </header>
      {desktop && (
        <div
          aria-hidden="true"
          className={cx(
            'grid items-center gap-4 border-b border-[var(--board-line)] px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--board-muted)]',
            big ? 'grid-cols-[minmax(120px,12%)_minmax(0,1fr)_minmax(60px,7%)_minmax(120px,15%)_minmax(150px,17%)]' : 'grid-cols-[96px_minmax(0,1fr)_56px_minmax(104px,150px)_150px]',
          )}
        >
          <span>Departs</span>
          <span>Service · line</span>
          <span>Type</span>
          <span>Signals</span>
          <span className="text-right">Remarks</span>
        </div>
      )}
      {services.length === 0 ? (
        <div className="px-5 py-10 text-center font-mono text-sm uppercase tracking-[0.12em] text-[var(--board-muted)]">{empty ?? 'No departures scheduled'}</div>
      ) : (
        <ol className="m-0 list-none p-0" aria-label="Services">
          {services.map((svc, i) => {
            const line = lineOf(svc.lineId);
            const r = remarkMeta[svc.health.health];
            const d = svc.health.daysLeft;
            return (
              <li key={svc.id} className="border-b border-[var(--board-line)] last:border-0" data-testid="departure-row" data-health={svc.health.health}>
                <Link
                  to={`/notices/${svc.id}`}
                  className={cx(
                    'group block px-4 py-3 text-[var(--board-ink)] no-underline transition-colors duration-[120ms] hover:bg-[var(--board-2)] focus-visible:bg-[var(--board-2)] md:px-5',
                    desktop && 'grid items-center gap-4',
                    desktop && (big ? 'grid-cols-[minmax(120px,12%)_minmax(0,1fr)_minmax(60px,7%)_minmax(120px,15%)_minmax(150px,17%)] py-4' : 'grid-cols-[96px_minmax(0,1fr)_56px_minmax(104px,150px)_150px]'),
                  )}
                >
                  {desktop ? (
                    <>
                      <span className="flex flex-col gap-1">
                        <SplitFlap text={dayFlap(svc.notice.effectiveDate)} className={cell} color="var(--board-amber)" delay={i * 90} label={formatDay(svc.notice.effectiveDate)} />
                        <span className={cx('font-mono text-[11px] tracking-wide', svc.health.health === 'overdue' ? 'text-[var(--red-9)]' : 'text-[var(--board-muted)]')}>{countdown(d)}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <SplitFlap text={svc.notice.title} length={titleLen} className={cell} delay={i * 90 + 60} />
                        <span className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--board-muted)]">
                          {line && <LineBullet line={line} size={16} />}
                          <span className="truncate">{line?.contract.name}</span>
                        </span>
                      </span>
                      <SplitFlap text={typeShort[svc.notice.changeType]} className={cell} delay={i * 90 + 120} label={svc.notice.changeType} />
                      <SignalLamps service={svc} />
                      <span className="flex justify-end">
                        <SplitFlap text={r.board} className={cell} color={r.boardColor} delay={i * 90 + 160} />
                      </span>
                    </>
                  ) : (
                    <span className="flex flex-col gap-2">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <SplitFlap text={dayFlap(svc.notice.effectiveDate)} className={cell} color="var(--board-amber)" delay={i * 90} label={formatDay(svc.notice.effectiveDate)} />
                          <span className={cx('font-mono text-[11px]', svc.health.health === 'overdue' ? 'text-[var(--red-9)]' : 'text-[var(--board-muted)]')}>{countdown(d)}</span>
                        </span>
                        <SplitFlap text={r.board} className="text-[13px]" color={r.boardColor} delay={i * 90 + 160} />
                      </span>
                      <SplitFlap text={svc.notice.title} length={titleLen} className={cell} delay={i * 90 + 60} />
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--board-muted)]">
                          {line && <LineBullet line={line} size={16} />}
                          <span className="truncate">{line?.contract.name}</span>
                          <span className="font-mono text-[11px] uppercase">· {typeShort[svc.notice.changeType]}</span>
                        </span>
                        <SignalLamps service={svc} max={6} />
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
