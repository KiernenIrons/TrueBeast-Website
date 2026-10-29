/**
 * Recorder — Craig-style multi-track voice recording.
 *
 * /record start joins a voice channel and records every speaker to their own track. While it runs
 * the bot's nickname gets a [RECORDING] tag (no tag, no recording — people must know), a live
 * panel (Components v2) shows activity with Stop / Add a note / Get link buttons, and the person
 * who started it gets a DM with the download page (truebeast.io/rec/<id>?key=…) and a delete key.
 * Downloads work while the recording is still going.
 *
 * Audio: raw Opus packets straight from Discord, never decoded while recording. Each speaker gets
 * `<track>.pkt` = repeated [u32 LE sample position @48kHz][u16 LE length][opus bytes]. Positions
 * come from RTP timestamps (re-anchored to the wall clock when they drift), so tracks stay in sync.
 * Append-only, so a crash only loses the last partial record. At export time each track is rebuilt
 * as a gap-free Ogg Opus stream (silence frames fill the gaps, every track starts at 0 and has the
 * full length) and ffmpeg encodes it: multi-track zip, single-track mix, Audacity project, Audition
 * session, in FLAC / WAV / AAC / MP3 / Vorbis / Opus / ALAC / etc.
 *
 * Deploys: on SIGTERM live recordings are flushed and left as "recording"; on startup the bot
 * rejoins and keeps writing to the same files (the gap is silence), or finishes them if the
 * channel emptied.
 *
 * Also: auto-record rules (minimum people and/or trigger users/roles), access roles,
 * /record voice-test (record yourself for a few seconds, hear it played back).
 *
 * Storage: RECORDINGS_DIR (default /data, a Fly volume) → recordings/<id>/{meta.json,<n>.pkt},
 * jobs/<jobId>/ for finished exports. Recordings expire 7 days after they end.
 * Settings: botConfig/recorder → settingsJson ({ accessRoles, includeBots, auto }).
 * HTTP API (port 8080, public at RECORDER_PUBLIC_URL) is what the download page talks to.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const archiver = require('archiver');
const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, ContainerBuilder,
    TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder,
} = require('discord.js');
const {
    joinVoiceChannel, VoiceConnectionStatus, entersState, EndBehaviorType,
    createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus,
} = require('@discordjs/voice');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/recorder`;

const DATA_DIR   = process.env.RECORDINGS_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const REC_DIR    = path.join(DATA_DIR, 'recordings');
const JOB_DIR    = path.join(DATA_DIR, 'jobs');
const PORT       = Number(process.env.PORT) || 8080;
const PUBLIC_API = (process.env.RECORDER_PUBLIC_URL || 'https://truebeast-beast-bot.fly.dev').replace(/\/$/, '');
const PAGE_URL   = 'https://truebeast.io/rec';

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MAX_HOURS       = 6;
const EXPIRY_DAYS     = 7;
const EMPTY_STOP_MS   = 2 * MIN;    // manual recordings stop once nobody's been in the channel this long
const AUTO_STOP_MS    = 30 * SEC;   // auto-recordings stop once their rule has been unmet this long
const AUTO_SETTLE_MS  = 2 * SEC;    // like Craig: wait for joins/leaves to settle before checking a rule
const SILENCE_WARN_MS = 5 * MIN;
const MIN_FREE_START  = 1024 ** 3;  // refuse to start below 1 GB free
const MIN_FREE_KEEP   = 300 * 1024 ** 2; // stop a live recording below 300 MB free
const JOB_TTL_MS      = 3 * HOUR;
const VOICE_TEST_MS   = 15 * SEC;
const RATE = 48000, FRAME = 960;    // Discord sends 20 ms Opus frames at 48 kHz
const NICK_TAG = '[RECORDING] ';
const ACCENT_LIVE = 0xef4444, ACCENT_DONE = 0x22c55e, ACCENT_IDLE = 0x6b7280;

const EPH = MessageFlags.Ephemeral;
const V2  = MessageFlags.IsComponentsV2;
const NO_PINGS = { parse: [] };

// ── State ───────────────────────────────────────────────────────────────────
const recordings = new Map(); // id → meta (everything on disk, live or not)
const active     = new Map(); // guildId → live recording runtime
const tests      = new Map(); // guildId → running voice test
const autoTimers = new Map(); // channelId → settle / stop timer
let settings = { accessRoles: [], includeBots: false, auto: {} };
let loaded = false;           // guards saves so empty settings never overwrite Firestore
let client = null, modRoleId = null, ownerId = null;
let saveTimer = null, shuttingDown = false;

async function loadState() {
    const res = await fetch(`${DOC_URL}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = (await res.json()).fields || {};
    return { settingsJson: f.settingsJson?.stringValue || '' };
}

async function saveState() {
    if (!loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    const fields = { settingsJson: { stringValue: JSON.stringify(settings) } };
    try {
        const res = await fetch(`${DOC_URL}?updateMask.fieldPaths=settingsJson&key=${FIREBASE_API_KEY}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
        });
        if (!res.ok) console.error('[Recorder] save failed:', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.error('[Recorder] save failed:', e.message); }
}

function scheduleSave() {
    if (!loaded || saveTimer) return;
    saveTimer = setTimeout(() => saveState(), 2000);
}

// ── Small helpers ───────────────────────────────────────────────────────────
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const btn = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const linkBtn = (url, label, emoji) =>
    new ButtonBuilder().setURL(url).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link);
const td  = text => new TextDisplayBuilder().setContent(text);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const ts  = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const esc = s => String(s ?? '').replace(/[_*~`|\\<>#@]/g, '\\$&');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function randomId(len) {
    const bytes = crypto.randomBytes(len * 2);
    let out = '';
    for (let i = 0; out.length < len; i++) if (bytes[i] < 248) out += B62[bytes[i] % 62]; // no modulo bias
    return out;
}

function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
}
const timemark = secs => {
    const s = Math.max(0, secs);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${r}`;
};

const pageUrl   = m => `${PAGE_URL}/${m.id}?key=${m.key}`;
const recDir    = id => path.join(REC_DIR, id);
const metaPath  = id => path.join(recDir(id), 'meta.json');
const isLive    = m => m.status === 'recording';
const durationMs = m => Math.max(0, (m.endedAt || Date.now()) - m.startedAt);

async function writeMeta(m) {
    const file = metaPath(m.id), tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, file);
}
function writeMetaSoon(rt) {
    if (rt.metaTimer) return;
    rt.metaTimer = setTimeout(() => { rt.metaTimer = null; writeMeta(rt.meta).catch(e => console.error('[Recorder] meta write failed:', e.message)); }, 1500);
}

async function freeBytes() {
    try { const s = await fsp.statfs(DATA_DIR); return s.bavail * s.bsize; } catch { return Infinity; }
}

function canRecord(member) {
    if (!member) return false;
    return member.id === member.guild.ownerId
        || member.id === ownerId
        || member.permissions.has(PermissionFlagsBits.ManageGuild)
        || (modRoleId && member.roles.cache.has(modRoleId))
        || settings.accessRoles.some(r => member.roles.cache.has(r));
}
const canManageServer = member => !!member && (member.id === member.guild.ownerId || member.id === ownerId
    || member.permissions.has(PermissionFlagsBits.ManageGuild));
const isRecOwner = (userId, m) => userId === m.requesterId || userId === ownerId;

function humansIn(channel) {
    return channel ? channel.members.filter(m => !m.user.bot) : new Map();
}

// Ephemeral reply, or an edit of the deferred one (edits can't carry the ephemeral flag)
function reply(ix, content, extra = {}) {
    const later = ix.deferred || ix.replied;
    const flags = (extra.flags || 0) | EPH;
    const payload = { content, allowedMentions: NO_PINGS, ...extra, flags: later ? flags & ~EPH : flags };
    return (later ? ix.editReply(payload) : ix.reply(payload)).catch(e => console.error('[Recorder] reply failed:', e.message));
}

// ── Ogg / Opus ──────────────────────────────────────────────────────────────
const SILENCE = Buffer.from([0xf8, 0xff, 0xfe]); // 20 ms of silence, what Discord itself sends

const OGG_CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    OGG_CRC[i] = r >>> 0;
}
function oggCrc(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    return crc;
}

// Samples in one Opus packet, from its TOC byte (RFC 6716 §3.1)
function opusSamples(pkt) {
    if (!pkt.length) return 0;
    const config = pkt[0] >> 3;
    const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]
        : config < 16 ? [480, 960][config & 1]
        : [120, 240, 480, 960][config & 3];
    const code = pkt[0] & 3;
    const frames = code === 0 ? 1 : code < 3 ? 2 : (pkt[1] & 0x3f);
    return frame * frames;
}

function oggPage(serial, seq, granule, flags, packets) {
    const lacing = [];
    for (const p of packets) {
        let n = p.length;
        while (n >= 255) { lacing.push(255); n -= 255; }
        lacing.push(n);
    }
    const header = Buffer.alloc(27 + lacing.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0; header[5] = flags;
    header.writeBigUInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(seq, 18);
    header[26] = lacing.length;
    Buffer.from(lacing).copy(header, 27);
    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(oggCrc(page), 22);
    return page;
}

/** Builds Ogg Opus pages: OpusHead + OpusTags, then packets batched into pages. */
class OggOpusWriter {
    constructor(write, title) {
        this.write = write; // (Buffer) => Promise|void
        this.serial = crypto.randomBytes(4).readUInt32LE(0);
        this.seq = 0; this.granule = 0; this.pending = []; this.segs = 0;
        const head = Buffer.alloc(19);
        head.write('OpusHead', 0, 'ascii'); head[8] = 1; head[9] = 2; // version 1, stereo
        head.writeUInt16LE(0, 10); head.writeUInt32LE(RATE, 12); head.writeInt16LE(0, 16); head[18] = 0;
        const vendor = Buffer.from('TrueBeast Recorder');
        const comment = Buffer.from(`TITLE=${title || 'Recording'}`);
        const tags = Buffer.alloc(8 + 4 + vendor.length + 4 + 4 + comment.length);
        let o = tags.write('OpusTags', 0, 'ascii');
        o = tags.writeUInt32LE(vendor.length, o); o += vendor.copy(tags, o);
        o = tags.writeUInt32LE(1, o); o = tags.writeUInt32LE(comment.length, o); comment.copy(tags, o);
        this.headers = Buffer.concat([oggPage(this.serial, this.seq++, 0, 2, [head]), oggPage(this.serial, this.seq++, 0, 0, [tags])]);
    }
    async start() { await this.write(this.headers); }
    async add(pkt, samples) {
        const segs = Math.floor(pkt.length / 255) + 1;
        if (this.segs + segs > 255 || this.pending.length >= 50) await this.flush(0);
        this.pending.push(pkt); this.segs += segs; this.granule += samples;
    }
    async flush(flags) {
        if (!this.pending.length && !(flags & 4)) return;
        const page = oggPage(this.serial, this.seq++, this.granule, flags, this.pending);
        this.pending = []; this.segs = 0;
        await this.write(page);
    }
    async end() { await this.flush(4); }
}

