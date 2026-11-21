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

export function createCbtWebSocket(
  onEvent: (event: string, payload: unknown) => void,
  onStatusChange?: (connected: boolean) => void
): { send: (event: string, payload?: unknown) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let closedManually = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closedManually || !memoryToken) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(memoryToken)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      onStatusChange?.(true);
    };

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as { event?: string; payload?: unknown };
        if (parsed.event) {
          onEvent(parsed.event, parsed.payload);
        }
      } catch {
        // ignore invalid message
      }
    };

    ws.onclose = () => {
      onStatusChange?.(false);
      if (!closedManually) {
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return {
    send: (event: string, payload?: unknown) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, payload }));
      }
    },
    close: () => {
      closedManually = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      ws?.close();
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

