/**
 * TrueBeast — Cloudflare Worker: Email Proxy + Discord Proxy
 * ===========================================================
 * Routes email requests from the website to your Google Apps Script,
 * AND proxies Discord API calls so the bot token stays server-side
 * (bypassing Discord's CORS restrictions on browser requests).
 *
 * Secrets to configure in Cloudflare Worker → Settings → Variables:
 *   APPS_SCRIPT_URL    — the Web app URL from your Apps Script deployment
 *   APPS_SCRIPT_SECRET — the secret string you set in Apps Script properties
 *   DISCORD_BOT_TOKEN  — from Discord Dev Portal → Applications → [app] → Bot → Reset Token
 *   DISCORD_GUILD_ID   — your Discord Server ID (right-click server → Copy Server ID)
 *
 * See gmail-apps-script.js for email setup steps.
 *
 * Discord routes (all require Origin: truebeast.io):
 *   GET  /discord/channels  — returns text channels for the configured guild
 *   GET  /discord/emojis    — returns custom emojis for the configured guild
 *   GET  /discord/roles     — returns roles for the configured guild
 *   POST /discord/send      — sends a message to a channel  { channelId, payload, reactions? }
 *   PATCH /discord/edit     — edits an existing message      { channelId, messageId, payload }
 *
 * Firebase Auth routes:
 *   GET  /firebase/users    — lists all Firebase Auth users (requires FIREBASE_SERVICE_ACCOUNT_EMAIL + FIREBASE_SERVICE_ACCOUNT_KEY)
 *   POST /firebase/delete-user — deletes a Firebase Auth user { uid }
 *   POST /firebase/disable-user — disables a Firebase Auth user { uid, disabled }
 *
 * Additional secrets for Firebase Auth management:
 *   FIREBASE_PROJECT_ID            — your Firebase project ID (e.g. "truebeast-support")
 *   FIREBASE_SERVICE_ACCOUNT_EMAIL — service account email from Firebase Console
 *   FIREBASE_SERVICE_ACCOUNT_KEY   — service account private key (PEM format)
 *
 * VIP verification secrets (add in Cloudflare Worker → Settings → Variables):
 *   FIREBASE_API_KEY               — same public web API key the bot uses for Firestore
 *   DISCORD_CLIENT_ID              — Discord app client ID (Developer Portal → OAuth2)
 *   DISCORD_CLIENT_SECRET          — Discord app OAuth2 secret
 *   VIP_STATE_SECRET               — any random string; signs the OAuth state to prevent CSRF
 *   TWITCH_CLIENT_ID               — Twitch application client ID
 *   TWITCH_CLIENT_SECRET           — Twitch application client secret
 *   TWITCH_BROADCASTER_ID          — Kiernen's numeric Twitch user ID
 *   TWITCH_BROADCASTER_REFRESH     — Broadcaster Twitch OAuth refresh token (channel:read:subscriptions scope)
 *   YOUTUBE_CLIENT_ID              — Google/YouTube OAuth client ID
 *   YOUTUBE_CLIENT_SECRET          — Google/YouTube OAuth client secret
 *   YOUTUBE_CREATOR_REFRESH        — Creator YouTube OAuth refresh token (youtube.channel-memberships.creator scope)
 *
 * VIP routes (no auth required — browser navigations):
 *   GET  /vip/start?uid=DISCORD_USER_ID  — redirects to Discord OAuth
 *   GET  /vip/callback                   — handles OAuth callback, writes Firestore
 *   POST /vip/recheck { userId }         — re-checks Twitch/YouTube status (called by bot daily)
 */

const ALLOWED_ORIGINS = [
    'https://truebeast.io',
    'https://www.truebeast.io',
];

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

