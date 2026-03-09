/* ============================================================
   Clout Clicker — UI Layer
   DOM rendering, updates, modals, animations
   ============================================================ */

(function() {
'use strict';

const { BUILDINGS, UPGRADES, ACHIEVEMENTS, NEWS_TICKER, formatNumber, formatTime, getBuildingCost, getMaxAffordable } = window.GameData;

/* ── State refs ───────────────────────────────────────────── */
function GS() { return window.GameState; }
function GE() { return window.GameEngine; }

/* ── Click spark canvas (vanilla port of ClickSpark component) ── */
let _addSparks = null; // set by initClickSparkCanvas()

/* ── Dirty flags for partial updates ─────────────────────── */
const dirty = {
    clout:      true,
    buildings:  true,
    upgrades:   true,
    stats:      true,
    achievements: true,
    buffs:      true,
};
function markDirty() {
    dirty.clout = dirty.buildings = dirty.upgrades = dirty.stats = dirty.achievements = dirty.buffs = true;
}

/* ── Current store tab & bulk mode ───────────────────────── */
let currentTab  = 'buildings'; // 'buildings' | 'upgrades'
let bulkMode    = 1;           // 1 | 10 | 100 | 'max'
let achFilter   = 'all';       // 'all' | 'unlocked' | 'locked'

/* ── Upgrade tooltip ─────────────────────────────────────── */
let tooltipEl = null;
function getTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'upgrade-tooltip';
        tooltipEl.style.display = 'none';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

/* ── Toast system ─────────────────────────────────────────── */
const toastQueue = [];
let toastActive = false;

function showToast(type, title, desc) {
    toastQueue.push({ type, title, desc });
    if (!toastActive) drainToasts();
}

function drainToasts() {
    if (toastQueue.length === 0) { toastActive = false; return; }
    toastActive = true;
    const { type, title, desc } = toastQueue.shift();
    const container = document.getElementById('toast-container');
    if (!container) { toastActive = false; return; }

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
        <div class="toast-label">${type === 'ach' ? 'Achievement' : type === 'golden' ? 'Golden Clout' : type === 'save' ? 'Auto Save' : 'Info'}</div>
        <div class="toast-title">${title}</div>
        ${desc ? `<div class="toast-desc">${desc}</div>` : ''}
    `;
    container.appendChild(el);

    // Auto-remove after 3.5s
    setTimeout(() => {
        el.classList.add('hiding');
        setTimeout(() => {
            el.remove();
            setTimeout(drainToasts, 100);
        }, 300);
    }, 3500);
}

/* ── Number animation ─────────────────────────────────────── */
let displayedClout = 0;
function animateClout() {
    const s = GS();
    const target = s.clout;
    const diff   = target - displayedClout;
    if (Math.abs(diff) > 0.5) {
        displayedClout += diff * 0.15;
    } else {
        displayedClout = target;
    }
    const el = document.getElementById('clout-value');
    if (el) el.textContent = formatNumber(displayedClout) + ' Clout';
}

/* ── Click effect ─────────────────────────────────────────── */
/* ── Click speed ring ────────────────────────────────────── */
(function () {
    const CIRC        = 616;   // 2π × 98
    const MAX_CPS     = 30;    // clicks/sec = full ring
    const WINDOW_MS   = 2500;  // rolling window to measure rate
    const DRAIN_MS    = 1800;  // ms after last click before ring drains
    const clickTimes  = [];
    let   drainTimer  = null;

    const ringFill    = () => document.getElementById('boost-ring-fill');
    const label       = () => document.getElementById('click-boost-label');

    function setRing(pct) {
        const fill = ringFill();
        const lbl  = label();
        if (!fill || !lbl) return;
        const offset = CIRC * (1 - pct);
        fill.style.strokeDashoffset = offset;
        const hot = pct >= 0.75;
        fill.classList.toggle('hot', hot);
        lbl.classList.toggle('hot', hot);
        if (pct > 0.02) {
            const cps = Math.round(pct * MAX_CPS * 10) / 10;
            lbl.textContent = cps.toFixed(1) + ' clicks/s';
            lbl.classList.add('visible');
        } else {
            lbl.classList.remove('visible');
        }
    }

    function drain() {
        const fill = ringFill();
        if (!fill) return;
        fill.style.transition = 'stroke-dashoffset 1.4s ease, stroke 0.3s ease, filter 0.3s ease';
        setRing(0);
        setTimeout(() => {
            if (fill) fill.style.transition = 'stroke-dashoffset 0.25s ease, stroke 0.25s ease, filter 0.25s ease';
        }, 1500);
    }

    window._boostRingClick = function () {
        const now = Date.now();
        clickTimes.push(now);
        // purge old entries outside window
        while (clickTimes.length && now - clickTimes[0] > WINDOW_MS) clickTimes.shift();
        const cps = clickTimes.length / (WINDOW_MS / 1000);
        setRing(Math.min(cps / MAX_CPS, 1));
        clearTimeout(drainTimer);
        drainTimer = setTimeout(drain, DRAIN_MS);
    };
})();

function onClickEffect(amount) {
    window._boostRingClick && window._boostRingClick();
    const target = document.getElementById('click-target');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    // Floating number
    const numEl = document.createElement('div');
    numEl.className = 'float-num';
    numEl.textContent = '+' + formatNumber(amount);
    const ox = (Math.random() - 0.5) * 60;
    numEl.style.left = (cx + ox - 20) + 'px';
    numEl.style.top  = (cy - 20) + 'px';
    document.body.appendChild(numEl);
    setTimeout(() => numEl.remove(), 1200);

    const isFrenzy = window.GameEngine && window.GameEngine.Buffs.clickFrenzy;

    // Ripple rings (2 staggered)
    for (let i = 0; i < 2; i++) {
        setTimeout(() => {
            const r = document.createElement('div');
            r.className = 'click-ripple' + (isFrenzy ? ' frenzy' : '');
            r.style.left = cx + 'px';
            r.style.top  = cy + 'px';
            document.body.appendChild(r);
            setTimeout(() => r.remove(), 700);
        }, i * 100);
    }

    // Click sparks handled by global document listener

    // Falling items — spawn on click, more during frenzy
    if (isFrenzy || Math.random() < 0.55) spawnFallingItem(!!isFrenzy);

    // DOM burst particles
    const count = isFrenzy ? 24 : 14;
    const colors = ['#22c55e','#39ff14','#4ade80','#86efac','#a3e635'];
    if (isFrenzy) colors.push('#facc15','#fbbf24','#f59e0b');

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'click-particle';
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist  = 30 + Math.random() * (isFrenzy ? 100 : 65);
        const px    = Math.cos(angle) * dist;
        const py    = Math.sin(angle) * dist;
        const size  = 3 + Math.random() * (isFrenzy ? 9 : 6);
        const color = colors[Math.floor(Math.random() * colors.length)];
        p.style.cssText = `
            width:${size}px;height:${size}px;
            left:${cx}px;top:${cy}px;
            background:${color};
            --px:${px}px;--py:${py}px;
        `;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 700);
    }

    // Frenzy class + sound
    if (isFrenzy) {
        target.classList.add('frenzy-active');
        window.GameSound && window.GameSound.playClickFrenzy();
    } else {
        target.classList.remove('frenzy-active');
        window.GameSound && window.GameSound.playClick();
    }
}

/* ── Falling items (active background while clicking) ─────── */
const FALLING_EMOJIS = ['📱','🎬','💰','⭐','🔥','👀','📈','🎮','💎','🌟','📺','🎯','💫','🏆','📣','🎤','✨','💥','🎧','🕹️'];
let _lastFallTime = 0;
function spawnFallingItem(isFrenzy) {
    const now = Date.now();
    const minGap = isFrenzy ? 50 : 120; // rate limit
    if (now - _lastFallTime < minGap) return;
    _lastFallTime = now;

    const emoji = FALLING_EMOJIS[Math.floor(Math.random() * FALLING_EMOJIS.length)];
    const el = document.createElement('div');
    const size  = 20 + Math.random() * 20;
    const left  = 3 + Math.random() * 94;
    const dur   = 2.0 + Math.random() * 2.5;
    const delay = Math.random() * 0.2;
    const spin  = Math.round((Math.random() - 0.5) * 600);
    el.style.cssText = `position:fixed;pointer-events:none;z-index:1;left:${left}%;top:-40px;font-size:${size}px;line-height:1;--fall-spin:${spin}deg;animation:fallingItem ${dur}s ease-in ${delay}s forwards;`;
    el.textContent = emoji;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), (dur + delay + 0.1) * 1000);
}

/* ── Achievement shower ───────────────────────────────────── */
function showAchievementShower() {
    const colors = ['#22c55e','#39ff14','#4ade80','#fbbf24','#c084fc','#38bdf8','#f472b6','#fb923c','#e879f9'];
    for (let i = 0; i < 160; i++) {
        setTimeout(() => {
            const p = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size  = 4 + Math.random() * 10;
            const left  = 3 + Math.random() * 94;
            const dur   = 1.5 + Math.random() * 2.0;
            const delay = Math.random() * 0.6;
            // Mix circles and rectangles
            const isRect = Math.random() > 0.6;
            p.style.cssText = `
                position:fixed;pointer-events:none;z-index:9999;
                left:${left}%;top:-14px;
                width:${size}px;height:${isRect ? size * 0.45 : size}px;
                background:${color};border-radius:${isRect ? '2px' : '50%'};
                animation:achShower ${dur}s ease-in ${delay}s forwards;
            `;
            document.body.appendChild(p);
            setTimeout(() => p.remove(), (dur + delay + 0.2) * 1000);
        }, i * 5);
    }
}

/* ── Buff bar update ─────────────────────────────────────── */
function updateBuffBar() {
    const bar = document.getElementById('buff-bar');
    if (!bar || !window.GameEngine) return;
    const { Buffs } = window.GameEngine;
    bar.innerHTML = '';

    if (Buffs.frenzy) {
        const rem = Math.max(0, (Buffs.frenzy.endTime - Date.now()) / 1000);
        const chip = document.createElement('div');
        chip.className = 'buff-chip';
        chip.innerHTML = `🌀 Frenzy ×7 <span class="buff-timer">${rem.toFixed(0)}s</span>`;
        bar.appendChild(chip);
    }
    if (Buffs.clickFrenzy) {
        const rem = Math.max(0, (Buffs.clickFrenzy.endTime - Date.now()) / 1000);
        const chip = document.createElement('div');
        chip.className = 'buff-chip';
        chip.innerHTML = `👆 Click Frenzy ×777 <span class="buff-timer">${rem.toFixed(0)}s</span>`;
        bar.appendChild(chip);
    }
}

/* ── Buildings list render ───────────────────────────────── */
function renderBuildings() {
    const s   = GS();
    const list = document.getElementById('buildings-list');
    if (!list) return;

    list.innerHTML = '';
    BUILDINGS.forEach(b => {
        const owned = s.buildings[b.id] || 0;

        let qty, cost, canAfford, qtyLabel;
        if (bulkMode === 'max') {
            const maxRes = getMaxAffordable(b, owned, s.clout);
            qty       = maxRes.qty;
            cost      = qty > 0 ? maxRes.cost : getBuildingCost(b, owned, 1);
            canAfford = qty > 0;
            qtyLabel  = qty > 0 ? ` ×${qty}` : ' ×0';
        } else {
            qty       = bulkMode;
            cost      = getBuildingCost(b, owned, qty);
            canAfford = s.clout >= cost;
            qtyLabel  = bulkMode > 1 ? ` ×${bulkMode}` : '';
        }

        const row = document.createElement('div');
        row.className = 'building-row ' + (canAfford ? 'can-afford' : 'cannot-afford');
        row.title     = b.desc;
        const effectiveCps = (s._effectiveCps && s._effectiveCps[b.id]) || b.baseCps;
        row.innerHTML = `
            <span class="building-emoji">${b.emoji}</span>
            <div class="building-info">
                <div class="building-name">${b.name}</div>
                <div class="building-cost">${formatNumber(cost)} Clout${qtyLabel}</div>
                <div class="building-cps">${formatNumber(effectiveCps)}/s each${owned > 0 ? ` · ${formatNumber(effectiveCps * owned)}/s total` : ''}</div>
            </div>
            <div class="building-owned">${owned}</div>
        `;

        row.addEventListener('click', () => {
            if (!window.GameEngine) return;
            window.GameEngine.buyBuilding(b.id, bulkMode);
            dirty.buildings = true;
            dirty.upgrades  = true;
            dirty.stats     = true;
        });

        list.appendChild(row);
    });
}

/* ── Upgrades grid render ────────────────────────────────── */
function renderUpgrades() {
    const s    = GS();
    const grid = document.getElementById('upgrades-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const tt = getTooltip();

    // Separate available (not purchased, condition met) and show purchased as dim
    const available  = UPGRADES.filter(u => !s.upgrades.has(u.id) && u.condition(s));
    const purchased  = UPGRADES.filter(u => s.upgrades.has(u.id));

    const toShow = [...available, ...purchased];
    toShow.forEach(up => {
        const isPurchased = s.upgrades.has(up.id);
        const canAfford   = !isPurchased && (
            up.isPrestigeUpgrade
                ? (s.viralChips || 0) >= up.cost
                : s.clout >= up.cost
        );

        const el = document.createElement('div');
        el.className = 'upgrade-icon' +
            (isPurchased ? ' purchased' : '') +
            (canAfford ? ' can-afford-upgrade' : '');
        el.textContent = up.emoji || '🔧';

        // Tooltip
        el.addEventListener('mouseenter', (e) => {
            tt.innerHTML = `
                <h4>${up.emoji || ''} ${up.name}</h4>
                <div class="tt-desc">${up.desc}</div>
                <div class="tt-cost">${isPurchased ? '✓ Purchased' : (up.isPrestigeUpgrade ? `Cost: ${up.cost} Viral Chip${up.cost !== 1 ? 's' : ''}` : `Cost: ${formatNumber(up.cost)} Clout`)}</div>
            `;
            tt.style.display = 'block';
            moveTooltip(e);
        });
        el.addEventListener('mousemove', moveTooltip);
        el.addEventListener('mouseleave', () => { tt.style.display = 'none'; });

        if (!isPurchased) {
            el.addEventListener('click', () => {
                if (!window.GameEngine) return;
                window.GameEngine.buyUpgrade(up.id);
                dirty.upgrades = true;
                dirty.stats    = true;
                dirty.buildings = true;
            });
        }

        grid.appendChild(el);
    });
}

function moveTooltip(e) {
    const tt = getTooltip();
    let x = e.clientX + 14;
    let y = e.clientY - 10;
    if (x + 230 > window.innerWidth)  x = e.clientX - 230;
    if (y + 120 > window.innerHeight) y = e.clientY - 120;
    tt.style.left = x + 'px';
    tt.style.top  = y + 'px';
}

/* ── Stats panel update ──────────────────────────────────── */
function updateStats() {
    const s = GS();
    const ge = window.GameEngine;
    const activeClickMult = ge ? ge.getActiveClickMultiplier() : 1;
    const activeCpsMult   = ge ? ge.getActiveCpsMultiplier()   : 1;

    setStatVal('stat-clout',     formatNumber(s.clout));
    setStatVal('stat-cps',       formatNumber(s.cps * activeCpsMult));
    setStatVal('stat-cpc',       formatNumber(s.clickPower * activeClickMult + s.cps * 0.01 * activeClickMult));
    setStatVal('stat-total',     formatNumber(s.totalCloutEver));
    setStatVal('stat-clicks',    formatNumber(s.clicks));
    setStatVal('stat-golden',    s.goldenCloutClicks);
    setStatVal('stat-prestige',  s.prestigeLevel);
    setStatVal('stat-chips',     s.viralChips || 0);
    setStatVal('stat-time',      formatTime(s.timePlayed));

    // Top clout display
    const cloutVal = document.getElementById('clout-value');
    if (cloutVal) {
        if (ge && (ge.Buffs.frenzy || ge.Buffs.clickFrenzy)) {
            cloutVal.classList.add('frenzy');
        } else {
            cloutVal.classList.remove('frenzy');
        }
    }

    const cpsEl = document.getElementById('cps-display');
    if (cpsEl) cpsEl.innerHTML = `per second: <span class="cps-val">${formatNumber(s.cps * activeCpsMult)}</span>`;
    const cpcEl = document.getElementById('cpc-display');
    if (cpcEl) cpcEl.textContent = `per click: ${formatNumber(s.clickPower * activeClickMult + s.cps * 0.01 * activeClickMult)}`;
}

function setStatVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/* ── Achievements render ─────────────────────────────────── */
function renderAchievements() {
    const s    = GS();
    const grid = document.getElementById('ach-grid');
    const countEl = document.getElementById('ach-count');
    const progressEl = document.getElementById('ach-progress');
    if (!grid) return;

    const unlocked = s.achievements.size;
    const total    = ACHIEVEMENTS.length;

    if (countEl) countEl.textContent = `${unlocked} / ${total}`;
    if (progressEl) progressEl.style.width = ((unlocked / total) * 100).toFixed(1) + '%';

    grid.innerHTML = '';
    const tt = getTooltip();

    let toShow = ACHIEVEMENTS;
    if (achFilter === 'unlocked') toShow = ACHIEVEMENTS.filter(a => s.achievements.has(a.id));
    if (achFilter === 'locked')   toShow = ACHIEVEMENTS.filter(a => !s.achievements.has(a.id));

    toShow.forEach(ach => {
        const isUnlocked = s.achievements.has(ach.id);
        const el = document.createElement('div');
        el.className = 'ach-icon ' + (isUnlocked ? 'unlocked' : 'locked') + (ach.shadow ? ' shadow-ach' : '');

        if (isUnlocked) {
            el.textContent = ach.icon;
        } else if (ach.shadow) {
            el.textContent = '?';
        } else {
            el.textContent = ach.icon;
        }

        el.addEventListener('mouseenter', (e) => {
            const name = (ach.shadow && !isUnlocked) ? '???' : ach.name;
            const desc = (ach.shadow && !isUnlocked) ? 'Secret achievement. Play to discover it.' : ach.desc;
            tt.innerHTML = `
                <h4>${isUnlocked ? ach.icon : '🔒'} ${name}</h4>
                <div class="tt-desc">${desc}</div>
                <div class="tt-cost" style="color:${isUnlocked?'#22c55e':'rgba(255,255,255,0.3)'}">
                    ${isUnlocked ? '✓ Unlocked' : 'Locked'}
                </div>
            `;
            tt.style.display = 'block';
            moveTooltip(e);
        });
        el.addEventListener('mousemove', moveTooltip);
        el.addEventListener('mouseleave', () => { tt.style.display = 'none'; });

        el.addEventListener('click', () => showAchievementModal(ach, isUnlocked));

        grid.appendChild(el);
    });
}

/* ── Player card ─────────────────────────────────────────── */
function updatePlayerCard() {
    const s = GS();
    const loggedIn  = document.getElementById('player-logged-in');
    const loggedOut = document.getElementById('player-logged-out');
    const avatarEl  = document.getElementById('player-avatar');
    const nameEl    = document.getElementById('player-name');

    if (!loggedIn || !loggedOut) return;

    if (s.isLoggedIn && s.displayName) {
        loggedIn.style.display  = 'flex';
        loggedOut.style.display = 'none';
        if (avatarEl) avatarEl.textContent = s.displayName[0].toUpperCase();
        if (nameEl)   nameEl.textContent   = s.displayName;
        // Sync nav button
        const authBtn = document.getElementById('btn-auth');
        if (authBtn) authBtn.textContent = '👤 ' + s.displayName;
    } else {
        loggedIn.style.display  = 'none';
        loggedOut.style.display = 'flex';
        const authBtn = document.getElementById('btn-auth');
        if (authBtn) authBtn.textContent = '🔑 Sign In';
    }
}

/* ── Offline modal ───────────────────────────────────────── */
function showOfflineModal(earned, elapsed) {
    const overlay = document.getElementById('modal-offline');
    if (!overlay) return;
    const amtEl  = overlay.querySelector('.offline-amount');
    const timeEl = overlay.querySelector('.offline-time');
    if (amtEl)  amtEl.textContent  = '+' + formatNumber(earned) + ' Clout';
    if (timeEl) timeEl.textContent = 'Earned while you were away for ' + formatTime(elapsed);
    overlay.classList.add('open');
}

/* ── Achievement detail modal ────────────────────────────── */
function showAchievementModal(ach, isUnlocked) {
    const overlay = document.getElementById('modal-achievement');
    if (!overlay) return;
    const iconEl   = overlay.querySelector('.ach-detail-icon');
    const titleEl  = overlay.querySelector('.modal h2');
    const descEl   = overlay.querySelector('.modal-sub');
    const statusEl = overlay.querySelector('.ach-detail-status');

    const hidden = ach.shadow && !isUnlocked;
    if (iconEl)   iconEl.textContent  = hidden ? '❓' : ach.icon;
    if (titleEl)  titleEl.textContent = hidden ? '???' : ach.name;
    if (descEl)   descEl.textContent  = hidden ? 'This is a secret achievement. Discover it by playing.' : ach.desc;
    if (statusEl) {
        statusEl.textContent = isUnlocked ? 'Unlocked ✓' : 'Locked';
        statusEl.className   = 'ach-detail-status ' + (isUnlocked ? 'unlocked' : 'locked');
    }
    overlay.classList.add('open');
}

/* ── Prestige modal ──────────────────────────────────────── */
function showPrestigeModal() {
    const s = GS();
    const overlay = document.getElementById('modal-prestige');
    if (!overlay) return;

    const ge = window.GameEngine;
    const chips = ge ? ge.calcViralChips(s.totalCloutEver) : 0;
    const rewardEl = overlay.querySelector('.reward-num');
    const rewardLbl = overlay.querySelector('.reward-label');
    if (rewardEl)  rewardEl.textContent  = `+${chips} Viral Chip${chips !== 1 ? 's' : ''}`;
    if (rewardLbl) rewardLbl.textContent = `Total after prestige: ${(s.viralChips || 0) + chips} chips (+${(((s.viralChips || 0) + chips) * 1).toFixed(0)}% CPS bonus)`;

    overlay.classList.add('open');
}

/* ── Leaderboard modal ───────────────────────────────────── */
async function showLeaderboardModal() {
    const overlay = document.getElementById('modal-leaderboard');
    if (!overlay) return;
    overlay.classList.add('open');

    const tbody = overlay.querySelector('#lb-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="lb-empty">Loading...</td></tr>';

    const ge = window.GameEngine;
    if (!ge) return;
    const rows = await ge.fetchLeaderboard();

    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="lb-empty">No leaderboard data yet. Be the first!</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((r, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? `r${rank}` : '';
        return `
            <tr>
                <td><span class="lb-rank ${rankClass}">#${rank}</span></td>
                <td>${escapeHtml(r.displayName || 'Anonymous')}</td>
                <td>${formatNumber(r.totalCloutEver || 0)}</td>
                <td>${r.prestigeLevel || 0}</td>
                <td>${formatNumber(r.cps || 0)}/s</td>
                <td>${formatNumber(r.clicks || 0)}</td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ── Auth modal ──────────────────────────────────────────── */
function showAuthModal() {
    const overlay = document.getElementById('modal-auth');
    if (overlay) overlay.classList.add('open');
}

/* ── Import/Export modal ─────────────────────────────────── */
function showIOModal() {
    const overlay = document.getElementById('modal-io');
    if (!overlay) return;
    const ge = window.GameEngine;
    const exportTA = document.getElementById('export-textarea');
    if (exportTA && ge) exportTA.value = ge.exportSave();
    overlay.classList.add('open');
}

/* ── Orbit icons ─────────────────────────────────────────── */
let lastOrbitKey = '';
function updateOrbitIcons() {
    const s = GS();
    const ring = document.getElementById('orbit-ring');
    if (!ring) return;

    const viewerCount = s.buildings['viewer'] || 0;
    const key = viewerCount.toString();
    if (key === lastOrbitKey) return;
    lastOrbitKey = key;

    ring.innerHTML = '';
    if (viewerCount === 0) return;

    // Multi-ring stacking: 20 per ring, infinite rings
    const ICONS_PER_RING = 20;
    const total  = viewerCount;
    const BASE_RADIUS = 120, RING_GAP = 38;
    const BASE_SPEED  = 12,  SPEED_STEP = 3;
    const ringCount   = Math.ceil(total / ICONS_PER_RING);
    const radii  = Array.from({ length: ringCount }, (_, i) => BASE_RADIUS + i * RING_GAP);
    const speeds = Array.from({ length: ringCount }, (_, i) => BASE_SPEED  + i * SPEED_STEP);
    const PULSE_CYCLE = 10; // seconds for one full wave across all icons

    let iconIndex = 0;
    let remaining = total;

    for (let r = 0; r < radii.length && remaining > 0; r++) {
        const ringCount = Math.min(remaining, ICONS_PER_RING);
        remaining -= ringCount;

        for (let j = 0; j < ringCount; j++) {
            const arm = document.createElement('div');
            arm.className = 'orbit-arm';
            arm.style.animation = `orbit-spin ${speeds[r]}s linear infinite`;
            arm.style.animationDelay = `${-(j / ringCount) * speeds[r]}s`;

            const icon = document.createElement('span');
            // Pulse delay spreads all icons evenly across the 10s cycle
            const pulseDelay = -(iconIndex / total) * PULSE_CYCLE;
            icon.style.cssText = `position:absolute;left:${radii[r]}px;top:0;font-size:1rem;line-height:1;pointer-events:none;animation:iconPulse ${PULSE_CYCLE}s linear infinite;animation-delay:${pulseDelay}s;`;
            icon.textContent = '👆';

            arm.appendChild(icon);
            ring.appendChild(arm);
            iconIndex++;
        }
    }
}

/* ── News ticker ─────────────────────────────────────────── */
function initTicker() {
    const track = document.getElementById('ticker-track');
    if (!track) return;
    const msgs = [...NEWS_TICKER, ...NEWS_TICKER]; // duplicate for seamless loop
    track.innerHTML = msgs.map(m => `<span class="ticker-item">${m}</span>`).join('');
}

/* ── Tab switching ───────────────────────────────────────── */
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tab-buildings').classList.toggle('active', tab === 'buildings');
    document.getElementById('tab-upgrades').classList.toggle('active', tab === 'upgrades');
    document.getElementById('buildings-panel').classList.toggle('hidden', tab !== 'buildings');
    document.getElementById('upgrades-panel').classList.toggle('hidden', tab !== 'upgrades');

    if (tab === 'upgrades') renderUpgrades();
    if (tab === 'buildings') renderBuildings();
}

/* ── Full render ─────────────────────────────────────────── */
function fullRender() {
    updatePlayerCard();
    renderBuildings();
    renderUpgrades();
    updateStats();
    renderAchievements();
    updateBuffBar();
    markDirty();
}

/* ── Tick update (called every 100ms from engine) ─────────── */
function tickUpdate(dt) {
    animateClout();
    updateBuffBar();

    // Update CPS / click displays every tick
    const s = GS();
    const ge = window.GameEngine;
    const activeCpsMult   = ge ? ge.getActiveCpsMultiplier()   : 1;
    const activeClickMult = ge ? ge.getActiveClickMultiplier() : 1;
    const cpsEl = document.getElementById('cps-display');
    if (cpsEl) cpsEl.innerHTML = `per second: <span class="cps-val">${formatNumber(s.cps * activeCpsMult)}</span>`;

    // Orbit icons update
    updateOrbitIcons();

    // Partial updates based on dirty flags
    if (dirty.buildings) { renderBuildings(); dirty.buildings = false; }
    if (dirty.upgrades)  { if (currentTab === 'upgrades') { renderUpgrades(); } dirty.upgrades = false; }
    if (dirty.stats)     { updateStats(); dirty.stats = false; }
    if (dirty.achievements){ renderAchievements(); dirty.achievements = false; }

    // Mark buildings dirty every second for affordability update
    if (Math.random() < 0.1) { dirty.buildings = true; dirty.stats = true; }
}

/* ── Init UI ──────────────────────────────────────────────── */
function initUI() {
    // Tab buttons
    document.getElementById('tab-buildings').addEventListener('click', () => switchTab('buildings'));
    document.getElementById('tab-upgrades').addEventListener('click',  () => switchTab('upgrades'));

    // Bulk buttons
    document.querySelectorAll('.bulk-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.bulk-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            bulkMode = btn.dataset.qty === 'max' ? 'max' : parseInt(btn.dataset.qty);
            dirty.buildings = true;
        });
    });

    // Click target
    const clickTarget = document.getElementById('click-target');
    if (clickTarget) {
        clickTarget.addEventListener('click', () => {
            if (window.GameEngine) window.GameEngine.handleClick();
        });
        // Touch support
        clickTarget.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (window.GameEngine) window.GameEngine.handleClick();
        }, { passive: false });
    }

    // Golden clout
    const goldenEl = document.getElementById('golden-clout');
    if (goldenEl) {
        goldenEl.addEventListener('click', () => {
            if (window.GameEngine) window.GameEngine.clickGoldenClout();
        });
    }

    // ── Profile popover ──────────────────────────────────────
    const profPop         = document.getElementById('profile-popover');
    const profNameInput   = document.getElementById('prof-name-input');
    const profNameEditRow = document.getElementById('prof-name-edit-row');
    const btnProfEditName = document.getElementById('btn-prof-edit-name');
    const btnProfSaveName = document.getElementById('btn-prof-name-save');
    const btnProfCancel   = document.getElementById('btn-prof-name-cancel');
    const btnProfSignout  = document.getElementById('btn-prof-signout');

    function openProfilePopover() {
        const s = GS();
        const el = document.getElementById('prof-pop-name');
        const av = document.getElementById('prof-pop-avatar');
        if (el) el.textContent = s.displayName || 'Player';
        if (av) av.textContent = (s.displayName || 'P')[0].toUpperCase();
        profNameEditRow && profNameEditRow.classList.remove('open');
        profPop && profPop.classList.toggle('open');
    }

    if (btnProfEditName) {
        btnProfEditName.addEventListener('click', () => {
            profNameInput.value = GS().displayName || '';
            profNameEditRow.classList.add('open');
            profNameInput.focus();
            profNameInput.select();
        });
    }
    if (btnProfCancel) {
        btnProfCancel.addEventListener('click', () => profNameEditRow.classList.remove('open'));
    }
    if (btnProfSaveName) {
        btnProfSaveName.addEventListener('click', async () => {
            const newName = profNameInput.value.trim();
            if (!newName) return;
            btnProfSaveName.disabled = true;
            btnProfSaveName.textContent = '...';
            try {
                await window.GameEngine.updateDisplayName(newName);
                profNameEditRow.classList.remove('open');
                // Update all name displays
                ['player-name', 'prof-pop-name'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = newName;
                });
                ['player-avatar', 'prof-pop-avatar'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = newName[0].toUpperCase();
                });
                document.getElementById('btn-auth').textContent = '👤 ' + newName;
                showToast('save', '✅ Name updated!', `Now showing as "${newName}" on the leaderboard.`);
            } catch(err) {
                showToast('info', '❌ Failed', err.message || 'Could not update name.');
            } finally {
                btnProfSaveName.disabled = false;
                btnProfSaveName.textContent = 'Save';
            }
        });
    }
    profNameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  btnProfSaveName?.click();
        if (e.key === 'Escape') btnProfCancel?.click();
    });
    if (btnProfSignout) {
        btnProfSignout.addEventListener('click', () => {
            profPop && profPop.classList.remove('open');
            if (window.GameEngine) {
                window.GameEngine.fullSave(true);
                window.GameEngine.signOut();
            }
        });
    }
    // Close profile popover when clicking outside
    document.addEventListener('click', (e) => {
        if (!profPop) return;
        const authBtn = document.getElementById('btn-auth');
        if (!profPop.contains(e.target) && authBtn && !authBtn.contains(e.target)) {
            profPop.classList.remove('open');
        }
    });

    // Prestige button
    const prestBtn = document.getElementById('prestige-btn');
    if (prestBtn) {
        prestBtn.addEventListener('click', showPrestigeModal);
    }

    // Nav buttons
    document.getElementById('btn-save')?.addEventListener('click', () => {
        window.GameEngine && window.GameEngine.fullSave(false);
    });
    document.getElementById('btn-io')?.addEventListener('click', showIOModal);
    document.getElementById('btn-leaderboard')?.addEventListener('click', showLeaderboardModal);
    document.getElementById('btn-auth')?.addEventListener('click', () => {
        const s = GS();
        if (s.isLoggedIn) {
            openProfilePopover();
        } else {
            showAuthModal();
        }
    });

    // Theme toggle
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) {
        const SUN_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
        const MOON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
        function updateThemeIcon() {
            themeBtn.innerHTML = document.documentElement.classList.contains('light') ? MOON_SVG : SUN_SVG;
            themeBtn.title = document.documentElement.classList.contains('light') ? 'Switch to dark mode' : 'Switch to light mode';
        }
        updateThemeIcon();
        themeBtn.addEventListener('click', () => { window.TBTheme && window.TBTheme.toggle(); });
        window.addEventListener('tb-theme-change', updateThemeIcon);
    }

    // Achievement filter buttons
    document.querySelectorAll('.ach-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ach-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            achFilter = btn.dataset.filter;
            renderAchievements();
        });
    });

    // Leaderboard button in right column
    document.querySelector('.lb-btn')?.addEventListener('click', showLeaderboardModal);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay')?.classList.remove('open');
        });
    });

    // Auth form
    initAuthForm();

    // Prestige confirm
    document.getElementById('prestige-confirm-btn')?.addEventListener('click', () => {
        document.getElementById('modal-prestige')?.classList.remove('open');
        if (window.GameEngine) window.GameEngine.prestige();
    });

    // Offline modal OK
    document.getElementById('offline-ok-btn')?.addEventListener('click', () => {
        document.getElementById('modal-offline')?.classList.remove('open');
    });

    // Export/Import
    document.getElementById('btn-export-copy')?.addEventListener('click', () => {
        const ta = document.getElementById('export-textarea');
        if (ta) {
            navigator.clipboard.writeText(ta.value).catch(() => {
                ta.select();
                document.execCommand('copy');
            });
            showToast('save', '📋 Copied!', 'Save data copied to clipboard.');
        }
    });

    document.getElementById('btn-import-load')?.addEventListener('click', () => {
        const ta = document.getElementById('import-textarea');
        if (ta && ta.value.trim() && window.GameEngine) {
            window.GameEngine.importSave(ta.value.trim());
            document.getElementById('modal-io')?.classList.remove('open');
        }
    });

    // News ticker
    initTicker();

    // Ambient particles on click area
    initAmbientParticles();

    // Click spark canvas
    _addSparks = initClickSparkCanvas();

    // Global click sparks — fire on any click anywhere on the page
    document.addEventListener('click', (e) => {
        if (_addSparks) {
            const isFrenzy = window.GameEngine && window.GameEngine.Buffs.clickFrenzy;
            _addSparks(e.clientX, e.clientY, !!isFrenzy);
        }
    });

    // Page-wide ambient particles
    initPageParticles();

    // Custom 👆 cursor (applies to #col-center only)
    setCustomCursor();

    // Initial full render
    fullRender();
}

