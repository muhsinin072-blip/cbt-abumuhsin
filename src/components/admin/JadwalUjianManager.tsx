import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { BanksResponse, ExamsResponse } from '../../lib/api';
import type { ExamSchedule, QuestionBank } from '../../types/cbt';

export const JadwalUjianManager: React.FC = () => {
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [bankId, setBankId] = useState('');
  const [classesText, setClassesText] = useState('XII TKJ 1, XII TKJ 2, XII RPL 1');
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);
  const [showScoreAfterFinish, setShowScoreAfterFinish] = useState(true);
  const [antiCheatEnabled, setAntiCheatEnabled] = useState(true);
  const [maxViolations, setMaxViolations] = useState(3);
  const [modalError, setModalError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [exRes, bkRes] = await Promise.all([
        apiFetch<ExamsResponse>('/api/admin/exams'),
        apiFetch<BanksResponse>('/api/admin/banks'),
      ]);
      setExams(exRes.exams);
      setBanks(bkRes.banks);
      setBankId((prev) =>
        prev && bkRes.banks.some((b) => b.id === prev) ? prev : bkRes.banks[0]?.id || ''
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat jadwal ujian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const ws = createCbtWebSocket((event, payload) => {
      if (event === 'sync:exams' || event === 'sync:banks') {
        loadData();
      } else if (event === 'token:rotated' && payload) {
        const { examId, token, tokenUpdatedAt } = payload as {
          examId: string;
          token: string;
          tokenUpdatedAt: string;
        };
        setExams((prev) =>
          prev.map((e) => (e.id === examId ? { ...e, token, tokenUpdatedAt } : e))
        );
      }
    });
    return () => ws.close();
  }, [loadData]);

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    if (!bankId) {
      setModalError('Pilih Bank Soal terlebih dahulu sebelum menyimpan jadwal.');
      return;
    }
    try {
      const targetClasses = classesText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const res = await apiFetch<{ exam: ExamSchedule }>('/api/admin/exams', {
        method: 'POST',
        body: JSON.stringify({
          title,
          bankId,
          targetClasses,
          durationMinutes: Number(durationMinutes),
          randomizeQuestions,
          randomizeOptions,
          showScoreAfterFinish,
          antiCheatEnabled,
          maxViolations: Number(maxViolations),
        }),
      });
      setExams((prev) => [res.exam, ...prev]);
      setModalOpen(false);
      setTitle('');
      setNotice(`Jadwal ujian "${res.exam.title}" dibuat dengan Token ${res.exam.token}.`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Gagal membuat jadwal ujian.');
    }
  };

  const handleRotateToken = async (examId: string) => {
    try {
      const res = await apiFetch<{ exam: ExamSchedule }>(`/api/admin/exams/${examId}/rotate-token`, {
        method: 'POST',
      });
      setExams((prev) => prev.map((e) => (e.id === res.exam.id ? res.exam : e)));
      setNotice(`Token ujian diperbarui menjadi ${res.exam.token}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal merilis token baru.');
    }
  };

  const handleToggleActive = async (exam: ExamSchedule) => {
    try {
      const res = await apiFetch<{ exam: ExamSchedule }>(`/api/admin/exams/${exam.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !exam.isActive }),
      });
      setExams((prev) => prev.map((e) => (e.id === res.exam.id ? res.exam : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status ujian.');
    }
  };

  const handleDeleteExam = async (examId: string) => {
    try {
      await apiFetch(`/api/admin/exams/${examId}`, { method: 'DELETE' });
      setExams((prev) => prev.filter((e) => e.id !== examId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus jadwal ujian.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Jadwal Ujian & Token Sesi</h1>
          <p className="text-sm text-slate-500 mt-1">
            Atur jadwal pelaksanaan ujian, token masuk peserta, pengacakan soal, dan batas pelanggaran anti-kecurangan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalError('');
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Buat Jadwal Ujian
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

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((n) => (
            <div key={n} className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          Belum ada jadwal ujian dibuat.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {exams.map((ex) => (
            <div
              key={ex.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      {ex.subject} · {ex.durationMinutes} Menit
                    </p>
                    <h2 className="text-lg font-bold text-slate-900 mt-0.5">{ex.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(ex)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 ${
                      ex.isActive
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {ex.isActive ? 'Aktif' : 'Nonaktif'}
                  </button>
                </div>

                <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Token Ujian Aktif</p>
                    <p className="font-mono text-2xl font-bold tracking-widest text-teal-800 tabular-nums mt-0.5">
                      {ex.token}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRotateToken(ex.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rilis Token Baru
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    Kelas: <span className="font-semibold text-slate-900">{ex.targetClasses.join(', ') || 'Semua'}</span>
                  </div>
                  <div className="inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                    Anti-Cheat: {ex.antiCheatEnabled ? `Maks ${ex.maxViolations}x` : 'Nonaktif'}
                  </div>
                  <div>Acak Soal: {ex.randomizeQuestions ? 'Ya' : 'Tidak'}</div>
                  <div>Acak Opsi: {ex.randomizeOptions ? 'Ya' : 'Tidak'}</div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5" />
                  Update token: {new Date(ex.tokenUpdatedAt).toLocaleTimeString('id-ID')}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteExam(ex.id)}
                  className="inline-flex items-center gap-1 text-red-600 hover:underline font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-900">Buat Jadwal Ujian Baru</h3>
            <form onSubmit={handleCreateExam} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Judul Ujian</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Penilaian Akhir Semester — Bahasa Indonesia"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Pilih Bank Soal</label>
                {banks.length === 0 ? (
                  <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
                    Belum ada Bank Soal tersedia. Silakan buat Bank Soal terlebih dahulu.
                  </p>
                ) : (
                  <select
                    required
                    value={bankId}
                    onChange={(e) => setBankId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.subject} ({b.questions.length} Soal)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kelas Sasaran (pisahkan dengan koma)
                </label>
                <input
                  value={classesText}
                  onChange={(e) => setClassesText(e.target.value)}
                  placeholder="XII TKJ 1, XII TKJ 2"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    min={5}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Batas Pelanggaran Blokir
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxViolations}
                    onChange={(e) => setMaxViolations(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={randomizeQuestions}
                    onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  />
                  Acak Urutan Soal
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={randomizeOptions}
                    onChange={(e) => setRandomizeOptions(e.target.checked)}
                  />
                  Acak Pilihan A–E
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showScoreAfterFinish}
                    onChange={(e) => setShowScoreAfterFinish(e.target.checked)}
                  />
                  Tampilkan Nilai Selesai
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={antiCheatEnabled}
                    onChange={(e) => setAntiCheatEnabled(e.target.checked)}
                  />
                  Aktifkan Anti-Kecurangan
                </label>
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={banks.length === 0}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-sm font-semibold"
                >
                  Simpan & Terbitkan Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
