/**
 * The Pond — cozy tamagotchi-style frog game with a fireflies economy.
 * See GAME_POND.md for full design notes.
 */

const path = require('path');
const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
try { GlobalFonts.loadFontsFromDir('/usr/share/fonts'); } catch (_) {}
const GifEncoder = require('gif-encoder-2');

const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const POND_CHANNEL_ID = process.env.POND_CHANNEL_ID || '1517699652982407168';
const DAY_MS = 24 * 60 * 60 * 1000;
const ASSETS_DIR = path.join(__dirname, 'assets', 'pond');

const HUNGER_DECAY_PER_HOUR    = 2; // 8 per 4h
const HAPPINESS_DECAY_PER_HOUR = 2; // 8 per 4h
const FEED_COOLDOWN_MS  = 4 * 60 * 60 * 1000;
const PLAY_COOLDOWN_MS  = 4 * 60 * 60 * 1000;
const FEED_RESTORE_BASE = 20;
const PLAY_RESTORE_BASE = 20;
const ITEM_RESTORE      = 35;
const CURE_COST   = 35;
const SOOTHE_COST = 35;
const SICKNESS_GRACE_MS   = 3 * DAY_MS;
const DEPRESSION_GRACE_MS = 3 * DAY_MS;
const MAX_AGE_DAYS = 75;
const TICK_INTERVAL_MS = 60 * 60 * 1000;
const POND_TAX_RATE = 0.10;

const EXPLORE_DAILY_BASE = 2;
const HAWK_DAILY_BASE    = 2;
const HAWK_WIN_REWARD    = 20;
const HAWK_LOSS_RATE     = 0.10;
const HAWK_LOSS_RATE_REDUCED = 0.05;
const HAWK_BASE_MISTAKE_CHANCE = 0.20;
const HAWK_GAME_TIMEOUT_MS = 10 * 60 * 1000;

const FROGFIGHT_MIN_WAGER = 5;
const FROGFIGHT_MAX_WAGER = 20;
const FROGFIGHT_EXPIRY_MS = 10 * 60 * 1000;

const FISHER_INCOME = 3;
const FISHER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const CAREER_RESPEC_COST = 35;
const CAREER_MIN_STAGE_DAYS = 7;

const MAYOR_FIREFLY_BONUS  = 0.10;
const MAYOR_AGE_RATE       = 1.10;
const MAYOR_PASSIVE_PER_DAY = 2;

const BABY_MATURE_MS           = 7 * DAY_MS;
const BABY_SALE_PRICE          = 50;
const BABY_BREED_MIN_DAYS      = 14;
const BABY_HUNGER_DANGER       = 50;  // hunger below this endangers the baby
const BABY_HUNGER_DANGER_MS    = 12 * 60 * 60 * 1000;

const PARTNER_HAPPINESS_PER_DAY = 2;
const PARTNER_REQUEST_EXPIRY_MS = 5 * 60 * 1000;

const EVENT_BUTTON_EXPIRY_MS = 15 * 60 * 1000;
// Timed event modifiers — checked inside explore/hawk handlers via live pond_meta read
const EVENT_HAWK_SEASON_MS      = 24 * 60 * 60 * 1000;
const EVENT_MYSTERIOUS_FROG_MS  = 12 * 60 * 60 * 1000;
const GOLDEN_DRAGONFLY_CHANCE   = 0.01;
const GOLDEN_DRAGONFLY_REWARD   = 100;

const STAGE_THRESHOLDS_DAYS = [
    { stage: 'egg',     minDays: 0 },
    { stage: 'tadpole', minDays: 2 },
    { stage: 'froglet', minDays: 4 },
    { stage: 'frog',    minDays: 7 },
    { stage: 'elder',   minDays: 60 },
];

const FROG_COLORS = {
    green:  { name: 'Lily Green',   hex: '#5fb95f', perk: 'hungerSlower' },
    blue:   { name: 'Pond Blue',    hex: '#4f8fd1', perk: 'explorationBoost' },
    pink:   { name: 'Axolotl Pink', hex: '#e892b5', perk: 'luckBoost' },
    gold:   { name: 'Golden',       hex: '#e0b94a', perk: 'shopDiscount' },
    purple: { name: 'Poison Dart',  hex: '#9b6fd6', perk: 'happinessSlower' },
    brown:  { name: 'Marsh Brown',  hex: '#a9764f', perk: 'babyBonus' },
};

const PERK_DESCRIPTIONS = {
    hungerSlower:     'Hunger decays 12.5% slower',
    explorationBoost: '+10% rewards from exploration',
    luckBoost:        '+10% luck against hawks',
    shopDiscount:     '10% shop discount',
    happinessSlower:  'Happiness decays 12.5% slower',
    babyBonus:        'Babies worth 10% more',
};

const LILYPAD_LEVELS = {
    1:  { cost: 0,   label: 'Starting lilypad' },
    2:  { cost: 10,  label: '+2 fireflies from exploration' },
    3:  { cost: 15,  label: 'Daily passive income (+5 fireflies/day)' },
    4:  { cost: 25,  label: '+5 hunger from feeding' },
    5:  { cost: 40,  label: '+5 happiness from playing' },
    6:  { cost: 75,  label: 'Hawk loss reduced to 5% of fireflies' },
    7:  { cost: 100, label: '+5 additional daily passive income (total +10/day)' },
    8:  { cost: 120, label: 'Hunger and happiness decay 15% slower' },
    9:  { cost: 150, label: '+1 extra exploration slot per day' },
    10: { cost: 200, label: '100 fireflies reward + special cosmetic (coming soon)' },
};
const MAX_LILYPAD_LEVEL = 10;

const SHOP_ITEMS = {
    worms: { cost: 2,   label: 'Worms', desc: '+35 hunger when fed (instead of +20)' },
    toys:  { cost: 2,   label: 'Toys',  desc: '+35 happiness when played with (instead of +20)' },
    nest:  { cost: 100, label: 'Nest',  desc: 'Allows 1 extra baby (max 1 per frog)' },
};

// ── Pillar 2: Consumable Boosts ───────────────────────────────────────────────
const BOOST_ITEMS = {
    snail_polish:  { cost: 20, label: 'Snail Shell Polish', desc: '+50% hawk win reward on your next hawk battle' },
    ff_magnet:     { cost: 25, label: 'Firefly Magnet',     desc: '2× fireflies from your next explore' },
    midnight_glow: { cost: 30, label: 'Midnight Glow',      desc: '+5 fireflies on all gains for 4 hours' },
    mud_bath:      { cost: 15, label: 'Warm Mud Bath',       desc: 'Instantly +15 hunger and +15 happiness' },
    tadpole_tonic: { cost: 35, label: 'Tadpole Tonic',       desc: '−20% hunger & happiness decay for 24 hours' },
    lucky_clover:  { cost: 45, label: 'Lucky Clover',        desc: '+15pp hawk battle luck for 6 hours' },
};

// ── Pillar 3: Cosmetics ───────────────────────────────────────────────────────
const COSMETIC_ITEMS = {
    lily_crown:     { cost: 40,  label: 'Lily Crown',       desc: 'A wreath of lily petals (accessory)', slot: 'accessory' },
    fishing_rod:    { cost: 50,  label: 'Fishing Rod',      desc: 'A rod resting beside your frog (accessory)', slot: 'accessory' },
    party_hat:      { cost: 60,  label: 'Party Hat',        desc: 'Colorful striped cone hat (headwear)', slot: 'hat' },
    pond_mist:      { cost: 70,  label: 'Pond Mist',        desc: 'Soft blue glow beneath your frog (effect)', slot: 'effect' },
    mushroom_cap:   { cost: 80,  label: 'Mushroom Cap',     desc: 'Tiny spotted mushroom on your head (headwear)', slot: 'hat' },
    tiny_sword:     { cost: 85,  label: 'Tiny Sword',       desc: 'A little blade held proudly (accessory)', slot: 'accessory' },
    firefly_halo:   { cost: 90,  label: 'Firefly Halo',     desc: 'Orbiting firefly dots around your frog (effect)', slot: 'effect' },
    wizard_hat:     { cost: 120, label: 'Wizard Hat',       desc: 'A pointy star hat (headwear)', slot: 'hat' },
    golden_shimmer: { cost: 150, label: 'Golden Shimmer',   desc: 'Gold particle shimmer over your frog (effect)', slot: 'effect' },
    royal_crown:    { cost: 200, label: 'Royal Crown',      desc: 'Gold crown — the ultimate flex (headwear)', slot: 'hat' },
};

// ── Pillar 1: Pond Investments ────────────────────────────────────────────────
const INVESTMENTS = {
    algae_farm: {
        label: 'Algae Farm',
        desc: 'Attracts fireflies with algae',
        tiers: [
            { cost: 40,  income: 3 },
            { cost: 90,  income: 7 },
            { cost: 175, income: 14 },
        ],
    },
    lantern: {
        label: 'Firefly Lantern',
        desc: 'A glowing lantern that draws fireflies at night',
        tiers: [
            { cost: 60,  income: 4 },
            { cost: 130, income: 9 },
            { cost: 250, income: 18 },
        ],
    },
    lily_garden: {
        label: 'Lily Garden',
        desc: 'Extra lilypads — also boosts exploration firefly gains',
        tiers: [
            { cost: 50,  income: 3,  exploreBonus: 0.05 },
            { cost: 110, income: 6,  exploreBonus: 0.10 },
            { cost: 200, income: 11, exploreBonus: 0.15 },
        ],
    },
    worm_farm: {
        label: 'Worm Farm',
        desc: 'Self-replenishing worms and toys on a timer',
        tiers: [
            { cost: 35,  intervalDays: 3, items: { worms: 1 } },
            { cost: 75,  intervalDays: 2, items: { worms: 1 } },
            { cost: 140, intervalDays: 1, items: { worms: 1, toys: 1 } },
        ],
    },
};

const INVEST_FIELD_MAP = {
    algae_farm:  'investAlgaeFarm',
    lantern:     'investLantern',
    lily_garden: 'investLilyGarden',
    worm_farm:   'investWormFarm',
};

// ── Pillar 4: Legacy & Prestige ───────────────────────────────────────────────
const LEGACY_BONUSES = {
    ancestral_wisdom: { cost: 5,  label: 'Ancestral Wisdom',  desc: 'Next frog starts with +10 extra 🪲 (stackable ×5)', stackable: true,  maxStack: 5 },
    heirloom_lilypad: { cost: 8,  label: 'Heirloom Lilypad',  desc: 'Next frog starts at lilypad level 2',               stackable: false },
    elders_memory:    { cost: 10, label: "Elder's Memory",     desc: '+1 permanent bonus to all explore 🪲 (stackable ×5)', stackable: true, maxStack: 5 },
    gilded_egg:       { cost: 15, label: 'Gilded Egg',         desc: 'Next frog inherits your full cosmetics collection', stackable: false },
    deep_roots:       { cost: 20, label: 'Deep Roots',         desc: 'Next frog gains +2 days of passive income from birth', stackable: false },
    legacy_nameplate: { cost: 3,  label: 'Legacy Nameplate',   desc: 'Your status shows "Generation X" — a mark of experience', stackable: false },
};

const CAREERS = {
    fisher:    { label: 'Fisher Frog',    desc: 'Earns 3 fireflies every 12 hours' },
    hunter:    { label: 'Hunter Frog',    desc: '10% better odds against hawks' },
    caretaker: { label: 'Caretaker Frog', desc: 'Hunger and happiness decay 12.5% slower' },
    explorer:  { label: 'Explorer Frog',  desc: '+10% rewards from exploration' },
    nursery:   { label: 'Nursery Frog',   desc: 'Babies mature 10% faster (once breeding ships)' },
};

const POND_COMMAND_NAMES = new Set(['frog', 'pond']);
function isPondCommand(name) { return POND_COMMAND_NAMES.has(name); }

// ── Firestore helpers ─────────────────────────────────────────────────────────

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

const POND_DOC_PREFIX = 'pond_';
const POND_META_DOC_ID = 'pond_meta';

