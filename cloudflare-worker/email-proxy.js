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

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        const corsHeaders = {
            'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        if (path === '/discord/members' && request.method === 'GET') {
            return handleDiscordMembers(env, corsHeaders);
        }
        if (path === '/discord/react' && request.method === 'POST') {
            return handleDiscordReact(request, env, corsHeaders);
        }
        if (path === '/discord/send' && request.method === 'POST') {
            return handleDiscordSend(request, env, corsHeaders);
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
