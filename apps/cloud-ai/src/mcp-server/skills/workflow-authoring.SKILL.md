---
name: stuard-workflow-authoring
description: How Stuard workflows are wired — triggers, nodes, wires, variables, control flow — and how to create/edit them through the Stuard MCP tools. Load this before building or changing a workflow.
---

# Stuard Workflow Authoring

You can build and change **Stuard workflows** — visual automations that run on the
user's device or cloud VM. **You are the architect**: you compose the graph, wire it,
validate it, and persist it yourself by calling the primitive tools below — there is no
separate subagent to brief. This manual is your reference for how the graph works so the
nodes, wires, and triggers you emit are correct.

## Tools (the loop)
1. `stuard_search_workflow_docs` — **start here.** Pull the section(s) you need (e.g. `"schedule.cron trigger"`, `"custom_ui callNode"`, `"guard branching"`, `"modify_workflow add_node"`). Pass `"list"` to see every section id.
2. `stuard_search_workflow_nodes` — find the exact node/tool names + compact input shapes for each step.
3. `stuard_get_node_schema` — exact args (names, types, required) for one node when the compact signature isn't enough.
4. `stuard_create_workflow` — create a NEW workflow from a **spec you compose** (`{ id?, name, triggers[], nodes[], wires[] }`). Persists to the user's Automations tab and returns the `flow_…` id. You may start minimal (just the trigger) and grow it with modify.
5. `stuard_read_workflow` — read the flow back by id as compact DSL: `mode:"outline"` (the map), `mode:"window"` + `focus_ids` (full args for specific nodes), `mode:"node"` + `focus_ids` (those nodes with every string arg shown VERBATIM + its `edit_node_text` path — use it to read a custom_ui component / inline script / long prompt before editing it, never read the `.stuard` file for that), `validate:true` (topology check + schematic).
6. `stuard_modify_workflow` — apply structured ops by id (`add_node`, `update_node`, `edit_node_text`, `add_wire`, `set_path`, …). Prefer a single batched `ops:[…]` call. Auto-persists.
7. `stuard_list_workflows` — find an existing `flow_…` id to read/modify.
8. `stuard_deploy_workflow` — activate a flow so its triggers actually fire (e.g. the cron starts running). Validate first.

Build order that works well: **docs → nodes → create (spec) → read(outline) → modify(ops) → read(validate:true) → deploy.** Address everything by the `flow_…` id; create and modify persist through the desktop, so the user's app must be online. Device/desktop steps (screen, local files, custom_ui) also require the desktop app online.

## The graph model
```
WORKFLOW = { id, name, triggers[], nodes[], wires[], variables?[], outputSchema?[] }
Trigger → wire → Node → wire → Node …
```
- **Triggers** — starting points (manual, hotkey, cron, webhook, fs.watch, …).
- **Nodes** — exactly one tool invocation each. One purpose per node.
- **Wires** — directed edges between trigger/nodes. Four kinds: plain, guarded, looped, callNode.
- **Variables** — workflow-scoped config + runtime store.
- **Workspace** — a per-workflow folder on disk (data / scripts / assets).

**Data** flows automatically: each node stores its result as `ctx[stepId]`; later nodes read it
via `{{stepId.field}}` templates. **Control** flows through wires: guards pick paths, loops repeat,
callNode wires fire only on demand from a UI.

## Execution model
1. Trigger fires → initial context `{ trigger: { data } }`.
2. All wires FROM the trigger queue their target nodes.
3. Per node: resolve `{{templates}}` in args → run tool → `ctx[node.id] = result`.
4. Walk outgoing wires: evaluate guards, apply loops, follow non-callNode wires. (callNode wires are on-demand only.)
5. Multiple unguarded outgoing wires from one source → targets run **in parallel**.
6. `waitForAll: true` on a node → it waits until ALL incoming wires complete (use to merge branches).
7. Node error + `fallbackTo` → engine jumps there; otherwise that branch halts, siblings continue.

Context available to templates:
- `ctx[stepId] = { ok, ...toolFields }`
- `ctx.trigger.data` — trigger payload (form values, webhook body, …)
- `ctx.workflow.<var>` — workflow variables · `ctx.$vars.<name>` — runtime variables
- `ctx.loop = { item, index }` inside loop iterations · `ctx.args` — inputs when run as a function

