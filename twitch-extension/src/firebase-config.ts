/**
 * Same public Firebase web config as src/cards/config.ts on the main site --
 * these are the public Firestore SDK config values (protected by security
 * rules, not by secrecy), so duplicating them here for this separately-built
 * extension bundle is safe. Keep in sync if you ever rotate the project.
 */
export const CARDS_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDHvQn2RVR53m0dS-T15SY02LQj0pMDU1s',
  authDomain: 'truebeast-cards.firebaseapp.com',
  projectId: 'truebeast-cards',
  storageBucket: 'truebeast-cards.firebasestorage.app',
  messagingSenderId: '122003455746',
  appId: '1:122003455746:web:0e1bf3e3fb1f23bf788c1b',
};

export const PROFILE_URL_BASE = 'https://truebeast.io/cards/u/';
