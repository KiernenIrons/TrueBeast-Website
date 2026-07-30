/**
 * TrueBeast — Cloudflare Worker: Trading Card Game (Twitch EventSub receiver)
 * =============================================================================
 * Receives the "Open a Card Pack" channel-points redemption from Twitch via
 * EventSub (webhook transport), draws the pack server-side (never trust the
 * client), and writes the result to Firestore so the OBS overlay and the
 * website update live. See ../../CARDS_SETUP.md for full setup steps.
 *
 * Routes:
 *   POST /eventsub              — Twitch EventSub webhook (verification + notifications)
 *   GET  /oauth/start           — one-time broadcaster OAuth consent (channel:manage:redemptions)
 *   GET  /oauth/callback        — OAuth callback; exchanges code, creates the subscription
 *   GET  /health                — uptime check
 *   POST /admin/upload-image    — admin-only (super admin's Firebase ID token): uploads card
 *                                art to R2, returns its public URL. Called from the website's
 *                                Card Maker tab.
 *   POST /admin/adjust-card     — admin-only: add/remove copies of a card from one viewer's
 *                                collection (manual fixes). Called from the same tab.
 *
 * Scheduled (Cron Trigger, see wrangler.toml):
 *   Re-checks the EventSub subscription is still `enabled`; recreates it (using
 *   an app access token -- see createEventSubSubscription) if Twitch ever
 *   revoked it.
 *
 * Required secrets/variables (set via the Cloudflare dashboard: Worker →
 * Settings → Variables and Secrets — the same place email-proxy.js's are set):
 *   TWITCH_CLIENT_ID           — same Client ID already used by the main site's
 *                                email-proxy worker (Twitch Developer Console)
 *   TWITCH_CLIENT_SECRET       — its Client Secret
 *   TWITCH_BROADCASTER_ID      — same value already used by email-proxy.js's
 *                                VIP feature (Kiernen's numeric Twitch user ID)
 *   TWITCH_EVENTSUB_SECRET     — any long random string (Twitch signs webhook
 *                                payloads with it; you invent this value)
 *   TWITCH_REWARD_ID           — the Custom Reward ID for "Open a Card Pack"
 *                                (create the reward on your dashboard first,
 *                                then look up its ID — see CARDS_SETUP.md)
 *   OAUTH_STATE_SECRET         — any long random string; signs the OAuth state param
 *   FIREBASE_PROJECT_ID        — the NEW dedicated project id (e.g. "truebeast-cards")
 *   FIREBASE_SERVICE_ACCOUNT_EMAIL — service account email (Firebase Console →
 *                                Project Settings → Service Accounts → Generate key)
 *   FIREBASE_SERVICE_ACCOUNT_KEY   — service account private key (PEM)
 *   WORKER_ORIGIN              — this worker's own https URL, e.g.
 *                                https://truebeast-cards.<subdomain>.workers.dev
 *                                (used by the cron job, which has no incoming
 *                                `request` to read an origin from)
 *   CARD_ART_PUBLIC_BASE_URL   — the public R2.dev URL for the CARD_ART_BUCKET
 *                                below (e.g. "https://pub-xxxx.r2.dev"), no
 *                                trailing slash
 *
 * Required binding (Worker → Settings → Bindings → Add → R2 Bucket, NOT a
 * secret/variable -- create the bucket first under Cloudflare → R2, enable
 * its public access there to get the CARD_ART_PUBLIC_BASE_URL above):
 *   CARD_ART_BUCKET            — bind it to your R2 bucket, variable name
 *                                must be exactly CARD_ART_BUCKET
 *
 * Note: the EventSub subscription itself is created with an APP access token
 * (Twitch requires this for webhook-transport subscriptions), never a user
 * token. The /oauth/start consent flow below exists purely so Twitch records
 * that the broadcaster approved channel:manage:redemptions for this Client ID
 * -- nothing from that flow is stored or reused afterward.
 *
 * This file is intentionally a single self-contained script with no imports
 * from the rest of the repo (see PACK_SIZE/RARITIES/CARD_SET below) so it can
 * be deployed the exact same way as email-proxy.js: paste it directly into
 * the Cloudflare dashboard's Worker editor. No Node/wrangler CLI required.
 *
 * The one-time setup flow:
 *   1. Deploy this worker, note its URL (e.g. https://truebeast-cards.<sub>.workers.dev)
 *   2. Set all secrets above EXCEPT TWITCH_REWARD_ID (create the "Open a Card
 *      Pack" reward on your dashboard first, but you don't need its ID yet --
 *      the next step shows it to you)
 *   3. Visit <worker-url>/oauth/start in a browser while logged in as the broadcaster
 *   4. Approve the requested scope — the callback page lists your custom
 *      rewards with their IDs (no separate API call needed)
 *   5. Save TWITCH_REWARD_ID as a Worker secret
 *   6. Visit <worker-url>/oauth/start ONE MORE TIME — now that it's set, the
 *      callback also creates the EventSub subscription immediately
 */

