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
  Users01,
  ShieldTick,
  Image01,
} from '@untitledui/icons';
import { Tabs, TabList, TabPanel, Tab } from '@/components/application/tabs/tabs';
import { Button } from '@/components/base/buttons/button';
import { GlassCard } from '@/components/shared/GlassCard';
import PageLayout from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { FirebaseDB, type CardSaveRecord } from '@/lib/firebase';
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
const CARD_GRADIENT_PRESETS = [
  { label: 'Teal',   from: '#1a2744', to: '#0d3d52' },
  { label: 'Green',  from: '#0d2e1c', to: '#0a4020' },
  { label: 'Purple', from: '#1a1244', to: '#2d0d52' },
  { label: 'Orange', from: '#2e1a0d', to: '#522d0a' },
  { label: 'Blue',   from: '#0d1a44', to: '#0a2052' },
  { label: 'Ink',    from: '#111218', to: '#1a1d26' },
  { label: 'Red',    from: '#2e0d0d', to: '#520a0a' },
  { label: 'Gold',   from: '#2e220d', to: '#52380a' },
];
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
    const fields = e.fields.filter((f) => f.name.trim() && f.value.trim());
    if (fields.length) em.fields = fields.map((f) => ({ name: f.name || '\u200b', value: f.value || '\u200b', inline: !!f.inline }));
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
        // Custom emoji: "name:id" or bare numeric ID (legacy)
        const m = b.emoji.match(/(?:(.+):)?(\d{15,})$/);
        if (m) {
          const eid = m[2];
          const eName = m[1] || '_'; // Discord requires a name, use _ as fallback
          btn.emoji = { name: eName, id: eid };
        } else {
          // Unicode emoji — just set the name
          btn.emoji = { name: b.emoji };
        }
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
      if (!res.ok) {
        // Build a helpful error message from Discord's response
        let errMsg = data?.message || data?.error || `Discord error (${res.status})`;
        if (data?.errors) errMsg += ' — ' + JSON.stringify(data.errors);
        throw new Error(errMsg);
      }

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
// Tickets Tab
// ═══════════════════════════════════════════════════════════════════════════

type TicketFilter = 'all' | 'open' | 'in-progress' | 'resolved' | 'urgent';
const TICKET_STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  open: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20', label: 'Open' },
  'in-progress': { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', label: 'In Progress' },
  resolved: { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20', label: 'Resolved' },
  urgent: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', label: 'Urgent' },
};
const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400', medium: 'text-yellow-400', high: 'text-red-400',
};

async function sendTicketEmail(to: string, toName: string, subject: string, html: string, ticketId?: string) {
  const cfg = SITE_CONFIG.email;
  if (!cfg.workerUrl) return;
  // Thread all emails for the same ticket together using a consistent messageId
  const threadId = ticketId ? ticketId.toLowerCase().replace(/[^a-z0-9]/g, '') + '@truebeast.io' : undefined;
  try {
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to, toName, subject, html,
        senderName: cfg.senderName, senderEmail: cfg.senderEmail,
        ...(ticketId ? { threadSubject: `[TrueBeast Support] Ticket ${ticketId}` } : {}),
      }),
    });
    console.log('[Email] Ticket email:', to, res.status, res.ok ? 'OK' : 'FAILED');
    if (!res.ok) { const t = await res.text().catch(() => ''); console.warn('[Email] Error:', t); }
  } catch (err) { console.warn('Email send failed:', err); }
}

function buildThreadHtml(responses: any[], limit = 5): string {
  const recent = responses.slice(-limit);
  return recent.map((r: any) => {
    const isSupport = r.from === 'support';
    const border = isSupport ? '#8b5cf6' : '#22c55e';
    const name = isSupport ? 'TrueBeast Support' : 'You';
    const time = new Date(r.timestamp || r.createdAt).toLocaleString();
    return `<div style="border-left:3px solid ${border};padding:8px 12px;margin:8px 0;background:#1a1a2e;border-radius:0 8px 8px 0">
      <div style="font-size:12px;color:#9ca3af;margin-bottom:4px"><strong style="color:${border}">${name}</strong> · ${time}</div>
      <div style="color:#d1d5db;font-size:14px;white-space:pre-wrap">${(r.text || r.message || '').replace(/</g, '&lt;')}</div>
    </div>`;
  }).join('');
}

