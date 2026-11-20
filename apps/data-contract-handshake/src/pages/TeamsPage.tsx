/**
 * Stations: every consumer team, the lines (contracts) that stop there, and who answers for it. Admins add members;
 * a member can leave. Named contacts on a single registration are listed separately.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Users } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { hasErrors, plural, useAction, useAsync } from '@x10/shared/lib';
import { Avatar, Button, ConfirmDialog, DataState, EmptyState, Field, InlineError, Input, PageHeader, Select, Skeleton, Tag, Toast } from '@x10/shared/ui';

import { lineStyleFor } from '../components/transit';
import { addTeamMember, inTeam, loadTeams, removeTeamMember, validateTeamName } from '../domain/teams';
import { limits, type Schema, type TeamMember } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';

export function TeamsPage() {
  const { store, me, isAdmin } = useApp<Schema>();
  const data = useAsync(() => loadTeams(store), [store]);
  const [toast, setToast] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  return (
    <>
      <PageHeader
        title="Stations"
        meta={data.data ? <span className="num">{plural(data.data.teams.length, 'consumer team')} · members answer for their team on every line that stops there</span> : undefined}
      />
      <DataState
        state={data}
        skeleton={
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={84} />
            ))}
          </div>
        }
      >
        {({ teams, contracts, people }) => {
          const mine = teams.filter((t) => t.members.some((m) => m.memberSub === me.sub)).map((t) => t.name);
          return (
            <>
              {isAdmin && (
                <AddMemberForm
                  teamNames={teams.map((t) => t.name)}
                  people={people.map((p) => ({ sub: p.sub, name: p.displayName, email: p.email }))}
                  onAdded={async (msg) => {
                    setToast(msg);
                    await data.reload();
                  }}
                />
              )}
              {teams.length === 0 ? (
                <EmptyState icon={<Users />} title="No stations yet">
                  A station appears when a line's owner registers a consumer team, or when an admin adds a member.
                </EmptyState>
              ) : (
                <ul className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" aria-label="Teams">
                  {teams.map((t) => {
                    const interchange = t.contractIds.length > 1;
                    return (
                      <li key={t.name} data-testid="team-card" className="grid gap-x-6 gap-y-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                        <div className="flex min-w-0 gap-3.5">
                          <span
                            aria-hidden="true"
                            className={
                              interchange
                                ? 'mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full border-[3px] border-[var(--world-ink)] bg-surface'
                                : 'mt-0.5 size-[22px] shrink-0 rounded-full border-[3px] border-[var(--world-ink)] bg-surface'
                            }
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="m-0 text-base font-semibold">{t.name}</h2>
                              {interchange && <Tag size="sm">Interchange</Tag>}
                              {inTeam(mine, t.name) && <Tag size="sm" tone="brand">Your team</Tag>}
                            </div>
                            <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-3 gap-y-1.5 p-0" aria-label={`Lines stopping at ${t.name}`}>
                              {t.contractIds.length === 0 ? (
                                <li className="text-ui text-muted">No lines stop here yet</li>
                              ) : (
                                t.contractIds.map((id) => {
                                  const c = contracts.find((x) => x.id === id);
                                  return (
                                    <li key={id} className="inline-flex items-center gap-1.5 text-ui">
                                      {c ? (
                                        <>
                                          <LineBullet line={lineStyleFor(contracts, id)} size={16} />
                                          <Link to={`/contracts/${c.id}`}>{c.name}</Link>
                                        </>
                                      ) : (
                                        'A removed contract'
                                      )}
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                          </div>
                        </div>
                        <div className="min-w-0 md:pt-0.5">
                          <div className="x-legend-label mb-2 text-muted">{plural(t.members.length, 'member')}</div>
                          {t.members.length === 0 ? (
                            <p className="m-0 text-ui text-muted">No signed-in members yet.</p>
                          ) : (
                            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                              {t.members.map((m) => (
                                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <Avatar name={m.memberName} size="sm" />
                                    <span className="truncate">
                                      {m.memberName}
                                      {m.memberSub === me.sub && <span className="text-muted"> (you)</span>}
                                    </span>
                                  </span>
                                  {(isAdmin || m.memberSub === me.sub) && (
                                    <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.memberName} from ${t.name}`}>
                                      {m.memberSub === me.sub && !isAdmin ? 'Leave' : 'Remove'}
                                    </Button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {t.contacts.length > 0 && (
                            <p className="m-0 mt-2 text-xs text-muted">
                              Named contacts: {t.contacts.map((c) => `${c.name}${c.sub ? '' : ' (not linked to a sign-in)'}`).join(', ')}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!isAdmin && (
                <p className="m-0 mt-4 text-xs text-muted">Admins manage membership. A named contact answers for one line only.</p>
              )}
            </>
          );
        }}
      </DataState>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.memberName ?? 'member'} from ${removing?.teamName ?? 'the team'}?`}
        body="They stop seeing this team's signals in their signal box and can no longer answer for it."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await removeTeamMember(store, me, removing.id);
          setToast(`${removing.memberName} removed from ${removing.teamName}.`);
          await data.reload();
        }}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function AddMemberForm({
  teamNames,
  people,
  onAdded,
}: {
  teamNames: string[];
  people: { sub: string; name: string; email: string | null }[];
  onAdded: (msg: string) => Promise<void>;
}) {
  const { store, me } = useApp<Schema>();
  const id = useId();
  const [team, setTeam] = useState('');
  const [sub, setSub] = useState('');
  const [errors, setErrors] = useState<{ team?: string; sub?: string }>({});
  const add = useAction(async () => {
    const e = { team: validateTeamName(team) ?? undefined, sub: sub ? undefined : 'Choose a person.' };
    setErrors(e);
    if (hasErrors(e)) return;
    const person = people.find((p) => p.sub === sub)!;
    const row = await addTeamMember(store, me, { teamName: team, memberSub: sub, memberName: person.name });
    setTeam('');
    setSub('');
    await onAdded(`${row.memberName} is in ${row.teamName}.`);
  });
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface-sunken px-4 py-4" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="m-0 mb-3 text-sm font-semibold">
        Add a team member
      </h2>
      <form
        noValidate
        className="grid gap-x-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run();
        }}
      >
        <Field label="Team" htmlFor={`${id}-team`} required error={errors.team} counter={{ value: team.length, max: limits.teamName.max }}>
          <Input id={`${id}-team`} list={`${id}-teams`} value={team} onChange={(e) => setTeam(e.target.value)} invalid={!!errors.team} />
          <datalist id={`${id}-teams`}>
            {teamNames.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Person" htmlFor={`${id}-person`} required error={errors.sub} hint="People appear here after they open the app once.">
          <Select id={`${id}-person`} value={sub} onChange={(e) => setSub(e.target.value)} invalid={!!errors.sub}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.sub} value={p.sub}>
                {p.name}
                {p.email ? ` (${p.email})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:pt-6">
          <Button type="submit" variant="primary" icon={<UserPlus />} busy={add.pending} className="w-full sm:w-auto">
            Add member
          </Button>
        </div>
      </form>
      <InlineError error={add.error} />
    </section>
  );
}
