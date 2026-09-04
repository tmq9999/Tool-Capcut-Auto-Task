import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell } from '@renderer/layouts/AppShell';
import { DashboardPage } from '@renderer/pages/Dashboard/DashboardPage';
import { AccountsPage } from '@renderer/pages/Accounts/AccountsPage';
import { SettingsPage } from '@renderer/pages/Settings/SettingsPage';
import { LogsPage } from '@renderer/pages/Logs/LogsPage';
import {
  applyTheme,
  readBootPreferences,
  rememberRoute,
  writeBootPreferences
} from './appPreferences';

/**
 * Nhớ trang đang xem và đồng bộ bộ đệm khởi động với settings thật trong DB.
 *
 * Hai cài đặt "Giao diện" và "Khôi phục phiên làm việc" trước đây lưu xuống DB
 * rồi không ai đọc (audit 04/09/2026): `index.html` hard-code `class="dark"` và
 * không có chỗ nào nhớ trang. Ở đây nguồn thật vẫn là `settings.get()`, còn
 * localStorage chỉ là bộ đệm để khung hình đầu tiên không nhảy màu.
 */
const PreferenceSync: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.settings?.get) return;
    void api.settings
      .get()
      .then((res) => {
        if (!res.success) return;
        const general = res.data.settings.general;
        writeBootPreferences(window.localStorage, {
          theme: general.theme,
          sessionRestore: general.sessionRestore
        });
        applyTheme(general.theme, document.documentElement);
      })
      .catch(() => {
        // Không đọc được settings thì giữ nguyên bộ đệm đang dùng.
      });
  }, []);

  useEffect(() => {
    rememberRoute(window.localStorage, location.pathname);
  }, [location.pathname]);

  return null;
};

export default function App(): React.JSX.Element {
  /**
   * Đọc một lần lúc dựng cây: phải có ngay để chọn trang đầu và class theme,
   * `settings.get()` là bất đồng bộ nên không kịp cho khung hình đầu tiên.
   */
  const boot = React.useRef(readBootPreferences(window.localStorage)).current;
  const landingRoute = boot.sessionRestore && boot.lastRoute ? boot.lastRoute : '/dashboard';

  useEffect(() => {
    applyTheme(boot.theme, document.documentElement);
  }, [boot.theme]);

  return (
    <HashRouter>
      <PreferenceSync />
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to={landingRoute} replace />} />
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
