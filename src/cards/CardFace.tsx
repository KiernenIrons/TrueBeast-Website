import { useState } from 'react';
import type { CardDef } from './types';
import { rarityOf } from './engine';

interface CardFaceProps {
  card: CardDef;
  /** Count owned — shown as a small badge (omit for the overlay reveal). */
  count?: number;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { w: 132, h: 184, emoji: 40, name: 12 },
  md: { w: 172, h: 240, emoji: 56, name: 14 },
  lg: { w: 260, h: 364, emoji: 88, name: 20 },
};

export default function CardFace({ card, count, size = 'md' }: CardFaceProps) {
  const rarity = rarityOf(card.rarity);
  const dims = SIZES[size];
  // If the stored imageUrl ever fails to load (bad/rotted URL, R2 access
  // issue, etc.), fall back to the emoji/❓ instead of a near-invisible
  // broken-image glyph sitting on a dark card -- and log the exact URL so
  // it's easy to check directly (open it in a new tab) instead of the card
  // just silently looking "empty".
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!card.imageUrl && !imgFailed;

  return (
    <div
      className="relative rounded-2xl overflow-hidden flex flex-col items-center justify-between select-none"
      style={{
        width: dims.w,
        height: dims.h,
        background: `linear-gradient(155deg, ${card.gradientFrom} 0%, ${card.gradientTo} 100%)`,
        border: `2px solid ${rarity.color}`,
        boxShadow: `0 0 24px ${rarity.glow}, 0 8px 24px rgba(0,0,0,0.35)`,
      }}
    >
      {count !== undefined && count > 1 && (
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 text-[11px] font-bold text-white z-10">
          ×{count}
        </div>
      )}

      <div
        className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider z-10"
        style={{ background: 'rgba(0,0,0,0.45)', color: rarity.color }}
      >
        {rarity.name}
      </div>

      <div className="flex-1 relative flex items-center justify-center" style={{ fontSize: dims.emoji }}>
        {card.imageUrl && !imgFailed && (
          <img
            src={card.imageUrl}
            alt={card.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => {
              console.warn(`[cards] card "${card.id}" image failed to load, falling back to emoji: ${card.imageUrl}`);
              setImgFailed(true);
            }}
          />
        )}
        {card.emoji ? (
          <span
            className="relative z-[1]"
            style={showImage ? { textShadow: '0 2px 6px rgba(0,0,0,0.7), 0 0 14px rgba(0,0,0,0.5)' } : undefined}
          >
            {card.emoji}
          </span>
        ) : (
          !showImage && <span className="relative z-[1]">❓</span>
        )}
      </div>

      <div className="w-full px-3 pb-3 text-center">
        <div className="font-bold text-white leading-tight" style={{ fontSize: dims.name }}>
          {card.name}
        </div>
      </div>
    </div>
  );
}
