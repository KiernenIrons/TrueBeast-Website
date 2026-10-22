/**
 * Meet -- group availability scheduler (when2meet-style).
 *
 * Firestore layout:
 *   meetEvents/{eventId}                  -> MeetEvent
 *   meetEvents/{eventId}/people/{personId} -> MeetPerson
 *
 * Every slot is stored as a UTC epoch (seconds) for the start of a 15-minute
 * block, so availability survives time zone changes. "Days of the week" events
 * map Sun..Sat onto a fixed reference week (Jan 7-13 2024) so they use the same
 * maths.
 */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFirestoreDb } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeetMode = 'dates' | 'days';

export interface MeetEvent {
  id: string;
  name: string;
  mode: MeetMode;
  /** 'YYYY-MM-DD' for dates mode, '0'..'6' (Sun..Sat) for days mode. */
  dates: string[];
  startHour: number;
  /** Exclusive, 1..24. */
  endHour: number;
  timezone: string;
  createdAt: number;
  /** Discord session text channel id, when made from the bot's "Find a time" button. */
  discordSession?: string;
}

export interface MeetPerson {
  id: string;
  name: string;
  pwHash: string;
  slots: number[];
  updatedAt: number;
}

export const SLOT_MINUTES = 15;
export const MAX_DATES = 62;
const EVENTS = 'meetEvents';
const REFERENCE_SUNDAY = '2024-01-07';

// ---------------------------------------------------------------------------
// Time zone maths
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of a UTC instant in a given zone. */
function wallParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

function tzOffsetMs(ms: number, tz: string) {
  const w = wallParts(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000;
}

/** Wall-clock date + minute-of-day in `tz` -> UTC epoch ms. */
export function zonedToUtc(date: string, minute: number, tz: string) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  let utc = guess - tzOffsetMs(guess, tz);
  const corrected = guess - tzOffsetMs(utc, tz);
  if (corrected !== utc) utc = corrected;
  return utc;
}

/** UTC epoch ms -> wall-clock date + minute-of-day in `tz`. */
export function utcToZoned(ms: number, tz: string) {
  const w = wallParts(ms, tz);
  return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, minute: w.h * 60 + w.mi };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dayDiff(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function todayIso() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function allTimezones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn('timeZone') : [];
  const local = localTimezone();
  if (!list.includes(local)) list.unshift(local);
  if (!list.includes('UTC')) list.push('UTC');
  return list;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' });

export function formatMinute(minute: number, short = false) {
  const d = new Date(Date.UTC(2000, 0, 1, 0, minute));
  return (short && minute % 60 === 0 ? hourFmt : timeFmt).format(d);
}

export function formatHour(h: number) {
  return formatMinute((h % 24) * 60);
}

export const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i))),
);

export function formatDateHeader(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return {
    top: new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(t),
    bottom: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(t),
  };
}

// ---------------------------------------------------------------------------
// Slots + grid layout
// ---------------------------------------------------------------------------

/** All slot epochs (seconds) the event covers. */
export function eventSlots(ev: MeetEvent): number[] {
  const out: number[] = [];
  const dates = ev.mode === 'days'
    ? ev.dates.map((d) => addDays(REFERENCE_SUNDAY, Number(d)))
    : ev.dates;
  for (const date of [...dates].sort()) {
    for (let m = ev.startHour * 60; m < ev.endHour * 60; m += SLOT_MINUTES) {
      out.push(zonedToUtc(date, m, ev.timezone) / 1000);
    }
  }
  return [...new Set(out)];
}

export interface GridColumn {
  key: string;
  top: string;
  bottom: string;
  /** Visual gap before this column (non-consecutive day). */
  gap: boolean;
}

export interface GridLayout {
  columns: GridColumn[];
  rows: number[]; // minute-of-day in the viewer's zone
  /** cells[col][row] -> slot epoch or null when the event doesn't cover it. */
  cells: (number | null)[][];
  /** Wall-clock label for a slot epoch in the viewer's zone. */
  labels: Map<number, { col: string; minute: number }>;
}

