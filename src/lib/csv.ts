import type { EnrichedResultSession } from './api';
import type { AttendanceRecord, Student } from '../types/cbt';

function sanitizeCsvFormula(value: string): string {
  // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR)
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '""';
  const str = sanitizeCsvFormula(String(raw).replace(/\r\n|\r|\n/g, ' ').trim());
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCsvContent(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  // Prepend UTF-8 BOM so Microsoft Excel and LibreOffice detect UTF-8 automatically
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatIsoTimestamp(iso?: string): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

export function exportResultsCSV(
  results: EnrichedResultSession[],
  filename = `Backup_Nilai_Ujian_${new Date().toISOString().slice(0, 10)}.csv`
): number {
  const headers = [
    'No',
    'ID_Sesi',
    'NIS',
    'Nama_Peserta',
    'Kelas',
    'Ruang',
    'Mata_Pelajaran',
    'Judul_Ujian',
    'Status_Sesi',
    'Benar_PG',
    'Total_PG',
    'Skor_PG',
    'Skor_Esai',
    'Nilai_Akhir',
    'KKM',
    'Keterangan',
    'Jumlah_Pelanggaran',
    'Waktu_Mulai',
    'Waktu_Selesai',
  ];

  const rows = results.map((r, idx) => [
    idx + 1,
    r.id,
    r.studentNis,
    r.studentName,
    r.className,
    r.room,
    r.subject,
    r.examTitle,
    r.status,
    r.pgCorrect,
    r.pgTotal,
    r.pgScore.toFixed(1),
    r.essayScore.toFixed(1),
    r.finalScore.toFixed(1),
    r.kkm,
    r.finalScore >= r.kkm ? 'TUNTAS' : 'REMEDIAL',
    r.violationCount,
    formatIsoTimestamp(r.startedAt),
    formatIsoTimestamp(r.finishedAt),
  ]);

  const content = buildCsvContent(headers, rows);
  triggerCsvDownload(content, filename);
  return rows.length;
}

export function exportAttendanceCSV(
  records: AttendanceRecord[],
  filename = `Backup_Absensi_Siswa_${new Date().toISOString().slice(0, 10)}.csv`
): number {
  const headers = [
    'No',
    'ID_Absensi',
    'Tanggal',
    'NIS',
    'Nama_Peserta',
    'Kelas',
    'Ruang',
    'Kelompok_Sesi',
    'ID_Ujian',
    'Keterangan_Ujian',
    'Status_Kehadiran',
    'Metode_Scan',
    'Waktu_Scan',
    'Petugas_Scan',
    'Catatan',
  ];

  const rows = records.map((r, idx) => [
    idx + 1,
    r.id,
    r.date,
    r.studentNis,
    r.studentName,
    r.className,
    r.room,
    r.sessionGroup,
    r.examId || '-',
    r.examTitle || 'Absensi Harian Umum CBT',
    r.status,
    r.method,
    formatIsoTimestamp(r.scannedAt),
    r.scannedBy,
    r.notes || '-',
  ]);

  const content = buildCsvContent(headers, rows);
  triggerCsvDownload(content, filename);
  return rows.length;
}

export function exportCombinedBackupCSV(
  students: Student[],
  attendance: AttendanceRecord[],
  results: EnrichedResultSession[],
  filename = `Arsip_Gabungan_Absensi_Nilai_${new Date().toISOString().slice(0, 10)}.csv`
): number {
  const headers = [
    'No',
    'NIS',
    'Nama_Peserta',
    'Kelas',
    'Ruang',
    'Kelompok_Sesi',
    'Total_Hadir',
    'Total_Terlambat',
    'Total_Izin',
    'Total_Alpa',
    'Terakhir_Absen',
    'Jumlah_Ujian',
    'Rata_Rata_Nilai',
    'Nilai_Tertinggi',
    'Rincian_Nilai_Mapel',
  ];

  const rows = students.map((stu, idx) => {
    const stuAtt = attendance.filter((a) => a.studentId === stu.id || a.studentNis === stu.nis);
    const hadir = stuAtt.filter((a) => a.status === 'HADIR').length;
    const terlambat = stuAtt.filter((a) => a.status === 'TERLAMBAT').length;
    const izin = stuAtt.filter((a) => a.status === 'IZIN').length;
    const alpa = stuAtt.filter((a) => a.status === 'ALPA').length;
    const lastScan =
      stuAtt.length > 0
        ? formatIsoTimestamp(
            [...stuAtt].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))[0].scannedAt
          )
        : '-';

    const stuRes = results.filter((r) => r.studentId === stu.id || r.studentNis === stu.nis);
    const avgScore =
      stuRes.length > 0
        ? (stuRes.reduce((sum, r) => sum + r.finalScore, 0) / stuRes.length).toFixed(1)
        : '0.0';
    const maxScore =
      stuRes.length > 0 ? Math.max(...stuRes.map((r) => r.finalScore)).toFixed(1) : '0.0';
    const detail =
      stuRes.length > 0
        ? stuRes
            .map((r) => `${r.subject}: ${r.finalScore.toFixed(1)} (${r.finalScore >= r.kkm ? 'TUNTAS' : 'REMEDIAL'})`)
            .join(' | ')
        : '-';

    return [
      idx + 1,
      stu.nis,
      stu.name,
      stu.className,
      stu.room,
      stu.sessionGroup,
      hadir,
      terlambat,
      izin,
      alpa,
      lastScan,
      stuRes.length,
      avgScore,
      maxScore,
      detail,
    ];
  });

  const content = buildCsvContent(headers, rows);
  triggerCsvDownload(content, filename);
  return rows.length;
}
