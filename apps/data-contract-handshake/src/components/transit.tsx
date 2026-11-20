/**
 * Small transit-vocabulary components shared by the tool pages: line status labels, the route strip (a line drawn
 * from its terminal through its stations with each station's signal), signal lamps, and a hook for a line's colour.
 */
import type { ReactNode } from 'react';

import { cx, useReducedMotion } from '@x10/shared/ui';

import { healthMeta, type Health } from '../domain/health';
import type { AckStatus, Contract } from '../model';
import { remarkMeta, signalMeta } from '../metro/meta';
import { LINE_RAMPS, lineCode, type Signal } from '../metro/network';

export interface LineStyle {
  code: string;
  ramp: (typeof LINE_RAMPS)[number];
  color: string;
}

/** A contract's line colour and code: colours follow registration order, as on the map. */
export function lineStyleFor(contracts: Pick<Contract, 'id' | 'name' | 'createdAt'>[], id: string): LineStyle {
  const sorted = [...contracts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  const i = Math.max(0, sorted.findIndex((c) => c.id === id));
  const ramp = LINE_RAMPS[i % LINE_RAMPS.length];
  return { code: lineCode(sorted[i]?.name ?? ''), ramp, color: `var(--${ramp}-9)` };
}

export function Lamp({ status, size = 9, className, title }: { status: Signal; size?: number; className?: string; title?: string }) {
  const reduced = useReducedMotion();
  return (
    <span
      className={cx('dch-lamp', className)}
      title={title}
      aria-hidden={title ? undefined : true}
      data-blink={status === 'pending' && !reduced}
      style={{ ['--lamp' as string]: signalMeta[status].color, width: size, height: size }}
    />
  );
}

/** Line status (worst health of the line's open services): metaphor first, the plain word beside it. */
export function LineStatusLabel({ health, className }: { health: Health | null; className?: string }) {
  if (!health)
    return (
      <span className={cx('inline-flex items-center gap-2 text-sm', className)}>
        <span className="size-2 rounded-full bg-gray-8" aria-hidden="true" />
        <span className="font-medium">Good service</span>
        <span className="text-muted">no open changes</span>
      </span>
    );
  const r = remarkMeta[health];
  return (
    <span data-testid="health-chip" data-health={health} className={cx('inline-flex items-center gap-2 text-sm', className)} title={healthMeta[health].help}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />
      <span className="font-medium">{r.line}</span>
      <span className="text-muted">{healthMeta[health].label.toLowerCase()}</span>
    </span>
  );
}

export interface RouteStop {
  key: string;
  name: string;
  status: Signal;
  sub?: ReactNode;
}

/**
 * A line drawn from its terminal through its stations. Horizontal from md up, vertical on phones. Each station's
 * circle carries its signal lamp.
 */
export function RouteStrip({
  line,
  terminal,
  stops,
  className,
  label = 'Route',
}: {
  line: LineStyle;
  terminal: { name: string; sub?: string };
  stops: RouteStop[];
  className?: string;
  label?: string;
}) {
  return (
    <figure className={cx('m-0', className)} aria-label={label} data-testid="route-strip">
      {/* desktop: horizontal */}
      <div className="hidden md:block">
        <div className="relative grid items-start" style={{ gridTemplateColumns: `minmax(120px,1fr) repeat(${Math.max(1, stops.length)}, minmax(0,1fr))` }}>
          <span
            aria-hidden="true"
            className="absolute top-[15px] h-[7px] rounded-full"
            style={{ left: 16, right: stops.length ? `calc(${50 / Math.max(1, stops.length + 1)}% )` : '60%', background: line.color, ...(stops.length ? {} : { opacity: 0.4 }) }}
          />
          <div className="relative flex flex-col items-start gap-2">
            <span className="grid size-[37px] place-items-center rounded-[10px] font-mono text-[13px] font-bold ring-3 ring-[var(--bg)]" style={{ background: line.color, color: `var(--${line.ramp}-contrast)` }}>
              {line.code}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-5">{terminal.name}</span>
              {terminal.sub && <span className="block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{terminal.sub}</span>}
            </span>
          </div>
          {stops.length === 0 && (
            <div className="relative col-span-1 pt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">No stations yet</div>
          )}
          {stops.map((s) => (
            <div key={s.key} className="relative flex flex-col items-center gap-2 px-1 text-center">
              <span className="grid size-[37px] place-items-center rounded-full border-[3px] border-[var(--world-ink)] bg-surface">
                <Lamp status={s.status} size={12} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5">{s.name}</span>
                <span className="block text-xs text-muted">{s.sub ?? signalMeta[s.status].label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* phones: vertical */}
      <ol className="relative m-0 list-none p-0 md:hidden">
        <span aria-hidden="true" className="absolute bottom-5 left-[15px] top-5 w-[6px] rounded-full" style={{ background: line.color }} />
        <li className="relative flex items-center gap-3 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] font-mono text-xs font-bold" style={{ background: line.color, color: `var(--${line.ramp}-contrast)` }}>
            {line.code}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{terminal.name}</span>
            {terminal.sub && <span className="block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">{terminal.sub}</span>}
          </span>
        </li>
        {stops.map((s) => (
          <li key={s.key} className="relative flex items-center gap-3 py-2">
            <span className="ml-[3px] grid size-[30px] shrink-0 place-items-center rounded-full border-[3px] border-[var(--world-ink)] bg-surface">
              <Lamp status={s.status} size={10} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{s.name}</span>
              <span className="block text-xs text-muted">{s.sub ?? signalMeta[s.status].label}</span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export function statusOf(a: AckStatus | undefined): Signal {
  return a ?? 'none';
}
