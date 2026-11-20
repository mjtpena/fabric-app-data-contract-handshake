/**
 * Change notices and acks: drafting, publishing (idempotent), closing, responding, and the inbox and dashboard views.
 */
import { NotFoundError, PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText, validate, type Errors } from '@x10/shared/lib';

import { rules } from '../config';
import {
  CHANGE_TYPES,
  limits,
  type Ack,
  type AckStatus,
  type ChangeNotice,
  type ChangeType,
  type Consumer,
  type Contract,
  type Schema,
} from '../model';
import { ensurePendingAck, isOwner, loadSnapshot, withHealth, type NoticeWithHealth, type Snapshot } from './contracts';
import { daysUntil, fromDayInput, localToday } from './days';
import { compareHealth, noticeHealth, type Health, type HealthResult } from './health';
import { answersFor, inTeam, myScope, type ViewerScope } from './teams';

/* ------------------------------------------------------------------ validation */

export interface NoticeInput {
  title: string;
  changeType: ChangeType | '';
  description: string;
  /** <input type="date"> value, "YYYY-MM-DD". */
  effectiveDay: string;
}

export function validateNotice(input: NoticeInput): Errors<NoticeInput> {
  return validate(input as unknown as Record<string, unknown>, {
    title: (v) => checkText(v as string, { ...limits.noticeTitle, label: 'Title' }),
    changeType: (v) => (CHANGE_TYPES.includes(v as ChangeType) ? null : 'Choose a change type.'),
    description: (v) => checkText(v as string, { ...limits.noticeDescription, label: 'Description' }),
    effectiveDay: (v) => (fromDayInput(v as string) ? null : 'Choose the date the change takes effect.'),
  }) as Errors<NoticeInput>;
}

const firstError = (e: object) => Object.values(e).find(Boolean) as string | undefined;

/** Why a draft cannot be published, or null when it can. */
export function publishBlocker(notice: Pick<ChangeNotice, 'status' | 'effectiveDate'>, today: string): string | null {
  if (notice.status === 'closed') return 'This notice is closed.';
  if (notice.status === 'draft' && daysUntil(notice.effectiveDate, today) < 0) {
    return 'The effective date is in the past. Move it to today or later before publishing.';
  }
  return null;
}

/* ------------------------------------------------------------------ permissions (pure) */

export interface Viewer {
  sub: string;
  isAdmin: boolean | null;
}

/**
 * Spec rule 2: a member of the ack's team (admin-managed TeamMember rows), or the linked contact of that specific
 * consumer registration, may respond; the contract owner or an admin may change any team's ack.
 * Returns why not, or null when allowed.
 */
export function ackDenial(
  me: Viewer,
  scope: ViewerScope,
  ack: Pick<Ack, 'teamName' | 'consumerId' | 'contractOwnerSub'>,
): string | null {
  if (answersFor(scope, ack)) return null;
  if (me.sub === ack.contractOwnerSub || me.isAdmin === true) return null;
  return `Only members of ${ack.teamName}, the contract owner or an admin can change this ack.`;
}

/** Spec rule 6: closable when healthy (owner or admin), or by an admin with a note. */
export function closeDenial(me: Viewer, ownerSub: string, health: Health, note: string): string | null {
  const owner = me.sub === ownerSub;
  const admin = me.isAdmin === true;
  if (!owner && !admin) return 'Only the contract owner or an admin can close a notice.';
  if (health === 'ok') return null;
  if (!admin) return 'A notice can be closed only when every consumer has acknowledged or migrated. An admin can override with a note.';
  if (!note.trim()) return 'An admin override needs a note explaining why the notice is closed early.';
  return null;
}

/* ------------------------------------------------------------------ notice writes */

async function loadOwned(store: DataStore<Schema>, me: Person, noticeId: string) {
  const notice = await store.repo('ChangeNotice').get(noticeId);
  if (!notice) throw new NotFoundError('ChangeNotice', noticeId);
  const contract = await store.repo('Contract').get(notice.contractId);
  if (!contract) throw new NotFoundError('Contract', notice.contractId);
  if (!isOwner(me, contract)) {
    throw new PermissionError(`Only the contract owner (${contract.ownerName}) can change notices on this contract.`);
  }
  return { notice, contract };
}

