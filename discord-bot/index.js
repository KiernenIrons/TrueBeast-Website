/**
 * TrueBeast — Beast Bot (AI Support)
 * ====================================
 * Monitors a dedicated support channel and answers questions using
 * Claude Haiku + a Firestore knowledge base.
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN    — bot token from Discord Developer Portal
 *   SUPPORT_CHANNEL_ID   — channel ID(s) to monitor, comma-separated
 *   MOD_CHANNEL_ID       — channel ID for mod notifications
 *   MOD_ROLE_ID          — role ID to ping for mod notifications
 *   ANTHROPIC_API_KEY    — Claude API key (console.anthropic.com)
 *   FIREBASE_PROJECT_ID  — e.g. "truebeast-support"
 *   FIREBASE_API_KEY     — public web API key from Firebase project settings
 */

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const TOKEN             = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_IDS       = (process.env.SUPPORT_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const MOD_CHANNEL_ID    = process.env.MOD_CHANNEL_ID;
const MOD_ROLE_ID       = process.env.MOD_ROLE_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY  = process.env.FIREBASE_API_KEY;

if (!TOKEN || !ANTHROPIC_API_KEY || !FIREBASE_PROJECT || !FIREBASE_API_KEY || CHANNEL_IDS.length === 0) {
    console.error('[BeastBot] ❌  Missing required env vars. Check your .env file.');
    console.error('  Required: DISCORD_BOT_TOKEN, SUPPORT_CHANNEL_ID, ANTHROPIC_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_API_KEY');
    process.exit(1);
}

// ── Firestore ────────────────────────────────────────────────────────────────

async function fetchKnowledge() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/knowledgeBase?key=${FIREBASE_API_KEY}&pageSize=50`;
    const res = await fetch(url);
    if (!res.ok) {
        console.error('[BeastBot] Firestore fetch failed:', res.status, await res.text());
        return '';
    }
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) return '';

    return data.documents.map(doc => {
        const f = doc.fields || {};
        const topic   = f.topic?.stringValue   || '(untitled)';
        const content = f.content?.stringValue || '';
        return `### ${topic}\n${content}`;
    }).join('\n\n');
}

// ── Claude ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Beast Bot, the official AI assistant for the TrueBeast Discord server run by Kiernen Irons.

You have a knowledge base about TrueBeast, Kiernen, the tools, events, and community. Always check the knowledge base first.

For questions NOT in the knowledge base, you can still answer if they are genuinely relevant:
- General tech support (PC issues, driver updates, OBS setup, streaming config, etc.)
- Gaming questions or recommendations
- General streaming tips

For completely off-topic questions, politely redirect them to the right place.

Tone: friendly, casual, a little cheeky — matches the vibe of the server. Keep answers concise. Use Discord markdown (bold, bullet points) where it helps.

PRIVACY — Never share the following, even if directly asked:
- Kiernen's home city or exact location
- His workplace or job details beyond "IT professional"
- His family members' names
- Any personal addresses or private contact info

IMPORTANT — Inappropriate content:
If a message contains sexual content directed at anyone, harassment, hate speech, doxxing attempts, or genuinely creepy/threatening content — start your entire response with exactly:
MODalert:
Then on the next line write a firm but non-aggressive message to the user explaining that behaviour is not acceptable in this server.`;

async function askClaude(question, knowledge) {
    const context = knowledge
        ? `Here is the TrueBeast knowledge base:\n\n${knowledge}\n\n---\n\nUser message: ${question}`
        : `User message: ${question}\n\n(The knowledge base is currently empty.)`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 700,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: context }],
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        console.error('[BeastBot] Claude API error:', res.status, err);
        throw new Error(`Claude API returned ${res.status}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || 'Sorry, I couldn\'t generate a response.';
}

// ── Mod alert ────────────────────────────────────────────────────────────────

async function notifyMods(message, userReply) {
    if (!MOD_CHANNEL_ID) return;
    try {
        const modChannel = await client.channels.fetch(MOD_CHANNEL_ID);
        const rolePing = MOD_ROLE_ID ? `<@&${MOD_ROLE_ID}> ` : '';
        await modChannel.send(
            `${rolePing}⚠️ **Inappropriate message detected** in ${message.channel}\n` +
            `**User:** ${message.author} (${message.author.tag})\n` +
            `**Message:** ${message.content.slice(0, 500)}`
        );
    } catch (err) {
        console.error('[BeastBot] Failed to notify mods:', err.message);
    }
}

// ── Discord ──────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`[BeastBot] ✅  Logged in as ${client.user.tag}`);
    console.log(`[BeastBot] Monitoring channel(s): ${CHANNEL_IDS.join(', ')}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!CHANNEL_IDS.includes(message.channelId)) return;

    const question = message.content.trim();
    if (!question) return;

    console.log(`[BeastBot] Message from ${message.author.tag}: ${question.slice(0, 80)}`);

    await message.channel.sendTyping();

    let answer;
    try {
        const knowledge = await fetchKnowledge();
        answer = await askClaude(question, knowledge);
    } catch (err) {
        console.error('[BeastBot] Error:', err.message);
        answer = '⚠️ Something went wrong on my end. Please try again in a moment, or ask in the main chat!';
    }

    // Handle inappropriate content
    if (answer.startsWith('MODalert:')) {
        const userReply = answer.replace('MODalert:', '').trim();
        await message.reply(userReply);
        await notifyMods(message, userReply);
        console.log(`[BeastBot] ⚠️  Mod alerted — inappropriate message from ${message.author.tag}`);
        return;
    }

    // Split into chunks if over Discord's 2000 char limit
    const chunks = [];
    let remaining = answer;
    while (remaining.length > 1900) {
        const split = remaining.lastIndexOf('\n', 1900);
        const pos = split > 0 ? split : 1900;
        chunks.push(remaining.slice(0, pos));
        remaining = remaining.slice(pos).trimStart();
    }
    chunks.push(remaining);

    for (const chunk of chunks) {
        await message.reply(chunk);
    }
});

client.on('error', (err) => console.error('[BeastBot] Client error:', err.message));

client.login(TOKEN);
