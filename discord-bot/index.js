/**
 * TrueBeast — Beast Bot (AI Support)
 * ====================================
 * Monitors a dedicated support channel and answers questions using
 * Claude Haiku + a Firestore knowledge base + live Discord/Steam context.
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN    — bot token from Discord Developer Portal
 *   SUPPORT_CHANNEL_ID   — channel ID(s) to monitor, comma-separated
 *   MOD_CHANNEL_ID       — channel ID for mod notifications
 *   MOD_ROLE_ID          — role ID to ping for mod notifications
 *   ANTHROPIC_API_KEY    — Claude API key
 *   FIREBASE_PROJECT_ID  — e.g. "truebeast-support"
 *   FIREBASE_API_KEY     — public web API key from Firebase
 *   STEAM_API_KEY        — Steam Web API key (store.steampowered.com/dev/apikey)
 *   STEAM_ID             — Steam 64-bit ID
 */

require('dotenv').config();

const {
    Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    SlashCommandBuilder, REST, Routes, AttachmentBuilder,
} = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
try { GlobalFonts.loadFontsFromDir('/usr/share/fonts'); } catch (_) {}

const TOKEN             = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_IDS       = (process.env.SUPPORT_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const MOD_CHANNEL_ID    = process.env.MOD_CHANNEL_ID;
const MOD_ROLE_ID       = process.env.MOD_ROLE_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY  = process.env.FIREBASE_API_KEY;
const STEAM_API_KEY     = process.env.STEAM_API_KEY;
const STEAM_ID          = process.env.STEAM_ID || '76561198254213878';
const OWNER_DISCORD_ID  = '392450364340830208';

if (!TOKEN || !ANTHROPIC_API_KEY || !FIREBASE_PROJECT || !FIREBASE_API_KEY || CHANNEL_IDS.length === 0) {
    console.error('[BeastBot] ❌  Missing required env vars.');
    process.exit(1);
}

// ── In-memory state ───────────────────────────────────────────────────────────
// Queue of unanswered questions waiting for a button click:
//   questionId -> { question, askerId, askerTag, channelId, messageId }
const questionQueue = new Map();

// Active answering session per DM channel (one at a time):
//   dmChannelId -> { questionId, question, askerId, askerTag, channelId, messageId, state, answer? }
const activeSession = new Map();

// Conversation history per user (for context-aware replies):
//   userId -> [{ role: 'user'|'assistant', content: string }, ...]
const conversationHistory = new Map();
const MAX_HISTORY_EXCHANGES = 6; // keep last 6 back-and-forths (12 messages)

function getHistory(userId) {
    return conversationHistory.get(userId) || [];
}

function appendHistory(userId, userMessage, assistantMessage) {
    const history = getHistory(userId);
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: assistantMessage });
    // Trim to last MAX_HISTORY_EXCHANGES exchanges
    const maxMessages = MAX_HISTORY_EXCHANGES * 2;
    if (history.length > maxMessages) history.splice(0, history.length - maxMessages);
    conversationHistory.set(userId, history);
}

function makeQuestionId() {
    return `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Firestore ────────────────────────────────────────────────────────────────

async function firestoreSet(collection, docId, data) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else fields[k] = { stringValue: String(v) };
    }
    try {
        await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    } catch (e) { console.error(`[BeastBot] firestoreSet ${collection}/${docId} failed:`, e.message); }
}

async function firestoreGet(collection, docId) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.fields) return null;
        const result = {};
        for (const [k, v] of Object.entries(data.fields)) {
            result[k] = v.integerValue ? Number(v.integerValue) : v.stringValue || '';
        }
        return result;
    } catch (e) { return null; }
}

async function fetchKnowledge() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/knowledgeBase?key=${FIREBASE_API_KEY}&pageSize=50`;
    try {
        const res = await fetch(url);
        if (!res.ok) return '';
        const data = await res.json();
        if (!data.documents?.length) return '';
        return data.documents.map(doc => {
            const f = doc.fields || {};
            return `### ${f.topic?.stringValue || '(untitled)'}\n${f.content?.stringValue || ''}`;
        }).join('\n\n');
    } catch (e) {
        console.error('[BeastBot] Firestore fetch failed:', e.message);
        return '';
    }
}

async function saveUnansweredQuestion(question, author, channelName, channelId, messageId) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/unansweredQuestions?key=${FIREBASE_API_KEY}`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    question:  { stringValue: question },
                    askedBy:   { stringValue: author.tag },
                    channel:   { stringValue: channelName },
                    timestamp: { stringValue: new Date().toISOString() },
                    answered:  { booleanValue: false },
                },
            }),
        });
        console.log(`[BeastBot] Saved unanswered question from ${author.tag}`);
    } catch (e) {
        console.error('[BeastBot] Failed to save unanswered question:', e.message);
    }

    // DM Kiernen with Answer / Skip buttons for each question independently
    try {
        const owner      = await client.users.fetch(OWNER_DISCORD_ID);
        const dmChannel  = await owner.createDM();
        const questionId = makeQuestionId();

        questionQueue.set(questionId, {
            question, askerId: author.id, askerTag: author.tag, channelId, messageId,
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`answer:${questionId}`)
                .setLabel('Answer')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`skip:${questionId}`)
                .setLabel('Skip')
                .setStyle(ButtonStyle.Secondary),
        );

        await dmChannel.send({
            content:
                `❓ **Unanswered question**\n` +
                `**From:** ${author.tag}\n` +
                `**Channel:** #${channelName}\n` +
                `**Question:** ${question}`,
            components: [row],
        });

        console.log(`[BeastBot] DM sent to owner (${questionId}): "${question.slice(0, 60)}"`);
    } catch (e) {
        console.error('[BeastBot] Failed to DM owner:', e.message);
    }
}

async function reformatAnswer(question, rawAnswer) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: `You are formatting a knowledge base entry for Beast Bot, an AI assistant for the TrueBeast Discord server.
You will receive a question and a casual answer from Kiernen (TrueBeast). Your job is to rewrite the answer as a clean, well-written knowledge base entry.
- Write in third person about Kiernen (e.g. "Kiernen wears..." not "I wear...")
- Keep it concise and factual
- Fix any typos or grammar
- Do NOT include a heading, title, or markdown # — just the plain answer text
- Return ONLY the formatted answer text, nothing else`,
            messages: [{ role: 'user', content: `Question: ${question}\nKiernen's answer: ${rawAnswer}` }],
        }),
    });
    if (!res.ok) return rawAnswer;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || rawAnswer;
}

async function saveToKnowledgeBase(question, answer) {
    const id    = `user-answer-${Date.now()}`;
    const topic = question.length > 80 ? question.slice(0, 80) + '…' : question;
    const url   = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/knowledgeBase/${id}?key=${FIREBASE_API_KEY}`;
    const res   = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { topic: { stringValue: topic }, content: { stringValue: answer } } }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

// ── Discord live context ──────────────────────────────────────────────────────

async function fetchDiscordContext(guild) {
    const parts = [];

    try {
        const events   = await guild.scheduledEvents.fetch();
        const now      = new Date();
        const upcoming = [...events.values()]
            .filter(e => e.scheduledStartAt > now)
            .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt)
            .slice(0, 5);
        if (upcoming.length > 0) {
            const list = upcoming.map(e =>
                `- **${e.name}**: ${e.scheduledStartAt.toDateString()}${e.description ? ` — ${e.description}` : ''}`
            ).join('\n');
            parts.push(`### Upcoming Discord Events\n${list}`);
        }
    } catch (e) {
        console.error('[BeastBot] Could not fetch scheduled events:', e.message);
    }

    const announcementsChannel = guild.channels.cache.find(c =>
        c.isTextBased?.() && c.name.toLowerCase().includes('announcement')
    );
    if (announcementsChannel) {
        try {
            const msgs = await announcementsChannel.messages.fetch({ limit: 5 });
            if (msgs.size > 0) {
                const list = [...msgs.values()].map(m =>
                    `[${m.createdAt.toDateString()}] ${m.content.slice(0, 400)}`
                ).join('\n');
                parts.push(`### Recent Announcements\n${list}`);
            }
        } catch (e) {
            console.error('[BeastBot] Could not fetch announcements:', e.message);
        }
    }

    const eventsChannel = guild.channels.cache.find(c =>
        c.isTextBased?.() &&
        c.name.toLowerCase().includes('event') &&
        c.id !== announcementsChannel?.id
    );
    if (eventsChannel) {
        try {
            const msgs = await eventsChannel.messages.fetch({ limit: 5 });
            if (msgs.size > 0) {
                const list = [...msgs.values()].map(m =>
                    `[${m.createdAt.toDateString()}] ${m.content.slice(0, 400)}`
                ).join('\n');
                parts.push(`### Recent Events Posts\n${list}`);
            }
        } catch (e) {
            console.error('[BeastBot] Could not fetch events channel:', e.message);
        }
    }

    return parts.join('\n\n');
}

// ── Steam ─────────────────────────────────────────────────────────────────────

async function fetchSteamGames() {
    if (!STEAM_API_KEY || !STEAM_ID) return '';
    try {
        const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${STEAM_API_KEY}&steamid=${STEAM_ID}&count=5&format=json`;
        const res = await fetch(url);
        if (!res.ok) return '';
        const data  = await res.json();
        const games = data.response?.games;
        if (!games?.length) return '### Kiernen\'s Recently Played Games (Steam)\nNothing played recently.';
        const list = games.map(g => {
            const hrs = Math.round(g.playtime_2weeks / 60 * 10) / 10;
            return `- **${g.name}** (${hrs}h in the last 2 weeks)`;
        }).join('\n');
        return `### Kiernen's Recently Played Games (Steam)\n${list}`;
    } catch (e) {
        console.error('[BeastBot] Steam fetch failed:', e.message);
        return '';
    }
}

// ── Claude ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Beast Bot, the official AI assistant for the TrueBeast Discord server run by Kiernen Irons.

You have a knowledge base about TrueBeast, Kiernen, the tools, events, and community. You also receive live context from Discord (announcements, upcoming events) and Steam (recently played games). Always use the most up-to-date info available.

You are not just a support bot — you live in the server and can have normal conversations. Use context clues from the message:
- If someone is asking a genuine question, answer it
- If someone is just chatting, making a statement, or bantering, chat back naturally — don't force a "support answer" where there isn't one
- If someone is making a joke or being playful, you can play along

For questions NOT in the knowledge base, you can still answer if they are genuinely relevant:
- General tech support (PC issues, driver updates, OBS setup, streaming config, etc.)
- Gaming questions or recommendations
- General streaming tips

You MUST respond with a JSON object in this EXACT format (no text outside it):
{
  "known": true,
  "inappropriate": false,
  "response": "your message here"
}

Set "known": false ONLY when:
- Someone asks something specific about Kiernen's personal opinions, preferences, or private details that are NOT in the knowledge base — do NOT guess, set known to false
- A question is specifically about TrueBeast/the server and the answer genuinely isn't in your knowledge base

Do NOT set "known": false for casual chat, banter, general statements, or questions you can reasonably answer. Casual conversation is always "known": true.

When "known" is false, write a response like: "That's not something I have the answer to right now — but I've flagged it for Kiernen and he'll reply here when he gets a chance! 👀"
Vary the wording slightly each time so it doesn't sound robotic. Always make clear Kiernen will reply directly to their message.

Set "inappropriate": true when the message contains sexual content directed at anyone, harassment, hate speech, doxxing attempts, or creepy/threatening content.
When "inappropriate" is true, write a firm but non-aggressive response to the user.

PRIVACY — Never share, even if directly asked:
- Kiernen's home city or exact location
- His workplace or job details beyond "IT professional"
- His family members' names
- Any personal addresses or private contact info

Tone: friendly, casual, a little cheeky — matches the vibe of the server. Keep answers concise. Use Discord markdown where it helps.

Personality:
- Dry humour is welcome when it fits naturally — don't force a joke where there isn't one
- Use emojis sparingly but meaningfully — one or two max, not on every sentence
- It's fine to be slightly self-aware or playful about being a bot if it comes up naturally
- Don't be robotic or overly formal, but don't try too hard to sound cool either — just be genuine
- If something's funny, lean into it. If it's not, don't pretend it is

JOKES — When someone asks you for a joke, tell me a joke, make me laugh, etc.:
- Actually be funny. No "why did the chicken cross the road" garbage. No dad jokes unless they're genuinely clever.
- Dark humour, absurdist humour, observational comedy, self-deprecating wit — all fair game
- Think stand-up comedian energy, not a joke book from 2003
- Roast culture is fine — if someone asks to be roasted, don't hold back (keep it playful, not cruel)
- You can be edgy without crossing into genuinely offensive territory (no racism, sexism, homophobia etc.)
- Shock value alone isn't funny — the joke still needs to be clever
- If someone keeps asking for more jokes, don't recycle. Each one should feel fresh.
- It's OK to set up a joke with a story or scenario — not everything has to be a one-liner

