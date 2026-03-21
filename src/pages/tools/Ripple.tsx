import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Radio, ArrowLeft, Settings, ChevronDown, Plus, Trash2, Send, CheckCircle, XCircle, Loader2, X } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CoreMsg { title: string; body: string; linkUrl: string; imageUrl: string; }
interface EmbedField { id: string; name: string; value: string; inline: boolean; }
interface Embed {
  id: string; color: string; title: string; url: string;
  author: { name: string; icon_url: string };
  description: string; fields: EmbedField[];
  image: string; thumbnail: string;
  footer: { text: string; icon_url: string; timestamp: string };
}
interface BtnItem { emoji: string; label: string; url: string; }
interface DiscordMsg { displayName: string; avatarUrl: string; content: string; embeds: Embed[]; buttons: BtnItem[][]; }
interface TelegramMsg { text: string; imageUrl: string; silent: boolean; disablePreview: boolean; }
interface BlueskyMsg { text: string; }
interface Creds {
  discord: { webhookUrl: string };
  telegram: { botToken: string; chatId: string };
  bluesky: { handle: string; appPassword: string };
}
interface SendResult { platform: string; ok: boolean; message: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 9); }
function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function bskyCharCount(t: string) { return [...t].length; }

function buildDcText(m: CoreMsg) {
  const p: string[] = [];
  if (m.title) p.push('**' + m.title + '**');
  if (m.body) p.push(m.body);
  if (m.linkUrl) p.push(m.linkUrl);
  return p.join('\n\n');
}
function buildTgText(m: CoreMsg) {
  const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p: string[] = [];
  if (m.title) p.push('<b>' + e(m.title) + '</b>');
  if (m.body) p.push(e(m.body));
  if (m.linkUrl) p.push(m.linkUrl);
  return p.join('\n\n');
}
function buildBsText(m: CoreMsg) {
  const p: string[] = [];
  if (m.title) p.push(m.title);
  if (m.body) p.push(m.body);
  if (m.linkUrl) p.push(m.linkUrl);
  return p.join('\n\n');
}

function dcInline(s: string) {
  return s
    .replace(/\|\|(.+?)\|\|/g, '<span style="background:#2e2e2e;color:#2e2e2e;border-radius:3px;padding:0 2px" title="Spoiler">$1</span>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.3);padding:1px 4px;border-radius:3px;font-size:87%;font-family:monospace">$1</code>');
}

