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
    AuditLogEvent, MessageFlags,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
try { GlobalFonts.loadFontsFromDir('/usr/share/fonts'); } catch (_) {}

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const path = require('path');
const sodium = require('libsodium-wrappers');
// libsodium-wrappers must be initialized before any voice encryption operations
sodium.ready.then(() => console.log('[BeastBot] ✅ libsodium-wrappers ready')).catch(e => console.error('[BeastBot] ❌ libsodium-wrappers init failed:', e.message));

// Pre-generate alarm beep once at startup so playback is from a buffer (no pipe timing issues)
let ALARM_OGG = null;
{
    const _chunks = [];
    const _proc = spawn('ffmpeg', ['-i', path.join(__dirname, 'alarm.mp3'), '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', 'pipe:1']);
    _proc.stdout.on('data', c => _chunks.push(c));
    _proc.stderr.on('data', d => { const l = d.toString().trim().split('\n').pop(); if (l) console.log('[BeastBot] alarm-gen:', l); });
    _proc.on('error', e => console.error('[BeastBot] alarm-gen spawn failed:', e.message));
    _proc.stdout.on('end', () => {
        const buf = Buffer.concat(_chunks);
        if (buf.length > 0) { ALARM_OGG = buf; console.log(`[BeastBot] ✅ Alarm audio ready: ${buf.length} bytes`); }
        else console.error('[BeastBot] ❌ Alarm audio empty — libopus may be unavailable in ffmpeg');
    });
}

const TOKEN             = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_IDS       = (process.env.SUPPORT_CHANNEL_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const MOD_CHANNEL_ID    = process.env.MOD_CHANNEL_ID;
const MOD_ROLE_ID       = process.env.MOD_ROLE_ID || '874315329474555944';
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

// ── Bot feature flags (loaded from Firestore botConfig/features every 5 min) ──
let botFeatures = {
    aiResponses:         true,
    discordCards:        true,
    bumpReminders:       true,
    rankUpNotifications: true,
    vcTracking:          true,
    welcomeMessages:     true,
    imposterGame:        true,
    traitorsGame:        true,
};

// ── Imposter Game ─────────────────────────────────────────────────────────────
const IMPOSTER_CHANNEL_ID  = '1498354389356904628';
const IMP_MIN_PLAYERS      = 3;
const IMP_MAX_PLAYERS      = 12;
const IMP_LOBBY_TIMEOUT_MS = 15 * 60 * 1000;

// channelId → GameState
const imposterGames = new Map();
// userId → channelId (reverse lookup)
const imposterPlayerMap = new Map();

// Question pairs: everyone gets `real`, imposter gets `alt`
const IMPOSTER_QUESTIONS = [
    // Tier 1 — Standard
    { real: "What do you do when you can't sleep?",                                          alt: "What do you do when you're trying to avoid someone?" },
    { real: "What's the first thing you do in the morning?",                                 alt: "What's the first thing you do after a long day?" },
    { real: "Describe your dream holiday.",                                                   alt: "Describe your dream retirement." },
    { real: "What do you do when you're bored at work?",                                     alt: "What do you do when you're avoiding studying?" },
    { real: "What's something you'd bring on a camping trip?",                               alt: "What's something you'd bring on a long flight?" },
    { real: "What's a typical thing someone does at a house party?",                         alt: "What's a typical thing someone does at a work event?" },
    { real: "What would you grab first in a house fire?",                                    alt: "What's the first thing you pack when you move house?" },
    { real: "How do you cheer yourself up on a bad day?",                                    alt: "How do you reward yourself after finishing a big task?" },
    { real: "What's something kids do that adults secretly wish they could?",                alt: "What's something animals do that humans secretly envy?" },
    { real: "What do you say when you're caught doing something embarrassing?",              alt: "What do you say when you forget someone's name?" },
    { real: "Describe the perfect Sunday.",                                                   alt: "Describe the perfect sick day." },
    { real: "What's something everyone lies about on their CV?",                             alt: "What's something people exaggerate on a first date?" },
    { real: "What would you do if you had a week off with no responsibilities?",             alt: "What would you do if you won £5,000 right now?" },
    { real: "What's something people do to look busy when they're not?",                     alt: "What's something people do to impress someone they like?" },
    { real: "What's a red flag in a new flatmate?",                                          alt: "What's a red flag on a first date?" },
    { real: "What's the worst thing about flying economy?",                                  alt: "What's the worst thing about commuting by train?" },
    { real: "What would you do if you found a wallet full of cash?",                         alt: "What would you do if you found a stranger's phone unlocked?" },
    { real: "What do you always forget to pack on holiday?",                                 alt: "What do you always forget when you leave the house?" },
    { real: "What's something you pretend to like but actually hate?",                       alt: "What's something you pretend to understand but actually don't?" },
    { real: "How do you know a film will be bad before you watch it?",                       alt: "How do you know a restaurant will be bad before you eat there?" },
    { real: "What do people do at a wedding they regret the next day?",                      alt: "What do people do at a work Christmas party they regret the next day?" },
    { real: "What's something you'd say on a TV game show?",                                 alt: "What's something you'd say at a job interview?" },
    { real: "What do people do at the gym to look like they know what they're doing?",       alt: "What do people do at a networking event to look confident?" },
    { real: "What's something that sounds romantic but is actually annoying?",               alt: "What's something that sounds adventurous but is actually exhausting?" },
    { real: "What do people do in the first 10 minutes of a meeting?",                       alt: "What do people do in the first 10 minutes of a first date?" },
    { real: "What's something small that can ruin your whole day?",                          alt: "What's something small that can completely make your day?" },
    { real: "What does someone's house tell you about them?",                                alt: "What does someone's car tell you about them?" },
    { real: "What's the most useless thing you own that you can't throw away?",              alt: "What's the most useless thing you learned in school?" },
    { real: "What's something people always do at an airport?",                              alt: "What's something people always do at a music festival?" },
    { real: "What's the worst gift you could receive?",                                      alt: "What's the worst advice you could give someone?" },
    { real: "What's something people pretend is fine when it's not?",                        alt: "What's something people say they love but secretly hate?" },
    { real: "How do you know someone has money without them saying it?",                     alt: "How do you know someone is having a bad week without them saying it?" },
    { real: "What's the unwritten rule at a barbecue?",                                      alt: "What's the unwritten rule in a shared kitchen?" },
    { real: "What's a sign someone is about to do something stupid?",                        alt: "What's a sign someone is about to start an argument?" },
    { real: "What's something that makes you feel instantly old?",                           alt: "What's something that makes you feel instantly like a kid again?" },
    { real: "What does every friendship group have?",                                         alt: "What does every family have?" },
    { real: "What's something you said you'd stop doing but never did?",                     alt: "What's something you said you'd start doing and never did?" },
    { real: "What's the most British thing a person can do?",                                alt: "What's the most British thing someone can say?" },
    { real: "What does a person do right before a job interview?",                           alt: "What does a person do right before a big night out?" },
    { real: "What do people do when they're nervous on a date?",                             alt: "What do people do when they're trying not to laugh?" },
    { real: "What's something that felt like a big deal at 15 that's nothing now?",          alt: "What's something adults stress about that they'll laugh at in 10 years?" },
    { real: "What's the best excuse for being late?",                                         alt: "What's the best excuse for not replying to a text?" },
    { real: "What's a food that divides people?",                                             alt: "What's a film that divides people?" },
    { real: "What's something you'd expect to find in a teenager's bedroom?",                alt: "What's something you'd expect to find in an office break room?" },
    { real: "What do people say when they don't want to hang out but don't want to say no?", alt: "What do people say when they hate a gift but don't want to hurt feelings?" },
    { real: "What's something everyone does alone but would be embarrassed if caught?",      alt: "What's something everyone thinks but no one says out loud?" },
    { real: "What's the most satisfying sound in the world?",                                alt: "What's the most irritating sound in the world?" },
    { real: "How do you know when a party is going badly?",                                  alt: "How do you know when a date is going badly?" },
    { real: "What's something you do to waste time without realising?",                      alt: "What's something you do when you're procrastinating?" },
    { real: "What's one thing that would improve any job?",                                  alt: "What's one thing that would improve any relationship?" },
    { real: "What's something people do at a funeral that they shouldn't?",                  alt: "What's something people do at a wedding that they shouldn't?" },
    { real: "What's the most passive aggressive thing a person can do?",                     alt: "What's the most passive aggressive thing someone can put in a group chat?" },
    { real: "What's something that's technically legal but morally wrong?",                  alt: "What's something that's technically rude but everyone does anyway?" },
    { real: "What would you do if you woke up and it was the same day on repeat?",           alt: "What would you do if you knew today was your last day to do whatever you want?" },
    { real: "What's something a person does when they're trying too hard to fit in?",        alt: "What's something a person does when they're trying too hard to be unique?" },
    { real: "What's the most overrated experience in life?",                                 alt: "What's the most underrated experience in life?" },
    { real: "What do people always do at New Year's Eve parties?",                           alt: "What do people always do at birthday parties as adults?" },
    { real: "What's a habit that's disgusting but secretly everyone does it?",               alt: "What's a habit people have in private that they'd never admit to?" },
    { real: "What's something rich people say that poor people find hilarious?",             alt: "What's something old people say that young people find hilarious?" },
    { real: "What would you rename yourself if you had to?",                                  alt: "What would you rename your hometown if you could?" },
    // Tier 2 — Spicy
    { real: "What do people lie about most in relationships?",                               alt: "What do people lie about most to their friends?" },
    { real: "What's something everyone does after a breakup?",                               alt: "What's something everyone does after getting fired?" },
    { real: "What's something that becomes a red flag once you're older?",                   alt: "What's something that was attractive at 20 that's a red flag at 30?" },
    { real: "What do people do when they're drunk that they regret sober?",                  alt: "What do people do at 2am they regret in the morning?" },
    { real: "What's something people do on social media to get attention?",                  alt: "What's something people do in real life to get attention?" },
    { real: "What's the most dramatic thing people do after a breakup?",                     alt: "What's the most dramatic thing people do when they're angry?" },
    { real: "What's something guys do that women don't understand?",                         alt: "What's something women do that men don't understand?" },
    { real: "What's a thing people do in bed that's not sleep?",                             alt: "What's a thing people do at midnight alone?" },
    { real: "What do people say when they're flirting but want plausible deniability?",      alt: "What do people say when they're being sarcastic but mean it?" },
    { real: "What's the most scandalous thing that could happen at a family dinner?",        alt: "What's the most scandalous thing that could happen at an office party?" },
    { real: "What's something people do on a first date to seem more interesting than they are?", alt: "What's something people do in a job interview to seem more qualified than they are?" },
    { real: "What's something you'd say while hooking up with someone for the first time?",  alt: "What's something you'd say the first time you visit someone's house?" },
    { real: "What's an overshare on a first date?",                                          alt: "What's an overshare in a job interview?" },
    { real: "What's the most awkward thing about sleeping in someone else's bed?",           alt: "What's the most awkward thing about staying at someone's house for the first time?" },
    { real: "What's something men are embarrassed to admit they do?",                        alt: "What's something people are embarrassed to Google?" },
    { real: "What's a lie everyone tells in the early stages of dating?",                    alt: "What's a lie everyone tells in the first week of a new job?" },
    { real: "What's something people do differently when no one is watching?",               alt: "What's something people do differently when they're with someone they fancy?" },
    { real: "What makes you immediately attracted to someone?",                               alt: "What makes you immediately trust someone?" },
    { real: "What's the most awkward thing to walk in on?",                                  alt: "What's the most awkward thing to accidentally send to the wrong person?" },
    { real: "What do people say when they want to end a conversation but don't know how?",   alt: "What do people say when they want to leave a party but don't want to be rude?" },
    // Tier 3 — Adult
    { real: "What's something you'd only do after a few drinks?",                            alt: "What's something you'd only say after knowing someone a long time?" },
    { real: "What's the weirdest place you'd be willing to hook up?",                        alt: "What's the weirdest place you've had an important conversation?" },
    { real: "What's something you'd never do on a first date but might do on the third?",   alt: "What's something you'd never say to your boss but might say to a close colleague?" },
    { real: "What's something people do in the bedroom to set the mood?",                    alt: "What's something people do to wind down before sleep?" },
    { real: "What's a thing people Google in incognito mode?",                               alt: "What's a thing people delete from their browser history?" },
    { real: "What's something people fake in relationships?",                                alt: "What's something people fake in friendships?" },
    { real: "What's the most embarrassing thing you could accidentally moan?",               alt: "What's the most embarrassing thing you could accidentally say out loud?" },
    { real: "What's something that sounds sexual but isn't?",                                alt: "What's something that sounds violent but isn't?" },
    { real: "What do people do to feel sexy?",                                               alt: "What do people do to feel confident before a big moment?" },
    { real: "What's a body part people are secretly self-conscious about?",                  alt: "What's a personality trait people are secretly self-conscious about?" },
    { real: "What's the most unsexy thing someone can say during intimacy?",                 alt: "What's the most unsexy thing someone can say on a first date?" },
    { real: "What's something people text their ex at 3am?",                                 alt: "What's something people say when they're drunk and emotional?" },
    { real: "What's something couples fight about that's never actually about what it seems?", alt: "What's something friends fall out over that's never actually about what it seems?" },
    { real: "What's a dead giveaway that someone is bad in bed?",                            alt: "What's a dead giveaway that someone is bad at their job?" },
    { real: "What's something people do to avoid intimacy?",                                 alt: "What's something people do to avoid a difficult conversation?" },
    { real: "What do people say to end a situationship without saying it directly?",         alt: "What do people say to get out of plans without being honest?" },
    { real: "What's the difference between someone who's a great kisser and someone who isn't?", alt: "What's the difference between someone who's a great talker and someone who isn't?" },
    { real: "What's something people do differently with a new partner vs a long-term one?", alt: "What's something people do differently in a new job vs when they've been there a year?" },
    { real: "What's an excuse people use to get someone into their flat?",                   alt: "What's an excuse people use to extend a date that's going well?" },
    { real: "What's something that starts as a joke between two people but becomes something more?", alt: "What's something that starts as a work relationship but becomes something more?" },
];

// ── Traitors Game ─────────────────────────────────────────────────────────────
const TRT_CHANNEL_ID         = '1498657971994099825';
const TRT_MIN_PLAYERS        = 4;
const TRT_MAX_PLAYERS        = 20;
const TRT_LOBBY_TIMEOUT_MS   = 15 * 60 * 1000;
const TRT_DISCUSSION_MS      =  5 * 60 * 1000;
const TRT_VOTE_MS            =  3 * 60 * 1000;
const TRT_RECRUIT_MS         =  5 * 60 * 1000;

function trtGetTraitorCount(n) {
    if (n >= 15) return 3;
    if (n >= 9)  return 2;
    return 1;
}

const traitorGames     = new Map(); // channelId → GameState
const traitorPlayerMap = new Map(); // userId → channelId

const TRT_TEXT = {
    CASTLE_SLEEPS:   '🌙 The castle falls silent. The Traitors move through the shadows...',
    CASTLE_SAFE:     '🌅 The castle is safe — no one was found dead this morning.',
    FOUND_DEAD:      (name) => `🩸 The body of **${name}** was found at dawn. Another soul lost to the Traitors.`,
    DM_YOU_ARE_TRAITOR: (allies) => allies.length > 0
        ? `Your fellow Traitor${allies.length > 1 ? 's' : ''}: **${allies.join(', ')}**\n\nYou know who to trust. Hunt wisely.\n\n*Keep your role secret — sharing DMs violates game integrity.*`
        : `You are the **only Traitor**. You hunt alone.\n\n*Keep your role secret — sharing DMs violates game integrity.*`,
    DM_YOU_ARE_FAITHFUL: 'Find the Traitors and banish them before it\'s too late.\n\n*Keep your role secret — sharing DMs violates game integrity.*',
    DM_SHIELD:       'If the Traitors choose you tonight, their murder will fail. Keep this secret.',
    DM_RECRUIT_OFFER: (traitorName) => `**${traitorName}** wants you to join them as a Traitor.\n\n✅ **Accept** — you become a Traitor and hunt with them from next round.\n❌ **Decline** — you will be silenced. The Traitor cannot let you live with this knowledge.\n\n*You have 5 minutes to decide.*`,
    DM_RECRUIT_ACCEPTED: (targetName) => `**${targetName}** has joined your side. You now have an ally.`,
    DM_RECRUIT_DECLINED: (targetName) => `❌ **${targetName}** declined. The night passes safely.`,
    DM_NOW_TRAITOR:  (allies) => allies.length > 0
        ? `Your fellow Traitor${allies.length > 1 ? 's' : ''}: **${allies.join(', ')}**\n\nHunt together from the next round.`
        : 'You are now a Traitor. Hunt wisely from the next round.',
    DISCUSSION_START: '⚖️ Gather round the table. Discuss — who do you suspect?',
    DISCUSSION_3MIN:  '⏳ **3 minutes remaining** — make your case.',
    DISCUSSION_1MIN:  '⚡ **1 minute remaining** — wrap up your arguments!',
    DISCUSSION_30SEC: '🔔 **30 seconds!** The vote is coming.',
    BANISHED:        (name) => `🪓 The table has spoken. **${name}** has been banished from the castle.`,
    DEADLOCK:        '🤝 The vote is tied — no one is banished.',
    FAITHFUL_WIN:    '🏆 **THE FAITHFULS WIN!** All Traitors have been banished.',
    TRAITOR_WIN:     '🗡️ **THE TRAITORS WIN!** They now control the castle.',
    RESTART_NOTICE:  '⚠️ The Traitors game was interrupted by a bot restart. Any in-progress game has been lost. Run `/traitors start` to play again.',
};

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
    scheduleAiHistorySave();
}

let _aiHistoryTimer = null;
function scheduleAiHistorySave() {
    // AI history is captured in the Discord backup every 60s — no Firestore write needed
    if (_aiHistoryTimer) return;
    _aiHistoryTimer = setTimeout(() => { _aiHistoryTimer = null; }, 60000);
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

async function getBotFeatures() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/features?key=${FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url);
        if (!res.ok) { console.warn('[BeastBot] getBotFeatures: HTTP', res.status); return; }
        const data = await res.json();
        if (!data.fields) return; // doc doesn't exist yet — keep defaults
        const updated = { ...botFeatures }; // start from current (keep defaults for missing keys)
        for (const [k, v] of Object.entries(data.fields)) {
            if (typeof v.booleanValue === 'boolean') updated[k] = v.booleanValue;
        }
        botFeatures = updated;
        console.log('[BeastBot] botFeatures refreshed:', JSON.stringify(botFeatures));
    } catch (e) {
        console.warn('[BeastBot] getBotFeatures failed — keeping previous values:', e.message);
    }
}

let _knowledgeCache    = null;
let _knowledgeCacheAt  = 0;
const KNOWLEDGE_TTL    = 60 * 60 * 1000; // refresh from Firestore at most once per hour

// Cached month for checkMonthlyReset — loaded once at startup, avoids hourly Firestore reads
let _cachedCurrentMonth = null;

async function fetchKnowledge() {
    const now = Date.now();
    if (_knowledgeCache !== null && now - _knowledgeCacheAt < KNOWLEDGE_TTL) return _knowledgeCache;
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/knowledgeBase?key=${FIREBASE_API_KEY}&pageSize=50`;
    try {
        const res = await fetch(url);
        if (!res.ok) return _knowledgeCache ?? '';
        const data = await res.json();
        _knowledgeCache   = (data.documents?.length ? data.documents.map(doc => {
            const f = doc.fields || {};
            return `### ${f.topic?.stringValue || '(untitled)'}\n${f.content?.stringValue || ''}`;
        }).join('\n\n') : '');
        _knowledgeCacheAt = now;
        return _knowledgeCache;
    } catch (e) {
        console.error('[BeastBot] Firestore fetch failed:', e.message);
        return _knowledgeCache ?? '';
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
        const events = await guild.scheduledEvents.fetch();
        const now    = new Date();
        const sorted = [...events.values()].sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);

        const upcoming = sorted.filter(e => e.scheduledStartAt > now).slice(0, 5);
        if (upcoming.length > 0) {
            const list = upcoming.map(e =>
                `- **${e.name}**: ${e.scheduledStartAt.toDateString()}${e.description ? ` — ${e.description}` : ''}`
            ).join('\n');
            parts.push(`### Upcoming Discord Events\n${list}`);
        }

        const past = sorted.filter(e => e.scheduledStartAt <= now).slice(0, 5);
        if (past.length > 0) {
            const list = past.map(e =>
                `- **${e.name}**: ${e.scheduledStartAt.toDateString()}${e.description ? ` — ${e.description}` : ''}`
            ).join('\n');
            parts.push(`### Recent Past Discord Events\n${list}`);
        }
    } catch (e) {
        console.error('[BeastBot] Could not fetch scheduled events:', e.message);
    }

    // Extract all readable text from a message, including embed content
    function msgToText(m) {
        const lines = [];
        if (m.content) lines.push(m.content.slice(0, 600));
        for (const embed of m.embeds) {
            if (embed.title)            lines.push(`Title: ${embed.title}`);
            if (embed.description)      lines.push(`Description: ${embed.description.slice(0, 600)}`);
            for (const f of (embed.fields || [])) lines.push(`${f.name}: ${f.value}`);
            if (embed.footer?.text)     lines.push(`Footer: ${embed.footer.text}`);
        }
        return lines.join(' | ') || '(no content)';
    }

    const announcementsChannel = guild.channels.cache.find(c =>
        c.isTextBased?.() && c.name.toLowerCase().includes('announcement')
    );
    if (announcementsChannel) {
        try {
            const msgs = await announcementsChannel.messages.fetch({ limit: 5 });
            if (msgs.size > 0) {
                const list = [...msgs.values()].map(m =>
                    `[${m.createdAt.toDateString()}] ${msgToText(m)}`
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
            const msgs = await eventsChannel.messages.fetch({ limit: 10 });
            if (msgs.size > 0) {
                const list = [...msgs.values()].map(m =>
                    `[${m.createdAt.toDateString()}] ${msgToText(m)}`
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

You have a knowledge base about TrueBeast, Kiernen, the tools, events, and community. You also receive live context from Discord (announcements, upcoming and past scheduled events, recent event channel posts) and Steam (recently played games). Always use the most up-to-date info available.

IMPORTANT — when someone asks about events, game nights, or what's been happening: answer directly from the Live Discord Context you receive. Never tell them to go check a channel themselves — you already have that data. Summarise it for them.

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

CONTEXT YOU RECEIVE — use it to personalise your responses:
- ## Who You're Talking To: their display name, server rank, XP, voice time, join date. Reference these naturally when relevant (e.g. acknowledge rank progress, reference their activity). Don't recite stats robotically — weave them in when they add something.
- If the user is TrueBeast / Kiernen Irons (server owner), be more candid and casual. He runs this server and knows how everything works.
- ## Recent Channel Messages: the last few messages in the channel. Use this to understand the ongoing conversation and respond in context, not in a vacuum.
- You are in a dedicated AI chat channel — people come here to have real conversations, not just ask support questions. Lean into that.

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

async function askClaude(question, knowledge, discordContext, steamContext, history = [], userContext = null, channelCtx = null) {
    const contextParts = [];
    if (knowledge)      contextParts.push(`## Knowledge Base\n${knowledge}`);
    if (discordContext) contextParts.push(`## Live Discord Context\n${discordContext}`);
    if (steamContext)   contextParts.push(`## Live Steam Context\n${steamContext}`);
    if (userContext)    contextParts.push(`## Who You're Talking To\n${userContext}`);
    if (channelCtx)     contextParts.push(`## Recent Channel Messages\n${channelCtx}`);

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

// ── AI context helpers ────────────────────────────────────────────────────────

function buildUserContext(userId, guild) {
    const member   = guild.members.cache.get(userId);
    const name     = memberNameCache.get(userId) || member?.displayName || 'Unknown';
    const score    = monthlyActivityScore(userId);
    const msgs     = messageCounts.get(userId) || 0;
    const vcData   = voiceMinutes.get(userId) || { total: 0 };
    const isOwner  = userId === OWNER_DISCORD_ID;

    let rankIdx = 0;
    for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
        if (score >= VOICE_RANK_ROLES[i].minXp) rankIdx = i;
    }
    const rankName = VOICE_RANK_ROLES[rankIdx].name;
    const joinedAt = member?.joinedAt ? member.joinedAt.toDateString() : 'unknown';

    return [
        `**Display name:** ${name}${isOwner ? ' (server owner — TrueBeast / Kiernen Irons)' : ''}`,
        `**Server rank:** ${rankName} (${score} XP this month)`,
        `**Messages sent (all time):** ${msgs.toLocaleString()}`,
        `**Voice time (all time):** ${Math.floor(vcData.total / 60)}h ${vcData.total % 60}m`,
        `**Joined server:** ${joinedAt}`,
    ].join('\n');
}

async function fetchChannelContext(channel) {
    try {
        const msgs = await channel.messages.fetch({ limit: 10 });
        return [...msgs.values()]
            .reverse()
            .filter(m => m.content && !m.author.bot)
            .map(m => `[${m.member?.displayName ?? m.author.username}]: ${m.content.slice(0, 200)}`)
            .join('\n') || null;
    } catch { return null; }
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
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const COUNTING_CHANNEL_ID  = '1486479498248585277';
const AI_CHANNEL_ID        = '1482956343131246673';
const BUMP_CHANNEL_ID      = '1477361149862482053';
const BACKUP_CHANNEL_ID    = process.env.BACKUP_CHANNEL_ID || '1490542501302636726';
let _discordBackupMsgId    = null;
let _lastDailyFirestoreDate = '';
const LOG_CHANNEL_ID     = '1339916490744397896';
const INTRO_CHANNEL_ID   = process.env.INTRO_CHANNEL_ID || '';
const THOUGHTS_CHANNEL_ID = '1488545515976134737';
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

// ── Fitness Tracking ──────────────────────────────────────────────────────────
const FITNESS_TRACKING_CHANNEL_ID = '1499562548767490058'; // #tracking
const FITNESS_VC_TRIGGER_ID       = '1499568259299676321'; // Workout Together (join-to-create)
const FITNESS_DISCUSS_CHANNEL_ID  = '1499562699300802570'; // #discussions
const fitnessData  = new Map(); // userId → { entries: [], notify: null }
const workoutRooms = new Map(); // channelId → { ownerId, ownerName, deleteTimer, dmMessageId, createdAt }
const TZ_LABELS = {
    '-12': 'UTC-12', '-11': 'UTC-11', '-10': 'Hawaii (UTC-10)', '-9': 'Alaska (UTC-9)',
    '-8': 'Pacific (UTC-8)', '-7': 'Mountain (UTC-7)', '-6': 'Central (UTC-6)',
    '-5': 'Eastern (UTC-5)', '-4': 'Atlantic/EDT (UTC-4)', '-3': 'Brazil (UTC-3)',
    '-2': 'UTC-2', '-1': 'Azores (UTC-1)', '0': 'London/UTC',
    '1': 'Paris/Berlin (UTC+1)', '2': 'Athens/Cairo (UTC+2)', '3': 'Moscow (UTC+3)',
    '4': 'Dubai (UTC+4)', '5': 'Pakistan (UTC+5)', '5.5': 'India/IST (UTC+5:30)',
    '6': 'Bangladesh (UTC+6)', '7': 'Bangkok (UTC+7)', '8': 'Singapore/Beijing (UTC+8)',
    '9': 'Tokyo/JST (UTC+9)', '10': 'Sydney (UTC+10)', '12': 'Auckland/NZT (UTC+12)',
};

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
const reactionDays         = new Map(); // userId → Map<"YYYY-MM-DD", count>            (reactions given)
const emojiTally           = new Map(); // userId → Map<emojiKey, count>                 (all-time emoji tally)
const reactionEmojiDays    = new Map(); // userId → Map<"YYYY-MM-DD", Map<emoji, count>> (per-day emoji tally)
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

// ── Moderation ────────────────────────────────────────────────────────────────
const infractions = new Map(); // userId → [{ type, reason, modId, timestamp }]
const tempBans    = new Map(); // userId → { guildId, expiresAt, reason }

// ── Counting game ─────────────────────────────────────────────────────────────
let countingState = {
    current: 0,        // current count (0 = not started / just reset)
    lastUserId: null,  // userId who sent the last correct number
    record: 0,         // all-time highest count reached before a fail
    wallOfShame: [],   // [userId, ...] — unique user IDs, ordered by first ruin
    _loaded: false,    // true once state has been loaded from backup — guards shutdown save
};
let _countingQuickMsgId = null; // Discord message ID for the rapid counting quick-save
const countingBotDeletedIds = new Set(); // message IDs the bot deleted for enforcement (prevents false count-back resets)
const voiceRankRoleCache = new Map(); // roleName → Role object
const rankAchievements   = new Map(); // userId → { highestRankIdx: number, apexCount: number, hitApexThisMonth: boolean }
const AFK_CHANNEL_ID     = process.env.AFK_CHANNEL_ID || '';
// Voice channels that don't earn XP — private/excluded channels
const NO_XP_VC_IDS = new Set(['1017862214083952671']); // owner's private channel

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
// DISABLED — Discord.me reminder removed; only Disboard bump remains active
// function scheduleDiscordMeReminder() {
//     const now         = new Date();
//     const currentHour = now.getUTCHours();
//     const nextWindow  = [0, 6, 12, 18].find(h => h > currentHour);
//     const next        = new Date(now);
//
//     if (nextWindow !== undefined) {
//         next.setUTCHours(nextWindow, 0, 0, 0);
//     } else {
//         next.setUTCDate(next.getUTCDate() + 1);
//         next.setUTCHours(0, 0, 0, 0);
//     }
//
//     setTimeout(async () => {
//         try {
//             const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
//             await channel.send('⏰ New bump window open! Head to <https://discord.me/dashboard#bumpModal> to bump the server on Discord.me.');
//             console.log('[BeastBot] 🔔 Sent Discord.me bump reminder');
//         } catch (e) {
//             console.error('[BeastBot] Failed to send Discord.me bump reminder:', e.message);
//         }
//         scheduleDiscordMeReminder();
//     }, next - now);
//
//     console.log(`[BeastBot] Discord.me bump reminder scheduled for ${next.toUTCString()}`);
// }

// Discadia: posts a reminder with a confirm button; timer starts when button is clicked
// DISABLED — Discadia reminder removed; only Disboard bump remains active
// async function postDiscadiaReminder() {
//     try {
//         const channel = await client.channels.fetch(BUMP_CHANNEL_ID);
//         const row = new ActionRowBuilder().addComponents(
//             new ButtonBuilder()
//                 .setCustomId('discadia:bumped')
//                 .setLabel('✅ I bumped it')
//                 .setStyle(ButtonStyle.Success),
//         );
//         await channel.send({
//             content: '⏰ Time to bump on Discadia! <https://discadia.com/bump/truebeasts/>',
//             components: [row],
//         });
//         console.log('[BeastBot] 🔔 Sent Discadia bump reminder');
//     } catch (e) {
//         console.error('[BeastBot] Failed to send Discadia bump reminder:', e.message);
//     }
// }
//
// function scheduleDiscadiaReminder(delayMs = DISCADIA_INTERVAL) {
//     if (discadiaTimer) clearTimeout(discadiaTimer);
//     const fireAt = Date.now() + delayMs;
//     firestoreSet('botTimers', 'discadia', { fireAt, updatedAt: new Date().toISOString() });
//     discadiaTimer = setTimeout(postDiscadiaReminder, delayMs);
//     console.log(`[BeastBot] Discadia bump reminder scheduled for ${new Date(fireAt).toUTCString()}`);
// }

function scheduleBumpReminder() {
    if (bumpTimer) clearTimeout(bumpTimer);
    const fireAt = Date.now() + BUMP_INTERVAL;
    // Persist so it survives restarts
    firestoreSet('botTimers', 'disboard', { fireAt, updatedAt: new Date().toISOString() });
    bumpTimer = setTimeout(async () => {
        if (botFeatures.bumpReminders === false) { console.log('[BeastBot] Bump Reminders disabled — skipping'); return; }
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
                `${picked.displayName}, feel free to share a bit about yourself - what you're into, what games you play, ` +
                `or anything you'd like people to know!`,
            fields: [
                { name: '🗓️ Joined Server', value: joinDate, inline: true },
                { name: '📅 Account Created', value: accountAge, inline: true },
                { name: '🏷️ Roles', value: roles || 'None yet!', inline: false },
            ],
            footer: { text: 'Member Spotlight - every week a new community member gets the stage' },
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

// Saves just the count to a dedicated Discord message — updated within 3s of every change.
// This is the source of truth on restart; far more reliable than waiting 60s for the main backup.
let _countingQuickTimer = null;
function scheduleCountingQuickSave() {
    if (_countingQuickTimer) return;
    _countingQuickTimer = setTimeout(() => {
        _countingQuickTimer = null;
        saveCountingQuick().catch(() => {});
    }, 3000);
}

async function saveCountingQuick() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return;
    const payload = JSON.stringify({
        savedAt: new Date().toISOString(),
        current: countingState.current,
        lastUserId: countingState.lastUserId || '',
        record: countingState.record,
        wallOfShame: countingState.wallOfShame,
    });
    const content = `🔢 counting-quick ${payload}`;
    try {
        const ch = await client.channels.fetch(BACKUP_CHANNEL_ID);
        if (_countingQuickMsgId) {
            try {
                const msg = await ch.messages.fetch(_countingQuickMsgId);
                await msg.edit({ content });
                return;
            } catch (_) { _countingQuickMsgId = null; }
        }
        const sent = await ch.send({ content });
        _countingQuickMsgId = sent.id;
        console.log(`[BeastBot] 🔢 Counting quick-save created (msgId=${sent.id})`);
    } catch (e) { console.error('[BeastBot] saveCountingQuick failed:', e.message); }
}

async function loadCountingQuick() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return null;
    try {
        const ch = await client.channels.fetch(BACKUP_CHANNEL_ID);
        const msgs = await ch.messages.fetch({ limit: 50 });
        let bestData = null, bestTime = 0, bestMsgId = null;
        for (const m of msgs.values()) {
            if (m.author.id !== client.user.id) continue;
            if (!m.content.startsWith('🔢 counting-quick ')) continue;
            try {
                const data = JSON.parse(m.content.slice('🔢 counting-quick '.length));
                const t = new Date(data.savedAt).getTime();
                if (t > bestTime) { bestTime = t; bestData = data; bestMsgId = m.id; }
            } catch { continue; }
        }
        if (bestData) {
            _countingQuickMsgId = bestMsgId;
            console.log(`[BeastBot] 🔢 Counting quick-save loaded: count=${bestData.current}, savedAt=${bestData.savedAt}`);
        }
        return bestData;
    } catch (e) { console.error('[BeastBot] loadCountingQuick failed:', e.message); return null; }
}

async function handleCountingMessage(message) {
    if (message.author.bot) return;

    const trimmed = message.content.trim();
    const num = parseInt(trimmed, 10);
    const isValidNumber = !isNaN(num) && String(num) === trimmed && num > 0;

    // Not a valid positive integer — delete silently
    if (!isValidNumber) {
        countingBotDeletedIds.add(message.id);
        await message.delete().catch(() => { countingBotDeletedIds.delete(message.id); });
        return;
    }

    // Same person sent twice in a row — delete and warn
    if (message.author.id === countingState.lastUserId) {
        countingBotDeletedIds.add(message.id);
        await message.delete().catch(() => { countingBotDeletedIds.delete(message.id); });
        const w = await message.channel.send(`<@${message.author.id}> You can't count twice in a row - wait for someone else!`);
        setTimeout(() => w.delete().catch(() => {}), 6000);
        return;
    }

    const expected = countingState.current + 1;

    // Wrong number — fail!
    if (num !== expected) {
        const ruinedAt = countingState.current;
        const isNewRecord = ruinedAt > countingState.record;
        if (isNewRecord) countingState.record = ruinedAt;

        // Update wall of shame: one entry per user, tracking their personal highest fail
        const existing = countingState.wallOfShame.find(e => e.userId === message.author.id);
        if (existing) {
            if (ruinedAt > existing.highest) existing.highest = ruinedAt;
        } else {
            countingState.wallOfShame.push({ userId: message.author.id, highest: ruinedAt });
        }
        countingState.wallOfShame.sort((a, b) => b.highest - a.highest);

        countingState.current = 0;
        countingState.lastUserId = null;

        await message.react('❌').catch(() => {});

        const shameList = countingState.wallOfShame
            .slice(0, 10)
            .map((e, i) => `${i + 1}. <@${e.userId}> — **${e.highest}**`)
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

        // Save immediately so the reset is persisted right now, not 60s later
        await saveCountingQuick();
        if (message.guild) checkMessageMilestone(message).catch(() => {});
        return;
    }

    // Correct number!
    countingState.current = num;
    countingState.lastUserId = message.author.id;
    if (num > countingState.record) countingState.record = num;
    scheduleCountingQuickSave();
    if (message.guild) checkMessageMilestone(message).catch(() => {});

    // Counting state is persisted via Discord backup every 60s — no per-count Firestore write

    if (num % 10 === 0) await message.react('🎉').catch(() => {});
}

// ── Member Milestones ─────────────────────────────────────────────────────────


// Direct Discord REST fetch with AbortController — actually cancels the HTTP request on timeout,
// unlike Promise.race which leaves the Discord.js queue request pending and blocking future calls.
async function discordRestFetch(path, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const r = await fetch(`https://discord.com/api/v10${path}`, {
            headers: { Authorization: `Bot ${TOKEN}` },
            signal: controller.signal,
        });
        if (r.status === 429) {
            const wait = parseFloat(r.headers.get('retry-after') || '2');
            await new Promise(res => setTimeout(res, Math.min(wait * 1000 + 500, 15000)));
            return null;
        }
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
    finally { clearTimeout(timer); }
}

// Full-replace save — used only by /scanreactions (authoritative, verified data)
async function saveReactionData(userId, rMap, eMap, edMap) {
    // emojiTally + reactionEmojiDays stored as JSON strings to avoid Firestore field name
    // restrictions on emoji chars and custom emoji format <:name:id>
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/messageCounts/${userId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=reactionDays&updateMask.fieldPaths=emojiTally&updateMask.fieldPaths=reactionEmojiDays`;
    const dayFields = {};
    for (const [k, v] of rMap.entries()) dayFields[k] = { integerValue: String(v) };
    const emojiObj = {};
    for (const [k, v] of eMap.entries()) emojiObj[k] = v;
    const emojiDaysObj = {};
    if (edMap) {
        for (const [day, dayMap] of edMap.entries()) {
            const dayObj = {};
            for (const [k, v] of dayMap.entries()) dayObj[k] = v;
            emojiDaysObj[day] = dayObj;
        }
    }
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                reactionDays:      { mapValue: { fields: dayFields } },
                emojiTally:        { stringValue: JSON.stringify(emojiObj) },
                reactionEmojiDays: { stringValue: JSON.stringify(emojiDaysObj) },
            }}),
        });
        if (!res.ok) console.error(`[BeastBot] saveReactionData failed for ${userId}: ${res.status} ${await res.text()}`);
    } catch (e) { console.error('[BeastBot] saveReactionData error:', e.message); }
}

// Schedule a debounced flush of a user's reaction session delta to Firestore
// ── Logging helpers ───────────────────────────────────────────────────────────

const LOG_COLORS = {
    join:   0x22c55e,
    leave:  0xef4444,
    ban:    0xef4444,
    kick:   0xf97316,
    warn:   0xf59e0b,
    mute:   0xf59e0b,
    edit:   0x3b82f6,
    delete: 0xef4444,
    role:   0xf59e0b,
    nick:   0xa855f7,
    server: 0xa855f7,
    info:   0x3b82f6,
};

function buildLogEmbed({ color, user, description, fields = [], footerExtra = '' }) {
    const avatarUrl = user?.displayAvatarURL?.({ size: 128, extension: 'png' }) || null;
    return {
        color,
        author: user ? { name: user.username ?? user.tag ?? 'Unknown', icon_url: avatarUrl } : undefined,
        description,
        fields,
        thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
        timestamp: new Date().toISOString(),
        footer: user ? { text: `ID: ${user.id}${footerExtra ? ` • ${footerExtra}` : ''}` } : undefined,
    };
}

async function sendLog(guild, embed) {
    try {
        const ch = await client.channels.fetch(LOG_CHANNEL_ID);
        await ch.send({ embeds: [embed] });
    } catch (_) {}
}

async function getAuditEntry(guild, type, targetId = null, maxAgeMs = 5000) {
    try {
        const logs = await guild.fetchAuditLogs({ type, limit: 5 });
        return logs.entries.find(e => {
            if (Date.now() - e.createdTimestamp > maxAgeMs) return false;
            if (targetId && e.target?.id !== targetId) return false;
            return true;
        }) || null;
    } catch { return null; }
}

// ── Moderation helpers ────────────────────────────────────────────────────────

function isModerator(interaction) {
    return interaction.user.id === OWNER_DISCORD_ID ||
           interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
}

function parseDuration(str) {
    const match = str?.match(/^(\d+)(s|m|h|d|w)$/i);
    if (!match) return null;
    const n = parseInt(match[1]);
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    return n * (units[match[2].toLowerCase()] || 0);
}

function formatDuration(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
    if (ms < 604800000) return `${Math.round(ms / 86400000)}d`;
    return `${Math.round(ms / 604800000)}w`;
}

// ── Infraction Firestore ──────────────────────────────────────────────────────

async function loadInfractions() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/infractions?key=${FIREBASE_API_KEY}&pageSize=500`;
    try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        for (const doc of (data.documents || [])) {
            const userId = doc.name.split('/').pop();
            try {
                const list = JSON.parse(doc.fields?.list?.stringValue || '[]');
                if (list.length > 0) infractions.set(userId, list);
            } catch (_) {}
        }
        console.log(`[BeastBot] Infractions loaded — ${infractions.size} users`);
    } catch (e) { console.error('[BeastBot] loadInfractions error:', e.message); }
}

async function saveInfractions(userId) {
    const list = infractions.get(userId) || [];
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/infractions/${userId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=list`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { list: { stringValue: JSON.stringify(list) } } }),
        });
    } catch (e) { console.error('[BeastBot] saveInfractions error:', e.message); }
}

function addInfraction(userId, type, reason, modId) {
    const list = infractions.get(userId) || [];
    list.push({ type, reason: reason || 'No reason provided', modId, timestamp: Date.now() });
    infractions.set(userId, list);
    saveInfractions(userId);
}

function getUserInfractions(userId) {
    return infractions.get(userId) || [];
}

async function clearUserInfractions(userId) {
    infractions.set(userId, []);
    await saveInfractions(userId);
}

async function clearAllInfractions() {
    const ids = [...infractions.keys()];
    infractions.clear();
    await Promise.allSettled(ids.map(id => saveInfractions(id)));
}

// ── Temp Ban Firestore ────────────────────────────────────────────────────────

async function saveTempBans() {
    const list = [...tempBans.entries()].map(([uid, d]) => ({ userId: uid, ...d }));
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/tempBans?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=list`;
    try {
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { list: { stringValue: JSON.stringify(list) } } }),
        });
    } catch (e) { console.error('[BeastBot] saveTempBans error:', e.message); }
}

function scheduleTempBan(guild, userId, expiresAt) {
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
        guild.bans.remove(userId, 'Temp ban expired').catch(() => {});
        tempBans.delete(userId);
        saveTempBans();
        return;
    }
    // Re-schedule in 24h chunks if longer than that
    const fireIn = Math.min(delay, 24 * 60 * 60 * 1000);
    setTimeout(async () => {
        if (!tempBans.has(userId)) return;
        if (Date.now() >= expiresAt) {
            await guild.bans.remove(userId, 'Temp ban expired').catch(() => {});
            tempBans.delete(userId);
            await saveTempBans();
        } else {
            scheduleTempBan(guild, userId, expiresAt);
        }
    }, fireIn);
}

async function loadTempBans() {
    const data = await firestoreGet('botConfig', 'tempBans');
    if (!data?.list) return;
    try {
        const list = JSON.parse(data.list);
        for (const entry of list) {
            if (entry.expiresAt > Date.now()) {
                tempBans.set(entry.userId, { guildId: entry.guildId, expiresAt: entry.expiresAt, reason: entry.reason });
            }
        }
        console.log(`[BeastBot] Temp bans loaded — ${tempBans.size} active`);
        // Re-schedule all active temp bans
        if (tempBans.size > 0) {
            const guild = client.guilds.cache.first();
            if (guild) {
                for (const [uid, d] of tempBans) scheduleTempBan(guild, uid, d.expiresAt);
            }
        }
    } catch (e) { console.error('[BeastBot] loadTempBans error:', e.message); }
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

// Saves a full snapshot of all message day data to botConfig/messageBackup.
// On startup this backup is merged with live Firestore data — whichever is higher wins.
// This survives collection deletes, crashes, and restarts.
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

async function saveRankAchievements(userId, ach) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/rankAchievements/${userId}?key=${FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                highestRankIdx: { integerValue: String(ach.highestRankIdx) },
                apexCount:      { integerValue: String(ach.apexCount) },
            }}),
        });
        if (!res.ok) console.error(`[BeastBot] saveRankAchievements ${userId} → ${res.status} ${await res.text()}`);
    } catch (e) { console.error('[BeastBot] saveRankAchievements error:', e.message); }
}

