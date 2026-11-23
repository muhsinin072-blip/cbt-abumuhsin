import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Layers, Plus, Printer, Search, Trash2, Upload, X } from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { StudentsResponse } from '../../lib/api';
import { downloadStudentTemplate, parseStudentExcel } from '../../lib/excel';
import { generateParticipantCardsPDF } from '../../lib/pdf';
import type { SchoolSettings, Student } from '../../types/cbt';

interface PesertaManagerProps {
  settings: SchoolSettings;
}

export const PesertaManager: React.FC<PesertaManagerProps> = ({ settings }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [nis, setNis] = useState('');
  const [name, setName] = useState('');
  const [className, setClassName] = useState('XII TKJ 1');
  const [room, setRoom] = useState('LAB-01');
  const [sessionGroup, setSessionGroup] = useState('Sesi 1');
  const [password, setPassword] = useState('123');
  const [modalError, setModalError] = useState('');

  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState('');

  const [printClassModalOpen, setPrintClassModalOpen] = useState(false);
  const [printingTarget, setPrintingTarget] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<StudentsResponse>('/api/admin/students');
      setStudents(data.students);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data peserta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
    const ws = createCbtWebSocket((event) => {
      if (event === 'sync:students') {
        loadStudents();
      }
    });
    return () => ws.close();
  }, [loadStudents]);

  const classes = useMemo(
    () =>
      Array.from(new Set(students.map((s) => s.className.trim() || 'Tanpa Kelas'))).sort((a, b) =>
        a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' })
      ),
    [students]
  );

  const classGroups = useMemo(() => {
    const map = new Map<string, Student[]>();
    students.forEach((stu) => {
      const cls = stu.className.trim() || 'Tanpa Kelas';
      const existing = map.get(cls);
      if (existing) {
        existing.push(stu);
      } else {
        map.set(cls, [stu]);
      }
    });
    return classes.map((cls) => {
      const list = map.get(cls) || [];
      const rooms = Array.from(new Set(list.map((s) => s.room).filter(Boolean))).sort();
      return {
        className: cls,
        students: list,
        rooms,
        pages: Math.max(1, Math.ceil(list.length / 10)),
      };
    });
  }, [students, classes]);

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        const cls = s.className.trim() || 'Tanpa Kelas';
        const matchClass = classFilter === 'ALL' || cls === classFilter;
        const q = search.toLowerCase();
        const matchSearch =
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.nis.toLowerCase().includes(q) ||
          s.room.toLowerCase().includes(q);
        return matchClass && matchSearch;
      }),
    [students, classFilter, search]
  );

  const handlePrintFiltered = async () => {
    if (filtered.length === 0) {
      setError('Tidak ada data peserta yang sesuai filter untuk dicetak kartu QR.');
      return;
    }
    setError('');
    setNotice('');
    setPrintingTarget('FILTERED');
    try {
      const targetClass = classFilter !== 'ALL' ? classFilter : undefined;
      await generateParticipantCardsPDF(filtered, settings, targetClass ? { className: targetClass } : undefined);
      setNotice(
        targetClass
          ? `Kartu peserta kelas ${targetClass} (${filtered.length} peserta) berhasil diunduh.`
          : `Kartu peserta (${filtered.length} peserta) berhasil diunduh.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat file PDF kartu peserta.');
    } finally {
      setPrintingTarget(null);
    }
  };

  const handlePrintSingleClass = async (cls: string, classStudents: Student[]) => {
    if (classStudents.length === 0) {
      setError(`Tidak ada peserta pada kelas ${cls}.`);
      return;
    }
    setError('');
    setNotice('');
    setPrintingTarget(cls);
    try {
      await generateParticipantCardsPDF(classStudents, settings, { className: cls });
      setNotice(`Kartu peserta kelas ${cls} (${classStudents.length} peserta) berhasil diunduh.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Gagal mencetak kartu kelas ${cls}.`);
    } finally {
      setPrintingTarget(null);
    }
  };

  const handlePrintAllGroupedByClass = async () => {
    if (students.length === 0) {
      setError('Belum ada data peserta untuk dicetak.');
      return;
    }
    setError('');
    setNotice('');
    setPrintingTarget('ALL_BY_CLASS');
    try {
      await generateParticipantCardsPDF(students, settings, { groupByClass: true });
      setNotice(
        `Kartu peserta semua kelas (${classes.length} kelas · ${students.length} peserta) berhasil diunduh terpisah per halaman kelas.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencetak kartu peserta per kelas.');
    } finally {
      setPrintingTarget(null);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    try {
      const res = await apiFetch<{ student: Student }>('/api/admin/students', {
        method: 'POST',
        body: JSON.stringify({ nis, name, className, room, sessionGroup, password }),
      });
      setStudents((prev) => [...prev, res.student]);
      setModalOpen(false);
      setNis('');
      setName('');
      setNotice(`Peserta ${res.student.name} berhasil ditambahkan.`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Gagal menambah peserta.');
    }
  };

  const handleDeleteStudent = async (id: string) => {
    try {
      await apiFetch(`/api/admin/students/${id}`, { method: 'DELETE' });
      setStudents((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus peserta.');
    }
  };

  const handlePurgeAllStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purgeConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setPurgeError('Ketik kata HAPUS untuk mengonfirmasi.');
      return;
    }
    setPurging(true);
    setPurgeError('');
    try {
      await apiFetch('/api/admin/server/purge', {
        method: 'POST',
        body: JSON.stringify({ targets: ['students'], confirmText: 'HAPUS' }),
      });
      setStudents([]);
      setPurgeModalOpen(false);
      setPurgeConfirmText('');
      setNotice('Seluruh database peserta didik berhasil dikosongkan.');
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : 'Gagal menghapus semua peserta.');
    } finally {
      setPurging(false);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const parsed = await parseStudentExcel(file);
      const valid = parsed.filter((r) => r.issues.length === 0);
      if (valid.length === 0) {
        setError('Tidak ada baris peserta valid pada file Excel (pastikan kolom NIS dan Nama terisi).');
        return;
      }
      const res = await apiFetch<{ added: number; updated: number; students: Student[] }>(
        '/api/admin/students/import',
        {
          method: 'POST',
          body: JSON.stringify({ students: valid }),
        }
      );
      setStudents(res.students);
      setNotice(`Import Excel selesai: ${res.added} peserta baru, ${res.updated} diperbarui.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengimpor file Excel peserta.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manajemen Peserta Ujian</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kelola akun peserta, impor data dari Excel, dan cetak Kartu Peserta Ujian PDF siap potong.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={downloadStudentTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Template Peserta
          </button>
          <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-sm font-semibold cursor-pointer whitespace-nowrap">
            <Upload className="w-4 h-4" />
            Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportExcel} className="hidden" />
          </label>
          <button
            type="button"
            disabled={printingTarget !== null}
            onClick={() => void handlePrintFiltered()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-sm font-semibold text-slate-700 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            {printingTarget === 'FILTERED'
              ? 'Menyiapkan PDF...'
              : classFilter !== 'ALL'
                ? `Cetak Kartu (${classFilter})`
                : 'Cetak Kartu PDF'}
          </button>
          <button
            type="button"
            disabled={students.length === 0 || printingTarget !== null}
            onClick={() => {
              setError('');
              setPrintClassModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-sm font-semibold text-indigo-800 whitespace-nowrap"
          >
            <Layers className="w-4 h-4" />
            Cetak Per Kelas
          </button>
          {students.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPurgeConfirmText('');
                setPurgeError('');
                setPurgeModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-300 bg-red-50 hover:bg-red-600 hover:text-white hover:border-red-600 text-red-700 text-sm font-semibold whitespace-nowrap transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Hapus Semua Peserta
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setModalError('');
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Tambah Peserta
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, NIS, atau ruang..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="ALL">Semua Kelas ({students.length})</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {classFilter !== 'ALL' && filtered.length > 0 && (
              <button
                type="button"
                disabled={printingTarget !== null}
                onClick={() => void handlePrintFiltered()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak Kelas {classFilter} ({filtered.length})
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">No</th>
                <th className="py-3 px-4">NIS / Login</th>
                <th className="py-3 px-4">Nama Peserta</th>
                <th className="py-3 px-4">Kelas</th>
                <th className="py-3 px-4">Ruang</th>
                <th className="py-3 px-4">Sesi</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    Memuat data peserta...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    Tidak ada peserta yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filtered.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 tabular-nums">{s.nis}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{s.name}</td>
                    <td className="py-2.5 px-4 text-slate-600">{s.className}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{s.room}</td>
                    <td className="py-2.5 px-4 text-slate-600">{s.sessionGroup}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{s.password}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteStudent(s.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                        title="Hapus Peserta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-900">Tambah Peserta Ujian</h3>
            <form onSubmit={handleAddStudent} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">NIS / Username</label>
                  <input
                    required
                    value={nis}
                    onChange={(e) => setNis(e.target.value)}
                    placeholder="2026011"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kelas</label>
                  <input
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ruang</label>
                  <input
                    required
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sesi</label>
                  <input
                    required
                    value={sessionGroup}
                    onChange={(e) => setSessionGroup(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              {modalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  Simpan Peserta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {purgeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-red-200 overflow-hidden">
            <div className="px-6 py-4 bg-red-600 text-white">
              <h3 className="text-base font-bold">Hapus Semua Database Peserta Didik</h3>
            </div>
            <form onSubmit={handlePurgeAllStudents} className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Tindakan ini akan menghapus seluruh{' '}
                <strong className="font-mono text-slate-900">{students.length} akun peserta didik</strong>{' '}
                beserta sesi ujian aktif yang terkait secara permanen.
              </p>
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
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm uppercase tracking-wider"
                />
              </div>
              {purgeError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {purgeError}
                </div>
              )}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPurgeModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={purging || purgeConfirmText.trim().toUpperCase() !== 'HAPUS'}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white text-sm font-semibold"
                >
                  {purging ? 'Menghapus...' : 'Ya, Hapus Semua'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {printClassModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">Cetak Kartu Peserta Didik Per Kelas</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih satu kelas untuk mengunduh PDF khusus kelas tersebut, atau cetak semua kelas terpisah otomatis per halaman kelas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintClassModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-indigo-950">
                    Cetak Semua Kelas Sekaligus ({classes.length} Kelas · {students.length} Peserta)
                  </div>
                  <div className="text-xs text-indigo-700 mt-0.5">
                    Setiap kelas dimulai pada halaman A4 baru dengan header nama kelas, QR absensi, dan TTD Kepala Sekolah.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={students.length === 0 || printingTarget !== null}
                  onClick={() => void handlePrintAllGroupedByClass()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {printingTarget === 'ALL_BY_CLASS' ? 'Menyiapkan PDF...' : 'Cetak Semua Per Kelas'}
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-200">
                {classGroups.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Belum ada data kelas yang terdaftar.
                  </div>
                ) : (
                  classGroups.map((group) => (
                    <div
                      key={group.className}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{group.className}</span>
                          <span className="text-xs font-mono font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                            {group.students.length} Peserta
                          </span>
                          <span className="text-xs text-slate-500">
                            ({group.pages} Hal A4)
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Ruang: {group.rooms.join(', ') || '-'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setClassFilter(group.className);
                            setPrintClassModalOpen(false);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                        >
                          Filter Tabel
                        </button>
                        <button
                          type="button"
                          disabled={printingTarget !== null}
                          onClick={() => void handlePrintSingleClass(group.className, group.students)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-semibold"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {printingTarget === group.className ? 'Memproses...' : 'Cetak PDF'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Format: 10 kartu/halaman A4 · Urut abjad nama siswa
              </span>
              <button
                type="button"
                onClick={() => setPrintClassModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
