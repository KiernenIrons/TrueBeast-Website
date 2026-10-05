/**
 * Voice Streaks — Study-Stream-style daily voice streaks.
 *
 * Rules:
 *  - Spend STREAK_GOAL_MINUTES (30) in any XP-eligible voice channel during your local
 *    calendar day and that day counts. Minutes add up across multiple sessions.
 *  - Days roll over at each member's own midnight (default Europe/London, changeable
 *    with /streak-settings timezone).
 *  - Miss a day → a streak freeze is used automatically if you have one, otherwise the
 *    streak resets. Freezes: start with 1, earn +1 every 7 streak days, hold up to 3.
 *  - Days on which the bot was offline for a while are forgiven automatically (no freeze
 *    used) — you can't be punished for time we couldn't track.
 *
 * Self-contained like pond.js: index.js wires it up via initStreaks() and calls
 * streakTick() from its 60s voice tick. Persistence piggybacks on the main backup
 * (serializeStreaks/restoreStreaks) plus a Firestore mirror at botConfig/voiceStreaks.
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const STREAK_GOAL_MINUTES   = 30;
const FREEZE_EVERY_DAYS     = 7;
const MAX_FREEZES           = 3;
const STARTING_FREEZES      = 1;
const DEFAULT_TZ            = 'Europe/London';
const REMINDER_BEFORE_MS    = 3 * 60 * 60 * 1000; // DM reminder 3h before local midnight
const OUTAGE_MIN_MS         = 10 * 60 * 1000;     // downtime shorter than this isn't "an outage"
const HISTORY_KEEP_DAYS     = 45;
const SWEEP_INTERVAL_MS     = 5 * 60 * 1000;
const MIRROR_DOC            = 'voiceStreaks';      // botConfig/voiceStreaks
const MILESTONES            = new Set([3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365, 500, 730, 1000]);
const DAY_MS                = 24 * 60 * 60 * 1000;

const streaks = new Map(); // userId → streak record (see newRecord)
let outages   = [];        // [{ from, to }] — bot downtime windows, last ~45 days
let _loaded   = false;     // guards the Firestore mirror so an empty state never overwrites real data
let _dirty    = false;
let _lastMirrorSave = 0;
let ctx       = null;      // { client, getGuild, firestoreGet, firestoreSet, isModerator, isEnabled }

// ── Time-zone helpers ─────────────────────────────────────────────────────────

const _dayFormatters = new Map();
function dayFormatter(tz) {
    let f = _dayFormatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        _dayFormatters.set(tz, f);
    }
    return f;
}

function isValidTimeZone(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// "YYYY-MM-DD" for the given instant in the given zone
function localDay(ms, tz) {
    try { return dayFormatter(tz).format(new Date(ms)); } catch { return dayFormatter('UTC').format(new Date(ms)); }
}

// Pure calendar arithmetic on "YYYY-MM-DD" strings
function addDays(day, n) {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

// UTC offset (ms) of a zone at a given instant
function tzOffsetMs(tz, ms) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(new Date(ms));
        const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
        const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        return asUtc - Math.floor(ms / 1000) * 1000;
    } catch { return 0; }
}

// Instant (ms) of local midnight at the start of `day` in `tz`
function localMidnightMs(day, tz) {
    const guess = new Date(day + 'T00:00:00Z').getTime();
    let ms = guess - tzOffsetMs(tz, guess);
    ms = guess - tzOffsetMs(tz, ms); // second pass settles DST transitions
    return ms;
}

function formatOffset(tz, ms = Date.now()) {
    const mins = Math.round(tzOffsetMs(tz, ms) / 60000);
    const sign = mins >= 0 ? '+' : '-';
    const abs  = Math.abs(mins);
    return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`;
}

function localTimeLabel(tz, ms = Date.now()) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); }
    catch { return '??:??'; }
}

// ── Records ───────────────────────────────────────────────────────────────────

function newRecord() {
    return {
        tz:           DEFAULT_TZ,
        current:      0,
        best:         0,
        totalDays:    0,
        freezes:      STARTING_FREEZES,
        history:      {},   // "YYYY-MM-DD" → 'd' (done) | 'f' (freeze used) | 'g' (outage grace)
        progressDay:  null,
        progressMins: 0,
        lastSettled:  null, // last local day whose outcome has been decided
        reminders:    true, // DMs: evening reminder, freeze used, streak lost
        celebrate:    true, // VC-chat message when the daily goal is hit
        remindedDay:  null,
        lastLost:     null, // { count, day } — lets mods undo a loss with /streak-admin restore
        tzChangedAt:  0,
    };
}

function normalizeRecord(r) {
    const base = newRecord();
    const out = { ...base, ...(r || {}) };
    if (!isValidTimeZone(out.tz)) out.tz = DEFAULT_TZ;
    if (typeof out.history !== 'object' || !out.history) out.history = {};
    for (const k of ['current', 'best', 'totalDays', 'freezes', 'progressMins', 'tzChangedAt']) out[k] = Number(out[k]) || 0;
    out.freezes = Math.min(Math.max(out.freezes, 0), MAX_FREEZES);
    return out;
}

function getRecord(uid, create = false) {
    let r = streaks.get(uid);
    if (!r && create) { r = newRecord(); streaks.set(uid, r); _dirty = true; }
    return r || null;
}

function trimHistory(r, today) {
    const cutoff = addDays(today, -HISTORY_KEEP_DAYS);
    for (const k of Object.keys(r.history)) if (k < cutoff) delete r.history[k];
}

function dayHadOutage(day, tz) {
    if (!outages.length) return false;
    const start = localMidnightMs(day, tz);
    const end   = localMidnightMs(addDays(day, 1), tz);
    return outages.some(o => Math.min(o.to, end) - Math.max(o.from, start) >= OUTAGE_MIN_MS);
}

// Decides the outcome of every finished day since the last check. Returns events for DMs.
function settle(r, now = Date.now()) {
    const today     = localDay(now, r.tz);
    const yesterday = addDays(today, -1);
    if (!r.lastSettled) { r.lastSettled = yesterday; return []; }
    if (r.lastSettled >= yesterday) return [];

    const events = [];
    let d = addDays(r.lastSettled, 1);
    for (let guard = 0; d <= yesterday && guard < 800; guard++, d = addDays(d, 1)) {
        if (r.history[d]) continue;          // already done / frozen / forgiven
        if (r.current <= 0) continue;        // nothing to protect — never burn freezes on a 0 streak
        if (dayHadOutage(d, r.tz)) {
            r.history[d] = 'g';
            events.push({ type: 'grace', day: d });
        } else if (r.freezes > 0) {
            r.freezes--;
            r.history[d] = 'f';
            events.push({ type: 'freeze', day: d, freezesLeft: r.freezes, streak: r.current });
        } else {
            r.lastLost = { count: r.current, day: d };
            events.push({ type: 'lost', day: d, count: r.current });
            r.current = 0;
        }
    }
    r.lastSettled = yesterday;
    trimHistory(r, today);
    _dirty = true;
    return events;
}

// ── Display helpers ───────────────────────────────────────────────────────────

function progressBar(mins, goal = STREAK_GOAL_MINUTES, size = 10) {
    const filled = Math.min(size, Math.floor((Math.min(mins, goal) / goal) * size));
    return '🟧'.repeat(filled) + '⬛'.repeat(size - filled);
}

function freezeIcons(n) {
    return '❄️'.repeat(n) + '▫️'.repeat(Math.max(0, MAX_FREEZES - n));
}

function todayMinutes(r, today) {
    return r.progressDay === today ? r.progressMins : 0;
}

function calendarRows(r, today) {
    const cells = [];
    for (let i = 13; i >= 0; i--) {
        const d = addDays(today, -i);
        const h = r.history[d];
        if (i === 0)        cells.push(h === 'd' ? '🔥' : '⏳');
        else if (h === 'd') cells.push('🔥');
        else if (h === 'f') cells.push('🧊');
        else if (h === 'g') cells.push('🛡️');
        else                cells.push('⬛');
    }
    return cells.slice(0, 7).join('') + '\n' + cells.slice(7).join('');
}

function daysToNextFreeze(r) {
    if (r.freezes >= MAX_FREEZES) return null;
    const into = r.current % FREEZE_EVERY_DAYS;
    return FREEZE_EVERY_DAYS - into;
}

function flameFor(n) {
    if (n >= 365) return '🌋';
    if (n >= 100) return '☄️';
    if (n >= 30)  return '💥';
    if (n >= 7)   return '🔥';
    return n > 0 ? '🔥' : '🕯️';
}

function buildStreakEmbed(user, r, now = Date.now()) {
    const today     = localDay(now, r.tz);
    const doneToday = r.history[today] === 'd';
    const mins      = todayMinutes(r, today);
    const resetAt   = Math.floor(localMidnightMs(addDays(today, 1), r.tz) / 1000);

    let todayLine;
    if (doneToday) {
        todayLine = `✅ **Done for today!** (${mins} min in voice)\nNext day starts <t:${resetAt}:R>`;
    } else {
        const left = STREAK_GOAL_MINUTES - mins;
        todayLine = `${progressBar(mins)} **${mins}/${STREAK_GOAL_MINUTES} min**\n` +
            (r.current > 0
                ? `⏳ **${left} more min** in voice to keep your streak — day ends <t:${resetAt}:R>`
                : `Spend **${left} more min** in voice to ${r.best > 0 ? 'start a new' : 'start your first'} streak — day ends <t:${resetAt}:R>`);
    }

    const next = daysToNextFreeze(r);
    const freezeLine = `${freezeIcons(r.freezes)}  **${r.freezes}/${MAX_FREEZES}**` +
        (next ? ` · next one in **${next} streak day${next === 1 ? '' : 's'}**` : ' · full!');

    const title = r.current > 0
        ? `${flameFor(r.current)} ${r.current}-day streak${doneToday ? '' : ' — keep it alive today!'}`
        : `${flameFor(0)} No active streak${r.best > 0 ? ' — time for a comeback!' : ''}`;

    return {
        color: r.current > 0 ? (doneToday ? 0xF97316 : 0xFACC15) : 0x6B7280,
        author: { name: `${user.displayName ?? user.username}'s voice streak`, icon_url: user.displayAvatarURL?.({ size: 128 }) },
        title,
        fields: [
            { name: '📅 Today', value: todayLine, inline: false },
            { name: '🏆 Best streak', value: `${r.best} day${r.best === 1 ? '' : 's'}`, inline: true },
            { name: '📈 Total streak days', value: String(r.totalDays), inline: true },
            { name: '🧊 Streak freezes', value: freezeLine, inline: false },
            { name: 'Last 14 days', value: calendarRows(r, today) + '\n-# 🔥 goal hit · 🧊 freeze used · 🛡️ bot-outage day (free) · ⬛ missed · ⏳ today', inline: false },
        ],
        footer: { text: `Goal: ${STREAK_GOAL_MINUTES} min in voice per day · Timezone: ${r.tz} (${formatOffset(r.tz, now)})` },
    };
}

function cardButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('streak:help').setLabel('How streaks work').setEmoji('❓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('streak:settings').setLabel('My settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    );
}

const HELP_TEXT = [
    `## 🔥 How voice streaks work`,
    `**1.** Spend **${STREAK_GOAL_MINUTES} minutes** in any voice channel in a day — it can be split across as many sessions as you like.`,
    `**2.** Do it again tomorrow and your streak grows. Days reset at **your** midnight — set your timezone with \`/streak-settings timezone\`.`,
    `**3.** Miss a day? A **🧊 streak freeze** is used automatically and your streak survives.`,
    `**4.** You start with **${STARTING_FREEZES}** freeze and earn **+1 every ${FREEZE_EVERY_DAYS} streak days** (hold up to ${MAX_FREEZES}).`,
    `**5.** No freezes left and you miss a day → the streak resets, but your **best streak** is kept forever — and your next streak starts with a fresh freeze.`,
    ``,
    `🛡️ If the bot is ever offline for a while, that day is **forgiven automatically** — no freeze used.`,
    `🔔 You'll get a friendly DM ~3h before midnight if your streak is at risk. Turn that off with \`/streak-settings reminders:False\`.`,
    `-# Time in the AFK channel doesn't count. \`/streak-leaderboard\` shows the longest active streaks.`,
].join('\n');

function settingsPanel(r) {
    return {
        content: [
            `### ⚙️ Your streak settings`,
            `🌍 **Timezone:** \`${r.tz}\` — it's **${localTimeLabel(r.tz)}** there (${formatOffset(r.tz)}). Change with \`/streak-settings timezone\`.`,
            `🔔 **Reminder & streak DMs:** ${r.reminders ? 'On' : 'Off'}`,
            `🎉 **Celebrate in voice chat when I hit my goal:** ${r.celebrate ? 'On' : 'Off'}`,
        ].join('\n'),
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('streak:toggle:reminders')
                .setLabel(r.reminders ? 'Turn off DMs' : 'Turn on DMs').setEmoji(r.reminders ? '🔕' : '🔔')
                .setStyle(r.reminders ? ButtonStyle.Secondary : ButtonStyle.Success),
            new ButtonBuilder().setCustomId('streak:toggle:celebrate')
                .setLabel(r.celebrate ? 'Turn off celebrations' : 'Turn on celebrations').setEmoji('🎉')
                .setStyle(r.celebrate ? ButtonStyle.Secondary : ButtonStyle.Success),
        )],
    };
}

function dmOffButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('streak:dmoff').setLabel('Stop streak DMs').setEmoji('🔕').setStyle(ButtonStyle.Secondary),
    );
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function sendDm(uid, payload) {
    try {
        const guild = ctx.getGuild();
        if (guild && !guild.members.cache.has(uid)) return; // left the server — leave them alone
        const user = await ctx.client.users.fetch(uid);
        await user.send({ ...payload, components: [dmOffButton()] });
    } catch (_) { /* DMs closed — nothing to do */ }
}

