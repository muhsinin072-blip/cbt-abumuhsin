import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  hashPassword,
  signAuthToken,
  verifyAuthToken,
  verifyEnvPasscode,
  verifyPasswordHash,
} from './server/auth.ts';
import type { TokenPayload } from './server/auth.ts';
import {
  calculateSessionScore,
  generateTokenCode,
  store,
} from './server/store.ts';
import type { CbtDatabase } from './server/store.ts';
import type {
  AdminAccount,
  AttendanceMethod,
  AttendanceRecord,
  AttendanceStatus,
  BroadcastNotice,
  ExamSchedule,
  ExamSession,
  Question,
  QuestionBank,
  SanitizedQuestion,
  ServerMetrics,
  Student,
  TeacherAccount,
  ViolationLog,
  ViolationType,
} from './src/types/cbt.ts';

interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

interface WsClientMeta {
  ws: WebSocket;
  user: TokenPayload;
  sessionId?: string;
}

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set<WsClientMeta>();

function sendToAdmins(event: string, payload: unknown): void {
  const msg = JSON.stringify({ event, payload });
  for (const client of wsClients) {
    if (
      (client.user.role === 'admin' ||
        client.user.role === 'proktor' ||
        client.user.role === 'guru') &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(msg);
    }
  }
}

function sendToStudent(studentId: string, event: string, payload: unknown): void {
  const msg = JSON.stringify({ event, payload });
  for (const client of wsClients) {
    if (
      client.user.role === 'student' &&
      client.user.sub === studentId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(msg);
    }
  }
}

function broadcastToAllStudents(event: string, payload: unknown): void {
  const msg = JSON.stringify({ event, payload });
  for (const client of wsClients) {
    if (client.user.role === 'student' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const verified = verifyAuthToken(token);

  if (!verified) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const meta: WsClientMeta = { ws, user: verified };
  wsClients.add(meta);

  if (verified.role === 'student') {
    const db = store.getDb();
    const activeSess = db.sessions.find(
      (s) => s.studentId === verified.sub && (s.status === 'SEDANG_UJIAN' || s.status === 'TERBLOKIR')
    );
    if (activeSess) {
      activeSess.isOnline = true;
      activeSess.lastHeartbeatAt = new Date().toISOString();
      meta.sessionId = activeSess.id;
      store.commit();
      sendToAdmins('session:updated', activeSess);
    }
  }

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as { event?: string; payload?: Record<string, unknown> };
      if (parsed.event === 'student:heartbeat' && verified.role === 'student') {
        const sessionId = typeof parsed.payload?.sessionId === 'string' ? parsed.payload.sessionId : '';
        const currentIdx = typeof parsed.payload?.currentQuestionIndex === 'number' ? parsed.payload.currentQuestionIndex : undefined;
        const db = store.getDb();
        const sess = db.sessions.find((s) => s.id === sessionId && s.studentId === verified.sub);
        if (sess) {
          sess.isOnline = true;
          sess.lastHeartbeatAt = new Date().toISOString();
          if (typeof currentIdx === 'number' && currentIdx >= 0) {
            sess.currentQuestionIndex = currentIdx;
          }
          meta.sessionId = sess.id;
          sendToAdmins('session:updated', sess);
        }
      }
    } catch {
      // ignore malformed ws message
    }
  });

  ws.on('close', () => {
    wsClients.delete(meta);
    if (verified.role === 'student') {
      const stillConnected = Array.from(wsClients).some(
        (c) => c.user.role === 'student' && c.user.sub === verified.sub
      );
      if (!stillConnected) {
        const db = store.getDb();
        const activeSess = db.sessions.find(
          (s) => s.studentId === verified.sub && (s.status === 'SEDANG_UJIAN' || s.status === 'TERBLOKIR')
        );
        if (activeSess) {
          activeSess.isOnline = false;
          store.commit();
          sendToAdmins('session:updated', activeSess);
        }
      }
    }
  });
});

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.' });
    return;
  }
  req.user = payload;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'proktor')) {
    res.status(403).json({ error: 'Akses ditolak. Khusus Admin atau Proktor.' });
    return;
  }
  next();
}

function requireStaff(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (
    !req.user ||
    (req.user.role !== 'admin' && req.user.role !== 'proktor' && req.user.role !== 'guru')
  ) {
    res.status(403).json({ error: 'Akses ditolak. Khusus Admin, Proktor, atau Guru.' });
    return;
  }
  next();
}

function isGuruUser(user?: TokenPayload): boolean {
  return Boolean(user && user.role === 'guru');
}

function isBankOwnedByTeacher(bank: QuestionBank, user: TokenPayload): boolean {
  if (bank.teacherId && bank.teacherId === user.sub) {
    return true;
  }
  return (
    Boolean(bank.teacherName) &&
    bank.teacherName.trim().toLowerCase() === user.name.trim().toLowerCase()
  );
}

function getOwnedBankIds(db: CbtDatabase, user: TokenPayload): Set<string> {
  return new Set(db.banks.filter((b) => isBankOwnedByTeacher(b, user)).map((b) => b.id));
}

function requireStudent(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'student') {
    res.status(403).json({ error: 'Akses ditolak. Khusus Peserta Ujian.' });
    return;
  }
  next();
}

function isAdminSetupRequired(): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    return false;
  }
  const db = store.getDb();
  return db.admins.length === 0;
}

function buildSanitizedQuestions(session: ExamSession, bank: QuestionBank): SanitizedQuestion[] {
  const qMap = new Map(bank.questions.map((q) => [q.id, q]));
  const result: SanitizedQuestion[] = [];
  const optionKeys: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B', 'C', 'D', 'E'];

  session.questionOrder.forEach((qId, idx) => {
    const q = qMap.get(qId);
    if (!q) {
      return;
    }
    const order = session.optionOrders[q.id] || optionKeys;
    const rawOptions: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
      A: q.optionA,
      B: q.optionB,
      C: q.optionC,
      D: q.optionD,
      E: q.optionE,
    };

    const options =
      q.type === 'PG'
        ? order
            .map((origKey, optIdx) => ({
              key: optionKeys[optIdx],
              originalKey: origKey,
              text: rawOptions[origKey] || '',
            }))
            .filter((o) => o.text.trim().length > 0)
        : [];

    result.push({
      id: q.id,
      displayNumber: idx + 1,
      type: q.type,
      text: q.text,
      options,
      weight: q.weight,
    });
  });

  return result;
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildServerMetrics(): ServerMetrics {
  const db = store.getDb();
  const mem = process.memoryUsage();
  const totalQuestionsCount = db.banks.reduce((sum, b) => sum + b.questions.length, 0);
  const wsStudents = Array.from(wsClients).filter((c) => c.user.role === 'student').length;
  const wsAdmins = Array.from(wsClients).filter(
    (c) => c.user.role === 'admin' || c.user.role === 'proktor' || c.user.role === 'guru'
  ).length;

  return {
    status: db.settings.maintenanceMode ? 'MAINTENANCE' : 'ONLINE',
    uptimeSeconds: Math.floor(process.uptime()),
    memoryRssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    memoryHeapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    memoryTotalSystemMb: Math.round((os.totalmem() / 1024 / 1024) * 10) / 10,
    cpuCount: os.cpus().length,
    loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
    wsConnectedClients: wsClients.size,
    wsConnectedStudents: wsStudents,
    wsConnectedAdmins: wsAdmins,
    activeSessionsCount: db.sessions.filter((s) => s.status === 'SEDANG_UJIAN').length,
    blockedSessionsCount: db.sessions.filter((s) => s.status === 'TERBLOKIR').length,
    finishedSessionsCount: db.sessions.filter((s) => s.status === 'SELESAI').length,
    totalQuestionsCount,
    totalStudentsCount: db.students.length,
    dbSizeKb: store.getDbFileSizeKb(),
    nodeVersion: process.version,
    serverTime: new Date().toISOString(),
  };
}

// ---------- PUBLIC & AUTH ROUTES ----------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

app.get('/api/public/info', (_req, res) => {
  const db = store.getDb();
  res.json({
    settings: {
      schoolName: db.settings.schoolName,
      npsn: db.settings.npsn,
      address: db.settings.address,
      academicYear: db.settings.academicYear,
      semester: db.settings.semester,
      serverName: db.settings.serverName,
      maintenanceMode: db.settings.maintenanceMode,
      themeColor: db.settings.themeColor || 'teal',
      sidebarStyle: db.settings.sidebarStyle || 'dark',
      schoolLogo: db.settings.schoolLogo || '',
      portalSlides: Array.isArray(db.settings.portalSlides) ? db.settings.portalSlides : [],
    },
    adminSetupRequired: isAdminSetupRequired(),
    sampleStudents: db.students.slice(0, 4).map((s) => ({
      nis: s.nis,
      name: s.name,
      className: s.className,
    })),
    sampleTeachers: (db.teachers || [])
      .filter((t) => t.isActive)
      .slice(0, 4)
      .map((t) => ({
        nip: t.nip,
        fullName: t.fullName,
        subject: t.subject,
      })),
  });
});

app.post('/api/auth/admin/setup', (req, res) => {
  if (!isAdminSetupRequired()) {
    res.status(409).json({ error: 'Akun Admin sudah diaktivasi sebelumnya.' });
    return;
  }
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : 'admin';
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : 'Administrator CBT';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ error: 'Username minimal 3 karakter dan password minimal 6 karakter.' });
    return;
  }

  const db = store.getDb();
  const newAdmin: AdminAccount = {
    id: `adm-${crypto.randomUUID()}`,
    username: username.toLowerCase(),
    fullName: fullName || 'Administrator CBT',
    role: 'admin',
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.admins.push(newAdmin);
  store.commit();

  const token = signAuthToken({
    sub: newAdmin.id,
    role: 'admin',
    name: newAdmin.fullName,
    identifier: newAdmin.username,
  });

  res.status(201).json({
    token,
    user: {
      id: newAdmin.id,
      role: 'admin',
      name: newAdmin.fullName,
      identifier: newAdmin.username,
    },
  });
});

