/* ============================================================
   Trading Card Game — Draw Engine
   Pure functions, no React/Firebase code. Shared shape with the
   Cloudflare Worker (see cloudflare-worker/cards-worker/index.js,
   which reimplements this logic server-side so packs are never
   trusted to the client).
   ============================================================ */

import type { CardDef, CardSet, RarityId, Rarity } from './types';
import { RARITIES } from './config';

/** Weighted random pick from an array of [weight, value] pairs. */
function weightedPick<T>(items: [number, T][]): T {
  const total = items.reduce((sum, [w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [w, v] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][1];
}

export function pickRarity(rarities: Rarity[] = RARITIES): RarityId {
  return weightedPick(rarities.map((r) => [r.weight, r.id] as [number, RarityId]));
}

/** Picks one random card of the given rarity, falling back to the nearest rarity with cards. */
export function pickCardOfRarity(cardSet: CardSet, rarity: RarityId, rarities: Rarity[] = RARITIES): CardDef {
  const pool = cardSet.cards.filter((c) => c.rarity === rarity);
  if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];

  // Fall back to the closest rarity tier that actually has cards defined.
  const order = rarities.map((r) => r.id);
  const idx = order.indexOf(rarity);
  for (let offset = 1; offset < order.length; offset++) {
    for (const dir of [-1, 1]) {
      const candidate = order[idx + offset * dir];
      if (!candidate) continue;
      const candidatePool = cardSet.cards.filter((c) => c.rarity === candidate);
      if (candidatePool.length > 0) return candidatePool[Math.floor(Math.random() * candidatePool.length)];
    }
  }

  // Last resort: any card in the set.
  return cardSet.cards[Math.floor(Math.random() * cardSet.cards.length)];
}

/** Draws one full pack of `packSize` cards from the given card set. */
export function drawPack(cardSet: CardSet, packSize: number, rarities: Rarity[] = RARITIES): CardDef[] {
  const pack: CardDef[] = [];
  for (let i = 0; i < packSize; i++) {
    const rarity = pickRarity(rarities);
    pack.push(pickCardOfRarity(cardSet, rarity, rarities));
  }
  return pack;
}

export function rarityOf(rarityId: RarityId, rarities: Rarity[] = RARITIES): Rarity {
  return rarities.find((r) => r.id === rarityId) ?? rarities[0];
}

export function cardValue(card: CardDef, rarities: Rarity[] = RARITIES): number {
  return rarityOf(card.rarity, rarities).value;
}