async function handleSettleEvents(uid, r, events) {
    if (!events.length || !r.reminders) return;
    // Several missed days at once (e.g. after a long break) → one DM, not a pile of them
    const freezesUsed = events.filter(e => e.type === 'freeze');
    const lost        = events.find(e => e.type === 'lost');
    if (lost) {
        const usedNote = freezesUsed.length ? ` (after using ${freezesUsed.length} freeze${freezesUsed.length === 1 ? '' : 's'})` : '';
        await sendDm(uid, { content:
            `💔 Your **${lost.count}-day** voice streak ended${usedNote}.\n` +
            `Your best is still **${r.best} days** — hop into voice for **${STREAK_GOAL_MINUTES} min** to start a fresh one. You've got this! 💪`,
        });
    } else if (freezesUsed.length) {
        await sendDm(uid, { content:
            `🧊 You missed ${freezesUsed.length === 1 ? 'a day' : `${freezesUsed.length} days`}, so ${freezesUsed.length === 1 ? 'a streak freeze was' : 'streak freezes were'} used — your **${r.current}-day streak is safe!**\n` +
            `Freezes left: ${freezeIcons(r.freezes)} **${r.freezes}/${MAX_FREEZES}**. Spend ${STREAK_GOAL_MINUTES} min in voice today to keep it going.`,
        });
    }
}

