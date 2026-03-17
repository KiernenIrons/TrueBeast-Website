/**
 * TrueBeast — Beast Bot (AI Support + Daily Tasks)
 * =================================================
 * Monitors a dedicated support channel and answers questions using
 * Claude Haiku + a Firestore knowledge base + live Discord/Steam context.
 * Also runs a daily tasks system with streak tracking and giveaway entries.
 *
 * Env vars:
 *   DISCORD_BOT_TOKEN         — bot token from Discord Developer Portal
 *   SUPPORT_CHANNEL_ID        — channel ID(s) to monitor, comma-separated
 *   MOD_CHANNEL_ID            — channel ID for mod notifications
 *   MOD_ROLE_ID               — role ID to ping for mod notifications
 *   ANTHROPIC_API_KEY         — Claude API key
 *   FIREBASE_PROJECT_ID       — e.g. "truebeast-support"
 *   FIREBASE_API_KEY          — public web API key from Firebase
 *   STEAM_API_KEY             — Steam Web API key
 *   STEAM_ID                  — Steam 64-bit ID
 *   DAILY_TASKS_CHANNEL_ID    — #daily-tasks channel
 *   GENERAL_CHANNEL_ID        — #general (auto-task: say hi)
 *   GAMING_CHANNEL_ID         — #gaming (auto-task: post there)
 *   ANNOUNCEMENTS_CHANNEL_ID  — #announcements (auto-task: react there)
 *   EVENTS_CHANNEL_ID         — #events (also counts for the react task)
 */

require('dotenv').config();
const cron = require('node-cron');

