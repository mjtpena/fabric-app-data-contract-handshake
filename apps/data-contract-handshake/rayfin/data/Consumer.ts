import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * A team registered as a consumer of a contract. ownerSub is the contract owner's subject, copied from the contract
 * when the row is created, so the row policy can limit writes to the contract owner without a join.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
  exclude: ['ownerSub', 'contractId', 'createdAt'],
})
export class Consumer {
  @uuid() id!: string;
  @uuid() contractId!: string;
  @text({ min: 2, max: 100 }) teamName!: string;
  @text({ min: 2, max: 100 }) contactName!: string;
  @text({ max: 255, optional: true }) contactSub?: string;
  @text({ min: 1, max: 255 }) ownerSub!: string;
  @date() createdAt!: Date;
}