async function pondFirestoreSet(docId, data, kind = 'pondFrog') {
    const fieldNames = ['kind', ...Object.keys(data)];
    const maskQuery = fieldNames.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/botConfig/${docId}?key=${FIREBASE_API_KEY}&${maskQuery}`;
    const fields = { kind: { stringValue: kind } };
    for (const [k, v] of Object.entries(data)) fields[k] = toFirestoreValue(v);
    try {
        const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
        if (!res.ok) {
            const body = await res.text().catch(() => '(unreadable)');
            console.error(`[Pond] pondFirestoreSet ${docId} HTTP ${res.status}:`, body);
            return false;
        }
        return true;
    } catch (e) { console.error(`[Pond] pondFirestoreSet ${docId} failed:`, e.message); return false; }
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
    if (aliveOnly) filters.push({ fieldFilter: { field: { fieldPath: 'alive' }, op: 'EQUAL', value: { booleanValue: true } } });
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
    } catch (e) { console.error('[Pond] pondFirestoreQuery error:', e.message); return []; }
}

async function pondFrogGet(userId) { return pondFirestoreGet(`${POND_DOC_PREFIX}${userId}`); }
async function pondFrogSet(userId, data) {
    // justDied and babyEaten are runtime-only flags — never persist them to Firestore.
    const { justDied: _jd, babyEaten: _be, ...clean } = data;
    return pondFirestoreSet(`${POND_DOC_PREFIX}${userId}`, clean, 'pondFrog');
}


// ── Game logic ────────────────────────────────────────────────────────────────

function normalizeFrog(frog, now = Date.now()) {
    if (frog.fireflies == null) frog.fireflies = 0;
    if (!frog.patchV2Granted) { frog.fireflies += 15; frog.patchV2Granted = true; }
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
    if (frog.lastFisherAt == null) frog.lastFisherAt = now;
    if (frog.career === undefined) frog.career = null;
    if (frog.exploresToday == null) frog.exploresToday = 0;
    if (frog.exploresResetDay === undefined) frog.exploresResetDay = null;
    if (frog.hawksDoneToday == null) frog.hawksDoneToday = 0;
    if (frog.hawksResetDay === undefined) frog.hawksResetDay = null;
    if (frog.isMayor == null) frog.isMayor = false;
    if (frog.lastCareerRespecAt === undefined) frog.lastCareerRespecAt = null;
    if (frog.lilypadL10Claimed == null) frog.lilypadL10Claimed = false;
    if (frog.hasBaby == null) frog.hasBaby = false;
    if (frog.babyBornAt === undefined) frog.babyBornAt = null;
    if (frog.hungerDangerSince === undefined) frog.hungerDangerSince = null;
    if (frog.partnerId === undefined) frog.partnerId = null;
    // Pillar 2 — Boosts
    if (frog.boostHawkShell == null)    frog.boostHawkShell = false;
    if (frog.boostExploreNext == null)  frog.boostExploreNext = false;
    if (frog.boostMidnightGlow == null) frog.boostMidnightGlow = null;
    if (frog.boostTadpoleTonic == null) frog.boostTadpoleTonic = null;
    if (frog.boostLuckyClover == null)  frog.boostLuckyClover = null;
    // Pillar 1 — Investments
    if (frog.investAlgaeFarm == null)  frog.investAlgaeFarm = 0;
    if (frog.investLantern == null)    frog.investLantern = 0;
    if (frog.investLilyGarden == null) frog.investLilyGarden = 0;
    if (frog.investWormFarm == null)   frog.investWormFarm = 0;
    if (frog.lastWormFarmAt == null)   frog.lastWormFarmAt = now;
    // Pillar 3 — Cosmetics
    if (frog.cosmeticsStr == null)      frog.cosmeticsStr = '';
    if (frog.equippedHat == null)       frog.equippedHat = null;
    if (frog.equippedEffect == null)    frog.equippedEffect = null;
    if (frog.equippedAccessory == null) frog.equippedAccessory = null;
    // Pillar 4 — Legacy
    if (frog.legacyPoints == null)             frog.legacyPoints = 0;
    if (frog.lilyTokens == null)               frog.lilyTokens = 0;
    if (frog.legacyGen == null)                frog.legacyGen = 0;
    if (frog.legacyBonusFireflies == null)     frog.legacyBonusFireflies = 0;
    if (frog.legacyBonusExplore == null)       frog.legacyBonusExplore = 0;
    if (frog.legacyHeirloomLilypad == null)    frog.legacyHeirloomLilypad = false;
    if (frog.legacyInheritedCosmetic == null)  frog.legacyInheritedCosmetic = null;
    if (frog.legacyDeepRoots == null)          frog.legacyDeepRoots = false;
    if (frog.legacyNameplate == null)          frog.legacyNameplate = false;
    return frog;
}

function getTodayKey() { return new Date().toISOString().slice(0, 10); }
function getExploreLimit(frog) { return frog.lilypadLevel >= 9 ? EXPLORE_DAILY_BASE + 1 : EXPLORE_DAILY_BASE; }

function calcStage(frog, now = Date.now(), ageMult = 1) {
    const ageDays = ((now - frog.bornAt) / DAY_MS) * ageMult;
    let stage = 'egg';
    for (const t of STAGE_THRESHOLDS_DAYS) { if (ageDays >= t.minDays) stage = t.stage; }
    return stage;
}

function formatAge(ms) {
    const days = Math.floor(ms / DAY_MS);
    if (days < 1) return 'less than a day';
    if (days === 1) return '1 day';
    return `${days} days`;
}

function colorPerk(frog) { return (FROG_COLORS[frog.color] || FROG_COLORS.green).perk; }
function shopPrice(frog, baseCost) { return colorPerk(frog) === 'shopDiscount' ? Math.ceil(baseCost * 0.9) : baseCost; }
function mayorMult(frog) { return frog.isMayor ? (1 + MAYOR_FIREFLY_BONUS) : 1; }

function getCosmetics(frog) {
    if (!frog.cosmeticsStr) return [];
    return frog.cosmeticsStr.split(',').filter(Boolean);
}

function isLegacyBonusMaxed(doc, key) {
    if (key === 'ancestral_wisdom') return (doc.legacyBonusFireflies || 0) >= 50;
    if (key === 'heirloom_lilypad') return !!doc.legacyHeirloomLilypad;
    if (key === 'elders_memory')    return (doc.legacyBonusExplore || 0) >= 5;
    if (key === 'gilded_egg')       return !!doc.legacyInheritedCosmetic;
    if (key === 'deep_roots')       return !!doc.legacyDeepRoots;
    if (key === 'legacy_nameplate') return !!doc.legacyNameplate;
    return false;
}

function calcLegacyScore(frog) {
    const days = frog.lifespanDays || 0;
    const ff   = Math.floor((frog.fireflies || 0) / 10);
    const lily = (frog.lilypadLevel - 1) * 5;
    const invSum = (frog.investAlgaeFarm||0) + (frog.investLantern||0) + (frog.investLilyGarden||0) + (frog.investWormFarm||0);
    const cosmeticPts = getCosmetics(frog).length * 5;
    const career  = frog.career  ? 10 : 0;
    const nest    = frog.hasNest  ? 5  : 0;
    const baby    = frog.hasBaby  ? 10 : 0;
    const partner = frog.partnerId ? 5 : 0;
    const mayor   = frog.isMayor  ? 20 : 0;
    return days * 2 + ff + lily + invSum * 3 + cosmeticPts + career + nest + baby + partner + mayor;
}

function die(frog, now, reason) {
    frog.alive = false; frog.diedAt = now; frog.deathReason = reason;
    frog.lifespanDays = Math.max(0, Math.round((now - frog.bornAt) / DAY_MS));
    frog.justDied = true;
}

const DEATH_MESSAGES = {
    old_age:  f => `🌼 **${f.name}** lived a long, full life and passed peacefully of old age after ${f.lifespanDays ?? 0} day(s).`,
    sickness: f => `💔 **${f.name}** fell ill and passed away without a cure after ${f.lifespanDays ?? 0} day(s).`,
    ran_away: f => `🐸 **${f.name}** grew too lonely and hopped away for good after ${f.lifespanDays ?? 0} day(s).`,
    gassed:   f => `💀 **${f.name}** met an untimely end after ${f.lifespanDays ?? 0} day(s). Gassed. Gone. 🪦`,
};
function deathMessage(frog) { return (DEATH_MESSAGES[frog.deathReason] || DEATH_MESSAGES.old_age)(frog); }

function applyDecay(frog, now = Date.now()) {
    normalizeFrog(frog, now);
    const ageMult = frog.isMayor ? MAYOR_AGE_RATE : 1;
    const ageDays = ((now - frog.bornAt) / DAY_MS) * ageMult;
    if (ageDays >= MAX_AGE_DAYS) {
        die(frog, now, 'old_age');
        frog.stage = calcStage(frog, now, ageMult);
        return frog;
    }

    const hours = Math.max(0, (now - frog.lastTickAt) / (60 * 60 * 1000));
    const lilypadSlow   = frog.lilypadLevel >= 8 ? 0.85 : 1;
    const caretakerSlow = frog.career === 'caretaker' ? 0.875 : 1;
    const tonicSlow     = (frog.boostTadpoleTonic && now < frog.boostTadpoleTonic) ? 0.80 : 1;
    const hungerRate    = HUNGER_DECAY_PER_HOUR    * (colorPerk(frog) === 'hungerSlower'    ? 0.875 : 1) * lilypadSlow * caretakerSlow * tonicSlow;
    const happinessRate = HAPPINESS_DECAY_PER_HOUR * (colorPerk(frog) === 'happinessSlower' ? 0.875 : 1) * lilypadSlow * caretakerSlow * tonicSlow;
    frog.hunger    = Math.max(0, Math.min(100, frog.hunger    - hungerRate    * hours));
    frog.happiness = Math.max(0, Math.min(100, frog.happiness - happinessRate * hours));
    frog.lastTickAt = now;

    const daysSincePassive = Math.floor((now - frog.lastPassiveAt) / DAY_MS);
    if (daysSincePassive > 0) {
        if (frog.lilypadLevel >= 3) {
            const perDay = frog.lilypadLevel >= 7 ? 10 : 5;
            frog.fireflies += Math.round(perDay * daysSincePassive * mayorMult(frog));
        }
        if (frog.isMayor) {
            frog.hunger    = Math.min(100, frog.hunger    + MAYOR_PASSIVE_PER_DAY * daysSincePassive);
            frog.happiness = Math.min(100, frog.happiness + MAYOR_PASSIVE_PER_DAY * daysSincePassive);
        }
        if (frog.partnerId) {
            frog.happiness = Math.min(100, frog.happiness + PARTNER_HAPPINESS_PER_DAY * daysSincePassive);
        }
        // Investment passive income
        if (frog.investAlgaeFarm  > 0) frog.fireflies += Math.round(INVESTMENTS.algae_farm.tiers[frog.investAlgaeFarm  - 1].income * daysSincePassive * mayorMult(frog));
        if (frog.investLantern    > 0) frog.fireflies += Math.round(INVESTMENTS.lantern.tiers[frog.investLantern        - 1].income * daysSincePassive * mayorMult(frog));
        if (frog.investLilyGarden > 0) frog.fireflies += Math.round(INVESTMENTS.lily_garden.tiers[frog.investLilyGarden - 1].income * daysSincePassive * mayorMult(frog));
        frog.lastPassiveAt += daysSincePassive * DAY_MS;
    }

    // Worm farm item accrual (separate per-interval timer)
    if (frog.investWormFarm > 0) {
        const wfTier = INVESTMENTS.worm_farm.tiers[frog.investWormFarm - 1];
        const wfIntervalMs = wfTier.intervalDays * DAY_MS;
        const wfIntervals = Math.floor((now - frog.lastWormFarmAt) / wfIntervalMs);
        if (wfIntervals > 0) {
            frog.worms = Math.min(99, frog.worms + (wfTier.items.worms || 0) * wfIntervals);
            if (wfTier.items.toys) frog.toys = Math.min(99, frog.toys + wfTier.items.toys * wfIntervals);
            frog.lastWormFarmAt += wfIntervals * wfIntervalMs;
        }
    }

    if (frog.career === 'fisher') {
        const intervals = Math.floor((now - frog.lastFisherAt) / FISHER_INTERVAL_MS);
        if (intervals > 0) {
            frog.fireflies += Math.round(FISHER_INCOME * intervals * mayorMult(frog));
            frog.lastFisherAt += intervals * FISHER_INTERVAL_MS;
        }
    } else {
        frog.lastFisherAt = now;
    }

    if (frog.hunger <= 0) {
        if (!frog.sick) { frog.sick = true; frog.sickSince = now; }
        else if (now - frog.sickSince >= SICKNESS_GRACE_MS) { die(frog, now, 'sickness'); frog.stage = calcStage(frog, now, ageMult); return frog; }
    } else if (frog.sick) { frog.sick = false; frog.sickSince = null; }

    if (frog.happiness <= 0) {
        if (!frog.depressed) { frog.depressed = true; frog.depressedSince = now; }
        else if (now - frog.depressedSince >= DEPRESSION_GRACE_MS) { die(frog, now, 'ran_away'); frog.stage = calcStage(frog, now, ageMult); return frog; }
    } else if (frog.depressed) { frog.depressed = false; frog.depressedSince = null; }

    // Baby hunger danger: hunger below 50 for 12+ hours → baby is eaten
    if (frog.hasBaby) {
        if (frog.hunger < BABY_HUNGER_DANGER) {
            if (!frog.hungerDangerSince) frog.hungerDangerSince = now;
            else if (now - frog.hungerDangerSince >= BABY_HUNGER_DANGER_MS) {
                frog.hasBaby = false; frog.babyBornAt = null; frog.hungerDangerSince = null;
                frog.babyEaten = true;
            }
        } else {
            frog.hungerDangerSince = null;
        }
    }

    frog.stage = calcStage(frog, now, ageMult);
    return frog;
}

function hasUnlockedCareer(frog, now = Date.now()) {
    return (now - frog.bornAt) / DAY_MS >= CAREER_MIN_STAGE_DAYS;
}

// Returns the most recent Monday 11:00 UTC (= 12:00 GMT+1).
function lastMondayRespecWindowMs() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun,1=Mon,...
    const daysBack = day === 0 ? 6 : day - 1;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, 11, 0, 0));
    return monday.getTime();
}

// Returns the most recent Friday 11:00 UTC (= 12:00 GMT+1).
function lastFridayTaxWindowMs() {
    const now = new Date();
    const day = now.getUTCDay(); // 5=Fri
    const daysBack = day >= 5 ? day - 5 : day + 2;
    const friday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, 11, 0, 0));
    return friday.getTime();
}

// Returns the most recent Wednesday 20:00 UTC for mayor election.
function lastWednesdayElectionMs() {
    const now = new Date();
    const day = now.getUTCDay(); // 3=Wed
    const daysBack = day >= 3 ? day - 3 : day + 4;
    const wed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack, 20, 0, 0));
    return wed.getTime();
}

// ── Exploration ───────────────────────────────────────────────────────────────

function explorationBonusMult(frog) {
    let bonus = 0;
    if (colorPerk(frog) === 'explorationBoost') bonus += 0.10;
    if (frog.career === 'explorer') bonus += 0.10;
    if (frog.investLilyGarden > 0) bonus += INVESTMENTS.lily_garden.tiers[frog.investLilyGarden - 1].exploreBonus || 0;
    return 1 + bonus;
}

const EXPLORATION_OUTCOMES = [
    { weight: 0.25, text: 'finds nothing of interest',          fireflies: 0 },
    { weight: 0.25, text: 'finds a few stray fireflies',        fireflies: 5 },
    { weight: 0.20, text: 'finds a small cluster of fireflies', fireflies: 10 },
    { weight: 0.10, text: 'finds a nice patch of fireflies',    fireflies: 20 },
    { weight: 0.01, text: 'stumbles on a huge firefly swarm!',  fireflies: 50 },
    { weight: 0.075, text: 'meets a friendly turtle',           happiness: 10 },
    { weight: 0.075, text: 'finds a patch of juicy worms',      hunger: 10 },
    { weight: 0.04,  text: 'gets ambushed by an angry goose!',  fireflies: -10 },
];

function rollExploration(frog) {
    const roll = Math.random();
    let cumulative = 0;
    let outcome = EXPLORATION_OUTCOMES[EXPLORATION_OUTCOMES.length - 1];
    for (const o of EXPLORATION_OUTCOMES) {
        cumulative += o.weight;
        if (roll <= cumulative) { outcome = o; break; }
    }
    let fireflyGain = outcome.fireflies || 0;
    if (fireflyGain > 0) {
        fireflyGain = Math.round(fireflyGain * explorationBonusMult(frog) * mayorMult(frog));
        if (frog.lilypadLevel >= 2) fireflyGain += 2;
        if (frog.legacyBonusExplore > 0) fireflyGain += frog.legacyBonusExplore;
    }
    return { text: outcome.text, fireflies: fireflyGain, hunger: outcome.hunger || 0, happiness: outcome.happiness || 0 };
}

// ── Hawk / frog fight shared helpers ─────────────────────────────────────────

function luckBonus(frog, now = Date.now()) {
    const ageDays = (now - frog.bornAt) / DAY_MS;
    return Math.min(0.15, ageDays * 0.002);
}

function hawkMistakeChance(frog) {
    let chance = HAWK_BASE_MISTAKE_CHANCE;
    if (frog.career === 'hunter') chance += 0.10;
    if (colorPerk(frog) === 'luckBoost') chance += 0.05;
    if (frog.boostLuckyClover && Date.now() < frog.boostLuckyClover) chance += 0.15;
    return Math.min(0.5, chance);
}

// ── TTT helpers ───────────────────────────────────────────────────────────────

const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function tttWinner(board) {
    for (const [a,b,c] of TTT_LINES) { if (board[a] && board[a]===board[b] && board[a]===board[c]) return board[a]; }
    return board.every(c=>c) ? 'draw' : null;
}

function tttEmptyCells(board) { return board.reduce((a,v,i)=>{ if(!v)a.push(i); return a; },[]); }

function tttMinimax(board, isMax) {
    const w = tttWinner(board);
    if (w==='O') return 10; if (w==='X') return -10; if (w==='draw') return 0;
    const cells = tttEmptyCells(board);
    if (isMax) { let b=-Infinity; for(const i of cells){board[i]='O';b=Math.max(b,tttMinimax(board,false));board[i]=null;} return b; }
    let b=Infinity; for(const i of cells){board[i]='X';b=Math.min(b,tttMinimax(board,true));board[i]=null;} return b;
}

function tttBestMove(board) {
    let best=-Infinity, idx=tttEmptyCells(board)[0];
    for(const i of tttEmptyCells(board)){board[i]='O';const s=tttMinimax(board,false);board[i]=null;if(s>best){best=s;idx=i;}}
    return idx;
}

function tttAiMove(board, mistakeChance) {
    const cells = tttEmptyCells(board);
    return Math.random()<mistakeChance ? cells[Math.floor(Math.random()*cells.length)] : tttBestMove(board);
}

function tttBoardComponents(board, gameOver, prefix) {
    const rows=[];
    for(let r=0;r<3;r++){
        const row=new ActionRowBuilder();
        for(let c=0;c<3;c++){
            const i=r*3+c, cell=board[i];
            row.addComponents(new ButtonBuilder().setCustomId(`${prefix}${i}`).setLabel(cell||'⬜').setStyle(cell==='X'?ButtonStyle.Primary:cell==='O'?ButtonStyle.Danger:ButtonStyle.Secondary).setDisabled(Boolean(cell)||gameOver));
        }
        rows.push(row);
    }
    return rows;
}

// RPS helpers
const RPS_BEATS = { rock: 'worm', worm: 'lily', lily: 'rock' };
const RPS_LABELS = { rock: '🪨 Rock', worm: '🪱 Worm', lily: '🍃 Lilypad' };
function rpsResult(a, b) { if(a===b)return 'draw'; return RPS_BEATS[a]===b?'win':'lose'; }

function rpsComponents(prefix, disabled=false) {
    return [new ActionRowBuilder().addComponents(
        ...Object.entries(RPS_LABELS).map(([k,label])=>new ButtonBuilder().setCustomId(`${prefix}${k}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled))
    )];
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

const imageCache = new Map();
async function loadCachedImage(fp) {
    if (imageCache.has(fp)) return imageCache.get(fp);
    const img = await loadImage(fp);
    imageCache.set(fp, img);
    return img;
}
function colorFileSuffix(c) { return c.charAt(0).toUpperCase()+c.slice(1); }
async function loadFrogSprite(stage, color) {
    const s = colorFileSuffix(color);
    if (stage==='egg')     return loadCachedImage(path.join(ASSETS_DIR,'eggs',`Egg${s}.png`));
    if (stage==='tadpole') return loadCachedImage(path.join(ASSETS_DIR,'tadpoles',`Tadpole${s}.png`));
    if (stage==='froglet') return loadCachedImage(path.join(ASSETS_DIR,'froglets',`Froglet${s}.png`));
    return loadCachedImage(path.join(ASSETS_DIR,'frogs',`Frog${s}.png`));
}
async function loadLilypadSprite(level) {
    return loadCachedImage(path.join(ASSETS_DIR,'lilypads',`Lilypad_level_${Math.max(1,Math.min(MAX_LILYPAD_LEVEL,Math.round(level||1)))}.png`));
}

function drawWaterBackground(ctx, W, H, ripplePhase=0) {
    const grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#2d6f8e'); grad.addColorStop(1,'#173f54');
    ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='rgba(255,255,255,0.08)';
    const shift=Math.sin(ripplePhase*Math.PI*2)*W*0.03;
    const count=Math.max(4,Math.round((W*H)/16000));
    for(let i=0;i<count;i++){
        const x=((rs(i,1)*W+shift)%W+W)%W, y=rs(i,2)*H, rw=W*(0.05+rs(i,3)*0.08);
        ctx.beginPath(); ctx.ellipse(x,y,rw,H*0.012,0,0,Math.PI*2); ctx.fill();
    }
}
function rs(i,salt){const x=Math.sin(i*12.9898+salt*78.233)*43758.5453;return x-Math.floor(x);}

