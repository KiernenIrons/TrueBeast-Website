/**
 * TrueBeast -- Theme (light / dark mode) + Performance Mode
 * Runs synchronously before any rendering to avoid flash of wrong theme.
 * Checks localStorage first, then system preference. Defaults to dark.
 *
 * Performance mode automatically disables backdrop-filter and heavy animations
 * when sustained FPS drops below 28 (e.g. browser with hardware acceleration off).
 * The result is cached in localStorage so it applies before first paint on return visits.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeChangeDetail {
  light: boolean;
}

export interface TBThemeAPI {
  /** Toggle between light and dark. Returns the new "isLight" state. */
  toggle: () => boolean;
  /** Returns true when the current theme is light. */
  isLight: () => boolean;
}

export interface TBPerfAPI {
  /** Force performance mode on and cache the result. */
  enable: () => void;
  /** Force performance mode off and cache the result. */
  disable: () => void;
  /** Returns true when perf-mode is currently active. */
  isActive: () => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEME_KEY = 'tb-theme';
const PERF_KEY = 'tb-perf';
const LIGHT_CLASS = 'light';
const PERF_CLASS = 'perf-mode';
const THEME_EVENT = 'tb-theme-change';

// FPS thresholds
const FPS_SLOW_THRESHOLD = 28;
const FPS_FAST_THRESHOLD = 55;
const FPS_SAMPLE_DURATION_MS = 2000;
const FPS_SETTLE_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Sync initialization -- runs at module evaluation time so the correct
// classes are on <html> before the first paint.
// ---------------------------------------------------------------------------

const root: HTMLElement = document.documentElement;

// Theme
const stored: string | null = localStorage.getItem(THEME_KEY);
const prefersLight: boolean =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: light)').matches;
const initialIsLight: boolean = stored === 'light' || (!stored && prefersLight);

if (initialIsLight) {
  root.classList.add(LIGHT_CLASS);
}

// Performance -- apply cached result immediately.
const cachedPerf: string | null = localStorage.getItem(PERF_KEY);
if (cachedPerf === 'slow') {
  root.classList.add(PERF_CLASS);
}

// Respect OS "reduce motion" preference as an explicit opt-in.
if (
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  root.classList.add(PERF_CLASS);
}

// ---------------------------------------------------------------------------
// TBTheme
// ---------------------------------------------------------------------------

export const TBTheme: TBThemeAPI = {
  toggle(): boolean {
    const nowLight: boolean = root.classList.toggle(LIGHT_CLASS);
    localStorage.setItem(THEME_KEY, nowLight ? 'light' : 'dark');
    window.dispatchEvent(
      new CustomEvent<ThemeChangeDetail>(THEME_EVENT, {
        detail: { light: nowLight },
      }),
    );
    return nowLight;
  },

  isLight(): boolean {
    return root.classList.contains(LIGHT_CLASS);
  },
};

// ---------------------------------------------------------------------------
// TBPerf
// ---------------------------------------------------------------------------

export const TBPerf: TBPerfAPI = {
  enable(): void {
    root.classList.add(PERF_CLASS);
    localStorage.setItem(PERF_KEY, 'slow');
  },

  disable(): void {
    root.classList.remove(PERF_CLASS);
    localStorage.setItem(PERF_KEY, 'fast');
  },

  isActive(): boolean {
    return root.classList.contains(PERF_CLASS);
  },
};

// ---------------------------------------------------------------------------
// FPS detection -- runs after page load, same as the original IIFE.
// ---------------------------------------------------------------------------

function measureFps(): void {
  let t0: number | null = null;
  let frames = 0;

  function tick(ts: number): void {
    if (t0 === null) t0 = ts;
    frames++;

    if (ts - t0 < FPS_SAMPLE_DURATION_MS) {
      requestAnimationFrame(tick);
    } else {
      const fps: number = frames / ((ts - t0) / 1000);

      if (fps < FPS_SLOW_THRESHOLD) {
        root.classList.add(PERF_CLASS);
        localStorage.setItem(PERF_KEY, 'slow');
      } else if (fps >= FPS_FAST_THRESHOLD) {
        root.classList.remove(PERF_CLASS);
        localStorage.setItem(PERF_KEY, 'fast');
      }
      // Between 28-55 fps: keep whatever was set from localStorage, don't overwrite.
    }
  }

  requestAnimationFrame(tick);
}

window.addEventListener('load', () => {
  // Wait for Babel/React/fonts to finish their initial burst before measuring.
  setTimeout(measureFps, FPS_SETTLE_DELAY_MS);
});
