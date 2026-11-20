import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed } from '../seed';
import { addConsumer, createContract, listRegistry, removeConsumer, CONSUMER_REMOVED_NOTE } from './contracts';
import { addTeamMember } from './teams';
import { localToday, shiftDays, toDayInput } from './days';
import {
  ackDenial,
  closeDenial,
  closeNotice,
  createNotice,
  deleteDraft,
  getNoticeDetail,
  listInbox,
  loadDashboard,
  publishBlocker,
  publishNotice,
  setAckStatus,
  updateNotice,
  validateNotice,
} from './notices';

const LATER = new Date(FIXED_NOW.getTime() + 60_000);
const today = localToday(FIXED_NOW);
const dayInput = (n: number) => toDayInput(shiftDays(today, n));

async function setup() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await store.repo('Person').list();
  const who = (sub: string) => people.find((p) => p.sub === sub)!;
  const notices = await store.repo('ChangeNotice').list();
  const byTitle = (t: string) => notices.find((n) => n.title.startsWith(t))!;
  const contracts = await store.repo('Contract').list();
  const contract = (name: string) => contracts.find((c) => c.name === name)!;
  return {
    store,
    admin: who('demo-admin'),
    producer: who('demo-producer'),
    priya: who('demo-finance'),
    jordan: who('demo-two-teams'),
    chen: who('demo-marketing'),
    byTitle,
    contract,
  };
}

const draftInput = (title: string, inDays: number) => ({
  title,
  changeType: 'breaking' as const,
  description: 'A sufficiently long description of the change.',
  effectiveDay: dayInput(inDays),
});

describe('validation', () => {
  it('uses the entity limits', () => {
    const e = validateNotice({ title: 'ab', changeType: '', description: 'short', effectiveDay: '' });
    expect(e.title).toMatch(/at least 3/);
    expect(e.changeType).toMatch(/change type/);
    expect(e.description).toMatch(/at least 10/);
    expect(e.effectiveDay).toMatch(/date/);
    expect(validateNotice(draftInput('Good title', 3))).toEqual({});
    expect(validateNotice({ ...draftInput('x'.repeat(121), 3) }).title).toMatch(/120/);
  });

  it('publishBlocker blocks past-dated drafts and closed notices only', () => {
    expect(publishBlocker({ status: 'draft', effectiveDate: shiftDays(today, -1) }, today)).toMatch(/past/);
    expect(publishBlocker({ status: 'draft', effectiveDate: today }, today)).toBeNull();
    expect(publishBlocker({ status: 'closed', effectiveDate: today }, today)).toMatch(/closed/);
    expect(publishBlocker({ status: 'published', effectiveDate: shiftDays(today, -9) }, today)).toBeNull();
  });
});

