/* ============================================================
   Clout Clicker — Sound Engine
   Web Audio API synthesis — no external files required
   ============================================================ */

(function () {
'use strict';

let audioCtx   = null;
let masterGain = null;

/* ── Persistent prefs ─────────────────────────────────────── */
const STORAGE_KEY = 'cc-audio';
function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { return {}; }
}
const prefs = loadPrefs();
let _enabled = prefs.enabled !== false;
let _volume  = typeof prefs.volume === 'number' ? prefs.volume : 0.35;

function savePrefs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: _enabled, volume: _volume }));
}

/* ── Audio context (lazy init — browsers require user gesture) */
function getCtx() {
    if (!audioCtx) {
        try {
            audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = _volume;
            masterGain.connect(audioCtx.destination);
        } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

/* ── Core primitive ───────────────────────────────────────── */
function tone(freq, dur, type, vol, delay, freqEnd) {
    if (!_enabled || _volume < 0.001) return;
    const c = getCtx();
    if (!c) return;

    const now = c.currentTime + (delay || 0);
    const osc  = c.createOscillator();
    const gain = c.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);

    gain.gain.setValueAtTime((vol || 0.2) * _volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
}

/* ── Sound library ────────────────────────────────────────── */

/* Quick tick on every click */
function playClick() {
    tone(1100, 0.045, 'square', 0.10, 0, 550);
}

/* Deeper tick during Click Frenzy */
function playClickFrenzy() {
    tone(1800, 0.03, 'square', 0.12, 0, 900);
}

/* Ascending triad — buying a building or upgrade */
function playPurchase() {
    tone(523, 0.14, 'sine', 0.22);
    tone(659, 0.14, 'sine', 0.18, 0.07);
    tone(784, 0.18, 'sine', 0.15, 0.14);
}

/* Short fanfare — achievement unlocked */
function playAchievement() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.22, 'sine', 0.20, i * 0.08);
    });
}

/* Gentle shimmer — golden clout appears on screen */
function playGoldenAppear() {
    [700, 900, 1100, 1500].forEach((f, i) => {
        tone(f, 0.18, 'sine', 0.08, i * 0.06);
    });
}

/* Rich sparkle — golden clout clicked */
function playGoldenClick() {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.35, 'sine', 0.22, i * 0.06);
    });
}

/* Epic ascending run — prestige / Go Viral */
function playPrestige() {
    [261, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.4, 'sine', 0.25, i * 0.09);
    });
}

/* ── Controls ─────────────────────────────────────────────── */
function setVolume(v) {
    _volume = Math.max(0, Math.min(1, +v || 0));
    if (masterGain) masterGain.gain.value = _volume;
    savePrefs();
    updateUI();
}

function setEnabled(val) {
    _enabled = !!val;
    savePrefs();
    updateUI();
}

function getVolume()  { return _volume; }
function getEnabled() { return _enabled; }

function updateUI() {
    const slider   = document.getElementById('audio-vol-slider');
    const muteBtn  = document.getElementById('btn-audio');
    const volLabel = document.getElementById('audio-vol-label');
    if (slider)   slider.value  = Math.round(_volume * 100);
    if (volLabel) volLabel.textContent = Math.round(_volume * 100) + '%';
    if (muteBtn)  muteBtn.textContent = _enabled && _volume > 0 ? '🔊' : '🔇';
}

/* ── Init audio popover UI ────────────────────────────────── */
function initAudioUI() {
    const btn = document.getElementById('btn-audio');
    const pop = document.getElementById('audio-popover');
    if (!btn || !pop) return;

    updateUI();

    btn.addEventListener('click', () => {
        getCtx(); // unlock audio context on first user gesture
        pop.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !pop.contains(e.target)) {
            pop.classList.remove('open');
        }
    });

    const slider = document.getElementById('audio-vol-slider');
    if (slider) {
        slider.value = Math.round(_volume * 100);
        slider.addEventListener('input', () => setVolume(slider.value / 100));
    }

    const muteToggle = document.getElementById('audio-mute-toggle');
    if (muteToggle) {
        muteToggle.checked = _enabled;
        muteToggle.addEventListener('change', () => setEnabled(muteToggle.checked));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAudioUI);
} else {
    initAudioUI();
}

/* ── Expose ───────────────────────────────────────────────── */
window.GameSound = {
    playClick,
    playClickFrenzy,
    playPurchase,
    playAchievement,
    playGoldenAppear,
    playGoldenClick,
    playPrestige,
    setVolume,
    setEnabled,
    getVolume,
    getEnabled,
};

})();
