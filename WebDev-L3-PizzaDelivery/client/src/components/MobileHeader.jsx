function PizzaMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M8 10C20 4 34 9 43 19L20 43Z" fill="#F8A72C" stroke="#6F3415" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M8 10C20 4 34 9 43 19" fill="none" stroke="#FFE09C" strokeWidth="6" strokeLinecap="round" />
      <circle cx="23" cy="19" r="4.3" fill="#DD4B36" /><circle cx="31" cy="26" r="4" fill="#DD4B36" />
      <circle cx="17" cy="28" r="3.5" fill="#205735" /><path d="M29 11l3-7M39 12l5-4" stroke="#00D276" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 2L7 6M17 2l2 4M3 6h18M4 6l2 14h12l2-14M10 10v4M14 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function MobileHeader({ onMenuOpen, onNavigate, cartCount, user }) {
  return (
    <header className="mobile-header">
      <button
        type="button"
        className="mobile-header__menu-btn"
        onClick={onMenuOpen}
        aria-label="Open navigation menu"
        aria-expanded="false"
      >
        <MenuIcon />
      </button>

      <button
        type="button"
        className="mobile-header__brand"
        onClick={() => onNavigate('home')}
        aria-label="SUNNYS Pizza - Go to home"
      >
        <PizzaMark size={34} />
        <div className="mobile-header__brand-text">
          <span className="mobile-header__brand-name">SUNNYS</span>
          <span className="mobile-header__brand-tagline">Pizza</span>
        </div>
      </button>

      {user && (
  <button
    type="button"
    className="mobile-header__cart-btn"
    onClick={() => onNavigate('cart')}
    aria-label={`Shopping cart with ${cartCount || 0} items`}
  >
    <span className="mobile-cart-emoji" aria-hidden="true">
      🛒
    </span>

    {cartCount > 0 && (
      <span className="mobile-header__cart-badge">
        {cartCount > 99 ? '99+' : cartCount}
      </span>
    )}
  </button>
)}
    </header>
  );
}