function drawFlowerCrown(ctx,cx,cy,s){
    const pc=['#ffffff','#ffd6e8','#ffffff','#ffd6e8','#ffffff'];
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;ctx.fillStyle=pc[i];ctx.beginPath();ctx.ellipse(cx+Math.cos(a)*s*0.18,cy-s*0.62+Math.sin(a)*s*0.18,s*0.1,s*0.065,a,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#e0b94a';ctx.beginPath();ctx.arc(cx,cy-s*0.62,s*0.07,0,Math.PI*2);ctx.fill();
}
function drawSpriteImage(ctx,img,cx,cy,s){const r=img.width/img.height,w=r>=1?s:s*r,h=r>=1?s/r:s;ctx.drawImage(img,cx-w/2,cy-h/2,w,h);}

// ── Cosmetic draw functions ───────────────────────────────────────────────────

function drawPartyHat(ctx,cx,cy,s){
    ctx.save();ctx.translate(cx,cy-s*0.58);
    ctx.beginPath();ctx.moveTo(0,-s*0.32);ctx.lineTo(-s*0.12,0);ctx.lineTo(s*0.12,0);ctx.closePath();
    ctx.fillStyle='#e74c3c';ctx.fill();
    const stripeColors=['#f1c40f','#3498db','#2ecc71'];
    for(let i=0;i<3;i++){const yp=-s*0.26+i*s*0.085;ctx.beginPath();ctx.moveTo(-s*(0.04+i*0.025),yp);ctx.lineTo(s*(0.04+i*0.025),yp);ctx.lineWidth=s*0.02;ctx.strokeStyle=stripeColors[i];ctx.stroke();}
    ctx.beginPath();ctx.arc(0,-s*0.32,s*0.025,0,Math.PI*2);ctx.fillStyle='#f1c40f';ctx.fill();
    ctx.restore();
}

function drawMushroomCap(ctx,cx,cy,s){
    ctx.save();ctx.translate(cx,cy-s*0.58);
    ctx.beginPath();ctx.ellipse(0,0,s*0.18,s*0.11,0,0,Math.PI,true);ctx.fillStyle='#c0392b';ctx.fill();
    ctx.fillStyle='#ffffff';
    for(const sp of [{x:-0.07,y:-0.04},{x:0.05,y:-0.06},{x:0.1,y:0.01}]){ctx.beginPath();ctx.arc(sp.x*s,sp.y*s,s*0.025,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#f5e6c8';ctx.fillRect(-s*0.04,0,s*0.08,s*0.07);
    ctx.restore();
}

function drawWizardHat(ctx,cx,cy,s){
    ctx.save();ctx.translate(cx,cy-s*0.58);
    ctx.beginPath();ctx.ellipse(0,0,s*0.2,s*0.05,0,0,Math.PI*2);ctx.fillStyle='#6c3483';ctx.fill();
    ctx.beginPath();ctx.moveTo(0,-s*0.38);ctx.lineTo(-s*0.15,0);ctx.lineTo(s*0.15,0);ctx.closePath();ctx.fillStyle='#8e44ad';ctx.fill();
    ctx.fillStyle='#f1c40f';ctx.font=`${s*0.14}px serif`;ctx.textAlign='center';ctx.fillText('★',0,-s*0.12);
    ctx.restore();
}

function drawRoyalCrown(ctx,cx,cy,s){
    ctx.save();ctx.translate(cx,cy-s*0.58);
    ctx.fillStyle='#e0b94a';ctx.fillRect(-s*0.18,-s*0.05,s*0.36,s*0.09);
    const pts=[-0.14,-0.07,0,0.07,0.14],hs=[-0.18,-0.11,-0.22,-0.11,-0.18];
    ctx.beginPath();ctx.moveTo(-s*0.18,-s*0.05);
    for(let i=0;i<pts.length;i++)ctx.lineTo(pts[i]*s,hs[i]*s);
    ctx.lineTo(s*0.18,-s*0.05);ctx.closePath();ctx.fillStyle='#e0b94a';ctx.fill();
    ctx.strokeStyle='#b8940a';ctx.lineWidth=s*0.015;ctx.stroke();
    ctx.fillStyle='#e74c3c';ctx.beginPath();ctx.arc(0,-s*0.14,s*0.025,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#3498db';
    for(const ox of[-0.1,0.1]){ctx.beginPath();ctx.arc(ox*s,-s*0.02,s*0.018,0,Math.PI*2);ctx.fill();}
    ctx.restore();
}

function drawPondMist(ctx,cx,canvasH,s){
    const grad=ctx.createRadialGradient(cx,canvasH,0,cx,canvasH,s*0.6);
    grad.addColorStop(0,'rgba(100,180,255,0.25)');grad.addColorStop(1,'rgba(100,180,255,0)');
    ctx.fillStyle=grad;ctx.fillRect(cx-s,canvasH-s*0.3,s*2,s*0.3);
}

function drawFireflyHalo(ctx,cx,cy,s,frameIndex){
    const count=4,phase=(frameIndex/ANIM_FRAMES)*Math.PI*2;
    for(let i=0;i<count;i++){
        const a=phase+(i/count)*Math.PI*2,r=s*0.38;
        const fx=cx+Math.cos(a)*r,fy=(cy-s*0.1)+Math.sin(a)*r*0.45;
        const glow=ctx.createRadialGradient(fx,fy,0,fx,fy,s*0.07);
        glow.addColorStop(0,'rgba(255,240,80,0.4)');glow.addColorStop(1,'rgba(255,240,80,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(fx,fy,s*0.07,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.arc(fx,fy,s*0.025,0,Math.PI*2);ctx.fillStyle='rgba(255,240,100,0.9)';ctx.fill();
    }
}

function drawGoldenShimmer(ctx,cx,cy,s,frameIndex){
    const count=8,phase=frameIndex/ANIM_FRAMES;
    for(let i=0;i<count;i++){
        const t=((phase+i/count)%1);
        const x=cx+(rs(i,3)-0.5)*s*0.6,y=(cy-s*0.3)-t*s*0.5;
        const alpha=t<0.5?t*2:(1-t)*2;
        ctx.beginPath();ctx.arc(x,y,s*0.018,0,Math.PI*2);ctx.fillStyle=`rgba(224,185,74,${alpha*0.8})`;ctx.fill();
    }
}

function drawLilyCrown(ctx,cx,cy,s){
    const ny=cy+s*0.08;
    for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;ctx.beginPath();ctx.ellipse(cx+Math.cos(a)*s*0.22,ny+Math.sin(a)*s*0.08,s*0.07,s*0.04,a,0,Math.PI*2);ctx.fillStyle='#f0a0c0';ctx.fill();}
    ctx.beginPath();ctx.arc(cx,ny,s*0.06,0,Math.PI*2);ctx.fillStyle='#f1c40f';ctx.fill();
}

function drawFishingRod(ctx,cx,cy,s){
    ctx.strokeStyle='#8B4513';ctx.lineWidth=s*0.02;
    ctx.beginPath();ctx.moveTo(cx+s*0.18,cy+s*0.1);ctx.quadraticCurveTo(cx+s*0.35,cy-s*0.45,cx+s*0.45,cy-s*0.55);ctx.stroke();
    ctx.strokeStyle='#cccccc';ctx.lineWidth=s*0.01;
    ctx.beginPath();ctx.moveTo(cx+s*0.45,cy-s*0.55);ctx.lineTo(cx+s*0.5,cy-s*0.25);ctx.stroke();
    ctx.beginPath();ctx.arc(cx+s*0.53,cy-s*0.25,s*0.025,0,Math.PI);ctx.strokeStyle='#aaaaaa';ctx.stroke();
}

function drawTinySword(ctx,cx,cy,s){
    ctx.save();ctx.translate(cx-s*0.3,cy-s*0.15);ctx.rotate(-Math.PI/6);
    ctx.fillStyle='#c0c0c0';ctx.fillRect(-s*0.02,-s*0.25,s*0.04,s*0.25);
    ctx.fillStyle='#e0b94a';ctx.fillRect(-s*0.08,-s*0.02,s*0.16,s*0.035);
    ctx.fillStyle='#8B4513';ctx.fillRect(-s*0.02,0,s*0.04,s*0.1);
    ctx.restore();
}

const PORTRAIT_SIZE=240, ANIM_FRAMES=8, ANIM_DELAY_MS=150;

async function drawFrogPortrait(frog) {
    const [frogImg,lilypadImg]=await Promise.all([loadFrogSprite(frog.stage,frog.color),loadLilypadSprite(frog.lilypadLevel)]);
    const enc=new GifEncoder(PORTRAIT_SIZE,PORTRAIT_SIZE,'neuquant',true);
    enc.setDelay(ANIM_DELAY_MS); enc.setRepeat(0); enc.start();
    for(let i=0;i<ANIM_FRAMES;i++){
        const bob=Math.sin((i/ANIM_FRAMES)*Math.PI*2)*(PORTRAIT_SIZE*0.025), rp=i/ANIM_FRAMES;
        const canvas=createCanvas(PORTRAIT_SIZE,PORTRAIT_SIZE), ctx=canvas.getContext('2d');
        drawWaterBackground(ctx,PORTRAIT_SIZE,PORTRAIT_SIZE,rp);
        drawSpriteImage(ctx,lilypadImg,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.72,PORTRAIT_SIZE*0.62);
        drawSpriteImage(ctx,frogImg,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        if(frog.stage==='elder')drawFlowerCrown(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        // Cosmetic effects (drawn behind/around frog)
        if(frog.equippedEffect==='pond_mist')drawPondMist(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE,PORTRAIT_SIZE*0.465);
        if(frog.equippedEffect==='firefly_halo')drawFireflyHalo(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465,i);
        if(frog.equippedEffect==='golden_shimmer')drawGoldenShimmer(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465,i);
        // Cosmetic accessories
        if(frog.equippedAccessory==='lily_crown')drawLilyCrown(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        if(frog.equippedAccessory==='fishing_rod')drawFishingRod(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        if(frog.equippedAccessory==='tiny_sword')drawTinySword(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        // Cosmetic headwear (drawn on top)
        if(frog.equippedHat==='party_hat')drawPartyHat(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        else if(frog.equippedHat==='mushroom_cap')drawMushroomCap(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        else if(frog.equippedHat==='wizard_hat')drawWizardHat(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        else if(frog.equippedHat==='royal_crown')drawRoyalCrown(ctx,PORTRAIT_SIZE*0.5,PORTRAIT_SIZE*0.52+bob,PORTRAIT_SIZE*0.465);
        ctx.font='700 22px "Noto Sans", sans-serif'; ctx.fillStyle='#ffffff'; ctx.textAlign='center';
        ctx.fillText(frog.name,PORTRAIT_SIZE/2,30);
        enc.addFrame(ctx.getImageData(0,0,PORTRAIT_SIZE,PORTRAIT_SIZE).data);
    }
    enc.finish(); return Buffer.from(enc.out.getData());
}

const CELL_SIZE=150, SCENE_FRAMES=8, SCENE_DELAY=150;

async function drawPondScene(frogs) {
    const cols=Math.min(5,Math.max(1,frogs.length)), rows=Math.max(1,Math.ceil(frogs.length/cols));
    const headerH=50, W=cols*CELL_SIZE, H=rows*CELL_SIZE+headerH;
    const sprites=await Promise.all(frogs.map(f=>Promise.all([loadFrogSprite(f.stage,f.color),loadLilypadSprite(f.lilypadLevel)])));
    const enc=new GifEncoder(W,H,'neuquant',true);
    enc.setDelay(SCENE_DELAY); enc.setRepeat(0); enc.start();
    for(let f=0;f<SCENE_FRAMES;f++){
        const rp=f/SCENE_FRAMES, canvas=createCanvas(W,H), ctx=canvas.getContext('2d');
        drawWaterBackground(ctx,W,H,rp);
        ctx.font='700 26px "Noto Sans", sans-serif'; ctx.fillStyle='#ffffff'; ctx.textAlign='center';
        ctx.fillText('The Pond',W/2,36);
        for(let i=0;i<frogs.length;i++){
            const frog=frogs[i],[frogImg,lilypadImg]=sprites[i];
            const col=i%cols, row=Math.floor(i/cols);
            const x=col*CELL_SIZE, y=headerH+row*CELL_SIZE;
            const bob=Math.sin(((f/SCENE_FRAMES+i*0.13)%1)*Math.PI*2)*(CELL_SIZE*0.025);
            ctx.save(); ctx.translate(x,y);
            drawSpriteImage(ctx,lilypadImg,CELL_SIZE*0.5,CELL_SIZE*0.64,CELL_SIZE*0.6);
            drawSpriteImage(ctx,frogImg,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            if(frog.stage==='elder')drawFlowerCrown(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            if(frog.equippedEffect==='pond_mist')drawPondMist(ctx,CELL_SIZE*0.5,CELL_SIZE,CELL_SIZE*0.41);
            if(frog.equippedEffect==='firefly_halo')drawFireflyHalo(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41,f);
            if(frog.equippedEffect==='golden_shimmer')drawGoldenShimmer(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41,f);
            if(frog.equippedAccessory==='lily_crown')drawLilyCrown(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            if(frog.equippedAccessory==='fishing_rod')drawFishingRod(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            if(frog.equippedAccessory==='tiny_sword')drawTinySword(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            if(frog.equippedHat==='party_hat')drawPartyHat(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            else if(frog.equippedHat==='mushroom_cap')drawMushroomCap(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            else if(frog.equippedHat==='wizard_hat')drawWizardHat(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            else if(frog.equippedHat==='royal_crown')drawRoyalCrown(ctx,CELL_SIZE*0.5,CELL_SIZE*0.45+bob,CELL_SIZE*0.41);
            ctx.restore();
            ctx.font='600 14px "Noto Sans", sans-serif'; ctx.fillStyle='#ffffff'; ctx.textAlign='center';
            ctx.fillText(frog.name,x+CELL_SIZE/2,y+CELL_SIZE-12);
        }
        enc.addFrame(ctx.getImageData(0,0,W,H).data);
    }
    enc.finish(); return Buffer.from(enc.out.getData());
}

// ── Slash command definitions ─────────────────────────────────────────────────

const colorChoices    = Object.entries(FROG_COLORS).map(([v,c])=>({name:c.name,value:v}));
const shopItemChoices = [...Object.entries(SHOP_ITEMS),...Object.entries(BOOST_ITEMS),...Object.entries(COSMETIC_ITEMS)].map(([v,i])=>({name:i.label,value:v}));
const careerChoices   = Object.entries(CAREERS).map(([v,c])=>({name:c.label,value:v}));
const cosmeticChoices = Object.entries(COSMETIC_ITEMS).map(([v,i])=>({name:i.label,value:v}));
const investChoices   = Object.entries(INVESTMENTS).map(([v,i])=>({name:i.label,value:v}));
const legacyBonusChoices = Object.entries(LEGACY_BONUSES).map(([v,b])=>({name:b.label,value:v}));

const pondCommands = [
    new SlashCommandBuilder()
        .setName('frog').setDescription('Take care of your pond frog')
        .addSubcommand(s=>s.setName('adopt').setDescription('Adopt a new frog')
            .addStringOption(o=>o.setName('name').setDescription('Name your frog').setRequired(true).setMaxLength(20))
            .addStringOption(o=>o.setName('color').setDescription('Pick a color').setRequired(true).addChoices(...colorChoices)))
        .addSubcommand(s=>s.setName('feed').setDescription('Feed your frog')
            .addBooleanOption(o=>o.setName('use_item').setDescription('Use a worm for a bigger boost (consumes 1)')))
        .addSubcommand(s=>s.setName('play').setDescription('Play with your frog')
            .addBooleanOption(o=>o.setName('use_item').setDescription('Use a toy for a bigger boost (consumes 1)')))
        .addSubcommand(s=>s.setName('cure').setDescription('Cure your sick frog (35 fireflies)'))
        .addSubcommand(s=>s.setName('soothe').setDescription('Throw a bubble party for your depressed frog (35 fireflies)'))
        .addSubcommand(s=>s.setName('status').setDescription('Check on your frog'))
        .addSubcommand(s=>s.setName('leaderboard').setDescription('See the longest-living frogs'))
        .addSubcommand(s=>s.setName('explore').setDescription('Send your frog exploring (twice a day)'))
        .addSubcommand(s=>s.setName('hawk').setDescription('Battle a hawk in a minigame (twice a day)'))
        .addSubcommand(s=>s.setName('mayor').setDescription('See who the current frog mayor is'))
        .addSubcommand(s=>s.setName('commands').setDescription('See an overview of all pond commands'))
        .addSubcommand(s=>s.setName('gas').setDescription('💀 End your frog\'s life immediately'))
        .addSubcommandGroup(g=>g.setName('lilypad').setDescription("Manage your frog's lilypad")
            .addSubcommand(s=>s.setName('info').setDescription('See your lilypad level and next upgrade'))
            .addSubcommand(s=>s.setName('upgrade').setDescription('Upgrade your lilypad to the next level')))
        .addSubcommandGroup(g=>g.setName('fight').setDescription('Challenge another frog to a fight')
            .addSubcommand(s=>s.setName('challenge').setDescription('Challenge a specific player')
                .addUserOption(o=>o.setName('user').setDescription('Who to challenge').setRequired(true))
                .addIntegerOption(o=>o.setName('wager').setDescription('Fireflies to wager (5-20)').setRequired(true).setMinValue(FROGFIGHT_MIN_WAGER).setMaxValue(FROGFIGHT_MAX_WAGER))
                .addIntegerOption(o=>o.setName('guess').setDescription('Your secret number 1-100 (for Bullfrog games)').setMinValue(1).setMaxValue(100)))
            .addSubcommand(s=>s.setName('any').setDescription('Open a challenge for anyone to accept')
                .addIntegerOption(o=>o.setName('wager').setDescription('Fireflies to wager (5-20)').setRequired(true).setMinValue(FROGFIGHT_MIN_WAGER).setMaxValue(FROGFIGHT_MAX_WAGER))
                .addIntegerOption(o=>o.setName('guess').setDescription('Your secret number 1-100 (for Bullfrog games)').setMinValue(1).setMaxValue(100))))
        .addSubcommandGroup(g=>g.setName('baby').setDescription("Manage your frog's baby")
            .addSubcommand(s=>s.setName('status').setDescription('Check on your baby'))
            .addSubcommand(s=>s.setName('breed').setDescription('Have a baby (requires day 14+)'))
            .addSubcommand(s=>s.setName('sell').setDescription('Sell your baby once it is 7 days old')))
        .addSubcommandGroup(g=>g.setName('partner').setDescription("Manage your frog's partnership")
            .addSubcommand(s=>s.setName('propose').setDescription('Propose a partnership to another player')
                .addUserOption(o=>o.setName('user').setDescription('Who to partner with').setRequired(true)))
            .addSubcommand(s=>s.setName('info').setDescription('See your current partner'))
            .addSubcommand(s=>s.setName('break').setDescription('End your partnership'))
            .addSubcommand(s=>s.setName('feed').setDescription("Feed your partner's frog")))
        .addSubcommandGroup(g=>g.setName('career').setDescription("Manage your frog's career (unlocks at day 7)")
            .addSubcommand(s=>s.setName('info').setDescription('See your current career'))
            .addSubcommand(s=>s.setName('choose').setDescription('Choose your first career (free)')
                .addStringOption(o=>o.setName('career').setDescription('Which career').setRequired(true).addChoices(...careerChoices)))
            .addSubcommand(s=>s.setName('respec').setDescription('Change career (35 fireflies, Mondays only)')
                .addStringOption(o=>o.setName('career').setDescription('Which career').setRequired(true).addChoices(...careerChoices))))
        .addSubcommand(s=>s.setName('wardrobe').setDescription('See all cosmetics your frog owns'))
        .addSubcommand(s=>s.setName('equip').setDescription('Equip or unequip a cosmetic')
            .addStringOption(o=>o.setName('item').setDescription('Which cosmetic to equip/unequip').setRequired(true).addChoices(...cosmeticChoices)))
        .addSubcommandGroup(g=>g.setName('legacy').setDescription('View and spend your Lily Tokens (earned when frogs die)')
            .addSubcommand(s=>s.setName('info').setDescription('See your Lily Tokens, generation, and legacy bonuses'))
            .addSubcommand(s=>s.setName('spend').setDescription('Spend Lily Tokens on a legacy bonus')
                .addStringOption(o=>o.setName('bonus').setDescription('Which bonus').setRequired(true).addChoices(...legacyBonusChoices)))),
    new SlashCommandBuilder()
        .setName('pond').setDescription("The Pond — where everyone's frogs hang out")
        .addSubcommand(s=>s.setName('view').setDescription("See everyone's frogs together in the pond"))
        .addSubcommand(s=>s.setName('memorial').setDescription('Remember frogs that have passed on'))
        .addSubcommand(s=>s.setName('rules').setDescription('How to play The Pond'))
        .addSubcommandGroup(g=>g.setName('admin').setDescription('Admin: manage frog data')
            .addSubcommand(s=>s.setName('give').setDescription('Give fireflies to a frog')
                .addUserOption(o=>o.setName('user').setDescription('Frog owner').setRequired(true))
                .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
            .addSubcommand(s=>s.setName('remove').setDescription('Remove fireflies from a frog')
                .addUserOption(o=>o.setName('user').setDescription('Frog owner').setRequired(true))
                .addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))))
        .addSubcommandGroup(g=>g.setName('shop').setDescription('Buy supplies for your frog')
            .addSubcommand(s=>s.setName('buy').setDescription('Buy an item')
                .addStringOption(o=>o.setName('item').setDescription('What to buy').setRequired(true).addChoices(...shopItemChoices))
                .addIntegerOption(o=>o.setName('quantity').setDescription('How many (default 1)').setMinValue(1).setMaxValue(50))))
        .addSubcommandGroup(g=>g.setName('invest').setDescription('Buy passive income investments for your frog')
            .addSubcommand(s=>s.setName('info').setDescription('See your investments and upgrade costs'))
            .addSubcommand(s=>s.setName('buy').setDescription('Buy or upgrade an investment')
                .addStringOption(o=>o.setName('item').setDescription('Which investment').setRequired(true).addChoices(...investChoices))
                .addIntegerOption(o=>o.setName('tier').setDescription('Which tier to buy (1-3)').setRequired(true).setMinValue(1).setMaxValue(3)))),
];

// ── In-memory game state ──────────────────────────────────────────────────────

const pondHawkGames  = new Map(); // msgId → { ownerId, mistakeChance, gameType, state, timer }
const pondFrogfights = new Map(); // msgId → { challengerId, targetId, wager, challengerGuess, resolved, awaitingModal, timer }
const pondFrogGames  = new Map(); // msgId → active game state after challenge accepted

// ── Shared guard helpers ──────────────────────────────────────────────────────

function requireLiveFrog(frog, interaction) {
    if (!frog || !frog.alive) {
        interaction.reply({ content: "🐸 You don't have a living frog right now. Adopt one with `/frog adopt`!", ephemeral: true });
        return false;
    }
    return true;
}

// ── Frog command handlers ─────────────────────────────────────────────────────

async function handleFrogAdopt(interaction) {
    const existing = await pondFrogGet(interaction.user.id);
    if (existing && existing.alive)
        return interaction.reply({ content: `🐸 You already have a frog named **${existing.name}**!`, ephemeral: true });
    const name = interaction.options.getString('name').trim();
    const color = interaction.options.getString('color');
    const now = Date.now();

    // Carry forward legacy fields from previous frog doc
    const legacyPoints         = existing?.legacyPoints || 0;
    const lilyTokens           = existing?.lilyTokens || 0;
    const legacyGen            = (existing?.legacyGen || 0) + 1;
    const legacyBonusFireflies = existing?.legacyBonusFireflies || 0;
    const legacyBonusExplore   = existing?.legacyBonusExplore || 0;
    const legacyHeirloomLilypad = existing?.legacyHeirloomLilypad || false;
    const legacyInheritedCosmetic = existing?.legacyInheritedCosmetic || null;
    const legacyDeepRoots      = existing?.legacyDeepRoots || false;
    const legacyNameplate      = existing?.legacyNameplate || false;

    const startFireflies = 15 + legacyBonusFireflies;
    const startLilypad   = legacyHeirloomLilypad ? 2 : 1;
    const inheritedCosmetics = legacyInheritedCosmetic || '';

    const frog = normalizeFrog({
        ownerId: interaction.user.id, name, color,
        stage: 'egg', hunger: 100, happiness: 100,
        bornAt: now, lastFedAt: now, lastPlayedAt: now, lastTickAt: now,
        alive: true, diedAt: null, lifespanDays: null,
        fireflies: startFireflies, patchV2Granted: true,
        lilypadLevel: startLilypad,
        legacyPoints, lilyTokens, legacyGen,
        legacyBonusFireflies, legacyBonusExplore,
        legacyHeirloomLilypad, legacyInheritedCosmetic: null,
        legacyDeepRoots, legacyNameplate,
        cosmeticsStr: inheritedCosmetics,
    }, now);

    // Deep Roots: back-date lastPassiveAt so 2 days of passive income accrue on first tick
    if (legacyDeepRoots) frog.lastPassiveAt = now - 2 * DAY_MS;

    await pondFrogSet(interaction.user.id, frog);

    const bonusParts = [];
    if (legacyBonusFireflies > 0) bonusParts.push(`+${legacyBonusFireflies} starting 🪲`);
    if (startLilypad > 1) bonusParts.push(`lilypad L2`);
    if (inheritedCosmetics) bonusParts.push(`cosmetics inherited`);
    if (legacyDeepRoots) bonusParts.push(`Deep Roots bonus`);
    const bonusLine = bonusParts.length ? `\n🌿 **Legacy bonus:** ${bonusParts.join(', ')}` : '';
    const genLine = legacyGen > 1 ? ` *(Generation ${legacyGen})*` : '';

    await interaction.reply({
        content: `🐣 Welcome **${name}**${genLine} to the pond! You start with **${startFireflies} 🪲 fireflies**. Keep them happy with \`/frog feed\` and \`/frog play\` — check in twice a day!${bonusLine}`,
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
    if (!requireLiveFrog(frog, interaction)) return;
    if (frog.justDied) {
        await pondFrogSet(interaction.user.id, frog);
        return announceDeath(interaction.client, frog).then(()=>interaction.reply({ content: `${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.` }));
    }
    const isFeed = kind==='feed';
    const lastAt = isFeed ? frog.lastFedAt : frog.lastPlayedAt;
    const cooldown = isFeed ? FEED_COOLDOWN_MS : PLAY_COOLDOWN_MS;
    const remaining = cooldown-(Date.now()-lastAt);
    if (remaining>0) {
        const mins=Math.ceil(remaining/60000);
        return interaction.reply({ content: `🐸 **${frog.name}** is ${isFeed?'still full':'still happy from playtime'}! Try again in ~${mins<60?`${mins}m`:`${Math.ceil(mins/60)}h`}.`, ephemeral: true });
    }
    const useItem = interaction.options.getBoolean('use_item');
    let restore = isFeed?FEED_RESTORE_BASE:PLAY_RESTORE_BASE, usedItem=false;
    if (useItem && (isFeed?frog.worms:frog.toys)>0) {
        restore=ITEM_RESTORE; usedItem=true;
        if(isFeed)frog.worms-=1; else frog.toys-=1;
    } else if (isFeed && frog.lilypadLevel>=4) {
        restore+=5;
    } else if (!isFeed && frog.lilypadLevel>=5) {
        restore+=5;
    }
    if(isFeed){frog.hunger=Math.min(100,frog.hunger+restore);frog.lastFedAt=Date.now();}
    else{frog.happiness=Math.min(100,frog.happiness+restore);frog.lastPlayedAt=Date.now();}
    await pondFrogSet(interaction.user.id, frog);
    const verb=isFeed?(usedItem?'gobbles down a juicy worm 🪱':'munches happily on some flies 🪰'):(usedItem?'plays with a fun new toy 🧸':'hops around joyfully with you 🌿');
    await interaction.reply({ content:`🐸 **${frog.name}** ${verb}! Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100`, files:[new AttachmentBuilder(await drawFrogPortrait(frog),{name:'frog.gif'})] });
}

async function handleFrogCure(interaction, kind) {
    const isCure=kind==='cure';
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    if(frog.justDied){await pondFrogSet(interaction.user.id,frog);return announceDeath(interaction.client,frog).then(()=>interaction.reply({content:`${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.`}));}
    const isAfflicted=isCure?frog.sick:frog.depressed;
    if(!isAfflicted)return interaction.reply({content:`🐸 **${frog.name}** doesn't need that right now.`,ephemeral:true});
    const cost=shopPrice(frog,isCure?CURE_COST:SOOTHE_COST);
    if(frog.fireflies<cost)return interaction.reply({content:`🪲 You need ${cost} fireflies, but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});
    frog.fireflies-=cost;
    if(isCure){frog.hunger=50;frog.sick=false;frog.sickSince=null;}
    else{frog.happiness=50;frog.depressed=false;frog.depressedSince=null;}
    await pondFrogSet(interaction.user.id,frog);
    const verb=isCure?'is nursed back to health 💊':'splashes joyfully through a bubble party 🫧';
    await interaction.reply({content:`🐸 **${frog.name}** ${verb}! (-${cost} fireflies) Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100`,files:[new AttachmentBuilder(await drawFrogPortrait(frog),{name:'frog.gif'})]});
}

async function handleFrogStatus(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!frog)return interaction.reply({content:"🐸 You don't have a frog yet. Adopt one with `/frog adopt`!",ephemeral:true});
    if(!frog.alive){
        await pondFrogSet(interaction.user.id,frog);
        if(frog.justDied)await announceDeath(interaction.client,frog);
        return interaction.reply({content:`${deathMessage(frog)} \`/pond memorial\` to remember them. Adopt a new frog with \`/frog adopt\`.`});
    }
    await pondFrogSet(interaction.user.id,frog);
    const age=formatAge(Date.now()-frog.bornAt);
    const ci=FROG_COLORS[frog.color]||FROG_COLORS.green;
    const flags=[];
    if(frog.sick)flags.push('🤒 sick — `/frog cure`');
    if(frog.depressed)flags.push('😔 depressed — `/frog soothe`');
    if(frog.isMayor)flags.push('👑 Frog Mayor');
    const careerLine=frog.career?` · 💼 ${CAREERS[frog.career].label}`:'';
    // Boosts
    const t=Date.now(), activeBoosts=[];
    if(frog.boostHawkShell)activeBoosts.push('🐚 Shell Polish');
    if(frog.boostExploreNext)activeBoosts.push('🧲 FF Magnet');
    if(frog.boostMidnightGlow&&t<frog.boostMidnightGlow)activeBoosts.push(`🌙 Glow(${Math.ceil((frog.boostMidnightGlow-t)/60000)}m)`);
    if(frog.boostTadpoleTonic&&t<frog.boostTadpoleTonic)activeBoosts.push(`🧪 Tonic(${Math.ceil((frog.boostTadpoleTonic-t)/3600000)}h)`);
    if(frog.boostLuckyClover&&t<frog.boostLuckyClover)activeBoosts.push(`🍀 Clover(${Math.ceil((frog.boostLuckyClover-t)/3600000)}h)`);
    const boostLine=activeBoosts.length?`\n⚡ Boosts: ${activeBoosts.join(' · ')}`:''  ;
    // Cosmetics
    const wearing=[frog.equippedHat,frog.equippedEffect,frog.equippedAccessory].filter(Boolean);
    const cosmeticLine=wearing.length?`\n✨ Wearing: ${wearing.map(k=>COSMETIC_ITEMS[k]?.label||k).join(', ')}` :'';
    // Legacy nameplate
    const legacyLine=frog.legacyNameplate&&frog.legacyGen>0?`\n🌿 Generation ${frog.legacyGen}`:'';
    await interaction.reply({
        content:`🐸 **${frog.name}** — ${frog.stage}, ${age} old\n`
            +`Hunger: ${Math.round(frog.hunger)}/100 · Happiness: ${Math.round(frog.happiness)}/100\n`
            +`🪲 Fireflies: ${frog.fireflies} · 🍃 Lilypad: level ${frog.lilypadLevel}${careerLine}\n`
            +`🎨 ${ci.name} — ${PERK_DESCRIPTIONS[ci.perk]}`
            +(flags.length?`\n${flags.join(' · ')}`:``)+boostLine+cosmeticLine+legacyLine,
        files:[new AttachmentBuilder(await drawFrogPortrait(frog),{name:'frog.gif'})],
    });
}

async function handleFrogLilypadInfo(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    await pondFrogSet(interaction.user.id,frog);
    const level=frog.lilypadLevel, next=LILYPAD_LEVELS[level+1];
    const lines=[`🍃 **${frog.name}**'s lilypad is level ${level} — ${LILYPAD_LEVELS[level].label}`];
    if(next){lines.push(`Next: level ${level+1} for ${shopPrice(frog,next.cost)} fireflies — ${next.label}`);lines.push('Upgrade with `/frog lilypad upgrade`.');}
    else lines.push('Already at the max level!');
    await interaction.reply({content:lines.join('\n')});
}

async function handleFrogLilypadUpgrade(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    const next=LILYPAD_LEVELS[frog.lilypadLevel+1];
    if(!next){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🍃 **${frog.name}**'s lilypad is already at the max level!`,ephemeral:true});}
    const cost=shopPrice(frog,next.cost);
    if(frog.fireflies<cost){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪲 You need ${cost} fireflies for that upgrade, but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});}
    frog.fireflies-=cost;
    frog.lilypadLevel+=1;
    if(frog.lilypadLevel===10&&!frog.lilypadL10Claimed){frog.fireflies+=100;frog.lilypadL10Claimed=true;}
    await pondFrogSet(interaction.user.id,frog);
    const bonus=frog.lilypadLevel===10?' (+100 fireflies reward!)':'';
    await interaction.reply({content:`🍃 **${frog.name}**'s lilypad is now level ${frog.lilypadLevel}! ${LILYPAD_LEVELS[frog.lilypadLevel].label}${bonus} (-${cost} fireflies)`,files:[new AttachmentBuilder(await drawFrogPortrait(frog),{name:'frog.gif'})]});
}

async function handlePondShopBuy(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    const itemKey=interaction.options.getString('item');
    const baseItem=SHOP_ITEMS[itemKey], boostItem=BOOST_ITEMS[itemKey], cosmeticItem=COSMETIC_ITEMS[itemKey];
    const item=baseItem||boostItem||cosmeticItem;
    if(!item){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:'❌ Unknown item.',ephemeral:true});}

    // Quantity: only base consumables (worms/toys) and mud_bath support qty > 1
    const supportsQty=itemKey==='worms'||itemKey==='toys'||itemKey==='mud_bath';
    const quantity=supportsQty?(interaction.options.getInteger('quantity')||1):1;
    const totalCost=shopPrice(frog,item.cost)*quantity;

    // One-time-purchase checks
    if(itemKey==='nest'&&frog.hasNest){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪺 **${frog.name}** already has a nest.`,ephemeral:true});}
    if(cosmeticItem&&getCosmetics(frog).includes(itemKey)){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`✨ **${frog.name}** already owns **${cosmeticItem.label}**.`,ephemeral:true});}

    if(frog.fireflies<totalCost){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪲 You need ${totalCost} 🪲 for ${quantity > 1 ? `${quantity}x ` : ''}**${item.label}**, but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});}
    frog.fireflies-=totalCost;

    let resultMsg='';
    if(itemKey==='worms'){frog.worms+=quantity;resultMsg=`Got ${quantity}x worm(s)! ${item.desc}`;}
    else if(itemKey==='toys'){frog.toys+=quantity;resultMsg=`Got ${quantity}x toy(s)! ${item.desc}`;}
    else if(itemKey==='nest'){frog.hasNest=true;resultMsg=item.desc;}
    else if(itemKey==='snail_polish'){frog.boostHawkShell=true;resultMsg=item.desc;}
    else if(itemKey==='ff_magnet'){frog.boostExploreNext=true;resultMsg=item.desc;}
    else if(itemKey==='midnight_glow'){
        const dur=4*60*60*1000;
        frog.boostMidnightGlow=(frog.boostMidnightGlow&&Date.now()<frog.boostMidnightGlow?frog.boostMidnightGlow:Date.now())+dur;
        resultMsg=`${item.desc} (~${Math.ceil((frog.boostMidnightGlow-Date.now())/60000)}m remaining)`;
    } else if(itemKey==='mud_bath'){
        frog.hunger=Math.min(100,frog.hunger+15*quantity);
        frog.happiness=Math.min(100,frog.happiness+15*quantity);
        resultMsg=`**${frog.name}** soaks in the warm mud! +${15*quantity} hunger & happiness`;
    } else if(itemKey==='tadpole_tonic'){
        frog.boostTadpoleTonic=Date.now()+24*60*60*1000;
        resultMsg=item.desc;
    } else if(itemKey==='lucky_clover'){
        frog.boostLuckyClover=Date.now()+6*60*60*1000;
        resultMsg=item.desc;
    } else if(cosmeticItem){
        const owned=getCosmetics(frog);
        owned.push(itemKey);
        frog.cosmeticsStr=owned.join(',');
        resultMsg=`✨ **${frog.name}** now owns **${cosmeticItem.label}**! Equip with \`/frog equip item:${itemKey}\`.`;
    }

    await pondFrogSet(interaction.user.id,frog);
    await interaction.reply({content:`🛒 **${item.label}** purchased for ${totalCost} 🪲! ${resultMsg}`});
}

async function handleFrogLeaderboard(interaction) {
    const frogs=await pondFirestoreQuery();
    if(!frogs.length)return interaction.reply({content:'🐸 No frogs have been adopted yet — be the first with `/frog adopt`!'});
    const now=Date.now();
    const ranked=frogs.map(f=>({...f,ageDays:f.alive?Math.floor((now-f.bornAt)/DAY_MS):f.lifespanDays,ageMs:f.alive?now-f.bornAt:(f.diedAt||now)-f.bornAt})).sort((a,b)=>b.ageMs-a.ageMs).slice(0,10);
    await interaction.reply({content:`🏆 **Longest-living frogs**\n${ranked.map((f,i)=>`${i+1}. **${f.name}** — ${f.ageDays} day(s) ${f.alive?'🐸':'🪦'}`).join('\n')}`});
}

async function handleFrogExplore(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    if(frog.justDied){await pondFrogSet(interaction.user.id,frog);return announceDeath(interaction.client,frog).then(()=>interaction.reply({content:`${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.`}));}

    const today=getTodayKey();
    if(frog.exploresResetDay!==today){frog.exploresToday=0;frog.exploresResetDay=today;}
    const limit=getExploreLimit(frog);
    if(frog.exploresToday>=limit){
        await pondFrogSet(interaction.user.id,frog);
        return interaction.reply({content:`🌿 **${frog.name}** has already explored ${limit} time(s) today. Come back tomorrow!`,ephemeral:true});
    }

    const result=rollExploration(frog);
    // Mysterious Frog event: double exploration firefly rewards
    const eMeta=await pondFirestoreGet(POND_META_DOC_ID)||{};
    const now2=Date.now();
    const exploreBoost=(eMeta.activeEventType==='mysterious_frog'&&eMeta.activeEventUntil>now2)?2:1;
    const boostParts=[];
    if(result.fireflies>0){
        result.fireflies=Math.round(result.fireflies*exploreBoost);
        if(frog.boostExploreNext){result.fireflies=Math.round(result.fireflies*2);frog.boostExploreNext=false;boostParts.push('🧲 Magnet (2×)');}
        if(frog.boostMidnightGlow&&now2<frog.boostMidnightGlow){result.fireflies+=5;boostParts.push('🌙 Glow (+5)');}
    }
    frog.exploresToday+=1;
    frog.fireflies=Math.max(0,frog.fireflies+result.fireflies);
    if(result.hunger)frog.hunger=Math.min(100,frog.hunger+result.hunger);
    if(result.happiness)frog.happiness=Math.min(100,frog.happiness+result.happiness);
    await pondFrogSet(interaction.user.id,frog);

    const parts=[`🧭 **${frog.name}** ${result.text}!`];
    if(result.fireflies)parts.push(`${result.fireflies>0?'+':''}${result.fireflies} 🪲`);
    if(result.hunger)parts.push(`+${result.hunger} hunger`);
    if(result.happiness)parts.push(`+${result.happiness} happiness`);
    if(boostParts.length)parts.push(`*(${boostParts.join(', ')})*`);
    parts.push(`*(${frog.exploresToday}/${limit} explores today)*`);
    await interaction.reply({content:parts.join(' ')});
}

async function handleFrogMayor(interaction) {
    const meta=await pondFirestoreGet(POND_META_DOC_ID);
    if(!meta||!meta.mayorOwnerId)return interaction.reply({content:'🗳️ No mayor has been elected yet. Elections happen every Wednesday at 20:00 UTC.'});
    const mayorFrog=await pondFrogGet(meta.mayorOwnerId);
    if(!mayorFrog||!mayorFrog.alive)return interaction.reply({content:'🗳️ The current mayor seems to have left the pond. A new election is coming soon.'});
    const ci=FROG_COLORS[mayorFrog.color]||FROG_COLORS.green;
    await interaction.reply({content:`👑 **${mayorFrog.name}** is the current Frog Mayor! (${ci.name})\n🪲 +10% firefly income · 😊 +2 hunger/happiness per day · ⏱️ Ages 10% faster`});
}

async function handleFrogGas(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({
        content: `⚠️ Are you sure you want to gas **${frog.name}**? This permanently ends their life — there is no going back.`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pond:gas:confirm').setLabel('Yes, gas them 💀').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('pond:gas:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        )],
        ephemeral: true,
    });
}

async function handleFrogGasButton(interaction) {
    if (interaction.customId === 'pond:gas:cancel') {
        return interaction.update({ content: '👍 Cancelled — your frog is safe.', components: [] });
    }
    // deferUpdate can throw in edge cases — suppress and continue; the kill must happen regardless
    await interaction.deferUpdate().catch(() => {});
    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) {
        return interaction.editReply({ content: `🐸 Your frog is already gone. Adopt a new one with \`/frog adopt\`.`, components: [] }).catch(() => {});
    }
    die(frog, Date.now(), 'gassed');
    const saved = await pondFrogSet(interaction.user.id, frog);
    if (!saved) {
        return interaction.editReply({ content: `❌ Couldn't save the kill — Firestore write failed. Try again.`, components: [] }).catch(() => {});
    }
    await announceDeath(interaction.client, frog);
    await interaction.editReply({ content: `💀 **${frog.name}** has been gassed. A moment of silence. 🪦\nAdopt a new frog with \`/frog adopt\`.`, components: [] }).catch(() => {});
}

async function handleFrogCareerInfo(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    await pondFrogSet(interaction.user.id,frog);
    if(!frog.career){
        const unlocked=hasUnlockedCareer(frog);
        return interaction.reply({content:unlocked?`🐸 **${frog.name}** hasn't picked a career yet. Use \`/frog career choose\` to pick one (free first time).`:`🐸 **${frog.name}** is too young for a career — careers unlock at day ${CAREER_MIN_STAGE_DAYS}.`});
    }
    const c=CAREERS[frog.career];
    await interaction.reply({content:`🐸 **${frog.name}** is a **${c.label}** — ${c.desc}.\nRespec on Mondays from 12:00 (GMT+1) for ${shopPrice(frog,CAREER_RESPEC_COST)} fireflies with \`/frog career respec\`.`});
}

async function handleFrogCareerSet(interaction, isRespec) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    if(!hasUnlockedCareer(frog)){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🐸 **${frog.name}** is too young for a career — careers unlock at day ${CAREER_MIN_STAGE_DAYS}.`,ephemeral:true});}
    if(isRespec&&!frog.career){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🐸 **${frog.name}** doesn't have a career yet — use \`/frog career choose\` for your first (free) pick.`,ephemeral:true});}
    if(!isRespec&&frog.career){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🐸 **${frog.name}** is already a ${CAREERS[frog.career].label} — use \`/frog career respec\` to change.`,ephemeral:true});}

    const career=interaction.options.getString('career');
    let cost=0;
    if(isRespec){
        const windowMs=lastMondayRespecWindowMs();
        if(frog.lastCareerRespecAt && frog.lastCareerRespecAt>=windowMs){
            await pondFrogSet(interaction.user.id,frog);
            return interaction.reply({content:`🐸 **${frog.name}** already changed career this week. Respec windows open every Monday at 12:00 (GMT+1).`,ephemeral:true});
        }
        if(Date.now()<windowMs){
            await pondFrogSet(interaction.user.id,frog);
            return interaction.reply({content:`🐸 The respec window opens every **Monday at 12:00 (GMT+1)**. Come back then!`,ephemeral:true});
        }
        cost=shopPrice(frog,CAREER_RESPEC_COST);
        if(frog.fireflies<cost){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪲 You need ${cost} fireflies to respec, but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});}
        frog.fireflies-=cost;
        frog.lastCareerRespecAt=Date.now();
    }
    frog.career=career;
    await pondFrogSet(interaction.user.id,frog);
    const c=CAREERS[career];
    await interaction.reply({content:`🐸 **${frog.name}** is now a **${c.label}**! ${c.desc}.${cost?` (-${cost} fireflies)`:''}`});
}

// ── Hawk minigame ─────────────────────────────────────────────────────────────

async function handleFrogHawk(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    if(frog.justDied){await pondFrogSet(interaction.user.id,frog);return announceDeath(interaction.client,frog).then(()=>interaction.reply({content:`${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.`}));}

    const today=getTodayKey();
    if(frog.hawksResetDay!==today){frog.hawksDoneToday=0;frog.hawksResetDay=today;}
    if(frog.hawksDoneToday>=HAWK_DAILY_BASE){
        await pondFrogSet(interaction.user.id,frog);
        return interaction.reply({content:`🦅 **${frog.name}** has already faced the hawk ${HAWK_DAILY_BASE} times today. Come back tomorrow!`,ephemeral:true});
    }
    frog.hawksDoneToday+=1;
    await pondFrogSet(interaction.user.id,frog);

    const mc=hawkMistakeChance(frog);
    await interaction.reply({
        content:`🦅 **${frog.name}** vs the hawk — choose your battle! (${frog.hawksDoneToday}/${HAWK_DAILY_BASE} today)`,
        components:[new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pond:hawk:pick:ttt').setLabel('⬜ Tic-Tac-Toe').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('pond:hawk:pick:rps').setLabel('🪨 Rock-Worm-Lilypad').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pond:hawk:pick:reeds').setLabel('🌿 The Reeds').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pond:hawk:pick:firefly').setLabel('🪲 Firefly Count').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pond:hawk:pick:predator').setLabel('🦅 Predator\'s Thinking').setStyle(ButtonStyle.Secondary),
        )],
    });
    const msg=await interaction.fetchReply();
    const state={ ownerId:interaction.user.id, mistakeChance:mc, gameType:null, state:{}, timer:null };
    state.timer=setTimeout(()=>{
        if(pondHawkGames.get(msg.id)===state){pondHawkGames.delete(msg.id);msg.edit({content:'🦅 The hawk flew away — game expired.',components:[]}).catch(()=>{});}
    },HAWK_GAME_TIMEOUT_MS);
    pondHawkGames.set(msg.id,state);
}

async function startHawkGame(interaction, state, msg, gameType) {
    state.gameType=gameType;
    clearTimeout(state.timer);
    state.timer=setTimeout(()=>{
        if(pondHawkGames.get(msg.id)===state){pondHawkGames.delete(msg.id);msg.edit({content:'🦅 The hawk flew away — game expired.',components:[]}).catch(()=>{});}
    },HAWK_GAME_TIMEOUT_MS);

    if(gameType==='ttt'){
        const board=Array(9).fill(null); state.state={board};
        return interaction.update({content:`🦅 Tic-Tac-Toe! You're 🟦 (X), the hawk is 🟥 (O).`,components:tttBoardComponents(board,false,'pond:hawk:ttt:')});
    }
    if(gameType==='rps'){
        state.state={round:1,playerWins:0,hawkWins:0};
        return interaction.update({content:`🦅 Rock-Worm-Lilypad (best of 3)! Round 1 — pick your move:`,components:rpsComponents('pond:hawk:rps:')});
    }
    if(gameType==='reeds'){
        return interaction.update({content:`🦅 The Reeds! A hawk hides behind one. Pick a reed to hide in:\n🌿 🌿 🌿`,components:[new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pond:hawk:reeds:1').setLabel('Reed 1').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pond:hawk:reeds:2').setLabel('Reed 2').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pond:hawk:reeds:3').setLabel('Reed 3').setStyle(ButtonStyle.Secondary),
        )]});
    }
    if(gameType==='firefly'){
        // Apply luck NOW at display time — if luck fires, show one fewer fly (easier to win).
        // Comparing at check-time would let lucky players count correctly but still fail.
        const rawCount=Math.floor(Math.random()*6)+5; // 5-10
        const count=Math.random()<state.mistakeChance?Math.max(5,rawCount-1):rawCount;
        state.state={target:count};
        const flies='🪲'.repeat(count);
        await interaction.update({content:`🦅 Count the fireflies!\n${flies}\nClick "Submit Count" to enter your answer!`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pond:hawk:firefly:submit').setLabel('Submit Count').setStyle(ButtonStyle.Primary))]});
        return;
    }
    if(gameType==='predator'){
        const num=Math.floor(Math.random()*50)+1; state.state={hawkNum:num};
        return interaction.update({content:`🦅 A Predator's Thinking! The hawk has secretly chosen a number between 1 and 50. How close can you get?\n\n🏆 Exact match → +40 🪲 | Within 1-3 → +20 🪲 | Within 4-5 → +10 🪲 | 6+ off → -10% 🪲`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pond:hawk:predator:submit').setLabel('Enter My Guess').setStyle(ButtonStyle.Primary))]});
    }
}

async function finishHawkGame(interaction, state, msg, resultText, fireflyDelta) {
    clearTimeout(state.timer);
    pondHawkGames.delete(msg.id);
    const frog=await getLiveFrog(state.ownerId);
    let content=resultText;
    if(frog&&frog.alive){
        const hMeta=await pondFirestoreGet(POND_META_DOC_ID)||{};
        const hawkBoost=(hMeta.activeEventType==='hawk_season'&&hMeta.activeEventUntil>Date.now())?2:1;
        if(fireflyDelta>0){
            let gain=Math.round(fireflyDelta*mayorMult(frog)*hawkBoost);
            const usedShell=!!frog.boostHawkShell;
            if(usedShell){gain=Math.round(gain*1.5);frog.boostHawkShell=false;}
            const midnightBonus=(frog.boostMidnightGlow&&Date.now()<frog.boostMidnightGlow)?5:0;
            gain+=midnightBonus;
            frog.fireflies+=gain; content+=` +${gain} 🪲${hawkBoost>1?' (🦅 Hawk Season x2!)':''}${usedShell?' 🐚 Shell Polish (+50%)!':''}${midnightBonus?' 🌙 Midnight Glow (+5)!':''}`;
        } else if(fireflyDelta<0){
            const rate=Math.abs(fireflyDelta)*(typeof fireflyDelta==='number'&&fireflyDelta<-1?1:hawkBoost);
            const loss=Math.floor(frog.fireflies*rate);
            frog.fireflies=Math.max(0,frog.fireflies-loss); content+=` -${loss} 🪲${hawkBoost>1?' (🦅 Hawk Season x2!)':''}`;
        }
        await pondFrogSet(state.ownerId,frog);
    }
    const edit={content,components:[]};
    await interaction.update(edit).catch(()=>msg.edit(edit).catch(()=>{}));
}

async function handleHawkButton(interaction) {
    const msg=interaction.message;
    const state=pondHawkGames.get(msg.id);
    if(!state)return interaction.reply({content:'🦅 This hawk battle has expired.',ephemeral:true});
    if(interaction.user.id!==state.ownerId)return interaction.reply({content:"🐸 This isn't your hawk battle!",ephemeral:true});

    const parts=interaction.customId.split(':'); // pond:hawk:<type>:<detail>
    const type=parts[2], detail=parts[3];

    if(type==='pick'){
        if(state.gameType!==null)return interaction.reply({content:'Game already started.',ephemeral:true});
        return startHawkGame(interaction,state,msg,detail);
    }

    if(type==='ttt'){
        const cell=Number(detail);
        if(state.state.board[cell])return interaction.reply({content:'That square is already taken.',ephemeral:true});
        state.state.board[cell]='X';
        let winner=tttWinner(state.state.board);
        if(!winner){const ai=tttAiMove(state.state.board,state.mistakeChance);state.state.board[ai]='O';winner=tttWinner(state.state.board);}
        if(!winner)return interaction.update({components:tttBoardComponents(state.state.board,false,'pond:hawk:ttt:')});
        if(winner==='X')return finishHawkGame(interaction,state,msg,'🎉 You beat the hawk!',HAWK_WIN_REWARD);
        if(winner==='O'){const frog=await getLiveFrog(state.ownerId);const lr=frog&&frog.lilypadLevel>=6?HAWK_LOSS_RATE_REDUCED:HAWK_LOSS_RATE;return finishHawkGame(interaction,state,msg,'🦅 The hawk got the upper hand.',lr*-1);}
        return finishHawkGame(interaction,state,msg,"🤝 It's a draw — the hawk gave up.",0);
    }

    if(type==='rps'){
        const playerPick=detail;
        const hawkPool=Object.keys(RPS_BEATS);
        const hawkRaw=hawkPool[Math.floor(Math.random()*hawkPool.length)];
        const hawkPick=Math.random()<state.mistakeChance?playerPick:hawkRaw;
        const result=rpsResult(playerPick,hawkPick);
        state.state.playerWins+=(result==='win'?1:0);
        state.state.hawkWins+=(result==='lose'?1:0);
        const roundMsg=`Round ${state.state.round}: You picked ${RPS_LABELS[playerPick]}, hawk picked ${RPS_LABELS[hawkPick]} → ${result==='win'?'You win!':result==='lose'?'Hawk wins!':'Draw!'}`;
        state.state.round+=1;
        if(state.state.round>3||state.state.playerWins>=2||state.state.hawkWins>=2){
            const pWins=state.state.playerWins,hWins=state.state.hawkWins;
            const overall=pWins>hWins?'win':hWins>pWins?'lose':'draw';
            if(overall==='win')return finishHawkGame(interaction,state,msg,`${roundMsg}\n🎉 You won the match!`,HAWK_WIN_REWARD);
            if(overall==='lose'){const frog=await getLiveFrog(state.ownerId);const lr=frog&&frog.lilypadLevel>=6?HAWK_LOSS_RATE_REDUCED:HAWK_LOSS_RATE;return finishHawkGame(interaction,state,msg,`${roundMsg}\n🦅 The hawk won the match.`,lr*-1);}
            return finishHawkGame(interaction,state,msg,`${roundMsg}\n🤝 Match drawn — the hawk slinks off.`,0);
        }
        return interaction.update({content:`${roundMsg}\nRound ${state.state.round} — pick your move:`,components:rpsComponents('pond:hawk:rps:')});
    }

    if(type==='reeds'){
        const chosen=Number(detail);
        const hawkReed=Math.random()<state.mistakeChance?chosen:(Math.floor(Math.random()*3)+1);
        if(hawkReed===chosen)return finishHawkGame(interaction,state,msg,`🦅 The hawk attacked Reed ${hawkReed}... and caught you!`,HAWK_LOSS_RATE*-1);
        return finishHawkGame(interaction,state,msg,`🌿 The hawk attacked Reed ${hawkReed}! You hid safely in Reed ${chosen}.`,HAWK_WIN_REWARD);
    }

    if(type==='firefly'&&detail==='submit'){
        const modal=new ModalBuilder().setCustomId(`pond:hawk:firefly_modal:${msg.id}`).setTitle('🪲 Firefly Count');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('How many fireflies did you count?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)));
        return interaction.showModal(modal);
    }

    if(type==='predator'&&detail==='submit'){
        const modal=new ModalBuilder().setCustomId(`pond:hawk:predator_modal:${msg.id}`).setTitle("🦅 Predator's Thinking");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guess').setLabel('Guess the hawk\'s number (1-50)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)));
        return interaction.showModal(modal);
    }
}

async function handleHawkModal(interaction) {
    const parts=interaction.customId.split(':'); // pond:hawk:<game>_modal:<msgId>
    const gameKey=parts[2]; // 'firefly_modal' or 'predator_modal'
    const msgId=parts[3];
    const state=pondHawkGames.get(msgId);
    if(!state)return interaction.reply({content:'🦅 This hawk battle has expired.',ephemeral:true});
    if(interaction.user.id!==state.ownerId)return interaction.reply({content:"🐸 This isn't your hawk battle!",ephemeral:true});

    const msg={id:msgId, edit:(d)=>interaction.channel?.messages.fetch(msgId).then(m=>m.edit(d)).catch(()=>{})};

    if(gameKey==='firefly_modal'){
        const raw=interaction.fields.getTextInputValue('count').trim();
        const guess=parseInt(raw,10);
        const target=state.state.target; // already luck-adjusted when the count was displayed
        if(isNaN(guess)||guess<1||guess>15)return interaction.reply({content:'Please enter a number between 1 and 15.',ephemeral:true});
        await interaction.deferUpdate().catch(()=>{});
        const real=await interaction.channel?.messages.fetch(msgId).catch(()=>null);
        if(guess===target)return finishHawkGame({update:d=>real?.edit(d)||Promise.resolve(),message:{id:msgId}},state,{id:msgId},`🎉 Correct! There were **${target}** fireflies!`,HAWK_WIN_REWARD);
        return finishHawkGame({update:d=>real?.edit(d)||Promise.resolve(),message:{id:msgId}},state,{id:msgId},`❌ There were **${target}** fireflies, you guessed ${guess}.`,HAWK_LOSS_RATE*-1);
    }

    if(gameKey==='predator_modal'){
        const raw=interaction.fields.getTextInputValue('guess').trim();
        const guess=parseInt(raw,10);
        if(isNaN(guess)||guess<1||guess>50)return interaction.reply({content:'Please enter a number between 1 and 50.',ephemeral:true});
        await interaction.deferUpdate().catch(()=>{});
        const real=await interaction.channel?.messages.fetch(msgId).catch(()=>null);
        let hawkNum=state.state.hawkNum;
        const nudge=Math.floor(state.mistakeChance*50);
        if(guess>hawkNum&&guess-hawkNum<=nudge)hawkNum=guess;
        else if(guess<hawkNum&&hawkNum-guess<=nudge)hawkNum=guess;
        const diff=Math.abs(guess-hawkNum);
        let reward,msg2;
        if(diff===0){reward=40;msg2=`🎯 Exact match! The hawk's number was **${hawkNum}**!`;}
        else if(diff<=3){reward=HAWK_WIN_REWARD;msg2=`🔥 Very close! The hawk's number was **${hawkNum}** (off by ${diff}).`;}
        else if(diff<=5){reward=10;msg2=`👍 Close enough! The hawk's number was **${hawkNum}** (off by ${diff}).`;}
        else{reward=-(HAWK_LOSS_RATE);msg2=`💨 Too far off. The hawk's number was **${hawkNum}** (off by ${diff}).`;}
        return finishHawkGame({update:d=>real?.edit(d)||Promise.resolve(),message:{id:msgId}},state,{id:msgId},msg2,reward);
    }
}

// ── Frog fights ───────────────────────────────────────────────────────────────

const FROGFIGHT_GAMES = ['ttt','rps','bullfrog','bullfrog_hard'];

function frogfightComponents() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pond:ff:accept').setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('🥊'),
        new ButtonBuilder().setCustomId('pond:ff:decline').setLabel('Decline').setStyle(ButtonStyle.Danger),
    )];
}

async function handleFrogFrogfight(interaction, isOpen) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    if(frog.justDied){await pondFrogSet(interaction.user.id,frog);return announceDeath(interaction.client,frog).then(()=>interaction.reply({content:`${deathMessage(frog)} You can adopt a new frog with \`/frog adopt\`.`}));}
    const wager=interaction.options.getInteger('wager');
    if(frog.fireflies<wager){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪲 You need ${wager} fireflies to wager that, but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});}
    await pondFrogSet(interaction.user.id,frog);
    const target=isOpen?null:interaction.options.getUser('user');
    if(target&&target.id===interaction.user.id)return interaction.reply({content:"🐸 You can't challenge your own frog!",ephemeral:true});
    const challengerGuess=interaction.options.getInteger('guess')||null;
    const content=isOpen?`🥊 **${frog.name}** opens a frog fight for **${wager}** 🪲 — click Accept to face them!`:`🥊 **${frog.name}** challenges <@${target.id}> to a frog fight for **${wager}** 🪲!`;
    await interaction.reply({content,components:frogfightComponents()});
    const msg=await interaction.fetchReply();
    const state={challengerId:interaction.user.id,targetId:target?target.id:null,wager,challengerGuess,resolved:false,awaitingModal:false,timer:null};
    state.timer=setTimeout(()=>{
        if(pondFrogfights.get(msg.id)===state&&!state.resolved){state.resolved=true;pondFrogfights.delete(msg.id);msg.edit({content:`${content}\n*Challenge expired.*`,components:[]}).catch(()=>{});}
    },FROGFIGHT_EXPIRY_MS);
    pondFrogfights.set(msg.id,state);
}

async function handleFrogfightButton(interaction) {
    const msg=interaction.message;
    const customId=interaction.customId;

    // Active game phase (after accept)
    if(pondFrogGames.has(msg.id)){
        const game=pondFrogGames.get(msg.id);
        return handleActiveFFGame(interaction,game,msg);
    }

    // Challenge accept/decline phase
    const state=pondFrogfights.get(msg.id);
    if(!state||state.resolved)return interaction.reply({content:'🥊 This challenge has already been settled or expired.',ephemeral:true});

    const isAccept=customId==='pond:ff:accept', isDecline=customId==='pond:ff:decline';
    if(state.targetId){
        if(interaction.user.id!==state.targetId)return interaction.reply({content:"🐸 This challenge isn't for you!",ephemeral:true});
    } else if(isAccept&&interaction.user.id===state.challengerId){
        return interaction.reply({content:"🐸 You can't accept your own open challenge!",ephemeral:true});
    } else if(isDecline&&interaction.user.id!==state.challengerId){
        return interaction.reply({content:'🐸 Only the challenger can cancel an open challenge.',ephemeral:true});
    }

    if(isDecline){
        state.resolved=true; clearTimeout(state.timer); pondFrogfights.delete(msg.id);
        return interaction.update({content:'🥊 Challenge declined.',components:[]});
    }
    if(!isAccept)return;
    if(state.resolved)return;
    state.resolved=true; clearTimeout(state.timer); pondFrogfights.delete(msg.id);

    const challenger=await getLiveFrog(state.challengerId);
    const opponent=await getLiveFrog(interaction.user.id);
    if(!challenger||!challenger.alive||!opponent||!opponent.alive)
        return interaction.update({content:'🥊 One of the frogs is no longer around — challenge cancelled.',components:[]});
    if(challenger.fireflies<state.wager||opponent.fireflies<state.wager)
        return interaction.update({content:"🥊 One of you can't cover the wager anymore — challenge cancelled.",components:[]});

    const gameType=FROGFIGHT_GAMES[Math.floor(Math.random()*FROGFIGHT_GAMES.length)];
    state.gameType=gameType;
    state.opponentId=interaction.user.id;
    pondFrogGames.set(msg.id,{...state, challengerName:challenger.name, opponentName:opponent.name});

    if(gameType==='bullfrog'||gameType==='bullfrog_hard'){
        state.awaitingModal=true; pondFrogGames.set(msg.id,{...state,challengerName:challenger.name,opponentName:opponent.name});
        const modal=new ModalBuilder().setCustomId(`pond:ff:bullfrog_modal:${msg.id}`).setTitle(gameType==='bullfrog'?"🐸 Bullfrog's Guess":"🐸 Bullfrog's Guess (Hard)");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guess').setLabel('Pick a secret number (1-100)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)));
        await interaction.showModal(modal);
        return;
    }

    if(gameType==='ttt'){
        const board=Array(9).fill(null);
        pondFrogGames.set(msg.id,{...state,challengerName:challenger.name,opponentName:opponent.name,board,currentTurn:'challenger'});
        return interaction.update({content:`🥊 Frog Fight: **Tic-Tac-Toe** (wager: ${state.wager} 🪲)\n**${challenger.name}** (X) vs **${opponent.name}** (O)\n${challenger.name}'s turn!`,components:tttBoardComponents(board,false,'pond:ff:ttt:')});
    }
    if(gameType==='rps'){
        pondFrogGames.set(msg.id,{...state,challengerName:challenger.name,opponentName:opponent.name,round:1,cWins:0,oWins:0,currentTurn:'challenger',challengerPick:null});
        return interaction.update({content:`🥊 Frog Fight: **Rock-Worm-Lilypad** (wager: ${state.wager} 🪲)\n**${challenger.name}** vs **${opponent.name}**\n${challenger.name}, pick your move for Round 1:`,components:rpsComponents('pond:ff:rps:')});
    }
}

