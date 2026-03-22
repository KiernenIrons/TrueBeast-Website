import { Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';
import { GlassCard } from '@/components/shared/GlassCard';

const GAMES = [
  {
    id: 'clout-clicker',
    name: 'Clout Clicker',
    emoji: '🎮',
    description: 'An idle clicker game where you build your content empire, earn Clout, prestige for Viral Chips, and compete on the global leaderboard.',
    url: '/games/clout-clicker',
    color: 'from-green-500 to-emerald-600',
    tags: ['Idle', 'Clicker', 'Leaderboard'],
  },
];

export default function Games() {
  return (
    <PageLayout gradientVariant="green" title="Games | TrueBeast">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
            Games
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-gradient mb-4">
            Play Something
          </h1>
          <p className="text-gray-400 max-w-lg mx-auto">
            Games built by TrueBeast. Play in your browser, compete on leaderboards, and have fun.
          </p>
        </div>

        <div className="grid gap-6">
          {GAMES.map((game) => (
            <Link key={game.id} to={game.url} className="group">
              <GlassCard hover className="p-6 sm:p-8 flex items-center gap-6 transition-all duration-300 group-hover:-translate-y-1">
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${game.color} flex items-center justify-center text-4xl flex-shrink-0 group-hover:scale-110 transition-transform`}>
                  {game.emoji}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold font-display text-white group-hover:text-green-400 transition-colors">
                    {game.name}
                  </h2>
                  <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                    {game.description}
                  </p>
                  <div className="flex gap-2 mt-3">
                    {game.tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
