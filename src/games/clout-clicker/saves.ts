/* ============================================================
   Clout Clicker — Save / Load System
   Firebase integration + localStorage fallback.
   ============================================================ */

import type { SerializedState, GameState, LeaderboardEntry } from './types';
import { getFirestoreDb } from '@/lib/firebase';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_SAVE_KEY = 'clout-clicker-save';
const LS_PEAK_KEY = 'clout-clicker-peak';

const FB_SAVES_COL = 'clout-clicker-saves';
const FB_PEAK_COL = 'clout-clicker-peak';
const FB_LEADERBOARD_COL = 'clout-clicker-leaderboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeBase64(data: SerializedState): string {
  try {
    return btoa(JSON.stringify(data));
  } catch {
    return '';
  }
}

function decodeBase64(encoded: string): SerializedState | null {
  try {
    return JSON.parse(atob(encoded)) as SerializedState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GameSaves
// ---------------------------------------------------------------------------

export const GameSaves = {
  // -----------------------------------------------------------------------
  // Local storage
  // -----------------------------------------------------------------------

  saveLocal(data: SerializedState): void {
    try {
      localStorage.setItem(LS_SAVE_KEY, encodeBase64(data));
    } catch (err) {
      console.warn('[GameSaves] saveLocal failed:', err);
    }
  },

  loadLocal(): SerializedState | null {
    try {
      const raw = localStorage.getItem(LS_SAVE_KEY);
      if (!raw) return null;
      return decodeBase64(raw);
    } catch (err) {
      console.warn('[GameSaves] loadLocal failed:', err);
      return null;
    }
  },

  saveLocalPeak(data: SerializedState): void {
    try {
      const existing = this.loadLocalPeak();
      if (!existing || this.isBetter(data, existing)) {
        localStorage.setItem(LS_PEAK_KEY, encodeBase64(data));
      }
    } catch (err) {
      console.warn('[GameSaves] saveLocalPeak failed:', err);
    }
  },

  loadLocalPeak(): SerializedState | null {
    try {
      const raw = localStorage.getItem(LS_PEAK_KEY);
      if (!raw) return null;
      return decodeBase64(raw);
    } catch (err) {
      console.warn('[GameSaves] loadLocalPeak failed:', err);
      return null;
    }
  },

  // -----------------------------------------------------------------------
  // Firebase cloud saves
  // -----------------------------------------------------------------------

  async saveToCloud(uid: string, data: SerializedState): Promise<void> {
    const db = getFirestoreDb();
    if (!db) return;

    // Main save — always overwrite
    try {
      await setDoc(doc(db, FB_SAVES_COL, uid), data as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn('[GameSaves] saveToCloud main failed:', err);
    }

    // Peak save — only if current is better
    try {
      const peakSnap = await getDoc(doc(db, FB_PEAK_COL, uid));
      const existingPeak = peakSnap.exists()
        ? (peakSnap.data() as SerializedState)
        : null;

      if (!existingPeak || this.isBetter(data, existingPeak)) {
        await setDoc(doc(db, FB_PEAK_COL, uid), data as unknown as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('[GameSaves] saveToCloud peak failed:', err);
    }
  },

  async loadFromCloud(
    uid: string,
  ): Promise<{ main: SerializedState | null; peak: SerializedState | null }> {
    const db = getFirestoreDb();
    if (!db) return { main: null, peak: null };

    let main: SerializedState | null = null;
    let peak: SerializedState | null = null;

    try {
      const mainSnap = await getDoc(doc(db, FB_SAVES_COL, uid));
      if (mainSnap.exists()) {
        main = mainSnap.data() as SerializedState;
      }
    } catch (err) {
      console.warn('[GameSaves] loadFromCloud main failed:', err);
    }

    try {
      const peakSnap = await getDoc(doc(db, FB_PEAK_COL, uid));
      if (peakSnap.exists()) {
        peak = peakSnap.data() as SerializedState;
      }
    } catch (err) {
      console.warn('[GameSaves] loadFromCloud peak failed:', err);
    }

    return { main, peak };
  },

  // -----------------------------------------------------------------------
  // Leaderboard
  // -----------------------------------------------------------------------

  async updateLeaderboard(uid: string, state: GameState): Promise<void> {
    const db = getFirestoreDb();
    if (!db) return;

    const entry: Omit<LeaderboardEntry, 'uid'> & { uid: string } = {
      uid,
      displayName: state.displayName || 'Anonymous',
      photoURL: state.photoURL || '',
      peakClickCps: state.peakClickCps,
      totalCloutEver: state.totalCloutEver,
      allTimeCloutEver: state.allTimeCloutEver,
      prestigeLevel: state.prestigeLevel,
      cps: state.cps,
      clicks: state.clicks,
    };

    try {
      await setDoc(
        doc(db, FB_LEADERBOARD_COL, uid),
        entry as Record<string, unknown>,
      );
    } catch (err) {
      console.warn('[GameSaves] updateLeaderboard failed:', err);
    }
  },

  async fetchLeaderboard(): Promise<LeaderboardEntry[]> {
    const db = getFirestoreDb();
    if (!db) return [];

    try {
      // Query top 50 by totalCloutEver
      const q = query(
        collection(db, FB_LEADERBOARD_COL),
        orderBy('totalCloutEver', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      const entries: LeaderboardEntry[] = snap.docs.map(
        (d) => ({ uid: d.id, ...d.data() }) as LeaderboardEntry,
      );

      // Client re-sort by allTimeCloutEver, return top 25
      entries.sort((a, b) => (b.allTimeCloutEver ?? 0) - (a.allTimeCloutEver ?? 0));
      return entries.slice(0, 25);
    } catch (err) {
      console.warn('[GameSaves] fetchLeaderboard failed:', err);
      return [];
    }
  },

  // -----------------------------------------------------------------------
  // Import / Export
  // -----------------------------------------------------------------------

  exportSave(data: SerializedState): string {
    return encodeBase64(data);
  },

  importSave(encoded: string): SerializedState | null {
    return decodeBase64(encoded);
  },

  // -----------------------------------------------------------------------
  // Save comparison (prestige-aware)
  // -----------------------------------------------------------------------

  /**
   * Returns true if `a` is a better save than `b`.
   * Compares prestige level first, then allTimeCloutEver.
   */
  isBetter(a: SerializedState | null, b: SerializedState | null): boolean {
    if (!a) return false;
    if (!b) return true;

    // Higher prestige level wins
    if ((a.prestigeLevel ?? 0) !== (b.prestigeLevel ?? 0)) {
      return (a.prestigeLevel ?? 0) > (b.prestigeLevel ?? 0);
    }

    // Same prestige level — compare allTimeCloutEver
    return (a.allTimeCloutEver ?? 0) > (b.allTimeCloutEver ?? 0);
  },
};
