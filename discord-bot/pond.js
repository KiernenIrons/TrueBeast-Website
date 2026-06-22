/**
 * The Pond — cozy tamagotchi-style frog game with a fireflies economy.
 * See GAME_POND.md for full design notes.
 *
 * Self-contained module: owns its own Firestore REST helpers (rather than
 * importing index.js's) to avoid a circular require. Exports everything
 * index.js needs to wire this feature into the existing slash-command
 * array and interactionCreate handler.
 */

const path = require('path');
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const GifEncoder = require('gif-encoder-2');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

const POND_CHANNEL_ID = process.env.POND_CHANNEL_ID || '1517699652982407168';

const DAY_MS = 24 * 60 * 60 * 1000;
const ASSETS_DIR = path.join(__dirname, 'assets', 'pond');

// Gentle decay — a single daily check-in comfortably outpaces this.
const HUNGER_DECAY_PER_HOUR    = 2; // 8 per 4h
const HAPPINESS_DECAY_PER_HOUR = 2; // 8 per 4h
const FEED_COOLDOWN_MS  = 4 * 60 * 60 * 1000;
const PLAY_COOLDOWN_MS  = 4 * 60 * 60 * 1000;
const FEED_RESTORE_BASE = 8;
const PLAY_RESTORE_BASE = 8;
const ITEM_RESTORE      = 16; // worms/toys give this instead of the base amount
const CURE_COST   = 35;
const SOOTHE_COST = 35;
const SICKNESS_GRACE_MS   = 3 * DAY_MS;
const DEPRESSION_GRACE_MS = 3 * DAY_MS;
const MAX_AGE_DAYS = 75;
const TICK_INTERVAL_MS  = 60 * 60 * 1000;
const POND_TAX_INTERVAL_MS = 7 * DAY_MS;
const POND_TAX_RATE = 0.05;

const STAGE_THRESHOLDS_DAYS = [
    { stage: 'egg',     minDays: 0 },
    { stage: 'tadpole', minDays: 1 },
    { stage: 'froglet', minDays: 3 },
    { stage: 'frog',    minDays: 14 },
    { stage: 'elder',   minDays: 60 },
];

// `gold` is displayed as "Golden" — the key stays `gold` to match the asset filenames
// (FrogGold.png etc.) without a data migration.
const FROG_COLORS = {
    green:  { name: 'Lily Green',   hex: '#5fb95f', dark: '#3d7d3d', light: '#a8e0a0', perk: 'hungerSlower' },
    blue:   { name: 'Pond Blue',    hex: '#4f8fd1', dark: '#2f5c8a', light: '#a9cdf2', perk: 'explorationBoost' },
    pink:   { name: 'Axolotl Pink', hex: '#e892b5', dark: '#b85f86', light: '#f7c9dd', perk: 'luckBoost' },
    gold:   { name: 'Golden',       hex: '#e0b94a', dark: '#a4862c', light: '#f3da9c', perk: 'shopDiscount' },
    purple: { name: 'Poison Dart',  hex: '#9b6fd6', dark: '#6a4699', light: '#cdb1ec', perk: 'happinessSlower' },
    brown:  { name: 'Marsh Brown',  hex: '#a9764f', dark: '#74502f', light: '#d4ac82', perk: 'babyBonus' },
};

const PERK_DESCRIPTIONS = {
    hungerSlower:      'Hunger decays 10% slower',
    explorationBoost:  '+10% rewards from exploration',
    luckBoost:         '+10% luck',
    shopDiscount:      '10% shop discount',
    happinessSlower:   'Happiness decays 10% slower',
    babyBonus:         'Babies are worth +5 fireflies',
};

const LILYPAD_LEVELS = {
    1:  { cost: 0,   label: 'Tiny lilypad' },
    2:  { cost: 10,  label: '+5 hunger from feeding' },
    3:  { cost: 15,  label: '+5 happiness from playing' },
    4:  { cost: 25,  label: '+2 fireflies from exploration' },
    5:  { cost: 40,  label: 'Daily passive income unlocked (+5 fireflies/day)' },
    6:  { cost: 75,  label: 'Hawk battle loss reduced to 5% of fireflies' },
    7:  { cost: 100, label: '+5 additional daily passive income' },
    8:  { cost: 120, label: '+3 fireflies from exploration' },
    9:  { cost: 150, label: 'Hunger and happiness decay 5% slower' },
    10: { cost: 200, label: 'Super cute flower lilypad' },
};
const MAX_LILYPAD_LEVEL = 10;

const SHOP_ITEMS = {
    worms: { cost: 2,   label: 'Worms', desc: '+16 hunger when fed (instead of +8)' },
    toys:  { cost: 2,   label: 'Toys',  desc: '+16 happiness when played with (instead of +8)' },
    nest:  { cost: 100, label: 'Nest',  desc: 'Allows 1 extra baby (max 1 per frog)' },
};

const POND_COMMAND_NAMES = new Set(['frog', 'pond']);

function isPondCommand(name) {
    return POND_COMMAND_NAMES.has(name);
}

// ── Firestore (REST, own copy — see index.js firestoreGet/Set for the pattern) ──

function toFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return { integerValue: String(Math.trunc(v)) };
    return { stringValue: String(v) };
}

function fromFirestoreValue(v) {
    if (!v) return null;
    if (v.nullValue !== undefined) return null;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return Number(v.doubleValue);
    if (v.stringValue !== undefined) return v.stringValue;
    return null;
}

// Firestore security rules only allowlist specific collection names, and `pondFrogs`
// isn't one of them (writes 403). Rather than requiring a rules change, frog docs live
// under the already-allowed `botConfig` collection, namespaced `pond_<userId>` with a
// `kind: 'pondFrog'` marker field so collection-wide queries can tell them apart from
// the bot's other botConfig docs (features, tempBans, fullBackup, etc.).
const POND_DOC_PREFIX = 'pond_';
const POND_META_DOC_ID = 'pond_meta';

async function pondFirestoreSet(docId, data, kind = 'pondFrog') {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/${docId}?key=${FIREBASE_API_KEY}`;
    const fields = { kind: { stringValue: kind } };
    for (const [k, v] of Object.entries(data)) fields[k] = toFirestoreValue(v);
    try {
        await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    } catch (e) { console.error(`[Pond] pondFirestoreSet ${docId} failed:`, e.message); }
}

async function pondFirestoreGet(docId) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/${docId}?key=${FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.fields) return null;
        const result = {};
        for (const [k, v] of Object.entries(data.fields)) result[k] = fromFirestoreValue(v);
        return result;
    } catch (e) { return null; }
}

async function pondFirestoreQuery({ aliveOnly = false } = {}) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const filters = [{ fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'pondFrog' } } }];
    if (aliveOnly) {
        filters.push({ fieldFilter: { field: { fieldPath: 'alive' }, op: 'EQUAL', value: { booleanValue: true } } });
    }
    const structuredQuery = {
        from: [{ collectionId: 'botConfig' }],
        where: filters.length > 1 ? { compositeFilter: { op: 'AND', filters } } : filters[0],
    };
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
        if (!res.ok) { console.error('[Pond] pondFirestoreQuery failed HTTP', res.status); return []; }
        const rows = await res.json();
        return rows.map(r => r.document).filter(Boolean).map(doc => {
            const result = { id: doc.name.split('/').pop() };
            for (const [k, v] of Object.entries(doc.fields || {})) result[k] = fromFirestoreValue(v);
            return result;
        });
    } catch (e) {
        console.error('[Pond] pondFirestoreQuery error:', e.message);
        return [];
    }
}

async function pondFrogGet(userId) { return pondFirestoreGet(`${POND_DOC_PREFIX}${userId}`); }
async function pondFrogSet(userId, data) { return pondFirestoreSet(`${POND_DOC_PREFIX}${userId}`, data, 'pondFrog'); }

// ── Game logic ───────────────────────────────────────────────────────────────

// Fills defaults for fields that may be missing on frog docs written before a given
// feature shipped, so older live frogs upgrade gracefully instead of crashing on `undefined`.
function normalizeFrog(frog, now = Date.now()) {
    if (frog.fireflies == null) frog.fireflies = 0;
    if (frog.lilypadLevel == null) frog.lilypadLevel = 1;
    if (frog.worms == null) frog.worms = 0;
    if (frog.toys == null) frog.toys = 0;
    if (frog.hasNest == null) frog.hasNest = false;
    if (frog.sick == null) frog.sick = false;
    if (frog.sickSince === undefined) frog.sickSince = null;
    if (frog.depressed == null) frog.depressed = false;
    if (frog.depressedSince === undefined) frog.depressedSince = null;
    if (frog.lastPassiveAt == null) frog.lastPassiveAt = now;
    if (frog.deathReason === undefined) frog.deathReason = null;
    return frog;
}

function calcStage(frog, now = Date.now()) {
    const ageDays = (now - frog.bornAt) / DAY_MS;
    let stage = 'egg';
    for (const t of STAGE_THRESHOLDS_DAYS) {
        if (ageDays >= t.minDays) stage = t.stage;
    }
    return stage;
}

function formatAge(ms) {
    const days = Math.floor(ms / DAY_MS);
    if (days < 1) return 'less than a day';
    if (days === 1) return '1 day';
    return `${days} days`;
}

function colorPerk(frog) {
    return (FROG_COLORS[frog.color] || FROG_COLORS.green).perk;
}

function shopPrice(frog, baseCost) {
    return colorPerk(frog) === 'shopDiscount' ? Math.ceil(baseCost * 0.9) : baseCost;
}

function die(frog, now, reason) {
    frog.alive = false;
    frog.diedAt = now;
    frog.deathReason = reason;
    frog.lifespanDays = Math.max(1, Math.round((now - frog.bornAt) / DAY_MS));
    frog.justDied = true;
}

const DEATH_MESSAGES = {
    old_age:  (f) => `🌼 **${f.name}** lived a long, full life and passed peacefully of old age after ${f.lifespanDays} day(s).`,
    sickness: (f) => `💔 **${f.name}** fell ill and, without a cure in time, passed away after ${f.lifespanDays} day(s).`,
    ran_away: (f) => `🐸 **${f.name}** grew too lonely and hopped away for good after ${f.lifespanDays} day(s) in the pond.`,
};

function deathMessage(frog) {
    const fn = DEATH_MESSAGES[frog.deathReason] || DEATH_MESSAGES.old_age;
    return fn(frog);
}

// Applies decay/passive-income/sickness-depression/age-cap since lastTickAt. Mutates and
// returns frog. May set frog.justDied = true with frog.deathReason set.
function applyDecay(frog, now = Date.now()) {
    normalizeFrog(frog, now);
    const ageDays = (now - frog.bornAt) / DAY_MS;
    if (ageDays >= MAX_AGE_DAYS) {
        die(frog, now, 'old_age');
        frog.stage = calcStage(frog, now);
        return frog;
    }

    const hours = Math.max(0, (now - frog.lastTickAt) / (60 * 60 * 1000));
    const lilypadSlow = frog.lilypadLevel >= 9 ? 0.95 : 1;
    const hungerRate    = HUNGER_DECAY_PER_HOUR    * (colorPerk(frog) === 'hungerSlower'    ? 0.9 : 1) * lilypadSlow;
    const happinessRate = HAPPINESS_DECAY_PER_HOUR * (colorPerk(frog) === 'happinessSlower' ? 0.9 : 1) * lilypadSlow;
    frog.hunger    = Math.max(0, Math.min(100, frog.hunger    - hungerRate    * hours));
    frog.happiness = Math.max(0, Math.min(100, frog.happiness - happinessRate * hours));
    frog.lastTickAt = now;

    // Lilypad passive income — credited per full day elapsed since lastPassiveAt.
    const daysSincePassive = Math.floor((now - frog.lastPassiveAt) / DAY_MS);
    if (daysSincePassive > 0 && frog.lilypadLevel >= 5) {
        const perDay = frog.lilypadLevel >= 7 ? 10 : 5;
        frog.fireflies += perDay * daysSincePassive;
        frog.lastPassiveAt += daysSincePassive * DAY_MS;
    }

    if (frog.hunger <= 0) {
        if (!frog.sick) { frog.sick = true; frog.sickSince = now; }
        else if (now - frog.sickSince >= SICKNESS_GRACE_MS) { die(frog, now, 'sickness'); frog.stage = calcStage(frog, now); return frog; }
    } else if (frog.sick) {
        frog.sick = false;
        frog.sickSince = null;
    }

    if (frog.happiness <= 0) {
        if (!frog.depressed) { frog.depressed = true; frog.depressedSince = now; }
        else if (now - frog.depressedSince >= DEPRESSION_GRACE_MS) { die(frog, now, 'ran_away'); frog.stage = calcStage(frog, now); return frog; }
    } else if (frog.depressed) {
        frog.depressed = false;
        frog.depressedSince = null;
    }

    frog.stage = calcStage(frog, now);
    return frog;
}

// ── Canvas drawing ───────────────────────────────────────────────────────────
// Sprites are real artwork (Pond Assets) composited onto a procedural water background.
// A module-level cache avoids re-reading the same small PNGs from disk on every render.

const imageCache = new Map();
async function loadCachedImage(filePath) {
    if (imageCache.has(filePath)) return imageCache.get(filePath);
    const img = await loadImage(filePath);
    imageCache.set(filePath, img);
    return img;
}

function colorFileSuffix(color) {
    return color.charAt(0).toUpperCase() + color.slice(1);
}

async function loadFrogSprite(stage, color) {
    const suffix = colorFileSuffix(color);
    if (stage === 'egg') return loadCachedImage(path.join(ASSETS_DIR, 'eggs', `Egg${suffix}.png`));
    if (stage === 'tadpole') return loadCachedImage(path.join(ASSETS_DIR, 'tadpoles', `Tadpole${suffix}.png`));
    return loadCachedImage(path.join(ASSETS_DIR, 'frogs', `Frog${suffix}.png`));
}

async function loadLilypadSprite(level) {
    const clamped = Math.max(1, Math.min(MAX_LILYPAD_LEVEL, Math.round(level || 1)));
    return loadCachedImage(path.join(ASSETS_DIR, 'lilypads', `Lilypad_level_${clamped}.png`));
}

function drawWaterBackground(ctx, size, ripplePhase = 0) {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#2d6f8e');
    grad.addColorStop(1, '#173f54');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    const shift = Math.sin(ripplePhase * Math.PI * 2) * size * 0.06;
    for (let i = 0; i < 4; i++) {
        const x = ((i * size * 0.31 + shift) % size + size) % size;
        const y = size * 0.18 + i * size * 0.22;
        ctx.beginPath();
        ctx.ellipse(x, y, size * 0.16, size * 0.018, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFlowerCrown(ctx, cx, cy, s) {
    const petalColors = ['#ffffff', '#ffd6e8', '#ffffff', '#ffd6e8', '#ffffff'];
    for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        ctx.fillStyle = petalColors[i];
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(ang) * s * 0.18, cy - s * 0.62 + Math.sin(ang) * s * 0.18, s * 0.1, s * 0.065, ang, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = '#e0b94a';
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.62, s * 0.07, 0, Math.PI * 2); ctx.fill();
}

// Draws a sprite image centered at (cx, cy) scaled so its larger dimension equals `s`.
function drawSpriteImage(ctx, img, cx, cy, s) {
    const ratio = img.width / img.height;
    const w = ratio >= 1 ? s : s * ratio;
    const h = ratio >= 1 ? s / ratio : s;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

const PORTRAIT_SIZE = 240;
const ANIM_FRAMES = 8;
const ANIM_DELAY_MS = 150;

async function drawPortraitFrame(ctx, size, frog, frogImg, lilypadImg, { bob, ripplePhase }) {
    drawWaterBackground(ctx, size, ripplePhase);
    drawSpriteImage(ctx, lilypadImg, size * 0.5, size * 0.72, size * 0.62);
    const spriteScale = frog.stage === 'froglet' ? 0.5 : 0.62;
    const cx = size * 0.5, cy = size * 0.46 + bob;
    drawSpriteImage(ctx, frogImg, cx, cy, size * spriteScale);
    if (frog.stage === 'elder') drawFlowerCrown(ctx, cx, cy, size * spriteScale);
}

// Animated GIF — gentle idle bob and a slowly drifting water shimmer, looping forever.
async function drawFrogPortrait(frog) {
    const [frogImg, lilypadImg] = await Promise.all([
        loadFrogSprite(frog.stage, frog.color),
        loadLilypadSprite(frog.lilypadLevel),
    ]);

    const encoder = new GifEncoder(PORTRAIT_SIZE, PORTRAIT_SIZE, 'neuquant', true);
    encoder.setDelay(ANIM_DELAY_MS);
    encoder.setRepeat(0);
    encoder.start();

    for (let i = 0; i < ANIM_FRAMES; i++) {
        const bob = Math.sin((i / ANIM_FRAMES) * Math.PI * 2) * (PORTRAIT_SIZE * 0.025);
        const ripplePhase = i / ANIM_FRAMES;
        const canvas = createCanvas(PORTRAIT_SIZE, PORTRAIT_SIZE);
        const ctx = canvas.getContext('2d');
        await drawPortraitFrame(ctx, PORTRAIT_SIZE, frog, frogImg, lilypadImg, { bob, ripplePhase });
        ctx.font = '700 22px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(frog.name, PORTRAIT_SIZE / 2, 30);
        encoder.addFrame(ctx.getImageData(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE).data);
    }

    encoder.finish();
    return Buffer.from(encoder.out.getData());
}

const CELL_SIZE = 150;

async function drawPondScene(frogs) {
    const cols = Math.min(5, Math.max(1, frogs.length));
    const rows = Math.max(1, Math.ceil(frogs.length / cols));
    const headerH = 50;
    const W = cols * CELL_SIZE;
    const H = rows * CELL_SIZE + headerH;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#2d6f8e');
    bgGrad.addColorStop(1, '#173f54');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.font = '700 26px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('The Pond', W / 2, 36);

    for (let i = 0; i < frogs.length; i++) {
        const frog = frogs[i];
        const col = i % cols, row = Math.floor(i / cols);
        const [frogImg, lilypadImg] = await Promise.all([
            loadFrogSprite(frog.stage, frog.color),
            loadLilypadSprite(frog.lilypadLevel),
        ]);
        const x = col * CELL_SIZE, y = headerH + row * CELL_SIZE;
        drawWaterBackground(ctx, CELL_SIZE, 0);
        ctx.save();
        ctx.translate(x, y);
        drawSpriteImage(ctx, lilypadImg, CELL_SIZE * 0.5, CELL_SIZE * 0.64, CELL_SIZE * 0.6);
        const cx = CELL_SIZE * 0.5, cy = CELL_SIZE * 0.4;
        drawSpriteImage(ctx, frogImg, cx, cy, CELL_SIZE * 0.55);
        if (frog.stage === 'elder') drawFlowerCrown(ctx, cx, cy, CELL_SIZE * 0.55);
        ctx.restore();
        ctx.font = '600 14px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(frog.name, x + CELL_SIZE / 2, y + CELL_SIZE - 12);
    }

    return canvas.toBuffer('image/png');
}

// ── Slash command definitions ───────────────────────────────────────────────

const colorChoices = Object.entries(FROG_COLORS).map(([value, c]) => ({ name: c.name, value }));
const shopItemChoices = Object.entries(SHOP_ITEMS).map(([value, item]) => ({ name: item.label, value }));

const pondCommands = [
    new SlashCommandBuilder()
        .setName('frog')
        .setDescription('Take care of your pond frog')
        .addSubcommand(sub => sub
            .setName('adopt')
            .setDescription('Adopt a new frog')
            .addStringOption(opt => opt.setName('name').setDescription('Name your frog').setRequired(true).setMaxLength(20))
            .addStringOption(opt => opt.setName('color').setDescription('Pick a color').setRequired(true).addChoices(...colorChoices)))
        .addSubcommand(sub => sub
            .setName('feed')
            .setDescription('Feed your frog')
            .addBooleanOption(opt => opt.setName('use_item').setDescription('Use a worm for a bigger boost (consumes 1)')))
        .addSubcommand(sub => sub
            .setName('play')
            .setDescription('Play with your frog')
            .addBooleanOption(opt => opt.setName('use_item').setDescription('Use a toy for a bigger boost (consumes 1)')))
        .addSubcommand(sub => sub.setName('cure').setDescription('Cure your sick frog (35 fireflies)'))
        .addSubcommand(sub => sub.setName('soothe').setDescription('Throw a bubble party for your depressed frog (35 fireflies)'))
        .addSubcommand(sub => sub.setName('status').setDescription('Check on your frog'))
        .addSubcommand(sub => sub.setName('leaderboard').setDescription('See the longest-living frogs'))
        .addSubcommandGroup(group => group
            .setName('lilypad')
            .setDescription('Manage your frog\'s lilypad')
            .addSubcommand(sub => sub.setName('info').setDescription('See your lilypad level and next upgrade'))
            .addSubcommand(sub => sub.setName('upgrade').setDescription('Upgrade your lilypad to the next level'))),
    new SlashCommandBuilder()
        .setName('pond')
        .setDescription('The Pond — where everyone\'s frogs hang out')
        .addSubcommand(sub => sub.setName('view').setDescription('See everyone\'s frogs together in the pond'))
        .addSubcommand(sub => sub.setName('memorial').setDescription('Remember frogs that have passed on'))
        .addSubcommand(sub => sub.setName('rules').setDescription('How to play The Pond'))
        .addSubcommandGroup(group => group
            .setName('shop')
            .setDescription('Buy supplies for your frog')
            .addSubcommand(sub => sub
                .setName('buy')
                .setDescription('Buy an item')
                .addStringOption(opt => opt.setName('item').setDescription('What to buy').setRequired(true).addChoices(...shopItemChoices))
                .addIntegerOption(opt => opt.setName('quantity').setDescription('How many (default 1)').setMinValue(1).setMaxValue(50)))),
];

// ── Interaction handling ─────────────────────────────────────────────────────

async function handleFrogAdopt(interaction) {
    const existing = await pondFrogGet(interaction.user.id);
    if (existing && existing.alive) {
        return interaction.reply({ content: `🐸 You already have a frog named **${existing.name}**! Take care of it with \`/frog feed\` and \`/frog play\`.`, ephemeral: true });
    }
    const name = interaction.options.getString('name').trim();
    const color = interaction.options.getString('color');
    const now = Date.now();
    const frog = normalizeFrog({
        ownerId: interaction.user.id, name, color,
        stage: 'egg', hunger: 100, happiness: 100,
        bornAt: now, lastFedAt: now, lastPlayedAt: now, lastTickAt: now,
        alive: true, diedAt: null, lifespanDays: null,
    }, now);
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({
        content: `🐣 Welcome **${name}** to the pond! Keep them happy and fed with \`/frog feed\` and \`/frog play\` — check in once a day and they'll thrive.`,
        files: [new AttachmentBuilder(await drawFrogPortrait(frog), { name: 'frog.gif' })],
    });
}