app.post('/api/auth/admin/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!password) {
    res.status(400).json({ error: 'Password wajib diisi.' });
    return;
  }

  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass && verifyEnvPasscode(password, envPass)) {
    const token = signAuthToken({
      sub: 'env-admin',
      role: 'admin',
      name: 'Administrator Utama',
      identifier: username || 'admin',
    });
    res.json({
      token,
      user: {
        id: 'env-admin',
        role: 'admin',
        name: 'Administrator Utama',
        identifier: username || 'admin',
      },
    });
    return;
  }

  const db = store.getDb();
  const account = db.admins.find((a) => a.username === (username || 'admin'));
  if (!account || !verifyPasswordHash(password, account.passwordHash)) {
    res.status(401).json({ error: 'Username atau password Admin/Proktor tidak valid.' });
    return;
  }

  const token = signAuthToken({
    sub: account.id,
    role: account.role,
    name: account.fullName,
    identifier: account.username,
  });

  res.json({
    token,
    user: {
      id: account.id,
      role: account.role,
      name: account.fullName,
      identifier: account.username,
    },
  });
});

app.post('/api/auth/student/login', (req, res) => {
  const db = store.getDb();
  if (db.settings.maintenanceMode) {
    res.status(503).json({
      error: 'Server CBT sedang dalam mode pemeliharaan oleh Proktor. Silakan tunggu beberapa saat.',
    });
    return;
  }

  const nis = typeof req.body?.nis === 'string' ? req.body.nis.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

  const student = db.students.find((s) => s.nis === nis && s.password === password);
  if (!student) {
    res.status(401).json({ error: 'NIS atau Password peserta ujian salah.' });
    return;
  }

  const token = signAuthToken({
    sub: student.id,
    role: 'student',
    name: student.name,
    identifier: student.nis,
  });

  res.json({
    token,
    user: {
      id: student.id,
      role: 'student',
      name: student.name,
      identifier: student.nis,
      className: student.className,
      room: student.room,
      sessionGroup: student.sessionGroup,
    },
  });
});

app.post('/api/auth/teacher/login', (req, res) => {
  const db = store.getDb();
  const nip = typeof req.body?.nip === 'string' ? req.body.nip.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!nip || !password) {
    res.status(400).json({ error: 'NIP / Username Guru dan Password wajib diisi.' });
    return;
  }

  const teacher = (db.teachers || []).find((t) => t.nip.trim().toLowerCase() === nip);
  if (!teacher || !verifyPasswordHash(password, teacher.passwordHash)) {
    res.status(401).json({ error: 'NIP / Username Guru atau Password tidak valid.' });
    return;
  }
  if (!teacher.isActive) {
    res.status(403).json({ error: 'Akun Guru ini sedang dinonaktifkan oleh Administrator.' });
    return;
  }

  const token = signAuthToken({
    sub: teacher.id,
    role: 'guru',
    name: teacher.fullName,
    identifier: teacher.nip,
  });

  res.json({
    token,
    user: {
      id: teacher.id,
      role: 'guru',
      name: teacher.fullName,
      identifier: teacher.nip,
      subject: teacher.subject,
    },
  });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = store.getDb();
  if (user.role === 'student') {
    const stu = db.students.find((s) => s.id === user.sub);
    if (!stu) {
      res.status(404).json({ error: 'Peserta tidak ditemukan.' });
      return;
    }
    res.json({
      user: {
        id: stu.id,
        role: 'student',
        name: stu.name,
        identifier: stu.nis,
        className: stu.className,
        room: stu.room,
        sessionGroup: stu.sessionGroup,
      },
    });
    return;
  }
  if (user.role === 'guru') {
    const teacher = (db.teachers || []).find((t) => t.id === user.sub);
    if (!teacher || !teacher.isActive) {
      res.status(403).json({ error: 'Akun Guru tidak ditemukan atau telah dinonaktifkan.' });
      return;
    }
    res.json({
      user: {
        id: teacher.id,
        role: 'guru',
        name: teacher.fullName,
        identifier: teacher.nip,
        subject: teacher.subject,
      },
    });
    return;
  }
  res.json({
    user: {
      id: user.sub,
      role: user.role,
      name: user.name,
      identifier: user.identifier,
    },
  });
});

app.put('/api/teacher/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  if (!req.user || req.user.role !== 'guru') {
    res.status(403).json({ error: 'Akses khusus akun Guru.' });
    return;
  }
  const db = store.getDb();
  const teacher = (db.teachers || []).find((t) => t.id === req.user!.sub);
  if (!teacher) {
    res.status(404).json({ error: 'Akun Guru tidak ditemukan.' });
    return;
  }

  const body = req.body || {};
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (newPassword) {
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
      return;
    }
    if (!currentPassword || !verifyPasswordHash(currentPassword, teacher.passwordHash)) {
      res.status(400).json({ error: 'Password saat ini tidak sesuai.' });
      return;
    }
    teacher.passwordHash = hashPassword(newPassword);
  }

  let bankUpdated = false;
  if (fullName && fullName !== teacher.fullName) {
    const oldName = teacher.fullName.trim().toLowerCase();
    teacher.fullName = fullName;
    for (const bank of db.banks) {
      if (bank.teacherId === teacher.id || bank.teacherName.trim().toLowerCase() === oldName) {
        bank.teacherId = teacher.id;
        bank.teacherName = fullName;
        bankUpdated = true;
      }
    }
  }
  if (subject) {
    teacher.subject = subject;
  }

  store.commit();
  sendToAdmins('sync:teachers', { action: 'updated', teacherId: teacher.id });
  if (bankUpdated) {
    sendToAdmins('sync:banks', { action: 'teacher_renamed', teacherId: teacher.id });
  }

  res.json({
    user: {
      id: teacher.id,
      role: 'guru',
      name: teacher.fullName,
      identifier: teacher.nip,
      subject: teacher.subject,
    },
  });
});

// ---------- STUDENT EXAM ROUTES ----------

app.get('/api/student/exams', requireAuth, requireStudent, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const student = db.students.find((s) => s.id === req.user!.sub);
  if (!student) {
    res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
    return;
  }

  const visibleExams = db.exams
    .filter((ex) => ex.isActive && (ex.targetClasses.length === 0 || ex.targetClasses.includes(student.className)))
    .map((ex) => {
      const bank = db.banks.find((b) => b.id === ex.bankId);
      const session = db.sessions.find((s) => s.examId === ex.id && s.studentId === student.id);
      return {
        id: ex.id,
        title: ex.title,
        subject: ex.subject,
        bankCode: bank?.code || '-',
        kkm: bank?.kkm ?? 75,
        questionCount: bank?.questions.length ?? 0,
        durationMinutes: ex.durationMinutes,
        antiCheatEnabled: ex.antiCheatEnabled,
        maxViolations: ex.maxViolations,
        showScoreAfterFinish: ex.showScoreAfterFinish,
        startDate: ex.startDate,
        endDate: ex.endDate,
        session: session
          ? {
              id: session.id,
              status: session.status,
              startedAt: session.startedAt,
              endsAt: session.endsAt,
              finishedAt: session.finishedAt,
              violationCount: session.violationCount,
              lastViolationReason: session.lastViolationReason,
              finalScore: ex.showScoreAfterFinish && session.status === 'SELESAI' ? session.finalScore : undefined,
              pgCorrect: ex.showScoreAfterFinish && session.status === 'SELESAI' ? session.pgCorrect : undefined,
              pgTotal: ex.showScoreAfterFinish && session.status === 'SELESAI' ? session.pgTotal : undefined,
            }
          : null,
      };
    });

  res.json({
    exams: visibleExams,
    broadcasts: db.broadcasts.slice(0, 5),
    maintenanceMode: db.settings.maintenanceMode,
  });
});

