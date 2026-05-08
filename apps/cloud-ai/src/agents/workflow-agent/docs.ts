/**
 * Workflow Documentation Search System
 *
 * Instead of embedding ~2000+ lines of docs in the system prompt,
 * we chunk them into searchable sections. The agent calls
 * search_workflow_docs(query) to pull only what it needs — same pattern
 * as stuard's search_tools for tool discovery.
 *
 * Focus: how to CONNECT and COMPOSE workflows so they run seamlessly.
 * Individual tool schemas live in search_tools / get_tool_schema — not here.
 *
 * Token savings: ~8-12k tokens per request when the agent
 * only needs 1-2 doc sections instead of the full manual.
 */

import { createTool } from '@mastra/core/tools';
import { embedMany } from 'ai';
import { z } from 'zod';
import { getSupabaseService } from '../../supabase';
import { resolveEmbedder } from '../../utils/embeddings';

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
  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'architecture',
    title: 'Workflow Architecture — The Big Picture',
    keywords: [
      'architecture', 'overview', 'structure', 'graph', 'components', 'execution',
      'flow', 'how workflows work', 'basics', 'mental model', 'philosophy',
    ],
    content: `A workflow is a directed graph executed by the local Stuard engine.

  WORKFLOW = { id, name, triggers[], nodes[], wires[], variables?[], outputSchema?[] }

  ┌──────────┐     wire      ┌──────────┐     wire      ┌──────────┐
  │ TRIGGER  │ ───────────→ │   NODE   │ ───────────→ │   NODE   │
  │ (start)  │               │  (tool)  │               │  (tool)  │
  └──────────┘               └──────────┘               └──────────┘

PIECES:
• Triggers   — starting points (manual, hotkey, cron, webhook, fs.watch, …)
• Nodes      — tool invocations (one tool per node)
• Wires      — directed edges that control execution (plain, guarded, looped, callNode)
• Variables  — workflow-scoped (definition) and runtime (dynamic store)
• Workspace  — per-workflow folder on disk (data/scripts/assets)

CORE IDEA: DATA + CONTROL flows down the wires.
• DATA flows automatically: each node stores its result as ctx[stepId] and every
  later node reads via {{stepId.field}} templates.
• CONTROL flows through wires: guards pick which path, loops repeat paths, and
  callNode wires are on-demand (UI-triggered, not auto-traversed).

TIP: Keep one purpose per node. Don't stuff logic into custom_ui — break it out
into real nodes connected by callNode wires so the canvas tells the full story.`,
  },

  {
    id: 'execution_model',
    title: 'Execution Model — How the Engine Walks the Graph',
    keywords: [
      'execution', 'engine', 'runtime', 'lifecycle', 'context', 'ctx', 'parallel',
      'concurrency', 'order', 'waitForAll', 'fallbackTo', 'error', 'fallback',
    ],
    content: `LIFECYCLE:
1. Trigger fires → engine builds initial context { trigger: { data } }.
2. Engine finds all wires FROM the trigger → queues their target nodes.
3. For each node: resolve templates in args → call tool → store ctx[node.id] = result.
4. Engine walks outgoing wires: evaluates guards, applies loops, follows non-callNode
   wires. callNode wires are IGNORED at this stage (they are on-demand only).
5. If a node has multiple outgoing wires with NO guards → they run IN PARALLEL.
6. A node with waitForAll: true waits until ALL incoming wires have completed.
7. If a node errors and has fallbackTo → engine jumps to that node; otherwise the
   branch halts but siblings keep running.

CONTEXT:
• ctx[stepId] = { ok, ...toolSpecificFields } after each node runs.
• ctx.trigger.data = payload of the trigger (manual form, webhook body, …).
• ctx.workflow.<varName> = workflow-scoped variables (from variables[]).
• ctx.$vars.<name> = runtime variables (set_variable, toggle_variable, …).
• ctx.$workspace = paths { path, data, scripts, assets, id }.
• ctx.loop = { item, index } inside loop iterations.
• ctx.args = inputs when running as a reusable function (function trigger).

TIP: If a node doesn't fire, the most common reasons are (1) no wire connects
to it, (2) all incoming wires have guards that evaluate to false, (3) a parent
node errored with no fallbackTo. Use inspect_workflow to see the wiring.

TIP: To debug data flow, add a "log" node after the suspect node with
{ "message": "step_X output: {{step_X.ok}} {{step_X.text}}" }.`,
  },

  {
    id: 'connecting_nodes',
    title: 'Connecting Nodes — Choosing the Right Wire',
    keywords: [
      'connect', 'connecting', 'wire', 'wires', 'choose', 'which wire', 'patterns',
      'compose', 'composition', 'flow control', 'callnode vs guard', 'branching',
    ],
    content: `The art of workflow design is picking the right CONNECTION for each edge.

┌────────────────────┬──────────────────────────────────────────────────────┐
│ Intent             │ Use                                                  │
├────────────────────┼──────────────────────────────────────────────────────┤
│ Always run next    │ Plain wire: { from, to }                             │
│ Run IF condition   │ Guarded wire: { from, to, guard: { if: {...} } }     │
│ Run MULTIPLE next  │ Multiple plain wires from same source (parallel)     │
│ Merge branches     │ Set waitForAll: true on target node                  │
│ Repeat target      │ Looped wire: { from, to, loop: { type: "forEach" } } │
│ Exit a loop        │ loopBreak: true on a wire from inside the loop body  │
│ On-demand from UI  │ callNode wire: { from, to, callNode: true }          │
│ AI picks branch    │ guard: { ai: { instruction: "...", produceArgs? } }  │
│ Error recovery     │ Set fallbackTo on the failing node                   │
└────────────────────┴──────────────────────────────────────────────────────┘

RULES OF THUMB:
• Prefer PARALLEL (no guard, multiple wires) when branches don't depend on each
  other. Don't serialize needlessly.
• Prefer GUARDS for deterministic decisions (has value? empty? matches?).
• Prefer AI GUARDS only when the condition is fuzzy (intent classification,
  content routing). They cost tokens and latency.
• Prefer callNode wires for custom_ui → worker nodes. Dashed teal lines in the
  canvas signal "user-triggered".
• Prefer hotkey + hotkey.release as TWO triggers for push-to-talk patterns
  instead of guards on a single trigger.
• Prefer function triggers + call_function when the same sub-flow runs from
  multiple places (dedupe logic in a single branch).

COMMON BUG: Forgetting to wire a trigger → node. Nothing runs. Always verify
with inspect_workflow({ mode: "trigger_flow" }).`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'triggers',
    title: 'Triggers — Starting Points',
    keywords: [
      'trigger', 'triggers', 'start', 'manual', 'hotkey', 'keystroke', 'cron',
      'schedule', 'webhook', 'fs.watch', 'filesystem', 'function', 'app_start',
      'keyboard', 'shortcut',
    ],
    content: `Every trigger:
  { id: "trig_0", type: string, args: {}, label?: string, position: {x,y}, inputParams?: [] }

TRIGGER TYPES:
┌──────────────────┬───────────────────────────────────────────────────────────┐
│ Type             │ Args & Behavior                                           │
├──────────────────┼───────────────────────────────────────────────────────────┤
│ manual           │ {} — user clicks "Run" button (canvas / tray)             │
│ hotkey           │ { accelerator, hold?, passthrough? }                      │
│ hotkey.release   │ { accelerator } — fires ONLY on key release               │
│ keystroke        │ { sequence: "go" } — type text anywhere to trigger        │
│ schedule.cron    │ { cron: "0 9 * * *" } — cron expression                   │
│ webhook.local    │ {} — HTTP POST to local endpoint                          │
│ fs.watch         │ { path, pattern, recursive? } — filesystem events         │
│ function         │ { inputParams?: [] } — called by call_function            │
│ app_start        │ {} — runs once when Stuard starts                         │
└──────────────────┴───────────────────────────────────────────────────────────┘

EXAMPLE — Manual + input form:
  { id: "trig_0", type: "manual", inputParams: [
      { name: "url", type: "string", required: true }
  ]}

EXAMPLE — Cron every 15 min weekdays:
  { type: "schedule.cron", args: { cron: "*/15 * * * 1-5" } }

EXAMPLE — Webhook (auto-creates local endpoint):
  { type: "webhook.local", args: {} }
  → POST http://127.0.0.1:18080/webhooks/incoming/<flowId>
  → ctx.webhook.body, ctx.webhook.headers, ctx.webhook.query

TIP: A workflow can have MANY triggers. Each wires independently to its own
starting node — great for "run on hotkey OR on file change".`,
  },

  {
    id: 'trigger_advanced',
    title: 'Advanced Triggers — Hotkeys, Release, Keystroke, fs.watch',
    keywords: [
      'hotkey', 'hotkey.release', 'push to talk', 'ptt', 'release', 'hold',
      'keystroke', 'sequence', 'fs.watch', 'filesystem', 'file watch', 'pattern',
      'passthrough', 'accelerator',
    ],
    content: `HOTKEY (args):
  { accelerator: "Ctrl+Alt+K", hold?: boolean, passthrough?: boolean }
  • hold: false (default) → fires once on press
  • hold: true → fires TWICE: on press (event: "press") and release (event: "release")
  • passthrough: true → key still reaches the focused app (otherwise swallowed)

HOTKEY.RELEASE (args):
  { accelerator: "Ctrl+H" } — fires ONLY when the key is released
  Perfect for push-to-talk: start on press, stop on release. No guards needed.

KEYSTROKE (args):
  { sequence: "go" } — trigger when the user types "go" anywhere (text expander)

FS.WATCH (args):
  { path: "C:/folder", pattern?: "*.txt", recursive?: true }
  → ctx.trigger.data = { path, event: "add"|"change"|"unlink", timestamp }

EXAMPLE — Push-to-talk (two triggers, zero guards):
  triggers: [
    { id: "trig_press",   type: "hotkey",         args: { accelerator: "Ctrl+H" } },
    { id: "trig_release", type: "hotkey.release", args: { accelerator: "Ctrl+H" } }
  ]
  nodes: [
    { id: "start_rec", tool: "capture_media", args: { kind: "audio", mode: "until_stop", sessionId: "ptt" } },
    { id: "stop_rec",  tool: "stop_capture",  args: { sessionId: "ptt" } }
  ]
  wires: [
    { from: "trig_press",   to: "start_rec" },
    { from: "trig_release", to: "stop_rec" }
  ]

TIP: Avoid hotkey + guard on press vs release — two triggers is cleaner and
avoids race conditions around held keys.`,
  },

  {
    id: 'input_params',
    title: 'Input Parameters — Forms Before Execution',
    keywords: [
      'input', 'inputParams', 'parameters', 'form', 'user input', 'string',
      'number', 'boolean', 'select', 'multiselect', 'file', 'folder', 'date',
      'json', 'array', 'trigger.data',
    ],
    content: `Triggers can define inputParams to collect user input BEFORE the workflow runs.
This opens a form dialog; values land in ctx.trigger.data.

WHEN TO USE inputParams vs variables[]:
• inputParams  — values that CHANGE each run (a search query, a file to process,
                 a date range). The user is prompted every time they run the workflow.
• variables[]  — values that stay the SAME across runs (API key, default folder,
                 a setting). Saved with the .stuard file, never prompted at runtime.
• If in doubt: does the user need to pick it fresh each run? → inputParam.
               Is it a configuration/setting the workflow remembers? → variable.

SCHEMA:
  inputParams: [
    {
      name: string,
      type: "string"|"number"|"boolean"|"select"|"multiselect"|"file"|"folder"|"date"|"json"|"array",
      required?: boolean,
      defaultValue?: any,
      description?: string,       // shown as label/hint in the form
      options?: [{ label, value }] // for select/multiselect only
    }
  ]

EXAMPLE:
  { id: "trig_0", type: "manual", inputParams: [
    { name: "query", type: "string", required: true, description: "What to search for" },
    { name: "mode", type: "select", defaultValue: "fast",
      options: [{ label: "Fast", value: "fast" }, { label: "Thorough", value: "careful" }] },
    { name: "outputFolder", type: "folder", description: "Where to save results" }
  ]}

ACCESS IN NODES:
  {{trigger.data.query}}
  {{trigger.data.mode}}
  {{trigger.data.outputFolder}}

TO ADD inputParams:
  modify_workflow({ op: "set_path", path: "triggers[0].inputParams", value: [ ... ] })

TO ADD A SINGLE PARAM (append without overwriting others):
  modify_workflow({ op: "set_path", path: "triggers[0].inputParams[N]", value: { name, type, ... } })
  where N = current length of inputParams array.

RESPONSE STYLE: After adding inputParams, tell the user what the form will ask —
not the JSON schema. E.g. "I added a text field so you can type a message each
time you run it. Want me to use that message in the next step?"`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NODES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'nodes',
    title: 'Nodes — Execution Steps',
    keywords: [
      'node', 'nodes', 'step', 'tool', 'args', 'output', 'label', 'position',
      'fallbackTo', 'waitForAll', 'convergence',
    ],
    content: `Nodes execute tools and store outputs in context.

SCHEMA:
  {
    id: string,            // unique — e.g. "step_abc123"
    tool: string,          // tool name (verify with get_tool_schema)
    label?: string,        // display name (also used by callNode label lookup)
    args: {},              // tool arguments — supports {{templates}}
    position: { x, y },    // canvas position (x: 20-800, y: 20-600, ~140 apart)
    fallbackTo?: string,   // jump here on error
    waitForAll?: boolean   // wait for ALL incoming wires before running
  }

EXAMPLE:
  {
    id: "fetch_page",
    tool: "web_search",
    label: "Search Web",
    args: { query: "{{trigger.data.query}}", maxResults: 5 },
    position: { x: 200, y: 80 },
    fallbackTo: "error_handler"
  }

NAMING TIPS:
• Keep ids short, snake_case, descriptive: "fetch_page", "parse_json", "show_ui".
• Always set a label — it makes callNode('My Label', …) work from custom_ui.
• Label matching is case-insensitive and whitespace/underscore/hyphen agnostic.

GOTCHAS:
• Two nodes with the same id → one silently overwrites the other in context.
• tool: "" (empty) → node is a no-op but still counts as a ctx entry.
• Position matters ONLY for the canvas, not execution. Wires control flow.`,
  },

  {
    id: 'nodes_outputs',
    title: 'Node Outputs — What ctx[stepId] Contains',
    keywords: [
      'output', 'outputs', 'ctx', 'result', 'fields', 'ok', 'text', 'json',
      'stdout', 'stderr', 'data', 'action', 'filePath', 'content', 'entries',
      'streamId',
    ],
    content: `Every node output is stored as ctx[stepId] = { ok, ...toolSpecificFields }.

COMMON FIELDS (always present):
  ok          boolean   true if the tool succeeded
  error?      string    error message when ok: false

FREQUENTLY SEEN FIELDS:
  text        ai_inference (text mode), agent_node, web_search summary
  json        ai_inference (json mode), agent_node (json output), agent_extract
  embedding   ai_inference (embedding mode)
  stdout      run_command, run_python_script, run_node_script
  stderr      same as above
  exitCode    same as above
  data        custom_ui form data
  action      custom_ui button clicked ("submit"|"closed"|"<custom>")
  filePath    take_screenshot, capture_media, pickSavePath
  content     read_file
  entries     list_directory
  streamId    capture_media mode:"stream", capture_screen mode:"stream"
  items       any tool that returns a list (for forEach)

ACCESS IN TEMPLATES:
  {{step_1.ok}}
  {{step_1.json.title}}           // nested JSON
  {{step_1.json.items[0].name}}   // arrays
  {{step_1.data.form_field}}      // custom_ui form value

TIP: To find EXACT output shape, call get_tool_schema({ toolName }) — the schema
lists both inputSchema and outputSchema.

TIP: When chaining, the most common mistake is using the wrong field. Logs are
your friend — add a log step with "{{step_1}}" to dump the full output while
wiring things up, then remove it.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WIRES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'wires',
    title: 'Wires — Basic Connections',
    keywords: ['wire', 'wires', 'edge', 'connection', 'from', 'to', 'sequential', 'basic'],
    content: `WIRE SCHEMA:
  {
    from: string,            // source node/trigger id
    to: string,              // target node id
    guard?: {...},           // condition (optional)
    label?: string,          // display label (optional)
    loop?: LoopConfig,       // loop configuration (optional)
    loopBreak?: boolean,     // marks exit from a loop (optional)
    callNode?: boolean,      // on-demand only, from custom_ui (optional)
    stream?: {...}           // stream wire config (optional)
  }

SIMPLE SEQUENTIAL:
  [trig_0] ──→ [step_1] ──→ [step_2]
  wires: [
    { from: "trig_0", to: "step_1" },
    { from: "step_1", to: "step_2" }
  ]

RULES:
• from/to MUST reference existing ids (trigger or node).
• A wire without a guard and without loop config → auto-traverses when the
  source completes.
• MULTIPLE wires from the same source with NO guards → parallel branches.
• An unreachable node (no wire in) → never executes.

TIP: When adding a node, ALWAYS add a connecting wire in the same edit.
modify_workflow op:"add_node" + connectFrom auto-wires it; without connectFrom
you must add a wire separately.`,
  },

  {
    id: 'wires_branching',
    title: 'Wires — Conditional Branching & Parallelism',
    keywords: [
      'branch', 'branching', 'conditional', 'parallel', 'concurrent', 'split',
      'fan out', 'guard', 'else', 'multiple wires',
    ],
    content: `CONDITIONAL (one wire wins):
  wires: [
    { from: "step_1", to: "step_ok",   guard: { if: { "==": [{ "var": "step_1.ok" }, true  ] } } },
    { from: "step_1", to: "step_fail", guard: { if: { "==": [{ "var": "step_1.ok" }, false ] } } }
  ]

PARALLEL (all fire — no guards):
  wires: [
    { from: "step_1", to: "screenshot" },
    { from: "step_1", to: "web_search" },
    { from: "step_1", to: "read_file" }
  ]
  All three run concurrently. Independent branches.

PARTIAL PARALLEL (some conditional, some always):
  wires: [
    { from: "step_1", to: "log",    /* always */ },
    { from: "step_1", to: "notify", guard: { if: { "==": [{ "var": "step_1.ok" }, false] } } }
  ]
  log always runs; notify only on failure.

CATCH-ALL:
  guard: { if: true }   // same as no guard
  guard: "always"       // shorthand

TIP: Evaluate guards in order — first matching wire wins ONLY if multiple
guards target the same next step. For DIFFERENT targets, guards are independent
(each wire is evaluated on its own).

COMMON BUG: Using a truthy guard AND a catch-all wire to the same sink →
double-execution. Either use mutually exclusive guards, or pick one wire.`,
  },

  {
    id: 'wires_convergence',
    title: 'Wires — Convergence with waitForAll',
    keywords: [
      'converge', 'convergence', 'waitForAll', 'merge', 'join', 'fan in',
      'synchronize', 'barrier',
    ],
    content: `Use waitForAll to synchronize parallel branches before a join node runs.

PATTERN:
  [step_a] ──┐
             ├──→ [merge] (waitForAll: true)
  [step_b] ──┘

  nodes: [
    { id: "merge", tool: "log", args: { message: "Both done" }, waitForAll: true }
  ]
  wires: [
    { from: "step_a", to: "merge" },
    { from: "step_b", to: "merge" }
  ]

WITHOUT waitForAll: "merge" would fire TWICE (once per incoming wire).

WITH GUARDS: waitForAll still waits for every incoming wire whose guard matched.
If all incoming wires have false guards, merge never fires.

EXAMPLE — fetch in parallel, combine results:
  nodes: [
    { id: "fetch_a", tool: "fetch_url", args: { url: "{{trigger.data.a}}" } },
    { id: "fetch_b", tool: "fetch_url", args: { url: "{{trigger.data.b}}" } },
    { id: "combine", tool: "log", args: { message: "{{fetch_a.text}} || {{fetch_b.text}}" },
      waitForAll: true }
  ]
  wires: [
    { from: "trig_0", to: "fetch_a" },
    { from: "trig_0", to: "fetch_b" },
    { from: "fetch_a", to: "combine" },
    { from: "fetch_b", to: "combine" }
  ]

TIP: Use waitForAll when you explicitly need "N of N" completion. If you only
need "1 of N", omit waitForAll — the first to arrive triggers the node.`,
  },

  {
    id: 'wires_callnode',
    title: 'Wires — callNode (On-Demand Routing from custom_ui)',
    keywords: [
      'callnode', 'callNode', 'call node', 'on-demand', 'custom_ui', 'dashed',
      'teal', 'routing', 'caller', 'plug', 'stuard.callNode',
    ],
    content: `callNode wires let a custom_ui window invoke SIBLING NODES on demand.
They are NOT auto-traversed by the engine — they only fire when the UI calls
stuard.callNode(nodeId | label, data).

SCHEMA:
  { from: "ui_node_id", to: "worker_node_id", callNode: true }

HOW IT WORKS:
1. custom_ui renders a UI.
2. User clicks a button → await stuard.callNode('Read File', { path: '/tmp/x' }).
3. Engine finds the worker node by id OR label (case-insensitive, space/_/- agnostic).
4. Worker's args template {{caller.path}} resolves to '/tmp/x'.
5. Worker runs; its result is returned to the caller as the promise value.
6. The wire animates (dashed teal) while the worker runs.

EXAMPLE — UI calls a file reader:
  nodes: [
    { id: "ui",     tool: "custom_ui", args: { /* component with button */ } },
    { id: "reader", tool: "read_file", label: "Read File",
      args: { path: "{{caller.path}}" } }
  ]
  wires: [
    { from: "trig_0", to: "ui" },
    { from: "ui", to: "reader", callNode: true }
  ]

  In the UI component:
    const r = await stuard.callNode('Read File', { path: '/tmp/example.txt' });
    // r.content is the file contents

WHEN TO USE:
• Keep heavyweight work (AI, DB, files, HTTP) OUT of the UI and IN standalone
  nodes the user can see on the canvas.
• Make UI interactions self-describing: the wire lights up when a button runs.
• Reuse one node from multiple UI buttons (all wire to it with callNode: true).

callTool vs callNode:
• callNode — preferred for UI actions; visible node with a callNode wire; animates; can use {{caller.X}}.
• callTool — legacy invisible escape hatch for tiny helper calls only.

TIP: If {{caller.X}} resolves to "" in the worker, the wire is likely missing
callNode: true — engine auto-traversed it once at start, so caller data wasn't
passed. Add callNode: true.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GUARDS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'guards',
    title: 'Guards — JSONLogic Conditions',
    keywords: [
      'guard', 'guards', 'condition', 'jsonlogic', 'json logic', 'if', 'expression',
      'var', 'operator', 'compare', 'and', 'or', 'not',
    ],
    content: `Guards determine whether a wire is followed. JSONLogic is preferred.

FORMATS:
  guard: { if: { "==": [{ "var": "step_1.ok" }, true] } }
  guard: "step_1.ok == true"        // string expression
  guard: { if: true }               // catch-all
  guard: "always"                   // catch-all

JSONLOGIC OPERATORS:
  "=="  "!="  ">"  ">="  "<"  "<="
  "and" "or"  "not"  "!"  "in"
  "var" (read a path)
  "+"  "-"  "*"  "/"  (arithmetic)

PATTERN:
  guard: { if: { OPERATOR: [LEFT, RIGHT] } }
  LEFT/RIGHT can be literals OR { "var": "path" }.

EXAMPLES:
  // Simple equality
  guard: { if: { "==": [{ "var": "step_1.action" }, "confirm"] } }

  // Greater than
  guard: { if: { ">": [{ "var": "workflow.counter" }, 5] } }

  // Compound AND
  guard: { if: { "and": [
    { "==": [{ "var": "step_1.ok" }, true] },
    { ">":  [{ "var": "step_1.json.score" }, 0.8] }
  ] } }

  // NOT (three ways)
  guard: { if: { "not": { "var": "step_1.ok" } } }
  guard: { if: { "!":   { "var": "step_1.ok" } } }
  guard: { if: { "==":  [{ "var": "step_1.ok" }, false] } }

  // IN (check membership)
  guard: { if: { "in": [{ "var": "step_1.action" }, ["save", "submit"]] } }

VARIABLE ACCESS IN GUARDS:
  { "var": "step_1.field" }
  { "var": "workflow.counter" }     // workflow-scoped variable
  { "var": "$vars.isRecording" }    // runtime variable
  { "var": "trigger.data.url" }     // trigger input

CRITICAL — plain strings for operator keys:
  CORRECT:  { "==": [...] }
  WRONG:    { "\\"==\\"": [...] }   // double-quoted; parse error

TIP: If a guard behaves weirdly, add a log node with "{{step_1}}" to see the
actual field shape — you may be looking at step_1.json.ok instead of step_1.ok.`,
  },

  {
    id: 'guards_ai',
    title: 'AI Routing — Dynamic Branch Selection',
    keywords: [
      'ai', 'ai routing', 'ai guard', 'dynamic', 'intent', 'classification',
      'route', 'produceArgs', 'instruction', 'smart', 'fuzzy',
    ],
    content: `AI guards ask a model to pick the best branch based on context.

SYNTAX:
  guard: {
    ai: {
      instruction: "Pick the branch that matches the user's intent",
      produceArgs?: boolean,     // let AI also patch the target's args
      model?: string             // "fast" | "balanced" | "smart" (optional)
    }
  }

HOW IT WORKS:
1. Engine collects the source node's context and ALL possible next targets.
2. Sends to model with your instruction.
3. Model returns a target id (and optional args patch if produceArgs: true).
4. If model fails, engine falls back to node.fallbackTo.

EXAMPLE — intent router:
  nodes: [
    { id: "ask",   tool: "custom_ui",      args: { /* prompts for user input */ } },
    { id: "shot",  tool: "take_screenshot", args: {} },
    { id: "web",   tool: "web_search",      args: { query: "{{ask.data.text}}" } },
    { id: "read",  tool: "read_file",       args: { path: "{{ask.data.text}}" } }
  ]
  wires: [
    { from: "trig_0", to: "ask" },
    { from: "ask", to: "shot",
      guard: { ai: { instruction: "User wants to capture screen → screenshot" } } },
    { from: "ask", to: "web",
      guard: { ai: { instruction: "User wants to search online → web" } } },
    { from: "ask", to: "read",
      guard: { ai: { instruction: "User references a file path → read" } } }
  ]

WHEN TO USE:
• Fuzzy intent classification ("what does the user want?").
• Content-based branching (classify AI output into N buckets).
• Multi-way routing where static guards are awkward.

WHEN NOT TO USE:
• Simple booleans, numeric comparisons, or exact string matches → use JSONLogic
  (deterministic + free).
• Hot loops → every hop costs a model call.

TIP: The instruction should describe the WHOLE choice, not just the current
branch. The model sees all instructions together and picks the best match.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOPS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'loops',
    title: 'Loops — forEach, repeat, while',
    keywords: [
      'loop', 'loops', 'forEach', 'for each', 'repeat', 'while', 'iterate',
      'iteration', 'maxIterations', 'delay', 'delayMs', 'itemVar', 'indexVar',
    ],
    content: `Loops live on WIRES, not nodes. The target node runs multiple times.

LOOP CONFIG:
  loop: {
    type: "forEach" | "repeat" | "while",
    items?: string,            // forEach: array to iterate (template)
    itemVar?: string,          // forEach: current item binding (default "item")
    indexVar?: string,         // forEach: index binding (default "index")
    count?: number,            // repeat: number of iterations
    conditionText?: string,    // while: condition (truthy = continue)
    maxIterations?: number,    // safety cap (default 100)
    delayMs?: number           // delay between iterations
  }

1) FOR-EACH:
  { from: "get_list", to: "process", loop: {
      type: "forEach",
      items: "{{get_list.items}}",
      itemVar: "item",
      indexVar: "i"
  }}
  ACCESS inside target:
    {{loop.item}}    // current element
    {{loop.index}}   // zero-based index
    {{loop.item.name}} // if items are objects