function todayStr() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function parseDurationToMins(str) {
    if (!str) return null;
    const s = str.toLowerCase().trim();
    const hm = s.match(/(\d+)\s*h(?:r|ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/);
    if (hm) return parseInt(hm[1]) * 60 + (parseInt(hm[2] || '0') || 0);
    const m = s.match(/(\d+)\s*m(?:in(?:utes?)?)?/);
    if (m) return parseInt(m[1]);
    const n = s.match(/^(\d+)$/);
    if (n) return parseInt(n[1]);
    return null;
}

function parseTimeToUtc(rawTime, offsetHours) {
    const normalized = rawTime.trim().toUpperCase().replace(/\s+/g, '');
    let h, m;
    const ampm = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
    const plain = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (ampm) {
        h = parseInt(ampm[1]);
        m = parseInt(ampm[2] || '0');
        if (ampm[3] === 'PM' && h !== 12) h += 12;
        if (ampm[3] === 'AM' && h === 12) h = 0;
    } else if (plain) {
        h = parseInt(plain[1]);
        m = parseInt(plain[2]);
    } else {
        return null;
    }
    if (h > 23 || m > 59) return null;
    const totalMinsLocal = h * 60 + m;
    const off = parseFloat(offsetHours) || 0;
    const totalMinsUtc = ((totalMinsLocal - off * 60) % 1440 + 1440) % 1440;
    const utcH = Math.floor(totalMinsUtc / 60);
    const utcM = totalMinsUtc % 60;
    return `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
}

function parseDays(rawDays) {
    const s = rawDays.trim().toUpperCase();
    if (['DAILY', 'EVERY DAY', 'EVERYDAY', 'ALL'].includes(s)) return [0, 1, 2, 3, 4, 5, 6];
    if (['WEEKDAYS', 'WORKDAYS', 'MON-FRI'].includes(s)) return [1, 2, 3, 4, 5];
    if (s === 'WEEKENDS') return [0, 6];
    const map = { SUN: 0, SUNDAY: 0, MON: 1, MONDAY: 1, TUE: 2, TUES: 2, TUESDAY: 2, WED: 3, WEDNESDAY: 3, THU: 4, THURS: 4, THURSDAY: 4, FRI: 5, FRIDAY: 5, SAT: 6, SATURDAY: 6 };
    const parts = s.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
    const result = [];
    for (const p of parts) {
        if (map[p] !== undefined && !result.includes(map[p])) result.push(map[p]);
    }
    return result.length ? result.sort((a, b) => a - b) : null;
}

function calcStreak(entries) {
    if (!entries || entries.length === 0) return 0;
    const days = new Set(entries.map(e => e.date));
    const today = todayStr();
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    let streak = 0;
    while (true) {
        const key = d.toISOString().slice(0, 10);
        if (!days.has(key)) break;
        streak++;
        d.setUTCDate(d.getUTCDate() - 1);
    }
    if (days.has(today)) streak++;
    return streak;
}

function calcAvgDuration(entries) {
    const valid = entries.filter(e => typeof e.durationMins === 'number');
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((s, e) => s + e.durationMins, 0) / valid.length);
}

// ── Discord-channel backup (primary) + once-daily Firestore backup ─────────────

function buildFullBackup() {
    // Credit active sessions so current voice time is included
    for (const [uid] of voiceStartTimes) creditVoiceTime(uid);

    const vm = {};
    for (const [uid, d] of voiceMinutes) {
        if (d.total > 0) vm[uid] = { total: d.total, days: Object.fromEntries(d.days) };
    }
    const md = {};
    for (const [uid, dMap] of messageDays) {
        const obj = {};
        for (const [day, count] of dMap) if (count > 0) obj[day] = count;
        if (Object.keys(obj).length) md[uid] = obj;
    }
    const mc = {};
    for (const [uid, count] of messageCounts) if (count > 0) mc[uid] = count;
    const ra = {};
    for (const [uid, ach] of rankAchievements) {
        if (ach.highestRankIdx > 0 || ach.apexCount > 0) ra[uid] = { highestRankIdx: ach.highestRankIdx, apexCount: ach.apexCount };
    }
    const rx = {};
    for (const [uid, rMap] of reactionDays) {
        if (rMap.size > 0) {
            const eMap  = emojiTally.get(uid)        || new Map();
            const edMap = reactionEmojiDays.get(uid) || new Map();
            const emojiObj = {};
            for (const [k, v] of eMap) emojiObj[k] = v;
            const emojiDaysObj = {};
            for (const [day, dayMap] of edMap) {
                const dayObj = {};
                for (const [k, v] of dayMap) dayObj[k] = v;
                emojiDaysObj[day] = dayObj;
            }
            rx[uid] = { days: Object.fromEntries(rMap), emojiTally: emojiObj, emojiDays: emojiDaysObj };
        }
    }
    const vb = {};
    for (const [uid, d] of voiceBonusXp) {
        if (d.total > 0) vb[uid] = { total: d.total, days: Object.fromEntries(d.days) };
    }
    const ai = {};
    for (const [uid, hist] of conversationHistory) {
        if (hist.length > 0) ai[uid] = hist.slice(-20);
    }
    const afk = {};
    for (const [uid, d] of afkUsers) afk[uid] = { reason: d.reason, originalNickname: d.originalNickname, timestamp: d.timestamp };

    return {
        savedAt: new Date().toISOString(),
        voiceMinutes: vm,
        messageDays: md,
        messageCounts: mc,
        rankAchievements: ra,
        reactions: rx,
        voiceBonusXp: vb,
        counting: {
            current: countingState.current || 0,
            record: countingState.record || 0,
            lastUserId: countingState.lastUserId || '',
            wallOfShame: countingState.wallOfShame || [],
        },
        aiHistory: ai,
        afk,
        fitnessData: (() => {
            const fd = {};
            for (const [uid, data] of fitnessData) fd[uid] = { entries: data.entries, notify: data.notify };
            return fd;
        })(),
        workoutRooms: (() => {
            const wr = {};
            for (const [chId, room] of workoutRooms) wr[chId] = { ownerId: room.ownerId, ownerName: room.ownerName, createdAt: room.createdAt };
            return wr;
        })(),
    };
}

async function saveDiscordBackup() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return;
    try {
        const data = buildFullBackup();
        const buf  = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
        const file = new AttachmentBuilder(buf, { name: 'beast-bot-backup.json' });
        const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
        if (_discordBackupMsgId) {
            try {
                const msg = await ch.messages.fetch(_discordBackupMsgId);
                await msg.edit({ content: `💾 \`${data.savedAt}\` — ${Object.keys(data.voiceMinutes).length} users`, files: [file], attachments: [] });
                return;
            } catch (_) { _discordBackupMsgId = null; }
        }
        const sent = await ch.send({ content: `💾 \`${data.savedAt}\` — ${Object.keys(data.voiceMinutes).length} users`, files: [file] });
        _discordBackupMsgId = sent.id;
        console.log('[BeastBot] 💾 Discord backup saved');
    } catch (e) {
        console.error('[BeastBot] Discord backup failed:', e.message);
    }
}

async function loadFromDiscordBackup() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return null;
    try {
        const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
        const msgs = await ch.messages.fetch({ limit: 10 });
        // Find the bot's live backup message with the latest savedAt timestamp
        let bestData = null, bestTime = 0, bestMsgId = null;
        for (const m of msgs.values()) {
            if (m.author.id !== client.user.id) continue;
            const att = m.attachments.find(a => a.name === 'beast-bot-backup.json');
            if (!att) continue;
            try {
                const res = await fetch(att.url);
                if (!res.ok) continue;
                const data = await res.json();
                const t = new Date(data.savedAt).getTime();
                if (t > bestTime) { bestTime = t; bestData = data; bestMsgId = m.id; }
            } catch { continue; }
        }
        if (bestData) {
            _discordBackupMsgId = bestMsgId;
            console.log(`[BeastBot] 📥 Loaded Discord live backup from ${bestData.savedAt}`);
            return bestData;
        }
        return null;
    } catch (e) {
        console.error('[BeastBot] Failed to load Discord backup:', e.message);
        return null;
    }
}

// ── Daily Snapshots ──────────────────────────────────────────────────────────
let _lastDailySnapshotDate = '';

async function saveDailySnapshot() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return;
    const dateStr = todayStr();
    if (_lastDailySnapshotDate === dateStr) return;
    _lastDailySnapshotDate = dateStr;
    try {
        const data = buildFullBackup();
        const buf  = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
        const file = new AttachmentBuilder(buf, { name: `daily-${dateStr}.json` });
        const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
        await ch.send({ content: `📅 Daily Snapshot — ${dateStr}`, files: [file] });
        console.log(`[BeastBot] 📅 Daily snapshot saved for ${dateStr}`);
    } catch (e) {
        console.error('[BeastBot] Daily snapshot failed:', e.message);
        _lastDailySnapshotDate = ''; // retry next cycle
    }
}

async function loadLatestDailySnapshot() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return null;
    try {
        const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
        const msgs = await ch.messages.fetch({ limit: 50 });
        let bestData = null, bestDate = '';
        for (const m of msgs.values()) {
            if (m.author.id !== client.user.id) continue;
            for (const att of m.attachments.values()) {
                const match = att.name.match(/^daily-(\d{4}-\d{2}-\d{2})\.json$/);
                if (!match) continue;
                if (match[1] <= bestDate) continue;
                try {
                    const res = await fetch(att.url);
                    if (!res.ok) continue;
                    const data = await res.json();
                    bestData = data;
                    bestDate = match[1];
                } catch { continue; }
            }
        }
        if (bestData) {
            console.log(`[BeastBot] 📥 Loaded daily snapshot from ${bestDate}`);
        }
        return bestData;
    } catch (e) {
        console.error('[BeastBot] Failed to load daily snapshot:', e.message);
        return null;
    }
}

async function cleanupOldSnapshots() {
    if (!BACKUP_CHANNEL_ID || !client.isReady()) return;
    try {
        const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
        const msgs = await ch.messages.fetch({ limit: 100 });
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        let deleted = 0;
        for (const m of msgs.values()) {
            if (m.author.id !== client.user.id) continue;
            if (!m.content.startsWith('📅 Daily Snapshot') && !m.content.startsWith('📅 WIPE')) continue;
            if (new Date(m.createdTimestamp) < cutoff) {
                await m.delete().catch(() => {});
                deleted++;
            }
        }
        if (deleted > 0) console.log(`[BeastBot] 🗑️ Cleaned up ${deleted} old daily snapshots`);
    } catch (e) {
        console.error('[BeastBot] Snapshot cleanup failed:', e.message);
    }
}

// ── Firestore disaster recovery (Tier 3) ─────────────────────────────────────

async function loadFromFirestoreBackup() {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/fullBackup?key=${FIREBASE_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const doc = await res.json();
        const raw = doc?.fields?.data?.stringValue;
        if (!raw) return null;
        const data = JSON.parse(raw);
        console.log(`[BeastBot] 📥 Loaded Firestore fullBackup from ${data.savedAt || 'unknown'}`);
        return data;
    } catch (e) {
        console.error('[BeastBot] Failed to load Firestore backup:', e.message);
        return null;
    }
}

// ── Unified state loader (3-tier fallback) ───────────────────────────────────

async function loadState() {
    // Tier 1: Discord live backup (most recent, ~60s old)
    let data = await loadFromDiscordBackup();
    if (data) { applyBackupToMemory(data); }
    else {
        // Tier 2: Latest daily snapshot (up to 24h old)
        data = await loadLatestDailySnapshot();
        if (data) { applyBackupToMemory(data); }
        else {
            // Tier 3: Firestore fullBackup doc (disaster recovery)
            data = await loadFromFirestoreBackup();
            if (data) { applyBackupToMemory(data); }
            else {
                console.log('[BeastBot] ⚠️ No backup found — starting fresh');
            }
        }
    }

    // Always load counting quick-save and override if it's newer — this is updated every 3s
    // so it's far more current than the 60s main backup, giving 100% accurate count on restart
    const qData = await loadCountingQuick();
    if (qData) {
        const qTime = new Date(qData.savedAt).getTime();
        const bTime = data ? new Date(data.savedAt || 0).getTime() : 0;
        if (qTime >= bTime) {
            countingState.current    = qData.current || 0;
            countingState.lastUserId = qData.lastUserId || null;
            countingState.record     = qData.record || 0;
            if (Array.isArray(qData.wallOfShame)) {
                if (qData.wallOfShame.length === 0 || typeof qData.wallOfShame[0] === 'object') {
                    countingState.wallOfShame = qData.wallOfShame;
                } else {
                    countingState.wallOfShame = qData.wallOfShame.map(uid => ({ userId: uid, highest: 0 }));
                }
            }
            countingState._loaded    = true;
            console.log(`[BeastBot] 🔢 Counting overridden from quick-save: count=${countingState.current}`);
        }
    }

    return data ? 'discord-live' : 'fresh';
}

// Applies a backup snapshot to in-memory maps (SET — overwrites, backup IS the source of truth)
function applyBackupToMemory(data) {
    if (!data) return;

    // Clear all maps first — backup is the complete state
    voiceMinutes.clear();
    messageDays.clear();
    messageCounts.clear();
    rankAchievements.clear();
    reactionDays.clear();
    emojiTally.clear();
    reactionEmojiDays.clear();
    voiceBonusXp.clear();
    conversationHistory.clear();

    // voiceMinutes
    for (const [uid, snap] of Object.entries(data.voiceMinutes || {})) {
        const days = new Map();
        for (const [day, mins] of Object.entries(snap.days || {})) days.set(day, mins);
        voiceMinutes.set(uid, { total: snap.total || 0, days });
    }
    // messageDays + messageCounts (counts derived from days)
    for (const [uid, days] of Object.entries(data.messageDays || {})) {
        const dMap = new Map();
        let total = 0;
        for (const [day, count] of Object.entries(days)) { dMap.set(day, count); total += count; }
        messageDays.set(uid, dMap);
        messageCounts.set(uid, total);
    }
    // Also apply explicit messageCounts if present (for users with counts but no day breakdown)
    for (const [uid, count] of Object.entries(data.messageCounts || {})) {
        if (!messageCounts.has(uid) || count > messageCounts.get(uid)) messageCounts.set(uid, count);
    }
    // rankAchievements
    for (const [uid, ach] of Object.entries(data.rankAchievements || {})) {
        rankAchievements.set(uid, {
            highestRankIdx: ach.highestRankIdx || 0,
            apexCount: ach.apexCount || 0,
            hitApexThisMonth: false,
        });
    }
    // reactions (days + emojiTally + emojiDays)
    for (const [uid, snap] of Object.entries(data.reactions || {})) {
        const rMap = new Map();
        for (const [day, count] of Object.entries(snap.days || {})) rMap.set(day, count);
        reactionDays.set(uid, rMap);
        if (snap.emojiTally) {
            const eMap = new Map();
            for (const [k, v] of Object.entries(snap.emojiTally)) eMap.set(k, v);
            emojiTally.set(uid, eMap);
        }
        if (snap.emojiDays) {
            const edMap = new Map();
            for (const [day, dayObj] of Object.entries(snap.emojiDays)) {
                const dayMap = new Map();
                for (const [k, v] of Object.entries(dayObj)) dayMap.set(k, v);
                edMap.set(day, dayMap);
            }
            reactionEmojiDays.set(uid, edMap);
        }
    }
    // voiceBonusXp
    for (const [uid, snap] of Object.entries(data.voiceBonusXp || {})) {
        const days = new Map();
        for (const [day, mins] of Object.entries(snap.days || {})) days.set(day, mins);
        voiceBonusXp.set(uid, { total: snap.total || 0, days });
    }
    // counting
    if (data.counting) {
        countingState.current    = data.counting.current || 0;
        countingState.lastUserId = data.counting.lastUserId || null;
        countingState.record     = data.counting.record || 0;
        if (Array.isArray(data.counting.wallOfShame)) {
            // Already new format ({ userId, highest }) or plain userId strings (intermediate migration)
            if (data.counting.wallOfShame.length === 0 || typeof data.counting.wallOfShame[0] === 'object') {
                countingState.wallOfShame = data.counting.wallOfShame;
            } else {
                // Intermediate format: plain userId strings with no highest — set highest=0
                countingState.wallOfShame = data.counting.wallOfShame.map(uid => ({ userId: uid, highest: 0 }));
            }
        } else if (Array.isArray(data.counting.ruinedBy)) {
            // Old format: [{ userId, count, at }] with multiple entries per user
            const map = new Map();
            for (const r of data.counting.ruinedBy) {
                const cur = map.get(r.userId) || 0;
                if ((r.count || 0) > cur) map.set(r.userId, r.count || 0);
            }
            countingState.wallOfShame = [...map.entries()]
                .map(([userId, highest]) => ({ userId, highest }))
                .sort((a, b) => b.highest - a.highest);
        }
        countingState._loaded    = true;
    }
    // AI history
    for (const [uid, hist] of Object.entries(data.aiHistory || {})) {
        conversationHistory.set(uid, hist);
    }
    // AFK state
    afkUsers.clear();
    for (const [uid, d] of Object.entries(data.afk || {})) {
        afkUsers.set(uid, { reason: d.reason, originalNickname: d.originalNickname, timestamp: d.timestamp });
    }
    // Fitness data
    fitnessData.clear();
    for (const [uid, snap] of Object.entries(data.fitnessData || {})) {
        fitnessData.set(uid, { entries: snap.entries || [], notify: snap.notify || null });
    }
    // Workout rooms (channels may no longer exist after restart — cleaned up on startup)
    workoutRooms.clear();
    for (const [chId, snap] of Object.entries(data.workoutRooms || {})) {
        workoutRooms.set(chId, { ownerId: snap.ownerId, ownerName: snap.ownerName, deleteTimer: null, dmMessageId: null, createdAt: snap.createdAt || 0 });
    }

    const voiceTotal = [...voiceMinutes.values()].reduce((s, v) => s + v.total, 0);
    console.log(`[BeastBot] ✅ State loaded: ${voiceMinutes.size} voice, ${messageDays.size} msg, ${rankAchievements.size} rank, ${reactionDays.size} reaction users (${voiceTotal} total voice mins), ${afkUsers.size} AFK`);
}

// Once-per-day Firestore write — writes all collections (not just backups)
async function saveFirestoreDaily() {
    const today = todayStr();
    if (_lastDailyFirestoreDate === today) return;
    _lastDailyFirestoreDate = today;
    console.log('[BeastBot] 📅 Daily Firestore mirror starting...');
    const promises = [];
    // Per-user collections (for admin dashboard reads)
    for (const [uid, data] of voiceMinutes) {
        if (data.total > 0) promises.push(saveVoiceMinutes(uid, { total: data.total, days: Object.fromEntries(data.days) }));
    }
    for (const [uid, ach] of rankAchievements) promises.push(saveRankAchievements(uid, ach));
    for (const [uid, dMap] of messageDays) promises.push(saveMessageDays(uid, dMap));
    // counting is persisted via quick-save on every change — no Firestore write needed here
    // Full backup doc (disaster recovery — Tier 3 fallback)
    const backup = buildFullBackup();
    promises.push(firestoreSet('botConfig', 'fullBackup', {
        data: JSON.stringify(backup),
        savedAt: backup.savedAt,
    }));
    await Promise.allSettled(promises);
    console.log(`[BeastBot] 📅 Daily Firestore mirror done (${promises.length} writes)`);
}

// Update voiceMinutes in-memory for an active session (idempotent — safe to call every minute)
// Returns the updated data object, or null if no active session
function creditVoiceTime(uid) {
    const session = voiceStartTimes.get(uid);
    if (!session) return null;
    const now = Date.now();
    const elapsed = Math.floor((now - session.startMs) / 60000);

    let data = voiceMinutes.get(uid) || { total: 0, days: new Map() };
    data.total = session.baseTotal + elapsed;

    // Restore pre-session per-day state, then split session minutes across calendar days.
    // This ensures overnight sessions credit the correct day — not all to today.
    data.days = new Map(session.baseDays);
    let cursor = session.startMs;
    while (cursor < now) {
        const dayStr = new Date(cursor).toISOString().slice(0, 10);
        const dayEndMs = new Date(dayStr + 'T00:00:00.000Z').getTime() + 86400000;
        const segEnd = Math.min(dayEndMs, now);
        const segMins = Math.floor((segEnd - cursor) / 60000);
        if (segMins > 0) data.days.set(dayStr, (data.days.get(dayStr) || 0) + segMins);
        cursor = dayEndMs;
    }

    voiceMinutes.set(uid, data);
    return data;
}

// Returns the most-used emoji key for a given userId and period by aggregating reactionEmojiDays
function getTopEmojiForPeriod(userId, period) {
    const edMap = reactionEmojiDays.get(userId);
    if (!edMap || edMap.size === 0) return null;
    const today = todayStr();
    const aggregate = new Map();
    for (const [day, emojiMap] of edMap) {
        let include = false;
        if (period === 'all') include = true;
        else if (period === 'today') include = day === today;
        else if (period === 'month') include = day.startsWith(today.slice(0, 7));
        else if (period === 'week') {
            const d = new Date();
            for (let i = 0; i < 7; i++) {
                if (d.toISOString().slice(0, 10) === day) { include = true; break; }
                d.setDate(d.getDate() - 1);
            }
        }
        if (!include) continue;
        for (const [emoji, count] of emojiMap) {
            aggregate.set(emoji, (aggregate.get(emoji) || 0) + count);
        }
    }
    if (aggregate.size === 0) return null;
    let best = null, bestN = 0;
    for (const [emoji, count] of aggregate) { if (count > bestN) { bestN = count; best = emoji; } }
    return best;
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

    // Every 10 messages: sync rank (messages contribute to activity score)
    // Data persisted via Discord backup every 60s — no per-message Firestore writes
    if (count % 10 === 0) {
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

// ── Fitness Workout Room logic ────────────────────────────────────────────────

async function createWorkoutRoom(state) {
    const member     = state.member;
    const guild      = state.guild;
    const trigger    = guild.channels.cache.get(FITNESS_VC_TRIGGER_ID);
    const categoryId = trigger?.parentId || null;
    const channelName = `${member.displayName}'s Workout 🏋️`;

    // Guard: user already owns a room → move them there
    for (const [chId, room] of workoutRooms) {
        if (room.ownerId === member.id) {
            const existing = guild.channels.cache.get(chId);
            if (existing) { await member.voice.setChannel(existing).catch(() => {}); return; }
            workoutRooms.delete(chId);
        }
    }

    try {
        const permOverwrites = [
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers,
                    PermissionFlagsBits.PrioritySpeaker, PermissionFlagsBits.Stream,
                    PermissionFlagsBits.Speak, PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.UseVAD,
                    PermissionFlagsBits.SendMessages,
                ],
            },
            {
                id: client.user.id,
                allow: [
                    PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                ],
            },
        ];
        if (MOD_ROLE_ID) {
            permOverwrites.push({ id: MOD_ROLE_ID, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak, PermissionFlagsBits.SendMessages] });
        }
        const guildOwner = await guild.fetchOwner().catch(() => null);
        if (guildOwner && guildOwner.id !== member.id) {
            permOverwrites.push({ id: guildOwner.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak, PermissionFlagsBits.SendMessages] });
        }

        const workoutChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: categoryId,
            permissionOverwrites: permOverwrites,
            reason: `Workout room for ${member.user.tag}`,
        });

        await member.voice.setChannel(workoutChannel);

        workoutRooms.set(workoutChannel.id, { ownerId: member.id, ownerName: member.displayName, deleteTimer: null, dmMessageId: null, createdAt: Date.now() });

        // DM owner with setup buttons
        try {
            const dmUser = await client.users.fetch(member.id);
            const dmRow  = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fitness:room:rename').setLabel('✏️ Rename Session').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('fitness:room:limit').setLabel('👥 Set User Limit').setStyle(ButtonStyle.Secondary),
            );
            const dmMsg = await dmUser.send({
                embeds: [{
                    color: 0x22c55e,
                    title: '🏋️ Your Workout Room is Ready!',
                    description: `**${channelName}** has been created. It auto-deletes 60 seconds after everyone leaves.\n\nUse the buttons below to customise your session.`,
                    footer: { text: 'These buttons work until the channel is deleted.' },
                }],
                components: [dmRow],
            });
            workoutRooms.get(workoutChannel.id).dmMessageId = dmMsg.id;
        } catch (_) {}

        // Announce in #discussions
        try {
            const discuss = await client.channels.fetch(FITNESS_DISCUSS_CHANNEL_ID);
            await discuss.send({ embeds: [{ color: 0x22c55e, description: `🏋️ **${member.displayName}** just opened a workout session! Jump into **${channelName}** to sweat together.`, timestamp: new Date().toISOString() }] });
        } catch (_) {}

        console.log(`[BeastBot] 🏋️ Workout room created: "${channelName}" for ${member.user.tag}`);
    } catch (e) {
        console.error('[BeastBot] Failed to create workout room:', e.message);
    }
}

