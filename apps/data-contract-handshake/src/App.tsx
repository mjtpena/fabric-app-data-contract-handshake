import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@x10/shared/runtime';

import { AboutPage } from './pages/AboutPage';
import { ContractPage } from './pages/ContractPage';
import { DeparturesPage } from './pages/DeparturesPage';
import { InboxPage } from './pages/InboxPage';
import { NetworkPage } from './pages/NetworkPage';
import { NoticeEditorPage } from './pages/NoticeEditorPage';
import { NoticePage } from './pages/NoticePage';
import { RegistryPage } from './pages/RegistryPage';
import { TeamsPage } from './pages/TeamsPage';
import { TimetablePage } from './pages/TimetablePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell immersive><NetworkPage /></AppShell>} />
      <Route path="/departures" element={<AppShell wide><DeparturesPage /></AppShell>} />
      <Route path="/inbox" element={<AppShell><InboxPage /></AppShell>} />
      <Route path="/timetable" element={<AppShell wide><TimetablePage /></AppShell>} />
      <Route path="/lines" element={<AppShell><RegistryPage /></AppShell>} />
      <Route path="/contracts/:id" element={<AppShell><ContractPage /></AppShell>} />
      <Route path="/contracts/:contractId/notices/new" element={<AppShell><NoticeEditorPage /></AppShell>} />
      <Route path="/notices/:id" element={<AppShell><NoticePage /></AppShell>} />
      <Route path="/notices/:noticeId/edit" element={<AppShell><NoticeEditorPage /></AppShell>} />
      <Route path="/teams" element={<AppShell><TeamsPage /></AppShell>} />
      <Route path="/about" element={<AppShell><AboutPage /></AppShell>} />
      {/* v1 links */}
      <Route path="/dashboard" element={<Navigate to="/departures" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
