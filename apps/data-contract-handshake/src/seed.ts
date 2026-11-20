import type { DataStore } from '@x10/shared/data';
import { DAY, HOUR } from '@x10/shared/lib';
import type { SeedContext } from '@x10/shared/runtime';

import { CONSUMER_REMOVED_NOTE } from './domain/contracts';
import { localToday, shiftDays } from './domain/days';
import type { AckStatus, ChangeNotice, ChangeType, Consumer, Contract, NoticeStatus, Schema } from './model';

/**
 * Fictional, generic seed data: 5 contracts, 12 consumers (plus one removed after publish), 9 notices and their acks.
 * Effective dates are computed from ctx.now so every health state shows: at risk, waiting (an additive change exactly
 * 7 days out), blocked, overdue, ok (including a removed consumer and a contract with no consumers), plus a closed
 * notice, a normal draft and a draft whose effective date has already passed (publish is blocked).
 * Persona order (app.config.ts): admin, producer, Finance Analytics, Finance Analytics + Sales Ops, Marketing Insights.
 */
export async function seed(store: DataStore<Schema>, ctx: SeedContext): Promise<void> {
  const [admin, producer, priya, jordan, chen] = ctx.people;
  const today = localToday(ctx.now);
  const day = (n: number) => shiftDays(today, n);
  const ago = (days: number, hours = 0) => new Date(ctx.now.getTime() - days * DAY - hours * HOUR).toISOString();

  /* contracts */
  const contract = (
    name: string,
    sourceRef: string,
    producerTeam: string,
    owner: { sub: string; displayName: string },
    description: string | null,
    createdDaysAgo: number,
  ) =>
    store.repo('Contract').create({
      name,
      sourceRef,
      producerTeam,
      ownerSub: owner.sub,
      ownerName: owner.displayName,
      description,
      createdAt: ago(createdDaysAgo),
    });

  const orders = await contract(
    'Orders fact table',
    'lakehouse.sales.orders',
    'Sales Data Platform',
    producer,
    'One row per order line, loaded hourly from the order service. Grain: order line. Owned by the sales data platform squad.',
    120,
  );
  const customers = await contract(
    'Customer dimension',
    'warehouse.crm.dim_customer',
    'Customer Data Platform',
    producer,
    'Conformed customer attributes (type 2 history) used by every customer-facing report.',
    110,
  );
  const inventory = await contract(
    'Inventory snapshot',
    'lakehouse.supply.inventory_daily',
    'Supply Chain Engineering',
    producer,
    'End-of-day stock on hand per warehouse and product.',
    90,
  );
  const sessions = await contract(
    'Web sessions',
    'lakehouse.web.sessions',
    'Digital Analytics Engineering',
    producer,
    'Sessionised web events. Personal data is removed before load.',
    60,
  );
  const fx = await contract(
    'Currency rates',
    'warehouse.ref.fx_rates',
    'Reference Data',
    admin,
    'Daily closing exchange rates against the reporting currency. No consumers registered yet.',
    30,
  );

  /* consumers */
  const consumer = (c: Contract, teamName: string, contactName: string, contactSub: string | null, daysAgo: number) =>
    store.repo('Consumer').create({
      contractId: c.id,
      teamName,
      contactName,
      contactSub,
      ownerSub: c.ownerSub,
      createdAt: ago(daysAgo),
    });

  const o = {
    finance: await consumer(orders, 'Finance Analytics', priya.displayName, priya.sub, 100),
    sales: await consumer(orders, 'Sales Ops', jordan.displayName, jordan.sub, 98),
    marketing: await consumer(orders, 'Marketing Insights', chen.displayName, chen.sub, 95),
    science: await consumer(orders, 'Data Science', 'Taylor Brooks', null, 80),
  };
  const cu = {
    marketing: await consumer(customers, 'Marketing Insights', chen.displayName, chen.sub, 100),
    care: await consumer(customers, 'Customer Care Reporting', 'Sam Okafor', null, 90),
    sales: await consumer(customers, 'Sales Ops', jordan.displayName, jordan.sub, 70),
  };
  const inv = {
    supply: await consumer(inventory, 'Supply Chain BI', 'Riley Park', null, 85),
    finance: await consumer(inventory, 'Finance Analytics', priya.displayName, priya.sub, 80),
    science: await consumer(inventory, 'Data Science', 'Taylor Brooks', null, 50),
  };
  await consumer(sessions, 'Marketing Insights', chen.displayName, chen.sub, 55);
  await consumer(sessions, 'Data Science', 'Taylor Brooks', null, 40);
  // A consumer that will be removed after the inventory notice is published.
  const retail = await consumer(inventory, 'Retail Ops', 'Dana Cole', null, 60);

  /* team membership: Jordan is in two teams (Finance Analytics and Sales Ops) */
  const member = (teamName: string, p: { sub: string; displayName: string }, daysAgo: number) =>
    store.repo('TeamMember').create({
      teamName,
      memberSub: p.sub,
      memberName: p.displayName,
      addedBySub: admin.sub,
      createdAt: ago(daysAgo),
    });
  await member('Finance Analytics', priya, 100);
  await member('Finance Analytics', jordan, 99);
  await member('Sales Ops', jordan, 98);
  await member('Marketing Insights', chen, 95);

  /* notices */
  const notice = (
    c: Contract,
    title: string,
    changeType: ChangeType,
    description: string,
    effectiveInDays: number,
    status: NoticeStatus,
    createdDaysAgo: number,
    extra: Partial<ChangeNotice> = {},
  ) =>
    store.repo('ChangeNotice').create({
      contractId: c.id,
      title,
      changeType,
      description,
      effectiveDate: day(effectiveInDays),
      status,
      ownerSub: c.ownerSub,
      createdBy: c.ownerSub,
      createdByName: c.ownerName,
      createdAt: ago(createdDaysAgo),
      publishedAt: status === 'draft' ? null : ago(createdDaysAgo - 1),
      closedAt: null,
      closedByName: null,
      closeNote: null,
      ...extra,
    });

  const ack = (
    n: ChangeNotice,
    cons: Consumer,
    status: AckStatus,
    by: { sub: string; displayName: string },
    hoursAgo: number,
    note: string | null = null,
  ) =>
    store.repo('Ack').create({
      noticeId: n.id,
      consumerId: cons.id,
      contractId: n.contractId,
      teamName: cons.teamName,
      contractOwnerSub: cons.ownerSub,
      status,
      note,
      updatedBy: by.sub,
      updatedByName: by.displayName,
      updatedAt: ago(0, hoursAgo),
    });

  // 1. At risk: breaking, 5 days out, two teams still pending.
  const rename = await notice(
    orders,
    'Rename order_total to gross_amount',
    'breaking',
    'The column order_total becomes gross_amount so it matches the finance glossary. The old name is removed on the effective date; there is no alias. Update queries, semantic models and dataflows that select order_total.',
    5,
    'published',
    7,
  );
  await ack(rename, o.finance, 'pending', producer, 6 * 24);
  await ack(rename, o.sales, 'pending', producer, 6 * 24);
  await ack(rename, o.marketing, 'acknowledged', chen, 40);
  await ack(rename, o.science, 'acknowledged', producer, 30, 'Confirmed by Taylor on the weekly sync.');

  // 2. Waiting: additive exactly 7 days out never turns at risk.
  const channel = await notice(
    orders,
    'Add sales_channel column',
    'additive',
    'A new nullable column sales_channel (web, store, partner) is added at the end of the table. Existing queries keep working; SELECT * consumers will see one extra column.',
    7,
    'published',
    3,
  );
  await ack(channel, o.finance, 'pending', producer, 2 * 24);
  await ack(channel, o.sales, 'acknowledged', jordan, 20);
  await ack(channel, o.marketing, 'pending', producer, 2 * 24);
  await ack(channel, o.science, 'pending', producer, 2 * 24);

  // 3. Blocked: a team objected.
  const split = await notice(
    customers,
    'Split full_name into first_name and last_name',
    'breaking',
    'full_name is replaced by first_name and last_name to support personalised greetings. full_name is dropped on the effective date.',
    18,
    'published',
    5,
  );
  await ack(
    split,
    cu.marketing,
    'objected',
    chen,
    26,
    'Our campaign extracts concatenate full_name. We need a compatibility view or until the end of next month.',
  );
  await ack(split, cu.care, 'acknowledged', producer, 50, 'Care reports already use the CRM name fields.');
  await ack(split, cu.sales, 'pending', producer, 4 * 24);

  // 4. Overdue: deprecation took effect 3 days ago, one team still pending.
  const segment = await notice(
    customers,
    'Retire legacy_segment column',
    'deprecation',
    'legacy_segment has been superseded by value_segment since the spring model refresh. It is removed on the effective date.',
    -3,
    'published',
    21,
  );
  await ack(segment, cu.marketing, 'migrated', chen, 12 * 24, 'Moved all audiences to value_segment.');
  await ack(segment, cu.care, 'pending', producer, 20 * 24);
  await ack(segment, cu.sales, 'acknowledged', jordan, 15 * 24);

  // 5. OK: every team acknowledged or migrated; Retail Ops was removed after publish.
  const region = await notice(
    inventory,
    'Add warehouse_region column',
    'additive',
    'Adds warehouse_region so regional stock reports no longer need a lookup join. Values come from the warehouse master.',
    -10,
    'published',
    26,
  );
  await ack(region, inv.supply, 'acknowledged', producer, 22 * 24, 'Riley confirmed by email.');
  await ack(region, inv.finance, 'migrated', priya, 18 * 24);
  await ack(region, inv.science, 'acknowledged', producer, 20 * 24);
  await ack(region, retail, 'migrated', producer, 12 * 24, CONSUMER_REMOVED_NOTE);
  await store.repo('Consumer').remove(retail.id);

  // 6. Draft, ready to publish (the contract has 3 consumers).
  await notice(
    inventory,
    'Change snapshot grain from daily to hourly',
    'breaking',
    'The snapshot moves from one row per day to one row per hour. Daily figures will need a filter on snapshot_hour = 23 or an aggregation.',
    30,
    'draft',
    1,
  );

  // 7. Draft whose effective date has passed: publishing is blocked until the date moves.
  await notice(
    sessions,
    'Drop referrer_raw column',
    'breaking',
    'referrer_raw is dropped; use referrer_domain instead. This draft was never sent and its date has passed.',
    -2,
    'draft',
    12,
  );

  // 8. Contract with no consumers: published, health ok, with a warning.
  await notice(
    fx,
    'Add rate_source column',
    'additive',
    'Adds rate_source so each rate can be traced to the provider feed it came from.',
    3,
    'published',
    2,
  );

  // 9. Closed after everyone acknowledged or migrated.
  const v1 = await notice(
    orders,
    'Retire the orders_v1 view',
    'deprecation',
    'The compatibility view orders_v1 is removed. Query the orders table directly.',
    -40,
    'closed',
    60,
    { closedAt: ago(38), closedByName: producer.displayName, closeNote: null },
  );
  await ack(v1, o.finance, 'migrated', priya, 45 * 24);
  await ack(v1, o.sales, 'migrated', jordan, 44 * 24);
  await ack(v1, o.marketing, 'acknowledged', chen, 50 * 24, 'We never used the view.');
  await ack(v1, o.science, 'migrated', producer, 42 * 24);
}