/** Streams [granule, packet] records out of a .pkt file. */
async function* readPackets(file) {
    let carry = Buffer.alloc(0);
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
        let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        let o = 0;
        while (o + 6 <= buf.length) {
            const len = buf.readUInt16LE(o + 4);
            if (o + 6 + len > buf.length) break;
            yield [buf.readUInt32LE(o), buf.subarray(o + 6, o + 6 + len)];
            o += 6 + len;
        }
        carry = Buffer.from(buf.subarray(o));
    }
}

/**
 * Rebuilds one track as a gap-free Ogg Opus stream from 0 to totalSamples (silence fills every gap),
 * so all tracks line up exactly. `write` gets Buffers and may return a promise (backpressure).
 */
async function buildTrackOgg(pktFile, totalSamples, write, title, signal) {
    const ogg = new OggOpusWriter(write, title);
    await ogg.start();
    let n = 0;
    if (fs.existsSync(pktFile)) {
        for await (const [pos, pkt] of readPackets(pktFile)) {
            if (signal?.aborted) throw new Error('cancelled');
            if (pos >= totalSamples) break;
            while (pos - ogg.granule >= FRAME) await ogg.add(SILENCE, FRAME);
            const samples = opusSamples(pkt) || FRAME;
            await ogg.add(pkt, samples);
            if (++n % 5000 === 0) await new Promise(r => setImmediate(r)); // let the bot breathe
        }
    }
    while (totalSamples - ogg.granule >= FRAME) {
        await ogg.add(SILENCE, FRAME);
        if (ogg.granule % (FRAME * 5000) === 0) await new Promise(r => setImmediate(r));
    }
    await ogg.end();
}

async function buildTrackOggFile(pktFile, totalSamples, outFile, title, signal) {
    const out = fs.createWriteStream(outFile);
    let failed = null;
    out.on('error', e => { failed = e; });
    const write = buf => {
        if (failed) throw failed;
        if (!out.write(buf)) return new Promise(r => out.once('drain', r));
    };
    try { await buildTrackOgg(pktFile, totalSamples, write, title, signal); }
    finally { await new Promise(r => out.end(r)); }
    if (failed) throw failed;
}

async function buildTrackOggBuffer(pktFile, totalSamples) {
    const chunks = [];
    await buildTrackOgg(pktFile, totalSamples, b => { chunks.push(b); });
    return Buffer.concat(chunks);
}

// ── Recording runtime ───────────────────────────────────────────────────────
function trackName(t) { return t.displayName || t.globalName || t.username || `Track ${t.track}`; }

function logEvent(rt, text) {
    rt.meta.log.push({ t: Date.now(), text });
    if (rt.meta.log.length > 60) rt.meta.log.splice(0, rt.meta.log.length - 60);
    writeMetaSoon(rt);
    updatePanelSoon(rt);
}

function memberInfo(member, user) {
    const u = member?.user || user;
    return {
        id: u.id, username: u.username, globalName: u.globalName || null,
        displayName: member?.displayName || u.globalName || u.username,
        avatar: (member || u).displayAvatarURL({ extension: 'png', size: 256 }),
        bot: !!u.bot,
    };
}

function getTrack(rt, userId) {
    let t = rt.tracks.get(userId);
    if (t) return t;
    const known = rt.meta.tracks.find(x => x.id === userId);
    const guild = client.guilds.cache.get(rt.meta.guildId);
    const member = guild?.members.cache.get(userId);
    const user = member?.user || client.users.cache.get(userId);
    if (!known && !user) return null; // unknown speaker — wait until the member cache has them
    if (!known && user.bot && !settings.includeBots) return null;
    let info = known;
    if (!info) {
        info = { track: rt.meta.tracks.length + 1, firstAt: Date.now(), ...memberInfo(member, user) };
        rt.meta.tracks.push(info);
        logEvent(rt, `🎙️ **${esc(trackName(info))}** joined the recording (track ${info.track})`);
    }
    const file = fs.createWriteStream(path.join(recDir(rt.meta.id), `${info.track}.pkt`), { flags: 'a' });
    file.on('error', e => console.error('[Recorder] track write failed:', e.message));
    t = { info, file, ssrc: null, lastRtp: 0, lastPos: 0, lastEnd: 0 };
    rt.tracks.set(userId, t);
    return t;
}

const RTP_RESYNC_PAUSE = RATE / 4; // after a pause, snap back to the wall clock if off by > 250 ms
const RTP_RESYNC_ANY   = RATE * 2; // mid-speech, only if off by > 2 s

function onPacket(rt, userId, ssrc, rtpTs, pkt) {
    if (rt.stopping || !pkt?.length) return;
    const t = getTrack(rt, userId);
    if (!t) return;
    const wall = Math.round((Date.now() - rt.meta.startedAt) * RATE / 1000);
    let pos = wall;
    if (t.ssrc === ssrc && rtpTs != null) {
        const d = (rtpTs - t.lastRtp) >>> 0;
        if (d === 0 || d > 0x80000000) return;  // duplicate or out of order
        const cand = t.lastPos + d;
        const drift = Math.abs(cand - wall);
        pos = drift > (d > RATE / 2 ? RTP_RESYNC_PAUSE : RTP_RESYNC_ANY) ? wall : cand;
    }
    if (pos < t.lastEnd) pos = t.lastEnd;
    if (pos > 0xffffffff) return;
    t.ssrc = ssrc; t.lastRtp = rtpTs ?? 0; t.lastPos = pos;
    t.lastEnd = pos + (opusSamples(pkt) || FRAME);
    const head = Buffer.alloc(6);
    head.writeUInt32LE(pos, 0); head.writeUInt16LE(pkt.length, 4);
    t.file.write(Buffer.concat([head, pkt]));
    rt.lastAudioAt = Date.now();
    rt.silenceWarned = false;
}

/**
 * Takes over the receiver's UDP handler so we see each packet's RTP timestamp (the public stream API
 * drops it). Same steps as VoiceReceiver.onUdpMessage in @discordjs/voice 0.19 (pinned): SSRC → user,
 * mark speaking, decrypt (transport + DAVE) via parsePacket. Falls back to per-user streams + wall
 * clock if the internals ever change.
 */
function hookReceiver(connection, handler) {
    const r = connection.receiver;
    if (typeof r.parsePacket === 'function' && r.ssrcMap?.get && r.speaking?.onPacket) {
        r.onUdpMessage = msg => {
            if (msg.length <= 12) return;
            const ssrc = msg.readUInt32BE(8);
            const user = r.ssrcMap.get(ssrc);
            if (!user) return;
            r.speaking.onPacket(user.userId);
            const cd = r.connectionData;
            if (!cd.encryptionMode || !cd.nonceBuffer || !cd.secretKey) return;
            if ((msg[1] & 0x7f) !== 120 || (msg[0] >> 6) !== 2) return;
            let pkt;
            try { pkt = r.parsePacket(msg, cd.encryptionMode, cd.nonceBuffer, cd.secretKey, user.userId); } catch { return; }
            if (pkt) handler(user.userId, ssrc, msg.readUInt32BE(4), pkt);
        };
        return;
    }
    console.warn('[Recorder] voice receiver internals changed — falling back to wall-clock timing');
    r.speaking.on('start', userId => {
        if (r.subscriptions.has(userId)) return;
        const s = r.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        s.on('data', pkt => handler(userId, `s${userId}`, null, pkt));
        s.on('error', () => {});
    });
}

async function setRecordingNick(guild, on, prevNick) {
    const me = guild.members.me;
    if (!me) return false;
    const base = (prevNick ?? me.nickname ?? me.user.globalName ?? me.user.username).replace(NICK_TAG, '');
    const nick = on ? (NICK_TAG + base).slice(0, 32) : (prevNick ?? null);
    if ((me.nickname ?? null) === nick) return true;
    try { await me.setNickname(nick, on ? 'Recording started' : 'Recording ended'); return true; }
    catch (e) { console.error('[Recorder] nickname change failed:', e.message); return false; }
}

async function connect(rt, channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false, selfMute: true,
    });
    hookReceiver(connection, (uid, ssrc, rtpTs, pkt) => onPacket(rt, uid, ssrc, rtpTs, pkt));
    rt.connection = connection;
    connection.on('error', e => console.error('[Recorder] voice error:', e.message));
    connection.on('stateChange', async (_old, state) => {
        if (rt.connection !== connection || rt.stopping) return;
        if (state.status === VoiceConnectionStatus.Disconnected) {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5 * SEC),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5 * SEC),
                ]);
            } catch {
                if (rt.stopping || rt.connection !== connection) return;
                if (rt.reconnects++ < 3 && client.guilds.cache.get(rt.meta.guildId)?.members.me?.voice?.channelId) {
                    logEvent(rt, '⚠️ Voice connection dropped, reconnecting…');
                    connection.rejoin();
                } else {
                    stopRecording(rt, 'I lost the voice connection and couldn\'t reconnect.');
                }
            }
        } else if (state.status === VoiceConnectionStatus.Ready && rt.reconnects) {
            rt.reconnects = 0;
            logEvent(rt, '✅ Reconnected.');
        } else if (state.status === VoiceConnectionStatus.Destroyed) {
            stopRecording(rt, 'The voice connection was closed.');
        }
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 20 * SEC);
}

function newRuntime(meta) {
    return {
        meta, tracks: new Map(), connection: null, panel: null, panelTimer: null, metaTimer: null,
        tick: null, emptySince: null, startedLive: Date.now(), lastAudioAt: 0, silenceWarned: false,
        noAudioHinted: false, reconnects: 0, stopping: false,
    };
}

function startTicker(rt) {
    rt.tick = setInterval(() => tick(rt).catch(e => console.error('[Recorder] tick failed:', e.message)), 15 * SEC);
}

async function tick(rt) {
    if (rt.stopping) return;
    const m = rt.meta;
    if (Date.now() - m.startedAt >= MAX_HOURS * HOUR) return stopRecording(rt, `Reached the ${MAX_HOURS}-hour limit.`);
    if (await freeBytes() < MIN_FREE_KEEP) return stopRecording(rt, 'The recording storage is full.');
    const guild = client.guilds.cache.get(m.guildId);
    const channel = guild?.channels.cache.get(guild.members.me?.voice?.channelId || m.channelId);
    const humans = humansIn(channel).size;
    if (humans === 0) {
        rt.emptySince ??= Date.now();
        if (Date.now() - rt.emptySince >= EMPTY_STOP_MS) return stopRecording(rt, 'Everyone left the voice channel.');
    } else rt.emptySince = null;
    m.lastAliveAt = Date.now(); // where the gap starts if the bot crashes without a clean shutdown
    const heardAny = rt.lastAudioAt > 0;
    if (!heardAny && !rt.noAudioHinted && humans > 0 && Date.now() - rt.startedLive > 45 * SEC) {
        rt.noAudioHinted = true;
        logEvent(rt, '⚠️ I haven\'t heard anyone yet. If people are talking, try changing the channel\'s voice region and restarting.');
    }
    const quietFor = Date.now() - (rt.lastAudioAt || rt.startedLive);
    if (humans > 0 && !rt.silenceWarned && quietFor >= SILENCE_WARN_MS) {
        rt.silenceWarned = true;
        logEvent(rt, '🤫 Hello? I haven\'t heard anything for 5 minutes. Stop the recording if you\'re done. Taking a break? Ignore this.');
    }
    writeMetaSoon(rt);
}