async function playWorkoutAlarm(guild, userId) {
    if (!ALARM_OGG) { console.log('[BeastBot] alarm: ❌ Alarm audio buffer not ready'); return false; }
    try {
        const member = await guild.members.fetch(userId);
        const voiceChannel = member.voice?.channel;
        if (!voiceChannel) { console.log('[BeastBot] alarm: ❌ User is not in a voice channel'); return false; }
        console.log(`[BeastBot] alarm: 📡 Joining VC: ${voiceChannel.name}`);
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
        });
        connection.on('error', (err) => {
            console.log(`[BeastBot] alarm: ❌ Connection error: ${err.message}`);
            try { connection.destroy(); } catch (_) {}
        });
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        } catch (e) {
            console.log(`[BeastBot] alarm: ❌ Never became ready after 15s: ${e.message}`);
            try { connection.destroy(); } catch (_) {}
            return false;
        }
        console.log('[BeastBot] alarm: ✅ Voice ready — playing audio (3x)');
        const player = createAudioPlayer();
        connection.subscribe(player);
        player.on('error', (err) => {
            console.log(`[BeastBot] alarm: ❌ Player error: ${err.message}`);
            try { connection.destroy(); } catch (_) {}
        });
        let playsLeft = 2;
        const playNext = () => {
            const resource = createAudioResource(Readable.from([ALARM_OGG]), { inputType: StreamType.OggOpus });
            player.play(resource);
        };
        const onIdle = () => {
            playsLeft--;
            if (playsLeft > 0) {
                playNext();
            } else {
                console.log('[BeastBot] alarm: ✅ Audio finished (2x) — leaving VC');
                player.off(AudioPlayerStatus.Idle, onIdle);
                try { connection.destroy(); } catch (_) {}
            }
        };
        player.on(AudioPlayerStatus.Idle, onIdle);
        playNext();
        return true;
    } catch (e) {
        console.log(`[BeastBot] alarm: ❌ playWorkoutAlarm threw: ${e.message}`);
        return false;
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

// Keep member name cache fresh + log mod actions
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!newMember.user.bot) {
        memberNameCache.set(newMember.id, newMember.displayName);
        memberCache.set(newMember.id, {
            displayName: newMember.displayName,
            avatarUrl: newMember.user.displayAvatarURL({ size: 128, extension: 'png' }),
        });
    }

    const user = newMember.user;

    // Timeout / mute detection
    const wasTimedOut = oldMember.communicationDisabledUntilTimestamp && oldMember.communicationDisabledUntilTimestamp > Date.now();
    const isTimedOut  = newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now();
    if (!wasTimedOut && isTimedOut) {
        const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, user.id, 8000);
        const until = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;
        await sendLog(newMember.guild, buildLogEmbed({
            color: LOG_COLORS.mute, user,
            description: `🔇 <@${user.id}> **was muted** (expires ${until})`,
            footerExtra: entry ? `Muted by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` : '',
        }));
    } else if (wasTimedOut && !isTimedOut) {
        const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, user.id, 8000);
        await sendLog(newMember.guild, buildLogEmbed({
            color: LOG_COLORS.join, user,
            description: `🔊 <@${user.id}> **was unmuted**`,
            footerExtra: entry ? `Unmuted by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` : '',
        }));
    }

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
        const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberUpdate, user.id, 8000);
        await sendLog(newMember.guild, buildLogEmbed({
            color: LOG_COLORS.nick, user,
            description: `📝 <@${user.id}> **nickname changed**`,
            fields: [
                { name: 'Before', value: oldMember.nickname || user.username, inline: true },
                { name: 'After',  value: newMember.nickname || user.username, inline: true },
            ],
            footerExtra: entry ? `Changed by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` : '',
        }));
    }

    // Roles changed
    const addedRoles   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && r.name !== '@everyone');
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && r.name !== '@everyone');
    if (addedRoles.size > 0 || removedRoles.size > 0) {
        const fields = [];
        if (addedRoles.size > 0)   fields.push({ name: '✅ Added roles',   value: addedRoles.map(r => r.name).join('\n') });
        if (removedRoles.size > 0) fields.push({ name: '❌ Removed roles', value: removedRoles.map(r => r.name).join('\n') });
        await sendLog(newMember.guild, buildLogEmbed({
            color: LOG_COLORS.role, user,
            description: `⚔️ <@${user.id}> **roles have changed**`,
            fields,
        }));
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
    if (trackingMember && !trackingMember.user.bot && botFeatures.vcTracking !== false) {
        const uid = trackingMember.id;
        // Session end: left a real channel
        if (oldCh && oldCh !== AFK_CHANNEL_ID && voiceStartTimes.has(uid)) {
            const sess = voiceStartTimes.get(uid);
            const finalData = creditVoiceTime(uid);
            voiceStartTimes.delete(uid);
            voiceEnhancements.delete(uid);
            if (finalData && sess) {
                const currentElapsed = Math.floor((Date.now() - sess.startMs) / 60000);
                const delta = currentElapsed - (sess.savedElapsed || 0);
                assignVoiceRank(trackingMember, monthlyActivityScore(uid)).catch(() => {});
            }
        }
        // Session start: joined a real channel (not AFK, not trigger, not no-XP)
        if (newCh && newCh !== AFK_CHANNEL_ID && newCh !== TEMP_VC_TRIGGER_ID && newCh !== FITNESS_VC_TRIGGER_ID && !NO_XP_VC_IDS.has(newCh)) {
            const existing = voiceMinutes.get(uid) || { total: 0, days: new Map() };
            voiceStartTimes.set(uid, {
                startMs: Date.now(),
                baseTotal: existing.total,
                baseDays: new Map(existing.days),
                savedElapsed: 0,
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

    // ── Someone joined the fitness VC trigger → create their workout room ─────
    if (newCh === FITNESS_VC_TRIGGER_ID) {
        await createWorkoutRoom(newState);
        return;
    }

    // ── Someone joined an existing workout room → cancel its delete timer ─────
    if (newCh && workoutRooms.has(newCh)) {
        const room = workoutRooms.get(newCh);
        if (room.deleteTimer) { clearTimeout(room.deleteTimer); room.deleteTimer = null; workoutRooms.set(newCh, room); }
    }

    // ── Someone left a workout room → if empty, start 60s delete timer ────────
    if (oldCh && workoutRooms.has(oldCh)) {
        const vcChannel = newState.guild.channels.cache.get(oldCh);
        const room = workoutRooms.get(oldCh);
        if ((vcChannel?.members.size ?? 0) === 0) {
            if (room.deleteTimer) clearTimeout(room.deleteTimer);
            room.deleteTimer = setTimeout(async () => {
                try {
                    const ch = client.channels.cache.get(oldCh);
                    if (ch) await ch.delete('Workout room: empty for 60s');
                } catch (_) {}
                workoutRooms.delete(oldCh);
            }, 60 * 1000);
            workoutRooms.set(oldCh, room);
        }
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

    // ── Voice channel join / leave logging ───────────────────────────────────
    if (!newState.member?.user?.bot) {
        const joined = !oldState.channelId && newState.channelId;
        const left   = oldState.channelId && !newState.channelId;
        const moved  = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
        if ((joined || moved) && newState.channel) {
            await sendLog(newState.guild, buildLogEmbed({
                color: LOG_COLORS.join,
                user: newState.member.user,
                description: `📥 <@${newState.member.id}> **joined voice channel** \`${newState.channel.name}\``,
            }));
        }
        if ((left || moved) && oldState.channel) {
            await sendLog(oldState.guild, buildLogEmbed({
                color: LOG_COLORS.leave,
                user: oldState.member.user,
                description: `📤 <@${oldState.member.id}> **left voice channel** \`${oldState.channel.name}\``,
            }));
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

// forceReset=true is used ONLY by the monthly reset — bypasses the no-demote guard
// and strips all rank roles so everyone starts the new month at Bronze I.
async function assignVoiceRank(member, xp, forceReset = false) {
    if (voiceRankRoleCache.size === 0) return;
    let targetIdx = 0;
    for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
        if (xp >= VOICE_RANK_ROLES[i].minXp) targetIdx = i;
    }

    if (!forceReset) {
        // During normal operation ranks NEVER go down — only upgrade
        let currentHighestIdx = -1;
        for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
            const r = voiceRankRoleCache.get(VOICE_RANK_ROLES[i].name);
            if (r && member.roles.cache.has(r.id) && i > currentHighestIdx) currentHighestIdx = i;
        }
        if (targetIdx <= currentHighestIdx) return; // already at or above target
    }

    const targetRank = VOICE_RANK_ROLES[targetIdx];
    const targetRole = voiceRankRoleCache.get(targetRank.name);
    if (!targetRole) return;

    if (forceReset) {
        // Monthly reset: strip ALL rank roles, then assign Bronze I
        for (const rankRole of voiceRankRoleCache.values()) {
            if (rankRole.id !== targetRole.id && member.roles.cache.has(rankRole.id)) {
                await member.roles.remove(rankRole).catch(() => {});
            }
        }
    } else {
        // Normal upgrade: only remove lower rank badges
        for (let i = 0; i < targetIdx; i++) {
            const lowerRole = voiceRankRoleCache.get(VOICE_RANK_ROLES[i].name);
            if (lowerRole && member.roles.cache.has(lowerRole.id)) {
                await member.roles.remove(lowerRole).catch(() => {});
            }
        }
    }

    if (!member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole).catch(e => console.error('[BeastBot] assignVoiceRank failed:', e.message));
        // Rank-up notification in bot-commands channel (skip Bronze I — reset & new joins)
        if (!forceReset && targetIdx > 0 && botFeatures.rankUpNotifications !== false) {
            try {
                const rankColors = {
                    '🥉 Bronze': 0xcd7f32, '🥈 Silver': 0xc0c0c0, '🥇 Gold': 0xffd700,
                    '💠 Platinum': 0x00bcd4, '💎 Diamond': 0x00e5ff, '🔥 Master': 0xff5722,
                    '⚔️ Grandmaster': 0x9c27b0, '👑 Apex Predator': 0xf44336,
                };
                const color = Object.entries(rankColors).find(([k]) => targetRank.name.includes(k.split(' ')[1] || k))?.[1] || 0xf59e0b;
                const notifCh = await client.channels.fetch(BUMP_CHANNEL_ID);
                await notifCh.send({
                    content: `<@${member.id}>`,
                    embeds: [{
                        title: '🎉 Rank Up!',
                        description: `**${member.displayName}** just ranked up to **${targetRank.name}**!\nKeep it up — the grind is paying off.`,
                        color,
                        timestamp: new Date().toISOString(),
                    }],
                });
            } catch (_) {}
        }
    }
    // Track achievements: highest rank ever + Apex hits (skip during reset — XP is 0)
    if (!forceReset) {
        const ach = rankAchievements.get(member.id) || { highestRankIdx: 0, apexCount: 0, hitApexThisMonth: false };
        let changed = false;
        if (targetIdx > ach.highestRankIdx) { ach.highestRankIdx = targetIdx; changed = true; }
        if (targetIdx === VOICE_RANK_ROLES.length - 1 && !ach.hitApexThisMonth) { ach.hitApexThisMonth = true; changed = true; }
        if (changed) { rankAchievements.set(member.id, ach); } // persisted via Discord backup + daily Firestore
    }
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
            return `${prefix} **${member.displayName}** - ${display}`;
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

async function checkMonthlyReset(guild, fromStartup = false) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    let stored = _cachedCurrentMonth;

    // On startup, load from Firestore once and populate the in-memory cache
    if (fromStartup) {
        try {
            const doc = await firestoreGet('botConfig', 'currentMonth');
            stored = doc?.month || null;
        } catch (_) {}
        _cachedCurrentMonth = stored;
    }

    if (stored === currentMonth) return;
    // Only wipe roles if we have a valid previous month — if stored is null (first run / migration),
    // just record the current month without resetting anyone.
    if (stored && /^\d{4}-\d{2}$/.test(stored)) {
        await postMonthlyRecap(guild, stored);
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
                }
                if (!member.roles.cache.some(r => allRankIds.includes(r.id))) continue;
                await assignVoiceRank(member, 0, true).catch(() => {}); // forceReset — monthly wipe
            }
        } catch (e) { console.error('[BeastBot] Monthly reset role assignment failed:', e.message); }
    } else {
        console.log(`[BeastBot] No prior month stored — skipping role wipe (first run or migration)`);
    }
    await firestoreSet('botConfig', 'currentMonth', { month: currentMonth });
    _cachedCurrentMonth = currentMonth;
    console.log(`[BeastBot] Monthly reset complete — now tracking ${currentMonth}`);
}

// ── Ranks info embed ──────────────────────────────────────────────────────────

function buildRanksEmbed() {
    const rankLines = VOICE_RANK_ROLES.map(r => {
        const xp = r.minXp === 0 ? '0 XP' : `${r.minXp.toLocaleString()} XP`;
        return `${r.name} - **${xp}**`;
    }).join('\n');

    return {
        color: 0xFFD700,
        title: '🏆 TrueBeast Ranking System',
        description: 'Earn XP by being active in the server. Ranks **reset to Bronze I** on the 1st of every month, but your peak rank and Apex Predator count are tracked forever.',
        fields: [
            {
                name: '📊 Ranks & XP Thresholds',
                value: rankLines,
            },
            {
                name: '🎙️ How to Earn XP',
                value: [
                    '**Voice chat** - 1 XP per minute',
                    '**Camera on** - +1 XP per minute (2 XP/min total)',
                    '**Screen share** - +1 XP per minute (2 XP/min total)',
                    '**Camera + screen share** - +2 XP per minute (3 XP/min total)',
                    '**Messages** - 1 XP per message sent',
                    '**Reactions** - 1 XP per reaction you add',
                    '*Same rules apply to stage channels.*',
                ].join('\n'),
            },
            {
                name: '🏅 Peak Rank & Apex Count',
                value: 'Your highest rank ever achieved is shown on your `/me` profile card, along with how many times you\'ve hit 👑 **Apex Predator**. These never reset.',
            },
            {
                name: '📈 Track Your Progress',
                value: 'Use `/me` or `/profile` to view your full stats card, XP bar, rank progress, peak rank, and Apex count.',
            },
        ],
        footer: { text: 'Ranks reset on the 1st of each month - good luck!' },
    };
}

// ── Leaderboard helpers ───────────────────────────────────────────────────────

function buildLeaderboardTitle(type, period) {
    const typeStr   = type === 'msg' ? 'Messages' : type === 'xp' ? 'XP' : 'Voice Chat';
    const periodStr = type === 'xp' ? 'This Month' : ({ today: 'Today', week: 'This Week', month: 'This Month', all: 'All Time' }[period]);
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
        new ButtonBuilder().setCustomId(`lbt:xp:month`).setLabel('⭐ XP').setStyle(activeType === 'xp' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbt:vc:${activePeriod}`).setLabel('🎙️ Voice Chat').setStyle(activeType === 'vc' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`lbt:msg:${activePeriod}`).setLabel('📩 Messages').setStyle(activeType === 'msg' ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    const periodRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lbp:${activeType}:today`).setLabel('Today').setStyle(activePeriod === 'today' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(activeType === 'xp'),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:week`).setLabel('This Week').setStyle(activePeriod === 'week' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(activeType === 'xp'),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:month`).setLabel('This Month').setStyle(activePeriod === 'month' || activeType === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(activeType === 'xp'),
        new ButtonBuilder().setCustomId(`lbp:${activeType}:all`).setLabel('All Time').setStyle(activePeriod === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lbn:${activeType}:${activePeriod}:${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId('lbx').setLabel(`Page ${page + 1} of ${Math.max(1, totalPages)}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`lbn:${activeType}:${activePeriod}:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        new ButtonBuilder().setCustomId('lbclose').setLabel('✕ Close').setStyle(ButtonStyle.Danger),
    );
    const infoRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lbranks').setLabel('❓ Help').setStyle(ButtonStyle.Primary),
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
    } else if (type === 'xp') {
        for (const [userId] of memberNameCache) {
            const value = monthlyActivityScore(userId);
            if (value > 0) entries.push({ userId, value });
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

function getXpRankLabel(xp) {
    let idx = 0;
    for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
        if (xp >= VOICE_RANK_ROLES[i].minXp) idx = i;
    }
    return stripEmoji(VOICE_RANK_ROLES[idx].name).trim();
}

function formatScore(value, type) {
    if (type === 'vc') return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`;
    if (type === 'xp') return `${getXpRankLabel(value)}  ·  ${value.toLocaleString()} XP`;
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
    let mult = 1.0;
    if (e.camera) mult += 1.0;   // +1 XP/min for camera
    if (e.stream) mult += 1.0;   // +1 XP/min for screen share
    return mult;                  // max 3 XP/min (base + camera + stream)
}

function monthlyActivityScore(userId) {
    // Flush live session so the score always reflects current earned minutes
    if (voiceStartTimes.has(userId)) creditVoiceTime(userId);
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

// Loads an emoji image for canvas rendering — handles both unicode (Twemoji) and
// custom Discord emoji (fetched from Discord CDN by ID).
async function loadEmojiImageByKey(emojiKey) {
    if (!emojiKey) return null;
    const customMatch = emojiKey.match(/^<a?:([^:]+):(\d+)>$/);
    if (customMatch) {
        const id = customMatch[2];
        const cacheKey = `discord:${id}`;
        if (emojiImageCache.has(cacheKey)) return emojiImageCache.get(cacheKey);
        try {
            const img = await loadImage(`https://cdn.discordapp.com/emojis/${id}.png`);
            emojiImageCache.set(cacheKey, img);
            return img;
        } catch { emojiImageCache.set(cacheKey, null); return null; }
    }
    return loadEmojiImage(emojiKey);
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

async function generateProfileImage(userId, guild = null) {
    const info      = memberCache.get(userId) || { displayName: 'Unknown', avatarUrl: null };
    const msgCount  = messageCounts.get(userId) || 0;
    const msgDMap   = messageDays.get(userId) || new Map();
    const vcData    = voiceMinutes.get(userId) || { total: 0, days: new Map() };
    const rxDMap    = reactionDays.get(userId) || new Map();
    const rxTotal   = [...rxDMap.values()].reduce((a, b) => a + b, 0);

    const activityScore = monthlyActivityScore(userId);

    // Read rank from the member's actual Discord roles (authoritative — never wrong due to stale XP).
    // Falls back to XP calculation only if the guild/roles aren't available.
    let rankIdx = 0;
    let rankFromRoles = false;
    if (guild && voiceRankRoleCache.size > 0) {
        const member = guild.members.cache.get(userId);
        if (member) {
            let roleIdx = -1;
            for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
                const r = voiceRankRoleCache.get(VOICE_RANK_ROLES[i].name);
                if (r && member.roles.cache.has(r.id) && i > roleIdx) roleIdx = i;
            }
            if (roleIdx >= 0) { rankIdx = roleIdx; rankFromRoles = true; }
        }
    }
    if (!rankFromRoles) {
        for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
            if (activityScore >= VOICE_RANK_ROLES[i].minXp) rankIdx = i;
        }
    }

    const currentRank = VOICE_RANK_ROLES[rankIdx];
    const nextRank    = VOICE_RANK_ROLES[rankIdx + 1] || null;
    // Clamp progress to [0, 1] — activityScore may be below currentRank.minXp if roles loaded
    // from Discord but XP data hasn't fully loaded yet (quota failure, etc.)
    const progress    = nextRank
        ? Math.min(1, Math.max(0, (activityScore - currentRank.minXp) / (nextRank.minXp - currentRank.minXp)))
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
    const COL1 = 185, COL2 = 190, COL3 = 200, COL4 = 155;
    const panelW = COL1 + COL2 + COL3 + COL4; // 730 — same total width as 3-col layout

    // Peak rank + Apex count — right-aligned, vertically centred with rank pill
    const ach = rankAchievements.get(userId) || { highestRankIdx: 0, apexCount: 0, hitApexThisMonth: false };
    // If the current Discord role rank is higher than the stored peak (e.g. rankAchievements failed
    // to load due to quota, or the peak was never saved), update it now so it's never wrong.
    if (rankIdx > ach.highestRankIdx) {
        ach.highestRankIdx = rankIdx;
        rankAchievements.set(userId, ach);
    }
    // apexCount is finalised at month-end. Show +1 if they currently hold Apex Predator,
    // regardless of the hitApexThisMonth flag (which resets to false on every bot restart).
    const isCurrentlyApex = rankIdx === VOICE_RANK_ROLES.length - 1;
    const displayApexCount = ach.apexCount + (ach.hitApexThisMonth || isCurrentlyApex ? 1 : 0);
    const peakRank  = VOICE_RANK_ROLES[Math.max(ach.highestRankIdx, rankIdx)];
    const peakEmoji = extractFirstEmoji(peakRank.name);
    const peakClean = stripEmoji(peakRank.name);
    const EPEAK = 24, ECROWN = 22;
    ctx.font = '20px "Noto Sans", sans-serif';
    const apexPrefix  = '   ·   Apex ×  ';
    const apexPrefixW = ctx.measureText(apexPrefix).width;
    ctx.font = 'bold 20px "Noto Sans", sans-serif';
    const apexCountW  = ctx.measureText(String(displayApexCount)).width;
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
    ctx.fillText(String(displayApexCount), pkX, pkY);

    // Stats grid
    const GY   = 175;

    // Subtle stats panel bg
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(CX - 16, GY - 10, panelW + 32, 280, 12); ctx.fill();

    // Column center x positions for centered layout
    const C1 = CX + COL1 / 2;
    const C2 = CX + COL1 + COL2 / 2;
    const C3 = CX + COL1 + COL2 + COL3 / 2;
    const C4 = CX + COL1 + COL2 + COL3 + COL4 / 2;

    // Column headers — all center-aligned
    ctx.font = 'bold 18px Noto Sans, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText('PERIOD',     C1, GY);
    ctx.fillText('MESSAGES',   C2, GY);
    ctx.fillText('VOICE CHAT', C3, GY);
    ctx.fillText('REACTIONS',  C4, GY);
    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX - 16, GY + 26); ctx.lineTo(CX + panelW + 16, GY + 26); ctx.stroke();

    // Pre-load per-period emoji images for the reaction column
    const EMOJI_SIZE = 26;
    const EMOJI_GAP  = 7;
    const rowEmojiImgs = await Promise.all(
        ['today', 'week', 'month', 'all'].map(p => loadEmojiImageByKey(getTopEmojiForPeriod(userId, p)))
    );

    const statRows = [
        { label: 'Today',      msg: getTotal(msgDMap, msgCount, 'today'),  vc: getTotal(vcData.days, vcData.total, 'today'),  rx: getTotal(rxDMap, rxTotal, 'today')  },
        { label: 'This Week',  msg: getTotal(msgDMap, msgCount, 'week'),   vc: getTotal(vcData.days, vcData.total, 'week'),   rx: getTotal(rxDMap, rxTotal, 'week')   },
        { label: 'This Month', msg: getTotal(msgDMap, msgCount, 'month'),  vc: getTotal(vcData.days, vcData.total, 'month'),  rx: getTotal(rxDMap, rxTotal, 'month')  },
        { label: 'All Time',   msg: getTotal(msgDMap, msgCount, 'all'),    vc: getTotal(vcData.days, vcData.total, 'all'),    rx: getTotal(rxDMap, rxTotal, 'all')    },
    ];

    statRows.forEach(({ label, msg, vc, rx }, i) => {
        const rY = GY + 38 + i * 56;
        const rxEmojiImg = rowEmojiImgs[i];

        // PERIOD label
        ctx.font = '23px Noto Sans, sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';
        ctx.fillText(label, C1, rY);

        // MESSAGES
        ctx.font = 'bold 26px Noto Sans, sans-serif';
        ctx.fillStyle = msg > 0 ? '#ffffff' : '#374151';
        ctx.fillText(msg.toLocaleString(), C2, rY);

        // VOICE CHAT
        ctx.fillStyle = vc > 0 ? '#ffffff' : '#374151';
        ctx.fillText(formatScore(vc, 'vc'), C3, rY);

        // REACTIONS + per-period emoji — centered as a unit
        ctx.fillStyle = rx > 0 ? '#ffffff' : '#374151';
        const rxStr = rx.toLocaleString();
        if (rxEmojiImg) {
            const countW = ctx.measureText(rxStr).width;
            const totalW = countW + EMOJI_GAP + EMOJI_SIZE;
            const startX = C4 - totalW / 2;
            ctx.textAlign = 'left';
            ctx.fillText(rxStr, startX, rY);
            ctx.drawImage(rxEmojiImg, startX + countW + EMOJI_GAP, rY, EMOJI_SIZE, EMOJI_SIZE);
        } else {
            ctx.fillText(rxStr, C4, rY);
        }
    });
    ctx.textAlign = 'left'; // reset

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

    // Load all images in parallel with a 5s timeout each
    const loadImageTimeout = (url) => Promise.race([
        loadImage(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('loadImage timeout')), 5000)),
    ]);
    const tryLoad = (url) => url ? loadImageTimeout(url).catch(() => null) : Promise.resolve(null);

    const avatarUrl = imagePosition === 'left' && !imageUrl
        ? client.user.displayAvatarURL({ size: 128, extension: 'png' }) : null;
    const [featuredImg, mainImg, logoImg] = await Promise.all([
        tryLoad(featuredImageUrl),
        tryLoad(imageUrl) .then(img => img || tryLoad(avatarUrl)),
        tryLoad(logoUrl),
    ]);

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
let cardPollRunning = false;

async function firestoreDeleteCard(docId) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/discordCards/${docId}?key=${FIREBASE_API_KEY}`;
    try { await fetch(url, { method: 'DELETE' }); } catch (e) { console.error('[BeastBot] firestoreDeleteCard failed:', e.message); }
}

async function pollDiscordCards() {
    if (botFeatures.discordCards === false) { console.log('[BeastBot] Discord Cards disabled — skipping poll'); return; }
    if (cardPollRunning) { return; }
    cardPollRunning = true;
    try {
        // Structured query — only fetch 'pending' cards (avoids reading all sent/failed docs)
        const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
        const res = await fetch(queryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId: 'discordCards' }],
                where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
                limit: 10,
            }}),
        });
        if (!res.ok) { console.error('[BeastBot] pollDiscordCards: Firestore query failed HTTP', res.status); return; }
        const rows = await res.json();
        const docs = rows.map(r => r.document).filter(Boolean);
        if (docs.length) console.log(`[BeastBot] pollDiscordCards: ${docs.length} pending card(s) found`);
        for (const doc of docs) {
            const f = doc.fields || {};
            const docId = doc.name.split('/').pop();
            const status = f.status?.stringValue;

            if (processedCardIds.has(docId)) continue;
            if (status !== 'pending') continue;

            // Mark in-session dedup immediately (prevents double-send if poll overlaps)
            processedCardIds.add(docId);
            console.log(`[BeastBot] Processing card ${docId}...`);

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
                await Promise.race([
                    (async () => {
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
                // Delete from Firestore after successful post — keeps collection empty = zero reads on next poll
                await firestoreDeleteCard(docId);
                console.log(`[BeastBot] Discord card posted to ${channelId}: "${title}"`);
                    })(),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Card processing timed out after 30s')), 30000)),
                ]);
            } catch (e) {
                console.error('[BeastBot] Failed to post Discord card:', e.stack || e.message);
                processedCardIds.delete(docId); // allow retry on next restart
                await firestoreDeleteCard(docId); // remove failed card too — prevents stuck docs burning reads
            }
        }
    } catch (e) {
        console.error('[BeastBot] pollDiscordCards error:', e.stack || e.message);
    } finally {
        cardPollRunning = false;
    }
}

// ── Bot Ready ─────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
    console.log(`[BeastBot] ✅  Logged in as ${client.user.tag}`);
    console.log(`[BeastBot] Monitoring channel(s): ${CHANNEL_IDS.join(', ')}`);
    console.log(`[BeastBot] Steam: ${STEAM_API_KEY ? 'enabled' : 'no API key yet'}`);
    // Log restart to logs channel
    try {
        const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
        await logCh.send(`🔄 **Beast Bot restarted** — ${new Date().toUTCString()}\nReason: deployment update`);
    } catch (_) {}

    // ── Load state: Discord backup → daily snapshot → Firestore → fresh ─────
    const stateSource = await loadState();
    console.log(`[BeastBot] State loaded from: ${stateSource}`);

    // One-time wall of shame restore — seed historical data if nothing loaded
    if (countingState.record === 0 && countingState.wallOfShame.length === 0) {
        console.log('[BeastBot] Seeding wall of shame from historical data...');
        countingState.record = 343;
        countingState.wallOfShame = [
            { userId: '753575707329822850', highest: 343 }, // Ammar
            { userId: '392450364340830208', highest: 304 }, // TrueBeast
            { userId: '712687124293615658', highest: 282 }, // anetaspageta98
            { userId: '803881574587957258', highest: 55  }, // Tom
            { userId: '518420185913229314', highest: 52  }, // MarsKooty
        ];
        console.log(`[BeastBot] ✅ Wall of shame seeded: record=${countingState.record}, ${countingState.wallOfShame.length} entries`);
    }

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
        await checkMonthlyReset(guild, true).catch(e => console.error('[BeastBot] checkMonthlyReset failed:', e.message));


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

        // Self-heal rankAchievements from current Discord roles.
        // If a member has a rank role higher than what's stored (e.g. data was wiped),
        // update the stored peak to match their current role — no manual data entry needed.
        try {
            let healed = 0;
            const rankRoleIds = VOICE_RANK_ROLES.map(r => r.id);
            for (const [, member] of guild.members.cache) {
                if (member.user.bot) continue;
                // Find the highest rank role this member currently has
                let currentRankIdx = 0;
                for (let i = 0; i < VOICE_RANK_ROLES.length; i++) {
                    if (member.roles.cache.has(VOICE_RANK_ROLES[i].id)) currentRankIdx = i;
                }
                const ach = rankAchievements.get(member.id) || { highestRankIdx: 0, apexCount: 0, hitApexThisMonth: false };
                if (currentRankIdx > ach.highestRankIdx) {
                    ach.highestRankIdx = currentRankIdx;
                    rankAchievements.set(member.id, ach);
                    healed++;
                }
            }
            if (healed > 0) console.log(`[BeastBot] Self-healed rankAchievements for ${healed} members from Discord roles`);
        } catch (e) { console.error('[BeastBot] rankAchievements self-heal failed:', e.message); }

        // Restore AFK state from member nicknames — catches anyone whose AFK wasn't in backup
        try {
            let afkRestored = 0;
            for (const [, member] of guild.members.cache) {
                if (member.user.bot) continue;
                if (!member.displayName.startsWith('[AFK]')) continue;
                if (afkUsers.has(member.id)) continue; // already restored from backup
                const originalNickname = member.displayName.replace(/^\[AFK\]\s*/, '');
                afkUsers.set(member.id, { reason: 'AFK', originalNickname, timestamp: Date.now() });
                afkRestored++;
            }
            if (afkRestored > 0) console.log(`[BeastBot] Restored ${afkRestored} AFK users from nicknames`);
        } catch (e) { console.error('[BeastBot] AFK nickname restore failed:', e.message); }

        // Pre-warm emoji image cache for rank pill rendering
        Promise.all(VOICE_RANK_ROLES.map(r => {
            const e = extractFirstEmoji(r.name);
            return e ? loadEmojiImage(e) : null;
        })).then(() => console.log('[BeastBot] Emoji image cache warmed'));
        setInterval(() => checkMonthlyReset(guild).catch(() => {}), 60 * 60 * 1000);

        // Resume tracking for members already in voice channels
        guild.channels.cache
            .filter(ch => (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) && ch.id !== AFK_CHANNEL_ID && ch.id !== TEMP_VC_TRIGGER_ID && !NO_XP_VC_IDS.has(ch.id))
            .forEach(ch => ch.members.forEach(member => {
                if (!member.user.bot) {
                    const existing = voiceMinutes.get(member.id) || { total: 0, days: new Map() };
                    voiceStartTimes.set(member.id, {
                        startMs: Date.now(),
                        baseTotal: existing.total,
                        baseDays: new Map(existing.days),
                        savedElapsed: 0,
                    });
                    voiceEnhancements.set(member.id, {
                        camera: member.voice.selfVideo || false,
                        stream: member.voice.selfStream || false,
                        inStage: ch.type === ChannelType.GuildStageVoice,
                    });
                }
            }));
        console.log(`[BeastBot] Resumed voice tracking for ${voiceStartTimes.size} active members`);

        // Clean up stale workout rooms from previous sessions
        for (const [chId] of workoutRooms) {
            const ch = guild.channels.cache.get(chId);
            if (!ch || ch.members.size === 0) {
                try { if (ch) await ch.delete('Workout room: stale after restart').catch(() => {}); } catch (_) {}
                workoutRooms.delete(chId);
            }
        }
        if (workoutRooms.size > 0) console.log(`[BeastBot] 🏋️ ${workoutRooms.size} workout room(s) still active after restart`);

        // Tick every 60s — update voiceMinutes + bonus XP + rank checks
        setInterval(async () => {
            const today = todayStr();
            for (const [uid] of voiceStartTimes) {
                creditVoiceTime(uid);
                // Bonus XP: +1/min camera, +1/min stream
                const bonus = getXpMultiplier(uid) - 1.0;
                if (bonus > 0) {
                    const bData = voiceBonusXp.get(uid) || { total: 0, days: new Map() };
                    bData.total += bonus;
                    bData.days.set(today, (bData.days.get(today) || 0) + bonus);
                    voiceBonusXp.set(uid, bData);
                }
                // Live rank update — fires rank-up message the minute they cross a threshold
                const member = guild.members.cache.get(uid);
                if (member) assignVoiceRank(member, monthlyActivityScore(uid)).catch(() => {});
            }

            // Workout notification DMs
            const nowUtc = new Date();
            const nowHHMM = `${String(nowUtc.getUTCHours()).padStart(2, '0')}:${String(nowUtc.getUTCMinutes()).padStart(2, '0')}`;
            const prevUtc = new Date(nowUtc.getTime() - 60_000);
            const prevHHMM = `${String(prevUtc.getUTCHours()).padStart(2, '0')}:${String(prevUtc.getUTCMinutes()).padStart(2, '0')}`;
            const nowDay  = nowUtc.getUTCDay();
            const todayNotify = todayStr();
            for (const [notifyUid, fData] of fitnessData) {
                if (!fData.notify) continue;
                if (fData.notify.timeUtc !== nowHHMM && fData.notify.timeUtc !== prevHHMM) continue;
                if (!fData.notify.daySet.includes(nowDay)) continue;
                if (fData.notify.lastSentDate === todayNotify) continue;
                try {
                    const notifyUser = await client.users.fetch(notifyUid);
                    const notifyGuild = client.guilds.cache.first();
                    let voicePinged = false;
                    if (notifyGuild) voicePinged = await playWorkoutAlarm(notifyGuild, notifyUid).catch(() => false);
                    const dmDesc = voicePinged
                        ? "Your workout reminder is going off — I beeped in your voice channel! Go crush it 💪\n\nLog your session in #tracking when you're done!"
                        : "Your workout reminder is going off — go crush it 💪\n\nLog your session in #tracking when you're done!";
                    await notifyUser.send({ embeds: [{
                        color: 0xf59e0b,
                        title: '⏰ Time to Work Out!',
                        description: dmDesc,
                        footer: { text: `⏰ ${fData.notify.timeRaw} · 📅 ${fData.notify.days}` },
                    }] });
                    fData.notify.lastSentDate = todayNotify;
                    fitnessData.set(notifyUid, fData);
                } catch (e) {
                    console.error(`[BeastBot] Workout notification failed for ${notifyUid}:`, e.message);
                }
            }

            // Save snapshot immediately after crediting — guarantees fresh data in backup
            await saveDiscordBackup().catch(e => console.error('[BeastBot] 60s backup failed:', e.message));
            await saveDailySnapshot();
            await saveFirestoreDaily();
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
                .setDescription('(Owner only) Scan all channels and rebuild message counts from Discord history')
                .addIntegerOption(opt => opt.setName('days').setDescription('How many days back to scan (default 30)').setRequired(false).setMinValue(1).setMaxValue(90)),
            new SlashCommandBuilder()
                .setName('scanreactions')
                .setDescription('(Owner only) Scan recent messages and backfill reaction counts for all users')
                .addIntegerOption(opt => opt.setName('days').setDescription('How many days back to scan (default 2, max 7)').setRequired(false).setMinValue(1).setMaxValue(7)),
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
                .setName('wall-of-shame')
                .setDescription('View counting game stats and wall of shame'),
            new SlashCommandBuilder()
                .setName('resetcounting')
                .setDescription('(Owner only) Reset the counting game to zero'),
            new SlashCommandBuilder()
                .setName('set-counter')
                .setDescription('(Owner only) Manually set the current count to a specific number')
                .addIntegerOption(opt => opt.setName('number').setDescription('The number to set the count to').setRequired(true).setMinValue(1)),
            new SlashCommandBuilder()
                .setName('xp')
                .setDescription('(Owner/Mod) Give or remove XP from a user')
                .addSubcommand(sub => sub
                    .setName('give')
                    .setDescription('Give XP to a user')
                    .addUserOption(opt => opt.setName('user').setDescription('The user to give XP to').setRequired(true))
                    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of XP to give').setRequired(true).setMinValue(1)))
                .addSubcommand(sub => sub
                    .setName('remove')
                    .setDescription('Remove XP from a user')
                    .addUserOption(opt => opt.setName('user').setDescription('The user to remove XP from').setRequired(true))
                    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of XP to remove').setRequired(true).setMinValue(1))),
            new SlashCommandBuilder()
                .setName('counting-set-record')
                .setDescription('(Owner only) Set the all-time counting record')
                .addIntegerOption(opt => opt.setName('number').setDescription('The record number').setRequired(true).setMinValue(1)),
            new SlashCommandBuilder()
                .setName('counting-add-shame')
                .setDescription('(Owner only) Add/update a user on the wall of shame')
                .addUserOption(opt => opt.setName('user').setDescription('The user who ruined the count').setRequired(true))
                .addIntegerOption(opt => opt.setName('highest_fail').setDescription('Their highest count ruined at').setRequired(true).setMinValue(1)),
            new SlashCommandBuilder()
                .setName('counting-remove-shame')
                .setDescription('(Owner only) Remove all wall of shame entries for a user')
                .addUserOption(opt => opt.setName('user').setDescription('The user to remove').setRequired(true)),
            new SlashCommandBuilder()
                .setName('reset-ranks')
                .setDescription('(Owner only) Reset everyone to Bronze I and clear rank achievement records'),
            new SlashCommandBuilder()
                .setName('restart')
                .setDescription('(Owner only) Restart the bot'),
            // ── Mod commands ──────────────────────────────────────────────────
            new SlashCommandBuilder()
                .setName('ban')
                .setDescription('Ban a member from the server')
                .addUserOption(opt => opt.setName('user').setDescription('Member to ban').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason for ban'))
                .addIntegerOption(opt => opt.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7)),
            new SlashCommandBuilder()
                .setName('tempban')
                .setDescription('Temporarily ban a member (e.g. 1h, 2d, 1w)')
                .addUserOption(opt => opt.setName('user').setDescription('Member to ban').setRequired(true))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 1h, 2d, 1w').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason')),
            new SlashCommandBuilder()
                .setName('kick')
                .setDescription('Kick a member from the server')
                .addUserOption(opt => opt.setName('user').setDescription('Member to kick').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason')),
            new SlashCommandBuilder()
                .setName('mute')
                .setDescription('Mute (timeout) a member for 28 days')
                .addUserOption(opt => opt.setName('user').setDescription('Member to mute').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason')),
            new SlashCommandBuilder()
                .setName('tempmute')
                .setDescription('Temporarily mute (timeout) a member (e.g. 10m, 2h, 1d)')
                .addUserOption(opt => opt.setName('user').setDescription('Member to mute').setRequired(true))
                .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 10m, 2h, 1d').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason')),
            new SlashCommandBuilder()
                .setName('unmute')
                .setDescription('Remove timeout from a member')
                .addUserOption(opt => opt.setName('user').setDescription('Member to unmute').setRequired(true)),
            new SlashCommandBuilder()
                .setName('unban')
                .setDescription('Unban a member by their user ID')
                .addStringOption(opt => opt.setName('userid').setDescription('User ID to unban').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason')),
            new SlashCommandBuilder()
                .setName('warn')
                .setDescription('Warn a member')
                .addUserOption(opt => opt.setName('user').setDescription('Member to warn').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason for warning').setRequired(true)),
            new SlashCommandBuilder()
                .setName('infractions')
                .setDescription('View a member\'s infractions')
                .addUserOption(opt => opt.setName('user').setDescription('Member to check').setRequired(true)),
            new SlashCommandBuilder()
                .setName('clear-all-infractions')
                .setDescription('(Mod only) Clear all infractions for every member'),
            new SlashCommandBuilder()
                .setName('clear')
                .setDescription('Delete messages in a channel')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to clear (defaults to current)')),
            new SlashCommandBuilder()
                .setName('slowmode')
                .setDescription('Set slowmode in a channel (0 = disable)')
                .addIntegerOption(opt => opt.setName('seconds').setDescription('Seconds between messages (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel (defaults to current)')),
            new SlashCommandBuilder()
                .setName('user-info')
                .setDescription('Get information about a member')
                .addUserOption(opt => opt.setName('user').setDescription('Member to inspect (defaults to you)')),
            new SlashCommandBuilder()
                .setName('role-info')
                .setDescription('Get information about a role')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to inspect').setRequired(true)),
            new SlashCommandBuilder()
                .setName('server-info')
                .setDescription('Get information about the server'),
            new SlashCommandBuilder()
                .setName('say')
                .setDescription('(Owner only) Send a message as the bot')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to').setRequired(true))
                .addStringOption(opt => opt.setName('message').setDescription('Message content').setRequired(true)),
            new SlashCommandBuilder()
                .setName('dm')
                .setDescription('(Mod only) Send an anonymous DM to a member as the bot')
                .addUserOption(opt => opt.setName('user').setDescription('Member to DM').setRequired(true))
                .addStringOption(opt => opt.setName('message').setDescription('Message content').setRequired(true)),
            new SlashCommandBuilder()
                .setName('setup-thoughts')
                .setDescription('(Owner only) Post the Share Your Thoughts prompt in the thoughts channel'),
            // ── Backup management ────────────────────────────────────────────
            new SlashCommandBuilder()
                .setName('backup-status')
                .setDescription('(Owner only) View current backup status and data summary'),
            new SlashCommandBuilder()
                .setName('backup-snapshot')
                .setDescription('(Owner only) Force a daily snapshot right now'),
            new SlashCommandBuilder()
                .setName('backup-list')
                .setDescription('(Owner only) List all available daily snapshots'),
            new SlashCommandBuilder()
                .setName('backup-restore')
                .setDescription('(Owner only) Restore data from a daily snapshot')
                .addStringOption(opt => opt.setName('date').setDescription('Date to restore (YYYY-MM-DD)').setRequired(true)),
            new SlashCommandBuilder()
                .setName('backup-wipe')
                .setDescription('(Owner only) Wipe ALL data — everyone starts at 0'),
            new SlashCommandBuilder()
                .setName('imposter')
                .setDescription('Play the Imposter word deduction game in #imposter-game')
                .addSubcommand(sub => sub.setName('start').setDescription('Start a new game lobby'))
                .addSubcommand(sub => sub.setName('stop').setDescription('End the current game (host or mod)'))
                .addSubcommand(sub => sub.setName('clear').setDescription('Delete all messages in the imposter channel (host or mod)'))
                .addSubcommand(sub => sub.setName('help').setDescription('How to play + how to edit questions')),
            new SlashCommandBuilder()
                .setName('redeploy')
                .setDescription('(Owner only) Trigger a full bot redeploy via GitHub Actions'),
            new SlashCommandBuilder()
                .setName('traitors')
                .setDescription('Play The Traitors social deduction game in #traitors-game')
                .addSubcommand(sub => sub.setName('start').setDescription('Start a new game lobby'))
                .addSubcommand(sub => sub.setName('stop').setDescription('End the current game (host or mod)'))
                .addSubcommand(sub => sub.setName('status').setDescription('Show the current game status'))
                .addSubcommand(sub => sub.setName('help').setDescription('How to play The Traitors'))
                .addSubcommand(sub => sub.setName('clear').setDescription('Delete all messages in the traitors channel (host or mod)')),
            new SlashCommandBuilder()
                .setName('fitness')
                .setDescription('Fitness tracking commands')
                .addSubcommand(sub => sub.setName('progress').setDescription('View your fitness progress (private to you)'))
                .addSubcommand(sub => sub.setName('manage').setDescription('Edit or delete your past workout entries'))
                .addSubcommand(sub => sub
                    .setName('notify')
                    .setDescription('Set a daily workout DM reminder (and voice channel bleep)')
                    .addIntegerOption(opt => opt.setName('hour').setDescription('Hour (1–12)').setRequired(true).addChoices(
                        { name: '12', value: 12 }, { name: '1', value: 1 }, { name: '2', value: 2 }, { name: '3', value: 3 },
                        { name: '4', value: 4 }, { name: '5', value: 5 }, { name: '6', value: 6 }, { name: '7', value: 7 },
                        { name: '8', value: 8 }, { name: '9', value: 9 }, { name: '10', value: 10 }, { name: '11', value: 11 }
                    ))
                    .addStringOption(opt => opt.setName('period').setDescription('AM or PM').setRequired(true).addChoices(
                        { name: 'AM', value: 'AM' }, { name: 'PM', value: 'PM' }
                    ))
                    .addIntegerOption(opt => opt.setName('minute').setDescription('Minutes (0–59)').setRequired(true).setMinValue(0).setMaxValue(59))
                    .addStringOption(opt => opt.setName('timezone').setDescription('Your timezone').setRequired(true).addChoices(
                        { name: 'UTC-12 (Baker Island)', value: '-12' }, { name: 'UTC-11 (Samoa)', value: '-11' }, { name: 'UTC-10 (Hawaii)', value: '-10' },
                        { name: 'UTC-9 (Alaska)', value: '-9' }, { name: 'UTC-8 (Pacific — Los Angeles)', value: '-8' }, { name: 'UTC-7 (Mountain — Denver)', value: '-7' },
                        { name: 'UTC-6 (Central — Chicago)', value: '-6' }, { name: 'UTC-5 (Eastern — New York)', value: '-5' }, { name: 'UTC-4 (Atlantic / Eastern DST)', value: '-4' },
                        { name: 'UTC-3 (Brazil / Buenos Aires)', value: '-3' }, { name: 'UTC-2', value: '-2' }, { name: 'UTC-1 (Azores)', value: '-1' },
                        { name: 'UTC+0 (London / Lisbon / UTC)', value: '0' }, { name: 'UTC+1 (Paris / Berlin / CET)', value: '1' }, { name: 'UTC+2 (Athens / Cairo / EET)', value: '2' },
                        { name: 'UTC+3 (Moscow / Istanbul)', value: '3' }, { name: 'UTC+4 (Dubai)', value: '4' }, { name: 'UTC+5 (Pakistan)', value: '5' },
                        { name: 'UTC+5:30 (India / IST)', value: '5.5' }, { name: 'UTC+6 (Bangladesh)', value: '6' }, { name: 'UTC+7 (Bangkok / Jakarta)', value: '7' },
                        { name: 'UTC+8 (Beijing / Singapore / Perth)', value: '8' }, { name: 'UTC+9 (Tokyo / Seoul / JST)', value: '9' },
                        { name: 'UTC+10 (Sydney / AEST)', value: '10' }, { name: 'UTC+12 (Auckland / NZT)', value: '12' }
                    ))
                    .addStringOption(opt => opt.setName('days').setDescription('Which days').setRequired(true).addChoices(
                        { name: 'Every day', value: 'daily' }, { name: 'Weekdays (Mon–Fri)', value: 'weekdays' }, { name: 'Weekends (Sat & Sun)', value: 'weekends' },
                        { name: 'Mon, Wed & Fri', value: 'mwf' }, { name: 'Tue & Thu', value: 'tt' },
                        { name: 'Monday', value: 'mon' }, { name: 'Tuesday', value: 'tue' }, { name: 'Wednesday', value: 'wed' },
                        { name: 'Thursday', value: 'thu' }, { name: 'Friday', value: 'fri' }, { name: 'Saturday', value: 'sat' }, { name: 'Sunday', value: 'sun' }
                    ))
                )
                .addSubcommand(sub => sub.setName('notify-clear').setDescription('Remove your workout reminder'))
                .addSubcommand(sub => sub.setName('alarm-test').setDescription('Test the voice alarm — bot will join your VC and play the beep')),
            new SlashCommandBuilder()
                .setName('fitness-setup')
                .setDescription('(Owner only) Post the Log Your Workout button in #tracking'),
        ].map(c => c.toJSON());

        await rest.put(Routes.applicationGuildCommands(client.user.id, client.guilds.cache.first().id), { body: commands });
        console.log('[BeastBot] Slash commands registered');
    } catch (e) {
        console.error('[BeastBot] Failed to register slash commands:', e.message);
    }

    // scheduleDiscordMeReminder(); // DISABLED — Discord.me reminder removed
    scheduleSpotlight();
    scheduleGiveawayCheck();

    // Restore bump timers from Firestore (survive restarts)
    try {
        const disboardData = await firestoreGet('botTimers', 'disboard');
        // const discadiaData = await firestoreGet('botTimers', 'discadia'); // DISABLED
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

        // DISABLED — Discadia timer restore removed
        // if (discadiaData && discadiaData.fireAt > now) {
        //     const delay = discadiaData.fireAt - now;
        //     console.log(`[BeastBot] Restoring Discadia timer — fires in ${Math.round(delay / 60000)}m`);
        //     scheduleDiscadiaReminder(delay);
        // } else {
        //     scheduleDiscadiaReminder(10 * 60 * 60 * 1000);
        // }
    } catch (e) {
        console.error('[BeastBot] Failed to restore timers:', e.message);
        // scheduleDiscadiaReminder(10 * 60 * 60 * 1000); // DISABLED
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

    // Load bot feature flags from Firestore (admin-toggled via admin panel)
    await getBotFeatures();
    setInterval(() => getBotFeatures().catch(() => {}), 30 * 60 * 1000); // refresh every 30 min

    // Poll Firestore for queued Discord cards every 60s (filtered query = 0 reads when empty)
    setInterval(() => pollDiscordCards().catch(() => {}), 60 * 1000);
    setTimeout(() => pollDiscordCards().catch(() => {}), 3000); // first poll 3s after ready

    // Heartbeat every 30 min so we can detect silent crashes
    setInterval(() => {
        console.log(`[BeastBot] 💓 heartbeat — uptime ${Math.round(process.uptime() / 60)}m`);
    }, 30 * 60 * 1000);

    // Load infractions + temp bans
    await loadInfractions();
    await loadTempBans();

    // Clean up daily snapshots older than 14 days
    cleanupOldSnapshots().catch(e => console.error('[BeastBot] Snapshot cleanup failed:', e.message));



});

// ── Imposter Game Logic ───────────────────────────────────────────────────────

function impCleanup(game) {
    if (!game) return;
    if (game.lobbyTimer) clearTimeout(game.lobbyTimer);
    for (const uid of game.players.keys()) imposterPlayerMap.delete(uid);
    imposterGames.delete(game.channelId);
}

function impIsHost(interaction, game) {
    return interaction.user.id === game.hostId ||
           interaction.user.id === OWNER_DISCORD_ID ||
           interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
}

// Auto-deletes the ephemeral reply after delayMs
async function impReply(interaction, content, delayMs = 8000) {
    await interaction.editReply({ content });
    setTimeout(() => interaction.deleteReply().catch(() => {}), delayMs);
}

function impLobbyEmbed(game) {
    const playerList = [...game.players.values()].map(p => `▸ ${p.name}`).join('\n') || '*No players yet — be the first!*';
    return {
        color: 0xff4444,
        title: '🔴  THE IMPOSTER  —  LOBBY',
        description: [
            '**How it works:**',
            'Everyone gets the **same question** via DM — except the **Imposter**, who gets a completely different question.',
            'Submit your answer privately, then explain yourself out loud. Can you spot who answered something else?',
            '',
            '**Flow:**  Join → Answer (DMs) → Host reveals → Everyone explains → Vote',
        ].join('\n'),
        fields: [
            { name: '​', value: '─────────────────────────────' },
            { name: `👥  Players  (${game.players.size} / ${IMP_MAX_PLAYERS})`, value: playerList },
            { name: '​', value: `Minimum to start: **${IMP_MIN_PLAYERS} players**` },
        ],
        footer: { text: '⏱  Lobby closes in 15 minutes' },
    };
}

function impLobbyComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('imp:join').setLabel('Join Game').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
        new ButtonBuilder().setCustomId('imp:start').setLabel('Start Game').setStyle(ButtonStyle.Success).setEmoji('▶️'),
        new ButtonBuilder().setCustomId('imp:end').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
    );
    return [row];
}

function impAnswerEmbed(game) {
    const done = [...game.players.values()].filter(p => p.answer !== null).length;
    const list = [...game.players.values()]
        .map(p => p.answer !== null ? `✅  ${p.name}` : `⏳  ${p.name}`)
        .join('\n');
    return {
        color: 0xf59e0b,
        title: '✏️  ANSWER PHASE',
        description: '**Check your DMs!** Your question is waiting.\nPress the button below to submit your answer — it stays hidden until the host reveals everything.',
        fields: [
            { name: '​', value: '─────────────────────────────' },
            { name: `📋  Progress — ${done} / ${game.players.size} answered`, value: list },
        ],
        footer: { text: 'Host will reveal all answers when ready' },
    };
}

function impAnswerComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('imp:answer').setLabel('Submit Answer').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
    );
    return [row];
}

function impHostRevealComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('imp:reveal').setLabel('Reveal Answers').setStyle(ButtonStyle.Success).setEmoji('🔍'),
        new ButtonBuilder().setCustomId('imp:end').setLabel('End Game').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
    );
    return [row];
}

function impRevealedEmbed(game) {
    const answers = [...game.players.entries()]
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([, p]) => `**${p.name}**\n> ${p.answer || '*— no answer submitted —*'}`)
        .join('\n\n');
    const order = [...game.players.entries()]
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([, p], i) => `**${i + 1}.** ${p.name}`)
        .join('  ·  ');
    return {
        color: 0x60a5fa,
        title: '🔍  ANSWERS REVEALED',
        fields: [
            { name: '❓  The Real Question', value: `> ${game.realQuestion}` },
            { name: '​', value: '─────────────────────────────' },
            { name: '💬  Everyone\'s Answers', value: answers || '*No answers submitted*' },
            { name: '​', value: '─────────────────────────────' },
            { name: '🎙️  Explanation Order', value: order || '*—*' },
        ],
        footer: { text: 'Each player: explain your answer!  •  Host starts voting when ready' },
    };
}

function impRevealedComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('imp:startvote').setLabel('Start Voting').setStyle(ButtonStyle.Success).setEmoji('🗳️'),
        new ButtonBuilder().setCustomId('imp:end').setLabel('End Game').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
    );
    return [row];
}

function impVoteEmbed(game) {
    const votes = [...game.players.values()].filter(p => p.vote !== null).length;
    const tally = new Map();
    for (const [, p] of game.players) {
        if (p.vote) tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
    }
    const voteList = [...game.players.entries()]
        .map(([uid, p]) => {
            const count = tally.get(uid) || 0;
            return count > 0 ? `${p.name}  ·  ${'🔵'.repeat(count)} ${count}` : `${p.name}  ·  —`;
        })
        .join('\n');
    return {
        color: 0xa855f7,
        title: '🗳️  VOTE  —  Who was the Imposter?',
        description: 'Click a name below — one vote each. Who do you think got the **different question?**',
        fields: [
            { name: '​', value: '─────────────────────────────' },
            { name: `📊  Votes Cast — ${votes} / ${game.players.size}`, value: voteList || '—' },
        ],
        footer: { text: 'Host can force-reveal at any time, or wait for everyone to vote' },
    };
}

function impPlayAgainComponents() {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('imp:playagain').setLabel('Play Again').setStyle(ButtonStyle.Success).setEmoji('🔄'),
        new ButtonBuilder().setCustomId('imp:endsession').setLabel('End Session').setStyle(ButtonStyle.Secondary).setEmoji('🏁'),
    );
    return [row];
}

function impVoteComponents(game) {
    const players = [...game.players.entries()];
    const rows = [];
    const buttons = players.map(([uid, p]) =>
        new ButtonBuilder().setCustomId(`imp:vote:${uid}`).setLabel(p.name).setStyle(ButtonStyle.Secondary)
    );
    buttons.push(new ButtonBuilder().setCustomId('imp:showresult').setLabel('Reveal Imposter').setStyle(ButtonStyle.Danger).setEmoji('🔎'));
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    return rows;
}

async function impTallyAndReveal(game, channel) {
    if (game.phase !== 'vote') return;
    game.phase = 'ended';

    const imposter = game.players.get(game.impostorId);
    const tally = new Map();
    for (const [, p] of game.players) {
        if (!p.vote) continue;
        tally.set(p.vote, (tally.get(p.vote) || 0) + 1);
    }

    const voteResults = [...game.players.entries()]
        .map(([uid, p]) => ({ name: p.name, votes: tally.get(uid) || 0, isImp: uid === game.impostorId }))
        .sort((a, b) => b.votes - a.votes)
        .map(r => `${r.isImp ? '🔴' : '⬜'} **${r.name}** — ${r.votes} vote${r.votes === 1 ? '' : 's'}`)
        .join('\n');

    let topVotes = 0; let topId = null; let tie = false;
    for (const [uid, count] of tally) {
        if (count > topVotes) { topVotes = count; topId = uid; tie = false; }
        else if (count === topVotes) { tie = true; }
    }
    const guessedRight = !tie && topId === game.impostorId;

    const outcomeText = guessedRight
        ? `✅  The crew correctly identified **${imposter?.name}** as the Imposter!`
        : tie
            ? `😅  It was a tie — nobody was eliminated! The Imposter slipped through!`
            : `😈  The crew voted out **${game.players.get(topId)?.name}** — but they were innocent! The Imposter escaped!`;

    const embed = {
        color: guessedRight ? 0x4ade80 : 0xff4444,
        title: guessedRight ? '🎉  THE CREW GOT THEM!' : '💀  THE IMPOSTER GOT AWAY!',
        description: outcomeText,
        fields: [
            { name: '​', value: '─────────────────────────────' },
            { name: '🔴  The Imposter was', value: `**${imposter?.name}**`, inline: true },
            { name: '​', value: '​', inline: true },
            { name: '​', value: '​', inline: true },
            { name: '❓  Real Question (everyone else)', value: `> ${game.realQuestion}` },
            { name: '🔀  Imposter\'s Question', value: `> ${game.altQuestion}` },
            { name: '​', value: '─────────────────────────────' },
            { name: '📊  Vote Results', value: voteResults || '*No votes cast*' },
        ],
        footer: { text: 'Use the buttons below to play again or wrap up!' },
    };

    try {
        const msg = await channel.messages.fetch(game.gameMsgId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components: impPlayAgainComponents() });
        else await channel.send({ embeds: [embed], components: impPlayAgainComponents() });
    } catch (_) { try { await channel.send({ embeds: [embed], components: impPlayAgainComponents() }); } catch (__) {} }

    impCleanup(game);
}

async function impEndGame(game, channel, byName) {
    game.phase = 'ended';

    const embed = {
        color: 0x6b7280,
        title: '🚫  GAME ENDED',
        description: byName ? `Game ended by **${byName}**.` : 'Game cancelled — lobby timed out.',
        footer: { text: 'Run /imposter start to play again!' },
    };
    try {
        const msg = await channel.messages.fetch(game.gameMsgId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components: [] });
        else await channel.send({ embeds: [embed] });
    } catch (_) { try { await channel.send({ embeds: [embed] }); } catch (__) {} }

    impCleanup(game);
}

// ── Traitors Game Logic ───────────────────────────────────────────────────────

// ─ A. Helpers ────────────────────────────────────────────────────────────────

function trtIsHost(interaction, game) {
    return interaction.user.id === game.hostId ||
           interaction.user.id === OWNER_DISCORD_ID ||
           interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
}

function trtUpdateRoleSets(game) {
    game.traitorIds  = new Set();
    game.faithfulIds = new Set();
    for (const [uid, p] of game.players) {
        if (!p.alive) continue;
        if (p.role === 'traitor')  game.traitorIds.add(uid);
        if (p.role === 'faithful') game.faithfulIds.add(uid);
    }
}

function trtAliveCount(game) {
    let n = 0;
    for (const p of game.players.values()) if (p.alive) n++;
    return n;
}

function trtLivingPlayers(game) {
    return [...game.players.entries()].filter(([, p]) => p.alive);
}

function trtPickRandomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function trtCanRecruit(game) {
    return game.options.recruitmentTwist &&
           game.traitorIds.size === 1 &&
           trtAliveCount(game) >= 4 &&
           game.round > 1;
}

function trtClearDiscussionWarnings(game) {
    for (const t of game.discussionWarningTimers) clearTimeout(t);
    game.discussionWarningTimers = [];
}

function trtCleanup(game) {
    if (!game) return;
    if (game.lobbyTimer)  clearTimeout(game.lobbyTimer);
    if (game.phaseTimer)  clearTimeout(game.phaseTimer);
    if (game.recruitTimer) clearTimeout(game.recruitTimer);
    trtClearDiscussionWarnings(game);
    for (const uid of game.players.keys()) traitorPlayerMap.delete(uid);
    traitorGames.delete(game.channelId);
}

async function trtReply(interaction, content, delayMs = 8000) {
    await interaction.editReply({ content });
    setTimeout(() => interaction.deleteReply().catch(() => {}), delayMs);
}

// Deletes the old host-controls message and posts a fresh one at the bottom.
// Pass content=null to delete only (no new message).
async function trtUpdateHostMsg(game, channel, content, components) {
    if (game.hostMsgId) {
        try {
            const old = await channel.messages.fetch(game.hostMsgId).catch(() => null);
            if (old) await old.delete().catch(() => {});
        } catch (_) {}
        game.hostMsgId = null;
    }
    if (content === null) return;
    try {
        const msg = await channel.send({ content, components });
        game.hostMsgId = msg.id;
    } catch (_) {}
}

// ─ B. Embed Builders ─────────────────────────────────────────────────────────

function trtLobbyEmbed(game) {
    const playerList = trtLivingPlayers(game).map(([, p]) => `▸ ${p.name}`).join('\n') ||
                       [...game.players.values()].map(p => `▸ ${p.name}`).join('\n') ||
                       '*No players yet — be the first!*';
    const opts = [
        `${game.options.hiddenRoleReveal ? '✅' : '⬜'} Hidden Role Reveal (roles shown only at game end)`,
        `${game.options.shieldChallenge  ? '✅' : '⬜'} Shield Challenge (one Faithful is secretly shielded each night)`,
        `${game.options.recruitmentTwist ? '✅' : '⬜'} Recruitment Twist (lone Traitor may recruit a Faithful)`,
    ].join('\n');
    return {
        color: 0x1a0a2e,
        title: '🗡️  THE TRAITORS  —  LOBBY',
        description: [
            'A social deduction game inspired by **The Traitors**.',
            'Traitors hunt Faithfuls by night. Faithfuls banish suspects by day.',
            'Can the table root out the Traitors before it\'s too late?',
        ].join('\n'),
        fields: [
            { name: `👥 Players (${game.players.size} / ${TRT_MAX_PLAYERS})`, value: playerList },
            { name: '⚙️ Options', value: opts },
            { name: '​', value: `Min to start: **${TRT_MIN_PLAYERS}** · Max: **${TRT_MAX_PLAYERS}**` },
        ],
        footer: { text: '⏱  Lobby closes in 15 minutes if not started' },
    };
}

function trtNightEmbed(game) {
    return {
        color: 0x0d0d0d,
        title: `🌙  NIGHT ${game.round}`,
        description: TRT_TEXT.CASTLE_SLEEPS,
        fields: [
            { name: '🗡️ Traitors', value: 'The Traitors are deciding their target...' },
        ],
        footer: { text: 'Traitors: check your DMs' },
    };
}

function trtMorningEmbed(game, outcome, victimId) {
    if (outcome === 'murder' && victimId) {
        const victim = game.players.get(victimId);
        const roleReveal = (!game.options.hiddenRoleReveal && victim)
            ? `\n*(${victim.name} was ${victim.role === 'traitor' ? 'a **TRAITOR**' : '**FAITHFUL**'})*`
            : '';
        return {
            color: 0xf97316,
            title: `🌅  MORNING — ROUND ${game.round}`,
            description: TRT_TEXT.FOUND_DEAD(victim?.name || 'Unknown') + roleReveal,
        };
    }
    if (outcome === 'shield') {
        return {
            color: 0x22c55e,
            title: `🌅  MORNING — ROUND ${game.round}`,
            description: '🥇 The Traitors struck — but a shield protected their target! **The castle is safe.**',
        };
    }
    return {
        color: 0x22c55e,
        title: `🌅  MORNING — ROUND ${game.round}`,
        description: TRT_TEXT.CASTLE_SAFE,
    };
}

function trtDiscussionEmbed(game, secondsLeft) {
    const alive = trtLivingPlayers(game).map(([, p]) => `▸ ${p.name}`).join('\n') || '*none*';
    const mins  = Math.floor(secondsLeft / 60);
    const secs  = secondsLeft % 60;
    return {
        color: 0x3b82f6,
        title: `⚖️  ROUND TABLE — ROUND ${game.round}`,
        description: TRT_TEXT.DISCUSSION_START,
        fields: [
            { name: '👥 Still in the game', value: alive },
            { name: '⏳ Time remaining', value: `${mins}m ${secs}s`, inline: true },
        ],
        footer: { text: 'Discuss who you think is a Traitor, then vote to banish.' },
    };
}

function trtBanishmentVoteEmbed(game) {
    const living  = trtLivingPlayers(game);
    const voted   = living.filter(([uid]) =>  game.banishmentVotes.has(uid)).map(([, p]) => `✅ ${p.name}`).join('\n') || '—';
    const waiting = living.filter(([uid]) => !game.banishmentVotes.has(uid)).map(([, p]) => `⏳ ${p.name}`).join('\n') || '—';
    return {
        color: 0x7c3aed,
        title: `🗳️  BANISHMENT VOTE — ROUND ${game.round}`,
        description: 'Use the dropdown to vote who you think is a Traitor. Votes are hidden until results are revealed.',
        fields: [
            { name: `✅ Voted (${game.banishmentVotes.size})`, value: voted, inline: true },
            { name: `⏳ Still deciding (${living.length - game.banishmentVotes.size})`, value: waiting, inline: true },
        ],
        footer: { text: 'Voting auto-closes when everyone has voted' },
    };
}

function trtBanishmentResultEmbed(game, banishedId, wasTie) {
    if (wasTie) {
        return {
            color: 0x6b7280,
            title: `🤝  DEADLOCK — ROUND ${game.round}`,
            description: TRT_TEXT.DEADLOCK,
        };
    }
    const target   = game.players.get(banishedId);
    const roleText = game.options.hiddenRoleReveal ? '' : ` — they were **${target?.role === 'traitor' ? 'a TRAITOR 🗡️' : 'FAITHFUL 🛡️'}**`;
    // Group voters by their chosen target
    const grouped = {};
    for (const [voterId, targetUserId] of game.banishmentVotes) {
        if (!grouped[targetUserId]) grouped[targetUserId] = [];
        grouped[targetUserId].push(game.players.get(voterId)?.name || voterId);
    }
    const voteSummary = Object.entries(grouped)
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([uid, voters]) => `**${game.players.get(uid)?.name || uid}** (${voters.length}) ← ${voters.join(', ')}`)
        .join('\n') || '*none*';
    return {
        color: 0xdc2626,
        title: `🪓  BANISHED — ROUND ${game.round}`,
        description: TRT_TEXT.BANISHED(target?.name || 'Unknown') + roleText,
        fields: [{ name: '📊 Votes', value: voteSummary }],
    };
}

function trtWinEmbed(game, winner) {
    const playerLines = [...game.players.values()]
        .map(p => `${p.alive ? '🟢' : '💀'} **${p.name}** — ${p.role === 'traitor' ? '🗡️ Traitor' : '🛡️ Faithful'}`)
        .join('\n') || '*none*';
    const murders     = game.log.murders.map(e => `Round ${e.round}: **${e.victimName}** (${e.victimRole})`).join('\n') || '*none*';
    const banishments = game.log.banishments.map(e => `Round ${e.round}: **${e.targetName}** (${e.targetRole}, ${e.votes} votes)`).join('\n') || '*none*';
    return {
        color: winner === 'faithful' ? 0x22c55e : 0x7c0a02,
        title: winner === 'faithful' ? `🏆  FAITHFULS WIN! — Round ${game.round}` : `🗡️  TRAITORS WIN! — Round ${game.round}`,
        description: winner === 'faithful' ? TRT_TEXT.FAITHFUL_WIN : TRT_TEXT.TRAITOR_WIN,
        fields: [
            { name: '👥 All Players', value: playerLines },
            { name: '🩸 Murders', value: murders },
            { name: '🪓 Banishments', value: banishments },
        ],
        footer: { text: 'Run /traitors start to play again!' },
    };
}

function trtStatusEmbed(game) {
    const phaseLabels = { lobby: 'Lobby', night: 'Night', morning: 'Morning', discussion: 'Discussion', vote: 'Vote', ended: 'Ended' };
    const alive = trtLivingPlayers(game).map(([, p]) => `▸ ${p.name}`).join('\n') || '*none*';
    return {
        color: 0x1a0a2e,
        title: '🗡️  Traitors — Status',
        fields: [
            { name: '📍 Phase', value: phaseLabels[game.phase] || game.phase, inline: true },
            { name: '🔄 Round', value: String(game.round), inline: true },
            { name: '👥 Living Players', value: alive },
        ],
    };
}

// ─ C. Component Builders ─────────────────────────────────────────────────────

function trtLobbyComponents(game) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('trt:join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('trt:leave').setLabel('Leave').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('trt:start').setLabel('Start Game').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('trt:stop').setLabel('End Lobby').setStyle(ButtonStyle.Danger),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trt:opt:hidden')
            .setLabel(`${game.options.hiddenRoleReveal ? '✅' : '⬜'} Hidden Roles`)
            .setStyle(game.options.hiddenRoleReveal ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('trt:opt:shield')
            .setLabel(`${game.options.shieldChallenge ? '✅' : '⬜'} Shield`)
            .setStyle(game.options.shieldChallenge ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('trt:opt:recruit')
            .setLabel(`${game.options.recruitmentTwist ? '✅' : '⬜'} Recruit`)
            .setStyle(game.options.recruitmentTwist ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    return [row1, row2];
}

function trtHostNightComponents(recruitPending = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trt:resolvenight')
            .setLabel('Resolve Night')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(recruitPending),
    )];
}

function trtHostDiscussionComponents() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('trt:skipdisc').setLabel('Skip Discussion').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('trt:stop').setLabel('End Game').setStyle(ButtonStyle.Danger),
    )];
}

function trtHostVoteComponents() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('trt:revealvote').setLabel('Reveal Result').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('trt:stop').setLabel('End Game').setStyle(ButtonStyle.Danger),
    )];
}

function trtNightVoteSelectMenu(game) {
    const canRecruit = trtCanRecruit(game);
    const targets    = trtLivingPlayers(game).filter(([uid]) => !game.traitorIds.has(uid));
    const options    = [];
    for (const [uid, p] of targets) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`Murder: ${p.name}`)
            .setValue(`murder:${uid}`)
            .setDescription('Eliminate this player tonight')
            .setEmoji('🗡️'));
    }
    if (canRecruit) {
        for (const [uid, p] of targets) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`Recruit: ${p.name}`)
                .setValue(`recruit:${uid}`)
                .setDescription('Offer this player a place as a Traitor')
                .setEmoji('🤝'));
        }
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId('trt:nightvote')
        .setPlaceholder('Choose your action for tonight...')
        .addOptions(options.slice(0, 25));
    return [new ActionRowBuilder().addComponents(menu)];
}

function trtBanishmentVoteSelectMenu(game) {
    const options = trtLivingPlayers(game).map(([uid, p]) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(p.name)
            .setValue(uid)
            .setDescription('Vote to banish this player')
            .setEmoji('🗳️')
    );
    const menu = new StringSelectMenuBuilder()
        .setCustomId('trt:banvote')
        .setPlaceholder('Select who you think is a Traitor...')
        .addOptions(options.slice(0, 25));
    return [new ActionRowBuilder().addComponents(menu)];
}

function trtRecruitResponseComponents() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('trt:recruit:accept').setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('trt:recruit:decline').setLabel('Decline').setStyle(ButtonStyle.Danger),
    )];
}

// ─ D. Phase Functions ─────────────────────────────────────────────────────────

async function trtUpdateStatusEmbed(game, channel) {
    const embed = trtStatusEmbed(game);
    if (game.statusMsgId) {
        try {
            const msg = await channel.messages.fetch(game.statusMsgId).catch(() => null);
            if (msg) { await msg.edit({ embeds: [embed] }); return; }
        } catch (_) {}
    }
    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) game.statusMsgId = msg.id;
}

async function trtPostGameLog(game, winner, channel) {
    try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (!logChannel) return;
        const murders     = game.log.murders.map(e => `R${e.round}: ${e.victimName} (${e.victimRole})`).join('\n') || 'none';
        const banishments = game.log.banishments.map(e => `R${e.round}: ${e.targetName} (${e.targetRole}, ${e.votes}v)`).join('\n') || 'none';
        const recruitments = game.log.recruitments.map(e => `R${e.round}: ${e.recruiterName} → ${e.targetName} (${e.accepted ? 'accepted' : 'declined'})`).join('\n') || 'none';
        await logChannel.send({ embeds: [{
            color: 0x1a0a2e,
            title: `🗡️ Traitors Game Log — ${winner === 'faithful' ? 'Faithfuls Win' : winner === 'traitors' ? 'Traitors Win' : 'Game Ended'}`,
            fields: [
                { name: 'Rounds', value: String(game.round), inline: true },
                { name: 'Players', value: String(game.players.size), inline: true },
                { name: 'Murders', value: murders },
                { name: 'Banishments', value: banishments },
                { name: 'Recruitments', value: recruitments },
            ],
            timestamp: new Date().toISOString(),
        }] });
    } catch (_) {}
}

async function trtEndGame(game, channel, winner, forcedBy) {
    game.phase = 'ended';
    const embed = trtWinEmbed(game, winner);
    if (forcedBy) embed.description = `*(Game ended by ${forcedBy})*`;
    await channel.send({ embeds: [embed] }).catch(() => {});

    await trtPostGameLog(game, winner, channel);
    trtCleanup(game);
}

async function trtCheckWin(game, channel) {
    trtUpdateRoleSets(game);
    if (game.traitorIds.size === 0) {
        await trtEndGame(game, channel, 'faithful', null);
        return 'faithful';
    }
    if (game.traitorIds.size >= game.faithfulIds.size) {
        await trtEndGame(game, channel, 'traitors', null);
        return 'traitors';
    }
    if (trtAliveCount(game) < 3) {
        await trtEndGame(game, channel, 'faithful', null);
        return 'faithful';
    }
    return null;
}

async function trtAssignShield(game) {
    const faithfuls = [...game.faithfulIds];
    if (faithfuls.length === 0) return;
    const shieldId = trtPickRandomFrom(faithfuls);
    game.shieldedPlayerId = shieldId;
    try {
        const user = await client.users.fetch(shieldId);
        await user.send({ embeds: [{ color: 0xffd700, title: '🥇 You are Shielded Tonight', description: TRT_TEXT.DM_SHIELD }] });
    } catch (_) {}
}

async function trtDmTraitorVote(game, traitorId) {
    try {
        const user = await client.users.fetch(traitorId);
        const components = trtNightVoteSelectMenu(game);
        const canRecruit = trtCanRecruit(game);
        await user.send({
            embeds: [{
                color: 0x7c0a02,
                title: `🗡️ Night ${game.round} — Choose Your Action`,
                description: canRecruit
                    ? 'You may **Murder** a Faithful to eliminate them, or **Recruit** one to bring them to your side.'
                    : 'Choose a Faithful to **Murder** tonight.',
                footer: { text: 'Your vote is anonymous. Choose wisely.' },
            }],
            components,
        });
    } catch (_) {
        game.dmFailedIds.add(traitorId);
    }
}

async function trtStartNight(game, channel) {
    game.phase           = 'night';
    game.nightVotes      = new Map();
    game.nightMurdered   = null;
    game.shieldedPlayerId = null;
    game.recruitPending  = false;
    game.recruitTarget   = null;
    game.dmFailedIds     = new Set();

    const msg = await channel.send({ embeds: [trtNightEmbed(game)] }).catch(() => null);
    if (msg) game.statusMsgId = msg.id;

    if (game.options.shieldChallenge) await trtAssignShield(game);

    for (const tid of game.traitorIds) {
        await trtDmTraitorVote(game, tid);
    }

    if (game.dmFailedIds.size > 0 && game.dmFailedIds.size >= game.traitorIds.size) {
        await trtUpdateHostMsg(game, channel, '⚠️ All Traitor DMs failed. Night will be auto-resolved safely.', []);
        setTimeout(() => trtResolveNight(game, channel).catch(() => {}), 3000);
        return;
    }

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Night ${game.round}**\nPress Resolve Night to force-resolve if traitors are AFK.`,
        trtHostNightComponents(false),
    );
}