async function handleDiscordChannels(env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set in Worker secrets' }, 500, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/channels`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleDiscordEmojis(env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set in Worker secrets' }, 500, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/emojis`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleDiscordRoles(env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set in Worker secrets' }, 500, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/roles`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleDiscordThreads(env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set in Worker secrets' }, 500, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/threads/active`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleDiscordMembers(env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set in Worker secrets' }, 500, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleDiscordReact(request, env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN not set in Worker secrets' }, 500, corsHeaders);
    }
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders); }
    const { channelId, messageId, reactions } = body;
    if (!channelId || !messageId || !Array.isArray(reactions)) {
        return jsonResponse({ error: 'channelId, messageId, and reactions required', received: { channelId, messageId, reactionsType: typeof reactions } }, 400, corsHeaders);
    }
    const results = [];
    for (let i = 0; i < reactions.length; i++) {
        const emoji = reactions[i];
        if (i > 0) await new Promise(r => setTimeout(r, 1100));
        const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
        let r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
        for (let retry = 0; retry < 5 && r.status === 429; retry++) {
            const retryBody = await r.json().catch(() => ({}));
            const retryAfter = Math.ceil((retryBody.retry_after || 2) * 1000);
            await new Promise(resolve => setTimeout(resolve, retryAfter + 500));
            r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
        }
        const body204 = r.status === 204 ? null : await r.json().catch(() => null);
        results.push({ emoji, encodedEmoji: encodeURIComponent(emoji), status: r.status, ok: r.ok, discordResponse: body204 });
    }
    const errors = results.filter(r => !r.ok);
    return jsonResponse({ ok: true, results, errors }, 200, corsHeaders);
}

async function handleDiscordSend(request, env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN not set in Worker secrets' }, 500, corsHeaders);
    }
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders); }
    const { channelId, payload, reactions } = body;
    if (!channelId || !payload) {
        return jsonResponse({ error: 'Request must include channelId and payload' }, 400, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        body: JSON.stringify(payload),
    });
    const data = await res.json();

    // After successful send, add reactions if requested, collect results
    const reactionResults = [];
    if (res.ok && data.id && Array.isArray(reactions) && reactions.length) {
        for (let i = 0; i < reactions.length; i++) {
            const emoji = reactions[i];
            if (i > 0) await new Promise(r => setTimeout(r, 1100));
            const url = 'https://discord.com/api/v10/channels/' + channelId + '/messages/' + data.id + '/reactions/' + encodeURIComponent(emoji) + '/@me';
            let rRes = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
            // Retry up to 5 times on rate limit
            for (let retry = 0; retry < 5 && rRes.status === 429; retry++) {
                const retryBody = await rRes.json().catch(() => ({}));
                const retryAfter = Math.ceil((retryBody.retry_after || 2) * 1000);
                await new Promise(r => setTimeout(r, retryAfter + 500));
                rRes = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
            }
            const rBody = rRes.status === 204 ? null : await rRes.json().catch(() => null);
            reactionResults.push({ emoji, encodedEmoji: encodeURIComponent(emoji), status: rRes.status, ok: rRes.ok, discordResponse: rBody });
        }
    }
    const reactionErrors = reactionResults.filter(r => !r.ok);
    const responseData = Object.assign({}, data, {
        _debug: { payloadComponentsCount: (payload.components || []).length, reactionsAttempted: reactions ? reactions.length : 0, reactionResults },
        _reactionErrors: reactionErrors.length ? reactionErrors : undefined,
    });
    return jsonResponse(responseData, res.status, corsHeaders);
}

async function handleDiscordEdit(request, env, corsHeaders) {
    if (!env.DISCORD_BOT_TOKEN) {
        return jsonResponse({ error: 'DISCORD_BOT_TOKEN not set in Worker secrets' }, 500, corsHeaders);
    }
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders); }
    const { channelId, messageId, payload } = body;
    if (!channelId || !messageId || !payload) {
        return jsonResponse({ error: 'channelId, messageId, and payload are required' }, 400, corsHeaders);
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

// ── Firebase Auth Management ──────────────────────────────────────────────

async function getGoogleAccessToken(env) {
    const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
    const key = env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!email || !key) return null;

    // Build JWT
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '');
    const now = Math.floor(Date.now() / 1000);
    const payload = btoa(JSON.stringify({
        iss: email,
        scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    })).replace(/=/g, '');

    // Sign JWT with RSA private key
    const pemContents = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n|\r/g, '');
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(header + '.' + payload));
    const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const jwt = header + '.' + payload + '.' + sig;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();
    return tokenData.access_token || null;
}

