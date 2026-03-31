/**
 * Workflow Documentation Search System
 *
 * Instead of embedding ~1400 lines of docs in the system prompt,
 * we chunk them into searchable sections. The agent calls
 * search_workflow_docs(query) to pull only what it needs —
 * same pattern as stuard's search_tools for tool discovery.
 *
 * Token savings: ~8-12k tokens per request when the agent
 * only needs 1-2 doc sections instead of the full manual.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENTATION CHUNKS
// ═══════════════════════════════════════════════════════════════════════════════

export interface DocChunk {
  id: string;
  title: string;
  /** Keywords for matching — lowercase, space-separated */
  keywords: string[];
  content: string;
}

const DOC_CHUNKS: DocChunk[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // CORE ARCHITECTURE
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'architecture',
    title: 'Workflow Architecture Overview',
    keywords: ['architecture', 'overview', 'structure', 'graph', 'components', 'execution', 'flow', 'how workflows work', 'basics'],
    content: `A workflow is a directed graph with 4 core components:

  WORKFLOW = { id, name, triggers[], nodes[], wires[], variables?[] }

  ┌──────────┐     wire      ┌──────────┐     wire      ┌──────────┐
  │ TRIGGER  │ ───────────→ │   NODE   │ ───────────→ │   NODE   │
  │ (start)  │               │  (tool)  │               │  (tool)  │
  └──────────┘               └──────────┘               └──────────┘

EXECUTION FLOW:
1. Trigger fires → creates initial context with trigger.data
2. Engine follows wires from trigger → first node
3. Each node executes its tool → stores result in context as ctx[stepId]
4. Wires with guards are evaluated → determines next node(s)
5. Loops repeat target nodes with iteration variables
6. Parallel branches run concurrently when multiple unconditional wires exist
7. Convergence points (waitForAll) wait for all incoming branches`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // TRIGGERS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'triggers',
    title: 'Triggers - Starting Points',
    keywords: ['trigger', 'triggers', 'start', 'manual', 'hotkey', 'keystroke', 'cron', 'schedule', 'webhook', 'fs.watch', 'filesystem', 'function', 'app_start', 'keyboard', 'shortcut'],
    content: `Triggers start workflow execution. Each trigger has:
  { id: "trig_0", type: string, args: {}, label: string, position: {x,y}, inputParams?: [] }

TRIGGER TYPES:
┌──────────────────┬───────────────────────────────────────────────────────────┐
│ Type             │ Args & Behavior                                           │
├──────────────────┼───────────────────────────────────────────────────────────┤
│ manual           │ {} - User clicks "Run" button                             │
│ hotkey           │ { accelerator, hold?, passthrough? } - Keyboard shortcut  │
│ hotkey.release   │ { accelerator } - Fires ONLY on key release               │
│ keystroke        │ { sequence: "go" } - Type text anywhere to trigger        │
│ schedule.cron    │ { cron: "0 9 * * *" } - Cron expression (every day 9am)   │
│ webhook.local    │ {} - HTTP POST to local endpoint                          │
│ fs.watch         │ { path: "C:/folder", pattern: "*.txt" } - File changes    │
│ function         │ {} - Called by call_function tool (internal reuse)        │
│ app_start        │ {} - Runs once when Stuard starts after agent readiness   │
└──────────────────┴───────────────────────────────────────────────────────────┘

HOTKEY TRIGGER — args:
  { accelerator: "Ctrl+Alt+K", hold: true, passthrough: true }
  When hold: false (default) → fires once on key press
  When hold: true → fires TWICE: on press (event: "press") and release (event: "release")
  Prefer using a separate hotkey.release trigger instead of guards.

HOTKEY.RELEASE TRIGGER — fires only on key release:
  Use this for "release to stop" patterns without needing guards.
  { type: "hotkey.release", args: { accelerator: "Ctrl+H" } }

EXAMPLE — Push-to-talk (two triggers, no guards needed):
  triggers: [
    { id: "trig_press", type: "hotkey", args: { accelerator: "Ctrl+H" } },
    { id: "trig_release", type: "hotkey.release", args: { accelerator: "Ctrl+H" } }
  ]
  nodes: [
    { id: "start_rec", tool: "capture_media", args: { kind: "audio", mode: "until_stop", sessionId: "ptt" } },
    { id: "stop_rec", tool: "stop_capture", args: { sessionId: "ptt" } }
  ]
  wires: [
    { from: "trig_press", to: "start_rec" },
    { from: "trig_release", to: "stop_rec" }
  ]`,
  },

  {
    id: 'input_params',
    title: 'Input Parameters - User Input Before Execution',
    keywords: ['input', 'inputParams', 'parameters', 'form', 'user input', 'string', 'number', 'boolean', 'select', 'multiselect', 'file', 'folder', 'date', 'json', 'array', 'trigger.data'],
    content: `Triggers can define inputParams to collect user input when workflow starts.
This creates a form dialog BEFORE the workflow runs.

SCHEMA:
  inputParams: [
    { name: string, type: string, required?: bool, defaultValue?: any, description?: string }
  ]

INPUT TYPES:
┌──────────────┬────────────────────────────────────────────────────────────────┐
│ Type         │ Description                                                    │
├──────────────┼────────────────────────────────────────────────────────────────┤
│ string       │ Text input field                                               │
│ number       │ Numeric input                                                  │
│ boolean      │ Checkbox/toggle                                                │
│ select       │ Dropdown (requires options: [{label, value}])                  │
│ multiselect  │ Multi-select dropdown                                          │
│ file         │ File picker dialog                                             │
│ folder       │ Folder picker dialog                                           │
│ date         │ Date picker                                                    │
│ json         │ JSON editor for complex objects                                │
│ array        │ Array input                                                    │
└──────────────┴────────────────────────────────────────────────────────────────┘

EXAMPLE:
  { id: "trig_0", type: "manual", inputParams: [
    { name: "username", type: "string", required: true, description: "Enter username" },
    { name: "count", type: "number", defaultValue: 5, description: "How many items" },
    { name: "folder", type: "folder", description: "Select output folder" }
  ]}

ACCESS IN TEMPLATES: {{trigger.data.paramName}}
TO ADD inputParams: modify_workflow({ op: "set_path", path: "triggers[0].inputParams", value: [...] })`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // NODES
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'nodes',
    title: 'Nodes - Execution Steps',
    keywords: ['node', 'nodes', 'step', 'tool', 'args', 'output', 'ctx', 'context', 'fallbackTo', 'waitForAll', 'convergence', 'result', 'ok'],
    content: `Nodes execute tools and produce outputs stored in context.

NODE SCHEMA:
  {
    id: string,           // Unique identifier (e.g., "step_abc123")
    tool: string,         // Tool name (use get_tool_schema to verify)
    label: string,        // Display name
    args: {},             // Tool arguments (can use {{templates}})
    position: {x, y},     // Canvas position
    fallbackTo?: string,  // Node ID to jump to on failure
    waitForAll?: boolean  // Wait for all incoming branches before executing
  }

NODE OUTPUT - Each node stores its result in context:
  ctx[step.id] = { ok: true, ...toolSpecificFields }

ACCESS OUTPUTS: Use {{stepId.field}} in later node args
  {{step_1.ok}}       - success boolean (all tools have this)
  {{step_1.stdout}}   - script output (run_command, run_python_script)
  {{step_1.text}}     - AI response text (ai_inference)
  {{step_1.json}}     - Parsed JSON output (ai_inference with mode: "json")
  {{step_1.embedding}}- Vector embedding (ai_inference with mode: "embedding")
  {{step_1.data}}     - Form data object (custom_ui)
  {{step_1.action}}   - Button clicked (custom_ui)
  {{step_1.filePath}} - Saved file path (take_screenshot, capture_media)
  {{step_1.content}}  - File content (read_file)
  {{step_1.entries}}  - Directory listing (list_directory)

SPECIAL NODES:
  waitForAll: true - Convergence point that waits for ALL incoming branches
  fallbackTo: "error_handler" - Jump to error handler node on failure`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // WIRES & FLOW PATTERNS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'wires',
    title: 'Wires - Connections & Control Flow',
    keywords: ['wire', 'wires', 'connection', 'flow', 'sequential', 'conditional', 'parallel', 'branch', 'convergence', 'waitForAll', 'from', 'to'],
    content: `Wires connect triggers/nodes and define execution flow.

WIRE SCHEMA:
  {
    from: string,           // Source node/trigger ID
    to: string,             // Target node ID
    guard?: {...},          // Condition for this path (optional)
    label?: string,         // Display label
    loop?: LoopConfig,      // Loop configuration (optional)
    loopBreak?: boolean     // Marks exit from loop (optional)
  }

WIRE TYPES:

1. SIMPLE SEQUENTIAL:
   [trig_0] ──→ [step_1] ──→ [step_2]
   wires: [{ from: "trig_0", to: "step_1" }, { from: "step_1", to: "step_2" }]

2. CONDITIONAL BRANCHING (guards):
   [step_1] ──[ok == true]──→ [step_2]
          └──[ok == false]──→ [step_3]
   wires: [
     { from: "step_1", to: "step_2", guard: { if: { "==": [{ "var": "step_1.ok" }, true] } } },
     { from: "step_1", to: "step_3", guard: { if: { "==": [{ "var": "step_1.ok" }, false] } } }
   ]

3. PARALLEL BRANCHES (no guards = all run):
   [step_1] ──→ [step_2]
          └──→ [step_3]
   wires: [{ from: "step_1", to: "step_2" }, { from: "step_1", to: "step_3" }]
   // Both step_2 and step_3 run IN PARALLEL

4. CONVERGENCE (waitForAll):
   [step_2] ──┐
              ├──→ [step_4] (waitForAll: true)
   [step_3] ──┘
   nodes: [..., { id: "step_4", ..., waitForAll: true }]
   wires: [{ from: "step_2", to: "step_4" }, { from: "step_3", to: "step_4" }]

5. LOOP WITH BREAK:
   [trig_0] ──→ [step_1] ←┐ loop: forEach items
                    │      │
                    └──────┘ loopBreak → [step_2]
   wires: [
     { from: "trig_0", to: "step_1", loop: { type: "forEach", items: "{{data.items}}" } },
     { from: "step_1", to: "step_2", loopBreak: true }
   ]`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'guards',
    title: 'Guards - Conditional Wire Execution',
    keywords: ['guard', 'guards', 'condition', 'conditional', 'if', 'jsonlogic', 'json logic', 'ai routing', 'branch', 'expression', 'var', 'operator'],
    content: `Guards determine whether a wire is followed. Only wires where guard evaluates
to true (or no guard) are taken.

GUARD FORMATS (use JSONLOGIC — preferred by the visual editor):

1. JSONLOGIC (PREFERRED):
   guard: { if: { "==": [{ "var": "step_1.ok" }, true] } }
   guard: { if: { "!=": [{ "var": "step_1.ok" }, false] } }
   guard: { if: { "==": [{ "var": "step_1.action" }, "confirm"] } }
   guard: { if: { ">": [{ "var": "workflow.counter" }, 5] } }
   guard: { if: { "and": [
     { "==": [{ "var": "step_1.ok" }, true] },
     { ">": [{ "var": "step_1.count" }, 10] }
   ]}}

   PATTERN: guard: { if: { "OPERATOR": [{ "var": "LEFT_SIDE" }, RIGHT_VALUE] } }

   JSONLOGIC OPERATORS: var, ==, !=, >, <, >=, and, or, not, !, in

2. STRING EXPRESSION:
   guard: { if: "step_1.ok == true" }

3. AI ROUTING (dynamic, calls AI model):
   guard: { ai: { instruction: "Route based on user intent", produceArgs: true } }

4. CATCH-ALL (always matches):
   guard: { if: true }
   guard: "always"
   // OR: just omit guard

CRITICAL — Guard Key Formatting:
   JSONLogic keys must be PLAIN strings: "==", "var", "and", etc.
   NEVER double-quote or escape the keys.
   CORRECT: { "==": [{ "var": "x" }, "y"] }

GUARD EVALUATION ORDER:
1. Guards are evaluated in order
2. First matching guard wins
3. If multiple wires have no guard, ALL run in parallel
4. If no guards match and no catch-all, uses node.fallbackTo (if defined)`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // LOOPS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'loops',
    title: 'Loops - Repeated Execution',
    keywords: ['loop', 'loops', 'forEach', 'repeat', 'while', 'iterate', 'iteration', 'loopBreak', 'break', 'loop.item', 'loop.index', 'maxIterations', 'delay'],
    content: `Loops repeat a node (or chain of nodes) multiple times.

LOOP CONFIG SCHEMA:
  loop: {
    type: "forEach" | "repeat" | "while",
    items?: string,          // For forEach: array to iterate (template ok)
    itemVar?: string,        // Variable name for current item (default: "item")
    indexVar?: string,       // Variable name for index (default: "index")
    count?: number,          // For repeat: number of iterations
    conditionText?: string,  // For while: condition expression
    maxIterations?: number,  // Safety limit (default: 100)
    delayMs?: number         // Delay between iterations
  }

1. FOR-EACH LOOP:
   { from: "get_list", to: "process_item", loop: {
     type: "forEach", items: "{{get_list.items}}", itemVar: "item", indexVar: "index"
   }}
   ACCESS: {{loop.item}}, {{loop.index}}

2. REPEAT LOOP:
   { from: "step_1", to: "step_2", loop: { type: "repeat", count: 5, delayMs: 1000 } }

3. WHILE LOOP:
   { from: "step_1", to: "step_2", loop: {
     type: "while", conditionText: "{{workflow.counter}} < 10", maxIterations: 100
   }}

LOOP BREAK: { from: "loop_body", to: "after_loop", loopBreak: true }

LOOP RESULTS:
  ctx[stepId] = last iteration result
  ctx[stepId + "_loop_results"] = array of all iteration results`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // VARIABLES
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'variables',
    title: 'Workflow Variables - Configuration & State',
    keywords: ['variable', 'variables', 'state', 'config', 'workflow.', '$vars', 'set_variable', 'get_variable', 'toggle', 'increment', 'persist', 'defaultValue'],
    content: `Variables store workflow-level configuration and state.

VARIABLE SCHEMA:
  variables: [
    { name: string, type: string, defaultValue: any, description?: string, persistState?: boolean }
  ]

VARIABLE TYPES: string | number | boolean | json | list

ACCESS IN TEMPLATES: {{workflow.varName}}
ACCESS IN GUARDS: { "var": "workflow.varName" }

EXAMPLE:
  variables: [
    { name: "outputDir", type: "string", defaultValue: "C:/output" },
    { name: "maxRetries", type: "number", defaultValue: 3 },
    { name: "config", type: "json", defaultValue: { timeout: 5000 } }
  ]

RUNTIME VARIABLE TOOLS (persist across runs):
  set_variable: { name, value, type? }
  get_variable: { name, default? }
  toggle_variable: { name } - flips boolean
  increment_variable: { name, amount? }
  append_to_list: { name, item }
  delete_variable: { name }

ACCESS RUNTIME VARS: {{$vars.varName}} or {{varName}}`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // WORKSPACE
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'workspace',
    title: 'Workspace - Per-Workflow File System',
    keywords: ['workspace', 'workspace_read_file', 'workspace_write_file', 'workspace_list_files', '$workspace', 'scripts', 'data', 'assets', 'filePath', 'workspace path'],
    content: `Every workflow has a dedicated workspace directory on disk.

DEFAULT STRUCTURE:
  flowId/
  ├── main.stuard          (the workflow definition)
  ├── data/                (data files, CSVs, JSON, etc.)
  ├── scripts/             (Python/Node scripts)
  └── assets/              (images, templates, etc.)

WORKSPACE TEMPLATES (use in any node args):
  {{$workspace.path}}     → workspace root directory
  {{$workspace.data}}     → data/ subdirectory
  {{$workspace.scripts}}  → scripts/ subdirectory
  {{$workspace.assets}}   → assets/ subdirectory
  {{$workspace.id}}       → workflow ID

SCRIPT TOOLS WITH FILE PATHS:
  run_python_script: { filePath: "{{$workspace.scripts}}/process.py", packages: ["pandas"] }
  run_node_script: { filePath: "{{$workspace.scripts}}/transform.js" }

WORKSPACE FILE TOOLS (preferred — flowId auto-injected):
  workspace_read_file:   { path: "data/config.json" } → { ok, content, size, updatedAt }
  workspace_write_file:  { path: "data/config.json", content: "{...}" }
  workspace_list_files:  { path: "" }  (empty = root)
  workspace_create_folder: { path: "data/exports" }
  workspace_delete_file: { path: "data/old.json" }
  workspace_get_info:    {} → { ok, workspacePath, subdirs, files }

IMPORTANT: Prefer workspace tools over scripts for simple file I/O.`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // UTILITY TOOLS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'utility_tools',
    title: 'Utility Tools - No Scripts Needed',
    keywords: ['utility', 'datetime', 'math', 'uuid', 'random', 'sleep', 'hash', 'base64', 'json', 'regex', 'get_datetime', 'math_eval', 'parse', 'stringify'],
    content: `Native utility tools — instant results, no process spawning.

  get_datetime:   {} → { iso, unix, date, time, weekday, ... }
  math_eval:      { expression: "sqrt(16) + pow(2, 3)" } → { result: 12.0 }
  generate_uuid:  {} → { uuid: "550e8400-..." }
  random_number:  { min: 1, max: 100 } → { value: 42 }
  random_choice:  { items: ["a", "b", "c"] } → { choice: "b" }
  sleep:          { seconds: 2 } or { ms: 500 } → pauses (max 5 min)
  get_system_info: {} → { os, hostname, username, home, cwd }
  get_env_var:    { name: "PATH" } → { value: "...", exists: true }
  hash_string:    { text: "hello", algorithm: "sha256" } → { hash: "2cf24dba..." }
  base64_encode:  { text: "hello" } → { encoded: "aGVsbG8=" }
  base64_decode:  { encoded: "aGVsbG8=" } → { decoded: "hello" }
  json_parse:     { text: '{"key":"val"}' } → { data: { key: "val" } }
  json_stringify:  { data: { key: "val" }, pretty: true } → { json: '...' }
  regex_match:    { text: "hello world", pattern: "(\\w+)" } → { matches: [...] }
  regex_replace:  { text: "hello world", pattern: "world", replacement: "there" }

Always prefer utility tools over scripts for these operations.`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // TEMPLATES
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'templates',
    title: 'Templates - Data Interpolation',
    keywords: ['template', 'templates', 'interpolation', '{{', 'dynamic', 'reference', 'trigger.data', 'webhook', 'loop.item', 'args', '$vars', '$workspace'],
    content: `Use {{path}} syntax to inject dynamic values into node args.

TEMPLATE SOURCES:
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ Source              │ Examples                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Step outputs        │ {{step_1.ok}}, {{step_1.stdout}}, {{step_1.text}}      │
│ Trigger data        │ {{trigger.data.username}}, {{trigger.data.file}}      │
│ Webhook payload     │ {{webhook.body}}, {{webhook.headers.authorization}}   │
│ Workflow vars       │ {{workflow.outputDir}}, {{workflow.apiKey}}           │
│ Runtime vars        │ {{$vars.counter}}, {{$vars.isEnabled}}                │
│ Workspace paths     │ {{$workspace.path}}, {{$workspace.scripts}}           │
│ Loop vars           │ {{loop.item}}, {{loop.index}}                         │
│ Args (function)     │ {{args.input}}, {{args.options}}                      │
└─────────────────────┴────────────────────────────────────────────────────────┘`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STREAM ARCHITECTURE (generalized)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'stream_architecture',
    title: 'Stream Architecture - Reactive Data Flow Between Nodes',
    keywords: ['stream', 'streaming', 'reactive', 'live', 'real-time', 'realtime', 'useStream', 'streamId', 'stream wire', 'chunk', 'camera', 'video', 'audio', 'capture', 'feed', 'continuous'],
    content: `STREAM ARCHITECTURE — Reactive live data flow between any nodes.

Streams let one node continuously push data (chunks) to another node in
real time. This is a general-purpose pattern — any tool that produces a
streamId can feed into any consumer that reads it.

CORE CONCEPTS:
  1. PRODUCER — A node whose tool emits a streamId (e.g., capture_media, capture_screen, or any tool with streaming output)
  2. STREAM WIRE — A wire with a "stream" config linking producer → consumer
  3. CONSUMER — A node (typically custom_ui) that subscribes to the stream

STREAM WIRE SCHEMA:
  { from: "producer_id", to: "consumer_id", stream: { sourceField: "streamId", mode: "reactive" } }

  sourceField: which field of the producer's output holds the streamId (usually "streamId")
  mode: "reactive" — consumer receives live chunks as they arrive

useStream HOOK (in custom_ui):
  const { chunk, text, fullText, index, done } = useStream(streamId);
  // chunk: latest data chunk (any type — string, object, etc.)
  // text: chunk as string (null if not a string)
  // fullText: accumulated text from all string chunks
  // index: chunk sequence number (-1 = not started)
  // done: true when stream is closed
  // Auto-subscribes on mount, auto-unsubscribes on cleanup

STREAM-PRODUCING TOOLS (any tool that returns { streamId }):
  capture_media with mode="stream" → { streamId } (video/audio)
  capture_screen with mode="stream" → { streamId } (screen)
  Any custom tool that emits chunks via a streamId

EXAMPLE — Live camera feed in custom_ui:
  nodes: [
    { id: "cam", tool: "capture_media", args: { kind: "video", mode: "stream" } },
    { id: "display", tool: "custom_ui", args: {
      blocking: true,
      data: { "sid": "{{cam.streamId}}" },
      component: "function App() {\\n  const [sid] = useVar('sid', '');\\n  const { chunk, done } = useStream(sid);\\n  return <div>{chunk ? <img src={chunk} /> : 'Waiting...'}</div>;\\n}"
    }}
  ],
  wires: [
    { from: "trig_0", to: "cam" },
    { from: "cam", to: "display", stream: { sourceField: "streamId", mode: "reactive" } }
  ]

APPLYING STREAMS TO ANY TOOL:
  The stream architecture is tool-agnostic. To make any tool streamable:
  1. The tool must return a { streamId } in its output
  2. Wire the producer → consumer with a stream wire
  3. The consumer reads the streamId from its data args and passes it to useStream

  This works for: video feeds, audio streams, AI inference streaming,
  log tailing, sensor data, WebSocket relays, or any continuous data source.`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // CUSTOM UI - Core
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'custom_ui',
    title: 'Custom UI - React JSX Components',
    keywords: ['custom_ui', 'ui', 'component', 'jsx', 'react', 'useState', 'useEffect', 'useRef', 'useVar', 'stuard.submit', 'stuard.close', 'blocking', 'window', 'form'],
    content: `Use the 'component' field to write UIs with React JSX. Fully offline.
JSX is auto-transformed to React.createElement at runtime.

AVAILABLE HOOKS:
  useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext
  useVar(name, default) — bridges React state to workflow variables. Auto-seeds from data args.
  useStream(streamId) — subscribe to a live stream from a previous node.
  useStyles(cssString) — inject dynamic CSS at runtime.
  useInterval(fn, ms) — safe setInterval hook
  useTimeout(fn, ms) — safe setTimeout hook
  useLocalStorage(key, init) — persistent state via localStorage

useVar HOOK:
  const [count, setCount] = useVar('counter', 0);
  // count is reactive — re-renders on change
  // setCount(5) updates everywhere (other UIs, workflow context)
  // AUTO-SEEDS from data: if data has {"counter": "{{step1.json.count}}"}, useVar('counter', 0) returns it

INTERACTION:
  stuard.submit(data)          // Submit and resolve blocking promise
  stuard.close()               // Close window
  stuard.callTool(name, args)  // Call any tool directly (invisible)
  stuard.callNode(nodeId, data) // Call a SIBLING NODE by ID or LABEL

FILE/FOLDER PICKER:
  const result = await stuard.pickFolder({ title: 'Select Project' });
  const files = await stuard.pickFile({ title: 'Select', filters: [...], multiple: true });
  const savePath = await stuard.pickSavePath({ title: 'Save', defaultPath: 'file.pdf' });

FILE I/O:
  const text = await stuard.readFile('/path/to/file.txt');
  await stuard.writeFile('/path/to/output.txt', content);

CLIPBOARD & NOTIFICATIONS:
  await stuard.copyToClipboard('text');
  const text = await stuard.readClipboard();
  stuard.notify('Title', 'Body text');

CRITICAL RULES:
  1. EVERY button MUST have onClick. Use onClick={() => stuard.submit(data)} for submit buttons.
  2. useVar auto-seeds from data: match useVar names to your data keys.
  3. Use JSX style objects: style={{color: 'red'}} NOT style="color: red".
  4. Use standard Tailwind classes (bg-slate-950), not arbitrary values.

BLOCKING:
  blocking: true (default) — Workflow WAITS for interaction.
  blocking: false — UI stays open, workflow continues. For dashboards/monitors.
  timeoutMs: 30000 — Auto-resolve after timeout with { action: "timeout" }.

JSON ESCAPING for component field:
  Use \\n for newlines and \\" for quotes. Do NOT double-escape.`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // CUSTOM UI - Data Passing
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'custom_ui_data',
    title: 'Custom UI - Data Passing & useVar Seeding',
    keywords: ['data', 'passing', 'useVar', 'seed', 'previous step', 'ai_inference', 'json', 'template', 'custom_ui data'],
    content: `DATA PASSING — Feeding previous step output into custom_ui:
  The 'data' field passes values from earlier steps into the UI component.
  Template references like {{step_id.json.field}} are resolved at runtime BEFORE the UI opens.
  useVar(name, default) auto-seeds from matching keys in 'data'.

PATTERN:
  1. Previous step (e.g. ai_inference) outputs JSON: { word: "hello", meaning: "greeting" }
  2. In custom_ui args, set data keys matching useVar names:
     data: { "word": "{{prev_step.json.word}}", "meaning": "{{prev_step.json.meaning}}" }
  3. In component, useVar reads seeded values:
     const [word] = useVar('word', '');     // → "hello"
     const [meaning] = useVar('meaning', ''); // → "greeting"

RULES:
  - data KEY names MUST match useVar first argument names exactly
  - Template refs are resolved before the UI loads
  - If a data value is undefined, useVar returns the default
  - Mix static and templates: data: { "title": "Results", "count": "{{step1.json.total}}" }`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // NODE ROUTING (callNode)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'node_routing',
    title: 'Node-Routing Architecture - callNode Pattern',
    keywords: ['callNode', 'callTool', 'node routing', 'call node', 'call tool', 'caller', '{{caller', 'dashed', 'teal', 'on-demand', 'routing'],
    content: `NODE-ROUTING ARCHITECTURE — Decompose logic into visible standalone nodes.

Instead of encoding ALL tool logic inside one massive custom_ui callTool() block,
create STANDALONE visible nodes connected by callNode wires.

HOW IT WORKS:
1. Create nodes with {{caller.X}} templates:
   { id: "read_file_node", tool: "read_file", args: { path: "{{caller.filePath}}" } }

2. Connect with callNode wires:
   { "from": "my_ui", "to": "read_file_node", "callNode": true }
   callNode wires render as DASHED TEAL lines with a plug icon.
   They are NOT auto-traversed — on-demand only.

3. Call from custom_ui by ID or LABEL:
   const result = await stuard.callNode('read_file_node', { filePath: '/path' });
   const result = await stuard.callNode('Read File', { filePath: '/path' });
   // Labels are case-insensitive, whitespace/underscore/hyphen agnostic

callNode WIRES:
  { "from": "ui_node_id", "to": "target_node_id", "callNode": true }
  - Must include callNode: true
  - Render as dashed teal (#14b8a6) lines
  - Execute ON-DEMAND only when stuard.callNode() is called

WHEN TO USE callNode vs callTool:
  callNode: visual feedback, reusable nodes, heavyweight ops (AI, DB, files)
  callTool: quick utility calls, internal/incidental, no canvas clutter`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // FUNCTION TRIGGERS + CALL_FUNCTION
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'function_triggers',
    title: 'Function Triggers + call_function - Reusable Sub-Flows',
    keywords: ['function', 'call_function', 'sub-flow', 'reusable', 'triggerId', 'args', '{{args', 'notifyUi', 'set_variable'],
    content: `Use this pattern when a custom_ui needs to repeatedly invoke a sub-flow with parameters.

ARCHITECTURE:
  [Manual Trigger] → [custom_ui Dashboard (blocking)]
                        │ callNode (on-demand)
                        ▼
                    [call_function node]
                        │ triggers function trigger
                        ▼
                  [Function Trigger (inputParams)]
                      ╱         ╲
                 [Calc W]    [Calc B]  ← parallel branches
                     │           │
                 [Save W]    [Save B]  ← set_variable with notifyUi

COMPONENTS:
1. FUNCTION TRIGGER: { id: "fn_trig", type: "function", args: {
     inputParams: [{ name: "x", type: "number" }, { name: "y", type: "number" }]
   }}

2. call_function NODE: { id: "call_fn", tool: "call_function", args: {
     triggerId: "fn_trig",
     inputs: { x: "{{caller.x}}", y: "{{caller.y}}" }
   }}

3. DOWNSTREAM NODES use {{args.X}}: { tool: "math_eval", args: { expression: "{{$vars.w}} + {{args.x}}" } }

4. set_variable with notifyUi: { tool: "set_variable", args: { name: "w", value: "{{calc.result}}", notifyUi: true } }

CRITICAL: Wire from custom_ui to call_function MUST be callNode: true!
   { from: "dashboard", to: "call_fn", callNode: true }
   WITHOUT callNode: true → engine auto-traverses, {{caller.X}} resolves to empty strings.

TEMPLATE RESOLUTION CHAIN:
  UI: stuard.callNode('do_train', { x: 5, y: 1 })
    → call_function: {{caller.x}} = 5
    → function trigger: args = { x: 5, y: 1 }
    → downstream: {{args.x}} = 5
    → set_variable: notifyUi → useVar auto-updates in UI`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // MULTI-PAGE UI
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'multi_page_ui',
    title: 'Custom UI - Multi-Page SPA (Pages System)',
    keywords: ['pages', 'multi-page', 'spa', 'navigateTo', 'goBack', 'startPage', 'formData', 'data-navigate', 'navigation', 'keepOpen'],
    content: `custom_ui supports PAGES mode — a full standalone app with client-side navigation.

KEY BENEFITS:
  - Navigate between pages WITHOUT advancing the workflow step
  - Call tools from ANY page via stuard.callTool() without resolving the step
  - formData persists across all page navigations
  - The step only resolves on explicit submit/close/action

MULTI-PAGE MODE:
  { tool: "custom_ui", args: {
    title: "My App",
    pages: {
      "home": { "html": "<h1>Welcome</h1><button data-navigate='settings'>Settings</button>" },
      "settings": { "html": "<input data-bind='username'><button data-navigate='home'>Back</button>" }
    },
    startPage: "home",
    blocking: true,
    keepOpen: true,
    data: { username: "" },
    window: { width: 500, height: 400 }
  }}

PAGE DEFINITION:
  pages: { "pageName": { html: string, layout?: any, css?: string, script?: string } }

NAVIGATION:
  1. Declarative: <button data-navigate="settings">Settings</button>
  2. JavaScript: navigateTo('results', { query: formData.query })
  3. goBack() — return to previous page

PAGE SCRIPTS have access to: formData, navigateTo, goBack, stuard

DATA FLOW:
  - formData is SHARED across all pages (survives navigation)
  - data-bind inputs read/write to formData
  - On submit/close, formData is returned as step result.data`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // WINDOW CONFIG
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'window_config',
    title: 'Window Configuration - Size, Position, Transparency',
    keywords: ['window', 'width', 'height', 'position', 'frameless', 'transparent', 'translucent', 'borderRadius', 'alwaysOnTop', 'draggable', 'invisible', 'shadow', 'animation'],
    content: `WINDOW CONFIG (optional in custom_ui args):
  window: {
    width: 400, height: 300,
    position: "center",          // "center"|"topleft"|"topright"|"bottomleft"|"bottomright"|"bottomcenter"|"cursor"|"custom"
    alwaysOnTop: true,
    frameless: true,             // Remove OS title bar (required for borderRadius, translucent, transparent)
    transparent: false,
    borderRadius: 12,            // Requires frameless: true
    resizable: false,
    draggable: true,             // Default: true for frameless. Set false to disable.
    backgroundColor: "#1a1a2e",
    backgroundType: "color",     // "color"|"gradient"|"image"|"translucent"|"transparent"
    contentPadding: 24,
    shadow: { enabled: true, color: "#00000080", blur: 40, spread: 0, x: 0, y: 20 },
    border: { enabled: false, color: "#ffffff20", width: 1, style: "solid" },
    animation: { open: "fade", close: "fade", duration: 300, easing: "ease-out" },
    invisible: false             // Hide from screenshots/screen recordings
  }

TRANSPARENCY MODES:
  1. Rounded panel (solid): { frameless: true, borderRadius: 16, backgroundColor: "#1a1a2e" }
  2. Frosted glass: { frameless: true, backgroundType: "translucent", translucent: { color: "#1a1a2e", opacity: 0.7, blur: 12 } }
  3. Fully transparent: { frameless: true, backgroundType: "transparent" }`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // VISUAL: Animations, Components, Fonts
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'visual_effects',
    title: 'Visual Effects - Animations, Components, Fonts, CSS',
    keywords: ['animation', 'animate', 'framer', 'motion', 'AnimatePresence', 'component', 'Badge', 'Spinner', 'Progress', 'Tooltip', 'Switch', 'Toast', 'font', 'gradient', 'glass', 'neon', 'tailwind', 'css'],
    content: `FRAMER MOTION — Full Animation Library (globals, no imports):
  motion (motion.div, motion.span, motion.button), m, AnimatePresence,
  useAnimation, useMotionValue, useTransform, useSpring, useInView, useScroll

  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>Hello</motion.div>
  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>Click</motion.button>

PRE-BUILT COMPONENTS (globals):
  <Spinner size={24} color="currentColor" />
  <Badge variant="success">Active</Badge>        // default/primary/success/warning/danger/info
  <Progress value={75} max={100} color="bg-indigo-500" height={8} />
  <Skeleton width={200} height={20} />
  <Tooltip content="Tip"><button>Hover</button></Tooltip>
  <Switch checked={isOn} onChange={setIsOn} />
  <Toast message="Saved!" type="success" duration={3000} />
  <Avatar src="/photo.jpg" name="John" size={40} />
  <Divider label="OR" /> | <Kbd>Ctrl+K</Kbd>

FONTS: Inter (body), Outfit (headings), Space Grotesk (tech), JetBrains Mono (code)
  Classes: font-inter, font-outfit, font-grotesk, font-mono/font-code

ANIMATIONS: animate-fade-in, animate-fade-in-up, animate-slide-up, animate-scale-in,
  animate-bounce-in, animate-float, animate-glow, animate-shimmer, animate-gradient-shift,
  animate-shake, animate-wobble, animate-tada, animate-pulse, animate-heartbeat

GRADIENTS: gradient-purple-pink, gradient-blue-cyan, gradient-ocean, gradient-aurora,
  gradient-sunset, gradient-cosmic, gradient-candy, gradient-midnight
  + gradient-text for text, + animate-gradient-shift for animated

GLASS: glass, glass-sm, glass-heavy, glass-colored + noise for texture
NEON: shadow-neon-blue, shadow-neon-purple, shadow-neon-cyan, shadow-neon-green
TEXT: text-glow, text-glow-sm, text-shadow, text-outline
3D: perspective, preserve-3d, backface-hidden, rotate-x-12, rotate-y-12
STAGGER: <div className="stagger-children"> + delay-100 to delay-2000`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // MODIFY OPERATIONS
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'modify_operations',
    title: 'Modify Workflow Operations Reference',
    keywords: ['modify', 'modify_workflow', 'add_node', 'update_node', 'remove_node', 'add_wire', 'remove_wire', 'set_path', 'add_variable', 'rename', 'operation', 'op'],
    content: `IMPORTANT: DO NOT pass the full workflow JSON. The workflow is auto-loaded from session.
Use inspect_workflow before rewiring anything ambiguous, and use affectedFlow after each edit.

ADD NODE:
  modify_workflow({ op: "add_node", tool: "log", args: { message: "hi" }, connectFrom: "trig_0" })

ADD TRIGGER:
  modify_workflow({ op: "add_node", triggerType: "hotkey", triggerArgs: { accelerator: "Ctrl+K" } })

UPDATE NODE (MUST provide args, path/value, or label):
  modify_workflow({ op: "update_node", nodeId: "step_abc", args: { message: "new" } })
  modify_workflow({ op: "update_node", nodeId: "step_abc", path: "message", value: "new" })
  modify_workflow({ op: "update_node", nodeId: "trig_0", triggerArgs: { sequence: "cats" } })

REMOVE NODE:
  modify_workflow({ op: "remove_node", nodeId: "step_abc" })

ADD WIRE:
  modify_workflow({ op: "add_wire", from: "trig_0", to: "step_abc" })
  modify_workflow({ op: "add_wire", from: "step_1", to: "step_2", guard: { if: { "==": [{ "var": "step_1.ok" }, true] } } })

ADD WIRE WITH LOOP (use set_path):
  modify_workflow({ op: "set_path", path: "wires", value: [
    ...existingWires,
    { from: "get_list", to: "process", loop: { type: "forEach", items: "{{get_list.items}}" } },
    { from: "process", to: "done", loopBreak: true }
  ]})

REMOVE WIRE:
  modify_workflow({ op: "remove_wire", from: "trig_0", to: "step_abc" })

SET PATH (direct JSON edit):
  modify_workflow({ op: "set_path", path: "triggers[0].inputParams", value: [...] })
  modify_workflow({ op: "set_path", path: "outputSchema", value: [...] })
  modify_workflow({ op: "set_path", path: "wires[2].loop", value: { type: "forEach", items: "{{data}}" } })

ADD VARIABLE:
  modify_workflow({ op: "add_variable", varName: "counter", varType: "number", varDefault: 0 })

RENAME:
  modify_workflow({ op: "rename", name: "New Name" })`,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // OUTPUT SCHEMA
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'output_schema',
    title: 'Output Schema - Workflow Return Value',
    keywords: ['output', 'outputSchema', 'return', 'return_value', 'function', 'webhook', 'call_function', 'result'],
    content: `When a workflow is used as a reusable function (called via call_function or webhook),
you can define its return type with outputSchema.

OUTPUT SCHEMA:
  outputSchema: [
    { name: string, type: string, description?: string }
  ]

TYPES: string | number | boolean | json | array

EXAMPLE:
  outputSchema: [
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
    { name: "data", type: "json", description: "Processed result" },
    { name: "errorMessage", type: "string", description: "Error if failed" }
  ]

TO RETURN A VALUE, use the return_value tool:
  { id: "return", tool: "return_value", args: { value: "{{process.result}}" } }

This terminates the workflow and returns the value to the caller.`,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score a doc chunk against a query using keyword overlap.
 * Returns 0–1 relevance score.
 */
function scoreChunk(chunk: DocChunk, queryTokens: string[]): number {
  let score = 0;
  const lowerContent = chunk.content.toLowerCase();

  for (const token of queryTokens) {
    // Keyword match (high weight)
    if (chunk.keywords.some(kw => kw.includes(token) || token.includes(kw))) {
      score += 3;
    }
    // Title match (medium weight)
    if (chunk.title.toLowerCase().includes(token)) {
      score += 2;
    }
    // Content match (low weight — just confirms relevance)
    if (lowerContent.includes(token)) {
      score += 0.5;
    }
  }

  // Normalize by query length so longer queries don't unfairly inflate scores
  return queryTokens.length > 0 ? score / queryTokens.length : 0;
}

/**
 * Search documentation chunks by query.
 * Returns top-K most relevant sections.
 */
export function searchDocs(query: string, topK: number = 3): DocChunk[] {
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  if (queryTokens.length === 0) {
    // No useful query — return architecture overview
    return DOC_CHUNKS.filter(c => c.id === 'architecture');
  }

  const scored = DOC_CHUNKS
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.chunk);
}

