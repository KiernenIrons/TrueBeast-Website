import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { CARDS_FIREBASE_CONFIG, PROFILE_URL_BASE } from './firebase-config';

// Twitch injects a global `Twitch` object via the twitch-ext.min.js script
// tag in index.html -- no npm types for it, so declare just what we use.
declare const Twitch: {
  ext: {
    onContext: (callback: (context: { theme: 'light' | 'dark' }) => void) => void;
  };
};

// Twitch tells us the active theme (viewers can be on light or dark mode);
// default to dark until the first callback fires.
document.documentElement.dataset.theme = 'dark';
if (typeof Twitch !== 'undefined') {
  Twitch.ext.onContext((context) => {
    if (context.theme) document.documentElement.dataset.theme = context.theme;
  });
}

interface UserCollection {
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  totalCards: number;
  totalValue: number;
}

interface PackEvent {
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  cardIds: string[];
  createdAt: string;
}

type SortMode = 'totalValue' | 'totalCards';

// Minimal mirror of card-sets/starter/cards.json + src/cards/config.ts's
// RARITIES -- only what's needed to announce "X pulled a Legendary!" without
// pulling in art/gradients. This is a THIRD copy of the card data (alongside
// the website and the Cloudflare Worker) because Twitch requires this
// extension's JS to be a fully self-contained bundle with no shared imports
// across projects. Keep in sync if the card set or rarities change.
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};
const CARD_LOOKUP: Record<string, { name: string; rarity: string }> = {
  's-slime': { name: 'Sludge Pup', rarity: 'common' },
  's-crab': { name: 'Snap Crab', rarity: 'common' },
  's-bat': { name: 'Cave Flit', rarity: 'common' },
  's-mushroom': { name: 'Spore Walker', rarity: 'common' },
  's-fish': { name: 'Glimmer Carp', rarity: 'common' },
  's-wolf': { name: 'Ember Wolf', rarity: 'uncommon' },
  's-owl': { name: 'Nightglass Owl', rarity: 'uncommon' },
  's-spider': { name: 'Web Warden', rarity: 'uncommon' },
  's-turtle': { name: 'Shellback Titan', rarity: 'uncommon' },
  's-fox': { name: 'Prism Fox', rarity: 'rare' },
  's-shark': { name: 'Ridgefin Shark', rarity: 'rare' },
  's-eagle': { name: 'Stormcrest Eagle', rarity: 'rare' },
  's-dragon': { name: 'Ashfall Wyrm', rarity: 'epic' },
  's-phoenix': { name: 'Solstice Phoenix', rarity: 'epic' },
  's-beast': { name: 'TrueBeast', rarity: 'legendary' },
};

const ANNOUNCEMENT_DURATION_MS = 5000;

const app = initializeApp(CARDS_FIREBASE_CONFIG);
const db = getFirestore(app);

const appEl = document.getElementById('app')!;
let currentSort: SortMode = 'totalValue';
let leaderboardUnsub: Unsubscribe | null = null;
let latestEntries: UserCollection[] = [];

let announcementQueue: PackEvent[] = [];
let showingAnnouncement = false;

function openProfile(login: string) {
  const url = PROFILE_URL_BASE + encodeURIComponent(login);
  // Twitch panel extensions can pop external links open in a new tab from a
  // real click event -- this runs inside a user gesture (the row's click
  // handler), which is what lets window.open bypass popup blockers here.
  window.open(url, '_blank', 'noopener,noreferrer');
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderLeaderboard() {
  if (showingAnnouncement) return; // don't fight with an in-progress announcement

  const list = latestEntries
    .map(
      (e, i) => `
      <div class="row" data-login="${e.twitchUserLogin}">
        <div class="rank">${i + 1}</div>
        <div class="name">${escapeHtml(e.twitchUserDisplayName || e.twitchUserLogin)}</div>
        <div class="value">${currentSort === 'totalValue' ? e.totalValue : e.totalCards}</div>
      </div>`,
    )
    .join('');

  appEl.innerHTML = `
    <div class="header">🃏 Card Leaderboard</div>
    <div class="tabs">
      <div class="tab ${currentSort === 'totalValue' ? 'active' : ''}" data-sort="totalValue">Most Valuable</div>
      <div class="tab ${currentSort === 'totalCards' ? 'active' : ''}" data-sort="totalCards">Most Cards</div>
    </div>
    <div class="list">
      ${list || '<div id="loading">No collectors yet -- redeem "Open a Card Pack" on stream!</div>'}
    </div>
    <div class="footer">Click a name to view their full collection</div>
  `;

  appEl.querySelectorAll<HTMLDivElement>('.row').forEach((row) => {
    row.addEventListener('click', () => openProfile(row.dataset.login!));
  });

  appEl.querySelectorAll<HTMLDivElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const sort = tab.dataset.sort as SortMode;
      if (sort !== currentSort) {
        currentSort = sort;
        subscribeLeaderboard();
      }
    });
  });
}