async function handleFirebaseListUsers(env, corsHeaders) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return jsonResponse({ error: 'FIREBASE_PROJECT_ID not set' }, 500, corsHeaders);

    const token = await getGoogleAccessToken(env);
    if (!token) return jsonResponse({ error: 'Could not get access token. Check FIREBASE_SERVICE_ACCOUNT_EMAIL and FIREBASE_SERVICE_ACCOUNT_KEY.' }, 500, corsHeaders);

    // Use Identity Toolkit API to list all users
    const allUsers = [];
    let nextPageToken = '';
    do {
        const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet?maxResults=500${nextPageToken ? '&nextPageToken=' + nextPageToken : ''}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (data.error) return jsonResponse({ error: data.error.message }, data.error.code || 500, corsHeaders);
        if (data.users) allUsers.push(...data.users);
        nextPageToken = data.nextPageToken || '';
    } while (nextPageToken);

    // Map to a clean format
    const users = allUsers.map(u => ({
        uid: u.localId,
        email: u.email || null,
        displayName: u.displayName || null,
        photoUrl: u.photoUrl || null,
        disabled: u.disabled || false,
        createdAt: u.createdAt ? new Date(parseInt(u.createdAt)).toISOString() : null,
        lastSignedIn: u.lastLoginAt ? new Date(parseInt(u.lastLoginAt)).toISOString() : null,
        providers: (u.providerUserInfo || []).map(p => p.providerId),
    }));

    return jsonResponse(users, 200, corsHeaders);
}

async function handleFirebaseDeleteUser(request, env, corsHeaders) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return jsonResponse({ error: 'FIREBASE_PROJECT_ID not set' }, 500, corsHeaders);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders); }
    if (!body.uid) return jsonResponse({ error: 'uid required' }, 400, corsHeaders);

    const token = await getGoogleAccessToken(env);
    if (!token) return jsonResponse({ error: 'Auth token failed' }, 500, corsHeaders);

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: [body.uid] }),
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

async function handleFirebaseDisableUser(request, env, corsHeaders) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return jsonResponse({ error: 'FIREBASE_PROJECT_ID not set' }, 500, corsHeaders);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders); }
    if (!body.uid) return jsonResponse({ error: 'uid required' }, 400, corsHeaders);

    const token = await getGoogleAccessToken(env);
    if (!token) return jsonResponse({ error: 'Auth token failed' }, 500, corsHeaders);

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: body.uid, disableUser: body.disabled !== false }),
    });
    const data = await res.json();
    return jsonResponse(data, res.status, corsHeaders);
}

// ── VIP Verification System ───────────────────────────────────────────────────
//
// Required Worker secrets:
//   FIREBASE_API_KEY              — same public key the bot uses for Firestore REST
//   DISCORD_CLIENT_ID             — Discord application client ID (Developer Portal)
//   DISCORD_CLIENT_SECRET         — Discord OAuth2 secret (Developer Portal)
//   VIP_STATE_SECRET              — any random string; signs the OAuth state param
//   TWITCH_CLIENT_ID              — Twitch application client ID
//   TWITCH_CLIENT_SECRET          — Twitch application client secret
//   TWITCH_BROADCASTER_ID         — Kiernen's numeric Twitch user ID
//   TWITCH_BROADCASTER_REFRESH    — Broadcaster OAuth refresh token (channel:read:subscriptions scope)
//   YOUTUBE_CLIENT_ID             — YouTube/GCP OAuth client ID
//   YOUTUBE_CLIENT_SECRET         — YouTube/GCP OAuth client secret
//   YOUTUBE_CREATOR_REFRESH       — Creator OAuth refresh token (youtube.channel-memberships.creator scope)

async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function firestoreGetVipWorker(userId, env) {
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/vipUsers/${userId}?key=${env.FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fields) return null;
    const result = {};
    for (const [k, v] of Object.entries(data.fields)) {
        result[k] = v.integerValue !== undefined ? Number(v.integerValue) : (v.stringValue || '');
    }
    return result;
}