// ── Card config (self-contained on purpose — see note below) ────────────────
//
// This worker is deployed by pasting this single file into the Cloudflare
// dashboard's Worker editor (the same way cloudflare-worker/email-proxy.js
// already is), so it deliberately has NO imports from the rest of the repo.
//
// PACK_SIZE, RARITIES, and CARD_SET below are mirrors of the values in
// src/cards/config.ts / card-sets/starter/cards.json. If you change pack
// size, rarity odds, or the active card set there, copy the same change here
// and redeploy this worker (paste the updated file into the dashboard again).

const PACK_SIZE = 3;

const RARITIES = [
  { id: 'common',    weight: 100, value: 1 },
  { id: 'uncommon',  weight: 45,  value: 3 },
  { id: 'rare',      weight: 18,  value: 8 },
  { id: 'epic',      weight: 6,   value: 20 },
  { id: 'legendary', weight: 1,   value: 75 },
];

// Fallback set only -- used if the live catalog fetch below fails or is
// empty. The real, editable card list lives in Firestore now (see
// fetchLiveCardCatalog), managed via the website's Admin panel "Card Maker"
// tab. Keeping this hardcoded fallback means a redemption still grants a
// pack even if that live fetch has a transient hiccup.
const CARD_SET = [
  { id: 's-slime',    rarity: 'common' },
  { id: 's-crab',     rarity: 'common' },
  { id: 's-bat',      rarity: 'common' },
  { id: 's-mushroom', rarity: 'common' },
  { id: 's-fish',     rarity: 'common' },
  { id: 's-wolf',     rarity: 'uncommon' },
  { id: 's-owl',      rarity: 'uncommon' },
  { id: 's-spider',   rarity: 'uncommon' },
  { id: 's-turtle',   rarity: 'uncommon' },
  { id: 's-fox',      rarity: 'rare' },
  { id: 's-shark',    rarity: 'rare' },
  { id: 's-eagle',    rarity: 'rare' },
  { id: 's-dragon',   rarity: 'epic' },
  { id: 's-phoenix',  rarity: 'epic' },
  { id: 's-beast',    rarity: 'legendary' },
];

// The live card catalog lives in the MAIN site's Firebase project
// (truebeast-support -- same one the Admin panel's "Card Maker" tab writes
// to), not the dedicated truebeast-cards project this worker otherwise
// talks to. Its Firestore rules allow public read, so this is a plain,
// unauthenticated GET -- no service-account credentials needed for it.
const CATALOG_PROJECT_ID = 'truebeast-support';
const CATALOG_API_KEY = 'AIzaSyClA0dmz4D3TDbhwvWmUeVinW6A18NQUUU';
const CATALOG_CACHE_MS = 60_000;

// Only this email may use the /admin/* routes below (manual collection
// fixes). Matches SITE_CONFIG.email.adminEmail in src/config.ts.
const SUPER_ADMIN_EMAIL = 'kiernenyt@gmail.com';
const FIREBASE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function base64UrlDecode(input) {
  return atob(input.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * Verifies a Firebase Auth ID token from the MAIN site's login (truebeast-support
 * project) without needing any SDK -- just checks the RS256 signature against
 * Google's published JWKs and validates the standard claims. This is what lets
 * the admin-only /admin/* routes below trust "this request really came from
 * Kiernen's authenticated browser session," even though that session belongs
 * to a different Firebase project than the one this worker otherwise writes to.
 */
async function verifyFirebaseIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  if (payload.aud !== CATALOG_PROJECT_ID) throw new Error('Token is for the wrong Firebase project');
  if (payload.iss !== `https://securetoken.google.com/${CATALOG_PROJECT_ID}`) throw new Error('Unexpected token issuer');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('Token expired');

  const jwkRes = await fetch(FIREBASE_JWK_URL);
  const jwkData = await jwkRes.json();
  const jwk = (jwkData.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Signing key not found');

  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = Uint8Array.from(base64UrlDecode(sigB64), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, signedData);
  if (!valid) throw new Error('Invalid token signature');

  return payload;
}

async function requireSuperAdmin(request) {
  const auth = request.headers.get('Authorization') || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!idToken) throw new Error('Missing Authorization header');
  const payload = await verifyFirebaseIdToken(idToken);
  if (payload.email !== SUPER_ADMIN_EMAIL) throw new Error('Not authorized');
  return payload;
}
let cachedCatalog = null;
let cachedCatalogAt = 0;

