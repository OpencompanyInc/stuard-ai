import {
  AI_TRACK_STEPS,
  MANUAL_TRACK_STEPS,
  type OnboardingStepId,
  type OnboardingTrack,
} from "./useWorkflowOnboarding";

export interface OnboardingStepConfig {
  id: OnboardingStepId;
  title: string;
  body: string;
  targetId?: string;
  placement?: "top" | "bottom" | "left" | "right";
  manualAction?: string;
  autoHint?: string;
  // Optional decorative badge ("Demo", "Manual", etc.) rendered in the coach card.
  badge?: string;
}

// AI track - auto-demoes the build to avoid spending credits.
const AI_STEP_CONFIGS: Record<string, OnboardingStepConfig> = {
  describe: {
    id: "describe",
    title: "Step 1 - Watch the AI build one",
    body:
      "Read the chat while it works. We're simulating a real AI build with no credits used, so you can see how it plans, drops in nodes, registers variables, and uses {{...}} references.",
    targetId: "wf-target-chat",
    placement: "left",
    autoHint: "Building the demo...",
    badge: "Demo / 0 credits",
  },
  understand: {
    id: "understand",
    title: "Step 2 - Four things just happened",
    body:
      "Take a look at the canvas. You now have a trigger, steps, wires, and variables. The steps use {{workflow.task}} to read a variable and {{step_timestamp.formatted}} to pass the timestamp step's output forward.",
    placement: "top",
    manualAction: "Got it - what's next?",
    badge: "Demo / 0 credits",
  },
};

// Manual track - guides the user through a real task-ping workflow:
// Manual Trigger -> Get Current Time -> Set Variable -> Send Notification. It
// teaches workflow variables and step-output interpolation with a runnable result.
const MANUAL_STEP_CONFIGS: Record<string, OnboardingStepConfig> = {
  intro: {
    id: "intro",
    title: "Step 1 - Build a task ping",
    body:
      "You're going to make a one-click task ping. When you press Run, it gets the current time, stores that time with Set Variable, and sends a notification using the saved variable.",
    placement: "top",
    manualAction: "Show me variables",
    badge: "Manual build",
  },
  variables: {
    id: "variables",
    title: "Step 2 - Variables and {{...}}",
    body:
      "Confirm the workflow variables: notificationTitle, taskName, taskOwner, and startedAt. The notification reads these with {{workflow.taskName}} and {{workflow.startedAt}}, and Set Variable updates startedAt during the run.",
    targetId: "wf-target-inspector",
    placement: "left",
    manualAction: "Variables are set",
    badge: "Manual build",
  },
  timestampArgs: {
    id: "timestampArgs",
    title: "Step 3 - Check the time step",
    body:
      "Select Get Current Time and look at its format argument. This step returns formatted, and later the notification will use that output with {{step_timestamp.formatted}}.",
    targetId: "wf-target-inspector",
    placement: "left",
    manualAction: "Time step is ready",
    badge: "Manual build",
  },
  wire: {
    id: "wire",
    title: "Step 4 - Wire the trigger to time",
    body:
      "Connect Manual Trigger to Get Current Time. Click the small dot on the trigger and drag a line to the timestamp node. That wire says: run this step first.",
    placement: "top",
    autoHint: "Advances when the trigger is wired to Get Current Time.",
    badge: "Manual build",
  },
  setVariableArgs: {
    id: "setVariableArgs",
    title: "Step 5 - Check Set Variable",
    body:
      "Select Store Start Time. It should set the workflow variable startedAt to {{step_timestamp.formatted}}. This is where data from one node becomes a reusable variable.",
    targetId: "wf-target-inspector",
    placement: "left",
    manualAction: "Set Variable is ready",
    badge: "Manual build",
  },
  storeWire: {
    id: "storeWire",
    title: "Step 6 - Send time into Set Variable",
    body:
      "Connect Get Current Time to Store Start Time. This makes the timestamp step run before Set Variable tries to read {{step_timestamp.formatted}}.",
    placement: "top",
    autoHint: "Advances when Get Current Time is wired to Store Start Time.",
    badge: "Manual build",
  },
  palette: {
    id: "palette",
    title: "Step 7 - Add Send Notification",
    body:
      "Open the palette on the left, search for Send Notification, and drag it onto the canvas. The tour will fill its title and body with the workflow variables.",
    targetId: "wf-target-palette",
    placement: "right",
    autoHint: "Advances when you add Send Notification.",
    badge: "Manual build",
  },
  notificationArgs: {
    id: "notificationArgs",
    title: "Step 8 - Check notification args",
    body:
      "Select Send Task Ping. Its title should be {{workflow.notificationTitle}}, and its body should include {{workflow.taskName}} plus {{workflow.startedAt}}. That proves the Set Variable step is being used.",
    targetId: "wf-target-inspector",
    placement: "left",
    manualAction: "Notification args are right",
    badge: "Manual build",
  },
  notifyWire: {
    id: "notifyWire",
    title: "Step 9 - Wire Set Variable to notification",
    body:
      "Now connect Store Start Time to Send Task Ping. The notification reads {{workflow.startedAt}}, so Set Variable needs to run before the notification.",
    placement: "top",
    autoHint: "Advances when Store Start Time is wired to Send Task Ping.",
    badge: "Manual build",
  },
};