app.post('/api/student/exams/:examId/start', requireAuth, requireStudent, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  if (db.settings.maintenanceMode) {
    res.status(503).json({ error: 'Server sedang dalam mode pemeliharaan.' });
    return;
  }

  const student = db.students.find((s) => s.id === req.user!.sub);
  const exam = db.exams.find((e) => e.id === req.params.examId);
  if (!student || !exam || !exam.isActive) {
    res.status(404).json({ error: 'Jadwal ujian tidak ditemukan atau belum diaktifkan.' });
    return;
  }
  if (exam.targetClasses.length > 0 && !exam.targetClasses.includes(student.className)) {
    res.status(403).json({ error: `Ujian ini tidak dijadwalkan untuk kelas Anda (${student.className}).` });
    return;
  }

  const bank = db.banks.find((b) => b.id === exam.bankId);
  if (!bank || bank.questions.length === 0) {
    res.status(400).json({ error: 'Bank soal ujian ini belum memiliki butir soal.' });
    return;
  }

  let session = db.sessions.find((s) => s.examId === exam.id && s.studentId === student.id);

  if (session && session.status === 'SELESAI') {
    res.status(409).json({ error: 'Anda sudah menyelesaikan ujian ini.' });
    return;
  }

  if (!session) {
    const inputToken = typeof req.body?.token === 'string' ? req.body.token.trim().toUpperCase() : '';
    if (!inputToken || inputToken !== exam.token.toUpperCase()) {
      res.status(400).json({ error: 'Token Ujian tidak sesuai. Periksa token terbaru dari Proktor.' });
      return;
    }

    const questionIds = exam.randomizeQuestions
      ? shuffleArray(bank.questions.map((q) => q.id))
      : bank.questions.map((q) => q.id);

    const optionOrders: Record<string, ('A' | 'B' | 'C' | 'D' | 'E')[]> = {};
    const baseKeys: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B', 'C', 'D', 'E'];
    for (const q of bank.questions) {
      if (q.type === 'PG') {
        const availableKeys = baseKeys.filter((k) => {
          const val =
            k === 'A'
              ? q.optionA
              : k === 'B'
                ? q.optionB
                : k === 'C'
                  ? q.optionC
                  : k === 'D'
                    ? q.optionD
                    : q.optionE;
          return val && val.trim().length > 0;
        });
        optionOrders[q.id] = exam.randomizeOptions ? shuffleArray(availableKeys) : availableKeys;
      }
    }

    const nowMs = Date.now();
    const endsAtMs = nowMs + exam.durationMinutes * 60 * 1000;

    session = {
      id: `sess-${crypto.randomUUID()}`,
      examId: exam.id,
      studentId: student.id,
      studentNis: student.nis,
      studentName: student.name,
      className: student.className,
      room: student.room,
      status: 'SEDANG_UJIAN',
      questionOrder: questionIds,
      optionOrders,
      answers: {},
      currentQuestionIndex: 0,
      startedAt: new Date(nowMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      extraMinutes: 0,
      violationCount: 0,
      pgCorrect: 0,
      pgTotal: bank.questions.filter((q) => q.type === 'PG').length,
      pgScore: 0,
      essayScore: 0,
      finalScore: 0,
      isOnline: true,
      lastHeartbeatAt: new Date(nowMs).toISOString(),
    };

    db.sessions.push(session);
    store.commit();
    sendToAdmins('session:updated', session);
  } else {
    session.isOnline = true;
    session.lastHeartbeatAt = new Date().toISOString();
    store.commit();
    sendToAdmins('session:updated', session);
  }

  res.json({
    session: {
      id: session.id,
      examId: session.examId,
      status: session.status,
      answers: session.answers,
      currentQuestionIndex: session.currentQuestionIndex,
      startedAt: session.startedAt,
      endsAt: session.endsAt,
      violationCount: session.violationCount,
      lastViolationReason: session.lastViolationReason,
    },
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      durationMinutes: exam.durationMinutes,
      antiCheatEnabled: exam.antiCheatEnabled,
      maxViolations: exam.maxViolations,
      showScoreAfterFinish: exam.showScoreAfterFinish,
    },
    questions: buildSanitizedQuestions(session, bank),
  });
});

app.post('/api/student/sessions/:sessionId/answer', requireAuth, requireStudent, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const session = db.sessions.find(
    (s) => s.id === req.params.sessionId && s.studentId === req.user!.sub
  );
  if (!session) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status !== 'SEDANG_UJIAN') {
    res.status(409).json({ error: `Tidak dapat menyimpan jawaban karena status ujian: ${session.status}` });
    return;
  }

  const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId : '';
  const answer = typeof req.body?.answer === 'string' ? req.body.answer : '';
  const isDoubtful = Boolean(req.body?.isDoubtful);
  const currentQuestionIndex =
    typeof req.body?.currentQuestionIndex === 'number'
      ? req.body.currentQuestionIndex
      : session.currentQuestionIndex;

  if (!questionId || !session.questionOrder.includes(questionId)) {
    res.status(400).json({ error: 'ID soal tidak valid.' });
    return;
  }

  session.answers[questionId] = {
    questionId,
    answer,
    isDoubtful,
    updatedAt: new Date().toISOString(),
  };
  session.currentQuestionIndex = currentQuestionIndex;
  session.lastHeartbeatAt = new Date().toISOString();
  store.commit();

  sendToAdmins('session:updated', session);
  res.json({ ok: true, savedAt: session.answers[questionId].updatedAt });
});

app.post('/api/student/sessions/:sessionId/violation', requireAuth, requireStudent, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const session = db.sessions.find(
    (s) => s.id === req.params.sessionId && s.studentId === req.user!.sub
  );
  if (!session) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }
  if (session.status === 'SELESAI') {
    res.json({ status: session.status, violationCount: session.violationCount, triggeredBlock: false });
    return;
  }

  const exam = db.exams.find((e) => e.id === session.examId);
  if (!exam || !exam.antiCheatEnabled) {
    res.json({ status: session.status, violationCount: session.violationCount, triggeredBlock: false });
    return;
  }

  const allowedTypes: ViolationType[] = [
    'TAB_SWITCH',
    'WINDOW_BLUR',
    'EXIT_FULLSCREEN',
    'COPY_PASTE',
    'CONTEXT_MENU',
    'DEVTOOLS_SHORTCUT',
  ];
  const rawType = typeof req.body?.type === 'string' ? req.body.type : 'TAB_SWITCH';
  const type: ViolationType = allowedTypes.includes(rawType as ViolationType)
    ? (rawType as ViolationType)
    : 'TAB_SWITCH';
  const description =
    typeof req.body?.description === 'string' && req.body.description.trim()
      ? req.body.description.trim().slice(0, 240)
      : 'Aktivitas mencurigakan terdeteksi di luar jendela ujian';

  session.violationCount += 1;
  session.lastViolationReason = description;
  const triggeredBlock = session.violationCount >= exam.maxViolations;

  if (triggeredBlock) {
    session.status = 'TERBLOKIR';
    session.blockedAt = new Date().toISOString();
  }

  const logEntry: ViolationLog = {
    id: `viol-${crypto.randomUUID()}`,
    sessionId: session.id,
    examId: exam.id,
    examTitle: exam.title,
    studentId: session.studentId,
    studentNis: session.studentNis,
    studentName: session.studentName,
    className: session.className,
    room: session.room,
    type,
    description,
    countAtTime: session.violationCount,
    triggeredBlock,
    timestamp: new Date().toISOString(),
  };

  db.violations.unshift(logEntry);
  if (db.violations.length > 500) {
    db.violations = db.violations.slice(0, 500);
  }
  store.commit();

  sendToAdmins('violation:logged', logEntry);
  sendToAdmins('session:updated', session);

  res.json({
    status: session.status,
    violationCount: session.violationCount,
    maxViolations: exam.maxViolations,
    triggeredBlock,
    lastViolationReason: session.lastViolationReason,
  });
});

app.post('/api/student/sessions/:sessionId/finish', requireAuth, requireStudent, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const session = db.sessions.find(
    (s) => s.id === req.params.sessionId && s.studentId === req.user!.sub
  );
  if (!session) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }

  const exam = db.exams.find((e) => e.id === session.examId);
  const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;

  if (session.status !== 'SELESAI') {
    session.status = 'SELESAI';
    session.finishedAt = new Date().toISOString();
    session.isOnline = false;
    calculateSessionScore(session, bank);
    store.commit();

    sendToAdmins('session:updated', session);
    sendToAdmins('sync:results', { sessionId: session.id, examId: session.examId });
  }

  res.json({
    status: session.status,
    finishedAt: session.finishedAt,
    showScoreAfterFinish: exam?.showScoreAfterFinish ?? true,
    result: exam?.showScoreAfterFinish
      ? {
          pgCorrect: session.pgCorrect,
          pgTotal: session.pgTotal,
          pgScore: session.pgScore,
          finalScore: session.finalScore,
          kkm: bank?.kkm ?? 75,
          hasEssay: (bank?.questions.filter((q) => q.type === 'ESAI').length ?? 0) > 0,
        }
      : null,
  });
});

// ---------- ADMIN / PROKTOR / GURU ROUTES ----------

app.get('/api/admin/dashboard', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const baseMetrics = buildServerMetrics();

  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    const ownedBanks = db.banks.filter((b) => ownedBankIds.has(b.id));
    const ownedExams = db.exams.filter((e) => ownedBankIds.has(e.bankId));
    const ownedExamIds = new Set(ownedExams.map((e) => e.id));
    const ownedSessions = db.sessions.filter((s) => ownedExamIds.has(s.examId));
    const ownedViolations = db.violations.filter((v) => ownedExamIds.has(v.examId));

    res.json({
      settings: db.settings,
      metrics: {
        ...baseMetrics,
        totalQuestionsCount: ownedBanks.reduce((sum, b) => sum + b.questions.length, 0),
        activeSessionsCount: ownedSessions.filter((s) => s.status === 'SEDANG_UJIAN').length,
        blockedSessionsCount: ownedSessions.filter((s) => s.status === 'TERBLOKIR').length,
        finishedSessionsCount: ownedSessions.filter((s) => s.status === 'SELESAI').length,
      },
      exams: ownedExams,
      banksCount: ownedBanks.length,
      sessions: ownedSessions,
      recentViolations: ownedViolations.slice(0, 20),
      broadcasts: db.broadcasts.slice(0, 10),
    });
    return;
  }

  res.json({
    settings: db.settings,
    metrics: baseMetrics,
    exams: db.exams,
    banksCount: db.banks.length,
    sessions: db.sessions,
    recentViolations: db.violations.slice(0, 20),
    broadcasts: db.broadcasts.slice(0, 10),
  });
});

const ALLOWED_THEME_COLORS = ['teal', 'indigo', 'emerald', 'rose', 'amber', 'sky'] as const;
const DATA_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

function sanitizeOptionalImageDataUrl(raw: unknown): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Format gambar tidak valid.' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: '' };
  }
  if (trimmed.length > 2_500_000) {
    return { ok: false, error: 'Ukuran file gambar terlalu besar (maksimal ~1,8 MB).' };
  }
  if (!DATA_IMAGE_REGEX.test(trimmed)) {
    return { ok: false, error: 'Format gambar harus PNG, JPG, atau WebP.' };
  }
  return { ok: true, value: trimmed };
}

