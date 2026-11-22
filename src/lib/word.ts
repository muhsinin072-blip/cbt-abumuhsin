import JSZip from 'jszip';
import type { QuestionType } from '../types/cbt';
import type { ParsedExcelQuestion } from './excel';

const START_MARKER = '--- MULAI TULIS SOAL DI BAWAH GARIS INI ---';

interface XmlParagraphStyle {
  bold?: boolean;
  color?: string;
  sizeHalfPt?: number;
  spaceAfter?: number;
  spaceBefore?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function buildParagraphXml(text: string, style: XmlParagraphStyle = {}): string {
  const spaceAfter = style.spaceAfter ?? 80;
  const spaceBefore = style.spaceBefore ?? 0;
  const pPr = `<w:pPr><w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}" w:line="276" w:lineRule="auto"/></w:pPr>`;

  if (!text) {
    return `<w:p>${pPr}</w:p>`;
  }

  const rPrParts: string[] = ['<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'];
  if (style.bold) rPrParts.push('<w:b/>');
  if (style.color) rPrParts.push(`<w:color w:val="${style.color}"/>`);
  if (style.sizeHalfPt) {
    rPrParts.push(`<w:sz w:val="${style.sizeHalfPt}"/><w:szCs w:val="${style.sizeHalfPt}"/>`);
  }

  return `<w:p>${pPr}<w:r><w:rPr>${rPrParts.join('')}</w:rPr><w:t xml:space="preserve">${escapeXml(
    text
  )}</w:t></w:r></w:p>`;
}

export async function buildWordQuestionTemplateBytes(): Promise<Uint8Array> {
  const zip = new JSZip();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const paragraphs: string[] = [
    buildParagraphXml('TEMPLATE SOAL CANDYCBT (FORMAT TULISAN MUDAH)', {
      bold: true,
      color: '0F766E',
      sizeHalfPt: 28,
      spaceAfter: 100,
    }),
    buildParagraphXml('Petunjuk Penulisan Singkat:', {
      bold: true,
      color: '334155',
      sizeHalfPt: 22,
      spaceAfter: 40,
    }),
    buildParagraphXml('- Awali setiap soal dengan nomor (contoh: 1. Pertanyaan... atau 1) Pertanyaan...).', {
      color: '475569',
      sizeHalfPt: 20,
      spaceAfter: 30,
    }),
    buildParagraphXml('- Tulis pilihan jawaban A. sampai E. (atau a) sampai e)) di baris bawah soal.', {
      color: '475569',
      sizeHalfPt: 20,
      spaceAfter: 30,
    }),
    buildParagraphXml(
      '- Tulis "Kunci: C" di bawah pilihan, atau beri tanda * di depan pilihan benar (misal: *C. Nusantara).',
      { color: '475569', sizeHalfPt: 20, spaceAfter: 30 }
    ),
    buildParagraphXml(
      '- Untuk soal Esai/Uraian, beri label [ESAI] atau cukup tulis pertanyaan tanpa pilihan A-E.',
      { color: '475569', sizeHalfPt: 20, spaceAfter: 30 }
    ),
    buildParagraphXml('- Baris "Bobot: 10" bersifat opsional (bawaan PG = 10, Esai = 20 jika tidak ditulis).', {
      color: '475569',
      sizeHalfPt: 20,
      spaceAfter: 140,
    }),
    buildParagraphXml(START_MARKER, {
      bold: true,
      color: '0F766E',
      sizeHalfPt: 20,
      spaceAfter: 160,
    }),

    // Contoh Soal 1 (PG standar)
    buildParagraphXml('1. Ibu kota negara Republik Indonesia yang baru sesuai UU IKN adalah ...', {
      bold: true,
      color: '0F172A',
      sizeHalfPt: 22,
      spaceAfter: 60,
    }),
    buildParagraphXml('A. Jakarta', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('B. Bandung', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('C. Nusantara', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('D. Surabaya', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('E. Balikpapan', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('Kunci: C', { bold: true, color: '047857', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('Bobot: 10', { color: '475569', sizeHalfPt: 20, spaceAfter: 200 }),

    // Contoh Soal 2 (PG variasi)
    buildParagraphXml('2. Hasil dari 15 x 4 + 20 : 5 adalah ...', {
      bold: true,
      color: '0F172A',
      sizeHalfPt: 22,
      spaceAfter: 60,
    }),
    buildParagraphXml('A. 16', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('B. 64', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('C. 75', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('D. 80', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('E. 100', { color: '0F172A', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('Kunci: B', { bold: true, color: '047857', sizeHalfPt: 22, spaceAfter: 40 }),
    buildParagraphXml('Bobot: 10', { color: '475569', sizeHalfPt: 20, spaceAfter: 200 }),

    // Contoh Soal 3 (ESAI)
    buildParagraphXml(
      '3. [ESAI] Jelaskan secara singkat perbedaan antara topologi jaringan Star dan Mesh!',
      {
        bold: true,
        color: '0F172A',
        sizeHalfPt: 22,
        spaceAfter: 60,
      }
    ),
    buildParagraphXml('Bobot: 20', { color: '475569', sizeHalfPt: 20, spaceAfter: 120 }),
  ];

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', relsXml);
  zip.file('word/document.xml', documentXml);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function downloadWordQuestionTemplate(): Promise<void> {
  const bytes = await buildWordQuestionTemplateBytes();
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Template_Soal_Word_CandyCBT.docx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface NumberingLevelMeta {
  numFmt: string;
  start: number;
}

function parseNumberingDefinitions(numberingXml: string | null): Map<string, Map<string, NumberingLevelMeta>> {
  const numIdToLevels = new Map<string, Map<string, NumberingLevelMeta>>();
  if (!numberingXml) return numIdToLevels;

  const abstractLevels = new Map<string, Map<string, NumberingLevelMeta>>();
  const abstractRegex = /<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g;
  let absMatch: RegExpExecArray | null;
  while ((absMatch = abstractRegex.exec(numberingXml)) !== null) {
    const absId = absMatch[1];
    const absBody = absMatch[2];
    const levels = new Map<string, NumberingLevelMeta>();
    const lvlRegex = /<w:lvl\b[^>]*w:ilvl="([^"]+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
    let lvlMatch: RegExpExecArray | null;
    while ((lvlMatch = lvlRegex.exec(absBody)) !== null) {
      const ilvl = lvlMatch[1];
      const lvlBody = lvlMatch[2];
      const fmtMatch = lvlBody.match(/<w:numFmt\b[^>]*w:val="([^"]+)"/);
      const startMatch = lvlBody.match(/<w:start\b[^>]*w:val="(\d+)"/);
      levels.set(ilvl, {
        numFmt: fmtMatch ? fmtMatch[1] : 'decimal',
        start: startMatch ? Math.max(1, Number(startMatch[1])) : 1,
      });
    }
    abstractLevels.set(absId, levels);
  }

  const numRegex = /<w:num\b[^>]*w:numId="([^"]+)"[^>]*>([\s\S]*?)<\/w:num>/g;
  let numMatch: RegExpExecArray | null;
  while ((numMatch = numRegex.exec(numberingXml)) !== null) {
    const numId = numMatch[1];
    const numBody = numMatch[2];
    const absRef = numBody.match(/<w:abstractNumId\b[^>]*w:val="([^"]+)"/);
    if (absRef && abstractLevels.has(absRef[1])) {
      numIdToLevels.set(numId, abstractLevels.get(absRef[1])!);
    }
  }

  return numIdToLevels;
}

function formatAutoListPrefix(numFmt: string, indexZeroBased: number, start: number): string {
  const n = start + indexZeroBased;
  if (numFmt === 'upperLetter') {
    const code = 64 + ((n - 1) % 26) + 1;
    return `${String.fromCharCode(code)}. `;
  }
  if (numFmt === 'lowerLetter') {
    const code = 96 + ((n - 1) % 26) + 1;
    return `${String.fromCharCode(code)}. `;
  }
  if (numFmt === 'decimal' || numFmt === 'decimalZero') {
    return `${n}. `;
  }
  return '';
}

export function extractLinesFromDocxXml(documentXml: string, numberingXml: string | null = null): string[] {
  const numDefs = parseNumberingDefinitions(numberingXml);
  const counters = new Map<string, number>();
  const lines: string[] = [];

  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = paragraphRegex.exec(documentXml)) !== null) {
    const pInner = pMatch[1];

    // Check Microsoft Word automatic list numbering (<w:numPr>)
    let autoPrefix = '';
    const numPrMatch = pInner.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
    if (numPrMatch) {
      const numIdMatch = numPrMatch[1].match(/<w:numId\b[^>]*w:val="([^"]+)"/);
      const ilvlMatch = numPrMatch[1].match(/<w:ilvl\b[^>]*w:val="([^"]+)"/);
      const numId = numIdMatch?.[1];
      const ilvl = ilvlMatch?.[1] ?? '0';
      if (numId && numId !== '0') {
        const meta = numDefs.get(numId)?.get(ilvl);
        const key = `${numId}:${ilvl}`;
        const prevIdx = counters.get(key) ?? -1;
        const nextIdx = prevIdx + 1;
        counters.set(key, nextIdx);
        // Reset deeper list levels when level 0 advances (e.g. Q1 -> A-E -> Q2 -> A-E)
        if (ilvl === '0') {
          for (const existingKey of Array.from(counters.keys())) {
            if (existingKey !== key && existingKey.startsWith(`${numId}:`)) {
              counters.delete(existingKey);
            }
          }
        }
        autoPrefix = formatAutoListPrefix(meta?.numFmt ?? 'decimal', nextIdx, meta?.start ?? 1);
      }
    }

    // Collect text segments, preserving soft breaks (<w:br/>, <w:cr/>) and tabs
    const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:(br|cr|tab)\b[^>]*\/>/g;
    let buffer = '';
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = tokenRegex.exec(pInner)) !== null) {
      if (tokenMatch[1] !== undefined) {
        buffer += decodeXmlEntities(tokenMatch[1]);
      } else if (tokenMatch[2] === 'tab') {
        buffer += ' ';
      } else if (tokenMatch[2] === 'br' || tokenMatch[2] === 'cr') {
        buffer += '\n';
      }
    }

    const subLines = buffer.split('\n');
    subLines.forEach((sub, idx) => {
      const trimmed = sub.replace(/\u00a0/g, ' ').trim();
      if (idx === 0 && autoPrefix && trimmed) {
        // Only prepend auto-number if user text didn't already include one
        const hasManualNumOrOpt =
          /^(?:\d{1,4}\s*[.):]|[A-Ea-e]\s*[.):])/.test(trimmed);
        lines.push(hasManualNumOrOpt ? trimmed : `${autoPrefix}${trimmed}`);
      } else {
        lines.push(trimmed);
      }
    });
  }

  return lines;
}

function extractLinesFromHtmlDoc(html: string): string[] {
  const withBreaks = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(withBreaks)
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim());
}

interface DraftWordQuestion {
  questionNum: number;
  explicitType: QuestionType | null;
  stemLines: string[];
  options: Record<'A' | 'B' | 'C' | 'D' | 'E', string>;
  hasAnyOption: boolean;
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E' | '';
  weight: number | null;
}

function createEmptyDraft(questionNum: number): DraftWordQuestion {
  return {
    questionNum,
    explicitType: null,
    stemLines: [],
    options: { A: '', B: '', C: '', D: '', E: '' },
    hasAnyOption: false,
    correctAnswer: '',
    weight: null,
  };
}

function stripTypeTags(text: string): { cleaned: string; detectedType: QuestionType | null } {
  let detectedType: QuestionType | null = null;
  let cleaned = text;

  if (/\[\s*(?:ESAI|ESSAY|URAIAN)\s*\]|\(\s*(?:ESAI|ESSAY|URAIAN)\s*\)/i.test(cleaned)) {
    detectedType = 'ESAI';
    cleaned = cleaned.replace(/\[\s*(?:ESAI|ESSAY|URAIAN)\s*\]|\(\s*(?:ESAI|ESSAY|URAIAN)\s*\)/gi, '').trim();
  } else if (/\[\s*PG\s*\]|\(\s*PG\s*\)/i.test(cleaned)) {
    detectedType = 'PG';
    cleaned = cleaned.replace(/\[\s*PG\s*\]|\(\s*PG\s*\)/gi, '').trim();
  }

  return { cleaned, detectedType };
}

function finalizeDraft(draft: DraftWordQuestion, fallbackIndex: number): ParsedExcelQuestion {
  const text = draft.stemLines.join('\n').trim();
  const type: QuestionType =
    draft.explicitType === 'ESAI'
      ? 'ESAI'
      : draft.hasAnyOption
      ? 'PG'
      : draft.explicitType === 'PG'
      ? 'PG'
      : 'ESAI';

  const weight =
    draft.weight !== null && Number.isFinite(draft.weight) && draft.weight > 0
      ? draft.weight
      : type === 'ESAI'
      ? 20
      : 10;

  const correctAnswer = type === 'PG' ? draft.correctAnswer : '';

  const issues: string[] = [];
  if (!text) issues.push('Pertanyaan kosong');
  if (type === 'PG') {
    if (!draft.options.A || !draft.options.B) {
      issues.push('Minimal Pilihan A dan B harus terisi');
    }
    if (!correctAnswer) {
      issues.push('Kunci jawaban PG belum diisi (tulis Kunci: A–E atau tanda * pada opsi)');
    }
  }

  return {
    rowNumber: draft.questionNum > 0 ? draft.questionNum : fallbackIndex,
    type,
    text,
    optionA: draft.options.A,
    optionB: draft.options.B,
    optionC: draft.options.C,
    optionD: draft.options.D,
    optionE: draft.options.E,
    correctAnswer,
    weight,
    issues,
  };
}

export function parseEasyWordLines(rawLines: string[]): ParsedExcelQuestion[] {
  let workingLines = rawLines.map((l) => l.replace(/\u00a0/g, ' ').trim());

  // If the template divider marker is present, start right after it so instructions are safely ignored
  const markerIdx = workingLines.findIndex((line) =>
    line.toUpperCase().includes('MULAI TULIS SOAL')
  );
  if (markerIdx !== -1) {
    workingLines = workingLines.slice(markerIdx + 1);
  }

  const drafts: DraftWordQuestion[] = [];
  let current: DraftWordQuestion | null = null;
  let lastOptionKey: 'A' | 'B' | 'C' | 'D' | 'E' | null = null;
  let sawBlankLine = false;
  let subListNextNum: number | null = null;

  for (const line of workingLines) {
    if (!line) {
      sawBlankLine = true;
      continue;
    }

    // Ignore decorative divider lines like ===== or -----
    if (/^[=\-_]{4,}$/.test(line)) {
      sawBlankLine = true;
      continue;
    }

    // Skip template intro text if user deleted the divider but kept instruction lines before question 1
    if (
      !current &&
      /^(?:TEMPLATE SOAL CANDYCBT|PETUNJUK PENULISAN|-\s+)/i.test(line)
    ) {
      continue;
    }

    // Check key line: "Kunci: C" / "Kunci Jawaban: B" / "Jawaban: A" / "KJ: D"
    const keyMatch = line.match(
      /^(?:Kunci(?:\s+Jawaban)?|Jawaban(?:\s+Benar)?|KJ)\s*[:=]\s*([A-Ea-e]|-)\b.*$/i
    );
    if (keyMatch && current) {
      const val = keyMatch[1].toUpperCase();
      if (val === 'A' || val === 'B' || val === 'C' || val === 'D' || val === 'E') {
        current.correctAnswer = val;
      }
      lastOptionKey = null;
      subListNextNum = null;
      sawBlankLine = false;
      continue;
    }

    // Check weight line: "Bobot: 10" / "Skor: 20" / "Poin: 15"
    const weightMatch = line.match(/^(?:Bobot|Skor|Poin|Nilai)\s*[:=]\s*(\d+(?:[.,]\d+)?)\b.*$/i);
    if (weightMatch && current) {
      const parsedWeight = Number(weightMatch[1].replace(',', '.'));
      if (Number.isFinite(parsedWeight) && parsedWeight > 0) {
        current.weight = Math.round(parsedWeight);
      }
      lastOptionKey = null;
      subListNextNum = null;
      sawBlankLine = false;
      continue;
    }

    // Check explicit type line: "Jenis: ESAI" / "Tipe: PG"
    const typeLineMatch = line.match(
      /^(?:Jenis(?:\s+Soal)?|Tipe(?:\s+Soal)?)\s*[:=]\s*(PG|PILIHAN\s*GANDA|ESAI|ESSAY|URAIAN)\b.*$/i
    );
    if (typeLineMatch && current) {
      const rawT = typeLineMatch[1].toUpperCase();
      current.explicitType = rawT === 'PG' || rawT.includes('PILIHAN') ? 'PG' : 'ESAI';
      lastOptionKey = null;
      subListNextNum = null;
      sawBlankLine = false;
      continue;
    }

    // Check numbered question start: "1. ..." / "1) ..." / "Soal 1: ..." / "[ESAI] ..."
    const qStartMatch = line.match(/^(?:Soal\s+)?(\d{1,4})\s*[.):\-]\s*(.+)$/i);
    if (qStartMatch) {
      const num = Number(qStartMatch[1]);
      const restRaw = qStartMatch[2].trim();

      const canContinueSubList =
        current !== null &&
        !current.hasAnyOption &&
        !current.correctAnswer &&
        current.weight === null &&
        current.explicitType !== 'ESAI' &&
        !sawBlankLine &&
        current.stemLines.length > 0 &&
        ((num === 1 && /[:]$/.test(current.stemLines[current.stemLines.length - 1])) ||
          (subListNextNum !== null && num === subListNextNum));

      const isNewQuestion =
        current === null ||
        current.hasAnyOption ||
        current.correctAnswer !== '' ||
        current.weight !== null ||
        current.explicitType === 'ESAI' ||
        sawBlankLine ||
        !canContinueSubList;

      if (isNewQuestion) {
        if (current) drafts.push(current);
        current = createEmptyDraft(num);
        const { cleaned, detectedType } = stripTypeTags(restRaw);
        if (detectedType) current.explicitType = detectedType;
        if (cleaned) current.stemLines.push(cleaned);
        lastOptionKey = null;
        subListNextNum = null;
        sawBlankLine = false;
        continue;
      } else {
        subListNextNum = num + 1;
      }
    }

    // Allow starting a question purely with [ESAI] / [PG] without a number
    if (/^(?:\[\s*(?:ESAI|ESSAY|URAIAN|PG)\s*\])\s+.+/i.test(line)) {
      if (current) drafts.push(current);
      current = createEmptyDraft(drafts.length + 1);
      const { cleaned, detectedType } = stripTypeTags(line);
      if (detectedType) current.explicitType = detectedType;
      if (cleaned) current.stemLines.push(cleaned);
      lastOptionKey = null;
      subListNextNum = null;
      sawBlankLine = false;
      continue;
    }

    // Check option line: "A. teks", "a) teks", "*C. teks", "C. teks *"
    const optMatch = line.match(/^([*>+]?)\s*([A-Ea-e])\s*[.):]\s+(.+)$/);
    if (optMatch && current) {
      const hasLeadingStar = optMatch[1].length > 0;
      const letter = optMatch[2].toUpperCase() as 'A' | 'B' | 'C' | 'D' | 'E';
      let optText = optMatch[3].trim();

      let markedAsCorrect = hasLeadingStar;
      if (/\s*\*$/.test(optText)) {
        markedAsCorrect = true;
        optText = optText.replace(/\s*\*$/, '').trim();
      }
      if (/\(\s*(?:BENAR|KUNCI)\s*\)\s*$/i.test(optText)) {
        markedAsCorrect = true;
        optText = optText.replace(/\(\s*(?:BENAR|KUNCI)\s*\)\s*$/i, '').trim();
      }

      current.options[letter] = optText;
      current.hasAnyOption = true;
      if (markedAsCorrect) {
        current.correctAnswer = letter;
      }
      lastOptionKey = letter;
      subListNextNum = null;
      sawBlankLine = false;
      continue;
    }

    // Continuation lines: either part of the active option or multi-line question stem
    if (current) {
      if (lastOptionKey) {
        current.options[lastOptionKey] = `${current.options[lastOptionKey]} ${line}`.trim();
      } else {
        const { cleaned, detectedType } = stripTypeTags(line);
        if (detectedType) current.explicitType = detectedType;
        if (cleaned) current.stemLines.push(cleaned);
      }
    }
    sawBlankLine = false;
  }

