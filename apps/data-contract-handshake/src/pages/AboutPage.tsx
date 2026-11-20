/** About: the pitch, how to read the map, the rules and thresholds from config.ts, and who can do what. */
import { Link } from 'react-router-dom';

import { AppLogo } from '@x10/shared/runtime';
import { PageHeader, Section } from '@x10/shared/ui';

import { HealthChip } from '../components/chips';
import { Lamp } from '../components/transit';
import { rules } from '../config';
import { changeTypeMeta, HEALTHS, healthMeta } from '../domain/health';
import { CHANGE_TYPES } from '../model';
import { remarkMeta, signalMeta, typeColor } from '../metro/meta';
import type { Signal } from '../metro/network';

function Glyph({ kind }: { kind: 'line' | 'station' | 'interchange' | 'terminal' | 'train' | 'pulse' }) {
  return (
    <svg viewBox="0 0 64 28" width={64} height={28} aria-hidden="true" className="shrink-0">
      {kind === 'line' && <path d="M4 14h56" stroke="var(--blue-9)" strokeWidth={6} strokeLinecap="round" />}
      {kind === 'station' && (
        <>
          <path d="M4 14h56" stroke="var(--teal-9)" strokeWidth={6} strokeLinecap="round" />
          <circle cx={32} cy={14} r={7} fill="var(--surface)" stroke="var(--world-ink)" strokeWidth={3} />
        </>
      )}
      {kind === 'interchange' && (
        <>
          <path d="M4 10h56" stroke="var(--blue-9)" strokeWidth={6} strokeLinecap="round" />
          <path d="M4 19h56" stroke="var(--gold-9)" strokeWidth={6} strokeLinecap="round" />
          <path d="M32 9.5v10" stroke="var(--world-ink)" strokeWidth={19} strokeLinecap="round" />
          <path d="M32 9.5v10" stroke="var(--surface)" strokeWidth={13} strokeLinecap="round" />
        </>
      )}
      {kind === 'terminal' && (
        <>
          <path d="M30 14h30" stroke="var(--plum-9)" strokeWidth={6} strokeLinecap="round" />
          <rect x={8} y={1} width={26} height={26} rx={8} fill="var(--plum-9)" />
          <text x={21} y={18} textAnchor="middle" fill="var(--plum-contrast)" style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)' }}>
            WS
          </text>
        </>
      )}
      {kind === 'train' && (
        <>
          <path d="M4 14h56" stroke="var(--blue-9)" strokeWidth={6} strokeLinecap="round" />
          <rect x={16} y={7} width={32} height={14} rx={7} fill="var(--warn-solid)" stroke="var(--surface)" strokeWidth={2.5} />
          {[23, 29, 35].map((x) => (
            <rect key={x} x={x} y={11.4} width={4.4} height={5.2} rx={1.2} fill="var(--surface)" />
          ))}
        </>
      )}
      {kind === 'pulse' && (
        <>
          <path d="M4 14h56" stroke="var(--blue-9)" strokeWidth={6} strokeLinecap="round" />
          <rect x={14} y={11.5} width={24} height={5} rx={2.5} fill="var(--warn-solid)" opacity={0.6} />
          <circle cx={38} cy={14} r={3} fill="var(--world-glow)" stroke="var(--warn-solid)" strokeWidth={1.2} />
        </>
      )}
    </svg>
  );
}

const READING: { kind: Parameters<typeof Glyph>[0]['kind']; title: string; text: string }[] = [
  { kind: 'line', title: 'Line', text: 'One per data contract: a table or dataset someone publishes.' },
  { kind: 'terminal', title: 'Terminal', text: 'Where the line starts: the producer team that owns the contract.' },
  { kind: 'station', title: 'Station', text: 'A consumer team registered on the line.' },
  { kind: 'interchange', title: 'Interchange', text: 'A team that consumes several contracts.' },
  { kind: 'train', title: 'Train', text: 'A published change notice. Its departure is the effective date.' },
  { kind: 'pulse', title: 'Signal in transit', text: 'A pending ack travelling to the station that still has to answer.' },
];