async function startRecording({ guild, channel, requester, panelChannel, auto = false, ruleChannelId = null }) {
    const id = randomId(10);
    const prevNick = guild.members.me?.nickname ?? null;
    if (!await setRecordingNick(guild, true, prevNick)) {
        throw new UserError('I need the **Change Nickname** permission so everyone can see I\'m recording. I won\'t record without it.');
    }
    const meta = {
        id, key: randomId(16), deleteKey: randomId(10), status: 'recording', auto, ruleChannelId,
        guildId: guild.id, guildName: guild.name, guildIcon: guild.iconURL({ extension: 'png', size: 128 }),
        channelId: channel.id, channelName: channel.name,
        requesterId: requester.id, requester: memberInfo(guild.members.cache.get(requester.id), requester),
        startedAt: Date.now(), endedAt: null, expiresAt: null, endReason: null, prevNick,
        tracks: [], notes: [], log: [], restarts: [], panel: null,
    };
    await fsp.mkdir(recDir(id), { recursive: true });
    const rt = newRuntime(meta);
    active.set(guild.id, rt);
    recordings.set(id, meta);
    try {
        await connect(rt, channel);
    } catch (e) {
        rt.stopping = true; // so destroying the connection doesn't run the normal stop
        active.delete(guild.id);
        recordings.delete(id);
        try { rt.connection?.destroy(); } catch (_) {}
        await setRecordingNick(guild, false, prevNick);
        await fsp.rm(recDir(id), { recursive: true, force: true }).catch(() => {});
        throw new UserError('I couldn\'t connect to that voice channel. Try again in a moment, or switch the channel\'s voice region.');
    }
    logEvent(rt, auto ? `🤖 Auto-recording started in <#${channel.id}>` : `🔴 Recording started by <@${requester.id}>`);
    await writeMeta(meta);
    startTicker(rt);
    await postPanel(rt, panelChannel || channel);
    console.log(`[Recorder] Started ${id} in #${channel.name} (${auto ? 'auto' : requester.username})`);
    return rt;
}

async function stopRecording(rt, reason, byUserId = null, endAt = Date.now()) {
    if (rt.stopping) return;
    rt.stopping = true;
    const m = rt.meta;
    clearInterval(rt.tick);
    clearTimeout(rt.metaTimer);
    if (active.get(m.guildId) === rt) active.delete(m.guildId);
    try { rt.connection?.destroy(); } catch (_) {}
    await Promise.all([...rt.tracks.values()].map(t => new Promise(r => t.file.end(r))));
    m.status = 'ended';
    m.endedAt = endAt;
    m.expiresAt = m.endedAt + EXPIRY_DAYS * DAY;
    m.endReason = byUserId ? `Stopped by ${trackNameFor(m, byUserId)}` : reason;
    m.log.push({ t: m.endedAt, text: byUserId ? `⏹️ Recording stopped by <@${byUserId}>` : `⏹️ ${reason}` });
    await writeMeta(m).catch(e => console.error('[Recorder] meta write failed:', e.message));
    const guild = client.guilds.cache.get(m.guildId);
    if (guild) await setRecordingNick(guild, false, m.prevNick);
    clearTimeout(rt.panelTimer);
    await renderPanel(rt);
    await dmRequester(m, true);
    console.log(`[Recorder] Stopped ${m.id} after ${fmtDuration(durationMs(m))}: ${m.endReason}`);
}

function trackNameFor(m, userId) {
    const t = m.tracks.find(x => x.id === userId);
    if (t) return trackName(t);
    const u = client.users.cache.get(userId);
    return u ? (u.globalName || u.username) : 'someone';
}

class UserError extends Error {}

// ── Panel ───────────────────────────────────────────────────────────────────
function panelPayload(rt) {
    const m = rt.meta;
    const live = isLive(m) && !rt.stopping;
    const c = new ContainerBuilder().setAccentColor(live ? ACCENT_LIVE : ACCENT_DONE);
    const owner = m.auto ? 'Auto-recording' : `${esc(m.requester.displayName)}'s recording`;
    c.addTextDisplayComponents(td(live
        ? `## 🔴 Recording…\n**${owner}** in <#${m.channelId}>`
        : `## ⏹️ Recording ended\n**${owner}** in <#${m.channelId}>`));
    const facts = [
        `**Recording ID** \`${m.id}\``,
        `**Started** ${ts(m.startedAt, 't')} (${ts(m.startedAt, 'R')})`,
        live ? `**Ends by** ${ts(m.startedAt + MAX_HOURS * HOUR, 't')} at the latest` : `**Length** ${fmtDuration(durationMs(m))}`,
        `**Tracks** ${m.tracks.length ? m.tracks.map(t => `${t.track}. ${esc(trackName(t))}`).join(', ') : '*nobody has spoken yet*'}`,
    ];
    c.addTextDisplayComponents(td(facts.join('\n'))).addSeparatorComponents(sep());
    const log = m.log.slice(-8).map(e => `${ts(e.t, 'T')} ${e.text}`).join('\n') || '*Nothing yet*';
    c.addTextDisplayComponents(td(`**Activity**\n${log}`));
    if (m.notes.length) {
        c.addTextDisplayComponents(td(`**Notes**\n${m.notes.slice(-5).map(n => `\`${timemark(n.t).slice(0, -3)}\` ${esc(n.text)}`).join('\n')}`));
    }
    c.addSeparatorComponents(sep());
    c.addActionRowComponents(live
        ? row(btn(`rec:stop:${m.id}`, 'Stop recording', '⏹️', ButtonStyle.Danger), btn(`rec:note:${m.id}`, 'Add a note', '📝'), btn(`rec:link:${m.id}`, 'Get download link', '🔗'))
        : row(btn(`rec:link:${m.id}`, 'Get download link', '🔗', ButtonStyle.Primary)));
    c.addTextDisplayComponents(td(live
        ? `-# Everyone who talks gets their own track. Downloads work while recording. Stops after ${MAX_HOURS} hours${m.auto ? ' or when the auto-record rule stops matching' : ' or 2 minutes after everyone leaves'}. Panel stuck? \`/record panel\``
        : `-# ${esc(m.endReason || 'Ended')}. Downloads are available until ${ts(m.expiresAt, 'D')}.`));
    return { flags: V2, components: [c], allowedMentions: NO_PINGS };
}

async function postPanel(rt, channel) {
    if (!channel?.isTextBased?.()) return null;
    const me = channel.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;
    try {
        const msg = await channel.send(panelPayload(rt));
        rt.meta.panel = { channelId: channel.id, messageId: msg.id };
        writeMetaSoon(rt);
        return msg;
    } catch (e) { console.error('[Recorder] panel post failed:', e.message); return null; }
}

function updatePanelSoon(rt) {
    if (rt.panelTimer || rt.stopping) return;
    rt.panelTimer = setTimeout(() => { rt.panelTimer = null; renderPanel(rt); }, 2500);
}

async function renderPanel(rt) {
    const p = rt.meta.panel;
    if (!p) return;
    const ch = client.channels.cache.get(p.channelId);
    const msg = ch && await ch.messages.fetch(p.messageId).catch(() => null);
    if (!msg) { rt.meta.panel = null; return; }
    await msg.edit(panelPayload(rt)).catch(e => console.error('[Recorder] panel edit failed:', e.message));
}

const panelUrl = m => m.panel ? `https://discord.com/channels/${m.guildId}/${m.panel.channelId}/${m.panel.messageId}` : null;

async function dmRequester(m, finished) {
    const user = await client.users.fetch(m.requesterId).catch(() => null);
    if (!user) return false;
    const c = new ContainerBuilder().setAccentColor(finished ? ACCENT_DONE : ACCENT_LIVE);
    if (finished) {
        c.addTextDisplayComponents(td(
            `## ✅ Recording finished\n**#${esc(m.channelName)}** in **${esc(m.guildName)}** · ${fmtDuration(durationMs(m))} · ` +
            `${m.tracks.length} ${m.tracks.length === 1 ? 'track' : 'tracks'}\n` +
            `Every speaker is on their own track, ready to download in FLAC, MP3, WAV, AAC, an Audacity project and more.\n` +
            `-# ${esc(m.endReason || '')} · Available until ${ts(m.expiresAt, 'f')} (${ts(m.expiresAt, 'R')})`));
        c.addActionRowComponents(row(linkBtn(pageUrl(m), 'Download', '⬇️'), btn(`rec:del:${m.id}`, 'Delete recording', '🗑️', ButtonStyle.Danger)));
    } else {
        const intro = m.auto
            ? `I started auto-recording **#${esc(m.channelName)}** in **${esc(m.guildName)}** ${ts(m.startedAt, 'f')} (your auto-record rule).`
            : `I'm recording **#${esc(m.channelName)}** in **${esc(m.guildName)}**, started ${ts(m.startedAt, 'f')}.`;
        c.addTextDisplayComponents(td(
            `## 🔴 Recording started\n${intro}\n\n` +
            `Your download page is below. It works even while I'm still recording.\n` +
            `**Delete key:** ||\`${m.deleteKey}\`|| (only needed to delete it from the website)\n` +
            `-# I'll stop by ${ts(m.startedAt + MAX_HOURS * HOUR, 't')} at the latest. Downloads stay up for ${EXPIRY_DAYS} days after it ends. Lost this DM? Use \`/record list\`.`));
        const buttons = [linkBtn(pageUrl(m), 'Download page', '⬇️')];
        if (panelUrl(m)) buttons.push(linkBtn(panelUrl(m), 'Jump to panel', '🎛️'));
        c.addActionRowComponents(row(...buttons));
    }
    try { await user.send({ flags: V2, components: [c], allowedMentions: NO_PINGS }); return true; }
    catch { return false; }
}

