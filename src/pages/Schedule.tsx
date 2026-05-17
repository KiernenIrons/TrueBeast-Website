import { useState, useEffect } from 'react';
import { Tv, ExternalLink, Radio } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Schedule config — SUN / TUE / THU at 19:00 Europe/Dublin
// ---------------------------------------------------------------------------

const STREAM_DAYS = new Set([0, 2, 4]); // Sun=0, Tue=2, Thu=4
const STREAM_HOUR = 19;
const TZ = 'Europe/Dublin';

const SCHEDULE: { dayNum: number; label: string; short: string }[] = [
  { dayNum: 0, label: 'Sunday',   short: 'SUN' },
  { dayNum: 2, label: 'Tuesday',  short: 'TUE' },
  { dayNum: 4, label: 'Thursday', short: 'THU' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextStreamUTC(): Date {
  const now = new Date();

  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const probe = new Date(now.getTime() + daysAhead * 86_400_000);

    const dayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
    }).format(probe);

    const dayNum = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayShort);
    if (!STREAM_DAYS.has(dayNum)) continue;

    // YYYY-MM-DD in Dublin timezone
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(probe);

    const [y, mo, d] = dateStr.split('-').map(Number);

    // Build UTC candidate at STREAM_HOUR UTC, then adjust for Dublin offset
    const nominalUTC = new Date(Date.UTC(y, mo - 1, d, STREAM_HOUR, 0, 0));
    const dublinHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: '2-digit',
        hour12: false,
      }).format(nominalUTC),
      10,
    );
    // If Dublin is UTC+1, dublinHour=20 when nominalUTC is 19:00 → subtract 1h
    const streamUTC = new Date(nominalUTC.getTime() - (dublinHour - STREAM_HOUR) * 3_600_000);

    if (streamUTC > now) return streamUTC;
  }

  // Fallback (should never hit)
  return new Date(now.getTime() + 7 * 86_400_000);
}

function getDublinDayNum(date: Date): number {
  const dayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayShort);
}

interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calcCountdown(target: Date): Countdown {
  const diff = Math.max(0, target.getTime() - Date.now());
  return {
    days:    Math.floor(diff / 86_400_000),
    hours:   Math.floor(diff / 3_600_000) % 24,
    minutes: Math.floor(diff / 60_000) % 60,
    seconds: Math.floor(diff / 1_000) % 60,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Countdown display
// ---------------------------------------------------------------------------

function CountdownDigits({ countdown }: { countdown: Countdown }) {
  const segments = [
    { label: 'DAYS',    value: pad(countdown.days) },
    { label: 'HOURS',   value: pad(countdown.hours) },
    { label: 'MINUTES', value: pad(countdown.minutes) },
    { label: 'SECONDS', value: pad(countdown.seconds) },
  ];

  return (
    <div className="flex items-start justify-center">
      {segments.map(({ label, value }, i) => (
        <div key={label} className="flex items-start">
          {i > 0 && (
            <span
              className="font-mono font-bold text-green-400 mt-[18px] mx-0.5 text-4xl md:text-5xl select-none"
              style={{ textShadow: '0 0 18px rgba(74,222,128,0.5)' }}
              aria-hidden
            >
              :
            </span>
          )}
          <div className="flex flex-col items-center px-1.5">
            <span className="text-[9px] text-white/40 font-semibold tracking-[0.2em] mb-1.5">
              {label}
            </span>
            <span
              className="font-mono font-bold text-green-400 tabular-nums leading-none text-4xl md:text-5xl"
              style={{ textShadow: '0 0 24px rgba(74,222,128,0.6)' }}
            >
              {value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Schedule() {
  const [nextStream, setNextStream] = useState<Date>(() => getNextStreamUTC());
  const [countdown, setCountdown]   = useState<Countdown>(() => calcCountdown(getNextStreamUTC()));

  useEffect(() => {
    const tick = () => {
      const next = getNextStreamUTC();
      setNextStream(next);
      setCountdown(calcCountdown(next));
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  const nextDayNum = getDublinDayNum(nextStream);

  // Local time string for the next stream (user's browser timezone)
  const localTimeStr = nextStream.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const localDateStr = nextStream.toLocaleDateString(undefined, {
    weekday: 'long',
    month:   'short',
    day:     'numeric',
  });

  const isToday = (() => {
    const now = new Date();
    return (
      nextStream.getDate()     === now.getDate()     &&
      nextStream.getMonth()    === now.getMonth()    &&
      nextStream.getFullYear() === now.getFullYear()
    );
  })();

  return (
    <PageLayout
      title="Stream Schedule — RealTrueBeast"
      description="Live countdown to RealTrueBeast's next Twitch stream. Sun, Tue, Thu at 7:00 PM Dublin time."
      gradientVariant="green"
    >
      <div className="max-w-lg mx-auto px-4 pb-20 pt-6">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-green-400/60 text-xs font-semibold tracking-[0.2em] uppercase mb-3">
            <Radio className="w-3.5 h-3.5" />
            <span>Stream Schedule</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-1 tracking-tight">
            RealTrueBeast
          </h1>
          <p className="text-white/40 text-sm">Live on Twitch</p>
        </div>

        {/* Countdown card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 mb-4 text-center">
          <p className="text-white/40 text-[10px] font-semibold tracking-[0.25em] uppercase mb-7">
            Countdown to Next Stream
          </p>

          <CountdownDigits countdown={countdown} />

          {/* Divider */}
          <div className="my-7 h-px bg-white/[0.06]" />

          {/* Schedule day bubbles */}
          <div className="flex justify-center gap-10 mb-5">
            {SCHEDULE.map(({ dayNum, short }) => {
              const isNext = dayNum === nextDayNum;
              return (
                <div key={dayNum} className="flex flex-col items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full transition-all ${
                      isNext ? 'bg-green-400' : 'bg-white/15'
                    }`}
                    style={isNext ? { boxShadow: '0 0 10px rgba(74,222,128,0.8)' } : undefined}
                  />
                  <span
                    className={`text-xs font-bold tracking-[0.15em] ${
                      isNext ? 'text-green-400' : 'text-white/40'
                    }`}
                  >
                    {short}
                  </span>
                  <span className={`text-xs ${isNext ? 'text-green-300/80' : 'text-white/25'}`}>
                    07:00 PM
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-white/25 text-[10px] tracking-widest uppercase">
            Times shown as Europe/Dublin
          </p>
        </div>

        {/* Next stream local time */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-white/40 text-[10px] font-semibold tracking-[0.2em] uppercase mb-0.5">
              Next stream in your timezone
            </p>
            <p className="text-white font-semibold">
              {isToday ? 'Today' : localDateStr}{' '}
              <span className="text-green-400">{localTimeStr}</span>
            </p>
          </div>
          <div className="w-2 h-2 rounded-full bg-green-400/50 animate-pulse" />
        </div>

        {/* Watch button */}
        <a
          href="https://twitch.tv/realtruebeast"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 font-semibold text-sm hover:bg-green-500/20 active:scale-95 transition-all"
        >
          <Tv className="w-4 h-4" />
          Watch on Twitch
          <ExternalLink className="w-3.5 h-3.5 opacity-60" />
        </a>

      </div>
    </PageLayout>
  );
}
