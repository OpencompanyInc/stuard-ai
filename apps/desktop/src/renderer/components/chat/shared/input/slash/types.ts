import type { LucideIcon } from 'lucide-react';

/** One parameter the composer renders as an inline token field. */
export interface SlashFieldSpec {
  key: string;
  /** Ghost hint text shown while the field is empty. */
  hint: string;
  /** 'when' fields get live natural-language date parsing + preview. */
  kind: 'text' | 'when' | 'select';
  required?: boolean;
  /** For kind 'select': cycled by clicking the token. */
  options?: string[];
  defaultValue?: string;
  /** Workflow param type ('string' | 'number' | 'boolean' | 'json' | 'array') for coercion. */
  paramType?: string;
}

export interface SlashRunResult {
  ok: boolean;
  /** Short confirmation shown in the composer ("Reminder set · Today 5:00 PM"). */
  message: string;
}

/** A command the slash menu can offer. */
export interface SlashCommandSpec {
  id: string;
  /** Menu + chip label, e.g. "Remind me". */
  title: string;
  /** Menu subtitle, e.g. "Get pinged at a time". */
  subtitle: string;
  icon: LucideIcon;
  fields: SlashFieldSpec[];
  run: (values: Record<string, string>) => Promise<SlashRunResult>;
}

/** Flat row in the slash menu — a built-in command or a runnable workflow. */
export interface SlashMenuItem {
  key: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Workflows render with the workflow tile color + a "Workflow" badge. */
  kind: 'command' | 'workflow';
  onSelect: () => void;
}

export type SlashPhase = 'editing' | 'working' | 'done' | 'error';

/** Active composer session (a command was chosen, fields are being filled). */
export interface SlashSession {
  commandId: string;
  title: string;
  icon: LucideIcon;
  fields: SlashFieldSpec[];
  run: (values: Record<string, string>) => Promise<SlashRunResult>;
}
