import { MessageSquare, Megaphone, CheckCheck } from 'lucide-react';
import Modal from './Modal.jsx';
import { Spinner, ErrorNotice, Badge } from './ui.jsx';
import { formatDateTime } from '../lib/format.js';

/**
 * Student message centre.
 *
 * Opened automatically once per sign-in when unread announcements exist, and
 * again from the top-right message icon. Closing the panel marks everything
 * read (the unread badge clears), which is what "seen once when they log in"
 * means here — the read state is stored per student on the server.
 */
export default function Announcements({ open, onClose, data, loading, error, onRetry }) {
  const list = data?.announcements || [];
  const unread = data?.unread || 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={unread > 0 ? 'New message from your mentor' : 'Messages'}
      icon={MessageSquare}
      size="max-w-2xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-accent-emerald px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-600"
        >
          {unread > 0 ? 'Got it — mark as read' : 'Close'}
        </button>
      }
    >
      {loading && !list.length ? (
        <Spinner label="Loading your messages…" />
      ) : error ? (
        <ErrorNotice error={error} onRetry={onRetry} title="Could not load messages" />
      ) : list.length === 0 ? (
        <div className="py-6 text-center">
          <MessageSquare size={22} className="mx-auto mb-2 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">No announcements yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Messages your mentor broadcasts will appear here when you sign in.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border p-4 ${
                item.read
                  ? 'border-slate-800 bg-slate-900/40'
                  : 'border-accent-blue/30 bg-accent-blue/5'
              }`}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Megaphone size={13} className={item.read ? 'text-slate-500' : 'text-accent-blue'} />
                <h4 className="min-w-0 flex-1 truncate text-sm font-bold text-white">
                  {item.subject || 'Announcement'}
                </h4>
                {item.read ? (
                  <Badge className="border border-slate-700 bg-slate-800/60 text-slate-400">
                    <CheckCheck size={10} /> Read
                  </Badge>
                ) : (
                  <Badge className="border border-red-500/30 bg-red-500/10 text-red-300">New</Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{item.body}</p>
              <p className="mt-2 text-[10px] text-slate-500">{formatDateTime(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