async function getLiveFrog(userId) {
    const frog = await pondFrogGet(userId);
    if (!frog) return null;
    normalizeFrog(frog);
    if (frog.alive) applyDecay(frog);
    return frog;
}

async function handleFrogCare(interaction, kind) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    if (frog.justDied) {
        await pondFrogSet(interaction.user.id, frog);
        return announceDeath(interaction.client, frog).then(() =>
            interaction.reply({ content: `${deathMessage(frog)} Rest gently, little one. You can adopt a new frog with \`/frog adopt\`.` })
        );
    }

    const isFeed = kind === 'feed';
    const lastAt = isFeed ? frog.lastFedAt : frog.lastPlayedAt;
    const cooldown = isFeed ? FEED_COOLDOWN_MS : PLAY_COOLDOWN_MS;
    const remaining = cooldown - (Date.now() - lastAt);
    if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        return interaction.reply({ content: `🐸 **${frog.name}** is ${isFeed ? 'still full' : 'still happy from playtime'}! Try again in ~${mins < 60 ? `${mins}m` : `${Math.ceil(mins / 60)}h`}.`, ephemeral: true });
    }

    const useItem = interaction.options.getBoolean('use_item');
    let restore = isFeed ? FEED_RESTORE_BASE : PLAY_RESTORE_BASE;
    let usedItem = false;
    if (useItem && (isFeed ? frog.worms : frog.toys) > 0) {
        restore = ITEM_RESTORE;
        usedItem = true;
        if (isFeed) frog.worms -= 1; else frog.toys -= 1;
    } else if (isFeed && frog.lilypadLevel >= 2) {
        restore += 5;
    } else if (!isFeed && frog.lilypadLevel >= 3) {
        restore += 5;
    }

    if (isFeed) { frog.hunger = Math.min(100, frog.hunger + restore); frog.lastFedAt = Date.now(); }
    else { frog.happiness = Math.min(100, frog.happiness + restore); frog.lastPlayedAt = Date.now(); }

    await pondFrogSet(interaction.user.id, frog);
    const verb = isFeed
        ? (usedItem ? 'gobbles down a juicy worm 🪱' : 'munches happily on some flies 🪰')
        : (usedItem ? 'plays with a fun new toy 🧸' : 'hops around joyfully with you 🌿');
    await interaction.reply({
        content: `🐸 **${frog.name}** ${verb}! Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100`,
        files: [new AttachmentBuilder(await drawFrogPortrait(frog), { name: 'frog.gif' })],
    });
}

