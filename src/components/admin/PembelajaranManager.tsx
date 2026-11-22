import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Link2,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { apiFetch, createCbtWebSocket } from '../../lib/api';
import type { MaterialsResponse } from '../../lib/api';
import type { LearningMaterial, LearningMaterialType, UserRole } from '../../types/cbt';

interface PembelajaranManagerProps {
  userRole: UserRole;
  defaultSubject?: string;
  teacherNameDefault?: string;
}

const MATERIAL_TYPE_META: Record<
  LearningMaterialType,
  {
    label: string;
    badgeClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  ARTIKEL: {
    label: 'Artikel / Ringkasan',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
    icon: FileText,
  },
  PDF_MODUL: {
    label: 'Modul & Dokumen',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    icon: BookOpen,
  },
  VIDEO: {
    label: 'Video Pembelajaran',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
    icon: Video,
  },
  TAUTAN: {
    label: 'Tautan Referensi',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    icon: Link2,
  },
  TUGAS: {
    label: 'Tugas Belajar',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: NotebookPen,
  },
};

export const PembelajaranManager: React.FC<PembelajaranManagerProps> = ({
  userRole,
  defaultSubject = '',
  teacherNameDefault = '',
}) => {
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | LearningMaterialType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LearningMaterial | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [gradeLevel, setGradeLevel] = useState('XII');
  const [targetClasses, setTargetClasses] = useState<string[]>([]);
  const [materialType, setMaterialType] = useState<LearningMaterialType>('ARTIKEL');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentDataUrl, setAttachmentDataUrl] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const [previewItem, setPreviewItem] = useState<LearningMaterial | null>(null);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MaterialsResponse>('/api/admin/materials');
      setMaterials(res.materials);
      setClasses(res.classes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat materi pembelajaran.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaterials();
    const ws = createCbtWebSocket((event) => {
      if (event === 'sync:materials' || event === 'sync:students' || event === 'sync:teachers') {
        loadMaterials();
      }
    });
    return () => ws.close();
  }, [loadMaterials]);

  const openCreateModal = () => {
    setEditing(null);
    setTitle('');
    setSubject(defaultSubject || '');
    setGradeLevel('XII');
    setTargetClasses([]);
    setMaterialType('ARTIKEL');
    setSummary('');
    setContent('');
    setResourceUrl('');
    setAttachmentName('');
    setAttachmentDataUrl('');
    setDueDate('');
    setIsPublished(true);
    setModalError('');
    setModalOpen(true);
  };

  const openEditModal = (item: LearningMaterial) => {
    setEditing(item);
    setTitle(item.title);
    setSubject(item.subject);
    setGradeLevel(item.gradeLevel || 'Semua');
    setTargetClasses(item.targetClasses || []);
    setMaterialType(item.materialType);
    setSummary(item.summary || '');
    setContent(item.content || '');
    setResourceUrl(item.resourceUrl || '');
    setAttachmentName(item.attachmentName || '');
    setAttachmentDataUrl(item.attachmentDataUrl || '');
    setDueDate(item.dueDate || '');
    setIsPublished(item.isPublished);
    setModalError('');
    setModalOpen(true);
  };

  const toggleClass = (cls: string) => {
    setTargetClasses((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]
    );
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setModalError('Ukuran lampiran maksimal 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setModalError('');
        setAttachmentName(file.name);
        setAttachmentDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        subject: subject.trim(),
        gradeLevel: gradeLevel.trim() || 'Semua',
        targetClasses,
        materialType,
        summary: summary.trim(),
        content: content.trim(),
        resourceUrl: resourceUrl.trim(),
        attachmentName: attachmentName.trim(),
        attachmentDataUrl,
        dueDate: materialType === 'TUGAS' ? dueDate.trim() : '',
        isPublished,
        teacherName: teacherNameDefault || undefined,
      };
      if (editing) {
        await apiFetch(`/api/admin/materials/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice(`Materi "${title.trim()}" berhasil diperbarui.`);
      } else {
        await apiFetch('/api/admin/materials', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(`Materi "${title.trim()}" berhasil ditambahkan.`);
      }
      setModalOpen(false);
      await loadMaterials();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Gagal menyimpan materi pembelajaran.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async (item: LearningMaterial) => {
    setError('');
    try {
      await apiFetch(`/api/admin/materials/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isPublished: !item.isPublished }),
      });
      setNotice(
        !item.isPublished
          ? `Materi "${item.title}" diterbitkan ke portal siswa.`
          : `Materi "${item.title}" dikembalikan ke Draf.`
      );
      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status publikasi.');
    }
  };

  const handleDelete = async (item: LearningMaterial) => {
    setError('');
    try {
      await apiFetch(`/api/admin/materials/${item.id}`, { method: 'DELETE' });
      setNotice(`Materi "${item.title}" berhasil dihapus.`);
      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus materi pembelajaran.');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (typeFilter !== 'ALL' && m.materialType !== typeFilter) return false;
      if (statusFilter === 'PUBLISHED' && !m.isPublished) return false;
      if (statusFilter === 'DRAFT' && m.isPublished) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.teacherName.toLowerCase().includes(q)
      );
    });
  }, [materials, search, typeFilter, statusFilter]);

  const publishedCount = materials.filter((m) => m.isPublished).length;
  const draftCount = materials.length - publishedCount;
  const taskOrVideoCount = materials.filter(
    (m) => m.materialType === 'TUGAS' || m.materialType === 'VIDEO'
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pembelajaran &amp; Modul Materi</h1>
          <p className="text-sm text-slate-500 mt-1">
            {userRole === 'guru'
              ? 'Buat, kelola, dan bagikan modul materi, tautan video, serta tugas belajar ke kelas siswa Anda.'
              : 'Pantau dan kelola seluruh modul materi pembelajaran dari semua guru mata pelajaran.'}
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Buat Materi Pembelajaran
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Materi</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {materials.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Diterbitkan ke Siswa</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {publishedCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Masih Draf</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
            {draftCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Video &amp; Tugas Belajar</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-700">
            {taskOrVideoCount}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari judul materi, mapel, atau guru..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'ALL' | LearningMaterialType)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="ALL">Semua Jenis</option>
              <option value="ARTIKEL">Artikel / Ringkasan</option>
              <option value="PDF_MODUL">Modul &amp; Dokumen</option>
              <option value="VIDEO">Video Pembelajaran</option>
              <option value="TAUTAN">Tautan Referensi</option>
              <option value="TUGAS">Tugas Belajar</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'PUBLISHED' | 'DRAFT')}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="ALL">Semua Status</option>
              <option value="PUBLISHED">Diterbitkan</option>
              <option value="DRAFT">Draf</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Memuat modul pembelajaran...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800">
              Belum ada materi pembelajaran yang sesuai.
            </p>
            <p className="text-xs text-slate-500">
              Klik &ldquo;Buat Materi Pembelajaran&rdquo; untuk menambahkan modul, video, tautan, atau tugas belajar.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filtered.map((item) => {
              const meta = MATERIAL_TYPE_META[item.materialType] || MATERIAL_TYPE_META.ARTIKEL;
              const TypeIcon = meta.icon;
              return (
                <div
                  key={item.id}
                  className="p-5 hover:bg-slate-50/70 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border font-semibold ${meta.badgeClass}`}
                      >
                        <TypeIcon className="w-3.5 h-3.5" />
                        {meta.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-semibold ${
                          item.isPublished
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        {item.isPublished ? 'Diterbitkan ke Siswa' : 'Draf'}
                      </span>
                      <span className="font-semibold text-teal-800">{item.subject}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">
                        {item.targetClasses.length > 0
                          ? `Kelas: ${item.targetClasses.join(', ')}`
                          : `Semua Kelas (${item.gradeLevel || 'Semua'})`}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                      {item.summary && (
                        <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{item.summary}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>Pengampu: {item.teacherName}</span>
                      {item.dueDate && (
                        <span className="inline-flex items-center gap-1 text-amber-800 font-semibold">
                          <Calendar className="w-3.5 h-3.5" />
                          Tenggat: {item.dueDate}
                        </span>
                      )}
                      {item.resourceUrl && (
                        <span className="inline-flex items-center gap-1 text-indigo-700 font-medium">
                          <ExternalLink className="w-3.5 h-3.5" />
                          Tautan eksternal
                        </span>
                      )}
                      {item.attachmentName && (
                        <span className="inline-flex items-center gap-1 text-sky-700 font-medium">
                          <Paperclip className="w-3.5 h-3.5" />
                          {item.attachmentName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Pratinjau
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTogglePublish(item)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                        item.isPublished
                          ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900'
                          : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      {item.isPublished ? 'Jadikan Draf' : 'Terbitkan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      title="Hapus Materi"
                      className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold">
                {editing ? 'Edit Materi Pembelajaran' : 'Buat Materi Pembelajaran Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Judul Materi / Modul / Tugas
                </label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Ringkasan Materi Integral & Latihan Soal"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mata Pelajaran
                  </label>
                  <input
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Matematika Wajib"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jenis Pembelajaran
                  </label>
                  <select
                    value={materialType}
                    onChange={(e) => setMaterialType(e.target.value as LearningMaterialType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="ARTIKEL">Artikel / Ringkasan</option>
                    <option value="PDF_MODUL">Modul &amp; Dokumen</option>
                    <option value="VIDEO">Video Pembelajaran</option>
                    <option value="TAUTAN">Tautan Referensi</option>
                    <option value="TUGAS">Tugas Belajar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tingkat Kelas
                  </label>
                  <select
                    value={gradeLevel}
                    onChange={(e) => setGradeLevel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="Semua">Semua Tingkat</option>
                    <option value="X">Kelas X</option>
                    <option value="XI">Kelas XI</option>
                    <option value="XII">Kelas XII</option>
                  </select>
                </div>
              </div>

              {materialType === 'TUGAS' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Batas Waktu / Tenggat Tugas (Opsional)
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full sm:w-56 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Kelas Sasaran (kosongkan agar tampil untuk semua kelas)
                  </label>
                  {targetClasses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTargetClasses([])}
                      className="text-xs font-semibold text-teal-700 hover:underline"
                    >
                      Pilih Semua Kelas
                    </button>
                  )}
                </div>
                {classes.length > 0 ? (
                  <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
                    {classes.map((cls) => {
                      const checked = targetClasses.includes(cls);
                      return (
                        <label
                          key={cls}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-semibold cursor-pointer ${
                            checked
                              ? 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleClass(cls)}
                            className="sr-only"
                          />
                          {cls}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Materi akan tersedia untuk seluruh kelas peserta.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ringkasan Singkat
                </label>
                <input
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Deskripsi singkat kompetensi atau pokok bahasan"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Isi Materi / Instruksi Pembelajaran
                </label>
                <textarea
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Tuliskan pokok materi, langkah belajar, atau petunjuk pengerjaan tugas..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tautan Video / Sumber Belajar (Opsional)
                  </label>
                  <input
                    type="url"
                    value={resourceUrl}
                    onChange={(e) => setResourceUrl(e.target.value)}
                    placeholder="https://youtube.com/... atau https://drive.google.com/..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lampiran Modul / File (Opsional, maks. 2 MB)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer truncate">
                      <Paperclip className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        {attachmentName || 'Pilih PDF / Dokumen / Gambar'}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.webp"
                        onChange={handleAttachmentChange}
                        className="hidden"
                      />
                    </label>
                    {attachmentName && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentName('');
                          setAttachmentDataUrl('');
                        }}
                        className="p-2 rounded-lg border border-slate-300 text-slate-500 hover:text-red-600"
                        title="Hapus Lampiran"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={(e) => setIsPublished(e.target.checked)}
                />
                Terbitkan materi agar langsung dapat diakses siswa di Portal Peserta
              </label>

              {modalError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-400 text-white text-sm font-semibold"
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan Materi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-xs text-teal-300 font-semibold">{previewItem.subject}</p>
                <h3 className="text-base font-bold truncate">{previewItem.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-semibold">
                  Pengampu: {previewItem.teacherName}
                </span>
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-semibold">
                  {previewItem.targetClasses.length > 0
                    ? `Kelas: ${previewItem.targetClasses.join(', ')}`
                    : `Semua Kelas (${previewItem.gradeLevel})`}
                </span>
                {previewItem.dueDate && (
                  <span className="px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                    Tenggat: {previewItem.dueDate}
                  </span>
                )}
              </div>

              {previewItem.summary && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                  {previewItem.summary}
                </div>
              )}

              {previewItem.content && (
                <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                  {previewItem.content}
                </div>
              )}

              {previewItem.resourceUrl && (
                <div className="pt-2">
                  <a
                    href={previewItem.resourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buka Tautan Materi / Video
                  </a>
                </div>
              )}

              {previewItem.attachmentDataUrl && previewItem.attachmentName && (
                <div className="pt-1">
                  <a
                    href={previewItem.attachmentDataUrl}
                    download={previewItem.attachmentName}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-800 text-xs font-semibold"
                  >
                    <Paperclip className="w-4 h-4" />
                    Unduh Lampiran: {previewItem.attachmentName}
                  </a>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
