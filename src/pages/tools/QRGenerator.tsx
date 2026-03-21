import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, ArrowLeft, Upload, X, Plus, Trash2, ChevronDown, Check } from 'lucide-react';
import PageLayout from '@/components/layout/PageLayout';
import QRCodeStyling, { type DotType, type CornerSquareType } from 'qr-code-styling';
import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QRMode = 'single' | 'vcard' | 'batch';
type ContentType = 'url' | 'email' | 'phone' | 'wifi' | 'sms' | 'geo' | 'text';
type ErrLevel = 'L' | 'M' | 'Q' | 'H';
type PupilType = 'dot' | 'square';

interface SingleData {
  url: string;
  emailTo: string; emailSubj: string; emailBody: string;
  phone: string;
  wifiSsid: string; wifiPass: string; wifiSec: string; wifiHidden: boolean;
  smsPhone: string; smsMsg: string;
  geoLat: string; geoLng: string;
  text: string;
}

interface VCardData {
  firstName: string; lastName: string; org: string; title: string;
  phone: string; email: string; website: string; address: string;
}

interface QRStyle {
  dotType: DotType;
  eyeType: CornerSquareType;
  pupilType: PupilType;
  fg: string;
  bg: string;
  bgTransparent: boolean;
  useGrad: boolean;
  g1: string; g2: string;
  gradType: 'linear' | 'radial';
  gradAngle: number;
  customEye: boolean;
  eyeColor: string;
  pupilColor: string;
  logoSrc: string;
  logoSize: number;
  logoMargin: number;
  logoExcavate: boolean;
  qrSize: number;
  padding: number;
  errLevel: ErrLevel;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_TYPES: { id: ContentType; label: string; icon: string }[] = [
  { id: 'url',   label: 'URL',   icon: '🔗' },
  { id: 'email', label: 'Email', icon: '✉️' },
  { id: 'phone', label: 'Phone', icon: '📱' },
  { id: 'wifi',  label: 'WiFi',  icon: '📶' },
  { id: 'sms',   label: 'SMS',   icon: '💬' },
  { id: 'geo',   label: 'Geo',   icon: '📍' },
  { id: 'text',  label: 'Text',  icon: '📝' },
];

const DOT_STYLES: { id: DotType; label: string }[] = [
  { id: 'square',        label: 'Boxy' },
  { id: 'extra-rounded', label: 'Bouba' },
  { id: 'dots',          label: 'Braille' },
  { id: 'rounded',       label: 'Rounded' },
  { id: 'classy',        label: 'Classy' },
  { id: 'classy-rounded',label: 'Kiki' },
];

const EYE_STYLES: { id: CornerSquareType; label: string }[] = [
  { id: 'square',        label: 'Boxy' },
  { id: 'dot',           label: 'Circular' },
  { id: 'extra-rounded', label: 'Rounded' },
];

const PUPIL_STYLES: { id: PupilType; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'dot',    label: 'Circle' },
];

