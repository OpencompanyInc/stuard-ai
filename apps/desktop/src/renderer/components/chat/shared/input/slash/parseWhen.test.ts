import { describe, it, expect } from 'vitest';
import { parseWhen } from './parseWhen';

// Fixed reference: Wednesday 2026-06-10 10:00 local time.
const NOW = new Date(2026, 5, 10, 10, 0, 0, 0);

describe('parseWhen', () => {
  it('returns null for empty or unparseable text', () => {
    expect(parseWhen('', NOW).date).toBeNull();
    expect(parseWhen('whenever you feel like it', NOW).date).toBeNull();
  });

  it('parses explicit times today, rolling past times to tomorrow', () => {
    const future = parseWhen('5pm', NOW);
    expect(future.date?.getHours()).toBe(17);
    expect(future.date?.getDate()).toBe(10);

    const past = parseWhen('8am', NOW); // 8am already passed at 10:00
    expect(past.date?.getHours()).toBe(8);
    expect(past.date?.getDate()).toBe(11);
  });

  it('parses "tomorrow 9am"', () => {
    const r = parseWhen('tomorrow 9am', NOW);
    expect(r.date?.getDate()).toBe(11);
    expect(r.date?.getHours()).toBe(9);
    expect(r.recurrence).toBeNull();
  });

  it('parses minutes/hours offsets', () => {
    const r = parseWhen('in 20 minutes', NOW);
    expect(r.date?.getHours()).toBe(10);
    expect(r.date?.getMinutes()).toBe(20);

    const h = parseWhen('in 2 hours', NOW);
    expect(h.date?.getHours()).toBe(12);
  });

  it('parses weekday names as the next occurrence', () => {
    const r = parseWhen('friday 3pm', NOW);
    expect(r.date?.getDay()).toBe(5); // Friday
    expect(r.date?.getDate()).toBe(12);
    expect(r.date?.getHours()).toBe(15);
  });

  it('parses word times (tonight, morning)', () => {
    expect(parseWhen('tonight', NOW).date?.getHours()).toBe(20);
    const morning = parseWhen('tomorrow morning', NOW);
    expect(morning.date?.getDate()).toBe(11);
    expect(morning.date?.getHours()).toBe(9);
  });

  it('parses "every day 9am" as daily recurrence anchored at next 9am', () => {
    const r = parseWhen('every day 9am', NOW);
    expect(r.recurrence?.frequency).toBe('daily');
    expect(r.date?.getHours()).toBe(9);
    expect(r.date?.getDate()).toBe(11); // 9am already passed today
  });

  it('parses "every monday" as weekly recurrence on Monday (0-indexed)', () => {
    const r = parseWhen('every monday 8:30', NOW);
    expect(r.recurrence?.frequency).toBe('weekly');
    expect(r.recurrence?.days).toEqual([0]);
    expect(r.date?.getDay()).toBe(1); // JS Monday
    expect(r.date?.getMinutes()).toBe(30);
  });

  it('parses "every weekday" with Mon-Fri days', () => {
    const r = parseWhen('every weekday 8am', NOW);
    expect(r.recurrence?.frequency).toBe('weekly');
    expect(r.recurrence?.days).toEqual([0, 1, 2, 3, 4]);
    // 8am passed on Wed → next valid slot is Thu 8am
    expect(r.date?.getDay()).toBe(4);
    expect(r.date?.getHours()).toBe(8);
  });

  it('produces a human label', () => {
    expect(parseWhen('5pm', NOW).label).toContain('Today');
    expect(parseWhen('every day 9am', NOW).label).toContain('daily');
  });
});
