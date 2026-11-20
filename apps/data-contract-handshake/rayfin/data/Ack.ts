import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One consumer team's response to one published notice.
 *
 * - create / delete: only the contract owner (contractOwnerSub is copied from the contract), which is what publish,
 *   "add consumer" and "remove consumer" do.
 * - update: any signed-in user, but only the response fields (status, note, who, when). The policy DSL cannot join
 *   TeamMember and there is no admin claim, so "team member, the consumer's contact, contract owner or admin" is checked in
 *   src/domain/notices.ts (setAckStatus). See README "Known limits".
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.contractOwnerSub),
})
@role('authenticated', 'update', {
  include: ['status', 'note', 'updatedBy', 'updatedByName', 'updatedAt'],
})
export class Ack {
  @uuid() id!: string;
  @uuid() noticeId!: string;
  @uuid() consumerId!: string;
  @uuid() contractId!: string;
  @text({ min: 2, max: 100 }) teamName!: string;
  @text({ min: 1, max: 255 }) contractOwnerSub!: string;
  @set('pending', 'acknowledged', 'objected', 'migrated') status!: 'pending' | 'acknowledged' | 'objected' | 'migrated';
  @text({ max: 300, optional: true }) note?: string;
  @text({ min: 1, max: 255 }) updatedBy!: string;
  @text({ min: 1, max: 100 }) updatedByName!: string;
  @date() updatedAt!: Date;
}
