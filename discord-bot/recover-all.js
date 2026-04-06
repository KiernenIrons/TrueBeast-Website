// Full data recovery — adds Firestore historical data + Discord recent data together
// Firestore = old totals (bot read-failed on restart, so untouched historical data)
// Discord   = new activity since bot restarted with empty in-memory state
// Run: node recover-all.js
//
// Merge logic:
//   voice total       — ADD  (Firestore historical + Discord recent)
//   voice days        — ADD per day
//   message days      — ADD per day
//   highestRankIdx    — MAX  (it's a peak rank, not additive)
//   apexCount         — ADD  (count of times at apex, accumulative)

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
            console.log(`  ✅ Discord backup found — saved at: ${data.savedAt}`);
            console.log(`     voiceMinutes:     ${Object.keys(data.voiceMinutes     || {}).length} users`);
            console.log(`     rankAchievements: ${Object.keys(data.rankAchievements || {}).length} users`);
            console.log(`     messageDays:      ${Object.keys(data.messageDays      || {}).length} users`);
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
    if (!res.ok) { console.log(`     Firestore error: ${res.status} ${await res.text()}`); }
    return res.ok;
}

async function patchCountingState(current, record, lastUserId, ruinedBy) {
    const url = `${BASE}/botConfig/countingState?key=${API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
            current:    { integerValue: String(current) },
            record:     { integerValue: String(record) },
            lastUserId: { stringValue: lastUserId || '' },
            ruinedBy:   { stringValue: JSON.stringify(ruinedBy || []) },
        }}),
    });
    if (!res.ok) { console.log(`     Firestore error: ${res.status} ${await res.text()}`); }
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

// Add two day-maps together (per-day accumulation)
function addDays(a, b) {
    const result = { ...a };
    for (const [day, val] of Object.entries(b || {})) {
        result[day] = (result[day] || 0) + val;
    }
    return result;
}

const RANK_NAMES = ['🥉 Bronze I','🥉 Bronze II','🥈 Silver I','🥈 Silver II','🥇 Gold I','🥇 Gold II','💠 Platinum','💎 Diamond','🔥 Master','⚔️ Grandmaster','👑 Apex Predator'];

async function main() {
    console.log('=== TrueBeast Full Data Recovery ===');
    console.log('Mode: ADD Firestore (historical) + Discord (recent activity)\n');

    // ── 1. Discord backup (new activity since bot restarted empty) ────────────
    console.log('Reading Discord backup (recent activity)...');
    const discordData    = await fetchDiscordBackup();
    const discordVoice   = discordData?.voiceMinutes     || {};
    const discordRankAch = discordData?.rankAchievements || {};
    const discordMsgDays = discordData?.messageDays      || {};
    console.log();

    // ── 2. Firestore primary collections (historical data) ────────────────────
    console.log('Reading Firestore primary collections (historical data)...');

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

    // ── 3. Add historical + recent and write back ─────────────────────────────

    // Voice: ADD Firestore total + Discord total; ADD per-day
    let voiceRestored = 0;
    console.log('=== Voice Minutes Recovery (Firestore + Discord) ===');
    const allVoiceUids = new Set([...Object.keys(discordVoice), ...Object.keys(primaryVoice)]);
    for (const uid of allVoiceUids) {
        const discord  = discordVoice[uid]  || { total: 0, days: {} };
        const primary  = primaryVoice[uid]  || { total: 0, days: {} };
        const newTotal = primary.total + discord.total;
        const newDays  = addDays(primary.days, discord.days);
        if (newTotal !== primary.total || JSON.stringify(newDays) !== JSON.stringify(primary.days)) {
            const ok = await patchVoice(uid, newTotal, newDays);
            if (ok) {
                console.log(`  ✅ ${uid}: ${fmt(primary.total)} + ${fmt(discord.total)} = ${fmt(newTotal)}`);
                voiceRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${fmt(primary.total)} — no Discord data to add`);
        }
    }

    // Rank achievements: MAX highestRankIdx (peak); ADD apexCount
    let rankRestored = 0;
    console.log('\n=== Rank Achievement Recovery ===');
    const allRankUids = new Set([...Object.keys(discordRankAch), ...Object.keys(primaryRankAch)]);
    for (const uid of allRankUids) {
        const discord  = discordRankAch[uid] || { highestRankIdx: 0, apexCount: 0 };
        const primary  = primaryRankAch[uid] || { highestRankIdx: 0, apexCount: 0 };
        const bestIdx  = Math.max(discord.highestRankIdx, primary.highestRankIdx); // peak rank — MAX
        const newApex  = primary.apexCount + discord.apexCount;                   // count — ADD
        if (bestIdx !== primary.highestRankIdx || newApex !== primary.apexCount) {
            const ok = await patchRankAch(uid, bestIdx, newApex);
            if (ok) {
                console.log(`  ✅ ${uid}: rank ${RANK_NAMES[primary.highestRankIdx] || '?'} → ${RANK_NAMES[bestIdx] || '?'}, apex ${primary.apexCount} + ${discord.apexCount} = ${newApex}`);
                rankRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${RANK_NAMES[primary.highestRankIdx] || '?'} — no change needed`);
        }
    }

    // Message days: ADD per day
    let msgRestored = 0;
    console.log('\n=== Message Count Recovery (Firestore + Discord) ===');
    const allMsgUids = new Set([...Object.keys(discordMsgDays), ...Object.keys(primaryMsgDays)]);
    for (const uid of allMsgUids) {
        const discord      = discordMsgDays[uid]  || {};
        const primary      = primaryMsgDays[uid]  || {};
        const newDays      = addDays(primary, discord);
        const primaryTotal = Object.values(primary).reduce((a, b) => a + b, 0);
        const discordTotal = Object.values(discord).reduce((a, b) => a + b, 0);
        const newTotal     = Object.values(newDays).reduce((a, b) => a + b, 0);
        if (discordTotal > 0) {
            const ok = await patchMessageDays(uid, newDays);
            if (ok) {
                console.log(`  ✅ ${uid}: ${primaryTotal} + ${discordTotal} = ${newTotal} messages`);
                msgRestored++;
            } else {
                console.log(`  ❌ ${uid}: FAILED`);
            }
        } else {
            console.log(`  ✓  ${uid}: ${primaryTotal} messages — no Discord data to add`);
        }
    }

    // Counting state: restore from Discord backup, compare against Firestore
    console.log('\n=== Counting State Recovery ===');
    const discordCounting = discordData?.counting || null;

    let firestoreCounting = null;
    try {
        const doc = await get('botConfig/countingState');
        if (doc?.fields) {
            firestoreCounting = {
                current:    parseInt(doc.fields.current?.integerValue    || '0', 10),
                record:     parseInt(doc.fields.record?.integerValue     || '0', 10),
                lastUserId: doc.fields.lastUserId?.stringValue           || '',
                ruinedBy:   JSON.parse(doc.fields.ruinedBy?.stringValue  || '[]'),
            };
        }
    } catch (_) {}

    if (!discordCounting) {
        console.log('  ⚠️  No counting data in Discord backup — skipping');
    } else {
        console.log(`  Discord backup:  current=${discordCounting.current}, record=${discordCounting.record}, ruinedBy=${discordCounting.ruinedBy?.length || 0} entries`);
        console.log(`  Firestore:       current=${firestoreCounting?.current ?? 'missing'}, record=${firestoreCounting?.record ?? 'missing'}`);

        // Take MAX for record (highest run ever); use Discord for everything else (most recent state)
        const bestRecord    = Math.max(discordCounting.record, firestoreCounting?.record || 0);
        const bestCurrent   = discordCounting.current;
        const bestLastUser  = discordCounting.lastUserId || '';
        // Merge ruinedBy: combine both lists, deduplicate by userId+count, sort by count desc
        const allRuinedBy = [...(discordCounting.ruinedBy || []), ...(firestoreCounting?.ruinedBy || [])];
        const seen = new Set();
        const mergedRuinedBy = allRuinedBy.filter(r => {
            const key = `${r.userId}-${r.count}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) => b.count - a.count).slice(0, 20);

        const ok = await patchCountingState(bestCurrent, bestRecord, bestLastUser, mergedRuinedBy);
        if (ok) {
            console.log(`  ✅ Counting state restored — current: ${bestCurrent}, record: ${bestRecord}, wall of shame: ${mergedRuinedBy.length} entries`);
        } else {
            console.log('  ❌ Counting state restore FAILED');
        }
    }

    console.log('\n=== Recovery Complete ===');
    console.log(`  Voice restored:    ${voiceRestored} users`);
    console.log(`  Rank ach restored: ${rankRestored} users`);
    console.log(`  Messages restored: ${msgRestored} users`);
    console.log('\nDone. Restart Beast Bot to reload the restored data from Firestore.');
}

main().catch(e => { console.error(e); process.exit(1); });
