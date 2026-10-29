/**
 * VC Ping — /vcping pings the @vcping role so people come join your voice chat.
 *
 * Discord can't stop a role ping once the message is sent, so the role is made
 * non-mentionable on startup and the bot does the pinging instead. Rules:
 *   • you must be in a voice chat (not AFK) and have been in voice for 15 minutes
 *     (moving between channels keeps your timer, leaving voice resets it)
 *   • 2 pings per rolling 7 days; each one comes back 7 days after you used it
 * After every attempt the user gets an ephemeral reply with how many they have left
 * and when the next one comes back.
 *
 * State: botConfig/vcPing → usesJson ({ userId: [ms, ...] }), joinJson ({ userId: ms }).
 */

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/vcPing`;

const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const MAX_USES     = 2;
const WINDOW_MS    = 7 * DAY;
const MIN_VOICE_MS = 15 * MIN;
const EPH = MessageFlags.Ephemeral;

const uses     = new Map(); // userId → [ms, ...] (pings inside the last 7 days)
const joinedAt = new Map(); // userId → ms they joined voice (survives channel moves)
let loaded = false;         // guards saves so an empty map never overwrites Firestore
let client = null, afkChannelId = null, roleId = null;
let saveTimer = null;

const vcPingCommands = [
    new SlashCommandBuilder()
        .setName('vcping')
        .setDescription('Ping @vcping so people come join your voice chat (2 per week)')
        .addStringOption(opt => opt.setName('message').setDescription('Optional note, e.g. what you are playing').setMaxLength(200)),
];
const isVcPingCommand = name => name === 'vcping';

// ── Firestore ───────────────────────────────────────────────────────────────
async function loadState() {
    const res = await fetch(`${DOC_URL}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).fields || {};
    return { usesJson: f.usesJson?.stringValue || '', joinJson: f.joinJson?.stringValue || '' };
}

async function saveState() {
    if (!loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    prune();
    const fields = {
        usesJson: { stringValue: JSON.stringify(Object.fromEntries(uses)) },
        joinJson: { stringValue: JSON.stringify(Object.fromEntries(joinedAt)) },
    };
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
    try {
        const res = await fetch(`${DOC_URL}?${mask}&key=${FIREBASE_API_KEY}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
        });
        if (!res.ok) console.error('[VcPing] save failed:', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.error('[VcPing] save failed:', e.message); }
}

function scheduleSave() {
    if (!loaded || saveTimer) return;
    saveTimer = setTimeout(() => saveState(), 10 * 1000);
}

async function flushVcPing() { if (loaded) await saveState(); }

// ── Helpers ─────────────────────────────────────────────────────────────────
function prune() {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [uid, list] of uses) {
        const kept = list.filter(t => t > cutoff);
        if (kept.length) uses.set(uid, kept); else uses.delete(uid);
    }
}

function recentUses(uid) {
    const cutoff = Date.now() - WINDOW_MS;
    return (uses.get(uid) || []).filter(t => t > cutoff).sort((a, b) => a - b);
}

const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;
const when = ms => `${ts(ms, 'F')} (${ts(ms, 'R')})`;

function statusLine(uid) {
    const list = recentUses(uid);
    const left = MAX_USES - list.length;
    if (!list.length) return `You have **${MAX_USES}/${MAX_USES}** pings left this week.`;
    const next = list[0] + WINDOW_MS;
    const plural = left === 1 ? 'ping' : 'pings';
    return `You have **${left}/${MAX_USES}** ${plural} left. Your next one comes back ${when(next)}.`;
}

const countsAsVoice = channelId => !!channelId && channelId !== afkChannelId;

function findRole(guild) {
    if (roleId) return guild.roles.cache.get(roleId) || null;
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const role = guild.roles.cache.find(r => norm(r.name) === 'vcping') || null;
    if (role) roleId = role.id;
    return role;
}

// ── Command ─────────────────────────────────────────────────────────────────
async function handleVcPingCommand(interaction) {
    if (!loaded) return interaction.reply({ content: '⏳ VC Ping is still starting up, try again in a minute.', flags: EPH });
    const guild = interaction.guild;
    const role = guild && findRole(guild);
    if (!role) return interaction.reply({ content: '❌ The @vcping role could not be found. Let a mod know.', flags: EPH });

    const uid = interaction.user.id;
    const member = interaction.member;
    const voiceId = member?.voice?.channelId;
    if (!countsAsVoice(voiceId)) {
        return interaction.reply({ content: `🔇 You need to be in a voice chat to use **/vcping**.\n${statusLine(uid)}`, flags: EPH });
    }

    const since = joinedAt.get(uid) ?? Date.now();
    if (!joinedAt.has(uid)) { joinedAt.set(uid, since); scheduleSave(); }
    if (Date.now() - since < MIN_VOICE_MS) {
        return interaction.reply({
            content: `⏱️ You need to be in voice for **15 minutes** before you can use **/vcping**. You can use it ${ts(since + MIN_VOICE_MS, 'R')}.\n${statusLine(uid)}`,
            flags: EPH,
        });
    }

    const list = recentUses(uid);
    if (list.length >= MAX_USES) {
        return interaction.reply({
            content: `🚫 You've used both of your pings this week. Your next one comes back ${when(list[0] + WINDOW_MS)}.`,
            flags: EPH,
        });
    }

    const channel = interaction.channel;
    const me = guild.members.me;
    if (!channel?.isSendable?.() || !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({ content: `❌ I can't post in this channel, try **/vcping** somewhere else.\n${statusLine(uid)}`, flags: EPH });
    }

    // Take the use before any await so a double-click can't ping twice
    const stamp = Date.now();
    uses.set(uid, [...list, stamp]);
    const giveBack = () => uses.set(uid, recentUses(uid).filter(t => t !== stamp));
    try { await interaction.deferReply({ flags: EPH }); } catch (e) { giveBack(); throw e; }

    const note = interaction.options.getString('message')?.trim();
    let content = `🔊 ${role} — <@${uid}> is in <#${voiceId}> and wants people to join!`;
    if (note) content += `\n> ${note.replace(/\n+/g, ' ')}`;
    try {
        await channel.send({ content, allowedMentions: { roles: [role.id] } });
    } catch (e) {
        console.error('[VcPing] send failed:', e.message);
        giveBack();
        return interaction.editReply({ content: `❌ Couldn't send the ping, so it wasn't used up.\n${statusLine(uid)}` });
    }
    scheduleSave();
    await interaction.editReply({ content: `✅ Pinged ${role}!\n${statusLine(uid)}`, allowedMentions: { parse: [] } });
}

