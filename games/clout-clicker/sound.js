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

function playClick() {
    tone(1100, 0.045, 'square', 0.10, 0, 550);
}

function playClickFrenzy() {
    tone(1800, 0.03, 'square', 0.12, 0, 900);
}

function playPurchase() {
    tone(523, 0.14, 'sine', 0.22);
    tone(659, 0.14, 'sine', 0.18, 0.07);
    tone(784, 0.18, 'sine', 0.15, 0.14);
}

function playAchievement() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.22, 'sine', 0.20, i * 0.08);
    });
}

function playGoldenAppear() {
    [700, 900, 1100, 1500].forEach((f, i) => {
        tone(f, 0.18, 'sine', 0.08, i * 0.06);
    });
}

function playGoldenClick() {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.35, 'sine', 0.22, i * 0.06);
    });
}

function playPrestige() {
    [261, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, 0.4, 'sine', 0.25, i * 0.09);
    });
}

/* ── SFX controls ─────────────────────────────────────────── */
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

/* ════════════════════════════════════════════════════════════
   LOFI MUSIC — YouTube IFrame API
   Streams Lofi Girl 24/7 radio via a hidden 1×1 iframe.
   Starts on first user interaction (browser autoplay policy).
   ════════════════════════════════════════════════════════════ */

const MUSIC_KEY = 'cc-music';
function loadMusicPrefs() {
    try { return JSON.parse(localStorage.getItem(MUSIC_KEY) || '{}'); }
    catch(e) { return {}; }
}
const musicPrefs  = loadMusicPrefs();
let _musicEnabled = musicPrefs.enabled !== false;
let _musicVolume  = typeof musicPrefs.volume === 'number' ? musicPrefs.volume : 0.4;

let ytPlayer      = null;
let ytReady       = false;
let _wantPlay     = false;   // did the user want music before player was ready?

function saveMusicPrefs() {
    localStorage.setItem(MUSIC_KEY, JSON.stringify({ enabled: _musicEnabled, volume: _musicVolume }));
}

/* Load the YouTube IFrame API script once */
function loadYTAPI() {
    if (document.getElementById('yt-api-script')) return;
    // Handle case where API loaded before callback was set
    if (window.YT && window.YT.Player) { initYTPlayer(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
        if (prev) prev();
        initYTPlayer();
    };
    const s = document.createElement('script');
    s.id  = 'yt-api-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
}

function initYTPlayer() {
    if (ytPlayer || !window.YT || !window.YT.Player) return;
    const container = document.getElementById('yt-player-container');
    if (!container) return;

    ytPlayer = new YT.Player(container, {
        width:   '1',
        height:  '1',
        videoId: 'jfKfPfyJRdk',   // Lofi Girl – beats to relax/study to (24/7)
        playerVars: {
            autoplay:       0,
            controls:       0,
            disablekb:      1,
            fs:             0,
            modestbranding: 1,
            rel:            0,
            origin:         window.location.origin,
        },
        events: {
            onReady: function () {
                ytReady = true;
                ytPlayer.setVolume(Math.round(_musicVolume * 100));
                if (_wantPlay && _musicEnabled) ytPlayer.playVideo();
            },
            onStateChange: function (e) {
                // Live stream ended (rare) — seek back
                if (e.data === YT.PlayerState.ENDED) ytPlayer.playVideo();
            },
            onError: function (e) {
                console.warn('YouTube music error:', e.data);
            },
        },
    });
}

function startMusic() {
    _wantPlay = true;
    if (!ytPlayer) { loadYTAPI(); return; }
    if (ytReady) ytPlayer.playVideo();
}

function stopMusic() {
    _wantPlay = false;
    if (ytPlayer && ytReady) ytPlayer.pauseVideo();
}

function setMusicEnabled(val) {
    _musicEnabled = !!val;
    saveMusicPrefs();
    if (_musicEnabled) startMusic();
    else stopMusic();
    updateMusicUI();
}

function setMusicVolume(v) {
    _musicVolume = Math.max(0, Math.min(1, +v || 0));
    if (ytPlayer && ytReady) ytPlayer.setVolume(Math.round(_musicVolume * 100));
    saveMusicPrefs();
    updateMusicUI();
}

function getMusicEnabled() { return _musicEnabled; }
function getMusicVolume()  { return _musicVolume; }

function updateMusicUI() {
    const toggle = document.getElementById('music-mute-toggle');
    const slider = document.getElementById('music-vol-slider');
    const label  = document.getElementById('music-vol-label');
    if (toggle) toggle.checked    = _musicEnabled;
    if (slider) slider.value      = Math.round(_musicVolume * 100);
    if (label)  label.textContent = Math.round(_musicVolume * 100) + '%';
}

/* ── Init audio popover UI ────────────────────────────────── */
function initAudioUI() {
    const btn = document.getElementById('btn-audio');
    const pop = document.getElementById('audio-popover');
    if (!btn || !pop) return;

    updateUI();
    updateMusicUI();

    // Pre-load the YT API early so it's ready by first click
    loadYTAPI();

    btn.addEventListener('click', () => {
        getCtx();
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

    const musicToggle = document.getElementById('music-mute-toggle');
    if (musicToggle) {
        musicToggle.checked = _musicEnabled;
        musicToggle.addEventListener('change', () => setMusicEnabled(musicToggle.checked));
    }

    const musicSlider = document.getElementById('music-vol-slider');
    if (musicSlider) {
        musicSlider.value = Math.round(_musicVolume * 100);
        musicSlider.addEventListener('input', () => setMusicVolume(musicSlider.value / 100));
    }

    // Start music on first user interaction (browser autoplay policy)
    function onFirstInteraction() {
        if (_musicEnabled) startMusic();
        document.removeEventListener('click',   onFirstInteraction);
        document.removeEventListener('keydown', onFirstInteraction);
    }
    document.addEventListener('click',   onFirstInteraction);
    document.addEventListener('keydown', onFirstInteraction);
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
    startMusic,
    stopMusic,
    setMusicEnabled,
    setMusicVolume,
    getMusicEnabled,
    getMusicVolume,
};

})();