describe('publish (spec rule 1, acceptance 2)', () => {
  it('creates exactly 3 acks for 3 consumers even when run twice, and sets published last', async () => {
    const { store, producer, contract } = await setup();
    const inv = contract('Inventory snapshot');
    expect(await store.repo('Consumer').list({ where: { contractId: inv.id } })).toHaveLength(3);
    const draft = await createNotice(store, producer, inv.id, draftInput('Rename sku to product_code', 14), FIXED_NOW);

    const first = await publishNotice(store, producer, draft.id, FIXED_NOW);
    expect(first.acksCreated).toBe(3);
    expect(first.notice.status).toBe('published');
    const second = await publishNotice(store, producer, draft.id, LATER);
    expect(second.acksCreated).toBe(0);
    expect(second.notice.publishedAt).toBe(first.notice.publishedAt);

    const acks = await store.repo('Ack').list({ where: { noticeId: draft.id } });
    expect(acks).toHaveLength(3);
    expect(new Set(acks.map((a) => a.consumerId)).size).toBe(3);
    expect(acks.every((a) => a.status === 'pending' && a.contractOwnerSub === producer.sub)).toBe(true);
  });

  it('a retry after a partial failure only fills in the missing acks', async () => {
    const { store, producer, contract } = await setup();
    const inv = contract('Inventory snapshot');
    const draft = await createNotice(store, producer, inv.id, draftInput('Partial publish', 10), FIXED_NOW);
    const [firstConsumer] = await store.repo('Consumer').list({ where: { contractId: inv.id } });
    await store.repo('Ack').create({
      noticeId: draft.id,
      consumerId: firstConsumer.id,
      contractId: inv.id,
      teamName: firstConsumer.teamName,
      contractOwnerSub: producer.sub,
      status: 'pending',
      note: null,
      updatedBy: producer.sub,
      updatedByName: producer.displayName,
      updatedAt: FIXED_NOW.toISOString(),
    });
    expect((await store.repo('ChangeNotice').get(draft.id))!.status).toBe('draft');
    const r = await publishNotice(store, producer, draft.id, FIXED_NOW);
    expect(r.acksCreated).toBe(2);
    expect(await store.repo('Ack').list({ where: { noticeId: draft.id } })).toHaveLength(3);
  });

  it('blocks publishing a draft whose effective date is in the past', async () => {
    const { store, producer, byTitle } = await setup();
    const past = byTitle('Drop referrer_raw');
    await expect(publishNotice(store, producer, past.id, FIXED_NOW)).rejects.toThrow(/in the past/);
    expect(await store.repo('Ack').list({ where: { noticeId: past.id } })).toHaveLength(0);
    expect((await store.repo('ChangeNotice').get(past.id))!.status).toBe('draft');
  });

  it('allows publishing a draft effective today', async () => {
    const { store, producer, contract } = await setup();
    const draft = await createNotice(store, producer, contract('Web sessions').id, draftInput('Effective today', 0), FIXED_NOW);
    await expect(publishNotice(store, producer, draft.id, FIXED_NOW)).resolves.toMatchObject({ acksCreated: 2 });
  });

  it('publishing on a contract with no consumers works and reports ok with a warning', async () => {
    const { store, admin, contract } = await setup();
    const fx = contract('Currency rates');
    const draft = await createNotice(store, admin, fx.id, draftInput('Add bid and ask', 4), FIXED_NOW);
    const r = await publishNotice(store, admin, draft.id, FIXED_NOW);
    expect(r).toMatchObject({ acksCreated: 0, consumers: 0 });
    const detail = await getNoticeDetail(store, admin, draft.id, FIXED_NOW);
    expect(detail.health.health).toBe('ok');
    expect(detail.health.warning).toMatch(/No consumers/);
  });

  it('only the contract owner can create, edit, publish or delete notices', async () => {
    const { store, admin, priya, producer, contract, byTitle } = await setup();
    const inv = contract('Inventory snapshot');
    await expect(createNotice(store, priya, inv.id, draftInput('Not mine', 9))).rejects.toThrow(/Only the contract owner/);
    const draft = byTitle('Change snapshot grain');
    await expect(publishNotice(store, admin, draft.id, FIXED_NOW)).rejects.toThrow(/Only the contract owner/);
    await expect(updateNotice(store, priya, draft.id, draftInput('Edited', 9))).rejects.toThrow(/Only the contract owner/);
    const edited = await updateNotice(store, producer, draft.id, draftInput('Edited title', 9));
    expect(edited.title).toBe('Edited title');
    await deleteDraft(store, producer, draft.id);
    expect(await store.repo('ChangeNotice').get(draft.id)).toBeNull();
  });

  it('published notices cannot be edited or deleted', async () => {
    const { store, producer, byTitle } = await setup();
    const pub = byTitle('Rename order_total');
    await expect(updateNotice(store, producer, pub.id, draftInput('Changed', 5))).rejects.toThrow(/Only drafts/);
    await expect(deleteDraft(store, producer, pub.id)).rejects.toThrow(/Only drafts/);
  });
});

