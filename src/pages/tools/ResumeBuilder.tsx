/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useReducer, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import PageLayout from '@/components/layout/PageLayout';

// ── Styles ────────────────────────────────────────────────────────────────────
const RESUME_CSS = `
  .rb-scope {
    --c-text-faint:rgba(255,255,255,0.22);--c-text-dim:rgba(255,255,255,0.32);
    --c-text-muted:rgba(255,255,255,0.42);--c-text-label:rgba(255,255,255,0.52);
    --c-text-medium:rgba(255,255,255,0.62);--c-text-strong:rgba(255,255,255,0.72);
    --c-text-bolder:rgba(255,255,255,0.82);--c-border-sub:rgba(255,255,255,0.06);
    --c-border:rgba(255,255,255,0.10);--c-surface:rgba(255,255,255,0.05);
    --c-toggle-track:rgba(255,255,255,0.12);
  }
  html.light .rb-scope {
    --c-text-faint:rgba(0,0,0,0.38);--c-text-dim:rgba(0,0,0,0.48);
    --c-text-muted:rgba(0,0,0,0.56);--c-text-label:rgba(0,0,0,0.62);
    --c-text-medium:rgba(0,0,0,0.70);--c-text-strong:rgba(0,0,0,0.76);
    --c-text-bolder:rgba(0,0,0,0.85);--c-border-sub:rgba(0,0,0,0.08);
    --c-border:rgba(0,0,0,0.12);--c-surface:rgba(255,255,255,0.65);
    --c-toggle-track:rgba(0,0,0,0.18);
  }
  .rb-scope .inp{background:var(--c-surface);border:1px solid var(--c-border);color:var(--c-text-bolder);outline:none;transition:border-color .15s;border-radius:10px;padding:10px 14px;font-size:1rem;width:100%;}
  .rb-scope .inp:focus{border-color:rgba(6,182,212,0.5);}
  .rb-scope .inp::placeholder{color:var(--c-text-muted);}
  html.light .rb-scope .inp{background:rgba(255,255,255,0.7);color:#0e1a0e;}
  .rb-scope select.inp{cursor:pointer;padding-right:28px;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;}
  .rb-scope select.inp option{background:#111827;}
  html.light .rb-scope select.inp option{background:#f0f4f0;color:#0e1a0e;}
  .rb-scope .section-card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:14px;padding:20px;margin-bottom:10px;transition:all 0.2s ease;}
  .rb-scope .section-card:hover{border-color:rgba(6,182,212,0.3);}
  .rb-scope .drag-handle{cursor:grab;color:var(--c-text-muted);transition:color .15s;user-select:none;}
  .rb-scope .drag-handle:hover{color:var(--c-text-strong);}
  .rb-scope .drag-handle:active{cursor:grabbing;}
  .rb-scope .pill-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:8px;font-size:.85rem;font-weight:500;cursor:pointer;transition:all .15s;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-text-medium);}
  .rb-scope .pill-btn:hover{border-color:rgba(6,182,212,0.4);color:var(--c-text-bolder);}
  .rb-scope .pill-btn.active{background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.4);color:#22d3ee;}
  .rb-scope .pill-btn.danger{border-color:rgba(239,68,68,0.3);color:#ef4444;}
  .rb-scope .pill-btn.danger:hover{background:rgba(239,68,68,0.12);border-color:rgba(239,68,68,0.5);}
  .rb-scope .primary-btn{padding:8px 16px;border-radius:10px;font-size:.875rem;font-weight:600;cursor:pointer;transition:all .15s;border:none;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:white;}
  .rb-scope .primary-btn:hover{opacity:0.9;transform:translateY(-1px);}
  .rb-scope .primary-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
  .rb-scope .ghost-btn{padding:6px 12px;border-radius:8px;font-size:.9rem;cursor:pointer;transition:all .15s;border:1px solid var(--c-border);background:transparent;color:var(--c-text-medium);}
  .rb-scope .ghost-btn:hover{border-color:rgba(6,182,212,0.4);color:var(--c-text-bolder);}
  .rb-scope .collapse-btn{cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;color:var(--c-text-strong);font-weight:600;font-size:.9rem;padding:0;}
  .rb-scope .collapse-btn:hover{color:var(--c-text-bolder);}
  .rb-scope .photo-shape-btn{width:36px;height:36px;border:2px solid var(--c-border);cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;background:var(--c-surface);}
  .rb-scope .photo-shape-btn:hover{border-color:rgba(6,182,212,0.5);}
  .rb-scope .photo-shape-btn.active{border-color:#06b6d4;background:rgba(6,182,212,0.15);}
  .rb-scope .color-swatch{width:28px;height:28px;border-radius:7px;border:2px solid var(--c-border);cursor:pointer;flex-shrink:0;transition:transform .15s;}
  .rb-scope .color-swatch:hover{transform:scale(1.15);}
  .rb-scope .color-swatch.active{border-color:white;box-shadow:0 0 0 2px rgba(6,182,212,0.5);}
  .rb-scope input[type="color"]{position:absolute;opacity:0;pointer-events:none;width:0;height:0;}
  .a4-page{width:794px;min-height:1123px;background:white;color:#1a1a1a;overflow:visible;box-shadow:0 4px 20px rgba(0,0,0,0.3);}
  .a4-page.dark-mode{background:#1a1a2e;color:#e2e8f0;}
  @media print{
    body *{visibility:hidden!important;}
    #resume-print,#resume-print *{visibility:visible!important;}
    .preview-scale-wrapper{transform:none!important;position:static!important;}
    .preview-panel{position:static!important;max-height:none!important;overflow:visible!important;display:block!important;}
    #resume-print{position:absolute!important;left:0!important;top:0!important;width:210mm!important;min-height:auto!important;transform:none!important;overflow:visible!important;box-shadow:none!important;margin:0!important;z-index:999999!important;}
    nav,.no-print{display:none!important;}
  }
  .a4-page [style]>div{page-break-inside:avoid;break-inside:avoid;}
  .rb-scope .dragging{opacity:0.4;transform:scale(0.98);}
  .rb-scope .drag-over{border-color:#06b6d4!important;background:rgba(6,182,212,0.05);}
  .rb-scope .mobile-tab{padding:10px 20px;border-radius:10px;font-weight:600;font-size:.9rem;cursor:pointer;transition:all .15s;border:1px solid var(--c-border);background:transparent;color:var(--c-text-medium);}
  .rb-scope .mobile-tab.active{background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.4);color:#22d3ee;}
  .rb-scope .date-warning{color:#ef4444;font-size:.75rem;margin-top:2px;}
  .rb-scope .template-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
  .rb-scope .template-card{border:2px solid var(--c-border);border-radius:10px;padding:8px;cursor:pointer;transition:all .15s;text-align:center;position:relative;}
  .rb-scope .template-card:hover{border-color:rgba(6,182,212,0.5);transform:translateY(-1px);}
  .rb-scope .template-card.active{border-color:#06b6d4;box-shadow:0 0 0 2px rgba(6,182,212,0.3);}
  .rb-scope .template-card .tpl-preview{width:100%;aspect-ratio:210/297;border-radius:6px;margin-bottom:4px;overflow:hidden;}
  .rb-scope .template-card .tpl-name{font-size:.7rem;font-weight:600;color:var(--c-text-strong);}
  .rb-scope .template-card .ats-badge{position:absolute;top:4px;right:4px;background:rgba(34,197,94,0.9);color:white;font-size:.5rem;padding:1px 4px;border-radius:3px;font-weight:600;}
  .rb-scope .dark-toggle-btn{padding:6px 12px;border-radius:8px;font-size:.8rem;cursor:pointer;transition:all .15s;border:1px solid var(--c-border);background:transparent;color:var(--c-text-medium);display:inline-flex;align-items:center;gap:4px;}
  .rb-scope .dark-toggle-btn:hover{border-color:rgba(6,182,212,0.4);color:var(--c-text-bolder);}
  .rb-scope .dark-toggle-btn.active{background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.4);color:#818cf8;}
`;

// ── Utilities ─────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const FONTS = [
  { id: 'Inter', label: 'Inter' },
  { id: 'Roboto', label: 'Roboto' },
  { id: 'Lato', label: 'Lato' },
  { id: 'Open Sans', label: 'Open Sans' },
  { id: 'Source Sans 3', label: 'Source Sans' },
  { id: 'Raleway', label: 'Raleway' },
  { id: 'Merriweather', label: 'Merriweather' },
  { id: 'Playfair Display', label: 'Playfair' },
];

const ACCENT_COLORS = ['#000000','#0f172a','#2563eb','#06b6d4','#059669','#7c3aed','#dc2626','#ea580c','#ca8a04','#475569'];

const SECTION_META: Record<string, { label: string; icon: string }> = {
  personal:       { label: 'Personal Info',           icon: '👤' },
  summary:        { label: 'Professional Summary',    icon: '📋' },
  experience:     { label: 'Work Experience',         icon: '💼' },
  education:      { label: 'Education',               icon: '🎓' },
  skills:         { label: 'Skills',                  icon: '⚡' },
  certifications: { label: 'Certifications',          icon: '📜' },
  languages:      { label: 'Languages',               icon: '🌍' },
  projects:       { label: 'Projects',                icon: '🛠' },
  awards:         { label: 'Awards',                  icon: '🏆' },
  volunteer:      { label: 'Volunteer Work',          icon: '🤝' },
  references:     { label: 'References',              icon: '📞' },
  custom:         { label: 'Custom Section',          icon: '✏️' },
};

const PROFICIENCY_LEVELS = ['Beginner','Elementary','Intermediate','Upper Intermediate','Advanced','Native/Bilingual'];

const SUMMARY_TEMPLATES = [
  { label: 'Select a template...', value: '' },
  { label: 'Dynamic Professional', value: 'Dynamic professional with X years of experience in [industry]. Proven ability to lead cross-functional teams and deliver results that exceed expectations. Passionate about leveraging technology and innovation to drive business growth.' },
  { label: 'Results-Driven', value: 'Results-driven [job title] with expertise in [skill area]. Demonstrated success in [key achievement]. Adept at [key skill] with a commitment to continuous improvement and excellence.' },
  { label: 'Detail-Oriented', value: 'Detail-oriented professional with a strong background in [field]. Skilled in [skill 1], [skill 2], and [skill 3]. Known for delivering high-quality work under tight deadlines while maintaining exceptional attention to detail.' },
  { label: 'Creative Problem Solver', value: 'Creative and innovative [job title] with a passion for solving complex problems. Experienced in [area of expertise] with a track record of developing solutions that improve efficiency and reduce costs.' },
  { label: 'Leadership Focus', value: 'Accomplished leader with X+ years of experience managing teams of [size]. Expert in strategic planning, team development, and operational excellence. Committed to fostering collaborative environments that drive organizational success.' },
  { label: 'Career Changer', value: 'Motivated professional transitioning from [previous field] to [new field]. Bringing transferable skills in [skill 1], [skill 2], and [skill 3], combined with a fresh perspective and eagerness to contribute to a dynamic team.' },
  { label: 'Recent Graduate', value: 'Enthusiastic recent graduate with a [degree] in [field] from [university]. Eager to apply academic knowledge and internship experience in [area]. Strong foundation in [skill 1] and [skill 2] with excellent communication abilities.' },
  { label: 'Technical Expert', value: 'Highly skilled [job title] with deep expertise in [technology/framework]. X years of hands-on experience building scalable, maintainable solutions. Passionate about clean code, best practices, and mentoring junior developers.' },
];