2) REPEAT:
  { from: "step_1", to: "step_2", loop: { type: "repeat", count: 5, delayMs: 1000 } }

3) WHILE:
  { from: "gate", to: "work", loop: {
      type: "while",
      conditionText: "{{workflow.counter}} < 10",
      maxIterations: 100
  }}

LOOP OUTPUTS:
  ctx[stepId]                    = result of the LAST iteration
  ctx[stepId + "_loop_results"]  = array of ALL iteration results

TIP: Start small — set maxIterations: 5 while testing, then raise.

TIP: To accumulate results, use set_variable + append_to_list each iteration,
then read ctx.$vars.collected after the loop.`,
  },

  {
    id: 'loops_patterns',
    title: 'Loop Patterns — Break, Chain, Nest',
    keywords: [
      'loop break', 'loopBreak', 'break', 'chain', 'nested', 'nest', 'accumulate',
      'collect', 'aggregate', 'loop results',
    ],
    content: `LOOP BREAK — exit mid-iteration:
  wires: [
    { from: "trig_0", to: "step_1",
      loop: { type: "forEach", items: "{{data.items}}" } },
    { from: "step_1", to: "after_loop", loopBreak: true,
      guard: { if: { "==": [{ "var": "step_1.ok" }, false] } } }
  ]
  // When step_1 fails, jump to after_loop and STOP iterating.