async function firestoreSetVipWorker(userId, data, env) {
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/vipUsers/${userId}?key=${env.FIREBASE_API_KEY}`;
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else fields[k] = { stringValue: String(v) };
    }
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
    });
    return res.ok;
}

async function refreshOAuthToken(refreshToken, clientId, clientSecret, tokenUrl) {
    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    });
    const data = await res.json();
    return data.access_token || null;
}

async function checkTwitchSubscription(twitchUserId, env) {
    if (!env.TWITCH_BROADCASTER_REFRESH || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TWITCH_BROADCASTER_ID) {
        return { active: false, tier: 0 };
    }
    const token = await refreshOAuthToken(env.TWITCH_BROADCASTER_REFRESH, env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET, 'https://id.twitch.tv/oauth2/token');
    if (!token) return { active: false, tier: 0 };

    const res  = await fetch(`https://api.twitch.tv/helix/subscriptions?broadcaster_id=${env.TWITCH_BROADCASTER_ID}&user_id=${twitchUserId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID },
    });
    const data = await res.json();
    if (!data.data || data.data.length === 0) return { active: false, tier: 0 };
    const tierStr = data.data[0].tier || '1000'; // "1000", "2000", "3000"
    return { active: true, tier: Math.min(3, Math.round(Number(tierStr) / 1000)) };
}

