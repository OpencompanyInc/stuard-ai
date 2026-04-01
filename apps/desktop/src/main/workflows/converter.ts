import type { StuardSpec, StuardStep } from "../stuards";

export type WorkflowStepDefinition = {
  id: string;
  uses: string;
  with?: any;
  if?: string;
  timeoutMs?: number;
  retry?: { times?: number; backoffMs?: number };
  on_error?: "skip" | "halt" | "continue";
  out?: Record<string, any>;
};

export type WorkflowDefinition = {
  name: string;
  version: string;
  description?: string;
  mode?: "auto" | "manual" | "hybrid";
  inputs?: Record<string, any>;
  globals?: any;
  policies?: {
    risk?: "low" | "medium" | "high";
    spend_limit?: number;
    ask_on?: string[];
  };
  triggers?: Array<{ id?: string; type: string; args?: any }>;
  steps: WorkflowStepDefinition[];
  outputs?: Record<string, any>;
};

export type WorkflowToStuardOptions = {
  id?: string;
  triggers?: Array<{ type: string; args?: any }>;
};

function slugifyId(name: string): string {
  const base = String(name || "").trim().toLowerCase();
  if (!base) return "workflow_" + Math.random().toString(36).slice(2, 8);
  return base
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    || "workflow_" + Math.random().toString(36).slice(2, 8);
}

function mapUsesToTool(uses: string): string {
  const u = String(uses || "").trim();
  if (!u) return "";
  if (u.startsWith("local.")) return u.slice("local.".length);
  if (u.startsWith("cloud.")) return u.slice("cloud.".length);
  return u;
}

export function workflowToStuardSpec(def: WorkflowDefinition, options?: WorkflowToStuardOptions): StuardSpec {
  const safeSteps = Array.isArray(def?.steps) ? def.steps : [];
  const id = (options && options.id) ? String(options.id) : slugifyId(def?.name || "");

  const dslTriggersRaw = Array.isArray((def as any)?.triggers) ? (def as any).triggers : [];
  const dslTriggers = dslTriggersRaw
    .map((t: any) => ({ type: String(t?.type || ""), args: t?.args || {} }))
    .filter((t: any) => t.type);

  let triggers: Array<{ type: string; args?: any }>;
  if (Array.isArray(options?.triggers) && options.triggers.length) {
    triggers = options.triggers;
  } else if (dslTriggers.length) {
    triggers = dslTriggers;
  } else {
    triggers = [{ type: "manual", args: {} }];
  }

  const spec: StuardSpec = {
    id,
    name: def?.name || id,
    version: def?.version || "1",
    autostart: def?.mode === "auto",
    triggers,
    steps: [],
    start: undefined,
  };

  const steps: StuardStep[] = [];

  for (let i = 0; i < safeSteps.length; i++) {
    const s = safeSteps[i];
    if (!s || !s.id || !s.uses) continue;
    const mappedTool = mapUsesToTool(s.uses);
    const tool = mappedTool === "run_system_command" ? "run_command" : mappedTool;
    const step: StuardStep = {
      id: String(s.id),
      tool: tool || undefined,
      args: undefined,
      next: undefined,
      fallback: undefined,
    };

    // args: pass-through, with some metadata preserved under reserved keys
    const args: any = s.with ? { ...s.with } : {};
    if (tool === "run_command" && args && typeof args === "object") {
      // Backwards-compat: allow authoring DSL to use "cmd" but map to the agent's "command" field
      if (args.cmd && !args.command) {
        args.command = args.cmd;
      }
      if (mappedTool === "run_system_command" && !args.shell) {
        args.shell = "default";
      }
    }
    if (s.if) {
      // Preserve guard expression for tools or future runtime extensions
      args.__if = String(s.if);
    }
    if (s.out && typeof s.out === "object") {
      args.__out = { ...s.out };
    }
    if (s.timeoutMs || s.retry || s.on_error) {
      args.__control = {
        timeoutMs: s.timeoutMs,
        retry: s.retry,
        on_error: s.on_error,
      };
    }
    if (Object.keys(args).length > 0) {
      step.args = args;
    }

    // default linear control flow: each step points to the next
    if (i < safeSteps.length - 1) {
      const nextId = String(safeSteps[i + 1]?.id || "");
      if (nextId) {
        step.next = [{ to: nextId, guard: "always" }];
      }
    }

    steps.push(step);
  }

  spec.steps = steps;

  // pick start step: first step with no inbound edges, fallback to first
  const inbound = new Set<string>();
  for (const st of steps) {
    const edges = Array.isArray(st.next) ? st.next : [];
    for (const e of edges) {
      if (e && typeof e.to === "string" && e.to) inbound.add(e.to);
    }
  }
  let start: string | undefined;
  for (const st of steps) {
    if (!inbound.has(st.id)) { start = st.id; break; }
  }
  if (!start && steps.length > 0) start = steps[0].id;
  if (start) spec.start = start;

  return spec;
}