async function handleFrogCure(interaction, kind) {
    const isCure = kind === 'cure';
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    if (frog.justDied) {
        await pondFrogSet(interaction.user.id, frog);
        return announceDeath(interaction.client, frog).then(() =>
            interaction.reply({ content: `${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.` })
        );
    }
    const isAfflicted = isCure ? frog.sick : frog.depressed;
    if (!isAfflicted) {
        return interaction.reply({ content: `🐸 **${frog.name}** doesn't need that right now.`, ephemeral: true });
    }
    const cost = shopPrice(frog, isCure ? CURE_COST : SOOTHE_COST);
    if (frog.fireflies < cost) {
        return interaction.reply({ content: `🪲 You need ${cost} fireflies for that, but **${frog.name}** only has ${frog.fireflies}.`, ephemeral: true });
    }
    frog.fireflies -= cost;
    if (isCure) { frog.hunger = 50; frog.sick = false; frog.sickSince = null; }
    else { frog.happiness = 50; frog.depressed = false; frog.depressedSince = null; }

    await pondFrogSet(interaction.user.id, frog);
    const verb = isCure ? 'is nursed back to health 💊' : 'splashes joyfully through a bubble party 🫧';
    await interaction.reply({
        content: `🐸 **${frog.name}** ${verb}! (-${cost} fireflies) Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100`,
        files: [new AttachmentBuilder(await drawFrogPortrait(frog), { name: 'frog.gif' })],
    });
}

