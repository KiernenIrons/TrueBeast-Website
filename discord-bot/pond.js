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
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
const FEED_RESTORE_BASE = 20;
const PLAY_RESTORE_BASE = 20;
const ITEM_RESTORE      = 35; // worms/toys give this instead of the base amount
const CURE_COST   = 35;
const SOOTHE_COST = 35;
const SICKNESS_GRACE_MS   = 3 * DAY_MS;
const DEPRESSION_GRACE_MS = 3 * DAY_MS;
const MAX_AGE_DAYS = 75;
const TICK_INTERVAL_MS  = 60 * 60 * 1000;
const POND_TAX_INTERVAL_MS = 7 * DAY_MS;
const POND_TAX_RATE = 0.05;

const EXPLORE_COOLDOWN_MS = DAY_MS;
const HAWK_COOLDOWN_MS = DAY_MS;
const HAWK_WIN_REWARD = 20;
const HAWK_LOSS_RATE = 0.10;
const HAWK_LOSS_RATE_REDUCED = 0.05; // lilypad level 6+
const HAWK_BASE_MISTAKE_CHANCE = 0.20;
const HAWK_GAME_TIMEOUT_MS = 10 * 60 * 1000;

const ROCKFIGHT_MIN_WAGER = 5;
const ROCKFIGHT_MAX_WAGER = 20;
const ROCKFIGHT_EXPIRY_MS = 10 * 60 * 1000;

const FISHER_INCOME = 3;
const FISHER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CAREER_RESPEC_COST = 35;
const CAREER_MIN_STAGE_DAYS = 14;

const CAREERS = {
    fisher:    { label: 'Fisher Frog',    desc: 'Earns 3 fireflies every 12 hours' },
    hunter:    { label: 'Hunter Frog',    desc: '10% better odds against hawks' },
    caretaker: { label: 'Caretaker Frog', desc: 'Hunger and happiness decay 10% slower' },
    explorer:  { label: 'Explorer Frog',  desc: '+10% rewards from exploration' },
    nursery:   { label: 'Nursery Frog',   desc: 'Babies mature 10% faster (once breeding ships)' },
};

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
    worms: { cost: 2,   label: 'Worms', desc: '+35 hunger when fed (instead of +20)' },
    toys:  { cost: 2,   label: 'Toys',  desc: '+35 happiness when played with (instead of +20)' },
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

