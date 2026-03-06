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

    // After successful send, add reactions if requested, collect errors
    const reactionErrors = [];
    if (res.ok && data.id && Array.isArray(reactions) && reactions.length) {
        for (const emoji of reactions) {
            const rRes = await fetch(
                'https://discord.com/api/v10/channels/' + channelId + '/messages/' + data.id + '/reactions/' + encodeURIComponent(emoji) + '/@me',
                { method: 'PUT', headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } }
            );
            if (!rRes.ok) {
                const rErr = await rRes.json().catch(() => ({}));
                reactionErrors.push({ emoji, status: rRes.status, error: rErr.message || rRes.status });
            }
        }
    }
    const responseData = reactionErrors.length ? Object.assign({}, data, { _reactionErrors: reactionErrors }) : data;
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
