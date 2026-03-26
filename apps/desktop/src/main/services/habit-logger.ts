/**
 * Habit Feature Logger
 *
 * Logs structured feature vectors after each proactive wake-up for future
 * pattern recognition / XGBoost training. Features are numeric or categorical
 * so they can be fed directly into a gradient-boosted model without LLM parsing.
 *
 * Storage: JSONL file (one JSON object per line) for easy streaming reads
 * and append-only writes. Rotated when it exceeds MAX_ENTRIES.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// ── Feature Vector Schema ────────────────────────────────────────────────────

export interface HabitFeatureVector {
  // ── Temporal features ──
  /** ISO timestamp of this observation */
  timestamp: string;
  /** Hour of day (0-23) */
  hour: number;
  /** Day of week (0=Sunday, 6=Saturday) */
  dayOfWeek: number;
  /** Whether it's a weekend */
  isWeekend: boolean;

  // ── Activity features ──
  /** Title of the foreground/active window (most recently focused) */
  activeWindowTitle: string;
  /** Categorized activity: work, gaming, social, media, idle, unknown */
  activityCategory: string;
  /** Total number of open windows */
  numOpenWindows: number;
  /** List of app categories open (deduplicated) */
  openCategories: string[];

  // ── Calendar features ──
  /** Minutes until next calendar event (-1 if none) */
  minutesToNextEvent: number;
  /** Title of the next event (empty if none) */
  nextEventTitle: string;
  /** Whether the next event looks like a deadline/exam/due date */
  nextEventIsDeadline: boolean;
  /** Number of events in the next 4 hours */
  eventsInNext4Hours: number;

  // ── Task features ──
  /** Number of queued proactive tasks */
  queuedTasks: number;
  /** Number of in-progress proactive tasks */
  inProgressTasks: number;

  // ── Intervention features ──
  /** What urgency the agent chose: critical, high, normal, low, skip */
  urgencyChosen: string;
  /** What channel was used: app, sms, call, whatsapp, skip */
  channelChosen: string;
  /** Whether the agent detected a distraction */
  distractionDetected: boolean;
  /** Whether the agent intervened (sent a non-routine message) */
  intervened: boolean;

  // ── Outcome features (filled in later via feedback) ──
  /** Whether the user responded to the notification */
  userResponded?: boolean;
  /** Whether the user followed the suggestion (if any) */
  userFollowedSuggestion?: boolean;
  /** User sentiment if they replied: positive, neutral, negative, annoyed */
  userSentiment?: string;
}

// ── App categorization ───────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  // Gaming
  [/fortnite|minecraft|steam|epic games|riot|league of legends|valorant|overwatch|roblox|genshin|discord.*game/i, 'gaming'],
  // Work / productivity
  [/visual studio|vs code|intellij|pycharm|webstorm|android studio|xcode|terminal|cmd|powershell|git|github|gitlab|jira|slack|teams|notion|obsidian|confluence|linear/i, 'work'],
  // Social media
  [/instagram|twitter|tiktok|facebook|reddit|snapchat|whatsapp|telegram|messenger|signal/i, 'social'],
  // Media / entertainment
  [/youtube|netflix|spotify|hulu|twitch|disney|prime video|vlc|plex|music/i, 'media'],
  // Education
  [/canvas|blackboard|coursera|udemy|khan academy|chegg|quizlet|anki|study|exam/i, 'education'],
  // Browsing
  [/chrome|firefox|edge|safari|brave|opera|browser/i, 'browsing'],
  // Communication
  [/outlook|gmail|mail|zoom|google meet|webex/i, 'communication'],
];

export function categorizeWindow(title: string): string {
  const t = title.toLowerCase();
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(t)) return category;
  }
  return 'unknown';
}

export function categorizeWindows(windows: Array<{ title: string }>): string[] {
  const categories = new Set<string>();
  for (const w of windows) {
    categories.add(categorizeWindow(w.title));
  }
  return Array.from(categories);
}

// ── Deadline detection ───────────────────────────────────────────────────────

const DEADLINE_PATTERNS = /exam|due|deadline|submission|quiz|test|final|midterm|presentation|defense|review/i;

export function looksLikeDeadline(title: string): boolean {
  return DEADLINE_PATTERNS.test(title);
}

// ── File storage ─────────────────────────────────────────────────────────────

const LOG_FILE = 'habit-features.jsonl';
const MAX_ENTRIES = 2000;

function logPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE);
}

export function appendFeatureVector(features: HabitFeatureVector): void {
  try {
    const line = JSON.stringify(features) + '\n';
    fs.appendFileSync(logPath(), line, 'utf-8');

    // Rotate if too large
    rotateIfNeeded();
  } catch (e) {
    logger.warn('[habit-logger] Failed to append feature vector:', e);
  }
}

function rotateIfNeeded(): void {
  try {
    const p = logPath();
    if (!fs.existsSync(p)) return;

    const content = fs.readFileSync(p, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length > MAX_ENTRIES) {
      // Keep the most recent entries
      const trimmed = lines.slice(-MAX_ENTRIES).join('\n') + '\n';
      fs.writeFileSync(p, trimmed, 'utf-8');
      logger.info(`[habit-logger] Rotated log: kept ${MAX_ENTRIES} of ${lines.length} entries`);
    }
  } catch {}
}

export function readAllFeatureVectors(): HabitFeatureVector[] {
  try {
    const p = logPath();
    if (!fs.existsSync(p)) return [];
    const content = fs.readFileSync(p, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean) as HabitFeatureVector[];
  } catch {
    return [];
  }
}

export function getFeatureVectorCount(): number {
  try {
    const p = logPath();
    if (!fs.existsSync(p)) return 0;
    const content = fs.readFileSync(p, 'utf-8');
    return content.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ── Builder helper ───────────────────────────────────────────────────────────

/**
 * Build a feature vector from the current proactive wake-up context.
 * Call this at the end of each wake-up with the collected context.
 */
export function buildFeatureVector(params: {
  openWindows: Array<{ title: string }>;
  minutesToNextEvent?: number;
  nextEventTitle?: string;
  eventsInNext4Hours?: number;
  queuedTasks: number;
  inProgressTasks: number;
  urgencyChosen?: string;
  channelChosen?: string;
  distractionDetected?: boolean;
  intervened?: boolean;
}): HabitFeatureVector {
  const now = new Date();
  const categories = categorizeWindows(params.openWindows);

  // Determine the primary activity from the first window (usually the focused one)
  const primaryCategory = params.openWindows.length > 0
    ? categorizeWindow(params.openWindows[0].title)
    : 'idle';

  const nextTitle = params.nextEventTitle || '';

  return {
    timestamp: now.toISOString(),
    hour: now.getHours(),
    dayOfWeek: now.getDay(),
    isWeekend: now.getDay() === 0 || now.getDay() === 6,

    activeWindowTitle: params.openWindows[0]?.title || '',
    activityCategory: primaryCategory,
    numOpenWindows: params.openWindows.length,
    openCategories: categories,

    minutesToNextEvent: params.minutesToNextEvent ?? -1,
    nextEventTitle: nextTitle,
    nextEventIsDeadline: looksLikeDeadline(nextTitle),
    eventsInNext4Hours: params.eventsInNext4Hours ?? 0,

    queuedTasks: params.queuedTasks,
    inProgressTasks: params.inProgressTasks,

    urgencyChosen: params.urgencyChosen || 'normal',
    channelChosen: params.channelChosen || 'app',
    distractionDetected: params.distractionDetected || false,
    intervened: params.intervened || false,
  };
}