const {
    Client, GatewayIntentBits, Partials, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

// ── Env vars ───────────────────────────────────────────────────────────────────

const TOKEN                   = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_IDS             = (process.env.SUPPORT_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const MOD_CHANNEL_ID          = process.env.MOD_CHANNEL_ID;
const MOD_ROLE_ID             = process.env.MOD_ROLE_ID;
const ANTHROPIC_API_KEY       = process.env.ANTHROPIC_API_KEY;
const FIREBASE_PROJECT        = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY        = process.env.FIREBASE_API_KEY;
const STEAM_API_KEY           = process.env.STEAM_API_KEY;
const STEAM_ID                = process.env.STEAM_ID || '76561198254213878';
const OWNER_DISCORD_ID        = '392450364340830208';

const DAILY_TASKS_CHANNEL_ID  = process.env.DAILY_TASKS_CHANNEL_ID;
const GENERAL_CHANNEL_ID      = process.env.GENERAL_CHANNEL_ID;
const GAMING_CHANNEL_ID       = process.env.GAMING_CHANNEL_ID;
const ANNOUNCEMENTS_CHANNEL_ID = process.env.ANNOUNCEMENTS_CHANNEL_ID;
const EVENTS_CHANNEL_ID        = process.env.EVENTS_CHANNEL_ID;

if (!TOKEN || !ANTHROPIC_API_KEY || !FIREBASE_PROJECT || !FIREBASE_API_KEY || CHANNEL_IDS.length === 0) {
    console.error('[BeastBot] ❌  Missing required env vars.');
    process.exit(1);
}

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// ── Task definitions ───────────────────────────────────────────────────────────

// The 4 standard tasks that count toward streak + all-complete bonus
const STANDARD_TASK_IDS = ['say_hi', 'post_gaming', 'react_ann', 'wildcard'];

const TASKS = [
    { id: 'say_hi',      emoji: '💬', title: 'Say hi in #general',      type: 'auto_message',  channelEnvKey: 'GENERAL_CHANNEL_ID'        },
    { id: 'post_gaming', emoji: '🎮', title: 'Post in #gaming',         type: 'auto_message',  channelEnvKey: 'GAMING_CHANNEL_ID'         },
    { id: 'react_ann',   emoji: '👍', title: 'React in #announcements', type: 'auto_reaction', channelEnvKey: 'ANNOUNCEMENTS_CHANNEL_ID'  },
    { id: 'wildcard',    emoji: '🎲', title: '',                        type: 'manual'                                                    },
    { id: 'game_night',  emoji: '🎮', title: 'Show up to Game Night',   type: 'auto_event',    days: [5]                                  },
    { id: 'movie_night', emoji: '🎬', title: 'Show up to Movie Night',  type: 'auto_event',    days: [6]                                  },
];

const WILDCARD_POOL = [
    'Share a game screenshot in #gaming',
    'Recommend a game in #gaming',
    'Welcome a new member in #general',
    'Share something that made you laugh today',
    'Tell us what you\'re playing this week',
    'Drop a fun fact in #general',
    'Share a game you\'ve been enjoying lately in #gaming',
    'Give someone a compliment in #general',
];

// ── In-memory state ────────────────────────────────────────────────────────────

// Owner DM flow for answering support questions
const questionQueue = new Map(); // questionId -> { question, askerId, askerTag, channelId, messageId }
const activeSession = new Map(); // dmChannelId -> session object

// Invite tracking
const inviteCache = new Map(); // invite code -> uses count

// Stored ID of the current daily tasks message (refreshed at midnight)
let dailyTasksMessageId = null;

function makeQuestionId() {
    return `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getTodayStr() {
    return new Date().toISOString().slice(0, 10);
}

function getYesterdayStr() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function getMonthStr() {
    return new Date().toISOString().slice(0, 7);
}

function getDayOfYear() {
    const now   = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return Math.floor((now - start) / 86400000);
}

function getWildcardTitle() {
    return WILDCARD_POOL[getDayOfYear() % WILDCARD_POOL.length];
}

// Returns the display streak, accounting for broken streaks
function getEffectiveStreak(streak) {
    if (!streak?.lastCompleteDate) return 0;
    const today     = getTodayStr();
    const yesterday = getYesterdayStr();
    return (streak.lastCompleteDate === today || streak.lastCompleteDate === yesterday)
        ? (streak.currentStreak || 0)
        : 0;
}

// ── Generic Firestore REST helpers ─────────────────────────────────────────────

function parseFirestoreDoc(fields) {
    const result = {};
    for (const [key, val] of Object.entries(fields)) {
        if      (val.stringValue  !== undefined) result[key] = val.stringValue;
        else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue, 10);
        else if (val.doubleValue  !== undefined) result[key] = val.doubleValue;
        else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
        else if (val.nullValue    !== undefined) result[key] = null;
        else if (val.mapValue)                   result[key] = parseFirestoreDoc(val.mapValue.fields || {});
        else                                     result[key] = null;
    }
    return result;
}

function toFirestoreFields(obj) {
    const fields = {};
    for (const [key, val] of Object.entries(obj)) {
        if      (typeof val === 'string')                          fields[key] = { stringValue: val };
        else if (typeof val === 'number' && Number.isInteger(val)) fields[key] = { integerValue: String(val) };
        else if (typeof val === 'number')                          fields[key] = { doubleValue: val };
        else if (typeof val === 'boolean')                         fields[key] = { booleanValue: val };
        else if (val === null || val === undefined)                 fields[key] = { nullValue: null };
        else if (typeof val === 'object')                          fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
    return fields;
}

async function fsGet(collection, docId) {
    const url = `${FS_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET ${collection}/${docId}: ${res.status}`);
    const data = await res.json();
    return parseFirestoreDoc(data.fields || {});
}

async function fsPatch(collection, docId, plainObj) {
    const url = `${FS_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFirestoreFields(plainObj) }),
    });
    if (!res.ok) throw new Error(`Firestore PATCH ${collection}/${docId}: ${res.status} ${await res.text()}`);
}

// ── Firestore — knowledge base (existing) ─────────────────────────────────────

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

// ── Discord live context ───────────────────────────────────────────────────────

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

