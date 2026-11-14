import { useEffect, useId, useState, useRef } from 'react';

import './index.css';

import { useAuth } from './hooks/useAuth.js';

import { useSwipeNavigation } from './hooks/useSwipeNavigation.js';

import * as authApi from './api/auth.js';

import * as catalogueApi from './api/catalogue.js';

import { PizzaBuilder } from './components/PizzaBuilder.jsx';

import { Cart } from './components/Cart.jsx';

import { Checkout } from './components/Checkout.jsx';

import { OrderHistory } from './components/OrderHistory.jsx';

import { OrderDetails } from './components/OrderDetails.jsx';

import { Sidebar } from './components/Sidebar.jsx';

import { MobileHeader } from './components/MobileHeader.jsx';

import { Menu } from './pages/Menu.jsx';

import { Profile } from './pages/Profile.jsx';

import { AdminDashboard } from './pages/AdminDashboard.jsx';

import { PizzaCatalogueManager } from './pages/PizzaCatalogueManager.jsx';

import { InventoryManager } from './pages/InventoryManager.jsx';

import { OrderManagement } from './pages/OrderManagement.jsx';

import { PendingOrderTicker } from './components/PendingOrderTicker.jsx';

import * as cartUtils from './utils/cart.js';

// Optional local pizza photography. Keep values null until you have licensed/owned photos.

// Configure via VITE_HERO_IMAGE_URL environment variable.

// Example: VITE_HERO_IMAGE_URL=https://example.com/hero-pizza.jpg

// SVG illustrations remain fallbacks when no image is configured or loading fails.

const bannerBackgroundUrl =

  import.meta.env.VITE_BANNER_IMAGE_URL?.trim() || null;

const PIZZA_PHOTOS = {

  hero: import.meta.env.VITE_HERO_IMAGE_URL || null,

  auth: '/auth-pizza.avif',

  banner: null,

  supreme: null,

  pepperoni: null,

  veggie: null,

};

// SUNNYS Pizza — Promotional Offers

const PROMOTIONS = [

  {

    id: 'first-order',

    title: '20% Off Your First Order',

    image: '/promos/sunnys-first-order-20-off.webp',

  },

  {

    id: 'free-delivery',

    title: 'Free Delivery',

    image: '/promos/sunnys-free-delivery.webp',

  },

  {

    id: 'buy-one-get-one',

    title: 'Buy One Pizza, Get One Free',

    image: '/promos/sunnys-buy-one-get-one.webp',

  },

];

function PizzaMark({ size = 40 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">

      <path d="M8 10C20 4 34 9 43 19L20 43Z" fill="#F8A72C" stroke="#6F3415" strokeWidth="2.5" strokeLinejoin="round" />

      <path d="M8 10C20 4 34 9 43 19" fill="none" stroke="#FFE09C" strokeWidth="6" strokeLinecap="round" />

      <circle cx="23" cy="19" r="4.3" fill="#DD4B36" /><circle cx="31" cy="26" r="4" fill="#DD4B36" />

      <circle cx="17" cy="28" r="3.5" fill="#205735" /><path d="M29 11l3-7M39 12l5-4" stroke="#00D276" strokeWidth="2.5" strokeLinecap="round" />

    </svg>

  );

}

function Brand({ onClick, compact = false }) {

  return (

    <button className={`brand ${compact ? 'brand--compact' : ''}`} onClick={onClick} aria-label="SUNNYS Pizza — go to home" type="button">

      <PizzaMark size={compact ? 34 : 41} />

      <span className="brand__type"><strong>SUNNYS</strong><em>Pizza</em></span>

    </button>

  );

}

// Original vector pizza illustration, no downloaded photos or third-party artwork.

