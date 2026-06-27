/**
 * Stuard Workflow Builder - Fluent API for creating workflows
 */

import type { StuardSpec, DesignerModel } from './types';
import { parseGuard, type SimpleGuard } from './guards';
import { TOOL_SHORTCUTS } from './shortcuts';
import { compileDesignerModel } from './compiler';

export interface BuilderStep {
  id: string;
  tool: string;
  args: Record<string, any>;
  next: Array<{ to: string; guard?: any; label?: string }>;
  fallback?: { to: string };
}

export interface BuilderTrigger {
  id: string;
  type: string;
  args: Record<string, any>;
}

export interface BuilderBranch {
  condition: string;
  thenSteps: StepInput[];
  elseSteps: StepInput[];
}

export type StepInput =
  | string
  | [string, Record<string, any>?]
  | { tool: string; args?: Record<string, any>; id?: string };

export class WorkflowBuilder {
  private _id: string;
  private _name: string;
  private _version: string = '1';
  private _autostart: boolean = false;
  private _triggers: BuilderTrigger[] = [];
  private _steps: BuilderStep[] = [];
  private _requirements: string = '';
  private _scripts: Record<string, string> = {};
  private _stepCounter: number = 0;
  private _pendingBranch: BuilderBranch | null = null;

  constructor(name: string) {
    this._name = name;
    this._id = this.slugify(name);
  }