export async function createNotice(
  store: DataStore<Schema>,
  me: Person,
  contractId: string,
  input: NoticeInput,
  now = new Date(),
): Promise<ChangeNotice> {
  const contract = await store.repo('Contract').get(contractId);
  if (!contract) throw new NotFoundError('Contract', contractId);
  if (!isOwner(me, contract)) throw new PermissionError(`Only the contract owner (${contract.ownerName}) can announce changes.`);
  const err = firstError(validateNotice(input));
  if (err) throw new RuleError(err);
  return store.repo('ChangeNotice').create({
    contractId,
    title: input.title.trim(),
    changeType: input.changeType as ChangeType,
    description: input.description.trim(),
    effectiveDate: fromDayInput(input.effectiveDay)!,
    status: 'draft',
    ownerSub: contract.ownerSub,
    createdBy: me.sub,
    createdByName: me.displayName,
    createdAt: now.toISOString(),
    publishedAt: null,
    closedAt: null,
    closedByName: null,
    closeNote: null,
  });
}

/** Drafts only: a published notice is a promise to consumers. */
export async function updateNotice(store: DataStore<Schema>, me: Person, noticeId: string, input: NoticeInput): Promise<ChangeNotice> {
  const { notice } = await loadOwned(store, me, noticeId);
  if (notice.status !== 'draft') throw new RuleError('Only drafts can be edited. This notice is already published.');
  const err = firstError(validateNotice(input));
  if (err) throw new RuleError(err);
  return store.repo('ChangeNotice').update(noticeId, {
    title: input.title.trim(),
    changeType: input.changeType as ChangeType,
    description: input.description.trim(),
    effectiveDate: fromDayInput(input.effectiveDay)!,
  });
}

export async function deleteDraft(store: DataStore<Schema>, me: Person, noticeId: string): Promise<void> {
  const { notice } = await loadOwned(store, me, noticeId);
  if (notice.status !== 'draft') throw new RuleError('Only drafts can be deleted. Close a published notice instead.');
  await store.repo('ChangeNotice').remove(noticeId);
}

/**
 * Spec rule 1. For each consumer of the contract, create one pending ack (checking (noticeId, consumerId) right
 * before each insert), then set the notice to published last. Running it again, or after a partial failure, only
 * fills in what is missing. A draft whose effective date has passed cannot be published.
 */
export async function publishNotice(
  store: DataStore<Schema>,
  me: Person,
  noticeId: string,
  now = new Date(),
): Promise<{ notice: ChangeNotice; acksCreated: number; consumers: number }> {
  const { notice } = await loadOwned(store, me, noticeId);
  const blocker = publishBlocker(notice, localToday(now));
  if (blocker) throw new RuleError(blocker);
  const consumers = await store.repo('Consumer').list({ where: { contractId: notice.contractId } });
  let acksCreated = 0;
  for (const consumer of consumers) if (await ensurePendingAck(store, me, notice, consumer, now)) acksCreated++;
  const published =
    notice.status === 'published'
      ? notice
      : await store.repo('ChangeNotice').update(noticeId, { status: 'published', publishedAt: now.toISOString() });
  return { notice: published, acksCreated, consumers: consumers.length };
}

export async function closeNotice(
  store: DataStore<Schema>,
  me: Person,
  noticeId: string,
  note: string,
  now = new Date(),
): Promise<ChangeNotice> {
  const notice = await store.repo('ChangeNotice').get(noticeId);
  if (!notice) throw new NotFoundError('ChangeNotice', noticeId);
  if (notice.status !== 'published') throw new RuleError('Only published notices can be closed.');
  const contract = await store.repo('Contract').get(notice.contractId);
  if (!contract) throw new NotFoundError('Contract', notice.contractId);
  const clean = note.trim();
  if (clean.length > limits.closeNote.max) throw new RuleError(`The note must be ${limits.closeNote.max} characters or fewer.`);
  const acks = await store.repo('Ack').list({ where: { noticeId } });
  const health = noticeHealth(notice, acks, localToday(now)).health;
  const denial = closeDenial(me, contract.ownerSub, health, clean);
  if (denial) throw (me.sub === contract.ownerSub || me.isAdmin ? new RuleError(denial) : new PermissionError(denial));
  return store.repo('ChangeNotice').update(noticeId, {
    status: 'closed',
    closedAt: now.toISOString(),
    closedByName: me.displayName,
    closeNote: clean || null,
  });
}