/* ── Ambient particle canvas ─────────────────────────────── */
function initAmbientParticles() {
    const area = document.getElementById('click-area');
    if (!area) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    area.insertBefore(canvas, area.firstChild);

    const ctx = canvas.getContext('2d');
    const particles = [];

    function resize() {
        canvas.width  = area.clientWidth  || 400;
        canvas.height = area.clientHeight || 500;
    }
    new ResizeObserver(resize).observe(area);
    resize();

    function spawn(randomY) {
        return {
            x: Math.random() * canvas.width,
            y: randomY ? Math.random() * canvas.height : canvas.height + 5,
            vx: (Math.random() - 0.5) * 0.35,
            vy: -(0.35 + Math.random() * 0.75),
            r: 0.6 + Math.random() * 1.8,
            op: 0.08 + Math.random() * 0.28,
            life: 1,
            decay: 0.003 + Math.random() * 0.005,
            color: Math.random() > 0.6 ? '#39ff14' : '#22c55e',
        };
    }

    for (let i = 0; i < 45; i++) particles.push(spawn(true));

    function tick() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= p.decay;
            if (p.life <= 0 || p.y < -5) particles.splice(i, 1, spawn(false));
        }
        while (particles.length < 45) particles.push(spawn(false));

        particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.life * p.op;
            ctx.fillStyle   = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