// ── Commands ────────────────────────────────────────────────────────────────
const voiceTypes = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const recorderCommands = [
    new SlashCommandBuilder()
        .setName('record')
        .setDescription('Multi-track voice recording: every speaker on their own track')
        .addSubcommand(s => s.setName('start').setDescription('Start recording a voice channel (yours by default)')
            .addChannelOption(o => o.setName('channel').setDescription('The voice channel to record').addChannelTypes(...voiceTypes)))
        .addSubcommand(s => s.setName('stop').setDescription('Stop the recording in this server'))
        .addSubcommand(s => s.setName('note').setDescription('Add a timestamped note (shows up as a marker in Audacity/Audition)')
            .addStringOption(o => o.setName('message').setDescription('e.g. "Chapter 2" or "funny bit"').setRequired(true).setMaxLength(200)))
        .addSubcommand(s => s.setName('list').setDescription('Get links to your recent recordings')
            .addBooleanOption(o => o.setName('everyone').setDescription('(Managers) Show every recording in this server')))
        .addSubcommand(s => s.setName('panel').setDescription('Re-post the recording panel here'))
        .addSubcommand(s => s.setName('voice-test').setDescription('Record yourself for a few seconds and hear how you sound'))
        .addSubcommand(s => s.setName('help').setDescription('How recording works'))
        .addSubcommandGroup(g => g.setName('autorecord').setDescription('Record a channel automatically when people join')
            .addSubcommand(s => s.setName('on').setDescription('Turn on auto-recording for a channel')
                .addChannelOption(o => o.setName('channel').setDescription('The voice channel').setRequired(true).addChannelTypes(...voiceTypes))
                .addIntegerOption(o => o.setName('minimum').setDescription('Start once this many people are in it (default 1, or 0 if you set triggers)').setMinValue(0).setMaxValue(99))
                .addStringOption(o => o.setName('triggers').setDescription('Mention users/roles that start it on their own, e.g. @Kiernen @Podcast'))
                .addChannelOption(o => o.setName('post-channel').setDescription('Where to post the recording panel (default: the voice channel chat)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement)))
            .addSubcommand(s => s.setName('off').setDescription('Turn off auto-recording for a channel')
                .addChannelOption(o => o.setName('channel').setDescription('The voice channel').setRequired(true).addChannelTypes(...voiceTypes)))
            .addSubcommand(s => s.setName('view').setDescription('See auto-recorded channels')))
        .addSubcommandGroup(g => g.setName('settings').setDescription('Who can record, and what gets recorded')
            .addSubcommand(s => s.setName('view').setDescription('View recording settings'))
            .addSubcommand(s => s.setName('access-role-add').setDescription('Let a role start and stop recordings')
                .addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true)))
            .addSubcommand(s => s.setName('access-role-remove').setDescription('Take recording access away from a role')
                .addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true)))
            .addSubcommand(s => s.setName('bots').setDescription('Record other bots (music bots etc.) too?')
                .addBooleanOption(o => o.setName('include').setDescription('Include bots in recordings').setRequired(true)))),
];
const isRecorderCommand = name => name === 'record';
const isRecorderInteraction = ix => typeof ix.customId === 'string' && ix.customId.startsWith('rec:');

const NEED_PERMS = 'You need **Manage Server**, the mod role, or a recording access role to do that. A manager can add one with `/record settings access-role-add`.';

async function handleRecorderCommand(ix) {
    if (!ix.inGuild()) return reply(ix, 'Recording only works inside a server.');
    if (!loaded) return reply(ix, '⏳ The recorder is still starting up, try again in a minute.');
    const group = ix.options.getSubcommandGroup(false);
    const sub = ix.options.getSubcommand();
    if (group === 'autorecord') return handleAutoCommand(ix, sub);
    if (group === 'settings') return handleSettingsCommand(ix, sub);
    switch (sub) {
        case 'start': return cmdStart(ix);
        case 'stop': return cmdStop(ix);
        case 'note': return cmdNote(ix, ix.options.getString('message'));
        case 'list': return cmdList(ix);
        case 'panel': return cmdPanel(ix);
        case 'voice-test': return cmdVoiceTest(ix);
        case 'help': return reply(ix, null, { ...helpPayload(), content: undefined });
    }
}

function helpPayload() {
    const c = new ContainerBuilder().setAccentColor(ACCENT_LIVE).addTextDisplayComponents(td(
        '## 🎙️ Recording, the easy way\n' +
        '**1.** Join a voice channel and run `/record start`.\n' +
        '**2.** I join, add **[RECORDING]** to my name, and post a panel with **Stop** and **Add a note** buttons.\n' +
        '**3.** You get a DM with your download page. Everyone who talks gets their own track, all perfectly in sync.\n' +
        '**4.** Run `/record stop` (or hit Stop) when you\'re done. Downloads work even while recording.'))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(td(
            '**Downloads:** a ZIP with one file per person (FLAC, WAV, MP3, AAC, Ogg, Opus, ALAC), one mixed file, ' +
            'or a ready-made **Audacity** or **Adobe Audition** project. Not sure? Pick **FLAC**.\n' +
            '**Notes:** `/record note` drops a timestamped marker, handy for chapters. They show up as labels in Audacity and markers in Audition.\n' +
            '**Sound check:** `/record voice-test` records you for a few seconds and plays it back.\n' +
            '**Lost the link?** `/record list`\n' +
            '**Auto-record:** `/record autorecord on` records a channel automatically when people join.\n' +
            '**Who can record:** Manage Server, mods, and roles added with `/record settings access-role-add`.'))
        .addTextDisplayComponents(td(`-# Up to ${MAX_HOURS} hours per recording. Recordings are kept for ${EXPIRY_DAYS} days after they end. Stops by itself 2 minutes after everyone leaves.`));
    return { flags: V2 | EPH, components: [c], allowedMentions: NO_PINGS };
}

async function cmdStart(ix) {
    const member = ix.member;
    if (!canRecord(member)) return reply(ix, NEED_PERMS);
    const channel = ix.options.getChannel('channel') || member.voice?.channel;
    if (!channel) return reply(ix, 'Join a voice channel first, or pick one with the `channel` option.');
    const guild = ix.guild;
    const existing = active.get(guild.id);
    if (existing) {
        return reply(ix, `I'm already recording <#${existing.meta.channelId}> in this server. Stop that one first.`,
            panelUrl(existing.meta) ? { components: [row(linkBtn(panelUrl(existing.meta), 'Jump to panel', '🎛️'))] } : {});
    }
    if (tests.has(guild.id)) return reply(ix, 'A voice test is running right now, give it a few seconds.');
    const me = guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) return reply(ix, `I don't have permission to join <#${channel.id}>.`);
    if (channel.userLimit && channel.members.size >= channel.userLimit && !perms.has(PermissionFlagsBits.MoveMembers)) {
        return reply(ix, `<#${channel.id}> is full, and I don't have **Move Members** to join it anyway.`);
    }
    if (!me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
        return reply(ix, 'I need the **Change Nickname** permission so everyone can see I\'m recording. I won\'t record without it.');
    }
    if (await freeBytes() < MIN_FREE_START) return reply(ix, '💾 Recording storage is nearly full. Delete some old recordings (`/record list`) and try again.');

    await ix.deferReply({ flags: EPH });
    let rt;
    try {
        rt = await startRecording({ guild, channel, requester: ix.user, panelChannel: ix.channel });
    } catch (e) {
        if (!(e instanceof UserError)) console.error('[Recorder] start failed:', e);
        return reply(ix, `❌ ${e instanceof UserError ? e.message : 'Something went wrong starting the recording. Try again in a moment.'}`);
    }
    const dmed = await dmRequester(rt.meta, false);
    const buttons = [linkBtn(pageUrl(rt.meta), 'Download page', '⬇️')];
    if (panelUrl(rt.meta)) buttons.push(linkBtn(panelUrl(rt.meta), 'Jump to panel', '🎛️'));
    return reply(ix,
        `🔴 Recording <#${channel.id}>. Everyone who talks gets their own track.\n` +
        (dmed ? 'I sent you a DM with the download page and delete key.'
            : '⚠️ I couldn\'t DM you, so **save the button below**. You can always get it back with `/record list`.'),
        { components: [row(...buttons)] });
}

function findRecordingFor(ix) {
    return active.get(ix.guildId) || null;
}

async function cmdStop(ix) {
    const rt = findRecordingFor(ix);
    if (!rt) return reply(ix, 'Nothing is being recorded in this server right now.');
    if (!isRecOwner(ix.user.id, rt.meta) && !canRecord(ix.member)) return reply(ix, NEED_PERMS);
    await ix.deferReply({ flags: EPH });
    await stopRecording(rt, null, ix.user.id);
    return reply(ix, `⏹️ Stopped. ${fmtDuration(durationMs(rt.meta))} recorded, ${rt.meta.tracks.length} ${rt.meta.tracks.length === 1 ? 'track' : 'tracks'}.`,
        isRecOwner(ix.user.id, rt.meta) ? { components: [row(linkBtn(pageUrl(rt.meta), 'Download', '⬇️'))] } : {});
}

function canNote(ix, rt) {
    return isRecOwner(ix.user.id, rt.meta) || canRecord(ix.member) || ix.member?.voice?.channelId === rt.meta.channelId;
}

async function addNote(rt, text, userId) {
    const t = (Date.now() - rt.meta.startedAt) / 1000;
    rt.meta.notes.push({ t, text: text.replace(/\s+/g, ' ').trim().slice(0, 200), by: userId });
    logEvent(rt, `📝 <@${userId}> added a note`);
    return t;
}

async function cmdNote(ix, text) {
    const rt = findRecordingFor(ix);
    if (!rt) return reply(ix, 'Nothing is being recorded in this server right now.');
    if (!canNote(ix, rt)) return reply(ix, 'Only people in the recorded channel (or with recording access) can add notes.');
    const t = await addNote(rt, text, ix.user.id);
    return reply(ix, `📝 Note added at \`${timemark(t).slice(0, -3)}\`.`);
}

async function cmdPanel(ix) {
    const rt = findRecordingFor(ix);
    if (!rt) return reply(ix, 'Nothing is being recorded in this server right now. Start with `/record start`.');
    if (!isRecOwner(ix.user.id, rt.meta) && !canRecord(ix.member)) return reply(ix, NEED_PERMS);
    const old = rt.meta.panel;
    const msg = await postPanel(rt, ix.channel);
    if (!msg) return reply(ix, 'I can\'t post in this channel. Try another one.');
    if (old) client.channels.cache.get(old.channelId)?.messages.delete(old.messageId).catch(() => {});
    return reply(ix, '🎛️ Panel posted.');
}

async function cmdList(ix) {
    const everyone = ix.options.getBoolean('everyone') && canManageServer(ix.member);
    const list = [...recordings.values()]
        .filter(m => m.guildId === ix.guildId && (everyone || m.requesterId === ix.user.id))
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 10);
    if (!list.length) return reply(ix, everyone ? 'There are no recordings in this server right now.' : 'You don\'t have any recordings from the last week. Start one with `/record start`.');
    const c = new ContainerBuilder().setAccentColor(ACCENT_IDLE)
        .addTextDisplayComponents(td(`## 🎙️ ${everyone ? 'Server recordings' : 'Your recordings'}\n-# ${list.length} most recent · only you can see this`));
    for (const m of list) {
        const status = isLive(m) ? '🔴 **Recording now**' : `${fmtDuration(durationMs(m))} · expires ${ts(m.expiresAt, 'R')}`;
        const by = everyone ? ` · by ${esc(m.requester.displayName)}` : '';
        c.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(td(`**#${esc(m.channelName)}** · ${ts(m.startedAt, 'f')}${m.auto ? ' · *auto*' : ''}\n-# ${status} · ${m.tracks.length} ${m.tracks.length === 1 ? 'track' : 'tracks'}${by} · \`${m.id}\``))
            .setButtonAccessory(linkBtn(pageUrl(m), 'Open', '⬇️')));
    }
    return reply(ix, null, { content: undefined, flags: V2 | EPH, components: [c] });
}