CRITICAL: Your entire reply must be valid JSON. No text before or after the JSON object.`;

async function askClaude(question, knowledge, discordContext, steamContext, history = []) {
    const contextParts = [];
    if (knowledge)      contextParts.push(`## Knowledge Base\n${knowledge}`);
    if (discordContext) contextParts.push(`## Live Discord Context\n${discordContext}`);
    if (steamContext)   contextParts.push(`## Live Steam Context\n${steamContext}`);

    const currentUserContent = contextParts.length
        ? `${contextParts.join('\n\n')}\n\n---\n\nUser message: ${question}`
        : `User message: ${question}`;

    // Build messages array: prior history + current message
    const messages = [
        ...history,
        { role: 'user', content: currentUserContent },
    ];

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
            messages,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        console.error('[BeastBot] Claude API error:', res.status, err);
        throw new Error(`Claude API returned ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    try {
        const cleaned = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        const parsed  = JSON.parse(cleaned);
        return {
            known:         parsed.known         !== false,
            inappropriate: parsed.inappropriate === true,
            response:      parsed.response || 'Sorry, I couldn\'t generate a response.',
        };
    } catch (e) {
        console.warn('[BeastBot] Claude returned non-JSON, falling back. Raw:', text.slice(0, 200));
        return { known: true, inappropriate: false, response: text || 'Sorry, I couldn\'t generate a response.' };
    }
}

// ── Mod alert ────────────────────────────────────────────────────────────────

async function notifyMods(message) {
    if (!MOD_CHANNEL_ID) return;
    try {
        const modChannel = await client.channels.fetch(MOD_CHANNEL_ID);
        const rolePing   = MOD_ROLE_ID ? `<@&${MOD_ROLE_ID}> ` : '';
        await modChannel.send(
            `${rolePing}⚠️ **Inappropriate message detected** in ${message.channel}\n` +
            `**User:** ${message.author} (${message.author.tag})\n` +
            `**Message:** ${message.content.slice(0, 500)}`
        );
    } catch (e) {
        console.error('[BeastBot] Failed to notify mods:', e.message);
    }
}

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Channel],
});

const COUNTING_CHANNEL_ID = '1486479498248585277';
const BUMP_CHANNEL_ID    = '1477361149862482053';
const LOG_CHANNEL_ID     = '1339916490744397896';
const INTRO_CHANNEL_ID   = process.env.INTRO_CHANNEL_ID || '';
const GIVEAWAY_CHANNEL_ID  = '836728871356989491';
const BUMP_INTERVAL      = 2 * 60 * 60 * 1000; // 2 hours
const DISCADIA_INTERVAL  = 24 * 60 * 60 * 1000; // 24 hours
const DISBOARD_BOT_ID    = '302050872383242240';
const DISCADIA_BOT_ID    = '1222548162741538938';
let bumpTimer     = null;
let discadiaTimer = null;

// ── Temp Voice Channels ───────────────────────────────────────────────────────
const TEMP_VC_TRIGGER_ID = '1484970124292128992';
// channelId → { ownerId, ownerName, deleteTimer }
const tempVoiceChannels = new Map();

// ── AFK system ────────────────────────────────────────────────────────────────
// userId → { reason, originalNickname, timestamp }
const afkUsers = new Map();

// ── Introductions ─────────────────────────────────────────────────────────────

async function hasIntroduced(userId) {
    if (!INTRO_CHANNEL_ID) return false;
    try {
        const ch = await client.channels.fetch(INTRO_CHANNEL_ID);
        const msgs = await ch.messages.fetch({ limit: 100 });
        return msgs.some(m =>
            m.author.id === client.user.id &&
            m.embeds.length > 0 &&
            m.content?.includes(`<@${userId}>`)
        );
    } catch (_) { return false; }
}

// ── Member Spotlight ──────────────────────────────────────────────────────────
const SPOTLIGHT_CHANNEL_ID = '401913227166089238';
let spotlightTimer = null;

// ── Member Milestones ─────────────────────────────────────────────────────────
const messageCounts        = new Map(); // userId → total message count
const messageDays          = new Map(); // userId → Map<"YYYY-MM-DD", count>
const memberNameCache      = new Map(); // userId → displayName (populated at startup, kept fresh)
const memberCache          = new Map(); // userId → { displayName, avatarUrl } (for image generation)
const MILESTONE_THRESHOLDS = [100, 500, 1000, 2500, 5000, 10000];
const MILESTONE_EMOJIS     = ['💯', '🔥', '🏆', '⭐', '💎', '👑'];

// ── Voice time tracking ───────────────────────────────────────────────────────
const voiceStartTimes    = new Map(); // userId → { startMs, baseTotal, baseToday }
const leaderboardOwners  = new Map(); // messageId → userId (who invoked /leaderboard)
const voiceMinutes       = new Map(); // userId → { total: number, days: Map<"YYYY-MM-DD", minutes> }
const voiceBonusXp       = new Map(); // userId → { total: number, days: Map<"YYYY-MM-DD", xp> } — camera/stream bonus
const voiceEnhancements  = new Map(); // userId → { camera: boolean, stream: boolean, inStage: boolean }

// ── Counting game ─────────────────────────────────────────────────────────────
let countingState = {
    current: 0,       // current count (0 = not started / just reset)
    lastUserId: null,  // userId who sent the last correct number
    record: 0,         // all-time highest count reached before a fail
    ruinedBy: [],      // [{ userId, count, at }] — up to 20, most recent first
};
let countingRenameTimeout = null;
let countingLastRenameAt  = 0;
const COUNTING_RENAME_THROTTLE = 5 * 60 * 1000; // Discord allows ~2 renames per 10 min

function scheduleCountingRename(channel) {
    const doRename = async () => {
        countingLastRenameAt  = Date.now();
        countingRenameTimeout = null;
        const name = countingState.current > 0
            ? `💯│counting [${countingState.current}]`
            : '💯│counting';
        await channel.setName(name).catch(() => {});
    };
    const sinceLast = Date.now() - countingLastRenameAt;
    if (sinceLast >= COUNTING_RENAME_THROTTLE) {
        doRename();
    } else if (!countingRenameTimeout) {
        countingRenameTimeout = setTimeout(doRename, COUNTING_RENAME_THROTTLE - sinceLast);
    }
    // If already scheduled, it will pick up the latest countingState.current when it fires
}
const voiceRankRoleCache = new Map(); // roleName → Role object
const rankAchievements   = new Map(); // userId → { highestRankIdx: number, apexCount: number, hitApexThisMonth: boolean }
const AFK_CHANNEL_ID     = process.env.AFK_CHANNEL_ID || '';
const MONTHLY_RECAP_CHANNEL = '1486021237548257330'; // swap to 1324878590101159957 after testing

const VOICE_RANK_ROLES = [
    { id: '1486023901330018335', name: '🥉 Bronze I',      minXp: 0      },
    { id: '1486023902231527597', name: '🥉 Bronze II',     minXp: 80     },
    { id: '1486023903150342204', name: '🥈 Silver I',      minXp: 240    },
    { id: '1486023903691276408', name: '🥈 Silver II',     minXp: 500    },
    { id: '1486023904412569660', name: '🥇 Gold I',        minXp: 850    },
    { id: '1486023904777470204', name: '🥇 Gold II',       minXp: 1700   },
    { id: '1486023905867993168', name: '💠 Platinum',      minXp: 3500   },
    { id: '1486023907004911808', name: '💎 Diamond',       minXp: 5500   },
    { id: '1486023909181751296', name: '🔥 Master',        minXp: 8000   },
    { id: '1486023909944983592', name: '⚔️ Grandmaster',   minXp: 13000  },
    { id: '1486023910205165579', name: '👑 Apex Predator', minXp: 20000  },
];

// 1 message = 1 equivalent voice minute → 60 msgs ≡ 1h in VC
const MSGS_TO_MIN = 1;

// Discord.me: fires at the start of each 6-hour bump window (00:00, 06:00, 12:00, 18:00 UTC)
function scheduleDiscordMeReminder() {
    const now         = new Date();
    const currentHour = now.getUTCHours();
    const nextWindow  = [0, 6, 12, 18].find(h => h > currentHour);
    const next        = new Date(now);

    if (nextWindow !== undefined) {
        next.setUTCHours(nextWindow, 0, 0, 0);
    } else {
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(0, 0, 0, 0);
    }

    setTimeout(async () => {
        try {
            const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
            await channel.send('⏰ New bump window open! Head to <https://discord.me/dashboard#bumpModal> to bump the server on Discord.me.');
            console.log('[BeastBot] 🔔 Sent Discord.me bump reminder');
        } catch (e) {
            console.error('[BeastBot] Failed to send Discord.me bump reminder:', e.message);
        }
        scheduleDiscordMeReminder();
    }, next - now);

    console.log(`[BeastBot] Discord.me bump reminder scheduled for ${next.toUTCString()}`);
}

// Discadia: posts a reminder with a confirm button; timer starts when button is clicked
async function postDiscadiaReminder() {
    try {
        const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('discadia:bumped')
                .setLabel('✅ I bumped it')
                .setStyle(ButtonStyle.Success),
        );
        await channel.send({
            content: '⏰ Time to bump on Discadia! <https://discadia.com/bump/truebeasts/>',
            components: [row],
        });
        console.log('[BeastBot] 🔔 Sent Discadia bump reminder');
    } catch (e) {
        console.error('[BeastBot] Failed to send Discadia bump reminder:', e.message);
    }
}

function scheduleDiscadiaReminder(delayMs = DISCADIA_INTERVAL) {
    if (discadiaTimer) clearTimeout(discadiaTimer);
    const fireAt = Date.now() + delayMs;
    firestoreSet('botTimers', 'discadia', { fireAt, updatedAt: new Date().toISOString() });
    discadiaTimer = setTimeout(postDiscadiaReminder, delayMs);
    console.log(`[BeastBot] Discadia bump reminder scheduled for ${new Date(fireAt).toUTCString()}`);
}

function scheduleBumpReminder() {
    if (bumpTimer) clearTimeout(bumpTimer);
    const fireAt = Date.now() + BUMP_INTERVAL;
    // Persist so it survives restarts
    firestoreSet('botTimers', 'disboard', { fireAt, updatedAt: new Date().toISOString() });
    bumpTimer = setTimeout(async () => {
        try {
            const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
            await channel.send('⏰ Time to bump! Run `/bump` to keep the server visible on Disboard.');
            console.log('[BeastBot] 🔔 Sent Disboard bump reminder');
        } catch (e) {
            console.error('[BeastBot] Failed to send bump reminder:', e.message);
        }
    }, BUMP_INTERVAL);
    console.log(`[BeastBot] Disboard bump reminder scheduled for ${new Date(fireAt).toUTCString()}`);
}

async function postMemberSpotlight() {
    try {
        const channel = await client.channels.fetch(SPOTLIGHT_CHANNEL_ID);
        const guild   = channel.guild;
        await guild.members.fetch();
        const eligible = guild.members.cache.filter(m =>
            !m.user.bot &&
            m.id !== OWNER_DISCORD_ID &&
            m.joinedTimestamp < Date.now() - 7 * 24 * 60 * 60 * 1000 // joined at least a week ago
        );
        if (eligible.size === 0) return;
        const picked = eligible.random();
        const roles  = picked.roles.cache
            .filter(r => r.id !== guild.id) // exclude @everyone
            .sort((a, b) => b.position - a.position)
            .first(3)
            .map(r => `<@&${r.id}>`)
            .join(', ');
        const joinDate   = `<t:${Math.floor(picked.joinedTimestamp / 1000)}:R>`;
        const accountAge = `<t:${Math.floor(picked.user.createdTimestamp / 1000)}:R>`;

        const embed = {
            color: 0x22c55e,
            author: {
                name: '⭐ Member Spotlight',
                icon_url: guild.iconURL({ dynamic: true }),
            },
            title: picked.displayName,
            thumbnail: { url: picked.user.displayAvatarURL({ dynamic: true, size: 256 }) },
            description:
                `This week's spotlight is on **${picked.displayName}**! 🎉\n\n` +
                `This is a chance for the community to get to know each other better. ` +
                `${picked.displayName}, feel free to share a bit about yourself — what you're into, what games you play, ` +
                `or anything you'd like people to know!`,
            fields: [
                { name: '🗓️ Joined Server', value: joinDate, inline: true },
                { name: '📅 Account Created', value: accountAge, inline: true },
                { name: '🏷️ Roles', value: roles || 'None yet!', inline: false },
            ],
            footer: { text: 'Member Spotlight — every week a new community member gets the stage' },
            timestamp: new Date().toISOString(),
        };

        await channel.send({
            content: `Hey ${picked}! You've been selected for this week's **Member Spotlight** 🌟`,
            embeds: [embed],
        });
        console.log(`[BeastBot] 🌟 Member Spotlight: ${picked.user.tag}`);
    } catch (e) {
        console.error('[BeastBot] Member Spotlight failed:', e.message);
    }
}

function scheduleSpotlight() {
    const now  = new Date();
    const next = new Date(now);
    // Find next Thursday at 12:00 UTC
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 4=Thu
    let daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    // If it's Thursday but past noon, go to next week
    if (daysUntilThursday === 0 && now.getUTCHours() >= 12) daysUntilThursday = 7;
    next.setUTCDate(now.getUTCDate() + daysUntilThursday);
    next.setUTCHours(12, 0, 0, 0);

    const delay = next - now;
    if (spotlightTimer) clearTimeout(spotlightTimer);
    spotlightTimer = setTimeout(async () => {
        await postMemberSpotlight();
        scheduleSpotlight(); // re-schedule for next Thursday
    }, delay);
    console.log(`[BeastBot] Member Spotlight scheduled for ${next.toUTCString()}`);
}

// ── Counting game ─────────────────────────────────────────────────────────────

async function saveCountingState() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/counting/state?key=${FIREBASE_API_KEY}`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                current:    { integerValue: String(countingState.current) },
                lastUserId: { stringValue: countingState.lastUserId || '' },
                record:     { integerValue: String(countingState.record) },
                ruinedBy:   { arrayValue: { values: countingState.ruinedBy.map(r => ({
                    mapValue: { fields: {
                        userId: { stringValue: r.userId },
                        count:  { integerValue: String(r.count) },
                        at:     { integerValue: String(r.at) },
                    }},
                })) } },
            }}),
        });
    } catch (e) { console.error('[BeastBot] saveCountingState error:', e.message); }
}

async function handleCountingMessage(message) {
    if (message.author.bot) return;

    const trimmed = message.content.trim();
    const num = parseInt(trimmed, 10);
    const isValidNumber = !isNaN(num) && String(num) === trimmed && num > 0;

    // Not a valid positive integer — delete silently
    if (!isValidNumber) {
        await message.delete().catch(() => {});
        return;
    }

    // Same person sent twice in a row — delete and warn
    if (message.author.id === countingState.lastUserId) {
        await message.delete().catch(() => {});
        const w = await message.channel.send(`<@${message.author.id}> You can't count twice in a row — wait for someone else!`);
        setTimeout(() => w.delete().catch(() => {}), 6000);
        return;
    }

    const expected = countingState.current + 1;

    // Wrong number — fail!
    if (num !== expected) {
        const ruinedAt = countingState.current;
        const isNewRecord = ruinedAt > countingState.record;
        if (isNewRecord) countingState.record = ruinedAt;

        countingState.ruinedBy.unshift({ userId: message.author.id, count: ruinedAt, at: Date.now() });
        if (countingState.ruinedBy.length > 20) countingState.ruinedBy.pop();
        countingState.current = 0;
        countingState.lastUserId = null;
        if (countingRenameTimeout) { clearTimeout(countingRenameTimeout); countingRenameTimeout = null; }
        countingLastRenameAt = Date.now(); // lock out schedule until throttle expires
        await saveCountingState();

        await message.react('❌').catch(() => {});

        // Tally wall of shame
        const shameTally = {};
        for (const r of countingState.ruinedBy) {
            if (!shameTally[r.userId]) shameTally[r.userId] = { count: 0, highest: 0 };
            shameTally[r.userId].count++;
            if (r.count > shameTally[r.userId].highest) shameTally[r.userId].highest = r.count;
        }
        const shameList = Object.entries(shameTally)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([uid, d], i) => `${i + 1}. <@${uid}> — ruined **${d.count}x** (highest at **${d.highest}**)`)
            .join('\n');

        await message.channel.send({ embeds: [{
            color: 0xff4444,
            title: '💥 Counting Failed!',
            description: `<@${message.author.id}> sent **${num}** but the next number was **${expected}**.\nThe count resets to **0**. Type **1** to start again!`,
            fields: [
                { name: `🏆 Best Run${isNewRecord ? ' 🎉 New Record!' : ''}`, value: `**${countingState.record}**`, inline: true },
                { name: '💀 Ruined At', value: `**${ruinedAt}**`, inline: true },
                ...(shameList ? [{ name: '🪦 Wall of Shame', value: shameList }] : []),
            ],
            footer: { text: 'Type 1 to start a new round!' },
        }] });

        await message.channel.setName(`💯│counting [max: ${countingState.record}]`).catch(() => {});
        return;
    }

    // Correct number!
    countingState.current = num;
    countingState.lastUserId = message.author.id;
    if (num > countingState.record) countingState.record = num;

    scheduleCountingRename(message.channel);
    await saveCountingState();
    if (num % 10 === 0) await message.react('🎉').catch(() => {});
}

// ── Member Milestones ─────────────────────────────────────────────────────────

async function saveMessageCount(userId, count) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/messageCounts/${userId}?key=${FIREBASE_API_KEY}`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { count: { integerValue: String(count) } } }),
        });
    } catch (_) {}
}

async function saveMessageDays(userId, daysMap) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/messageCounts/${userId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=days`;
    const dayFields = {};
    for (const [k, v] of daysMap.entries()) dayFields[k] = { integerValue: String(v) };
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { days: { mapValue: { fields: dayFields } } } }),
        });
        if (!res.ok) console.error(`[BeastBot] saveMessageDays failed for ${userId}: ${res.status} ${await res.text()}`);
    } catch (e) { console.error('[BeastBot] saveMessageDays error:', e.message); }
}

async function saveVoiceMinutes(userId, data) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/voiceMinutes/${userId}?key=${FIREBASE_API_KEY}`;
    const dayFields = {};
    for (const [k, v] of Object.entries(data.days)) dayFields[k] = { integerValue: String(v) };
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    total: { integerValue: String(data.total) },
                    days:  { mapValue: { fields: dayFields } },
                },
            }),
        });
        if (!res.ok) console.error(`[BeastBot] saveVoiceMinutes FAILED for ${userId}: ${res.status} ${await res.text()}`);
    } catch (e) { console.error('[BeastBot] saveVoiceMinutes error:', e.message); }
}

async function saveVoiceBonusXp(userId, data) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/voiceBonusXp/${userId}?key=${FIREBASE_API_KEY}`;
    const dayFields = {};
    for (const [k, v] of Object.entries(data.days)) dayFields[k] = { integerValue: String(Math.floor(v)) };
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                total: { integerValue: String(Math.floor(data.total)) },
                days:  { mapValue: { fields: dayFields } },
            }}),
        });
    } catch (e) { console.error('[BeastBot] saveVoiceBonusXp error:', e.message); }
}

async function saveRankAchievements(userId, ach) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/rankAchievements/${userId}?key=${FIREBASE_API_KEY}`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                highestRankIdx: { integerValue: String(ach.highestRankIdx) },
                apexCount:      { integerValue: String(ach.apexCount) },
            }}),
        });
    } catch (e) { console.error('[BeastBot] saveRankAchievements error:', e.message); }
}

function todayStr() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Update voiceMinutes in-memory for an active session (idempotent — safe to call every minute)
// Returns the updated data object, or null if no active session
function creditVoiceTime(uid) {
    const session = voiceStartTimes.get(uid);
    if (!session) return null;
    const elapsed = Math.floor((Date.now() - session.startMs) / 60000);
    const today = todayStr();
    let data = voiceMinutes.get(uid) || { total: 0, days: new Map() };
    data.total = session.baseTotal + elapsed;
    data.days.set(today, session.baseToday + elapsed);
    voiceMinutes.set(uid, data);
    return data;
}

function getTotal(daysMap, total, period) {
    if (period === 'all') return total;
    const today = todayStr();
    if (period === 'today') return daysMap.get(today) ?? 0;
    if (period === 'week') {
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            sum += daysMap.get(d.toISOString().slice(0, 10)) ?? 0;
        }
        return sum;
    }
    if (period === 'month') {
        const prefix = today.slice(0, 7);
        let sum = 0;
        for (const [k, v] of daysMap.entries()) {
            if (k.startsWith(prefix)) sum += v;
        }
        return sum;
    }
    return 0;
}

async function checkMessageMilestone(message) {
    const userId = message.author.id;
    const count  = (messageCounts.get(userId) || 0) + 1;
    messageCounts.set(userId, count);

    // Update daily message count
    const today = todayStr();
    let dMap = messageDays.get(userId);
    if (!dMap) { dMap = new Map(); messageDays.set(userId, dMap); }
    dMap.set(today, (dMap.get(today) ?? 0) + 1);

    // Always persist daily count so Today leaderboard survives restarts
    saveMessageDays(userId, dMap);
    // Every 10 messages: persist total + sync rank (messages contribute to activity score)
    if (count % 10 === 0) {
        saveMessageCount(userId, count);
        if (message.member) assignVoiceRank(message.member, monthlyActivityScore(userId)).catch(() => {});
    }

    const idx = MILESTONE_THRESHOLDS.indexOf(count);
    if (idx === -1) return;
    const emoji = MILESTONE_EMOJIS[idx] || '🎉';

    try {
        const mileCh = await client.channels.fetch(BUMP_CHANNEL_ID);
        await mileCh.send({
            content: `<@${userId}>`,
            embeds: [{
                color: 0x22c55e,
                title: `${emoji} Message Milestone!`,
                description: `**${message.member?.displayName || message.author.username}** just hit **${count.toLocaleString()} messages** in the server! Keep it up! 🎉`,
                thumbnail: { url: message.author.displayAvatarURL({ dynamic: true, size: 128 }) },
                timestamp: new Date().toISOString(),
            }],
        });
    } catch (e) {
        console.error('[BeastBot] Milestone post failed:', e.message);
    }
}

async function checkAnniversaries() {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        const guild   = channel.guild;
        await guild.members.fetch();
        const now   = new Date();
        const today = `${now.getMonth()}-${now.getDate()}`;

        guild.members.cache.forEach(async (member) => {
            if (member.user.bot) return;
            const joined = member.joinedAt;
            if (!joined) return;
            const joinDay = `${joined.getMonth()}-${joined.getDate()}`;
            if (joinDay !== today) return;

            const yearsInServer = now.getFullYear() - joined.getFullYear();
            if (yearsInServer < 1) return;

            try {
                await channel.send({
                    embeds: [{
                        color: 0xfbbf24,
                        title: '🎂 Server Anniversary!',
                        description: `**${member.displayName}** has been in the server for **${yearsInServer} year${yearsInServer > 1 ? 's' : ''}** today!`,
                        thumbnail: { url: member.user.displayAvatarURL({ dynamic: true, size: 128 }) },
                        timestamp: new Date().toISOString(),
                    }],
                });
            } catch (_) {}
        });
    } catch (e) {
        console.error('[BeastBot] Anniversary check failed:', e.message);
    }
}

// ── Gleam Giveaway Finder ─────────────────────────────────────────────────────

const postedGiveawayIds = new Set();

// Categories in display order — first keyword match wins
const GIVEAWAY_CATEGORIES = [
    {
        name: '🎮 Gaming',
        color: 0x22c55e, // green
        keywords: [
            'game', 'steam', 'xbox', 'playstation', 'ps4', 'ps5', 'nintendo', 'switch',
            'roblox', 'robux', 'gaming', 'gamer', 'valorant', 'minecraft', 'fortnite',
            'csgo', 'dota', 'league of legends', 'esport', 'console', 'dlc', 'battle pass',
            'twitch drops', 'pase batallas', // "pase batallas" = battle pass in Spanish
        ],
    },
    {
        name: '💻 Tech & Gadgets',
        color: 0x3b82f6, // blue
        keywords: [
            'tech', 'gadget', 'gpu', 'cpu', 'monitor', 'keyboard', 'mouse', 'headset',
            'headphones', 'phone', 'laptop', 'hardware', 'zotac', 'iphone', 'android',
            'apple', 'samsung', '3d print', 'computer', 'printer', 'modular',
        ],
    },
    {
        name: '🎵 Music & Entertainment',
        color: 0xa855f7, // purple
        keywords: [
            'music', 'guitar', 'album', 'podcast', 'movie', 'film', 'concert', 'vinyl',
            'band', 'song', 'spotify', 'series', 'netflix', 'signed ', 'sherlock',
            'resident evil', 'village of shadows', 'blueprints',
        ],
    },
    {
        name: '🛍️ Lifestyle & Prizes',
        color: 0xf97316, // orange
        keywords: [
            'gift card', 'sofa', 'furniture', 'food', 'drink', 'coffee', 'tea', 'beauty',
            'skincare', 'wellness', 'sleep', 'knife', 'paracord', 'supplement', 'fitness',
            'sport', 'fashion', 'clothing', 'krispy kreme', 'cash', '$', '€', '£',
        ],
    },
];

const GIVEAWAY_OTHER = { name: '🎁 Other', color: 0xfbbf24 };

function classifyGiveaway(title) {
    const lower = title.toLowerCase();
    for (const cat of GIVEAWAY_CATEGORIES) {
        if (cat.keywords.some(k => lower.includes(k))) return cat;
    }
    return GIVEAWAY_OTHER;
}


async function fetchGleamGiveaways() {
    try {
        const res = await fetch('https://sweepsdb.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html',
            },
        });
        if (!res.ok) { console.error('[BeastBot] SweepsDB returned:', res.status); return []; }
        const html = await res.text();

        // Split into contest blocks by the contest_title anchor
        const blocks = html.split('<a class="contest_title"');
        const results = [];

        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];

            // Only keep Gleam platform giveaways
            if (!block.includes("Platform: Gleam")) continue;

            // Extract go/ ID and slug
            const hrefMatch  = block.match(/href="go\/(\d+)"/);
            const titleMatch = block.match(/^[^>]*>([^<]+)/);
            if (!hrefMatch || !titleMatch) continue;

            const id    = hrefMatch[1];
            const title = titleMatch[1].trim().replace(/\s+/g, ' ');
            if (!id || !title || postedGiveawayIds.has(id)) continue;

            // Extract "ends in" text
            const endsMatch = block.match(/Ends in <span[^>]*>([^<]+)<\/span>/);
            const endsIn    = endsMatch ? endsMatch[1].trim() : null;

            // Extract entry count
            const entriesMatch = block.match(/<span class='text-color-tertiary'>(\d+)<\/span>/);
            const entries      = entriesMatch ? parseInt(entriesMatch[1]) : null;

            results.push({ id, title, sweepsId: id, endsIn, entries });
        }

        // Set contest URLs (SweepsDB redirect — daily limit of 10 applies)
        for (const g of results) {
            g.contestUrl = `https://sweepsdb.com/go/${g.sweepsId}`;
        }

        return results;
    } catch (e) {
        console.error('[BeastBot] Failed to fetch from SweepsDB:', e.message);
        return [];
    }
}

