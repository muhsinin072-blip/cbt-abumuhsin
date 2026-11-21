import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  CalendarClock,
  FileBarChart2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  QrCode,
  Server,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { AdminDashboardResponse } from '../../lib/api';
import { applyCbtTheme } from '../../lib/theme';
import type { AuthUser, SchoolSettings } from '../../types/cbt';
import { LiveClockDate } from '../LiveClockDate';
import { AbsensiQRManager } from './AbsensiQRManager';
import { BankSoalManager } from './BankSoalManager';
import { HasilLaporan } from './HasilLaporan';
import { JadwalUjianManager } from './JadwalUjianManager';
import { LiveMonitoring } from './LiveMonitoring';
import { PesertaManager } from './PesertaManager';
import { SchoolSettingsManager } from './SchoolSettingsManager';
import { ServerManager } from './ServerManager';
import { TeachersManager } from './TeachersManager';

type AdminTab =
  | 'overview'
  | 'banks'
  | 'teachers'
  | 'students'
  | 'attendance'
  | 'exams'
  | 'monitoring'
  | 'results'
  | 'settings'
  | 'server';

interface AdminLayoutProps {
  user: AuthUser;
  initialSettings: SchoolSettings;
  onSettingsSync?: (settings: SchoolSettings) => void;
  onLogout: () => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  user,
  initialSettings,
  onSettingsSync,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [settings, setSettings] = useState<SchoolSettings>(initialSettings);
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSettingsUpdate = useCallback(
    (next: SchoolSettings) => {
      setSettings(next);
      applyCbtTheme(next.themeColor);
      onSettingsSync?.(next);
    },
    [onSettingsSync]
  );

  const loadDashboard = useCallback(async () => {
    try {
      const data = await apiFetch<AdminDashboardResponse>('/api/admin/dashboard');
      setDashboard(data);
      handleSettingsUpdate(data.settings);
    } catch {
      // handled per sub-module
    }
  }, [handleSettingsUpdate]);

  useEffect(() => {
    applyCbtTheme(settings.themeColor);
  }, [settings.themeColor]);

  useEffect(() => {
    if (activeTab === 'overview') {
      loadDashboard();
    }
  }, [activeTab, loadDashboard]);

  useEffect(() => {
    const ws = createCbtWebSocket((event, payload) => {
      if (event === 'sync:settings' && payload) {
        handleSettingsUpdate(payload as SchoolSettings);
      } else if (
        activeTab === 'overview' &&
        (event === 'sync:banks' ||
          event === 'sync:exams' ||
          event === 'sync:results' ||
          event === 'sync:students' ||
          event === 'sync:teachers' ||
          event === 'session:updated' ||
          event === 'session:removed' ||
          event === 'violation:logged' ||
          event === 'token:rotated')
      ) {
        loadDashboard();
      }
    });
    return () => ws.close();
  }, [activeTab, loadDashboard, handleSettingsUpdate]);

