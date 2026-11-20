import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * A data contract: one table or dataset a producer team publishes.
 * Everyone signed in reads the registry. Only the owner (ownerSub = the creator's SSO subject) creates, edits or
 * deletes their contract, and ownerSub can never be changed after creation.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
  exclude: ['ownerSub', 'createdAt'],
})
export class Contract {
  @uuid() id!: string;
  @text({ min: 3, max: 100 }) name!: string;
  @text({ min: 3, max: 200 }) sourceRef!: string;
  @text({ min: 2, max: 100 }) producerTeam!: string;
  @text({ min: 1, max: 255 }) ownerSub!: string;
  @text({ min: 1, max: 100 }) ownerName!: string;
  @text({ max: 500, optional: true }) description?: string;
  @date() createdAt!: Date;
}