// ── Voice tracking ──────────────────────────────────────────────────────────
function onVoiceState(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const was = countsAsVoice(oldState.channelId), now = countsAsVoice(newState.channelId);
    if (was === now) return; // channel moves keep the timer
    if (now) joinedAt.set(member.id, Date.now());
    else joinedAt.delete(member.id);
    scheduleSave();
}

async function startVcPing(discordClient, { afkChannelId: afk } = {}) {
    client = discordClient;
    roleId = process.env.VC_PING_ROLE_ID || null;
    const guild = client.guilds.cache.first();
    if (!guild) { console.error('[VcPing] no guild'); return; }
    afkChannelId = afk || guild.afkChannelId || null;

    let state = null;
    for (let attempt = 1; attempt <= 5 && !state; attempt++) {
        state = await loadState().catch(e => { console.error(`[VcPing] load failed (attempt ${attempt}):`, e.message); return null; });
        if (!state) await new Promise(r => setTimeout(r, 30 * 1000));
    }
    if (!state) { console.error('[VcPing] giving up on load — /vcping stays off until restart'); return; }

    let savedUses = {}, savedJoins = {};
    try { savedUses = JSON.parse(state.usesJson || '{}'); } catch (_) {}
    try { savedJoins = JSON.parse(state.joinJson || '{}'); } catch (_) {}
    for (const [uid, list] of Object.entries(savedUses)) if (Array.isArray(list)) uses.set(uid, list.map(Number));
    prune();

    // Keep join times for people still in voice (so a restart doesn't reset their 15 min)
    for (const ch of guild.channels.cache.values()) {
        if (!ch.isVoiceBased() || !countsAsVoice(ch.id)) continue;
        for (const m of ch.members.values()) {
            if (m.user.bot) continue;
            joinedAt.set(m.id, Number(savedJoins[m.id]) || Date.now());
        }
    }
    client.on('voiceStateUpdate', onVoiceState);
    loaded = true;
    scheduleSave();

    const role = findRole(guild);
    if (!role) { console.error('[VcPing] @vcping role not found — set VC_PING_ROLE_ID'); return; }
    if (role.mentionable) {
        await role.setMentionable(false, 'Only /vcping can ping this role')
            .then(() => console.log('[VcPing] made @vcping non-mentionable'))
            .catch(e => console.error('[VcPing] could not make @vcping non-mentionable:', e.message));
    }
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.MentionEveryone)) {
        console.error('[VcPing] bot lacks "Mention All Roles" — /vcping pings will not notify anyone');
    }
    console.log(`[VcPing] ready — role ${role.name}, ${uses.size} users with recent pings, ${joinedAt.size} in voice`);
}

module.exports = { vcPingCommands, isVcPingCommand, handleVcPingCommand, startVcPing, flushVcPing };
