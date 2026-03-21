import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { TBTheme, type ThemeChangeDetail } from '../lib/theme';

// ---------------------------------------------------------------------------
// External store helpers for useSyncExternalStore
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  // Listen for the custom event dispatched by TBTheme.toggle()
  const handler = (): void => {
    listener();
  };
  window.addEventListener('tb-theme-change', handler);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('tb-theme-change', handler);
  };
}

function getSnapshot(): boolean {
  return TBTheme.isLight();
}

function getServerSnapshot(): boolean {
  // During SSR there is no DOM; default to dark (false).
  return false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseThemeReturn {
  /** true when the active theme is light */
  isLight: boolean;
  /** true when the active theme is dark (convenience inverse of isLight) */
  isDark: boolean;
  /** Toggle between light and dark */
  toggle: () => void;
}

/**
 * React hook that wraps TBTheme with reactive state.
 *
 * Components using this hook will re-render whenever the theme changes,
 * whether the change originated from this component, another component,
 * or an external call to TBTheme.toggle().
 */
export function useTheme(): UseThemeReturn {
  const isLight = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((): void => {
    TBTheme.toggle();
    // TBTheme.toggle() already dispatches the custom event which triggers
    // the subscription above, so React state will update automatically.
  }, []);

  return {
    isLight,
    isDark: !isLight,
    toggle,
  };
}
