import { useState, useCallback, useEffect, useRef, type FormEvent, createContext, useContext } from 'react';
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
  Hash01,
  AtSign,
} from '@untitledui/icons';
import { Tabs, TabList, TabPanel, Tab } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { GlassCard } from '@/components/shared/GlassCard';
import PageLayout from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { FirebaseDB } from '@/lib/firebase';
import { SITE_CONFIG } from '@/config';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface EmbedField { name: string; value: string; inline: boolean }
interface EmbedAuthor { name: string; icon_url: string; url: string }
interface EmbedFooter { text: string; icon_url: string; timestamp: string }
interface EmbedData {
  _id: string; _open: boolean; color: string; title: string; url: string;
  description: string; author: EmbedAuthor; fields: EmbedField[];
  image: string; thumbnail: string; footer: EmbedFooter;
}
interface ButtonData { label: string; url: string; emoji: string }
interface ComposerState {
  content: string; embeds: EmbedData[]; components: ButtonData[][];
  reactions: string[];
}
interface BackupData {
  id: string; name: string; state: ComposerState;
  createdAt: string; updatedAt?: string; [key: string]: unknown;
}
interface DiscordChannel { id: string; name: string; type: number; position: number }
interface DiscordEmoji { id: string; name: string; animated: boolean }
interface DiscordRole { id: string; name: string; color: number }
interface DiscordMember { user: { id: string; username: string; global_name?: string }; nick?: string }
type Feedback = { type: 'success' | 'error'; message: string } | null;

// ═══════════════════════════════════════════════════════════════════════════
// Bot Context — shared Discord bot data across components
// ═══════════════════════════════════════════════════════════════════════════

interface BotData {
  ready: boolean; loading: boolean;
  channels: DiscordChannel[]; emojis: DiscordEmoji[];
  roles: DiscordRole[]; members: Record<string, string>;
  fetch: () => Promise<void>;
}

const BotCtx = createContext<BotData>({
  ready: false, loading: false,
  channels: [], emojis: [], roles: [], members: {},
  fetch: async () => {},
});

function BotProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [emojis, setEmojis] = useState<DiscordEmoji[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const base = SITE_CONFIG.email.workerUrl.replace(/\/+$/, '');

  const fetchBot = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    try {
      const [chRes, emRes, roRes, mbRes] = await Promise.all([
        fetch(base + '/discord/channels').then((r) => r.json()),
        fetch(base + '/discord/emojis').then((r) => r.json()),
        fetch(base + '/discord/roles').then((r) => r.json()),
        fetch(base + '/discord/members').then((r) => r.json()),
      ]);
      if (Array.isArray(chRes)) {
        const textChannels = chRes
          .filter((c: any) => c.type === 0 || c.type === 5)
          .sort((a: any, b: any) => a.position - b.position);
        setChannels(textChannels);
      }
      if (Array.isArray(emRes)) setEmojis(emRes);
      if (Array.isArray(roRes)) setRoles(roRes.filter((r: any) => r.id !== roRes.find((x: any) => x.name === '@everyone')?.id));
      if (Array.isArray(mbRes)) {
        const map: Record<string, string> = {};
        mbRes.forEach((m: any) => {
          const id = m.user?.id;
          if (id) map[id] = m.nick || m.user?.global_name || m.user?.username || id;
        });
        setMembers(map);
      }
      setReady(true);
    } catch (err) {
      console.warn('Bot fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [base]);

  // Auto-fetch on mount
  useEffect(() => { fetchBot(); }, [fetchBot]);

  return (
    <BotCtx.Provider value={{ ready, loading, channels, emojis, roles, members, fetch: fetchBot }}>
      {children}
    </BotCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CHANNEL_KEY = 'tb_dc_channel_id';
const DEFAULT_COLOR = '#5865f2';
const MAX_EMBEDS = 10;
const MAX_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_REACTIONS = 20;

const inp = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-colors';
const inpSm = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-xs focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-colors';
const lbl = 'block text-sm font-medium text-gray-300 mb-1.5';
const subLbl = 'block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wider';

const UNICODE_EMOJI: { name: string; emojis: string[] }[] = [
  { name: 'Reactions', emojis: ['👍','👎','❤️','🔥','🎉','💯','✅','❌','⭐','💀','😂','🤔','👀','🙏','💪','🫡'] },
  { name: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🫣','🤗','🤭','🫢','🫡','🤫','🤥','😶','😐','😑','😬','🫠','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🫥','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠'] },
  { name: 'Gestures', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🫰','💅','🤳','💪'] },
  { name: 'Gaming', emojis: ['🎮','🕹️','🎯','🏆','🥇','🥈','🥉','🎲','♟️','🎰','🧩','🎪','🎫','🎟️','🎭','🃏','🀄','🎴','🔫','💣','🗡️','⚔️','🛡️','🧨'] },
  { name: 'Objects', emojis: ['💻','🖥️','⌨️','🖱️','💾','📱','🔔','🔊','📢','📣','🔗','⚙️','🛠️','🔧','📌','🏷️','🎵','🎶','🎤','🎧','📻','🎸','🎹','🥁','🎺','🎻','💰','💎','💡','🔦','📷','📹','🎬','📺','📻'] },
  { name: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','⭐','🌟','✨','💫','🔥','💥','💢','💦','💨','🕳️','💤','🎵','🎶','✅','❌','⭕','❗','❓','💲','♻️','🔰','⚠️','🚫','📛'] },
  { name: 'Flags & Nature', emojis: ['🌍','🌎','🌏','🌐','🗺️','🌋','🏔️','🌈','🌊','🌸','🌺','🌻','🌹','🌷','🌱','🌲','🌳','🍀','🍁','🍂','🍃','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function uid() { return Math.random().toString(36).slice(2, 10); }

function newEmbed(): EmbedData {
  return { _id: uid(), _open: true, color: DEFAULT_COLOR, title: '', url: '', description: '',
    author: { name: '', icon_url: '', url: '' }, fields: [], image: '', thumbnail: '',
    footer: { text: '', icon_url: '', timestamp: '' } };
}

function newButton(): ButtonData { return { label: '', url: '', emoji: '' }; }

function emptyState(): ComposerState {
  return { content: '', embeds: [newEmbed()], components: [], reactions: [] };
}

function hasAnyContent(s: ComposerState): boolean {
  return !!(s.content.trim() || s.embeds.some((e) => e.title.trim() || e.description.trim() || e.image.trim())
    || s.components.some((r) => r.some((b) => b.url.trim() && (b.label.trim() || b.emoji))));
}

function buildPayload(state: ComposerState) {
  const p: Record<string, unknown> = {};
  if (state.content.trim()) p.content = state.content;
  const embeds = state.embeds.map((e) => {
    const em: Record<string, unknown> = {};
    if (e.title.trim()) em.title = e.title;
    if (e.url.trim()) em.url = e.url;
    if (e.description.trim()) em.description = e.description;
    em.color = parseInt(e.color.replace('#', ''), 16);
    if (e.author.name.trim()) { const a: any = { name: e.author.name }; if (e.author.icon_url.trim()) a.icon_url = e.author.icon_url; if (e.author.url.trim()) a.url = e.author.url; em.author = a; }
    const fields = e.fields.filter((f) => f.name.trim() || f.value.trim());
    if (fields.length) em.fields = fields.map((f) => ({ name: f.name, value: f.value, inline: !!f.inline }));
    if (e.image.trim()) em.image = { url: e.image };
    if (e.thumbnail.trim()) em.thumbnail = { url: e.thumbnail };
    if (e.footer.text.trim() || e.footer.timestamp) {
      if (e.footer.text.trim()) { em.footer = { text: e.footer.text, ...(e.footer.icon_url.trim() ? { icon_url: e.footer.icon_url } : {}) }; }
      if (e.footer.timestamp) em.timestamp = new Date(e.footer.timestamp).toISOString();
    }
    return Object.keys(em).filter((k) => k !== 'color').length ? em : null;
  }).filter(Boolean);
  if (embeds.length) p.embeds = embeds;
  const components = state.components.map((row) => {
    const btns = row.filter((b) => b.url.trim() && (b.label.trim() || b.emoji)).map((b) => {
      const btn: any = { type: 2, style: 5, url: b.url };
      if (b.label.trim()) btn.label = b.label;
      if (b.emoji) {
        const m = b.emoji.match(/^(.+):(\d+)$/);
        if (m) btn.emoji = { name: m[1], id: m[2] };
        else btn.emoji = { name: b.emoji };
      }
      return btn;
    });
    return btns.length ? { type: 1, components: btns } : null;
  }).filter(Boolean);
  if (components.length) p.components = components;
  return p;
}

// Format reactions for Discord API
function formatReaction(r: string): string {
  // Custom emoji: name:id → name:id (URL encoded by the worker)
  // Unicode emoji: sent as-is
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// Discord Markdown Renderer
// ═══════════════════════════════════════════════════════════════════════════

function renderDiscordMarkdown(text: string, bot: BotData): string {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Custom emoji: <:name:id> or <a:name:id>
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_m, animated, name, id) => {
      const ext = animated ? 'gif' : 'png';
      return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=24" alt=":${name}:" title=":${name}:" class="inline-block w-5 h-5 align-text-bottom" />`;
    })
    // User mentions: <@id> or <@!id>
    .replace(/&lt;@!?(\d+)&gt;/g, (_m, id) => {
      const name = bot.members[id] || 'user';
      return `<span class="bg-[#5865f2]/30 text-[#dee0fc] rounded px-1">@${name}</span>`;
    })
    // Role mentions: <@&id>
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_m, id) => {
      const role = bot.roles.find((r) => r.id === id);
      const name = role?.name || 'role';
      const color = role?.color ? `#${('000000' + role.color.toString(16)).slice(-6)}` : '#5865f2';
      return `<span style="color:${color};background:${color}22" class="rounded px-1">@${name}</span>`;
    })
    // Channel mentions: <#id>
    .replace(/&lt;#(\d+)&gt;/g, (_m, id) => {
      const ch = bot.channels.find((c) => c.id === id);
      return `<span class="bg-[#5865f2]/30 text-[#dee0fc] rounded px-1">#${ch?.name || 'channel'}</span>`;
    })
    // Bold italic: ***text***
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold: **text**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Underline: __text__
    .replace(/__(.+?)__/g, '<u>$1</u>')
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '<code class="bg-[#2f3136] text-[#e8912d] px-1 rounded text-xs">$1</code>')
    // Spoiler: ||text||
    .replace(/\|\|(.+?)\|\|/g, '<span class="bg-gray-600 text-gray-600 hover:text-gray-200 rounded px-0.5 transition-colors cursor-pointer">$1</span>')
    // Blockquote: > text
    .replace(/^&gt; (.+)$/gm, '<div class="border-l-3 border-gray-500 pl-2 text-gray-400">$1</div>')
    // Newlines
    .replace(/\n/g, '<br>');
  return html;
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
    try { await login(email, password); }
    catch (err: any) { setError(err?.message ?? 'Login failed.'); }
    finally { setLoading(false); }
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
              <label htmlFor="admin-email" className={lbl}>Email</label>
              <input id="admin-email" type="email" required placeholder="admin@truebeast.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inp} autoComplete="email" />
            </div>
            <div>
              <label htmlFor="admin-password" className={lbl}>Password</label>
              <input id="admin-password" type="password" required placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} className={inp} autoComplete="current-password" />
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors text-sm"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </GlassCard>
      </div>
    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Rich Picker (Emoji + Mentions + Images)
// ═══════════════════════════════════════════════════════════════════════════

type PickerMode = 'emoji' | 'mention';

function RichPicker({
  onInsert,
  onClose,
  modes = ['emoji'],
  allowCustom = true,
  anchor = 'left',
}: {
  onInsert: (text: string) => void;
  onClose: () => void;
  modes?: PickerMode[];
  allowCustom?: boolean;
  anchor?: 'left' | 'right';
}) {
  const bot = useContext(BotCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PickerMode>(modes[0]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filteredEmojis = bot.emojis.filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()));
  const filteredRoles = bot.roles.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const filteredChannels = bot.channels.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} className={`absolute z-50 top-full mt-1 bg-[#1e1f22] border border-white/10 rounded-xl shadow-2xl w-80 max-h-80 flex flex-col overflow-hidden ${anchor === 'right' ? 'right-0' : 'left-0'}`}>
      {/* Tabs */}
      {modes.length > 1 && (
        <div className="flex border-b border-white/10 flex-shrink-0">
          {modes.map((m) => (
            <button key={m} type="button" onClick={() => { setTab(m); setSearch(''); }}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${tab === m ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-500 hover:text-gray-300'}`}>
              {m === 'emoji' ? 'Emojis' : 'Mentions'}
            </button>
          ))}
        </div>
      )}
      {/* Search */}
      <div className="p-2 flex-shrink-0">
        <input type="text" placeholder={`Search ${tab}...`} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none" autoFocus />
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 pt-0">
        {tab === 'emoji' && (
          <>
            {/* Server emojis */}
            {allowCustom && filteredEmojis.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1">Server Emojis</p>
                <div className="flex flex-wrap gap-0.5">
                  {filteredEmojis.map((em) => (
                    <button key={em.id} type="button" title={`:${em.name}:`}
                      onClick={() => { onInsert(`<${em.animated ? 'a' : ''}:${em.name}:${em.id}>`); onClose(); }}
                      className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors cursor-pointer">
                      <img src={`https://cdn.discordapp.com/emojis/${em.id}.${em.animated ? 'gif' : 'png'}?size=32`} alt={em.name} className="w-6 h-6" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Unicode categories */}
            {UNICODE_EMOJI.map((cat) => {
              const filtered = cat.emojis.filter((e) => !search || e.includes(search) || cat.name.toLowerCase().includes(search.toLowerCase()));
              if (!filtered.length) return null;
              return (
                <div key={cat.name} className="mb-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1">{cat.name}</p>
                  <div className="flex flex-wrap gap-0.5">
                    {filtered.map((em) => (
                      <button key={em} type="button" onClick={() => { onInsert(em); onClose(); }}
                        className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-lg transition-colors cursor-pointer">{em}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === 'mention' && (
          <>
            {/* Channels */}
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1">Channels</p>
            {filteredChannels.map((c) => (
              <button key={c.id} type="button" onClick={() => { onInsert(`<#${c.id}>`); onClose(); }}
                className="w-full text-left px-2 py-1 rounded text-xs text-gray-300 hover:bg-white/10 flex items-center gap-1.5 transition-colors cursor-pointer">
                <Hash01 className="w-3 h-3 text-gray-500" /> {c.name}
                {c.type === 5 && <span className="text-[10px] text-yellow-500 ml-auto">announce</span>}
              </button>
            ))}
            {/* Roles */}
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1 mt-2">Roles</p>
            {filteredRoles.map((r) => {
              const color = r.color ? `#${('000000' + r.color.toString(16)).slice(-6)}` : '#99aab5';
              return (
                <button key={r.id} type="button" onClick={() => { onInsert(`<@&${r.id}>`); onClose(); }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-white/10 flex items-center gap-1.5 transition-colors cursor-pointer" style={{ color }}>
                  <AtSign className="w-3 h-3" /> {r.name}
                </button>
              );
            })}
          </>
        )}

      </div>
    </div>
  );
}

// Simpler emoji-only picker for buttons/reactions
function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string, isCustom?: boolean) => void; onClose: () => void }) {
  const bot = useContext(BotCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 top-full left-0 mt-1 bg-[#1e1f22] border border-white/10 rounded-xl shadow-2xl p-2 w-72 max-h-64 flex flex-col overflow-hidden">
      <input type="text" placeholder="Search emoji..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none mb-2" autoFocus />
      <div className="flex-1 overflow-y-auto">
        {/* Server emojis */}
        {bot.emojis.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Server</p>
            <div className="flex flex-wrap gap-0.5">
              {bot.emojis.filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase())).map((em) => (
                <button key={em.id} type="button" title={`:${em.name}:`}
                  onClick={() => { onPick(`${em.name}:${em.id}`, true); onClose(); }}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors cursor-pointer">
                  <img src={`https://cdn.discordapp.com/emojis/${em.id}.${em.animated ? 'gif' : 'png'}?size=32`} alt={em.name} className="w-6 h-6" />
                </button>
              ))}
            </div>
          </div>
        )}
        {UNICODE_EMOJI.map((cat) => {
          const filtered = cat.emojis.filter((e) => !search || e.includes(search) || cat.name.toLowerCase().includes(search.toLowerCase()));
          if (!filtered.length) return null;
          return (
            <div key={cat.name} className="mb-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{cat.name}</p>
              <div className="flex flex-wrap gap-0.5">
                {filtered.map((em) => (
                  <button key={em} type="button" onClick={() => { onPick(em); onClose(); }}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-lg transition-colors cursor-pointer">{em}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Image Picker Button (URL input + upload + library)
// ═══════════════════════════════════════════════════════════════════════════

function ImageInput({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  return (
    <div>
      {label && <label className={subLbl}>{label}</label>}
      <input type="url" placeholder={placeholder || 'Paste image URL'} value={value} onChange={(e) => onChange(e.target.value)} className={inpSm} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Textarea with Rich Picker button
// ═══════════════════════════════════════════════════════════════════════════

function RichTextarea({ value, onChange, label, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; rows?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) { onChange(value + text); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    onChange(before + text + after);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className={subLbl + ' mb-0'}>{label}</label>
        <div className="relative">
          <button type="button" onClick={() => setPickerOpen(!pickerOpen)}
            className="text-gray-500 hover:text-green-400 transition-colors cursor-pointer p-0.5" title="Insert emoji or mention">
            <FaceSmile className="w-4 h-4" />
          </button>
          {pickerOpen && <RichPicker modes={['emoji', 'mention']} onInsert={insertAtCursor} onClose={() => setPickerOpen(false)} />}
        </div>
      </div>
      <textarea ref={textareaRef} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className={inpSm + ' resize-y'} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Discord Preview
// ═══════════════════════════════════════════════════════════════════════════

function DiscordPreview({ state }: { state: ComposerState }) {
  const bot = useContext(BotCtx);
  const hasEmbeds = state.embeds.some((e) => e.title.trim() || e.description.trim() || e.image.trim() || e.thumbnail.trim() || e.author.name.trim() || e.fields.length > 0 || e.footer.text.trim());
  const hasButtons = state.components.some((r) => r.some((b) => b.url.trim() && (b.label.trim() || b.emoji)));
  const hasAnything = state.content.trim() || hasEmbeds || hasButtons || state.reactions.length > 0;

  if (!hasAnything) return <div className="text-gray-500 text-sm italic text-center py-8">Start typing to see a preview...</div>;

  const renderEmoji = (emojiStr: string) => {
    // Handle name:id, or bare numeric ID (legacy)
    const m = emojiStr.match(/(?:(.+):)?(\d{15,})$/);
    if (m) {
      const eid = m[2];
      const em = bot.emojis.find((e) => e.id === eid);
      const ext = em?.animated ? 'gif' : 'png';
      return <img src={`https://cdn.discordapp.com/emojis/${eid}.${ext}?size=20`} alt={m[1] || 'emoji'} className="w-4 h-4 inline-block" />;
    }
    return <span>{emojiStr}</span>;
  };

  return (
    <div className="space-y-2">
      {state.content.trim() && (
        <div className="text-gray-200 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(state.content, bot) }} />
      )}
      {state.embeds.map((e) => {
        const has = e.title.trim() || e.description.trim() || e.image.trim() || e.thumbnail.trim() || e.author.name.trim() || e.fields.length > 0 || e.footer.text.trim() || e.footer.timestamp;
        if (!has) return null;
        return (
          <div key={e._id} className="flex rounded overflow-hidden max-w-lg">
            <div className="w-1 flex-shrink-0 rounded-l" style={{ backgroundColor: e.color }} />
            <div className="bg-[#2f3136] rounded-r p-3 flex-1 min-w-0">
              <div className="flex gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  {e.author.name.trim() && (
                    <div className="flex items-center gap-1.5">
                      {e.author.icon_url.trim() && <img src={e.author.icon_url} alt="" className="w-5 h-5 rounded-full" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />}
                      <span className="text-white text-xs font-semibold">{e.author.name}</span>
                    </div>
                  )}
                  {e.title.trim() && (
                    <h4 className="text-white font-semibold text-sm leading-snug break-words">
                      {e.url.trim() ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[#00aff4] hover:underline">{e.title}</a> : e.title}
                    </h4>
                  )}
                  {e.description.trim() && (
                    <div className="text-gray-300 text-[13px] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(e.description, bot) }} />
                  )}
                  {e.fields.length > 0 && (
                    <div className="grid gap-1.5 mt-1" style={{ gridTemplateColumns: e.fields.some((f) => f.inline) ? 'repeat(3, 1fr)' : '1fr' }}>
                      {e.fields.map((f, fi) => (
                        <div key={fi} style={{ gridColumn: f.inline ? undefined : '1 / -1' }}>
                          {f.name.trim() && <p className="text-white text-xs font-semibold">{f.name}</p>}
                          {f.value.trim() && <div className="text-gray-300 text-xs" dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(f.value, bot) }} />}
                        </div>
                      ))}
                    </div>
                  )}
                  {e.image.trim() && <img src={e.image} alt="" className="max-w-full max-h-64 rounded mt-1" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />}
                  {(e.footer.text.trim() || e.footer.timestamp) && (
                    <div className="flex items-center gap-1.5 pt-1 text-gray-400 text-[11px]">
                      {e.footer.icon_url.trim() && <img src={e.footer.icon_url} alt="" className="w-4 h-4 rounded-full" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />}
                      {e.footer.text.trim() && <span>{e.footer.text}</span>}
                      {e.footer.text.trim() && e.footer.timestamp && <span className="opacity-50">•</span>}
                      {e.footer.timestamp && <span>{new Date(e.footer.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
                    </div>
                  )}
                </div>
                {e.thumbnail.trim() && <img src={e.thumbnail} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }} />}
              </div>
            </div>
          </div>
        );
      })}
      {hasButtons && (
        <div className="space-y-1">
          {state.components.map((row, ri) => {
            const valid = row.filter((b) => b.url.trim() && (b.label.trim() || b.emoji));
            if (!valid.length) return null;
            return (
              <div key={ri} className="flex flex-wrap gap-1">
                {valid.map((b, bi) => (
                  <span key={bi} className="inline-flex items-center gap-1.5 bg-[#4f545c] text-white text-xs font-medium px-3 py-1.5 rounded">
                    {b.emoji && renderEmoji(b.emoji)}
                    {b.label && <span>{b.label}</span>}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-60"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {state.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {state.reactions.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-[#2f3136] border border-[#5865f2]/40 text-xs rounded-full px-2 py-0.5">
              {renderEmoji(r)}
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

function EmbedEditor({ embed, index, total, onChange, onRemove, onToggle }: {
  embed: EmbedData; index: number; total: number;
  onChange: (u: EmbedData) => void; onRemove: () => void; onToggle: () => void;
}) {
  const set = (key: keyof EmbedData, val: any) => onChange({ ...embed, [key]: val });
  const setAuthor = (key: keyof EmbedAuthor, val: string) => onChange({ ...embed, author: { ...embed.author, [key]: val } });
  const setFooter = (key: keyof EmbedFooter, val: string) => onChange({ ...embed, footer: { ...embed.footer, [key]: val } });
  const setField = (fi: number, key: keyof EmbedField, val: any) => { const f = [...embed.fields]; f[fi] = { ...f[fi], [key]: val }; onChange({ ...embed, fields: f }); };
  const addField = () => onChange({ ...embed, fields: [...embed.fields, { name: '', value: '', inline: false }] });
  const removeField = (fi: number) => onChange({ ...embed, fields: embed.fields.filter((_, i) => i !== fi) });

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: embed.color }} />
          <span className="text-sm font-medium text-gray-200">Embed {total > 1 ? `#${index + 1}` : ''}{embed.title.trim() ? ` — ${embed.title.slice(0, 30)}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {total > 1 && <span onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-gray-500 hover:text-red-400 transition-colors p-1"><XClose className="w-4 h-4" /></span>}
          {embed._open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>
      {embed._open && (
        <div className="p-4 space-y-4 border-t border-white/5">
          <div className="flex gap-3 items-end">
            <div className="flex-shrink-0"><label className={subLbl}>Color</label><input type="color" value={embed.color} onChange={(e) => set('color', e.target.value)} className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none" /></div>
            <div className="flex-1"><label className={subLbl}>Title</label><input type="text" placeholder="Embed title" value={embed.title} onChange={(e) => set('title', e.target.value)} className={inpSm} /></div>
            <div className="flex-1"><label className={subLbl}>Title URL</label><input type="url" placeholder="https://..." value={embed.url} onChange={(e) => set('url', e.target.value)} className={inpSm} /></div>
          </div>
          <div>
            <label className={subLbl}>Author</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" placeholder="Name" value={embed.author.name} onChange={(e) => setAuthor('name', e.target.value)} className={inpSm} />
              <ImageInput value={embed.author.icon_url} onChange={(v) => setAuthor('icon_url', v)} label="" placeholder="Icon URL" />
              <input type="url" placeholder="Author URL" value={embed.author.url} onChange={(e) => setAuthor('url', e.target.value)} className={inpSm} />
            </div>
          </div>
          <RichTextarea value={embed.description} onChange={(v) => set('description', v)} label="Description" placeholder="Embed description (supports Discord markdown)" rows={3} />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={subLbl + ' mb-0'}>Fields</label>
              <button type="button" onClick={addField} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Add Field</button>
            </div>
            {embed.fields.length === 0 && <p className="text-gray-600 text-xs italic">No fields</p>}
            {embed.fields.map((f, fi) => (
              <div key={fi} className="flex gap-2 items-start mb-2">
                <div className="flex-1 min-w-0">
                  <input type="text" placeholder="Field name" value={f.name} onChange={(e) => setField(fi, 'name', e.target.value)} className={inpSm + ' mb-1'} />
                  <textarea placeholder="Field value" value={f.value} onChange={(e) => setField(fi, 'value', e.target.value)} rows={2} className={inpSm + ' resize-y'} />
                </div>
                <div className="flex flex-col items-center gap-1 pt-1">
                  <label className="flex items-center gap-1 cursor-pointer select-none" title="Inline"><input type="checkbox" checked={f.inline} onChange={(e) => setField(fi, 'inline', e.target.checked)} className="w-3 h-3 accent-green-500 cursor-pointer" /><span className="text-[10px] text-gray-500">Inline</span></label>
                  <button type="button" onClick={() => removeField(fi)} className="text-gray-500 hover:text-red-400 transition-colors cursor-pointer p-0.5"><Minus className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ImageInput value={embed.image} onChange={(v) => set('image', v)} label="Image URL" placeholder="Large image URL" />
            <ImageInput value={embed.thumbnail} onChange={(v) => set('thumbnail', v)} label="Thumbnail URL" placeholder="Small image (right)" />
          </div>
          <div>
            <label className={subLbl}>Footer</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="text" placeholder="Footer text" value={embed.footer.text} onChange={(e) => setFooter('text', e.target.value)} className={inpSm} />
              <ImageInput value={embed.footer.icon_url} onChange={(v) => setFooter('icon_url', v)} label="" placeholder="Footer icon URL" />
            </div>
            <div><label className={subLbl}>Timestamp</label><input type="datetime-local" value={embed.footer.timestamp} onChange={(e) => setFooter('timestamp', e.target.value)} className={inpSm} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Button Row Editor
// ═══════════════════════════════════════════════════════════════════════════

function ButtonRowEditor({ row, rowIndex, onChange, onRemoveRow }: { row: ButtonData[]; rowIndex: number; onChange: (u: ButtonData[]) => void; onRemoveRow: () => void }) {
  const setBtn = (bi: number, key: keyof ButtonData, val: string) => { const u = [...row]; u[bi] = { ...u[bi], [key]: val }; onChange(u); };
  const addBtn = () => { if (row.length < MAX_BUTTONS_PER_ROW) onChange([...row, newButton()]); };
  const removeBtn = (bi: number) => { const u = row.filter((_, i) => i !== bi); if (!u.length) onRemoveRow(); else onChange(u); };

  return (
    <div className="border border-white/5 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Row {rowIndex + 1}</span>
        <div className="flex items-center gap-2">
          {row.length < MAX_BUTTONS_PER_ROW && <button type="button" onClick={addBtn} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-0.5 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Button</button>}
          <button type="button" onClick={onRemoveRow} className="text-xs text-gray-500 hover:text-red-400 transition-colors cursor-pointer"><XClose className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {row.map((btn, bi) => <SingleButtonEditor key={bi} btn={btn} onChange={(k, v) => setBtn(bi, k, v)} onRemove={() => removeBtn(bi)} />)}
    </div>
  );
}

function SingleButtonEditor({ btn, onChange, onRemove }: { btn: ButtonData; onChange: (k: keyof ButtonData, v: string) => void; onRemove: () => void }) {
  const bot = useContext(BotCtx);
  const [pickerOpen, setPickerOpen] = useState(false);

  const renderBtnEmoji = () => {
    if (!btn.emoji) return <FaceSmile className="w-4 h-4 text-gray-500" />;
    // Custom emoji: name:id OR just a numeric ID (legacy)
    const m = btn.emoji.match(/(?:(.+):)?(\d{15,})$/);
    if (m) {
      const eid = m[2];
      const em = bot.emojis.find((e) => e.id === eid);
      const ext = em?.animated ? 'gif' : 'png';
      return <img src={`https://cdn.discordapp.com/emojis/${eid}.${ext}?size=32`} alt={m[1] || 'emoji'} className="w-5 h-5" />;
    }
    return <span className="text-lg leading-none">{btn.emoji}</span>;
  };

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-shrink-0">
        <button type="button" onClick={() => setPickerOpen(!pickerOpen)} className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer overflow-hidden" title="Pick emoji">
          {renderBtnEmoji()}
        </button>
        {btn.emoji && <button type="button" onClick={() => onChange('emoji', '')} className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer"><XClose className="w-2 h-2" /></button>}
        {pickerOpen && <EmojiPicker onPick={(em) => onChange('emoji', em)} onClose={() => setPickerOpen(false)} />}
      </div>
      <input type="text" placeholder="Label" value={btn.label} onChange={(e) => onChange('label', e.target.value)} className={inpSm + ' !w-32'} />
      <input type="url" placeholder="https://..." value={btn.url} onChange={(e) => onChange('url', e.target.value)} className={inpSm} />
      <button type="button" onClick={onRemove} className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0 cursor-pointer"><Minus className="w-4 h-4" /></button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Reactions Editor
// ═══════════════════════════════════════════════════════════════════════════

function ReactionsEditor({ reactions, onChange }: { reactions: string[]; onChange: (u: string[]) => void }) {
  const bot = useContext(BotCtx);
  const [pickerOpen, setPickerOpen] = useState(false);
  const add = (emoji: string) => { if (reactions.length < MAX_REACTIONS && !reactions.includes(emoji)) onChange([...reactions, emoji]); };
  const remove = (i: number) => onChange(reactions.filter((_, idx) => idx !== i));

  const renderEmoji = (r: string) => {
    const m = r.match(/(?:(.+):)?(\d{15,})$/);
    if (m) {
      const eid = m[2];
      const em = bot.emojis.find((e) => e.id === eid);
      return <img src={`https://cdn.discordapp.com/emojis/${eid}.${em?.animated ? 'gif' : 'png'}?size=20`} alt={m[1] || 'emoji'} className="w-4 h-4" />;
    }
    return <span>{r}</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className={subLbl + ' mb-0'}>Auto Reactions ({reactions.length}/{MAX_REACTIONS})</label>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {reactions.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-sm group">
            {renderEmoji(r)}
            <button type="button" onClick={() => remove(i)} className="text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"><XClose className="w-3 h-3" /></button>
          </span>
        ))}
        {reactions.length < MAX_REACTIONS && (
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen(!pickerOpen)} className="inline-flex items-center gap-1 bg-white/5 border border-white/10 border-dashed rounded-full px-3 py-1 text-xs text-gray-400 hover:text-green-400 hover:border-green-500/30 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Add</button>
            {pickerOpen && <EmojiPicker onPick={add} onClose={() => setPickerOpen(false)} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Preset Manager
// ═══════════════════════════════════════════════════════════════════════════

function PresetManager({ state, onLoad }: { state: ComposerState; onLoad: (s: ComposerState) => void }) {
  const [backups, setBackups] = useState<BackupData[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await FirebaseDB.getAllWebhookBackups();
      setBackups(raw.map((b: any) => {
        let s: ComposerState;
        if (b.state) {
          s = b.state as ComposerState;
          if (typeof (s as any).components_json === 'string') { try { s.components = JSON.parse((s as any).components_json); } catch { s.components = []; } }
          if (!s.components) s.components = [];
          if (!s.reactions) s.reactions = [];
          if (!s.embeds) s.embeds = [newEmbed()];
        } else {
          s = emptyState();
          if (b.content) s.content = b.content;
          if (b.embeds) s.embeds = b.embeds;
          if (b.components_json) { try { s.components = JSON.parse(b.components_json); } catch { /* */ } }
          if (b.reactions) s.reactions = b.reactions;
        }
        return { id: b.id, name: b.name || 'Untitled', state: s, createdAt: b.createdAt, updatedAt: b.updatedAt };
      }));
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBackups(); }, [fetchBackups]);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 3000); return () => clearTimeout(t); }, [feedback]);

  const saveNew = async () => { const name = window.prompt('Preset name:'); if (!name?.trim()) return; setSaving(true); try { await FirebaseDB.saveWebhookBackup({ name: name.trim(), webhookUrl: '', embeds: [], state: { ...state, components: undefined as any, components_json: JSON.stringify(state.components) } as any } as any); setFeedback({ type: 'success', message: `Saved "${name.trim()}"` }); fetchBackups(); } catch (err: any) { setFeedback({ type: 'error', message: err?.message ?? 'Save failed' }); } finally { setSaving(false); } };
  const overwrite = async (b: BackupData) => { if (!window.confirm(`Overwrite "${b.name}"?`)) return; setSaving(true); try { await FirebaseDB.updateWebhookBackup(b.id, { state: { ...state, components: undefined as any, components_json: JSON.stringify(state.components) } as any } as any); setFeedback({ type: 'success', message: `Updated "${b.name}"` }); fetchBackups(); } catch (err: any) { setFeedback({ type: 'error', message: err?.message ?? 'Update failed' }); } finally { setSaving(false); } };
  const del = async (b: BackupData) => { if (!window.confirm(`Delete "${b.name}"?`)) return; try { await FirebaseDB.deleteWebhookBackup(b.id); setFeedback({ type: 'success', message: `Deleted` }); fetchBackups(); } catch (err: any) { setFeedback({ type: 'error', message: err?.message ?? 'Delete failed' }); } };
  const load = (b: BackupData) => { onLoad(b.state); setFeedback({ type: 'success', message: `Loaded "${b.name}"` }); };

  return (
    <div className="border border-white/5 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-300 flex items-center gap-1.5"><Save01 className="w-4 h-4 text-gray-400" /> Saved Presets</span>
        <div className="flex gap-2">
          <button type="button" onClick={saveNew} disabled={saving} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"><Plus className="w-3 h-3" /> Save New</button>
          <button type="button" onClick={() => { navigator.clipboard.writeText(JSON.stringify(buildPayload(state), null, 2)); setFeedback({ type: 'success', message: 'JSON copied!' }); }} className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"><Copy01 className="w-3 h-3" /> JSON</button>
          <button type="button" onClick={fetchBackups} disabled={loading} className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1 transition-colors cursor-pointer"><RefreshCw01 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>
      {feedback && <div className={`rounded-lg px-3 py-2 text-xs mb-3 ${feedback.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{feedback.message}</div>}
      {backups.length === 0 ? <p className="text-gray-600 text-xs text-center py-4">{loading ? 'Loading...' : 'No presets yet'}</p> : (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-3 py-2 group hover:bg-white/[0.04] transition-colors">
              <div className="min-w-0"><p className="text-sm text-white truncate">{b.name}</p><p className="text-[10px] text-gray-600">{new Date(b.createdAt).toLocaleDateString()}{b.updatedAt && b.updatedAt !== b.createdAt && ` (updated)`}</p></div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button type="button" onClick={() => load(b)} className="text-green-400 hover:text-green-300 p-1 transition-colors cursor-pointer" title="Load"><Download01 className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => overwrite(b)} className="text-yellow-400 hover:text-yellow-300 p-1 transition-colors cursor-pointer" title="Overwrite"><Edit03 className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => del(b)} className="text-red-400 hover:text-red-300 p-1 transition-colors cursor-pointer" title="Delete"><Trash01 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Announcements Tab
// ═══════════════════════════════════════════════════════════════════════════

function AnnouncementsTab() {
  const bot = useContext(BotCtx);
  const [channelId, setChannelId] = useState(() => localStorage.getItem(CHANNEL_KEY) ?? '');
  const [state, setState] = useState<ComposerState>(emptyState);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => { if (channelId) localStorage.setItem(CHANNEL_KEY, channelId); }, [channelId]);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }, [feedback]);

  const setContent = (content: string) => setState((s) => ({ ...s, content }));
  const updateEmbed = (i: number, e: EmbedData) => setState((s) => ({ ...s, embeds: s.embeds.map((x, idx) => idx === i ? e : x) }));
  const removeEmbed = (i: number) => setState((s) => ({ ...s, embeds: s.embeds.filter((_, idx) => idx !== i) }));
  const toggleEmbed = (i: number) => setState((s) => ({ ...s, embeds: s.embeds.map((e, idx) => idx === i ? { ...e, _open: !e._open } : e) }));
  const addEmbed = () => { if (state.embeds.length < MAX_EMBEDS) setState((s) => ({ ...s, embeds: [...s.embeds, newEmbed()] })); };
  const updateRow = (ri: number, r: ButtonData[]) => setState((s) => ({ ...s, components: s.components.map((x, i) => i === ri ? r : x) }));
  const removeRow = (ri: number) => setState((s) => ({ ...s, components: s.components.filter((_, i) => i !== ri) }));
  const addRow = () => { if (state.components.length < MAX_ROWS) setState((s) => ({ ...s, components: [...s.components, [newButton()]] })); };
  const setReactions = (reactions: string[]) => setState((s) => ({ ...s, reactions }));

  const handleClear = () => { if (!hasAnyContent(state) || window.confirm('Clear all fields?')) { setState(emptyState()); setFeedback(null); } };

  const handleLoadPreset = (preset: ComposerState) => {
    const embeds = (preset.embeds || [newEmbed()]).map((e) => ({
      ...newEmbed(), ...e, _id: e._id || uid(), _open: true,
      author: { ...newEmbed().author, ...(e.author || {}) },
      footer: { ...newEmbed().footer, ...(e.footer || {}) },
      fields: (e.fields || []).map((f) => ({ name: f.name || '', value: f.value || '', inline: !!f.inline })),
    }));
    setState({ content: preset.content || '', embeds, components: preset.components || [], reactions: preset.reactions || [] });
  };

  const base = SITE_CONFIG.email.workerUrl.replace(/\/+$/, '');

  const handleSend = async () => {
    if (!channelId) { setFeedback({ type: 'error', message: 'Select a channel first.' }); return; }
    if (!hasAnyContent(state)) { setFeedback({ type: 'error', message: 'Add some content before sending.' }); return; }
    setSending(true); setFeedback(null);
    try {
      const payload = buildPayload(state);
      const reactions = state.reactions.map(formatReaction);
      const res = await fetch(base + '/discord/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, payload, reactions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || `Discord error (${res.status})`);

      // Save to Firestore for homepage
      try {
        const firstEmbed = state.embeds[0];
        await FirebaseDB.saveAnnouncement({
          title: firstEmbed?.title || 'Announcement',
          body: firstEmbed?.description || state.content,
          content: state.content,
          embeds: (payload.embeds as Record<string, unknown>[]) || [],
        });
      } catch { console.warn('Firestore save failed'); }

      const reactionErrors = data._reactionErrors;
      setFeedback({
        type: 'success',
        message: reactionErrors?.length
          ? `Sent! (${reactionErrors.length} reaction(s) failed)`
          : 'Announcement sent successfully!',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Failed to send.' });
    } finally { setSending(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.82fr] gap-6 items-start">
      <div className="space-y-4">
        <GlassCard className="p-5 space-y-4">
          <h3 className="text-lg font-semibold font-display text-white flex items-center gap-2">
            <Bell01 className="w-5 h-5 text-green-400" /> Compose Announcement
          </h3>

          {/* Bot status + Channel picker */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Bot:</span>
              {bot.loading ? (
                <span className="text-xs text-yellow-400">Connecting...</span>
              ) : bot.ready ? (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Ready
                </span>
              ) : (
                <span className="text-xs text-gray-500">Not connected</span>
              )}
              <button type="button" onClick={bot.fetch} disabled={bot.loading}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
                <RefreshCw01 className={`w-3 h-3 ${bot.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="flex-1 min-w-[200px]">
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 cursor-pointer appearance-none">
                <option value="" className="bg-[#1e1f22]">— Select channel —</option>
                {bot.channels.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#1e1f22]">
                    {c.type === 5 ? '📢' : '#'} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <hr className="border-white/5" />

          {/* Message Content with rich picker */}
          <RichTextarea value={state.content} onChange={setContent} label="Message Content" placeholder="Text above the embed (supports Discord markdown)..." rows={3} />

          {/* Embeds */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={lbl + ' mb-0'}>Embeds ({state.embeds.length}/{MAX_EMBEDS})</label>
              {state.embeds.length < MAX_EMBEDS && (
                <button type="button" onClick={addEmbed} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Add Embed</button>
              )}
            </div>
            <div className="space-y-3">
              {state.embeds.map((embed, i) => (
                <EmbedEditor key={embed._id} embed={embed} index={i} total={state.embeds.length} onChange={(u) => updateEmbed(i, u)} onRemove={() => removeEmbed(i)} onToggle={() => toggleEmbed(i)} />
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Link Buttons */}
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5"><Link01 className="w-4 h-4 text-gray-400" /> Link Buttons ({state.components.length}/{MAX_ROWS})</h4>
            {state.components.length < MAX_ROWS && <button type="button" onClick={addRow} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Add Row</button>}
          </div>
          {state.components.length === 0 && <p className="text-gray-600 text-xs italic">No button rows</p>}
          {state.components.map((row, ri) => <ButtonRowEditor key={ri} row={row} rowIndex={ri} onChange={(u) => updateRow(ri, u)} onRemoveRow={() => removeRow(ri)} />)}
        </GlassCard>

        <GlassCard className="p-5"><ReactionsEditor reactions={state.reactions} onChange={setReactions} /></GlassCard>
        <GlassCard className="p-5"><PresetManager state={state} onLoad={handleLoadPreset} /></GlassCard>
      </div>

      {/* Preview + Send/Clear */}
      <div className="lg:sticky lg:top-28 space-y-4">
        <GlassCard className="p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Live Preview</h3>
          <div className="bg-[#36393f] rounded-lg p-4 min-h-[200px]">
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

        {/* Send / Clear */}
        <div className="space-y-3">
          {feedback && <div className={`rounded-xl px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{feedback.message}</div>}
          <div className="flex items-center gap-3">
            <button type="button" disabled={sending} onClick={handleClear}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl text-sm font-semibold border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-50 transition-all cursor-pointer">
              <Trash01 className="w-4 h-4" /> Clear All
            </button>
            <button type="button" disabled={sending || !hasAnyContent(state) || !channelId} onClick={handleSend}
              className="flex-[2] flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-bold bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20 hover:shadow-green-500/30 disabled:opacity-40 disabled:shadow-none transition-all cursor-pointer">
              {sending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send01 className="w-4 h-4" />
              )}
              {sending ? 'Sending...' : 'Send Announcement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder Tabs & Dashboard
// ═══════════════════════════════════════════════════════════════════════════

function PlaceholderTab({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <GlassCard className="p-12 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4"><Icon className="w-8 h-8 text-gray-500" /></div>
      <h3 className="text-xl font-semibold font-display text-white mb-2">{label}</h3>
      <p className="text-gray-400 text-sm max-w-md">Coming soon.</p>
    </GlassCard>
  );
}

const TAB_ITEMS = [
  { id: 'announcements', label: 'Announcements' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'analytics', label: 'Analytics' },
];

function AdminDashboard() {
  const { user, logout } = useAuth();
  return (
    <PageLayout gradientVariant="green" title="Admin Panel | TrueBeast">
      <BotProvider>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold font-display text-white">Admin Panel</h1>
              <p className="text-gray-400 text-sm mt-1">Signed in as <span className="text-green-400">{user?.email}</span></p>
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
      </BotProvider>
    </PageLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Root Export
// ═══════════════════════════════════════════════════════════════════════════

export default function Admin() {
  const { user, loading } = useAuth();
  if (loading) return (
    <PageLayout gradientVariant="green" title="Admin Panel | TrueBeast">
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </PageLayout>
  );
  if (!user) return <LoginScreen />;
  return <AdminDashboard />;
}
