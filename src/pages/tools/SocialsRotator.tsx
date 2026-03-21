import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Copy, Check, ExternalLink, Plus, Trash2 } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types - exactly matching rotator.html's expected config format
// ---------------------------------------------------------------------------

type Effect = 'fade' | 'fadedownup' | 'slide' | 'slideup' | 'zoom' | 'flip' | 'spin3d';
type LogoSize = 'sm' | 'md' | 'lg';
type ShadowType = 'none' | 'glow' | 'custom';

interface RotatorConfig {
  platforms: { id: string; username: string }[];
  effect: Effect;
  font: string;
  size: number;
  color: string;
  shadowType: ShadowType;
  shadowOpts: { color: string; blur: number; x: number; y: number; glowSize: number; glowStrength: number } | null;
  logoSize: LogoSize;
  duration: number;
  popupMode: boolean;
  popupInterval: number; // minutes
  useLogo: boolean;
  textStyle: 'normal';  // kept for rotator.html compat; 3D removed from UI
  text3dDepth: number;
  text3dAngle: number;
  matchLogoColor: boolean;
  transitionDuration: number; // ms per animation phase (exit + enter each use this)
}

// ---------------------------------------------------------------------------
// Platform data
// ---------------------------------------------------------------------------

const PLATFORM_COLORS: Record<string, string> = {
  twitch: '#9147ff', youtube: '#FF0000', kick: '#53fc18',
  tiktok: '#fe2c55', instagram: '#E1306C', twitter: '#e7e9ea',
  discord: '#5865F2', facebook: '#1877F2', bluesky: '#0085ff',
  snapchat: '#FFFC00', cashapp: '#00D632', paypal: '#003087',
};

// simpleicons.org slug overrides (where id != slug)
const SIMPLEICONS_SLUG: Record<string, string> = {
  twitter: 'x',
};
function siSlug(id: string): string {
  return SIMPLEICONS_SLUG[id] ?? id;
}

const PLATFORM_SVG_INNER: Record<string, string> = {
  twitch:    `<path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>`,
  youtube:   `<path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/>`,
  kick:      `<path d="M4 2h3.5v7.5L14.5 2H19l-7.5 8.5L19.5 22H15l-7.5-9V22H4V2z"/>`,
  discord:   `<path fill-rule="evenodd" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>`,
  twitter:   `<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>`,
  instagram: `<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>`,
  tiktok:    `<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>`,
  bluesky:   `<path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/>`,
  facebook:  `<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>`,
  snapchat:  `<path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.317 4.788-.03.582-.056 1.13-.064 1.582.291.156.883.382 1.718.27.301-.04.59.195.59.493 0 .528-.682.977-1.508 1.124-.143.027-.236.08-.281.142.173.316.64.74 1.573.779.307.012.572.293.568.597-.01.718-.783 1.223-1.91 1.502.093.184.15.385.15.597 0 .76-.583 1.352-1.35 1.464-.57.082-1.162-.068-1.672-.355-.27-.154-.56-.245-.85-.245-.347 0-.701.107-1.028.326-1.187.784-2.174 1.19-2.936 1.207-.06.002-.12.003-.18.003-.76 0-1.748-.406-2.936-1.21-.327-.22-.68-.326-1.03-.326-.286 0-.576.09-.845.245-.51.288-1.103.437-1.672.355-.767-.112-1.35-.705-1.35-1.464 0-.212.057-.413.15-.597C2.94 14.6 2.168 14.096 2.158 13.378c-.004-.304.261-.585.568-.597.933-.04 1.4-.463 1.573-.78-.045-.06-.138-.114-.281-.14-.826-.148-1.508-.597-1.508-1.125 0-.298.289-.532.59-.492.835.112 1.427-.114 1.718-.27-.008-.452-.034-1-.064-1.582-.087-1.569-.212-3.595.317-4.788C6.258 1.07 9.615.793 10.605.793z"/>`,
  cashapp:   `<rect width="24" height="24" rx="5" fill="currentColor"/><path fill="#fff" d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>`,
  paypal:    `<path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z"/>`,
};

const PLATFORMS = [
  { id: 'twitch',    name: 'Twitch',      color: '#9147ff' },
  { id: 'kick',      name: 'Kick',        color: '#53fc18' },
  { id: 'youtube',   name: 'YouTube',     color: '#FF0000' },
  { id: 'discord',   name: 'Discord',     color: '#5865F2' },
  { id: 'twitter',   name: 'X (Twitter)', color: '#e7e9ea' },
  { id: 'instagram', name: 'Instagram',   color: '#E1306C' },
  { id: 'tiktok',    name: 'TikTok',      color: '#fe2c55' },
  { id: 'bluesky',   name: 'Bluesky',     color: '#0085ff' },
  { id: 'facebook',  name: 'Facebook',    color: '#1877F2' },
  { id: 'snapchat',  name: 'Snapchat',    color: '#FFFC00' },
  { id: 'cashapp',   name: 'Cash App',    color: '#00D632' },
  { id: 'paypal',    name: 'PayPal',      color: '#003087' },
];

