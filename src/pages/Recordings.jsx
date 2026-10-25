import { useState } from 'react';
import { CirclePlay, Download, ExternalLink, FileVideo, HardDrive, Play } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { Badge, EmptyState, ErrorNotice, Panel, Spinner } from '../components/ui.jsx';
import { formatBytes, formatDateTime, formatMeetingId } from '../lib/format.js';

const FILE_LABELS = {
  MP4: 'Video',
  M4A: 'Audio',
  TRANSCRIPT: 'Transcript',
  TXT: 'Chat / TXT',
  VTT: 'Captions',
  CHAT: 'Chat log',
  CSV: 'Q&A report',
  JSON: 'Timeline',
};

// Zoom's recording API defaults to the current day when no range is sent, so
// the page always asks for an explicit window (birth-to-now is not supported).
const WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export default function Recordings() {
  const [days, setDays] = useState(90);

  const recordings = useApi(() => {
    const to = Date.now();
    const from = to - days * 86_400_000;
    return api.get(`/recordings?from=${isoDay(from)}&to=${isoDay(to)}&page_size=300`);
  }, [days]);

  const meetings = recordings.data?.meetings || [];
  const totalBytes = meetings.reduce(
    (sum, m) => sum + (m.recording_files || []).reduce((s, f) => s + (Number(f.file_size) || 0), 0),
    0
  );
  const fileCount = meetings.reduce((sum, m) => sum + (m.recording_files || []).length, 0);

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-bold text-white">Zoom Cloud Recordings</h3>
          <p className="text-xs text-slate-400">
            <code className="text-slate-300">GET /users/me/recordings</code> — playback and download links
            are signed by Zoom and expire, so they are opened straight from here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1" role="group" aria-label="Recording window">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => setDays(w.days)}
                aria-pressed={days === w.days}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                  days === w.days ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-1.5">
            <FileVideo size={13} className="text-accent-cyan" /> {fileCount} files
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive size={13} className="text-accent-emerald" /> {formatBytes(totalBytes)}
          </span>
        </div>
      </Panel>

      {recordings.loading ? (
        <Spinner label="Loading cloud recordings…" />
      ) : recordings.error ? (
        <ErrorNotice error={recordings.error} onRetry={recordings.refresh} />
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={CirclePlay}
          title="No cloud recordings in this window"
          hint={`No recordings were found in the last ${days} days. Try a wider window, and check that cloud recording was enabled for the meeting.`}
        />
      ) : (
        <div className="space-y-5">
          {meetings.map((m) => (
            <Panel key={m.id || m.uuid} className="p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-bold text-white">{m.topic}</h4>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDateTime(m.start_time)} ·{' '}
                    <span className="font-mono">{formatMeetingId(m.id)}</span> ·{' '}
                    {m.recording_count || (m.recording_files || []).length} file(s) ·{' '}
                    {formatBytes(m.total_size)}
                  </p>
                </div>
                {m.share_url ? (
                  <a
                    href={m.share_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
                  >
                    <Play size={12} /> Share page <ExternalLink size={10} />
                  </a>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(m.recording_files || []).map((f) => {
                  const kind = (f.file_type || f.recording_type || '').toUpperCase();
                  const label =
                    FILE_LABELS[f.file_type] ||
                    (f.recording_type ? f.recording_type.replace(/_/g, ' ') : kind || 'File');
                  return (
                    <div
                      key={f.id || `${f.recording_start}-${f.file_type}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-200">{label}</p>
                        <p className="text-[10px] text-slate-500">
                          {f.file_type || '—'} · {formatBytes(f.file_size)} ·{' '}
                          {formatDateTime(f.recording_start)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {f.play_url ? (
                          <a
                            href={f.play_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Play"
                            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                          >
                            <Play size={12} />
                          </a>
                        ) : null}
                        {f.download_url ? (
                          <a
                            href={f.download_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Download"
                            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-accent-emerald"
                          >
                            <Download size={12} />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {m.password ? (
                <Badge className="mt-3 border border-slate-700 bg-slate-800 text-slate-300">
                  Recording passcode: {m.password}
                </Badge>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
