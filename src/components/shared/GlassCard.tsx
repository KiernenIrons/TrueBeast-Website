import React, { forwardRef } from 'react';

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra Tailwind / CSS classes */
  className?: string;
  children?: React.ReactNode;
  /** Enable subtle lift on hover (translateY -2px + border highlight) */
  hover?: boolean;
  /** Enable animated gradient border glow */
  glow?: boolean;
  /** Use the stronger glass blur variant */
  strong?: boolean;
}

/**
 * Reusable glass-morphism card with optional hover lift, animated glow border,
 * and a stronger blur variant. Forwards its ref for measurement / scrolling.
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className = '', children, hover = false, glow = false, strong = false, style, ...rest }, ref) => {
    const baseClass = strong ? 'glass-strong' : 'glass';
    const hoverClass = hover ? 'glass-hover' : '';
    const glowClass = glow ? 'glass-glow' : '';

    return (
      <div
        ref={ref}
        className={`${baseClass} ${hoverClass} ${glowClass} ${className}`.trim()}
        style={style}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

GlassCard.displayName = 'GlassCard';
