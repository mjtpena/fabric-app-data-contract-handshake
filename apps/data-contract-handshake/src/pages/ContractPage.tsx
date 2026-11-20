/**
 * A line (contract): its route from the producer's terminal through each consumer station with that station's
 * signal on the open services, the stations (consumers) and the services (change notices) on the line.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Megaphone, Pencil, Plus, TrainFront } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { formatDate, normKey, plural, useAsync } from '@x10/shared/lib';
import { Breadcrumb, Button, Callout, ConfirmDialog, DataState, EmptyState, IconButton, PageHeader, Section, Skeleton, Toast } from '@x10/shared/ui';
import { Trash2 } from 'lucide-react';

import { HealthChip, NoticeStatusChip, TypeChip } from '../components/chips';
import { ConsumerDialog, ContractDialog } from '../components/forms';
import { Lamp, RouteStrip, lineStyleFor } from '../components/transit';
import { CONSUMER_REMOVED_NOTE, getContractDetail, removeConsumer } from '../domain/contracts';
import { daysLabel, formatDay } from '../domain/days';
import { buildTeams } from '../domain/teams';
import type { Consumer, Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';
import { countdown, signalMeta } from '../metro/meta';
import { worstSignal } from '../metro/network';

export function ContractPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { store, me } = useApp<Schema>();
  const detail = useAsync(async () => {
    const [d, people, members, consumers, contracts] = await Promise.all([
      getContractDetail(store, id),
      store.repo('Person').list({ orderBy: { field: 'displayName' } }),
      store.repo('TeamMember').list(),
      store.repo('Consumer').list(),
      store.repo('Contract').list(),
    ]);
    return { ...d, people, knownTeams: buildTeams(members, consumers).map((t) => t.name), style: lineStyleFor(contracts, id) };
  }, [store, id]);
  const [editing, setEditing] = useState(false);
  const [addingConsumer, setAddingConsumer] = useState(false);
  const [removing, setRemoving] = useState<Consumer | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <DataState
        state={detail}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton width={240} height={28} />
            <Skeleton height={120} />
            <Skeleton height={200} />
          </div>
        }
      >
        {(d) => {
          const owner = d.contract.ownerSub === me.sub;
          const open = d.notices.filter((n) => n.notice.status === 'published');
          const signalOf = (c: Consumer) => worstSignal(open.flatMap((n) => n.acks.filter((a) => a.consumerId === c.id).map((a) => a.status)));
          return (
            <>
              <PageHeader
                eyebrow={<Breadcrumb items={[{ label: 'Line status', to: '/lines' }, { label: d.contract.name }]} />}
                title={
                  <span className="inline-flex items-center gap-3">
                    <LineBullet line={d.style} size={34} />
                    {d.contract.name}
                  </span>
                }
                meta={
                  <>
                    <span className="font-mono">{d.contract.sourceRef}</span>
                    <span>{d.contract.producerTeam}</span>
                    <span>
                      {d.contract.ownerName}
                      {owner && ' (you)'}
                    </span>
                    <span>Opened {formatDate(d.contract.createdAt)}</span>
                  </>
                }
                actions={
                  owner && (
                    <>
                      <Button icon={<Pencil />} onClick={() => setEditing(true)}>
                        Edit contract
                      </Button>
                      <Button variant="primary" icon={<Megaphone />} onClick={() => navigate(`/contracts/${d.contract.id}/notices/new`)}>
                        Announce a change
                      </Button>
                    </>
                  )
                }
              />
              {d.contract.description && <p className="-mt-2 mb-8 max-w-[72ch] text-sm text-muted">{d.contract.description}</p>}

              {d.consumers.length === 0 && (
                <div data-testid="no-consumers-warning" className="mb-6">
                  <Callout tone="warn" title="No consumers registered">
                    Publishing still works, but nobody will be asked to acknowledge. Add the teams that read this data first.
                  </Callout>
                </div>
              )}

              <section className="rounded-xl border border-line bg-surface px-4 py-5 md:px-6" aria-label="Route">
                <RouteStrip
                  line={d.style}
                  terminal={{ name: d.contract.producerTeam, sub: 'Terminal' }}
                  stops={d.consumers.map((c) => ({ key: c.id, name: c.teamName, status: signalOf(c), sub: open.length ? signalMeta[signalOf(c)].label : 'No open service' }))}
                />
              </section>

              <Section
                title={`Stations (${d.consumers.length})`}
                actions={
                  owner && (
                    <Button size="sm" icon={<Plus />} onClick={() => setAddingConsumer(true)}>
                      Add consumer
                    </Button>
                  )
                }
              >
                {d.consumers.length === 0 ? (
                  <EmptyState
                    compact
                    title="No stations yet"
                    action={owner && <Button variant="primary" onClick={() => setAddingConsumer(true)}>Add a consumer team</Button>}
                  >
                    Each consumer team becomes a station on this line.
                  </EmptyState>
                ) : (
                  <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" aria-label="Consumers">
                    {d.consumers.map((c) => {
                      const sig = signalOf(c);
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-3 py-3" data-testid="consumer-row">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full border-[2.5px] border-[var(--world-ink)] bg-surface">
                              <Lamp status={sig} size={9} />
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium">{c.teamName}</div>
                              <div className="text-ui text-muted">
                                {c.contactName}
                                {c.contactSub ? '' : ' · not linked to a sign-in'}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="hidden text-ui text-muted sm:inline">{open.length ? signalMeta[sig].label : 'No open service'}</span>
                            {owner && (
                              <IconButton label={`Remove ${c.teamName}`} icon={<Trash2 />} onClick={() => setRemoving(c)} />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section title={`Services (${d.notices.length})`}>
                {d.notices.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<TrainFront />}
                    title="No services yet"
                    action={
                      owner && (
                        <Link to={`/contracts/${d.contract.id}/notices/new`} className="font-semibold">
                          Announce the first change
                        </Link>
                      )
                    }
                  >
                    When this table changes shape, announce it so every station can answer.
                  </EmptyState>
                ) : (
                  <ol className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" aria-label="Services, latest first">
                    {d.notices.map(({ notice: n, health, acks }) => (
                      <li key={n.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 gap-y-1 py-3 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center">
                        <div className="row-span-2 sm:row-span-1">
                          <div className="font-mono text-sm font-semibold num">{n.status === 'published' ? countdown(health.daysLeft) : n.status === 'draft' ? 'Depot' : 'Closed'}</div>
                          <div className="text-xs text-muted">{formatDay(n.effectiveDate)}</div>
                        </div>
                        <div className="min-w-0">
                          <Link to={`/notices/${n.id}`} className="font-medium">
                            {n.title}
                          </Link>
                          <div className="text-ui text-muted">
                            {n.status === 'published' ? health.reason : n.status === 'draft' ? `Draft, departs ${daysLabel(health.daysLeft)}` : `Closed ${n.closedByName ? `by ${n.closedByName}` : ''}`}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {n.status === 'published' && acks.length > 0 && (
                            <span className="mr-1 inline-flex items-center gap-1" aria-hidden="true">
                              {acks.map((a) => (
                                <Lamp key={a.id} status={a.status} size={7} />
                              ))}
                            </span>
                          )}
                          <TypeChip type={n.changeType} />
                          {n.status === 'published' ? <HealthChip health={health.health} title={health.reason} /> : <NoticeStatusChip status={n.status} />}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <ContractDialog open={editing} onClose={() => setEditing(false)} existing={d.contract} onSaved={() => detail.reload()} />
              <ConsumerDialog
                open={addingConsumer}
                onClose={() => setAddingConsumer(false)}
                contract={d.contract}
                people={d.people}
                knownTeams={d.knownTeams.filter((t) => !d.consumers.some((c) => normKey(c.teamName) === normKey(t)))}
                onSaved={async (msg) => {
                  setToast(msg);
                  await detail.reload();
                }}
              />
              <ConfirmDialog
                open={!!removing}
                onClose={() => setRemoving(null)}
                title={`Remove ${removing?.teamName ?? 'consumer'}?`}
                body={
                  <p className="m-0">
                    Their open acks (pending or objected) on published notices are marked <strong>Migrated</strong> with the note “{CONSUMER_REMOVED_NOTE}”.
                    Closed notices are left as they were.
                  </p>
                }
                confirmLabel="Remove consumer"
                danger
                onConfirm={async () => {
                  if (!removing) return;
                  const r = await removeConsumer(store, me, removing.id);
                  setToast(`${removing.teamName} removed. ${plural(r.acksClosed, 'open ack')} marked migrated.`);
                  await detail.reload();
                }}
              />
            </>
          );
        }}
      </DataState>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
