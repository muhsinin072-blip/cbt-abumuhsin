import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  KeyRound,
  Lock,
  LogOut,
  NotebookPen,
  Paperclip,
  Play,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type {
  StartExamResponse,
  StudentExamListItem,
  StudentMaterialsResponse,
} from '../../lib/api';
import type { AuthUser, BroadcastNotice, LearningMaterial } from '../../types/cbt';
import { LiveClockDate } from '../LiveClockDate';
import { ExamRoom } from './ExamRoom';

interface StudentDashboardProps {
  user: AuthUser;
  schoolName: string;
  schoolLogo?: string;
  onLogout: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  schoolName,
  schoolLogo,
  onLogout,
}) => {
  const [exams, setExams] = useState<StudentExamListItem[]>([]);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [activeSection, setActiveSection] = useState<'exams' | 'materials'>('exams');
  const [selectedMaterial, setSelectedMaterial] = useState<LearningMaterial | null>(null);
  const [broadcasts, setBroadcasts] = useState<BroadcastNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedExam, setSelectedExam] = useState<StudentExamListItem | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [agreedRules, setAgreedRules] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [activeExamData, setActiveExamData] = useState<StartExamResponse | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [myQrUrl, setMyQrUrl] = useState('');

  const handleOpenMyQr = async () => {
    setQrModalOpen(true);
    if (!myQrUrl) {
      const url = await QRCode.toDataURL(`CANDYCBT|STU|${user.identifier}`, {
        width: 240,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setMyQrUrl(url);
    }
  };

  const loadExams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [examRes, matRes] = await Promise.all([
        apiFetch<{
          exams: StudentExamListItem[];
          broadcasts: BroadcastNotice[];
        }>('/api/student/exams'),
        apiFetch<StudentMaterialsResponse>('/api/student/materials').catch(() => ({
          materials: [],
        })),
      ]);
      setExams(examRes.exams);
      setBroadcasts(examRes.broadcasts || []);
      setMaterials(matRes.materials || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
    const ws = createCbtWebSocket((event, payload) => {
      if (event === 'exams:updated' || event === 'materials:updated' || event === 'admin:command') {
        loadExams();
      } else if (event === 'admin:broadcast' && payload) {
        const noticeItem = payload as BroadcastNotice;
        setBroadcasts((prev) => [noticeItem, ...prev.slice(0, 4)]);
      }
    });
    return () => ws.close();
  }, [loadExams]);

  const handleConfirmStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam) return;
    setStartError('');
    setStarting(true);
    try {
      const needsToken = !selectedExam.session;
      const res = await apiFetch<StartExamResponse>(`/api/student/exams/${selectedExam.id}/start`, {
        method: 'POST',
        body: JSON.stringify({
          token: needsToken ? tokenInput.trim().toUpperCase() : '',
        }),
      });
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      setSelectedExam(null);
      setActiveExamData(res);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Gagal memulai ujian.');
    } finally {
      setStarting(false);
    }
  };

  if (activeExamData) {
    return (
      <ExamRoom
        user={user}
        schoolName={schoolName}
        schoolLogo={schoolLogo}
        initialData={activeExamData}
        onExitToDashboard={() => {
          setActiveExamData(null);
          loadExams();
        }}
        onForceLogout={() => {
          setActiveExamData(null);
          onLogout();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen cbt-soft-canvas flex flex-col">
      <header className="cbt-header-soft px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            {schoolLogo ? (
              <img
                src={schoolLogo}
                alt={`Logo ${schoolName}`}
                className="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold">
                C
              </div>
            )}
            <span className="text-lg font-bold text-slate-900">CandyCBT</span>
          </div>

          <div className="hidden sm:block text-sm text-slate-600 truncate">
            {user.name} · <span className="font-mono">{user.identifier}</span> · {user.className} ({user.room})
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Jadwal Ujian Peserta</h1>
            <p className="text-sm text-slate-500 mt-1">
              {schoolName} · Pilih mata pelajaran aktif dan masukkan Token Ujian dari Proktor.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <LiveClockDate variant="card" />
            <button
              type="button"
              onClick={() => void handleOpenMyQr()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700/80 bg-teal-50 hover:bg-teal-100 text-sm font-semibold text-teal-800 whitespace-nowrap shrink-0 transition-colors"
            >
              <QrCode className="w-4 h-4" />
              QR Absensi Saya
            </button>
            <button
              type="button"
              onClick={loadExams}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300/80 bg-white/90 hover:bg-slate-50 text-sm font-semibold text-slate-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Muat Ulang
            </button>
          </div>
        </div>

        {broadcasts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <Volume2 className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Pengumuman Terbaru dari Proktor</p>
              <p className="mt-0.5">{broadcasts[0].message}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-3">
          <button
            type="button"
            onClick={() => setActiveSection('exams')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeSection === 'exams'
                ? 'bg-teal-700 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            Jadwal Ujian ({exams.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('materials')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeSection === 'materials'
                ? 'bg-teal-700 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <NotebookPen className="w-4 h-4" />
            Materi Pembelajaran ({materials.length})
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((n) => (
              <div key={n} className="h-44 bg-white border border-slate-200 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeSection === 'materials' ? (
          materials.length === 0 ? (
            <div className="cbt-soft-panel rounded-xl p-10 text-center">
              <p className="text-base font-semibold text-slate-900">Belum Ada Materi Pembelajaran</p>
              <p className="text-sm text-slate-500 mt-1">
                Materi, tautan video, atau tugas belajar dari guru untuk kelas {user.className} akan tampil di sini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {materials.map((mat) => (
                <div
                  key={mat.id}
                  className="cbt-soft-panel rounded-xl p-6 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-teal-800">{mat.subject}</span>
                      <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 font-semibold text-slate-700">
                        {mat.materialType}
                      </span>
                    </div>
                    <h2 className="mt-2 text-lg font-bold text-slate-900">{mat.title}</h2>
                    {mat.summary && (
                      <p className="text-sm text-slate-600 mt-1 line-clamp-2">{mat.summary}</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Guru: {mat.teacherName}</span>
                      {mat.dueDate && (
                        <span className="inline-flex items-center gap-1 text-amber-800 font-semibold">
                          <Calendar className="w-3.5 h-3.5" />
                          Tenggat: {mat.dueDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMaterial(mat)}
                    className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <BookOpen className="w-4 h-4" />
                    Buka Materi
                  </button>
                </div>
              ))}
            </div>
          )
        ) : exams.length === 0 ? (
          <div className="cbt-soft-panel rounded-xl p-10 text-center">
            <p className="text-base font-semibold text-slate-900">Belum Ada Jadwal Ujian Aktif</p>
            <p className="text-sm text-slate-500 mt-1">
              Silakan tunggu Proktor mengaktifkan sesi ujian untuk kelas {user.className}.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {exams.map((ex) => {
              const sess = ex.session;
              const isFinished = sess?.status === 'SELESAI';
              const isBlocked = sess?.status === 'TERBLOKIR';
              const isOngoing = sess?.status === 'SEDANG_UJIAN';

              return (
                <div
                  key={ex.id}
                  className="cbt-soft-panel rounded-xl p-6 flex flex-col justify-between gap-5"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-teal-700">{ex.bankCode}</span>
                      <span>
                        {ex.questionCount} Soal · {ex.durationMinutes} Menit · KKM {ex.kkm}
                      </span>
                    </div>
                    <h2 className="mt-2 text-lg font-bold text-slate-900">{ex.subject}</h2>
                    <p className="text-sm text-slate-600 mt-0.5">{ex.title}</p>

                    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Periode: {ex.startDate}
                      </span>
                      {ex.antiCheatEnabled && (
                        <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                          Anti-Kecurangan Aktif (Maks {ex.maxViolations}x)
                        </span>
                      )}
                    </div>
                  </div>

                  {isFinished ? (
                    <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-800 text-sm font-semibold">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Sudah Selesai</span>
                      </div>
                      {ex.showScoreAfterFinish && typeof sess?.finalScore === 'number' && (
                        <span className="font-mono font-bold text-emerald-900 tabular-nums">
                          Nilai: {sess.finalScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                  ) : isBlocked ? (
                    <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-red-800 text-sm font-semibold">
                        <Lock className="w-4 h-4 shrink-0" />
                        <span>Terblokir — Hubungi Proktor</span>
                      </div>
                      <button
                        type="button"
                        onClick={loadExams}
                        className="text-xs font-semibold text-red-700 underline whitespace-nowrap"
                      >
                        Cek Status
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExam(ex);
                        setTokenInput('');
                        setAgreedRules(Boolean(sess));
                        setStartError('');
                      }}
                      className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      {isOngoing ? 'Lanjutkan Ujian' : 'Kerjakan Ujian'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Konfirmasi Tes & Input Token Modal */}
      {selectedExam && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Konfirmasi Data & Token Ujian</h3>
              <span className="font-mono text-xs text-teal-300">{selectedExam.bankCode}</span>
            </div>

            <form onSubmit={handleConfirmStart} className="p-6 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Peserta</span>
                  <span className="font-semibold text-slate-900">{user.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Mata Pelajaran</span>
                  <span className="font-semibold text-slate-900">{selectedExam.subject}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Alokasi Waktu</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {selectedExam.durationMinutes} Menit ({selectedExam.questionCount} Soal)
                  </span>
                </div>
              </div>

              {!selectedExam.session && (
                <div>
                  <label htmlFor="exam-token" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Masukkan Token Ujian
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="exam-token"
                      type="text"
                      required
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                      placeholder="Contoh: CNDY26"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 font-mono uppercase tracking-widest text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              )}

              {selectedExam.antiCheatEnabled && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  <p className="font-bold">Tata Tertib Pemantauan Kecurangan Otomatis:</p>
                  <p>1. Ujian berjalan dalam Mode Layar Penuh (Fullscreen).</p>
                  <p>2. Dilarang berpindah tab, membuka aplikasi lain, atau menyalin teks soal.</p>
                  <p>
                    3. Pelanggaran sebanyak <strong className="font-mono">{selectedExam.maxViolations}x</strong> otomatis mengunci layar ujian hingga dibuka Proktor.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={agreedRules}
                  onChange={(e) => setAgreedRules(e.target.checked)}
                  className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>Saya siap mengerjakan ujian secara jujur dan mematuhi seluruh tata tertib.</span>
              </label>

              {startError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
                  {startError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedExam(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={starting || !agreedRules}
                  className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-sm font-semibold"
                >
                  {starting ? 'Memuat Soal...' : 'Mulai Mengerjakan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Personal Student QR Code Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white rounded-xl border border-slate-200 p-6 text-center space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Kartu QR Absensi Peserta</h3>
              <p className="text-xs text-slate-500 mt-1">
                Tunjukkan QR Code ini ke pemindai kamera Proktor untuk absensi masuk ruang ujian.
              </p>
            </div>
            {myQrUrl ? (
              <img
                src={myQrUrl}
                alt={`QR Code ${user.name}`}
                className="w-52 h-52 mx-auto rounded-xl border border-slate-200 p-2 bg-white"
              />
            ) : (
              <div className="w-52 h-52 mx-auto rounded-xl bg-slate-100 animate-pulse" />
            )}
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="font-bold text-slate-900 text-sm">{user.name}</p>
              <p className="font-mono text-slate-600 mt-0.5">
                {user.identifier} · {user.className} ({user.room})
              </p>
            </div>
            <div className="flex gap-2.5">
              {myQrUrl && (
                <a
                  href={myQrUrl}
                  download={`QR_Absensi_${user.identifier}.png`}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="w-4 h-4" />
                  Unduh PNG
                </a>
              )}
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Learning Material Reader Modal */}
      {selectedMaterial && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-xs text-teal-300 font-semibold">{selectedMaterial.subject}</p>
                <h3 className="text-base font-bold truncate">{selectedMaterial.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMaterial(null)}
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-semibold">
                  Guru: {selectedMaterial.teacherName}
                </span>
                {selectedMaterial.dueDate && (
                  <span className="px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                    Tenggat Tugas: {selectedMaterial.dueDate}
                  </span>
                )}
              </div>

              {selectedMaterial.summary && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                  {selectedMaterial.summary}
                </div>
              )}

              {selectedMaterial.content && (
                <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                  {selectedMaterial.content}
                </div>
              )}

              <div className="flex flex-wrap gap-2.5 pt-2">
                {selectedMaterial.resourceUrl && (
                  <a
                    href={selectedMaterial.resourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buka Tautan Materi / Video
                  </a>
                )}
                {selectedMaterial.attachmentDataUrl && selectedMaterial.attachmentName && (
                  <a
                    href={selectedMaterial.attachmentDataUrl}
                    download={selectedMaterial.attachmentName}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-800 text-xs font-semibold"
                  >
                    <Paperclip className="w-4 h-4" />
                    Unduh Lampiran: {selectedMaterial.attachmentName}
                  </a>
                )}
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedMaterial(null)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
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
