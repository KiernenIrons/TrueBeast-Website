/* ============================================================
   Trading Card Game — Firestore reads
   All writes are server-only (Cloudflare Worker via Admin REST API).
   ============================================================ */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getCardsDb } from './firebase';
import { getFirestoreDb } from '@/lib/firebase';
import starterSet from '../../card-sets/starter/cards.json';
import type { PackEvent, UserCollection, CardDef } from './types';

const PACK_EVENTS_COL = 'packEvents';
const USER_COLLECTIONS_COL = 'userCollections';
const CARD_CATALOG_COL = 'cardCatalog';

/**
 * Live-subscribes to newly-created pack events (createdAt > `sinceIso`).
 * Used by the OBS overlay so a fresh page load never replays old packs.
 * Returns a no-op unsubscribe if Firebase isn't configured yet.
 */
export function subscribeToPackEvents(sinceIso: string, onEvent: (event: PackEvent) => void): Unsubscribe {
  const db = getCardsDb();
  if (!db) return () => {};

  const q = query(collection(db, PACK_EVENTS_COL), where('createdAt', '>', sinceIso), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'added') {
          onEvent({ id: change.doc.id, ...(change.doc.data() as Omit<PackEvent, 'id'>) });
        }
      }
    },
    (err) => console.warn('[cards] subscribeToPackEvents error:', err.message),
  );
}

export type LeaderboardSort = 'totalCards' | 'totalValue';

// Short in-memory cache so rapid re-renders / sort-tab toggles within the same
// tab don't each re-spend a Firestore read quota -- this project is separate
// from the Discord bot's Firebase project, but reads still count against this
// project's own Spark-plan daily quota, so it's worth trimming for free.
const CACHE_TTL_MS = 20_000;
const leaderboardCache = new Map<string, { data: UserCollection[]; expiresAt: number }>();

export async function getLeaderboard(sortBy: LeaderboardSort = 'totalValue', limitN = 50): Promise<UserCollection[]> {
  const cacheKey = `${sortBy}:${limitN}`;
  const cached = leaderboardCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const db = getCardsDb();
  if (!db) return [];
  try {
    const q = query(collection(db, USER_COLLECTIONS_COL), orderBy(sortBy, 'desc'), limit(limitN));
    const snap = await getDocs(q);
    const data = snap.docs.map((d) => d.data() as UserCollection);
    leaderboardCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.warn('[cards] getLeaderboard error:', (err as Error).message);
    return [];
  }
}

export async function getUserCollectionByLogin(login: string): Promise<UserCollection | null> {
  const db = getCardsDb();
  if (!db) return null;
  try {
    const q = query(collection(db, USER_COLLECTIONS_COL), where('twitchUserLogin', '==', login.toLowerCase()), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as UserCollection;
  } catch (err) {
    console.warn('[cards] getUserCollectionByLogin error:', (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live card catalog -- editable via the Admin panel's "Card Maker" tab.
//
// Deliberately lives in the MAIN site's Firebase project (truebeast-support,
// the same one src/lib/firebase.ts / AuthContext already authenticate
// against), not the dedicated truebeast-cards project used for gameplay
// data -- that's what lets the admin panel write to it directly with the
// existing "allow write: if request.auth != null" rule pattern already used
// for every other admin-editable collection, no new auth plumbing needed.
//
// Falls back to card-sets/starter/cards.json (this instance's bundled
// starter set) ONLY when the live collection is unreachable (Firebase not
// configured, or a genuine read error) -- NOT when it's merely empty. An
// admin who deliberately retires/removes every card sees a truly empty
// catalog, not the starter set reappearing out from under them; use the
// Card Maker's "Import Starter Set" button to repopulate on purpose.
// ---------------------------------------------------------------------------

type CatalogCard = CardDef & { order?: number };

function fallbackCatalog(): CardDef[] {
  return starterSet.cards as CardDef[];
}

export async function getCardCatalog(): Promise<CardDef[]> {
  const db = getFirestoreDb();
  if (!db) return fallbackCatalog();
  try {
    const snap = await getDocs(collection(db, CARD_CATALOG_COL));
    const cards = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CatalogCard);
    cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    return cards;
  } catch (err) {
    console.warn('[cards] getCardCatalog error, falling back to starter set:', (err as Error).message);
    return fallbackCatalog();
  }
}

export async function upsertCatalogCard(card: CatalogCard): Promise<void> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firebase not configured');
  const { id, ...rest } = card;
  // JSON round-trip strips `undefined` values at any depth -- Firestore's
  // setDoc rejects them outright (e.g. `order: undefined` when editing an
  // existing card rather than creating a new one).
  const payload = JSON.parse(JSON.stringify(rest));
  await setDoc(doc(db, CARD_CATALOG_COL, id), payload, { merge: true });
}

export async function deleteCatalogCard(id: string): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  await deleteDoc(doc(db, CARD_CATALOG_COL, id));
}

/** One-time bootstrap: copies the bundled starter set into Firestore, only if the collection is empty. */
export async function seedStarterCatalog(): Promise<number> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firebase not configured');
  const existing = await getDocs(collection(db, CARD_CATALOG_COL));
  if (!existing.empty) return 0;
  const cards = starterSet.cards as CardDef[];
  await Promise.all(
    cards.map((card, i) => {
      const { id, ...rest } = card;
      return setDoc(doc(db, CARD_CATALOG_COL, id), { ...rest, order: i });
    }),
  );
  return cards.length;
}