async function checkAndPostGiveaways() {
    const giveaways = await fetchGleamGiveaways();
    if (giveaways.length === 0) { console.log('[BeastBot] Giveaway check: no new Gleam giveaways found'); return; }

    // Mark all as posted before sending
    giveaways.forEach(g => postedGiveawayIds.add(g.id));

    try {
        const channel = await client.channels.fetch(GIVEAWAY_CHANNEL_ID);

        // Group by category, preserving display order
        const groupMap = new Map();
        for (const g of giveaways) {
            const cat = classifyGiveaway(g.title);
            if (!groupMap.has(cat.name)) groupMap.set(cat.name, { cat, items: [] });
            groupMap.get(cat.name).items.push(g);
        }

        // Post a header message, then one embed per category
        await channel.send(
            `🎁 **${giveaways.length} Active Gleam Giveaway${giveaways.length !== 1 ? 's' : ''}** — <t:${Math.floor(Date.now() / 1000)}:R>`
        );

        const MAX_DESC = 4000;
        let totalEmbeds = 0;

        for (const { cat, items } of groupMap.values()) {
            // Build lines for this category
            const lines = items.map(g => {
                const meta = [
                    g.endsIn  ? `⏳ ${g.endsIn}`                          : null,
                    g.entries ? `🎟️ ${g.entries.toLocaleString()} entries` : null,
                ].filter(Boolean).join('  •  ');
                return `**[${g.title}](${g.contestUrl})**${meta ? `\n${meta}` : ''}`;
            });

            // Split into chunks if needed
            const chunks = [];
            let current = '';
            for (const line of lines) {
                const sep = current ? '\n\n' : '';
                if (current.length + sep.length + line.length > MAX_DESC) {
                    chunks.push(current);
                    current = line;
                } else {
                    current += sep + line;
                }
            }
            if (current) chunks.push(current);

            for (let i = 0; i < chunks.length; i++) {
                await channel.send({
                    embeds: [{
                        color: cat.color,
                        title: `${cat.name} (${items.length})${chunks.length > 1 ? ` — part ${i + 1}` : ''}`,
                        description: chunks[i],
                        footer: { text: '⚠️ SweepsDB has a daily limit of 10 links per person • Click wisely!' },
                    }],
                });
                totalEmbeds++;
            }
        }

        console.log(`[BeastBot] 🎁 Posted ${giveaways.length} Gleam giveaway(s) across ${totalEmbeds} embed(s)`);
    } catch (e) {
        console.error('[BeastBot] Failed to post giveaways:', e.message);
    }
}

function scheduleGiveawayCheck() {
    // Fire at 9:00 AM and 9:00 PM UTC daily
    function msUntilNext9() {
        const now = new Date();
        const h = now.getUTCHours();
        const next = new Date(now);
        next.setUTCMinutes(0, 0, 0);
        if (h < 9)       next.setUTCHours(9);
        else if (h < 21)  next.setUTCHours(21);
        else { next.setUTCDate(next.getUTCDate() + 1); next.setUTCHours(9); }
        return next - now;
    }
    function tick() {
        checkAndPostGiveaways();
        setTimeout(tick, msUntilNext9());
    }
    const delay = msUntilNext9();
    console.log(`[BeastBot] 🎁 Next giveaway check in ${Math.round(delay / 60000)}m`);
    setTimeout(tick, delay);
}

// ── Temp Voice Channel logic ──────────────────────────────────────────────────

async function logToChannel(msg) {
    try {
        const ch = await client.channels.fetch(LOG_CHANNEL_ID);
        await ch.send(msg);
    } catch (_) {}
}

async function createTempVC(state) {
    const member  = state.member;
    const guild   = state.guild;
    const trigger = guild.channels.cache.get(TEMP_VC_TRIGGER_ID);
    const categoryId = trigger?.parentId || null;
    const channelName = `${member.displayName}'s Channel`;

    await logToChannel(`🔊 **Temp VC triggered** by ${member.user.tag} — creating \`${channelName}\` (category: ${categoryId || 'none'})`);

    try {
        const permOverwrites = [
            // Channel owner — full VC management rights
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers,
                    PermissionFlagsBits.PrioritySpeaker,
                    PermissionFlagsBits.Stream,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.UseVAD,
                    PermissionFlagsBits.SendMessages,
                ],
            },
            // Bot — needs ManageChannels to delete the VC later
            {
                id: client.user.id,
                allow: [
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                ],
            },
        ];

        // Mods get full management rights too
        if (MOD_ROLE_ID) {
            permOverwrites.push({
                id: MOD_ROLE_ID,
                allow: [
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.SendMessages,
                ],
            });
        }

        // Server owner (Kiernen) always gets full rights
        const guildOwner = await guild.fetchOwner().catch(() => null);
        if (guildOwner && guildOwner.id !== member.id) {
            permOverwrites.push({
                id: guildOwner.id,
                allow: [
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Speak,
                    PermissionFlagsBits.SendMessages,
                ],
            });
        }

        const tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: categoryId,
            permissionOverwrites: permOverwrites,
            reason: `Temp VC for ${member.user.tag}`,
        });

        // Move them in
        await member.voice.setChannel(tempChannel);

        // Track it
        tempVoiceChannels.set(tempChannel.id, {
            ownerId: member.id,
            ownerName: member.displayName,
            deleteTimer: null,
        });

        // Post a commands guide in the VC's built-in text chat
        // Small delay so Discord fully initialises the VC text channel before we post
        await new Promise(r => setTimeout(r, 1500));
        try {
            await tempChannel.send({
                embeds: [{
                    color: 0x22c55e,
                    title: `🎙️ ${channelName}`,
                    description: `${member}, this is your channel. Auto-deletes **1 min after everyone leaves**.`,
                    fields: [
                        {
                            name: '⚙️ Controls',
                            value:
                                '- **Rename / user limit** — right-click channel → Edit Channel\n' +
                                '- **Mute / kick** — right-click a member in the VC\n' +
                                '- **Lock** — Edit Channel → Permissions → deny Connect for @everyone',
                        },
                        {
                            name: '💤 AFK',
                            value:
                                '`/afk [reason]`\n' +
                                '> Adds `[AFK]` to your name\n' +
                                '> Announces your return when you type\n' +
                                '> Notifies others if they ping an AFK member',
                        },
                        {
                            name: '⏰ Leave Timer',
                            value:
                                '`/leavetimer [time] [reason]`\n' +
                                '> Sets a countdown before you auto-leave the VC\n' +
                                '> Gives the channel a 1 min heads-up before you go\n' +
                                '`/cleartimer`\n' +
                                '> Cancels your active leave timer',
                        },
                    ],
                    footer: { text: 'Only you, mods, and the server owner can manage this channel' },
                }],
            });
        } catch (e) {
            console.error('[BeastBot] Failed to post temp VC guide:', e.message);
            await logToChannel(`⚠️ Failed to post guide in \`${channelName}\`: \`${e.message}\``);
        }

        console.log(`[BeastBot] 🔊 Created temp VC: "${channelName}" for ${member.user.tag}`);
        await logToChannel(`✅ **Temp VC created:** \`${channelName}\` — moved ${member.user.tag} in`);
    } catch (e) {
        console.error('[BeastBot] Failed to create temp VC:', e.message);
        await logToChannel(`❌ **Temp VC creation FAILED** for ${member.user.tag}\n\`\`\`${e.message}\`\`\``);
    }
}

// ── Leave timer store ────────────────────────────────────────────────────────
// userId -> { mainTimeout, warningTimeout, channelId, textChannelId, reason, minutes }
const leaveTimers = new Map();

function cancelLeaveTimer(userId) {
    const timer = leaveTimers.get(userId);
    if (!timer) return;
    if (timer.mainTimeout) clearTimeout(timer.mainTimeout);
    if (timer.warningTimeout) clearTimeout(timer.warningTimeout);
    leaveTimers.delete(userId);
}

// Keep member name cache fresh when someone changes their nickname
client.on('guildMemberUpdate', (_old, newMember) => {
    if (!newMember.user.bot) {
        memberNameCache.set(newMember.id, newMember.displayName);
        memberCache.set(newMember.id, {
            displayName: newMember.displayName,
            avatarUrl: newMember.user.displayAvatarURL({ size: 128, extension: 'png' }),
        });
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    // ── Cancel leave timer if user manually leaves VC ────────────────────────
    if (oldState.channelId && !newState.channelId && leaveTimers.has(oldState.member?.id)) {
        cancelLeaveTimer(oldState.member.id);
    }
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    // Handle camera/stream toggles without channel change (also mute/deafen — harmless to update)
    if (oldCh === newCh) {
        const m = newState.member || oldState.member;
        if (m && !m.user.bot && newCh) {
            const chType = (newState.channel || oldState.channel)?.type;
            voiceEnhancements.set(m.id, { camera: newState.selfVideo || false, stream: newState.selfStream || false, inStage: chType === ChannelType.GuildStageVoice });
        }
        return;
    }

    // ── Voice time tracking ───────────────────────────────────────────────────
    const trackingMember = newState.member || oldState.member;
    if (trackingMember && !trackingMember.user.bot) {
        const uid = trackingMember.id;
        // Session end: left a real channel
        if (oldCh && oldCh !== AFK_CHANNEL_ID && voiceStartTimes.has(uid)) {
            const finalData = creditVoiceTime(uid);
            voiceStartTimes.delete(uid);
            voiceEnhancements.delete(uid);
            if (finalData) {
                saveVoiceMinutes(uid, { total: finalData.total, days: Object.fromEntries(finalData.days) });
                assignVoiceRank(trackingMember, monthlyActivityScore(uid)).catch(() => {});
            }
        }
        // Session start: joined a real channel (not AFK, not trigger)
        if (newCh && newCh !== AFK_CHANNEL_ID && newCh !== TEMP_VC_TRIGGER_ID) {
            const existing = voiceMinutes.get(uid) || { total: 0, days: new Map() };
            voiceStartTimes.set(uid, {
                startMs: Date.now(),
                baseTotal: existing.total,
                baseToday: existing.days.get(todayStr()) || 0,
            });
            voiceEnhancements.set(uid, { camera: newState.selfVideo || false, stream: newState.selfStream || false, inStage: newState.channel?.type === ChannelType.GuildStageVoice });
        }
    }

    // ── Someone joined the trigger → create their VC ─────────────────────────
    if (newCh === TEMP_VC_TRIGGER_ID) {
        await logToChannel(`🎙️ **voiceStateUpdate fired** — ${newState.member?.user?.tag} joined trigger channel`);
        await createTempVC(newState);
        return;
    }

    // ── Someone joined an existing temp VC → cancel its delete timer ──────────
    if (newCh && tempVoiceChannels.has(newCh)) {
        const vcData = tempVoiceChannels.get(newCh);
        if (vcData.deleteTimer) {
            clearTimeout(vcData.deleteTimer);
            vcData.deleteTimer = null;
            tempVoiceChannels.set(newCh, vcData);
            console.log(`[BeastBot] 🔊 Member joined "${vcData.ownerName}'s Channel" — delete timer cancelled`);
        }
    }

    // ── Someone left a temp VC → if empty, start 1-min delete timer ──────────
    if (oldCh && tempVoiceChannels.has(oldCh)) {
        const vcChannel = newState.guild.channels.cache.get(oldCh);
        const vcData    = tempVoiceChannels.get(oldCh);
        const memberCount = vcChannel ? vcChannel.members.size : 0;

        if (memberCount === 0) {
            if (vcData.deleteTimer) clearTimeout(vcData.deleteTimer);
            vcData.deleteTimer = setTimeout(async () => {
                try {
                    const ch = client.channels.cache.get(oldCh);
                    if (ch) await ch.delete('Temp VC: empty for 1 minute');
                    console.log(`[BeastBot] 🔊 Temp VC deleted: "${vcData.ownerName}'s Channel"`);
                } catch (e) {
                    console.error('[BeastBot] Failed to delete temp VC:', e.message);
                }
                tempVoiceChannels.delete(oldCh);
            }, 60 * 1000);
            tempVoiceChannels.set(oldCh, vcData);
            console.log(`[BeastBot] 🔊 "${vcData.ownerName}'s Channel" is empty — deleting in 1 minute`);
        }
    }
});

// ── Voice rank role management ────────────────────────────────────────────────

async function ensureVoiceRankRoles(guild) {
    // Look up each role by its fixed ID — never create new roles
    for (const rankDef of VOICE_RANK_ROLES) {
        const role = guild.roles.cache.get(rankDef.id);
        if (role) {
            voiceRankRoleCache.set(rankDef.name, role);
        } else {
            console.warn(`[BeastBot] Could not find role ${rankDef.name} (${rankDef.id})`);
        }
    }
    console.log(`[BeastBot] Voice rank roles ready (${voiceRankRoleCache.size}/${VOICE_RANK_ROLES.length})`);
}

async function assignVoiceRank(member, xp) {
    if (voiceRankRoleCache.size === 0) return;
    let targetIdx = 0;
    for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
        if (xp >= VOICE_RANK_ROLES[i].minXp) targetIdx = i;
    }
    const targetRank = VOICE_RANK_ROLES[targetIdx];
    const targetRole = voiceRankRoleCache.get(targetRank.name);
    if (!targetRole) return;
    const allRankIds = [...voiceRankRoleCache.values()].map(r => r.id);
    const toRemove = member.roles.cache.filter(r => allRankIds.includes(r.id) && r.id !== targetRole.id);
    for (const [, role] of toRemove) await member.roles.remove(role).catch(() => {});
    if (!member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(e => console.error('[BeastBot] assignVoiceRank failed:', e.message));
    }
    // Track achievements: highest rank ever + Apex hits
    const ach = rankAchievements.get(member.id) || { highestRankIdx: 0, apexCount: 0, hitApexThisMonth: false };
    let changed = false;
    if (targetIdx > ach.highestRankIdx) { ach.highestRankIdx = targetIdx; changed = true; }
    if (targetIdx === VOICE_RANK_ROLES.length - 1 && !ach.hitApexThisMonth) { ach.hitApexThisMonth = true; changed = true; }
    if (changed) { rankAchievements.set(member.id, ach); saveRankAchievements(member.id, ach); }
}