// ── Buttons / modals ────────────────────────────────────────────────────────
async function handleRecorderInteraction(ix) {
    const [, action, id] = ix.customId.split(':');
    if (action === 'vtstop') return voiceTestStopButton(ix);
    const m = recordings.get(id);
    if (!m) return reply(ix, 'That recording doesn\'t exist anymore (it may have expired or been deleted).');
    const rt = active.get(m.guildId)?.meta.id === id ? active.get(m.guildId) : null;
    const member = ix.inGuild() ? ix.member : null;

    if (action === 'stop') {
        if (!rt) return reply(ix, 'That recording already ended.');
        if (!isRecOwner(ix.user.id, m) && !canRecord(member)) return reply(ix, NEED_PERMS);
        await ix.deferUpdate();
        return stopRecording(rt, null, ix.user.id);
    }
    if (action === 'note') {
        if (!rt) return reply(ix, 'That recording already ended.');
        if (!canNote(ix, rt)) return reply(ix, 'Only people in the recorded channel (or with recording access) can add notes.');
        return ix.showModal(new ModalBuilder().setCustomId(`rec:notem:${id}`).setTitle('📝 Add a note to this recording').addLabelComponents(
            new LabelBuilder().setLabel('Note').setDescription('Saved with the time it happened, e.g. a chapter marker')
                .setTextInputComponent(new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true).setPlaceholder('Chapter 1, intro, funny bit…'))));
    }
    if (action === 'notem') {
        if (!rt) return reply(ix, 'That recording ended before the note was saved.');
        const t = await addNote(rt, ix.fields.getTextInputValue('text'), ix.user.id);
        return reply(ix, `📝 Note added at \`${timemark(t).slice(0, -3)}\`.`);
    }
    if (action === 'link') {
        if (!isRecOwner(ix.user.id, m) && !canRecord(member)) {
            return reply(ix, `Only <@${m.requesterId}> (who started it) and people with recording access can get the download link. Ask them for it!`);
        }
        return reply(ix, `Here's the download page for \`${m.id}\`. Only share it with people who should hear it.`,
            { components: [row(linkBtn(pageUrl(m), 'Download page', '⬇️'))] });
    }
    if (action === 'del') {
        if (!isRecOwner(ix.user.id, m)) return reply(ix, 'Only the person who started the recording can delete it.');
        if (isLive(m)) return reply(ix, 'Stop the recording first, then you can delete it.');
        return reply(ix, `🗑️ Delete recording \`${m.id}\` (#${esc(m.channelName)}, ${ts(m.startedAt, 'f')}) for good? Nobody can get it back.`,
            { components: [row(btn(`rec:delyes:${id}`, 'Yes, delete it', '🗑️', ButtonStyle.Danger))] });
    }
    if (action === 'delyes') {
        if (!isRecOwner(ix.user.id, m)) return reply(ix, 'Only the person who started the recording can delete it.');
        if (isLive(m)) return reply(ix, 'Stop the recording first, then you can delete it.');
        await deleteRecording(m.id);
        return ix.update({ content: `🗑️ Recording \`${m.id}\` was deleted.`, components: [] }).catch(() => reply(ix, `🗑️ Recording \`${m.id}\` was deleted.`));
    }
}

async function deleteRecording(id) {
    recordings.delete(id);
    for (const [jid, job] of jobs) if (job.recId === id) { job.abort?.abort(); jobs.delete(jid); fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {}); }
    await fsp.rm(recDir(id), { recursive: true, force: true });
}

// ── Auto-record ─────────────────────────────────────────────────────────────
function parseTriggers(text, guild) {
    const users = [], roles = [];
    for (const [, kind, id] of (text || '').matchAll(/<@([!&]?)(\d{15,25})>/g)) {
        if (kind === '&') roles.push(id); else users.push(id);
    }
    for (const id of (text || '').match(/\b\d{15,25}\b/g) || []) {
        if (users.includes(id) || roles.includes(id)) continue;
        if (guild.roles.cache.has(id)) roles.push(id); else users.push(id);
    }
    return { users: [...new Set(users)], roles: [...new Set(roles)].filter(r => r !== guild.id) };
}

function ruleMatches(rule, channel) {
    const humans = humansIn(channel);
    if (!humans.size) return false;
    if (rule.users.length || rule.roles.length) {
        const hit = humans.some(m => rule.users.includes(m.id) || rule.roles.some(r => m.roles.cache.has(r)));
        if (hit) return true;
    }
    return rule.minimum > 0 && humans.size >= rule.minimum;
}

function describeRule(chId, r) {
    const parts = [];
    if (r.minimum > 0) parts.push(`${r.minimum}+ ${r.minimum === 1 ? 'person' : 'people'}`);
    if (r.users.length) parts.push(r.users.map(u => `<@${u}>`).join(' '));
    if (r.roles.length) parts.push(r.roles.map(x => `<@&${x}>`).join(' '));
    return `<#${chId}> · starts with ${parts.join(' or ')} · panel in ${r.postChannelId ? `<#${r.postChannelId}>` : 'the voice chat'} · set by <@${r.createdBy}>`;
}

