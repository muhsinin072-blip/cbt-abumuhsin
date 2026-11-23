import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import type { EnrichedResultSession } from './api';
import type {
  AttendancePeriod,
  AttendanceRecord,
  ExamSchedule,
  SchoolSettings,
  Student,
  ViolationLog,
} from '../types/cbt';
import { getThemePdfRgb } from './theme';

function getPdfImageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  if (dataUrl.startsWith('data:image/webp')) {
    return 'WEBP';
  }
  return 'PNG';
}

function drawSchoolHeader(doc: jsPDF, settings: SchoolSettings, docTitle: string, subtitle?: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const [r, g, b] = getThemePdfRgb(settings.themeColor);

  if (settings.schoolLogo) {
    try {
      doc.addImage(settings.schoolLogo, getPdfImageFormat(settings.schoolLogo), 14, 9.5, 13.5, 13.5);
    } catch {
      // ignore invalid image format gracefully
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(settings.schoolName.toUpperCase(), pageWidth / 2, 16, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${settings.address} · NPSN: ${settings.npsn} · Tahun Ajaran ${settings.academicYear} (${settings.semester})`,
    pageWidth / 2,
    21.5,
    { align: 'center' }
  );

  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.7);
  doc.line(14, 25, pageWidth - 14, 25);
  doc.setLineWidth(0.2);
  doc.line(14, 26.2, pageWidth - 14, 26.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(docTitle, pageWidth / 2, 33.5, { align: 'center' });

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    doc.text(subtitle, pageWidth / 2, 39, { align: 'center' });
    return 45;
  }

  return 40;
}

function drawSignatureBlock(doc: jsPDF, settings: SchoolSettings, startY: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = startY + 10;
  if (y + 38 > pageHeight - 12) {
    doc.addPage();
    y = 24;
  }

  const dateText = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const cityLabel = settings.city?.trim() || 'Nusantara';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);

  doc.text('Mengetahui,', 20, y);
  doc.text('Kepala Sekolah', 20, y + 5);

  if (settings.principalSignature) {
    try {
      doc.addImage(
        settings.principalSignature,
        getPdfImageFormat(settings.principalSignature),
        19,
        y + 6.5,
        34,
        14
      );
    } catch {
      // ignore invalid image
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.text(settings.principalName, 20, y + 25);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${settings.principalNip}`, 20, y + 30);

  const rightX = pageWidth - 78;
  doc.text(`${cityLabel}, ${dateText}`, rightX, y);
  doc.text('Proktor / Koordinator CBT', rightX, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.proctorName, rightX, y + 25);
  doc.setFont('helvetica', 'normal');
  doc.text(`Server: ${settings.serverName}`, rightX, y + 30);
}

export function generateResultsPDF(
  results: EnrichedResultSession[],
  settings: SchoolSettings,
  exam?: ExamSchedule
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const subtitle = exam
    ? `${exam.title} · Mata Pelajaran: ${exam.subject}`
    : 'Semua Jadwal Ujian Aktif';
  const startY = drawSchoolHeader(doc, settings, 'LAPORAN HASIL UJIAN BERBASIS KOMPUTER (CBT)', subtitle);

  const scores = results.map((r) => r.finalScore);
  const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '0.0';
  const max = scores.length > 0 ? Math.max(...scores).toFixed(1) : '0.0';
  const min = scores.length > 0 ? Math.min(...scores).toFixed(1) : '0.0';
  const passed = results.filter((r) => r.finalScore >= r.kkm).length;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Total Peserta: ${results.length}   |   Tuntas KKM: ${passed}   |   Rata-rata: ${avg}   |   Tertinggi: ${max}   |   Terendah: ${min}`,
    14,
    startY
  );

  autoTable(doc, {
    startY: startY + 4,
    head: [['No', 'NIS', 'Nama Peserta', 'Kelas', 'Benar PG', 'PG', 'Esai', 'Nilai Akhir', 'Status KKM']],
    body: results.map((r, i) => [
      String(i + 1),
      r.studentNis,
      r.studentName,
      r.className,
      `${r.pgCorrect}/${r.pgTotal}`,
      r.pgScore.toFixed(1),
      r.essayScore.toFixed(1),
      r.finalScore.toFixed(1),
      r.finalScore >= r.kkm ? 'TUNTAS' : 'REMEDIAL',
    ]),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: getThemePdfRgb(settings.themeColor), textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 22 },
      4: { halign: 'center', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 14 },
      6: { halign: 'right', cellWidth: 14 },
      7: { halign: 'right', cellWidth: 20, fontStyle: 'bold' },
      8: { halign: 'center', cellWidth: 22 },
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY + 40;
  drawSignatureBlock(doc, settings, finalY);

  const safeSubject = (exam?.subject || 'Semua_Mapel').replace(/[^a-zA-Z0-9]+/g, '_');
  doc.save(`Laporan_Hasil_Ujian_${safeSubject}.pdf`);
}

export function generateViolationsPDF(
  violations: ViolationLog[],
  settings: SchoolSettings
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawSchoolHeader(
    doc,
    settings,
    'LAPORAN AUDIT PEMANTAUAN KECURANGAN OTOMATIS',
    `Dicetak pada ${new Date().toLocaleString('id-ID')}`
  );

  const blockedCount = violations.filter((v) => v.triggeredBlock).length;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Total Log Pelanggaran: ${violations.length}   |   Berujung Blokir Otomatis: ${blockedCount}`,
    14,
    startY
  );

  autoTable(doc, {
    startY: startY + 4,
    head: [['No', 'Waktu', 'NIS', 'Nama Peserta', 'Kelas', 'Jenis Pelanggaran', 'Keterangan', 'Status']],
    body:
      violations.length > 0
        ? violations.map((v, idx) => [
            String(idx + 1),
            new Date(v.timestamp).toLocaleTimeString('id-ID'),
            v.studentNis,
            v.studentName,
            v.className,
            v.type,
            v.description,
            v.triggeredBlock ? `BLOKIR (${v.countAtTime}x)` : `PERINGATAN (${v.countAtTime}x)`,
          ])
        : [['-', '-', '-', 'Tidak ada pelanggaran tercatat', '-', '-', '-', 'BERSIH']],
    styles: { fontSize: 8, cellPadding: 2.3 },
    headStyles: { fillColor: [185, 28, 28], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [254, 242, 242] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY + 40;
  drawSignatureBlock(doc, settings, finalY);
  doc.save(`Laporan_Kecurangan_CandyCBT_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function generateBeritaAcaraPDF(
  exam: ExamSchedule,
  results: EnrichedResultSession[],
  allStudentsCount: number,
  settings: SchoolSettings
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawSchoolHeader(
    doc,
    settings,
    'BERITA ACARA PELAKSANAAN UJIAN BERBASIS KOMPUTER',
    `Tahun Pelajaran ${settings.academicYear} · Semester ${settings.semester}`
  );

  const todayFormatted = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const finishedCount = results.filter((r) => r.status === 'SELESAI').length;
  const blockedCount = results.filter((r) => r.status === 'TERBLOKIR').length;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  const paragraph = `Pada hari ini ${todayFormatted}, telah dilaksanakan Ujian Berbasis Komputer (CandyCBT) secara tertib dan lancar dengan rincian sebagai berikut:`;
  const splitPara = doc.splitTextToSize(paragraph, 180);
  doc.text(splitPara, 15, startY + 2);

  autoTable(doc, {
    startY: startY + 14,
    body: [
      ['Judul Ujian', `: ${exam.title}`],
      ['Mata Pelajaran', `: ${exam.subject}`],
      ['Kelas Sasaran', `: ${exam.targetClasses.join(', ') || 'Semua Kelas'}`],
      ['Durasi Pengerjaan', `: ${exam.durationMinutes} Menit`],
      ['Server Pelaksana', `: ${settings.serverName}`],
      ['Jumlah Peserta Terdaftar', `: ${allStudentsCount} Peserta`],
      ['Peserta Mengikuti / Selesai', `: ${results.length} Mengikuti (${finishedCount} Selesai)`],
      ['Peserta Terblokir Anti-Cheat', `: ${blockedCount} Peserta`],
      ['Token Sesi Ujian', `: ${exam.token}`],
    ],
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } },
  });

  const afterTableY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY + 65;
  doc.setFontSize(9.5);
  doc.text(
    'Demikian Berita Acara pelaksanaan ujian ini dibuat dengan sesungguhnya untuk dapat dipergunakan sebagaimana mestinya.',
    15,
    afterTableY + 8,
    { maxWidth: 180 }
  );

  drawSignatureBlock(doc, settings, afterTableY + 18);
  doc.save(`Berita_Acara_${exam.subject.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`);
}

export interface ParticipantCardsPdfOptions {
  className?: string;
  groupByClass?: boolean;
}

function toSafePdfSlug(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Semua'
  );
}

function drawParticipantPageClassHeader(
  doc: jsPDF,
  classLabel: string,
  studentCount: number,
  pageInClass: number,
  totalPagesInClass: number,
  settings: SchoolSettings
): void {
  const [r, g, b] = getThemePdfRgb(settings.themeColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(r, g, b);
  doc.text(`KELAS: ${classLabel.toUpperCase()} (${studentCount} Peserta)`, 14, 8.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${settings.schoolName} · Hal ${pageInClass}/${totalPagesInClass}`,
    196,
    8.2,
    { align: 'right' }
  );

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.line(14, 9.8, 196, 9.8);
}

export async function generateParticipantCardsPDF(
  students: Student[],
  settings: SchoolSettings,
  options?: ParticipantCardsPdfOptions
): Promise<void> {
  if (students.length === 0) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const cardWidth = 86;
  const cardHeight = 52;
  const marginX = 14;
  const marginY = 12;
  const gapX = 10;
  const gapY = 3.5;

  const uniqueNis = Array.from(new Set(students.map((s) => s.nis)));
  const qrEntries = await Promise.all(
    uniqueNis.map(async (nisCode) => {
      const dataUrl = await QRCode.toDataURL(`CANDYCBT|STU|${nisCode}`, {
        width: 160,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      return [nisCode, dataUrl] as const;
    })
  );
  const qrByNis = new Map<string, string>(qrEntries);

  const renderCard = (stu: Student, posOnPage: number) => {
    const col = posOnPage % 2;
    const row = Math.floor(posOnPage / 2);
    const x = marginX + col * (cardWidth + gapX);
    const y = marginY + row * (cardHeight + gapY);

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.35);
    doc.rect(x, y, cardWidth, cardHeight);

    const themeRgb = getThemePdfRgb(settings.themeColor);
    doc.setFillColor(themeRgb[0], themeRgb[1], themeRgb[2]);
    doc.rect(x, y, cardWidth, 9.5, 'F');
    if (settings.schoolLogo) {
      try {
        doc.addImage(settings.schoolLogo, getPdfImageFormat(settings.schoolLogo), x + 2, y + 1.5, 6.5, 6.5);
      } catch {
        // ignore invalid image
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(255, 255, 255);
    doc.text('KARTU PESERTA & QR ABSENSI CANDYCBT', x + cardWidth / 2, y + 4.3, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(settings.schoolName, x + cardWidth / 2, y + 8, { align: 'center' });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(7.5);
    const rows: [string, string][] = [
      ['Nama', stu.name.slice(0, 21)],
      ['NIS', stu.nis],
      ['Pass', stu.password],
      ['Kelas', stu.className],
      ['Ruang', `${stu.room} · ${stu.sessionGroup}`],
    ];
    rows.forEach(([label, val], rIdx) => {
      const ry = y + 14.3 + rIdx * 4.8;
      doc.setFont('helvetica', 'normal');
      doc.text(label, x + 3.5, ry);
      doc.setFont('helvetica', 'bold');
      doc.text(`: ${val}`, x + 16.5, ry);
    });

    const qrImg = qrByNis.get(stu.nis);
    if (qrImg) {
      doc.addImage(qrImg, 'PNG', x + cardWidth - 25, y + 11.3, 21, 21);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(71, 85, 105);
      doc.text('SCAN QR ABSEN', x + cardWidth - 14.5, y + 34.8, { align: 'center' });
    }

    // Pemisah & blok pengesahan Kepala Sekolah di bagian bawah kartu
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(x + 3, y + 36.6, x + cardWidth - 3, y + 36.6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(100, 116, 139);
    doc.text(`${settings.academicYear} · ${settings.semester}`, x + 3.5, y + 40.3);
    doc.text('Kartu wajib dibawa saat ujian', x + 3.5, y + 43.8);

    const sigCenterX = x + cardWidth - 20.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(51, 65, 85);
    doc.text('Kepala Sekolah,', sigCenterX, y + 39.6, { align: 'center' });

    if (settings.principalSignature) {
      try {
        doc.addImage(
          settings.principalSignature,
          getPdfImageFormat(settings.principalSignature),
          sigCenterX - 9,
          y + 40.1,
          18,
          6.2
        );
      } catch {
        // ignore invalid signature image
      }
    }

    const principalName = (settings.principalName || '-').trim();
    doc.setFont('helvetica', 'bold');
    let nameFontSize = 6.0;
    doc.setFontSize(nameFontSize);
    while (nameFontSize > 4.6 && doc.getTextWidth(principalName) > 36) {
      nameFontSize -= 0.3;
      doc.setFontSize(nameFontSize);
    }
    doc.setTextColor(15, 23, 42);
    doc.text(principalName, sigCenterX, y + 48.1, { align: 'center' });

    if (settings.principalNip?.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.1);
      doc.setTextColor(71, 85, 105);
      doc.text(`NIP. ${settings.principalNip.trim()}`, sigCenterX, y + 50.6, { align: 'center' });
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  if (options?.groupByClass) {
    const grouped = new Map<string, Student[]>();
    students.forEach((stu) => {
      const cls = stu.className?.trim() || 'Tanpa Kelas';
      const list = grouped.get(cls);
      if (list) {
        list.push(stu);
      } else {
        grouped.set(cls, [stu]);
      }
    });

    const sortedClasses = Array.from(grouped.keys()).sort((a, b) =>
      a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' })
    );

    sortedClasses.forEach((cls, groupIdx) => {
      if (groupIdx > 0) {
        doc.addPage();
      }
      const classStudents = [...(grouped.get(cls) || [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
      );
      const totalPagesInClass = Math.max(1, Math.ceil(classStudents.length / 10));

      classStudents.forEach((stu, idx) => {
        const posOnPage = idx % 10;
        if (idx > 0 && posOnPage === 0) {
          doc.addPage();
        }
        if (posOnPage === 0) {
          const pageInClass = Math.floor(idx / 10) + 1;
          drawParticipantPageClassHeader(
            doc,
            cls,
            classStudents.length,
            pageInClass,
            totalPagesInClass,
            settings
          );
        }
        renderCard(stu, posOnPage);
      });
    });

    doc.save(`Kartu_Peserta_Per_Kelas_${today}.pdf`);
    return;
  }

  const singleClassLabel = options?.className?.trim();
  const orderedStudents = singleClassLabel
    ? [...students].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }))
    : students;
  const totalPages = Math.max(1, Math.ceil(orderedStudents.length / 10));

  orderedStudents.forEach((stu, idx) => {
    const posOnPage = idx % 10;
    if (idx > 0 && posOnPage === 0) {
      doc.addPage();
    }
    if (singleClassLabel && posOnPage === 0) {
      const pageNum = Math.floor(idx / 10) + 1;
      drawParticipantPageClassHeader(
        doc,
        singleClassLabel,
        orderedStudents.length,
        pageNum,
        totalPages,
        settings
      );
    }
    renderCard(stu, posOnPage);
  });

  if (singleClassLabel) {
    doc.save(`Kartu_Peserta_${toSafePdfSlug(singleClassLabel)}_${today}.pdf`);
  } else {
    doc.save(`Kartu_Peserta_QR_CandyCBT_${today}.pdf`);
  }
}

export function generateAttendancePDF(
  records: AttendanceRecord[],
  allStudents: Student[],
  dateOrLabel: string,
  examTitle: string,
  settings: SchoolSettings,
  periodOptions?: { period: AttendancePeriod; startDate: string; endDate: string; fileSlug: string }
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const period = periodOptions?.period || 'daily';
  const periodHeading =
    period === 'weekly'
      ? 'REKAPITULASI ABSENSI PEKANAN PESERTA (QR CODE)'
      : period === 'monthly'
        ? 'REKAPITULASI ABSENSI BULANAN PESERTA (QR CODE)'
        : 'DAFTAR HADIR HARIAN PESERTA UJIAN (QR CODE)';

  const startY = drawSchoolHeader(
    doc,
    settings,
    periodHeading,
    `Periode: ${dateOrLabel} · ${examTitle}`
  );

  const hadir = records.filter((r) => r.status === 'HADIR').length;
  const terlambat = records.filter((r) => r.status === 'TERLAMBAT').length;
  const izin = records.filter((r) => r.status === 'IZIN').length;
  const alpa = records.filter((r) => r.status === 'ALPA').length;

  if (period === 'daily') {
    const belum = Math.max(0, allStudents.length - records.length);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Total Terdaftar: ${allStudents.length}   |   Hadir: ${hadir}   |   Terlambat: ${terlambat}   |   Izin: ${izin}   |   Alpa: ${alpa}   |   Belum Absen: ${belum}`,
      14,
      startY
    );

    autoTable(doc, {
      startY: startY + 4,
      head: [['No', 'NIS', 'Nama Peserta', 'Kelas', 'Ruang', 'Waktu Scan', 'Metode', 'Status']],
      body: allStudents.map((stu, idx) => {
        const rec = records.find((r) => r.studentId === stu.id);
        return [
          String(idx + 1),
          stu.nis,
          stu.name,
          stu.className,
          stu.room,
          rec ? new Date(rec.scannedAt).toLocaleTimeString('id-ID') : '-',
          rec ? (rec.method === 'QR_CAMERA' ? 'Kamera QR' : rec.method === 'QR_IMAGE' ? 'Gambar QR' : 'Manual') : '-',
          rec ? rec.status : 'BELUM ABSEN',
        ];
      }),
      styles: { fontSize: 8.2, cellPadding: 2.3 },
      headStyles: { fillColor: getThemePdfRgb(settings.themeColor), textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 22 },
        4: { cellWidth: 18 },
        5: { halign: 'center', cellWidth: 20 },
        6: { halign: 'center', cellWidth: 22 },
        7: { halign: 'center', cellWidth: 26, fontStyle: 'bold' },
      },
    });
  } else {
    const activeDays = new Set(records.map((r) => r.date)).size;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Peserta: ${allStudents.length}   |   Hari Aktif Tercatat: ${activeDays}   |   Total Scan: ${records.length} (Hadir: ${hadir}, Terlambat: ${terlambat}, Izin: ${izin}, Alpa: ${alpa})`,
      14,
      startY
    );

    autoTable(doc, {
      startY: startY + 4,
      head: [['No', 'NIS', 'Nama Peserta', 'Kelas', 'Hadir', 'Terlambat', 'Izin', 'Alpa', 'Total Hadir']],
      body: allStudents.map((stu, idx) => {
        const stuRecs = records.filter((r) => r.studentId === stu.id);
        const hCount = stuRecs.filter((r) => r.status === 'HADIR').length;
        const tCount = stuRecs.filter((r) => r.status === 'TERLAMBAT').length;
        const iCount = stuRecs.filter((r) => r.status === 'IZIN').length;
        const aCount = stuRecs.filter((r) => r.status === 'ALPA').length;
        return [
          String(idx + 1),
          stu.nis,
          stu.name,
          stu.className,
          String(hCount),
          String(tCount),
          String(iCount),
          String(aCount),
          String(hCount + tCount),
        ];
      }),
      styles: { fontSize: 8.2, cellPadding: 2.3 },
      headStyles: { fillColor: getThemePdfRgb(settings.themeColor), textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 22 },
        3: { cellWidth: 24 },
        4: { halign: 'center', cellWidth: 16 },
        5: { halign: 'center', cellWidth: 20 },
        6: { halign: 'center', cellWidth: 14 },
        7: { halign: 'center', cellWidth: 14 },
        8: { halign: 'center', cellWidth: 22, fontStyle: 'bold' },
      },
    });
  }

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || startY + 40;
  drawSignatureBlock(doc, settings, finalY);
  const slug = periodOptions?.fileSlug || dateOrLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Daftar_Hadir_QR_${slug}.pdf`);
}

