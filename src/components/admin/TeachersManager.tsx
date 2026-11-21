import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  GraduationCap,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserX,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { TeacherListItem, TeachersResponse } from '../../lib/api';

export const TeachersManager: React.FC = () => {
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherListItem | null>(null);
  const [nip, setNip] = useState('');
  const [fullName, setFullName] = useState('');
  const [subject, setSubject] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadTeachers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<TeachersResponse>('/api/admin/teachers');
      setTeachers(res.teachers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar guru.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeachers();
    const ws = createCbtWebSocket((event) => {
      if (event === 'sync:teachers' || event === 'sync:banks' || event === 'sync:exams') {
        loadTeachers();
      }
    });
    return () => ws.close();
  }, [loadTeachers]);

  const openModal = (teacher?: TeacherListItem) => {
    setError('');
    setModalError('');
    if (teacher) {
      setEditingTeacher(teacher);
      setNip(teacher.nip);
      setFullName(teacher.fullName);
      setSubject(teacher.subject);
      setPassword('');
      setIsActive(teacher.isActive);
    } else {
      setEditingTeacher(null);
      setNip('');
      setFullName('');
      setSubject('');
      setPassword('guru123');
      setIsActive(true);
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSaving(true);
    try {
      if (editingTeacher) {
        await apiFetch(`/api/admin/teachers/${editingTeacher.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nip: nip.trim(),
            fullName: fullName.trim(),
            subject: subject.trim(),
            isActive,
            password: password.trim() || undefined,
          }),
        });
        setNotice(`Akun guru "${fullName.trim()}" berhasil diperbarui dan disinkronkan.`);
      } else {
        await apiFetch('/api/admin/teachers', {
          method: 'POST',
          body: JSON.stringify({
            nip: nip.trim(),
            fullName: fullName.trim(),
            subject: subject.trim(),
            password: password.trim(),
            isActive,
          }),
        });
        setNotice(`Akun guru "${fullName.trim()}" (${nip.trim()}) berhasil ditambahkan.`);
      }
      setModalOpen(false);
      loadTeachers();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Gagal menyimpan akun guru.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (teacher: TeacherListItem) => {
    setError('');
    try {
      await apiFetch(`/api/admin/teachers/${teacher.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !teacher.isActive }),
      });
      setNotice(
        `Status akses guru ${teacher.fullName} diubah menjadi ${
          !teacher.isActive ? 'Aktif' : 'Nonaktif'
        }.`
      );
      loadTeachers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status akses guru.');
    }
  };

  const handleDelete = async (teacher: TeacherListItem) => {
    setError('');
    try {
      await apiFetch(`/api/admin/teachers/${teacher.id}`, { method: 'DELETE' });
      setNotice(`Akun guru ${teacher.fullName} dihapus.`);
      loadTeachers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus akun guru.');
    }
  };

  const filtered = teachers.filter((t) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      t.fullName.toLowerCase().includes(q) ||
      t.nip.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data Guru & Akses Panel Guru</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kelola akun login Guru pengampu mata pelajaran. Bank soal, jadwal, koreksi esai, dan absensi QR Guru terhubung langsung dengan panel Proktor.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Tambah Akun Guru
        </button>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Akun Guru</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {teachers.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Akses Guru Aktif</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {teachers.filter((t) => t.isActive).length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Bank Soal Terhubung</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
            {teachers.reduce((sum, t) => sum + t.banksCount, 0)}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama guru, NIP, atau mapel..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <span className="text-xs text-slate-500">
            Menampilkan <strong className="font-mono">{filtered.length}</strong> akun guru
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">No</th>
                <th className="py-3 px-4">NIP / Username Login</th>
                <th className="py-3 px-4">Nama Lengkap Guru</th>
                <th className="py-3 px-4">Mata Pelajaran</th>
                <th className="py-3 px-4 text-center">Bank Soal</th>
                <th className="py-3 px-4 text-center">Jadwal Ujian</th>
                <th className="py-3 px-4 text-center">Status Akses</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    Memuat data guru...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    Tidak ada akun guru yang sesuai.
                  </td>
                </tr>
              ) : (
                filtered.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-teal-800">{t.nip}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-slate-400 shrink-0" />
                        {t.fullName}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{t.subject}</td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-800">
                      {t.banksCount}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-800">
                      {t.examsCount}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border whitespace-nowrap ${
                          t.isActive
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {t.isActive ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Aktif
                          </>
                        ) : (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            Nonaktif
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => openModal(t)}
                        title="Edit / Reset Password Guru"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        title="Hapus Akun Guru"
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded align-middle"
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
            <h3 className="text-lg font-bold text-slate-900">
              {editingTeacher ? 'Edit Akun & Password Guru' : 'Tambah Akun Guru Baru'}
            </h3>
            <form onSubmit={handleSave} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NIP / Username Login Guru
                </label>
                <input
                  required
                  value={nip}
                  onChange={(e) => setNip(e.target.value)}
                  placeholder="Contoh: guru4 atau 198801012015031002"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Lengkap & Gelar
                </label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Drs. Hendra Gunawan, M.Pd."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
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
                  placeholder="Contoh: Fisika Terapan"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                    {editingTeacher
                      ? 'Password Baru (kosongkan jika tidak diubah)'
                      : 'Password Login (min. 6 karakter)'}
                  </span>
                </label>
                <input
                  type="text"
                  required={!editingTeacher}
                  minLength={editingTeacher ? undefined : 6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingTeacher ? 'Kosongkan jika tetap' : 'Minimal 6 karakter'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Aktifkan akses login guru ini
              </label>

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
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-400 text-white text-sm font-semibold"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Akun Guru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
