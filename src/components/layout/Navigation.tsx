import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Sun, Moon, ChevronDown, Youtube, Shield, LogOut, LogIn } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { DiscordIcon } from '@/components/shared/DiscordIcon';
import { useAuth } from '@/contexts/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  to?: string;
  href?: string;
  color?: string;
  icon?: React.ReactNode;
  dropdown?: DropdownItem[];
}

interface DropdownItem {
  label: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const DISCORD_URL = 'https://discord.gg/Nk8vekY';
const YOUTUBE_URL = 'https://www.youtube.com/@RealTrueBeast';

const homeDropdownItems: DropdownItem[] = [
  { label: 'About', to: '/#about' },
  { label: 'Content', to: '/#content' },
  { label: 'Discord', to: '/#discord' },
  { label: 'Connect', to: '/#connect' },
];

const techSupportDropdownItems: DropdownItem[] = [
  { label: 'Submit Ticket', to: '/tech-support' },
  { label: 'My Tickets', to: '/my-tickets' },
];

const navItems: NavItem[] = [
  {
    label: 'Home',
    to: '/',
    dropdown: homeDropdownItems,
  },
  { label: 'Giveaways', to: '/giveaways' },
  { label: 'Toolkit', to: '/tools' },
  {
    label: 'Tech Support',
    to: '/tech-support',
    dropdown: techSupportDropdownItems,
  },
  {
    label: 'Games',
    to: '/games',
    color: 'text-emerald-400 hover:text-emerald-300',
  },
  {
    label: 'Discord',
    href: DISCORD_URL,
    color: 'text-indigo-400 hover:text-indigo-300',
    icon: <DiscordIcon className="w-4 h-4" />,
  },
  {
    label: 'Subscribe',
    href: YOUTUBE_URL,
    color: 'text-red-400 hover:text-red-300',
    icon: <Youtube className="w-4 h-4" />,
  },
];

// ---------------------------------------------------------------------------
// Shared button classes
// ---------------------------------------------------------------------------

const btnBase =
  'border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 px-3.5 py-2 rounded-xl text-sm font-medium text-gray-200 hover:text-white transition-all';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Navigation() {
  const { isLight, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const { user, loading, login, logout } = useAuth();

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Login modal state
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const navRef = useRef<HTMLDivElement>(null);
  const dropdownTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ---- Scroll listener ----
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ---- Close mobile menu on route change ----
  useEffect(() => {
    setMobileOpen(false);
    setOpenDropdown(null);
  }, [location.pathname]);

  // ---- Close dropdown on outside click ----
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---- Dropdown hover helpers ----
  const openDropdownFor = useCallback((label: string) => {
    const existing = dropdownTimeouts.current.get(label);
    if (existing) clearTimeout(existing);
    setOpenDropdown(label);
  }, []);

  const closeDropdownFor = useCallback((label: string) => {
    const t = setTimeout(() => {
      setOpenDropdown((cur) => (cur === label ? null : cur));
    }, 150);
    dropdownTimeouts.current.set(label, t);
  }, []);

  // ---- Handle anchor links (scroll on homepage, navigate otherwise) ----
  const handleAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, to: string) => {
      const [path, hash] = to.split('#');
      if (location.pathname === (path || '/') && hash) {
        e.preventDefault();
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: 'smooth' });
        setOpenDropdown(null);
        setMobileOpen(false);
      }
    },
    [location.pathname],
  );

  // ---- Login / Logout ----
  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError('');
      setLoginLoading(true);
      try {
        await login(loginEmail, loginPassword);
        setShowLogin(false);
        setLoginEmail('');
        setLoginPassword('');
      } catch {
        setLoginError('Invalid email or password.');
      } finally {
        setLoginLoading(false);
      }
    },
    [login, loginEmail, loginPassword],
  );

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const openLoginModal = useCallback(() => {
    setLoginError('');
    setShowLogin(true);
  }, []);

  // ---- Render a single desktop nav item ----
  const renderNavLink = (item: NavItem) => {
    const colorClass = item.color ?? 'text-gray-200 hover:text-white';
    const classes = `${btnBase} ${colorClass} flex items-center gap-2`;

    if (item.href) {
      return (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
        >
          {item.icon}
          {item.label}
        </a>
      );
    }

    if (item.dropdown) {
      const isOpen = openDropdown === item.label;
      return (
        <div
          key={item.label}
          className="relative"
          onMouseEnter={() => openDropdownFor(item.label)}
          onMouseLeave={() => closeDropdownFor(item.label)}
        >
          <Link to={item.to!} className={`${classes} group`}>
            {item.label}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-300 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </Link>

          <div
            className={`nav-dropdown absolute left-0 top-full mt-2 min-w-[180px] rounded-xl shadow-2xl py-2 z-50 transition-all duration-200 origin-top ${
              isOpen
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
            {item.dropdown.map((sub) => (
              <Link
                key={sub.label}
                to={sub.to}
                onClick={(e) => handleAnchorClick(e as unknown as React.MouseEvent<HTMLAnchorElement>, sub.to)}
                className="block px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                {sub.label}
              </Link>
            ))}
          </div>
        </div>
      );
    }

    return (
      <Link key={item.label} to={item.to!} className={classes}>
        {item.icon}
        {item.label}
      </Link>
    );
  };

  // ---- Render a mobile nav item ----
  const renderMobileLink = (item: NavItem) => {
    const colorClass = item.color ?? 'text-gray-200 hover:text-white';
    const classes = `flex items-center gap-3 px-4 py-3 text-sm font-medium ${colorClass} hover:bg-white/5 rounded-xl transition-all`;

    if (item.href) {
      return (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
          onClick={() => setMobileOpen(false)}
        >
          {item.icon}
          {item.label}
        </a>
      );
    }

    return (
      <div key={item.label}>
        <Link
          to={item.to!}
          className={classes}
          onClick={() => setMobileOpen(false)}
        >
          {item.icon}
          {item.label}
        </Link>

        {item.dropdown?.map((sub) => (
          <Link
            key={sub.label}
            to={sub.to}
            onClick={(e) => {
              handleAnchorClick(e as unknown as React.MouseEvent<HTMLAnchorElement>, sub.to);
              setMobileOpen(false);
            }}
            className="block pl-10 pr-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            {sub.label}
          </Link>
        ))}
      </div>
    );
  };

  return (
    <>
      <nav
        ref={navRef}
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
          scrolled ? 'py-2' : 'py-4'
        }`}
      >
        <div className="max-w-[80rem] mx-auto px-4 sm:px-6">
          <div
            className={`glass rounded-2xl px-6 py-4 transition-all duration-500 ${scrolled ? 'shadow-2xl shadow-black/50' : ''}`}
            style={{ background: 'rgba(15, 15, 22, 0.38)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}
          >
            {/* ---- Main row: Logo | Center nav | Right controls ---- */}
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: 'auto 1fr auto' }}>

              {/* Col 1: Logo */}
              <Link to="/" onClick={() => { if (window.location.pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex items-center gap-3 group">
                <img
                  src="/assets/logos/logo.png"
                  alt="TrueBeast logo"
                  className="h-10 w-10 rounded-full object-contain transition-transform duration-300 group-hover:scale-110"
                />
                <span className="font-display text-xl font-bold tracking-tight text-white transition-colors group-hover:text-emerald-400">
                  TrueBeast
                </span>
              </Link>

              {/* Col 2: Centered desktop nav (collapses to nothing on mobile) */}
              <div className="hidden lg:flex items-center justify-center gap-2">
                {navItems.map(renderNavLink)}
              </div>

              {/* Col 3: Right controls (desktop auth + mobile hamburger) */}
              <div className="flex items-center gap-2 justify-end">
                {/* Desktop theme + auth */}
                <div className="hidden lg:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                    className={`${btnBase} p-2`}
                  >
                    {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </button>

                  {!loading && (
                    user ? (
                      <>
                        <Link
                          to="/admin"
                          className={`${btnBase} text-purple-400 hover:text-purple-300 flex items-center gap-2`}
                        >
                          <Shield className="w-4 h-4" />
                          Admin
                        </Link>
                        <button
                          type="button"
                          onClick={handleLogout}
                          className={`${btnBase} flex items-center gap-2`}
                          aria-label="Log out"
                        >
                          <LogOut className="w-4 h-4" />
                          Logout
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={openLoginModal}
                        className={`${btnBase} flex items-center gap-2`}
                      >
                        <LogIn className="w-4 h-4" />
                        Login
                      </button>
                    )
                  )}
                </div>

                {/* Mobile theme + hamburger */}
                <div className="flex items-center gap-2 lg:hidden">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                    className={`${btnBase} p-2`}
                  >
                    {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileOpen((o) => !o)}
                    aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                    className={`${btnBase} p-2`}
                  >
                    {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* ---- Mobile menu panel ---- */}
            <div
              className={`lg:hidden overflow-hidden transition-all duration-300 ${
                mobileOpen ? 'max-h-[80vh] opacity-100 mt-4 pt-4 border-t border-white/10' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="flex flex-col gap-1">
                {navItems.map(renderMobileLink)}

                {/* Auth in mobile menu */}
                <div className="border-t border-white/10 mt-2 pt-2">
                  {user ? (
                    <>
                      <Link
                        to="/admin"
                        className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-purple-400 hover:text-purple-300 hover:bg-white/5 rounded-xl transition-all"
                        onClick={() => setMobileOpen(false)}
                      >
                        <Shield className="w-4 h-4" />
                        Admin Panel
                      </Link>
                      <button
                        type="button"
                        onClick={() => { handleLogout(); setMobileOpen(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                      >
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { openLoginModal(); setMobileOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-200 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                    >
                      <LogIn className="w-4 h-4" />
                      Login
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* ---- Login Modal ---- */}
      {showLogin && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setShowLogin(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative rounded-2xl p-8 w-full max-w-sm border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'rgba(12, 12, 18, 0.95)', backdropFilter: 'blur(32px)' }}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-400" />
                <h2 className="text-white font-semibold text-lg">Admin Login</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowLogin(false)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                />
              </div>

              <div>
                <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                />
              </div>

              {loginError && (
                <p className="text-red-400 text-sm text-center">{loginError}</p>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-300 font-semibold rounded-xl py-3 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              >
                {loginLoading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
