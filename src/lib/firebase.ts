/**
 * TrueBeast Website -- Firebase Database Abstraction
 * ==================================================
 * Provides a single API for reading/writing ticket data.
 *
 * MODES:
 *   Firebase mode  -- when SITE_CONFIG.firebase.apiKey is configured.
 *                    Tickets are stored in Firestore (cross-device, persistent).
 *   Fallback mode  -- when Firebase is NOT yet configured, or Firestore is
 *                    unreachable (e.g. database not created yet, rules blocking,
 *                    or network issue). Tickets are stored in localStorage so
 *                    the form always completes successfully.
 *
 * Uses the modular Firebase SDK (v10+).
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  type Auth,
  type User,
  type UserCredential,
  type Unsubscribe,
} from 'firebase/auth';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
  type FirebaseStorage,
} from 'firebase/storage';
import { SITE_CONFIG } from '@/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketResponse {
  from: string;
  message: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  description: string;
  status: string;
  priority: string;
  responses: TicketResponse[];
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Review {
  id: string;
  name: string;
  rating: number;
  text: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface WebhookBackup {
  id: string;
  name: string;
  webhookUrl: string;
  embeds: unknown[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface AdminRole {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface AnalyticsEvent {
  type: string;
  page: string;
  referrer: string | null;
  sessionId: string;
  ts: string;
  ua: string;
  [key: string]: unknown;
}

export interface GiveawayEntry {
  id: string;           // Auto-generated doc ID
  giveawayId: string;   // Matches Giveaway.id slug from config
  discord: string;      // Discord username (unique per giveaway)
  enteredAt: string;    // ISO timestamp
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;

const TIMEOUT_MS = 8000;

function _isConfigured(): boolean {
  return !!(
    SITE_CONFIG.firebase &&
    SITE_CONFIG.firebase.apiKey &&
    SITE_CONFIG.firebase.apiKey !== 'PASTE_YOUR_FIREBASE_API_KEY'
  );
}

function _ensureApp(): void {
  if (_app) return;
  if (!_isConfigured()) return;
  _app = getApps().length ? getApp() : initializeApp(SITE_CONFIG.firebase);
  _db = getFirestore(_app);
  _auth = getAuth(_app);
  _storage = getStorage(_app);
}

/** Returns the Firestore instance (or null if not configured). Exported for analytics. */
export function getFirestoreDb(): Firestore | null {
  _ensureApp();
  return _db;
}

/** Returns the Firebase app (or null if not configured). Exported for analytics. */
export function getFirebaseApp(): FirebaseApp | null {
  _ensureApp();
  return _app;
}

/** Returns the Firebase Storage instance (or null if not configured). */
export function getFirebaseStorage(): FirebaseStorage | null {
  _ensureApp();
  return _storage;
}

/**
 * Wraps a promise with a timeout so it always resolves/rejects
 * within the given ms instead of hanging indefinitely.
 */
function _withTimeout<T>(promise: Promise<T>, ms: number = TIMEOUT_MS): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            'Firestore timeout - check that your database is created and Security Rules are published',
          ),
        ),
      ms,
    ),
  );
  return Promise.race([promise, timeout]);
}

// ---------------------------------------------------------------------------
// localStorage helpers (always available as fallback)
// ---------------------------------------------------------------------------

function _lsSave(ticket: Ticket): Ticket {
  const existing: Ticket[] = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
  localStorage.setItem('tb_tickets', JSON.stringify([ticket, ...existing]));
  return ticket;
}

function _lsGet(id: string): Ticket | null {
  const tickets: Ticket[] = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
  return tickets.find((t) => t.id.toLowerCase() === id.toLowerCase()) || null;
}

