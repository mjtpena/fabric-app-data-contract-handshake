/**
 * Contracts and their consumers: validation, registry and detail loaders, and the owner-only writes.
 */
import { NotFoundError, PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText, normKey, validate, type Errors } from '@x10/shared/lib';

import { limits, type Ack, type ChangeNotice, type Consumer, type Contract, type Schema } from '../model';
import { localToday } from './days';
import { compareHealth, noticeHealth, worstHealth, type Health, type HealthResult } from './health';
import { cleanTeamName } from './teams';

/* ------------------------------------------------------------------ validation */

export interface ContractInput {
  name: string;
  sourceRef: string;
  producerTeam: string;
  description: string;
}

export function validateContract(input: ContractInput): Errors<ContractInput> {
  return validate(input as unknown as Record<string, unknown>, {
    name: (v) => checkText(v as string, { ...limits.contractName, label: 'Name' }),
    sourceRef: (v) => checkText(v as string, { ...limits.sourceRef, label: 'Source' }),
    producerTeam: (v) => checkText(v as string, { ...limits.producerTeam, label: 'Producer team' }),
    description: (v) => checkText(v as string, { ...limits.contractDescription, optional: true, label: 'Description' }),
  }) as Errors<ContractInput>;
}

export interface ConsumerInput {
  teamName: string;
  contactName: string;
  /** Subject of a signed-in person to link as the team's contact; empty for none. */
  contactSub: string;
}

export function validateConsumer(input: ConsumerInput): Errors<ConsumerInput> {
  return validate(input as unknown as Record<string, unknown>, {
    teamName: (v) => checkText(v as string, { ...limits.teamName, label: 'Team name' }),
    contactName: (v) => checkText(v as string, { ...limits.contactName, label: 'Contact name' }),
  }) as Errors<ConsumerInput>;
}

const firstError = (e: object) => Object.values(e).find(Boolean) as string | undefined;

/* ------------------------------------------------------------------ permissions */

export function isOwner(me: Pick<Person, 'sub'>, contract: Pick<Contract, 'ownerSub'>): boolean {
  return me.sub === contract.ownerSub;
}

async function ownedContract(store: DataStore<Schema>, me: Person, contractId: string): Promise<Contract> {
  const contract = await store.repo('Contract').get(contractId);
  if (!contract) throw new NotFoundError('Contract', contractId);
  if (!isOwner(me, contract)) throw new PermissionError(`Only the contract owner (${contract.ownerName}) can change this contract.`);
  return contract;
}

/* ------------------------------------------------------------------ loading */

export interface Snapshot {
  contracts: Contract[];
  consumers: Consumer[];
  notices: ChangeNotice[];
  acks: Ack[];
}

/** Everything the registry and dashboard need. Volumes are small (tens to hundreds of rows). */
export async function loadSnapshot(store: DataStore<Schema>): Promise<Snapshot> {
  const [contracts, consumers, notices, acks] = await Promise.all([
    store.repo('Contract').list({ orderBy: { field: 'name' } }),
    store.repo('Consumer').list(),
    store.repo('ChangeNotice').list(),
    store.repo('Ack').list(),
  ]);
  return { contracts, consumers, notices, acks };
}

export interface NoticeWithHealth {
  notice: ChangeNotice;
  acks: Ack[];
  health: HealthResult;
}

export function withHealth(notices: ChangeNotice[], acks: Ack[], today: string): NoticeWithHealth[] {
  const byNotice = new Map<string, Ack[]>();
  for (const a of acks) byNotice.set(a.noticeId, [...(byNotice.get(a.noticeId) ?? []), a]);
  return notices.map((notice) => {
    const list = byNotice.get(notice.id) ?? [];
    return { notice, acks: list, health: noticeHealth(notice, list, today) };
  });
}

export interface RegistryRow {
  contract: Contract;
  consumerCount: number;
  openNotices: number;
  draftNotices: number;
  /** Worst health over published (open) notices; null when there are none. */
  worst: Health | null;
}

/** Pure: registry rows from a snapshot. Rows with the worst health come first, then by name. */
export function buildRegistry(s: Snapshot, today: string): RegistryRow[] {
  const all = withHealth(s.notices, s.acks, today);
  const rows = s.contracts.map((contract) => {
    const mine = all.filter((n) => n.notice.contractId === contract.id);
    const open = mine.filter((n) => n.notice.status === 'published');
    return {
      contract,
      consumerCount: s.consumers.filter((c) => c.contractId === contract.id).length,
      openNotices: open.length,
      draftNotices: mine.filter((n) => n.notice.status === 'draft').length,
      worst: worstHealth(open.map((n) => n.health.health)),
    };
  });
  return rows.sort((a, b) => {
    const h = compareHealth(b.worst ?? 'ok', a.worst ?? 'ok');
    return h || a.contract.name.localeCompare(b.contract.name);
  });
}

export async function listRegistry(store: DataStore<Schema>, now = new Date()): Promise<RegistryRow[]> {
  return buildRegistry(await loadSnapshot(store), localToday(now));
}

export interface ContractDetail {
  contract: Contract;
  consumers: Consumer[];
  /** Newest effective date first. */
  notices: NoticeWithHealth[];
}

export async function getContractDetail(store: DataStore<Schema>, id: string, now = new Date()): Promise<ContractDetail> {
  const contract = await store.repo('Contract').get(id);
  if (!contract) throw new NotFoundError('Contract', id);
  const [consumers, notices, acks] = await Promise.all([
    store.repo('Consumer').list({ where: { contractId: id } }),
    store.repo('ChangeNotice').list({ where: { contractId: id } }),
    store.repo('Ack').list({ where: { contractId: id } }),
  ]);
  consumers.sort((a, b) => a.teamName.localeCompare(b.teamName));
  const list = withHealth(notices, acks, localToday(now)).sort(
    (a, b) => b.notice.effectiveDate.localeCompare(a.notice.effectiveDate) || b.notice.createdAt.localeCompare(a.notice.createdAt),
  );
  return { contract, consumers, notices: list };
}