function firestoreValueToJs(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  return null;
}

async function fetchLiveCardCatalog() {
  const now = Date.now();
  if (cachedCatalog && now - cachedCatalogAt < CATALOG_CACHE_MS) return cachedCatalog;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${CATALOG_PROJECT_ID}/databases/(default)/documents/cardCatalog?key=${CATALOG_API_KEY}&pageSize=300`;
    const res = await fetch(url);
    const data = await res.json();
    const docs = data.documents || [];
    if (docs.length === 0) return CARD_SET;
    // Retired cards (active === false, set via the Card Maker's "Retire"
    // button) keep their Firestore doc -- and thus stay visible on anyone's
    // existing collection page -- but are excluded here so new packs never
    // draw them again.
    const catalog = docs
      .map((d) => {
        const id = d.name.split('/').pop();
        const rarity = firestoreValueToJs(d.fields?.rarity) || 'common';
        const active = d.fields?.active === undefined ? true : firestoreValueToJs(d.fields.active);
        return { id, rarity, active };
      })
      .filter((c) => c.active !== false);
    if (catalog.length === 0) return CARD_SET;
    cachedCatalog = catalog;
    cachedCatalogAt = now;
    return catalog;
  } catch (err) {
    console.warn('fetchLiveCardCatalog failed, using hardcoded fallback:', err);
    return CARD_SET;
  }
}

function weightedPick(items) {
  const total = items.reduce((sum, [w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [w, v] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][1];
}

function pickRarity() {
  return weightedPick(RARITIES.map((r) => [r.weight, r.id]));
}

function pickCardOfRarity(cardSet, rarity) {
  const pool = cardSet.filter((c) => c.rarity === rarity);
  if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  return cardSet[Math.floor(Math.random() * cardSet.length)]; // fallback, shouldn't happen with a non-empty set
}

function drawPack(cardSet, packSize = PACK_SIZE) {
  const pack = [];
  for (let i = 0; i < packSize; i++) pack.push(pickCardOfRarity(cardSet, pickRarity()));
  return pack;
}

function cardValue(card) {
  return RARITIES.find((r) => r.id === card.rarity)?.value ?? 0;
}

const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function htmlResponse(title, message, ok) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:sans-serif;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#16213e;border-radius:12px;padding:2rem 2.5rem;max-width:640px;box-shadow:0 4px 24px #0004}
h1{color:${ok ? '#4ade80' : '#ff6b6b'};margin-top:0}pre{white-space:pre-wrap;word-break:break-all;background:#0b0b12;padding:1rem;border-radius:8px}</style>
</head><body><div class="card"><h1>${ok ? '✅' : '❌'} ${title}</h1>${message}</div></body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } },
  );
}

// ── Google service-account auth (for authenticated Firestore Admin writes) ──

async function getGoogleAccessToken(env, scope) {
  const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
  const key = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!email || !key) throw new Error('FIREBASE_SERVICE_ACCOUNT_EMAIL/KEY not set');

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(
    JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  ).replace(/=/g, '');

  // Strips the PEM header/footer plus every kind of line break -- real ones,
  // and literal backslash-n text (a common paste artifact when copying the
  // private_key field out of the downloaded JSON with a plain text editor).
  const pemContents = key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(header + '.' + payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Google token exchange failed: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// ── Firestore REST helpers ───────────────────────────────────────────────────

function fsString(v) {
  return { stringValue: String(v) };
}

function firestoreBaseUrl(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

/** Atomically creates a marker doc; returns false if it already exists (duplicate delivery). */
async function claimIdempotencyKey(env, token, redemptionId) {
  const res = await fetch(`${firestoreBaseUrl(env)}/redemptions?documentId=${encodeURIComponent(redemptionId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { createdAt: fsString(new Date().toISOString()) } }),
  });
  return res.status === 200 || res.status === 201;
}

