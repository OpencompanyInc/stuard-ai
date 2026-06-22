/**
 * Workflow doc corpus — PURE DATA, ZERO IMPORTS.
 *
 * Single source of truth consumed by:
 *  - system-prompt.ts → getAllDocsInline() embeds the FULL corpus into the
 *    workflow agent's system prompt (static prefix → prompt-cache friendly,
 *    no doc-search round trips).
 *  - docs.ts → search_workflow_docs tool (still used by the orchestrator /
 *    stuard agent paths) + Supabase embeddings sync.
 *
 * This file must stay import-free: system-prompt.ts is pulled in by
 * capability-packs (subagent-runtime dependency chain) and any tool/module
 * import here would risk a cycle.
 *
 * Style contract: every line teaches syntax or a gotcha. No coaching prose,
 * no box-drawing tables, at most one example per concept. If you edit
 * content, re-run sync-workflow-docs-embeddings.ts so semantic search stays
 * aligned for the agents that still search.
 */

export interface DocChunk {
  id: string;
  title: string;
  /** Keywords for matching — lowercase, space-separated */
  keywords: string[];
  content: string;
}

export const DOC_CHUNKS: DocChunk[] = [
  // ── ARCHITECTURE ───────────────────────────────────────────────────────────
  {
    id: 'architecture',
    title: 'Workflow Architecture — The Big Picture',
    keywords: [
      'architecture', 'overview', 'structure', 'graph', 'components', 'execution',
      'flow', 'how workflows work', 'basics', 'mental model', 'philosophy',
    ],
    content: `A workflow is a directed graph run by the local Stuard engine.
WORKFLOW = { id, name, triggers[], nodes[], wires[], variables?[], outputSchema?[] }
Trigger → wire → Node → wire → Node …
• Triggers — starting points (manual, hotkey, cron, webhook, fs.watch, …)
• Nodes — one tool invocation each
• Wires — directed edges: plain, guarded, looped, callNode
• Variables — workflow-scoped config + runtime store
• Workspace — per-workflow folder on disk (data/scripts/assets)
DATA flows automatically: each node stores its result as ctx[stepId]; later nodes read it via {{stepId.field}} templates.
CONTROL flows through wires: guards pick paths, loops repeat, callNode wires fire only on demand from a UI.
One purpose per node. Put logic in real nodes behind callNode wires, not inside custom_ui.`,
  },

  {
    id: 'execution_model',
    title: 'Execution Model — How the Engine Walks the Graph',
    keywords: [
      'execution', 'engine', 'runtime', 'lifecycle', 'context', 'ctx', 'parallel',
      'concurrency', 'order', 'waitForAll', 'fallbackTo', 'error', 'fallback',
    ],
    content: `LIFECYCLE:
1. Trigger fires → initial context { trigger: { data } }.
2. All wires FROM the trigger queue their target nodes.
3. Per node: resolve {{templates}} in args → run tool → ctx[node.id] = result.
4. Walk outgoing wires: evaluate guards, apply loops, follow non-callNode wires. callNode wires are IGNORED here (on-demand only).
5. Multiple unguarded outgoing wires → targets run IN PARALLEL.
6. waitForAll: true on a node → it waits until ALL incoming wires complete.
7. Node error + fallbackTo → engine jumps there; otherwise that branch halts, siblings continue.
CONTEXT:
• ctx[stepId] = { ok, ...toolSpecificFields }
• ctx.trigger.data — trigger payload (form values, webhook body, …)
• ctx.workflow.<var> — workflow variables · ctx.$vars.<name> — runtime variables
• ctx.$workspace = { path, data, scripts, assets, id }
• ctx.loop = { item, index } inside loop iterations · ctx.args — inputs when run as a function
Node not firing? (1) no incoming wire, (2) all incoming guards false, (3) parent errored without fallbackTo. Debug data flow with a log node: { message: "{{step_X}}" }.`,
  },

  {
    id: 'connecting_nodes',
    title: 'Connecting Nodes — Choosing the Right Wire',
    keywords: [
      'connect', 'connecting', 'wire', 'wires', 'choose', 'which wire', 'patterns',
      'compose', 'composition', 'flow control', 'callnode vs guard', 'branching',
    ],
    content: `Intent → connection:
• Always run next → { from, to }
• Run IF condition → { from, to, guard: { if: {...} } }
• Run multiple next → multiple unguarded wires from same source (parallel)
• Merge branches → waitForAll: true on the target node
• Repeat target → { from, to, loop: { type: "forEach", ... } }
• Exit a loop → loopBreak: true on a wire from inside the loop body
• On-demand from UI → { from, to, callNode: true }
• AI picks branch → guard: { ai: { instruction, produceArgs? } }
• Error recovery → fallbackTo on the failing node
RULES OF THUMB: parallel branches when independent (don't serialize needlessly); JSONLogic guards for deterministic decisions; AI guards only for fuzzy ones (token + latency cost); callNode for custom_ui→worker edges; two triggers (hotkey + hotkey.release) for push-to-talk instead of guards; function trigger + call_function when the same sub-flow runs from multiple places.
COMMON BUG: trigger not wired to any node → nothing runs. Verify with read_workflow({ mode: "outline", validate: true }).`,
  },

  // ── TRIGGERS ───────────────────────────────────────────────────────────────
  {
    id: 'triggers',
    title: 'Triggers — Starting Points',
    keywords: [
      'trigger', 'triggers', 'start', 'manual', 'hotkey', 'keystroke', 'cron',
      'schedule', 'webhook', 'webhook call', 'local webhook return value',
      'request response', 'fetch await', 'website localhost', 'fs.watch',
      'filesystem', 'function', 'app_start', 'keyboard', 'shortcut',
    ],
    content: `Every trigger: { id: "trig_0", type, args: {}, label?, position: {x,y}, inputParams?: [] }
TYPES:
• manual {} — user clicks Run
• hotkey { accelerator, hold?, passthrough? }
• hotkey.release { accelerator } — fires only on key release
• keystroke { sequence: "go" } — typing the sequence anywhere triggers
• schedule.cron { cron: "0 9 * * *" }
• webhook.local {} — POST http://127.0.0.1:18080/webhooks/incoming/<flowId>; fire-and-forget, HTTP response { ok, delivered }
• fs.watch { path, pattern?, recursive? } → ctx.trigger.data = { path, event: "add"|"change"|"unlink", timestamp }
• clipboard.change { types?, pollMs? } → payload { type, text, html, files, hasImage, … }
• function { inputParams? } — invoked by call_function
• app_start {} — once when Stuard starts
REQUEST/RESPONSE WEBHOOK (caller awaits returned data):
  { id: "trig_webhook", type: "webhook", args: { mode: "local" } } — the branch MUST end with a return_value node.
  Caller: POST http://127.0.0.1:18080/webhooks/call/<flowId>?triggerId=trig_webhook (JSON body) → response { ok, workflowId, result, returned }.
Webhook JSON bodies are exposed as ctx.input / ctx.args / ctx.webhook → {{input.customerId}}.
Manual with form: { type: "manual", inputParams: [{ name: "url", type: "string", required: true }] } → {{trigger.data.url}}.
A workflow can have MANY triggers; each wires independently to its own starting node.`,
  },

  {
    id: 'trigger_advanced',
    title: 'Advanced Triggers — Hotkeys, Release, Keystroke, fs.watch',
    keywords: [
      'hotkey', 'hotkey.release', 'push to talk', 'ptt', 'release', 'hold',
      'keystroke', 'sequence', 'fs.watch', 'filesystem', 'file watch', 'pattern',
      'passthrough', 'accelerator',
    ],
    content: `hotkey args: { accelerator: "Ctrl+Alt+K", hold?, passthrough? }
• hold: false (default) → fires once on press; hold: true → fires on press AND release (event: "press"|"release")
• passthrough: true → key still reaches the focused app (otherwise swallowed)
hotkey.release args: { accelerator } — fires ONLY on release.
keystroke args: { sequence: "go" } — text-expander style.
fs.watch args: { path: "C:/folder", pattern?: "*.txt", recursive?: true }
PUSH-TO-TALK = two triggers, zero guards (avoids held-key races):
  triggers: [{ id: "trig_press", type: "hotkey", args: { accelerator: "Ctrl+H" } },
             { id: "trig_release", type: "hotkey.release", args: { accelerator: "Ctrl+H" } }]
  nodes: start = capture_media { kind: "audio", mode: "until_stop", sessionId: "ptt" }; stop = stop_capture { sessionId: "ptt" }
  wires: trig_press → start; trig_release → stop`,
  },

  {
    id: 'input_params',
    title: 'Input Parameters — Forms Before Execution',
    keywords: [
      'input', 'inputParams', 'parameters', 'form', 'user input', 'string',
      'number', 'boolean', 'select', 'multiselect', 'file', 'folder', 'date',
      'json', 'array', 'trigger.data',
    ],
    content: `inputParams on a trigger open a form BEFORE the run; values land in ctx.trigger.data.
inputParams vs variables[]: changes each run (query, file, date) → inputParam; stays the same across runs (API key, folder, setting) → variable.
SCHEMA: inputParams: [{ name, type: "string"|"number"|"boolean"|"select"|"multiselect"|"file"|"folder"|"date"|"json"|"array", required?, defaultValue?, description?, options?: [{ label, value }] /* select/multiselect */ }]
EXAMPLE:
  { id: "trig_0", type: "manual", inputParams: [
    { name: "query", type: "string", required: true, description: "What to search for" },
    { name: "mode", type: "select", defaultValue: "fast", options: [{ label: "Fast", value: "fast" }, { label: "Thorough", value: "careful" }] } ]}
ACCESS: {{trigger.data.query}}, {{trigger.data.mode}}
ADD: modify_workflow({ op: "set_path", path: "triggers[0].inputParams", value: [...] })
APPEND ONE (don't overwrite others): path: "triggers[0].inputParams[N]" where N = current length.
When telling the user, describe what the form asks — never the JSON schema.`,
  },

  // ── NODES ──────────────────────────────────────────────────────────────────
  {
    id: 'nodes',
    title: 'Nodes — Execution Steps',
    keywords: [
      'node', 'nodes', 'step', 'tool', 'args', 'output', 'label', 'position',
      'fallbackTo', 'waitForAll', 'convergence',
    ],
    content: `SCHEMA: {
  id: string,            // unique, short snake_case: "fetch_page", "parse_json"
  tool: string,          // tool name (verify with search_workflow_nodes/get_tool_schema)
  label?: string,        // display name; ALSO used by callNode label lookup — always set it
  args: {},              // tool arguments — supports {{templates}}
  position: { x, y },    // canvas only (x: 20-800, y: 20-600, ~140 apart); wires control flow
  fallbackTo?: string,   // jump here on error
  waitForAll?: boolean   // wait for ALL incoming wires before running
}
GOTCHAS: duplicate ids → one silently overwrites the other in ctx · tool: "" → no-op that still occupies a ctx entry · label matching for callNode is case-insensitive and whitespace/underscore/hyphen agnostic.`,
  },

  {
    id: 'nodes_outputs',
    title: 'Node Outputs — What ctx[stepId] Contains',
    keywords: [
      'output', 'outputs', 'ctx', 'result', 'fields', 'ok', 'text', 'json',
      'stdout', 'stderr', 'data', 'action', 'filePath', 'content', 'entries',
      'streamId',
    ],
    content: `Every node output: ctx[stepId] = { ok: boolean, error?: string, ...toolSpecificFields }.
FREQUENT FIELDS:
  text — ai_inference (text mode), agent_node, web_search summary
  json — ai_inference (json mode), agent_node json, agent_extract
  embedding — ai_inference (embedding mode)
  stdout / stderr / exitCode — run_command, run_python_script, run_node_script
  data — custom_ui form data · action — custom_ui button ("submit"|"closed"|"<custom>")
  filePath — take_screenshot, capture_media, pickSavePath · content — read_file · entries — list_directory
  streamId — capture_media / capture_screen mode:"stream" · items — list-returning tools (for forEach)
ACCESS: {{step_1.ok}}, {{step_1.json.title}}, {{step_1.json.items[0].name}}, {{step_1.data.form_field}}
Exact shape unknown → get_tool_schema({ toolName }) lists inputSchema + outputSchema. Wrong-field bugs: add a log node with "{{step_1}}" to dump the full output, then remove it.`,
  },

  // ── WIRES ──────────────────────────────────────────────────────────────────
  {
    id: 'wires',
    title: 'Wires — Basic Connections',
    keywords: ['wire', 'wires', 'edge', 'connection', 'from', 'to', 'sequential', 'basic'],
    content: `WIRE SCHEMA: { from, to, guard?, label?, loop?, loopBreak?, callNode?, stream? }
Sequential: wires: [{ from: "trig_0", to: "step_1" }, { from: "step_1", to: "step_2" }]
RULES:
• from/to MUST reference existing trigger/node ids.
• No guard + no loop → auto-traverses when the source completes.
• Multiple unguarded wires from one source → parallel branches.
• A node with no incoming wire never executes.
• When adding a node, add its wire in the SAME edit (add_node connectFrom auto-wires; otherwise add_wire separately).`,
  },

  {
    id: 'wires_branching',
    title: 'Wires — Conditional Branching & Parallelism',
    keywords: [
      'branch', 'branching', 'conditional', 'parallel', 'concurrent', 'split',
      'fan out', 'guard', 'else', 'multiple wires',
    ],
    content: `CONDITIONAL (one path per guard):
  { from: "step_1", to: "step_ok",   guard: { if: { "==": [{ "var": "step_1.ok" }, true  ] } } }
  { from: "step_1", to: "step_fail", guard: { if: { "==": [{ "var": "step_1.ok" }, false ] } } }
PARALLEL (all unguarded wires fire concurrently):
  { from: "step_1", to: "screenshot" }, { from: "step_1", to: "web_search" }, { from: "step_1", to: "read_file" }
MIXED: unguarded wire always runs; guarded sibling runs only when its guard matches.
CATCH-ALL: guard: { if: true } or guard: "always" (same as no guard).
Guards to DIFFERENT targets are evaluated independently; order matters only when multiple guards target the SAME next step (first match wins).
COMMON BUG: truthy guard + catch-all wire to the same sink → double execution. Use mutually exclusive guards or one wire.`,
  },

  {
    id: 'wires_convergence',
    title: 'Wires — Convergence with waitForAll',
    keywords: [
      'converge', 'convergence', 'waitForAll', 'merge', 'join', 'fan in',
      'synchronize', 'barrier',
    ],
    content: `A node with multiple INCOMING wires runs as soon as the FIRST one completes — i.e. it fires once per incoming wire. Set waitForAll: true on the node to wait for ALL branches and run ONCE.
  nodes: [
    { id: "fetch_a", tool: "fetch_url", args: { url: "{{trigger.data.a}}" } },
    { id: "fetch_b", tool: "fetch_url", args: { url: "{{trigger.data.b}}" } },
    { id: "combine", tool: "log", args: { message: "{{fetch_a.text}} || {{fetch_b.text}}" }, waitForAll: true } ]
  wires: [ trig_0→fetch_a, trig_0→fetch_b, fetch_a→combine, fetch_b→combine ]
WITH GUARDS: waits for every incoming wire whose guard matched; if all guards are false the node never fires.
Need "1 of N" instead of "N of N" → omit waitForAll.`,
  },

  {
    id: 'wires_callnode',
    title: 'Wires — callNode (On-Demand Routing from custom_ui)',
    keywords: [
      'callnode', 'callNode', 'call node', 'on-demand', 'custom_ui', 'dashed',
      'teal', 'routing', 'caller', 'plug', 'stuard.callNode',
    ],
    content: `callNode wires let a custom_ui window invoke SIBLING nodes on demand. NOT auto-traversed — they fire only when the UI calls stuard.callNode(nodeIdOrLabel, data).
SCHEMA: { from: "ui_node_id", to: "worker_node_id", callNode: true }
FLOW: UI button → await stuard.callNode('Read File', { path: '/tmp/x' }) → engine finds worker by id OR label (case-insensitive, space/_/- agnostic) → worker's {{caller.path}} resolves to '/tmp/x' → worker runs → result is the promise value (wire animates dashed teal).
  nodes: [{ id: "ui", tool: "custom_ui", args: {...} },
          { id: "reader", tool: "read_file", label: "Read File", args: { path: "{{caller.path}}" } }]
  wires: [{ from: "trig_0", to: "ui" }, { from: "ui", to: "reader", callNode: true }]
  UI: const r = await stuard.callNode('Read File', { path: '/tmp/example.txt' }); // r.content
USE FOR: keeping heavy work (AI/DB/files/HTTP) out of the UI in visible canvas nodes; reusing one worker from multiple buttons/UIs.
callNode (preferred: visible, animates, {{caller.X}}) vs callTool (legacy invisible escape hatch for tiny helpers only).
GOTCHA: {{caller.X}} resolves to "" → the wire is missing callNode: true (engine auto-traversed it once at start with no caller data).`,
  },

  // ── GUARDS ─────────────────────────────────────────────────────────────────
  {
    id: 'guards',
    title: 'Guards — JSONLogic Conditions',
    keywords: [
      'guard', 'guards', 'condition', 'jsonlogic', 'json logic', 'if', 'expression',
      'var', 'operator', 'compare', 'and', 'or', 'not',
    ],
    content: `Guards decide whether a wire is followed. JSONLogic preferred.
FORMATS: guard: { if: { "==": [{ "var": "step_1.ok" }, true] } } · guard: "step_1.ok == true" (string expr) · guard: { if: true } / "always" (catch-all)
OPERATORS: == != > >= < <= and or not ! in var + - * /
PATTERN: { if: { OPERATOR: [LEFT, RIGHT] } } — operands are literals or { "var": "path" }.
EXAMPLES:
  { if: { "==": [{ "var": "step_1.action" }, "confirm"] } }
  { if: { ">": [{ "var": "workflow.counter" }, 5] } }
  { if: { "and": [{ "==": [{ "var": "step_1.ok" }, true] }, { ">": [{ "var": "step_1.json.score" }, 0.8] }] } }
  NOT: { "not": { "var": "step_1.ok" } } or { "!": { "var": "step_1.ok" } }
  IN: { "in": [{ "var": "step_1.action" }, ["save", "submit"]] }
VAR PATHS: step_1.field · workflow.counter · $vars.isRecording · trigger.data.url
CRITICAL: operator keys are plain strings — { "==": [...] }, NEVER { "\\"==\\"": [...] }.
Guard misbehaving → log "{{step_1}}" and check the real field shape (often step_1.json.ok vs step_1.ok).`,
  },

  {
    id: 'guards_ai',
    title: 'AI Routing — Dynamic Branch Selection',
    keywords: [
      'ai', 'ai routing', 'ai guard', 'dynamic', 'intent', 'classification',
      'route', 'produceArgs', 'instruction', 'smart', 'fuzzy',
    ],
    content: `AI guards ask a model to pick the branch.
SYNTAX: guard: { ai: { instruction: "...", produceArgs?: boolean /* AI may patch target args */, model?: "fast"|"balanced"|"smart" } }
The engine sends the source node's context + ALL candidate targets' instructions to the model; it returns a target id (and an args patch if produceArgs). On failure → node.fallbackTo.
EXAMPLE — intent router from one UI node "ask":
  { from: "ask", to: "shot", guard: { ai: { instruction: "User wants to capture screen → screenshot" } } }
  { from: "ask", to: "web",  guard: { ai: { instruction: "User wants to search online → web" } } }
  { from: "ask", to: "read", guard: { ai: { instruction: "User references a file path → read" } } }
Write each instruction so the model can compare ALL of them and pick — describe the whole choice, not just one branch.
USE for fuzzy intent/content classification. DON'T use for booleans/numeric/exact matches (JSONLogic is deterministic + free) or hot loops (every hop = a model call).`,
  },

  // ── LOOPS ──────────────────────────────────────────────────────────────────
  {
    id: 'loops',
    title: 'Loops — forEach, repeat, while',
    keywords: [
      'loop', 'loops', 'forEach', 'for each', 'repeat', 'while', 'iterate',
      'iteration', 'maxIterations', 'delay', 'delayMs', 'itemVar', 'indexVar',
    ],
    content: `Loops live on WIRES; the target node runs multiple times.
CONFIG: loop: { type: "forEach"|"repeat"|"while", items? /* forEach: template to array */, itemVar? ("item"), indexVar? ("index"), count? /* repeat */, conditionText? /* while: truthy = continue */, maxIterations? (default 100), delayMs? }
forEach: { from: "get_list", to: "process", loop: { type: "forEach", items: "{{get_list.items}}" } } — inside target: {{loop.item}}, {{loop.index}}, {{loop.item.name}}
repeat:  { from: "step_1", to: "step_2", loop: { type: "repeat", count: 5, delayMs: 1000 } }
while:   { from: "gate", to: "work", loop: { type: "while", conditionText: "{{workflow.counter}} < 10", maxIterations: 100 } } — conditionText must be ONE {{expr}}
OUTPUTS: ctx[stepId] = last iteration; ctx[stepId + "_loop_results"] = array of all iteration results.
Set maxIterations: 5 while testing, then raise.`,
  },

  {
    id: 'loops_patterns',
    title: 'Loop Patterns — Break, Chain, Nest',
    keywords: [
      'loop break', 'loopBreak', 'break', 'chain', 'nested', 'nest', 'accumulate',
      'collect', 'aggregate', 'loop results',
    ],
    content: `LOOP BREAK — exit mid-iteration via a guarded loopBreak wire from the loop body:
  { from: "trig_0", to: "step_1", loop: { type: "forEach", items: "{{data.items}}" } }
  { from: "step_1", to: "after_loop", loopBreak: true, guard: { if: { "==": [{ "var": "step_1.ok" }, false] } } }
Post-loop continuation ALWAYS needs a loopBreak: true wire — plain wires out of a loop body re-enter the iteration.
ACCUMULATE: set_variable { name: "results", value: [], type: "list" } before the loop → append_to_list { name: "results", item: "{{fetch.text}}" } each iteration → read {{$vars.results}} after. Or read ctx[stepId + "_loop_results"] post-loop (no variables needed).
NESTED LOOPS: messy — flatten data upstream or split into two workflows via call_function.
PARALLEL ITERATION: forEach is sequential. For fan-out parallelism, use call_function inside the loop body — each call is an independent execution.`,
  },

  // ── DATA FLOW ──────────────────────────────────────────────────────────────
  {
    id: 'templates',
    title: 'Templates — {{path}} Interpolation',
    keywords: [
      'template', 'templates', 'interpolation', '{{', 'dynamic', 'reference',
      'trigger.data', 'webhook', 'loop.item', '$vars', '$workspace', 'caller',
      'args', 'nested',
    ],
    content: `{{path}} injects dynamic values into node args.
SOURCES: {{step_1.ok}} / {{step_1.json.items[0].name}} (step outputs, nested + array indexing) · {{trigger.data.username}} · {{webhook.body}}, {{webhook.headers.authorization}} · {{workflow.outputDir}} (workflow vars) · {{$vars.counter}} (runtime vars) · {{$workspace.path}} / .data / .scripts / .assets · {{loop.item}}, {{loop.index}} · {{args.input}} (function runs) · {{caller.filePath}} (callNode data)
TYPE PRESERVATION: if the WHOLE arg value is one template ("{{step.count}}") the resolved value keeps its type (number/bool/array/object); embedded in a larger string → string.
NESTED: "{{arr[{{i}}].name}}" — inner resolves first. There is NO {$text} literal syntax.
DEBUG: log node with "dump: {{step_1}}" stringifies the whole object.`,
  },

  {
    id: 'variables_workflow',
    title: 'Workflow Variables — Workflow-Level Config',
    keywords: [
      'workflow variable', 'variables', 'config', 'defaultValue', 'persistState',
      'workflow.', 'declared variables', 'types', 'json', 'list',
    ],
    content: `variables[] declared on the workflow — initialized every run.
SCHEMA: variables: [{ name, type: "string"|"number"|"boolean"|"json"|"list", defaultValue, description?, persistState? }]
persistState: true → value survives across runs (persisted on disk); new runs start from the persisted value, not defaultValue. Use for counters/toggles.
ACCESS: args {{workflow.outputDir}} or {{$vars.outputDir}} · guards { "var": "workflow.outputDir" } · custom_ui useVar('outputDir', '')
MUTATE: set_variable { name: "workflow.outputDir", value: "C:/new" } or the useVar setter in custom_ui.
ADD: modify_workflow({ op: "add_variable", varName: "x", varType: "number", varDefault: 0 })
Use workflow variables for CONFIG (keys, paths, modes); use undeclared runtime vars (set_variable) for transient state. Both read via $vars; declared ones show in the UI Variables panel.`,
  },

  {
    id: 'variables_runtime',
    title: 'Runtime Variables — Dynamic State Tools',
    keywords: [
      'set_variable', 'get_variable', 'toggle_variable', 'increment_variable',
      'append_to_list', 'delete_variable', 'runtime', 'dynamic', '$vars',
      'notifyUi', 'reactive',
    ],
    content: `Created on the fly; same store as workflow variables, not declared upfront.
TOOLS: set_variable { name, value, type?, notifyUi? } · get_variable { name, default? } · toggle_variable { name } · increment_variable { name, amount? } · append_to_list { name, item } · delete_variable { name }
ACCESS: args {{$vars.counter}} or {{varName}} shorthand · guards { "var": "$vars.counter" } · UI useVar(name, default)
notifyUi: set_variable({ name: "progress", value: 50, notifyUi: true }) broadcasts to ALL custom_ui windows — any useVar('progress') updates instantly. Without notifyUi the store updates but no UI event fires. Any variable read by useVar should be written with notifyUi: true.
TOGGLE PATTERN (one hotkey starts/stops recording):
  check = get_variable { name: "isRecording", default: false }
  trig → check; check → start (guard { "!": { "var": "check.value" } }); check → stop (guard { "var": "check.value" }); start → toggle_variable { name: "isRecording" }; stop → same toggle.`,
  },

  // ── WORKSPACE ──────────────────────────────────────────────────────────────
  {
    id: 'workspace',
    title: 'Workspace — Per-Workflow File System',
    keywords: [
      'workspace', '$workspace', 'data', 'scripts', 'assets', 'filePath',
      'workspace path', 'workspace_read_file', 'workspace_write_file',
      'workspace_list_files', 'workspace_create_folder', 'workspace_delete_file',
      'workspace_get_info',
    ],
    content: `Every workflow gets a folder: <flowId>/ with main.stuard + data/ + scripts/ + assets/.
TEMPLATE PATHS: {{$workspace.path}} (root), {{$workspace.data}}, {{$workspace.scripts}}, {{$workspace.assets}}, {{$workspace.id}}
WORKSPACE TOOLS (preferred — flowId auto-injected, relative paths, keeps the workflow portable):
  workspace_read_file { path: "data/config.json" } · workspace_write_file { path, content } · workspace_list_files { path } ("" = root) · workspace_create_folder { path } · workspace_delete_file { path } · workspace_get_info {}
SCRIPTS: run_python_script { filePath: "{{$workspace.scripts}}/do.py", packages: ["pandas"] } · run_node_script { filePath: "{{$workspace.scripts}}/do.js" }
OPEN OUTPUT: open_file { path } (default app) · launch_application_or_uri { target } (apps, URLs)
For one-off scripts prefer inline code (pass "code" instead of "filePath") so logic lives in the workflow JSON.
EDITING WORKSPACE FILES AS THE ARCHITECT: the studio context gives you workspacePath + a file listing. Use read_file { path } / list_directory { path } to look, file_edit { path, old_string, new_string } for surgical edits, write_file { path, content } to create — with absolute paths under workspacePath. For .stuard sub-workflow files, do NOT hand-edit the JSON — use read_workflow/modify_workflow with stuardFile.`,
  },

  // ── UTILITY TOOLS ──────────────────────────────────────────────────────────
  {
    id: 'utility_tools',
    title: 'Utility Tools — No Scripts Needed',
    keywords: [
      'utility', 'datetime', 'math', 'uuid', 'random', 'sleep', 'hash', 'base64',
      'json', 'regex', 'get_datetime', 'math_eval', 'parse', 'stringify',
    ],
    content: `Native, instant, no process spawn — ALWAYS prefer over run_python_script for simple ops:
  get_datetime {} → { iso, unix, date, time, weekday, … }
  math_eval { expression: "sqrt(16) + pow(2, 3)" } → { result }
  generate_uuid {} → { uuid } · random_number { min, max } → { value } · random_choice { items: [] } → { choice }
  sleep { seconds } or { ms }
  get_system_info {} → { os, hostname, username, home, cwd } · get_env_var { name } → { value, exists }
  hash_string { text, algorithm: "sha256" } → { hash }
  base64_encode { text } → { encoded } · base64_decode { encoded } → { decoded }
  json_parse { text } → { data } · json_stringify { data, pretty? } → { json }
  regex_match { text, pattern } → { matches } · regex_replace { text, pattern, replacement }
  log { message } — debugging data flow`,
  },

  // ── SCRIPTS ────────────────────────────────────────────────────────────────
  {
    id: 'scripts',
    title: 'Scripts — Python & Node Inline or File',
    keywords: [
      'python', 'node', 'script', 'run_python_script', 'run_node_script',
      'packages', 'pip', 'npm', 'inline', 'code', 'filePath', 'venv', 'envId',
    ],
    content: `For logic that doesn't fit existing tools. Output for both: { ok, stdout, stderr, exitCode, packagesInstalled }.
PYTHON inline: { tool: "run_python_script", args: { code: "import numpy as np\\nprint(np.arange(5))", packages: ["numpy"], timeoutMs: 60000, envId?: "my-env" } }
PYTHON file:   args: { filePath: "{{$workspace.scripts}}/process.py", args: ["{{trigger.data.input}}"], packages: ["pandas"] }
NODE: { tool: "run_node_script", args: { code: "console.log(process.argv.slice(2))", args: ["hello"], timeoutMs: 30000 } }
• packages auto-install on first run — bump timeoutMs (~60s per package).
• Pass values via args: [] → sys.argv / process.argv.slice(2).
• Omit envId for the persistent default venv; set envId to group scripts in an isolated shared venv.
RETURN JSON TO NEXT NODE: python print(json.dumps({...})) → json_parse { text: "{{script.stdout}}" } → {{parse.data.result}}.`,
  },

  // ── AI ─────────────────────────────────────────────────────────────────────
  {
    id: 'ai_inference',
    title: 'ai_inference — Unified Text + Multimodal Inference',
    keywords: [
      'ai_inference', 'ai', 'inference', 'text', 'json', 'embedding', 'model',
      'prompt', 'schema', 'structured output',
      'vision', 'image', 'audio', 'video', 'pdf', 'screen', 'multimodal',
      'transcription', 'transcribe', 'whisper', 'stt', 'speech to text',
      'analyze_image', 'analyze_current_screen', 'analyze_media', 'cloud_ai_vision',
    ],
    content: `Stateless AI calls (no tools, no multi-step) for text AND multimodal input. For tool-using agents see agent_nodes.
TEXT (default): { tool: "ai_inference", args: { prompt: "Summarize in 3 bullets", input: "{{read_file.content}}", model: "openai/gpt-4.1-mini" } } → { ok, text }
MULTIMODAL: add sources: [{ path? | url? | data? | mimeType? | captureScreen? }] + a vision-capable model.
  Current screen: sources: [{ captureScreen: true }] (runs take_screenshot internally)
  Image/audio/video/PDF from disk or upstream: sources: [{ path: "{{take_screenshot.filePath}}" }]
  YouTube / direct URL: sources: [{ url: "https://youtu.be/abc123" }]
TRANSCRIPTION MODE (dedicated STT, audio → text): { mode: "transcription", sources: [{ path: "{{record.filePath}}" }], language?: "en", transcriptionModel: "openai/whisper-1" /* any OpenRouter STT slug or elevenlabs/* */ } → { ok, text }
STREAMING TRANSCRIPTION (live mic): capture_media { kind: "audio", mode: "stream", sessionId } → STREAM wire → ai_inference { mode: "transcription", transcriptionModel, stream: true, windowMs?: 8000, maxDurationMs?, stopSessionId? }.
  Audio is sliced into utterance windows (silence gaps / windowMs cap), each transcribed one-shot — every STT model effectively "streams".
  Wires: { from: "record", to: "stt", stream: { sourceField: "streamId", mode: "reactive" } } in; { from: "stt", to: "consumer", stream: {...} } out.
  Output: stream:true → { ok, streamId }; stream:false → { ok, text } (drains the stream, joined transcript).
  The engine injects the incoming audio streamId as audioStreamId and runs the node ONCE (self-managed sink — raw float32 chunks can't ride per-chunk reactive wires). A plain flow wire + explicit audioStreamId: "{{record.streamId}}" also works.
JSON MODE (with or without media): { mode: "json", schema: { vendor: "string", total: "number", items: "string[]" }, ... } → { ok, json: {...} } — chain into guards/templates without regex.
EMBEDDING (text only): { input, mode: "embedding", model: "openai/text-embedding-3-small" } → { ok, embedding }
MODELS: google/gemini-3.1-pro-preview, google/gemini-2.5-pro (best for media) · openai/gpt-4o, gpt-4.1, gpt-4.1-mini (text+image) · anthropic/claude-sonnet-4-20250514 (text+image)
DEPRECATED: analyze_image / analyze_current_screen / cloud_ai_vision / analyze_media → use ai_inference with sources.
Batch similar calls in a forEach loop; for ad-hoc routing prefer AI GUARDS (cheaper than ai_inference + guard).`,
  },

  {
    id: 'agent_nodes',
    title: 'Agent Nodes — agent_node, agent_decision, agent_extract',
    keywords: [
      'agent_node', 'agent_decision', 'agent_extract', 'agent', 'tools', 'reasoning',
      'multi-step', 'outputMode', 'outputSchema', 'maxSteps', 'decision', 'extract',
    ],
    content: `AI steps that can USE TOOLS and reason multi-step (unlike stateless ai_inference).
agent_node (full agent step): { tool: "agent_node", args: { prompt, context?: "{{gmail.body}}", systemPrompt?, model: "fast"|"balanced"|"smart", outputMode: "text"|"json", outputSchema?: { items: "string[]" }, tools?: [] /* restrict; [] = pure reasoning */, maxSteps?: 10, timeoutMs?: 300000 } } → { ok, text, json?, model, toolCalls, durationMs }
agent_decision (pick one option): { tool: "agent_decision", args: { question, context, options: ["spam", "legitimate", "unsure"], model: "fast" } } → { ok, decision, reason, confidence }
agent_extract (fields from unstructured text): { tool: "agent_extract", args: { text, fields: { name: "person's full name", email: "email address" }, model: "fast" } } → { ok, data: { name, email } }
CHOOSING: text→text/json → ai_inference (cheapest) · pick from N options → agent_decision (+ guards) · parse fields → agent_extract · multi-step + tools → agent_node (most expensive). Start with ai_inference; upgrade only if you need tool calling or multi-turn reasoning.`,
  },

  // ── STREAMS ────────────────────────────────────────────────────────────────
  {
    id: 'streams',
    title: 'Streams — Reactive Data Flow Between Nodes',
    keywords: [
      'stream', 'streaming', 'reactive', 'live', 'real-time', 'realtime',
      'useStream', 'streamId', 'stream wire', 'chunk', 'camera', 'video',
      'audio', 'feed', 'continuous',
    ],
    content: `One node continuously pushes chunks to another. Tool-agnostic: anything returning { streamId } can feed anything that reads it.
PIECES: producer (returns { streamId }: capture_media / capture_screen mode:"stream", AI streaming) → stream wire { from, to, stream: { sourceField: "streamId", mode: "reactive" } } → consumer (typically custom_ui with useStream).
useStream(streamId) → { chunk /* latest, any type */, text /* chunk as string|null */, fullText /* accumulated strings */, index /* -1 = not started */, done }
LIVE WEBCAM EXAMPLE:
  nodes: [{ id: "cam", tool: "capture_media", args: { kind: "video", mode: "stream" } },
          { id: "display", tool: "custom_ui", args: { blocking: true, data: { sid: "{{cam.streamId}}" },
            component: "function App() {\\n  const [sid] = useVar('sid', '');\\n  const { chunk } = useStream(sid);\\n  return chunk ? <img src={chunk} /> : <div>Waiting…</div>;\\n}" } }]
  wires: [{ from: "trig_0", to: "cam" }, { from: "cam", to: "display", stream: { sourceField: "streamId", mode: "reactive" } }]
Always pass the streamId via the UI's data prop + useVar so a fresh run re-seeds the id.`,
  },

  // ── FUNCTION TRIGGERS ──────────────────────────────────────────────────────
  {
    id: 'function_triggers',
    title: 'Function Triggers + call_function — Reusable Sub-Flows',
    keywords: [
      'function', 'function trigger', 'call_function', 'sub-flow', 'reusable',
      'triggerId', 'inputs', 'args', 'notifyUi', 'return_value', 'outputSchema',
    ],
    content: `Turn a sub-flow into a callable function — de-duplicates logic (anywhere you'd copy-paste nodes, extract behind a function trigger).
1. DEFINE: { id: "fn_trig", type: "function", args: { inputParams: [{ name: "x", type: "number", required: true }, { name: "y", type: "number", required: true }] } }
2. BODY reads {{args.x}} / {{args.y}}: { id: "calc", tool: "math_eval", args: { expression: "{{args.x}} + {{args.y}}" } }; wire fn_trig → calc.
3. RETURN: { id: "ret", tool: "return_value", args: { value: "{{calc.result}}" } }; wire calc → ret.
4. CALL: { id: "call", tool: "call_function", args: { triggerId: "fn_trig", inputs: { x: "{{caller.x}}", y: 1 } } } — caller reads ctx.call.value.
5. FROM custom_ui: wire { from: "ui", to: "call", callNode: true }; UI: const r = await stuard.callNode('call', { x: 5 }); // r.value
CRITICAL: the UI → call_function wire MUST be callNode: true, else {{caller.X}} is empty.
return_value TERMINATES the branch immediately — never wire nodes after it.`,
  },

  // ── CUSTOM UI ──────────────────────────────────────────────────────────────
  {
    id: 'custom_ui_basics',
    title: 'Custom UI — React JSX Components (Offline)',
    keywords: [
      'custom_ui', 'ui', 'component', 'jsx', 'react', 'function App', 'blocking',
      'offline', 'tailwind', 'sucrase',
    ],
    content: `custom_ui renders a React app in a window. Fully offline — React UMD + Tailwind prebuilt; JSX transpiled at runtime.
MINIMAL: { tool: "custom_ui", args: { id: "my_win", title: "Hello", component: "function App() { return <div className='p-6'>Hello!</div>; }", window: { width: 400, height: 300 } } }
RULES:
• component MUST define function App() returning JSX.
• ALWAYS set id — same id = window reused/updated across calls and runs (no flicker, keeps state); without it a new window spawns each run.
• blocking: true (default) → workflow WAITS for submit/close. blocking: false → workflow continues (dashboards).
• Standard Tailwind classes only — arbitrary values (bg-[#abc]) may miss offline; use inline style instead.
• Real npm libraries (recharts, lucide-react, …) → see custom_ui_packages.
CRITICAL:
1. EVERY button needs onClick (stuard.submit() / stuard.close() / stuard.action()) — a dead button blocks the workflow forever.
2. JSX style objects: style={{color: 'red'}}, NOT style="color: red".
3. useVar AUTO-SEEDS from the data arg — useVar name must match the data key.
DATA: args.data values resolve {{templates}} BEFORE the UI opens: data: { count: "{{step1.json.total}}" } → const [count] = useVar('count', 0).`,
  },

  {
    id: 'custom_ui_packages',
    title: 'Custom UI — Installable Packages (npm libraries, local install-once)',
    keywords: [
      'package', 'packages', 'npm', 'library', 'install', 'recharts', 'chart',
      'lucide', 'icons', 'import', 'ui_packages_install', 'uiPackages', 'uiPackageSet',
      'three', 'clsx', 'tailwind-merge', 'class-variance-authority',
    ],
    content: `Real npm UI libraries, installed once + cached + bundled offline. React, ReactDOM, Framer Motion are ALWAYS globals — never install those.
1) INLINE: { tool: "custom_ui", args: { uiPackages: ["recharts"], component: "import { LineChart, Line, XAxis } from 'recharts';\\nfunction App(){...}" } } — curated packages build on first render, cached after.
2) NAMED SET (reuse across workflows): { tool: "ui_packages_install", args: { set: "charts", packages: ["recharts", "lucide-react"] } } then custom_ui args: { uiPackageSet: "charts", ... }.
IMPORTS: normal ESM (named/default/namespace) rewritten to the local bundle; 'react'/'react-dom'/'framer-motion' map to globals; importing an uninstalled package shows a clear in-window error.
CURATED (offline): lucide-react, recharts, clsx, tailwind-merge, class-variance-authority, three.
OTHER packages need npm: ui_packages_install { set, packages, allowNpm: true }.
MANAGEMENT: ui_packages_install { set, packages, mode?: 'add'|'set', allowNpm?, force? } · ui_packages_status { set } · ui_packages_list {} · ui_packages_remove { set }.
Prefer Tailwind for styling; packages for real widgets. Big libs (three) = one-time build delay, then cached.`,
  },

  {
    id: 'custom_ui_hooks',
    title: 'Custom UI — Hooks Reference',
    keywords: [
      'hook', 'hooks', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
      'useReducer', 'useContext', 'useLayoutEffect', 'useVar', 'useStream',
      'useStyles', 'useInterval', 'useTimeout', 'useLocalStorage',
    ],
    content: `Global in every component — React core: useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, useLayoutEffect.
STUARD HOOKS:
  useVar(name, default) → [value, setValue] — bridges React state ↔ workflow variable; auto-seeds from data args (name must match key); setValue writes the store + notifies all UIs.
  useStream(streamId) → { chunk, text, fullText, index, done }
  useStyles(css) — inject CSS, auto-clean on unmount · useInterval(fn, ms) / useTimeout(fn, ms) — auto-clearing · useLocalStorage(key, init)
useVar UPDATE PATHS: inside the UI → setCount(c => c + 1); from a workflow node → set_variable { name, value, notifyUi: true } or update_custom_ui { id, data: {...} } — both fire useVar listeners.`,
  },

  {
    id: 'custom_ui_data',
    title: 'Custom UI — Data Passing & useVar Seeding',
    keywords: [
      'data', 'passing', 'useVar', 'seed', 'previous step', 'ai_inference',
      'json', 'template', 'custom_ui data', 'initialData',
    ],
    content: `args.data bridges previous nodes → the React component.
1. Upstream output: ctx.prev = { ok, json: { word: "hello" } }
2. data: { word: "{{prev.json.word}}" } — templates resolve BEFORE the UI loads.
3. Component: const [word] = useVar('word', ''); // "hello"
RULES: data KEY must match useVar's first arg EXACTLY (case-sensitive) · mixed literal + template values fine · undefined → useVar default · runtime updates go via useVar setter / set_variable notifyUi / update_custom_ui, not data.
window.initialData.word — raw snapshot at render (useVar preferred, it's reactive).
forEach iterations into the SAME custom_ui id update the existing window via setVariable — that's how progress bars work without closing.`,
  },

  {
    id: 'custom_ui_multiscreen',
    title: 'Custom UI — Multi-Screen / Pages (visual-editor friendly)',
    keywords: [
      'multi-page', 'multi-screen', 'pages', 'page', 'screen', 'wizard', 'steps',
      'navigation', 'navigate', 'setPage', 'onPageChange', 'flow', 'router',
    ],
    content: `Multiple screens in ONE component = a page state + conditional returns (normal React; no router needed).
This is just a RECOMMENDED shape, NOT a restriction — animations, framer-motion, custom packages, .map(), any JSX all still work everywhere.
PATTERN (lets the visual UI builder show each screen as an editable tab + round-trip it):
  function App() {
    const [page, setPage] = useState('intro');
    if (page === 'intro') return ( <div className="p-6"><h2>Welcome</h2><button onClick={() => setPage('form')}>Next</button></div> );
    if (page === 'form')  return ( <div className="p-6"><input /><button onClick={() => setPage('intro')}>Back</button></div> );
    return ( <div className="p-6">Done</div> ); // last = default screen
  }
• Use the literal names \`page\` / \`setPage\` and \`if (page === 'name') return (…)\` so the builder can parse each screen. Other shapes ({page === 'x' && …}, switch, separate components) still RUN fine — the builder just shows them as one screen.
• Navigate inside the UI: setPage('name'). From a workflow node: update_custom_ui { id, navigateTo: 'name' } (the builder wires stuard.onPageChange→setPage automatically; if hand-writing, add useEffect(() => stuard.onPageChange(i => setPage(i.page)), [])).`,
  },

  {
    id: 'custom_ui_markdown',
    title: 'Custom UI — Markdown Rendering (<Markdown> / <ReactMarkdown>)',
    keywords: [
      'markdown', 'md', 'Markdown', 'ReactMarkdown', 'remarkGfm', 'remarkMath',
      'rehypeKatex', 'render markdown', 'gfm', 'github flavored', 'math', 'katex',
      'code block', 'table',
    ],
    content: `react-markdown is BUNDLED OFFLINE. Globals: Markdown (alias of ReactMarkdown), ReactMarkdown, remarkGfm (tables/strikethrough/task lists), remarkMath, rehypeKatex.
BASIC: <Markdown>{text}</Markdown>
GFM: <Markdown remarkPlugins={[remarkGfm]}>{mdText}</Markdown>
MATH: <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{"$e^{i\\\\pi}+1=0$"}</Markdown>
AI OUTPUT: seed useVar from {{ai_step.text}} via data, wrap in <div className="prose max-w-none"> (prose-invert for dark). Custom renderers: <Markdown components={{ h1: ({children}) => <h1 className="text-3xl">{children}</h1> }}>.
LIVE-STREAMING AI TEXT: seed from the stream, not {{step.text}}: const { fullText } = useStream(sid); <Markdown>{fullText}</Markdown>.`,
  },

  {
    id: 'custom_ui_live_updates',
    title: 'Custom UI — Live Updates (useVar + update_custom_ui + set_variable)',
    keywords: [
      'live update', 'reactive', 'update_custom_ui', 'set_variable', 'notifyUi',
      'push', 'real-time', 'ui variable', 'useVar update', 'dashboard', 'progress',
    ],
    content: `Three ways to push updates into an OPEN window:
1. set_variable { name: "progress", value: 75, notifyUi: true } — every useVar('progress') in ANY window updates.
2. update_custom_ui { id: "my_win", data: { progress: 75, status: "Processing…" } } — each data key propagates as a workflow variable → useVar sees it.
3. Inside the UI: const [count, setCount] = useVar('counter', 0); setCount(c => c + 1) — updates store + broadcasts.
PROGRESS PATTERN: open custom_ui with blocking: false + data: { progress: 0, status: "" }; component renders useVar('progress') as a bar; later nodes call update_custom_ui with rising values; close_custom_ui at the end to auto-dismiss. Keep blocking: true only for required confirmations.
STREAMING AI TEXT → markdown: stream producer → stream wire → custom_ui; useStream(sid).fullText into <Markdown> — no update_custom_ui needed.
BUG: update_custom_ui not reflected → window id doesn't match the custom_ui id EXACTLY (case-sensitive).`,
  },

  {
    id: 'custom_ui_stuard_api',
    title: 'Custom UI — stuard API Reference',
    keywords: [
      'stuard', 'stuard api', 'callTool', 'callNode', 'pickFile', 'pickFolder',
      'pickSavePath', 'readFile', 'writeFile', 'clipboard', 'notify', 'submit',
      'close', 'action', 'navigate', 'resize', 'center', 'stopWorkflow',
    ],
    content: `Global stuard object in every window; methods return Promises unless marked void.
ROUTING: await stuard.callNode(idOrLabel, data) — preferred, fires a callNode wire · await stuard.callTool(name, args) — legacy invisible escape hatch.
FILES: await stuard.pickFile({ title, filters, multiple }) · pickFolder({ title, multiple }) · pickSavePath({ title, defaultPath, filters }) · readFile(path, encoding?) · writeFile(path, content) (restricted to approved paths)
CLIPBOARD/NOTIFY: await stuard.copyToClipboard(text) · readClipboard() · stuard.notify('Title', 'Body') (void)
LIFECYCLE (void): stuard.submit(data) — resolves the blocking promise + closes · stuard.close(data) · stuard.action(name, data) — named action, doesn't close · stuard.stopWorkflow()
WINDOW (void): resize(w, h) · moveTo(x, y) · center() · setAlwaysOnTop(bool) · minimize(). Window x/y and moveTo use the SAME coordinate space as get_mouse_position / move_cursor / click_at_coordinates (high-DPI conversion handled internally).
VARS: await stuard.getVar(name) → { ok, name, value, type } · setVar(name, value) (broadcasts) · subscribeVars(['*'])
EVENTS: stuard.on(event, cb) → unsubscribe fn · emit(event, data) · onDataUpdate(cb) (update_custom_ui) · onVarUpdate(cb) · onPageChange(cb)
PAGES: stuard.navigate(pageName, data) · await stuard.getCurrentPage()
SYSTEM: await stuard.getScreenInfo() → { width, height, scaleFactor, workArea: { x, y, width, height } } in PHYSICAL pixels (same space as moveTo/get_mouse_position, so the values compose directly). Window width/height args are logical px — multiply by scaleFactor before mixing them into screen-edge math. · getWindowId() · getFlowId()
SHORTHAND ($stuard): $stuard.tool(n, a) · .node(id, d) · .submit(d) · .close(d) · .setVar/.getVar · .nav(page, d)`,
  },

  {
    id: 'custom_ui_node_routing',
    title: 'Custom UI — Node Routing Deep Dive (callNode + {{caller}})',
    keywords: [
      'callNode', 'node routing', 'architecture', 'caller', '{{caller', 'dashed',
      'teal', 'standalone', 'decompose', 'visible', 'from ui',
    ],
    content: `custom_ui as orchestrator of visible sibling nodes — wire workers with callNode: true and invoke on demand (see wires_callnode for basics).
LABEL MATCHING priority: exact id → exact label → normalized label (case-insensitive, whitespace/_/- agnostic).
ONE UI → MANY WORKERS: multiple { from: "ui", to: X, callNode: true } wires; the UI calls any by id/label.
MANY UIs → ONE WORKER: each UI wires callNode: true to the same node.
MULTI-FIELD: worker args { path: "{{caller.path}}", content: "{{caller.content}}" }; UI: await stuard.callNode('save', { path, content }).
Worker args may also use {{caller.nested.path}}, {{$workspace.*}}, {{$vars.*}}, {{workflow.*}}.
GOTCHAS: missing callNode: true → auto-traversal → {{caller.X}} = "" · the worker's ctx entry is overwritten each call (later readers see the LATEST result) · call_function runs a whole sub-flow — wire it callNode: true and pass inputs as data.
Design: one responsibility per worker node; each UI button → one callNode edge.`,
  },

  {
    id: 'custom_ui_multi_page',
    title: 'Custom UI — Multi-Page Apps (useState pattern & pages mode)',
    keywords: [
      'pages', 'multi-page', 'spa', 'navigate', 'navigateTo', 'goBack', 'startPage',
      'formData', 'data-navigate', 'navigation', 'keepOpen',
    ],
    content: `A) useState (recommended — full React idioms, conditional rendering, validation):
  function App() { const [page, setPage] = useState('home'); if (page === 'settings') return <Settings onBack={() => setPage('home')}/>; return <Home onNext={() => setPage('settings')} onSubmit={() => stuard.submit(form)}/>; }
B) pages mode (declarative HTML wizards, formData auto-persists):
  { tool: "custom_ui", args: { pages: { "home": { html: "<h1>Welcome</h1><button data-navigate='step1'>Next</button>" }, "step1": { html: "<input data-bind='name'/><button data-navigate='done'>Next</button>" }, "done": { html: "<h2>Thanks {name}!</h2><button data-action='submit'>Finish</button>" } }, startPage: "home", blocking: true, keepOpen: true, data: { name: "" } } }
  JS nav: navigateTo('results', { query: 'foo' }) · goBack(). HTML: data-navigate="page", data-bind="field" (two-way formData), data-action="submit".
  formData is shared across pages; the step resolves only on data-action submit/close or stuard.submit/close.`,
  },

  {
    id: 'custom_ui_window',
    title: 'Custom UI — Window Configuration',
    keywords: [
      'window', 'width', 'height', 'position', 'frameless', 'transparent',
      'translucent', 'borderRadius', 'alwaysOnTop', 'draggable', 'invisible',
      'shadow', 'animation', 'background', 'gradient', 'size',
    ],
    content: `window: {
  width, height, position: "center"|"topleft"|"topright"|"bottomleft"|"bottomright"|"bottomcenter"|"cursor"|"custom", x?, y? /* position:"custom" */,
  alwaysOnTop?, frameless? /* required for rounded/translucent/transparent */, transparent?, borderRadius? /* needs frameless */,
  resizable?, movable?, draggable? /* frameless drags by default */, minimizable?, maximizable?, skipTaskbar?,
  backgroundType?: "color"|"gradient"|"image"|"translucent"|"transparent", backgroundColor?,
  gradient?: { type: "linear"|"radial"|"conic", angle, stops: [{ color, position }] },
  backgroundImage?: { url: "local-file:///C:/path/bg.png", fit: "cover" },
  translucent?: { color, opacity, blur }, contentPadding?,
  shadow?: { enabled, color, blur, spread, x, y }, border?: { enabled, color, width, style },
  animation?: { open: "fade"|"slide-up"|"slide-down"|"scale"|"none", duration, easing },
  invisible? /* hidden from screenshots & screen recording — visible to the user */ }
PRESETS: rounded panel { frameless: true, borderRadius: 16, backgroundColor: "#1a1a2e" } · frosted glass { frameless: true, backgroundType: "translucent", translucent: { color: "#1a1a2e", opacity: 0.7, blur: 12 } } · transparent canvas { frameless: true, backgroundType: "transparent" } · fullscreen overlay { frameless: true, position: "topleft", x: 0, y: 0, width: 1920, height: 1080, transparent: true, alwaysOnTop: true }
Frameless drag: className="drag" on the title bar; buttons inside need className="no-drag".`,
  },

  {
    id: 'custom_ui_visual',
    title: 'Custom UI — Framer Motion, Components, Fonts, CSS',
    keywords: [
      'framer', 'motion', 'animation', 'AnimatePresence', 'useAnimation',
      'Badge', 'Spinner', 'Progress', 'Tooltip', 'Switch', 'Toast', 'Avatar',
      'Divider', 'Kbd', 'font', 'gradient', 'glass', 'neon', 'tailwind', 'css',
      'animate', 'animate-fade', 'shadow-neon',
    ],
    content: `FRAMER MOTION (global, zero imports): motion.div/span/button, AnimatePresence, useAnimation, useMotionValue, useTransform, useSpring, useInView, useScroll.
  <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0}} /> · <motion.button whileHover={{scale:1.05}} whileTap={{scale:0.95}}>
BUILT-IN COMPONENT GLOBALS: <Spinner size color/> · <Badge variant="success|primary|warning|error|info|default"/> · <Progress value max color height/> · <Skeleton width height/> · <Tooltip content/> · <Switch checked onChange/> · <Toast message type duration/> · <Avatar src name size/> · <Divider label/> · <Kbd/> · <Markdown/>
FONTS (offline): font-inter (body), font-outfit (headings), font-grotesk (tech), font-mono (code)
ANIMATION CLASSES: animate-fade-in, animate-fade-in-up, animate-slide-up, animate-scale-in, animate-bounce-in, animate-float, animate-glow, animate-shimmer, animate-gradient-shift, animate-shake, animate-wobble, animate-tada, animate-pulse, animate-heartbeat
GRADIENT PRESETS: gradient-purple-pink, gradient-blue-cyan, gradient-ocean, gradient-aurora, gradient-sunset, gradient-cosmic, gradient-candy, gradient-midnight + gradient-text + animate-gradient-shift
GLASS: glass, glass-sm, glass-heavy, glass-colored, noise · NEON: shadow-neon-blue/-purple/-cyan/-green · TEXT: text-glow, text-glow-sm, text-shadow, text-outline · 3D: perspective, preserve-3d, backface-hidden, rotate-x-12, rotate-y-12 · STAGGER: <div className="stagger-children"> + delay-100…delay-2000
Quick polish: className="p-6 space-y-4 animate-fade-in-up" + whileHover/whileTap on buttons.`,
  },

  {
    id: 'custom_ui_pitfalls',
    title: 'Custom UI — Common Pitfalls & Fixes',
    keywords: [
      'pitfall', 'pitfalls', 'mistake', 'bug', 'common', 'problems', 'issues',
      'button without onClick', 'style string', 'useVar stale', 'escape', 'quote',
      'debug', 'troubleshoot',
    ],
    content: `1. Button does nothing → missing onClick; blocking UI hangs forever. <button onClick={() => stuard.submit(data)}>.
2. style strings don't work → JSX needs objects: style={{color: 'red', padding: '8px'}}.
3. useVar returns default → name must match the data key EXACTLY (casing).
4. Arbitrary Tailwind (bg-[#050510]) missing offline → standard classes or inline style.
5. UI opens fresh each run, loses state → set a stable id.
6. update_custom_ui not reflected in useVar → old desktop build; update.
7. Escape hell in component strings → newlines \\n, quotes \\"; never double-escape (\\\\n becomes a literal backslash-n in code).
8. stuard undefined / "preload not found" → desktop app not built; dev fallback has only a basic API subset.
9. "Component error" overlay → usually an unknown identifier; remove imports — libraries are globals (except declared uiPackages).
10. UI blocks forever → blocking: true with no submit/close; add an Escape handler: useEffect(() => { const h = e => e.key === 'Escape' && stuard.close(); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []).
DevTools: Ctrl+Shift+I on a focused custom_ui window.`,
  },

  // ── MODIFY ─────────────────────────────────────────────────────────────────
  {
    id: 'modify_operations',
    title: 'modify_workflow — All Operations Reference',
    keywords: [
      'modify', 'modify_workflow', 'add_node', 'update_node', 'remove_node',
      'add_wire', 'remove_wire', 'set_path', 'add_variable', 'rename', 'op',
      'stuardFile',
    ],
    content: `NEVER pass the full workflow JSON — it auto-loads from session. Pass { op, ...params } or a batch { ops: [...] }.
add_node: { op: "add_node", tool: "log", args: { message: "hi" }, connectFrom: "trig_0", label: "Log hi" } — optional id: "my_step" to wire to it later in the same batch.
add trigger: { op: "add_node", triggerType: "hotkey", triggerArgs: { accelerator: "Ctrl+K" } }
update_node (MUST include a change): { op: "update_node", nodeId: "step_abc", args: {...} } · single field: { ..., path: "message", value: "new" } · trigger: { nodeId: "trig_0", triggerArgs: { sequence: "cats" } } · label: { ..., label: "New Name" }
edit_node_text — find/replace inside a string arg; ALWAYS prefer over update_node for small changes to LARGE text (custom_ui component, inline scripts, long prompts):
  { op: "edit_node_text", nodeId: "ui", old_string: "<h1>Old</h1>", new_string: "<h1>New</h1>" }
  { op: "edit_node_text", nodeId: "ui", path: "args.component", old_string: "...", new_string: "...", replace_all?: true }
  old_string must match EXACTLY and be unique in the field (else pass replace_all or a longer string); path optional when old_string appears in only one string field of the node. Read the current text first via read_workflow({ mode: "window", focusIds: [nodeId] }).
remove_node: { op: "remove_node", nodeId: "step_abc" } (also removes its wires)
add_wire: { op: "add_wire", from, to, guard? }
callNode / loop wires — use set_path on the wires array:
  { op: "set_path", path: "wires", value: [...existingWires, { from: "ui", to: "worker", callNode: true }, { from: "get_list", to: "process", loop: { type: "forEach", items: "{{get_list.items}}" } }] }
remove_wire: { op: "remove_wire", from, to }
set_path (any JSON path): { op: "set_path", path: "triggers[0].inputParams", value: [...] } · "outputSchema" · "wires[2].loop"
add_variable: { op: "add_variable", varName: "counter", varType: "number", varDefault: 0 }
rename: { op: "rename", name: "My Flow v2" }
Sub-workflows (studio only): stuardFile: "helpers/sub.stuard" on modify_workflow OR read_workflow loads that workspace file, applies ops/reads, and modify saves it back — the main canvas workflow is untouched.`,
  },

  {
    id: 'modify_pitfalls',
    title: 'modify_workflow — Pitfalls',
    keywords: [
      'pitfall', 'mistake', 'bug', 'modify_workflow', 'common', 'problems',
      'broken wire', 'orphan', 'invalid args', 'session',
    ],
    content: `1. Passing full workflow JSON as "workflow" → corrupts the store; it auto-loads from session.
2. add_node without a wire → orphan that never runs (use connectFrom or add_wire).
3. update_node without args/path+value/label/tool → fails; say WHAT to change.
4. remove_node leaves dangling wires in some paths → read_workflow({ validate:true }) flags them.
5. set_path paths use brackets: "triggers[0].args", NOT "triggers.0.args".
6. Editing the wrong file → pass stuardFile for sub-workflows.
7. UI wires missing callNode: true → {{caller.X}} empty.
8. Duplicate node ids → silent ctx overwrite.
9. Guard operator keys must be plain ("=="), never quote-escaped.
10. Positions outside x: 20-800 / y: 20-600 render off-canvas.
After structural changes, verify with read_workflow({ mode: "outline", validate: true }).`,
  },

  // ── OUTPUT SCHEMA ──────────────────────────────────────────────────────────
  {
    id: 'output_schema',
    title: 'Output Schema & return_value — Typed Return from Sub-Flows',
    keywords: [
      'output', 'outputSchema', 'return', 'return_value', 'function', 'webhook',
      'call_function', 'result', 'terminate', 'end workflow',
    ],
    content: `return_value IMMEDIATELY terminates its branch and returns the payload to the caller. Nothing after it runs — never wire nodes after it.
NODE: { id: "ret", tool: "return_value", args: { value: "{{step.text}}" } } — value can be a scalar or object ({ ok: true, data: "{{process.json}}" }).
Caller reads ctx.<callNodeId>.value (call_function) or the webhook /call response.
USE when the workflow is invoked via call_function / request-response webhook, or to terminate a branch with a distinct payload (separate return_value per success/failure branch).
DON'T use in a plain top-to-bottom main workflow — just let it finish.
outputSchema (optional caller-facing typing): outputSchema: [{ name: "success", type: "boolean", description }, { name: "data", type: "json", description }] — add via { op: "set_path", path: "outputSchema", value: [...] }.`,
  },

  // ── DEBUGGING ──────────────────────────────────────────────────────────────
  {
    id: 'debugging',
    title: 'Debugging & Inspection',
    keywords: [
      'debug', 'debugging', 'inspect', 'inspect_workflow', 'log', 'troubleshoot',
      'trace', 'problem', 'not firing', 'orphan', 'stuck',
    ],
    content: `inspect_workflow modes: "overview" (summary + validation), "node_flow" (node + surrounding topology), "trigger_flow" (from a trigger outward), "wire" (single wire).
log node dumps any value: { tool: "log", args: { message: "step_1 = {{step_1}}" } } — remove after confirming.
get_tool_schema({ toolName }) → exact inputSchema + outputSchema.
SYMPTOM → FIX:
• Nothing on trigger → missing wire (trigger_flow).
• Downstream sees empty data → wrong template path; log it.
• Guard never matches → field type/shape mismatch; dump ctx[step].
• UI freezes the workflow → blocking: true with no submit/close onClick.
• Tool call errors → verify args with get_tool_schema.
• Variable doesn't reach UI → set_variable notifyUi: true or update_custom_ui.
• callNode passes empty caller → missing callNode: true.
LOG PANEL per run: [engine] step running/completed/error · [custom_ui:ID] · [tool:name].
Stuck? Reduce to trigger → 1 node → log, then add pieces back.`,
  },

  {
    id: 'common_pitfalls',
    title: 'Common Pitfalls — Global Mistakes to Avoid',
    keywords: [
      'pitfall', 'mistakes', 'common bugs', 'gotchas', 'best practices',
      'donts', "don't", 'antipattern',
    ],
    content: `• TEMPLATES: verify ctx shape with a log node; whole-arg single templates preserve type; nested arrays "{{items[0].name}}".
• WIRES: unwired nodes are dead weight; multiple unguarded wires = parallel (intended?); callNode wires need callNode: true.
• GUARDS: plain operator keys; test with literals before {{var}}; omit guard for "always".
• CUSTOM UI: every button onClick; useVar name = data key; stable id; desktop build needed for full stuard API.
• VARIABLES: notifyUi to refresh open UIs; workflow.X vs $vars.X read the same store (prefer workflow.X when declared); persistState for values that survive restarts.
• SCRIPTS: prefer utility tools for simple ops; bump timeoutMs for package installs; print JSON → json_parse downstream.
• AI: ai_inference (stateless, cheapest) → agent_decision/agent_extract → agent_node (tools, most expensive); AI guards only when JSONLogic can't express it.
• LOOPS: maxIterations: 5 while testing; loopBreak exits the loop, not the workflow.
• MODIFY: never pass full workflow JSON; inspect after structural edits.
• PERF: parallel branches are free; don't serialize independent work; cache idempotent AI results in variables.`,
  },

  // ── PERFORMANCE ────────────────────────────────────────────────────────────
  {
    id: 'performance',
    title: 'Performance Tips — Keep Workflows Fast',
    keywords: [
      'performance', 'fast', 'speed', 'optimize', 'parallel', 'cache', 'batch',
      'avoid', 'latency', 'throughput',
    ],
    content: `1. Parallelize independent work — unguarded sibling wires run concurrently.
2. Batch inside one tool call — web_search maxResults: 10 beats 10 calls; one ai_inference JSON schema with many fields beats N calls.
3. Cache idempotent AI results in a workflow variable keyed by input hash; only call on miss.
4. Utility tools (math_eval, regex_match, json_parse) beat spawning Python ~100x.
5. AI guards sparingly — each hop is a model call; JSONLogic is free.
6. Reuse custom_ui windows via stable id.
7. Stream long AI outputs (stream wire + useStream) instead of "loading…".
8. Function triggers de-duplicate repeated sub-flows; call_function is cheap.
9. Only required: true inputParams the user truly can't default — each one blocks execution.
10. Lazy-load heavy data in custom_ui via callNode on click, not up-front in data.
Profile with get_datetime before/after a suspect node.`,
  },
];