/* ------------------------------------------------------------------ contract writes */

async function assertUniqueSource(store: DataStore<Schema>, sourceRef: string, exceptId?: string) {
  const clash = (await store.repo('Contract').list()).find(
    (c) => c.id !== exceptId && normKey(c.sourceRef) === normKey(sourceRef),
  );
  if (clash) throw new RuleError(`"${clash.sourceRef}" is already registered as "${clash.name}".`);
}

/** Anyone signed in can register a contract; they become its owner. */
export async function createContract(store: DataStore<Schema>, me: Person, input: ContractInput, now = new Date()): Promise<Contract> {
  const err = firstError(validateContract(input));
  if (err) throw new RuleError(err);
  await assertUniqueSource(store, input.sourceRef);
  return store.repo('Contract').create({
    name: input.name.trim(),
    sourceRef: input.sourceRef.trim(),
    producerTeam: input.producerTeam.trim(),
    ownerSub: me.sub,
    ownerName: me.displayName,
    description: input.description.trim() || null,
    createdAt: now.toISOString(),
  });
}

export async function updateContract(store: DataStore<Schema>, me: Person, id: string, input: ContractInput): Promise<Contract> {
  await ownedContract(store, me, id);
  const err = firstError(validateContract(input));
  if (err) throw new RuleError(err);
  await assertUniqueSource(store, input.sourceRef, id);
  return store.repo('Contract').update(id, {
    name: input.name.trim(),
    sourceRef: input.sourceRef.trim(),
    producerTeam: input.producerTeam.trim(),
    description: input.description.trim() || null,
  });
}

/* ------------------------------------------------------------------ acks shared with notices.ts */

/**
 * Create a pending ack for (notice, consumer) unless one exists. The existence check runs right before the insert,
 * so a retried publish or a double click never creates duplicates. Returns true when a row was created.
 */
export async function ensurePendingAck(
  store: DataStore<Schema>,
  me: Person,
  notice: ChangeNotice,
  consumer: Consumer,
  now: Date,
): Promise<boolean> {
  const existing = await store.repo('Ack').list({ where: { noticeId: notice.id, consumerId: consumer.id }, limit: 1 });
  if (existing.length) return false;
  await store.repo('Ack').create({
    noticeId: notice.id,
    consumerId: consumer.id,
    contractId: notice.contractId,
    teamName: consumer.teamName,
    contractOwnerSub: consumer.ownerSub,
    status: 'pending',
    note: null,
    updatedBy: me.sub,
    updatedByName: me.displayName,
    updatedAt: now.toISOString(),
  });
  return true;
}

/* ------------------------------------------------------------------ consumer writes */

/**
 * Register a consumer team (owner only). A linked contact person may answer this consumer's acks only; it does not
 * make them a member of the team (membership is global and admin-managed, see teams.ts). Spec rule 3: a pending ack is created for every open (published) notice of the contract.
 */
export async function addConsumer(
  store: DataStore<Schema>,
  me: Person,
  contractId: string,
  input: ConsumerInput,
  now = new Date(),
): Promise<{ consumer: Consumer; acksCreated: number }> {
  const contract = await ownedContract(store, me, contractId);
  const err = firstError(validateConsumer(input));
  if (err) throw new RuleError(err);
  const teamName = cleanTeamName(input.teamName);
  const existing = await store.repo('Consumer').list({ where: { contractId } });
  if (existing.some((c) => normKey(c.teamName) === normKey(teamName))) {
    throw new RuleError(`${teamName} is already a consumer of this contract.`);
  }
  const consumer = await store.repo('Consumer').create({
    contractId,
    teamName,
    contactName: input.contactName.trim(),
    contactSub: input.contactSub || null,
    ownerSub: contract.ownerSub,
    createdAt: now.toISOString(),
  });
  const open = await store.repo('ChangeNotice').list({ where: { contractId, status: 'published' } });
  let acksCreated = 0;
  for (const notice of open) if (await ensurePendingAck(store, me, notice, consumer, now)) acksCreated++;
  return { consumer, acksCreated };
}

export const CONSUMER_REMOVED_NOTE = 'consumer removed';

/**
 * Remove a consumer (owner only). Their open acks (pending or objected, on published notices) are marked migrated
 * with the note "consumer removed", so open notices are not left waiting on a team that no longer consumes the data.
 */
export async function removeConsumer(
  store: DataStore<Schema>,
  me: Person,
  consumerId: string,
  now = new Date(),
): Promise<{ acksClosed: number }> {
  const consumer = await store.repo('Consumer').get(consumerId);
  if (!consumer) throw new NotFoundError('Consumer', consumerId);
  await ownedContract(store, me, consumer.contractId);
  const acks = await store.repo('Ack').list({ where: { consumerId } });
  let acksClosed = 0;
  for (const ack of acks) {
    if (ack.status !== 'pending' && ack.status !== 'objected') continue;
    const notice = await store.repo('ChangeNotice').get(ack.noticeId);
    if (!notice || notice.status !== 'published') continue;
    await store.repo('Ack').update(ack.id, {
      status: 'migrated',
      note: CONSUMER_REMOVED_NOTE,
      updatedBy: me.sub,
      updatedByName: me.displayName,
      updatedAt: now.toISOString(),
    });
    acksClosed++;
  }
  await store.repo('Consumer').remove(consumerId);
  return { acksClosed };
}
