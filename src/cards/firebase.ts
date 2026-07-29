/**
 * Trading Card Game -- Firebase Client
 * =====================================
 * Deliberately a SEPARATE Firebase app instance (named 'cards') from the
 * main site's default app in src/lib/firebase.ts, since this points at its
 * own dedicated Firebase project (see CARDS_FIREBASE_CONFIG in ./config.ts).
 *
 * All reads here are public (packEvents + userCollections have
 * `allow read: if true` rules) -- writes are rejected for every client and
 * only happen server-side from the Cloudflare Worker via the Admin REST API,
 * so nobody can forge cards from devtools.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { CARDS_FIREBASE_CONFIG, isCardsFirebaseConfigured } from './config';

const APP_NAME = 'cards';

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

function ensureApp(): void {
  if (_app || !isCardsFirebaseConfigured()) return;
  _app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(CARDS_FIREBASE_CONFIG, APP_NAME);
  _db = getFirestore(_app);
}

export function getCardsDb(): Firestore | null {
  ensureApp();
  return _db;
}
