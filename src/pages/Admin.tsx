import { useState, useCallback, useEffect, type FormEvent } from 'react';
import {
  Send01,
  Trash01,
  MessageSquare01,
  BarChart01,
  Star01,
  Bell01,
  Lock01,
  LogOut01,
} from '@untitledui/icons';
import { Tabs, TabList, TabPanel, Tab } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { GlassCard } from '@/components/shared/GlassCard';
import PageLayout from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { FirebaseDB } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_STORAGE_KEY = 'tb_dc_webhook';
const DEFAULT_EMBED_COLOR = '#5865f2';

// ---------------------------------------------------------------------------
// Utility: input class for dark themed form fields
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-colors';

const labelClass = 'block text-sm font-medium text-gray-300 mb-1.5';

// ---------------------------------------------------------------------------
// Login Screen
// ---------------------------------------------------------------------------

function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageLayout gradientVariant="green" title="Admin Login | TrueBeast">
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <GlassCard strong className="w-full max-w-md p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
              <Lock01 className="w-7 h-7 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold font-display text-white">Admin Panel</h1>
            <p className="text-gray-400 text-sm mt-1">Sign in to manage your site</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="admin-email" className={labelClass}>
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                placeholder="admin@truebeast.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className={labelClass}>
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button
              color="primary"
              size="lg"
              isLoading={loading}
              isDisabled={loading}
              onClick={() => {}}
              // The button is type="submit" inside a form, so the form handler fires.
              // We pass onClick as a no-op to satisfy the component API.
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </GlassCard>
      </div>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Discord Embed Preview
// ---------------------------------------------------------------------------

interface EmbedPreviewProps {
  content: string;
  title: string;
  description: string;
  color: string;
  imageUrl: string;
  footerText: string;
  includeTimestamp: boolean;
}

