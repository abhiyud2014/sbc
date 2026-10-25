import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const TONES = {
  success: { icon: CheckCircle2, ring: 'border-emerald-500/40', chip: 'bg-emerald-500/20 text-accent-emerald' },
  error: { icon: AlertTriangle, ring: 'border-red-500/40', chip: 'bg-red-500/20 text-accent-red' },
  info: { icon: Info, ring: 'border-blue-500/40', chip: 'bg-blue-500/20 text-accent-blue' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message, title = 'Zoom Pro Notification', tone = 'success') => {
      const id = ++counter.current;
      setToasts((list) => [...list, { id, message, title, tone }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-[60] flex w-[min(92vw,22rem)] flex-col gap-3">
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] || TONES.success;
          const Icon = tone.icon;
          return (
            <div
              key={toast.id}
              className={`fade-in flex items-start gap-3 rounded-xl border bg-card-bg px-4 py-3 shadow-2xl ${tone.ring}`}
              role="status"
            >
              <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone.chip}`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-white">{toast.title}</p>
                <p className="mt-0.5 break-words text-[11px] leading-relaxed text-slate-400">
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="text-slate-500 transition hover:text-white"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