async function handleActiveFFGame(interaction, game, msg) {
    const uid=interaction.user.id;
    const isChallenger=uid===game.challengerId, isOpponent=uid===game.opponentId;
    if(!isChallenger&&!isOpponent)return interaction.reply({content:"🐸 You're not in this fight!",ephemeral:true});

    const parts=interaction.customId.split(':'); // pond:ff:<type>:<detail>
    const type=parts[2], detail=parts[3];

    if(type==='ttt'){
        if((game.currentTurn==='challenger'&&!isChallenger)||(game.currentTurn==='opponent'&&!isOpponent))
            return interaction.reply({content:"It's not your turn!",ephemeral:true});
        const cell=Number(detail);
        const mark=isChallenger?'X':'O';
        if(game.board[cell])return interaction.reply({content:'That square is already taken.',ephemeral:true});
        game.board[cell]=mark;
        const winner=tttWinner(game.board);
        if(!winner){
            game.currentTurn=isChallenger?'opponent':'challenger';
            const nextName=game.currentTurn==='challenger'?game.challengerName:game.opponentName;
            return interaction.update({content:`🥊 Tic-Tac-Toe (${game.wager} 🪲)\n**${game.challengerName}** (X) vs **${game.opponentName}** (O)\n${nextName}'s turn!`,components:tttBoardComponents(game.board,false,'pond:ff:ttt:')});
        }
        pondFrogGames.delete(msg.id);
        const winnerName=winner==='X'?game.challengerName:winner==='O'?game.opponentName:null;
        const winnerId=winner==='X'?game.challengerId:winner==='O'?game.opponentId:null;
        const loserId=winner==='X'?game.opponentId:winner==='O'?game.challengerId:null;
        if(winner==='draw'){
            const cFrog=await getLiveFrog(game.challengerId), oFrog=await getLiveFrog(game.opponentId);
            return interaction.update({content:`🤝 Tic-Tac-Toe draw between **${game.challengerName}** and **${game.opponentName}**! Wagers returned.`,components:[]});
        }
        const wFrog=await getLiveFrog(winnerId), lFrog=await getLiveFrog(loserId);
        if(wFrog&&wFrog.alive){wFrog.fireflies+=game.wager;await pondFrogSet(winnerId,{fireflies:wFrog.fireflies});}
        if(lFrog&&lFrog.alive){lFrog.fireflies=Math.max(0,lFrog.fireflies-game.wager);await pondFrogSet(loserId,{fireflies:lFrog.fireflies});}
        return interaction.update({content:`🥊 **${winnerName}** wins the Tic-Tac-Toe match and takes **${game.wager}** 🪲!`,components:[]});
    }

    if(type==='rps'){
        if(game.currentTurn==='challenger'&&!isChallenger)return interaction.reply({content:`Waiting for **${game.challengerName}** to pick first.`,ephemeral:true});
        if(game.currentTurn==='opponent'&&!isOpponent)return interaction.reply({content:`Waiting for **${game.opponentName}** to pick.`,ephemeral:true});
        const pick=detail;
        if(game.currentTurn==='challenger'){
            game.challengerPick=pick; game.currentTurn='opponent';
            return interaction.update({content:`🥊 Rock-Worm-Lilypad Round ${game.round}\n**${game.challengerName}** has picked! **${game.opponentName}**, pick your move:`,components:rpsComponents('pond:ff:rps:')});
        }
        // opponent picked — reveal round
        const cPick=game.challengerPick, oPick=pick;
        const cResult=rpsResult(cPick,oPick);
        game.cWins+=(cResult==='win'?1:0); game.oWins+=(cResult==='lose'?1:0);
        const roundMsg=`Round ${game.round}: ${game.challengerName} picked ${RPS_LABELS[cPick]}, ${game.opponentName} picked ${RPS_LABELS[oPick]} → ${cResult==='win'?`${game.challengerName} wins!`:cResult==='lose'?`${game.opponentName} wins!`:'Draw!'}`;
        game.round+=1; game.challengerPick=null; game.currentTurn='challenger';
        if(game.round>3||game.cWins>=2||game.oWins>=2){
            pondFrogGames.delete(msg.id);
            const overall=game.cWins>game.oWins?'challenger':game.oWins>game.cWins?'opponent':'draw';
            if(overall==='draw'){return interaction.update({content:`${roundMsg}\n🤝 Match drawn! Wagers returned.`,components:[]});}
            const wId=overall==='challenger'?game.challengerId:game.opponentId;
            const lId=overall==='challenger'?game.opponentId:game.challengerId;
            const wName=overall==='challenger'?game.challengerName:game.opponentName;
            const wF=await getLiveFrog(wId), lF=await getLiveFrog(lId);
            if(wF&&wF.alive){wF.fireflies+=game.wager;await pondFrogSet(wId,{fireflies:wF.fireflies});}
            if(lF&&lF.alive){lF.fireflies=Math.max(0,lF.fireflies-game.wager);await pondFrogSet(lId,{fireflies:lF.fireflies});}
            return interaction.update({content:`${roundMsg}\n🥊 **${wName}** wins the match and takes **${game.wager}** 🪲!`,components:[]});
        }
        return interaction.update({content:`${roundMsg}\nRound ${game.round} — **${game.challengerName}**, pick your move:`,components:rpsComponents('pond:ff:rps:')});
    }
}

