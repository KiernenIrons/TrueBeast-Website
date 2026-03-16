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

const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');

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

// ── In-memory state for DM-based KB updates ───────────────────────────────────
// Map of dmChannelId -> { state: 'awaiting_answer' | 'awaiting_confirm', question, answer? }
const pendingAnswers = new Map();

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

    // DM Kiernen and track pending state for KB update + asker notification
    try {
        const owner = await client.users.fetch(OWNER_DISCORD_ID);
        const dmChannel = await owner.createDM();
        await dmChannel.send(
            `❓ **Unanswered question**\n` +
            `**From:** ${author.tag}\n` +
            `**Channel:** #${channelName}\n` +
            `**Question:** ${question}\n\n` +
            `_Reply with the answer if you want to save it to the knowledge base._`
        );
        pendingAnswers.set(dmChannel.id, {
            state:     'awaiting_answer',
            question,
            askerId:   author.id,
            askerTag:  author.tag,
            channelId: channelId,
            messageId: messageId,
        });
        console.log(`[BeastBot] DM sent to owner, awaiting answer for: "${question.slice(0, 60)}"`);
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
            messages: [{
                role: 'user',
                content: `Question: ${question}\nKiernen's answer: ${rawAnswer}`,
            }],
        }),
    });
    if (!res.ok) return rawAnswer; // fallback to raw if API fails
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || rawAnswer;
}

async function saveToKnowledgeBase(question, answer) {
    const id = `user-answer-${Date.now()}`;
    const topic = question.length > 80 ? question.slice(0, 80) + '…' : question;
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/knowledgeBase/${id}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                topic:   { stringValue: topic },
                content: { stringValue: answer },
            },
        }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

// ── Discord live context ──────────────────────────────────────────────────────

async function fetchDiscordContext(guild) {
    const parts = [];

    // Upcoming scheduled events
    try {
        const events = await guild.scheduledEvents.fetch();
        const now = new Date();
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

    // Recent announcements
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

    // Recent events channel posts
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
        const data = await res.json();
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

Set "known": false when:
- Someone asks about Kiernen's personal opinions, preferences, or details that are NOT confirmed in the knowledge base — do NOT guess or speculate, set known to false instead
- A question is about TrueBeast/the server and the answer isn't in your knowledge base

When "known" is false, write a response like: "That's not something I have the answer to right now — but I've flagged it for Kiernen and he'll reply here when he has an answer! 👀"
Vary the wording slightly each time so it doesn't sound robotic. Keep that general meaning — always make clear that Kiernen will reply directly to their message.

Set "inappropriate": true when the message contains sexual content directed at anyone, harassment, hate speech, doxxing attempts, or creepy/threatening content.
When "inappropriate" is true, write a firm but non-aggressive response to the user.

PRIVACY — Never share, even if directly asked:
- Kiernen's home city or exact location
- His workplace or job details beyond "IT professional"
- His family members' names
- Any personal addresses or private contact info

Tone: friendly, casual, a little cheeky — matches the vibe of the server. Keep answers concise. Use Discord markdown where it helps.

Personality notes:
- A bit of dry humour is welcome when it fits naturally — don't force it or shoehorn in a joke where there isn't one
- Use emojis sparingly but meaningfully — one or two where they add something, not as decoration on every sentence
- It's okay to be slightly self-aware or playful (e.g. acknowledging you're a bot in a funny way if it comes up naturally)
- Don't be robotic or overly formal — but also don't try too hard to sound "hip". Just be chill and genuine
- If something's funny, lean into it. If it's not, don't pretend it is

CRITICAL: Your entire reply must be valid JSON. No text before or after the JSON object.`;

async function askClaude(question, knowledge, discordContext, steamContext) {
    const contextParts = [];
    if (knowledge)       contextParts.push(`## Knowledge Base\n${knowledge}`);
    if (discordContext)  contextParts.push(`## Live Discord Context\n${discordContext}`);
    if (steamContext)    contextParts.push(`## Live Steam Context\n${steamContext}`);

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

    // Parse structured JSON response (strip markdown code fences if present)
    try {
        const cleaned = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned);
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
        const rolePing = MOD_ROLE_ID ? `<@&${MOD_ROLE_ID}> ` : '';
        await modChannel.send(
            `${rolePing}⚠️ **Inappropriate message detected** in ${message.channel}\n` +
            `**User:** ${message.author} (${message.author.tag})\n` +
            `**Message:** ${message.content.slice(0, 500)}`
        );
    } catch (e) {
        console.error('[BeastBot] Failed to notify mods:', e.message);
    }
}