ACCUMULATE INTO A LIST (runtime variable):
  nodes: [
    { id: "reset", tool: "set_variable", args: { name: "results", value: [], type: "list" } },
    { id: "fetch", tool: "web_search", args: { query: "{{loop.item}}" } },
    { id: "save",  tool: "append_to_list", args: { name: "results", item: "{{fetch.text}}" } },
    { id: "done",  tool: "log", args: { message: "Collected {{$vars.results}}" } }
  ]
  wires: [
    { from: "trig_0", to: "reset" },
    { from: "reset", to: "fetch",
      loop: { type: "forEach", items: "{{trigger.data.queries}}" } },
    { from: "fetch", to: "save" },
    { from: "save", to: "done", loopBreak: true,
      guard: { if: { "==": [{ "var": "loop.index" }, { "var": "trigger.data.queries.length" }] } } }
  ]

NESTED LOOPS:
  Possible but messy in the editor. Prefer:
    • flatten your data upstream, OR
    • split into two workflows connected via call_function.

PARALLEL ITERATION (fan-out):
  forEach sequentially iterates by default. For true parallelism, use inputs
  that yield N triggers (e.g., N fs.watch events) or call_function inside the
  loop body — each call spawns an independent execution.

TIP: ctx[stepId + "_loop_results"] holds every iteration result. Use it
post-loop for "last N items" style aggregation without set_variable.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA FLOW
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'templates',
    title: 'Templates — {{path}} Interpolation',
    keywords: [
      'template', 'templates', 'interpolation', '{{', 'dynamic', 'reference',
      'trigger.data', 'webhook', 'loop.item', '$vars', '$workspace', 'caller',
      'args', 'nested',
    ],
    content: `Use {{path}} to inject dynamic values into node args (also supports type
preservation — "{{count}}" → number 5, not string "5").

TEMPLATE SOURCES:
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ Source              │ Examples                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Step outputs        │ {{step_1.ok}}, {{step_1.stdout}}, {{step_1.text}}      │
│ Nested output       │ {{step_1.json.items[0].name}}                          │
│ Trigger data        │ {{trigger.data.username}}, {{trigger.data.file}}      │
│ Webhook payload     │ {{webhook.body}}, {{webhook.headers.authorization}}   │
│ Workflow vars       │ {{workflow.outputDir}}, {{workflow.apiKey}}           │
│ Runtime vars        │ {{$vars.counter}}, {{$vars.isEnabled}}                │
│ Workspace paths     │ {{$workspace.path}}, {{$workspace.scripts}}           │
│ Loop vars           │ {{loop.item}}, {{loop.index}}                         │
│ Function args       │ {{args.input}}, {{args.options}}                      │
│ callNode caller     │ {{caller.filePath}}, {{caller.query}}                 │
└─────────────────────┴────────────────────────────────────────────────────────┘

TYPE PRESERVATION:
• If the WHOLE arg value is a single template ("{{step.count}}"), the resolved
  value keeps its original type (number/bool/array/object).
• If templates appear inside a larger string ("hi {{name}}"), the result is a
  string.

NESTED TEMPLATES:
  "{{arr[{{i}}].name}}" — inner resolves first.

ARRAY INDEXING:
  "{{results.items[0].url}}"
  "{{results.items[2]}}"

TIP: To debug, add a log node with "dump: {{step_1}}" — the whole object is
stringified. Remove it once resolved.`,
  },

  {
    id: 'variables_workflow',
    title: 'Workflow Variables — Workflow-Level Config',
    keywords: [
      'workflow variable', 'variables', 'config', 'defaultValue', 'persistState',
      'workflow.', 'declared variables', 'types', 'json', 'list',
    ],
    content: `variables[] declared on the workflow itself — initialized every run and
accessible via {{workflow.varName}} or $vars.varName.

SCHEMA:
  variables: [
    {
      name: string,
      type: "string"|"number"|"boolean"|"json"|"list",
      defaultValue: any,
      description?: string,
      persistState?: boolean   // survive across runs (persisted on disk)
    }
  ]

EXAMPLE:
  variables: [
    { name: "outputDir", type: "string", defaultValue: "C:/output" },
    { name: "maxRetries", type: "number", defaultValue: 3 },
    { name: "enabled", type: "boolean", defaultValue: true, persistState: true },
    { name: "config", type: "json", defaultValue: { timeout: 5000 } }
  ]

ACCESS:
  Args: {{workflow.outputDir}}, {{$vars.outputDir}}
  Guards: { "var": "workflow.outputDir" }
  custom_ui: useVar('outputDir', '') — reactive binding

MUTATE AT RUNTIME:
  set_variable: { name: "workflow.outputDir", value: "C:/new" }
  Or from custom_ui: const [dir, setDir] = useVar('outputDir', 'C:/default');

persistState: true → stored in the workflow-variables file; a new run starts
from the persisted value instead of defaultValue. Great for counters, toggles.

TO ADD:
  modify_workflow({ op: "add_variable", varName: "x", varType: "number", varDefault: 0 })

TIP: Use workflow variables for CONFIG (API keys, paths, modes). Use runtime
vars (via set_variable without declaring) for transient execution state. Both
read via $vars, but declared vars show up in the UI's Variables panel.`,
  },

  {
    id: 'variables_runtime',
    title: 'Runtime Variables — Dynamic State Tools',
    keywords: [
      'set_variable', 'get_variable', 'toggle_variable', 'increment_variable',
      'append_to_list', 'delete_variable', 'runtime', 'dynamic', '$vars',
      'notifyUi', 'reactive',
    ],
    content: `Runtime variables are created on the fly with set_variable. They live in the
same store as workflow variables but aren't declared upfront.

TOOLS (registered — use get_tool_schema for exact args):
  set_variable       { name, value, type?, notifyUi? }
  get_variable       { name, default? }
  toggle_variable    { name }              // flips boolean
  increment_variable { name, amount? }
  append_to_list     { name, item }
  delete_variable    { name }

ACCESS:
  Args:   {{$vars.counter}}, {{varName}} (shorthand), {{workflow.x}} (workflow-scoped)
  Guards: { "var": "$vars.counter" }, { "var": "counter" }
  UI:     useVar(varName, default)

notifyUi FLAG (important!):
  set_variable({ name: "progress", value: 50, notifyUi: true })
  → broadcasts to ALL custom_ui windows; any useVar('progress') instantly reflects 50.
  Without notifyUi, the store updates but no cross-window event fires.

TOGGLE PATTERN (single hotkey start/stop):
  nodes: [
    { id: "check",  tool: "get_variable",   args: { name: "isRecording", default: false } },
    { id: "start",  tool: "capture_media",  args: { kind: "audio", mode: "until_stop", sessionId: "rec" } },
    { id: "stop",   tool: "stop_capture",   args: { sessionId: "rec" } },
    { id: "toggle", tool: "toggle_variable", args: { name: "isRecording" } }
  ]
  wires: [
    { from: "trig_0", to: "check" },
    { from: "check", to: "start", guard: { if: { "!": { "var": "check.value" } } } },
    { from: "check", to: "stop",  guard: { if: { "var": "check.value" } } },
    { from: "start", to: "toggle" },
    { from: "stop",  to: "toggle" }
  ]

TIP: Any variable referenced from custom_ui's useVar should be set with
notifyUi: true (or via useVar's setter in the UI) so reactive updates fire.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'workspace',
    title: 'Workspace — Per-Workflow File System',
    keywords: [
      'workspace', '$workspace', 'data', 'scripts', 'assets', 'filePath',
      'workspace path', 'workspace_read_file', 'workspace_write_file',
      'workspace_list_files', 'workspace_create_folder', 'workspace_delete_file',
      'workspace_get_info',
    ],
    content: `Every workflow has a dedicated folder on disk.

STRUCTURE:
  <flowId>/
  ├── main.stuard       (workflow definition)
  ├── data/             (CSVs, JSON, state files)
  ├── scripts/          (Python / Node scripts)
  └── assets/           (images, templates, static files)

TEMPLATE PATHS (use anywhere in args):
  {{$workspace.path}}     → workspace root
  {{$workspace.data}}     → data/
  {{$workspace.scripts}}  → scripts/
  {{$workspace.assets}}   → assets/
  {{$workspace.id}}       → flow id

WORKSPACE TOOLS (prefer these — flowId auto-injected, relative paths):
  workspace_read_file     { path: "data/config.json" }
  workspace_write_file    { path: "data/config.json", content: "..." }
  workspace_list_files    { path: "data" }    // path: "" for root
  workspace_create_folder { path: "data/exports" }
  workspace_delete_file   { path: "data/old.json" }
  workspace_get_info      {}

SCRIPT TOOLS:
  run_python_script { filePath: "{{$workspace.scripts}}/do.py", packages: ["pandas"] } // uses persistent default venv unless envId is set
  run_node_script   { filePath: "{{$workspace.scripts}}/do.js" }

TIP: Prefer workspace tools over absolute paths — the workflow becomes portable
(works on any machine). If the user shares the .stuard file, the workspace
folder travels with it.

TIP: For one-off scripts, prefer inline code (pass "code" instead of "filePath")
so the logic lives IN the workflow JSON and there are no external files.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'utility_tools',
    title: 'Utility Tools — No Scripts Needed',
    keywords: [
      'utility', 'datetime', 'math', 'uuid', 'random', 'sleep', 'hash', 'base64',
      'json', 'regex', 'get_datetime', 'math_eval', 'parse', 'stringify',
    ],
    content: `Native utility tools — instant results, no process spawning.

  get_datetime        {} → { iso, unix, date, time, weekday, ... }
  math_eval           { expression: "sqrt(16) + pow(2, 3)" } → { result: 12.0 }
  generate_uuid       {} → { uuid: "550e8400-..." }
  random_number       { min: 1, max: 100 } → { value: 42 }
  random_choice       { items: ["a", "b", "c"] } → { choice: "b" }
  sleep               { seconds: 2 } or { ms: 500 }
  get_system_info     {} → { os, hostname, username, home, cwd }
  get_env_var         { name: "PATH" } → { value, exists }
  hash_string         { text: "hello", algorithm: "sha256" } → { hash }
  base64_encode       { text: "hello" } → { encoded }
  base64_decode       { encoded: "aGVsbG8=" } → { decoded }
  json_parse          { text: '{"k":"v"}' } → { data }
  json_stringify      { data: { k: "v" }, pretty: true } → { json }
  regex_match         { text: "...", pattern: "(\\\\w+)" } → { matches }
  regex_replace       { text: "...", pattern: "a", replacement: "b" }
  log                 { message: "..." } (great for debugging data flow)

TIP: ALWAYS prefer these over run_python_script for simple ops. They're fast,
have no env setup, and don't need package installs.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SCRIPTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'scripts',
    title: 'Scripts — Python & Node Inline or File',
    keywords: [
      'python', 'node', 'script', 'run_python_script', 'run_node_script',
      'packages', 'pip', 'npm', 'inline', 'code', 'filePath', 'venv', 'envId',
    ],
    content: `Use scripts for logic that doesn't fit existing tools.

PYTHON (run_python_script):
  Inline:
    { tool: "run_python_script", args: {
        code: "import numpy as np\\nprint(np.arange(5))",
        packages: ["numpy"],
        timeoutMs: 60000,
        envId: "my-env"   // optional: named isolated venv; omit for persistent default
    }}
  File:
    { tool: "run_python_script", args: {
        filePath: "{{$workspace.scripts}}/process.py",
        args: ["{{trigger.data.input}}"],
        packages: ["pandas", "requests"]
    }}
  Output: { ok, stdout, stderr, exitCode, packagesInstalled }

NODE (run_node_script):
  { tool: "run_node_script", args: {
      code: "console.log(process.argv.slice(2))",
      args: ["hello"],
      timeoutMs: 30000
  }}
  Output: same as python.

TIPS:
• Use packages: [...] — they auto-install on first run. Increase timeoutMs for
  big installs (60s per package is a safe estimate).
• Pass values via args: [] and read sys.argv / process.argv.slice(2).
• PRINT JSON to stdout, then parse in the next node with json_parse.
• For simple arithmetic/string ops, math_eval / regex_match beat spawning Python.
• Omit envId for the persistent default venv; set envId to group scripts into an isolated shared venv.

RETURNING JSON TO NEXT NODE:
  Python prints:  print(json.dumps({ "result": 42 }))
  Next node:      json_parse { text: "{{script.stdout}}" }
  Use:            {{parse.data.result}}`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AI INFERENCE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'ai_inference',
    title: 'ai_inference — Stateless Text→Text/JSON/Embedding',
    keywords: [
      'ai_inference', 'ai', 'inference', 'text', 'json', 'embedding', 'model',
      'prompt', 'schema', 'structured output',
    ],
    content: `Stateless AI calls — no tools, no multi-step reasoning. Fastest + cheapest
AI node. For tool-using agents, see agent_nodes.

TEXT MODE (default):
  { tool: "ai_inference", args: {
      prompt: "Summarize in 3 bullets",
      input: "{{read_file.content}}",
      model: "openai/gpt-4.1-mini"
  }}
  Output: { ok, text }

JSON MODE (structured):
  { tool: "ai_inference", args: {
      prompt: "Classify sentiment",
      input: "{{user.text}}",
      mode: "json",
      schema: { sentiment: "string", confidence: "number", keywords: "string[]" },
      model: "google/gemini-2.5-pro"
  }}
  Output: { ok, json: { sentiment, confidence, keywords } }

EMBEDDING MODE:
  { tool: "ai_inference", args: {
      input: "...",
      mode: "embedding",
      model: "openai/text-embedding-3-small"
  }}
  Output: { ok, embedding: [...] }

MODELS (examples):
  openai/gpt-4o, openai/gpt-4.1, openai/gpt-4.1-mini
  google/gemini-2.5-pro, google/gemini-3-pro-preview
  deepseek/deepseek-chat
  openai/text-embedding-3-small

TIP: Use JSON mode with a small schema — the model returns valid JSON every
time, which you can chain into guards/templates without regex parsing.

TIP: For repeated similar calls (batch classify), run in a forEach loop. For
ad-hoc routing, use AI GUARDS instead — cheaper than an ai_inference + guard.`,
  },

  {
    id: 'agent_nodes',
    title: 'Agent Nodes — agent_node, agent_decision, agent_extract',
    keywords: [
      'agent_node', 'agent_decision', 'agent_extract', 'agent', 'tools', 'reasoning',
      'multi-step', 'outputMode', 'outputSchema', 'maxSteps', 'decision', 'extract',
    ],
    content: `Agent nodes are AI steps that can USE TOOLS and reason over multiple steps.
Unlike ai_inference, they aren't stateless.

agent_node — full AI agent step (text or json):
  { tool: "agent_node", args: {
      prompt: "Analyze the email and find action items",
      context: "{{gmail.body}}",
      systemPrompt: "You are a helpful assistant.",
      model: "balanced",          // "fast" | "balanced" | "smart"
      outputMode: "text",         // or "json"
      outputSchema: { items: "string[]", priority: "string" },  // json mode
      tools: [],                  // restrict tools; [] = pure reasoning
      maxSteps: 10,
      timeoutMs: 300000
  }}
  Output: { ok, text, json?, model, toolCalls, durationMs }

agent_decision — lightweight branching decision:
  { tool: "agent_decision", args: {
      question: "Is this email spam?",
      context: "{{email.body}}",
      options: ["spam", "legitimate", "unsure"],
      model: "fast"
  }}
  Output: { ok, decision, reason, confidence }

agent_extract — structured extraction from unstructured text:
  { tool: "agent_extract", args: {
      text: "{{read_file.content}}",
      fields: {
        name: "person's full name",
        email: "email address",
        phone: "phone number"
      },
      model: "fast"
  }}
  Output: { ok, data: { name, email, phone } }

WHEN TO USE WHICH:
┌──────────────────┬────────────────────────────────────────────────┐
│ Need             │ Tool                                           │
├──────────────────┼────────────────────────────────────────────────┤
│ text→text/json   │ ai_inference (cheapest, fastest)               │
│ Pick from N opts │ agent_decision (+ guards for branching)        │
│ Parse fields     │ agent_extract                                  │
│ Multi-step+tools │ agent_node (most expensive)                    │
└──────────────────┴────────────────────────────────────────────────┘

TIP: Start with ai_inference. Upgrade to agent_node only if you truly need
tool calling or multi-turn reasoning.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STREAMS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'streams',
    title: 'Streams — Reactive Data Flow Between Nodes',
    keywords: [
      'stream', 'streaming', 'reactive', 'live', 'real-time', 'realtime',
      'useStream', 'streamId', 'stream wire', 'chunk', 'camera', 'video',
      'audio', 'feed', 'continuous',
    ],
    content: `Streams let one node continuously push chunks to another in real time.
Tool-agnostic: anything that returns { streamId } can feed anything that reads it.

PIECES:
• PRODUCER — tool that returns { streamId } (capture_media, capture_screen, AI
  streaming, custom tools).
• STREAM WIRE — { from, to, stream: { sourceField: "streamId", mode: "reactive" } }
• CONSUMER — typically custom_ui with useStream(streamId).

useStream HOOK:
  const { chunk, text, fullText, index, done } = useStream(streamId);
  // chunk    — latest data chunk (any type: string, object, frame buffer, …)
  // text     — chunk as string (null if not a string)
  // fullText — accumulated text (all string chunks concatenated)
  // index    — chunk sequence number (-1 = not started)
  // done     — true when the stream closes

STREAM-PRODUCING TOOLS (examples):
  capture_media  { kind: "video"|"audio", mode: "stream" } → { streamId }
  capture_screen { mode: "stream" }                        → { streamId }
  ai_inference   (streaming variant if supported)          → { streamId }

EXAMPLE — live webcam in custom_ui:
  nodes: [
    { id: "cam", tool: "capture_media", args: { kind: "video", mode: "stream" } },
    { id: "display", tool: "custom_ui", args: {
        blocking: true,
        data: { sid: "{{cam.streamId}}" },
        component: "function App() {\\n  const [sid] = useVar('sid', '');\\n  const { chunk } = useStream(sid);\\n  return chunk ? <img src={chunk} /> : <div>Waiting…</div>;\\n}"
    }}
  ],
  wires: [
    { from: "trig_0", to: "cam" },
    { from: "cam", to: "display",
      stream: { sourceField: "streamId", mode: "reactive" } }
  ]

TIP: Always pass the streamId via the UI's data prop and bind with useVar —
that way a fresh run re-seeds the stream id without needing a full rebuild.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNCTION TRIGGERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'function_triggers',
    title: 'Function Triggers + call_function — Reusable Sub-Flows',
    keywords: [
      'function', 'function trigger', 'call_function', 'sub-flow', 'reusable',
      'triggerId', 'inputs', 'args', 'notifyUi', 'return_value', 'outputSchema',
    ],
    content: `Turn a sub-flow into a reusable function. Any node (including custom_ui) can
invoke it with parameters and get a return value.

ARCHITECTURE:
  [Function Trigger (inputParams)] ──→ [body nodes] ──→ [return_value]
                          ▲
                          │ invoked by
                          │
  [call_function node]  ← any caller (custom_ui, another workflow, …)

1) DEFINE the function trigger:
  { id: "fn_trig", type: "function", args: {
      inputParams: [
        { name: "x", type: "number", required: true },
        { name: "y", type: "number", required: true }
      ]
  }}