async function postMonthlyRecap(guild, oldMonthStr) { // e.g. "2026-02"
    try {
        const channel = await client.channels.fetch(MONTHLY_RECAP_CHANNEL);
        const entries = [];
        for (const [userId, data] of voiceMinutes.entries()) {
            let sum = 0;
            for (const [k, v] of data.days.entries()) {
                if (k.startsWith(oldMonthStr)) sum += v;
            }
            if (sum > 0) entries.push({ userId, value: sum });
        }
        entries.sort((a, b) => b.value - a.value);
        const top10 = [];
        for (const entry of entries) {
            if (top10.length >= 10) break;
            try {
                const member = await guild.members.fetch(entry.userId);
                top10.push({ member, value: entry.value });
            } catch {}
        }
        if (top10.length === 0) return;
        const medals = ['🥇', '🥈', '🥉'];
        const lines = top10.map(({ member, value }, i) => {
            const prefix = medals[i] || `**${i + 1}.**`;
            const display = value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`;
            return `${prefix} **${member.displayName}** — ${display}`;
        });
        const mentions = top10.map(({ member }) => `<@${member.id}>`).join(' ');
        const oldDate = new Date(oldMonthStr + '-01');
        const monthLabel = oldDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        await channel.send({
            content: `🏆 **Voice Chat Top 10 — ${monthLabel}**\n${mentions}`,
            embeds: [{
                color: 0xffd700,
                title: `🏆 Voice Chat Leaderboard — ${monthLabel}`,
                description: lines.join('\n'),
                footer: { text: 'Rankings reset for the new month. Keep chatting!' },
                timestamp: new Date().toISOString(),
            }],
        });
        console.log(`[BeastBot] Posted monthly voice recap for ${monthLabel}`);
    } catch (e) {
        console.error('[BeastBot] Failed to post monthly recap:', e.message);
    }
}

async function checkMonthlyReset(guild) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    let stored = null;
    try {
        const doc = await firestoreGet('botState', 'currentMonth');
        stored = doc?.month || null;
    } catch (_) {}
    if (stored === currentMonth) return;
    if (stored) await postMonthlyRecap(guild, stored);
    // Finalise Apex count for anyone who hit it this month, then reset roles to Bronze I
    try {
        const allRankIds = [...voiceRankRoleCache.values()].map(r => r.id);
        for (const [, member] of guild.members.cache) {
            if (member.user.bot) continue;
            const ach = rankAchievements.get(member.id);
            if (ach?.hitApexThisMonth) {
                ach.apexCount++;
                ach.hitApexThisMonth = false;
                rankAchievements.set(member.id, ach);
                saveRankAchievements(member.id, ach);
            }
            if (!member.roles.cache.some(r => allRankIds.includes(r.id))) continue;
            await assignVoiceRank(member, 0).catch(() => {});
        }
    } catch (e) { console.error('[BeastBot] Monthly reset role assignment failed:', e.message); }
    await firestoreSet('botState', 'currentMonth', { month: currentMonth });
    console.log(`[BeastBot] Monthly reset complete — now tracking ${currentMonth}`);
}

// ── Ranks info embed ──────────────────────────────────────────────────────────

function buildRanksEmbed() {
    const rankLines = VOICE_RANK_ROLES.map(r => {
        const xp = r.minXp === 0 ? '0 XP' : `${r.minXp.toLocaleString()} XP`;
        return `${r.name} — **${xp}**`;
    }).join('\n');

    return {
        color: 0xFFD700,
        title: '🏆 TrueBeast Ranking System',
        description: 'Earn XP by being active in the server. Ranks **reset to Bronze I** on the 1st of every month — but your peak rank and Apex Predator count are tracked forever.',
        fields: [
            {
                name: '📊 Ranks & XP Thresholds',
                value: rankLines,
            },
            {
                name: '🎙️ How to Earn XP',
                value: [
                    '**Voice chat** — 1 XP per minute spent in a voice channel',
                    '**Messages** — 1 XP per message (~60 messages ≈ 1 hour of VC)',
                ].join('\n'),
            },
            {
                name: '✨ XP Multipliers',
                value: [
                    '📷 **Camera on** — 1.5× XP while in voice',
                    '🖥️ **Screen share** — 1.5× XP while in voice',
                    '📷🖥️ **Both active** — 2× XP while in voice',
                    '*Multipliers only apply to voice chat time, not messages.*',
                ].join('\n'),
            },
            {
                name: '🏅 Peak Rank & Apex Count',
                value: 'Your highest rank ever achieved is shown on your `/me` profile card, along with how many times you\'ve hit 👑 **Apex Predator**. These never reset — use them to flex.',
            },
            {
                name: '📈 Track Your Progress',
                value: 'Use `/me` to view your full stats card — XP bar, rank progress, peak rank, and Apex count.',
            },
        ],
        footer: { text: 'Ranks reset on the 1st of each month · Good luck!' },
    };
}

// ── Leaderboard helpers ───────────────────────────────────────────────────────

function buildLeaderboardTitle(type, period) {
    const typeStr   = type === 'msg' ? 'Messages' : 'Voice Time';
    const periodStr = { today: 'Today', week: 'This Week', month: 'This Month', all: 'All Time' }[period];
    return `🏆 ${typeStr} Leaderboard · ${periodStr}`;
}

const PAGE_SIZE = 10;

// CustomId scheme to avoid duplicates:
//   lbt:{type}:{period}  — type toggle buttons  (always go to page 0)
//   lbp:{type}:{period}  — period toggle buttons (always go to page 0)
//   lbn:{type}:{period}:{page} — nav (prev/next) buttons
//   lbx                  — disabled noop (page counter)
function buildLeaderboardComponents(activeType, activePeriod, page, totalPages) {
    const typeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lbt:msg:${activePeriod}`).setLabel('📩 Messages').setStyle(activeType === 'msg' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbt:vc:${activePeriod}`).setLabel('🎙️ Voice Time').setStyle(activeType === 'vc' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    const periodRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lbp:${activeType}:today`).setLabel('Today').setStyle(activePeriod === 'today' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:week`).setLabel('This Week').setStyle(activePeriod === 'week' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:month`).setLabel('This Month').setStyle(activePeriod === 'month' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:all`).setLabel('All Time').setStyle(activePeriod === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lbn:${activeType}:${activePeriod}:${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId('lbx').setLabel(`Page ${page + 1} of ${Math.max(1, totalPages)}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`lbn:${activeType}:${activePeriod}:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        new ButtonBuilder().setCustomId('lbclose').setLabel('✕ Close').setStyle(ButtonStyle.Danger),
    );
    const infoRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lbranks').setLabel('❓ Help').setStyle(ButtonStyle.Success),
    );
    return [typeRow, periodRow, navRow, infoRow];
}

function buildLeaderboardEntries(type, period) {
    const entries = [];
    if (type === 'msg') {
        for (const [userId, count] of messageCounts.entries()) {
            const daysMap = messageDays.get(userId) || new Map();
            const value = getTotal(daysMap, count, period);
            if (value > 0 && memberNameCache.has(userId)) entries.push({ userId, value });
        }
    } else {
        for (const [userId, data] of voiceMinutes.entries()) {
            const value = getTotal(data.days, data.total, period);
            if (value > 0 && memberNameCache.has(userId)) entries.push({ userId, value });
        }
    }
    entries.sort((a, b) => b.value - a.value);
    return entries;
}

function formatScore(value, type) {
    if (type === 'vc') return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`;
    return value.toLocaleString();
}

async function loadAvatar(userId) {
    const info = memberCache.get(userId);
    const url  = info?.avatarUrl;
    try {
        if (url) return await loadImage(url);
    } catch (_) {}
    // Discord default avatar fallback (grey silhouette)
    try {
        return await loadImage(`https://cdn.discordapp.com/embed/avatars/${Number(userId) % 5}.png`);
    } catch (_) { return null; }
}

function drawCircularAvatar(ctx, img, cx, cy, r) {
    if (!img) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
}

function truncateName(ctx, name, maxWidth) {
    if (ctx.measureText(name).width <= maxWidth) return name;
    let n = name;
    while (n.length > 1 && ctx.measureText(n + '...').width > maxWidth) n = n.slice(0, -1);
    return n + '...';
}

function stripEmoji(str) {
    return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();
}

// Returns 2.0 if camera+stream, 1.5 if either alone, 1.0 otherwise
function getXpMultiplier(uid) {
    const e = voiceEnhancements.get(uid) || { camera: false, stream: false, inStage: false };
    if (e.inStage && e.stream) return 2.0;  // stage screen share = 2×
    if (e.camera && e.stream)  return 2.0;  // camera + stream = 2×
    if (e.camera || e.stream)  return 1.5;  // either alone = 1.5×
    return 1.0;
}

function monthlyActivityScore(userId) {
    const vcData = voiceMinutes.get(userId)  || { total: 0, days: new Map() };
    const bData  = voiceBonusXp.get(userId)  || { total: 0, days: new Map() };
    const dMap   = messageDays.get(userId)   || new Map();
    const mCount = messageCounts.get(userId) || 0;
    return getTotal(vcData.days, vcData.total, 'month')
         + getTotal(bData.days, bData.total, 'month')
         + getTotal(dMap, mCount, 'month') * MSGS_TO_MIN;
}

// ── Twemoji emoji image helpers ───────────────────────────────────────────────
const emojiImageCache = new Map();

function emojiToTwemojiFilename(emoji) {
    return [...emoji]
        .map(c => c.codePointAt(0).toString(16))
        .filter(cp => cp !== 'fe0f') // drop variation selector-16
        .join('-') + '.png';
}

async function loadEmojiImage(emoji) {
    if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
    const filename = emojiToTwemojiFilename(emoji);
    try {
        const img = await loadImage(`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${filename}`);
        emojiImageCache.set(emoji, img);
        return img;
    } catch { emojiImageCache.set(emoji, null); return null; }
}

function extractFirstEmoji(str) {
    const m = str.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u);
    return m ? m[0] : null;
}

// Draw a simple crown shape above cx, with its bottom edge at bottomY
function drawCrown(ctx, cx, bottomY, size, color) {
    const w = size * 2;
    const h = size;
    const bx = cx - w / 2;
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(bx, bottomY);
    ctx.lineTo(bx, bottomY - h * 0.42);
    ctx.lineTo(bx + w * 0.11, bottomY - h * 0.95);
    ctx.lineTo(bx + w * 0.28, bottomY - h * 0.48);
    ctx.lineTo(bx + w * 0.5,  bottomY - h * 1.25);  // center tallest peak
    ctx.lineTo(bx + w * 0.72, bottomY - h * 0.48);
    ctx.lineTo(bx + w * 0.89, bottomY - h * 0.95);
    ctx.lineTo(bx + w,        bottomY - h * 0.42);
    ctx.lineTo(bx + w,        bottomY);
    ctx.closePath();
    ctx.fill();
    // Gem dots on each peak tip
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    [[bx + w * 0.11, bottomY - h * 0.95], [bx + w * 0.5, bottomY - h * 1.25], [bx + w * 0.89, bottomY - h * 0.95]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, size * 0.14, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
}

// ── Leaderboard image ─────────────────────────────────────────────────────────

async function generateLeaderboardImage(type, period, page = 0) {
    const allEntries  = buildLeaderboardEntries(type, period);
    const totalPages  = Math.max(1, Math.ceil(allEntries.length / PAGE_SIZE));
    const safePage    = Math.max(0, Math.min(page, totalPages - 1));
    const pageEntries = allEntries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    const globalOffset = safePage * PAGE_SIZE;

    const W          = 1100;
    const PODIUM_H   = safePage === 0 && allEntries.length > 0 ? 430 : 0;
    const ROW_H      = 96;
    const FOOTER_H   = 70;
    const listEntries = safePage === 0 ? pageEntries.slice(3) : pageEntries;
    const H = PODIUM_H + Math.max(listEntries.length, 1) * ROW_H + FOOTER_H;

    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, W, H);

    // Subtle top glow
    const topGlow = ctx.createLinearGradient(0, 0, 0, 120);
    topGlow.addColorStop(0, 'rgba(34,197,94,0.08)');
    topGlow.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, W, 120);

    // No data
    if (allEntries.length === 0) {
        ctx.font = '30px Noto Sans, sans-serif';
        ctx.fillStyle = '#4b5563';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data for this period yet.', W / 2, H / 2);
        ctx.textAlign = 'left';
        return { buffer: canvas.toBuffer('image/png'), page: 0, totalPages: 1 };
    }

    // ── Podium (page 0, top 3) ────────────────────────────────────────────────
    if (safePage === 0) {
        const podiumEntries = pageEntries.slice(0, 3);
        const slots   = [podiumEntries[1], podiumEntries[0], podiumEntries[2]];
        const colors  = ['#9ca3af', '#ffd700', '#cd7f32'];
        const labels  = ['2ND', '1ST', '3RD'];
        const radii   = [68, 86, 68];
        const posX    = [220, 550, 880];
        const offsetY = [40, 0, 40];

        const avatarImgs = await Promise.all(slots.map(e => e ? loadAvatar(e.userId) : Promise.resolve(null)));

        for (let i = 0; i < 3; i++) {
            const entry = slots[i];
            if (!entry) continue;
            const r        = radii[i];
            const x        = posX[i];
            const avatarCY = offsetY[i] + 80 + r;

            // Crown above avatar
            drawCrown(ctx, x, avatarCY - r - 8, i === 1 ? 26 : 20, colors[i]);

            // Glow ring
            ctx.save();
            ctx.shadowColor = colors[i];
            ctx.shadowBlur  = i === 1 ? 40 : 24;
            ctx.beginPath();
            ctx.arc(x, avatarCY, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = colors[i];
            ctx.lineWidth   = i === 1 ? 8 : 6;
            ctx.stroke();
            ctx.restore();

            drawCircularAvatar(ctx, avatarImgs[i], x, avatarCY, r);

            // Position badge pill
            ctx.font = `bold ${i === 1 ? 24 : 20}px Noto Sans, sans-serif`;
            const lblW = ctx.measureText(labels[i]).width + 26;
            const lblH = i === 1 ? 34 : 28;
            const lblY = avatarCY + r + 18;

            ctx.fillStyle = i === 1 ? 'rgba(255,215,0,0.18)' : i === 0 ? 'rgba(156,163,175,0.15)' : 'rgba(205,127,50,0.15)';
            ctx.beginPath(); ctx.roundRect(x - lblW / 2, lblY, lblW, lblH, lblH / 2); ctx.fill();
            ctx.strokeStyle = colors[i];
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(x - lblW / 2, lblY, lblW, lblH, lblH / 2); ctx.stroke();
            ctx.fillStyle = colors[i];
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labels[i], x, lblY + lblH / 2);

            // Name
            ctx.font = `bold ${i === 1 ? 30 : 26}px Noto Sans, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'top';
            ctx.fillText(truncateName(ctx, memberNameCache.get(entry.userId) || 'Unknown', 220), x, lblY + lblH + 14);

            // Score
            ctx.font = `${i === 1 ? 24 : 21}px Noto Sans, sans-serif`;
            ctx.fillStyle = '#9ca3af';
            ctx.fillText(formatScore(entry.value, type), x, lblY + lblH + 14 + (i === 1 ? 38 : 34));
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Separator below podium
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, PODIUM_H); ctx.lineTo(W, PODIUM_H); ctx.stroke();
    }

    // ── List rows ─────────────────────────────────────────────────────────────
    const listY       = PODIUM_H;
    const listAvatars = await Promise.all(listEntries.map(e => loadAvatar(e.userId)));

    listEntries.forEach(({ userId, value }, i) => {
        const rank = globalOffset + (safePage === 0 ? i + 3 : i);
        const rowY = listY + i * ROW_H;
        const midY = rowY + ROW_H / 2;

        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(0, rowY, W, ROW_H);
        }

        // Rank
        ctx.font = 'bold 28px Noto Sans, sans-serif';
        ctx.fillStyle = '#374151';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillText(`#${rank + 1}`, 90, midY);

        // Avatar
        if (listAvatars[i]) drawCircularAvatar(ctx, listAvatars[i], 130, midY, 32);

        // Name
        ctx.font = '34px Noto Sans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(truncateName(ctx, memberNameCache.get(userId) || 'Unknown', 560), 182, midY);

        // Score
        ctx.font = 'bold 34px Noto Sans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(formatScore(value, type), W - 40, midY);

        // Row divider
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(36, rowY + ROW_H); ctx.lineTo(W - 36, rowY + ROW_H); ctx.stroke();
    });

    ctx.textAlign = 'left';

    // Footer
    const footerY = H - FOOTER_H;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, footerY); ctx.lineTo(W, footerY); ctx.stroke();

    ctx.font = '22px Noto Sans, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${safePage + 1} of ${totalPages}`, W / 2, footerY + FOOTER_H / 2);
    ctx.textAlign = 'left';

    return { buffer: canvas.toBuffer('image/png'), page: safePage, totalPages };
}

// ── Profile card ──────────────────────────────────────────────────────────────

