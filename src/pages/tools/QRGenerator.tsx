import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, ArrowLeft, Download, Upload, X } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import QRCodeStyling, { type Options, type DotType, type CornerSquareType } from 'qr-code-styling';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QRConfig {
  data: string;
  size: number;
  dotsType: DotType;
  cornerType: CornerSquareType;
  dotsColor: string;
  bgColor: string;
  bgTransparent: boolean;
  logoUrl: string;
  logoSize: number;
  margin: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOT_TYPES: { value: DotType; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy Round' },
  { value: 'extra-rounded', label: 'Extra Round' },
];

const CORNER_TYPES: { value: CornerSquareType; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'extra-rounded', label: 'Rounded' },
  { value: 'dot', label: 'Dot' },
];

const QUICK_FILL = [
  { label: 'Website', placeholder: 'https://truebeast.io' },
  { label: 'Discord', placeholder: 'https://discord.gg/example' },
  { label: 'YouTube', placeholder: 'https://youtube.com/@channel' },
  { label: 'WiFi',    placeholder: 'WIFI:S:MyNetwork;T:WPA;P:password;;' },
];

const DEFAULT_CONFIG: QRConfig = {
  data: '',
  size: 280,
  dotsType: 'rounded',
  cornerType: 'extra-rounded',
  dotsColor: '#22c55e',
  bgColor: '#ffffff',
  bgTransparent: false,
  logoUrl: '',
  logoSize: 0.3,
  margin: 10,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOptions(cfg: QRConfig): Options {
  return {
    width: cfg.size,
    height: cfg.size,
    type: 'canvas',
    data: cfg.data || 'https://truebeast.io',
    margin: cfg.margin,
    dotsOptions: {
      color: cfg.dotsColor,
      type: cfg.dotsType,
    },
    cornersSquareOptions: {
      type: cfg.cornerType,
      color: cfg.dotsColor,
    },
    backgroundOptions: cfg.bgTransparent
      ? undefined
      : { color: cfg.bgColor },
    imageOptions: {
      crossOrigin: 'anonymous',
      margin: 8,
    },
    ...(cfg.logoUrl
      ? { image: cfg.logoUrl, imageOptions: { crossOrigin: 'anonymous', margin: 8, imageSize: cfg.logoSize } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ label }: { label: string }) {
  return (
    <span className="text-xs font-bold tracking-widest text-green-400 uppercase block mb-3">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function QRGenerator() {
  const [cfg, setCfg] = useState<QRConfig>(DEFAULT_CONFIG);
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);
  const dotsColorRef = useRef<HTMLInputElement>(null);
  const bgColorRef = useRef<HTMLInputElement>(null);

  // Init QRCodeStyling instance
  useEffect(() => {
    qrRef.current = new QRCodeStyling(buildOptions(cfg));
    if (previewRef.current) {
      qrRef.current.append(previewRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update QR whenever config changes
  useEffect(() => {
    qrRef.current?.update(buildOptions(cfg));
  }, [cfg]);

  const set = useCallback(<K extends keyof QRConfig>(key: K, val: QRConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    set('logoUrl', url);
  }, [set]);

  const handleDownload = useCallback(
    (ext: 'png' | 'svg' | 'jpeg') => {
      qrRef.current?.download({ name: 'truebeast-qr', extension: ext });
    },
    [],
  );

  const hasData = cfg.data.trim().length > 0;

  return (
    <PageLayout title="QR Generator | TrueBeast Tools" gradientVariant="green">
      <section className="py-20 sm:py-28">
        <div className="max-w-[72rem] mx-auto px-4 sm:px-6">

          {/* Back + Hero */}
          <Link
            to="/tools"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10"
          >
            <ArrowLeft size={14} />
            Back to Tools
          </Link>

          <div className="text-center mb-14 space-y-5">
            <div className="inline-flex items-center gap-2 glass rounded-full px-5 py-2.5">
              <QrCode size={16} className="text-green-400" />
              <span className="text-sm text-gray-300 font-medium">Free Tool</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold">
              <span className="text-gradient">QR Generator</span>
            </h1>
            <p className="text-gray-400 max-w-[36rem] mx-auto leading-relaxed">
              Create fully customized QR codes with your own colors, shapes, and logo.
              Download as PNG or SVG - no account needed.
            </p>
          </div>

          {/* Two-column layout */}
          <div className="flex flex-col lg:flex-row gap-6">

            {/* Left: Config */}
            <div className="flex-1 min-w-0 flex flex-col gap-5">

              {/* URL Input */}
              <div className="glass rounded-2xl p-6">
                <SectionLabel label="Content" />

                {/* Quick fill */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {QUICK_FILL.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => {
                        setActiveQuick(q.label);
                        if (!cfg.data) set('data', q.placeholder);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        activeQuick === q.label
                          ? 'border-green-500/50 bg-green-500/10 text-green-400'
                          : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={cfg.data}
                  onChange={(e) => set('data', e.target.value)}
                  placeholder="Enter a URL, text, WiFi config..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-green-500/50 transition-colors"
                />
              </div>

              {/* Style */}
              <div className="glass rounded-2xl p-6">
                <SectionLabel label="Style" />

                <div className="flex flex-col gap-5">

                  {/* Dot style */}
                  <div>
                    <label className="text-gray-300 text-sm font-medium block mb-2">Dot Style</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DOT_TYPES.map((d) => (
                        <button
                          key={d.value}
                          onClick={() => set('dotsType', d.value)}
                          className={`rounded-xl py-2 text-xs font-medium border transition-all ${
                            cfg.dotsType === d.value
                              ? 'border-green-500/50 bg-green-500/10 text-green-400'
                              : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Corner style */}
                  <div>
                    <label className="text-gray-300 text-sm font-medium block mb-2">Corner Style</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CORNER_TYPES.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => set('cornerType', c.value)}
                          className={`rounded-xl py-2 text-xs font-medium border transition-all ${
                            cfg.cornerType === c.value
                              ? 'border-green-500/50 bg-green-500/10 text-green-400'
                              : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">QR Color</label>
                      <button
                        onClick={() => dotsColorRef.current?.click()}
                        className="w-full h-10 rounded-xl border-2 border-white/15 transition-transform hover:scale-105"
                        style={{ background: cfg.dotsColor }}
                      />
                      <input
                        ref={dotsColorRef}
                        type="color"
                        value={cfg.dotsColor}
                        onChange={(e) => set('dotsColor', e.target.value)}
                        className="sr-only"
                      />
                      <p className="text-gray-500 text-[11px] mt-1 text-center font-mono">
                        {cfg.dotsColor}
                      </p>
                    </div>

                    <div>
                      <label className="text-gray-300 text-sm font-medium block mb-2">Background</label>
                      <button
                        onClick={() => !cfg.bgTransparent && bgColorRef.current?.click()}
                        className={`w-full h-10 rounded-xl border-2 transition-transform ${
                          cfg.bgTransparent
                            ? 'border-white/10 cursor-default'
                            : 'border-white/15 hover:scale-105'
                        }`}
                        style={
                          cfg.bgTransparent
                            ? {
                                backgroundImage:
                                  'linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)',
                                backgroundSize: '8px 8px',
                                backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
                                backgroundColor: '#1a1a1a',
                              }
                            : { background: cfg.bgColor }
                        }
                      />
                      <input
                        ref={bgColorRef}
                        type="color"
                        value={cfg.bgColor}
                        onChange={(e) => set('bgColor', e.target.value)}
                        className="sr-only"
                      />
                      <button
                        onClick={() => set('bgTransparent', !cfg.bgTransparent)}
                        className={`w-full mt-1 text-[11px] font-medium transition-colors ${
                          cfg.bgTransparent ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {cfg.bgTransparent ? 'Transparent on' : 'Make transparent'}
                      </button>
                    </div>
                  </div>

                  {/* Size + Margin */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-gray-300 text-sm font-medium">Size</label>
                      <span className="text-green-400 text-sm font-mono">{cfg.size}px</span>
                    </div>
                    <input
                      type="range" min={150} max={600} step={10}
                      value={cfg.size}
                      onChange={(e) => set('size', Number(e.target.value))}
                      className="w-full accent-green-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-gray-300 text-sm font-medium">Margin</label>
                      <span className="text-green-400 text-sm font-mono">{cfg.margin}px</span>
                    </div>
                    <input
                      type="range" min={0} max={40} step={5}
                      value={cfg.margin}
                      onChange={(e) => set('margin', Number(e.target.value))}
                      className="w-full accent-green-500"
                    />
                  </div>
                </div>
              </div>

              {/* Logo */}
              <div className="glass rounded-2xl p-6">
                <SectionLabel label="Logo (optional)" />

                {cfg.logoUrl ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={cfg.logoUrl}
                      alt="Logo preview"
                      className="w-12 h-12 object-contain rounded-lg bg-white/5 border border-white/10"
                    />
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-gray-300 text-sm">Logo Size</span>
                        <span className="text-green-400 text-sm font-mono">
                          {Math.round(cfg.logoSize * 100)}%
                        </span>
                      </div>
                      <input
                        type="range" min={0.1} max={0.5} step={0.05}
                        value={cfg.logoSize}
                        onChange={(e) => set('logoSize', Number(e.target.value))}
                        className="w-full accent-green-500"
                      />
                    </div>
                    <button
                      onClick={() => set('logoUrl', '')}
                      className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 glass rounded-xl px-5 py-3 cursor-pointer hover:bg-white/5 transition-colors group">
                    <Upload size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors" />
                    <span className="text-gray-400 group-hover:text-gray-200 text-sm transition-colors">
                      Upload image or logo
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="sr-only"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Right: Preview + Download */}
            <div className="lg:w-[320px] flex-shrink-0">
              <div className="glass rounded-2xl p-6 lg:sticky lg:top-28">
                <SectionLabel label="Preview" />

                {/* QR preview container */}
                <div
                  className="rounded-xl overflow-hidden flex items-center justify-center mb-5"
                  style={{
                    background: 'linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                    backgroundColor: '#1a1a1a',
                  }}
                >
                  <div
                    ref={previewRef}
                    className="flex items-center justify-center"
                    style={{ maxWidth: '100%' }}
                  />
                </div>

                {!hasData && (
                  <p className="text-gray-500 text-xs text-center mb-4">
                    Enter content above to generate your QR code.
                  </p>
                )}

                {/* Download buttons */}
                <div className="flex flex-col gap-2">
                  {(['png', 'svg', 'jpeg'] as const).map((ext) => (
                    <button
                      key={ext}
                      onClick={() => handleDownload(ext)}
                      disabled={!hasData}
                      className="glass-strong rounded-xl px-5 py-3 inline-flex items-center justify-center gap-2 text-sm font-medium text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:text-green-300"
                    >
                      <Download size={15} />
                      Download {ext.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