async function trtRecruitFlow(game, channel, targetId) {
    game.recruitPending = true;
    game.recruitTarget  = targetId;

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Night ${game.round}** *(recruit offer pending)*\nWaiting for player to respond...`,
        trtHostNightComponents(true),
    );

    const traitorId   = [...game.traitorIds][0];
    const traitorName = game.players.get(traitorId)?.name || 'A Traitor';

    let dmSent = false;
    try {
        const targetUser = await client.users.fetch(targetId);
        await targetUser.send({
            embeds: [{
                color: 0x7c0a02,
                title: '🤫 A Traitor has approached you...',
                description: TRT_TEXT.DM_RECRUIT_OFFER(traitorName),
            }],
            components: trtRecruitResponseComponents(),
        });
        dmSent = true;
    } catch (_) {}

    if (!dmSent) {
        game.recruitPending = false;
        game.recruitTarget  = null;
        await trtUpdateHostMsg(game, channel,
            `**Host controls — Night ${game.round}**\nRecruit DM failed. Night resolving safely.`,
            trtHostNightComponents(false),
        );
        await trtStartMorning(game, channel, 'safe');
        return;
    }

    game.recruitTimer = setTimeout(async () => {
        if (!game.recruitPending || game.recruitTarget !== targetId) return;
        game.recruitPending = false;
        game.recruitTarget  = null;
        game.log.recruitments.push({ round: game.round, recruiterName: traitorName, targetName: game.players.get(targetId)?.name || '?', accepted: false });
        await trtUpdateHostMsg(game, channel,
            `**Host controls — Night ${game.round}**\nRecruit offer timed out. Night resolving safely.`,
            trtHostNightComponents(false),
        );
        await trtStartMorning(game, channel, 'safe');
    }, TRT_RECRUIT_MS);
}

async function trtResolveNight(game, channel) {
    if (game.phase !== 'night') return;

    if (game.nightVotes.size === 0) {
        await trtStartMorning(game, channel, 'safe');
        return;
    }

    const tally = new Map();
    for (const vote of game.nightVotes.values()) {
        const key = `${vote.action}:${vote.targetId}`;
        tally.set(key, (tally.get(key) || 0) + 1);
    }
    const maxVotes = Math.max(...tally.values());
    const winners  = [...tally.entries()].filter(([, v]) => v === maxVotes).map(([k]) => k);
    const chosen   = trtPickRandomFrom(winners);
    const [action, targetId] = chosen.split(':');

    if (action === 'recruit') {
        await trtRecruitFlow(game, channel, targetId);
        return;
    }

    // Murder
    if (targetId === game.shieldedPlayerId) {
        await trtStartMorning(game, channel, 'shield');
        return;
    }

    const victim = game.players.get(targetId);
    if (victim) {
        victim.alive = false;
        game.nightMurdered = targetId;
        trtUpdateRoleSets(game);
        game.log.murders.push({ round: game.round, victimName: victim.name, victimRole: victim.role });
    }

    const win = await trtCheckWin(game, channel);
    if (!win) await trtStartMorning(game, channel, 'murder', targetId);
}

async function trtStartMorning(game, channel, outcome, victimId = null) {
    game.phase = 'morning';
    await channel.send({ embeds: [trtMorningEmbed(game, outcome, victimId)] }).catch(() => {});

    // Remove host controls during morning (discussion phase will post fresh ones)
    await trtUpdateHostMsg(game, channel, null, []);

    // Auto-advance to discussion after 4s
    setTimeout(() => {
        if (game.phase !== 'morning') return;
        trtStartDiscussion(game, channel).catch(() => {});
    }, 4000);
}

async function trtStartDiscussion(game, channel) {
    game.phase = 'discussion';
    game.round++;

    const secondsLeft = Math.floor(TRT_DISCUSSION_MS / 1000);
    const embed = trtDiscussionEmbed(game, secondsLeft);

    const discMsg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (discMsg) game.statusMsgId = discMsg.id;

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Discussion Round ${game.round}**`,
        trtHostDiscussionComponents(),
    );

    // Warning embeds
    game.discussionWarningTimers = [];
    const warnings = [
        { delay: TRT_DISCUSSION_MS - 3 * 60 * 1000, text: TRT_TEXT.DISCUSSION_3MIN, secs: 3 * 60 },
        { delay: TRT_DISCUSSION_MS - 60 * 1000,     text: TRT_TEXT.DISCUSSION_1MIN, secs: 60 },
        { delay: TRT_DISCUSSION_MS - 30 * 1000,     text: TRT_TEXT.DISCUSSION_30SEC, secs: 30 },
    ];
    for (const w of warnings) {
        if (w.delay <= 0) continue;
        game.discussionWarningTimers.push(setTimeout(async () => {
            if (game.phase !== 'discussion') return;
            try {
                const msg = await channel.messages.fetch(game.statusMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [trtDiscussionEmbed(game, w.secs)] });
            } catch (_) {}
        }, w.delay));
    }

    game.phaseTimer = setTimeout(() => {
        if (game.phase !== 'discussion') return;
        trtClearDiscussionWarnings(game);
        trtStartBanishmentVote(game, channel).catch(() => {});
    }, TRT_DISCUSSION_MS);
}