function bestCardFromPack(cardIds: string[]): { name: string; rarity: string } | null {
  let best: { name: string; rarity: string } | null = null;
  let bestRank = -1;
  for (const id of cardIds) {
    const card = CARD_LOOKUP[id];
    if (!card) continue;
    const rank = RARITY_ORDER.indexOf(card.rarity as (typeof RARITY_ORDER)[number]);
    if (rank > bestRank) {
      bestRank = rank;
      best = card;
    }
  }
  return best;
}

function renderAnnouncement(evt: PackEvent) {
  const best = bestCardFromPack(evt.cardIds);
  const who = escapeHtml(evt.twitchUserDisplayName || evt.twitchUserLogin);
  const line = best
    ? `<strong>${who}</strong> just pulled a<br/><span class="rarity-${best.rarity}">${RARITY_LABEL[best.rarity]}: ${escapeHtml(best.name)}</span>!`
    : `<strong>${who}</strong> just opened a pack!`;

  appEl.innerHTML = `
    <div class="header">🃏 Card Leaderboard</div>
    <div class="announcement">
      <div class="announcement-emoji">🔥</div>
      <div class="announcement-text">${line}</div>
    </div>
  `;
}

function processAnnouncementQueue() {
  if (showingAnnouncement) return;
  const next = announcementQueue.shift();
  if (!next) return;

  showingAnnouncement = true;
  renderAnnouncement(next);

  setTimeout(() => {
    showingAnnouncement = false;
    if (announcementQueue.length > 0) {
      processAnnouncementQueue();
    } else {
      renderLeaderboard();
    }
  }, ANNOUNCEMENT_DURATION_MS);
}

function subscribeLeaderboard() {
  if (leaderboardUnsub) leaderboardUnsub();
  const q = query(collection(db, 'userCollections'), orderBy(currentSort, 'desc'), limit(10));
  leaderboardUnsub = onSnapshot(
    q,
    (snap) => {
      latestEntries = snap.docs.map((d) => d.data() as UserCollection);
      renderLeaderboard();
    },
    (err) => {
      appEl.innerHTML = `<div id="error">Couldn't load leaderboard: ${escapeHtml(err.message)}</div>`;
    },
  );
}

function subscribeAnnouncements() {
  const sinceIso = new Date().toISOString();
  const q = query(collection(db, 'packEvents'), where('createdAt', '>', sinceIso), orderBy('createdAt', 'asc'));
  onSnapshot(q, (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'added') {
        announcementQueue.push(change.doc.data() as PackEvent);
      }
    }
    processAnnouncementQueue();
  });
}

subscribeLeaderboard();
subscribeAnnouncements();

// Safety net: if nothing has rendered after a few seconds (e.g. Firestore's
// domain isn't allowlisted in the extension's Capabilities config yet, so
// the connection just hangs instead of erroring), show something actionable
// instead of "Loading leaderboard..." forever.
setTimeout(() => {
  if (document.getElementById('loading')) {
    appEl.innerHTML = `<div id="error">Still loading after 8s -- check that firestore.googleapis.com is allowlisted under this extension's Capabilities tab in the Twitch dev console.</div>`;
  }
}, 8000);
