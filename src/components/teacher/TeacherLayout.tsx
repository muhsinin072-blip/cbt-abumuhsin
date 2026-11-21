import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileBarChart2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  ShieldAlert,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { AdminDashboardResponse } from '../../lib/api';
import { applyCbtTheme } from '../../lib/theme';
import type { AuthUser, SchoolSettings } from '../../types/cbt';
import { LiveClockDate } from '../LiveClockDate';
import { AbsensiQRManager } from '../admin/AbsensiQRManager';
import { BankSoalManager } from '../admin/BankSoalManager';
import { HasilLaporan } from '../admin/HasilLaporan';
import { JadwalUjianManager } from '../admin/JadwalUjianManager';
import { LiveMonitoring } from '../admin/LiveMonitoring';

type TeacherTab =
  | 'overview'
  | 'banks'
  | 'exams'
  | 'monitoring'
  | 'results'
  | 'attendance'
  | 'profile';

interface TeacherLayoutProps {
  user: AuthUser;
  initialSettings: SchoolSettings;
  onUserSync?: (nextUser: AuthUser) => void;
  onSettingsSync?: (settings: SchoolSettings) => void;
  onLogout: () => void;
}

export const TeacherLayout: React.FC<TeacherLayoutProps> = ({
  user,
  initialSettings,
  onUserSync,
  onSettingsSync,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<TeacherTab>('overview');
  const [settings, setSettings] = useState<SchoolSettings>(initialSettings);
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Teacher profile form state
  const [fullName, setFullName] = useState(user.name);
  const [subject, setSubject] = useState(user.subject || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');

  useEffect(() => {
    setFullName(user.name);
    setSubject(user.subject || '');
  }, [user.name, user.subject]);

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
    loadDashboard();
    const ws = createCbtWebSocket((event, payload) => {
      if (event === 'sync:settings' && payload) {
        handleSettingsUpdate(payload as SchoolSettings);
      } else if (
        event === 'sync:banks' ||
        event === 'sync:exams' ||
        event === 'sync:results' ||
        event === 'session:updated' ||
        event === 'session:removed' ||
        event === 'violation:logged' ||
        event === 'token:rotated' ||
        event === 'sync:teachers'
      ) {
        loadDashboard();
      }
    });
    return () => ws.close();
  }, [loadDashboard, handleSettingsUpdate]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileNotice('');
    setSavingProfile(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/teacher/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName: fullName.trim(),
          subject: subject.trim(),
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      onUserSync?.(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setProfileNotice(
        'Profil Guru berhasil diperbarui dan nama pengampu pada Bank Soal ikut tersinkron.'
      );
      loadDashboard();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Gagal memperbarui profil guru.');
    } finally {
      setSavingProfile(false);
    }
  };

  const navItems: { id: TeacherTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Beranda Guru', icon: LayoutDashboard },
    { id: 'banks', label: 'Bank Soal & Excel', icon: BookOpen },
    { id: 'exams', label: 'Jadwal & Token', icon: CalendarClock },
    { id: 'monitoring', label: 'Pemantauan Live', icon: ShieldAlert },
    { id: 'results', label: 'Hasil & Koreksi Esai', icon: FileBarChart2 },
    { id: 'attendance', label: 'Absensi QR Siswa', icon: QrCode },
    { id: 'profile', label: 'Profil & Akun Guru', icon: UserCog },
  ];

  const activeTitle = navItems.find((i) => i.id === activeTab)?.label || 'Beranda Guru';
  const isLightSidebar = settings.sidebarStyle === 'light';

  const brandBadge = settings.schoolLogo ? (
    <img
      src={settings.schoolLogo}
      alt="Logo Sekolah"
      className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0"
    />
  ) : (
    <div className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center font-bold shrink-0">
      <GraduationCap className="w-5 h-5" />
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
                CandyCBT Guru
              </p>
              <p
                className={`text-xs truncate ${
                  isLightSidebar ? 'text-slate-500' : 'text-slate-300/80'
                }`}
              >
                {user.subject || 'Pengampu Mapel'}
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
              @{user.identifier} · GURU
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
            Keluar Panel Guru
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
                  CandyCBT Guru
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

      {/* Main Content */}
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

          <div className="flex items-center gap-3 shrink-0">
            <LiveClockDate variant="inline" className="hidden xl:inline-flex mr-1" />
            <button
              type="button"
              onClick={() => setActiveTab('attendance')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300/80 bg-white/90 hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5 text-teal-700" />
              Scan Absensi QR
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monitoring')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-teal-300" />
              Pantau Ujian Live
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">
                    Selamat Datang, {user.name}
                  </h1>
                  <p className="text-sm text-slate-500 mt-1">
                    {settings.schoolName} · Pengampu {user.subject || 'Mata Pelajaran'} · TA{' '}
                    {settings.academicYear} ({settings.semester})
                  </p>
                </div>
                <LiveClockDate variant="card" />
              </div>

              {dashboard && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-sky-100/80 border border-sky-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-sky-900">Bank Soal Saya</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-sky-950">
                          {dashboard.banksCount}
                        </p>
                        <p className="text-xs text-sky-800 mt-1">
                          {dashboard.exams.length} Jadwal Ujian
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-sky-200/80 text-sky-800 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="bg-[#f5eadf] border border-[#e3cbb2] rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-[#78471c]">Butir Soal Saya</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-[#4a290c]">
                          {dashboard.metrics.totalQuestionsCount}
                        </p>
                        <p className="text-xs text-[#8a572a] mt-1">Siap diujikan</p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-[#ead3bc] text-[#78471c] flex items-center justify-center shrink-0">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="bg-purple-100/80 border border-purple-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-purple-900">Sedang Ujian</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-purple-950">
                          {dashboard.metrics.activeSessionsCount}
                        </p>
                        <p className="text-xs font-medium text-red-700 mt-1">
                          {dashboard.metrics.blockedSessionsCount} Terblokir
                        </p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-purple-200/80 text-purple-800 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="bg-pink-100/80 border border-pink-200 rounded-xl p-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-pink-900">Selesai & Ternilai</p>
                        <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-pink-950">
                          {dashboard.metrics.finishedSessionsCount}
                        </p>
                        <p className="text-xs text-pink-900/80 mt-1">Siap koreksi esai & PDF</p>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-pink-200/80 text-pink-800 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('banks')}
                      className="p-4 rounded-xl cbt-soft-panel hover:border-teal-400 text-left transition-colors"
                    >
                      <BookOpen className="w-5 h-5 text-teal-700 mb-2" />
                      <p className="text-sm font-bold text-slate-900">Kelola Bank Soal</p>
                      <p className="text-xs text-slate-500 mt-0.5">Import Excel atau tulis soal</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('exams')}
                      className="p-4 rounded-xl cbt-soft-panel hover:border-teal-400 text-left transition-colors"
                    >
                      <CalendarClock className="w-5 h-5 text-teal-700 mb-2" />
                      <p className="text-sm font-bold text-slate-900">Jadwal & Token</p>
                      <p className="text-xs text-slate-500 mt-0.5">Aktifkan ujian & rilis token</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('results')}
                      className="p-4 rounded-xl cbt-soft-panel hover:border-teal-400 text-left transition-colors"
                    >
                      <FileBarChart2 className="w-5 h-5 text-teal-700 mb-2" />
                      <p className="text-sm font-bold text-slate-900">Koreksi & PDF Nilai</p>
                      <p className="text-xs text-slate-500 mt-0.5">Nilai esai & ekspor laporan</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('attendance')}
                      className="p-4 rounded-xl cbt-soft-panel hover:border-teal-400 text-left transition-colors"
                    >
                      <QrCode className="w-5 h-5 text-teal-700 mb-2" />
                      <p className="text-sm font-bold text-slate-900">Absensi QR Siswa</p>
                      <p className="text-xs text-slate-500 mt-0.5">Scan QR & rekap harian/bulanan</p>
                    </button>
                  </div>

                  {/* Active Tokens & Violations */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 cbt-soft-panel rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-slate-900">
                          Jadwal & Token Ujian Mata Pelajaran Anda
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveTab('exams')}
                          className="text-xs font-semibold text-teal-700 hover:underline"
                        >
                          Kelola Jadwal →
                        </button>
                      </div>
                      {dashboard.exams.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">
                          Belum ada jadwal ujian pada Bank Soal Anda.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-200/75">
                          {dashboard.exams.map((ex) => (
                            <div key={ex.id} className="py-3 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 truncate">
                                  {ex.subject}
                                </p>
                                <p className="text-xs text-slate-500 truncate">
                                  {ex.title} · {ex.durationMinutes} Menit ·{' '}
                                  {ex.isActive ? 'Aktif' : 'Nonaktif'}
                                </p>
                              </div>
                              <span className="px-3 py-1.5 rounded-lg bg-teal-50/75 border border-teal-200/70 font-mono text-base font-bold tracking-widest text-teal-800 shrink-0">
                                {ex.token}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="lg:col-span-5 cbt-soft-panel rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-slate-900">
                          Pelanggaran Terbaru Mapel Anda
                        </h2>
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
                          Belum ada aktivitas mencurigakan pada ujian Anda.
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

          {activeTab === 'banks' && (
            <BankSoalManager userRole="guru" teacherNameDefault={user.name} />
          )}
          {activeTab === 'exams' && <JadwalUjianManager />}
          {activeTab === 'monitoring' && <LiveMonitoring />}
          {activeTab === 'results' && <HasilLaporan />}
          {activeTab === 'attendance' && <AbsensiQRManager />}
          {activeTab === 'profile' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Profil & Keamanan Akun Guru</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Perubahan nama atau mata pelajaran otomatis disinkronkan dengan daftar Guru di Admin dan seluruh Bank Soal Anda.
                </p>
              </div>

              {profileError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
                  {profileError}
                </div>
              )}
              {profileNotice && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
                  {profileNotice}
                </div>
              )}

              <form
                onSubmit={handleSaveProfile}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      NIP / Username Login
                    </label>
                    <input
                      disabled
                      value={user.identifier}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mata Pelajaran Utama
                    </label>
                    <input
                      required
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap & Gelar
                  </label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-slate-700">
                    Ubah Password (Opsional — isi hanya jika ingin mengganti password)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Password Saat Ini
                      </label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Password lama"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Password Baru (min. 6 karakter)
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Minimal 6 karakter"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-400 text-white text-sm font-semibold"
                  >
                    {savingProfile ? 'Menyimpan...' : 'Simpan Profil Guru'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
