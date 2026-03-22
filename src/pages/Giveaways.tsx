import { useState, useEffect, useCallback } from 'react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG, type Giveaway } from '@/config';
import {
  Gift, Award, Clock, Users, Trophy, ChevronRight,
  Youtube, Instagram, Twitch, MessageSquare, Rocket,
  Heart, Star, ExternalLink, Check, X,
} from 'lucide-react';
import { DiscordIcon } from '@/components/shared/DiscordIcon';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_META = {
  open:     { label: 'Open Now',    color: 'text-green-400',  dotColor: 'bg-green-400',  borderColor: 'border-green-500/20', bgColor: 'bg-green-500/10' },
  upcoming: { label: 'Coming Soon', color: 'text-yellow-400', dotColor: 'bg-yellow-400', borderColor: 'border-yellow-500/20', bgColor: 'bg-yellow-500/10' },
  ended:    { label: 'Ended',       color: 'text-gray-400',   dotColor: 'bg-gray-500',   borderColor: 'border-gray-500/20',   bgColor: 'bg-gray-500/10' },
} as const;

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open Now' },
  { key: 'upcoming', label: 'Coming Soon' },
  { key: 'ended',    label: 'Ended' },
] as const;

const STATUS_ORDER: Record<string, number> = { upcoming: 0, open: 1, ended: 2 };

// ---------------------------------------------------------------------------
// Entry actions for live giveaways
// ---------------------------------------------------------------------------

interface EntryAction {
  id: string;
  label: string;
  description: string;
  points: number;
  icon: React.ReactNode;
  color: string;
  url?: string;
  /** If true, this action can only be claimed once */
  oneTime: boolean;
}