2) WIRE body nodes from fn_trig — use {{args.x}} / {{args.y}} templates:
  { id: "calc", tool: "math_eval", args: { expression: "{{args.x}} + {{args.y}}" } }
  wires: [{ from: "fn_trig", to: "calc" }]

3) RETURN a value:
  { id: "ret", tool: "return_value", args: { value: "{{calc.result}}" } }
  wires: [{ from: "calc", to: "ret" }]

4) CALL IT with call_function:
  { id: "call", tool: "call_function", args: {
      triggerId: "fn_trig",
      inputs: { x: "{{caller.x}}", y: 1 }
  }}

5) CALL FROM custom_ui — use callNode: true wire:
  { from: "ui", to: "call", callNode: true }

  UI:
    const r = await stuard.callNode('call', { x: 5 });
    // r.value = 6

CRITICAL: The wire from custom_ui → call_function MUST be callNode: true. If
auto-traversed, {{caller.X}} resolves to empty strings because no caller data
was passed.

return_value TERMINATES the branch immediately — no nodes after it will run.
Do NOT add further wires from a return_value node. The result lands in
ctx.<callNodeId>.value for the caller to read.

TIP: Use outputSchema to type-check the return payload (see output_schema doc).

TIP: Use function triggers to DE-DUPLICATE logic. Anywhere you'd copy-paste 3
nodes, extract them behind a function trigger and call it instead.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — BASICS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_basics',
    title: 'Custom UI — React JSX Components (Offline)',
    keywords: [
      'custom_ui', 'ui', 'component', 'jsx', 'react', 'function App', 'blocking',
      'offline', 'tailwind', 'sucrase',
    ],
    content: `custom_ui renders a React app in a dedicated window. Fully offline — React
UMD + Tailwind are prebuilt and injected. JSX is transpiled at runtime.

MINIMAL:
  { tool: "custom_ui", args: {
      id: "my_win",
      title: "Hello",
      component: "function App() { return <div className='p-6'>Hello!</div>; }",
      window: { width: 400, height: 300 }
  }}

RULES:
• component MUST define function App() returning JSX.
• id is reused across calls — same id = update existing window, no flicker.
• blocking: true (default) → workflow WAITS for submit/close.
• blocking: false → UI shown, workflow continues. For dashboards.
• Use standard Tailwind classes. Arbitrary values (bg-[#abc]) may miss offline.

CRITICAL:
1. EVERY button MUST have onClick — no onClick = dead button = workflow blocks
   forever. Use stuard.submit() / stuard.close() / stuard.action().
2. Use JSX style objects: style={{color: 'red'}}, NOT style="color: red".
3. useVar AUTO-SEEDS from data args: match useVar name to data key.

DATA PASSING (resolved before the UI opens):
  { tool: "custom_ui", args: {
      data: { title: "Results", count: "{{step1.json.total}}" },
      component: "function App() {\\n  const [count] = useVar('count', 0);\\n  return <h1>Count: {count}</h1>;\\n}"
  }}

TIP: Always set an id — re-running the workflow reuses the window and just
updates state. Without id, a new window spawns each run (flash + lost state).

TIP: For small popups, use frameless + borderRadius. For full dashboards, use
framed window and a normal app icon.`,
  },

  {
    id: 'custom_ui_hooks',
    title: 'Custom UI — Hooks Reference',
    keywords: [
      'hook', 'hooks', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
      'useReducer', 'useContext', 'useLayoutEffect', 'useVar', 'useStream',
      'useStyles', 'useInterval', 'useTimeout', 'useLocalStorage',
    ],
    content: `Hooks available globally in every custom_ui component:

REACT CORE:
  useState, useEffect, useRef, useMemo, useCallback, useReducer,
  useContext, useLayoutEffect

STUARD HOOKS:
  useVar(name, default)       — bridges React state ↔ workflow variable.
                                Auto-seeds from data args (name must match key).
                                Returns [value, setValue]. setValue writes to
                                the store and notifies all UIs.
  useStream(streamId)         — subscribe to a live stream from a producer node.
                                Returns { chunk, text, fullText, index, done }.
  useStyles(cssString)        — inject CSS at runtime. Auto-cleans on unmount.
  useInterval(fn, ms)         — safe setInterval that auto-clears.
  useTimeout(fn, ms)          — safe setTimeout that auto-clears.
  useLocalStorage(key, init)  — persist state via localStorage.

useVar EXAMPLES:
  const [count, setCount] = useVar('counter', 0);
  // Seed from data: { counter: "{{step1.json.count}}" }

  // Update from INSIDE the UI (updates workflow store + all listeners):
  setCount(c => c + 1);

  // Update from OUTSIDE (workflow node):
  set_variable({ name: "counter", value: 5, notifyUi: true })
  // or: update_custom_ui({ id: "my_win", data: { counter: 5 } })
  // Both trigger the useVar('counter') listener in the UI.

useStream EXAMPLE:
  function App() {
    const [sid] = useVar('sid', '');
    const { chunk, done } = useStream(sid);
    if (done) return <div>Done!</div>;
    return chunk ? <img src={chunk} /> : <div>Waiting…</div>;
  }

TIP: Pair useVar with update_custom_ui / set_variable notifyUi: true to push
live updates from the workflow into the UI without closing the window.`,
  },

  {
    id: 'custom_ui_data',
    title: 'Custom UI — Data Passing & useVar Seeding',
    keywords: [
      'data', 'passing', 'useVar', 'seed', 'previous step', 'ai_inference',
      'json', 'template', 'custom_ui data', 'initialData',
    ],
    content: `The data field is the bridge between previous nodes and the React component.

PATTERN:
1. Previous step produces output:
   ai_inference → ctx.prev = { ok: true, json: { word: "hello", meaning: "greeting" } }

2. custom_ui data field references it with templates:
   data: {
     word: "{{prev.json.word}}",
     meaning: "{{prev.json.meaning}}"
   }

3. Templates are resolved BEFORE the UI loads → initialData = { word: "hello", meaning: "greeting" }.

4. Component uses useVar with MATCHING NAMES:
   function App() {
     const [word] = useVar('word', '');      // → "hello"
     const [meaning] = useVar('meaning', ''); // → "greeting"
     return <div><b>{word}</b>: {meaning}</div>;
   }

RULES:
• data KEYS must match useVar first argument EXACTLY.
• Templates resolve pre-render; runtime updates go via useVar(setter), set_variable,
  or update_custom_ui.
• Mixed values work: data: { title: "Results", count: "{{step1.total}}" }.
• Undefined values → useVar returns default.

ACCESS initialData DIRECTLY:
  window.initialData.word    // raw snapshot at render time
  (useVar is preferred — reactive.)

TIP: For loops / forEach iterations into the SAME custom_ui id, each iteration
updates the existing window via setVariable under the hood. useVar sees the
change. This is how progress bars work without closing the window.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — MARKDOWN
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_markdown',
    title: 'Custom UI — Markdown Rendering (<Markdown> / <ReactMarkdown>)',
    keywords: [
      'markdown', 'md', 'Markdown', 'ReactMarkdown', 'remarkGfm', 'remarkMath',
      'rehypeKatex', 'render markdown', 'gfm', 'github flavored', 'math', 'katex',
      'code block', 'table',
    ],
    content: `Custom UI has react-markdown BUNDLED OFFLINE. Use the <Markdown> global
(alias of ReactMarkdown) to render markdown text — great for AI results, docs,
help panels.

GLOBALS AVAILABLE:
  Markdown        — alias for ReactMarkdown (use this)
  ReactMarkdown   — same component
  remarkGfm       — GitHub Flavored Markdown (tables, strikethrough, task lists)
  remarkMath      — math syntax ($...$, $$...$$)
  rehypeKatex     — render math with KaTeX

BASIC:
  function App() {
    const [text] = useVar('text', '# Hello\\n\\n**Bold** and _italic_.');
    return (
      <div className="p-4">
        <Markdown>{text}</Markdown>
      </div>
    );
  }

WITH GFM (tables, strikethrough, task lists):
  <Markdown remarkPlugins={[remarkGfm]}>{mdText}</Markdown>

WITH MATH (KaTeX):
  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
    {"Euler: $e^{i\\\\pi}+1=0$"}
  </Markdown>

RENDER AI OUTPUT:
  function App() {
    const [reply] = useVar('reply', '');  // seeded from {{ai.text}}
    return (
      <div className="p-6 prose max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{reply}</Markdown>
      </div>
    );
  }
  // data: { reply: "{{ai_step.text}}" }
  // When the ai step updates (update_custom_ui or set_variable notifyUi:true),
  // the markdown re-renders automatically.

STYLING:
• Wrap in <div className="prose max-w-none"> for nice typography defaults.
• Pair with Tailwind prose-invert for dark mode.
• Override components for custom rendering:
    <Markdown components={{ h1: ({children}) => <h1 className="text-3xl">{children}</h1> }}>
      {text}
    </Markdown>

TIP: For live-streaming AI text, seed useVar from the stream consumer, NOT from
{{step.text}} directly — streams update chunk-by-chunk:
  const [sid] = useVar('sid', '');
  const { fullText } = useStream(sid);
  return <Markdown>{fullText}</Markdown>;`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — LIVE UPDATES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_live_updates',
    title: 'Custom UI — Live Updates (useVar + update_custom_ui + set_variable)',
    keywords: [
      'live update', 'reactive', 'update_custom_ui', 'set_variable', 'notifyUi',
      'push', 'real-time', 'ui variable', 'useVar update', 'dashboard', 'progress',
    ],
    content: `Three ways to push updates into an OPEN custom_ui window.

1) set_variable with notifyUi: true — the canonical path:
   { tool: "set_variable", args: {
       name: "progress",
       value: 75,
       notifyUi: true
   }}
   Any useVar('progress') in ANY open window updates instantly.