function makeDefault(): any {
  return {
    id: uid(),
    name: 'Untitled Resume',
    template: 'modern',
    accentColor: '#2563eb',
    fontFamily: 'Inter',
    fontSize: 'medium',
    lineSpacing: 'normal',
    darkMode: false,
    photo: { dataUrl: null, shape: 'circle' },
    sectionOrder: ['personal','summary','experience','education','skills'],
    sections: {
      personal:       { enabled: true, data: { firstName:'', lastName:'', title:'', email:'', phone:'', location:'', website:'', linkedin:'' } },
      summary:        { enabled: true, heading: 'Professional Summary', data: { text: '' } },
      experience:     { enabled: true, heading: 'Work Experience', items: [{ id:uid(), company:'', title:'', location:'', startDate:'', endDate:'', current:false, bullets:[''] }] },
      education:      { enabled: true, heading: 'Education', items: [{ id:uid(), school:'', degree:'', field:'', startDate:'', endDate:'', gpa:'', bullets:[''] }] },
      skills:         { enabled: true, heading: 'Skills', displayMode: 'tags', items: [{ id:uid(), name:'', level:3, category:'' }] },
      certifications: { enabled: false, heading: 'Certifications', items: [{ id:uid(), name:'', issuer:'', date:'', url:'' }] },
      languages:      { enabled: false, heading: 'Languages', items: [{ id:uid(), name:'', proficiency:'Intermediate' }] },
      projects:       { enabled: false, heading: 'Projects', items: [{ id:uid(), name:'', url:'', description:'', technologies:'', startDate:'', endDate:'', bullets:[''] }] },
      awards:         { enabled: false, heading: 'Awards & Achievements', items: [{ id:uid(), title:'', issuer:'', date:'', description:'' }] },
      volunteer:      { enabled: false, heading: 'Volunteer Experience', items: [{ id:uid(), organization:'', role:'', startDate:'', endDate:'', bullets:[''] }] },
      references:     { enabled: false, heading: 'References', items: [{ id:uid(), name:'', title:'', company:'', email:'', phone:'', relationship:'' }] },
      custom:         { enabled: false, heading: 'Custom Section', items: [{ id:uid(), title:'', subtitle:'', description:'' }] },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Reducer ───────────────────────────────────────────────────────────────────
function resumeReducer(state: any, action: any): any {
  const now = new Date().toISOString();
  switch (action.type) {
    case 'SET_RESUME': return { ...action.resume, updatedAt: now };
    case 'SET_FIELD': {
      const keys = action.path.split('.');
      const s = JSON.parse(JSON.stringify(state));
      let obj = s;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = action.value;
      s.updatedAt = now;
      return s;
    }
    case 'SET_TEMPLATE': return { ...state, template: action.value, updatedAt: now };
    case 'SET_ACCENT': return { ...state, accentColor: action.value, updatedAt: now };
    case 'SET_FONT': return { ...state, fontFamily: action.value, updatedAt: now };
    case 'SET_PHOTO': return { ...state, photo: { ...state.photo, ...action.value }, updatedAt: now };
    case 'TOGGLE_DARK_MODE': return { ...state, darkMode: !state.darkMode, updatedAt: now };
    case 'TOGGLE_SECTION': {
      const s = JSON.parse(JSON.stringify(state));
      const sec = action.section;
      if (!s.sections[sec]) {
        const defaults = makeDefault().sections;
        s.sections[sec] = defaults[sec] || { enabled: false, heading: sec, items: [] };
      }
      s.sections[sec].enabled = !s.sections[sec].enabled;
      if (s.sections[sec].enabled && !s.sectionOrder.includes(sec)) s.sectionOrder.push(sec);
      if (!s.sections[sec].enabled) s.sectionOrder = s.sectionOrder.filter((k: string) => k !== sec);
      s.updatedAt = now;
      return s;
    }
    case 'REORDER_SECTIONS': return { ...state, sectionOrder: action.order, updatedAt: now };
    case 'ADD_ITEM': {
      const s = JSON.parse(JSON.stringify(state));
      s.sections[action.section].items.push(action.item);
      s.updatedAt = now;
      return s;
    }
    case 'REMOVE_ITEM': {
      const s = JSON.parse(JSON.stringify(state));
      s.sections[action.section].items = s.sections[action.section].items.filter((i: any) => i.id !== action.id);
      s.updatedAt = now;
      return s;
    }
    case 'UPDATE_ITEM': {
      const s = JSON.parse(JSON.stringify(state));
      const items = s.sections[action.section].items;
      const idx = items.findIndex((i: any) => i.id === action.id);
      if (idx >= 0) items[idx] = { ...items[idx], ...action.data };
      s.updatedAt = now;
      return s;
    }
    case 'REORDER_ITEMS': {
      const s = JSON.parse(JSON.stringify(state));
      s.sections[action.section].items = action.items;
      s.updatedAt = now;
      return s;
    }
    case 'ADD_BULLET': {
      const s = JSON.parse(JSON.stringify(state));
      const item = s.sections[action.section].items.find((i: any) => i.id === action.itemId);
      if (item) item.bullets.push('');
      s.updatedAt = now;
      return s;
    }
    case 'REMOVE_BULLET': {
      const s = JSON.parse(JSON.stringify(state));
      const item = s.sections[action.section].items.find((i: any) => i.id === action.itemId);
      if (item && item.bullets.length > 1) item.bullets.splice(action.bulletIdx, 1);
      s.updatedAt = now;
      return s;
    }
    case 'UPDATE_BULLET': {
      const s = JSON.parse(JSON.stringify(state));
      const item = s.sections[action.section].items.find((i: any) => i.id === action.itemId);
      if (item) item.bullets[action.bulletIdx] = action.value;
      s.updatedAt = now;
      return s;
    }
    default: return state;
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'tb_resumes';
const ACTIVE_KEY  = 'tb_resume_active';

function loadResumes(): any[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || []; } catch { return []; }
}
function saveResumes(resumes: any[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(resumes)); } catch { /* quota exceeded — silently skip */ }
}
function getActiveId(): string | null { return localStorage.getItem(ACTIVE_KEY); }
function setActiveId(id: string) { localStorage.setItem(ACTIVE_KEY, id); }

// ── Drag Hook ─────────────────────────────────────────────────────────────────
function useDragReorder(items: any[], onReorder: (items: any[]) => void) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const onDragStart = (e: React.DragEvent, idx: number) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
    setDragIdx(idx);
  };
  const onDragEnd = () => setDragIdx(null);
  return { dragIdx, onDragStart, onDragOver, onDragEnd };
}

function isEndBeforeStart(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  const s = new Date(startDate), e = new Date(endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return false;
  return e < s;
}

// ── Field Components ──────────────────────────────────────────────────────────
const Field = ({ label, value, onChange, placeholder, type = 'text', list, ...props }: any) => (
  <div className="flex flex-col gap-1">
    {label && <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>{label}</label>}
    <input className="inp" type={type} value={value||''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} placeholder={placeholder} list={list} {...props} />
  </div>
);

const MonthField = ({ label, value, onChange, placeholder }: any) => (
  <div className="flex flex-col gap-1">
    {label && <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>{label}</label>}
    <input className="inp" type="month" value={value||''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

const DatePairFields = ({ startLabel, endLabel, startValue, endValue, onStartChange, onEndChange }: any) => {
  const invalid = isEndBeforeStart(startValue, endValue);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <MonthField label={startLabel || 'Start Date'} value={startValue} onChange={onStartChange} />
        <MonthField label={endLabel || 'End Date'} value={endValue} onChange={onEndChange} />
      </div>
      {invalid && <div className="date-warning">End date is before start date</div>}
    </div>
  );
};

const TextArea = ({ label, value, onChange, placeholder, rows = 3 }: any) => (
  <div className="flex flex-col gap-1">
    {label && <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>{label}</label>}
    <textarea className="inp" rows={rows} value={value||''} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)} placeholder={placeholder} style={{resize:'vertical',minHeight:'60px'}} />
  </div>
);

// ── Photo Crop Tool ───────────────────────────────────────────────────────────
const CROP_CORNERS: Array<{ cursor:string; pos:React.CSSProperties; sx:number; sy:number; fx:boolean; fy:boolean }> = [
  { cursor:'nw-resize', pos:{top:-6,left:-6},    sx:-1, sy:-1, fx:false, fy:false },
  { cursor:'ne-resize', pos:{top:-6,right:-6},   sx: 1, sy:-1, fx:true,  fy:false },
  { cursor:'sw-resize', pos:{bottom:-6,left:-6}, sx:-1, sy: 1, fx:false, fy:true  },
  { cursor:'se-resize', pos:{bottom:-6,right:-6},sx: 1, sy: 1, fx:true,  fy:true  },
];

const PhotoCropper = ({ src, onConfirm, onCancel }: { src:string; onConfirm:(url:string)=>void; onCancel:()=>void }) => {
  const [img, setImg] = useState<HTMLImageElement|null>(null);
  const [crop, setCrop] = useState({ x:0, y:0, size:100 });

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const s = Math.min(i.width, i.height);
      setCrop({ x: Math.floor((i.width - s) / 2), y: Math.floor((i.height - s) / 2), size: s });
    };
    i.src = src;
  }, [src]);

  const DISP = Math.min(480, typeof window !== 'undefined' ? window.innerWidth - 80 : 480);
  const sc = img ? Math.min(DISP / img.width, DISP / img.height, 1) : 1;
  const dW = img ? Math.round(img.width * sc) : DISP;
  const dH = img ? Math.round(img.height * sc) : DISP;
  const dc = { x: crop.x * sc, y: crop.y * sc, s: crop.size * sc };

  const startMove = (e: React.MouseEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, { x:ox, y:oy, size:os } = crop;
    const mm = (ev: MouseEvent) => {
      if (!img) return;
      setCrop({ size:os,
        x: Math.max(0, Math.min(img.width - os,  ox + (ev.clientX - sx) / sc)),
        y: Math.max(0, Math.min(img.height - os, oy + (ev.clientY - sy) / sc)),
      });
    };
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };

  const startResize = (e: React.MouseEvent, corner: typeof CROP_CORNERS[number]) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, { x:ox, y:oy, size:os } = crop;
    const mm = (ev: MouseEvent) => {
      if (!img) return;
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
      const delta = corner.sx * dx + corner.sy * dy;
      let ns = Math.max(40 / sc, os + delta);
      let nx = corner.fx ? ox : ox - (ns - os);
      let ny = corner.fy ? oy : oy - (ns - os);
      if (nx < 0) { ns += nx; nx = 0; }
      if (ny < 0) { ns += ny; ny = 0; }
      if (nx + ns > img.width)  ns = img.width  - nx;
      if (ny + ns > img.height) ns = img.height - ny;
      setCrop({ x: nx, y: ny, size: Math.max(40 / sc, ns) });
    };
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  };

  const confirm = () => {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300;
    c.getContext('2d')!.drawImage(img,
      Math.round(crop.x), Math.round(crop.y), Math.round(crop.size), Math.round(crop.size),
      0, 0, 300, 300);
    onConfirm(c.toDataURL('image/jpeg', 0.92));
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:9999,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:16}}>
      <p style={{color:'#fff',fontWeight:600,fontSize:15,margin:0}}>Drag to position &nbsp;·&nbsp; Drag corners to resize</p>
      {img ? (
        <div style={{position:'relative',width:dW,height:dH,userSelect:'none',flexShrink:0}}>
          <img src={src} style={{width:dW,height:dH,display:'block'}} draggable={false} />
          <div onMouseDown={startMove} style={{
            position:'absolute', left:dc.x, top:dc.y, width:dc.s, height:dc.s,
            boxSizing:'border-box', cursor:'move',
            border:'2px solid #fff',
            boxShadow:'0 0 0 9999px rgba(0,0,0,0.58)',
          }}>
            {/* rule-of-thirds grid */}
            {[1/3, 2/3].map(t => (
              <span key={t} style={{pointerEvents:'none'}}>
                <span style={{position:'absolute',left:0,right:0,top:`${t*100}%`,height:1,background:'rgba(255,255,255,0.38)',display:'block'}} />
                <span style={{position:'absolute',top:0,bottom:0,left:`${t*100}%`,width:1,background:'rgba(255,255,255,0.38)',display:'block'}} />
              </span>
            ))}
            {/* corner handles */}
            {CROP_CORNERS.map((corner, i) => (
              <div key={i} onMouseDown={e => startResize(e, corner)}
                style={{position:'absolute',width:12,height:12,background:'#fff',
                  borderRadius:2,cursor:corner.cursor,...corner.pos} as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      ) : <p style={{color:'#888'}}>Loading…</p>}
      <div style={{display:'flex',gap:10}}>
        <button onClick={onCancel} className="ghost-btn">Cancel</button>
        <button onClick={confirm} className="primary-btn">Crop &amp; Use Photo</button>
      </div>
    </div>
  );
};

// ── Section Editors ───────────────────────────────────────────────────────────
const PersonalInfoEditor = ({ data, photo, dispatch }: any) => {
  const f = (field: string) => (val: string) => dispatch({ type:'SET_FIELD', path:`sections.personal.data.${field}`, value:val });
  const [cropSrc, setCropSrc] = useState<string|null>(null);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCropSrc((ev.target as FileReader).result as string);
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" value={data.firstName} onChange={f('firstName')} placeholder="John" />
        <Field label="Last Name" value={data.lastName} onChange={f('lastName')} placeholder="Doe" />
      </div>
      <Field label="Job Title" value={data.title} onChange={f('title')} placeholder="Software Engineer" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" value={data.email} onChange={f('email')} placeholder="john@example.com" type="email" />
        <Field label="Phone" value={data.phone} onChange={f('phone')} placeholder="+1 234 567 890" />
      </div>
      <Field label="Location" value={data.location} onChange={f('location')} placeholder="New York, NY" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Website" value={data.website} onChange={f('website')} placeholder="yoursite.com" />
        <Field label="LinkedIn" value={data.linkedin} onChange={f('linkedin')} placeholder="linkedin.com/in/you" />
      </div>
      <div style={{borderTop:'1px solid var(--c-border)',paddingTop:12,marginTop:8}}>
        <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500,display:'block',marginBottom:8}}>Photo (optional)</label>
        <div className="flex items-center gap-3">
          {photo.dataUrl && (
            <div style={{width:56,height:56,overflow:'hidden',flexShrink:0,
              borderRadius: photo.shape==='circle'?'50%': photo.shape==='rounded'?'12px':'4px',
              border:'2px solid var(--c-border)'}}>
              <img src={photo.dataUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="ghost-btn" style={{cursor:'pointer'}}>
              {photo.dataUrl ? 'Change Photo' : 'Upload Photo'}
              {/* key={cropSrc??''} resets the input so re-selecting the same file re-triggers onChange */}
              <input key={cropSrc ?? ''} type="file" accept="image/*" onChange={handlePhoto} style={{display:'none'}} />
            </label>
            {photo.dataUrl && (
              <button className="pill-btn danger" onClick={() => dispatch({ type:'SET_PHOTO', value:{ dataUrl:null } })}>Remove</button>
            )}
          </div>
        </div>
        {photo.dataUrl && (
          <div className="flex items-center gap-2 mt-2">
            <span style={{color:'var(--c-text-muted)',fontSize:'.75rem'}}>Shape:</span>
            {['circle','rounded','square'].map(s => (
              <button key={s} className={`photo-shape-btn ${photo.shape===s?'active':''}`}
                style={{borderRadius:s==='circle'?'50%':s==='rounded'?'8px':'4px'}}
                onClick={() => dispatch({ type:'SET_PHOTO', value:{ shape:s } })}>
                <div style={{width:16,height:16,background:'var(--c-text-medium)',borderRadius:s==='circle'?'50%':s==='rounded'?'4px':'2px'}} />
              </button>
            ))}
          </div>
        )}
      </div>
      {cropSrc && (
        <PhotoCropper
          src={cropSrc}
          onConfirm={(url) => { dispatch({ type:'SET_PHOTO', value:{ dataUrl: url } }); setCropSrc(null); }}
          onCancel={() => setCropSrc(null)}
        />
      )}
    </div>
  );
};

const SummaryEditor = ({ data, dispatch }: any) => {
  const text = data.data.text || '';
  const charCount = text.length;
  const countColor = charCount === 0 ? 'var(--c-text-muted)' : charCount < 100 ? '#f59e0b' : charCount <= 300 ? '#22c55e' : '#ef4444';
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>Quick-fill Template</label>
        <select className="inp" value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          if (e.target.value) dispatch({ type:'SET_FIELD', path:'sections.summary.data.text', value:e.target.value });
        }}>
          {SUMMARY_TEMPLATES.map((t,i) => <option key={i} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <TextArea label="Summary" value={text}
        onChange={(val: string) => dispatch({ type:'SET_FIELD', path:'sections.summary.data.text', value:val })}
        placeholder="Experienced professional with a proven track record..." rows={4} />
      <div className="flex items-center justify-between" style={{marginTop:-4}}>
        <span style={{fontSize:'.72rem',color:'var(--c-text-muted)'}}>Recommended: 150–300 characters</span>
        <span style={{fontSize:'.75rem',fontWeight:600,color:countColor}}>{charCount} / 300</span>
      </div>
    </div>
  );
};

const BulletEditor = ({ bullets, section, itemId, dispatch }: any) => (
  <div className="space-y-2">
    <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>Key Points</label>
    {bullets.map((b: string, i: number) => (
      <div key={i} className="flex items-start gap-2">
        <span style={{color:'var(--c-text-muted)',marginTop:12,fontSize:'.8rem'}}>&#8226;</span>
        <textarea className="inp" rows={1} value={b} style={{resize:'vertical',minHeight:'36px'}}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => dispatch({ type:'UPDATE_BULLET', section, itemId, bulletIdx:i, value:e.target.value })}
          placeholder="Describe your achievement..." />
        {bullets.length > 1 && (
          <button className="pill-btn danger" style={{marginTop:6,flexShrink:0}}
            onClick={() => dispatch({ type:'REMOVE_BULLET', section, itemId, bulletIdx:i })}>&#215;</button>
        )}
      </div>
    ))}
    <button className="pill-btn" onClick={() => dispatch({ type:'ADD_BULLET', section, itemId })}>+ Add Point</button>
  </div>
);

