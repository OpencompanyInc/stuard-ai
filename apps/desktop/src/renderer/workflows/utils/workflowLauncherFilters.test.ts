import { describe, expect, it } from "vitest";

import type { WorkflowItem } from "../types";
import {
  buildWorkflowFilterChips,
  matchesWorkflowFilter,
  matchesWorkflowSearch,
} from "./workflowLauncherFilters";

function makeWorkflow(overrides: Partial<WorkflowItem>): WorkflowItem {
  return {
    id: "workflow",
    name: "Workflow",
    ...overrides,
  };
}

describe("workflow launcher filters", () => {
  it("matches search terms against friendly trigger labels", () => {
    const scheduledWorkflow = makeWorkflow({
      id: "daily-report",
      name: "Daily Report",
      triggers: ["schedule.cron"],
    });

    expect(matchesWorkflowSearch(scheduledWorkflow, "schedule")).toBe(true);
    expect(matchesWorkflowSearch(scheduledWorkflow, "daily")).toBe(true);
    expect(matchesWorkflowSearch(scheduledWorkflow, "gmail")).toBe(false);
  });

  it("treats automated triggers separately from manual workflows", () => {
    const manualWorkflow = makeWorkflow({
      id: "manual-flow",
      triggers: ["manual"],
    });
    const hotkeyWorkflow = makeWorkflow({
      id: "hotkey-flow",
      triggers: ["hotkey.release"],
    });

    expect(matchesWorkflowFilter(manualWorkflow, "triggered")).toBe(false);
    expect(matchesWorkflowFilter(hotkeyWorkflow, "triggered")).toBe(true);
    expect(matchesWorkflowFilter(hotkeyWorkflow, "trigger:hotkey")).toBe(true);
  });

  it("builds workflow chips with counts for shared, status, and trigger filters", () => {
    const items: WorkflowItem[] = [
      makeWorkflow({
        id: "manual-flow",
        name: "Manual Flow",
        triggers: ["manual"],
      }),
      makeWorkflow({
        id: "nightly-report",
        name: "Nightly Report",
        triggers: ["schedule.cron"],
      }),
      makeWorkflow({
        id: "mail-triage",
        name: "Mail Triage",
        marketplaceSlug: "community/mail-triage",
        triggers: ["gmail.new_email"],
      }),
    ];

    const workflowChips = buildWorkflowFilterChips(items, { scope: "workflows" });
    expect(workflowChips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "all", count: 3 }),
        expect.objectContaining({ id: "triggered", count: 2 }),
        expect.objectContaining({ id: "shared", count: 1 }),
        expect.objectContaining({ id: "trigger:schedule", count: 1 }),
        expect.objectContaining({ id: "trigger:gmail", count: 1 }),
      ])
    );

    const deployedChips = buildWorkflowFilterChips(items, {
      scope: "deployed",
      runningIds: {
        "nightly-report": true,
      },
    });
    expect(deployedChips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "running", count: 1 }),
        expect.objectContaining({ id: "idle", count: 2 }),
      ])
    );
  });
});
