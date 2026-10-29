import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  AlertTriangle, Check, ChevronDown, Clock, Download, FileText, Image, Info, Loader2, Mic, StickyNote, Trash2, Users, X,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// The Discord bot (Fly.io) records and processes audio; this page just talks to its API.
const API = import.meta.env.VITE_RECORDER_API || 'https://truebeast-beast-bot.fly.dev';

interface Track { track: number; name: string; username: string; avatar: string; bot: boolean }
interface RecInfo {
  id: string; live: boolean; auto: boolean;
  guild: { name: string; icon: string | null }; channel: { name: string };
  requester: { name: string; username: string; avatar: string };
  startedAt: number; endedAt: number | null; expiresAt: number | null; duration: number; endReason: string | null; maxHours: number;
  tracks: Track[]; notes: { t: number; text: string }[]; gaps: { from: number; to: number }[];
}
interface Job {
  id: string; state: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; step: string; progress: number;
  position: number; error: string | null; fileName: string | null; size: number;
}
type Container = 'zip' | 'mix' | 'aup' | 'sesx';
interface Choice { format: string; container: Container; label: string; title: string; desc: string; ext: string }

const fmtSize = (b: number) => (b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b > 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function fmtLength(secs: number) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
}
const stamp = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
};
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function relative(ms: number) {
  const d = ms - Date.now(), abs = Math.abs(d);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 3600e3) return rtf.format(Math.round(d / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(d / 3600e3), 'hour');
  return rtf.format(Math.round(d / 86400e3), 'day');
}

// What each format is for, in plain words
const MULTI: (Omit<Choice, 'container' | 'title' | 'desc'> & { hint: string; more?: boolean; desktop?: boolean; container?: Container })[] = [
  { format: 'flac', label: 'Audacity project', ext: 'aup', hint: 'Opens in Audacity with every person on their own track and your notes as labels.', container: 'aup', desktop: true },
  { format: 'flac', label: 'Adobe Audition', ext: 'sesx', hint: 'An Audition session with every track laid out and your notes as markers.', container: 'sesx', desktop: true },
  { format: 'flac', label: 'FLAC', ext: 'flac', hint: 'Full quality, works almost everywhere. The best pick if you\'re unsure.' },
  { format: 'wav', label: 'WAV', ext: 'wav', hint: 'Full quality, uncompressed. Biggest files, but every editor opens them.' },
  { format: 'aac', label: 'AAC (M4A)', ext: 'm4a', hint: 'Small files that play nicely on iPhone, Mac and GarageBand.' },
  { format: 'mp3', label: 'MP3', ext: 'mp3', hint: 'Small files that play on anything.' },
  { format: 'vorbis', label: 'Ogg Vorbis', ext: 'ogg', hint: 'Small, open format.', more: true },
  { format: 'opus', label: 'Opus', ext: 'opus', hint: 'Tiny files, great quality for voice.', more: true },
  { format: 'alac', label: 'ALAC', ext: 'm4a', hint: 'Apple Lossless: full quality for Apple apps.', more: true },
  { format: 'oggflac', label: 'Ogg FLAC', ext: 'oga', hint: 'FLAC inside an Ogg container.', more: true },
  { format: 'adpcm', label: 'ADPCM WAV', ext: 'wav', hint: 'Compressed WAV for old software.', more: true },
  { format: 'wav8', label: '8-bit WAV', ext: 'wav', hint: 'Tiny, low-quality WAV.', more: true },
  { format: 'raw', label: 'Original Opus', ext: 'ogg', hint: 'Exactly what Discord sent, no re-encoding. For audio nerds.', more: true },
];
const MIX: (Omit<Choice, 'container' | 'title' | 'desc'> & { hint: string; more?: boolean })[] = [
  { format: 'flac', label: 'FLAC', ext: 'flac', hint: 'Full quality.' },
  { format: 'mp3', label: 'MP3', ext: 'mp3', hint: 'Small, plays anywhere.' },
  { format: 'wav', label: 'WAV', ext: 'wav', hint: 'Uncompressed.' },
  { format: 'aac', label: 'AAC (M4A)', ext: 'm4a', hint: 'Small, great on Apple devices.' },
  { format: 'vorbis', label: 'Ogg Vorbis', ext: 'ogg', hint: 'Small, open format.', more: true },
  { format: 'opus', label: 'Opus', ext: 'opus', hint: 'Tiny files.', more: true },
  { format: 'alac', label: 'ALAC', ext: 'm4a', hint: 'Apple Lossless.', more: true },
];