async function handleFrogStatus(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog) {
        return interaction.reply({ content: "🐸 You don't have a frog yet. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    if (!frog.alive) {
        await pondFrogSet(interaction.user.id, frog);
        if (frog.justDied) await announceDeath(interaction.client, frog);
        return interaction.reply({ content: `${deathMessage(frog)} \`/pond memorial\` to remember them. Adopt a new frog with \`/frog adopt\`.` });
    }
    await pondFrogSet(interaction.user.id, frog);
    const age = formatAge(Date.now() - frog.bornAt);
    const colorInfo = FROG_COLORS[frog.color] || FROG_COLORS.green;
    const statusFlags = [];
    if (frog.sick) statusFlags.push('🤒 sick — `/frog cure`');
    if (frog.depressed) statusFlags.push('😔 depressed — `/frog soothe`');
    await interaction.reply({
        content: `🐸 **${frog.name}** — ${frog.stage}, ${age} old\n`
            + `Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100\n`
            + `🪲 Fireflies: ${frog.fireflies} · 🍃 Lilypad: level ${frog.lilypadLevel}\n`
            + `🎨 ${colorInfo.name} — ${PERK_DESCRIPTIONS[colorInfo.perk]}`
            + (statusFlags.length ? `\n${statusFlags.join(' · ')}` : ''),
        files: [new AttachmentBuilder(await drawFrogPortrait(frog), { name: 'frog.gif' })],
    });
}

async function handleFrogLilypadInfo(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    await pondFrogSet(interaction.user.id, frog);
    const level = frog.lilypadLevel;
    const next = LILYPAD_LEVELS[level + 1];
    const lines = [`🍃 **${frog.name}**'s lilypad is level ${level} — ${LILYPAD_LEVELS[level].label}`];
    if (next) {
        lines.push(`Next: level ${level + 1} for ${shopPrice(frog, next.cost)} fireflies — ${next.label}`);
        lines.push('Upgrade with `/frog lilypad upgrade`.');
    } else {
        lines.push('Already at the max level!');
    }
    await interaction.reply({ content: lines.join('\n') });
}

async function handleFrogLilypadUpgrade(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    const next = LILYPAD_LEVELS[frog.lilypadLevel + 1];
    if (!next) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🍃 **${frog.name}**'s lilypad is already at the max level!`, ephemeral: true });
    }
    const cost = shopPrice(frog, next.cost);
    if (frog.fireflies < cost) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🪲 You need ${cost} fireflies for that upgrade, but **${frog.name}** only has ${frog.fireflies}.`, ephemeral: true });
    }
    frog.fireflies -= cost;
    frog.lilypadLevel += 1;
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({
        content: `🍃 **${frog.name}**'s lilypad is now level ${frog.lilypadLevel}! ${LILYPAD_LEVELS[frog.lilypadLevel].label} (-${cost} fireflies)`,
        files: [new AttachmentBuilder(await drawFrogPortrait(frog), { name: 'frog.gif' })],
    });
}