function PizzaArt({ kind = 'supreme', className = '' }) {

  const uid = useId().replace(/:/g, '');

  const pepperoni = kind === 'pepperoni';

  const toppings = [

    [159, 140, 21], [274, 126, 19], [348, 183, 22], [175, 303, 20],

    [310, 306, 23], [235, 238, 17], [118, 225, 17], [378, 275, 13],

  ];

  return (

    <svg className={`pizza-art ${className}`} viewBox="0 0 500 500" role="img" aria-label="Illustration of a freshly baked pizza with colourful toppings">

      <defs>

        <radialGradient id={`${uid}crust`}><stop stopColor="#F9C35C" /><stop offset=".76" stopColor="#F0A744" /><stop offset="1" stopColor="#9B4D20" /></radialGradient>

        <radialGradient id={`${uid}cheese`}><stop stopColor="#FFE9A3" /><stop offset=".72" stopColor="#F6CB6B" /><stop offset="1" stopColor="#DC7D3F" /></radialGradient>

        <radialGradient id={`${uid}sauce`}><stop stopColor="#F36B39" /><stop offset="1" stopColor="#B73723" /></radialGradient>

        <filter id={`${uid}shadow`} x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="12" /></filter>

      </defs>

      <ellipse cx="254" cy="461" rx="204" ry="23" fill="#000" opacity=".35" filter={`url(#${uid}shadow)`} />

      <circle cx="250" cy="245" r="219" fill={`url(#${uid}crust)`} />

      <circle cx="250" cy="245" r="194" fill={`url(#${uid}sauce)`} />

      <circle cx="250" cy="245" r="185" fill={`url(#${uid}cheese)`} />

      <path d="M250 58V432M75 166L424 321M100 365L395 125M55 246H445" stroke="#C8793E" strokeWidth="3" opacity=".28" />

      {toppings.map(([x, y, r], i) => (

        <g key={i}>

          <circle cx={x} cy={y} r={r + (pepperoni ? 5 : 0)} fill={pepperoni ? '#B6352D' : '#CB3D2F'} stroke="#F37C49" strokeWidth="4" />

          <circle cx={x - 6} cy={y - 5} r="3" fill="#F9B177" opacity=".75" />

          <circle cx={x + 7} cy={y + 7} r="2.5" fill="#A52F26" opacity=".65" />

        </g>

      ))}

      {!pepperoni && (

        <g fill="none" stroke="#398943" strokeWidth="10" strokeLinecap="round">

          <path d="M136 176q24-35 47 3" /><path d="M287 203q26-32 48 5" /><path d="M214 352q20-34 48-8" /><path d="M336 353q-7-42 27-49" />

        </g>

      )}

      <g fill="none" stroke="#272422" strokeWidth="8">

        <circle cx="224" cy="156" r="10" /><circle cx="360" cy="238" r="10" /><circle cx="148" cy="258" r="10" />

        <circle cx="276" cy="368" r="10" /><circle cx="312" cy="157" r="9" />

      </g>

      <g fill="#2D8343">

        <ellipse cx="258" cy="100" rx="9" ry="18" transform="rotate(28 258 100)" />

        <ellipse cx="266" cy="108" rx="8" ry="17" transform="rotate(-30 266 108)" />

        <ellipse cx="195" cy="274" rx="8" ry="18" transform="rotate(-30 195 274)" />

        <ellipse cx="205" cy="275" rx="8" ry="17" transform="rotate(29 205 275)" />

      </g>

      <circle cx="250" cy="245" r="209" fill="none" stroke="#FFE39B" strokeWidth="5" opacity=".5" />

    </svg>

  );

}

function PizzaVisual({ kind = 'supreme', placement, className = '' }) {

  const [imageError, setImageError] = useState(false);

  const imageSrc = PIZZA_PHOTOS[placement || kind];

  // Reset error state if imageSrc changes

  useEffect(() => {

    setImageError(false);

  }, [imageSrc]);

  // Use illustration if no image configured or if image failed to load

  if (!imageSrc || imageError) {

    return <PizzaArt kind={kind} className={className} />;

  }

  return (

    <img

      className={`pizza-photo ${className}`.trim()}

      src={imageSrc}

      alt={placement === 'hero' ? 'Delicious SUNNYS Pizza' : `${kind === 'veggie' ? 'Vegetarian' : kind === 'pepperoni' ? 'Pepperoni' : 'Supreme'} pizza with fresh toppings`}

      loading={placement === 'hero' ? 'eager' : 'lazy'}

      onError={() => setImageError(true)}

    />

  );

}

function ThemeToggle({ theme, onToggle }) {

  const isDark = theme === 'dark';

  return (

    <button

      type="button"

      className="theme-toggle"

      onClick={onToggle}

      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}

      aria-pressed={!isDark}

      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}

    >

      {isDark ? (

        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>

      ) : (

        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M20.5 14.1A8.5 8.5 0 019.9 3.5 8.5 8.5 0 1020.5 14.1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>

      )}

      <span className="theme-toggle__label">{isDark ? 'Light' : 'Dark'} mode</span>

    </button>

  );

}

function ArrowIcon() {

  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

}
function Home({ onNavigate, user }) {

  // Promotional banner background

  const [bannerImageFailed, setBannerImageFailed] = useState(false);

  const showBannerBackground =

    Boolean(bannerBackgroundUrl) && !bannerImageFailed;

  return (

    <main>

      {/* Active Orders Ticker - Only for customers */}

      {user && user.role === 'customer' && (

        <div className="shell" style={{ marginTop: '2rem' }}>

          <PendingOrderTicker user={user} onNavigate={onNavigate} />

        </div>

      )}

      {/* Hero Section */}

      <section className="hero shell">

        <div className="hero__text">

          <div className="eyebrow"><span className="eyebrow__dot" /> FRESHLY MADE. ALWAYS SUNNY.</div>

          <h1>Good food.<br /><span>Brighter days.</span></h1>

          <p>Big flavours, fresh ingredients and the kind of pizza that makes every moment feel a little brighter.</p>

          <div className="hero__actions">

            <button className="button button--primary button--large" type="button" onClick={() => onNavigate('menu')}>

              Explore the menu <ArrowIcon />

            </button>

            <button className="button button--outline button--large" type="button" onClick={() => onNavigate(user ? 'menu' : 'register')}>

              {user ? 'Order now' : 'Create an account'}

            </button>

          </div>

          <div className="hero__trust">

            <span className="trust-stars">★★★★★</span>

            <span>Made with love, served with sunshine</span>

          </div>

        </div>

        <div className="hero__visual">

          <div className="hero__halo" />

          <div className="hero__pizza"><PizzaVisual placement="hero" /></div>

          <div className="floating-tag floating-tag--top"><span>🌿</span> Fresh ingredients</div>

          <div className="floating-tag floating-tag--bottom"><span>🍕</span> Every slice, a smile</div>

        </div>

      </section>
      {/* SUNNYS Pizza — Promotional Offers */}

      <section

        className="promo-section shell"

        aria-labelledby="promo-heading"

      >

        <div className="promo-section__header">

          <span className="section-kicker">

            EXCLUSIVE OFFERS

          </span>

          <h2 id="promo-heading">

            Hot Deals. Happier Meals.

          </h2>

          <p>

            Your favourite pizzas, with offers worth celebrating.

          </p>

        </div>

        <div className="promo-grid">

          {PROMOTIONS.map((promo) => (

            <button

              key={promo.id}

              type="button"

              className="promo-card"

              onClick={() => onNavigate('menu')}

              aria-label={`${promo.title} — Browse pizzas`}

            >

              <img

                src={promo.image}

                alt={promo.title}

                loading="lazy"

                decoding="async"

              />

            </button>

          ))}

        </div>

      </section>

      {/* SUNNYS Pizza — Promotional Banner */}

      <section

        className={`banner shell ${showBannerBackground ? 'banner--with-image' : ''

          }`}

      >

        {/* Animated background GIF */}

        {showBannerBackground && (

          <img

            className="banner__background"

            src={bannerBackgroundUrl}

            alt=""

            aria-hidden="true"

            loading="lazy"

            onError={() => setBannerImageFailed(true)}

          />

        )}

        {/* Existing decorative glow */}

        <div className="banner__glow" />

        {/* Promotional text */}

        <div className="banner__content">

          <p className="section-kicker">

            THE SUNNYS WAY

          </p>

          <h2>

            A little sunshine

            <br />

            in every slice.

          </h2>

          <p>

            Ready to order? Explore our menu and

            customize your perfect pizza.

          </p>

          <button

            type="button"

            className="button button--light"

            onClick={() => onNavigate('menu')}

          >

            View menu <ArrowIcon />

          </button>

        </div>

        {/* Original illustration fallback */}

        {!showBannerBackground && (

          <div className="banner__art">

            <PizzaArt kind="pepperoni" />

          </div>

        )}

      </section>

    </main>

  );

}