const ItemEditor = ({ item, section, fields, dispatch, open, onToggle }: any) => {
  const title = fields[0]?.getter(item) || 'New Entry';
  return (
    <div className="section-card" style={{padding:12}}>
      <div className="flex items-center justify-between">
        <button className="collapse-btn" onClick={onToggle} style={{fontSize:'.85rem'}}>
          <span style={{transition:'transform .15s',display:'inline-block',transform:open?'rotate(90deg)':'rotate(0)'}}>&#9654;</span>
          <span style={{color:'var(--c-text-strong)'}}>{title || 'New Entry'}</span>
        </button>
        <button className="pill-btn danger" onClick={() => dispatch({ type:'REMOVE_ITEM', section, id:item.id })}>Delete</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {fields.map((f: any, i: number) => {
            if (f.type === 'bullets') return <BulletEditor key={i} bullets={item.bullets} section={section} itemId={item.id} dispatch={dispatch} />;
            if (f.type === 'checkbox') return (
              <label key={i} className="flex items-center gap-2 cursor-pointer" style={{color:'var(--c-text-medium)',fontSize:'.85rem'}}>
                <input type="checkbox" checked={f.getter(item)} onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.field]:e.target.checked} })} />
                {f.label}
              </label>
            );
            if (f.type === 'select') return (
              <div key={i} className="flex flex-col gap-1">
                <label style={{color:'var(--c-text-label)',fontSize:'.85rem',fontWeight:500}}>{f.label}</label>
                <select className="inp" value={f.getter(item)} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.field]:e.target.value} })}>
                  {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            );
            if (f.type === 'month') return (
              <MonthField key={i} label={f.label} value={f.getter(item)}
                onChange={(val: string) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.field]:val} })} />
            );
            if (f.type === 'datepair') return (
              <DatePairFields key={i}
                startLabel={f.startLabel} endLabel={f.endLabel}
                startValue={item[f.startField]} endValue={item[f.endField]}
                onStartChange={(val: string) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.startField]:val} })}
                onEndChange={(val: string) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.endField]:val} })} />
            );
            if (f.type === 'textarea') return <TextArea key={i} label={f.label} value={f.getter(item)} onChange={(val: string) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.field]:val} })} placeholder={f.placeholder} />;
            return <Field key={i} label={f.label} value={f.getter(item)} onChange={(val: string) => dispatch({ type:'UPDATE_ITEM', section, id:item.id, data:{[f.field]:val} })} placeholder={f.placeholder} type={f.inputType||'text'} list={f.list} />;
          })}
        </div>
      )}
    </div>
  );
};

const ListSectionEditor = ({ section, items, fields, newItem, dispatch, heading, onHeadingChange }: any) => {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenItems(p => ({ ...p, [id]: !p[id] }));
  return (
    <div className="space-y-3">
      <Field label="Section Heading" value={heading} onChange={onHeadingChange} placeholder="Section Title" />
      {items.map((item: any) => (
        <ItemEditor key={item.id} item={item} section={section} fields={fields} dispatch={dispatch}
          open={!!openItems[item.id]} onToggle={() => toggle(item.id)} />
      ))}
      <button className="ghost-btn" onClick={() => dispatch({ type:'ADD_ITEM', section, item:{ ...newItem(), id:uid() } })}>+ Add Entry</button>
    </div>
  );
};

const ExperienceEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="experience" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.experience.heading', value:v })}
    newItem={() => ({ company:'', title:'', location:'', startDate:'', endDate:'', current:false, bullets:[''] })}
    fields={[
      { label:'Job Title', field:'title', getter:(i: any) => i.title, placeholder:'Software Engineer' },
      { label:'Company', field:'company', getter:(i: any) => i.company, placeholder:'Google' },
      { label:'Location', field:'location', getter:(i: any) => i.location, placeholder:'Mountain View, CA' },
      { type:'datepair', startField:'startDate', endField:'endDate', startLabel:'Start Date', endLabel:'End Date' },
      { label:'Currently working here', field:'current', getter:(i: any) => i.current, type:'checkbox' },
      { type:'bullets' },
    ]} />
);

const EducationEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="education" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.education.heading', value:v })}
    newItem={() => ({ school:'', degree:'', field:'', startDate:'', endDate:'', gpa:'', bullets:[''] })}
    fields={[
      { label:'School', field:'school', getter:(i: any) => i.school, placeholder:'MIT' },
      { label:'Degree', field:'degree', getter:(i: any) => i.degree, placeholder:'Bachelor of Science', list:'degree-list' },
      { label:'Field of Study', field:'field', getter:(i: any) => i.field, placeholder:'Computer Science' },
      { type:'datepair', startField:'startDate', endField:'endDate', startLabel:'Start Date', endLabel:'End Date' },
      { label:'GPA', field:'gpa', getter:(i: any) => i.gpa, placeholder:'3.8' },
      { type:'bullets' },
    ]} />
);