async function celebrate(member, r, { earnedFreeze }) {
    if (!r.celebrate) return;
    const channel = member.voice?.channel;
    if (!channel?.isTextBased?.()) return;
    const n = r.current;
    let line;
    if (n === 1 && r.totalDays === 1) {
        line = `🔥 <@${member.id}> just started their **first voice streak!** Come back tomorrow for day 2.\n-# Tip: set your timezone with \`/streak-settings\` so your day resets at your midnight.`;
    } else if (n === 1) {
        line = `🔥 <@${member.id}> started a new voice streak — **day 1!**`;
    } else if (MILESTONES.has(n)) {
        line = `${flameFor(n)} **MILESTONE!** <@${member.id}> hit a **${n}-day voice streak!** 🎉`;
    } else {
        line = `🔥 <@${member.id}> kept their streak alive — **day ${n}!**`;
    }
    if (earnedFreeze) line += `\n🧊 +1 streak freeze earned (${r.freezes}/${MAX_FREEZES})`;
    await channel.send({ content: line, allowedMentions: { parse: [] } }).catch(() => {});
}

// ── Core: tick + sweep ────────────────────────────────────────────────────────

// Called every 60s from index.js with the users currently earning voice time.
async function streakTick(activeUserIds) {
    if (!_loaded || !ctx?.isEnabled()) return;
    const guild = ctx.getGuild();
    const now = Date.now();
    for (const uid of activeUserIds) {
        const member = guild?.members.cache.get(uid);
        if (member?.user?.bot) continue;
        const r = getRecord(uid, true);
        const events = settle(r, now);
        if (events.length) handleSettleEvents(uid, r, events).catch(() => {});

        const today = localDay(now, r.tz);
        if (r.progressDay !== today) { r.progressDay = today; r.progressMins = 0; }
        r.progressMins += 1;
        _dirty = true;

        if (r.history[today] === 'd' || r.progressMins < STREAK_GOAL_MINUTES) continue;

        // Goal hit for today
        r.history[today] = 'd';
        r.current   += 1;
        r.totalDays += 1;
        r.best       = Math.max(r.best, r.current);
        let earnedFreeze = false;
        if (r.current % FREEZE_EVERY_DAYS === 0 && r.freezes < MAX_FREEZES) { r.freezes += 1; earnedFreeze = true; }
        // Comeback safety net: every new streak starts with at least one freeze
        if (r.current === 1 && r.freezes < STARTING_FREEZES) { r.freezes = STARTING_FREEZES; earnedFreeze = r.totalDays > 1; }
        if (member) celebrate(member, r, { earnedFreeze }).catch(() => {});
    }
}