function EmbedPreview({ content, title, description, color, imageUrl, footerText, includeTimestamp }: EmbedPreviewProps) {
  const hasEmbed = title.trim() || description.trim() || imageUrl.trim() || footerText.trim();

  return (
    <div className="space-y-3">
      {/* Message content (above embed) */}
      {content.trim() && (
        <p className="text-gray-200 text-sm whitespace-pre-wrap break-words">{content}</p>
      )}

      {/* Embed card */}
      {hasEmbed && (
        <div className="flex rounded overflow-hidden max-w-lg">
          {/* Color bar */}
          <div className="w-1 flex-shrink-0 rounded-l" style={{ backgroundColor: color }} />

          {/* Embed body */}
          <div className="bg-[#2f3136] rounded-r p-4 flex-1 min-w-0 space-y-2">
            {title.trim() && (
              <h4 className="text-white font-semibold text-sm leading-snug break-words">{title}</h4>
            )}

            {description.trim() && (
              <p className="text-gray-300 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                {description}
              </p>
            )}

            {imageUrl.trim() && (
              <div className="mt-2 rounded-md overflow-hidden">
                <img
                  src={imageUrl}
                  alt="Embed"
                  className="max-w-full max-h-64 rounded-md object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {(footerText.trim() || includeTimestamp) && (
              <div className="flex items-center gap-2 pt-1 text-gray-400 text-xs">
                {footerText.trim() && <span>{footerText}</span>}
                {footerText.trim() && includeTimestamp && <span className="opacity-50">•</span>}
                {includeTimestamp && <span>{new Date().toLocaleDateString()}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!content.trim() && !hasEmbed && (
        <div className="text-gray-500 text-sm italic text-center py-8">
          Start typing to see a preview of your announcement...
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Announcements Tab
// ---------------------------------------------------------------------------

function AnnouncementsTab() {
  // Webhook
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem(WEBHOOK_STORAGE_KEY) ?? '');

  // Message fields
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(DEFAULT_EMBED_COLOR);
  const [imageUrl, setImageUrl] = useState('');
  const [footerText, setFooterText] = useState('');
  const [includeTimestamp, setIncludeTimestamp] = useState(true);

  // UI state
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Persist webhook URL
  useEffect(() => {
    if (webhookUrl.trim()) {
      localStorage.setItem(WEBHOOK_STORAGE_KEY, webhookUrl.trim());
    }
  }, [webhookUrl]);

  // Clear feedback after 5s
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const hasContent = content.trim() || title.trim() || description.trim();

  const handleClear = useCallback(() => {
    setContent('');
    setTitle('');
    setDescription('');
    setColor(DEFAULT_EMBED_COLOR);
    setImageUrl('');
    setFooterText('');
    setIncludeTimestamp(true);
    setFeedback(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!webhookUrl.trim()) {
      setFeedback({ type: 'error', message: 'Please enter a Discord webhook URL.' });
      return;
    }
    if (!hasContent) {
      setFeedback({ type: 'error', message: 'Add some content or embed fields before sending.' });
      return;
    }

    setSending(true);
    setFeedback(null);

    try {
      // 1. Build Discord webhook payload
      const payload: Record<string, unknown> = {};
      if (content.trim()) payload.content = content;

      const hasEmbed = title.trim() || description.trim() || imageUrl.trim() || footerText.trim();
      if (hasEmbed) {
        const embed: Record<string, unknown> = {};
        if (title.trim()) embed.title = title;
        if (description.trim()) embed.description = description;
        embed.color = parseInt(color.replace('#', ''), 16);
        if (imageUrl.trim()) embed.image = { url: imageUrl };
        if (footerText.trim()) embed.footer = { text: footerText };
        if (includeTimestamp) embed.timestamp = new Date().toISOString();
        payload.embeds = [embed];
      }

      // 2. POST to Discord webhook
      const response = await fetch(webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Discord API error (${response.status}): ${errorText}`);
      }

      // 3. Save to Firestore
      try {
        await FirebaseDB.saveAnnouncement({
          title: title || 'Announcement',
          body: description || content,
          content,
          embeds: (payload.embeds as Record<string, unknown>[]) || [],
        });
      } catch {
        // Firestore save is best-effort; don't fail the whole operation
        console.warn('Announcement sent to Discord but Firestore save failed.');
      }

      // 4. Success
      setFeedback({ type: 'success', message: 'Announcement sent successfully!' });
      handleClear();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Failed to send announcement.' });
    } finally {
      setSending(false);
    }
  }, [webhookUrl, content, title, description, color, imageUrl, footerText, includeTimestamp, hasContent, handleClear]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.82fr] gap-6 items-start">
      {/* ── Editor Column ── */}
      <GlassCard className="p-6 space-y-5">
        <h3 className="text-lg font-semibold font-display text-white flex items-center gap-2">
          <Bell01 className="w-5 h-5 text-green-400" />
          Compose Announcement
        </h3>

        {/* Webhook URL */}
        <div>
          <label htmlFor="webhook-url" className={labelClass}>
            Discord Webhook URL
          </label>
          <input
            id="webhook-url"
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1">Saved locally in your browser</p>
        </div>

        <hr className="border-white/5" />

        {/* Content */}
        <div>
          <label htmlFor="msg-content" className={labelClass}>
            Message Content
          </label>
          <textarea
            id="msg-content"
            placeholder="Text that appears above the embed..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className={inputClass + ' resize-y'}
          />
        </div>

        {/* Embed Title */}
        <div>
          <label htmlFor="embed-title" className={labelClass}>
            Embed Title
          </label>
          <input
            id="embed-title"
            type="text"
            placeholder="Announcement title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Embed Description */}
        <div>
          <label htmlFor="embed-description" className={labelClass}>
            Embed Description
          </label>
          <textarea
            id="embed-description"
            placeholder="Detailed announcement text..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={inputClass + ' resize-y'}
          />
        </div>

        {/* Color + Timestamp row */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="embed-color" className={labelClass}>
              Embed Color
            </label>
            <div className="flex items-center gap-3">
              <input
                id="embed-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColor(v);
                }}
                className={inputClass + ' !w-28 font-mono text-xs'}
                maxLength={7}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none pb-1">
            <input
              type="checkbox"
              checked={includeTimestamp}
              onChange={(e) => setIncludeTimestamp(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-green-500 focus:ring-green-500/50 focus:ring-offset-0 cursor-pointer accent-green-500"
            />
            <span className="text-sm text-gray-300">Include timestamp</span>
          </label>
        </div>

        {/* Image URL */}
        <div>
          <label htmlFor="embed-image" className={labelClass}>
            Image URL <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="embed-image"
            type="url"
            placeholder="https://example.com/image.png"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Footer Text */}
        <div>
          <label htmlFor="embed-footer" className={labelClass}>
            Footer Text <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="embed-footer"
            type="text"
            placeholder="e.g. TrueBeast Announcements"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* Feedback */}
        {feedback && (
          <div
            className={`rounded-xl px-4 py-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            color="primary"
            size="md"
            iconLeading={Send01}
            isLoading={sending}
            isDisabled={sending || !hasContent}
            onClick={handleSend}
          >
            {sending ? 'Sending...' : 'Send Announcement'}
          </Button>

          <Button
            color="tertiary"
            size="md"
            iconLeading={Trash01}
            isDisabled={sending}
            onClick={handleClear}
          >
            Clear
          </Button>
        </div>
      </GlassCard>

      {/* ── Preview Column ── */}
      <div className="lg:sticky lg:top-28">
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Live Preview
          </h3>

          {/* Discord-ish container */}
          <div className="bg-[#36393f] rounded-lg p-4 min-h-[200px]">
            {/* Bot avatar + name */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                TB
              </div>
              <div>
                <span className="text-white text-sm font-semibold">TrueBeast</span>
                <span className="ml-1.5 bg-[#5865f2] text-[10px] font-semibold text-white px-1 py-px rounded">
                  BOT
                </span>
              </div>
            </div>

            <EmbedPreview
              content={content}
              title={title}
              description={description}
              color={color}
              imageUrl={imageUrl}
              footerText={footerText}
              includeTimestamp={includeTimestamp}
            />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder Tabs
// ---------------------------------------------------------------------------

function PlaceholderTab({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <GlassCard className="p-12 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-gray-500" />
      </div>
      <h3 className="text-xl font-semibold font-display text-white mb-2">{label}</h3>
      <p className="text-gray-400 text-sm max-w-md">
        This section is coming soon. Check back later for full {label.toLowerCase()} management.
      </p>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Tab Items definition
// ---------------------------------------------------------------------------

const TAB_ITEMS = [
  { id: 'announcements', label: 'Announcements' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'analytics', label: 'Analytics' },
];

// ---------------------------------------------------------------------------
// Admin Panel (Authenticated)
// ---------------------------------------------------------------------------

function AdminDashboard() {
  const { user, logout } = useAuth();

  return (
    <PageLayout gradientVariant="green" title="Admin Panel | TrueBeast">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold font-display text-white">Admin Panel</h1>
            <p className="text-gray-400 text-sm mt-1">
              Signed in as <span className="text-green-400">{user?.email}</span>
            </p>
          </div>

          <Button
            color="tertiary"
            size="sm"
            iconLeading={LogOut01}
            onClick={logout}
          >
            Sign Out
          </Button>
        </div>

        {/* Tabs */}
        <Tabs>
          <TabList
            items={TAB_ITEMS}
            type="underline"
            size="md"
            className="mb-6"
          >
            {TAB_ITEMS.map((tab) => (
              <Tab key={tab.id} id={tab.id}>
                {tab.id === 'announcements' && <Bell01 className="w-4 h-4 mr-1.5 inline-block" />}
                {tab.id === 'tickets' && <MessageSquare01 className="w-4 h-4 mr-1.5 inline-block" />}
                {tab.id === 'reviews' && <Star01 className="w-4 h-4 mr-1.5 inline-block" />}
                {tab.id === 'analytics' && <BarChart01 className="w-4 h-4 mr-1.5 inline-block" />}
                {tab.label}
              </Tab>
            ))}
          </TabList>

          <TabPanel id="announcements" className="mt-2">
            <AnnouncementsTab />
          </TabPanel>

          <TabPanel id="tickets" className="mt-2">
            <PlaceholderTab icon={MessageSquare01} label="Tickets" />
          </TabPanel>

          <TabPanel id="reviews" className="mt-2">
            <PlaceholderTab icon={Star01} label="Reviews" />
          </TabPanel>

          <TabPanel id="analytics" className="mt-2">
            <PlaceholderTab icon={BarChart01} label="Analytics" />
          </TabPanel>
        </Tabs>
      </div>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Root Export — Auth Gate
// ---------------------------------------------------------------------------

export default function Admin() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PageLayout gradientVariant="green" title="Admin Panel | TrueBeast">
        <div className="min-h-[70vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageLayout>
    );
  }

  if (!user) return <LoginScreen />;

  return <AdminDashboard />;
}
