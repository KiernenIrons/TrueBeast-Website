import { useEffect, useRef, useState } from 'react';
import { formatMinute, type GridLayout } from './lib';

// ---------------------------------------------------------------------------
// Styles (scoped, with light-mode overrides)
// ---------------------------------------------------------------------------

export const MEET_CSS = `
.meet { --cell: rgba(255,255,255,0.035); --line: rgba(255,255,255,0.10); --line-soft: rgba(255,255,255,0.05);
        --on: 34,197,94; --off: rgba(251,113,133,0.30); --no: 239,68,68; --muted: rgba(255,255,255,0.45); }
html.light .meet { --cell: rgba(0,0,0,0.035); --line: rgba(0,0,0,0.14); --line-soft: rgba(0,0,0,0.06); --muted: rgba(0,0,0,0.5); --off: #ffdede; }
.meet-grid { display: flex; user-select: none; -webkit-user-select: none; --row: 16px; }
.meet-times { flex: none; padding-right: 10px; }
.meet-time { height: var(--row); position: relative; min-width: 58px; }
.meet-time span { position: absolute; right: 0; top: -7px; font-size: 12px; line-height: 14px; color: var(--muted); white-space: nowrap; }
.meet-col { flex: 1 1 0; min-width: 44px; }
.meet-col.gap { margin-left: 14px; }
.meet-head { height: 46px; text-align: center; font-size: 12.5px; line-height: 1.3; color: var(--muted); white-space: nowrap; }
.meet-head b { display: block; font-size: 14.5px; font-weight: 600; color: inherit; opacity: .95; }
.meet-cells { background: var(--cell); border-left: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
.meet-col + .meet-col:not(.gap) .meet-cells { border-left: 1px solid rgba(0,0,0,.35); }
.meet-cell { height: var(--row); background: var(--cell); border-top: 1px dotted var(--line-soft); transition: background-color .08s; }
.meet-cell.hour { border-top: 1px solid var(--line); }
.meet-cell.none { background: repeating-linear-gradient(45deg, transparent 0 3px, var(--line-soft) 3px 4px); }
.meet-cell.filled { border-top-color: rgba(0,0,0,.16); }
.meet-cell.filled.hour { border-top-color: rgba(0,0,0,.42); }
.meet-cell.filled.half { border-top-style: dashed; border-top-color: rgba(0,0,0,.26); }
.meet-cell.cant { background-image: repeating-linear-gradient(135deg, rgba(0,0,0,.22) 0 3px, transparent 3px 7px) !important; }
.meet-cell.veto { box-shadow: inset 4px 0 0 rgb(var(--no)); }
.meet-cell.hover { outline: 2px solid #fff; outline-offset: -2px; }
html.light .meet-cell.hover { outline-color: #111; }
.meet-paint .meet-cells { cursor: pointer; touch-action: none; }
.meet-legend { height: 10px; border-radius: 4px; background: linear-gradient(90deg, var(--cell), rgb(var(--on))); border: 1px solid var(--line); }
.meet-swatch.cant { background: rgb(var(--no)) repeating-linear-gradient(135deg, rgba(0,0,0,.22) 0 3px, transparent 3px 7px); }
.meet-swatch.veto { box-shadow: inset 3px 0 0 rgb(var(--no)); }
.meet-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--line); display: inline-block; vertical-align: -2px; }
.meet-cal-day { height: clamp(44px, 7vw, 64px); border-radius: 10px; font-size: 16px; display: flex; align-items: center; justify-content: center;
                cursor: pointer; background: var(--cell); transition: background-color .08s, color .08s; }
.meet-cal-day.out { opacity: .35; }
.meet-cal-day.on { background: rgb(var(--on)); color: #04120a; font-weight: 600; }
.meet-cal-day.today { box-shadow: inset 0 0 0 1px rgba(var(--on), .8); }
.meet-input { width: 100%; background: var(--cell); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
              font-size: 16px; outline: none; color: inherit; }
.meet-input:focus { border-color: rgba(var(--on), .7); }
.meet select.meet-input option { background: #111; color: #fff; }
html.light .meet select.meet-input option { background: #fff; color: #111; }
.meet-btn { background: rgb(var(--on)); color: #04120a; font-weight: 600; border-radius: 12px; padding: 13px 20px; font-size: 16px;
            transition: filter .15s, opacity .15s; }
.meet-btn:hover { filter: brightness(1.08); }
.meet-btn:disabled { opacity: .5; cursor: default; }
.meet-ghost { border: 1px solid var(--line); border-radius: 12px; padding: 9px 14px; font-size: 14.5px; color: inherit; opacity: .85; transition: background-color .15s; }
.meet-ghost:hover { background: var(--cell); opacity: 1; }
.meet-muted { color: var(--muted); }
@media (max-width: 640px) {
  .meet-col { min-width: 32px; }
  .meet-col.gap { margin-left: 8px; }
  .meet-time { min-width: 48px; }
  .meet-time span { font-size: 11px; }
  .meet-times { padding-right: 6px; }
  .meet-head { font-size: 11px; }
  .meet-head b { font-size: 13px; }
}
.meet-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.meet-seg button { padding: 9px 14px; font-size: 14.5px; display: inline-flex; align-items: center; gap: 8px; color: var(--muted); transition: background-color .15s, color .15s; }
.meet-seg button[aria-checked="true"] { background: var(--cell); color: inherit; box-shadow: inset 0 -2px 0 rgb(var(--on)); }
.meet-seg button:hover { color: inherit; }
.meet-panel { border-radius: 20px; padding: clamp(16px, 2vw, 28px); }
`;

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface Props {
  layout: GridLayout;
  /** Background for a cell (slot is null for cells outside the event). */
  cellStyle: (slot: number, col: number, row: number) => string | undefined;
  /** Extra classes for a cell ('cant' = striped, 'veto' = red accent bar). */
  cellClass?: (slot: number, col: number, row: number) => string | undefined;
  /** Paint mode: pointer drags select a rectangle. */
  paint?: boolean;
  onDragStart?: (col: number, row: number) => void;
  onDragMove?: (col: number, row: number) => void;
  onDragEnd?: () => void;
  /** Hover mode (group grid). */
  hoverSlot?: number | null;
  onHover?: (slot: number | null) => void;
}