/* ── Click spark canvas (vanilla JS port of ClickSpark) ───── */
function initClickSparkCanvas() {
    const area = document.getElementById('click-area');
    if (!area) return null;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    area.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const sparks = [];

    function resize() {
        canvas.width  = area.clientWidth  || 400;
        canvas.height = area.clientHeight || 500;
    }
    new ResizeObserver(resize).observe(area);
    resize();

    const DURATION    = 500;
    const SPARK_SIZE  = 13;
    const SPARK_RADIUS = 90;
    const SPARK_COUNT  = 12;
    const EXTRA_SCALE  = 1.0;

    function easeOut(t) { return t * (2 - t); }

    function draw(timestamp) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = sparks.length - 1; i >= 0; i--) {
            const sp = sparks[i];
            const elapsed = timestamp - sp.startTime;
            if (elapsed >= DURATION) { sparks.splice(i, 1); continue; }

            const progress   = elapsed / DURATION;
            const eased      = easeOut(progress);
            const distance   = eased * SPARK_RADIUS * EXTRA_SCALE;
            const lineLength = SPARK_SIZE * (1 - eased);

            const x1 = sp.x + distance * Math.cos(sp.angle);
            const y1 = sp.y + distance * Math.sin(sp.angle);
            const x2 = sp.x + (distance + lineLength) * Math.cos(sp.angle);
            const y2 = sp.y + (distance + lineLength) * Math.sin(sp.angle);

            ctx.globalAlpha = (1 - progress) * 0.9;
            ctx.strokeStyle = sp.color;
            ctx.lineWidth   = 2.5;
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    // Returns the function to call on each click
    return function addSparks(clientX, clientY, isFrenzy) {
        const rect  = canvas.getBoundingClientRect();
        const x     = clientX - rect.left;
        const y     = clientY - rect.top;
        const now   = performance.now();
        const color = isFrenzy ? '#facc15' : '#39ff14';
        const count = isFrenzy ? 16 : SPARK_COUNT;
        for (let i = 0; i < count; i++) {
            sparks.push({ x, y, angle: (2 * Math.PI * i) / count, startTime: now, color });
        }
    };
}

