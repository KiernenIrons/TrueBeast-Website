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
    for (const emoji of reactions) {
        const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;
        const r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
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
            if (i > 0) await new Promise(r => setTimeout(r, 350));
            const url = 'https://discord.com/api/v10/channels/' + channelId + '/messages/' + data.id + '/reactions/' + encodeURIComponent(emoji) + '/@me';
            let rRes = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
            if (rRes.status === 429) {
                const retryBody = await rRes.json().catch(() => ({}));
                const retryAfter = (retryBody.retry_after || 1) * 1000;
                await new Promise(r => setTimeout(r, retryAfter));
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