2) update_custom_ui — updates ONE window's data (and useVar):
   { tool: "update_custom_ui", args: {
       id: "my_win",
       data: { progress: 75, status: "Processing…" }
   }}
   Each key in data is propagated as a workflow variable, so useVar('progress')
   and useVar('status') both see the new values.

3) From INSIDE the UI — the setter side of useVar:
   const [count, setCount] = useVar('counter', 0);
   setCount(c => c + 1);
   // Updates the store AND broadcasts to other windows that use useVar('counter').

PROGRESS BAR EXAMPLE:
  nodes: [
    { id: "ui", tool: "custom_ui", args: {
        id: "progress_win",
        title: "Working…",
        data: { progress: 0, status: "Starting" },
        component: "function App() {\\n  const [p] = useVar('progress', 0);\\n  const [s] = useVar('status', '');\\n  return (\\n    <div className='p-6'>\\n      <div>{s}</div>\\n      <div className='w-full bg-gray-200 rounded'><div className='bg-blue-500 h-2 rounded' style={{width: p + '%'}}/></div>\\n    </div>\\n  );\\n}",
        blocking: false   // don't wait — workflow keeps going
    }},
    { id: "work_1", tool: "update_custom_ui",
      args: { id: "progress_win", data: { progress: 25, status: "Step 1/4" } } },
    // … more updates …
    { id: "work_4", tool: "update_custom_ui",
      args: { id: "progress_win", data: { progress: 100, status: "Done!" } } }
  ]