function dcMarkdown(text: string) {
  if (!text) return '';
  let html = '';
  text.split('\n').forEach(line => {
    if (/^### /.test(line)) html += '<div style="font-size:.9em;font-weight:700;color:#dbdee1;margin:2px 0">' + dcInline(esc(line.slice(4))) + '</div>';
    else if (/^## /.test(line)) html += '<div style="font-size:1em;font-weight:700;color:#dbdee1;margin:2px 0">' + dcInline(esc(line.slice(3))) + '</div>';
    else if (/^# /.test(line)) html += '<div style="font-size:1.1em;font-weight:700;color:#dbdee1;margin:3px 0">' + dcInline(esc(line.slice(2))) + '</div>';
    else if (/^> /.test(line)) html += '<div style="border-left:3px solid #4e5058;padding-left:8px;margin:2px 0;color:#adb3b9">' + dcInline(esc(line.slice(2))) + '</div>';
    else if (/^-# /.test(line)) html += '<div style="font-size:11px;color:#87898c;margin:1px 0">' + dcInline(esc(line.slice(3))) + '</div>';
    else if (/^[-*] /.test(line)) html += '<div style="margin:1px 0 1px 12px">• ' + dcInline(esc(line.slice(2))) + '</div>';
    else if (/^\d+\. /.test(line)) {
      const m = line.match(/^(\d+)\. (.*)/);
      if (m) html += '<div style="margin:1px 0 1px 12px">' + esc(m[1]) + '. ' + dcInline(esc(m[2])) + '</div>';
    } else if (line === '') html += '<div style="height:0.5em"></div>';
    else html += '<div style="min-height:1.2em">' + dcInline(esc(line)) + '</div>';
  });
  return html;
}

function buildDcPreviewHtml(dc: DiscordMsg) {
  const { content, embeds, buttons, displayName, avatarUrl } = dc;
  const hasContent = content && content.trim();
  const hasEmbeds = embeds && embeds.length > 0;
  const hasButtons = buttons && buttons.length > 0 && buttons.some(r => r.some(b => b.label));
  if (!hasContent && !hasEmbeds && !hasButtons)
    return '<p style="color:#6b7280;font-size:13px;text-align:center;padding:20px 0">Fill in the editor to see a preview</p>';
  let html = '';
  const now = new Date();
  const h = now.getHours(), mm = String(now.getMinutes()).padStart(2, '0'), ampm = h >= 12 ? 'PM' : 'AM';
  if (hasContent) {
    const pName = displayName || 'TrueBeast';
    const initials = pName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
    const av = avatarUrl
      ? '<img src="' + esc(avatarUrl) + '" onerror="this.style.display=\'none\'" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0" />'
      : '<div style="width:40px;height:40px;border-radius:50%;background:#7c3aed;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white">' + initials + '</div>';
    html += '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:4px">' + av + '<div><div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:2px">' + esc(pName) + '</div><div style="font-size:11px;color:#87898c">Today at ' + h + ':' + mm + ' ' + ampm + '</div></div></div>';
    html += '<div style="color:#dbdee1;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;margin-bottom:6px">' + dcMarkdown(content) + '</div>';
  }
  if (hasEmbeds) {
    embeds.forEach(e => {
      const col = e.color || '#5865f2';
      let h2 = '<div style="background:#2b2d31;border-radius:4px;overflow:hidden;margin-bottom:6px;max-width:520px"><div style="display:flex"><div style="width:4px;flex-shrink:0;background:' + esc(col) + '"></div><div style="padding:10px 14px 10px 10px;flex:1;min-width:0"><div style="display:flex;gap:10px"><div style="flex:1;min-width:0">';
      if (e.author?.name) {
        h2 += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
        if (e.author.icon_url) h2 += '<img src="' + esc(e.author.icon_url) + '" onerror="this.style.display=\'none\'" style="width:22px;height:22px;border-radius:50%" />';
        h2 += '<span style="color:#dbdee1;font-size:13px;font-weight:600">' + esc(e.author.name) + '</span></div>';
      }
      if (e.title) {
        if (e.url) h2 += '<div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px"><a href="' + esc(e.url) + '" style="color:#00aff4;text-decoration:none" target="_blank">' + esc(e.title) + '</a></div>';
        else h2 += '<div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">' + esc(e.title) + '</div>';
      }
      if (e.description) h2 += '<div style="color:#dbdee1;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">' + dcMarkdown(e.description) + '</div>';
      if (e.fields?.length) {
        h2 += '<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">';
        let buf: EmbedField[] = [];
        const flushBuf = () => {
          if (!buf.length) return;
          h2 += '<div style="display:grid;grid-template-columns:repeat(' + Math.min(buf.length, 3) + ',1fr);gap:8px">';
          buf.forEach(f => { h2 += '<div><div style="color:#dbdee1;font-size:13px;font-weight:700;margin-bottom:2px">' + esc(f.name) + '</div><div style="color:#b5bac1;font-size:13px;line-height:1.4">' + dcMarkdown(f.value) + '</div></div>'; });
          h2 += '</div>'; buf = [];
        };
        e.fields.forEach(f => {
          if (f.inline) { buf.push(f); }
          else { flushBuf(); h2 += '<div><div style="color:#dbdee1;font-size:13px;font-weight:700;margin-bottom:2px">' + esc(f.name) + '</div><div style="color:#b5bac1;font-size:13px;line-height:1.4">' + dcMarkdown(f.value) + '</div></div>'; }
        });
        flushBuf();
        h2 += '</div>';
      }
      h2 += '</div>';
      if (e.thumbnail) h2 += '<div><img src="' + esc(e.thumbnail) + '" onerror="this.style.display=\'none\'" style="width:80px;height:80px;border-radius:4px;object-fit:cover;flex-shrink:0" /></div>';
      h2 += '</div>';
      if (e.image) h2 += '<img src="' + esc(e.image) + '" onerror="this.style.display=\'none\'" style="width:100%;border-radius:4px;margin-top:8px;max-height:280px;object-fit:contain" />';
      if (e.footer?.text || e.footer?.timestamp) {
        h2 += '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">';
        if (e.footer.icon_url) h2 += '<img src="' + esc(e.footer.icon_url) + '" onerror="this.style.display=\'none\'" style="width:18px;height:18px;border-radius:50%" />';
        if (e.footer.text) h2 += '<span style="color:#87898c;font-size:12px">' + esc(e.footer.text) + '</span>';
        if (e.footer.text && e.footer.timestamp) h2 += '<span style="color:#87898c;font-size:12px">•</span>';
        if (e.footer.timestamp) h2 += '<span style="color:#87898c;font-size:12px">' + esc(new Date(e.footer.timestamp).toLocaleString()) + '</span>';
        h2 += '</div>';
      }
      h2 += '</div></div></div>';
      html += h2;
    });
  }
  if (hasButtons) {
    buttons.forEach(row => {
      const vis = row.filter(b => b.label);
      if (!vis.length) return;
      html += '<div style="margin-bottom:4px">';
      vis.forEach(b => {
        html += '<a style="display:inline-flex;align-items:center;gap:4px;background:#5865f2;color:#fff;border-radius:3px;padding:5px 14px;font-size:13px;font-weight:500;text-decoration:none;margin:2px" href="' + esc(b.url || '#') + '" target="_blank">';
        if (b.emoji) html += '<span>' + esc(b.emoji) + '</span>';
        html += esc(b.label) + '</a>';
      });
      html += '</div>';
    });
  }
  return html;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiSendDiscord(webhookUrl: string, dc: DiscordMsg): Promise<void> {
  const filteredEmbeds = (dc.embeds || [])
    .filter(e => e.title || e.description || e.author?.name || e.fields?.length)
    .map(e => {
      const obj: Record<string, unknown> = {};
      if (e.color) obj.color = parseInt(e.color.replace('#', ''), 16);
      if (e.title) obj.title = e.title;
      if (e.url) obj.url = e.url;
      if (e.author?.name) { obj.author = { name: e.author.name, ...(e.author.icon_url ? { icon_url: e.author.icon_url } : {}) }; }
      if (e.description) obj.description = e.description;
      if (e.fields?.length) obj.fields = e.fields.map(f => ({ name: f.name, value: f.value, inline: !!f.inline }));
      if (e.image) obj.image = { url: e.image };
      if (e.thumbnail) obj.thumbnail = { url: e.thumbnail };
      if (e.footer?.text || e.footer?.timestamp) {
        const footer: Record<string, unknown> = {};
        if (e.footer.text) footer.text = e.footer.text;
        if (e.footer.icon_url) footer.icon_url = e.footer.icon_url;
        if (e.footer.timestamp) obj.timestamp = new Date(e.footer.timestamp).toISOString();
        obj.footer = footer;
      }
      return obj;
    });
  const filteredComponents = (dc.buttons || [])
    .filter(row => row.some(b => b.label))
    .map(row => ({ type: 1, components: row.filter(b => b.label).map(b => { const btn: Record<string, unknown> = { type: 2, style: 5, label: b.label, url: b.url || 'https://truebeast.io' }; if (b.emoji) btn.emoji = { name: b.emoji }; return btn; }) }));
  const payload: Record<string, unknown> = {};
  if (dc.displayName) payload.username = dc.displayName;
  if (dc.avatarUrl) payload.avatar_url = dc.avatarUrl;
  if (dc.content) payload.content = dc.content;
  if (filteredEmbeds.length) payload.embeds = filteredEmbeds;
  if (filteredComponents.length) payload.components = filteredComponents;
  const url = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'wait=true&with_components=true';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.status === 200 || res.status === 204) return;
  let errBody: { message?: string } = {};
  try { errBody = await res.json(); } catch { /* ignore */ }
  throw new Error(errBody.message ?? 'HTTP ' + res.status);
}

async function apiSendTelegram(botToken: string, chatId: string, tg: TelegramMsg): Promise<void> {
  let url: string, body: Record<string, unknown>;
  if (tg.imageUrl) {
    url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    body = { chat_id: chatId, photo: tg.imageUrl, caption: tg.text.slice(0, 1024), parse_mode: 'HTML', disable_notification: !!tg.silent };
  } else {
    url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    body = { chat_id: chatId, text: tg.text, parse_mode: 'HTML', disable_web_page_preview: !!tg.disablePreview, disable_notification: !!tg.silent };
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram send failed');
}

async function apiSendBluesky(handle: string, appPassword: string, text: string): Promise<void> {
  const sRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: handle, password: appPassword }) });
  if (!sRes.ok) { let msg = 'Bluesky login failed'; try { const d = await sRes.json(); if (d.message) msg = d.message; } catch { /* ignore */ } throw new Error(msg); }
  const { accessJwt, did } = await sRes.json();
  const pRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessJwt }, body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() } }) });
  if (!pRes.ok) { let msg = 'Bluesky post failed'; try { const d = await pRes.json(); if (d.message) msg = d.message; } catch { /* ignore */ } throw new Error(msg); }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function newEmbed(): Embed { return { id: genId(), color: '#5865f2', title: '', url: '', author: { name: '', icon_url: '' }, description: '', fields: [], image: '', thumbnail: '', footer: { text: '', icon_url: '', timestamp: '' } }; }
