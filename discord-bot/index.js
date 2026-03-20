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
    Client, GatewayIntentBits, Partials, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    SlashCommandBuilder, REST, Routes,
} = require('discord.js');

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

const BUMP_CHANNEL_ID    = '1477361149862482053';
const LOG_CHANNEL_ID     = '1339916490744397896';
const INTRO_CHANNEL_ID   = process.env.INTRO_CHANNEL_ID || '';
const GIVEAWAY_CHANNEL_ID  = '836728871356989491';
const REDDIT_CLIENT_ID     = process.env.REDDIT_CLIENT_ID     || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const BUMP_INTERVAL      = 2 * 60 * 60 * 1000; // 2 hours
const DISCADIA_INTERVAL  = 24 * 60 * 60 * 1000; // 24 hours
const DISBOARD_BOT_ID    = '302050872383242240';
const DISCADIA_BOT_ID    = '1222548162741538938';
let bumpTimer     = null;
let discadiaTimer = null;

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
// userId → message count (in-memory, resets on restart — persistent version could use Firestore)
const messageCounts = new Map();
const MILESTONE_THRESHOLDS = [100, 500, 1000, 2500, 5000, 10000];
const MILESTONE_EMOJIS     = ['💯', '🔥', '🏆', '⭐', '💎', '👑'];

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
    db.collection('botTimers').doc('discadia').set({ fireAt, updatedAt: new Date().toISOString() }).catch(() => {});
    discadiaTimer = setTimeout(postDiscadiaReminder, delayMs);
    console.log(`[BeastBot] Discadia bump reminder scheduled for ${new Date(fireAt).toUTCString()}`);
}

