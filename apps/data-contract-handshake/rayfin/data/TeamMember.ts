import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * Maps a person (memberSub) to a consumer team (teamName). A person can be in several teams.
 * Membership is global (it grants ack rights on every contract the team consumes), so only admins manage it, on the
 * Teams page. A consumer's contactSub is separate and scoped to that one registration. The row policy pins addedBySub
 * to the caller on create, and lets the adder or the member remove the row. "Admins only" is checked in
 * src/domain/teams.ts (no admin claim exists).
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.addedBySub),
})
@role('authenticated', 'delete', {
  policy: (claims, item) => claims.sub.eq(item.addedBySub).or(claims.sub.eq(item.memberSub)),
})
export class TeamMember {
  @uuid() id!: string;
  @text({ min: 2, max: 100 }) teamName!: string;
  @text({ min: 1, max: 255 }) memberSub!: string;
  @text({ min: 1, max: 100 }) memberName!: string;
  @text({ min: 1, max: 255 }) addedBySub!: string;
  @date() createdAt!: Date;
}
