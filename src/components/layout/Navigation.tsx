import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Sun, Moon, ChevronDown, Youtube } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { DiscordIcon } from '@/components/shared/DiscordIcon';

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

const navItems: NavItem[] = [
  {
    label: 'Home',
    to: '/',
    dropdown: homeDropdownItems,
  },
  { label: 'Giveaways', to: '/giveaways' },
  { label: 'Toolkit', to: '/tools' },
  { label: 'Tech Support', to: '/tech-support' },
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

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setDropdownOpen(false);
  }, [location.pathname]);

  // ---- Close dropdown on outside click ----
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---- Dropdown hover helpers ----
  const openDropdown = useCallback(() => {
    if (dropdownTimeout.current) clearTimeout(dropdownTimeout.current);
    setDropdownOpen(true);
  }, []);

  const closeDropdown = useCallback(() => {
    dropdownTimeout.current = setTimeout(() => setDropdownOpen(false), 150);
  }, []);

  // ---- Handle anchor links (scroll on homepage, navigate otherwise) ----
  const handleAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, to: string) => {
      const [path, hash] = to.split('#');
      if (location.pathname === (path || '/') && hash) {
        e.preventDefault();
        const el = document.getElementById(hash);
        el?.scrollIntoView({ behavior: 'smooth' });
        setDropdownOpen(false);
        setMobileOpen(false);
      }
    },
    [location.pathname],
  );

  // ---- Render a single nav item ----
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
      return (
        <div
          key={item.label}
          ref={dropdownRef}
          className="relative"
          onMouseEnter={openDropdown}
          onMouseLeave={closeDropdown}
        >
          <Link to={item.to!} className={`${classes} group`}>
            {item.label}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-300 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </Link>

          {/* Dropdown */}
          <div
            className={`nav-dropdown absolute left-0 top-full mt-2 min-w-[180px] rounded-xl shadow-2xl py-2 z-50 transition-all duration-200 origin-top ${
              dropdownOpen
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

        {/* Mobile sub-links */}
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
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? 'py-2' : 'py-4'
      }`}
    >
      <div className="max-w-[80rem] mx-auto px-4 sm:px-6">
        <div className={`glass rounded-2xl px-6 py-4 transition-all duration-500 ${scrolled ? 'shadow-2xl shadow-black/50' : ''}`}>
          <div className="flex items-center justify-between">
            {/* ---- Logo ---- */}
            <Link to="/" className="flex items-center gap-3 group flex-shrink-0">
              <img
                src="/assets/logos/logo.png"
                alt="TrueBeast logo"
                className="h-10 w-10 rounded-full object-contain transition-transform duration-300 group-hover:scale-110"
              />
              <span className="font-display text-xl font-bold tracking-tight text-white transition-colors group-hover:text-emerald-400">
                TrueBeast
              </span>
            </Link>

            {/* ---- Desktop nav ---- */}
            <div className="hidden lg:flex items-center gap-2">
              {navItems.map(renderNavLink)}

              {/* Theme toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className={`${btnBase} ml-1 p-2`}
              >
                {isLight ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* ---- Mobile controls ---- */}
            <div className="flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className={`${btnBase} p-2`}
              >
                {isLight ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                className={`${btnBase} p-2`}
              >
                {mobileOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
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
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