app.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const body = req.body || {};

  const logoCheck = sanitizeOptionalImageDataUrl(body.schoolLogo);
  if (!logoCheck.ok) {
    res.status(400).json({ error: `Logo Sekolah: ${logoCheck.error}` });
    return;
  }

  const sigCheck = sanitizeOptionalImageDataUrl(body.principalSignature);
  if (!sigCheck.ok) {
    res.status(400).json({ error: `TTD Kepala Sekolah: ${sigCheck.error}` });
    return;
  }

  let nextPortalSlides: string[] | undefined = undefined;
  if (body.portalSlides !== undefined) {
    if (!Array.isArray(body.portalSlides) || body.portalSlides.length > 8) {
      res.status(400).json({ error: 'Foto slide portal maksimal 8 gambar.' });
      return;
    }
    const validated: string[] = [];
    for (const item of body.portalSlides) {
      if (typeof item !== 'string') {
        res.status(400).json({ error: 'Format foto slide tidak valid.' });
        return;
      }
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (trimmed.length > 2_500_000) {
        res.status(400).json({ error: 'Salah satu foto slide terlalu besar (maksimal ~1,8 MB).' });
        return;
      }
      if (!DATA_IMAGE_REGEX.test(trimmed)) {
        res.status(400).json({ error: 'Foto slide harus berformat PNG, JPG, atau WebP.' });
        return;
      }
      validated.push(trimmed);
    }
    nextPortalSlides = validated;
  }

  const nextThemeColor =
    typeof body.themeColor === 'string' &&
    (ALLOWED_THEME_COLORS as readonly string[]).includes(body.themeColor)
      ? (body.themeColor as (typeof ALLOWED_THEME_COLORS)[number])
      : db.settings.themeColor || 'teal';

  const nextSidebarStyle =
    body.sidebarStyle === 'light' || body.sidebarStyle === 'dark'
      ? body.sidebarStyle
      : db.settings.sidebarStyle || 'dark';

  db.settings = {
    ...db.settings,
    schoolName: typeof body.schoolName === 'string' && body.schoolName.trim() ? body.schoolName.trim() : db.settings.schoolName,
    npsn: typeof body.npsn === 'string' && body.npsn.trim() ? body.npsn.trim() : db.settings.npsn,
    address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : db.settings.address,
    city: typeof body.city === 'string' ? body.city.trim() : db.settings.city || 'Kota Nusantara',
    academicYear: typeof body.academicYear === 'string' && body.academicYear.trim() ? body.academicYear.trim() : db.settings.academicYear,
    semester: typeof body.semester === 'string' && body.semester.trim() ? body.semester.trim() : db.settings.semester,
    principalName: typeof body.principalName === 'string' && body.principalName.trim() ? body.principalName.trim() : db.settings.principalName,
    principalNip: typeof body.principalNip === 'string' && body.principalNip.trim() ? body.principalNip.trim() : db.settings.principalNip,
    proctorName: typeof body.proctorName === 'string' && body.proctorName.trim() ? body.proctorName.trim() : db.settings.proctorName,
    serverName: typeof body.serverName === 'string' && body.serverName.trim() ? body.serverName.trim() : db.settings.serverName,
    autoRotateToken: typeof body.autoRotateToken === 'boolean' ? body.autoRotateToken : db.settings.autoRotateToken,
    tokenIntervalMinutes:
      typeof body.tokenIntervalMinutes === 'number' && body.tokenIntervalMinutes >= 5
        ? Math.min(120, Math.round(body.tokenIntervalMinutes))
        : db.settings.tokenIntervalMinutes,
    themeColor: nextThemeColor,
    sidebarStyle: nextSidebarStyle,
    schoolLogo: logoCheck.value !== undefined ? logoCheck.value : db.settings.schoolLogo || '',
    principalSignature:
      sigCheck.value !== undefined ? sigCheck.value : db.settings.principalSignature || '',
    portalSlides:
      nextPortalSlides !== undefined
        ? nextPortalSlides
        : Array.isArray(db.settings.portalSlides)
          ? db.settings.portalSlides
          : [],
  };
  store.commit();
  sendToAdmins('sync:settings', db.settings);
  res.json({ settings: db.settings });
});

// Guru Account Management (Admin / Proktor only)
app.get('/api/admin/teachers', requireAuth, requireAdmin, (_req, res) => {
  const db = store.getDb();
  const list = (db.teachers || []).map((t) => {
    const ownedBankIds = new Set(
      db.banks
        .filter(
          (b) =>
            b.teacherId === t.id ||
            b.teacherName.trim().toLowerCase() === t.fullName.trim().toLowerCase()
        )
        .map((b) => b.id)
    );
    const examsCount = db.exams.filter((e) => ownedBankIds.has(e.bankId)).length;
    return {
      id: t.id,
      nip: t.nip,
      fullName: t.fullName,
      subject: t.subject,
      isActive: t.isActive,
      createdAt: t.createdAt,
      banksCount: ownedBankIds.size,
      examsCount,
    };
  });
  res.json({ teachers: list });
});

app.post('/api/admin/teachers', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const body = req.body || {};
  const nip = typeof body.nip === 'string' ? body.nip.trim() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!nip || !fullName || password.length < 6) {
    res.status(400).json({
      error: 'NIP/Username, Nama Lengkap Guru, dan Password (min. 6 karakter) wajib diisi.',
    });
    return;
  }

  if (!Array.isArray(db.teachers)) {
    db.teachers = [];
  }
  if (db.teachers.some((t) => t.nip.trim().toLowerCase() === nip.toLowerCase())) {
    res.status(409).json({ error: `Akun guru dengan NIP/Username "${nip}" sudah terdaftar.` });
    return;
  }

  const teacher: TeacherAccount = {
    id: `guru-${crypto.randomUUID()}`,
    nip,
    fullName,
    subject: subject || 'Guru Mata Pelajaran',
    passwordHash: hashPassword(password),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    createdAt: new Date().toISOString(),
  };

  db.teachers.push(teacher);
  store.commit();
  sendToAdmins('sync:teachers', { action: 'created', teacherId: teacher.id });

  res.status(201).json({
    teacher: {
      id: teacher.id,
      nip: teacher.nip,
      fullName: teacher.fullName,
      subject: teacher.subject,
      isActive: teacher.isActive,
      createdAt: teacher.createdAt,
      banksCount: 0,
      examsCount: 0,
    },
  });
});

app.put('/api/admin/teachers/:id', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const teacher = (db.teachers || []).find((t) => t.id === req.params.id);
  if (!teacher) {
    res.status(404).json({ error: 'Akun guru tidak ditemukan.' });
    return;
  }

  const body = req.body || {};
  if (typeof body.nip === 'string' && body.nip.trim()) {
    const nextNip = body.nip.trim();
    const dup = db.teachers.find(
      (t) => t.id !== teacher.id && t.nip.trim().toLowerCase() === nextNip.toLowerCase()
    );
    if (dup) {
      res.status(409).json({ error: `NIP/Username "${nextNip}" sudah digunakan guru lain.` });
      return;
    }
    teacher.nip = nextNip;
  }

  let bankUpdated = false;
  if (typeof body.fullName === 'string' && body.fullName.trim()) {
    const nextName = body.fullName.trim();
    if (nextName !== teacher.fullName) {
      const oldName = teacher.fullName.trim().toLowerCase();
      teacher.fullName = nextName;
      for (const bank of db.banks) {
        if (bank.teacherId === teacher.id || bank.teacherName.trim().toLowerCase() === oldName) {
          bank.teacherId = teacher.id;
          bank.teacherName = nextName;
          bankUpdated = true;
        }
      }
    }
  }
  if (typeof body.subject === 'string' && body.subject.trim()) {
    teacher.subject = body.subject.trim();
  }
  if (typeof body.isActive === 'boolean') {
    teacher.isActive = body.isActive;
  }
  if (typeof body.password === 'string' && body.password.trim()) {
    if (body.password.trim().length < 6) {
      res.status(400).json({ error: 'Password baru guru minimal 6 karakter.' });
      return;
    }
    teacher.passwordHash = hashPassword(body.password.trim());
  }

  store.commit();
  sendToAdmins('sync:teachers', { action: 'updated', teacherId: teacher.id });
  if (bankUpdated) {
    sendToAdmins('sync:banks', { action: 'teacher_renamed', teacherId: teacher.id });
  }

  res.json({
    teacher: {
      id: teacher.id,
      nip: teacher.nip,
      fullName: teacher.fullName,
      subject: teacher.subject,
      isActive: teacher.isActive,
      createdAt: teacher.createdAt,
    },
  });
});

app.delete('/api/admin/teachers/:id', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const idx = (db.teachers || []).findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Akun guru tidak ditemukan.' });
    return;
  }
  const [removed] = db.teachers.splice(idx, 1);
  for (const bank of db.banks) {
    if (bank.teacherId === removed.id) {
      bank.teacherId = undefined;
    }
  }
  store.commit();
  sendToAdmins('sync:teachers', { action: 'deleted', teacherId: removed.id });
  res.json({ ok: true });
});

// Bank Soal CRUD & Excel Import (Admin, Proktor, dan Guru pengampu)
app.get('/api/admin/banks', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const banks = isGuruUser(req.user)
    ? db.banks.filter((b) => isBankOwnedByTeacher(b, req.user!))
    : db.banks;
  res.json({ banks });
});