function TextField({ id, label, type = 'text', placeholder, autoComplete, required = true, error }) {

  return (

    <label className="field" htmlFor={id}>

      <span className="field__label">{label}</span>

      <input

        id={id}

        name={id}

        type={type}

        placeholder={placeholder}

        autoComplete={autoComplete}

        required={required}

        aria-invalid={error ? 'true' : 'false'}

        aria-describedby={error ? `${id}-error` : undefined}

      />

      {error && <span id={`${id}-error`} className="form-hint" style={{ color: 'var(--orange)', marginTop: '5px' }}>{error}</span>}

    </label>

  );

}

function PasswordField({ id = 'password', label = 'Password', autoComplete = 'current-password', error }) {

  const [show, setShow] = useState(false);

  return (

    <div className="field">

      <label className="field__label" htmlFor={id}>{label}</label>

      <div className="password-wrap">

        <input

          id={id}

          name={id}

          type={show ? 'text' : 'password'}

          placeholder="Enter your password"

          autoComplete={autoComplete}

          minLength={8}

          required

          aria-invalid={error ? 'true' : 'false'}

          aria-describedby={error ? `${id}-error` : undefined}

        />

        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>

          {show ? 'Hide' : 'Show'}

        </button>

      </div>

      {error && <span id={`${id}-error`} className="form-hint" style={{ color: 'var(--orange)', marginTop: '5px' }}>{error}</span>}

    </div>

  );

}

function RouteLoadingOverlay({ destination }) {
  const isMenu = destination === 'menu';

  return (
    <div className="route-loader" role="status" aria-live="polite">
      <div className="route-loader__card">
        <span className="route-loader__pizza" aria-hidden="true">🍕</span>
        <strong className="route-loader__heading">
          {isMenu ? 'Serving up the menu' : 'Opening sign in'}
        </strong>
        <span className="route-loader__message">
          {isMenu ? 'Fresh choices, coming right up!' : 'Welcome back to SUNNYS Pizza'}
        </span>
        <span className="route-loader__progress" aria-hidden="true"><span /></span>
      </div>
    </div>
  );
}

