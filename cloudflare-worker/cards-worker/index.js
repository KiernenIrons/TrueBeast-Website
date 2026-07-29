/**
 * TrueBeast — Cloudflare Worker: Trading Card Game (Twitch EventSub receiver)
 * =============================================================================
 * Receives the "Open a Card Pack" channel-points redemption from Twitch via
 * EventSub (webhook transport), draws the pack server-side (never trust the
 * client), and writes the result to Firestore so the OBS overlay and the
 * website update live. See ../../CARDS_SETUP.md for full setup steps.
 *
 * Routes:
 *   POST /eventsub        — Twitch EventSub webhook (verification + notifications)
 *   GET  /oauth/start      — one-time broadcaster OAuth consent (channel:manage:redemptions)
 *   GET  /oauth/callback   — OAuth callback; exchanges code, creates the subscription
 *   GET  /health           — uptime check
 *
 * Scheduled (Cron Trigger, see wrangler.toml):
 *   Re-checks the EventSub subscription is still `enabled`; recreates it via the
 *   stored refresh token if Twitch ever revoked it (e.g. broadcaster password
 *   change, app re-authorization, etc).
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
 *   TWITCH_CARDS_REFRESH_TOKEN — broadcaster refresh token w/ channel:manage:redemptions
 *                                (obtained once via GET /oauth/start — see below)
 *   OAUTH_STATE_SECRET         — any long random string; signs the OAuth state param
 *   FIREBASE_PROJECT_ID        — the NEW dedicated project id (e.g. "truebeast-cards")
 *   FIREBASE_SERVICE_ACCOUNT_EMAIL — service account email (Firebase Console →
 *                                Project Settings → Service Accounts → Generate key)
 *   FIREBASE_SERVICE_ACCOUNT_KEY   — service account private key (PEM)
 *   WORKER_ORIGIN              — this worker's own https URL, e.g.
 *                                https://truebeast-cards.<subdomain>.workers.dev
 *                                (used by the cron job, which has no incoming
 *                                `request` to read an origin from)
 *
 * This file is intentionally a single self-contained script with no imports
 * from the rest of the repo (see PACK_SIZE/RARITIES/CARD_SET below) so it can
 * be deployed the exact same way as email-proxy.js: paste it directly into
 * the Cloudflare dashboard's Worker editor. No Node/wrangler CLI required.
 *
 * The one-time setup flow:
 *   1. Deploy this worker, note its URL (e.g. https://truebeast-cards.<sub>.workers.dev)
 *   2. Set all secrets above EXCEPT TWITCH_CARDS_REFRESH_TOKEN
 *   3. Visit <worker-url>/oauth/start in a browser while logged in as the broadcaster
 *   4. Approve the requested scope — the callback page shows you a refresh token
 *   5. `wrangler secret put TWITCH_CARDS_REFRESH_TOKEN` and paste it in
 *   6. Visit <worker-url>/oauth/start ONE MORE TIME (or just re-run step 3's flow) —
 *      now that the refresh token secret exists, the callback also auto-creates
 *      the EventSub subscription immediately
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

function pickCardOfRarity(rarity) {
  const pool = CARD_SET.filter((c) => c.rarity === rarity);
  if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  return CARD_SET[Math.floor(Math.random() * CARD_SET.length)]; // fallback, shouldn't happen with the shipped set
}

function drawPack(packSize = PACK_SIZE) {
  const pack = [];
  for (let i = 0; i < packSize; i++) pack.push(pickCardOfRarity(pickRarity()));
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

  const pemContents = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n|\r/g, '');
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

async function refreshTwitchUserToken(env) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.TWITCH_CARDS_REFRESH_TOKEN,
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Twitch refresh failed: ' + JSON.stringify(data));
  return data;
}

async function createEventSubSubscription(env, workerOrigin, userAccessToken) {
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
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

      const cards = drawPack();
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

  let subscriptionResult = null;
  if (env.TWITCH_REWARD_ID && env.TWITCH_EVENTSUB_SECRET) {
    subscriptionResult = await createEventSubSubscription(env, new URL(request.url).origin, tokenData.access_token).catch((e) => ({
      ok: false,
      body: { error: String(e) },
    }));
  }

  return htmlResponse(
    'Authorized',
    `<p>Save this as a Worker secret, then re-run this flow once more so the subscription auto-creates:</p>
     <p><code>wrangler secret put TWITCH_CARDS_REFRESH_TOKEN</code></p>
     <pre>${tokenData.refresh_token}</pre>
     ${subscriptionResult ? `<p>EventSub subscription attempt:</p><pre>${JSON.stringify(subscriptionResult.body || subscriptionResult, null, 2)}</pre>` : '<p>(Subscription not yet attempted — TWITCH_REWARD_ID or TWITCH_EVENTSUB_SECRET secret missing.)</p>'}`,
    true,
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
          if (!env.TWITCH_CARDS_REFRESH_TOKEN) {
            console.warn('No active EventSub subscription and no refresh token stored — run /oauth/start.');
            return;
          }
          const refreshed = await refreshTwitchUserToken(env);
          const workerOrigin = env.WORKER_ORIGIN || '';
          const result = await createEventSubSubscription(env, workerOrigin, refreshed.access_token);
          console.log('Recreated EventSub subscription:', JSON.stringify(result));
        } catch (err) {
          console.error('Subscription-keeper cron failed:', err);
        }
      })(),
    );
  },
};