/* ------------------------------------------------------------------ acks */

export const RESPONSES: AckStatus[] = ['acknowledged', 'objected', 'migrated'];

/**
 * Spec rule 2: set an ack. Objected needs a note (spec acceptance 3). Pending (a reset) is for the contract owner
 * or an admin only. Acks can change only while the notice is published.
 */
export async function setAckStatus(
  store: DataStore<Schema>,
  me: Person,
  ackId: string,
  status: AckStatus,
  note = '',
  now = new Date(),
): Promise<Ack> {
  const ack = await store.repo('Ack').get(ackId);
  if (!ack) throw new NotFoundError('Ack', ackId);
  const notice = await store.repo('ChangeNotice').get(ack.noticeId);
  if (!notice) throw new NotFoundError('ChangeNotice', ack.noticeId);
  if (notice.status !== 'published') throw new RuleError('This notice is closed, so acks can no longer change.');
  const denial = ackDenial(me, await myScope(store, me.sub), ack);
  if (denial) throw new PermissionError(denial);
  if (status === 'pending' && me.sub !== ack.contractOwnerSub && !me.isAdmin) {
    throw new PermissionError('Only the contract owner or an admin can reset an ack to pending.');
  }
  const clean = note.trim();
  if (status === 'objected' && !clean) throw new RuleError('An objection needs a note so the producer knows what to fix.');
  if (clean.length > limits.ackNote.max) throw new RuleError(`The note must be ${limits.ackNote.max} characters or fewer.`);
  return store.repo('Ack').update(ackId, {
    status,
    note: clean || null,
    updatedBy: me.sub,
    updatedByName: me.displayName,
    updatedAt: now.toISOString(),
  });
}

/* ------------------------------------------------------------------ detail */

export interface AckRow {
  ack: Ack;
  /** Null when the consumer has since been removed. */
  consumer: Consumer | null;
  /** Whether the viewer may respond for this row, and whether it is one of their own teams. */
  canAct: boolean;
  ownTeam: boolean;
}

export interface NoticeDetail {
  notice: ChangeNotice;
  contract: Contract;
  health: HealthResult;
  rows: AckRow[];
  myTeams: string[];
  /** Consumer ids on this contract the viewer is the linked contact of. */
  contactConsumerIds: string[];
  isOwner: boolean;
  consumerCount: number;
}

export async function getNoticeDetail(
  store: DataStore<Schema>,
  me: Person,
  noticeId: string,
  now = new Date(),
): Promise<NoticeDetail> {
  const notice = await store.repo('ChangeNotice').get(noticeId);
  if (!notice) throw new NotFoundError('ChangeNotice', noticeId);
  const [contract, acks, consumers, scope] = await Promise.all([
    store.repo('Contract').get(notice.contractId),
    store.repo('Ack').list({ where: { noticeId } }),
    store.repo('Consumer').list({ where: { contractId: notice.contractId } }),
    myScope(store, me.sub),
  ]);
  if (!contract) throw new NotFoundError('Contract', notice.contractId);
  const open = notice.status === 'published';
  const rows = acks
    .map((ack) => ({
      ack,
      consumer: consumers.find((c) => c.id === ack.consumerId) ?? null,
      ownTeam: answersFor(scope, ack),
      canAct: open && ackDenial(me, scope, ack) === null,
    }))
    .sort((a, b) => Number(b.ownTeam) - Number(a.ownTeam) || a.ack.teamName.localeCompare(b.ack.teamName));
  return {
    notice,
    contract,
    health: noticeHealth(notice, acks, localToday(now)),
    rows,
    myTeams: scope.teams,
    contactConsumerIds: scope.contactConsumerIds.filter((id) => consumers.some((c) => c.id === id)),
    isOwner: isOwner(me, contract),
    consumerCount: consumers.length,
  };
}

/* ------------------------------------------------------------------ inbox */

export interface InboxItem {
  ack: Ack;
  notice: ChangeNotice;
  contract: Contract | null;
  health: HealthResult;
}

/**
 * Pure: pending acks on published notices that the viewer answers for (their teams, or consumers they are the linked
 * contact of), soonest effective date first.
 */