export function buildLayout(ev: MeetEvent, viewerTz: string): GridLayout {
  const slots = eventSlots(ev);
  const colOf = new Map<number, string>();
  const labels = new Map<number, { col: string; minute: number }>();
  const colKeys = new Set<string>();
  const minutes = new Set<number>();

  for (const s of slots) {
    const z = utcToZoned(s * 1000, viewerTz);
    const key = ev.mode === 'days'
      ? String(((dayDiff(REFERENCE_SUNDAY, z.date) % 7) + 7) % 7)
      : z.date;
    colOf.set(s, key);
    colKeys.add(key);
    minutes.add(z.minute);
    labels.set(s, { col: key, minute: z.minute });
  }

  const keys = [...colKeys].sort((a, b) => (ev.mode === 'days' ? Number(a) - Number(b) : a.localeCompare(b)));
  const rows = [...minutes].sort((a, b) => a - b);
  const rowIdx = new Map(rows.map((m, i) => [m, i]));
  const colIdx = new Map(keys.map((k, i) => [k, i]));
  const cells: (number | null)[][] = keys.map(() => rows.map(() => null));
  for (const s of slots) {
    const l = labels.get(s)!;
    cells[colIdx.get(l.col)!][rowIdx.get(l.minute)!] = s;
  }

  const columns = keys.map((key, i) => {
    const prev = keys[i - 1];
    const gap = i > 0 && (ev.mode === 'days' ? Number(key) - Number(prev) !== 1 : dayDiff(prev, key) !== 1);
    if (ev.mode === 'days') return { key, top: WEEKDAYS[Number(key)], bottom: '', gap };
    const h = formatDateHeader(key);
    return { key, top: h.top, bottom: h.bottom, gap };
  });

  return { columns, rows, cells, labels };
}

export function describeSlot(ev: MeetEvent, layout: GridLayout, slot: number) {
  const l = layout.labels.get(slot);
  if (!l) return '';
  const day = ev.mode === 'days'
    ? WEEKDAYS[Number(l.col)]
    : (() => { const h = formatDateHeader(l.col); return `${h.top}, ${h.bottom}`; })();
  return `${day} · ${formatMinute(l.minute)} – ${formatMinute(l.minute + SLOT_MINUTES)}`;
}

// ---------------------------------------------------------------------------
// Hashing / ids
// ---------------------------------------------------------------------------

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

export async function personIdFor(name: string) {
  return (await sha256Hex(normalizeName(name).toLowerCase())).slice(0, 24);
}

export async function passwordHash(eventId: string, personId: string, password: string) {
  return password ? sha256Hex(`${eventId}:${personId}:${password}`) : '';
}

function randomId(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

function db() {
  const d = getFirestoreDb();
  if (!d) throw new Error('Database is not configured.');
  return d;
}

export async function createEvent(data: Omit<MeetEvent, 'id' | 'createdAt'>) {
  const id = randomId();
  try {
    await setDoc(doc(db(), EVENTS, id), { ...data, createdAt: Date.now() });
  } catch (e) {
    // If the rules don't accept the Discord tag, still create the event; the host can paste the link in Discord instead.
    if (!data.discordSession || !isPermissionError(e)) throw e;
    const { discordSession: _, ...plain } = data;
    await setDoc(doc(db(), EVENTS, id), { ...plain, createdAt: Date.now() });
  }
  return id;
}

export async function fetchEvent(id: string): Promise<MeetEvent | null> {
  const snap = await getDoc(doc(db(), EVENTS, id));
  if (!snap.exists()) return null;
  return { id, ...(snap.data() as Omit<MeetEvent, 'id'>) };
}

export function subscribePeople(
  eventId: string,
  cb: (people: MeetPerson[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db(), EVENTS, eventId, 'people'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MeetPerson, 'id'>) }))),
    onError,
  );
}

export async function savePerson(eventId: string, person: MeetPerson) {
  const { id, ...rest } = person;
  await setDoc(doc(db(), EVENTS, eventId, 'people', id), { ...rest, updatedAt: Date.now() });
}

export function isPermissionError(e: unknown) {
  return String((e as { code?: string })?.code ?? e).includes('permission');
}
