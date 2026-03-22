import { Link } from 'react-router-dom';
import PageLayout from '@/components/layout/PageLayout';

const GAMES = [
  {
    id: 'clout-clicker',
    name: 'Clout Clicker',
    emoji: '🎮',
    description: 'Build your content empire from nothing. Click to earn Clout, buy buildings, unlock upgrades, prestige for Viral Chips, and compete on the global leaderboard.',
    url: '/games/clout-clicker',
    gradient: 'from-green-600 via-emerald-500 to-green-400',
    bgGlow: 'rgba(34,197,94,0.15)',
    tags: ['Idle', 'Clicker', 'Leaderboard', 'Prestige'],
    features: ['15 Buildings', '180+ Upgrades', '300+ Achievements', 'Global Leaderboard'],
  },
];

export default function Games() {
  return (
    <PageLayout gradientVariant="green" title="Games | TrueBeast">
      <div className="max-w-6xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
            Arcade
          </span>
          <h1 className="font-display text-5xl sm:text-6xl font-bold text-gradient mb-4">
            Games
          </h1>
          <p className="text-gray-400 max-w-lg mx-auto text-lg">
            Play games built by TrueBeast. Right in your browser.
          </p>
        </div>

        {/* Game Panels */}
        <div className="grid gap-8">
          {GAMES.map((game) => (
            <Link key={game.id} to={game.url} className="group block">
              <div
                className="glass-strong rounded-3xl overflow-hidden transition-all duration-500 group-hover:-translate-y-2 group-hover:shadow-[0_20px_60px_rgba(34,197,94,0.15)]"
              >
                {/* Top gradient banner */}
                <div className={`h-48 sm:h-56 bg-gradient-to-br ${game.gradient} relative overflow-hidden`}>
                  {/* Large emoji */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[120px] sm:text-[160px] opacity-20 group-hover:opacity-30 group-hover:scale-110 transition-all duration-500">
                      {game.emoji}
                    </span>
                  </div>
                  {/* Floating decorations */}
                  <div className="absolute top-6 left-6 w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm animate-float" style={{ animationDelay: '0s' }} />
                  <div className="absolute bottom-8 right-12 w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm animate-float" style={{ animationDelay: '1.5s' }} />
                  <div className="absolute top-12 right-8 w-8 h-8 rounded-lg bg-white/10 backdrop-blur-sm animate-float" style={{ animationDelay: '3s' }} />
                  {/* Play button overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/20">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-8 sm:p-10">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-2xl sm:text-3xl font-bold font-display text-white group-hover:text-green-400 transition-colors">
                        {game.name}
                      </h2>
                      <div className="flex gap-2 mt-2">
                        {game.tags.map((tag) => (
                          <span key={tag} className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>

                  <p className="text-gray-400 leading-relaxed mb-6">
                    {game.description}
                  </p>

                  {/* Feature pills */}
                  <div className="flex flex-wrap gap-3">
                    {game.features.map((f) => (
                      <div key={f} className="flex items-center gap-2 glass rounded-xl px-4 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span className="text-sm text-gray-300">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
