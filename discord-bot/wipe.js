// Wipe all bot data — everyone starts at 0
// Run: node wipe.js           (preview)
// Run: node wipe.js --confirm (execute)

require('dotenv').config();

const PROJECT        = process.env.FIREBASE_PROJECT_ID;
const API_KEY        = process.env.FIREBASE_API_KEY;
const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN;
const BACKUP_CHANNEL = process.env.BACKUP_CHANNEL_ID || '1490542501302636726';

if (!PROJECT || !API_KEY) { console.error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY'); process.exit(1); }
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const confirm = process.argv.includes('--confirm');

function emptyState() {
    return {
        savedAt: new Date().toISOString(),
        voiceMinutes: {},
        messageDays: {},
        messageCounts: {},
        rankAchievements: {},
        reactions: {},
        voiceBonusXp: {},
        counting: { current: 0, record: 0, lastUserId: '', ruinedBy: [] },
        aiHistory: {},
    };
}

async function discordPost(content, fileBuffer, fileName) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    if (fileBuffer) {
        form.append('files[0]', new Blob([fileBuffer]), fileName);
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
        body: form,
    });
    if (!res.ok) throw new Error(`Discord POST failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function discordEdit(msgId, content, fileBuffer, fileName) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content, attachments: [] }));
    if (fileBuffer) {
        form.append('files[0]', new Blob([fileBuffer]), fileName);
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages/${msgId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
        body: form,
    });
    if (!res.ok) throw new Error(`Discord PATCH failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function findLiveBackupMsg() {
    const res = await fetch(`https://discord.com/api/v10/channels/${BACKUP_CHANNEL}/messages?limit=10`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (!res.ok) return null;
    const msgs = await res.json();
    // Find the bot's live backup message (has beast-bot-backup.json attachment)
    const botId = await getBotId();
    return msgs.find(m => m.author.id === botId && (m.attachments || []).some(a => a.filename === 'beast-bot-backup.json'));
}

let _botId = null;
async function getBotId() {
    if (_botId) return _botId;
    const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    const data = await res.json();
    _botId = data.id;
    return _botId;
}

async function listFirestoreDocs(collection) {
    const docs = [];
    let token = null;
    do {
        let url = `${BASE}/${collection}?key=${API_KEY}&pageSize=300`;
        if (token) url += `&pageToken=${token}`;
        const res = await fetch(url);
        if (!res.ok) break;
        const data = await res.json();
        for (const d of (data.documents || [])) docs.push(d.name.split('/').pop());
        token = data.nextPageToken || null;
    } while (token);
    return docs;
}

async function deleteFirestoreDoc(collection, docId) {
    const url = `${BASE}/${collection}/${docId}?key=${API_KEY}`;
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
}

async function clearFirestoreDoc(collection, docId) {
    const url = `${BASE}/${collection}/${docId}?key=${API_KEY}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {} }),
    });
    return res.ok;
}

async function main() {
    console.log('=== TrueBeast Data Wipe ===\n');

    if (!confirm) {
        console.log('⚠️  DRY RUN — add --confirm to actually wipe\n');
    }

    // Count what we'd wipe
    const collections = ['voiceMinutes', 'rankAchievements', 'messageCounts', 'voiceBonusXp'];
    const counts = {};
    for (const col of collections) {
        const docs = await listFirestoreDocs(col);
        counts[col] = docs.length;
        console.log(`  Firestore ${col}: ${docs.length} docs`);
    }

    const backupDocs = ['fullBackup', 'countingState', 'aiHistory', 'voiceBackup', 'messageBackup', 'rankAchBackup', 'reactionBackup'];
    console.log(`  Firestore botConfig backup docs: ${backupDocs.length}`);

    const liveMsg = await findLiveBackupMsg();
    console.log(`  Discord live backup: ${liveMsg ? 'found' : 'not found'}`);

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\n  Total Firestore docs to delete: ${total}`);
    console.log(`  Total botConfig docs to clear: ${backupDocs.length}`);

    if (!confirm) {
        console.log('\n⚠️  This will PERMANENTLY DELETE all user data.');
        console.log('   Run: node wipe.js --confirm');
        return;
    }

    console.log('\n🔥 WIPING ALL DATA...\n');

    // 1. Post empty state as Discord live backup
    const state = emptyState();
    const buf = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
    if (liveMsg) {
        await discordEdit(liveMsg.id, `💾 WIPED \`${state.savedAt}\``, buf, 'beast-bot-backup.json');
        console.log('  ✅ Discord live backup overwritten with empty state');
    } else {
        await discordPost(`💾 WIPED \`${state.savedAt}\``, buf, 'beast-bot-backup.json');
        console.log('  ✅ Discord live backup created with empty state');
    }

    // 2. Post wipe snapshot
    const dateStr = new Date().toISOString().slice(0, 10);
    const snapBuf = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
    await discordPost(`📅 WIPE — ${dateStr}`, snapBuf, `daily-${dateStr}.json`);
    console.log(`  ✅ Wipe snapshot posted: daily-${dateStr}.json`);

    // 3. Delete all Firestore per-user docs
    for (const col of collections) {
        const docs = await listFirestoreDocs(col);
        let deleted = 0;
        for (const docId of docs) {
            if (await deleteFirestoreDoc(col, docId)) deleted++;
        }
        console.log(`  ✅ ${col}: deleted ${deleted}/${docs.length} docs`);
    }

    // 4. Clear botConfig backup docs
    for (const docId of backupDocs) {
        await clearFirestoreDoc('botConfig', docId);
    }
    console.log(`  ✅ botConfig: cleared ${backupDocs.length} backup docs`);

    console.log('\n=== Wipe Complete ===');
    console.log('All data has been reset to zero.');
    console.log('Restart the bot to begin fresh: cd discord-bot && ~/.fly/bin/fly deploy');
}

main().catch(e => { console.error(e); process.exit(1); });
