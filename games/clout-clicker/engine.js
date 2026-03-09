/* ============================================================
   Clout Clicker — Game Engine
   Game state, loop, save/load, Firebase, calculations
   ============================================================ */

(function() {
'use strict';

const { BUILDINGS, UPGRADES, ACHIEVEMENTS, formatNumber, formatTime, getBuildingCost, getMaxAffordable } = window.GameData;

/* ── Firebase ─────────────────────────────────────────────── */
const firebaseConfig = {
    apiKey: 'AIzaSyClA0dmz4D3TDbhwvWmUeVinW6A18NQUUU',
    authDomain: 'truebeast-support.firebaseapp.com',
    projectId: 'truebeast-support',
    storageBucket: 'truebeast-support.firebasestorage.app',
    messagingSenderId: '726473476878',
    appId: '1:726473476878:web:c4439471895d7edf9b255f',
};

let fbApp, fbDb, fbAuth;
try {
    if (typeof firebase !== 'undefined') {
        // Avoid double-init if already initialized
        if (firebase.apps && firebase.apps.length > 0) {
            fbApp = firebase.apps[0];
        } else {
            fbApp = firebase.initializeApp(firebaseConfig);
        }
        fbDb   = firebase.firestore();
        fbAuth = firebase.auth();
    }
} catch(e) {
    console.warn('Firebase init failed:', e);
}

/* ── Initial State ────────────────────────────────────────── */
function defaultState() {
    return {
        clout:            0,
        totalCloutEver:   0,
        cps:              0,
        clickPower:       1,
        clicks:           0,
        sessionClicks:    0,
        buildings:        {},   // { buildingId: owned count }
        upgrades:         new Set(),
        achievements:     new Set(),
        prestigeLevel:    0,
        viralChips:       0,
        peakClickCps:     0,
        goldenCloutClicks:0,
        goldenCloutThisRun: 0,
        frenzyCount:      0,
        clickFrenzyCount: 0,
        freeUpgradeCount: 0,
        startTime:        Date.now(),
        saveTime:         Date.now(),
        timePlayed:       0,
        timeSincePrestige:0,
        longestOffline:   0,
        saveLoaded:       false,
        isLoggedIn:       false,
        displayName:      '',
        photoURL:         '',
        userId:           '',

        // transient (not saved)
        humbleTimer:      0,
        afkTimer:         0,
        lastClickTime:    0,
        goldenFastClick:  false,
    };
}

/* ── Game State ───────────────────────────────────────────── */
window.GameState = defaultState();
const GS = window.GameState;

/* ── Active Buffs ─────────────────────────────────────────── */
const Buffs = {
    frenzy:      null,  // { mult, endTime }
    clickFrenzy: null,  // { mult, endTime }
};

function getActiveCpsMultiplier() {
    return Buffs.frenzy ? Buffs.frenzy.mult : 1;
}
function getActiveClickMultiplier() {
    return Buffs.clickFrenzy ? Buffs.clickFrenzy.mult : 1;
}

/* ── CPS / Click Power Calculation ──────────────────────────
   Called whenever buildings or upgrades change.
   ─────────────────────────────────────────────────────────── */
function recalculate() {
    const s = window.GameState;

    // Collect multipliers per building
    const buildingMults = {};
    BUILDINGS.forEach(b => { buildingMults[b.id] = 1; });

    let globalMult = 1;
    let clickMult  = 1;

    // Prestige CPS bonus (base: +1% per Viral Chip)
    const basePrestigeBonus = 1 + (s.viralChips || 0) * 0.01;
    globalMult *= basePrestigeBonus;

    // Process upgrades
    s.upgrades.forEach(upId => {
        const up = UPGRADES.find(u => u.id === upId);
        if (!up) return;

        switch (up.type) {
            case 'building_mult':
                buildingMults[up.buildingId] = (buildingMults[up.buildingId] || 1) * up.multiplier;
                break;
            case 'global_mult':
                globalMult *= up.multiplier;
                break;
            case 'click_mult':
                clickMult *= up.multiplier;
                break;
            case 'prestige_cps':
                // Already handled above via viralChips, but extra stacking bonus
                globalMult *= (1 + (s.viralChips || 0) * up.multiplier);
                break;
            case 'synergy': {
                // Synergy: buildingA count × bonus% added to buildingB multiplier
                const aCount = s.buildings[up.buildingA] || 0;
                const addedMult = 1 + aCount * up.synergyBonus;
                buildingMults[up.buildingB] = (buildingMults[up.buildingB] || 1) * addedMult;
                break;
            }
            default: break;
        }
    });

    // Sum up CPS from all buildings
    let totalCps = 0;
    BUILDINGS.forEach(b => {
        const owned = s.buildings[b.id] || 0;
        if (owned > 0) {
            totalCps += owned * b.baseCps * buildingMults[b.id];
        }
    });

    s.cps        = totalCps * globalMult;
    s.clickPower = 1 * clickMult * globalMult;

    // Store effective CPS per building unit so UI can display it
    s._effectiveCps = {};
    BUILDINGS.forEach(b => {
        s._effectiveCps[b.id] = b.baseCps * buildingMults[b.id] * globalMult;
    });
}

/* ── Save / Load ─────────────────────────────────────────── */
function serializeState() {
    const s = window.GameState;
    const data = {
        clout:            s.clout,
        totalCloutEver:   s.totalCloutEver,
        clicks:           s.clicks,
        buildings:        { ...s.buildings },
        upgrades:         [...s.upgrades],
        achievements:     [...s.achievements],
        prestigeLevel:    s.prestigeLevel,
        viralChips:       s.viralChips,
        peakClickCps:     s.peakClickCps || 0,
        goldenCloutClicks:s.goldenCloutClicks,
        goldenCloutThisRun: s.goldenCloutThisRun,
        frenzyCount:      s.frenzyCount,
        clickFrenzyCount: s.clickFrenzyCount,
        freeUpgradeCount: s.freeUpgradeCount,
        startTime:        s.startTime,
        saveTime:         Date.now(),
        timePlayed:       s.timePlayed,
        timeSincePrestige:s.timeSincePrestige,
        longestOffline:   s.longestOffline,
        displayName:      s.displayName,
        photoURL:         s.photoURL || '',
        saveLoaded:       s.saveLoaded,
        goldenFastClick:  s.goldenFastClick,
    };
    return data;
}

function deserializeState(data) {
    const s = window.GameState;
    s.clout            = data.clout            || 0;
    s.totalCloutEver   = data.totalCloutEver   || 0;
    s.clicks           = data.clicks           || 0;
    s.buildings        = data.buildings        || {};
    s.upgrades         = new Set(data.upgrades || []);
    s.achievements     = new Set(data.achievements || []);
    s.prestigeLevel    = data.prestigeLevel    || 0;
    s.viralChips       = data.viralChips       || 0;
    s.peakClickCps     = data.peakClickCps     || 0;
    s.goldenCloutClicks= data.goldenCloutClicks|| 0;
    s.goldenCloutThisRun = data.goldenCloutThisRun || 0;
    s.frenzyCount      = data.frenzyCount      || 0;
    s.clickFrenzyCount = data.clickFrenzyCount || 0;
    s.freeUpgradeCount = data.freeUpgradeCount || 0;
    s.startTime        = data.startTime        || Date.now();
    s.saveTime         = data.saveTime         || Date.now();
    s.timePlayed       = data.timePlayed       || 0;
    s.timeSincePrestige= data.timeSincePrestige|| 0;
    s.longestOffline   = data.longestOffline   || 0;
    s.displayName      = data.displayName      || '';
    s.photoURL         = data.photoURL         || '';
    s.saveLoaded       = true;
    s.goldenFastClick  = data.goldenFastClick  || false;

    recalculate();
}

function saveToLocalStorage() {
    try {
        const data = serializeState();
        localStorage.setItem('clout-clicker-save', btoa(JSON.stringify(data)));
    } catch(e) {
        console.warn('localStorage save failed:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem('clout-clicker-save');
        if (!raw) return false;
        const data = JSON.parse(atob(raw));
        deserializeState(data);
        return true;
    } catch(e) {
        console.warn('localStorage load failed:', e);
        return false;
    }
}

async function saveToFirebase() {
    if (!fbDb || !fbAuth || !fbAuth.currentUser) return;
    const uid = fbAuth.currentUser.uid;
    try {
        const data = serializeState();
        await fbDb.collection('clout-clicker-saves').doc(uid).set(data);

        // Update leaderboard
        await fbDb.collection('clout-clicker-leaderboard').doc(uid).set({
            displayName:    window.GameState.displayName || fbAuth.currentUser.email.split('@')[0],
            photoURL:       window.GameState.photoURL || '',
            peakClickCps:   window.GameState.peakClickCps || 0,
            totalCloutEver: window.GameState.totalCloutEver,
            prestigeLevel:  window.GameState.prestigeLevel,
            cps:            window.GameState.cps,
            clicks:         window.GameState.clicks,
            lastUpdated:    firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch(e) {
        console.warn('Firebase save failed:', e);
    }
}

async function loadFromFirebase() {
    if (!fbDb || !fbAuth || !fbAuth.currentUser) return false;
    const uid = fbAuth.currentUser.uid;
    try {
        const doc = await fbDb.collection('clout-clicker-saves').doc(uid).get();
        if (doc.exists) {
            deserializeState(doc.data());
            return true;
        }
        return false;
    } catch(e) {
        console.warn('Firebase load failed:', e);
        return false;
    }
}

async function fullSave(silent) {
    saveToLocalStorage();
    await saveToFirebase();
    if (!silent) {
        window.GameUI && window.GameUI.showToast('save', '💾 Saved', 'Progress saved successfully.');
    }
}

/* ── Offline income ───────────────────────────────────────── */
function applyOfflineIncome() {
    const s = window.GameState;
    const now = Date.now();
    const elapsed = (now - s.saveTime) / 1000; // seconds

    if (elapsed < 10 || s.cps <= 0) return;

    // Check for offline cap upgrade
    let capHours = 1;
    if (s.upgrades.has('prestige_6')) capHours = 4;

    const cappedElapsed = Math.min(elapsed, capHours * 3600);
    const earned = s.cps * cappedElapsed;

    if (earned > 0) {
        // Track longest offline
        if (elapsed > s.longestOffline) {
            s.longestOffline = elapsed;
        }

        s.clout          += earned;
        s.totalCloutEver += earned;

        // Show offline modal via UI
        setTimeout(() => {
            window.GameUI && window.GameUI.showOfflineModal(earned, cappedElapsed);
        }, 500);
    }
}

/* ── Buying buildings ─────────────────────────────────────── */
function buyBuilding(buildingId, qty) {
    const s  = window.GameState;
    const b  = BUILDINGS.find(b => b.id === buildingId);
    if (!b) return;

    qty = qty || 1;
    if (qty === 'max') {
        const res = getMaxAffordable(b, s.buildings[buildingId] || 0, s.clout);
        if (res.qty === 0) return;
        qty = res.qty;
        const cost = res.cost;
        s.clout -= cost;
        s.buildings[buildingId] = (s.buildings[buildingId] || 0) + qty;
    } else {
        if (qty > 1) {
            const cost = getBuildingCost(b, s.buildings[buildingId] || 0, qty);
            if (s.clout < cost) return;
            s.clout -= cost;
            s.buildings[buildingId] = (s.buildings[buildingId] || 0) + qty;
        } else {
            const cost = getBuildingCost(b, s.buildings[buildingId] || 0, 1);
            if (s.clout < cost) return;
            s.clout -= cost;
            s.buildings[buildingId] = (s.buildings[buildingId] || 0) + 1;
        }
    }

    // Track humble timer reset
    s.humbleTimer = 0;

    recalculate();
    checkAchievements();
    window.GameSound && window.GameSound.playPurchase();
    window.GameUI && window.GameUI.markDirty();
}

/* ── Buying upgrades ─────────────────────────────────────── */
function buyUpgrade(upgradeId) {
    const s  = window.GameState;
    const up = UPGRADES.find(u => u.id === upgradeId);
    if (!up || s.upgrades.has(upgradeId)) return;

    // Prestige upgrades cost Viral Chips instead of clout
    if (up.isPrestigeUpgrade) {
        if ((s.viralChips || 0) < up.cost) return;
        // Chips are not spent, just used as a threshold gate (Cookie Clicker style)
        // Actually we DO spend them:
        s.viralChips -= up.cost;
        s.upgrades.add(upgradeId);
    } else {
        if (s.clout < up.cost) return;
        s.clout -= up.cost;
        s.upgrades.add(upgradeId);
    }

    recalculate();
    checkAchievements();
    window.GameSound && window.GameSound.playPurchase();
    window.GameUI && window.GameUI.markDirty();
}

/* ── Click handling ──────────────────────────────────────── */
function handleClick() {
    const s   = window.GameState;
    const now = Date.now();

    const baseClick = s.clickPower;
    const clickBonus = s.cps * 0.01; // also earn 1% of CPS per click
    const clickMult = getActiveClickMultiplier();
    const earned = (baseClick + clickBonus) * clickMult;

    s.clout          += earned;
    s.totalCloutEver += earned;
    s.clicks         += 1;
    s.sessionClicks  += 1;
    s.lastClickTime   = now;
    s.afkTimer        = 0; // reset afk timer on click

    checkAchievements();
    window.GameUI && window.GameUI.onClickEffect(earned);
    return earned;
}

/* ── Golden Clout ────────────────────────────────────────── */
let goldenSpawnTimeout = null;
let goldenDisappearTimeout = null;

function scheduleNextGolden() {
    const minMs = 5  * 60 * 1000;
    const maxMs = 15 * 60 * 1000;
    const s = window.GameState;

    // Prestige upgrade reduces interval
    let mult = 1;
    if (s.upgrades.has('golden_rate_0') || s.upgrades.has('prestige_1')) {
        mult = 0.8;
    }

    const delay = (Math.random() * (maxMs - minMs) + minMs) * mult;
    goldenSpawnTimeout = setTimeout(spawnGoldenClout, delay);
}

function spawnGoldenClout() {
    const el = document.getElementById('golden-clout');
    if (!el) { scheduleNextGolden(); return; }

    // Random position (avoid nav bar and edges)
    const margin = 80;
    const x = margin + Math.random() * (window.innerWidth  - margin * 2);
    const y = margin + Math.random() * (window.innerHeight - margin * 2);

    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.display = 'block';
    window.GameSound && window.GameSound.playGoldenAppear();
    el.style.transform = 'scale(1)';

    window.GameState._goldenSpawnTime = Date.now();

    // 13s countdown: shrink slowly
    let remaining = 13;
    const countdown = el.querySelector('#golden-countdown');

    if (window._goldenInterval) clearInterval(window._goldenInterval);
    window._goldenInterval = setInterval(() => {
        remaining -= 0.1;
        if (countdown) countdown.textContent = remaining.toFixed(0) + 's';
        const scale = Math.max(0.1, remaining / 13);
        el.style.transform = `scale(${scale})`;
        if (remaining <= 0) {
            clearInterval(window._goldenInterval);
            el.style.display = 'none';
            scheduleNextGolden();
        }
    }, 100);
}

function clickGoldenClout() {
    const el = document.getElementById('golden-clout');
    if (!el || el.style.display === 'none') return;

    clearInterval(window._goldenInterval);
    el.style.display = 'none';
    window.GameSound && window.GameSound.playGoldenClick();

    const s = window.GameState;
    s.goldenCloutClicks  += 1;
    s.goldenCloutThisRun += 1;

    // Check fast click achievement
    const elapsed = (Date.now() - (s._goldenSpawnTime || Date.now())) / 1000;
    if (elapsed <= 1) {
        s.goldenFastClick = true;
    }

    // Random effect
    const effects = ['frenzy', 'lucky', 'clickFrenzy', 'freeUpgrade'];
    const weights  = [40, 30, 20, 10];
    let roll = Math.random() * 100;
    let effect;
    for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { effect = effects[i]; break; }
    }
    if (!effect) effect = 'frenzy';

    applyGoldenEffect(effect);
    checkAchievements();
    scheduleNextGolden();

    // Broadcast to live feed if logged in
    if (s.isLoggedIn && s.displayName && fbDb) {
        fbDb.collection('clout-clicker-events').add({
            type:       'golden',
            playerName: s.displayName,
            effect:     effect,
            timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
    }
}

function applyGoldenEffect(effect) {
    const s = window.GameState;

    // Duration bonus from upgrades
    let durationMult = 1;
    let i = 0;
    while (s.upgrades.has(`golden_up_${i}`) && i < 5) {
        durationMult *= UPGRADES.find(u => u.id === `golden_up_${i}`).multiplier;
        i++;
    }

    switch (effect) {
        case 'frenzy': {
            const dur = Math.floor(77 * durationMult);
            Buffs.frenzy = { mult: 7, endTime: Date.now() + dur * 1000 };
            s.frenzyCount++;
            window.GameUI && window.GameUI.showToast('golden', '✨ Frenzy!', `×7 CPS for ${dur} seconds!`);
            break;
        }
        case 'lucky': {
            // 15 minutes of CPS, capped at 15% of totalCloutEver
            const luckyAmount = Math.min(s.cps * 900, s.totalCloutEver * 0.15);
            let bonus = 1;
            if (s.upgrades.has('prestige_3')) bonus = UPGRADES.find(u=>u.id==='prestige_3').multiplier;
            const earned = luckyAmount * bonus;
            s.clout          += earned;
            s.totalCloutEver += earned;
            window.GameUI && window.GameUI.showToast('golden', '🍀 Lucky!', `You found ${formatNumber(earned)} Clout!`);
            break;
        }
        case 'clickFrenzy': {
            const dur = Math.floor(13 * durationMult);
            Buffs.clickFrenzy = { mult: 777, endTime: Date.now() + dur * 1000 };
            s.clickFrenzyCount++;
            window.GameUI && window.GameUI.showToast('golden', '👆 Click Frenzy!', `×777 click power for ${dur} seconds!`);
            break;
        }
        case 'freeUpgrade': {
            // Pick a random available (unowned, affordable condition met) upgrade
            const available = UPGRADES.filter(u =>
                !s.upgrades.has(u.id) &&
                !u.isPrestigeUpgrade &&
                u.condition(s)
            );
            if (available.length > 0) {
                const pick = available[Math.floor(Math.random() * available.length)];
                s.upgrades.add(pick.id);
                s.freeUpgradeCount++;
                recalculate();
                window.GameUI && window.GameUI.showToast('golden', '🎁 Free Upgrade!', `You got "${pick.name}" for free!`);
            } else {
                // Fallback to lucky
                applyGoldenEffect('lucky');
                return;
            }
            break;
        }
    }
}

/* ── Achievement checking ─────────────────────────────────── */
function checkAchievements() {
    const s = window.GameState;
    let anyNew = false;

    ACHIEVEMENTS.forEach(ach => {
        if (s.achievements.has(ach.id)) return;
        try {
            if (ach.condition(s)) {
                s.achievements.add(ach.id);
                anyNew = true;
                window.GameSound && window.GameSound.playAchievement();
                window.GameUI && window.GameUI.showAchievementShower && window.GameUI.showAchievementShower();
                window.GameUI && window.GameUI.showToast('ach', `🏆 Achievement Unlocked!`, `${ach.icon} ${ach.name} — ${ach.desc}`);
                // Broadcast to global live feed if logged in
                if (s.isLoggedIn && s.displayName) writeAchievementEvent(ach, s.displayName);
            }
        } catch(e) { /* silently skip bad conditions */ }
    });

    return anyNew;
}

/* ── Live feed: write achievement event ──────────────────── */
function writeAchievementEvent(ach, playerName) {
    if (!fbDb) return;
    fbDb.collection('clout-clicker-events').add({
        type:       'achievement',
        playerName: playerName,
        achName:    ach.name,
        achIcon:    ach.icon || '🏅',
        timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
}

/* ── Live feed: watch leaderboard for rank changes ───────── */
let _lbSnapshot  = null;   // last known leaderboard state
let _lbWatchInit = false;  // skip first snapshot (avoid noise on load)

function watchLiveFeeds() {
    if (!fbDb) return;

    // Watch leaderboard
    fbDb.collection('clout-clicker-leaderboard')
        .orderBy('totalCloutEver', 'desc')
        .limit(25)
        .onSnapshot(snap => {
            const newRows = snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data() }));
            if (!_lbWatchInit) { _lbSnapshot = newRows; _lbWatchInit = true; return; }

            newRows.forEach(nr => {
                const or = _lbSnapshot && _lbSnapshot.find(r => r.id === nr.id);
                const name = nr.displayName || 'Someone';
                if (!or) {
                    // New entrant into top 25
                    const displaced = _lbSnapshot && _lbSnapshot[nr.rank - 1];
                    const msg = displaced ? `Overtook ${displaced.displayName || 'someone'} for #${nr.rank}` : `Entered the top 25`;
                    window.GameUI && window.GameUI.showFeedEvent('⬆️', `${name} is now #${nr.rank}!`, msg);
                } else if (nr.rank < or.rank) {
                    // Moved up
                    const displaced = _lbSnapshot && _lbSnapshot.find(r => r.rank === nr.rank);
                    if (nr.rank === 1) {
                        const msg = displaced ? `Overtook ${displaced.displayName || 'the previous leader'}` : 'New #1!';
                        window.GameUI && window.GameUI.showFeedEvent('🏆', `${name} is #1 on the leaderboard!`, msg);
                    } else if (displaced && displaced.id !== nr.id) {
                        window.GameUI && window.GameUI.showFeedEvent('⬆️', `${name} climbed to #${nr.rank}`, `Overtook ${displaced.displayName || 'someone'}`);
                    }
                }
            });
            _lbSnapshot = newRows;
        }, () => {});

    // Watch global achievement/golden events — all docs added after page load.
    // startAfter(now) means no old events on initial snapshot; catches every new
    // event regardless of how many fire in quick succession (no limit(1) race).
    const _eventsStartAt = firebase.firestore.Timestamp.now();
    fbDb.collection('clout-clicker-events')
        .orderBy('timestamp', 'asc')
        .startAfter(_eventsStartAt)
        .onSnapshot(snap => {
            snap.docChanges().forEach(change => {
                if (change.type !== 'added') return;
                const d = change.doc.data();
                if (d.type === 'achievement') {
                    window.GameUI && window.GameUI.showFeedEvent(
                        d.achIcon || '🏅',
                        `${d.playerName} unlocked an achievement!`,
                        d.achName
                    );
                } else if (d.type === 'golden') {
                    const effectLabels = { frenzy: '×7 Frenzy', clickFrenzy: '×777 Click Frenzy', lucky: 'Lucky Bonus', freeUpgrade: 'Free Upgrade' };
                    window.GameUI && window.GameUI.showFeedEvent(
                        '💛',
                        `${d.playerName} caught a Golden Clout!`,
                        effectLabels[d.effect] || 'Bonus activated'
                    );
                }
            });
        }, err => console.warn('[LiveFeed] events listener error:', err));
}

/* ── Prestige ─────────────────────────────────────────────── */
function calcViralChips(totalEver) {
    // floor(sqrt(totalEver / 1T))
    return Math.floor(Math.sqrt(totalEver / 1e12));
}

function prestige() {
    const s    = window.GameState;
    const chips = calcViralChips(s.totalCloutEver);

    s.clout          = 0;
    s.totalCloutEver = 0;  // reset for this run; chips track cross-run progress
    s.buildings      = {};
    s.upgrades       = new Set();
    s.cps            = 0;
    s.clickPower     = 1;
    s.clicks         = 0;
    s.sessionClicks  = 0;
    s.frenzyCount        = 0;
    s.clickFrenzyCount   = 0;
    s.freeUpgradeCount   = 0;
    s.goldenCloutThisRun = 0;
    s.humbleTimer    = 0;
    s.afkTimer       = 0;
    s.timeSincePrestige = 0;

    // Keep achievements, prestigeLevel, viralChips, goldenCloutClicks
    s.prestigeLevel  += 1;
    s.viralChips     += chips;

    recalculate();
    checkAchievements();
    window.GameSound && window.GameSound.playPrestige();
    fullSave(true);
    window.GameUI && window.GameUI.showToast('info', '🔄 Gone Viral!', `+${chips} Viral Chips earned! CPS bonus: +${((1 + s.viralChips * 0.01) * 100 - 100).toFixed(1)}%`);
    window.GameUI && window.GameUI.fullRender();
}

/* ── Game Loop ────────────────────────────────────────────── */
const TICK_MS = 100;
let lastTickTime   = Date.now();
let localSaveTimer = 0;   // localStorage save every 15s (free, unlimited)
let fbSaveTimer    = 0;   // Firebase save every 60s (limits writes)

function gameTick() {
    const now = Date.now();
    const dt  = (now - lastTickTime) / 1000;
    lastTickTime = now;

    const s = window.GameState;

    // Expire buffs
    if (Buffs.frenzy && now >= Buffs.frenzy.endTime) {
        Buffs.frenzy = null;
        window.GameUI && window.GameUI.updateBuffBar();
    }
    if (Buffs.clickFrenzy && now >= Buffs.clickFrenzy.endTime) {
        Buffs.clickFrenzy = null;
        window.GameUI && window.GameUI.updateBuffBar();
    }

    // CPS income
    const cpsEarned = s.cps * dt * getActiveCpsMultiplier();
    if (cpsEarned > 0) {
        s.clout          += cpsEarned;
        s.totalCloutEver += cpsEarned;
    }

    // Time tracking
    s.timePlayed       += dt;
    s.timeSincePrestige+= dt;

    // Humble timer (track how long with 0 total buildings)
    const totalOwned = Object.values(s.buildings).reduce((a,b) => a+b, 0);
    if (totalOwned === 0) {
        s.humbleTimer += dt;
    } else {
        s.humbleTimer = 0;
    }

    // AFK timer
    const sinceClick = (now - (s.lastClickTime || now)) / 1000;
    if (sinceClick > 5) {
        s.afkTimer += dt;
    } else {
        s.afkTimer = 0;
    }

    // Prestige button visibility
    const prestBtn = document.getElementById('prestige-btn');
    if (prestBtn) {
        if (s.totalCloutEver >= 1e12) {
            prestBtn.classList.add('visible');
            const chips = calcViralChips(s.totalCloutEver);
            prestBtn.textContent = `🌀 Go Viral (+${chips} Viral Chip${chips !== 1 ? 's' : ''})`;
        } else {
            prestBtn.classList.remove('visible');
        }
    }

    // localStorage auto-save every 15s
    localSaveTimer += dt;
    if (localSaveTimer >= 15) {
        localSaveTimer = 0;
        saveToLocalStorage();
    }
    // Firebase auto-save every 60s (when logged in)
    fbSaveTimer += dt;
    if (fbSaveTimer >= 60) {
        fbSaveTimer = 0;
        if (window.GameState.isLoggedIn) saveToFirebase();
    }

    // Check achievements periodically
    checkAchievements();

    // Update UI
    window.GameUI && window.GameUI.tickUpdate(dt);
}

/* ── Export / Import save ─────────────────────────────────── */
function exportSave() {
    const data = serializeState();
    return btoa(JSON.stringify(data));
}

function importSave(encoded) {
    try {
        const data = JSON.parse(atob(encoded));
        deserializeState(data);
        recalculate();
        checkAchievements();
        fullSave(true);
        window.GameUI && window.GameUI.fullRender();
        window.GameUI && window.GameUI.showToast('info', '✅ Save Imported', 'Your progress has been loaded.');
        return true;
    } catch(e) {
        window.GameUI && window.GameUI.showToast('info', '❌ Import Failed', 'Invalid save data.');
        return false;
    }
}

/* ── Auth ─────────────────────────────────────────────────── */
async function signIn(email, password) {
    if (!fbAuth) throw new Error('Firebase not available');
    const cred = await fbAuth.signInWithEmailAndPassword(email, password);
    return cred.user;
}

async function signUp(email, password, displayName) {
    if (!fbAuth) throw new Error('Firebase not available');
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName });
    // onAuthStateChanged fires before updateProfile completes, so patch state now
    window.GameState.isLoggedIn  = true;
    window.GameState.userId      = cred.user.uid;
    window.GameState.displayName = displayName;
    return cred.user;
}

async function signOut() {
    if (!fbAuth) return;
    await fbAuth.signOut();
}

async function updateDisplayName(name) {
    if (!fbAuth || !fbAuth.currentUser) throw new Error('Not signed in');
    name = name.trim().slice(0, 20);
    if (!name) throw new Error('Name cannot be empty');
    await fbAuth.currentUser.updateProfile({ displayName: name });
    window.GameState.displayName = name;
    await saveToFirebase();
}

async function updateProfilePhoto(base64) {
    if (!fbAuth || !fbAuth.currentUser) throw new Error('Not signed in');
    window.GameState.photoURL = base64;
    await saveToFirebase();
}

/* ── Leaderboard ─────────────────────────────────────────── */
async function fetchLeaderboard() {
    if (!fbDb) return [];
    try {
        const snap = await fbDb.collection('clout-clicker-leaderboard')
            .orderBy('totalCloutEver', 'desc')
            .limit(25)
            .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.warn('Leaderboard fetch failed:', e);
        return [];
    }
}

/* ── Initialization ──────────────────────────────────────── */
async function init() {
    // Set up auth listener
    if (fbAuth) {
        fbAuth.onAuthStateChanged(async (user) => {
            const s = window.GameState;
            if (user) {
                s.isLoggedIn  = true;
                s.userId      = user.uid;
                s.displayName = user.displayName || user.email.split('@')[0];

                // Load from Firebase, merge with local
                const fbLoaded = await loadFromFirebase();
                if (!fbLoaded) {
                    // Try local
                    loadFromLocalStorage();
                }
                recalculate();
                applyOfflineIncome();
                checkAchievements();
                // Immediately write to leaderboard so user appears right away
                saveToFirebase();
                window.GameUI && window.GameUI.showToast('info', `👋 Welcome back, ${s.displayName}!`, 'Your save has been loaded.');
                window.GameUI && window.GameUI.fullRender();
            } else {
                s.isLoggedIn  = false;
                s.userId      = '';
                window.GameUI && window.GameUI.updatePlayerCard();
            }
        });
    }

    // Try loading from local storage first (fast)
    const loaded = loadFromLocalStorage();
    recalculate();
    if (loaded) {
        applyOfflineIncome();
    }
    checkAchievements();

    // Start live feed watchers
    watchLiveFeeds();

    // Start game loop
    setInterval(gameTick, TICK_MS);

    // Save on tab close / refresh
    window.addEventListener('beforeunload', () => {
        saveToLocalStorage();
        // Firebase async save is best-effort on unload
        if (window.GameState.isLoggedIn) saveToFirebase();
    });

    // Schedule first golden clout
    scheduleNextGolden();

    // Expose for UI
    window.GameEngine = {
        buyBuilding,
        buyUpgrade,
        handleClick,
        clickGoldenClout,
        prestige,
        calcViralChips,
        recalculate,
        checkAchievements,
        exportSave,
        importSave,
        signIn,
        signUp,
        signOut,
        updateDisplayName,
        updateProfilePhoto,
        fetchLeaderboard,
        fullSave,
        Buffs,
        getActiveCpsMultiplier,
        getActiveClickMultiplier,
        serializeState,
        deserializeState,
    };
}

// Start on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();