TIP: Use blocking: false for dashboards/monitors, and close_custom_ui at the end
if you want the window to auto-dismiss. For user-required confirmations, keep
blocking: true.

COMMON BUG: You call update_custom_ui but useVar doesn't update → you're on an
older build. The fix propagates every data key through setVariable so useVar
listeners fire. If this still happens, verify the window id matches the custom_ui
id EXACTLY (case-sensitive).

TIP: To stream AI text into markdown live:
  - Set up a stream producer → stream wire → custom_ui.
  - Inside: const { fullText } = useStream(sid); <Markdown>{fullText}</Markdown>.
  No update_custom_ui needed — the stream wire handles it.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — STUARD API
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_stuard_api',
    title: 'Custom UI — stuard API Reference',
    keywords: [
      'stuard', 'stuard api', 'callTool', 'callNode', 'pickFile', 'pickFolder',
      'pickSavePath', 'readFile', 'writeFile', 'clipboard', 'notify', 'submit',
      'close', 'action', 'navigate', 'resize', 'center', 'stopWorkflow',
    ],
    content: `stuard is a global object in every custom_ui window. All methods return
Promises unless noted as fire-and-forget (void).

TOOL & NODE ROUTING:
  await stuard.callNode(idOrLabel, data) — preferred: call sibling node via callNode wire
  await stuard.callTool(name, args)   — legacy escape hatch; invisible, no canvas animation

FILE / FOLDER (native OS dialogs):
  await stuard.pickFile({ title, filters, multiple })
  await stuard.pickFolder({ title, multiple })
  await stuard.pickSavePath({ title, defaultPath, filters })

FILE I/O (restricted to approved paths):
  await stuard.readFile(path, encoding?)
  await stuard.writeFile(path, content)

CLIPBOARD & NOTIFICATIONS:
  await stuard.copyToClipboard(text)
  await stuard.readClipboard()
  stuard.notify('Title', 'Body')   // fire-and-forget

WINDOW LIFECYCLE (fire-and-forget):
  stuard.submit(data)         — resolves the blocking promise, closes window
  stuard.close(data)          — close without "submit" semantics
  stuard.action(name, data)   — named action (doesn't close by default)
  stuard.stopWorkflow()       — halts the whole workflow

WINDOW CONTROLS (fire-and-forget):
  stuard.resize(w, h)
  stuard.moveTo(x, y)        // same screen coordinate space as mouse tools
  stuard.center()
  stuard.setAlwaysOnTop(true)
  stuard.minimize()

COORDINATES:
  custom_ui explicit window x/y and stuard.moveTo(x, y) use the same origin and
  scaling as get_mouse_position, move_cursor, and click_at_coordinates. On
  high-DPI displays the desktop converts those mouse-tool pixels to Electron
  window coordinates internally.

VARIABLE API:
  await stuard.getVar(name)           // { ok, name, value, type }
  await stuard.setVar(name, value)    // broadcasts update
  await stuard.subscribeVars(['*'])   // listen to all; usually handled by useVar

EVENTS:
  stuard.on(eventName, cb)            → returns unsubscribe fn
  stuard.emit(eventName, data)
  stuard.onDataUpdate(cb)             → fires on update_custom_ui
  stuard.onVarUpdate(cb)              → fires on variable changes (name, value, type)
  stuard.onPageChange(cb)             → pages system navigation

MULTI-PAGE:
  stuard.navigate(pageName, data)
  await stuard.getCurrentPage()

SYSTEM:
  await stuard.getScreenInfo()
  await stuard.getWindowId()
  await stuard.getFlowId()

SHORTHAND (also available as $stuard):
  $stuard.tool(name, args)            $stuard.node(id, data)
  $stuard.submit(data)                $stuard.close(data)
  $stuard.setVar(name, val)           $stuard.getVar(name)
  $stuard.nav(page, data)

TIP: Prefer callNode over callTool when the work is non-trivial — the canvas
lights up, and the node is reusable from other UIs/workflows.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — NODE ROUTING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_node_routing',
    title: 'Custom UI — Node Routing Deep Dive (callNode + {{caller}})',
    keywords: [
      'callNode', 'node routing', 'architecture', 'caller', '{{caller', 'dashed',
      'teal', 'standalone', 'decompose', 'visible', 'from ui',
    ],
    content: `NODE ROUTING turns custom_ui into an orchestrator for visible sibling nodes.
Instead of stuffing tool calls inside callTool blocks, you wire to real nodes
and call them on demand.

ANATOMY:
1. A worker node with {{caller.X}} templates:
   { id: "summarize", tool: "ai_inference", label: "Summarize",
     args: { prompt: "Summarize", input: "{{caller.text}}" } }

2. callNode wire from the UI:
   { from: "my_ui", to: "summarize", callNode: true }

3. UI invocation:
   const { text } = await stuard.callNode('Summarize', { text: longText });
   // or by id: stuard.callNode('summarize', { text: longText })

LABEL MATCHING:
  'Summarize'   → matches label "Summarize"
  'summarize'   → matches (case-insensitive)
  'my summary'  → does not match
  Matching priority: exact id → exact label → normalized label
  (whitespace/underscore/hyphen agnostic)

MULTIPLE TARGETS FROM ONE UI:
  wires: [
    { from: "ui", to: "fetch",     callNode: true },
    { from: "ui", to: "summarize", callNode: true },
    { from: "ui", to: "save",      callNode: true }
  ]
  // UI calls any of them based on user interaction.

REUSE ONE NODE FROM MANY UIs:
  wires: [
    { from: "ui_a", to: "analyze", callNode: true },
    { from: "ui_b", to: "analyze", callNode: true }
  ]

PASSING MULTIPLE FIELDS:
  // Worker
  { id: "save", tool: "write_file",
    args: { path: "{{caller.path}}", content: "{{caller.content}}" } }
  // UI
  await stuard.callNode('save', { path: '/tmp/x.txt', content: 'hi' })

TEMPLATES AVAILABLE IN WORKER ARGS (during callNode):
  {{caller.field}}          — from UI data
  {{caller.nested.path}}    — nested caller data
  {{$workspace.path}}       — workspace paths
  {{$vars.x}} / {{workflow.x}} — variables

GOTCHAS:
• Wire MUST have callNode: true. Without it, the engine auto-traverses and
  {{caller.X}} resolves to "".
• The worker's ctx entry is updated each call — subsequent non-callNode uses of
  ctx.worker.field see the LATEST call's result.
• call_function is special — it runs an entire sub-flow; wire with callNode: true
  and pass inputs as data.

TIP: Draw the architecture on paper first. Each UI button → one callNode edge.
Each worker node handles ONE responsibility. Keep the graph clean.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — MULTI-PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_multi_page',
    title: 'Custom UI — Multi-Page Apps (useState pattern & pages mode)',
    keywords: [
      'pages', 'multi-page', 'spa', 'navigate', 'navigateTo', 'goBack', 'startPage',
      'formData', 'data-navigate', 'navigation', 'keepOpen',
    ],
    content: `Two ways to build multi-page UIs:

APPROACH A — useState inside the component (recommended for React):
  function App() {
    const [page, setPage] = useState('home');
    const [form, setForm] = useState({ ...initialData });

    if (page === 'settings') return (
      <div>
        <h2>Settings</h2>
        <button onClick={() => setPage('home')}>Back</button>
      </div>
    );

    return (
      <div>
        <h2>Home</h2>
        <button onClick={() => setPage('settings')}>Settings</button>
        <button onClick={() => stuard.submit(form)}>Submit</button>
      </div>
    );
  }

APPROACH B — pages mode (declarative, formData auto-persists):
  { tool: "custom_ui", args: {
      title: "Wizard",
      pages: {
        "home":    { html: "<h1>Welcome</h1><button data-navigate='step1'>Next</button>" },
        "step1":   { html: "<input data-bind='name'/><button data-navigate='done'>Next</button>" },
        "done":    { html: "<h2>Thanks {name}!</h2><button data-action='submit'>Finish</button>" }
      },
      startPage: "home",
      blocking: true,
      keepOpen: true,
      data: { name: "" }
  }}

  Navigation in JS:
    navigateTo('results', { query: 'foo' })
    goBack()

  HTML bindings:
    <button data-navigate="next-page">Next</button>
    <input data-bind="formField" />   <!-- two-way formData binding -->
    <button data-action="submit">Finish</button>

WHEN TO USE WHICH:
• React useState → most apps. More flexible, full React idioms.
• pages mode → simple multi-step wizards, agents want declarative structure,
  pure HTML (no JSX).

DATA IN PAGES MODE:
• formData is SHARED across pages — survives navigation.
• Step only resolves on data-action="submit"/"close" or stuard.submit/close.

TIP: Prefer React useState when you need conditional rendering, validation,
animations, or callTool interop inside the component.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — WINDOW CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_window',
    title: 'Custom UI — Window Configuration',
    keywords: [
      'window', 'width', 'height', 'position', 'frameless', 'transparent',
      'translucent', 'borderRadius', 'alwaysOnTop', 'draggable', 'invisible',
      'shadow', 'animation', 'background', 'gradient', 'size',
    ],
    content: `Full window config (all optional):
  window: {
    width: 400, height: 300,
    position: "center",              // center|topleft|topright|bottomleft|bottomright|bottomcenter|cursor|custom
    x: 100, y: 100,                  // for position: "custom"
    alwaysOnTop: true,
    frameless: true,                 // required for rounded/translucent/transparent
    transparent: false,              // transparent canvas
    borderRadius: 12,                // requires frameless: true
    resizable: false,
    movable: true,
    draggable: true,                 // frameless windows can be dragged by default
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    backgroundType: "color",         // "color" | "gradient" | "image" | "translucent" | "transparent"
    backgroundColor: "#1a1a2e",
    gradient: {
      type: "linear"|"radial"|"conic",
      angle: 135,
      stops: [{ color: "#4f46e5", position: 0 }, { color: "#ec4899", position: 100 }]
    },
    backgroundImage: { url: "local-file:///C:/path/bg.png", fit: "cover" },
    translucent: { color: "#1a1a2e", opacity: 0.7, blur: 12 },
    contentPadding: 24,
    shadow: { enabled: true, color: "#00000080", blur: 40, spread: 0, x: 0, y: 20 },
    border: { enabled: false, color: "#ffffff20", width: 1, style: "solid" },
    animation: { open: "fade"|"slide-up"|"slide-down"|"scale"|"none", duration: 300, easing: "ease-out" },
    invisible: false                 // hidden from screenshots / screen recordings
  }

