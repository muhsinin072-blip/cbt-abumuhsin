import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../lib/api';
import type {
  AdminAttendanceResponse,
  AdminResultsResponse,
  PurgeDatabaseResponse,
  ServerStatusResponse,
} from '../../lib/api';
import { exportAttendanceCSV, exportResultsCSV } from '../../lib/csv';
import type { DatabaseCounts, PurgeTarget, SchoolSettings, ServerMetrics } from '../../types/cbt';

interface ServerManagerProps {
  onSettingsUpdated: (settings: SchoolSettings) => void;
}

const PURGE_OPTIONS: {
  id: PurgeTarget;
  title: string;
  description: string;
  getCountLabel: (c: DatabaseCounts) => string;
  hasData: (c: DatabaseCounts) => boolean;
}[] = [
  {
    id: 'students',
    title: 'Data Peserta Didik',
    description: 'Menghapus seluruh akun siswa beserta sesi ujian aktif peserta.',
    getCountLabel: (c) => `${c.students} Peserta`,
    hasData: (c) => c.students > 0,
  },
  {
    id: 'banks',
    title: 'Data Mapel & Bank Soal (beserta Soal)',
    description: 'Menghapus seluruh paket mapel, butir soal, jadwal ujian, dan hasil terkait.',
    getCountLabel: (c) => `${c.banks} Mapel · ${c.questions} Soal`,
    hasData: (c) => c.banks > 0,
  },
  {
    id: 'questions',
    title: 'Butir Soal Saja (Pertahankan Mapel)',
    description: 'Mengosongkan seluruh pertanyaan PG/Esai tanpa menghapus daftar mapel/bank.',
    getCountLabel: (c) => `${c.questions} Butir Soal`,
    hasData: (c) => c.questions > 0,
  },
  {
    id: 'answers',
    title: 'Jawaban Soal, Nilai & Log Ujian',
    description: 'Menghapus seluruh jawaban siswa, rekap nilai, pemantauan live, dan log kecurangan.',
    getCountLabel: (c) => `${c.sessions} Sesi · ${c.violations} Log`,
    hasData: (c) => c.sessions > 0 || c.violations > 0 || c.broadcasts > 0,
  },
  {
    id: 'exams',
    title: 'Jadwal Ujian & Token Sesi',
    description: 'Menghapus seluruh jadwal ujian aktif/nonaktif beserta sesi jawaban terkait.',
    getCountLabel: (c) => `${c.exams} Jadwal`,
    hasData: (c) => c.exams > 0,
  },
  {
    id: 'teachers',
    title: 'Data Guru & Akses Panel Guru',
    description: 'Menghapus seluruh akun login Guru (Bank Soal tetap tersimpan).',
    getCountLabel: (c) => `${c.teachers} Guru`,
    hasData: (c) => c.teachers > 0,
  },
  {
    id: 'attendance',
    title: 'Riwayat Absensi QR Siswa',
    description: 'Menghapus seluruh log scan kehadiran QR Code harian, pekanan, dan bulanan.',
    getCountLabel: (c) => `${c.attendance} Catatan`,
    hasData: (c) => c.attendance > 0,
  },
  {
    id: 'materials',
    title: 'Materi Pembelajaran & Modul',
    description: 'Menghapus seluruh materi, video, tautan referensi, dan tugas belajar siswa.',
    getCountLabel: (c) => `${c.materials ?? 0} Materi`,
    hasData: (c) => (c.materials ?? 0) > 0,
  },
];