/* ── Custom cursor — classic arrow pointer SVG ────────────── */
function setCustomCursor() {
    try {
        // Draw 👆 emoji rotated -45° (counterclockwise → points top-left like a cursor)
        const sz = 40;
        const c = document.createElement('canvas');
        c.width = sz; c.height = sz;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.translate(sz / 2, sz / 2);
        ctx.rotate(-Math.PI / 4); // -45°
        ctx.font = '30px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👆', 0, 0);
        ctx.restore();
        const url = `url('${c.toDataURL()}') 8 8, auto`;
        // Apply only to the center column (not store/buy items)
        const colCenter = document.getElementById('col-center');
        if (colCenter) colCenter.style.cursor = url;
        const ct = document.getElementById('click-target');
        if (ct) ct.style.cursor = url;
    } catch(e) {}
}

/* ── Page-wide ambient particle canvas ───────────────────── */
function initPageParticles() {
    const canvas = document.getElementById('page-particles');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const particles = [];

    function resize() {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    const colors = ['#22c55e','#39ff14','#4ade80','#16a34a'];

    function spawn(randomY) {
        return {
            x: Math.random() * canvas.width,
            y: randomY ? Math.random() * canvas.height : canvas.height + 5,
            vx: (Math.random() - 0.5) * 0.25,
            vy: -(0.25 + Math.random() * 0.6),
            r: 0.5 + Math.random() * 1.5,
            op: 0.04 + Math.random() * 0.12,
            life: 1,
            decay: 0.002 + Math.random() * 0.004,
            color: colors[Math.floor(Math.random() * colors.length)],
        };
    }

    for (let i = 0; i < 55; i++) particles.push(spawn(true));

    function tick() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.life -= p.decay;
            if (p.life <= 0 || p.y < -5) particles.splice(i, 1, spawn(false));
        }
        while (particles.length < 55) particles.push(spawn(false));

        particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.life * p.op;
            ctx.fillStyle   = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

/* ── Auth form ───────────────────────────────────────────── */
function initAuthForm() {
    const modal = document.getElementById('modal-auth');
    if (!modal) return;

    const signInTab  = modal.querySelector('[data-authtab="signin"]');
    const signUpTab  = modal.querySelector('[data-authtab="signup"]');
    const signInForm = modal.querySelector('#auth-signin-form');
    const signUpForm = modal.querySelector('#auth-signup-form');

    function showSignIn() {
        signInTab.classList.add('active');
        signUpTab.classList.remove('active');
        signInForm.classList.remove('hidden');
        signUpForm.classList.add('hidden');
    }
    function showSignUp() {
        signUpTab.classList.add('active');
        signInTab.classList.remove('active');
        signUpForm.classList.remove('hidden');
        signInForm.classList.add('hidden');
    }

    signInTab?.addEventListener('click', showSignIn);
    signUpTab?.addEventListener('click', showSignUp);

    // Sign in submit
    signInForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = signInForm.querySelector('[name="email"]').value;
        const password = signInForm.querySelector('[name="password"]').value;
        const errorEl  = signInForm.querySelector('.form-error');
        const btn      = signInForm.querySelector('.form-btn');

        btn.disabled = true;
        btn.textContent = 'Signing in...';
        if (errorEl) errorEl.textContent = '';

        try {
            await window.GameEngine.signIn(email, password);
            modal.classList.remove('open');
            showToast('info', '👋 Signed in!', 'Loading your cloud save...');
        } catch (err) {
            if (errorEl) errorEl.textContent = err.message || 'Sign in failed.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    });

    // Sign up submit
    signUpForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = signUpForm.querySelector('[name="displayName"]').value.trim();
        const email       = signUpForm.querySelector('[name="email"]').value;
        const password    = signUpForm.querySelector('[name="password"]').value;
        const errorEl     = signUpForm.querySelector('.form-error');
        const btn         = signUpForm.querySelector('.form-btn');

        if (!displayName) {
            if (errorEl) errorEl.textContent = 'Display name is required.';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Creating account...';
        if (errorEl) errorEl.textContent = '';

        try {
            await window.GameEngine.signUp(email, password, displayName);
            modal.classList.remove('open');
            showToast('info', '🎉 Account created!', `Welcome, ${displayName}!`);
            updatePlayerCard(); // ensure nav + right column reflect the new account
        } catch (err) {
            if (errorEl) errorEl.textContent = err.message || 'Sign up failed.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
    });
}

/* ── Expose API ──────────────────────────────────────────── */
window.GameUI = {
    showToast,
    onClickEffect,
    updateBuffBar,
    updatePlayerCard,
    showOfflineModal,
    showAchievementModal,
    showPrestigeModal,
    showLeaderboardModal,
    showAchievementShower,
    fullRender,
    tickUpdate,
    markDirty,
    initUI,
};

// Init when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}

})();