// Firestore's PATCH replaces the *entire* document with only the fields given unless an
// updateMask is supplied — without it, a partial write like `{ fireflies: x }` would wipe
// every other field off the doc. updateMask.fieldPaths makes this a true partial merge.
async function pondFirestoreSet(docId, data, kind = 'pondFrog') {
    const fieldNames = ['kind', ...Object.keys(data)];
    const maskQuery = fieldNames.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/${docId}?key=${FIREBASE_API_KEY}&${maskQuery}`;
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
    if (frog.lastExploreAt === undefined) frog.lastExploreAt = null;
    if (frog.lastHawkAt === undefined) frog.lastHawkAt = null;
    if (frog.lastFisherAt == null) frog.lastFisherAt = now;
    if (frog.career === undefined) frog.career = null;
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
    const caretakerSlow = frog.career === 'caretaker' ? 0.9 : 1;
    const hungerRate    = HUNGER_DECAY_PER_HOUR    * (colorPerk(frog) === 'hungerSlower'    ? 0.9 : 1) * lilypadSlow * caretakerSlow;
    const happinessRate = HAPPINESS_DECAY_PER_HOUR * (colorPerk(frog) === 'happinessSlower' ? 0.9 : 1) * lilypadSlow * caretakerSlow;
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

    // Fisher career passive income — credited per full 12h interval elapsed.
    if (frog.career === 'fisher') {
        const intervalsSinceFisher = Math.floor((now - frog.lastFisherAt) / FISHER_INTERVAL_MS);
        if (intervalsSinceFisher > 0) {
            frog.fireflies += FISHER_INCOME * intervalsSinceFisher;
            frog.lastFisherAt += intervalsSinceFisher * FISHER_INTERVAL_MS;
        }
    } else {
        frog.lastFisherAt = now;
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

function hasUnlockedCareer(frog, now = Date.now()) {
    return (now - frog.bornAt) / DAY_MS >= CAREER_MIN_STAGE_DAYS;
}

function explorationBonusMult(frog) {
    let bonus = 0;
    if (colorPerk(frog) === 'explorationBoost') bonus += 0.10;
    if (frog.career === 'explorer') bonus += 0.10;
    return 1 + bonus;
}

// Tier probabilities aren't specified by the design doc — picked to make exploration the
// primary early-game firefly source without making it swingy.
const EXPLORATION_TABLE = [
    { tier: 'common', weight: 0.55, outcomes: [
        { text: 'finds nothing of interest', fireflies: 0 },
        { text: 'finds a few stray fireflies', fireflies: 5 },
        { text: 'finds a small cluster of fireflies', fireflies: 10 },
    ] },
    { tier: 'uncommon', weight: 0.30, outcomes: [
        { text: 'finds a nice patch of fireflies', fireflies: 20 },
        { text: 'meets a friendly turtle', happiness: 10 },
        { text: 'finds a patch of juicy worms', hunger: 10 },
    ] },
    { tier: 'rare', weight: 0.15, outcomes: [
        { text: 'gets ambushed by an angry goose and loses some fireflies', fireflies: -10 },
        { text: 'stumbles on a huge firefly swarm', fireflies: 50 },
    ] },
];

function rollExploration(frog) {
    const roll = Math.random();
    let cumulative = 0;
    let tier = EXPLORATION_TABLE[EXPLORATION_TABLE.length - 1];
    for (const t of EXPLORATION_TABLE) {
        cumulative += t.weight;
        if (roll <= cumulative) { tier = t; break; }
    }
    const outcome = tier.outcomes[Math.floor(Math.random() * tier.outcomes.length)];
    let fireflyGain = outcome.fireflies || 0;
    if (fireflyGain > 0) {
        fireflyGain = Math.round(fireflyGain * explorationBonusMult(frog));
        if (frog.lilypadLevel >= 4) fireflyGain += 2;
        if (frog.lilypadLevel >= 8) fireflyGain += 3;
    }
    return { tier: tier.tier, text: outcome.text, fireflies: fireflyGain, hunger: outcome.hunger || 0, happiness: outcome.happiness || 0 };
}

// Zero-sum: each frog's "luck bonus" comes from age (capped at +15pp right at the 75-day
// max-age mark) plus the pink color perk. The challenger's win chance is nudged by the
// difference between the two frogs' bonuses, not an independent roll per side.
function luckBonus(frog, now = Date.now()) {
    const ageDays = (now - frog.bornAt) / DAY_MS;
    let bonus = Math.min(0.15, ageDays * 0.002);
    if (colorPerk(frog) === 'luckBoost') bonus += 0.05;
    return bonus;
}

function rockfightWinChance(challenger, opponent, now = Date.now()) {
    const diff = luckBonus(challenger, now) - luckBonus(opponent, now);
    return Math.max(0.15, Math.min(0.85, 0.5 + diff / 2));
}

// ── Hawk minigame (tic-tac-toe vs a minimax AI) ──────────────────────────────
// The AI always picks the objectively best move, but has a chance to play a random move
// instead — that mistake chance is how "hunter career" and "pink luck" become meaningful
// against what would otherwise be an unbeatable opponent.

const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function tttWinner(board) {
    for (const [a, b, c] of TTT_LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.every(c => c) ? 'draw' : null;
}

function tttEmptyCells(board) {
    return board.reduce((acc, v, i) => { if (!v) acc.push(i); return acc; }, []);
}

function tttMinimax(board, isMaximizing) {
    const winner = tttWinner(board);
    if (winner === 'O') return 10;
    if (winner === 'X') return -10;
    if (winner === 'draw') return 0;
    const cells = tttEmptyCells(board);
    if (isMaximizing) {
        let best = -Infinity;
        for (const i of cells) { board[i] = 'O'; best = Math.max(best, tttMinimax(board, false)); board[i] = null; }
        return best;
    }
    let best = Infinity;
    for (const i of cells) { board[i] = 'X'; best = Math.min(best, tttMinimax(board, true)); board[i] = null; }
    return best;
}

function tttBestMove(board) {
    let bestScore = -Infinity, bestIdx = tttEmptyCells(board)[0];
    for (const i of tttEmptyCells(board)) {
        board[i] = 'O';
        const score = tttMinimax(board, false);
        board[i] = null;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestIdx;
}

function tttAiMove(board, mistakeChance) {
    const cells = tttEmptyCells(board);
    if (Math.random() < mistakeChance) return cells[Math.floor(Math.random() * cells.length)];
    return tttBestMove(board);
}

function hawkMistakeChance(frog) {
    let chance = HAWK_BASE_MISTAKE_CHANCE;
    if (frog.career === 'hunter') chance += 0.10;
    if (colorPerk(frog) === 'luckBoost') chance += 0.05;
    return Math.min(0.5, chance);
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

// width/height instead of a single `size` so this can paint one continuous water surface
// across a whole multi-cell scene (drawPondScene) rather than each cell repainting an
// identical mini-background — that repetition was what made /pond view look "tiled".
// Ripple placement is randomized (not an evenly-spaced grid) for the same reason.
function drawWaterBackground(ctx, width, height, ripplePhase = 0) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#2d6f8e');
    grad.addColorStop(1, '#173f54');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const shift = Math.sin(ripplePhase * Math.PI * 2) * width * 0.03;
    const rippleCount = Math.max(4, Math.round((width * height) / 16000));
    for (let i = 0; i < rippleCount; i++) {
        const x = ((rippleSeed(i, 1) * width + shift) % width + width) % width;
        const y = rippleSeed(i, 2) * height;
        const rw = width * (0.05 + rippleSeed(i, 3) * 0.08);
        ctx.beginPath();
        ctx.ellipse(x, y, rw, height * 0.012, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Deterministic pseudo-random in [0, 1) — same (i, salt) always gives the same value, so a
// frame-by-frame animated background doesn't jitter, but the sequence itself isn't a
// regular grid like a plain modulo placement would be.
function rippleSeed(i, salt) {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
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
    drawWaterBackground(ctx, size, size, ripplePhase);
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

    // One continuous water surface across the whole scene, painted once — drawing an
    // identical mini water-background per cell made the grid look visibly tiled.
    drawWaterBackground(ctx, W, H, 0);

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
const careerChoices = Object.entries(CAREERS).map(([value, c]) => ({ name: c.label, value }));

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
        .addSubcommand(sub => sub.setName('explore').setDescription('Send your frog exploring (once a day)'))
        .addSubcommand(sub => sub.setName('hawk').setDescription('Battle a hawk in tic-tac-toe (once a day)'))
        .addSubcommandGroup(group => group
            .setName('lilypad')
            .setDescription('Manage your frog\'s lilypad')
            .addSubcommand(sub => sub.setName('info').setDescription('See your lilypad level and next upgrade'))
            .addSubcommand(sub => sub.setName('upgrade').setDescription('Upgrade your lilypad to the next level')))
        .addSubcommandGroup(group => group
            .setName('rockfight')
            .setDescription('Challenge another frog to a rock-throwing fight')
            .addSubcommand(sub => sub
                .setName('challenge')
                .setDescription('Challenge a specific player')
                .addUserOption(opt => opt.setName('user').setDescription('Who to challenge').setRequired(true))
                .addIntegerOption(opt => opt.setName('wager').setDescription('Fireflies to wager (5-20)').setRequired(true).setMinValue(ROCKFIGHT_MIN_WAGER).setMaxValue(ROCKFIGHT_MAX_WAGER)))
            .addSubcommand(sub => sub
                .setName('any')
                .setDescription('Open a challenge for anyone to accept')
                .addIntegerOption(opt => opt.setName('wager').setDescription('Fireflies to wager (5-20)').setRequired(true).setMinValue(ROCKFIGHT_MIN_WAGER).setMaxValue(ROCKFIGHT_MAX_WAGER))))
        .addSubcommandGroup(group => group
            .setName('career')
            .setDescription('Manage your frog\'s career (unlocks at day 14)')
            .addSubcommand(sub => sub.setName('info').setDescription('See your current career'))
            .addSubcommand(sub => sub
                .setName('choose')
                .setDescription('Choose your first career (free)')
                .addStringOption(opt => opt.setName('career').setDescription('Which career').setRequired(true).addChoices(...careerChoices)))
            .addSubcommand(sub => sub
                .setName('respec')
                .setDescription(`Change career for a fee (${CAREER_RESPEC_COST} fireflies)`)
                .addStringOption(opt => opt.setName('career').setDescription('Which career').setRequired(true).addChoices(...careerChoices)))),
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
// Short-lived multiplayer state (hawk games, rock-fight challenges) lives in-memory,
// keyed by message ID — same pattern as the Imposter/Traitors/Escape Room games in
// index.js, just scoped to this module. Only the persistent frog doc goes to Firestore.

const pondHawkGames = new Map();      // messageId → { ownerId, board, mistakeChance, timer }
const pondRockfights = new Map();     // messageId → { challengerId, targetId (null = open), wager, resolved, timer }

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

async function handleFrogExplore(interaction) {
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
    const remaining = EXPLORE_COOLDOWN_MS - (Date.now() - (frog.lastExploreAt || 0));
    if (frog.lastExploreAt && remaining > 0) {
        const hrs = Math.ceil(remaining / (60 * 60 * 1000));
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🌿 **${frog.name}** already explored today. Try again in ~${hrs}h.`, ephemeral: true });
    }

    const result = rollExploration(frog);
    frog.lastExploreAt = Date.now();
    frog.fireflies = Math.max(0, frog.fireflies + result.fireflies);
    if (result.hunger) frog.hunger = Math.min(100, frog.hunger + result.hunger);
    if (result.happiness) frog.happiness = Math.min(100, frog.happiness + result.happiness);

    await pondFrogSet(interaction.user.id, frog);
    const parts = [`🧭 **${frog.name}** ${result.text}!`];
    if (result.fireflies) parts.push(`${result.fireflies > 0 ? '+' : ''}${result.fireflies} fireflies`);
    if (result.hunger) parts.push(`+${result.hunger} hunger`);
    if (result.happiness) parts.push(`+${result.happiness} happiness`);
    await interaction.reply({ content: parts.join(' ') });
}