app.post('/api/admin/banks', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!code || !subject) {
    res.status(400).json({ error: 'Kode Bank Soal dan Mata Pelajaran wajib diisi.' });
    return;
  }

  let teacherId: string | undefined =
    typeof body.teacherId === 'string' && body.teacherId.trim() ? body.teacherId.trim() : undefined;
  let teacherName =
    typeof body.teacherName === 'string' && body.teacherName.trim()
      ? body.teacherName.trim()
      : 'Guru Mata Pelajaran';

  if (isGuruUser(req.user)) {
    teacherId = req.user!.sub;
    teacherName = req.user!.name;
  } else if (teacherId) {
    const matchedTeacher = (db.teachers || []).find((t) => t.id === teacherId);
    if (matchedTeacher) {
      teacherName = matchedTeacher.fullName;
    }
  }

  const pgWeight =
    typeof body.pgWeightPercent === 'number' && !Number.isNaN(body.pgWeightPercent)
      ? Math.min(100, Math.max(0, Math.round(body.pgWeightPercent)))
      : 100;
  const essayWeight =
    typeof body.essayWeightPercent === 'number' && !Number.isNaN(body.essayWeightPercent)
      ? Math.min(100, Math.max(0, Math.round(body.essayWeightPercent)))
      : 100 - pgWeight;

  const now = new Date().toISOString();
  const bank: QuestionBank = {
    id: `bank-${crypto.randomUUID()}`,
    code,
    subject,
    gradeLevel: typeof body.gradeLevel === 'string' ? body.gradeLevel.trim() : 'XII',
    teacherId,
    teacherName,
    kkm: typeof body.kkm === 'number' && !Number.isNaN(body.kkm) ? Math.min(100, Math.max(0, body.kkm)) : 75,
    pgWeightPercent: pgWeight,
    essayWeightPercent: essayWeight,
    questions: [],
    createdAt: now,
    updatedAt: now,
  };
  db.banks.push(bank);
  store.commit();
  sendToAdmins('sync:banks', { action: 'created', bankId: bank.id });
  res.status(201).json({ bank });
});

app.put('/api/admin/banks/:id', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const bank = db.banks.find((b) => b.id === req.params.id);
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Anda hanya dapat mengubah Bank Soal milik Anda sendiri.' });
    return;
  }
  const body = req.body || {};
  if (typeof body.code === 'string' && body.code.trim()) bank.code = body.code.trim().toUpperCase();
  if (typeof body.subject === 'string' && body.subject.trim()) bank.subject = body.subject.trim();
  if (typeof body.gradeLevel === 'string') bank.gradeLevel = body.gradeLevel.trim();
  if (!isGuruUser(req.user)) {
    if (typeof body.teacherId === 'string') {
      bank.teacherId = body.teacherId.trim() || undefined;
      if (bank.teacherId) {
        const matched = (db.teachers || []).find((t) => t.id === bank.teacherId);
        if (matched) bank.teacherName = matched.fullName;
      }
    }
    if (typeof body.teacherName === 'string' && body.teacherName.trim()) {
      bank.teacherName = body.teacherName.trim();
    }
  }
  if (typeof body.kkm === 'number') bank.kkm = Math.min(100, Math.max(0, body.kkm));
  if (typeof body.pgWeightPercent === 'number') bank.pgWeightPercent = body.pgWeightPercent;
  if (typeof body.essayWeightPercent === 'number') bank.essayWeightPercent = body.essayWeightPercent;
  bank.updatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('sync:banks', { action: 'updated', bankId: bank.id });
  res.json({ bank });
});

app.delete('/api/admin/banks/:id', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const idx = db.banks.findIndex((b) => b.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(db.banks[idx], req.user!)) {
    res.status(403).json({ error: 'Anda hanya dapat menghapus Bank Soal milik Anda sendiri.' });
    return;
  }
  const linkedExams = db.exams.filter((e) => e.bankId === req.params.id);
  if (linkedExams.length > 0) {
    res.status(409).json({
      error: `Bank soal masih dipakai oleh jadwal ujian (${linkedExams
        .map((e) => e.title)
        .join(', ')}). Hapus jadwal ujian terkait terlebih dahulu.`,
    });
    return;
  }
  const [removed] = db.banks.splice(idx, 1);
  store.commit();
  sendToAdmins('sync:banks', { action: 'deleted', bankId: removed.id });
  res.json({ ok: true });
});

app.post('/api/admin/banks/:id/questions', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const bank = db.banks.find((b) => b.id === req.params.id);
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Akses ditolak untuk Bank Soal guru lain.' });
    return;
  }
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'Teks pertanyaan wajib diisi.' });
    return;
  }
  const qType = body.type === 'ESAI' ? 'ESAI' : 'PG';
  const validAnswers = ['A', 'B', 'C', 'D', 'E'];
  const correct =
    qType === 'PG' && validAnswers.includes(String(body.correctAnswer).toUpperCase())
      ? (String(body.correctAnswer).toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E')
      : '';

  const question: Question = {
    id: `q-${crypto.randomUUID()}`,
    number: bank.questions.length + 1,
    type: qType,
    text,
    optionA: typeof body.optionA === 'string' ? body.optionA.trim() : '',
    optionB: typeof body.optionB === 'string' ? body.optionB.trim() : '',
    optionC: typeof body.optionC === 'string' ? body.optionC.trim() : '',
    optionD: typeof body.optionD === 'string' ? body.optionD.trim() : '',
    optionE: typeof body.optionE === 'string' ? body.optionE.trim() : '',
    correctAnswer: correct,
    weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 10,
  };
  bank.questions.push(question);
  bank.updatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('sync:banks', { action: 'question_added', bankId: bank.id });
  res.status(201).json({ question, bank });
});

app.put('/api/admin/banks/:id/questions/:qId', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const bank = db.banks.find((b) => b.id === req.params.id);
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Akses ditolak untuk Bank Soal guru lain.' });
    return;
  }
  const q = bank.questions.find((item) => item.id === req.params.qId);
  if (!q) {
    res.status(404).json({ error: 'Butir soal tidak ditemukan.' });
    return;
  }
  const body = req.body || {};
  if (body.type === 'PG' || body.type === 'ESAI') q.type = body.type;
  if (typeof body.text === 'string' && body.text.trim()) q.text = body.text.trim();
  if (typeof body.optionA === 'string') q.optionA = body.optionA.trim();
  if (typeof body.optionB === 'string') q.optionB = body.optionB.trim();
  if (typeof body.optionC === 'string') q.optionC = body.optionC.trim();
  if (typeof body.optionD === 'string') q.optionD = body.optionD.trim();
  if (typeof body.optionE === 'string') q.optionE = body.optionE.trim();
  if (typeof body.correctAnswer === 'string') {
    const up = body.correctAnswer.trim().toUpperCase();
    if (['A', 'B', 'C', 'D', 'E', ''].includes(up)) {
      q.correctAnswer = up as Question['correctAnswer'];
    }
  }
  if (typeof body.weight === 'number' && body.weight > 0) q.weight = body.weight;
  bank.updatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('sync:banks', { action: 'question_updated', bankId: bank.id });
  res.json({ question: q, bank });
});

app.delete('/api/admin/banks/:id/questions/:qId', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const bank = db.banks.find((b) => b.id === req.params.id);
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Akses ditolak untuk Bank Soal guru lain.' });
    return;
  }
  bank.questions = bank.questions
    .filter((q) => q.id !== req.params.qId)
    .map((q, idx) => ({ ...q, number: idx + 1 }));
  bank.updatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('sync:banks', { action: 'question_deleted', bankId: bank.id });
  res.json({ bank });
});

app.post('/api/admin/banks/:id/import', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const bank = db.banks.find((b) => b.id === req.params.id);
  if (!bank) {
    res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Akses ditolak untuk Bank Soal guru lain.' });
    return;
  }

  const incoming = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const replaceExisting = Boolean(req.body?.replaceExisting);

  if (incoming.length === 0) {
    res.status(400).json({ error: 'Tidak ada data soal valid untuk diimpor.' });
    return;
  }

  const validAnswers = ['A', 'B', 'C', 'D', 'E'];
  const sanitized: Question[] = [];
  const startNumber = replaceExisting ? 1 : bank.questions.length + 1;

  incoming.forEach((raw: Record<string, unknown>, idx: number) => {
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return;
    const rawType = typeof raw.type === 'string' ? raw.type.trim().toUpperCase() : 'PG';
    const type = rawType === 'ESAI' || rawType === 'ESSAY' ? 'ESAI' : 'PG';
    const rawCorrect = typeof raw.correctAnswer === 'string' ? raw.correctAnswer.trim().toUpperCase() : '';
    const correctAnswer =
      type === 'PG' && validAnswers.includes(rawCorrect)
        ? (rawCorrect as 'A' | 'B' | 'C' | 'D' | 'E')
        : '';

    sanitized.push({
      id: `q-${crypto.randomUUID()}`,
      number: startNumber + idx,
      type,
      text,
      optionA: typeof raw.optionA === 'string' ? raw.optionA.trim() : '',
      optionB: typeof raw.optionB === 'string' ? raw.optionB.trim() : '',
      optionC: typeof raw.optionC === 'string' ? raw.optionC.trim() : '',
      optionD: typeof raw.optionD === 'string' ? raw.optionD.trim() : '',
      optionE: typeof raw.optionE === 'string' ? raw.optionE.trim() : '',
      correctAnswer,
      weight: typeof raw.weight === 'number' && raw.weight > 0 ? raw.weight : 10,
    });
  });

  if (replaceExisting) {
    bank.questions = sanitized;
  } else {
    bank.questions.push(...sanitized);
  }
  bank.questions = bank.questions.map((q, idx) => ({ ...q, number: idx + 1 }));
  bank.updatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('sync:banks', { action: 'imported', bankId: bank.id });

  res.json({ importedCount: sanitized.length, bank });
});