async function generateProfileImage(userId) {
    const info      = memberCache.get(userId) || { displayName: 'Unknown', avatarUrl: null };
    const msgCount  = messageCounts.get(userId) || 0;
    const msgDMap   = messageDays.get(userId) || new Map();
    const vcData    = voiceMinutes.get(userId) || { total: 0, days: new Map() };

    const activityScore = monthlyActivityScore(userId);
    let rankIdx = 0;
    for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
        if (activityScore >= VOICE_RANK_ROLES[i].minXp) rankIdx = i;
    }
    const currentRank = VOICE_RANK_ROLES[rankIdx];
    const nextRank    = VOICE_RANK_ROLES[rankIdx + 1] || null;
    const progress    = nextRank
        ? Math.min(1, (activityScore - currentRank.minXp) / (nextRank.minXp - currentRank.minXp))
        : 1;

    const W = 1100, H = 580;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, W, H);

    // Subtle radial glow (top-right)
    const radGlow = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.7);
    radGlow.addColorStop(0, 'rgba(34,197,94,0.07)');
    radGlow.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = radGlow;
    ctx.fillRect(0, 0, W, H);

    // Left accent bar (gradient)
    const barAccent = ctx.createLinearGradient(0, 0, 0, H);
    barAccent.addColorStop(0, '#4ade80');
    barAccent.addColorStop(0.5, '#22c55e');
    barAccent.addColorStop(1, '#16a34a');
    ctx.fillStyle = barAccent;
    ctx.fillRect(0, 0, 7, H);

    // Avatar
    const avatarImg = await loadAvatar(userId);
    const AR = 96, AX = 54 + AR, AY = H / 2;
    ctx.save();
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur  = 40;
    ctx.beginPath();
    ctx.arc(AX, AY, AR + 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth   = 8;
    ctx.stroke();
    ctx.restore();
    drawCircularAvatar(ctx, avatarImg, AX, AY, AR);

    // Content area
    const CX = AX + AR + 48;

    // Name
    ctx.font = 'bold 58px Noto Sans, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(truncateName(ctx, info.displayName, W - CX - 36), CX, 34);

    // Rank badge (pill) — emoji drawn as Twemoji PNG image
    const rankEmoji     = extractFirstEmoji(currentRank.name);
    const rankTextClean = stripEmoji(currentRank.name);
    const EPILL = 26;
    ctx.font = 'bold 24px "Noto Sans", sans-serif';
    const emojiGap  = rankEmoji ? EPILL + 8 : 0;
    const rankPillW = emojiGap + ctx.measureText(rankTextClean).width + 36;
    const rankPillH = 38;
    const rankPillY = 108;
    ctx.fillStyle = 'rgba(34,197,94,0.15)';
    ctx.beginPath(); ctx.roundRect(CX, rankPillY, rankPillW, rankPillH, rankPillH / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(34,197,94,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(CX, rankPillY, rankPillW, rankPillH, rankPillH / 2); ctx.stroke();
    ctx.fillStyle = '#4ade80';
    ctx.textBaseline = 'middle';
    let pillX = CX + 15;
    if (rankEmoji) {
        const eImg = await loadEmojiImage(rankEmoji);
        if (eImg) { ctx.drawImage(eImg, pillX, rankPillY + (rankPillH - EPILL) / 2, EPILL, EPILL); pillX += EPILL + 8; }
    }
    ctx.fillText(rankTextClean, pillX, rankPillY + rankPillH / 2);

    // Layout constants (used for Peak alignment and stats grid)
    const COL1 = 230, COL2 = 250, COL3 = 250;
    const panelW = COL1 + COL2 + COL3;

    // Peak rank + Apex count — right-aligned, vertically centred with rank pill
    const ach = rankAchievements.get(userId) || { highestRankIdx: 0, apexCount: 0 };
    const peakRank  = VOICE_RANK_ROLES[ach.highestRankIdx];
    const peakEmoji = extractFirstEmoji(peakRank.name);
    const peakClean = stripEmoji(peakRank.name);
    const EPEAK = 24, ECROWN = 22;
    ctx.font = '20px "Noto Sans", sans-serif';
    const apexPrefix  = '   ·   Apex ×  ';
    const apexPrefixW = ctx.measureText(apexPrefix).width;
    ctx.font = 'bold 20px "Noto Sans", sans-serif';
    const apexCountW  = ctx.measureText(String(ach.apexCount)).width;
    ctx.font = '20px "Noto Sans", sans-serif';
    const peakLblW   = ctx.measureText('Peak:  ').width;
    const peakCleanW = ctx.measureText(peakClean).width;
    const peakEmojiW = peakEmoji ? EPEAK + 6 : 0;
    const totalApexW = apexPrefixW + ECROWN + 6 + apexCountW;
    let pkX = (CX + panelW) - (peakLblW + peakEmojiW + peakCleanW + totalApexW);
    const pkY = rankPillY + rankPillH / 2;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Peak:  ', pkX, pkY); pkX += peakLblW;
    if (peakEmoji) {
        const peImg = await loadEmojiImage(peakEmoji);
        if (peImg) { ctx.drawImage(peImg, pkX, pkY - EPEAK / 2, EPEAK, EPEAK); pkX += EPEAK + 6; }
    }
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(peakClean, pkX, pkY); pkX += peakCleanW;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(apexPrefix, pkX, pkY); pkX += apexPrefixW;
    const crownImg = await loadEmojiImage('👑');
    if (crownImg) { ctx.drawImage(crownImg, pkX, pkY - ECROWN / 2, ECROWN, ECROWN); } pkX += ECROWN + 6;
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px "Noto Sans", sans-serif';
    ctx.fillText(String(ach.apexCount), pkX, pkY);

    // Stats grid
    const GY   = 175;

    // Subtle stats panel bg
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(CX - 16, GY - 10, panelW + 32, 280, 12); ctx.fill();

    // Column headers
    ctx.font = 'bold 18px Noto Sans, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.textBaseline = 'top';
    ctx.fillText('PERIOD',      CX,               GY);
    ctx.fillText('MESSAGES',    CX + COL1,        GY);
    ctx.fillText('VOICE TIME',  CX + COL1 + COL2, GY);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX - 16, GY + 26); ctx.lineTo(CX + panelW + 16, GY + 26); ctx.stroke();

    const statRows = [
        { label: 'Today',      msg: getTotal(msgDMap, msgCount, 'today'),  vc: getTotal(vcData.days, vcData.total, 'today')  },
        { label: 'This Week',  msg: getTotal(msgDMap, msgCount, 'week'),   vc: getTotal(vcData.days, vcData.total, 'week')   },
        { label: 'This Month', msg: getTotal(msgDMap, msgCount, 'month'),  vc: getTotal(vcData.days, vcData.total, 'month')  },
        { label: 'All Time',   msg: getTotal(msgDMap, msgCount, 'all'),    vc: getTotal(vcData.days, vcData.total, 'all')    },
    ];

    statRows.forEach(({ label, msg, vc }, i) => {
        const rY = GY + 38 + i * 56;
        ctx.font = '23px Noto Sans, sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.textBaseline = 'top';
        ctx.fillText(label, CX, rY);
        ctx.font = 'bold 26px Noto Sans, sans-serif';
        ctx.fillStyle = msg > 0 ? '#ffffff' : '#374151';
        ctx.fillText(msg.toLocaleString(), CX + COL1, rY);
        ctx.fillStyle = vc > 0 ? '#ffffff' : '#374151';
        ctx.fillText(formatScore(vc, 'vc'), CX + COL1 + COL2, rY);
    });

    // Progress bar
    const barX = CX, barY = H - 72, barW = panelW, barH = 18;

    // XP this month — right-aligned above bar
    ctx.font = '19px "Noto Sans", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillText(`${activityScore.toLocaleString()} XP`, barX + barW, barY - 10);
    ctx.textAlign = 'left';

    // Progress bar rank labels with Twemoji images
    ctx.font = '20px "Noto Sans", sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.textBaseline = 'bottom';
    const EPROG = 22;
    let progX = barX;
    for (const [rObj, fallback] of [[currentRank, ''], [null, '→'], [nextRank || null, 'Max Rank']]) {
        if (fallback === '→') {
            ctx.fillText('  >  ', progX, barY - 10);
            progX += ctx.measureText('  >  ').width;
            continue;
        }
        const e = rObj ? extractFirstEmoji(rObj.name) : null;
        const t = rObj ? stripEmoji(rObj.name) : fallback;
        if (e) {
            const eImg = await loadEmojiImage(e);
            if (eImg) { ctx.drawImage(eImg, progX, barY - 10 - EPROG, EPROG, EPROG); progX += EPROG + 5; }
        }
        ctx.fillText(t, progX, barY - 10);
        progX += ctx.measureText(t).width;
    }

    // Track
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 9); ctx.fill();

    // Fill (gradient)
    if (progress > 0) {
        const fillGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        fillGrad.addColorStop(0, '#16a34a');
        fillGrad.addColorStop(1, '#4ade80');
        ctx.fillStyle = fillGrad;
        ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(barH, barW * progress), barH, 9); ctx.fill();
    }

    // Percentage
    ctx.font = 'bold 20px Noto Sans, sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText(nextRank ? `${Math.round(progress * 100)}%` : '100%', barX + barW, barY + barH + 8);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

// ── Discord card canvas image ─────────────────────────────────────────────────

const CARD_BG_PRESETS = {
    teal:   ['#1a2744', '#0d3d52'],
    green:  ['#0d2e1c', '#0a4020'],
    purple: ['#1a1244', '#2d0d52'],
    orange: ['#2e1a0d', '#522d0a'],
    blue:   ['#0d1a44', '#0a2052'],
    dark:   ['#111218', '#1a1d26'],
};

function stripMd(s) {
    return s.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\*([^*]*)\*/g, '$1').replace(/~~([^~]*)~~/g, '$1');
}

function wrapTextLines(ctx, text, maxWidth, maxLines) {
    maxLines = maxLines || 4;
    if (!text || !text.trim()) return [];
    // Reliability check — Noto Sans on Alpine may return near-zero for first call
    const testW = ctx.measureText('MMMMMMMM').width;
    const useMeasure = testW > 20;
    const measure = (s) => useMeasure ? ctx.measureText(stripMd(s)).width : stripMd(s).length * 8.5;
    const paras = text.split('\n');
    const lines = [];
    for (const para of paras) {
        if (lines.length >= maxLines) break;
        if (!para.trim()) { if (lines.length > 0) lines.push(''); continue; }
        const words = para.split(' ');
        let line = '';
        for (const word of words) {
            if (!word) continue;
            const test = line ? line + ' ' + word : word;
            if (measure(test) > maxWidth && line) {
                lines.push(line); if (lines.length >= maxLines) return lines; line = word;
            } else { line = test; }
        }
        if (line) { lines.push(line); if (lines.length >= maxLines) return lines; }
    }
    return lines;
}

function parseMdSegs(text) {
    const segs = [];
    let i = 0, bold = false, italic = false, strike = false;
    while (i < text.length) {
        if (text.startsWith('**', i)) { bold = !bold; i += 2; continue; }
        if (text.startsWith('~~', i)) { strike = !strike; i += 2; continue; }
        if (text[i] === '*') { italic = !italic; i++; continue; }
        let j = i + 1;
        while (j < text.length) {
            if (text.startsWith('**', j) || text.startsWith('~~', j) || text[j] === '*') break;
            j++;
        }
        if (i < j) segs.push({ text: text.slice(i, j), bold, italic, strike });
        i = j;
    }
    return segs;
}

function drawMdLine(ctx, text, x, y, fontSize, fontFamily, alignMode) {
    if (!text) return;
    const segs = parseMdSegs(text);
    const metrics = segs.map((seg) => {
        ctx.font = `${seg.bold && seg.italic ? 'bold italic ' : seg.bold ? 'bold ' : seg.italic ? 'italic ' : ''}${fontSize}px ${fontFamily}`;
        return ctx.measureText(seg.text).width;
    });
    const totalW = metrics.reduce((a, b) => a + b, 0);
    let dx = alignMode === 'center' ? x - totalW / 2 : alignMode === 'right' ? x - totalW : x;
    const savedAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    segs.forEach((seg, idx) => {
        ctx.font = `${seg.bold && seg.italic ? 'bold italic ' : seg.bold ? 'bold ' : seg.italic ? 'italic ' : ''}${fontSize}px ${fontFamily}`;
        ctx.fillText(seg.text, dx, y);
        if (seg.strike) ctx.fillRect(dx, y + Math.round(fontSize * 0.56), metrics[idx], Math.max(1, Math.round(fontSize * 0.07)));
        dx += metrics[idx];
    });
    ctx.textAlign = savedAlign;
}

function hexToRgbaBot(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${(alpha / 100).toFixed(2)})`;
}

async function generateDiscordCard(opts) {
    if (!opts) opts = {};
    const title            = opts.title            || 'TrueBeast';
    const subtitle         = opts.subtitle         || '';
    const bodyText         = opts.bodyText         || '';
    const gradientFrom     = opts.gradientFrom     || (CARD_BG_PRESETS[opts.bgPreset || 'teal'] || CARD_BG_PRESETS.teal)[0];
    const gradientTo       = opts.gradientTo       || (CARD_BG_PRESETS[opts.bgPreset || 'teal'] || CARD_BG_PRESETS.teal)[1];
    // Per-colour alpha — fall back to legacy gradientOpacity for old cards
    const legacyOpacity    = opts.gradientOpacity !== undefined ? opts.gradientOpacity : 100;
    const gradientFromAlpha = opts.gradientFromAlpha !== undefined ? opts.gradientFromAlpha : legacyOpacity;
    const gradientToAlpha  = opts.gradientToAlpha  !== undefined ? opts.gradientToAlpha  : legacyOpacity;
    const textBgOpacity    = opts.textBgOpacity    || 0;
    const imageUrl         = opts.imageUrl         || null;
    const imagePosition    = opts.imagePosition    || 'left';
    const logoUrl          = opts.logoUrl          || null;
    const featuredImageUrl = opts.featuredImageUrl || null;
    const textAlign        = opts.textAlign        || 'left';
    const cardHeightOpt    = opts.cardHeight       || 'auto';

    const W = 680;
    const ICON_SZ = 120, ICON_PAD = 22, GAP = 16, TEXT_PAD = 24;
    const TITLE_SZ = 28, SUB_SZ = 18, BODY_SZ = 15, LINE_H = 26, BODY_LINE_H = 22;
    const FEAT_PAD = 12;
    const LOGO_SZ = 52, LOGO_MARGIN = 14;
    const FONT = 'Noto Sans, sans-serif';

    const logoReserve = logoUrl ? LOGO_SZ + LOGO_MARGIN + 8 : 0;

    let textX, textMaxW, ctxTextAlign;
    if (imagePosition === 'left') {
        textX = ICON_PAD + ICON_SZ + GAP; textMaxW = W - textX - TEXT_PAD - logoReserve; ctxTextAlign = 'left';
    } else if (imagePosition === 'right') {
        textX = TEXT_PAD; textMaxW = W - ICON_SZ - ICON_PAD - GAP - TEXT_PAD - logoReserve; ctxTextAlign = 'left';
    } else {
        ctxTextAlign = textAlign;
        textX = textAlign === 'center' ? W / 2 : TEXT_PAD;
        textMaxW = W - TEXT_PAD * 2 - logoReserve;
    }

    // Measure text for height calculation
    const tmpCanvas = createCanvas(W, 1000);
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.font = `${SUB_SZ}px ${FONT}`;
    const subLines = wrapTextLines(tmpCtx, subtitle, textMaxW);
    tmpCtx.font = `${BODY_SZ}px ${FONT}`;
    const bodyLines = wrapTextLines(tmpCtx, bodyText, textMaxW, 8);

    const TITLE_H = TITLE_SZ + 10;
    const subH    = subLines.length * LINE_H;
    const bodyH   = bodyLines.length > 0 ? bodyLines.length * BODY_LINE_H + 8 : 0;
    const textContentH = TITLE_H + subH + bodyH;
    const headerH = Math.max(ICON_SZ + ICON_PAD * 2, 28 + textContentH + 28);

    // Load featured image to get aspect ratio
    let featuredImg = null;
    if (featuredImageUrl) {
        try { featuredImg = await loadImage(featuredImageUrl); } catch (_) {}
    }
    const featW = W - FEAT_PAD * 2;
    const FEAT_H = featuredImg ? Math.min(500, Math.round(featuredImg.height * featW / featuredImg.width)) : 0;

    // Card height — preset controls header area; featured image always extends below
    const heightMap = { compact: 164, standard: 220, tall: 340, banner: 500, xl: 750, xxl: 1100, giant: 1500 };
    const baseH = cardHeightOpt === 'auto'
        ? Math.max(164, headerH)
        : Math.max(heightMap[cardHeightOpt] || headerH, headerH);
    const H = baseH + (FEAT_H > 0 ? FEAT_PAD + FEAT_H + FEAT_PAD : 0);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Dark base
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.fill();

    // Gradient with per-colour alpha (no globalAlpha)
    const bg = ctx.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, hexToRgbaBot(gradientFrom, gradientFromAlpha));
    bg.addColorStop(1, hexToRgbaBot(gradientTo, gradientToAlpha));
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.fill();

    // Load images
    let mainImg = null;
    if (imageUrl) { try { mainImg = await loadImage(imageUrl); } catch (_) {} }
    if (!mainImg && imagePosition === 'left') {
        try { mainImg = await loadImage(client.user.displayAvatarURL({ size: 128, extension: 'png' })); } catch (_) {}
    }
    let logoImg = null;
    if (logoUrl) { try { logoImg = await loadImage(logoUrl); } catch (_) {} }

    // Background image
    if (imagePosition === 'background' && mainImg) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.roundRect(0, 0, W, baseH, 14); ctx.clip();
        const scale = Math.max(W / mainImg.width, baseH / mainImg.height);
        ctx.drawImage(mainImg, (W - mainImg.width * scale) / 2, (baseH - mainImg.height * scale) / 2, mainImg.width * scale, mainImg.height * scale);
        ctx.restore();
        const ov = ctx.createLinearGradient(0, 0, W, 0);
        ov.addColorStop(0, hexToRgbaBot(gradientFrom, Math.min(gradientFromAlpha, 80)));
        ov.addColorStop(1, hexToRgbaBot(gradientTo, Math.min(gradientToAlpha, 80)));
        ctx.fillStyle = ov;
        ctx.beginPath(); ctx.roundRect(0, 0, W, baseH, 14); ctx.fill();
    }

    // Side icon
    if ((imagePosition === 'left' || imagePosition === 'right') && mainImg) {
        const iconX = imagePosition === 'left' ? ICON_PAD : W - ICON_PAD - ICON_SZ;
        const iconY = Math.round((headerH - ICON_SZ) / 2);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(iconX, iconY, ICON_SZ, ICON_SZ, 16); ctx.clip();
        ctx.drawImage(mainImg, iconX, iconY, ICON_SZ, ICON_SZ);
        ctx.restore();
    }

    // Text bg scrim (before text, for readability on bright gradients)
    const totalTextH = TITLE_H + subH + bodyH;
    const titleY = Math.round((headerH - totalTextH) / 2);
    if (textBgOpacity > 0) {
        const SP = 10;
        const scrimX = ctxTextAlign === 'center' ? textX - textMaxW / 2 - SP : textX - SP;
        ctx.fillStyle = `rgba(0,0,0,${(textBgOpacity / 100).toFixed(2)})`;
        ctx.beginPath(); ctx.roundRect(scrimX, titleY - SP, textMaxW + SP * 2, totalTextH + SP * 2, 8); ctx.fill();
    }

    // Text
    ctx.textAlign = ctxTextAlign; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    ctx.font = `bold ${TITLE_SZ}px ${FONT}`;
    ctx.fillText(stripMd(title), textX, titleY);
    ctx.shadowBlur = 0;

    if (subLines.length) {
        ctx.fillStyle = '#93b4ca';
        subLines.forEach(function(line, i) { drawMdLine(ctx, line, textX, titleY + TITLE_H + i * LINE_H, SUB_SZ, FONT, ctxTextAlign); });
    }
    if (bodyLines.length) {
        ctx.fillStyle = '#6b7f99';
        bodyLines.forEach(function(line, i) { drawMdLine(ctx, line, textX, titleY + TITLE_H + subH + 8 + i * BODY_LINE_H, BODY_SZ, FONT, ctxTextAlign); });
    }

    // Logo overlay (top-right, drawn AFTER text so it's always visible)
    if (logoImg) {
        const lx = W - LOGO_SZ - LOGO_MARGIN, ly = LOGO_MARGIN;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(lx, ly, LOGO_SZ, LOGO_SZ, 8); ctx.clip();
        ctx.drawImage(logoImg, lx, ly, LOGO_SZ, LOGO_SZ);
        ctx.restore();
    }

    // Featured image (with side padding, rounded corners)
    if (featuredImg && FEAT_H > 0) {
        const imgY = baseH + FEAT_PAD, imgX = FEAT_PAD, imgW = W - FEAT_PAD * 2;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(imgX, imgY, imgW, FEAT_H, 10); ctx.clip();
        const s = Math.max(imgW / featuredImg.width, FEAT_H / featuredImg.height);
        ctx.drawImage(featuredImg, imgX + (imgW - featuredImg.width * s) / 2, imgY + (FEAT_H - featuredImg.height * s) / 2, featuredImg.width * s, featuredImg.height * s);
        ctx.restore();
    }

    return canvas.toBuffer('image/png');
}

async function generateTestCard() {
    return generateDiscordCard({
        title: 'TrueBeast',
        subtitle: 'Game Night! Click below to join the fun.',
        gradientFrom: '#1a2744',
        gradientTo: '#0d3d52',
        imagePosition: 'left',
    });
}

// ── Discord card queue poller (Firestore → Discord) ───────────────────────────

// In-memory dedup — prevents re-posting within this session even if Firestore write fails
const processedCardIds = new Set();

async function firestoreCardStatus(docId, status) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/discordCards/${docId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=status`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { status: { stringValue: status } } }),
        });
    } catch (e) { console.error('[BeastBot] firestoreCardStatus failed:', e.message); }
}