  private slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'workflow';
  }

  private nextStepId(prefix: string = 'step'): string {
    return `${prefix}_${this._stepCounter++}`;
  }

  id(id: string): this {
    this._id = id;
    return this;
  }

  version(v: string): this {
    this._version = v;
    return this;
  }

  autostart(enabled: boolean = true): this {
    this._autostart = enabled;
    return this;
  }

  requirements(req: string): this {
    this._requirements = req;
    return this;
  }

  script(name: string, content: string): this {
    this._scripts[name] = content;
    return this;
  }

  trigger(type: string, argsOrShortcut?: Record<string, any> | string): this {
    const id = `trigger_${this._triggers.length}`;
    let args: Record<string, any> = {};

    if (typeof argsOrShortcut === 'string') {
      args = this.parseTriggerShortcut(type, argsOrShortcut);
    } else if (argsOrShortcut) {
      args = argsOrShortcut;
    }

    this._triggers.push({ id, type, args });
    return this;
  }

  private parseTriggerShortcut(type: string, shortcut: string): Record<string, any> {
    switch (type) {
      case 'hotkey':
        return { accelerator: shortcut };
      case 'app_start':
        return {};
      case 'schedule':
      case 'schedule.cron':
        return { cron: shortcut };
      case 'webhook':
        return { mode: 'cloud' };
      case 'webhook.local':
        return { mode: 'local' };
      case 'webhook.cloud':
        return { mode: 'cloud' };
      case 'fs.watch':
        return { path: shortcut };
      case 'gmail.new_email':
        return { profile: 'default', labelIds: ['INBOX'] };
      case 'drive.new_file':
        return { profile: 'default', onlyNew: true, includeFolders: false };
      default:
        return { value: shortcut };
    }
  }

  onHotkey(accelerator: string): this {
    return this.trigger('hotkey', { accelerator });
  }

  onSchedule(cron: string): this {
    return this.trigger('schedule.cron', { cron });
  }

  onAppStart(): this {
    return this.trigger('app_start', {});
  }

  onWebhook(cloud: boolean = false): this {
    return this.trigger(cloud ? 'webhook.cloud' : 'webhook.local', {});
  }

  onFileChange(path: string, pattern?: string): this {
    return this.trigger('fs.watch', { path, pattern });
  }

  onGmailNewEmail(args: { profile?: string; labelIds?: string[]; labelFilterBehavior?: 'INCLUDE' | 'EXCLUDE' } = {}): this {
    return this.trigger('gmail.new_email', {
      profile: args.profile || 'default',
      labelIds: Array.isArray(args.labelIds) && args.labelIds.length > 0 ? args.labelIds : ['INBOX'],
      ...(args.labelFilterBehavior ? { labelFilterBehavior: args.labelFilterBehavior } : {}),
    });
  }

  onDriveNewFile(args: { profile?: string; onlyNew?: boolean; includeFolders?: boolean } = {}): this {
    return this.trigger('drive.new_file', {
      profile: args.profile || 'default',
      onlyNew: args.onlyNew !== false,
      includeFolders: Boolean(args.includeFolders),
    });
  }

  manual(): this {
    return this.trigger('manual', {});
  }

  step(input: StepInput, guard?: SimpleGuard): this {
    const step = this.parseStepInput(input);

    if (this._steps.length > 0) {
      const prev = this._steps[this._steps.length - 1];
      const parsedGuard = guard ? parseGuard(guard) : undefined;
      prev.next.push({ to: step.id, guard: parsedGuard });
    }

    this._steps.push(step);
    return this;
  }

  private parseStepInput(input: StepInput): BuilderStep {
    let tool: string;
    let args: Record<string, any> = {};
    let id: string | undefined;

    if (typeof input === 'string') {
      const resolved = TOOL_SHORTCUTS[input] || { tool: input, args: {} };
      tool = resolved.tool;
      args = resolved.args || {};
    } else if (Array.isArray(input)) {
      const [t, a] = input;
      const resolved = TOOL_SHORTCUTS[t] || { tool: t, args: {} };
      tool = resolved.tool;
      args = { ...resolved.args, ...(a || {}) };
    } else {
      tool = input.tool;
      args = input.args || {};
      id = input.id;
    }

    return {
      id: id || this.nextStepId(),
      tool,
      args,
      next: [],
    };
  }

  branch(condition: string): BranchBuilder {
    return new BranchBuilder(this, condition);
  }

  /** @internal */
  _addBranchSteps(condition: string, thenSteps: StepInput[], elseSteps: StepInput[]): this {
    const conditionStep = this._steps[this._steps.length - 1];
    if (!conditionStep) {
      throw new Error('branch() requires at least one step before it');
    }

    const thenIds: string[] = [];
    const elseIds: string[] = [];

    for (let i = 0; i < thenSteps.length; i++) {
      const step = this.parseStepInput(thenSteps[i]);
      step.id = `${conditionStep.id}_then_${i}`;
      if (i > 0) {
        const prevThen = this._steps[this._steps.length - 1];
        prevThen.next.push({ to: step.id });
      }
      thenIds.push(step.id);
      this._steps.push(step);
    }

    for (let i = 0; i < elseSteps.length; i++) {
      const step = this.parseStepInput(elseSteps[i]);
      step.id = `${conditionStep.id}_else_${i}`;
      if (i > 0) {
        const prevElse = this._steps[this._steps.length - 1];
        prevElse.next.push({ to: step.id });
      }
      elseIds.push(step.id);
      this._steps.push(step);
    }

    const guard = parseGuard(condition);
    const negatedGuard = parseGuard(`!${condition}`);

    if (thenIds.length > 0) {
      conditionStep.next.push({ to: thenIds[0], guard, label: 'then' });
    }
    if (elseIds.length > 0) {
      conditionStep.next.push({ to: elseIds[0], guard: negatedGuard, label: 'else' });
    }

    return this;
  }

  loop(type: 'while' | 'foreach' | 'repeat', config: LoopConfig): this {
    const loopStep: BuilderStep = {
      id: this.nextStepId('loop'),
      tool: 'loop_executor',
      args: {
        type,
        ...config,
      },
      next: [],
    };

    if (this._steps.length > 0) {
      this._steps[this._steps.length - 1].next.push({ to: loopStep.id });
    }

    this._steps.push(loopStep);
    return this;
  }

  build(): StuardSpec {
    if (this._triggers.length === 0) {
      this._triggers.push({ id: 'trigger_0', type: 'manual', args: {} });
    }

    const start = this._steps.length > 0 ? this._steps[0].id : undefined;

    return {
      id: this._id,
      name: this._name,
      version: this._version,
      autostart: this._autostart,
      triggers: this._triggers.map(t => ({ type: t.type, args: t.args })),
      steps: this._steps.map(s => ({
        id: s.id,
        tool: s.tool,
        args: s.args,
        next: s.next.length > 0 ? s.next : undefined,
        fallback: s.fallback,
      })),
      start,
      ...(this._requirements ? { requirements: this._requirements } : {}),
      ...(Object.keys(this._scripts).length > 0 ? { scripts: this._scripts } : {}),
    };
  }

  toCode(): string {
    const lines: string[] = [];
    lines.push(`Stuard.workflow("${this._name}")`);

    if (this._version !== '1') {
      lines.push(`  .version("${this._version}")`);
    }

    if (this._autostart) {
      lines.push(`  .autostart()`);
    }

    for (const t of this._triggers) {
      if (t.type === 'manual') {
        lines.push(`  .manual()`);
      } else if (t.type === 'hotkey') {
        lines.push(`  .onHotkey("${t.args.accelerator}")`);
      } else if (t.type === 'schedule.cron') {
        lines.push(`  .onSchedule("${t.args.cron}")`);
      } else if (t.type === 'webhook.local') {
        lines.push(`  .onWebhook()`);
      } else if (t.type === 'webhook.cloud') {
        lines.push(`  .onWebhook(true)`);
      } else if (t.type === 'gmail.new_email') {
        lines.push(`  .onGmailNewEmail(${JSON.stringify(t.args || {})})`);
      } else if (t.type === 'drive.new_file') {
        lines.push(`  .onDriveNewFile(${JSON.stringify(t.args || {})})`);
      } else {
        lines.push(`  .trigger("${t.type}", ${JSON.stringify(t.args)})`);
      }
    }

    for (const s of this._steps) {
      const argsStr = Object.keys(s.args).length > 0 ? `, ${JSON.stringify(s.args)}` : '';
      lines.push(`  .step("${s.tool}"${argsStr})`);
    }

    lines.push(`  .build()`);
    return lines.join('\n');
  }
}

class BranchBuilder {
  private parent: WorkflowBuilder;
  private condition: string;
  private thenSteps: StepInput[] = [];
  private elseSteps: StepInput[] = [];

  constructor(parent: WorkflowBuilder, condition: string) {
    this.parent = parent;
    this.condition = condition;
  }

  then(...steps: StepInput[]): this {
    this.thenSteps.push(...steps);
    return this;
  }

  else(...steps: StepInput[]): WorkflowBuilder {
    this.elseSteps.push(...steps);
    return this.parent._addBranchSteps(this.condition, this.thenSteps, this.elseSteps);
  }

  end(): WorkflowBuilder {
    return this.parent._addBranchSteps(this.condition, this.thenSteps, []);
  }
}

interface LoopConfig {
  condition?: string;
  items?: string;
  count?: number;
  maxIterations?: number;
  steps: StepInput[];
}

export const Stuard = {
  workflow(name: string): WorkflowBuilder {
    return new WorkflowBuilder(name);
  },

  fromDesigner(model: DesignerModel): StuardSpec {
    return compileDesignerModel(model);
  },
};
