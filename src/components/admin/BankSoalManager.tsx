import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { BanksResponse, TeacherListItem, TeachersResponse } from '../../lib/api';
import { downloadQuestionTemplate, parseQuestionExcel } from '../../lib/excel';
import type { ParsedExcelQuestion } from '../../lib/excel';
import type { Question, QuestionBank, QuestionType, UserRole } from '../../types/cbt';

interface BankSoalManagerProps {
  userRole?: UserRole;
  teacherNameDefault?: string;
}

export const BankSoalManager: React.FC<BankSoalManagerProps> = ({
  userRole = 'admin',
  teacherNameDefault = '',
}) => {
  const isGuru = userRole === 'guru';
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [teachers, setTeachers] = useState<TeacherListItem[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Create Bank Modal
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [bankCode, setBankCode] = useState('');
  const [bankSubject, setBankSubject] = useState('');
  const [bankGrade, setBankGrade] = useState('XII');
  const [bankTeacherId, setBankTeacherId] = useState('');
  const [bankTeacher, setBankTeacher] = useState(teacherNameDefault);
  const [bankKkm, setBankKkm] = useState(75);
  const [bankPgWeight, setBankPgWeight] = useState(80);
  const [bankModalError, setBankModalError] = useState('');

  // Add/Edit Question Modal
  const [qModalOpen, setQModalOpen] = useState(false);
  const [editingQ, setEditingQ] = useState<Question | null>(null);
  const [qType, setQType] = useState<QuestionType>('PG');
  const [qText, setQText] = useState('');
  const [qOptA, setQOptA] = useState('');
  const [qOptB, setQOptB] = useState('');
  const [qOptC, setQOptC] = useState('');
  const [qOptD, setQOptD] = useState('');
  const [qOptE, setQOptE] = useState('');
  const [qCorrect, setQCorrect] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
  const [qWeight, setQWeight] = useState(10);
  const [qModalError, setQModalError] = useState('');

  // Excel Import Preview Modal
  const [importPreview, setImportPreview] = useState<ParsedExcelQuestion[] | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importModalError, setImportModalError] = useState('');

  const loadBanks = useCallback(async () => {
    setLoading(true);
    try {
      const [data, tRes] = await Promise.all([
        apiFetch<BanksResponse>('/api/admin/banks'),
        !isGuru
          ? apiFetch<TeachersResponse>('/api/admin/teachers').catch(() => ({ teachers: [] }))
          : Promise.resolve({ teachers: [] }),
      ]);
      setBanks(data.banks);
      setTeachers(tRes.teachers);
      if (data.banks.length > 0) {
        setSelectedBankId((prev) =>
          data.banks.some((b) => b.id === prev) ? prev : data.banks[0].id
        );
      } else {
        setSelectedBankId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat bank soal.');
    } finally {
      setLoading(false);
    }
  }, [isGuru]);

  useEffect(() => {
    loadBanks();
    const ws = createCbtWebSocket((event) => {
      if (event === 'sync:banks' || event === 'sync:teachers') {
        loadBanks();
      }
    });
    return () => ws.close();
  }, [loadBanks]);

  const selectedBank = banks.find((b) => b.id === selectedBankId) || null;

  const handleCreateBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankModalError('');
    const clampedKkm = Math.min(100, Math.max(0, Number(bankKkm) || 0));
    const clampedPg = Math.min(100, Math.max(0, Number(bankPgWeight) || 0));
    try {
      const res = await apiFetch<{ bank: QuestionBank }>('/api/admin/banks', {
        method: 'POST',
        body: JSON.stringify({
          code: bankCode,
          subject: bankSubject,
          gradeLevel: bankGrade,
          teacherId: !isGuru && bankTeacherId ? bankTeacherId : undefined,
          teacherName: isGuru ? teacherNameDefault : bankTeacher,
          kkm: clampedKkm,
          pgWeightPercent: clampedPg,
          essayWeightPercent: 100 - clampedPg,
        }),
      });
      setBanks((prev) => [...prev, res.bank]);
      setSelectedBankId(res.bank.id);
      setBankModalOpen(false);
      setBankCode('');
      setBankSubject('');
      setBankTeacherId('');
      setBankTeacher(isGuru ? teacherNameDefault : '');
      setNotice(`Bank soal ${res.bank.code} berhasil dibuat.`);
    } catch (err) {
      setBankModalError(err instanceof Error ? err.message : 'Gagal membuat bank soal.');
    }
  };

  const handleDeleteBank = async (id: string) => {
    try {
      await apiFetch(`/api/admin/banks/${id}`, { method: 'DELETE' });
      const next = banks.filter((b) => b.id !== id);
      setBanks(next);
      setSelectedBankId(next[0]?.id || '');
      setNotice('Bank soal berhasil dihapus.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus bank soal.');
    }
  };

  const openQuestionModal = (q?: Question) => {
    setQModalError('');
    if (q) {
      setEditingQ(q);
      setQType(q.type);
      setQText(q.text);
      setQOptA(q.optionA);
      setQOptB(q.optionB);
      setQOptC(q.optionC);
      setQOptD(q.optionD);
      setQOptE(q.optionE);
      setQCorrect((q.correctAnswer || 'A') as 'A' | 'B' | 'C' | 'D' | 'E');
      setQWeight(q.weight);
    } else {
      setEditingQ(null);
      setQType('PG');
      setQText('');
      setQOptA('');
      setQOptB('');
      setQOptC('');
      setQOptD('');
      setQOptE('');
      setQCorrect('A');
      setQWeight(10);
    }
    setQModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBank) return;
    setQModalError('');
    try {
      const payload = {
        type: qType,
        text: qText,
        optionA: qOptA,
        optionB: qOptB,
        optionC: qOptC,
        optionD: qOptD,
        optionE: qOptE,
        correctAnswer: qType === 'PG' ? qCorrect : '',
        weight: Math.max(1, Number(qWeight) || 1),
      };
      const res = editingQ
        ? await apiFetch<{ bank: QuestionBank }>(
            `/api/admin/banks/${selectedBank.id}/questions/${editingQ.id}`,
            { method: 'PUT', body: JSON.stringify(payload) }
          )
        : await apiFetch<{ bank: QuestionBank }>(`/api/admin/banks/${selectedBank.id}/questions`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setBanks((prev) => prev.map((b) => (b.id === res.bank.id ? res.bank : b)));
      setQModalOpen(false);
      setNotice(editingQ ? 'Butir soal berhasil diperbarui.' : 'Butir soal baru berhasil ditambahkan.');
    } catch (err) {
      setQModalError(err instanceof Error ? err.message : 'Gagal menyimpan soal.');
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!selectedBank) return;
    try {
      const res = await apiFetch<{ bank: QuestionBank }>(
        `/api/admin/banks/${selectedBank.id}/questions/${qId}`,
        { method: 'DELETE' }
      );
      setBanks((prev) => prev.map((b) => (b.id === res.bank.id ? res.bank : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus soal.');
    }
  };

  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setImportModalError('');
    try {
      const parsed = await parseQuestionExcel(file);
      setImportPreview(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca file Excel soal.');
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedBank || !importPreview) return;
    const validRows = importPreview.filter((r) => r.issues.length === 0);
    if (validRows.length === 0) {
      setImportModalError('Tidak ada baris soal yang valid untuk diimpor.');
      return;
    }
    setImportModalError('');
    setImporting(true);
    try {
      const res = await apiFetch<{ importedCount: number; bank: QuestionBank }>(
        `/api/admin/banks/${selectedBank.id}/import`,
        {
          method: 'POST',
          body: JSON.stringify({
            replaceExisting,
            questions: validRows,
          }),
        }
      );
      setBanks((prev) => prev.map((b) => (b.id === res.bank.id ? res.bank : b)));
      setImportPreview(null);
      setNotice(`Berhasil mengimpor ${res.importedCount} soal dari Excel ke bank ${res.bank.code}.`);
    } catch (err) {
      setImportModalError(err instanceof Error ? err.message : 'Gagal mengimpor soal ke server.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bank Soal & Import Excel</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kelola paket soal Pilihan Ganda / Esai atau impor massal menggunakan format Excel CandyCBT.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={downloadQuestionTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            Template Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => {
              setBankModalError('');
              setBankModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Buat Bank Soal
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Bank Soal List */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Daftar Bank Soal ({banks.length})</span>
          </div>

          {loading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : banks.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">Belum ada bank soal.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {banks.map((b) => {
                const active = b.id === selectedBankId;
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBankId(b.id)}
                    className={`p-4 cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                      active ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-teal-700">{b.code}</p>
                      <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{b.subject}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Kelas {b.gradeLevel} · <span className="font-mono">{b.questions.length}</span> Soal · KKM{' '}
                        <span className="font-mono">{b.kkm}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        handleDeleteBank(b.id);
                      }}
                      title="Hapus Bank Soal"
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Bank Detail & Questions */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {selectedBank ? (
            <>
              <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-bold text-teal-700">{selectedBank.code}</span>
                    <span>·</span>
                    <span>{selectedBank.teacherName}</span>
                    <span>·</span>
                    <span>
                      Bobot PG {selectedBank.pgWeightPercent}% / Esai {selectedBank.essayWeightPercent}%
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-0.5">{selectedBank.subject}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700 text-teal-800 bg-teal-50 hover:bg-teal-100 text-sm font-semibold cursor-pointer whitespace-nowrap">
                    <Upload className="w-4 h-4" />
                    Import Soal Excel
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleExcelFileSelected}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => openQuestionModal()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    Tambah Soal
                  </button>
                </div>
              </div>

              {selectedBank.questions.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-base font-semibold text-slate-900">Bank Soal Masih Kosong</p>
                  <p className="text-sm text-slate-500 max-w-md mx-auto">
                    Unduh template Excel CandyCBT lalu unggah file .xlsx Anda untuk mengimpor puluhan soal sekaligus.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {selectedBank.questions.map((q) => (
                    <div key={q.id} className="p-5 space-y-3 hover:bg-slate-50/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2.5 text-xs">
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-bold tabular-nums">
                            #{q.number}
                          </span>
                          <span className="font-semibold text-teal-700">
                            {q.type === 'PG' ? 'Pilihan Ganda' : 'Esai / Uraian'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-slate-600 tabular-nums">Bobot {q.weight}</span>
                          {q.type === 'PG' && (
                            <>
                              <span className="text-slate-400">·</span>
                              <span className="font-mono font-bold text-emerald-700">
                                Kunci: {q.correctAnswer}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openQuestionModal(q)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
                            title="Edit Soal"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                            title="Hapus Soal"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-line">{q.text}</p>

                      {q.type === 'PG' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-600 pt-1">
                          {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => {
                            const txt =
                              k === 'A'
                                ? q.optionA
                                : k === 'B'
                                  ? q.optionB
                                  : k === 'C'
                                    ? q.optionC
                                    : k === 'D'
                                      ? q.optionD
                                      : q.optionE;
                            if (!txt) return null;
                            const isKey = q.correctAnswer === k;
                            return (
                              <div
                                key={k}
                                className={`px-2.5 py-1.5 rounded border ${
                                  isKey
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                                    : 'border-slate-200 bg-white'
                                }`}
                              >
                                <span className="font-mono font-bold mr-1.5">{k}.</span>
                                {txt}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="p-12 text-center text-slate-500 text-sm">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              Pilih Bank Soal di sebelah kiri untuk melihat atau mengimpor butir soal.
            </div>
          )}
        </div>
      </div>

      {/* Create Bank Modal */}
      {bankModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold text-slate-900">Buat Bank Soal Baru</h3>
            <form onSubmit={handleCreateBank} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kode Bank</label>
                  <input
                    required
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value.toUpperCase())}
                    placeholder="FIS-PAS-XII"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tingkat / Kelas</label>
                  <input
                    required
                    value={bankGrade}
                    onChange={(e) => setBankGrade(e.target.value)}
                    placeholder="XII"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mata Pelajaran</label>
                <input
                  required
                  value={bankSubject}
                  onChange={(e) => setBankSubject(e.target.value)}
                  placeholder="Fisika Terapan"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              {!isGuru && teachers.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pilih Akun Guru Pengampu (Tersinkron ke Panel Guru)
                  </label>
                  <select
                    value={bankTeacherId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setBankTeacherId(id);
                      const picked = teachers.find((t) => t.id === id);
                      if (picked) {
                        setBankTeacher(picked.fullName);
                        if (!bankSubject.trim()) setBankSubject(picked.subject);
                      } else {
                        setBankTeacher('');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">-- Isi Nama Guru Manual --</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName} ({t.subject})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Guru Pengampu</label>
                <input
                  required
                  disabled={isGuru}
                  value={isGuru ? teacherNameDefault : bankTeacher}
                  onChange={(e) => setBankTeacher(e.target.value)}
                  placeholder="Drs. Hendro Wijaya"
                  className={`w-full px-3 py-2 rounded-lg border border-slate-300 text-sm ${
                    isGuru ? 'bg-slate-100 text-slate-600' : ''
                  }`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nilai KKM</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={bankKkm}
                    onChange={(e) =>
                      setBankKkm(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot PG (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={bankPgWeight}
                    onChange={(e) =>
                      setBankPgWeight(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
              </div>
              {bankModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {bankModalError}
                </div>
              )}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setBankModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  Simpan Bank Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Question Modal */}
      {qModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 p-6 my-8">
            <h3 className="text-lg font-bold text-slate-900">
              {editingQ ? `Edit Butir Soal #${editingQ.number}` : 'Tambah Butir Soal Baru'}
            </h3>
            <form onSubmit={handleSaveQuestion} className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Jenis Soal</label>
                  <select
                    value={qType}
                    onChange={(e) => setQType(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="PG">Pilihan Ganda (PG)</option>
                    <option value="ESAI">Esai / Uraian</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot Nilai</label>
                  <input
                    type="number"
                    min={1}
                    value={qWeight}
                    onChange={(e) => setQWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm"
                  />
                </div>
                {qType === 'PG' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Kunci Jawaban</label>
                    <select
                      value={qCorrect}
                      onChange={(e) => setQCorrect(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm bg-white"
                    >
                      {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => (
                        <option key={k} value={k}>
                          Pilihan {k}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Teks Pertanyaan</label>
                <textarea
                  required
                  rows={4}
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              {qType === 'PG' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pilihan A</label>
                    <input
                      required
                      value={qOptA}
                      onChange={(e) => setQOptA(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pilihan B</label>
                    <input
                      required
                      value={qOptB}
                      onChange={(e) => setQOptB(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pilihan C</label>
                    <input
                      value={qOptC}
                      onChange={(e) => setQOptC(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pilihan D</label>
                    <input
                      value={qOptD}
                      onChange={(e) => setQOptD(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pilihan E (Opsional)</label>
                    <input
                      value={qOptE}
                      onChange={(e) => setQOptE(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>
              )}

              {qModalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {qModalError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setQModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  Simpan Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Import Preview Modal */}
      {importPreview && selectedBank && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-5xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Pratinjau Import Soal Excel</h3>
                <p className="text-xs text-slate-300">
                  Target Bank: {selectedBank.code} ({selectedBank.subject}) · Total {importPreview.length} baris terbaca
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="rounded"
                />
                Ganti seluruh soal lama
              </label>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="p-2.5 font-semibold">Baris</th>
                    <th className="p-2.5 font-semibold">Jenis</th>
                    <th className="p-2.5 font-semibold">Pertanyaan</th>
                    <th className="p-2.5 font-semibold">Kunci</th>
                    <th className="p-2.5 font-semibold">Bobot</th>
                    <th className="p-2.5 font-semibold">Validasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {importPreview.map((row, idx) => (
                    <tr key={idx} className={row.issues.length > 0 ? 'bg-red-50/70' : ''}>
                      <td className="p-2.5 font-mono tabular-nums">{row.rowNumber}</td>
                      <td className="p-2.5 font-semibold">{row.type}</td>
                      <td className="p-2.5 max-w-md truncate">{row.text}</td>
                      <td className="p-2.5 font-mono font-bold">{row.correctAnswer || '-'}</td>
                      <td className="p-2.5 font-mono tabular-nums">{row.weight}</td>
                      <td className="p-2.5">
                        {row.issues.length === 0 ? (
                          <span className="text-emerald-700 font-semibold">Siap Impor</span>
                        ) : (
                          <span className="text-red-700 font-semibold">{row.issues.join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importModalError && (
              <div className="mx-6 mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                {importModalError}
              </div>
            )}

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Baris valid:{' '}
                <strong className="font-mono text-emerald-700">
                  {importPreview.filter((r) => r.issues.length === 0).length}
                </strong>{' '}
                / {importPreview.length}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 bg-white"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleConfirmImport}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  {importing ? 'Mengimpor...' : 'Simpan ke Bank Soal'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
