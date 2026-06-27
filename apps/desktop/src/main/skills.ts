import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';

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
  source?: 'auto' | 'manual';
  metadata?: Record<string, any>;
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
  fs.mkdirSync(path.dirname(SKILLS_FILE), { recursive: true });
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skillsCache, null, 2), 'utf8');
}

function broadcastSkillsUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('skills:updated', skillsCache);
    } catch {}
  }
  // Mirror to the cloud VM so any deployed bots see the change on the next
  // wakeup. Fire-and-forget; runtime-required to avoid an import cycle with
  // bot-vm-deploy.ts.
  try {
    const mod = require('./services/bot-vm-deploy');
    if (mod && typeof mod.pushSkillsToVm === 'function') {
      mod.pushSkillsToVm().catch(() => { /* non-fatal */ });
    }
  } catch { /* desktop-only build path; safe to ignore */ }
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
  const previousSkills = skillsCache;
  try {
    const idx = skillsCache.findIndex(s => s.id === skill.id);
    const nextSkills = [...skillsCache];
    if (idx >= 0) {
      nextSkills[idx] = { ...skill, updatedAt: new Date().toISOString() };
    } else {
      nextSkills.push(skill);
    }
    skillsCache = nextSkills;
    saveSkills();
    broadcastSkillsUpdated();
    return { ok: true };
  } catch (e: any) {
    skillsCache = previousSkills;
    console.error('[skills] Failed to save skills:', e);
    return { ok: false, error: e?.message || 'save_failed' };
  }
}

export function skills_delete(id: string): { ok: boolean; error?: string } {
  const previousSkills = skillsCache;
  try {
    const nextSkills = skillsCache.filter(s => s.id !== id);
    if (nextSkills.length === skillsCache.length) return { ok: false, error: 'skill_not_found' };
    skillsCache = nextSkills;
    saveSkills();
    broadcastSkillsUpdated();
    return { ok: true };
  } catch (e: any) {
    skillsCache = previousSkills;
    console.error('[skills] Failed to delete skill:', e);
    return { ok: false, error: e?.message || 'delete_failed' };
  }
}

export function skills_toggle(id: string): { ok: boolean; isActive?: boolean; error?: string } {
  const previousSkills = skillsCache;
  try {
    const idx = skillsCache.findIndex(s => s.id === id);
    if (idx < 0) return { ok: false, error: 'skill_not_found' };
    const current = skillsCache[idx];
    const toggled = {
      ...current,
      isActive: !current.isActive,
      updatedAt: new Date().toISOString(),
    };
    skillsCache = skillsCache.map((skill, skillIdx) => skillIdx === idx ? toggled : skill);
    saveSkills();
    broadcastSkillsUpdated();
    return { ok: true, isActive: toggled.isActive };
  } catch (e: any) {
    skillsCache = previousSkills;
    console.error('[skills] Failed to toggle skill:', e);
    return { ok: false, error: e?.message || 'toggle_failed' };
  }
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