describe('consumers after publish (spec rule 3 and edge cases)', () => {
  it('adding a consumer creates pending acks for open published notices only', async () => {
    const { store, producer, contract, chen } = await setup();
    const orders = contract('Orders fact table');
    const r = await addConsumer(store, producer, orders.id, { teamName: 'Supply Chain BI', contactName: 'Riley Park', contactSub: '' }, FIXED_NOW);
    // Orders has two published notices (rename, sales_channel) and one closed one.
    expect(r.acksCreated).toBe(2);
    await expect(
      addConsumer(store, producer, orders.id, { teamName: 'supply chain bi', contactName: 'Someone', contactSub: '' }),
    ).rejects.toThrow(/already a consumer/);
    await expect(
      addConsumer(store, chen, orders.id, { teamName: 'New Team', contactName: 'Someone', contactSub: '' }),
    ).rejects.toThrow(/Only the contract owner/);
  });

  it('a linked contact answers that consumer only and does not join the team', async () => {
    const { store, producer, contract, chen, byTitle } = await setup();
    const inv = contract('Inventory snapshot');
    const { consumer } = await addConsumer(store, producer, inv.id, { teamName: 'Demand Planning', contactName: chen.displayName, contactSub: chen.sub });
    // The same team registered on another contract without Chen as contact.
    await addConsumer(store, producer, contract('Orders fact table').id, { teamName: 'Demand Planning', contactName: 'Someone else', contactSub: '' });
    expect(await store.repo('TeamMember').list({ where: { memberSub: chen.sub, teamName: 'Demand Planning' } })).toEqual([]);

    const draft = byTitle('Change snapshot grain');
    await publishNotice(store, producer, draft.id, FIXED_NOW);
    const inbox = await listInbox(store, chen, FIXED_NOW);
    expect(inbox.teams).toEqual(['Marketing Insights']);
    expect(inbox.contactFor).toEqual(['Demand Planning on Inventory snapshot']);
    const mine = inbox.items.filter((i) => i.ack.teamName === 'Demand Planning');
    // One ack for the open warehouse_region notice (created on add) and one from the publish; both on his consumer.
    expect(mine.map((i) => i.ack.consumerId)).toEqual([consumer.id, consumer.id]);
    await setAckStatus(store, chen, mine[0].ack.id, 'acknowledged');

    const ordersAck = (await store.repo('Ack').list({ where: { teamName: 'Demand Planning' } })).find((a) => a.consumerId !== consumer.id)!;
    await expect(setAckStatus(store, chen, ordersAck.id, 'acknowledged')).rejects.toThrow(/Only members of Demand Planning/);
  });

  it('removing a consumer marks their open acks migrated with "consumer removed"', async () => {
    const { store, producer, contract, byTitle } = await setup();
    const orders = contract('Orders fact table');
    const finance = (await store.repo('Consumer').list({ where: { contractId: orders.id } })).find((c) => c.teamName === 'Finance Analytics')!;
    const r = await removeConsumer(store, producer, finance.id, FIXED_NOW);
    expect(r.acksClosed).toBe(2);
    const rename = byTitle('Rename order_total');
    const ack = (await store.repo('Ack').list({ where: { noticeId: rename.id, consumerId: finance.id } }))[0];
    expect(ack).toMatchObject({ status: 'migrated', note: CONSUMER_REMOVED_NOTE });
    // The closed notice's ack is left as it was.
    const closed = byTitle('Retire the orders_v1');
    const old = (await store.repo('Ack').list({ where: { noticeId: closed.id, consumerId: finance.id } }))[0];
    expect(old.note).toBeNull();
    expect(await store.repo('Consumer').get(finance.id)).toBeNull();
  });
});

describe('acks (spec rule 2, acceptance 3)', () => {
  it('an objection requires a note and turns the notice blocked', async () => {
    const { store, chen, byTitle } = await setup();
    const channel = byTitle('Add sales_channel');
    const mine = (await store.repo('Ack').list({ where: { noticeId: channel.id } })).find((a) => a.teamName === 'Marketing Insights')!;
    await expect(setAckStatus(store, chen, mine.id, 'objected', '   ')).rejects.toThrow(/needs a note/);
    expect((await getNoticeDetail(store, chen, channel.id, FIXED_NOW)).health.health).toBe('waiting');
    await setAckStatus(store, chen, mine.id, 'objected', 'We pivot on channel already; please call it sales_channel_code.', FIXED_NOW);
    const detail = await getNoticeDetail(store, chen, channel.id, FIXED_NOW);
    expect(detail.health.health).toBe('blocked');
    expect(detail.rows.find((r) => r.ack.id === mine.id)!.ack).toMatchObject({ status: 'objected', updatedByName: chen.displayName });
  });

  it('only the team, the contract owner or an admin can set an ack', async () => {
    const { store, chen, priya, jordan, producer, admin, byTitle } = await setup();
    const rename = byTitle('Rename order_total');
    const acks = await store.repo('Ack').list({ where: { noticeId: rename.id } });
    const finance = acks.find((a) => a.teamName === 'Finance Analytics')!;
    const sales = acks.find((a) => a.teamName === 'Sales Ops')!;
    await expect(setAckStatus(store, chen, finance.id, 'acknowledged')).rejects.toThrow(/Only members of Finance Analytics/);
    await expect(setAckStatus(store, priya, sales.id, 'acknowledged')).rejects.toThrow(/Only members of Sales Ops/);
    // Jordan is in both teams.
    await setAckStatus(store, jordan, finance.id, 'acknowledged');
    await setAckStatus(store, jordan, sales.id, 'migrated');
    // Owner and admin can change another team's ack, and reset it to pending.
    await setAckStatus(store, producer, finance.id, 'pending');
    await setAckStatus(store, admin, sales.id, 'pending');
    await expect(setAckStatus(store, jordan, sales.id, 'pending')).rejects.toThrow(/reset/);
  });

  it('acks on closed notices cannot change', async () => {
    const { store, priya, byTitle } = await setup();
    const closed = byTitle('Retire the orders_v1');
    const ack = (await store.repo('Ack').list({ where: { noticeId: closed.id } })).find((a) => a.teamName === 'Finance Analytics')!;
    await expect(setAckStatus(store, priya, ack.id, 'acknowledged')).rejects.toThrow(/closed/);
  });

  it('ackDenial is pure and matches the rule', () => {
    const ack = { teamName: 'Sales Ops', consumerId: 'k1', contractOwnerSub: 'owner' };
    const none = { teams: [], contactConsumerIds: [] };
    expect(ackDenial({ sub: 'x', isAdmin: false }, { teams: ['sales ops'], contactConsumerIds: [] }, ack)).toBeNull();
    expect(ackDenial({ sub: 'x', isAdmin: false }, { teams: [], contactConsumerIds: ['k1'] }, ack)).toBeNull();
    expect(ackDenial({ sub: 'x', isAdmin: false }, { teams: [], contactConsumerIds: ['k2'] }, ack)).toMatch(/Only members/);
    expect(ackDenial({ sub: 'owner', isAdmin: false }, none, ack)).toBeNull();
    expect(ackDenial({ sub: 'x', isAdmin: true }, none, ack)).toBeNull();
    expect(ackDenial({ sub: 'x', isAdmin: null }, { teams: ['Finance'], contactConsumerIds: [] }, ack)).toMatch(/Only members/);
  });
});

