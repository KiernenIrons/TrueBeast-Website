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

/* ════════════════════════════════════════════════════════════
   LOFI MUSIC ENGINE
   Pure Web Audio synthesis — Am–G–F–C at 80 BPM
   ════════════════════════════════════════════════════════════ */

const MUSIC_KEY = 'cc-music';
function loadMusicPrefs() {
    try { return JSON.parse(localStorage.getItem(MUSIC_KEY) || '{}'); }
    catch(e) { return {}; }
}
const musicPrefs  = loadMusicPrefs();
let _musicEnabled = musicPrefs.enabled !== false;  // on by default
let _musicVolume  = typeof musicPrefs.volume === 'number' ? musicPrefs.volume : 0.25;

let musicGainNode  = null;
let crackleSource  = null;
let _sharedNoise   = null;   // reusable noise buffer
let _musicPlaying  = false;
let _schedInterval = null;
let _nextBarTime   = 0;
let _barCount      = 0;

function saveMusicPrefs() {
    localStorage.setItem(MUSIC_KEY, JSON.stringify({ enabled: _musicEnabled, volume: _musicVolume }));
}

function getMusicGain() {
    const c = getCtx();
    if (!c) return null;
    if (!musicGainNode) {
        musicGainNode = c.createGain();
        musicGainNode.gain.value = _musicVolume;
        musicGainNode.connect(masterGain);
    }
    return musicGainNode;
}

/* Shared noise buffer — allocated once, reused for all drums */
function getNoiseBuffer() {
    const c = getCtx();
    if (!c) return null;
    if (!_sharedNoise) {
        const size = Math.floor(c.sampleRate * 0.5);
        _sharedNoise = c.createBuffer(1, size, c.sampleRate);
        const d = _sharedNoise.getChannelData(0);
        for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    }
    return _sharedNoise;
}

/* ── Chord definitions (Am – G – F – C) ─────────────────── */
const BPM    = 80;
const BEAT   = 60 / BPM;   // 0.75 s
const BAR    = BEAT * 4;    // 3.0 s

const CHORDS = [
    { bass: 55,    piano: [110,   130.8, 164.8, 220  ] },  // Am
    { bass: 49,    piano: [98,    123.5, 146.8, 196  ] },  // G
    { bass: 87.3,  piano: [87.3,  110,   130.8, 174.6] },  // F
    { bass: 65.4,  piano: [130.8, 164.8, 196,   261.6] },  // C
];

/* ── Instrument functions ────────────────────────────────── */

function schedPiano(freq, time, dur, vol) {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg) return;

    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    const filt = c.createBiquadFilter();
    const gain = c.createGain();

    osc1.type = 'triangle';
    osc1.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.003;   // slight sharp for warmth

    filt.type = 'lowpass';
    filt.frequency.value = 1600;
    filt.Q.value = 0.4;

    const v = vol * _musicVolume;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(v, time + 0.018);
    gain.gain.setValueAtTime(v * 0.65, time + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc1.connect(filt); osc2.connect(filt);
    filt.connect(gain);
    gain.connect(mg);
    osc1.start(time); osc1.stop(time + dur + 0.05);
    osc2.start(time); osc2.stop(time + dur + 0.05);
}

function schedBass(freq, time, dur) {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg) return;

    const osc  = c.createOscillator();
    const filt = c.createBiquadFilter();
    const gain = c.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    filt.type = 'lowpass';
    filt.frequency.value = 380;

    const v = 0.40 * _musicVolume;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(v, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(filt); filt.connect(gain); gain.connect(mg);
    osc.start(time); osc.stop(time + dur + 0.05);
}

function schedKick(time) {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg) return;

    const osc  = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.14);

    const v = 0.55 * _musicVolume;
    gain.gain.setValueAtTime(v, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);

    osc.connect(gain); gain.connect(mg);
    osc.start(time); osc.stop(time + 0.32);
}