function _lsGetAll(): Ticket[] {
  const tickets: Ticket[] = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
  return tickets.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function _lsUpdate(id: string, payload: Partial<Ticket>): Ticket | null {
  const tickets: Ticket[] = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
  const updated = tickets.map((t) => (t.id === id ? { ...t, ...payload } : t));
  localStorage.setItem('tb_tickets', JSON.stringify(updated));
  return updated.find((t) => t.id === id) || null;
}

function _lsDelete(id: string): void {
  const tickets: Ticket[] = JSON.parse(localStorage.getItem('tb_tickets') || '[]');
  localStorage.setItem('tb_tickets', JSON.stringify(tickets.filter((t) => t.id !== id)));
}

// Review localStorage fallbacks

function _lsSaveReview(review: Review): Review {
  const existing: Review[] = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
  localStorage.setItem('tb_reviews', JSON.stringify([review, ...existing]));
  return review;
}

function _lsGetAllReviews(): Review[] {
  const reviews: Review[] = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
  return reviews.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function _lsUpdateReview(id: string, payload: Partial<Review>): Review | null {
  const reviews: Review[] = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
  const updated = reviews.map((r) => (r.id === id ? { ...r, ...payload } : r));
  localStorage.setItem('tb_reviews', JSON.stringify(updated));
  return updated.find((r) => r.id === id) || null;
}

function _lsDeleteReview(id: string): void {
  const reviews: Review[] = JSON.parse(localStorage.getItem('tb_reviews') || '[]');
  localStorage.setItem('tb_reviews', JSON.stringify(reviews.filter((r) => r.id !== id)));
}

// Giveaway entry localStorage fallbacks

const LS_GIVEAWAY_ENTRIES = 'tb_giveaway_entries';

function _lsGetGiveawayEntries(giveawayId: string): GiveawayEntry[] {
  const all: GiveawayEntry[] = JSON.parse(localStorage.getItem(LS_GIVEAWAY_ENTRIES) || '[]');
  return all.filter((e) => e.giveawayId === giveawayId);
}

function _lsSaveGiveawayEntry(entry: GiveawayEntry): GiveawayEntry {
  const all: GiveawayEntry[] = JSON.parse(localStorage.getItem(LS_GIVEAWAY_ENTRIES) || '[]');
  all.push(entry);
  localStorage.setItem(LS_GIVEAWAY_ENTRIES, JSON.stringify(all));
  return entry;
}

function _lsHasEnteredGiveaway(giveawayId: string, discord: string): boolean {
  const entries = _lsGetGiveawayEntries(giveawayId);
  return entries.some((e) => e.discord.toLowerCase() === discord.toLowerCase());
}

// ---------------------------------------------------------------------------
// Public API -- FirebaseDB
// ---------------------------------------------------------------------------

export const FirebaseDB = {
  /**
   * Returns true if Firebase is configured and the SDK is loaded.
   */
  isConfigured(): boolean {
    return _isConfigured();
  },

  // -----------------------------------------------------------------------
  // Tickets
  // -----------------------------------------------------------------------

  async saveTicket(ticket: Ticket): Promise<Ticket> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(setDoc(doc(_db, 'tickets', ticket.id), ticket));
        return ticket;
      } catch (err) {
        console.warn('FirebaseDB.saveTicket fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsSave(ticket);
  },

  async getTicket(id: string): Promise<Ticket | null> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        const snap = await _withTimeout(getDoc(doc(_db, 'tickets', id)));
        return snap.exists() ? ({ id: snap.id, ...snap.data() } as Ticket) : null;
      } catch (err) {
        console.warn('FirebaseDB.getTicket fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsGet(id);
  },

  async getAllTickets(): Promise<Ticket[]> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        const q = query(collection(_db, 'tickets'), orderBy('createdAt', 'desc'));
        const snap = await _withTimeout(getDocs(q));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ticket);
      } catch (err) {
        console.warn('FirebaseDB.getAllTickets fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsGetAll();
  },

  async updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket | null> {
    _ensureApp();
    const payload = { ...updates, updatedAt: new Date().toISOString() };
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(updateDoc(doc(_db, 'tickets', id), payload));
        return this.getTicket(id);
      } catch (err) {
        console.warn('FirebaseDB.updateTicket fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsUpdate(id, payload);
  },

  async deleteTicket(id: string): Promise<void> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(deleteDoc(doc(_db, 'tickets', id)));
        return;
      } catch (err) {
        console.warn('FirebaseDB.deleteTicket fell back to localStorage:', (err as Error).message);
      }
    }
    _lsDelete(id);
  },

  // -----------------------------------------------------------------------
  // Reviews
  // -----------------------------------------------------------------------

  async saveReview(review: Review): Promise<Review> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(setDoc(doc(_db, 'reviews', review.id), review));
        return review;
      } catch (err) {
        console.warn('FirebaseDB.saveReview fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsSaveReview(review);
  },

  async getAllReviews(): Promise<Review[]> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        const q = query(collection(_db, 'reviews'), orderBy('createdAt', 'desc'));
        const snap = await _withTimeout(getDocs(q));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Review);
      } catch (err) {
        console.warn('FirebaseDB.getAllReviews fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsGetAllReviews();
  },

  async updateReview(id: string, updates: Partial<Review>): Promise<Review | null> {
    _ensureApp();
    const payload = { ...updates, updatedAt: new Date().toISOString() };
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(updateDoc(doc(_db, 'reviews', id), payload));
        const snap = await getDoc(doc(_db, 'reviews', id));
        return snap.exists() ? ({ id: snap.id, ...snap.data() } as Review) : null;
      } catch (err) {
        console.warn('FirebaseDB.updateReview fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsUpdateReview(id, payload);
  },

  async deleteReview(id: string): Promise<void> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        await _withTimeout(deleteDoc(doc(_db, 'reviews', id)));
        return;
      } catch (err) {
        console.warn('FirebaseDB.deleteReview fell back to localStorage:', (err as Error).message);
      }
    }
    _lsDeleteReview(id);
  },

  // -----------------------------------------------------------------------
  // Giveaway Entries
  // -----------------------------------------------------------------------

  async enterGiveaway(giveawayId: string, discord: string): Promise<{ success: boolean; alreadyEntered?: boolean }> {
    const normalizedDiscord = discord.trim();
    if (!normalizedDiscord) return { success: false };

    _ensureApp();

    if (_isConfigured() && _db) {
      try {
        // Check for existing entry by this Discord user in this giveaway
        const q = query(
          collection(_db, 'giveaway_entries'),
          where('giveawayId', '==', giveawayId),
          where('discord', '==', normalizedDiscord.toLowerCase()),
        );
        const existing = await _withTimeout(getDocs(q));
        if (!existing.empty) {
          return { success: false, alreadyEntered: true };
        }

        const entry: GiveawayEntry = {
          id: `ge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          giveawayId,
          discord: normalizedDiscord,
          enteredAt: new Date().toISOString(),
        };
        await _withTimeout(setDoc(doc(_db, 'giveaway_entries', entry.id), entry));
        return { success: true };
      } catch (err) {
        console.warn('FirebaseDB.enterGiveaway fell back to localStorage:', (err as Error).message);
      }
    }

    // localStorage fallback
    if (_lsHasEnteredGiveaway(giveawayId, normalizedDiscord)) {
      return { success: false, alreadyEntered: true };
    }
    _lsSaveGiveawayEntry({
      id: `ge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      giveawayId,
      discord: normalizedDiscord,
      enteredAt: new Date().toISOString(),
    });
    return { success: true };
  },

  async getGiveawayEntries(giveawayId: string): Promise<GiveawayEntry[]> {
    _ensureApp();
    if (_isConfigured() && _db) {
      try {
        const q = query(
          collection(_db, 'giveaway_entries'),
          where('giveawayId', '==', giveawayId),
          orderBy('enteredAt', 'desc'),
        );
        const snap = await _withTimeout(getDocs(q));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as GiveawayEntry);
      } catch (err) {
        console.warn('FirebaseDB.getGiveawayEntries fell back to localStorage:', (err as Error).message);
      }
    }
    return _lsGetGiveawayEntries(giveawayId);
  },

  async getGiveawayEntryCount(giveawayId: string): Promise<number> {
    const entries = await this.getGiveawayEntries(giveawayId);
    return entries.length;
  },

  // -----------------------------------------------------------------------
  // Webhook Backups (Discord embed builder -- admin only)
  // -----------------------------------------------------------------------

  async saveWebhookBackup(backup: Omit<WebhookBackup, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookBackup> {
    _ensureApp();
    if (!_isConfigured() || !_db) throw new Error('Firebase not configured');
    const id = 'wb-' + Date.now();
    const document = {
      ...backup,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as WebhookBackup;
    await _withTimeout(setDoc(doc(_db, 'webhookBackups', id), document));
    return document;
  },

  async getAllWebhookBackups(): Promise<WebhookBackup[]> {
    _ensureApp();
    if (!_isConfigured() || !_db) return [];
    const q = query(collection(_db, 'webhookBackups'), orderBy('createdAt', 'desc'));
    const snap = await _withTimeout(getDocs(q));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WebhookBackup);
  },

  async updateWebhookBackup(id: string, updates: Partial<WebhookBackup>): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_db) return;
    const payload = { ...updates, updatedAt: new Date().toISOString() };
    await _withTimeout(updateDoc(doc(_db, 'webhookBackups', id), payload));
  },

  async deleteWebhookBackup(id: string): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_db) return;
    await _withTimeout(deleteDoc(doc(_db, 'webhookBackups', id)));
  },

  // -----------------------------------------------------------------------
  // Announcements (public-read for homepage latest announcement)
  // -----------------------------------------------------------------------

  async saveAnnouncement(announcement: Omit<Announcement, 'id' | 'createdAt'>): Promise<Announcement> {
    _ensureApp();
    if (!_isConfigured() || !_db) throw new Error('Firebase not configured');
    const id = 'ann-' + Date.now();
    const document = {
      ...announcement,
      id,
      createdAt: new Date().toISOString(),
    } as Announcement;
    await _withTimeout(setDoc(doc(_db, 'announcements', id), document));
    return document;
  },

  async getLatestAnnouncement(): Promise<Announcement | null> {
    _ensureApp();
    if (!_isConfigured() || !_db) return null;
    try {
      const q = query(collection(_db, 'announcements'), orderBy('createdAt', 'desc'), limit(1));
      const snap = await _withTimeout(getDocs(q));
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() } as Announcement;
    } catch (err) {
      console.warn('FirebaseDB.getLatestAnnouncement error:', (err as Error).message);
      return null;
    }
  },

  // -----------------------------------------------------------------------
  // Analytics Events (admin read)
  // -----------------------------------------------------------------------

  async getAnalyticsEvents(options?: {
    startDate?: string;
    limit?: number;
  }): Promise<AnalyticsEvent[]> {
    _ensureApp();
    if (!_isConfigured() || !_db) return [];
    try {
      const constraints: any[] = [orderBy('ts', 'desc')];
      if (options?.startDate) {
        constraints.unshift(where('ts', '>=', options.startDate));
      }
      if (options?.limit) {
        constraints.push(limit(options.limit));
      }
      const q = query(collection(_db, 'analytics'), ...constraints);
      const snap = await _withTimeout(getDocs(q), 15000);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as AnalyticsEvent));
    } catch (err) {
      console.warn('FirebaseDB.getAnalyticsEvents error:', (err as Error).message);
      return [];
    }
  },

  // -----------------------------------------------------------------------
  // Admin Roles (RBAC)
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // User Management (list users from Firestore collections)
  // -----------------------------------------------------------------------

  async getAllUsers(): Promise<{ uid: string; source: string; data: Record<string, unknown> }[]> {
    _ensureApp();
    if (!_isConfigured() || !_db) return [];
    const users: { uid: string; source: string; data: Record<string, unknown> }[] = [];
    const seen = new Set<string>();

    // Check leaderboard (public, has displayName)
    try {
      const snap = await _withTimeout(getDocs(collection(_db, 'clout-clicker-leaderboard')));
      snap.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          users.push({ uid: d.id, source: 'clout-clicker', data: d.data() });
        }
      });
    } catch { /* */ }

    // Check game saves
    try {
      const snap = await _withTimeout(getDocs(collection(_db, 'clout-clicker-saves')));
      snap.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          users.push({ uid: d.id, source: 'clout-clicker', data: d.data() });
        }
      });
    } catch { /* */ }

    // Check message counts (from Discord bot)
    try {
      const snap = await _withTimeout(getDocs(collection(_db, 'messageCounts')));
      snap.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          users.push({ uid: d.id, source: 'messaging', data: d.data() });
        }
      });
    } catch { /* */ }

    return users;
  },

  async deleteUserData(uid: string): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_db) return;
    // Delete from all known user collections
    const collections = ['clout-clicker-saves', 'clout-clicker-leaderboard', 'clout-clicker-peak', 'messageCounts', 'userStreaks', 'taskCompletions'];
    for (const col of collections) {
      try { await deleteDoc(doc(_db, col, uid)); } catch { /* doc may not exist */ }
    }
  },

  // -----------------------------------------------------------------------
  // Admin Roles (RBAC)
  // -----------------------------------------------------------------------

  async getAdminRole(email: string): Promise<AdminRole | null> {
    _ensureApp();
    if (!_isConfigured() || !_db) return null;
    try {
      const snap = await _withTimeout(getDoc(doc(_db, 'adminRoles', email)));
      return snap.exists() ? (snap.data() as AdminRole) : null;
    } catch (err) {
      console.warn('FirebaseDB.getAdminRole error:', (err as Error).message);
      return null;
    }
  },

  async getAllAdminRoles(): Promise<AdminRole[]> {
    _ensureApp();
    if (!_isConfigured() || !_db) return [];
    const q = query(collection(_db, 'adminRoles'), orderBy('createdAt', 'asc'));
    const snap = await _withTimeout(getDocs(q));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminRole);
  },

  async setAdminRole(email: string, data: Partial<AdminRole>): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_db) throw new Error('Firebase not configured');
    await _withTimeout(setDoc(doc(_db, 'adminRoles', email), data, { merge: true }));
  },

  async deleteAdminRole(email: string): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_db) throw new Error('Firebase not configured');
    await _withTimeout(deleteDoc(doc(_db, 'adminRoles', email)));
  },

  // -----------------------------------------------------------------------
  // Image Storage (admin uploads for embed icons/images)
  // -----------------------------------------------------------------------

  async uploadImage(file: File, path?: string): Promise<string> {
    _ensureApp();
    if (!_isConfigured() || !_storage) throw new Error('Firebase not configured');
    const fileName = path || `admin-uploads/${Date.now()}-${file.name}`;
    const storageRef = ref(_storage, fileName);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  },

  async listImages(folder?: string): Promise<{ name: string; url: string; fullPath: string }[]> {
    _ensureApp();
    if (!_isConfigured() || !_storage) return [];
    const folderRef = ref(_storage, folder || 'admin-uploads');
    try {
      const result = await listAll(folderRef);
      const items = await Promise.all(
        result.items.map(async (item) => ({
          name: item.name,
          fullPath: item.fullPath,
          url: await getDownloadURL(item),
        }))
      );
      return items;
    } catch (err) {
      console.warn('FirebaseDB.listImages error:', (err as Error).message);
      return [];
    }
  },

  async deleteImage(fullPath: string): Promise<void> {
    _ensureApp();
    if (!_isConfigured() || !_storage) return;
    const imageRef = ref(_storage, fullPath);
    await deleteObject(imageRef);
  },

  // -----------------------------------------------------------------------
  // Admin Authentication
  // -----------------------------------------------------------------------

  async adminSignIn(email: string, password: string): Promise<UserCredential> {
    _ensureApp();
    if (!_isConfigured() || !_auth) {
      throw new Error(
        'Firebase is not configured yet. See js/config.js for setup instructions.',
      );
    }
    return signInWithEmailAndPassword(_auth, email, password);
  },

  async adminSignOut(): Promise<void> {
    _ensureApp();
    if (_isConfigured() && _auth) await signOut(_auth);
  },

  onAuthStateChanged(callback: (user: User | null) => void): Unsubscribe {
    _ensureApp();
    if (_isConfigured() && _auth) {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.warn(
            'FirebaseDB: auth state timed out - is Firebase Authentication enabled in your Firebase console?',
          );
          callback(null);
        }
      }, 6000);

      try {
        const unsubscribe = firebaseOnAuthStateChanged(_auth, (u) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
          }
          callback(u);
        });
        return unsubscribe;
      } catch (err) {
        console.warn(
          'FirebaseDB: firebase.auth() error:',
          (err as Error).message,
          '\n-> Go to Firebase Console -> Build -> Authentication -> Get started -> enable Email/Password',
        );
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          callback(null);
        }
      }
    } else {
      callback(null);
    }
    return () => {};
  },
};

export default FirebaseDB;
