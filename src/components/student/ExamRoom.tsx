import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  LayoutGrid,
  Lock,
  Maximize2,
  ShieldAlert,
  Volume2,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { StartExamResponse } from '../../lib/api';
import type { AuthUser, BroadcastNotice, ExamSessionStatus, ViolationType } from '../../types/cbt';
import { LiveClockDate } from '../LiveClockDate';

interface ExamRoomProps {
  user: AuthUser;
  schoolName: string;
  schoolLogo?: string;
  initialData: StartExamResponse;
  onExitToDashboard: () => void;
  onForceLogout: () => void;
}

interface FinishResponse {
  status: ExamSessionStatus;
  finishedAt: string;
  showScoreAfterFinish: boolean;
  result: {
    pgCorrect: number;
    pgTotal: number;
    pgScore: number;
    finalScore: number;
    kkm: number;
    hasEssay: boolean;
  } | null;
}

export const ExamRoom: React.FC<ExamRoomProps> = ({
  user,
  schoolName,
  schoolLogo,
  initialData,
  onExitToDashboard,
  onForceLogout,
}) => {
  const [questions] = useState(initialData.questions);
  const [exam] = useState(initialData.exam);
  const [sessionId] = useState(initialData.session.id);
  const [status, setStatus] = useState<ExamSessionStatus>(initialData.session.status);
  const [endsAt, setEndsAt] = useState<string>(initialData.session.endsAt);
  const [answers, setAnswers] = useState(initialData.session.answers || {});
  const [currentIdx, setCurrentIdx] = useState(initialData.session.currentQuestionIndex || 0);
  const [violationCount, setViolationCount] = useState(initialData.session.violationCount || 0);
  const [blockReason, setBlockReason] = useState(initialData.session.lastViolationReason || '');
  const [warningToast, setWarningToast] = useState<string>('');
  const [broadcastNotice, setBroadcastNotice] = useState<BroadcastNotice | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    Math.max(0, Math.floor((new Date(initialData.session.endsAt).getTime() - Date.now()) / 1000))
  );
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [showMobileGrid, setShowMobileGrid] = useState(false);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finishSummary, setFinishSummary] = useState<FinishResponse | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [savingIndicator, setSavingIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));

  const lastViolationStamp = useRef<number>(0);
  const essayDebounceRef = useRef<number | null>(null);
  const wsRef = useRef<ReturnType<typeof createCbtWebSocket> | null>(null);
  const currentIdxRef = useRef<number>(currentIdx);
  const statusRef = useRef<ExamSessionStatus>(status);
  const answersRef = useRef(answers);

  currentIdxRef.current = currentIdx;
  statusRef.current = status;
  answersRef.current = answers;

  const currentQuestion = questions[currentIdx];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id]?.answer || '' : '';
  const currentDoubtful = currentQuestion ? Boolean(answers[currentQuestion.id]?.isDoubtful) : false;

  const answeredCount = useMemo(
    () =>
      questions.filter((q) => {
        const val = answers[q.id]?.answer;
        return typeof val === 'string' && val.trim().length > 0;
      }).length,
    [questions, answers]
  );

  const doubtfulCount = useMemo(
    () => questions.filter((q) => Boolean(answers[q.id]?.isDoubtful)).length,
    [questions, answers]
  );

  const handleFinishExam = useCallback(async () => {
    if (submitting || statusRef.current === 'SELESAI') return;
    setSubmitting(true);
    try {
      if (essayDebounceRef.current) {
        window.clearTimeout(essayDebounceRef.current);
        essayDebounceRef.current = null;
        const activeQ = questions[currentIdxRef.current];
        if (activeQ && activeQ.type === 'ESAI') {
          const rec = answersRef.current[activeQ.id];
          if (rec) {
            await apiFetch(`/api/student/sessions/${sessionId}/answer`, {
              method: 'POST',
              body: JSON.stringify({
                questionId: activeQ.id,
                answer: rec.answer || '',
                isDoubtful: Boolean(rec.isDoubtful),
                currentQuestionIndex: currentIdxRef.current,
              }),
            }).catch(() => undefined);
          }
        }
      }
      const res = await apiFetch<FinishResponse>(`/api/student/sessions/${sessionId}/finish`, {
        method: 'POST',
      });
      setStatus('SELESAI');
      setFinishSummary(res);
      setConfirmFinishOpen(false);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    } catch (err) {
      setWarningToast(err instanceof Error ? err.message : 'Gagal menyelesaikan ujian.');
    } finally {
      setSubmitting(false);
    }
  }, [questions, sessionId, submitting]);

  const handleFinishExamRef = useRef(handleFinishExam);
  handleFinishExamRef.current = handleFinishExam;

  // Countdown Timer
  useEffect(() => {
    if (status === 'SELESAI') return;
    const timer = window.setInterval(() => {
      const secs = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(secs);
      if (secs === 0 && status === 'SEDANG_UJIAN') {
        handleFinishExam();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, handleFinishExam, status]);

  // WebSocket Real-time Connection (Proctor Commands + Heartbeat)
  useEffect(() => {
    const client = createCbtWebSocket(
      (event, payload) => {
        if (event === 'admin:broadcast') {
          setBroadcastNotice(payload as BroadcastNotice);
        } else if (event === 'admin:command') {
          const cmd = payload as {
            action: string;
            sessionId?: string;
            endsAt?: string;
            minutes?: number;
            reason?: string;
          };
          if (cmd.action === 'UNLOCK') {
            setStatus('SEDANG_UJIAN');
            setViolationCount(0);
            setBlockReason('');
            setWarningToast('Akses ujian Anda telah dibuka kembali oleh Proktor. Lanjutkan dengan tertib.');
          } else if (cmd.action === 'LOCK') {
            setStatus('TERBLOKIR');
            setBlockReason(cmd.reason || 'Diblokir oleh Proktor.');
          } else if (cmd.action === 'FORCE_FINISH') {
            handleFinishExamRef.current();
          } else if (cmd.action === 'ADD_TIME' && cmd.endsAt) {
            setEndsAt(cmd.endsAt);
            setWarningToast(`Proktor menambahkan waktu pengerjaan +${cmd.minutes || 10} menit.`);
          } else if (cmd.action === 'RESET_LOGIN') {
            onForceLogout();
          }
        }
      },
      (connected) => setWsConnected(connected)
    );
    wsRef.current = client;

    const heartbeat = window.setInterval(() => {
      if (statusRef.current === 'SEDANG_UJIAN' || statusRef.current === 'TERBLOKIR') {
        client.send('student:heartbeat', {
          sessionId,
          currentQuestionIndex: currentIdxRef.current,
        });
      }
    }, 15_000);

    return () => {
      window.clearInterval(heartbeat);
      if (essayDebounceRef.current) {
        window.clearTimeout(essayDebounceRef.current);
      }
      client.close();
    };
  }, [onForceLogout, sessionId]);

  // Report Anti-Cheat Violation
  const reportViolation = useCallback(
    async (type: ViolationType, description: string) => {
      if (!exam.antiCheatEnabled || status !== 'SEDANG_UJIAN') return;
      const now = Date.now();
      if (now - lastViolationStamp.current < 2000) return;
      lastViolationStamp.current = now;

      try {
        const res = await apiFetch<{
          status: ExamSessionStatus;
          violationCount: number;
          maxViolations: number;
          triggeredBlock: boolean;
          lastViolationReason?: string;
        }>(`/api/student/sessions/${sessionId}/violation`, {
          method: 'POST',
          body: JSON.stringify({ type, description }),
        });
        setViolationCount(res.violationCount);
        if (res.triggeredBlock || res.status === 'TERBLOKIR') {
          setStatus('TERBLOKIR');
          setBlockReason(res.lastViolationReason || description);
        } else {
          setWarningToast(
            `Peringatan Anti-Kecurangan (${res.violationCount}/${res.maxViolations}): ${description}`
          );
        }
      } catch {
        // ignore network hiccup on violation report
      }
    },
    [exam.antiCheatEnabled, sessionId, status]
  );

  // Anti-Cheat DOM Event Listeners
  useEffect(() => {
    if (!exam.antiCheatEnabled || status !== 'SEDANG_UJIAN') return;

    const handleVisibility = () => {
      if (document.hidden) {
        reportViolation('TAB_SWITCH', 'Berpindah tab atau meminimalkan jendela browser');
      }
    };

    const handleBlur = () => {
      reportViolation('WINDOW_BLUR', 'Fokus keluar dari jendela aplikasi ujian');
    };

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) {
        reportViolation('EXIT_FULLSCREEN', 'Keluar dari mode layar penuh (Fullscreen) ujian');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      reportViolation('CONTEXT_MENU', 'Mencoba membuka menu klik kanan');
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation('COPY_PASTE', 'Mencoba menyalin atau menempel teks (Copy/Cut/Paste)');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) ||
        ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'v' || key === 'u'))
      ) {
        e.preventDefault();
        reportViolation('DEVTOOLS_SHORTCUT', `Menekan pintasan terlarang (${e.key})`);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [exam.antiCheatEnabled, reportViolation, status]);

  const persistAnswer = async (
    questionId: string,
    answer: string,
    isDoubtful: boolean,
    idx: number
  ) => {
    setSavingIndicator('saving');
    try {
      await apiFetch(`/api/student/sessions/${sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          questionId,
          answer,
          isDoubtful,
          currentQuestionIndex: idx,
        }),
      });
      setSavingIndicator('saved');
    } catch {
      setSavingIndicator('idle');
    }
  };

  const handleSelectOption = (originalKey: string) => {
    if (!currentQuestion || status !== 'SEDANG_UJIAN') return;
    const nextRecord = {
      questionId: currentQuestion.id,
      answer: originalKey,
      isDoubtful: currentDoubtful,
      updatedAt: new Date().toISOString(),
    };
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: nextRecord }));
    persistAnswer(currentQuestion.id, originalKey, currentDoubtful, currentIdx);
  };

  const handleToggleDoubtful = () => {
    if (!currentQuestion || status !== 'SEDANG_UJIAN') return;
    const nextDoubt = !currentDoubtful;
    const nextRecord = {
      questionId: currentQuestion.id,
      answer: currentAnswer,
      isDoubtful: nextDoubt,
      updatedAt: new Date().toISOString(),
    };
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: nextRecord }));
    persistAnswer(currentQuestion.id, currentAnswer, nextDoubt, currentIdx);
  };

  const handleEssayChange = (text: string) => {
    if (!currentQuestion || status !== 'SEDANG_UJIAN') return;
    const nextRecord = {
      questionId: currentQuestion.id,
      answer: text,
      isDoubtful: currentDoubtful,
      updatedAt: new Date().toISOString(),
    };
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: nextRecord }));
    if (essayDebounceRef.current) {
      window.clearTimeout(essayDebounceRef.current);
    }
    essayDebounceRef.current = window.setTimeout(() => {
      persistAnswer(currentQuestion.id, text, currentDoubtful, currentIdx);
    }, 500);
  };

  const formatTimer = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const requestFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (status === 'SELESAI' && finishSummary) {
    return (
      <div className="min-h-screen cbt-soft-canvas flex items-center justify-center p-4">
        <div className="max-w-lg w-full cbt-soft-card rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Ujian Telah Diselesaikan</h1>
          <p className="mt-1 text-sm text-slate-500">
            {exam.title} · {user.name} ({user.identifier})
          </p>

          {finishSummary.showScoreAfterFinish && finishSummary.result ? (
            <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-5">
              <p className="text-xs font-medium text-slate-500">Nilai Akhir Sementara</p>
              <p className="mt-1 text-4xl font-bold font-mono tabular-nums text-teal-700">
                {finishSummary.result.finalScore.toFixed(1)}
              </p>
              <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-slate-500">Benar PG</p>
                  <p className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {finishSummary.result.pgCorrect} / {finishSummary.result.pgTotal}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">KKM</p>
                  <p className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {finishSummary.result.kkm}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Status</p>
                  <p
                    className={`font-semibold mt-0.5 ${
                      finishSummary.result.finalScore >= finishSummary.result.kkm
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {finishSummary.result.finalScore >= finishSummary.result.kkm ? 'Tuntas' : 'Remedial'}
                  </p>
                </div>
              </div>
              {finishSummary.result.hasEssay && (
                <p className="mt-3 text-xs text-slate-500">
                  Nilai final menunggu koreksi soal Esai oleh guru mata pelajaran.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-5 text-sm text-slate-600">
              Jawaban Anda telah tersimpan aman di server. Nilai akan diumumkan oleh guru/proktor.
            </div>
          )}

          <button
            type="button"
            onClick={onExitToDashboard}
            className="mt-6 w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors"
          >
            Kembali ke Daftar Ujian
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen cbt-soft-canvas flex flex-col select-none">
      {/* CandyCBT Top Bar */}
      <header className="cbt-exam-topbar text-white px-4 sm:px-6 py-3 border-b border-teal-950/60 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {schoolLogo && (
              <img
                src={schoolLogo}
                alt={`Logo ${schoolName}`}
                className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-teal-100/85 truncate">
                <span className="truncate">
                  {schoolName} · {user.className} ({user.room})
                </span>
                <span aria-hidden="true" className="hidden md:inline opacity-50">
                  ·
                </span>
                <LiveClockDate variant="micro" className="hidden md:inline-flex" />
              </div>
              <h1 className="text-sm sm:text-base font-bold truncate">
                {exam.subject} — {user.name}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {exam.antiCheatEnabled && (
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-teal-900/70 text-xs font-mono tabular-nums">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-300" />
                <span>
                  Pelanggaran: {violationCount}/{exam.maxViolations}
                </span>
              </div>
            )}

            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-sm sm:text-base font-bold tabular-nums ${
                remainingSeconds <= 300 ? 'bg-red-600 text-white' : 'bg-white text-slate-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatTimer(remainingSeconds)}</span>
            </div>

            {!isFullscreen && (
              <button
                type="button"
                onClick={requestFullscreen}
                title="Aktifkan Layar Penuh"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Layar Penuh
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowMobileGrid((v) => !v)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <LayoutGrid className="w-4 h-4" />
              Soal
            </button>
          </div>
        </div>
      </header>

      {/* Live Proctor Broadcast Banner */}
      {broadcastNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-semibold">Pengumuman Proktor:</span>
              <span>{broadcastNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setBroadcastNotice(null)}
              className="text-xs font-semibold text-amber-800 hover:underline whitespace-nowrap shrink-0"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Warning Toast */}
      {warningToast && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-sm text-red-800 font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{warningToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setWarningToast('')}
              className="text-xs font-semibold text-red-700 hover:underline whitespace-nowrap shrink-0"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}

      {/* Main Two-Column Exam Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Question Stage */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-md bg-teal-700 text-white font-mono text-sm font-bold tabular-nums">
                SOAL NO. {currentQuestion?.displayNumber}
              </span>
              <span className="text-xs font-medium text-slate-500">
                {currentQuestion?.type === 'ESAI' ? 'Soal Esai / Uraian' : 'Pilihan Ganda'} · Bobot {currentQuestion?.weight}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {savingIndicator === 'saving'
                  ? 'Menyimpan...'
                  : savingIndicator === 'saved'
                    ? 'Tersimpan'
                    : wsConnected
                      ? 'Terhubung Server'
                      : 'Mode Offline Cache'}
              </span>
              <div className="flex items-center border border-slate-300 rounded-md overflow-hidden bg-white">
                {(['sm', 'md', 'lg'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setFontSize(sz)}
                    className={`px-2.5 py-1 text-xs font-semibold ${
                      fontSize === sz ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {sz === 'sm' ? 'A-' : sz === 'md' ? 'A' : 'A+'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {currentQuestion && (
            <div className="p-6 sm:p-8 space-y-6">
              <div
                className={`text-slate-900 leading-relaxed whitespace-pre-line ${
                  fontSize === 'sm' ? 'text-sm' : fontSize === 'lg' ? 'text-lg' : 'text-base'
                }`}
              >
                {currentQuestion.text}
              </div>

              {currentQuestion.type === 'PG' ? (
                <div className="space-y-3">
                  {currentQuestion.options.map((opt) => {
                    const selected = currentAnswer === opt.originalKey;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => handleSelectOption(opt.originalKey)}
                        className={`w-full text-left p-4 rounded-lg border transition-colors flex items-start gap-3.5 ${
                          selected
                            ? 'border-teal-700 bg-teal-50/70'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm font-bold shrink-0 border ${
                            selected
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
                          }`}
                        >
                          {opt.key}
                        </span>
                        <span
                          className={`pt-1 text-slate-800 ${
                            fontSize === 'sm' ? 'text-sm' : fontSize === 'lg' ? 'text-lg' : 'text-base'
                          }`}
                        >
                          {opt.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <label htmlFor="essay-box" className="block text-sm font-medium text-slate-700 mb-2">
                    Ketik Jawaban Uraian Anda:
                  </label>
                  <textarea
                    id="essay-box"
                    rows={7}
                    value={currentAnswer}
                    onChange={(e) => handleEssayChange(e.target.value)}
                    placeholder="Tuliskan jawaban lengkap dan jelas di sini..."
                    className="w-full p-4 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 select-text"
                  />
                </div>
              )}
            </div>
          )}

          {/* Bottom Navigation Bar */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-sm font-semibold text-slate-700 whitespace-nowrap"
            >
              <ChevronLeft className="w-4 h-4" />
              Soal Sebelumnya
            </button>

            <button
              type="button"
              onClick={handleToggleDoubtful}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-semibold whitespace-nowrap transition-colors ${
                currentDoubtful
                  ? 'bg-amber-500 border-amber-600 text-white'
                  : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Flag className="w-4 h-4" />
              {currentDoubtful ? 'Ragu-Ragu (Aktif)' : 'Ragu-Ragu'}
            </button>

            {currentIdx < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
              >
                Soal Berikutnya
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmFinishOpen(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                Selesai Ujian
              </button>
            )}
          </div>
        </section>

        {/* Right: Navigasi Nomor Soal (CandyCBT Palette) */}
        <aside
          className={`lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5 ${
            showMobileGrid ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Daftar Nomor Soal</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {answeredCount}/{questions.length} Terjawab
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2.5">
            {questions.map((q, idx) => {
              const rec = answers[q.id];
              const isAnswered = typeof rec?.answer === 'string' && rec.answer.trim().length > 0;
              const isDoubt = Boolean(rec?.isDoubtful);
              const isCurrent = idx === currentIdx;

              let btnStyle = 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50';
              if (isDoubt) {
                btnStyle = 'bg-amber-400 border-amber-500 text-slate-900';
              } else if (isAnswered) {
                btnStyle = 'bg-teal-700 border-teal-800 text-white';
              }

              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setCurrentIdx(idx);
                    setShowMobileGrid(false);
                  }}
                  className={`h-10 rounded-lg border font-mono text-sm font-bold tabular-nums transition-transform ${btnStyle} ${
                    isCurrent ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                  }`}
                >
                  {q.displayNumber}
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-teal-700 inline-block shrink-0" />
              <span>Sudah Dijawab ({answeredCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-amber-400 inline-block shrink-0" />
              <span>Ragu-Ragu ({doubtfulCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded border border-slate-300 bg-white inline-block shrink-0" />
              <span>Belum Dijawab ({questions.length - answeredCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded border-2 border-slate-900 inline-block shrink-0" />
              <span>Soal Aktif</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmFinishOpen(true)}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
          >
            Kumpulkan & Selesai Ujian
          </button>
        </aside>
      </main>

      {/* Anti-Cheat Block Overlay */}
      {status === 'TERBLOKIR' && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl p-8 text-center border border-red-200">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-700 mx-auto flex items-center justify-center">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="mt-4 text-xl font-bold text-slate-900">Akses Ujian Terblokir Otomatis</h2>
            <p className="mt-2 text-sm text-slate-600">
              Sistem pemantauan kecurangan mendeteksi pelanggaran berulang ({violationCount}/{exam.maxViolations}):
            </p>
            <p className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm font-semibold text-red-800">
              {blockReason || 'Keluar dari area ujian yang diizinkan'}
            </p>
            <p className="mt-4 text-xs text-slate-500">
              Jawaban Anda sebelumnya tetap tersimpan aman. Silakan melapor kepada Proktor/Pengawas ruang untuk membuka kembali akses ujian Anda secara real-time.
            </p>
            <button
              type="button"
              onClick={onExitToDashboard}
              className="mt-6 w-full py-2.5 px-4 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold"
            >
              Kembali ke Halaman Daftar Ujian
            </button>
          </div>
        </div>
      )}

      {/* Confirm Finish Modal */}
      {confirmFinishOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-xl p-6 border border-slate-200 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Konfirmasi Selesai Ujian</h3>
            <p className="text-sm text-slate-600">
              Anda telah menjawab <strong className="font-mono">{answeredCount}</strong> dari{' '}
              <strong className="font-mono">{questions.length}</strong> soal.
              {doubtfulCount > 0 && (
                <span className="block mt-1 text-amber-700 font-medium">
                  Masih terdapat {doubtfulCount} soal yang ditandai Ragu-Ragu.
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">
              Setelah dikumpulkan, Anda tidak dapat mengubah jawaban kembali.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmFinishOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinishExam}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                {submitting ? 'Mengirim...' : 'Ya, Selesai & Kumpulkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
