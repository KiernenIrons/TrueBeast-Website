import { useEffect, useRef } from 'react';
import { formatMinute, type GridLayout } from './lib';

// ---------------------------------------------------------------------------
// Styles (scoped, with light-mode overrides)
// ---------------------------------------------------------------------------

export const MEET_CSS = `
.meet { --cell: rgba(255,255,255,0.035); --line: rgba(255,255,255,0.10); --line-soft: rgba(255,255,255,0.05);
        --on: 34,197,94; --muted: rgba(255,255,255,0.45); }
html.light .meet { --cell: rgba(0,0,0,0.035); --line: rgba(0,0,0,0.14); --line-soft: rgba(0,0,0,0.06); --muted: rgba(0,0,0,0.5); }
.meet-grid { display: flex; user-select: none; -webkit-user-select: none; }
.meet-times { flex: none; padding-right: 8px; }
.meet-time { height: 11px; position: relative; min-width: 38px; }
.meet-time span { position: absolute; right: 0; top: -5px; font-size: 10px; line-height: 10px; color: var(--muted); white-space: nowrap; }
.meet-col { flex: 1 0 40px; min-width: 40px; max-width: 72px; }
.meet-col.gap { margin-left: 10px; }
.meet-head { height: 34px; text-align: center; font-size: 11px; line-height: 1.25; color: var(--muted); }
.meet-head b { display: block; font-size: 12px; font-weight: 600; color: inherit; opacity: .95; }
.meet-cells { background: var(--cell); border-left: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
.meet-col + .meet-col:not(.gap) .meet-cells { border-left: 1px solid rgba(0,0,0,.35); }
.meet-cell { height: 11px; background: var(--cell); border-top: 1px dotted var(--line-soft); transition: background-color .08s; }
.meet-cell.hour { border-top: 1px solid var(--line); }
.meet-cell.none { background: repeating-linear-gradient(45deg, transparent 0 3px, var(--line-soft) 3px 4px); }
.meet-cell.filled { border-top-color: rgba(0,0,0,.16); }
.meet-cell.filled.hour { border-top-color: rgba(0,0,0,.42); }
.meet-cell.filled.half { border-top-style: dashed; border-top-color: rgba(0,0,0,.26); }
.meet-cell.hover { outline: 2px solid #fff; outline-offset: -2px; }
html.light .meet-cell.hover { outline-color: #111; }
.meet-paint { cursor: pointer; touch-action: none; }
.meet-legend { height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--cell), rgb(var(--on))); border: 1px solid var(--line); }
.meet-swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--line); display: inline-block; vertical-align: -2px; }
.meet-cal-day { height: 38px; border-radius: 8px; font-size: 13px; display: flex; align-items: center; justify-content: center;
                cursor: pointer; background: var(--cell); transition: background-color .08s, color .08s; }
.meet-cal-day.out { opacity: .35; }
.meet-cal-day.on { background: rgb(var(--on)); color: #04120a; font-weight: 600; }
.meet-cal-day.today { box-shadow: inset 0 0 0 1px rgba(var(--on), .8); }
.meet-input { width: 100%; background: var(--cell); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
              font-size: 14px; outline: none; color: inherit; }
.meet-input:focus { border-color: rgba(var(--on), .7); }
.meet select.meet-input option { background: #111; color: #fff; }
html.light .meet select.meet-input option { background: #fff; color: #111; }
.meet-btn { background: rgb(var(--on)); color: #04120a; font-weight: 600; border-radius: 10px; padding: 10px 16px; font-size: 14px;
            transition: filter .15s, opacity .15s; }
.meet-btn:hover { filter: brightness(1.08); }
.meet-btn:disabled { opacity: .5; cursor: default; }
.meet-ghost { border: 1px solid var(--line); border-radius: 10px; padding: 6px 12px; font-size: 13px; color: inherit; opacity: .85; transition: background-color .15s; }
.meet-ghost:hover { background: var(--cell); opacity: 1; }
.meet-muted { color: var(--muted); }
`;

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface Props {
  layout: GridLayout;
  /** Background for a cell (slot is null for cells outside the event). */
  cellStyle: (slot: number, col: number, row: number) => string | undefined;
  /** Paint mode: pointer drags select a rectangle. */
  paint?: boolean;
  onDragStart?: (col: number, row: number) => void;
  onDragMove?: (col: number, row: number) => void;
  onDragEnd?: () => void;
  /** Hover mode (group grid). */
  hoverSlot?: number | null;
  onHover?: (slot: number | null) => void;
}

function cellAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest<HTMLElement>('[data-c]');
  if (!cell) return null;
  return { col: Number(cell.dataset.c), row: Number(cell.dataset.r) };
}

export default function TimeGrid({ layout, cellStyle, paint, onDragStart, onDragMove, onDragEnd, hoverSlot, onHover }: Props) {
  const dragging = useRef(false);
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
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerLeave={(e) => { if (!paint && e.pointerType === 'mouse') onHover?.(null); }}
      >
        <div className="meet-times">
          <div className="meet-head" />
          {layout.rows.map((m) => (
            <div key={m} className="meet-time">
              {m % 60 === labelEvery && <span>{formatMinute(m, true)}</span>}
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
