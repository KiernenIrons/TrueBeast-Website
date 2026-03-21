import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Radio, ArrowLeft, Send, CheckCircle, XCircle, Loader2, ChevronDown } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordConfig {
  enabled: boolean;
  webhookUrl: string;
  username: string;
  avatarUrl: string;
}

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  parseMode: 'HTML' | 'Markdown' | 'None';
}

interface BlueskyConfig {
  enabled: boolean;
  handle: string;
  appPassword: string;
}

type SendStatus = 'idle' | 'sending' | 'ok' | 'error';

interface PlatformResult {
  platform: string;
  status: SendStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendDiscord(cfg: DiscordConfig, message: string): Promise<void> {
  if (!cfg.webhookUrl.includes('discord.com/api/webhooks')) {
    throw new Error('Invalid Discord webhook URL');
  }
  const body: Record<string, unknown> = { content: message };
  if (cfg.username) body.username = cfg.username;
  if (cfg.avatarUrl) body.avatar_url = cfg.avatarUrl;

  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord error: ${res.status}`);
}

async function sendTelegram(cfg: TelegramConfig, message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: cfg.chatId, text: message };
  if (cfg.parseMode !== 'None') body.parse_mode = cfg.parseMode;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description ?? 'Telegram error');
}

async function sendBluesky(cfg: BlueskyConfig, message: string): Promise<void> {
  // Step 1: Create session
  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: cfg.handle, password: cfg.appPassword }),
  });
  if (!sessionRes.ok) {
    const err = await sessionRes.json().catch(() => ({}));
    throw new Error(err.message ?? 'Bluesky auth failed');
  }
  const session = await sessionRes.json();

  // Step 2: Create post
  const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        text: message,
        createdAt: new Date().toISOString(),
        $type: 'app.bsky.feed.post',
      },
    }),
  });
  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({}));
    throw new Error(err.message ?? 'Bluesky post failed');
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ label }: { label: string }) {
  return (
    <span className="text-xs font-bold tracking-widest text-violet-400 uppercase block mb-4">
      {label}
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
        on ? 'bg-violet-500' : 'bg-white/10'
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

function Collapsible({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full text-left py-1 mb-2"
      >
        {title}
        <ChevronDown
          size={15}
          className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

function ResultRow({ result }: { result: PlatformResult }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
        result.status === 'ok'
          ? 'bg-green-500/5 border-green-500/20 text-green-400'
          : result.status === 'error'
          ? 'bg-red-500/5 border-red-500/20 text-red-400'
          : 'bg-white/3 border-white/8 text-gray-400'
      }`}
    >
      {result.status === 'ok' ? (
        <CheckCircle size={16} className="flex-shrink-0" />
      ) : result.status === 'error' ? (
        <XCircle size={16} className="flex-shrink-0" />
      ) : (
        <Loader2 size={16} className="animate-spin flex-shrink-0" />
      )}
      <div>
        <span className="font-medium">{result.platform}</span>
        {result.error && (
          <span className="block text-xs opacity-70 mt-0.5">{result.error}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Ripple() {
  const [discord, setDiscord] = useState<DiscordConfig>({
    enabled: false,
    webhookUrl: '',
    username: '',
    avatarUrl: '',
  });
  const [telegram, setTelegram] = useState<TelegramConfig>({
    enabled: false,
    botToken: '',
    chatId: '',
    parseMode: 'None',
  });
  const [bluesky, setBluesky] = useState<BlueskyConfig>({
    enabled: false,
    handle: '',
    appPassword: '',
  });

  const [message, setMessage] = useState('');
  const [results, setResults] = useState<PlatformResult[]>([]);
  const [sending, setSending] = useState(false);
  const [dcOpen, setDcOpen] = useState(true);
  const [tgOpen, setTgOpen] = useState(true);
  const [bsOpen, setBsOpen] = useState(true);

  const anyEnabled = discord.enabled || telegram.enabled || bluesky.enabled;
  const charCount = [...message].length;
  const bskyOver = charCount > 300;

  const handleSend = useCallback(async () => {
    if (!message.trim() || !anyEnabled || sending) return;

    const active: PlatformResult[] = [];
    if (discord.enabled) active.push({ platform: 'Discord', status: 'sending' });
    if (telegram.enabled) active.push({ platform: 'Telegram', status: 'sending' });
    if (bluesky.enabled) active.push({ platform: 'Bluesky', status: 'sending' });

    setResults(active);
    setSending(true);

    const update = (platform: string, status: SendStatus, error?: string) => {
      setResults((prev) =>
        prev.map((r) => (r.platform === platform ? { ...r, status, error } : r)),
      );
    };

    const tasks: Promise<void>[] = [];

    if (discord.enabled) {
      tasks.push(
        sendDiscord(discord, message)
          .then(() => update('Discord', 'ok'))
          .catch((e: Error) => update('Discord', 'error', e.message)),
      );
    }

    if (telegram.enabled) {
      tasks.push(
        sendTelegram(telegram, message)
          .then(() => update('Telegram', 'ok'))
          .catch((e: Error) => update('Telegram', 'error', e.message)),
      );
    }

    if (bluesky.enabled) {
      tasks.push(
        sendBluesky(bluesky, message)
          .then(() => update('Bluesky', 'ok'))
          .catch((e: Error) => update('Bluesky', 'error', e.message)),
      );
    }

    await Promise.all(tasks);
    setSending(false);
  }, [message, anyEnabled, sending, discord, telegram, bluesky]);

  const inputClass =
    'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-violet-500/50 transition-colors';

  return (
    <PageLayout title="Ripple | TrueBeast Tools" gradientVariant="purple">
      <section className="py-20 sm:py-28">
        <div className="max-w-[72rem] mx-auto px-4 sm:px-6">

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
              <Radio size={16} className="text-violet-400" />
              <span className="text-sm text-gray-300 font-medium">Multi-Platform Broadcasting</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">Ripple</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Write one message, send it everywhere - Discord, Telegram, and Bluesky simultaneously.
              Your credentials stay in your browser and are never stored.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">

            {/* Left: Platform setup */}
            <div className="flex-1 min-w-0 flex flex-col gap-5">

              {/* Discord */}
              <div className="glass rounded-2xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#5865f2]" />
                    <span className="text-white font-semibold">Discord</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 uppercase tracking-wider">
                      Webhook
                    </span>
                  </div>
                  <Toggle on={discord.enabled} onChange={(v) => setDiscord((p) => ({ ...p, enabled: v }))} />
                </div>

                {discord.enabled && (
                  <div className="mt-4">
                    <Collapsible
                      open={dcOpen}
                      onToggle={() => setDcOpen((p) => !p)}
                      title={<SectionLabel label="Connection" />}
                    >
                      <input
                        type="url"
                        value={discord.webhookUrl}
                        onChange={(e) => setDiscord((p) => ({ ...p, webhookUrl: e.target.value }))}
                        placeholder="https://discord.com/api/webhooks/..."
                        className={inputClass}
                      />
                      <input
                        type="text"
                        value={discord.username}
                        onChange={(e) => setDiscord((p) => ({ ...p, username: e.target.value }))}
                        placeholder="Webhook display name (optional)"
                        className={inputClass}
                      />
                      <input
                        type="url"
                        value={discord.avatarUrl}
                        onChange={(e) => setDiscord((p) => ({ ...p, avatarUrl: e.target.value }))}
                        placeholder="Avatar image URL (optional)"
                        className={inputClass}
                      />
                    </Collapsible>
                    <p className="text-gray-500 text-xs mt-3 leading-relaxed">
                      Server Settings - Integrations - Webhooks - New Webhook - Copy Webhook URL.
                    </p>
                  </div>
                )}
              </div>

              {/* Telegram */}
              <div className="glass rounded-2xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#229ed9]" />
                    <span className="text-white font-semibold">Telegram</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 uppercase tracking-wider">
                      Bot API
                    </span>
                  </div>
                  <Toggle on={telegram.enabled} onChange={(v) => setTelegram((p) => ({ ...p, enabled: v }))} />
                </div>

                {telegram.enabled && (
                  <div className="mt-4">
                    <Collapsible
                      open={tgOpen}
                      onToggle={() => setTgOpen((p) => !p)}
                      title={<SectionLabel label="Connection" />}
                    >
                      <input
                        type="text"
                        value={telegram.botToken}
                        onChange={(e) => setTelegram((p) => ({ ...p, botToken: e.target.value }))}
                        placeholder="Bot token from @BotFather (1234567:ABC...)"
                        className={inputClass}
                      />
                      <input
                        type="text"
                        value={telegram.chatId}
                        onChange={(e) => setTelegram((p) => ({ ...p, chatId: e.target.value }))}
                        placeholder="Channel or chat ID (e.g. @mychannel or -100123...)"
                        className={inputClass}
                      />
                      <div>
                        <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                          Parse Mode
                        </label>
                        <div className="flex gap-2">
                          {(['None', 'Markdown', 'HTML'] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => setTelegram((p) => ({ ...p, parseMode: m }))}
                              className={`flex-1 rounded-xl py-2 text-xs font-medium border transition-all ${
                                telegram.parseMode === m
                                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                                  : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Collapsible>
                    <p className="text-gray-500 text-xs mt-3 leading-relaxed">
                      Create a bot with @BotFather, add it to your channel as admin, then use
                      @userinfobot to find your chat ID.
                    </p>
                  </div>
                )}
              </div>

              {/* Bluesky */}
              <div className="glass rounded-2xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0085ff]" />
                    <span className="text-white font-semibold">Bluesky</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 uppercase tracking-wider">
                      AT Protocol
                    </span>
                  </div>
                  <Toggle on={bluesky.enabled} onChange={(v) => setBluesky((p) => ({ ...p, enabled: v }))} />
                </div>

                {bluesky.enabled && (
                  <div className="mt-4">
                    <Collapsible
                      open={bsOpen}
                      onToggle={() => setBsOpen((p) => !p)}
                      title={<SectionLabel label="Connection" />}
                    >
                      <input
                        type="text"
                        value={bluesky.handle}
                        onChange={(e) => setBluesky((p) => ({ ...p, handle: e.target.value }))}
                        placeholder="yourhandle.bsky.social"
                        className={inputClass}
                      />
                      <input
                        type="password"
                        value={bluesky.appPassword}
                        onChange={(e) => setBluesky((p) => ({ ...p, appPassword: e.target.value }))}
                        placeholder="App password (Settings - Privacy - App Passwords)"
                        className={inputClass}
                      />
                    </Collapsible>
                    <p className="text-gray-500 text-xs mt-3 leading-relaxed">
                      Use an App Password, not your main password. Settings - Privacy and Security -
                      App Passwords - Add App Password.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Compose + Send */}
            <div className="lg:w-[360px] flex-shrink-0">
              <div className="glass rounded-2xl p-6 lg:sticky lg:top-28 flex flex-col gap-5">
                <SectionLabel label="Compose Message" />

                {/* Active platforms */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'discord', label: 'Discord', active: discord.enabled, color: 'bg-[#5865f2]/20 text-[#8a95ff]' },
                    { id: 'telegram', label: 'Telegram', active: telegram.enabled, color: 'bg-sky-500/10 text-sky-400' },
                    { id: 'bluesky', label: 'Bluesky', active: bluesky.enabled, color: 'bg-blue-500/10 text-blue-400' },
                  ]
                    .filter((p) => p.active)
                    .map((p) => (
                      <span key={p.id} className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${p.color}`}>
                        {p.label}
                      </span>
                    ))}
                  {!anyEnabled && (
                    <span className="text-gray-600 text-xs">Enable at least one platform on the left.</span>
                  )}
                </div>

                {/* Message textarea */}
                <div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Write your announcement or message here..."
                    rows={8}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-violet-500/50 transition-colors resize-none leading-relaxed"
                  />
                  <div
                    className={`text-right text-xs mt-1 ${
                      bskyOver ? 'text-red-400' : charCount > 250 ? 'text-yellow-400' : 'text-gray-600'
                    }`}
                  >
                    {charCount} / 300
                    {bluesky.enabled && charCount > 300 && (
                      <span className="ml-1 text-red-400">(Bluesky limit exceeded)</span>
                    )}
                  </div>
                </div>

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={!anyEnabled || !message.trim() || sending || (bluesky.enabled && bskyOver)}
                  className="w-full glass-strong rounded-xl px-6 py-4 inline-flex items-center justify-center gap-2 text-violet-400 hover:text-violet-300 font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <><Loader2 size={16} className="animate-spin" />Sending...</>
                  ) : (
                    <><Send size={16} />Send to All Platforms</>
                  )}
                </button>

                {/* Results */}
                {results.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {results.map((r) => (
                      <ResultRow key={r.platform} result={r} />
                    ))}
                  </div>
                )}

                <p className="text-gray-600 text-xs leading-relaxed">
                  Your credentials are never stored or sent to TrueBeast servers. All API calls go
                  directly from your browser to each platform.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