function TicketsTab() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TicketFilter>('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try { setTickets(await FirebaseDB.getAllTickets()); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }, [feedback]);

  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    'in-progress': tickets.filter((t) => t.status === 'in-progress').length,
    resolved: tickets.filter((t) => t.status === 'resolved').length,
    urgent: tickets.filter((t) => t.priority === 'high' && t.status !== 'resolved').length,
  };

  const filtered = tickets.filter((t) => {
    if (filter === 'urgent') return t.priority === 'high' && t.status !== 'resolved';
    if (filter !== 'all' && t.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!t.id?.toLowerCase().includes(s) && !t.name?.toLowerCase().includes(s) && !t.subject?.toLowerCase().includes(s) && !t.email?.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const handleStatusChange = async (ticket: any, status: string) => {
    try {
      await FirebaseDB.updateTicket(ticket.id, { status });
      // Send resolution email
      if (status === 'resolved' && ticket.email) {
        const thread = buildThreadHtml(ticket.responses || [], 5);
        const html = `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:#0a0a1a;color:#fff;padding:32px;border-radius:16px">
          <h2 style="color:#22c55e;margin-bottom:8px">Your ticket has been resolved ✓</h2>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="color:#9ca3af;padding:4px 8px">Ticket</td><td style="color:#fff;padding:4px 8px">${ticket.id}</td></tr>
            <tr><td style="color:#9ca3af;padding:4px 8px">Subject</td><td style="color:#fff;padding:4px 8px">${ticket.subject}</td></tr>
          </table>
          ${thread ? '<h3 style="color:#9ca3af;font-size:14px;margin-top:16px">Conversation</h3>' + thread : ''}
          <p style="color:#9ca3af;margin-top:20px;font-size:13px">If the issue wasn't fully resolved you can still reply or open a new one.</p>
          <div style="margin-top:20px">
            <a href="${SITE_CONFIG.siteUrl}/ticket?id=${ticket.id}" style="background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Ticket</a>
            <a href="${SITE_CONFIG.siteUrl}/submit-review" style="background:#8b5cf6;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-left:8px">Leave a Review</a>
          </div>
        </div>`;
        sendTicketEmail(ticket.email, ticket.name, `[TrueBeast Support] Ticket ${ticket.id}`, html, ticket.id);
      }
      setFeedback({ type: 'success', message: `Status → ${status}` });
      fetchTickets();
      if (selected?.id === ticket.id) setSelected({ ...ticket, status });
    } catch { setFeedback({ type: 'error', message: 'Status update failed' }); }
  };

  const handleReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    try {
      const newResponse = { from: 'support', text: reply.trim(), timestamp: new Date().toISOString() };
      const responses = [...(selected.responses || []), newResponse];
      await FirebaseDB.updateTicket(selected.id, { responses, status: selected.status === 'open' ? 'in-progress' : selected.status });

      // Send email notification
      if (selected.email) {
        const thread = buildThreadHtml(responses.slice(-4), 4);
        const html = `<div style="font-family:system-ui;max-width:600px;margin:0 auto;background:#0a0a1a;color:#fff;padding:32px;border-radius:16px">
          <h2 style="color:#8b5cf6;margin-bottom:16px">TrueBeast replied to your ticket</h2>
          <div style="border-left:3px solid #8b5cf6;padding:12px 16px;margin:16px 0;background:#1a1a2e;border-radius:0 8px 8px 0">
            <div style="color:#d1d5db;font-size:14px;white-space:pre-wrap">${reply.trim().replace(/</g, '&lt;')}</div>
          </div>
          ${thread ? '<h3 style="color:#9ca3af;font-size:14px;margin-top:16px">Recent conversation</h3>' + thread : ''}
          <div style="margin-top:20px">
            <a href="${SITE_CONFIG.siteUrl}/ticket?id=${selected.id}" style="background:#8b5cf6;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View & Reply to Ticket</a>
          </div>
        </div>`;
        sendTicketEmail(selected.email, selected.name, `[TrueBeast Support] Ticket ${selected.id}`, html, selected.id);
      }

      setReply('');
      setFeedback({ type: 'success', message: 'Reply sent + email notification' });
      fetchTickets();
      setSelected({ ...selected, responses, status: selected.status === 'open' ? 'in-progress' : selected.status });
    } catch { setFeedback({ type: 'error', message: 'Reply failed' }); }
    finally { setSending(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Permanently delete this ticket?')) return;
    try {
      await FirebaseDB.deleteTicket(id);
      setFeedback({ type: 'success', message: 'Ticket deleted' });
      if (selected?.id === id) setSelected(null);
      fetchTickets();
    } catch { setFeedback({ type: 'error', message: 'Delete failed' }); }
  };

  // ── Detail View ──
  if (selected) {
    const sc = TICKET_STATUS_COLORS[selected.status] || TICKET_STATUS_COLORS.open;
    const responses = selected.responses || [];
    return (
      <div className="space-y-4">
        {/* Back + header */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-white transition-colors cursor-pointer text-sm flex items-center gap-1">
            ← Back to tickets
          </button>
        </div>

        <GlassCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-bold text-white font-display">{selected.subject}</h3>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{selected.id}</p>
            </div>
            <div className="flex items-center gap-2">
              {['open', 'in-progress', 'resolved', 'urgent'].map((s) => {
                const c = TICKET_STATUS_COLORS[s] || TICKET_STATUS_COLORS.open;
                return (
                  <button key={s} type="button" onClick={() => handleStatusChange(selected, s)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${selected.status === s ? `${c.bg} ${c.text} ${c.border}` : 'bg-white/5 text-gray-500 border-white/5 hover:bg-white/10'}`}>
                    {c.label}
                  </button>
                );
              })}
              <button type="button" onClick={() => handleDelete(selected.id)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer ml-2">
                <Trash01 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white/[0.02] rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">From</p>
              <p className="text-sm text-white">{selected.name}</p>
              <p className="text-xs text-gray-400">{selected.email}</p>
              {selected.discord && <p className="text-xs text-indigo-400">{selected.discord}</p>}
            </div>
            <div className="bg-white/[0.02] rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</p>
              <p className="text-sm text-white capitalize">{selected.category}</p>
              <p className={`text-xs font-semibold capitalize ${PRIORITY_COLORS[selected.priority] || 'text-gray-400'}`}>Priority: {selected.priority}</p>
              <span className={`inline-block ${sc.bg} ${sc.text} ${sc.border} border rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase`}>{sc.label}</span>
            </div>
            <div className="bg-white/[0.02] rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Timeline</p>
              <p className="text-xs text-gray-400">Created: {new Date(selected.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              {selected.updatedAt && <p className="text-xs text-gray-400">Updated: {new Date(selected.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
              <p className="text-xs text-gray-400">{responses.length} message{responses.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </GlassCard>

        {/* Conversation thread */}
        <GlassCard className="p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-4">Conversation</h4>
          <div className="space-y-3">
            {/* Original message */}
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {(selected.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-green-400">{selected.name}</span>
                  <span className="text-[10px] text-gray-600">{new Date(selected.createdAt).toLocaleString()}</span>
                </div>
                <div className="bg-green-500/5 border-l-2 border-green-500/30 rounded-r-lg p-3">
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.description}</p>
                  {selected.deviceInfo && (
                    <div className="mt-2 pt-2 border-t border-white/5">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Device Info</p>
                      <p className="text-xs text-gray-400 whitespace-pre-wrap">{selected.deviceInfo}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Responses */}
            {responses.map((r: any, i: number) => {
              const isSupport = r.from === 'support';
              return (
                <div key={i} className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${isSupport ? 'bg-gradient-to-br from-violet-500 to-purple-600' : 'bg-gradient-to-br from-green-500 to-emerald-600'}`}>
                    {isSupport ? 'TB' : (selected.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-semibold ${isSupport ? 'text-violet-400' : 'text-green-400'}`}>{isSupport ? 'TrueBeast Support' : selected.name}</span>
                      <span className="text-[10px] text-gray-600">{new Date(r.timestamp || r.createdAt).toLocaleString()}</span>
                    </div>
                    <div className={`${isSupport ? 'bg-violet-500/5 border-l-2 border-violet-500/30' : 'bg-green-500/5 border-l-2 border-green-500/30'} rounded-r-lg p-3`}>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{r.text || r.message}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reply form */}
          {selected.status !== 'resolved' ? (
            <div className="mt-6 pt-4 border-t border-white/5">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply..." rows={3}
                className={inp + ' resize-y mb-3'} />
              <div className="flex items-center gap-3">
                <button type="button" onClick={handleReply} disabled={sending || !reply.trim()}
                  className="flex items-center gap-2 py-2.5 px-5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-all cursor-pointer">
                  {sending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send01 className="w-4 h-4" />}
                  {sending ? 'Sending...' : 'Send Reply'}
                </button>
                {feedback && <span className={`text-xs ${feedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{feedback.message}</span>}
              </div>
            </div>
          ) : (
            <div className="mt-6 pt-4 border-t border-white/5 text-center">
              <p className="text-gray-500 text-sm">This ticket has been resolved.</p>
            </div>
          )}
        </GlassCard>
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: counts.all, icon: '📋' },
          { label: 'Open', value: counts.open, icon: '🟢' },
          { label: 'In Progress', value: counts['in-progress'], icon: '🔵' },
          { label: 'Resolved', value: counts.resolved, icon: '✅' },
          { label: 'Urgent', value: counts.urgent, icon: '🔴' },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4 text-center">
            <span className="text-lg">{s.icon}</span>
            <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {(['all', 'open', 'in-progress', 'resolved', 'urgent'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${filter === f ? 'bg-green-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
              {f === 'all' ? 'All' : f === 'in-progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
              {counts[f] > 0 && <span className="ml-1 opacity-60">({counts[f]})</span>}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Search by ID, name, subject, email..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50" />
        <button type="button" onClick={fetchTickets} className="text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
          <RefreshCw01 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </GlassCard>

      {feedback && <div className={`rounded-xl px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{feedback.message}</div>}

      {/* Ticket list */}
      {loading && tickets.length === 0 ? (
        <GlassCard className="p-12 text-center"><p className="text-gray-500">Loading tickets...</p></GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><p className="text-gray-500">{search ? 'No tickets match your search' : 'No tickets found'}</p></GlassCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const sc = TICKET_STATUS_COLORS[t.status] || TICKET_STATUS_COLORS.open;
            const replyCount = (t.responses || []).length;
            return (
              <GlassCard key={t.id} hover className="p-4 cursor-pointer" onClick={() => setSelected(t)}>
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono text-green-400">{t.id}</span>
                      <span className={`${sc.bg} ${sc.text} ${sc.border} border rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase`}>{sc.label}</span>
                      <span className={`text-[10px] font-semibold uppercase ${PRIORITY_COLORS[t.priority] || 'text-gray-400'}`}>{t.priority}</span>
                    </div>
                    <p className="text-sm text-white font-medium truncate">{t.subject}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{t.name}</span>
                      <span>{t.category}</span>
                      <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                      {replyCount > 0 && <span>{replyCount} repl{replyCount === 1 ? 'y' : 'ies'}</span>}
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-600 -rotate-90 flex-shrink-0" />
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Reviews Tab
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  approved: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  rejected: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
};

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill={i <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
          className={i <= rating ? 'text-yellow-400' : 'text-gray-600'}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

type ReviewFilter = 'all' | 'pending' | 'approved' | 'rejected';

function ReviewsTab() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try { setReviews(await FirebaseDB.getAllReviews()); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 3000); return () => clearTimeout(t); }, [feedback]);

  const filtered = reviews.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search && !r.name?.toLowerCase().includes(search.toLowerCase()) && !r.text?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { all: reviews.length, pending: reviews.filter((r) => r.status === 'pending').length, approved: reviews.filter((r) => r.status === 'approved').length, rejected: reviews.filter((r) => r.status === 'rejected').length };
  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : '—';

  const handleAction = async (id: string, action: 'approved' | 'rejected') => {
    try { await FirebaseDB.updateReview(id, { status: action }); setFeedback({ type: 'success', message: `Review ${action}` }); fetchReviews(); }
    catch { setFeedback({ type: 'error', message: 'Action failed' }); }
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this review?')) return;
    try { await FirebaseDB.deleteReview(id); setFeedback({ type: 'success', message: 'Deleted' }); fetchReviews(); }
    catch { setFeedback({ type: 'error', message: 'Delete failed' }); }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: counts.all, icon: '📊' },
          { label: 'Pending', value: counts.pending, icon: '⏳' },
          { label: 'Approved', value: counts.approved, icon: '✅' },
          { label: 'Rejected', value: counts.rejected, icon: '❌' },
          { label: 'Avg Rating', value: avgRating, icon: '⭐' },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4 text-center">
            <span className="text-lg">{s.icon}</span>
            <p className="text-2xl font-bold text-white mt-1">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${filter === f ? 'bg-green-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)} {counts[f] > 0 && <span className="ml-1 opacity-60">({counts[f]})</span>}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Search reviews..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50" />
        <button type="button" onClick={fetchReviews} className="text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
          <RefreshCw01 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </GlassCard>

      {feedback && <div className={`rounded-xl px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{feedback.message}</div>}

      {/* Reviews list */}
      {loading && reviews.length === 0 ? (
        <GlassCard className="p-12 text-center"><p className="text-gray-500">Loading reviews...</p></GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><p className="text-gray-500">No reviews found</p></GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
            return (
              <GlassCard key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {(r.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold text-sm">{r.name}</span>
                        <Stars rating={r.rating || 0} />
                        <span className={`${sc.bg} ${sc.text} ${sc.border} border rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase`}>
                          {r.status}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm mt-1 leading-relaxed">{r.text}</p>
                      <p className="text-gray-600 text-[10px] mt-2">{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {r.status !== 'approved' && (
                      <button type="button" onClick={() => handleAction(r.id, 'approved')} title="Approve"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-pointer">
                        Approve
                      </button>
                    )}
                    {r.status !== 'rejected' && (
                      <button type="button" onClick={() => handleAction(r.id, 'rejected')} title="Reject"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer">
                        Reject
                      </button>
                    )}
                    <button type="button" onClick={() => handleDelete(r.id)} title="Delete"
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer">
                      <Trash01 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Analytics Tab
// ═══════════════════════════════════════════════════════════════════════════

type Period = 'today' | '7d' | '30d' | 'all';

function getPeriodStart(period: Period): string | undefined {
  if (period === 'all') return undefined;
  const d = new Date();
  if (period === 'today') d.setHours(0, 0, 0, 0);
  else if (period === '7d') d.setDate(d.getDate() - 7);
  else if (period === '30d') d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const EVENT_ICONS: Record<string, string> = {
  page_view: '👁️', time_on_page: '⏱️', click: '🖱️',
  announcement_sent: '📢', link_gen: '🔗', giveaway_enter: '🎁',
};

function AnalyticsTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const lineRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const lineChartRef = useRef<any>(null);
  const barChartRef = useRef<any>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const start = getPeriodStart(period);
      const data = await FirebaseDB.getAnalyticsEvents({ startDate: start, limit: 2000 });
      setEvents(data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Compute metrics
  const pageViews = events.filter((e) => e.type === 'page_view');
  const clicks = events.filter((e) => e.type === 'click');
  const timeEvents = events.filter((e) => e.type === 'time_on_page');
  const uniqueSessions = new Set(events.map((e) => e.sessionId)).size;
  const avgTime = timeEvents.length ? Math.round(timeEvents.reduce((s, e) => s + (e.seconds || 0), 0) / timeEvents.length) : 0;

  // Daily page views for line chart
  const dailyViews = (() => {
    const map: Record<string, number> = {};
    pageViews.forEach((e) => {
      const day = new Date(e.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      map[day] = (map[day] || 0) + 1;
    });
    const entries = Object.entries(map);
    return { labels: entries.map(([l]) => l), data: entries.map(([, v]) => v) };
  })();

  // Top pages for bar chart
  const topPages = (() => {
    const map: Record<string, number> = {};
    pageViews.forEach((e) => { const p = e.page || '/'; map[p] = (map[p] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  })();

  // Top clicks
  const topClicks = (() => {
    const map: Record<string, number> = {};
    clicks.forEach((e) => { const l = e.label || e.text || 'unknown'; map[l] = (map[l] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  })();

  // Charts
  useEffect(() => {
    if (!lineRef.current || !dailyViews.labels.length) return;
    import('chart.js/auto').then(({ default: Chart }) => {
      if (lineChartRef.current) lineChartRef.current.destroy();
      const ctx = lineRef.current!.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 0, 180);
      gradient.addColorStop(0, 'rgba(34,197,94,0.3)');
      gradient.addColorStop(1, 'rgba(34,197,94,0)');
      lineChartRef.current = new Chart(ctx, {
        type: 'line',
        data: { labels: dailyViews.labels, datasets: [{ label: 'Page Views', data: dailyViews.data, borderColor: '#22c55e', backgroundColor: gradient, fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#22c55e' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' } }, y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } } } },
      });
    });
    return () => { if (lineChartRef.current) { lineChartRef.current.destroy(); lineChartRef.current = null; } };
  }, [dailyViews.labels.join(), dailyViews.data.join()]);

  useEffect(() => {
    if (!barRef.current || !topPages.length) return;
    import('chart.js/auto').then(({ default: Chart }) => {
      if (barChartRef.current) barChartRef.current.destroy();
      barChartRef.current = new Chart(barRef.current!, {
        type: 'bar',
        data: { labels: topPages.map(([p]) => p), datasets: [{ label: 'Views', data: topPages.map(([, v]) => v), backgroundColor: 'rgba(34,197,94,0.5)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }, y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { display: false } } } },
      });
    });
    return () => { if (barChartRef.current) { barChartRef.current.destroy(); barChartRef.current = null; } };
  }, [topPages.map(([p, v]) => `${p}:${v}`).join()]);

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <GlassCard className="p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-400 font-medium">Period:</span>
        {(['today', '7d', '30d', 'all'] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${period === p ? 'bg-green-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            {p === 'today' ? 'Today' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : 'All Time'}
          </button>
        ))}
        <button type="button" onClick={fetchEvents} disabled={loading} className="ml-auto text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
          <RefreshCw01 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </GlassCard>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: '👁️', value: pageViews.length.toLocaleString(), label: 'Page Views', color: 'text-blue-400' },
          { icon: '👤', value: uniqueSessions.toLocaleString(), label: 'Unique Sessions', color: 'text-green-400' },
          { icon: '⏱️', value: `${avgTime}s`, label: 'Avg Time on Page', color: 'text-yellow-400' },
          { icon: '🖱️', value: clicks.length.toLocaleString(), label: 'Total Clicks', color: 'text-purple-400' },
        ].map((s) => (
          <GlassCard key={s.label} className="p-5">
            <span className="text-xl">{s.icon}</span>
            <p className={`text-3xl font-bold mt-2 ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </GlassCard>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Daily Page Views</h4>
          <div style={{ height: 200 }}><canvas ref={lineRef} /></div>
          {dailyViews.labels.length === 0 && !loading && <p className="text-gray-600 text-xs text-center mt-2">No page view data yet</p>}
        </GlassCard>
        <GlassCard className="p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Top Pages</h4>
          <div style={{ height: 200 }}><canvas ref={barRef} /></div>
          {topPages.length === 0 && !loading && <p className="text-gray-600 text-xs text-center mt-2">No page data yet</p>}
        </GlassCard>
      </div>

      {/* Top clicks + Recent events */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top clicks */}
        <GlassCard className="p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Top Clicks</h4>
          {topClicks.length === 0 ? <p className="text-gray-600 text-xs">No click data yet — add <code className="text-green-400">data-track</code> attributes to elements</p> : (
            <div className="space-y-1.5">
              {topClicks.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between bg-white/[0.02] rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-300 truncate">{label}</span>
                  <span className="text-xs text-green-400 font-semibold ml-2">{count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Recent events */}
        <GlassCard className="p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Recent Events</h4>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {events.slice(0, 50).map((e, i) => (
              <div key={e.id || i} className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-1.5 text-xs">
                <span>{EVENT_ICONS[e.type] || '📌'}</span>
                <span className="text-gray-400 truncate flex-1">
                  {e.type === 'page_view' && `Viewed ${e.page}`}
                  {e.type === 'click' && `Clicked: ${e.label || e.text || '?'}`}
                  {e.type === 'time_on_page' && `${e.seconds}s on ${e.page}`}
                  {e.type === 'announcement_sent' && `Announcement by ${e.admin || '?'}`}
                  {!['page_view', 'click', 'time_on_page', 'announcement_sent'].includes(e.type) && `${e.type} on ${e.page}`}
                </span>
                <span className="text-gray-600 flex-shrink-0">{timeAgo(e.ts)}</span>
              </div>
            ))}
            {events.length === 0 && !loading && <p className="text-gray-600 text-xs text-center py-4">No events recorded yet</p>}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder Tab
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Admin Management Tab
// ═══════════════════════════════════════════════════════════════════════════

const PERM_KEYS = ['tickets', 'reviews', 'discord', 'analytics', 'adminManagement'] as const;
const PERM_LABELS: Record<string, string> = { tickets: 'Tickets', reviews: 'Reviews', discord: 'Announcements', analytics: 'Analytics', adminManagement: 'Admin Mgmt' };
const PERM_COLORS: Record<string, string> = { tickets: 'text-blue-400 bg-blue-500/10 border-blue-500/20', reviews: 'text-green-400 bg-green-500/10 border-green-500/20', discord: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', analytics: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', adminManagement: 'text-violet-400 bg-violet-500/10 border-violet-500/20' };

function AdminManagementTab() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<{ uid: string; email: string | null; displayName: string | null; disabled: boolean; createdAt: string | null; lastSignedIn: string | null; providers: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', password: '', permissions: {} as Record<string, boolean> });
  const [userSearch, setUserSearch] = useState('');
  const [section, setSection] = useState<'admins' | 'users'>('admins');

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try { setAllUsers(await FirebaseDB.getAllUsers()); } catch { /* */ }
    finally { setUsersLoading(false); }
  }, []);

  const handleDeleteUser = async (u: typeof allUsers[0]) => {
    if (!window.confirm(`DELETE user ${u.email || u.uid}?\n\nThis will:\n• Remove their Firebase Auth account (permanent)\n• Delete all their game data\n\nThis cannot be undone.`)) return;
    try {
      await FirebaseDB.deleteAuthUser(u.uid);
      await FirebaseDB.deleteUserData(u.uid);
      setFeedback({ type: 'success', message: `Deleted ${u.email || u.uid}` });
      fetchUsers();
    } catch { setFeedback({ type: 'error', message: 'Delete failed' }); }
  };

  const handleToggleDisable = async (u: typeof allUsers[0]) => {
    const action = u.disabled ? 'enable' : 'disable';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} user ${u.email || u.uid}?`)) return;
    try {
      await FirebaseDB.disableAuthUser(u.uid, !u.disabled);
      setFeedback({ type: 'success', message: `User ${action}d` });
      fetchUsers();
    } catch { setFeedback({ type: 'error', message: `${action} failed` }); }
  };

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try { setAdmins(await FirebaseDB.getAllAdminRoles()); } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);
  useEffect(() => { if (!feedback) return; const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }, [feedback]);

  const isSuperAdmin = (email: string) => email === user?.email;

  const openAddModal = () => {
    setEditEmail(null);
    setForm({ email: '', displayName: '', password: '', permissions: Object.fromEntries(PERM_KEYS.map((k) => [k, false])) });
    setModalOpen(true);
  };

  const openEditModal = (admin: any) => {
    setEditEmail(admin.email || admin.id);
    setForm({
      email: admin.email || admin.id,
      displayName: admin.displayName || '',
      password: '',
      permissions: admin.permissions || {},
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email) { setFeedback({ type: 'error', message: 'Email is required' }); return; }

    try {
      if (!editEmail) {
        // Creating new admin — need to create Firebase Auth account first
        // This requires the Firebase Admin SDK (server-side), so we just save the role
        // The admin must create their account via Firebase Console
        await FirebaseDB.setAdminRole(email, {
          email,
          displayName: form.displayName || email.split('@')[0],
          permissions: form.permissions,
          createdAt: new Date().toISOString(),
        });
        setFeedback({ type: 'success', message: `Admin role saved for ${email}. Create their Firebase Auth account in the Firebase Console.` });
      } else {
        // Editing existing
        await FirebaseDB.setAdminRole(email, {
          email,
          displayName: form.displayName || email.split('@')[0],
          permissions: form.permissions,
        });
        setFeedback({ type: 'success', message: `Updated ${email}` });
      }
      setModalOpen(false);
      fetchAdmins();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Save failed' });
    }
  };

  const handleDelete = async (admin: any) => {
    const email = admin.email || admin.id;
    if (isSuperAdmin(email)) { setFeedback({ type: 'error', message: "Can't remove yourself" }); return; }
    if (!window.confirm(`Remove admin access for ${email}? Their Firebase Auth account will remain (delete it manually in Firebase Console if needed).`)) return;
    try {
      await FirebaseDB.deleteAdminRole(email);
      setFeedback({ type: 'success', message: `Removed ${email}` });
      fetchAdmins();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Delete failed' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
            <Users01 className="w-5 h-5 text-violet-400" /> Admin Management
          </h3>
          <p className="text-xs text-gray-500 mt-1">You ({user?.email}) are the super admin with full access.</p>
        </div>
        <button type="button" onClick={openAddModal}
          className="flex items-center gap-2 py-2.5 px-5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer">
          <Plus className="w-4 h-4" /> Add Admin
        </button>
      </div>

      {/* Section toggle */}
      <div className="flex gap-1.5 mb-4">
        <button type="button" onClick={() => setSection('admins')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${section === 'admins' ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
          Admin Roles
        </button>
        <button type="button" onClick={() => { setSection('users'); if (allUsers.length === 0) fetchUsers(); }}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${section === 'users' ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
          All Users
        </button>
      </div>

      {feedback && <div className={`rounded-xl px-4 py-3 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>{feedback.message}</div>}

      {/* Admin list */}
      {section === 'admins' && (
        loading && admins.length === 0 ? (
        <GlassCard className="p-12 text-center"><p className="text-gray-500">Loading admins...</p></GlassCard>
      ) : admins.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <p className="text-gray-500">No sub-admins configured yet. You (super admin) always have full access.</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {admins.map((admin) => {
            const email = admin.email || admin.id;
            const perms = admin.permissions || {};
            const isSuper = isSuperAdmin(email);
            return (
              <GlassCard key={email} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{admin.displayName || email}</span>
                      {isSuper && (
                        <span className="bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase">
                          Super Admin
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{email}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {isSuper ? (
                        <span className="text-[10px] text-gray-400">Full access to everything</span>
                      ) : (
                        PERM_KEYS.filter((k) => perms[k]).length > 0 ? (
                          PERM_KEYS.filter((k) => perms[k]).map((k) => (
                            <span key={k} className={`${PERM_COLORS[k]} border text-[10px] font-semibold px-2 py-0.5 rounded-full`}>
                              {PERM_LABELS[k]}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-gray-600">No permissions</span>
                        )
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={() => openEditModal(admin)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                      Edit
                    </button>
                    {!isSuper && (
                      <button type="button" onClick={() => handleDelete(admin)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer">
                        <Trash01 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      ))}

      {section === 'admins' && (
        <p className="text-xs text-gray-600">
          Removing an admin only removes their permissions. Their Firebase Auth account must be deleted manually in the Firebase Console.
        </p>
      )}

      {/* Users section */}
      {section === 'users' && (
        <div className="space-y-4">
          <GlassCard className="p-4 flex flex-wrap items-center gap-3">
            <input type="text" placeholder="Search by email, name, UID..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
              className="flex-1 min-w-[200px] bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50" />
            <span className="text-xs text-gray-500">{allUsers.length} user{allUsers.length !== 1 ? 's' : ''}</span>
            <button type="button" onClick={async () => {
              if (!allUsers.length) { setFeedback({ type: 'error', message: 'Load users first' }); return; }
              if (!window.confirm('Clean up Clout Clicker data?\n\nThis removes ALL leaderboard entries, saves, and peak data for accounts that no longer exist in Firebase Auth.\n\nThis cannot be undone.')) return;
              const validUids = allUsers.map((u) => u.uid);
              const removed = await FirebaseDB.cleanupLeaderboard(validUids);
              setFeedback({ type: 'success', message: `Cleanup done — removed ${removed} orphaned entries` });
            }} className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1 transition-colors cursor-pointer" title="Remove game data for deleted accounts">
              <Trash01 className="w-3 h-3" /> Clean Fake Data
            </button>
            <button type="button" onClick={fetchUsers} disabled={usersLoading} className="text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
              <RefreshCw01 className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
            </button>
          </GlassCard>

          {usersLoading && allUsers.length === 0 ? (
            <GlassCard className="p-12 text-center"><p className="text-gray-500">Loading users from Firebase Auth...</p></GlassCard>
          ) : allUsers.length === 0 ? (
            <GlassCard className="p-12 text-center">
              <p className="text-gray-500">No users found. Make sure the Cloudflare Worker has FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_EMAIL, and FIREBASE_SERVICE_ACCOUNT_KEY configured.</p>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {allUsers
                .filter((u) => {
                  if (!userSearch) return true;
                  const s = userSearch.toLowerCase();
                  return u.uid.toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || (u.displayName || '').toLowerCase().includes(s);
                })
                .map((u) => (
                    <GlassCard key={u.uid} className={`p-4 ${u.disabled ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {(u.displayName || u.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <span className="text-white font-semibold text-sm">{u.displayName || u.email || 'No name'}</span>
                            {u.disabled && <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">Disabled</span>}
                            {u.providers.includes('password') && <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">Email</span>}
                            {u.providers.includes('google.com') && <span className="bg-red-500/10 border border-red-500/20 text-orange-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">Google</span>}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{u.email || 'No email'}</p>
                          <p className="text-[10px] text-gray-600 font-mono">{u.uid}</p>
                          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                            {u.createdAt && <span>Created: <span className="text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</span></span>}
                            {u.lastSignedIn && <span>Last login: <span className="text-gray-400">{new Date(u.lastSignedIn).toLocaleDateString()}</span></span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button type="button" onClick={() => handleToggleDisable(u)} title={u.disabled ? 'Enable user' : 'Disable user'}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors cursor-pointer ${u.disabled ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20'}`}>
                            {u.disabled ? 'Enable' : 'Disable'}
                          </button>
                          <button type="button" onClick={() => handleDeleteUser(u)} title="Delete user permanently"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer">
                            <Trash01 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[200] bg-black/75 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="glass-strong rounded-3xl p-7 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg text-white mb-5">
              {editEmail ? 'Edit Admin' : 'Add Admin'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={!!editEmail} placeholder="admin@example.com"
                  className={`${inp} ${editEmail ? 'opacity-50' : ''}`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Display Name</label>
                <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="e.g. Mod Team" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Permissions</label>
                <div className="glass rounded-xl p-4 space-y-2.5">
                  {PERM_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-3 text-sm text-gray-300 cursor-pointer select-none">
                      <input type="checkbox" checked={!!form.permissions[k]}
                        onChange={(e) => setForm({ ...form, permissions: { ...form.permissions, [k]: e.target.checked } })}
                        className="w-4 h-4 rounded accent-violet-500 cursor-pointer" />
                      <span>{PERM_LABELS[k]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setModalOpen(false)}
                className="flex-1 glass px-4 py-2.5 rounded-xl text-gray-300 text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={handleSave}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Placeholder Tab
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

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    setTimeout(() => reject(new Error('timeout')), 6000);
    img.src = src;
  });
}

const CARD_HEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto',     label: 'Auto' },
  { value: 'compact',  label: 'Compact (164px)' },
  { value: 'standard', label: 'Standard (220px)' },
  { value: 'tall',     label: 'Tall (340px)' },
  { value: 'banner',   label: 'Banner (500px)' },
  { value: 'xl',       label: 'XL Banner (750px)' },
  { value: 'xxl',      label: 'Poster (1100px)' },
  { value: 'giant',    label: 'Giant (1500px)' },
];


const CARD_TEMPLATES = [
  { name: 'Classic',      imagePosition: 'left'       as const, textAlign: 'left'   as const, cardHeight: 'auto',     gradientFrom: '#1a2744', gradientTo: '#0d3d52', gradientFromAlpha: 100, gradientToAlpha: 100 },
  { name: 'Hero',         imagePosition: 'background' as const, textAlign: 'center' as const, cardHeight: 'standard', gradientFrom: '#0d2e1c', gradientTo: '#0a4020', gradientFromAlpha: 80,  gradientToAlpha: 80  },
  { name: 'Centered',     imagePosition: 'none'       as const, textAlign: 'center' as const, cardHeight: 'auto',     gradientFrom: '#1a1244', gradientTo: '#2d0d52', gradientFromAlpha: 100, gradientToAlpha: 100 },
  { name: 'Announcement', imagePosition: 'right'      as const, textAlign: 'left'   as const, cardHeight: 'tall',     gradientFrom: '#2e0d0d', gradientTo: '#520a0a', gradientFromAlpha: 90,  gradientToAlpha: 70  },
  { name: 'Dark Banner',  imagePosition: 'background' as const, textAlign: 'left'   as const, cardHeight: 'banner',   gradientFrom: '#111218', gradientTo: '#1a1d26', gradientFromAlpha: 60,  gradientToAlpha: 90  },
  { name: 'Minimal',      imagePosition: 'none'       as const, textAlign: 'left'   as const, cardHeight: 'compact',  gradientFrom: '#111218', gradientTo: '#111218', gradientFromAlpha: 100, gradientToAlpha: 100 },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${(alpha / 100).toFixed(2)})`;
}

function wrapCanvasLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4): string[] {
  if (!text.trim()) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!word) continue;
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Discord Cards Tab
// ═══════════════════════════════════════════════════════════════════════════

function stripMdUI(s: string): string {
  return s.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\*([^*]*)\*/g, '$1').replace(/~~([^~]*)~~/g, '$1');
}

function wrapCanvasLines2(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 8): string[] {
  if (!text.trim()) return [];
  const paras = text.split('\n');
  const lines: string[] = [];
  for (const para of paras) {
    if (lines.length >= maxLines) break;
    if (!para.trim()) { if (lines.length > 0) lines.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(stripMdUI(test)).width > maxWidth && line) {
        lines.push(line); if (lines.length >= maxLines) return lines; line = word;
      } else { line = test; }
    }
    if (line) { lines.push(line); if (lines.length >= maxLines) return lines; }
  }
  return lines;
}

interface MdSeg { text: string; bold: boolean; italic: boolean; strike: boolean }
function parseMdSegsUI(text: string): MdSeg[] {
  const segs: MdSeg[] = [];
  let i = 0, bold = false, italic = false, strike = false;
  while (i < text.length) {
    if (text.startsWith('**', i)) { bold = !bold; i += 2; continue; }
    if (text.startsWith('~~', i)) { strike = !strike; i += 2; continue; }
    if (text[i] === '*') { italic = !italic; i++; continue; }
    let j = i + 1;
    while (j < text.length) {
      if (text.startsWith('**', j) || text.startsWith('~~', j) || text[j] === '*') break;
      j++;
    }
    if (i < j) segs.push({ text: text.slice(i, j), bold, italic, strike });
    i = j;
  }
  return segs;
}

function drawMdLineUI(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number, fontFamily: string, alignMode: string) {
  if (!text) return;
  const segs = parseMdSegsUI(text);
  const metrics = segs.map((seg) => {
    ctx.font = `${seg.bold && seg.italic ? 'bold italic ' : seg.bold ? 'bold ' : seg.italic ? 'italic ' : ''}${fontSize}px ${fontFamily}`;
    return ctx.measureText(seg.text).width;
  });
  const totalW = metrics.reduce((a, b) => a + b, 0);
  let dx = alignMode === 'center' ? x - totalW / 2 : alignMode === 'right' ? x - totalW : x;
  const savedAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  segs.forEach((seg, idx) => {
    ctx.font = `${seg.bold && seg.italic ? 'bold italic ' : seg.bold ? 'bold ' : seg.italic ? 'italic ' : ''}${fontSize}px ${fontFamily}`;
    ctx.fillText(seg.text, dx, y);
    if (seg.strike) ctx.fillRect(dx, y + Math.round(fontSize * 0.56), metrics[idx], Math.max(1, Math.round(fontSize * 0.07)));
    dx += metrics[idx];
  });
  ctx.textAlign = savedAlign;
}

function DiscordCardsTab() {
  const bot = useContext(BotCtx);
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('TrueBeast');
  const [subtitle, setSubtitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [gradientFrom, setGradientFrom] = useState('#1a2744');
  const [gradientTo, setGradientTo] = useState('#0d3d52');
  const [gradientFromAlpha, setGradientFromAlpha] = useState(100);
  const [gradientToAlpha, setGradientToAlpha] = useState(100);
  const [textBgOpacity, setTextBgOpacity] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePosition, setImagePosition] = useState<'left' | 'right' | 'background' | 'none'>('left');
  const [logoUrl, setLogoUrl] = useState('');
  const [featuredImageUrl, setFeaturedImageUrl] = useState('');
  const [textAlign, setTextAlign] = useState<'left' | 'center'>('left');
  const [cardHeight, setCardHeight] = useState('auto');
  const [components, setComponents] = useState<ButtonData[][]>([]);
  const [reactions, setReactions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saveName, setSaveName] = useState('');
  const [saves, setSaves] = useState<CardSaveRecord[]>([]);
  const [savesLoading, setSavesLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const updateRow = (ri: number, r: ButtonData[]) => setComponents((s) => s.map((x, i) => i === ri ? r : x));
  const removeRow = (ri: number) => setComponents((s) => s.filter((_, i) => i !== ri));
  const addRow = () => { if (components.length < MAX_ROWS) setComponents((s) => [...s, [newButton()]]); };

  const applyTemplate = (t: typeof CARD_TEMPLATES[number]) => {
    setImagePosition(t.imagePosition); setTextAlign(t.textAlign); setCardHeight(t.cardHeight);
    setGradientFrom(t.gradientFrom); setGradientTo(t.gradientTo);
    setGradientFromAlpha(t.gradientFromAlpha); setGradientToAlpha(t.gradientToAlpha);
  };

  useEffect(() => {
    setSavesLoading(true);
    FirebaseDB.getAllCardSaves().then(setSaves).catch(() => {}).finally(() => setSavesLoading(false));
  }, []);

  const saveDesign = async () => {
    if (!saveName.trim()) return;
    try {
      const record = await FirebaseDB.saveCardSave({
        name: saveName.trim(), title, subtitle, bodyText,
        gradientFrom, gradientTo, gradientFromAlpha, gradientToAlpha, textBgOpacity,
        imageUrl, imagePosition, logoUrl, featuredImageUrl, textAlign, cardHeight,
        componentsJson: components.length ? JSON.stringify(components) : '',
        reactions,
      });
      setSaves((s) => [record, ...s]);
      setSaveName('');
    } catch { /* silent */ }
  };
  const applySave = (s: CardSaveRecord) => {
    setTitle(s.title); setSubtitle(s.subtitle); setBodyText(s.bodyText);
    setGradientFrom(s.gradientFrom); setGradientTo(s.gradientTo);
    setGradientFromAlpha((s.gradientFromAlpha as number) ?? 100);
    setGradientToAlpha((s.gradientToAlpha as number) ?? 100);
    setTextBgOpacity((s.textBgOpacity as number) ?? 0);
    setImageUrl(s.imageUrl); setImagePosition(s.imagePosition as any);
    setLogoUrl(s.logoUrl); setFeaturedImageUrl(s.featuredImageUrl);
    setTextAlign(s.textAlign as any); setCardHeight(s.cardHeight);
    try { setComponents(JSON.parse(s.componentsJson || '[]')); } catch { setComponents([]); }
    setReactions((s.reactions as string[]) || []);
  };
  const deleteSave = async (id: string) => {
    setSaves((s) => s.filter((x) => x.id !== id));
    await FirebaseDB.deleteCardSave(id).catch(() => {});
  };

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  // Draw browser canvas preview
  useEffect(() => {
    let active = true;
    async function draw() {
      const canvas = canvasRef.current;
      if (!canvas || !active) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = 680;
      const ICON_SZ = 120, ICON_PAD = 22, GAP = 16, TEXT_PAD = 24;
      const TITLE_SZ = 28, SUB_SZ = 18, BODY_SZ = 15, LINE_H = 26, BODY_LINE_H = 22;
      const FEAT_PAD = 12;
      const LOGO_SZ = 52, LOGO_MARGIN = 14;
      const logoReserve = logoUrl.trim() ? LOGO_SZ + LOGO_MARGIN + 8 : 0;

      let textX: number, textMaxW: number, ctxTextAlign: CanvasTextAlign;
      if (imagePosition === 'left') { textX = ICON_PAD + ICON_SZ + GAP; textMaxW = W - textX - TEXT_PAD - logoReserve; ctxTextAlign = 'left'; }
      else if (imagePosition === 'right') { textX = TEXT_PAD; textMaxW = W - ICON_SZ - ICON_PAD - GAP - TEXT_PAD - logoReserve; ctxTextAlign = 'left'; }
      else { ctxTextAlign = textAlign; textX = textAlign === 'center' ? W / 2 : TEXT_PAD; textMaxW = W - TEXT_PAD * 2 - logoReserve; }

      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 100;
      const tmpCtx = tmp.getContext('2d')!;
      tmpCtx.font = `${SUB_SZ}px sans-serif`;
      const subLines = wrapCanvasLines2(tmpCtx, subtitle, textMaxW);
      tmpCtx.font = `${BODY_SZ}px sans-serif`;
      const bodyLines = wrapCanvasLines2(tmpCtx, bodyText, textMaxW, 8);

      const TITLE_H = TITLE_SZ + 10;
      const subH = subLines.length * LINE_H;
      const bodyH = bodyLines.length > 0 ? bodyLines.length * BODY_LINE_H + 8 : 0;
      const textContentH = TITLE_H + subH + bodyH;
      const headerH = Math.max(ICON_SZ + ICON_PAD * 2, 28 + textContentH + 28);

      let featuredImg: HTMLImageElement | null = null;
      if (featuredImageUrl) { try { featuredImg = await loadBrowserImage(featuredImageUrl); } catch {} }
      if (!active) return;
      const featW = W - FEAT_PAD * 2;
      const FEAT_H = featuredImg ? Math.min(500, Math.round(featuredImg.naturalHeight * featW / featuredImg.naturalWidth)) : 0;

      const heightMap: Record<string, number> = { compact: 164, standard: 220, tall: 340, banner: 500, xl: 750, xxl: 1100, giant: 1500 };
      const baseH = cardHeight === 'auto'
        ? Math.max(164, headerH + (FEAT_H > 0 ? FEAT_PAD + FEAT_H + FEAT_PAD : 0))
        : Math.max(heightMap[cardHeight] || headerH, headerH) + (FEAT_H > 0 ? FEAT_PAD + FEAT_H + FEAT_PAD : 0);
      const H = baseH;

      canvas.width = W; canvas.height = H;

      // Dark base
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); (ctx as any).roundRect(0, 0, W, H, 14); ctx.fill();

      // Gradient with per-colour alpha
      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, hexToRgba(gradientFrom, gradientFromAlpha));
      bg.addColorStop(1, hexToRgba(gradientTo, gradientToAlpha));
      ctx.fillStyle = bg;
      ctx.beginPath(); (ctx as any).roundRect(0, 0, W, baseH, 14); ctx.fill();

      let mainImg: HTMLImageElement | null = null;
      let logoImg: HTMLImageElement | null = null;
      if (imageUrl && imagePosition !== 'none') { try { mainImg = await loadBrowserImage(imageUrl); } catch {} }
      if (logoUrl) { try { logoImg = await loadBrowserImage(logoUrl); } catch {} }
      if (!active) return;

      // Background image
      if (imagePosition === 'background' && mainImg) {
        ctx.save(); ctx.globalAlpha = 0.3;
        ctx.beginPath(); (ctx as any).roundRect(0, 0, W, baseH, 14); ctx.clip();
        const s = Math.max(W / mainImg.naturalWidth, baseH / mainImg.naturalHeight);
        ctx.drawImage(mainImg, (W - mainImg.naturalWidth * s) / 2, (baseH - mainImg.naturalHeight * s) / 2, mainImg.naturalWidth * s, mainImg.naturalHeight * s);
        ctx.restore();
        const ov = ctx.createLinearGradient(0, 0, W, 0);
        ov.addColorStop(0, hexToRgba(gradientFrom, Math.min(gradientFromAlpha, 80)));
        ov.addColorStop(1, hexToRgba(gradientTo, Math.min(gradientToAlpha, 80)));
        ctx.fillStyle = ov; ctx.beginPath(); (ctx as any).roundRect(0, 0, W, baseH, 14); ctx.fill();
      }

      // Side icon
      if (imagePosition === 'left' || imagePosition === 'right') {
        const iconX = imagePosition === 'left' ? ICON_PAD : W - ICON_PAD - ICON_SZ;
        const iconY = Math.round((headerH - ICON_SZ) / 2);
        if (mainImg) {
          ctx.save(); ctx.beginPath(); (ctx as any).roundRect(iconX, iconY, ICON_SZ, ICON_SZ, 16); ctx.clip();
          ctx.drawImage(mainImg, iconX, iconY, ICON_SZ, ICON_SZ); ctx.restore();
        } else {
          ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); (ctx as any).roundRect(iconX, iconY, ICON_SZ, ICON_SZ, 16); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = 'bold 32px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('TB', iconX + ICON_SZ / 2, iconY + ICON_SZ / 2); ctx.restore();
        }
      }

      // Text bg scrim (behind text for readability)
      const totalTextH = TITLE_H + subH + bodyH;
      const titleY = Math.round((headerH - totalTextH) / 2);
      if (textBgOpacity > 0) {
        const SP = 10;
        const scrimX = ctxTextAlign === 'center' ? textX - textMaxW / 2 - SP : textX - SP;
        ctx.fillStyle = `rgba(0,0,0,${(textBgOpacity / 100).toFixed(2)})`;
        ctx.beginPath(); (ctx as any).roundRect(scrimX, titleY - SP, textMaxW + SP * 2, totalTextH + SP * 2, 8); ctx.fill();
      }

      // Text
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
      ctx.textAlign = ctxTextAlign; ctx.font = `bold ${TITLE_SZ}px sans-serif`;
      ctx.fillText(stripMdUI(title) || 'Title', textX, titleY); ctx.shadowBlur = 0;
      if (subLines.length) {
        ctx.fillStyle = '#93b4ca';
        subLines.forEach((l, i) => drawMdLineUI(ctx, l, textX, titleY + TITLE_H + i * LINE_H, SUB_SZ, 'sans-serif', ctxTextAlign));
      }
      if (bodyLines.length) {
        ctx.fillStyle = '#6b7f99';
        bodyLines.forEach((l, i) => drawMdLineUI(ctx, l, textX, titleY + TITLE_H + subH + 8 + i * BODY_LINE_H, BODY_SZ, 'sans-serif', ctxTextAlign));
      }

      // Logo (drawn AFTER text so it's always on top)
      if (logoImg) {
        const lx = W - LOGO_SZ - LOGO_MARGIN, ly = LOGO_MARGIN;
        ctx.save(); ctx.beginPath(); (ctx as any).roundRect(lx, ly, LOGO_SZ, LOGO_SZ, 8); ctx.clip();
        ctx.drawImage(logoImg, lx, ly, LOGO_SZ, LOGO_SZ); ctx.restore();
      }

      // Featured image (with side padding, rounded corners)
      if (featuredImg && FEAT_H > 0) {
        const imgY = headerH + FEAT_PAD, imgX = FEAT_PAD, imgW = W - FEAT_PAD * 2;
        ctx.save(); ctx.beginPath(); (ctx as any).roundRect(imgX, imgY, imgW, FEAT_H, 10); ctx.clip();
        const s = Math.max(imgW / featuredImg.naturalWidth, FEAT_H / featuredImg.naturalHeight);
        ctx.drawImage(featuredImg, imgX + (imgW - featuredImg.naturalWidth * s) / 2, imgY + (FEAT_H - featuredImg.naturalHeight * s) / 2, featuredImg.naturalWidth * s, featuredImg.naturalHeight * s);
        ctx.restore();
      }

    }
    draw();
    return () => { active = false; };
  }, [title, subtitle, bodyText, gradientFrom, gradientTo, gradientFromAlpha, gradientToAlpha, textBgOpacity, imageUrl, imagePosition, logoUrl, featuredImageUrl, textAlign, cardHeight]);

  const handlePost = async () => {
    if (!channelId) { setFeedback({ type: 'error', message: 'Select a channel first.' }); return; }
    if (!title.trim()) { setFeedback({ type: 'error', message: 'Title is required.' }); return; }
    setSending(true); setFeedback(null);
    try {
      await FirebaseDB.saveDiscordCard({
        title: title.trim(), subtitle: subtitle.trim(), bodyText: bodyText.trim(),
        gradientFrom, gradientTo, gradientFromAlpha, gradientToAlpha,
        textBgOpacity,
        imageUrl: imageUrl.trim(), imagePosition, logoUrl: logoUrl.trim(),
        featuredImageUrl: featuredImageUrl.trim(), textAlign, cardHeight,
        componentsJson: components.length ? JSON.stringify(components) : '',
        reactions, channelId,
      });
      setFeedback({ type: 'success', message: 'Card queued! The bot will post it within 15 seconds.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message ?? 'Failed to queue card.' });
    } finally { setSending(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.85fr] gap-6 items-start">
      {/* ── Left: Form ── */}
      <div className="space-y-4">

        {/* Templates */}
        <GlassCard className="p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-300">Templates</h4>
          <div className="grid grid-cols-3 gap-2">
            {CARD_TEMPLATES.map((t) => (
              <button key={t.name} type="button" onClick={() => applyTemplate(t)}
                className="py-2 px-3 rounded-xl text-xs font-medium border border-white/10 bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer">
                {t.name}
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5 space-y-4">
          <h3 className="text-lg font-semibold font-display text-white flex items-center gap-2">
            <Image01 className="w-5 h-5 text-green-400" /> Create Discord Card
          </h3>

          {/* Bot + Channel */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Bot:</span>
              {bot.loading ? <span className="text-xs text-yellow-400">Connecting...</span>
                : bot.ready ? <span className="text-xs text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full" />Ready</span>
                : <span className="text-xs text-gray-500">Not connected</span>}
              <button type="button" onClick={bot.fetch} disabled={bot.loading} className="text-xs text-gray-400 hover:text-gray-300 transition-colors cursor-pointer">
                <RefreshCw01 className={`w-3 h-3 ${bot.loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="flex-1 min-w-[200px]">
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 cursor-pointer appearance-none">
                <option value="" className="bg-[#1e1f22]">— Select channel —</option>
                {bot.channels.map((c) => <option key={c.id} value={c.id} className="bg-[#1e1f22]">{c.type === 5 ? '📢' : '#'} {c.name}</option>)}
              </select>
            </div>
          </div>
          <hr className="border-white/5" />

          {/* Text Content */}
          <div>
            <label className={lbl}>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="TrueBeast" className={inp} maxLength={80} />
          </div>
          <div>
            <label className={lbl}>Subtitle</label>
            <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Short headline or call to action..." className={inp} maxLength={200} />
          </div>
          <div>
            <label className={lbl}>Body Text <span className="text-gray-500 font-normal">(optional, smaller)</span></label>
            <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Longer description, details, etc." className={inp + ' resize-y'} rows={2} maxLength={500} />
          </div>
          <div>
            <label className={lbl}>Text Background — {textBgOpacity}% <span className="text-gray-500 font-normal">(dark scrim behind text for readability)</span></label>
            <input type="range" min={0} max={85} value={textBgOpacity} onChange={(e) => setTextBgOpacity(Number(e.target.value))}
              className="w-full h-2 appearance-none bg-white/10 rounded-full cursor-pointer accent-green-500" />
          </div>

          {/* Card Size */}
          <div>
            <label className={lbl}>Card Size</label>
            <select value={cardHeight} onChange={(e) => setCardHeight(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 cursor-pointer appearance-none">
              {CARD_HEIGHT_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-[#1e1f22]">{o.label}</option>)}
            </select>
          </div>
        </GlassCard>

        {/* Gradient & Background */}
        <GlassCard className="p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-300">Background</h4>

          <div>
            <label className={lbl}>Gradient Colours &amp; Opacity</label>
            <div className="flex flex-col gap-2.5 mb-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 w-5 flex-shrink-0">From</label>
                <input type="color" value={gradientFrom} onChange={(e) => setGradientFrom(e.target.value)} className="w-10 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer p-0.5 flex-shrink-0" />
                <span className="text-xs text-gray-500 font-mono w-14 flex-shrink-0">{gradientFrom}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">α {gradientFromAlpha}%</span>
                <input type="range" min={0} max={100} value={gradientFromAlpha} onChange={(e) => setGradientFromAlpha(Number(e.target.value))}
                  className="flex-1 h-1.5 appearance-none bg-white/10 rounded-full cursor-pointer accent-green-500" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 w-5 flex-shrink-0">To</label>
                <input type="color" value={gradientTo} onChange={(e) => setGradientTo(e.target.value)} className="w-10 h-8 rounded-lg border border-white/10 bg-transparent cursor-pointer p-0.5 flex-shrink-0" />
                <span className="text-xs text-gray-500 font-mono w-14 flex-shrink-0">{gradientTo}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">α {gradientToAlpha}%</span>
                <input type="range" min={0} max={100} value={gradientToAlpha} onChange={(e) => setGradientToAlpha(Number(e.target.value))}
                  className="flex-1 h-1.5 appearance-none bg-white/10 rounded-full cursor-pointer accent-green-500" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CARD_GRADIENT_PRESETS.map((p) => (
                <button key={p.label} type="button" title={p.label} onClick={() => { setGradientFrom(p.from); setGradientTo(p.to); }}
                  style={{ background: `linear-gradient(90deg, ${p.from}, ${p.to})` }}
                  className="w-8 h-6 rounded-md border border-white/20 cursor-pointer hover:scale-110 transition-transform" />
              ))}
            </div>
          </div>

          <div>
            <label className={lbl}>Background Image URL <span className="text-gray-500 font-normal">(icon, side, or full-bleed)</span></label>
            <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... (empty = bot avatar for left/right)" className={inp} />
          </div>
          <div>
            <label className={lbl}>Image Position</label>
            <div className="grid grid-cols-4 gap-2">
              {(['left', 'right', 'background', 'none'] as const).map((pos) => (
                <button key={pos} type="button" onClick={() => setImagePosition(pos)}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all cursor-pointer capitalize ${imagePosition === pos ? 'bg-green-500/20 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {(imagePosition === 'background' || imagePosition === 'none') && (
            <div>
              <label className={lbl}>Text Alignment</label>
              <div className="flex gap-2">
                {(['left', 'center'] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setTextAlign(a)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all cursor-pointer capitalize ${textAlign === a ? 'bg-green-500/20 border-green-500/40 text-green-400' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className={lbl}>Featured Image <span className="text-gray-500 font-normal">(shown inside card, below text)</span></label>
            <input type="url" value={featuredImageUrl} onChange={(e) => setFeaturedImageUrl(e.target.value)} placeholder="https://... (game screenshot, banner, etc.)" className={inp} />
          </div>

          <div>
            <label className={lbl}>Logo / Overlay Icon <span className="text-gray-500 font-normal">(top-right corner, over text)</span></label>
            <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." className={inp} />
          </div>
        </GlassCard>

        {/* Link Buttons */}
        <GlassCard className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5"><Link01 className="w-4 h-4 text-gray-400" /> Buttons ({components.length}/{MAX_ROWS})</h4>
            {components.length < MAX_ROWS && <button type="button" onClick={addRow} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors cursor-pointer"><Plus className="w-3 h-3" /> Add Row</button>}
          </div>
          {components.length === 0 && <p className="text-gray-600 text-xs italic">No button rows yet</p>}
          {components.map((row, ri) => <ButtonRowEditor key={ri} row={row} rowIndex={ri} onChange={(u) => updateRow(ri, u)} onRemoveRow={() => removeRow(ri)} />)}
          <p className="text-xs text-gray-600">Buttons require a URL — they open the link when clicked.</p>
        </GlassCard>

        {/* Reactions */}
        <GlassCard className="p-5">
          <ReactionsEditor reactions={reactions} onChange={setReactions} />
        </GlassCard>

        {/* Post */}
        {feedback && (
          <div className={`px-4 py-3 rounded-xl text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
            {feedback.message}
          </div>
        )}
        <button type="button" onClick={handlePost} disabled={sending}
          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors text-sm cursor-pointer">
          <Send01 className="w-4 h-4" />
          {sending ? 'Queuing...' : 'Post Card'}
        </button>

        {/* Saved Designs */}
        <GlassCard className="p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5"><Save01 className="w-4 h-4 text-gray-400" /> Saved Designs</h4>
          <div className="flex gap-2">
            <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveDesign()} placeholder="Design name..." className={inpSm + ' flex-1'} maxLength={40} />
            <button type="button" onClick={saveDesign} disabled={!saveName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
              <Save01 className="w-3.5 h-3.5" /> Save
            </button>
          </div>
          {savesLoading && <p className="text-gray-600 text-xs italic">Loading saves...</p>}
          {!savesLoading && saves.length === 0 && <p className="text-gray-600 text-xs italic">No saved designs yet</p>}
          {saves.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {saves.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white/5 border border-white/5">
                  <span className="text-xs text-gray-300 truncate flex-1">{s.name as string}</span>
                  <span className="text-xs text-gray-600 flex-shrink-0">{new Date(s.createdAt).toLocaleDateString()}</span>
                  <button type="button" onClick={() => applySave(s)} className="text-xs text-green-400 hover:text-green-300 transition-colors cursor-pointer flex-shrink-0">Load</button>
                  <button type="button" onClick={() => deleteSave(s.id)} className="text-xs text-gray-500 hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"><XClose className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* ── Right: Preview ── */}
      <div className="space-y-4 lg:sticky lg:top-28">
        <GlassCard className="p-5 space-y-3">
          <h4 className="text-sm font-semibold text-gray-300">Live Preview</h4>
          <div className="rounded-xl overflow-hidden bg-black/20">
            <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>

          {/* Buttons + Reactions DOM Preview */}
          {(components.some((r) => r.some((b) => b.label.trim() || b.emoji)) || reactions.length > 0) && (
            <div className="pt-1 space-y-2">
              {components.map((row, ri) => {
                const visible = row.filter((b) => b.label.trim() || b.emoji);
                if (!visible.length) return null;
                return (
                  <div key={ri} className="flex gap-2 flex-wrap">
                    {visible.map((btn, bi) => {
                      const cm = btn.emoji?.match(/(?:(.+):)?(\d{15,})$/);
                      const eid = cm?.[2];
                      const em = eid ? bot.emojis.find((e) => e.id === eid) : null;
                      return (
                        <div key={bi} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-xs font-medium select-none bg-[#4f545c]">
                          {eid ? (
                            <img src={`https://cdn.discordapp.com/emojis/${eid}.${em?.animated ? 'gif' : 'png'}?size=32`} alt="" className="w-4 h-4 object-contain flex-shrink-0" />
                          ) : btn.emoji ? (
                            <span className="text-sm leading-none">{btn.emoji}</span>
                          ) : null}
                          {btn.label && <span>{btn.label}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {reactions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {reactions.map((r, i) => {
                    const cm = r.match(/(?:(.+):)?(\d{15,})$/);
                    const eid = cm?.[2];
                    const em = eid ? bot.emojis.find((e) => e.id === eid) : null;
                    return (
                      <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/8 border border-white/10 text-xs text-gray-300">
                        {eid ? (
                          <img src={`https://cdn.discordapp.com/emojis/${eid}.${em?.animated ? 'gif' : 'png'}?size=32`} alt="" className="w-4 h-4 object-contain" />
                        ) : (
                          <span className="text-base leading-none">{r}</span>
                        )}
                        <span className="text-gray-400 ml-0.5">1</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500">Bot avatar shows for icon positions when no image URL is set.</p>
        </GlassCard>
      </div>
    </div>
  );
}

const TAB_ITEMS = [
  { id: 'announcements', label: 'Announcements' },
  { id: 'cards', label: 'Discord Cards' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'admin', label: 'Admin' },
];

const ADMIN_TAB_KEY = 'tb_admin_tab';

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(ADMIN_TAB_KEY) || 'announcements');

  const handleTabChange = (key: any) => {
    const id = String(key);
    setActiveTab(id);
    localStorage.setItem(ADMIN_TAB_KEY, id);
  };

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
          <Tabs selectedKey={activeTab} onSelectionChange={handleTabChange}>
            <TabList items={TAB_ITEMS} type="underline" size="md" className="mb-6">
              {TAB_ITEMS.map((tab) => (
                <Tab key={tab.id} id={tab.id}>
                  {tab.id === 'announcements' && <Bell01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.id === 'cards' && <Image01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.id === 'tickets' && <MessageSquare01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.id === 'reviews' && <Star01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.id === 'analytics' && <BarChart01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.id === 'admin' && <Users01 className="w-4 h-4 mr-1.5 inline-block" />}
                  {tab.label}
                </Tab>
              ))}
            </TabList>
            <TabPanel id="announcements" className="mt-2"><AnnouncementsTab /></TabPanel>
            <TabPanel id="cards" className="mt-2"><DiscordCardsTab /></TabPanel>
            <TabPanel id="tickets" className="mt-2"><TicketsTab /></TabPanel>
            <TabPanel id="reviews" className="mt-2"><ReviewsTab /></TabPanel>
            <TabPanel id="analytics" className="mt-2"><AnalyticsTab /></TabPanel>
            <TabPanel id="admin" className="mt-2"><AdminManagementTab /></TabPanel>
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
