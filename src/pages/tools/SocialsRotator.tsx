import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, ArrowLeft, Copy, Check, ExternalLink, Plus, Trash2 } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocialEntry {
  platform: string;
  username: string;
}

interface AppearanceConfig {
  transition: 'slide' | 'fade' | 'zoom';
  logoSize: number;
  font: string;
  textSize: number;
  duration: number;
  color: string;
  shadow: boolean;
  logoStyle: 'circle' | 'rounded' | 'square';
}

interface TimingConfig {
  displayTime: number;
  gapTime: number;
}

interface RotatorConfig {
  socials: SocialEntry[];
  appearance: AppearanceConfig;
  timing: TimingConfig;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS = [
  { id: 'twitch',    name: 'Twitch',      color: '#9147ff', icon: '🟣' },
  { id: 'kick',      name: 'Kick',        color: '#53fc18', icon: '🟢' },
  { id: 'youtube',   name: 'YouTube',     color: '#ff0000', icon: '🔴' },
  { id: 'discord',   name: 'Discord',     color: '#5865f2', icon: '💙' },
  { id: 'twitter',   name: 'X (Twitter)', color: '#1da1f2', icon: '🔵' },
  { id: 'instagram', name: 'Instagram',   color: '#e1306c', icon: '🩷' },
  { id: 'tiktok',    name: 'TikTok',      color: '#010101', icon: '⬛' },
  { id: 'bluesky',   name: 'Bluesky',     color: '#0085ff', icon: '🔵' },
  { id: 'facebook',  name: 'Facebook',    color: '#1877f2', icon: '🔵' },
  { id: 'snapchat',  name: 'Snapchat',    color: '#fffc00', icon: '🟡' },
  { id: 'reddit',    name: 'Reddit',      color: '#ff4500', icon: '🔶' },
  { id: 'steam',     name: 'Steam',       color: '#1b2838', icon: '⚫' },
];

const FONTS = [
  'Outfit', 'Space Grotesk', 'Inter', 'Poppins', 'Montserrat',
  'Oswald', 'Orbitron', 'Kanit', 'Teko', 'Quicksand',
];

const TRANSITIONS = ['slide', 'fade', 'zoom'] as const;

const DEFAULT_CONFIG: RotatorConfig = {
  socials: [],
  appearance: {
    transition: 'slide',
    logoSize: 48,
    font: 'Outfit',
    textSize: 18,
    duration: 4,
    color: '#ffffff',
    shadow: true,
    logoStyle: 'circle',
  },
  timing: {
    displayTime: 5,
    gapTime: 1,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeConfig(cfg: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

function buildUrl(cfg: RotatorConfig): string {
  return `/tools/socials-rotator/rotator.html?c=${encodeConfig(cfg)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-7 h-7 rounded-full bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 text-xs font-bold flex-shrink-0">
        {n}
      </div>
      <span className="text-xs font-bold tracking-widest text-pink-400 uppercase">{label}</span>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
        on ? 'bg-pink-500' : 'bg-white/10'
      }`}
      aria-label="Toggle"
    >
      <span
        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
          on ? 'left-5' : 'left-1'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SocialsRotator() {
  const [step, setStep] = useState(1);
  const [cfg, setCfg] = useState<RotatorConfig>(DEFAULT_CONFIG);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedPlatforms -> cfg.socials (keep order + usernames)
  useEffect(() => {
    setCfg((prev) => {
      const existing = new Map(prev.socials.map((s) => [s.platform, s.username]));
      const next = Array.from(selectedPlatforms).map((p) => ({
        platform: p,
        username: existing.get(p) ?? '',
      }));
      return { ...prev, socials: next };
    });
  }, [selectedPlatforms]);

  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setUsername = useCallback((platform: string, username: string) => {
    setCfg((prev) => ({
      ...prev,
      socials: prev.socials.map((s) => (s.platform === platform ? { ...s, username } : s)),
    }));
  }, []);

  const setAppearance = useCallback(
    <K extends keyof AppearanceConfig>(key: K, val: AppearanceConfig[K]) => {
      setCfg((prev) => ({ ...prev, appearance: { ...prev.appearance, [key]: val } }));
    },
    [],
  );

  const setTiming = useCallback(<K extends keyof TimingConfig>(key: K, val: number) => {
    setCfg((prev) => ({ ...prev, timing: { ...prev.timing, [key]: val } }));
  }, []);

  const handleGenerate = useCallback(() => {
    setGeneratedUrl(buildUrl(cfg));
    setStep(5);
  }, [cfg]);

  const handleCopy = useCallback(() => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(`${window.location.origin}${generatedUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedUrl]);

  const canProceed1 = selectedPlatforms.size > 0;
  const canProceed2 = cfg.socials.every((s) => s.username.trim() !== '');

  return (
    <PageLayout title="Socials Rotator | TrueBeast Tools" gradientVariant="purple">
      <section className="py-20 sm:py-28">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6">

          {/* Back + Hero */}
          <Link
            to="/tools"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10"
          >
            <ArrowLeft size={14} />
            Back to Tools
          </Link>

          <div className="text-center mb-14 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <RefreshCw size={16} className="text-pink-400" />
              <span className="text-sm text-gray-300 font-medium">OBS Overlay</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">Socials Rotator</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Build a free, animated OBS overlay that cycles through your social media profiles.
              No sign-up required.
            </p>
          </div>

          {/* Step progress bar */}
          <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <div key={s} className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => s <= step && setStep(s)}
                  className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
                    s === step
                      ? 'bg-pink-500 text-white'
                      : s < step
                      ? 'bg-pink-500/30 text-pink-400'
                      : 'bg-white/5 text-gray-600'
                  }`}
                >
                  {s}
                </button>
                {s < 5 && <div className="h-px w-8 bg-white/10" />}
              </div>
            ))}
          </div>

          {/* Step 1: Select Platforms */}
          {step === 1 && (
            <div className="glass rounded-2xl p-6">
              <StepLabel n={1} label="Select Platforms" />
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-6">
                {PLATFORMS.map((p) => {
                  const selected = selectedPlatforms.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className={`rounded-xl p-3 border text-center transition-all ${
                        selected
                          ? 'border-pink-500/50 bg-pink-500/10'
                          : 'border-white/8 bg-white/3 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xl mb-1">{p.icon}</div>
                      <div className="text-xs text-gray-300 font-medium leading-tight">{p.name}</div>
                    </button>
                  );
                })}
              </div>

              {!canProceed1 && (
                <p className="text-gray-500 text-sm mb-4">Select at least one platform to continue.</p>
              )}

              <button
                onClick={() => canProceed1 && setStep(2)}
                disabled={!canProceed1}
                className="w-full glass-strong rounded-xl px-6 py-3.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue ({selectedPlatforms.size} selected)
              </button>
            </div>
          )}

          {/* Step 2: Usernames */}
          {step === 2 && (
            <div className="glass rounded-2xl p-6">
              <StepLabel n={2} label="Enter Usernames" />
              <div className="flex flex-col gap-3 mb-6">
                {cfg.socials.map((s) => {
                  const meta = PLATFORMS.find((p) => p.id === s.platform);
                  return (
                    <div key={s.platform} className="flex items-center gap-3">
                      <span className="text-xl flex-shrink-0">{meta?.icon}</span>
                      <div className="flex-1">
                        <input
                          type="text"
                          value={s.username}
                          onChange={(e) => setUsername(s.platform, e.target.value)}
                          placeholder={`${meta?.name} username`}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-pink-500/50 transition-colors"
                        />
                      </div>
                      <button
                        onClick={() => togglePlatform(s.platform)}
                        className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => canProceed2 && setStep(3)}
                  disabled={!canProceed2}
                  className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Appearance */}
          {step === 3 && (
            <div className="glass rounded-2xl p-6">
              <StepLabel n={3} label="Appearance" />

              <div className="flex flex-col gap-5 mb-6">

                {/* Transition */}
                <div>
                  <label className="text-gray-300 text-sm font-medium block mb-2">Transition Style</label>
                  <div className="flex gap-2">
                    {TRANSITIONS.map((t) => (
                      <button
                        key={t}
                        onClick={() => setAppearance('transition', t)}
                        className={`flex-1 rounded-xl py-2 text-sm font-medium border transition-all capitalize ${
                          cfg.appearance.transition === t
                            ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                            : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo Style */}
                <div>
                  <label className="text-gray-300 text-sm font-medium block mb-2">Logo Style</label>
                  <div className="flex gap-2">
                    {(['circle', 'rounded', 'square'] as const).map((ls) => (
                      <button
                        key={ls}
                        onClick={() => setAppearance('logoStyle', ls)}
                        className={`flex-1 rounded-xl py-2 text-sm font-medium border transition-all capitalize ${
                          cfg.appearance.logoStyle === ls
                            ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                            : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        {ls}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font */}
                <div>
                  <label className="text-gray-300 text-sm font-medium block mb-2">Font</label>
                  <select
                    value={cfg.appearance.font}
                    onChange={(e) => setAppearance('font', e.target.value)}
                    className="w-full bg-[#0c0c18] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-pink-500/50 transition-colors"
                  >
                    {FONTS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Text Color */}
                <div>
                  <label className="text-gray-300 text-sm font-medium block mb-2">Text Color</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => colorInputRef.current?.click()}
                      className="w-10 h-10 rounded-xl border-2 border-white/20 flex-shrink-0 cursor-pointer transition-transform hover:scale-105"
                      style={{ background: cfg.appearance.color }}
                    />
                    <input
                      ref={colorInputRef}
                      type="color"
                      value={cfg.appearance.color}
                      onChange={(e) => setAppearance('color', e.target.value)}
                      className="sr-only"
                    />
                    <span className="text-gray-400 text-sm font-mono">{cfg.appearance.color}</span>
                  </div>
                </div>

                {/* Logo Size */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Logo Size</label>
                    <span className="text-pink-400 text-sm font-mono">{cfg.appearance.logoSize}px</span>
                  </div>
                  <input
                    type="range" min={24} max={96} step={4}
                    value={cfg.appearance.logoSize}
                    onChange={(e) => setAppearance('logoSize', Number(e.target.value))}
                    className="w-full accent-pink-500"
                  />
                </div>

                {/* Text Size */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Text Size</label>
                    <span className="text-pink-400 text-sm font-mono">{cfg.appearance.textSize}px</span>
                  </div>
                  <input
                    type="range" min={12} max={36} step={2}
                    value={cfg.appearance.textSize}
                    onChange={(e) => setAppearance('textSize', Number(e.target.value))}
                    className="w-full accent-pink-500"
                  />
                </div>

                {/* Drop Shadow */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-gray-300 text-sm font-medium">Drop Shadow</div>
                    <div className="text-gray-500 text-xs mt-0.5">Adds a soft shadow behind text and logo.</div>
                  </div>
                  <Toggle on={cfg.appearance.shadow} onChange={(v) => setAppearance('shadow', v)} />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Timing */}
          {step === 4 && (
            <div className="glass rounded-2xl p-6">
              <StepLabel n={4} label="Popup Timing" />

              <div className="flex flex-col gap-5 mb-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Display Time</label>
                    <span className="text-pink-400 text-sm font-mono">{cfg.timing.displayTime}s</span>
                  </div>
                  <input
                    type="range" min={2} max={20}
                    value={cfg.timing.displayTime}
                    onChange={(e) => setTiming('displayTime', Number(e.target.value))}
                    className="w-full accent-pink-500"
                  />
                  <p className="text-gray-500 text-xs mt-1">How long each social card stays visible.</p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Gap Between Cards</label>
                    <span className="text-pink-400 text-sm font-mono">{cfg.timing.gapTime}s</span>
                  </div>
                  <input
                    type="range" min={0} max={5}
                    value={cfg.timing.gapTime}
                    onChange={(e) => setTiming('gapTime', Number(e.target.value))}
                    className="w-full accent-pink-500"
                  />
                  <p className="text-gray-500 text-xs mt-1">Pause between each card transition.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(3)}
                  className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleGenerate}
                  className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-pink-400 hover:text-pink-300 font-semibold text-sm transition-all"
                >
                  Generate URL
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Result */}
          {step === 5 && generatedUrl && (
            <div className="glass rounded-2xl p-6">
              <StepLabel n={5} label="Your Overlay URL" />

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 font-mono text-xs text-gray-400 break-all leading-relaxed mb-4">
                {window.location.origin}{generatedUrl}
              </div>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={handleCopy}
                  className="flex-1 glass-strong rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 text-sm font-medium text-white transition-colors"
                >
                  {copied ? (
                    <><Check size={15} className="text-green-400" />Copied!</>
                  ) : (
                    <><Copy size={15} />Copy URL</>
                  )}
                </button>
                <a
                  href={generatedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass rounded-xl px-5 py-3 inline-flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                >
                  <ExternalLink size={15} />
                  Preview
                </a>
              </div>

              <p className="text-gray-500 text-xs leading-relaxed mb-4">
                In OBS: Add a Browser Source, paste this URL, set it to the size you want
                the overlay to appear (e.g. 400x100 for a bottom corner banner).
              </p>

              <button
                onClick={() => { setStep(1); setGeneratedUrl(''); setSelectedPlatforms(new Set()); }}
                className="glass rounded-xl px-5 py-2.5 text-gray-400 hover:text-white text-sm transition-colors inline-flex items-center gap-2"
              >
                <Plus size={14} />
                Start Over
              </button>
            </div>
          )}

        </div>
      </section>
    </PageLayout>
  );
}
