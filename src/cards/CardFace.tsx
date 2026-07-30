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
      className="relative rounded-2xl overflow-hidden select-none"
      style={{
        width: dims.w,
        height: dims.h,
        background: `linear-gradient(155deg, ${card.gradientFrom} 0%, ${card.gradientTo} 100%)`,
        border: `2px solid ${rarity.color}`,
        boxShadow: `0 0 24px ${rarity.glow}, 0 8px 24px rgba(0,0,0,0.35)`,
      }}
    >
      {/* Art is now full-bleed (the whole card, edge to edge) instead of
          being confined to the area above the name strip. That confined
          area had a shorter aspect ratio than the Card Maker's crop editor
          assumes, so object-cover was silently re-cropping whatever was
          framed there -- usually reading as "the image sits higher than the
          preview". Full-bleed art means the crop editor's frame (which
          already matches the card's own aspect ratio) IS the final crop,
          with the name shown over a scrim at the bottom instead of in its
          own reserved strip. */}
      {showImage && (
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
        <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: dims.emoji }}>
          <span style={showImage ? { textShadow: '0 2px 6px rgba(0,0,0,0.7), 0 0 14px rgba(0,0,0,0.5)' } : undefined}>
            {card.emoji}
          </span>
        </div>
      ) : (
        !showImage && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: dims.emoji }}>
            <span>❓</span>
          </div>
        )
      )}

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

      <div
        className="absolute bottom-0 left-0 w-full px-3 pb-3 pt-6 text-center"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 25%, transparent 100%)' }}
      >
        <div className="font-bold text-white leading-tight" style={{ fontSize: dims.name }}>
          {card.name}
        </div>
      </div>
    </div>
  );
}
