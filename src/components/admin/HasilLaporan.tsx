import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { AdminResultsResponse, EnrichedResultSession, PurgeDatabaseResponse } from '../../lib/api';
import { exportResultsCSV } from '../../lib/csv';
import { exportResultsExcel } from '../../lib/excel';
import {
  generateBeritaAcaraPDF,
  generateResultsPDF,
  generateViolationsPDF,
} from '../../lib/pdf';
import type { UserRole } from '../../types/cbt';
import { ScoreDistributionChart } from './ScoreDistributionChart';

interface HasilLaporanProps {
  userRole?: UserRole;
}

export const HasilLaporan: React.FC<HasilLaporanProps> = ({ userRole = 'admin' }) => {
  const isGuru = userRole === 'guru';
  const [data, setData] = useState<AdminResultsResponse | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Essay grading modal
  const [gradingSession, setGradingSession] = useState<EnrichedResultSession | null>(null);
  const [essayScores, setEssayScores] = useState<Record<string, number>>({});
  const [savingEssay, setSavingEssay] = useState(false);
  const [essayModalError, setEssayModalError] = useState('');

  // Purge answers modal (Admin only)
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState('');

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminResultsResponse>('/api/admin/results');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat hasil ujian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResults();
    const ws = createCbtWebSocket((event) => {
      if (
        event === 'sync:results' ||
        event === 'session:updated' ||
        event === 'sync:settings' ||
        event === 'violation:logged'
      ) {
        loadResults();
      }
    });
    return () => ws.close();
  }, [loadResults]);

  const filteredResults = useMemo(() => {
    if (!data) return [];
    return selectedExamId === 'ALL'
      ? data.results
      : data.results.filter((r) => r.examId === selectedExamId);
  }, [data, selectedExamId]);

  const selectedExam = useMemo(
    () => data?.exams.find((e) => e.id === selectedExamId),
    [data, selectedExamId]
  );

  const stats = useMemo(() => {
    if (filteredResults.length === 0) {
      return { avg: '0.0', max: '0.0', min: '0.0', passed: 0 };
    }
    const scores = filteredResults.map((r) => r.finalScore);
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    const max = Math.max(...scores).toFixed(1);
    const min = Math.min(...scores).toFixed(1);
    const passed = filteredResults.filter((r) => r.finalScore >= r.kkm).length;
    return { avg, max, min, passed };
  }, [filteredResults]);

  const openEssayModal = (session: EnrichedResultSession) => {
    setEssayModalError('');
    const initial: Record<string, number> = {};
    session.essayItems.forEach((item) => {
      initial[item.questionId] = item.essayScore;
    });
    setEssayScores(initial);
    setGradingSession(session);
  };

  const handleSaveEssay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gradingSession) return;
    setEssayModalError('');
    setSavingEssay(true);
    try {
      await apiFetch(`/api/admin/results/${gradingSession.id}/grade-essay`, {
        method: 'POST',
        body: JSON.stringify({ scores: essayScores }),
      });
      setGradingSession(null);
      setNotice(`Nilai esai untuk ${gradingSession.studentName} berhasil diperbarui.`);
      loadResults();
    } catch (err) {
      setEssayModalError(err instanceof Error ? err.message : 'Gagal menyimpan koreksi esai.');
    } finally {
      setSavingEssay(false);
    }
  };

  const handlePurgeAnswers = async (e: React.FormEvent) => {
    e.preventDefault();
    setPurgeError('');
    if (purgeConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setPurgeError('Ketik HAPUS dengan benar untuk melanjutkan penghapusan.');
      return;
    }
    setPurging(true);
    try {
      const res = await apiFetch<PurgeDatabaseResponse>('/api/admin/server/purge', {
        method: 'POST',
        body: JSON.stringify({
          targets: ['answers'],
          confirmText: purgeConfirmText.trim().toUpperCase(),
        }),
      });
      setPurgeOpen(false);
      setPurgeConfirmText('');
      setNotice(res.message || 'Seluruh jawaban soal, nilai, dan log ujian berhasil dihapus.');
      void loadResults();
    } catch (err) {
      setPurgeError(err instanceof Error ? err.message : 'Gagal menghapus database jawaban & nilai.');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hasil Ujian & Laporan PDF Instan</h1>
          <p className="text-sm text-slate-500 mt-1">
            Analisis nilai otomatis, koreksi jawaban esai, dan cetak laporan resmi sekolah dalam format PDF maupun Excel.
          </p>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => generateResultsPDF(filteredResults, data.settings, selectedExam)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
            >
              <FileText className="w-4 h-4" />
              Laporan Nilai PDF
            </button>
            <button
              type="button"
              onClick={() => generateViolationsPDF(data.violations, data.settings)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 text-red-800 text-sm font-semibold whitespace-nowrap"
            >
              <ShieldAlert className="w-4 h-4" />
              Audit Kecurangan PDF
            </button>
            <button
              type="button"
              onClick={() => {
                const targetExam = selectedExam || data.exams[0];
                if (!targetExam) {
                  setError('Belum ada jadwal ujian untuk dicetak Berita Acara.');
                  return;
                }
                const examResults = data.results.filter((r) => r.examId === targetExam.id);
                generateBeritaAcaraPDF(
                  targetExam,
                  examResults,
                  examResults.length,
                  data.settings
                );
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold whitespace-nowrap"
            >
              <FileText className="w-4 h-4" />
              Berita Acara PDF
            </button>
            <button
              type="button"
              onClick={() => exportResultsExcel(filteredResults)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => {
                const slug = selectedExam
                  ? selectedExam.subject.replace(/\s+/g, '_')
                  : 'Semua_Mapel';
                const count = exportResultsCSV(
                  filteredResults,
                  `Rekap_Nilai_${slug}_${new Date().toISOString().slice(0, 10)}.csv`
                );
                setNotice(`Berhasil mengekspor ${count} baris nilai ujian ke CSV.`);
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-sm font-semibold whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            {!isGuru && (data.results.length > 0 || data.violations.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setPurgeConfirmText('');
                  setPurgeError('');
                  setPurgeOpen(true);
                }}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-300 bg-red-50 hover:bg-red-600 hover:text-white hover:border-red-600 text-red-700 text-sm font-semibold whitespace-nowrap transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Hapus Semua Jawaban &amp; Nilai
              </button>
            )}
          </div>
        )}
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

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Rata-rata Nilai</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">{stats.avg}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Nilai Tertinggi</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">{stats.max}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Nilai Terendah</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">{stats.min}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Tuntas KKM</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
            {stats.passed}/{filteredResults.length}
          </p>
        </div>
      </div>

      {/* Recharts Visual Distribution & Class Comparison */}
      {data && (
        <ScoreDistributionChart
          exams={data.exams}
          sessions={data.results}
          selectedExamId={selectedExamId}
          onExamChange={(nextExamId) => setSelectedExamId(nextExamId)}
          title="Grafik Distribusi Nilai & Ketuntasan KKM"
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Rekapitulasi Nilai Peserta</h2>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="ALL">Semua Jadwal Ujian</option>
            {data?.exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.subject} — {ex.title}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">No</th>
                <th className="py-3 px-4">NIS</th>
                <th className="py-3 px-4">Nama Peserta</th>
                <th className="py-3 px-4">Kelas</th>
                <th className="py-3 px-4">Mata Pelajaran</th>
                <th className="py-3 px-4 text-center">Benar PG</th>
                <th className="py-3 px-4 text-right">PG</th>
                <th className="py-3 px-4 text-right">Esai</th>
                <th className="py-3 px-4 text-right">Nilai Akhir</th>
                <th className="py-3 px-4 text-center">Status KKM</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    Memuat data nilai...
                  </td>
                </tr>
              ) : filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500">
                    Belum ada hasil ujian pada filter ini.
                  </td>
                </tr>
              ) : (
                filteredResults.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">{r.studentNis}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{r.studentName}</td>
                    <td className="py-3 px-4 text-slate-600">{r.className}</td>
                    <td className="py-3 px-4 text-slate-600">{r.subject}</td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums">
                      {r.pgCorrect}/{r.pgTotal}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.pgScore.toFixed(1)}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.essayScore.toFixed(1)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {r.finalScore.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 text-center text-xs font-semibold">
                      {r.finalScore >= r.kkm ? (
                        <span className="text-emerald-700">TUNTAS</span>
                      ) : (
                        <span className="text-amber-700">REMEDIAL</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {r.essayItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openEssayModal(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 whitespace-nowrap"
                        >
                          <Pencil className="w-3 h-3" />
                          Koreksi Esai
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Koreksi Esai Modal */}
      {gradingSession && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[88vh] flex flex-col">
            <div className="px-6 py-4 bg-slate-900 text-white">
              <h3 className="text-base font-bold">Koreksi Jawaban Esai — {gradingSession.studentName}</h3>
              <p className="text-xs text-slate-300">
                {gradingSession.subject} · Skor PG: {gradingSession.pgScore.toFixed(1)}
              </p>
            </div>
            <form onSubmit={handleSaveEssay} className="flex-1 overflow-y-auto p-6 space-y-5">
              {gradingSession.essayItems.map((item) => (
                <div key={item.questionId} className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <p className="text-xs font-bold text-teal-700">Soal Esai #{item.number}</p>
                  <p className="text-sm font-medium text-slate-900">{item.questionText}</p>
                  <div className="p-3 rounded bg-white border border-slate-200 text-sm text-slate-800 whitespace-pre-line">
                    {item.studentAnswer || '(Peserta tidak mengisi jawaban)'}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <label className="text-xs font-semibold text-slate-700">Skor Esai (0 – 100):</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={essayScores[item.questionId] ?? 0}
                      onChange={(e) =>
                        setEssayScores((prev) => ({
                          ...prev,
                          [item.questionId]: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-sm text-right bg-white"
                    />
                  </div>
                </div>
              ))}
              {essayModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {essayModalError}
                </div>
              )}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setGradingSession(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEssay}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  {savingEssay ? 'Menghitung...' : 'Simpan & Hitung Nilai Akhir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purge All Answers Modal */}
      {purgeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-red-200 overflow-hidden">
            <div className="px-6 py-4 bg-red-600 text-white">
              <h3 className="text-base font-bold">Hapus Semua Jawaban Soal, Nilai &amp; Log</h3>
            </div>
            <form onSubmit={handlePurgeAnswers} className="p-6 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Seluruh data jawaban peserta, nilai PG &amp; Esai, sesi ujian aktif, serta log pelanggaran kecurangan akan dikosongkan permanen. Data siswa, mapel, dan jadwal ujian tetap dipertahankan.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Ketik <span className="font-mono font-bold text-red-700">HAPUS</span> untuk konfirmasi:
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
                  onClick={() => setPurgeOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
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
