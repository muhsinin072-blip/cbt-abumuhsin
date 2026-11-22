import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CbtDatabase } from './store.ts';
import type {
  AdminAccount,
  AttendanceMethod,
  AttendanceRecord,
  AttendanceStatus,
  BroadcastNotice,
  CbtSidebarStyle,
  CbtThemeColor,
  ExamAnswerRecord,
  ExamSchedule,
  ExamSession,
  ExamSessionStatus,
  Question,
  QuestionBank,
  QuestionType,
  SchoolSettings,
  Student,
  TeacherAccount,
  ViolationLog,
  ViolationType,
} from '../src/types/cbt.ts';

type SqlRow = Record<string, unknown>;

function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function asOptStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asOptNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asBool(v: unknown): boolean {
  return Number(v) === 1 || v === true;
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class SqliteCbtRepository {
  private readonly dbPath: string;
  private readonly db: DatabaseSync;
  private lastSettingsJson = '';

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'candycbt.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS school_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        school_name TEXT NOT NULL,
        npsn TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT '',
        academic_year TEXT NOT NULL,
        semester TEXT NOT NULL,
        principal_name TEXT NOT NULL,
        principal_nip TEXT NOT NULL,
        proctor_name TEXT NOT NULL,
        server_name TEXT NOT NULL,
        maintenance_mode INTEGER NOT NULL DEFAULT 0,
        auto_rotate_token INTEGER NOT NULL DEFAULT 0,
        token_interval_minutes INTEGER NOT NULL DEFAULT 15,
        theme_color TEXT NOT NULL DEFAULT 'teal',
        sidebar_style TEXT NOT NULL DEFAULT 'dark',
        school_logo TEXT NOT NULL DEFAULT '',
        principal_signature TEXT NOT NULL DEFAULT '',
        portal_slides_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS teachers (
        id TEXT PRIMARY KEY,
        nip TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        nis TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        room TEXT NOT NULL,
        session_group TEXT NOT NULL,
        password TEXT NOT NULL,
        active_session_token TEXT
      );

      CREATE TABLE IF NOT EXISTS question_banks (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        grade_level TEXT NOT NULL,
        teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
        teacher_name TEXT NOT NULL,
        kkm INTEGER NOT NULL,
        pg_weight_percent INTEGER NOT NULL,
        essay_weight_percent INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        option_a TEXT NOT NULL DEFAULT '',
        option_b TEXT NOT NULL DEFAULT '',
        option_c TEXT NOT NULL DEFAULT '',
        option_d TEXT NOT NULL DEFAULT '',
        option_e TEXT NOT NULL DEFAULT '',
        correct_answer TEXT NOT NULL DEFAULT '',
        weight INTEGER NOT NULL DEFAULT 10
      );

      CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        target_classes_json TEXT NOT NULL DEFAULT '[]',
        duration_minutes INTEGER NOT NULL,
        token TEXT NOT NULL,
        token_updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        randomize_questions INTEGER NOT NULL DEFAULT 1,
        randomize_options INTEGER NOT NULL DEFAULT 1,
        show_score_after_finish INTEGER NOT NULL DEFAULT 1,
        anti_cheat_enabled INTEGER NOT NULL DEFAULT 1,
        max_violations INTEGER NOT NULL DEFAULT 3,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exam_sessions (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        student_nis TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        room TEXT NOT NULL,
        status TEXT NOT NULL,
        question_order_json TEXT NOT NULL DEFAULT '[]',
        option_orders_json TEXT NOT NULL DEFAULT '{}',
        current_question_index INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        finished_at TEXT,
        extra_minutes INTEGER NOT NULL DEFAULT 0,
        violation_count INTEGER NOT NULL DEFAULT 0,
        last_violation_reason TEXT,
        blocked_at TEXT,
        pg_correct INTEGER NOT NULL DEFAULT 0,
        pg_total INTEGER NOT NULL DEFAULT 0,
        pg_score REAL NOT NULL DEFAULT 0,
        essay_score REAL NOT NULL DEFAULT 0,
        final_score REAL NOT NULL DEFAULT 0,
        is_online INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exam_answers (
        session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        answer TEXT NOT NULL DEFAULT '',
        is_doubtful INTEGER NOT NULL DEFAULT 0,
        essay_score REAL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, question_id)
      );

      CREATE TABLE IF NOT EXISTS violation_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
        exam_id TEXT NOT NULL,
        exam_title TEXT NOT NULL,
        student_id TEXT NOT NULL,
        student_nis TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        room TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        count_at_time INTEGER NOT NULL,
        triggered_block INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        sender TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_records (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        exam_id TEXT NOT NULL DEFAULT '',
        exam_title TEXT NOT NULL DEFAULT '',
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        student_nis TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        room TEXT NOT NULL,
        session_group TEXT NOT NULL,
        status TEXT NOT NULL,
        method TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        scanned_by TEXT NOT NULL,
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id, number);
      CREATE INDEX IF NOT EXISTS idx_exams_bank ON exams(bank_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_exam_student ON exam_sessions(exam_id, student_id);
      CREATE INDEX IF NOT EXISTS idx_answers_session ON exam_answers(session_id);
      CREATE INDEX IF NOT EXISTS idx_violations_session ON violation_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date, student_id);
    `);
  }

  hasSettingsRow(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM school_settings').get() as SqlRow | undefined;
    return asNum(row?.cnt, 0) > 0;
  }

  loadDatabase(): CbtDatabase | null {
    const settingsRow = this.db
      .prepare('SELECT * FROM school_settings WHERE id = 1')
      .get() as SqlRow | undefined;
    if (!settingsRow) {
      return null;
    }

    const settings: SchoolSettings = {
      schoolName: asStr(settingsRow.school_name, 'SMK NEGERI 1 NUSANTARA'),
      npsn: asStr(settingsRow.npsn, '20261901'),
      address: asStr(settingsRow.address, ''),
      city: asStr(settingsRow.city, 'Kota Nusantara'),
      academicYear: asStr(settingsRow.academic_year, '2026/2027'),
      semester: asStr(settingsRow.semester, 'Ganjil'),
      principalName: asStr(settingsRow.principal_name, ''),
      principalNip: asStr(settingsRow.principal_nip, ''),
      proctorName: asStr(settingsRow.proctor_name, ''),
      serverName: asStr(settingsRow.server_name, 'SRV-CBT-UTAMA-01'),
      maintenanceMode: asBool(settingsRow.maintenance_mode),
      autoRotateToken: asBool(settingsRow.auto_rotate_token),
      tokenIntervalMinutes: asNum(settingsRow.token_interval_minutes, 15),
      themeColor: asStr(settingsRow.theme_color, 'teal') as CbtThemeColor,
      sidebarStyle: asStr(settingsRow.sidebar_style, 'dark') as CbtSidebarStyle,
      schoolLogo: asStr(settingsRow.school_logo, ''),
      principalSignature: asStr(settingsRow.principal_signature, ''),
      portalSlides: parseJsonSafe<string[]>(settingsRow.portal_slides_json, []),
    };

    const admins: AdminAccount[] = (
      this.db.prepare('SELECT * FROM admins ORDER BY created_at ASC').all() as SqlRow[]
    ).map((r) => ({
      id: asStr(r.id),
      username: asStr(r.username),
      fullName: asStr(r.full_name),
      role: (asStr(r.role) === 'proktor' ? 'proktor' : 'admin') as 'admin' | 'proktor',
      passwordHash: asStr(r.password_hash),
      createdAt: asStr(r.created_at),
    }));

    const teachers: TeacherAccount[] = (
      this.db.prepare('SELECT * FROM teachers ORDER BY created_at ASC').all() as SqlRow[]
    ).map((r) => ({
      id: asStr(r.id),
      nip: asStr(r.nip),
      fullName: asStr(r.full_name),
      subject: asStr(r.subject),
      passwordHash: asStr(r.password_hash),
      isActive: asBool(r.is_active),
      createdAt: asStr(r.created_at),
    }));

    const students: Student[] = (
      this.db.prepare('SELECT * FROM students ORDER BY nis ASC').all() as SqlRow[]
    ).map((r) => {
      const token = asOptStr(r.active_session_token);
      return {
        id: asStr(r.id),
        nis: asStr(r.nis),
        name: asStr(r.name),
        className: asStr(r.class_name),
        room: asStr(r.room),
        sessionGroup: asStr(r.session_group),
        password: asStr(r.password),
        ...(token ? { activeSessionToken: token } : {}),
      };
    });

    const questionsByBankId = new Map<string, Question[]>();
    const questionRows = this.db
      .prepare('SELECT * FROM questions ORDER BY bank_id ASC, number ASC')
      .all() as SqlRow[];
    for (const r of questionRows) {
      const bankId = asStr(r.bank_id);
      const list = questionsByBankId.get(bankId) || [];
      list.push({
        id: asStr(r.id),
        number: asNum(r.number, list.length + 1),
        type: (asStr(r.type) === 'ESAI' ? 'ESAI' : 'PG') as QuestionType,
        text: asStr(r.text),
        optionA: asStr(r.option_a),
        optionB: asStr(r.option_b),
        optionC: asStr(r.option_c),
        optionD: asStr(r.option_d),
        optionE: asStr(r.option_e),
        correctAnswer: asStr(r.correct_answer) as Question['correctAnswer'],
        weight: asNum(r.weight, 10),
      });
      questionsByBankId.set(bankId, list);
    }

    const banks: QuestionBank[] = (
      this.db.prepare('SELECT * FROM question_banks ORDER BY created_at ASC').all() as SqlRow[]
    ).map((r) => {
      const id = asStr(r.id);
      const teacherId = asOptStr(r.teacher_id);
      return {
        id,
        code: asStr(r.code),
        subject: asStr(r.subject),
        gradeLevel: asStr(r.grade_level),
        ...(teacherId ? { teacherId } : {}),
        teacherName: asStr(r.teacher_name),
        kkm: asNum(r.kkm, 75),
        pgWeightPercent: asNum(r.pg_weight_percent, 80),
        essayWeightPercent: asNum(r.essay_weight_percent, 20),
        questions: questionsByBankId.get(id) || [],
        createdAt: asStr(r.created_at),
        updatedAt: asStr(r.updated_at),
      };
    });

    const exams: ExamSchedule[] = (
      this.db.prepare('SELECT * FROM exams ORDER BY created_at ASC').all() as SqlRow[]
    ).map((r) => ({
      id: asStr(r.id),
      title: asStr(r.title),
      bankId: asStr(r.bank_id),
      subject: asStr(r.subject),
      targetClasses: parseJsonSafe<string[]>(r.target_classes_json, []),
      durationMinutes: asNum(r.duration_minutes, 60),
      token: asStr(r.token),
      tokenUpdatedAt: asStr(r.token_updated_at),
      isActive: asBool(r.is_active),
      randomizeQuestions: asBool(r.randomize_questions),
      randomizeOptions: asBool(r.randomize_options),
      showScoreAfterFinish: asBool(r.show_score_after_finish),
      antiCheatEnabled: asBool(r.anti_cheat_enabled),
      maxViolations: asNum(r.max_violations, 3),
      startDate: asStr(r.start_date),
      endDate: asStr(r.end_date),
      createdAt: asStr(r.created_at),
    }));

    const answersBySessionId = new Map<string, Record<string, ExamAnswerRecord>>();
    const answerRows = this.db.prepare('SELECT * FROM exam_answers').all() as SqlRow[];
    for (const r of answerRows) {
      const sessionId = asStr(r.session_id);
      const qId = asStr(r.question_id);
      const map = answersBySessionId.get(sessionId) || {};
      const essayScore = asOptNum(r.essay_score);
      map[qId] = {
        questionId: qId,
        answer: asStr(r.answer),
        isDoubtful: asBool(r.is_doubtful),
        ...(essayScore !== undefined ? { essayScore } : {}),
        updatedAt: asStr(r.updated_at),
      };
      answersBySessionId.set(sessionId, map);
    }

    const sessions: ExamSession[] = (
      this.db.prepare('SELECT * FROM exam_sessions ORDER BY started_at ASC').all() as SqlRow[]
    ).map((r) => {
      const id = asStr(r.id);
      const finishedAt = asOptStr(r.finished_at);
      const lastViolationReason = asOptStr(r.last_violation_reason);
      const blockedAt = asOptStr(r.blocked_at);
      return {
        id,
        examId: asStr(r.exam_id),
        studentId: asStr(r.student_id),
        studentNis: asStr(r.student_nis),
        studentName: asStr(r.student_name),
        className: asStr(r.class_name),
        room: asStr(r.room),
        status: asStr(r.status, 'BELUM_MULAI') as ExamSessionStatus,
        questionOrder: parseJsonSafe<string[]>(r.question_order_json, []),
        optionOrders: parseJsonSafe<ExamSession['optionOrders']>(r.option_orders_json, {}),
        answers: answersBySessionId.get(id) || {},
        currentQuestionIndex: asNum(r.current_question_index, 0),
        startedAt: asStr(r.started_at),
        endsAt: asStr(r.ends_at),
        ...(finishedAt ? { finishedAt } : {}),
        extraMinutes: asNum(r.extra_minutes, 0),
        violationCount: asNum(r.violation_count, 0),
        ...(lastViolationReason ? { lastViolationReason } : {}),
        ...(blockedAt ? { blockedAt } : {}),
        pgCorrect: asNum(r.pg_correct, 0),
        pgTotal: asNum(r.pg_total, 0),
        pgScore: asNum(r.pg_score, 0),
        essayScore: asNum(r.essay_score, 0),
        finalScore: asNum(r.final_score, 0),
        isOnline: asBool(r.is_online),
        lastHeartbeatAt: asStr(r.last_heartbeat_at),
      };
    });

    const violations: ViolationLog[] = (
      this.db.prepare('SELECT * FROM violation_logs ORDER BY timestamp ASC').all() as SqlRow[]
    ).map((r) => ({
      id: asStr(r.id),
      sessionId: asStr(r.session_id),
      examId: asStr(r.exam_id),
      examTitle: asStr(r.exam_title),
      studentId: asStr(r.student_id),
      studentNis: asStr(r.student_nis),
      studentName: asStr(r.student_name),
      className: asStr(r.class_name),
      room: asStr(r.room),
      type: asStr(r.type, 'TAB_SWITCH') as ViolationType,
      description: asStr(r.description),
      countAtTime: asNum(r.count_at_time, 1),
      triggeredBlock: asBool(r.triggered_block),
      timestamp: asStr(r.timestamp),
    }));

    const broadcasts: BroadcastNotice[] = (
      this.db.prepare('SELECT * FROM broadcasts ORDER BY timestamp ASC').all() as SqlRow[]
    ).map((r) => ({
      id: asStr(r.id),
      message: asStr(r.message),
      sender: asStr(r.sender),
      timestamp: asStr(r.timestamp),
    }));

    const attendance: AttendanceRecord[] = (
      this.db.prepare('SELECT * FROM attendance_records ORDER BY scanned_at ASC').all() as SqlRow[]
    ).map((r) => {
      const notes = asOptStr(r.notes);
      return {
        id: asStr(r.id),
        date: asStr(r.date),
        examId: asStr(r.exam_id),
        examTitle: asStr(r.exam_title),
        studentId: asStr(r.student_id),
        studentNis: asStr(r.student_nis),
        studentName: asStr(r.student_name),
        className: asStr(r.class_name),
        room: asStr(r.room),
        sessionGroup: asStr(r.session_group),
        status: asStr(r.status, 'HADIR') as AttendanceStatus,
        method: asStr(r.method, 'MANUAL') as AttendanceMethod,
        scannedAt: asStr(r.scanned_at),
        scannedBy: asStr(r.scanned_by),
        ...(notes ? { notes } : {}),
      };
    });

    this.lastSettingsJson = JSON.stringify(settings);

    return {
      settings,
      admins,
      teachers,
      students,
      banks,
      exams,
      sessions,
      violations,
      broadcasts,
      attendance,
    };
  }

  syncDatabase(data: CbtDatabase): void {
    const serializedSettings = JSON.stringify(data.settings);
    const shouldWriteSettings = serializedSettings !== this.lastSettingsJson || !this.hasSettingsRow();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (shouldWriteSettings) {
        const s = data.settings;
        this.db
          .prepare(
            `INSERT INTO school_settings (
              id, school_name, npsn, address, city, academic_year, semester,
              principal_name, principal_nip, proctor_name, server_name,
              maintenance_mode, auto_rotate_token, token_interval_minutes,
              theme_color, sidebar_style, school_logo, principal_signature, portal_slides_json
            ) VALUES (
              1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            ) ON CONFLICT(id) DO UPDATE SET
              school_name = excluded.school_name,
              npsn = excluded.npsn,
              address = excluded.address,
              city = excluded.city,
              academic_year = excluded.academic_year,
              semester = excluded.semester,
              principal_name = excluded.principal_name,
              principal_nip = excluded.principal_nip,
              proctor_name = excluded.proctor_name,
              server_name = excluded.server_name,
              maintenance_mode = excluded.maintenance_mode,
              auto_rotate_token = excluded.auto_rotate_token,
              token_interval_minutes = excluded.token_interval_minutes,
              theme_color = excluded.theme_color,
              sidebar_style = excluded.sidebar_style,
              school_logo = excluded.school_logo,
              principal_signature = excluded.principal_signature,
              portal_slides_json = excluded.portal_slides_json`
          )
          .run(
            s.schoolName,
            s.npsn,
            s.address,
            s.city ?? 'Kota Nusantara',
            s.academicYear,
            s.semester,
            s.principalName,
            s.principalNip,
            s.proctorName,
            s.serverName,
            s.maintenanceMode ? 1 : 0,
            s.autoRotateToken ? 1 : 0,
            s.tokenIntervalMinutes,
            s.themeColor ?? 'teal',
            s.sidebarStyle ?? 'dark',
            s.schoolLogo ?? '',
            s.principalSignature ?? '',
            JSON.stringify(s.portalSlides ?? [])
          );
      }

      // Clear in dependency-safe order inside transaction
      this.db.exec(`
        DELETE FROM exam_answers;
        DELETE FROM violation_logs;
        DELETE FROM exam_sessions;
        DELETE FROM exams;
        DELETE FROM questions;
        DELETE FROM question_banks;
        DELETE FROM attendance_records;
        DELETE FROM broadcasts;
        DELETE FROM students;
        DELETE FROM teachers;
        DELETE FROM admins;
      `);

      const insAdmin = this.db.prepare(
        `INSERT INTO admins (id, username, full_name, role, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const a of data.admins) {
        insAdmin.run(a.id, a.username, a.fullName, a.role, a.passwordHash, a.createdAt);
      }

      const teacherIds = new Set<string>();
      const insTeacher = this.db.prepare(
        `INSERT INTO teachers (id, nip, full_name, subject, password_hash, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const t of data.teachers) {
        teacherIds.add(t.id);
        insTeacher.run(
          t.id,
          t.nip,
          t.fullName,
          t.subject,
          t.passwordHash,
          t.isActive ? 1 : 0,
          t.createdAt
        );
      }

      const studentIds = new Set<string>();
      const insStudent = this.db.prepare(
        `INSERT INTO students (id, nis, name, class_name, room, session_group, password, active_session_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const st of data.students) {
        studentIds.add(st.id);
        insStudent.run(
          st.id,
          st.nis,
          st.name,
          st.className,
          st.room,
          st.sessionGroup,
          st.password,
          st.activeSessionToken ?? null
        );
      }

      const bankIds = new Set<string>();
      const insBank = this.db.prepare(
        `INSERT INTO question_banks (
          id, code, subject, grade_level, teacher_id, teacher_name,
          kkm, pg_weight_percent, essay_weight_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insQuestion = this.db.prepare(
        `INSERT INTO questions (
          id, bank_id, number, type, text, option_a, option_b, option_c,
          option_d, option_e, correct_answer, weight
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const b of data.banks) {
        bankIds.add(b.id);
        const safeTeacherId = b.teacherId && teacherIds.has(b.teacherId) ? b.teacherId : null;
        insBank.run(
          b.id,
          b.code,
          b.subject,
          b.gradeLevel,
          safeTeacherId,
          b.teacherName,
          b.kkm,
          b.pgWeightPercent,
          b.essayWeightPercent,
          b.createdAt,
          b.updatedAt
        );
        for (const q of b.questions) {
          insQuestion.run(
            q.id,
            b.id,
            q.number,
            q.type,
            q.text,
            q.optionA,
            q.optionB,
            q.optionC,
            q.optionD,
            q.optionE,
            q.correctAnswer,
            q.weight
          );
        }
      }

      const examIds = new Set<string>();
      const insExam = this.db.prepare(
        `INSERT INTO exams (
          id, title, bank_id, subject, target_classes_json, duration_minutes,
          token, token_updated_at, is_active, randomize_questions, randomize_options,
          show_score_after_finish, anti_cheat_enabled, max_violations, start_date, end_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const ex of data.exams) {
        if (!bankIds.has(ex.bankId)) continue;
        examIds.add(ex.id);
        insExam.run(
          ex.id,
          ex.title,
          ex.bankId,
          ex.subject,
          JSON.stringify(ex.targetClasses ?? []),
          ex.durationMinutes,
          ex.token,
          ex.tokenUpdatedAt,
          ex.isActive ? 1 : 0,
          ex.randomizeQuestions ? 1 : 0,
          ex.randomizeOptions ? 1 : 0,
          ex.showScoreAfterFinish ? 1 : 0,
          ex.antiCheatEnabled ? 1 : 0,
          ex.maxViolations,
          ex.startDate,
          ex.endDate,
          ex.createdAt
        );
      }

      const sessionIds = new Set<string>();
      const insSession = this.db.prepare(
        `INSERT INTO exam_sessions (
          id, exam_id, student_id, student_nis, student_name, class_name, room, status,
          question_order_json, option_orders_json, current_question_index,
          started_at, ends_at, finished_at, extra_minutes, violation_count,
          last_violation_reason, blocked_at, pg_correct, pg_total, pg_score,
          essay_score, final_score, is_online, last_heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insAnswer = this.db.prepare(
        `INSERT INTO exam_answers (session_id, question_id, answer, is_doubtful, essay_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const sess of data.sessions) {
        if (!examIds.has(sess.examId) || !studentIds.has(sess.studentId)) continue;
        sessionIds.add(sess.id);
        insSession.run(
          sess.id,
          sess.examId,
          sess.studentId,
          sess.studentNis,
          sess.studentName,
          sess.className,
          sess.room,
          sess.status,
          JSON.stringify(sess.questionOrder ?? []),
          JSON.stringify(sess.optionOrders ?? {}),
          sess.currentQuestionIndex,
          sess.startedAt,
          sess.endsAt,
          sess.finishedAt ?? null,
          sess.extraMinutes,
          sess.violationCount,
          sess.lastViolationReason ?? null,
          sess.blockedAt ?? null,
          sess.pgCorrect,
          sess.pgTotal,
          sess.pgScore,
          sess.essayScore,
          sess.finalScore,
          sess.isOnline ? 1 : 0,
          sess.lastHeartbeatAt
        );
        for (const ans of Object.values(sess.answers || {})) {
          insAnswer.run(
            sess.id,
            ans.questionId,
            ans.answer,
            ans.isDoubtful ? 1 : 0,
            ans.essayScore ?? null,
            ans.updatedAt
          );
        }
      }

      const insViolation = this.db.prepare(
        `INSERT INTO violation_logs (
          id, session_id, exam_id, exam_title, student_id, student_nis, student_name,
          class_name, room, type, description, count_at_time, triggered_block, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of data.violations) {
        if (!sessionIds.has(v.sessionId)) continue;
        insViolation.run(
          v.id,
          v.sessionId,
          v.examId,
          v.examTitle,
          v.studentId,
          v.studentNis,
          v.studentName,
          v.className,
          v.room,
          v.type,
          v.description,
          v.countAtTime,
          v.triggeredBlock ? 1 : 0,
          v.timestamp
        );
      }

      const insBroadcast = this.db.prepare(
        `INSERT INTO broadcasts (id, message, sender, timestamp) VALUES (?, ?, ?, ?)`
      );
      for (const br of data.broadcasts) {
        insBroadcast.run(br.id, br.message, br.sender, br.timestamp);
      }

      const insAttendance = this.db.prepare(
        `INSERT INTO attendance_records (
          id, date, exam_id, exam_title, student_id, student_nis, student_name,
          class_name, room, session_group, status, method, scanned_at, scanned_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const rec of data.attendance) {
        if (!studentIds.has(rec.studentId)) continue;
        insAttendance.run(
          rec.id,
          rec.date,
          rec.examId,
          rec.examTitle,
          rec.studentId,
          rec.studentNis,
          rec.studentName,
          rec.className,
          rec.room,
          rec.sessionGroup,
          rec.status,
          rec.method,
          rec.scannedAt,
          rec.scannedBy,
          rec.notes ?? null
        );
      }

      this.db.exec('COMMIT');
      this.lastSettingsJson = serializedSettings;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  optimize(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;');
  }

  getSizeKb(): number {
    let totalBytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${this.dbPath}${suffix}`;
      try {
        if (fs.existsSync(target)) {
          totalBytes += fs.statSync(target).size;
        }
      } catch {
        // ignore stat errors
      }
    }
    return Math.round((totalBytes / 1024) * 10) / 10;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore close errors
    }
  }
}