// Peserta CRUD & Excel Import
app.get('/api/admin/students', requireAuth, requireStaff, (_req, res) => {
  res.json({ students: store.getDb().students });
});

app.post('/api/admin/students', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const body = req.body || {};
  const nis = typeof body.nis === 'string' ? body.nis.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!nis || !name) {
    res.status(400).json({ error: 'NIS dan Nama Peserta wajib diisi.' });
    return;
  }
  if (db.students.some((s) => s.nis === nis)) {
    res.status(409).json({ error: `Peserta dengan NIS ${nis} sudah terdaftar.` });
    return;
  }
  const student: Student = {
    id: `stu-${crypto.randomUUID()}`,
    nis,
    name,
    className: typeof body.className === 'string' ? body.className.trim() : 'XII TKJ 1',
    room: typeof body.room === 'string' ? body.room.trim() : 'LAB-01',
    sessionGroup: typeof body.sessionGroup === 'string' ? body.sessionGroup.trim() : 'Sesi 1',
    password: typeof body.password === 'string' && body.password.trim() ? body.password.trim() : '123',
  };
  db.students.push(student);
  store.commit();
  sendToAdmins('sync:students', { action: 'created', studentId: student.id });
  res.status(201).json({ student });
});

app.put('/api/admin/students/:id', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const student = db.students.find((s) => s.id === req.params.id);
  if (!student) {
    res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    return;
  }
  const body = req.body || {};
  if (typeof body.nis === 'string' && body.nis.trim()) {
    const nextNis = body.nis.trim();
    if (db.students.some((s) => s.id !== student.id && s.nis === nextNis)) {
      res.status(409).json({ error: `NIS ${nextNis} sudah digunakan peserta lain.` });
      return;
    }
    student.nis = nextNis;
  }
  if (typeof body.name === 'string' && body.name.trim()) student.name = body.name.trim();
  if (typeof body.className === 'string') student.className = body.className.trim();
  if (typeof body.room === 'string') student.room = body.room.trim();
  if (typeof body.sessionGroup === 'string') student.sessionGroup = body.sessionGroup.trim();
  if (typeof body.password === 'string' && body.password.trim()) student.password = body.password.trim();
  store.commit();
  sendToAdmins('sync:students', { action: 'updated', studentId: student.id });
  res.json({ student });
});

app.delete('/api/admin/students/:id', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const idx = db.students.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    return;
  }
  const [removed] = db.students.splice(idx, 1);
  store.commit();
  sendToAdmins('sync:students', { action: 'deleted', studentId: removed.id });
  res.json({ ok: true });
});

app.post('/api/admin/students/import', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    const nis = typeof raw?.nis === 'string' ? raw.nis.trim() : String(raw?.nis || '').trim();
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!nis || !name) continue;
    const existing = db.students.find((s) => s.nis === nis);
    if (existing) {
      existing.name = name;
      if (typeof raw.className === 'string' && raw.className.trim()) existing.className = raw.className.trim();
      if (typeof raw.room === 'string' && raw.room.trim()) existing.room = raw.room.trim();
      if (typeof raw.sessionGroup === 'string' && raw.sessionGroup.trim()) existing.sessionGroup = raw.sessionGroup.trim();
      if (typeof raw.password === 'string' && raw.password.trim()) existing.password = raw.password.trim();
      updated += 1;
    } else {
      db.students.push({
        id: `stu-${crypto.randomUUID()}`,
        nis,
        name,
        className: typeof raw.className === 'string' && raw.className.trim() ? raw.className.trim() : 'XII TKJ 1',
        room: typeof raw.room === 'string' && raw.room.trim() ? raw.room.trim() : 'LAB-01',
        sessionGroup: typeof raw.sessionGroup === 'string' && raw.sessionGroup.trim() ? raw.sessionGroup.trim() : 'Sesi 1',
        password: typeof raw.password === 'string' && raw.password.trim() ? raw.password.trim() : '123',
      });
      added += 1;
    }
  }

  store.commit();
  sendToAdmins('sync:students', { action: 'imported', added, updated });
  res.json({ added, updated, students: db.students });
});

// Jadwal Ujian & Token
app.get('/api/admin/exams', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    res.json({ exams: db.exams.filter((e) => ownedBankIds.has(e.bankId)) });
    return;
  }
  res.json({ exams: db.exams });
});

app.post('/api/admin/exams', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const bankId = typeof body.bankId === 'string' ? body.bankId : '';
  const bank = db.banks.find((b) => b.id === bankId);
  if (!title || !bank) {
    res.status(400).json({ error: 'Judul Ujian dan Bank Soal valid wajib dipilih.' });
    return;
  }
  if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
    res.status(403).json({ error: 'Anda hanya dapat menjadwalkan Bank Soal milik Anda sendiri.' });
    return;
  }

  const now = new Date().toISOString();
  const exam: ExamSchedule = {
    id: `exam-${crypto.randomUUID()}`,
    title,
    bankId: bank.id,
    subject: bank.subject,
    targetClasses: Array.isArray(body.targetClasses)
      ? body.targetClasses.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
      : [],
    durationMinutes:
      typeof body.durationMinutes === 'number' && body.durationMinutes >= 5 ? body.durationMinutes : 60,
    token: generateTokenCode(),
    tokenUpdatedAt: now,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    randomizeQuestions: body.randomizeQuestions !== undefined ? Boolean(body.randomizeQuestions) : true,
    randomizeOptions: body.randomizeOptions !== undefined ? Boolean(body.randomizeOptions) : true,
    showScoreAfterFinish: body.showScoreAfterFinish !== undefined ? Boolean(body.showScoreAfterFinish) : true,
    antiCheatEnabled: body.antiCheatEnabled !== undefined ? Boolean(body.antiCheatEnabled) : true,
    maxViolations:
      typeof body.maxViolations === 'number' && body.maxViolations >= 1 ? body.maxViolations : 3,
    startDate: typeof body.startDate === 'string' ? body.startDate : now.slice(0, 10),
    endDate: typeof body.endDate === 'string' ? body.endDate : now.slice(0, 10),
    createdAt: now,
  };
  db.exams.unshift(exam);
  store.commit();
  sendToAdmins('sync:exams', { action: 'created', examId: exam.id });
  broadcastToAllStudents('exams:updated', { examId: exam.id });
  res.status(201).json({ exam });
});

app.put('/api/admin/exams/:id', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const exam = db.exams.find((e) => e.id === req.params.id);
  if (!exam) {
    res.status(404).json({ error: 'Jadwal ujian tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    if (!ownedBankIds.has(exam.bankId)) {
      res.status(403).json({ error: 'Akses ditolak untuk jadwal ujian guru lain.' });
      return;
    }
  }
  const body = req.body || {};
  if (typeof body.title === 'string' && body.title.trim()) exam.title = body.title.trim();
  if (typeof body.bankId === 'string') {
    const bank = db.banks.find((b) => b.id === body.bankId);
    if (bank) {
      if (isGuruUser(req.user) && !isBankOwnedByTeacher(bank, req.user!)) {
        res.status(403).json({ error: 'Bank soal bukan milik Anda.' });
        return;
      }
      exam.bankId = bank.id;
      exam.subject = bank.subject;
    }
  }
  if (Array.isArray(body.targetClasses)) exam.targetClasses = body.targetClasses;
  if (typeof body.durationMinutes === 'number' && body.durationMinutes >= 5) exam.durationMinutes = body.durationMinutes;
  if (typeof body.isActive === 'boolean') exam.isActive = body.isActive;
  if (typeof body.randomizeQuestions === 'boolean') exam.randomizeQuestions = body.randomizeQuestions;
  if (typeof body.randomizeOptions === 'boolean') exam.randomizeOptions = body.randomizeOptions;
  if (typeof body.showScoreAfterFinish === 'boolean') exam.showScoreAfterFinish = body.showScoreAfterFinish;
  if (typeof body.antiCheatEnabled === 'boolean') exam.antiCheatEnabled = body.antiCheatEnabled;
  if (typeof body.maxViolations === 'number' && body.maxViolations >= 1) exam.maxViolations = body.maxViolations;
  if (typeof body.startDate === 'string') exam.startDate = body.startDate;
  if (typeof body.endDate === 'string') exam.endDate = body.endDate;
  store.commit();
  sendToAdmins('sync:exams', { action: 'updated', examId: exam.id });
  broadcastToAllStudents('exams:updated', { examId: exam.id });
  res.json({ exam });
});

app.delete('/api/admin/exams/:id', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const idx = db.exams.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Jadwal ujian tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    if (!ownedBankIds.has(db.exams[idx].bankId)) {
      res.status(403).json({ error: 'Akses ditolak untuk jadwal ujian guru lain.' });
      return;
    }
  }
  const [removed] = db.exams.splice(idx, 1);
  store.commit();
  sendToAdmins('sync:exams', { action: 'deleted', examId: removed.id });
  broadcastToAllStudents('exams:updated', { examId: removed.id });
  res.json({ ok: true });
});

app.post('/api/admin/exams/:id/rotate-token', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const exam = db.exams.find((e) => e.id === req.params.id);
  if (!exam) {
    res.status(404).json({ error: 'Jadwal ujian tidak ditemukan.' });
    return;
  }
  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    if (!ownedBankIds.has(exam.bankId)) {
      res.status(403).json({ error: 'Akses ditolak untuk jadwal ujian guru lain.' });
      return;
    }
  }
  exam.token = generateTokenCode();
  exam.tokenUpdatedAt = new Date().toISOString();
  store.commit();
  sendToAdmins('token:rotated', { examId: exam.id, token: exam.token, tokenUpdatedAt: exam.tokenUpdatedAt });
  sendToAdmins('sync:exams', { action: 'token_rotated', examId: exam.id });
  res.json({ exam });
});

