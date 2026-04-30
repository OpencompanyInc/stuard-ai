import type { DesignerModel } from "../types";

export type WorkflowTemplateIcon = "blank" | "function" | "morning" | "starter" | "ui";

export interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  badge: string;
  defaultName: string;
  icon: WorkflowTemplateIcon;
  build: (id: string, name: string) => DesignerModel;
}

function baseModel(id: string, name: string, description: string): Pick<DesignerModel, "id" | "name" | "version" | "description"> {
  return { id, name, version: "1", description };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "blank",
    title: "Blank Workflow",
    description: "A clean canvas with one manual trigger.",
    badge: "Preset",
    defaultName: "Blank Workflow",
    icon: "blank",
    build: (id, name) => ({
      ...baseModel(id, name, "A blank workflow ready for nodes, triggers, and functions."),
      triggers: [{ id: "trig_manual", type: "manual", label: "Manual Trigger", args: {}, position: { x: 80, y: 120 } }],
      nodes: [],
      wires: [],
    }),
  },
  {
    id: "function",
    title: "Function",
    description: "Reusable callable workflow with inputs and a return value.",
    badge: "Function",
    defaultName: "Reusable Function",
    icon: "function",
    build: (id, name) => ({
      ...baseModel(id, name, "A workflow function that can be called from other workflows or published for reuse."),
      triggers: [
        {
          id: "trig_function",
          type: "function",
          label: "Function Input",
          args: {},
          inputParams: [
            { name: "input", type: "string", description: "Input passed by the caller", required: false },
          ],
          position: { x: 80, y: 90 },
        },
      ],
      nodes: [
        {
          id: "step_log_input",
          type: "local.tool",
          tool: "log",
          label: "Log Input",
          args: { message: "Function received: {{args.input}}" },
          fallbackTo: "",
          position: { x: 80, y: 230 },
        },
        {
          id: "step_return",
          type: "local.tool",
          tool: "return_value",
          label: "Return Result",
          args: { value: { input: "{{args.input}}", ok: true }, success: true, message: "Function complete" },
          fallbackTo: "",
          position: { x: 80, y: 370 },
        },
      ],
      wires: [
        { from: "trig_function", to: "step_log_input" },
        { from: "step_log_input", to: "step_return" },
      ],
      outputSchema: [
        { name: "input", type: "string", description: "Echoed input" },
        { name: "ok", type: "boolean", description: "Whether the function completed" },
      ],
    }),
  },
  {
    id: "morning-brief",
    title: "Morning Brief",
    description: "Scheduled news scan, AI summary, and desktop notification.",
    badge: "Brief",
    defaultName: "Morning Brief",
    icon: "morning",
    build: (id, name) => ({
      ...baseModel(id, name, "Creates a daily morning brief from current news and sends it as a notification."),
      triggers: [
        { id: "trig_manual", type: "manual", label: "Run Now", args: {}, position: { x: 80, y: 90 } },
        { id: "trig_morning", type: "schedule.cron", label: "Every Morning", args: { cron: "0 8 * * *" }, position: { x: 80, y: 230 } },
      ],
      nodes: [
        {
          id: "step_date",
          type: "local.tool",
          tool: "get_datetime",
          label: "Get Date",
          args: { format: "dddd, MMMM D, YYYY" },
          fallbackTo: "",
          position: { x: 420, y: 120 },
        },
        {
          id: "step_news",
          type: "cloud.tool",
          tool: "web_search",
          label: "Find Headlines",
          args: { query: "top news this morning technology business world", maxResults: 6 },
          fallbackTo: "",
          position: { x: 420, y: 260 },
        },
        {
          id: "step_brief",
          type: "cloud.tool",
          tool: "ai_inference",
          label: "Write Brief",
          args: {
            prompt: "Write a concise morning brief for {{step_date.formatted}}. Use short sections for priorities, market/tech signals, and one suggested focus. Source material: {{step_news.results}}",
            input: "",
            mode: "text",
          },
          fallbackTo: "",
          position: { x: 420, y: 400 },
        },
        {
          id: "step_notify",
          type: "local.tool",
          tool: "send_notification",
          label: "Notify",
          args: { title: "Morning Brief", body: "{{step_brief.text}}", severity: "info" },
          fallbackTo: "",
          position: { x: 420, y: 540 },
        },
      ],
      wires: [
        { from: "trig_manual", to: "step_date" },
        { from: "trig_morning", to: "step_date" },
        { from: "step_date", to: "step_news" },
        { from: "step_news", to: "step_brief" },
        { from: "step_brief", to: "step_notify" },
      ],
    }),
  },
  {
    id: "hello",
    title: "Starter Workflow",
    description: "Notification, timestamp, clipboard, and log nodes wired up.",
    badge: "Starter",
    defaultName: "Hello World Starter",
    icon: "starter",
    build: (id, name) => ({
      ...baseModel(id, name, "A starter workflow that shows a notification, gets the time, copies text, and logs completion."),
      triggers: [{ id: "trig_0", type: "manual", label: "Manual Trigger", args: {}, position: { x: 60, y: 50 } }],
      nodes: [
        {
          id: "step_welcome",
          type: "local.tool",
          tool: "send_notification",
          label: "Show Welcome Notification",
          args: { title: "Hello from Stuard", body: "Your first workflow is running.", severity: "success" },
          fallbackTo: "",
          position: { x: 60, y: 190 },
        },
        {
          id: "step_now",
          type: "local.tool",
          tool: "get_datetime",
          label: "Get Current Time",
          args: { format: "YYYY-MM-DD HH:mm:ss" },
          fallbackTo: "",
          position: { x: 60, y: 330 },
        },
        {
          id: "step_clipboard",
          type: "local.tool",
          tool: "set_clipboard_content",
          label: "Copy Hello Message",
          args: { text: "Hello World from Stuard! Ran at {{step_now.formatted}}" },
          fallbackTo: "",
          position: { x: 60, y: 470 },
        },
        {
          id: "step_log",
          type: "local.tool",
          tool: "log",
          label: "Log Completion",
          args: { message: "Done! Message copied to clipboard at {{step_now.formatted}}" },
          fallbackTo: "",
          position: { x: 60, y: 610 },
        },
      ],
      wires: [
        { from: "trig_0", to: "step_welcome" },
        { from: "step_welcome", to: "step_now" },
        { from: "step_now", to: "step_clipboard" },
        { from: "step_clipboard", to: "step_log" },
      ],
    }),
  },
];

export function getWorkflowTemplate(templateId?: string): WorkflowTemplate {
  return WORKFLOW_TEMPLATES.find((template) => template.id === templateId) || WORKFLOW_TEMPLATES[0];
}
