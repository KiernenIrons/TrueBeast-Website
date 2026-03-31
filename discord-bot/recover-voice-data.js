// Voice data recovery — restores all-time voice totals from screenshot (2026-03-28)
// Screenshot values + 15h (900 mins) to account for ~3 days of activity since screenshot
// Run: node recover-voice-data.js

require('dotenv').config();

const PROJECT = process.env.FIREBASE_PROJECT_ID;
const API_KEY  = process.env.FIREBASE_API_KEY;

if (!PROJECT || !API_KEY) { console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY'); process.exit(1); }

const BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const COMMIT  = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit?key=${API_KEY}`;

// Values from screenshot (2026-03-28) + 15h (900 mins) per person
// Screenshot shows all-time voice leaderboard
const RESTORE = [
    { uid: '392450364340830208', name: 'TrueBeast',       screenshot: '55h 49m', mins: 3349 + 900 }, // 70h 49m
    { uid: '1062259955454967888', name: 'Zurt',           screenshot: '35h 11m', mins: 2111 + 900 }, // 50h 11m
    { uid: '1171207666467610664', name: 'Tayla',          screenshot: '13h 46m', mins: 826  + 900 }, // 28h 46m
    { uid: '235564884555857921',  name: 'Tony',           screenshot: '11h 25m', mins: 685  + 900 }, // 26h 25m
    { uid: '666779754946494487',  name: 'Chriz',          screenshot: '8h 23m',  mins: 503  + 900 }, // 23h 23m
    { uid: '366647746968551426',  name: 'Stephanie',      screenshot: '6h 7m',   mins: 367  + 900 }, // 21h 7m
    { uid: '753575707329822850',  name: 'Ammar',          screenshot: '5h 38m',  mins: 338  + 900 }, // 20h 38m
    { uid: '747640713130410076',  name: 'Zentri',         screenshot: '5h 16m',  mins: 316  + 900 }, // 20h 16m
    { uid: '834210929935777813',  name: 'ThatSteeleGuy',  screenshot: '4h 11m',  mins: 251  + 900 }, // 19h 11m
    // Sabine: ID not provided — add manually if needed
];

function fmt(mins) { return `${Math.floor(mins / 60)}h ${mins % 60}m`; }

async function getCurrentTotal(uid) {
    const res = await fetch(`${BASE}/voiceMinutes/${uid}?key=${API_KEY}`);
    if (!res.ok) return 0;
    const doc = await res.json();
    return parseInt(doc.fields?.total?.integerValue || '0', 10);
}

async function setVoiceTotal(uid, mins) {
    const url = `${BASE}/voiceMinutes/${uid}?key=${API_KEY}&updateMask.fieldPaths=total`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { total: { integerValue: String(mins) } } }),
    });
    return res.ok;
}

async function main() {
    console.log('=== Voice Data Recovery ===\n');
    console.log('Reading current Firestore totals...\n');

    for (const entry of RESTORE) {
        const current = await getCurrentTotal(entry.uid);
        const restore = entry.mins;

        if (current >= restore) {
            console.log(`  SKIP  ${entry.name.padEnd(18)} current=${fmt(current)}  ≥  restore=${fmt(restore)} — already higher, not touching`);
            continue;
        }

        const ok = await setVoiceTotal(entry.uid, restore);
        if (ok) {
            console.log(`  ✅    ${entry.name.padEnd(18)} ${fmt(current).padStart(8)} → ${fmt(restore)}  (screenshot: ${entry.screenshot} + 15h)`);
        } else {
            console.log(`  ❌    ${entry.name.padEnd(18)} FAILED`);
        }
    }

    console.log('\nDone. Going forward, voice minutes will only ever be atomically added — this data is safe from deploys/restarts.');
}

main().catch(e => { console.error(e); process.exit(1); });