PRESETS:
  // Rounded solid panel:
  { frameless: true, borderRadius: 16, backgroundColor: "#1a1a2e" }

  // Frosted glass:
  { frameless: true, backgroundType: "translucent",
    translucent: { color: "#1a1a2e", opacity: 0.7, blur: 12 } }

  // Fully transparent canvas:
  { frameless: true, backgroundType: "transparent" }

  // Fullscreen overlay:
  { frameless: true, position: "topleft", x: 0, y: 0, width: 1920, height: 1080,
    transparent: true, alwaysOnTop: true }

TIP: Frameless windows need className="drag" on the title-bar element for
click-drag. Buttons inside .drag need className="no-drag" to remain clickable.

TIP: invisible: true is unique — the window is visible to you but NOT to
screen capture (screenshots, recording tools, screen share). Perfect for
notes/cheat-sheets during meetings.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — VISUAL
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_visual',
    title: 'Custom UI — Framer Motion, Components, Fonts, CSS',
    keywords: [
      'framer', 'motion', 'animation', 'AnimatePresence', 'useAnimation',
      'Badge', 'Spinner', 'Progress', 'Tooltip', 'Switch', 'Toast', 'Avatar',
      'Divider', 'Kbd', 'font', 'gradient', 'glass', 'neon', 'tailwind', 'css',
      'animate', 'animate-fade', 'shadow-neon',
    ],
    content: `FRAMER MOTION — full library, zero imports:
  motion.div, motion.span, motion.button, AnimatePresence
  useAnimation, useMotionValue, useTransform, useSpring, useInView, useScroll

  <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0}} />
  <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}}>Click</motion.button>
  <AnimatePresence>{open && <motion.div />}</AnimatePresence>

BUILT-IN COMPONENTS (globals):
  <Spinner size={24} color="currentColor" />
  <Badge variant="success|primary|warning|error|info|default">Active</Badge>
  <Progress value={75} max={100} color="bg-indigo-500" height={8} />
  <Skeleton width={200} height={20} />
  <Tooltip content="Tip"><button>Hover</button></Tooltip>
  <Switch checked={on} onChange={setOn} />
  <Toast message="Saved!" type="success" duration={3000} />
  <Avatar src="/photo.jpg" name="John" size={40} />
  <Divider label="OR" />
  <Kbd>Ctrl+K</Kbd>
  <Markdown>{mdText}</Markdown>

FONTS (all offline):
  font-inter      — Inter (body)
  font-outfit     — Outfit (headings)
  font-grotesk    — Space Grotesk (tech)
  font-mono       — JetBrains Mono (code)

ANIMATIONS (Tailwind utility classes):
  animate-fade-in, animate-fade-in-up, animate-slide-up, animate-scale-in,
  animate-bounce-in, animate-float, animate-glow, animate-shimmer,
  animate-gradient-shift, animate-shake, animate-wobble, animate-tada,
  animate-pulse, animate-heartbeat

GRADIENTS (background presets):
  gradient-purple-pink, gradient-blue-cyan, gradient-ocean, gradient-aurora,
  gradient-sunset, gradient-cosmic, gradient-candy, gradient-midnight
  + gradient-text (text fill), + animate-gradient-shift (animated)

GLASS: glass, glass-sm, glass-heavy, glass-colored + noise
NEON: shadow-neon-blue, shadow-neon-purple, shadow-neon-cyan, shadow-neon-green
TEXT: text-glow, text-glow-sm, text-shadow, text-outline
3D: perspective, preserve-3d, backface-hidden, rotate-x-12, rotate-y-12
STAGGER: <div className="stagger-children"> + delay-100 → delay-2000

TIP: For a quick polished UI, wrap content in className="p-6 space-y-4
animate-fade-in-up" and pair buttons with whileHover/whileTap motion props.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM UI — PITFALLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'custom_ui_pitfalls',
    title: 'Custom UI — Common Pitfalls & Fixes',
    keywords: [
      'pitfall', 'pitfalls', 'mistake', 'bug', 'common', 'problems', 'issues',
      'button without onClick', 'style string', 'useVar stale', 'escape', 'quote',
      'debug', 'troubleshoot',
    ],
    content: `1) "My button does nothing."
   Every button needs onClick. Without it, the UI has no way to resolve the
   blocking promise and the workflow hangs forever.
   BAD:  <button>Submit</button>
   GOOD: <button onClick={() => stuard.submit(data)}>Submit</button>

2) "style= strings don't work."
   In JSX, style is an object, not a string.
   BAD:  style="color: red; padding: 8px"
   GOOD: style={{color: 'red', padding: '8px'}}

3) "useVar returns default even though data has the value."
   Names must match EXACTLY. data: { userName } with useVar('username') → default.
   Check casing.

4) "Arbitrary Tailwind class doesn't work."
   Arbitrary values like bg-[#050510] need JIT generation, which may miss offline.
   Use standard classes (bg-slate-950) or inline style={{background: '#050510'}}.

5) "UI opens fresh every run, loses state."
   You forgot id. Set a stable id so the same window is reused:
   args: { id: "my_win", ... }

6) "useVar doesn't update when I call update_custom_ui."
   You're on an old build. update_custom_ui now propagates each data key through
   setVariable so useVar listeners fire. Update to the latest.

7) "Escape character hell in the component string."
   JSON-escape your component:
     newlines → \\n
     double quotes → \\" (inside JSON strings)
     NEVER double-escape. Bad: \\\\n → produces a literal "\\n" in code.

8) "Preload not found" / stuard is undefined.
   Build the desktop app so custom-ui preload is compiled. In dev: the fallback
   stuard API is loaded (basic subset). Rebuild for full API.

9) "Component error" overlay.
   Read the error + source display — it highlights the offending line. Most
   common: referencing an identifier that isn't a known global (like importing).
   Remove the import — all libraries are already globals.

10) "UI blocks forever."
    blocking: true + no submit/close button or escape handler. Add:
      useEffect(() => {
        const h = e => e.key === 'Escape' && stuard.close();
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
      }, []);

TIP: Open DevTools on any custom_ui window (Ctrl+Shift+I when focused) to see
console errors and iterate faster.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MODIFY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'modify_operations',
    title: 'modify_workflow — All Operations Reference',
    keywords: [
      'modify', 'modify_workflow', 'add_node', 'update_node', 'remove_node',
      'add_wire', 'remove_wire', 'set_path', 'add_variable', 'rename', 'op',
      'stuardFile',
    ],
    content: `IMPORTANT: Do NOT pass the full workflow JSON. The current workflow is
auto-loaded from the session. Just pass { op, ...params }.

ADD NODE:
  modify_workflow({ op: "add_node", tool: "log", args: { message: "hi" },
                    connectFrom: "trig_0", label: "Log hi" })

ADD TRIGGER (also via add_node):
  modify_workflow({ op: "add_node",
    triggerType: "hotkey", triggerArgs: { accelerator: "Ctrl+K" } })

UPDATE NODE:
  // Replace whole args
  modify_workflow({ op: "update_node", nodeId: "step_abc",
                    args: { message: "new" } })
  // Patch single path
  modify_workflow({ op: "update_node", nodeId: "step_abc",
                    path: "message", value: "new" })
  // Update trigger args
  modify_workflow({ op: "update_node", nodeId: "trig_0",
                    triggerArgs: { sequence: "cats" } })
  // Change label
  modify_workflow({ op: "update_node", nodeId: "step_abc", label: "New Name" })

REMOVE NODE:
  modify_workflow({ op: "remove_node", nodeId: "step_abc" })

ADD WIRE:
  modify_workflow({ op: "add_wire", from: "trig_0", to: "step_abc" })
  modify_workflow({ op: "add_wire", from: "step_1", to: "step_2",
    guard: { if: { "==": [{ "var": "step_1.ok" }, true] } } })

ADD WIRE (callNode or loop — use set_path):
  modify_workflow({ op: "set_path", path: "wires", value: [
    ...existingWires,
    { from: "ui", to: "worker", callNode: true },
    { from: "get_list", to: "process",
      loop: { type: "forEach", items: "{{get_list.items}}" } }
  ]})

REMOVE WIRE:
  modify_workflow({ op: "remove_wire", from: "trig_0", to: "step_abc" })

SET PATH (direct JSON edit):
  modify_workflow({ op: "set_path", path: "triggers[0].inputParams",
                    value: [ ... ] })
  modify_workflow({ op: "set_path", path: "outputSchema", value: [ ... ] })
  modify_workflow({ op: "set_path", path: "wires[2].loop",
                    value: { type: "forEach", items: "{{data}}" } })

ADD VARIABLE:
  modify_workflow({ op: "add_variable", varName: "counter",
                    varType: "number", varDefault: 0 })

RENAME WORKFLOW:
  modify_workflow({ op: "rename", name: "My Flow v2" })

TARGETING SUB-WORKFLOWS:
  modify_workflow({ op: "add_node", tool: "log", args: { message: "hi" },
                    stuardFile: "sub/sub.stuard" })

TIP: Batch related edits — if you add a node, also add its wire in a separate
call right after. inspect_workflow between edits to verify topology.`,
  },

  {
    id: 'modify_pitfalls',
    title: 'modify_workflow — Pitfalls',
    keywords: [
      'pitfall', 'mistake', 'bug', 'modify_workflow', 'common', 'problems',
      'broken wire', 'orphan', 'invalid args', 'session',
    ],
    content: `1) Passing the full workflow JSON as "workflow" param.
   → Don't. modify_workflow auto-loads from the session. Just pass the op +
     params. Passing a full spec usually CORRUPTS the store.

2) Adding a node but no wire.
   → Node is orphaned; never runs. Either use connectFrom on add_node, or add
     a wire immediately after.

3) Using update_node without args/path/value/label.
   → Nothing happens. You must tell it WHAT to change.

4) Removing a node without removing its wires.
   → Broken references. Most engines tolerate it but inspect_workflow will
     flag them.

5) set_path with a wrong path.
   → "triggers.0.args" is wrong — use brackets: "triggers[0].args".

6) Editing the wrong file.
   → Default is the main workflow. For sub-workflows, pass stuardFile.

7) Forgetting callNode: true on UI wires.
   → Engine auto-traverses → {{caller.X}} is empty → the node "works" but
     gets no data.

8) Duplicate node ids.
   → Silent overwrite in context. Pick distinct ids.

9) Guard JSON with quoted keys like "\\"==\\"" instead of "==".
   → JSONLogic parse fails; wire never fires.

10) Too-tall/too-wide positions.
    → Node renders off-canvas. Stay within x: 20-800, y: 20-600.

TIP: After any structural change, call inspect_workflow({ mode: "overview" })
and/or ({ mode: "trigger_flow" }) to verify the topology matches your mental
model.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT SCHEMA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'output_schema',
    title: 'Output Schema & return_value — Typed Return from Sub-Flows',
    keywords: [
      'output', 'outputSchema', 'return', 'return_value', 'function', 'webhook',
      'call_function', 'result', 'terminate', 'end workflow',
    ],
    content: `return_value IMMEDIATELY terminates the workflow branch and returns its payload
to the caller. No nodes after return_value will run.

WHEN TO USE return_value:
• Workflow is called via call_function from another workflow or custom_ui.
• You need a typed result that callers can read from ctx.call.value.
• You want to terminate cleanly at a specific point (e.g. one branch succeeds,
  other branch returns an error value).

WHEN NOT TO USE return_value:
• Main workflow that just runs top-to-bottom — simply let it finish naturally.
• Triggering a side-effect chain with no caller — use end instead if you need
  an explicit stop.

RETURN VALUE NODE:
  { id: "ret", tool: "return_value", args: {
      value: "{{step.text}}"         // scalar
      // OR
      value: { ok: true, data: "{{process.json}}" }  // object
  }}

  → Sets the return payload AND stops that branch immediately.
  → Caller reads it as ctx.<callNodeId>.value

OUTPUT SCHEMA (optional typing for callers):
  outputSchema: [
    { name: "success", type: "boolean", description: "Whether op succeeded" },
    { name: "data",    type: "json",    description: "Processed result" }
  ]

  TO ADD:
    modify_workflow({ op: "set_path", path: "outputSchema", value: [ ... ] })

TIP: For error paths, add a separate return_value at the end of each guard
branch — one for success, one for failure — each returning a different payload.

TIP: When you have outputSchema, test by calling the workflow with
call_function from another workflow — you'll see the typed return in
ctx.call.value.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUGGING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'debugging',
    title: 'Debugging & Inspection',
    keywords: [
      'debug', 'debugging', 'inspect', 'inspect_workflow', 'log', 'troubleshoot',
      'trace', 'problem', 'not firing', 'orphan', 'stuck',
    ],
    content: `inspect_workflow — your first move when something is off:
  inspect_workflow({ mode: "overview" })      — summary of nodes/wires/triggers
  inspect_workflow({ mode: "node_flow" })     — execution order view
  inspect_workflow({ mode: "trigger_flow" })  — from each trigger outward
  inspect_workflow({ mode: "wire" })          — wire-level details

LOG NODE — dump any value:
  { tool: "log", args: { message: "step_1 = {{step_1}}" } }
  The whole object is stringified. Remove once you've confirmed data flow.

get_tool_schema — confirm exact args/outputs:
  get_tool_schema({ toolName: "web_search" })
  Returns inputSchema + outputSchema so you know exactly what to pass and what
  comes back.

COMMON SYMPTOMS → FIXES:
• "Nothing happens on trigger" → missing wire; inspect_workflow({ mode: "trigger_flow" }).
• "Downstream node sees empty data" → template path is wrong; add a log node.
• "Guard never matches" → field type mismatch; dump ctx[step] and compare.
• "UI freezes the workflow" → blocking: true + no submit/close button; fix onClick.
• "Tool call errors" → use get_tool_schema to verify arg shape.
• "Variable doesn't reach UI" → use set_variable notifyUi: true OR update_custom_ui.
• "callNode passes empty caller" → forgot callNode: true on the wire.

WORKFLOW LOG PANEL:
  Each run streams logs to the flow's log panel. Look for:
    [engine] step X running/completed/error
    [custom_ui:ID] ... (UI-side activity)
    [tool:name] ... (tool-side)

TIP: Start with the SMALLEST reproducible flow (trigger → 1 node → log). Once
that works, add one piece at a time.`,
  },

  {
    id: 'common_pitfalls',
    title: 'Common Pitfalls — Global Mistakes to Avoid',
    keywords: [
      'pitfall', 'mistakes', 'common bugs', 'gotchas', 'best practices',
      'donts', "don't", 'antipattern',
    ],
    content: `Cross-cutting mistakes that trip up most workflow builds.

1) TEMPLATE PATHS
   - Double-check ctx shape with a log node.
   - Prefer single-template args ("{{x}}") for type preservation.
   - Nested arrays: "{{items[0].name}}".

2) WIRES
   - A new node without a wire is dead weight.
   - Multiple unguarded wires from one source = parallel (might not be what you want).
   - callNode wires require callNode: true.

3) GUARDS
   - Plain string operator keys (no double-quoting).
   - Test guards with literal values before using {{var}}.
   - guard: { if: true } for catch-all; omit guard for "always".

4) CUSTOM UI
   - Every button needs onClick.
   - useVar name must match data key.
   - id is required for persistent windows.
   - Build the desktop app so the preload is available.

5) VARIABLES
   - set_variable without notifyUi doesn't refresh open UIs.
   - workflow.X vs $vars.X: both read the same store; prefer workflow.X when
     the variable is declared.
   - persistState: true for counters/toggles that should survive restarts.

6) SCRIPTS
   - Scripts spawn processes — prefer utility tools for simple ops.
   - Bump timeoutMs when installing packages.
   - Print JSON and parse in the next node for structured output.

7) AI
   - ai_inference for stateless text/json/embedding. Cheapest.
   - agent_node for multi-step tool use. Most expensive.
   - AI guards only when static guards can't express the condition.

8) LOOPS
   - Start with maxIterations: 5 while iterating.
   - loopBreak exits the loop, not the workflow.
   - Heavy loops → consider parallel via function triggers.

9) MODIFY
   - Never pass the full workflow JSON.
   - Always inspect_workflow after adding/removing nodes and wires.

10) PERFORMANCE
    - Parallel branches are free — use them.
    - Don't serialize independent operations.
    - Cache AI results via workflow variables when input is identical.

TIP: When you're stuck, ask yourself: "Do I know the exact shape of the data
at this point?" If not, add a log node and find out.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'performance',
    title: 'Performance Tips — Keep Workflows Fast',
    keywords: [
      'performance', 'fast', 'speed', 'optimize', 'parallel', 'cache', 'batch',
      'avoid', 'latency', 'throughput',
    ],
    content: `1) PARALLELIZE INDEPENDENT WORK
   Two unguarded wires from the same source run concurrently — free speedup.

