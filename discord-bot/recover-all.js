// Full data recovery — merges ALL backup sources and restores to primary Firestore collections
// Takes the MAX value across every source — never reduces anyone's data
// Run: node recover-all.js
//
// Sources (in priority order, highest first):
//   1. Discord backup channel JSON  — beast-bot-backup.json saved every 60s (most current)
//   2. botConfig/voiceBackup        — Firestore voice backup
//   3. botConfig/rankAchBackup      — Firestore rank achievement backup
//   4. botConfig/messageBackup      — Firestore message backup
//   5. Primary collections          — voiceMinutes, rankAchievements, messageCounts

require('dotenv').config();

const PROJECT        = process.env.FIREBASE_PROJECT_ID;
const API_KEY        = process.env.FIREBASE_API_KEY;
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const BACKUP_CHANNEL = process.env.BACKUP_CHANNEL_ID || '1490542501302636726';

if (!PROJECT || !API_KEY) { console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function fmt(mins) { return `${Math.floor(mins / 60)}h ${mins % 60}m`; }

// ── Discord helpers ───────────────────────────────────────────────────────────

async function fetchDiscordBackup() {
    if (!BOT_TOKEN) { console.log('  ⚠️  DISCORD_BOT_TOKEN not set — skipping Discord backup'); return null; }
    try {
        const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages?limit=10`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });
        if (!res.ok) { console.log(`  ⚠️  Discord channel fetch failed: ${res.status}`); return null; }
        const msgs = await res.json();
        for (const msg of msgs) {
            const att = (msg.attachments || []).find(a => a.filename === 'beast-bot-backup.json');
            if (!att) continue;
            const fileRes = await fetch(att.url);
            if (!fileRes.ok) { console.log(`  ⚠️  Discord attachment download failed: ${fileRes.status}`); return null; }
            const data = await fileRes.json();
            console.log(`  Discord backup saved at: ${data.savedAt}`);
            console.log(`    voiceMinutes:     ${Object.keys(data.voiceMinutes    || {}).length} users`);
            console.log(`    rankAchievements: ${Object.keys(data.rankAchievements|| {}).length} users`);
            console.log(`    messageDays:      ${Object.keys(data.messageDays     || {}).length} users`);
            return data;
        }
        console.log('  ⚠️  No beast-bot-backup.json found in recent Discord messages');
        return null;
    } catch (e) {
        console.log(`  ⚠️  Discord backup fetch error: ${e.message}`);
        return null;
    }
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function get(path) {
    const res = await fetch(`${BASE}/${path}?key=${API_KEY}`);
    if (!res.ok) { console.error(`GET ${path} → ${res.status} ${await res.text()}`); return null; }
    return res.json();
}

async function list(collection) {
    const docs = [];
    let token = null;
    do {
        let url = `${BASE}/${collection}?key=${API_KEY}&pageSize=300`;
        if (token) url += `&pageToken=${token}`;
        const res = await fetch(url);
        if (!res.ok) { console.error(`LIST ${collection} → ${res.status}`); break; }
        const data = await res.json();
        for (const d of (data.documents || [])) docs.push(d);
        token = data.nextPageToken || null;
    } while (token);
    return docs;
}

async function patchVoice(uid, total, days) {
    const dayFields = {};
    for (const [k, v] of Object.entries(days)) dayFields[k] = { integerValue: String(Math.floor(v)) };
    const url = `${BASE}/voiceMinutes/${uid}?key=${API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
            total: { integerValue: String(total) },
            days:  { mapValue: { fields: dayFields } },
        }}),
    });
    return res.ok;
}

