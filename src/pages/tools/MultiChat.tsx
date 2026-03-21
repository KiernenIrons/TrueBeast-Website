import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  ArrowLeft,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  FlaskConical,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformConfig {
  enabled: boolean;
  username: string;
  apiKey?: string;
}

interface AppearanceConfig {
  fontSize: number;
  maxMessages: number;
  timeout: number;
  opacity: number;
  timestamps: boolean;
}

interface MultiChatConfig {
  platforms: {
    twitch: PlatformConfig;
    kick: PlatformConfig;
    youtube: PlatformConfig;
  };
  mode: 'overlay' | 'dock';
  appearance: AppearanceConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeConfig(cfg: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

function buildUrl(cfg: MultiChatConfig): string {
  return `/tools/multichat/chat.html?c=${encodeConfig(cfg)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 text-xs font-bold flex-shrink-0">
        {n}
      </div>
      <span className="text-xs font-bold tracking-widest text-purple-400 uppercase">{label}</span>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
        on ? 'bg-purple-500' : 'bg-white/10'
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

const DEFAULT_CONFIG: MultiChatConfig = {
  platforms: {
    twitch: { enabled: false, username: '' },
    kick: { enabled: false, username: '' },
    youtube: { enabled: false, username: '', apiKey: '' },
  },
  mode: 'overlay',
  appearance: {
    fontSize: 14,
    maxMessages: 30,
    timeout: 0,
    opacity: 100,
    timestamps: false,
  },
};

const PLATFORM_META = {
  twitch: { name: 'Twitch', color: '#9147ff', badge: 'FREE', badgeColor: 'text-green-400 bg-green-500/10' },
  kick: { name: 'Kick', color: '#53fc18', badge: 'FREE', badgeColor: 'text-green-400 bg-green-500/10' },
  youtube: { name: 'YouTube', color: '#ff0000', badge: 'API KEY', badgeColor: 'text-yellow-400 bg-yellow-500/10' },
};

export default function MultiChat() {
  const [cfg, setCfg] = useState<MultiChatConfig>(DEFAULT_CONFIG);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const setPlatform = useCallback(
    (p: 'twitch' | 'kick' | 'youtube', key: keyof PlatformConfig, val: boolean | string) => {
      setCfg((prev) => ({
        ...prev,
        platforms: {
          ...prev.platforms,
          [p]: { ...prev.platforms[p], [key]: val },
        },
      }));
    },
    [],
  );

  const setAppearance = useCallback(
    (key: keyof AppearanceConfig, val: number | boolean) => {
      setCfg((prev) => ({
        ...prev,
        appearance: { ...prev.appearance, [key]: val },
      }));
    },
    [],
  );

  const anyEnabled = Object.values(cfg.platforms).some((p) => p.enabled);

  const handleGenerate = useCallback(() => {
    setGeneratedUrl(buildUrl(cfg));
  }, [cfg]);

  const handleCopy = useCallback(() => {
    if (!generatedUrl) return;
    const full = `${window.location.origin}${generatedUrl}`;
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedUrl]);

  return (
    <PageLayout title="MultiChat | TrueBeast Tools" gradientVariant="purple">
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

          <div className="text-center mb-10 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <MessageSquare size={16} className="text-purple-400" />
              <span className="text-sm text-gray-300 font-medium">OBS Overlay</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">MultiChat</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Combine Twitch, Kick, and YouTube live chats into one clean OBS overlay or dock.
              No account needed for Twitch and Kick.
            </p>
          </div>

          {/* Beta disclaimer */}
          <div className="glass rounded-2xl p-4 flex items-start gap-3 mb-10 border border-yellow-500/20 bg-yellow-500/5">
            <FlaskConical size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-semibold mb-0.5">Work in Progress</p>
              <p className="text-yellow-200/60 text-sm leading-relaxed">
                MultiChat is still being tested and may not work perfectly for all platforms or
                stream setups. You may encounter issues - if you do, let us know in the Discord.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">

            {/* Step 1: Platforms */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={1} label="Connect Platforms" />

              {(Object.entries(cfg.platforms) as [keyof typeof cfg.platforms, PlatformConfig][]).map(
                ([key, plat]) => {
                  const meta = PLATFORM_META[key];
                  return (
                    <div
                      key={key}
                      className="glass rounded-xl p-4 mb-3 last:mb-0 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: meta.color }}
                          />
                          <span className="text-white font-medium text-sm">{meta.name}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${meta.badgeColor}`}
                          >
                            {meta.badge}
                          </span>
                        </div>
                        <Toggle on={plat.enabled} onChange={(v) => setPlatform(key, 'enabled', v)} />
                      </div>

                      {plat.enabled && (
                        <div className="flex flex-col gap-2 pt-1">
                          <input
                            type="text"
                            value={plat.username}
                            onChange={(e) => setPlatform(key, 'username', e.target.value)}
                            placeholder={
                              key === 'youtube' ? 'YouTube Channel Username' : `${meta.name} Username`
                            }
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50 transition-colors"
                          />
                          {key === 'youtube' && (
                            <input
                              type="text"
                              value={plat.apiKey ?? ''}
                              onChange={(e) => setPlatform(key, 'apiKey', e.target.value)}
                              placeholder="YouTube Data API v3 Key (required)"
                              className="w-full bg-white/5 border border-yellow-500/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-yellow-500/40 transition-colors"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>

            {/* Step 2: Display Mode */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={2} label="Display Mode" />
              <div className="grid grid-cols-2 gap-3">
                {(['overlay', 'dock'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCfg((p) => ({ ...p, mode }))}
                    className={`rounded-xl p-4 border text-left transition-all ${
                      cfg.mode === mode
                        ? 'border-purple-500/50 bg-purple-500/10'
                        : 'border-white/8 bg-white/3 hover:border-white/15'
                    }`}
                  >
                    <div className="text-white font-semibold text-sm capitalize mb-1">{mode}</div>
                    <div className="text-gray-400 text-xs leading-relaxed">
                      {mode === 'overlay'
                        ? 'Transparent background for use as a scene overlay in OBS.'
                        : 'Opaque background for use as a custom browser dock in OBS.'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Appearance */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={3} label="Appearance" />

              <div className="flex flex-col gap-5">
                {/* Font Size */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Font Size</label>
                    <span className="text-purple-400 text-sm font-mono">
                      {cfg.appearance.fontSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={11}
                    max={22}
                    value={cfg.appearance.fontSize}
                    onChange={(e) => setAppearance('fontSize', Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                    <span>11px</span>
                    <span>22px</span>
                  </div>
                </div>

                {/* Max Messages */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Max Messages</label>
                    <span className="text-purple-400 text-sm font-mono">
                      {cfg.appearance.maxMessages}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={cfg.appearance.maxMessages}
                    onChange={(e) => setAppearance('maxMessages', Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                    <span>5</span>
                    <span>100</span>
                  </div>
                </div>

                {/* Message Timeout */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Message Timeout</label>
                    <span className="text-purple-400 text-sm font-mono">
                      {cfg.appearance.timeout === 0 ? 'Never' : `${cfg.appearance.timeout}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={5}
                    value={cfg.appearance.timeout}
                    onChange={(e) => setAppearance('timeout', Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                    <span>Never</span>
                    <span>120s</span>
                  </div>
                </div>

                {/* Opacity */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-300 text-sm font-medium">Background Opacity</label>
                    <span className="text-purple-400 text-sm font-mono">
                      {cfg.appearance.opacity}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={cfg.appearance.opacity}
                    onChange={(e) => setAppearance('opacity', Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[11px] text-gray-600 mt-1">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Timestamps */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-gray-300 text-sm font-medium">Show Timestamps</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      Display the time each message was sent.
                    </div>
                  </div>
                  <Toggle
                    on={cfg.appearance.timestamps}
                    onChange={(v) => setAppearance('timestamps', v)}
                  />
                </div>
              </div>
            </div>

            {/* Step 4: Generate */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={4} label="Generate Your URL" />

              {!anyEnabled && (
                <p className="text-yellow-400/80 text-sm mb-4 flex items-center gap-2">
                  <ChevronRight size={14} />
                  Enable at least one platform above before generating.
                </p>
              )}

              <button
                onClick={handleGenerate}
                disabled={!anyEnabled}
                className="w-full glass-strong rounded-xl px-6 py-4 text-purple-400 hover:text-purple-300 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed mb-4"
              >
                Generate URL
              </button>

              {generatedUrl && (
                <div className="flex flex-col gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 font-mono text-xs text-gray-400 break-all leading-relaxed">
                    {window.location.origin}
                    {generatedUrl}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCopy}
                      className="flex-1 glass-strong rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors text-white"
                    >
                      {copied ? (
                        <>
                          <Check size={15} className="text-green-400" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={15} />
                          Copy URL
                        </>
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
                  <p className="text-gray-500 text-xs leading-relaxed">
                    In OBS: Add a Browser Source, paste this URL, set width/height to match your
                    scene. For dock mode use it as a Custom Browser Dock.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
