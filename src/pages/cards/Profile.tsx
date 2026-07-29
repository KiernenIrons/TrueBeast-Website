/* ============================================================
   Trading Card Game — Collector Profile
   Public page for one viewer's collection, keyed by their stable
   Twitch login (no site account needed to view or be viewed).
   ============================================================ */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';
import CardFace from '@/cards/CardFace';
import { getUserCollectionByLogin } from '@/cards/db';
import { CARDS_CONFIG } from '@/cards/config';
import type { UserCollection } from '@/cards/types';

export default function CardsProfile() {
  const { login } = useParams<{ login: string }>();
  const [collection, setCollection] = useState<UserCollection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    setLoading(true);
    getUserCollectionByLogin(login).then((data) => {
      if (!cancelled) {
        setCollection(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [login]);

  const owned = collection?.cards ?? {};
  const allCards = CARDS_CONFIG.activeCardSet.cards;
  const uniqueOwned = Object.keys(owned).filter((id) => owned[id] > 0).length;

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

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : !collection ? (
          <GlassCard className="rounded-2xl p-10 text-center text-gray-400">
            No collection found for "{login}" yet — packs opened live on stream show up here instantly.
          </GlassCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 justify-items-center">
            {allCards.map((card) => {
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