function newField(): EmbedField { return { id: genId(), name: '', value: '', inline: false }; }
function newButton(): BtnItem { return { emoji: '', label: '', url: '' }; }
function newButtonRow(): BtnItem[] { return [newButton()]; }

// ── Small UI ──────────────────────────────────────────────────────────────────

const IC = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/50 transition-colors';
const IC_SM = 'w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/50 transition-colors';

function Tog({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} role="switch" aria-checked={on} style={{ width: 38, height: 22, background: on ? '#7c3aed' : 'rgba(255,255,255,0.1)', borderRadius: 11, position: 'relative', flexShrink: 0, cursor: 'pointer', border: 'none', transition: 'background 0.2s' }}>
      <span style={{ position: 'absolute', left: on ? 19 : 3, top: 3, width: 16, height: 16, background: 'white', borderRadius: '50%', transition: 'left 0.2s' }} />
    </button>
  );
}

function FL({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{children}</label>;
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-bold tracking-widest text-violet-400 uppercase block mb-1">{children}</span>;
}

function BtnXs({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', transition: 'all 0.15s' }}>
      {children}
    </button>
  );
}

function BtnSm({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', transition: 'all 0.15s' }}>
      {children}
    </button>
  );
}

// ── EmbedEditor ───────────────────────────────────────────────────────────────

function EmbedEditor({ embed, onChange, onRemove, onSyncCore }: { embed: Embed; onChange: (e: Embed) => void; onRemove: () => void; onSyncCore: () => void }) {
  const [open, setOpen] = useState(true);
  const upd = (k: keyof Embed, v: unknown) => onChange({ ...embed, [k]: v });
  const updAuthor = (k: 'name' | 'icon_url', v: string) => onChange({ ...embed, author: { ...embed.author, [k]: v } });
  const updFooter = (k: 'text' | 'icon_url' | 'timestamp', v: string) => onChange({ ...embed, footer: { ...embed.footer, [k]: v } });
  const addField = () => upd('fields', [...embed.fields, newField()]);
  const updField = (i: number, k: keyof EmbedField, v: unknown) => upd('fields', embed.fields.map((f, j) => j === i ? { ...f, [k]: v } : f));
  const removeField = (i: number) => upd('fields', embed.fields.filter((_, j) => j !== i));
  const label = (embed.title || embed.description || 'Embed').slice(0, 30) || 'Embed';

  return (
    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(255,255,255,0.2)', background: embed.color }} />
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <button style={{ background: 'rgba(147,51,234,0.1)', border: '1px solid rgba(147,51,234,0.25)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#c084fc', cursor: 'pointer', marginRight: 4, fontFamily: 'inherit' }} onClick={e => { e.stopPropagation(); onSyncCore(); }}>Sync Core</button>
        <button style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '2px 6px', color: '#f87171', cursor: 'pointer', marginRight: 4, display: 'inline-flex', alignItems: 'center' }} onClick={e => { e.stopPropagation(); onRemove(); }}><Trash2 size={11} /></button>
        <ChevronDown size={15} style={{ color: '#6b7280', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s', flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Color */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <FL>Color</FL>
            <input type="color" value={embed.color} onChange={e => upd('color', e.target.value)} style={{ width: 32, height: 26, padding: 1, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, background: 'none', cursor: 'pointer' }} />
            <span style={{ fontSize: 12, opacity: 0.5 }}>{embed.color}</span>
          </div>
          {/* Title / URL */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Title</FL><input className={IC_SM} value={embed.title} onChange={e => upd('title', e.target.value)} placeholder="Embed title" /></div>
            <div><FL>Title URL</FL><input className={IC_SM} value={embed.url} onChange={e => upd('url', e.target.value)} placeholder="https://..." /></div>
          </div>
          {/* Author */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 6px' }}>Author</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Name</FL><input className={IC_SM} value={embed.author.name} onChange={e => updAuthor('name', e.target.value)} placeholder="Author name" /></div>
            <div><FL>Icon URL</FL><input className={IC_SM} value={embed.author.icon_url} onChange={e => updAuthor('icon_url', e.target.value)} placeholder="https://..." /></div>
          </div>
          {/* Description */}
          <div style={{ marginBottom: 8 }}>
            <FL>Description</FL>
            <textarea className={IC_SM + ' resize-y'} rows={3} value={embed.description} onChange={e => upd('description', e.target.value)} placeholder="Embed body text..." />
          </div>
          {/* Fields */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 6px' }}>Fields</div>
          {embed.fields.map((f, i) => (
            <div key={f.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><FL>Name</FL><input className={IC_SM} value={f.name} onChange={e => updField(i, 'name', e.target.value)} placeholder="Name" /></div>
                <div><FL>Value</FL><input className={IC_SM} value={f.value} onChange={e => updField(i, 'value', e.target.value)} placeholder="Value" /></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.inline} onChange={e => updField(i, 'inline', e.target.checked)} />Inline
                </label>
                <button style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '3px 5px', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => removeField(i)}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}
          {embed.fields.length < 25 && <BtnSm onClick={addField}><Plus size={11} /> Add Field</BtnSm>}
          {/* Images */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 6px' }}>Images</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Large Image URL</FL><input className={IC_SM} value={embed.image} onChange={e => upd('image', e.target.value)} placeholder="https://..." /></div>
            <div><FL>Thumbnail URL</FL><input className={IC_SM} value={embed.thumbnail} onChange={e => upd('thumbnail', e.target.value)} placeholder="https://..." /></div>
          </div>
          {/* Footer */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', margin: '12px 0 6px' }}>Footer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><FL>Footer Text</FL><input className={IC_SM} value={embed.footer.text} onChange={e => updFooter('text', e.target.value)} placeholder="Footer text" /></div>
            <div><FL>Footer Icon URL</FL><input className={IC_SM} value={embed.footer.icon_url} onChange={e => updFooter('icon_url', e.target.value)} placeholder="https://..." /></div>
          </div>
          <div><FL>Timestamp</FL><input className={IC_SM} type="datetime-local" value={embed.footer.timestamp} onChange={e => updFooter('timestamp', e.target.value)} /></div>
        </div>
      )}
    </div>
  );
}

// ── ButtonsEditor ─────────────────────────────────────────────────────────────

function ButtonsEditor({ buttons, onChange }: { buttons: BtnItem[][]; onChange: (b: BtnItem[][]) => void }) {
  const addRow = () => onChange([...buttons, newButtonRow()]);
  const removeRow = (ri: number) => onChange(buttons.filter((_, i) => i !== ri));
  const addBtn = (ri: number) => { const r = buttons.map((row, i) => i === ri ? [...row, newButton()] : row); onChange(r); };
  const removeBtn = (ri: number, bi: number) => onChange(buttons.map((row, i) => i === ri ? row.filter((_, j) => j !== bi) : row).filter(row => row.length > 0));
  const updBtn = (ri: number, bi: number, k: keyof BtnItem, v: string) => onChange(buttons.map((row, i) => i === ri ? row.map((b, j) => j === bi ? { ...b, [k]: v } : b) : row));

  return (
    <div>
      {buttons.map((row, ri) => (
        <div key={ri} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em' }}>Row {ri + 1}</span>
            <button style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '3px 5px', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => removeRow(ri)}><Trash2 size={11} /></button>
          </div>
          {row.map((btn, bi) => (
            <div key={bi} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 28px', gap: 4, marginBottom: 4, alignItems: 'center' }}>
              <input className={IC_SM} value={btn.emoji} onChange={e => updBtn(ri, bi, 'emoji', e.target.value)} placeholder="😀" style={{ textAlign: 'center', padding: '4px 6px', fontSize: 16 }} />
              <input className={IC_SM} value={btn.label} onChange={e => updBtn(ri, bi, 'label', e.target.value)} placeholder="Label" />
              <input className={IC_SM} value={btn.url} onChange={e => updBtn(ri, bi, 'url', e.target.value)} placeholder="https://..." />
              <button style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '4px', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => removeBtn(ri, bi)}><Trash2 size={11} /></button>
            </div>
          ))}
          {row.length < 5 && <BtnXs onClick={() => addBtn(ri)}><Plus size={10} /> Button</BtnXs>}
        </div>
      ))}
      {buttons.length < 5 && <BtnSm onClick={addRow}><Plus size={11} /> Add Button Row</BtnSm>}
    </div>
  );
}

// ── DiscordEditor ─────────────────────────────────────────────────────────────

function DiscordEditor({ dc, onChange, coreMsg, enabled, onToggle }: { dc: DiscordMsg; onChange: (d: DiscordMsg) => void; coreMsg: CoreMsg; enabled: boolean; onToggle: () => void }) {
  const upd = (k: keyof DiscordMsg, v: unknown) => onChange({ ...dc, [k]: v });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, marginBottom: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg style={{ width: 20, height: 20, flexShrink: 0 }} viewBox="0 0 24 24" fill="#5865F2"><path fillRule="evenodd" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
          <div><div style={{ fontSize: 14, fontWeight: 700 }}>Discord</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Webhook</div></div>
        </div>
        <Tog on={enabled} onToggle={onToggle} />
      </div>
      {enabled && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div><FL>Display Name</FL><input className={IC} value={dc.displayName} onChange={e => upd('displayName', e.target.value)} placeholder="TrueBeast Announcements" /></div>
            <div><FL>Icon URL</FL><input className={IC} value={dc.avatarUrl} onChange={e => upd('avatarUrl', e.target.value)} placeholder="https://..." /></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <FL>Message Content</FL>
            <BtnXs onClick={() => upd('content', buildDcText(coreMsg))}>Sync from Core</BtnXs>
          </div>
          <textarea className={IC + ' resize-y'} rows={4} value={dc.content} onChange={e => upd('content', e.target.value)} placeholder="Message content (Discord markdown)..." />
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 12, marginTop: 4 }}>Tip: **bold**, *italic*, ~~strike~~, `code`, ||spoiler||</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <FL>Embeds ({(dc.embeds || []).length}/10)</FL>
            {(dc.embeds || []).length < 10 && <BtnXs onClick={() => upd('embeds', [...(dc.embeds || []), newEmbed()])}><Plus size={10} /> Add Embed</BtnXs>}
          </div>
          {(dc.embeds || []).map((emb, i) => (
            <EmbedEditor key={emb.id} embed={emb} onChange={e => upd('embeds', (dc.embeds || []).map((x, j) => j === i ? e : x))} onRemove={() => upd('embeds', (dc.embeds || []).filter((_, j) => j !== i))} onSyncCore={() => upd('embeds', (dc.embeds || []).map((x, j) => j === i ? { ...x, title: coreMsg.title, description: coreMsg.body, url: coreMsg.linkUrl, image: coreMsg.imageUrl || x.image } : x))} />
          ))}
          <div style={{ marginTop: 12 }}>
            <FL>Link Buttons</FL>
            <ButtonsEditor buttons={dc.buttons || []} onChange={b => upd('buttons', b)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── TelegramEditor ────────────────────────────────────────────────────────────

function TelegramEditor({ tg, onChange, coreMsg, enabled, onToggle }: { tg: TelegramMsg; onChange: (t: TelegramMsg) => void; coreMsg: CoreMsg; enabled: boolean; onToggle: () => void }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const upd = (k: keyof TelegramMsg, v: unknown) => onChange({ ...tg, [k]: v });
  const insertFmt = (before: string, after: string) => {
    const ta = textRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, val = tg.text || '';
    const newVal = val.slice(0, s) + before + val.slice(s, e) + after + val.slice(e);
    onChange({ ...tg, text: newVal });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + before.length, e + before.length); }, 0);
  };
  const insertLink = () => {
    const url = window.prompt('Enter URL:'); if (!url) return;
    const ta = textRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, val = tg.text || '';
    const selected = val.slice(s, e) || 'link text';
    onChange({ ...tg, text: val.slice(0, s) + '<a href="' + url + '">' + selected + '</a>' + val.slice(e) });
  };
  const charLen = (tg.text || '').length;
  const maxLen = tg.imageUrl ? 1024 : 4096;
  const fmtBtn = 'px-2 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer border';
  const fmtBtnStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 9px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, marginBottom: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg style={{ width: 20, height: 20, flexShrink: 0 }} viewBox="0 0 24 24" fill="#26A5E4"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
          <div><div style={{ fontSize: 14, fontWeight: 700 }}>Telegram</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Bot API</div></div>
        </div>
        <Tog on={enabled} onToggle={onToggle} />
      </div>
      {enabled && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <FL>Message (HTML)</FL>
            <BtnXs onClick={() => upd('text', buildTgText(coreMsg))}>Sync from Core</BtnXs>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {[['<b>', '</b>', 'B', 'font-bold'], ['<i>', '</i>', 'I', 'italic'], ['<u>', '</u>', 'U', 'underline'], ['<s>', '</s>', 'S', 'line-through'], ['<code>', '</code>', 'code', 'font-mono text-[11px]'], ['<pre>', '</pre>', 'pre', 'font-mono text-[11px]']].map(([bef, aft, lbl, cls]) => (
              <button key={lbl} style={fmtBtnStyle} className={cls} onClick={() => insertFmt(bef, aft)}>{lbl}</button>
            ))}
            <button style={fmtBtnStyle} onClick={insertLink}>link</button>
            <button style={fmtBtnStyle} onClick={() => insertFmt('<tg-spoiler>', '</tg-spoiler>')}>spoiler</button>
          </div>
          <textarea ref={textRef} className={IC + ' resize-y'} rows={5} value={tg.text || ''} onChange={e => upd('text', e.target.value)} placeholder="Telegram HTML message..." />
          <div style={{ fontSize: 11, textAlign: 'right', marginTop: 2, color: charLen > maxLen ? '#f87171' : charLen > maxLen * 0.9 ? '#facc15' : 'rgba(255,255,255,0.3)' }}>{charLen}/{maxLen}</div>
          <div style={{ marginTop: 10 }}><FL>Image URL (optional)</FL><input className={IC} value={tg.imageUrl || ''} onChange={e => upd('imageUrl', e.target.value)} placeholder="https://... (caption max 1024 chars when set)" /></div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!tg.silent} onChange={e => upd('silent', e.target.checked)} />Silent notification
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!tg.disablePreview} onChange={e => upd('disablePreview', e.target.checked)} />Disable link preview
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BlueskyEditor ─────────────────────────────────────────────────────────────

function BlueskyEditor({ bs, onChange, coreMsg, enabled, onToggle }: { bs: BlueskyMsg; onChange: (b: BlueskyMsg) => void; coreMsg: CoreMsg; enabled: boolean; onToggle: () => void }) {
  const upd = (k: keyof BlueskyMsg, v: string) => onChange({ ...bs, [k]: v });
  const charCount = bskyCharCount(bs.text || '');
  const pct = Math.min(charCount / 300 * 100, 100);
  const over = charCount > 300;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, marginBottom: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg style={{ width: 20, height: 20, flexShrink: 0 }} viewBox="0 0 600 530" fill="#0085FF"><path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49c26.262-54.316 97.782-155.54 164.28-205.46C512.26 8.009 590-19.862 590 68.825c0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.38-3.69-10.832-3.708-7.896-.017-2.936-1.193.516-3.707 7.896-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.45-163.25-81.433C20.153 217.613 10 86.535 10 68.825c0-88.687 77.742-60.816 125.72-24.795z" /></svg>
          <div><div style={{ fontSize: 14, fontWeight: 700 }}>Bluesky</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>AT Protocol</div></div>
        </div>
        <Tog on={enabled} onToggle={onToggle} />
      </div>
      {enabled && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <FL>Post Text</FL>
            <BtnXs onClick={() => upd('text', buildBsText(coreMsg))}>Sync from Core</BtnXs>
          </div>
          <textarea className={IC + ' resize-y'} rows={5} value={bs.text || ''} onChange={e => upd('text', e.target.value)} placeholder="Bluesky post text (300 grapheme limit)..." />
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, transition: 'width 0.2s', width: pct + '%', background: over ? '#f87171' : charCount > 270 ? '#facc15' : '#a855f7' }} />
          </div>
          <div style={{ fontSize: 11, textAlign: 'right', marginTop: 4, color: over ? '#f87171' : charCount > 270 ? '#facc15' : 'rgba(255,255,255,0.3)' }}>{charCount}/300{over ? ' — over limit!' : ''}</div>
        </div>
      )}
    </div>
  );
}

