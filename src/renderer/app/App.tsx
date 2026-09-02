import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@renderer/layouts/AppShell';
import { DashboardPage } from '@renderer/pages/Dashboard/DashboardPage';
import { AccountsPage } from '@renderer/pages/Accounts/AccountsPage';
import { SettingsPage } from '@renderer/pages/Settings/SettingsPage';
import { LogsPage } from '@renderer/pages/Logs/LogsPage';

export default function App(): React.JSX.Element {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
