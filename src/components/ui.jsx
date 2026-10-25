import { AlertTriangle, Loader2, Inbox, RefreshCw } from 'lucide-react';

/** Loading spinner sized for cards / panels. */
export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-10 text-slate-400 ${className}`}>
      <Loader2 size={16} className="animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

/** Skeleton placeholder rows while Zoom data loads. */
export function Skeleton({ rows = 3 }) {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-800/70" />
      ))}
    </div>
  );
}

/** Error block — shows the real Zoom message plus a retry button. */
export function ErrorNotice({ error, onRetry, title = 'Zoom API error' }) {
  if (!error) return null;
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/15 text-accent-red">
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-red-300/90">{error}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            Errors here come straight from Zoom. Check the credential values in <code className="text-slate-400">.env</code> and your app's scopes.
          </p>
        </div>
        {onRetry ? (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            <RefreshCw size={12} /> Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Empty state for lists. */
export function EmptyState({ icon: Icon = Inbox, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-800/70 text-slate-400">
        <Icon size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {hint ? <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">{hint}</p> : null}
      {action}
    </div>
  );
}

/** Panel wrapper matching the dashboard card style. */
export function Panel({ className = '', children }) {
  return <div className={`rounded-2xl border border-slate-800 bg-card-bg shadow-xl ${className}`}>{children}</div>;
}

/** Stat card for the dashboard row. */
export function StatCard({ label, value, delta, deltaTone = 'text-accent-emerald', icon: Icon, hint, accent }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-card-bg p-5 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <div className={`grid h-10 w-10 place-items-center rounded-xl font-bold ${accent}`}>
          {Icon ? <Icon size={18} /> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-extrabold text-white">{value}</span>
        {delta ? <span className={`text-xs font-bold ${deltaTone}`}>{delta}</span> : null}
      </div>
      {hint ? <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{hint}</p> : null}
      <div
        className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r to-transparent"
        style={{ backgroundImage: accentGradient(accent) }}
      />
    </div>
  );
}

function accentGradient(accent = '') {
  const color = accent.includes('emerald')
    ? '#10b981'
    : accent.includes('blue')
      ? '#3b82f6'
      : accent.includes('cyan')
        ? '#06b6d4'
        : accent.includes('purple')
          ? '#a855f7'
          : '#64748b';
  return `linear-gradient(to right, ${color}, transparent)`;
}

/** Pill badge. */
export function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${className}`}>
      {children}
    </span>
  );
}

/** Copy-to-clipboard helper button. */
export function CopyButton({ value, label = 'Copy', className = '', onCopied }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopied?.();
        } catch {
          /* clipboard unavailable (non-secure context) */
        }
      }}
      className={className}
      title={`Copy ${label}`}
    >
      {label}
    </button>
  );
}
