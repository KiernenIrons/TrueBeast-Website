// Restore counting state from screenshot (2026-04-06)
// Screenshot shows: Ammar 4x(343), TrueBeast 8x(304), anetaspageta98 2x(282), Tom 1x(55), MarsKooty 1x(52)
// Record: 343
// Run: node recover-counting.js

require('dotenv').config();

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

// UIDs:
//   712687124293615658 = anetaspageta98
//   753575707329822850 = Ammar
//   392450364340830208 = TrueBeast
//   803881574587957258 = Tom
//   518420185913229314 = MarsKooty

// Each entry = one ruin event. Sorted newest-first.
// New entries since last restore (record was 282, now 343):
//   Ammar +1 ruin at 343 (new record)
//   TrueBeast +4 ruins (total 8, highest 304)
//   anetaspageta98 +1 ruin at 154 (just happened — still fresh)

const ruinedBy = [
    // Just happened (2026-04-06)
    { userId: '712687124293615658', count: 154, at: 1743897600000 }, // anetaspageta98 at 154
    // New record run — Ammar ruined at 343
    { userId: '753575707329822850', count: 343, at: 1743811200000 }, // Ammar at 343 (new all-time record)
    // TrueBeast's new ruins (estimated, ordered by likelihood)
    { userId: '392450364340830208', count: 304, at: 1743724800000 }, // TrueBeast at 304 (personal best)
    { userId: '392450364340830208', count: 120, at: 1743638400000 }, // TrueBeast (estimated)
    { userId: '392450364340830208', count: 78,  at: 1743552000000 }, // TrueBeast (estimated)
    { userId: '392450364340830208', count: 45,  at: 1743465600000 }, // TrueBeast (estimated)
    // Previous restore data (record was 282 at that point)
    { userId: '712687124293615658', count: 282, at: 1743350400000 }, // anetaspageta98 at 282
    { userId: '753575707329822850', count: 32,  at: 1743340000000 }, // Ammar at 32
    { userId: '392450364340830208', count: 23,  at: 1743284580000 }, // TrueBeast at 23
    { userId: '753575707329822850', count: 184, at: 1743120000000 }, // Ammar at 184
    { userId: '392450364340830208', count: 166, at: 1742860800000 }, // TrueBeast at 166
    { userId: '803881574587957258', count: 55,  at: 1742774400000 }, // Tom at 55
    { userId: '518420185913229314', count: 52,  at: 1742688000000 }, // MarsKooty at 52
    { userId: '753575707329822850', count: 18,  at: 1742515200000 }, // Ammar at 18
    { userId: '392450364340830208', count: 34,  at: 1742342400000 }, // TrueBeast at 34
    { userId: '392450364340830208', count: 11,  at: 1742169600000 }, // TrueBeast at 11
];

const state = {
    current:    0,
    lastUserId: null,
    record:     343,
    ruinedBy,
};

async function restore() {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/countingState?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
            current:    { integerValue: String(state.current) },
            lastUserId: { stringValue: '' },
            record:     { integerValue: String(state.record) },
            ruinedBy:   { stringValue: JSON.stringify(state.ruinedBy) },
        }}),
    });
    if (!res.ok) {
        console.error('❌ Firestore update failed:', res.status, await res.text());
        process.exit(1);
    }
    console.log('✅ Counting state restored:');
    console.log(`   Record: ${state.record}`);
    const tally = {};
    for (const r of state.ruinedBy) {
        if (!tally[r.userId]) tally[r.userId] = { count: 0, highest: 0 };
        tally[r.userId].count++;
        if (r.count > tally[r.userId].highest) tally[r.userId].highest = r.count;
    }
    console.log('   Wall of Shame (sorted by biggest fail):');
    Object.entries(tally)
        .sort((a, b) => b[1].highest - a[1].highest)
        .forEach(([uid, d], i) => console.log(`   ${i + 1}. ${uid} — ${d.count}x (highest at ${d.highest})`));
}

restore().catch(e => { console.error(e); process.exit(1); });