// ── CoreMessageEditor ─────────────────────────────────────────────────────────

function CoreMessageEditor({ msg, onChange }: { msg: CoreMsg; onChange: (m: CoreMsg) => void }) {
  const upd = (k: keyof CoreMsg, v: string) => onChange({ ...msg, [k]: v });
  return (
    <div className="glass rounded-2xl p-5 mb-3">
      <StepLabel>Core Message</StepLabel>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12 }}>Base content for all platforms. Use "Sync from Core" in each platform to pull it in.</p>
      <div style={{ marginBottom: 8 }}><FL>Title</FL><input className={IC} value={msg.title} onChange={e => upd('title', e.target.value)} placeholder="Announcement title (optional)" /></div>
      <div style={{ marginBottom: 8 }}><FL>Body *</FL><textarea className={IC + ' resize-y'} rows={4} value={msg.body} onChange={e => upd('body', e.target.value)} placeholder="Write your announcement here..." /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><FL>Link URL</FL><input className={IC} value={msg.linkUrl} onChange={e => upd('linkUrl', e.target.value)} placeholder="https://..." /></div>
        <div><FL>Image URL</FL><input className={IC} value={msg.imageUrl} onChange={e => upd('imageUrl', e.target.value)} placeholder="https://..." /></div>
      </div>
    </div>
  );
}