describe('privilege escalation through a self-registered contract', () => {
  it("naming yourself contact of a team on your own contract gives no rights on other producers' acks", async () => {
    const { store, chen, byTitle } = await setup();
    // Chen (Marketing only) registers a contract and adds "Finance Analytics" with himself as contact.
    const mine = await createContract(store, chen, { name: 'Side project', sourceRef: 'lakehouse.chen.side', producerTeam: 'Marketing', description: '' });
    await addConsumer(store, chen, mine.id, { teamName: 'finance analytics', contactName: chen.displayName, contactSub: chen.sub });

    // No team membership was created, and his teams are unchanged.
    expect(await store.repo('TeamMember').list({ where: { memberSub: chen.sub } })).toHaveLength(1);
    const inbox = await listInbox(store, chen, FIXED_NOW);
    expect(inbox.teams).toEqual(['Marketing Insights']);
    expect(inbox.items.some((i) => i.ack.teamName === 'Finance Analytics')).toBe(false);

    // Finance Analytics' acks on Morgan's contract stay out of reach.
    const rename = byTitle('Rename order_total');
    const finance = (await store.repo('Ack').list({ where: { noticeId: rename.id } })).find((a) => a.teamName === 'Finance Analytics')!;
    await expect(setAckStatus(store, chen, finance.id, 'acknowledged')).rejects.toThrow(/Only members of Finance Analytics/);
    const detail = await getNoticeDetail(store, chen, rename.id, FIXED_NOW);
    expect(detail.rows.find((r) => r.ack.id === finance.id)!.canAct).toBe(false);
  });

  it('only admins can add team members, so a producer cannot add themselves to a team', async () => {
    const { store, producer, admin } = await setup();
    await expect(
      addTeamMember(store, producer, { teamName: 'Finance Analytics', memberSub: producer.sub, memberName: producer.displayName }),
    ).rejects.toThrow(/Only an admin/);
    await expect(
      addTeamMember(store, admin, { teamName: 'Finance Analytics', memberSub: producer.sub, memberName: producer.displayName }),
    ).resolves.toMatchObject({ addedBySub: admin.sub });
  });
});

describe('close (spec rule 6)', () => {
  it('closeDenial covers owner, admin override and others', () => {
    const owner = { sub: 'o', isAdmin: false };
    const admin = { sub: 'a', isAdmin: true };
    const other = { sub: 'x', isAdmin: false };
    expect(closeDenial(owner, 'o', 'ok', '')).toBeNull();
    expect(closeDenial(owner, 'o', 'waiting', 'note')).toMatch(/only when every consumer/);
    expect(closeDenial(admin, 'o', 'blocked', '')).toMatch(/needs a note/);
    expect(closeDenial(admin, 'o', 'blocked', 'Agreed in the change board.')).toBeNull();
    expect(closeDenial(admin, 'o', 'ok', '')).toBeNull();
    expect(closeDenial(other, 'o', 'ok', '')).toMatch(/Only the contract owner or an admin/);
  });

  it('owner closes a healthy notice; admin needs a note to close an unhealthy one', async () => {
    const { store, producer, admin, priya, byTitle } = await setup();
    const region = byTitle('Add warehouse_region');
    await expect(closeNotice(store, priya, region.id, '', FIXED_NOW)).rejects.toThrow(/Only the contract owner or an admin/);
    const closed = await closeNotice(store, producer, region.id, '', FIXED_NOW);
    expect(closed).toMatchObject({ status: 'closed', closedByName: producer.displayName, closeNote: null });

    const split = byTitle('Split full_name');
    await expect(closeNotice(store, producer, split.id, 'please', FIXED_NOW)).rejects.toThrow(/only when every consumer/);
    await expect(closeNotice(store, admin, split.id, '', FIXED_NOW)).rejects.toThrow(/needs a note/);
    const forced = await closeNotice(store, admin, split.id, 'Superseded by a new notice with a compatibility view.', FIXED_NOW);
    expect(forced.closeNote).toMatch(/Superseded/);
    await expect(closeNotice(store, admin, split.id, 'again', FIXED_NOW)).rejects.toThrow(/Only published/);
  });
});