export const ServerManager: React.FC<ServerManagerProps> = ({ onSettingsUpdated }) => {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [counts, setCounts] = useState<DatabaseCounts | null>(null);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Database Purge State
  const [selectedTargets, setSelectedTargets] = useState<PurgeTarget[]>([]);
  const [purgeModalTargets, setPurgeModalTargets] = useState<PurgeTarget[] | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeModalError, setPurgeModalError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch<ServerStatusResponse>('/api/admin/server-status');
      setMetrics(res.metrics);
      if (res?.settings) {
        setSettings(res.settings);
      }
      if (res.counts) {
        setCounts(res.counts);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status server.');
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = window.setInterval(loadStatus, 10_000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const handleToggleMaintenance = async () => {
    if (!settings) return;
    try {
      const res = await apiFetch<{
        maintenanceMode: boolean;
        settings?: SchoolSettings;
        metrics: ServerMetrics;
      }>('/api/admin/server/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled: !settings.maintenanceMode }),
      });
      const nextSettings = res.settings || { ...settings, maintenanceMode: res.maintenanceMode };
      setSettings(nextSettings);
      onSettingsUpdated(nextSettings);
      setMetrics(res.metrics);
      setNotice(
        res.maintenanceMode
          ? 'Mode Pemeliharaan diaktifkan. Login peserta baru ditangguhkan.'
          : 'Server kembali ONLINE untuk seluruh peserta ujian.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah mode server.');
    }
  };

  const handleOptimize = async () => {
    setOptimizing(true);
    setNotice('');
    try {
      const res = await apiFetch<{ recalculated: number; metrics: ServerMetrics }>(
        '/api/admin/server/optimize',
        { method: 'POST' }
      );
      setMetrics(res.metrics);
      setNotice(`Optimasi & sinkronisasi selesai (${res.recalculated} sesi ujian terverifikasi).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengoptimasi server.');
    } finally {
      setOptimizing(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const res = await fetch('/api/admin/server/backup', {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) throw new Error('Gagal mengunduh backup database.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `candycbt-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Backup database JSON berhasil diunduh.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunduh backup.');
    }
  };

  const handleDownloadAttendanceCsv = async () => {
    setError('');
    try {
      const res = await apiFetch<AdminAttendanceResponse>('/api/admin/attendance?period=all');
      const count = exportAttendanceCSV(
        res.records,
        `Backup_Absensi_Siswa_${new Date().toISOString().slice(0, 10)}.csv`
      );
      setNotice(`Backup CSV absensi (${count} baris) berhasil diunduh.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunduh backup CSV absensi.');
    }
  };

  const handleDownloadResultsCsv = async () => {
    setError('');
    try {
      const res = await apiFetch<AdminResultsResponse>('/api/admin/results');
      const count = exportResultsCSV(
        res.results,
        `Backup_Nilai_Ujian_${new Date().toISOString().slice(0, 10)}.csv`
      );
      setNotice(`Backup CSV nilai ujian (${count} baris) berhasil diunduh.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunduh backup CSV nilai.');
    }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await apiFetch<{ metrics: ServerMetrics; settings?: SchoolSettings }>(
        '/api/admin/server/restore',
        {
          method: 'POST',
          body: JSON.stringify(json),
        }
      );
      setMetrics(res.metrics);
      if (res.settings) {
        setSettings(res.settings);
        onSettingsUpdated(res.settings);
      }
      setNotice('Database CandyCBT berhasil dipulihkan dari file backup.');
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulihkan file backup JSON.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch<{ settings?: SchoolSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      if (res?.settings) {
        setSettings(res.settings);
        onSettingsUpdated(res.settings);
      }
      setNotice('Profil sekolah dan konfigurasi server berhasil disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.');
    } finally {
      setSaving(false);
    }
  };

  const toggleTarget = (id: PurgeTarget) => {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const openPurgeModal = (targets: PurgeTarget[]) => {
    if (targets.length === 0) return;
    setPurgeModalTargets(targets);
    setPurgeConfirmText('');
    setPurgeModalError('');
  };

  const handleConfirmPurge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purgeModalTargets || purgeModalTargets.length === 0) return;
    if (purgeConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setPurgeModalError('Ketik kata HAPUS dengan benar untuk mengonfirmasi.');
      return;
    }
    setPurging(true);
    setPurgeModalError('');
    setError('');
    try {
      const res = await apiFetch<PurgeDatabaseResponse>('/api/admin/server/purge', {
        method: 'POST',
        body: JSON.stringify({
          targets: purgeModalTargets,
          confirmText: purgeConfirmText.trim().toUpperCase(),
        }),
      });
      setCounts(res.counts);
      setMetrics(res.metrics);
      setSelectedTargets((prev) => prev.filter((t) => !purgeModalTargets.includes(t)));
      setPurgeModalTargets(null);
      setPurgeConfirmText('');
      setNotice(res.message);
    } catch (err) {
      setPurgeModalError(err instanceof Error ? err.message : 'Gagal menghapus basis data.');
    } finally {
      setPurging(false);
    }
  };

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}j ${m}m ${s}d`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manajemen Server & Pengaturan Sekolah</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pantau kesehatan server Node.js, koneksi WebSocket peserta, backup/restore basis data, dan identitas kop laporan PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadStatus}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700"
          >
            <RefreshCw className="w-4 h-4" />
            Cek Status
          </button>
          <button
            type="button"
            disabled={optimizing}
            onClick={handleOptimize}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
          >
            <Activity className="w-4 h-4" />
            {optimizing ? 'Menyinkronkan...' : 'Sinkronisasi & Optimasi'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {notice}
        </div>
      )}

      {/* Server Health Grid */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Status Server</span>
              <Server className="w-4 h-4 text-teal-700" />
            </div>
            <p
              className={`mt-2 text-xl font-bold ${
                metrics.status === 'ONLINE' ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {metrics.status}
            </p>
            <p className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
              Uptime: {formatUptime(metrics.uptimeSeconds)}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Memori Proses (RSS / Heap)</span>
              <Cpu className="w-4 h-4 text-slate-600" />
            </div>
            <p className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.memoryRssMb} MB
            </p>
            <p className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
              Heap: {metrics.memoryHeapUsedMb} MB · {metrics.cpuCount} vCPU
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Koneksi WebSocket Live</span>
              <Activity className="w-4 h-4 text-teal-700" />
            </div>
            <p className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.wsConnectedClients} Klien
            </p>
            <p className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
              Peserta: {metrics.wsConnectedStudents} · Proktor: {metrics.wsConnectedAdmins}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Basis Data CBT (SQL)</span>
              <HardDrive className="w-4 h-4 text-slate-600" />
            </div>
            <p className="mt-2 text-xl font-bold font-mono tabular-nums text-slate-900">
              {metrics.dbSizeKb} KB
            </p>
            <p className="text-xs font-mono text-slate-500 mt-1 tabular-nums">
              {metrics.totalStudentsCount} Peserta · {metrics.totalQuestionsCount} Soal
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* School & Server Config Form */}
        {settings && (
          <form
            onSubmit={handleSaveSettings}
            className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-3">
              Identitas Sekolah & Konfigurasi Kop PDF
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Sekolah</label>
                <input
                  required
                  value={settings.schoolName}
                  onChange={(e) => setSettings({ ...settings, schoolName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NPSN</label>
                <input
                  required
                  value={settings.npsn}
                  onChange={(e) => setSettings({ ...settings, npsn: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Alamat Sekolah</label>
                <input
                  required
                  value={settings.address}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tahun Pelajaran</label>
                <input
                  required
                  value={settings.academicYear}
                  onChange={(e) => setSettings({ ...settings, academicYear: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Semester</label>
                <input
                  required
                  value={settings.semester}
                  onChange={(e) => setSettings({ ...settings, semester: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Kepala Sekolah</label>
                <input
                  required
                  value={settings.principalName}
                  onChange={(e) => setSettings({ ...settings, principalName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NIP Kepala Sekolah</label>
                <input
                  required
                  value={settings.principalNip}
                  onChange={(e) => setSettings({ ...settings, principalNip: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Koordinator / Proktor</label>
                <input
                  required
                  value={settings.proctorName}
                  onChange={(e) => setSettings({ ...settings, proctorName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kode Server CBT</label>
                <input
                  required
                  value={settings.serverName}
                  onChange={(e) => setSettings({ ...settings, serverName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoRotateToken}
                  onChange={(e) => setSettings({ ...settings, autoRotateToken: e.target.checked })}
                />
                Rotasi Token Otomatis tiap {settings.tokenIntervalMinutes} Menit
              </label>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          </form>
        )}

        {/* Server Controls & Backup */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-slate-900">Kontrol Akses Server</h2>
            <p className="text-xs text-slate-500">
              Aktifkan mode pemeliharaan untuk menahan login peserta baru saat proses sinkronisasi bank soal.
            </p>
            <button
              type="button"
              onClick={handleToggleMaintenance}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors ${
                settings?.maintenanceMode
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                  : 'bg-amber-600 hover:bg-amber-700 text-white'
              }`}
            >
              {settings?.maintenanceMode ? 'Matikan Mode Pemeliharaan' : 'Aktifkan Mode Pemeliharaan'}
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-bold text-slate-900">Backup & Restore Basis Data</h2>
            </div>
            <p className="text-xs text-slate-500">
              Cadangkan seluruh bank soal, peserta, jadwal ujian, dan rekap nilai dalam satu file JSON.
            </p>
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Unduh Backup (.json)
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadAttendanceCsv()}
                className="py-2 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Absensi (.csv)
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadResultsCsv()}
                className="py-2 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Nilai (.csv)
              </button>
            </div>
            <label className="w-full py-2.5 px-4 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              Pulihkan dari Backup (.json)
              <input type="file" accept=".json" onChange={handleRestoreBackup} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Hapus & Reset Basis Data CBT */}
      <section className="bg-white border border-red-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-red-50/80 border-b border-red-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-red-950">
                Hapus & Kosongkan Basis Data CBT
              </h2>
              <p className="text-xs text-red-800/85">
                Hapus data peserta didik, mapel/bank soal, butir soal, jawaban & nilai ujian, jadwal, guru, atau riwayat absensi secara selektif maupun menyeluruh.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedTargets.length > 0 && (
              <button
                type="button"
                onClick={() => openPurgeModal(selectedTargets)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus Terpilih ({selectedTargets.length})
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                openPurgeModal([
                  'students',
                  'banks',
                  'exams',
                  'answers',
                  'teachers',
                  'attendance',
                  'materials',
                ])
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-300 bg-white hover:bg-red-600 hover:text-white hover:border-red-600 text-red-700 text-xs font-semibold whitespace-nowrap transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Kosongkan Semua Data CBT
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {PURGE_OPTIONS.map((opt) => {
            const checked = selectedTargets.includes(opt.id);
            const countText = counts ? opt.getCountLabel(counts) : '...';
            const hasItems = counts ? opt.hasData(counts) : true;
            return (
              <div
                key={opt.id}
                className="px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/70"
              >
                <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-[240px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTarget(opt.id)}
                    className="mt-1 rounded border-slate-300 text-red-600 focus:ring-red-500"
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{opt.title}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                        {countText}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{opt.description}</p>
                  </div>
                </label>

                <button
                  type="button"
                  disabled={!hasItems}
                  onClick={() => openPurgeModal([opt.id])}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-40 disabled:hover:bg-red-50 disabled:hover:text-red-700 text-red-700 text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>
            Akun Admin/Proktor dan Profil/Tema/Logo Sekolah tidak ikut terhapus agar akses manajemen tetap aman.
          </span>
          <span>Disarankan unduh Backup (.json) terlebih dahulu sebelum melakukan penghapusan massal.</span>
        </div>
      </section>

      {/* Purge Confirmation Modal */}
      {purgeModalTargets && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-red-200 overflow-hidden shadow-xl">
            <div className="px-6 py-4 bg-red-600 text-white flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-bold">Konfirmasi Hapus Permanen Basis Data</h3>
            </div>

            <form onSubmit={handleConfirmPurge} className="p-6 space-y-4">
              <div className="text-xs text-slate-700 space-y-2">
                <p className="font-semibold text-slate-900">
                  Data berikut akan dihapus permanen dari server:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-red-800 font-medium">
                  {PURGE_OPTIONS.filter((o) => purgeModalTargets.includes(o.id)).map((o) => (
                    <li key={o.id}>
                      {o.title}{' '}
                      {counts && (
                        <span className="font-mono text-[11px]">({o.getCountLabel(counts)})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Ketik <span className="font-mono font-bold text-red-700">HAPUS</span> untuk melanjutkan:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={purgeConfirmText}
                  onChange={(e) => setPurgeConfirmText(e.target.value)}
                  placeholder="Ketik HAPUS"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {purgeModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {purgeModalError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPurgeModalTargets(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={purging || purgeConfirmText.trim().toUpperCase() !== 'HAPUS'}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-semibold"
                >
                  {purging ? 'Menghapus...' : 'Ya, Hapus Permanen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
