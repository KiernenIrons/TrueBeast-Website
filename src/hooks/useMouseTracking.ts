import { useEffect } from 'react';

const GLOW_ID = 'cursorGlow';
const GLOW_HALF = 150; // 300px / 2

/**
 * Attaches a passive mousemove listener that repositions the `#cursorGlow`
 * element to follow the cursor. Uses `translate` only (no left/top) to stay
 * on the compositor thread and avoid layout reflows.
 */
export function useMouseTracking(): void {
  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      const glow = document.getElementById(GLOW_ID);
      if (!glow) return;

      const x = e.clientX - GLOW_HALF;
      const y = e.clientY - GLOW_HALF;
      glow.style.transform = `translate(${x}px, ${y}px)`;
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);
}