async function sweep() {
    if (!_loaded || !ctx?.isEnabled()) return;
    const now = Date.now();
    const activeIds = new Set(ctx.getActiveUserIds());
    for (const [uid, r] of streaks) {
        const events = settle(r, now);
        if (events.length) await handleSettleEvents(uid, r, events);

        // Prune records with nothing worth keeping (never streaked, idle for weeks, default settings)
        const idleSince = addDays(localDay(now, r.tz), -HISTORY_KEEP_DAYS);
        if (r.current === 0 && r.best === 0 && (!r.progressDay || r.progressDay < idleSince) &&
            r.tz === DEFAULT_TZ && r.reminders && r.celebrate && !activeIds.has(uid)) {
            streaks.delete(uid);
            _dirty = true;
            continue;
        }

        // Evening reminder: streak alive, today not done yet, not currently in voice, ~3h left
        if (!r.reminders || r.current <= 0 || activeIds.has(uid)) continue;
        const today = localDay(now, r.tz);
        if (r.history[today] === 'd' || r.remindedDay === today) continue;
        const midnight = localMidnightMs(addDays(today, 1), r.tz);
        const left = midnight - now;
        if (left > REMINDER_BEFORE_MS || left < 10 * 60 * 1000) continue;
        r.remindedDay = today;
        _dirty = true;
        const mins = todayMinutes(r, today);
        const hasFreeze = r.freezes > 0;
        await sendDm(uid, { content:
            `⏰ Your **${r.current}-day voice streak** ends <t:${Math.floor(midnight / 1000)}:R>!\n` +
            `Jump into a voice channel for **${STREAK_GOAL_MINUTES - mins} more minute${STREAK_GOAL_MINUTES - mins === 1 ? '' : 's'}** to keep it going 🔥` +
            (hasFreeze ? `\n-# No time today? Don't worry — one of your ${r.freezes} streak freeze${r.freezes === 1 ? '' : 's'} will cover it automatically.` : `\n-# You have no streak freezes left, so today counts!`),
        });
    }
    if (_dirty && now - _lastMirrorSave > SWEEP_INTERVAL_MS - 5000) await saveMirror();
}

