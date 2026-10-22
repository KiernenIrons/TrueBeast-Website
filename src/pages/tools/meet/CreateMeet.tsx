import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const today = todayIso();
  const [name, setName] = useState('');
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
  const cols = 7;
  const keyAt = (i: number) => (mode === 'dates' ? cells[i] : String(i));
  const selected = mode === 'dates' ? dates : days;

  const inRect = (i: number, d: Drag) => {
    const [ar, ac] = [Math.floor(d.anchor / cols), d.anchor % cols];
    const [hr, hc] = [Math.floor(d.hover / cols), d.hover % cols];
    const [r, c] = [Math.floor(i / cols), i % cols];
    return (ar - r) * (r - hr) >= 0 && (ac - c) * (c - hc) >= 0;
  };

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
      <section className="meet py-14 sm:py-20">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6">
          <div className="text-center mb-10 space-y-3">
            <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2">
              <CalendarDays size={15} className="text-green-400" />
              <span className="text-sm text-gray-300 font-medium">Meet</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold">Find a time that works</h1>
            <p className="text-gray-400 max-w-[30rem] mx-auto text-sm leading-relaxed">
              Pick some dates, share the link, and everyone drags over when they're free. No accounts.
            </p>
          </div>

          <input
            className="meet-input text-center !text-lg !py-3 mb-6 text-white"
            placeholder="Event name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
            {/* Dates */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-white text-sm">What dates might work?</h2>
                <div className="flex text-xs rounded-lg overflow-hidden border border-white/10">
                  {(['dates', 'days'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-3 py-1.5 ${mode === m ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      {m === 'dates' ? 'Specific dates' : 'Days of week'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs meet-muted mb-4">Click and drag to select. Drag over selected days to remove them.</p>

              {mode === 'dates' ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <button className="meet-ghost !px-2" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
                    <span className="text-sm font-medium text-white">{monthLabel}</span>
                    <button className="meet-ghost !px-2" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {WEEKDAYS.map((d, i) => (
                      <button key={i} onClick={() => toggleWeekday(i)} className="text-[11px] meet-muted py-1 hover:opacity-100" title={`Toggle every ${d}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1 select-none" style={{ touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove}>
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
                <div className="grid grid-cols-7 gap-1 select-none" style={{ touchAction: 'none' }} onPointerDown={onDown} onPointerMove={onMove}>
                  {WEEKDAYS.map((d, i) => (
                    <div key={i} data-i={i} className={`meet-cal-day !h-14 ${isOn(i) ? 'on' : ''}`}>{d}</div>
                  ))}
                </div>
              )}
              <p className="text-xs meet-muted mt-3">
                {chosen.length ? `${chosen.length} ${mode === 'dates' ? 'date' : 'day'}${chosen.length === 1 ? '' : 's'} selected` : 'Nothing selected yet'}
                {chosen.length > 0 && (
                  <button className="ml-2 underline hover:opacity-100" onClick={() => (mode === 'dates' ? setDates(new Set()) : setDays(new Set()))}>clear</button>
                )}
              </p>
            </div>

            {/* Times */}
            <div className="glass rounded-2xl p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-white text-sm">What times might work?</h2>
              <label className="block">
                <span className="text-xs meet-muted block mb-1.5">No earlier than</span>
                <select className="meet-input text-white" value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                  {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs meet-muted block mb-1.5">No later than</span>
                <select className="meet-input text-white" value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                  {HOURS.slice(1).map((h) => <option key={h} value={h % 24}>{formatHour(h)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs meet-muted block mb-1.5">Time zone</span>
                <select className="meet-input text-white" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
              <div className="mt-auto pt-2">
                {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
                <button className="meet-btn w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={submit}>
                  {busy && <Loader2 size={16} className="animate-spin" />}
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
