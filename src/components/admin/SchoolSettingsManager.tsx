import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eraser,
  Image as ImageIcon,
  Images,
  Palette,
  PenTool,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import {
  applyCbtTheme,
  fileToResizedJpgDataUrl,
  fileToResizedPngDataUrl,
  THEME_PRESETS,
} from '../../lib/theme';
import type { CbtSidebarStyle, CbtThemeColor, SchoolSettings } from '../../types/cbt';

interface SchoolSettingsManagerProps {
  initialSettings: SchoolSettings;
  onSettingsUpdated: (settings: SchoolSettings) => void;
}

export const SchoolSettingsManager: React.FC<SchoolSettingsManagerProps> = ({
  initialSettings,
  onSettingsUpdated,
}) => {
  const [form, setForm] = useState<SchoolSettings>({
    city: 'Kota Nusantara',
    themeColor: 'teal',
    sidebarStyle: 'dark',
    schoolLogo: '',
    principalSignature: '',
    portalSlides: [],
    ...initialSettings,
  });

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Signature Canvas Pad State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [hasCanvasStrokes, setHasCanvasStrokes] = useState(false);

  useEffect(() => {
    setForm({
      city: 'Kota Nusantara',
      themeColor: 'teal',
      sidebarStyle: 'dark',
      schoolLogo: '',
      principalSignature: '',
      portalSlides: [],
      ...initialSettings,
    });
  }, [initialSettings]);

  const activeThemeColor: CbtThemeColor = form.themeColor || 'teal';
  const activeSidebarStyle: CbtSidebarStyle = form.sidebarStyle || 'dark';

  const handleSelectTheme = (themeId: CbtThemeColor) => {
    setForm((prev) => ({ ...prev, themeColor: themeId }));
    applyCbtTheme(themeId);
    onSettingsUpdated({ ...form, themeColor: themeId });
  };

  const handleSelectSidebarStyle = (style: CbtSidebarStyle) => {
    setForm((prev) => ({ ...prev, sidebarStyle: style }));
    onSettingsUpdated({ ...form, sidebarStyle: style });
  };

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToResizedPngDataUrl(file, 360, 360);
      setForm((prev) => ({ ...prev, schoolLogo: dataUrl }));
      setNotice('Logo sekolah dimuat. Klik "Simpan Semua Perubahan" untuk menerapkan ke server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat file logo sekolah.');
    }
  };

  const handleUploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToResizedPngDataUrl(file, 520, 220);
      setForm((prev) => ({ ...prev, principalSignature: dataUrl }));
      setNotice('Gambar tanda tangan kepala sekolah dimuat. Jangan lupa klik Simpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat gambar tanda tangan.');
    }
  };

  const handleUploadPortalSlides = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const currentSlides = form.portalSlides || [];
    const remainingSlots = 8 - currentSlides.length;
    if (remainingSlots <= 0) {
      setError('Maksimal 8 foto slide portal login. Hapus salah satu foto terlebih dahulu.');
      return;
    }

    setError('');
    try {
      const selected = files.slice(0, remainingSlots);
      const encoded = await Promise.all(
        selected.map((file) => fileToResizedJpgDataUrl(file, 1024, 768, 0.86))
      );
      setForm((prev) => ({
        ...prev,
        portalSlides: [...(prev.portalSlides || []), ...encoded],
      }));
      setNotice(
        `${encoded.length} foto slide berhasil ditambahkan. Klik "Simpan Semua Perubahan" untuk menerapkan ke halaman Login.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses foto slide.');
    }
  };

  const movePortalSlide = (index: number, delta: -1 | 1) => {
    const list = [...(form.portalSlides || [])];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setForm((prev) => ({ ...prev, portalSlides: list }));
  };

  const removePortalSlide = (index: number) => {
    setForm((prev) => ({
      ...prev,
      portalSlides: (prev.portalSlides || []).filter((_, i) => i !== index),
    }));
  };

  // Pointer-based signature canvas drawing
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    isDrawingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getCanvasPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasCanvasStrokes(true);
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
  };

  const clearSignatureCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasCanvasStrokes(false);
  };

  const applyCanvasToSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasCanvasStrokes) return;
    const dataUrl = canvas.toDataURL('image/png');
    setForm((prev) => ({ ...prev, principalSignature: dataUrl }));
    setNotice('Tanda tangan dari kanvas berhasil diterapkan. Klik "Simpan Semua Perubahan".');
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{ settings: SchoolSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setForm(res.settings);
      applyCbtTheme(res.settings.themeColor);
      onSettingsUpdated(res.settings);
      setNotice('Profil sekolah, tema tampilan, logo, dan TTD Kepala Sekolah berhasil disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan sekolah.');
    } finally {
      setSaving(false);
    }
  };

  const selectedThemeMeta =
    THEME_PRESETS.find((t) => t.id === activeThemeColor) || THEME_PRESETS[0];

  return (
    <form onSubmit={handleSaveAll} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Profil Sekolah, Tema, Logo & TTD Kepala Sekolah
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Atur identitas resmi sekolah, skema warna antarmuka CandyCBT, logo kop surat, serta tanda tangan digital Kepala Sekolah untuk laporan PDF.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-400 text-white text-sm font-semibold whitespace-nowrap"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Menyimpan...' : 'Simpan Semua Perubahan'}
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Profil Sekolah & Edit Tema */}
        <div className="xl:col-span-7 space-y-6">
          {/* Card 1: Profil Sekolah */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <Building2 className="w-4 h-4 text-teal-700" />
              <h2 className="text-base font-bold text-slate-900">Profil & Identitas Sekolah</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Sekolah / Lembaga
                </label>
                <input
                  required
                  value={form.schoolName}
                  onChange={(e) => setForm({ ...form, schoolName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NPSN</label>
                <input
                  required
                  value={form.npsn}
                  onChange={(e) => setForm({ ...form, npsn: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Alamat Lengkap Sekolah
                </label>
                <input
                  required
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kota / Kabupaten (Titimangsa Surat)
                </label>
                <input
                  value={form.city || ''}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="Contoh: Kota Bandung"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kode Server CBT
                </label>
                <input
                  required
                  value={form.serverName}
                  onChange={(e) => setForm({ ...form, serverName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tahun Pelajaran
                </label>
                <input
                  required
                  value={form.academicYear}
                  onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Semester</label>
                <select
                  value={form.semester}
                  onChange={(e) => setForm({ ...form, semester: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value="Ganjil">Ganjil</option>
                  <option value="Genap">Genap</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Kepala Sekolah
                </label>
                <input
                  required
                  value={form.principalName}
                  onChange={(e) => setForm({ ...form, principalName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  NIP Kepala Sekolah
                </label>
                <input
                  required
                  value={form.principalNip}
                  onChange={(e) => setForm({ ...form, principalNip: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Koordinator / Proktor Utama
                </label>
                <input
                  required
                  value={form.proctorName}
                  onChange={(e) => setForm({ ...form, proctorName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>
          </section>

          {/* Card 2: Edit Tema */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-bold text-slate-900">Edit Tema & Tampilan CandyCBT</h2>
              </div>
              <span className="text-xs font-semibold text-teal-700">{selectedThemeMeta.name}</span>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2.5">
                Palet Warna Utama (Diterapkan ke Portal Login, Admin, Ujian Siswa & Garis Kop PDF)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {THEME_PRESETS.map((preset) => {
                  const isSelected = activeThemeColor === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectTheme(preset.id)}
                      className={`p-3 rounded-xl border text-left transition-all flex items-start gap-3 ${
                        isSelected
                          ? 'border-teal-700 bg-teal-50/70 ring-1 ring-teal-700'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span
                        className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-white mt-0.5"
                        style={{ backgroundColor: preset.swatchHex }}
                      >
                        {isSelected && <Check className="w-4 h-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{preset.name}</p>
                        <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                          {preset.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-700 mb-2">Gaya Sidebar Admin</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectSidebarStyle('dark')}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    activeSidebarStyle === 'dark'
                      ? 'border-teal-700 bg-teal-50/60 ring-1 ring-teal-700'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-slate-900 border border-slate-700" />
                    <span className="text-xs font-bold text-slate-900">Gelap Profesional</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Sidebar gelap kontras tinggi standar CandyCBT
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSidebarStyle('light')}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    activeSidebarStyle === 'light'
                      ? 'border-teal-700 bg-teal-50/60 ring-1 ring-teal-700'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-white border border-slate-300" />
                    <span className="text-xs font-bold text-slate-900">Terang Minimalis</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Sidebar putih bersih dengan aksen warna tema
                  </p>
                </button>
              </div>
            </div>
          </section>

          {/* Card: Foto Slide Portal Login */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Images className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-bold text-slate-900">
                  Foto Slide Halaman Login ({(form.portalSlides || []).length}/8)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {(form.portalSlides || []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, portalSlides: [] }))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Foto Bawaan
                  </button>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Upload Foto Slide
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUploadPortalSlides}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Foto di bawah kalimat running text Portal Login berganti otomatis secara perlahan (efek slide). Unggah hingga 8 foto sekolah/kegiatan Anda, atau kosongkan untuk memakai 3 foto bawaan CandyCBT.
            </p>

            {(form.portalSlides || []).length === 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    src: '/src/assets/images/cbt_portal_illustration_1795244047124.jpg',
                    label: 'Slide Bawaan 1',
                  },
                  {
                    src: '/src/assets/images/cbt_students_exam_1795260112350.jpg',
                    label: 'Slide Bawaan 2',
                  },
                  {
                    src: '/src/assets/images/cbt_proctor_monitoring_1795260112472.jpg',
                    label: 'Slide Bawaan 3',
                  },
                ].map((item) => (
                  <div
                    key={item.src}
                    className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50"
                  >
                    <img
                      src={item.src}
                      alt={item.label}
                      className="w-full aspect-[4/3] object-cover"
                    />
                    <p className="text-[11px] font-medium text-slate-600 px-2 py-1 text-center truncate">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(form.portalSlides || []).map((src, idx) => (
                  <div
                    key={`${idx}-${src.slice(0, 32)}`}
                    className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex flex-col"
                  >
                    <img
                      src={src}
                      alt={`Slide Sekolah ${idx + 1}`}
                      className="w-full aspect-[4/3] object-cover"
                    />
                    <div className="p-1.5 flex items-center justify-between gap-1 bg-white border-t border-slate-200">
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => movePortalSlide(idx, -1)}
                          title="Geser ke kiri"
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 text-slate-600"
                        >
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === (form.portalSlides || []).length - 1}
                          onClick={() => movePortalSlide(idx, 1)}
                          title="Geser ke kanan"
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 text-slate-600"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePortalSlide(idx)}
                        title="Hapus foto slide"
                        className="p-1 rounded hover:bg-red-50 text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Logo Sekolah, TTD Kepala Sekolah & Pratinjau PDF */}
        <div className="xl:col-span-5 space-y-6">
          {/* Card 3: Logo Sekolah */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-bold text-slate-900">Logo Sekolah</h2>
              </div>
              {form.schoolLogo && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, schoolLogo: '' }))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus Logo
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center p-2 shrink-0 overflow-hidden">
                {form.schoolLogo ? (
                  <img
                    src={form.schoolLogo}
                    alt="Logo Sekolah"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-lg bg-teal-700 text-white font-bold flex items-center justify-center mx-auto">
                      C
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">Default</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 flex-1 min-w-0">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Ditampilkan pada halaman Login, header Dashboard, Kartu QR, dan Kop Laporan PDF. Gunakan PNG/JPG/WebP (rekomendasi latar transparan).
                </p>
                <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-teal-700 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Unggah Logo Sekolah
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUploadLogo}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Card 4: TTD Kepala Sekolah */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-teal-700" />
                <h2 className="text-base font-bold text-slate-900">TTD Kepala Sekolah</h2>
              </div>
              {form.principalSignature && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, principalSignature: '' }))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus TTD
                </button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">TTD Aktif Saat Ini:</p>
              <div className="h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center p-2">
                {form.principalSignature ? (
                  <img
                    src={form.principalSignature}
                    alt="Tanda Tangan Kepala Sekolah"
                    className="max-h-20 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-slate-400">
                    Belum ada TTD digital (area tanda tangan PDF dikosongkan untuk tanda tangan basah)
                  </span>
                )}
              </div>
            </div>

            {/* Interactive Signature Canvas */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">
                  Gambar Tanda Tangan Langsung:
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearSignatureCanvas}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700"
                  >
                    <Eraser className="w-3 h-3" />
                    Bersihkan
                  </button>
                  <button
                    type="button"
                    disabled={!hasCanvasStrokes}
                    onClick={applyCanvasToSignature}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-[11px] font-semibold"
                  >
                    <Check className="w-3 h-3" />
                    Pakai Goresan
                  </button>
                </div>
              </div>

              <canvas
                ref={canvasRef}
                width={420}
                height={140}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="w-full h-32 rounded-lg border border-dashed border-slate-300 bg-white cursor-crosshair touch-none"
              />

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-500">
                  Atau unggah gambar scan TTD PNG/JPG:
                </span>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Unggah Gambar TTD
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUploadSignature}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Card 5: Live Kop & TTD PDF Preview */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-slate-500">
              Pratinjau Kop Surat & TTD pada Laporan PDF
            </p>
            <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-4">
              <div
                className="flex items-center gap-3 pb-2.5 border-b-2"
                style={{ borderColor: selectedThemeMeta.swatchHex }}
              >
                {form.schoolLogo && (
                  <img
                    src={form.schoolLogo}
                    alt="Logo Kop"
                    className="w-10 h-10 object-contain shrink-0"
                  />
                )}
                <div className="flex-1 text-center min-w-0">
                  <p className="text-xs font-bold text-slate-900 uppercase truncate">
                    {form.schoolName || 'NAMA SEKOLAH'}
                  </p>
                  <p className="text-[10px] text-slate-600 truncate">
                    {form.address} · NPSN: {form.npsn} · TA {form.academicYear} ({form.semester})
                  </p>
                </div>
              </div>

              <div className="flex justify-between items-end text-[10px] text-slate-800 pt-1">
                <div>
                  <p>Mengetahui,</p>
                  <p>Kepala Sekolah</p>
                  <div className="h-10 flex items-center my-0.5">
                    {form.principalSignature && (
                      <img
                        src={form.principalSignature}
                        alt="Preview TTD"
                        className="max-h-9 object-contain"
                      />
                    )}
                  </div>
                  <p className="font-bold">{form.principalName}</p>
                  <p>NIP. {form.principalNip}</p>
                </div>

                <div className="text-left">
                  <p>{form.city || 'Nusantara'}, Hari Ini</p>
                  <p>Proktor / Koordinator CBT</p>
                  <div className="h-10" />
                  <p className="font-bold">{form.proctorName}</p>
                  <p>Server: {form.serverName}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
};