async function handleFrogfightModal(interaction) {
    const parts=interaction.customId.split(':'); // pond:ff:bullfrog_modal:<msgId>
    const msgId=parts[3];
    const game=pondFrogGames.get(msgId);
    if(!game)return interaction.reply({content:'🥊 This fight has expired.',ephemeral:true});
    if(interaction.user.id!==game.opponentId)return interaction.reply({content:"🐸 This isn't your fight!",ephemeral:true});

    const raw=interaction.fields.getTextInputValue('guess').trim();
    const opponentGuess=parseInt(raw,10);
    if(isNaN(opponentGuess)||opponentGuess<1||opponentGuess>100)return interaction.reply({content:'Please enter a number between 1 and 100.',ephemeral:true});

    pondFrogGames.delete(msgId);
    const cGuess=game.challengerGuess||Math.floor(Math.random()*100)+1;
    const pondNum=Math.floor(Math.random()*100)+1;
    const cDiff=Math.abs(cGuess-pondNum), oDiff=Math.abs(opponentGuess-pondNum);

    await interaction.deferUpdate().catch(()=>{});
    const real=await interaction.channel?.messages.fetch(msgId).catch(()=>null);

    let winnerId=null, resultMsg='';
    if(game.gameType==='bullfrog'){
        if(cDiff<oDiff)winnerId=game.challengerId;
        else if(oDiff<cDiff)winnerId=game.opponentId;
        resultMsg=`🎰 **Bullfrog's Guess!** Pond's number: **${pondNum}**\n${game.challengerName} guessed ${cGuess} (off by ${cDiff})\n${game.opponentName} guessed ${opponentGuess} (off by ${oDiff})\n`;
    } else {
        const cValid=cGuess<=pondNum, oValid=opponentGuess<=pondNum;
        if(cValid&&oValid)winnerId=cGuess>opponentGuess?game.challengerId:opponentGuess>cGuess?game.opponentId:null;
        else if(cValid)winnerId=game.challengerId;
        else if(oValid)winnerId=game.opponentId;
        resultMsg=`🎰 **Bullfrog's Guess (Hard)!** Pond's number: **${pondNum}**\n${game.challengerName} guessed ${cGuess}${cGuess>pondNum?' ❌ (over!)':''}\n${game.opponentName} guessed ${opponentGuess}${opponentGuess>pondNum?' ❌ (over!)':''}\n`;
    }

    if(!winnerId){
        resultMsg+='🤝 Tie! Wagers returned.';
        if(real)await real.edit({content:resultMsg,components:[]});
        return;
    }
    const loserId=winnerId===game.challengerId?game.opponentId:game.challengerId;
    const winName=winnerId===game.challengerId?game.challengerName:game.opponentName;
    const wF=await getLiveFrog(winnerId), lF=await getLiveFrog(loserId);
    if(wF&&wF.alive){wF.fireflies+=game.wager;await pondFrogSet(winnerId,{fireflies:wF.fireflies});}
    if(lF&&lF.alive){lF.fireflies=Math.max(0,lF.fireflies-game.wager);await pondFrogSet(loserId,{fireflies:lF.fireflies});}
    resultMsg+=`🥊 **${winName}** wins and takes **${game.wager}** 🪲!`;
    if(real)await real.edit({content:resultMsg,components:[]});
}