async function askClaude(question, knowledge, discordContext, steamContext) {
    const contextParts = [];
    if (knowledge)      contextParts.push(`## Knowledge Base\n${knowledge}`);
    if (discordContext) contextParts.push(`## Live Discord Context\n${discordContext}`);
    if (steamContext)   contextParts.push(`## Live Steam Context\n${steamContext}`);

    const context = contextParts.length
        ? `${contextParts.join('\n\n')}\n\n---\n\nUser message: ${question}`
        : `User message: ${question}`;

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

// ── Daily tasks — Firestore ops ────────────────────────────────────────────────

async function getCompletion(userId, dateStr) {
    const data = await fsGet('taskCompletions', `${userId}_${dateStr}`).catch(() => null);
    return data || { completedTasks: {}, allComplete: false, bonusAwarded: false };
}

async function getStreak(userId) {
    const data = await fsGet('userStreaks', userId).catch(() => null);
    return data || { currentStreak: 0, longestStreak: 0, lastCompleteDate: null };
}

async function addEntries(userId, username, amount) {
    const monthStr = getMonthStr();
    const docId    = `${monthStr}_${userId}`;
    const existing = await fsGet('giveawayEntries', docId).catch(() => null)
        || { entries: 0, month: monthStr, userId, username };
    existing.entries  = (existing.entries || 0) + amount;
    existing.username = username;
    await fsPatch('giveawayEntries', docId, existing);
}

async function getMonthlyEntries(userId) {
    const data = await fsGet('giveawayEntries', `${getMonthStr()}_${userId}`).catch(() => null);
    return data?.entries || 0;
}

async function getMonthlyLeaderboard(limit = 3) {
    const monthStr = getMonthStr();
    const url      = `${FS_BASE}/giveawayEntries?key=${FIREBASE_API_KEY}&pageSize=500`;
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        if (!data.documents?.length) return [];
        return data.documents
            .filter(doc => doc.name.split('/').pop().startsWith(monthStr + '_'))
            .map(doc => {
                const parsed = parseFirestoreDoc(doc.fields || {});
                return { userId: parsed.userId || '', username: parsed.username || 'Unknown', entries: parsed.entries || 0 };
            })
            .filter(e => e.userId)
            .sort((a, b) => b.entries - a.entries)
            .slice(0, limit);
    } catch (e) {
        console.error('[BeastBot] Leaderboard fetch failed:', e.message);
        return [];
    }
}

async function handleStreakMilestone(userId, username, member, currentStreak) {
    // Nickname badge (3+ days)
    if (member) {
        try {
            const base    = (member.nickname || member.user.username).replace(/\s*\[🔥\d+\]$/, '').trimEnd();
            const newNick = currentStreak >= 3 ? `${base} [🔥${currentStreak}]` : base;
            const current = member.nickname || member.user.username;
            if (newNick !== current) await member.setNickname(newNick || null);
        } catch (e) {
            if (e.code === 50013) console.warn(`[BeastBot] Cannot set nickname for ${userId} (server owner)`);
            else console.error('[BeastBot] Nickname update failed:', e.message);
        }
    }

    // 30-day announcement
    if (currentStreak === 30 && GENERAL_CHANNEL_ID) {
        try {
            const ch = await client.channels.fetch(GENERAL_CHANNEL_ID);
            await ch.send(
                `🔥 **30-DAY STREAK ALERT!** 🔥\n` +
                `<@${userId}> has completed daily tasks for **30 days in a row!** Absolutely unhinged. Big respect. 🏆\n` +
                `+5 bonus giveaway entries awarded! 🎁`
            );
            await addEntries(userId, username, 5);
        } catch (e) {
            console.error('[BeastBot] 30-day announcement failed:', e.message);
        }
    }
}

