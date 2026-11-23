import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { ExamSchedule } from '../../types/cbt';

export interface ScoreChartSessionItem {
  id: string;
  examId: string;
  className: string;
  status: string;
  finalScore: number;
  kkm?: number;
}

interface ScoreDistributionChartProps {
  exams: ExamSchedule[];
  sessions: ScoreChartSessionItem[];
  bankKkmMap?: Record<string, number>;
  selectedExamId?: string;
  onExamChange?: (examId: string) => void;
  onOpenResults?: () => void;
  title?: string;
}

interface DistributionBucket {
  range: string;
  label: string;
  min: number;
  max: number;
  count: number;
  percentage: number;
  color: string;
  passesKkm: boolean;
}

interface ClassPerformanceItem {
  className: string;
  average: number;
  participants: number;
  passed: number;
  remedial: number;
  passRate: number;
}

const BUCKET_TEMPLATES = [
  { range: '0–49', label: 'Perlu Bimbingan', min: 0, max: 49.999, color: '#dc2626' },
  { range: '50–59', label: 'Kurang', min: 50, max: 59.999, color: '#ea580c' },
  { range: '60–69', label: 'Cukup', min: 60, max: 69.999, color: '#d97706' },
  { range: '70–74', label: 'Hampir Tuntas', min: 70, max: 74.999, color: '#ca8a04' },
  { range: '75–84', label: 'Tuntas Baik', min: 75, max: 84.999, color: '#0f766e' },
  { range: '85–100', label: 'Sangat Baik', min: 85, max: 100.001, color: '#059669' },
] as const;

interface TooltipPayloadEntry<T> {
  payload?: T;
}

const HistogramTooltip: React.FC<{
  active?: boolean;
  payload?: TooltipPayloadEntry<DistributionBucket>[];
}> = ({ active, payload }) => {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 shadow-sm text-xs space-y-1">
      <div className="flex items-center gap-2 font-bold text-slate-900">
        <span
          className="w-2.5 h-2.5 rounded-xs shrink-0"
          style={{ backgroundColor: item.color }}
        />
        <span className="font-mono tabular-nums">Rentang {item.range}</span>
      </div>
      <p className="text-slate-500">{item.label}</p>
      <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-4 font-mono tabular-nums text-slate-800">
        <span>Jumlah Peserta</span>
        <span className="font-bold">
          {item.count} siswa ({item.percentage}%)
        </span>
      </div>
    </div>
  );
};

const ClassTooltip: React.FC<{
  active?: boolean;
  payload?: TooltipPayloadEntry<ClassPerformanceItem>[];
}> = ({ active, payload }) => {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 shadow-sm text-xs space-y-1">
      <p className="font-bold text-slate-900">{item.className}</p>
      <div className="pt-1 border-t border-slate-100 space-y-0.5 font-mono tabular-nums text-slate-700">
        <div className="flex items-center justify-between gap-4">
          <span>Rata-rata Nilai</span>
          <span className="font-bold text-slate-900">{item.average.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Tuntas KKM</span>
          <span className="font-semibold text-teal-800">
            {item.passed}/{item.participants} ({item.passRate}%)
          </span>
        </div>
      </div>
    </div>
  );
};