// ── Discord ───────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

client.once('ready', () => {
    console.log(`[BeastBot] ✅  Logged in as ${client.user.tag}`);
    console.log(`[BeastBot] Monitoring channel(s): ${CHANNEL_IDS.join(', ')}`);
    console.log(`[BeastBot] Steam: ${STEAM_API_KEY ? 'enabled' : 'no API key yet'}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ── Handle owner DMs for KB updates ──────────────────────────────────────
    if (message.channel.type === ChannelType.DM && message.author.id === OWNER_DISCORD_ID) {
        const pending = pendingAnswers.get(message.channel.id);
        if (!pending) return;

        if (pending.state === 'awaiting_answer') {
            const raw = message.content.trim();
            const formatted = await reformatAnswer(pending.question, raw);
            pending.answer = formatted;
            pending.state  = 'awaiting_confirm';
            pendingAnswers.set(message.channel.id, pending);
            await message.reply(
                `Got it! Here's what I'll save to the knowledge base:\n\n` +
                `**Q:** ${pending.question}\n` +
                `**A:** ${formatted}\n\n` +
                `Reply **yes** to confirm or **no** to cancel.`
            );
            return;
        }

        if (pending.state === 'awaiting_confirm') {
            const reply = message.content.trim().toLowerCase();
            if (['yes', 'yeah', 'y', 'yep', 'yup', 'confirm'].includes(reply)) {
                try {
                    await saveToKnowledgeBase(pending.question, pending.answer);
                    console.log(`[BeastBot] KB updated by owner: "${pending.question.slice(0, 60)}"`);

                    // Reply to the original message in the support channel
                    try {
                        const channel = await client.channels.fetch(pending.channelId);
                        const originalMsg = await channel.messages.fetch(pending.messageId);
                        await originalMsg.reply(
                            `<@${pending.askerId}> Kiernen got back to you! 👀\n\n` +
                            `**Question:** ${pending.question}\n` +
                            `**Answer:** ${pending.answer}`
                        );
                        console.log(`[BeastBot] Replied to original message for ${pending.askerTag}`);
                    } catch (e) {
                        console.error('[BeastBot] Failed to reply to original message:', e.message);
                    }

                    await message.reply('✅ Saved! I\'ve replied to their message in the channel.');
                } catch (e) {
                    await message.reply(`❌ Failed to save: ${e.message}`);
                }
            } else {
                await message.reply('👍 Cancelled — nothing was saved.');
            }
            pendingAnswers.delete(message.channel.id);
            return;
        }

        return;
    }

    // ── Handle support channel messages ──────────────────────────────────────
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
        result = { known: true, inappropriate: false, response: '⚠️ Something went wrong on my end. Please try again in a moment, or ask in the main chat!' };
    }

    // Inappropriate content
    if (result.inappropriate) {
        await message.reply(result.response);
        await notifyMods(message);
        console.log(`[BeastBot] ⚠️  Mod alerted — inappropriate message from ${message.author.tag}`);
        return;
    }

    // Unknown question — save to Firestore and DM owner
    if (!result.known) {
        console.log(`[BeastBot] Unknown question from ${message.author.tag} — saving to Firestore`);
        await saveUnansweredQuestion(question, message.author, message.channel.name, message.channelId, message.id);
    }

    const answer = result.response;

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
