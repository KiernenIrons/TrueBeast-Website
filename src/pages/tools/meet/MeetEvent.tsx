import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Copy, Loader2, Plus } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import TimeGrid, { MEET_CSS } from './TimeGrid';
import {
  SLOT_MINUTES, allTimezones, buildLayout, describeSlot, fetchEvent, formatMinute, isPermissionError,
  localTimezone, normalizeName, passwordHash, personIdFor, savePerson, subscribePeople,
  type GridLayout, type MeetEvent, type MeetPerson,
} from './lib';

interface Me { id: string; name: string; pwHash: string }
interface Drag { c0: number; r0: number; c1: number; r1: number; add: boolean }

const storageKey = (id: string) => `meet:${id}`;
const TZ_KEY = 'meet:tz';

function readStore<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function writeStore(key: string, value: unknown) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

const inDrag = (d: Drag, c: number, r: number) =>
  (d.c0 - c) * (c - d.c1) >= 0 && (d.r0 - r) * (r - d.r1) >= 0;

/** Longest runs of the best-attended slots, merged per column. */
function bestTimes(layout: GridLayout, counts: Map<number, number>) {
  let max = 0;
  counts.forEach((n) => { if (n > max) max = n; });
  if (!max) return { max, ranges: [] as { col: number; from: number; to: number }[] };
  const ranges: { col: number; from: number; to: number }[] = [];
  layout.cells.forEach((col, c) => {
    let start = -1;
    col.forEach((slot, r) => {
      const hit = slot != null && counts.get(slot) === max;
      const contiguous = r > 0 && layout.rows[r] - layout.rows[r - 1] === SLOT_MINUTES;
      if (hit && start >= 0 && !contiguous) { ranges.push({ col: c, from: start, to: r - 1 }); start = -1; }
      if (hit && start < 0) start = r;
      if (!hit && start >= 0) { ranges.push({ col: c, from: start, to: r - 1 }); start = -1; }
    });
    if (start >= 0) ranges.push({ col: c, from: start, to: col.length - 1 });
  });
  ranges.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  return { max, ranges };
}

