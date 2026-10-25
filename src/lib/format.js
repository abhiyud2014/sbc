/** Small formatting helpers shared across pages. */

export function formatDateTime(iso, opts) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, opts || { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { timeStyle: 'short' });
}

export function formatDuration(minutes) {
  const total = Number(minutes);
  if (!total) return '—';
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Zoom reports past-meeting participant `duration` in SECONDS (verified:
 * join 14:23:17 -> leave 14:26:21 returns 184). The meeting report's
 * `duration` is in minutes. This keeps the two straight.
 */
export function formatSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h ${s ? `${s}s` : ''}`.trim();
  return `${m}m ${s ? `${s}s` : ''}`.trim();
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function displayName(user = {}) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.name || user.email || 'Unknown';
}

/** Zoom meeting IDs are numeric strings — render them as 123-456-7890. */
export function formatMeetingId(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length !== 9 && digits.length !== 10 && digits.length !== 11) return String(id ?? '');
  return digits.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_m, a, b, c) => [a, b, c].filter(Boolean).join('-'));
}

/** Turn a datetime-local input value ("2026-10-14T17:30") into Zoom's ISO form. */
export function toZoomStartTime(localValue) {
  if (!localValue) return undefined;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** Zoom returns "2026-10-14T17:30:00Z" — datetime-local wants no Z/suffix. */
export function toDateTimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export const levelTone = {
  Beginner: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  Intermediate: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  Advanced: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
};

export const toneFor = (index = 0) =>
  ['bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
   'bg-blue-500/10 text-blue-400 border border-blue-500/20',
   'bg-purple-500/10 text-purple-400 border border-purple-500/20'][index % 3];
