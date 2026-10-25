import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Accessible modal: click the backdrop or press Esc to close.
 * Rendered through a portal onto <body> so ancestor transforms (e.g. the
 * page fade-in animation on <main>) can never trap it inside a scroll
 * container — it always sits on top of the viewport.
 */
export default function Modal({ open, onClose, title, icon: Icon, children, footer, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`fade-in relative max-h-[90vh] w-full ${size} overflow-y-auto rounded-2xl border border-slate-700 bg-card-bg p-6 shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-white">
            {Icon ? <Icon size={16} className="text-accent-blue" /> : null}
            <span>{title}</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 transition hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {children}

        {footer ? (
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
