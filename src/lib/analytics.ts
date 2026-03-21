/**
 * TrueBeast Analytics
 * ===================
 * Drop-in analytics tracker. Auto-tracks page views, time on page, and
 * link/button clicks. Writes to Firebase Firestore.
 *
 * Usage:
 *   import { TBAnalytics } from '@/lib/analytics';
 *   TBAnalytics.track('link_gen', { tool: 'rotator', count: 3 });
 *
 * Track a button/link automatically by adding a data attribute:
 *   <a data-track="discord_link" href="...">Join Discord</a>
 *
 * -- Firestore rules to add --
 *   match /analytics/{eventId} {
 *     allow create: if true;                          // public write (events in)
 *     allow list, get: if request.auth != null;       // admin read only
 *   }
 */

import { collection, addDoc, type Firestore } from 'firebase/firestore';
import { getFirestoreDb } from '@/lib/firebase';
import { SITE_CONFIG } from '@/config';
import type { AnalyticsEvent } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const SESSION_KEY = 'tb_sid';
const PAGE_START = Date.now();
let _db: Firestore | null = null;
let _queue: AnalyticsEvent[] = [];
let _booted = false;

// ---------------------------------------------------------------------------
// Stable session ID (resets on new tab/browser session)
// ---------------------------------------------------------------------------

function getSid(): string {
  let s = sessionStorage.getItem(SESSION_KEY);
  if (!s) {
    s = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, s);
  }
  return s;
}

const SID = getSid();

// ---------------------------------------------------------------------------
// Write one event to Firestore
// ---------------------------------------------------------------------------

function writeEvent(db: Firestore, evt: AnalyticsEvent): void {
  addDoc(collection(db, 'analytics'), evt).catch((err: { code?: string }) => {
    if (err && err.code === 'permission-denied') {
      console.warn(
        '[TBAnalytics] Firestore permission denied - add the analytics collection rule to Firebase Console -> Firestore -> Rules.',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Public tracking function
// ---------------------------------------------------------------------------

function track(type: string, data?: Record<string, unknown>): void {
  const evt: AnalyticsEvent = {
    type,
    page: window.location.pathname,
    referrer: document.referrer || null,
    sessionId: SID,
    ts: new Date().toISOString(),
    ua: navigator.userAgent.slice(0, 120),
    ...data,
  };

  if (_db) {
    writeEvent(_db, evt);
  } else {
    _queue.push(evt);
  }
}

// ---------------------------------------------------------------------------
// Init Firebase + flush queue
// ---------------------------------------------------------------------------

function initFirebase(): void {
  const cfg = SITE_CONFIG.firebase;
  if (!cfg || !cfg.apiKey) return;

  try {
    _db = getFirestoreDb();
    if (_db) {
      _queue.splice(0).forEach((e) => writeEvent(_db!, e));
    }
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// Boot: initialize and set up auto-tracking
// ---------------------------------------------------------------------------

function boot(): void {
  if (_booted) return;
  _booted = true;

  // Skip admin pages
  if (window.location.pathname.indexOf('/admin') === 0) return;

  initFirebase();
}

// ---------------------------------------------------------------------------
// Auto: page view on load
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.indexOf('/admin') === 0) return;
    track('page_view', { title: document.title });
    boot();
  });

  // Auto: time on page
  window.addEventListener('beforeunload', () => {
    const seconds = Math.round((Date.now() - PAGE_START) / 1000);
    if (seconds > 2) track('time_on_page', { seconds });
  });

  // Auto: click tracking via [data-track] attribute
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.('[data-track]');
      if (!el) return;
      track('click', {
        label: el.getAttribute('data-track'),
        text: (el.textContent || '').trim().slice(0, 80),
      });
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const TBAnalytics = {
  track,
  getSid: (): string => SID,
};

export default TBAnalytics;