const SkillsEditor = ({ data, dispatch }: any) => {
  const [newSkill, setNewSkill] = useState('');
  const addSkill = () => {
    if (!newSkill.trim()) return;
    dispatch({ type:'ADD_ITEM', section:'skills', item:{ id:uid(), name:newSkill.trim(), level:3, category:'' } });
    setNewSkill('');
  };
  return (
    <div className="space-y-3">
      <Field label="Section Heading" value={data.heading}
        onChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.skills.heading', value:v })} placeholder="Skills" />
      <div className="flex gap-2">
        <input className="inp" value={newSkill} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSkill(e.target.value)}
          placeholder="Add a skill..." onKeyDown={(e: React.KeyboardEvent) => e.key==='Enter' && addSkill()} />
        <button className="ghost-btn" onClick={addSkill}>Add</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.items.map((s: any) => (
          <span key={s.id} className="pill-btn" style={{gap:6}}>
            {s.name}
            <button onClick={() => dispatch({ type:'REMOVE_ITEM', section:'skills', id:s.id })}
              style={{opacity:.6,cursor:'pointer',background:'none',border:'none',color:'inherit',fontSize:'1rem',lineHeight:1}}>&#215;</button>
          </span>
        ))}
      </div>
    </div>
  );
};

const CertificationsEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="certifications" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.certifications.heading', value:v })}
    newItem={() => ({ name:'', issuer:'', date:'', url:'' })}
    fields={[
      { label:'Certification', field:'name', getter:(i: any) => i.name, placeholder:'AWS Solutions Architect' },
      { label:'Issuer', field:'issuer', getter:(i: any) => i.issuer, placeholder:'Amazon Web Services' },
      { label:'Date', field:'date', getter:(i: any) => i.date, type:'month' },
      { label:'URL', field:'url', getter:(i: any) => i.url, placeholder:'credential.net/...' },
    ]} />
);

const LanguagesEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="languages" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.languages.heading', value:v })}
    newItem={() => ({ name:'', proficiency:'Intermediate' })}
    fields={[
      { label:'Language', field:'name', getter:(i: any) => i.name, placeholder:'Spanish' },
      { label:'Proficiency', field:'proficiency', getter:(i: any) => i.proficiency, type:'select', options:PROFICIENCY_LEVELS },
    ]} />
);

const ProjectsEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="projects" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.projects.heading', value:v })}
    newItem={() => ({ name:'', url:'', description:'', technologies:'', startDate:'', endDate:'', bullets:[''] })}
    fields={[
      { label:'Project Name', field:'name', getter:(i: any) => i.name, placeholder:'My App' },
      { label:'URL', field:'url', getter:(i: any) => i.url, placeholder:'github.com/you/project' },
      { label:'Technologies', field:'technologies', getter:(i: any) => i.technologies, placeholder:'React, Node.js, PostgreSQL' },
      { type:'datepair', startField:'startDate', endField:'endDate', startLabel:'Start Date', endLabel:'End Date' },
      { label:'Description', field:'description', getter:(i: any) => i.description, placeholder:'A brief description...', type:'textarea' },
      { type:'bullets' },
    ]} />
);

const AwardsEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="awards" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.awards.heading', value:v })}
    newItem={() => ({ title:'', issuer:'', date:'', description:'' })}
    fields={[
      { label:'Award Title', field:'title', getter:(i: any) => i.title, placeholder:'Employee of the Year' },
      { label:'Issuer', field:'issuer', getter:(i: any) => i.issuer, placeholder:'Company Name' },
      { label:'Date', field:'date', getter:(i: any) => i.date, type:'month' },
      { label:'Description', field:'description', getter:(i: any) => i.description, placeholder:'Brief description...', type:'textarea' },
    ]} />
);

const VolunteerEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="volunteer" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.volunteer.heading', value:v })}
    newItem={() => ({ organization:'', role:'', startDate:'', endDate:'', bullets:[''] })}
    fields={[
      { label:'Organization', field:'organization', getter:(i: any) => i.organization, placeholder:'Red Cross' },
      { label:'Role', field:'role', getter:(i: any) => i.role, placeholder:'Volunteer Coordinator' },
      { type:'datepair', startField:'startDate', endField:'endDate', startLabel:'Start Date', endLabel:'End Date' },
      { type:'bullets' },
    ]} />
);

const ReferencesEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="references" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.references.heading', value:v })}
    newItem={() => ({ name:'', title:'', company:'', email:'', phone:'', relationship:'' })}
    fields={[
      { label:'Full Name', field:'name', getter:(i: any) => i.name, placeholder:'Jane Smith' },
      { label:'Job Title', field:'title', getter:(i: any) => i.title, placeholder:'Senior Manager' },
      { label:'Company', field:'company', getter:(i: any) => i.company, placeholder:'Acme Corp' },
      { label:'Email', field:'email', getter:(i: any) => i.email, placeholder:'jane@example.com', inputType:'email' },
      { label:'Phone', field:'phone', getter:(i: any) => i.phone, placeholder:'+1 234 567 890' },
      { label:'Relationship', field:'relationship', getter:(i: any) => i.relationship, placeholder:'Direct supervisor for 3 years' },
    ]} />
);

const CustomSectionEditor = ({ data, dispatch }: any) => (
  <ListSectionEditor section="custom" items={data.items} dispatch={dispatch}
    heading={data.heading} onHeadingChange={(v: string) => dispatch({ type:'SET_FIELD', path:'sections.custom.heading', value:v })}
    newItem={() => ({ title:'', subtitle:'', description:'' })}
    fields={[
      { label:'Title', field:'title', getter:(i: any) => i.title, placeholder:'Entry title' },
      { label:'Subtitle', field:'subtitle', getter:(i: any) => i.subtitle, placeholder:'Subtitle or date' },
      { label:'Description', field:'description', getter:(i: any) => i.description, placeholder:'Description...', type:'textarea' },
    ]} />
);

const SECTION_EDITORS: Record<string, React.ComponentType<any>> = {
  personal: PersonalInfoEditor,
  summary: SummaryEditor,
  experience: ExperienceEditor,
  education: EducationEditor,
  skills: SkillsEditor,
  certifications: CertificationsEditor,
  languages: LanguagesEditor,
  projects: ProjectsEditor,
  awards: AwardsEditor,
  volunteer: VolunteerEditor,
  references: ReferencesEditor,
  custom: CustomSectionEditor,
};

// ── Templates ─────────────────────────────────────────────────────────────────
const tfs = (fontSize: string) => ({ small: 0.85, medium: 1, large: 1.12 } as Record<string, number>)[fontSize] || 1;
const tls = (ls: string) => ({ compact: 1.3, normal: 1.5, relaxed: 1.7 } as Record<string, number>)[ls] || 1.5;

const dmTextColor = (darkMode: boolean, light?: string, dark?: string) => darkMode ? (dark || '#e2e8f0') : (light || '#1a1a1a');
const dmSubTextColor = (darkMode: boolean, light?: string, dark?: string) => darkMode ? (dark || '#94a3b8') : (light || '#666');
const dmFaintColor = (darkMode: boolean, light?: string, dark?: string) => darkMode ? (dark || '#64748b') : (light || '#888');

const ResumeHeader = ({ sections, photo, accentColor, fontFamily, fontSize, showPhoto = true, darkMode }: any) => {
  const p = sections.personal.data;
  const fs = tfs(fontSize);
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const contacts = [p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean);
  return (
    <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>
      {showPhoto && photo?.dataUrl && (
        <img src={photo.dataUrl} style={{width:64*fs,height:64*fs,objectFit:'cover',flexShrink:0,
          borderRadius:photo.shape==='circle'?'50%':photo.shape==='rounded'?8:2}} />
      )}
      <div style={{flex:1}}>
        {fullName && <div style={{fontSize:24*fs,fontWeight:700,fontFamily,color:dmTextColor(darkMode),lineHeight:1.2}}>{fullName}</div>}
        {p.title && <div style={{fontSize:14*fs,color:accentColor,fontWeight:500,marginTop:2,fontFamily}}>{p.title}</div>}
        {contacts.length > 0 && (
          <div style={{fontSize:10*fs,color:dmSubTextColor(darkMode),marginTop:6,fontFamily,display:'flex',flexWrap:'wrap',gap:'4px 12px'}}>
            {contacts.map((c: string,i: number) => <span key={i}>{c}</span>)}
          </div>
        )}
      </div>
    </div>
  );
};

const SectionHeading = ({ text, accentColor, fontFamily, fontSize, style }: any) => (
  <div style={{fontSize:14*tfs(fontSize),fontWeight:700,color:accentColor,textTransform:'uppercase',letterSpacing:1.2,
    borderBottom:`2px solid ${accentColor}`,paddingBottom:4,marginBottom:8,marginTop:16,fontFamily,...style}}>{text}</div>
);

const ExpBlock = ({ item, fontFamily, fontSize, darkMode }: any) => {
  const fs = tfs(fontSize);
  const dateStr = item.current ? `${item.startDate} — Present` : [item.startDate, item.endDate].filter(Boolean).join(' — ');
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
        <div style={{fontWeight:600,fontSize:13*fs,fontFamily,color:dmTextColor(darkMode)}}>{item.title}{item.company ? ` at ${item.company}` : ''}</div>
        {dateStr && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily,flexShrink:0}}>{dateStr}</div>}
      </div>
      {item.location && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}>{item.location}</div>}
      {item.bullets?.filter(Boolean).length > 0 && (
        <ul style={{margin:'4px 0 0 16px',padding:0,fontSize:11*fs,color:dmSubTextColor(darkMode, '#333'),fontFamily,lineHeight:1.5,listStyleType:'disc'}}>
          {item.bullets.filter(Boolean).map((b: string,i: number) => <li key={i} style={{marginBottom:2}}>{b}</li>)}
        </ul>
      )}
    </div>
  );
};

const EduBlock = ({ item, fontFamily, fontSize, darkMode }: any) => {
  const fs = tfs(fontSize);
  const dateStr = [item.startDate, item.endDate].filter(Boolean).join(' — ');
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
        <div style={{fontWeight:600,fontSize:13*fs,fontFamily,color:dmTextColor(darkMode)}}>{item.degree}{item.field ? ` in ${item.field}` : ''}</div>
        {dateStr && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily,flexShrink:0}}>{dateStr}</div>}
      </div>
      {item.school && <div style={{fontSize:11*fs,color:dmSubTextColor(darkMode, '#555'),fontFamily}}>{item.school}</div>}
      {item.gpa && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}>GPA: {item.gpa}</div>}
      {item.bullets?.filter(Boolean).length > 0 && (
        <ul style={{margin:'4px 0 0 16px',padding:0,fontSize:11*fs,color:dmSubTextColor(darkMode, '#333'),fontFamily,lineHeight:1.5,listStyleType:'disc'}}>
          {item.bullets.filter(Boolean).map((b: string,i: number) => <li key={i} style={{marginBottom:2}}>{b}</li>)}
        </ul>
      )}
    </div>
  );
};

const SkillsTags = ({ items, accentColor, fontFamily, fontSize, darkMode: _darkMode }: any) => {
  const fs = tfs(fontSize);
  const tagFs = Math.round(10 * fs);
  return (
    <div style={{display:'flex', flexWrap:'wrap', gap:6, alignItems:'flex-start'}}>
      {items.filter((s: any) => s.name).map((s: any) => (
        <span key={s.id} style={{
          background:`${accentColor}15`, color:accentColor,
          padding:`4px 10px`,
          lineHeight:`${tagFs}px`,
          borderRadius:4, fontSize:tagFs, fontFamily, fontWeight:500,
          display:'inline-block', whiteSpace:'nowrap',
        }}>{s.name}</span>
      ))}
    </div>
  );
};

