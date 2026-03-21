import { useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GradientVariant = 'green' | 'purple' | 'blue' | 'gold';

interface GradientBackgroundProps {
  variant?: GradientVariant;
}

// ---------------------------------------------------------------------------
// Variant colour maps
// ---------------------------------------------------------------------------

interface VariantStyle { background: string; afterBackground: string }

const DARK_VARIANTS: Record<GradientVariant, VariantStyle> = {
  green: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(34,197,94,0.24) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(57,255,20,0.16) 0%, transparent 50%)',
      'radial-gradient(ellipse at 50% 50%, rgba(22,163,74,0.14) 0%, transparent 60%)',
      '#0b0b12',
    ].join(', '),
    afterBackground: [
      'radial-gradient(ellipse at 70% 30%, rgba(74,222,128,0.10) 0%, transparent 50%)',
      'radial-gradient(ellipse at 30% 80%, rgba(34,197,94,0.08) 0%, transparent 50%)',
    ].join(', '),
  },
  purple: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(139,92,246,0.24) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(167,139,250,0.16) 0%, transparent 50%)',
      'radial-gradient(ellipse at 50% 50%, rgba(109,40,217,0.14) 0%, transparent 60%)',
      '#0b0b12',
    ].join(', '),
    afterBackground: [
      'radial-gradient(ellipse at 70% 30%, rgba(196,181,253,0.10) 0%, transparent 50%)',
      'radial-gradient(ellipse at 30% 80%, rgba(139,92,246,0.08) 0%, transparent 50%)',
    ].join(', '),
  },
  blue: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(6,182,212,0.24) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(34,211,238,0.16) 0%, transparent 50%)',
      'radial-gradient(ellipse at 50% 50%, rgba(14,116,144,0.14) 0%, transparent 60%)',
      '#0b0b12',
    ].join(', '),
    afterBackground: [
      'radial-gradient(ellipse at 70% 30%, rgba(103,232,249,0.10) 0%, transparent 50%)',
      'radial-gradient(ellipse at 30% 80%, rgba(6,182,212,0.08) 0%, transparent 50%)',
    ].join(', '),
  },
  gold: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(34,197,94,0.20) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(234,179,8,0.18) 0%, transparent 50%)',
      'radial-gradient(ellipse at 50% 50%, rgba(202,138,4,0.14) 0%, transparent 60%)',
      '#0b0b12',
    ].join(', '),
    afterBackground: [
      'radial-gradient(ellipse at 70% 30%, rgba(250,204,21,0.10) 0%, transparent 50%)',
      'radial-gradient(ellipse at 30% 80%, rgba(34,197,94,0.08) 0%, transparent 50%)',
    ].join(', '),
  },
};

const LIGHT_VARIANTS: Record<GradientVariant, VariantStyle> = {
  green: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(34,197,94,0.08) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(22,163,74,0.06) 0%, transparent 50%)',
      'radial-gradient(ellipse at 50% 50%, rgba(74,222,128,0.05) 0%, transparent 60%)',
      '#f5f9f5',
    ].join(', '),
    afterBackground: [
      'radial-gradient(ellipse at 70% 30%, rgba(74,222,128,0.04) 0%, transparent 50%)',
      'radial-gradient(ellipse at 30% 80%, rgba(34,197,94,0.03) 0%, transparent 50%)',
    ].join(', '),
  },
  purple: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(139,92,246,0.08) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(167,139,250,0.06) 0%, transparent 50%)',
      '#f5f5fa',
    ].join(', '),
    afterBackground: 'transparent',
  },
  blue: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(6,182,212,0.08) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(34,211,238,0.06) 0%, transparent 50%)',
      '#f5f9fa',
    ].join(', '),
    afterBackground: 'transparent',
  },
  gold: {
    background: [
      'radial-gradient(ellipse at 15% 20%, rgba(34,197,94,0.06) 0%, transparent 55%)',
      'radial-gradient(ellipse at 85% 75%, rgba(234,179,8,0.06) 0%, transparent 50%)',
      '#f9f7f0',
    ].join(', '),
    afterBackground: 'transparent',
  },
};

// ---------------------------------------------------------------------------
// Inline noise SVG (tiny repeating texture, no external asset needed)
// ---------------------------------------------------------------------------

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GradientBackground({
  variant = 'green',
}: GradientBackgroundProps) {
  const { isLight } = useTheme();
  const styles = isLight ? LIGHT_VARIANTS[variant] : DARK_VARIANTS[variant];

  // ── Cursor glow tracking ────────────────────────────────────────────────
  useEffect(() => {
    const GLOW_HALF = 150;

    const onMouseMove = (e: MouseEvent): void => {
      const glow = document.getElementById('cursorGlow');
      if (!glow) return;
      glow.style.transform = `translate(${e.clientX - GLOW_HALF}px, ${e.clientY - GLOW_HALF}px)`;
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  return (
    <>
      {/* Animated gradient layer */}
      <div
        aria-hidden
        className="gradient-bg pointer-events-none"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -2,
          background: styles.background,
        }}
      >
        {/* ::after equivalent -- shifting overlay */}
        <div
          style={{
            position: 'absolute',
            inset: '-10%',
            background: styles.afterBackground,
            animation: 'gradient-shift 18s ease-in-out infinite',
          }}
        />
      </div>

      {/* Noise texture overlay */}
      <div
        aria-hidden
        className="pointer-events-none"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          opacity: 0.03,
          mixBlendMode: 'overlay',
          backgroundImage: NOISE_SVG,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* Cursor glow */}
      <div
        id="cursorGlow"
        aria-hidden
        className="pointer-events-none hidden md:block"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background:
            variant === 'green'
              ? 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)'
              : variant === 'purple'
                ? 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)'
                : variant === 'blue'
                  ? 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)'
                  : 'radial-gradient(circle, rgba(234,179,8,0.12) 0%, transparent 70%)',
          zIndex: 50,
          willChange: 'transform',
        }}
      />
    </>
  );
}
