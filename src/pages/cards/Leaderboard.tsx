/* ============================================================
   Trading Card Game — Leaderboard / Library landing
   Public: shows every collector, sortable by cards owned or
   collection value. Click a row to view that person's full
   collection (src/pages/cards/Profile.tsx).
   ============================================================ */

import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';
import { getLeaderboard, type LeaderboardSort } from '@/cards/db';
import { isCardsFirebaseConfigured } from '@/cards/config';
import type { UserCollection } from '@/cards/types';

export default function CardsLeaderboard() {
  const [sortBy, setSortBy] = useState<LeaderboardSort>('totalValue');
  const [entries, setEntries] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(sortBy, 100).then((data) => {
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sortBy]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => (e.twitchUserDisplayName || e.twitchUserLogin).toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <PageLayout gradientVariant="green" title="Card Leaderboard | TrueBeast">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
            Trading Cards
          </span>
          <h1 className="font-display text-5xl sm:text-6xl font-bold text-gradient mb-4">Leaderboard</h1>
          <p className="text-gray-400 max-w-lg mx-auto text-lg">
            Redeem "Open a Card Pack" with channel points live on stream to start your collection.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8 items-stretch sm:items-center justify-between">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a name..."
            className="glass rounded-xl px-4 py-2.5 text-white placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-green-500/40 w-full sm:w-64"
          />
          <div className="flex gap-2">
            {(['totalValue', 'totalCards'] as LeaderboardSort[]).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  sortBy === key
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                    : 'glass text-gray-400 hover:text-white'
                }`}
              >
                {key === 'totalValue' ? 'Most Valuable' : 'Most Cards'}
              </button>
            ))}
          </div>
        </div>

        {!isCardsFirebaseConfigured() && (
          <GlassCard className="rounded-2xl p-6 mb-8 text-amber-300 text-sm">
            The card game database isn't configured yet — see CARDS_SETUP.md. This page will populate
            automatically once Firebase is set up and the first packs are redeemed.
          </GlassCard>
        )}

        <GlassCard strong className="rounded-3xl overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-400">No collectors yet — be the first to open a pack!</div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((entry, i) => (
                <Link
                  key={entry.twitchUserId}
                  to={`/cards/u/${entry.twitchUserLogin}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-white/5 transition-colors group"
                >
                  <div className="w-8 text-center font-bold text-gray-500 group-hover:text-green-400">
                    {i + 1}
                  </div>
                  <div className="flex-1 font-semibold text-white group-hover:text-green-400 transition-colors">
                    {entry.twitchUserDisplayName || entry.twitchUserLogin}
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold">
                      {sortBy === 'totalValue' ? entry.totalValue : entry.totalCards}
                    </div>
                    <div className="text-xs text-gray-500">
                      {sortBy === 'totalValue' ? 'value' : 'cards'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </PageLayout>
  );
}