/** List all available doc section IDs and titles. */
export function listDocSections(): Array<{ id: string; title: string }> {
  return DOC_CHUNKS.map(c => ({ id: c.id, title: c.title }));
}

/** Get a specific doc section by ID. */
export function getDocSection(id: string): DocChunk | null {
  return DOC_CHUNKS.find(c => c.id === id) || null;
}

/**
 * The full corpus as one inline reference block for the system prompt.
 * Section headers keep the chunk ids so the model (and humans reading
 * transcripts) can name sections precisely.
 */
export function getAllDocsInline(): string {
  return DOC_CHUNKS
    .map(c => `### ${c.id} — ${c.title}\n${c.content}`)
    .join('\n\n');
}

/**
 * Sections moved OUT of the always-on system prompt and fetched on demand via
 * search_workflow_docs. They are SITUATIONAL — only needed when building that
 * specific feature (custom UI, streams, agent nodes, advanced triggers/loops/
 * guards) — so inlining them taxed every turn of every session for little
 * benefit. Everyday authoring docs (triggers, nodes, wires, guards, loops,
 * variables, templates, modify ops, scripts, utility) stay inlined so common
 * edits never need a doc round-trip. See project_workflow_token_blowup_levers.
 */
export const REFERENCE_DOC_IDS: ReadonlySet<string> = new Set<string>([
  'trigger_advanced', 'wires_callnode', 'guards_ai', 'loops_patterns',
  'ai_inference', 'agent_nodes', 'streams', 'function_triggers',
  'custom_ui_basics', 'custom_ui_packages', 'custom_ui_hooks', 'custom_ui_data',
  'custom_ui_multiscreen', 'custom_ui_markdown', 'custom_ui_live_updates',
  'custom_ui_stuard_api', 'custom_ui_node_routing', 'custom_ui_multi_page',
  'custom_ui_window', 'custom_ui_visual', 'custom_ui_pitfalls',
  'debugging', 'performance',
]);

/**
 * The CORE corpus inlined into the system prompt, plus a compact index of the
 * on-demand reference sections. Replaces getAllDocsInline() in the workflow
 * agent prompt to shed ~6k of always-resent prefix tokens.
 */
export function getCoreDocsInline(): string {
  const core = DOC_CHUNKS.filter(c => !REFERENCE_DOC_IDS.has(c.id));
  const reference = DOC_CHUNKS.filter(c => REFERENCE_DOC_IDS.has(c.id));
  const inlined = core.map(c => `### ${c.id} — ${c.title}\n${c.content}`).join('\n\n');
  const index = reference.map(c => `- ${c.id} — ${c.title}`).join('\n');
  return `${inlined}\n\n### ON-DEMAND REFERENCE SECTIONS\nThese are NOT inlined above. When (and only when) you build one of these features, fetch the section with search_workflow_docs({ query: "<id>" }):\n${index}`;
}