function AuthPage({ view, onNavigate, onNotice, onRegister, onLogin, csrfToken }) {

  const [submitting, setSubmitting] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});

  const isAdminLogin = view === 'admin-login';

  const isLogin = view === 'login' || isAdminLogin;

  const isRegister = view === 'register';

  const isForgot = view === 'forgot';

  const headings = {

    'admin-login': [

      'Admin Sign In',

      'Sign in to manage SUNNYS Pizza operations.'

    ],

    login: ['Welcome back 👋', 'Sign in to your SUNNYS Pizza account.'],

    register: ['Create your account', 'Your next favourite pizza is one step closer.'],

    forgot: ['Forgot password?', "Enter your email. We'll help you get back in."],

    verify: ['Check your inbox ✉', "We've sent a verification link to your email address."],

  };

  async function handleSubmit(event) {

    event.preventDefault();

    setFieldErrors({});

    const formData = new FormData(event.target);

    const email = formData.get('email');

    const password = formData.get('password');

    const confirmPassword = formData.get('confirmPassword');

    // Client-side validation

    const errors = {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

      errors.email = 'Please enter a valid email address';

    }

    if (!isForgot && (!password || password.length < 8)) {

      errors.password = 'Password must be at least 8 characters';

    }

    if (isRegister && password !== confirmPassword) {

      errors.confirmPassword = 'Passwords do not match';

    }

    if (Object.keys(errors).length > 0) {

      setFieldErrors(errors);

      return;

    }

    setSubmitting(true);

    try {

      if (isRegister) {

        const result = await onRegister(email, password);

        onNotice(result.message);

        onNavigate('verify');

      } else if (isLogin) {

        await onLogin(email, password);

        onNotice(

          isAdminLogin

            ? 'Welcome to the SUNNYS Admin Dashboard.'

            : 'Welcome back! You are now signed in.'

        );

        onNavigate(isAdminLogin ? 'admin' : 'home');

      } else if (isForgot) {

        const freshCsrfToken = await authApi.fetchCsrfToken();

        const result = await authApi.forgotPassword(

          email,

          freshCsrfToken

        );

        onNotice(result.message);

        event.target.reset();

      }

    } catch (err) {

      onNotice(err.message || 'An error occurred. Please try again.');

    } finally {

      setSubmitting(false);

    }

  }

  return (

    <main className="auth-page shell">

      <section className="auth-story" aria-label="SUNNYS Pizza welcome"><div className="auth-story__orbs" /><span className="auth-story__tag">MADE FOR PIZZA LOVERS</span><div className="auth-story__art"><PizzaVisual placement="auth" /></div><div className="auth-story__copy"><span className="section-kicker">WELCOME TO SUNNYS</span><h2>Satisfy your<br /><em>pizza cravings.</em></h2><p>Fresh flavours and brighter moments are just around the corner.</p><div className="story-dots"><i /><i /><i /></div></div></section>

      <section className="auth-panel"><div className="auth-panel__top"><button type="button" onClick={() => onNavigate('home')} className="back-link">← Back to home</button></div><div className="auth-panel__content"><div className="auth-panel__brand"><button

        type="button"

        className="footer-brand"

        onClick={() => onNavigate('home')}

        aria-label="SUNNYS Pizza — Go to homepage"

      >

        <img

          src="/sunnys-logo.svg"

          alt=""

          className="footer-logo"

        />

      </button></div><h1>{headings[view][0]}</h1><p className="auth-panel__subtitle">{headings[view][1]}</p>

        {view === 'verify' ? <div className="verify-view"><span className="verify-icon">✉</span><p>Please check your email for a verification link to activate your account.</p><button className="button button--primary button--full" type="button" onClick={() => onNavigate('login')}>Back to sign in <ArrowIcon /></button></div>

          : <form onSubmit={handleSubmit} className="auth-form">

            <TextField id="email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" error={fieldErrors.email} />

            {!isForgot && <PasswordField autoComplete={isRegister ? 'new-password' : 'current-password'} error={fieldErrors.password} />}

            {isRegister && <><PasswordField id="confirmPassword" label="Confirm password" autoComplete="new-password" error={fieldErrors.confirmPassword} /><p className="form-hint">Use at least 8 characters for your password.</p></>}

            {isLogin && <div className="form-row"><span className="muted-caption">Secure account access</span><button type="button" className="text-link" onClick={() => onNavigate('forgot')}>Forgot password?</button></div>}

            <button className="button button--primary button--full auth-submit" type="submit" disabled={submitting} aria-busy={submitting}>

              {submitting ? (
                <>
                  <span className="auth-submit__spinner" aria-hidden="true" />
                  {isLogin ? 'Signing you in…' : isRegister ? 'Creating account…' : 'Sending reset link…'}
                </>
              ) : (
                <>
                  {isLogin ? 'Sign in' : isRegister ? 'Create account' : 'Send reset link'}
                  <ArrowIcon />
                </>
              )}

            </button>

          </form>}

        {isLogin && <p className="switch-view">Don't have an account? <button type="button" onClick={() => onNavigate('register')}>Sign up</button></p>}

        {isRegister && <p className="switch-view">Already have an account? <button type="button" onClick={() => onNavigate('login')}>Sign in</button></p>}

        {isForgot && <p className="switch-view">Remember your password? <button type="button" onClick={() => onNavigate('login')}>Back to sign in</button></p>}

        {(isRegister || isLogin) && <div className="auth-extra"><span>Looking for the email confirmation screen?</span><button type="button" onClick={() => onNavigate('verify')}>View verification page →</button></div>}

      </div></section>

    </main>

  );

}

