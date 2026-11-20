import type { ReactNode } from 'react';
import { CalendarClock, Inbox, Info, Route, TrainFront, Users, Waypoints } from 'lucide-react';

import { mountApp } from '@x10/shared/runtime';

import { App } from './App';
import { config } from './app.config';
import './index.css';

/** Phone tab-bar icons, by route (app.config.ts stays JSX-free for the Node seed tool). */
const ICONS: Record<string, ReactNode> = {
  '/': <Waypoints />,
  '/departures': <TrainFront />,
  '/inbox': <Inbox />,
  '/timetable': <CalendarClock />,
  '/lines': <Route />,
  '/teams': <Users />,
  '/about': <Info />,
};

mountApp({ ...config, nav: config.nav.map((n) => ({ ...n, icon: ICONS[n.to] ?? n.icon })) }, <App />);
