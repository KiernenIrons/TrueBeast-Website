// Emergency fix: overwrites Firestore with Discord backup data (SET, not ADD)
// The Discord backup is the source of truth — the running bot saves it every 60s
// Run: node fix-firestore.js

require('dotenv').config();

const PROJECT        = process.env.FIREBASE_PROJECT_ID;
const API_KEY        = process.env.FIREBASE_API_KEY;
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const BACKUP_CHANNEL = process.env.BACKUP_CHANNEL_ID || '1490542501302636726';

if (!PROJECT || !API_KEY) { console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY'); process.exit(1); }
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function fmt(mins) { return `${Math.floor(mins / 60)}h ${mins % 60}m`; }

async function fetchDiscordBackup() {
    const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages?limit=10`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Discord fetch failed: ${res.status}`);
    const msgs = await res.json();
    for (const msg of msgs) {
        const att = (msg.attachments || []).find(a => a.filename === 'beast-bot-backup.json');
        if (!att) continue;
        const fileRes = await fetch(att.url);
        if (!fileRes.ok) throw new Error(`Attachment download failed: ${fileRes.status}`);
        return fileRes.json();
    }
    throw new Error('No beast-bot-backup.json found');
}

async function setVoice(uid, total, days) {
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
    if (!res.ok) console.log(`     ❌ Firestore error: ${res.status}`);
    return res.ok;
}

async function setRankAch(uid, highestRankIdx, apexCount) {
    const url = `${BASE}/rankAchievements/${uid}?key=${API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
            highestRankIdx: { integerValue: String(highestRankIdx) },
            apexCount:      { integerValue: String(apexCount) },
        }}),
    });
    if (!res.ok) console.log(`     ❌ Firestore error: ${res.status}`);
    return res.ok;
}

async function setMessageDays(uid, days) {
    const dayFields = {};
    for (const [k, v] of Object.entries(days)) dayFields[k] = { integerValue: String(v) };
    const url = `${BASE}/messageCounts/${uid}?key=${API_KEY}&updateMask.fieldPaths=days`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { days: { mapValue: { fields: dayFields } } } }),
    });
    if (!res.ok) console.log(`     ❌ Firestore error: ${res.status}`);
    return res.ok;
}

const RANK_NAMES = ['🥉 Bronze I','🥉 Bronze II','🥈 Silver I','🥈 Silver II','🥇 Gold I','🥇 Gold II','💠 Platinum','💎 Diamond','🔥 Master','⚔️ Grandmaster','👑 Apex Predator'];

async function main() {
    console.log('=== Fix Firestore — SET from Discord backup (source of truth) ===\n');

    console.log('Fetching Discord backup...');
    const data = await fetchDiscordBackup();
    console.log(`  Saved at: ${data.savedAt}`);
    console.log(`  Voice:    ${Object.keys(data.voiceMinutes || {}).length} users`);
    console.log(`  Ranks:    ${Object.keys(data.rankAchievements || {}).length} users`);
    console.log(`  Messages: ${Object.keys(data.messageDays || {}).length} users\n`);

    // Voice — SET (overwrite)
    console.log('=== Voice Minutes (SET) ===');
    let voiceCount = 0;
    for (const [uid, snap] of Object.entries(data.voiceMinutes || {})) {
        if (snap.total <= 0) continue;
        const ok = await setVoice(uid, snap.total, snap.days || {});
        if (ok) { console.log(`  ✅ ${uid}: ${fmt(snap.total)}`); voiceCount++; }
        else    { console.log(`  ❌ ${uid}: FAILED`); }
    }

    // Rank achievements — SET (overwrite)
    console.log('\n=== Rank Achievements (SET) ===');
    let rankCount = 0;
    for (const [uid, ach] of Object.entries(data.rankAchievements || {})) {
        const ok = await setRankAch(uid, ach.highestRankIdx || 0, ach.apexCount || 0);
        if (ok) { console.log(`  ✅ ${uid}: ${RANK_NAMES[ach.highestRankIdx] || '?'} (apex: ${ach.apexCount || 0})`); rankCount++; }
        else    { console.log(`  ❌ ${uid}: FAILED`); }
    }

    // Message days — SET (overwrite)
    console.log('\n=== Message Days (SET) ===');
    let msgCount = 0;
    for (const [uid, days] of Object.entries(data.messageDays || {})) {
        const total = Object.values(days).reduce((a, b) => a + b, 0);
        if (total <= 0) continue;
        const ok = await setMessageDays(uid, days);
        if (ok) { console.log(`  ✅ ${uid}: ${total} messages`); msgCount++; }
        else    { console.log(`  ❌ ${uid}: FAILED`); }
    }

    console.log('\n=== Done ===');
    console.log(`  Voice:    ${voiceCount} users written`);
    console.log(`  Ranks:    ${rankCount} users written`);
    console.log(`  Messages: ${msgCount} users written`);
    console.log('\nFirestore is now synced with Discord backup.');
}

main().catch(e => { console.error(e); process.exit(1); });
