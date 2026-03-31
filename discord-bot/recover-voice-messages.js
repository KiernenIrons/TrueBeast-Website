// Recovery script: restore voice minutes total and check message backup state
// Usage: node recover-voice-messages.js
//
// This script:
//   1. Reads botConfig/messageBackup and shows current message totals
//   2. Restores higher message counts from backup into messageCounts collection
//   3. Reads current voiceMinutes totals from Firestore
//   4. Lets you manually set voice minute totals for specific users
//
// Run: node recover-voice-messages.js

require('dotenv').config();

const PROJECT = process.env.FIREBASE_PROJECT_ID;
const API_KEY  = process.env.FIREBASE_API_KEY;

if (!PROJECT || !API_KEY) { console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY in .env'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function get(path) {
    const res = await fetch(`${BASE}/${path}?key=${API_KEY}`);
    if (!res.ok) { console.error(`GET ${path} → ${res.status}`); return null; }
    return await res.json();
}

async function patch(path, fields) {
    const keys = Object.keys(fields);
    const mask = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`${BASE}/${path}?key=${API_KEY}&${mask}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
    });
    if (!res.ok) console.error(`PATCH ${path} → ${res.status} ${await res.text()}`);
    return res.ok;
}

// ── Voice minutes manual restore ────────────────────────────────────────────
// Set manually-estimated totals here (in minutes). 0 = don't touch.
// TrueBeast is 392450364340830208. Estimate based on having been Diamond rank
// (5500 XP/month minimum = ~5500 mins/month minimum). Ask the user for a real estimate.
// Example: if they think they had ~200 hours, set to 12000.
const VOICE_OVERRIDES = {
    // '392450364340830208': 12000,  // TrueBeast — UNCOMMENT and set correct value
};

// ── Message backup restore ───────────────────────────────────────────────────

async function showMessageBackup() {
    console.log('\n=== Message Backup State ===');
    const doc = await get('botConfig/messageBackup');
    if (!doc?.fields?.data?.stringValue) { console.log('No message backup found.'); return {}; }
    const backup = JSON.parse(doc.fields.data.stringValue);
    const savedAt = doc.fields.savedAt?.stringValue || 'unknown';
    console.log(`Backup saved at: ${savedAt}`);
    const totals = {};
    for (const [uid, days] of Object.entries(backup)) {
        totals[uid] = Object.values(days).reduce((a, b) => a + b, 0);
    }
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    for (const [uid, total] of sorted) {
        console.log(`  ${uid}: ${total} messages`);
    }
    return backup;
}

async function showVoiceMinutes() {
    console.log('\n=== Current Voice Minutes in Firestore ===');
    let nextPageToken = null;
    const users = {};
    do {
        let url = `${BASE}/voiceMinutes?key=${API_KEY}&pageSize=300`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;
        const res = await fetch(url);
        if (!res.ok) { console.error(`voiceMinutes collection error: ${res.status}`); break; }
        const data = await res.json();
        for (const doc of (data.documents || [])) {
            const uid = doc.name.split('/').pop();
            const total = parseInt(doc.fields?.total?.integerValue || '0', 10);
            users[uid] = total;
        }
        nextPageToken = data.nextPageToken || null;
    } while (nextPageToken);

    const sorted = Object.entries(users).sort((a, b) => b[1] - a[1]);
    for (const [uid, mins] of sorted) {
        console.log(`  ${uid}: ${Math.floor(mins/60)}h ${mins%60}m (${mins} mins)`);
    }
    return users;
}

async function applyVoiceOverrides() {
    const overrides = Object.entries(VOICE_OVERRIDES).filter(([, v]) => v > 0);
    if (overrides.length === 0) {
        console.log('\n=== No voice overrides set — edit VOICE_OVERRIDES in this script to restore ===');
        return;
    }
    console.log('\n=== Applying voice minute overrides ===');
    for (const [uid, mins] of overrides) {
        const ok = await patch(`voiceMinutes/${uid}`, {
            total: { integerValue: String(mins) },
        });
        if (ok) console.log(`  ✅ ${uid}: set to ${Math.floor(mins/60)}h ${mins%60}m (${mins} mins)`);
        else    console.log(`  ❌ ${uid}: FAILED`);
    }
}

async function restoreMessageBackup(backup) {
    if (Object.keys(backup).length === 0) return;
    console.log('\n=== Restoring message data from backup ===');
    let restored = 0;
    for (const [uid, days] of Object.entries(backup)) {
        const dayFields = {};
        for (const [day, count] of Object.entries(days)) {
            dayFields[day] = { integerValue: String(count) };
        }
        const total = Object.values(days).reduce((a, b) => a + b, 0);
        // Only restore days map — total will be derived from days on next load
        const ok = await patch(`messageCounts/${uid}`, {
            days: { mapValue: { fields: dayFields } },
        });
        if (ok) { console.log(`  ✅ ${uid}: ${total} messages restored`); restored++; }
        else    { console.log(`  ❌ ${uid}: FAILED`); }
    }
    console.log(`Restored ${restored}/${Object.keys(backup).length} users.`);
}

async function main() {
    const backup = await showMessageBackup();
    await showVoiceMinutes();
    await applyVoiceOverrides();

    if (Object.keys(backup).length > 0) {
        const backupTotals = {};
        for (const [uid, days] of Object.entries(backup)) {
            backupTotals[uid] = Object.values(days).reduce((a,b) => a+b, 0);
        }
        console.log('\nTo restore message data from backup, uncomment the line below and re-run:');
        console.log('// await restoreMessageBackup(backup);');
        // await restoreMessageBackup(backup);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
