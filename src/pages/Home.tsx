import { useState, useEffect } from 'react';
import {
  Youtube,
  Gamepad2,
  Users,
  Heart,
  ExternalLink,
  Play,
  Calendar,
  Film,
  Mic,
  UserPlus,
  Headphones,
  MessageCircle,
  Wrench,
  Gift,
} from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import { SITE_CONFIG } from '@/config';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { GlassCard } from '@/components/shared/GlassCard';
import { DiscordIcon } from '@/components/shared/DiscordIcon';
import { FirebaseDB } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// SVG Icons (inline to avoid extra files)
// ---------------------------------------------------------------------------

const TwitterIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const InstagramIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const TikTokIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.22 8.22 0 0 0 4.76 1.51v-3.5a4.83 4.83 0 0 1-1-.01z" />
  </svg>
);

const TwitchIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewData {
  name: string;
  tag: string;
  text: string;
  color: string;
}

interface VideoCardProps {
  video: { id: string; title: string; category: string };
  portrait?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const FALLBACK_REVIEWS: ReviewData[] = [
  {
    name: 'CanlPetThatDawg',
    tag: '#N8U1',
    text: 'Love this server! Game nights are so much fun and the movie nights are perfect for chilling with everyone. Really friendly community, always a good time!',
    color: 'from-green-500 to-emerald-500',
  },
  {
    name: 'Iron Lady',
    tag: '#M4UO',
    text: '10/10 review for TB. Always get a good laugh when he streams a scary game and he screams like a girl when he gets a fright. Highly recommend his tech support, quality service and definitely a tenacious problem solver. Discord community is welcoming and supportive. Lovely bunch of coconuts.',
    color: 'from-pink-500 to-rose-500',
  },
  {
    name: "Ammar | Nuttin' hips",
    tag: '#MGW8',
    text: 'Great people, great community, and it\'s chill, u can get a free tech support also 10/10 the guy beast is a BEAST go check it there (no homo)',
    color: 'from-violet-500 to-purple-500',
  },
  {
    name: 'TrueBeast',
    tag: '#C7R4',
    text: 'Best server ever! (Definitely unbiased)',
    color: 'from-cyan-500 to-blue-500',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function VideoCard({ video, portrait = false, className = '', style }: VideoCardProps) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${video.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block h-full ${className}`}
      style={style}
      data-track={`video_${video.category.toLowerCase().replace(/\s+/g, '_')}`}
    >
      <div className="glass rounded-2xl overflow-hidden h-full flex flex-col transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:-translate-y-2 group-hover:scale-[1.02]">
        {/* Thumbnail */}
        <div className={`relative overflow-hidden ${portrait ? 'flex-1' : 'aspect-video'}`}>
          <img
            src={`https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`}
            alt={video.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            loading="lazy"
          />
          {/* Play overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 scale-75 group-hover:scale-100">
              <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />
            </div>
          </div>
          {/* Category badge */}
          <span className="absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs text-green-400 font-medium">
            {video.category}
          </span>
        </div>

        {/* Info */}
        <div className="p-4">
          <h3 className="text-white font-semibold text-sm group-hover:text-green-400 transition-colors line-clamp-2 mb-1">
            {video.title}
          </h3>
          <span className="text-gray-500 text-xs flex items-center gap-1">
            <Youtube className="w-3 h-3" />
            Watch on YouTube
          </span>
        </div>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Section: Hero
// ---------------------------------------------------------------------------

function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-6">
      {/* Floating decorative elements */}
      <div
        className="absolute top-20 left-[10%] w-20 h-20 rounded-2xl glass opacity-20 animate-float"
        style={{ animationDelay: '0s' }}
      />
      <div
        className="absolute top-40 right-[15%] w-14 h-14 rounded-xl glass opacity-15 animate-float"
        style={{ animationDelay: '2s' }}
      />
      <div
        className="absolute bottom-32 left-[20%] w-16 h-16 rounded-2xl glass opacity-10 animate-float"
        style={{ animationDelay: '4s' }}
      />
      <div
        className="absolute bottom-48 right-[10%] w-24 h-24 rounded-3xl glass opacity-10 animate-float"
        style={{ animationDelay: '1s' }}
      />

      <div className="relative z-10 max-w-[56rem] mx-auto text-center">
        {/* Badge */}
        <div className="reveal inline-flex items-center gap-2 glass rounded-full px-5 py-2.5 mb-8">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-sm text-gray-300 tracking-wide">Live. Game. Repeat.</span>
        </div>

        {/* Heading */}
        <h1 className="reveal font-display text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold text-gradient text-3d-hero leading-tight mb-6">
          TrueBeast
        </h1>

        {/* Subtitle */}
        <p className="reveal text-xl sm:text-2xl text-gray-300 mb-4 font-display">
          Hey, I'm Kiernen Irons
        </p>

        {/* Description */}
        <p className="reveal text-gray-400 text-lg max-w-[42rem] mx-auto mb-10 leading-relaxed">
          Gaming, community, and good vibes. I create content around the games I love,
          build tech I believe in, and bring people together who share the same energy.
        </p>

        {/* CTA Buttons */}
        <div className="reveal flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <a
            href={SITE_CONFIG.social.youtube ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-strong rounded-xl px-8 py-4 flex items-center gap-3 text-white font-semibold
                       transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(34,197,94,0.3)]
                       group"
            data-track="hero_watch_latest"
          >
            <Youtube className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform" />
            Watch Latest
          </a>
          <a
            href="https://discord.gg/Nk8vekY"
            target="_blank"
            rel="noopener noreferrer"
            className="glass rounded-xl px-8 py-4 flex items-center gap-3 text-white font-semibold
                       transition-all duration-300 hover:scale-105 group"
            data-track="hero_join_discord"
          >
            <DiscordIcon size={20} className="text-indigo-400 group-hover:scale-110 transition-transform" />
            Join Discord
          </a>
        </div>

        {/* Stats Grid */}
        <div className="reveal grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <Youtube className="w-6 h-6 text-red-500" />, label: 'YOUTUBE', value: '@RealTrueBeast' },
            { icon: <DiscordIcon size={24} className="text-indigo-400" />, label: 'DISCORD', value: 'Squad Up Here' },
            { icon: <Gamepad2 className="w-6 h-6 text-green-400" />, label: 'GAMING', value: 'Daily Content' },
            { icon: <Heart className="w-6 h-6 text-pink-400" />, label: 'COMMUNITY', value: 'Family Vibes' },
          ].map((stat) => (
            <div key={stat.label} className="glass glass-hover rounded-xl p-5 text-center">
              <div className="flex justify-center mb-3">{stat.icon}</div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className="text-white font-semibold text-sm">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: About
// ---------------------------------------------------------------------------

function AboutSection() {
  return (
    <section id="about" className="relative py-24 px-6">
      <div className="max-w-[72rem] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left - Photo */}
          <div className="reveal relative">
            <div className="glass-strong rounded-2xl overflow-hidden relative group">
              <img
                src="/assets/images/about-photo.jpg"
                alt="Kiernen Irons - TrueBeast"
                className="w-full aspect-[3/4] object-cover"
                loading="lazy"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              {/* Badge */}
              <div className="absolute bottom-4 left-4 glass rounded-full px-6 py-2 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                <span className="text-xs text-gray-300">Live &amp; Gaming</span>
              </div>
            </div>

            {/* Floating decorative elements */}
            <div
              className="absolute -top-4 -right-4 w-20 h-20 rounded-2xl glass opacity-20 animate-float"
              style={{ animationDelay: '1s' }}
            />
            <div
              className="absolute -bottom-4 -left-4 w-14 h-14 rounded-xl glass opacity-15 animate-float"
              style={{ animationDelay: '3s' }}
            />
          </div>

          {/* Right - Bio */}
          <div className="reveal">
            <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
              Who I Am
            </span>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient mb-8 leading-tight">
              The Story Behind TrueBeast
            </h2>

            <p className="text-gray-400 leading-relaxed mb-6">
              I'm Kiernen, but most people online know me as TrueBeast. I studied computer game
              programming and have worked in tech and hardware, which probably explains why I'm
              obsessed with how things work, how they look, and how they can be improved. This
              channel started because I wanted a space where I could share the games I enjoy,
              experiment with new tech, and build something of my own. The streams aren't scripted
              or forced, they're built around what I'm genuinely into at the time, whether that's
              horror games, co-op chaos with friends, or testing out new setups.
            </p>

            <p className="text-gray-400 leading-relaxed mb-8">
              TrueBeast has grown into more than just gameplay. It's a community of people who
              show up, hang out in Discord, jump into game nights, and actually care about being
              part of something consistent. I'm big on quality, on building things properly, and
              on creating an environment where people can relax and just enjoy being there. At the
              end of the day, this isn't about chasing trends. It's about building something real,
              improving over time, and bringing people along for the journey.
            </p>

            {/* Tags */}
            <div className="flex flex-wrap gap-3">
              {['Gaming', 'Community First', 'Real Talk', 'Good Vibes Only'].map((tag) => (
                <span
                  key={tag}
                  className="glass rounded-full px-6 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Content (Asymmetric Video Grid)
// ---------------------------------------------------------------------------

function ContentSection() {
  const [videos, setVideos] = useState(SITE_CONFIG.videos.slice(0, 4));

  useEffect(() => {
    const { apiKey, channelId, maxResults } = SITE_CONFIG.youtube;
    if (!apiKey || !channelId) return;

    // Check localStorage cache (1 hour TTL)
    const cacheKey = 'tb_yt_vids_v3';
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < 3600000 && Array.isArray(data) && data.length > 0) {
          setVideos(data);
          return;
        }
      } catch { /* */ }
    }

    // Fetch from YouTube Data API v3
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=${maxResults || 4}&order=date&type=video&key=${apiKey}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!data.items?.length) return;
        const fetched = data.items.map((item: any) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          category: 'Latest',
        }));
        setVideos(fetched);
        localStorage.setItem(cacheKey, JSON.stringify({ data: fetched, ts: Date.now() }));
      })
      .catch(() => { /* keep fallback */ });
  }, []);

  const latest = videos[0] ? { ...videos[0], category: 'Latest Video' } : undefined;
  const short = videos[1] ? { ...videos[1], category: 'Latest Short' } : undefined;
  const stream = videos[2] ? { ...videos[2], category: 'Latest Stream' } : undefined;
  const popular = videos[3] ? { ...videos[3], category: 'Most Viewed' } : undefined;

  return (
    <section id="content" className="relative py-24 px-6">
      <div className="max-w-[72rem] mx-auto">
        {/* Header */}
        <div className="reveal text-center mb-14">
          <span className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
            Content
          </span>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient mb-4">
            Latest Creations
          </h2>
          <p className="text-gray-400 max-w-[36rem] mx-auto">
            Catch the latest videos, from gameplay and collabs to deep dives and highlights.
          </p>
        </div>

        {/* Asymmetric Video Grid */}
        <div
          className="reveal grid gap-6"
          style={{
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateAreas: '"latest short" "stream short" "popular popular"',
          }}
        >
          {latest && (
            <VideoCard
              video={latest}
              style={{ gridArea: 'latest' }}
            />
          )}
          {short && (
            <VideoCard
              video={short}
              portrait
              style={{ gridArea: 'short' }}
            />
          )}
          {stream && (
            <VideoCard
              video={stream}
              style={{ gridArea: 'stream' }}
            />
          )}
          {popular && (
            <VideoCard
              video={popular}
              style={{ gridArea: 'popular' }}
            />
          )}
        </div>

        {/* View All */}
        <div className="reveal text-center mt-10">
          <a
            href={`${SITE_CONFIG.social.youtube ?? 'https://www.youtube.com/@RealTrueBeast'}/videos`}
            target="_blank"
            rel="noopener noreferrer"
            className="glass rounded-xl px-8 py-4 inline-flex items-center gap-3 text-white font-semibold
                       transition-all duration-300 hover:scale-105 group"
          >
            <Youtube className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform" />
            View All Videos
            <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Community (with floating reviews)
// ---------------------------------------------------------------------------

const REVIEW_COLORS = [
  'from-green-500 to-emerald-500',
  'from-pink-500 to-rose-500',
  'from-violet-500 to-purple-500',
  'from-cyan-500 to-blue-500',
  'from-orange-500 to-amber-500',
  'from-indigo-500 to-blue-500',
];

function CommunitySection() {
  const [liveReviews, setLiveReviews] = useState<ReviewData[]>([]);

  useEffect(() => {
    FirebaseDB.getAllReviews()
      .then((all: any[]) => {
        const approved = all
          .filter((r) => r.status === 'approved' && r.text)
          .slice(0, 6)
          .map((r, i) => ({
            name: r.name || 'Anonymous',
            tag: '',
            text: r.text,
            color: REVIEW_COLORS[i % REVIEW_COLORS.length],
          }));
        if (approved.length > 0) setLiveReviews(approved);
      })
      .catch(() => {});
  }, []);

  const displayReviews = liveReviews.length > 0 ? liveReviews : FALLBACK_REVIEWS;

  const features = [
    { icon: <Calendar className="w-5 h-5 text-green-400" />, text: 'Game nights every Friday - hop in and play' },
    { icon: <Film className="w-5 h-5 text-green-400" />, text: 'Movie nights every Saturday - grab the popcorn' },
    { icon: <Mic className="w-5 h-5 text-green-400" />, text: 'Voice chats that go way too late' },
    { icon: <UserPlus className="w-5 h-5 text-green-400" />, text: 'Meet friends who actually get you' },
  ];

  return (
    <section id="community" className="relative py-24 px-6">
      <div className="max-w-[72rem] mx-auto">
        <div className="reveal glass-strong glass-glow rounded-3xl p-8 sm:p-12 lg:p-16 relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-green-500/20 via-emerald-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 grid lg:grid-cols-2 gap-12 lg:gap-16">
            {/* Left side */}
            <div>
              <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
                Community
              </span>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight">
                Join the <span className="text-gradient">Discord</span>
              </h2>
              <p className="text-gray-400 leading-relaxed mb-8">
                This isn't just a Discord server, it's a family. We game together, hang out,
                support each other, and have a blast doing it. Come meet the squad and see
                what TrueBeast is really about.
              </p>

              {/* Feature items */}
              <div className="space-y-4 mb-8">
                {features.map((feature) => (
                  <div key={feature.text} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 glass rounded-lg flex items-center justify-center">
                      {feature.icon}
                    </div>
                    <span className="text-gray-300 text-sm">{feature.text}</span>
                  </div>
                ))}
              </div>

              {/* Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="https://discord.gg/Nk8vekY"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass-strong rounded-xl px-8 py-4 flex items-center justify-center gap-3 text-white font-semibold
                             transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(99,102,241,0.25)] group"
                >
                  <DiscordIcon size={20} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                  Join Discord
                </a>
                <a
                  href="/submit-review"
                  data-track="review_cta"
                  className="glass rounded-xl px-8 py-4 flex items-center justify-center gap-3 text-white font-semibold
                             transition-all duration-300 hover:scale-105 group"
                >
                  <MessageCircle className="w-5 h-5 text-green-400 group-hover:scale-110 transition-transform" />
                  Leave a Review
                </a>
              </div>
            </div>

            {/* Right side - Floating review cards (masonry-style, 2 columns) */}
            <div className="flex gap-2 pt-8">
              {[0, 1].map((col) => (
                <div key={col} className="flex-1 flex flex-col gap-3">
                  {displayReviews.filter((_, i) => i % 2 === col).map((review, j) => (
                    <div
                      key={review.name}
                      className="glass rounded-2xl p-4 animate-float"
                      style={{ animationDelay: `${(col * 2 + j) * 0.5}s` }}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${review.color} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                          {review.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-white text-sm font-semibold leading-tight">{review.name}</p>
                          <p className="text-gray-500 text-xs">{review.tag}</p>
                        </div>
                      </div>
                      <p className="text-gray-400 text-xs leading-relaxed">"{review.text}"</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Connect
// ---------------------------------------------------------------------------

interface SocialEntry {
  key: string;
  label: string;
  handle: string;
  url: string;
  icon: React.ReactNode;
  iconColor: string;
  bgGradient: string;
}

function ConnectSection() {
  const { social } = SITE_CONFIG;

  const socials: SocialEntry[] = [
    social.youtube
      ? { key: 'youtube', label: 'YouTube', handle: '@RealTrueBeast', url: social.youtube, icon: <Youtube className="w-7 h-7" />, iconColor: 'text-red-500', bgGradient: 'from-red-500/20 to-red-600/20' }
      : null,
    social.discord
      ? { key: 'discord', label: 'Discord', handle: 'discord.gg/Nk8vekY', url: social.discord, icon: <DiscordIcon size={28} />, iconColor: 'text-indigo-400', bgGradient: 'from-indigo-500/20 to-indigo-600/20' }
      : null,
    social.twitter
      ? { key: 'twitter', label: 'Twitter / X', handle: '@TrueBeast_YT', url: social.twitter, icon: <TwitterIcon size={28} />, iconColor: 'text-sky-400', bgGradient: 'from-sky-500/20 to-sky-600/20' }
      : null,
    social.instagram
      ? { key: 'instagram', label: 'Instagram', handle: '@kiernen_100', url: social.instagram, icon: <InstagramIcon size={28} />, iconColor: 'text-pink-400', bgGradient: 'from-pink-500/20 to-pink-600/20' }
      : null,
    social.tiktok
      ? { key: 'tiktok', label: 'TikTok', handle: '@realtruebeast', url: social.tiktok, icon: <TikTokIcon size={28} />, iconColor: 'text-cyan-400', bgGradient: 'from-cyan-500/20 to-cyan-600/20' }
      : null,
    social.twitch
      ? { key: 'twitch', label: 'Twitch', handle: 'realtruebeast', url: social.twitch, icon: <TwitchIcon size={28} />, iconColor: 'text-purple-400', bgGradient: 'from-purple-500/20 to-purple-600/20' }
      : null,
  ].filter(Boolean) as SocialEntry[];

  return (
    <section id="connect" className="relative py-24 px-6">
      <div className="max-w-[64rem] mx-auto">
        {/* Header */}
        <div className="reveal text-center mb-14">
          <span className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3 block">
            Connect
          </span>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-gradient mb-4">
            Let's Link Up
          </h2>
          <p className="text-gray-400 max-w-[36rem] mx-auto">
            Follow along on your platform of choice. New content drops regularly.
          </p>
        </div>

        {/* Social Grid */}
        <div className="reveal grid grid-cols-2 sm:grid-cols-3 gap-4">
          {socials.map((s) => (
            <a
              key={s.key}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group"
              data-track={`social_${s.key}`}
            >
              <div className="glass glass-hover rounded-xl p-6 flex flex-col items-center text-center transition-all duration-300 group-hover:border-white/15">
                {/* Colored icon area */}
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${s.bgGradient} flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110`}>
                  <div className={`${s.iconColor} transition-colors duration-300`}>
                    {s.icon}
                  </div>
                </div>
                <p className="text-white font-semibold text-sm mb-1">{s.label}</p>
                <p className="text-gray-500 text-xs flex items-center gap-1">
                  {s.handle}
                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </p>
              </div>
            </a>
          ))}
        </div>

        {/* Bottom buttons */}
        <div className="reveal flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
          <a
            href="/tech-support"
            className="glass rounded-xl px-8 py-4 flex items-center gap-3 text-white font-semibold
                       transition-all duration-300 hover:scale-105 group"
            data-track="tech_support_cta"
          >
            <Wrench className="w-5 h-5 text-green-400 group-hover:scale-110 transition-transform" />
            Need Tech Help? Submit a Ticket
          </a>
          {SITE_CONFIG.donationUrl && (
            <a
              href={SITE_CONFIG.donationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glass rounded-xl px-8 py-4 flex items-center gap-3 text-yellow-400 font-semibold
                         transition-all duration-300 hover:scale-105 group"
              data-track="donation_link"
            >
              <Gift className="w-5 h-5 text-yellow-400 group-hover:scale-110 transition-transform" />
              Support the Channel
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Latest Announcement
// ---------------------------------------------------------------------------

// Simple Discord markdown + mention renderer for homepage
function renderAnnouncementMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Custom emoji
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_m, animated, name, id) => {
      const ext = animated ? 'gif' : 'png';
      return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=24" alt=":${name}:" title=":${name}:" class="inline-block w-5 h-5 align-text-bottom" />`;
    })
    // Strip role/user mentions (show as styled text)
    .replace(/&lt;@[!&]?\d+&gt;/g, '')
    // Channel mentions
    .replace(/&lt;#\d+&gt;/g, '')
    // Bold italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Underline
    .replace(/__(.+?)__/g, '<u>$1</u>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1 rounded text-xs">$1</code>')
    // Spoiler
    .replace(/\|\|(.+?)\|\|/g, '<span class="bg-gray-600 text-gray-600 hover:text-gray-200 rounded px-0.5 cursor-pointer transition-colors">$1</span>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<div class="border-l-2 border-gray-500 pl-2 text-gray-400">$1</div>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<div class="flex gap-1.5"><span class="text-gray-500">•</span><span>$1</span></div>')
    // Newlines
    .replace(/\n/g, '<br>');
}

function LatestAnnouncementSection() {
  const [announcement, setAnnouncement] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    FirebaseDB.getLatestAnnouncement()
      .then((a) => { if (!cancelled) { setAnnouncement(a); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || !announcement) return null;

  const embed = announcement.embeds?.[0];
  const color = embed?.color
    ? '#' + ('000000' + embed.color.toString(16)).slice(-6)
    : '#5865F2';

  const timeAgo = (() => {
    const d = new Date(announcement.createdAt);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
  })();

  // Parse content — strip role mentions that are just noise on the homepage
  const contentHtml = announcement.content ? renderAnnouncementMarkdown(announcement.content) : null;
  const descHtml = embed?.description ? renderAnnouncementMarkdown(embed.description) : null;

  return (
    <section className="relative py-24 px-6">
      <div className="max-w-[72rem] mx-auto">
        {/* Header */}
        <div className="reveal flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-green-400 text-sm font-semibold uppercase tracking-widest">
              Latest Announcement
            </span>
          </div>
          <span className="text-gray-500 text-sm">{timeAgo}</span>
        </div>

        {/* Card */}
        <div
          className="reveal glass-strong rounded-2xl p-6"
          style={{ borderLeft: `4px solid ${color}` }}
        >
          {/* Content text above embed */}
          {contentHtml && (
            <div className="text-gray-300 mb-4 leading-relaxed" dangerouslySetInnerHTML={{ __html: contentHtml }} />
          )}

          {/* Embed block */}
          {embed && (
            <div className="bg-black/25 rounded-lg p-4">
              {embed.title && (
                <h3 className="text-white font-bold text-lg mb-2">{embed.title}</h3>
              )}
              {descHtml && (
                <div className="text-gray-400 leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: descHtml }} />
              )}
              {embed.image?.url && (
                <img
                  src={embed.image.url}
                  alt={embed.title || 'Announcement image'}
                  className="w-full rounded-lg mt-2"
                  loading="lazy"
                />
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5">
            <span className="text-gray-500 text-xs">
              {embed?.footer?.text || new Date(announcement.createdAt).toLocaleDateString()}
            </span>
            <a
              href="https://discord.gg/Nk8vekY"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors"
            >
              Join the server to see more
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Home Page
// ---------------------------------------------------------------------------

export default function Home() {
  useScrollReveal();

  return (
    <PageLayout title="TrueBeast | Kiernen Irons" description="Gaming, community, and good vibes. TrueBeast by Kiernen Irons.">
      <HeroSection />
      <AboutSection />
      <LatestAnnouncementSection />
      <ContentSection />
      <CommunitySection />
      <ConnectSection />
    </PageLayout>
  );
}