const DEMO_PLATFORMS = [
  { id: 'twitch',  username: '@YourUsername' },
  { id: 'youtube', username: '@YourUsername' },
  { id: 'discord', username: '@YourUsername' },
  { id: 'tiktok',  username: '@YourUsername' },
];

const FONTS = [
  'Outfit', 'Poppins', 'Space Grotesk', 'Inter', 'Montserrat',
  'Oswald', 'Orbitron', 'Kanit', 'Teko', 'Quicksand', 'Barlow',
];

const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'fade',       label: 'Fade' },
  { value: 'fadedownup', label: 'Fade \u2193/\u2191' },
  { value: 'slide',      label: 'Slide' },
  { value: 'slideup',    label: 'Slide Up' },
  { value: 'zoom',       label: 'Zoom' },
  { value: 'flip',       label: 'Flip' },
  { value: 'spin3d',     label: '3D Spin' },
];

const LOGO_SIZES: { value: LogoSize; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const LOGO_SIZE_PX: Record<LogoSize, number> = { sm: 28, md: 40, lg: 56 };

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CFG: RotatorConfig = {
  platforms: [],
  effect: 'fade',
  font: 'Poppins',
  size: 22,
  color: '#ffffff',
  shadowType: 'glow',
  shadowOpts: { color: '#000000', blur: 8, x: 2, y: 2, glowSize: 18, glowStrength: 70 },
  logoSize: 'md',
  duration: 5,
  popupMode: false,
  popupInterval: 10,
  useLogo: false,
  textStyle: 'normal',
  text3dDepth: 4,
  text3dAngle: 45,
  matchLogoColor: false,
  transitionDuration: 350,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeConfig(cfg: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

function buildUrl(cfg: RotatorConfig): string {
  return `/tools/socials-rotator/rotator.html?c=${encodeConfig(cfg)}`;
}

// ---------------------------------------------------------------------------
// Platform SVG component
// ---------------------------------------------------------------------------

function PlatformIcon({ id, size, color }: { id: string; size: number; color?: string }) {
  const inner = PLATFORM_SVG_INNER[id] ?? '';
  return (
    <span
      style={{ display: 'flex', width: size, height: size, flexShrink: 0, color }}
      dangerouslySetInnerHTML={{
        __html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Official branded logo SVGs
// For most platforms the simpleicons CDN (flat colour) is close enough.
// Instagram's actual brand mark is a gradient square — we embed it directly.
// ---------------------------------------------------------------------------

const INSTAGRAM_OFFICIAL_SVG = (size: number) => `
  <svg viewBox="0 0 50 50" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="rp-ig" cx="30%" cy="107%" r="150%">
        <stop offset="0%"   stop-color="#fdf497"/>
        <stop offset="5%"   stop-color="#fdf497"/>
        <stop offset="45%"  stop-color="#fd5949"/>
        <stop offset="60%"  stop-color="#d6249f"/>
        <stop offset="90%"  stop-color="#285AEB"/>
      </radialGradient>
    </defs>
    <rect width="50" height="50" rx="12" fill="url(#rp-ig)"/>
    <rect x="11" y="11" width="28" height="28" rx="7"
          fill="none" stroke="white" stroke-width="2.8"/>
    <circle cx="25" cy="25" r="7.5"
            fill="none" stroke="white" stroke-width="2.8"/>
    <circle cx="35.5" cy="14.5" r="2.5" fill="white"/>
  </svg>`;

function OfficialLogo({ id, size }: { id: string; size: number }) {
  // Instagram: use inline gradient SVG — the simpleicons version is indistinguishable
  // from the flat icon, but the real Instagram logo has a colour gradient background.
  if (id === 'instagram') {
    return (
      <span
        style={{ display: 'flex', flexShrink: 0, width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: INSTAGRAM_OFFICIAL_SVG(size) }}
      />
    );
  }
  // All other platforms: simpleicons CDN (properly coloured flat logo)
  return (
    <img
      src={`https://cdn.simpleicons.org/${siSlug(id)}`}
      width={size}
      height={size}
      alt={id}
      style={{ flexShrink: 0 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Font loader
// ---------------------------------------------------------------------------

function loadGoogleFont(fontName: string) {
  const slug = fontName.replace(/\s+/g, '+');
  const linkId = `gfont-${slug}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${slug}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
  }
}

// ---------------------------------------------------------------------------
// 4-phase CSS transition system for preview
//
// Phase flow:  showing → exiting → entering-ready → entering → showing
//
//  showing        : element fully visible, no transition active
//  exiting        : element animates to its exit position (opacity→0, transform→exit-end)
//  entering-ready : content swaps; element SNAPS (no transition) to entry START position
//                   so it's invisible and in the right starting spot for the entry anim
//  entering       : element transitions from entry start → final position (opacity→1, transform→none)
//
// This matches rotator.html's behaviour: content exits first, then new content enters.
// ---------------------------------------------------------------------------

type TransPhase = 'showing' | 'exiting' | 'entering-ready' | 'entering';

// Exit end positions (where element ends up after exit)
const EXIT_TRANSFORM: Record<Effect, string> = {
  fade:       'none',
  fadedownup: 'translateY(-14px)',
  slide:      'translateX(-28px)',
  slideup:    'translateY(-28px)',
  zoom:       'scale(0.55)',
  flip:       'perspective(500px) rotateY(75deg)',
  spin3d:     'perspective(500px) rotateY(180deg)',
};

// Entry start positions (where new element appears before animating in)
const ENTRY_START: Record<Effect, string> = {
  fade:       'none',
  fadedownup: 'translateY(-14px)', // starts above, drops DOWN — mirrors exit going UP
  slide:      'translateX(28px)',
  slideup:    'translateY(28px)',
  zoom:       'scale(0.55)',
  flip:       'perspective(500px) rotateY(-75deg)',
  spin3d:     'perspective(500px) rotateY(-180deg)',
};

function getPhaseStyle(phase: TransPhase, effect: Effect, dur: number): React.CSSProperties {
  const exitT  = `opacity ${dur}ms ease-in, transform ${dur}ms ease-in`;
  const enterT = `opacity ${dur}ms ease-out, transform ${dur}ms ease-out`;

  switch (phase) {
    case 'showing':
      return { opacity: 1, transform: 'none' };
    case 'exiting':
      return { opacity: 0, transform: EXIT_TRANSFORM[effect], transition: exitT };
    case 'entering-ready':
      return { opacity: 0, transform: ENTRY_START[effect] };
    case 'entering':
      return { opacity: 1, transform: 'none', transition: enterT };
  }
}

// ---------------------------------------------------------------------------
// Live Preview component
// ---------------------------------------------------------------------------

function RotatorPreview({
  cfg,
  forceDemo,
  pinnedId,
}: {
  cfg: RotatorConfig;
  forceDemo?: boolean;
  pinnedId?: string | null;
}) {
  const display = (forceDemo || cfg.platforms.length === 0) ? DEMO_PLATFORMS : cfg.platforms;

  const [phase, setPhase]       = useState<TransPhase>('showing');
  const [shownIdx, setShownIdx] = useState(0);
  const phaseRef      = useRef<TransPhase>('showing');
  const currentIdxRef = useRef(0);
  const effectRef     = useRef(cfg.effect);
  const durRef        = useRef(cfg.transitionDuration ?? 350);

  useEffect(() => { effectRef.current = cfg.effect; }, [cfg.effect]);
  useEffect(() => { durRef.current = cfg.transitionDuration ?? 350; }, [cfg.transitionDuration]);
  useEffect(() => { loadGoogleFont(cfg.font); }, [cfg.font]);

  // Perform a full exit → swap → enter transition to nextIdx
  const doTransition = useCallback((nextIdx: number) => {
    if (phaseRef.current !== 'showing') return;
    const dur = durRef.current;

    phaseRef.current = 'exiting';
    setPhase('exiting');

    setTimeout(() => {
      currentIdxRef.current = nextIdx;
      phaseRef.current = 'entering-ready';
      setShownIdx(nextIdx);
      setPhase('entering-ready');

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          phaseRef.current = 'entering';
          setPhase('entering');

          setTimeout(() => {
            phaseRef.current = 'showing';
            setPhase('showing');
          }, dur);
        });
      });
    }, dur);
  }, []);

  // Auto-cycle when not pinned
  useEffect(() => {
    if (pinnedId || display.length <= 1) return;
    const transDur = cfg.transitionDuration ?? 350;
    const ms = Math.max((cfg.duration || 5) * 1000, transDur * 2 + 600);
    const t = setInterval(() => {
      doTransition((currentIdxRef.current + 1) % display.length);
    }, ms);
    return () => clearInterval(t);
  }, [display.length, cfg.duration, cfg.transitionDuration, pinnedId, doTransition]);

  // When pinned platform changes, transition to it
  const prevPinnedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevPinnedRef.current === pinnedId) return;
    prevPinnedRef.current = pinnedId;
    if (!pinnedId) return;
    const idx = display.findIndex((p) => p.id === pinnedId);
    if (idx >= 0) doTransition(idx);
  }, [pinnedId, display, doTransition]);

  // Reset when platform list changes
  const displayKey = display.map((p) => p.id).join(',');
  useEffect(() => {
    currentIdxRef.current = 0;
    phaseRef.current = 'showing';
    setShownIdx(0);
    setPhase('showing');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayKey]);

  const current = display[shownIdx] ?? display[0];
  if (!current) return null;

  const pColor    = PLATFORM_COLORS[current.id] ?? '#ffffff';
  const logoPx    = LOGO_SIZE_PX[cfg.logoSize] ?? 40;
  const textColor = cfg.matchLogoColor ? pColor : cfg.color;

  const opts = cfg.shadowOpts ?? { color: '#000000', blur: 8, x: 2, y: 2, glowSize: 18, glowStrength: 70 };
  const glowInnerA = Math.round((opts.glowStrength / 100) * 255).toString(16).padStart(2, '0');
  const glowOuterA = Math.round((opts.glowStrength / 100) * 0.45 * 255).toString(16).padStart(2, '0');
  const textFilter =
    cfg.shadowType === 'glow'     ? `drop-shadow(0 0 ${opts.glowSize}px ${pColor}${glowInnerA}) drop-shadow(0 0 ${Math.round(opts.glowSize * 1.9)}px ${pColor}${glowOuterA})`
    : cfg.shadowType === 'custom' ? `drop-shadow(${opts.x}px ${opts.y}px ${opts.blur}px ${opts.color})`
    :                               'none';

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '8px' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          maxWidth: '100%',
          minWidth: 0,
          ...getPhaseStyle(phase, cfg.effect, cfg.transitionDuration ?? 350),
        }}
      >
        <div style={{ filter: `drop-shadow(0 0 6px ${pColor}70)`, flexShrink: 0 }}>
          {cfg.useLogo
            ? <OfficialLogo id={current.id} size={logoPx} />
            : <div style={{ color: pColor }}><PlatformIcon id={current.id} size={logoPx} color={pColor} /></div>
          }
        </div>
        <span
          style={{
            fontFamily: `'${cfg.font}', sans-serif`,
            fontSize: `${cfg.size}px`,
            fontWeight: 600,
            color: textColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            filter: textFilter !== 'none' ? textFilter : undefined,
          }}
        >
          {current.username || '@YourUsername'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-7 h-7 rounded-full bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 text-xs font-bold flex-shrink-0">
        {n}
      </div>
      <span className="text-xs font-bold tracking-widest text-pink-400 uppercase">{label}</span>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-pink-500' : 'bg-white/10'}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${on ? 'left-5' : 'left-1'}`} />
    </button>
  );
}

function ChipRow<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            value === o.value
              ? 'border-pink-500/60 bg-pink-500/15 text-pink-300'
              : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20 hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SocialsRotator() {
  const [step, setStep] = useState(1);
  const [cfg, setCfg] = useState<RotatorConfig>(DEFAULT_CFG);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewBg, setPreviewBg] = useState<'checker' | string>('checker');
  const [activeId, setActiveId] = useState<string | null>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep cfg.platforms in sync with selected set (preserve usernames)
  useEffect(() => {
    setCfg((prev) => {
      const existing = new Map(prev.platforms.map((p) => [p.id, p.username]));
      return {
        ...prev,
        platforms: Array.from(selected).map((id) => ({
          id,
          username: existing.get(id) ?? '',
        })),
      };
    });
  }, [selected]);

  const togglePlatform = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setUsername = useCallback((id: string, username: string) => {
    setCfg((prev) => ({
      ...prev,
      platforms: prev.platforms.map((p) => (p.id === id ? { ...p, username } : p)),
    }));
  }, []);

  const set = useCallback(<K extends keyof RotatorConfig>(key: K, val: RotatorConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: val }));
  }, []);

  const setShadowOpt = useCallback((key: keyof NonNullable<RotatorConfig['shadowOpts']>, val: string | number) => {
    setCfg((prev) => ({
      ...prev,
      shadowOpts: { ...(prev.shadowOpts ?? { color: '#000000', blur: 8, x: 2, y: 2, glowSize: 18, glowStrength: 70 }), [key]: val },
    }));
  }, []);

  const handleFocus = useCallback((id: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setActiveId(id);
  }, []);

  const handleBlur = useCallback(() => {
    blurTimer.current = setTimeout(() => setActiveId(null), 120);
  }, []);

  const handleGenerate = useCallback(() => {
    setGeneratedUrl(buildUrl(cfg));
    setStep(5);
  }, [cfg]);

  const handleCopy = useCallback(() => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(`${window.location.origin}${generatedUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedUrl]);

  const canStep2 = selected.size > 0;
  const canStep3 = cfg.platforms.every((p) => p.username.trim() !== '');

  // Total one-cycle duration in seconds (for popup timing description)
  const cycleTotalSec = cfg.platforms.length * cfg.duration;

  const STEP_LABELS: Record<number, string> = {
    1: 'Select Platforms', 2: 'Usernames', 3: 'Appearance', 4: 'Popup Timing', 5: 'Generate',
  };

  const StepBar = () => (
    <div className="flex items-center gap-2 mb-8">
      {[1, 2, 3, 4, 5].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <button
            onClick={() => s < step && setStep(s)}
            className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
              s === step
                ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30'
                : s < step
                ? 'bg-pink-500/30 text-pink-400 cursor-pointer hover:bg-pink-500/50'
                : 'bg-white/5 text-gray-600 cursor-default'
            }`}
          >
            {s}
          </button>
          {s < 5 && <div className={`h-px w-8 transition-colors ${s < step ? 'bg-pink-500/40' : 'bg-white/8'}`} />}
        </div>
      ))}
      <span className="text-gray-500 text-xs ml-2">{STEP_LABELS[step]}</span>
    </div>
  );

  const previewPinnedId = step === 2 ? activeId : null;

  return (
    <PageLayout title="Socials Rotator | TrueBeast Tools" gradientVariant="purple">
      <section className="py-20 sm:py-28">
        <div className="max-w-[72rem] mx-auto px-4 sm:px-6">

          <Link to="/tools" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10">
            <ArrowLeft size={14} />
            Back to Tools
          </Link>

          <div className="text-center mb-14 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <RefreshCw size={16} className="text-pink-400" />
              <span className="text-sm text-gray-300 font-medium">OBS Overlay</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">Socials Rotator</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Build a free, animated OBS overlay that cycles through your social media handles.
              No sign-up required.
            </p>
          </div>

          <StepBar />

          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">

              {/* Step 1: Select Platforms */}
              {step === 1 && (
                <div className="glass rounded-2xl p-6">
                  <StepLabel n={1} label="Select Platforms" />
                  <p className="text-gray-400 text-sm mb-5">
                    Choose the platforms you want your overlay to cycle through.
                    The preview on the right shows what a finished overlay looks like.
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-6">
                    {PLATFORMS.map((p) => {
                      const isSelected = selected.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => togglePlatform(p.id)}
                          className={`rounded-xl p-3 border text-center transition-all flex flex-col items-center gap-2 ${
                            isSelected
                              ? 'border-pink-500/50 bg-pink-500/10 shadow-lg'
                              : 'border-white/8 bg-white/3 hover:border-white/20'
                          }`}
                        >
                          <div style={{ color: p.color }}>
                            <PlatformIcon id={p.id} size={28} color={p.color} />
                          </div>
                          <span className="text-xs text-gray-300 font-medium leading-tight">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {!canStep2 && (
                    <p className="text-gray-500 text-sm mb-4">Select at least one platform to continue.</p>
                  )}
                  <button
                    onClick={() => canStep2 && setStep(2)}
                    disabled={!canStep2}
                    className="w-full glass-strong rounded-xl px-6 py-3.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continue ({selected.size} selected)
                  </button>
                </div>
              )}

              {/* Step 2: Usernames */}
              {step === 2 && (
                <div className="glass rounded-2xl p-6">
                  <StepLabel n={2} label="Enter Your Handles" />
                  <p className="text-gray-400 text-sm mb-5">
                    Click into any field and the preview will show that platform live.
                  </p>
                  <div className="flex flex-col gap-3 mb-6">
                    {cfg.platforms.map((p) => {
                      const meta = PLATFORMS.find((pl) => pl.id === p.id);
                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          <div style={{ color: meta?.color }} className="flex-shrink-0">
                            <PlatformIcon id={p.id} size={24} color={meta?.color} />
                          </div>
                          <input
                            type="text"
                            value={p.username}
                            onChange={(e) => setUsername(p.id, e.target.value)}
                            onFocus={() => handleFocus(p.id)}
                            onBlur={handleBlur}
                            placeholder={`@${meta?.name ?? p.id} username or URL`}
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-pink-500/50 transition-colors"
                          />
                          <button
                            onClick={() => togglePlatform(p.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(1)} className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors">
                      Back
                    </button>
                    <button
                      onClick={() => canStep3 && setStep(3)}
                      disabled={!canStep3}
                      className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Appearance */}
              {step === 3 && (
                <div className="glass rounded-2xl p-6">
                  <StepLabel n={3} label="Customize Appearance" />

                  <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">

                    <div className="sm:col-span-2">
                      <label className="text-gray-300 text-sm font-medium block mb-2">Transition Effect</label>
                      <ChipRow options={EFFECTS} value={cfg.effect} onChange={(v) => set('effect', v)} />
                    </div>

                    <div className="sm:col-span-2">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-gray-300 text-sm font-medium">Animation Speed</label>
                        <span className="text-pink-400 text-sm font-mono">
                          {cfg.transitionDuration <= 150 ? 'Very Fast'
                            : cfg.transitionDuration <= 280 ? 'Fast'
                            : cfg.transitionDuration <= 420 ? 'Normal'
                            : cfg.transitionDuration <= 600 ? 'Slow'
                            : 'Very Slow'}
                          {' '}
                          <span className="text-gray-500 text-xs">({cfg.transitionDuration}ms)</span>
                        </span>
                      </div>
                      <input type="range" min={100} max={900} step={50}
                        value={cfg.transitionDuration}
                        onChange={(e) => set('transitionDuration', Number(e.target.value))}
                        className="w-full accent-pink-500" />
                      <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                        <span>Faster</span>
                        <span>Slower</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Logo Size</label>
                      <ChipRow options={LOGO_SIZES} value={cfg.logoSize} onChange={(v) => set('logoSize', v)} />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-gray-300 text-sm font-medium">Text Size</label>
                        <span className="text-pink-400 text-sm font-mono">{cfg.size}px</span>
                      </div>
                      <input type="range" min={14} max={48} step={2} value={cfg.size}
                        onChange={(e) => set('size', Number(e.target.value))}
                        className="w-full accent-pink-500" />
                    </div>

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Font</label>
                      <select
                        value={cfg.font}
                        onChange={(e) => set('font', e.target.value)}
                        className="w-full bg-[#0c0c18] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
                      >
                        {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-gray-300 text-sm font-medium">Time Per Platform</label>
                        <span className="text-pink-400 text-sm font-mono">{cfg.duration}s</span>
                      </div>
                      <input type="range" min={2} max={20} value={cfg.duration}
                        onChange={(e) => set('duration', Number(e.target.value))}
                        className="w-full accent-pink-500" />
                    </div>

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Text Color</label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => colorRef.current?.click()}
                          disabled={cfg.matchLogoColor}
                          className="w-10 h-10 rounded-xl border-2 border-white/20 flex-shrink-0 transition-transform hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: cfg.matchLogoColor ? 'linear-gradient(135deg,#9147ff,#ff0000,#53fc18)' : cfg.color }}
                        />
                        <input ref={colorRef} type="color" value={cfg.color}
                          onChange={(e) => set('color', e.target.value)} className="sr-only" />
                        {cfg.matchLogoColor ? (
                          <span className="text-gray-400 text-xs">Matching logo color</span>
                        ) : (
                          <>
                            <span className="text-gray-400 text-sm font-mono">{cfg.color.toUpperCase()}</span>
                            <button onClick={() => set('color', '#ffffff')} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
                              Reset
                            </button>
                          </>
                        )}
                      </div>
                      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={cfg.matchLogoColor}
                          onChange={(e) => set('matchLogoColor', e.target.checked)}
                          className="accent-pink-500 w-4 h-4"
                        />
                        <span className="text-gray-400 text-xs">Match text color to platform logo</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Drop Shadow</label>
                      <ChipRow
                        options={[
                          { value: 'none' as ShadowType, label: 'None' },
                          { value: 'glow' as ShadowType, label: 'Glow' },
                          { value: 'custom' as ShadowType, label: 'Custom' },
                        ]}
                        value={cfg.shadowType}
                        onChange={(v) => set('shadowType', v)}
                      />
                    </div>

                    {cfg.shadowType === 'glow' && (
                      <div className="sm:col-span-2 glass rounded-xl p-4 grid grid-cols-2 gap-4">
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="text-gray-400 text-xs font-medium">Glow Size</label>
                            <span className="text-pink-400 text-xs font-mono">{cfg.shadowOpts?.glowSize ?? 18}px</span>
                          </div>
                          <input type="range" min={4} max={60} step={1}
                            value={cfg.shadowOpts?.glowSize ?? 18}
                            onChange={(e) => setShadowOpt('glowSize', Number(e.target.value))}
                            className="w-full accent-pink-500" />
                          <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                            <span>Tight</span><span>Wide</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="text-gray-400 text-xs font-medium">Strength</label>
                            <span className="text-pink-400 text-xs font-mono">{cfg.shadowOpts?.glowStrength ?? 70}%</span>
                          </div>
                          <input type="range" min={10} max={100} step={5}
                            value={cfg.shadowOpts?.glowStrength ?? 70}
                            onChange={(e) => setShadowOpt('glowStrength', Number(e.target.value))}
                            className="w-full accent-pink-500" />
                          <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                            <span>Subtle</span><span>Intense</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {cfg.shadowType === 'custom' && (
                      <div className="sm:col-span-2 glass rounded-xl p-4 flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                          <div>
                            <label className="text-gray-400 text-xs font-medium block mb-1.5">Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={cfg.shadowOpts?.color ?? '#000000'}
                                onChange={(e) => setShadowOpt('color', e.target.value)}
                                className="w-9 h-9 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                              />
                              <span className="text-gray-400 text-xs font-mono">
                                {(cfg.shadowOpts?.color ?? '#000000').toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-gray-400 text-xs font-medium">Blur</label>
                              <span className="text-pink-400 text-xs font-mono">{cfg.shadowOpts?.blur ?? 8}px</span>
                            </div>
                            <input type="range" min={0} max={40} step={1}
                              value={cfg.shadowOpts?.blur ?? 8}
                              onChange={(e) => setShadowOpt('blur', Number(e.target.value))}
                              className="w-full accent-pink-500" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-gray-400 text-xs font-medium">X Offset</label>
                              <span className="text-pink-400 text-xs font-mono">{cfg.shadowOpts?.x ?? 2}px</span>
                            </div>
                            <input type="range" min={-20} max={20} step={1}
                              value={cfg.shadowOpts?.x ?? 2}
                              onChange={(e) => setShadowOpt('x', Number(e.target.value))}
                              className="w-full accent-pink-500" />
                          </div>
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-gray-400 text-xs font-medium">Y Offset</label>
                              <span className="text-pink-400 text-xs font-mono">{cfg.shadowOpts?.y ?? 2}px</span>
                            </div>
                            <input type="range" min={-20} max={20} step={1}
                              value={cfg.shadowOpts?.y ?? 2}
                              onChange={(e) => setShadowOpt('y', Number(e.target.value))}
                              className="w-full accent-pink-500" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Logo Style</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => set('useLogo', false)}
                          className={`flex-1 rounded-xl py-2 text-xs font-semibold border transition-all ${
                            !cfg.useLogo ? 'border-pink-500/60 bg-pink-500/15 text-pink-300' : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          Icon (SVG)
                        </button>
                        <button
                          onClick={() => set('useLogo', true)}
                          className={`flex-1 rounded-xl py-2 text-xs font-semibold border transition-all ${
                            cfg.useLogo ? 'border-pink-500/60 bg-pink-500/15 text-pink-300' : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          Official Logo
                        </button>
                      </div>
                    </div>

                  </div>

                  <div className="flex gap-3 mt-6">
                    <button onClick={() => setStep(2)} className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors">
                      Back
                    </button>
                    <button
                      onClick={() => setStep(4)}
                      className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Popup Timing */}
              {step === 4 && (
                <div className="glass rounded-2xl p-6">
                  <StepLabel n={4} label="Popup Timing" />
                  <p className="text-gray-400 text-sm mb-6">
                    By default the overlay is always visible. Enable Popup Mode to have it appear
                    for one full cycle, then hide until the next interval.
                  </p>

                  {/* Popup mode toggle */}
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <div className="text-white font-medium text-sm">Popup Mode</div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {cfg.popupMode ? 'Overlay hides between cycles' : 'Overlay is always visible'}
                      </div>
                    </div>
                    <Toggle on={cfg.popupMode} onChange={(v) => set('popupMode', v)} />
                  </div>

                  {/* Interval slider — only shown when popup mode is on */}
                  {cfg.popupMode && (
                    <div className="glass rounded-xl p-5">
                      <div className="mb-4">
                        <span className="text-gray-300 text-sm">Show every </span>
                        <span className="text-pink-400 font-bold font-mono">{cfg.popupInterval}</span>
                        <span className="text-pink-400 font-bold"> {cfg.popupInterval === 1 ? 'minute' : 'minutes'}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={60}
                        value={cfg.popupInterval}
                        onChange={(e) => set('popupInterval', Number(e.target.value))}
                        className="w-full accent-pink-500 mb-2"
                      />
                      <div className="flex justify-between text-[11px] text-gray-600 mb-4">
                        <span>1 min</span>
                        <span>60 min</span>
                      </div>
                      <p className="text-gray-400 text-xs leading-relaxed">
                        The overlay will wait{' '}
                        <strong className="text-gray-200">{cfg.popupInterval} min</strong>, show all{' '}
                        <strong className="text-gray-200">{cfg.platforms.length}</strong> platform{cfg.platforms.length !== 1 ? 's' : ''} once{' '}
                        (<strong className="text-gray-200">{cycleTotalSec}s</strong>), then hide and repeat.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-3 mt-6">
                    <button onClick={() => setStep(3)} className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors">
                      Back
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all"
                    >
                      Generate URL
                    </button>
                  </div>
                </div>
              )}

              {/* Step 5: Generated URL */}
              {step === 5 && generatedUrl && (
                <div className="glass rounded-2xl p-6">
                  <StepLabel n={5} label="Your Overlay URL" />

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 font-mono text-xs text-gray-400 break-all leading-relaxed mb-4">
                    {window.location.origin}{generatedUrl}
                  </div>

                  <div className="flex gap-3 mb-5">
                    <button
                      onClick={handleCopy}
                      className="flex-1 glass-strong rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 text-sm font-medium text-white transition-colors"
                    >
                      {copied ? <><Check size={15} className="text-green-400" />Copied!</> : <><Copy size={15} />Copy URL</>}
                    </button>
                    <a
                      href={generatedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass rounded-xl px-5 py-3 inline-flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    >
                      <ExternalLink size={15} />
                      Preview
                    </a>
                  </div>

                  <div className="glass rounded-xl p-4 text-sm text-gray-400 leading-relaxed mb-4">
                    <p className="font-semibold text-gray-300 mb-2">Adding to OBS</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>In OBS, click the <strong className="text-gray-200">+</strong> button in the Sources panel</li>
                      <li>Select <strong className="text-gray-200">Browser</strong></li>
                      <li>Paste the URL above and set Width/Height to match your stream layout</li>
                      <li>Check <strong className="text-gray-200">Shutdown source when not visible</strong> to save resources</li>
                    </ol>
                  </div>

                  <button
                    onClick={() => { setStep(1); setGeneratedUrl(''); setSelected(new Set()); setCfg(DEFAULT_CFG); }}
                    className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors inline-flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Start Over
                  </button>
                </div>
              )}

            </div>

            {/* Right: sticky preview */}
            <div className="lg:w-[340px] flex-shrink-0">
              <div className="glass rounded-2xl p-5 lg:sticky lg:top-28">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs font-bold tracking-widest text-pink-400 uppercase">
                    {step === 1 ? 'Example Preview' : 'Live Preview'}
                  </span>
                  {step === 1 && <span className="text-[10px] text-gray-500 font-medium">(demo)</span>}
                  {step === 2 && activeId && (
                    <span className="text-[10px] text-gray-500 font-medium capitalize">
                      — {PLATFORMS.find((p) => p.id === activeId)?.name}
                    </span>
                  )}
                </div>

                <div
                  className="rounded-xl mb-2"
                  style={{
                    ...(previewBg === 'checker' ? {
                      backgroundImage: 'linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                      backgroundColor: '#1a1a1a',
                    } : { background: previewBg }),
                    padding: '16px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    minHeight: 100,
                  }}
                >
                  <RotatorPreview cfg={cfg} forceDemo={step === 1} pinnedId={previewPinnedId} />
                </div>

                {/* Background swatches */}
                <div className="flex items-center gap-1.5 mb-4">
                  {([
                    { key: 'checker', bg: undefined, label: 'Transparent' },
                    { key: '#000000', bg: '#000000', label: 'Black' },
                    { key: '#1a1a2e', bg: '#1a1a2e', label: 'Dark' },
                    { key: '#0f3460', bg: '#0f3460', label: 'Navy' },
                    { key: '#2d2d2d', bg: '#2d2d2d', label: 'Grey' },
                    { key: '#ffffff', bg: '#ffffff', label: 'White' },
                    { key: '#16213e', bg: '#16213e', label: 'Midnight' },
                    { key: '#1a472a', bg: '#1a472a', label: 'Forest' },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      title={label}
                      onClick={() => setPreviewBg(key)}
                      className={`w-6 h-6 rounded-md border-2 transition-all flex-shrink-0 ${
                        previewBg === key ? 'border-pink-400 scale-110' : 'border-white/10 hover:border-white/30'
                      }`}
                      style={key === 'checker' ? {
                        backgroundImage: 'linear-gradient(45deg,#555 25%,transparent 25%),linear-gradient(-45deg,#555 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#555 75%),linear-gradient(-45deg,transparent 75%,#555 75%)',
                        backgroundSize: '6px 6px',
                        backgroundPosition: '0 0,0 3px,3px -3px,-3px 0',
                        backgroundColor: '#333',
                      } : { background: key }}
                    />
                  ))}
                </div>

                {step === 1 && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    This is an example of what your finished overlay looks like in OBS.
                    It cycles on a transparent background so it sits cleanly over your stream.
                  </p>
                )}
                {step === 2 && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    Click a field to preview that platform. It cycles when no field is active.
                  </p>
                )}
                {step === 3 && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    All changes apply instantly. Checkerboard = transparent in OBS.
                  </p>
                )}
                {step === 4 && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    {cfg.popupMode
                      ? `Overlay will appear every ${cfg.popupInterval} min, cycle through all platforms, then hide.`
                      : 'Overlay stays visible and cycles continuously.'}
                  </p>
                )}
                {step === 5 && (
                  <p className="text-gray-500 text-xs leading-relaxed">
                    Copy the URL and add it as a Browser Source in OBS.
                  </p>
                )}
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