function scheduleBumpReminder() {
    if (bumpTimer) clearTimeout(bumpTimer);
    const fireAt = Date.now() + BUMP_INTERVAL;
    // Persist so it survives restarts
    db.collection('botTimers').doc('disboard').set({ fireAt, updatedAt: new Date().toISOString() }).catch(() => {});
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

async function checkMessageMilestone(message) {
    const userId = message.author.id;
    const count  = (messageCounts.get(userId) || 0) + 1;
    messageCounts.set(userId, count);

    // Save every 10 messages to avoid hammering Firestore
    if (count % 10 === 0) saveMessageCount(userId, count);

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
const GIVEAWAY_SUBREDDITS = 'giveaways+GameGiveaways+FreeGamesOnSteam';
const GIVEAWAY_WINDOW_MS  = 12 * 60 * 60 * 1000; // 12 hours

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

let redditToken = null;
let redditTokenExpiry = 0;

async function getRedditToken() {
    if (redditToken && Date.now() < redditTokenExpiry) return redditToken;
    const creds = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${creds}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'TrueBeastBot/1.0',
        },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
    const data = await res.json();
    redditToken = data.access_token;
    redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 1min early
    return redditToken;
}

function extractGleamLink(post) {
    if (post.url?.includes('gleam.io')) return post.url;
    const match = (post.selftext || '').match(/https?:\/\/gleam\.io\/\S+/);
    return match ? match[0] : post.url;
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

client.once('ready', async () => {
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
                messageCounts.set(uid, parseInt(f.count?.integerValue || '0', 10));
            });
            nextPageToken = data.nextPageToken || null;
        } while (nextPageToken);
        console.log(`[BeastBot] Loaded ${messageCounts.size} message counts from Firestore`);
    } catch (_) {}

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
        const disboardSnap = await db.collection('botTimers').doc('disboard').get();
        const discadiaSnap = await db.collection('botTimers').doc('discadia').get();
        const now = Date.now();

        if (disboardSnap.exists && disboardSnap.data().fireAt > now) {
            const delay = disboardSnap.data().fireAt - now;
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

        if (discadiaSnap.exists && discadiaSnap.data().fireAt > now) {
            const delay = discadiaSnap.data().fireAt - now;
            console.log(`[BeastBot] Restoring Discadia timer — fires in ${Math.round(delay / 60000)}m`);
            scheduleDiscadiaReminder(delay);
        } else {
            scheduleDiscadiaReminder(10 * 60 * 60 * 1000);
        }
    } catch (e) {
        console.error('[BeastBot] Failed to restore timers:', e.message);
        scheduleDiscadiaReminder(10 * 60 * 60 * 1000);
    }

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
            const sorted = [...messageCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            if (sorted.length === 0) {
                await interaction.reply({ content: 'No message data yet!', ephemeral: true });
                return;
            }
            const medals = ['🥇', '🥈', '🥉'];
            // Filter to current server members only
            const guild = interaction.guild;
            const validEntries = [];
            for (const [userId, count] of sorted) {
                try {
                    const member = await guild.members.fetch(userId);
                    validEntries.push({ member, count });
                } catch {
                    // User left the server — skip
                }
                if (validEntries.length >= 10) break;
            }
            const lines = validEntries.map(({ member, count }, i) => {
                const prefix = medals[i] || `**${i + 1}.**`;
                return `${prefix} **${member.displayName}** — ${count.toLocaleString()} messages`;
            });
            await interaction.reply({
                embeds: [{
                    color: 0x22c55e,
                    title: '🏆 Message Leaderboard — Top 10',
                    description: lines.join('\n'),
                    footer: { text: `${messageCounts.size} members tracked` },
                    timestamp: new Date().toISOString(),
                }],
            });
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

        // Set AFK
        if (message.content.toLowerCase().startsWith('!!afk')) {
            const member = message.member;
            const voiceChannel = member?.voice?.channel;
            if (!voiceChannel) {
                await message.reply('You need to be in a voice channel to go AFK!');
                return;
            }
            const reason = message.content.slice(5).trim() || 'No reason given';
            const currentNick = member.displayName;
            const afkNick = `[AFK] ${currentNick}`.slice(0, 32); // Discord 32 char limit
            afkUsers.set(message.author.id, {
                reason,
                originalNickname: currentNick,
                timestamp: Date.now(),
            });
            try {
                await member.setNickname(afkNick);
            } catch (e) {
                console.error('[BeastBot] Failed to set AFK nickname:', e.message);
            }
            await message.reply(`✅ You're now AFK: *${reason}*\nI'll announce your return in the voice chat when you type a message.`);
            console.log(`[BeastBot] AFK set for ${message.author.tag}: ${reason}`);
            return;
        }

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

        // !!postintro — post the persistent intro button message (owner only, pin it after)
        if (message.content.toLowerCase() === '!!postintro' && message.author.id === OWNER_DISCORD_ID) {
            try {
                const ch = await client.channels.fetch(INTRO_CHANNEL_ID);
                await ch.send({
                    embeds: [{
                        color: 0x5865f2,
                        title: '👋 Introduce Yourself!',
                        description:
                            'New to the server? Let the community get to know you!\n\n' +
                            'Click the button below to fill in a quick intro — it only takes a minute and gets posted right here.',
                        footer: { text: 'You can only submit once — make it count! 😄' },
                    }],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('intro:start')
                                .setLabel('📝 Introduce yourself')
                                .setStyle(ButtonStyle.Primary),
                        ),
                    ],
                });
                await message.reply('✅ Done! Pin that message so it stays at the top.');
            } catch (e) {
                await message.reply(`❌ Failed: ${e.message}`);
            }
            return;
        }

        // !!checkgiveaways — manual giveaway pull from SweepsDB (owner only)
        if (message.content.toLowerCase() === '!!checkgiveaways' && message.author.id === OWNER_DISCORD_ID) {
            await message.reply('🔍 Fetching Gleam giveaways from SweepsDB...');
            try {
                const giveaways = await fetchGleamGiveaways();
                await message.reply(`📊 Found **${giveaways.length}** new Gleam giveaway(s)`);
                if (giveaways.length === 0) return;
                await checkAndPostGiveaways();
                await message.reply('✅ Posted to the giveaways channel!');
            } catch (e) {
                await message.reply(`❌ Error: ${e.message}`);
            }
            return;
        }

        // !!spotlight — owner test command
        if (message.content.toLowerCase() === '!!spotlight' && message.author.id === OWNER_DISCORD_ID) {
            await message.reply('🌟 Triggering spotlight...');
            await postMemberSpotlight();
            return;
        }

        // !!backfill — crawl channel history to count all past messages (owner only, one-time)
        if (message.content.toLowerCase() === '!!backfill' && message.author.id === OWNER_DISCORD_ID) {
            await message.reply('📊 Starting message backfill — this will take a while. I\'ll update you as I go.');
            const guild = message.guild;
            const textChannels = guild.channels.cache.filter(c =>
                c.isTextBased() && !c.isThread() && c.type !== ChannelType.DM
            );
            const counts = new Map();
            let totalMessages = 0;
            let channelsDone = 0;

            for (const [, channel] of textChannels) {
                try {
                    let lastId = null;
                    let channelCount = 0;
                    while (true) {
                        const opts = { limit: 100 };
                        if (lastId) opts.before = lastId;
                        const batch = await channel.messages.fetch(opts);
                        if (batch.size === 0) break;
                        batch.forEach(m => {
                            if (!m.author.bot) {
                                counts.set(m.author.id, (counts.get(m.author.id) || 0) + 1);
                                totalMessages++;
                                channelCount++;
                            }
                        });
                        lastId = batch.last().id;
                        if (batch.size < 100) break;
                    }
                    channelsDone++;
                    if (channelsDone % 5 === 0) {
                        await message.channel.send(`📊 Progress: ${channelsDone}/${textChannels.size} channels scanned, ${totalMessages.toLocaleString()} messages counted so far...`);
                    }
                } catch (e) {
                    console.error(`[BeastBot] Backfill: couldn't read #${channel.name}: ${e.message}`);
                }
            }

            // Merge with existing counts (take the higher value)
            for (const [userId, count] of counts) {
                const existing = messageCounts.get(userId) || 0;
                const merged = Math.max(existing, count);
                messageCounts.set(userId, merged);
                await saveMessageCount(userId, merged);
            }

            await message.channel.send(
                `✅ **Backfill complete!**\n` +
                `- Scanned **${textChannels.size}** channels\n` +
                `- Counted **${totalMessages.toLocaleString()}** messages\n` +
                `- From **${counts.size}** unique members\n\n` +
                `Milestones will now be based on these totals.`
            );
            console.log(`[BeastBot] Backfill done: ${totalMessages} messages from ${counts.size} users across ${textChannels.size} channels`);
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

client.login(TOKEN);
