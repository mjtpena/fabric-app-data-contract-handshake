/**
 * A service (change notice): its departure (effective date) on a split-flap ticket, the route with every station's
 * signal, and the ack matrix where each team answers. Owners publish drafts and close the service; admins can close
 * early with a note.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Send, Trash2 } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { formatDateTime, formatRelative, plural, useAsync, usePolling } from '@x10/shared/lib';
import { Breadcrumb, Button, Callout, ConfirmDialog, DataState, PageHeader, Section, Skeleton, Toast } from '@x10/shared/ui';

import { rules } from '../config';
import { AckActions } from '../components/AckActions';
import { AckChip, HealthChip, NoticeStatusChip, TypeChip } from '../components/chips';
import { Lamp, RouteStrip, lineStyleFor, type LineStyle } from '../components/transit';
import { daysLabel, formatDay, localToday } from '../domain/days';
import { closeNotice, deleteDraft, getNoticeDetail, publishBlocker, publishNotice, type NoticeDetail } from '../domain/notices';
import { limits, type Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';
import { countdown, dayFlap, remarkMeta, typeShort } from '../metro/meta';
import { SplitFlap } from '../metro/SplitFlap';

export function NoticePage() {
  const { id = '' } = useParams();
  const { store, me } = useApp<Schema>();
  const detail = useAsync(async () => {
    const [d, contracts] = await Promise.all([getNoticeDetail(store, me, id), store.repo('Contract').list()]);
    return { d, style: lineStyleFor(contracts, d.contract.id) };
  }, [store, me, id]);
  usePolling(detail.reload, rules.pollMs);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <DataState
        state={detail}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton width={320} height={28} />
            <Skeleton height={84} />
            <Skeleton height={260} />
          </div>
        }
      >
        {({ d, style }) => (
          <NoticeView
            d={d}
            style={style}
            onChanged={async (msg) => {
              setToast(msg);
              await detail.reload();
            }}
          />
        )}
      </DataState>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function NoticeView({ d, style, onChanged }: { d: NoticeDetail; style: LineStyle; onChanged: (msg: string) => Promise<void> }) {
  const { store, me, isAdmin } = useApp<Schema>();
  const navigate = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);
  const { notice: n, contract, health } = d;
  const blocker = publishBlocker(n, localToday());
  const count = (s: string) => d.rows.filter((r) => r.ack.status === s).length;
  const canClose = n.status === 'published' && ((d.isOwner && health.health === 'ok') || isAdmin);
  const adminOverride = canClose && health.health !== 'ok';
  const remark = n.status === 'draft' ? { board: 'IN DEPOT', boardColor: 'var(--board-muted)' } : n.status === 'closed' ? { board: 'DEPARTED', boardColor: 'var(--board-muted)' } : remarkMeta[health.health];

  const primary =
    d.isOwner && n.status === 'draft' ? (
      <Button variant="primary" icon={<Send />} disabled={!!blocker} onClick={() => setPublishing(true)} aria-describedby={blocker ? 'publish-blocker' : undefined}>
        Publish
      </Button>
    ) : canClose ? (
      <Button variant={adminOverride ? 'danger' : 'primary'} onClick={() => setClosing(true)}>
        {adminOverride ? 'Close (admin override)' : 'Close notice'}
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Breadcrumb
            items={[
              { label: 'Line status', to: '/lines' },
              { label: contract.name, to: `/contracts/${contract.id}` },
              { label: 'Service' },
            ]}
          />
        }
        title={n.title}
        meta={
          <>
            <TypeChip type={n.changeType} />
            <NoticeStatusChip status={n.status} />
            {n.status !== 'draft' && <HealthChip health={health.health} />}
            <span data-testid="health-reason">{health.reason}</span>
          </>
        }
        actions={
          <>
            {d.isOwner && n.status === 'draft' && (
              <>
                <Button icon={<Pencil />} onClick={() => navigate(`/notices/${n.id}/edit`)}>
                  Edit draft
                </Button>
                <Button variant="ghost" icon={<Trash2 />} onClick={() => setDeleting(true)}>
                  Delete draft
                </Button>
              </>
            )}
            {primary && <span className="hidden md:inline-flex">{primary}</span>}
          </>
        }
      />

      {/* the ticket: departure, countdown, line and remark on a split-flap strip */}
      <section className="dch-board mb-6 grid grid-cols-2 gap-4 rounded-2xl px-4 py-4 shadow-1 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center md:px-6" aria-label="Departure">
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--board-muted)]">Departs</div>
          <SplitFlap text={dayFlap(n.effectiveDate)} className="text-[22px]" color="var(--board-amber)" label={formatDay(n.effectiveDate)} />
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--board-muted)]">Countdown</div>
          <SplitFlap text={countdown(health.daysLeft)} className="text-[22px]" label={daysLabel(health.daysLeft)} />
        </div>
        <div className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--board-muted)]">Line · type</div>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <LineBullet line={style} size={22} />
            <span className="truncate">{contract.name}</span>
            <span className="font-mono text-xs text-[var(--board-muted)]">{typeShort[n.changeType]}</span>
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 sm:text-right">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--board-muted)]">Remarks</div>
          <SplitFlap text={remark.board} className="text-[22px]" color={remark.boardColor} />
        </div>
      </section>

      <div className="flex flex-col gap-3">
        {n.status === 'draft' && blocker && (
          <div id="publish-blocker" data-testid="publish-blocker">
            <Callout tone="bad" title="Cannot publish yet">
              {blocker}
            </Callout>
          </div>
        )}
        {health.warning && n.status !== 'draft' && (
          <div data-testid="no-consumers-warning">
            <Callout tone="warn" title="No stations on this line">
              {health.warning}
            </Callout>
          </div>
        )}
        {n.status === 'draft' && d.consumerCount === 0 && (
          <div data-testid="no-consumers-warning">
            <Callout tone="warn" title="No consumers registered">
              Publishing works, but nobody will be asked to acknowledge. The notice will show as OK straight away.
            </Callout>
          </div>
        )}
        {n.status === 'closed' && (
          <Callout tone="info" title={`Closed ${formatRelative(n.closedAt)} by ${n.closedByName ?? 'someone'}`}>
            {n.closeNote ? <>Note: {n.closeNote}</> : 'Every consumer had acknowledged or migrated.'}
          </Callout>
        )}
        {d.isOwner && n.status === 'published' && health.health !== 'ok' && !isAdmin && (
          <p className="m-0 text-ui text-muted">You can close this notice once every station has acknowledged or migrated.</p>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <h2 className="m-0 mb-2 text-base font-semibold">What changes</h2>
          <p className="m-0 max-w-[72ch] whitespace-pre-wrap text-sm leading-6">{n.description}</p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 self-start text-sm lg:grid-cols-1">
          <div>
            <dt className="text-ui text-muted">Effective</dt>
            <dd className="m-0 font-medium">
              {formatDay(n.effectiveDate)} <span className="font-normal text-muted">({daysLabel(health.daysLeft)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-ui text-muted">Announced by</dt>
            <dd className="m-0">{n.createdByName}</dd>
          </div>
          <div>
            <dt className="text-ui text-muted">Published</dt>
            <dd className="m-0">{n.publishedAt ? formatDateTime(n.publishedAt) : 'Not yet (draft)'}</dd>
          </div>
          <div>
            <dt className="text-ui text-muted">Source</dt>
            <dd className="m-0 break-all font-mono text-ui">{contract.sourceRef}</dd>
          </div>
        </dl>
      </div>

      {n.status !== 'draft' && d.rows.length > 0 && (
        <section className="mt-8 rounded-xl border border-line bg-surface px-4 py-5 md:px-6" aria-label="Route and signals">
          <RouteStrip
            line={style}
            terminal={{ name: contract.producerTeam, sub: 'Terminal' }}
            stops={d.rows.map((r) => ({ key: r.ack.id, name: r.ack.teamName, status: r.ack.status }))}
          />
        </section>
      )}

      {n.status === 'draft' ? (
        <Section title="Signals" className="mt-8!">
          <p className="m-0 text-sm text-muted">
            Publishing sets a pending signal at each of the {plural(d.consumerCount, 'station')} on this line.
          </p>
        </Section>
      ) : (
        <Section
          title={`Ack matrix (${d.rows.length})`}
          className="mt-8!"
          description={
            d.rows.length ? `${count('acknowledged')} acknowledged · ${count('migrated')} migrated · ${count('pending')} pending · ${count('objected')} objected` : undefined
          }
        >
          {d.rows.length === 0 ? (
            <p className="m-0 text-sm text-muted">No consumer teams were registered when this notice was published.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" data-testid="ack-matrix" aria-label="Ack matrix">
              {d.rows.map((r) => (
                <li
                  key={r.ack.id}
                  className="grid gap-x-4 gap-y-2 py-3.5 md:grid-cols-[minmax(0,1fr)_116px_minmax(0,1.1fr)_minmax(0,0.9fr)_288px] md:items-center"
                  data-testid="ack-row"
                  data-team={r.ack.teamName}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full border-[2.5px] border-[var(--world-ink)] bg-surface">
                        <Lamp status={r.ack.status} size={9} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">
                          {r.ack.teamName}
                          {r.ownTeam && <span className="ml-1.5 text-xs font-normal text-brand-text">your team</span>}
                        </div>
                        <div className="text-xs text-muted">{r.consumer ? r.consumer.contactName : 'Consumer removed'}</div>
                      </div>
                    </div>
                    <span className="md:hidden">
                      <AckChip status={r.ack.status} />
                    </span>
                  </div>
                  <div className="hidden md:block">
                    <AckChip status={r.ack.status} />
                  </div>
                  <div className="break-words text-sm">{r.ack.note ?? <span className="text-faint">No note</span>}</div>
                  <div className="text-ui">
                    {r.ack.status === 'pending' ? (
                      <span className="text-muted">Waiting since {formatDateTime(r.ack.updatedAt)}</span>
                    ) : (
                      <>
                        {r.ack.updatedByName}
                        <div className="text-xs text-muted">{formatDateTime(r.ack.updatedAt)}</div>
                      </>
                    )}
                  </div>
                  <div className="md:justify-self-end">
                    {r.canAct ? (
                      <AckActions ack={r.ack} onChanged={onChanged} allowReset={d.isOwner || isAdmin} />
                    ) : (
                      <span className="text-xs text-muted">{n.status === 'closed' ? 'Closed' : 'Team members only'}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {primary && (
        <div className="sticky z-20 -mx-4 mt-8 border-t border-line bg-[color-mix(in_oklab,var(--bg)_90%,transparent)] px-4 py-3 backdrop-blur-md md:hidden [&>*]:w-full" style={{ bottom: 'var(--x-bottom-inset)' }}>
          {primary}
        </div>
      )}

      <ConfirmDialog
        open={publishing}
        onClose={() => setPublishing(false)}
        title="Publish this notice?"
        body={
          <p className="m-0">
            {d.consumerCount === 0
              ? 'This contract has no consumers, so nobody will be asked to acknowledge. The notice will show as OK.'
              : `Each of the ${plural(d.consumerCount, 'consumer team')} gets a pending ack and sees this notice in their signal box. Published notices cannot be edited.`}
          </p>
        }
        confirmLabel="Publish"
        onConfirm={async () => {
          const r = await publishNotice(store, me, n.id);
          await onChanged(`Published. ${plural(r.acksCreated, 'pending ack')} created.`);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this draft?"
        body="The draft has not been sent to anyone. This cannot be undone."
        confirmLabel="Delete draft"
        danger
        onConfirm={async () => {
          await deleteDraft(store, me, n.id);
          navigate(`/contracts/${contract.id}`);
        }}
      />
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        title={adminOverride ? 'Close with an admin override?' : 'Close this notice?'}
        body={
          adminOverride ? (
            <p className="m-0">
              The notice is <strong>{health.health.replace('_', ' ')}</strong>. Closing it now stops the handshake for teams that have not answered.
              Explain why.
            </p>
          ) : (
            <p className="m-0">Every consumer has acknowledged or migrated. Closing archives the handshake; acks can no longer change.</p>
          )
        }
        noteLabel={adminOverride ? 'Override note' : 'Note (optional)'}
        noteRequired={adminOverride}
        noteMax={limits.closeNote.max}
        confirmLabel="Close notice"
        danger={adminOverride}
        onConfirm={async (note) => {
          await closeNotice(store, me, n.id, note);
          await onChanged('Notice closed.');
        }}
      />
    </>
  );
}