async function handlePondShopBuy(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    const itemKey = interaction.options.getString('item');
    const item = SHOP_ITEMS[itemKey];
    const quantity = itemKey === 'nest' ? 1 : (interaction.options.getInteger('quantity') || 1);

    if (itemKey === 'nest' && frog.hasNest) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🪺 **${frog.name}** already has a nest.`, ephemeral: true });
    }

    const unitCost = shopPrice(frog, item.cost);
    const totalCost = unitCost * quantity;
    if (frog.fireflies < totalCost) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🪲 You need ${totalCost} fireflies for ${quantity}x ${item.label}, but **${frog.name}** only has ${frog.fireflies}.`, ephemeral: true });
    }

    frog.fireflies -= totalCost;
    if (itemKey === 'worms') frog.worms += quantity;
    else if (itemKey === 'toys') frog.toys += quantity;
    else if (itemKey === 'nest') frog.hasNest = true;

    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({ content: `🛒 Bought ${quantity}x **${item.label}** for ${totalCost} fireflies! ${item.desc}` });
}

async function handleFrogLeaderboard(interaction) {
    const frogs = await pondFirestoreQuery();
    if (frogs.length === 0) {
        return interaction.reply({ content: '🐸 No frogs have been adopted yet — be the first with `/frog adopt`!' });
    }
    const now = Date.now();
    const ranked = frogs
        .map(f => ({ ...f, ageDays: f.alive ? Math.floor((now - f.bornAt) / DAY_MS) : f.lifespanDays }))
        .sort((a, b) => b.ageDays - a.ageDays)
        .slice(0, 10);
    const lines = ranked.map((f, i) =>
        `${i + 1}. **${f.name}** — ${f.ageDays} day(s) ${f.alive ? '🐸' : '🪦'}`);
    await interaction.reply({ content: `🏆 **Longest-living frogs**\n${lines.join('\n')}` });
}