// Live Monitoring & Proctoring Actions
app.get('/api/admin/monitoring', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  if (isGuruUser(req.user)) {
    const ownedBankIds = getOwnedBankIds(db, req.user!);
    const ownedExams = db.exams.filter((e) => ownedBankIds.has(e.bankId));
    const ownedExamIds = new Set(ownedExams.map((e) => e.id));
    res.json({
      sessions: db.sessions.filter((s) => ownedExamIds.has(s.examId)),
      violations: db.violations.filter((v) => ownedExamIds.has(v.examId)),
      exams: ownedExams,
      students: db.students,
      broadcasts: db.broadcasts,
      metrics: buildServerMetrics(),
    });
    return;
  }
  res.json({
    sessions: db.sessions,
    violations: db.violations,
    exams: db.exams,
    students: db.students,
    broadcasts: db.broadcasts,
    metrics: buildServerMetrics(),
  });
});

app.post('/api/admin/sessions/:sessionId/action', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const session = db.sessions.find((s) => s.id === req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
    return;
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  const exam = db.exams.find((e) => e.id === session.examId);
  const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;

  if (isGuruUser(req.user)) {
    if (!bank || !isBankOwnedByTeacher(bank, req.user!)) {
      res.status(403).json({ error: 'Anda hanya dapat mengontrol sesi ujian mata pelajaran Anda.' });
      return;
    }
  }

  if (action === 'UNLOCK') {
    session.status = 'SEDANG_UJIAN';
    session.blockedAt = undefined;
    session.violationCount = 0;
    session.lastViolationReason = undefined;
    store.commit();
    sendToStudent(session.studentId, 'admin:command', { action: 'UNLOCK', sessionId: session.id });
    sendToAdmins('session:updated', session);
    res.json({ ok: true, session });
    return;
  }

  if (action === 'LOCK') {
    session.status = 'TERBLOKIR';
    session.blockedAt = new Date().toISOString();
    session.lastViolationReason = `Diblokir secara manual oleh ${req.user?.name || 'Proktor'}`;
    store.commit();
    sendToStudent(session.studentId, 'admin:command', {
      action: 'LOCK',
      sessionId: session.id,
      reason: session.lastViolationReason,
    });
    sendToAdmins('session:updated', session);
    res.json({ ok: true, session });
    return;
  }

  if (action === 'FORCE_FINISH') {
    session.status = 'SELESAI';
    session.finishedAt = new Date().toISOString();
    session.isOnline = false;
    calculateSessionScore(session, bank);
    store.commit();
    sendToStudent(session.studentId, 'admin:command', { action: 'FORCE_FINISH', sessionId: session.id });
    sendToAdmins('session:updated', session);
    sendToAdmins('sync:results', { sessionId: session.id, examId: session.examId });
    res.json({ ok: true, session });
    return;
  }

  if (action === 'ADD_TIME') {
    const minutes = typeof req.body?.minutes === 'number' && req.body.minutes > 0 ? req.body.minutes : 10;
    const currentEnd = new Date(session.endsAt).getTime();
    const newEnd = new Date(Math.max(Date.now(), currentEnd) + minutes * 60 * 1000).toISOString();
    session.endsAt = newEnd;
    session.extraMinutes += minutes;
    store.commit();
    sendToStudent(session.studentId, 'admin:command', {
      action: 'ADD_TIME',
      sessionId: session.id,
      endsAt: newEnd,
      minutes,
    });
    sendToAdmins('session:updated', session);
    res.json({ ok: true, session });
    return;
  }

  if (action === 'RESET_LOGIN') {
    const idx = db.sessions.findIndex((s) => s.id === session.id);
    const stuId = session.studentId;
    if (idx !== -1) {
      db.sessions.splice(idx, 1);
      store.commit();
    }
    sendToStudent(stuId, 'admin:command', { action: 'RESET_LOGIN', sessionId: session.id });
    sendToAdmins('session:removed', { sessionId: session.id });
    res.json({ ok: true, removedSessionId: session.id });
    return;
  }

  res.status(400).json({ error: 'Aksi proktor tidak dikenali.' });
});

app.post('/api/admin/broadcast', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    res.status(400).json({ error: 'Isi pengumuman tidak boleh kosong.' });
    return;
  }
  const notice: BroadcastNotice = {
    id: `bc-${crypto.randomUUID()}`,
    message: message.slice(0, 300),
    sender: req.user?.name || 'Proktor',
    timestamp: new Date().toISOString(),
  };
  db.broadcasts.unshift(notice);
  if (db.broadcasts.length > 30) {
    db.broadcasts = db.broadcasts.slice(0, 30);
  }
  store.commit();
  broadcastToAllStudents('admin:broadcast', notice);
  sendToAdmins('admin:broadcast', notice);
  res.json({ notice });
});

// Results & Essay Grading
app.get('/api/admin/results', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const examId = typeof req.query.examId === 'string' ? req.query.examId : '';
  const guruMode = isGuruUser(req.user);
  const ownedBankIds = guruMode ? getOwnedBankIds(db, req.user!) : null;
  const scopedBanks = ownedBankIds ? db.banks.filter((b) => ownedBankIds.has(b.id)) : db.banks;
  const scopedExams = ownedBankIds ? db.exams.filter((e) => ownedBankIds.has(e.bankId)) : db.exams;
  const scopedExamIds = new Set(scopedExams.map((e) => e.id));

  let sessions = guruMode
    ? db.sessions.filter((s) => scopedExamIds.has(s.examId))
    : db.sessions;
  if (examId) {
    sessions = sessions.filter((s) => s.examId === examId);
  }

  const scopedViolations = guruMode
    ? db.violations.filter((v) => scopedExamIds.has(v.examId))
    : db.violations;

  const enriched = sessions.map((s) => {
    const exam = db.exams.find((e) => e.id === s.examId);
    const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;
    const essayQuestions = bank ? bank.questions.filter((q) => q.type === 'ESAI') : [];
    return {
      ...s,
      examTitle: exam?.title || '-',
      subject: exam?.subject || '-',
      kkm: bank?.kkm ?? 75,
      essayItems: essayQuestions.map((q) => ({
        questionId: q.id,
        number: q.number,
        questionText: q.text,
        studentAnswer: s.answers[q.id]?.answer || '',
        essayScore: s.answers[q.id]?.essayScore ?? 0,
      })),
    };
  });

  res.json({
    results: enriched,
    exams: scopedExams,
    banks: scopedBanks,
    violations: scopedViolations,
    settings: db.settings,
  });
});

app.post('/api/admin/results/:sessionId/grade-essay', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const session = db.sessions.find((s) => s.id === req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sesi hasil ujian tidak ditemukan.' });
    return;
  }
  const exam = db.exams.find((e) => e.id === session.examId);
  const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;
  if (isGuruUser(req.user) && (!bank || !isBankOwnedByTeacher(bank, req.user!))) {
    res.status(403).json({ error: 'Anda hanya dapat mengoreksi esai mata pelajaran Anda.' });
    return;
  }
  const scores = req.body?.scores as Record<string, number> | undefined;
  if (!scores || typeof scores !== 'object') {
    res.status(400).json({ error: 'Format skor esai tidak valid.' });
    return;
  }

  for (const [qId, val] of Object.entries(scores)) {
    const numeric = Math.min(100, Math.max(0, Number(val) || 0));
    if (!session.answers[qId]) {
      session.answers[qId] = {
        questionId: qId,
        answer: '',
        isDoubtful: false,
        essayScore: numeric,
        updatedAt: new Date().toISOString(),
      };
    } else {
      session.answers[qId].essayScore = numeric;
    }
  }

  calculateSessionScore(session, bank);
  store.commit();
  sendToAdmins('session:updated', session);
  sendToAdmins('sync:results', { sessionId: session.id, examId: session.examId });

  res.json({ session });
});

// QR Code Attendance Routes
function extractNisFromQr(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('CANDYCBT|STU|')) {
    return trimmed.slice('CANDYCBT|STU|'.length).split('|')[0].trim();
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { nis?: unknown };
      if (typeof parsed.nis === 'string' || typeof parsed.nis === 'number') {
        return String(parsed.nis).trim();
      }
    } catch {
      // fallback to raw string
    }
  }
  return trimmed;
}

