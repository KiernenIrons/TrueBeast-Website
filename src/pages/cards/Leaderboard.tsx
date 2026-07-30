/* ============================================================
   Trading Card Game — Leaderboard / Library landing
   Public: shows every collector, sortable by cards owned or
   collection value, or filterable to "who owns this card / any
   card of this rarity". Click a row to view that person's full
   collection (src/pages/cards/Profile.tsx).
   ============================================================ */

import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';
import { getLeaderboard, getAllCollections, getCardCatalog, type LeaderboardSort } from '@/cards/db';
import { isCardsFirebaseConfigured, RARITIES } from '@/cards/config';
import type { UserCollection, CardDef } from '@/cards/types';

type OwnerRow = { twitchUserId: string; twitchUserLogin: string; twitchUserDisplayName: string; count: number };

export default function CardsLeaderboard() {
  const [sortBy, setSortBy] = useState<LeaderboardSort>('totalValue');
  const [entries, setEntries] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [cards, setCards] = useState<CardDef[]>([]);
  const [filterValue, setFilterValue] = useState('');
  const [ownerRows, setOwnerRows] = useState<OwnerRow[] | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);

  useEffect(() => {
    getCardCatalog().then(setCards).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(sortBy, 50).then((data) => {
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sortBy]);

  useEffect(() => {
    if (!filterValue) { setOwnerRows(null); return; }
    let cancelled = false;
    setFilterLoading(true);
    getAllCollections().then((collections) => {
      if (cancelled) return;
      let rows: OwnerRow[];
      if (filterValue.startsWith('rarity:')) {
        const rarityId = filterValue.slice('rarity:'.length);
        const idsInTier = new Set(cards.filter((c) => c.rarity === rarityId).map((c) => c.id));
        rows = collections.map((col) => ({
          twitchUserId: col.twitchUserId,
          twitchUserLogin: col.twitchUserLogin,
          twitchUserDisplayName: col.twitchUserDisplayName,
          count: Object.entries(col.cards || {}).reduce((sum, [id, n]) => sum + (idsInTier.has(id) ? n : 0), 0),
        }));
      } else {
        const cardId = filterValue.slice('card:'.length);
        rows = collections.map((col) => ({
          twitchUserId: col.twitchUserId,
          twitchUserLogin: col.twitchUserLogin,
          twitchUserDisplayName: col.twitchUserDisplayName,
          count: col.cards?.[cardId] || 0,
        }));
      }
      setOwnerRows(rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count));
      setFilterLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filterValue, cards]);

  const filterLabel = useMemo(() => {
    if (!filterValue) return null;
    if (filterValue.startsWith('rarity:')) {
      const rarityId = filterValue.slice('rarity:'.length);
      return `${RARITIES.find((r) => r.id === rarityId)?.name ?? rarityId} owners`;
    }
    const cardId = filterValue.slice('card:'.length);
    return `"${cards.find((c) => c.id === cardId)?.name ?? cardId}" owners`;
  }, [filterValue, cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = ownerRows ?? entries;
    if (!q) return rows;
    return rows.filter((e) => (e.twitchUserDisplayName || e.twitchUserLogin).toLowerCase().includes(q));
  }, [entries, ownerRows, search]);

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

        <div className="flex flex-col sm:flex-row gap-4 mb-4 items-stretch sm:items-center justify-between">
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
                disabled={!!ownerRows}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 ${
                  sortBy === key && !ownerRows
                    ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                    : 'glass text-gray-400 hover:text-white'
                }`}
              >
                {key === 'totalValue' ? 'Most Valuable' : 'Most Cards'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-8">
          <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
            className="glass rounded-xl px-4 py-2.5 text-sm text-white bg-transparent outline-none focus:ring-2 focus:ring-green-500/40 flex-1 min-w-[220px]">
            <option value="" className="bg-[#0b0b12]">Or find who owns...</option>
            <optgroup label="A rarity tier" className="bg-[#0b0b12]">
              {RARITIES.map((r) => <option key={r.id} value={`rarity:${r.id}`} className="bg-[#0b0b12]">Any {r.name} card</option>)}
            </optgroup>
            <optgroup label="A specific card" className="bg-[#0b0b12]">
              {cards.filter((c) => c.active !== false).map((c) => (
                <option key={c.id} value={`card:${c.id}`} className="bg-[#0b0b12]">{c.name}</option>
              ))}
            </optgroup>
          </select>
          {ownerRows && (
            <button onClick={() => setFilterValue('')}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-white transition-colors">
              Clear filter
            </button>
          )}
        </div>

        {!isCardsFirebaseConfigured() && (
          <GlassCard className="rounded-2xl p-6 mb-8 text-amber-300 text-sm">
            The card game database isn't configured yet — see CARDS_SETUP.md. This page will populate
            automatically once Firebase is set up and the first packs are redeemed.
          </GlassCard>
        )}

        <GlassCard strong className="rounded-3xl overflow-hidden">
          {filterLabel && (
            <div className="px-6 py-3 border-b border-white/10 text-xs font-semibold uppercase tracking-wide text-green-400">
              {filterLabel}
            </div>
          )}
          {(loading && !ownerRows) || filterLoading ? (
            <div className="p-10 text-center text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              {ownerRows ? 'Nobody owns this yet.' : 'No collectors yet — be the first to open a pack!'}
            </div>
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
                      {ownerRows ? (entry as OwnerRow).count : sortBy === 'totalValue' ? (entry as UserCollection).totalValue : (entry as UserCollection).totalCards}
                    </div>
                    <div className="text-xs text-gray-500">
                      {ownerRows ? 'owned' : sortBy === 'totalValue' ? 'value' : 'cards'}
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