async function pollDiscordCards() {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/discordCards?key=${FIREBASE_API_KEY}&pageSize=20`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const docs = data.documents || [];
        for (const doc of docs) {
            const f = doc.fields || {};
            const docId = doc.name.split('/').pop();
            const status = f.status?.stringValue;

            // Skip already-processed or non-pending (in-memory dedup prevents re-posting even if Firestore write fails)
            if (processedCardIds.has(docId)) continue;
            if (status !== 'pending') continue;

            // Mark locally FIRST — prevents re-processing on next poll regardless of Firestore success
            processedCardIds.add(docId);
            await firestoreCardStatus(docId, 'sent'); // best-effort (requires Firestore rule: allow write: if true)

            const title            = f.title?.stringValue            || 'TrueBeast';
            const subtitle         = f.subtitle?.stringValue         || '';
            const bodyText         = f.bodyText?.stringValue         || '';
            const gradientFrom     = f.gradientFrom?.stringValue     || '';
            const gradientTo       = f.gradientTo?.stringValue       || '';
            const bgPreset         = f.bgPreset?.stringValue         || 'teal';
            // Per-colour alpha (new) with fallback to legacy gradientOpacity
            const legacyOpacity    = f.gradientOpacity?.integerValue !== undefined
                ? Number(f.gradientOpacity.integerValue)
                : (f.gradientOpacity?.doubleValue !== undefined ? Number(f.gradientOpacity.doubleValue) : 100);
            const gradientFromAlpha = f.gradientFromAlpha?.integerValue !== undefined
                ? Number(f.gradientFromAlpha.integerValue)
                : (f.gradientFromAlpha?.doubleValue !== undefined ? Number(f.gradientFromAlpha.doubleValue) : legacyOpacity);
            const gradientToAlpha  = f.gradientToAlpha?.integerValue !== undefined
                ? Number(f.gradientToAlpha.integerValue)
                : (f.gradientToAlpha?.doubleValue !== undefined ? Number(f.gradientToAlpha.doubleValue) : legacyOpacity);
            const textBgOpacity    = f.textBgOpacity?.integerValue !== undefined
                ? Number(f.textBgOpacity.integerValue)
                : (f.textBgOpacity?.doubleValue !== undefined ? Number(f.textBgOpacity.doubleValue) : 0);
            const imageUrl         = f.imageUrl?.stringValue         || null;
            const imagePosition    = f.imagePosition?.stringValue    || 'left';
            const logoUrl          = f.logoUrl?.stringValue          || null;
            const featuredImageUrl = f.featuredImageUrl?.stringValue || null;
            const textAlign        = f.textAlign?.stringValue        || 'left';
            const cardHeight       = f.cardHeight?.stringValue       || 'auto';
            const channelId        = f.channelId?.stringValue;
            const componentsJson   = f.componentsJson?.stringValue   || '';
            const buttonLabel      = f.buttonLabel?.stringValue      || '';
            const buttonUrl        = f.buttonUrl?.stringValue        || '';
            const buttonEmoji      = f.buttonEmoji?.stringValue      || '';
            const reactionsRaw     = f.reactions?.arrayValue?.values || [];
            const reactions        = reactionsRaw.map(function(v) { return v.stringValue; }).filter(Boolean);
            if (!channelId) continue;

            try {
                const buffer = await generateDiscordCard({ title, subtitle, bodyText, gradientFrom, gradientTo, bgPreset, gradientFromAlpha, gradientToAlpha, textBgOpacity, imageUrl, imagePosition, logoUrl, featuredImageUrl, textAlign, cardHeight });
                const attachment = new AttachmentBuilder(buffer, { name: 'card.png' });
                const channel = await client.channels.fetch(channelId);
                const msgOptions = { files: [attachment] };

                // Build Discord components from componentsJson or legacy single-button
                const discordRows = [];
                if (componentsJson) {
                    try {
                        const rows = JSON.parse(componentsJson);
                        for (const row of rows) {
                            const btns = row.filter(function(b) { return b.url && (b.label || b.emoji); }).map(function(b) {
                                let btn = new ButtonBuilder().setURL(b.url).setStyle(ButtonStyle.Link);
                                if (b.label) btn = btn.setLabel(b.label);
                                if (b.emoji) {
                                    const m = b.emoji.match(/(?:(.+):)?(\d{15,})$/);
                                    if (m) btn = btn.setEmoji({ name: m[1] || '_', id: m[2] });
                                    else btn = btn.setEmoji(b.emoji);
                                }
                                return btn;
                            });
                            if (btns.length) discordRows.push(new ActionRowBuilder().addComponents(...btns));
                        }
                    } catch (_) {}
                } else if (buttonLabel && buttonUrl) {
                    let btn = new ButtonBuilder().setURL(buttonUrl).setStyle(ButtonStyle.Link).setLabel(buttonLabel);
                    if (buttonEmoji) {
                        const m = buttonEmoji.match(/(?:(.+):)?(\d{15,})$/);
                        if (m) btn = btn.setEmoji({ name: m[1] || '_', id: m[2] });
                        else btn = btn.setEmoji(buttonEmoji);
                    }
                    discordRows.push(new ActionRowBuilder().addComponents(btn));
                }
                if (discordRows.length) msgOptions.components = discordRows;

                const postedMsg = await channel.send(msgOptions);
                for (let ri = 0; ri < reactions.length; ri++) {
                    try { await postedMsg.react(reactions[ri]); } catch (_) {}
                }
                console.log(`[BeastBot] Discord card posted to ${channelId}: "${title}"`);
            } catch (e) {
                console.error('[BeastBot] Failed to post Discord card:', e.message);
                await firestoreCardStatus(docId, 'failed');
            }
        }
    } catch (e) {
        console.error('[BeastBot] pollDiscordCards error:', e.message);
    }
}

// ── Bot Ready ─────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
    console.log(`[BeastBot] ✅  Logged in as ${client.user.tag}`);
    console.log(`[BeastBot] Monitoring channel(s): ${CHANNEL_IDS.join(', ')}`);
    console.log(`[BeastBot] Steam: ${STEAM_API_KEY ? 'enabled' : 'no API key yet'}`);
    // Log restart to logs channel instead of bump channel
    try {
        const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
        await logCh.send(`🔄 **Beast Bot restarted** — ${new Date().toUTCString()}\nReason: deployment update`);
    } catch (_) {}

    // Load ALL message counts from Firestore (paginated)
    try {
        let nextPageToken = null;
        do {
            let url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/messageCounts?key=${FIREBASE_API_KEY}&pageSize=300`;
            if (nextPageToken) url += `&pageToken=${nextPageToken}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const data = await res.json();
            (data.documents || []).forEach(doc => {
                const f = doc.fields || {};
                const uid = doc.name.split('/').pop();
                const dayRaw = f.days?.mapValue?.fields || {};
                const dMap = new Map();
                let daySum = 0;
                for (const [k, v] of Object.entries(dayRaw)) {
                    const n = parseInt(v.integerValue || '0', 10);
                    dMap.set(k, n);
                    daySum += n;
                }
                messageDays.set(uid, dMap);
                // Always derive total from daily counts — stored count field is ignored
                // so resets (which clear days) are always reflected correctly
                messageCounts.set(uid, daySum);
            });
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);
        console.log(`[BeastBot] Loaded ${messageCounts.size} message counts from Firestore`);

        // Load counting game state
        try {
            const res = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/counting/state?key=${FIREBASE_API_KEY}`);
            if (res.ok) {
                const data = await res.json();
                const f = data.fields || {};
                countingState.current    = parseInt(f.current?.integerValue    || '0', 10);
                countingState.lastUserId = f.lastUserId?.stringValue           || null;
                countingState.record     = parseInt(f.record?.integerValue     || '0', 10);
                countingState.ruinedBy   = (f.ruinedBy?.arrayValue?.values || []).map(v => ({
                    userId: v.mapValue.fields.userId.stringValue,
                    count:  parseInt(v.mapValue.fields.count.integerValue, 10),
                    at:     parseInt(v.mapValue.fields.at.integerValue, 10),
                }));
            }
            console.log(`[BeastBot] Counting loaded — current: ${countingState.current}, record: ${countingState.record}`);
        } catch (e) { console.error('[BeastBot] loadCountingState error:', e.message); }
    } catch (_) {}

    // Load voice minutes from Firestore
    try {
        let nextPageToken = null;
        do {
            let url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/voiceMinutes?key=${FIREBASE_API_KEY}&pageSize=300`;
            if (nextPageToken) url += `&pageToken=${nextPageToken}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`[BeastBot] voiceMinutes load failed: ${res.status} ${await res.text()}`);
                break;
            }
            const data = await res.json();
            (data.documents || []).forEach(doc => {
                const f = doc.fields || {};
                const uid = doc.name.split('/').pop();
                const total = parseInt(f.total?.integerValue || f.total?.doubleValue || '0', 10);
                const dayRaw = f.days?.mapValue?.fields || {};
                const dMap = new Map();
                for (const [k, v] of Object.entries(dayRaw)) {
                    dMap.set(k, parseInt(v.integerValue || v.doubleValue || '0', 10));
                }
                voiceMinutes.set(uid, { total, days: dMap });
            });
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);
        const totalMinutes = [...voiceMinutes.values()].reduce((s, d) => s + d.total, 0);
        console.log(`[BeastBot] Loaded ${voiceMinutes.size} voice minute records from Firestore (${totalMinutes} total minutes across all users)`);
    } catch (e) {
        console.error('[BeastBot] voiceMinutes load threw:', e.message);
    }

    // Load voice bonus XP from Firestore
    try {
        let nextPageToken = null;
        do {
            let url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/voiceBonusXp?key=${FIREBASE_API_KEY}&pageSize=300`;
            if (nextPageToken) url += `&pageToken=${nextPageToken}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const data = await res.json();
            (data.documents || []).forEach(doc => {
                const f = doc.fields || {};
                const uid = doc.name.split('/').pop();
                const total = parseFloat(f.total?.integerValue || f.total?.doubleValue || '0');
                const dayRaw = f.days?.mapValue?.fields || {};
                const dMap = new Map();
                for (const [k, v] of Object.entries(dayRaw)) dMap.set(k, parseFloat(v.integerValue || v.doubleValue || '0'));
                voiceBonusXp.set(uid, { total, days: dMap });
            });
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);
        console.log(`[BeastBot] Loaded ${voiceBonusXp.size} voice bonus XP records`);
    } catch (e) { console.error('[BeastBot] voiceBonusXp load threw:', e.message); }

    // Load rank achievements from Firestore
    try {
        let nextPageToken = null;
        do {
            let url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/rankAchievements?key=${FIREBASE_API_KEY}&pageSize=300`;
            if (nextPageToken) url += `&pageToken=${nextPageToken}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const data = await res.json();
            (data.documents || []).forEach(doc => {
                const f = doc.fields || {};
                const uid = doc.name.split('/').pop();
                rankAchievements.set(uid, {
                    highestRankIdx: parseInt(f.highestRankIdx?.integerValue || '0', 10),
                    apexCount:      parseInt(f.apexCount?.integerValue || '0', 10),
                    hitApexThisMonth: false,
                });
            });
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);
        console.log(`[BeastBot] Loaded ${rankAchievements.size} rank achievement records`);
    } catch (e) { console.error('[BeastBot] rankAchievements load threw:', e.message); }

    // Set up voice rank roles and monthly reset
    const guild = client.guilds.cache.first();
    if (guild) {
        // Single member fetch at startup — everything reuses guild.members.cache from here
        try {
            await guild.members.fetch();
            for (const [id, member] of guild.members.cache) {
                if (!member.user.bot) {
                    memberNameCache.set(id, member.displayName);
                    memberCache.set(id, {
                        displayName: member.displayName,
                        avatarUrl: member.user.displayAvatarURL({ size: 128, extension: 'png' }),
                    });
                }
            }
            console.log(`[BeastBot] Cached ${memberNameCache.size} member display names`);
        } catch (e) { console.error('[BeastBot] Member cache fetch failed:', e.message); }

        await ensureVoiceRankRoles(guild).catch(e => console.error('[BeastBot] ensureVoiceRankRoles failed:', e.message));
        await checkMonthlyReset(guild).catch(e => console.error('[BeastBot] checkMonthlyReset failed:', e.message));


        // Assign correct voice rank to every member based on monthly activity score
        try {
            let assigned = 0;
            for (const [, member] of guild.members.cache) {
                if (member.user.bot) continue;
                await assignVoiceRank(member, monthlyActivityScore(member.id)).catch(() => {});
                assigned++;
            }
            console.log(`[BeastBot] Startup role sync complete for ${assigned} members`);
        } catch (e) { console.error('[BeastBot] Startup role sync failed:', e.message); }

        // Pre-warm emoji image cache for rank pill rendering
        Promise.all(VOICE_RANK_ROLES.map(r => {
            const e = extractFirstEmoji(r.name);
            return e ? loadEmojiImage(e) : null;
        })).then(() => console.log('[BeastBot] Emoji image cache warmed'));
        setInterval(() => checkMonthlyReset(guild).catch(() => {}), 60 * 60 * 1000);

        // Resume tracking for members already in voice channels
        guild.channels.cache
            .filter(ch => (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) && ch.id !== AFK_CHANNEL_ID && ch.id !== TEMP_VC_TRIGGER_ID)
            .forEach(ch => ch.members.forEach(member => {
                if (!member.user.bot) {
                    const existing = voiceMinutes.get(member.id) || { total: 0, days: new Map() };
                    voiceStartTimes.set(member.id, {
                        startMs: Date.now(),
                        baseTotal: existing.total,
                        baseToday: existing.days.get(todayStr()) || 0,
                    });
                    voiceEnhancements.set(member.id, {
                        camera: member.voice.selfVideo || false,
                        stream: member.voice.selfStream || false,
                        inStage: ch.type === ChannelType.GuildStageVoice,
                    });
                }
            }));
        console.log(`[BeastBot] Resumed voice tracking for ${voiceStartTimes.size} active members`);

        // Tick every 60s — update voiceMinutes + accumulate camera/stream bonus XP
        setInterval(() => {
            const today = todayStr();
            for (const [uid] of voiceStartTimes) {
                creditVoiceTime(uid);
                // Bonus XP: camera=+0.5/min, stream=+0.5/min, both=+1.0/min
                const bonus = getXpMultiplier(uid) - 1.0;
                if (bonus > 0) {
                    const bData = voiceBonusXp.get(uid) || { total: 0, days: new Map() };
                    bData.total += bonus;
                    bData.days.set(today, (bData.days.get(today) || 0) + bonus);
                    voiceBonusXp.set(uid, bData);
                }
            }
        }, 60 * 1000);

        // Persist active sessions to Firestore every 60 seconds
        setInterval(() => {
            const active = [...voiceStartTimes.keys()];
            if (active.length === 0) return;
            for (const uid of active) {
                const data = voiceMinutes.get(uid);
                if (data) saveVoiceMinutes(uid, { total: data.total, days: Object.fromEntries(data.days) });
                const bData = voiceBonusXp.get(uid);
                if (bData) saveVoiceBonusXp(uid, { total: bData.total, days: Object.fromEntries(bData.days) });
            }
            console.log(`[BeastBot] 💾 Saved voice data for ${active.length} active session(s)`);
        }, 60 * 1000);
    }

    // Check for anniversary milestones daily
    setInterval(() => checkAnniversaries(), 24 * 60 * 60 * 1000);
    setTimeout(() => checkAnniversaries(), 30000); // check 30s after startup

    // Register slash commands
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        const commands = [
            new SlashCommandBuilder()
                .setName('leaderboard')
                .setDescription('Show the top 10 most active members in the server'),
            new SlashCommandBuilder()
                .setName('rank')
                .setDescription('Check your message count and rank')
                .addUserOption(opt => opt.setName('user').setDescription('User to check (defaults to you)')),
            new SlashCommandBuilder()
                .setName('leavetimer')
                .setDescription('Set a timer to automatically leave voice chat')
                .addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes before you leave (1-120)').setRequired(true).setMinValue(1).setMaxValue(120))
                .addStringOption(opt => opt.setName('reason').setDescription('Why are you leaving? (shown to others)')),
            new SlashCommandBuilder()
                .setName('canceltimer')
                .setDescription('Cancel your active leave timer'),
            new SlashCommandBuilder()
                .setName('afk')
                .setDescription('Set yourself as AFK in voice chat')
                .addStringOption(opt => opt.setName('reason').setDescription('Why are you AFK?')),
            new SlashCommandBuilder()
                .setName('cleanvcs')
                .setDescription('Clean up empty temporary voice channels (admin only)'),
            new SlashCommandBuilder()
                .setName('assignbronze')
                .setDescription('(Owner only) Assign Bronze I to every member without a rank role'),
            new SlashCommandBuilder()
                .setName('scanmessages')
                .setDescription('(Owner only) Scan all channels for the last 30 days and rebuild message counts'),
            new SlashCommandBuilder()
                .setName('resetmessages')
                .setDescription('(Owner only) Wipe all message counts to zero and re-sync ranks'),
            new SlashCommandBuilder()
                .setName('me')
                .setDescription('View your stats and rank'),
            new SlashCommandBuilder()
                .setName('profile')
                .setDescription('View your stats and rank'),
            new SlashCommandBuilder()
                .setName('rank-tutorial')
                .setDescription('Learn how the TrueBeast ranking system works'),
            new SlashCommandBuilder()
                .setName('counting')
                .setDescription('View counting game stats and wall of shame'),
            new SlashCommandBuilder()
                .setName('resetcounting')
                .setDescription('(Owner only) Reset the counting game to zero'),
            new SlashCommandBuilder()
                .setName('restart')
                .setDescription('(Owner only) Restart the bot'),
        ].map(c => c.toJSON());

        await rest.put(Routes.applicationGuildCommands(client.user.id, client.guilds.cache.first().id), { body: commands });
        console.log('[BeastBot] Slash commands registered');
    } catch (e) {
        console.error('[BeastBot] Failed to register slash commands:', e.message);
    }

    scheduleDiscordMeReminder();
    scheduleSpotlight();
    scheduleGiveawayCheck();

    // Restore bump timers from Firestore (survive restarts)
    try {
        const disboardData = await firestoreGet('botTimers', 'disboard');
        const discadiaData = await firestoreGet('botTimers', 'discadia');
        const now = Date.now();

        if (disboardData && disboardData.fireAt > now) {
            const delay = disboardData.fireAt - now;
            console.log(`[BeastBot] Restoring Disboard timer — fires in ${Math.round(delay / 60000)}m`);
            if (bumpTimer) clearTimeout(bumpTimer);
            bumpTimer = setTimeout(async () => {
                try {
                    const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
                    await channel.send('⏰ Time to bump! Run `/bump` to keep the server visible on Disboard.');
                    console.log('[BeastBot] 🔔 Sent Disboard bump reminder');
                } catch (e) { console.error('[BeastBot] Failed to send bump reminder:', e.message); }
            }, delay);
        } else {
            console.log('[BeastBot] No active Disboard timer to restore');
        }

        if (discadiaData && discadiaData.fireAt > now) {
            const delay = discadiaData.fireAt - now;
            console.log(`[BeastBot] Restoring Discadia timer — fires in ${Math.round(delay / 60000)}m`);
            scheduleDiscadiaReminder(delay);
        } else {
            scheduleDiscadiaReminder(10 * 60 * 60 * 1000);
        }
    } catch (e) {
        console.error('[BeastBot] Failed to restore timers:', e.message);
        scheduleDiscadiaReminder(10 * 60 * 60 * 1000);
    }

    // Clean up orphaned temp VCs (empty VCs in same category as trigger, left from before restart)
    try {
        const trigger = await client.channels.fetch(TEMP_VC_TRIGGER_ID);
        if (trigger?.parentId) {
            const guild    = trigger.guild;
            const category = guild.channels.cache.get(trigger.parentId);
            if (category) {
                const orphans = category.children.cache.filter(ch =>
                    ch.type === ChannelType.GuildVoice &&
                    ch.id !== TEMP_VC_TRIGGER_ID &&
                    ch.members.size === 0 &&
                    ch.name.endsWith("'s Channel")
                );
                for (const [, ch] of orphans) {
                    await ch.delete('Temp VC: orphaned on restart').catch(() => {});
                    console.log(`[BeastBot] 🔊 Deleted orphaned temp VC: ${ch.name}`);
                }
            }
        }
    } catch (e) {
        console.error('[BeastBot] Temp VC cleanup failed:', e.message);
    }

    // Poll Firestore for queued Discord cards every 15s
    setInterval(() => pollDiscordCards().catch(() => {}), 15 * 1000);
    setTimeout(() => pollDiscordCards().catch(() => {}), 3000); // first poll 3s after ready

    // Heartbeat every 30 min so we can detect silent crashes
    setInterval(() => {
        console.log(`[BeastBot] 💓 heartbeat — uptime ${Math.round(process.uptime() / 60)}m`);
    }, 30 * 60 * 1000);

});