function EmailVerificationPage({ onNavigate, onNotice }) {

  const [status, setStatus] = useState('verifying'); // verifying, success, error

  const [errorMessage, setErrorMessage] = useState('');

  const [resendingEmail, setResendingEmail] = useState(false);

  const verificationAttempted = useRef(false);

  const { csrfToken } = useAuth();

  useEffect(() => {

    // Prevent duplicate verification in React Strict Mode

    if (verificationAttempted.current) {

      return;

    }

    async function verifyToken() {

      // Extract token from URL hash query params

      const hash = window.location.hash;

      const queryStart = hash.indexOf('?');

      if (queryStart === -1) {

        setStatus('error');

        setErrorMessage('No verification token provided');

        return;

      }

      const queryString = hash.substring(queryStart + 1);

      const params = new URLSearchParams(queryString);

      const token = params.get('token');

      if (!token) {

        setStatus('error');

        setErrorMessage('No verification token provided');

        return;

      }

      // Mark as attempted before making request

      verificationAttempted.current = true;

      try {

        await authApi.verifyEmail(token);

        setStatus('success');

      } catch (err) {

        setStatus('error');

        setErrorMessage(err.message || 'Verification failed');

      }

    }

    verifyToken();

  }, []);

  async function handleResendVerification() {

    const email = prompt('Enter your email address to resend verification:');

    if (!email) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

      onNotice('Please enter a valid email address');

      return;

    }

    setResendingEmail(true);

    try {

      const result = await authApi.resendVerification(email, csrfToken);

      onNotice(result.message);

    } catch (err) {

      onNotice(err.message || 'Failed to resend verification email');

    } finally {

      setResendingEmail(false);

    }

  }

  return (

    <main className="auth-page shell">

      <section className="auth-story" aria-label="SUNNYS Pizza welcome">

        <div className="auth-story__orbs" />

        <span className="auth-story__tag">MADE FOR PIZZA LOVERS</span>

        <div className="auth-story__art"><PizzaVisual placement="auth" /></div>

        <div className="auth-story__copy">

          <span className="section-kicker">WELCOME TO SUNNYS</span>

          <h2>Satisfy your<br /><em>pizza cravings.</em></h2>

          <p>Fresh flavours and brighter moments are just around the corner.</p>

          <div className="story-dots"><i /><i /><i /></div>

        </div>

      </section>

      <section className="auth-panel">

        <div className="auth-panel__top">

          <button type="button" onClick={() => onNavigate('home')} className="back-link">

            ← Back to home

          </button>

        </div>

        <div className="auth-panel__content">

          <div className="auth-panel__brand">

            <Brand compact onClick={() => onNavigate('home')} />

          </div>

          {status === 'verifying' && (

            <div className="verify-view">

              <span className="verify-icon" style={{ background: 'var(--green-dark)', color: 'var(--green)' }}>

                ⏳

              </span>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '20px 0 9px', textAlign: 'center' }}>

                Verifying your email...

              </h1>

              <p style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--text-muted)', textAlign: 'center' }}>

                Please wait while we confirm your email address.

              </p>

            </div>

          )}

          {status === 'success' && (

            <div className="verify-view">

              <span className="verify-icon">✓</span>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '20px 0 9px', textAlign: 'center' }}>

                Email verified! ✨

              </h1>

              <p style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--text-muted)', textAlign: 'center' }}>

                Your email has been successfully verified. You can now sign in to your SUNNYS Pizza account.

              </p>

              <button

                className="button button--primary button--full"

                type="button"

                onClick={() => {

                  onNotice('Email verified successfully! Please sign in.');

                  onNavigate('login');

                }}

              >

                Sign in now <ArrowIcon />

              </button>

            </div>

          )}

          {status === 'error' && (

            <div className="verify-view">

              <span className="verify-icon" style={{ background: 'rgba(255, 130, 70, 0.1)', color: 'var(--orange)' }}>

                ⚠

              </span>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '20px 0 9px', textAlign: 'center' }}>

                Verification failed

              </h1>

              <p style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px' }}>

                {errorMessage}

              </p>

              <p style={{ fontSize: '12px', lineHeight: '1.7', color: 'var(--text-muted)', textAlign: 'center' }}>

                This verification link may have expired or already been used.

              </p>

              <button

                className="button button--primary button--full"

                type="button"

                onClick={handleResendVerification}

                disabled={resendingEmail}

                style={{ marginTop: '15px' }}

              >

                {resendingEmail ? 'Sending...' : 'Resend verification email'}

              </button>

              <button

                className="button button--ghost button--full"

                type="button"

                onClick={() => onNavigate('login')}

                style={{ marginTop: '10px' }}

              >

                Go to login

              </button>

            </div>

          )}

        </div>

      </section>

    </main>

  );

}

