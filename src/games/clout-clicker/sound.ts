/**
 * Clout Clicker — Sound Engine
 * Web Audio API synthesis — no external files required
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

const STORAGE_KEY = 'cc-audio';

function loadPrefs(): { enabled?: boolean; volume?: number } {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

const prefs = loadPrefs();
let _enabled = prefs.enabled !== false;
let _volume = typeof prefs.volume === 'number' ? prefs.volume : 0.35;

function savePrefs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: _enabled, volume: _volume }));
}

function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = _volume;
      masterGain.connect(audioCtx.destination);
    } catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0, freqEnd?: number) {
  if (!_enabled || _volume < 0.001) return;
  const c = getCtx();
  if (!c || !masterGain) return;

  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);

  gain.gain.setValueAtTime(vol * _volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export const GameSound = {
  playClick() { tone(1100, 0.045, 'square', 0.10, 0, 550); },
  playClickFrenzy() { tone(1800, 0.03, 'square', 0.12, 0, 900); },
  playPurchase() { tone(523, 0.14, 'sine', 0.22); tone(659, 0.14, 'sine', 0.18, 0.07); tone(784, 0.18, 'sine', 0.15, 0.14); },
  playAchievement() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'sine', 0.20, i * 0.08)); },
  playGoldenAppear() { [700, 900, 1100, 1500].forEach((f, i) => tone(f, 0.18, 'sine', 0.08, i * 0.06)); },
  playGoldenClick() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'sine', 0.22, i * 0.06)); },
  playPrestige() { [261, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.4, 'sine', 0.25, i * 0.09)); },

  setVolume(v: number) { _volume = Math.max(0, Math.min(1, v)); if (masterGain) masterGain.gain.value = _volume; savePrefs(); },
  setEnabled(val: boolean) { _enabled = val; savePrefs(); },
  getVolume(): number { return _volume; },
  getEnabled(): boolean { return _enabled; },

  // Initialize audio context on first user interaction
  init() { getCtx(); },
};
