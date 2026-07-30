/* ============================================================
   Trading Card Game — Collector Profile
   Public page for one viewer's collection, keyed by their stable
   Twitch login (no site account needed to view or be viewed).
   ============================================================ */

import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';
import CardFace from '@/cards/CardFace';
import { getUserCollectionByLogin, getCardCatalog } from '@/cards/db';
import { RARITIES } from '@/cards/config';
import type { UserCollection, CardDef, RarityId } from '@/cards/types';

export default function CardsProfile() {
  const { login } = useParams<{ login: string }>();
  const [collection, setCollection] = useState<UserCollection | null>(null);
  const [allCards, setAllCards] = useState<CardDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState<RarityId | ''>('');
  const [ownedOnly, setOwnedOnly] = useState(false);

  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getUserCollectionByLogin(login), getCardCatalog()]).then(([data, catalog]) => {
      if (!cancelled) {
        setCollection(data);
        setAllCards(catalog);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [login]);

  const owned = collection?.cards ?? {};
  const uniqueOwned = Object.keys(owned).filter((id) => owned[id] > 0).length;

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCards.filter((card) => {
      if (rarityFilter && card.rarity !== rarityFilter) return false;
      if (ownedOnly && !(owned[card.id] > 0)) return false;
      if (q && !card.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allCards, rarityFilter, ownedOnly, search, owned]);

  return (
    <PageLayout gradientVariant="green" title={`${login} | Card Collection | TrueBeast`}>
      <div className="max-w-6xl mx-auto px-6 py-16">
        <Link to="/cards" className="text-green-400 text-sm font-semibold hover:underline mb-6 inline-block">
          ← Back to leaderboard
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div>
            <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-2 block">
              Collector
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-gradient">
              {collection?.twitchUserDisplayName || login}
            </h1>
          </div>
          <div className="flex gap-4">
            <GlassCard className="rounded-2xl px-6 py-3 text-center">
              <div className="text-2xl font-bold text-white">{uniqueOwned}/{allCards.length}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Unique Cards</div>
            </GlassCard>
            <GlassCard className="rounded-2xl px-6 py-3 text-center">
              <div className="text-2xl font-bold text-white">{collection?.totalCards ?? 0}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Total Cards</div>
            </GlassCard>
            <GlassCard className="rounded-2xl px-6 py-3 text-center">
              <div className="text-2xl font-bold text-white">{collection?.totalValue ?? 0}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Value</div>
            </GlassCard>
          </div>
        </div>

        {!loading && collection && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a card name..."
              className="glass rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-green-500/40 w-full sm:w-56"
            />
            <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value as RarityId | '')}
              className="glass rounded-xl px-4 py-2.5 text-sm text-white bg-transparent outline-none focus:ring-2 focus:ring-green-500/40">
              <option value="" className="bg-[#0b0b12]">All rarities</option>
              {RARITIES.map((r) => <option key={r.id} value={r.id} className="bg-[#0b0b12]">{r.name}</option>)}
            </select>
            <button
              onClick={() => setOwnedOnly((v) => !v)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                ownedOnly ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'glass text-gray-400 hover:text-white'
              }`}
            >
              Owned only
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : !collection ? (
          <GlassCard className="rounded-2xl p-10 text-center text-gray-400">
            No collection found for "{login}" yet — packs opened live on stream show up here instantly.
          </GlassCard>
        ) : visibleCards.length === 0 ? (
          <GlassCard className="rounded-2xl p-10 text-center text-gray-400">
            No cards match this filter.
          </GlassCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 justify-items-center">
            {visibleCards.map((card) => {
              const count = owned[card.id] ?? 0;
              return (
                <div key={card.id} style={{ opacity: count > 0 ? 1 : 0.25, filter: count > 0 ? 'none' : 'grayscale(1)' }}>
                  <CardFace card={card} count={count} size="sm" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