function describe(c: { label: string; ext: string; format: string }, container: Container, people: number): Pick<Choice, 'title' | 'desc'> {
  const each = people === 1 ? 'one file' : `${people} files, one per person`;
  if (container === 'aup') return { title: 'Audacity project', desc: `A ZIP with an Audacity project and ${each}. Unzip everything first, then open the .aup file. Your notes show up as a label track.` };
  if (container === 'sesx') return { title: 'Adobe Audition session', desc: `A ZIP with an Audition session and ${each}. Unzip everything first, then open the .sesx file. Your notes show up as markers.` };
  if (container === 'mix') return { title: `Mixed ${c.label}`, desc: `Everyone mixed together into a single .${c.ext} file, ready to listen to or post.` };
  return {
    title: `Multi-track ${c.label}`,
    desc: people === 1
      ? `A single .${c.ext} file with just this person.`
      : `A ZIP with ${each} (.${c.ext}). They're all the same length and start at the same moment, so they line up perfectly when you drop them into an editor.`,
  };
}

const REC_CSS = `
.rec { --cell: rgba(255,255,255,0.04); --line: rgba(255,255,255,0.10); --muted: rgba(255,255,255,0.55); --on: 34,197,94; --live: 239,68,68; }
html.light .rec { --cell: rgba(0,0,0,0.04); --line: rgba(0,0,0,0.12); --muted: rgba(0,0,0,0.55); }
.rec-panel { border-radius: 20px; padding: clamp(16px, 2.2vw, 28px); }
.rec-muted { color: var(--muted); }
.rec-fmt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; border: 1px solid var(--line); background: var(--cell);
  border-radius: 14px; padding: 12px 14px; transition: border-color .15s, background-color .15s, transform .15s; min-width: 0; }
.rec-fmt:hover { border-color: rgba(var(--on), .7); transform: translateY(-1px); }
.rec-fmt b { font-weight: 600; font-size: 15px; display: inline-flex; align-items: center; gap: 8px; }
.rec-fmt span { font-size: 12.5px; line-height: 1.35; color: var(--muted); }
.rec-tag { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px;
  background: rgba(var(--on), .18); color: rgb(var(--on)); }
.rec-live { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; font-size: 12px; letter-spacing: .08em; padding: 4px 10px;
  border-radius: 999px; background: rgba(var(--live), .16); color: rgb(var(--live)); }
.rec-live i { width: 8px; height: 8px; border-radius: 50%; background: rgb(var(--live)); animation: rec-pulse 1.4s infinite; }
@keyframes rec-pulse { 50% { opacity: .25; } }
.rec-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); }
.rec-btn { background: rgb(var(--on)); color: #04120a; font-weight: 600; border-radius: 12px; padding: 12px 18px; font-size: 15px; transition: filter .15s, opacity .15s; }
.rec-btn:hover { filter: brightness(1.08); }
.rec-btn:disabled { opacity: .5; cursor: default; }
.rec-ghost { border: 1px solid var(--line); border-radius: 12px; padding: 9px 14px; font-size: 14px; color: inherit; transition: background-color .15s; }
.rec-ghost:hover { background: var(--cell); }
.rec-danger { background: rgb(var(--live)); color: #fff; font-weight: 600; border-radius: 12px; padding: 12px 18px; font-size: 15px; }
.rec-danger:disabled { opacity: .5; }
.rec-input { width: 100%; background: var(--cell); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: 16px; outline: none; color: inherit; }
.rec-input:focus { border-color: rgba(var(--on), .7); }
.rec-bar { height: 10px; border-radius: 999px; background: var(--cell); border: 1px solid var(--line); overflow: hidden; }
.rec-bar > div { height: 100%; background: rgb(var(--on)); transition: width .4s; }
.rec-check { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--line); display: inline-flex; align-items: center; justify-content: center; flex: none; }
.rec-check.on { background: rgb(var(--on)); border-color: rgb(var(--on)); color: #04120a; }
.rec-switch { width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; flex: none; transition: background-color .15s; }
.rec-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.rec-switch.on { background: rgb(var(--on)); }
.rec-switch.on::after { transform: translateX(16px); }
`;

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/60 rec" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-strong rec-panel w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute right-3 top-3 rec-ghost !p-2" aria-label="Close"><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

