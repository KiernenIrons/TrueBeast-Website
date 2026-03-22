import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import {
  Send01,
  Trash01,
  MessageSquare01,
  BarChart01,
  Star01,
  Bell01,
  Lock01,
  LogOut01,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  Copy01,
  Save01,
  RefreshCw01,
  Download01,
  Edit03,
  XClose,
  Link01,
  FaceSmile,
  Image01,
} from '@untitledui/icons';
import { Tabs, TabList, TabPanel, Tab } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { GlassCard } from '@/components/shared/GlassCard';
import PageLayout from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { FirebaseDB } from '@/lib/firebase';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

interface EmbedAuthor {
  name: string;
  icon_url: string;
  url: string;
}

interface EmbedFooter {
  text: string;
  icon_url: string;
  timestamp: string;
}

interface EmbedData {
  _id: string;
  _open: boolean;
  color: string;
  title: string;
  url: string;
  description: string;
  author: EmbedAuthor;
  fields: EmbedField[];
  image: string;
  thumbnail: string;
  footer: EmbedFooter;
}

interface ButtonData {
  label: string;
  url: string;
  emoji: string;
}

interface ComposerState {
  content: string;
  embeds: EmbedData[];
  components: ButtonData[][];
  reactions: string[];
}

interface BackupData {
  id: string;
  name: string;
  state: ComposerState;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

type Feedback = { type: 'success' | 'error'; message: string } | null;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const WEBHOOK_KEY = 'tb_dc_webhook';
const CHANNEL_KEY = 'tb_dc_channel_id';
const DEFAULT_COLOR = '#5865f2';
const MAX_EMBEDS = 10;
const MAX_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_REACTIONS = 20;

const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-colors';

const inputSmClass =
  'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-xs focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-colors';

const labelClass = 'block text-sm font-medium text-gray-300 mb-1.5';
const subLabelClass = 'block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wider';

// Common emoji for the picker
const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  { name: 'Reactions', emojis: ['👍', '👎', '❤️', '🔥', '🎉', '💯', '✅', '❌', '⭐', '💀', '😂', '🤔', '👀', '🙏', '💪', '🫡'] },
  { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😎'] },
  { name: 'Gestures', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆'] },
  { name: 'Gaming', emojis: ['🎮', '🕹️', '🎯', '🏆', '🥇', '🥈', '🥉', '🎲', '♟️', '🎰', '🧩', '🎪', '🎫', '🎟️', '🎭', '🃏'] },
  { name: 'Objects', emojis: ['💻', '🖥️', '⌨️', '🖱️', '💾', '📱', '🔔', '🔊', '📢', '📣', '🔗', '⚙️', '🛠️', '🔧', '📌', '🏷️'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function newEmbed(): EmbedData {
  return {
    _id: uid(),
    _open: true,
    color: DEFAULT_COLOR,
    title: '',
    url: '',
    description: '',
    author: { name: '', icon_url: '', url: '' },
    fields: [],
    image: '',
    thumbnail: '',
    footer: { text: '', icon_url: '', timestamp: '' },
  };
}

function newButton(): ButtonData {
  return { label: '', url: '', emoji: '' };
}

function emptyState(): ComposerState {
  return {
    content: '',
    embeds: [newEmbed()],
    components: [],
    reactions: [],
  };
}

function buildPayload(state: ComposerState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (state.content.trim()) payload.content = state.content;

  const embeds = state.embeds
    .map((e) => {
      const em: Record<string, unknown> = {};
      if (e.title.trim()) em.title = e.title;
      if (e.url.trim()) em.url = e.url;
      if (e.description.trim()) em.description = e.description;
      em.color = parseInt(e.color.replace('#', ''), 16);
      if (e.author.name.trim()) {
        const a: Record<string, string> = { name: e.author.name };
        if (e.author.icon_url.trim()) a.icon_url = e.author.icon_url;
        if (e.author.url.trim()) a.url = e.author.url;
        em.author = a;
      }
      const fields = e.fields.filter((f) => f.name.trim() || f.value.trim());
      if (fields.length) em.fields = fields.map((f) => ({ name: f.name, value: f.value, inline: !!f.inline }));
      if (e.image.trim()) em.image = { url: e.image.trim() };
      if (e.thumbnail.trim()) em.thumbnail = { url: e.thumbnail.trim() };
      if (e.footer.text.trim() || e.footer.timestamp) {
        if (e.footer.text.trim()) {
          em.footer = { text: e.footer.text.trim(), ...(e.footer.icon_url.trim() ? { icon_url: e.footer.icon_url.trim() } : {}) };
        }
        if (e.footer.timestamp) em.timestamp = new Date(e.footer.timestamp).toISOString();
      }
      return Object.keys(em).filter((k) => k !== 'color').length ? em : null;
    })
    .filter(Boolean);

  if (embeds.length) payload.embeds = embeds;

  const components = state.components
    .map((row) => {
      const buttons = row
        .filter((b) => b.url.trim() && (b.label.trim() || b.emoji))
        .map((b) => {
          const btn: Record<string, unknown> = { type: 2, style: 5, url: b.url };
          if (b.label.trim()) btn.label = b.label;
          if (b.emoji) {
            // Check if it's a custom emoji (name:id format)
            const customMatch = b.emoji.match(/^(.+):(\d+)$/);
            if (customMatch) {
              btn.emoji = { name: customMatch[1], id: customMatch[2] };
            } else {
              btn.emoji = { name: b.emoji };
            }
          }
          return btn;
        });
      return buttons.length ? { type: 1, components: buttons } : null;
    })
    .filter(Boolean);

  if (components.length) payload.components = components;

  return payload;
}

function hasAnyContent(state: ComposerState): boolean {
  if (state.content.trim()) return true;
  if (state.embeds.some((e) => e.title.trim() || e.description.trim() || e.image.trim())) return true;
  if (state.components.some((r) => r.some((b) => b.url.trim() && (b.label.trim() || b.emoji)))) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Login Screen
// ═══════════════════════════════════════════════════════════════════════════

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
              <label htmlFor="admin-email" className={labelClass}>Email</label>
              <input id="admin-email" type="email" required placeholder="admin@truebeast.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
            </div>
            <div>
              <label htmlFor="admin-password" className={labelClass}>Password</label>
              <input id="admin-password" type="password" required placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}
            <Button color="primary" size="lg" isLoading={loading} isDisabled={loading} onClick={() => {}}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </GlassCard>
      </div>
    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Emoji Picker (Inline)
// ═══════════════════════════════════════════════════════════════════════════

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 top-full left-0 mt-1 bg-[#1e1f22] border border-white/10 rounded-xl shadow-2xl p-3 w-72 max-h-64 overflow-y-auto">
      {EMOJI_CATEGORIES.map((cat) => (
        <div key={cat.name} className="mb-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{cat.name}</p>
          <div className="flex flex-wrap gap-0.5">
            {cat.emojis.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => { onPick(em); onClose(); }}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-lg transition-colors cursor-pointer"
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Discord Preview
// ═══════════════════════════════════════════════════════════════════════════

function DiscordPreview({ state }: { state: ComposerState }) {
  const hasEmbeds = state.embeds.some((e) => e.title.trim() || e.description.trim() || e.image.trim() || e.thumbnail.trim() || e.author.name.trim() || e.fields.length > 0 || e.footer.text.trim());
  const hasButtons = state.components.some((r) => r.some((b) => b.url.trim() && (b.label.trim() || b.emoji)));
  const hasAnything = state.content.trim() || hasEmbeds || hasButtons || state.reactions.length > 0;

  if (!hasAnything) {
    return <div className="text-gray-500 text-sm italic text-center py-8">Start typing to see a preview...</div>;
  }

  return (
    <div className="space-y-2">
      {/* Message content */}
      {state.content.trim() && (
        <p className="text-gray-200 text-sm whitespace-pre-wrap break-words leading-relaxed">{state.content}</p>
      )}

      {/* Embeds */}
      {state.embeds.map((e) => {
        const hasContent = e.title.trim() || e.description.trim() || e.image.trim() || e.thumbnail.trim() || e.author.name.trim() || e.fields.length > 0 || e.footer.text.trim() || e.footer.timestamp;
        if (!hasContent) return null;
        return (
          <div key={e._id} className="flex rounded overflow-hidden max-w-lg">
            <div className="w-1 flex-shrink-0 rounded-l" style={{ backgroundColor: e.color }} />
            <div className="bg-[#2f3136] rounded-r p-3 flex-1 min-w-0">
              <div className="flex gap-3">
                {/* Main content */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* Author */}
                  {e.author.name.trim() && (
                    <div className="flex items-center gap-1.5">
                      {e.author.icon_url.trim() && (
                        <img src={e.author.icon_url} alt="" className="w-5 h-5 rounded-full" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <span className="text-white text-xs font-semibold">{e.author.name}</span>
                    </div>
                  )}
                  {/* Title */}
                  {e.title.trim() && (
                    <h4 className="text-white font-semibold text-sm leading-snug break-words">
                      {e.url.trim() ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[#00aff4] hover:underline">{e.title}</a> : e.title}
                    </h4>
                  )}
                  {/* Description */}
                  {e.description.trim() && (
                    <p className="text-gray-300 text-[13px] leading-relaxed whitespace-pre-wrap break-words">{e.description}</p>
                  )}
                  {/* Fields */}
                  {e.fields.length > 0 && (
                    <div className="grid gap-1.5 mt-1" style={{ gridTemplateColumns: e.fields.some((f) => f.inline) ? 'repeat(3, 1fr)' : '1fr' }}>
                      {e.fields.map((f, fi) => (
                        <div key={fi} style={{ gridColumn: f.inline ? undefined : '1 / -1' }}>
                          {f.name.trim() && <p className="text-white text-xs font-semibold">{f.name}</p>}
                          {f.value.trim() && <p className="text-gray-300 text-xs whitespace-pre-wrap">{f.value}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Image */}
                  {e.image.trim() && (
                    <img src={e.image} alt="" className="max-w-full max-h-64 rounded mt-1" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  {/* Footer */}
                  {(e.footer.text.trim() || e.footer.timestamp) && (
                    <div className="flex items-center gap-1.5 pt-1 text-gray-400 text-[11px]">
                      {e.footer.icon_url.trim() && (
                        <img src={e.footer.icon_url} alt="" className="w-4 h-4 rounded-full" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      {e.footer.text.trim() && <span>{e.footer.text}</span>}
                      {e.footer.text.trim() && e.footer.timestamp && <span className="opacity-50">•</span>}
                      {e.footer.timestamp && (
                        <span>{new Date(e.footer.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      )}
                    </div>
                  )}
                </div>
                {/* Thumbnail */}
                {e.thumbnail.trim() && (
                  <img src={e.thumbnail} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Buttons */}
      {hasButtons && (
        <div className="space-y-1">
          {state.components.map((row, ri) => {
            const validBtns = row.filter((b) => b.url.trim() && (b.label.trim() || b.emoji));
            if (!validBtns.length) return null;
            return (
              <div key={ri} className="flex flex-wrap gap-1">
                {validBtns.map((b, bi) => (
                  <span key={bi} className="inline-flex items-center gap-1.5 bg-[#4f545c] text-white text-xs font-medium px-3 py-1.5 rounded">
                    {b.emoji && <span>{b.emoji}</span>}
                    {b.label && <span>{b.label}</span>}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-60"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Reactions */}
      {state.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {state.reactions.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-[#2f3136] border border-[#5865f2]/40 text-xs rounded-full px-2 py-0.5">
              <span>{r}</span>
              <span className="text-[#5865f2] text-[10px] font-medium">1</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Embed Editor
// ═══════════════════════════════════════════════════════════════════════════

function EmbedEditor({
  embed,
  index,
  total,
  onChange,
  onRemove,
  onToggle,
}: {
  embed: EmbedData;
  index: number;
  total: number;
  onChange: (updated: EmbedData) => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  const set = (key: keyof EmbedData, val: any) => onChange({ ...embed, [key]: val });
  const setAuthor = (key: keyof EmbedAuthor, val: string) => onChange({ ...embed, author: { ...embed.author, [key]: val } });
  const setFooter = (key: keyof EmbedFooter, val: string) => onChange({ ...embed, footer: { ...embed.footer, [key]: val } });
  const setField = (fi: number, key: keyof EmbedField, val: any) => {
    const fields = [...embed.fields];
    fields[fi] = { ...fields[fi], [key]: val };
    onChange({ ...embed, fields });
  };
  const addField = () => onChange({ ...embed, fields: [...embed.fields, { name: '', value: '', inline: false }] });
  const removeField = (fi: number) => onChange({ ...embed, fields: embed.fields.filter((_, i) => i !== fi) });

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: embed.color }} />
          <span className="text-sm font-medium text-gray-200">
            Embed {total > 1 ? `#${index + 1}` : ''}{embed.title.trim() ? ` — ${embed.title.slice(0, 30)}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {total > 1 && (
            <span onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-gray-500 hover:text-red-400 transition-colors p-1">
              <XClose className="w-4 h-4" />
            </span>
          )}
          {embed._open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {embed._open && (
        <div className="p-4 space-y-4 border-t border-white/5">
          {/* Color + Title + URL */}
          <div className="flex gap-3 items-end">
            <div className="flex-shrink-0">
              <label className={subLabelClass}>Color</label>
              <input type="color" value={embed.color} onChange={(e) => set('color', e.target.value)} className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none" />
            </div>
            <div className="flex-1">
              <label className={subLabelClass}>Title</label>
              <input type="text" placeholder="Embed title" value={embed.title} onChange={(e) => set('title', e.target.value)} className={inputSmClass} />
            </div>
            <div className="flex-1">
              <label className={subLabelClass}>Title URL</label>
              <input type="url" placeholder="https://..." value={embed.url} onChange={(e) => set('url', e.target.value)} className={inputSmClass} />
            </div>
          </div>

          {/* Author */}
          <div>
            <label className={subLabelClass}>Author</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" placeholder="Name" value={embed.author.name} onChange={(e) => setAuthor('name', e.target.value)} className={inputSmClass} />
              <input type="url" placeholder="Icon URL" value={embed.author.icon_url} onChange={(e) => setAuthor('icon_url', e.target.value)} className={inputSmClass} />
              <input type="url" placeholder="Author URL" value={embed.author.url} onChange={(e) => setAuthor('url', e.target.value)} className={inputSmClass} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className={subLabelClass}>Description</label>
            <textarea placeholder="Embed description (supports markdown)" value={embed.description} onChange={(e) => set('description', e.target.value)} rows={3} className={inputSmClass + ' resize-y'} />
          </div>

          {/* Fields */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={subLabelClass + ' mb-0'}>Fields</label>
              <button type="button" onClick={addField} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer">
                <Plus className="w-3 h-3" /> Add Field
              </button>
            </div>
            {embed.fields.length === 0 && <p className="text-gray-600 text-xs italic">No fields — click "Add Field" to create one</p>}
            {embed.fields.map((f, fi) => (
              <div key={fi} className="flex gap-2 items-start mb-2">
                <div className="flex-1 min-w-0">
                  <input type="text" placeholder="Field name" value={f.name} onChange={(e) => setField(fi, 'name', e.target.value)} className={inputSmClass + ' mb-1'} />
                  <textarea placeholder="Field value" value={f.value} onChange={(e) => setField(fi, 'value', e.target.value)} rows={2} className={inputSmClass + ' resize-y'} />
                </div>
                <div className="flex flex-col items-center gap-1 pt-1">
                  <label className="flex items-center gap-1 cursor-pointer select-none" title="Inline (3-column layout)">
                    <input type="checkbox" checked={f.inline} onChange={(e) => setField(fi, 'inline', e.target.checked)} className="w-3 h-3 accent-green-500 cursor-pointer" />
                    <span className="text-[10px] text-gray-500">Inline</span>
                  </label>
                  <button type="button" onClick={() => removeField(fi)} className="text-gray-500 hover:text-red-400 transition-colors cursor-pointer p-0.5">
                    <Minus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Images */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={subLabelClass}>Image URL</label>
              <input type="url" placeholder="Large image URL" value={embed.image} onChange={(e) => set('image', e.target.value)} className={inputSmClass} />
            </div>
            <div>
              <label className={subLabelClass}>Thumbnail URL</label>
              <input type="url" placeholder="Small image (right side)" value={embed.thumbnail} onChange={(e) => set('thumbnail', e.target.value)} className={inputSmClass} />
            </div>
          </div>

          {/* Footer */}
          <div>
            <label className={subLabelClass}>Footer</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="text" placeholder="Footer text" value={embed.footer.text} onChange={(e) => setFooter('text', e.target.value)} className={inputSmClass} />
              <input type="url" placeholder="Footer icon URL" value={embed.footer.icon_url} onChange={(e) => setFooter('icon_url', e.target.value)} className={inputSmClass} />
            </div>
            <div>
              <label className={subLabelClass}>Timestamp</label>
              <input type="datetime-local" value={embed.footer.timestamp} onChange={(e) => setFooter('timestamp', e.target.value)} className={inputSmClass} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Button Row Editor
// ═══════════════════════════════════════════════════════════════════════════

function ButtonRowEditor({
  row,
  rowIndex,
  onChange,
  onRemoveRow,
}: {
  row: ButtonData[];
  rowIndex: number;
  onChange: (updated: ButtonData[]) => void;
  onRemoveRow: () => void;
}) {
  const setBtn = (bi: number, key: keyof ButtonData, val: string) => {
    const updated = [...row];
    updated[bi] = { ...updated[bi], [key]: val };
    onChange(updated);
  };
  const addBtn = () => {
    if (row.length < MAX_BUTTONS_PER_ROW) onChange([...row, newButton()]);
  };
  const removeBtn = (bi: number) => {
    const updated = row.filter((_, i) => i !== bi);
    if (updated.length === 0) onRemoveRow();
    else onChange(updated);
  };

  return (
    <div className="border border-white/5 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Row {rowIndex + 1}</span>
        <div className="flex items-center gap-2">
          {row.length < MAX_BUTTONS_PER_ROW && (
            <button type="button" onClick={addBtn} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-0.5 transition-colors cursor-pointer">
              <Plus className="w-3 h-3" /> Button
            </button>
          )}
          <button type="button" onClick={onRemoveRow} className="text-xs text-gray-500 hover:text-red-400 transition-colors cursor-pointer">
            <XClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {row.map((btn, bi) => (
        <ButtonEditor key={bi} btn={btn} onChange={(key, val) => setBtn(bi, key, val)} onRemove={() => removeBtn(bi)} />
      ))}
    </div>
  );
}

function ButtonEditor({
  btn,
  onChange,
  onRemove,
}: {
  btn: ButtonData;
  onChange: (key: keyof ButtonData, val: string) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-lg hover:bg-white/10 transition-colors cursor-pointer"
          title="Pick emoji"
        >
          {btn.emoji || <FaceSmile className="w-4 h-4 text-gray-500" />}
        </button>
        {btn.emoji && (
          <button type="button" onClick={() => onChange('emoji', '')} className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer">
            <XClose className="w-2 h-2" />
          </button>
        )}
        {pickerOpen && <EmojiPicker onPick={(em) => onChange('emoji', em)} onClose={() => setPickerOpen(false)} />}
      </div>
      <input type="text" placeholder="Label" value={btn.label} onChange={(e) => onChange('label', e.target.value)} className={inputSmClass + ' !w-32'} />
      <input type="url" placeholder="https://..." value={btn.url} onChange={(e) => onChange('url', e.target.value)} className={inputSmClass} />
      <button type="button" onClick={onRemove} className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0 cursor-pointer">
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Reactions Editor
// ═══════════════════════════════════════════════════════════════════════════

function ReactionsEditor({
  reactions,
  onChange,
}: {
  reactions: string[];
  onChange: (updated: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const addReaction = (emoji: string) => {
    if (reactions.length >= MAX_REACTIONS) return;
    if (reactions.includes(emoji)) return;
    onChange([...reactions, emoji]);
  };
  const removeReaction = (i: number) => onChange(reactions.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className={subLabelClass + ' mb-0'}>Auto Reactions ({reactions.length}/{MAX_REACTIONS})</label>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {reactions.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-sm group">
            {r}
            <button type="button" onClick={() => removeReaction(i)} className="text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer">
              <XClose className="w-3 h-3" />
            </button>
          </span>
        ))}
        {reactions.length < MAX_REACTIONS && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen(!pickerOpen)}
              className="inline-flex items-center gap-1 bg-white/5 border border-white/10 border-dashed rounded-full px-3 py-1 text-xs text-gray-400 hover:text-green-400 hover:border-green-500/30 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
            {pickerOpen && <EmojiPicker onPick={addReaction} onClose={() => setPickerOpen(false)} />}
          </div>
        )}
      </div>
      {reactions.length > 0 && (
        <p className="text-[10px] text-gray-600 mt-1">Reactions are added to the message after sending (requires bot worker)</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Preset / Backup Manager
// ═══════════════════════════════════════════════════════════════════════════

function PresetManager({
  state,
  onLoad,
}: {
  state: ComposerState;
  onLoad: (state: ComposerState) => void;
}) {
  const [backups, setBackups] = useState<BackupData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await FirebaseDB.getAllWebhookBackups();
      // Parse the stored state back
      const parsed: BackupData[] = raw.map((b: any) => {
        let parsedState: ComposerState;
        if (b.state) {
          parsedState = b.state as ComposerState;
          // Handle legacy components_json format
          if (typeof (parsedState as any).components_json === 'string') {
            try { parsedState.components = JSON.parse((parsedState as any).components_json); } catch { parsedState.components = []; }
          }
          if (!parsedState.components) parsedState.components = [];
          if (!parsedState.reactions) parsedState.reactions = [];
          if (!parsedState.embeds) parsedState.embeds = [newEmbed()];
        } else {
          // Legacy format: reconstruct from top-level fields
          parsedState = emptyState();
          if (b.content) parsedState.content = b.content;
          if (b.embeds) parsedState.embeds = b.embeds;
          if (b.components_json) {
            try { parsedState.components = JSON.parse(b.components_json); } catch { /* */ }
          }
          if (b.reactions) parsedState.reactions = b.reactions;
        }
        return { id: b.id, name: b.name || 'Untitled', state: parsedState, createdAt: b.createdAt, updatedAt: b.updatedAt };
      });
      setBackups(parsed);
    } catch (err) {
      console.warn('Failed to load presets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);

  // Clear feedback after 3s
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [feedback]);

  const handleSaveNew = async () => {
    const name = window.prompt('Preset name:');
    if (!name?.trim()) return;
    setSaving(true);
    try {
      await FirebaseDB.saveWebhookBackup({
        name: name.trim(),
        webhookUrl: '',
        embeds: [],
        state: {
          ...state,
          // Firestore doesn't support nested arrays, so serialize components
          components: undefined as any,
          components_json: JSON.stringify(state.components),
        } as any,
      } as any);
      setFeedback({ type: 'success', message: `Saved "${name.trim()}"` });
      fetchBackups();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleOverwrite = async (backup: BackupData) => {
    if (!window.confirm(`Overwrite "${backup.name}" with current editor state?`)) return;
    setSaving(true);
    try {
      await FirebaseDB.updateWebhookBackup(backup.id, {
        state: {
          ...state,
          components: undefined as any,
          components_json: JSON.stringify(state.components),
        } as any,
      } as any);
      setFeedback({ type: 'success', message: `Updated "${backup.name}"` });
      fetchBackups();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Update failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (backup: BackupData) => {
    if (!window.confirm(`Delete preset "${backup.name}"?`)) return;
    try {
      await FirebaseDB.deleteWebhookBackup(backup.id);
      setFeedback({ type: 'success', message: `Deleted "${backup.name}"` });
      fetchBackups();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Delete failed' });
    }
  };

  const handleLoad = (backup: BackupData) => {
    onLoad(backup.state);
    setFeedback({ type: 'success', message: `Loaded "${backup.name}"` });
  };

  return (
    <div className="border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
          <Save01 className="w-4 h-4 text-gray-400" /> Saved Presets
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={handleSaveNew} disabled={saving} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer">
            <Plus className="w-3 h-3" /> Save New
          </button>
          <button type="button" onClick={() => { navigator.clipboard.writeText(JSON.stringify(buildPayload(state), null, 2)); setFeedback({ type: 'success', message: 'JSON copied!' }); }} className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1 transition-colors cursor-pointer">
            <Copy01 className="w-3 h-3" /> Copy JSON
          </button>
          <button type="button" onClick={fetchBackups} disabled={loading} className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1 transition-colors cursor-pointer">
            <RefreshCw01 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`rounded-lg px-3 py-2 text-xs mb-3 ${feedback.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {feedback.message}
        </div>
      )}

      {loading && backups.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-4">Loading presets...</p>
      ) : backups.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-4">No saved presets yet — compose an announcement and click "Save New"</p>
      ) : (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-3 py-2 group hover:bg-white/[0.04] transition-colors">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{b.name}</p>
                <p className="text-[10px] text-gray-600">
                  {new Date(b.createdAt).toLocaleDateString()}
                  {b.updatedAt && b.updatedAt !== b.createdAt && ` (updated ${new Date(b.updatedAt).toLocaleDateString()})`}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button type="button" onClick={() => handleLoad(b)} className="text-xs text-green-400 hover:text-green-300 p-1 transition-colors cursor-pointer" title="Load">
                  <Download01 className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => handleOverwrite(b)} className="text-xs text-yellow-400 hover:text-yellow-300 p-1 transition-colors cursor-pointer" title="Overwrite with current">
                  <Edit03 className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => handleDelete(b)} className="text-xs text-red-400 hover:text-red-300 p-1 transition-colors cursor-pointer" title="Delete">
                  <Trash01 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Announcements Tab (Main Composer)
// ═══════════════════════════════════════════════════════════════════════════

function AnnouncementsTab() {
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem(WEBHOOK_KEY) ?? '');
  const [state, setState] = useState<ComposerState>(emptyState);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Persist webhook
  useEffect(() => {
    if (webhookUrl.trim()) localStorage.setItem(WEBHOOK_KEY, webhookUrl.trim());
  }, [webhookUrl]);

  // Auto-dismiss feedback
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  // State updaters
  const setContent = (content: string) => setState((s) => ({ ...s, content }));

  const updateEmbed = (i: number, embed: EmbedData) =>
    setState((s) => ({ ...s, embeds: s.embeds.map((e, idx) => (idx === i ? embed : e)) }));

  const removeEmbed = (i: number) =>
    setState((s) => ({ ...s, embeds: s.embeds.filter((_, idx) => idx !== i) }));

  const toggleEmbed = (i: number) =>
    setState((s) => ({ ...s, embeds: s.embeds.map((e, idx) => (idx === i ? { ...e, _open: !e._open } : e)) }));

  const addEmbed = () => {
    if (state.embeds.length < MAX_EMBEDS) setState((s) => ({ ...s, embeds: [...s.embeds, newEmbed()] }));
  };

  const updateRow = (ri: number, row: ButtonData[]) =>
    setState((s) => ({ ...s, components: s.components.map((r, i) => (i === ri ? row : r)) }));

  const removeRow = (ri: number) =>
    setState((s) => ({ ...s, components: s.components.filter((_, i) => i !== ri) }));

  const addRow = () => {
    if (state.components.length < MAX_ROWS) setState((s) => ({ ...s, components: [...s.components, [newButton()]] }));
  };

  const setReactions = (reactions: string[]) => setState((s) => ({ ...s, reactions }));

  const handleClear = () => {
    if (!hasAnyContent(state) || window.confirm('Clear all fields?')) {
      setState(emptyState());
      setFeedback(null);
    }
  };

  const handleLoadPreset = (preset: ComposerState) => {
    // Ensure all embeds have _open and _id
    const embeds = (preset.embeds || [newEmbed()]).map((e) => ({
      ...newEmbed(),
      ...e,
      _id: e._id || uid(),
      _open: true,
      author: { ...newEmbed().author, ...(e.author || {}) },
      footer: { ...newEmbed().footer, ...(e.footer || {}) },
      fields: (e.fields || []).map((f) => ({ name: f.name || '', value: f.value || '', inline: !!f.inline })),
    }));
    setState({
      content: preset.content || '',
      embeds,
      components: preset.components || [],
      reactions: preset.reactions || [],
    });
  };

  const handleSend = async () => {
    if (!webhookUrl.trim()) {
      setFeedback({ type: 'error', message: 'Enter a Discord webhook URL first.' });
      return;
    }
    if (!hasAnyContent(state)) {
      setFeedback({ type: 'error', message: 'Add some content before sending.' });
      return;
    }

    setSending(true);
    setFeedback(null);

    try {
      const payload = buildPayload(state);

      // POST to Discord webhook
      const res = await fetch(webhookUrl.trim() + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Discord error (${res.status}): ${errorText}`);
      }

      // Save to Firestore for homepage display
      try {
        const firstEmbed = state.embeds[0];
        await FirebaseDB.saveAnnouncement({
          title: firstEmbed?.title || 'Announcement',
          body: firstEmbed?.description || state.content,
          content: state.content,
          embeds: (payload.embeds as Record<string, unknown>[]) || [],
        });
      } catch {
        console.warn('Discord sent OK but Firestore save failed.');
      }

      // Handle reactions — if using webhook with ?wait=true, we get the message ID back
      // Reactions via webhook aren't directly supported, but we note them for the user
      if (state.reactions.length > 0) {
        try {
          const msgData = await res.json();
          if (msgData?.id) {
            // Extract webhook ID from URL for reaction endpoint
            const webhookMatch = webhookUrl.match(/\/webhooks\/(\d+)\/([^/?]+)/);
            if (webhookMatch) {
              // Reactions via webhook aren't natively supported by Discord API
              // They require a bot token — note this to the user
              console.info('Reactions require bot API. Message ID:', msgData.id);
            }
          }
        } catch { /* response already consumed or not JSON */ }
      }

      setFeedback({
        type: 'success',
        message: state.reactions.length > 0
          ? 'Announcement sent! (Reactions require bot integration to auto-add)'
          : 'Announcement sent successfully!',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Failed to send.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.82fr] gap-6 items-start">
      {/* ── Editor Column ── */}
      <div className="space-y-4">
        <GlassCard className="p-5 space-y-4">
          <h3 className="text-lg font-semibold font-display text-white flex items-center gap-2">
            <Bell01 className="w-5 h-5 text-green-400" />
            Compose Announcement
          </h3>

          {/* Webhook URL */}
          <div>
            <label className={labelClass}>Discord Webhook URL</label>
            <input type="url" placeholder="https://discord.com/api/webhooks/..." value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className={inputClass} />
            <p className="text-[10px] text-gray-600 mt-1">Saved locally in your browser</p>
          </div>

          <hr className="border-white/5" />

          {/* Message Content */}
          <div>
            <label className={labelClass}>Message Content</label>
            <textarea placeholder="Text above the embed (supports Discord markdown)..." value={state.content} onChange={(e) => setContent(e.target.value)} rows={3} className={inputClass + ' resize-y'} />
          </div>

          {/* Embeds */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass + ' mb-0'}>Embeds ({state.embeds.length}/{MAX_EMBEDS})</label>
              {state.embeds.length < MAX_EMBEDS && (
                <button type="button" onClick={addEmbed} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer">
                  <Plus className="w-3 h-3" /> Add Embed
                </button>
              )}
            </div>
            <div className="space-y-3">
              {state.embeds.map((embed, i) => (
                <EmbedEditor
                  key={embed._id}
                  embed={embed}
                  index={i}
                  total={state.embeds.length}
                  onChange={(updated) => updateEmbed(i, updated)}
                  onRemove={() => removeEmbed(i)}
                  onToggle={() => toggleEmbed(i)}
                />
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Link Buttons */}
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
              <Link01 className="w-4 h-4 text-gray-400" /> Link Buttons ({state.components.length}/{MAX_ROWS} rows)
            </h4>
            {state.components.length < MAX_ROWS && (
              <button type="button" onClick={addRow} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer">
                <Plus className="w-3 h-3" /> Add Row
              </button>
            )}
          </div>
          {state.components.length === 0 && (
            <p className="text-gray-600 text-xs italic">No button rows — click "Add Row" to attach link buttons</p>
          )}
          {state.components.map((row, ri) => (
            <ButtonRowEditor
              key={ri}
              row={row}
              rowIndex={ri}
              onChange={(updated) => updateRow(ri, updated)}
              onRemoveRow={() => removeRow(ri)}
            />
          ))}
        </GlassCard>

        {/* Reactions */}
        <GlassCard className="p-5">
          <ReactionsEditor reactions={state.reactions} onChange={setReactions} />
        </GlassCard>

        {/* Presets */}
        <GlassCard className="p-5">
          <PresetManager state={state} onLoad={handleLoadPreset} />
        </GlassCard>

        {/* Feedback + Actions */}
        <GlassCard className="p-5 space-y-3">
          {feedback && (
            <div className={`rounded-xl px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
              {feedback.message}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button color="primary" size="md" iconLeading={Send01} isLoading={sending} isDisabled={sending || !hasAnyContent(state)} onClick={handleSend}>
              {sending ? 'Sending...' : 'Send Announcement'}
            </Button>
            <Button color="tertiary" size="md" iconLeading={Trash01} isDisabled={sending} onClick={handleClear}>
              Clear All
            </Button>
          </div>
        </GlassCard>
      </div>

      {/* ── Preview Column ── */}
      <div className="lg:sticky lg:top-28 space-y-4">
        <GlassCard className="p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Live Preview</h3>
          <div className="bg-[#36393f] rounded-lg p-4 min-h-[200px]">
            {/* Bot avatar + name */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">TB</div>
              <div>
                <span className="text-white text-sm font-semibold">TrueBeast</span>
                <span className="ml-1.5 bg-[#5865f2] text-[10px] font-semibold text-white px-1 py-px rounded">BOT</span>
              </div>
            </div>
            <DiscordPreview state={state} />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder Tabs
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Tab Items
// ═══════════════════════════════════════════════════════════════════════════

const TAB_ITEMS = [
  { id: 'announcements', label: 'Announcements' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'analytics', label: 'Analytics' },
];

// ═══════════════════════════════════════════════════════════════════════════
// Admin Dashboard
// ═══════════════════════════════════════════════════════════════════════════

function AdminDashboard() {
  const { user, logout } = useAuth();

  return (
    <PageLayout gradientVariant="green" title="Admin Panel | TrueBeast">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold font-display text-white">Admin Panel</h1>
            <p className="text-gray-400 text-sm mt-1">
              Signed in as <span className="text-green-400">{user?.email}</span>
            </p>
          </div>
          <Button color="tertiary" size="sm" iconLeading={LogOut01} onClick={logout}>Sign Out</Button>
        </div>

        <Tabs>
          <TabList items={TAB_ITEMS} type="underline" size="md" className="mb-6">
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

          <TabPanel id="announcements" className="mt-2"><AnnouncementsTab /></TabPanel>
          <TabPanel id="tickets" className="mt-2"><PlaceholderTab icon={MessageSquare01} label="Tickets" /></TabPanel>
          <TabPanel id="reviews" className="mt-2"><PlaceholderTab icon={Star01} label="Reviews" /></TabPanel>
          <TabPanel id="analytics" className="mt-2"><PlaceholderTab icon={BarChart01} label="Analytics" /></TabPanel>
        </Tabs>
      </div>
    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Root Export — Auth Gate
// ═══════════════════════════════════════════════════════════════════════════

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