export function AboutPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="About Data Contract Handshake" subtitle="Schema changes should not be a surprise. Every consumer shakes hands." />
      <div className="flex items-start gap-4">
        <AppLogo size={40} />
        <div>
          <p className="m-0 text-base leading-7">
            Producers announce a change to a table or dataset. Every registered consumer team must acknowledge it, object to it or confirm it has
            migrated, and anything still unanswered close to its effective date turns red. The app draws this as a transit network: contracts are
            lines, consumer teams are stations, and each change is a train that departs on its effective date.
          </p>
          <p className="m-0 mt-2 text-ui text-muted">Built by Datachain Consulting for AI @Work. Runs on Microsoft Fabric Apps (preview).</p>
        </div>
      </div>

      <Section title="Reading the map" className="mt-10!">
        <ul className="m-0 grid list-none gap-x-8 gap-y-4 p-0 sm:grid-cols-2">
          {READING.map((r) => (
            <li key={r.title} className="flex items-center gap-3">
              <Glyph kind={r.kind} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="block text-ui text-muted">{r.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <ul className="m-0 mt-5 flex list-none flex-wrap gap-x-5 gap-y-2 border-t border-line p-0 pt-4">
          {(['acknowledged', 'migrated', 'pending', 'objected', 'none'] as Signal[]).map((s) => (
            <li key={s} className="inline-flex items-center gap-2 text-ui">
              <Lamp status={s} />
              {signalMeta[s].label}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Health and the board">
        <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0">
          {[...HEALTHS].reverse().map((h) => (
            <li key={h} className="grid gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[110px_120px_minmax(0,1fr)] sm:items-center">
              <span className="font-mono text-xs font-semibold tracking-[0.08em]" style={{ color: `var(--${remarkMeta[h].tone}-text)` }}>
                {remarkMeta[h].board}
              </span>
              <span>
                <HealthChip health={h} />
              </span>
              <span className="text-ui text-muted">{healthMeta[h].help}</span>
            </li>
          ))}
        </ul>
        <ul className="m-0 mt-4 list-disc space-y-1 pl-5 text-ui text-muted">
          <li>Checked in this order: blocked, OK, overdue, at risk, waiting.</li>
          <li>
            Final call (at risk) means {rules.atRiskDays} days or fewer before the effective date, counting the day itself, for{' '}
            {rules.atRiskTypes.map((t) => changeTypeMeta[t].label.toLowerCase()).join(' and ')} changes.{' '}
            {rules.atRiskTypes.includes('deprecation')
              ? 'Deprecations are included by this deployment’s configuration.'
              : 'Deprecations follow the same rule only if the deployer adds them to the at-risk types.'}{' '}
            Additive changes are never at risk.
          </li>
          <li>Delayed (overdue) starts the day after the effective date.</li>
          <li>A notice on a line with no stations is OK, with a warning.</li>
          <li>Live screens refresh every {rules.pollMs / 1000} seconds.</li>
        </ul>
      </Section>

      <Section title="Change types">
        <dl className="m-0 grid gap-4 sm:grid-cols-3">
          {CHANGE_TYPES.map((t) => (
            <div key={t}>
              <dt className="flex items-center gap-2 text-sm font-medium">
                <span className="h-1.5 w-4 rounded-full" style={{ background: typeColor[t] }} aria-hidden="true" />
                {changeTypeMeta[t].label}
              </dt>
              <dd className="m-0 mt-1 text-ui text-muted">{changeTypeMeta[t].help}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Who can do what">
        <ul className="m-0 list-disc space-y-1.5 pl-5 text-sm">
          <li>Everyone signed in can read every line, service and signal.</li>
          <li>Only a line's owner edits it, manages its stations, and drafts, publishes and closes its services.</li>
          <li>A member of a consumer team answers for that team in the <Link to="/inbox">signal box</Link>. The owner or an admin may change any signal, or reset it to pending.</li>
          <li>A service closes only when every station acknowledged or migrated, or by an admin with a note.</li>
          <li>Removing a station marks its open signals migrated with the note “consumer removed”.</li>
          <li>
            Team membership lives on the <Link to="/teams">Stations</Link> page and only admins manage it. A contact person named on one registration
            answers for that line only.
          </li>
        </ul>
      </Section>

      <Section title="Privacy and audience">
        <p className="m-0 text-sm leading-6">
          The app stores names, sign-in identifiers and email addresses of people who open it, plus the contracts, notices and notes you enter, in this
          app's Fabric SQL database. It sends nothing elsewhere. Only people with access to the app item in Fabric (workspace members by default) can
          sign in. Keep notes about data, not about people.
        </p>
      </Section>
    </div>
  );
}
