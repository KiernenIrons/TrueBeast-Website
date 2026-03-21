import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wrench,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  QrCode,
  Radio,
  Grid3X3,
  FileText,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG } from '@/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_TOOLS = [
  {
    id: 'multichat',
    name: 'MultiChat',
    description: 'Combine Twitch, Kick, and YouTube chat into one OBS overlay or dock.',
    icon: MessageSquare,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    to: '/tools/multichat',
    tag: 'OBS Overlay',
  },
  {
    id: 'socials-rotator',
    name: 'Socials Rotator',
    description: 'Animated OBS overlay that cycles through your social media handles.',
    icon: RefreshCw,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/20',
    to: '/tools/socials-rotator',
    tag: 'OBS Overlay',
  },
  {
    id: 'qr-generator',
    name: 'QR Generator',
    description: 'Create fully customized QR codes with your own colors, shapes, and logo.',
    icon: QrCode,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    to: '/tools/qr-generator',
    tag: 'Design',
  },
  {
    id: 'ripple',
    name: 'Ripple',
    description: 'Write once, post everywhere - Discord, Telegram, and Bluesky at once.',
    icon: Radio,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
    to: '/tools/ripple',
    tag: 'Broadcasting',
  },
  {
    id: 'buttonboard',
    name: 'ButtonBoard',
    description: 'Build a customizable stream control panel with hotkey-triggered actions.',
    icon: Grid3X3,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    to: '/tools/buttonboard',
    tag: 'Streaming',
  },
  {
    id: 'resume-builder',
    name: 'Resume Builder',
    description: 'Build a polished resume in minutes and export it as a PDF. Free forever.',
    icon: FileText,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    to: '/tools/resume-builder',
    tag: 'Productivity',
  },
];

const CATEGORY_FILTERS = ['All', 'Gaming', 'Streaming', 'PC & Hardware', 'Utilities', 'Creative'];

const CATEGORY_EMOJI: Record<string, string> = {
  Gaming: '🎮',
  Streaming: '🎥',
  'PC & Hardware': '🖥️',
  Utilities: '🛠️',
  Creative: '🎨',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Tools() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filteredTools = SITE_CONFIG.tools.filter(
    (t) => activeFilter === 'All' || t.category === activeFilter,
  );

  return (
    <PageLayout title="Tools | TrueBeast" gradientVariant="purple">
      <section className="py-20 sm:py-28">
        <div className="max-w-[72rem] mx-auto px-4 sm:px-6">

          {/* Hero */}
          <div className="text-center mb-16 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <Wrench size={16} className="text-purple-400" />
              <span className="text-sm text-gray-300 font-medium">Free Tools</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              The <span className="text-gradient">Toolkit</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Tools built and curated by Kiernen. All free, no account required.
            </p>
          </div>

          {/* Built by Kiernen */}
          <div className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-xs font-bold tracking-widest text-purple-400 uppercase">
                Built by Kiernen
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {BUILT_TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <Link
                    key={tool.id}
                    to={tool.to}
                    className="glass glass-hover rounded-2xl p-6 flex flex-col gap-4 border border-white/5 group"
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className={`w-11 h-11 rounded-xl ${tool.bg} border ${tool.border} flex items-center justify-center`}
                      >
                        <Icon size={20} className={tool.color} />
                      </div>
                      <span
                        className={`text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full ${tool.bg} ${tool.color} uppercase`}
                      >
                        {tool.tag}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-white font-semibold text-lg mb-1">{tool.name}</h3>
                      <p className="text-gray-400 text-sm leading-relaxed">{tool.description}</p>
                    </div>

                    <div
                      className={`inline-flex items-center gap-2 text-sm font-medium mt-auto ${tool.color} group-hover:gap-3 transition-all`}
                    >
                      Open Tool
                      <ArrowRight size={14} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Recommended by TrueBeast */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-xs font-bold tracking-widest text-green-400 uppercase">
                Recommended by TrueBeast
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>

            {/* Category filter */}
            <div className="flex flex-wrap gap-2 mb-8">
              {CATEGORY_FILTERS.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    activeFilter === cat
                      ? 'glass-strong text-green-400'
                      : 'glass text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {cat !== 'All' && CATEGORY_EMOJI[cat] ? `${CATEGORY_EMOJI[cat]} ` : ''}
                  {cat}
                </button>
              ))}
            </div>

            {filteredTools.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center text-gray-500 text-sm">
                No tools in this category yet.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTools.map((tool, i) => (
                  <a
                    key={i}
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass glass-hover rounded-2xl p-6 flex flex-col gap-4 border border-white/5 group"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-3xl">{tool.emoji}</span>
                      <span className="text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 uppercase">
                        {tool.category}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-white font-semibold text-lg mb-1">{tool.name}</h3>
                      <p className="text-gray-400 text-sm leading-relaxed">{tool.description}</p>
                    </div>

                    <div className="inline-flex items-center gap-2 text-sm font-medium mt-auto text-green-400 group-hover:gap-3 transition-all">
                      Visit Site
                      <ExternalLink size={14} />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
