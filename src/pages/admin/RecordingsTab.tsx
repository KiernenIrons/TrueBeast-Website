import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Copy, ExternalLink, HardDrive, Loader2, Pin, RefreshCw, Search, Square, StickyNote, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { GlassCard } from '@/components/shared/GlassCard';

// Same bot API the public download page (/rec/:id) uses
const API = import.meta.env.VITE_RECORDER_API || 'https://truebeast-beast-bot.fly.dev';

interface AdminRec {
  id: string; live: boolean; auto: boolean; keep: boolean; url: string; size: number; deleteKey: string;
  guild: { name: string; icon: string | null }; channel: { name: string };
  requester: { name: string; username: string; avatar: string };
  startedAt: number; endedAt: number | null; expiresAt: number | null; duration: number; endReason: string | null;
  tracks: { track: number; name: string; username: string; avatar: string; bot: boolean }[];
  notes: { t: number; text: string }[];
}
interface Storage { free: number; total: number }
type Filter = 'all' | 'live' | 'kept';

const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
function fmtLength(secs: number) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
}
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function relative(ms: number) {
  const d = ms - Date.now(), abs = Math.abs(d);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 3600e3) return rtf.format(Math.round(d / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(d / 3600e3), 'hour');
  return rtf.format(Math.round(d / 86400e3), 'day');
}

const CSS = `
.recadm-live { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 11px; letter-spacing: .08em; padding: 3px 9px;
  border-radius: 999px; background: rgba(239,68,68,.16); color: rgb(248,113,113); }
.recadm-live i { width: 7px; height: 7px; border-radius: 50%; background: rgb(239,68,68); animation: recadm-pulse 1.4s infinite; }
@keyframes recadm-pulse { 50% { opacity: .25; } }
`;