// ── Persistence ───────────────────────────────────────────────────────────────

// Returns null until loaded, so an early backup can never persist an empty streak table.
function serializeStreaks() {
    if (!_loaded) return null;
    const users = {};
    for (const [uid, r] of streaks) users[uid] = r;
    return { savedAt: new Date().toISOString(), users, outages };
}

function restoreStreaks(data) {
    if (!data || typeof data !== 'object' || !data.users) return false;
    streaks.clear();
    for (const [uid, r] of Object.entries(data.users)) streaks.set(uid, normalizeRecord(r));
    outages = Array.isArray(data.outages) ? data.outages.filter(o => o && o.to > o.from) : [];
    return true;
}

async function saveMirror() {
    if (!_loaded || !ctx) return;
    try {
        const payload = serializeStreaks();
        const json = JSON.stringify(payload);
        if (json.length > 900_000) { console.warn(`[Streaks] mirror skipped — ${json.length} bytes is near Firestore's 1MB doc limit (main backup still has it)`); return; }
        await ctx.firestoreSet('botConfig', MIRROR_DOC, { data: json, savedAt: payload.savedAt });
        _lastMirrorSave = Date.now();
        _dirty = false;
    } catch (e) { console.error('[Streaks] mirror save failed:', e.message); }
}

/**
 * Called once after index.js has applied its main backup.
 * @param {object} deps
 * @param {object|null} backupStreaks  data.voiceStreaks from the main backup (may be null for old backups)
 * @param {string|null} backupSavedAt  savedAt of the main backup — used to detect downtime
 */
async function initStreaks(deps, backupStreaks, backupSavedAt) {
    ctx = deps;

    // Pick whichever copy is newer: the main backup or the Firestore mirror
    let source = 'none';
    let chosen = backupStreaks?.users ? backupStreaks : null;
    if (chosen) source = 'backup';
    try {
        const mirror = await ctx.firestoreGet('botConfig', MIRROR_DOC);
        if (mirror?.data) {
            const parsed = JSON.parse(mirror.data);
            const mirrorT = new Date(parsed.savedAt || 0).getTime();
            const backupT = new Date(chosen?.savedAt || 0).getTime();
            if (!chosen || mirrorT > backupT) { chosen = parsed; source = 'firestore'; }
        }
    } catch (e) { console.warn('[Streaks] mirror load failed:', e.message); }
    if (chosen) restoreStreaks(chosen);

    // Downtime → outage window, so nobody loses a streak over time we couldn't track
    const lastAlive = Math.max(
        new Date(backupSavedAt || 0).getTime(),
        new Date(chosen?.savedAt || 0).getTime(),
    );
    const now = Date.now();
    if (lastAlive > 0 && now - lastAlive >= OUTAGE_MIN_MS) {
        outages.push({ from: lastAlive, to: now });
        console.log(`[Streaks] 🛡️ Recorded ${Math.round((now - lastAlive) / 60000)} min of downtime as an outage window`);
    }
    outages = outages.filter(o => now - o.to < (HISTORY_KEEP_DAYS + 2) * DAY_MS);

    _loaded = true;
    console.log(`[Streaks] ✅ Loaded ${streaks.size} streak records from ${source}`);

    setTimeout(() => sweep().catch(e => console.error('[Streaks] sweep failed:', e.message)), 60 * 1000);
    setInterval(() => sweep().catch(e => console.error('[Streaks] sweep failed:', e.message)), SWEEP_INTERVAL_MS);
}

