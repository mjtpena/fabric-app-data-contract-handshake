import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs, type Consumer, type TeamMember } from '../model';
import { seed } from '../seed';
import { addTeamMember, answersFor, buildTeams, inTeam, myTeams, removeTeamMember, scopeOf, teamsOf } from './teams';

const m = (teamName: string, memberSub: string): TeamMember => ({
  id: `${teamName}-${memberSub}`,
  teamName,
  memberSub,
  memberName: memberSub,
  addedBySub: 'admin',
  createdAt: FIXED_NOW.toISOString(),
});
const c = (teamName: string, contactSub: string | null, contractId = 'k1'): Consumer => ({
  id: `${contractId}-${teamName}`,
  contractId,
  teamName,
  contactName: 'Contact',
  contactSub,
  ownerSub: 'owner',
  createdAt: FIXED_NOW.toISOString(),
});

describe('teamsOf and scopeOf', () => {
  it('teams come from membership rows only, de-duplicated case-insensitively', () => {
    const teams = teamsOf('p1', [m('Finance Analytics', 'p1'), m('finance  analytics', 'p1'), m('Sales Ops', 'p1'), m('Other', 'p2')]);
    expect(teams).toEqual(['Finance Analytics', 'Sales Ops']);
  });

  it('returns nothing for someone in no team', () => {
    expect(teamsOf('x', [m('A', 'p1')])).toEqual([]);
  });

  it('a consumer contact link is scoped to that consumer and never adds the team', () => {
    const scope = scopeOf('p1', [m('Sales Ops', 'p1')], [c('Supply', 'p1', 'k1'), c('Nobody', null, 'k1'), c('Supply', 'p2', 'k2')]);
    expect(scope).toEqual({ teams: ['Sales Ops'], contactConsumerIds: ['k1-Supply'] });
    expect(answersFor(scope, { teamName: 'Supply', consumerId: 'k1-Supply' })).toBe(true);
    expect(answersFor(scope, { teamName: 'Supply', consumerId: 'k2-Supply' })).toBe(false);
    expect(answersFor(scope, { teamName: 'sales ops', consumerId: 'k9-Sales' })).toBe(true);
  });

  it('inTeam ignores case and spacing', () => {
    expect(inTeam(['Sales Ops'], ' sales   ops ')).toBe(true);
    expect(inTeam(['Sales Ops'], 'Sales')).toBe(false);
  });
});

describe('buildTeams', () => {
  it('lists members, unlinked contacts and contracts per team', () => {
    const teams = buildTeams([m('Finance', 'p1')], [c('Finance', 'p1', 'k1'), c('Finance', 'p1', 'k2'), c('Care', null, 'k1')]);
    expect(teams.map((t) => t.name)).toEqual(['Care', 'Finance']);
    const finance = teams.find((t) => t.name === 'Finance')!;
    expect(finance.members).toHaveLength(1);
    expect(finance.contacts).toHaveLength(0);
    expect(finance.contractIds).toEqual(['k1', 'k2']);
    expect(teams[0].contacts).toEqual([{ sub: null, name: 'Contact' }]);
  });
});

describe('membership writes', () => {
  it('only admins manage membership; adding twice is a no-op; members may leave', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const people = await store.repo('Person').list();
    const admin = people.find((p) => p.sub === 'demo-admin')!;
    const chen = people.find((p) => p.sub === 'demo-marketing')!;

    await expect(addTeamMember(store, chen, { teamName: 'Sales Ops', memberSub: chen.sub, memberName: chen.displayName })).rejects.toThrow(
      /Only an admin/,
    );
    const row = await addTeamMember(store, admin, { teamName: 'sales ops', memberSub: chen.sub, memberName: chen.displayName });
    const again = await addTeamMember(store, admin, { teamName: 'Sales Ops', memberSub: chen.sub, memberName: chen.displayName });
    expect(again.id).toBe(row.id);
    expect(await myTeams(store, chen.sub)).toEqual(['Marketing Insights', 'sales ops']);

    const jordanRow = (await store.repo('TeamMember').list({ where: { memberSub: 'demo-two-teams' } }))[0];
    await expect(removeTeamMember(store, chen, jordanRow.id)).rejects.toThrow(/Only an admin/);
    await removeTeamMember(store, chen, row.id);
    expect(await myTeams(store, chen.sub)).toEqual(['Marketing Insights']);
  });

  it('seeded Jordan is in two teams', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    expect(await myTeams(store, 'demo-two-teams')).toEqual(['Finance Analytics', 'Sales Ops']);
  });
});
