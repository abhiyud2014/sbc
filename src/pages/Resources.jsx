import { useMemo, useState } from 'react';
import {
  BookMarked,
  Bookmark,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { usePending } from '../hooks/useApi.js';
import { levelTone } from '../lib/format.js';

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const TYPES = ['Reference Guide', 'Concept Guide', 'API Reference', 'Worksheet', 'Practice Tool', 'Video Recording'];

const EMPTY_FORM = { title: '', url: '', category: 'Beginner', type: 'Reference Guide', description: '' };
const PDF_MAX_BYTES = 8 * 1024 * 1024;
const formatBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`));
    reader.readAsDataURL(file);
  });

/**
 * Reference Hub — materials are stored in the LMS database so admin edits
 * survive a restart and everyone sees the same list. Each material can carry
 * an external link and one or more uploaded PDFs.
 *
 * Participants (`canEdit=false`) get a read-only hub: browse and open only —
 * add/edit/delete stay admin-only.
 */
export default function Resources({ canEdit = true }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('All');
  const [modal, setModal] = useState(null); // null | 'new' | material object being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState([]); // PDFs already saved on the material
  const [newFiles, setNewFiles] = useState([]); // File objects waiting for save
  const [uploadStep, setUploadStep] = useState('');
  // In-app announcement sent with the save (default on for a new material,
  // auto-enabled when new PDFs are picked, opt-out via the checkbox).
  const [notifyStudents, setNotifyStudents] = useState(true);
  const [notifyTouched, setNotifyTouched] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [pending, run] = usePending();

  const materials = useApi(() => api.get('/materials'));
  const items = materials.data?.materials || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      const matchesQuery = !q || `${r.title} ${r.type} ${r.description}`.toLowerCase().includes(q);
      const matchesLevel = level === 'All' || r.category === level;
      return matchesQuery && matchesLevel;
    });
  }, [items, query, level]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setFiles([]);
    setNewFiles([]);
    setUploadStep('');
    setNotifyStudents(true); // new material → tell students by default
    setNotifyTouched(false);
    setModal('new');
  };

  const openEdit = (material) => {
    setForm({
      title: material.title || '',
      url: material.url || '',
      category: material.category || 'Beginner',
      type: material.type || 'Reference Guide',
      description: material.description || '',
    });
    setFiles(material.files || []);
    setNewFiles([]);
    setUploadStep('');
    setNotifyStudents(false); // routine edits stay quiet unless asked
    setNotifyTouched(false);
    setModal(material);
  };

  const pickFiles = (event) => {
    const picked = [...(event.target.files || [])];
    event.target.value = ''; // allow re-picking the same file after removing it
    const accepted = [];
    for (const file of picked) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) {
        showToast(`“${file.name}” is not a PDF. Only PDF documents can be uploaded.`, 'Not a PDF', 'error');
        continue;
      }
      if (file.size > PDF_MAX_BYTES) {
        showToast(`“${file.name}” is ${formatBytes(file.size)} — the limit is 8 MB per PDF.`, 'File too large', 'error');
        continue;
      }
      if (newFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
      accepted.push(file);
    }
    if (accepted.length) {
      setNewFiles((current) => [...current, ...accepted]);
      // Picking PDFs for an existing material implies "tell students" unless
      // the mentor explicitly turned the checkbox off.
      if (!notifyTouched) setNotifyStudents(true);
    }
  };

  const removeSavedFile = async (material, file) => {
    try {
      const updated = await run(() => api.del(`/materials/${material.id}/files/${file.id}`));
      setFiles(updated.files || []);
      materials.refresh();
      showToast(`“${file.name}” removed from this material.`, 'PDF removed');
    } catch (err) {
      showToast(err.message, 'Could not remove the PDF', 'error');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const isNew = modal === 'new';
    const addedFiles = [...newFiles];
    try {
      let saved;
      if (isNew) {
        saved = await run(() => api.post('/materials', form));
        // If a PDF upload fails below, retrying now PATCHes this material
        // instead of creating a duplicate.
        setModal(saved);
        showToast(`“${form.title}” added to the hub.`, 'Material added');
      } else {
        saved = await run(() => api.patch(`/materials/${modal.id}`, form));
        showToast(`“${form.title}” updated.`, 'Material saved');
      }

      // Upload sequentially: one PDF per request keeps each body small and
      // gives a clear progress label. Successfully uploaded files leave the
      // pending list, so a retry after a failure never duplicates them.
      const remaining = [...addedFiles];
      const total = remaining.length;
      while (remaining.length) {
        const file = remaining[0];
        setUploadStep(`Uploading PDF ${total - remaining.length + 1} of ${total}…`);
        const data = await readFileAsDataUrl(file);
        await api.post(`/materials/${saved.id}/files`, {
          files: [{ name: file.name, type: 'application/pdf', data }],
        });
        remaining.shift();
        setNewFiles([...remaining]);
      }
      setUploadStep('');

      // Notify every student in-app. A notification failure must not undo or
      // hide the fact that the material itself was saved.
      if (notifyStudents) {
        const fileLine = addedFiles.length
          ? `\n\nPDF${addedFiles.length === 1 ? '' : 's'}: ${addedFiles.map((f) => f.name).join(', ')}`
          : '';
        try {
          await api.post('/announcements', {
            subject: `${isNew ? 'New material' : 'Material updated'}: ${form.title}`,
            body: [
              isNew
                ? `A new material has been added to the Reference Hub: “${form.title}”.`
                : `A Reference Hub material has been updated: “${form.title}”.`,
              form.description ? `\n${form.description}` : '',
              fileLine,
              '\nOpen Reference Hub & Materials to view it.',
            ]
              .join('')
              .trim(),
          });
          showToast('Students will see it once at their next sign-in.', 'Students notified');
        } catch (err) {
          showToast(
            `The material was saved, but the student notification failed: ${err.message}`,
            'Notification failed',
            'error'
          );
        }
      }

      setModal(null);
      setNewFiles([]);
      materials.refresh();
    } catch (err) {
      setUploadStep('');
      showToast(err.message, 'Could not save', 'error');
    }
  };

  const remove = async () => {
    try {
      await run(() => api.del(`/materials/${deleting.id}`));
      showToast(`“${deleting.title}” removed.`, 'Material deleted');
      setDeleting(null);
      materials.refresh();
    } catch (err) {
      showToast(err.message, 'Could not delete', 'error');
    }
  };

  // Open a stored PDF through the authenticated API. The file route needs the
  // bearer token, so a plain <a href> would 401 — fetch a blob and open it.
  const openPdf = async (materialId, file) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const blob = await api.file(`/materials/${materialId}/files/${file.id}`);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
      // Keep the object URL alive long enough for the viewer to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      showToast(err.message, 'Could not open the PDF', 'error');
    }
  };

  const openMaterial = (r) => {
    if (r.url) {
      window.open(r.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (r.files?.[0]) {
      openPdf(r.id, r.files[0]);
      return;
    }
    showToast(
      canEdit ? 'This material has no PDF or link yet — add one with Edit.' : 'Ask your mentor to add a PDF or link for this material.',
      'Nothing to open',
      'info'
    );
  };

  const input =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-accent-emerald focus:outline-none';
  const label = 'mb-1 block text-xs font-medium text-slate-300';

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Reference Materials &amp; Resource Hub</h3>
          <p className="text-xs text-slate-400">
            Stored on the API server, so edits persist and everyone sees the same list.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
            {['All', ...LEVELS].map((lv) => (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  level === lv ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guides, indicators…"
              className="w-56 rounded-xl border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white focus:border-accent-emerald focus:outline-none"
            />
          </div>
          <button
            onClick={materials.refresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <RefreshCw size={12} className={materials.loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {canEdit ? (
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 rounded-xl bg-accent-emerald px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
            >
              <Plus size={12} /> Add material
            </button>
          ) : null}
        </div>
      </Panel>

      {materials.loading ? (
        <Spinner label="Loading materials…" />
      ) : materials.error ? (
        <ErrorNotice error={materials.error} onRetry={materials.refresh} title="Could not load materials" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title={items.length === 0 ? 'No materials yet' : 'No resources match'}
          hint={
            items.length === 0
              ? 'Add your first reference — a PDF, a doc, or any link your students can open.'
              : 'Try a different search term or level filter.'
          }
          action={
            items.length === 0 && canEdit ? (
              <button
                onClick={openNew}
                className="mt-4 rounded-xl bg-accent-emerald px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
              >
                <Plus size={12} className="mr-1 inline" /> Add material
              </button>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-card-bg p-6 shadow-xl transition hover:border-slate-700"
            >
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Badge className={levelTone[r.category] || levelTone.Beginner}>{r.category}</Badge>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        title="Edit material"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => setDeleting(r)}
                        title="Delete material"
                        className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-red-500/15 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : null}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-blue">
                  {r.type}
                </span>
                <h4 className="mb-2 text-base font-bold text-white">{r.title}</h4>
                {r.description ? (
                  <p className="text-xs leading-relaxed text-slate-400">{r.description}</p>
                ) : null}

                {(r.files || []).length ? (
                  <ul className="mt-3 space-y-1.5">
                    {(r.files || []).map((file) => (
                      <li key={file.id}>
                        <button
                          type="button"
                          onClick={() => openPdf(r.id, file)}
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-left text-[11px] text-slate-300 transition hover:border-slate-700 hover:text-white"
                          title={`Open ${file.name}`}
                        >
                          <FileText size={12} className="shrink-0 text-red-400" />
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <span className="shrink-0 text-[10px] text-slate-500">{formatBytes(file.size)}</span>
                          <ExternalLink size={10} className="shrink-0 text-slate-500" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800 pt-4">
                <span className="truncate text-[11px] text-slate-500" title={r.url || 'No link set'}>
                  {(r.files || []).length
                    ? `${r.files.length} PDF${r.files.length === 1 ? '' : 's'}${r.url ? ' · link' : ''}`
                    : r.url
                      ? r.url.replace(/^https?:\/\//, '').slice(0, 32)
                      : 'No link set'}
                </span>
                <button
                  onClick={() => openMaterial(r)}
                  disabled={!r.url && !(r.files || []).length}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
                >
                  <ExternalLink size={12} /> Open
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit ------------------------------------------------------ */}
      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add material' : 'Edit material'}
        icon={modal === 'new' ? Plus : Pencil}
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className={label} htmlFor="mat-title">Title *</label>
            <input
              id="mat-title"
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Advanced Order Flow Cheat Sheet"
              className={input}
            />
          </div>

          <div>
            <label className={label} htmlFor="mat-url">Link (http/https)</label>
            <input
              id="mat-url"
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
              className={input}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Optional. Upload PDFs below and/or point to an external page — the “Open” button prefers the link,
              then the first PDF.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="mat-files">PDF documents</label>
            <label
              htmlFor="mat-files"
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-600 bg-slate-900/60 px-4 py-4 text-center transition hover:border-accent-emerald/60 hover:bg-slate-900"
            >
              <Upload size={16} className="text-accent-emerald" />
              <span className="text-xs font-semibold text-slate-200">
                Choose one or more PDFs
              </span>
              <span className="text-[10px] text-slate-500">Up to 8 MB each · .pdf only</span>
            </label>
            <input
              id="mat-files"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={pickFiles}
              className="sr-only"
            />

            {files.length ? (
              <ul className="mt-2 space-y-1.5">
                {files.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-[11px] text-slate-300"
                  >
                    <FileText size={12} className="shrink-0 text-red-400" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => openPdf(modal.id, file)}
                      className="shrink-0 text-slate-400 transition hover:text-white"
                      title="Open PDF"
                    >
                      <ExternalLink size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSavedFile(modal, file)}
                      disabled={pending}
                      className="shrink-0 text-slate-500 transition hover:text-red-400 disabled:opacity-40"
                      title="Remove PDF"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {newFiles.length ? (
              <ul className="mt-2 space-y-1.5">
                {newFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center gap-2 rounded-lg border border-accent-emerald/20 bg-accent-emerald/5 px-2.5 py-1.5 text-[11px] text-slate-200"
                  >
                    <FileText size={12} className="shrink-0 text-accent-emerald" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{formatBytes(file.size)}</span>
                    <span className="shrink-0 rounded bg-accent-emerald/15 px-1 py-px text-[9px] font-bold text-accent-emerald">
                      NEW
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewFiles((current) => current.filter((_, i) => i !== index))}
                      disabled={pending}
                      className="shrink-0 text-slate-500 transition hover:text-red-400 disabled:opacity-40"
                      title="Remove from this upload"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-1.5 text-[11px] text-slate-500">
              {files.length || newFiles.length
                ? `${files.length + newFiles.length} PDF${files.length + newFiles.length === 1 ? '' : 's'} attached — students can open them from the Reference Hub.`
                : 'Students see each PDF as an openable card link.'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="mat-level">Level</label>
              <select
                id="mat-level"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={input}
              >
                {LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="mat-type">Type</label>
              <select
                id="mat-type"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className={input}
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="mat-desc">Description</label>
            <textarea
              id="mat-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="One line on what students will get from this."
              className={input}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-3">
            <input
              id="mat-notify"
              type="checkbox"
              checked={notifyStudents}
              onChange={(e) => {
                setNotifyStudents(e.target.checked);
                setNotifyTouched(true);
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-200">
                Notify students in-app
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                Publishes a one-time message to every student. It appears in their message centre at
                the next sign-in and clears when they dismiss it. On by default for new materials and
                newly picked PDFs — untick to save quietly.
              </span>
            </span>
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-accent-emerald px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {pending
                ? uploadStep || 'Saving…'
                : modal === 'new'
                  ? newFiles.length
                    ? `Add material + ${newFiles.length} PDF${newFiles.length === 1 ? '' : 's'}`
                    : 'Add material'
                  : newFiles.length
                    ? `Save + upload ${newFiles.length} PDF${newFiles.length === 1 ? '' : 's'}`
                    : 'Save changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm -------------------------------------------------- */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete material"
        icon={Trash2}
      >
        <p className="text-sm leading-relaxed text-slate-300">
          Remove <span className="font-bold text-white">“{deleting?.title}”</span> from the hub? This
          deletes it from the server for everyone.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={() => setDeleting(null)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            Keep it
          </button>
          <button
            onClick={remove}
            disabled={pending}
            className="rounded-lg bg-red-500/90 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
