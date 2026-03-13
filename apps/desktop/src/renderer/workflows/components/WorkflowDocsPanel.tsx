import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Search, X, ChevronDown, ChevronRight, Copy, Check,
  BookOpen, Zap, GitBranch, Box, Layout, Repeat, Shield,
  FileCode, Globe, Braces, Terminal, Workflow, ArrowRight,
  Keyboard, MousePointer2, Camera, Mail, Bot, Database,
  FolderOpen, HardDrive, Speaker, Eye, Clock, Link,
  type LucideIcon
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DocSection {
  id: string;
  title: string;
  icon: LucideIcon;
  color: string;
  entries: DocEntry[];
}

interface DocEntry {
  id: string;
  title: string;
  summary: string;
  content: DocContent[];
  tags: string[];
}

type DocContent =
  | { type: "text"; value: string }
  | { type: "code"; language: string; value: string; label?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "tip"; value: string }
  | { type: "warning"; value: string }
  | { type: "heading"; value: string };

// ─── Copy Button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 p-1 rounded transition-all opacity-0 group-hover:opacity-100 wf-surface-muted wf-fg-faint hover:wf-fg hover:brightness-110"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ─── Content Renderers ───────────────────────────────────────────────────────

function RenderContent({ item }: { item: DocContent }) {
  switch (item.type) {
    case "text":
      return (
        <p className="text-[12px] leading-relaxed wf-fg-muted whitespace-pre-line">
          {renderInlineCode(item.value)}
        </p>
      );
    case "heading":
      return <h4 className="text-[12px] font-bold wf-fg mt-3 mb-1">{item.value}</h4>;
    case "code":
      return (
        <div className="relative group my-1.5">
          {item.label && (
            <div className="text-[10px] font-medium wf-fg-faint uppercase tracking-wider mb-0.5">{item.label}</div>
          )}
          <pre className="rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto font-mono wf-bg-sunken border wf-border-subtle wf-fg">
            <code>{item.value}</code>
          </pre>
          <CopyButton text={item.value} />
        </div>
      );
    case "table":
      return (
        <div className="my-1.5 overflow-x-auto rounded-lg border wf-border-subtle">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b wf-border-subtle wf-bg-overlay">
                {item.headers.map((h, i) => (
                  <th key={i} className="px-2.5 py-1.5 text-left font-semibold wf-fg">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row, ri) => (
                <tr key={ri} className="border-b wf-border-subtle last:border-0 hover:wf-hover">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 wf-fg-muted font-mono">{renderInlineCode(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "tip":
      return (
        <div className="my-1.5 flex gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-emerald-400 text-[11px] mt-0.5 shrink-0">💡</span>
          <span className="text-[11px] text-emerald-600 leading-relaxed">{renderInlineCode(item.value)}</span>
        </div>
      );
    case "warning":
      return (
        <div className="my-1.5 flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <span className="text-amber-400 text-[11px] mt-0.5 shrink-0">⚠️</span>
          <span className="text-[11px] text-amber-600 leading-relaxed">{renderInlineCode(item.value)}</span>
        </div>
      );
    default:
      return null;
  }
}

function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="px-1 py-0.5 rounded text-[10.5px] font-mono text-indigo-500 wf-surface-muted">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Documentation Data ──────────────────────────────────────────────────────

const DOCS: DocSection[] = [
  // ━━━ TEMPLATES ━━━
  {
    id: "templates",
    title: "Templates {{ }}",
    icon: Braces,
    color: "indigo",
    entries: [
      {
        id: "template-basics",
        title: "Template Basics",
        summary: "Inject dynamic values into node arguments using {{path}} syntax",
        tags: ["template", "mustache", "interpolation", "dynamic", "variable"],
        content: [
          { type: "text", value: "Templates use double curly braces `{{ }}` to inject dynamic values into node arguments at runtime. They can reference outputs from previous steps, trigger data, variables, and more." },
          { type: "code", language: "json", value: `// In a node's args:\n{\n  "message": "Screenshot saved at {{take_ss.filePath}}",\n  "prompt": "Analyze this: {{read_file.content}}"\n}`, label: "Example" },
          { type: "tip", value: "Templates are resolved just before a node executes. If the referenced value doesn't exist, the raw template string is left as-is." },
        ],
      },
      {
        id: "template-sources",
        title: "Template Sources",
        summary: "All available sources: step outputs, trigger data, variables, workspace, loops",
        tags: ["template", "source", "context", "path", "reference"],
        content: [
          { type: "table", headers: ["Source", "Syntax", "Example"], rows: [
            ["Step output", "`{{stepId.field}}`", "`{{step_1.ok}}`, `{{step_1.text}}`"],
            ["Trigger data", "`{{trigger.data.param}}`", "`{{trigger.data.username}}`"],
            ["Webhook body", "`{{webhook.body}}`", "`{{webhook.body.action}}`"],
            ["Workflow vars", "`{{workflow.varName}}`", "`{{workflow.outputDir}}`"],
            ["Runtime vars", "`{{$vars.name}}`", "`{{$vars.counter}}`"],
            ["Workspace", "`{{$workspace.path}}`", "`{{$workspace.scripts}}`"],
            ["Loop vars", "`{{loop.item}}`", "`{{loop.index}}`"],
            ["Function args", "`{{args.input}}`", "`{{args.options}}`"],
          ]},
          { type: "heading", value: "Common Step Output Fields" },
          { type: "table", headers: ["Field", "Available From"], rows: [
            ["`{{step.ok}}`", "All tools (boolean success)"],
            ["`{{step.text}}`", "`ai_inference`, `agent_node`"],
            ["`{{step.json}}`", "`ai_inference` (mode: json)"],
            ["`{{step.embedding}}`", "`ai_inference` (mode: embedding)"],
            ["`{{step.stdout}}`", "`run_command`, `run_python_script`"],
            ["`{{step.filePath}}`", "`take_screenshot`, `capture_media`"],
            ["`{{step.content}}`", "`read_file`"],
            ["`{{step.data}}`", "`custom_ui` (submitted form data)"],
            ["`{{step.action}}`", "`custom_ui` (button clicked)"],
            ["`{{step.entries}}`", "`list_directory`"],
            ["`{{step.value}}`", "`get_variable`"],
          ]},
        ],
      },
      {
        id: "template-nested",
        title: "Nested & JSON Templates",
        summary: "Access nested fields and use templates in complex objects",
        tags: ["template", "nested", "json", "deep", "dot notation"],
        content: [
          { type: "text", value: "You can traverse nested objects using dot notation. Templates work inside strings anywhere in the args object." },
          { type: "code", language: "json", value: `// Accessing nested JSON from ai_inference\n{\n  "prompt": "The user said: {{ai_step.json.response.text}}",\n  "count": "{{ai_step.json.items.length}}"\n}\n\n// Using in HTTP request headers\n{\n  "url": "https://api.example.com/{{webhook.body.endpoint}}",\n  "headers": {\n    "Authorization": "Bearer {{workflow.apiKey}}"\n  }\n}` },
        ],
      },
    ],
  },

  // ━━━ TRIGGERS ━━━
  {
    id: "triggers",
    title: "Triggers",
    icon: Zap,
    color: "amber",
    entries: [
      {
        id: "trigger-types",
        title: "Trigger Types",
        summary: "All available trigger types and their args",
        tags: ["trigger", "start", "hotkey", "cron", "webhook", "schedule"],
        content: [
          { type: "text", value: "Triggers start workflow execution. A workflow can have multiple triggers." },
          { type: "table", headers: ["Type", "Description", "Key Args"], rows: [
            ["`manual`", "Click Run button", "None"],
            ["`hotkey`", "Keyboard shortcut", "`accelerator`, `hold?`, `passthrough?`"],
            ["`hotkey.release`", "Key release event", "`accelerator`"],
            ["`keystroke`", "Type a text sequence anywhere", "`sequence`"],
            ["`schedule.cron`", "Cron schedule", "`cron` (e.g. `0 9 * * *`)"],
            ["`webhook.local`", "HTTP POST to local URL", "Auto-generated URL"],
            ["`webhook.cloud`", "HTTP POST to cloud URL", "Auto-generated URL"],
            ["`gmail.new_email`", "Native Gmail push trigger (Google watch)", "`profile`, `labelIds?`"],
            ["`drive.new_file`", "Native Drive push trigger (Google watch)", "`profile`, `onlyNew?`, `includeFolders?`"],
            ["`fs.watch`", "File/folder changes", "`path`, `pattern`, `recursive?`"],
            ["`function`", "Callable by other workflows", "`inputParams?`"],
            ["`app_start`", "Runs when Stuard starts", "None"],
          ]},
        ],
      },
      {
        id: "trigger-hotkey",
        title: "Hotkey Trigger",
        summary: "Keyboard shortcut trigger with hold and passthrough options",
        tags: ["trigger", "hotkey", "shortcut", "keyboard", "hold", "press"],
        content: [
          { type: "code", language: "json", value: `// Basic hotkey\n{ "type": "hotkey", "args": { "accelerator": "Ctrl+Alt+K" } }\n\n// Hold mode: fires on press AND release\n{ "type": "hotkey", "args": { "accelerator": "Ctrl+H", "hold": true } }\n\n// Passthrough: don't block key from other apps\n{ "type": "hotkey", "args": { "accelerator": "Ctrl+S", "passthrough": true } }` },
          { type: "tip", value: "For push-to-talk patterns, use a separate `hotkey` and `hotkey.release` trigger instead of `hold: true` with guards. It's simpler." },
          { type: "code", language: "json", value: `// Push-to-talk with separate triggers\n"triggers": [\n  { "id": "press", "type": "hotkey", "args": { "accelerator": "Ctrl+H" } },\n  { "id": "release", "type": "hotkey.release", "args": { "accelerator": "Ctrl+H" } }\n]\n"wires": [\n  { "from": "press", "to": "start_recording" },\n  { "from": "release", "to": "stop_recording" }\n]`, label: "Push-to-Talk Pattern" },
        ],
      },
      {
        id: "trigger-input-params",
        title: "Input Parameters",
        summary: "Collect user input via a form before workflow runs",
        tags: ["trigger", "input", "params", "form", "dialog", "user input"],
        content: [
          { type: "text", value: "Triggers can define `inputParams` to show a form dialog before the workflow runs. Access values with `{{trigger.data.paramName}}`." },
          { type: "table", headers: ["Type", "Description"], rows: [
            ["`string`", "Text input field"],
            ["`number`", "Numeric input"],
            ["`boolean`", "Checkbox / toggle"],
            ["`select`", "Dropdown (needs `options: [{label, value}]`)"],
            ["`multiselect`", "Multi-select dropdown"],
            ["`file`", "File picker dialog"],
            ["`folder`", "Folder picker dialog"],
            ["`date`", "Date picker"],
            ["`json`", "JSON editor"],
            ["`array`", "Array input"],
          ]},
          { type: "code", language: "json", value: `"inputParams": [\n  { "name": "username", "type": "string", "required": true, "description": "Enter username" },\n  { "name": "count", "type": "number", "defaultValue": 5 },\n  { "name": "folder", "type": "folder", "description": "Select output folder" },\n  { "name": "format", "type": "select", "options": [\n    { "label": "PNG", "value": "png" },\n    { "label": "JPG", "value": "jpg" }\n  ]}\n]`, label: "Example" },
          { type: "text", value: "Access in templates: `{{trigger.data.username}}`, `{{trigger.data.count}}`" },
        ],
      },
      {
        id: "trigger-gmail",
        title: "Gmail Trigger Output",
        summary: "Access email data when Gmail trigger fires",
        tags: ["trigger", "gmail", "email", "messageId", "trigger.data"],
        content: [
          { type: "text", value: "When the `gmail.new_email` trigger fires, the workflow receives data via `{{trigger.data.X}}`. Use these in steps like gmail_get_message_full:" },
          { type: "table", headers: ["Path", "Description"], rows: [
            ["`{{trigger.data.messageId}}`", "Gmail message ID — pass to gmail_get_message_full"],
            ["`{{trigger.data.message}}`", "Brief metadata (from, to, subject, snippet, date)"],
            ["`{{trigger.data.message.from}}`", "Sender email"],
            ["`{{trigger.data.message.to}}`", "Recipient(s)"],
            ["`{{trigger.data.message.subject}}`", "Email subject"],
            ["`{{trigger.data.message.snippet}}`", "Short preview text"],
            ["`{{trigger.data.emailAddress}}`", "Watched mailbox address"],
            ["`{{trigger.data.profile}}`", "Profile label used"],
          ]},
          { type: "code", language: "json", value: `// Get full email when trigger fires\n{ "tool": "gmail_get_message_full", "args": { "id": "{{trigger.data.messageId}}", "profile": "{{trigger.data.profile}}" } }` },
        ],
      },
    ],
  },

  // ━━━ WIRES & FLOW ━━━
  {
    id: "wires",
    title: "Wires & Flow",
    icon: GitBranch,
    color: "blue",
    entries: [
      {
        id: "wire-basics",
        title: "Wire Basics",
        summary: "Connect triggers and nodes to define execution flow",
        tags: ["wire", "connection", "flow", "from", "to"],
        content: [
          { type: "text", value: "Wires connect triggers to nodes and nodes to other nodes. They define the order of execution." },
          { type: "code", language: "json", value: `// Wire schema\n{\n  "from": "trig_0",       // Source trigger or node ID\n  "to": "step_1",         // Target node ID\n  "guard": { ... },       // Optional condition\n  "loop": { ... },        // Optional loop config\n  "loopBreak": false,     // Exit a loop\n  "label": "on success"   // Display label\n}` },
        ],
      },
      {
        id: "wire-patterns",
        title: "Flow Patterns",
        summary: "Sequential, branching, parallel, and convergence patterns",
        tags: ["wire", "parallel", "branch", "converge", "sequential", "pattern"],
        content: [
          { type: "heading", value: "Sequential" },
          { type: "code", language: "text", value: `trig_0 ──→ step_1 ──→ step_2\n\nwires: [\n  { from: "trig_0", to: "step_1" },\n  { from: "step_1", to: "step_2" }\n]` },
          { type: "heading", value: "Conditional Branching" },
          { type: "code", language: "text", value: `         ┌─[ok]──→ step_2\nstep_1 ──┤\n         └─[fail]─→ step_3\n\nwires: [\n  { from: "step_1", to: "step_2", guard: { if: { "==": [{ "var": "step_1.ok" }, true] } } },\n  { from: "step_1", to: "step_3", guard: { if: { "==": [{ "var": "step_1.ok" }, false] } } }\n]` },
          { type: "heading", value: "Parallel (no guards = all run)" },
          { type: "code", language: "text", value: `         ┌────→ step_2\nstep_1 ──┤\n         └────→ step_3\n\nwires: [\n  { from: "step_1", to: "step_2" },\n  { from: "step_1", to: "step_3" }\n]` },
          { type: "heading", value: "Convergence (waitForAll)" },
          { type: "code", language: "text", value: `step_2 ──┐\n         ├──→ step_4 (waitForAll: true)\nstep_3 ──┘\n\nnodes: [{ id: "step_4", waitForAll: true, ... }]\nwires: [\n  { from: "step_2", to: "step_4" },\n  { from: "step_3", to: "step_4" }\n]` },
          { type: "tip", value: "When multiple wires leave a node without guards, all target nodes run in parallel. Use `waitForAll: true` on a node to wait for all incoming branches." },
        ],
      },
    ],
  },

  // ━━━ GUARDS / CONDITIONS ━━━
  {
    id: "guards",
    title: "Guards / Conditions",
    icon: Shield,
    color: "purple",
    entries: [
      {
        id: "guard-jsonlogic",
        title: "JSONLogic Guards (Preferred)",
        summary: "The recommended format that works with the visual condition builder",
        tags: ["guard", "condition", "jsonlogic", "if", "branch", "var"],
        content: [
          { type: "text", value: "JSONLogic is the preferred guard format — it displays correctly in the visual condition builder." },
          { type: "code", language: "json", value: `// Equality\nguard: { if: { "==": [{ "var": "step_1.ok" }, true] } }\n\n// Not equal\nguard: { if: { "!=": [{ "var": "step_1.action" }, "cancel"] } }\n\n// Comparison\nguard: { if: { ">": [{ "var": "workflow.counter" }, 5] } }\n\n// Logical AND\nguard: { if: { "and": [\n  { "==": [{ "var": "step_1.ok" }, true] },\n  { ">": [{ "var": "step_1.count" }, 10] }\n]}}\n\n// Negation\nguard: { if: { "not": { "var": "step_1.ok" } } }` },
          { type: "table", headers: ["Operator", "Description", "Example"], rows: [
            ["`var`", "Access context value", '`{ "var": "step_1.ok" }`'],
            ["`==`, `!=`", "Equality", '`{ "==": [a, b] }`'],
            ["`>`, `<`, `>=`, `<=`", "Comparison", '`{ ">": [a, 5] }`'],
            ["`and`, `or`", "Logical combinator", '`{ "and": [cond1, cond2] }`'],
            ["`not`, `!`", "Negation", '`{ "not": expr }`'],
            ["`in`", "Membership test", '`{ "in": ["x", ["x","y"]] }`'],
          ]},
          { type: "warning", value: 'JSONLogic keys must be plain strings: `"=="`, `"var"`. Never double-quote them.' },
        ],
      },
      {
        id: "guard-string",
        title: "String Expression Guards",
        summary: "Simple string-based conditions for quick use",
        tags: ["guard", "condition", "string", "expression", "simple"],
        content: [
          { type: "text", value: "String expressions are also supported but may not render in the visual builder." },
          { type: "code", language: "json", value: `guard: { if: "step_1.ok == true" }\nguard: { if: "workflow.counter > 5" }\nguard: { if: "step_1.action == 'confirm'" }` },
        ],
      },
      {
        id: "guard-ai",
        title: "AI Routing Guards",
        summary: "Let AI dynamically decide which branch to take",
        tags: ["guard", "ai", "routing", "dynamic", "intelligent"],
        content: [
          { type: "text", value: "AI routing calls a language model to decide the branch. Useful for intent classification." },
          { type: "code", language: "json", value: `guard: {\n  ai: {\n    instruction: "Route based on intent: 'capture' for screenshots, 'files' for file operations",\n    produceArgs: true  // AI can also patch args for the chosen step\n  }\n}` },
          { type: "tip", value: "AI routing is powerful but slower. Use JSONLogic for deterministic conditions and AI routing for natural-language classification." },
        ],
      },
      {
        id: "guard-catchall",
        title: "Catch-All & Evaluation Order",
        summary: "Fallback guards and how guards are evaluated",
        tags: ["guard", "catchall", "fallback", "order", "default", "always"],
        content: [
          { type: "code", language: "json", value: `// Always taken (catch-all / else branch)\nguard: { if: true }\nguard: "always"\n// Or just omit the guard entirely` },
          { type: "text", value: "Guards are evaluated in order. The first matching guard wins. If multiple wires have no guard, ALL run in parallel. If none match and no catch-all exists, `fallbackTo` is used (if defined on the node)." },
        ],
      },
    ],
  },

  // ━━━ LOOPS ━━━
  {
    id: "loops",
    title: "Loops",
    icon: Repeat,
    color: "teal",
    entries: [
      {
        id: "loop-foreach",
        title: "forEach Loop",
        summary: "Iterate over a list of items from a previous step",
        tags: ["loop", "foreach", "iterate", "array", "list", "item"],
        content: [
          { type: "text", value: "Run a node once for each item in an array. Access the current item with `{{loop.item}}` and index with `{{loop.index}}`." },
          { type: "code", language: "json", value: `// Wire config\n{\n  "from": "get_list",\n  "to": "process_item",\n  "loop": {\n    "type": "forEach",\n    "items": "{{get_list.items}}",\n    "itemVar": "item",     // access as {{loop.item}}\n    "indexVar": "index"    // access as {{loop.index}}\n  }\n}\n\n// In process_item's args:\n{\n  "message": "Processing item #{{loop.index}}: {{loop.item}}"\n}`, label: "forEach Example" },
          { type: "text", value: "After the loop, `ctx[stepId]` has the last iteration's result, and `ctx[stepId + \"_loop_results\"]` has all results." },
        ],
      },
      {
        id: "loop-repeat",
        title: "repeat Loop",
        summary: "Run a node a fixed number of times",
        tags: ["loop", "repeat", "count", "fixed", "times"],
        content: [
          { type: "code", language: "json", value: `{\n  "from": "step_1",\n  "to": "step_2",\n  "loop": {\n    "type": "repeat",\n    "count": 5,           // Run 5 times\n    "delayMs": 1000       // 1 second between iterations\n  }\n}` },
          { type: "tip", value: "Use `delayMs` to add a pause between iterations — useful for polling or rate-limited APIs." },
        ],
      },
      {
        id: "loop-while",
        title: "while Loop",
        summary: "Repeat while a condition is true",
        tags: ["loop", "while", "condition", "conditional", "until"],
        content: [
          { type: "code", language: "json", value: `{\n  "from": "step_1",\n  "to": "step_2",\n  "loop": {\n    "type": "while",\n    "conditionText": "{{workflow.counter}} < 10",\n    "maxIterations": 100   // Safety limit\n  }\n}` },
          { type: "warning", value: "Always set `maxIterations` to prevent infinite loops. Default is 100." },
        ],
      },
      {
        id: "loop-break",
        title: "Loop Break",
        summary: "Exit a loop and continue to the next node",
        tags: ["loop", "break", "exit", "stop", "continue"],
        content: [
          { type: "text", value: "Add `loopBreak: true` on a wire to mark it as the loop exit point." },
          { type: "code", language: "json", value: `"wires": [\n  { "from": "trig_0", "to": "loop_body", "loop": { "type": "forEach", "items": "{{data}}" } },\n  { "from": "loop_body", "to": "after_loop", "loopBreak": true }\n]` },
        ],
      },
    ],
  },

  // ━━━ VARIABLES ━━━
  {
    id: "variables",
    title: "Variables",
    icon: Box,
    color: "orange",
    entries: [
      {
        id: "var-workflow",
        title: "Workflow Variables (Shared)",
        summary: "Variables shared across all stuard files in this workflow",
        tags: ["variable", "workflow", "config", "default", "state", "shared"],
        content: [
          { type: "text", value: "Workflow variables are defined in the spec and shared across all stuard files within the current workflow directory. Access with `{{workflow.varName}}`.\n\n**Scope:** Available to every stuard file in this workflow and its subdirectories. NOT shared across different workflows." },
          { type: "code", language: "json", value: `"variables": [\n  { "name": "outputDir", "type": "string", "defaultValue": "C:/output" },\n  { "name": "maxRetries", "type": "number", "defaultValue": 3 },\n  { "name": "isEnabled", "type": "boolean", "defaultValue": true },\n  { "name": "config", "type": "json", "defaultValue": { "timeout": 5000 } }\n]` },
          { type: "table", headers: ["Type", "Description"], rows: [
            ["`string`", "Text value"],
            ["`number`", "Numeric value"],
            ["`boolean`", "true / false"],
            ["`json`", "Object or complex data"],
            ["`list`", "Array of items"],
          ]},
        ],
      },
      {
        id: "var-scoping",
        title: "Variable Scoping",
        summary: "Workflow-scoped vs local (file-scoped) variables",
        tags: ["variable", "scope", "local", "workflow", "file"],
        content: [
          { type: "text", value: "Variables have two scopes:\n\n• **Workflow** (`workflow.*`) — Shared across all stuard files in the current workflow. Defined in the Variables panel or via `set_variable` with scope='workflow'.\n\n• **Local** (`local.*`) — Scoped to the current stuard file only. Other files in the same workflow cannot see these. Use `set_variable` with scope='local'." },
          { type: "table", headers: ["Scope", "Prefix", "Visibility", "Use Case"], rows: [
            ["Workflow", "`workflow.*`", "All stuard files in this workflow", "Shared state, config, counters"],
            ["Local", "`local.*`", "Current stuard file only", "File-internal state, temp values"],
          ]},
          { type: "code", language: "json", value: `// Workflow-scoped (shared across stuard files)\n{ "tool": "set_variable", "args": { "name": "counter", "value": 0, "scope": "workflow" } }\n\n// Local (file-scoped, only visible to this stuard file)\n{ "tool": "set_variable", "args": { "name": "tempBuffer", "value": "", "scope": "local" } }`, label: "Scope Examples" },
        ],
      },
      {
        id: "var-runtime",
        title: "Runtime Variables",
        summary: "Set, get, toggle, and increment variables at runtime",
        tags: ["variable", "runtime", "persist", "set", "get", "toggle", "increment"],
        content: [
          { type: "text", value: "Runtime variables can be read/written by tool nodes. Workflow-scoped variables persist across runs. Local variables are file-scoped." },
          { type: "table", headers: ["Tool", "Description", "Args"], rows: [
            ["`set_variable`", "Set a value", "`{ name, value, scope?, type? }`"],
            ["`get_variable`", "Get a value", "`{ name, default? }`"],
            ["`toggle_variable`", "Flip boolean", "`{ name }`"],
            ["`increment_variable`", "Add to number", "`{ name, amount? }`"],
            ["`append_to_list`", "Add to list", "`{ name, item }`"],
            ["`delete_variable`", "Remove", "`{ name }`"],
          ]},
          { type: "text", value: "Access in templates: `{{$vars.counter}}`, `{{$vars.isRecording}}`\nAccess in guards: `{ \"var\": \"$vars.counter\" }`" },
          { type: "code", language: "json", value: `// Toggle recording pattern\n{ "id": "toggle", "tool": "toggle_variable", "args": { "name": "isRecording" } }\n\n// Guard on variable\n{ "from": "toggle", "to": "start", "guard": { "if": { "var": "$vars.isRecording" } } }\n{ "from": "toggle", "to": "stop", "guard": { "if": { "not": { "var": "$vars.isRecording" } } } }`, label: "Toggle Pattern" },
        ],
      },
    ],
  },

  // ━━━ CUSTOM UI ━━━
  {
    id: "custom-ui",
    title: "Custom UI",
    icon: Layout,
    color: "violet",
    entries: [
      {
        id: "ui-basics",
        title: "Custom UI Basics",
        summary: "Create popup windows with React JSX and Tailwind CSS",
        tags: ["custom_ui", "ui", "window", "popup", "react", "jsx", "component"],
        content: [
          { type: "text", value: "The `custom_ui` tool creates popup windows with React JSX. Write a `function App()` component using standard JSX syntax. Tailwind CSS is available offline." },
          { type: "code", language: "jsx", value: `// In the "component" field:\nfunction App() {\n  return (\n    <div className="p-6 text-center">\n      <h2 className="text-2xl font-bold text-white">Hello!</h2>\n      <button onClick={() => stuard.submit({ ok: true })}\n              className="btn-primary mt-4 px-6">\n        Done\n      </button>\n    </div>\n  );\n}`, label: "Basic Component" },
          { type: "warning", value: "EVERY button must have onClick. Use `stuard.submit(data)` for done/submit buttons. A button without onClick does nothing — the workflow blocks forever!" },
        ],
      },
      {
        id: "ui-hooks",
        title: "Hooks & useVar",
        summary: "useState, useEffect, useRef, and the special useVar hook",
        tags: ["custom_ui", "hooks", "useVar", "useState", "useEffect", "reactive"],
        content: [
          { type: "text", value: "All standard React hooks are available. The special `useVar` hook bridges React state to workflow variables." },
          { type: "code", language: "jsx", value: `function App() {\n  // useVar: reactive variable bridge\n  const [count, setCount] = useVar('counter', 0);\n  // count updates from external set_variable calls too!\n\n  // Standard React hooks work:\n  const [local, setLocal] = useState('');\n  const ref = useRef(null);\n\n  useEffect(() => {\n    const id = setInterval(() => setCount(c => c + 1), 1000);\n    return () => clearInterval(id);\n  }, []);\n\n  return (\n    <div className="p-4">\n      <h1 className="text-4xl">{count}</h1>\n    </div>\n  );\n}`, label: "Hooks Example" },
          { type: "heading", value: "useVar Auto-Seeding from data" },
          { type: "text", value: "The `data` field in custom_ui args seeds useVar values. Match your `data` keys to your `useVar` names." },
          { type: "code", language: "json", value: `// In node args:\n"data": {\n  "word": "{{ai_step.json.word}}",\n  "pinyin": "{{ai_step.json.pinyin}}"\n}\n\n// In component:\nconst [word] = useVar('word', '');     // → seeded from data\nconst [pinyin] = useVar('pinyin', ''); // → seeded from data` },
        ],
      },
      {
        id: "ui-interaction",
        title: "Interaction API",
        summary: "stuard.submit(), stuard.close(), stuard.callTool()",
        tags: ["custom_ui", "submit", "close", "callTool", "interaction", "api"],
        content: [
          { type: "table", headers: ["Method", "Description"], rows: [
            ["`stuard.submit(data)`", "Submit data and close. Resolves blocking promise."],
            ["`stuard.close()`", "Close window without data."],
            ["`stuard.callTool(name, args)`", "Call a workflow tool from the UI."],
          ]},
          { type: "code", language: "jsx", value: `// Submit form\n<button onClick={() => stuard.submit({ name, email })}>\n  Submit\n</button>\n\n// Call tool from UI\n<button onClick={async () => {\n  const result = await stuard.callTool('take_screenshot', {});\n  setPath(result.filePath);\n}}>\n  Take Screenshot\n</button>` },
          { type: "heading", value: "Blocking Modes" },
          { type: "table", headers: ["Setting", "Behavior"], rows: [
            ["`blocking: true`", "Workflow waits for submit/close (default)"],
            ["`blocking: false`", "UI stays open, workflow continues"],
            ["`timeoutMs: 30000`", "Auto-resolve with `{ action: 'timeout' }` after 30s"],
          ]},
        ],
      },
      {
        id: "ui-window",
        title: "Window Configuration",
        summary: "Size, position, frameless, borderRadius, translucent, and more",
        tags: ["custom_ui", "window", "size", "position", "frameless", "transparent", "radius"],
        content: [
          { type: "code", language: "json", value: `"window": {\n  "width": 400, "height": 300,\n  "position": "center",       // center|topleft|topright|bottomleft|bottomright|cursor|custom\n  "alwaysOnTop": true,\n  "frameless": true,          // Remove OS title bar\n  "borderRadius": 12,         // Rounded corners (needs frameless)\n  "resizable": false,\n  "draggable": true,          // Drag by background (default)\n  "backgroundColor": "#1a1a2e",\n  "backgroundType": "color",  // color|translucent|transparent\n  "invisible": false          // Hide from screen recordings\n}` },
          { type: "heading", value: "Translucent / Frosted Glass" },
          { type: "code", language: "json", value: `"window": {\n  "backgroundType": "translucent",\n  "frameless": true,\n  "translucent": { "color": "#1a1a2e", "opacity": 0.7, "blur": 12 }\n}` },
          { type: "tip", value: "Set `frameless: true` whenever using `borderRadius` or `translucent`. The OS title bar prevents rounded corners from showing." },
        ],
      },
      {
        id: "ui-pages",
        title: "Multi-Page Apps",
        summary: "Build SPAs with client-side navigation using the pages system",
        tags: ["custom_ui", "pages", "navigation", "spa", "multi-page", "app"],
        content: [
          { type: "text", value: "The `pages` field turns a single custom_ui step into a full multi-page app with navigation. The step only resolves on explicit submit/close." },
          { type: "code", language: "json", value: `"pages": {\n  "home": {\n    "html": "<h1>Welcome</h1><button data-navigate='settings'>Settings</button>"\n  },\n  "settings": {\n    "html": "<input data-bind='username'><button data-navigate='home'>Back</button>"\n  }\n},\n"startPage": "home",\n"keepOpen": true,\n"data": { "username": "" }`, label: "Pages Mode" },
          { type: "heading", value: "Navigation Methods" },
          { type: "table", headers: ["Method", "Usage"], rows: [
            ["Declarative", '`<button data-navigate="settings">Go</button>`'],
            ["JavaScript", '`navigateTo("results", { query: formData.query })`'],
            ["Go Back", "`goBack()`"],
          ]},
          { type: "text", value: "`formData` persists across all pages. `data-bind` inputs read/write to formData automatically." },
        ],
      },
    ],
  },

  // ━━━ WORKSPACE ━━━
  {
    id: "workspace",
    title: "Workspace",
    icon: HardDrive,
    color: "emerald",
    entries: [
      {
        id: "workspace-basics",
        title: "Workspace System",
        summary: "Every workflow has a dedicated workspace directory for files and scripts",
        tags: ["workspace", "files", "directory", "scripts", "data", "assets"],
        content: [
          { type: "text", value: "Every workflow has a workspace directory containing its files. Use workspace templates to reference paths." },
          { type: "code", language: "text", value: `flowId/\n├── main.stuard        (workflow definition)\n├── data/              (CSVs, JSON, etc.)\n├── scripts/           (Python/Node scripts)\n└── assets/            (images, templates)`, label: "Workspace Structure" },
          { type: "table", headers: ["Template", "Resolves To"], rows: [
            ["`{{$workspace.path}}`", "Full path to workspace root"],
            ["`{{$workspace.data}}`", "Path to data/ directory"],
            ["`{{$workspace.scripts}}`", "Path to scripts/ directory"],
            ["`{{$workspace.assets}}`", "Path to assets/ directory"],
            ["`{{$workspace.id}}`", "The workflow ID"],
          ]},
        ],
      },
      {
        id: "workspace-tools",
        title: "Workspace File Tools",
        summary: "Read, write, list, and manage files in the workspace",
        tags: ["workspace", "read", "write", "list", "file", "create", "delete"],
        content: [
          { type: "table", headers: ["Tool", "Args", "Returns"], rows: [
            ["`workspace_read_file`", '`{ path: "data/config.json" }`', "`{ ok, content, size }`"],
            ["`workspace_write_file`", '`{ path: "data/out.json", content: "..." }`', "`{ ok }`"],
            ["`workspace_list_files`", '`{ path: "" }` (empty = root)', "`{ ok, files }`"],
            ["`workspace_create_folder`", '`{ path: "data/exports" }`', "`{ ok }`"],
            ["`workspace_delete_file`", '`{ path: "data/old.json" }`', "`{ ok }`"],
            ["`workspace_get_info`", "`{}`", "`{ ok, workspacePath, files }`"],
          ]},
          { type: "tip", value: "Prefer workspace tools over `read_file`/`write_file` for workflow-local files. They handle relative paths and auto-create parent directories." },
        ],
      },
    ],
  },

  // ━━━ NODES & TOOLS ━━━
  {
    id: "tools",
    title: "Tools Reference",
    icon: Terminal,
    color: "slate",
    entries: [
      {
        id: "tools-overview",
        title: "Tool Categories Overview",
        summary: "All available tool categories at a glance",
        tags: ["tool", "category", "overview", "list", "all"],
        content: [
          { type: "table", headers: ["Category", "Key Tools"], rows: [
            ["Flow Control", "`wait`, `log`, `send_notification`, `return_value`, `end`, `invoke_workflow`"],
            ["Variables", "`set_variable`, `get_variable`, `toggle_variable`, `increment_variable`"],
            ["Mouse", "`click_at_coordinates`, `double_click`, `scroll`, `drag_and_drop`"],
            ["Keyboard", "`type_text`, `send_hotkey`"],
            ["Clipboard", "`get_clipboard_content`, `set_clipboard_content`"],
            ["Media", "`take_screenshot`, `capture_media`, `capture_screen`, `stop_capture`"],
            ["TTS", "`text_to_speech`, `list_tts_voices`"],
            ["Files", "`read_file`, `write_file`, `list_directory`, `run_command`"],
            ["Workspace", "`workspace_read_file`, `workspace_write_file`, `workspace_list_files`"],
            ["Scripts", "`run_python_script`, `run_node_script`"],
            ["Windows", "`list_open_windows`, `bring_window_to_foreground`, `smart_bring_window_to_foreground`"],
            ["Custom UI", "`custom_ui`, `update_custom_ui`, `close_custom_ui`"],
            ["AI Agent", "`agent_node`, `ai_inference`"],
            ["AI Vision", "`analyze_current_screen`, `analyze_image`, `analyze_media`"],
            ["Web Search", "`web_search`, `scrape_url`"],
            ["HTTP", "`http_request`"],
            ["Gmail", "`gmail_send_message`, `gmail_list_messages`, `gmail_get_message_full`"],
            ["Calendar", "`calendar_list_events`, `calendar_create_event`"],
            ["GitHub", "`github_list_repos`, `github_list_issues`, `github_create_issue`"],
            ["Database", "`db_store`, `db_retrieve`, `db_search`, `db_query`"],
            ["Math", "`math_add`, `math_subtract`, `math_multiply`, `math_compare`, ..."],
          ]},
        ],
      },
      {
        id: "tools-ai",
        title: "AI Tools",
        summary: "agent_node and ai_inference for AI-powered steps",
        tags: ["tool", "ai", "agent", "inference", "llm", "gpt", "model"],
        content: [
          { type: "heading", value: "agent_node — Full AI Agent" },
          { type: "text", value: "Runs a full AI agent that can call other tools. Use for complex, multi-step AI tasks." },
          { type: "code", language: "json", value: `{\n  "tool": "agent_node",\n  "args": {\n    "prompt": "Analyze the screenshot and describe what you see",\n    "model": "balanced",    // balanced | fast | quality\n    "outputMode": "text",   // text | json\n    "maxSteps": 10\n  }\n}` },
          { type: "heading", value: "ai_inference — Simple LLM Call" },
          { type: "text", value: "A single LLM call without tool access. Use for summarization, extraction, classification, or embeddings." },
          { type: "code", language: "json", value: `{\n  "tool": "ai_inference",\n  "args": {\n    "prompt": "Extract the key points from this text",\n    "input": "{{read_file.content}}",\n    "mode": "text"    // text | json | embedding\n  }\n}` },
          { type: "tip", value: "Use `mode: \"json\"` to get structured output. Access it with `{{step.json.fieldName}}`. Use `mode: \"embedding\"` to get vector embeddings." },
        ],
      },
      {
        id: "tools-scripts",
        title: "Script Tools",
        summary: "Run Python and Node.js scripts with auto-install packages",
        tags: ["tool", "script", "python", "node", "code", "run"],
        content: [
          { type: "heading", value: "run_python_script" },
          { type: "code", language: "json", value: `{\n  "tool": "run_python_script",\n  "args": {\n    "code": "import json\\ndata = {'hello': 'world'}\\nprint(json.dumps(data))",\n    "packages": ["requests", "pandas"],  // Auto-installed\n    "timeoutMs": 60000\n  }\n}\n\n// Or reference a workspace file:\n{\n  "tool": "run_python_script",\n  "args": {\n    "filePath": "{{$workspace.scripts}}/process.py",\n    "packages": ["pandas"]\n  }\n}` },
          { type: "heading", value: "run_node_script" },
          { type: "code", language: "json", value: `{\n  "tool": "run_node_script",\n  "args": {\n    "code": "const data = { hello: 'world' };\\nconsole.log(JSON.stringify(data));"\n  }\n}` },
          { type: "text", value: "Output is available as `{{step.stdout}}`. Use `print()` / `console.log()` to produce output." },
        ],
      },
      {
        id: "tools-http",
        title: "HTTP Requests",
        summary: "Make API calls with http_request tool",
        tags: ["tool", "http", "api", "request", "get", "post", "rest"],
        content: [
          { type: "code", language: "json", value: `{\n  "tool": "http_request",\n  "args": {\n    "url": "https://api.example.com/data",\n    "method": "POST",\n    "headers": { "Content-Type": "application/json" },\n    "json_body": { "query": "{{trigger.data.search}}" },\n    "bearer_token": "{{workflow.apiKey}}",\n    "timeout": 30,\n    "retries": 2\n  }\n}` },
          { type: "text", value: "Response available as `{{step.body}}` (parsed JSON or text), `{{step.status}}`, `{{step.headers}}`." },
        ],
      },
      {
        id: "tools-media",
        title: "Media & Screenshot Tools",
        summary: "Screenshots, audio/video recording, screen capture",
        tags: ["tool", "media", "screenshot", "record", "audio", "video", "screen"],
        content: [
          { type: "table", headers: ["Tool", "Description", "Key Args"], rows: [
            ["`take_screenshot`", "Capture screen", "None (saves to temp)"],
            ["`capture_media`", "Record audio/video", "`kind`, `mode`, `sessionId`"],
            ["`capture_screen`", "Record screen", "`mode`, `target`, `fps`"],
            ["`stop_capture`", "Stop webcam/mic", "`sessionId`"],
            ["`stop_screen_capture`", "Stop screen recording", "`sessionId`"],
            ["`analyze_media`", "Transcribe audio", "`sources`, `task`"],
          ]},
          { type: "code", language: "json", value: `// Record audio until stopped\n{ "tool": "capture_media", "args": { "kind": "audio", "mode": "until_stop", "sessionId": "rec" } }\n\n// Stop and get file path\n{ "tool": "stop_capture", "args": { "sessionId": "rec" } }\n// Result: {{stop.filePath}}`, label: "Audio Recording" },
        ],
      },
    ],
  },

  // ━━━ STREAMS ━━━
  {
    id: "streams",
    title: "Streams",
    icon: Workflow,
    color: "cyan",
    entries: [
      {
        id: "stream-basics",
        title: "Stream Basics",
        summary: "Enable streaming on tools for real-time data processing",
        tags: ["stream", "realtime", "token", "chunk", "reactive"],
        content: [
          { type: "text", value: "Some tools support `stream: true` which creates a real-time data stream. Consumer nodes receive chunks as they arrive." },
          { type: "table", headers: ["Tool", "Stream Content"], rows: [
            ["`agent_node`", "Text tokens from AI"],
            ["`ai_inference`", "Text tokens from AI"],
            ["`http_request`", "Response body chunks"],
            ["`run_python_script`", "Script output chunks"],
            ["`capture_media`", "Media data chunks"],
          ]},
          { type: "heading", value: "Stream Variables in Consumer Nodes" },
          { type: "table", headers: ["Template", "Description"], rows: [
            ["`{{sourceStep.text}}`", "Current chunk text"],
            ["`{{sourceStep.fullText}}`", "All text accumulated so far"],
            ["`{{sourceStep.chunkIndex}}`", "Current chunk index (0-based)"],
            ["`{{stream_chunk}}`", "Current chunk (convenience)"],
            ["`{{stream_full_text}}`", "Full text (convenience)"],
          ]},
        ],
      },
    ],
  },

  // ━━━ NODE FEATURES ━━━
  {
    id: "nodes",
    title: "Node Features",
    icon: FileCode,
    color: "rose",
    entries: [
      {
        id: "node-schema",
        title: "Node Schema",
        summary: "Full node schema with fallbackTo and waitForAll",
        tags: ["node", "schema", "fallback", "wait", "error"],
        content: [
          { type: "code", language: "json", value: `{\n  "id": "step_abc123",     // Unique ID\n  "tool": "ai_inference",  // Tool name\n  "label": "Analyze Text", // Display label\n  "args": {                // Tool arguments (templates ok)\n    "prompt": "Summarize: {{read.content}}"\n  },\n  "position": { "x": 400, "y": 200 },\n  "fallbackTo": "error_handler",  // Jump here on failure\n  "waitForAll": true               // Wait for all incoming branches\n}` },
          { type: "heading", value: "Error Handling with fallbackTo" },
          { type: "text", value: "If a node fails and has `fallbackTo` set, execution jumps to that node instead of stopping. This lets you build error recovery flows." },
          { type: "heading", value: "Output Schema (workflow-as-function)" },
          { type: "code", language: "json", value: `"outputSchema": [\n  { "name": "success", "type": "boolean" },\n  { "name": "data", "type": "json" },\n  { "name": "errorMessage", "type": "string" }\n]\n\n// Return value from a node:\n{ "tool": "return_value", "args": { "value": "{{process.result}}" } }` },
        ],
      },
    ],
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface WorkflowDocsPanelProps {
  onClose: () => void;
}

export function WorkflowDocsPanel({ onClose }: WorkflowDocsPanelProps) {
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["templates"]));
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Flatten all entries for search
  const allEntries = useMemo(() => {
    const result: Array<DocEntry & { sectionId: string; sectionTitle: string; sectionColor: string }> = [];
    for (const section of DOCS) {
      for (const entry of section.entries) {
        result.push({ ...entry, sectionId: section.id, sectionTitle: section.title, sectionColor: section.color });
      }
    }
    return result;
  }, []);

  // Filter entries by search
  const filteredSections = useMemo(() => {
    if (!search.trim()) return DOCS;
    const q = search.toLowerCase().trim();
    const words = q.split(/\s+/);
    return DOCS.map(section => ({
      ...section,
      entries: section.entries.filter(entry => {
        const haystack = `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase();
        return words.every(w => haystack.includes(w));
      }),
    })).filter(s => s.entries.length > 0);
  }, [search]);

  // Search results mode
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase().trim();
    const words = q.split(/\s+/);
    return allEntries.filter(entry => {
      const haystack = `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase();
      return words.every(w => haystack.includes(w));
    });
  }, [search, allEntries]);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectEntry = useCallback((entryId: string) => {
    setSelectedEntry(prev => prev === entryId ? null : entryId);
    // Scroll into view
    setTimeout(() => {
      const el = document.getElementById(`doc-entry-${entryId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, []);

  // Find the selected entry data
  const activeEntry = useMemo(() => {
    if (!selectedEntry) return null;
    for (const section of DOCS) {
      const entry = section.entries.find(e => e.id === selectedEntry);
      if (entry) return { ...entry, sectionColor: section.color };
    }
    return null;
  }, [selectedEntry]);

  const colorMap: Record<string, { bg: string; text: string; border: string; light: string; dot: string }> = {
    indigo: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", light: "bg-indigo-100", dot: "bg-indigo-500" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", light: "bg-amber-100", dot: "bg-amber-500" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", light: "bg-blue-100", dot: "bg-blue-500" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", light: "bg-purple-100", dot: "bg-purple-500" },
    teal: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/20", light: "bg-teal-500/20", dot: "bg-teal-400" },
    orange: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", light: "bg-orange-500/20", dot: "bg-orange-400" },
    violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20", light: "bg-violet-500/20", dot: "bg-violet-400" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", light: "bg-emerald-500/20", dot: "bg-emerald-400" },
    slate: { bg: "wf-bg-overlay", text: "wf-fg-muted", border: "wf-border-subtle", light: "wf-bg-overlay", dot: "wf-fg-faint" },
    cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20", light: "bg-cyan-500/20", dot: "bg-cyan-400" },
    rose: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20", light: "bg-rose-500/20", dot: "bg-rose-400" },
  };
  const c = (color: string) => colorMap[color] || colorMap.slate;

  return (
    <div className="flex flex-col h-full bg-transparent wf-fg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b wf-border-subtle shrink-0 wf-bg-overlay">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <span className="text-[13px] font-bold wf-fg">Docs</span>
          <span className="text-[10px] wf-fg-faint font-medium">{allEntries.length} topics</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md transition-colors wf-menu-item">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b wf-border-subtle shrink-0 wf-bg-sunken">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 wf-fg-faint" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search docs... (templates, loops, custom_ui...)"
            className="w-full pl-8 pr-8 py-1.5 text-[12px] rounded-lg focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 wf-input"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 wf-fg-faint wf-hover-fg"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        {/* Search Results Mode */}
        {searchResults ? (
          <div className="p-2">
            <div className="text-[10px] font-medium wf-fg-faint uppercase tracking-wider px-1 mb-1.5">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </div>
            {searchResults.length === 0 ? (
              <div className="text-center py-8">
                <Search className="w-8 h-8 wf-fg-faint mx-auto mb-2" />
                <p className="text-[12px] wf-fg-muted">No results for "{search}"</p>
                <p className="text-[11px] wf-fg-faint mt-1">Try: templates, loops, custom_ui, guards, variables</p>
              </div>
            ) : (
              searchResults.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => {
                    setExpandedSections(prev => new Set([...prev, entry.sectionId]));
                    selectEntry(entry.id);
                    setSearch("");
                  }}
                  className={`w-full text-left p-2 rounded-lg mb-1 border transition-all hover:brightness-105 ${c(entry.sectionColor).bg} ${c(entry.sectionColor).border}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${c(entry.sectionColor).dot}`} />
                    <span className="text-[11px] font-semibold wf-fg">{entry.title}</span>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${c(entry.sectionColor).light} ${c(entry.sectionColor).text}`}>
                      {entry.sectionTitle}
                    </span>
                  </div>
                  <p className="text-[10.5px] wf-fg-muted mt-0.5 ml-3">{entry.summary}</p>
                </button>
              ))
            )}
          </div>
        ) : (
          /* Category Browser Mode */
          <div className="p-2">
            {filteredSections.map(section => {
              const Icon = section.icon;
              const isExpanded = expandedSections.has(section.id);
              return (
                <div key={section.id} className="mb-1.5">
                  <button
                    onClick={() => toggleSection(section.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
                      isExpanded ? `${c(section.color).bg} ${c(section.color).border} border` : "wf-hover-bg"
                    }`}
                  >
                    {isExpanded ?
                      <ChevronDown className="w-3 h-3 wf-fg-faint" /> :
                      <ChevronRight className="w-3 h-3 wf-fg-faint" />
                    }
                    <Icon className={`w-3.5 h-3.5 ${isExpanded ? c(section.color).text : "wf-fg-faint"}`} />
                    <span className={`text-[12px] font-semibold ${isExpanded ? c(section.color).text : "wf-fg-muted"}`}>
                      {section.title}
                    </span>
                    <span className="text-[10px] wf-fg-faint ml-auto">{section.entries.length}</span>
                  </button>

                  {isExpanded && (
                    <div className="ml-2 mt-0.5 space-y-0.5">
                      {section.entries.map(entry => {
                        const isActive = selectedEntry === entry.id;
                        return (
                          <div key={entry.id} id={`doc-entry-${entry.id}`}>
                            <button
                              onClick={() => selectEntry(entry.id)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-md transition-all ${
                                isActive
                                  ? `${c(section.color).light} ${c(section.color).text}`
                                  : "wf-hover-bg wf-fg-muted hover:wf-fg"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <ArrowRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${isActive ? "rotate-90" : ""}`} />
                                <span className="text-[11.5px] font-medium">{entry.title}</span>
                              </div>
                              {!isActive && (
                                <p className="text-[10px] wf-fg-faint mt-0.5 ml-4 line-clamp-1">{entry.summary}</p>
                              )}
                            </button>

                            {isActive && (
                              <div className="mx-1 mb-2 p-3 wf-bg-sunken rounded-lg border wf-border-subtle shadow-sm space-y-1.5">
                                <p className="text-[11px] wf-fg-muted italic mb-2">{entry.summary}</p>
                                {entry.content.map((item, i) => (
                                  <RenderContent key={i} item={item} />
                                ))}
                                <div className="flex flex-wrap gap-1 pt-2 border-t wf-border-subtle mt-2">
                                  {entry.tags.map(tag => (
                                    <button
                                      key={tag}
                                      onClick={() => setSearch(tag)}
                                      className="px-1.5 py-0.5 text-[9px] wf-fg-faint rounded-full hover:bg-indigo-500/20 hover:text-indigo-400 transition-colors"
                                    >
                                      {tag}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with quick links */}
      <div className="px-3 py-2 border-t wf-border-subtle shrink-0 wf-bg-overlay">
        <div className="flex flex-wrap gap-1">
          {["{{templates}}", "triggers", "guards", "loops", "custom_ui", "variables", "tools"].map(q => (
            <button
              key={q}
              onClick={() => setSearch(q === "{{templates}}" ? "template" : q)}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors wf-surface-muted wf-fg-muted hover:text-indigo-500 hover:border-indigo-300"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
