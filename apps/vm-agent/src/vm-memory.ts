/**
 * VM Memory Store
 *
 * Persistent memory storage for the Stuard agent running on a VM.
 * Memories are stored as JSON files in /home/stuard/memories/ and
 * can be synced to/from cloud storage.
 *
 * Features:
 * - Per-user memory isolation
 * - Topic-based organization
 * - Full-text search across memories
 * - Bulk import/export for cloud sync
 * - TTL-based expiration (optional)
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryOrigin = 'cloud_vm' | 'desktop';

export interface MemoryEntry {
  id: string;
  topic: string;
  content: string;
  metadata: Record<string, any>;
  tags: string[];
  source: 'agent' | 'proactive' | 'workflow' | 'user' | 'system';
  origin: MemoryOrigin;
  importance: number; // 0-10
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
  hash: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  model: string;
  source: string;
  message_count: number;
  topics: string[];
  created_at: string;
  updated_at: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchedFields: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_ROOT = process.env.STUARD_MEMORY_ROOT || '/home/stuard/memories';
const MEMORIES_FILE = 'memories.json';
const CONVERSATIONS_FILE = 'conversations.json';
const PREFERENCES_FILE = 'preferences.json';
const MAX_MEMORIES = 10_000;
const MAX_MEMORY_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// ─────────────────────────────────────────────────────────────────────────────
// Memory Store
// ─────────────────────────────────────────────────────────────────────────────

export class VMMemoryStore {
  private memories: Map<string, MemoryEntry> = new Map();
  private conversations: Map<string, ConversationSummary> = new Map();
  private preferences: Record<string, any> = {};
  private dirty = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ensureDirectories();
    this.load();
    // Auto-save every 30 seconds if dirty
    this.autoSaveTimer = setInterval(() => {
      if (this.dirty) {
        this.save();
        this.dirty = false;
      }
    }, 30_000);
  }

  // ── Directory setup ──

  private ensureDirectories(): void {
    fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  }

  // ── Load / Save ──

  private load(): void {
    // Load memories
    const memPath = path.join(MEMORY_ROOT, MEMORIES_FILE);
    if (fs.existsSync(memPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry?.id) this.memories.set(entry.id, entry);
          }
        }
      } catch (e: any) {
        console.error('[vm-memory] Failed to load memories:', e?.message);
      }
    }

    // Load conversations
    const convPath = path.join(MEMORY_ROOT, CONVERSATIONS_FILE);
    if (fs.existsSync(convPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(convPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            if (entry?.id) this.conversations.set(entry.id, entry);
          }
        }
      } catch (e: any) {
        console.error('[vm-memory] Failed to load conversations:', e?.message);
      }
    }

    // Load preferences
    const prefPath = path.join(MEMORY_ROOT, PREFERENCES_FILE);
    if (fs.existsSync(prefPath)) {
      try {
        this.preferences = JSON.parse(fs.readFileSync(prefPath, 'utf-8'));
      } catch { /* ignore */ }
    }

    console.log(`[vm-memory] Loaded ${this.memories.size} memories, ${this.conversations.size} conversations`);
  }

  save(): void {
    try {
      // Save memories
      const memArr = Array.from(this.memories.values());
      const memJson = JSON.stringify(memArr, null, 2);
      if (Buffer.byteLength(memJson) <= MAX_MEMORY_SIZE_BYTES) {
        fs.writeFileSync(path.join(MEMORY_ROOT, MEMORIES_FILE), memJson);
      } else {
        console.warn('[vm-memory] Memory file too large, trimming oldest entries');
        const sorted = memArr.sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        const trimmed = sorted.slice(0, MAX_MEMORIES);
        fs.writeFileSync(path.join(MEMORY_ROOT, MEMORIES_FILE), JSON.stringify(trimmed, null, 2));
      }

      // Save conversations
      const convArr = Array.from(this.conversations.values());
      fs.writeFileSync(path.join(MEMORY_ROOT, CONVERSATIONS_FILE), JSON.stringify(convArr, null, 2));

      // Save preferences
      fs.writeFileSync(path.join(MEMORY_ROOT, PREFERENCES_FILE), JSON.stringify(this.preferences, null, 2));
    } catch (e: any) {
      console.error('[vm-memory] Save failed:', e?.message);
    }
  }

  // ── Memory CRUD ──

  add(entry: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'hash'>): MemoryEntry {
    // Deduplicate by content hash
    const hash = createHash('sha256').update(entry.content).digest('hex').slice(0, 16);
    const existing = Array.from(this.memories.values()).find(m => m.hash === hash);
    if (existing) {
      // Update existing instead of creating duplicate
      existing.updated_at = new Date().toISOString();
      existing.importance = Math.max(existing.importance, entry.importance);
      if (entry.metadata) {
        existing.metadata = { ...existing.metadata, ...entry.metadata };
      }
      this.dirty = true;
      return existing;
    }

    const now = new Date().toISOString();
    const memory: MemoryEntry = {
      id: randomUUID(),
      ...entry,
      origin: entry.origin || 'cloud_vm',
      hash,
      created_at: now,
      updated_at: now,
    };

    // Evict oldest low-importance memories if at capacity
    if (this.memories.size >= MAX_MEMORIES) {
      this.evictOldest();
    }

    this.memories.set(memory.id, memory);
    this.dirty = true;
    return memory;
  }

  get(id: string): MemoryEntry | null {
    return this.memories.get(id) || null;
  }

  update(id: string, updates: Partial<MemoryEntry>): MemoryEntry | null {
    const entry = this.memories.get(id);
    if (!entry) return null;

    Object.assign(entry, updates, { updated_at: new Date().toISOString() });
    if (updates.content) {
      entry.hash = createHash('sha256').update(updates.content).digest('hex').slice(0, 16);
    }
    this.dirty = true;
    return entry;
  }

  delete(id: string): boolean {
    const existed = this.memories.delete(id);
    if (existed) this.dirty = true;
    return existed;
  }

  list(options?: {
    topic?: string;
    source?: string;
    origin?: MemoryOrigin;
    tags?: string[];
    limit?: number;
    offset?: number;
    minImportance?: number;
  }): MemoryEntry[] {
    let results = Array.from(this.memories.values());

    // Filter expired entries
    const now = Date.now();
    results = results.filter(m => !m.expires_at || new Date(m.expires_at).getTime() > now);

    if (options?.topic) {
      results = results.filter(m => m.topic === options.topic);
    }
    if (options?.source) {
      results = results.filter(m => m.source === options.source);
    }
    if (options?.origin) {
      results = results.filter(m => m.origin === options.origin);
    }
    if (options?.tags && options.tags.length > 0) {
      const tagSet = new Set(options.tags);
      results = results.filter(m => m.tags.some(t => tagSet.has(t)));
    }
    if (options?.minImportance !== undefined) {
      results = results.filter(m => m.importance >= options.minImportance!);
    }

    // Sort by importance then recency
    results.sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return results.slice(offset, offset + limit);
  }

  // ── Search ──

  search(query: string, limit = 20): MemorySearchResult[] {
    if (!query.trim()) return [];

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: MemorySearchResult[] = [];

    for (const entry of this.memories.values()) {
      // Skip expired
      if (entry.expires_at && new Date(entry.expires_at).getTime() < Date.now()) continue;

      let score = 0;
      const matchedFields: string[] = [];

      const contentLower = entry.content.toLowerCase();
      const topicLower = entry.topic.toLowerCase();
      const tagsLower = entry.tags.map(t => t.toLowerCase());

      for (const term of terms) {
        if (contentLower.includes(term)) {
          score += 2;
          if (!matchedFields.includes('content')) matchedFields.push('content');
        }
        if (topicLower.includes(term)) {
          score += 3;
          if (!matchedFields.includes('topic')) matchedFields.push('topic');
        }
        if (tagsLower.some(t => t.includes(term))) {
          score += 2;
          if (!matchedFields.includes('tags')) matchedFields.push('tags');
        }
      }

      // Boost by importance
      score += entry.importance * 0.3;

      // Boost recent entries
      const ageHours = (Date.now() - new Date(entry.updated_at).getTime()) / 3600_000;
      if (ageHours < 24) score += 1;
      else if (ageHours < 168) score += 0.5; // within a week

      if (score > 0) {
        results.push({ entry, score, matchedFields });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ── Conversations ──

  addConversation(summary: Omit<ConversationSummary, 'created_at' | 'updated_at'>): ConversationSummary {
    const now = new Date().toISOString();
    const conv: ConversationSummary = {
      ...summary,
      created_at: now,
      updated_at: now,
    };
    this.conversations.set(conv.id, conv);
    this.dirty = true;
    return conv;
  }

  getConversation(id: string): ConversationSummary | null {
    return this.conversations.get(id) || null;
  }

  updateConversation(id: string, updates: Partial<Pick<ConversationSummary, 'title' | 'summary' | 'message_count' | 'topics'>>): ConversationSummary | null {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    Object.assign(conv, updates, { updated_at: new Date().toISOString() });
    this.dirty = true;
    return conv;
  }

  listConversations(limit = 50): ConversationSummary[] {
    return Array.from(this.conversations.values())
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }

  // ── Preferences ──

  getPreference(key: string, defaultVal?: any): any {
    return this.preferences[key] ?? defaultVal;
  }

  setPreference(key: string, value: any): void {
    this.preferences[key] = value;
    this.dirty = true;
  }

  getPreferences(): Record<string, any> {
    return { ...this.preferences };
  }

  // ── Topics ──

  getTopics(): Array<{ topic: string; count: number; lastUpdated: string }> {
    const topicMap = new Map<string, { count: number; lastUpdated: string }>();
    for (const entry of this.memories.values()) {
      const existing = topicMap.get(entry.topic);
      if (!existing || new Date(entry.updated_at) > new Date(existing.lastUpdated)) {
        topicMap.set(entry.topic, {
          count: (existing?.count || 0) + 1,
          lastUpdated: entry.updated_at,
        });
      } else {
        topicMap.set(entry.topic, {
          count: existing.count + 1,
          lastUpdated: existing.lastUpdated,
        });
      }
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({ topic, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Bulk Operations (for cloud sync) ──

  exportAll(): {
    memories: MemoryEntry[];
    conversations: ConversationSummary[];
    preferences: Record<string, any>;
    exportedAt: string;
  } {
    return {
      memories: Array.from(this.memories.values()),
      conversations: Array.from(this.conversations.values()),
      preferences: { ...this.preferences },
      exportedAt: new Date().toISOString(),
    };
  }

  importAll(data: {
    memories?: MemoryEntry[];
    conversations?: ConversationSummary[];
    preferences?: Record<string, any>;
  }, mode: 'merge' | 'replace' = 'merge'): { imported: number; skipped: number; conflicts: number } {
    let imported = 0;
    let skipped = 0;
    let conflicts = 0;

    if (mode === 'replace') {
      this.memories.clear();
      this.conversations.clear();
      this.preferences = {};
    }

    // Import memories — tag origin as 'desktop' for synced-in data unless already tagged
    if (data.memories) {
      for (const entry of data.memories) {
        if (!entry?.id) continue;
        // Preserve existing origin, default incoming to 'desktop' (synced from desktop)
        if (!entry.origin) entry.origin = 'desktop';
        const existing = this.memories.get(entry.id);
        if (existing) {
          // Merge: keep the newer version
          if (new Date(entry.updated_at) > new Date(existing.updated_at)) {
            this.memories.set(entry.id, entry);
            imported++;
            conflicts++;
          } else {
            skipped++;
          }
        } else {
          this.memories.set(entry.id, entry);
          imported++;
        }
      }
    }

    // Import conversations
    if (data.conversations) {
      for (const conv of data.conversations) {
        if (!conv?.id) continue;
        const existing = this.conversations.get(conv.id);
        if (!existing || new Date(conv.updated_at) > new Date(existing.updated_at)) {
          this.conversations.set(conv.id, conv);
          if (!existing) imported++;
        } else {
          skipped++;
        }
      }
    }

    // Import preferences (merge)
    if (data.preferences) {
      this.preferences = { ...this.preferences, ...data.preferences };
    }

    this.dirty = true;
    this.save();

    return { imported, skipped, conflicts };
  }

  // ── Stats ──

  getStats(): {
    totalMemories: number;
    totalConversations: number;
    topicCount: number;
    diskUsageBytes: number;
    oldestMemory: string | null;
    newestMemory: string | null;
    byOrigin: { cloud_vm: number; desktop: number };
  } {
    const memories = Array.from(this.memories.values());
    let diskUsage = 0;
    try {
      const memPath = path.join(MEMORY_ROOT, MEMORIES_FILE);
      if (fs.existsSync(memPath)) diskUsage += fs.statSync(memPath).size;
      const convPath = path.join(MEMORY_ROOT, CONVERSATIONS_FILE);
      if (fs.existsSync(convPath)) diskUsage += fs.statSync(convPath).size;
    } catch { /* ignore */ }

    // Count memories by origin
    let cloudVmCount = 0;
    let desktopCount = 0;
    for (const m of memories) {
      if (m.origin === 'desktop') desktopCount++;
      else cloudVmCount++; // default to cloud_vm for older entries without origin
    }

    return {
      totalMemories: this.memories.size,
      totalConversations: this.conversations.size,
      topicCount: new Set(memories.map(m => m.topic)).size,
      diskUsageBytes: diskUsage,
      oldestMemory: memories.length > 0
        ? memories.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0].created_at
        : null,
      newestMemory: memories.length > 0
        ? memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
        : null,
      byOrigin: { cloud_vm: cloudVmCount, desktop: desktopCount },
    };
  }

  // ── Utilities ──

  private evictOldest(): void {
    // Remove lowest importance, oldest entries
    const sorted = Array.from(this.memories.values())
      .sort((a, b) => {
        if (a.importance !== b.importance) return a.importance - b.importance;
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      });

    const toRemove = sorted.slice(0, Math.ceil(MAX_MEMORIES * 0.1));
    for (const entry of toRemove) {
      this.memories.delete(entry.id);
    }
  }

  /** Cleanup expired entries */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.memories) {
      if (entry.expires_at && new Date(entry.expires_at).getTime() < now) {
        this.memories.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }

  destroy(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.dirty) {
      this.save();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: VMMemoryStore | null = null;

export function getVMMemoryStore(): VMMemoryStore {
  if (!_instance) {
    _instance = new VMMemoryStore();
  }
  return _instance;
}