// ── Baby breeding ─────────────────────────────────────────────────────────────

async function handleFrogBabyStatus(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    await pondFrogSet(interaction.user.id, frog);
    if (!frog.hasBaby) return interaction.reply({ content: `🐣 **${frog.name}** doesn't have a baby right now. Use \`/frog baby breed\` to start (requires day 14+).` });
    const now = Date.now();
    const age = Math.floor((now - frog.babyBornAt) / DAY_MS);
    const matureMs = BABY_MATURE_MS * (frog.career === 'nursery' ? 0.9 : 1);
    const sellable = (now - frog.babyBornAt) >= matureMs;
    const dangerMsg = frog.hungerDangerSince ? `\n⚠️ **Hunger is below 50!** Baby will be eaten if hunger stays this low for 12h.` : '';
    await interaction.reply({ content: `🐣 **${frog.name}**'s baby is **${age} day(s)** old.${sellable ? ` Ready to sell for **${BABY_SALE_PRICE}** 🪲! Use \`/frog baby sell\`.` : ` Sellable in ${Math.ceil((matureMs-(now-frog.babyBornAt))/DAY_MS)} more day(s).`}${dangerMsg}` });
}

async function handleFrogBabyBreed(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    const ageDays = (Date.now() - frog.bornAt) / DAY_MS;
    if (ageDays < BABY_BREED_MIN_DAYS) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐣 **${frog.name}** needs to be at least **day 14** to have babies (currently day ${Math.floor(ageDays)}).`, ephemeral: true });
    }
    if (frog.hasBaby) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐣 **${frog.name}** already has a baby! Check on it with \`/frog baby status\`.`, ephemeral: true });
    }
    frog.hasBaby = true;
    frog.babyBornAt = Date.now();
    frog.hungerDangerSince = null;
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({ content: `🥚 **${frog.name}** now has a baby! Keep their hunger above 50 or the baby will be in danger. Sell it after 7 days for **${BABY_SALE_PRICE}** 🪲 with \`/frog baby sell\`.` });
}

async function handleFrogBabySell(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    if (!frog.hasBaby) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐣 **${frog.name}** doesn't have a baby right now.`, ephemeral: true });
    }
    const matureMs = BABY_MATURE_MS * (frog.career === 'nursery' ? 0.9 : 1);
    if (Date.now() - frog.babyBornAt < matureMs) {
        await pondFrogSet(interaction.user.id, frog);
        const daysLeft = Math.ceil((matureMs - (Date.now() - frog.babyBornAt)) / DAY_MS);
        return interaction.reply({ content: `🐣 The baby isn't ready yet — ${daysLeft} more day(s) to go.`, ephemeral: true });
    }
    const price = colorPerk(frog) === 'babyBonus' ? Math.round(BABY_SALE_PRICE * 1.10) : BABY_SALE_PRICE;
    frog.fireflies += price;
    frog.hasBaby = false; frog.babyBornAt = null; frog.hungerDangerSince = null;
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({ content: `🐣 **${frog.name}**'s baby has found a new home for **${price}** 🪲!` });
}

// ── Partnerships ──────────────────────────────────────────────────────────────

const pondPartnerRequests = new Map(); // msgId → { requesterId, targetId, resolved, timer }

async function handleFrogPartnerPropose(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    if (frog.partnerId) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐸 **${frog.name}** is already partnered! Use \`/frog partner break\` to end the current partnership first.`, ephemeral: true });
    }
    const target = interaction.options.getUser('user');
    if (target.id === interaction.user.id) return interaction.reply({ content: "🐸 You can't partner with yourself!", ephemeral: true });
    const targetFrog = await pondFrogGet(target.id);
    if (!targetFrog || !targetFrog.alive) return interaction.reply({ content: `🐸 <@${target.id}> doesn't have a living frog.`, ephemeral: true });
    if (targetFrog.partnerId) return interaction.reply({ content: `🐸 **${targetFrog.name}** is already in a partnership.`, ephemeral: true });
    await pondFrogSet(interaction.user.id, frog);
    await interaction.reply({
        content: `💚 **${frog.name}** has sent a partnership request to <@${target.id}>'s **${targetFrog.name}**! Partnerships give both frogs +2 happiness per day and let you feed each other.`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pond:partner:accept').setLabel('Accept 💚').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('pond:partner:decline').setLabel('Decline').setStyle(ButtonStyle.Danger),
        )],
    });
    const msg = await interaction.fetchReply();
    const state = { requesterId: interaction.user.id, targetId: target.id, resolved: false, timer: null };
    state.timer = setTimeout(() => {
        if (pondPartnerRequests.get(msg.id) === state && !state.resolved) {
            state.resolved = true; pondPartnerRequests.delete(msg.id);
            msg.edit({ content: `💚 Partnership request expired.`, components: [] }).catch(() => {});
        }
    }, PARTNER_REQUEST_EXPIRY_MS);
    pondPartnerRequests.set(msg.id, state);
}

async function handlePartnerButton(interaction) {
    const msg = interaction.message;
    const state = pondPartnerRequests.get(msg.id);
    if (!state || state.resolved) return interaction.reply({ content: 'This partnership request has expired.', ephemeral: true });
    if (interaction.user.id !== state.targetId) return interaction.reply({ content: "🐸 This partnership request isn't for you!", ephemeral: true });
    state.resolved = true; clearTimeout(state.timer); pondPartnerRequests.delete(msg.id);
    if (interaction.customId === 'pond:partner:decline')
        return interaction.update({ content: '💚 Partnership request declined.', components: [] });
    // Accept
    const rf = await getLiveFrog(state.requesterId);
    const tf = await getLiveFrog(state.targetId);
    if (!rf || !rf.alive || !tf || !tf.alive)
        return interaction.update({ content: '💚 One of the frogs is no longer around — partnership cancelled.', components: [] });
    if (rf.partnerId || tf.partnerId)
        return interaction.update({ content: '💚 One of you is already partnered — partnership cancelled.', components: [] });
    rf.partnerId = state.targetId; tf.partnerId = state.requesterId;
    await pondFrogSet(state.requesterId, { partnerId: rf.partnerId });
    await pondFrogSet(state.targetId,   { partnerId: tf.partnerId });
    await interaction.update({ content: `💚 **${rf.name}** and **${tf.name}** are now partners! They'll each gain +2 happiness per day and can feed each other.`, components: [] });
}

async function handleFrogPartnerInfo(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    await pondFrogSet(interaction.user.id, frog);
    if (!frog.partnerId) return interaction.reply({ content: `🐸 **${frog.name}** doesn't have a partner yet. Use \`/frog partner propose @user\`.` });
    const pFrog = await pondFrogGet(frog.partnerId);
    if (!pFrog || !pFrog.alive) {
        frog.partnerId = null; await pondFrogSet(interaction.user.id, { partnerId: null });
        return interaction.reply({ content: `💚 **${frog.name}**'s partner is no longer around. The partnership has ended.` });
    }
    await interaction.reply({ content: `💚 **${frog.name}** is partnered with **${pFrog.name}**! Both frogs gain +2 happiness per day and can use \`/frog partner feed\` to feed each other.` });
}

async function handleFrogPartnerBreak(interaction) {
    const frog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(frog, interaction)) return;
    if (!frog.partnerId) {
        await pondFrogSet(interaction.user.id, frog);
        return interaction.reply({ content: `🐸 **${frog.name}** isn't in a partnership.`, ephemeral: true });
    }
    const pId = frog.partnerId;
    frog.partnerId = null;
    await pondFrogSet(interaction.user.id, { partnerId: null });
    const pFrog = await pondFrogGet(pId);
    if (pFrog) await pondFrogSet(pId, { partnerId: null });
    await interaction.reply({ content: `💔 **${frog.name}** ended the partnership. Both frogs are now single again.` });
}

async function handleFrogPartnerFeed(interaction) {
    const myFrog = await getLiveFrog(interaction.user.id);
    if (!requireLiveFrog(myFrog, interaction)) return;
    if (!myFrog.partnerId) {
        await pondFrogSet(interaction.user.id, myFrog);
        return interaction.reply({ content: `🐸 **${myFrog.name}** doesn't have a partner. Use \`/frog partner propose @user\` to find one.`, ephemeral: true });
    }
    const partnerFrog = await getLiveFrog(myFrog.partnerId);
    if (!partnerFrog || !partnerFrog.alive) {
        myFrog.partnerId = null; await pondFrogSet(interaction.user.id, { partnerId: null });
        return interaction.reply({ content: `💚 **${myFrog.name}**'s partner is no longer around. The partnership has ended.`, ephemeral: true });
    }
    // Use the CALLER's own feed cooldown (they're doing the feeding)
    const remaining = FEED_COOLDOWN_MS - (Date.now() - (myFrog.lastFedAt || 0));
    if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        await pondFrogSet(interaction.user.id, myFrog);
        return interaction.reply({ content: `🐸 You need to wait ~${mins < 60 ? `${mins}m` : `${Math.ceil(mins/60)}h`} before feeding again.`, ephemeral: true });
    }
    partnerFrog.hunger = Math.min(100, partnerFrog.hunger + FEED_RESTORE_BASE);
    myFrog.lastFedAt = Date.now();
    await pondFrogSet(myFrog.partnerId, { hunger: partnerFrog.hunger });
    await pondFrogSet(interaction.user.id, { lastFedAt: myFrog.lastFedAt });
    await interaction.reply({ content: `💚 **${myFrog.name}** fed their partner **${partnerFrog.name}**! (+${FEED_RESTORE_BASE} hunger)` });
}

// ── Pond events ────────────────────────────────────────────────────────────────

const pondEventButtons = new Map(); // msgId → { eventType, timer }

const POND_EVENTS = ['firefly_migration','worm_bloom','warm_sunshine','hawk_season','mysterious_frog','golden_dragonfly'];

