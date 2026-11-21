import React, { useEffect, useState } from 'react';
import { CalendarDays, Clock } from 'lucide-react';

const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
const BULAN_SINGKAT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function getIndonesianZoneLabel(date: Date): string {
  // getTimezoneOffset returns minutes behind UTC (e.g., UTC+7 => -420)
  const offsetMinutes = -date.getTimezoneOffset();
  if (offsetMinutes === 420) return 'WIB';
  if (offsetMinutes === 480) return 'WITA';
  if (offsetMinutes === 540) return 'WIT';
  try {
    const parts = new Intl.DateTimeFormat('id-ID', { timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value || 'Lokal';
  } catch {
    return 'Lokal';
  }
}

export function formatIndonesianClockDate(now: Date) {
  const dayName = HARI_ID[now.getDay()];
  const dateNum = now.getDate();
  const monthFull = BULAN_ID[now.getMonth()];
  const monthShort = BULAN_SINGKAT_ID[now.getMonth()];
  const year = now.getFullYear();

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const zone = getIndonesianZoneLabel(now);

  return {
    dayName,
    dateNum,
    monthFull,
    monthShort,
    year,
    fullDateText: `${dayName}, ${dateNum} ${monthFull} ${year}`,
    compactDateText: `${dayName}, ${dateNum} ${monthShort} ${year}`,
    timeText: `${hours}:${minutes}:${seconds}`,
    zone,
  };
}

interface LiveClockDateProps {
  variant?: 'inline' | 'card' | 'hero' | 'micro';
  className?: string;
}

export const LiveClockDate: React.FC<LiveClockDateProps> = ({
  variant = 'inline',
  className = '',
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const info = formatIndonesianClockDate(now);

  if (variant === 'hero') {
    return (
      <div
        className={`rounded-xl bg-white/[0.07] border border-white/15 backdrop-blur-sm px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${className}`}
        aria-label={`Tanggal dan waktu saat ini: ${info.fullDateText} pukul ${info.timeText} ${info.zone}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-teal-400/15 border border-teal-300/20 text-teal-200 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-300/85 leading-tight">
              Hari &amp; Tanggal
            </p>
            <p className="text-xs sm:text-sm font-semibold text-white truncate mt-0.5">
              {info.fullDateText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 pl-2 sm:border-l sm:border-white/12">
          <Clock className="w-4 h-4 text-teal-300/90 shrink-0" />
          <div className="text-right">
            <span className="font-mono text-base sm:text-lg font-bold tracking-tight text-white tabular-nums">
              {info.timeText}
            </span>
            <span className="ml-1.5 text-[11px] font-medium text-teal-200/90">{info.zone}</span>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        className={`cbt-soft-panel rounded-xl px-4 py-2.5 flex items-center gap-3.5 shrink-0 ${className}`}
        aria-label={`Tanggal dan waktu saat ini: ${info.fullDateText} pukul ${info.timeText} ${info.zone}`}
      >
        <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200/70 text-teal-700 flex items-center justify-center shrink-0">
          <CalendarDays className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 whitespace-nowrap">
            {info.fullDateText}
          </p>
          <p className="text-sm font-bold font-mono tabular-nums text-slate-800 flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
            <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
            <span>{info.timeText}</span>
            <span className="text-[11px] font-sans font-semibold text-teal-700">{info.zone}</span>
          </p>
        </div>
      </div>
    );
  }

  if (variant === 'micro') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums ${className}`}
        aria-label={`${info.compactDateText}, ${info.timeText} ${info.zone}`}
      >
        <CalendarDays className="w-3.5 h-3.5 opacity-80 shrink-0" />
        <span>{info.compactDateText}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono font-semibold">{info.timeText}</span>
        <span className="opacity-85">{info.zone}</span>
      </span>
    );
  }

  // Default: 'inline' (clean unboxed top-bar metadata)
  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap shrink-0 ${className}`}
      aria-label={`Tanggal dan waktu saat ini: ${info.fullDateText} pukul ${info.timeText} ${info.zone}`}
    >
      <CalendarDays className="w-3.5 h-3.5 text-teal-700/85 shrink-0" />
      <span className="font-medium text-slate-700">{info.fullDateText}</span>
      <span aria-hidden="true" className="text-slate-300">
        ·
      </span>
      <Clock className="w-3.5 h-3.5 text-teal-700/85 shrink-0" />
      <span className="font-mono font-semibold text-slate-900 tabular-nums">{info.timeText}</span>
      <span className="text-[11px] font-medium text-slate-500">{info.zone}</span>
    </div>
  );
};