async function updateStreak(userId, username, member, completedDate) {
    const streak    = await getStreak(userId);
    const yesterday = getYesterdayStr();

    if (streak.lastCompleteDate === completedDate) return streak; // Already counted today

    const prevStreak = streak.currentStreak || 0;

    if (!streak.lastCompleteDate || streak.lastCompleteDate === yesterday) {
        streak.currentStreak = prevStreak + 1;
    } else {
        streak.currentStreak = 1; // missed a day — reset
    }

    streak.longestStreak    = Math.max(streak.longestStreak || 0, streak.currentStreak);
    streak.lastCompleteDate = completedDate;

    // +2 bonus entries per day at 7+ streak
    if (streak.currentStreak >= 7) {
        await addEntries(userId, username, 2);
    }

    await fsPatch('userStreaks', userId, streak);
    await handleStreakMilestone(userId, username, member, streak.currentStreak);

    return streak;
}

// Mark a task complete for a user today. Returns { alreadyDone, allComplete, entriesAdded }
async function markTask(userId, taskId, username, member) {
    const dateStr    = getTodayStr();
    const docId      = `${userId}_${dateStr}`;
    const completion = await getCompletion(userId, dateStr);

    if (completion.completedTasks[taskId]) {
        return { alreadyDone: true, allComplete: completion.allComplete, entriesAdded: 0 };
    }

    completion.completedTasks[taskId] = true;
    let entriesAdded = 1;
    await addEntries(userId, username, 1);

    // Check if all 4 standard tasks are done → trigger all-complete bonus + streak
    const allStandardDone = STANDARD_TASK_IDS.every(id => completion.completedTasks[id]);
    if (allStandardDone && !completion.allComplete) {
        completion.allComplete = true;
        if (!completion.bonusAwarded) {
            completion.bonusAwarded = true;
            await addEntries(userId, username, 1); // +1 bonus
            entriesAdded++;
        }
        await updateStreak(userId, username, member, dateStr);
    }

    await fsPatch('taskCompletions', docId, completion);
    return { alreadyDone: false, allComplete: completion.allComplete, entriesAdded };
}

// ── Daily tasks — channel posting ─────────────────────────────────────────────

async function loadDailyTasksMsgId() {
    try {
        const data = await fsGet('botConfig', 'dailyTasksMsg');
        return data?.msgId || null;
    } catch (_) {
        return null;
    }
}

async function saveDailyTasksMsgId(msgId) {
    await fsPatch('botConfig', 'dailyTasksMsg', { msgId, date: getTodayStr() }).catch(() => {});
}

async function postDailyTasks() {
    if (!DAILY_TASKS_CHANNEL_ID) {
        console.warn('[BeastBot] DAILY_TASKS_CHANNEL_ID not set — skipping daily tasks post');
        return;
    }
    try {
        const channel = await client.channels.fetch(DAILY_TASKS_CHANNEL_ID);

        // Delete previous daily message
        const prevId = dailyTasksMessageId || await loadDailyTasksMsgId();
        if (prevId) {
            try { const prev = await channel.messages.fetch(prevId); await prev.delete(); } catch (_) {}
            dailyTasksMessageId = null;
        }

        const now      = new Date();
        const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        const todayDow = now.getUTCDay();
        const wildcard = getWildcardTitle();

        const top3        = await getMonthlyLeaderboard(3);
        const leaderLines = top3.length
            ? top3.map((e, i) => `  ${['🥇','🥈','🥉'][i]} <@${e.userId}> — ${e.entries} entries`).join('\n')
            : '  No entries yet this month.';

        const genMention = GENERAL_CHANNEL_ID       ? `<#${GENERAL_CHANNEL_ID}>`       : '#general';
        const gamMention = GAMING_CHANNEL_ID         ? `<#${GAMING_CHANNEL_ID}>`         : '#gaming';
        const annMention = [
            ANNOUNCEMENTS_CHANNEL_ID ? `<#${ANNOUNCEMENTS_CHANNEL_ID}>` : null,
            EVENTS_CHANNEL_ID        ? `<#${EVENTS_CHANNEL_ID}>`        : null,
        ].filter(Boolean).join(' or ') || '#announcements';

        const lines = [
            `━━━━━━━━━━━━━━━━━━━━━━`,
            `📋  **DAILY TASKS**  •  ${dayLabel}`,
            `━━━━━━━━━━━━━━━━━━━━━━`,
            `Complete all 4 tasks for a bonus entry 🎁`,
            ``,
            `💬  Say hi in ${genMention}  *(auto-counts when you post)*`,
            `🎮  Post in ${gamMention}  *(auto-counts when you post)*`,
            `👍  React in ${annMention}  *(auto-counts when you react)*`,
            `🎲  **Daily challenge:** ${wildcard}`,
        ];

        if (todayDow === 5) {
            lines.push(``, `🎮  **Bonus:** Show up to Game Night tonight at 7pm  *(auto-counts when you join VC)*`);
        } else if (todayDow === 6) {
            lines.push(``, `🎬  **Bonus:** Show up to Movie Night tonight at 7pm  *(auto-counts when you join VC)*`);
        }

        lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);
        lines.push(`🏆  **Top this month (so far):**`);
        lines.push(leaderLines);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('daily:challenge_done')
                .setLabel('✅ Mark Challenge Done')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('daily:my_progress')
                .setLabel('📊 My Progress')
                .setStyle(ButtonStyle.Secondary),
        );

        const msg = await channel.send({ content: lines.join('\n'), components: [row] });
        dailyTasksMessageId = msg.id;
        await saveDailyTasksMsgId(msg.id);
        console.log(`[BeastBot] ✅ Daily tasks posted for ${dayLabel}`);
    } catch (e) {
        console.error('[BeastBot] postDailyTasks failed:', e.message);
    }
}