async function createPackEventDoc(env, token, event) {
  const res = await fetch(`${firestoreBaseUrl(env)}/packEvents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        channelId: fsString(event.channelId),
        redemptionId: fsString(event.redemptionId),
        twitchUserId: fsString(event.twitchUserId),
        twitchUserLogin: fsString(event.twitchUserLogin),
        twitchUserDisplayName: fsString(event.twitchUserDisplayName),
        cardIds: { arrayValue: { values: event.cardIds.map(fsString) } },
        createdAt: fsString(event.createdAt),
      },
    }),
  });
  if (!res.ok) throw new Error('createPackEventDoc failed: ' + (await res.text()));
}

/** Field-path escaping per Firestore's structured-field-path syntax (card ids may contain hyphens). */
function escapeFieldPathSegment(segment) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment) ? segment : '`' + segment.replace(/`/g, '\\`') + '`';
}

async function incrementUserCollection(env, token, { channelId, twitchUserId, twitchUserLogin, twitchUserDisplayName, cardCounts, totalValueGained }) {
  const docId = `${channelId}_${twitchUserId}`;
  const name = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/userCollections/${docId}`;

  const updateTransforms = [
    { fieldPath: 'totalCards', increment: { integerValue: String(Object.values(cardCounts).reduce((a, b) => a + b, 0)) } },
    { fieldPath: 'totalValue', increment: { integerValue: String(totalValueGained) } },
    ...Object.entries(cardCounts).map(([cardId, count]) => ({
      fieldPath: `cards.${escapeFieldPathSegment(cardId)}`,
      increment: { integerValue: String(count) },
    })),
  ];

  const write = {
    update: {
      name,
      fields: {
        channelId: fsString(channelId),
        twitchUserId: fsString(twitchUserId),
        twitchUserLogin: fsString(twitchUserLogin.toLowerCase()),
        twitchUserDisplayName: fsString(twitchUserDisplayName),
        updatedAt: fsString(new Date().toISOString()),
      },
    },
    updateMask: { fieldPaths: ['channelId', 'twitchUserId', 'twitchUserLogin', 'twitchUserDisplayName', 'updatedAt'] },
    updateTransforms,
  };

  const res = await fetch(`${firestoreBaseUrl(env)}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [write] }),
  });
  if (!res.ok) throw new Error('incrementUserCollection failed: ' + (await res.text()));
}

/** Finds an existing userCollections doc for this channel + Twitch login, or null. */
async function findUserCollectionByLogin(env, token, login) {
  const res = await fetch(`${firestoreBaseUrl(env)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'userCollections' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'channelId' }, op: 'EQUAL', value: fsString(env.TWITCH_BROADCASTER_ID) } },
              { fieldFilter: { field: { fieldPath: 'twitchUserLogin' }, op: 'EQUAL', value: fsString(login.toLowerCase()) } },
            ],
          },
        },
        limit: 1,
      },
    }),
  });
  const rows = await res.json();
  const match = (rows || []).find((r) => r.document);
  if (!match) return null;
  const fields = match.document.fields || {};
  const cards = {};
  for (const [k, v] of Object.entries(fields.cards?.mapValue?.fields || {})) {
    cards[k] = firestoreValueToJs(v);
  }
  return {
    twitchUserId: firestoreValueToJs(fields.twitchUserId),
    twitchUserLogin: firestoreValueToJs(fields.twitchUserLogin),
    twitchUserDisplayName: firestoreValueToJs(fields.twitchUserDisplayName),
    cards,
  };
}

/** Resolves a Twitch login to its numeric user ID + display name via the Helix API (app token). */
async function resolveTwitchUserByLogin(env, login) {
  const appToken = await getTwitchAppToken(env);
  const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${appToken}`, 'Client-Id': env.TWITCH_CLIENT_ID },
  });
  const data = await res.json();
  const user = (data.data || [])[0];
  if (!user) return null;
  return { twitchUserId: user.id, twitchUserLogin: user.login, twitchUserDisplayName: user.display_name };
}