const QUICK_STYLES = [
  { id: 'classic', label: 'Classic', dot: 'square'        as DotType, eye: 'square'        as CornerSquareType, pupil: 'square' as PupilType, fg: '#000000', bg: '#ffffff', grad: false },
  { id: 'rounded', label: 'Rounded', dot: 'extra-rounded' as DotType, eye: 'extra-rounded' as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#000000', bg: '#ffffff', grad: false },
  { id: 'dots',    label: 'Dots',    dot: 'dots'          as DotType, eye: 'dot'           as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#000000', bg: '#ffffff', grad: false },
  { id: 'classy',  label: 'Classy',  dot: 'classy'        as DotType, eye: 'square'        as CornerSquareType, pupil: 'square' as PupilType, fg: '#1e1b4b', bg: '#ffffff', grad: false },
  { id: 'indigo',  label: 'Indigo',  dot: 'extra-rounded' as DotType, eye: 'extra-rounded' as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#4f46e5', bg: '#ffffff', grad: false },
  { id: 'rose',    label: 'Rose',    dot: 'dots'          as DotType, eye: 'dot'           as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#e11d48', bg: '#fff0f3', grad: false },
  { id: 'teal',    label: 'Teal',    dot: 'rounded'       as DotType, eye: 'extra-rounded' as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#0d9488', bg: '#f0fdfa', grad: false },
  { id: 'sunset',  label: 'Sunset',  dot: 'extra-rounded' as DotType, eye: 'extra-rounded' as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#ff6b35', bg: '#ffffff', grad: true,  g1: '#ff6b35', g2: '#f7c59f' },
  { id: 'neon',    label: 'Neon',    dot: 'dots'          as DotType, eye: 'dot'           as CornerSquareType, pupil: 'dot'    as PupilType, fg: '#39ff14', bg: '#000000', grad: false },
];

const DEFAULT_STYLE: QRStyle = {
  dotType: 'square', eyeType: 'square', pupilType: 'square',
  fg: '#000000', bg: '#ffffff', bgTransparent: false,
  useGrad: false, g1: '#6366f1', g2: '#a855f7', gradType: 'linear', gradAngle: 0,
  customEye: false, eyeColor: '#000000', pupilColor: '#000000',
  logoSrc: '', logoSize: 30, logoMargin: 5, logoExcavate: true,
  qrSize: 400, padding: 10, errLevel: 'H',
};

const DEFAULT_SINGLE: SingleData = {
  url: 'https://truebeast.io', emailTo: '', emailSubj: '', emailBody: '',
  phone: '', wifiSsid: '', wifiPass: '', wifiSec: 'WPA', wifiHidden: false,
  smsPhone: '', smsMsg: '', geoLat: '', geoLng: '', text: '',
};

const DEFAULT_VCARD: VCardData = {
  firstName: '', lastName: '', org: '', title: '',
  phone: '', email: '', website: '', address: '',
};

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

function buildSingleData(ct: ContentType, s: SingleData): string {
  switch (ct) {
    case 'url':   return s.url || 'https://truebeast.io';
    case 'email': {
      let str = `mailto:${s.emailTo}`;
      const p: string[] = [];
      if (s.emailSubj) p.push(`subject=${encodeURIComponent(s.emailSubj)}`);
      if (s.emailBody) p.push(`body=${encodeURIComponent(s.emailBody)}`);
      return p.length ? str + '?' + p.join('&') : str;
    }
    case 'phone': return `tel:${s.phone}`;
    case 'wifi':  return `WIFI:T:${s.wifiSec};S:${s.wifiSsid};P:${s.wifiPass};${s.wifiHidden ? 'H:true;' : ''};`;
    case 'sms':   return `smsto:${s.smsPhone}${s.smsMsg ? ':' + s.smsMsg : ''}`;
    case 'geo':   return `geo:${s.geoLat},${s.geoLng}`;
    default:      return s.text || 'Hello from TrueBeast!';
  }
}

function buildVCardData(v: VCardData): string {
  return [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${v.lastName};${v.firstName}`,
    `FN:${(v.firstName + ' ' + v.lastName).trim()}`,
    v.org     && `ORG:${v.org}`,
    v.title   && `TITLE:${v.title}`,
    v.phone   && `TEL:${v.phone}`,
    v.email   && `EMAIL:${v.email}`,
    v.website && `URL:${v.website}`,
    v.address && `ADR:;;${v.address}`,
    'END:VCARD',
  ].filter(Boolean).join('\n');
}

function buildQROpts(data: string, st: QRStyle, size?: number): object {
  const sz = size ?? st.qrSize;
  const primary = st.useGrad ? st.g1 : st.fg;
  const dotsOptions: object = st.useGrad
    ? {
        type: st.dotType,
        gradient: {
          type: st.gradType,
          rotation: (st.gradAngle * Math.PI) / 180,
          colorStops: [{ offset: 0, color: st.g1 }, { offset: 1, color: st.g2 }],
        },
      }
    : { type: st.dotType, color: st.fg };

  return {
    type: 'svg',
    width: sz, height: sz,
    data,
    margin: st.padding,
    qrOptions: { errorCorrectionLevel: st.errLevel },
    dotsOptions,
    backgroundOptions: { color: st.bgTransparent ? 'rgba(0,0,0,0)' : st.bg },
    cornersSquareOptions: { type: st.eyeType,   color: st.customEye ? st.eyeColor   : primary },
    cornersDotOptions:    { type: st.pupilType, color: st.customEye ? st.pupilColor : primary },
    image: st.logoSrc || undefined,
    imageOptions: {
      crossOrigin: 'anonymous',
      margin: st.logoMargin,
      imageSize: st.logoSize / 100,
      hideBackgroundDots: st.logoExcavate,
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SL({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2.5">
      {children}
    </div>
  );
}

function Inp({
  label, value, onChange, placeholder, type = 'text', rows,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; rows?: number;
}) {
  const cls = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-green-500/50 transition-colors';
  return (
    <div className="mb-3">
      {label && <label className="block text-xs text-gray-400 mb-1.5">{label}</label>}
      {rows
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={cls + ' resize-none'} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      }
    </div>
  );
}

function Sel({
  label, value, onChange, options,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="mb-3">
      {label && <label className="block text-xs text-gray-400 mb-1.5">{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[#0c0c18] border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500/50 transition-colors cursor-pointer">
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function RangeRow({
  label, value, onChange, min, max, step = 1, unit = '',
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-green-500/10 text-green-400">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-green-500" />
    </div>
  );
}

function Tog({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-green-500' : 'bg-white/15'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </button>
      {label && <span className="text-sm text-gray-300">{label}</span>}
    </label>
  );
}

function ColorPicker({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      {label && <div className="text-xs text-gray-400 mb-1.5">{label}</div>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => ref.current?.click()}
          className="w-8 h-8 rounded-lg border-2 border-white/15 flex-shrink-0 transition-transform hover:scale-105"
          style={{ background: value }}
        />
        <input ref={ref} type="color" value={value} onChange={e => onChange(e.target.value)} className="sr-only" />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-green-500/50 transition-colors" />
      </div>
    </div>
  );
}

function Acc({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/3 transition-colors rounded-xl"
      >
        <span className={`text-sm font-semibold transition-colors ${open ? 'text-green-400' : 'text-gray-300'}`}>{title}</span>
        <ChevronDown size={14} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function ShapeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`py-2 rounded-xl text-xs font-medium border transition-all ${
        active
          ? 'border-green-500/50 bg-green-500/10 text-green-400'
          : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Content inputs per type
// ---------------------------------------------------------------------------

function ContentInputs({ ct, s, set }: { ct: ContentType; s: SingleData; set: (k: keyof SingleData, v: string | boolean) => void }) {
  switch (ct) {
    case 'url':   return <Inp value={s.url} onChange={v => set('url', v)} placeholder="https://example.com" />;
    case 'email': return <>
      <Inp label="To" value={s.emailTo} onChange={v => set('emailTo', v)} placeholder="name@example.com" />
      <Inp label="Subject (optional)" value={s.emailSubj} onChange={v => set('emailSubj', v)} placeholder="Subject" />
      <Inp label="Body (optional)" value={s.emailBody} onChange={v => set('emailBody', v)} placeholder="Message…" rows={3} />
    </>;
    case 'phone': return <Inp label="Phone Number" value={s.phone} onChange={v => set('phone', v)} placeholder="+1 234 567 8900" type="tel" />;
    case 'wifi':  return <>
      <Inp label="Network Name (SSID)" value={s.wifiSsid} onChange={v => set('wifiSsid', v)} placeholder="My WiFi Network" />
      <Inp label="Password" value={s.wifiPass} onChange={v => set('wifiPass', v)} placeholder="Password" type="password" />
      <Sel label="Security" value={s.wifiSec} onChange={v => set('wifiSec', v)}
        options={[{ v: 'WPA', l: 'WPA/WPA2' }, { v: 'WEP', l: 'WEP' }, { v: 'nopass', l: 'No Password' }]} />
      <Tog checked={s.wifiHidden} onChange={v => set('wifiHidden', v)} label="Hidden network" />
    </>;
    case 'sms':   return <>
      <Inp label="Phone Number" value={s.smsPhone} onChange={v => set('smsPhone', v)} placeholder="+1 234 567 8900" type="tel" />
      <Inp label="Message (optional)" value={s.smsMsg} onChange={v => set('smsMsg', v)} placeholder="Pre-filled message…" rows={2} />
    </>;
    case 'geo':   return <>
      <Inp label="Latitude" value={s.geoLat} onChange={v => set('geoLat', v)} placeholder="37.7749" />
      <Inp label="Longitude" value={s.geoLng} onChange={v => set('geoLng', v)} placeholder="-122.4194" />
    </>;
    default:      return <Inp value={s.text} onChange={v => set('text', v)} placeholder="Enter any text…" rows={4} />;
  }
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const PREVIEW_SIZE = 280;

export default function QRGenerator() {
  const [mode, setMode] = useState<QRMode>('single');
  const [ct, setCt] = useState<ContentType>('url');
  const [sData, setSData] = useState<SingleData>(DEFAULT_SINGLE);
  const [vc, setVc] = useState<VCardData>(DEFAULT_VCARD);
  const [batchItems, setBatchItems] = useState<string[]>(['']);
  const [batchLoading, setBatchLoading] = useState(false);
  const [st, setSt] = useState<QRStyle>(DEFAULT_STYLE);
  const [acc, setAcc] = useState({ basics: true, colours: false, shapes: false, logo: false });
  const [copied, setCopied] = useState(false);
  const [activeQuickStyle, setActiveQuickStyle] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);
  const qrAttachedTo = useRef<HTMLDivElement | null>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);

  const setS = useCallback((k: keyof SingleData, v: string | boolean) =>
    setSData(p => ({ ...p, [k]: v })), []);
  const setV = useCallback((k: keyof VCardData, v: string) =>
    setVc(p => ({ ...p, [k]: v })), []);
  const updateSt = useCallback(<K extends keyof QRStyle>(k: K, v: QRStyle[K]) =>
    setSt(p => ({ ...p, [k]: v })), []);
  const togAcc = useCallback((k: keyof typeof acc) =>
    setAcc(p => ({ ...p, [k]: !p[k] })), [acc]);

  const getQRData = useCallback((): string => {
    if (mode === 'vcard') return buildVCardData(vc);
    return buildSingleData(ct, sData);
  }, [mode, ct, sData, vc]);

  // Render preview every render (idempotent update, fast)
  useEffect(() => {
    if (!previewRef.current) return;
    const opts = { ...buildQROpts(getQRData(), st, PREVIEW_SIZE), type: 'canvas' };
    if (!qrRef.current || qrAttachedTo.current !== previewRef.current) {
      qrRef.current = new QRCodeStyling(opts as any);
      qrRef.current.append(previewRef.current);
      qrAttachedTo.current = previewRef.current;
    } else {
      qrRef.current.update(opts as any);
    }
  });

  // Temporary full-size QR for downloads/copy
  const makeTempQR = useCallback(async (cb: (qr: QRCodeStyling) => Promise<void>) => {
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(div);
    const qr = new QRCodeStyling(buildQROpts(getQRData(), st) as any);
    qr.append(div);
    await new Promise(r => setTimeout(r, 120));
    await cb(qr);
    document.body.removeChild(div);
  }, [getQRData, st]);

  const download = useCallback((ext: 'png' | 'svg' | 'jpeg') => {
    makeTempQR(qr => qr.download({ name: 'qr-code', extension: ext }));
  }, [makeTempQR]);

  const copyQR = useCallback(async () => {
    try {
      await makeTempQR(async (qr) => {
        const blob = await qr.getRawData('png');
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob as Blob })]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      });
    } catch {
      alert('Copy failed — try downloading instead.');
    }
  }, [makeTempQR]);

  const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => updateSt('logoSrc', ev.target?.result as string ?? '');
    reader.readAsDataURL(f);
  }, [updateSt]);

  const applyQuickStyle = useCallback((qs: typeof QUICK_STYLES[0]) => {
    setActiveQuickStyle(qs.id);
    setSt(p => ({
      ...p,
      dotType: qs.dot, eyeType: qs.eye, pupilType: qs.pupil,
      fg: qs.fg, bg: qs.bg, useGrad: qs.grad,
      g1: (qs as { g1?: string }).g1 ?? qs.fg,
      g2: (qs as { g2?: string }).g2 ?? qs.fg,
    }));
  }, []);

  // Batch
  const addBatchItem    = () => setBatchItems(p => [...p, '']);
  const setBatchItem    = (i: number, v: string) => setBatchItems(p => p.map((x, j) => j === i ? v : x));
  const removeBatchItem = (i: number) => setBatchItems(p => p.filter((_, j) => j !== i));

  const handleBatchFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const lines = (ev.target?.result as string).split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length) setBatchItems(lines);
    };
    r.readAsText(f);
  };

  const generateBatch = async () => {
    const items = batchItems.filter(Boolean); if (!items.length) return;
    setBatchLoading(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < items.length; i++) {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const qr = new QRCodeStyling(buildQROpts(items[i], st) as any);
        qr.append(div);
        await new Promise(r => setTimeout(r, 80));
        const blob = await qr.getRawData('png');
        if (blob) zip.file(`qr-${i + 1}-${items[i].slice(0, 24).replace(/[^a-z0-9]/gi, '_')}.png`, blob as Blob);
        document.body.removeChild(div);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a'); a.href = url; a.download = 'qr-codes.zip'; a.click();
      URL.revokeObjectURL(url);
    } finally { setBatchLoading(false); }
  };

  return (
    <PageLayout title="QR Generator | TrueBeast Tools" gradientVariant="green">
      <section className="py-20 sm:py-28">
        <div className="max-w-[80rem] mx-auto px-4 sm:px-6">

          <Link to="/tools" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors mb-10">
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
              Create beautiful, fully customizable QR codes. Dots, gradients, logos, batch export.
              Free, no account needed.
            </p>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-2 mb-6">
            {([
              { id: 'single' as QRMode, label: 'Single' },
              { id: 'vcard'  as QRMode, label: 'vCard Builder' },
              { id: 'batch'  as QRMode, label: 'Batch Mode' },
            ]).map(m => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  mode === m.id
                    ? 'border-green-500/50 bg-green-500/10 text-green-400'
                    : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row gap-6">

            {/* Left: config */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">

              {/* Single */}
              {mode === 'single' && (
                <div className="glass rounded-2xl p-5">
                  <SL>Content Type</SL>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {CONTENT_TYPES.map(c => (
                      <button key={c.id} onClick={() => setCt(c.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                          ct === c.id
                            ? 'border-green-500/50 bg-green-500/10 text-green-400'
                            : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                        }`}
                      >
                        {c.icon} {c.label}
                      </button>
                    ))}
                  </div>
                  <ContentInputs ct={ct} s={sData} set={setS} />
                </div>
              )}

              {/* vCard */}
              {mode === 'vcard' && (
                <div className="glass rounded-2xl p-5">
                  <SL>Contact Details</SL>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                    <Inp label="First Name" value={vc.firstName} onChange={v => setV('firstName', v)} placeholder="John" />
                    <Inp label="Last Name"  value={vc.lastName}  onChange={v => setV('lastName', v)}  placeholder="Doe" />
                    <Inp label="Organization" value={vc.org}    onChange={v => setV('org', v)}    placeholder="Acme Inc." />
                    <Inp label="Job Title"    value={vc.title}  onChange={v => setV('title', v)}  placeholder="Software Engineer" />
                    <Inp label="Email" value={vc.email}   onChange={v => setV('email', v)}   placeholder="john@example.com" />
                    <Inp label="Phone" value={vc.phone}   onChange={v => setV('phone', v)}   placeholder="+1 234 567 8900" type="tel" />
                    <Inp label="Website" value={vc.website} onChange={v => setV('website', v)} placeholder="https://example.com" />
                    <Inp label="Address" value={vc.address} onChange={v => setV('address', v)} placeholder="123 Main St, City" />
                  </div>
                </div>
              )}

              {/* Batch */}
              {mode === 'batch' && (<>
                <div className="glass rounded-2xl p-5">
                  <SL>Batch Items</SL>
                  <p className="text-sm text-gray-400 mb-4">
                    Add one URL or piece of text per row, or upload a .txt file with one item per line.
                  </p>
                  <div className="flex gap-2 mb-4">
                    <button onClick={addBatchItem}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 border border-green-500/25 bg-green-500/8 text-green-400 hover:bg-green-500/12 transition-colors">
                      <Plus size={14} /> Add Item
                    </button>
                    <button onClick={() => batchFileRef.current?.click()}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 glass text-gray-300 hover:text-white transition-colors">
                      <Upload size={14} /> Upload List
                    </button>
                    <input ref={batchFileRef} type="file" accept=".txt,text/plain" className="sr-only" onChange={handleBatchFile} />
                  </div>
                  <div className="flex flex-col gap-2 mb-4">
                    {batchItems.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 bg-white/3 border border-white/8 rounded-xl px-3 py-2 focus-within:border-green-500/30 transition-colors">
                        <span className="text-xs font-mono w-5 text-center text-gray-600">{i + 1}</span>
                        <input type="text" value={item} onChange={e => setBatchItem(i, e.target.value)}
                          placeholder="https://example.com or any text…"
                          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600" />
                        {batchItems.length > 1 && (
                          <button onClick={() => removeBatchItem(i)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={generateBatch}
                    disabled={batchLoading || !batchItems.filter(Boolean).length}
                    className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: 'black' }}>
                    {batchLoading ? '⏳ Generating…' : `📦 Generate & Download ZIP (${batchItems.filter(Boolean).length} QR codes)`}
                  </button>
                </div>
                <div className="glass rounded-2xl p-5">
                  <SL>About QR Codes</SL>
                  <div className="text-sm space-y-1 text-gray-400">
                    <p><strong className="text-gray-200">Invented by:</strong> Masahiro Hara (Denso Wave)</p>
                    <p><strong className="text-gray-200">Year:</strong> 1994</p>
                    <p className="pt-1">Quick Response code, originally for automotive tracking. Now ubiquitous for URLs, payments, menus, and more.</p>
                  </div>
                </div>
              </>)}

              {/* Options Panel */}
              <div className="glass rounded-2xl overflow-hidden">

                <Acc title="Basics" open={acc.basics} onToggle={() => togAcc('basics')}>
                  <RangeRow label="Size"    value={st.qrSize}   onChange={v => updateSt('qrSize', v)}   min={200} max={1000} step={50} unit="px" />
                  <RangeRow label="Padding" value={st.padding}  onChange={v => updateSt('padding', v)}  min={0}   max={50}   unit="px" />
                  <div>
                    <div className="text-xs text-gray-400 mb-2">Error Correction</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['L', 'M', 'Q', 'H'] as ErrLevel[]).map(l => (
                        <button key={l} onClick={() => updateSt('errLevel', l)}
                          className={`py-2 rounded-lg text-sm font-bold border transition-all ${
                            st.errLevel === l
                              ? 'border-green-500/50 bg-green-500/10 text-green-400'
                              : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                          }`}>
                          {l}
                        </button>
                      ))}
                    </div>
                    <div className="flex text-xs mt-1 text-gray-600">
                      {['~7%', '~15%', '~25%', '~30%'].map((v, i) => (
                        <span key={i} className="flex-1 text-center">{v}</span>
                      ))}
                    </div>
                  </div>
                </Acc>

                <Acc title="Colours" open={acc.colours} onToggle={() => togAcc('colours')}>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {!st.useGrad && <ColorPicker label="Foreground" value={st.fg} onChange={v => updateSt('fg', v)} />}
                    <ColorPicker label="Background" value={st.bg} onChange={v => updateSt('bg', v)} />
                  </div>
                  <div className="mb-4">
                    <Tog checked={st.bgTransparent} onChange={v => updateSt('bgTransparent', v)} label="Transparent background" />
                  </div>

                  <div className="pt-3 border-t border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-gray-300">Gradient</span>
                      <Tog checked={st.useGrad} onChange={v => updateSt('useGrad', v)} />
                    </div>
                    {st.useGrad && <>
                      <div className="grid grid-cols-2 gap-4 mb-3">
                        <ColorPicker label="Color 1" value={st.g1} onChange={v => updateSt('g1', v)} />
                        <ColorPicker label="Color 2" value={st.g2} onChange={v => updateSt('g2', v)} />
                      </div>
                      <div className="h-7 rounded-lg mb-3 border border-white/5"
                        style={{ background: `linear-gradient(${st.gradAngle}deg,${st.g1},${st.g2})` }} />
                      <div className="flex gap-2 mb-3">
                        {(['linear', 'radial'] as const).map(t => (
                          <button key={t} onClick={() => updateSt('gradType', t)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize border transition-all ${
                              st.gradType === t
                                ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                : 'border-white/8 bg-white/3 text-gray-400 hover:border-white/20'
                            }`}>
                            {t}
                          </button>
                        ))}
                      </div>
                      {st.gradType === 'linear' && (
                        <RangeRow label="Angle" value={st.gradAngle} onChange={v => updateSt('gradAngle', v)} min={0} max={360} unit="°" />
                      )}
                    </>}
                  </div>

                  <div className="pt-3 border-t border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-gray-300">Custom eye &amp; pupil colors</span>
                      <Tog checked={st.customEye} onChange={v => updateSt('customEye', v)} />
                    </div>
                    {st.customEye && (
                      <div className="grid grid-cols-2 gap-4">
                        <ColorPicker label="Eye Color"   value={st.eyeColor}   onChange={v => updateSt('eyeColor', v)} />
                        <ColorPicker label="Pupil Color" value={st.pupilColor} onChange={v => updateSt('pupilColor', v)} />
                      </div>
                    )}
                  </div>
                </Acc>

                <Acc title="Shapes" open={acc.shapes} onToggle={() => togAcc('shapes')}>
                  <div className="mb-4">
                    <SL>Bit Style</SL>
                    <div className="grid grid-cols-3 gap-2">
                      {DOT_STYLES.map(d => (
                        <ShapeBtn key={d.id} label={d.label} active={st.dotType === d.id} onClick={() => updateSt('dotType', d.id)} />
                      ))}
                    </div>
                  </div>
                  <div className="mb-4">
                    <SL>Eyes</SL>
                    <div className="flex gap-2">
                      {EYE_STYLES.map(e => (
                        <ShapeBtn key={e.id} label={e.label} active={st.eyeType === e.id} onClick={() => updateSt('eyeType', e.id)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <SL>Pupils</SL>
                    <div className="flex gap-2">
                      {PUPIL_STYLES.map(p => (
                        <ShapeBtn key={p.id} label={p.label} active={st.pupilType === p.id} onClick={() => updateSt('pupilType', p.id)} />
                      ))}
                    </div>
                  </div>
                </Acc>

                <Acc title="Logo / Image" open={acc.logo} onToggle={() => togAcc('logo')}>
                  {st.logoSrc ? (
                    <div className="flex items-center gap-3 mb-3">
                      <img src={st.logoSrc} alt="logo" className="w-12 h-12 rounded-lg object-contain bg-white/5 border border-white/10" />
                      <button onClick={() => updateSt('logoSrc', '')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition-colors">
                        <X size={12} /> Remove
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => logoFileRef.current?.click()}
                      className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 mb-3 border border-dashed border-violet-500/30 bg-violet-500/5 text-violet-400 hover:bg-violet-500/8 transition-colors">
                      <Upload size={14} /> Upload Logo / Image
                    </button>
                  )}
                  <input ref={logoFileRef} type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} />
                  {!st.logoSrc && (
                    <Inp value={st.logoSrc} onChange={v => updateSt('logoSrc', v)} placeholder="Or paste image URL…" />
                  )}
                  {st.logoSrc && <>
                    <RangeRow label="Logo Size"   value={st.logoSize}   onChange={v => updateSt('logoSize', v)}   min={10} max={50} unit="%" />
                    <RangeRow label="Logo Margin" value={st.logoMargin} onChange={v => updateSt('logoMargin', v)} min={0}  max={20} unit="px" />
                    <Tog checked={st.logoExcavate} onChange={v => updateSt('logoExcavate', v)} label="Clear dots behind logo" />
                    <p className="text-xs text-gray-600 mt-2">Tip: Use Error Correction H when adding a logo.</p>
                  </>}
                </Acc>

              </div>
            </div>

            {/* Right: preview */}
            <div className="lg:w-[340px] flex-shrink-0">
              <div className="lg:sticky lg:top-28 flex flex-col gap-4">
                <div className="glass rounded-2xl p-5">
                  <SL>Preview</SL>

                  {/* QR preview */}
                  <div
                    className="rounded-xl flex items-center justify-center mb-4"
                    style={{
                      backgroundImage: 'linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                      backgroundColor: '#1a1a1a',
                      padding: '16px',
                    }}
                  >
                    <div ref={previewRef} style={{ width: PREVIEW_SIZE, flexShrink: 0 }} />
                  </div>

                  {/* Quick Styles */}
                  <div className="mb-4">
                    <div className="text-xs text-gray-500 mb-2">Quick Styles</div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_STYLES.map(qs => (
                        <button key={qs.id} onClick={() => applyQuickStyle(qs)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                            activeQuickStyle === qs.id
                              ? 'border-green-500/50 bg-green-500/10 text-green-400'
                              : 'border-white/10 bg-white/4 text-gray-400 hover:border-white/25 hover:bg-white/8'
                          }`}>
                          {qs.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Downloads */}
                  <div className="flex flex-col gap-2">
                    <button onClick={() => download('png')}
                      className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 hover:-translate-y-px"
                      style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: 'black' }}>
                      ⬇️ Download PNG
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => download('svg')}
                        className="glass-strong py-2 rounded-xl text-sm font-medium text-gray-200 hover:text-white transition-colors">
                        SVG
                      </button>
                      <button onClick={() => download('jpeg')}
                        className="glass-strong py-2 rounded-xl text-sm font-medium text-gray-200 hover:text-white transition-colors">
                        JPEG
                      </button>
                      <button onClick={copyQR}
                        className="glass-strong py-2 rounded-xl text-sm font-medium text-gray-200 hover:text-white transition-colors inline-flex items-center justify-center gap-1.5">
                        {copied ? <><Check size={13} className="text-green-400" />Copied</> : '📋 Copy'}
                      </button>
                    </div>
                    <div className="text-center text-xs text-gray-600">
                      Output: {st.qrSize} × {st.qrSize}px
                    </div>
                  </div>
                </div>

                {/* Tips */}
                {mode === 'single' && (
                  <div className="glass rounded-2xl p-4">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Tips</div>
                    <ul className="text-xs space-y-1.5 text-gray-400">
                      <li>• Use <strong className="text-gray-200">Error Level H</strong> when adding a logo</li>
                      <li>• SVG scales to any size without blur</li>
                      <li>• Keep high contrast between FG and BG</li>
                      <li>• Always test before printing</li>
                    </ul>
                  </div>
                )}
                {mode === 'batch' && (
                  <div className="glass rounded-2xl p-4 text-xs text-gray-400">
                    <div className="font-bold uppercase tracking-widest text-gray-500 mb-1.5">Note</div>
                    <p>Preview shows QR #1. All items use the same style settings.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
