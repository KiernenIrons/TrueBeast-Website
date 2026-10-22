import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { MEET_CSS } from './TimeGrid';
import {
  MAX_DATES, WEEKDAYS, addDays, allTimezones, createEvent, formatHour, isPermissionError,
  localTimezone, todayIso, type MeetMode,
} from './lib';

const HOURS = Array.from({ length: 25 }, (_, i) => i);

interface Drag { anchor: number; hover: number; add: boolean }

export default function CreateMeet() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Opened from a Discord session's "Find a time" button: ?name=<session name>&session=<channel id>
  const discordSession = /^\d{17,20}$/.test(params.get('session') ?? '') ? params.get('session')! : '';
  const today = todayIso();
  const [name, setName] = useState(() => (params.get('name') ?? '').slice(0, 100));
  const [mode, setMode] = useState<MeetMode>('dates');
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<Set<string>>(new Set());
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [timezone, setTimezone] = useState(localTimezone());
  const [monthStart, setMonthStart] = useState(() => today.slice(0, 8) + '01');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezones = useMemo(allTimezones, []);

  // 6x7 calendar cells starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const [y, m] = monthStart.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const start = addDays(monthStart, -firstDow);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [monthStart]);

  const monthLabel = useMemo(() => {
    const [y, m] = monthStart.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, 1)));
  }, [monthStart]);

  const shiftMonth = (delta: number) => {
    const [y, m] = monthStart.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonthStart(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`);
  };

  // --- drag selection (rectangle, like when2meet) ---------------------------
  const keyAt = (i: number) => (mode === 'dates' ? cells[i] : String(i));
  const selected = mode === 'dates' ? dates : days;

  // Linear range in reading order: dragging 15th -> 22nd fills every day between.
  const inRect = (i: number, d: Drag) =>
    i >= Math.min(d.anchor, d.hover) && i <= Math.max(d.anchor, d.hover);

  const isOn = (i: number) => (drag && inRect(i, drag) ? drag.add : selected.has(keyAt(i)));

  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      const set = new Set(mode === 'dates' ? dates : days);
      const count = mode === 'dates' ? 42 : 7;
      for (let i = 0; i < count; i++) {
        if (!inRect(i, d)) continue;
        if (d.add) set.add(keyAt(i)); else set.delete(keyAt(i));
      }
      if (mode === 'dates') setDates(set); else setDays(set);
      setDrag(null);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  });

  const indexAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
    return el ? Number(el.dataset.i) : null;
  };

  const onDown = (e: React.PointerEvent) => {
    const i = indexAt(e.clientX, e.clientY);
    if (i == null) return;
    e.preventDefault();
    setDrag({ anchor: i, hover: i, add: !selected.has(keyAt(i)) });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const i = indexAt(e.clientX, e.clientY);
    if (i != null && i !== drag.hover) setDrag({ ...drag, hover: i });
  };

  /** Clicking a weekday header toggles that weekday for the visible month. */
  const toggleWeekday = (dow: number) => {
    const month = monthStart.slice(0, 7);
    const col = cells.filter((d, i) => i % 7 === dow && d.startsWith(month));
    const allOn = col.every((d) => dates.has(d));
    const set = new Set(dates);
    col.forEach((d) => (allOn ? set.delete(d) : set.add(d)));
    setDates(set);
  };

  // --- submit ----------------------------------------------------------------
  const chosen = [...selected].sort();
  const effectiveEnd = endHour === 0 ? 24 : endHour;

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Give your event a name.');
    if (!chosen.length) return setError(mode === 'dates' ? 'Pick at least one date.' : 'Pick at least one day.');
    if (chosen.length > MAX_DATES) return setError(`Pick ${MAX_DATES} dates or fewer.`);
    if (effectiveEnd <= startHour) return setError('"No later than" must be after "No earlier than".');
    setBusy(true);
    try {
      const id = await createEvent({
        name: name.trim().slice(0, 100),
        mode,
        dates: chosen,
        startHour,
        endHour: effectiveEnd,
        timezone,
        ...(discordSession ? { discordSession } : {}),
      });
      navigate(`/meet/${id}`);
    } catch (e) {
      setError(isPermissionError(e)
        ? 'Event storage is not enabled yet (Firestore rules). Try again later.'
        : 'Could not create the event. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <PageLayout title="Meet | TrueBeast" description="Find a time that works for everyone. Pick dates, share the link, and see when your group is free." gradientVariant="green">
      <style>{MEET_CSS}</style>
      <section className="meet py-8 sm:py-14">
        <div className="w-full max-w-[80rem] mx-auto px-3 sm:px-6">
          <div className="text-center mb-8 sm:mb-12 space-y-4">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <CalendarDays size={18} className="text-green-400" />
              <span className="text-[15px] text-gray-300 font-medium">Meet</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold">Find a time that works</h1>
            <p className="text-gray-400 max-w-[38rem] mx-auto text-base sm:text-lg leading-relaxed">
              Pick some dates, share the link, and everyone drags over when they're free. No accounts.
            </p>
          </div>

          {discordSession && (
            <p className="text-center text-sm meet-muted mb-3">
              Linked to your Discord session. Once you create it, the bot posts it there within a few minutes
              (or paste the link with <span className="text-gray-300">🔗 Submit schedule link</span>).
            </p>
          )}
          <input
            className="meet-input text-center !text-xl sm:!text-2xl !py-4 mb-5 sm:mb-6 text-white"
            placeholder="Event name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            {/* Dates */}
            <div className="glass meet-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <h2 className="font-semibold text-white text-lg sm:text-xl">What dates might work?</h2>
                <div className="meet-seg" role="radiogroup">
                  {(['dates', 'days'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      role="radio"
                      aria-checked={mode === m}
                    >
                      {m === 'dates' ? 'Specific dates' : 'Days of week'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm meet-muted mb-5">Click and drag from one date to another to select everything in between. Drag over selected days to remove them.</p>

              {mode === 'dates' ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <button className="meet-ghost !p-2.5" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
                    <span className="text-lg font-semibold text-white">{monthLabel}</span>
                    <button className="meet-ghost !p-2.5" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={20} /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-1.5">
                    {WEEKDAYS.map((d, i) => (
                      <button key={i} onClick={() => toggleWeekday(i)} className="text-sm meet-muted py-1.5 hover:opacity-100" title={`Toggle every ${d}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2 select-none" style={{ touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove}>
                    {cells.map((d, i) => (
                      <div
                        key={d}
                        data-i={i}
                        className={`meet-cal-day ${isOn(i) ? 'on' : ''} ${d.slice(0, 7) !== monthStart.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''}`}
                      >
                        {Number(d.slice(8))}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2 select-none" style={{ touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove}>
                  {WEEKDAYS.map((d, i) => (
                    <div key={i} data-i={i} className={`meet-cal-day !h-20 ${isOn(i) ? 'on' : ''}`}>{d}</div>
                  ))}
                </div>
              )}
              <p className="text-sm meet-muted mt-4">
                {chosen.length ? `${chosen.length} ${mode === 'dates' ? 'date' : 'day'}${chosen.length === 1 ? '' : 's'} selected` : 'Nothing selected yet'}
                {chosen.length > 0 && (
                  <button className="ml-2 underline hover:opacity-100" onClick={() => (mode === 'dates' ? setDates(new Set()) : setDays(new Set()))}>clear</button>
                )}
              </p>
            </div>

            {/* Times */}
            <div className="glass meet-panel flex flex-col gap-5">
              <h2 className="font-semibold text-white text-lg sm:text-xl">What times might work?</h2>
              <label className="block">
                <span className="text-sm meet-muted block mb-2">No earlier than</span>
                <select className="meet-input text-white" value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                  {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm meet-muted block mb-2">No later than</span>
                <select className="meet-input text-white" value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                  {HOURS.slice(1).map((h) => <option key={h} value={h % 24}>{formatHour(h)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm meet-muted block mb-2">Time zone</span>
                <select className="meet-input text-white" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <div className="mt-auto pt-2">
                {error && <p className="text-[15px] text-red-400 mb-3">{error}</p>}
                <button className="meet-btn w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={submit}>
                  {busy && <Loader2 size={18} className="animate-spin" />}
                  Create event
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