/** Rows grow to fill the window (bigger targets on touch screens). */
function useRowHeight(rows: number) {
  const calc = () => {
    if (typeof window === 'undefined') return 16;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const avail = window.innerHeight - (touch ? 240 : 360);
    return Math.round(Math.max(touch ? 22 : 15, Math.min(30, avail / Math.max(rows, 1))));
  };
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [rows]);
  return h;
}

function cellAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest<HTMLElement>('[data-c]');
  if (!cell) return null;
  return { col: Number(cell.dataset.c), row: Number(cell.dataset.r) };
}

export default function TimeGrid({ layout, cellStyle, cellClass, paint, onDragStart, onDragMove, onDragEnd, hoverSlot, onHover }: Props) {
  const dragging = useRef(false);
  const rowH = useRowHeight(layout.rows.length);
  const last = useRef('');

  useEffect(() => {
    if (!paint) return;
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      onDragEnd?.();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [paint, onDragEnd]);

  const slotAt = (c: number, r: number) => layout.cells[c]?.[r] ?? null;

  const handleDown = (e: React.PointerEvent) => {
    const hit = cellAt(e.clientX, e.clientY);
    if (!hit) return;
    if (paint) {
      if (slotAt(hit.col, hit.row) == null) return;
      e.preventDefault();
      dragging.current = true;
      last.current = `${hit.col}:${hit.row}`;
      onDragStart?.(hit.col, hit.row);
    } else {
      onHover?.(slotAt(hit.col, hit.row));
    }
  };

  const handleMove = (e: React.PointerEvent) => {
    const hit = cellAt(e.clientX, e.clientY);
    if (paint) {
      if (e.pointerType === 'mouse' || dragging.current) onHover?.(hit ? slotAt(hit.col, hit.row) : null);
      if (!dragging.current || !hit) return;
      const k = `${hit.col}:${hit.row}`;
      if (k === last.current) return;
      last.current = k;
      onDragMove?.(hit.col, hit.row);
    } else if (e.pointerType === 'mouse') {
      onHover?.(hit ? slotAt(hit.col, hit.row) : null);
    }
  };

  const labelEvery = layout.rows.length ? ((layout.rows[0] % 60) + 60) % 60 : 0;

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className={`meet-grid ${paint ? 'meet-paint' : ''}`}
        style={{ ['--row' as string]: `${rowH}px` }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHover?.(null); }}
      >
        <div className="meet-times">
          <div className="meet-head" />
          {layout.rows.map((m) => (
            <div key={m} className="meet-time">
              {m % 60 === labelEvery && <span>{formatMinute(m)}</span>}
            </div>
          ))}
        </div>
        {layout.columns.map((col, c) => (
          <div key={col.key} className={`meet-col ${col.gap ? 'gap' : ''}`}>
            <div className="meet-head">
              <b>{col.top}</b>
              {col.bottom}
            </div>
            <div className="meet-cells">
              {layout.rows.map((m, r) => {
                const slot = layout.cells[c][r];
                const cls = ['meet-cell'];
                if (r > 0 && m % 60 === labelEvery) cls.push('hour');
                else if (r > 0 && m % 30 === labelEvery % 30) cls.push('half');
                if (slot == null) cls.push('none');
                if (slot != null && slot === hoverSlot) cls.push('hover');
                const bg = slot != null ? cellStyle(slot, c, r) : undefined;
                if (bg) cls.push('filled');
                const extra = slot != null ? cellClass?.(slot, c, r) : undefined;
                if (extra) cls.push(extra);
                return (
                  <div
                    key={m}
                    data-c={c}
                    data-r={r}
                    className={cls.join(' ')}
                    style={bg ? { background: bg } : undefined}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
