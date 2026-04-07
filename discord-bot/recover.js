// List and restore daily snapshots from Discord backup channel
// Run: node recover.js              (list available snapshots)
// Run: node recover.js 2026-04-07   (restore that date's snapshot)

require('dotenv').config();

const PROJECT        = process.env.FIREBASE_PROJECT_ID;
const API_KEY        = process.env.FIREBASE_API_KEY;
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const BACKUP_CHANNEL = process.env.BACKUP_CHANNEL_ID || '1490542501302636726';

if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }

const BASE = PROJECT && API_KEY
    ? `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
    : null;

const dateArg = process.argv[2]; // e.g. "2026-04-07"

let _botId = null;
async function getBotId() {
    if (_botId) return _botId;
    const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    _botId = (await res.json()).id;
    return _botId;
}

async function fetchMessages(limit = 100) {
    const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages?limit=${limit}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Discord fetch failed: ${res.status}`);
    return res.json();
}

async function downloadAttachment(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.json();
}

function fmt(mins) { return `${Math.floor(mins / 60)}h ${mins % 60}m`; }

function summarize(data) {
    const voiceUsers = Object.keys(data.voiceMinutes || {}).length;
    const voiceTotal = Object.values(data.voiceMinutes || {}).reduce((s, v) => s + (v.total || 0), 0);
    const msgUsers = Object.keys(data.messageDays || {}).length;
    const msgTotal = Object.values(data.messageDays || {}).reduce((s, days) =>
        s + Object.values(days).reduce((a, b) => a + b, 0), 0);
    const rankUsers = Object.keys(data.rankAchievements || {}).length;
    const reactionUsers = Object.keys(data.reactions || {}).length;
    const record = data.counting?.record || 0;
    const wallOfShame = data.counting?.ruinedBy?.length || 0;

    console.log(`    Voice:     ${voiceUsers} users, ${fmt(voiceTotal)} total`);
    console.log(`    Messages:  ${msgUsers} users, ${msgTotal.toLocaleString()} total`);
    console.log(`    Ranks:     ${rankUsers} users tracked`);
    console.log(`    Reactions: ${reactionUsers} users tracked`);
    console.log(`    Counting:  record=${record}, wall of shame=${wallOfShame} entries`);
}

// ── LIST MODE ─────────────────────────────────────────────────────────────────

async function listSnapshots() {
    console.log('=== Available Daily Snapshots ===\n');
    const botId = await getBotId();
    const msgs = await fetchMessages(100);

    const snapshots = [];
    let liveBackup = null;

    for (const msg of msgs) {
        if (msg.author.id !== botId) continue;
        for (const att of (msg.attachments || [])) {
            if (att.filename === 'beast-bot-backup.json' && !liveBackup) {
                liveBackup = { msgId: msg.id, url: att.url, content: msg.content, createdAt: msg.timestamp };
            }
            const match = att.filename.match(/^daily-(\d{4}-\d{2}-\d{2})\.json$/);
            if (match) {
                snapshots.push({ date: match[1], msgId: msg.id, url: att.url, content: msg.content, createdAt: msg.timestamp });
            }
        }
    }

    if (liveBackup) {
        console.log('📡 Live Backup:');
        console.log(`    Message: ${liveBackup.content?.slice(0, 80) || '(no content)'}`);
        console.log(`    Created: ${liveBackup.createdAt}`);
        try {
            const data = await downloadAttachment(liveBackup.url);
            console.log(`    savedAt: ${data.savedAt}`);
            summarize(data);
        } catch (e) { console.log(`    ⚠️  Could not download: ${e.message}`); }
        console.log();
    }

    if (snapshots.length === 0) {
        console.log('No daily snapshots found.');
        return;
    }

    snapshots.sort((a, b) => b.date.localeCompare(a.date));
    console.log(`📅 Daily Snapshots (${snapshots.length}):\n`);
    for (const s of snapshots) {
        const age = Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 86400000);
        console.log(`  ${s.date}  (${age}d ago)  — ${s.content?.slice(0, 60) || ''}`);
    }

    console.log(`\nTo restore: node recover.js YYYY-MM-DD`);
}

// ── RESTORE MODE ──────────────────────────────────────────────────────────────

async function restore(targetDate) {
    console.log(`=== Restore Snapshot: ${targetDate} ===\n`);

    const botId = await getBotId();
    const msgs = await fetchMessages(100);

    // Find the snapshot for this date
    let snapshotUrl = null;
    for (const msg of msgs) {
        if (msg.author.id !== botId) continue;
        for (const att of (msg.attachments || [])) {
            if (att.filename === `daily-${targetDate}.json`) {
                snapshotUrl = att.url;
                break;
            }
        }
        if (snapshotUrl) break;
    }

    if (!snapshotUrl) {
        console.error(`❌ No daily snapshot found for ${targetDate}`);
        console.log('Run `node recover.js` to see available snapshots.');
        process.exit(1);
    }

    console.log('Downloading snapshot...');
    const data = await downloadAttachment(snapshotUrl);
    console.log(`  savedAt: ${data.savedAt}`);
    summarize(data);
    console.log();

    // Update the Discord live backup
    console.log('Uploading as live backup...');
    const now = new Date().toISOString();
    data.savedAt = now; // Update timestamp so bot knows this is fresh
    data._restoredFrom = targetDate;
    const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');

    // Find existing live backup message
    let liveMsgId = null;
    for (const msg of msgs) {
        if (msg.author.id !== botId) continue;
        if ((msg.attachments || []).some(a => a.filename === 'beast-bot-backup.json')) {
            liveMsgId = msg.id;
            break;
        }
    }

    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        content: `💾 RESTORED from ${targetDate} \`${now}\``,
        attachments: [],
    }));
    form.append('files[0]', new Blob([buf]), 'beast-bot-backup.json');

    if (liveMsgId) {
        const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages/${liveMsgId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            body: form,
        });
        if (!res.ok) throw new Error(`Discord edit failed: ${res.status}`);
        console.log('  ✅ Live backup updated');
    } else {
        const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            body: form,
        });
        if (!res.ok) throw new Error(`Discord post failed: ${res.status}`);
        console.log('  ✅ Live backup created');
    }

    // Write to Firestore fullBackup doc (disaster recovery copy)
    if (BASE) {
        console.log('Writing to Firestore fullBackup...');
        const url = `${BASE}/botConfig/fullBackup?key=${API_KEY}`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: {
                data:    { stringValue: JSON.stringify(data) },
                savedAt: { stringValue: now },
            }}),
        });
        if (res.ok) console.log('  ✅ Firestore fullBackup updated');
        else console.log(`  ⚠️  Firestore write failed: ${res.status} (non-critical — Discord is primary)`);
    }

    console.log('\n=== Recovery Complete ===');
    console.log('Restart the bot to load the restored data:');
    console.log('  cd discord-bot && ~/.fly/bin/fly deploy');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    restore(dateArg).catch(e => { console.error(e); process.exit(1); });
} else if (dateArg) {
    console.error(`Invalid date format: "${dateArg}". Use YYYY-MM-DD.`);
    process.exit(1);
} else {
    listSnapshots().catch(e => { console.error(e); process.exit(1); });
}