// ── Commands ──────────────────────────────────────────────────────────────────

const streakCommands = [
    new SlashCommandBuilder()
        .setName('streak')
        .setDescription(`Your daily voice streak — ${STREAK_GOAL_MINUTES} min in voice a day keeps it alive 🔥`)
        .addUserOption(o => o.setName('user').setDescription('Check someone else\'s streak')),
    new SlashCommandBuilder()
        .setName('streak-settings')
        .setDescription('Set your streak timezone and notification preferences')
        .addStringOption(o => o.setName('timezone').setDescription('Your timezone, e.g. "London" or "New York" — so your day resets at your midnight').setAutocomplete(true))
        .addBooleanOption(o => o.setName('reminders').setDescription('DM me when my streak is at risk / a freeze is used / it ends'))
        .addBooleanOption(o => o.setName('celebrations').setDescription('Post a message in voice chat when I hit my daily goal')),
    new SlashCommandBuilder()
        .setName('streak-leaderboard')
        .setDescription('The longest active voice streaks in the server'),
    new SlashCommandBuilder()
        .setName('streak-admin')
        .setDescription('(Mods) Manage someone\'s voice streak')
        .addSubcommand(s => s.setName('restore').setDescription('Undo the last time this member lost their streak')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
        .addSubcommand(s => s.setName('give-freeze').setDescription('Give streak freezes (max 3 held)')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
            .addIntegerOption(o => o.setName('amount').setDescription('How many (default 1)').setMinValue(1).setMaxValue(MAX_FREEZES)))
        .addSubcommand(s => s.setName('set').setDescription('Set a member\'s current streak (counts today as done)')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
            .addIntegerOption(o => o.setName('days').setDescription('Streak length').setRequired(true).setMinValue(0).setMaxValue(5000))),
];

const STREAK_COMMAND_NAMES = new Set(streakCommands.map(c => c.name));
function isStreakCommand(name) { return STREAK_COMMAND_NAMES.has(name); }
function isStreakButton(customId) { return customId?.startsWith('streak:'); }

const TZ_ALIASES = {
    uk: 'Europe/London', gb: 'Europe/London', england: 'Europe/London', scotland: 'Europe/London', wales: 'Europe/London',
    gmt: 'Europe/London', bst: 'Europe/London', ireland: 'Europe/Dublin',
    est: 'America/New_York', edt: 'America/New_York', eastern: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago', central: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver', mountain: 'America/Denver', arizona: 'America/Phoenix',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pacific: 'America/Los_Angeles', california: 'America/Los_Angeles',
    cet: 'Europe/Paris', cest: 'Europe/Paris', germany: 'Europe/Berlin', france: 'Europe/Paris', spain: 'Europe/Madrid',
    italy: 'Europe/Rome', netherlands: 'Europe/Amsterdam', poland: 'Europe/Warsaw', sweden: 'Europe/Stockholm',
    india: 'Asia/Kolkata', ist: 'Asia/Kolkata', japan: 'Asia/Tokyo', jst: 'Asia/Tokyo', korea: 'Asia/Seoul',
    china: 'Asia/Shanghai', philippines: 'Asia/Manila', singapore: 'Asia/Singapore', dubai: 'Asia/Dubai', uae: 'Asia/Dubai',
    aest: 'Australia/Sydney', australia: 'Australia/Sydney', nz: 'Pacific/Auckland', 'new zealand': 'Pacific/Auckland',
    brazil: 'America/Sao_Paulo', mexico: 'America/Mexico_City', canada: 'America/Toronto', toronto: 'America/Toronto',
    vancouver: 'America/Vancouver', 'south africa': 'Africa/Johannesburg', nigeria: 'Africa/Lagos', egypt: 'Africa/Cairo',
    turkey: 'Europe/Istanbul', russia: 'Europe/Moscow', utc: 'UTC',
};
const POPULAR_TZ = ['Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

let _allZones = null;
function allZones() {
    if (!_allZones) {
        try { _allZones = Intl.supportedValuesOf('timeZone'); } catch { _allZones = POPULAR_TZ; }
        if (!_allZones.includes('UTC')) _allZones = [..._allZones, 'UTC'];
    }
    return _allZones;
}

function resolveTimeZoneInput(input) {
    if (!input) return null;
    const raw = input.trim();
    if (raw.toUpperCase() === 'UTC') return 'UTC';
    if (raw.includes('/') && isValidTimeZone(raw)) return raw;
    const q = raw.toLowerCase();
    if (TZ_ALIASES[q]) return TZ_ALIASES[q];
    const norm = q.replace(/\s+/g, '_');
    return allZones().find(z => z.toLowerCase() === norm)
        ?? allZones().find(z => z.toLowerCase().endsWith('/' + norm))
        ?? allZones().find(z => z.toLowerCase().includes(norm))
        ?? null;
}

async function handleStreakAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'timezone') return interaction.respond([]);
    const q = String(focused.value || '').trim().toLowerCase();
    let zones;
    if (!q) {
        zones = POPULAR_TZ;
    } else {
        const norm = q.replace(/\s+/g, '_');
        const aliasHits = Object.entries(TZ_ALIASES).filter(([k]) => k.startsWith(q)).map(([, v]) => v);
        const matches = allZones().filter(z => z.toLowerCase().includes(norm));
        zones = [...new Set([...aliasHits, ...matches])];
    }
    const now = Date.now();
    await interaction.respond(zones.slice(0, 25).map(z => ({
        name: `${z.replace(/_/g, ' ')} — ${localTimeLabel(z, now)} (${formatOffset(z, now)})`.slice(0, 100),
        value: z,
    }))).catch(() => {});
}