async function postWeeklyLeaderboard() {
    if (!DAILY_TASKS_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(DAILY_TASKS_CHANNEL_ID);
        const top10   = await getMonthlyLeaderboard(10);
        if (!top10.length) return;
        const lines = [
            `━━━━━━━━━━━━━━━━━━━━━━`,
            `🏆  **WEEKLY GIVEAWAY LEADERBOARD**`,
            `━━━━━━━━━━━━━━━━━━━━━━`,
            ...top10.map((e, i) => `${i + 1}. <@${e.userId}> — **${e.entries}** entries`),
            ``,
            `Keep completing daily tasks to climb! 🎁`,
        ];
        await channel.send(lines.join('\n'));
    } catch (e) {
        console.error('[BeastBot] postWeeklyLeaderboard failed:', e.message);
    }
}

// ── Discord client ─────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
    ],
});

// ── Bump reminder ─────────────────────────────────────────────────────────────

const BUMP_CHANNEL_ID = '1477361149862482053';
const BUMP_INTERVAL   = 2 * 60 * 60 * 1000; // 2 hours
const DISBOARD_BOT_ID = '302050872383242240';
let bumpTimer = null;

function scheduleBumpReminder() {
    if (bumpTimer) clearTimeout(bumpTimer);
    bumpTimer = setTimeout(async () => {
        try {
            const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
            await channel.send('⏰ Time to bump! Run `/bump` to keep the server visible on Disboard.');
            console.log('[BeastBot] 🔔 Sent bump reminder');
        } catch (e) {
            console.error('[BeastBot] Failed to send bump reminder:', e.message);
        }
    }, BUMP_INTERVAL);
    console.log(`[BeastBot] Bump reminder scheduled for ${new Date(Date.now() + BUMP_INTERVAL).toLocaleTimeString()}`);
}

// ── Invite cache helper ────────────────────────────────────────────────────────