// ── Twitch helpers ───────────────────────────────────────────────────────────

async function getTwitchAppToken(env) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Twitch app token failed: ' + JSON.stringify(data));
  return data.access_token;
}

// Twitch requires the CREATE call itself to be authenticated with an app
// access token, not the user token from the OAuth consent screen -- that
// consent step only exists to get Twitch to record that the broadcaster
// approved this scope for this Client ID; it isn't passed to this call.
async function createEventSubSubscription(env, workerOrigin) {
  const appToken = await getTwitchAppToken(env);
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: REDEMPTION_TYPE,
      version: '1',
      condition: { broadcaster_user_id: env.TWITCH_BROADCASTER_ID, reward_id: env.TWITCH_REWARD_ID },
      transport: { method: 'webhook', callback: `${workerOrigin}/eventsub`, secret: env.TWITCH_EVENTSUB_SECRET },
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function listCustomRewards(env, userAccessToken) {
  const res = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${env.TWITCH_BROADCASTER_ID}`, {
    headers: { Authorization: `Bearer ${userAccessToken}`, 'Client-Id': env.TWITCH_CLIENT_ID },
  });
  const data = await res.json();
  return data.data || [];
}

async function findActiveSubscription(env) {
  const appToken = await getTwitchAppToken(env);
  const res = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?type=${REDEMPTION_TYPE}`, {
    headers: { Authorization: `Bearer ${appToken}`, 'Client-Id': env.TWITCH_CLIENT_ID },
  });
  const data = await res.json();
  const list = data.data || [];
  return list.find(
    (s) => s.condition?.broadcaster_user_id === env.TWITCH_BROADCASTER_ID && s.condition?.reward_id === env.TWITCH_REWARD_ID && s.status === 'enabled',
  );
}

// ── HMAC signature verification ──────────────────────────────────────────────