async function trtStartBanishmentVote(game, channel) {
    game.phase          = 'vote';
    game.banishmentVotes = new Map();
    trtClearDiscussionWarnings(game);
    if (game.phaseTimer) { clearTimeout(game.phaseTimer); game.phaseTimer = null; }

    const embed      = trtBanishmentVoteEmbed(game);
    const selectMenu = trtBanishmentVoteSelectMenu(game);

    // Post the vote embed + select menu
    let vMsg = null;
    try {
        vMsg = await channel.send({ embeds: [embed], components: selectMenu });
        game.voteMsgId = vMsg.id;
    } catch (_) {}

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Vote Round ${game.round}**`,
        trtHostVoteComponents(),
    );

    // Auto-reveal timer
    game.phaseTimer = setTimeout(() => {
        if (game.phase !== 'vote') return;
        trtResolveBanishment(game, channel).catch(() => {});
    }, TRT_VOTE_MS);
}

async function trtResolveBanishment(game, channel) {
    if (game.phase !== 'vote') return;
    if (game.phaseTimer) { clearTimeout(game.phaseTimer); game.phaseTimer = null; }

    // Disable the vote select menu
    try {
        const vMsg = await channel.messages.fetch(game.voteMsgId).catch(() => null);
        if (vMsg) await vMsg.edit({ components: [] });
    } catch (_) {}

    // Post individual vote breakdown
    if (game.banishmentVotes.size > 0) {
        const lines = [...game.banishmentVotes.entries()]
            .map(([voterId, targetId]) => `**${game.players.get(voterId)?.name || '?'}** voted for **${game.players.get(targetId)?.name || '?'}**`)
            .join('\n');
        await channel.send({ content: `📜 **Vote breakdown:**\n${lines}` }).catch(() => {});
    }

    // Tally
    const tally = new Map();
    for (const targetId of game.banishmentVotes.values()) {
        tally.set(targetId, (tally.get(targetId) || 0) + 1);
    }

    if (tally.size === 0) {
        // No votes cast
        await channel.send({ embeds: [trtBanishmentResultEmbed(game, null, true)] }).catch(() => {});
        const win = await trtCheckWin(game, channel);
        if (!win) await trtStartNight(game, channel);
        return;
    }

    const maxVotes = Math.max(...tally.values());
    const topTargets = [...tally.entries()].filter(([, v]) => v === maxVotes).map(([k]) => k);
    const wasTie = topTargets.length > 1;

    if (wasTie) {
        await channel.send({ embeds: [trtBanishmentResultEmbed(game, null, true)] }).catch(() => {});
        const win = await trtCheckWin(game, channel);
        if (!win) await trtStartNight(game, channel);
        return;
    }

    const banishedId = topTargets[0];
    const banished   = game.players.get(banishedId);
    if (banished) {
        banished.alive = false;
        game.log.banishments.push({ round: game.round, targetName: banished.name, targetRole: banished.role, votes: maxVotes });
    }
    trtUpdateRoleSets(game);

    await channel.send({ embeds: [trtBanishmentResultEmbed(game, banishedId, false)] }).catch(() => {});

    const win = await trtCheckWin(game, channel);
    if (!win) await trtStartNight(game, channel);
}

async function trtStartGame(game, channel) {
    const playerCount  = game.players.size;
    const traitorCount = trtGetTraitorCount(playerCount);
    const playerIds    = [...game.players.keys()];

    // Shuffle and assign traitors
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }
    const traitorIds = new Set(playerIds.slice(0, traitorCount));
    for (const [uid, p] of game.players) {
        p.role  = traitorIds.has(uid) ? 'traitor' : 'faithful';
        p.alive = true;
    }
    trtUpdateRoleSets(game);
    game.round = 0;
    game.log   = { murders: [], banishments: [], recruitments: [] };

    // DM all players their role
    const traitorNames = [...game.traitorIds].map(tid => game.players.get(tid)?.name || '?');
    const dmFailed = [];
    for (const [uid, p] of game.players) {
        try {
            const user    = await client.users.fetch(uid);
            const dmEmbed = p.role === 'traitor'
                ? { color: 0x7c0a02, title: '🗡️ Your Role: TRAITOR', description: TRT_TEXT.DM_YOU_ARE_TRAITOR(traitorNames.filter(n => n !== p.name)) }
                : { color: 0x3b82f6, title: '🛡️ Your Role: FAITHFUL', description: TRT_TEXT.DM_YOU_ARE_FAITHFUL };
            await user.send({ embeds: [dmEmbed] });
        } catch (_) {
            dmFailed.push(uid);
        }
    }

    // Remove DM-failed players
    for (const uid of dmFailed) {
        game.players.delete(uid);
        traitorPlayerMap.delete(uid);
    }
    trtUpdateRoleSets(game);

    if (dmFailed.length > 0) {
        await channel.send({ content: `⚠️ Could not DM ${dmFailed.length} player(s) — they have been removed from the game.` }).catch(() => {});
    }

    if (game.players.size < TRT_MIN_PLAYERS) {
        await channel.send({ content: '❌ Not enough players after DM failures. Game cancelled.' }).catch(() => {});
        trtCleanup(game);
        return;
    }
    if (game.traitorIds.size === 0) {
        await channel.send({ content: '❌ All Traitors failed to receive DMs. Game cancelled.' }).catch(() => {});
        trtCleanup(game);
        return;
    }

    await trtUpdateHostMsg(game, channel, '**Host controls — loading...**', []);

    await trtStartNight(game, channel);
}

// ─ E. Interaction Sub-handlers ───────────────────────────────────────────────

async function handleTrtNightVote(interaction, game, channel) {
    const traitorId = interaction.user.id;
    if (!game.traitorIds.has(traitorId)) {
        await interaction.reply({ content: '❌ You are not a Traitor or this is not the night phase.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    if (game.nightVotes.has(traitorId)) {
        await interaction.update({ content: '✅ You have already voted tonight.', components: [] });
        return;
    }

    const value    = interaction.values[0];
    const colonIdx = value.indexOf(':');
    const action   = value.slice(0, colonIdx);
    const targetId = value.slice(colonIdx + 1);

    game.nightVotes.set(traitorId, { action, targetId });
    await interaction.update({ content: `✅ Your vote is locked in: **${action === 'murder' ? 'Murder' : 'Recruit'}** ${game.players.get(targetId)?.name || '?'}`, components: [] });

    // Auto-resolve if all traitors (who got DMs) have voted
    const dmSuccessful = [...game.traitorIds].filter(tid => !game.dmFailedIds.has(tid));
    const allVoted = dmSuccessful.every(tid => game.nightVotes.has(tid));
    if (allVoted && game.phase === 'night' && !game.recruitPending) {
        await trtResolveNight(game, channel);
    }
}

async function handleTrtBanVote(interaction, game, channel) {
    const voterId   = interaction.user.id;
    const player    = game.players.get(voterId);
    if (!player || !player.alive) {
        await interaction.reply({ content: '❌ You are not an active player.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    if (game.banishmentVotes.has(voterId)) {
        await interaction.reply({ content: '❌ You have already voted.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    const targetId = interaction.values[0];
    if (targetId === voterId) {
        await interaction.reply({ content: '❌ You cannot vote for yourself.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    game.banishmentVotes.set(voterId, targetId);

    // Update embed with new vote count
    try {
        const vMsg = await channel.messages.fetch(game.voteMsgId).catch(() => null);
        if (vMsg) await vMsg.edit({ embeds: [trtBanishmentVoteEmbed(game)], components: trtBanishmentVoteSelectMenu(game) });
    } catch (_) {}

    await interaction.reply({ content: `✅ You voted for **${game.players.get(targetId)?.name || '?'}**.`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

    // Auto-resolve if all living players voted
    const allVoted = trtLivingPlayers(game).every(([uid]) => game.banishmentVotes.has(uid));
    if (allVoted && game.phase === 'vote') {
        await trtResolveBanishment(game, channel);
    }
}

async function handleTrtRecruitAccept(interaction, game, channel) {
    const userId = interaction.user.id;
    if (!game.recruitPending || game.recruitTarget !== userId) {
        await interaction.reply({ content: '❌ This offer has expired.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    if (game.recruitTimer) { clearTimeout(game.recruitTimer); game.recruitTimer = null; }
    game.recruitPending = false;
    game.recruitTarget  = null;

    const player = game.players.get(userId);
    if (!player) {
        await interaction.reply({ content: '❌ Player not found.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    player.role = 'traitor';
    trtUpdateRoleSets(game);

    const traitorId   = [...game.traitorIds].find(tid => tid !== userId);
    const traitorName = game.players.get(traitorId)?.name || 'your ally';
    game.log.recruitments.push({ round: game.round, recruiterName: traitorName, targetName: player.name, accepted: true });

    // Update the recruit offer message and DM role details
    try {
        const allAllyNames = [...game.traitorIds].filter(t => t !== userId).map(t => game.players.get(t)?.name || '?');
        await interaction.update({ embeds: [{ color: 0x7c0a02, title: '🗡️ Welcome, Traitor', description: TRT_TEXT.DM_NOW_TRAITOR(allAllyNames) }], components: [] });
    } catch (_) {}

    // DM the recruiting traitor
    try {
        if (traitorId) {
            const tUser = await client.users.fetch(traitorId);
            await tUser.send({ embeds: [{ color: 0x22c55e, title: '🤝 Recruit Accepted', description: TRT_TEXT.DM_RECRUIT_ACCEPTED(player.name) }] });
        }
    } catch (_) {}

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Night ${game.round}** *(recruitment complete)*\nPress Resolve Night if ready.`,
        trtHostNightComponents(false),
    );

    const win = await trtCheckWin(game, channel);
    if (!win) await trtStartMorning(game, channel, 'safe');
}