const GenericSection = ({ section, data, accentColor, fontFamily, fontSize, darkMode }: any) => {
  const fs = tfs(fontSize);
  if (section === 'certifications') return data.items.filter((i: any) => i.name).map((i: any) => (
    <div key={i.id} style={{marginBottom:6}}>
      <span style={{fontWeight:600,fontSize:12*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.name}</span>
      {i.issuer && <span style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}> &mdash; {i.issuer}</span>}
      {i.date && <span style={{fontSize:10*fs,color:dmFaintColor(darkMode, '#aaa', '#64748b'),fontFamily}}> ({i.date})</span>}
    </div>
  ));
  if (section === 'languages') return data.items.filter((i: any) => i.name).map((i: any) => (
    <div key={i.id} style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
      <span style={{fontWeight:500,fontSize:12*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.name}</span>
      <span style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}>{i.proficiency}</span>
    </div>
  ));
  if (section === 'projects') return data.items.filter((i: any) => i.name).map((i: any) => (
    <div key={i.id} style={{marginBottom:10}}>
      <div style={{fontWeight:600,fontSize:13*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.name}</div>
      {i.technologies && <div style={{fontSize:10*fs,color:accentColor,fontFamily}}>{i.technologies}</div>}
      {i.description && <div style={{fontSize:11*fs,color:dmSubTextColor(darkMode, '#555'),fontFamily,marginTop:2}}>{i.description}</div>}
      {i.bullets?.filter(Boolean).length > 0 && (
        <ul style={{margin:'4px 0 0 16px',padding:0,fontSize:11*fs,color:dmSubTextColor(darkMode, '#333'),fontFamily,lineHeight:1.5,listStyleType:'disc'}}>
          {i.bullets.filter(Boolean).map((b: string,idx: number) => <li key={idx}>{b}</li>)}
        </ul>
      )}
    </div>
  ));
  if (section === 'awards') return data.items.filter((i: any) => i.title).map((i: any) => (
    <div key={i.id} style={{marginBottom:6}}>
      <span style={{fontWeight:600,fontSize:12*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.title}</span>
      {i.issuer && <span style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}> &mdash; {i.issuer}</span>}
      {i.date && <span style={{fontSize:10*fs,color:dmFaintColor(darkMode, '#aaa', '#64748b'),fontFamily}}> ({i.date})</span>}
      {i.description && <div style={{fontSize:11*fs,color:dmSubTextColor(darkMode, '#555'),fontFamily,marginTop:2}}>{i.description}</div>}
    </div>
  ));
  if (section === 'volunteer') return data.items.filter((i: any) => i.organization||i.role).map((i: any) => (
    <ExpBlock key={i.id} item={{...i, title:i.role, company:i.organization}} fontFamily={fontFamily} fontSize={fontSize} darkMode={darkMode} />
  ));
  if (section === 'references') return data.items.filter((i: any) => i.name).map((i: any) => (
    <div key={i.id} style={{marginBottom:10}}>
      <div style={{fontWeight:600,fontSize:12*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.name}</div>
      {(i.title || i.company) && <div style={{fontSize:11*fs,color:dmSubTextColor(darkMode, '#555'),fontFamily}}>{[i.title, i.company].filter(Boolean).join(' at ')}</div>}
      <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily,marginTop:2}}>{[i.email, i.phone].filter(Boolean).join(' | ')}</div>
      {i.relationship && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode, '#aaa', '#64748b'),fontFamily,fontStyle:'italic',marginTop:1}}>{i.relationship}</div>}
    </div>
  ));
  if (section === 'custom') return data.items.filter((i: any) => i.title).map((i: any) => (
    <div key={i.id} style={{marginBottom:6}}>
      <div style={{fontWeight:600,fontSize:12*fs,fontFamily,color:dmTextColor(darkMode)}}>{i.title}</div>
      {i.subtitle && <div style={{fontSize:10*fs,color:dmFaintColor(darkMode),fontFamily}}>{i.subtitle}</div>}
      {i.description && <div style={{fontSize:11*fs,color:dmSubTextColor(darkMode, '#555'),fontFamily,marginTop:2}}>{i.description}</div>}
    </div>
  ));
  return null;
};

const renderSection = (key: string, props: any) => {
  const { sections, accentColor, fontFamily, fontSize, darkMode } = props;
  const sec = sections[key];
  if (!sec || !sec.enabled) return null;
  if (key === 'personal') return null;
  const pba: React.CSSProperties = {pageBreakInside:'avoid',breakInside:'avoid' as any,paddingTop:6};
  if (key === 'summary') {
    if (!sec.data?.text) return null;
    return (
      <div key={key} style={pba} data-rb-section="1">
        <SectionHeading text={sec.heading||'Professional Summary'} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} />
        <div style={{fontSize:11*tfs(fontSize),color:dmSubTextColor(darkMode, '#444'),fontFamily,lineHeight:tls(props.lineSpacing)}}>{sec.data.text}</div>
      </div>
    );
  }
  if (key === 'experience') {
    if (!sec.items?.some((i: any) => i.title||i.company)) return null;
    return (
      <div key={key} data-rb-section="1">
        <SectionHeading text={sec.heading||'Work Experience'} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} />
        {sec.items.filter((i: any) => i.title||i.company).map((i: any) => <div key={i.id} style={pba}><ExpBlock item={i} fontFamily={fontFamily} fontSize={fontSize} darkMode={darkMode} /></div>)}
      </div>
    );
  }
  if (key === 'education') {
    if (!sec.items?.some((i: any) => i.school||i.degree)) return null;
    return (
      <div key={key} data-rb-section="1">
        <SectionHeading text={sec.heading||'Education'} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} />
        {sec.items.filter((i: any) => i.school||i.degree).map((i: any) => <div key={i.id} style={pba}><EduBlock item={i} fontFamily={fontFamily} fontSize={fontSize} darkMode={darkMode} /></div>)}
      </div>
    );
  }
  if (key === 'skills') {
    if (!sec.items?.some((i: any) => i.name)) return null;
    return (
      <div key={key} style={pba} data-rb-section="1">
        <SectionHeading text={sec.heading||'Skills'} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} />
        <SkillsTags items={sec.items} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} darkMode={darkMode} />
      </div>
    );
  }
  if (!sec.items?.length) return null;
  return (
    <div key={key} style={pba} data-rb-section="1">
      <SectionHeading text={sec.heading} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} />
      <GenericSection section={key} data={sec} accentColor={accentColor} fontFamily={fontFamily} fontSize={fontSize} darkMode={darkMode} />
    </div>
  );
};

// ── Template Components ───────────────────────────────────────────────────────
const TemplateClassic = (props: any) => (
  <div style={{padding:40,lineHeight:tls(props.lineSpacing)}}>
    <ResumeHeader {...props} showPhoto={false} />
    {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, props))}
  </div>
);

const TemplateModern = (props: any) => (
  <div style={{minHeight:'100%',padding:'36px 36px 36px 32px',lineHeight:tls(props.lineSpacing),
    borderLeft:`5px solid ${props.accentColor}`}}>
    <ResumeHeader {...props} />
    {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, props))}
  </div>
);

const TemplateMinimal = (props: any) => {
  const fs = tfs(props.fontSize);
  const p = props.sections.personal.data;
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const contacts = [p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean);
  return (
    <div style={{padding:'48px 44px',lineHeight:tls(props.lineSpacing)}}>
      <div style={{textAlign:'center',marginBottom:20}}>
        {props.photo?.dataUrl && <img src={props.photo.dataUrl} style={{width:56*fs,height:56*fs,objectFit:'cover',margin:'0 auto 10px',display:'block',
          borderRadius:props.photo.shape==='circle'?'50%':props.photo.shape==='rounded'?8:2}} />}
        {fullName && <div style={{fontSize:28*fs,fontWeight:300,fontFamily:props.fontFamily,color:dmTextColor(props.darkMode),letterSpacing:2}}>{fullName}</div>}
        {p.title && <div style={{fontSize:12*fs,color:dmFaintColor(props.darkMode, '#999'),marginTop:4,fontFamily:props.fontFamily,letterSpacing:1}}>{p.title}</div>}
        {contacts.length > 0 && <div style={{fontSize:9*fs,color:dmFaintColor(props.darkMode, '#bbb', '#64748b'),marginTop:8,fontFamily:props.fontFamily}}>{contacts.join('  |  ')}</div>}
      </div>
      <div style={{borderTop:props.darkMode?'1px solid #334155':'1px solid #e5e5e5',marginBottom:16}} />
      {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, {...props, accentColor:props.darkMode?'#94a3b8':'#333'}))}
    </div>
  );
};

const ProfessionalWrapper = (props: any) => (
  <div style={{padding:36,lineHeight:tls(props.lineSpacing)}}>
    <div style={{background:props.accentColor,padding:'20px 24px',marginBottom:20,borderRadius:4}}>
      <div style={{display:'flex',alignItems:'center',gap:16}}>
        {props.photo?.dataUrl && (
          <img src={props.photo.dataUrl} style={{width:60,height:60,objectFit:'cover',flexShrink:0,
            borderRadius:props.photo.shape==='circle'?'50%':props.photo.shape==='rounded'?8:2,border:'2px solid rgba(255,255,255,0.3)'}} />
        )}
        <div>
          {(() => { const p = props.sections.personal.data; const name = [p.firstName,p.lastName].filter(Boolean).join(' ');
            return name ? <div style={{fontSize:22*tfs(props.fontSize),fontWeight:700,color:'white',fontFamily:props.fontFamily}}>{name}</div> : null;
          })()}
          {props.sections.personal.data.title && <div style={{fontSize:13*tfs(props.fontSize),color:'rgba(255,255,255,0.85)',fontFamily:props.fontFamily}}>{props.sections.personal.data.title}</div>}
          <div style={{fontSize:10*tfs(props.fontSize),color:'rgba(255,255,255,0.7)',marginTop:4,fontFamily:props.fontFamily,display:'flex',flexWrap:'wrap',gap:'4px 12px'}}>
            {[props.sections.personal.data.email,props.sections.personal.data.phone,props.sections.personal.data.location,props.sections.personal.data.website,props.sections.personal.data.linkedin].filter(Boolean).map((c: string,i: number) => <span key={i}>{c}</span>)}
          </div>
        </div>
      </div>
    </div>
    {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, props))}
  </div>
);

const TemplateCreative = (props: any) => {
  const fs = tfs(props.fontSize);
  const p = props.sections.personal.data;
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  return (
    <div style={{lineHeight:tls(props.lineSpacing)}}>
      <div style={{background:`linear-gradient(135deg, ${props.accentColor}, ${props.accentColor}dd)`,padding:'32px 36px',color:'white'}}>
        <div style={{display:'flex',alignItems:'center',gap:16}}>
          {props.photo?.dataUrl && <img src={props.photo.dataUrl} style={{width:72*fs,height:72*fs,objectFit:'cover',
            borderRadius:props.photo.shape==='circle'?'50%':props.photo.shape==='rounded'?10:4,border:'3px solid rgba(255,255,255,0.3)'}} />}
          <div>
            {fullName && <div style={{fontSize:28*fs,fontWeight:800,fontFamily:props.fontFamily}}>{fullName}</div>}
            {p.title && <div style={{fontSize:14*fs,opacity:.85,fontFamily:props.fontFamily,marginTop:2}}>{p.title}</div>}
          </div>
        </div>
        <div style={{fontSize:10*fs,opacity:.7,marginTop:10,fontFamily:props.fontFamily,display:'flex',flexWrap:'wrap',gap:'4px 14px'}}>
          {[p.email,p.phone,p.location,p.website,p.linkedin].filter(Boolean).map((c: string,i: number) => <span key={i}>{c}</span>)}
        </div>
      </div>
      <div style={{padding:'20px 36px'}}>
        {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, props))}
      </div>
    </div>
  );
};

