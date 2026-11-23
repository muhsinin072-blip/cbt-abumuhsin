/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from './components/admin/AdminLayout';
import { LoginPortal } from './components/LoginPortal';
import { StudentDashboard } from './components/student/StudentDashboard';
import { TeacherLayout } from './components/teacher/TeacherLayout';
import { apiFetch, clearAuthToken } from './lib/api';
import type { PublicInfoResponse } from './lib/api';
import { applyCbtTheme } from './lib/theme';
import type { AuthUser, SchoolSettings } from './types/cbt';

const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: 'SMK NEGERI 1 NUSANTARA',
  npsn: '20261901',
  address: 'Jl. Pendidikan Raya No. 45, Kota Nusantara',
  city: 'Kota Nusantara',
  academicYear: '2026/2027',
  semester: 'Ganjil',
  principalName: 'Drs. H. Ahmad Subarjo, M.M.',
  principalNip: '19720412 199802 1 003',
  proctorName: 'Muhsinin, S.Kom.',
  serverName: 'SRV-CBT-UTAMA-01',
  maintenanceMode: false,
  autoRotateToken: false,
  tokenIntervalMinutes: 15,
  themeColor: 'teal',
  sidebarStyle: 'dark',
  schoolLogo: '',
  principalSignature: '',
  portalSlides: [],
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [publicInfo, setPublicInfo] = useState<PublicInfoResponse | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  const loadPublicInfo = useCallback(async () => {
    try {
      const info = await apiFetch<PublicInfoResponse>('/api/public/info');
      setPublicInfo(info);
      applyCbtTheme(info?.settings?.themeColor);
    } catch {
      // fallback to default info if network error occurs
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  useEffect(() => {
    loadPublicInfo();
  }, [loadPublicInfo]);

  const handleLogout = () => {
    clearAuthToken();
    setUser(null);
    loadPublicInfo();
  };

  if (loadingInfo && !publicInfo) {
    return (
      <div className="min-h-screen cbt-soft-canvas flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-lg bg-teal-700 text-white font-bold flex items-center justify-center mx-auto shadow-sm">
            C
          </div>
          <p className="text-sm font-medium text-slate-600">Menghubungkan ke server CandyCBT...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPortal
        publicInfo={publicInfo}
        onLoginSuccess={(loggedInUser) => setUser(loggedInUser)}
        onAdminClaimed={() => loadPublicInfo()}
      />
    );
  }

  if (user.role === 'student') {
    return (
      <StudentDashboard
        user={user}
        schoolName={publicInfo?.settings?.schoolName || DEFAULT_SETTINGS.schoolName}
        schoolLogo={publicInfo?.settings?.schoolLogo}
        onLogout={handleLogout}
      />
    );
  }

  const mergedSettings: SchoolSettings = {
    ...DEFAULT_SETTINGS,
    ...(publicInfo?.settings || {}),
  };

  const handleSettingsSync = (next?: SchoolSettings | null) => {
    if (!next || typeof next !== 'object') return;
    applyCbtTheme(next.themeColor);
    setPublicInfo((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              schoolName: next.schoolName,
              npsn: next.npsn,
              address: next.address,
              academicYear: next.academicYear,
              semester: next.semester,
              serverName: next.serverName,
              maintenanceMode: next.maintenanceMode,
              themeColor: next.themeColor,
              sidebarStyle: next.sidebarStyle,
              schoolLogo: next.schoolLogo,
              portalSlides: next.portalSlides,
            },
          }
        : prev
    );
  };

  if (user.role === 'guru') {
    return (
      <TeacherLayout
        user={user}
        initialSettings={mergedSettings}
        onUserSync={(nextUser) => setUser(nextUser)}
        onSettingsSync={handleSettingsSync}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <AdminLayout
      user={user}
      initialSettings={mergedSettings}
      onSettingsSync={handleSettingsSync}
      onLogout={handleLogout}
    />
  );
}
