import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  dbFlushChanges,
  dbGetDocsVersion,
  dbLoadDocsAndPresence,
  dbLoadPresence,
  dbPurgeOldEvents,
  getIsUsingPostgres,
  onDbEngineFailover,
} from './db.ts';
import { hashPassword } from './auth.ts';
import type {
  AdminAccount,
  AttendanceRecord,
  BroadcastNotice,
  ExamSchedule,
  ExamSession,
  LearningMaterial,
  Question,
  QuestionBank,
  SchoolSettings,
  Student,
  TeacherAccount,
  ViolationLog,
} from '../src/types/cbt.ts';

export interface CbtDatabase {
  settings: SchoolSettings;
  admins: AdminAccount[];
  teachers: TeacherAccount[];
  students: Student[];
  banks: QuestionBank[];
  exams: ExamSchedule[];
  sessions: ExamSession[];
  violations: ViolationLog[];
  broadcasts: BroadcastNotice[];
  attendance: AttendanceRecord[];
  materials: LearningMaterial[];
}

function createDefaultTeachers(nowIso: string = new Date().toISOString()): TeacherAccount[] {
  const defaultHash = hashPassword('guru123');
  return [
    {
      id: 'guru-1',
      nip: 'guru1',
      fullName: 'Dra. Siti Aminah, M.Pd.',
      subject: 'Matematika Wajib',
      passwordHash: defaultHash,
      isActive: true,
      createdAt: nowIso,
    },
    {
      id: 'guru-2',
      nip: 'guru2',
      fullName: 'Budi Santoso, S.Kom.',
      subject: 'Administrasi Infrastruktur Jaringan',
      passwordHash: defaultHash,
      isActive: true,
      createdAt: nowIso,
    },
    {
      id: 'guru-3',
      nip: 'guru3',
      fullName: 'Rina Kusuma, S.Pd.',
      subject: 'Bahasa Indonesia',
      passwordHash: defaultHash,
      isActive: true,
      createdAt: nowIso,
    },
  ];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'cbt-store.json');

export function generateTokenCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[crypto.randomInt(0, chars.length)];
  }
  return result;
}