// ── Button interactions ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    // ── Slash commands ───────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'leaderboard') {
            const pickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('lbt:msg:week').setLabel('📩 Messages').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('lbt:vc:week').setLabel('🎙️ Voice Time').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('lbranks').setLabel('❓ Help').setStyle(ButtonStyle.Success),
            );
            const { resource } = await interaction.reply({ content: '**Choose a leaderboard:**', components: [pickRow], withResponse: true });
            leaderboardOwners.set(resource.message.id, interaction.user.id);
            return;
        }

        if (interaction.commandName === 'rank-tutorial') {
            await interaction.reply({ embeds: [buildRanksEmbed()], ephemeral: true });
            return;
        }

        if (interaction.commandName === 'counting') {
            const shameTally = {};
            for (const r of countingState.ruinedBy) {
                if (!shameTally[r.userId]) shameTally[r.userId] = { count: 0, highest: 0 };
                shameTally[r.userId].count++;
                if (r.count > shameTally[r.userId].highest) shameTally[r.userId].highest = r.count;
            }
            const shameList = Object.entries(shameTally)
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 10)
                .map(([uid, d], i) => `${i + 1}. <@${uid}> — ruined **${d.count}x** (highest ruin at **${d.highest}**)`)
                .join('\n') || 'No ruins yet — keep counting!';
            await interaction.reply({ embeds: [{
                color: 0x4ade80,
                title: '💯 Counting Stats',
                fields: [
                    { name: '🔢 Current Count', value: `**${countingState.current}**`, inline: true },
                    { name: '🏆 All-Time Record', value: `**${countingState.record}**`, inline: true },
                    { name: '🪦 Wall of Shame', value: shameList },
                ],
                footer: { text: `${countingState.ruinedBy.length} total ruins recorded` },
            }], ephemeral: true });
            return;
        }

        if (interaction.commandName === 'resetcounting') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            countingState.current = 0;
            countingState.lastUserId = null;
            countingState.record = 0;
            countingState.ruinedBy = [];
            await saveCountingState();
            const ch = interaction.guild.channels.cache.get(COUNTING_CHANNEL_ID);
            if (ch) await ch.setName('💯│counting').catch(() => {});
            await interaction.reply({ content: '✅ Counting game reset to zero — channel name restored.', ephemeral: true });
            return;
        }

        if (interaction.commandName === 'rank') {
            const target = interaction.options.getUser('user') || interaction.user;
            const count  = messageCounts.get(target.id) || 0;
            const sorted = [...messageCounts.entries()].sort((a, b) => b[1] - a[1]);
            const rank   = sorted.findIndex(([id]) => id === target.id) + 1;
            const nextMilestone = MILESTONE_THRESHOLDS.find(t => t > count);
            const remaining     = nextMilestone ? nextMilestone - count : null;

            let member;
            try { member = await interaction.guild.members.fetch(target.id); } catch {}
            const name = member?.displayName || target.username;

            await interaction.reply({
                embeds: [{
                    color: 0x22c55e,
                    title: `📊 ${name}'s Stats`,
                    thumbnail: { url: target.displayAvatarURL({ dynamic: true, size: 128 }) },
                    fields: [
                        { name: '💬 Messages', value: count.toLocaleString(), inline: true },
                        { name: '📈 Rank', value: rank > 0 ? `#${rank} of ${messageCounts.size}` : 'Unranked', inline: true },
                        { name: '🎯 Next Milestone', value: remaining ? `${nextMilestone.toLocaleString()} (${remaining.toLocaleString()} to go)` : 'All milestones reached! 👑', inline: true },
                    ],
                    timestamp: new Date().toISOString(),
                }],
            });
            return;
        }

        // ── /me ───────────────────────────────────────────────────────────────
        if (interaction.commandName === 'me' || interaction.commandName === 'profile') {
            await interaction.deferReply();
            try {
                const buffer = await generateProfileImage(interaction.user.id);
                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                await interaction.editReply({ files: [attachment] });
            } catch (e) {
                console.error('[BeastBot] /me image failed:', e.message);
                await interaction.editReply({ content: '❌ Failed to generate profile card. Try again in a moment.' });
            }
            return;
        }

        // ── /restart ──────────────────────────────────────────────────────────
        if (interaction.commandName === 'restart') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Only the owner can restart the bot.', ephemeral: true });
                return;
            }
            await interaction.reply({ content: '🔄 Restarting bot...', ephemeral: true });
            setTimeout(() => process.exit(0), 1000);
            return;
        }

        // ── /leavetimer ───────────────────────────────────────────────────────
        if (interaction.commandName === 'leavetimer') {
            const member = interaction.member;
            const voiceChannel = member?.voice?.channel;

            if (!voiceChannel) {
                await interaction.reply({ content: '❌ You need to be in a voice channel to use this!', ephemeral: true });
                return;
            }

            const minutes = interaction.options.getInteger('minutes');
            const reason = interaction.options.getString('reason') || 'No reason given';
            const delayMs = minutes * 60 * 1000;
            const leaveAt = Math.floor((Date.now() + delayMs) / 1000);
            const leaveTimestamp = `<t:${leaveAt}:R>`;

            // Cancel existing timer if any
            cancelLeaveTimer(member.id);

            // Find a text channel to post announcements in
            // Try the VC's associated text chat, then the interaction channel
            const textChannel = interaction.channel;

            // Set warning timeout (1 minute before, only if timer > 1 min)
            let warningTimeout = null;
            if (minutes > 1) {
                warningTimeout = setTimeout(async () => {
                    try {
                        await textChannel.send({
                            embeds: [{
                                color: 0xf59e0b,
                                description: `⏰ **1 minute left!** ${member} is leaving ${leaveTimestamp}${reason !== 'No reason given' ? ' — *' + reason + '*' : ''}`,
                            }],
                        });
                    } catch (e) { console.warn('[BeastBot] Leave timer warning failed:', e.message); }
                }, delayMs - 60000);
            }

            // Set main disconnect timeout
            const mainTimeout = setTimeout(async () => {
                try {
                    // Post farewell
                    await textChannel.send({
                        embeds: [{
                            color: 0x6b7280, // gray
                            description: `👋 **${member.displayName} has left the call**${reason !== 'No reason given' ? ' — *' + reason + '*' : ''}. See you next time!`,
                        }],
                    });
                    // Disconnect from voice
                    if (member.voice?.channel) {
                        await member.voice.disconnect();
                    }
                } catch (e) { console.warn('[BeastBot] Leave timer disconnect failed:', e.message); }
                leaveTimers.delete(member.id);
            }, delayMs);

            leaveTimers.set(member.id, {
                mainTimeout,
                warningTimeout,
                channelId: voiceChannel.id,
                textChannelId: textChannel.id,
                reason,
                minutes,
            });

            // Reply ephemerally to the user
            await interaction.reply({
                content: `✅ Timer set! You'll be disconnected in **${minutes} minute${minutes > 1 ? 's' : ''}**.`,
                ephemeral: true,
            });

            // Announce to the channel
            const timeText = minutes === 1 ? '1 minute' : `${minutes} minutes`;
            await textChannel.send({
                embeds: [{
                    color: 0x22c55e,
                    description: `🕐 **Heads up!** ${member} needs to leave in **${timeText}** (${leaveTimestamp})${reason !== 'No reason given' ? ' — *' + reason + '*' : ''}\nWrap up your conversation with them soon!`,
                }],
            });

            return;
        }

        // ── /canceltimer ──────────────────────────────────────────────────────
        if (interaction.commandName === 'canceltimer') {
            if (leaveTimers.has(interaction.user.id)) {
                cancelLeaveTimer(interaction.user.id);
                await interaction.reply({ content: '✅ Your leave timer has been cancelled.', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ You don\'t have an active leave timer.', ephemeral: true });
            }
            return;
        }

        // ── /afk ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'afk') {
            const member = interaction.member;
            const voiceChannel = member?.voice?.channel;
            if (!voiceChannel) {
                await interaction.reply({ content: '❌ You need to be in a voice channel to go AFK!', ephemeral: true });
                return;
            }
            const reason = interaction.options.getString('reason') || 'No reason given';
            const currentNick = member.displayName;
            const afkNick = `[AFK] ${currentNick}`.slice(0, 32);
            afkUsers.set(interaction.user.id, {
                reason,
                originalNickname: currentNick,
                timestamp: Date.now(),
            });
            try { await member.setNickname(afkNick); } catch (e) { console.error('[BeastBot] Failed to set AFK nickname:', e.message); }
            await interaction.reply({
                embeds: [{
                    color: 0x22c55e,
                    description: `💤 **${currentNick}** is now AFK: *${reason}*\nI'll announce their return when they send a message.`,
                }],
            });
            return;
        }

        // ── /cleanvcs ────────────────────────────────────────────────────────
        if (interaction.commandName === 'cleanvcs') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Only the server owner can use this command.', ephemeral: true });
                return;
            }
            let deleted = 0;
            for (const [chId, vcData] of tempVoiceChannels) {
                if (vcData.deleteTimer) clearTimeout(vcData.deleteTimer);
                try {
                    const ch = client.channels.cache.get(chId);
                    if (ch) { await ch.delete('/cleanvcs command'); deleted++; }
                } catch (_) {}
                tempVoiceChannels.delete(chId);
            }
            await interaction.reply({ content: `🧹 Cleaned up **${deleted}** temp voice channel(s).`, ephemeral: true });
            return;
        }

        // ── /assignbronze (TEMP — remove after confirmed working) ────────────
        if (interaction.commandName === 'assignbronze') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            const bronzeRole = interaction.guild.roles.cache.get(VOICE_RANK_ROLES[0].id);
            if (!bronzeRole) { await interaction.editReply('❌ Bronze I role not found by ID.'); return; }
            // Fresh full member fetch to make sure we have everyone
            await interaction.guild.members.fetch();
            const allRankIds = new Set(VOICE_RANK_ROLES.map(r => r.id));
            const toAssign = [...interaction.guild.members.cache.values()]
                .filter(m => !m.user.bot && !m.roles.cache.some(r => allRankIds.has(r.id)));
            await interaction.editReply(`⏳ Assigning Bronze I to **${toAssign.length}** members — this may take a minute...`);
            let success = 0, failed = 0;
            for (const member of toAssign) {
                try { await member.roles.add(bronzeRole); success++; }
                catch (_) { failed++; }
            }
            await interaction.followUp({ content: `✅ Done! **${success}** assigned, **${failed}** failed.`, ephemeral: true });
            return;
        }

        // ── /scanmessages ─────────────────────────────────────────────────────
        if (interaction.commandName === 'scanmessages') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });

            const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const sinceStr = new Date(since).toISOString().slice(0, 10);
            const botMember = interaction.guild.members.me;
            const channels = interaction.guild.channels.cache.filter(ch =>
                ch.isTextBased() &&
                !ch.isDMBased?.() &&
                ch.permissionsFor(botMember)?.has('ReadMessageHistory')
            );

            await interaction.editReply(`⏳ Starting scan of **${channels.size}** channels for the last 30 days...`);

            // Build fresh per-day counts from the scan
            const scanned = new Map(); // userId → Map<dateStr, count>
            let totalMsgs = 0, chDone = 0;

            for (const [, channel] of channels) {
                let lastId = null;
                let keepGoing = true;
                while (keepGoing) {
                    try {
                        const opts = { limit: 100 };
                        if (lastId) opts.before = lastId;
                        const batch = await channel.messages.fetch(opts);
                        if (batch.size === 0) break;
                        for (const [, msg] of batch) {
                            if (msg.createdTimestamp < since) { keepGoing = false; break; }
                            if (msg.author.bot) continue;
                            const ds = new Date(msg.createdTimestamp).toISOString().slice(0, 10);
                            if (!scanned.has(msg.author.id)) scanned.set(msg.author.id, new Map());
                            const dm = scanned.get(msg.author.id);
                            dm.set(ds, (dm.get(ds) || 0) + 1);
                            totalMsgs++;
                        }
                        lastId = batch.last()?.id;
                        if (batch.size < 100) break;
                    } catch (_) { break; }
                }
                chDone++;
                if (chDone % 10 === 0) {
                    await interaction.editReply(`⏳ **${chDone}/${channels.size}** channels scanned, **${totalMsgs.toLocaleString()}** messages so far...`).catch(() => {});
                }
            }

            // Merge into messageDays — overwrite dates within scan window, keep older dates
            for (const [userId, dMap] of scanned) {
                let existing = messageDays.get(userId);
                if (!existing) { existing = new Map(); messageDays.set(userId, existing); }
                for (const [k] of [...existing]) if (k >= sinceStr) existing.delete(k);
                for (const [k, v] of dMap) existing.set(k, v);
            }

            // Rebuild in-memory totals from days (so All Time stays consistent)
            for (const [userId] of scanned) {
                const dMap = messageDays.get(userId);
                if (!dMap) continue;
                let sum = 0;
                for (const v of dMap.values()) sum += v;
                if (sum > (messageCounts.get(userId) || 0)) messageCounts.set(userId, sum);
            }

            // Save all updated users to Firestore (days + reconciled total)
            const userIds = [...scanned.keys()];
            for (let i = 0; i < userIds.length; i += 20) {
                await Promise.allSettled(
                    userIds.slice(i, i + 20).flatMap(uid => {
                        const dm = messageDays.get(uid);
                        return [
                            dm ? saveMessageDays(uid, dm) : Promise.resolve(),
                            saveMessageCount(uid, messageCounts.get(uid) || 0),
                        ];
                    })
                );
            }

            await interaction.editReply(
                `✅ Scan complete!\n` +
                `📨 **${totalMsgs.toLocaleString()}** messages across **${chDone}** channels\n` +
                `👥 **${scanned.size}** users' daily counts updated in Firestore`
            );
            return;
        }

        // ── /resetmessages ────────────────────────────────────────────────────
        if (interaction.commandName === 'resetmessages') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });

            const userIds = [...new Set([...messageCounts.keys(), ...messageDays.keys()])];
            messageCounts.clear();
            messageDays.clear();

            // Zero out Firestore for every known user
            for (let i = 0; i < userIds.length; i += 20) {
                await Promise.allSettled(
                    userIds.slice(i, i + 20).map(uid => {
                        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/messageCounts/${uid}?key=${FIREBASE_API_KEY}`;
                        return fetch(url, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fields: { count: { integerValue: '0' }, days: { mapValue: { fields: {} } } } }),
                        });
                    })
                );
            }

            // Re-sync ranks so message-based XP is removed from roles
            let synced = 0;
            try {
                await interaction.guild.members.fetch();
                for (const [, member] of interaction.guild.members.cache) {
                    if (member.user.bot) continue;
                    await assignVoiceRank(member, monthlyActivityScore(member.id)).catch(() => {});
                    synced++;
                }
            } catch (e) {
                console.error('[BeastBot] resetmessages rank sync failed:', e.message);
            }

            await interaction.editReply(
                `✅ Message counts reset to zero for **${userIds.length}** users.\n` +
                `🔄 Re-synced ranks for **${synced}** members.`
            );
            return;
        }
    }

    // ── Introduction modal submit ─────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'intro:modal') {
        const name        = interaction.fields.getTextInputValue('intro_name');
        const ageLocation = interaction.fields.getTextInputValue('intro_age_location');
        const about       = interaction.fields.getTextInputValue('intro_about');
        const hobbies     = interaction.fields.getTextInputValue('intro_hobbies');
        const games       = interaction.fields.getTextInputValue('intro_games');

        const user   = interaction.user;
        const member = interaction.member;

        const q = s => `> ${s.split('\n').join('\n> ')}`;

        const embedFields = [
            { name: '📍 Age & Location', value: q(ageLocation), inline: true },
            { name: '👤 About', value: q(about), inline: false },
        ];
        if (hobbies) embedFields.push({ name: '🎯 Hobbies & Interests', value: q(hobbies), inline: false });
        if (games)   embedFields.push({ name: '🎮 Games & Streams', value: q(games), inline: false });

        const embed = {
            color: 0x5865f2,
            author: { name: '👋 New Introduction!' },
            title: name,
            thumbnail: { url: user.displayAvatarURL({ dynamic: true, size: 256 }) },
            fields: embedFields,
            footer: {
                text: `@${user.username}`,
                icon_url: user.displayAvatarURL({ dynamic: true }),
            },
            timestamp: new Date().toISOString(),
        };

        try {
            if (!INTRO_CHANNEL_ID) throw new Error('INTRO_CHANNEL_ID not set');

            const introChannel = await client.channels.fetch(INTRO_CHANNEL_ID);
            const introRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('intro:start')
                    .setLabel('📝 Make your own introduction')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`intro:delete:${user.id}`)
                    .setLabel('🗑️ Delete this intro')
                    .setStyle(ButtonStyle.Danger),
            );
            await introChannel.send({
                content: `Welcome to the server, <@${user.id}>! 🎉`,
                embeds: [embed],
                components: [introRow],
            });
            await interaction.reply({ content: '✅ Your introduction has been posted — welcome to the community!', ephemeral: true });
            console.log(`[BeastBot] 📋 Introduction posted for ${user.tag}`);
        } catch (e) {
            console.error('[BeastBot] Failed to post introduction:', e.message);
            await interaction.reply({ content: '❌ Something went wrong posting your intro. Try again or let Kiernen know.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isButton()) return;

    // ── Coloured card buttons (non-link, generated by Discord Cards tool) ─────

    // ── Ranks info button ──────────────────────────────────────────────────────
    if (interaction.customId === 'lbranks') {
        await interaction.reply({ embeds: [buildRanksEmbed()], ephemeral: true });
        return;
    }

    // ── Leaderboard buttons (lbt/lbp/lbn/lbx/lbclose prefixes) ──────────────
    if (/^lb[tpnx]/.test(interaction.customId) || interaction.customId === 'lbclose') {
        if (interaction.customId === 'lbx') { await interaction.deferUpdate(); return; }
        if (interaction.customId === 'lbclose') {
            await interaction.deferUpdate();
            leaderboardOwners.delete(interaction.message.id);
            await interaction.deleteReply();
            return;
        }
        // Only the person who invoked /leaderboard can use the buttons
        const ownerId = leaderboardOwners.get(interaction.message.id);
        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({ content: '❌ Only the person who opened this leaderboard can use these buttons.', ephemeral: true });
            return;
        }
        // lbt:type:period  |  lbp:type:period  |  lbn:type:period:page
        const parts = interaction.customId.split(':');
        const type   = parts[1];
        const period = parts[2];
        const page   = parseInt(parts[3] || '0', 10);
        await interaction.deferUpdate();
        try {
            const { buffer, page: safePage, totalPages } = await generateLeaderboardImage(type, period, page);
            const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
            const components = buildLeaderboardComponents(type, period, safePage, totalPages);
            await interaction.editReply({ files: [attachment], components });
        } catch (e) {
            console.error('[BeastBot] leaderboard button image failed:', e.message);
        }
        return;
    }

    // Intro delete button — original poster or mod only; shows confirmation first
    if (interaction.customId.startsWith('intro:delete:')) {
        const originalUserId = interaction.customId.split(':')[2];
        const isMod = MOD_ROLE_ID && interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
        const isOwner = interaction.user.id === originalUserId;
        if (!isOwner && !isMod) {
            await interaction.reply({ content: 'Only the person who posted this intro or a mod can delete it.', ephemeral: true });
            return;
        }
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`intro:confirm_delete:${interaction.message.id}`)
                .setLabel('Yes, delete it')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('intro:cancel_delete')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: '⚠️ Are you sure you want to delete this introduction? This can\'t be undone.',
            components: [confirmRow],
            ephemeral: true,
        });
        return;
    }

    // Intro delete confirmed
    if (interaction.customId.startsWith('intro:confirm_delete:')) {
        const messageId = interaction.customId.split(':')[2];
        try {
            const msg = await interaction.channel.messages.fetch(messageId);
            await msg.delete();
        } catch (_) {}
        await interaction.update({ content: '🗑️ Introduction deleted.', components: [] });
        return;
    }

    // Intro delete cancelled
    if (interaction.customId === 'intro:cancel_delete') {
        await interaction.update({ content: '👍 Cancelled — nothing was deleted.', components: [] });
        return;
    }

    // Intro button — opens the modal, or tells them they've already done it
    if (interaction.customId === 'intro:start') {
        if (await hasIntroduced(interaction.user.id)) {
            await interaction.reply({ content: 'You\'ve already introduced yourself — check the channel! 👀', ephemeral: true });
            return;
        }
        const modal = new ModalBuilder()
            .setCustomId('intro:modal')
            .setTitle('👋 Introduce Yourself!');

        const fields = [
            new TextInputBuilder()
                .setCustomId('intro_name')
                .setLabel('What should we call you?')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Alex')
                .setRequired(true)
                .setMaxLength(50),
            new TextInputBuilder()
                .setCustomId('intro_age_location')
                .setLabel('Age & where are you from?')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 24, London, UK')
                .setRequired(true)
                .setMaxLength(100),
            new TextInputBuilder()
                .setCustomId('intro_about')
                .setLabel('Tell us about yourself')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Who are you? What do you do? Job, streaming, content creation...')
                .setRequired(true)
                .setMaxLength(500),
            new TextInputBuilder()
                .setCustomId('intro_hobbies')
                .setLabel('Hobbies & interests')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Photography, football, cooking...')
                .setRequired(false)
                .setMaxLength(200),
            new TextInputBuilder()
                .setCustomId('intro_games')
                .setLabel('Favourite games & streams')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Valorant, Minecraft — Twitch: username')
                .setRequired(false)
                .setMaxLength(200),
        ];

        modal.addComponents(fields.map(f => new ActionRowBuilder().addComponents(f)));
        await interaction.showModal(modal);
        return;
    }

    // Discadia bump confirm — owner only
    if (interaction.customId === 'discadia:bumped') {
        if (interaction.user.id !== OWNER_DISCORD_ID) {
            await interaction.reply({ content: 'Only Kiernen can confirm this one!', ephemeral: true });
            return;
        }
        await interaction.update({
            content: '✅ Discadia bumped! Next reminder in 24 hours.',
            components: [],
        });
        scheduleDiscadiaReminder(DISCADIA_INTERVAL);
        console.log('[BeastBot] Discadia bump confirmed — 24h timer started');
        return;
    }

    if (interaction.user.id !== OWNER_DISCORD_ID) {
        await interaction.reply({ content: 'These buttons aren\'t for you 👀', ephemeral: true });
        return;
    }

    const [action, questionId] = interaction.customId.split(':');
    const qData = questionQueue.get(questionId);

    if (!qData) {
        await interaction.update({ content: interaction.message.content + '\n\n~~Already handled.~~', components: [] });
        return;
    }

    if (action === 'skip') {
        questionQueue.delete(questionId);
        await interaction.update({ content: interaction.message.content + '\n\n~~Skipped.~~', components: [] });
        return;
    }

    if (action === 'answer') {
        const dmChannelId = interaction.channelId;
        activeSession.set(dmChannelId, { ...qData, questionId, state: 'awaiting_answer' });
        questionQueue.delete(questionId);
        await interaction.update({
            content: interaction.message.content + '\n\n_Go ahead — type your answer below._',
            components: [],
        });
        return;
    }
});

// ── New member join — send intro prompt DM ────────────────────────────────────


// ── Messages ──────────────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
    // Counting channel game
    if (message.channel.id === COUNTING_CHANNEL_ID) {
        await handleCountingMessage(message);
        return;
    }

    // Detect Disboard bump success — reset the 2h reminder timer
    if (message.author.id === DISBOARD_BOT_ID && message.channel.id === BUMP_CHANNEL_ID) {
        const hasBumpDone = message.embeds?.some(e =>
            (e.description || '').toLowerCase().includes('bump done')
        );
        if (hasBumpDone) {
            console.log('[BeastBot] Disboard bump detected — resetting 2h timer');
            scheduleBumpReminder();
        }
        return;
    }

    // Detect Discadia bump success — reset the 24h reminder timer
    if (message.author.id === DISCADIA_BOT_ID && message.channel.id === BUMP_CHANNEL_ID) {
        if (message.content.toLowerCase().includes('has been successfully bumped')) {
            console.log('[BeastBot] Discadia bump detected — resetting 24h timer');
            scheduleDiscadiaReminder(DISCADIA_INTERVAL);
        }
        return;
    }

    if (message.author.bot) return;

    // ── AFK system ───────────────────────────────────────────────────────────
    if (message.guild) {
        // Check if this user is AFK and just came back
        const afkData = afkUsers.get(message.author.id);
        if (afkData && !message.content.toLowerCase().startsWith('!!afk')) {
            const member = message.member;
            const voiceChannel = member?.voice?.channel;
            if (voiceChannel) {
                // Remove AFK
                afkUsers.delete(message.author.id);
                try {
                    await member.setNickname(afkData.originalNickname);
                } catch (e) {
                    console.error('[BeastBot] Failed to restore nickname:', e.message);
                }
                // Find the text chat associated with the voice channel
                // Voice channels have a built-in text chat (same channel ID)
                try {
                    const duration = Math.round((Date.now() - afkData.timestamp) / 60000);
                    let timeStr;
                    if (duration < 60) timeStr = `${duration}m`;
                    else timeStr = `${Math.floor(duration / 60)}h ${duration % 60}m`;
                    await voiceChannel.send(`👋 **${afkData.originalNickname}** is back! (was AFK for ${timeStr} — *${afkData.reason}*)`);
                } catch (e) {
                    console.error('[BeastBot] Failed to announce AFK return in VC text:', e.message);
                }
                console.log(`[BeastBot] AFK removed for ${message.author.tag}`);
            }
        }

        // AFK is now handled via /afk slash command

        // Check if anyone pinged or replied to an AFK user
        const mentionedUsers = message.mentions.users;
        const repliedUserId  = message.reference ? (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author?.id : null;
        const pingedIds = [...mentionedUsers.keys()];
        if (repliedUserId && !pingedIds.includes(repliedUserId)) pingedIds.push(repliedUserId);

        for (const id of pingedIds) {
            const afk = afkUsers.get(id);
            if (afk) {
                const duration = Math.round((Date.now() - afk.timestamp) / 60000);
                let timeStr;
                if (duration < 60) timeStr = `${duration}m`;
                else timeStr = `${Math.floor(duration / 60)}h ${duration % 60}m`;
                await message.reply(`💤 **${afk.originalNickname}** is currently AFK: *${afk.reason}* (${timeStr} ago)`);
                break; // only notify once per message
            }
        }

        // !! prefix commands
        const msgContent = message.content.trim();

        if (msgContent === '!!testcard' && message.author.id === OWNER_DISCORD_ID) {
            const buffer = await generateTestCard();
            const attachment = new AttachmentBuilder(buffer, { name: 'card.png' });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Play')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://truebeast.io'),
            );
            const testCh = await client.channels.fetch('1486021237548257330');
            await testCh.send({
                content: '**Closest we can get to the MEE6 style** — the image layout is identical but the button must sit below (Discord limitation for non-Activity bots):',
                files: [attachment],
                components: [row],
            });
            await message.react('✅');
            return;
        }

        if (msgContent.toLowerCase().startsWith('!!afk')) {
            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
                await message.reply('❌ You need to be in a voice channel to go AFK!');
                return;
            }
            const reason = msgContent.slice(5).trim() || 'No reason given';
            const currentNick = message.member.displayName;
            const afkNick = `[AFK] ${currentNick}`.slice(0, 32);
            afkUsers.set(message.author.id, { reason, originalNickname: currentNick, timestamp: Date.now() });
            try { await message.member.setNickname(afkNick); } catch (_) {}
            await message.reply({ embeds: [{ color: 0x22c55e, description: `💤 **${currentNick}** is now AFK: *${reason}*\nI'll announce their return when they send a message.` }] });
            return;
        }

        // Track message count for milestones
        await checkMessageMilestone(message);
    }

    // ── Owner DMs — active answering session ─────────────────────────────────
    if (message.channel.type === ChannelType.DM && message.author.id === OWNER_DISCORD_ID) {
        const session = activeSession.get(message.channel.id);
        if (!session) return;

        if (session.state === 'awaiting_answer') {
            const raw = message.content.trim();
            if (['skip', 'cancel', 'drop'].includes(raw.toLowerCase())) {
                activeSession.delete(message.channel.id);
                await message.reply('👍 Dropped — moving on.');
                return;
            }
            const formatted = await reformatAnswer(session.question, raw);
            session.answer  = formatted;
            session.state   = 'awaiting_confirm';
            activeSession.set(message.channel.id, session);
            await message.reply(
                `Got it! Here's what I'll save:\n\n` +
                `**Q:** ${session.question}\n` +
                `**A:** ${formatted}\n\n` +
                `Reply **yes** to confirm or **no** to cancel.`
            );
            return;
        }

        if (session.state === 'awaiting_confirm') {
            const reply = message.content.trim().toLowerCase();
            if (['yes', 'yeah', 'y', 'yep', 'yup', 'confirm'].includes(reply)) {
                try {
                    await saveToKnowledgeBase(session.question, session.answer);
                    console.log(`[BeastBot] KB updated: "${session.question.slice(0, 60)}"`);

                    try {
                        const channel     = await client.channels.fetch(session.channelId);
                        const originalMsg = await channel.messages.fetch(session.messageId);
                        await originalMsg.reply(
                            `<@${session.askerId}> Kiernen got back to you! 👀\n\n` +
                            `**Question:** ${session.question}\n` +
                            `**Answer:** ${session.answer}`
                        );
                        console.log(`[BeastBot] Replied to original message for ${session.askerTag}`);
                    } catch (e) {
                        console.error('[BeastBot] Failed to reply to original message:', e.message);
                    }

                    await message.reply('✅ Saved! I\'ve replied to their message in the channel.');
                } catch (e) {
                    await message.reply(`❌ Failed to save: ${e.message}`);
                }
            } else {
                session.state = 'awaiting_answer';
                session.answer = undefined;
                activeSession.set(message.channel.id, session);
                await message.reply('👍 Cancelled — nothing was saved.\n\n_Go ahead — type your answer again below, or reply **skip** to drop this question._');
                return;
            }
            activeSession.delete(message.channel.id);
            return;
        }

        return;
    }

    // ── Support channel messages ──────────────────────────────────────────────
    if (!CHANNEL_IDS.includes(message.channelId)) return;

    const question = message.content.trim();
    if (!question) return;

    console.log(`[BeastBot] Message from ${message.author.tag}: ${question.slice(0, 80)}`);
    await message.channel.sendTyping();

    let result;
    try {
        const [knowledge, discordContext, steamContext] = await Promise.all([
            fetchKnowledge(),
            fetchDiscordContext(message.guild),
            fetchSteamGames(),
        ]);
        const history = getHistory(message.author.id);
        result = await askClaude(question, knowledge, discordContext, steamContext, history);
    } catch (e) {
        console.error('[BeastBot] Error:', e.message);
        result = { known: true, inappropriate: false, response: '⚠️ Something went wrong on my end. Please try again in a moment!' };
    }

    if (result.inappropriate) {
        await message.reply(result.response);
        await notifyMods(message);
        console.log(`[BeastBot] ⚠️  Mod alerted — inappropriate message from ${message.author.tag}`);
        return;
    }

    if (!result.known) {
        console.log(`[BeastBot] Unknown question from ${message.author.tag} — queuing for owner`);
        await saveUnansweredQuestion(question, message.author, message.channel.name, message.channelId, message.id);
    }

    const answer = result.response;
    const chunks = [];
    let remaining = answer;
    while (remaining.length > 1900) {
        const split = remaining.lastIndexOf('\n', 1900);
        const pos   = split > 0 ? split : 1900;
        chunks.push(remaining.slice(0, pos));
        remaining = remaining.slice(pos).trimStart();
    }
    chunks.push(remaining);

    for (const chunk of chunks) {
        await message.reply(chunk);
    }

    // Store this exchange so the next message has context
    appendHistory(message.author.id, question, answer);
});