export default function Recording() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const key = params.get('key') || '';
  const base = `${API}/api/rec/${encodeURIComponent(id)}`;
  const q = `key=${encodeURIComponent(key)}`;

  const [info, setInfo] = useState<RecInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'deleted'>('loading');
  const [message, setMessage] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [normalize, setNormalize] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState('');
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteKey, setDeleteKey] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [busyDelete, setBusyDelete] = useState(false);
  const [, setNow] = useState(0);
  const autoDownloaded = useRef<string | null>(null);

  // --- load + live refresh -----------------------------------------------------
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}?${q}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus(res.status === 404 ? 'missing' : 'error'); setMessage(data.error || ''); return; }
      setInfo(data); setStatus('ready');
    } catch { setStatus((s) => (s === 'ready' ? s : 'error')); }
  }, [base, q]);

  useEffect(() => { if (key) load(); else setStatus('missing'); }, [key, load]);
  useEffect(() => {
    if (!info?.live) return;
    const t = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [info?.live, load]);

  // --- job polling -------------------------------------------------------------
  const fileUrl = job ? `${base}/jobs/${job.id}/file?${q}` : '';
  useEffect(() => {
    if (!job || job.state === 'done' || job.state === 'error' || job.state === 'cancelled') return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${base}/jobs/${job.id}?${q}`);
        const data = await res.json();
        if (!res.ok) { setJobError(data.error || 'Lost track of the download, start it again.'); setJob(null); return; }
        setJob(data);
      } catch { /* network blip, keep polling */ }
    }, 1000);
    return () => clearInterval(t);
  }, [job, base, q]);

  useEffect(() => {
    if (job?.state === 'done' && autoDownloaded.current !== job.id) {
      autoDownloaded.current = job.id;
      const a = document.createElement('a');
      a.href = fileUrl; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }
  }, [job, fileUrl]);

  const included = useMemo(() => (info ? info.tracks.filter((t) => !excluded.has(t.track)) : []), [info, excluded]);
  const people = included.length;

  function pick(c: { format: string; label: string; ext: string }, container: Container) {
    setJob(null); setJobError('');
    setChoice({ ...c, container, ...describe(c, container, people) });
  }

  async function startJob() {
    if (!choice || !info) return;
    setStarting(true); setJobError('');
    try {
      const res = await fetch(`${base}/jobs?${q}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: choice.format, container: choice.container, tracks: included.map((t) => t.track), normalize }),
      });
      const data = await res.json();
      if (!res.ok) setJobError(data.error || 'Couldn\'t start the download.'); else setJob(data);
    } catch { setJobError('Couldn\'t reach the recorder. Check your connection and try again.'); }
    setStarting(false);
  }

  async function cancelJob() {
    if (job && (job.state === 'queued' || job.state === 'running')) await fetch(`${base}/jobs/${job.id}/cancel?${q}`, { method: 'POST' }).catch(() => {});
    setChoice(null); setJob(null);
  }

  async function doDelete(e: React.FormEvent) {
    e.preventDefault();
    setBusyDelete(true); setDeleteError('');
    try {
      const res = await fetch(`${base}?${q}&deleteKey=${encodeURIComponent(deleteKey.trim())}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setDeleteError(data.error || 'Couldn\'t delete it.'); else { setDeleting(false); setStatus('deleted'); }
    } catch { setDeleteError('Couldn\'t reach the recorder. Try again.'); }
    setBusyDelete(false);
  }

  // Progress in the tab title, handy for long exports
  useEffect(() => {
    const prev = document.title;
    if (job && (job.state === 'queued' || job.state === 'running')) document.title = `${job.progress}% · Preparing download`;
    return () => { document.title = prev; };
  }, [job]);

  const toggle = (n: number) => setExcluded((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  // --- states --------------------------------------------------------------------
  const shell = (children: React.ReactNode) => (
    <PageLayout title="Recording | TrueBeast" description="Download your multi-track Discord recording." gradientVariant="green">
      <Helmet><meta name="robots" content="noindex" /></Helmet>
      <style>{REC_CSS}</style>
      <section className="rec py-6 sm:py-10"><div className="w-full max-w-[72rem] mx-auto px-4 sm:px-6">{children}</div></section>
    </PageLayout>
  );

  if (status === 'loading') return shell(<Loader2 className="animate-spin mx-auto my-24 text-gray-500" />);
  if (status !== 'ready' || !info) {
    const text = status === 'deleted' ? { h: 'Recording deleted', p: 'It\'s gone for good. Nobody can download it anymore.' }
      : status === 'missing' ? { h: 'Recording not found', p: message || 'This recording doesn\'t exist, has expired, or the link is missing part of its key. Use /record list in Discord to get a fresh link.' }
      : { h: 'Couldn\'t load the recording', p: 'The recorder might be restarting for an update. Give it a minute and refresh.' };
    return shell(
      <div className="glass rec-panel max-w-xl mx-auto text-center py-12">
        <Mic className="mx-auto mb-4 rec-muted" size={36} />
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">{text.h}</h1>
        <p className="text-[15px] rec-muted mt-3 leading-relaxed">{text.p}</p>
        {status === 'error' && <button className="rec-ghost mt-6" onClick={() => { setStatus('loading'); load(); }}>Try again</button>}
      </div>,
    );
  }

  const length = info.live ? (Date.now() - info.startedAt) / 1000 : info.duration;
  const noTracks = info.tracks.length === 0;
  const working = job && (job.state === 'queued' || job.state === 'running');

  const fmtButton = (c: { format: string; label: string; ext: string; hint: string; desktop?: boolean }, container: Container, recommended = false) => (
    <button key={`${container}-${c.format}-${c.label}`} className={`rec-fmt ${c.desktop ? 'hidden sm:flex' : ''}`} onClick={() => pick(c, container)} disabled={!people}>
      <b>{c.label}{recommended && <span className="rec-tag">Best pick</span>}</b>
      <span>{c.hint}</span>
    </button>
  );

  return shell(
    <>
      {/* Header */}
      <div className="glass rec-panel mb-4 sm:mb-6">
        <div className="flex flex-wrap items-start gap-4">
          {info.guild.icon && <img src={info.guild.icon} alt="" className="w-14 h-14 rounded-2xl flex-none" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {info.live && <span className="rec-live"><i />REC</span>}
              <span className="text-sm rec-muted">{info.guild.name}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-4xl font-bold text-white break-words">#{info.channel.name}</h1>
            <p className="text-[15px] rec-muted mt-1">
              {info.auto ? 'Auto-recorded for' : 'Recorded by'} <span className="text-white">{info.requester.name}</span> · {when(info.startedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="rec-chip"><Clock size={14} />{fmtLength(length)}{info.live ? ' so far' : ''}</span>
          <span className="rec-chip"><Users size={14} />{info.tracks.length} {info.tracks.length === 1 ? 'person' : 'people'}</span>
          {info.notes.length > 0 && <span className="rec-chip"><StickyNote size={14} />{info.notes.length} {info.notes.length === 1 ? 'note' : 'notes'}</span>}
          {info.expiresAt && <span className="rec-chip" title={when(info.expiresAt)}><Trash2 size={14} />Expires {relative(info.expiresAt)}</span>}
          <span className="rec-chip rec-muted">ID <code className="text-white">{info.id}</code></span>
        </div>
        {info.live && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
            <AlertTriangle size={18} className="mt-0.5 flex-none text-amber-400" />
            <p className="text-sm">
              <b className="text-amber-300">Still recording.</b> Downloading now gives you everything up to this moment.
              It stops by itself after {info.maxHours} hours, or when everyone leaves.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Downloads */}
        <div className="glass rec-panel min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
            <h2 className="text-xl sm:text-2xl font-semibold text-white">Download</h2>
            <button className="text-sm rec-muted inline-flex items-center gap-1.5 hover:text-white" onClick={() => setShowHelp((v) => !v)}>
              <Info size={15} /> Which do I use?
            </button>
          </div>
          {showHelp && (
            <div className="text-sm leading-relaxed rounded-xl bg-white/5 p-4 my-3 space-y-2">
              <p><b className="text-white">Multi-track</b> gives you a ZIP with one file per person, already lined up. Perfect for editing: fix one person's volume or cut someone's cough without touching anyone else.</p>
              <p><b className="text-white">Mixed</b> puts everyone into one file, ready to listen to or post as-is.</p>
              <p>Editing in <b className="text-white">Audacity</b> (free)? Grab the Audacity project. On Apple devices, <b className="text-white">AAC</b> is the easiest. Otherwise, <b className="text-white">FLAC</b> works almost everywhere.</p>
            </div>
          )}
          {noTracks ? (
            <div className="rounded-xl bg-white/5 p-5 mt-4">
              <p className="text-white font-semibold">Nobody has spoken yet</p>
              <p className="text-sm rec-muted mt-1">People are added to the recording the moment they talk. If people are talking and nothing shows up, try changing the voice channel's region in Discord and restart the recording.</p>
            </div>
          ) : (
            <>
              <h3 className="text-sm uppercase tracking-wider rec-muted mt-5 mb-2.5">Multi-track · one file per person</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {MULTI.filter((c) => showAll || !c.more).map((c) => fmtButton(c, c.container || 'zip', c.format === 'flac' && !c.container))}
              </div>
              <h3 className="text-sm uppercase tracking-wider rec-muted mt-6 mb-2.5">Mixed · everyone in one file</h3>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
                {MIX.filter((c) => showAll || !c.more).map((c) => fmtButton(c, 'mix'))}
              </div>
              <button className="text-sm rec-muted mt-3 inline-flex items-center gap-1 hover:text-white" onClick={() => setShowAll((v) => !v)}>
                <ChevronDown size={15} className={showAll ? 'rotate-180' : ''} /> {showAll ? 'Fewer formats' : 'More formats'}
              </button>

              <button className="w-full flex items-center justify-between gap-4 rounded-xl bg-white/5 p-4 mt-5 text-left" onClick={() => setNormalize((v) => !v)} role="switch" aria-checked={normalize}>
                <span>
                  <span className="text-white font-medium block">Even out volume</span>
                  <span className="text-sm rec-muted">Makes quiet and loud people sound about the same. Leave off if you'll mix it yourself.</span>
                </span>
                <span className={`rec-switch ${normalize ? 'on' : ''}`} />
              </button>

              <div className="flex flex-wrap gap-2 mt-5">
                <a className="rec-ghost inline-flex items-center gap-2" href={`${base}/info.txt?${q}`}><FileText size={15} />info.txt</a>
                <a className="rec-ghost inline-flex items-center gap-2" href={`${base}/avatars.zip?${q}`}><Image size={15} />Profile pictures (ZIP)</a>
              </div>
            </>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-4 sm:space-y-6 min-w-0">
          {!noTracks && (
            <div className="glass rec-panel">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold text-white">People</h2>
                <span className="text-sm rec-muted">{people} of {info.tracks.length} included</span>
              </div>
              <div className="flex flex-col gap-1">
                {info.tracks.map((t) => {
                  const on = !excluded.has(t.track);
                  return (
                    <button key={t.track} onClick={() => toggle(t.track)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 text-left" role="checkbox" aria-checked={on}>
                      <span className={`rec-check ${on ? 'on' : ''}`}>{on && <Check size={14} strokeWidth={3} />}</span>
                      <img src={t.avatar} alt="" className={`w-9 h-9 rounded-full flex-none ${on ? '' : 'opacity-40'}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${on ? 'text-white' : 'rec-muted line-through'}`}>{t.name}{t.bot ? ' 🤖' : ''}</span>
                        <span className="block text-xs rec-muted truncate">Track {t.track} · @{t.username}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs rec-muted mt-2">Untick someone to leave them out of your download.</p>
              {!people && <p className="text-sm text-red-400 mt-2">Pick at least one person.</p>}
            </div>
          )}

          {info.notes.length > 0 && (
            <div className="glass rec-panel">
              <h2 className="text-lg font-semibold text-white mb-3">Notes</h2>
              <div className="flex flex-col gap-2">
                {info.notes.map((n, i) => (
                  <div key={i} className="flex gap-3 text-[15px]">
                    <code className="rec-muted flex-none tabular-nums">{stamp(n.t)}</code>
                    <span className="text-white break-words min-w-0">{n.text}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs rec-muted mt-3">Added with /record note. They're in info.txt, as labels in the Audacity project, and as markers in Audition.</p>
            </div>
          )}

          {info.gaps.length > 0 && (
            <div className="glass rec-panel text-sm">
              <p className="text-white font-medium mb-1">Short gaps</p>
              <p className="rec-muted">The bot restarted for an update during this recording. Those moments are silent, and the tracks still line up:</p>
              <ul className="mt-2 space-y-1">{info.gaps.map((g, i) => <li key={i} className="tabular-nums">{stamp(g.from)} – {stamp(g.to)}</li>)}</ul>
            </div>
          )}

          {!info.live && (
            <div className="glass rec-panel">
              <h2 className="text-lg font-semibold text-white mb-1">Delete recording</h2>
              <p className="text-sm rec-muted mb-3">Gone for good, for everyone. It deletes itself {info.expiresAt ? relative(info.expiresAt) : 'after a week'} anyway.</p>
              <button className="rec-ghost inline-flex items-center gap-2 !text-red-400" onClick={() => { setDeleting(true); setDeleteError(''); }}><Trash2 size={15} />Delete…</button>
            </div>
          )}
        </div>
      </div>

      {/* Download modal */}
      {choice && (
        <Modal onClose={() => { if (!working) { setChoice(null); setJob(null); } }}>
          {!job ? (
            <>
              <h2 className="text-xl font-semibold text-white pr-10">{choice.title}</h2>
              <p className="text-[15px] rec-muted mt-2 leading-relaxed">{choice.desc}</p>
              <ul className="text-sm mt-4 space-y-1.5">
                <li className="flex gap-2"><Users size={16} className="flex-none mt-0.5 rec-muted" />{people === info.tracks.length ? `Everyone (${people})` : `${people} of ${info.tracks.length} people: ${included.map((t) => t.name).join(', ')}`}</li>
                <li className="flex gap-2"><Clock size={16} className="flex-none mt-0.5 rec-muted" />{fmtLength(length)}{info.live ? ' (so far)' : ''}</li>
                {normalize && choice.format !== 'raw' && <li className="flex gap-2"><Check size={16} className="flex-none mt-0.5 rec-muted" />Volume evened out</li>}
              </ul>
              {jobError && <p className="text-sm text-red-400 mt-4">{jobError}</p>}
              <button className="rec-btn w-full mt-5 inline-flex items-center justify-center gap-2" onClick={startJob} disabled={starting || !people}>
                {starting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />} Prepare download
              </button>
            </>
          ) : job.state === 'done' ? (
            <div className="text-center py-2">
              <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(34,197,94,.18)', color: 'rgb(34,197,94)' }}><Check /></div>
              <h2 className="text-xl font-semibold text-white">Your download is ready</h2>
              <p className="text-sm rec-muted mt-1 break-all">{job.fileName} · {fmtSize(job.size)}</p>
              <p className="text-sm rec-muted mt-3">It should start on its own. If it didn't:</p>
              <a className="rec-btn w-full mt-3 inline-flex items-center justify-center gap-2" href={fileUrl}><Download size={18} />Download</a>
              {(choice.container === 'aup' || choice.container === 'sesx') && <p className="text-xs rec-muted mt-3">Remember to unzip everything before opening the project.</p>}
            </div>
          ) : job.state === 'queued' || job.state === 'running' ? (
            <div className="py-2">
              <h2 className="text-xl font-semibold text-white pr-10">Preparing {choice.title.toLowerCase()}…</h2>
              <p className="text-sm rec-muted mt-1">{job.state === 'queued' ? `Waiting for other downloads to finish (#${job.position} in line)` : job.step}</p>
              <div className="rec-bar mt-4"><div style={{ width: `${Math.max(3, job.progress)}%` }} /></div>
              <div className="flex justify-between text-xs rec-muted mt-1.5"><span>{job.progress}%</span><span>Keep this tab open</span></div>
              <button className="rec-ghost w-full mt-5" onClick={cancelJob}>Cancel</button>
            </div>
          ) : (
            <div className="py-2">
              <h2 className="text-xl font-semibold text-white pr-10">{job.state === 'cancelled' ? 'Cancelled' : 'That didn\'t work'}</h2>
              <p className="text-sm rec-muted mt-1">{job.error}</p>
              <button className="rec-btn w-full mt-5" onClick={() => { setJob(null); setJobError(''); }}>Try again</button>
            </div>
          )}
        </Modal>
      )}

      {/* Delete modal */}
      {deleting && (
        <Modal onClose={() => setDeleting(false)}>
          <form onSubmit={doDelete}>
            <h2 className="text-xl font-semibold text-white pr-10">Delete this recording?</h2>
            <p className="text-[15px] rec-muted mt-2">This can't be undone, and nobody can get it back.</p>
            <label className="block text-sm text-white mt-5 mb-2" htmlFor="rec-del">Delete key</label>
            <input id="rec-del" className="rec-input text-white" value={deleteKey} onChange={(e) => setDeleteKey(e.target.value)} placeholder="From your recording DM" autoFocus autoComplete="off" />
            <p className="text-xs rec-muted mt-2">It's in the DM the bot sent when the recording started (tap the hidden text to reveal it). Or just use the Delete button in that DM.</p>
            {deleteError && <p className="text-sm text-red-400 mt-3">{deleteError}</p>}
            <button className="rec-danger w-full mt-5 inline-flex items-center justify-center gap-2" disabled={busyDelete || !deleteKey.trim()}>
              {busyDelete ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />} Yes, delete it
            </button>
          </form>
        </Modal>
      )}
    </>,
  );
}