async function cacheInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        invites.forEach(inv => inviteCache.set(inv.code, inv.uses || 0));
        console.log(`[BeastBot] Cached ${invites.size} invites for ${guild.name}`);
    } catch (e) {
        console.error('[BeastBot] Failed to cache invites:', e.message);
    }
}

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
    console.log(`[BeastBot] ✅  Logged in as ${client.user.tag}`);
    console.log(`[BeastBot] Monitoring channel(s): ${CHANNEL_IDS.join(', ')}`);
    console.log(`[BeastBot] Steam: ${STEAM_API_KEY ? 'enabled' : 'no API key yet'}`);
    console.log(`[BeastBot] Daily tasks: ${DAILY_TASKS_CHANNEL_ID ? 'enabled' : 'DAILY_TASKS_CHANNEL_ID not set'}`);

    // Cache invites for all guilds
    for (const guild of client.guilds.cache.values()) {
        await cacheInvites(guild);
    }

    // Restore stored daily tasks message ID
    dailyTasksMessageId = await loadDailyTasksMsgId();

    // Cron: midnight UTC — post new daily tasks
    cron.schedule('0 0 * * *', postDailyTasks);

    // Cron: Sunday midnight UTC — weekly leaderboard
    cron.schedule('0 0 * * 0', postWeeklyLeaderboard);

    console.log('[BeastBot] Cron jobs scheduled (midnight UTC daily + Sunday leaderboard)');

    scheduleBumpReminder();
});

// ── Daily task button interactions ─────────────────────────────────────────────

async function handleDailyInteraction(interaction) {
    const userId   = interaction.user.id;
    const member   = interaction.member;
    const username = interaction.user.username;

    if (interaction.customId === 'daily:challenge_done') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await markTask(userId, 'wildcard', username, member);
            if (result.alreadyDone) {
                await interaction.editReply('✅ You already completed the daily challenge today!');
                return;
            }
            let msg = `✅ **Daily challenge marked complete!** +${result.entriesAdded} giveaway entr${result.entriesAdded === 1 ? 'y' : 'ies'} earned.`;
            if (result.allComplete) msg += `\n🎉 **All tasks done!** Streak updated and bonus entry added!`;
            await interaction.editReply(msg);
        } catch (e) {
            console.error('[BeastBot] challenge_done error:', e.message);
            await interaction.editReply('⚠️ Something went wrong. Try again in a moment.');
        }
        return;
    }

    if (interaction.customId === 'daily:my_progress') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const dateStr = getTodayStr();
            const [completion, streak, entries] = await Promise.all([
                getCompletion(userId, dateStr),
                getStreak(userId),
                getMonthlyEntries(userId),
            ]);

            const now       = new Date();
            const dateLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
            const wildcard  = getWildcardTitle();
            const todayDow  = now.getUTCDay();

            const genMention = GENERAL_CHANNEL_ID       ? `<#${GENERAL_CHANNEL_ID}>`       : '#general';
            const gamMention = GAMING_CHANNEL_ID         ? `<#${GAMING_CHANNEL_ID}>`         : '#gaming';
            const annMention = [
                ANNOUNCEMENTS_CHANNEL_ID ? `<#${ANNOUNCEMENTS_CHANNEL_ID}>` : null,
                EVENTS_CHANNEL_ID        ? `<#${EVENTS_CHANNEL_ID}>`        : null,
            ].filter(Boolean).join(' or ') || '#announcements';

            const tasks = [
                { id: 'say_hi',      label: `Say hi in ${genMention}` },
                { id: 'post_gaming', label: `Post in ${gamMention}` },
                { id: 'react_ann',   label: `React in ${annMention}` },
                { id: 'wildcard',    label: `Daily challenge: ${wildcard}` },
            ];

            if (todayDow === 5) tasks.push({ id: 'game_night',  label: 'Show up to Game Night' });
            if (todayDow === 6) tasks.push({ id: 'movie_night', label: 'Show up to Movie Night' });

            const taskLines    = tasks.map(t => `${completion.completedTasks[t.id] ? '✅' : '☐'}  ${t.label}`).join('\n');
            const standardDone = STANDARD_TASK_IDS.filter(id => completion.completedTasks[id]).length;
            const effectStreak = getEffectiveStreak(streak);
            const streakText   = effectStreak > 0 ? `🔥 ${effectStreak}-day streak` : 'No active streak';

            const lines = [
                `📊  **Your Daily Tasks**  •  ${dateLabel}`,
                ``,
                taskLines,
                ``,
                `**${standardDone}/4 complete**  •  ${streakText}`,
                `This month: **${entries}** entr${entries === 1 ? 'y' : 'ies'}`,
            ];

            if (effectStreak < 7) {
                lines.push(``, `_Streak bonus unlocks at day 7: +2 entries/day 🔥_`);
            }

            await interaction.editReply(lines.join('\n'));
        } catch (e) {
            console.error('[BeastBot] my_progress error:', e.message);
            await interaction.editReply('⚠️ Something went wrong. Try again in a moment.');
        }
        return;
    }
}

