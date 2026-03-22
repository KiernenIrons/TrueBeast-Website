/* ============================================================
   Clout Clicker — Full Game UI
   A dark-themed idle/clicker game with glass-morphism design.
   ============================================================ */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { GameEngine } from '@/games/clout-clicker/engine';
import { GameSaves } from '@/games/clout-clicker/saves';
import {
  BUILDINGS,
  UPGRADES,
  ACHIEVEMENTS,
  formatNumber,
  formatTime,
  getBuildingCost,
  getMaxAffordable,
} from '@/games/clout-clicker/data';
import type {
  BuyMode,
  LeaderboardEntry,
  SerializedState,
  GoldenEffect,
} from '@/games/clout-clicker/types';
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { getFirebaseApp } from '@/lib/firebase';
import { GameSound } from '@/games/clout-clicker/sound';

// ---------------------------------------------------------------------------
// CSS Keyframes (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = 'clout-clicker-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Background: dotted grid + green gradients */
    .cc-game-bg {
      background-color: #0a0a0f;
      background-image:
        radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 80% 80%, rgba(16,185,129,0.05) 0%, transparent 50%),
        radial-gradient(ellipse at 20% 100%, rgba(5,150,105,0.04) 0%, transparent 40%),
        radial-gradient(circle, rgba(34,197,94,0.12) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 100% 100%, 24px 24px;
    }
    @keyframes ccFloatUp {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(-60px) scale(1.2); }
    }
    @keyframes ccGoldenBob {
      0%, 100% { transform: translateY(0px) rotate(-5deg); }
      50%      { transform: translateY(-12px) rotate(5deg); }
    }
    @keyframes ccPulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.05); }
    }
    @keyframes ccShine {
      from { background-position: -200% center; }
      to   { background-position: 200% center; }
    }
    .cc-float-anim {
      animation: ccFloatUp 0.8s ease-out forwards;
      pointer-events: none;
    }
    .cc-golden-bob {
      animation: ccGoldenBob 2s ease-in-out infinite;
    }
    @keyframes cc-orbit {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes cc-pulse {
      0%, 100% { opacity: 0.6; transform: scale(0.8); }
      50%      { opacity: 1; transform: scale(1.1); }
    }
    /* Leaderboard sparkles */
    @keyframes ccSparkle {
      0%   { opacity: 0; transform: scale(0) translateY(0); }
      50%  { opacity: 1; transform: scale(1) translateY(-8px); }
      100% { opacity: 0; transform: scale(0.5) translateY(-16px); }
    }
    .cc-lb-sparkle {
      position: absolute;
      pointer-events: none;
      animation: ccSparkle var(--dur, 1.5s) ease-out infinite;
      animation-delay: var(--delay, 0s);
      font-size: 12px;
    }
    .cc-pulse {
      animation: ccPulse 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

type ModalType =
  | 'auth'
  | 'leaderboard'
  | 'prestige'
  | 'offline'
  | 'io'
  | 'achievement'
  | null;
type MobileTab = 'store' | 'click' | 'stats';
type StoreTab = 'buildings' | 'upgrades';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/* ── Modal Shell ─────────────────────────────────────────── */

function ModalShell({
  children,
  onClose,
  title,
  width = 'max-w-lg',
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`glass-strong w-full ${width} rounded-2xl p-6 text-white relative max-h-[90vh] overflow-y-auto`}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white text-xl leading-none"
        >
          &times;
        </button>
        <h2 className="font-display text-xl font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ── Auth Modal ──────────────────────────────────────────── */

function AuthModal({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        const app = getFirebaseApp();
        if (!app) throw new Error('Firebase not configured');
        const auth = getAuth(app);
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
      }
      onSignedIn();
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Authentication failed';
      setError(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, ''));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={mode === 'login' ? 'Sign In' : 'Create Account'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'signup' && (
          <div>
            <label className="block text-sm text-white/60 mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-green-400/50"
              placeholder="GamerTag"
            />
          </div>
        )}
        <div>
          <label className="block text-sm text-white/60 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-green-400/50"
            placeholder="you@email.com"
          />
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-green-400/50"
            placeholder={mode === 'signup' ? '6+ characters' : 'Password'}
          />
        </div>
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-400 text-black font-bold transition-colors disabled:opacity-50"
        >
          {loading
            ? 'Please wait...'
            : mode === 'login'
              ? 'Sign In'
              : 'Create Account'}
        </button>
        <p className="text-center text-sm text-white/40">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button
                type="button"
                onClick={() => { setMode('signup'); setError(''); }}
                className="text-green-400 hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); }}
                className="text-green-400 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </ModalShell>
  );
}

/* ── Leaderboard Modal ───────────────────────────────────── */

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    GameSaves.fetchLeaderboard()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  return (
    <ModalShell onClose={onClose} title="Leaderboard" width="max-w-2xl">
      {loading ? (
        <p className="text-white/40 text-center py-8">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-white/40 text-center py-8">No entries yet. Be the first!</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 border-b border-white/10">
                <th className="py-2 text-left">#</th>
                <th className="py-2 text-left">Player</th>
                <th className="py-2 text-right">All-Time</th>
                <th className="py-2 text-right hidden sm:table-cell">Prestige</th>
                <th className="py-2 text-right hidden sm:table-cell">CPS</th>
                <th className="py-2 text-right hidden md:table-cell">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const isTop3 = i < 3;
                const rankColors = ['text-yellow-400', 'text-gray-300', 'text-amber-600'];
                const rowBg = i === 0 ? 'bg-yellow-500/5 border-yellow-500/20' : i === 1 ? 'bg-gray-400/5 border-gray-400/10' : i === 2 ? 'bg-amber-600/5 border-amber-600/10' : 'border-white/5';
                const nameColor = i === 0 ? 'text-yellow-400 font-bold' : i === 1 ? 'text-gray-200 font-semibold' : i === 2 ? 'text-amber-500 font-semibold' : '';
                return (
                <tr key={e.uid} className={`border-b ${rowBg} hover:bg-white/5 relative`}>
                  <td className={`py-2.5 ${isTop3 ? rankColors[i] + ' font-bold text-base' : 'text-white/60'}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </td>
                  <td className="py-2.5 flex items-center gap-2">
                    <div className={`relative ${isTop3 ? 'w-7 h-7' : 'w-5 h-5'}`}>
                      {e.photoURL ? (
                        <img src={e.photoURL} alt="" className={`rounded-full ${isTop3 ? 'w-7 h-7 ring-2 ' + (i === 0 ? 'ring-yellow-400' : i === 1 ? 'ring-gray-300' : 'ring-amber-600') : 'w-5 h-5'}`} />
                      ) : (
                        <span className={`rounded-full flex items-center justify-center text-xs ${isTop3 ? 'w-7 h-7 ring-2 ' + (i === 0 ? 'ring-yellow-400 bg-yellow-500/20' : i === 1 ? 'ring-gray-300 bg-gray-400/20' : 'ring-amber-600 bg-amber-600/20') : 'w-5 h-5 bg-white/10'}`}>
                          {(e.displayName || '?')[0]}
                        </span>
                      )}
                    </div>
                    <span className={`truncate max-w-[120px] ${nameColor}`}>
                      {e.displayName || 'Anonymous'}
                    </span>
                    {(e.prestigeLevel ?? 0) > 0 && <span className="text-violet-400 text-[10px]">🌀{e.prestigeLevel > 1 ? ` ×${e.prestigeLevel}` : ''}</span>}
                  </td>
                  <td className={`py-2.5 text-right ${isTop3 ? rankColors[i] + ' font-semibold' : 'text-green-400'}`}>
                    {formatNumber(e.allTimeCloutEver ?? 0)}
                  </td>
                  <td className="py-2.5 text-right text-violet-400 hidden sm:table-cell">
                    {e.prestigeLevel ?? 0}
                  </td>
                  <td className="py-2.5 text-right hidden sm:table-cell">
                    {formatNumber(e.cps ?? 0)}/s
                  </td>
                  <td className="py-2.5 text-right hidden md:table-cell">
                    {formatNumber(e.clicks ?? 0)}
                  </td>
                  {/* Sparkles for top 3 */}
                  {isTop3 && (
                    <>
                      {['✨','⭐','🌟','💛','✨','⭐'].map((sp, si) => (
                        <span key={si} className="cc-lb-sparkle" style={{ left: `${10 + si * 16}%`, top: `${20 + (si % 3) * 30}%`, '--delay': `${si * 0.3}s`, '--dur': `${1.2 + si * 0.2}s` } as CSSProperties}>{sp}</span>
                      ))}
                    </>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}

/* ── Prestige Modal ──────────────────────────────────────── */

function PrestigeModal({
  onClose,
  onConfirm,
  chips,
  currentChips,
  level,
}: {
  onClose: () => void;
  onConfirm: () => void;
  chips: number;
  currentChips: number;
  level: number;
}) {
  return (
    <ModalShell onClose={onClose} title="Go Viral?">
      <div className="space-y-4 text-center">
        <div className="text-6xl">🚀</div>
        <p className="text-white/70">
          Reset your run to earn <span className="text-violet-400 font-bold">{chips} Viral Chips</span>.
        </p>
        <p className="text-white/50 text-sm">
          You will have{' '}
          <span className="text-violet-400">{currentChips + chips}</span> chips
          total (Prestige {level + 1}).
        </p>
        <div className="glass rounded-lg p-4 text-left text-sm space-y-1">
          <p className="text-red-400 font-semibold">Resets:</p>
          <p className="text-white/50">Clout, buildings, non-prestige upgrades, run stats</p>
          <p className="text-green-400 font-semibold mt-2">Keeps:</p>
          <p className="text-white/50">
            Viral Chips (+1% CPS each), achievements, prestige upgrades, all-time stats
          </p>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-white/10 text-white/60 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white font-bold transition-colors"
          >
            Go Viral
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ── Offline Modal ───────────────────────────────────────── */

function OfflineModal({
  onClose,
  earned,
  elapsed,
}: {
  onClose: () => void;
  earned: number;
  elapsed: number;
}) {
  return (
    <ModalShell onClose={onClose} title="Welcome Back!">
      <div className="text-center space-y-3">
        <div className="text-5xl">💤</div>
        <p className="text-white/70">
          While you were away for{' '}
          <span className="text-green-400 font-bold">{formatTime(elapsed)}</span>,
          you earned:
        </p>
        <p className="text-3xl font-display font-bold text-green-400">
          {formatNumber(earned)} clout
        </p>
        <button
          onClick={onClose}
          className="mt-4 px-6 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-black font-bold transition-colors"
        >
          Nice!
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Import/Export Modal ─────────────────────────────────── */

function IOModal({
  onClose,
  engine,
}: {
  onClose: () => void;
  engine: GameEngine;
}) {
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [msg, setMsg] = useState('');

  function handleExport() {
    const data = engine.serialize();
    const encoded = GameSaves.exportSave(data);
    setExportText(encoded);
    setMsg('');
  }

  function handleImport() {
    if (!importText.trim()) return;
    const data = GameSaves.importSave(importText.trim());
    if (!data) {
      setMsg('Invalid save data.');
      return;
    }
    engine.deserialize(data);
    GameSaves.saveLocal(data);
    setMsg('Save imported successfully!');
    setImportText('');
  }

  function handleCopy() {
    navigator.clipboard.writeText(exportText);
    setMsg('Copied to clipboard!');
  }

  return (
    <ModalShell onClose={onClose} title="Import / Export">
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-white/60 mb-1">Export Save</label>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30 transition-colors"
            >
              Generate
            </button>
            {exportText && (
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-white/60 text-sm hover:bg-white/10 transition-colors"
              >
                Copy
              </button>
            )}
          </div>
          {exportText && (
            <textarea
              readOnly
              value={exportText}
              className="mt-2 w-full h-20 bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white/60 font-mono resize-none"
            />
          )}
        </div>
        <div>
          <label className="block text-sm text-white/60 mb-1">Import Save</label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste save data here..."
            className="w-full h-20 bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-white/30 font-mono resize-none focus:outline-none focus:border-green-400/50"
          />
          <button
            onClick={handleImport}
            className="mt-2 px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30 transition-colors"
          >
            Import
          </button>
        </div>
        {msg && <p className="text-sm text-green-400">{msg}</p>}
      </div>
    </ModalShell>
  );
}

/* ── Achievement Detail Modal ────────────────────────────── */

function AchievementDetailModal({
  onClose,
  achId,
  unlocked,
}: {
  onClose: () => void;
  achId: string;
  unlocked: boolean;
}) {
  const ach = ACHIEVEMENTS.find((a) => a.id === achId);
  if (!ach) return null;

  return (
    <ModalShell onClose={onClose} title={unlocked ? ach.name : '???'}>
      <div className="text-center space-y-3">
        <div className="text-5xl">{unlocked ? ach.icon : '🔒'}</div>
        <p className="text-white/70">
          {unlocked ? ach.desc : 'Keep playing to unlock this achievement.'}
        </p>
        <p className="text-xs text-white/30">{ach.category}</p>
      </div>
    </ModalShell>
  );
}

/* ── Store Panel ─────────────────────────────────────────── */

function StorePanel({
  engine,
  buyMode,
  setBuyMode,
}: {
  engine: GameEngine;
  buyMode: BuyMode;
  setBuyMode: (m: BuyMode) => void;
}) {
  const s = engine.state;
  const [tab, setTab] = useState<StoreTab>('buildings');

  const buyModes: BuyMode[] = [1, 10, 100, 'max'];

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-3">
        {(['buildings', 'upgrades'] as StoreTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              tab === t
                ? 'bg-green-500/20 text-green-400'
                : 'bg-white/5 text-white/40 hover:text-white/60'
            }`}
          >
            {t === 'buildings' ? 'Buildings' : 'Upgrades'}
          </button>
        ))}
      </div>

      {/* Buy mode selector */}
      {tab === 'buildings' && (
        <div className="flex gap-1 mb-3">
          {buyModes.map((m) => (
            <button
              key={String(m)}
              onClick={() => setBuyMode(m)}
              className={`flex-1 py-1 text-xs rounded font-medium transition-colors ${
                buyMode === m
                  ? 'bg-green-500/20 text-green-400 border border-green-400/30'
                  : 'bg-white/5 text-white/40 hover:text-white/60 border border-transparent'
              }`}
            >
              {m === 'max' ? 'Max' : `\u00d7${m}`}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
        {tab === 'buildings' ? (
          <BuildingsList engine={engine} buyMode={buyMode} />
        ) : (
          <UpgradesGrid engine={engine} />
        )}
      </div>
    </div>
  );
}

/* ── Buildings List ──────────────────────────────────────── */

function BuildingsList({
  engine,
  buyMode,
}: {
  engine: GameEngine;
  buyMode: BuyMode;
}) {
  const s = engine.state;

  return (
    <>
      {BUILDINGS.map((b) => {
        const owned = s.buildings[b.id] || 0;

        let qty: number;
        let cost: number;
        if (buyMode === 'max') {
          const info = getMaxAffordable(b, owned, s.clout);
          qty = info.qty;
          cost = info.cost;
        } else {
          qty = buyMode;
          cost = getBuildingCost(b, owned, buyMode);
        }

        const canAfford = s.clout >= cost && qty > 0;

        // Per-building CPS contribution
        const buildingCps = owned * b.baseCps;

        return (
          <button
            key={b.id}
            onClick={() => { if (engine.buyBuilding(b.id, buyMode)) GameSound.playPurchase(); }}
            disabled={!canAfford}
            className={`w-full text-left p-2.5 rounded-xl border transition-all ${
              canAfford
                ? 'border-green-400/30 bg-green-500/5 hover:bg-green-500/10 cursor-pointer'
                : 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl flex-shrink-0 w-8 text-center">
                {b.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">{b.name}</span>
                  <span className="text-white/40 text-sm font-mono ml-2">
                    {owned}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span
                    className={`text-xs ${canAfford ? 'text-green-400' : 'text-white/30'}`}
                  >
                    {formatNumber(cost)}
                    {buyMode === 'max' && qty > 0 && (
                      <span className="text-white/30"> (\u00d7{qty})</span>
                    )}
                  </span>
                  {buildingCps > 0 && (
                    <span className="text-xs text-white/30">
                      {formatNumber(buildingCps)}/s
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

/* ── Upgrades Grid ───────────────────────────────────────── */

function UpgradesGrid({ engine }: { engine: GameEngine }) {
  const s = engine.state;
  const [hoverId, setHoverId] = useState<string | null>(null);

  const available = UPGRADES.filter(
    (u) => !s.upgrades.has(u.id) && u.condition(s),
  );
  const purchased = UPGRADES.filter((u) => s.upgrades.has(u.id));

  return (
    <div>
      {available.length > 0 && (
        <>
          <p className="text-xs text-white/30 mb-2">
            Available ({available.length})
          </p>
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {available.map((u) => {
              const canAfford = s.clout >= u.cost;
              return (
                <div key={u.id} className="relative">
                  <button
                    onClick={() => { if (engine.buyUpgrade(u.id)) GameSound.playPurchase(); }}
                    onMouseEnter={() => setHoverId(u.id)}
                    onMouseLeave={() => setHoverId(null)}
                    disabled={!canAfford}
                    className={`w-full aspect-square rounded-lg flex items-center justify-center text-xl transition-all ${
                      canAfford
                        ? 'bg-green-500/10 border border-green-400/30 hover:bg-green-500/20 cursor-pointer'
                        : 'bg-white/5 border border-white/5 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    {u.emoji}
                  </button>
                  {hoverId === u.id && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 w-48 glass-strong rounded-lg p-2 text-xs pointer-events-none">
                      <p className="font-bold text-white truncate">{u.name}</p>
                      <p className="text-white/50 mt-0.5">{u.desc}</p>
                      <p
                        className={`mt-1 font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {formatNumber(u.cost)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {purchased.length > 0 && (
        <>
          <p className="text-xs text-white/30 mb-2">
            Owned ({purchased.length})
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {purchased.map((u) => (
              <div
                key={u.id}
                className="relative group"
              >
                <div className="w-full aspect-square rounded-lg flex items-center justify-center text-xl bg-green-500/10 border border-green-400/20 relative">
                  {u.emoji}
                  <span className="absolute bottom-0.5 right-0.5 text-green-400 text-[10px]">
                    &#10003;
                  </span>
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 w-44 glass-strong rounded-lg p-2 text-xs pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="font-bold text-white truncate">{u.name}</p>
                  <p className="text-white/50 mt-0.5">{u.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {available.length === 0 && purchased.length === 0 && (
        <p className="text-white/30 text-sm text-center py-8">
          No upgrades available yet. Keep building!
        </p>
      )}
    </div>
  );
}

/* ── Click Area ──────────────────────────────────────────── */

function ClickArea({
  engine,
  onPrestigeClick,
  goldenVisible,
  goldenTimeLeft,
  onGoldenClick,
}: {
  engine: GameEngine;
  onPrestigeClick: () => void;
  goldenVisible: boolean;
  goldenTimeLeft: number;
  onGoldenClick: () => void;
}) {
  const s = engine.state;
  const [floaters, setFloaters] = useState<
    { id: number; x: number; y: number; text: string }[]
  >([]);
  const floatId = useRef(0);
  const targetRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const earned = engine.click();
      if (engine.buffs.clickFrenzy) GameSound.playClickFrenzy();
      else GameSound.playClick();
      const rect = targetRef.current?.getBoundingClientRect();
      const x = e.clientX - (rect?.left ?? 0);
      const y = e.clientY - (rect?.top ?? 0);
      const id = ++floatId.current;
      setFloaters((prev) => [...prev.slice(-15), { id, x, y, text: '+' + formatNumber(earned) }]);
      setTimeout(() => {
        setFloaters((prev) => prev.filter((f) => f.id !== id));
      }, 800);
    },
    [engine],
  );

  const cpsMult = engine.getActiveCpsMultiplier();
  const clickMult = engine.getActiveClickMultiplier();
  const hasFrenzy = engine.buffs.frenzy !== null;
  const hasClickFrenzy = engine.buffs.clickFrenzy !== null;
  const canPrestige = engine.canPrestige();
  const chips = engine.calcViralChips();

  return (
    <div className="flex flex-col items-center justify-center h-full relative select-none">
      {/* Buff Bar */}
      {(hasFrenzy || hasClickFrenzy) && (
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {hasFrenzy && engine.buffs.frenzy && (
            <div className="glass rounded-full px-3 py-1 text-xs text-yellow-400 border border-yellow-400/20">
              Frenzy \u00d77{' '}
              <span className="text-white/40">
                {Math.ceil(
                  (engine.buffs.frenzy.endTime - Date.now()) / 1000,
                )}
                s
              </span>
            </div>
          )}
          {hasClickFrenzy && engine.buffs.clickFrenzy && (
            <div className="glass rounded-full px-3 py-1 text-xs text-red-400 border border-red-400/20">
              Click Frenzy \u00d7777{' '}
              <span className="text-white/40">
                {Math.ceil(
                  (engine.buffs.clickFrenzy.endTime - Date.now()) / 1000,
                )}
                s
              </span>
            </div>
          )}
        </div>
      )}

      {/* Click Target with Orbit Ring */}
      <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
        {/* Orbit ring — viewer icons orbiting the controller */}
        {(s.buildings['viewer'] || 0) > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.min(s.buildings['viewer'] || 0, 40) }).map((_, i) => {
              const total = Math.min(s.buildings['viewer'] || 0, 40);
              const ring = Math.floor(i / 20);
              const posInRing = i % 20;
              const ringSize = Math.min(total - ring * 20, 20);
              const radius = 120 + ring * 38;
              const speed = 12 + ring * 3;
              const delay = -(posInRing / ringSize) * speed;
              return (
                <div key={i} className="absolute left-1/2 top-1/2" style={{ animation: `cc-orbit ${speed}s linear infinite`, animationDelay: `${delay}s`, width: 0, height: 0 }}>
                  <span className="absolute text-base" style={{ left: radius, top: 0, animation: `cc-pulse 10s ease-in-out infinite`, animationDelay: `${-(i / total) * 10}s` }}>
                    <span style={{ display: 'inline-block', transform: 'rotate(-60deg)' }}>👆</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Click speed ring */}
        <svg className="absolute" width="220" height="220" viewBox="0 0 220 220" style={{ left: 30, top: 30 }}>
          <circle cx="110" cy="110" r="98" fill="none" stroke="rgba(34,197,94,0.1)" strokeWidth="3" />
          <circle cx="110" cy="110" r="98" fill="none" stroke="rgba(34,197,94,0.6)" strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 98}`}
            strokeDashoffset={`${2 * Math.PI * 98 * (1 - Math.min((s.sessionClicks > 0 ? 0.3 : 0), 1))}`}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.3s' }} />
        </svg>

        <button
          ref={targetRef}
          onClick={handleClick}
          className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-2 border-green-400/30 hover:border-green-400/60 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
          style={{ WebkitTapHighlightColor: 'transparent', background: 'rgba(34,197,94,0.03)' }}
        >
          {/* Original wireframe controller SVG */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 70" width="88" height="56" aria-hidden="true">
            <path d="M18 32 C14 20 22 14 34 14 L42 14 C44 11 66 11 68 14 L76 14 C88 14 96 20 92 32 L86 55 C84 62 76 65 68 60 L62 55 C59 58 55 59 55 59 C55 59 51 58 48 55 L42 60 C34 65 26 62 24 55 Z" fill="rgba(34,197,94,0.1)" stroke="rgba(34,197,94,0.9)" strokeWidth="2.5" strokeLinejoin="round"/>
            <path d="M22 16 C28 10 38 12 42 14" stroke="rgba(34,197,94,0.7)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d="M88 16 C82 10 72 12 68 14" stroke="rgba(34,197,94,0.7)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <rect x="24" y="22" width="7" height="18" rx="2" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <rect x="18" y="28" width="19" height="6" rx="2" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <circle cx="83" cy="24" r="3.5" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <circle cx="76" cy="30" r="3.5" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <circle cx="90" cy="30" r="3.5" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <circle cx="83" cy="36" r="3.5" fill="rgba(34,197,94,0.15)" stroke="rgba(34,197,94,0.7)" strokeWidth="1.8"/>
            <circle cx="38" cy="44" r="6.5" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.6)" strokeWidth="1.8"/>
            <circle cx="38" cy="44" r="2.5" fill="rgba(34,197,94,0.3)"/>
            <circle cx="68" cy="44" r="6.5" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.6)" strokeWidth="1.8"/>
            <circle cx="68" cy="44" r="2.5" fill="rgba(34,197,94,0.3)"/>
            <rect x="48" y="24" width="5" height="3.5" rx="1.5" fill="rgba(34,197,94,0.45)"/>
            <rect x="57" y="24" width="5" height="3.5" rx="1.5" fill="rgba(34,197,94,0.45)"/>
            <circle cx="55" cy="38" r="5" fill="rgba(34,197,94,0.08)" stroke="rgba(34,197,94,0.5)" strokeWidth="1.8"/>
            <text x="55" y="41" textAnchor="middle" fontSize="5" fill="rgba(34,197,94,0.85)" fontFamily="sans-serif" fontWeight="bold">TB</text>
          </svg>
        </button>

        {/* Float Animations */}
        {floaters.map((f) => (
          <span
            key={f.id}
            className="cc-float-anim absolute text-green-400 font-bold text-sm pointer-events-none"
            style={{
              left: f.x,
              top: f.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {f.text}
          </span>
        ))}
      </div>

      {/* Prestige Button */}
      {canPrestige && (
        <button
          onClick={onPrestigeClick}
          className="mt-6 px-5 py-2 rounded-full bg-violet-500/20 border border-violet-400/30 hover:bg-violet-500/30 transition-colors cc-pulse"
        >
          <span className="text-violet-400 font-bold text-sm">
            🚀 Go Viral — earn {chips} chips
          </span>
        </button>
      )}

      {/* Golden Clout */}
      {goldenVisible && (
        <button
          onClick={onGoldenClick}
          className="absolute top-4 right-4 cc-golden-bob cursor-pointer"
          style={{ fontSize: '48px', lineHeight: 1 }}
        >
          💛
          {goldenTimeLeft > 0 && (
            <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-yellow-400/60">
              {goldenTimeLeft}s
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/* ── Stats Panel ─────────────────────────────────────────── */

function StatsPanel({
  engine,
  user,
  onSignInClick,
  onLeaderboardClick,
  onIOClick,
  onAchievementClick,
}: {
  engine: GameEngine;
  user: ReturnType<typeof useAuth>['user'];
  onSignInClick: () => void;
  onLeaderboardClick: () => void;
  onIOClick: () => void;
  onAchievementClick: (id: string) => void;
}) {
  const s = engine.state;

  const stats: { label: string; value: string; color?: string }[] = [
    { label: 'Clout', value: formatNumber(s.clout), color: 'text-green-400' },
    {
      label: 'CPS',
      value: formatNumber(s.cps * engine.getActiveCpsMultiplier()) + '/s',
      color: 'text-green-400',
    },
    {
      label: 'Per Click',
      value:
        '+' +
        formatNumber(
          (s.clickPower + s.cps * 0.01) * engine.getActiveClickMultiplier(),
        ),
    },
    { label: 'This Run', value: formatNumber(s.totalCloutEver) },
    {
      label: 'All-Time',
      value: formatNumber(s.allTimeCloutEver + s.totalCloutEver),
    },
    { label: 'Clicks', value: formatNumber(s.clicks) },
    { label: 'Peak CPS', value: formatNumber(s.peakClickCps) + '/s' },
    {
      label: 'Golden Clicks',
      value: String(s.goldenCloutClicks),
      color: 'text-yellow-400',
    },
    {
      label: 'Viral Chips',
      value: String(s.viralChips),
      color: 'text-violet-400',
    },
    {
      label: 'Prestige',
      value: 'Level ' + s.prestigeLevel,
      color: 'text-violet-400',
    },
    { label: 'Time Played', value: formatTime(s.timePlayed) },
  ];

  const totalAchievements = ACHIEVEMENTS.filter((a) => !a.shadow).length;
  const unlockedCount = s.achievements.size;

  return (
    <div className="flex flex-col h-full">
      {/* Player Card */}
      <div className="glass rounded-xl p-3 mb-3">
        {user ? (
          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="w-10 h-10 rounded-full"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-lg">
                {(user.displayName || user.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-sm">
                {user.displayName || user.email}
              </p>
              {s.prestigeLevel > 0 && (
                <p className="text-xs text-violet-400">
                  Prestige {s.prestigeLevel}
                </p>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={onSignInClick}
            className="w-full py-2 text-sm text-green-400 hover:text-green-300 transition-colors"
          >
            Sign In for cloud saves + leaderboard
          </button>
        )}
      </div>

      {/* Stats Grid */}
      <div className="glass rounded-xl p-3 mb-3">
        <h3 className="font-display text-xs text-white/30 uppercase tracking-wider mb-2">
          Stats
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {stats.map((stat) => (
            <div key={stat.label} className="flex justify-between text-xs">
              <span className="text-white/40 truncate">{stat.label}</span>
              <span className={`font-mono ${stat.color || 'text-white/70'}`}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={onLeaderboardClick}
          className="flex-1 py-1.5 text-xs rounded-lg glass border border-white/10 hover:border-green-400/30 text-white/60 hover:text-green-400 transition-colors"
        >
          Leaderboard
        </button>
        <button
          onClick={onIOClick}
          className="flex-1 py-1.5 text-xs rounded-lg glass border border-white/10 hover:border-green-400/30 text-white/60 hover:text-green-400 transition-colors"
        >
          Import/Export
        </button>
      </div>

      {/* Achievements */}
      <div className="glass rounded-xl p-3 flex-1 min-h-0 overflow-hidden flex flex-col">
        <h3 className="font-display text-xs text-white/30 uppercase tracking-wider mb-2">
          Achievements ({unlockedCount}/{totalAchievements})
        </h3>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-5 gap-1.5">
            {ACHIEVEMENTS.map((ach) => {
              const unlocked = s.achievements.has(ach.id);
              const hidden = ach.shadow && !unlocked;
              return (
                <button
                  key={ach.id}
                  onClick={() => onAchievementClick(ach.id)}
                  className={`aspect-square rounded-lg flex items-center justify-center text-lg transition-all ${
                    unlocked
                      ? 'bg-green-500/10 border border-green-400/20'
                      : 'bg-white/[0.02] border border-white/5 grayscale opacity-40'
                  }`}
                  title={
                    hidden ? '???' : unlocked ? ach.name : ach.name + ' (locked)'
                  }
                >
                  {hidden ? '❓' : ach.icon}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Nav Bar ─────────────────────────────────────────────── */

function AudioControls() {
  const [sfxOn, setSfxOn] = useState(GameSound.getEnabled());
  const [sfxVol, setSfxVol] = useState(Math.round(GameSound.getVolume() * 100));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { GameSound.init(); setOpen(!open); }}
        className="px-2 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors">
        {sfxOn && sfxVol > 0 ? '🔊' : '🔇'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 glass-strong rounded-xl p-4 w-56 z-50 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white/60">SFX</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={sfxOn} onChange={(e) => { setSfxOn(e.target.checked); GameSound.setEnabled(e.target.checked); }}
                  className="w-3 h-3 accent-green-500 cursor-pointer" />
                <span className="text-[10px] text-white/40">{sfxOn ? 'On' : 'Off'}</span>
              </label>
            </div>
            <input type="range" min="0" max="100" value={sfxVol}
              onChange={(e) => { const v = parseInt(e.target.value); setSfxVol(v); GameSound.setVolume(v / 100); }}
              className="w-full h-1 accent-green-500 cursor-pointer" />
            <span className="text-[10px] text-white/30">{sfxVol}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GameNavBar({
  user,
  onSave,
  onSignIn,
  onSignOut,
  saving,
}: {
  user: ReturnType<typeof useAuth>['user'];
  onSave: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  saving: boolean;
}) {
  return (
    <nav className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-black/40 backdrop-blur-md flex-shrink-0">
      <div className="flex items-center gap-3">
        <Link
          to="/games"
          className="text-white/40 hover:text-white/70 text-sm transition-colors"
        >
          &larr; Games
        </Link>
        <span className="text-white/10">|</span>
        <span className="font-display font-bold text-sm text-white/80">
          🎮 Clout Clicker
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AudioControls />
        <button
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {user ? (
          <button
            onClick={onSignOut}
            className="px-3 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
          >
            Sign Out
          </button>
        ) : (
          <button
            onClick={onSignIn}
            className="px-3 py-1 text-xs rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors"
          >
            Sign In
          </button>
        )}
      </div>
    </nav>
  );
}

/* ── Mobile Tab Bar ──────────────────────────────────────── */

function MobileTabBar({
  activeTab,
  setActiveTab,
}: {
  activeTab: MobileTab;
  setActiveTab: (t: MobileTab) => void;
}) {
  const tabs: { id: MobileTab; label: string; icon: string }[] = [
    { id: 'store', label: 'Store', icon: '🏪' },
    { id: 'click', label: 'Click', icon: '🎮' },
    { id: 'stats', label: 'Stats', icon: '📊' },
  ];

  return (
    <div className="flex border-t border-white/10 bg-black/60 backdrop-blur-md flex-shrink-0 lg:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setActiveTab(t.id)}
          className={`flex-1 py-3 text-center text-xs transition-colors ${
            activeTab === t.id
              ? 'text-green-400 bg-green-500/5'
              : 'text-white/40 hover:text-white/60'
          }`}
        >
          <div className="text-lg">{t.icon}</div>
          <div className="mt-0.5">{t.label}</div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CloutClicker() {
  const { user, logout } = useAuth();
  const engine = useRef<GameEngine | null>(null);
  const [, forceRender] = useState(0);
  const [modal, setModal] = useState<ModalType>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('click');
  const [buyMode, setBuyMode] = useState<BuyMode>(1);
  const [saving, setSaving] = useState(false);
  const [selectedAch, setSelectedAch] = useState<string | null>(null);
  const [offlineInfo, setOfflineInfo] = useState<{
    earned: number;
    elapsed: number;
  } | null>(null);

  // Golden clout state
  const [goldenVisible, setGoldenVisible] = useState(false);
  const [goldenTimeLeft, setGoldenTimeLeft] = useState(0);
  const goldenTimer = useRef<number | null>(null);
  const goldenCountdown = useRef<number | null>(null);
  const goldenExpiryRef = useRef<number>(0);

  // Ensure styles
  useEffect(() => {
    ensureStyles();
  }, []);

  // Initialize engine + audio
  if (!engine.current) {
    engine.current = new GameEngine();
    // Init audio context on first user interaction
    const initAudio = () => { GameSound.init(); document.removeEventListener('click', initAudio); };
    document.addEventListener('click', initAudio);
  }

  // Subscribe to engine updates
  useEffect(() => {
    const eng = engine.current!;
    const unsub = eng.subscribe(() => {
      forceRender((n) => n + 1);
    });
    return unsub;
  }, []);

  // Custom cursor: pointing emoji rotated -45deg
  useEffect(() => {
    // Use SVG foreignObject to render emoji as cursor (works cross-browser)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><foreignObject width="32" height="32"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:22px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;transform:rotate(-45deg)">👆</div></foreignObject></svg>`;
    const encoded = 'data:image/svg+xml;base64,' + btoa(svg);
    document.body.style.cursor = `url('${encoded}') 16 4, pointer`;
    return () => { document.body.style.cursor = ''; };
  }, []);

  // Load game on mount
  useEffect(() => {
    const eng = engine.current!;

    // Try localStorage first
    const local = GameSaves.loadLocal();
    if (local) {
      eng.deserialize(local);
    }

    // Apply offline income
    const offline = eng.applyOfflineIncome();
    if (offline && offline.earned > 0) {
      setOfflineInfo(offline);
      setModal('offline');
    }

    eng.start();

    return () => {
      eng.stop();
    };
  }, []);

  // When user logs in, load from Firebase and merge
  useEffect(() => {
    if (!user) return;
    const eng = engine.current!;

    eng.state.isLoggedIn = true;
    eng.state.displayName = user.displayName || '';
    eng.state.photoURL = user.photoURL || '';
    eng.state.userId = user.uid;

    GameSaves.loadFromCloud(user.uid).then(({ main }) => {
      if (main) {
        const currentSerialized = eng.serialize();
        if (GameSaves.isBetter(main, currentSerialized)) {
          eng.deserialize(main);
          eng.state.isLoggedIn = true;
          eng.state.displayName = user.displayName || '';
          eng.state.photoURL = user.photoURL || '';
          eng.state.userId = user.uid;
        }
      }
    });
  }, [user]);

  // Auto-save timers
  useEffect(() => {
    const eng = engine.current!;

    // localStorage every 15s
    const localInterval = window.setInterval(() => {
      const data = eng.serialize();
      GameSaves.saveLocal(data);
      GameSaves.saveLocalPeak(data);
    }, 15000);

    // Firebase every 60s
    const cloudInterval = window.setInterval(() => {
      if (!user) return;
      const data = eng.serialize();
      GameSaves.saveToCloud(user.uid, data);
      GameSaves.updateLeaderboard(user.uid, eng.state);
    }, 60000);

    return () => {
      clearInterval(localInterval);
      clearInterval(cloudInterval);
    };
  }, [user]);

  // Golden clout spawner
  useEffect(() => {
    const eng = engine.current!;

    function scheduleGolden() {
      const { min, max } = eng.getGoldenSpawnRange();
      const delay = min + Math.random() * (max - min);
      goldenTimer.current = window.setTimeout(() => {
        showGolden();
      }, delay);
    }

    function showGolden() {
      const duration = 13;
      setGoldenVisible(true);
      setGoldenTimeLeft(duration);
      goldenExpiryRef.current = Date.now() + duration * 1000;

      goldenCountdown.current = window.setInterval(() => {
        const remaining = Math.ceil(
          (goldenExpiryRef.current - Date.now()) / 1000,
        );
        if (remaining <= 0) {
          setGoldenVisible(false);
          setGoldenTimeLeft(0);
          if (goldenCountdown.current)
            clearInterval(goldenCountdown.current);
          scheduleGolden();
        } else {
          setGoldenTimeLeft(remaining);
        }
      }, 1000);
    }

    scheduleGolden();

    return () => {
      if (goldenTimer.current) clearTimeout(goldenTimer.current);
      if (goldenCountdown.current) clearInterval(goldenCountdown.current);
    };
  }, []);

  // Save on unmount
  useEffect(() => {
    return () => {
      const eng = engine.current;
      if (!eng) return;
      const data = eng.serialize();
      GameSaves.saveLocal(data);
    };
  }, []);

  // --- Handlers ---

  const handleSave = useCallback(async () => {
    const eng = engine.current!;
    setSaving(true);
    const data = eng.serialize();
    GameSaves.saveLocal(data);
    GameSaves.saveLocalPeak(data);
    if (user) {
      await GameSaves.saveToCloud(user.uid, data);
      await GameSaves.updateLeaderboard(user.uid, eng.state);
    }
    setSaving(false);
  }, [user]);

  const handleGoldenClick = useCallback(() => {
    const eng = engine.current!;
    setGoldenVisible(false);
    setGoldenTimeLeft(0);
    if (goldenCountdown.current) clearInterval(goldenCountdown.current);

    eng.clickGolden();
    GameSound.playGoldenClick();

    // Schedule next golden
    const { min, max } = eng.getGoldenSpawnRange();
    const delay = min + Math.random() * (max - min);
    goldenTimer.current = window.setTimeout(() => {
      const dur = 13;
      setGoldenVisible(true);
      setGoldenTimeLeft(dur);
      goldenExpiryRef.current = Date.now() + dur * 1000;
      goldenCountdown.current = window.setInterval(() => {
        const remaining = Math.ceil(
          (goldenExpiryRef.current - Date.now()) / 1000,
        );
        if (remaining <= 0) {
          setGoldenVisible(false);
          setGoldenTimeLeft(0);
          if (goldenCountdown.current)
            clearInterval(goldenCountdown.current);
        } else {
          setGoldenTimeLeft(remaining);
        }
      }, 1000);
    }, delay);
  }, []);

  const handlePrestige = useCallback(() => {
    engine.current!.prestige();
    GameSound.playPrestige();
    setModal(null);
  }, []);

  const handleSignedIn = useCallback(() => {
    // Cloud load will happen via the user effect
  }, []);

  const handleSignOut = useCallback(async () => {
    const eng = engine.current!;
    // Save before sign out
    const data = eng.serialize();
    if (user) {
      await GameSaves.saveToCloud(user.uid, data);
    }
    GameSaves.saveLocal(data);
    eng.state.isLoggedIn = false;
    eng.state.displayName = '';
    eng.state.photoURL = '';
    eng.state.userId = '';
    await logout();
  }, [user, logout]);

  const eng = engine.current!;
  const s = eng.state;

  return (
    <div className="h-screen flex flex-col cc-game-bg text-white overflow-hidden" style={{ cursor: 'pointer' }}>
      <Helmet>
        <title>Clout Clicker | TrueBeast</title>
      </Helmet>

      {/* Nav */}
      <GameNavBar
        user={user}
        onSave={handleSave}
        onSignIn={() => setModal('auth')}
        onSignOut={handleSignOut}
        saving={saving}
      />

      {/* Sticky Clout Bar */}
      <div className="flex items-center justify-center gap-6 py-2 px-4 border-b border-white/5 bg-black/30 backdrop-blur-sm flex-shrink-0">
        <span className="text-2xl sm:text-3xl font-display font-black text-white tracking-tight">{formatNumber(s.clout)}</span>
        <span className="text-green-400 text-sm font-semibold">{formatNumber(s.cps * (eng.buffs.frenzy ? eng.buffs.frenzy.mult : 1))}/s</span>
        <span className="text-white/40 text-sm">+{formatNumber((s.clickPower + s.cps * 0.01) * (eng.buffs.clickFrenzy ? eng.buffs.clickFrenzy.mult : 1))}/click</span>
        {s.prestigeLevel > 0 && <span className="text-violet-400 text-xs">🌀 ×{s.prestigeLevel}</span>}
      </div>

      {/* Game Area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Desktop: 3-column grid */}
        <div className="hidden lg:grid lg:grid-cols-[280px_1fr_280px] xl:grid-cols-[320px_1fr_320px] flex-1 min-h-0">
          {/* Store */}
          <div className="border-r border-white/10 p-3 min-h-0 flex flex-col overflow-hidden">
            <StorePanel
              engine={eng}
              buyMode={buyMode}
              setBuyMode={setBuyMode}
            />
          </div>

          {/* Click Area */}
          <div className="min-h-0 p-3">
            <ClickArea
              engine={eng}
              onPrestigeClick={() => setModal('prestige')}
              goldenVisible={goldenVisible}
              goldenTimeLeft={goldenTimeLeft}
              onGoldenClick={handleGoldenClick}
            />
          </div>

          {/* Stats */}
          <div className="border-l border-white/10 p-3 min-h-0 flex flex-col overflow-hidden">
            <StatsPanel
              engine={eng}
              user={user}
              onSignInClick={() => setModal('auth')}
              onLeaderboardClick={() => setModal('leaderboard')}
              onIOClick={() => setModal('io')}
              onAchievementClick={(id) => {
                setSelectedAch(id);
                setModal('achievement');
              }}
            />
          </div>
        </div>

        {/* Mobile: single panel */}
        <div className="flex-1 min-h-0 p-3 overflow-y-auto lg:hidden">
          {mobileTab === 'store' && (
            <StorePanel
              engine={eng}
              buyMode={buyMode}
              setBuyMode={setBuyMode}
            />
          )}
          {mobileTab === 'click' && (
            <ClickArea
              engine={eng}
              onPrestigeClick={() => setModal('prestige')}
              goldenVisible={goldenVisible}
              goldenTimeLeft={goldenTimeLeft}
              onGoldenClick={handleGoldenClick}
            />
          )}
          {mobileTab === 'stats' && (
            <StatsPanel
              engine={eng}
              user={user}
              onSignInClick={() => setModal('auth')}
              onLeaderboardClick={() => setModal('leaderboard')}
              onIOClick={() => setModal('io')}
              onAchievementClick={(id) => {
                setSelectedAch(id);
                setModal('achievement');
              }}
            />
          )}
        </div>

        {/* Mobile Tab Bar */}
        <MobileTabBar activeTab={mobileTab} setActiveTab={setMobileTab} />
      </div>

      {/* Modals */}
      {modal === 'auth' && (
        <AuthModal
          onClose={() => setModal(null)}
          onSignedIn={handleSignedIn}
        />
      )}
      {modal === 'leaderboard' && (
        <LeaderboardModal onClose={() => setModal(null)} />
      )}
      {modal === 'prestige' && (
        <PrestigeModal
          onClose={() => setModal(null)}
          onConfirm={handlePrestige}
          chips={eng.calcViralChips()}
          currentChips={s.viralChips}
          level={s.prestigeLevel}
        />
      )}
      {modal === 'offline' && offlineInfo && (
        <OfflineModal
          onClose={() => setModal(null)}
          earned={offlineInfo.earned}
          elapsed={offlineInfo.elapsed}
        />
      )}
      {modal === 'io' && (
        <IOModal onClose={() => setModal(null)} engine={eng} />
      )}
      {modal === 'achievement' && selectedAch && (
        <AchievementDetailModal
          onClose={() => setModal(null)}
          achId={selectedAch}
          unlocked={s.achievements.has(selectedAch)}
        />
      )}
    </div>
  );
}