function PasswordResetPage({ onNavigate, onNotice }) {

  const [status, setStatus] = useState('form'); // form, submitting, success, error

  const [errorMessage, setErrorMessage] = useState('');

  const [fieldErrors, setFieldErrors] = useState({});

  const [token, setToken] = useState('');

  const { csrfToken } = useAuth();

  useEffect(() => {

    // Extract token from URL

    const hash = window.location.hash;

    const queryStart = hash.indexOf('?');

    if (queryStart !== -1) {

      const queryString = hash.substring(queryStart + 1);

      const params = new URLSearchParams(queryString);

      const resetToken = params.get('token');

      if (resetToken) {

        setToken(resetToken);

      } else {

        setStatus('error');

        setErrorMessage('No reset token provided');

      }

    } else {

      setStatus('error');

      setErrorMessage('No reset token provided');

    }

  }, []);

  async function handleSubmit(event) {

    event.preventDefault();

    setFieldErrors({});

    const formData = new FormData(event.target);

    const password = formData.get('password');

    const confirmPassword = formData.get('confirmPassword');

    // Client-side validation

    const errors = {};

    if (!password || password.length < 8) {

      errors.password = 'Password must be at least 8 characters';

    }

    if (password !== confirmPassword) {

      errors.confirmPassword = 'Passwords do not match';

    }

    if (Object.keys(errors).length > 0) {

      setFieldErrors(errors);

      return;

    }

    setStatus('submitting');

    try {

      await authApi.resetPassword(token, password, csrfToken);

      setStatus('success');

    } catch (err) {

      setStatus('error');

      setErrorMessage(err.message || 'Password reset failed');

    }

  }

  return (

    <main className="auth-page shell">

      <section className="auth-story" aria-label="SUNNYS Pizza welcome">

        <div className="auth-story__orbs" />

        <span className="auth-story__tag">MADE FOR PIZZA LOVERS</span>

        <div className="auth-story__art"><PizzaVisual placement="auth" /></div>

        <div className="auth-story__copy">

          <span className="section-kicker">WELCOME TO SUNNYS</span>

          <h2>Satisfy your<br /><em>pizza cravings.</em></h2>

          <p>Fresh flavours and brighter moments are just around the corner.</p>

          <div className="story-dots"><i /><i /><i /></div>

        </div>

      </section>

      <section className="auth-panel">

        <div className="auth-panel__top">

          <button type="button" onClick={() => onNavigate('home')} className="back-link">

            ← Back to home

          </button>

        </div>

        <div className="auth-panel__content">

          <div className="auth-panel__brand">

            <Brand compact onClick={() => onNavigate('home')} />

          </div>

          {(status === 'form' || status === 'submitting') && (

            <>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '0 0 9px', textAlign: 'center' }}>

                Reset your password

              </h1>

              <p className="auth-panel__subtitle">Enter your new password below.</p>

              <form onSubmit={handleSubmit} className="auth-form">

                <PasswordField

                  id="password"

                  label="New password"

                  autoComplete="new-password"

                  error={fieldErrors.password}

                />

                <PasswordField

                  id="confirmPassword"

                  label="Confirm new password"

                  autoComplete="new-password"

                  error={fieldErrors.confirmPassword}

                />

                <p className="form-hint">Use at least 8 characters for your password.</p>

                <button

                  className="button button--primary button--full auth-submit"

                  type="submit"

                  disabled={status === 'submitting'}

                >

                  {status === 'submitting' ? 'Resetting password...' : 'Reset password'} {status !== 'submitting' && <ArrowIcon />}

                </button>

              </form>

            </>

          )}

          {status === 'success' && (

            <div className="verify-view">

              <span className="verify-icon">✓</span>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '20px 0 9px', textAlign: 'center' }}>

                Password reset successful! ✨

              </h1>

              <p style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--text-muted)', textAlign: 'center' }}>

                Your password has been successfully reset. You can now sign in with your new password.

              </p>

              <button

                className="button button--primary button--full"

                type="button"

                onClick={() => {

                  onNotice('Password reset successful! Please sign in.');

                  onNavigate('login');

                }}

              >

                Sign in now <ArrowIcon />

              </button>

            </div>

          )}

          {status === 'error' && (

            <div className="verify-view">

              <span className="verify-icon" style={{ background: 'rgba(255, 130, 70, 0.1)', color: 'var(--orange)' }}>

                ⚠

              </span>

              <h1 style={{ fontSize: '30px', lineHeight: '1.2', letterSpacing: '-0.055em', margin: '20px 0 9px', textAlign: 'center' }}>

                Password reset failed

              </h1>

              <p style={{ fontSize: '13px', lineHeight: '1.8', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px' }}>

                {errorMessage}

              </p>

              <p style={{ fontSize: '12px', lineHeight: '1.7', color: 'var(--text-muted)', textAlign: 'center' }}>

                This reset link may have expired or already been used. You can request a new password reset from the login page.

              </p>

              <button

                className="button button--primary button--full"

                type="button"

                onClick={() => onNavigate('forgot')}

                style={{ marginTop: '15px' }}

              >

                Request new reset link

              </button>

              <button

                className="button button--ghost button--full"

                type="button"

                onClick={() => onNavigate('login')}

                style={{ marginTop: '10px' }}

              >

                Go to login

              </button>

            </div>

          )}

        </div>

      </section>

    </main>

  );

}

function SiteFooter({ onNavigate }) {

  return (

    <footer className="site-footer">

      <div className="shell site-footer__inner">

        {/* SUNNYS Pizza SVG Logo */}

        <button

          type="button"

          className="brand brand--compact"

          onClick={() => onNavigate('home')}

          aria-label="SUNNYS Pizza — Go to homepage"

        >

          <img

            src="/sunnys-logo.svg"

            alt=""

            className="footer-logo"

          />

        </button>

        <p>Good food. Brighter days.</p>

        <span>

          © {new Date().getFullYear()} SUNNYS Pizza

        </span>

      </div>

    </footer>

  );

}

const VALID_VIEWS = new Set([

  'home',

  'home/builder',

  'menu',

  'menu/builder',

  'cart',

  'checkout',

  'orders',

  'profile',

  'admin',

  'admin/orders',

  'admin/pizzas',

  'admin/inventory',

  'login',

  'register',

  'forgot',

  'verify',

  'verify-email',

  'reset-password',

  'admin-login',

]);

function getView() {

  const hash = window.location.hash.replace('#', '');

  const view = hash.split('?')[0];

  if (VALID_VIEWS.has(view)) {

    return view;

  }

  // Support individual customer order routes

  if (/^orders\/[0-9a-fA-F]{24}$/.test(view)) {

    return view;

  }

  return 'home';

}

function getBuilderState() {

  const hash = window.location.hash.replace('#', '');

  return hash === 'home/builder' || hash.startsWith('home/builder?') ||

    hash === 'menu/builder' || hash.startsWith('menu/builder?');

}

function getPizzaIdFromHash() {

  const hash = window.location.hash;

  const queryStart = hash.indexOf('?');

  if (queryStart === -1) return null;

  const params = new URLSearchParams(hash.substring(queryStart + 1));

  return params.get('pizzaId');

}

function toBuilderPizza(foundPizza) {

  if (!foundPizza) return null;

  return {

    ...foundPizza,

    price: foundPizza.price || catalogueApi.formatPrice(foundPizza.pricePaise),

    kind: foundPizza.kind || foundPizza.category,

    category: foundPizza.category || foundPizza.kind,

    label: foundPizza.label || (foundPizza.available ? 'Available' : 'Out of stock'),

    score: foundPizza.score || '4.8',

  };

}

