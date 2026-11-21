import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import type { SheetData } from 'write-excel-file/browser';
import type { EnrichedResultSession } from './api';
import type { AttendanceRecord, QuestionType, Student } from '../types/cbt';

export interface ParsedExcelQuestion {
  rowNumber: number;
  type: QuestionType;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E' | '';
  weight: number;
  issues: string[];
}

export interface ParsedExcelStudent {
  rowNumber: number;
  nis: string;
  name: string;
  className: string;
  room: string;
  sessionGroup: string;
  password: string;
  issues: string[];
}

export async function downloadQuestionTemplate(): Promise<void> {
  const data: SheetData = [
    [
      { value: 'No', fontWeight: 'bold' },
      { value: 'Jenis Soal', fontWeight: 'bold' },
      { value: 'Pertanyaan', fontWeight: 'bold' },
      { value: 'Pilihan A', fontWeight: 'bold' },
      { value: 'Pilihan B', fontWeight: 'bold' },
      { value: 'Pilihan C', fontWeight: 'bold' },
      { value: 'Pilihan D', fontWeight: 'bold' },
      { value: 'Pilihan E', fontWeight: 'bold' },
      { value: 'Kunci Jawaban', fontWeight: 'bold' },
      { value: 'Bobot', fontWeight: 'bold' },
    ],
    [
      { type: Number, value: 1 },
      { type: String, value: 'PG' },
      { type: String, value: 'Ibu kota negara Republik Indonesia yang baru sesuai UU IKN adalah ...' },
      { type: String, value: 'Jakarta' },
      { type: String, value: 'Bandung' },
      { type: String, value: 'Nusantara' },
      { type: String, value: 'Surabaya' },
      { type: String, value: 'Balikpapan' },
      { type: String, value: 'C' },
      { type: Number, value: 10 },
    ],
    [
      { type: Number, value: 2 },
      { type: String, value: 'PG' },
      { type: String, value: 'Hasil dari 15 x 4 + 20 : 5 adalah ...' },
      { type: String, value: '16' },
      { type: String, value: '64' },
      { type: String, value: '75' },
      { type: String, value: '80' },
      { type: String, value: '100' },
      { type: String, value: 'B' },
      { type: Number, value: 10 },
    ],
    [
      { type: Number, value: 3 },
      { type: String, value: 'ESAI' },
      { type: String, value: 'Jelaskan secara singkat perbedaan antara topologi jaringan Star dan Mesh!' },
      { type: String, value: '' },
      { type: String, value: '' },
      { type: String, value: '' },
      { type: String, value: '' },
      { type: String, value: '' },
      { type: String, value: '' },
      { type: Number, value: 20 },
    ],
  ];

  await writeXlsxFile([
    {
      sheet: 'Template_Soal',
      data,
      columns: [
        { width: 6 },
        { width: 12 },
        { width: 52 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 15 },
        { width: 8 },
      ],
    },
  ]).toFile('Template_Import_Soal_CandyCBT.xlsx');
}

export async function downloadStudentTemplate(): Promise<void> {
  const data: SheetData = [
    [
      { value: 'No', fontWeight: 'bold' },
      { value: 'NIS', fontWeight: 'bold' },
      { value: 'Nama Lengkap', fontWeight: 'bold' },
      { value: 'Kelas', fontWeight: 'bold' },
      { value: 'Ruang', fontWeight: 'bold' },
      { value: 'Sesi', fontWeight: 'bold' },
      { value: 'Password', fontWeight: 'bold' },
    ],
    [
      { type: Number, value: 1 },
      { type: String, value: '2026101' },
      { type: String, value: 'Nadia Kusuma Wardani' },
      { type: String, value: 'XII TKJ 1' },
      { type: String, value: 'LAB-01' },
      { type: String, value: 'Sesi 1' },
      { type: String, value: '123' },
    ],
    [
      { type: Number, value: 2 },
      { type: String, value: '2026102' },
      { type: String, value: 'Rizky Maulana Pratama' },
      { type: String, value: 'XII RPL 1' },
      { type: String, value: 'LAB-02' },
      { type: String, value: 'Sesi 2' },
      { type: String, value: '123' },
    ],
  ];

  await writeXlsxFile([
    {
      sheet: 'Template_Peserta',
      data,
      columns: [
        { width: 6 },
        { width: 14 },
        { width: 30 },
        { width: 14 },
        { width: 12 },
        { width: 10 },
        { width: 12 },
      ],
    },
  ]).toFile('Template_Import_Peserta_CandyCBT.xlsx');
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

async function readSpreadsheetRows(file: File): Promise<Record<string, string>[]> {
  let rawGrid: unknown[][];
  if (file.name.toLowerCase().endsWith('.csv')) {
    const txt = await file.text();
    rawGrid = parseCsvText(txt);
  } else {
    rawGrid = await readSheet(file);
  }

  if (!rawGrid || rawGrid.length < 2) {
    throw new Error('File Excel kosong atau tidak memiliki baris data di bawah header.');
  }

  const headers = rawGrid[0].map((h) => String(h ?? '').trim());
  const objects: Record<string, string>[] = [];

  for (let r = 1; r < rawGrid.length; r++) {
    const row = rawGrid[r];
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, cIdx) => {
      if (!h) return;
      const val = String(row[cIdx] ?? '').trim();
      if (val) hasValue = true;
      obj[h] = val;
    });
    if (hasValue) objects.push(obj);
  }
  return objects;
}