async function patchRankAch(uid, highestRankIdx, apexCount) {
    const url = `${BASE}/rankAchievements/${uid}?key=${API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
            highestRankIdx: { integerValue: String(highestRankIdx) },
            apexCount:      { integerValue: String(apexCount) },
        }}),
    });
    return res.ok;
}

async function patchMessageDays(uid, days) {
    const dayFields = {};
    for (const [k, v] of Object.entries(days)) dayFields[k] = { integerValue: String(v) };
    const url = `${BASE}/messageCounts/${uid}?key=${API_KEY}&updateMask.fieldPaths=days`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { days: { mapValue: { fields: dayFields } } } }),
    });
    return res.ok;
}

// ── Merge helper: takes max per day across any number of day-map objects ──────

function mergeDays(...dayMaps) {
    const result = {};
    for (const map of dayMaps) {
        for (const [day, val] of Object.entries(map || {})) {
            if (val > (result[day] || 0)) result[day] = val;
        }
    }
    return result;
}

const RANK_NAMES = ['🥉 Bronze I','🥉 Bronze II','🥈 Silver I','🥈 Silver II','🥇 Gold I','🥇 Gold II','💠 Platinum','💎 Diamond','🔥 Master','⚔️ Grandmaster','👑 Apex Predator'];

async function main() {
    console.log('=== TrueBeast Full Data Recovery ===\n');

    // ── 1. Discord backup (most current — saved every 60s) ────────────────────
    console.log('Reading Discord backup...');
    const discordData = await fetchDiscordBackup();
    const discordVoice   = discordData?.voiceMinutes     || {};
    const discordRankAch = discordData?.rankAchievements || {};
    const discordMsgDays = discordData?.messageDays      || {};
    console.log();

    // ── 2. Firestore backup docs ──────────────────────────────────────────────
    console.log('Reading Firestore backup documents...');

    const voiceBackupDoc   = await get('botConfig/voiceBackup');
    const rankAchBackupDoc = await get('botConfig/rankAchBackup');
    const msgBackupDoc     = await get('botConfig/messageBackup');

    const voiceBackup   = voiceBackupDoc?.fields?.data?.stringValue   ? JSON.parse(voiceBackupDoc.fields.data.stringValue)   : {};
    const rankAchBackup = rankAchBackupDoc?.fields?.data?.stringValue ? JSON.parse(rankAchBackupDoc.fields.data.stringValue) : {};
    const msgBackup     = msgBackupDoc?.fields?.data?.stringValue     ? JSON.parse(msgBackupDoc.fields.data.stringValue)     : {};

    console.log(`  voiceBackup:   ${Object.keys(voiceBackup).length} users (saved at: ${voiceBackupDoc?.fields?.savedAt?.stringValue || 'unknown'})`);
    console.log(`  rankAchBackup: ${Object.keys(rankAchBackup).length} users (saved at: ${rankAchBackupDoc?.fields?.savedAt?.stringValue || 'unknown'})`);
    console.log(`  messageBackup: ${Object.keys(msgBackup).length} users\n`);

    // ── 3. Primary Firestore collections ──────────────────────────────────────
    console.log('Reading primary Firestore collections...');

    const vmDocs  = await list('voiceMinutes');
    const raDocs  = await list('rankAchievements');
    const mcDocs  = await list('messageCounts');

    const primaryVoice = {};
    for (const d of vmDocs) {
        const uid   = d.name.split('/').pop();
        const total = parseInt(d.fields?.total?.integerValue || '0', 10);
        const days  = {};
        for (const [k, v] of Object.entries(d.fields?.days?.mapValue?.fields || {})) days[k] = parseInt(v.integerValue || '0', 10);
        primaryVoice[uid] = { total, days };
    }

    const primaryRankAch = {};
    for (const d of raDocs) {
        const uid            = d.name.split('/').pop();
        const highestRankIdx = parseInt(d.fields?.highestRankIdx?.integerValue || '0', 10);
        const apexCount      = parseInt(d.fields?.apexCount?.integerValue      || '0', 10);
        primaryRankAch[uid] = { highestRankIdx, apexCount };
    }

    const primaryMsgDays = {};
    for (const d of mcDocs) {
        const uid  = d.name.split('/').pop();
        const days = {};
        for (const [k, v] of Object.entries(d.fields?.days?.mapValue?.fields || {})) days[k] = parseInt(v.integerValue || '0', 10);
        primaryMsgDays[uid] = days;
    }

    console.log(`  voiceMinutes:     ${vmDocs.length} docs`);
    console.log(`  rankAchievements: ${raDocs.length} docs`);
    console.log(`  messageCounts:    ${mcDocs.length} docs\n`);

    // ── 4. Merge all sources: take MAX across Discord backup + Firestore backups + primary ──

    // Voice
    let voiceRestored = 0;
    console.log('=== Voice Minutes Recovery ===');
    const allVoiceUids = new Set([
        ...Object.keys(discordVoice),
        ...Object.keys(voiceBackup),
        ...Object.keys(primaryVoice),
    ]);
    for (const uid of allVoiceUids) {
        const discord = discordVoice[uid] || { total: 0, days: {} };
        const backup  = voiceBackup[uid]  || { total: 0, days: {} };
        const primary = primaryVoice[uid] || { total: 0, days: {} };
        const bestTotal = Math.max(discord.total, backup.total, primary.total);
        const bestDays  = mergeDays(primary.days, backup.days, discord.days);
        if (bestTotal > primary.total || JSON.stringify(bestDays) !== JSON.stringify(primary.days)) {
            const ok = await patchVoice(uid, bestTotal, bestDays);
            if (ok) {
                console.log(`  ✅ ${uid}: ${fmt(primary.total)} → ${fmt(bestTotal)}`);
                voiceRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${fmt(primary.total)} — already correct`);
        }
    }

    // Rank achievements
    let rankRestored = 0;
    console.log('\n=== Rank Achievement Recovery ===');
    const allRankUids = new Set([
        ...Object.keys(discordRankAch),
        ...Object.keys(rankAchBackup),
        ...Object.keys(primaryRankAch),
    ]);
    for (const uid of allRankUids) {
        const discord = discordRankAch[uid] || { highestRankIdx: 0, apexCount: 0 };
        const backup  = rankAchBackup[uid]  || { highestRankIdx: 0, apexCount: 0 };
        const primary = primaryRankAch[uid] || { highestRankIdx: 0, apexCount: 0 };
        const bestIdx  = Math.max(discord.highestRankIdx, backup.highestRankIdx, primary.highestRankIdx);
        const bestApex = Math.max(discord.apexCount,      backup.apexCount,      primary.apexCount);
        if (bestIdx > primary.highestRankIdx || bestApex > primary.apexCount) {
            const ok = await patchRankAch(uid, bestIdx, bestApex);
            if (ok) {
                console.log(`  ✅ ${uid}: ${RANK_NAMES[primary.highestRankIdx] || '?'} → ${RANK_NAMES[bestIdx] || '?'} (apex: ${bestApex})`);
                rankRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${RANK_NAMES[primary.highestRankIdx] || '?'} — already correct`);
        }
    }

    // Message days
    let msgRestored = 0;
    console.log('\n=== Message Count Recovery ===');
    const allMsgUids = new Set([
        ...Object.keys(discordMsgDays),
        ...Object.keys(msgBackup),
        ...Object.keys(primaryMsgDays),
    ]);
    for (const uid of allMsgUids) {
        const primary  = primaryMsgDays[uid] || {};
        const bestDays = mergeDays(primary, msgBackup[uid] || {}, discordMsgDays[uid] || {});
        const primaryTotal = Object.values(primary).reduce((a, b) => a + b, 0);
        const bestTotal    = Object.values(bestDays).reduce((a, b) => a + b, 0);
        if (JSON.stringify(bestDays) !== JSON.stringify(primary)) {
            const ok = await patchMessageDays(uid, bestDays);
            if (ok) {
                console.log(`  ✅ ${uid}: ${primaryTotal} → ${bestTotal} messages`);
                msgRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${primaryTotal} messages — already correct`);
        }
    }

    console.log('\n=== Recovery Complete ===');
    console.log(`  Voice restored:    ${voiceRestored} users`);
    console.log(`  Rank ach restored: ${rankRestored} users`);
    console.log(`  Messages restored: ${msgRestored} users`);
    console.log('\nDone. Restart Beast Bot to reload the restored data.');
}

main().catch(e => { console.error(e); process.exit(1); });