async function runDailyEvent(client, meta, now) {
    const today = getTodayKey();
    if (meta.lastEventDay === today) return; // already fired today

    // Clear any expired timed events
    if (meta.activeEventType && meta.activeEventUntil && now > meta.activeEventUntil) {
        await pondFirestoreSet(POND_META_DOC_ID, { activeEventType: null, activeEventUntil: null }, 'pondMeta');
    }

    // Golden dragonfly has its own 1% chance roll separate from other events
    if (Math.random() < GOLDEN_DRAGONFLY_CHANCE) {
        await pondFirestoreSet(POND_META_DOC_ID, { lastEventDay: today, dragonflyClaimed: false }, 'pondMeta');
        try {
            const ch = await client.channels.fetch(POND_CHANNEL_ID);
            // Ping all frog owners
            const frogs = await pondFirestoreQuery({ aliveOnly: true });
            const mentions = frogs.map(f => `<@${f.ownerId}>`).join(' ');
            const msg = await ch.send({
                content: `✨ ${mentions}\n🌟 **A Golden Dragonfly has appeared in the pond!** The first frog to click wins **${GOLDEN_DRAGONFLY_REWARD}** 🪲!`,
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('pond:event:golden_dragonfly').setLabel('🌟 Catch It!').setStyle(ButtonStyle.Success))],
            });
            const eState = { eventType: 'golden_dragonfly', timer: null };
            eState.timer = setTimeout(() => {
                if (pondEventButtons.get(msg.id) === eState) {
                    pondEventButtons.delete(msg.id);
                    msg.edit({ content: `✨ The golden dragonfly flew away unclaimed...`, components: [] }).catch(() => {});
                }
            }, EVENT_BUTTON_EXPIRY_MS);
            pondEventButtons.set(msg.id, eState);
        } catch (e) { console.error('[Pond] golden dragonfly event failed:', e.message); }
        return;
    }

    // Pick one of the regular events
    const regularEvents = POND_EVENTS.filter(e => e !== 'golden_dragonfly');
    const pick = regularEvents[Math.floor(Math.random() * regularEvents.length)];
    await pondFirestoreSet(POND_META_DOC_ID, { lastEventDay: today }, 'pondMeta');

    const EVENT_INFO = {
        firefly_migration: { emoji: '🪲', title: 'Firefly Migration!',     desc: 'A swarm of fireflies passes through! Up to **5 frogs** can collect **+20 🪲** each — one claim per frog.',              btn: 'Collect 🪲' },
        worm_bloom:        { emoji: '🪱', title: 'Worm Bloom!',            desc: 'Worms are everywhere! Up to **5 frogs** can fill their hunger to **100** — one claim per frog.',             btn: 'Grab Worms 🪱' },
        warm_sunshine:     { emoji: '☀️', title: 'Warm Sunshine!',         desc: 'A beautiful sunny day! Up to **5 frogs** can fill their happiness to **100** — one claim per frog.',         btn: 'Soak it up ☀️' },
        hawk_season:       { emoji: '🦅', title: 'Hawk Season!',           desc: '🦅 **Hawk Season** is here for **24 hours** — hawk rewards AND penalties are **doubled**!', btn: null },
        mysterious_frog:   { emoji: '🐸', title: 'A Mysterious Frog!',     desc: '🐸 A mysterious frog has been spotted for **12 hours** — exploration rewards are **doubled**!', btn: null },
    };

    try {
        const ch = await client.channels.fetch(POND_CHANNEL_ID);
        const info = EVENT_INFO[pick];
        if (!info) return;

        if (pick === 'hawk_season' || pick === 'mysterious_frog') {
            const duration = pick === 'hawk_season' ? EVENT_HAWK_SEASON_MS : EVENT_MYSTERIOUS_FROG_MS;
            await pondFirestoreSet(POND_META_DOC_ID, { activeEventType: pick, activeEventUntil: now + duration }, 'pondMeta');
            await ch.send({ content: `${info.emoji} **Pond Event: ${info.title}**\n${info.desc}` });
        } else {
            const msg = await ch.send({
                content: `${info.emoji} **Pond Event: ${info.title}**\n${info.desc}`,
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pond:event:${pick}`).setLabel(info.btn).setStyle(ButtonStyle.Primary))],
            });
            const MAX_EVENT_CLAIMS = 5;
            const eState = { eventType: pick, claimedBy: new Set(), maxClaims: MAX_EVENT_CLAIMS, info, timer: null };
            eState.timer = setTimeout(() => {
                if (pondEventButtons.get(msg.id) === eState) {
                    pondEventButtons.delete(msg.id);
                    msg.edit({ content: `${info.emoji} **${info.title}** — the event has ended. (${eState.claimedBy.size}/${MAX_EVENT_CLAIMS} claimed)`, components: [] }).catch(() => {});
                }
            }, EVENT_BUTTON_EXPIRY_MS);
            pondEventButtons.set(msg.id, eState);
        }
    } catch (e) { console.error('[Pond] daily event failed:', e.message); }
}

async function handleEventButton(interaction) {
    const msg = interaction.message;
    const eventType = interaction.customId.replace('pond:event:', '');
    const state = pondEventButtons.get(msg.id);

    if (eventType === 'golden_dragonfly') {
        // Only first claim wins — check pond_meta
        const meta = await pondFirestoreGet(POND_META_DOC_ID);
        if (!meta || meta.dragonflyClaimed) return interaction.reply({ content: '🌟 The golden dragonfly was already caught!', ephemeral: true });
        await pondFirestoreSet(POND_META_DOC_ID, { dragonflyClaimed: true }, 'pondMeta');
        if (state) { clearTimeout(state.timer); pondEventButtons.delete(msg.id); }
        const frog = await getLiveFrog(interaction.user.id);
        if (!frog || !frog.alive) return interaction.reply({ content: "🌟 You caught it — but you don't have a living frog to receive the reward!", ephemeral: true });
        frog.fireflies += GOLDEN_DRAGONFLY_REWARD;
        await pondFrogSet(interaction.user.id, { fireflies: frog.fireflies });
        await interaction.update({ content: `🌟 **${frog.name}** caught the Golden Dragonfly and won **${GOLDEN_DRAGONFLY_REWARD}** 🪲!`, components: [] });
        return;
    }

    if (!state) return interaction.reply({ content: '🐸 This event has already ended.', ephemeral: true });

    // Per-user and total-claim limits
    if (state.claimedBy.has(interaction.user.id))
        return interaction.reply({ content: '🐸 Your frog already claimed this event!', ephemeral: true });
    if (state.claimedBy.size >= state.maxClaims)
        return interaction.reply({ content: `🐸 This event has already been claimed by ${state.maxClaims} frogs — all gone!`, ephemeral: true });

    const frog = await getLiveFrog(interaction.user.id);
    if (!frog || !frog.alive) return interaction.reply({ content: "🐸 You don't have a living frog to claim this!", ephemeral: true });

    // Register the claim before the async write so concurrent clicks can't both pass the size check
    state.claimedBy.add(interaction.user.id);
    const remaining = state.maxClaims - state.claimedBy.size;

    if (eventType === 'firefly_migration') {
        frog.fireflies += 20;
        await pondFrogSet(interaction.user.id, { fireflies: frog.fireflies });
        await interaction.reply({ content: `🪲 **${frog.name}** grabbed **+20 🪲** from the firefly migration! (${remaining} claim${remaining === 1 ? '' : 's'} left)`, ephemeral: true });
    } else if (eventType === 'worm_bloom') {
        frog.hunger = 100;
        await pondFrogSet(interaction.user.id, { hunger: frog.hunger });
        await interaction.reply({ content: `🪱 **${frog.name}** feasted on worms — hunger is back to **100**! (${remaining} claim${remaining === 1 ? '' : 's'} left)`, ephemeral: true });
    } else if (eventType === 'warm_sunshine') {
        frog.happiness = 100;
        await pondFrogSet(interaction.user.id, { happiness: frog.happiness });
        await interaction.reply({ content: `☀️ **${frog.name}** soaked up the sunshine — happiness is back to **100**! (${remaining} claim${remaining === 1 ? '' : 's'} left)`, ephemeral: true });
    }

    // If all claims used up, close the button
    if (state.claimedBy.size >= state.maxClaims) {
        clearTimeout(state.timer);
        pondEventButtons.delete(msg.id);
        msg.edit({ content: `${state.info.emoji} **${state.info.title}** — all ${state.maxClaims} claims collected! 🎉`, components: [] }).catch(() => {});
    }
}

// ── Pond / community commands ─────────────────────────────────────────────────

async function handlePondView(interaction) {
    await interaction.deferReply();
    const frogs=(await pondFirestoreQuery({aliveOnly:true})).map(f=>normalizeFrog({...f,stage:calcStage(f,Date.now(),f.isMayor?MAYOR_AGE_RATE:1)}));
    if(!frogs.length)return interaction.editReply({content:'🌿 The pond is quiet right now — adopt a frog with `/frog adopt` to bring it to life!'});
    const buffer=await drawPondScene(frogs.slice(0,30));
    await interaction.editReply({files:[new AttachmentBuilder(buffer,{name:'pond.gif'})]});
}

async function handlePondMemorial(interaction) {
    const frogs=await pondFirestoreQuery();
    const departed=frogs.filter(f=>f.alive===false).sort((a,b)=>(b.diedAt||0)-(a.diedAt||0)).slice(0,15);
    if(!departed.length)return interaction.reply({content:'🌿 No frogs have passed on yet. The pond remembers them when they do.'});
    const lines=departed.map(f=>`🪦 **${f.name}** (${(FROG_COLORS[f.color]||{}).name||f.color}) — <@${f.ownerId}> — lived ${f.lifespanDays??0} day(s)`);
    await interaction.reply({content:`These frogs hopped on to the great lilypad in the sky, but they'll always be remembered 💚\n\n${lines.join('\n')}`,allowedMentions:{parse:[]}});
}

const RULES_EMBED = {
    color: 0x2d6f8e,
    title: '🐸 The Pond — How to Play',
    description: "A cozy frog-keeping game with a fireflies economy. Adopt a frog with `/frog adopt` — you start with **15 🪲 fireflies**. Check in twice a day to keep them thriving.",
    fields: [
        { name: '🥚 Life Stages',
          value: 'Egg (day 0) → Tadpole (day 2+) → Froglet (day 4+) → Frog (day 7+) → Elder (day 60+, flower crown). Stages are time-based only. Every frog passes peacefully of old age at **day 75**.' },
        { name: '🎨 Colors & Perks',
          value: '🟢 Green: hunger -12.5% slower · 🟣 Purple: happiness -12.5% slower · 🟡 Golden: 10% shop discount\n🔵 Blue: +10% exploration rewards · 🩷 Pink: +10% hawk luck · 🟤 Brown: babies worth 10% more' },
        { name: '🍽️ Daily Care',
          value: 'Hunger & happiness drain ~2/hr (8 per 4h). Feed & play give +20 (4h cooldown each).\n`/frog feed [use_item]` — +35 with a worm · `/frog play [use_item]` — +35 with a toy\n`/frog status` — see your frog\'s portrait and full stats.' },
        { name: '🤒 Neglect & Illness',
          value: 'Hunger hits 0 → **sick** (72h to `/frog cure` for 35 🪲, or frog dies).\nHappiness hits 0 → **depressed** (72h to `/frog soothe` for 35 🪲, or frog runs away).' },
        { name: '🧭 Earning Fireflies',
          value: '`/frog explore` — **twice a day** (3x at lilypad lvl 9), random reward.\n`/frog hawk` — **twice a day**, pick from 5 minigames vs a hawk for 20 🪲.\n`/frog fight challenge @user|any wager` — bet 5-20 🪲 on a randomly-chosen 1v1 minigame.' },
        { name: '🍃 Lilypad Upgrades',
          value: '`/frog lilypad info|upgrade` — 10 levels:\nL2: +2 explore 🪲 · L3: +5/day passive · L4: +5 feeding · L5: +5 playing · L6: hawk loss 5% · L7: +10/day · L8: -15% decay · L9: +1 explore slot · L10: 100 🪲 bonus' },
        { name: '💼 Careers (day 7+)',
          value: '`/frog career info|choose|respec` — Free first pick. Respec every **Monday at 12:00 (GMT+1)** for 35 🪲.\nFisher: +3🪲/12h · Hunter: hawk luck · Caretaker: -12.5% decay · Explorer: +10% explore · Nursery: faster babies' },
        { name: '👑 Frog Mayor',
          value: 'A random frog is elected **every Wednesday at 20:00 UTC**. The mayor gets +2 hunger/happiness per day and +10% firefly income — but ages 10% faster. `/frog mayor` to see who\'s in charge.' },
        { name: '🐣 Babies (day 14+)',
          value: '`/frog baby breed` — start having a baby (requires day 14+).\n`/frog baby status` — check baby age.\n`/frog baby sell` — sell after 7 days for **50 🪲** (55 if Brown frog).\n⚠️ Keep hunger above 50 — if it drops below 50 for 12+ hours, the parent eats the baby!' },
        { name: '💚 Partnerships',
          value: '`/frog partner propose @user` — propose a partnership (+2 happiness/day for both, can feed each other).\n`/frog partner feed` — feed your partner\'s frog.\n`/frog partner info|break` — check or end your partnership.' },
        { name: '🎉 Pond Events',
          value: 'Random events happen once per day in #the-pond — click the button to claim!\n🪲 Firefly Migration (+20 🪲) · 🪱 Worm Bloom (hunger → 100) · ☀️ Warm Sunshine (happiness → 100)\n🦅 Hawk Season (double hawk rewards 24h) · 🐸 Mysterious Frog (double exploration 12h) · 🌟 Golden Dragonfly (100 🪲, first claim only, 1% chance)' },
        { name: '🛒 Shop & Tax',
          value: '`/pond shop buy worms|toys|nest` — worms/toys 2 🪲 each.\nPond tax: **10% of balance** every Friday at 12:00 (GMT+1) — automatic.' },
        { name: '🌐 Community',
          value: '`/pond view` · `/pond memorial` · `/frog leaderboard` · `/frog commands`' },
    ],
    footer: { text: 'Everything is now implemented! More content coming in future updates.' },
};

async function handlePondRules(interaction) { await interaction.reply({embeds:[RULES_EMBED]}); }

const COMMANDS_EMBED = {
    color: 0x2d6f8e,
    title: '🐸 Frog Command Overview',
    fields: [
        { name: '🐣 Getting Started', value: '`/frog adopt` — adopt your frog (starts with 15 🪲)\n`/frog status` — check your frog\n`/frog commands` — this list\n`/pond rules` — full game guide', inline: false },
        { name: '🍽️ Care', value: '`/frog feed [use_item]` — +20 hunger (4h CD, or +35 with worm)\n`/frog play [use_item]` — +20 happiness (4h CD, or +35 with toy)\n`/frog cure` — cure sickness (35 🪲)\n`/frog soothe` — lift depression (35 🪲)', inline: false },
        { name: '🧭 Activities', value: '`/frog explore` — explore for rewards (2x/day)\n`/frog hawk` — hawk minigame (2x/day, pick from 5 types)\n`/frog fight challenge @user wager` — challenge someone\n`/frog fight any wager` — open challenge for anyone', inline: false },
        { name: '🍃 Economy', value: '`/frog lilypad info` — see lilypad level & next upgrade\n`/frog lilypad upgrade` — spend 🪲 to upgrade\n`/pond shop buy item qty` — buy worms, toys, or nest\n`/frog leaderboard` — longest-living frogs', inline: false },
        { name: '🐣 Babies', value: '`/frog baby breed` — have a baby (day 14+)\n`/frog baby status` — check baby age\n`/frog baby sell` — sell after 7 days for 50 🪲', inline: false },
        { name: '💚 Partnerships', value: '`/frog partner propose @user` — propose\n`/frog partner feed` — feed partner\'s frog\n`/frog partner info` — see partner\n`/frog partner break` — end partnership', inline: false },
        { name: '💼 Career', value: '`/frog career info` — your current career\n`/frog career choose` — first pick (free, day 7+)\n`/frog career respec` — change career (35 🪲, Mondays only)', inline: false },
        { name: '🌐 Pond', value: '`/pond view` — see all frogs\n`/pond memorial` — frogs that have passed\n`/frog mayor` — current mayor info', inline: false },
    ],
};

async function handleFrogCommands(interaction) { await interaction.reply({embeds:[COMMANDS_EMBED]}); }

async function handlePondAdminFireflies(interaction) {
    if (!interaction.memberPermissions?.has('Administrator')) {
        return interaction.reply({ content: '🔒 Admin only.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const frog = await pondFrogGet(target.id);
    if (!frog) return interaction.reply({ content: `🐸 <@${target.id}> doesn't have a frog doc.`, ephemeral: true });
    normalizeFrog(frog);
    const before = frog.fireflies;
    if (sub === 'give') frog.fireflies += amount;
    else frog.fireflies = Math.max(0, frog.fireflies - amount);
    await pondFrogSet(target.id, { fireflies: frog.fireflies });
    await interaction.reply({ content: `🪲 **${frog.name}** (<@${target.id}>): ${before} → **${frog.fireflies}** fireflies.`, ephemeral: true });
}

async function announceDeath(client, frog) {
    if(!POND_CHANNEL_ID)return;
    try {
        const ch = await client.channels.fetch(POND_CHANNEL_ID);
        let ownerName = null;
        try { const m = await ch.guild.members.fetch(frog.ownerId); ownerName = m.displayName; } catch(_){}
        const baseMsg = ownerName
            ? deathMessage(frog).replace(`**${frog.name}**`, `**${frog.name}** (${ownerName})`)
            : deathMessage(frog);

        // Legacy score calculation
        const legacyScore  = calcLegacyScore(frog);
        const tokensEarned = Math.floor(legacyScore / 10);
        const newLegacyPoints = (frog.legacyPoints || 0) + legacyScore;
        const newLilyTokens   = (frog.lilyTokens   || 0) + tokensEarned;
        if (legacyScore > 0) {
            await pondFrogSet(frog.ownerId, { legacyPoints: newLegacyPoints, lilyTokens: newLilyTokens });
        }
        const genNum = frog.legacyGen || 0;
        const legacyLine = tokensEarned > 0
            ? `\n🌿 **${frog.name}** earned **${tokensEarned} Lily Token${tokensEarned!==1?'s':''}** for their time in the pond${genNum>0?` (Generation ${genNum})`:''}. Next frog: \`/frog legacy info\``
            : '';

        await ch.send({ content: baseMsg + legacyLine, allowedMentions: { parse: [] } });
    }
    catch(e){console.error('[Pond] announceDeath failed:',e.message);}
}

// ── Pond Invest handlers ──────────────────────────────────────────────────────

async function handlePondInvestInfo(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    await pondFrogSet(interaction.user.id,frog);
    const lines=[`💰 **${frog.name}**'s Investments\n`];
    for(const[key,inv]of Object.entries(INVESTMENTS)){
        const fieldKey=INVEST_FIELD_MAP[key];
        const cur=frog[fieldKey]||0;
        const nextTier=inv.tiers[cur];
        if(cur===0){
            lines.push(`**${inv.label}** — *Not owned* (${inv.desc})`);
            if(key==='worm_farm') lines.push(`  Tier 1: 1 free worm every ${nextTier.intervalDays} days — ${shopPrice(frog,nextTier.cost)} 🪲`);
            else lines.push(`  Tier 1: +${nextTier.income} 🪲/day — ${shopPrice(frog,nextTier.cost)} 🪲`);
        } else {
            const curData=inv.tiers[cur-1];
            if(key==='worm_farm') lines.push(`**${inv.label}** — Tier ${cur}/3: 1 free worm${curData.items?.toys?' + toy':''} every ${curData.intervalDays} day(s)`);
            else {
                let eff=`+${curData.income} 🪲/day`;
                if(key==='lily_garden')eff+=` · +${Math.round((curData.exploreBonus||0)*100)}% explore 🪲`;
                lines.push(`**${inv.label}** — Tier ${cur}/3: ${eff}`);
            }
            if(nextTier){
                const upCost=shopPrice(frog,nextTier.cost);
                const upEff=key==='worm_farm'?`1 free worm${nextTier.items?.toys?' + toy':''} every ${nextTier.intervalDays} day(s)`:`+${nextTier.income} 🪲/day`;
                lines.push(`  → Upgrade to Tier ${cur+1}: ${upCost} 🪲 (${upEff})`);
            } else { lines.push(`  → Max tier!`); }
        }
        lines.push('');
    }
    lines.push('Use `/pond invest buy item:<name> tier:<1-3>` to purchase.');
    await interaction.reply({content:lines.join('\n'),ephemeral:true});
}

async function handlePondInvestBuy(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    const itemKey=interaction.options.getString('item');
    const tier=interaction.options.getInteger('tier');
    const inv=INVESTMENTS[itemKey];
    if(!inv){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:'❌ Unknown investment.',ephemeral:true});}
    const fieldKey=INVEST_FIELD_MAP[itemKey];
    const cur=frog[fieldKey]||0;
    if(tier!==cur+1){
        await pondFrogSet(interaction.user.id,frog);
        return interaction.reply({content:cur===0?`💰 Buy Tier 1 of **${inv.label}** first.`:tier<=cur?`💰 You already own Tier ${cur} of **${inv.label}**.`:`💰 Upgrade to Tier ${cur+1} first.`,ephemeral:true});
    }
    if(tier>inv.tiers.length){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`💰 **${inv.label}** only has ${inv.tiers.length} tiers.`,ephemeral:true});}
    const tierData=inv.tiers[tier-1];
    const cost=shopPrice(frog,tierData.cost);
    if(frog.fireflies<cost){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`🪲 Need ${cost} 🪲 but **${frog.name}** only has ${frog.fireflies}.`,ephemeral:true});}
    frog.fireflies-=cost;
    frog[fieldKey]=tier;
    await pondFrogSet(interaction.user.id,frog);
    let eff=itemKey==='worm_farm'?`1 free worm${tierData.items?.toys?' + toy':''} every ${tierData.intervalDays} day(s)`:`+${tierData.income} 🪲/day${itemKey==='lily_garden'?` · +${Math.round((tierData.exploreBonus||0)*100)}% explore 🪲`:''}`;
    await interaction.reply({content:`💰 **${inv.label}** upgraded to Tier ${tier}! (-${cost} 🪲)\nEffect: ${eff}`});
}