async function verifyTwitchSignature(request, rawBody, secret) {
  const messageId = request.headers.get('Twitch-Eventsub-Message-Id') || '';
  const timestamp = request.headers.get('Twitch-Eventsub-Message-Timestamp') || '';
  const signature = request.headers.get('Twitch-Eventsub-Message-Signature') || '';

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(messageId + timestamp + rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signature === `sha256=${hex}`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

async function handleEventSub(request, env) {
  const rawBody = await request.text();
  const messageType = request.headers.get('Twitch-Eventsub-Message-Type');

  const validSignature = await verifyTwitchSignature(request, rawBody, env.TWITCH_EVENTSUB_SECRET);
  if (!validSignature) return new Response('Invalid signature', { status: 403 });

  const body = JSON.parse(rawBody);

  if (messageType === 'webhook_callback_verification') {
    return new Response(body.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (messageType === 'revocation') {
    console.warn('EventSub subscription revoked:', body.subscription);
    return new Response('', { status: 200 });
  }

  if (messageType === 'notification' && body.subscription?.type === REDEMPTION_TYPE) {
    // Ack fast; Twitch expects a response within a few seconds.
    try {
      const evt = body.event;
      const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/datastore');

      const isNew = await claimIdempotencyKey(env, token, evt.id);
      if (!isNew) return new Response('', { status: 200 }); // duplicate delivery, already processed

      const liveCatalog = await fetchLiveCardCatalog();
      const cards = drawPack(liveCatalog);
      const cardIds = cards.map((c) => c.id);
      const nowIso = new Date().toISOString();

      await createPackEventDoc(env, token, {
        channelId: env.TWITCH_BROADCASTER_ID,
        redemptionId: evt.id,
        twitchUserId: evt.user_id,
        twitchUserLogin: evt.user_login,
        twitchUserDisplayName: evt.user_name,
        cardIds,
        createdAt: nowIso,
      });

      const cardCounts = {};
      for (const c of cards) cardCounts[c.id] = (cardCounts[c.id] || 0) + 1;
      const totalValueGained = cards.reduce((sum, c) => sum + cardValue(c), 0);

      await incrementUserCollection(env, token, {
        channelId: env.TWITCH_BROADCASTER_ID,
        twitchUserId: evt.user_id,
        twitchUserLogin: evt.user_login,
        twitchUserDisplayName: evt.user_name,
        cardCounts,
        totalValueGained,
      });
    } catch (err) {
      console.error('EventSub notification processing failed:', err);
      // Still ack 200 -- Twitch will retry on non-2xx, and we already
      // idempotency-lock on evt.id, so a retry storm is worse than a drop here.
    }
    return new Response('', { status: 200 });
  }

  return new Response('', { status: 200 });
}

async function handleOAuthStart(request, env) {
  if (!env.TWITCH_CLIENT_ID || !env.OAUTH_STATE_SECRET) {
    return htmlResponse('Not Configured', '<p>Set TWITCH_CLIENT_ID and OAUTH_STATE_SECRET secrets first.</p>', false);
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('cards-oauth'));
  const state = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const redirectUri = new URL(request.url).origin + '/oauth/callback';
  const authorizeUrl =
    `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(env.TWITCH_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code` +
    `&scope=${encodeURIComponent('channel:manage:redemptions')}&state=${state}&force_verify=true`;
  return Response.redirect(authorizeUrl, 302);
}

async function handleOAuthCallback(request, env) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const error = params.get('error');
  if (error) return htmlResponse('Declined', `<p>Twitch authorization was declined: ${error}</p>`, false);
  if (!code) return htmlResponse('Bad Request', '<p>Missing ?code from Twitch.</p>', false);

  const redirectUri = new URL(request.url).origin + '/oauth/callback';
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return htmlResponse('Auth Error', `<pre>${JSON.stringify(tokenData, null, 2)}</pre>`, false);
  }

  // This access token already has the right scope to list custom rewards --
  // show them now so there's no separate lookup step for TWITCH_REWARD_ID.
  const rewards = await listCustomRewards(env, tokenData.access_token).catch(() => []);
  const rewardsHtml = rewards.length
    ? `<p>Your custom rewards (copy the <code>id</code> of "Open a Card Pack" into the <code>TWITCH_REWARD_ID</code> secret):</p>
       <pre>${rewards.map((r) => `${r.title}\n  id: ${r.id}`).join('\n\n')}</pre>`
    : '<p>(Could not list custom rewards with this token — make sure "Open a Card Pack" is created on your dashboard first.)</p>';

  // The subscription itself is created with an app access token (see
  // createEventSubSubscription) -- this consent step just needed to happen
  // once so Twitch has this scope on file for the broadcaster + Client ID.
  let subscriptionResult = null;
  if (env.TWITCH_REWARD_ID && env.TWITCH_EVENTSUB_SECRET) {
    subscriptionResult = await createEventSubSubscription(env, new URL(request.url).origin).catch((e) => ({
      ok: false,
      body: { error: String(e) },
    }));
  }

  return htmlResponse(
    'Authorized',
    `${rewardsHtml}
     <p>Once <code>TWITCH_REWARD_ID</code> is saved, visit <code>/oauth/start</code> one more time so the
        EventSub subscription gets created (no need to save anything from this "authorized" step itself).</p>
     ${subscriptionResult ? `<p>EventSub subscription attempt:</p><pre>${JSON.stringify(subscriptionResult.body || subscriptionResult, null, 2)}</pre>` : ''}`,
    true,
  );
}

/** Direct doc GET (public read) so a retired card's rarity can still be looked up for value math. */
async function fetchCardRarity(cardId) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${CATALOG_PROJECT_ID}/databases/(default)/documents/cardCatalog/${encodeURIComponent(cardId)}?key=${CATALOG_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = await res.json();
    return firestoreValueToJs(doc.fields?.rarity) || 'common';
  } catch {
    return null;
  }
}

// Admin-only route (see requireSuperAdmin): manually adjust how many copies of
// a card one viewer owns -- for fixing mistakes, since the game itself never
// exposes a way to add/remove cards outside of a real Twitch redemption.
async function handleAdjustCard(request, env, corsHeaders) {
  try {
    await requireSuperAdmin(request);
  } catch (err) {
    return jsonResponse({ error: err.message }, 401, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
  }

  const twitchLogin = (body.twitchLogin || '').trim().toLowerCase();
  const cardId = (body.cardId || '').trim();
  const delta = Number(body.delta);
  if (!twitchLogin || !cardId || !Number.isInteger(delta) || delta === 0) {
    return jsonResponse({ error: 'twitchLogin, cardId, and a non-zero integer delta are required' }, 400, corsHeaders);
  }

  const rarity = await fetchCardRarity(cardId);
  if (!rarity) return jsonResponse({ error: `Unknown card ID "${cardId}"` }, 404, corsHeaders);

  const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/datastore');

  let target = await findUserCollectionByLogin(env, token, twitchLogin);
  if (!target) {
    const resolved = await resolveTwitchUserByLogin(env, twitchLogin);
    if (!resolved) return jsonResponse({ error: `No Twitch user found for login "${twitchLogin}"` }, 404, corsHeaders);
    target = { ...resolved, cards: {} };
  }

  const currentCount = target.cards[cardId] || 0;
  const actualDelta = Math.max(-currentCount, delta); // never go negative
  if (actualDelta === 0) {
    return jsonResponse({ ok: true, unchanged: true, newCount: currentCount, twitchUserDisplayName: target.twitchUserDisplayName }, 200, corsHeaders);
  }

  const valueDelta = actualDelta * cardValue({ rarity });
  await incrementUserCollection(env, token, {
    channelId: env.TWITCH_BROADCASTER_ID,
    twitchUserId: target.twitchUserId,
    twitchUserLogin: target.twitchUserLogin,
    twitchUserDisplayName: target.twitchUserDisplayName,
    cardCounts: { [cardId]: actualDelta },
    totalValueGained: valueDelta,
  });

  return jsonResponse(
    { ok: true, newCount: currentCount + actualDelta, twitchUserDisplayName: target.twitchUserDisplayName },
    200,
    corsHeaders,
  );
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

// Admin-only route: uploads card art to R2 (Cloudflare's free-tier object
// storage) and returns its permanent public URL. Used instead of Firebase
// Storage, which requires the paid Blaze plan -- and instead of asking for a
// pasted external link, which can rot if that host ever moves/deletes it.
async function handleUploadImage(request, env, corsHeaders) {
  try {
    await requireSuperAdmin(request);
  } catch (err) {
    return jsonResponse({ error: err.message }, 401, corsHeaders);
  }

  if (!env.CARD_ART_BUCKET) return jsonResponse({ error: 'CARD_ART_BUCKET R2 binding not configured on this Worker' }, 500, corsHeaders);
  if (!env.CARD_ART_PUBLIC_BASE_URL) return jsonResponse({ error: 'CARD_ART_PUBLIC_BASE_URL variable not set on this Worker' }, 500, corsHeaders);

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('image/')) return jsonResponse({ error: 'Only image uploads are allowed' }, 400, corsHeaders);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return jsonResponse({ error: 'Empty file' }, 400, corsHeaders);
  if (body.byteLength > MAX_UPLOAD_BYTES) return jsonResponse({ error: 'Image too large (max 5MB)' }, 400, corsHeaders);

  const ext = (contentType.split('/')[1] || 'png').split(';')[0].replace(/[^a-z0-9]/gi, '') || 'png';
  const key = `card-art/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  await env.CARD_ART_BUCKET.put(key, body, { httpMetadata: { contentType } });

  const base = env.CARD_ART_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return jsonResponse({ ok: true, url: `${base}/${key}` }, 200, corsHeaders);
}

const ADMIN_ALLOWED_ORIGINS = ['https://truebeast.io', 'https://www.truebeast.io'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/admin/')) {
      const origin = request.headers.get('Origin') || '';
      const corsHeaders = {
        'Access-Control-Allow-Origin': ADMIN_ALLOWED_ORIGINS.includes(origin) ? origin : ADMIN_ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      if (url.pathname === '/admin/adjust-card' && request.method === 'POST') return handleAdjustCard(request, env, corsHeaders);
      if (url.pathname === '/admin/upload-image' && request.method === 'POST') return handleUploadImage(request, env, corsHeaders);
      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    }

    if (url.pathname === '/health') return jsonResponse({ ok: true });
    if (url.pathname === '/eventsub' && request.method === 'POST') return handleEventSub(request, env);
    if (url.pathname === '/oauth/start') return handleOAuthStart(request, env);
    if (url.pathname === '/oauth/callback') return handleOAuthCallback(request, env);
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const active = await findActiveSubscription(env);
          if (active) return;
          const result = await createEventSubSubscription(env, env.WORKER_ORIGIN || '');
          console.log('Recreated EventSub subscription:', JSON.stringify(result));
        } catch (err) {
          console.error('Subscription-keeper cron failed:', err);
        }
      })(),
    );
  },
};
