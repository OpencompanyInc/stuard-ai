/**
 * Offline Calendar Events Service
 * Stores local calendar events that work without Google Calendar or internet.
 * Events are persisted to disk in JSON format.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

export interface OfflineCalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: string;       // ISO datetime
  end: string;         // ISO datetime
  allDay: boolean;
  location?: string;
  color?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurringEndDate?: string | null;
  source: 'local';
  createdAt: string;
  updatedAt: string;
}

const offlineCalendarPath = () => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'offline-calendar.json');
};

const loadEvents = (): OfflineCalendarEvent[] => {
  try {
    const p = offlineCalendarPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Array.isArray(raw) ? raw : [];
    }
  } catch (e) {
    logger.warn('Failed to load offline calendar events:', e);
  }
  return [];
};

const saveEvents = (events: OfflineCalendarEvent[]) => {
  try {
    fs.writeFileSync(offlineCalendarPath(), JSON.stringify(events, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('Failed to save offline calendar events:', e);
  }
};

function generateId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Expand recurring events within a date range.
 */
function expandRecurring(event: OfflineCalendarEvent, rangeStart: Date, rangeEnd: Date): OfflineCalendarEvent[] {
  if (!event.recurring || event.recurring === 'none') return [event];

  const results: OfflineCalendarEvent[] = [];
  const origStart = new Date(event.start);
  const origEnd = new Date(event.end);
  if (isNaN(origStart.getTime()) || isNaN(origEnd.getTime())) return [event];

  const duration = origEnd.getTime() - origStart.getTime();
  const recurEnd = event.recurringEndDate ? new Date(event.recurringEndDate) : rangeEnd;
  const maxIterations = 400; // Safety limit

  let current = new Date(origStart);
  let iteration = 0;

  while (current <= rangeEnd && current <= recurEnd && iteration < maxIterations) {
    const eventEnd = new Date(current.getTime() + duration);
    // Include if it overlaps with the range
    if (eventEnd >= rangeStart) {
      results.push({
        ...event,
        id: iteration === 0 ? event.id : `${event.id}_recur_${iteration}`,
        start: current.toISOString(),
        end: eventEnd.toISOString(),
      });
    }

    // Advance to next occurrence
    const next = new Date(current);
    if (event.recurring === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (event.recurring === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (event.recurring === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    }
    current = next;
    iteration++;
  }

  return results;
}

export const offlineCalendarService = {
  list: () => {
    return { ok: true, events: loadEvents() };
  },

  get: (eventId: string) => {
    const events = loadEvents();
    const event = events.find(e => e.id === eventId);
    return event ? { ok: true, event } : { ok: false, error: 'Event not found' };
  },

  add: (eventData: Partial<OfflineCalendarEvent>) => {
    const events = loadEvents();
    const now = new Date().toISOString();
    const newEvent: OfflineCalendarEvent = {
      id: generateId(),
      title: eventData.title || '(No Title)',
      description: eventData.description,
      start: eventData.start || now,
      end: eventData.end || eventData.start || now,
      allDay: eventData.allDay ?? false,
      location: eventData.location,
      color: eventData.color,
      recurring: eventData.recurring || 'none',
      recurringEndDate: eventData.recurringEndDate || null,
      source: 'local',
      createdAt: now,
      updatedAt: now,
    };
    events.unshift(newEvent);
    saveEvents(events);
    return { ok: true, event: newEvent, events };
  },

  update: (eventData: Partial<OfflineCalendarEvent> & { id: string }) => {
    const events = loadEvents();
    const idx = events.findIndex(e => e.id === eventData.id);
    if (idx >= 0) {
      events[idx] = {
        ...events[idx],
        ...eventData,
        updatedAt: new Date().toISOString(),
        source: 'local', // Ensure source stays local
      };
      saveEvents(events);
      return { ok: true, event: events[idx], events };
    }
    return { ok: false, error: 'Event not found' };
  },

  delete: (eventId: string) => {
    const events = loadEvents();
    const filtered = events.filter(e => e.id !== eventId);
    saveEvents(filtered);
    return { ok: true, events: filtered };
  },

  /**
   * Get events within a date range, expanding recurring events.
   */
  getForRange: (startIso: string, endIso: string) => {
    const events = loadEvents();
    const rangeStart = new Date(startIso);
    const rangeEnd = new Date(endIso);

    if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
      return { ok: false, error: 'Invalid date range' };
    }

    const expanded: OfflineCalendarEvent[] = [];
    for (const event of events) {
      const instances = expandRecurring(event, rangeStart, rangeEnd);
      for (const inst of instances) {
        const instStart = new Date(inst.start);
        const instEnd = new Date(inst.end);
        // Check overlap with range
        if (instEnd >= rangeStart && instStart <= rangeEnd) {
          expanded.push(inst);
        }
      }
    }

    // Sort by start time
    expanded.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return { ok: true, events: expanded };
  },

  /**
   * Get calendar blocks formatted for the planner view.
   */
  getCalendarBlocks: (startIso: string, endIso: string) => {
    const result = offlineCalendarService.getForRange(startIso, endIso);
    if (!result.ok) return { ok: false, error: result.error, blocks: [] };

    const blocks = (result.events || []).map(e => ({
      id: e.id,
      title: e.title,
      description: e.description,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      source: 'local',
      type: 'event',
      color: e.color,
      recurring: e.recurring,
    }));

    return { ok: true, blocks };
  },
};
