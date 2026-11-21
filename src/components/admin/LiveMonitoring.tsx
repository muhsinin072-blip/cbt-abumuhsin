import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type {
  ExamSchedule,
  ExamSession,
  ServerMetrics,
  ViolationLog,
} from '../../types/cbt';

export const LiveMonitoring: React.FC = () => {
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [violations, setViolations] = useState<ViolationLog[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [broadcastText, setBroadcastText] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [error, setError] = useState('');

  const loadMonitoring = useCallback(async () => {
    try {
      const data = await apiFetch<{
        sessions: ExamSession[];
        violations: ViolationLog[];
        exams: ExamSchedule[];
        metrics: ServerMetrics;
      }>('/api/admin/monitoring');
      setSessions(data.sessions);
      setViolations(data.violations);
      setExams(data.exams);
      setMetrics(data.metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pemantauan ujian.');
    }
  }, []);

  useEffect(() => {
    loadMonitoring();

    const ws = createCbtWebSocket(
      (event, payload) => {
        if (event === 'session:updated') {
          const updated = payload as ExamSession;
          setSessions((prev) => {
            const exists = prev.some((s) => s.id === updated.id);
            return exists ? prev.map((s) => (s.id === updated.id ? updated : s)) : [updated, ...prev];
          });
        } else if (event === 'session:removed') {
          const { sessionId } = payload as { sessionId: string };
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        } else if (event === 'violation:logged') {
          const log = payload as ViolationLog;
          setViolations((prev) => [log, ...prev].slice(0, 100));
        } else if (event === 'token:rotated') {
          const { examId, token, tokenUpdatedAt } = payload as {
            examId: string;
            token: string;
            tokenUpdatedAt: string;
          };
          setExams((prev) =>
            prev.map((e) => (e.id === examId ? { ...e, token, tokenUpdatedAt } : e))
          );
        }
      },
      (connected) => setWsConnected(connected)
    );

    return () => ws.close();
  }, [loadMonitoring]);

  const handleSessionAction = async (
    sessionId: string,
    action: 'UNLOCK' | 'LOCK' | 'FORCE_FINISH' | 'RESET_LOGIN' | 'ADD_TIME'
  ) => {
    setError('');
    setActionMsg('');
    try {
      await apiFetch(`/api/admin/sessions/${sessionId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, minutes: 10 }),
      });
      setActionMsg(`Aksi ${action} berhasil dijalankan secara real-time.`);
      loadMonitoring();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menjalankan aksi proktor.');
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    setError('');
    try {
      await apiFetch('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message: broadcastText.trim() }),
      });
      setBroadcastText('');
      setActionMsg('Pengumuman berhasil dikirim ke seluruh layar ujian peserta.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim pengumuman.');
    }
  };

  const filteredSessions = sessions.filter(
    (s) => statusFilter === 'ALL' || s.status === statusFilter
  );

  const getExamTitle = (examId: string) =>
    exams.find((e) => e.id === examId)?.subject || 'Ujian CBT';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Pemantauan Kecurangan & Proctoring Real-Time
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pantau progres pengerjaan, deteksi pindah tab/keluar layar penuh secara otomatis, dan kendalikan sesi peserta langsung.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap ${
              wsConnected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            WebSocket: {wsConnected ? 'Terhubung Langsung' : 'Menyambungkan...'}
          </span>
          <button
            type="button"
            onClick={loadMonitoring}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Live Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Sedang Mengerjakan</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
            {sessions.filter((s) => s.status === 'SEDANG_UJIAN').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Terblokir Anti-Cheat</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-red-600">
            {sessions.filter((s) => s.status === 'TERBLOKIR').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Selesai Ujian</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {sessions.filter((s) => s.status === 'SELESAI').length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Log Pelanggaran</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {violations.length}
            {metrics ? ` · ${metrics.wsConnectedStudents} WS Aktif` : ''}
          </p>
        </div>
      </div>

      {/* Broadcast Pengumuman Bar */}
      <form
        onSubmit={handleSendBroadcast}
        className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3"
      >
        <input
          type="text"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Kirim pengumuman langsung ke seluruh layar ujian peserta (misal: Waktu tersisa 15 menit)..."
          className="flex-1 min-w-[260px] px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          Kirim Pengumuman
        </button>
      </form>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
          {error}
        </div>
      )}
      {actionMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {actionMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Live Student Sessions Table */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Status Sesi Peserta</h2>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              {(['ALL', 'SEDANG_UJIAN', 'TERBLOKIR', 'SELESAI'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                    statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {st === 'ALL'
                    ? 'Semua'
                    : st === 'SEDANG_UJIAN'
                      ? 'Ujian'
                      : st === 'TERBLOKIR'
                        ? 'Terblokir'
                        : 'Selesai'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-3.5">Peserta</th>
                  <th className="py-3 px-3.5">Mapel</th>
                  <th className="py-3 px-3.5">Progres</th>
                  <th className="py-3 px-3.5">Kecurangan</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5 text-right">Kontrol Proktor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      Belum ada peserta pada status ini.
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => {
                    const answeredCount = Object.values(s.answers || {}).filter(
                      (a) => a.answer && a.answer.trim().length > 0
                    ).length;
                    const totalQ = s.questionOrder.length || 1;
                    return (
                      <tr key={s.id} className={s.status === 'TERBLOKIR' ? 'bg-red-50/50' : ''}>
                        <td className="py-3 px-3.5">
                          <p className="font-bold text-slate-900">{s.studentName}</p>
                          <p className="text-slate-500 font-mono">
                            {s.studentNis} · {s.className} ({s.room})
                          </p>
                        </td>
                        <td className="py-3 px-3.5 text-slate-700">{getExamTitle(s.examId)}</td>
                        <td className="py-3 px-3.5 font-mono tabular-nums">
                          {answeredCount}/{totalQ} soal
                        </td>
                        <td className="py-3 px-3.5 font-mono tabular-nums">
                          <span
                            className={`font-bold ${
                              s.violationCount > 0 ? 'text-red-700' : 'text-slate-600'
                            }`}
                          >
                            {s.violationCount}x
                          </span>
                        </td>
                        <td className="py-3 px-3.5">
                          {s.status === 'TERBLOKIR' ? (
                            <span className="inline-flex items-center gap-1 font-bold text-red-700">
                              <Lock className="w-3.5 h-3.5" />
                              TERBLOKIR
                            </span>
                          ) : s.status === 'SEDANG_UJIAN' ? (
                            <span className="inline-flex items-center gap-1 font-bold text-teal-700">
                              <Clock className="w-3.5 h-3.5" />
                              {s.isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              SELESAI ({s.finalScore.toFixed(0)})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-right space-x-1 whitespace-nowrap">
                          {s.status === 'TERBLOKIR' ? (
                            <button
                              type="button"
                              onClick={() => handleSessionAction(s.id, 'UNLOCK')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
                            >
                              <Unlock className="w-3 h-3" />
                              Buka Blokir
                            </button>
                          ) : (
                            s.status === 'SEDANG_UJIAN' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSessionAction(s.id, 'ADD_TIME')}
                                  className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-700"
                                >
                                  +10m
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSessionAction(s.id, 'LOCK')}
                                  className="px-2 py-1 rounded border border-red-300 bg-red-50 hover:bg-red-100 font-semibold text-red-700"
                                >
                                  Blokir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSessionAction(s.id, 'FORCE_FINISH')}
                                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-semibold"
                                >
                                  Selesaikan
                                </button>
                              </>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => handleSessionAction(s.id, 'RESET_LOGIN')}
                            title="Reset Sesi Login Peserta"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-600"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Anti-Cheat Violation Live Log */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              Log Deteksi Kecurangan
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">{violations.length} Log</span>
          </div>

          <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-200">
            {violations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Belum ada pelanggaran kecurangan terdeteksi.
              </div>
            ) : (
              violations.map((v) => (
                <div key={v.id} className="p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{v.studentName}</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {new Date(v.timestamp).toLocaleTimeString('id-ID')}
                    </span>
                  </div>
                  <p className="text-slate-600">
                    {v.studentNis} · {v.className} ·{' '}
                    <span className="font-mono font-semibold text-red-700">{v.type}</span>
                  </p>
                  <p className="text-slate-700">{v.description}</p>
                  <p
                    className={`font-semibold ${
                      v.triggeredBlock ? 'text-red-700' : 'text-amber-700'
                    }`}
                  >
                    {v.triggeredBlock
                      ? `Otomatis Diblokir (Pelanggaran ke-${v.countAtTime})`
                      : `Peringatan ke-${v.countAtTime}`}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
