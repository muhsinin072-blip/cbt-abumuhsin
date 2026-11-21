import type {
  AttendancePeriod,
  AttendanceRecord,
  AuthUser,
  BroadcastNotice,
  ExamSchedule,
  ExamSession,
  QuestionBank,
  SanitizedQuestion,
  SchoolSettings,
  ServerMetrics,
  Student,
  ViolationLog,
} from '../types/cbt';

let memoryToken = '';

export function setAuthToken(token: string): void {
  memoryToken = token;
}

export function getAuthToken(): string {
  return memoryToken;
}

export function clearAuthToken(): void {
  memoryToken = '';
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `Terjadi kesalahan server (${res.status})`);
    }
    return data as T;
  }

  if (!res.ok) {
    throw new Error(`Permintaan gagal (${res.status})`);
  }
  return (await res.text()) as unknown as T;
}

interface RealtimeListener {
  onEvent: (event: string, payload: unknown) => void;
  onStatusChange?: (connected: boolean) => void;
}

const POLL_INTERVAL_MS = 3000;
const realtimeListeners = new Set<RealtimeListener>();
let realtimeCursor: number | null = null;
let realtimeToken = '';
let realtimeTimer: number | null = null;
let realtimeInFlight = false;
let realtimeConnected = false;

function setRealtimeConnected(connected: boolean): void {
  if (realtimeConnected === connected) return;
  realtimeConnected = connected;
  for (const listener of realtimeListeners) {
    listener.onStatusChange?.(connected);
  }
}

function scheduleRealtimePoll(delay = POLL_INTERVAL_MS): void {
  if (realtimeTimer !== null) {
    window.clearTimeout(realtimeTimer);
  }
  realtimeTimer = window.setTimeout(pollRealtime, delay);
}

async function pollRealtime(): Promise<void> {
  realtimeTimer = null;
  if (realtimeListeners.size === 0 || realtimeInFlight) return;
  if (!memoryToken) {
    setRealtimeConnected(false);
    scheduleRealtimePoll();
    return;
  }
  if (memoryToken !== realtimeToken) {
    realtimeToken = memoryToken;
    realtimeCursor = null;
  }

  realtimeInFlight = true;
  try {
    const res = await apiFetch<{ cursor: number; events: { event: string; payload: unknown }[] }>(
      `/api/events?after=${realtimeCursor ?? -1}`
    );
    realtimeCursor = res.cursor;
    setRealtimeConnected(true);
    for (const item of res.events) {
      for (const listener of Array.from(realtimeListeners)) {
        try {
          listener.onEvent(item.event, item.payload);
        } catch (err) {
          console.error('Realtime listener error:', err);
        }
      }
    }
  } catch {
    setRealtimeConnected(false);
  } finally {
    realtimeInFlight = false;
    if (realtimeListeners.size > 0) {
      scheduleRealtimePoll();
    }
  }
}

// Same interface as the former WebSocket client; realtime events are delivered by
// short polling because Vercel Functions cannot keep WebSocket connections open.
export function createCbtWebSocket(
  onEvent: (event: string, payload: unknown) => void,
  onStatusChange?: (connected: boolean) => void
): { send: (event: string, payload?: unknown) => void; close: () => void } {
  const listener: RealtimeListener = { onEvent, onStatusChange };
  realtimeListeners.add(listener);
  if (realtimeConnected) {
    onStatusChange?.(true);
  }
  if (realtimeTimer === null && !realtimeInFlight) {
    scheduleRealtimePoll(0);
  }

  return {
    send: (event: string, payload?: unknown) => {
      if (!memoryToken) return;
      apiFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify({ event, payload }),
      }).catch(() => {
        // heartbeat failures are retried on the next interval
      });
    },
    close: () => {
      realtimeListeners.delete(listener);
      if (realtimeListeners.size === 0 && realtimeTimer !== null) {
        window.clearTimeout(realtimeTimer);
        realtimeTimer = null;
      }
    },
  };
}

export interface PublicInfoResponse {
  settings: Pick<
    SchoolSettings,
    | 'schoolName'
    | 'npsn'
    | 'address'
    | 'academicYear'
    | 'semester'
    | 'serverName'
    | 'maintenanceMode'
    | 'themeColor'
    | 'sidebarStyle'
    | 'schoolLogo'
    | 'portalSlides'
  >;
  adminSetupRequired: boolean;
  sampleStudents: { nis: string; name: string; className: string }[];
  sampleTeachers: { nip: string; fullName: string; subject: string }[];
}

export interface StudentExamListItem {
  id: string;
  title: string;
  subject: string;
  bankCode: string;
  kkm: number;
  questionCount: number;
  durationMinutes: number;
  antiCheatEnabled: boolean;
  maxViolations: number;
  showScoreAfterFinish: boolean;
  startDate: string;
  endDate: string;
  session: {
    id: string;
    status: ExamSession['status'];
    startedAt: string;
    endsAt: string;
    finishedAt?: string;
    violationCount: number;
    lastViolationReason?: string;
    finalScore?: number;
    pgCorrect?: number;
    pgTotal?: number;
  } | null;
}

export interface StartExamResponse {
  session: {
    id: string;
    examId: string;
    status: ExamSession['status'];
    answers: ExamSession['answers'];
    currentQuestionIndex: number;
    startedAt: string;
    endsAt: string;
    violationCount: number;
    lastViolationReason?: string;
  };
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    antiCheatEnabled: boolean;
    maxViolations: number;
    showScoreAfterFinish: boolean;
  };
  questions: SanitizedQuestion[];
}

export interface AdminDashboardResponse {
  settings: SchoolSettings;
  metrics: ServerMetrics;
  exams: ExamSchedule[];
  banksCount: number;
  sessions: ExamSession[];
  recentViolations: ViolationLog[];
  broadcasts: BroadcastNotice[];
}

export interface EnrichedResultSession extends ExamSession {
  examTitle: string;
  subject: string;
  kkm: number;
  essayItems: {
    questionId: string;
    number: number;
    questionText: string;
    studentAnswer: string;
    essayScore: number;
  }[];
}

export interface AdminResultsResponse {
  results: EnrichedResultSession[];
  exams: ExamSchedule[];
  banks: QuestionBank[];
  violations: ViolationLog[];
  settings: SchoolSettings;
}

export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export interface TeacherListItem {
  id: string;
  nip: string;
  fullName: string;
  subject: string;
  isActive: boolean;
  createdAt: string;
  banksCount: number;
  examsCount: number;
}

export type TeachersResponse = { teachers: TeacherListItem[] };
export type StudentsResponse = { students: Student[] };
export type BanksResponse = { banks: QuestionBank[] };
export type ExamsResponse = { exams: ExamSchedule[] };

export interface AdminAttendanceResponse {
  period: AttendancePeriod;
  date: string;
  month: string;
  startDate: string;
  endDate: string;
  records: AttendanceRecord[];
  students: Student[];
  exams: ExamSchedule[];
  settings: SchoolSettings;
}

