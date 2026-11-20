/**
 * Signal box: the pending signals the viewer answers for (their teams, plus consumer registrations they are the
 * named contact of), soonest departure first. Each row has the three levers: acknowledge, object, migrated.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Users } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { truncate, useAsync, usePolling } from '@x10/shared/lib';
import { DataState, EmptyState, LinkButton, PageHeader, Skeleton, Stat, StatStrip, Tag, Toast, cx } from '@x10/shared/ui';
import { AnimatePresence, motion } from '@x10/shared/motion';

import { rules } from '../config';
import { AckActions } from '../components/AckActions';
import { HealthChip, TypeChip } from '../components/chips';
import { Lamp, lineStyleFor } from '../components/transit';
import { daysLabel, formatDay } from '../domain/days';
import { listInbox } from '../domain/notices';
import type { AckStatus, Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';
import { countdown } from '../metro/meta';

export function InboxPage() {
  const { store, me } = useApp<Schema>();
  const inbox = useAsync(async () => {
    const [box, contracts] = await Promise.all([listInbox(store, me), store.repo('Contract').list()]);
    return { ...box, contracts };
  }, [store, me]);
  usePolling(inbox.reload, rules.pollMs);
  const [toast, setToast] = useState<string | null>(null);
  const [answering, setAnswering] = useState<Record<string, AckStatus>>({});

  return (
    <>
      <PageHeader
        title="Signal box"
        meta={
          inbox.data && (inbox.data.teams.length > 0 || inbox.data.contactFor.length > 0) ? (
            <>
              {inbox.data.teams.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="my-teams">
                  <span>Your teams</span>
                  {inbox.data.teams.map((t) => (
                    <Tag key={t} tone="brand">
                      {t}
                    </Tag>
                  ))}
                </span>
              )}
              {inbox.data.contactFor.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="my-contacts">
                  <span>Contact for</span>
                  {inbox.data.contactFor.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </span>
              )}
            </>
          ) : undefined
        }
      />
      <DataState
        state={inbox}
        skeleton={
          <div className="flex flex-col gap-3">
            <Skeleton height={76} />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        }
      >
        {({ teams, contactFor, items, contracts }) => {
          if (teams.length === 0 && contactFor.length === 0)
            return (
              <EmptyState icon={<Users />} title="You are not on any station yet" action={<LinkButton to="/teams">See the stations</LinkButton>}>
                Signals belong to consumer teams. An admin adds you to a team; a line's owner can also name you as the contact for one registration.
              </EmptyState>
            );
          const soon = items.filter((i) => i.health.daysLeft >= 0 && i.health.daysLeft <= rules.atRiskDays).length;
          const late = items.filter((i) => i.health.daysLeft < 0).length;
          return (
            <>
              <StatStrip className="mb-6">
                <Stat label="Signals to answer" value={items.length} />
                <Stat label={`Departing within ${rules.atRiskDays} days`} value={soon} tone={soon ? 'warn' : undefined} />
                <Stat label="Already departed" value={late} tone={late ? 'bad' : undefined} />
                <Stat label="Stations you answer for" value={teams.length + contactFor.length} />
              </StatStrip>
              {items.length === 0 ? (
                <EmptyState icon={<Inbox />} title="Nothing waiting on your teams" action={<LinkButton to="/departures">See the departures</LinkButton>}>
                  Every published change your teams consume has been answered. New ones arrive here the moment they are published.
                </EmptyState>
              ) : (
                <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" aria-label="Pending acks">
                  <AnimatePresence initial={false}>
                    {items.map(({ ack, notice, contract, health }) => {
                      const style = lineStyleFor(contracts, notice.contractId);
                      const d = health.daysLeft;
                      const sending = answering[ack.id];
                      return (
                        <motion.li
                          key={ack.id}
                          layout
                          exit={{ opacity: 0, x: 48, transition: { duration: 0.22 } }}
                          className={cx('grid gap-x-6 gap-y-3 py-5 sm:grid-cols-[84px_minmax(0,1fr)] lg:grid-cols-[84px_minmax(0,1fr)_auto]', sending && 'opacity-60')}
                          data-testid="inbox-item"
                          data-team={ack.teamName}
                        >
                          <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-1">
                            <span className="flex items-center gap-2">
                              <Lamp status={sending ?? 'pending'} size={10} />
                              <span className={cx('font-mono text-xl font-semibold leading-none num', d < 0 ? 'text-bad-text' : d <= rules.atRiskDays ? 'text-warn-text' : 'text-fg')}>
                                {countdown(d)}
                              </span>
                            </span>
                            <span className="text-xs text-muted">{formatDay(notice.effectiveDate)}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted">
                              <LineBullet line={style} size={16} />
                              <span className="truncate">{contract?.name ?? 'A removed contract'}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                for <span className="font-medium text-fg">{ack.teamName}</span>
                              </span>
                            </div>
                            <Link to={`/notices/${notice.id}`} className="mt-1 block text-base font-semibold leading-6 text-fg no-underline hover:underline">
                              {notice.title}
                            </Link>
                            <p className="m-0 mt-1 max-w-[72ch] text-sm text-muted">{truncate(notice.description, 200)}</p>
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <TypeChip type={notice.changeType} />
                              <HealthChip health={health.health} title={health.reason} />
                              <span className="text-xs text-muted">Departs {daysLabel(d)}</span>
                            </div>
                          </div>
                          <div className="sm:col-start-2 lg:col-start-3 lg:self-center">
                              <AckActions
                                ack={ack}
                                levers
                                onPending={(s) =>
                                  setAnswering((m) => {
                                    const next = { ...m };
                                    if (s) next[ack.id] = s;
                                    else delete next[ack.id];
                                    return next;
                                  })
                                }
                                onChanged={async (msg) => {
                                  setToast(msg);
                                  await inbox.reload();
                                }}
                              />
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </>
          );
        }}
      </DataState>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