async function handlePondView(interaction) {
    await interaction.deferReply();
    const frogs = (await pondFirestoreQuery({ aliveOnly: true })).map(f => normalizeFrog({ ...f, stage: calcStage(f) }));
    if (frogs.length === 0) {
        return interaction.editReply({ content: '🌿 The pond is quiet right now — adopt a frog with `/frog adopt` to bring it to life!' });
    }
    const buffer = await drawPondScene(frogs.slice(0, 30));
    await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'pond.png' })] });
}

async function handlePondMemorial(interaction) {
    const frogs = await pondFirestoreQuery();
    const departed = frogs.filter(f => !f.alive).sort((a, b) => (b.lifespanDays || 0) - (a.lifespanDays || 0)).slice(0, 15);
    if (departed.length === 0) {
        return interaction.reply({ content: '🌿 No frogs have passed on yet. The pond remembers them when they do.' });
    }
    const lines = departed.map(f => `🪦 **${f.name}** (${(FROG_COLORS[f.color] || {}).name || f.color}) — lived ${f.lifespanDays} day(s)`);
    await interaction.reply({ content: `These frogs hopped on to the great lilypad in the sky, but they'll always be remembered 💚\n\n${lines.join('\n')}` });
}

const RULES_TEXT = [
    '🐸 **The Pond — How to Play**',
    '',
    '**Getting started**',
    '`/frog adopt name:<name> color:<choice>` — adopt your one frog. Color is permanent and is also a perk:',
    '🟢 Green: hunger decays 10% slower · 🟣 Purple: happiness decays 10% slower · 🟡 Golden: 10% off shop/upgrades/cure/soothe',
    '🔵 Blue, 🩷 Pink, 🟤 Brown: perks reserved for exploration/rock fights/hawks/breeding, coming in a later update',
    '',
    '**Daily care**',
    'Hunger and happiness both drain ~2/hr on their own — one or two check-ins a day keeps a frog comfortably ahead of it.',
    '`/frog feed [use_item]` — +8 hunger (4h cooldown). `use_item:true` consumes a worm for +16 instead.',
    '`/frog play [use_item]` — +8 happiness (4h cooldown). `use_item:true` consumes a toy for +16 instead.',
    '`/frog status` — portrait, stats, fireflies, lilypad level, and any sickness/depression.',
    '',
    '**If you neglect it**',
    'Hunger hits 0 → **sick**: 72h to `/frog cure` (35 fireflies, hunger → 50) or the frog dies.',
    'Happiness hits 0 → **depressed**: 72h to `/frog soothe` (35 fireflies, happiness → 50) or it runs away for good.',
    'Sickness and depression are independent — a frog can be both at once. Every frog also passes peacefully of old age at **75 days**, however well cared for.',
    '',
    '**Economy**',
    '`/pond shop buy item:<worms|toys|nest> quantity:<n>` — worms/toys are 2 fireflies each; a nest is a one-time 100 fireflies, reserved for future baby breeding.',
    '`/frog lilypad info` / `/frog lilypad upgrade` — spend fireflies (10-200 across 10 levels) on bigger feed/play bonuses, daily passive income, and slower decay.',
    'Once a week, everyone pays a 5% pond-maintenance tax on their current fireflies balance — automatic, no command needed.',
    '',
    '**Community**',
    '`/pond view` — every living frog together · `/pond memorial` — frogs that have passed · `/frog leaderboard` — longest-living frogs',
    '',
    '*Coming later: exploration, rock fights, a hawk minigame, careers, frog mayors, partnerships, and baby breeding.*',
].join('\n');

async function handlePondRules(interaction) {
    await interaction.reply({ content: RULES_TEXT });
}

