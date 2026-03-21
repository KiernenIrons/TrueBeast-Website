import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Grid3X3, ArrowLeft, Copy, Check, ExternalLink, X, FlaskConical } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionType = 'shortcut' | 'media' | 'link' | 'clipboard';

interface ButtonAction {
  type: ActionType;
  keys: string[];
  key?: string;
  url?: string;
  text?: string;
}

interface BoardButton {
  label: string;
  icon: string;
  color: string;
  action: ButtonAction;
}

interface GridSize {
  label: string;
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_SIZES: GridSize[] = [
  { label: '2x2', cols: 2, rows: 2 },
  { label: '3x3', cols: 3, rows: 3 },
  { label: '3x4', cols: 3, rows: 4 },
  { label: '4x4', cols: 4, rows: 4 },
  { label: '4x5', cols: 4, rows: 5 },
];

const COLOR_PALETTE = [
  '#1a1a2e', '#0f3460', '#1e3a2f', '#3a1a1a', '#1a2a1a',
  '#2d1b1b', '#1a1a3e', '#5865f2', '#7c3aed', '#0f766e',
  '#b45309', '#991b1b', '#1d4ed8', '#166534', '#6b21a8',
];

const MEDIA_KEYS = [
  { label: 'Volume Up',    key: 'volumeup' },
  { label: 'Volume Down',  key: 'volumedown' },
  { label: 'Mute',         key: 'volumemute' },
  { label: 'Play / Pause', key: 'playpause' },
  { label: 'Next Track',   key: 'nexttrack' },
  { label: 'Prev Track',   key: 'prevtrack' },
];

const PRESETS: { label: string; icon: string; color: string; action: ButtonAction }[] = [
  { label: 'Minimize All',   icon: '🗕', color: '#1e3a2f', action: { type: 'shortcut', keys: ['win', 'd'] } },
  { label: 'Lock PC',        icon: '🔒', color: '#1a1a2e', action: { type: 'shortcut', keys: ['win', 'l'] } },
  { label: 'Discord Mute',   icon: '🎤', color: '#5865f2', action: { type: 'shortcut', keys: ['ctrl', 'shift', 'm'] } },
  { label: 'Discord Deafen', icon: '🎧', color: '#5865f2', action: { type: 'shortcut', keys: ['ctrl', 'shift', 'd'] } },
  { label: 'Volume Up',      icon: '🔊', color: '#0f3460', action: { type: 'media', keys: [], key: 'volumeup' } },
  { label: 'Volume Down',    icon: '🔉', color: '#0f3460', action: { type: 'media', keys: [], key: 'volumedown' } },
  { label: 'Mute Audio',     icon: '🔇', color: '#2d1b1b', action: { type: 'media', keys: [], key: 'volumemute' } },
  { label: 'Play / Pause',   icon: '⏯',  color: '#1a2a1a', action: { type: 'media', keys: [], key: 'playpause' } },
  { label: 'Next Track',     icon: '⏭',  color: '#1a2a1a', action: { type: 'media', keys: [], key: 'nexttrack' } },
  { label: 'Prev Track',     icon: '⏮',  color: '#1a2a1a', action: { type: 'media', keys: [], key: 'prevtrack' } },
  { label: 'Screenshot',     icon: '📷', color: '#1a1a2e', action: { type: 'shortcut', keys: ['win', 'shift', 's'] } },
  { label: 'Close Window',   icon: '✖',  color: '#3a1a1a', action: { type: 'shortcut', keys: ['alt', 'f4'] } },
];

const EMPTY_BTN: BoardButton = {
  label: '',
  icon: '',
  color: '#1a1a2e',
  action: { type: 'shortcut', keys: [] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeConfig(cfg: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

function buildUrl(grid: GridSize, buttons: (BoardButton | null)[]): string {
  const cfg = { grid: { cols: grid.cols, rows: grid.rows }, buttons };
  return `/tools/buttonboard/board.html?c=${encodeConfig(cfg)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 text-xs font-bold flex-shrink-0">
        {n}
      </div>
      <span className="text-xs font-bold tracking-widest text-blue-400 uppercase">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ButtonBoard() {
  const [grid, setGrid] = useState<GridSize>(GRID_SIZES[1]); // 3x3 default
  const [buttons, setButtons] = useState<(BoardButton | null)[]>(
    Array(GRID_SIZES[1].cols * GRID_SIZES[1].rows).fill(null),
  );
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [editBtn, setEditBtn] = useState<BoardButton>(EMPTY_BTN);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const totalSlots = grid.cols * grid.rows;

  const handleGridChange = useCallback((newGrid: GridSize) => {
    setGrid(newGrid);
    const newTotal = newGrid.cols * newGrid.rows;
    setButtons((prev) => {
      const next = Array(newTotal).fill(null) as (BoardButton | null)[];
      prev.slice(0, newTotal).forEach((b, i) => { next[i] = b; });
      return next;
    });
    setSelectedSlot(null);
  }, []);

  const handleSelectSlot = useCallback(
    (i: number) => {
      setSelectedSlot(i);
      setEditBtn(buttons[i] ?? { ...EMPTY_BTN });
    },
    [buttons],
  );

  const handleSaveSlot = useCallback(() => {
    if (selectedSlot === null) return;
    setButtons((prev) => {
      const next = [...prev];
      next[selectedSlot] = editBtn.label || editBtn.icon ? { ...editBtn } : null;
      return next;
    });
    setSelectedSlot(null);
  }, [selectedSlot, editBtn]);

  const handleClearSlot = useCallback(() => {
    if (selectedSlot === null) return;
    setButtons((prev) => {
      const next = [...prev];
      next[selectedSlot] = null;
      return next;
    });
    setSelectedSlot(null);
  }, [selectedSlot]);

  const handleApplyPreset = useCallback(
    (preset: (typeof PRESETS)[0]) => {
      setEditBtn({ ...preset });
    },
    [],
  );

  const handleGenerate = useCallback(() => {
    setGeneratedUrl(buildUrl(grid, buttons));
  }, [grid, buttons]);

  const handleCopy = useCallback(() => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(`${window.location.origin}${generatedUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedUrl]);

  const filledCount = buttons.filter(Boolean).length;

  return (
    <PageLayout title="ButtonBoard | TrueBeast Tools" gradientVariant="blue">
      <section className="py-20 sm:py-28">
        <div className="max-w-[56rem] mx-auto px-4 sm:px-6">

          {/* Back + Hero */}
          <Link
            to="/tools"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10"
          >
            <ArrowLeft size={14} />
            Back to Tools
          </Link>

          <div className="text-center mb-10 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <Grid3X3 size={16} className="text-blue-400" />
              <span className="text-sm text-gray-300 font-medium">Stream Control Panel</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">ButtonBoard</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Build a customizable grid of buttons for your stream. Each button can trigger
              keyboard shortcuts, media keys, or open links. Works as an OBS browser dock.
            </p>
          </div>

          {/* Beta disclaimer */}
          <div className="glass rounded-2xl p-4 flex items-start gap-3 mb-10 border border-yellow-500/20 bg-yellow-500/5">
            <FlaskConical size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 text-sm font-semibold mb-0.5">Work in Progress</p>
              <p className="text-yellow-200/60 text-sm leading-relaxed">
                ButtonBoard is still being tested. The config builder works, but triggering
                keyboard shortcuts requires a companion app that is not yet publicly available.
                Check back soon or follow along in the Discord.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">

            {/* Step 1: Grid Size */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={1} label="Grid Size" />
              <div className="flex flex-wrap gap-2">
                {GRID_SIZES.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleGridChange(s)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                      grid.label === s.label
                        ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                        : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Grid Editor */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={2} label="Configure Buttons" />

              <div
                className="grid gap-2 mb-4"
                style={{
                  gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                  maxWidth: `${Math.min(grid.cols * 80, 360)}px`,
                }}
              >
                {Array.from({ length: totalSlots }, (_, i) => {
                  const b = buttons[i];
                  return (
                    <button
                      key={i}
                      onClick={() => handleSelectSlot(i)}
                      className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center gap-1 overflow-hidden transition-all ${
                        selectedSlot === i
                          ? 'border-blue-500 ring-2 ring-blue-500/30'
                          : b
                          ? 'border-transparent'
                          : 'border-white/8 hover:border-blue-500/40'
                      }`}
                      style={b ? { background: b.color } : { background: 'rgba(255,255,255,0.03)' }}
                    >
                      {b ? (
                        <>
                          {b.icon && <span className="text-xl leading-none">{b.icon}</span>}
                          {b.label && (
                            <span className="text-[10px] font-semibold text-white/85 text-center px-1 leading-tight">
                              {b.label}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-white/20 text-xl">+</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-gray-500 text-xs">
                Click any slot to configure it. {filledCount} of {totalSlots} slots filled.
              </p>
            </div>

            {/* Slot Editor */}
            {selectedSlot !== null && (
              <div className="glass rounded-2xl p-6 border border-blue-500/20">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-blue-400 text-xs font-bold tracking-widest uppercase">
                    Editing Slot {selectedSlot + 1}
                  </span>
                  <button
                    onClick={() => setSelectedSlot(null)}
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="mb-5">
                  <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-2">
                    Quick Presets
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => handleApplyPreset(p)}
                        className="glass rounded-lg px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
                      >
                        {p.icon} {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Label + Icon */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                      Label
                    </label>
                    <input
                      type="text"
                      value={editBtn.label}
                      onChange={(e) => setEditBtn((p) => ({ ...p, label: e.target.value }))}
                      placeholder="Button label"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                      Icon (emoji)
                    </label>
                    <input
                      type="text"
                      value={editBtn.icon}
                      onChange={(e) => setEditBtn((p) => ({ ...p, icon: e.target.value }))}
                      placeholder="🎮"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  </div>
                </div>

                {/* Color */}
                <div className="mb-4">
                  <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-2">
                    Button Color
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditBtn((p) => ({ ...p, color: c }))}
                        className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 ${
                          editBtn.color === c ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <button
                      onClick={() => colorInputRef.current?.click()}
                      className="w-7 h-7 rounded-lg border-2 border-white/20 flex items-center justify-center text-gray-400 hover:text-white text-xs transition-all"
                      title="Custom color"
                    >
                      +
                    </button>
                    <input
                      ref={colorInputRef}
                      type="color"
                      value={editBtn.color}
                      onChange={(e) => setEditBtn((p) => ({ ...p, color: e.target.value }))}
                      className="sr-only"
                    />
                  </div>
                </div>

                {/* Action Type */}
                <div className="mb-4">
                  <label className="text-gray-400 text-xs font-semibold uppercase tracking-wider block mb-2">
                    Action
                  </label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(['shortcut', 'media', 'link', 'clipboard'] as ActionType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() =>
                          setEditBtn((p) => ({ ...p, action: { ...p.action, type: t } }))
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                          editBtn.action.type === t
                            ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                            : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        {t === 'shortcut' ? 'Keyboard Shortcut' : t === 'clipboard' ? 'Clipboard' : t === 'link' ? 'Open Link' : 'Media Key'}
                      </button>
                    ))}
                  </div>

                  {editBtn.action.type === 'shortcut' && (
                    <input
                      type="text"
                      value={editBtn.action.keys.join('+')}
                      onChange={(e) =>
                        setEditBtn((p) => ({
                          ...p,
                          action: {
                            ...p.action,
                            keys: e.target.value
                              .split('+')
                              .map((k) => k.trim().toLowerCase())
                              .filter(Boolean),
                          },
                        }))
                      }
                      placeholder="e.g. ctrl+shift+m or win+l"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm font-mono placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  )}

                  {editBtn.action.type === 'media' && (
                    <div className="flex flex-wrap gap-2">
                      {MEDIA_KEYS.map((mk) => (
                        <button
                          key={mk.key}
                          onClick={() =>
                            setEditBtn((p) => ({ ...p, action: { ...p.action, key: mk.key } }))
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            editBtn.action.key === mk.key
                              ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                              : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          {mk.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {editBtn.action.type === 'link' && (
                    <input
                      type="url"
                      value={editBtn.action.url ?? ''}
                      onChange={(e) =>
                        setEditBtn((p) => ({ ...p, action: { ...p.action, url: e.target.value } }))
                      }
                      placeholder="https://example.com"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
                    />
                  )}

                  {editBtn.action.type === 'clipboard' && (
                    <textarea
                      value={editBtn.action.text ?? ''}
                      onChange={(e) =>
                        setEditBtn((p) => ({ ...p, action: { ...p.action, text: e.target.value } }))
                      }
                      placeholder="Text to copy to clipboard..."
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors resize-none"
                    />
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleClearSlot}
                    className="glass rounded-xl px-4 py-2.5 text-red-400 hover:text-red-300 text-sm transition-colors"
                  >
                    Clear Slot
                  </button>
                  <button
                    onClick={handleSaveSlot}
                    className="flex-1 glass-strong rounded-xl px-6 py-2.5 text-blue-400 hover:text-blue-300 font-semibold text-sm transition-all"
                  >
                    Save Button
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Generate */}
            <div className="glass rounded-2xl p-6">
              <StepLabel n={3} label="Generate Your Board" />

              <button
                onClick={handleGenerate}
                className="w-full glass-strong rounded-xl px-6 py-4 text-blue-400 hover:text-blue-300 font-semibold text-sm transition-all mb-4"
              >
                Generate Board URL
              </button>

              {generatedUrl && (
                <div className="flex flex-col gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 font-mono text-xs text-gray-400 break-all leading-relaxed">
                    {window.location.origin}{generatedUrl}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCopy}
                      className="flex-1 glass-strong rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 text-sm font-medium text-white transition-colors"
                    >
                      {copied ? (
                        <><Check size={15} className="text-green-400" />Copied!</>
                      ) : (
                        <><Copy size={15} />Copy URL</>
                      )}
                    </button>
                    <a
                      href={generatedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass rounded-xl px-5 py-3 inline-flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    >
                      <ExternalLink size={15} />
                      Open Board
                    </a>
                  </div>
                  <p className="text-gray-500 text-xs leading-relaxed">
                    In OBS: Docks - Custom Browser Docks - paste URL. Resize to fit your grid.
                    The board requires the companion app to trigger system shortcuts.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
