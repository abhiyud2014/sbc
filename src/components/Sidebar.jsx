import { useState } from 'react';
import {
  Gauge,
  Video,
  CirclePlay,
  Activity,
  Users,
  BookMarked,
  Bot,
  X,
  Radio,
  CalendarCheck,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

/**
 * Navigation modules and who may see them.
 *  - admin       → the host / mentor (full control)
 *  - participant → an enrolled student (their classes, replays, references)
 */
export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge, roles: ['admin'] },
  { id: 'myclasses', label: 'My Classes', icon: CalendarCheck, roles: ['participant'] },
  {
    id: 'sessions',
    label: 'Zoom Sessions',
    icon: Video,
    badge: 'Live',
    badgeTone: 'bg-accent-blue/20 text-accent-blue',
    roles: ['admin'],
  },
  { id: 'activity', label: 'Meeting Activity', icon: Activity, roles: ['admin'] },
  { id: 'recordings', label: 'Cloud Recordings', icon: CirclePlay, roles: ['admin', 'participant'] },
  { id: 'students', label: 'Students & Batches', icon: Users, roles: ['admin'] },
  { id: 'questions', label: 'Q&A Log', icon: HelpCircle, roles: ['admin'] },
  { id: 'resources', label: 'Reference Hub', icon: BookMarked, roles: ['admin', 'participant'] },
  {
    id: 'chatbot',
    label: 'AI Knowledge Bot',
    icon: Bot,
    badge: 'Demo',
    badgeTone: 'bg-accent-emerald/20 text-accent-emerald',
    roles: ['admin', 'participant'],
  },
];

/** Nav items visible for a role (default: admin). */
export const navForRole = (role = 'admin') =>
  NAV_ITEMS.filter((item) => (item.roles || ['admin']).includes(role));

/**
 * Desktop: the sidebar can be collapsed to an icon rail (labels move into
 * tooltips). The choice is remembered per browser. On mobile it stays a
 * full-width drawer toggled by the top-bar menu button.
 */
const COLLAPSE_KEY = 'sbc.sidebar-collapsed';

export default function Sidebar({ active, onNavigate, open, onClose, account, role = 'admin' }) {
  const items = navForRole(role);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* private mode — just don't persist */
      }
      return next;
    });
  };

  return (
    <>
      {/* Mobile scrim */}
      {open ? (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-800 bg-card-bg transition-all duration-300 md:static md:z-auto md:translate-x-0 ${
          collapsed ? 'md:w-20' : 'md:w-64'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Brand + collapse toggle */}
        <div
          className={`flex items-center border-b border-slate-800 p-5 ${
            collapsed ? 'justify-between md:flex-col md:gap-2 md:p-3' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-accent-emerald to-accent-blue text-xl font-black text-slate-950 shadow-lg">
              <Video size={18} />
            </div>
            <div className={collapsed ? 'md:hidden' : ''}>
              <h1 className="text-base font-bold tracking-tight text-white">SBC Traders</h1>
              <p className="text-xs font-medium text-accent-emerald">Trading Academy LMS</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="text-slate-400 hover:text-white md:hidden" aria-label="Close menu">
              <X size={18} />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white md:inline-flex"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 space-y-1.5 overflow-y-auto py-6 ${collapsed ? 'px-4 md:px-2' : 'px-4'}`}>
          <p
            className={`mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${
              collapsed ? 'md:hidden' : ''
            }`}
          >
            {role === 'admin' ? 'Main Menu' : 'My Learning'}
          </p>

          {items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
                title={collapsed ? item.label : undefined}
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition-colors ${
                  collapsed ? 'md:justify-center md:px-0' : ''
                } ${
                  isActive
                    ? 'border-accent-emerald/20 bg-accent-emerald/10 text-accent-emerald'
                    : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                {item.badge ? (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${item.badgeTone} ${
                      collapsed ? 'md:hidden' : ''
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Account status — hidden on the collapsed rail (dot only) */}
        <div
          className={`m-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 ${collapsed ? 'md:hidden' : ''}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Zoom Server-to-Server</span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold ${
                account?.ok
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
              }`}
            >
              {account?.ok ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Radio size={12} className="text-accent-emerald" />
            <span className="truncate">
              {account?.account?.email ? account.account.email : 'api.zoom.us/v2'}
            </span>
          </div>
        </div>
        {collapsed ? (
          <div
            className="hidden justify-center pb-5 md:flex"
            title={account?.ok ? 'Zoom: Connected' : 'Zoom: Offline'}
          >
            <span
              aria-label={account?.ok ? 'Zoom connected' : 'Zoom offline'}
              className={`h-2.5 w-2.5 rounded-full ${account?.ok ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
          </div>
        ) : null}
      </aside>
    </>
  );
}
