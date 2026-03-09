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
function onClickEffect(amount) {
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

    // Particles
    const count = 8;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'click-particle';
        const angle = (i / count) * Math.PI * 2;
        const dist  = 30 + Math.random() * 50;
        const px    = Math.cos(angle) * dist;
        const py    = Math.sin(angle) * dist;
        const size  = 4 + Math.random() * 5;
        p.style.cssText = `
            width:${size}px;height:${size}px;
            left:${cx}px;top:${cy}px;
            background:#${Math.random()>0.5?'22c55e':'39ff14'};
            --px:${px}px;--py:${py}px;
        `;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 700);
    }

    // Check frenzy indicator
    if (window.GameEngine && window.GameEngine.Buffs.clickFrenzy) {
        target.classList.add('frenzy-active');
    } else {
        target.classList.remove('frenzy-active');
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
        const qty   = bulkMode === 'max' ? getMaxAffordable(b, owned, s.clout).qty || 1 : bulkMode;
        const cost  = bulkMode === 'max'
            ? getMaxAffordable(b, owned, s.clout).cost
            : getBuildingCost(b, owned, qty);
        const canAfford = s.clout >= cost && (bulkMode !== 'max' || getMaxAffordable(b,owned,s.clout).qty > 0);

        const row = document.createElement('div');
        row.className = 'building-row ' + (canAfford ? 'can-afford' : 'cannot-afford');
        row.title     = b.desc;
        const effectiveCps = (s._effectiveCps && s._effectiveCps[b.id]) || b.baseCps;
        row.innerHTML = `
            <span class="building-emoji">${b.emoji}</span>
            <div class="building-info">
                <div class="building-name">${b.name}</div>
                <div class="building-cost">${formatNumber(cost)} Clout${bulkMode !== 1 ? ` ×${bulkMode === 'max' ? 'max' : bulkMode}` : ''}</div>
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
    } else {
        loggedIn.style.display  = 'none';
        loggedOut.style.display = 'flex';
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
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">Loading...</td></tr>';

    const ge = window.GameEngine;
    if (!ge) return;
    const rows = await ge.fetchLeaderboard();

    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">No leaderboard data yet. Be the first!</td></tr>';
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

    // Build a key from owned building counts so we only re-render when something changes
    const key = BUILDINGS.map(b => s.buildings[b.id] || 0).join(',');
    if (key === lastOrbitKey) return;
    lastOrbitKey = key;

    ring.innerHTML = '';

    // Show up to 8 building types you own, inner→outer rings based on tier
    const owned = BUILDINGS.filter(b => (s.buildings[b.id] || 0) > 0);
    if (owned.length === 0) return;

    const radii = [90, 115, 140, 165, 190, 215, 240, 265];
    const speeds = [10, 13, 16, 20, 24, 28, 32, 36]; // seconds per revolution

    owned.slice(0, 8).forEach((b, i) => {
        const radius = radii[i] || 265;
        const speed  = speeds[i] || 36;
        const count  = Math.min(s.buildings[b.id] || 0, 6); // max 6 icons per orbit
        const dir    = i % 2 === 0 ? 1 : -1; // alternate clockwise/counter

        for (let j = 0; j < count; j++) {
            const startAngle = (j / count) * 360;
            const wrapper = document.createElement('div');
            wrapper.className = 'orbit-wrapper';
            wrapper.style.cssText = `
                position: absolute;
                top: 50%; left: 50%;
                width: 0; height: 0;
                animation: orbit-spin ${speed}s linear infinite ${dir === -1 ? 'reverse' : ''};
                animation-delay: ${-(j / count) * speed}s;
            `;

            const icon = document.createElement('span');
            icon.className = 'orbit-icon';
            icon.textContent = b.emoji;
            icon.style.cssText = `
                position: absolute;
                transform: translateX(${radius}px) translateY(-50%);
                font-size: ${Math.max(0.6, 1.1 - i * 0.07)}rem;
                filter: drop-shadow(0 0 4px rgba(34,197,94,0.5));
                animation: orbit-counter ${speed}s linear infinite ${dir === -1 ? '' : 'reverse'};
                animation-delay: ${-(j / count) * speed}s;
            `;

            wrapper.appendChild(icon);
            ring.appendChild(wrapper);
        }
    });
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
        if (s.isLoggedIn && window.GameEngine) {
            window.GameEngine.fullSave(true);
            window.GameEngine.signOut();
        } else {
            showAuthModal();
        }
    });

    // Theme toggle
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) {
        function updateThemeIcon() {
            themeBtn.textContent = document.documentElement.classList.contains('light') ? '☀️' : '🌙';
        }
        updateThemeIcon();
        themeBtn.addEventListener('click', () => {
            const isLight = document.documentElement.classList.toggle('light');
            localStorage.setItem('tb-theme', isLight ? 'light' : 'dark');
            updateThemeIcon();
        });
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

    // Initial full render
    fullRender();
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
            window.GameState.displayName = displayName;
            modal.classList.remove('open');
            showToast('info', '🎉 Account created!', `Welcome, ${displayName}!`);
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