const TemplateTwoColumn = (props: any) => {
  const fs = tfs(props.fontSize);
  const p = props.sections.personal.data;
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const sidebar = ['skills','languages','certifications','awards'].filter((k: string) => props.sectionOrder.includes(k));
  const main = props.sectionOrder.filter((k: string) => k !== 'personal' && !sidebar.includes(k));
  return (
    <div style={{display:'flex',minHeight:'100%',lineHeight:tls(props.lineSpacing)}}>
      <div style={{width:220,background:props.darkMode?'#0f172a':'#f8f9fa',padding:'28px 20px',flexShrink:0}}>
        {props.photo?.dataUrl && (
          <div style={{textAlign:'center',marginBottom:16}}>
            <img src={props.photo.dataUrl} style={{width:80*fs,height:80*fs,objectFit:'cover',margin:'0 auto',display:'block',
              borderRadius:props.photo.shape==='circle'?'50%':props.photo.shape==='rounded'?10:4}} />
          </div>
        )}
        <div style={{fontSize:10*fs,color:dmSubTextColor(props.darkMode),fontFamily:props.fontFamily,marginBottom:20}}>
          {[p.email,p.phone,p.location,p.website,p.linkedin].filter(Boolean).map((c: string,i: number) => <div key={i} style={{marginBottom:4,wordBreak:'break-all'}}>{c}</div>)}
        </div>
        {sidebar.map((k: string) => renderSection(k, props))}
      </div>
      <div style={{flex:1,padding:'28px 28px'}}>
        <div style={{marginBottom:12}}>
          {fullName && <div style={{fontSize:24*fs,fontWeight:700,fontFamily:props.fontFamily,color:dmTextColor(props.darkMode)}}>{fullName}</div>}
          {p.title && <div style={{fontSize:13*fs,color:props.accentColor,fontFamily:props.fontFamily,fontWeight:500}}>{p.title}</div>}
        </div>
        {main.map((k: string) => renderSection(k, props))}
      </div>
    </div>
  );
};

const TemplateExecutive = (props: any) => {
  const ff = props.fontFamily === 'Inter' ? 'Merriweather' : props.fontFamily;
  const eProps = { ...props, fontFamily: ff };
  return (
    <div style={{padding:'44px 40px',lineHeight:tls(props.lineSpacing)}}>
      <ResumeHeader {...eProps} />
      <div style={{borderTop:`1px solid ${props.accentColor}`,borderBottom:`1px solid ${props.accentColor}`,height:0,marginBottom:8}} />
      {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => renderSection(k, eProps))}
    </div>
  );
};

const TemplateATS = (props: any) => {
  const fs = tfs(props.fontSize);
  const p = props.sections.personal.data;
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const contacts = [p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean);
  return (
    <div style={{padding:'36px 40px',fontFamily:'Arial, sans-serif',lineHeight:tls(props.lineSpacing)}}>
      {fullName && <div style={{fontSize:22*fs,fontWeight:700,color:dmTextColor(props.darkMode, '#000'),marginBottom:2}}>{fullName}</div>}
      {p.title && <div style={{fontSize:13*fs,color:dmSubTextColor(props.darkMode, '#333'),marginBottom:4}}>{p.title}</div>}
      {contacts.length > 0 && <div style={{fontSize:10*fs,color:dmSubTextColor(props.darkMode, '#555'),marginBottom:12}}>{contacts.join(' | ')}</div>}
      <hr style={{border:'none',borderTop:props.darkMode?'1px solid #334155':'1px solid #ccc',marginBottom:12}} />
      {props.sectionOrder.filter((k: string) => k!=='personal').map((k: string) => {
        const sec = props.sections[k];
        if (!sec?.enabled) return null;
        return renderSection(k, {...props, accentColor:props.darkMode?'#e2e8f0':'#000'});
      })}
    </div>
  );
};

const TEMPLATES: Record<string, { name: string; component: React.ComponentType<any>; ats: boolean; desc: string; color: string }> = {
  classic:      { name:'Classic',       component:TemplateClassic,     ats:true,  desc:'Traditional single-column',    color:'#475569' },
  modern:       { name:'Modern',        component:TemplateModern,      ats:true,  desc:'Clean with accent sidebar',    color:'#2563eb' },
  minimal:      { name:'Minimal',       component:TemplateMinimal,     ats:true,  desc:'Ultra-clean, whitespace',      color:'#94a3b8' },
  professional: { name:'Professional',  component:ProfessionalWrapper, ats:true,  desc:'Bold color header',            color:'#7c3aed' },
  creative:     { name:'Creative',      component:TemplateCreative,    ats:false, desc:'Gradient header, bold',        color:'#ea580c' },
  twocolumn:    { name:'Two-Column',    component:TemplateTwoColumn,   ats:false, desc:'Sidebar + main content',       color:'#059669' },
  executive:    { name:'Executive',     component:TemplateExecutive,   ats:true,  desc:'Serif, elegant borders',       color:'#ca8a04' },
  ats:          { name:'ATS Optimized', component:TemplateATS,         ats:true,  desc:'Maximum ATS compat',           color:'#0f172a' },
};

// ── Template Thumbnails ───────────────────────────────────────────────────────
const TemplateThumbnail = ({ templateKey, tpl, isActive, onClick }: any) => {
  const c = tpl.color;
  const sketches: Record<string, React.ReactNode> = {
    classic: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="12" y="6" width="36" height="4" rx="1" fill={c} opacity="0.8"/>
        <rect x="18" y="12" width="24" height="2" rx="1" fill="#999" opacity="0.5"/>
        <rect x="8" y="20" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="25" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="8" y="29" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="36" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="41" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="8" y="45" width="30" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="52" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="57" width="20" height="6" rx="2" fill={c} opacity="0.15"/>
        <rect x="30" y="57" width="20" height="6" rx="2" fill={c} opacity="0.15"/>
      </svg>
    ),
    modern: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="0" y="0" width="3" height="84" fill={c}/>
        <rect x="10" y="8" width="30" height="4" rx="1" fill={c} opacity="0.8"/>
        <rect x="10" y="14" width="20" height="2" rx="1" fill="#999" opacity="0.5"/>
        <rect x="10" y="22" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="10" y="27" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="10" y="31" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="10" y="38" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="10" y="43" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
      </svg>
    ),
    minimal: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="14" y="10" width="32" height="3" rx="1" fill="#333" opacity="0.6"/>
        <rect x="20" y="15" width="20" height="2" rx="1" fill="#999" opacity="0.4"/>
        <rect x="8" y="22" width="44" height="0.5" fill="#ccc"/>
        <rect x="8" y="28" width="44" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="32" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="40" width="20" height="1" fill="#333" opacity="0.3"/>
        <rect x="8" y="44" width="44" height="2" rx="1" fill="#bbb" opacity="0.3"/>
      </svg>
    ),
    professional: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="4" y="4" width="52" height="18" rx="2" fill={c} opacity="0.85"/>
        <rect x="10" y="8" width="28" height="3" rx="1" fill="white" opacity="0.9"/>
        <rect x="10" y="13" width="18" height="2" rx="1" fill="white" opacity="0.6"/>
        <rect x="8" y="28" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="33" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="8" y="37" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
      </svg>
    ),
    creative: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={c}/><stop offset="100%" stopColor={c} stopOpacity="0.7"/></linearGradient></defs>
        <rect x="0" y="0" width="60" height="24" fill="url(#cg)"/>
        <rect x="8" y="6" width="30" height="4" rx="1" fill="white" opacity="0.9"/>
        <rect x="8" y="12" width="20" height="2" rx="1" fill="white" opacity="0.6"/>
        <rect x="8" y="30" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="35" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
      </svg>
    ),
    twocolumn: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="0" y="0" width="20" height="84" fill="#f0f0f0"/>
        <circle cx="10" cy="12" r="5" fill="#ddd"/>
        <rect x="4" y="22" width="12" height="1.5" rx="0.5" fill="#bbb" opacity="0.5"/>
        <rect x="4" y="26" width="12" height="1.5" rx="0.5" fill="#bbb" opacity="0.4"/>
        <rect x="4" y="34" width="12" height="1" fill={c} opacity="0.4"/>
        <rect x="4" y="38" width="10" height="4" rx="1" fill={c} opacity="0.15"/>
        <rect x="24" y="6" width="30" height="4" rx="1" fill={c} opacity="0.8"/>
        <rect x="24" y="12" width="20" height="2" rx="1" fill="#999" opacity="0.5"/>
        <rect x="24" y="20" width="32" height="1" fill={c} opacity="0.3"/>
        <rect x="24" y="25" width="32" height="2" rx="1" fill="#bbb" opacity="0.4"/>
      </svg>
    ),
    executive: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="10" y="8" width="40" height="4" rx="1" fill={c} opacity="0.7"/>
        <rect x="16" y="14" width="28" height="2" rx="1" fill="#999" opacity="0.5"/>
        <rect x="8" y="20" width="44" height="0.5" fill={c}/>
        <rect x="8" y="21" width="44" height="0.5" fill={c}/>
        <rect x="8" y="28" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="8" y="32" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="40" width="44" height="1" fill={c} opacity="0.3"/>
        <rect x="8" y="45" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
      </svg>
    ),
    ats: (
      <svg viewBox="0 0 60 84" style={{width:'100%',height:'100%'}}>
        <rect x="8" y="8" width="36" height="4" rx="1" fill="#000" opacity="0.7"/>
        <rect x="8" y="14" width="24" height="2" rx="1" fill="#666" opacity="0.5"/>
        <rect x="8" y="18" width="44" height="2" rx="1" fill="#999" opacity="0.3"/>
        <rect x="8" y="24" width="44" height="0.5" fill="#ccc"/>
        <rect x="8" y="30" width="20" height="2" rx="1" fill="#000" opacity="0.5"/>
        <rect x="8" y="34" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
        <rect x="8" y="38" width="38" height="2" rx="1" fill="#bbb" opacity="0.3"/>
        <rect x="8" y="46" width="20" height="2" rx="1" fill="#000" opacity="0.5"/>
        <rect x="8" y="50" width="44" height="2" rx="1" fill="#bbb" opacity="0.4"/>
      </svg>
    ),
  };
  return (
    <div className={`template-card ${isActive?'active':''}`} onClick={onClick}>
      {tpl.ats && <span className="ats-badge">ATS</span>}
      <div className="tpl-preview" style={{background:'white'}}>
        {sketches[templateKey] || sketches.classic}
      </div>
      <div className="tpl-name">{tpl.name}</div>
    </div>
  );
};

