import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed } from '../seed';
import { getContractDetail, isOwner, updateContract, validateConsumer, validateContract } from './contracts';

describe('contract validation', () => {
  it('uses the entity limits', () => {
    const e = validateContract({ name: 'ab', sourceRef: '', producerTeam: 'x', description: 'd'.repeat(501) });
    expect(e.name).toMatch(/at least 3/);
    expect(e.sourceRef).toMatch(/required/);
    expect(e.producerTeam).toMatch(/at least 2/);
    expect(e.description).toMatch(/500/);
    expect(validateContract({ name: 'Orders', sourceRef: 'lh.sales.orders', producerTeam: 'Sales', description: '' })).toEqual({});
  });

  it('validates consumers', () => {
    expect(validateConsumer({ teamName: '', contactName: 'A', contactSub: '' })).toEqual({
      teamName: 'Team name is required.',
      contactName: 'Contact name needs at least 2 characters.',
    });
    expect(validateConsumer({ teamName: 'Sales Ops', contactName: 'Jordan', contactSub: '' })).toEqual({});
  });

  it('isOwner compares subjects', () => {
    expect(isOwner({ sub: 'a' }, { ownerSub: 'a' })).toBe(true);
    expect(isOwner({ sub: 'a' }, { ownerSub: 'b' })).toBe(false);
  });
});

describe('contract edits', () => {
  it('only the owner edits; detail lists notices newest effective date first', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const people = await store.repo('Person').list();
    const producer = people.find((p) => p.sub === 'demo-producer')!;
    const admin = people.find((p) => p.sub === 'demo-admin')!;
    const orders = (await store.repo('Contract').list()).find((c) => c.name === 'Orders fact table')!;
    const input = { name: 'Orders fact', sourceRef: orders.sourceRef, producerTeam: 'Sales Data Platform', description: '' };
    await expect(updateContract(store, admin, orders.id, input)).rejects.toThrow(/Only the contract owner/);
    expect((await updateContract(store, producer, orders.id, input)).name).toBe('Orders fact');

    const detail = await getContractDetail(store, orders.id, FIXED_NOW);
    expect(detail.consumers.map((c) => c.teamName)).toEqual(['Data Science', 'Finance Analytics', 'Marketing Insights', 'Sales Ops']);
    const dates = detail.notices.map((n) => n.notice.effectiveDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