// ── Button interactions ────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // Daily task buttons — available to all users
    if (interaction.customId.startsWith('daily:')) {
        await handleDailyInteraction(interaction);
        return;
    }

    // Owner-only buttons (answer/skip for support questions)
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

    if (message.author.bot) return;

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
                session.state  = 'awaiting_answer';
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

    // ── Owner command: !posttasks ─────────────────────────────────────────────
    if (message.author.id === OWNER_DISCORD_ID && message.content.trim().toLowerCase() === '!posttasks') {
        await message.reply('Posting daily tasks now...');
        await postDailyTasks();
        return;
    }

    // ── Owner command: !giveaway list ──────────────────────────────────────────
    if (message.author.id === OWNER_DISCORD_ID && message.content.trim().toLowerCase() === '!giveaway list') {
        try {
            const top20 = await getMonthlyLeaderboard(20);
            if (!top20.length) {
                await message.reply('No entries yet this month.');
            } else {
                const lines = top20.map((e, i) => `${i + 1}. **${e.username}** (<@${e.userId}>) — ${e.entries} entries`);
                await message.reply(`**Giveaway Entries — ${getMonthStr()}**\n${lines.join('\n')}`);
            }
        } catch (e) {
            await message.reply(`❌ Failed to fetch entries: ${e.message}`);
        }
        return;
    }

    // ── Auto-tasks: detect messages in #general and #gaming ───────────────────
    if (GENERAL_CHANNEL_ID && message.channelId === GENERAL_CHANNEL_ID) {
        markTask(message.author.id, 'say_hi', message.author.username, message.member)
            .then(result => {
                if (!result.alreadyDone) {
                    console.log(`[BeastBot] ✅ say_hi completed by ${message.author.tag}`);
                    message.react('✅').catch(() => {});
                }
            })
            .catch(e => console.error('[BeastBot] markTask say_hi failed:', e.message));
    }

    if (GAMING_CHANNEL_ID && message.channelId === GAMING_CHANNEL_ID) {
        markTask(message.author.id, 'post_gaming', message.author.username, message.member)
            .then(result => {
                if (!result.alreadyDone) {
                    console.log(`[BeastBot] ✅ post_gaming completed by ${message.author.tag}`);
                    message.react('✅').catch(() => {});
                }
            })
            .catch(e => console.error('[BeastBot] markTask post_gaming failed:', e.message));
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
        result = await askClaude(question, knowledge, discordContext, steamContext);
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
});

// ── Reactions — auto-task: react in #announcements ────────────────────────────

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Fetch partial reactions/messages if needed
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (e) { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch (e) { return; }
    }

    const reactChannels = [ANNOUNCEMENTS_CHANNEL_ID, EVENTS_CHANNEL_ID].filter(Boolean);
    if (!reactChannels.includes(reaction.message.channelId)) return;

    const guild  = reaction.message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id).catch(() => null);

    markTask(user.id, 'react_ann', user.username, member)
        .then(result => {
            if (!result.alreadyDone) {
                console.log(`[BeastBot] ✅ react_ann completed by ${user.tag}`);
            }
        })
        .catch(e => console.error('[BeastBot] markTask react_ann failed:', e.message));
});

// ── Voice state — auto-task: join VC during game/movie night ─────────────────