/**
 * List all available doc section IDs and titles.
 */
export function listDocSections(): Array<{ id: string; title: string }> {
  return DOC_CHUNKS.map(c => ({ id: c.id, title: c.title }));
}

/**
 * Get a specific doc section by ID.
 */
export function getDocSection(id: string): DocChunk | null {
  return DOC_CHUNKS.find(c => c.id === id) || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH TOOL DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

export const searchWorkflowDocs = createTool({
  id: 'search_workflow_docs',
  description:
    'Search workflow documentation by topic. Returns relevant doc sections for triggers, nodes, wires, guards, loops, variables, workspace, templates, stream architecture, custom UI, node routing, modify operations, and more. Use "list" as query to see all available sections, or pass a section ID to get a specific section.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Search query describing what you need to know (e.g., "how do guards work", "stream wire setup", "forEach loop"), or "list" to see all sections, or a section ID to get that specific section.',
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(3)
      .describe('Maximum number of doc sections to return (default: 3)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      }),
    ),
    availableSections: z
      .array(z.object({ id: z.string(), title: z.string() }))
      .optional(),
  }),
  execute: async (inputData) => {
    const { query, topK } = inputData as { query: string; topK: number };

    // List mode
    if (query.trim().toLowerCase() === 'list') {
      return {
        ok: true,
        sections: [],
        availableSections: listDocSections(),
      };
    }

    // Direct ID lookup
    const directMatch = getDocSection(query.trim());
    if (directMatch) {
      return {
        ok: true,
        sections: [
          {
            id: directMatch.id,
            title: directMatch.title,
            content: directMatch.content,
          },
        ],
      };
    }

    // Search mode
    const results = searchDocs(query, topK);
    if (results.length === 0) {
      return {
        ok: true,
        sections: [],
        availableSections: listDocSections(),
      };
    }

    return {
      ok: true,
      sections: results.map(r => ({
        id: r.id,
        title: r.title,
        content: r.content,
      })),
    };
  },
});
