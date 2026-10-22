/**
 * Planned Sessions — gaming / recording / streaming sessions planned from one panel in
 * #plan-a-session. Every session gets its own hidden text + voice channel that only the host,
 * the people they invite, mods and the server owner can see. Removing someone from the
 * session deletes their channel overwrites, so they lose access straight away.
 *
 * Public sessions are listed on the panel and anyone can join them from there; private
 * ones are invite-only and never listed. Times are found with the truebeast.io/meet
 * scheduler: the "Find a time" link pre-fills the event name and tags it with the session
 * id, the bot picks the event up (or the host pastes the link), reads everyone's
 * availability, suggests the best windows and lets the host lock one in. Locked-in times
 * get a reminder 15 min before and at the start.
 *
 * State: botConfig/sessions → sessionsJson, panelChannelId, panelMessageId, categoryId.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder, LabelBuilder, ChannelType, PermissionFlagsBits,
    MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FS_BASE  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const DOC_URL  = `${FS_BASE}/botConfig/sessions`;
const MEET_URL = 'https://truebeast.io/meet';

const PANEL_CHANNEL_NAME = 'plan-a-session';
const CATEGORY_NAME      = '📅 Sessions';
const ACCENT             = 0x22c55e;
const TOOLS_ACCENT       = 0x6b7280;
const MAX_PER_OWNER      = 3;
const MAX_TOTAL          = 20;               // 2 channels each + the panel stays under Discord's 50-per-category cap
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const MEET_POLL_MS       = 5 * MIN;          // look for a scheduler made from "Find a time"
const MEET_POLL_MAX_AGE  = 14 * DAY;         // stop looking after this
const REMIND_BEFORE_S    = 15 * 60;
const SLOT_S             = 15 * 60;          // meet slots are 15 minutes

const TYPES = {
    gaming:    { emoji: '🎮', label: 'Gaming' },
    recording: { emoji: '🎥', label: 'Recording' },
    streaming: { emoji: '🔴', label: 'Streaming' },
    hangout:   { emoji: '💬', label: 'Hangout' },
    other:     { emoji: '✨', label: 'Other' },
};

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
const sessions = new Map();   // text channel id → session
let loaded = false;           // guards saves so an empty map never overwrites Firestore
let client = null;
let modRoleId = null, quarantineRoleId = null;
let panelChannelId = null, panelMessageId = null, categoryId = null, guildId = null;
let saveTimer = null, panelTimer = null, panelQueue = Promise.resolve();

async function loadState() {
    const res = await fetch(`${DOC_URL}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).fields || {};
    const str = k => f[k]?.stringValue || '';
    return { sessionsJson: str('sessionsJson'), panelChannelId: str('panelChannelId'), panelMessageId: str('panelMessageId'), categoryId: str('categoryId') };
}

async function saveState() {
    if (!loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    const out = {};
    for (const [id, s] of sessions) out[id] = s;
    const fields = {
        sessionsJson:   { stringValue: JSON.stringify(out) },
        panelChannelId: { stringValue: panelChannelId || '' },
        panelMessageId: { stringValue: panelMessageId || '' },
        categoryId:     { stringValue: categoryId || '' },
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
const td  = text => new TextDisplayBuilder().setContent(text);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const linkBtn = (url, label, emoji) =>
    new ButtonBuilder().setURL(url).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link);
const typeOf = s => TYPES[s.type] || TYPES.other;
const everyoneIn = s => [s.ownerId, ...s.members];
const mentions = ids => ids.map(id => `<@${id}>`).join(' ');

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

function whenText(s) {
    if (s.lockedStart) return `<t:${s.lockedStart}:F> (<t:${s.lockedStart}:R>)`;
    return s.when || '_Not set yet. The host can use **📅 Find a time** below._';
}

const meetCreateUrl = s => `${MEET_URL}?name=${encodeURIComponent(s.title)}&session=${s.id}`;
const meetEventUrl  = s => `${MEET_URL}/${s.meetId}`;

// ── Permissions ─────────────────────────────────────────────────────────────
async function baseOverwrites(g, kind, ownerId, memberIds) {
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

// ── Messages ────────────────────────────────────────────────────────────────
function buildAnnouncement(s) {
    const t = typeOf(s);
    const going = everyoneIn(s);
    const c = new ContainerBuilder().setAccentColor(ACCENT)
        .addTextDisplayComponents(td(
            `-# ${t.emoji} ${t.label} session · ${s.private ? '🔒 Private' : '🔓 Public'}\n# ${s.title}` +
            (s.gameName && s.gameName !== s.title ? `\n**${s.gameName}**` : '')));
    if (s.image) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(s.image)));
    if (s.details) c.addTextDisplayComponents(td(s.details));
    c.addSeparatorComponents(sep())
        .addTextDisplayComponents(td(
            `🗓️ **When:** ${whenText(s)}\n` +
            `👑 **Host:** <@${s.ownerId}>\n` +
            `🔊 **Voice:** <#${s.voiceId}>\n` +
            `👥 **Going (${going.length}):** ${mentions(going.slice(0, 40))}${going.length > 40 ? ` +${going.length - 40} more` : ''}`));
    const links = [];
    if (s.link) links.push(linkBtn(s.link, /store\.steampowered\.com/i.test(s.link) ? 'View on Steam' : 'Open link', '🔗'));
    if (s.meetId) links.push(linkBtn(meetEventUrl(s), "Mark when you're free", '📅'));
    if (links.length) c.addActionRowComponents(row(...links));
    return c;
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
    return new ContainerBuilder().setAccentColor(TOOLS_ACCENT)
        .addTextDisplayComponents(td(
            `### 🛠️ Session tools\n-# Adding, removing, scheduling and editing are for <@${s.ownerId}> and mods. Anyone here can check 📊 Best times or 🚪 Leave.`))
        .addActionRowComponents(
            row(new UserSelectMenuBuilder().setCustomId(`ses:add:${s.id}`).setPlaceholder('➕ Add people…').setMinValues(1).setMaxValues(25)),
            row(removeMenu),
            row(
                s.meetId ? linkBtn(meetEventUrl(s), 'Open scheduler', '📅') : linkBtn(meetCreateUrl(s), 'Find a time', '📅'),
                btn(`ses:meet:${s.id}`, s.meetId ? 'Change meet link' : 'Attach meet link', '🔗'),
                btn(`ses:best:${s.id}`, 'Best times', '📊', ButtonStyle.Primary),
                btn(`ses:edit:${s.id}`, 'Edit announcement', '✏️'),
            ),
            row(
                btn(`ses:vis:${s.id}`, s.private ? 'Make public' : 'Make private', s.private ? '🔓' : '🔒'),
                btn(`ses:leave:${s.id}`, 'Leave', '🚪'),
                btn(`ses:end:${s.id}`, 'End session', '🗑️', ButtonStyle.Danger),
            ),
        );
}

// Edit a stored message in the session channel, or post a fresh one if it's gone
async function upsert(s, key, build, pin = false) {
    const ch = guild()?.channels.cache.get(s.textId);
    if (!ch) return;
    const payload = { flags: V2, components: [build(s)], allowedMentions: NO_PINGS };
    const existing = s[key] ? await ch.messages.fetch(s[key]).catch(() => null) : null;
    if (existing) { await existing.edit(payload).catch(e => console.error('[Sessions] edit failed:', e.message)); return; }
    const msg = await ch.send(payload).catch(e => { console.error('[Sessions] post failed:', e.message); return null; });
    if (!msg) return;
    s[key] = msg.id;
    if (pin) await msg.pin().catch(() => {});
    scheduleSave();
}

async function refreshSession(s) {
    const g = guild();
    if (g && s.members.length) await g.members.fetch({ user: s.members.slice(0, 25) }).catch(() => {});
    await upsert(s, 'announceMsgId', buildAnnouncement, true);
    await upsert(s, 'toolsMsgId', buildTools);
}

// ── Panel ───────────────────────────────────────────────────────────────────
function buildPanel() {
    const pub = [...sessions.values()].filter(s => !s.private).sort((a, b) => (a.lockedStart || Infinity) - (b.lockedStart || Infinity) || a.createdAt - b.createdAt);
    const list = pub.length
        ? pub.slice(0, 15).map(s => {
            const when = s.lockedStart ? `<t:${s.lockedStart}:R>` : (s.when ? s.when.slice(0, 40) : 'time TBD');
            return `${typeOf(s).emoji} **${s.title}** · 👑 <@${s.ownerId}> · 👥 ${everyoneIn(s).length} · 🗓️ ${when}`;
        }).join('\n') + (pub.length > 15 ? `\n-# +${pub.length - 15} more in the menu below` : '')
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
        .addTextDisplayComponents(td(
            '## 📅 Plan a Session\nGaming, recording, streaming, anything. Make a session, invite people, find a time that works.\n' +
            '-# Every session gets its own text + voice channel that only the people in it (and mods) can see.\n' +
            '-# 🔓 public: listed here, anyone can join · 🔒 private: invite only, never listed'))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(td(list))
        .addSeparatorComponents(sep())
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

// Events made from the "Find a time" button are tagged with discordSession = text channel id
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

async function setMeet(s, meetId, byUser) {
    s.meetId = meetId;
    scheduleSave();
    await refreshSession(s);
    const ch = guild()?.channels.cache.get(s.textId);
    const others = everyoneIn(s).filter(id => id !== byUser?.id);
    await ch?.send({
        content: `📅 ${byUser ? `<@${byUser.id}> set up` : 'There\'s now'} a scheduler for **${s.title}**. ${mentions(others)}\n` +
            `Mark when you're free: ${meetEventUrl(s)}\n-# Then hit **📊 Best times** in the session tools to see what works.`,
        allowedMentions: { users: others },
    }).catch(() => {});
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
    return `${day}s, ${time(start * 1000)} – ${time(end * 1000)} (${zone.replace(/_/g, ' ')})`;
}

function windowLabel(ev, w) {
    if (ev.mode === 'days') return weeklyLabel(w.start, w.end, ev.timezone);
    const sameDay = new Date(w.start * 1000).toDateString() === new Date((w.end - 1) * 1000).toDateString();
    return `<t:${w.start}:F> → <t:${w.end}:${sameDay ? 't' : 'F'}>`;
}

const fmtLength = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' '); };

async function showBestTimes(ix, s) {
    if (!s.meetId) {
        const found = await findMeetForSession(s.id);
        if (found) await setMeet(s, found, null);
    }
    if (!s.meetId) {
        return reply(ix, `No scheduler yet. <@${s.ownerId}> can make one with **📅 Find a time**, or paste a link with **🔗 Attach meet link**.`);
    }
    await ix.deferReply();
    const ev = await fetchMeetEvent(s.meetId);
    if (!ev) return ix.editReply({ content: '❌ Couldn\'t load the scheduler. Try again in a moment.', allowedMentions: NO_PINGS });
    let people;
    try { people = (await fetchMeetPeople(s.meetId)).filter(p => p.slots?.length); }
    catch (_) { return ix.editReply({ content: '❌ Couldn\'t load everyone\'s availability. Try again in a moment.', allowedMentions: NO_PINGS }); }

    const windows = bestWindows(ev, people);
    if (!windows.length) {
        return ix.editReply({ content: `📊 Nobody has marked any ${ev.mode === 'days' ? '' : 'upcoming '}times yet.\nMark yours here: ${meetEventUrl(s)}`, allowedMentions: NO_PINGS });
    }
    const total = people.length;
    const lines = windows.map((w, i) => {
        const missing = people.map(p => p.name).filter(n => !w.names.includes(n));
        return `**${i + 1}.** ${windowLabel(ev, w)} · ${fmtLength(w.end - w.start)}\n` +
            `-# ✅ ${w.names.length}/${total} free: ${w.names.join(', ')}${missing.length ? ` · ❌ ${missing.join(', ')}` : ''}`;
    });
    const mode = ev.mode === 'days' ? 'w' : 'd';
    return ix.editReply({
        content: `### 📊 Best times so far\n-# ${total} ${total === 1 ? 'person has' : 'people have'} filled in the scheduler: ${people.map(p => p.name).join(', ')}\n\n` +
            lines.join('\n') + `\n\n-# <@${s.ownerId}> can lock one in below. Not filled it in yet? ${meetEventUrl(s)}`,
        components: [row(...windows.map((w, i) => btn(`ses:lock:${s.id}:${mode}:${w.start}:${w.end}`, `Lock in #${i + 1}`, '📌', ButtonStyle.Success)))],
        allowedMentions: NO_PINGS,
    });
}

async function lockIn(ix, s, mode, start, end) {
    if (!canManage(ix.member, s)) return reply(ix, `Only <@${s.ownerId}> or a mod can lock in a time.`);
    if (mode === 'w') {
        const ev = s.meetId ? await fetchMeetEvent(s.meetId) : null;
        s.when = weeklyLabel(start, end, ev?.timezone);
        s.lockedStart = null; s.lockedEnd = null;
    } else {
        if (end <= Date.now() / 1000) return reply(ix, '⌛ That time has already passed. Check 📊 Best times again.');
        s.lockedStart = start; s.lockedEnd = end; s.when = '';
        s.reminded15 = false; s.remindedStart = false;
    }
    scheduleSave();
    await ix.update({ components: [] }).catch(() => {});
    await refreshSession(s);
    refreshPanel();
    const label = s.lockedStart ? `<t:${start}:F> (<t:${start}:R>)` : `**${s.when}**`;
    const others = everyoneIn(s).filter(id => id !== ix.user.id);
    await ix.channel.send({
        content: `📌 **${s.title}** is locked in for ${label}. ${mentions(others)}` +
            (s.lockedStart ? '\n-# I\'ll ping everyone 15 minutes before and when it starts.' : ''),
        allowedMentions: { users: others },
    }).catch(() => {});
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

function createModal(isPrivate) {
    const m = new ModalBuilder()
        .setCustomId(`ses:createm:${isPrivate ? 'priv' : 'pub'}`)
        .setTitle(isPrivate ? '🔒 New private session' : '🔓 New public session');
    m.addLabelComponents(
        textLabel('Session name', null, input('title', TextInputStyle.Short, 80, { required: true, placeholder: 'e.g. Helldivers 2 squad night' })),
        typeLabel(),
        textLabel('Link (optional)', 'Steam page, store page, YouTube… Steam links add the game art', input('link', TextInputStyle.Short, 300, { placeholder: 'https://store.steampowered.com/app/…' })),
        textLabel('Announcement (optional)', 'What are we doing? Mods to install, what to bring…', input('details', TextInputStyle.Paragraph, 1500)),
        isPrivate
            ? new LabelBuilder().setLabel("Who's invited?").setDescription('You can add or remove people later too')
                .setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId('invite').setMinValues(0).setMaxValues(25).setRequired(false))
            : textLabel('When? (optional)', 'Or leave blank and find a time with the scheduler', input('when', TextInputStyle.Short, 100, { placeholder: 'e.g. Saturday 8pm UK' })),
    );
    return m;
}

function editModal(s) {
    return new ModalBuilder().setCustomId(`ses:editm:${s.id}`).setTitle('✏️ Edit announcement').addLabelComponents(
        textLabel('Session name', null, input('title', TextInputStyle.Short, 80, { required: true, value: s.title })),
        typeLabel(s.type),
        textLabel('Link (optional)', null, input('link', TextInputStyle.Short, 300, { value: s.link })),
        textLabel('When? (optional)', s.lockedStart ? 'Typing here replaces the time locked in from the scheduler' : null,
            input('when', TextInputStyle.Short, 100, { value: s.when })),
        textLabel('Announcement (optional)', null, input('details', TextInputStyle.Paragraph, 1500, { value: s.details })),
    );
}

// ── Create ──────────────────────────────────────────────────────────────────
async function ensureCategory(g) {
    let cat = categoryId ? g.channels.cache.get(categoryId) : null;
    if (!cat) cat = g.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME) || null;
    if (!cat) cat = await g.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory, reason: 'Planned sessions' });
    if (cat.id !== categoryId) { categoryId = cat.id; scheduleSave(); }
    return cat;
}

async function createSession(ix, isPrivate) {
    const member = ix.member, g = ix.guild;
    const title   = ix.fields.getTextInputValue('title').trim().replace(/\s+/g, ' ').slice(0, 80);
    const type    = ix.fields.getStringSelectValues('type')?.[0] || 'gaming';
    const linkRaw = ix.fields.getTextInputValue('link').trim();
    const details = ix.fields.getTextInputValue('details').trim();
    const when    = isPrivate ? '' : ix.fields.getTextInputValue('when').trim();
    const invited = isPrivate ? [...(ix.fields.getSelectedUsers('invite')?.values() || [])] : [];
    const link    = normalizeLink(linkRaw);

    if (!title) return reply(ix, '❌ The session needs a name.');
    if (linkRaw && !link) return reply(ix, "❌ That link doesn't look right. Paste the full address, e.g. `https://store.steampowered.com/app/553850`.");
    const owned = [...sessions.values()].filter(s => s.ownerId === member.id).length;
    if (owned >= MAX_PER_OWNER && !isStaff(member)) return reply(ix, `❌ You're already hosting ${owned} sessions. End one first (🗑️ in its tools).`);
    if (sessions.size >= MAX_TOTAL) return reply(ix, '❌ There are too many sessions open right now. Try again once some have ended.');

    await ix.deferReply({ flags: EPH });
    const members = invited.filter(u => !u.bot && u.id !== member.id).map(u => u.id);
    const t = TYPES[type] || TYPES.other;
    let text = null, voice = null;
    try {
        const cat  = await ensureCategory(g);
        const meta = await lookupLink(link);
        text = await g.channels.create({
            name: `${t.emoji}・${title}`.slice(0, 100),
            type: ChannelType.GuildText,
            parent: cat.id,
            topic: `${t.label} session hosted by ${member.displayName}. Only people in the session (and mods) can see this.`,
            permissionOverwrites: await baseOverwrites(g, 'text', member.id, members),
            reason: `Planned session for ${member.user.tag}`,
        });
        voice = await g.channels.create({
            name: `${t.emoji} ${title}`.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: cat.id,
            permissionOverwrites: await baseOverwrites(g, 'voice', member.id, members),
            reason: `Planned session for ${member.user.tag}`,
        });

        const s = {
            id: text.id, textId: text.id, voiceId: voice.id,
            ownerId: member.id, ownerName: member.displayName,
            private: isPrivate, title, type, link: link || '', details, when,
            gameName: meta.gameName, image: meta.image,
            members, meetId: '', lockedStart: null, lockedEnd: null, reminded15: false, remindedStart: false,
            announceMsgId: '', toolsMsgId: '', renames: [], createdAt: Date.now(),
        };
        sessions.set(s.id, s);
        scheduleSave();
        await refreshSession(s);
        await text.send({
            content: `👋 ${mentions(everyoneIn(s))} welcome to **${title}**!\n` +
                `-# <@${member.id}>: use the tools above to add or remove people, or 📅 find a time that works for everyone.`,
            allowedMentions: { users: everyoneIn(s) },
        }).catch(() => {});
        refreshPanel();
        console.log(`[Sessions] ${member.user.tag} created ${isPrivate ? 'private' : 'public'} session "${title}" (${members.length} invited)`);
    } catch (e) {
        console.error('[Sessions] create failed:', e.message);
        if (text) { sessions.delete(text.id); await text.delete('Session creation failed').catch(() => {}); }
        if (voice) await voice.delete('Session creation failed').catch(() => {});
        scheduleSave();
        return ix.editReply("❌ Couldn't create the session. Try again in a moment.");
    }
    return ix.editReply({
        content: `✅ Your session is ready: <#${text.id}>\n` + (isPrivate
            ? `-# 🔒 Private${members.length ? ` · ${members.length} invited` : ''}. Add or remove people from the tools in the channel.`
            : '-# 🔓 Public: it\'s listed on the panel so anyone can join.'),
        allowedMentions: NO_PINGS,
    });
}

// ── Members ─────────────────────────────────────────────────────────────────
async function addPeople(ix, s) {
    if (!canManage(ix.member, s)) return reply(ix, `Only <@${s.ownerId}> or a mod can add people.`);
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
    await ix.channel.send({
        content: `➕ <@${ix.user.id}> added ${mentions(added)} to **${s.title}**. Welcome!`,
        allowedMentions: { users: added },
    }).catch(() => {});
}

async function removePeople(ix, s, ids, reason) {
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

    // ── Panel ──
    if (ix.isButton() && id.startsWith('ses:create:')) return ix.showModal(createModal(id.endsWith(':priv')));
    if (ix.isModalSubmit() && id.startsWith('ses:createm:')) return createSession(ix, id.endsWith(':priv'));

    if (ix.isButton() && id === 'ses:mine') {
        const mine = [...sessions.values()].filter(s => everyoneIn(s).includes(ix.user.id));
        if (!mine.length) return reply(ix, "You're not in any sessions yet. Create one, or join a public one from the menu.");
        return reply(ix, '### 📋 Your sessions\n' + mine.map(s =>
            `${typeOf(s).emoji} <#${s.textId}> · ${s.ownerId === ix.user.id ? '👑 hosting' : `hosted by <@${s.ownerId}>`} · 🗓️ ${s.lockedStart ? `<t:${s.lockedStart}:R>` : (s.when || 'time TBD')}`).join('\n'));
    }

    if (ix.isStringSelectMenu() && id === 'ses:join') {
        const s = sessions.get(ix.values[0]);
        refreshPanel(0); // resets the menu
        if (!s || s.private) return reply(ix, '❌ That session isn\'t open to join anymore.');
        if (everyoneIn(s).includes(ix.user.id)) return reply(ix, `You're already in it: <#${s.textId}>`);
        try { await grant(s, ix.user.id); } catch (e) {
            console.error('[Sessions] join failed:', e.message);
            return reply(ix, "❌ Couldn't add you. Try again in a moment.");
        }
        s.members.push(ix.user.id);
        scheduleSave();
        await reply(ix, `✅ You're in! Head to <#${s.textId}>`);
        await refreshSession(s);
        guild()?.channels.cache.get(s.textId)?.send({ content: `🙋 <@${ix.user.id}> joined the session.`, allowedMentions: NO_PINGS }).catch(() => {});
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
            const removed = await removePeople(ix, s, ix.values);
            if (removed.length) {
                const names = removed.map(rid => `**${ix.guild.members.cache.get(rid)?.displayName || rid}**`).join(', ');
                await ix.channel.send({ content: `➖ <@${ix.user.id}> removed ${names} from the session.`, allowedMentions: NO_PINGS }).catch(() => {});
            }
            return;
        }

        case 'leave': {
            if (ix.user.id === s.ownerId) return reply(ix, "You're the host. Use **🗑️ End session** to close it, or ask a mod to take over.");
            if (!s.members.includes(ix.user.id)) return reply(ix, "You're not a member of this session.");
            await reply(ix, '🚪 You left the session.');
            await ix.channel.send({ content: `🚪 **${ix.member.displayName}** left the session.`, allowedMentions: NO_PINGS }).catch(() => {});
            await removePeople(ix, s, [ix.user.id]);
            return;
        }

        case 'vis': {
            if (!manage) return denied();
            s.private = !s.private;
            scheduleSave();
            await ix.deferUpdate();
            await refreshSession(s);
            refreshPanel();
            await ix.channel.send({
                content: s.private
                    ? `🔒 <@${ix.user.id}> made the session private. It's no longer listed, so only people added here can get in.`
                    : `🔓 <@${ix.user.id}> made the session public. It's listed in <#${panelChannelId}> and anyone can join.`,
                allowedMentions: NO_PINGS,
            }).catch(() => {});
            return;
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
            const when    = ix.fields.getTextInputValue('when').trim();
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
                    await guild().channels.cache.get(s.textId)?.setName(`${t.emoji}・${title}`.slice(0, 100)).catch(() => {});
                    await guild().channels.cache.get(s.voiceId)?.setName(`${t.emoji} ${title}`.slice(0, 100)).catch(() => {});
                }
            }
            if ((link || '') !== s.link) Object.assign(s, { link: link || '' }, await lookupLink(link));
            if (when !== (s.when || '')) {
                s.when = when;
                if (when) { s.lockedStart = null; s.lockedEnd = null; }
            }
            Object.assign(s, { title, type, details });
            scheduleSave();
            await refreshSession(s);
            refreshPanel();
            return ix.editReply({ content: '✏️ Announcement updated.' + note, allowedMentions: NO_PINGS });
        }

        case 'meet':
            if (!manage) return denied();
            return ix.showModal(new ModalBuilder().setCustomId(`ses:meetm:${s.id}`).setTitle('🔗 Attach a meet link').addLabelComponents(
                textLabel('Meet link', 'The link from truebeast.io/meet after you created the event',
                    input('url', TextInputStyle.Short, 200, { required: true, value: s.meetId ? meetEventUrl(s) : '', placeholder: 'https://truebeast.io/meet/…' }))));

        case 'meetm': {
            if (!ix.isModalSubmit()) break;
            if (!manage) return denied();
            const raw = ix.fields.getTextInputValue('url').trim();
            const meetId = raw.match(/\/meet\/([a-z0-9]{6,24})/i)?.[1] || (/^[a-z0-9]{6,24}$/i.test(raw) ? raw : null);
            if (!meetId) return reply(ix, '❌ That doesn\'t look like a meet link. It should look like `https://truebeast.io/meet/abc123xyz`.');
            await ix.deferReply({ flags: EPH });
            const ev = await fetchMeetEvent(meetId);
            if (ev === null) return ix.editReply('❌ Couldn\'t find that event. Double-check the link.');
            await setMeet(s, meetId, ix.user);
            return ix.editReply('🔗 Scheduler attached.');
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

// ── Background: reminders + picking up schedulers made from "Find a time" ───
async function remindTick() {
    const nowS = Math.floor(Date.now() / 1000);
    for (const s of sessions.values()) {
        if (!s.lockedStart) continue;
        const ch = guild()?.channels.cache.get(s.textId);
        const ping = { users: everyoneIn(s) };
        if (!s.reminded15 && nowS >= s.lockedStart - REMIND_BEFORE_S) {
            s.reminded15 = true;
            scheduleSave();
            if (nowS < s.lockedStart) {
                await ch?.send({ content: `⏰ **${s.title}** starts <t:${s.lockedStart}:R>. Hop in <#${s.voiceId}> when you're ready. ${mentions(everyoneIn(s))}`, allowedMentions: ping }).catch(() => {});
            }
        }
        if (!s.remindedStart && nowS >= s.lockedStart) {
            s.remindedStart = true;
            scheduleSave();
            if (nowS < s.lockedStart + 30 * 60) {
                await ch?.send({ content: `🟢 **${s.title}** is starting now! Join <#${s.voiceId}>. ${mentions(everyoneIn(s))}`, allowedMentions: ping }).catch(() => {});
            }
        }
    }
}

async function meetPollTick() {
    for (const s of [...sessions.values()]) {
        if (s.meetId || Date.now() - s.createdAt > MEET_POLL_MAX_AGE) continue;
        const found = await findMeetForSession(s.id);
        if (found && sessions.has(s.id) && !s.meetId) await setMeet(s, found, null);
    }
}

// ── Startup ─────────────────────────────────────────────────────────────────
async function startSessions(discordClient, { guildId: gid, modRoleId: mod, quarantineRoleId: quarantine }) {
    client = discordClient;
    modRoleId = mod || null;
    quarantineRoleId = quarantine || null;
    const g = gid ? client.guilds.cache.get(gid) : client.guilds.cache.first();
    if (!g) { console.error('[Sessions] no guild'); return; }
    guildId = g.id;

    let state = null;
    for (let attempt = 1; attempt <= 5 && !state; attempt++) {
        state = await loadState().catch(e => { console.error(`[Sessions] load failed (attempt ${attempt}):`, e.message); return null; });
        if (!state) await new Promise(r => setTimeout(r, 30 * 1000));
    }
    if (!state) { console.error('[Sessions] giving up on load — sessions stay off until restart'); return; }

    let saved = {};
    try { saved = JSON.parse(state.sessionsJson || '{}'); } catch (_) {}
    panelChannelId = state.panelChannelId || null;
    panelMessageId = state.panelMessageId || null;
    categoryId     = state.categoryId || null;

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

    // Panel channel: saved ID → existing #plan-a-session → create it in the Sessions category.
    // Read-only for members: everything happens through the panel's buttons.
    let panelCh = panelChannelId ? await client.channels.fetch(panelChannelId).catch(() => null) : null;
    if (!panelCh) panelCh = g.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === PANEL_CHANNEL_NAME) || null;
    if (!panelCh) {
        const cat = await ensureCategory(g).catch(e => { console.error('[Sessions] create category failed:', e.message); return null; });
        panelCh = await g.channels.create({
            name: PANEL_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: cat?.id || null,
            position: 0,
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

    setInterval(() => remindTick().catch(e => console.error('[Sessions] reminder tick failed:', e.message)), MIN);
    setInterval(() => meetPollTick().catch(e => console.error('[Sessions] meet poll failed:', e.message)), MEET_POLL_MS);
}

module.exports = { startSessions, isSessionInteraction, handleSessionInteraction, handleSessionChannelDelete, flushSessions };
