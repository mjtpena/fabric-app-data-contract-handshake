/**
 * Team membership and what it lets a viewer answer.
 *
 * - Team membership is global (by team name) and comes only from TeamMember rows, which only admins create. A member
 *   answers for their team on every contract that team consumes.
 * - Being the linked contact (contactSub) of one consumer registration is scoped to that registration: it lets the
 *   contact answer that consumer's acks only. It never makes them a member of the team. Anyone can register a contract
 *   and name themselves as a contact, so a contact link must not reach other producers' contracts.
 *
 * Team names compare case- and space-insensitively. A person can be in any number of teams.
 */
import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText, normKey } from '@x10/shared/lib';

import { limits, type Consumer, type Schema, type TeamMember } from '../model';

/** Tidy a team name for storage: trim and collapse inner spaces. */
export function cleanTeamName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** The team names `sub` is a member of (TeamMember rows only), de-duplicated (first-seen spelling) and sorted. */
export function teamsOf(sub: string, members: Pick<TeamMember, 'teamName' | 'memberSub'>[]): string[] {
  const out = new Map<string, string>();
  for (const m of members) {
    if (m.memberSub !== sub) continue;
    const k = normKey(m.teamName);
    if (!out.has(k)) out.set(k, cleanTeamName(m.teamName));
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

export function inTeam(myTeams: string[], teamName: string): boolean {
  const k = normKey(teamName);
  return myTeams.some((t) => normKey(t) === k);
}

/** What a viewer may answer for: their teams (global) and the consumer registrations they are the contact of. */
export interface ViewerScope {
  teams: string[];
  /** Consumer ids where the viewer is the linked contact. Grants rights on those consumers' acks only. */
  contactConsumerIds: string[];
}

export function scopeOf(
  sub: string,
  members: Pick<TeamMember, 'teamName' | 'memberSub'>[],
  consumers: Pick<Consumer, 'id' | 'contactSub'>[],
): ViewerScope {
  return {
    teams: teamsOf(sub, members),
    contactConsumerIds: consumers.filter((c) => !!c.contactSub && c.contactSub === sub).map((c) => c.id),
  };
}

/** True when the ack belongs to one of the viewer's teams or to a consumer they are the contact of. */
export function answersFor(scope: ViewerScope, ack: { teamName: string; consumerId: string }): boolean {
  return inTeam(scope.teams, ack.teamName) || scope.contactConsumerIds.includes(ack.consumerId);
}

export async function myTeams(store: DataStore<Schema>, sub: string): Promise<string[]> {
  return teamsOf(sub, await store.repo('TeamMember').list({ where: { memberSub: sub } }));
}

export async function myScope(store: DataStore<Schema>, sub: string): Promise<ViewerScope> {
  const [members, consumers] = await Promise.all([
    store.repo('TeamMember').list({ where: { memberSub: sub } }),
    store.repo('Consumer').list({ where: { contactSub: sub } }),
  ]);
  return scopeOf(sub, members, consumers);
}

export interface TeamView {
  name: string;
  members: TeamMember[];
  /** Contacts named on consumer registrations who have no TeamMember row (possibly without a linked person). */
  contacts: { sub: string | null; name: string }[];
  contractIds: string[];
}

/** Every team known from membership rows or consumer registrations, with members and contracts consumed. */
export function buildTeams(members: TeamMember[], consumers: Consumer[]): TeamView[] {
  const teams = new Map<string, TeamView>();
  const team = (name: string) => {
    const k = normKey(name);
    let t = teams.get(k);
    if (!t) {
      t = { name: cleanTeamName(name), members: [], contacts: [], contractIds: [] };
      teams.set(k, t);
    }
    return t;
  };
  for (const m of members) team(m.teamName).members.push(m);
  for (const c of consumers) {
    const t = team(c.teamName);
    if (!t.contractIds.includes(c.contractId)) t.contractIds.push(c.contractId);
    const isMember = !!c.contactSub && t.members.some((m) => m.memberSub === c.contactSub);
    const listed = t.contacts.some((x) => (c.contactSub ? x.sub === c.contactSub : x.name === c.contactName));
    if (!isMember && !listed) t.contacts.push({ sub: c.contactSub, name: c.contactName });
  }
  for (const t of teams.values()) t.members.sort((a, b) => a.memberName.localeCompare(b.memberName));
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTeams(store: DataStore<Schema>) {
  const [members, consumers, contracts, people] = await Promise.all([
    store.repo('TeamMember').list(),
    store.repo('Consumer').list(),
    store.repo('Contract').list({ orderBy: { field: 'name' } }),
    store.repo('Person').list({ orderBy: { field: 'displayName' } }),
  ]);
  return { teams: buildTeams(members, consumers), contracts, people };
}

export function validateTeamName(name: string): string | null {
  return checkText(name, { ...limits.teamName, label: 'Team name' });
}

/**
 * Add a person to a team (admins only: membership is global and grants ack rights on every contract the team
 * consumes). Adding an existing member is a no-op that returns the existing row.
 */
export async function addTeamMember(
  store: DataStore<Schema>,
  me: Person,
  input: { teamName: string; memberSub: string; memberName: string },
  opts: { now?: Date } = {},
): Promise<TeamMember> {
  if (me.isAdmin !== true) throw new PermissionError('Only an admin can change team membership.');
  const msg = validateTeamName(input.teamName);
  if (msg) throw new RuleError(msg);
  if (!input.memberSub) throw new RuleError('Choose a person to add.');
  const teamName = cleanTeamName(input.teamName);
  const existing = (await store.repo('TeamMember').list({ where: { memberSub: input.memberSub } })).find(
    (m) => normKey(m.teamName) === normKey(teamName),
  );
  if (existing) return existing;
  return store.repo('TeamMember').create({
    teamName,
    memberSub: input.memberSub,
    memberName: input.memberName.trim().slice(0, limits.contactName.max) || 'Team member',
    addedBySub: me.sub,
    createdAt: (opts.now ?? new Date()).toISOString(),
  });
}

/** Admins remove anyone; a member may remove themselves. */
export async function removeTeamMember(store: DataStore<Schema>, me: Person, memberId: string): Promise<void> {
  const row = await store.repo('TeamMember').get(memberId);
  if (!row) return;
  if (!me.isAdmin && row.memberSub !== me.sub) {
    throw new PermissionError('Only an admin can remove other people from a team.');
  }
  await store.repo('TeamMember').remove(memberId);
}
