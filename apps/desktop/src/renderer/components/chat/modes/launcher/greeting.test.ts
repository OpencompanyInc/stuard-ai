import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildFallbackSuggestions,
  cacheLauncherSuggestions,
  createLauncherSuggestionsCacheKey,
  extractFirstName,
  getTimeGreeting,
  LAUNCHER_SUGGESTIONS_CACHE_KEY,
  readCachedLauncherSuggestions,
  resolveAuthUserName,
  resolveIdentityName,
  resolveProfileName,
} from './greeting';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe('getTimeGreeting', () => {
  it('returns late-night copy before dawn', () => {
    expect(getTimeGreeting(new Date('2026-05-25T02:30:00'))).toBe('Up late');
  });

  it('returns morning copy', () => {
    expect(getTimeGreeting(new Date('2026-05-25T09:00:00'))).toBe('Good morning');
  });

  it('returns afternoon copy', () => {
    expect(getTimeGreeting(new Date('2026-05-25T14:00:00'))).toBe('Good afternoon');
  });

  it('returns evening copy', () => {
    expect(getTimeGreeting(new Date('2026-05-25T19:00:00'))).toBe('Good evening');
  });

  it('returns staying-up-late copy after 10pm', () => {
    expect(getTimeGreeting(new Date('2026-05-25T23:15:00'))).toBe('Staying up late');
  });
});

describe('extractFirstName', () => {
  it('uses the first token', () => {
    expect(extractFirstName('Alex Morgan')).toBe('Alex');
  });
});

describe('resolveAuthUserName', () => {
  it('prefers metadata full_name', () => {
    expect(
      resolveAuthUserName({ full_name: 'Alex Morgan', name: 'Other' }, 'alex@example.com'),
    ).toBe('Alex Morgan');
  });

  it('falls back to email prefix', () => {
    expect(resolveAuthUserName({}, 'alex@example.com')).toBe('alex');
  });
});

describe('resolveProfileName', () => {
  it('prefers full_name over display_name', () => {
    expect(
      resolveProfileName({ full_name: 'Alex Morgan', display_name: 'alexm', username: 'alex' }),
    ).toBe('Alex Morgan');
  });
});

describe('resolveIdentityName', () => {
  it('reads the core name fact', () => {
    expect(
      resolveIdentityName([
        { attribute_key: 'os', text: 'Windows 11' },
        { attribute_key: 'name', text: 'Alex Morgan' },
      ]),
    ).toBe('Alex Morgan');
  });
});

describe('buildFallbackSuggestions', () => {
  it('returns generic chips without echoing memory titles', () => {
    const out = buildFallbackSuggestions(['Working on StuardAI launch'], 'Alex', 2);
    expect(out[0]).toBe('Catch me up, Alex');
    expect(out.some((s) => s.includes('Working on StuardAI launch'))).toBe(false);
  });
});

describe('launcher suggestion cache', () => {
  it('reuses suggestions for the same context while fresh', () => {
    const cacheKey = createLauncherSuggestionsCacheKey('Alex', ['[project] StuardAI'], 4);
    cacheLauncherSuggestions(cacheKey, ['Plan today', 'Search files'], 1000);

    expect(readCachedLauncherSuggestions(cacheKey, 1000 + 60_000)).toEqual([
      'Plan today',
      'Search files',
    ]);
  });

  it('misses when context changes or the entry expires', () => {
    const cacheKey = createLauncherSuggestionsCacheKey('Alex', ['[project] StuardAI'], 4);
    const otherKey = createLauncherSuggestionsCacheKey('Alex', ['[project] Other'], 4);
    cacheLauncherSuggestions(cacheKey, ['Plan today'], 1000);

    expect(readCachedLauncherSuggestions(otherKey, 1000 + 60_000)).toBeNull();
    expect(readCachedLauncherSuggestions(cacheKey, 1000 + 31 * 60_000)).toBeNull();
    expect(storage.has(LAUNCHER_SUGGESTIONS_CACHE_KEY)).toBe(false);
  });
});