function schedSnare(time) {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg) return;

    // Noise burst
    const nb = getNoiseBuffer();
    if (nb) {
        const src  = c.createBufferSource();
        src.buffer = nb;
        const filt = c.createBiquadFilter();
        filt.type  = 'bandpass';
        filt.frequency.value = 2800;
        filt.Q.value = 0.7;
        const gain = c.createGain();
        const v = 0.20 * _musicVolume;
        gain.gain.setValueAtTime(v, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
        src.connect(filt); filt.connect(gain); gain.connect(mg);
        src.start(time); src.stop(time + 0.16);
    }

    // Tone body
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(230, time);
    osc.frequency.exponentialRampToValueAtTime(130, time + 0.09);
    const v = 0.14 * _musicVolume;
    gain.gain.setValueAtTime(v, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    osc.connect(gain); gain.connect(mg);
    osc.start(time); osc.stop(time + 0.14);
}

function schedHihat(time, vol) {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg) return;

    const nb = getNoiseBuffer();
    if (!nb) return;

    const src  = c.createBufferSource();
    src.buffer = nb;
    const filt = c.createBiquadFilter();
    filt.type  = 'highpass';
    filt.frequency.value = 9500;
    const gain = c.createGain();
    const v = (vol || 0.10) * _musicVolume;
    gain.gain.setValueAtTime(v, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    src.connect(filt); filt.connect(gain); gain.connect(mg);
    src.start(time); src.stop(time + 0.07);
}

/* ── Vinyl crackle (looping) ─────────────────────────────── */
function startCrackle() {
    const c  = getCtx();
    const mg = getMusicGain();
    if (!c || !mg || crackleSource) return;

    const size = Math.floor(c.sampleRate * 4);
    const buf  = c.createBuffer(1, size, c.sampleRate);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
        d[i] = Math.random() < 0.0015 ? (Math.random() - 0.5) * 0.9 : 0;
    }

    crackleSource = c.createBufferSource();
    crackleSource.buffer = buf;
    crackleSource.loop   = true;

    const gain = c.createGain();
    gain.gain.value = 0.035 * _musicVolume;

    crackleSource.connect(gain);
    gain.connect(mg);
    crackleSource.start();
}

function stopCrackle() {
    if (crackleSource) {
        try { crackleSource.stop(); } catch(e) {}
        crackleSource = null;
    }
}

/* ── Bar scheduler ───────────────────────────────────────── */
function scheduleBar(barStart, chordIdx) {
    const ch = CHORDS[chordIdx % 4];

    // Piano chord — stagger notes slightly for natural feel
    ch.piano.forEach((freq, i) => {
        schedPiano(freq, barStart + i * 0.013, BAR * 0.88, 0.10 - i * 0.007);
    });

    // Melody off-beat note for interest
    const melNote = ch.piano[chordIdx % 2 === 0 ? 3 : 2];
    schedPiano(melNote, barStart + BEAT * (1.5 + (chordIdx % 2)), BEAT * 0.65, 0.075);

    // Bass: beat 1 and beat 3 (beat 3 slightly lazy for lofi feel)
    schedBass(ch.bass, barStart + 0.01,              BEAT * 1.65);
    schedBass(ch.bass, barStart + BEAT * 2 + 0.025,  BEAT * 1.4);

    // Kick on 1 and 3
    schedKick(barStart);
    schedKick(barStart + BEAT * 2 + 0.02);

    // Snare on 2 and 4
    schedSnare(barStart + BEAT);
    schedSnare(barStart + BEAT * 3);

    // Hi-hats on every 8th note (off-beats quieter)
    for (let i = 0; i < 8; i++) {
        schedHihat(barStart + i * BEAT * 0.5, i % 2 === 0 ? 0.09 : 0.055);
    }
}

const LOOKAHEAD = 0.35;  // schedule this far ahead (seconds)

function runScheduler() {
    const c = getCtx();
    if (!c || !_musicPlaying) return;
    while (_nextBarTime < c.currentTime + LOOKAHEAD) {
        scheduleBar(_nextBarTime, _barCount % 4);
        _nextBarTime += BAR;
        _barCount++;
    }
}

function startMusic() {
    if (_musicPlaying) return;
    const c = getCtx();
    if (!c) return;
    _musicPlaying = true;
    _barCount     = 0;
    _nextBarTime  = c.currentTime + 0.12;
    startCrackle();
    runScheduler();
    _schedInterval = setInterval(runScheduler, 100);
}

function stopMusic() {
    _musicPlaying = false;
    clearInterval(_schedInterval);
    _schedInterval = null;
    stopCrackle();
    // Fade out
    const c  = getCtx();
    const mg = getMusicGain();
    if (c && mg) {
        mg.gain.setValueAtTime(mg.gain.value, c.currentTime);
        mg.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
        setTimeout(() => {
            if (!_musicPlaying && musicGainNode) musicGainNode.gain.value = _musicVolume;
        }, 700);
    }
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
    if (musicGainNode) musicGainNode.gain.value = _musicVolume;
    saveMusicPrefs();
    updateMusicUI();
}

function getMusicEnabled() { return _musicEnabled; }
function getMusicVolume()  { return _musicVolume; }

function updateMusicUI() {
    const toggle = document.getElementById('music-mute-toggle');
    const slider = document.getElementById('music-vol-slider');
    const label  = document.getElementById('music-vol-label');
    if (toggle) toggle.checked      = _musicEnabled;
    if (slider) slider.value        = Math.round(_musicVolume * 100);
    if (label)  label.textContent   = Math.round(_musicVolume * 100) + '%';
}

/* ── Init audio popover UI ────────────────────────────────── */
function initAudioUI() {
    const btn = document.getElementById('btn-audio');
    const pop = document.getElementById('audio-popover');
    if (!btn || !pop) return;

    updateUI();
    updateMusicUI();

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

    // Music controls
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
        document.removeEventListener('click', onFirstInteraction);
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
