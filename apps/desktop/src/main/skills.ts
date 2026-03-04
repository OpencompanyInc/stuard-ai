import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ============================================================================
// TYPES
// ============================================================================

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
  icon: string;
  color: string;
  trigger: string;
  steps: SkillStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// STORAGE
// ============================================================================

const SKILLS_FILE = path.join(app.getPath('userData'), 'skills.json');
let skillsCache: Skill[] = [];

export function loadSkills(): Skill[] {
  try {
    if (fs.existsSync(SKILLS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        skillsCache = data;
      }
    }
  } catch (e) {
    console.error('[skills] Failed to load skills:', e);
  }
  return skillsCache;
}

function saveSkills(): void {
  try {
    fs.writeFileSync(SKILLS_FILE, JSON.stringify(skillsCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[skills] Failed to save skills:', e);
  }
}

// ============================================================================
// CRUD
// ============================================================================

export function skills_list(): { ok: boolean; skills: Skill[] } {
  return { ok: true, skills: skillsCache };
}

export function skills_get(id: string): { ok: boolean; skill?: Skill; error?: string } {
  const skill = skillsCache.find(s => s.id === id);
  if (!skill) return { ok: false, error: 'skill_not_found' };
  return { ok: true, skill };
}

export function skills_save(skill: Skill): { ok: boolean; error?: string } {
  try {
    const idx = skillsCache.findIndex(s => s.id === skill.id);
    if (idx >= 0) {
      skillsCache[idx] = { ...skill, updatedAt: new Date().toISOString() };
    } else {
      skillsCache.push(skill);
    }
    saveSkills();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'save_failed' };
  }
}

export function skills_delete(id: string): { ok: boolean; error?: string } {
  const before = skillsCache.length;
  skillsCache = skillsCache.filter(s => s.id !== id);
  if (skillsCache.length === before) return { ok: false, error: 'skill_not_found' };
  saveSkills();
  return { ok: true };
}

export function skills_toggle(id: string): { ok: boolean; isActive?: boolean; error?: string } {
  const skill = skillsCache.find(s => s.id === id);
  if (!skill) return { ok: false, error: 'skill_not_found' };
  skill.isActive = !skill.isActive;
  skill.updatedAt = new Date().toISOString();
  saveSkills();
  return { ok: true, isActive: skill.isActive };
}

/**
 * Get active skills summary for injection into agent system prompt.
 * Returns compact name + description pairs.
 */
export function getActiveSkillsSummary(): Array<{ id: string; name: string; description: string; trigger: string }> {
  return skillsCache
    .filter(s => s.isActive)
    .map(s => ({ id: s.id, name: s.name, description: s.description, trigger: s.trigger }));
}
