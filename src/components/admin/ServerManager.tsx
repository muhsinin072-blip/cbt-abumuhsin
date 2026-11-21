import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  Save,
  Server,
  Upload,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../lib/api';
import type { SchoolSettings, ServerMetrics } from '../../types/cbt';

interface ServerManagerProps {
  onSettingsUpdated: (settings: SchoolSettings) => void;
}

export const ServerManager: React.FC<ServerManagerProps> = ({ onSettingsUpdated }) => {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiFetch<{ metrics: ServerMetrics; settings: SchoolSettings }>(
        '/api/admin/server-status'
      );
      setMetrics(res.metrics);
      setSettings(res.settings);
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
      const res = await apiFetch<{ settings: SchoolSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      onSettingsUpdated(res.settings);
      setNotice('Profil sekolah dan konfigurasi server berhasil disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.');
    } finally {
      setSaving(false);
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
              <span>Penyimpanan Data CBT</span>
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
            <label className="w-full py-2.5 px-4 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              Pulihkan dari Backup (.json)
              <input type="file" accept=".json" onChange={handleRestoreBackup} className="hidden" />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