## Choosing a wire (intent → connection)
- Always run next → `{ from, to }`
- Run IF condition → `{ from, to, guard: { if: {...} } }` (JSONLogic — deterministic)
- AI picks the branch → `guard: { ai: { instruction, produceArgs? } }` (fuzzy only — token+latency cost)
- Run several next → multiple unguarded wires from the same source (parallel)
- Merge branches → `waitForAll: true` on the target node
- Repeat a target → `{ from, to, loop: { type: "forEach", … } }`; exit with `loopBreak: true` on a wire inside the body
- On-demand from a UI → `{ from, to, callNode: true }`
- Error recovery → `fallbackTo` on the failing node

Rules of thumb: parallelize independent branches (don't serialize needlessly); JSONLogic for
deterministic decisions, AI guards only for fuzzy ones; `call_function` + a `function` trigger when
the same sub-flow runs from multiple places. **Most common bug:** a trigger not wired to any node →
nothing runs.

## Triggers
Every trigger: `{ id, type, args: {}, label?, position, inputParams?: [] }`. A workflow may have many
triggers, each wired independently to its own starting node.
- `manual {}` — user clicks Run (add `inputParams` for a pre-run form → `{{trigger.data.field}}`)
- `hotkey { accelerator, hold?, passthrough? }` · `hotkey.release { accelerator }` (push-to-talk = both, no guards)
- `keystroke { sequence }` — typing the sequence anywhere fires it
- `schedule.cron { cron: "0 9 * * *" }`
- `webhook.local {}` — `POST http://127.0.0.1:18080/webhooks/incoming/<flowId>` (fire-and-forget)
- request/response webhook → branch MUST end in a `return_value` node; caller `POST .../webhooks/call/<flowId>`
- `fs.watch { path, pattern?, recursive? }` · `clipboard.change {…}` · `function { inputParams? }` · `app_start {}`

`inputParams`: changes each run (query, file, date) → inputParam; stays constant (API key, folder) → variable.

## Variables & scope
- `workflow.*` — global, shared across every `.stuard` file in the project.
- `local.*` — scoped to one file.
- `$vars.*` — runtime store written during a run.
Read in any arg via `{{workflow.apiKey}}`, `{{local.count}}`, `{{step_3.text}}`.

## How to build (you compose it)
1. **Ground**: `stuard_search_workflow_docs` for the trigger type + any control flow you'll use (guards, loops, callNode, custom_ui).
2. **Pick nodes**: `stuard_search_workflow_nodes` for each step; `stuard_get_node_schema` when you need exact args.
3. **Seed**: `stuard_create_workflow` with a spec containing at least the trigger. Keep node ids stable and descriptive (`step_ask`, `step_lesson`). Example seed:
   ```json
   { "spec": { "name": "Morning Brief", "triggers": [
     { "id": "trig_0", "type": "schedule.cron", "args": { "cron": "30 7 * * 1-5" }, "position": { "x": 60, "y": 60 } }
   ], "nodes": [], "wires": [] } }
   ```
4. **Build**: one batched `stuard_modify_workflow` call. Give each new node an `id` and `connectFrom` (or add the wire) so it's reachable — an unwired node never runs.
   ```json
   { "workflow_id": "flow_…", "ops": [
     { "op": "add_node", "id": "step_news", "tool": "perplexity_search", "args": { "query": "top AI news today" }, "connectFrom": "trig_0" },
     { "op": "add_node", "id": "step_dm",   "tool": "x_send_dm", "args": { "text": "{{step_news.summary}}", "profile": "stuard" }, "connectFrom": "step_news" }
   ] }
   ```
5. **Verify**: `stuard_read_workflow` with `validate:true` — fix any orphans / dangling wires / missing tools it flags.
6. **Activate**: `stuard_deploy_workflow` once it validates, so the trigger fires.

For **edits**, `stuard_list_workflows` → `stuard_read_workflow({ mode:"outline" })` to see ids → `stuard_modify_workflow` the specific nodes/wires. Same flow id, no duplicate.

> The exhaustive, always-current node catalog lives behind `stuard_search_workflow_nodes` / `stuard_get_node_schema` — use them for exact node names and input fields rather than guessing.