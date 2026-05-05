/**
 * VM Skills Store
 *
 * Persists the user's skills.json on the VM disk so that bot wakeups
 * (vm-bots → /v1/bot/wakeup) can include the right subset of skills in
 * their payload — exactly the way the desktop scheduler does.
 *
 * Source of truth lives on the desktop (`apps/desktop/src/main/skills.ts`).
 * The desktop pushes the full active skill set to the VM via the
 * `skills_sync` command whenever skills change or a bot is deployed.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Mirror of `apps/desktop/src/main/skills.ts` — keep field names in sync.
export type SkillStepType = 'prompt' | 'tool' | 'condition' | 'output';

export interface SkillStep {
  id: string;
  type: SkillStepType;
  label: string;
  content: string;
  toolName?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  trigger?: string;
  steps?: SkillStep[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  source?: 'auto' | 'manual';
  metadata?: Record<string, any>;
}

const SKILLS_DIR = process.env.STUARD_VM_DATA_DIR
  || path.join(os.homedir(), 'agent-data');
const SKILLS_FILE = path.join(SKILLS_DIR, 'skills.json');

let cache: Skill[] | null = null;

function readFromDisk(): Skill[] {
  try {
    if (!fs.existsSync(SKILLS_FILE)) return [];
    const raw = fs.readFileSync(SKILLS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as Skill[]) : [];
  } catch (e: any) {
    console.warn('[vm-skills] Failed to read skills.json:', e?.message || e);
    return [];
  }
}

function writeToDisk(skills: Skill[]): void {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const tmp = `${SKILLS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(skills, null, 2), 'utf8');
  fs.renameSync(tmp, SKILLS_FILE);
}

export function loadSkills(): Skill[] {
  if (cache) return cache;
  cache = readFromDisk();
  return cache;
}

/** Replace the entire skills.json — desktop is the source of truth. */
export function saveSkills(skills: Skill[]): { ok: true; count: number } {
  const next = Array.isArray(skills) ? skills : [];
  writeToDisk(next);
  cache = next;
  console.log(`[vm-skills] Synced ${next.length} skill${next.length === 1 ? '' : 's'} from desktop`);
  return { ok: true, count: next.length };
}

/**
 * Active skills filtered by a bot's selection. Mirrors the rules in
 * `apps/desktop/src/main/services/proactive-scheduler.ts`:
 *   - skillIds === undefined → inherit all globally-active skills (legacy)
 *   - skillIds === []        → opt-out (no skills)
 *   - skillIds === [ids…]    → only those, intersected with active
 */
export function getActiveSkillsForBot(skillIds: string[] | undefined): Skill[] {
  const allActive = loadSkills().filter(s => s.isActive !== false);
  if (skillIds === undefined) return allActive;
  if (skillIds.length === 0) return [];
  const wanted = new Set(skillIds.map(String));
  return allActive.filter(s => wanted.has(s.id));
}

export function getStats(): { count: number; activeCount: number; path: string } {
  const skills = loadSkills();
  return {
    count: skills.length,
    activeCount: skills.filter(s => s.isActive !== false).length,
    path: SKILLS_FILE,
  };
}