function getField(row: Record<string, string>, candidates: string[]): string {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const normalizedCand = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [k, v] of entries) {
      const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normKey === normalizedCand) {
        return v.trim();
      }
    }
  }
  return '';
}

export async function parseQuestionExcel(file: File): Promise<ParsedExcelQuestion[]> {
  const rows = await readSpreadsheetRows(file);
  const validKeys = ['A', 'B', 'C', 'D', 'E'];

  return rows
    .map((row, idx) => {
      const rowNum = idx + 2;
      const rawType = getField(row, ['Jenis Soal', 'Jenis', 'Type', 'Tipe']).toUpperCase();
      const type: QuestionType = rawType === 'ESAI' || rawType === 'ESSAY' ? 'ESAI' : 'PG';
      const text = getField(row, ['Pertanyaan', 'Soal', 'Question', 'Teks Soal']);
      const optionA = getField(row, ['Pilihan A', 'Opsi A', 'A', 'PilA']);
      const optionB = getField(row, ['Pilihan B', 'Opsi B', 'B', 'PilB']);
      const optionC = getField(row, ['Pilihan C', 'Opsi C', 'C', 'PilC']);
      const optionD = getField(row, ['Pilihan D', 'Opsi D', 'D', 'PilD']);
      const optionE = getField(row, ['Pilihan E', 'Opsi E', 'E', 'PilE']);
      const rawKey = getField(row, ['Kunci Jawaban', 'Kunci', 'Jawaban', 'Answer']).toUpperCase();
      const correctAnswer: ParsedExcelQuestion['correctAnswer'] =
        type === 'PG' && validKeys.includes(rawKey)
          ? (rawKey as 'A' | 'B' | 'C' | 'D' | 'E')
          : '';
      const rawWeight = Number(getField(row, ['Bobot', 'Skor', 'Weight', 'Poin']) || '10');
      const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 10;

      const issues: string[] = [];
      if (!text) issues.push('Pertanyaan kosong');
      if (type === 'PG') {
        if (!optionA || !optionB) issues.push('Minimal Pilihan A dan B harus terisi');
        if (!correctAnswer) issues.push('Kunci jawaban PG harus A–E');
      }

      return {
        rowNumber: rowNum,
        type,
        text,
        optionA,
        optionB,
        optionC,
        optionD,
        optionE,
        correctAnswer,
        weight,
        issues,
      };
    })
    .filter((item) => item.text || item.optionA || item.optionB);
}

export async function parseStudentExcel(file: File): Promise<ParsedExcelStudent[]> {
  const rows = await readSpreadsheetRows(file);

  return rows
    .map((row, idx) => {
      const nis = getField(row, ['NIS', 'Username', 'No Peserta', 'NISN']);
      const name = getField(row, ['Nama Lengkap', 'Nama', 'Nama Peserta', 'Name']);
      const className = getField(row, ['Kelas', 'Class', 'Rombel']) || 'XII TKJ 1';
      const room = getField(row, ['Ruang', 'Room', 'Lab']) || 'LAB-01';
      const sessionGroup = getField(row, ['Sesi', 'Session']) || 'Sesi 1';
      const password = getField(row, ['Password', 'Pass', 'Sandi']) || '123';

      const issues: string[] = [];
      if (!nis) issues.push('NIS wajib diisi');
      if (!name) issues.push('Nama Lengkap wajib diisi');

      return {
        rowNumber: idx + 2,
        nis,
        name,
        className,
        room,
        sessionGroup,
        password,
        issues,
      };
    })
    .filter((item) => item.nis || item.name);
}