function createInitialSeed(): CbtDatabase {
  const now = new Date().toISOString();
  const todayDate = now.slice(0, 10);

  const mathQuestions: Question[] = [
    {
      id: 'q-mat-1',
      number: 1,
      type: 'PG',
      text: 'Diketahui fungsi f(x) = 3x² - 4x + 5. Nilai dari f(2) adalah ...',
      optionA: '7',
      optionB: '9',
      optionC: '11',
      optionD: '13',
      optionE: '15',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-mat-2',
      number: 2,
      type: 'PG',
      text: 'Nilai dari lim (x -> 3) (x² - 9) / (x - 3) adalah ...',
      optionA: '0',
      optionB: '3',
      optionC: '6',
      optionD: '9',
      optionE: 'Tak terdefinisi',
      correctAnswer: 'C',
      weight: 10,
    },
    {
      id: 'q-mat-3',
      number: 3,
      type: 'PG',
      text: 'Jika matriks A = [[2, 1], [4, 3]], maka determinan dari matriks A adalah ...',
      optionA: '1',
      optionB: '2',
      optionC: '4',
      optionD: '6',
      optionE: '10',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-mat-4',
      number: 4,
      type: 'PG',
      text: 'Suku ke-10 dari barisan aritmetika 4, 7, 10, 13, ... adalah ...',
      optionA: '28',
      optionB: '31',
      optionC: '34',
      optionD: '37',
      optionE: '40',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-mat-5',
      number: 5,
      type: 'PG',
      text: 'Turunan pertama dari fungsi f(x) = 2x³ + 5x² - 7x + 1 adalah ...',
      optionA: '6x² + 10x - 7',
      optionB: '6x² + 5x - 7',
      optionC: '3x² + 10x - 7',
      optionD: '6x² + 10x + 1',
      optionE: '2x² + 10x - 7',
      correctAnswer: 'A',
      weight: 10,
    },
    {
      id: 'q-mat-6',
      number: 6,
      type: 'PG',
      text: 'Sebuah dadu bermata enam dilempar satu kali. Peluang munculnya mata dadu bilangan prima adalah ...',
      optionA: '1/6',
      optionB: '1/3',
      optionC: '1/2',
      optionD: '2/3',
      optionE: '5/6',
      correctAnswer: 'C',
      weight: 10,
    },
    {
      id: 'q-mat-7',
      number: 7,
      type: 'PG',
      text: 'Rata-rata nilai ulangan 5 siswa adalah 80. Jika ditambah nilai 1 siswa lagi, rata-ratanya menjadi 82. Nilai siswa yang baru bergabung adalah ...',
      optionA: '88',
      optionB: '90',
      optionC: '92',
      optionD: '94',
      optionE: '96',
      correctAnswer: 'C',
      weight: 10,
    },
    {
      id: 'q-mat-8',
      number: 8,
      type: 'PG',
      text: 'Himpunan penyelesaian dari persamaan kuadrat x² - 5x + 6 = 0 adalah ...',
      optionA: '{-2, -3}',
      optionB: '{2, 3}',
      optionC: '{1, 6}',
      optionD: '{-1, 6}',
      optionE: '{2, -3}',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-mat-9',
      number: 9,
      type: 'ESAI',
      text: 'Jelaskan langkah-langkah menentukan nilai maksimum dari fungsi objektif f(x, y) = 4x + 5y pada sistem pertidaksamaan linear dua variabel!',
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      optionE: '',
      correctAnswer: '',
      weight: 20,
    },
  ];

  const tkjQuestions: Question[] = [
    {
      id: 'q-tkj-1',
      number: 1,
      type: 'PG',
      text: 'Protokol yang berfungsi menerjemahkan nama domain menjadi alamat IP pada jaringan komputer adalah ...',
      optionA: 'DHCP',
      optionB: 'DNS',
      optionC: 'HTTP',
      optionD: 'FTP',
      optionE: 'SMTP',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-tkj-2',
      number: 2,
      type: 'PG',
      text: 'Subnet mask default untuk IP Address kelas C (192.168.10.1/24) adalah ...',
      optionA: '255.0.0.0',
      optionB: '255.255.0.0',
      optionC: '255.255.255.0',
      optionD: '255.255.255.128',
      optionE: '255.255.255.252',
      correctAnswer: 'C',
      weight: 10,
    },
    {
      id: 'q-tkj-3',
      number: 3,
      type: 'PG',
      text: 'Port default yang digunakan oleh layanan SSH (Secure Shell) adalah ...',
      optionA: '21',
      optionB: '22',
      optionC: '23',
      optionD: '80',
      optionE: '443',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-tkj-4',
      number: 4,
      type: 'PG',
      text: 'Perintah pada sistem operasi Linux untuk memeriksa konektivitas jaringan menuju host tujuan adalah ...',
      optionA: 'ls -la',
      optionB: 'chmod',
      optionC: 'ping',
      optionD: 'mkdir',
      optionE: 'grep',
      correctAnswer: 'C',
      weight: 10,
    },
    {
      id: 'q-tkj-5',
      number: 5,
      type: 'PG',
      text: 'Perangkat jaringan yang bekerja pada Layer 3 OSI Model dan bertugas merutekan paket antar jaringan berbeda adalah ...',
      optionA: 'Hub',
      optionB: 'Repeater',
      optionC: 'Switch Unmanaged',
      optionD: 'Router',
      optionE: 'Access Point',
      correctAnswer: 'D',
      weight: 10,
    },
    {
      id: 'q-tkj-6',
      number: 6,
      type: 'ESAI',
      text: 'Uraikan fungsi VLAN (Virtual Local Area Network) dalam meningkatkan keamanan dan efisiensi trafik jaringan di lingkungan sekolah!',
      optionA: '',
      optionB: '',
      optionC: '',
      optionD: '',
      optionE: '',
      correctAnswer: '',
      weight: 20,
    },
  ];

  const indoQuestions: Question[] = [
    {
      id: 'q-ind-1',
      number: 1,
      type: 'PG',
      text: 'Kalimat utama yang terletak di awal paragraf dan diikuti kalimat penjelas disebut paragraf ...',
      optionA: 'Induktif',
      optionB: 'Deduktif',
      optionC: 'Campuran',
      optionD: 'Naratif',
      optionE: 'Deskriptif',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-ind-2',
      number: 2,
      type: 'PG',
      text: 'Penulisan kata baku sesuai KBBI yang paling tepat di bawah ini adalah ...',
      optionA: 'Aktifitas',
      optionB: 'Analisa',
      optionC: 'Apotik',
      optionD: 'Praktik',
      optionE: 'Sistim',
      correctAnswer: 'D',
      weight: 10,
    },
    {
      id: 'q-ind-3',
      number: 3,
      type: 'PG',
      text: 'Bagian struktur teks laporan hasil observasi yang berisi rincian sifat atau ciri objek yang diamati adalah ...',
      optionA: 'Pernyataan umum',
      optionB: 'Deskripsi bagian',
      optionC: 'Simpulan',
      optionD: 'Orientasi',
      optionE: 'Koda',
      correctAnswer: 'B',
      weight: 10,
    },
    {
      id: 'q-ind-4',
      number: 4,
      type: 'PG',
      text: 'Penggunaan tanda baca koma (,) yang sesuai dengan EYD V adalah ...',
      optionA: 'Saya membeli buku, pensil dan penghapus.',
      optionB: 'Meskipun hujan deras, ia tetap berangkat ke sekolah.',
      optionC: 'Ibu berkata, bahwa rapat dimulai pukul delapan.',
      optionD: 'Siswa yang rajin, akan meraih prestasi.',
      optionE: 'Dia ingin hadir tetapi, waktunya sempit.',
      correctAnswer: 'B',
      weight: 10,
    },
  ];

  const students: Student[] = [
    { id: 'stu-1', nis: '2026001', name: 'Ahmad Fauzi Ramadhan', className: 'XII TKJ 1', room: 'LAB-01', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-2', nis: '2026002', name: 'Aulia Putri Maharani', className: 'XII TKJ 1', room: 'LAB-01', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-3', nis: '2026003', name: 'Bagas Pratama Wijaya', className: 'XII TKJ 1', room: 'LAB-01', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-4', nis: '2026004', name: 'Citra Dewi Lestari', className: 'XII TKJ 1', room: 'LAB-01', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-5', nis: '2026005', name: 'Dimas Saputra Nugroho', className: 'XII TKJ 2', room: 'LAB-02', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-6', nis: '2026006', name: 'Eka Rahmawati', className: 'XII TKJ 2', room: 'LAB-02', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-7', nis: '2026007', name: 'Fajar Hidayatullah', className: 'XII TKJ 2', room: 'LAB-02', sessionGroup: 'Sesi 1', password: '123' },
    { id: 'stu-8', nis: '2026008', name: 'Gita Nirmala Sari', className: 'XII RPL 1', room: 'LAB-03', sessionGroup: 'Sesi 2', password: '123' },
    { id: 'stu-9', nis: '2026009', name: 'Hendra Kurniawan', className: 'XII RPL 1', room: 'LAB-03', sessionGroup: 'Sesi 2', password: '123' },
    { id: 'stu-10', nis: '2026010', name: 'Indah Permatasari', className: 'XII RPL 1', room: 'LAB-03', sessionGroup: 'Sesi 2', password: '123' },
  ];

  const teachers = createDefaultTeachers(now);

  const banks: QuestionBank[] = [
    {
      id: 'bank-mat-12',
      code: 'MAT-PAS-XII',
      subject: 'Matematika Wajib',
      gradeLevel: 'XII',
      teacherId: 'guru-1',
      teacherName: 'Dra. Siti Aminah, M.Pd.',
      kkm: 75,
      pgWeightPercent: 80,
      essayWeightPercent: 20,
      questions: mathQuestions,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bank-tkj-12',
      code: 'AIJ-US-XII',
      subject: 'Administrasi Infrastruktur Jaringan',
      gradeLevel: 'XII TKJ',
      teacherId: 'guru-2',
      teacherName: 'Budi Santoso, S.Kom.',
      kkm: 78,
      pgWeightPercent: 80,
      essayWeightPercent: 20,
      questions: tkjQuestions,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bank-ind-12',
      code: 'BIND-PAS-XII',
      subject: 'Bahasa Indonesia',
      gradeLevel: 'XII',
      teacherId: 'guru-3',
      teacherName: 'Rina Kusuma, S.Pd.',
      kkm: 75,
      pgWeightPercent: 100,
      essayWeightPercent: 0,
      questions: indoQuestions,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const exams: ExamSchedule[] = [
    {
      id: 'exam-mat-1',
      title: 'Penilaian Akhir Semester — Matematika Wajib',
      bankId: 'bank-mat-12',
      subject: 'Matematika Wajib',
      targetClasses: ['XII TKJ 1', 'XII TKJ 2', 'XII RPL 1'],
      durationMinutes: 90,
      token: 'CNDY26',
      tokenUpdatedAt: now,
      isActive: true,
      randomizeQuestions: true,
      randomizeOptions: true,
      showScoreAfterFinish: true,
      antiCheatEnabled: true,
      maxViolations: 3,
      startDate: todayDate,
      endDate: todayDate,
      createdAt: now,
    },
    {
      id: 'exam-tkj-1',
      title: 'Ujian Kompetensi Kejuruan — Infrastruktur Jaringan',
      bankId: 'bank-tkj-12',
      subject: 'Administrasi Infrastruktur Jaringan',
      targetClasses: ['XII TKJ 1', 'XII TKJ 2'],
      durationMinutes: 60,
      token: 'TKJ88M',
      tokenUpdatedAt: now,
      isActive: true,
      randomizeQuestions: false,
      randomizeOptions: true,
      showScoreAfterFinish: true,
      antiCheatEnabled: true,
      maxViolations: 3,
      startDate: todayDate,
      endDate: todayDate,
      createdAt: now,
    },
  ];

  const completedStarted = new Date(Date.now() - 48 * 60 * 1000).toISOString();
  const completedEnded = new Date(Date.now() - 12 * 60 * 1000).toISOString();

  const sessions: ExamSession[] = [
    {
      id: 'sess-demo-2',
      examId: 'exam-mat-1',
      studentId: 'stu-2',
      studentNis: '2026002',
      studentName: 'Aulia Putri Maharani',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      status: 'SELESAI',
      questionOrder: mathQuestions.map((q) => q.id),
      optionOrders: {},
      answers: {
        'q-mat-1': { questionId: 'q-mat-1', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-2': { questionId: 'q-mat-2', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-3': { questionId: 'q-mat-3', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-4': { questionId: 'q-mat-4', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-5': { questionId: 'q-mat-5', answer: 'A', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-6': { questionId: 'q-mat-6', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-7': { questionId: 'q-mat-7', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-8': { questionId: 'q-mat-8', answer: 'A', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-9': {
          questionId: 'q-mat-9',
          answer: '1. Gambar daerah himpunan penyelesaian. 2. Tentukan titik pojok. 3. Uji nilai f(x,y) pada setiap titik pojok untuk mencari nilai maksimum.',
          isDoubtful: false,
          essayScore: 90,
          updatedAt: completedEnded,
        },
      },
      currentQuestionIndex: 8,
      startedAt: completedStarted,
      endsAt: new Date(Date.now() + 42 * 60 * 1000).toISOString(),
      finishedAt: completedEnded,
      extraMinutes: 0,
      violationCount: 0,
      pgCorrect: 7,
      pgTotal: 8,
      pgScore: 87.5,
      essayScore: 90,
      finalScore: 88,
      isOnline: false,
      lastHeartbeatAt: completedEnded,
    },
    {
      id: 'sess-demo-3',
      examId: 'exam-mat-1',
      studentId: 'stu-3',
      studentNis: '2026003',
      studentName: 'Bagas Pratama Wijaya',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      status: 'SELESAI',
      questionOrder: mathQuestions.map((q) => q.id),
      optionOrders: {},
      answers: {
        'q-mat-1': { questionId: 'q-mat-1', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-2': { questionId: 'q-mat-2', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-3': { questionId: 'q-mat-3', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-4': { questionId: 'q-mat-4', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-5': { questionId: 'q-mat-5', answer: 'A', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-6': { questionId: 'q-mat-6', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-7': { questionId: 'q-mat-7', answer: 'A', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-8': { questionId: 'q-mat-8', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-9': {
          questionId: 'q-mat-9',
          answer: 'Menentukan titik potong sumbu X dan Y lalu mensubstitusi ke fungsi objektif.',
          isDoubtful: false,
          essayScore: 70,
          updatedAt: completedEnded,
        },
      },
      currentQuestionIndex: 8,
      startedAt: completedStarted,
      endsAt: new Date(Date.now() + 42 * 60 * 1000).toISOString(),
      finishedAt: completedEnded,
      extraMinutes: 0,
      violationCount: 1,
      lastViolationReason: 'Berpindah tab atau jendela browser',
      pgCorrect: 5,
      pgTotal: 8,
      pgScore: 62.5,
      essayScore: 70,
      finalScore: 64,
      isOnline: false,
      lastHeartbeatAt: completedEnded,
    },
    {
      id: 'sess-demo-4',
      examId: 'exam-mat-1',
      studentId: 'stu-4',
      studentNis: '2026004',
      studentName: 'Citra Dewi Lestari',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      status: 'SELESAI',
      questionOrder: mathQuestions.map((q) => q.id),
      optionOrders: {},
      answers: {
        'q-mat-1': { questionId: 'q-mat-1', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-2': { questionId: 'q-mat-2', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-3': { questionId: 'q-mat-3', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-4': { questionId: 'q-mat-4', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-5': { questionId: 'q-mat-5', answer: 'A', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-6': { questionId: 'q-mat-6', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-7': { questionId: 'q-mat-7', answer: 'C', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-8': { questionId: 'q-mat-8', answer: 'B', isDoubtful: false, updatedAt: completedEnded },
        'q-mat-9': {
          questionId: 'q-mat-9',
          answer: 'Uji titik pojok dari daerah bersih sistem pertidaksamaan untuk memperoleh nilai f(x,y) terbesar.',
          isDoubtful: false,
          essayScore: 95,
          updatedAt: completedEnded,
        },
      },
      currentQuestionIndex: 8,
      startedAt: completedStarted,
      endsAt: new Date(Date.now() + 42 * 60 * 1000).toISOString(),
      finishedAt: completedEnded,
      extraMinutes: 0,
      violationCount: 0,
      pgCorrect: 8,
      pgTotal: 8,
      pgScore: 100,
      essayScore: 95,
      finalScore: 99,
      isOnline: false,
      lastHeartbeatAt: completedEnded,
    },
  ];

  const violations: ViolationLog[] = [
    {
      id: 'viol-demo-1',
      sessionId: 'sess-demo-3',
      examId: 'exam-mat-1',
      examTitle: 'Penilaian Akhir Semester — Matematika Wajib',
      studentId: 'stu-3',
      studentNis: '2026003',
      studentName: 'Bagas Pratama Wijaya',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      type: 'TAB_SWITCH',
      description: 'Peserta berpindah ke tab atau jendela lain saat ujian berlangsung',
      countAtTime: 1,
      triggeredBlock: false,
      timestamp: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
    },
  ];

  const attendance: AttendanceRecord[] = [
    {
      id: 'att-demo-2',
      date: todayDate,
      examId: 'exam-mat-1',
      examTitle: 'Penilaian Akhir Semester — Matematika Wajib',
      studentId: 'stu-2',
      studentNis: '2026002',
      studentName: 'Aulia Putri Maharani',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      sessionGroup: 'Sesi 1',
      status: 'HADIR',
      method: 'QR_CAMERA',
      scannedAt: completedStarted,
      scannedBy: 'Proktor Utama',
    },
    {
      id: 'att-demo-3',
      date: todayDate,
      examId: 'exam-mat-1',
      examTitle: 'Penilaian Akhir Semester — Matematika Wajib',
      studentId: 'stu-3',
      studentNis: '2026003',
      studentName: 'Bagas Pratama Wijaya',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      sessionGroup: 'Sesi 1',
      status: 'TERLAMBAT',
      method: 'QR_CAMERA',
      scannedAt: completedStarted,
      scannedBy: 'Proktor Utama',
    },
    {
      id: 'att-demo-4',
      date: todayDate,
      examId: 'exam-mat-1',
      examTitle: 'Penilaian Akhir Semester — Matematika Wajib',
      studentId: 'stu-4',
      studentNis: '2026004',
      studentName: 'Citra Dewi Lestari',
      className: 'XII TKJ 1',
      room: 'LAB-01',
      sessionGroup: 'Sesi 1',
      status: 'HADIR',
      method: 'QR_CAMERA',
      scannedAt: completedStarted,
      scannedBy: 'Proktor Utama',
    },
  ];

  const materials: LearningMaterial[] = [
    {
      id: 'mat-mat-1',
      title: 'Ringkasan Materi & Rumus Cepat Turunan Fungsi Aljabar',
      subject: 'Matematika Wajib',
      gradeLevel: 'XII',
      targetClasses: ['XII TKJ 1', 'XII TKJ 2', 'XII RPL 1'],
      materialType: 'ARTIKEL',
      summary: 'Panduan inti aturan pangkat, perkalian, pembagian, dan aturan rantai untuk persiapan ujian.',
      content:
        '1. Aturan Pangkat: Jika f(x) = a·x^n, maka f\'(x) = a·n·x^(n-1).\n2. Aturan Perkalian: (u·v)\' = u\'·v + u·v\'.\n3. Aturan Pembagian: (u/v)\' = (u\'·v - u·v\') / v^2.\n4. Nilai stasioner terjadi saat f\'(x) = 0.\n\nPelajari contoh soal pada Bank Soal Matematika Wajib sebelum mengikuti sesi ujian.',
      teacherId: 'guru-1',
      teacherName: 'Dra. Siti Aminah, M.Pd.',
      isPublished: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'mat-indo-1',
      title: 'Struktur & Kaidah Kebahasaan Teks Artikel Opini',
      subject: 'Bahasa Indonesia',
      gradeLevel: 'XII',
      targetClasses: [],
      materialType: 'ARTIKEL',
      summary: 'Cara membedakan fakta dan opini serta menyusun argumentasi yang logis dan efektif.',
      content:
        'Teks artikel opini terdiri atas:\n- Pernyataan pendapat (tesis)\n- Argumentasi berbasis data dan fakta\n- Pernyataan ulang pendapat (penegasan)\n\nPerhatikan penggunaan konjungsi kausalitas, kosakata baku sesuai KBBI, dan kalimat efektif.',
      teacherId: 'guru-3',
      teacherName: 'Rina Kusuma, S.Pd.',
      isPublished: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'mat-tkj-1',
      title: 'Latihan Subnetting IPv4 & Routing Dasar Mikrotik',
      subject: 'Administrasi Infrastruktur Jaringan',
      gradeLevel: 'XII',
      targetClasses: ['XII TKJ 1', 'XII TKJ 2'],
      materialType: 'TUGAS',
      summary: 'Latihan pembagian blok CIDR /26 dan /27 serta penentuan gateway jaringan lokal.',
      content:
        'Kerjakan latihan perhitungan Network ID, Broadcast Address, dan rentang Host Valid untuk prefix /26 dan /27 pada buku catatan praktik sebelum jadwal ujian berlangsung.',
      teacherId: 'guru-2',
      teacherName: 'Budi Santoso, S.Kom.',
      isPublished: true,
      dueDate: todayDate,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    settings: {
      schoolName: 'SMK NEGERI 1 NUSANTARA',
      npsn: '20261901',
      address: 'Jl. Pendidikan Raya No. 45, Kota Nusantara',
      city: 'Kota Nusantara',
      academicYear: '2026/2027',
      semester: 'Ganjil',
      principalName: 'Drs. H. Ahmad Subarjo, M.M.',
      principalNip: '19720412 199802 1 003',
      proctorName: 'Muhsinin, S.Kom.',
      serverName: 'SRV-CBT-UTAMA-01',
      maintenanceMode: false,
      autoRotateToken: false,
      tokenIntervalMinutes: 15,
      themeColor: 'teal',
      sidebarStyle: 'dark',
      schoolLogo: '',
      principalSignature: '',
      portalSlides: [],
    },
    admins: [],
    teachers,
    students,
    banks,
    exams,
    sessions,
    violations,
    broadcasts: [],
    attendance,
    materials,
  };
}

const COLLECTIONS = [
  'admins',
  'teachers',
  'students',
  'banks',
  'exams',
  'sessions',
  'violations',
  'broadcasts',
  'attendance',
  'materials',
] as const;

type CollectionName = (typeof COLLECTIONS)[number];

const SETTINGS_COLLECTION = 'settings';
const SETTINGS_ID = 'main';

export interface PendingEvent {
  audience: string;
  event: string;
  payload: unknown;
}

interface SnapshotEntry {
  json: string;
  pos: number;
}

export interface StoreContext {
  db: CbtDatabase;
  snapshot: Map<string, SnapshotEntry>;
  events: PendingEvent[];
  presence: { students: number; staff: number };
  sizeBytes: number;
  dirty: boolean;
}

interface DocRow {
  collection: string;
  id: string;
  pos: number;
  data: unknown;
}

interface CachedStoreState {
  db: CbtDatabase;
  snapshot: Map<string, SnapshotEntry>;
  presence: { students: number; staff: number };
  sizeBytes: number;
  version: number;
  loadedAt: number;
  presenceLoadedAt: number;
}

const contextStorage = new AsyncLocalStorage<StoreContext>();
const USE_IN_PROCESS_CACHE = process.env.VERCEL !== '1';
const PG_CACHE_TTL_MS = 3000;
const PRESENCE_REFRESH_MS = 8000;

function docKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

function normalizeDb(parsed: CbtDatabase): CbtDatabase {
  parsed.settings = {
    city: 'Kota Nusantara',
    themeColor: 'teal',
    sidebarStyle: 'dark',
    schoolLogo: '',
    principalSignature: '',
    portalSlides: [],
    ...parsed.settings,
  };
  for (const name of COLLECTIONS) {
    if (!Array.isArray(parsed[name])) {
      (parsed as unknown as Record<CollectionName, unknown[]>)[name] = [];
    }
  }
  for (const bank of parsed.banks) {
    if (!bank.teacherId && bank.teacherName) {
      const matched = parsed.teachers.find(
        (t) => t.fullName.trim().toLowerCase() === bank.teacherName.trim().toLowerCase()
      );
      if (matched) {
        bank.teacherId = matched.id;
      }
    }
  }
  for (const mat of parsed.materials) {
    if (!mat.teacherId && mat.teacherName) {
      const matched = parsed.teachers.find(
        (t) => t.fullName.trim().toLowerCase() === mat.teacherName.trim().toLowerCase()
      );
      if (matched) {
        mat.teacherId = matched.id;
      }
    }
  }
  return parsed;
}

function readLegacySeedFile(): CbtDatabase | null {
  try {
    const legacyFile = path.resolve(process.cwd(), 'data', 'cbt-store.json');
    if (!fs.existsSync(legacyFile)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) as CbtDatabase;
    if (parsed && parsed.settings && Array.isArray(parsed.students)) {
      return parsed;
    }
  } catch (err) {
    console.error('Gagal membaca data/cbt-store.json, memakai seed bawaan:', err);
  }
  return null;
}

// Keeps existing rows' sort keys stable so push/unshift only writes the new row.
function assignPositions(collection: string, items: { id?: unknown }[], snapshot: Map<string, SnapshotEntry>): number[] {
  const known = items.map((item) =>
    item && typeof item.id === 'string' ? snapshot.get(docKey(collection, item.id))?.pos : undefined
  );

  let last = -Infinity;
  for (const p of known) {
    if (p === undefined) continue;
    if (p <= last) {
      return items.map((_, i) => i);
    }
    last = p;
  }

  const result: number[] = new Array(items.length);
  let i = 0;
  while (i < items.length) {
    const knownPos = known[i];
    if (knownPos !== undefined) {
      result[i] = knownPos;
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && known[j] === undefined) j++;
    const prev = i > 0 ? result[i - 1] : undefined;
    const next = j < items.length ? known[j] : undefined;
    const count = j - i;
    for (let k = 0; k < count; k++) {
      if (prev === undefined && next === undefined) {
        result[i + k] = i + k;
      } else if (prev === undefined) {
        result[i + k] = (next as number) - (count - k);
      } else if (next === undefined) {
        result[i + k] = prev + k + 1;
      } else {
        result[i + k] = prev + ((next - prev) * (k + 1)) / (count + 1);
      }
    }
    i = j;
  }
  return result;
}

function buildStateFromDocs(
  docs: DocRow[],
  presence: { students: number; staff: number }
): { db: CbtDatabase; snapshot: Map<string, SnapshotEntry>; sizeBytes: number; seeded: boolean } {
  const snapshot = new Map<string, SnapshotEntry>();

  if (docs.length === 0) {
    const seed = normalizeDb(readLegacySeedFile() || createInitialSeed());
    return { db: seed, snapshot, sizeBytes: 0, seeded: true };
  }

  const draft: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) draft[name] = [];
  let settings: SchoolSettings | null = null;
  let sizeBytes = 0;

  for (const row of docs) {
    const json = JSON.stringify(row.data);
    sizeBytes += json.length;
    snapshot.set(docKey(row.collection, row.id), { json, pos: Number(row.pos) });
    if (row.collection === SETTINGS_COLLECTION) {
      settings = row.data as SchoolSettings;
    } else if (draft[row.collection]) {
      draft[row.collection].push(row.data);
    }
  }

  const db = normalizeDb({
    ...(draft as unknown as Omit<CbtDatabase, 'settings'>),
    settings: settings || createInitialSeed().settings,
  } as CbtDatabase);

  return { db, snapshot, sizeBytes, seeded: false };
}

class StoreManager {
  private cache: CachedStoreState | null = null;
  private loadPromise: Promise<CachedStoreState> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private pendingFlushes = 0;
  private presenceRefreshing = false;

  constructor() {
    onDbEngineFailover(() => {
      this.cache = null;
    });
  }

  private async loadFreshIntoCache(): Promise<CachedStoreState> {
    if (this.pendingFlushes > 0) {
      await this.flushChain;
    }
    const { docs, presence, version } = await dbLoadDocsAndPresence();
    const built = buildStateFromDocs(docs, presence);
    const now = Date.now();
    const state: CachedStoreState = {
      db: built.db,
      snapshot: built.snapshot,
      presence,
      sizeBytes: built.sizeBytes,
      version,
      loadedAt: now,
      presenceLoadedAt: now,
    };
    if (built.seeded) {
      const seedCtx: StoreContext = {
        db: state.db,
        snapshot: state.snapshot,
        events: [],
        presence: state.presence,
        sizeBytes: 0,
        dirty: true,
      };
      await this.performFlush(seedCtx, state);
    }
    this.cache = state;
    return state;
  }

  private async ensureCacheUpToDate(): Promise<CachedStoreState> {
    const now = Date.now();
    if (!this.cache) {
      return this.loadFreshIntoCache();
    }
    if (
      getIsUsingPostgres() &&
      this.pendingFlushes === 0 &&
      now - this.cache.loadedAt > PG_CACHE_TTL_MS
    ) {
      const remoteVersion = await dbGetDocsVersion();
      if (remoteVersion !== this.cache.version) {
        return this.loadFreshIntoCache();
      }
      this.cache.loadedAt = Date.now();
    }
    return this.cache;
  }

  private refreshPresenceAsync(state: CachedStoreState): void {
    if (this.presenceRefreshing) return;
    this.presenceRefreshing = true;
    dbLoadPresence()
      .then((presence) => {
        state.presence = presence;
        state.presenceLoadedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => {
        this.presenceRefreshing = false;
      });
  }

  async load(): Promise<StoreContext> {
    if (USE_IN_PROCESS_CACHE) {
      const now = Date.now();
      const needsCheck =
        !this.cache ||
        (getIsUsingPostgres() && this.pendingFlushes === 0 && now - this.cache.loadedAt > PG_CACHE_TTL_MS);

      if (needsCheck) {
        if (!this.loadPromise) {
          this.loadPromise = this.ensureCacheUpToDate().finally(() => {
            this.loadPromise = null;
          });
        }
        const state = await this.loadPromise;
        return {
          db: state.db,
          snapshot: state.snapshot,
          events: [],
          presence: state.presence,
          sizeBytes: state.sizeBytes,
          dirty: false,
        };
      }

      const cached = this.cache!;
      if (now - cached.presenceLoadedAt > PRESENCE_REFRESH_MS) {
        this.refreshPresenceAsync(cached);
      }

      return {
        db: cached.db,
        snapshot: cached.snapshot,
        events: [],
        presence: cached.presence,
        sizeBytes: cached.sizeBytes,
        dirty: false,
      };
    }

    const { docs, presence } = await dbLoadDocsAndPresence();
    const built = buildStateFromDocs(docs, presence);
    const ctx: StoreContext = {
      db: built.db,
      snapshot: built.snapshot,
      events: [],
      presence,
      sizeBytes: built.sizeBytes,
      dirty: built.seeded,
    };
    if (built.seeded) {
      await this.performFlush(ctx);
      ctx.dirty = false;
    }
    return ctx;
  }

  private async performFlush(ctx: StoreContext, cacheTarget?: CachedStoreState): Promise<void> {
    const dbRef = cacheTarget ? cacheTarget.db : ctx.db;
    const baseSnapshot = cacheTarget ? cacheTarget.snapshot : ctx.snapshot;
    const upserts: DocRow[] = [];
    const nextSnapshot = new Map<string, SnapshotEntry>();

    const settingsKey = docKey(SETTINGS_COLLECTION, SETTINGS_ID);
    const settingsJson = JSON.stringify(dbRef.settings);
    nextSnapshot.set(settingsKey, { json: settingsJson, pos: 0 });
    if (baseSnapshot.get(settingsKey)?.json !== settingsJson) {
      upserts.push({ collection: SETTINGS_COLLECTION, id: SETTINGS_ID, pos: 0, data: dbRef.settings });
    }

    for (const name of COLLECTIONS) {
      const items = (Array.isArray(dbRef[name]) ? dbRef[name] : []) as unknown as { id?: unknown }[];
      const positions = assignPositions(name, items, baseSnapshot);
      items.forEach((item, idx) => {
        if (!item || typeof item.id !== 'string' || !item.id) return;
        const key = docKey(name, item.id);
        if (nextSnapshot.has(key)) return;
        const json = JSON.stringify(item);
        const pos = positions[idx];
        nextSnapshot.set(key, { json, pos });
        const prev = baseSnapshot.get(key);
        if (!prev || prev.json !== json || prev.pos !== pos) {
          upserts.push({ collection: name, id: item.id, pos, data: item });
        }
      });
    }

    const deletes: { collection: string; id: string }[] = [];
    for (const key of baseSnapshot.keys()) {
      if (!nextSnapshot.has(key)) {
        const [collection, id] = key.split('\u0000');
        deletes.push({ collection, id });
      }
    }

    const events = ctx.events.splice(0);
    if (upserts.length === 0 && deletes.length === 0 && events.length === 0) {
      return;
    }

    let nextVersion: number | null = null;
    try {
      nextVersion = await dbFlushChanges(upserts, deletes, events);
    } catch (err) {
      ctx.events.unshift(...events);
      throw err;
    }

    const totalBytes = Array.from(nextSnapshot.values()).reduce((sum, e) => sum + e.json.length, 0);
    ctx.snapshot = nextSnapshot;
    ctx.sizeBytes = totalBytes;
    if (cacheTarget) {
      cacheTarget.snapshot = nextSnapshot;
      cacheTarget.sizeBytes = totalBytes;
      cacheTarget.loadedAt = Date.now();
      if (nextVersion !== null) {
        cacheTarget.version = nextVersion;
      }
    }

    if (Math.random() < 0.02) {
      dbPurgeOldEvents();
    }
  }

  async flush(ctx: StoreContext): Promise<void> {
    if (!ctx.dirty && ctx.events.length === 0) {
      return;
    }

    if (USE_IN_PROCESS_CACHE) {
      this.pendingFlushes += 1;
      const task = this.flushChain
        .then(
          () => this.performFlush(ctx, this.cache || undefined),
          () => this.performFlush(ctx, this.cache || undefined)
        )
        .finally(() => {
          this.pendingFlushes = Math.max(0, this.pendingFlushes - 1);
        });
      this.flushChain = task.catch(() => undefined);
      return task;
    }

    return this.performFlush(ctx);
  }

  run<T>(ctx: StoreContext, fn: () => T): T {
    return contextStorage.run(ctx, fn);
  }

  private current(): StoreContext {
    const ctx = contextStorage.getStore();
    if (!ctx) {
      throw new Error('Store context tidak tersedia di luar request API.');
    }
    return ctx;
  }

  getDb(): CbtDatabase {
    return this.current().db;
  }

  commit(): void {
    const ctx = contextStorage.getStore();
    if (ctx) {
      ctx.dirty = true;
    }
  }

  replaceAll(nextDb: CbtDatabase): void {
    const ctx = this.current();
    const normalized = normalizeDb(nextDb);
    ctx.db = normalized;
    ctx.dirty = true;
    if (this.cache) {
      this.cache.db = normalized;
    }
  }

  emit(audience: string, event: string, payload: unknown): void {
    const ctx = contextStorage.getStore();
    if (ctx) {
      ctx.events.push({ audience, event, payload });
    }
  }

  getPresence(): { students: number; staff: number } {
    return this.current().presence;
  }

  getDbFileSizeKb(): number {
    return Math.round((this.current().sizeBytes / 1024) * 10) / 10;
  }
}

export const store = new StoreManager();

export function calculateSessionScore(session: ExamSession, bank: QuestionBank | undefined): ExamSession {
  if (!bank) {
    return session;
  }
  const pgQuestions = bank.questions.filter((q) => q.type === 'PG');
  const essayQuestions = bank.questions.filter((q) => q.type === 'ESAI');

  let pgCorrect = 0;
  let pgEarnedWeight = 0;
  let pgTotalWeight = 0;

  for (const q of pgQuestions) {
    const w = q.weight > 0 ? q.weight : 1;
    pgTotalWeight += w;
    const ans = session.answers[q.id]?.answer?.trim().toUpperCase();
    if (ans && ans === q.correctAnswer) {
      pgCorrect += 1;
      pgEarnedWeight += w;
    }
  }

  const pgScore = pgTotalWeight > 0 ? Math.round((pgEarnedWeight / pgTotalWeight) * 1000) / 10 : 0;

  let essayScore = 0;
  if (essayQuestions.length > 0) {
    let essayTotalWeight = 0;
    let essayWeightedSum = 0;
    for (const q of essayQuestions) {
      const w = q.weight > 0 ? q.weight : 1;
      essayTotalWeight += w;
      const scoreVal = session.answers[q.id]?.essayScore ?? 0;
      essayWeightedSum += (Math.min(100, Math.max(0, scoreVal)) / 100) * w;
    }
    essayScore = essayTotalWeight > 0 ? Math.round((essayWeightedSum / essayTotalWeight) * 1000) / 10 : 0;
  }

  let finalScore = pgScore;
  if (essayQuestions.length > 0 && pgQuestions.length > 0) {
    const pgPct = bank.pgWeightPercent / 100;
    const essayPct = bank.essayWeightPercent / 100;
    finalScore = Math.round((pgScore * pgPct + essayScore * essayPct) * 10) / 10;
  } else if (essayQuestions.length > 0 && pgQuestions.length === 0) {
    finalScore = essayScore;
  }

  session.pgCorrect = pgCorrect;
  session.pgTotal = pgQuestions.length;
  session.pgScore = pgScore;
  session.essayScore = essayScore;
  session.finalScore = Math.round(finalScore * 10) / 10;
  return session;
}
