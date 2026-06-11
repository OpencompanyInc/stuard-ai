/**
 * Lightweight natural-language "when" parser for the slash-command composer.
 * Handles the phrases people actually type into a reminder field:
 *   "5pm", "tomorrow 9am", "monday", "in 20 minutes", "tonight",
 *   "every day 9am", "every monday", "every weekday 8:30"
 * Recurrence maps onto the RecurrenceRule shape the reminder scheduler
 * already understands (renderer/types/tasks.ts).
 */
import type { RecurrenceRule } from '../../../../../types/tasks';

export interface ParsedWhen {
  /** First (or only) occurrence. Null when the text couldn't be parsed. */
  date: Date | null;
  /** Present when the text described a repeating schedule ("every …"). */
  recurrence: RecurrenceRule | null;
  /** Human label for confirmation UI, e.g. "Mon 9:00 AM · weekly". */
  label: string;
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const WORD_TIMES: Record<string, [number, number]> = {
  morning: [9, 0],
  noon: [12, 0],
  midday: [12, 0],
  afternoon: [15, 0],
  evening: [18, 0],
  tonight: [20, 0],
  night: [21, 0],
  midnight: [0, 0],
};

/** Extract an explicit time of day; returns [hours, minutes] or null. */
function extractTime(text: string): { time: [number, number]; rest: string } | null {
  // 5pm / 5:30pm / 17:30 / at 5
  const m = text.match(/(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m && (m[2] !== undefined || m[3] !== undefined)) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const mer = (m[3] || '').toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    if (h <= 23 && min <= 59) {
      return { time: [h, min], rest: (text.slice(0, m.index) + ' ' + text.slice((m.index || 0) + m[0].length)).trim() };
    }
  }
  // "at 5" (bare hour with explicit "at") — assume next sensible occurrence handled by caller
  const at = text.match(/\bat\s+(\d{1,2})\b/i);
  if (at) {
    let h = parseInt(at[1], 10);
    if (h >= 1 && h <= 23) {
      // Bare 1-7 "at 5" usually means PM
      if (h >= 1 && h <= 7) h += 12;
      return { time: [h, 0], rest: (text.slice(0, at.index) + ' ' + text.slice((at.index || 0) + at[0].length)).trim() };
    }
  }
  for (const [word, time] of Object.entries(WORD_TIMES)) {
    const re = new RegExp(`\\b(?:in the\\s+)?${word}\\b`, 'i');
    const wm = text.match(re);
    if (wm) {
      return { time, rest: (text.slice(0, wm.index) + ' ' + text.slice((wm.index || 0) + wm[0].length)).trim() };
    }
  }
  return null;
}

function nextDayOfWeek(from: Date, jsDay: number, mustBeFuture: boolean): Date {
  const d = new Date(from);
  let delta = (jsDay - d.getDay() + 7) % 7;
  if (delta === 0 && mustBeFuture) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function applyTime(d: Date, time: [number, number] | null, fallback: [number, number]): Date {
  const [h, m] = time || fallback;
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

function formatLabel(date: Date, recurrence: RecurrenceRule | null): string {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  let dayStr: string;
  if (sameDay) dayStr = 'Today';
  else if (isTomorrow) dayStr = 'Tomorrow';
  else dayStr = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  let label = `${dayStr} ${timeStr}`;
  if (recurrence) {
    if (recurrence.frequency === 'daily') label += ' · daily';
    else if (recurrence.frequency === 'weekly' && recurrence.days && recurrence.days.length === 5) label += ' · weekdays';
    else if (recurrence.frequency === 'weekly') label += ' · weekly';
    else if (recurrence.frequency === 'monthly') label += ' · monthly';
    else if (recurrence.frequency === 'yearly') label += ' · yearly';
  }
  return label;
}

/** Parse a natural-language "when" phrase. Returns date:null when nothing matched. */
export function parseWhen(input: string, now: Date = new Date()): ParsedWhen {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { date: null, recurrence: null, label: '' };

  let recurrence: RecurrenceRule | null = null;
  let text = raw;

  // --- Recurrence: "every ..." -------------------------------------------
  const every = text.match(/\bevery\s+(day|morning|evening|night|week|month|year|weekday|weekdays|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i);
  let recurringDayAnchor: number | null = null; // JS getDay()
  if (every) {
    const unit = every[1].toLowerCase();
    if (unit === 'day' || unit === 'morning' || unit === 'evening' || unit === 'night') {
      recurrence = { frequency: 'daily' };
      // morning/evening/night also imply a default time — leave word in text
      if (unit === 'day') text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
      else text = text.replace(/\bevery\b/i, '').trim();
    } else if (unit === 'week') {
      recurrence = { frequency: 'weekly' };
      text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
    } else if (unit === 'month') {
      recurrence = { frequency: 'monthly' };
      text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
    } else if (unit === 'year') {
      recurrence = { frequency: 'yearly' };
      text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
    } else if (unit.startsWith('weekday')) {
      // RecurrenceRule days: 0=Mon..6=Sun
      recurrence = { frequency: 'weekly', days: [0, 1, 2, 3, 4] };
      recurringDayAnchor = -1; // next weekday
      text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
    } else {
      const dayIdx = DAY_NAMES.findIndex((d) => d.startsWith(unit.slice(0, 3)));
      if (dayIdx >= 0) {
        recurrence = { frequency: 'weekly', days: [dayIdx] };
        recurringDayAnchor = (dayIdx + 1) % 7; // RecurrenceRule Mon=0 → JS Mon=1
        text = (text.slice(0, every.index) + ' ' + text.slice((every.index || 0) + every[0].length)).trim();
      }
    }
  }

  // --- Relative: "in N minutes/hours/days/weeks" --------------------------
  const rel = text.match(/\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const d = new Date(now);
    if (unit.startsWith('min')) d.setMinutes(d.getMinutes() + n);
    else if (unit.startsWith('h')) d.setHours(d.getHours() + n);
    else if (unit.startsWith('d')) d.setDate(d.getDate() + n);
    else d.setDate(d.getDate() + n * 7);
    return { date: d, recurrence, label: formatLabel(d, recurrence) };
  }

  // --- Time of day ---------------------------------------------------------
  const timeHit = extractTime(text);
  const time = timeHit?.time ?? null;
  if (timeHit) text = timeHit.rest;

  // --- Day anchor ----------------------------------------------------------
  let day: Date | null = null;
  if (/\btoday\b/.test(text)) day = new Date(now);
  else if (/\btomorrow\b|\btmrw?\b/.test(text)) {
    day = new Date(now);
    day.setDate(day.getDate() + 1);
  } else if (/\bnext week\b/.test(text)) {
    day = new Date(now);
    day.setDate(day.getDate() + 7);
  } else {
    const nextPrefix = /\bnext\s+/.test(text);
    for (let i = 0; i < DAY_NAMES.length; i++) {
      const re = new RegExp(`\\b${DAY_NAMES[i].slice(0, 3)}(?:${DAY_NAMES[i].slice(3)})?\\b`, 'i');
      if (re.test(text)) {
        day = nextDayOfWeek(now, (i + 1) % 7, true);
        if (nextPrefix && day.getTime() - now.getTime() < 24 * 3600 * 1000) day.setDate(day.getDate() + 7);
        break;
      }
    }
  }

  if (recurringDayAnchor !== null && !day) {
    // -1 = "every weekday": anchor on today and let the weekly-days alignment
    // below (plus the past-time roll-forward) land on the next valid slot.
    day = recurringDayAnchor === -1 ? new Date(now) : nextDayOfWeek(now, recurringDayAnchor, false);
  }

  if (!day && !time && !recurrence) {
    return { date: null, recurrence: null, label: '' };
  }

  // Defaults: recurrence or day with no time → 9:00; time with no day → next occurrence.
  let date: Date;
  if (day) {
    date = applyTime(day, time, [9, 0]);
    if (date.getTime() <= now.getTime()) {
      // "today 8am" when it's 10am → if no explicit "today", roll forward
      if (!/\btoday\b/.test(raw)) date.setDate(date.getDate() + 1);
    }
  } else if (time) {
    date = applyTime(now, time, [9, 0]);
    if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  } else {
    // recurrence only ("every day") → next 9:00
    date = applyTime(now, null, [9, 0]);
    if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  }

  // Recurring weekly: make sure the anchor lands on an allowed day.
  if (recurrence?.frequency === 'weekly' && Array.isArray(recurrence.days) && recurrence.days.length > 0) {
    const allowedJs = recurrence.days.map((d) => (d + 1) % 7);
    let guard = 0;
    while (!allowedJs.includes(date.getDay()) && guard++ < 8) date.setDate(date.getDate() + 1);
  }

  return { date, recurrence, label: formatLabel(date, recurrence) };
}
