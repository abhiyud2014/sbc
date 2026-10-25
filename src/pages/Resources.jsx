import { useMemo, useState } from 'react';
import {
  BookMarked,
  Bookmark,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Trash2,
  RefreshCw,
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

/**
 * Reference Hub — materials are stored server-side (materials.json) so admin
 * edits survive a restart and everyone sees the same list. Each material has
 * a real URL, so "Open" actually opens the document.
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
    setModal(material);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'new') {
        await run(() => api.post('/materials', form));
        showToast(`“${form.title}” added to the hub.`, 'Material added');
      } else {
        await run(() => api.patch(`/materials/${modal.id}`, form));
        showToast(`“${form.title}” updated.`, 'Material saved');
      }
      setModal(null);
      materials.refresh();
    } catch (err) {
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

  const openMaterial = (r) => {
    if (!r.url) {
      showToast(
        canEdit ? 'This material has no link yet — add one with Edit.' : 'Ask your mentor to add a link for this material.',
        'No URL set',
        'info'
      );
      return;
    }
    window.open(r.url, '_blank', 'noopener,noreferrer');
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
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800 pt-4">
                <span className="truncate text-[11px] text-slate-500" title={r.url || 'No link set'}>
                  {r.url ? r.url.replace(/^https?:\/\//, '').slice(0, 32) : 'No link set'}
                </span>
                <button
                  onClick={() => openMaterial(r)}
                  disabled={!r.url}
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
              The “Open” button opens this URL in a new tab. Leave blank for a placeholder.
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
              {pending ? 'Saving…' : modal === 'new' ? 'Add material' : 'Save changes'}
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
