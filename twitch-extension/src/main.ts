import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { CARDS_FIREBASE_CONFIG, PROFILE_URL_BASE } from './firebase-config';

interface UserCollection {
  twitchUserId: string;
  twitchUserLogin: string;
  twitchUserDisplayName: string;
  totalCards: number;
  totalValue: number;
}

type SortMode = 'totalValue' | 'totalCards';

const app = initializeApp(CARDS_FIREBASE_CONFIG);
const db = getFirestore(app);

const appEl = document.getElementById('app')!;
let currentSort: SortMode = 'totalValue';
let unsubscribe: Unsubscribe | null = null;

function openProfile(login: string) {
  const url = PROFILE_URL_BASE + encodeURIComponent(login);
  // Twitch panel extensions can pop external links open in a new tab from a
  // real click event -- this runs inside a user gesture (the row's click
  // handler), which is what lets window.open bypass popup blockers here.
  window.open(url, '_blank', 'noopener,noreferrer');
}

function render(entries: UserCollection[]) {
  const list = entries
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
        subscribe();
      }
    });
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function subscribe() {
  if (unsubscribe) unsubscribe();
  const q = query(collection(db, 'userCollections'), orderBy(currentSort, 'desc'), limit(10));
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs.map((d) => d.data() as UserCollection);
      render(entries);
    },
    (err) => {
      appEl.innerHTML = `<div id="error">Couldn't load leaderboard: ${escapeHtml(err.message)}</div>`;
    },
  );
}

subscribe();