export async function exportResultsExcel(
  results: EnrichedResultSession[],
  filename = 'Rekap_Nilai_CandyCBT.xlsx'
): Promise<void> {
  const data: SheetData = [
    [
      { value: 'No', fontWeight: 'bold' },
      { value: 'NIS', fontWeight: 'bold' },
      { value: 'Nama Peserta', fontWeight: 'bold' },
      { value: 'Kelas', fontWeight: 'bold' },
      { value: 'Ruang', fontWeight: 'bold' },
      { value: 'Mata Pelajaran', fontWeight: 'bold' },
      { value: 'Benar PG', fontWeight: 'bold' },
      { value: 'Total PG', fontWeight: 'bold' },
      { value: 'Skor PG', fontWeight: 'bold' },
      { value: 'Skor Esai', fontWeight: 'bold' },
      { value: 'Nilai Akhir', fontWeight: 'bold' },
      { value: 'KKM', fontWeight: 'bold' },
      { value: 'Keterangan', fontWeight: 'bold' },
      { value: 'Pelanggaran', fontWeight: 'bold' },
    ],
    ...results.map((r, idx) => [
      { type: Number, value: idx + 1 },
      { type: String, value: r.studentNis },
      { type: String, value: r.studentName },
      { type: String, value: r.className },
      { type: String, value: r.room },
      { type: String, value: r.subject },
      { type: Number, value: r.pgCorrect },
      { type: Number, value: r.pgTotal },
      { type: Number, value: r.pgScore },
      { type: Number, value: r.essayScore },
      { type: Number, value: r.finalScore },
      { type: Number, value: r.kkm },
      { type: String, value: r.finalScore >= r.kkm ? 'TUNTAS' : 'REMEDIAL' },
      { type: Number, value: r.violationCount },
    ]),
  ];

  await writeXlsxFile([
    {
      sheet: 'Rekap_Nilai',
      data,
    },
  ]).toFile(filename);
}

export async function exportAttendanceExcel(
  records: AttendanceRecord[],
  periodSlug: string,
  students: Student[] = []
): Promise<void> {
  const logData: SheetData = [
    [
      { value: 'No', fontWeight: 'bold' },
      { value: 'Tanggal', fontWeight: 'bold' },
      { value: 'NIS', fontWeight: 'bold' },
      { value: 'Nama Peserta', fontWeight: 'bold' },
      { value: 'Kelas', fontWeight: 'bold' },
      { value: 'Ruang', fontWeight: 'bold' },
      { value: 'Sesi', fontWeight: 'bold' },
      { value: 'Keterangan Ujian', fontWeight: 'bold' },
      { value: 'Status Kehadiran', fontWeight: 'bold' },
      { value: 'Metode', fontWeight: 'bold' },
      { value: 'Waktu Scan', fontWeight: 'bold' },
    ],
    ...records.map((r, idx) => [
      { type: Number, value: idx + 1 },
      { type: String, value: r.date },
      { type: String, value: r.studentNis },
      { type: String, value: r.studentName },
      { type: String, value: r.className },
      { type: String, value: r.room },
      { type: String, value: r.sessionGroup },
      { type: String, value: r.examTitle },
      { type: String, value: r.status },
      { type: String, value: r.method },
      { type: String, value: new Date(r.scannedAt).toLocaleTimeString('id-ID') },
    ]),
  ];

  const sheets: { sheet: string; data: SheetData }[] = [
    { sheet: 'Log_Scan_Absensi', data: logData },
  ];

  if (students.length > 0) {
    const summaryData: SheetData = [
      [
        { value: 'No', fontWeight: 'bold' },
        { value: 'NIS', fontWeight: 'bold' },
        { value: 'Nama Peserta', fontWeight: 'bold' },
        { value: 'Kelas', fontWeight: 'bold' },
        { value: 'Ruang', fontWeight: 'bold' },
        { value: 'Hadir', fontWeight: 'bold' },
        { value: 'Terlambat', fontWeight: 'bold' },
        { value: 'Izin', fontWeight: 'bold' },
        { value: 'Alpa', fontWeight: 'bold' },
        { value: 'Total Masuk (Hadir+Terlambat)', fontWeight: 'bold' },
      ],
      ...students.map((stu, idx) => {
        const stuRecs = records.filter((r) => r.studentId === stu.id);
        const hCount = stuRecs.filter((r) => r.status === 'HADIR').length;
        const tCount = stuRecs.filter((r) => r.status === 'TERLAMBAT').length;
        const iCount = stuRecs.filter((r) => r.status === 'IZIN').length;
        const aCount = stuRecs.filter((r) => r.status === 'ALPA').length;
        return [
          { type: Number, value: idx + 1 },
          { type: String, value: stu.nis },
          { type: String, value: stu.name },
          { type: String, value: stu.className },
          { type: String, value: stu.room },
          { type: Number, value: hCount },
          { type: Number, value: tCount },
          { type: Number, value: iCount },
          { type: Number, value: aCount },
          { type: Number, value: hCount + tCount },
        ];
      }),
    ];
    sheets.push({ sheet: 'Rekap_Per_Siswa', data: summaryData });
  }

  await writeXlsxFile(sheets).toFile(`Absensi_Siswa_QR_${periodSlug}.xlsx`);
}

