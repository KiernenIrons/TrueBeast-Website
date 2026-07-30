/**
 * Trading Card Game -- Configuration
 * ===================================
 * Everything you'd change to run your OWN card game off this same codebase
 * lives in this one file. No other file needs editing for day-to-day tuning
 * (pack size, reveal timing, rarity odds) or for pointing at your own
 * Twitch channel / Firebase project / card set.
 *
 * See CARDS_SETUP.md for the full one-time setup walkthrough (Twitch app,
 * Firebase project, Cloudflare Worker, channel-points reward).
 */

import type { Rarity, CardSet } from './types';
import starterSet from '../../card-sets/starter/cards.json';

// ---------------------------------------------------------------------------
// Pack behavior -- adjust these freely, no code changes needed elsewhere.
// ---------------------------------------------------------------------------

export const CARDS_CONFIG = {
  /** How many cards come out of one pack redemption. */
  packSize: 3,

  /** How many seconds each card stays on screen during the overlay reveal. */
  revealDurationSeconds: 4,

  /** Must match the title of the Channel Points reward you create on your dashboard. */
  rewardName: 'Open a Card Pack',

  /**
   * Your Twitch numeric broadcaster user ID (not your username).
   * Look it up at https://streamscharts.com/tools/convert-username or via
   * the Twitch API `GET /helix/users?login=yourname`.
   */
  channelId: '122262370',

  /** Which card-set folder (under /card-sets) this instance uses. */
  activeCardSet: starterSet as CardSet,
};

// ---------------------------------------------------------------------------
// Rarity tiers -- weight controls draw odds (higher = more common),
// value feeds the "most valuable collection" leaderboard sort.
// ---------------------------------------------------------------------------

export const RARITIES: Rarity[] = [
  { id: 'common',    name: 'Common',    weight: 100, value: 1,   color: '#9ca3af', glow: 'rgba(156,163,175,0.35)' },
  { id: 'uncommon',  name: 'Uncommon',  weight: 45,  value: 3,   color: '#34d399', glow: 'rgba(52,211,153,0.45)' },
  { id: 'rare',      name: 'Rare',      weight: 18,  value: 8,   color: '#38bdf8', glow: 'rgba(56,189,248,0.55)' },
  { id: 'epic',      name: 'Epic',      weight: 6,   value: 20,  color: '#a78bfa', glow: 'rgba(167,139,250,0.65)' },
  { id: 'legendary', name: 'Legendary', weight: 1,   value: 75,  color: '#facc15', glow: 'rgba(250,204,21,0.8)' },
];

// ---------------------------------------------------------------------------
// Firebase project for THIS feature (deliberately separate from the main
// site's `truebeast-support` project -- see CARDS_SETUP.md for why, and
// how to create it in ~5 minutes).
// ---------------------------------------------------------------------------

export const CARDS_FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDHvQn2RVR53m0dS-T15SY02LQj0pMDU1s',
  authDomain:        'truebeast-cards.firebaseapp.com',
  projectId:         'truebeast-cards',
  storageBucket:     'truebeast-cards.firebasestorage.app',
  messagingSenderId: '122003455746',
  appId:             '1:122003455746:web:0e1bf3e3fb1f23bf788c1b',
};

export function isCardsFirebaseConfigured(): boolean {
  return CARDS_FIREBASE_CONFIG.apiKey !== 'PASTE_YOUR_FIREBASE_API_KEY' && !!CARDS_FIREBASE_CONFIG.apiKey;
}

// ---------------------------------------------------------------------------
// Cloudflare Worker URL -- the same one from CARDS_SETUP.md that receives
// Twitch EventSub redemptions. The Admin panel's Card Maker also calls it
// (with an admin-only, ID-token-verified route) to upload card art to R2
// storage and to manually adjust a viewer's owned cards.
// ---------------------------------------------------------------------------

export const CARDS_WORKER_URL = 'https://truebeast-cards.kiernens-account.workers.dev';