async function handleFrogCareerInfo(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    await pondFrogSet(interaction.user.id, frog);
    if (!frog.career) {
        const unlocked = hasUnlockedCareer(frog);
        return interaction.reply({ content: unlocked
            ? `🐸 **${frog.name}** hasn't picked a career yet. Use \`/frog career choose\` to pick one (free the first time).`
            : `🐸 **${frog.name}** is too young for a career yet — careers unlock at day ${CAREER_MIN_STAGE_DAYS}.` });
    }
    const c = CAREERS[frog.career];
    await interaction.reply({ content: `🐸 **${frog.name}** is a **${c.label}** — ${c.desc}.\nChange career anytime with \`/frog career respec\` (${shopPrice(frog, CAREER_RESPEC_COST)} fireflies).` });
}

async function handleFrogCareerSet(interaction, isRespec) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
    }
    if (!hasUnlockedCareer(frog)) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐸 **${frog.name}** is too young for a career yet — careers unlock at day ${CAREER_MIN_STAGE_DAYS}.`, ephemeral: true });
    }
    if (isRespec && !frog.career) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐸 **${frog.name}** doesn't have a career yet — use \`/frog career choose\` for your first (free) pick.`, ephemeral: true });
    }
    if (!isRespec && frog.career) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐸 **${frog.name}** is already a ${CAREERS[frog.career].label} — use \`/frog career respec\` to change.`, ephemeral: true });
    }
    const career = interaction.options.getString('career');
    let cost = 0;
    if (isRespec) {
        cost = shopPrice(frog, CAREER_RESPEC_COST);
        if (frog.fireflies < cost) {
            await pondFrogSet(interaction.user.id, frog);
            return interaction.reply({ content: `🪲 You need ${cost} fireflies to respec, but **${frog.name}** only has ${frog.fireflies}.`, ephemeral: true });
        }
        frog.fireflies -= cost;
    }
    frog.career = career;
    await pondFrogSet(interaction.user.id, frog);
    const c = CAREERS[career];
    await interaction.reply({ content: `🐸 **${frog.name}** is now a **${c.label}**! ${c.desc}.${cost ? ` (-${cost} fireflies)` : ''}` });
}

