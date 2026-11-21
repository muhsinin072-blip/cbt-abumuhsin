import type { CbtThemeColor } from '../types/cbt';

export interface ThemePresetMeta {
  id: CbtThemeColor;
  name: string;
  description: string;
  swatchHex: string;
  accentHex: string;
  pdfRgb: [number, number, number];
}

export const THEME_PRESETS: ThemePresetMeta[] = [
  {
    id: 'teal',
    name: 'Zamrud Candy',
    description: 'Warna standar CandyCBT yang tenang & lembut di mata',
    swatchHex: '#1b685c',
    accentHex: '#349b89',
    pdfRgb: [27, 104, 92],
  },
  {
    id: 'indigo',
    name: 'Biru Akademik',
    description: 'Nuansa kampus & institusi modern yang elegan',
    swatchHex: '#4948be',
    accentHex: '#6c73ea',
    pdfRgb: [73, 72, 190],
  },
  {
    id: 'emerald',
    name: 'Hijau Madrasah',
    description: 'Hijau sage lembut khas sekolah menengah & madrasah',
    swatchHex: '#196b4a',
    accentHex: '#2ea272',
    pdfRgb: [25, 107, 74],
  },
  {
    id: 'rose',
    name: 'Merah Marun SMK',
    description: 'Sentuhan rose marun lembut yang berwibawa',
    swatchHex: '#9f2d49',
    accentHex: '#d35471',
    pdfRgb: [159, 45, 73],
  },
  {
    id: 'amber',
    name: 'Klasik Emas',
    description: 'Hangat, lembut & elegan untuk identitas unggulan',
    swatchHex: '#96561e',
    accentHex: '#cf8a2c',
    pdfRgb: [150, 86, 30],
  },
  {
    id: 'sky',
    name: 'Biru Langit',
    description: 'Sejuk, ringan, dan nyaman untuk sesi ujian panjang',
    swatchHex: '#1e5798',
    accentHex: '#3687d4',
    pdfRgb: [30, 87, 152],
  },
];

export function applyCbtTheme(themeColor?: CbtThemeColor): void {
  const valid = THEME_PRESETS.some((t) => t.id === themeColor) ? themeColor! : 'teal';
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-cbt-theme', valid);
  }
}

export function getThemePdfRgb(themeColor?: CbtThemeColor): [number, number, number] {
  return THEME_PRESETS.find((t) => t.id === themeColor)?.pdfRgb || [15, 118, 110];
}

export async function fileToResizedPngDataUrl(
  file: File,
  maxWidth = 480,
  maxHeight = 480
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar (PNG, JPG, atau WebP).');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      img.src = objectUrl;
    });

    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Konteks gambar tidak tersedia.');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fileToResizedJpgDataUrl(
  file: File,
  maxWidth = 1024,
  maxHeight = 768,
  quality = 0.86
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar (PNG, JPG, atau WebP).');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      img.src = objectUrl;
    });

    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Konteks gambar tidak tersedia.');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

