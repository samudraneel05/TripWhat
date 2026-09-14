import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  Home, Bell, Plus, Bookmark, Settings, ChevronLeft,
  User, LogOut, Mail, Compass, MessageSquare, MessagesSquare,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useUIStore } from '../stores/uiStore';
import { gmailApi, chatApi } from '../lib/api';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { sidebarCollapsed, toggleSidebarCollapse } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gmailApi.status().then((res) => setGmailConnected(res.data.connected)).catch(() => {});
  }, [location.search]);

  useEffect(() => {
    chatApi.listConversations()
      .then((res) => setRecentChats((res.data?.conversations || []).slice(0, 5)))
      .catch(() => {});
  }, [location.pathname]);

  const handleConnectGmail = async () => {
    setGmailConnecting(true);
    try {
      const res = await gmailApi.oauthUrl();
      window.location.href = res.data.url;
    } catch {
      setGmailConnecting(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const collapsed = sidebarCollapsed;
  const w = collapsed ? 'w-[60px]' : 'w-[240px]';

  const navItems = [
    { icon: Home, label: 'Trips', path: '/trips' },
    { icon: MessagesSquare, label: 'Chats', path: '/chats' },
    { icon: Bell, label: 'Notifications', path: '/notifications', badge: null },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <aside
      className={`${w} shrink-0 h-screen sticky top-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col z-30`}
      style={{ transition: 'width 200ms var(--ease-out)' }}
    >
      {/* Brand + collapse */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border)]">
        <Link to="/trips" className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--peach)] shrink-0">
            <Compass className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-[var(--ink)] truncate">TripWhat</span>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={toggleSidebarCollapse}
            className="ml-auto p-1 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button
          onClick={toggleSidebarCollapse}
          className="mx-auto mt-2 p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--sage)] transition-colors rotate-180"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* New trip button */}
      <div className="px-3 pt-3">
        <button
          onClick={() => navigate('/new')}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--ink)] text-white text-sm font-medium hover:bg-[#292524] transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          title="New trip"
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!collapsed && <span>New trip</span>}
        </button>
      </div>

      {/* Nav items */}
      <nav className="px-3 pt-4 space-y-0.5">
        {navItems.map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive(item.path)
                ? 'bg-[var(--sage)] text-[var(--ink)] font-medium'
                : 'text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)]'
            } ${collapsed ? 'justify-center' : ''}`}
            title={item.label}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Recent chats — ChatGPT-style, always resumable */}
      {!collapsed && recentChats.length > 0 && (
        <div className="px-3 pt-4">
          <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Recent chats
          </p>
          <div className="space-y-0.5">
            {recentChats.map((c) => (
              <Link
                key={c.conversationId}
                to={`/chat/${c.conversationId}`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  location.pathname === `/chat/${c.conversationId}`
                    ? 'bg-[var(--sage)] text-[var(--ink)]'
                    : 'text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)]'
                }`}
              >
                <MessageSquare className="w-3 h-3 shrink-0" />
                <span className="truncate flex-1">{c.preview || 'Untitled'}</span>
                {c.isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                )}
              </Link>
            ))}
            <Link
              to="/chats"
              className="block px-3 py-1.5 text-[10px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              All chats →
            </Link>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="mx-3 my-3 border-t border-[var(--border)]" />

      {/* Secondary nav */}
      <nav className="px-3 space-y-0.5">
        <Link
          to="/new?tab=bookings"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)] ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Bookings"
        >
          <Bookmark className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Bookings</span>}
        </Link>
        <Link
          to="/new?tab=saved"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-[var(--muted)] hover:bg-[var(--sage)] hover:text-[var(--ink)] ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Saved Places"
        >
          <span className="flex items-center gap-2.5">
            <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-current" />
            </span>
            {!collapsed && <span>Saved Places <span className="text-[10px] text-[var(--muted)] opacity-60">Beta</span></span>}
          </span>
        </Link>
      </nav>

      {/* Setup prompts */}
      {!collapsed && (
        <div className="px-3 mt-4 space-y-2">
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center gap-2 mb-1">
              <Mail className={`w-3.5 h-3.5 ${gmailConnected ? 'text-green-600' : 'text-[var(--muted)]'}`} />
              <span className="text-xs font-medium text-[var(--ink)]">
                {gmailConnected ? 'Gmail connected' : 'Connect Gmail'}
              </span>
            </div>
            {gmailConnected ? (
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Booking confirmations auto-import into Bookings.
              </p>
            ) : (
              <>
                <p className="text-xs text-[var(--muted)] leading-relaxed mb-2">
                  Auto-import flight & hotel bookings
                </p>
                <button
                  onClick={handleConnectGmail}
                  disabled={gmailConnecting}
                  className="w-full px-2.5 py-1.5 rounded-md bg-[var(--ink)] text-white text-xs font-medium hover:bg-[#292524] transition-colors disabled:opacity-50"
                >
                  {gmailConnecting ? 'Connecting…' : 'Connect'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Profile */}
      <div className="px-3 pb-3 relative" ref={profileRef}>
        <button
          onClick={() => setShowProfileMenu(!showProfileMenu)}
          className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--sage)] transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="w-7 h-7 rounded-full overflow-hidden border border-[var(--border)] shrink-0">
            <img
              src={user?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${user?.name || 'U'}`}
              alt={user?.name || 'User'}
              className="w-full h-full object-cover"
            />
          </div>
          {!collapsed && (
            <div className="min-w-0 text-left">
              <p className="text-xs font-medium text-[var(--ink)] truncate">{user?.name}</p>
              <p className="text-[10px] text-[var(--muted)] truncate">{user?.email}</p>
            </div>
          )}
        </button>

        {showProfileMenu && (
          <div className="absolute bottom-14 left-3 right-3 bg-[var(--surface)] rounded-lg border border-[var(--border)] shadow-[var(--shadow-soft-hover)] py-1 z-50">
            <Link
              to="/profile"
              onClick={() => setShowProfileMenu(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--sage)] transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              Profile
            </Link>
            <Link
              to="/profile"
              onClick={() => setShowProfileMenu(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--sage)] transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </Link>
            <div className="border-t border-[var(--border)] my-1" />
            <button
              onClick={() => { setShowProfileMenu(false); logout(); navigate('/'); }}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors w-full"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