// ── Hawk minigame ─────────────────────────────────────────────────────────────

function hawkBoardComponents(board, gameOver) {
    const rows = [];
    for (let r = 0; r < 3; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 3; c++) {
            const i = r * 3 + c;
            const cell = board[i];
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`pond:hawk:${i}`)
                    .setLabel(cell || '⬜')
                    .setStyle(cell === 'X' ? ButtonStyle.Primary : cell === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary)
                    .setDisabled(Boolean(cell) || gameOver)
            );
        }
        rows.push(row);
    }
    return rows;
}

async function handleFrogHawk(interaction) {
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
    const remaining = HAWK_COOLDOWN_MS - (Date.now() - (frog.lastHawkAt || 0));
    if (frog.lastHawkAt && remaining > 0) {
        const hrs = Math.ceil(remaining / (60 * 60 * 1000));
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🦅 **${frog.name}** already faced the hawk today. Try again in ~${hrs}h.`, ephemeral: true });
    }

    frog.lastHawkAt = Date.now();
    await pondFrogSet(interaction.user.id, frog);

    const board = Array(9).fill(null);
    await interaction.reply({
        content: `🦅 **${frog.name}** vs the hawk! You're 🟦 (X), the hawk is 🟥 (O). Click a square.`,
        components: hawkBoardComponents(board, false),
    });
    const msg = await interaction.fetchReply();
    const state = {
        ownerId: interaction.user.id,
        board,
        mistakeChance: hawkMistakeChance(frog),
        timer: null,
    };
    state.timer = setTimeout(() => {
        if (pondHawkGames.get(msg.id) === state) {
            pondHawkGames.delete(msg.id);
            msg.edit({ content: '🦅 The hawk lost interest and flew off — game expired.', components: [] }).catch(() => {});
        }
    }, HAWK_GAME_TIMEOUT_MS);
    pondHawkGames.set(msg.id, state);
}

