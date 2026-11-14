import { useEffect, useState } from 'react';
import { NavItem } from './NavItem.jsx';

function PizzaMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M8 10C20 4 34 9 43 19L20 43Z" fill="#F8A72C" stroke="#6F3415" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M8 10C20 4 34 9 43 19" fill="none" stroke="#FFE09C" strokeWidth="6" strokeLinecap="round" />
      <circle cx="23" cy="19" r="4.3" fill="#DD4B36" />
      <circle cx="31" cy="26" r="4" fill="#DD4B36" />
      <circle cx="17" cy="28" r="3.5" fill="#205735" />
      <path d="M29 11l3-7M39 12l5-4" stroke="#00D276" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Emojis are decorative; the sidebar links already have accessible labels.
function EmojiIcon({ emoji }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        fontSize: 20,
        lineHeight: 1,
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      }}
    >
      {emoji}
    </span>
  );
}

// Keep the directional collapse control as an SVG for clarity.
function CollapseIcon({ isCollapsed }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={isCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  isOpen,
  isCollapsed,
  onClose,
  onToggleCollapse,
  view,
  user,
  cartCount,
  onNavigate,
  onLogout,
  theme,
  onToggleTheme,
}) {
  // The mobile drawer should always display labels and the full logo,
  // regardless of the desktop sidebar's saved collapsed state.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1024px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const effectiveCollapsed = isCollapsed && !isMobile;

  // Handle Escape key to close mobile sidebar.
  useEffect(() => {
    function handleEscape(e) {
      if (e.key === 'Escape' && isOpen && window.innerWidth < 1024) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  // Prevent scrolling behind an open mobile sidebar.
  useEffect(() => {
    if (isOpen && window.innerWidth < 1024) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${effectiveCollapsed ? 'sidebar--collapsed' : ''} ${isOpen ? 'sidebar--open' : ''}`}
        aria-label="Main navigation"
      >
        {/* Header */}
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-brand"
            onClick={() => {
              onNavigate('home');
              if (window.innerWidth < 1024) onClose();
            }}
            aria-label="SUNNYS Pizza - Go to home"
          >
            {effectiveCollapsed ? (
              <PizzaMark size={32} />
            ) : (
              <img src="/sunnys-logo.svg" alt="" className="sidebar-logo" />
            )}
          </button>

          {/* Collapse/Expand Toggle — Desktop Only */}
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!effectiveCollapsed}
          >
            <CollapseIcon isCollapsed={effectiveCollapsed} />
          </button>
        </div>

        {/* Main Navigation */}
        <nav className="sidebar-nav">
          <NavItem
            icon={<EmojiIcon emoji="🏠" />}
            label="Home"
            onClick={() => {
              onNavigate('home');
              if (window.innerWidth < 1024) onClose();
            }}
            isActive={view === 'home' || view === 'home/builder'}
            isCollapsed={effectiveCollapsed}
          />

          <NavItem
            icon={<EmojiIcon emoji="🍕" />}
            label="Our Pizzas"
            onClick={() => {
              onNavigate('menu');
              if (window.innerWidth < 1024) onClose();
            }}
            isActive={view === 'menu' || view === 'menu/builder'}
            isCollapsed={effectiveCollapsed}
            ariaLabel="View our pizzas menu"
          />

          {user && (
            <>
              <NavItem
                icon={<EmojiIcon emoji="🧾" />}
                label="My Orders"
                onClick={() => {
                  onNavigate('orders');
                  if (window.innerWidth < 1024) onClose();
                }}
                isActive={view === 'orders' || view.startsWith('orders/')}
                isCollapsed={effectiveCollapsed}
              />

              <NavItem
                icon={<EmojiIcon emoji="🧑" />}
                label="My Profile"
                onClick={() => {
                  onNavigate('profile');
                  if (window.innerWidth < 1024) onClose();
                }}
                isActive={view === 'profile'}
                isCollapsed={effectiveCollapsed}
              />

              {user.role === 'admin' && (
                <NavItem
                  icon={<EmojiIcon emoji="📊" />}
                  label="Admin Dashboard"
                  onClick={() => {
                    onNavigate('admin');
                    if (window.innerWidth < 1024) onClose();
                  }}
                  isActive={view === 'admin'}
                  isCollapsed={effectiveCollapsed}
                  ariaLabel="View admin dashboard"
                />
              )}

              <NavItem
                icon={<EmojiIcon emoji="🛒" />}
                label="Cart"
                onClick={() => {
                  onNavigate('cart');
                  if (window.innerWidth < 1024) onClose();
                }}
                isActive={view === 'cart'}
                isCollapsed={effectiveCollapsed}
                badge={cartCount}
              />
            </>
          )}

          {!user && (
            <>
              <NavItem
                icon={<EmojiIcon emoji="🔑" />}
                label="Sign In"
                onClick={() => {
                  onNavigate('login');
                  if (window.innerWidth < 1024) onClose();
                }}
                isActive={view === 'login'}
                isCollapsed={effectiveCollapsed}
              />

              <NavItem
                icon={<EmojiIcon emoji="🥳" />}
                label="Join SUNNYS"
                onClick={() => {
                  onNavigate('register');
                  if (window.innerWidth < 1024) onClose();
                }}
                isActive={view === 'register'}
                isCollapsed={effectiveCollapsed}
                isPrimary
              />
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {user && (
            <div className="sidebar-user">
              <div className="user-avatar" aria-hidden="true">
                {user.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              {!effectiveCollapsed && (
                <div className="user-info">
                  <div className="user-name" title={user.email}>
                    {user.email?.split('@')[0]}
                  </div>
                  <div className="user-email">{user.email}</div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="sidebar-action"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <EmojiIcon emoji={theme === 'dark' ? '☀️' : '🌙'} />
            {!effectiveCollapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'} Mode</span>}
          </button>

          {user && (
            <button
              type="button"
              className="sidebar-action sidebar-action--logout"
              onClick={() => {
                onLogout();
                if (window.innerWidth < 1024) onClose();
              }}
              aria-label="Sign out"
            >
              <EmojiIcon emoji="🚪" />
              {!effectiveCollapsed && <span>Sign Out</span>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