async function handleStreakCommand(interaction) {
    if (!_loaded) {
        return interaction.reply({ content: '⏳ Streaks are still loading — try again in a few seconds.', flags: 64 });
    }
    const name = interaction.commandName;

    if (name === 'streak') {
        const target = interaction.options.getUser('user') || interaction.user;
        if (target.bot) return interaction.reply({ content: '🤖 Bots don\'t do streaks.', flags: 64 });
        const r = getRecord(target.id, target.id === interaction.user.id);
        if (!r) {
            return interaction.reply({ content: `**${target.username}** hasn't started a voice streak yet. Spend ${STREAK_GOAL_MINUTES} min in voice to start one! 🔥` });
        }
        const events = settle(r);
        if (events.length) handleSettleEvents(target.id, r, events).catch(() => {});
        const member = interaction.guild?.members.cache.get(target.id);
        return interaction.reply({ embeds: [buildStreakEmbed(member ?? target, r)], components: [cardButtons()] });
    }

    if (name === 'streak-settings') {
        const r = getRecord(interaction.user.id, true);
        settle(r); // lock in outcomes under the old timezone before changing it
        const changes = [];
        const tzInput = interaction.options.getString('timezone');
        if (tzInput) {
            const tz = resolveTimeZoneInput(tzInput);
            if (!tz) {
                return interaction.reply({ content: `❌ I couldn't find a timezone matching **${tzInput}**. Start typing a city (e.g. \`London\`, \`New York\`, \`Tokyo\`) and pick one from the list.`, flags: 64 });
            }
            if (tz !== r.tz) {
                const now = Date.now();
                const oldToday = localDay(now, r.tz);
                const newToday = localDay(now, tz);
                // Carry today's progress across so switching never costs anyone minutes
                if (r.progressDay === oldToday) r.progressDay = newToday;
                if (r.history[oldToday] === 'd' && !r.history[newToday]) { r.history[newToday] = 'd'; delete r.history[oldToday]; }
                r.lastSettled = addDays(newToday, -1) < r.lastSettled ? r.lastSettled : addDays(newToday, -1);
                r.tz = tz;
                r.tzChangedAt = now;
                changes.push(`🌍 Timezone set to **${tz}** — it's **${localTimeLabel(tz)}** there.`);
            }
        }
        const rem = interaction.options.getBoolean('reminders');
        if (rem !== null) { r.reminders = rem; changes.push(`🔔 Streak DMs **${rem ? 'on' : 'off'}**.`); }
        const cel = interaction.options.getBoolean('celebrations');
        if (cel !== null) { r.celebrate = cel; changes.push(`🎉 Voice-chat celebrations **${cel ? 'on' : 'off'}**.`); }
        _dirty = true;
        const panel = settingsPanel(r);
        if (changes.length) panel.content = `✅ ${changes.join('\n')}\n\n` + panel.content;
        return interaction.reply({ ...panel, flags: 64 });
    }

    if (name === 'streak-leaderboard') {
        const now = Date.now();
        for (const r of streaks.values()) settle(r, now);
        const guild = interaction.guild;
        const rows = [...streaks.entries()]
            .filter(([uid, r]) => r.current > 0 && (!guild || guild.members.cache.has(uid)))
            .sort((a, b) => b[1].current - a[1].current || b[1].best - a[1].best);
        if (!rows.length) {
            return interaction.reply({ content: `Nobody has an active voice streak yet — spend ${STREAK_GOAL_MINUTES} min in voice today to claim the #1 spot! 🔥` });
        }
        const medals = ['🥇', '🥈', '🥉'];
        const lines = rows.slice(0, 10).map(([uid, r], i) => {
            const today = localDay(now, r.tz);
            const status = r.history[today] === 'd' ? '✅' : '⏳';
            return `${medals[i] ?? `**${i + 1}.**`} <@${uid}> — ${flameFor(r.current)} **${r.current}** day${r.current === 1 ? '' : 's'} ${status} · best ${r.best}`;
        });
        const myIdx = rows.findIndex(([uid]) => uid === interaction.user.id);
        const allTimeBest = [...streaks.entries()].sort((a, b) => b[1].best - a[1].best)[0];
        const footerBits = [];
        if (myIdx >= 10) footerBits.push(`You're #${myIdx + 1} with ${rows[myIdx][1].current} days`);
        if (allTimeBest?.[1].best > 0) footerBits.push(`All-time record: ${allTimeBest[1].best} days`);
        return interaction.reply({
            embeds: [{
                color: 0xF97316,
                title: '🔥 Voice Streak Leaderboard',
                description: lines.join('\n') + `\n\n-# ✅ goal done today · ⏳ still to do · ${STREAK_GOAL_MINUTES} min in voice a day keeps a streak alive`,
                footer: footerBits.length ? { text: footerBits.join(' · ') } : undefined,
            }],
            allowedMentions: { parse: [] },
        });
    }

    if (name === 'streak-admin') {
        if (!ctx.isModerator(interaction)) return interaction.reply({ content: '❌ Mods only.', flags: 64 });
        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser('user');
        const r = getRecord(target.id, true);
        settle(r);
        const today = localDay(Date.now(), r.tz);

        if (sub === 'restore') {
            if (!r.lastLost) return interaction.reply({ content: `**${target.username}** has no lost streak to restore.`, flags: 64 });
            const { count, day } = r.lastLost;
            // Mark every missed day from the loss up to yesterday as forgiven so the restored
            // streak is continuous, and stack any new streak they've built since on top of it.
            for (let d = day; d < today; d = addDays(d, 1)) if (!r.history[d]) r.history[d] = 'g';
            r.current = count + r.current;
            r.best = Math.max(r.best, r.current);
            r.lastLost = null;
            _dirty = true;
            return interaction.reply({ content: `✅ Restored <@${target.id}>'s streak to **${r.current} days**.`, flags: 64 });
        }
        if (sub === 'give-freeze') {
            const amount = interaction.options.getInteger('amount') ?? 1;
            const before = r.freezes;
            r.freezes = Math.min(MAX_FREEZES, r.freezes + amount);
            _dirty = true;
            return interaction.reply({ content: `✅ <@${target.id}> now has **${r.freezes}/${MAX_FREEZES}** freezes (+${r.freezes - before}).`, flags: 64 });
        }
        if (sub === 'set') {
            const days = interaction.options.getInteger('days');
            r.current = days;
            if (days > 0) r.history[today] = 'd';
            r.best = Math.max(r.best, days);
            r.lastSettled = addDays(today, -1);
            _dirty = true;
            return interaction.reply({ content: `✅ <@${target.id}>'s streak is now **${days} days**${days > 0 ? ' (today counted as done)' : ''}.`, flags: 64 });
        }
    }
}

