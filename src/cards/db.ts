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
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getCardsDb } from './firebase';
import type { PackEvent, UserCollection } from './types';

const PACK_EVENTS_COL = 'packEvents';
const USER_COLLECTIONS_COL = 'userCollections';

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

export async function getLeaderboard(sortBy: LeaderboardSort = 'totalValue', limitN = 50): Promise<UserCollection[]> {
  const db = getCardsDb();
  if (!db) return [];
  try {
    const q = query(collection(db, USER_COLLECTIONS_COL), orderBy(sortBy, 'desc'), limit(limitN));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as UserCollection);
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