const THEME_STORAGE_KEY = 'sunnys-pizza-theme';

function getSavedTheme() {

  try {

    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';

  } catch {

    return 'dark';

  }

}

export default function App() {

  const [view, setView] = useState(getView);
  const [routeLoading, setRouteLoading] = useState(null);

  // Brief visual feedback when entering the menu or sign-in. Never blocks data requests.
  useEffect(() => {
    if (view !== 'menu' && view !== 'login' && view !== 'admin-login') {
      setRouteLoading(null);
      return;
    }

    setRouteLoading(view === 'menu' ? 'menu' : 'login');
    const timeoutId = window.setTimeout(() => setRouteLoading(null), 550);
    return () => window.clearTimeout(timeoutId);
  }, [view]);

  const [notice, setNotice] = useState('');

  const [theme, setTheme] = useState(getSavedTheme);

  const [selectedPizza, setSelectedPizza] = useState(null);

  const [showBuilder, setShowBuilder] = useState(getBuilderState);

  const [pizzas, setPizzas] = useState([]); // Cache pizzas for builder navigation

  const [cartItemCount, setCartItemCount] = useState(0);

  // Sidebar state

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {

    const saved = localStorage.getItem('sunnys-sidebar-collapsed');

    return saved === 'true';

  });

  const { user, loading: authLoading, adminLogin, register, login, logout, isAuthenticated, csrfToken, refreshUser } = useAuth();

  // Enable touchscreen swipe navigation (back/forward)

  useSwipeNavigation({

    enabled: true,

    threshold: 50,

    maxVerticalRatio: 0.5

  });

  // Update cart item count whenever view changes or component mounts

  useEffect(() => {

    const cart = cartUtils.loadCart(user);

    setCartItemCount(cartUtils.getCartItemCount(cart));

  }, [view, user?.id, user?._id]);

  // Restore the builder pizza on load, login, and browser back/forward.
  // hashchange does not fire on a full refresh, so this must also run from effect deps.

  useEffect(() => {

    let cancelled = false;

    const handleHash = async () => {

      const newView = getView();

      const newBuilderState = getBuilderState();

      setView(newView);

      setShowBuilder(newBuilderState);

      if (!newBuilderState) {

        if (selectedPizza) {

          setSelectedPizza(null);

        }

        return;

      }

      const pizzaId = getPizzaIdFromHash();

      if (!pizzaId) {

        const returnView = newView.startsWith('menu') ? 'menu' : 'home';

        setNotice('Invalid builder URL. Returning to catalogue.');

        setShowBuilder(false);

        window.location.hash = returnView;

        return;

      }

      const selectedId = selectedPizza?.id != null ? String(selectedPizza.id) : '';

      if (selectedId === String(pizzaId)) {

        return;

      }

      let pizza = pizzas.find(p => String(p.id) === String(pizzaId));

      if (pizza) {

        if (!cancelled) {

          setSelectedPizza(toBuilderPizza(pizza));

        }

        return;

      }

      if (authLoading) {

        return;

      }

      if (!user) {

        return;

      }

      try {

        const cataloguePizzas = await catalogueApi.getPizzas();

        const foundPizza = cataloguePizzas.find(p => String(p.id) === String(pizzaId));

        if (foundPizza) {

          pizza = toBuilderPizza(foundPizza);

          if (!cancelled) {

            setPizzas(prev => {

              const exists = prev.some(p => String(p.id) === String(pizzaId));

              return exists ? prev : [...prev, pizza];

            });

            setSelectedPizza(pizza);

          }

          return;

        }

      } catch (err) {

        console.error('Failed to fetch pizza:', err);

        if (!cancelled) {

          setNotice('Pizza not found. Returning to catalogue.');

          setShowBuilder(false);

          window.location.hash = 'home';

        }

        return;

      }

      if (!cancelled) {

        const returnView = newView.startsWith('menu') ? 'menu' : 'home';

        setNotice('Pizza not found. Returning to catalogue.');

        setShowBuilder(false);

        window.location.hash = returnView;

      }

    };

    handleHash();

    window.addEventListener('hashchange', handleHash);

    return () => {

      cancelled = true;

      window.removeEventListener('hashchange', handleHash);

    };

  }, [selectedPizza, pizzas, user, authLoading]);

  useEffect(() => {

    document.documentElement.setAttribute('data-theme', theme);

    try {

      window.localStorage.setItem(THEME_STORAGE_KEY, theme);

    } catch {

      // The theme still works when browser storage is disabled.

    }

  }, [theme]);

  function toggleTheme() {

    setTheme(current => current === 'dark' ? 'light' : 'dark');

  }

  // Close the mobile sidebar

  function closeSidebar() {

    setSidebarOpen(false);

  }

  // Toggle desktop sidebar collapse/expand

  function toggleSidebarCollapse() {

    setSidebarCollapsed(current => !current);

  }

  function navigate(next) {

    setNotice('');

    // Only clear builder state if navigating away from home/menu

    if (next !== 'home' && next !== 'home/builder' && next !== 'menu' && next !== 'menu/builder') {

      setShowBuilder(false);

      setSelectedPizza(null);

    }

    window.location.hash = next;

    setView(next);

    window.scrollTo({ top: 0, behavior: 'instant' });

  }

  function handleViewPizza(pizza) {

    setSelectedPizza(toBuilderPizza(pizza));

    setShowBuilder(true);

    // Update URL with pizza builder route and ID for browser history

    // Keep the route based on current view

    const builderRoute = view === 'menu' ? 'menu/builder' : 'home/builder';

    window.location.hash = `${builderRoute}?pizzaId=${pizza.id}`;

    window.scrollTo({ top: 0, behavior: 'smooth' });

  }

  function handleBackFromBuilder() {

    // Navigate back to the page we came from (menu or home)

    const returnView = view.startsWith('menu') ? 'menu' : 'home';

    navigate(returnView);

  }

  async function handleLogout() {

    try {

      await logout();

      setNotice('You have been signed out successfully.');

      navigate('home');

    } catch (err) {

      setNotice('Logout failed. Please try again.');

    }

  }

  return (

    <div

      className={`app-container ${user ? '' : 'app-container--guest'}`}

      data-theme={theme}

    >

      {/* Theme toggle for guests */}

      {!user && (

        <div className="guest-theme-toggle">

          <ThemeToggle

            theme={theme}

            onToggle={toggleTheme}

          />

        </div>

      )}

      {/* Mobile Header */}

      {user && (

        <MobileHeader

          onMenuOpen={() => setSidebarOpen(true)}

          onNavigate={navigate}

          cartCount={cartItemCount}

          user={user}

        />

      )}

      {/* Left Sidebar */}

      {user && (

        <Sidebar

          isOpen={sidebarOpen}

          isCollapsed={sidebarCollapsed}

          onClose={closeSidebar}

          onToggleCollapse={toggleSidebarCollapse}

          view={view}

          user={user}

          cartCount={cartItemCount}

          onNavigate={navigate}

          onLogout={handleLogout}

          theme={theme}

          onToggleTheme={toggleTheme}

        />)}

      {/* Main Content */}

      <div className="main-content">

        {((view === 'home' || view === 'home/builder') && showBuilder) || ((view === 'menu' || view === 'menu/builder') && showBuilder) ? (

          <PizzaBuilder

            key={user?.id ?? user?._id ?? 'guest'}

            pizza={selectedPizza}

            onBack={handleBackFromBuilder}

            csrfToken={csrfToken}

            onNotice={setNotice}

            user={user}

            onCartUpdate={() => {

              const cart = cartUtils.loadCart(user);

              setCartItemCount(

                cartUtils.getCartItemCount(cart)

              );

            }}

          />

        ) : (view === 'home' || view === 'home/builder') ? (

          <Home

            onNavigate={navigate}

            user={user}

          />

        ) : view === 'menu' ? (

          <Menu

            onNavigate={navigate}

            onNotice={setNotice}

            user={user}

            onViewPizza={handleViewPizza}

            onPizzasLoaded={setPizzas}

          />

        ) : view === 'cart' ? (

          <Cart

            key={user?.id ?? user?._id ?? 'guest'}

            onNavigate={navigate}

            csrfToken={csrfToken}

            onNotice={setNotice}

            user={user}

            onCartUpdate={() => {

              const savedCart = cartUtils.loadCart(user);

              setCartItemCount(

                cartUtils.getCartItemCount(savedCart)

              );

            }}

          />

        ) : view === 'checkout' ? (

          <Checkout

            key={user?.id ?? user?._id ?? 'guest'}

            onNavigate={navigate}

            csrfToken={csrfToken}

            onNotice={setNotice}

            user={user}

            onCartUpdate={() => {

              const savedCart = cartUtils.loadCart(user);

              setCartItemCount(

                cartUtils.getCartItemCount(savedCart)

              );

            }}

          />

        ) : view === 'orders' ? (

          <OrderHistory

            onViewDetails={(orderId) => navigate(`orders/${orderId}`)}

            onNotice={setNotice}

          />

        ) : view === 'profile' ? (

          <Profile

            user={user}

            onNavigate={navigate}

            onLogout={handleLogout}

            onUserUpdate={refreshUser}

            csrfToken={csrfToken}

          />

        ) : view === 'admin' ? (

          <AdminDashboard

            user={user}

            onNavigate={navigate}

          />

        ) : view === 'admin/orders' ? (

          <OrderManagement

            user={user}

            onNavigate={navigate}

            csrfToken={csrfToken}

          />

        ) : view === 'admin/pizzas' ? (

          <PizzaCatalogueManager

            user={user}

            onNavigate={navigate}

            csrfToken={csrfToken}

          />

        ) : view === 'admin/inventory' ? (

          <InventoryManager

            user={user}

            onNavigate={navigate}

            csrfToken={csrfToken}

          />

        ) : view.startsWith('orders/') ? (

          <OrderDetails

            orderId={view.substring(7)}

            onBack={() => navigate('orders')}

            onNotice={setNotice}

          />

        ) : view === 'verify-email' ? (

          <EmailVerificationPage onNavigate={navigate} onNotice={setNotice} />

        ) : view === 'reset-password' ? (

          <PasswordResetPage onNavigate={navigate} onNotice={setNotice} />

        ) : (

          <AuthPage

            key={view}

            view={view}

            onNavigate={navigate}

            onNotice={setNotice}

            onRegister={register}

            onLogin={view === 'admin-login' ? adminLogin : login}

            csrfToken={csrfToken}

          />

        )}

        <SiteFooter onNavigate={navigate} />

      </div>

      {routeLoading && <RouteLoadingOverlay destination={routeLoading} />}

      {notice && (

        <div className="toast" role="status">

          <span>ℹ</span>

          <p>{notice}</p>

          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification">×</button>

        </div>

      )}

    </div>

  );

}