  const navItems: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Beranda Proktor', icon: LayoutDashboard },
    { id: 'banks', label: 'Bank Soal & Excel', icon: BookOpen },
    { id: 'teachers', label: 'Data Guru & Akses', icon: GraduationCap },
    { id: 'students', label: 'Peserta Ujian', icon: Users },
    { id: 'attendance', label: 'Absensi QR Code', icon: QrCode },
    { id: 'exams', label: 'Jadwal & Token', icon: CalendarClock },
    { id: 'monitoring', label: 'Pemantauan Live', icon: ShieldAlert },
    { id: 'results', label: 'Hasil & Laporan PDF', icon: FileBarChart2 },
    { id: 'settings', label: 'Profil, Tema & TTD', icon: Palette },
    { id: 'server', label: 'Manajemen Server', icon: Server },
  ];

  const activeTitle = navItems.find((i) => i.id === activeTab)?.label || 'Beranda Proktor';
  const isLightSidebar = settings.sidebarStyle === 'light';

  const brandBadge = settings.schoolLogo ? (
    <img
      src={settings.schoolLogo}
      alt="Logo Sekolah"
      className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0"
    />
  ) : (
    <div className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold shrink-0">
      C
    </div>
  );

  return (
    <div className="min-h-screen cbt-soft-canvas flex">
      {/* Sidebar Desktop */}
      <aside
        className={`hidden lg:flex w-64 shrink-0 flex-col justify-between border-r transition-colors ${
          isLightSidebar
            ? 'cbt-sidebar-light-soft text-slate-700 border-slate-200/80'
            : 'cbt-sidebar-dark-soft text-slate-200 border-white/10'
        }`}
      >
        <div>
          <div
            className={`px-5 py-5 border-b flex items-center gap-3 ${
              isLightSidebar ? 'border-slate-200/80' : 'border-white/10'
            }`}
          >
            {brandBadge}
            <div className="min-w-0">
              <p
                className={`text-base font-bold truncate ${
                  isLightSidebar ? 'text-slate-900' : 'text-white'
                }`}
              >
                CandyCBT
              </p>
              <p
                className={`text-xs truncate ${
                  isLightSidebar ? 'text-slate-500' : 'text-slate-300/80'
                }`}
              >
                {settings.serverName}
              </p>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? isLightSidebar
                        ? 'bg-teal-50 text-teal-900 font-semibold ring-1 ring-teal-200/80'
                        : 'bg-teal-600/25 text-white font-semibold ring-1 ring-teal-300/30'
                      : isLightSidebar
                        ? 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div
          className={`p-4 border-t space-y-3 ${
            isLightSidebar ? 'border-slate-200/80' : 'border-white/10'
          }`}
        >
          <div className="text-xs">
            <p
              className={`font-semibold truncate ${
                isLightSidebar ? 'text-slate-900' : 'text-white'
              }`}
            >
              {user.name}
            </p>
            <p className="text-slate-400 truncate">
              @{user.identifier} · {user.role.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
              isLightSidebar
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                : 'bg-white/10 hover:bg-white/15 text-slate-100'
            }`}
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar Panel
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className={`w-64 flex flex-col justify-between p-4 ${
              isLightSidebar ? 'cbt-sidebar-light-soft text-slate-800' : 'cbt-sidebar-dark-soft text-slate-200'
            }`}
          >
            <div>
              <div
                className={`flex items-center justify-between pb-4 border-b ${
                  isLightSidebar ? 'border-slate-200' : 'border-slate-800'
                }`}
              >
                <span
                  className={`text-base font-bold ${
                    isLightSidebar ? 'text-slate-900' : 'text-white'
                  }`}
                >
                  CandyCBT Admin
                </span>
                <button type="button" onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                        activeTab === item.id
                          ? 'bg-teal-700 text-white'
                          : isLightSidebar
                            ? 'text-slate-700 hover:bg-slate-100'
                            : 'text-slate-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className={`py-2 px-3 rounded-lg text-xs font-semibold ${
                isLightSidebar ? 'bg-slate-100 text-slate-900' : 'bg-slate-800 text-white'
              }`}
            >
              Keluar
            </button>
          </div>
          <div className="flex-1 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="cbt-header-soft px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-300 text-slate-700"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-500 truncate">
              <span>{settings.schoolName}</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900">{activeTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <LiveClockDate variant="inline" className="hidden md:inline-flex" />
            <button
              type="button"
              onClick={() => setActiveTab('monitoring')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-teal-300" />
              Monitor Kecurangan
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Ringkasan Operasional Ujian</h1>
                  <p className="text-sm text-slate-500 mt-1">
                    {settings.schoolName} · Tahun Pelajaran {settings.academicYear} ({settings.semester})
                  </p>
                </div>
                <LiveClockDate variant="card" />
              </div>

              {dashboard && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Total Peserta Terdaftar — Biru Muda */}
                    <div className="bg-sky-100/80 border border-sky-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-sky-900">Total Peserta Terdaftar</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-sky-950">
                          {dashboard.metrics.totalStudentsCount}
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-sky-200/80 text-sky-800 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Total Butir Soal — Coklat Muda */}
                    <div className="bg-[#f5eadf] border border-[#e3cbb2] rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-[#78471c]">Total Butir Soal</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-[#4a290c]">
                          {dashboard.metrics.totalQuestionsCount}
                        </p>
                        <p className="text-xs text-[#8a572a] mt-1">{dashboard.banksCount} Bank Soal</p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-[#ead3bc] text-[#78471c] flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Peserta Sedang Ujian — Ungu Muda */}
                    <div className="bg-purple-100/80 border border-purple-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-purple-900">Peserta Sedang Ujian</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-purple-950">
                          {dashboard.metrics.activeSessionsCount}
                        </p>
                        <p className="text-xs font-medium text-red-700 mt-1">
                          {dashboard.metrics.blockedSessionsCount} Terblokir
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-purple-200/80 text-purple-800 flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Status Server CBT — Pink Muda */}
                    <div className="bg-pink-100/80 border border-pink-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-pink-900">Status Server CBT</p>
                        <p
                          className={`mt-1 text-2xl font-bold ${
                            dashboard.metrics.status === 'ONLINE' ? 'text-emerald-800' : 'text-amber-800'
                          }`}
                        >
                          {dashboard.metrics.status}
                        </p>
                        <p className="text-xs font-mono text-pink-900/80 mt-1 tabular-nums">
                          RAM {dashboard.metrics.memoryRssMb} MB
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-pink-200/80 text-pink-800 flex items-center justify-center shrink-0">
                        <Server className="w-4 h-4" />
                      </div>
                    </div>
                  </div>

                  {/* Active Tokens & Quick Actions */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 cbt-soft-panel rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-slate-900">Token Ujian Aktif</h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('exams')}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          Kelola Jadwal →
                        </button>
                      </div>
                      <div className="divide-y divide-slate-200/75">
                        {dashboard.exams.map((ex) => (
                          <div key={ex.id} className="py-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{ex.subject}</p>
                              <p className="text-xs text-slate-500 truncate">
                                {ex.title} · {ex.durationMinutes} Menit
                              </p>
                            </div>
                            <span className="px-3 py-1.5 rounded-lg bg-teal-50/75 border border-teal-200/70 font-mono text-base font-bold tracking-widest text-teal-800 shrink-0">
                              {ex.token}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-5 cbt-soft-panel rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-slate-900">Pelanggaran Terbaru</h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('monitoring')}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          Buka Monitor →
                        </button>
                      </div>
                      {dashboard.recentViolations.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">
                          Belum ada aktivitas mencurigakan tercatat.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-200">
                          {dashboard.recentViolations.slice(0, 5).map((v) => (
                            <div key={v.id} className="py-2.5 text-xs">
                              <div className="flex justify-between">
                                <span className="font-bold text-slate-900">{v.studentName}</span>
                                <span className="font-mono text-slate-500 tabular-nums">
                                  {new Date(v.timestamp).toLocaleTimeString('id-ID')}
                                </span>
                              </div>
                              <p className="text-slate-600 mt-0.5">{v.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'banks' && <BankSoalManager userRole={user.role} />}
          {activeTab === 'teachers' && <TeachersManager />}
          {activeTab === 'students' && <PesertaManager settings={settings} />}
          {activeTab === 'attendance' && <AbsensiQRManager />}
          {activeTab === 'exams' && <JadwalUjianManager />}
          {activeTab === 'monitoring' && <LiveMonitoring />}
          {activeTab === 'results' && <HasilLaporan />}
          {activeTab === 'settings' && (
            <SchoolSettingsManager
              initialSettings={settings}
              onSettingsUpdated={handleSettingsUpdate}
            />
          )}
          {activeTab === 'server' && (
            <ServerManager onSettingsUpdated={handleSettingsUpdate} />
          )}
        </main>
      </div>
    </div>
  );
};
