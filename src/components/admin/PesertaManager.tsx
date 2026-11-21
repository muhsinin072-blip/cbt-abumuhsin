import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus, Printer, Search, Trash2, Upload } from 'lucide-react';
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
    () => Array.from(new Set(students.map((s) => s.className))).sort(),
    [students]
  );

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        const matchClass = classFilter === 'ALL' || s.className === classFilter;
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
            onClick={() => {
              if (filtered.length === 0) {
                setError('Tidak ada data peserta yang sesuai filter untuk dicetak kartu QR.');
                return;
              }
              setError('');
              void generateParticipantCardsPDF(filtered, settings);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            Cetak Kartu PDF
          </button>
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

          <div className="flex items-center gap-2">
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
    </div>
  );
};
