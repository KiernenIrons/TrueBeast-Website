/**
 * TrueBeast — Cloudflare Worker: Email Proxy
 * ==========================================
 * This Worker sits between your website and Brevo.
 * Your Brevo API key is stored as a Cloudflare secret — never in your source code.
 *
 * DEPLOYMENT STEPS (one-time, ~5 minutes):
 *
 *  1. Go to https://dash.cloudflare.com → sign up free (no credit card needed)
 *  2. Left sidebar → Workers & Pages → Create application → Create Worker
 *  3. Name it "truebeast-email" → Deploy
 *  4. Click "Edit code" → select all → paste the contents of this file → Save and deploy
 *  5. Go to Settings → Variables → under "Environment Variables" click "Add variable"
 *     → Type: Secret  |  Variable name: BREVO_API_KEY  |  Value: (paste your Brevo key)
 *     → Click "Save and deploy"
 *  6. Copy your Worker URL — it looks like:
 *       https://truebeast-email.YOURSUBDOMAIN.workers.dev
 *  7. In js/config.js set:
 *       workerUrl: 'https://truebeast-email.YOURSUBDOMAIN.workers.dev'
 *  8. Push to GitHub — the Brevo key never touches your repository.
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

        // Block requests from origins other than truebeast.io
        if (!ALLOWED_ORIGINS.includes(origin)) {
            return new Response('Forbidden', { status: 403, headers: corsHeaders });
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return new Response('Bad request — expected JSON body', { status: 400, headers: corsHeaders });
        }

        // Forward to Brevo with the secret API key (never exposed to the browser)
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': env.BREVO_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const text = await brevoRes.text();
        return new Response(text, {
            status: brevoRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    },
};
