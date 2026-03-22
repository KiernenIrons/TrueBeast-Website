import { useState } from 'react';
import { Trophy, Gift, ExternalLink, Users, Sparkles, Clock, ArrowRight } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG, type Giveaway } from '@/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_META = {
  open: {
    label: 'Open Now',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    pulse: true,
  },
  upcoming: {
    label: 'Coming Soon',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    pulse: false,
  },
  ended: {
    label: 'Ended',
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
    pulse: false,
  },
} as const;

const STATUS_ORDER: Record<string, number> = { upcoming: 0, open: 1, ended: 2 };

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open Now' },
  { key: 'upcoming', label: 'Coming Soon' },
  { key: 'ended',    label: 'Ended' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function sortGiveaways(list: Giveaway[]): Giveaway[] {
  return [...list].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    const dateA = a.date ? new Date(a.date + 'T00:00:00').getTime() : 0;
    const dateB = b.date ? new Date(b.date + 'T00:00:00').getTime() : 0;
    return dateB - dateA;
  });
}

// ---------------------------------------------------------------------------
// Featured Giveaway (hero-style showcase for open giveaways)
// ---------------------------------------------------------------------------

function FeaturedGiveaway({ g }: { g: Giveaway }) {
  const imgSrc = g.image ? `/${g.image}` : null;
  const dateStr = formatDate(g.date);

  return (
    <div className="relative mb-16 rounded-3xl overflow-hidden border border-green-500/20">
      {/* Animated gradient border glow */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-green-500/20 via-emerald-500/5 to-yellow-500/10 pointer-events-none" />
      <div className="absolute -inset-[1px] rounded-3xl opacity-50 pointer-events-none"
           style={{ background: 'conic-gradient(from 180deg, transparent 60%, rgba(34,197,94,0.3) 75%, transparent 90%)' }} />

      <div className="relative glass-strong rounded-3xl overflow-hidden">
        {/* Live banner */}
        <div className="bg-gradient-to-r from-green-500/20 via-emerald-500/10 to-transparent px-8 py-4 flex items-center gap-3 border-b border-green-500/10">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <span className="text-green-400 font-display font-bold text-sm tracking-widest uppercase">Live Giveaway</span>
          {dateStr && (
            <span className="ml-auto text-gray-500 text-sm flex items-center gap-1.5">
              <Clock size={14} />
              Ends {dateStr}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-8 sm:p-10 grid md:grid-cols-2 gap-10 items-center">
          {/* Left: Image */}
          {imgSrc && (
            <div className="relative group">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-green-500/10">
                <img
                  src={imgSrc}
                  alt={g.item}
                  className="w-full aspect-video object-contain bg-black/40 transition-transform duration-500 group-hover:scale-[1.02]"
                />
              </div>
            </div>
          )}

          {/* Right: Details */}
          <div className="flex flex-col gap-5">
            <div className="inline-flex items-center gap-2 self-start bg-green-500/10 border border-green-500/20 rounded-full px-4 py-1.5 text-green-400 text-xs font-semibold uppercase tracking-wider">
              <Sparkles size={14} />
              Featured Prize
            </div>

            <h2 className="font-display font-bold text-3xl sm:text-4xl leading-tight">{g.item}</h2>

            {g.description && (
              <p className="text-gray-400 text-lg leading-relaxed">{g.description}</p>
            )}

            {/* Entry CTA */}
            {g.entryUrl ? (
              <a
                href={g.entryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl py-4 px-8 text-base transition-all duration-200 hover:shadow-lg hover:shadow-green-500/25 hover:-translate-y-0.5 mt-2"
              >
                <Gift size={18} />
                Enter Giveaway
                <ArrowRight size={16} />
              </a>
            ) : (
              <div className="inline-flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400/70 rounded-xl py-4 px-8 text-sm mt-2">
                <Gift size={16} />
                Entry details coming soon
              </div>
            )}

            <div className="flex items-center gap-2 text-gray-500 text-sm mt-1">
              <Users size={14} />
              <span className="italic">Winner TBD</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GiveawayCard (for grid)
// ---------------------------------------------------------------------------

function GiveawayCard({ g }: { g: Giveaway }) {
  const meta = STATUS_META[g.status] ?? STATUS_META.ended;
  const imgSrc = g.image ? `/${g.image}` : null;
  const dateStr = formatDate(g.date);

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-1 border border-white/5">
      {/* Image */}
      <div className="relative">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={g.item}
            className="w-full aspect-video object-contain bg-black/30"
          />
        ) : (
          <div className="w-full aspect-video flex items-center justify-center bg-white/[0.03]">
            <Gift size={48} className="text-gray-700" />
          </div>
        )}

        {/* Status badge */}
        <div className={`absolute top-3 left-3 glass px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 ${meta.color}`}>
          {meta.pulse && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
          )}
          {meta.label}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col gap-3 flex-1">
        <h3 className="font-display font-bold text-lg leading-snug">{g.item}</h3>

        {g.description && (
          <p className="text-gray-400 text-sm leading-relaxed">{g.description}</p>
        )}

        {/* Enter button for open giveaways */}
        {g.status === 'open' && g.entryUrl && (
          <a
            href={g.entryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-green-500/15 border border-green-500/30 hover:bg-green-500/25 text-green-400 font-semibold rounded-xl py-3 text-sm transition-all"
          >
            <Gift size={15} />
            Enter Giveaway
            <ExternalLink size={13} />
          </a>
        )}

        {g.status === 'open' && !g.entryUrl && (
          <div className="inline-flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400/70 rounded-xl py-3 text-sm">
            <Gift size={15} />
            Entry details coming soon
          </div>
        )}

        {/* Footer: winner / date */}
        <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-1.5 min-w-0">
            {g.status === 'ended' ? (
              <>
                <Trophy size={15} className="text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300 font-medium truncate">
                  {g.winner || 'No winner set'}
                </span>
              </>
            ) : (
              <>
                <Users size={15} className="text-gray-500 flex-shrink-0" />
                <span className="text-gray-500 italic">Winner TBD</span>
              </>
            )}
          </div>
          {dateStr && (
            <span className="text-gray-600 text-xs flex-shrink-0">{dateStr}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Giveaways() {
  const [activeFilter, setActiveFilter] = useState('all');

  const allGiveaways = sortGiveaways(SITE_CONFIG.giveaways ?? []);
  const openGiveaways = allGiveaways.filter((g) => g.status === 'open');
  const nonOpenGiveaways = allGiveaways.filter((g) => g.status !== 'open');

  const filtered =
    activeFilter === 'all'
      ? nonOpenGiveaways
      : activeFilter === 'open'
        ? openGiveaways
        : nonOpenGiveaways.filter((g) => g.status === activeFilter);

  const usedStatuses = new Set(allGiveaways.map((g) => g.status));
  const visibleFilters = FILTERS.filter(
    (f) => f.key === 'all' || usedStatuses.has(f.key as Giveaway['status']),
  );

  const openCount     = openGiveaways.length;
  const upcomingCount = allGiveaways.filter((g) => g.status === 'upcoming').length;
  const endedCount    = allGiveaways.filter((g) => g.status === 'ended').length;

  const filterActiveClass: Record<string, string> = {
    all:      activeFilter === 'all'      ? 'glass-strong text-white border-white/20'          : '',
    open:     activeFilter === 'open'     ? 'bg-green-500/15 text-green-400 border-green-500/30'   : '',
    upcoming: activeFilter === 'upcoming' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' : '',
    ended:    activeFilter === 'ended'    ? 'bg-gray-500/20 text-gray-300 border-gray-500/30'       : '',
  };

  return (
    <PageLayout title="Giveaways | TrueBeast" gradientVariant="gold">
      <section className="py-20 sm:py-28">
        <div className="max-w-[72rem] mx-auto px-4 sm:px-6">

          {/* Hero */}
          <div className="text-center mb-14 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <Trophy size={16} className="text-yellow-400" />
              <span className="text-sm text-gray-300 font-medium">Community Giveaways</span>
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-bold">
              Give<span className="text-gradient">aways</span>
            </h1>
            <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
              Prizes for the TrueBeast squad. Past winners, open giveaways, and what's coming next.
            </p>

            {/* Quick stats */}
            {allGiveaways.length > 0 && (openCount > 0 || upcomingCount > 0 || endedCount > 0) && (
              <div className="flex items-center justify-center gap-6 flex-wrap pt-2">
                {openCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-green-400 font-semibold">{openCount} open</span>
                  </div>
                )}
                {upcomingCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-yellow-400 font-semibold">{upcomingCount} coming soon</span>
                  </div>
                )}
                {endedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500" />
                    <span className="text-gray-400 font-semibold">{endedCount} ended</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Featured open giveaways */}
          {openGiveaways.map((g) => (
            <FeaturedGiveaway key={g.id} g={g} />
          ))}

          {/* Section divider when there are featured giveaways */}
          {openGiveaways.length > 0 && nonOpenGiveaways.length > 0 && (
            <div className="flex items-center gap-4 mb-10">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-gray-500 text-sm font-medium">Past & Upcoming</span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
          )}

          {/* Filter tabs */}
          {visibleFilters.length > 1 && (
            <div className="flex flex-wrap gap-2 justify-center mb-10">
              {visibleFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  className={`glass border border-white/10 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    filterActiveClass[f.key] || 'text-gray-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Cards */}
          {allGiveaways.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-6xl mb-4">🎁</div>
              <h2 className="font-display font-bold text-2xl mb-3 text-gray-300">No giveaways yet</h2>
              <p className="text-gray-500 max-w-sm mx-auto">
                TrueBeast's first giveaway is coming. Join the Discord to be the first to know.
              </p>
              <a
                href={SITE_CONFIG.social.discord ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 glass px-6 py-3 rounded-xl mt-6 text-indigo-400 font-medium hover:bg-white/10 transition-colors"
              >
                Join Discord
              </a>
            </div>
          ) : filtered.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center text-gray-500 text-sm">
              No giveaways in this category right now.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((g) => (
                <GiveawayCard key={g.id} g={g} />
              ))}
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
}