2) BATCH IN ONE TOOL CALL WHEN POSSIBLE
   web_search with maxResults: 10 is faster than 10 web_search calls.
   ai_inference with a JSON schema returning multiple fields beats N separate calls.

3) CACHE IDEMPOTENT RESULTS
   Store AI results in a workflow variable keyed by input hash:
     {{hash.hash}} → variable lookup first, only call AI on miss.

4) PREFER UTILITY TOOLS OVER SCRIPTS
   math_eval, regex_match, json_parse beat spawning Python by 100x.

5) AI GUARDS SPARINGLY
   Each hop costs a model call. Use JSONLogic for deterministic conditions.

6) REUSE WINDOWS (custom_ui id)
   Same id = updates existing window. Don't spawn a new window every run.

7) STREAM LONG OUTPUTS
   For AI that produces long text, wire a stream and useStream — the UI shows
   partial output while generation continues. Better UX than "loading…".

8) FUNCTION TRIGGERS FOR REPEATED SUB-FLOWS
   Extract duplicate logic once. call_function is a cheap invocation.

9) TRIM inputParams TO ACTUAL REQUIREMENTS
   Every required: true field blocks execution until the user fills it. Only
   ask for values you truly can't default.

10) LAZY LOAD IN custom_ui
    Heavy data? Wire it via callNode on button click, not up-front in data.
    Start the UI fast; fetch on demand.

TIP: Profile by adding get_datetime before and after a suspect node — diff the
ISO timestamps to see wall-clock cost.`,
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
    // ID match (treat like title)
    if (chunk.id.toLowerCase().includes(token)) {
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
 * Lexical fallback: keyword-overlap search over DOC_CHUNKS.
 * Used when Supabase / embedder is unavailable.
 */
export function searchDocsLexical(query: string, topK: number = 3): DocChunk[] {
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  if (queryTokens.length === 0) {
    return DOC_CHUNKS.filter(c => c.id === 'architecture');
  }

  const scored = DOC_CHUNKS
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.chunk);
}

/**
 * Semantic search via Supabase pgvector.
 * Embeds the query, calls the search_workflow_docs RPC, and resolves
 * IDs back to local DOC_CHUNKS so callers always get full content
 * (even if the row in Supabase is stale).
 *
 * Returns null if the backend isn't configured / fails — caller should
 * fall back to searchDocsLexical().
 */
export async function searchDocsSemantic(
  query: string,
  topK: number = 3,
): Promise<DocChunk[] | null> {
  const supabase = getSupabaseService();
  if (!supabase) return null;

  try {
    const { embedder } = await resolveEmbedder();
    const { embeddings } = await embedMany({
      model: embedder as any,
      values: [query],
    });
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) return null;

    const { data, error } = await supabase.rpc('search_workflow_docs', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: topK,
    });
    if (error || !data) return null;

    const byId = new Map(DOC_CHUNKS.map(c => [c.id, c]));
    const hits: DocChunk[] = [];
    for (const row of data as Array<{ id: string }>) {
      const chunk = byId.get(row.id);
      if (chunk) hits.push(chunk);
    }
    return hits;
  } catch (e) {
    console.warn('[search_workflow_docs] semantic search failed', e);
    return null;
  }
}

/**
 * Search documentation chunks by query.
 * Tries semantic search via Supabase first, falls back to lexical scoring.
 */
export async function searchDocs(query: string, topK: number = 3): Promise<DocChunk[]> {
  const semantic = await searchDocsSemantic(query, topK);
  if (semantic && semantic.length > 0) return semantic;
  return searchDocsLexical(query, topK);
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
    'Search workflow documentation by topic. Returns relevant doc sections covering architecture, execution model, connecting nodes, triggers, nodes, wires (basic/branching/convergence/callNode), guards (jsonlogic + ai routing), loops (forEach/repeat/while + patterns), variables (workflow + runtime), templates, workspace, utility tools, scripts (python/node), ai_inference, agent_nodes, streams, function triggers, custom_ui (basics, hooks, data passing, markdown, live updates, stuard API, node routing, multi-page, window config, visual effects, pitfalls), modify_workflow ops & pitfalls, output_schema, debugging, common pitfalls, and performance tips. Use "list" to see all sections, or a section id for a specific one.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Search query describing what you need to know (e.g., "how do guards work", "live update custom ui", "markdown rendering", "connecting nodes", "forEach loop"), or "list" to see all sections, or a section ID to get that specific section.',
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

    // Search mode (semantic via Supabase, lexical fallback)
    const results = await searchDocs(query, topK);
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

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS SYNC
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the text we embed per chunk. Including title + keywords gives the
 * embedding model strong topical anchors so short queries (e.g. "guards",
 * "live update custom ui") still match the right section.
 */
function chunkEmbeddingText(chunk: DocChunk): string {
  const kw = chunk.keywords.length ? `\nKeywords: ${chunk.keywords.join(', ')}` : '';
  return `${chunk.title}${kw}\n\n${chunk.content}`;
}

/**
 * Mirrors ensureToolEmbeddings(): upserts any DOC_CHUNKS whose content
 * has changed (or is missing) into public.workflow_docs with a fresh
 * embedding. Safe to call repeatedly — incremental by content equality.
 */
export async function ensureWorkflowDocsEmbeddings(opts?: { force?: boolean }): Promise<{
  synced: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}> {
  const force = opts?.force === true;
  const result = { synced: 0, skipped: 0, errors: [] as Array<{ id: string; error: string }> };

  const supabase = getSupabaseService();
  if (!supabase) return result;

  let toUpdate: DocChunk[];
  if (force) {
    toUpdate = DOC_CHUNKS.slice();
  } else {
    const { data: existing, error } = await supabase
      .from('workflow_docs')
      .select('id, title, content');
    if (error) {
      // Table might not exist yet — fail gracefully like ensureToolEmbeddings.
      return result;
    }
    const existingMap = new Map(
      (existing as Array<{ id: string; title: string; content: string }>).map(r => [
        r.id,
        { title: r.title, content: r.content },
      ]),
    );
    toUpdate = DOC_CHUNKS.filter(c => {
      const prev = existingMap.get(c.id);
      return !prev || prev.title !== c.title || prev.content !== c.content;
    });
    result.skipped = DOC_CHUNKS.length - toUpdate.length;
  }

  if (toUpdate.length === 0) return result;

  try {
    const { embedder } = await resolveEmbedder();
    const texts = toUpdate.map(chunkEmbeddingText);
    const { embeddings } = await embedMany({ model: embedder as any, values: texts });

    const rows = toUpdate.map((c, i) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      keywords: c.keywords,
      embedding: embeddings[i],
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from('workflow_docs')
      .upsert(rows, { onConflict: 'id' });
    if (upsertError) {
      result.errors.push({ id: '*', error: upsertError.message });
    } else {
      result.synced = rows.length;
    }
  } catch (e: any) {
    result.errors.push({ id: '*', error: e?.message || String(e) });
  }

  return result;
}
