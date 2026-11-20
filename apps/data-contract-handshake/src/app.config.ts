/**
 * App configuration. No React imports here: tools/seed-fabric.mjs loads this file in Node to export seed rows.
 */
import type { Persona } from '@x10/shared/identity';
import type { AppConfig } from '@x10/shared/runtime';

import { defs, type Schema } from './model';
import { seed } from './seed';

/**
 * Demo personas. The seed relies on this order:
 * admin, producer (owns four contracts), a Finance Analytics consumer, a person in two teams
 * (Finance Analytics and Sales Ops), and a Marketing Insights consumer.
 */
export const personas: Persona[] = [
  { sub: 'demo-admin', name: 'Alex Rivera', email: 'alex@example.com', isAdmin: true, role: 'Admin' },
  { sub: 'demo-producer', name: 'Morgan Lee', email: 'morgan@example.com', isAdmin: false, role: 'Producer' },
  { sub: 'demo-finance', name: 'Priya Shah', email: 'priya@example.com', isAdmin: false, role: 'Finance Analytics' },
  { sub: 'demo-two-teams', name: 'Jordan Kim', email: 'jordan@example.com', isAdmin: false, role: 'Finance + Sales Ops' },
  { sub: 'demo-marketing', name: 'Chen Wu', email: 'chen@example.com', isAdmin: false, role: 'Marketing Insights' },
];

export const config: AppConfig<Schema> = {
  appId: 'data-contract-handshake',
  title: 'Data Contract Handshake',
  tagline: 'Schema changes should not be a surprise. Every consumer shakes hands.',
  accent: 'blue',
  // Two lines crossing at an interchange: the transit network.
  logoPaths: ['M3 8h4.5l9 8H21', 'M3 16h4.5l9-8H21', 'M12 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6'],
  defs,
  personas,
  seed,
  // Phone tab-bar icons are added in main.tsx so this file stays JSX-free.
  nav: [
    { to: '/', label: 'Network', end: true },
    { to: '/departures', label: 'Departures' },
    { to: '/inbox', label: 'Signal box' },
    { to: '/timetable', label: 'Timetable' },
    { to: '/lines', label: 'Line status' },
    { to: '/teams', label: 'Stations' },
    { to: '/about', label: 'About' },
  ],
};