async function finishHawkGame(interaction, state, msg, resultText, fireflyDelta) {
    clearTimeout(state.timer);
    pondHawkGames.delete(msg.id);
    const frog = await getLiveFrog(state.ownerId);
    let content = resultText;
    if (frog && frog.alive) {
        if (fireflyDelta > 0) {
            frog.fireflies += fireflyDelta;
            content += ` +${fireflyDelta} fireflies.`;
        } else if (fireflyDelta < 0) {
            frog.fireflies = Math.max(0, frog.fireflies + fireflyDelta);
            content += ` ${fireflyDelta} fireflies.`;
        }
        await pondFrogSet(state.ownerId, frog);
    }
    await interaction.update({ content, components: [] }).catch(() => msg.edit({ content, components: [] }).catch(() => {}));
}

async function handleHawkButton(interaction) {
    const msg = interaction.message;
    const state = pondHawkGames.get(msg.id);
    if (!state) {
        return interaction.reply({ content: '🦅 This hawk battle has expired.', ephemeral: true });
    }
    if (interaction.user.id !== state.ownerId) {
        return interaction.reply({ content: "🐸 This isn't your hawk battle!", ephemeral: true });
    }
    const cell = Number(interaction.customId.split(':')[2]);
    if (state.board[cell]) {
        return interaction.reply({ content: 'That square is already taken.', ephemeral: true });
    }

    state.board[cell] = 'X';
    let winner = tttWinner(state.board);
    if (!winner) {
        const aiMove = tttAiMove(state.board, state.mistakeChance);
        state.board[aiMove] = 'O';
        winner = tttWinner(state.board);
    }

    if (!winner) {
        return interaction.update({ components: hawkBoardComponents(state.board, false) });
    }

    if (winner === 'X') {
        return finishHawkGame(interaction, state, msg, '🎉 You beat the hawk!', HAWK_WIN_REWARD);
    }
    if (winner === 'O') {
        const frog = await getLiveFrog(state.ownerId);
        const lossRate = frog && frog.lilypadLevel >= 6 ? HAWK_LOSS_RATE_REDUCED : HAWK_LOSS_RATE;
        const lost = frog ? -Math.floor(frog.fireflies * lossRate) : 0;
        return finishHawkGame(interaction, state, msg, '🦅 The hawk got the upper hand this time.', lost);
    }
    return finishHawkGame(interaction, state, msg, "🤝 It's a draw — the hawk gave up the chase.", 0);
}

