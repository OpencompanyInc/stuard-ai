import type { WorkflowItem } from "../types";

export type WorkflowLauncherScope = "workflows" | "shared" | "deployed";
export type WorkflowLauncherFilterId =
  | "all"
  | "shared"
  | "triggered"
  | "running"
  | "idle"
  | `trigger:${string}`;

export interface WorkflowDeployStatus {
  deployed?: boolean;
  running?: boolean;
  triggers?: string[];
}

export interface WorkflowFilterChip {
  id: WorkflowLauncherFilterId;
  label: string;
  count: number;
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  app_start: "App Start",
  webhook: "Webhook",
  schedule: "Schedule",
  hotkey: "Hotkey",
  keystroke: "Keystroke",
  gmail: "Gmail",
  drive: "Drive",
  file_watch: "File Watch",
  script_watch: "Script Watch",
  function: "Function",
  outlook: "Outlook",
};

function titleCase(value: string): string {
  return value
    .split(/[\s._:-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isItemRunning(
  id: string,
  deployStatuses?: Record<string, WorkflowDeployStatus | undefined>,
  runningIds?: Record<string, boolean | undefined>
): boolean {
  return Boolean(runningIds?.[id] || deployStatuses?.[id]?.running);
}

export function normalizeTriggerKey(triggerType: string): string {
  const value = String(triggerType || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "manual") return "manual";
  if (value === "app_start") return "app_start";
  if (value === "webhook") return "webhook";
  if (value === "schedule.cron") return "schedule";
  if (value.startsWith("hotkey")) return "hotkey";
  if (value === "keystroke") return "keystroke";
  if (value.startsWith("gmail.")) return "gmail";
  if (value.startsWith("drive.")) return "drive";
  if (value === "fs.watch") return "file_watch";
  if (value === "command.watch") return "script_watch";
  if (value === "function") return "function";
  if (value.startsWith("outlook.")) return "outlook";
  return value.replace(/[._]/g, " ");
}

export function getTriggerFilterLabel(triggerType: string): string {
  const normalized = normalizeTriggerKey(triggerType);
  if (!normalized) return "Trigger";
  return TRIGGER_LABELS[normalized] || titleCase(normalized);
}

export function getWorkflowTriggerKeys(
  item: Pick<WorkflowItem, "triggers">,
  deployStatus?: WorkflowDeployStatus
): string[] {
  const rawTriggers =
    Array.isArray(item.triggers) && item.triggers.length
      ? item.triggers
      : Array.isArray(deployStatus?.triggers)
      ? deployStatus.triggers || []
      : [];

  return unique(rawTriggers.map((trigger) => normalizeTriggerKey(trigger)).filter(Boolean));
}

export function getWorkflowAutomationTriggerKeys(
  item: Pick<WorkflowItem, "triggers">,
  deployStatus?: WorkflowDeployStatus
): string[] {
  return getWorkflowTriggerKeys(item, deployStatus).filter((trigger) => trigger !== "manual");
}

export function matchesWorkflowSearch(
  item: Pick<WorkflowItem, "id" | "name" | "description" | "triggers">,
  query: string,
  deployStatus?: WorkflowDeployStatus
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const triggerKeys = getWorkflowTriggerKeys(item, deployStatus);
  const haystack = [
    item.id,
    item.name,
    item.description,
    ...(item.triggers || []),
    ...triggerKeys,
    ...triggerKeys.map((trigger) => getTriggerFilterLabel(trigger)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function matchesWorkflowFilter(
  item: Pick<WorkflowItem, "marketplaceSlug" | "triggers">,
  filterId: WorkflowLauncherFilterId,
  deployStatus?: WorkflowDeployStatus,
  isRunning = false
): boolean {
  switch (filterId) {
    case "all":
      return true;
    case "shared":
      return Boolean(item.marketplaceSlug);
    case "triggered":
      return getWorkflowAutomationTriggerKeys(item, deployStatus).length > 0;
    case "running":
      return isRunning;
    case "idle":
      return !isRunning;
    default:
      if (!filterId.startsWith("trigger:")) return true;
      return getWorkflowAutomationTriggerKeys(item, deployStatus).includes(filterId.slice("trigger:".length));
  }
}

export function getWorkflowFilterLabel(filterId: WorkflowLauncherFilterId): string {
  switch (filterId) {
    case "all":
      return "All";
    case "shared":
      return "Shared";
    case "triggered":
      return "Triggers";
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    default:
      return filterId.startsWith("trigger:")
        ? getTriggerFilterLabel(filterId.slice("trigger:".length))
        : "All";
  }
}

export function buildWorkflowFilterChips(
  items: WorkflowItem[],
  options: {
    scope: WorkflowLauncherScope;
    deployStatuses?: Record<string, WorkflowDeployStatus | undefined>;
    runningIds?: Record<string, boolean | undefined>;
    maxTriggerChips?: number;
  }
): WorkflowFilterChip[] {
  const { scope, deployStatuses, runningIds, maxTriggerChips = 4 } = options;
  const chips: WorkflowFilterChip[] = [{ id: "all", label: "All", count: items.length }];

  const triggeredCount = items.filter((item) =>
    matchesWorkflowFilter(item, "triggered", deployStatuses?.[item.id], isItemRunning(item.id, deployStatuses, runningIds))
  ).length;
  if (triggeredCount > 0) {
    chips.push({ id: "triggered", label: "Triggers", count: triggeredCount });
  }

  if (scope === "workflows") {
    const sharedCount = items.filter((item) => Boolean(item.marketplaceSlug)).length;
    if (sharedCount > 0) {
      chips.push({ id: "shared", label: "Shared", count: sharedCount });
    }
  }

  if (scope === "deployed") {
    const runningCount = items.filter((item) => isItemRunning(item.id, deployStatuses, runningIds)).length;
    const idleCount = items.length - runningCount;
    if (runningCount > 0) {
      chips.push({ id: "running", label: "Running", count: runningCount });
    }
    if (idleCount > 0) {
      chips.push({ id: "idle", label: "Idle", count: idleCount });
    }
  }

  const triggerCounts = new Map<string, number>();
  for (const item of items) {
    for (const trigger of getWorkflowAutomationTriggerKeys(item, deployStatuses?.[item.id])) {
      triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
    }
  }

  const dynamicTriggerChips: WorkflowFilterChip[] = Array.from(triggerCounts.entries())
    .sort((a, b) => b[1] - a[1] || getTriggerFilterLabel(a[0]).localeCompare(getTriggerFilterLabel(b[0])))
    .slice(0, maxTriggerChips)
    .map(([trigger, count]) => ({
      id: `trigger:${trigger}` as WorkflowLauncherFilterId,
      label: getTriggerFilterLabel(trigger),
      count,
    }));

  return [...chips, ...dynamicTriggerChips];
}
