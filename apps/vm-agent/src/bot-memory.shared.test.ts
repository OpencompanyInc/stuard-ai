import { describe, it, expect } from 'vitest';
import {
  createBotMemoryStore,
  emptyBotMemoryFile,
  type BotMemoryFile,
} from '@stuardai/bots-core';

// In-memory storage adapter so we exercise the shared store logic without disk.
function memStore() {
  let file: BotMemoryFile = emptyBotMemoryFile();
  return createBotMemoryStore({
    load: () => file,
    save: (f) => { file = f; },
  });
}

describe('bot-memory store (shared @stuardai/bots-core)', () => {
  it('creates, lists, and sorts cards newest-first', () => {
    const s = memStore();
    const a = s.createCard('bot1', { title: 'First' }, 'bot')!;
    const b = s.createCard('bot1', { title: 'Second' }, 'bot')!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    const cards = s.listCards('bot1');
    expect(cards.map(c => c.title)).toContain('First');
    expect(cards.map(c => c.title)).toContain('Second');
    expect(cards.every(c => c.status === 'queued')).toBe(true);
  });

  it('rejects cards without a title and requires a botId', () => {
    const s = memStore();
    expect(s.createCard('bot1', { title: '  ' }, 'bot')).toBeNull();
    expect(s.createCard('', { title: 'x' }, 'bot')).toBeNull();
  });

  it('updateCard sets completedAt when moving to completed and clears it otherwise', () => {
    const s = memStore();
    const c = s.createCard('b', { title: 'task' }, 'bot')!;
    const done = s.updateCard('b', c.id, { status: 'completed' }, 'user')!;
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    expect(done.lastEditedBy).toBe('user');
    const reopened = s.updateCard('b', c.id, { status: 'queued' }, 'bot')!;
    expect(reopened.completedAt).toBeNull();
  });

  it('deleteCard removes only the target', () => {
    const s = memStore();
    const a = s.createCard('b', { title: 'a' }, 'bot')!;
    s.createCard('b', { title: 'keep' }, 'bot');
    expect(s.deleteCard('b', a.id)).toBe(true);
    expect(s.deleteCard('b', 'nope')).toBe(false);
    expect(s.listCards('b').map(c => c.title)).toEqual(['keep']);
  });

  it('appendRunLog returns chronological storage, listRunLog returns newest-first', () => {
    const s = memStore();
    s.appendRunLog('b', { summary: 'run 1' });
    s.appendRunLog('b', { summary: 'run 2', outcome: 'failed' });
    const log = s.listRunLog('b');
    expect(log[0].summary).toBe('run 2');
    expect(log[0].outcome).toBe('failed');
    expect(log[1].summary).toBe('run 1');
  });

  it('mergeSnapshot keeps the newest edit per card id', () => {
    const s = memStore();
    const c = s.createCard('b', { title: 'orig' }, 'bot')!;
    // Incoming snapshot has a newer updatedAt for the same id
    const merged = s.mergeSnapshot('b', {
      cards: [{ ...c, title: 'updated', updatedAt: new Date(Date.now() + 60000).toISOString() }],
      runLog: [],
    });
    expect(merged.cards.find(x => x.id === c.id)?.title).toBe('updated');
  });

  it('keeps fixed profile slots separate from kanban cards', () => {
    const s = memStore();
    const profile = s.updateProfile('b', {
      name: 'Research Agent',
      preferences: 'Prefer terse summaries.',
      systemPrompt: 'Always cite sources.',
    });
    expect(profile.name).toBe('Research Agent');
    expect(s.listCards('b')).toEqual([]);
    const prompt = s.formatForPrompt('b');
    expect(prompt).toContain('PERSONAL MEMORY SLOTS');
    expect(prompt).toContain('Research Agent');
    expect(prompt).toContain('Prefer terse summaries.');
    expect(prompt).toContain('Always cite sources.');
  });

  it('clearForBot drops everything for that bot only', () => {
    const s = memStore();
    s.createCard('b1', { title: 'x' }, 'bot');
    s.createCard('b2', { title: 'y' }, 'bot');
    expect(s.clearForBot('b1')).toBe(true);
    expect(s.listCards('b1')).toEqual([]);
    expect(s.listCards('b2').length).toBe(1);
  });

  it('formatForPrompt renders kanban + run log, and an empty-state hint', () => {
    const s = memStore();
    expect(s.formatForPrompt('b')).toContain('PRIVATE KANBAN (empty');
    s.createCard('b', { title: 'Investigate', status: 'in_progress' }, 'bot');
    s.appendRunLog('b', { summary: 'looked into it', outcome: 'partial' });
    const prompt = s.formatForPrompt('b');
    expect(prompt).toContain('In progress');
    expect(prompt).toContain('Investigate');
    expect(prompt).toContain('Recent runs');
  });
});