async function checkYoutubeMembership(youtubeChannelId, env) {
    if (!env.YOUTUBE_CREATOR_REFRESH || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
        return { active: false, tier: 0 };
    }
    const token = await refreshOAuthToken(env.YOUTUBE_CREATOR_REFRESH, env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, 'https://oauth2.googleapis.com/token');
    if (!token) return { active: false, tier: 0 };

    // Get all membership levels to build a tier map (cheapest first = Tier 1)
    const levelsRes  = await fetch('https://www.googleapis.com/youtube/v3/membershipsLevels?part=snippet', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const levelsData = await levelsRes.json();
    const levels     = (levelsData.items || []).map((l, i) => ({ id: l.id, name: l.snippet?.levelDetails?.displayName, index: i }));

    // Check if this channel ID is a member
    const membersRes  = await fetch(`https://www.googleapis.com/youtube/v3/members?part=snippet&filterByMemberChannelId=${youtubeChannelId}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const membersData = await membersRes.json();
    const member      = (membersData.items || [])[0];
    if (!member) return { active: false, tier: 0 };

    const levelName  = member.snippet?.membershipsDetails?.membershipsDuration?.memberLevelName || '';
    const levelEntry = levels.find(l => l.name === levelName);
    const tier       = levelEntry ? Math.min(3, levelEntry.index + 1) : 1; // default Tier 1 if level unknown
    return { active: true, tier };
}

function vipHtmlPage(title, message, isSuccess) {
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — TrueBeast VIP</title>
<style>body{font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#16213e;border-radius:12px;padding:2rem 2.5rem;text-align:center;max-width:480px;box-shadow:0 4px 24px #0004}
h1{color:${isSuccess ? '#f4c430' : '#ff6b6b'};margin-top:0}p{line-height:1.6}
a{color:#a78bfa;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}</style>
</head>
<body><div class="card"><h1>${isSuccess ? '💎' : '❌'} ${title}</h1><p>${message}</p>
<p><a href="https://truebeast.io">← Back to TrueBeast.io</a></p></div></body></html>`, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
}

async function handleVipStart(request, env) {
    const uid = new URL(request.url).searchParams.get('uid');
    if (!uid || !/^\d{17,20}$/.test(uid)) {
        return vipHtmlPage('Invalid Link', 'This verification link is invalid. Run <code>/vip</code> in Discord to get a fresh one.', false);
    }
    if (!env.DISCORD_CLIENT_ID || !env.VIP_STATE_SECRET) {
        return vipHtmlPage('Not Configured', 'VIP verification is not yet configured. Check back later!', false);
    }

    const state       = `${uid}.${await hmacSign(uid, env.VIP_STATE_SECRET)}`;
    const callbackUrl = new URL(request.url).origin + '/vip/callback';
    const oauthUrl    = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(env.DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=identify+connections&state=${encodeURIComponent(state)}`;
    return Response.redirect(oauthUrl, 302);
}

async function handleVipCallback(request, env) {
    const params    = new URL(request.url).searchParams;
    const code      = params.get('code');
    const stateRaw  = params.get('state');
    const error     = params.get('error');

    if (error) return vipHtmlPage('Access Denied', 'You declined the Discord authorization. Run <code>/vip</code> and try again.', false);
    if (!code || !stateRaw) return vipHtmlPage('Bad Request', 'Missing OAuth parameters.', false);

    const [uid, sig] = stateRaw.split('.');
    if (!uid || !sig) return vipHtmlPage('Invalid State', 'Verification link is malformed. Run <code>/vip</code> for a new one.', false);

    const expectedSig = await hmacSign(uid, env.VIP_STATE_SECRET || '');
    if (sig !== expectedSig) return vipHtmlPage('Security Error', 'State signature mismatch. Run <code>/vip</code> for a fresh link.', false);

    // Exchange code for Discord access token
    const callbackUrl = new URL(request.url).origin + '/vip/callback';
    const tokenRes    = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: callbackUrl }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return vipHtmlPage('Auth Error', 'Could not exchange Discord code. Try again from Discord.', false);

    // Verify Discord user ID matches the uid from state
    const meRes  = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const meData = await meRes.json();
    if (meData.id !== uid) return vipHtmlPage('User Mismatch', 'The Discord account that authorized doesn\'t match the /vip command. Use the same account.', false);

    // Fetch connected accounts
    const connRes  = await fetch('https://discord.com/api/v10/users/@me/connections', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const connData = await connRes.json();
    const twitchConn  = Array.isArray(connData) ? connData.find(c => c.type === 'twitch')  : null;
    const youtubeConn = Array.isArray(connData) ? connData.find(c => c.type === 'youtube') : null;

    // Check Twitch subscription
    let twitchResult  = { active: false, tier: 0 };
    let youtubeResult = { active: false, tier: 0 };

    if (twitchConn?.id) twitchResult  = await checkTwitchSubscription(twitchConn.id, env);
    if (youtubeConn?.id) youtubeResult = await checkYoutubeMembership(youtubeConn.id, env);

    // Load existing VIP data to preserve boost status
    const existing = await firestoreGetVipWorker(uid, env);
    const boostActive = existing?.boostActive === 'true';

    const tiers     = [boostActive ? 1 : 0, twitchResult.active ? twitchResult.tier : 0, youtubeResult.active ? youtubeResult.tier : 0];
    const maxTier   = Math.max(...tiers);

    await firestoreSetVipWorker(uid, {
        boostActive:      String(boostActive),
        twitchActive:     String(twitchResult.active),
        twitchTier:       twitchResult.tier,
        twitchUserId:     twitchConn?.id || existing?.twitchUserId || '',
        youtubeActive:    String(youtubeResult.active),
        youtubeTier:      youtubeResult.tier,
        youtubeChannelId: youtubeConn?.id || existing?.youtubeChannelId || '',
        maxTier,
        verifiedAt:       new Date().toISOString(),
        lastChecked:      new Date().toISOString(),
    }, env);

    const tierLabel = ['None', 'Tier 1', 'Tier 2', 'Tier 3'];
    const lines = [
        `💜 Server Boost: ${boostActive ? '✅' : '❌'}`,
        `🟣 Twitch Sub: ${twitchResult.active ? `✅ ${tierLabel[twitchResult.tier]}` : '❌'} ${twitchConn ? '' : '(no Twitch account connected to Discord)'}`,
        `🔴 YouTube Member: ${youtubeResult.active ? `✅ ${tierLabel[youtubeResult.tier]}` : '❌'} ${youtubeConn ? '' : '(no YouTube account connected to Discord)'}`,
    ].join('<br>');

    const msg = maxTier >= 1
        ? `Your VIP status is now <strong>${tierLabel[maxTier]}</strong>! Go back to Discord and run <code>/vip</code> to pick your perk roles.<br><br>${lines}`
        : `No active VIP qualification found.<br><br>${lines}<br><br>Make sure your Twitch/YouTube accounts are connected in Discord settings, and that you're actively subscribed/membered.`;

    return vipHtmlPage(maxTier >= 1 ? 'Verified!' : 'Not Qualified', msg, maxTier >= 1);
}

async function handleVipRecheck(request, env) {
    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const { userId } = body;
    if (!userId || !/^\d{17,20}$/.test(userId)) return new Response('Invalid userId', { status: 400 });

    const existing = await firestoreGetVipWorker(userId, env);
    if (!existing) return new Response(JSON.stringify({ changed: false, maxTier: 0 }), { headers: { 'Content-Type': 'application/json' } });

    let twitchResult  = { active: existing.twitchActive === 'true', tier: Number(existing.twitchTier) || 0 };
    let youtubeResult = { active: existing.youtubeActive === 'true', tier: Number(existing.youtubeTier) || 0 };

    if (existing.twitchUserId)     twitchResult  = await checkTwitchSubscription(existing.twitchUserId, env);
    if (existing.youtubeChannelId) youtubeResult = await checkYoutubeMembership(existing.youtubeChannelId, env);

    const boostActive = existing.boostActive === 'true';
    const tiers       = [boostActive ? 1 : 0, twitchResult.active ? twitchResult.tier : 0, youtubeResult.active ? youtubeResult.tier : 0];
    const maxTier     = Math.max(...tiers);
    const oldMaxTier  = Number(existing.maxTier) || 0;
    const changed     = maxTier !== oldMaxTier || twitchResult.active !== (existing.twitchActive === 'true') || youtubeResult.active !== (existing.youtubeActive === 'true');

    if (changed) {
        await firestoreSetVipWorker(userId, {
            ...existing,
            twitchActive:  String(twitchResult.active),
            twitchTier:    twitchResult.tier,
            youtubeActive: String(youtubeResult.active),
            youtubeTier:   youtubeResult.tier,
            maxTier,
            lastChecked:   new Date().toISOString(),
        }, env);
    }

    return new Response(JSON.stringify({ changed, maxTier, oldMaxTier }), { headers: { 'Content-Type': 'application/json' } });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        const corsHeaders = {
            'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // ── Discord proxy routes ─────────────────────────────────────────────
        if (path === '/discord/channels' && request.method === 'GET') {
            return handleDiscordChannels(env, corsHeaders);
        }
        if (path === '/discord/emojis' && request.method === 'GET') {
            return handleDiscordEmojis(env, corsHeaders);
        }
        if (path === '/discord/roles' && request.method === 'GET') {
            return handleDiscordRoles(env, corsHeaders);
        }
        if (path === '/discord/threads' && request.method === 'GET') {
            return handleDiscordThreads(env, corsHeaders);
        }
        if (path === '/discord/members' && request.method === 'GET') {
            return handleDiscordMembers(env, corsHeaders);
        }
        if (path === '/discord/react' && request.method === 'POST') {
            return handleDiscordReact(request, env, corsHeaders);
        }
        if (path === '/discord/send' && request.method === 'POST') {
            return handleDiscordSend(request, env, corsHeaders);
        }
        if (path === '/discord/edit' && request.method === 'PATCH') {
            return handleDiscordEdit(request, env, corsHeaders);
        }

        // ── Firebase Auth routes ──────────────────────────────────────────────
        if (path === '/firebase/users' && request.method === 'GET') {
            return handleFirebaseListUsers(env, corsHeaders);
        }
        if (path === '/firebase/delete-user' && request.method === 'POST') {
            return handleFirebaseDeleteUser(request, env, corsHeaders);
        }
        if (path === '/firebase/disable-user' && request.method === 'POST') {
            return handleFirebaseDisableUser(request, env, corsHeaders);
        }

        // ── VIP verification routes (no CORS restriction — browser navigations) ──
        if (path === '/vip/start' && request.method === 'GET') {
            return handleVipStart(request, env);
        }
        if (path === '/vip/callback' && request.method === 'GET') {
            return handleVipCallback(request, env);
        }
        if (path === '/vip/recheck' && request.method === 'POST') {
            return handleVipRecheck(request, env);
        }

        // ── Email proxy (existing) ───────────────────────────────────────────
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return new Response('Bad request — expected JSON body', { status: 400, headers: corsHeaders });
        }

        const appsScriptUrl    = env.APPS_SCRIPT_URL;
        const appsScriptSecret = env.APPS_SCRIPT_SECRET;

        if (!appsScriptUrl) {
            return new Response(
                JSON.stringify({ error: 'APPS_SCRIPT_URL not configured in Worker secrets' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Forward to Google Apps Script (adds the shared secret server-side)
        const payload = { ...body, secret: appsScriptSecret };

        const scriptRes = await fetch(appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow', // Apps Script deployments redirect once
        });

        const text = await scriptRes.text();
        return new Response(text, {
            status: scriptRes.ok ? 200 : scriptRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    },
};