async function handleAutoCommand(ix, sub) {
    const guildAuto = settings.auto;
    if (sub === 'view') {
        const rules = Object.entries(guildAuto).filter(([, r]) => r.guildId === ix.guildId);
        if (!rules.length) return reply(ix, 'No channels are auto-recorded. Set one up with `/record autorecord on`.');
        return reply(ix, `## 🤖 Auto-recorded channels\n${rules.map(([c, r]) => `• ${describeRule(c, r)}`).join('\n')}`);
    }
    if (!canRecord(ix.member)) return reply(ix, NEED_PERMS);
    const channel = ix.options.getChannel('channel');
    if (sub === 'off') {
        if (!guildAuto[channel.id]) return reply(ix, `<#${channel.id}> isn't auto-recorded.`);
        delete guildAuto[channel.id];
        scheduleSave();
        return reply(ix, `🤖 Auto-recording is off for <#${channel.id}>. Recordings already running keep going until stopped.`);
    }
    const { users, roles } = parseTriggers(ix.options.getString('triggers'), ix.guild);
    const minOpt = ix.options.getInteger('minimum');
    const minimum = minOpt ?? (users.length || roles.length ? 0 : 1);
    if (minimum === 0 && !users.length && !roles.length) return reply(ix, 'Set a minimum of at least 1, or mention some trigger users/roles.');
    const post = ix.options.getChannel('post-channel');
    if (post && !post.permissionsFor(ix.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        return reply(ix, `I can't post in <#${post.id}>. Pick another channel or give me Send Messages there.`);
    }
    guildAuto[channel.id] = { guildId: ix.guildId, minimum, users, roles, postChannelId: post?.id || null, createdBy: ix.user.id, updatedAt: Date.now() };
    scheduleSave();
    queueAutoCheck(channel.id, 0);
    return reply(ix, `🤖 Auto-recording is on: ${describeRule(channel.id, guildAuto[channel.id])}.\nRecording links get DMed to **you**, so keep your DMs open.`);
}

function queueAutoCheck(channelId, delay = AUTO_SETTLE_MS) {
    clearTimeout(autoTimers.get(channelId));
    autoTimers.set(channelId, setTimeout(() => {
        autoTimers.delete(channelId);
        checkAuto(channelId).catch(e => console.error('[Recorder] auto check failed:', e.message));
    }, delay));
}

async function checkAuto(channelId) {
    if (shuttingDown || !loaded) return;
    const rule = settings.auto[channelId];
    const channel = client.channels.cache.get(channelId);
    const guild = channel?.guild;
    if (!guild) return;
    const rt = active.get(guild.id);
    const matches = rule && ruleMatches(rule, channel);
    if (rt) {
        if (!rt.meta.auto || rt.meta.ruleChannelId !== channelId) return;
        if (matches) { rt.autoUnmetSince = null; return; }
        rt.autoUnmetSince ??= Date.now();
        if (Date.now() - rt.autoUnmetSince >= AUTO_STOP_MS) return stopRecording(rt, 'Auto-record stopped: not enough people left in the channel.');
        return queueAutoCheck(channelId, AUTO_STOP_MS - (Date.now() - rt.autoUnmetSince) + 500);
    }
    if (!matches || tests.has(guild.id) || !guild.members.me?.permissions.has(PermissionFlagsBits.ChangeNickname)) return;
    if (!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) return;
    if (await freeBytes() < MIN_FREE_START) return console.error('[Recorder] auto-record skipped: storage nearly full');
    const requester = await client.users.fetch(rule.createdBy).catch(() => null);
    if (!requester) return;
    const post = rule.postChannelId ? client.channels.cache.get(rule.postChannelId) : channel;
    try {
        const started = await startRecording({ guild, channel, requester, panelChannel: post, auto: true, ruleChannelId: channelId });
        await dmRequester(started.meta, false);
    } catch (e) { console.error('[Recorder] auto-record start failed:', e.message); }
}

function onVoiceStateUpdate(oldState, newState) {
    if (!loaded) return;
    const meId = client.user?.id;
    if (newState.id === meId || oldState.id === meId) return onOwnVoiceState(oldState, newState);
    for (const chId of new Set([oldState.channelId, newState.channelId])) {
        if (chId && settings.auto[chId]) queueAutoCheck(chId);
    }
    const rt = active.get(newState.guild.id);
    if (rt && newState.channelId === rt.meta.channelId && oldState.channelId !== newState.channelId && !newState.member?.user.bot) {
        rt.emptySince = null;
        if (!rt.meta.tracks.some(t => t.id === newState.id)) logEvent(rt, `👋 <@${newState.id}> joined the channel`);
    }
}

function onOwnVoiceState(oldState, newState) {
    const rt = active.get(newState.guild.id);
    if (!rt || rt.stopping) return;
    if (newState.channelId && newState.channelId !== rt.meta.channelId) {
        const ch = newState.channel;
        rt.meta.channelId = newState.channelId;
        rt.meta.channelName = ch?.name || rt.meta.channelName;
        logEvent(rt, `↪️ I was moved to <#${newState.channelId}>. Still recording. Press Stop if you want me to leave.`);
    }
    if (newState.serverDeaf && !oldState.serverDeaf) logEvent(rt, '🙉 I was server-deafened! Undeafen me, I can\'t hear anyone.');
    if (!newState.serverDeaf && oldState.serverDeaf) logEvent(rt, '👂 I was undeafened.');
    if (!newState.channelId && oldState.channelId) {
        setTimeout(() => {
            const me = newState.guild.members.me;
            if (!rt.stopping && !me?.voice?.channelId) stopRecording(rt, 'I was disconnected from the voice channel.');
        }, 6 * SEC);
    }
}

// ── Settings ────────────────────────────────────────────────────────────────
async function handleSettingsCommand(ix, sub) {
    if (sub === 'view') {
        const roles = settings.accessRoles.length ? settings.accessRoles.map(r => `<@&${r}>`).join(' ') : '*none*';
        return reply(ix,
            `## ⚙️ Recording settings\n**Can record:** server owner, Manage Server, <@&${modRoleId}>, plus access roles\n` +
            `**Access roles:** ${roles}\n**Record other bots:** ${settings.includeBots ? 'yes' : 'no'}\n` +
            `**Limits:** ${MAX_HOURS} hours per recording, kept ${EXPIRY_DAYS} days after it ends`);
    }
    if (!canManageServer(ix.member)) return reply(ix, 'You need **Manage Server** to change recording settings.');
    if (sub === 'bots') {
        settings.includeBots = ix.options.getBoolean('include');
        scheduleSave();
        return reply(ix, settings.includeBots ? '🤖 Other bots will be recorded from now on.' : '🤖 Other bots will be left out from now on.');
    }
    const role = ix.options.getRole('role');
    if (sub === 'access-role-add') {
        if (role.id === ix.guildId) return reply(ix, 'Use a real role, not @everyone.');
        if (settings.accessRoles.includes(role.id)) return reply(ix, `<@&${role.id}> already has recording access.`);
        settings.accessRoles.push(role.id);
        scheduleSave();
        return reply(ix, `✅ <@&${role.id}> can now start and stop recordings.`);
    }
    if (sub === 'access-role-remove') {
        if (!settings.accessRoles.includes(role.id)) return reply(ix, `<@&${role.id}> isn't an access role.`);
        settings.accessRoles = settings.accessRoles.filter(r => r !== role.id);
        scheduleSave();
        return reply(ix, `✅ Removed recording access from <@&${role.id}>.`);
    }
}

// ── Voice test ──────────────────────────────────────────────────────────────
async function cmdVoiceTest(ix) {
    const guild = ix.guild;
    const channel = ix.member.voice?.channel;
    if (!channel) return reply(ix, 'Join a voice channel first, then run this again.');
    if (active.has(guild.id)) return reply(ix, 'I\'m recording in this server right now, so I can\'t do a voice test.');
    if (tests.has(guild.id)) return reply(ix, 'Someone else is doing a voice test right now, try again in a few seconds.');
    const perms = channel.permissionsFor(guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) return reply(ix, `I need to be able to join and speak in <#${channel.id}>.`);

    await ix.deferReply({ flags: EPH });
    const prevNick = guild.members.me?.nickname ?? null;
    if (!await setRecordingNick(guild, true, prevNick)) return reply(ix, 'I need the **Change Nickname** permission to show I\'m recording.');
    const dir = path.join(JOB_DIR, `vt-${randomId(8)}`);
    await fsp.mkdir(dir, { recursive: true });
    const test = { userId: ix.user.id, ix, dir, startedAt: Date.now(), done: null, file: fs.createWriteStream(path.join(dir, '1.pkt')), lastPos: 0, heard: false };
    tests.set(guild.id, test);
    const panel = (text, withStop) => reply(ix, text, { components: withStop ? [row(btn('rec:vtstop', 'Stop & listen', '⏹️', ButtonStyle.Primary))] : [] });
    let connection;
    try {
        connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
        hookReceiver(connection, (uid, _ssrc, _rtp, pkt) => {
            if (uid !== test.userId || test.stopped) return;
            let pos = Math.round((Date.now() - test.startedAt) * RATE / 1000);
            if (pos < test.lastPos) pos = test.lastPos;
            test.lastPos = pos + (opusSamples(pkt) || FRAME);
            const head = Buffer.alloc(6);
            head.writeUInt32LE(pos, 0); head.writeUInt16LE(pkt.length, 4);
            test.file.write(Buffer.concat([head, pkt]));
            test.heard = true;
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 20 * SEC);
        test.startedAt = Date.now();
        await panel(`🎙️ **Recording your voice test…** Say something! I'll play it back ${ts(Date.now() + VOICE_TEST_MS, 'R')}.`, true);
        await new Promise(r => { test.done = r; setTimeout(r, VOICE_TEST_MS); });
        test.stopped = true;
        await new Promise(r => test.file.end(r));
        const length = Date.now() - test.startedAt;
        if (!test.heard) {
            await panel('🔇 **I didn\'t hear anything.** Check that you\'re not muted, your input device is right in Discord\'s Voice settings, and your input sensitivity isn\'t too high.', false);
        } else {
            await panel(`🔊 **Playing it back** (${fmtDuration(length)})…`, false);
            const ogg = await buildTrackOggBuffer(path.join(dir, '1.pkt'), Math.round(length * RATE / 1000));
            const player = createAudioPlayer();
            connection.subscribe(player);
            player.play(createAudioResource(Readable.from([ogg]), { inputType: StreamType.OggOpus }));
            await new Promise(r => {
                player.on(AudioPlayerStatus.Idle, r);
                player.on('error', r);
                setTimeout(r, length + 10 * SEC);
            });
            await panel('✅ **Voice test finished.** Sounded off? Check your input device, input volume and noise suppression in Discord\'s Voice settings.', false);
        }
    } catch (e) {
        console.error('[Recorder] voice test failed:', e.message);
        await panel('❌ The voice test failed. Try again in a moment.', false);
    } finally {
        test.stopped = true;
        test.file.destroy();
        try { connection?.destroy(); } catch (_) {}
        tests.delete(guild.id);
        await setRecordingNick(guild, false, prevNick);
        fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

async function voiceTestStopButton(ix) {
    const test = tests.get(ix.guildId);
    if (!test || test.userId !== ix.user.id) return reply(ix, 'That voice test already finished.');
    await ix.deferUpdate().catch(() => {});
    test.done?.();
}

// ── Exports (jobs) ──────────────────────────────────────────────────────────
// fmt: ffmpeg encoder args per format. `copy` keeps the original Opus (no re-encode).
const FORMATS = {
    flac:    { ext: 'flac', label: 'FLAC', args: ['-c:a', 'flac', '-sample_fmt', 's16'] },
    wav:     { ext: 'wav',  label: 'WAV', args: ['-c:a', 'pcm_s16le'] },
    aac:     { ext: 'm4a',  label: 'AAC', args: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
    mp3:     { ext: 'mp3',  label: 'MP3', args: ['-c:a', 'libmp3lame', '-q:a', '2'] },
    vorbis:  { ext: 'ogg',  label: 'Ogg Vorbis', args: ['-c:a', 'libvorbis', '-q:a', '6'] },
    opus:    { ext: 'opus', label: 'Opus', args: ['-c:a', 'libopus', '-b:a', '96k'] },
    alac:    { ext: 'm4a',  label: 'ALAC', args: ['-c:a', 'alac', '-sample_fmt', 's16p'] },
    oggflac: { ext: 'oga',  label: 'Ogg FLAC', args: ['-c:a', 'flac', '-sample_fmt', 's16', '-f', 'ogg'] },
    adpcm:   { ext: 'wav',  label: 'ADPCM WAV', args: ['-c:a', 'adpcm_ms'] },
    wav8:    { ext: 'wav',  label: '8-bit WAV', args: ['-c:a', 'pcm_u8'] },
    raw:     { ext: 'ogg',  label: 'Original Opus', copy: true },
};
const CONTAINERS = ['zip', 'mix', 'aup', 'sesx'];

const jobs = new Map(); // jobId → job
const queue = [];
let running = null;

function fileSafe(s) { return String(s).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'user'; }
const trackFileBase = t => `${t.track}-${fileSafe(t.username || trackName(t))}`;

function infoText(m) {
    const lines = [
        `Recording ${m.id}`, '',
        `Server:\t\t${m.guildName} (${m.guildId})`,
        `Channel:\t${m.channelName} (${m.channelId})`,
        `Requester:\t${m.requester.username} (${m.requesterId})${m.auto ? ' [auto-recorded]' : ''}`,
        `Start time:\t${new Date(m.startedAt).toISOString()}`,
        `End time:\t${m.endedAt ? new Date(m.endedAt).toISOString() : '(still recording)'}`,
        `Duration:\t${timemark(durationMs(m) / 1000)}`, '',
        'Tracks:',
        ...m.tracks.map(t => `\t${t.track}: ${trackName(t)} / ${t.username} (${t.id})`),
    ];
    if (m.restarts?.length) {
        lines.push('', 'Gaps (bot restarted, filled with silence):');
        for (const r of m.restarts) lines.push(`\t${timemark((r.from - m.startedAt) / 1000)} - ${timemark((r.to - m.startedAt) / 1000)}`);
    }
    if (m.notes.length) {
        lines.push('', 'Notes:');
        for (const n of m.notes) lines.push(`\t${timemark(n.t)}: ${n.text}`);
    }
    return lines.join('\r\n') + '\r\n';
}

// Audacity's "Import > Labels…" format, also handy for other editors
const labelsText = m => m.notes.map(n => `${n.t.toFixed(6)}\t${n.t.toFixed(6)}\t${n.text}`).join('\n') + '\n';
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function aupProject(m, files) {
    return [
        '<?xml version="1.0" standalone="no" ?>',
        '<!DOCTYPE project PUBLIC "-//audacityproject-1.3.0//DTD//EN" "http://audacity.sourceforge.net/xml/audacityproject-1.3.0.dtd" >',
        `<project xmlns="http://audacity.sourceforge.net/xml/" projname="${m.id}_data" version="1.3.0" audacityversion="2.2.2" rate="48000.0">`,
        ...(m.notes.length ? [
            '\t<labeltrack name="Notes" height="73" minimized="0">',
            ...m.notes.map(n => `\t\t<label t="${n.t}" t1="${n.t}" title="${xml(n.text).replace(/\n/g, ' ')}"/>`),
            '\t</labeltrack>',
        ] : []),
        ...files.map(f => `\t<import filename="${xml(f)}" offset="0.00000000" mute="0" solo="0" height="150" minimized="0" gain="1.0" pan="0.0"/>`),
        '</project>',
    ].join('\n');
}

function sesxProject(m, files, totalSamples) {
    const now = new Date().toISOString();
    const tracks = files.map((f, i) => `
      <audioTrack automationLaneOpenState="false" id="${i + 10001}" index="${i + 1}" select="true" visible="true">
        <trackParameters trackHeight="53" trackHue="160" trackMinimized="false"><name>${xml(f.replace(/\.[^.]+$/, ''))}</name></trackParameters>
        <trackAudioParameters audioChannelType="stereo" automationMode="1" monitoring="false" recordArmed="false" solo="false" soloSafe="false">
          <trackOutput outputID="10000" type="trackID"/><trackInput inputID="1"/>
        </trackAudioParameters>
        <audioClip name="${xml(f)}" clipAutoCrossfade="false" startPoint="0" endPoint="${totalSamples}" fileID="${i}" hue="-1" id="0" lockedInTime="false" looped="false" offline="false" select="false" sourceInPoint="0" sourceOutPoint="${totalSamples}" zOrder="2"/>
      </audioTrack>`).join('');
    const markers = m.notes.map(n => `
                <rdf:li rdf:parseType="Resource"><xmpDM:startTime>${Math.ceil(n.t * RATE)}</xmpDM:startTime><xmpDM:name>${xml(n.text)}</xmpDM:name></rdf:li>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<!DOCTYPE sesx>
<sesx version="1.8">
  <session appBuild="13.0.0.519" appVersion="13.0" audioChannelType="stereo" bitDepth="32" duration="${totalSamples}" sampleRate="48000">
    <tracks>${tracks}
      <masterTrack automationLaneOpenState="false" id="10000" index="${files.length + 1}" select="false" visible="true">
        <trackParameters trackHeight="53" trackHue="-1" trackMinimized="false"><name>Master</name></trackParameters>
        <trackAudioParameters audioChannelType="stereo" automationMode="1" monitoring="false" recordArmed="false" solo="false" soloSafe="true">
          <trackOutput outputID="1" type="hardwareOutput"/><trackInput inputID="-1"/>
        </trackAudioParameters>
      </masterTrack>
    </tracks>
    <sessionState ctiPosition="0" smpteStart="0">
      <timeFormatState beatsPerBar="4" beatsPerMinute="120" customFrameRate="12" linkToDefaultTimeSettings="true" noteLength="4" subdivisions="16" timeCodeDropFrame="false" timeCodeFrameRate="30" timeCodeNTSC="false" timeFormat="timeFormatDecimal"/>
      <mixingOptionState defaultPanModeLogarithmic="false" panPower="-3" playOverlappingClips="false"/>
    </sessionState>
    <xmpMetadata><![CDATA[<?xpacket id="W5M0MpCehiHzreSzNTczkc9d"?>
      <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/">
            <xmp:CreatorTool>TrueBeast Recorder</xmp:CreatorTool><xmp:CreateDate>${now}</xmp:CreateDate><xmp:MetadataDate>${now}</xmp:MetadataDate><xmp:ModifyDate>${now}</xmp:ModifyDate>
            <dc:format>application/xml</dc:format>
            <xmpDM:Tracks><rdf:Bag><rdf:li rdf:parseType="Resource">
              <xmpDM:trackName>Notes</xmpDM:trackName><xmpDM:trackType>Cue</xmpDM:trackType><xmpDM:frameRate>f48000</xmpDM:frameRate>
              <xmpDM:markers><rdf:Seq>${markers}
              </rdf:Seq></xmpDM:markers>
            </rdf:li></rdf:Bag></xmpDM:Tracks>
          </rdf:Description>
        </rdf:RDF>
      </x:xmpmeta>
      <?xpacket end="w"?>]]></xmpMetadata>
  </session>
  <files>
${files.map((f, i) => `    <file id="${i}" relativePath="${m.id}_data/${xml(f)}"/>`).join('\n')}
  </files>
</sesx>
`;
}

function runFfmpeg(args, durationSec, onProgress, signal) {
    return new Promise((resolve, reject) => {
        const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args, '-progress', 'pipe:1', '-nostats'];
        const proc = process.platform === 'win32' ? spawn('ffmpeg', full) : spawn('nice', ['-n', '10', 'ffmpeg', ...full]);
        let err = '';
        const kill = () => proc.kill('SIGKILL');
        signal?.addEventListener('abort', kill, { once: true });
        proc.stdout.on('data', d => {
            const mt = /out_time_us=(\d+)/.exec(d.toString());
            if (mt && durationSec > 0) onProgress?.(Math.min(1, Number(mt[1]) / 1e6 / durationSec));
        });
        proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
        proc.on('error', reject);
        proc.on('close', code => {
            signal?.removeEventListener('abort', kill);
            if (signal?.aborted) return reject(new Error('cancelled'));
            code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').pop()}`));
        });
    });
}

function zipDir(files, outFile) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(outFile);
        const zip = archiver('zip', { store: true });
        out.on('close', resolve);
        out.on('error', reject);
        zip.on('error', reject);
        zip.pipe(out);
        for (const [name, src] of files) typeof src === 'string' && fs.existsSync(src) ? zip.file(src, { name }) : zip.append(src, { name });
        zip.finalize();
    });
}

function jobKey(o) { return JSON.stringify([o.recId, o.format, o.container, o.tracks, o.normalize]); }

function createJob(m, opts) {
    const live = isLive(m);
    const key = jobKey({ recId: m.id, ...opts });
    if (!live) {
        for (const j of jobs.values()) {
            if (j.key === key && (j.state === 'queued' || j.state === 'running' || (j.state === 'done' && fs.existsSync(j.file)))) return j;
        }
    }
    const id = randomId(12);
    const job = {
        id, key, recId: m.id, ...opts, state: 'queued', step: 'Waiting in line', progress: 0,
        createdAt: Date.now(), finishedAt: null, error: null, file: null, fileName: null, size: 0,
        dir: path.join(JOB_DIR, id), abort: new AbortController(), live,
    };
    jobs.set(id, job);
    queue.push(job);
    pumpQueue();
    return job;
}

function pumpQueue() {
    if (running || !queue.length) return;
    running = queue.shift();
    runJob(running)
        .catch(e => {
            const job = running;
            job.state = job.abort.signal.aborted ? 'cancelled' : 'error';
            job.error = job.state === 'cancelled' ? 'Cancelled' : 'Something went wrong while processing. Try again, or pick a different format.';
            console.error(`[Recorder] job ${job.id} failed:`, e.message);
            fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
        })
        .finally(() => { running.finishedAt = Date.now(); running = null; pumpQueue(); });
}

async function runJob(job) {
    const m = recordings.get(job.recId);
    if (!m) throw new Error('recording gone');
    job.state = 'running';
    const fmt = FORMATS[job.format];
    const signal = job.abort.signal;
    const totalMs = durationMs(m);
    const totalSamples = Math.round(totalMs * RATE / 1000);
    const durSec = totalSamples / RATE;
    const tracks = m.tracks.filter(t => job.tracks.includes(t.track));
    if (!tracks.length) throw new Error('no tracks');
    await fsp.mkdir(job.dir, { recursive: true });
    const project = job.container === 'aup' || job.container === 'sesx';
    const dataDir = project ? path.join(job.dir, `${m.id}_data`) : path.join(job.dir, 'out');
    await fsp.mkdir(dataDir, { recursive: true });
    const steps = tracks.length * 2 + (job.container === 'mix' ? 2 : 1);
    let done = 0;
    const progress = frac => { job.progress = Math.min(99, Math.round(((done + frac) / steps) * 100)); };

    // 1. rebuild each track as gap-free Ogg Opus
    const oggs = [];
    for (const t of tracks) {
        job.step = `Preparing ${trackName(t)}'s track`;
        const ogg = path.join(job.dir, `${t.track}.src.ogg`);
        await buildTrackOggFile(path.join(recDir(m.id), `${t.track}.pkt`), totalSamples, ogg, `${trackName(t)} — ${m.id}`, signal);
        oggs.push({ t, ogg });
        done++; progress(0);
    }

    const norm = job.normalize ? ['-af', 'dynaudnorm'] : [];
    const files = []; // [nameInZip, path or Buffer]
    const base = `truebeast-${m.id}`;

    if (job.container === 'mix') {
        job.step = 'Mixing everyone together';
        const out = path.join(dataDir, `${base}-mix.${fmt.ext}`);
        const inputs = oggs.flatMap(o => ['-f', 'ogg', '-i', o.ogg]);
        const pre = oggs.map((_, i) => `[${i}:a]${job.normalize ? 'dynaudnorm' : 'anull'}[a${i}]`).join(';');
        const mix = oggs.length > 1
            ? `${pre};${oggs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${oggs.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[out]`
            : `${pre};[a0]anull[out]`;
        const codec = fmt.copy ? FORMATS.opus.args : fmt.args;
        done += oggs.length;
        await runFfmpeg([...inputs, '-filter_complex', mix, '-map', '[out]', ...codec, out], durSec, progress, signal);
        done++;
        job.file = out;
        job.fileName = `${base}-mix.${fmt.copy ? 'opus' : fmt.ext}`;
    } else {
        // 2. encode each track
        const ext = job.container === 'aup' ? 'ogg' : fmt.ext; // Audacity wants .ogg names even for FLAC (same trick as Craig)
        for (const { t, ogg } of oggs) {
            job.step = `Encoding ${trackName(t)}'s track`;
            const name = `${trackFileBase(t)}.${ext}`;
            const out = path.join(dataDir, name);
            if (fmt.copy) await fsp.rename(ogg, out);
            else await runFfmpeg(['-f', 'ogg', '-i', ogg, ...norm, ...fmt.args, ...(job.container === 'aup' ? ['-f', 'flac'] : []), out], durSec, progress, signal);
            files.push([project ? `${m.id}_data/${name}` : name, out]);
            done++; progress(0);
        }
        job.step = 'Packing it up';
        if (job.container === 'zip' && files.length === 1) {
            job.file = files[0][1];
            job.fileName = `${base}-${path.basename(files[0][1])}`;
        } else {
            const names = files.map(([n]) => path.basename(n));
            files.push(['info.txt', Buffer.from(infoText(m))]);
            if (m.notes.length) files.push(['notes-labels.txt', Buffer.from(labelsText(m))]);
            if (job.container === 'aup') {
                files.push([`${m.id}.aup`, Buffer.from(aupProject(m, names))]);
                files.push(['Extract before opening!.txt', Buffer.from('Extract (unzip) everything first, then open the .aup file in Audacity.\r\n')]);
            }
            if (job.container === 'sesx') {
                files.push([`${m.id}.sesx`, Buffer.from(sesxProject(m, names, totalSamples))]);
                files.push(['Extract before opening!.txt', Buffer.from('Extract (unzip) everything first, then open the .sesx file in Adobe Audition.\r\n')]);
            }
            const out = path.join(job.dir, `${base}.zip`);
            await zipDir(files, out);
            job.file = out;
            job.fileName = `${base}-${job.container === 'zip' ? fmt.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : job.container === 'aup' ? 'audacity' : 'audition'}.zip`;
        }
        done++;
    }
    for (const o of oggs) fsp.rm(o.ogg, { force: true }).catch(() => {});
    job.size = (await fsp.stat(job.file)).size;
    job.state = 'done';
    job.step = 'Ready';
    job.progress = 100;
}

function jobView(job) {
    const pos = job.state === 'queued' ? queue.indexOf(job) + 1 : 0;
    return {
        id: job.id, state: job.state, step: job.step, progress: job.progress, position: pos, error: job.error,
        fileName: job.fileName, size: job.size, format: job.format, container: job.container,
        createdAt: job.createdAt, finishedAt: job.finishedAt, live: job.live,
    };
}

async function cleanJobs() {
    for (const [ip, list] of badKeyHits) if (!list.some(t => t > Date.now() - 10 * MIN)) badKeyHits.delete(ip);
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) {
        if (job.state !== 'queued' && job.state !== 'running' && (job.finishedAt || job.createdAt) < cutoff) {
            jobs.delete(id);
            fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

// ── HTTP API (download page) ────────────────────────────────────────────────
const badKeyHits = new Map(); // ip → [ms]
function rateLimited(ip) {
    const list = (badKeyHits.get(ip) || []).filter(t => t > Date.now() - 10 * MIN);
    badKeyHits.set(ip, list);
    return list.length >= 30;
}
const safeEq = (a, b) => {
    const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    const data = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
}

function publicInfo(m) {
    return {
        id: m.id, live: isLive(m), status: m.status, auto: !!m.auto,
        guild: { name: m.guildName, icon: m.guildIcon }, channel: { name: m.channelName },
        requester: { name: m.requester.displayName, username: m.requester.username, avatar: m.requester.avatar },
        startedAt: m.startedAt, endedAt: m.endedAt, expiresAt: m.expiresAt, duration: durationMs(m) / 1000,
        endReason: m.endReason, maxHours: MAX_HOURS,
        tracks: m.tracks.map(t => ({ track: t.track, name: trackName(t), username: t.username, avatar: t.avatar, bot: t.bot })),
        notes: m.notes.map(n => ({ t: n.t, text: n.text })),
        gaps: (m.restarts || []).map(r => ({ from: (r.from - m.startedAt) / 1000, to: (r.to - m.startedAt) / 1000 })),
        formats: Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, { label: f.label, ext: f.ext }])),
    };
}

function readBody(req, limit = 10_000) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('too big')); req.destroy(); } });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
        req.on('error', reject);
    });
}