async function handleStreakButton(interaction) {
    const id = interaction.customId;
    if (id === 'streak:help') {
        return interaction.reply({ content: HELP_TEXT, flags: 64 });
    }
    if (!_loaded) return interaction.reply({ content: '⏳ Streaks are still loading — try again in a few seconds.', flags: 64 });

    const r = getRecord(interaction.user.id, true);
    if (id === 'streak:settings') {
        return interaction.reply({ ...settingsPanel(r), flags: 64 });
    }
    if (id === 'streak:toggle:reminders' || id === 'streak:toggle:celebrate') {
        const key = id.endsWith('reminders') ? 'reminders' : 'celebrate';
        r[key] = !r[key];
        _dirty = true;
        return interaction.update(settingsPanel(r));
    }
    if (id === 'streak:dmoff') {
        r.reminders = false;
        _dirty = true;
        return interaction.reply({ content: '🔕 Done — no more streak DMs. Your streak still counts as normal. Turn them back on any time with `/streak-settings reminders:True`.' });
    }
}

module.exports = {
    STREAK_GOAL_MINUTES,
    streakCommands,
    isStreakCommand,
    isStreakButton,
    handleStreakCommand,
    handleStreakAutocomplete,
    handleStreakButton,
    streakTick,
    initStreaks,
    serializeStreaks,
    saveStreakMirror: saveMirror,
    // exported for tests
    _internals: { settle, localDay, addDays, localMidnightMs, newRecord, resolveTimeZoneInput, buildStreakEmbed, streaks, setOutages: o => { outages = o; } },
};