client.on('voiceStateUpdate', async (oldState, newState) => {
    // Only care about joining a VC (not leaving or switching)
    if (!newState.channelId || newState.channelId === oldState.channelId) return;
    if (newState.member?.user.bot) return;

    const todayDow = new Date().getUTCDay();
    if (todayDow !== 5 && todayDow !== 6) return; // Only Friday/Saturday

    const taskId    = todayDow === 5 ? 'game_night' : 'movie_night';
    const eventName = todayDow === 5 ? 'Game Night' : 'Movie Night';
    const keyword   = todayDow === 5 ? 'game night' : 'movie night';

    try {
        const guild  = newState.guild;
        const events = await guild.scheduledEvents.fetch();
        const now    = new Date();

        const relevant = [...events.values()].find(e => {
            const nameMatch     = e.name.toLowerCase().includes(keyword);
            const isActive      = e.status === 2; // GuildScheduledEventStatus.Active
            const recentlyEnded = e.status === 3 && e.scheduledEndAt && (now - e.scheduledEndAt) < 3600000;
            return nameMatch && (isActive || recentlyEnded);
        });

        if (!relevant) return;

        const member = newState.member;
        const result = await markTask(member.user.id, taskId, member.user.username, member);

        if (!result.alreadyDone) {
            console.log(`[BeastBot] ✅ ${taskId} completed by ${member.user.tag}`);
            try {
                await member.send(`✅ You joined **${eventName}**! +1 giveaway entry earned 🎁`);
            } catch (_) {} // DMs may be closed
        }
    } catch (e) {
        console.error(`[BeastBot] voiceStateUpdate (${taskId}) failed:`, e.message);
    }
});

// ── Scheduled event RSVP — alternative trigger for game/movie night ───────────

client.on('guildScheduledEventUserAdd', async (event, user) => {
    if (user.bot) return;
    const todayDow = new Date().getUTCDay();
    const keyword  = todayDow === 5 ? 'game night' : todayDow === 6 ? 'movie night' : null;
    if (!keyword || !event.name.toLowerCase().includes(keyword)) return;

    const taskId = todayDow === 5 ? 'game_night' : 'movie_night';
    const guild  = event.guild;
    if (!guild) return;
    const member = await guild.members.fetch(user.id).catch(() => null);

    markTask(user.id, taskId, user.username, member)
        .then(result => {
            if (!result.alreadyDone) {
                console.log(`[BeastBot] ✅ ${taskId} (RSVP) completed by ${user.tag}`);
            }
        })
        .catch(e => console.error(`[BeastBot] markTask ${taskId} RSVP failed:`, e.message));
});

// ── Invite tracking ───────────────────────────────────────────────────────────

client.on('inviteCreate', (invite) => {
    inviteCache.set(invite.code, invite.uses || 0);
    console.log(`[BeastBot] New invite cached: ${invite.code}`);
});

client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
        const newInvites = await member.guild.invites.fetch();
        let usedInvite   = null;

        newInvites.forEach(inv => {
            const cached = inviteCache.get(inv.code) || 0;
            if (inv.uses > cached) usedInvite = inv;
            inviteCache.set(inv.code, inv.uses);
        });

        if (!usedInvite?.inviterId) return;

        const inviterId      = usedInvite.inviterId;
        const inviterMember  = await member.guild.members.fetch(inviterId).catch(() => null);
        const inviterUsername = inviterMember?.user.username || 'Unknown';

        // +3 entries for inviting a friend
        await addEntries(inviterId, inviterUsername, 3);
        console.log(`[BeastBot] ✅ invite bonus: ${inviterUsername} +3 entries (new member: ${member.user.tag})`);

        try {
            await inviterMember?.send(
                `🔗 **<@${member.user.id}> joined the server using your invite!** +3 giveaway entries earned 🎁`
            );
        } catch (_) {} // DMs may be closed
    } catch (e) {
        console.error('[BeastBot] guildMemberAdd invite tracking failed:', e.message);
    }
});

// ── Error handler ─────────────────────────────────────────────────────────────

client.on('error', (err) => console.error('[BeastBot] Client error:', err.message));

client.login(TOKEN);