// ── Cosmetic wardrobe & equip handlers ────────────────────────────────────────

async function handleFrogWardrobe(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    await pondFrogSet(interaction.user.id,frog);
    const owned=getCosmetics(frog);
    if(!owned.length) return interaction.reply({content:`👒 **${frog.name}** doesn't own any cosmetics yet. Buy from \`/pond shop buy\`!`,ephemeral:true});
    const wearing=[frog.equippedHat,frog.equippedEffect,frog.equippedAccessory].filter(Boolean);
    const wearLine=wearing.length?`Currently wearing: ${wearing.map(k=>COSMETIC_ITEMS[k]?.label||k).join(', ')}\n`:'';
    const lines=owned.map(k=>{
        const c=COSMETIC_ITEMS[k]||{label:k,slot:'?',desc:''};
        const on=(c.slot==='hat'&&frog.equippedHat===k)||(c.slot==='effect'&&frog.equippedEffect===k)||(c.slot==='accessory'&&frog.equippedAccessory===k);
        return `${on?'✅':'⬜'} **${c.label}** (${c.slot}) — ${c.desc}`;
    });
    await interaction.reply({content:`👒 **${frog.name}**'s Wardrobe\n${wearLine}${lines.join('\n')}\n\nUse \`/frog equip item:<name>\` to equip/unequip.`,ephemeral:true});
}

async function handleFrogEquip(interaction) {
    const frog=await getLiveFrog(interaction.user.id);
    if(!requireLiveFrog(frog,interaction))return;
    const itemKey=interaction.options.getString('item');
    const c=COSMETIC_ITEMS[itemKey];
    if(!c){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:'❌ Unknown cosmetic.',ephemeral:true});}
    if(!getCosmetics(frog).includes(itemKey)){await pondFrogSet(interaction.user.id,frog);return interaction.reply({content:`👒 **${frog.name}** doesn't own **${c.label}**. Buy it first: \`/pond shop buy item:${itemKey}\`.`,ephemeral:true});}
    const slotField=c.slot==='hat'?'equippedHat':c.slot==='effect'?'equippedEffect':'equippedAccessory';
    const alreadyOn=frog[slotField]===itemKey;
    frog[slotField]=alreadyOn?null:itemKey;
    await pondFrogSet(interaction.user.id,{[slotField]:frog[slotField]});
    const verb=alreadyOn?`removed **${c.label}**`:`equipped **${c.label}**`;
    await interaction.reply({content:`👒 **${frog.name}** ${verb}!`,files:[new AttachmentBuilder(await drawFrogPortrait(frog),{name:'frog.gif'})]});
}

// ── Legacy handlers ───────────────────────────────────────────────────────────

async function handleFrogLegacyInfo(interaction) {
    const doc=await pondFrogGet(interaction.user.id);
    if(!doc) return interaction.reply({content:"🐸 No frog found yet. Adopt one with `/frog adopt`!",ephemeral:true});
    normalizeFrog(doc);
    const bonuses=[];
    if(doc.legacyBonusFireflies>0) bonuses.push(`Ancestral Wisdom ×${doc.legacyBonusFireflies/10} → next frog +${doc.legacyBonusFireflies} 🪲`);
    if(doc.legacyBonusExplore>0)   bonuses.push(`Elder's Memory ×${doc.legacyBonusExplore} → +${doc.legacyBonusExplore} explore 🪲`);
    if(doc.legacyHeirloomLilypad)  bonuses.push('Heirloom Lilypad → next frog starts at L2');
    if(doc.legacyInheritedCosmetic) bonuses.push(`Gilded Egg → cosmetics ready to inherit`);
    if(doc.legacyDeepRoots)         bonuses.push('Deep Roots → +2 days passive at birth');
    if(doc.legacyNameplate)         bonuses.push('Legacy Nameplate → active');
    const bonusLine=bonuses.length?`**Active bonuses:**\n${bonuses.map(b=>`• ${b}`).join('\n')}`:'No legacy bonuses yet.';
    const shopLines=Object.entries(LEGACY_BONUSES).map(([k,b])=>{
        const maxed=isLegacyBonusMaxed(doc,k);
        return `• **${b.label}** — ${b.cost} 🌿${maxed?' *(maxed)*':''}: ${b.desc}`;
    });
    await interaction.reply({content:`🌿 **Legacy**\nLily Tokens: **${doc.lilyTokens}** 🌿 · Total earned: ${doc.legacyPoints} pts · Generation **${doc.legacyGen}**\n\n${bonusLine}\n\n**Spend tokens** with \`/frog legacy spend\`:\n${shopLines.join('\n')}`,ephemeral:true});
}

async function handleFrogLegacySpend(interaction) {
    const doc=await pondFrogGet(interaction.user.id);
    if(!doc) return interaction.reply({content:"🐸 No frog found.",ephemeral:true});
    normalizeFrog(doc);
    const bonusKey=interaction.options.getString('bonus');
    const bonus=LEGACY_BONUSES[bonusKey];
    if(!bonus) return interaction.reply({content:'❌ Unknown legacy bonus.',ephemeral:true});
    if(isLegacyBonusMaxed(doc,bonusKey)) return interaction.reply({content:`🌿 **${bonus.label}** is already at max.`,ephemeral:true});
    if((doc.lilyTokens||0)<bonus.cost) return interaction.reply({content:`🌿 Need ${bonus.cost} Lily Tokens but you only have ${doc.lilyTokens||0}.`,ephemeral:true});
    if(bonusKey==='gilded_egg'&&!getCosmetics(doc).length) return interaction.reply({content:`🌿 **Gilded Egg** requires owning at least one cosmetic. Buy from \`/pond shop buy\`.`,ephemeral:true});
    doc.lilyTokens-=bonus.cost;
    if(bonusKey==='ancestral_wisdom') doc.legacyBonusFireflies=(doc.legacyBonusFireflies||0)+10;
    else if(bonusKey==='heirloom_lilypad') doc.legacyHeirloomLilypad=true;
    else if(bonusKey==='elders_memory')  doc.legacyBonusExplore=(doc.legacyBonusExplore||0)+1;
    else if(bonusKey==='gilded_egg')     doc.legacyInheritedCosmetic=doc.cosmeticsStr;
    else if(bonusKey==='deep_roots')     doc.legacyDeepRoots=true;
    else if(bonusKey==='legacy_nameplate') doc.legacyNameplate=true;
    await pondFrogSet(interaction.user.id,{lilyTokens:doc.lilyTokens,legacyBonusFireflies:doc.legacyBonusFireflies,legacyBonusExplore:doc.legacyBonusExplore,legacyHeirloomLilypad:doc.legacyHeirloomLilypad,legacyInheritedCosmetic:doc.legacyInheritedCosmetic,legacyDeepRoots:doc.legacyDeepRoots,legacyNameplate:doc.legacyNameplate});
    await interaction.reply({content:`🌿 Purchased **${bonus.label}** for ${bonus.cost} Lily Tokens! (${doc.lilyTokens} remaining)\n${bonus.desc}`,ephemeral:true});
}

// ── Interaction router ────────────────────────────────────────────────────────

async function handlePondInteraction(interaction) {
    if(!interaction.isChatInputCommand())return;
    try {
        if(interaction.commandName==='frog'){
            const group=interaction.options.getSubcommandGroup(false), sub=interaction.options.getSubcommand();
            if(group==='lilypad'){
                if(sub==='info')return await handleFrogLilypadInfo(interaction);
                if(sub==='upgrade')return await handleFrogLilypadUpgrade(interaction);
            }
            if(group==='fight'){
                if(sub==='challenge')return await handleFrogFrogfight(interaction,false);
                if(sub==='any')return await handleFrogFrogfight(interaction,true);
            }
            if(group==='baby'){
                if(sub==='status')return await handleFrogBabyStatus(interaction);
                if(sub==='breed')return await handleFrogBabyBreed(interaction);
                if(sub==='sell')return await handleFrogBabySell(interaction);
            }
            if(group==='partner'){
                if(sub==='propose')return await handleFrogPartnerPropose(interaction);
                if(sub==='info')return await handleFrogPartnerInfo(interaction);
                if(sub==='break')return await handleFrogPartnerBreak(interaction);
                if(sub==='feed')return await handleFrogPartnerFeed(interaction);
            }
            if(group==='career'){
                if(sub==='info')return await handleFrogCareerInfo(interaction);
                if(sub==='choose')return await handleFrogCareerSet(interaction,false);
                if(sub==='respec')return await handleFrogCareerSet(interaction,true);
            }
            if(group==='legacy'){
                if(sub==='info')return await handleFrogLegacyInfo(interaction);
                if(sub==='spend')return await handleFrogLegacySpend(interaction);
            }
            if(sub==='wardrobe')return await handleFrogWardrobe(interaction);
            if(sub==='equip')return await handleFrogEquip(interaction);
            if(sub==='adopt')return await handleFrogAdopt(interaction);
            if(sub==='feed')return await handleFrogCare(interaction,'feed');
            if(sub==='play')return await handleFrogCare(interaction,'play');
            if(sub==='cure')return await handleFrogCure(interaction,'cure');
            if(sub==='soothe')return await handleFrogCure(interaction,'soothe');
            if(sub==='status')return await handleFrogStatus(interaction);
            if(sub==='leaderboard')return await handleFrogLeaderboard(interaction);
            if(sub==='explore')return await handleFrogExplore(interaction);
            if(sub==='hawk')return await handleFrogHawk(interaction);
            if(sub==='mayor')return await handleFrogMayor(interaction);
            if(sub==='commands')return await handleFrogCommands(interaction);
            if(sub==='gas')return await handleFrogGas(interaction);
        }
        if(interaction.commandName==='pond'){
            const group=interaction.options.getSubcommandGroup(false), sub=interaction.options.getSubcommand();
            if(group==='shop'&&sub==='buy')return await handlePondShopBuy(interaction);
            if(group==='admin'&&(sub==='give'||sub==='remove'))return await handlePondAdminFireflies(interaction);
            if(group==='invest'){
                if(sub==='info')return await handlePondInvestInfo(interaction);
                if(sub==='buy')return await handlePondInvestBuy(interaction);
            }
            if(sub==='view')return await handlePondView(interaction);
            if(sub==='memorial')return await handlePondMemorial(interaction);
            if(sub==='rules')return await handlePondRules(interaction);
        }
    } catch(e){
        console.error('[Pond] handlePondInteraction failed:',e.stack||e.message);
        const payload={content:'❌ Something went wrong in the pond. Try again in a moment.',ephemeral:true};
        if(interaction.deferred||interaction.replied)await interaction.editReply(payload).catch(()=>{});
        else await interaction.reply(payload).catch(()=>{});
    }
}

function isPondButton(customId) { return typeof customId==='string'&&customId.startsWith('pond:'); }
function isPondModal(customId)  { return typeof customId==='string'&&customId.startsWith('pond:'); }

async function handlePondButtonInteraction(interaction) {
    if(!interaction.isButton())return;
    try {
        if(interaction.customId.startsWith('pond:hawk:'))return await handleHawkButton(interaction);
        if(interaction.customId==='pond:ff:accept'||interaction.customId==='pond:ff:decline'||interaction.customId.startsWith('pond:ff:ttt:')||interaction.customId.startsWith('pond:ff:rps:'))return await handleFrogfightButton(interaction);
        if(interaction.customId==='pond:partner:accept'||interaction.customId==='pond:partner:decline')return await handlePartnerButton(interaction);
        if(interaction.customId==='pond:gas:confirm'||interaction.customId==='pond:gas:cancel')return await handleFrogGasButton(interaction);
        if(interaction.customId.startsWith('pond:event:'))return await handleEventButton(interaction);
    } catch(e){
        console.error('[Pond] handlePondButtonInteraction failed:',e.stack||e.message);
        const payload={content:'❌ Something went wrong in the pond. Try again in a moment.',ephemeral:true};
        if(interaction.deferred||interaction.replied)await interaction.editReply(payload).catch(()=>{});
        else await interaction.reply(payload).catch(()=>{});
    }
}

async function handlePondModalInteraction(interaction) {
    if(!interaction.isModalSubmit())return;
    try {
        if(interaction.customId.startsWith('pond:hawk:'))return await handleHawkModal(interaction);
        if(interaction.customId.startsWith('pond:ff:bullfrog_modal:'))return await handleFrogfightModal(interaction);
    } catch(e){
        console.error('[Pond] handlePondModalInteraction failed:',e.stack||e.message);
        if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'❌ Something went wrong. Try again.',ephemeral:true}).catch(()=>{});
    }
}

// ── Decay ticker ──────────────────────────────────────────────────────────────

let tickerRunning=false;

async function runPondTax(client, meta, now) {
    const fridayMs=lastFridayTaxWindowMs();
    if(now<fridayMs)return;
    if(meta.lastPondTaxAt && meta.lastPondTaxAt>=fridayMs)return;

    const frogs=await pondFirestoreQuery({aliveOnly:true});
    let total=0;
    for(const frog of frogs){
        normalizeFrog(frog);
        const owed=Math.floor(frog.fireflies*POND_TAX_RATE);
        if(owed<=0)continue;
        frog.fireflies-=owed; total+=owed;
        await pondFrogSet(frog.ownerId,{fireflies:frog.fireflies});
    }
    await pondFirestoreSet(POND_META_DOC_ID,{lastPondTaxAt:now},'pondMeta');
    if(total>0&&POND_CHANNEL_ID){
        try{const ch=await client.channels.fetch(POND_CHANNEL_ID);await ch.send({content:`🪲 **Pond maintenance!** ${total} fireflies collected (10% tax). The pond stays clean 🌿`});}
        catch(e){console.error('[Pond] runPondTax announce failed:',e.message);}
    }
}

async function runMayorElection(client, meta, now) {
    const wedMs=lastWednesdayElectionMs();
    if(now<wedMs)return;
    if(meta.lastMayorElectionAt && meta.lastMayorElectionAt>=wedMs)return;

    const frogs=await pondFirestoreQuery({aliveOnly:true});
    if(!frogs.length)return;

    // Clear all current isMayor flags
    if(meta.mayorOwnerId){
        try { await pondFrogSet(meta.mayorOwnerId,{isMayor:false}); } catch(_){}
    }

    const elected=frogs[Math.floor(Math.random()*frogs.length)];
    elected.isMayor=true;
    await pondFrogSet(elected.ownerId,{isMayor:true});
    await pondFirestoreSet(POND_META_DOC_ID,{mayorOwnerId:elected.ownerId,lastMayorElectionAt:now},'pondMeta');

    if(POND_CHANNEL_ID){
        try{const ch=await client.channels.fetch(POND_CHANNEL_ID);await ch.send({content:`👑 **${elected.name}** has been elected **Frog Mayor** of the pond! They gain +2 hunger/happiness per day and +10% 🪲 income — but age 10% faster. Next election: Wednesday 20:00 UTC.`});}
        catch(e){console.error('[Pond] runMayorElection announce failed:',e.message);}
    }
}

async function runPondTick(client) {
    if(tickerRunning)return;
    tickerRunning=true;
    try {
        const now=Date.now();
        let meta=await pondFirestoreGet(POND_META_DOC_ID)||{};

        // One-time pin message on first deploy after this version ships
        if(!meta.pinMessageId&&POND_CHANNEL_ID){
            try {
                const ch=await client.channels.fetch(POND_CHANNEL_ID);
                const pm=await ch.send({content:"*Welcome to the pond!* 🐸\n\nBegin your journey with `/frog adopt`.\n\nYour frog has:\n🍽️ Hunger\n😊 Happiness\nThese decay over time, so remember to feed and play with your frog!"});
                await pm.pin().catch(()=>{});
                await pondFirestoreSet(POND_META_DOC_ID,{pinMessageId:pm.id},'pondMeta');
                meta.pinMessageId=pm.id;
            } catch(e){console.error('[Pond] pin message failed:',e.message);}
        }

        const frogs=await pondFirestoreQuery({aliveOnly:true});
        for(const frog of frogs){
            normalizeFrog(frog,now);
            const ageMult=frog.isMayor?MAYOR_AGE_RATE:1;
            const before=frog.alive;
            applyDecay(frog,now);
            // Never write alive:true during a routine tick — if gas (or any other path) killed this
            // frog between the query and now, writing alive:true would silently undo that kill.
            // Only write alive:false (plus death fields) when the frog actually dies this tick.
            const tickSave = {
                hunger:frog.hunger, happiness:frog.happiness, stage:frog.stage,
                lastTickAt:frog.lastTickAt, fireflies:frog.fireflies, lastPassiveAt:frog.lastPassiveAt, lastFisherAt:frog.lastFisherAt,
                sick:frog.sick, sickSince:frog.sickSince, depressed:frog.depressed, depressedSince:frog.depressedSince,
                ownerId:frog.ownerId, name:frog.name, color:frog.color, lilypadLevel:frog.lilypadLevel,
                worms:frog.worms, toys:frog.toys, hasNest:frog.hasNest, isMayor:frog.isMayor,
                patchV2Granted:frog.patchV2Granted, lilypadL10Claimed:frog.lilypadL10Claimed,
                exploresToday:frog.exploresToday, exploresResetDay:frog.exploresResetDay,
                hawksDoneToday:frog.hawksDoneToday, hawksResetDay:frog.hawksResetDay,
                lastCareerRespecAt:frog.lastCareerRespecAt, career:frog.career,
                hasBaby:frog.hasBaby, babyBornAt:frog.babyBornAt, hungerDangerSince:frog.hungerDangerSince,
                partnerId:frog.partnerId,
                bornAt:frog.bornAt, lastFedAt:frog.lastFedAt, lastPlayedAt:frog.lastPlayedAt,
                investAlgaeFarm:frog.investAlgaeFarm, investLantern:frog.investLantern,
                investLilyGarden:frog.investLilyGarden, investWormFarm:frog.investWormFarm,
                lastWormFarmAt:frog.lastWormFarmAt,
            };
            if(!frog.alive){
                tickSave.alive=false; tickSave.diedAt=frog.diedAt;
                tickSave.deathReason=frog.deathReason; tickSave.lifespanDays=frog.lifespanDays;
            }
            await pondFrogSet(frog.ownerId, tickSave);
            if(before&&!frog.alive)await announceDeath(client,frog);
            if(frog.babyEaten&&POND_CHANNEL_ID){
                try{const ch=await client.channels.fetch(POND_CHANNEL_ID);await ch.send({content:`🍽️ **${frog.name}**'s hunger dropped below 50 for too long — the baby was eaten. 💔`});}
                catch(_){}
            }
        }
        // Re-fetch meta after potential pin write
        meta=await pondFirestoreGet(POND_META_DOC_ID)||{};
        await runPondTax(client,meta,now);
        await runMayorElection(client,meta,now);
        await runDailyEvent(client,meta,now);
    } catch(e){
        console.error('[Pond] runPondTick error:',e.stack||e.message);
    } finally { tickerRunning=false; }
}

function startPondTicker(client) {
    setInterval(()=>runPondTick(client).catch(()=>{}),TICK_INTERVAL_MS);
    setTimeout(()=>runPondTick(client).catch(()=>{}),10000);
}

module.exports = {
    pondCommands,
    isPondCommand,
    handlePondInteraction,
    isPondButton,
    handlePondButtonInteraction,
    isPondModal,
    handlePondModalInteraction,
    startPondTicker,
};
