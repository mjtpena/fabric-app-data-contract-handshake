import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * A change announced on a contract. ownerSub is the contract owner's subject, copied from the contract, so only the
 * contract owner can create, edit, publish, close or delete notices. contractId, ownerSub and createdBy are fixed
 * after creation.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
  exclude: ['ownerSub', 'contractId', 'createdBy', 'createdAt'],
})
export class ChangeNotice {
  @uuid() id!: string;
  @uuid() contractId!: string;
  @text({ min: 3, max: 120 }) title!: string;
  @set('additive', 'breaking', 'deprecation') changeType!: 'additive' | 'breaking' | 'deprecation';
  @text({ min: 10, max: 2000 }) description!: string;
  @date() effectiveDate!: Date;
  @set('draft', 'published', 'closed') status!: 'draft' | 'published' | 'closed';
  @text({ min: 1, max: 255 }) ownerSub!: string;
  @text({ min: 1, max: 255 }) createdBy!: string;
  @text({ min: 1, max: 100 }) createdByName!: string;
  @date() createdAt!: Date;
  @date({ optional: true }) publishedAt?: Date;
  @date({ optional: true }) closedAt?: Date;
  @text({ max: 100, optional: true }) closedByName?: string;
  @text({ max: 300, optional: true }) closeNote?: string;
}
