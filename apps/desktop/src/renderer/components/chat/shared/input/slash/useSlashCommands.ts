/**
 * Slash-command controller — one instance per input host (compact pill,
 * expanded overlay, window-mode chat input).
 *
 * Lifecycle: typing "/" opens the menu (built-ins + runnable workflows).
 * Selecting an entry clears the query and opens a composer session whose
 * fields come from the command spec — or, for workflows, from the trigger's
 * declared inputParams. Param-less workflows run immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { getValidAccessToken } from '../../../../../auth/authManager';
import {
  BUILTIN_COMMANDS,
  buildWorkflowSession,
  listSlashWorkflows,
  type SlashWorkflowItem,
} from './commands';
import type { SlashMenuItem, SlashPhase, SlashSession } from './types';

export interface UseSlashCommandsArgs {
  query: string;
  setQuery: (q: string) => void;
  /** Pause entirely (file-nav overlay open, voice active, …). */
  enabled?: boolean;
}

export interface UseSlashCommandsResult {
  /** True while the menu is open OR a composer session is active. */
  active: boolean;
  menuOpen: boolean;
  menuItems: SlashMenuItem[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  /** Returns true when the event was consumed (menu navigation/selection). */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;

  session: SlashSession | null;
  values: Record<string, string>;
  phase: SlashPhase;
  statusMsg: string;
  setValue: (key: string, value: string) => void;
  submit: () => void;
  cancel: () => void;
}

const DONE_RESET_MS = 1800;

export function useSlashCommands({ query, setQuery, enabled = true }: UseSlashCommandsArgs): UseSlashCommandsResult {
  const [workflows, setWorkflows] = useState<SlashWorkflowItem[]>([]);
  const [session, setSession] = useState<SlashSession | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<SlashPhase>('editing');
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSeqRef = useRef(0);

  // Slash token: query must START with '/' (slash mid-sentence is just text).
  const token = enabled && !session && query.startsWith('/') ? query.slice(1) : null;

  // Re-arm after dismiss once the user leaves slash mode.
  useEffect(() => {
    if (token === null && dismissed) setDismissed(false);
  }, [token, dismissed]);

  // Lazy-load workflows the first time the menu opens (cached in commands.ts).
  const wantsMenu = token !== null && !dismissed;
  useEffect(() => {
    if (!wantsMenu) return;
    let cancelled = false;
    listSlashWorkflows().then((items) => {
      if (!cancelled) setWorkflows(items);
    });
    return () => { cancelled = true; };
  }, [wantsMenu]);

  const reset = useCallback(() => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    runSeqRef.current += 1;
    setSession(null);
    setValues({});
    setPhase('editing');
    setStatusMsg('');
  }, []);

  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
  }, []);

  const beginSession = useCallback((next: SlashSession) => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    const defaults: Record<string, string> = {};
    for (const f of next.fields) {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    }
    setSession(next);
    setValues(defaults);
    setPhase('editing');
    setStatusMsg('');
    setQuery('');
  }, [setQuery]);

  const runSession = useCallback(async (s: SlashSession, vals: Record<string, string>) => {
    const seq = ++runSeqRef.current;
    setPhase('working');
    setStatusMsg('');
    let result: { ok: boolean; message: string };
    try {
      result = await s.run(vals);
    } catch (e: any) {
      result = { ok: false, message: e?.message || 'Something went wrong' };
    }
    if (runSeqRef.current !== seq) return; // cancelled mid-flight
    if (result.ok) {
      setPhase('done');
      setStatusMsg(result.message);
      doneTimerRef.current = setTimeout(reset, DONE_RESET_MS);
    } else {
      setPhase('error');
      setStatusMsg(result.message);
    }
  }, [reset]);

  const selectWorkflow = useCallback(async (wf: SlashWorkflowItem) => {
    // Provisional session so the composer appears instantly while the model loads.
    beginSession({ commandId: `run:${wf.id}`, title: wf.name, icon: Play, fields: [], run: async () => ({ ok: true, message: '' }) });
    setPhase('working');
    const built = await buildWorkflowSession(wf, () => getValidAccessToken().catch(() => null));
    if (built.fields.length === 0) {
      // No trigger params — fire immediately.
      setSession(built);
      void runSession(built, {});
      return;
    }
    const defaults: Record<string, string> = {};
    for (const f of built.fields) {
      if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
    }
    setSession(built);
    setValues(defaults);
    setPhase('editing');
  }, [beginSession, runSession]);

  const menuItems = useMemo<SlashMenuItem[]>(() => {
    if (token === null || dismissed) return [];
    const t = token.toLowerCase();

    const wfRows = (filter: string, cap: number): SlashMenuItem[] => {
      const f = filter.trim().toLowerCase();
      return workflows
        .filter((w) => !f || w.name.toLowerCase().includes(f) || w.id.toLowerCase().includes(f))
        .slice(0, cap)
        .map((w) => ({
          key: `wf-${w.id}`,
          title: w.name,
          subtitle: w.description?.trim() || 'Run this workflow',
          icon: Play,
          kind: 'workflow' as const,
          onSelect: () => { void selectWorkflow(w); },
        }));
    };

    // Stage 2: "/run <filter>" lists only workflows.
    const runStage = t.match(/^run\s+(.*)$/);
    if (runStage) return wfRows(runStage[1], 8);

    const items: SlashMenuItem[] = [];
    for (const cmd of BUILTIN_COMMANDS) {
      if (t && !cmd.id.startsWith(t) && !cmd.title.toLowerCase().includes(t)) continue;
      items.push({
        key: `cmd-${cmd.id}`,
        title: cmd.title,
        subtitle: cmd.subtitle,
        icon: cmd.icon,
        kind: 'command',
        onSelect: () => beginSession({ commandId: cmd.id, title: cmd.title, icon: cmd.icon, fields: cmd.fields, run: cmd.run }),
      });
    }
    if (!t || 'run'.startsWith(t) || 'workflow'.includes(t)) {
      items.push({
        key: 'cmd-run',
        title: 'Run workflow',
        subtitle: 'Pick a workflow, fill its inputs',
        icon: Play,
        kind: 'command',
        onSelect: () => setQuery('/run '),
      });
    }
    // Direct workflow-name matches surface alongside the built-ins.
    if (t.length >= 2) items.push(...wfRows(t, 5));
    return items;
  }, [token, dismissed, workflows, beginSession, selectWorkflow, setQuery]);

  const menuOpen = wantsMenu && menuItems.length > 0;

  // Keep selection in range; snap to top when the token changes.
  useEffect(() => { setSelectedIndex(0); }, [token]);
  useEffect(() => {
    setSelectedIndex((i) => (menuItems.length === 0 ? 0 : Math.min(i, menuItems.length - 1)));
  }, [menuItems.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!menuOpen) return false;
    const isEnter = e.key === 'Enter' || (e as any).code === 'NumpadEnter';
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((i) => (i + delta + menuItems.length) % menuItems.length);
      return true;
    }
    if ((isEnter && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const item = menuItems[Math.min(selectedIndex, menuItems.length - 1)];
      item?.onSelect();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  }, [menuOpen, menuItems, selectedIndex]);

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Editing after an error clears the stale message.
    setPhase((p) => (p === 'error' ? 'editing' : p));
  }, []);

  const submit = useCallback(() => {
    if (!session || phase === 'working' || phase === 'done') return;
    const missing = session.fields.find((f) => f.required && !String(values[f.key] || '').trim());
    if (missing) {
      setPhase('error');
      setStatusMsg(`Fill in "${missing.hint.replace(/…$/, '')}"`);
      return;
    }
    void runSession(session, values);
  }, [session, phase, values, runSession]);

  const cancel = useCallback(() => { reset(); }, [reset]);

  return {
    active: menuOpen || session !== null,
    menuOpen,
    menuItems,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    session,
    values,
    phase,
    statusMsg,
    setValue,
    submit,
    cancel,
  };
}