client.on('error', (err) => console.error('[BeastBot] Client error:', err.message));

// Flush active voice sessions to Firestore before Fly.io kills the process
async function flushVoiceSessions() {
    const promises = [];
    for (const [uid] of voiceStartTimes) {
        const data = creditVoiceTime(uid);
        if (data) promises.push(saveVoiceMinutes(uid, { total: data.total, days: Object.fromEntries(data.days) }));
    }
    if (promises.length > 0) {
        await Promise.allSettled(promises);
        console.log(`[BeastBot] Flushed ${promises.length} active voice session(s) before shutdown`);
    }
}
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        console.log(`[BeastBot] Received ${sig} — flushing before exit`);
        await flushVoiceSessions();
        process.exit(0);
    });
}

// Flush all active voice sessions to Firestore before shutdown
async function flushVoiceOnExit() {
    if (voiceStartTimes.size === 0) return;
    console.log(`[BeastBot] 💾 Flushing ${voiceStartTimes.size} active voice session(s) before exit...`);
    const saves = [];
    for (const [uid] of voiceStartTimes) {
        const data = creditVoiceTime(uid);
        if (data) saves.push(saveVoiceMinutes(uid, { total: data.total, days: Object.fromEntries(data.days) }));
    }
    await Promise.allSettled(saves);
    console.log('[BeastBot] 💾 Voice flush complete');
}

process.on('SIGTERM', async () => {
    await flushVoiceOnExit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await flushVoiceOnExit();
    process.exit(0);
});

client.login(TOKEN);