async function announceDeath(client, frog) {
    if (!POND_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(POND_CHANNEL_ID);
        await channel.send({ content: deathMessage(frog) });
    } catch (e) { console.error('[Pond] announceDeath failed:', e.message); }
}

async function handlePondInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
    try {
        if (interaction.commandName === 'frog') {
            const group = interaction.options.getSubcommandGroup(false);
            const sub = interaction.options.getSubcommand();
            if (group === 'lilypad') {
                if (sub === 'info') return handleFrogLilypadInfo(interaction);
                if (sub === 'upgrade') return handleFrogLilypadUpgrade(interaction);
            }
            if (sub === 'adopt') return handleFrogAdopt(interaction);
            if (sub === 'feed') return handleFrogCare(interaction, 'feed');
            if (sub === 'play') return handleFrogCare(interaction, 'play');
            if (sub === 'cure') return handleFrogCure(interaction, 'cure');
            if (sub === 'soothe') return handleFrogCure(interaction, 'soothe');
            if (sub === 'status') return handleFrogStatus(interaction);
            if (sub === 'leaderboard') return handleFrogLeaderboard(interaction);
        }
        if (interaction.commandName === 'pond') {
            const group = interaction.options.getSubcommandGroup(false);
            const sub = interaction.options.getSubcommand();
            if (group === 'shop' && sub === 'buy') return handlePondShopBuy(interaction);
            if (sub === 'view') return handlePondView(interaction);
            if (sub === 'memorial') return handlePondMemorial(interaction);
            if (sub === 'rules') return handlePondRules(interaction);
        }
    } catch (e) {
        console.error('[Pond] handlePondInteraction failed:', e.stack || e.message);
        const payload = { content: '❌ Something went wrong in the pond. Try again in a moment.', ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
    }
}

// ── Decay ticker ─────────────────────────────────────────────────────────────

let tickerRunning = false;

async function runPondTax(client) {
    const meta = await pondFirestoreGet(POND_META_DOC_ID);
    const now = Date.now();
    if (!meta || !meta.lastPondTaxAt) {
        // First run after this feature shipped — start the 7-day clock now instead of
        // taxing everyone immediately on rollout day.
        await pondFirestoreSet(POND_META_DOC_ID, { lastPondTaxAt: now }, 'pondMeta');
        return;
    }
    if (now - meta.lastPondTaxAt < POND_TAX_INTERVAL_MS) return;

    const frogs = await pondFirestoreQuery({ aliveOnly: true });
    let totalCollected = 0;
    for (const frog of frogs) {
        normalizeFrog(frog);
        const owed = Math.floor(frog.fireflies * POND_TAX_RATE);
        if (owed <= 0) continue;
        frog.fireflies -= owed;
        totalCollected += owed;
        await pondFrogSet(frog.ownerId, { fireflies: frog.fireflies });
    }
    await pondFirestoreSet(POND_META_DOC_ID, { lastPondTaxAt: now }, 'pondMeta');

    if (totalCollected > 0 && POND_CHANNEL_ID) {
        try {
            const channel = await client.channels.fetch(POND_CHANNEL_ID);
            await channel.send({ content: `🪲 **Pond maintenance day!** ${totalCollected} fireflies were collected (5% of everyone's balance) to keep the pond clean and tidy. 🌿` });
        } catch (e) { console.error('[Pond] runPondTax announce failed:', e.message); }
    }
}

async function runPondTick(client) {
    if (tickerRunning) return;
    tickerRunning = true;
    try {
        const frogs = await pondFirestoreQuery({ aliveOnly: true });
        for (const frog of frogs) {
            normalizeFrog(frog);
            const before = frog.alive;
            applyDecay(frog);
            await pondFrogSet(frog.ownerId, {
                hunger: frog.hunger, happiness: frog.happiness, stage: frog.stage,
                lastTickAt: frog.lastTickAt, fireflies: frog.fireflies, lastPassiveAt: frog.lastPassiveAt,
                sick: frog.sick, sickSince: frog.sickSince, depressed: frog.depressed, depressedSince: frog.depressedSince,
                alive: frog.alive, diedAt: frog.diedAt, deathReason: frog.deathReason, lifespanDays: frog.lifespanDays,
                ownerId: frog.ownerId, name: frog.name, color: frog.color, lilypadLevel: frog.lilypadLevel,
                worms: frog.worms, toys: frog.toys, hasNest: frog.hasNest,
                bornAt: frog.bornAt, lastFedAt: frog.lastFedAt, lastPlayedAt: frog.lastPlayedAt,
            });
            if (before && !frog.alive) await announceDeath(client, frog);
        }
        await runPondTax(client);
    } catch (e) {
        console.error('[Pond] runPondTick error:', e.stack || e.message);
    } finally {
        tickerRunning = false;
    }
}

function startPondTicker(client) {
    setInterval(() => runPondTick(client).catch(() => {}), TICK_INTERVAL_MS);
    setTimeout(() => runPondTick(client).catch(() => {}), 10000); // first tick 10s after ready
}

module.exports = {
    pondCommands,
    isPondCommand,
    handlePondInteraction,
    startPondTicker,
};
