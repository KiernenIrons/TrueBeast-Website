/* ============================================================
   Trading Card Game — Type Definitions
   ============================================================ */

export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Rarity {
  id: RarityId;
  name: string;
  /** Relative weight used when drawing a card's rarity — higher = more common. */
  weight: number;
  /** Base card value in "collection points" — drives the "most valuable" leaderboard. */
  value: number;
  color: string;
  glow: string;
}

/** One card definition, authored per card-set (see card-sets/<name>/cards.json). */
export interface CardDef {
  id: string;
  name: string;
  rarity: RarityId;
  /** Emoji shown on the card face — placeholder art until real artwork/images are supplied. */
  emoji: string;
  /** Optional real artwork URL. When set, this replaces the emoji placeholder. */
  imageUrl?: string;
  gradientFrom: string;
  gradientTo: string;
  flavorText: string;
  /**
   * Retired cards are excluded from future pack draws but keep their full
   * definition around so anyone who already owns one still sees it properly
   * in their collection -- retiring is the only removal path exposed in the
   * Card Maker precisely so past pulls are never orphaned. Absent/undefined
   * means active (true), same as every pre-existing card.
   */
  active?: boolean;
}

/** A card-set is just the list of cards a streamer has authored or picked from a template. */
export interface CardSet {
  id: string;
  name: string;
  cards: CardDef[];
}

/** One pack-opening event, written by the Worker, consumed live by the overlay. */
export interface PackEvent {
  id: string;
  channelId: string;
  redemptionId: string;
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  cardIds: string[];
  createdAt: string; // ISO timestamp
}

/** A single viewer's collection for one channel. */
export interface UserCollection {
  channelId: string;
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  cards: Record<string, number>; // cardId -> count owned
  totalCards: number;
  totalValue: number;
  updatedAt: string;
}
