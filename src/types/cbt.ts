export type UserRole = 'admin' | 'proktor' | 'guru' | 'student';

export type QuestionType = 'PG' | 'ESAI';

export type ExamSessionStatus =
  | 'BELUM_MULAI'
  | 'SEDANG_UJIAN'
  | 'TERBLOKIR'
  | 'SELESAI';

export type ViolationType =
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'EXIT_FULLSCREEN'
  | 'COPY_PASTE'
  | 'CONTEXT_MENU'
  | 'DEVTOOLS_SHORTCUT';

export type CbtThemeColor = 'teal' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';

export type CbtSidebarStyle = 'dark' | 'light';

export interface SchoolSettings {
  schoolName: string;
  npsn: string;
  address: string;
  city?: string;
  academicYear: string;
  semester: string;
  principalName: string;
  principalNip: string;
  proctorName: string;
  serverName: string;
  maintenanceMode: boolean;
  autoRotateToken: boolean;
  tokenIntervalMinutes: number;
  themeColor?: CbtThemeColor;
  sidebarStyle?: CbtSidebarStyle;
  schoolLogo?: string;
  principalSignature?: string;
  portalSlides?: string[];
}

export interface AdminAccount {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'proktor';
  passwordHash: string;
  createdAt: string;
}

export interface TeacherAccount {
  id: string;
  nip: string;
  fullName: string;
  subject: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
}

export interface Student {
  id: string;
  nis: string;
  name: string;
  className: string;
  room: string;
  sessionGroup: string;
  password: string;
  activeSessionToken?: string;
}

export interface Question {
  id: string;
  number: number;
  type: QuestionType;
  text: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E' | '';
  weight: number;
}

export interface QuestionBank {
  id: string;
  code: string;
  subject: string;
  gradeLevel: string;
  teacherId?: string;
  teacherName: string;
  kkm: number;
  pgWeightPercent: number;
  essayWeightPercent: number;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface ExamSchedule {
  id: string;
  title: string;
  bankId: string;
  subject: string;
  targetClasses: string[];
  durationMinutes: number;
  token: string;
  tokenUpdatedAt: string;
  isActive: boolean;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  showScoreAfterFinish: boolean;
  antiCheatEnabled: boolean;
  maxViolations: number;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface ExamAnswerRecord {
  questionId: string;
  answer: string;
  isDoubtful: boolean;
  essayScore?: number;
  updatedAt: string;
}

export interface ExamSession {
  id: string;
  examId: string;
  studentId: string;
  studentNis: string;
  studentName: string;
  className: string;
  room: string;
  status: ExamSessionStatus;
  questionOrder: string[];
  optionOrders: Record<string, ('A' | 'B' | 'C' | 'D' | 'E')[]>;
  answers: Record<string, ExamAnswerRecord>;
  currentQuestionIndex: number;
  startedAt: string;
  endsAt: string;
  finishedAt?: string;
  extraMinutes: number;
  violationCount: number;
  lastViolationReason?: string;
  blockedAt?: string;
  pgCorrect: number;
  pgTotal: number;
  pgScore: number;
  essayScore: number;
  finalScore: number;
  isOnline: boolean;
  lastHeartbeatAt: string;
}

export interface ViolationLog {
  id: string;
  sessionId: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentNis: string;
  studentName: string;
  className: string;
  room: string;
  type: ViolationType;
  description: string;
  countAtTime: number;
  triggeredBlock: boolean;
  timestamp: string;
}

export interface BroadcastNotice {
  id: string;
  message: string;
  sender: string;
  timestamp: string;
}

export interface ServerMetrics {
  status: 'ONLINE' | 'MAINTENANCE';
  uptimeSeconds: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryTotalSystemMb: number;
  cpuCount: number;
  loadAvg1m: number;
  wsConnectedClients: number;
  wsConnectedStudents: number;
  wsConnectedAdmins: number;
  activeSessionsCount: number;
  blockedSessionsCount: number;
  finishedSessionsCount: number;
  totalQuestionsCount: number;
  totalStudentsCount: number;
  dbSizeKb: number;
  nodeVersion: string;
  serverTime: string;
}

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
  identifier: string;
  subject?: string;
  className?: string;
  room?: string;
  sessionGroup?: string;
}

export interface SanitizedQuestion {
  id: string;
  displayNumber: number;
  type: QuestionType;
  text: string;
  options: { key: 'A' | 'B' | 'C' | 'D' | 'E'; originalKey: 'A' | 'B' | 'C' | 'D' | 'E'; text: string }[];
  weight: number;
}

export type AttendanceStatus = 'HADIR' | 'TERLAMBAT' | 'IZIN' | 'ALPA';

export type AttendanceMethod = 'QR_CAMERA' | 'QR_IMAGE' | 'MANUAL';

export type AttendancePeriod = 'daily' | 'weekly' | 'monthly';

export type AttendanceSortField =
  | 'name'
  | 'nis'
  | 'className'
  | 'status'
  | 'scannedAt'
  | 'hadirCount'
  | 'attendanceRate';

export type SortDirection = 'asc' | 'desc';

export interface AttendanceRecord {
  id: string;
  date: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentNis: string;
  studentName: string;
  className: string;
  room: string;
  sessionGroup: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  scannedAt: string;
  scannedBy: string;
  notes?: string;
}

