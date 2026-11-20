/**
 * App data types and runtime entity definitions. Keep these in step with rayfin/data/*.ts:
 * every field listed here must exist on the entity class with the matching decorator.
 * Dates are ISO strings in the app; optional fields are `| null`.
 */
import type { EntityDefs } from '@x10/shared/data';
import { AppMarkerDef, PersonDef, type AppMarker, type Person } from '@x10/shared/identity';

/** The same numbers as the @text decorators. Forms validate with these. */
export const limits = {
  contractName: { min: 3, max: 100 },
  sourceRef: { min: 3, max: 200 },
  producerTeam: { min: 2, max: 100 },
  contractDescription: { max: 500 },
  teamName: { min: 2, max: 100 },
  contactName: { min: 2, max: 100 },
  noticeTitle: { min: 3, max: 120 },
  noticeDescription: { min: 10, max: 2000 },
  ackNote: { max: 300 },
  closeNote: { max: 300 },
} as const;

export const CHANGE_TYPES = ['additive', 'breaking', 'deprecation'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const NOTICE_STATUSES = ['draft', 'published', 'closed'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

export const ACK_STATUSES = ['pending', 'acknowledged', 'objected', 'migrated'] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];

export interface Contract {
  id: string;
  name: string;
  sourceRef: string;
  producerTeam: string;
  ownerSub: string;
  ownerName: string;
  description: string | null;
  createdAt: string;
}

export interface Consumer {
  id: string;
  contractId: string;
  teamName: string;
  contactName: string;
  contactSub: string | null;
  /** Contract owner's subject (denormalised for the row policy). */
  ownerSub: string;
  createdAt: string;
}

export interface ChangeNotice {
  id: string;
  contractId: string;
  title: string;
  changeType: ChangeType;
  description: string;
  /** UTC midnight of the calendar day the change takes effect. */
  effectiveDate: string;
  status: NoticeStatus;
  /** Contract owner's subject (denormalised for the row policy). */
  ownerSub: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
}

export interface Ack {
  id: string;
  noticeId: string;
  consumerId: string;
  contractId: string;
  /** Consumer team name, copied so the ack still reads well after the consumer is removed. */
  teamName: string;
  /** Contract owner's subject (denormalised for the row policy). */
  contractOwnerSub: string;
  status: AckStatus;
  note: string | null;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface TeamMember {
  id: string;
  teamName: string;
  memberSub: string;
  memberName: string;
  addedBySub: string;
  createdAt: string;
}

export type Schema = {
  Person: Person;
  AppMarker: AppMarker;
  Contract: Contract;
  Consumer: Consumer;
  ChangeNotice: ChangeNotice;
  Ack: Ack;
  TeamMember: TeamMember;
};

export const defs: EntityDefs<Schema> = {
  Person: PersonDef,
  AppMarker: AppMarkerDef,
  Contract: {
    name: 'Contract',
    fields: {
      id: 'uuid',
      name: 'text',
      sourceRef: 'text',
      producerTeam: 'text',
      ownerSub: 'text',
      ownerName: 'text',
      description: 'text',
      createdAt: 'date',
    },
  },
  Consumer: {
    name: 'Consumer',
    fields: {
      id: 'uuid',
      contractId: 'uuid',
      teamName: 'text',
      contactName: 'text',
      contactSub: 'text',
      ownerSub: 'text',
      createdAt: 'date',
    },
  },
  ChangeNotice: {
    name: 'ChangeNotice',
    fields: {
      id: 'uuid',
      contractId: 'uuid',
      title: 'text',
      changeType: 'set',
      description: 'text',
      effectiveDate: 'date',
      status: 'set',
      ownerSub: 'text',
      createdBy: 'text',
      createdByName: 'text',
      createdAt: 'date',
      publishedAt: 'date',
      closedAt: 'date',
      closedByName: 'text',
      closeNote: 'text',
    },
  },
  Ack: {
    name: 'Ack',
    fields: {
      id: 'uuid',
      noticeId: 'uuid',
      consumerId: 'uuid',
      contractId: 'uuid',
      teamName: 'text',
      contractOwnerSub: 'text',
      status: 'set',
      note: 'text',
      updatedBy: 'text',
      updatedByName: 'text',
      updatedAt: 'date',
    },
  },
  TeamMember: {
    name: 'TeamMember',
    fields: {
      id: 'uuid',
      teamName: 'text',
      memberSub: 'text',
      memberName: 'text',
      addedBySub: 'text',
      createdAt: 'date',
    },
  },
};