// ── Previews ──────────────────────────────────────────────────────────────────

function DiscordPreview({ dc, enabled }: { dc: DiscordMsg; enabled: boolean }) {
  const html = enabled ? buildDcPreviewHtml(dc) : '<p style="color:rgba(255,255,255,0.3);font-size:13px;text-align:center;padding:24px 0">Discord is disabled</p>';
  return (
    <div style={{ background: '#313338', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Discord Preview</div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function TelegramPreview({ tg, enabled }: { tg: TelegramMsg; enabled: boolean }) {
  if (!enabled) return <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Telegram is disabled</div>;
  const now = new Date();
  const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
  return (
    <div style={{ background: '#17212b', borderRadius: 12, padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Telegram Preview</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2b5278', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: 'white' }}>TB</div>
        <div><div style={{ fontSize: 14, fontWeight: 700, color: '#e8f0f7' }}>TrueBeast</div><div style={{ fontSize: 11, color: '#6b8fa9' }}>Channel</div></div>
      </div>
      <div style={{ background: '#1e2c3a', borderRadius: '0 10px 10px 10px', padding: '10px 12px' }}>
        {tg.imageUrl && <img src={tg.imageUrl} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 8, maxHeight: 220, objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        <div style={{ color: '#e8f0f7', fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: tg.text || '<span style="color:rgba(255,255,255,0.3)">No content yet...</span>' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#6b8fa9' }}>{timeStr}</span>
        </div>
      </div>
    </div>
  );
}

function BlueskyPreview({ bs, handle, enabled }: { bs: BlueskyMsg; handle: string; enabled: boolean }) {
  if (!enabled) return <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Bluesky is disabled</div>;
  const displayHandle = handle || 'you.bsky.social';
  return (
    <div style={{ background: '#0a1628', borderRadius: 12, padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Bluesky Preview</div>
      <div style={{ background: '#0f1e32', borderRadius: 12, padding: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0085ff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: 'white' }}>{displayHandle[0].toUpperCase()}</div>
          <div><div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>TrueBeast</div><div style={{ fontSize: 12, color: '#6b8fa9' }}>@{displayHandle}</div></div>
        </div>
        <div style={{ color: '#d8ecff', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 10 }}>{bs.text || <span style={{ color: 'rgba(255,255,255,0.3)' }}>No content yet...</span>}</div>
        <div style={{ display: 'flex', gap: 16, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {[['💬', 'Reply'], ['🔁', 'Repost'], ['❤️', 'Like']].map(([icon, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6b8fa9' }}>{icon} {label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ResultsPanel ──────────────────────────────────────────────────────────────

function ResultsPanel({ results, onClear }: { results: SendResult[] | null; onClear: () => void }) {
  if (!results) return null;
  return (
    <div className="glass rounded-2xl p-5 mt-3">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <StepLabel>Send Results</StepLabel>
        <BtnXs onClick={onClear}>Clear</BtnXs>
      </div>
      {results.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, marginBottom: 6, border: '1px solid transparent', background: r.ok ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', borderColor: r.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' }}>
          {r.ok ? <CheckCircle size={18} className="text-green-400 flex-shrink-0" /> : <XCircle size={18} className="text-red-400 flex-shrink-0" />}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{r.platform}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{r.ok ? 'Sent successfully' : r.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── CredentialsModal ──────────────────────────────────────────────────────────

function CredentialsModal({ creds, onSave, onClose }: { creds: Creds; onSave: (c: Creds) => void; onClose: () => void }) {
  const [form, setForm] = useState<Creds>({
    discord: { webhookUrl: creds.discord?.webhookUrl || '' },
    telegram: { botToken: creds.telegram?.botToken || '', chatId: creds.telegram?.chatId || '' },
    bluesky: { handle: creds.bluesky?.handle || '', appPassword: creds.bluesky?.appPassword || '' },
  });
  const updD = (k: keyof Creds['discord'], v: string) => setForm(f => ({ ...f, discord: { ...f.discord, [k]: v } }));
  const updT = (k: keyof Creds['telegram'], v: string) => setForm(f => ({ ...f, telegram: { ...f.telegram, [k]: v } }));
  const updB = (k: keyof Creds['bluesky'], v: string) => setForm(f => ({ ...f, bluesky: { ...f.bluesky, [k]: v } }));
  const save = () => { onSave(form); onClose(); };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#12121e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 28, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Platform Credentials</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 20, display: 'flex' }}><X size={20} /></button>
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 12px' }}>Stored in your browser only — never leaves your device.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <svg style={{ width: 20, height: 20 }} viewBox="0 0 24 24" fill="#5865F2"><path fillRule="evenodd" d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Discord</span>
        </div>
        <div style={{ marginBottom: 16 }}><FL>Webhook URL</FL><input className={IC} type="password" value={form.discord.webhookUrl} onChange={e => updD('webhookUrl', e.target.value)} placeholder="https://discord.com/api/webhooks/..." /></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <svg style={{ width: 20, height: 20 }} viewBox="0 0 24 24" fill="#26A5E4"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Telegram</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div><FL>Bot Token</FL><input className={IC} type="password" value={form.telegram.botToken} onChange={e => updT('botToken', e.target.value)} placeholder="1234567890:ABC..." /></div>
          <div><FL>Chat ID</FL><input className={IC} value={form.telegram.chatId} onChange={e => updT('chatId', e.target.value)} placeholder="-100123456789" /></div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <svg style={{ width: 20, height: 20 }} viewBox="0 0 600 530" fill="#0085FF"><path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49c26.262-54.316 97.782-155.54 164.28-205.46C512.26 8.009 590-19.862 590 68.825c0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.38-3.69-10.832-3.708-7.896-.017-2.936-1.193.516-3.707 7.896-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.45-163.25-81.433C20.153 217.613 10 86.535 10 68.825c0-88.687 77.742-60.816 125.72-24.795z" /></svg>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Bluesky</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
          <div><FL>Handle</FL><input className={IC} value={form.bluesky.handle} onChange={e => updB('handle', e.target.value)} placeholder="you.bsky.social" /></div>
          <div><FL>App Password</FL><input className={IC} type="password" value={form.bluesky.appPassword} onChange={e => updB('appPassword', e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" /></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: 'white', fontWeight: 700, border: 'none', borderRadius: 12, padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>Save Credentials</button>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', fontSize: 14 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const CREDS_KEY = 'ripple-creds';
const defaultCreds: Creds = { discord: { webhookUrl: '' }, telegram: { botToken: '', chatId: '' }, bluesky: { handle: '', appPassword: '' } };

export default function Ripple() {
  const [creds, setCreds] = useState<Creds>(() => { try { return { ...defaultCreds, ...JSON.parse(localStorage.getItem(CREDS_KEY) || '{}') }; } catch { return defaultCreds; } });
  const [msg, setMsg] = useState<CoreMsg>({
    title: '🎉 Example Announcement',
    body: "This is your core message — write it once here and sync it to each platform below. Edit any platform independently to tailor the tone.\n\nDelete this and start fresh whenever you're ready.",
    linkUrl: 'https://truebeast.io',
    imageUrl: '',
  });
  const [enabled, setEnabled] = useState({ discord: true, telegram: true, bluesky: true });
  const [dc, setDc] = useState<DiscordMsg>({
    displayName: 'TrueBeast',
    avatarUrl: '',
    content: '**🎉 Example Announcement**\n\nThis is a Discord message with **bold**, *italic*, ~~strikethrough~~, and `inline code`.\n\n> Block quotes look like this\n\nhttps://truebeast.io',
    embeds: [{
      ...newEmbed(),
      color: '#7c3aed',
      title: 'This is an embed title',
      url: 'https://truebeast.io',
      description: 'Embeds can have a description, fields, images, and a footer. Use the embed editor below to build one out.',
      fields: [
        { id: genId(), name: 'Inline Field A', value: 'Side by side', inline: true },
        { id: genId(), name: 'Inline Field B', value: 'with other inlines', inline: true },
        { id: genId(), name: 'Full-width Field', value: 'Non-inline fields span the full width of the embed.', inline: false },
      ],
      footer: { text: 'TrueBeast • Footer text goes here', icon_url: '', timestamp: '' },
    }],
    buttons: [[
      { emoji: '🌐', label: 'Visit Site', url: 'https://truebeast.io' },
      { emoji: '📢', label: 'Announce', url: 'https://truebeast.io' },
    ]],
  });
  const [tg, setTg] = useState<TelegramMsg>({
    text: '<b>🎉 Example Announcement</b>\n\nTelegram uses <b>HTML formatting</b> — <i>italic</i>, <u>underline</u>, <s>strikethrough</s>, and <code>inline code</code>.\n\nUse the toolbar above the text box to insert tags, or type them directly.\n\n<a href="https://truebeast.io">Link text works like this</a>',
    imageUrl: '',
    silent: false,
    disablePreview: false,
  });
  const [bs, setBs] = useState<BlueskyMsg>({
    text: '🎉 Example Announcement\n\nBluesky is plain text — no markdown or HTML. Keep it under 300 characters.\n\nhttps://truebeast.io',
  });
  const [activeTab, setActiveTab] = useState<'discord' | 'telegram' | 'bluesky'>('discord');
  const [credsOpen, setCredsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);

  const saveCreds = (nc: Creds) => { setCreds(nc); localStorage.setItem(CREDS_KEY, JSON.stringify(nc)); };
  const hasCreds = (p: 'discord' | 'telegram' | 'bluesky') => {
    if (p === 'discord') return !!creds.discord?.webhookUrl;
    if (p === 'telegram') return !!(creds.telegram?.botToken && creds.telegram?.chatId);
    if (p === 'bluesky') return !!(creds.bluesky?.handle && creds.bluesky?.appPassword);
    return false;
  };
  const tabDot = (p: 'discord' | 'telegram' | 'bluesky') => {
    if (!enabled[p]) return 'rgba(255,255,255,0.15)';
    if (!hasCreds(p)) return '#facc15';
    return '#4ade80';
  };

  const bsCount = bskyCharCount(bs.text || '');
  const bsOver = bsCount > 300;
  const hasContent = (enabled.discord && (dc.content || (dc.embeds || []).length > 0)) || (enabled.telegram && tg.text) || (enabled.bluesky && bs.text);
  const canSend = !sending && !bsOver && hasContent;

  const doSend = async () => {
    setSending(true); setResults(null);
    const jobs: { platform: string; promise: Promise<void> }[] = [];
    if (enabled.discord) {
      const p = creds.discord?.webhookUrl ? apiSendDiscord(creds.discord.webhookUrl, dc) : Promise.reject(new Error('No webhook URL — open Credentials'));
      jobs.push({ platform: 'Discord', promise: p });
    }
    if (enabled.telegram && tg.text) {
      const p = creds.telegram?.botToken ? apiSendTelegram(creds.telegram.botToken, creds.telegram.chatId, tg) : Promise.reject(new Error('No bot token — open Credentials'));
      jobs.push({ platform: 'Telegram', promise: p });
    }
    if (enabled.bluesky && bs.text) {
      const p = creds.bluesky?.handle ? apiSendBluesky(creds.bluesky.handle, creds.bluesky.appPassword, bs.text) : Promise.reject(new Error('No credentials — open Credentials'));
      jobs.push({ platform: 'Bluesky', promise: p });
    }
    if (!jobs.length) { setSending(false); return; }
    const settled = await Promise.allSettled(jobs.map(j => j.promise));
    setResults(settled.map((r, i) => ({ platform: jobs[i].platform, ok: r.status === 'fulfilled', message: r.status === 'rejected' ? (r.reason as Error).message : '' })));
    setSending(false);
  };

  const tabs: Array<'discord' | 'telegram' | 'bluesky'> = ['discord', 'telegram', 'bluesky'];
  const tabLabels: Record<string, string> = { discord: 'Discord', telegram: 'Telegram', bluesky: 'Bluesky' };

  return (
    <PageLayout title="Ripple | TrueBeast Tools" gradientVariant="purple">
      {credsOpen && <CredentialsModal creds={creds} onSave={saveCreds} onClose={() => setCredsOpen(false)} />}

      <section className="py-20 sm:py-28">
        <div className="max-w-[88rem] mx-auto px-4 sm:px-6">

          <Link to="/tools" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10">
            <ArrowLeft size={14} /> Back to Tools
          </Link>

          <div className="text-center mb-12 space-y-4">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <Radio size={16} className="text-violet-400" />
              <span className="text-sm text-gray-300 font-medium">Multi-Platform Broadcasting</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">Ripple</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto">Write one announcement. Send it everywhere at once.</p>
          </div>

          {/* Two-column layout */}
          <div className="flex flex-col xl:flex-row gap-6 items-start">

            {/* ── Left: Editor ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <CoreMessageEditor msg={msg} onChange={setMsg} />

              {/* Platforms card */}
              <div className="glass rounded-2xl p-5">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <StepLabel>Platforms</StepLabel>
                  <button onClick={() => setCredsOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Settings size={13} /> Credentials
                  </button>
                </div>

                {/* Platform tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 4 }}>
                  {tabs.map(p => (
                    <button key={p} onClick={() => setActiveTab(p)} style={{ flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s', color: activeTab === p ? '#c084fc' : 'rgba(255,255,255,0.45)', background: activeTab === p ? 'rgba(124,58,237,0.2)' : 'none', border: activeTab === p ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent', fontFamily: 'inherit' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tabDot(p), flexShrink: 0, display: 'inline-block' }} />
                      {tabLabels[p]}
                    </button>
                  ))}
                </div>

                {/* Credential warning */}
                {!hasCreds(activeTab) && (
                  <div style={{ background: 'rgba(250,204,21,0.07)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#facc15', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span>No credentials set for {tabLabels[activeTab]}</span>
                    <button onClick={() => setCredsOpen(true)} style={{ background: 'rgba(250,204,21,0.15)', border: '1px solid rgba(250,204,21,0.35)', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', color: '#facc15', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Connect</button>
                  </div>
                )}

                {activeTab === 'discord' && <DiscordEditor dc={dc} onChange={setDc} coreMsg={msg} enabled={enabled.discord} onToggle={() => setEnabled(e => ({ ...e, discord: !e.discord }))} />}
                {activeTab === 'telegram' && <TelegramEditor tg={tg} onChange={setTg} coreMsg={msg} enabled={enabled.telegram} onToggle={() => setEnabled(e => ({ ...e, telegram: !e.telegram }))} />}
                {activeTab === 'bluesky' && <BlueskyEditor bs={bs} onChange={setBs} coreMsg={msg} enabled={enabled.bluesky} onToggle={() => setEnabled(e => ({ ...e, bluesky: !e.bluesky }))} />}

                {/* Coming soon */}
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>Coming soon:</p>
                  {[['Reddit', 'Requires backend OAuth'], ['Threads', 'Meta API - coming soon']].map(([name, desc]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginBottom: 4, opacity: 0.5 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{name} <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>— {desc}</span></div>
                      <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '2px 8px', color: 'rgba(255,255,255,0.4)' }}>Soon</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* ── Right: Preview + Send (sticky) ── */}
            <div className="w-full xl:w-[460px] xl:sticky xl:top-28 shrink-0">
              <div className="glass rounded-2xl p-5">
                <StepLabel>Preview</StepLabel>

                {/* Preview tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 4 }}>
                  {tabs.map(p => (
                    <button key={p} onClick={() => setActiveTab(p)} style={{ flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s', color: activeTab === p ? '#c084fc' : 'rgba(255,255,255,0.45)', background: activeTab === p ? 'rgba(124,58,237,0.2)' : 'none', border: activeTab === p ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent', fontFamily: 'inherit' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tabDot(p), flexShrink: 0, display: 'inline-block' }} />
                      {tabLabels[p]}
                    </button>
                  ))}
                </div>

                {activeTab === 'discord' && <DiscordPreview dc={dc} enabled={enabled.discord} />}
                {activeTab === 'telegram' && <TelegramPreview tg={tg} enabled={enabled.telegram} />}
                {activeTab === 'bluesky' && <BlueskyPreview bs={bs} handle={creds.bluesky?.handle || ''} enabled={enabled.bluesky} />}

                {/* Send */}
                <div style={{ marginTop: 16 }}>
                  {bsOver && enabled.bluesky && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 14px', fontSize: 12, color: '#f87171', marginBottom: 10 }}>Bluesky post exceeds 300 grapheme limit — trim the text before sending.</div>}
                  <button disabled={!canSend} onClick={doSend} className="w-full glass-strong rounded-xl px-6 py-4 inline-flex items-center justify-center gap-2 text-violet-400 hover:text-violet-300 font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(168,85,247,0.1))', border: '1px solid rgba(124,58,237,0.3)' }}>
                    {sending ? <><Loader2 size={16} className="animate-spin" />Sending...</> : <><Send size={16} />Send Ripple</>}
                  </button>
                </div>
              </div>

              <ResultsPanel results={results} onClear={() => setResults(null)} />
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