// ── Rock fights ────────────────────────────────────────────────────────────────

function rockfightComponents() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pond:rf:accept').setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('🥊'),
        new ButtonBuilder().setCustomId('pond:rf:decline').setLabel('Decline').setStyle(ButtonStyle.Danger),
    )];
}

async function handleFrogRockfight(interaction, isOpen) {
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
    const wager = interaction.options.getInteger('wager');
    if (frog.fireflies < wager) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🪲 You need ${wager} fireflies to wager that much, but **${frog.name}** only has ${frog.fireflies}.`, ephemeral: true });
    }
    await pondFrogSet(interaction.user.id, frog);

    const target = isOpen ? null : interaction.options.getUser('user');
    if (target && target.id === interaction.user.id) {
        return interaction.reply({ content: "🐸 You can't challenge your own frog!", ephemeral: true });
    }

    const content = isOpen
        ? `🥊 **${frog.name}** opens a rock fight for **${wager}** fireflies — anyone, click Accept!`
        : `🥊 **${frog.name}** challenges <@${target.id}> to a rock fight for **${wager}** fireflies!`;
    await interaction.reply({ content, components: rockfightComponents() });
    const msg = await interaction.fetchReply();

    const state = {
        challengerId: interaction.user.id,
        targetId: target ? target.id : null,
        wager,
        resolved: false,
        timer: null,
    };
    state.timer = setTimeout(() => {
        if (pondRockfights.get(msg.id) === state && !state.resolved) {
            state.resolved = true;
            pondRockfights.delete(msg.id);
            msg.edit({ content: `${content}\n*Challenge expired.*`, components: [] }).catch(() => {});
        }
    }, ROCKFIGHT_EXPIRY_MS);
    pondRockfights.set(msg.id, state);
}

async function handleRockfightButton(interaction) {
    const msg = interaction.message;
    const state = pondRockfights.get(msg.id);
    if (!state || state.resolved) {
        return interaction.reply({ content: '🥊 This challenge has already been settled or expired.', ephemeral: true });
    }
    const isAccept = interaction.customId === 'pond:rf:accept';
    const isDecline = interaction.customId === 'pond:rf:decline';

    if (state.targetId) {
        if (interaction.user.id !== state.targetId) {
            return interaction.reply({ content: "🐸 This challenge isn't for you!", ephemeral: true });
        }
    } else if (isAccept && interaction.user.id === state.challengerId) {
        return interaction.reply({ content: "🐸 You can't accept your own open challenge!", ephemeral: true });
    } else if (isDecline && interaction.user.id !== state.challengerId) {
        return interaction.reply({ content: '🐸 Only the challenger can cancel an open challenge — feel free to Accept it instead!', ephemeral: true });
    }

    if (isDecline) {
        if (state.resolved) return;
        state.resolved = true;
        clearTimeout(state.timer);
        pondRockfights.delete(msg.id);
        return interaction.update({ content: '🥊 Challenge declined.', components: [] });
    }
    if (!isAccept) return;

    // Synchronous check-and-set before any await — closes the race window where two
    // clicks on an open challenge could both pass the `!state.resolved` check above.
    if (state.resolved) return;
    state.resolved = true;
    clearTimeout(state.timer);
    pondRockfights.delete(msg.id);

    const challenger = await getLiveFrog(state.challengerId);
    const opponent = await getLiveFrog(interaction.user.id);
    if (!challenger || !challenger.alive || !opponent || !opponent.alive) {
        return interaction.update({ content: '🥊 One of the frogs is no longer around to fight — challenge cancelled.', components: [] });
    }
    if (challenger.fireflies < state.wager || opponent.fireflies < state.wager) {
        return interaction.update({ content: "🥊 One of you can't cover the wager anymore — challenge cancelled.", components: [] });
    }

    const winChance = rockfightWinChance(challenger, opponent);
    const challengerWins = Math.random() < winChance;
    challenger.fireflies += challengerWins ? state.wager : -state.wager;
    opponent.fireflies += challengerWins ? -state.wager : state.wager;
    await pondFrogSet(state.challengerId, { fireflies: challenger.fireflies });
    await pondFrogSet(interaction.user.id, { fireflies: opponent.fireflies });

    const winnerName = challengerWins ? challenger.name : opponent.name;
    const loserName = challengerWins ? opponent.name : challenger.name;
    await interaction.update({
        content: `🥊 **${winnerName}** wins the rock fight against **${loserName}** and takes **${state.wager}** fireflies!`,
        components: [],
    });
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

const RULES_TEXT_1 = [
    '🐸 **The Pond — How to Play (1/2)**',
    '',
    '**Getting started**',
    '`/frog adopt name:<name> color:<choice>` — adopt your one frog. Color is permanent and is also a perk:',
    '🟢 Green: hunger decays 10% slower · 🟣 Purple: happiness decays 10% slower · 🟡 Golden: 10% off shop/upgrades/cure/soothe',
    '🔵 Blue: +10% exploration rewards · 🩷 Pink: +10% luck (rock fights/hawks) · 🟤 Brown: perk reserved for future baby breeding',
    '',
    '**Daily care**',
    'Hunger and happiness both drain ~2/hr on their own — one or two check-ins a day keeps a frog comfortably ahead of it.',
    '`/frog feed [use_item]` — +20 hunger (4h cooldown). `use_item:true` consumes a worm for +35 instead.',
    '`/frog play [use_item]` — +20 happiness (4h cooldown). `use_item:true` consumes a toy for +35 instead.',
    '`/frog status` — portrait, stats, fireflies, lilypad level, career, and any sickness/depression.',
    '',
    '**If you neglect it**',
    'Hunger hits 0 → **sick**: 72h to `/frog cure` (35 fireflies, hunger → 50) or the frog dies.',
    'Happiness hits 0 → **depressed**: 72h to `/frog soothe` (35 fireflies, happiness → 50) or it runs away for good.',
    'Sickness and depression are independent. Every frog also passes peacefully of old age at **75 days**, however well cared for.',
].join('\n');

const RULES_TEXT_2 = [
    '🐸 **The Pond — How to Play (2/2)**',
    '',
    '**Earning fireflies**',
    '`/frog explore` — once a day, send your frog out for a random reward (mostly fireflies, sometimes a happiness/hunger boost, rarely a goose steals some).',
    '`/frog hawk` — once a day, battle a hawk in tic-tac-toe for 20 fireflies. Lose and you forfeit 10% of your fireflies (5% at lilypad level 6+).',
    '`/frog rockfight challenge user:<@user> wager:<5-20>` or `/frog rockfight any wager:<5-20>` — wager fireflies on a rock fight against a specific player or an open challenge anyone can accept. Older, luckier frogs have better odds.',
    '',
    '**Careers (unlock at day 14)**',
    '`/frog career info|choose|respec` — pick a career for free the first time (fisher: passive income, hunter: better hawk odds, caretaker: slower decay, explorer: better exploration, nursery: reserved for future breeding); changing later costs a fee.',
    '',
    '**Spending fireflies**',
    '`/pond shop buy item:<worms|toys|nest> quantity:<n>` — worms/toys 2 fireflies each; a nest is a one-time 100 fireflies, reserved for future baby breeding.',
    '`/frog lilypad info` / `/frog lilypad upgrade` — spend fireflies (10-200 across 10 levels) on bigger feed/play bonuses, daily passive income, and slower decay.',
    'Once a week, everyone pays a 5% pond-maintenance tax on their current fireflies balance — automatic, no command needed.',
    '',
    '**Community**',
    '`/pond view` · `/pond memorial` · `/frog leaderboard`',
    '',
    '*Coming later: frog mayors, partnerships, and baby breeding.*',
].join('\n');

async function handlePondRules(interaction) {
    await interaction.reply({ content: RULES_TEXT_1 });
    await interaction.followUp({ content: RULES_TEXT_2 });
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
                if (sub === 'info') return await handleFrogLilypadInfo(interaction);
                if (sub === 'upgrade') return await handleFrogLilypadUpgrade(interaction);
            }
            if (group === 'rockfight') {
                if (sub === 'challenge') return await handleFrogRockfight(interaction, false);
                if (sub === 'any') return await handleFrogRockfight(interaction, true);
            }
            if (group === 'career') {
                if (sub === 'info') return await handleFrogCareerInfo(interaction);
                if (sub === 'choose') return await handleFrogCareerSet(interaction, false);
                if (sub === 'respec') return await handleFrogCareerSet(interaction, true);
            }
            if (sub === 'adopt') return await handleFrogAdopt(interaction);
            if (sub === 'feed') return await handleFrogCare(interaction, 'feed');
            if (sub === 'play') return await handleFrogCare(interaction, 'play');
            if (sub === 'cure') return await handleFrogCure(interaction, 'cure');
            if (sub === 'soothe') return await handleFrogCure(interaction, 'soothe');
            if (sub === 'status') return await handleFrogStatus(interaction);
            if (sub === 'leaderboard') return await handleFrogLeaderboard(interaction);
            if (sub === 'explore') return await handleFrogExplore(interaction);
            if (sub === 'hawk') return await handleFrogHawk(interaction);
        }
        if (interaction.commandName === 'pond') {
            const group = interaction.options.getSubcommandGroup(false);
            const sub = interaction.options.getSubcommand();
            if (group === 'shop' && sub === 'buy') return await handlePondShopBuy(interaction);
            if (sub === 'view') return await handlePondView(interaction);
            if (sub === 'memorial') return await handlePondMemorial(interaction);
            if (sub === 'rules') return await handlePondRules(interaction);
        }
    } catch (e) {
        console.error('[Pond] handlePondInteraction failed:', e.stack || e.message);
        const payload = { content: '❌ Something went wrong in the pond. Try again in a moment.', ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
    }
}

function isPondButton(customId) {
    return typeof customId === 'string' && customId.startsWith('pond:');
}

async function handlePondButtonInteraction(interaction) {
    if (!interaction.isButton()) return;
    try {
        if (interaction.customId.startsWith('pond:hawk:')) return await handleHawkButton(interaction);
        if (interaction.customId === 'pond:rf:accept' || interaction.customId === 'pond:rf:decline') return await handleRockfightButton(interaction);
    } catch (e) {
        console.error('[Pond] handlePondButtonInteraction failed:', e.stack || e.message);
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
                lastTickAt: frog.lastTickAt, fireflies: frog.fireflies, lastPassiveAt: frog.lastPassiveAt, lastFisherAt: frog.lastFisherAt,
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
    isPondButton,
    handlePondButtonInteraction,
    startPondTicker,
};