function contentDisposition(name) {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function serveFile(req, res, file, name, type) {
    const { size } = await fsp.stat(file);
    const headers = { 'Content-Type': type, 'Content-Disposition': contentDisposition(name), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        if (start < 0 || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        end = Math.min(end, size - 1);
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
}

const MIME = { zip: 'application/zip', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg' };

async function handleHttp(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, 'ok');

    const mt = /^\/api\/rec\/([A-Za-z0-9]{6,20})(\/.*)?$/.exec(url.pathname);
    if (!mt) return send(res, 404, { error: 'Not found' });
    const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress;
    if (rateLimited(ip)) return send(res, 429, { error: 'Too many tries. Wait a few minutes and try again.' });
    const m = recordings.get(mt[1]);
    if (!m || !safeEq(url.searchParams.get('key'), m.key)) {
        badKeyHits.get(ip)?.push(Date.now()) ?? badKeyHits.set(ip, [Date.now()]);
        return send(res, 404, { error: 'This recording doesn\'t exist, has expired, or the link is wrong.' });
    }
    const rest = mt[2] || '';

    if (rest === '' && req.method === 'GET') return send(res, 200, publicInfo(m));
    if (rest === '' && req.method === 'DELETE') {
        if (!safeEq(url.searchParams.get('deleteKey'), m.deleteKey)) {
            badKeyHits.get(ip)?.push(Date.now()) ?? badKeyHits.set(ip, [Date.now()]);
            return send(res, 403, { error: 'That delete key isn\'t right. It\'s in the DM you got when the recording started.' });
        }
        if (isLive(m)) return send(res, 409, { error: 'Stop the recording first, then you can delete it.' });
        await deleteRecording(m.id);
        return send(res, 200, { ok: true });
    }
    if (rest === '/info.txt') return send(res, 200, infoText(m), { 'Content-Disposition': contentDisposition(`truebeast-${m.id}-info.txt`) });
    if (rest === '/avatars.zip') {
        const files = [];
        for (const t of m.tracks) {
            const r = await fetch(t.avatar).catch(() => null);
            if (r?.ok) files.push([`${trackFileBase(t)}.png`, Buffer.from(await r.arrayBuffer())]);
        }
        const dir = path.join(JOB_DIR, `av-${randomId(8)}`);
        await fsp.mkdir(dir, { recursive: true });
        const out = path.join(dir, 'avatars.zip');
        await zipDir(files, out);
        await serveFile(req, res, out, `truebeast-${m.id}-avatars.zip`, MIME.zip);
        res.on('close', () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {}));
        return;
    }
    if (rest === '/jobs' && req.method === 'POST') {
        let body;
        try { body = await readBody(req); } catch { return send(res, 400, { error: 'Bad request' }); }
        const container = CONTAINERS.includes(body.container) ? body.container : 'zip';
        let format = FORMATS[body.format] ? body.format : 'flac';
        if (container === 'aup' || container === 'sesx') format = 'flac';
        const all = m.tracks.map(t => t.track);
        const tracks = Array.isArray(body.tracks) ? [...new Set(body.tracks.map(Number))].filter(n => all.includes(n)).sort((a, b) => a - b) : all;
        if (!m.tracks.length) return send(res, 409, { error: 'Nobody has spoken yet, so there\'s nothing to download.' });
        if (!tracks.length) return send(res, 400, { error: 'Pick at least one person to include.' });
        if (queue.length >= 20) return send(res, 503, { error: 'Lots of downloads are being processed right now. Try again in a few minutes.' });
        const job = createJob(m, { format, container, tracks, normalize: !!body.normalize });
        return send(res, 200, jobView(job));
    }
    const jm = /^\/jobs\/([A-Za-z0-9]{12})(\/file|\/cancel)?$/.exec(rest);
    if (jm) {
        const job = jobs.get(jm[1]);
        if (!job || job.recId !== m.id) return send(res, 404, { error: 'That download expired. Start it again.' });
        if (!jm[2]) return send(res, 200, jobView(job));
        if (jm[2] === '/cancel' && req.method === 'POST') {
            if (job.state === 'queued') { queue.splice(queue.indexOf(job), 1); job.state = 'cancelled'; job.error = 'Cancelled'; }
            else if (job.state === 'running') job.abort.abort();
            return send(res, 200, jobView(job));
        }
        if (jm[2] === '/file') {
            if (job.state !== 'done' || !fs.existsSync(job.file)) return send(res, 409, { error: 'Not ready yet.' });
            const ext = job.fileName.split('.').pop();
            return serveFile(req, res, job.file, job.fileName, MIME[ext] || 'application/octet-stream');
        }
    }
    return send(res, 404, { error: 'Not found' });
}

function startHttp() {
    const server = http.createServer((req, res) => {
        handleHttp(req, res).catch(e => {
            console.error('[Recorder] http error:', e.message);
            if (!res.headersSent) send(res, 500, { error: 'Server error, try again.' }); else res.destroy();
        });
    });
    server.on('error', e => console.error('[Recorder] http server error:', e.message));
    server.listen(PORT, '0.0.0.0', () => console.log(`[Recorder] HTTP API on :${PORT} (${PUBLIC_API})`));
}

// ── Startup / shutdown ──────────────────────────────────────────────────────
async function loadRecordings() {
    await fsp.mkdir(REC_DIR, { recursive: true });
    for (const id of await fsp.readdir(REC_DIR)) {
        try { recordings.set(id, JSON.parse(await fsp.readFile(metaPath(id), 'utf8'))); }
        catch (e) { console.error(`[Recorder] skipping unreadable recording ${id}:`, e.message); }
    }
}

async function expireOld() {
    for (const m of recordings.values()) {
        if (!isLive(m) && m.expiresAt && m.expiresAt < Date.now()) {
            console.log(`[Recorder] Expired ${m.id}`);
            await deleteRecording(m.id).catch(e => console.error('[Recorder] expire failed:', e.message));
        }
    }
    await cleanJobs();
}

// Recordings still marked live came from before a restart: pick them back up if anyone's there
async function resumeInterrupted() {
    for (const m of recordings.values()) {
        if (!isLive(m)) continue;
        const guild = client.guilds.cache.get(m.guildId);
        const channel = guild?.channels.cache.get(m.channelId);
        const rt = newRuntime(m);
        rt.stopping = true; // nothing is recorded until we're connected again
        const gapFrom = m.interruptedAt || m.lastAliveAt || Date.now();
        const tooOld = Date.now() - m.startedAt >= MAX_HOURS * HOUR - MIN;
        const ruleOk = !m.auto || (settings.auto[m.ruleChannelId] && ruleMatches(settings.auto[m.ruleChannelId], channel));
        if (!guild || !channel || tooOld || !humansIn(channel).size || !ruleOk || active.has(guild.id)) {
            rt.stopping = false;
            // end at the last moment we were alive, so the downtime isn't padded on as silence
            await stopRecording(rt, tooOld ? `Reached the ${MAX_HOURS}-hour limit.` : 'The bot restarted and nobody was left in the channel.', null, gapFrom);
            continue;
        }
        active.set(guild.id, rt);
        try {
            await setRecordingNick(guild, true, m.prevNick);
            await connect(rt, channel);
            rt.stopping = false;
            m.restarts = [...(m.restarts || []), { from: gapFrom, to: Date.now() }];
            delete m.interruptedAt;
            startTicker(rt);
            logEvent(rt, `♻️ I restarted for an update and picked the recording back up (${fmtDuration(Date.now() - gapFrom)} gap, filled with silence).`);
            await writeMeta(m);
            renderPanel(rt);
            console.log(`[Recorder] Resumed ${m.id} after ${fmtDuration(Date.now() - gapFrom)}`);
        } catch (e) {
            console.error(`[Recorder] resume of ${m.id} failed:`, e.message);
            rt.stopping = false;
            await stopRecording(rt, 'The bot restarted and couldn\'t rejoin the channel.');
        }
    }
}

async function startRecorder(discordClient, { modRoleId: mod, ownerId: owner }) {
    client = discordClient;
    modRoleId = mod || null;
    ownerId = owner || null;
    await fsp.mkdir(JOB_DIR, { recursive: true });
    for (const d of await fsp.readdir(JOB_DIR)) await fsp.rm(path.join(JOB_DIR, d), { recursive: true, force: true }).catch(() => {}); // jobs don't survive restarts
    startHttp();
    await loadRecordings();

    let state = null;
    for (let attempt = 1; attempt <= 5 && !state; attempt++) {
        state = await loadState().catch(e => { console.error(`[Recorder] load failed (attempt ${attempt}):`, e.message); return null; });
        if (!state) await new Promise(r => setTimeout(r, 30 * SEC));
    }
    if (!state) { console.error('[Recorder] giving up on settings load — recorder stays off until restart'); return; }
    try { settings = { ...settings, ...JSON.parse(state.settingsJson || '{}') }; } catch (_) {}
    loaded = true;
    console.log(`[Recorder] Ready: ${recordings.size} recording(s) on disk, ${Object.keys(settings.auto).length} auto-record rule(s), storage at ${DATA_DIR}`);

    client.on('voiceStateUpdate', (o, n) => { try { onVoiceStateUpdate(o, n); } catch (e) { console.error('[Recorder] voiceStateUpdate failed:', e.message); } });
    await resumeInterrupted().catch(e => console.error('[Recorder] resume failed:', e.message));
    for (const chId of Object.keys(settings.auto)) queueAutoCheck(chId, 5 * SEC);
    setInterval(() => expireOld().catch(e => console.error('[Recorder] cleanup failed:', e.message)), 15 * MIN);
    expireOld().catch(() => {});
}

// SIGTERM: keep live recordings marked live so the next boot resumes them
async function flushRecorder() {
    shuttingDown = true;
    if (loaded) await saveState();
    await Promise.all([...active.values()].map(async rt => {
        if (rt.stopping) return;
        rt.stopping = true;
        clearInterval(rt.tick);
        clearTimeout(rt.metaTimer);
        rt.meta.interruptedAt = Date.now();
        rt.meta.log.push({ t: Date.now(), text: '♻️ I\'m restarting for an update. I\'ll pick the recording back up in a moment.' });
        try { rt.connection?.destroy(); } catch (_) {}
        await Promise.all([...rt.tracks.values()].map(t => new Promise(r => t.file.end(r))));
        await writeMeta(rt.meta).catch(e => console.error('[Recorder] shutdown meta write failed:', e.message));
        rt.stopping = false; // let the panel render as live
        clearTimeout(rt.panelTimer);
        await Promise.race([renderPanel(rt), new Promise(r => setTimeout(r, 3 * SEC))]);
        rt.stopping = true;
    }));
}

module.exports = {
    recorderCommands, isRecorderCommand, handleRecorderCommand,
    isRecorderInteraction, handleRecorderInteraction, startRecorder, flushRecorder,
};