// ── Preview Panel ─────────────────────────────────────────────────────────────
const PreviewPanel = ({ resume, previewRef }: any) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth - 32;
      setScale(Math.min(w / 794, 0.75));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const Template = TEMPLATES[resume.template]?.component || TemplateModern;
  const templateProps = {
    sections: resume.sections,
    sectionOrder: resume.sectionOrder,
    accentColor: resume.accentColor,
    fontFamily: resume.fontFamily,
    fontSize: resume.fontSize,
    lineSpacing: resume.lineSpacing,
    photo: resume.photo,
    darkMode: resume.darkMode,
  };

  return (
    <div ref={containerRef} style={{display:'flex',justifyContent:'center',paddingTop:16}}>
      <div className="preview-scale-wrapper" style={{transform:`scale(${scale})`,transformOrigin:'top center'}}>
        <div ref={previewRef} id="resume-print" className={`a4-page ${resume.darkMode?'dark-mode':''}`}>
          <Template {...templateProps} />
        </div>
      </div>
    </div>
  );
};

// ── Export Functions ───────────────────────────────────────────────────────────
// ── PDF exporter: html2canvas renders the styled preview, DOM positions drive clean cuts ──
async function exportPDF(
  previewRef: React.RefObject<HTMLDivElement | null>,
  _resume: any,
  docName: string
): Promise<void> {
  if (!previewRef.current) return;
  const el = previewRef.current;

  const PAGE_W_PX = 794;
  const PAGE_H_PX = Math.round(PAGE_W_PX * 297 / 210); // 1122
  const SCALE = 2;
  const PAGE_H_C = PAGE_H_PX * SCALE; // canvas pixels per page height
  const GUARD_C = 100 * SCALE; // guard zone: if section starts within this many canvas-px of a cut, move cut up

  // Measure section Y positions relative to el in canvas-pixel space.
  // Using getBoundingClientRect: both el and children share the same scroll ancestry,
  // so scroll cancels out and the difference is stable.
  const elRect = el.getBoundingClientRect();
  const sectionTopsC = Array.from(el.querySelectorAll('[data-rb-section]'))
    .map(s => ((s as HTMLElement).getBoundingClientRect().top - elRect.top) * SCALE)
    .filter(y => y >= 0)
    .sort((a, b) => a - b);

  const canvas = await html2canvas(el as HTMLElement, {
    scale: SCALE, useCORS: true, logging: false,
    width: PAGE_W_PX, scrollX: 0, scrollY: 0,
    onclone: (doc: Document) => {
      const cloned = doc.getElementById('resume-print');
      if (!cloned) return;
      doc.querySelectorAll('style').forEach(s => s.remove());
      const s = doc.createElement('style');
      s.textContent = '*{margin:0;padding:0;box-sizing:border-box;}';
      doc.head.appendChild(s);
      let node: HTMLElement | null = cloned.parentElement;
      while (node && node !== doc.body) {
        Object.assign(node.style, {
          transform:'none', position:'static', overflow:'visible',
          maxHeight:'none', display:'block', justifyContent:'',
          alignItems:'', padding:'0', margin:'0'
        });
        node = node.parentElement;
      }
      doc.body.style.cssText = 'margin:0;padding:0;overflow:hidden';
      Object.assign(cloned.style, {
        width:`${PAGE_W_PX}px`, height:'auto', minHeight:'auto',
        overflow:'visible', boxShadow:'none', transform:'none'
      });
    }
  });

  // Top margin added above content on continuation pages (white breathing room)
  const TOP_MARGIN = 30; // CSS px
  const TOP_MARGIN_C = TOP_MARGIN * SCALE; // canvas px

  // Build page cut positions in canvas pixels.
  // Page 1: full PAGE_H_C available. Continuation pages: PAGE_H_C - TOP_MARGIN_C usable
  // (the top margin takes the rest). Guard zone moves cuts above section headings.
  const pageCuts: number[] = [];
  let cutY = PAGE_H_C;
  while (cutY < canvas.height) {
    let adjusted = cutY;
    for (const secY of sectionTopsC) {
      if (secY > cutY - GUARD_C && secY <= cutY) {
        adjusted = secY - 8 * SCALE; // land 8 CSS-px above the section top
        break;
      }
    }
    pageCuts.push(adjusted);
    cutY = adjusted + PAGE_H_C - TOP_MARGIN_C; // continuation pages have less usable height
  }

  const pdf = new jsPDF({ unit:'px', format:'a4', orientation:'portrait', hotfixes:['px_scaling'] } as any);
  const pdfW = pdf.internal.pageSize.getWidth();
  const starts = [0, ...pageCuts];
  const ends   = [...pageCuts, canvas.height];

  for (let i = 0; i < starts.length; i++) {
    const sy = starts[i], h = ends[i] - sy;
    const topPad = i === 0 ? 0 : TOP_MARGIN_C;
    const pg = document.createElement('canvas');
    pg.width = PAGE_W_PX * SCALE; pg.height = h + topPad;
    const ctx = pg.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pg.width, pg.height);
    ctx.drawImage(canvas, 0, sy, pg.width, h, 0, topPad, pg.width, h);
    if (i > 0) pdf.addPage();
    pdf.addImage(pg.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, pdfW, ((h + topPad) / SCALE) * (pdfW / PAGE_W_PX));
  }

  pdf.save(`${(docName || 'resume').replace(/[^a-zA-Z0-9 ]/g, '_')}.pdf`);
}

function printResume(previewRef: React.RefObject<HTMLDivElement | null>) {
  if (!previewRef.current) return;
  const w = window.open('', '_blank');
  if (!w) return;
  const html = previewRef.current.outerHTML;
  w.document.write('<!DOCTYPE html><html><head>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700&display=swap" rel="stylesheet">' +
    '<style>@page{size:A4;margin:0}' +
    'body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}' +
    '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}' +
    '.a4-page{width:210mm;min-height:auto;background:white;color:#1a1a1a;overflow:visible;box-shadow:none}' +
    '.a4-page.dark-mode{background:#1a1a2e;color:#e2e8f0}</style>' +
    '</head><body>' + html + '</body></html>');
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); w.close(); }, 600);
}

function exportJSON(resume: any) {
  const blob = new Blob([JSON.stringify(resume, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${resume.name || 'resume'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse((e.target as FileReader).result as string);
        data.id = uid();
        data.updatedAt = new Date().toISOString();
        resolve(data);
      } catch { reject(new Error('Invalid JSON')); }
    };
    reader.readAsText(file);
  });
}

