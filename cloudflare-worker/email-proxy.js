/**
 * TrueBeast — Cloudflare Worker: Email Proxy
 * ==========================================
 * Routes email requests from the website to your Google Apps Script,
 * which sends the email directly from your Gmail account.
 * No third-party email service needed — uses Gmail directly.
 *
 * Secrets to configure in Cloudflare Worker → Settings → Variables:
 *   APPS_SCRIPT_URL    — the Web app URL from your Apps Script deployment
 *   APPS_SCRIPT_SECRET — the secret string you set in Apps Script properties
 *
 * See gmail-apps-script.js for full setup steps.
 */

const ALLOWED_ORIGINS = [
    'https://truebeast.io',
    'https://www.truebeast.io',
];

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        const corsHeaders = {
            'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

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
