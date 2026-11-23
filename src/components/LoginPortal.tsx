import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, GraduationCap, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import type { LoginResponse, PublicInfoResponse } from '../lib/api';
import type { AuthUser } from '../types/cbt';
import { LiveClockDate } from './LiveClockDate';

const DEFAULT_PORTAL_SLIDES = [
  {
    src: '/src/assets/images/cbt_portal_illustration_1795244047124.jpg',
    alt: 'Ruang Laboratorium Ujian Berbasis Komputer CandyCBT',
  },
  {
    src: '/src/assets/images/cbt_students_exam_1795260112350.jpg',
    alt: 'Pelaksanaan Ujian Berbasis Komputer Peserta Didik',
  },
  {
    src: '/src/assets/images/cbt_proctor_monitoring_1795260112472.jpg',
    alt: 'Pengawasan Proktor Laboratorium Ujian Digital',
  },
];

interface LoginPortalProps {
  publicInfo: PublicInfoResponse | null;
  onLoginSuccess: (user: AuthUser) => void;
  onAdminClaimed: () => void;
}

export const LoginPortal: React.FC<LoginPortalProps> = ({
  publicInfo,
  onLoginSuccess,
  onAdminClaimed,
}) => {
  const [activeTab, setActiveTab] = useState<'student' | 'guru' | 'admin'>('student');
  const [nis, setNis] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [teacherNip, setTeacherNip] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminFullName, setAdminFullName] = useState('Administrator CBT');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [slideIndex, setSlideIndex] = useState(0);
  const [slidePaused, setSlidePaused] = useState(false);
  const [failedSlides, setFailedSlides] = useState<Record<number, boolean>>({});

  const schoolName = publicInfo?.settings?.schoolName || 'SMK NEGERI 1 NUSANTARA';
  const schoolLogo = publicInfo?.settings?.schoolLogo || '';
  const academicYear = publicInfo?.settings?.academicYear || '2026/2027';
  const semester = publicInfo?.settings?.semester || 'Ganjil';
  const maintenanceMode = publicInfo?.settings?.maintenanceMode ?? false;
  const adminSetupRequired = publicInfo?.adminSetupRequired ?? false;

  const slides = useMemo(() => {
    const custom = publicInfo?.settings?.portalSlides?.filter((s) => Boolean(s)) || [];
    if (custom.length > 0) {
      return custom.map((src, idx) => ({
        src,
        alt: `${schoolName} — Foto Slide ${idx + 1}`,
      }));
    }
    return DEFAULT_PORTAL_SLIDES;
  }, [publicInfo?.settings?.portalSlides, schoolName]);

  useEffect(() => {
    setSlideIndex(0);
    setFailedSlides({});
  }, [slides.length]);

  useEffect(() => {
    if (slidePaused || slides.length <= 1) return;
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, 5800);
    return () => window.clearInterval(timer);
  }, [slidePaused, slides.length]);

  const safeSlideIndex = slideIndex % slides.length;
  const currentSlide = slides[safeSlideIndex] || DEFAULT_PORTAL_SLIDES[0];

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<LoginResponse>('/api/auth/student/login', {
        method: 'POST',
        body: JSON.stringify({ nis: nis.trim(), password: studentPassword }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk sebagai peserta.');
    } finally {
      setLoading(false);
    }
  };

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<LoginResponse>('/api/auth/teacher/login', {
        method: 'POST',
        body: JSON.stringify({ nip: teacherNip.trim(), password: teacherPassword }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk sebagai guru.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = adminSetupRequired ? '/api/auth/admin/setup' : '/api/auth/admin/login';
      const payload = adminSetupRequired
        ? { username: adminUsername.trim(), fullName: adminFullName.trim(), password: adminPassword }
        : { username: adminUsername.trim(), password: adminPassword };

      const data = await apiFetch<LoginResponse>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthToken(data.token);
      if (adminSetupRequired) {
        onAdminClaimed();
      }
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal autentikasi Admin/Proktor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen cbt-soft-canvas flex flex-col">
      <header className="cbt-header-soft px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.06 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="relative overflow-hidden rounded-lg"
            >
              {schoolLogo ? (
                <div className="relative overflow-hidden rounded-lg cbt-logo-sheen">
                  <img
                    src={schoolLogo}
                    alt={`Logo ${schoolName}`}
                    className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
                  />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-base cbt-logo-sheen">
                  C
                </div>
              )}
            </motion.div>
            <span className="text-lg font-bold tracking-tight text-slate-900">CandyCBT</span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => {
                setActiveTab('student');
                setError('');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'student' ? 'text-teal-700 font-semibold' : ''
              }`}
            >
              Portal Peserta
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('guru');
                setError('');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'guru' ? 'text-teal-700 font-semibold' : ''
              }`}
            >
              Panel Guru
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('admin');
                setError('');
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'admin' ? 'text-teal-700 font-semibold' : ''
              }`}
            >
              Panel Proktor
            </button>
          </nav>

          <div className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
            {schoolName} · TA {academicYear}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-5xl cbt-soft-card rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-6 cbt-hero-soft text-white p-8 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center gap-4">
                {schoolLogo && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85, rotate: -4 }}
                    animate={{
                      opacity: 1,
                      scale: [1, 1.025, 1],
                      y: [0, -3.5, 0],
                      rotate: 0,
                    }}
                    transition={{
                      opacity: { duration: 0.7, ease: 'easeOut' },
                      rotate: { duration: 0.7, ease: 'easeOut' },
                      y: { duration: 4.8, repeat: Infinity, ease: 'easeInOut' },
                      scale: { duration: 4.8, repeat: Infinity, ease: 'easeInOut' },
                    }}
                    whileHover={{ scale: 1.07 }}
                    className="relative shrink-0"
                  >
                    <div
                      aria-hidden="true"
                      className="absolute -inset-2 rounded-2xl blur-md cbt-logo-halo pointer-events-none"
                    />
                    <div className="relative overflow-hidden rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-white/40 cbt-logo-sheen">
                      <img
                        src={schoolLogo}
                        alt={`Logo ${schoolName}`}
                        className="w-12 h-12 rounded-lg object-contain block"
                      />
                    </div>
                  </motion.div>
                )}
                <div className="min-w-0">
                  <motion.p
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.75, ease: 'easeOut' }}
                    className="text-xs font-semibold cbt-subtitle-classy"
                  >
                    Computer-Based Test · Semester {semester}
                  </motion.p>
                  <motion.h1
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-balance cbt-school-title-animate"
                  >
                    {schoolName}
                  </motion.h1>
                </div>
              </div>
              <div className="mt-3 cbt-runtext-wrap">
                <div className="cbt-runtext-track text-sm text-slate-300">
                  <span className="pr-14">
                    Sistem ujian berbasis web dengan sinkronisasi jawaban otomatis, pemantauan kecurangan real-time, dan pelaporan nilai PDF instan.
                  </span>
                  <span className="pr-14" aria-hidden="true">
                    Sistem ujian berbasis web dengan sinkronisasi jawaban otomatis, pemantauan kecurangan real-time, dan pelaporan nilai PDF instan.
                  </span>
                </div>
              </div>
            </div>

            <div
              className="group relative rounded-lg overflow-hidden border border-slate-700/80 bg-slate-800 aspect-[4/3]"
              onMouseEnter={() => setSlidePaused(true)}
              onMouseLeave={() => setSlidePaused(false)}
            >
              {!failedSlides[safeSlideIndex] ? (
                <AnimatePresence mode="sync" initial={false}>
                  <motion.img
                    key={`${safeSlideIndex}-${currentSlide.src.slice(0, 48)}`}
                    src={currentSlide.src}
                    alt={currentSlide.alt}
                    referrerPolicy="no-referrer"
                    initial={{ opacity: 0, x: 32 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -32 }}
                    transition={{ duration: 1.15, ease: 'easeInOut' }}
                    onError={() =>
                      setFailedSlides((prev) => ({ ...prev, [safeSlideIndex]: true }))
                    }
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </AnimatePresence>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-slate-800 to-teal-950">
                  <ShieldCheck className="w-12 h-12 text-teal-400 mb-3" />
                  <p className="text-sm font-semibold text-white">Portal Ujian Digital Terpadu</p>
                  <p className="text-xs text-slate-400 mt-1">Layanan Ujian Terproteksi Anti-Kecurangan</p>
                </div>
              )}

              {slides.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Foto sebelumnya"
                    onClick={() =>
                      setSlideIndex((prev) => (prev - 1 + slides.length) % slides.length)
                    }
                    className="opacity-0 group-hover:opacity-100 transition-opacity absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/60 hover:bg-slate-950/85 text-white flex items-center justify-center"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Foto berikutnya"
                    onClick={() => setSlideIndex((prev) => (prev + 1) % slides.length)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-950/60 hover:bg-slate-950/85 text-white flex items-center justify-center"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/55">
                    {slides.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        aria-label={`Tampilkan slide ${idx + 1}`}
                        onClick={() => setSlideIndex(idx)}
                        className={`h-1.5 rounded-full transition-all ${
                          idx === safeSlideIndex
                            ? 'w-5 bg-teal-300'
                            : 'w-1.5 bg-white/50 hover:bg-white/80'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <LiveClockDate variant="hero" />

            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-white/10 text-xs">
              <div>
                <p className="text-slate-300/80">Server</p>
                <p className="font-mono font-semibold text-white mt-0.5 tabular-nums">
                  {publicInfo?.settings?.serverName || 'SRV-CBT-01'}
                </p>
              </div>
              <div>
                <p className="text-slate-300/80">Status</p>
                <p className={`font-semibold mt-0.5 ${maintenanceMode ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {maintenanceMode ? 'Pemeliharaan' : 'Aktif'}
                </p>
              </div>
              <div>
                <p className="text-slate-300/80">NPSN</p>
                <p className="font-mono font-semibold text-white mt-0.5 tabular-nums">
                  {publicInfo?.settings?.npsn || '20261901'}
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 p-8 sm:p-10 bg-white/75 flex flex-col justify-center">
            <div className="grid grid-cols-3 items-center gap-1 p-1 bg-slate-100/85 border border-slate-200/70 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('student');
                  setError('');
                }}
                className={`py-2 px-2.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
                  activeTab === 'student'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                Peserta
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('guru');
                  setError('');
                }}
                className={`py-2 px-2.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
                  activeTab === 'guru'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <GraduationCap className="w-4 h-4 shrink-0" />
                Guru
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('admin');
                  setError('');
                }}
                className={`py-2 px-2.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Lock className="w-4 h-4 shrink-0" />
                Proktor
              </button>
            </div>

            {maintenanceMode && activeTab === 'student' && (
              <div className="mb-5 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
                Server ujian sedang dalam mode pemeliharaan oleh Proktor. Login peserta ditangguhkan sementara.
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium"
              >
                {error}
              </div>
            )}

            {activeTab === 'student' ? (
              <form onSubmit={handleStudentLogin} className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Masuk Ruang Ujian Peserta</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Masukkan Nomor Induk Siswa (NIS) dan password sesuai kartu peserta ujian Anda.
                  </p>
                </div>

                <div>
                  <label htmlFor="stu-nis" className="block text-sm font-medium text-slate-700 mb-1.5">
                    NIS / Username Peserta
                  </label>
                  <input
                    id="stu-nis"
                    type="text"
                    required
                    value={nis}
                    onChange={(e) => setNis(e.target.value)}
                    placeholder="Contoh: 2026001"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>

                <div>
                  <label htmlFor="stu-pass" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="stu-pass"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={studentPassword}
                      onChange={(e) => setStudentPassword(e.target.value)}
                      placeholder="Masukkan password peserta"
                      className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label="Tampilkan atau sembunyikan password"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || maintenanceMode}
                  className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  {loading ? 'Memverifikasi...' : 'Masuk ke Daftar Ujian'}
                </button>

                {publicInfo?.sampleStudents && publicInfo.sampleStudents.length > 0 && (
                  <div className="pt-4 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-500 mb-2">
                      Akun Uji Coba Peserta (Password: <span className="font-mono">123</span>):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {publicInfo.sampleStudents.map((s) => (
                        <button
                          key={s.nis}
                          type="button"
                          onClick={() => {
                            setNis(s.nis);
                            setStudentPassword('123');
                            setError('');
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium transition-colors whitespace-nowrap"
                        >
                          <span className="font-mono">{s.nis}</span> · {s.name.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            ) : activeTab === 'guru' ? (
              <form onSubmit={handleTeacherLogin} className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Login Portal Guru Pengampu</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Kelola Bank Soal Excel, Jadwal & Token Ujian, Koreksi Esai, Absensi QR, dan Laporan Nilai PDF yang tersinkronisasi dengan Proktor.
                  </p>
                </div>

                <div>
                  <label htmlFor="guru-nip" className="block text-sm font-medium text-slate-700 mb-1.5">
                    NIP / Username Guru
                  </label>
                  <input
                    id="guru-nip"
                    type="text"
                    required
                    value={teacherNip}
                    onChange={(e) => setTeacherNip(e.target.value)}
                    placeholder="Contoh: guru1"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>

                <div>
                  <label htmlFor="guru-pass" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Password Guru
                  </label>
                  <div className="relative">
                    <input
                      id="guru-pass"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={teacherPassword}
                      onChange={(e) => setTeacherPassword(e.target.value)}
                      placeholder="Masukkan password guru"
                      className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label="Tampilkan atau sembunyikan password"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  {loading ? 'Memverifikasi...' : 'Masuk ke Panel Guru'}
                </button>

                {publicInfo?.sampleTeachers && publicInfo.sampleTeachers.length > 0 && (
                  <div className="pt-4 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-500 mb-2">
                      Akun Uji Coba Guru (Password: <span className="font-mono">guru123</span>):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {publicInfo.sampleTeachers.map((t) => (
                        <button
                          key={t.nip}
                          type="button"
                          onClick={() => {
                            setTeacherNip(t.nip);
                            setTeacherPassword('guru123');
                            setError('');
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium transition-colors whitespace-nowrap"
                        >
                          <span className="font-mono">{t.nip}</span> · {t.subject.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {adminSetupRequired ? 'Aktivasi Awal Akun Administrator' : 'Login Panel Admin & Proktor'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {adminSetupRequired
                      ? 'Belum ada akun Admin terdaftar. Tetapkan password Administrator pertama untuk mengunci dan mengelola server CBT.'
                      : 'Masuk untuk mengelola Bank Soal Excel, Jadwal Ujian, Pemantauan Kecurangan, dan Laporan PDF.'}
                  </p>
                </div>

                {adminSetupRequired && (
                  <div>
                    <label htmlFor="adm-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                      Nama Lengkap Administrator / Proktor
                    </label>
                    <input
                      id="adm-name"
                      type="text"
                      required
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="adm-user" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Username Admin / Proktor
                  </label>
                  <input
                    id="adm-user"
                    type="text"
                    required
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>

                <div>
                  <label htmlFor="adm-pass" className="block text-sm font-medium text-slate-700 mb-1.5">
                    {adminSetupRequired ? 'Buat Password Baru (min. 6 karakter)' : 'Password Admin'}
                  </label>
                  <div className="relative">
                    <input
                      id="adm-pass"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={adminSetupRequired ? 6 : 1}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder={adminSetupRequired ? 'Minimal 6 karakter' : 'Masukkan password admin'}
                      className="w-full px-3.5 py-2.5 pr-10 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label="Tampilkan atau sembunyikan password"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-400 text-white font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  {loading
                    ? 'Memproses...'
                    : adminSetupRequired
                      ? 'Simpan Password & Aktifkan Admin'
                      : 'Masuk ke Panel Proktor'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