function buildPlainText(resume: any): string {
  const lines: string[] = [];
  const { sections, sectionOrder } = resume;
  const p = sections.personal?.data || {};
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (fullName) lines.push(fullName);
  if (p.title) lines.push(p.title);
  const contacts = [p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean);
  if (contacts.length) lines.push(contacts.join(' | '));
  lines.push('');
  const hr = () => lines.push('─'.repeat(60));
  for (const key of sectionOrder) {
    if (key === 'personal') continue;
    const sec = sections[key];
    if (!sec?.enabled) continue;
    if (key === 'summary') {
      if (!sec.data?.text) continue;
      lines.push(sec.heading || 'PROFESSIONAL SUMMARY'); hr(); lines.push(sec.data.text); lines.push(''); continue;
    }
    if (key === 'skills') {
      const named = sec.items?.filter((s: any) => s.name);
      if (!named?.length) continue;
      lines.push(sec.heading || 'SKILLS'); hr(); lines.push(named.map((s: any) => s.name).join(', ')); lines.push(''); continue;
    }
    if (key === 'experience') {
      const filled = sec.items?.filter((i: any) => i.title || i.company);
      if (!filled?.length) continue;
      lines.push(sec.heading || 'WORK EXPERIENCE'); hr();
      for (const i of filled) {
        const titleLine = [i.title, i.company].filter(Boolean).join(' at ');
        const dateLine = i.current ? `${i.startDate} — Present` : [i.startDate, i.endDate].filter(Boolean).join(' — ');
        lines.push([titleLine, dateLine].filter(Boolean).join('  |  '));
        if (i.location) lines.push(i.location);
        for (const b of (i.bullets || []).filter(Boolean)) lines.push('• ' + b);
        lines.push('');
      }
      continue;
    }
    if (key === 'education') {
      const filled = sec.items?.filter((i: any) => i.school || i.degree);
      if (!filled?.length) continue;
      lines.push(sec.heading || 'EDUCATION'); hr();
      for (const i of filled) {
        const degLine = [i.degree, i.field ? `in ${i.field}` : ''].filter(Boolean).join(' ');
        const dateStr = [i.startDate, i.endDate].filter(Boolean).join(' — ');
        lines.push([degLine, dateStr].filter(Boolean).join('  |  '));
        if (i.school) lines.push(i.school);
        if (i.gpa) lines.push(`GPA: ${i.gpa}`);
        for (const b of (i.bullets || []).filter(Boolean)) lines.push('• ' + b);
        lines.push('');
      }
      continue;
    }
    if (key === 'certifications') {
      const filled = sec.items?.filter((i: any) => i.name);
      if (!filled?.length) continue;
      lines.push(sec.heading || 'CERTIFICATIONS'); hr();
      for (const i of filled) lines.push([i.name, i.issuer, i.date].filter(Boolean).join(' — '));
      lines.push(''); continue;
    }
    if (key === 'languages') {
      const filled = sec.items?.filter((i: any) => i.name);
      if (!filled?.length) continue;
      lines.push(sec.heading || 'LANGUAGES'); hr();
      lines.push(filled.map((i: any) => `${i.name} (${i.proficiency})`).join(', '));
      lines.push(''); continue;
    }
    if (key === 'projects') {
      const filled = sec.items?.filter((i: any) => i.name);
      if (!filled?.length) continue;
      lines.push(sec.heading || 'PROJECTS'); hr();
      for (const i of filled) {
        lines.push(i.name + (i.url ? `  |  ${i.url}` : ''));
        if (i.technologies) lines.push('Tech: ' + i.technologies);
        if (i.description) lines.push(i.description);
        for (const b of (i.bullets || []).filter(Boolean)) lines.push('• ' + b);
        lines.push('');
      }
      continue;
    }
    const filled = sec.items?.filter((i: any) => i.title || i.name);
    if (!filled?.length) continue;
    lines.push((sec.heading || key).toUpperCase()); hr();
    for (const i of filled) {
      const main = i.title || i.name || '';
      const sub = [i.subtitle, i.description].filter(Boolean).join(' — ');
      lines.push([main, sub].filter(Boolean).join(': '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function copyAsText(resume: any): Promise<boolean> {
  const text = buildPlainText(resume);
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => { fallbackCopy(text); return true; });
  }
  fallbackCopy(text);
  return Promise.resolve(true);
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ResumeBuilder() {
  const [resumes, setResumes] = useState<any[]>(() => {
    const loaded = loadResumes();
    return loaded.length > 0 ? loaded : [makeDefault()];
  });
  const [activeId, setActiveIdState] = useState<string>(() => {
    const saved = getActiveId();
    const loaded = loadResumes();
    if (saved && loaded.find((r: any) => r.id === saved)) return saved;
    return loaded[0]?.id || '';
  });
  const activeResume = resumes.find(r => r.id === activeId) || resumes[0];
  const [resume, dispatch] = useReducer(resumeReducer, activeResume);
  const previewRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const dragHandleActiveRef = useRef(false);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setResumes(prev => {
        const next = prev.map(r => r.id === resume.id ? resume : r);
        saveResumes(next);
        return next;
      });
    }, 500);
  }, [resume]);

  const switchResume = (id: string) => {
    const r = resumes.find(r => r.id === id);
    if (r) { dispatch({ type:'SET_RESUME', resume:r }); setActiveIdState(id); setActiveId(id); }
  };

  const createResume = () => {
    const r = makeDefault();
    setResumes(prev => { const next = [...prev, r]; saveResumes(next); return next; });
    dispatch({ type:'SET_RESUME', resume:r });
    setActiveIdState(r.id);
    setActiveId(r.id);
  };

  const duplicateResume = () => {
    const r = { ...JSON.parse(JSON.stringify(resume)), id:uid(), name:resume.name+' (Copy)', createdAt:new Date().toISOString() };
    setResumes(prev => { const next = [...prev, r]; saveResumes(next); return next; });
    dispatch({ type:'SET_RESUME', resume:r });
    setActiveIdState(r.id);
    setActiveId(r.id);
  };

  const deleteResume = () => {
    if (resumes.length <= 1) return;
    const next = resumes.filter(r => r.id !== resume.id);
    saveResumes(next);
    setResumes(next);
    dispatch({ type:'SET_RESUME', resume:next[0] });
    setActiveIdState(next[0].id);
    setActiveId(next[0].id);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await importJSON(file);
      setResumes(prev => { const next = [...prev, r]; saveResumes(next); return next; });
      dispatch({ type:'SET_RESUME', resume:r });
      setActiveIdState(r.id);
      setActiveId(r.id);
      showToast('Resume imported!');
    } catch { showToast('Invalid file', true); }
    e.target.value = '';
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try { await exportPDF(previewRef, resume, resume.name); showToast('PDF downloaded!'); }
    catch(e) { console.error('PDF export error:', e); showToast('PDF export failed', true); }
    finally { setExporting(false); }
  };

  const handleCopyText = async () => {
    try { await copyAsText(resume); showToast('Copied as plain text (ATS-friendly)!'); }
    catch { showToast('Copy failed', true); }
  };

  const handleClearAll = () => {
    if (!window.confirm('Clear all resume data? This cannot be undone.')) return;
    const fresh = makeDefault();
    fresh.id = resume.id;
    fresh.name = resume.name;
    dispatch({ type:'SET_RESUME', resume:fresh });
    showToast('Resume cleared.');
  };

  const showToast = (msg: string, err = false) => { setToast({msg,err}); setTimeout(() => setToast(null), 3000); };

  const { dragIdx: secDragIdx, onDragStart: secDragStart, onDragOver: secDragOver, onDragEnd: secDragEnd } =
    useDragReorder(resume.sectionOrder, (order: string[]) => dispatch({ type:'REORDER_SECTIONS', order }));

  const disabledSections = Object.keys(SECTION_META).filter(k => !resume.sections[k]?.enabled);

  const handleSectionDragStart = (e: React.DragEvent, idx: number) => {
    if (!dragHandleActiveRef.current) { e.preventDefault(); return; }
    secDragStart(e, idx);
  };
  const handleDragHandleMouseDown = () => { dragHandleActiveRef.current = true; };
  const handleSectionDragEnd = () => { dragHandleActiveRef.current = false; secDragEnd(); };

  useEffect(() => {
    const reset = () => { dragHandleActiveRef.current = false; };
    window.addEventListener('mouseup', reset);
    return () => window.removeEventListener('mouseup', reset);
  }, []);

  return (
    <PageLayout
      title="Resume Builder | TrueBeast Tools"
      description="Free resume builder with 8 professional templates, live preview, PDF export, and ATS optimization."
      showFooter={false}
    >
      {/* Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700&family=Roboto:wght@300;400;500;700&family=Lato:wght@300;400;700&family=Open+Sans:wght@300;400;600;700&family=Playfair+Display:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;600;700&family=Raleway:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Scoped styles */}
      <style>{RESUME_CSS}</style>

      {/* Degree datalist */}
      <datalist id="degree-list">
        <option value="High School Diploma" /><option value="Associate's Degree" />
        <option value="Bachelor of Arts (B.A.)" /><option value="Bachelor of Science (B.S.)" />
        <option value="Bachelor of Fine Arts (B.F.A.)" /><option value="Bachelor of Business Administration (B.B.A.)" />
        <option value="Master of Arts (M.A.)" /><option value="Master of Science (M.S.)" />
        <option value="Master of Business Administration (M.B.A.)" /><option value="Doctor of Philosophy (Ph.D.)" />
        <option value="Doctor of Medicine (M.D.)" /><option value="Juris Doctor (J.D.)" />
        <option value="Doctor of Education (Ed.D.)" /><option value="GED" />
      </datalist>

      <div className="rb-scope">
        {/* Back to Tools */}
        <div className="max-w-7xl mx-auto px-4 mb-3 no-print">
          <Link to="/tools" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
            <ArrowLeft size={14} />
            Back to Tools
          </Link>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{position:'fixed',top:90,left:'50%',transform:'translateX(-50%)',zIndex:1000,
            background:toast.err?'#ef4444':'#22c55e',color:'white',padding:'8px 20px',borderRadius:10,fontWeight:600,fontSize:'.85rem',
            boxShadow:'0 4px 12px rgba(0,0,0,0.3)'}}>{toast.msg}</div>
        )}

        {/* Top Bar */}
        <div className="max-w-7xl mx-auto px-4 mb-4 no-print">
          <div className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-3">
              <select className="inp" style={{maxWidth:200}} value={resume.id} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => switchResume(e.target.value)}>
                {resumes.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input className="inp" style={{maxWidth:180}} value={resume.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type:'SET_FIELD', path:'name', value:e.target.value })} placeholder="Resume name" />
              <button className="ghost-btn" onClick={createResume}>+ New</button>
              <button className="ghost-btn" onClick={duplicateResume}>Duplicate</button>
              {resumes.length > 1 && <button className="ghost-btn" style={{color:'#ef4444',borderColor:'rgba(239,68,68,0.3)'}} onClick={deleteResume}>Delete</button>}
              <div style={{flex:1}} />
              <button className="ghost-btn" onClick={() => setTemplatePanelOpen(!templatePanelOpen)}
                style={{display:'inline-flex',alignItems:'center',gap:6}}>
                <span style={{width:12,height:12,borderRadius:3,background:TEMPLATES[resume.template]?.color||'#2563eb',display:'inline-block'}}></span>
                {TEMPLATES[resume.template]?.name || 'Template'}
                <span style={{fontSize:'.7rem',opacity:.6}}>{templatePanelOpen ? '▲' : '▼'}</span>
              </button>
              <select className="inp" style={{maxWidth:140}} value={resume.fontFamily} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => dispatch({ type:'SET_FONT', value:e.target.value })}>
                {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <div className="flex items-center gap-1 flex-wrap">
                {ACCENT_COLORS.map(c => (
                  <div key={c} className={`color-swatch ${resume.accentColor===c?'active':''}`}
                    style={{background:c}} onClick={() => dispatch({ type:'SET_ACCENT', value:c })} />
                ))}
                <div style={{position:'relative'}}>
                  <div className="color-swatch" style={{background:`conic-gradient(red,yellow,lime,aqua,blue,magenta,red)`}}
                    onClick={() => (document.getElementById('custom-color') as HTMLInputElement)?.click()} />
                  <input type="color" id="custom-color" value={resume.accentColor}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type:'SET_ACCENT', value:e.target.value })} />
                </div>
              </div>
              <button className={`dark-toggle-btn ${resume.darkMode?'active':''}`}
                onClick={() => dispatch({ type:'TOGGLE_DARK_MODE' })}
                title={resume.darkMode ? 'Switch to light PDF' : 'Switch to dark PDF'}>
                {resume.darkMode ? '🌜' : '🌞'} {resume.darkMode ? 'Dark' : 'Light'}
              </button>
            </div>

            {/* Template Grid */}
            {templatePanelOpen && (
              <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--c-border)'}}>
                <div className="template-grid">
                  {Object.entries(TEMPLATES).map(([k, tpl]) => (
                    <TemplateThumbnail key={k} templateKey={k} tpl={tpl}
                      isActive={resume.template===k}
                      onClick={() => { dispatch({ type:'SET_TEMPLATE', value:k }); setTemplatePanelOpen(false); }} />
                  ))}
                </div>
              </div>
            )}

            {/* Export Row */}
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button className="primary-btn" onClick={handleExportPDF} disabled={exporting}>
                {exporting ? 'Generating...' : 'Download PDF'}
              </button>
              <button className="ghost-btn" onClick={handleCopyText} title="Copy ATS-friendly plain text to clipboard">Copy as Text</button>
              <button className="ghost-btn" onClick={() => exportJSON(resume)}>Export JSON</button>
              <label className="ghost-btn" style={{cursor:'pointer'}}>
                Import JSON
                <input type="file" accept=".json" onChange={handleImport} style={{display:'none'}} />
              </label>
              <button className="ghost-btn" onClick={() => printResume(previewRef)}>Print</button>
              <button className="ghost-btn" style={{color:'#ef4444',borderColor:'rgba(239,68,68,0.3)'}} onClick={handleClearAll}>Clear All</button>
              <span style={{fontSize:'.75rem',color:'var(--c-text-muted)',maxWidth:180,lineHeight:1.3}}>
                Export JSON to save your progress and edit later
              </span>
              <div className="flex md:hidden items-center gap-2 ml-auto">
                <button className={`mobile-tab ${mobileView==='edit'?'active':''}`} onClick={() => setMobileView('edit')}>Edit</button>
                <button className={`mobile-tab ${mobileView==='preview'?'active':''}`} onClick={() => setMobileView('preview')}>Preview</button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="max-w-7xl mx-auto px-4 pb-20 no-print">
          <div className="flex gap-4" style={{alignItems:'flex-start'}}>
            {/* Editor Panel */}
            <div className={`flex-1 min-w-0 ${mobileView==='preview'?'hidden md:block':''}`} style={{maxWidth:560}}>
              {resume.sectionOrder.map((key: string, idx: number) => {
                if (!resume.sections[key]?.enabled) return null;
                const Editor = SECTION_EDITORS[key];
                if (!Editor) return null;
                const meta = SECTION_META[key];
                const editorProps = key === 'personal'
                  ? { data:resume.sections.personal.data, photo:resume.photo, dispatch }
                  : { data:resume.sections[key], dispatch };
                return (
                  <div key={key} className={`section-card ${secDragIdx===idx?'dragging':''}`}
                    draggable={true}
                    onDragStart={(e: React.DragEvent) => handleSectionDragStart(e, idx)}
                    onDragOver={(e: React.DragEvent) => secDragOver(e, idx)}
                    onDragEnd={handleSectionDragEnd}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="drag-handle" onMouseDown={handleDragHandleMouseDown} title="Drag to reorder">⠇</span>
                      <span style={{fontSize:'1.1rem'}}>{meta.icon}</span>
                      <span style={{fontWeight:700,color:'var(--c-text-strong)',fontSize:'1.05rem',flex:1}}>{meta.label}</span>
                      {key !== 'personal' && (
                        <button className="pill-btn danger" onClick={() => dispatch({ type:'TOGGLE_SECTION', section:key })}>Hide</button>
                      )}
                    </div>
                    <Editor {...editorProps} />
                  </div>
                );
              })}

              {disabledSections.length > 0 && (
                <div className="section-card">
                  <div style={{color:'var(--c-text-label)',fontSize:'.95rem',fontWeight:600,marginBottom:8}}>Add Section</div>
                  <div className="flex flex-wrap gap-2">
                    {disabledSections.map(k => (
                      <button key={k} className="pill-btn" onClick={() => dispatch({ type:'TOGGLE_SECTION', section:k })}>
                        {SECTION_META[k].icon} {SECTION_META[k].label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Preview Panel */}
            <div className={`preview-panel flex-1 min-w-0 ${mobileView==='edit'?'hidden md:block':''}`}
              style={{position:'sticky',top:100,maxHeight:'calc(100vh - 120px)',overflow:'auto'}}>
              <PreviewPanel resume={resume} previewRef={previewRef} />
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