export function buildInbox(s: Snapshot, scope: ViewerScope, today: string): InboxItem[] {
  const health = new Map(withHealth(s.notices, s.acks, today).map((n) => [n.notice.id, n.health]));
  const items: InboxItem[] = [];
  for (const ack of s.acks) {
    if (ack.status !== 'pending' || !answersFor(scope, ack)) continue;
    const notice = s.notices.find((n) => n.id === ack.noticeId);
    if (!notice || notice.status !== 'published') continue;
    items.push({
      ack,
      notice,
      contract: s.contracts.find((c) => c.id === notice.contractId) ?? null,
      health: health.get(notice.id)!,
    });
  }
  return items.sort(
    (a, b) => a.notice.effectiveDate.localeCompare(b.notice.effectiveDate) || a.ack.teamName.localeCompare(b.ack.teamName),
  );
}

export async function listInbox(store: DataStore<Schema>, me: Person, now = new Date()) {
  const [snapshot, scope] = await Promise.all([loadSnapshot(store), myScope(store, me.sub)]);
  // Contact-only registrations (the viewer is not a member of that team), labelled for the inbox header.
  const contactFor = snapshot.consumers
    .filter((c) => scope.contactConsumerIds.includes(c.id) && !inTeam(scope.teams, c.teamName))
    .map((c) => `${c.teamName} on ${snapshot.contracts.find((k) => k.id === c.contractId)?.name ?? "a contract"}`)
    .sort();
  return { teams: scope.teams, contactFor, items: buildInbox(snapshot, scope, localToday(now)) };
}

/* ------------------------------------------------------------------ dashboard */

export interface DashboardData {
  kpis: { published: number; at_risk: number; overdue: number; blocked: number };
  /** One row per open notice with acks, effective within the horizon (or overdue), soonest first. */
  chart: { label: string; title: string; noticeId: string; pending: number; acknowledged: number; objected: number; migrated: number }[];
  /** Open notices that need attention (blocked, overdue, at risk), worst first. */
  attention: (NoticeWithHealth & { contract: Contract | null })[];
}

export const CHART_LABEL_MAX = 18;

export function buildDashboard(s: Snapshot, today: string): DashboardData {
  const open = withHealth(
    s.notices.filter((n) => n.status === 'published'),
    s.acks,
    today,
  );
  const count = (h: Health) => open.filter((n) => n.health.health === h).length;
  const soon = open
    .filter((n) => n.acks.length > 0)
    .filter((n) => n.health.daysLeft <= rules.dashboardHorizonDays && (n.health.daysLeft >= 0 || n.health.pending > 0))
    .sort((a, b) => a.notice.effectiveDate.localeCompare(b.notice.effectiveDate));
  const seen = new Map<string, number>();
  const chart = soon.map((n) => {
    const c = (st: AckStatus) => n.acks.filter((a) => a.status === st).length;
    // Short labels fit the chart's category axis; repeated labels get a counter so bars never merge.
    const short = n.notice.title.length > CHART_LABEL_MAX ? `${n.notice.title.slice(0, CHART_LABEL_MAX - 1)}…` : n.notice.title;
    const seenCount = (seen.get(short) ?? 0) + 1;
    seen.set(short, seenCount);
    return {
      label: seenCount > 1 ? `${short} (${seenCount})` : short,
      title: n.notice.title,
      noticeId: n.notice.id,
      pending: c('pending'),
      acknowledged: c('acknowledged'),
      objected: c('objected'),
      migrated: c('migrated'),
    };
  });
  const attention = open
    .filter((n) => n.health.health === 'blocked' || n.health.health === 'overdue' || n.health.health === 'at_risk')
    .sort((a, b) => compareHealth(b.health.health, a.health.health) || a.notice.effectiveDate.localeCompare(b.notice.effectiveDate))
    .map((n) => ({ ...n, contract: s.contracts.find((c) => c.id === n.notice.contractId) ?? null }));
  return {
    kpis: { published: open.length, at_risk: count('at_risk'), overdue: count('overdue'), blocked: count('blocked') },
    chart,
    attention,
  };
}

export async function loadDashboard(store: DataStore<Schema>, now = new Date()): Promise<DashboardData> {
  return buildDashboard(await loadSnapshot(store), localToday(now));
}