function getAttendancePeriodRange(
  periodRaw: unknown,
  dateRaw: unknown,
  monthRaw: unknown
): {
  period: 'daily' | 'weekly' | 'monthly';
  date: string;
  month: string;
  startDate: string;
  endDate: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  const period =
    periodRaw === 'weekly' || periodRaw === 'monthly' ? periodRaw : 'daily';

  const date =
    typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim())
      ? dateRaw.trim()
      : today;

  const month =
    typeof monthRaw === 'string' && /^\d{4}-\d{2}$/.test(monthRaw.trim())
      ? monthRaw.trim()
      : date.slice(0, 7);

  if (period === 'weekly') {
    const [y, m, d] = date.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = utcDate.getUTCDay(); // 0 = Sun, 1 = Mon, ...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(utcDate);
    monday.setUTCDate(utcDate.getUTCDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      period,
      date,
      month,
      startDate: monday.toISOString().slice(0, 10),
      endDate: sunday.toISOString().slice(0, 10),
    };
  }

  if (period === 'monthly') {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      period,
      date,
      month,
      startDate: `${month}-01`,
      endDate: `${month}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  return {
    period: 'daily',
    date,
    month,
    startDate: date,
    endDate: date,
  };
}

app.get('/api/admin/attendance', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const range = getAttendancePeriodRange(
    req.query.period,
    req.query.date,
    req.query.month
  );
  const examId = typeof req.query.examId === 'string' ? req.query.examId.trim() : '';

  const guruMode = isGuruUser(req.user);
  const ownedBankIds = guruMode ? getOwnedBankIds(db, req.user!) : null;
  const scopedExams = ownedBankIds ? db.exams.filter((e) => ownedBankIds.has(e.bankId)) : db.exams;

  const records = db.attendance
    .filter((r) => {
      const matchDate = r.date >= range.startDate && r.date <= range.endDate;
      const matchExam = !examId || examId === 'ALL' ? true : r.examId === examId;
      return matchDate && matchExam;
    })
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));

  res.json({
    period: range.period,
    date: range.date,
    month: range.month,
    startDate: range.startDate,
    endDate: range.endDate,
    records,
    students: db.students,
    exams: scopedExams,
    settings: db.settings,
  });
});

app.post('/api/admin/attendance/scan', requireAuth, requireStaff, (req: AuthenticatedRequest, res) => {
  const db = store.getDb();
  const rawQr = typeof req.body?.qrPayload === 'string' ? req.body.qrPayload : '';
  const nis = extractNisFromQr(rawQr);
  const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';

  const student = studentId
    ? db.students.find((s) => s.id === studentId)
    : db.students.find((s) => s.nis.toLowerCase() === nis.toLowerCase());

  if (!student) {
    res.status(404).json({
      error: nis
        ? `QR Code tidak dikenali. Peserta dengan NIS "${nis}" tidak ditemukan.`
        : 'Data QR Code atau NIS peserta tidak valid.',
    });
    return;
  }

  const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
    ? req.body.date
    : new Date().toISOString().slice(0, 10);
  const examId = typeof req.body?.examId === 'string' ? req.body.examId.trim() : '';
  const exam = examId ? db.exams.find((e) => e.id === examId) : undefined;
  const examTitle = exam ? exam.title : 'Absensi Harian CBT';

  const allowedStatuses: AttendanceStatus[] = ['HADIR', 'TERLAMBAT', 'IZIN', 'ALPA'];
  const rawStatus = typeof req.body?.status === 'string' ? req.body.status.toUpperCase() : 'HADIR';
  const status: AttendanceStatus = allowedStatuses.includes(rawStatus as AttendanceStatus)
    ? (rawStatus as AttendanceStatus)
    : 'HADIR';

  const allowedMethods: AttendanceMethod[] = ['QR_CAMERA', 'QR_IMAGE', 'MANUAL'];
  const rawMethod = typeof req.body?.method === 'string' ? req.body.method.toUpperCase() : 'QR_CAMERA';
  const method: AttendanceMethod = allowedMethods.includes(rawMethod as AttendanceMethod)
    ? (rawMethod as AttendanceMethod)
    : 'QR_CAMERA';

  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 200) : '';

  const existing = db.attendance.find(
    (a) => a.date === date && a.examId === (exam?.id || '') && a.studentId === student.id
  );
  if (existing) {
    res.json({
      duplicate: true,
      record: existing,
      message: `${student.name} (${student.nis}) sudah tercatat ${existing.status} pada ${new Date(
        existing.scannedAt
      ).toLocaleTimeString('id-ID')}.`,
    });
    return;
  }

  const record: AttendanceRecord = {
    id: `att-${crypto.randomUUID()}`,
    date,
    examId: exam?.id || '',
    examTitle,
    studentId: student.id,
    studentNis: student.nis,
    studentName: student.name,
    className: student.className,
    room: student.room,
    sessionGroup: student.sessionGroup,
    status,
    method,
    scannedAt: new Date().toISOString(),
    scannedBy: req.user?.name || 'Proktor',
    notes: notes || undefined,
  };

  db.attendance.unshift(record);
  store.commit();
  sendToAdmins('attendance:recorded', record);

  res.status(201).json({
    duplicate: false,
    record,
    message: `Berhasil mencatat ${status}: ${student.name} (${student.className}).`,
  });
});

app.put('/api/admin/attendance/:id', requireAuth, requireStaff, (req, res) => {
  const db = store.getDb();
  const record = db.attendance.find((a) => a.id === req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Data absensi tidak ditemukan.' });
    return;
  }
  const allowedStatuses: AttendanceStatus[] = ['HADIR', 'TERLAMBAT', 'IZIN', 'ALPA'];
  if (typeof req.body?.status === 'string') {
    const up = req.body.status.toUpperCase() as AttendanceStatus;
    if (allowedStatuses.includes(up)) record.status = up;
  }
  if (typeof req.body?.notes === 'string') {
    record.notes = req.body.notes.trim().slice(0, 200) || undefined;
  }
  store.commit();
  sendToAdmins('attendance:updated', record);
  res.json({ record });
});

app.delete('/api/admin/attendance/:id', requireAuth, requireStaff, (req, res) => {
  const db = store.getDb();
  const idx = db.attendance.findIndex((a) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Data absensi tidak ditemukan.' });
    return;
  }
  const [removed] = db.attendance.splice(idx, 1);
  store.commit();
  sendToAdmins('attendance:removed', { id: removed.id });
  res.json({ ok: true });
});

// Server Management
app.get('/api/admin/server-status', requireAuth, requireAdmin, (_req, res) => {
  const db = store.getDb();
  res.json({
    metrics: buildServerMetrics(),
    settings: db.settings,
  });
});

app.post('/api/admin/server/maintenance', requireAuth, requireAdmin, (req, res) => {
  const db = store.getDb();
  db.settings.maintenanceMode = Boolean(req.body?.enabled);
  store.commit();
  sendToAdmins('sync:settings', db.settings);
  res.json({
    maintenanceMode: db.settings.maintenanceMode,
    settings: db.settings,
    metrics: buildServerMetrics(),
  });
});

app.post('/api/admin/server/optimize', requireAuth, requireAdmin, (_req, res) => {
  const db = store.getDb();
  let recalculated = 0;
  for (const s of db.sessions) {
    const exam = db.exams.find((e) => e.id === s.examId);
    const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;
    calculateSessionScore(s, bank);
    recalculated += 1;
  }
  store.commit();
  res.json({ ok: true, recalculated, metrics: buildServerMetrics() });
});

app.get('/api/admin/server/backup', requireAuth, requireAdmin, (_req, res) => {
  const db = store.getDb();
  const safeCopy: CbtDatabase = {
    ...db,
    admins: db.admins,
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="candycbt-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(safeCopy, null, 2));
});

app.post('/api/admin/server/restore', requireAuth, requireAdmin, (req, res) => {
  const payload = req.body as Partial<CbtDatabase>;
  if (
    !payload ||
    !payload.settings ||
    !Array.isArray(payload.students) ||
    !Array.isArray(payload.banks) ||
    !Array.isArray(payload.exams) ||
    !Array.isArray(payload.sessions)
  ) {
    res.status(400).json({ error: 'File backup JSON CandyCBT tidak valid atau korup.' });
    return;
  }
  const current = store.getDb();
  store.replaceAll({
    settings: payload.settings,
    admins: Array.isArray(payload.admins) && payload.admins.length > 0 ? payload.admins : current.admins,
    teachers: Array.isArray(payload.teachers) && payload.teachers.length > 0 ? payload.teachers : current.teachers,
    students: payload.students,
    banks: payload.banks,
    exams: payload.exams,
    sessions: payload.sessions,
    violations: Array.isArray(payload.violations) ? payload.violations : [],
    broadcasts: Array.isArray(payload.broadcasts) ? payload.broadcasts : [],
    attendance: Array.isArray(payload.attendance) ? payload.attendance : [],
  });
  const restored = store.getDb();
  sendToAdmins('sync:settings', restored.settings);
  sendToAdmins('sync:teachers', { action: 'restored' });
  sendToAdmins('sync:students', { action: 'restored' });
  sendToAdmins('sync:banks', { action: 'restored' });
  sendToAdmins('sync:exams', { action: 'restored' });
  sendToAdmins('sync:results', { action: 'restored' });
  res.json({ ok: true, settings: restored.settings, metrics: buildServerMetrics() });
});

// Auto-rotate token & auto-close expired exam sessions every 30s
setInterval(() => {
  const db = store.getDb();
  let changed = false;
  const now = Date.now();

  if (db.settings.autoRotateToken) {
    const intervalMs = Math.max(5, db.settings.tokenIntervalMinutes) * 60 * 1000;
    for (const exam of db.exams) {
      if (exam.isActive && now - new Date(exam.tokenUpdatedAt).getTime() >= intervalMs) {
        exam.token = generateTokenCode();
        exam.tokenUpdatedAt = new Date(now).toISOString();
        changed = true;
        sendToAdmins('token:rotated', {
          examId: exam.id,
          token: exam.token,
          tokenUpdatedAt: exam.tokenUpdatedAt,
        });
      }
    }
  }

  for (const s of db.sessions) {
    if (s.status === 'SEDANG_UJIAN' && new Date(s.endsAt).getTime() <= now) {
      const exam = db.exams.find((e) => e.id === s.examId);
      const bank = exam ? db.banks.find((b) => b.id === exam.bankId) : undefined;
      s.status = 'SELESAI';
      s.finishedAt = new Date(now).toISOString();
      s.isOnline = false;
      calculateSessionScore(s, bank);
      changed = true;
      sendToStudent(s.studentId, 'admin:command', { action: 'FORCE_FINISH', sessionId: s.id });
      sendToAdmins('session:updated', s);
      sendToAdmins('sync:results', { sessionId: s.id, examId: s.examId });
    }
  }

  if (changed) {
    store.commit();
  }
}, 30_000);

// ---------- VITE / STATIC FRONTEND ----------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CandyCBT server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CandyCBT server:', err);
  process.exit(1);
});