async function handleTrtRecruitDecline(interaction, game, channel) {
    const userId = interaction.user.id;
    if (!game.recruitPending || game.recruitTarget !== userId) {
        await interaction.reply({ content: '❌ This offer has expired.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
        return;
    }
    if (game.recruitTimer) { clearTimeout(game.recruitTimer); game.recruitTimer = null; }
    game.recruitPending = false;
    game.recruitTarget  = null;

    const player      = game.players.get(userId);
    const traitorId   = [...game.traitorIds][0];
    const traitorName = game.players.get(traitorId)?.name || 'a Traitor';

    game.log.recruitments.push({ round: game.round, recruiterName: traitorName, targetName: player?.name || '?', accepted: false });

    // Declining = the Traitor silences them. They are murdered to protect the secret.
    try { await interaction.update({ content: '❌ You have declined the offer. You have been silenced by the Traitors.', components: [] }); } catch (_) {}

    // Kill the declining Faithful
    if (player) {
        player.alive = false;
        game.log.murders.push({ round: game.round, victimName: player.name, victimRole: 'faithful' });
        trtUpdateRoleSets(game);
    }

    // Notify recruiting traitor
    try {
        if (traitorId) {
            const tUser = await client.users.fetch(traitorId);
            await tUser.send({ embeds: [{ color: 0xdc2626, title: '🤫 Recruit Declined — Silenced', description: `**${player?.name || '?'}** refused the offer. They have been silenced and will not be returning.` }] });
        }
    } catch (_) {}

    await trtUpdateHostMsg(game, channel,
        `**Host controls — Night ${game.round}** *(recruit declined — target silenced)*`,
        trtHostNightComponents(false),
    );

    const win = await trtCheckWin(game, channel);
    if (!win) await trtStartMorning(game, channel, 'murder', userId);
}

// ── Button interactions ───────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    // ── Slash commands ───────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {

        // ── /imposter ────────────────────────────────────────────────────────
        if (interaction.commandName === 'imposter') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'start') {
                if (botFeatures.imposterGame === false) {
                    return interaction.reply({ content: 'The Imposter game is currently disabled.', ephemeral: true });
                }
                const existing = imposterGames.get(IMPOSTER_CHANNEL_ID);
                if (existing && existing.phase !== 'ended') {
                    return interaction.reply({ content: `A game is already running in <#${IMPOSTER_CHANNEL_ID}>! Use \`/imposter stop\` to end it first.`, ephemeral: true });
                }

                const qPair = IMPOSTER_QUESTIONS[Math.floor(Math.random() * IMPOSTER_QUESTIONS.length)];

                const game = {
                    channelId: IMPOSTER_CHANNEL_ID,
                    hostId: interaction.user.id,
                    phase: 'lobby',
                    players: new Map(),
                    realQuestion: qPair.real,
                    altQuestion: qPair.alt,
                    impostorId: null,
                    lobbyMsgId: null,
                    gameMsgId: null,
                    hostMsgId: null,
                    lobbyTimer: null,
                };
                imposterGames.set(IMPOSTER_CHANNEL_ID, game);

                game.players.set(interaction.user.id, {
                    name: interaction.member?.displayName || interaction.user.username,
                    answer: null,
                    vote: null,
                    order: 1,
                });
                imposterPlayerMap.set(interaction.user.id, IMPOSTER_CHANNEL_ID);

                const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
                if (!channel) return interaction.reply({ content: 'Could not find the imposter game channel.', ephemeral: true });

                const msg = await channel.send({ embeds: [impLobbyEmbed(game)], components: impLobbyComponents() });
                game.lobbyMsgId = msg.id;
                game.gameMsgId = msg.id;

                game.lobbyTimer = setTimeout(async () => {
                    if (imposterGames.get(IMPOSTER_CHANNEL_ID) === game && game.phase === 'lobby') {
                        await impEndGame(game, channel, null);
                    }
                }, IMP_LOBBY_TIMEOUT_MS);

                await interaction.reply({ content: `Game lobby created in <#${IMPOSTER_CHANNEL_ID}>! Join and wait for you to start.`, ephemeral: true });
                return;
            }

            if (sub === 'stop') {
                const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
                if (!game || game.phase === 'ended') {
                    return interaction.reply({ content: 'No active game to stop.', ephemeral: true });
                }
                if (!impIsHost(interaction, game)) {
                    return interaction.reply({ content: 'Only the host or a moderator can stop the game.', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
                const byName = interaction.member?.displayName || interaction.user.username;
                if (channel) await impEndGame(game, channel, byName);
                await interaction.editReply({ content: 'Game ended.' });
                return;
            }

            if (sub === 'clear') {
                const isMod = interaction.user.id === OWNER_DISCORD_ID || interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
                const activeGame = imposterGames.get(IMPOSTER_CHANNEL_ID);
                const isHost = activeGame && interaction.user.id === activeGame.hostId;
                if (!isMod && !isHost) {
                    return interaction.reply({ content: 'Only the host or a moderator can clear the channel.', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
                if (!channel) { await interaction.editReply({ content: 'Could not find the imposter channel.' }); return; }

                let deleted = 0;
                // Bulk delete in batches of 100 (Discord limit; only works for messages < 14 days old)
                let fetched;
                do {
                    fetched = await channel.messages.fetch({ limit: 100 });
                    if (fetched.size === 0) break;
                    const result = await channel.bulkDelete(fetched, true).catch(() => null);
                    deleted += result?.size ?? 0;
                    if (fetched.size < 100) break;
                } while (fetched.size > 0);

                await interaction.editReply({ content: `✅ Cleared **${deleted}** message${deleted === 1 ? '' : 's'} from the imposter channel.` });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                return;
            }

            if (sub === 'help') {
                const sampleQuestions = IMPOSTER_QUESTIONS.slice(0, 3)
                    .map((q, i) => `**${i + 1}.** Real: *"${q.real}"*\n      Alt: *"${q.alt}"*`)
                    .join('\n');
                return interaction.reply({
                    ephemeral: true,
                    embeds: [{
                        color: 0xff4444,
                        title: '🔴 The Imposter — Help & Info',
                        fields: [
                            {
                                name: '📖 How to play',
                                value: '1. `/imposter start` → players join lobby\n2. Host presses **Start Game** → everyone gets a question via DM\n3. Press **Submit Answer** in <#' + IMPOSTER_CHANNEL_ID + '>\n4. Host presses **Reveal Answers** when ready\n5. Each player explains their answer (free chat, follow the order shown)\n6. Host presses **Start Voting** → click who you think is the Imposter\n7. Host presses **Reveal Imposter** (or auto-reveals when all vote)',
                            },
                            {
                                name: '❓ How questions work',
                                value: 'Questions are **hardcoded** in `discord-bot/index.js` — the `IMPOSTER_QUESTIONS` array (~line 72). There are currently **' + IMPOSTER_QUESTIONS.length + ' question pairs**.\n\nEach pair has a `real` question (everyone gets this) and an `alt` question (the imposter gets this instead).\n\nSample pairs:\n' + sampleQuestions,
                            },
                            {
                                name: '✏️ Adding / editing questions (without AI)',
                                value: '1. Open `discord-bot/index.js` in any text editor\n2. Find the `IMPOSTER_QUESTIONS` array near the top\n3. Add/edit/remove `{ real: "...", alt: "..." }` entries\n4. Save the file, then run `/redeploy` in Discord (or `git push` — auto-deploys)',
                            },
                            {
                                name: '⚡ Commands',
                                value: '`/imposter start` — start a game\n`/imposter stop` — end current game\n`/imposter help` — this message\n`/redeploy` — redeploy the bot with latest code (owner only)',
                            },
                        ],
                    }],
                });
            }
        }

        // ── /traitors ─────────────────────────────────────────────────────────
        if (interaction.commandName === 'traitors') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'start') {
                if (botFeatures.traitorsGame === false) {
                    await interaction.reply({ content: 'The Traitors game is currently disabled.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                const existing = traitorGames.get(TRT_CHANNEL_ID);
                if (existing && existing.phase !== 'ended') {
                    await interaction.reply({ content: `A game is already running in <#${TRT_CHANNEL_ID}>! Use \`/traitors stop\` to end it first.`, ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
                if (!channel) {
                    await interaction.reply({ content: 'Could not find the Traitors game channel.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }

                const game = {
                    channelId: TRT_CHANNEL_ID,
                    hostId: interaction.user.id,
                    phase: 'lobby',
                    round: 0,
                    players: new Map(),
                    traitorIds: new Set(),
                    faithfulIds: new Set(),
                    nightVotes: new Map(),
                    nightMurdered: null,
                    shieldedPlayerId: null,
                    recruitPending: false,
                    recruitTarget: null,
                    dmFailedIds: new Set(),
                    banishmentVotes: new Map(),
                    statusMsgId: null,
                    hostMsgId: null,
                    voteMsgId: null,
                    lobbyTimer: null,
                    phaseTimer: null,
                    discussionWarningTimers: [],
                    recruitTimer: null,
                    options: { hiddenRoleReveal: false, shieldChallenge: false, recruitmentTwist: true },
                    log: { murders: [], banishments: [], recruitments: [] },
                };
                traitorGames.set(TRT_CHANNEL_ID, game);

                game.players.set(interaction.user.id, {
                    name: interaction.member?.displayName || interaction.user.username,
                    role: null,
                    alive: true,
                    order: 1,
                });
                traitorPlayerMap.set(interaction.user.id, TRT_CHANNEL_ID);

                const msg = await channel.send({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
                game.statusMsgId = msg.id;

                game.lobbyTimer = setTimeout(async () => {
                    if (traitorGames.get(TRT_CHANNEL_ID) === game && game.phase === 'lobby') {
                        await trtEndGame(game, channel, null, null);
                        await channel.send({ embeds: [{ color: 0x6b7280, description: '⏰ Lobby timed out with no game started.' }] }).catch(() => {});
                    }
                }, TRT_LOBBY_TIMEOUT_MS);

                await interaction.reply({ content: `Game lobby created in <#${TRT_CHANNEL_ID}>! Join up.`, ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                return;
            }

            if (sub === 'stop') {
                const game = traitorGames.get(TRT_CHANNEL_ID);
                if (!game || game.phase === 'ended') {
                    await interaction.reply({ content: 'No active Traitors game.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                if (!trtIsHost(interaction, game)) {
                    await interaction.reply({ content: 'Only the host or a moderator can stop the game.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                await interaction.deferReply({ ephemeral: true });
                const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
                const byName  = interaction.member?.displayName || interaction.user.username;
                if (channel) await trtEndGame(game, channel, null, byName);
                await interaction.editReply({ content: 'Game ended.' });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                return;
            }

            if (sub === 'status') {
                const game = traitorGames.get(TRT_CHANNEL_ID);
                if (!game || game.phase === 'ended') {
                    await interaction.reply({ content: 'No active Traitors game.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                await interaction.reply({ embeds: [trtStatusEmbed(game)], ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 20000);
                return;
            }

            if (sub === 'help') {
                await interaction.reply({
                    ephemeral: true,
                    embeds: [{
                        color: 0x1a0a2e,
                        title: '🗡️ The Traitors — How to Play',
                        fields: [
                            {
                                name: '🎭 The Setup',
                                value: 'Players are secretly assigned as **Traitors** or **Faithfuls**. Traitors know each other; Faithfuls do not know who anyone is.',
                            },
                            {
                                name: '🌙 Night Phase',
                                value: 'Traitors receive a DM with a secret vote: **Murder** a Faithful (eliminating them) or **Recruit** one (if the Recruitment Twist option is on and only 1 Traitor remains with 4+ players).',
                            },
                            {
                                name: '🌅 Morning Phase',
                                value: 'The channel announces whether someone was found dead, or the castle is safe. Players discuss who they suspect.',
                            },
                            {
                                name: '⚖️ Discussion & Banishment',
                                value: 'After a 5-min discussion, everyone votes to **banish** a player. The player with the most votes is banished. A tie means no one is banished.',
                            },
                            {
                                name: '🏆 Win Conditions',
                                value: '**Faithfuls win:** All Traitors are banished.\n**Traitors win:** Traitors equal or outnumber Faithfuls.',
                            },
                            {
                                name: '⚙️ Options (set in lobby)',
                                value: '• **Hidden Role Reveal** — roles only revealed at game end\n• **Shield Challenge** — one Faithful is secretly shielded each night\n• **Recruitment Twist** — lone Traitor may recruit a Faithful (on by default)',
                            },
                            {
                                name: '⚡ Commands',
                                value: '`/traitors start` — start a lobby\n`/traitors stop` — end the game\n`/traitors status` — current phase info\n`/traitors clear` — clear the channel\n`/traitors help` — this message',
                            },
                        ],
                    }],
                });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 45000);
                return;
            }

            if (sub === 'clear') {
                const isMod = interaction.user.id === OWNER_DISCORD_ID || interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
                const activeGame = traitorGames.get(TRT_CHANNEL_ID);
                const isHost = activeGame && interaction.user.id === activeGame.hostId;
                if (!isMod && !isHost) {
                    await interaction.reply({ content: 'Only the host or a moderator can clear the channel.', ephemeral: true });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }
                await interaction.deferReply({ ephemeral: true });
                const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
                if (!channel) {
                    await interaction.editReply({ content: 'Could not find the traitors channel.' });
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                    return;
                }

                let deleted = 0;
                let fetched;
                do {
                    fetched = await channel.messages.fetch({ limit: 100 });
                    if (fetched.size === 0) break;
                    const result = await channel.bulkDelete(fetched, true).catch(() => null);
                    deleted += result?.size ?? 0;
                    if (fetched.size < 100) break;
                } while (fetched.size > 0);

                await interaction.editReply({ content: `✅ Cleared **${deleted}** message${deleted === 1 ? '' : 's'} from the traitors channel.` });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                return;
            }
        }

        // ── /redeploy ─────────────────────────────────────────────────────────
        if (interaction.commandName === 'redeploy') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                return interaction.reply({ content: 'Only the server owner can trigger a redeploy.', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });

            const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
            if (!GITHUB_TOKEN) {
                return interaction.editReply({ content: '❌ `GITHUB_TOKEN` env var is not set on the bot. Add it with `flyctl secrets set GITHUB_TOKEN=<your_token>` then redeploy manually once.' });
            }

            try {
                const res = await fetch('https://api.github.com/repos/KiernenIrons/TrueBeast-Website/actions/workflows/deploy-bot.yml/dispatches', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github+json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ref: 'main', inputs: { reason: `Triggered by ${interaction.user.username} via Discord` } }),
                });

                if (res.status === 204) {
                    await interaction.editReply({ content: '✅ Redeploy triggered! GitHub Actions is building and deploying the bot now. Takes ~2 minutes. Watch progress at: https://github.com/KiernenIrons/TrueBeast-Website/actions' });
                } else {
                    const body = await res.text().catch(() => '');
                    await interaction.editReply({ content: `❌ GitHub returned status ${res.status}. Check your GITHUB_TOKEN has \`workflow\` scope.\n\`\`\`${body.slice(0, 300)}\`\`\`` });
                }
            } catch (e) {
                await interaction.editReply({ content: `❌ Request failed: ${e.message}` });
            }
            return;
        }

        if (interaction.commandName === 'leaderboard') {
            const pickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('lbt:xp:month').setLabel('⭐ XP').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lbt:vc:week').setLabel('🎙️ Voice Chat').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lbt:msg:week').setLabel('📩 Messages').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('lbranks').setLabel('❓ Help').setStyle(ButtonStyle.Primary),
            );
            const { resource } = await interaction.reply({ content: '**Choose a leaderboard:**', components: [pickRow], withResponse: true });
            leaderboardOwners.set(resource.message.id, interaction.user.id);
            return;
        }

        if (interaction.commandName === 'rank-tutorial') {
            await interaction.reply({ embeds: [buildRanksEmbed()], ephemeral: true });
            return;
        }

        if (interaction.commandName === 'wall-of-shame') {
            const shameList = countingState.wallOfShame.length
                ? countingState.wallOfShame.slice(0, 15).map((e, i) => `${i + 1}. <@${e.userId}> — **${e.highest}**`).join('\n')
                : 'No ruins yet — keep counting!';
            await interaction.reply({ embeds: [{
                color: 0x4ade80,
                title: '💯 Counting Stats',
                fields: [
                    { name: '🔢 Current Count', value: `**${countingState.current}**`, inline: true },
                    { name: '🏆 All-Time Record', value: `**${countingState.record}**`, inline: true },
                    { name: '🪦 Wall of Shame', value: shameList },
                ],
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
            countingState.wallOfShame = [];
            await saveCountingQuick();
            await interaction.reply({ content: '✅ Counting game reset to zero.', ephemeral: true });
            return;
        }

        if (interaction.commandName === 'set-counter') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const num = interaction.options.getInteger('number');
            countingState.current = num;
            countingState.lastUserId = null; // anyone can send next number
            if (num > countingState.record) countingState.record = num;
            await interaction.reply({ content: `✅ Count set to **${num}**. Next number is **${num + 1}**.`, ephemeral: true });
            saveCountingQuick().catch(() => {});
            return;
        }

        // ── /xp ──────────────────────────────────────────────────────────────
        if (interaction.commandName === 'xp') {
            const isMod = interaction.user.id === OWNER_DISCORD_ID || interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
            if (!isMod) {
                await interaction.reply({ content: '❌ Only the owner or moderators can adjust XP.', ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 6000);
                return;
            }
            const sub    = interaction.options.getSubcommand();
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const today  = todayStr();

            const bData = voiceBonusXp.get(target.id) || { total: 0, days: new Map() };
            if (sub === 'give') {
                bData.total += amount;
                bData.days.set(today, (bData.days.get(today) || 0) + amount);
                voiceBonusXp.set(target.id, bData);
                const newTotal = monthlyActivityScore(target.id);
                const member = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (member) assignVoiceRank(member, newTotal).catch(() => {});
                await interaction.reply({ content: `✅ Gave **${amount} XP** to <@${target.id}>. They now have **${newTotal} XP** this month.`, ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            } else {
                const deduct = Math.min(amount, bData.total);
                bData.total = Math.max(0, bData.total - amount);
                const todayVal = bData.days.get(today) || 0;
                bData.days.set(today, Math.max(0, todayVal - amount));
                voiceBonusXp.set(target.id, bData);
                const newTotal = monthlyActivityScore(target.id);
                const member = await interaction.guild.members.fetch(target.id).catch(() => null);
                if (member) assignVoiceRank(member, newTotal).catch(() => {});
                await interaction.reply({ content: `✅ Removed **${deduct} XP** from <@${target.id}>. They now have **${newTotal} XP** this month.`, ephemeral: true });
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
            }
            return;
        }

        // ── /counting-set-record ─────────────────────────────────────────────
        if (interaction.commandName === 'counting-set-record') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const num = interaction.options.getInteger('number');
            countingState.record = num;
            await saveCountingQuick();
            await interaction.reply({ content: `✅ All-time record set to **${num}**.`, ephemeral: true });
            return;
        }

        // ── /counting-add-shame ──────────────────────────────────────────────
        if (interaction.commandName === 'counting-add-shame') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const user = interaction.options.getUser('user');
            const highest = interaction.options.getInteger('highest_fail');
            const existing = countingState.wallOfShame.find(e => e.userId === user.id);
            if (existing) {
                existing.highest = highest;
            } else {
                countingState.wallOfShame.push({ userId: user.id, highest });
            }
            countingState.wallOfShame.sort((a, b) => b.highest - a.highest);
            await saveCountingQuick();
            await interaction.reply({ content: `✅ <@${user.id}> set on wall of shame — highest fail: **${highest}**.`, ephemeral: true });
            return;
        }

        // ── /counting-remove-shame ───────────────────────────────────────────
        if (interaction.commandName === 'counting-remove-shame') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const user = interaction.options.getUser('user');
            const before = countingState.wallOfShame.length;
            countingState.wallOfShame = countingState.wallOfShame.filter(e => e.userId !== user.id);
            const removed = before - countingState.wallOfShame.length;
            if (removed > 0) {
                await saveCountingQuick();
                await interaction.reply({ content: `✅ Removed <@${user.id}> from the wall of shame.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `<@${user.id}> is not on the wall of shame.`, ephemeral: true });
            }
            return;
        }

        // ── /reset-ranks ─────────────────────────────────────────────────────
        if (interaction.commandName === 'reset-ranks') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            const guild = interaction.guild;
            const allRankIds = VOICE_RANK_ROLES.map(r => r.id);
            const bronzeId = VOICE_RANK_ROLES[0].id;
            let reset = 0;
            for (const [, member] of guild.members.cache) {
                if (member.user.bot) continue;
                const hasRanks = member.roles.cache.filter(r => allRankIds.includes(r.id));
                if (hasRanks.size > 0) {
                    for (const [, role] of hasRanks) {
                        if (role.id !== bronzeId) await member.roles.remove(role).catch(() => {});
                    }
                }
                if (!member.roles.cache.has(bronzeId)) {
                    await member.roles.add(bronzeId).catch(() => {});
                }
                reset++;
            }
            rankAchievements.clear();
            await interaction.editReply(`✅ Reset **${reset}** members to 🥉 Bronze I. All rank achievement records cleared.`);
            return;
        }

        if (interaction.commandName === 'scanmessages') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const days = interaction.options.getInteger('days') || 30;
            await interaction.deferReply({ ephemeral: true });

            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const guild = interaction.guild;
            const channels = [...guild.channels.cache.values()].filter(c =>
                c.type === ChannelType.GuildText && c.viewable
            );

            const scanned = new Map(); // userId → Map<day, count>
            let totalMessages = 0;

            for (const channel of channels) {
                let lastId = null;
                let done = false;
                while (!done) {
                    try {
                        const options = { limit: 100 };
                        if (lastId) options.before = lastId;
                        const msgs = await channel.messages.fetch(options).catch(() => null);
                        if (!msgs || msgs.size === 0) break;
                        let reachedCutoff = false;
                        for (const msg of msgs.values()) {
                            if (msg.createdTimestamp < cutoff) { reachedCutoff = true; break; }
                            if (msg.author.bot) continue;
                            const uid = msg.author.id;
                            const day = new Date(msg.createdTimestamp).toISOString().slice(0, 10);
                            if (!scanned.has(uid)) scanned.set(uid, new Map());
                            const dMap = scanned.get(uid);
                            dMap.set(day, (dMap.get(day) || 0) + 1);
                            totalMessages++;
                        }
                        if (reachedCutoff) break;
                        const oldest = [...msgs.values()].reduce((a, b) => a.createdTimestamp < b.createdTimestamp ? a : b);
                        lastId = oldest.id;
                        if (oldest.createdTimestamp < cutoff) done = true;
                    } catch { break; }
                }
            }

            // Merge scanned data — take the HIGHER of scanned vs existing for each day
            let updated = 0;
            for (const [uid, dMap] of scanned.entries()) {
                const existing = messageDays.get(uid) || new Map();
                let changed = false;
                for (const [day, count] of dMap.entries()) {
                    if ((existing.get(day) || 0) < count) {
                        existing.set(day, count);
                        changed = true;
                    }
                }
                if (changed) {
                    messageDays.set(uid, existing);
                    let total = 0;
                    for (const v of existing.values()) total += v;
                    messageCounts.set(uid, total);
                    // Re-sync rank
                    const member = guild.members.cache.get(uid);
                    if (member) assignVoiceRank(member, monthlyActivityScore(uid)).catch(() => {});
                    updated++;
                }
            }

            console.log(`[BeastBot] /scanmessages: scanned ${channels.length} channels, found ${totalMessages} msgs, updated ${updated} users`);
            await interaction.editReply(`✅ Scanned ${channels.length} channels for the last **${days} days**.\nFound **${totalMessages} messages** across all users.\nUpdated counts for **${updated} users** and re-synced their ranks.`);
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
                const buffer = await generateProfileImage(interaction.user.id, interaction.guild);
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
            setTimeout(() => process.exit(1), 1000);
            return;
        }

        // ── /backup-status ───────────────────────────────────────────────────
        if (interaction.commandName === 'backup-status') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const voiceTotal = [...voiceMinutes.values()].reduce((s, v) => s + v.total, 0);
            const msgTotal = [...messageCounts.values()].reduce((s, v) => s + v, 0);
            const rxTotal = [...reactionDays.values()].reduce((s, m) => { for (const v of m.values()) s += v; return s; }, 0);
            const bonusTotal = [...voiceBonusXp.values()].reduce((s, v) => s + v.total, 0);
            await interaction.reply({ ephemeral: true, embeds: [{
                title: '💾 Backup Status',
                color: 0x3b82f6,
                fields: [
                    { name: '📡 Live Backup', value: `Saving every 60s to Discord\nBackup msg: ${_discordBackupMsgId ? `\`${_discordBackupMsgId}\`` : '❌ None'}`, inline: false },
                    { name: '📅 Daily Snapshot', value: `Last: \`${_lastDailySnapshotDate || 'none'}\`\nRetention: 14 days`, inline: true },
                    { name: '🔥 Firestore Mirror', value: `Last: \`${_lastDailyFirestoreDate || 'none'}\`\nWrites/day: ~${voiceMinutes.size + rankAchievements.size + messageDays.size + 5}`, inline: true },
                    { name: '👥 Voice', value: `${voiceMinutes.size} users\n${Math.floor(voiceTotal / 60)}h ${voiceTotal % 60}m total`, inline: true },
                    { name: '💬 Messages', value: `${messageDays.size} users\n${msgTotal.toLocaleString()} total`, inline: true },
                    { name: '🏆 Ranks', value: `${rankAchievements.size} users tracked`, inline: true },
                    { name: '😀 Reactions', value: `${reactionDays.size} users\n${rxTotal.toLocaleString()} total`, inline: true },
                    { name: '🎯 Bonus XP', value: `${voiceBonusXp.size} users\n${bonusTotal.toLocaleString()} total`, inline: true },
                    { name: '🔢 Counting', value: `Current: ${countingState.current}\nRecord: ${countingState.record}\nWall: ${countingState.wallOfShame?.length || 0} entries`, inline: true },
                ],
                timestamp: new Date().toISOString(),
            }]});
            return;
        }

        // ── /backup-snapshot ─────────────────────────────────────────────────
        if (interaction.commandName === 'backup-snapshot') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const dateStr = todayStr();
                const data = buildFullBackup();
                const buf  = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
                const file = new AttachmentBuilder(buf, { name: `daily-${dateStr}.json` });
                const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
                await ch.send({ content: `📅 Daily Snapshot — ${dateStr} (manual)`, files: [file] });
                await interaction.editReply(`✅ Snapshot saved: \`daily-${dateStr}.json\``);
            } catch (e) {
                await interaction.editReply(`❌ Snapshot failed: ${e.message}`);
            }
            return;
        }

        // ── /backup-list ─────────────────────────────────────────────────────
        if (interaction.commandName === 'backup-list') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
                const msgs = await ch.messages.fetch({ limit: 50 });
                const snapshots = [];
                for (const m of msgs.values()) {
                    if (m.author.id !== client.user.id) continue;
                    for (const att of m.attachments.values()) {
                        const match = att.name.match(/^daily-(\d{4}-\d{2}-\d{2})\.json$/);
                        if (match) {
                            const age = Math.floor((Date.now() - m.createdTimestamp) / 86400000);
                            snapshots.push(`\`${match[1]}\` — ${age}d ago`);
                        }
                    }
                }
                if (snapshots.length === 0) {
                    await interaction.editReply('📅 No daily snapshots found.');
                } else {
                    await interaction.editReply(`📅 **Available Snapshots (${snapshots.length}):**\n${snapshots.join('\n')}\n\nRestore with: \`/backup-restore date:YYYY-MM-DD\``);
                }
            } catch (e) {
                await interaction.editReply(`❌ Failed: ${e.message}`);
            }
            return;
        }

        // ── /backup-restore ──────────────────────────────────────────────────
        if (interaction.commandName === 'backup-restore') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            const targetDate = interaction.options.getString('date');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
                await interaction.reply({ content: '❌ Invalid date format. Use YYYY-MM-DD.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
                const msgs = await ch.messages.fetch({ limit: 50 });
                let snapshotUrl = null;
                for (const m of msgs.values()) {
                    if (m.author.id !== client.user.id) continue;
                    const att = m.attachments.find(a => a.name === `daily-${targetDate}.json`);
                    if (att) { snapshotUrl = att.url; break; }
                }
                if (!snapshotUrl) {
                    await interaction.editReply(`❌ No snapshot found for \`${targetDate}\`. Use \`/backup-list\` to see available dates.`);
                    return;
                }
                const res = await fetch(snapshotUrl);
                if (!res.ok) throw new Error(`Download failed: ${res.status}`);
                const data = await res.json();

                // Apply to in-memory state
                applyBackupToMemory(data);

                // Save as live backup immediately
                await saveDiscordBackup();

                const voiceTotal = [...voiceMinutes.values()].reduce((s, v) => s + v.total, 0);
                const msgTotal = [...messageCounts.values()].reduce((s, v) => s + v, 0);
                await interaction.editReply(
                    `✅ **Restored from \`${targetDate}\`**\n` +
                    `👥 ${voiceMinutes.size} voice users (${Math.floor(voiceTotal / 60)}h ${voiceTotal % 60}m)\n` +
                    `💬 ${messageDays.size} message users (${msgTotal.toLocaleString()} msgs)\n` +
                    `🏆 ${rankAchievements.size} rank records\n` +
                    `🔢 Counting record: ${countingState.record}`
                );
            } catch (e) {
                await interaction.editReply(`❌ Restore failed: ${e.message}`);
            }
            return;
        }

        // ── /backup-wipe ─────────────────────────────────────────────────────
        if (interaction.commandName === 'backup-wipe') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                // Clear all in-memory state
                voiceMinutes.clear();
                messageDays.clear();
                messageCounts.clear();
                rankAchievements.clear();
                reactionDays.clear();
                emojiTally.clear();
                reactionEmojiDays.clear();
                voiceBonusXp.clear();
                conversationHistory.clear();
                countingState.current = 0;
                countingState.lastUserId = null;
                countingState.record = 0;
                countingState.wallOfShame = [];

                // Save empty state as live backup
                await saveDiscordBackup();

                // Post a wipe snapshot
                const dateStr = todayStr();
                const data = buildFullBackup();
                const buf  = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
                const file = new AttachmentBuilder(buf, { name: `daily-${dateStr}.json` });
                const ch   = await client.channels.fetch(BACKUP_CHANNEL_ID);
                await ch.send({ content: `📅 WIPE — ${dateStr}`, files: [file] });

                await interaction.editReply('🔥 **All data wiped.** Everyone starts at 0.\nA wipe snapshot has been saved in case you need to reference it.');
            } catch (e) {
                await interaction.editReply(`❌ Wipe failed: ${e.message}`);
            }
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

            // Data persisted via Discord backup every 60s — no immediate Firestore write

            await interaction.editReply(
                `✅ Scan complete!\n` +
                `📨 **${totalMsgs.toLocaleString()}** messages across **${chDone}** channels\n` +
                `👥 **${scanned.size}** users' daily counts updated (saved in next backup cycle)`
            );
            return;
        }

        // ── /scanreactions ────────────────────────────────────────────────────
        if (interaction.commandName === 'scanreactions') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', flags: 64 });
                return;
            }
            await interaction.deferReply({ flags: 64 });

            const days = interaction.options.getInteger('days') || 2;
            const since = Date.now() - days * 24 * 60 * 60 * 1000;
            const sinceStr = new Date(since).toISOString().slice(0, 10);
            const botMember = interaction.guild.members.me;
            const channels = interaction.guild.channels.cache.filter(ch =>
                ch.isTextBased() && !ch.isDMBased?.() &&
                ch.permissionsFor(botMember)?.has('ReadMessageHistory')
            );

            await interaction.editReply(`⏳ Scanning **${channels.size}** channels for reactions over the last **${days}** day(s)...`);

            // scanned: userId → { days: Map<date, count>, emojiDays: Map<date, Map<emoji, count>> }
            const scanned = new Map();
            let totalRxs = 0, chDone = 0;

            for (const [, channel] of channels) {
                let lastId = null;
                let keepGoing = true;
                while (keepGoing) {
                    // Use discordRestFetch (AbortController) — actually cancels the HTTP request on
                    // timeout, unlike Promise.race which left Discord.js's queue blocked.
                    const params = `limit=100${lastId ? `&before=${lastId}` : ''}`;
                    const batch = await discordRestFetch(`/channels/${channel.id}/messages?${params}`);
                    if (!batch || batch.length === 0) break;
                    for (const msg of batch) {
                        const msgTs = new Date(msg.timestamp).getTime();
                        if (msgTs < since) { keepGoing = false; break; }
                        if (!msg.reactions?.length) continue;
                        const ds = msg.timestamp.slice(0, 10);
                        for (const rxn of msg.reactions) {
                            const emojiKey = rxn.emoji.id
                                ? `<:${rxn.emoji.name}:${rxn.emoji.id}>`
                                : (rxn.emoji.name || '?');
                            const emojiPath = rxn.emoji.id
                                ? encodeURIComponent(`${rxn.emoji.name}:${rxn.emoji.id}`)
                                : encodeURIComponent(rxn.emoji.name || '');
                            const users = await discordRestFetch(`/channels/${channel.id}/messages/${msg.id}/reactions/${emojiPath}?limit=100`);
                            if (!users) continue;
                            for (const rxUser of users) {
                                if (rxUser.bot) continue;
                                const uid = rxUser.id;
                                if (!scanned.has(uid)) scanned.set(uid, { days: new Map(), emojiDays: new Map() });
                                const ud = scanned.get(uid);
                                ud.days.set(ds, (ud.days.get(ds) || 0) + 1);
                                let de = ud.emojiDays.get(ds);
                                if (!de) { de = new Map(); ud.emojiDays.set(ds, de); }
                                de.set(emojiKey, (de.get(emojiKey) || 0) + 1);
                                totalRxs++;
                            }
                        }
                    }
                    lastId = batch[batch.length - 1]?.id;
                    if (batch.length < 100) break;
                }
                chDone++;
                if (chDone % 3 === 0) await interaction.editReply(`⏳ **${chDone}/${channels.size}** channels, **${totalRxs.toLocaleString()}** reactions so far...`).catch(() => {});
            }

            // Merge into in-memory state — overwrite scan-window dates, keep older
            for (const [uid, ud] of scanned) {
                let rMap = reactionDays.get(uid);
                if (!rMap) { rMap = new Map(); reactionDays.set(uid, rMap); }
                for (const [k] of [...rMap]) if (k >= sinceStr) rMap.delete(k);
                for (const [k, v] of ud.days) rMap.set(k, v);

                let eMap = emojiTally.get(uid) || new Map();
                let edMap = reactionEmojiDays.get(uid);
                if (!edMap) { edMap = new Map(); reactionEmojiDays.set(uid, edMap); }
                for (const [k] of [...edMap]) if (k >= sinceStr) edMap.delete(k);
                for (const [day, de] of ud.emojiDays) {
                    edMap.set(day, de);
                    for (const [emoji, count] of de) eMap.set(emoji, (eMap.get(emoji) || 0) + count);
                }
                emojiTally.set(uid, eMap);
            }

            // Save to Firestore
            const userIds = [...scanned.keys()];
            for (let i = 0; i < userIds.length; i += 10) {
                await Promise.allSettled(userIds.slice(i, i + 10).map(uid =>
                    saveReactionData(uid, reactionDays.get(uid) || new Map(), emojiTally.get(uid) || new Map(), reactionEmojiDays.get(uid))
                ));
            }

            await interaction.editReply(
                `✅ Reaction scan complete!\n` +
                `👍 **${totalRxs.toLocaleString()}** reactions across **${chDone}** channels\n` +
                `👥 **${scanned.size}** users' reaction data updated`
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

        // ── /setup-thoughts ──────────────────────────────────────────────────
        if (interaction.commandName === 'setup-thoughts') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', flags: 64 }); return;
            }
            try {
                const ch = await client.channels.fetch(THOUGHTS_CHANNEL_ID);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('thought:open:anon')
                        .setLabel('🎭 Anonymous')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('thought:open:public')
                        .setLabel('📢 Non-Anonymous')
                        .setStyle(ButtonStyle.Success),
                );
                await ch.send({
                    embeds: [{
                        title: '💭 Share Your Thoughts',
                        description: 'Got something on your mind? Share a thought with the community — anonymously or with your name attached.\n\nClick a button below to get started.',
                        color: 0x22c55e,
                        footer: { text: 'You can delete your own thought at any time.' },
                    }],
                    components: [row],
                });
                await interaction.reply({ content: '✅ Thoughts prompt posted.', flags: 64 });
            } catch (e) {
                await interaction.reply({ content: `❌ Failed: ${e.message}`, flags: 64 });
            }
            return;
        }

        // ── /fitness-setup ───────────────────────────────────────────────────
        if (interaction.commandName === 'fitness-setup') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', flags: 64 }); return;
            }
            try {
                const ch = await client.channels.fetch(FITNESS_TRACKING_CHANNEL_ID);
                await ch.send({
                    embeds: [{
                        color: 0x22c55e,
                        title: '🏋️ TrueBeast Fitness Tracker',
                        description: 'Track your workouts, share your progress, and hold each other accountable.\n\nClick the button below to log a workout — choose how often you train and whether to share publicly or keep it private.',
                        fields: [
                            { name: '📅 Frequency', value: 'Daily · Weekly · Monthly', inline: true },
                            { name: '🔒 Privacy', value: 'Public (shared) or Private (just you)', inline: true },
                        ],
                        footer: { text: 'Use /fitness progress to see your stats anytime.' },
                    }],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('fitness:start').setLabel('🏋️ Log a Workout').setStyle(ButtonStyle.Success)
                    )],
                });
                await interaction.reply({ content: '✅ Fitness tracker posted in #tracking.', flags: 64 });
            } catch (e) {
                await interaction.reply({ content: `❌ Failed: ${e.message}`, flags: 64 });
            }
            return;
        }

        // ── /fitness ─────────────────────────────────────────────────────────
        if (interaction.commandName === 'fitness') {
            // deferReply FIRST — before getSubcommand() or any routing that could throw.
            // This guarantees Discord receives an acknowledgement within 3 s regardless
            // of what happens next. All subcommand responses use editReply().
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            } catch (e) {
                console.error('[BeastBot] /fitness deferReply failed:', e.message);
                return; // token is dead — nothing we can do
            }

            try {
                const sub  = interaction.options.getSubcommand(false);
                const user = interaction.user;
                const uid  = user.id;

                if (sub === 'alarm-test') {
                    const voicePinged = interaction.guild ? await playWorkoutAlarm(interaction.guild, uid).catch(() => false) : false;
                    await interaction.editReply({ content: voicePinged ? '🔔 Alarm played (2×)!' : '❌ Alarm failed — make sure you\'re in a voice channel.' });
                    return;
                }

                if (sub === 'progress') {
                    const userData = fitnessData.get(uid);
                    const entries  = userData?.entries || [];
                    const total    = entries.length;
                    const streak   = calcStreak(entries);
                    const avg      = calcAvgDuration(entries);
                    const last5    = [...entries].reverse().slice(0, 5);
                    const fields = [
                        { name: '📊 Total Workouts', value: `**${total}**`, inline: true },
                        { name: '🔥 Current Streak', value: `**${streak} day${streak !== 1 ? 's' : ''}**`, inline: true },
                        { name: '⏱️ Avg Duration', value: avg !== null ? `**${avg} min**` : '*N/A*', inline: true },
                    ];
                    if (userData?.notify) {
                        fields.push({ name: '⏰ Workout Reminder', value: `**${userData.notify.timeRaw}** on **${userData.notify.days}** *(fires at ${userData.notify.timeUtc} UTC)*`, inline: false });
                    }
                    fields.push({
                        name: '📋 Last 5 Workouts',
                        value: last5.length > 0
                            ? last5.map(e => `**${e.date}** — ${e.workout.slice(0, 40)}${e.workout.length > 40 ? '...' : ''} *(${e.duration})*`).join('\n')
                            : '*No workouts logged yet. Hit that button in #tracking!*',
                        inline: false,
                    });
                    const member = interaction.member;
                    await interaction.editReply({
                        embeds: [{
                            color: 0x5865f2,
                            author: { name: `${member?.displayName || user.username}'s Fitness Progress`, icon_url: user.displayAvatarURL({ dynamic: true }) },
                            fields,
                            footer: { text: 'Log more workouts with the button in #tracking' },
                            timestamp: new Date().toISOString(),
                        }],
                    });
                    return;
                }

                if (sub === 'notify') {
                    const hour    = interaction.options.getInteger('hour');
                    const period  = interaction.options.getString('period');
                    const minute  = interaction.options.getInteger('minute');
                    const tzStr   = interaction.options.getString('timezone');
                    const daysStr = interaction.options.getString('days');

                    let h24 = hour;
                    if (period === 'AM' && hour === 12) h24 = 0;
                    else if (period === 'PM' && hour !== 12) h24 = hour + 12;

                    const off = parseFloat(tzStr) || 0;
                    const totalMinsLocal = h24 * 60 + minute;
                    const totalMinsUtc = ((totalMinsLocal - off * 60) % 1440 + 1440) % 1440;
                    const utcH = Math.floor(totalMinsUtc / 60);
                    const utcM = totalMinsUtc % 60;
                    const timeUtc = `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
                    const timeRaw = `${hour}:${String(minute).padStart(2, '0')} ${period}`;

                    const dayPatterns = {
                        daily:    { set: [0,1,2,3,4,5,6], display: 'Every day' },
                        weekdays: { set: [1,2,3,4,5],     display: 'Weekdays (Mon–Fri)' },
                        weekends: { set: [0,6],            display: 'Weekends (Sat & Sun)' },
                        mwf:      { set: [1,3,5],          display: 'Mon, Wed & Fri' },
                        tt:       { set: [2,4],            display: 'Tue & Thu' },
                        mon:      { set: [1],              display: 'Monday' },
                        tue:      { set: [2],              display: 'Tuesday' },
                        wed:      { set: [3],              display: 'Wednesday' },
                        thu:      { set: [4],              display: 'Thursday' },
                        fri:      { set: [5],              display: 'Friday' },
                        sat:      { set: [6],              display: 'Saturday' },
                        sun:      { set: [0],              display: 'Sunday' },
                    };
                    const dayInfo = dayPatterns[daysStr] || dayPatterns.daily;
                    const tzLabel = TZ_LABELS[tzStr] || `UTC${off >= 0 ? '+' : ''}${tzStr}`;

                    const userData = fitnessData.get(uid) || { entries: [], notify: null };
                    userData.notify = { timeUtc, timeRaw, days: dayInfo.display, daySet: dayInfo.set, lastSentDate: null };
                    fitnessData.set(uid, userData);

                    await interaction.editReply({ content: `✅ Reminder set!\n🕐 **${timeRaw}** — ${tzLabel}\n📅 ${dayInfo.display}\n\nYou'll get a DM and a beep in your voice channel at that time.` });
                    return;
                }

                if (sub === 'manage') {
                    const userData = fitnessData.get(uid);
                    const entries  = userData?.entries || [];
                    if (entries.length === 0) {
                        await interaction.editReply({ content: '📋 You have no logged workouts yet. Use the button in #tracking to log your first one!' });
                        return;
                    }
                    const newest = [...entries].reverse().slice(0, 5);
                    const opts = newest.map(e => ({
                        label: `${e.date} — ${e.workout.slice(0, 50)}${e.workout.length > 50 ? '...' : ''}`,
                        value: e.id,
                        description: `${e.duration} · ${e.privacy} · ${e.freq}`,
                    }));
                    const editMenu = new StringSelectMenuBuilder()
                        .setCustomId('fitness:manage:edit')
                        .setPlaceholder('✏️ Select an entry to edit...')
                        .addOptions(opts);
                    const deleteMenu = new StringSelectMenuBuilder()
                        .setCustomId('fitness:manage:del')
                        .setPlaceholder('🗑️ Select an entry to delete...')
                        .addOptions(opts);
                    await interaction.editReply({
                        embeds: [{
                            color: 0x5865f2,
                            title: '📋 Manage Your Workouts',
                            description: 'Select a workout below to **edit** or **delete** it. Showing your 5 most recent entries.',
                            fields: newest.map((e, i) => ({
                                name: `${i + 1}. ${e.date} — ${e.freq}`,
                                value: `${e.workout.slice(0, 60)}${e.workout.length > 60 ? '...' : ''}\n*${e.duration} · ${e.privacy}*`,
                                inline: false,
                            })),
                            footer: { text: 'Edits to public posts will also update the #tracking message.' },
                        }],
                        components: [
                            new ActionRowBuilder().addComponents(editMenu),
                            new ActionRowBuilder().addComponents(deleteMenu),
                        ],
                    });
                    return;
                }

                if (sub === 'notify-clear') {
                    const userData = fitnessData.get(uid) || { entries: [], notify: null };
                    userData.notify = null;
                    fitnessData.set(uid, userData);
                    await interaction.editReply({ content: '✅ Workout reminder removed.' });
                    return;
                }
            } catch (e) {
                console.error('[BeastBot] /fitness error:', e.message, e.stack);
                await interaction.editReply({ content: '❌ Something went wrong — please try again.' }).catch(() => {});
            }
        }

        // ── /say ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'say') {
            if (interaction.user.id !== OWNER_DISCORD_ID) {
                await interaction.reply({ content: '❌ Owner only.', flags: 64 }); return;
            }
            const ch = interaction.options.getChannel('channel');
            const msg = interaction.options.getString('message');
            try {
                await ch.send(msg);
                await interaction.reply({ content: `✅ Message sent to <#${ch.id}>.`, flags: 64 });
                // Notify mods with a proper non-ephemeral message
                if (MOD_CHANNEL_ID) {
                    try {
                        const modCh = await client.channels.fetch(MOD_CHANNEL_ID);
                        await modCh.send({ embeds: [{
                            title: '📢 /say Used',
                            fields: [
                                { name: 'Used by', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                                { name: 'Sent to', value: `<#${ch.id}>`, inline: true },
                                { name: 'Message', value: msg.slice(0, 1024) },
                            ],
                            color: 0x5865f2,
                            timestamp: new Date().toISOString(),
                        }]});
                    } catch (_) {}
                }
            } catch (e) {
                await interaction.reply({ content: `❌ Failed to send: ${e.message}`, flags: 64 });
            }
            return;
        }

        // ── /dm ──────────────────────────────────────────────────────────────
        if (interaction.commandName === 'dm') {
            if (!isModerator(interaction)) {
                await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return;
            }
            const target = interaction.options.getUser('user');
            const msg = interaction.options.getString('message');
            try {
                await target.send(msg);
                await interaction.reply({ content: `✅ DM sent to <@${target.id}>. Action logged in <#${LOG_CHANNEL_ID}>.`, flags: 64 });
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.info, user: target,
                    description: `📩 **Bot DM sent** to <@${target.id}>`,
                    fields: [{ name: 'Message', value: msg.slice(0, 1000) }],
                    footerExtra: `Sent by: ${interaction.user.tag || interaction.user.username}`,
                }));
            } catch (e) {
                await interaction.reply({ content: `❌ Could not DM that user — they may have DMs disabled.`, flags: 64 });
            }
            return;
        }

        // ── /ban ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'ban') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const target = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const delDays = interaction.options.getInteger('delete_days') || 0;
            try {
                await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: delDays * 86400 });
                addInfraction(target.id, 'ban', reason, interaction.user.id);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.ban, user: target,
                    description: `🔨 <@${target.id}> **was banned**\nReason: ${reason}`,
                    footerExtra: `Banned by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${target.tag || target.username}** was banned. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /tempban ──────────────────────────────────────────────────────────
        if (interaction.commandName === 'tempban') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const target = interaction.options.getUser('user');
            const durStr = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const ms = parseDuration(durStr);
            if (!ms) { await interaction.editReply('❌ Invalid duration. Use e.g. `1h`, `2d`, `1w`.'); return; }
            try {
                await interaction.guild.members.ban(target.id, { reason: `Temp ban (${durStr}): ${reason}` });
                const expiresAt = Date.now() + ms;
                tempBans.set(target.id, { guildId: interaction.guild.id, expiresAt, reason });
                await saveTempBans();
                scheduleTempBan(interaction.guild, target.id, expiresAt);
                addInfraction(target.id, 'tempban', `${durStr}: ${reason}`, interaction.user.id);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.ban, user: target,
                    description: `🔨 <@${target.id}> **was temp-banned** for **${durStr}**\nReason: ${reason}`,
                    footerExtra: `Banned by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${target.tag || target.username}** temp-banned for ${durStr}. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /kick ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'kick') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const member = interaction.options.getMember('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            if (!member) { await interaction.editReply('❌ User not found in server.'); return; }
            try {
                await member.kick(reason);
                addInfraction(member.id, 'kick', reason, interaction.user.id);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.kick, user: member.user,
                    description: `👢 <@${member.id}> **was kicked**\nReason: ${reason}`,
                    footerExtra: `Kicked by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${member.user.tag || member.user.username}** was kicked. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /mute ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'mute') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const member = interaction.options.getMember('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            if (!member) { await interaction.editReply('❌ User not found in server.'); return; }
            try {
                await member.timeout(28 * 24 * 60 * 60 * 1000, reason);
                addInfraction(member.id, 'mute', reason, interaction.user.id);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.mute, user: member.user,
                    description: `🔇 <@${member.id}> **was muted** (28 days)\nReason: ${reason}`,
                    footerExtra: `Muted by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${member.user.tag || member.user.username}** was muted. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /tempmute ─────────────────────────────────────────────────────────
        if (interaction.commandName === 'tempmute') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const member = interaction.options.getMember('user');
            const durStr = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            if (!member) { await interaction.editReply('❌ User not found in server.'); return; }
            const ms = parseDuration(durStr);
            if (!ms) { await interaction.editReply('❌ Invalid duration. Use e.g. `10m`, `2h`, `1d`.'); return; }
            const cappedMs = Math.min(ms, 28 * 24 * 60 * 60 * 1000);
            try {
                await member.timeout(cappedMs, reason);
                addInfraction(member.id, 'tempmute', `${durStr}: ${reason}`, interaction.user.id);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.mute, user: member.user,
                    description: `🔇 <@${member.id}> **was muted** for **${durStr}**\nReason: ${reason}`,
                    footerExtra: `Muted by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${member.user.tag || member.user.username}** was muted for ${durStr}. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /unmute ───────────────────────────────────────────────────────────
        if (interaction.commandName === 'unmute') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const member = interaction.options.getMember('user');
            if (!member) { await interaction.editReply('❌ User not found in server.'); return; }
            try {
                await member.timeout(null);
                await sendLog(interaction.guild, buildLogEmbed({
                    color: LOG_COLORS.join, user: member.user,
                    description: `🔊 <@${member.id}> **was unmuted**`,
                    footerExtra: `Unmuted by: ${interaction.user.tag || interaction.user.username}`,
                }));
                await interaction.editReply(`✅ **${member.user.tag || member.user.username}** was unmuted. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /unban ────────────────────────────────────────────────────────────
        if (interaction.commandName === 'unban') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const userId = interaction.options.getString('userid');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            try {
                const bannedUser = await client.users.fetch(userId).catch(() => null);
                await interaction.guild.bans.remove(userId, reason);
                tempBans.delete(userId);
                await saveTempBans();
                await sendLog(interaction.guild, {
                    color: LOG_COLORS.join,
                    description: `✅ User **${bannedUser?.tag || bannedUser?.username || userId}** was unbanned`,
                    thumbnail: bannedUser ? { url: bannedUser.displayAvatarURL({ size: 128, extension: 'png' }) } : undefined,
                    timestamp: new Date().toISOString(),
                    footer: { text: `ID: ${userId} • Unbanned by: ${interaction.user.tag || interaction.user.username}` },
                });
                await interaction.editReply(`✅ User **${bannedUser?.tag || bannedUser?.username || userId}** was unbanned. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /warn ─────────────────────────────────────────────────────────────
        if (interaction.commandName === 'warn') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const target = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            addInfraction(target.id, 'warn', reason, interaction.user.id);
            try { await target.send(`⚠️ You have received a warning in **${interaction.guild.name}**:\n> ${reason}`); } catch (_) {}
            await sendLog(interaction.guild, buildLogEmbed({
                color: LOG_COLORS.warn, user: target,
                description: `⚠️ <@${target.id}> **was warned**\nReason: ${reason}`,
                footerExtra: `Warned by: ${interaction.user.tag || interaction.user.username}`,
            }));
            await interaction.editReply(`✅ **${target.tag || target.username}** was warned. Action logged in <#${LOG_CHANNEL_ID}>.`);
            return;
        }

        // ── /infractions ──────────────────────────────────────────────────────
        if (interaction.commandName === 'infractions') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            const target = interaction.options.getUser('user');
            const list = getUserInfractions(target.id);
            if (list.length === 0) {
                await interaction.reply({ content: `✅ **${target.tag || target.username}** has no infractions.`, flags: 64 }); return;
            }
            const fields = list.slice(-10).map((inf, i) => ({
                name: `#${i + 1} — ${inf.type.toUpperCase()}`,
                value: `Reason: ${inf.reason}\nBy: <@${inf.modId}> • <t:${Math.floor(inf.timestamp / 1000)}:D>`,
            }));
            await interaction.reply({ embeds: [{
                color: LOG_COLORS.warn,
                author: { name: target.username || target.tag, icon_url: target.displayAvatarURL?.({ size: 64, extension: 'png' }) },
                title: `Infractions — ${list.length} total`,
                fields,
                timestamp: new Date().toISOString(),
                footer: { text: `ID: ${target.id}` },
            }], flags: 64 });
            return;
        }

        // ── /clear-all-infractions ────────────────────────────────────────────
        if (interaction.commandName === 'clear-all-infractions') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            await clearAllInfractions();
            await interaction.editReply('✅ All infractions cleared.');
            return;
        }

        // ── /clear ────────────────────────────────────────────────────────────
        if (interaction.commandName === 'clear') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const amount = interaction.options.getInteger('amount');
            const ch = interaction.options.getChannel('channel') || interaction.channel;
            try {
                const msgs = await ch.messages.fetch({ limit: amount });
                const deleted = await ch.bulkDelete(msgs, true);
                await sendLog(interaction.guild, {
                    color: LOG_COLORS.delete,
                    description: `🗑️ **${deleted.size}** messages cleared in <#${ch.id}>`,
                    timestamp: new Date().toISOString(),
                    footer: { text: `Cleared by: ${interaction.user.tag || interaction.user.username}` },
                });
                await interaction.editReply(`✅ Deleted **${deleted.size}** messages. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /slowmode ─────────────────────────────────────────────────────────
        if (interaction.commandName === 'slowmode') {
            if (!isModerator(interaction)) { await interaction.reply({ content: '❌ Mods only.', flags: 64 }); return; }
            await interaction.deferReply({ flags: 64 });
            const seconds = interaction.options.getInteger('seconds');
            const ch = interaction.options.getChannel('channel') || interaction.channel;
            try {
                await ch.setRateLimitPerUser(seconds);
                const msg = seconds === 0 ? 'Slowmode disabled' : `Slowmode set to ${seconds}s`;
                await sendLog(interaction.guild, {
                    color: LOG_COLORS.info,
                    description: `⏱️ **${msg}** in <#${ch.id}>`,
                    timestamp: new Date().toISOString(),
                    footer: { text: `Set by: ${interaction.user.tag || interaction.user.username}` },
                });
                await interaction.editReply(`✅ ${msg} in <#${ch.id}>. Action logged in <#${LOG_CHANNEL_ID}>.`);
            } catch (e) { await interaction.editReply(`❌ Failed: ${e.message}`); }
            return;
        }

        // ── /user-info ────────────────────────────────────────────────────────
        if (interaction.commandName === 'user-info') {
            const target = interaction.options.getUser('user') || interaction.user;
            const member = interaction.guild.members.cache.get(target.id);
            const avatarUrl = target.displayAvatarURL({ size: 256, extension: 'png' });
            const roles = member?.roles?.cache?.filter(r => r.name !== '@everyone').map(r => `<@&${r.id}>`).join(', ') || 'None';
            await interaction.reply({ embeds: [{
                color: LOG_COLORS.info,
                author: { name: target.username || target.tag, icon_url: avatarUrl },
                thumbnail: { url: avatarUrl },
                fields: [
                    { name: 'Username', value: target.tag || target.username, inline: true },
                    { name: 'User ID', value: target.id, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
                    { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Not in server', inline: true },
                    { name: 'Nickname', value: member?.nickname || 'None', inline: true },
                    { name: 'Bot', value: target.bot ? 'Yes' : 'No', inline: true },
                    { name: 'Roles', value: roles.slice(0, 1024) || 'None' },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: `ID: ${target.id}` },
            }], flags: 64 });
            return;
        }

        // ── /role-info ────────────────────────────────────────────────────────
        if (interaction.commandName === 'role-info') {
            const role = interaction.options.getRole('role');
            const memberCount = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
            await interaction.reply({ embeds: [{
                color: role.color || 0x5865f2,
                title: `Role: ${role.name}`,
                fields: [
                    { name: 'Role ID', value: role.id, inline: true },
                    { name: 'Color', value: role.hexColor, inline: true },
                    { name: 'Members', value: String(memberCount), inline: true },
                    { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
                    { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
                    { name: 'Position', value: String(role.position), inline: true },
                    { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
                ],
                timestamp: new Date().toISOString(),
                footer: { text: `ID: ${role.id}` },
            }], flags: 64 });
            return;
        }

        // ── /server-info ──────────────────────────────────────────────────────
        if (interaction.commandName === 'server-info') {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner().catch(() => null);
            await interaction.reply({ embeds: [{
                color: LOG_COLORS.info,
                author: { name: guild.name, icon_url: guild.iconURL({ size: 128 }) || undefined },
                thumbnail: guild.iconURL({ size: 256 }) ? { url: guild.iconURL({ size: 256 }) } : undefined,
                fields: [
                    { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
                    { name: 'Members', value: String(guild.memberCount), inline: true },
                    { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
                    { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
                    { name: 'Boosts', value: String(guild.premiumSubscriptionCount || 0), inline: true },
                    { name: 'Boost Tier', value: `Level ${guild.premiumTier}`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                    { name: 'Server ID', value: guild.id, inline: true },
                ],
                timestamp: new Date().toISOString(),
            }] });
            return;
        }

    }

    // ── Introduction modal submit ─────────────────────────────────────────────
    // ── Thought edit modal submit ─────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('thought:edit_modal:')) {
        const parts    = interaction.customId.split(':');
        const msgId    = parts[2];
        const isAnon   = parts[3] === 'anon';
        const newText  = interaction.fields.getTextInputValue('thought_text');
        const linkUrl  = interaction.fields.getTextInputValue('thought_link_url').trim();
        const linkLabel = interaction.fields.getTextInputValue('thought_link_label').trim();
        const imageUrl = interaction.fields.getTextInputValue('thought_image_url').trim();
        const user     = interaction.user;
        const member   = interaction.member;
        const display  = member?.displayName || user.username;
        try {
            const thoughtChannel = await client.channels.fetch(THOUGHTS_CHANNEL_ID);
            const msg = await thoughtChannel.messages.fetch(msgId);
            const editEmbed = {
                description: `💭 **${isAnon ? 'Anonymous User' : display}**\n${newText}`,
                color: isAnon ? 0xf59e0b : 0x22c55e,
            };
            if (imageUrl) editEmbed.image = { url: imageUrl };
            const editActionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('thought:open:anon').setLabel('🎭 Anonymous').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('thought:open:public').setLabel('📢 Non-Anonymous').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('thought:thread').setLabel('💬 Discuss').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`thought:edit:${user.id}`).setLabel('✏️ Edit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`thought:delete:${user.id}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Secondary),
            );
            const editComponents = [];
            if (linkUrl) editComponents.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel(linkLabel || '🔗 Link').setURL(linkUrl).setStyle(ButtonStyle.Link),
            ));
            editComponents.push(editActionRow);
            await msg.edit({
                embeds: [editEmbed],
                components: editComponents,
            });
            // Log the edit
            try {
                const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
                await logCh.send({ embeds: [{
                    title: '✏️ Thought Edited',
                    fields: [
                        { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: true },
                        { name: 'Posted as', value: isAnon ? 'Anonymous' : 'Public', inline: true },
                        { name: 'New text', value: newText.slice(0, 1024) },
                    ],
                    color: 0xf59e0b,
                    timestamp: new Date().toISOString(),
                }]});
            } catch (_) {}
            await interaction.reply({ content: '✅ Your thought has been updated.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            console.error('[BeastBot] Failed to edit thought:', e.message);
            await interaction.reply({ content: '❌ Could not edit that thought. It may have been deleted.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Thought modal submit ──────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('thought:modal:')) {
        const isAnon   = interaction.customId === 'thought:modal:anon';
        const text     = interaction.fields.getTextInputValue('thought_text');
        const linkUrl  = interaction.fields.getTextInputValue('thought_link_url').trim();
        const linkLabel = interaction.fields.getTextInputValue('thought_link_label').trim();
        const imageUrl  = interaction.fields.getTextInputValue('thought_image_url').trim();
        const user     = interaction.user;
        const member   = interaction.member;
        const display  = member?.displayName || user.username;

        try {
            const thoughtChannel = await client.channels.fetch(THOUGHTS_CHANNEL_ID);
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('thought:open:anon').setLabel('🎭 Anonymous').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('thought:open:public').setLabel('📢 Non-Anonymous').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('thought:thread').setLabel('💬 Discuss').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`thought:edit:${user.id}`).setLabel('✏️ Edit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`thought:delete:${user.id}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Secondary),
            );

            const newEmbed = {
                description: `💭 **${isAnon ? 'Anonymous User' : display}**\n${text}`,
                color: isAnon ? 0xf59e0b : 0x22c55e,
            };
            if (imageUrl) newEmbed.image = { url: imageUrl };
            const components = [];
            if (linkUrl) components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel(linkLabel || '🔗 Link').setURL(linkUrl).setStyle(ButtonStyle.Link),
            ));
            components.push(actionRow);
            await thoughtChannel.send({ embeds: [newEmbed], components });

            // Log to #logs — always shows who submitted regardless of anonymity
            try {
                const logCh = await client.channels.fetch(LOG_CHANNEL_ID);
                await logCh.send({ embeds: [{
                    title: '💭 Thought Submitted',
                    fields: [
                        { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: true },
                        { name: 'Posted as', value: isAnon ? 'Anonymous' : 'Public', inline: true },
                        { name: 'Thought', value: text.slice(0, 1024) },
                    ],
                    color: isAnon ? 0xf59e0b : 0x22c55e,
                    timestamp: new Date().toISOString(),
                }]});
            } catch (_) {}

            await interaction.reply({ content: `✅ Your thought has been posted${isAnon ? ' anonymously' : ''}!`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            console.log(`[BeastBot] 💭 Thought posted by ${user.tag} (${isAnon ? 'anonymous' : 'public'})`);
        } catch (e) {
            console.error('[BeastBot] Failed to post thought:', e.message);
            await interaction.reply({ content: '❌ Something went wrong posting your thought. Try again.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

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
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            console.log(`[BeastBot] 📋 Introduction posted for ${user.tag}`);
        } catch (e) {
            console.error('[BeastBot] Failed to post introduction:', e.message);
            await interaction.reply({ content: '❌ Something went wrong posting your intro. Try again or let Kiernen know.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Imposter Game — answer modal ──────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'imp:answer_modal') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'answer') { await impReply(interaction, 'No active answer phase.'); return; }
        const player = game.players.get(interaction.user.id);
        if (!player) { await impReply(interaction, 'You are not in this game.'); return; }
        if (player.answer !== null) { await impReply(interaction, 'You already submitted your answer!'); return; }

        player.answer = interaction.fields.getTextInputValue('imp_answer_text').trim().slice(0, 200);

        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (channel) {
            try {
                const msg = await channel.messages.fetch(game.gameMsgId).catch(() => null);
                if (msg) await msg.edit({ embeds: [impAnswerEmbed(game)], components: impAnswerComponents() });
            } catch (_) {}
            // Update host's control message too
            if (game.hostMsgId) {
                try {
                    const hostMsg = await channel.messages.fetch(game.hostMsgId).catch(() => null);
                    const done = [...game.players.values()].filter(p => p.answer !== null).length;
                    if (hostMsg) await hostMsg.edit({ content: `**Host controls** — ${done}/${game.players.size} answered\nPress Reveal Answers when everyone is ready.`, components: impHostRevealComponents() });
                } catch (_) {}
            }
        }
        await impReply(interaction, '✅ Answer submitted!');
        return;
    }

    // ── Traitors — select menu interactions (DM night vote + channel ban vote) ──
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'trt:nightvote') {
            const channelId = traitorPlayerMap.get(interaction.user.id);
            const game      = channelId ? traitorGames.get(channelId) : null;
            if (!game || game.phase !== 'night') { await interaction.reply({ content: '❌ No active night phase.', ephemeral: true }); return; }
            const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
            if (channel) await handleTrtNightVote(interaction, game, channel);
            return;
        }
        if (interaction.customId === 'trt:banvote') {
            const game = traitorGames.get(TRT_CHANNEL_ID);
            if (!game || game.phase !== 'vote') { await interaction.reply({ content: '❌ No active vote.', ephemeral: true }); return; }
            const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
            if (channel) await handleTrtBanVote(interaction, game, channel);
            return;
        }

        // ── Fitness: manage delete ────────────────────────────────────────────
        if (interaction.customId === 'fitness:manage:del') {
            const entryId  = interaction.values[0];
            const uid      = interaction.user.id;
            const userData = fitnessData.get(uid);
            if (!userData) { await interaction.update({ content: '❌ No data found.', embeds: [], components: [] }); return; }
            const idx = userData.entries.findIndex(e => e.id === entryId);
            if (idx < 0) { await interaction.update({ content: '❌ Entry not found.', embeds: [], components: [] }); return; }
            const entry = userData.entries[idx];
            if (entry.messageId) {
                try {
                    const trackCh = await client.channels.fetch(FITNESS_TRACKING_CHANNEL_ID);
                    const msg = await trackCh.messages.fetch(entry.messageId);
                    await msg.delete();
                } catch (_) {}
            }
            userData.entries.splice(idx, 1);
            fitnessData.set(uid, userData);
            await interaction.update({ content: '✅ Workout entry deleted.', embeds: [], components: [] });
            return;
        }

        // ── Fitness: manage edit (show pre-filled modal) ──────────────────────
        if (interaction.customId === 'fitness:manage:edit') {
            const entryId  = interaction.values[0];
            const uid      = interaction.user.id;
            const userData = fitnessData.get(uid);
            if (!userData) { await interaction.reply({ content: '❌ No data found.', ephemeral: true }); return; }
            const entry = userData.entries.find(e => e.id === entryId);
            if (!entry) { await interaction.reply({ content: '❌ Entry not found.', ephemeral: true }); return; }
            const modal = new ModalBuilder().setCustomId(`fitness:manage:edit_modal:${entryId}`).setTitle('✏️ Edit Workout Entry');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_workout').setLabel('What did you do?').setStyle(TextInputStyle.Paragraph).setValue(entry.workout).setRequired(true).setMaxLength(200)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_duration').setLabel('How long?').setStyle(TextInputStyle.Short).setValue(entry.duration).setRequired(true).setMaxLength(50)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_weight').setLabel('Current weight (optional)').setStyle(TextInputStyle.Short).setValue(entry.weight || '').setRequired(false).setMaxLength(30)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_energy').setLabel('Energy level (optional)').setStyle(TextInputStyle.Short).setValue(entry.energy || '').setRequired(false).setMaxLength(50)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_notes').setLabel('Notes (optional)').setStyle(TextInputStyle.Paragraph).setValue(entry.notes || '').setRequired(false).setMaxLength(300)),
            );
            await interaction.showModal(modal);
            return;
        }
    }


    // ── Fitness: workout modal submit ────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fitness:modal:')) {
        const parts    = interaction.customId.split(':');
        const freq     = parts[2];
        const privacy  = parts[3];
        const user     = interaction.user;
        const member   = interaction.member;
        const uid      = user.id;
        const display  = member?.displayName || user.username;
        const workout  = interaction.fields.getTextInputValue('fit_workout').trim();
        const duration = interaction.fields.getTextInputValue('fit_duration').trim();
        const weight   = interaction.fields.getTextInputValue('fit_weight').trim() || null;
        const energy   = interaction.fields.getTextInputValue('fit_energy').trim() || null;
        const notes    = interaction.fields.getTextInputValue('fit_notes').trim() || null;
        const durationMins = parseDurationToMins(duration);
        const entryId  = `${uid}-${Date.now()}`;
        const entry = { id: entryId, date: todayStr(), freq, privacy, workout, duration, weight, energy, notes, durationMins, messageId: null };
        const userData = fitnessData.get(uid) || { entries: [], notify: null };
        userData.entries.push(entry);
        fitnessData.set(uid, userData);

        if (privacy === 'private') {
            await interaction.reply({ content: '✅ Workout logged! Only you can see this. Use `/fitness progress` to review your stats.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
            return;
        }

        try {
            const trackingCh = await client.channels.fetch(FITNESS_TRACKING_CHANNEL_ID);
            const embedFields = [
                { name: '⏱️ Duration', value: duration, inline: true },
                { name: '📅 Frequency', value: freq.charAt(0).toUpperCase() + freq.slice(1) + ' Log', inline: true },
            ];
            if (weight) embedFields.push({ name: '⚖️ Weight', value: weight, inline: true });
            if (energy) embedFields.push({ name: '⚡ Energy Level', value: energy, inline: true });
            if (notes)  embedFields.push({ name: '📝 Notes', value: notes, inline: false });
            const sent = await trackingCh.send({
                embeds: [{
                    color: 0x22c55e,
                    author: { name: `${display} logged a workout 🏋️`, icon_url: user.displayAvatarURL({ dynamic: true }) },
                    title: workout,
                    fields: embedFields,
                    footer: { text: 'React to hype them up!' },
                    timestamp: new Date().toISOString(),
                }],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`fitness:react:flex:${uid}`).setLabel('💪').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fitness:react:fire:${uid}`).setLabel('🔥').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fitness:react:clap:${uid}`).setLabel('👏').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fitness:thread:${uid}`).setLabel('💬 Discuss').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`fitness:edit:${uid}`).setLabel('✏️ Edit').setStyle(ButtonStyle.Primary),
                    ),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`fitness:delete:${uid}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('fitness:start').setLabel('📝 Log Another').setStyle(ButtonStyle.Success),
                    ),
                ],
            });
            const updatedData = fitnessData.get(uid);
            const idx = updatedData.entries.findIndex(e => e.id === entryId);
            if (idx >= 0) updatedData.entries[idx].messageId = sent.id;
            fitnessData.set(uid, updatedData);
            await interaction.reply({ content: '✅ Workout posted! Nice work 💪', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            console.error('[BeastBot] Failed to post public workout:', e.message);
            await interaction.reply({ content: '❌ Could not post your workout. Try again.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Fitness: workout room rename modal ────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'fitness:room:rename:modal') {
        const newName = interaction.fields.getTextInputValue('room_name').trim().slice(0, 100);
        const uid     = interaction.user.id;
        let found = null;
        for (const [chId, room] of workoutRooms) { if (room.ownerId === uid) { found = { chId, room }; break; } }
        if (!found) {
            await interaction.reply({ content: '❌ You don\'t have an active workout room.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        try {
            const ch = await client.channels.fetch(found.chId);
            await ch.setName(newName);
            await interaction.reply({ content: `✅ Session renamed to **${newName}**!`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            await interaction.reply({ content: '❌ Couldn\'t rename the channel. It may have been deleted.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Fitness: workout room user limit modal ────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'fitness:room:limit:modal') {
        const raw   = interaction.fields.getTextInputValue('room_limit').trim();
        const limit = parseInt(raw);
        const uid   = interaction.user.id;
        if (isNaN(limit) || limit < 0 || limit > 99) {
            await interaction.reply({ content: '❌ Please enter a number between 0 and 99 (0 = unlimited).', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        let found = null;
        for (const [chId, room] of workoutRooms) { if (room.ownerId === uid) { found = { chId, room }; break; } }
        if (!found) {
            await interaction.reply({ content: '❌ You don\'t have an active workout room.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        try {
            const ch = await client.channels.fetch(found.chId);
            await ch.setUserLimit(limit);
            await interaction.reply({ content: `✅ User limit set to **${limit === 0 ? 'unlimited' : limit}**!`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            await interaction.reply({ content: '❌ Couldn\'t set the limit. The channel may have been deleted.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Fitness: manage edit modal submit ─────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fitness:manage:edit_modal:')) {
        const entryId  = interaction.customId.slice('fitness:manage:edit_modal:'.length);
        const uid      = interaction.user.id;
        const userData = fitnessData.get(uid);
        if (!userData) { await interaction.reply({ content: '❌ No data found.', ephemeral: true }); return; }
        const idx = userData.entries.findIndex(e => e.id === entryId);
        if (idx < 0) { await interaction.reply({ content: '❌ Entry not found.', ephemeral: true }); return; }
        const entry    = userData.entries[idx];
        const workout  = interaction.fields.getTextInputValue('fit_workout').trim();
        const duration = interaction.fields.getTextInputValue('fit_duration').trim();
        const weight   = interaction.fields.getTextInputValue('fit_weight').trim() || null;
        const energy   = interaction.fields.getTextInputValue('fit_energy').trim() || null;
        const notes    = interaction.fields.getTextInputValue('fit_notes').trim() || null;
        entry.workout  = workout; entry.duration = duration; entry.weight = weight; entry.energy = energy; entry.notes = notes;
        entry.durationMins = parseDurationToMins(duration);
        fitnessData.set(uid, userData);
        if (entry.messageId) {
            try {
                const trackCh = await client.channels.fetch(FITNESS_TRACKING_CHANNEL_ID);
                const msg = await trackCh.messages.fetch(entry.messageId);
                const member = interaction.member;
                const display = member?.displayName || interaction.user.username;
                const embedFields = [
                    { name: '⏱️ Duration', value: duration, inline: true },
                    { name: '📅 Frequency', value: entry.freq.charAt(0).toUpperCase() + entry.freq.slice(1) + ' Log', inline: true },
                ];
                if (weight) embedFields.push({ name: '⚖️ Weight', value: weight, inline: true });
                if (energy) embedFields.push({ name: '⚡ Energy Level', value: energy, inline: true });
                if (notes)  embedFields.push({ name: '📝 Notes', value: notes, inline: false });
                await msg.edit({ embeds: [{ color: 0x22c55e, author: { name: `${display} logged a workout 🏋️`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) }, title: workout, fields: embedFields, footer: { text: 'React to hype them up! · Edited' }, timestamp: new Date().toISOString() }] });
            } catch (_) {}
        }
        await interaction.reply({ content: '✅ Workout updated!', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // ── Fitness: public post edit modal submit ────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fitness:edit_modal:')) {
        const parts    = interaction.customId.split(':');
        const ownerUid = parts[2];
        const msgId    = parts[3];
        const uid      = interaction.user.id;
        if (uid !== ownerUid) { await interaction.reply({ content: '❌ You can only edit your own posts.', ephemeral: true }); return; }
        const userData = fitnessData.get(uid);
        const idx      = userData?.entries.findIndex(e => e.messageId === msgId) ?? -1;
        if (idx < 0) { await interaction.reply({ content: '❌ Entry not found.', ephemeral: true }); return; }
        const entry    = userData.entries[idx];
        const workout  = interaction.fields.getTextInputValue('fit_workout').trim();
        const duration = interaction.fields.getTextInputValue('fit_duration').trim();
        const weight   = interaction.fields.getTextInputValue('fit_weight').trim() || null;
        const energy   = interaction.fields.getTextInputValue('fit_energy').trim() || null;
        const notes    = interaction.fields.getTextInputValue('fit_notes').trim() || null;
        entry.workout  = workout; entry.duration = duration; entry.weight = weight; entry.energy = energy; entry.notes = notes;
        entry.durationMins = parseDurationToMins(duration);
        fitnessData.set(uid, userData);
        try {
            const trackCh = await client.channels.fetch(FITNESS_TRACKING_CHANNEL_ID);
            const msg = await trackCh.messages.fetch(msgId);
            const member = interaction.member;
            const display = member?.displayName || interaction.user.username;
            const embedFields = [
                { name: '⏱️ Duration', value: duration, inline: true },
                { name: '📅 Frequency', value: entry.freq.charAt(0).toUpperCase() + entry.freq.slice(1) + ' Log', inline: true },
            ];
            if (weight) embedFields.push({ name: '⚖️ Weight', value: weight, inline: true });
            if (energy) embedFields.push({ name: '⚡ Energy Level', value: energy, inline: true });
            if (notes)  embedFields.push({ name: '📝 Notes', value: notes, inline: false });
            await msg.edit({ embeds: [{ color: 0x22c55e, author: { name: `${display} logged a workout 🏋️`, icon_url: interaction.user.displayAvatarURL({ dynamic: true }) }, title: workout, fields: embedFields, footer: { text: 'React to hype them up! · Edited' }, timestamp: new Date().toISOString() }] });
        } catch (_) {}
        await interaction.reply({ content: '✅ Your workout post has been updated!', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    if (!interaction.isButton()) return;

    // ── Imposter Game buttons ────────────────────────────────────────────────
    if (interaction.customId === 'imp:join') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await impReply(interaction, 'No active lobby right now.'); return; }
        if (game.players.has(interaction.user.id)) { await impReply(interaction, 'You are already in the lobby!'); return; }
        if (game.players.size >= IMP_MAX_PLAYERS) { await impReply(interaction, `The lobby is full (${IMP_MAX_PLAYERS} players max).`); return; }

        game.players.set(interaction.user.id, {
            name: interaction.member?.displayName || interaction.user.username,
            answer: null,
            vote: null,
            order: game.players.size + 1,
        });
        imposterPlayerMap.set(interaction.user.id, IMPOSTER_CHANNEL_ID);

        try {
            const lobbyMsg = await interaction.message.fetch().catch(() => null);
            if (lobbyMsg) await lobbyMsg.edit({ embeds: [impLobbyEmbed(game)], components: impLobbyComponents() });
        } catch (_) {}
        await impReply(interaction, `✅ You've joined the lobby! Wait for the host to start.`);
        return;
    }

    if (interaction.customId === 'imp:start') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await impReply(interaction, 'No active lobby.'); return; }
        if (!impIsHost(interaction, game)) { await impReply(interaction, 'Only the host can start the game.'); return; }
        if (game.players.size < IMP_MIN_PLAYERS) { await impReply(interaction, `Need at least ${IMP_MIN_PLAYERS} players. Currently ${game.players.size}.`); return; }

        if (game.lobbyTimer) clearTimeout(game.lobbyTimer);
        game.phase = 'answer';

        // Pick one imposter randomly
        const playerIds = [...game.players.keys()];
        game.impostorId = playerIds[Math.floor(Math.random() * playerIds.length)];

        // Assign explanation order (shuffle)
        const shuffledOrder = playerIds.sort(() => Math.random() - 0.5);
        shuffledOrder.forEach((uid, i) => { game.players.get(uid).order = i + 1; });

        // DM all players their question
        const failed = [];
        for (const [uid, player] of game.players) {
            const isImp = uid === game.impostorId;
            try {
                const dmUser = await client.users.fetch(uid);
                await dmUser.send({
                    embeds: [{
                        color: isImp ? 0xff4444 : 0x4ade80,
                        title: isImp ? '🔴 You are the IMPOSTER!' : '🟢 Your Question',
                        description: isImp
                            ? `Everyone else got a **different question** than you. Blend in!\n\n**Your question:**\n> ${game.altQuestion}\n\nMake your answer sound like it fits the group's question. Head to <#${IMPOSTER_CHANNEL_ID}> and submit your answer!`
                            : `**Your question:**\n> ${game.realQuestion}\n\nAnswer honestly! One person got a different question — help find them. Head to <#${IMPOSTER_CHANNEL_ID}> and submit your answer!`,
                        footer: { text: 'Answer privately — only revealed when the host hits Reveal!' },
                    }],
                });
            } catch (_) {
                failed.push(player.name);
            }
        }

        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (!channel) { await impReply(interaction, 'Channel error.'); return; }

        // Delete lobby message
        const lobbyMsg = await channel.messages.fetch(game.lobbyMsgId).catch(() => null);
        if (lobbyMsg) await lobbyMsg.delete().catch(() => {});

        // Remove DM-failed players
        for (const [uid, p] of game.players) {
            if (failed.includes(p.name)) {
                if (uid === game.impostorId) {
                    // pick a new imposter
                    const remaining = [...game.players.keys()].filter(id => id !== uid);
                    game.impostorId = remaining[Math.floor(Math.random() * remaining.length)] || null;
                }
                game.players.delete(uid);
                imposterPlayerMap.delete(uid);
            }
        }

        const startEmbed = {
            color: 0xff4444,
            title: '🎮 The Imposter — Game Started!',
            description: `**${game.players.size} players** are in.\n\nCheck your DMs for your question, then submit your answer here! Answers are hidden until the host reveals them.`,
            fields: failed.length ? [{ name: '⚠️ DM Failed', value: `Could not DM: ${failed.join(', ')} — they were removed.` }] : [],
        };
        await channel.send({ embeds: [startEmbed] });

        const answerMsg = await channel.send({ embeds: [impAnswerEmbed(game)], components: impAnswerComponents() });
        game.gameMsgId = answerMsg.id;

        // Host-only control message (visible to everyone but only host can use buttons)
        const hostControlMsg = await channel.send({
            content: `**Host controls** — 0/${game.players.size} answered\nPress Reveal Answers when everyone is ready.`,
            components: impHostRevealComponents(),
        });
        game.hostMsgId = hostControlMsg.id;

        await impReply(interaction, `✅ Game started! ${failed.length ? `(${failed.length} player(s) removed — DM failed)` : 'DMs sent to all players.'}`);
        return;
    }

    if (interaction.customId === 'imp:answer') {
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'answer') return interaction.reply({ content: 'No active answer phase.', ephemeral: true });
        const player = game.players.get(interaction.user.id);
        if (!player) return interaction.reply({ content: 'You are not in this game.', ephemeral: true });
        if (player.answer !== null) return interaction.reply({ content: 'You already submitted your answer!', ephemeral: true });

        const modal = new ModalBuilder()
            .setCustomId('imp:answer_modal')
            .setTitle('Submit Your Answer');
        const answerInput = new TextInputBuilder()
            .setCustomId('imp_answer_text')
            .setLabel('Your answer (up to 200 characters)')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(1)
            .setMaxLength(200)
            .setPlaceholder('Type your answer here...');
        modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
        return interaction.showModal(modal);
    }

    if (interaction.customId === 'imp:reveal') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'answer') { await impReply(interaction, 'Nothing to reveal right now.'); return; }
        if (!impIsHost(interaction, game)) { await impReply(interaction, 'Only the host can reveal answers.'); return; }

        game.phase = 'revealed';
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (!channel) { await impReply(interaction, 'Channel error.'); return; }

        // Remove the answer-phase messages
        for (const msgId of [game.gameMsgId, game.hostMsgId]) {
            if (msgId) await channel.messages.fetch(msgId).then(m => m.delete()).catch(() => {});
        }

        const revealMsg = await channel.send({ embeds: [impRevealedEmbed(game)], components: impRevealedComponents() });
        game.gameMsgId = revealMsg.id;

        await impReply(interaction, '✅ Answers revealed!');
        return;
    }

    if (interaction.customId === 'imp:startvote') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'revealed') { await impReply(interaction, 'Not in the right phase.'); return; }
        if (!impIsHost(interaction, game)) { await impReply(interaction, 'Only the host can start voting.'); return; }

        game.phase = 'vote';
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (!channel) { await impReply(interaction, 'Channel error.'); return; }

        try {
            const revealMsg = await channel.messages.fetch(game.gameMsgId).catch(() => null);
            if (revealMsg) await revealMsg.edit({ embeds: [impRevealedEmbed(game)], components: [] });
        } catch (_) {}

        const voteMsg = await channel.send({ embeds: [impVoteEmbed(game)], components: impVoteComponents(game) });
        game.gameMsgId = voteMsg.id;

        await impReply(interaction, '✅ Voting started!');
        return;
    }

    if (interaction.customId.startsWith('imp:vote:')) {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'vote') { await impReply(interaction, 'No active vote phase.'); return; }
        const voter = game.players.get(interaction.user.id);
        if (!voter) { await impReply(interaction, 'You are not in this game.'); return; }
        if (voter.vote !== null) { await impReply(interaction, 'You already voted!'); return; }

        const targetId = interaction.customId.replace('imp:vote:', '');
        if (targetId === interaction.user.id) { await impReply(interaction, 'You cannot vote for yourself.'); return; }
        const target = game.players.get(targetId);
        if (!target) { await impReply(interaction, 'That player is not in the game.'); return; }

        voter.vote = targetId;

        // Update vote count on embed
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (channel) {
            try {
                const voteMsg = await channel.messages.fetch(game.gameMsgId).catch(() => null);
                if (voteMsg) await voteMsg.edit({ embeds: [impVoteEmbed(game)], components: impVoteComponents(game) });
            } catch (_) {}
        }

        const allVoted = [...game.players.values()].every(p => p.vote !== null);
        if (allVoted && channel) await impTallyAndReveal(game, channel);

        await impReply(interaction, `✅ Voted for **${target.name}**!${allVoted ? ' All votes in — revealing now!' : ''}`);
        return;
    }

    if (interaction.customId === 'imp:showresult') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase !== 'vote') { await impReply(interaction, 'No active vote phase.'); return; }
        if (!impIsHost(interaction, game)) { await impReply(interaction, 'Only the host can reveal the result.'); return; }
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (channel) await impTallyAndReveal(game, channel);
        await impReply(interaction, '✅ Result revealed!');
        return;
    }

    if (interaction.customId === 'imp:end') {
        await interaction.deferReply({ ephemeral: true });
        const game = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (!game || game.phase === 'ended') { await impReply(interaction, 'No active game.'); return; }
        if (!impIsHost(interaction, game)) { await impReply(interaction, 'Only the host or a moderator can end the game.'); return; }
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        const byName = interaction.member?.displayName || interaction.user.username;
        if (channel) await impEndGame(game, channel, byName);
        await impReply(interaction, 'Game ended.');
        return;
    }

    if (interaction.customId === 'imp:playagain') {
        await interaction.deferReply({ ephemeral: true });
        const existingGame = imposterGames.get(IMPOSTER_CHANNEL_ID);
        if (existingGame && existingGame.phase !== 'ended') { await impReply(interaction, 'A game is already in progress!'); return; }
        if (!interaction.member?.roles?.cache?.has(MOD_ROLE_ID) && interaction.user.id !== OWNER_DISCORD_ID) {
            // Any player can start a new lobby
        }
        const channel = await client.channels.fetch(IMPOSTER_CHANNEL_ID).catch(() => null);
        if (!channel) { await impReply(interaction, 'Channel error.'); return; }

        // Remove buttons from the result message
        try { await interaction.message.edit({ components: [] }); } catch (_) {}

        const qPair = IMPOSTER_QUESTIONS[Math.floor(Math.random() * IMPOSTER_QUESTIONS.length)];
        const newGame = {
            channelId: IMPOSTER_CHANNEL_ID,
            hostId: interaction.user.id,
            phase: 'lobby',
            players: new Map(),
            realQuestion: qPair.real,
            altQuestion: qPair.alt,
            impostorId: null,
            lobbyMsgId: null,
            gameMsgId: null,
            hostMsgId: null,
            lobbyTimer: null,
        };
        imposterGames.set(IMPOSTER_CHANNEL_ID, newGame);

        const msg = await channel.send({ embeds: [impLobbyEmbed(newGame)], components: impLobbyComponents() });
        newGame.lobbyMsgId = msg.id;
        newGame.lobbyTimer = setTimeout(async () => {
            if (newGame.phase !== 'lobby') return;
            await impEndGame(newGame, channel, null);
        }, IMP_LOBBY_TIMEOUT_MS);

        await impReply(interaction, '✅ New lobby created!');
        return;
    }

    if (interaction.customId === 'imp:endsession') {
        await interaction.deferReply({ ephemeral: true });
        try { await interaction.message.edit({ components: [] }); } catch (_) {}
        await impReply(interaction, '✅ Session ended. Thanks for playing!');
        return;
    }

    // ── Traitors Game buttons ────────────────────────────────────────────────

    if (interaction.customId === 'trt:join') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby right now.'); return; }
        if (game.players.has(interaction.user.id)) { await trtReply(interaction, 'You are already in the lobby!'); return; }
        if (game.players.size >= TRT_MAX_PLAYERS) { await trtReply(interaction, `The lobby is full (${TRT_MAX_PLAYERS} players max).`); return; }

        game.players.set(interaction.user.id, {
            name: interaction.member?.displayName || interaction.user.username,
            role: null,
            alive: true,
            order: game.players.size + 1,
        });
        traitorPlayerMap.set(interaction.user.id, TRT_CHANNEL_ID);

        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
        } catch (_) {}
        await trtReply(interaction, '✅ You joined the lobby!');
        return;
    }

    if (interaction.customId === 'trt:leave') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby to leave.'); return; }
        if (!game.players.has(interaction.user.id)) { await trtReply(interaction, 'You are not in the lobby.'); return; }
        game.players.delete(interaction.user.id);
        traitorPlayerMap.delete(interaction.user.id);
        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
        } catch (_) {}
        await trtReply(interaction, '✅ You left the lobby.');
        return;
    }

    if (interaction.customId === 'trt:start') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can start the game.'); return; }
        if (game.players.size < TRT_MIN_PLAYERS) { await trtReply(interaction, `Need at least ${TRT_MIN_PLAYERS} players to start.`); return; }

        if (game.lobbyTimer) { clearTimeout(game.lobbyTimer); game.lobbyTimer = null; }

        // Disable lobby embed buttons
        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ components: [] });
        } catch (_) {}

        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (!channel) { await trtReply(interaction, 'Could not find game channel.'); return; }

        game.hostMsgId = null; // will be set in trtStartGame
        await trtReply(interaction, '✅ Game starting! Check your DMs for your role.');
        await trtStartGame(game, channel);
        return;
    }

    if (interaction.customId === 'trt:stop') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase === 'ended') { await trtReply(interaction, 'No active game.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host or a moderator can end the game.'); return; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        const byName  = interaction.member?.displayName || interaction.user.username;
        if (channel) await trtEndGame(game, channel, null, byName);
        await trtReply(interaction, 'Game ended.');
        return;
    }

    if (interaction.customId === 'trt:opt:hidden') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can change options.'); return; }
        game.options.hiddenRoleReveal = !game.options.hiddenRoleReveal;
        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
        } catch (_) {}
        await trtReply(interaction, `Hidden Role Reveal: ${game.options.hiddenRoleReveal ? 'ON ✅' : 'OFF ⬜'}`);
        return;
    }

    if (interaction.customId === 'trt:opt:shield') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can change options.'); return; }
        game.options.shieldChallenge = !game.options.shieldChallenge;
        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
        } catch (_) {}
        await trtReply(interaction, `Shield Challenge: ${game.options.shieldChallenge ? 'ON ✅' : 'OFF ⬜'}`);
        return;
    }

    if (interaction.customId === 'trt:opt:recruit') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'lobby') { await trtReply(interaction, 'No active lobby.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can change options.'); return; }
        game.options.recruitmentTwist = !game.options.recruitmentTwist;
        try {
            const msg = await interaction.message.fetch().catch(() => null);
            if (msg) await msg.edit({ embeds: [trtLobbyEmbed(game)], components: trtLobbyComponents(game) });
        } catch (_) {}
        await trtReply(interaction, `Recruitment Twist: ${game.options.recruitmentTwist ? 'ON ✅' : 'OFF ⬜'}`);
        return;
    }

    if (interaction.customId === 'trt:resolvenight') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'night') { await trtReply(interaction, 'No active night phase.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can force-resolve the night.'); return; }
        if (game.recruitPending) { await trtReply(interaction, '⚠️ A recruitment offer is pending — wait for the player to respond.'); return; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (channel) await trtResolveNight(game, channel);
        await trtReply(interaction, '✅ Night resolved.');
        return;
    }

    if (interaction.customId === 'trt:skipdisc') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'discussion') { await trtReply(interaction, 'No active discussion phase.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can skip discussion.'); return; }
        trtClearDiscussionWarnings(game);
        if (game.phaseTimer) { clearTimeout(game.phaseTimer); game.phaseTimer = null; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (channel) await trtStartBanishmentVote(game, channel);
        await trtReply(interaction, '✅ Discussion skipped — vote started.');
        return;
    }

    if (interaction.customId === 'trt:revealvote') {
        await interaction.deferReply({ ephemeral: true });
        const game = traitorGames.get(TRT_CHANNEL_ID);
        if (!game || game.phase !== 'vote') { await trtReply(interaction, 'No active vote.'); return; }
        if (!trtIsHost(interaction, game)) { await trtReply(interaction, 'Only the host can reveal the result.'); return; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (channel) await trtResolveBanishment(game, channel);
        await trtReply(interaction, '✅ Vote resolved.');
        return;
    }

    if (interaction.customId === 'trt:recruit:accept') {
        const channelId = traitorPlayerMap.get(interaction.user.id);
        const game      = channelId ? traitorGames.get(channelId) : null;
        if (!game) { await interaction.reply({ content: '❌ No active game found.', ephemeral: true }); return; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (channel) await handleTrtRecruitAccept(interaction, game, channel);
        return;
    }

    if (interaction.customId === 'trt:recruit:decline') {
        const channelId = traitorPlayerMap.get(interaction.user.id);
        const game      = channelId ? traitorGames.get(channelId) : null;
        if (!game) { await interaction.reply({ content: '❌ No active game found.', ephemeral: true }); return; }
        const channel = await client.channels.fetch(TRT_CHANNEL_ID).catch(() => null);
        if (channel) await handleTrtRecruitDecline(interaction, game, channel);
        return;
    }

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
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
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
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
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
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // Intro delete cancelled
    if (interaction.customId === 'intro:cancel_delete') {
        await interaction.update({ content: '👍 Cancelled — nothing was deleted.', components: [] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // ── Thoughts channel ──────────────────────────────────────────────────────

    // "Share a Thought" button — shows anonymous vs public choice
    if (interaction.customId === 'thought:start') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('thought:open:anon')
                .setLabel('🎭 Anonymous')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('thought:open:public')
                .setLabel('📢 Post with my name')
                .setStyle(ButtonStyle.Primary),
        );
        await interaction.reply({
            content: 'How would you like to post your thought?',
            components: [row],
            ephemeral: true,
        });
        return;
    }

    // Anonymous or public — open the thought modal
    if (interaction.customId === 'thought:open:anon' || interaction.customId === 'thought:open:public') {
        const isAnon = interaction.customId === 'thought:open:anon';
        const modal = new ModalBuilder()
            .setCustomId(`thought:modal:${isAnon ? 'anon' : 'public'}`)
            .setTitle(isAnon ? '🎭 Share Anonymously' : '📢 Share with Your Name');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_text')
                    .setLabel('Your thought')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Share what\'s on your mind...')
                    .setRequired(true)
                    .setMaxLength(1000),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_link_url')
                    .setLabel('Link URL (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://example.com')
                    .setRequired(false)
                    .setMaxLength(500),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_link_label')
                    .setLabel('Link label (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Check this out — defaults to the URL if left blank')
                    .setRequired(false)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_image_url')
                    .setLabel('Image URL (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://example.com/image.png')
                    .setRequired(false)
                    .setMaxLength(500),
            ),
        );
        await interaction.showModal(modal);
        return;
    }

    // Thought edit button — original poster only
    if (interaction.customId.startsWith('thought:edit:')) {
        const originalUserId = interaction.customId.split(':')[2];
        if (interaction.user.id !== originalUserId) {
            await interaction.reply({ content: 'Only the person who posted this thought can edit it.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        // Extract current text and link from the embed/components
        const currentDesc  = interaction.message.embeds[0]?.description || '';
        const currentText  = currentDesc.includes('\n') ? currentDesc.slice(currentDesc.indexOf('\n') + 1) : '';
        const isAnon       = currentDesc.includes('**Anonymous User**');
        const linkBtn      = interaction.message.components.flatMap(r => r.components).find(b => b.style === 5);
        const currentUrl   = linkBtn?.url || '';
        const currentLabel = (linkBtn?.label === '🔗 Link' ? '' : linkBtn?.label) || '';
        const currentImage = interaction.message.embeds[0]?.image?.url || '';
        const modal = new ModalBuilder()
            .setCustomId(`thought:edit_modal:${interaction.message.id}:${isAnon ? 'anon' : 'public'}`)
            .setTitle('✏️ Edit Your Thought');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_text')
                    .setLabel('Your thought')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentText)
                    .setRequired(true)
                    .setMaxLength(1000),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_link_url')
                    .setLabel('Link URL (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://example.com')
                    .setValue(currentUrl)
                    .setRequired(false)
                    .setMaxLength(500),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_link_label')
                    .setLabel('Link label (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Check this out — defaults to the URL if left blank')
                    .setValue(currentLabel)
                    .setRequired(false)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thought_image_url')
                    .setLabel('Image URL (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://example.com/image.png')
                    .setValue(currentImage)
                    .setRequired(false)
                    .setMaxLength(500),
            ),
        );
        await interaction.showModal(modal);
        return;
    }

    // Thought delete button — original poster, mod, or server owner only
    if (interaction.customId.startsWith('thought:delete:')) {
        const originalUserId = interaction.customId.split(':')[2];
        const isPoster      = interaction.user.id === originalUserId;
        const isMod         = MOD_ROLE_ID && interaction.member?.roles?.cache?.has(MOD_ROLE_ID);
        const isServerOwner = interaction.user.id === OWNER_DISCORD_ID;
        if (!isPoster && !isMod && !isServerOwner) {
            await interaction.reply({ content: 'Only the person who posted this thought, a mod, or the server owner can delete it.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`thought:confirm_delete:${interaction.message.id}`)
                .setLabel('Yes, delete it')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('thought:cancel_delete')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: '⚠️ Are you sure you want to delete this thought? This can\'t be undone.',
            components: [confirmRow],
            ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // Thought delete confirmed
    if (interaction.customId.startsWith('thought:confirm_delete:')) {
        const messageId = interaction.customId.split(':')[2];
        try {
            const msg = await interaction.channel.messages.fetch(messageId);
            await msg.delete();
        } catch (_) {}
        await interaction.update({ content: '🗑️ Thought deleted.', components: [] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // Thought delete cancelled
    if (interaction.customId === 'thought:cancel_delete') {
        await interaction.update({ content: '👍 Cancelled — nothing was deleted.', components: [] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return;
    }

    // Thought discuss — create a thread on the message
    if (interaction.customId === 'thought:thread') {
        const msg = interaction.message;
        if (msg.thread) {
            await interaction.reply({ content: `💬 There's already a discussion thread here: ${msg.thread}`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const desc = msg.embeds[0]?.description || '';
        const text = desc.includes('\n') ? desc.slice(desc.indexOf('\n') + 1) : desc;
        const threadName = text.slice(0, 50).trim() || '💭 Discussion';
        try {
            const thread = await msg.startThread({ name: threadName, autoArchiveDuration: 1440 });
            await interaction.reply({ content: `💬 Thread created — head over to ${thread} to discuss!`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            console.error('[BeastBot] Failed to create thought thread:', e.message);
            await interaction.reply({ content: '❌ Could not create a thread. Let Kiernen know.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
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

    // Discadia bump confirm — DISABLED (Discadia reminder removed)
    // if (interaction.customId === 'discadia:bumped') {
    //     if (interaction.user.id !== OWNER_DISCORD_ID) {
    //         await interaction.reply({ content: 'Only Kiernen can confirm this one!', ephemeral: true });
    //         return;
    //     }
    //     await interaction.update({
    //         content: '✅ Discadia bumped! Next reminder in 24 hours.',
    //         components: [],
    //     });
    //     scheduleDiscadiaReminder(DISCADIA_INTERVAL);
    //     console.log('[BeastBot] Discadia bump confirmed — 24h timer started');
    //     return;
    // }

    // ── Fitness: start button ────────────────────────────────────────────────
    if (interaction.customId === 'fitness:start') {
        await interaction.reply({
            content: '📅 **How often will you be logging your workouts?**',
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fitness:freq:daily').setLabel('📆 Daily').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('fitness:freq:weekly').setLabel('📅 Weekly').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('fitness:freq:monthly').setLabel('🗓️ Monthly').setStyle(ButtonStyle.Secondary),
            )],
            ephemeral: true,
        });
        return;
    }

    // ── Fitness: frequency selection ─────────────────────────────────────────
    if (interaction.customId.startsWith('fitness:freq:')) {
        const freq = interaction.customId.split(':')[2];
        await interaction.update({
            content: '🔒 **Who can see your workout log?**',
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`fitness:privacy:${freq}:public`).setLabel('🌍 Public').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`fitness:privacy:${freq}:private`).setLabel('🔒 Private').setStyle(ButtonStyle.Secondary),
            )],
        });
        return;
    }

    // ── Fitness: privacy selection → show modal ───────────────────────────────
    if (interaction.customId.startsWith('fitness:privacy:')) {
        const parts   = interaction.customId.split(':');
        const freq    = parts[2];
        const privacy = parts[3];
        const modal   = new ModalBuilder()
            .setCustomId(`fitness:modal:${freq}:${privacy}`)
            .setTitle(`🏋️ Log Your Workout — ${freq.charAt(0).toUpperCase() + freq.slice(1)}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fit_workout').setLabel('What did you do?').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g. Chest & Back — 3x10 bench, 3x8 rows, 20min cardio').setRequired(true).setMaxLength(200)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fit_duration').setLabel('How long?').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 45 minutes, 1h 30m, 1 hour').setRequired(true).setMaxLength(50)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fit_weight').setLabel('Current weight (optional)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 180 lbs, 82 kg').setRequired(false).setMaxLength(30)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fit_energy').setLabel('Energy level (optional)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 9/10, High, Absolutely smashed it').setRequired(false).setMaxLength(50)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('fit_notes').setLabel('Notes (optional)').setStyle(TextInputStyle.Paragraph).setPlaceholder("PR'd something? New exercises? How do you feel?").setRequired(false).setMaxLength(300)
            ),
        );
        await interaction.showModal(modal);
        return;
    }

    // ── Fitness: reaction buttons ─────────────────────────────────────────────
    if (interaction.customId.startsWith('fitness:react:')) {
        const parts       = interaction.customId.split(':');
        const emojiKey    = parts[2]; // flex | fire | clap
        const ownerUid    = parts[3];
        const emojiMap    = { flex: '💪', fire: '🔥', clap: '👏' };
        const emoji       = emojiMap[emojiKey] || '💪';
        const reactorName = interaction.member?.displayName || interaction.user.username;
        if (ownerUid !== interaction.user.id) {
            try {
                const ownerUser = await client.users.fetch(ownerUid);
                await ownerUser.send({ embeds: [{ color: 0x22c55e, description: `${emoji} **${reactorName}** reacted to your workout!` }] });
            } catch (_) {}
        }
        await interaction.reply({ content: `${emoji} Hyped up their workout!`, ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 4000);
        return;
    }

    // ── Fitness: thread button ────────────────────────────────────────────────
    if (interaction.customId.startsWith('fitness:thread:')) {
        const msg = interaction.message;
        if (msg.thread) {
            await interaction.reply({ content: `💬 There's already a discussion thread here: ${msg.thread}`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const title = msg.embeds[0]?.title || '🏋️ Workout Discussion';
        try {
            const thread = await msg.startThread({ name: title.slice(0, 50), autoArchiveDuration: 1440 });
            await interaction.reply({ content: `💬 Thread started — head to ${thread}!`, ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            await interaction.reply({ content: '❌ Couldn\'t create a thread.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        }
        return;
    }

    // ── Fitness: delete button ────────────────────────────────────────────────
    if (interaction.customId.startsWith('fitness:delete:')) {
        const ownerUid = interaction.customId.split(':')[2];
        const uid      = interaction.user.id;
        const isMod    = interaction.member?.roles.cache.has(MOD_ROLE_ID);
        const isOwner  = uid === OWNER_DISCORD_ID;
        if (uid !== ownerUid && !isMod && !isOwner) {
            await interaction.reply({ content: '❌ You can only delete your own posts.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const msgId = interaction.message.id;
        try {
            await interaction.reply({ content: '🗑️ Workout post deleted.', ephemeral: true });
            await interaction.message.delete();
            const ownerData = fitnessData.get(ownerUid);
            if (ownerData) {
                const idx = ownerData.entries.findIndex(e => e.messageId === msgId);
                if (idx >= 0) ownerData.entries[idx].messageId = null;
                fitnessData.set(ownerUid, ownerData);
            }
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        } catch (e) {
            await interaction.followUp({ content: '❌ Couldn\'t delete that post.', ephemeral: true }).catch(() => {});
        }
        return;
    }

    // ── Fitness: workout room rename button ───────────────────────────────────
    if (interaction.customId === 'fitness:room:rename') {
        const uid = interaction.user.id;
        let hasRoom = false;
        for (const [, room] of workoutRooms) { if (room.ownerId === uid) { hasRoom = true; break; } }
        if (!hasRoom) {
            await interaction.reply({ content: '❌ Your workout room no longer exists.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const modal = new ModalBuilder().setCustomId('fitness:room:rename:modal').setTitle('✏️ Rename Your Session');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('room_name').setLabel('New session name').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 🧘 Yoga · 🚴 Spin Class · 💪 Chest Day').setRequired(true).setMaxLength(100)
        ));
        await interaction.showModal(modal);
        return;
    }

    // ── Fitness: edit button on public post ───────────────────────────────────
    if (interaction.customId.startsWith('fitness:edit:')) {
        const ownerUid = interaction.customId.split(':')[2];
        const uid      = interaction.user.id;
        if (uid !== ownerUid) {
            await interaction.reply({ content: '❌ You can only edit your own posts.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const msgId    = interaction.message.id;
        const userData = fitnessData.get(uid);
        const entry    = userData?.entries.find(e => e.messageId === msgId);
        if (!entry) {
            await interaction.reply({ content: '❌ Could not find this workout entry. It may have been deleted.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const modal = new ModalBuilder().setCustomId(`fitness:edit_modal:${uid}:${msgId}`).setTitle('✏️ Edit Your Workout');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_workout').setLabel('What did you do?').setStyle(TextInputStyle.Paragraph).setValue(entry.workout).setRequired(true).setMaxLength(200)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_duration').setLabel('How long?').setStyle(TextInputStyle.Short).setValue(entry.duration).setRequired(true).setMaxLength(50)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_weight').setLabel('Current weight (optional)').setStyle(TextInputStyle.Short).setValue(entry.weight || '').setRequired(false).setMaxLength(30)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_energy').setLabel('Energy level (optional)').setStyle(TextInputStyle.Short).setValue(entry.energy || '').setRequired(false).setMaxLength(50)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fit_notes').setLabel('Notes (optional)').setStyle(TextInputStyle.Paragraph).setValue(entry.notes || '').setRequired(false).setMaxLength(300)),
        );
        await interaction.showModal(modal);
        return;
    }

    // ── Fitness: workout room user limit button ────────────────────────────────
    if (interaction.customId === 'fitness:room:limit') {
        const uid = interaction.user.id;
        let hasRoom = false;
        for (const [, room] of workoutRooms) { if (room.ownerId === uid) { hasRoom = true; break; } }
        if (!hasRoom) {
            await interaction.reply({ content: '❌ Your workout room no longer exists.', ephemeral: true });
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        }
        const modal = new ModalBuilder().setCustomId('fitness:room:limit:modal').setTitle('👥 Set User Limit');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('room_limit').setLabel('Max members (0 = unlimited)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 5').setRequired(true).setMaxLength(3)
        ));
        await interaction.showModal(modal);
        return;
    }

    if (!interaction.customId.startsWith('answer:') && !interaction.customId.startsWith('skip:')) return;

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

    // Detect Discadia bump success — DISABLED (Discadia reminder removed)
    // if (message.author.id === DISCADIA_BOT_ID && message.channel.id === BUMP_CHANNEL_ID) {
    //     if (message.content.toLowerCase().includes('has been successfully bumped')) {
    //         console.log('[BeastBot] Discadia bump detected — resetting 24h timer');
    //         scheduleDiscadiaReminder(DISCADIA_INTERVAL);
    //     }
    //     return;
    // }

    if (message.author.bot) return;

    // ── Invite link detection ─────────────────────────────────────────────────
    if (message.guild) {
        const inviteRegex = /discord\.gg\/\S+|discord(?:app)?\.com\/invite\/\S+/gi;
        const inviteMatches = message.content.match(inviteRegex);
        if (inviteMatches) {
            await sendLog(message.guild, buildLogEmbed({
                color: LOG_COLORS.warn,
                user: message.author,
                description: `📨 <@${message.author.id}> **posted an invite link** in <#${message.channelId}>\n\`${inviteMatches[0]}\``,
            }));
        }
    }

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

    // ── Owner "remember:" shortcut — teach the bot new facts from anywhere ──────
    if (message.author.id === OWNER_DISCORD_ID) {
        const m = message.content.match(/^(?:remember|note)[:\s]+(.+)/is);
        if (m) {
            const fact = m[1].trim();
            await saveToKnowledgeBase('Note from TrueBeast', fact);
            await message.react('🧠');
            return;
        }
    }

    // ── Support / AI channel messages ─────────────────────────────────────────
    const isSupportChannel = CHANNEL_IDS.includes(message.channelId);
    const isAiChannel      = message.channelId === AI_CHANNEL_ID;
    if (!isSupportChannel && !isAiChannel) return;

    // Feature gate: AI Responses
    if (botFeatures.aiResponses === false) {
        console.log('[BeastBot] AI Responses disabled — skipping');
        return;
    }

    const question = message.content.trim();
    if (!question) return;

    console.log(`[BeastBot] Message from ${message.author.tag}: ${question.slice(0, 80)}`);
    await message.channel.sendTyping();

    let result;
    try {
        const [knowledge, discordContext, steamContext, channelCtx] = await Promise.all([
            fetchKnowledge(),
            fetchDiscordContext(message.guild),
            fetchSteamGames(),
            isAiChannel ? fetchChannelContext(message.channel) : Promise.resolve(null),
        ]);
        const history     = getHistory(message.author.id);
        const userContext = message.guild ? buildUserContext(message.author.id, message.guild) : null;
        result = await askClaude(question, knowledge, discordContext, steamContext, history, userContext, channelCtx);
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

// ── Reactions give XP ─────────────────────────────────────────────────────────

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    const userId = user.id;
    const today = todayStr();

    // Message XP credit
    const count = (messageCounts.get(userId) || 0) + 1;
    messageCounts.set(userId, count);
    let dMap = messageDays.get(userId);
    if (!dMap) { dMap = new Map(); messageDays.set(userId, dMap); }
    dMap.set(today, (dMap.get(today) ?? 0) + 1);
    // Reaction-specific tracking
    let rMap = reactionDays.get(userId);
    if (!rMap) { rMap = new Map(); reactionDays.set(userId, rMap); }
    rMap.set(today, (rMap.get(today) ?? 0) + 1);

    const emojiKey = reaction.emoji.id
        ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
        : (reaction.emoji.name || '?');

    // All-time emoji tally
    let eMap = emojiTally.get(userId);
    if (!eMap) { eMap = new Map(); emojiTally.set(userId, eMap); }
    eMap.set(emojiKey, (eMap.get(emojiKey) ?? 0) + 1);

    // Per-day emoji tally (used for per-period top emoji on profile card)
    let edMap = reactionEmojiDays.get(userId);
    if (!edMap) { edMap = new Map(); reactionEmojiDays.set(userId, edMap); }
    let dayEmojiMap = edMap.get(today);
    if (!dayEmojiMap) { dayEmojiMap = new Map(); edMap.set(today, dayEmojiMap); }
    dayEmojiMap.set(emojiKey, (dayEmojiMap.get(emojiKey) ?? 0) + 1);

    if (count % 10 === 0 && reaction.message.guild) {
        const member = reaction.message.guild.members.cache.get(userId);
        if (member) assignVoiceRank(member, monthlyActivityScore(userId)).catch(() => {});
    }
});

// ── Message delete / edit ─────────────────────────────────────────────────────

client.on('messageDelete', async (message) => {
    // Counting channel: if current count deleted, step back
    if (message.channelId === COUNTING_CHANNEL_ID && !message.partial) {
        if (countingBotDeletedIds.has(message.id)) {
            countingBotDeletedIds.delete(message.id);
        } else {
            const num = parseInt(message.content?.trim(), 10);
            if (!isNaN(num) && num === countingState.current) {
                countingState.current = Math.max(0, num - 1);
                countingState.lastUserId = null;
                const note = await message.channel.send(
                    `🗑️ A counting number was deleted. Count adjusted back to **${countingState.current}**. Next: **${countingState.current + 1}**`
                ).catch(() => null);
                if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
            }
        }
    }

    // Logging
    if (!message.guild) return;
    if (message.partial || message.author?.bot) return;
    await new Promise(r => setTimeout(r, 1000)); // brief wait for audit log
    const entry = await getAuditEntry(message.guild, AuditLogEvent.MessageDelete, message.author?.id, 6000);
    const deletedBy = (entry && entry.executor?.id !== message.author?.id)
        ? `Deleted by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}`
        : 'Deleted by: author';
    await sendLog(message.guild, buildLogEmbed({
        color: LOG_COLORS.delete,
        user: message.author,
        description: `🗑️ Message by <@${message.author.id}> **was deleted** in <#${message.channelId}>`,
        fields: [
            { name: 'Content', value: (message.content || '[no text content]').slice(0, 1000) },
            { name: 'Deleted by', value: deletedBy },
        ],
    }));
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    if (newMessage.partial) { try { await newMessage.fetch(); } catch { return; } }
    await sendLog(newMessage.guild, buildLogEmbed({
        color: LOG_COLORS.edit,
        user: newMessage.author,
        description: `✏️ <@${newMessage.author.id}> **edited a message** in <#${newMessage.channelId}>`,
        fields: [
            { name: 'Before', value: (oldMessage.content || '[unknown]').slice(0, 1000) },
            { name: 'After',  value: (newMessage.content || '[empty]').slice(0, 1000) },
            { name: 'Jump to message', value: `[Click here](${newMessage.url})` },
        ],
    }));
});

// ── Member join / leave / ban ─────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
    const user = member.user;
    const ageDays = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
    const ageStr = ageDays < 1 ? 'Today' : ageDays < 7 ? `${ageDays} days ago` :
        ageDays < 30 ? `${Math.floor(ageDays / 7)} weeks ago` :
        ageDays < 365 ? `${Math.floor(ageDays / 30)} months ago` : `${Math.floor(ageDays / 365)} years ago`;
    await sendLog(member.guild, buildLogEmbed({
        color: LOG_COLORS.join, user,
        description: `📥 <@${user.id}> **joined the server**\n**Account creation**\n${ageStr}`,
    }));

    // Welcome DM — feature-gated
    if (botFeatures.welcomeMessages !== false) {
        try {
            await user.send(
                `👋 **Welcome to TrueBeast's server, ${user.username}!**\n\n` +
                `We're happy to have you here. Feel free to explore the channels, grab some roles, and join the fun!\n\n` +
                `🎮 https://truebeast.io`
            );
            console.log(`[BeastBot] Sent welcome DM to ${user.tag}`);
        } catch (e) {
            // User may have DMs disabled — silently ignore
            console.log(`[BeastBot] Could not send welcome DM to ${user.tag}: ${e.message}`);
        }
    }
});

client.on('guildMemberRemove', async (member) => {
    const user = member.user;
    await new Promise(r => setTimeout(r, 1000));
    const banEntry  = await getAuditEntry(member.guild, AuditLogEvent.MemberBanAdd,  user.id, 6000);
    if (banEntry) return; // guildBanAdd will log this
    const kickEntry = await getAuditEntry(member.guild, AuditLogEvent.MemberKick, user.id, 6000);
    if (kickEntry) {
        const reason = kickEntry.reason || 'No reason provided';
        await sendLog(member.guild, buildLogEmbed({
            color: LOG_COLORS.kick, user,
            description: `👢 <@${user.id}> **was kicked**\nReason: ${reason}`,
            footerExtra: `Kicked by: ${kickEntry.executor?.tag || kickEntry.executor?.username || 'Unknown'}`,
        }));
    } else {
        await sendLog(member.guild, buildLogEmbed({
            color: LOG_COLORS.leave, user,
            description: `📤 <@${user.id}> **left the server**`,
        }));
    }
});

client.on('guildBanAdd', async (ban) => {
    const user = ban.user;
    await new Promise(r => setTimeout(r, 500));
    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, user.id, 6000);
    const reason = ban.reason || entry?.reason || 'No reason provided';
    await sendLog(ban.guild, buildLogEmbed({
        color: LOG_COLORS.ban, user,
        description: `🔨 <@${user.id}> **was banned**\nReason: ${reason}`,
        footerExtra: entry ? `Banned by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` : '',
    }));
});

client.on('guildBanRemove', async (ban) => {
    const user = ban.user;
    await new Promise(r => setTimeout(r, 500));
    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, user.id, 6000);
    await sendLog(ban.guild, buildLogEmbed({
        color: LOG_COLORS.join, user,
        description: `✅ <@${user.id}> **was unbanned**`,
        footerExtra: entry ? `Unbanned by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` : '',
    }));
});

// ── Avatar change ─────────────────────────────────────────────────────────────

client.on('userUpdate', async (oldUser, newUser) => {
    if (oldUser.avatar === newUser.avatar) return;
    const guild = client.guilds.cache.first();
    if (!guild) return;
    const oldUrl = oldUser.displayAvatarURL({ size: 256, extension: 'png' });
    const newUrl = newUser.displayAvatarURL({ size: 256, extension: 'png' });
    await sendLog(guild, {
        color: LOG_COLORS.nick,
        author: { name: newUser.username, icon_url: newUrl },
        description: `🖼️ <@${newUser.id}> **updated their avatar**`,
        thumbnail: { url: newUrl },
        image: oldUrl ? { url: oldUrl } : undefined,
        timestamp: new Date().toISOString(),
        footer: { text: `ID: ${newUser.id}` },
    });
});

// ── Role events ───────────────────────────────────────────────────────────────

client.on('roleCreate', async (role) => {
    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id, 8000);
    await sendLog(role.guild, {
        color: LOG_COLORS.role,
        description: `🎭 Role **${role.name}** was **created**`,
        fields: [{ name: 'Role ID', value: role.id, inline: true }],
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Created by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push({ name: 'Name', value: `${oldRole.name} → ${newRole.name}` });
    if (oldRole.color !== newRole.color) changes.push({ name: 'Color', value: `#${oldRole.color.toString(16).padStart(6,'0')} → #${newRole.color.toString(16).padStart(6,'0')}` });
    if (!changes.length) return;
    const entry = await getAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id, 8000);
    await sendLog(newRole.guild, {
        color: LOG_COLORS.role,
        description: `🎭 Role **${newRole.name}** was **updated**`,
        fields: changes,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Updated by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('roleDelete', async (role) => {
    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id, 8000);
    await sendLog(role.guild, {
        color: LOG_COLORS.role,
        description: `🎭 Role **${role.name}** was **deleted**`,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Deleted by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

// ── Channel events ────────────────────────────────────────────────────────────

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id, 8000);
    await sendLog(channel.guild, {
        color: LOG_COLORS.info,
        description: `📁 Channel **#${channel.name}** was **created**`,
        fields: [
            { name: 'Type',     value: channel.type.toString(), inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Created by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push({ name: 'Name', value: `${oldChannel.name} → ${newChannel.name}` });
    if (oldChannel.topic !== newChannel.topic) changes.push({ name: 'Topic', value: `${oldChannel.topic || 'none'} → ${newChannel.topic || 'none'}` });
    if (!changes.length) return;
    const entry = await getAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id, 8000);
    await sendLog(newChannel.guild, {
        color: LOG_COLORS.info,
        description: `📁 Channel **#${newChannel.name}** was **updated**`,
        fields: changes,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Updated by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id, 8000);
    await sendLog(channel.guild, {
        color: LOG_COLORS.info,
        description: `📁 Channel **#${channel.name}** was **deleted**`,
        fields: [{ name: 'Category', value: channel.parent?.name || 'None', inline: true }],
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Deleted by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

// ── Emoji events ──────────────────────────────────────────────────────────────

client.on('emojiCreate', async (emoji) => {
    const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id, 8000);
    await sendLog(emoji.guild, {
        color: LOG_COLORS.server,
        description: `😀 Emoji **:${emoji.name}:** was **added**`,
        thumbnail: emoji.url ? { url: emoji.url } : undefined,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Added by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
    if (oldEmoji.name === newEmoji.name) return;
    const entry = await getAuditEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id, 8000);
    await sendLog(newEmoji.guild, {
        color: LOG_COLORS.server,
        description: `😀 Emoji **:${oldEmoji.name}:** was **renamed** to **:${newEmoji.name}:**`,
        thumbnail: newEmoji.url ? { url: newEmoji.url } : undefined,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Renamed by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('emojiDelete', async (emoji) => {
    const entry = await getAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id, 8000);
    await sendLog(emoji.guild, {
        color: LOG_COLORS.server,
        description: `😀 Emoji **:${emoji.name}:** was **removed**`,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Removed by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

// ── Server update ─────────────────────────────────────────────────────────────

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push({ name: 'Name', value: `${oldGuild.name} → ${newGuild.name}` });
    if (oldGuild.icon !== newGuild.icon) changes.push({ name: 'Icon', value: 'Icon was updated' });
    if (oldGuild.description !== newGuild.description) changes.push({ name: 'Description', value: `${oldGuild.description || 'none'} → ${newGuild.description || 'none'}` });
    if (!changes.length) return;
    const entry = await getAuditEntry(newGuild, AuditLogEvent.GuildUpdate, null, 8000);
    await sendLog(newGuild, {
        color: LOG_COLORS.server,
        description: '🏠 **Server settings were updated**',
        fields: changes,
        timestamp: new Date().toISOString(),
        footer: entry ? { text: `Updated by: ${entry.executor?.tag || entry.executor?.username || 'Unknown'}` } : undefined,
    });
});

client.on('error', (err) => console.error('[BeastBot] Client error:', err.message));

// On shutdown: credit voice sessions, save Discord backup, save Firestore snapshot
async function flushBeforeExit() {
    console.log('[BeastBot] Flushing state before shutdown...');
    // Credit any remaining voice time into in-memory before snapshot
    for (const [uid] of voiceStartTimes) creditVoiceTime(uid);
    // Save to Discord backup channel only — do NOT write Firestore on shutdown.
    // Firestore is written once daily by saveFirestoreDaily() during normal operation.
    // Writing on shutdown was causing deploys to overwrite recovery data.
    await saveDiscordBackup().catch(e => console.error('[BeastBot] Shutdown Discord backup failed:', e.message));
    console.log('[BeastBot] Flush complete');
}

for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
        await flushBeforeExit();
        process.exit(0);
    });
}

client.login(TOKEN);