describe('inbox (acceptance 4)', () => {
  it("shows only the viewer's teams' pending acks, soonest first", async () => {
    const { store, priya, jordan, chen, producer } = await setup();
    const p = await listInbox(store, priya, FIXED_NOW);
    expect(p.teams).toEqual(['Finance Analytics']);
    expect(p.items.map((i) => i.ack.teamName)).toEqual(['Finance Analytics', 'Finance Analytics']);
    expect(p.items.map((i) => i.notice.title)).toEqual(['Rename order_total to gross_amount', 'Add sales_channel column']);
    expect(p.items.every((i) => i.ack.status === 'pending' && i.notice.status === 'published')).toBe(true);

    const j = await listInbox(store, jordan, FIXED_NOW);
    expect(j.teams).toEqual(['Finance Analytics', 'Sales Ops']);
    expect(j.items).toHaveLength(4);
    expect(new Set(j.items.map((i) => i.ack.teamName))).toEqual(new Set(['Finance Analytics', 'Sales Ops']));
    const days = j.items.map((i) => i.notice.effectiveDate);
    expect([...days].sort()).toEqual(days);

    const c = await listInbox(store, chen, FIXED_NOW);
    expect(c.items.map((i) => i.ack.teamName)).toEqual(['Marketing Insights']);

    expect((await listInbox(store, producer, FIXED_NOW)).items).toEqual([]);
  });

  it('an answered ack leaves the inbox', async () => {
    const { store, priya } = await setup();
    const before = await listInbox(store, priya, FIXED_NOW);
    await setAckStatus(store, priya, before.items[0].ack.id, 'acknowledged');
    expect((await listInbox(store, priya, FIXED_NOW)).items).toHaveLength(1);
  });
});

describe('registry and dashboard from the seed', () => {
  it('registry shows worst health per contract, worst first', async () => {
    const { store } = await setup();
    const rows = await listRegistry(store, FIXED_NOW);
    expect(rows.map((r) => [r.contract.name, r.worst, r.consumerCount, r.openNotices])).toEqual([
      ['Customer dimension', 'blocked', 3, 2],
      ['Orders fact table', 'at_risk', 4, 2],
      ['Currency rates', 'ok', 0, 1],
      ['Inventory snapshot', 'ok', 3, 1],
      ['Web sessions', null, 2, 0],
    ]);
  });

  it('seed covers every health state and the dashboard counts them', async () => {
    const { store } = await setup();
    const d = await loadDashboard(store, FIXED_NOW);
    expect(d.kpis).toEqual({ published: 6, at_risk: 1, overdue: 1, blocked: 1 });
    expect(d.attention.map((a) => a.health.health)).toEqual(['blocked', 'overdue', 'at_risk']);
    expect(d.chart.map((c) => c.label)).toEqual([
      'Retire legacy_seg…',
      'Rename order_tota…',
      'Add sales_channel…',
      'Split full_name i…',
    ]);
    expect(d.chart[0]).toMatchObject({ pending: 1, acknowledged: 1, migrated: 1, objected: 0 });
  });

  it('createContract makes the creator the owner and rejects a duplicate source', async () => {
    const { store, priya } = await setup();
    const c = await createContract(store, priya, { name: 'Budget lines', sourceRef: 'warehouse.fin.budget', producerTeam: 'Finance Data', description: '' });
    expect(c).toMatchObject({ ownerSub: priya.sub, ownerName: priya.displayName, description: null });
    await expect(
      createContract(store, priya, { name: 'Again', sourceRef: 'LAKEHOUSE.sales.orders', producerTeam: 'X Team', description: '' }),
    ).rejects.toThrow(/already registered/);
  });
});