const ENTRY_ACTIONS: EntryAction[] = [
  {
    id: 'discord_join',
    label: 'Join the Discord',
    description: 'Join the TrueBeast Discord server',
    points: 5,
    icon: <DiscordIcon className="w-5 h-5" />,
    color: 'text-indigo-400',
    url: SITE_CONFIG.social.discord || 'https://discord.gg/Nk8vekY',
    oneTime: true,
  },
  {
    id: 'youtube_sub',
    label: 'Subscribe on YouTube',
    description: 'Subscribe to @RealTrueBeast',
    points: 5,
    icon: <Youtube className="w-5 h-5" />,
    color: 'text-red-500',
    url: SITE_CONFIG.social.youtube || 'https://www.youtube.com/@RealTrueBeast',
    oneTime: true,
  },
  {
    id: 'youtube_comment',
    label: 'Comment on a Video',
    description: 'Leave a comment on any recent video',
    points: 3,
    icon: <MessageSquare className="w-5 h-5" />,
    color: 'text-red-400',
    url: SITE_CONFIG.social.youtube || 'https://www.youtube.com/@RealTrueBeast',
    oneTime: false,
  },
  {
    id: 'instagram_follow',
    label: 'Follow on Instagram',
    description: 'Follow @kiernen_100',
    points: 3,
    icon: <Instagram className="w-5 h-5" />,
    color: 'text-pink-400',
    url: SITE_CONFIG.social.instagram || undefined,
    oneTime: true,
  },
  {
    id: 'twitch_follow',
    label: 'Follow on Twitch',
    description: 'Follow realtruebeast on Twitch',
    points: 3,
    icon: <Twitch className="w-5 h-5" />,
    color: 'text-purple-400',
    url: SITE_CONFIG.social.twitch || undefined,
    oneTime: true,
  },
  {
    id: 'twitch_sub',
    label: 'Subscribe on Twitch',
    description: 'Subscribe for bonus entries',
    points: 10,
    icon: <Star className="w-5 h-5" />,
    color: 'text-purple-300',
    url: SITE_CONFIG.social.twitch || undefined,
    oneTime: true,
  },
  {
    id: 'discord_boost',
    label: 'Boost the Discord',
    description: 'Server boost for big bonus entries',
    points: 15,
    icon: <Rocket className="w-5 h-5" />,
    color: 'text-pink-500',
    url: SITE_CONFIG.social.discord || 'https://discord.gg/Nk8vekY',
    oneTime: true,
  },
  {
    id: 'share',
    label: 'Share the Giveaway',
    description: 'Share on any social platform',
    points: 2,
    icon: <Heart className="w-5 h-5" />,
    color: 'text-green-400',
    oneTime: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === 'N/A') return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getStorageKey(giveawayItem: string): string {
  return `tb-giveaway-${giveawayItem.replace(/\s+/g, '-').toLowerCase()}`;
}

function getCompletedActions(giveawayItem: string): Set<string> {
  try {
    const raw = localStorage.getItem(getStorageKey(giveawayItem));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCompletedAction(giveawayItem: string, actionId: string): void {
  const completed = getCompletedActions(giveawayItem);
  completed.add(actionId);
  localStorage.setItem(getStorageKey(giveawayItem), JSON.stringify([...completed]));
}

function getEntryName(giveawayItem: string): string {
  try {
    return localStorage.getItem(`${getStorageKey(giveawayItem)}-name`) || '';
  } catch {
    return '';
  }
}

function saveEntryName(giveawayItem: string, name: string): void {
  localStorage.setItem(`${getStorageKey(giveawayItem)}-name`, name);
}

// ---------------------------------------------------------------------------
// GiveawayCard
// ---------------------------------------------------------------------------

function GiveawayCard({ g, onEnter }: { g: Giveaway; onEnter?: (g: Giveaway) => void }) {
  const meta = STATUS_META[g.status] || STATUS_META.ended;
  const imgSrc = g.image
    ? (g.image.startsWith('http') ? g.image : `/${g.image}`)
    : null;

  return (
    <div className="glass rounded-2xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-1">
      {/* Image */}
      <div className="relative overflow-hidden">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={g.item}
            className="w-full aspect-video object-contain bg-black/30"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full aspect-video flex items-center justify-center bg-white/[0.03]">
            <Gift className="w-12 h-12 text-gray-700" />
          </div>
        )}
        {/* Status badge */}
        <div className={`absolute top-3 left-3 glass px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 ${meta.color}`}>
          {g.status === 'open' && (
            <span className={`w-2 h-2 rounded-full ${meta.dotColor} animate-pulse inline-block`} />
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

        <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            {g.status === 'ended' ? (
              <>
                <Trophy className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300 font-medium truncate">{g.winner || 'No winner set'}</span>
              </>
            ) : (
              <>
                <Users className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="text-gray-500 italic">Winner TBD</span>
              </>
            )}
          </div>
          {formatDate(g.date) && (
            <span className="text-gray-600 text-xs flex-shrink-0">{formatDate(g.date)}</span>
          )}
        </div>

        {/* Enter button for open giveaways */}
        {g.status === 'open' && onEnter && (
          <button
            onClick={() => onEnter(g)}
            className="mt-2 w-full py-2.5 rounded-xl bg-green-500/20 text-green-400 font-semibold text-sm
                       border border-green-500/30 hover:bg-green-500/30 hover:border-green-500/40
                       transition-all duration-200 flex items-center justify-center gap-2"
          >
            Enter Giveaway <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Featured Giveaway (live/open)
// ---------------------------------------------------------------------------

function FeaturedGiveaway({ g }: { g: Giveaway }) {
  const [completed, setCompleted] = useState<Set<string>>(() => getCompletedActions(g.item));
  const [entryName, setEntryName] = useState(() => getEntryName(g.item));
  const [nameInput, setNameInput] = useState(entryName);
  const [nameSubmitted, setNameSubmitted] = useState(!!entryName);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);

  const totalPoints = ENTRY_ACTIONS.reduce((sum, a) => {
    if (completed.has(a.id)) return sum + a.points;
    return sum;
  }, 0);

  const maxPoints = ENTRY_ACTIONS.reduce((sum, a) => sum + a.points, 0);

  const handleComplete = useCallback((action: EntryAction) => {
    if (action.oneTime && completed.has(action.id)) return;
    if (action.url) {
      window.open(action.url, '_blank', 'noopener,noreferrer');
    }
    saveCompletedAction(g.item, action.id);
    setCompleted(prev => new Set([...prev, action.id]));
    setJustCompleted(action.id);
    setTimeout(() => setJustCompleted(null), 1500);
  }, [completed, g.item]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    saveEntryName(g.item, nameInput.trim());
    setEntryName(nameInput.trim());
    setNameSubmitted(true);
  };

  const imgSrc = g.image
    ? (g.image.startsWith('http') ? g.image : `/${g.image}`)
    : null;

  return (
    <section className="mb-20">
      <div className="glass-strong rounded-3xl overflow-hidden">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 via-emerald-500/10 to-transparent" />
          <div className="relative px-8 py-6 flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 font-display font-bold text-lg tracking-wide uppercase">Live Giveaway</span>
          </div>
        </div>

        <div className="p-8 grid lg:grid-cols-2 gap-10">
          {/* Left: Prize info */}
          <div className="flex flex-col gap-6">
            {imgSrc && (
              <div className="rounded-2xl overflow-hidden">
                <img src={imgSrc} alt={g.item} className="w-full aspect-video object-contain bg-black/30" />
              </div>
            )}
            <div>
              <h2 className="font-display font-bold text-3xl mb-3">{g.item}</h2>
              {g.description && (
                <p className="text-gray-400 text-lg leading-relaxed">{g.description}</p>
              )}
            </div>

            {/* Entry name form */}
            {!nameSubmitted ? (
              <form onSubmit={handleNameSubmit} className="flex gap-3">
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  placeholder="Enter your Discord username to participate"
                  className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white
                             placeholder:text-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-green-500/20 text-green-400 font-semibold
                             border border-green-500/30 hover:bg-green-500/30 transition-all"
                >
                  Enter
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <Check className="w-5 h-5 text-green-400" />
                <span className="text-green-400 font-medium">Entered as <strong>{entryName}</strong></span>
                <button
                  onClick={() => { setNameSubmitted(false); setNameInput(entryName); }}
                  className="ml-auto text-gray-500 hover:text-gray-300 transition-colors text-sm"
                >
                  Change
                </button>
              </div>
            )}

            {/* Points summary */}
            <div className="glass rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-sm font-medium">Your bonus entries</span>
                <span className="text-green-400 font-display font-bold text-lg">{totalPoints} / {maxPoints}</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Right: Entry actions */}
          <div className="flex flex-col gap-3">
            <h3 className="font-display font-bold text-xl mb-2">Earn Bonus Entries</h3>
            <p className="text-gray-400 text-sm mb-4">
              Complete actions below to earn extra entries. More entries = better chance of winning!
            </p>

            <div className="flex flex-col gap-2">
              {ENTRY_ACTIONS.map(action => {
                const isDone = completed.has(action.id);
                const isJustDone = justCompleted === action.id;

                return (
                  <button
                    key={action.id}
                    onClick={() => handleComplete(action)}
                    disabled={action.oneTime && isDone}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left
                      ${isDone
                        ? 'glass border-green-500/20 opacity-70'
                        : 'glass border-white/5 hover:border-white/15 hover:-translate-y-0.5'
                      }
                      ${isJustDone ? 'scale-[1.02] border-green-500/40' : ''}
                    `}
                  >
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${isDone ? 'text-green-400' : action.color}`}>
                      {isDone ? <Check className="w-5 h-5" /> : action.icon}
                    </div>

                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-sm ${isDone ? 'text-green-400 line-through' : ''}`}>
                        {action.label}
                      </div>
                      <div className="text-gray-500 text-xs mt-0.5">{action.description}</div>
                    </div>

                    {/* Points badge */}
                    <div className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold
                      ${isDone ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-gray-400'}
                    `}>
                      +{action.points} {action.points === 1 ? 'entry' : 'entries'}
                    </div>

                    {/* External link indicator */}
                    {action.url && !isDone && (
                      <ExternalLink className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entry Modal (for entering from a card)
// ---------------------------------------------------------------------------

function EntryModal({ g, onClose }: { g: Giveaway; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[72rem] max-h-[90vh] overflow-y-auto rounded-3xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 glass p-2 rounded-xl text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <FeaturedGiveaway g={g} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Giveaways() {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [modalGiveaway, setModalGiveaway] = useState<Giveaway | null>(null);

  const allGiveaways = [...SITE_CONFIG.giveaways].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    const dateA = a.date ? new Date(a.date + 'T00:00:00').getTime() : 0;
    const dateB = b.date ? new Date(b.date + 'T00:00:00').getTime() : 0;
    return dateB - dateA;
  });

  const filtered = activeTab === 'all' ? allGiveaways : allGiveaways.filter(g => g.status === activeTab);
  const usedStatuses = new Set(allGiveaways.map(g => g.status));
  const visibleFilters = FILTERS.filter(f => f.key === 'all' || usedStatuses.has(f.key));
  const openGiveaways = allGiveaways.filter(g => g.status === 'open');

  const openCount = allGiveaways.filter(g => g.status === 'open').length;
  const upcomingCount = allGiveaways.filter(g => g.status === 'upcoming').length;
  const endedCount = allGiveaways.filter(g => g.status === 'ended').length;

  return (
    <PageLayout
      title="Giveaways | TrueBeast"
      description="TrueBeast giveaway winners, open giveaways, and upcoming prizes for the community."
      gradientVariant="gold"
    >
      <div className="px-6 pb-20">
        <div className="max-w-[72rem] mx-auto">

          {/* Hero */}
          <div className="text-center pt-12 mb-14 reveal">
            <span className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full mb-6 text-sm font-medium text-gray-300">
              <Award className="w-4 h-4 text-yellow-400" />
              Community Giveaways
            </span>
            <h1 className="font-display font-bold text-5xl md:text-6xl mb-4">
              Give<span className="text-gradient">aways</span>
            </h1>
            <p className="text-gray-400 text-lg max-w-[36rem] mx-auto">
              Prizes for the TrueBeast squad. Past winners, open giveaways, and what's coming next.
            </p>

            {/* Quick stats */}
            {allGiveaways.length > 0 && (
              <div className="flex items-center justify-center gap-6 mt-8 flex-wrap">
                {openCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
                    <span className="text-green-400 font-semibold">{openCount} open</span>
                  </div>
                )}
                {upcomingCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                    <span className="text-yellow-400 font-semibold">{upcomingCount} coming soon</span>
                  </div>
                )}
                {endedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
                    <span className="text-gray-400 font-semibold">{endedCount} ended</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Featured live giveaway(s) */}
          {openGiveaways.map((g, i) => (
            <FeaturedGiveaway key={`featured-${i}`} g={g} />
          ))}

          {/* Filters */}
          {visibleFilters.length > 1 && (
            <div className="flex flex-wrap gap-2 justify-center mb-10 reveal">
              {visibleFilters.map(f => {
                const isActive = activeTab === f.key;
                let activeStyle = '';
                if (isActive) {
                  switch (f.key) {
                    case 'open':     activeStyle = 'bg-green-500/15 text-green-400 border-green-500/30'; break;
                    case 'upcoming': activeStyle = 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'; break;
                    case 'ended':    activeStyle = 'bg-gray-500/15 text-gray-300 border-gray-500/30'; break;
                    default:         activeStyle = 'bg-white/10 text-white border-white/20'; break;
                  }
                }
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveTab(f.key)}
                    className={`glass border px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
                      ${isActive ? activeStyle : 'border-white/5 text-gray-400 hover:text-white hover:border-white/15'}
                    `}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Cards grid */}
          {filtered.length === 0 && allGiveaways.length === 0 ? (
            <div className="text-center py-24 reveal">
              <Gift className="w-16 h-16 text-gray-700 mx-auto mb-4" />
              <h2 className="font-display font-bold text-2xl mb-3 text-gray-300">No giveaways yet</h2>
              <p className="text-gray-500 max-w-[24rem] mx-auto">
                TrueBeast's first giveaway is coming. Join the Discord to be the first to know.
              </p>
              <a
                href={SITE_CONFIG.social.discord || 'https://discord.gg/Nk8vekY'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 glass px-6 py-3 rounded-xl mt-6 text-indigo-400 font-medium
                           hover:-translate-y-0.5 transition-all duration-200"
              >
                <DiscordIcon className="w-5 h-5" />
                Join Discord
              </a>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500 reveal">
              No giveaways in this category right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 reveal">
              {filtered.map((g, i) => (
                <GiveawayCard
                  key={i}
                  g={g}
                  onEnter={g.status === 'open' ? () => setModalGiveaway(g) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Entry modal */}
      {modalGiveaway && (
        <EntryModal g={modalGiveaway} onClose={() => setModalGiveaway(null)} />
      )}
    </PageLayout>
  );
}