export default function RecordingsTab() {
  const { user } = useAuth();
  const [recs, setRecs] = useState<AdminRec[] | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await user?.getIdToken();
    const res = await fetch(`${API}/api/admin${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [user]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await call('/recordings');
      setRecs(data.recordings); setStorage(data.storage); setError('');
    } catch (e: any) {
      setError(e?.message === 'Failed to fetch' ? 'Couldn\'t reach the recorder. The bot might be restarting, try again in a minute.' : e?.message || 'Couldn\'t load recordings.');
    }
    setRefreshing(false);
  }, [call]);

  useEffect(() => { load(); }, [load]);
  const anyLive = !!recs?.some((r) => r.live);
  useEffect(() => {
    const t = setInterval(load, anyLive ? 10_000 : 60_000);
    const tick = anyLive ? setInterval(() => setTick((n) => n + 1), 1000) : undefined;
    return () => { clearInterval(t); if (tick) clearInterval(tick); };
  }, [anyLive, load]);

  async function act(id: string, path: string, init: RequestInit, done?: () => void) {
    setBusy(id + path);
    try { await call(path, init); done?.(); await load(); } catch (e: any) { setError(e?.message || 'That didn\'t work.'); }
    setBusy(null);
  }

  function copy(r: AdminRec) {
    navigator.clipboard.writeText(r.url).then(() => { setCopied(r.id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (recs || []).filter((r) => {
      if (filter === 'live' && !r.live) return false;
      if (filter === 'kept' && !r.keep) return false;
      if (!q) return true;
      return [r.channel.name, r.requester.name, r.requester.username, r.id, ...r.tracks.map((t) => `${t.name} ${t.username}`), ...r.notes.map((n) => n.text)]
        .some((s) => s.toLowerCase().includes(q));
    });
  }, [recs, filter, search]);

  if (!recs && !error) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-500" /></div>;

  const used = recs?.reduce((n, r) => n + r.size, 0) ?? 0;
  const storagePct = storage ? Math.min(100, Math.round(((storage.total - storage.free) / storage.total) * 100)) : 0;
  const liveCount = recs?.filter((r) => r.live).length ?? 0;
  const counts: Record<Filter, number> = { all: recs?.length ?? 0, live: liveCount, kept: recs?.filter((r) => r.keep).length ?? 0 };

  return (
    <div className="space-y-5">
      <style>{CSS}</style>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <GlassCard className="p-4 rounded-2xl">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">Recordings</p>
          <p className="text-2xl font-bold text-white mt-1">{recs?.length ?? '–'}</p>
          <p className="text-xs text-gray-500 mt-0.5">Deleted 7 days after they end, unless kept</p>
        </GlassCard>
        <GlassCard className="p-4 rounded-2xl">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">Live now</p>
          <p className="text-2xl font-bold text-white mt-1 flex items-center gap-2">
            {liveCount}{liveCount > 0 && <span className="recadm-live"><i />REC</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Start one from any voice chat's red recording card</p>
        </GlassCard>
        <GlassCard className="p-4 rounded-2xl">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 flex items-center gap-1.5"><HardDrive size={12} />Storage</p>
          {storage ? (
            <>
              <p className="text-2xl font-bold text-white mt-1">{fmtSize(storage.free)} <span className="text-sm font-normal text-gray-500">free of {fmtSize(storage.total)}</span></p>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden mt-2">
                <div className={`h-full ${storagePct > 85 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${storagePct}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Recordings use {fmtSize(used)}</p>
            </>
          ) : <p className="text-2xl font-bold text-white mt-1">–</p>}
        </GlassCard>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-white/10 overflow-hidden">
          {(['all', 'live', 'kept'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${filter === f ? 'bg-red-500/15 text-red-300' : 'text-gray-400 hover:bg-white/5'}`}>
              {f === 'all' ? 'All' : f === 'live' ? 'Live' : 'Kept'} <span className="opacity-60">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search channel, person, note or ID"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500/50" />
        </div>
        <button type="button" onClick={load} disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-gray-300 hover:bg-white/5 cursor-pointer disabled:opacity-50">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {/* List */}
      {recs && shown.length === 0 ? (
        <GlassCard className="p-10 rounded-2xl text-center">
          <p className="text-white font-semibold">{recs.length ? 'Nothing matches' : 'No recordings yet'}</p>
          <p className="text-sm text-gray-500 mt-1">
            {recs.length ? 'Try a different search or filter.' : 'Press Start recording on a voice chat\'s red recording card, or use /record start in Discord.'}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const length = r.live ? (Date.now() - r.startedAt) / 1000 : r.duration;
            return (
              <GlassCard key={r.id} className="rounded-2xl overflow-hidden">
                <div className="flex border-l-4 border-red-500">
                  <div className="flex-1 min-w-0 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {r.live && <span className="recadm-live"><i />REC</span>}
                          {r.auto && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-white/10 text-gray-300">Auto</span>}
                          {r.keep && <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Kept</span>}
                          <span className="text-xs text-gray-500">{when(r.startedAt)}</span>
                        </div>
                        <h3 className="text-lg font-semibold text-white truncate">#{r.channel.name}</h3>
                        <p className="text-sm text-gray-400 flex items-center gap-2 mt-0.5">
                          <img src={r.requester.avatar} alt="" className="w-5 h-5 rounded-full" />
                          {r.auto ? 'Auto-recorded for' : 'Started by'} <span className="text-gray-200">{r.requester.name}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500 text-white text-xs font-semibold hover:bg-red-400 transition-colors">
                          <ExternalLink size={13} /> Open
                        </a>
                        <button type="button" onClick={() => copy(r)} title="Copy the download link"
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-gray-300 hover:bg-white/5 cursor-pointer">
                          {copied === r.id ? <Check size={13} /> : <Copy size={13} />} {copied === r.id ? 'Copied' : 'Copy link'}
                        </button>
                        <button type="button" disabled={busy === r.id + `/recordings/${r.id}/keep`}
                          onClick={() => act(r.id, `/recordings/${r.id}/keep`, { method: 'POST', body: JSON.stringify({ keep: !r.keep }) })}
                          title={r.keep ? 'Let it expire normally' : 'Never delete this automatically'}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs cursor-pointer disabled:opacity-50 ${r.keep ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-white/10 text-gray-300 hover:bg-white/5'}`}>
                          <Pin size={13} /> {r.keep ? 'Kept' : 'Keep'}
                        </button>
                        {r.live ? (
                          <button type="button" disabled={busy === r.id + `/recordings/${r.id}/stop`}
                            onClick={() => window.confirm(`Stop recording #${r.channel.name}?`) && act(r.id, `/recordings/${r.id}/stop`, { method: 'POST' })}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/40 text-red-300 text-xs hover:bg-red-500/10 cursor-pointer disabled:opacity-50">
                            <Square size={12} fill="currentColor" /> Stop
                          </button>
                        ) : confirmDelete === r.id ? (
                          <button type="button" disabled={busy === r.id + `/recordings/${r.id}`}
                            onClick={() => act(r.id, `/recordings/${r.id}`, { method: 'DELETE' }, () => setConfirmDelete(null))}
                            onBlur={() => setConfirmDelete(null)} autoFocus
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                            <Trash2 size={13} /> Really delete?
                          </button>
                        ) : (
                          <button type="button" onClick={() => setConfirmDelete(r.id)} title="Delete for good"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-gray-400 hover:text-red-300 hover:bg-white/5 cursor-pointer">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-gray-400">
                      <span className="inline-flex items-center gap-1.5"><Clock size={13} />{fmtLength(length)}{r.live ? ' so far' : ''}</span>
                      <span className="inline-flex items-center gap-2">
                        <Users size={13} />
                        {r.tracks.length ? (
                          <>
                            <span className="flex -space-x-1.5">
                              {r.tracks.slice(0, 6).map((t) => <img key={t.track} src={t.avatar} alt={t.name} title={t.name} className="w-5 h-5 rounded-full ring-2 ring-[#121218]" />)}
                            </span>
                            <span className="truncate max-w-[16rem]">{r.tracks.map((t) => t.name).join(', ')}</span>
                          </>
                        ) : 'Nobody has spoken yet'}
                      </span>
                      {r.notes.length > 0 && <span className="inline-flex items-center gap-1.5" title={r.notes.map((n) => n.text).join('\n')}><StickyNote size={13} />{r.notes.length} {r.notes.length === 1 ? 'note' : 'notes'}</span>}
                      <span className="inline-flex items-center gap-1.5"><HardDrive size={13} />{fmtSize(r.size)}</span>
                      {!r.live && (
                        <span title={r.expiresAt ? new Date(r.expiresAt).toLocaleString() : undefined}>
                          {r.keep ? 'Never expires' : r.expiresAt ? `Expires ${relative(r.expiresAt)}` : ''}
                        </span>
                      )}
                      <span className="font-mono text-gray-600">{r.id}</span>
                    </div>
                    {!r.live && r.endReason && <p className="text-xs text-gray-600 mt-1.5">{r.endReason}</p>}
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
