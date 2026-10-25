/**
 * Planned Sessions — gaming / recording / streaming sessions planned from one panel in
 * #plan-a-session (Custom Voice Chats category). Every session gets its own hidden text + voice
 * channel in that category that only the host, the people they invite, mods and the server
 * owner can see. Removing someone deletes their channel overwrites, so they lose access at once.
 *
 * Creating: modal (name, type, link, announcement, invitees) → a private "Find a time" message
 * with buttons: Create schedule (opens truebeast.io/meet pre-filled), Submit link (paste the
 * event link) or Skip. Public sessions are listed on the panel so anyone can join; private
 * ones never are.
 *
 * Chat stays clean: the tools embed is posted first, then the announcement card (pinned,
 * Components v2, same layout as the hand-made Powder Park post).
 * Adds/removes/joins only get ephemeral confirmations (added people get a DM with a button).
 * The only public posts are the lock-in and the 15-min / start reminders, which ping everyone.
 *
 * State: botConfig/sessions → sessionsJson, tzJson, panelChannelId, panelMessageId, categoryId.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder, LabelBuilder, ChannelType, PermissionFlagsBits,
    MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, EmbedBuilder,
    SectionBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FS_BASE  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const DOC_URL  = `${FS_BASE}/botConfig/sessions`;
const MEET_URL = 'https://truebeast.io/meet';

const CATEGORY_ID        = '1560119653500715028'; // Custom Voice Chats (shared with the custom VC rooms)
const PANEL_CHANNEL_NAME = 'plan-a-session';
const ACCENT             = 0x22c55e;
const MAX_PER_OWNER      = 3;
const MAX_TOTAL          = 15;               // 2 channels each; the category also holds the custom VC rooms (50 max)
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const MEET_POLL_MS       = 5 * MIN;          // look for a scheduler made on the site from "Find a time"
const MEET_POLL_MAX_AGE  = 14 * DAY;
const REMIND_BEFORE_S    = 15 * 60;
const SLOT_S             = 15 * 60;          // meet slots are 15 minutes
const SETUP_TTL          = 30 * MIN;         // unfinished "Find a time" steps are dropped after this
const DEFAULT_TZ         = 'Europe/London';

const TYPES = {
    gaming:    { emoji: '🎮', label: 'Gaming' },
    recording: { emoji: '🎥', label: 'Recording' },
    streaming: { emoji: '🔴', label: 'Streaming' },
    hangout:   { emoji: '💬', label: 'Hangout' },
    other:     { emoji: '✨', label: 'Other' },
};

const TIMEZONES = [
    ['Europe/London', 'UK / Ireland'], ['Europe/Paris', 'Central Europe'], ['Europe/Helsinki', 'Eastern Europe'],
    ['Europe/Moscow', 'Moscow'], ['America/New_York', 'US Eastern'], ['America/Chicago', 'US Central'],
    ['America/Denver', 'US Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'US Pacific'],
    ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Halifax', 'Atlantic (Canada)'],
    ['America/Mexico_City', 'Mexico City'], ['America/Sao_Paulo', 'Brazil (São Paulo)'], ['Africa/Johannesburg', 'South Africa'],
    ['Asia/Dubai', 'Gulf (Dubai)'], ['Asia/Kolkata', 'India'], ['Asia/Singapore', 'Singapore / Malaysia'],
    ['Asia/Manila', 'Philippines'], ['Asia/Tokyo', 'Japan / Korea'], ['Australia/Perth', 'Australia West'],
    ['Australia/Brisbane', 'Australia (Brisbane)'], ['Australia/Sydney', 'Australia East'], ['Pacific/Auckland', 'New Zealand'],
    ['UTC', 'UTC'],
];
const EPH      = MessageFlags.Ephemeral;
const V2       = MessageFlags.IsComponentsV2;
const NO_PINGS = { parse: [] };

const TEXT_PERMS = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.UseExternalEmojis, PermissionFlagsBits.UseApplicationCommands,
];
const VOICE_PERMS = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
];
const toFlagObj = (flags, value) => Object.fromEntries(
    Object.entries(PermissionFlagsBits).filter(([, bit]) => flags.includes(bit)).map(([name]) => [name, value]));

// ── State ───────────────────────────────────────────────────────────────────
const sessions = new Map();        // text channel id → session
const userTz   = new Map();        // userId → last time zone they picked
const pending  = new Map();        // userId → unfinished create (modal done, "Find a time" step open)
let loaded = false;                // guards saves so an empty map never overwrites Firestore
let client = null;
let modRoleId = null, quarantineRoleId = null;
let panelChannelId = null, panelMessageId = null, guildId = null;
let saveTimer = null, panelTimer = null, panelQueue = Promise.resolve();

async function loadState() {
    const res = await fetch(`${DOC_URL}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).fields || {};
    const str = k => f[k]?.stringValue || '';
    return { sessionsJson: str('sessionsJson'), tzJson: str('tzJson'), panelChannelId: str('panelChannelId'), panelMessageId: str('panelMessageId'), categoryId: str('categoryId') };
}

async function saveState() {
    if (!loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    const fields = {
        sessionsJson:   { stringValue: JSON.stringify(Object.fromEntries(sessions)) },
        tzJson:         { stringValue: JSON.stringify(Object.fromEntries(userTz)) },
        panelChannelId: { stringValue: panelChannelId || '' },
        panelMessageId: { stringValue: panelMessageId || '' },
        categoryId:     { stringValue: CATEGORY_ID },
    };
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
    try {
        const res = await fetch(`${DOC_URL}?${mask}&key=${FIREBASE_API_KEY}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
        });
        if (!res.ok) console.error('[Sessions] save failed:', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.error('[Sessions] save failed:', e.message); }
}

function scheduleSave() {
    if (!loaded || saveTimer) return;
    saveTimer = setTimeout(() => saveState(), 2000);
}

async function flushSessions() { if (loaded) await saveState(); }

// ── Helpers ─────────────────────────────────────────────────────────────────
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const linkBtn = (url, label, emoji) =>
    new ButtonBuilder().setURL(url).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link);
const embed = (title, description) => { const e = new EmbedBuilder(); if (title) e.setTitle(title); if (description) e.setDescription(description); return e; };
const typeOf = s => TYPES[s.type] || TYPES.other;
const everyoneIn = s => [s.ownerId, ...s.members];
const mentions = ids => ids.map(id => `<@${id}>`).join(' ');
const tzName = tz => TIMEZONES.find(([z]) => z === tz)?.[1] || tz.replace(/_/g, ' ');

const voiceUrl     = s => `https://discord.com/channels/${guildId}/${s.voiceId}`;
const textUrl      = s => `https://discord.com/channels/${guildId}/${s.textId}`;
const meetEventUrl = s => `${MEET_URL}/${s.meetId}`;
const meetCreateUrl = s => `${MEET_URL}?name=${encodeURIComponent(s.title)}&session=${s.id}`;
const joinVoiceBtn = s => linkBtn(voiceUrl(s), 'Join voice', '🔊');

// Ephemeral reply (or follow-up once deferred)
function reply(ix, content, extra = {}) {
    const payload = { content, flags: EPH, allowedMentions: NO_PINGS, ...extra };
    return (ix.deferred || ix.replied ? ix.followUp(payload) : ix.reply(payload)).catch(e => console.error('[Sessions] reply failed:', e.message));
}

function guild() { return guildId ? client.guilds.cache.get(guildId) : null; }

function isStaff(member) {
    return member.id === member.guild.ownerId
        || (modRoleId && member.roles.cache.has(modRoleId))
        || member.permissions.has(PermissionFlagsBits.Administrator);
}
const canManage = (member, s) => s.ownerId === member.id || isStaff(member);
const isHost = (member, s) => s.ownerId === member.id; // only the host picks the final time

function normalizeLink(raw) {
    if (!raw) return null;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const u = new URL(withScheme);
        return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : null;
    } catch (_) { return null; }
}

// Steam store links get the game's name and header image for the announcement
async function lookupLink(link) {
    const m = link?.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (!m) return { gameName: '', image: '' };
    try {
        const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${m[1]}&filters=basic`, { signal: AbortSignal.timeout(6000) });
        const d = (await res.json())?.[m[1]]?.data;
        return { gameName: d?.name || '', image: d?.header_image || '' };
    } catch (_) { return { gameName: '', image: '' }; }
}

// ── Time zone maths (same approach as src/pages/tools/meet/lib.ts) ──────────
const pad = n => String(n).padStart(2, '0');
function wallParts(ms, tz) {
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) {
        if (type !== 'literal') p[type] = Number(value);
    }
    return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}
function tzOffsetMs(ms, tz) {
    const w = wallParts(ms, tz);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000;
}
// Wall-clock date + minute-of-day in `tz` → UTC epoch ms
function zonedToUtc(date, minute, tz) {
    const [y, m, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, 0, minute);
    let utc = guess - tzOffsetMs(guess, tz);
    const corrected = guess - tzOffsetMs(utc, tz);
    if (corrected !== utc) utc = corrected;
    return utc;
}
function todayIn(tz) { const w = wallParts(Date.now(), tz); return `${w.y}-${pad(w.m)}-${pad(w.d)}`; }
function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "today", "tomorrow", "sat", "25/10", "25/10/2026", "2026-10-25", "25 oct", "oct 25th" → 'YYYY-MM-DD'
function parseDate(raw, tz) {
    const s = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
    const today = todayIn(tz);
    const [ty] = today.split('-').map(Number);
    if (s === 'today' || s === 'tonight') return today;
    if (s === 'tomorrow') return addDays(today, 1);
    const wd = WEEKDAYS.findIndex(d => s.replace(/^(this|next) /, '').startsWith(d));
    if (wd >= 0 && /^(this |next )?[a-z]+$/.test(s)) {
        let n = (wd - dowOf(today) + 7) % 7;
        if (s.startsWith('next ') && n === 0) n = 7;
        return addDays(today, n);
    }
    const build = (y, m, d) => {
        if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
        const iso = `${y}-${pad(m)}-${pad(d)}`;
        return addDays(iso, 0) === iso ? iso : null; // rejects 31/02 etc.
    };
    // No year given → this year, or next year if that date has already gone
    const noYear = (m, d) => { const a = build(ty, m, d); return a && a < today ? build(ty + 1, m, d) : a; };
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return build(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/))) {
        return m[3] ? build(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) : noYear(+m[2], +m[1]);
    }
    const monthIdx = word => MONTHS.findIndex(x => word.startsWith(x)) + 1;
    if ((m = s.match(/^(?:[a-z]+ )?(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/)) && monthIdx(m[2])) return m[3] ? build(+m[3], monthIdx(m[2]), +m[1]) : noYear(monthIdx(m[2]), +m[1]);
    if ((m = s.match(/^(?:[a-z]+ )?([a-z]+) (\d{1,2})(?: (\d{4}))?$/)) && monthIdx(m[1])) return m[3] ? build(+m[3], monthIdx(m[1]), +m[2]) : noYear(monthIdx(m[1]), +m[2]);
    return null;
}

// "20:00", "8pm", "8:30 pm", "noon", "midnight" → minute of day
function parseTime(raw) {
    const s = raw.trim().toLowerCase().replace(/\s+/g, '').replace('.', ':');
    if (s === 'noon') return 12 * 60;
    if (s === 'midnight') return 0;
    const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
    if (!m) return null;
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    if (mi > 59) return null;
    if (m[3]) {
        if (h < 1 || h > 12) return null;
        if (m[3] === 'pm' && h !== 12) h += 12;
        if (m[3] === 'am' && h === 12) h = 0;
    } else if (h > 23) return null;
    return h * 60 + mi;
}

// ── Permissions ─────────────────────────────────────────────────────────────
function baseOverwrites(g, kind, ownerId, memberIds) {
    const perms = kind === 'text' ? TEXT_PERMS : VOICE_PERMS;
    const staffExtra = kind === 'text' ? [PermissionFlagsBits.ManageMessages] : [PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers];
    const botAllow = kind === 'text'
        ? [...TEXT_PERMS, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels]
        : [...VOICE_PERMS, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageChannels];
    const ow = [
        { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: botAllow },
    ];
    if (quarantineRoleId) ow.push({ id: quarantineRoleId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] });
    if (modRoleId) ow.push({ id: modRoleId, allow: [...perms, ...staffExtra] });
    if (g.ownerId !== ownerId) ow.push({ id: g.ownerId, allow: [...perms, ...staffExtra] });
    ow.push({ id: ownerId, allow: kind === 'voice' ? [...perms, PermissionFlagsBits.PrioritySpeaker] : perms });
    for (const id of memberIds) if (id !== g.ownerId) ow.push({ id, allow: perms });
    return ow;
}

async function grant(s, userId) {
    const g = guild();
    const text = g.channels.cache.get(s.textId), voice = g.channels.cache.get(s.voiceId);
    if (text) await text.permissionOverwrites.edit(userId, toFlagObj(TEXT_PERMS, true));
    if (voice) await voice.permissionOverwrites.edit(userId, toFlagObj(VOICE_PERMS, true));
}

async function revoke(s, userId) {
    const g = guild();
    const text = g.channels.cache.get(s.textId), voice = g.channels.cache.get(s.voiceId);
    if (text) await text.permissionOverwrites.delete(userId).catch(() => {});
    if (voice) await voice.permissionOverwrites.delete(userId).catch(() => {});
    const m = g.members.cache.get(userId);
    if (m && voice && m.voice.channelId === voice.id && !isStaff(m)) await m.voice.disconnect('Removed from session').catch(() => {});
}

// ── Session channel messages (tools first, then the pinned announcement) ────
const channelName = (t, title) => `${t.emoji}│${title}`.slice(0, 100);

// Server emojis for the announcement. The two animated ones are known; the calendar / voice /
// Steam ones are looked up by name, falling back to a normal emoji if the server doesn't have one.
const LIVE_EMOJI  = { id: '1529761688893788160', name: 'XZlive', animated: true };
const ARROW_EMOJI = { id: '1469382157649575987', name: 'XZrightarrow', animated: true };
function serverEmoji(pattern, fallback) {
    const e = guild()?.emojis.cache.find(x => pattern.test(x.name));
    return e ? { id: e.id, name: e.name, animated: !!e.animated } : { name: fallback };
}
const emojiText = e => e.id ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e.name;
const cleanTitle = t => t.replace(/[_*~`|\\]/g, '\\$&');

// Components v2 card, same layout as the hand-made Powder Park post:
// game art │ "Mark Availability ➡" + title + announcement with a Schedule button │ Voice Chat + Steam
function buildAnnouncement(s) {
    const td = text => new TextDisplayBuilder().setContent(text);
    const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
    const c = new ContainerBuilder();
    if (s.image) {
        c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(s.image)))
            .addSeparatorComponents(sep());
    }

    const live = emojiText(LIVE_EMOJI);
    const heading = s.lockedStart ? `# ${live} __Starts <t:${s.lockedStart}:R>__\n`
        : s.when ? `# ${live} __${s.when}__\n`
        : s.meetId ? `# ${live} __Mark Availability__ ${emojiText(ARROW_EMOJI)}\n`
        : '';
    const texts = [`${heading}## __${cleanTitle(s.gameName || s.title)}__`]; // Steam game name when there is one, like the original
    if (s.details) texts.push(s.details);
    if (s.lockedStart) texts.push(`-# 🗓️ <t:${s.lockedStart}:F>`);

    if (s.meetId) {
        c.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(...texts.map(td))
            .setButtonAccessory(linkBtn(meetEventUrl(s), 'Schedule', serverEmoji(/calendar|schedule/i, '📅'))));
    } else {
        c.addTextDisplayComponents(...texts.map(td));
    }

    const buttons = [linkBtn(voiceUrl(s), 'Voice Chat', serverEmoji(/^(voice|vc|speaker|volume)/i, '🔊'))];
    if (s.link) {
        const steam = /store\.steampowered\.com/i.test(s.link);
        buttons.push(linkBtn(s.link, steam ? 'Steam' : 'Link', steam ? serverEmoji(/steam/i, '🎮') : { name: '🔗' }));
    }
    c.addSeparatorComponents(sep()).addActionRowComponents(row(...buttons));
    return { flags: V2, components: [c] };
}

function buildTools(s) {
    const g = guild();
    const removeMenu = new StringSelectMenuBuilder().setCustomId(`ses:remove:${s.id}`).setPlaceholder('➖ Remove people…');
    if (s.members.length) {
        const opts = s.members.slice(0, 25).map(id => ({ label: (g?.members.cache.get(id)?.displayName || `User ${id}`).slice(0, 100), value: id }));
        removeMenu.addOptions(opts).setMinValues(1).setMaxValues(opts.length);
    } else {
        removeMenu.addOptions({ label: 'Nobody to remove yet', value: 'none' }).setDisabled(true);
    }
    return {
        embeds: [embed('🛠️ Session tools', `-# Managing is for <@${s.ownerId}> and mods; only <@${s.ownerId}> picks the final time. Anyone can check 📊 Best times or 🚪 Leave.`)],
        components: [
            row(new UserSelectMenuBuilder().setCustomId(`ses:add:${s.id}`).setPlaceholder('➕ Add people…').setMinValues(1).setMaxValues(25)),
            row(removeMenu),
            row(
                btn(`ses:best:${s.id}`, 'Best times', '📊', ButtonStyle.Primary),
                btn(`ses:time:${s.id}`, 'Set exact time', '🕒'),
                btn(`ses:edit:${s.id}`, 'Edit', '✏️'),
                btn(`ses:vis:${s.id}`, s.private ? 'Make public' : 'Make private', s.private ? '🔓' : '🔒'),
            ),
            row(...[
                s.meetId ? linkBtn(meetEventUrl(s), 'Open schedule', '📅') : linkBtn(meetCreateUrl(s), 'Create schedule', '📅'),
                btn(`ses:meet:${s.id}`, s.meetId ? 'Change schedule link' : 'Submit schedule link', '🔗'),
                btn(`ses:leave:${s.id}`, 'Leave', '🚪'),
                btn(`ses:end:${s.id}`, 'End session', '🗑️', ButtonStyle.Danger),
            ].filter(Boolean)),
        ],
    };
}

// Edit a stored message, or post it fresh if it's gone (or is the wrong kind: a Components v2
// message can't be turned into a normal one or back). Returns true if it had to be (re)posted.
async function upsert(ch, s, key, payload, firstPost = {}) {
    const wantV2 = payload.flags === V2;
    const existing = s[key] ? await ch.messages.fetch(s[key]).catch(() => null) : null;
    if (existing && existing.flags.has(V2) === wantV2) {
        await existing.edit({ ...payload, allowedMentions: NO_PINGS }).catch(e => console.error('[Sessions] edit failed:', e.message));
        return false;
    }
    if (existing) await existing.delete().catch(() => {});
    const msg = await ch.send({ ...payload, ...firstPost }).catch(e => { console.error('[Sessions] post failed:', e.message); return null; });
    s[key] = msg?.id || '';
    scheduleSave();
    return !!msg;
}

async function refreshSession(s, { pingIds = [] } = {}) {
    const g = guild();
    const ch = g?.channels.cache.get(s.textId);
    if (!ch) return;
    if (s.members.length) await g.members.fetch({ user: s.members.slice(0, 25) }).catch(() => {});
    const toolsReposted = await upsert(ch, s, 'toolsMsgId', buildTools(s));
    // Keep the announcement below the tools: if the tools had to be reposted, repost it too
    if (toolsReposted && s.announceMsgId) {
        await ch.messages.delete(s.announceMsgId).catch(() => {});
        s.announceMsgId = '';
    }
    const fresh = !s.announceMsgId;
    const posted = await upsert(ch, s, 'announceMsgId', buildAnnouncement(s));
    if (posted && s.announceMsgId) await ch.messages.pin(s.announceMsgId).catch(() => {});
    // Mentions inside a Components v2 card don't notify anyone, so invitees get a normal message under it
    if (fresh && posted && pingIds.length) {
        await ch.send({ content: `👋 ${mentions(pingIds)}`, allowedMentions: { users: pingIds } }).catch(() => {});
    }
}

// ── Panel (Components v2, like the Voice Rooms panel) ───────────────────────
function buildPanel() {
    const pub = [...sessions.values()].filter(s => !s.private).sort((a, b) => (a.lockedStart || Infinity) - (b.lockedStart || Infinity) || a.createdAt - b.createdAt);
    const when = s => s.lockedStart ? `<t:${s.lockedStart}:R>` : s.when ? s.when.slice(0, 40) : s.meetId ? 'voting on a time' : 'time TBD';
    const list = pub.length
        ? pub.slice(0, 15).map(s => `${typeOf(s).emoji} **${s.title}** · 👑 <@${s.ownerId}> · 👥 ${everyoneIn(s).length} · 🗓️ ${when(s)}`).join('\n') +
            (pub.length > 15 ? `\n-# +${pub.length - 15} more in the menu below` : '')
        : '-# No public sessions right now. Start one!';

    const join = new StringSelectMenuBuilder().setCustomId('ses:join').setPlaceholder('🙋 Join a public session…');
    if (pub.length) {
        join.addOptions(pub.slice(0, 25).map(s => ({
            label: s.title.slice(0, 100),
            value: s.id,
            emoji: typeOf(s).emoji,
            description: `${typeOf(s).label} · hosted by ${s.ownerName} · ${everyoneIn(s).length} going`.slice(0, 100),
        })));
    } else {
        join.addOptions({ label: 'No public sessions yet', value: 'none' }).setDisabled(true);
    }

    return new ContainerBuilder().setAccentColor(ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '## 📅 Plan a Session\nGaming, recording, streaming, anything. Make a session, invite people, pick a time.\n' +
            '-# Every session gets its own text + voice channel that only the people in it (and mods) can see.\n' +
            '-# 🔓 public: listed here, anyone can join · 🔒 private: invite only, never listed'))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(list))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            row(
                btn('ses:create:pub', 'Create public', '🔓', ButtonStyle.Primary),
                btn('ses:create:priv', 'Create private', '🔒', ButtonStyle.Primary),
                btn('ses:mine', 'My sessions', '📋'),
            ),
            row(join),
        );
}

function refreshPanel(delay = 2000) {
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => {
        panelQueue = panelQueue.then(async () => {
            const ch = panelChannelId ? await client.channels.fetch(panelChannelId).catch(() => null) : null;
            if (!ch) return;
            const payload = { flags: V2, components: [buildPanel()], allowedMentions: NO_PINGS };
            const msg = panelMessageId ? await ch.messages.fetch(panelMessageId).catch(() => null) : null;
            if (msg) { await msg.edit(payload); return; }
            const sent = await ch.send(payload);
            panelMessageId = sent.id;
            scheduleSave();
        }).catch(e => console.error('[Sessions] panel update failed:', e.message));
    }, delay);
}

// ── Meet scheduler (truebeast.io/meet, Firestore meetEvents) ────────────────
const fsVal = v => v == null ? null
    : 'stringValue' in v ? v.stringValue
    : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? Number(v.doubleValue)
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(fsVal)
    : null;
const fsDoc = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fsVal(v)]));

// → event object, null if it doesn't exist, undefined if it couldn't be checked
async function fetchMeetEvent(id) {
    try {
        const res = await fetch(`${FS_BASE}/meetEvents/${id}?key=${FIREBASE_API_KEY}`, { signal: AbortSignal.timeout(8000) });
        if (res.status === 404) return null;
        if (!res.ok) return undefined;
        return fsDoc(await res.json());
    } catch (_) { return undefined; }
}

async function fetchMeetPeople(id) {
    const res = await fetch(`${FS_BASE}/meetEvents/${id}/people?pageSize=300&key=${FIREBASE_API_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()).documents || []).map(fsDoc);
}

// Events made from the site's "Find a time" link are tagged with discordSession = text channel id
async function findMeetForSession(sid) {
    try {
        const res = await fetch(`${FS_BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ structuredQuery: {
                from: [{ collectionId: 'meetEvents' }],
                where: { fieldFilter: { field: { fieldPath: 'discordSession' }, op: 'EQUAL', value: { stringValue: sid } } },
                limit: 10,
            } }),
        });
        if (!res.ok) return null;
        const docs = (await res.json()).filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), ...fsDoc(r.document) }));
        docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return docs[0]?.id || null;
    } catch (_) { return null; }
}

// Group consecutive 15-min slots where the same people are free, best first
function bestWindows(ev, people) {
    const nowS = Date.now() / 1000;
    const bySlot = new Map();
    for (const p of people) {
        for (const slot of p.slots || []) {
            if (ev.mode !== 'days' && slot + SLOT_S <= nowS) continue;
            if (!bySlot.has(slot)) bySlot.set(slot, new Set());
            bySlot.get(slot).add(p.name);
        }
    }
    const runs = [];
    let cur = null;
    for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
        const names = [...bySlot.get(slot)].sort();
        const key = names.join('\n');
        if (cur && cur.end === slot && cur.key === key) cur.end += SLOT_S;
        else runs.push(cur = { start: slot, end: slot + SLOT_S, key, names });
    }
    runs.sort((a, b) => b.names.length - a.names.length || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    return runs.slice(0, 3);
}

function weeklyLabel(start, end, tz) {
    const zone = tz || 'UTC';
    const day  = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: zone }).format(start * 1000);
    const time = ms => new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone }).format(ms);
    return `${day}s, ${time(start * 1000)} – ${time(end * 1000)} (${tzName(zone)})`;
}

function windowLabel(ev, w) {
    if (ev.mode === 'days') return weeklyLabel(w.start, w.end, ev.timezone);
    return `<t:${w.start}:F> – <t:${w.end}:t>`;
}

const fmtLength = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' '); };
const NUMS = ['1️⃣', '2️⃣', '3️⃣'];

async function showBestTimes(ix, s) {
    if (!s.meetId) {
        const found = await findMeetForSession(s.id);
        if (found) { s.meetId = found; scheduleSave(); await refreshSession(s); }
    }
    if (!s.meetId) {
        return reply(ix, '', { embeds: [embed('📊 Best times', `There's no schedule yet. <@${s.ownerId}> can make one with **📅 Create schedule** in the tools, then **🔗 Submit schedule link**.`)] });
    }
    await ix.deferReply({ flags: EPH });
    const ev = await fetchMeetEvent(s.meetId);
    if (!ev) return ix.editReply({ content: '❌ Couldn\'t load the scheduler. Try again in a moment.' });
    let people;
    try { people = (await fetchMeetPeople(s.meetId)).filter(p => p.slots?.length); }
    catch (_) { return ix.editReply({ content: '❌ Couldn\'t load everyone\'s availability. Try again in a moment.' }); }

    const markBtn = linkBtn(meetEventUrl(s), "Mark when you're free", '📅');
    const windows = bestWindows(ev, people);
    if (!windows.length) {
        return ix.editReply({ embeds: [embed('📊 Best times', 'Nobody has marked any times yet. Be the first!')], components: [row(markBtn)] });
    }
    const total = people.length;
    const blocks = windows.map((w, i) => {
        const missing = people.map(p => p.name).filter(n => !w.names.includes(n));
        return `${NUMS[i]} **${windowLabel(ev, w)}**\n` +
            `-# ✅ ${w.names.length} of ${total} free · ${fmtLength(w.end - w.start)}${missing.length ? ` · can't make it: ${missing.join(', ')}` : ''}`;
    });
    const e = embed('📊 Best times so far', blocks.join('\n\n'))
        .setFooter({ text: `${total} ${total === 1 ? 'person has' : 'people have'} marked their times${isHost(ix.member, s) ? ' · pick one to lock it in' : ''}` });
    const mode = ev.mode === 'days' ? 'w' : 'd';
    const rows = [];
    if (isHost(ix.member, s)) {
        rows.push(row(...windows.map((w, i) => btn(`ses:lock:${s.id}:${mode}:${w.start}:${w.end}`, `Pick ${i + 1}`, NUMS[i], ButtonStyle.Success))));
    }
    rows.push(row(markBtn, btn(`ses:best:${s.id}`, 'Refresh', '🔄')));
    return ix.editReply({ embeds: [e], components: rows });
}

// Post the "it's on" embed that pings everyone
async function announceLocked(s, byId) {
    const ch = guild()?.channels.cache.get(s.textId);
    const others = everyoneIn(s).filter(id => id !== byId);
    const label = s.lockedStart ? `**<t:${s.lockedStart}:F>** (<t:${s.lockedStart}:R>)` : `**${s.when}**`;
    await ch?.send({
        content: others.length ? mentions(others) : undefined,
        embeds: [embed('📌 Time locked in', `**${s.title}** is on ${label}.` + (s.lockedStart ? '\n-# Everyone gets a ping 15 minutes before and when it starts.' : ''))],
        components: [row(joinVoiceBtn(s))],
        allowedMentions: { users: others },
    }).catch(() => {});
}

function setLocked(s, start) {
    s.lockedStart = start; s.lockedEnd = null; s.when = '';
    s.reminded15 = false; s.remindedStart = false;
    scheduleSave();
}

async function lockIn(ix, s, mode, start, end) {
    if (!isHost(ix.member, s)) return reply(ix, `Only <@${s.ownerId}> (the host) can pick the final time.`);
    if (mode === 'w') {
        const ev = s.meetId ? await fetchMeetEvent(s.meetId) : null;
        s.when = weeklyLabel(start, end, ev?.timezone);
        s.lockedStart = null;
        scheduleSave();
    } else {
        if (end <= Date.now() / 1000) return reply(ix, '⌛ That time has already passed. Hit 🔄 Refresh.');
        setLocked(s, start);
    }
    await ix.update({ embeds: [embed('📌 Locked in', 'Everyone has been pinged.')], components: [] }).catch(() => {});
    await refreshSession(s);
    refreshPanel();
    await announceLocked(s, ix.user.id);
}

// ── Modals ──────────────────────────────────────────────────────────────────
function textLabel(label, description, input) {
    const l = new LabelBuilder().setLabel(label).setTextInputComponent(input);
    if (description) l.setDescription(description);
    return l;
}
function input(id, style, max, { required = false, value = '', placeholder = '' } = {}) {
    const t = new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(required);
    if (value) t.setValue(value.slice(0, max));
    if (placeholder) t.setPlaceholder(placeholder);
    return t;
}
function typeLabel(current = 'gaming') {
    return new LabelBuilder().setLabel('What kind of session?').setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId('type').setMinValues(1).setMaxValues(1).addOptions(
            Object.entries(TYPES).map(([value, t]) => ({ label: t.label, value, emoji: t.emoji, default: value === current }))));
}
const tzMenu = (id, current) => new StringSelectMenuBuilder().setCustomId(id).setMinValues(1).setMaxValues(1)
    .addOptions(TIMEZONES.map(([value, label]) => ({ label, value, description: value, default: value === current })));

function createModal(isPrivate) {
    const m = new ModalBuilder()
        .setCustomId(`ses:createm:${isPrivate ? 'priv' : 'pub'}`)
        .setTitle(isPrivate ? '🔒 New private session' : '🔓 New public session');
    m.addLabelComponents(
        textLabel('Session name', null, input('title', TextInputStyle.Short, 80, { required: true, placeholder: 'e.g. Helldivers 2 squad night' })),
        typeLabel(),
        textLabel('Link (optional)', 'Steam page, store page, YouTube… Steam links add the game art', input('link', TextInputStyle.Short, 300, { placeholder: 'https://store.steampowered.com/app/…' })),
        textLabel('Announcement (optional)', 'What are we doing? Mods to install, what to bring…', input('details', TextInputStyle.Paragraph, 1500)),
    );
    if (isPrivate) {
        m.addLabelComponents(new LabelBuilder().setLabel("Who's invited?").setDescription('You can add or remove people later too')
            .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('invite').setMinValues(0).setMaxValues(25).setRequired(false)));
    }
    return m;
}

function editModal(s) {
    return new ModalBuilder().setCustomId(`ses:editm:${s.id}`).setTitle('✏️ Edit announcement').addLabelComponents(
        textLabel('Session name', null, input('title', TextInputStyle.Short, 80, { required: true, value: s.title })),
        typeLabel(s.type),
        textLabel('Link (optional)', null, input('link', TextInputStyle.Short, 300, { value: s.link })),
        textLabel('Announcement (optional)', null, input('details', TextInputStyle.Paragraph, 1500, { value: s.details })),
    );
}

// Exact date + time. `withTz` adds a time zone picker (the create flow already picked one).
function timeModal(customId, tz, withTz) {
    const m = new ModalBuilder().setCustomId(customId).setTitle('🕒 Set the time').addLabelComponents(
        textLabel('Date', 'e.g. Saturday, tomorrow, 25/10, 25 Oct', input('date', TextInputStyle.Short, 30, { required: true, placeholder: 'Saturday' })),
        textLabel('Start time', 'e.g. 8pm, 20:00, 7:30pm', input('time', TextInputStyle.Short, 10, { required: true, placeholder: '8pm' })),
    );
    if (withTz) m.addLabelComponents(new LabelBuilder().setLabel('Time zone').setStringSelectMenuComponent(tzMenu('tz', tz)));
    return m;
}

function meetLinkModal(customId, value = '') {
    return new ModalBuilder().setCustomId(customId).setTitle('🔗 Submit schedule link').addLabelComponents(
        textLabel('Schedule link', 'Copy it from the event page after you create it', input('url', TextInputStyle.Short, 200, { required: true, value, placeholder: 'https://truebeast.io/meet/…' })));
}

// Modal → meet event id, after checking it exists. → { meetId } or { error }
async function readMeetModal(ix) {
    const raw = ix.fields.getTextInputValue('url').trim();
    const meetId = raw.match(/\/meet\/([a-z0-9]{6,24})/i)?.[1] || (/^[a-z0-9]{6,24}$/i.test(raw) ? raw : null);
    if (!meetId) return { error: "❌ That doesn't look like a schedule link. It should look like `https://truebeast.io/meet/abc123xyz`." };
    if (await fetchMeetEvent(meetId) === null) return { error: "❌ Couldn't find that event. Double-check the link." };
    return { meetId };
}

// → { start } (epoch seconds) or { error }
function readTimeModal(ix, tz) {
    const date = parseDate(ix.fields.getTextInputValue('date'), tz);
    if (!date) return { error: "❌ I couldn't read that date. Try `Saturday`, `tomorrow`, `25/10` or `25 Oct`." };
    const minute = parseTime(ix.fields.getTextInputValue('time'));
    if (minute == null) return { error: "❌ I couldn't read that time. Try `8pm`, `20:00` or `7:30pm`." };
    const start = Math.floor(zonedToUtc(date, minute, tz) / 1000);
    if (start <= Date.now() / 1000) return { error: '❌ That time has already passed.' };
    return { start };
}

// ── Create: modal → "Find a time" step → channels ──────────────────────────
function setupView(p) {
    return {
        embeds: [embed(`📅 Find a time for ${p.title}`,
            '**1.** Hit **Create schedule** and make the event on the site.\n' +
            '**2.** Copy the event link, come back and hit **Submit link**.\n\n' +
            '-# Already know when it is, or want to do it later? **Skip**. You can still add a schedule or set an exact time from the session tools.')],
        components: [row(
            linkBtn(`${MEET_URL}?name=${encodeURIComponent(p.title)}`, 'Create schedule', '📅'),
            btn('ses:su:link', 'Submit link', '🔗', ButtonStyle.Success),
            btn('ses:su:skip', 'Skip', '⏭️'),
        )],
    };
}

async function startCreate(ix, isPrivate) {
    const member = ix.member;
    const title   = ix.fields.getTextInputValue('title').trim().replace(/\s+/g, ' ').slice(0, 80);
    const type    = ix.fields.getStringSelectValues('type')?.[0] || 'gaming';
    const linkRaw = ix.fields.getTextInputValue('link').trim();
    const details = ix.fields.getTextInputValue('details').trim();
    const invited = isPrivate ? [...(ix.fields.getSelectedUsers('invite')?.values() || [])] : [];
    const link    = normalizeLink(linkRaw);

    if (!title) return reply(ix, '❌ The session needs a name.');
    if (linkRaw && !link) return reply(ix, "❌ That link doesn't look right. Paste the full address, e.g. `https://store.steampowered.com/app/553850`.");
    const limitError = createLimitError(member);
    if (limitError) return reply(ix, limitError);

    const p = {
        isPrivate, title, type, link: link || '', details,
        members: invited.filter(u => !u.bot && u.id !== member.id).map(u => u.id),
        tz: userTz.get(member.id) || DEFAULT_TZ, at: Date.now(),
    };
    pending.set(member.id, p);
    return ix.reply({ ...setupView(p), flags: EPH });
}

function createLimitError(member) {
    const owned = [...sessions.values()].filter(s => s.ownerId === member.id).length;
    if (owned >= MAX_PER_OWNER && !isStaff(member)) return `❌ You're already hosting ${owned} sessions. End one first (🗑️ in its tools).`;
    if (sessions.size >= MAX_TOTAL) return '❌ There are too many sessions open right now. Try again once some have ended.';
    return null;
}

// `when`: { meetId } | {}. `ix` has already been deferred (update) on the setup message.
async function finishCreate(ix, p, when) {
    const member = ix.member, g = ix.guild;
    pending.delete(member.id);
    const limitError = createLimitError(member);
    if (limitError) return ix.editReply({ content: limitError, embeds: [], components: [] });

    await ix.editReply({ embeds: [embed('⏳ Setting up your session…')], components: [] });
    const t = TYPES[p.type] || TYPES.other;
    let text = null, voice = null, s = null;
    try {
        const meta = await lookupLink(p.link);
        text = await g.channels.create({
            name: channelName(t, p.title),
            type: ChannelType.GuildText,
            parent: CATEGORY_ID,
            topic: `${t.label} session hosted by ${member.displayName}. Only people in the session (and mods) can see this.`,
            permissionOverwrites: baseOverwrites(g, 'text', member.id, p.members),
            reason: `Planned session for ${member.user.tag}`,
        });
        voice = await g.channels.create({
            name: channelName(t, p.title),
            type: ChannelType.GuildVoice,
            parent: CATEGORY_ID,
            permissionOverwrites: baseOverwrites(g, 'voice', member.id, p.members),
            reason: `Planned session for ${member.user.tag}`,
        });

        s = {
            id: text.id, textId: text.id, voiceId: voice.id,
            ownerId: member.id, ownerName: member.displayName,
            private: p.isPrivate, title: p.title, type: p.type, link: p.link, details: p.details, when: '',
            gameName: meta.gameName, image: meta.image, tz: p.tz,
            members: p.members, meetId: '', lockedStart: null, lockedEnd: null, reminded15: false, remindedStart: false,
            announceMsgId: '', toolsMsgId: '', renames: [], createdAt: Date.now(),
        };
        if (when.meetId) s.meetId = when.meetId;
        sessions.set(s.id, s);
        scheduleSave();
        await refreshSession(s, { pingIds: p.members });
        refreshPanel();
        console.log(`[Sessions] ${member.user.tag} created ${p.isPrivate ? 'private' : 'public'} session "${p.title}" (${p.members.length} invited)`);
    } catch (e) {
        console.error('[Sessions] create failed:', e.message);
        if (text) { sessions.delete(text.id); await text.delete('Session creation failed').catch(() => {}); }
        if (voice) await voice.delete('Session creation failed').catch(() => {});
        scheduleSave();
        return ix.editReply({ embeds: [embed('❌ Couldn\'t create the session', 'Try again in a moment.')], components: [] });
    }

    const notes = [
        p.isPrivate ? `🔒 Private${p.members.length ? ` · ${p.members.length} invited` : ''}` : '🔓 Public · listed on the panel so anyone can join',
        s.meetId ? "📅 Schedule attached, everyone can mark when they're free" : '',
    ].filter(Boolean);
    return ix.editReply({
        embeds: [embed('✅ Your session is ready', notes.join('\n'))],
        components: [row(linkBtn(textUrl(s), 'Open session', '💬'), joinVoiceBtn(s))],
    });
}

// ── Members ─────────────────────────────────────────────────────────────────
async function dmAdded(s, userId, byName) {
    const user = await client.users.fetch(userId).catch(() => null);
    await user?.send({
        embeds: [embed(`${typeOf(s).emoji} You've been added to ${s.title}`, `**${byName}** added you to a session in TrueBeast.`)],
        components: [row(linkBtn(textUrl(s), 'Open session', '💬'))],
    }).catch(() => {}); // DMs closed: they'll still see the channel appear
}

async function addPeople(ix, s) {
    if (!canManage(ix.member, s)) { await reply(ix, `Only <@${s.ownerId}> or a mod can add people.`); return refreshSession(s); }
    await ix.deferUpdate();
    const added = [];
    for (const u of ix.users.values()) {
        if (u.bot || u.id === s.ownerId || s.members.includes(u.id)) continue;
        const m = await ix.guild.members.fetch(u.id).catch(() => null);
        if (!m) continue;
        try { await grant(s, u.id); } catch (e) { console.error('[Sessions] grant failed:', e.message); continue; }
        s.members.push(u.id);
        added.push(u.id);
    }
    scheduleSave();
    await refreshSession(s); // also resets the picker
    refreshPanel();
    if (!added.length) return reply(ix, 'Nobody new to add (they\'re already in, or are bots).');
    for (const id of added) dmAdded(s, id, ix.member.displayName);
    return reply(ix, `➕ Added ${mentions(added)}.`);
}

async function removePeople(s, ids) {
    const removed = [];
    for (const id of ids) {
        if (!s.members.includes(id)) continue;
        await revoke(s, id);
        s.members = s.members.filter(x => x !== id);
        removed.push(id);
    }
    scheduleSave();
    await refreshSession(s);
    refreshPanel();
    return removed;
}

// ── Interactions (customId prefix `ses:`) ───────────────────────────────────
function isSessionInteraction(ix) { return typeof ix.customId === 'string' && ix.customId.startsWith('ses:'); }

async function handleSessionInteraction(ix) {
    if (!loaded) return reply(ix, '📅 Sessions are still starting up. Try again in a minute.');
    const id = ix.customId;
    const parts = id.split(':');

    // ── Panel + create flow ──
    if (ix.isButton() && id.startsWith('ses:create:')) return ix.showModal(createModal(id.endsWith(':priv')));
    if (ix.isModalSubmit() && id.startsWith('ses:createm:')) return startCreate(ix, id.endsWith(':priv'));

    if (id.startsWith('ses:su:')) {
        const p = pending.get(ix.user.id);
        if (!p || Date.now() - p.at > SETUP_TTL) {
            pending.delete(ix.user.id);
            return ix.update({ embeds: [embed('⌛ This setup expired', 'Hit Create on the panel to start again.')], components: [] }).catch(() => {});
        }
        const what = parts[2];
        if (what === 'skip') { await ix.deferUpdate(); return finishCreate(ix, p, {}); }
        if (what === 'link') return ix.showModal(meetLinkModal('ses:su:linkm'));
        if (what === 'linkm' && ix.isModalSubmit()) {
            await ix.deferUpdate(); // the link check can take longer than Discord's 3s window
            const r = await readMeetModal(ix);
            if (r.error) return reply(ix, r.error);
            return finishCreate(ix, p, { meetId: r.meetId });
        }
        return;
    }

    if (ix.isButton() && id === 'ses:mine') {
        const mine = [...sessions.values()].filter(s => everyoneIn(s).includes(ix.user.id));
        if (!mine.length) return reply(ix, '', { embeds: [embed('📋 Your sessions', "You're not in any sessions yet. Create one, or join a public one from the menu.")] });
        return reply(ix, '', { embeds: [embed('📋 Your sessions', mine.map(s =>
            `${typeOf(s).emoji} <#${s.textId}> · ${s.ownerId === ix.user.id ? '👑 hosting' : `hosted by <@${s.ownerId}>`}` +
            (s.lockedStart ? ` · <t:${s.lockedStart}:R>` : '')).join('\n'))] });
    }

    if (ix.isStringSelectMenu() && id === 'ses:join') {
        const s = sessions.get(ix.values[0]);
        refreshPanel(0); // resets the menu
        if (!s || s.private) return reply(ix, '❌ That session isn\'t open to join anymore.');
        if (everyoneIn(s).includes(ix.user.id)) return reply(ix, '', { embeds: [embed(`You're already in ${s.title}`)], components: [row(linkBtn(textUrl(s), 'Open session', '💬'))] });
        try { await grant(s, ix.user.id); } catch (e) {
            console.error('[Sessions] join failed:', e.message);
            return reply(ix, "❌ Couldn't add you. Try again in a moment.");
        }
        s.members.push(ix.user.id);
        scheduleSave();
        await reply(ix, '', { embeds: [embed(`✅ You joined ${s.title}`)], components: [row(linkBtn(textUrl(s), 'Open session', '💬'), joinVoiceBtn(s))] });
        await refreshSession(s);
        return;
    }

    // ── Session tools: ses:<action>:<sessionId>[:…] ──
    const s = sessions.get(parts[2]);
    if (!s) return reply(ix, '❌ This session has ended.');
    const manage = canManage(ix.member, s);
    const denied = () => reply(ix, `Only <@${s.ownerId}> or a mod can do that.`);

    switch (parts[1]) {
        case 'add':
            if (ix.isUserSelectMenu()) return addPeople(ix, s);
            break;

        case 'remove': {
            if (!ix.isStringSelectMenu()) break;
            if (!manage) { await denied(); return refreshSession(s); }
            await ix.deferUpdate();
            const removed = await removePeople(s, ix.values);
            if (removed.length) await reply(ix, `➖ Removed ${mentions(removed)}. They can't see the session anymore.`);
            return;
        }

        case 'leave': {
            if (ix.user.id === s.ownerId) return reply(ix, "You're the host. Use **🗑️ End session** to close it, or ask a mod to take over.");
            if (!s.members.includes(ix.user.id)) return reply(ix, "You're not a member of this session.");
            await reply(ix, '🚪 You left the session.');
            await removePeople(s, [ix.user.id]);
            return;
        }

        case 'vis': {
            if (!manage) return denied();
            s.private = !s.private;
            scheduleSave();
            await ix.deferUpdate();
            await refreshSession(s);
            refreshPanel();
            return reply(ix, s.private
                ? '🔒 Private now. It\'s no longer listed, so only people you add can get in.'
                : `🔓 Public now. It's listed in <#${panelChannelId}> and anyone can join.`);
        }

        case 'edit':
            if (!manage) return denied();
            return ix.showModal(editModal(s));

        case 'editm': {
            if (!ix.isModalSubmit()) break;
            if (!manage) return denied();
            const title   = ix.fields.getTextInputValue('title').trim().replace(/\s+/g, ' ').slice(0, 80);
            const type    = ix.fields.getStringSelectValues('type')?.[0] || s.type;
            const linkRaw = ix.fields.getTextInputValue('link').trim();
            const details = ix.fields.getTextInputValue('details').trim();
            const link    = normalizeLink(linkRaw);
            if (!title) return reply(ix, '❌ The session needs a name.');
            if (linkRaw && !link) return reply(ix, "❌ That link doesn't look right. Paste the full address.");
            await ix.deferReply({ flags: EPH });

            let note = '';
            if (title !== s.title || type !== s.type) {
                // Discord allows 2 renames per channel per 10 min; past that the request just hangs, so check first
                s.renames = (s.renames || []).filter(t => Date.now() - t < 10 * MIN);
                if (s.renames.length >= 2) note = '\n-# Discord only allows 2 renames every 10 minutes, so the channel names stay for now.';
                else {
                    s.renames.push(Date.now());
                    const t = TYPES[type] || TYPES.other;
                    await guild().channels.cache.get(s.textId)?.setName(channelName(t, title)).catch(() => {});
                    await guild().channels.cache.get(s.voiceId)?.setName(channelName(t, title)).catch(() => {});
                }
            }
            if ((link || '') !== s.link) Object.assign(s, { link: link || '' }, await lookupLink(link));
            Object.assign(s, { title, type, details });
            scheduleSave();
            await refreshSession(s);
            refreshPanel();
            return ix.editReply({ content: '✏️ Announcement updated.' + note });
        }

        case 'time':
            if (!isHost(ix.member, s)) return reply(ix, `Only <@${s.ownerId}> (the host) can pick the final time.`);
            return ix.showModal(timeModal(`ses:timem:${s.id}`, userTz.get(ix.user.id) || s.tz || DEFAULT_TZ, true));

        case 'timem': {
            if (!ix.isModalSubmit()) break;
            if (!isHost(ix.member, s)) return reply(ix, `Only <@${s.ownerId}> (the host) can pick the final time.`);
            const tz = ix.fields.getStringSelectValues('tz')?.[0] || DEFAULT_TZ;
            userTz.set(ix.user.id, tz);
            const r = readTimeModal(ix, tz);
            if (r.error) return reply(ix, r.error);
            setLocked(s, r.start);
            await reply(ix, `📌 Set for <t:${r.start}:F>.`);
            await refreshSession(s);
            refreshPanel();
            await announceLocked(s, ix.user.id);
            return;
        }

        case 'meet':
            if (!manage) return denied();
            return ix.showModal(meetLinkModal(`ses:meetm:${s.id}`, s.meetId ? meetEventUrl(s) : ''));

        case 'meetm': {
            if (!ix.isModalSubmit()) break;
            if (!manage) return denied();
            await ix.deferReply({ flags: EPH });
            const r = await readMeetModal(ix);
            if (r.error) return ix.editReply(r.error);
            Object.assign(s, { meetId: r.meetId, when: '', lockedStart: null });
            scheduleSave();
            await refreshSession(s);
            refreshPanel();
            return ix.editReply("🔗 Schedule attached. The **Mark when you're free** button is on the announcement.");
        }

        case 'best':
            return showBestTimes(ix, s);

        case 'lock':
            return lockIn(ix, s, parts[3], Number(parts[4]), Number(parts[5]));

        case 'end':
            if (!manage) return denied();
            return reply(ix, `🗑️ End **${s.title}**? Both channels and their messages are deleted for everyone.`, {
                components: [row(btn(`ses:endyes:${s.id}`, 'Yes, end it', '🗑️', ButtonStyle.Danger))],
            });

        case 'endyes': {
            if (!manage) return denied();
            await ix.deferUpdate().catch(() => {});
            await endSession(s, `ended by ${ix.user.tag}`);
            return;
        }
    }
}

async function endSession(s, why) {
    sessions.delete(s.id);
    scheduleSave();
    refreshPanel();
    const g = guild();
    await g?.channels.cache.get(s.voiceId)?.delete(`Session ${why}`).catch(() => {});
    await g?.channels.cache.get(s.textId)?.delete(`Session ${why}`).catch(() => {});
    console.log(`[Sessions] "${s.title}" ${why}`);
}

// One of a session's channels was deleted by hand → tidy up the other half
async function handleSessionChannelDelete(channel) {
    for (const s of sessions.values()) {
        if (channel.id === s.textId || channel.id === s.voiceId) {
            await endSession(s, 'channel deleted manually');
            return;
        }
    }
}

// ── Background: reminders + picking up schedulers made on the site ──────────
async function remindTick() {
    const nowS = Math.floor(Date.now() / 1000);
    for (const [uid, p] of pending) if (Date.now() - p.at > SETUP_TTL) pending.delete(uid);
    for (const s of sessions.values()) {
        if (!s.lockedStart) continue;
        const ch = guild()?.channels.cache.get(s.textId);
        const post = (title, text) => ch?.send({
            content: mentions(everyoneIn(s)),
            embeds: [embed(title, text)],
            components: [row(joinVoiceBtn(s))],
            allowedMentions: { users: everyoneIn(s) },
        }).catch(() => {});
        if (!s.reminded15 && nowS >= s.lockedStart - REMIND_BEFORE_S) {
            s.reminded15 = true;
            scheduleSave();
            if (nowS < s.lockedStart) await post(`⏰ ${s.title} starts soon`, `Kicking off <t:${s.lockedStart}:R>.`);
        }
        if (!s.remindedStart && nowS >= s.lockedStart) {
            s.remindedStart = true;
            scheduleSave();
            if (nowS < s.lockedStart + 30 * 60) await post(`🟢 ${s.title} is starting now`, 'Hop in!');
        }
    }
}

async function meetPollTick() {
    for (const s of [...sessions.values()]) {
        if (s.meetId || s.lockedStart || Date.now() - s.createdAt > MEET_POLL_MAX_AGE) continue;
        const found = await findMeetForSession(s.id);
        if (found && sessions.has(s.id) && !s.meetId) {
            s.meetId = found;
            scheduleSave();
            await refreshSession(s);
        }
    }
}

// ── Startup ─────────────────────────────────────────────────────────────────
async function startSessions(discordClient, { modRoleId: mod, quarantineRoleId: quarantine }) {
    client = discordClient;
    modRoleId = mod || null;
    quarantineRoleId = quarantine || null;
    const category = await client.channels.fetch(CATEGORY_ID).catch(() => null);
    if (!category) { console.error('[Sessions] Custom Voice Chats category not found'); return; }
    const g = category.guild;
    guildId = g.id;

    let state = null;
    for (let attempt = 1; attempt <= 5 && !state; attempt++) {
        state = await loadState().catch(e => { console.error(`[Sessions] load failed (attempt ${attempt}):`, e.message); return null; });
        if (!state) await new Promise(r => setTimeout(r, 30 * 1000));
    }
    if (!state) { console.error('[Sessions] giving up on load — sessions stay off until restart'); return; }

    let saved = {}, tzs = {};
    try { saved = JSON.parse(state.sessionsJson || '{}'); } catch (_) {}
    try { tzs = JSON.parse(state.tzJson || '{}'); } catch (_) {}
    for (const [uid, tz] of Object.entries(tzs)) userTz.set(uid, tz);
    panelChannelId = state.panelChannelId || null;
    panelMessageId = state.panelMessageId || null;

    // Drop sessions whose text channel is gone; delete a stray voice half
    for (const [id, s] of Object.entries(saved)) {
        if (!g.channels.cache.has(s.textId)) {
            await g.channels.cache.get(s.voiceId)?.delete('Session text channel gone').catch(() => {});
            continue;
        }
        sessions.set(id, { renames: [], members: [], ...s });
    }
    loaded = true;
    scheduleSave();
    console.log(`[Sessions] Restored ${sessions.size} session(s)`);

    // Move any sessions made before the switch into Custom Voice Chats, then remove the
    // old "📅 Sessions" category the first version created (only if it's left empty)
    for (const s of sessions.values()) {
        for (const cid of [s.textId, s.voiceId]) {
            const ch = g.channels.cache.get(cid);
            if (ch && ch.parentId !== CATEGORY_ID) await ch.setParent(CATEGORY_ID, { lockPermissions: false }).catch(e => console.error('[Sessions] move failed:', e.message));
            // Names from before the "🎮│Name" format
            if (ch && !ch.name.includes('│')) await ch.setName(channelName(typeOf(s), s.title)).catch(e => console.error('[Sessions] rename failed:', e.message));
        }
    }
    if (state.categoryId && state.categoryId !== CATEGORY_ID) {
        const old = g.channels.cache.get(state.categoryId);
        if (old?.type === ChannelType.GuildCategory && !g.channels.cache.some(c => c.parentId === old.id)) {
            await old.delete('Planned sessions moved to Custom Voice Chats').catch(e => console.error('[Sessions] old category delete failed:', e.message));
        }
    }

    // Panel channel: saved ID → existing #plan-a-session → create it in Custom Voice Chats.
    // Read-only for members: everything happens through the panel's buttons.
    let panelCh = panelChannelId ? await client.channels.fetch(panelChannelId).catch(() => null) : null;
    if (!panelCh) panelCh = g.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === PANEL_CHANNEL_NAME) || null;
    if (!panelCh) {
        panelCh = await g.channels.create({
            name: PANEL_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: CATEGORY_ID,
            topic: 'Plan gaming, recording or streaming sessions. Each one gets its own private text + voice channel.',
            permissionOverwrites: [
                { id: g.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                  deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.AddReactions] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] },
            ],
            reason: 'Planned sessions panel channel',
        }).catch(e => { console.error('[Sessions] create panel channel failed:', e.message); return null; });
    }
    if (panelCh && panelCh.id !== panelChannelId) { panelChannelId = panelCh.id; panelMessageId = null; scheduleSave(); }
    refreshPanel(0);

    // Bring any older session messages up to the current layout (tools first, embeds)
    for (const s of sessions.values()) await refreshSession(s).catch(e => console.error('[Sessions] refresh failed:', e.message));

    setInterval(() => remindTick().catch(e => console.error('[Sessions] reminder tick failed:', e.message)), MIN);
    setInterval(() => meetPollTick().catch(e => console.error('[Sessions] meet poll failed:', e.message)), MEET_POLL_MS);
}

module.exports = { startSessions, isSessionInteraction, handleSessionInteraction, handleSessionChannelDelete, flushSessions };