export default function MeetEvent() {
  const { id = '' } = useParams();
  const [event, setEvent] = useState<MeetEvent | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [people, setPeople] = useState<MeetPerson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [viewerTz, setViewerTz] = useState(() => readStore<string>(TZ_KEY) || localTimezone());
  const [me, setMe] = useState<Me | null>(() => readStore<Me>(storageKey(id)));
  const [mySlots, setMySlots] = useState<Set<number> | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [filter, setFilter] = useState<Set<string> | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const timezones = useMemo(allTimezones, []);

  // --- load ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetchEvent(id)
      .then((ev) => { if (!cancelled) { setEvent(ev); setStatus(ev ? 'ready' : 'missing'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (status !== 'ready') return;
    return subscribePeople(id, (p) => { setPeople(p); setPeopleLoaded(true); }, () => setStatus('error'));
  }, [id, status]);

  // Hydrate my slots once after sign-in / reload.
  useEffect(() => {
    if (!me || mySlots || !peopleLoaded) return;
    setMySlots(new Set(people.find((p) => p.id === me.id)?.slots ?? []));
  }, [me, mySlots, peopleLoaded, people]);

  const layout = useMemo(() => (event ? buildLayout(event, viewerTz) : null), [event, viewerTz]);

  // --- group data ----------------------------------------------------------------
  const everyone = useMemo(() => {
    const list = people.map((p) => (me && mySlots && p.id === me.id ? { ...p, slots: [...mySlots] } : p));
    if (me && mySlots && !list.some((p) => p.id === me.id)) {
      list.push({ id: me.id, name: me.name, pwHash: me.pwHash, slots: [...mySlots], updatedAt: Date.now() });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [people, me, mySlots]);

  const visible = filter ? everyone.filter((p) => filter.has(p.id)) : everyone;
  const total = visible.length;

  const { counts, whoAt } = useMemo(() => {
    const counts = new Map<number, number>();
    const whoAt = new Map<number, Set<string>>();
    for (const p of visible) {
      for (const s of p.slots) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
        if (!whoAt.has(s)) whoAt.set(s, new Set());
        whoAt.get(s)!.add(p.id);
      }
    }
    return { counts, whoAt };
  }, [visible]);

  const best = useMemo(() => (layout ? bestTimes(layout, counts) : null), [layout, counts]);

  // --- my grid painting ---------------------------------------------------------
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const persist = useCallback(async (slots: Set<number>) => {
    if (!me) return;
    setSaveState('saving');
    try {
      await savePerson(id, { ...me, slots: [...slots].sort((a, b) => a - b), updatedAt: Date.now() });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [id, me]);

  const onDragStart = useCallback((c: number, r: number) => {
    const slot = layout?.cells[c][r];
    if (slot == null || !mySlots) return;
    setDrag({ c0: c, r0: r, c1: c, r1: r, add: !mySlots.has(slot) });
  }, [layout, mySlots]);

  const onDragMove = useCallback((c: number, r: number) => {
    setDrag((d) => (d ? { ...d, c1: c, r1: r } : d));
  }, []);

  const onDragEnd = useCallback(() => {
    const d = dragRef.current;
    if (!d || !layout || !mySlots) return;
    const next = new Set(mySlots);
    layout.cells.forEach((col, c) => col.forEach((slot, r) => {
      if (slot == null || !inDrag(d, c, r)) return;
      if (d.add) next.add(slot); else next.delete(slot);
    }));
    setDrag(null);
    setMySlots(next);
    persist(next);
  }, [layout, mySlots, persist]);

  const myCellStyle = useCallback((slot: number, c: number, r: number) => {
    const on = drag && inDrag(drag, c, r) ? drag.add : mySlots?.has(slot);
    return on ? 'rgb(var(--on))' : undefined;
  }, [drag, mySlots]);

  const groupCellStyle = useCallback((slot: number) => {
    const n = counts.get(slot) ?? 0;
    if (!n || !total) return undefined;
    return `rgba(var(--on), ${(0.15 + 0.85 * (n / total)).toFixed(3)})`;
  }, [counts, total]);

  // --- sign in -------------------------------------------------------------------
  const [nameInput, setNameInput] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [signError, setSignError] = useState('');
  const [signing, setSigning] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = normalizeName(nameInput).slice(0, 40);
    if (!name) return setSignError('Enter your name.');
    setSigning(true);
    setSignError('');
    try {
      const pid = await personIdFor(name);
      const pw = await passwordHash(id, pid, pwInput);
      const existing = people.find((p) => p.id === pid);
      let who: Me;
      if (existing) {
        if (existing.pwHash && existing.pwHash !== pw) {
          setSignError(pwInput ? 'Wrong password for that name.' : 'That name has a password. Enter it to continue.');
          setSigning(false);
          return;
        }
        who = { id: pid, name: existing.name, pwHash: existing.pwHash };
        setMySlots(new Set(existing.slots));
      } else {
        who = { id: pid, name, pwHash: pw };
        await savePerson(id, { ...who, slots: [], updatedAt: Date.now() });
        setMySlots(new Set());
      }
      writeStore(storageKey(id), who);
      setMe(who);
    } catch (err) {
      setSignError(isPermissionError(err) ? 'Saving is not enabled yet. Try again later.' : 'Could not sign in. Try again.');
    }
    setSigning(false);
  };

  const signOut = () => {
    writeStore(storageKey(id), null);
    setMe(null);
    setMySlots(null);
    setSaveState('idle');
    setNameInput('');
    setPwInput('');
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const toggleFilter = (pid: string) => {
    const base = filter ?? new Set(everyone.map((p) => p.id));
    const next = new Set(base);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setFilter(next.size === everyone.length ? null : next);
  };

  // --- render ------------------------------------------------------------------
  if (status !== 'ready' || !event || !layout) {
    return (
      <PageLayout title="Meet | TrueBeast" gradientVariant="green">
        <style>{MEET_CSS}</style>
        <section className="meet py-28 text-center px-4">
          {status === 'loading' ? (
            <Loader2 className="animate-spin mx-auto text-gray-500" />
          ) : (
            <div className="space-y-4">
              <p className="text-gray-300">{status === 'missing' ? "This event doesn't exist (or the link is wrong)." : "Couldn't load this event."}</p>
              <Link to="/meet" className="meet-btn inline-block">Create a new event</Link>
            </div>
          )}
        </section>
      </PageLayout>
    );
  }

  const hovered = hoverSlot != null ? whoAt.get(hoverSlot) ?? new Set<string>() : null;

  return (
    <PageLayout title={`${event.name} | Meet`} description="Mark when you're free and see when the group can meet." gradientVariant="green">
      <style>{MEET_CSS}</style>
      <section className="meet py-12 sm:py-16">
        <div className="max-w-[78rem] mx-auto px-4 sm:px-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div className="min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white break-words">{event.name}</h1>
              <p className="text-sm meet-muted mt-1">
                {everyone.length} {everyone.length === 1 ? 'person has' : 'people have'} responded
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="meet-input !w-auto !py-1.5 !text-[13px] text-white max-w-[14rem]" value={viewerTz} onChange={(e) => { setViewerTz(e.target.value); writeStore(TZ_KEY, e.target.value); }} title="Your time zone">
                {timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
              </select>
              <button className="meet-ghost inline-flex items-center gap-1.5" onClick={copyLink}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <Link to="/meet" className="meet-ghost inline-flex items-center gap-1.5"><Plus size={14} />New</Link>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Mine */}
            <div className="glass rounded-2xl p-5 min-w-0">
              {!me ? (
                <form onSubmit={signIn} className="max-w-[22rem] mx-auto py-6 space-y-3">
                  <h2 className="font-semibold text-white">Add your availability</h2>
                  <p className="text-xs meet-muted leading-relaxed">
                    Your name is only used for this event. New here? Pick a name (and an optional password so nobody else can edit your times).
                    Coming back? Use the same name and password.
                  </p>
                  <input className="meet-input text-white" placeholder="Your name" value={nameInput} maxLength={40} onChange={(e) => setNameInput(e.target.value)} autoFocus />
                  <input className="meet-input text-white" placeholder="Password (optional)" type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} />
                  {signError && <p className="text-sm text-red-400">{signError}</p>}
                  <button className="meet-btn w-full inline-flex items-center justify-center gap-2" disabled={signing || !peopleLoaded}>
                    {signing && <Loader2 size={16} className="animate-spin" />}
                    Continue
                  </button>
                </form>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h2 className="font-semibold text-white">{me.name}'s availability</h2>
                      <p className="text-xs meet-muted mt-0.5">Click and drag to mark when you're free. Saves automatically.</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs ${saveState === 'error' ? 'text-red-400' : 'meet-muted'}`}>
                        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved — retry' : ''}
                      </span>
                      <button className="block text-xs meet-muted underline mt-0.5 ml-auto hover:opacity-100" onClick={signOut}>Not {me.name}?</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs meet-muted mb-3">
                    <span><span className="meet-swatch" style={{ background: 'var(--cell)' }} /> Unavailable</span>
                    <span><span className="meet-swatch" style={{ background: 'rgb(var(--on))' }} /> Available</span>
                  </div>
                  {mySlots ? (
                    <TimeGrid layout={layout} cellStyle={myCellStyle} paint onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} />
                  ) : (
                    <Loader2 className="animate-spin mx-auto my-10 text-gray-500" />
                  )}
                </>
              )}
            </div>

            {/* Group */}
            <div className="glass rounded-2xl p-5 min-w-0">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="font-semibold text-white">Group availability</h2>
                  <p className="text-xs meet-muted mt-0.5">Hover (or tap) a slot to see who's free.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs meet-muted mb-3">
                <span>0/{total}</span>
                <div className="meet-legend flex-1 max-w-[12rem]" />
                <span>{total}/{total} available</span>
              </div>
              <TimeGrid layout={layout} cellStyle={groupCellStyle} hoverSlot={hoverSlot} onHover={setHoverSlot} />

              <div className="mt-5 border-t border-white/10 pt-4 min-h-[7rem]">
                {hovered ? (
                  <div>
                    <p className="text-sm text-white font-medium">
                      {hovered.size}/{total} available
                      <span className="meet-muted font-normal"> · {describeSlot(event, layout, hoverSlot!)}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                      <div>
                        <p className="text-xs meet-muted mb-1.5">Available</p>
                        {visible.filter((p) => hovered.has(p.id)).map((p) => <p key={p.id} className="text-white truncate">{p.name}</p>)}
                      </div>
                      <div>
                        <p className="text-xs meet-muted mb-1.5">Unavailable</p>
                        {visible.filter((p) => !hovered.has(p.id)).map((p) => <p key={p.id} className="meet-muted truncate line-through decoration-1">{p.name}</p>)}
                      </div>
                    </div>
                  </div>
                ) : everyone.length ? (
                  <div className="space-y-4">
                    {best && best.max > 0 && (
                      <div>
                        <p className="text-xs meet-muted mb-1.5">Best times ({best.max}/{total} free)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {best.ranges.slice(0, 4).map((rg) => {
                            const col = layout.columns[rg.col];
                            return (
                              <span key={`${rg.col}-${rg.from}`} className="text-xs rounded-md px-2 py-1 bg-white/5 text-gray-300">
                                {col.top}{col.bottom && ` ${col.bottom}`} · {formatMinute(layout.rows[rg.from])}–{formatMinute(layout.rows[rg.to] + SLOT_MINUTES)}
                              </span>
                            );
                          })}
                          {best.ranges.length > 4 && <span className="text-xs meet-muted px-1 py-1">+{best.ranges.length - 4} more</span>}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs meet-muted mb-1.5">
                        Responses {filter ? `· showing ${visible.length} of ${everyone.length}` : '· click names to filter'}
                        {filter && <button className="underline ml-2" onClick={() => setFilter(null)}>show all</button>}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {everyone.map((p) => {
                          const on = !filter || filter.has(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleFilter(p.id)}
                              className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${on ? 'border-white/10 text-white bg-white/5' : 'border-white/10 meet-muted line-through'}`}
                            >
                              {p.name}{me?.id === p.id ? ' (you)' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm meet-muted">No one has responded yet. Share the link to get started.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
