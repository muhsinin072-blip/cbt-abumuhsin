import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  ImageUp,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { AdminAttendanceResponse } from '../../lib/api';
import { exportAttendanceExcel } from '../../lib/excel';
import { generateAttendancePDF, generateParticipantCardsPDF } from '../../lib/pdf';
import type {
  AttendancePeriod,
  AttendanceRecord,
  AttendanceSortField,
  AttendanceStatus,
  ExamSchedule,
  SchoolSettings,
  SortDirection,
  Student,
} from '../../types/cbt';

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function shiftIsoMonth(isoMonth: string, deltaMonths: number): string {
  const [y, m] = isoMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return dt.toISOString().slice(0, 7);
}

function getWeekBounds(isoDate: string): { startDate: string; endDate: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = utcDate.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(utcDate);
  monday.setUTCDate(utcDate.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

function getMonthBounds(isoMonth: string): { startDate: string; endDate: string } {
  const [y, m] = isoMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    startDate: `${isoMonth}-01`,
    endDate: `${isoMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

function formatDateId(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

function formatMonthId(isoMonth: string): string {
  const [y, m] = isoMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

const STATUS_SORT_RANK: Record<AttendanceStatus | 'BELUM', number> = {
  HADIR: 1,
  TERLAMBAT: 2,
  IZIN: 3,
  ALPA: 4,
  BELUM: 5,
};

function playBeep(success: boolean): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = success ? 880 : 320;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      ctx.close().catch(() => undefined);
    }, 140);
  } catch {
    // ignore audio block
  }
}

export const AbsensiQRManager: React.FC = () => {
  const [period, setPeriod] = useState<AttendancePeriod>('daily');
  const [date, setDate] = useState<string>(() => getTodayIso());
  const [month, setMonth] = useState<string>(() => getTodayIso().slice(0, 7));
  const [scanDate, setScanDate] = useState<string>(() => getTodayIso());
  const [selectedExamId, setSelectedExamId] = useState<string>('ALL');
  const [scanStatusMode, setScanStatusMode] = useState<'HADIR' | 'TERLAMBAT'>('HADIR');

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [serverRange, setServerRange] = useState<{ startDate: string; endDate: string }>(() => {
    const today = getTodayIso();
    return { startDate: today, endDate: today };
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'duplicate' | 'error';
    text: string;
  } | null>(null);

  // Filter, Sub-view & Sort controls
  const [periodViewTab, setPeriodViewTab] = useState<'summary' | 'logs'>('summary');
  const [classFilter, setClassFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AttendanceStatus | 'BELUM'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<AttendanceSortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Manual / USB Scanner Input
  const [manualInput, setManualInput] = useState('');

  // Live Camera Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // QR Gallery Modal
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrPreviews, setQrPreviews] = useState<Record<string, string>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 });
  const processingScanRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  const computedRange = useMemo(() => {
    if (period === 'weekly') return getWeekBounds(date);
    if (period === 'monthly') return getMonthBounds(month);
    return { startDate: date, endDate: date };
  }, [date, month, period]);

  const activeRange = serverRange || computedRange;

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period, date, month });
      if (selectedExamId !== 'ALL') {
        params.set('examId', selectedExamId);
      }
      const res = await apiFetch<AdminAttendanceResponse>(
        `/api/admin/attendance?${params.toString()}`
      );
      setRecords(res.records);
      setStudents(res.students);
      setExams(res.exams);
      setSettings(res.settings);
      setServerRange({ startDate: res.startDate, endDate: res.endDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data absensi QR.');
    } finally {
      setLoading(false);
    }
  }, [date, month, period, selectedExamId]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Keep sort defaults sensible when changing period/tab
  const handleSelectPeriod = (nextPeriod: AttendancePeriod) => {
    setPeriod(nextPeriod);
    if (nextPeriod === 'daily') {
      setScanDate(date);
      if (sortBy === 'hadirCount' || sortBy === 'attendanceRate') {
        setSortBy('name');
        setSortDir('asc');
      }
    } else {
      setStatusFilter('ALL');
      if (periodViewTab === 'summary' && sortBy === 'status') {
        setSortBy('hadirCount');
        setSortDir('desc');
      }
    }
  };

  const handleSortHeaderClick = (field: AttendanceSortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(
        field === 'hadirCount' || field === 'attendanceRate' || field === 'scannedAt'
          ? 'desc'
          : 'asc'
      );
    }
  };

  const handleNavigatePeriod = (direction: -1 | 1) => {
    if (period === 'daily') {
      const nextDate = shiftIsoDate(date, direction);
      setDate(nextDate);
      setMonth(nextDate.slice(0, 7));
      setScanDate(nextDate);
    } else if (period === 'weekly') {
      const nextDate = shiftIsoDate(date, direction * 7);
      setDate(nextDate);
      setMonth(nextDate.slice(0, 7));
    } else {
      const nextMonth = shiftIsoMonth(month, direction);
      setMonth(nextMonth);
    }
  };

  const handleJumpToday = () => {
    const today = getTodayIso();
    setDate(today);
    setMonth(today.slice(0, 7));
    setScanDate(today);
  };

  // Real-time WebSocket updates for Attendance across daily/weekly/monthly range
  useEffect(() => {
    const ws = createCbtWebSocket((event, payload) => {
      if (event === 'attendance:recorded') {
        const rec = payload as AttendanceRecord;
        const inRange =
          rec.date >= activeRange.startDate && rec.date <= activeRange.endDate;
        const matchExam = selectedExamId === 'ALL' || rec.examId === selectedExamId;
        if (inRange && matchExam) {
          setRecords((prev) =>
            prev.some((r) => r.id === rec.id) ? prev : [rec, ...prev]
          );
        }
      } else if (event === 'attendance:updated') {
        const rec = payload as AttendanceRecord;
        setRecords((prev) => prev.map((r) => (r.id === rec.id ? rec : r)));
      } else if (event === 'attendance:removed') {
        const { id } = payload as { id: string };
        setRecords((prev) => prev.filter((r) => r.id !== id));
      } else if (
        event === 'sync:students' ||
        event === 'sync:exams' ||
        event === 'sync:settings'
      ) {
        void loadAttendance();
      }
    });
    return () => ws.close();
  }, [activeRange.endDate, activeRange.startDate, loadAttendance, selectedExamId]);

  const submitQrScan = useCallback(
    async (qrPayload: string, method: 'QR_CAMERA' | 'QR_IMAGE' | 'MANUAL') => {
      const cleaned = qrPayload.trim();
      if (!cleaned || processingScanRef.current) return;

      const now = Date.now();
      if (
        method === 'QR_CAMERA' &&
        lastScanRef.current.code === cleaned &&
        now - lastScanRef.current.ts < 2500
      ) {
        return;
      }

      lastScanRef.current = { code: cleaned, ts: now };
      processingScanRef.current = true;

      const targetDate = period === 'daily' ? date : scanDate;

      try {
        const res = await apiFetch<{
          duplicate: boolean;
          record: AttendanceRecord;
          message: string;
        }>('/api/admin/attendance/scan', {
          method: 'POST',
          body: JSON.stringify({
            qrPayload: cleaned,
            date: targetDate,
            examId: selectedExamId === 'ALL' ? '' : selectedExamId,
            status: scanStatusMode,
            method,
          }),
        });

        playBeep(true);
        setScanFeedback({
          type: res.duplicate ? 'duplicate' : 'success',
          text: res.message,
        });

        const inRange =
          res.record.date >= activeRange.startDate &&
          res.record.date <= activeRange.endDate;
        if (!res.duplicate && inRange) {
          setRecords((prev) =>
            prev.some((r) => r.id === res.record.id) ? prev : [res.record, ...prev]
          );
        }
      } catch (err) {
        playBeep(false);
        setScanFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Gagal memproses scan QR Code.',
        });
      } finally {
        processingScanRef.current = false;
      }
    },
    [
      activeRange.endDate,
      activeRange.startDate,
      date,
      period,
      scanDate,
      scanStatusMode,
      selectedExamId,
    ]
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(
    async (deviceIdOverride?: string) => {
      setCameraError('');
      stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Browser atau perangkat ini tidak mendukung akses kamera langsung. Gunakan fitur Scan dari Gambar QR atau Input Manual.'
        );
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: deviceIdOverride
            ? { deviceId: { exact: deviceIdOverride } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (navigator.mediaDevices.enumerateDevices) {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
          setDevices(videoInputs);
          if (!deviceIdOverride && videoInputs.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(videoInputs[0].deviceId);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraActive(true);
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Izin kamera ditolak oleh browser. Izinkan akses kamera atau gunakan unggah gambar QR.'
            : 'Kamera tidak ditemukan atau sedang digunakan aplikasi lain. Anda tetap dapat mengunggah gambar QR atau input NIS manual.';
        setCameraError(msg);
        stopCamera();
      }
    },
    [selectedDeviceId, stopCamera]
  );

  // Frame Decode Loop with jsQR
  useEffect(() => {
    if (!cameraActive) return;

    let lastTick = 0;
    const scanFrame = (timestamp: number) => {
      if (!cameraActive) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && timestamp - lastTick > 90) {
        lastTick = timestamp;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const decoded = jsQR(imgData.data, w, h, {
              inversionAttempts: 'dontInvert',
            });
            if (decoded && decoded.data) {
              void submitQrScan(decoded.data, 'QR_CAMERA');
            }
          }
        }
      }
      rafRef.current = window.requestAnimationFrame(scanFrame);
    };

    rafRef.current = window.requestAnimationFrame(scanFrame);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [cameraActive, submitQrScan]);

  // Cleanup camera on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const handleImageQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanFeedback(null);

    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Gagal memuat file gambar.'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);

      if (!ctx) {
        throw new Error('Konteks kanvas tidak tersedia.');
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imgData.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (!decoded || !decoded.data) {
        setScanFeedback({
          type: 'error',
          text: 'QR Code tidak terdeteksi pada gambar tersebut. Pastikan gambar jelas dan tidak terpotong.',
        });
        return;
      }

      await submitQrScan(decoded.data, 'QR_IMAGE');
    } catch (err) {
      setScanFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal membaca QR dari file gambar.',
      });
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    await submitQrScan(manualInput, 'MANUAL');
    setManualInput('');
  };

  const handleQuickMarkStatus = async (student: Student, nextStatus: AttendanceStatus) => {
    const targetDate = period === 'daily' ? date : scanDate;
    const existing = records.find(
      (r) => r.studentId === student.id && r.date === targetDate
    );
    try {
      if (existing) {
        const res = await apiFetch<{ record: AttendanceRecord }>(`/api/admin/attendance/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus }),
        });
        setRecords((prev) => prev.map((r) => (r.id === res.record.id ? res.record : r)));
      } else {
        const res = await apiFetch<{ record: AttendanceRecord }>('/api/admin/attendance/scan', {
          method: 'POST',
          body: JSON.stringify({
            studentId: student.id,
            date: targetDate,
            examId: selectedExamId === 'ALL' ? '' : selectedExamId,
            status: nextStatus,
            method: 'MANUAL',
          }),
        });
        if (
          res.record.date >= activeRange.startDate &&
          res.record.date <= activeRange.endDate
        ) {
          setRecords((prev) => [res.record, ...prev]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status absensi.');
    }
  };

  const handleUpdateRecordStatus = async (recordId: string, nextStatus: AttendanceStatus) => {
    try {
      const res = await apiFetch<{ record: AttendanceRecord }>(`/api/admin/attendance/${recordId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      setRecords((prev) => prev.map((r) => (r.id === res.record.id ? res.record : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status catatan absensi.');
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    try {
      await apiFetch(`/api/admin/attendance/${recordId}`, { method: 'DELETE' });
      setRecords((prev) => prev.filter((r) => r.id !== recordId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus catatan absensi.');
    }
  };

  const openQrGallery = async () => {
    setQrModalOpen(true);
    const map: Record<string, string> = {};
    for (const stu of students) {
      map[stu.id] = await QRCode.toDataURL(`CANDYCBT|STU|${stu.nis}`, {
        width: 220,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
    }
    setQrPreviews(map);
  };

  const downloadSingleQr = (stu: Student) => {
    const dataUrl = qrPreviews[stu.id];
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `QR_Absensi_${stu.nis}_${stu.name.replace(/\s+/g, '_')}.png`;
    a.click();
  };

  const classes = useMemo(
    () => Array.from(new Set(students.map((s) => s.className))).sort(),
    [students]
  );

  // Daily lookup map
  const dailyRecordByStudentId = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const r of records) {
      if (!m.has(r.studentId)) m.set(r.studentId, r);
    }
    return m;
  }, [records]);

  const activeDaysInPeriod = useMemo(
    () => new Set(records.map((r) => r.date)).size,
    [records]
  );

  // Per-student aggregation for Weekly & Monthly summary
  const studentPeriodStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        hadir: number;
        terlambat: number;
        izin: number;
        alpa: number;
        totalMasuk: number;
        totalLogs: number;
        rate: number;
        lastScannedAt: string;
      }
    >();

    for (const stu of students) {
      const stuRecs = records.filter((r) => r.studentId === stu.id);
      const hadir = stuRecs.filter((r) => r.status === 'HADIR').length;
      const terlambat = stuRecs.filter((r) => r.status === 'TERLAMBAT').length;
      const izin = stuRecs.filter((r) => r.status === 'IZIN').length;
      const alpa = stuRecs.filter((r) => r.status === 'ALPA').length;
      const totalMasuk = hadir + terlambat;
      const denominator = activeDaysInPeriod > 0 ? activeDaysInPeriod : 1;
      const rate = activeDaysInPeriod > 0 ? Math.min(100, Math.round((totalMasuk / denominator) * 100)) : 0;
      const lastScannedAt = stuRecs[0]?.scannedAt || '';
      map.set(stu.id, {
        hadir,
        terlambat,
        izin,
        alpa,
        totalMasuk,
        totalLogs: stuRecs.length,
        rate,
        lastScannedAt,
      });
    }
    return map;
  }, [activeDaysInPeriod, records, students]);

  // Filtered & sorted students (used for Daily view & Weekly/Monthly Rekap view + PDF/Excel export)
  const sortedStudents = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = students.filter((s) => {
      const matchClass = classFilter === 'ALL' || s.className === classFilter;
      const matchQuery =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.nis.toLowerCase().includes(q) ||
        s.room.toLowerCase().includes(q);
      if (!matchClass || !matchQuery) return false;

      if (period === 'daily') {
        const rec = dailyRecordByStudentId.get(s.id);
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'BELUM') return !rec;
        return rec?.status === statusFilter;
      } else {
        if (statusFilter === 'ALL') return true;
        const stuRecs = records.filter((r) => r.studentId === s.id);
        if (statusFilter === 'BELUM') return stuRecs.length === 0;
        return stuRecs.some((r) => r.status === statusFilter);
      }
    });

    const dir = sortDir === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'nis') {
        return a.nis.localeCompare(b.nis, 'id') * dir;
      }
      if (sortBy === 'className') {
        const clsCmp = a.className.localeCompare(b.className, 'id');
        return (clsCmp !== 0 ? clsCmp : a.name.localeCompare(b.name, 'id')) * dir;
      }
      if (sortBy === 'status') {
        const ra = dailyRecordByStudentId.get(a.id)?.status || 'BELUM';
        const rb = dailyRecordByStudentId.get(b.id)?.status || 'BELUM';
        const cmp = STATUS_SORT_RANK[ra] - STATUS_SORT_RANK[rb];
        return (cmp !== 0 ? cmp : a.name.localeCompare(b.name, 'id')) * dir;
      }
      if (sortBy === 'scannedAt') {
        const ta =
          period === 'daily'
            ? dailyRecordByStudentId.get(a.id)?.scannedAt || ''
            : studentPeriodStatsMap.get(a.id)?.lastScannedAt || '';
        const tb =
          period === 'daily'
            ? dailyRecordByStudentId.get(b.id)?.scannedAt || ''
            : studentPeriodStatsMap.get(b.id)?.lastScannedAt || '';
        if (!ta && !tb) return a.name.localeCompare(b.name, 'id');
        if (!ta) return 1;
        if (!tb) return -1;
        return ta.localeCompare(tb) * dir;
      }
      if (sortBy === 'hadirCount') {
        const ha = studentPeriodStatsMap.get(a.id)?.totalMasuk || 0;
        const hb = studentPeriodStatsMap.get(b.id)?.totalMasuk || 0;
        const cmp = ha - hb;
        return (cmp !== 0 ? cmp : a.name.localeCompare(b.name, 'id')) * dir;
      }
      if (sortBy === 'attendanceRate') {
        const ra = studentPeriodStatsMap.get(a.id)?.rate || 0;
        const rb = studentPeriodStatsMap.get(b.id)?.rate || 0;
        const cmp = ra - rb;
        return (cmp !== 0 ? cmp : a.name.localeCompare(b.name, 'id')) * dir;
      }
      return a.name.localeCompare(b.name, 'id') * dir;
    });
  }, [
    classFilter,
    dailyRecordByStudentId,
    period,
    records,
    searchQuery,
    sortBy,
    sortDir,
    statusFilter,
    studentPeriodStatsMap,
    students,
  ]);

  // Filtered & sorted raw scan logs (for Weekly/Monthly Log Scan tab)
  const sortedPeriodLogs = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = records.filter((r) => {
      const matchClass = classFilter === 'ALL' || r.className === classFilter;
      const matchStatus =
        statusFilter === 'ALL' || statusFilter === 'BELUM'
          ? true
          : r.status === statusFilter;
      const matchQuery =
        !q ||
        r.studentName.toLowerCase().includes(q) ||
        r.studentNis.toLowerCase().includes(q) ||
        r.room.toLowerCase().includes(q);
      return matchClass && matchStatus && matchQuery;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.studentName.localeCompare(b.studentName, 'id') * dir;
      }
      if (sortBy === 'nis') {
        return a.studentNis.localeCompare(b.studentNis, 'id') * dir;
      }
      if (sortBy === 'className') {
        const cmp = a.className.localeCompare(b.className, 'id');
        return (cmp !== 0 ? cmp : a.studentName.localeCompare(b.studentName, 'id')) * dir;
      }
      if (sortBy === 'status') {
        const cmp = STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];
        return (cmp !== 0 ? cmp : b.scannedAt.localeCompare(a.scannedAt)) * dir;
      }
      return a.scannedAt.localeCompare(b.scannedAt) * dir;
    });
  }, [classFilter, records, searchQuery, sortBy, sortDir, statusFilter]);

  const summary = useMemo(() => {
    const hadir = records.filter((r) => r.status === 'HADIR').length;
    const terlambat = records.filter((r) => r.status === 'TERLAMBAT').length;
    const izin = records.filter((r) => r.status === 'IZIN').length;
    const alpa = records.filter((r) => r.status === 'ALPA').length;
    const uniqueStudentsPresent = new Set(records.map((r) => r.studentId)).size;
    const belum = Math.max(0, students.length - uniqueStudentsPresent);
    return { hadir, terlambat, izin, alpa, belum, totalRecords: records.length };
  }, [records, students.length]);

  const periodDisplayLabel = useMemo(() => {
    if (period === 'weekly') {
      return `Pekanan (${formatDateId(activeRange.startDate)} – ${formatDateId(activeRange.endDate)})`;
    }
    if (period === 'monthly') {
      return `Bulanan (${formatMonthId(month)})`;
    }
    return `Harian (${formatDateId(date)})`;
  }, [activeRange.endDate, activeRange.startDate, date, month, period]);

  const periodFileSlug = useMemo(() => {
    if (period === 'weekly') {
      return `Pekanan_${activeRange.startDate}_sd_${activeRange.endDate}`;
    }
    if (period === 'monthly') {
      return `Bulanan_${month}`;
    }
    return `Harian_${date}`;
  }, [activeRange.endDate, activeRange.startDate, date, month, period]);

  const selectedExamTitle =
    selectedExamId === 'ALL'
      ? 'Absensi Harian / Semua Ujian'
      : exams.find((e) => e.id === selectedExamId)?.title || 'Ujian CBT';

  const renderSortIcon = (field: AttendanceSortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 inline ml-1" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-teal-700 inline ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-teal-700 inline ml-1" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Absensi Siswa Berbasis QR Code</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pindai kartu QR peserta, pantau kehadiran real-time, serta sortir laporan harian, pekanan, dan bulanan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openQrGallery}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-sm font-semibold whitespace-nowrap"
          >
            <QrCode className="w-4 h-4" />
            Lihat & Unduh QR Siswa
          </button>
          {settings && (
            <>
              <button
                type="button"
                onClick={() => void generateParticipantCardsPDF(students, settings)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                Kartu QR PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  generateAttendancePDF(
                    records,
                    sortedStudents,
                    periodDisplayLabel,
                    selectedExamTitle,
                    settings,
                    {
                      period,
                      startDate: activeRange.startDate,
                      endDate: activeRange.endDate,
                      fileSlug: periodFileSlug,
                    }
                  )
                }
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
              >
                <FileText className="w-4 h-4" />
                Rekap PDF
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() =>
              void exportAttendanceExcel(records, periodFileSlug, sortedStudents)
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Period Sorting Bar: Harian | Pekanan | Bulanan */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Calendar className="w-4 h-4 text-teal-700" />
            <span>Sortir Periode:</span>
          </div>
          <div
            role="group"
            aria-label="Sortir Periode Absensi"
            className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200"
          >
            {(
              [
                { id: 'daily', label: 'Harian' },
                { id: 'weekly', label: 'Pekanan' },
                { id: 'monthly', label: 'Bulanan' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelectPeriod(opt.id)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  period === opt.id
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-medium text-slate-500 font-mono tabular-nums">
            {periodDisplayLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleNavigatePeriod(-1)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap"
            title={
              period === 'daily'
                ? 'Hari Sebelumnya'
                : period === 'weekly'
                  ? 'Pekan Sebelumnya'
                  : 'Bulan Sebelumnya'
            }
          >
            <ChevronLeft className="w-4 h-4" />
            {period === 'daily'
              ? 'Kemarin'
              : period === 'weekly'
                ? 'Pekan Lalu'
                : 'Bulan Lalu'}
          </button>

          {period === 'monthly' ? (
            <input
              type="month"
              aria-label="Pilih Bulan Absensi"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs bg-white"
            />
          ) : (
            <input
              type="date"
              aria-label={period === 'daily' ? 'Pilih Tanggal Absensi' : 'Pilih Tanggal Patokan Pekan'}
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setMonth(e.target.value.slice(0, 7));
                  if (period === 'daily') {
                    setScanDate(e.target.value);
                  }
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs bg-white"
            />
          )}

          <button
            type="button"
            onClick={() => handleNavigatePeriod(1)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap"
            title={
              period === 'daily'
                ? 'Hari Berikutnya'
                : period === 'weekly'
                  ? 'Pekan Berikutnya'
                  : 'Bulan Berikutnya'
            }
          >
            {period === 'daily'
              ? 'Besok'
              : period === 'weekly'
                ? 'Pekan Depan'
                : 'Bulan Depan'}
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleJumpToday}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap"
          >
            {period === 'daily'
              ? 'Hari Ini'
              : period === 'weekly'
                ? 'Pekan Ini'
                : 'Bulan Ini'}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Peserta</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {students.length}
          </p>
        </div>
        {period === 'daily' ? (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Tercatat Hadir</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {summary.hadir}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Terlambat / Izin</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                {summary.terlambat} / {summary.izin}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Belum Absen</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-700">
                {summary.belum}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Total Catatan Scan</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
                {summary.totalRecords}{' '}
                <span className="text-xs font-sans font-normal text-slate-500">
                  ({activeDaysInPeriod} hari aktif)
                </span>
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Hadir / Terlambat</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {summary.hadir} / {summary.terlambat}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Izin / Alpa</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                {summary.izin} / {summary.alpa}
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Live QR Scanner Panel */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-teal-400" />
              <h2 className="text-sm font-bold">Pemindai QR Code (Scan QR)</h2>
            </div>
            <span className="text-xs font-mono text-slate-300 tabular-nums">
              {period === 'daily' ? date : scanDate}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Target Session & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tanggal Scan
                </label>
                <input
                  type="date"
                  value={period === 'daily' ? date : scanDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    setScanDate(val);
                    if (period === 'daily') {
                      setDate(val);
                      setMonth(val.slice(0, 7));
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Status Saat Scan
                </label>
                <select
                  value={scanStatusMode}
                  onChange={(e) => setScanStatusMode(e.target.value as 'HADIR' | 'TERLAMBAT')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                >
                  <option value="HADIR">HADIR (Tepat Waktu)</option>
                  <option value="TERLAMBAT">TERLAMBAT</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sesi / Jadwal Ujian
                </label>
                <select
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="ALL">Absensi Harian Umum CBT</option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.subject} — {ex.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Camera Viewport */}
            <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-[4/3] border border-slate-800 flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              <canvas ref={canvasRef} className="hidden" />

              {cameraActive ? (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-48 h-48 border-2 border-teal-400/90 rounded-lg relative shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]">
                    <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[11px] font-medium text-white whitespace-nowrap">
                      Arahkan Kartu QR ke dalam kotak
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center space-y-3">
                  <Camera className="w-10 h-10 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-300 max-w-xs mx-auto">
                    Klik tombol di bawah untuk mengaktifkan kamera dan memindai QR Code pada Kartu Peserta.
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                {cameraError}
              </div>
            )}

            {/* Camera & Image Scan Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={() => void startCamera(selectedDeviceId || undefined)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  Aktifkan Kamera Scan QR
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold whitespace-nowrap"
                >
                  <CameraOff className="w-4 h-4" />
                  Matikan Kamera
                </button>
              )}

              <label className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer whitespace-nowrap">
                <ImageUp className="w-4 h-4" />
                Scan Gambar QR
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageQrUpload}
                  className="hidden"
                />
              </label>
            </div>

            {devices.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pilih Kamera
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedDeviceId(nextId);
                    if (cameraActive) {
                      void startCamera(nextId);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  {devices.map((d, idx) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Kamera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Scan Result Feedback */}
            {scanFeedback && (
              <div
                className={`p-3.5 rounded-lg border text-xs font-semibold flex items-start gap-2 ${
                  scanFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : scanFeedback.type === 'duplicate'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{scanFeedback.text}</span>
              </div>
            )}

            {/* Manual / USB Scanner Input */}
            <form onSubmit={handleManualSubmit} className="pt-3 border-t border-slate-200 space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Input Manual NIS / USB QR Scanner
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Ketik NIS (mis. 2026001) atau CANDYCBT|STU|2026001"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap"
                >
                  Catat Hadir
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Right: Attendance List & Sorting */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          {period !== 'daily' && (
            <div className="px-4 pt-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setPeriodViewTab('summary');
                    if (sortBy === 'scannedAt') {
                      setSortBy('hadirCount');
                      setSortDir('desc');
                    }
                  }}
                  className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    periodViewTab === 'summary'
                      ? 'border-teal-700 text-teal-800 bg-white rounded-t-lg'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Rekap Per Siswa ({sortedStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPeriodViewTab('logs');
                    if (sortBy === 'hadirCount' || sortBy === 'attendanceRate') {
                      setSortBy('scannedAt');
                      setSortDir('desc');
                    }
                  }}
                  className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    periodViewTab === 'logs'
                      ? 'border-teal-700 text-teal-800 bg-white rounded-t-lg'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Riwayat Log Scan ({sortedPeriodLogs.length})
                </button>
              </div>
              <span className="text-[11px] font-mono text-slate-500 pb-2 tabular-nums">
                {activeRange.startDate} s/d {activeRange.endDate}
              </span>
            </div>
          )}

          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="relative flex-1 min-w-[190px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama, NIS, atau ruang..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filter Kelas"
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="ALL">Semua Kelas</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Status"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'ALL' | AttendanceStatus | 'BELUM')
                  }
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="ALL">Semua Status</option>
                  <option value="HADIR">Hadir</option>
                  <option value="TERLAMBAT">Terlambat</option>
                  <option value="IZIN">Izin</option>
                  <option value="ALPA">Alpa</option>
                  {period === 'daily' && <option value="BELUM">Belum Absen</option>}
                </select>

                <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
                  <select
                    aria-label="Urutkan Data"
                    value={sortBy}
                    onChange={(e) => {
                      const nextField = e.target.value as AttendanceSortField;
                      setSortBy(nextField);
                      setSortDir(
                        nextField === 'hadirCount' ||
                          nextField === 'attendanceRate' ||
                          nextField === 'scannedAt'
                          ? 'desc'
                          : 'asc'
                      );
                    }}
                    className="px-2.5 py-2 text-xs bg-white focus:outline-none"
                  >
                    <option value="name">Sortir: Nama</option>
                    <option value="nis">Sortir: NIS</option>
                    <option value="className">Sortir: Kelas</option>
                    {(period === 'daily' || periodViewTab === 'logs') && (
                      <option value="status">Sortir: Status</option>
                    )}
                    <option value="scannedAt">Sortir: Waktu Scan</option>
                    {period !== 'daily' && periodViewTab === 'summary' && (
                      <>
                        <option value="hadirCount">Sortir: Total Hadir</option>
                        <option value="attendanceRate">Sortir: % Kehadiran</option>
                      </>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    title={sortDir === 'asc' ? 'Urutan Naik (A–Z / Kecil)' : 'Urutan Turun (Z–A / Besar)'}
                    className="px-2 py-2 border-l border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1"
                  >
                    {sortDir === 'asc' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-teal-700" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-teal-700" />
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={loadAttendance}
                  title="Muat Ulang"
                  className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {period === 'daily' ? (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('name')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Peserta {renderSortIcon('name')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('className')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Kelas / Ruang {renderSortIcon('className')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('scannedAt')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Waktu & Metode {renderSortIcon('scannedAt')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('status')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Status {renderSortIcon('status')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5 text-right">Ubah / Hapus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        Memuat daftar absensi harian...
                      </td>
                    </tr>
                  ) : sortedStudents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        Tidak ada peserta yang sesuai filter.
                      </td>
                    </tr>
                  ) : (
                    sortedStudents.map((stu) => {
                      const rec = dailyRecordByStudentId.get(stu.id);
                      return (
                        <tr key={stu.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3.5">
                            <p className="font-bold text-slate-900">{stu.name}</p>
                            <p className="font-mono text-slate-500 tabular-nums">{stu.nis}</p>
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600">
                            {stu.className} · {stu.room}
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-600 tabular-nums">
                            {rec ? (
                              <>
                                <span>{new Date(rec.scannedAt).toLocaleTimeString('id-ID')}</span>
                                <span className="block text-[11px] font-sans text-slate-500">
                                  {rec.method === 'QR_CAMERA'
                                    ? 'Kamera QR'
                                    : rec.method === 'QR_IMAGE'
                                      ? 'Gambar QR'
                                      : 'Manual'}
                                </span>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold">
                            {!rec ? (
                              <span className="text-slate-400">BELUM ABSEN</span>
                            ) : rec.status === 'HADIR' ? (
                              <span className="text-emerald-700">HADIR</span>
                            ) : rec.status === 'TERLAMBAT' ? (
                              <span className="text-amber-700">TERLAMBAT</span>
                            ) : rec.status === 'IZIN' ? (
                              <span className="text-sky-700">IZIN</span>
                            ) : (
                              <span className="text-red-700">ALPA</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-right space-x-1 whitespace-nowrap">
                            <select
                              aria-label={`Ubah status absensi ${stu.name}`}
                              value={rec?.status || ''}
                              onChange={(e) => {
                                const val = e.target.value as AttendanceStatus;
                                if (val) void handleQuickMarkStatus(stu, val);
                              }}
                              className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-medium"
                            >
                              <option value="">Set Status...</option>
                              <option value="HADIR">Hadir</option>
                              <option value="TERLAMBAT">Terlambat</option>
                              <option value="IZIN">Izin</option>
                              <option value="ALPA">Alpa</option>
                            </select>
                            {rec && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteRecord(rec.id)}
                                title="Hapus Catatan Absensi"
                                className="p-1 text-slate-400 hover:text-red-600 align-middle"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : periodViewTab === 'summary' ? (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('name')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Peserta {renderSortIcon('name')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('className')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Kelas {renderSortIcon('className')}
                      </button>
                    </th>
                    <th className="py-3 px-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('hadirCount')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        H / T / I / A {renderSortIcon('hadirCount')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('attendanceRate')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Kehadiran {renderSortIcon('attendanceRate')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500">
                        Memuat rekap absensi {period === 'weekly' ? 'pekanan' : 'bulanan'}...
                      </td>
                    </tr>
                  ) : sortedStudents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500">
                        Tidak ada peserta yang sesuai filter.
                      </td>
                    </tr>
                  ) : (
                    sortedStudents.map((stu) => {
                      const stats = studentPeriodStatsMap.get(stu.id) || {
                        hadir: 0,
                        terlambat: 0,
                        izin: 0,
                        alpa: 0,
                        totalMasuk: 0,
                        totalLogs: 0,
                        rate: 0,
                        lastScannedAt: '',
                      };
                      return (
                        <tr key={stu.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3.5">
                            <p className="font-bold text-slate-900">{stu.name}</p>
                            <p className="font-mono text-slate-500 tabular-nums">{stu.nis}</p>
                          </td>
                          <td className="py-2.5 px-3.5 text-slate-600">
                            {stu.className} · {stu.room}
                          </td>
                          <td className="py-2.5 px-2.5 text-center font-mono tabular-nums">
                            <span className="text-emerald-700 font-bold">{stats.hadir}</span>
                            <span className="text-slate-400"> / </span>
                            <span className="text-amber-700 font-semibold">{stats.terlambat}</span>
                            <span className="text-slate-400"> / </span>
                            <span className="text-sky-700 font-semibold">{stats.izin}</span>
                            <span className="text-slate-400"> / </span>
                            <span className="text-red-700 font-semibold">{stats.alpa}</span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right">
                            <div className="inline-flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-teal-600 rounded-full"
                                  style={{ width: `${stats.rate}%` }}
                                />
                              </div>
                              <span className="font-mono font-bold text-slate-900 tabular-nums">
                                {stats.totalMasuk} ({stats.rate}%)
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('scannedAt')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Tanggal & Jam {renderSortIcon('scannedAt')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('name')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Peserta {renderSortIcon('name')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('className')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Kelas {renderSortIcon('className')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5">
                      <button
                        type="button"
                        onClick={() => handleSortHeaderClick('status')}
                        className="inline-flex items-center hover:text-slate-900"
                      >
                        Status {renderSortIcon('status')}
                      </button>
                    </th>
                    <th className="py-3 px-3.5 text-right">Ubah / Hapus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        Memuat log absensi periode...
                      </td>
                    </tr>
                  ) : sortedPeriodLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        Belum ada catatan scan absensi pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    sortedPeriodLogs.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-700">
                          <span className="font-semibold text-slate-900 block">
                            {formatDateId(rec.date)}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {new Date(rec.scannedAt).toLocaleTimeString('id-ID')} ·{' '}
                            {rec.method === 'QR_CAMERA'
                              ? 'Kamera'
                              : rec.method === 'QR_IMAGE'
                                ? 'Gambar'
                                : 'Manual'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <p className="font-bold text-slate-900">{rec.studentName}</p>
                          <p className="font-mono text-slate-500 tabular-nums">{rec.studentNis}</p>
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-600">
                          {rec.className} · {rec.room}
                        </td>
                        <td className="py-2.5 px-3.5 font-semibold">
                          <select
                            aria-label={`Ubah status ${rec.studentName} tanggal ${rec.date}`}
                            value={rec.status}
                            onChange={(e) =>
                              void handleUpdateRecordStatus(
                                rec.id,
                                e.target.value as AttendanceStatus
                              )
                            }
                            className={`px-2 py-1 rounded border border-slate-300 bg-white text-xs font-semibold ${
                              rec.status === 'HADIR'
                                ? 'text-emerald-700'
                                : rec.status === 'TERLAMBAT'
                                  ? 'text-amber-700'
                                  : rec.status === 'IZIN'
                                    ? 'text-sky-700'
                                    : 'text-red-700'
                            }`}
                          >
                            <option value="HADIR">HADIR</option>
                            <option value="TERLAMBAT">TERLAMBAT</option>
                            <option value="IZIN">IZIN</option>
                            <option value="ALPA">ALPA</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteRecord(rec.id)}
                            title="Hapus Catatan Absensi"
                            className="p-1.5 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Student QR Gallery Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-4xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Daftar QR Code Peserta Ujian</h3>
                <p className="text-xs text-slate-300">
                  Unduh QR Code peserta sebagai gambar PNG untuk dicetak atau diuji coba dengan Scan Gambar QR.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
              >
                Tutup
              </button>
            </div>

            <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {students.map((stu) => (
                <div
                  key={stu.id}
                  className="border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center gap-2.5 bg-slate-50"
                >
                  {qrPreviews[stu.id] ? (
                    <img
                      src={qrPreviews[stu.id]}
                      alt={`QR Absensi ${stu.name}`}
                      className="w-36 h-36 rounded-lg border border-slate-200 bg-white p-1"
                    />
                  ) : (
                    <div className="w-36 h-36 bg-slate-200 rounded-lg animate-pulse" />
                  )}
                  <div className="min-w-0 w-full">
                    <p className="text-sm font-bold text-slate-900 truncate">{stu.name}</p>
                    <p className="text-xs font-mono text-slate-500">
                      {stu.nis} · {stu.className}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 w-full">
                    <button
                      type="button"
                      onClick={() => downloadSingleQr(stu)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Unduh PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQrModalOpen(false);
                        void submitQrScan(`CANDYCBT|STU|${stu.nis}`, 'MANUAL');
                      }}
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                      title="Simulasi Scan Hadir"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Hadir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