export const ScoreDistributionChart: React.FC<ScoreDistributionChartProps> = ({
  exams,
  sessions,
  bankKkmMap = {},
  selectedExamId: controlledExamId,
  onExamChange,
  onOpenResults,
  title = 'Distribusi Nilai & Statistik Performa Peserta',
}) => {
  const [internalExamId, setInternalExamId] = useState<string>('ALL');
  const [chartMode, setChartMode] = useState<'distribution' | 'classes'>('distribution');

  const activeExamId = controlledExamId ?? internalExamId;
  const setActiveExamId = (nextId: string) => {
    if (onExamChange) {
      onExamChange(nextId);
    } else {
      setInternalExamId(nextId);
    }
  };

  const examLookup = useMemo(() => {
    const map = new Map<string, ExamSchedule>();
    for (const ex of exams) {
      map.set(ex.id, ex);
    }
    return map;
  }, [exams]);

  const finishedSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.status !== 'SELESAI') return false;
      if (activeExamId !== 'ALL' && s.examId !== activeExamId) return false;
      return Number.isFinite(s.finalScore);
    });
  }, [sessions, activeExamId]);

  const activeKkm = useMemo(() => {
    if (activeExamId !== 'ALL') {
      const ex = examLookup.get(activeExamId);
      if (ex && typeof bankKkmMap[ex.bankId] === 'number') {
        return bankKkmMap[ex.bankId];
      }
    }
    if (finishedSessions.length > 0) {
      const sampleKkm = finishedSessions.find((s) => typeof s.kkm === 'number')?.kkm;
      if (typeof sampleKkm === 'number') return sampleKkm;
    }
    return 75;
  }, [activeExamId, examLookup, bankKkmMap, finishedSessions]);

  const resolveSessionKkm = (session: ScoreChartSessionItem): number => {
    if (typeof session.kkm === 'number') return session.kkm;
    const ex = examLookup.get(session.examId);
    if (ex && typeof bankKkmMap[ex.bankId] === 'number') {
      return bankKkmMap[ex.bankId];
    }
    return activeKkm;
  };

  const summary = useMemo(() => {
    if (finishedSessions.length === 0) {
      return {
        total: 0,
        avg: '0.0',
        max: '0.0',
        min: '0.0',
        passed: 0,
        remedial: 0,
        passRate: 0,
      };
    }

    let sum = 0;
    let maxVal = -Infinity;
    let minVal = Infinity;
    let passed = 0;

    for (const s of finishedSessions) {
      const score = Math.max(0, Math.min(100, Number(s.finalScore) || 0));
      sum += score;
      if (score > maxVal) maxVal = score;
      if (score < minVal) minVal = score;
      if (score >= resolveSessionKkm(s)) {
        passed += 1;
      }
    }

    const total = finishedSessions.length;
    const remedial = total - passed;
    return {
      total,
      avg: (sum / total).toFixed(1),
      max: maxVal.toFixed(1),
      min: minVal.toFixed(1),
      passed,
      remedial,
      passRate: Math.round((passed / total) * 100),
    };
  }, [finishedSessions, activeKkm, examLookup, bankKkmMap]);

  const distributionData = useMemo<DistributionBucket[]>(() => {
    const total = finishedSessions.length;
    return BUCKET_TEMPLATES.map((tpl) => {
      const count = finishedSessions.filter((s) => {
        const score = Math.max(0, Math.min(100, Number(s.finalScore) || 0));
        return score >= tpl.min && score <= tpl.max;
      }).length;

      return {
        range: tpl.range,
        label: tpl.label,
        min: tpl.min,
        max: tpl.max,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        color: tpl.min >= activeKkm ? (tpl.min >= 85 ? '#059669' : '#0f766e') : tpl.color,
        passesKkm: tpl.min >= activeKkm,
      };
    });
  }, [finishedSessions, activeKkm]);

  const classPerformanceData = useMemo<ClassPerformanceItem[]>(() => {
    const groups = new Map<
      string,
      { sum: number; count: number; passed: number }
    >();

    for (const s of finishedSessions) {
      const cls = (s.className || 'Tanpa Kelas').trim();
      const score = Math.max(0, Math.min(100, Number(s.finalScore) || 0));
      const prev = groups.get(cls) || { sum: 0, count: 0, passed: 0 };
      prev.sum += score;
      prev.count += 1;
      if (score >= resolveSessionKkm(s)) {
        prev.passed += 1;
      }
      groups.set(cls, prev);
    }

    return Array.from(groups.entries())
      .map(([className, g]) => ({
        className,
        average: Math.round((g.sum / g.count) * 10) / 10,
        participants: g.count,
        passed: g.passed,
        remedial: g.count - g.passed,
        passRate: Math.round((g.passed / g.count) * 100),
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'id'));
  }, [finishedSessions, activeKkm, examLookup, bankKkmMap]);

  return (
    <section className="cbt-soft-panel rounded-xl overflow-hidden">
      {/* Header & Controls */}
      <div className="p-5 sm:p-6 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200/80 text-teal-800 flex items-center justify-center shrink-0 mt-0.5">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {summary.total} peserta selesai · KKM acuan {activeKkm} · {summary.passed} Tuntas /{' '}
              {summary.remedial} Remedial
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200/70">
            <button
              type="button"
              onClick={() => setChartMode('distribution')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'distribution'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Distribusi Nilai
            </button>
            <button
              type="button"
              onClick={() => setChartMode('classes')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'classes'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Rata-rata Kelas
            </button>
          </div>

          {!controlledExamId && (
            <select
              aria-label="Filter Jadwal Ujian"
              value={activeExamId}
              onChange={(e) => setActiveExamId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 max-w-xs"
            >
              <option value="ALL">Semua Jadwal Ujian</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.subject} — {ex.title}
                </option>
              ))}
            </select>
          )}

          {onOpenResults && (
            <button
              type="button"
              onClick={onOpenResults}
              className="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap shrink-0 ml-1"
            >
              Lihat Rincian →
            </button>
          )}
        </div>
      </div>

      {/* Inline Metric Strip separated cleanly by hairlines (single elevation, no nested cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 border-b border-slate-200/80 bg-slate-50/50">
        <div className="px-5 py-3.5">
          <p className="text-xs text-slate-500">Rata-rata Skor</p>
          <p className="mt-0.5 text-xl font-bold font-mono tabular-nums text-slate-900">
            {summary.avg}
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-xs text-slate-500">Rentang Nilai (Min–Maks)</p>
          <p className="mt-0.5 text-xl font-bold font-mono tabular-nums text-slate-900">
            {summary.min} – {summary.max}
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-xs text-slate-500">Ketuntasan KKM</p>
          <p className="mt-0.5 text-xl font-bold font-mono tabular-nums text-teal-800">
            {summary.passRate}%
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-xs text-slate-500">Perlu Remedial</p>
          <p className="mt-0.5 text-xl font-bold font-mono tabular-nums text-amber-700">
            {summary.remedial} siswa
          </p>
        </div>
      </div>

      {/* Main Chart Viewport */}
      <div className="p-5 sm:p-6">
        {finishedSessions.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-700">
              Belum ada nilai ujian yang selesai dikumpulkan
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Grafik distribusi rentang nilai dan perbandingan rata-rata kelas akan muncul otomatis setelah peserta menyelesaikan sesi ujian.
            </p>
            {onOpenResults && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onOpenResults}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                >
                  Buka Hasil &amp; Laporan PDF
                </button>
              </div>
            )}
          </div>
        ) : chartMode === 'distribution' ? (
          <div className="space-y-4">
            <div className="h-72 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={distributionData}
                  margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                  barCategoryGap="22%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="range"
                    tick={{ fill: '#334155', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<HistogramTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {distributionData.map((entry) => (
                      <Cell key={entry.range} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Explicit accessible legend (color paired with text label) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/70 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-red-600 shrink-0" />
                  <span>&lt; 60 (Perlu Bimbingan)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 shrink-0" />
                  <span>60 – {Math.max(60, activeKkm - 1)} (Remedial)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 shrink-0" />
                  <span>≥ {activeKkm} (Tuntas KKM)</span>
                </span>
              </div>
              <span className="font-mono tabular-nums text-slate-500">
                Sumbu X: Rentang Skor · Sumbu Y: Jumlah Peserta
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-72 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={classPerformanceData}
                  margin={{ top: 16, right: 20, left: -12, bottom: 4 }}
                  barCategoryGap="24%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="className"
                    tick={{ fill: '#334155', fontSize: 12 }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#64748b', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ClassTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
                  <ReferenceLine
                    y={activeKkm}
                    stroke="#0f766e"
                    strokeDasharray="4 4"
                    label={{
                      value: `KKM ${activeKkm}`,
                      position: 'insideTopRight',
                      fill: '#0f766e',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                  <Bar dataKey="average" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {classPerformanceData.map((entry) => (
                      <Cell
                        key={entry.className}
                        fill={entry.average >= activeKkm ? '#0f766e' : '#d97706'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/70 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 shrink-0" />
                  <span>Rata-rata kelas ≥ {activeKkm} (Memenuhi KKM)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 shrink-0" />
                  <span>Rata-rata kelas &lt; {activeKkm} (Di bawah KKM)</span>
                </span>
              </div>
              <span className="font-mono tabular-nums text-slate-500">
                {classPerformanceData.length} kelas terdata
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
