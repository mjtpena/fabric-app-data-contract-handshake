import { Ack } from './Ack.js';
import { AppMarker } from './AppMarker.js';
import { ChangeNotice } from './ChangeNotice.js';
import { Consumer } from './Consumer.js';
import { Contract } from './Contract.js';
import { Person } from './Person.js';
import { TeamMember } from './TeamMember.js';

export type AppSchema = {
  Person: Person;
  AppMarker: AppMarker;
  Contract: Contract;
  Consumer: Consumer;
  ChangeNotice: ChangeNotice;
  Ack: Ack;
  TeamMember: TeamMember;
};

export const schema = [Person, AppMarker, Contract, Consumer, ChangeNotice, Ack, TeamMember];