  if (current) {
    drafts.push(current);
  }

  return drafts
    .map((draft, idx) => finalizeDraft(draft, idx + 1))
    .filter((item) => item.text || item.optionA || item.optionB);
}

export async function parseQuestionWord(file: File): Promise<ParsedExcelQuestion[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.txt')) {
    const txt = await file.text();
    const questions = parseEasyWordLines(txt.split(/\r?\n/));
    if (questions.length === 0) {
      throw new Error(
        'Tidak ada soal yang terbaca dari file teks. Pastikan format soal diawali nomor (misal: 1. ...).'
      );
    }
    return questions;
  }

  if (lowerName.endsWith('.doc') && !lowerName.endsWith('.docx')) {
    const txt = await file.text();
    if (/^\s*(?:<!DOCTYPE|<html|<w:wordDocument|MIME-Version:)/i.test(txt)) {
      const questions = parseEasyWordLines(extractLinesFromHtmlDoc(txt));
      if (questions.length > 0) return questions;
    }
    throw new Error(
      'Format .doc versi lama tidak didukung langsung. Silakan buka di Microsoft Word lalu pilih Save As -> Word Document (.docx).'
    );
  }

  let zip: JSZip;
  try {
    const buffer = await file.arrayBuffer();
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error(
      'File Word (.docx) tidak valid atau rusak. Gunakan file .docx dari Microsoft Word / Google Docs / Template CandyCBT.'
    );
  }

  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Dokumen .docx tidak memiliki konten teks yang valid (word/document.xml).');
  }

  const documentXml = await docFile.async('string');
  const numberingFile = zip.file('word/numbering.xml');
  const numberingXml = numberingFile ? await numberingFile.async('string') : null;

  const lines = extractLinesFromDocxXml(documentXml, numberingXml);
  const questions = parseEasyWordLines(lines);

  if (questions.length === 0) {
    throw new Error(
      'Tidak ada soal yang terbaca. Unduh Template Word terlebih dahulu lalu tulis soal mulai dari nomor 1.'
    );
  }

  return questions;
}