// Shared steps used by both tracks. These cover the universal lifecycle:
// save, run, inspect logs, and find help. Manual has its own variables step.
const SHARED_STEP_CONFIGS: Record<string, OnboardingStepConfig> = {
  variables: {
    id: "variables",
    title: "Variables and {{...}} syntax",
    body:
      "Open the Inspector. Variables live near the top, and any step can reference them with {{workflow.<name>}}. You can also pull a previous step's output with {{step_id.field}}. Change a variable once and every step that uses it updates.",
    targetId: "wf-target-inspector",
    placement: "left",
    autoHint: "Advances when you open the Inspector.",
  },
  save: {
    id: "save",
    title: "Save before you run",
    body:
      "Workflows execute the saved version on disk, so anything unsaved gets ignored. Stuard will auto-save when you press Run, but here it is: Ctrl+S works too, and the Save button glows whenever you have unsaved changes.",
    targetId: "wf-target-save",
    placement: "bottom",
    manualAction: "Save and continue",
  },
  run: {
    id: "run",
    title: "Test it with Run",
    body:
      "Click the Run button to execute the workflow once, right now. Nothing is deployed yet; this is just a local test against your latest saved version.",
    targetId: "wf-target-run",
    placement: "bottom",
    autoHint: "Advances when the workflow starts running.",
  },
  logs: {
    id: "logs",
    title: "See what happened in Logs",
    body:
      "Open the Logs panel to see every step that ran, the values it returned, and any errors. This is where you confirm variables and {{...}} references were substituted the way you expected.",
    targetId: "wf-target-logs",
    placement: "left",
    autoHint: "Advances when you open the Logs panel.",
  },
  docs: {
    id: "docs",
    title: "Docs is your reference",
    body:
      "When you're stuck on a tool, a variable type, or which {{step_id.field}} paths are available, open Docs. It is the reference for tool args, trigger types, and interpolation patterns Stuard understands.",
    targetId: "wf-target-docs",
    placement: "left",
    manualAction: "Finish tour",
  },
};

export function getOnboardingStepConfig(
  track: OnboardingTrack | null,
  stepId: OnboardingStepId
): OnboardingStepConfig | null {
  if (track === "ai") {
    if (AI_STEP_CONFIGS[stepId]) return withStepNumber(AI_STEP_CONFIGS[stepId], stepId, "ai");
    if (SHARED_STEP_CONFIGS[stepId]) return withStepNumber(SHARED_STEP_CONFIGS[stepId], stepId, "ai");
  }
  if (track === "manual") {
    if (MANUAL_STEP_CONFIGS[stepId]) return withStepNumber(MANUAL_STEP_CONFIGS[stepId], stepId, "manual");
    if (SHARED_STEP_CONFIGS[stepId]) return withStepNumber(SHARED_STEP_CONFIGS[stepId], stepId, "manual");
  }
  return null;
}

// Rewrite the "Step N" prefix in the title based on the step's position in the
// active track, so shared steps get the correct number for each tour.
function withStepNumber(
  cfg: OnboardingStepConfig,
  stepId: OnboardingStepId,
  track: OnboardingTrack
): OnboardingStepConfig {
  const order = track === "ai" ? AI_TRACK_STEPS : MANUAL_TRACK_STEPS;
  const idx = order.indexOf(stepId);
  if (idx < 0) return cfg;
  const cleanTitle = cfg.title.replace(/^Step\s+\d+\s+(?:-|\u2014)\s+/u, "");
  return { ...cfg, title: `Step ${idx + 1} - ${cleanTitle}` };
}

// DOM ids the integration layer is expected to attach. Keep in sync with the
// configs above so we have a single source of truth.
export const ONBOARDING_TARGET_IDS = {
  chat: "wf-target-chat",
  palette: "wf-target-palette",
  run: "wf-target-run",
  logs: "wf-target-logs",
  save: "wf-target-save",
  inspector: "wf-target-inspector",
  docs: "wf-target-docs",
} as const;
