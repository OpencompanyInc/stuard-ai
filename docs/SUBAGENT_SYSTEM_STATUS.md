# Sub-Agent & Headless Agent System — Status Report

> Generated: Feb 20, 2026 — Compiled from full codebase analysis

---

## TL;DR — Why You Can't See It

1. **Compact mode has no SubagentDashboard** — The tabbed pinned status UI only renders in `sidebar` or `window` overlay modes. In compact mode, only `InputArea` is shown.
2. **`subagent_stop` is not wired in dispatch.py** — The function exists in `subagents.py` but was never registered in the dispatch table, so stopping a running subagent from the local agent side fails silently.
3. **No subagent indicator in compact mode** — If you deploy a headless agent while in compact mode, you'll get no visual feedback. You must switch to sidebar/window mode to see the dashboard.

---

## Architecture (3-Layer)

| Layer | Location | Role |
|-------|----------|------|
| **Python Agent** (local) | `apps/agent/app/tools/subagents.py` | In-memory task registry, HTTP API for dashboard polling |
| **Cloud AI** (backend) | `apps/cloud-ai/src/tools/deploy-headless-agent.ts` | Orchestrates LLM-powered headless agent execution |
| **Desktop** (Electron UI) | `apps/desktop/src/renderer/` | SubagentDashboard UI, tool routing to cloud |

---

## What's Fully Implemented ✅

### Cloud AI Tools (all 4 Mastra tools exist)

| Tool | File | Status |
|------|------|--------|
| `deploy_headless_agent` | `src/tools/deploy-headless-agent.ts` | ✅ Complete — spawns task, runs headless agent in background, streams progress |
| `get_headless_agent_status` | `src/tools/get-headless-agent-status.ts` | ✅ Complete — queries Python agent via bridge |
| `list_headless_agent_tasks` | `src/tools/list-headless-agent-tasks.ts` | ✅ Complete |
| `stop_headless_agent` | `src/tools/stop-headless-agent.ts` | ⚠️ Cloud-side abort works, local dispatch broken |

### Headless Agent Factory
- `apps/cloud-ai/src/agents/headless-agent.ts` — ✅ Fully implemented
- Model tier selection (fast/balanced/smart)
- Tool filtering for specialized mode
- Integration tools (GitHub, Google, Outlook, MCP)
- Custom system prompts
- Recursive sub-agent delegation supported

### Python Agent Local Tools
- `subagent_spawn` — ✅ Registered in dispatch.py
- `subagent_status` — ✅ Registered in dispatch.py
- `subagent_list` — ✅ Registered in dispatch.py
- `subagent_update` — ✅ Registered in dispatch.py
- `subagent_stop` — ❌ **NOT registered in dispatch.py** (function exists in subagents.py line 288, handler at line 407, but never wired)

### Python Agent HTTP API
- `GET /v1/subagents/list?limit=50&parent_id=xxx` — ✅ Works
- `GET /v1/subagents/{task_id}` — ✅ Works
- No POST endpoint for stopping via HTTP

### Desktop UI — SubagentDashboard
- `useSubagentDashboard.ts` — ✅ Polls `http://127.0.0.1:8765/v1/subagents/list` every 3s
- `SubagentDashboard.tsx` — ✅ 376-line component with:
  - Tab chips per task (scrollable)
  - Status indicators (running/completed/failed) with colored dots + icons
  - Animated pulse for active tasks
  - Step timeline with tool call icons
  - Collapse/dismiss/refresh actions
  - Auto-show when running tasks appear
- Mounted in `ChatView.tsx` at lines 496 and 669

### Workflow Editor
- `tool-schemas.ts` — ✅ `deploy_headless_agent`, `get_headless_agent_status`, `list_headless_agent_tasks` all registered with `kind: 'cloud'`
- Tool picker dropdown has "Agents" group (lines 1564-1567)

---

## What's Broken / Missing ❌

### Critical Issues

| Issue | Severity | Details |
|-------|----------|---------|
| **No compact-mode indicator** | 🔴 HIGH | SubagentDashboard only renders in `sidebar`/`window` modes. Compact mode (`InputArea`) has zero subagent visibility. If you deploy a headless agent from compact mode, you see nothing. |
| **`subagent_stop` not in dispatch.py** | 🔴 HIGH | The stop function exists but is never registered. Cloud-side `AbortController.abort()` works, but local task status never updates to `cancelled`. |
| **No stop button in dashboard UI** | 🟡 MEDIUM | SubagentDashboard shows status/logs but has no way to stop a running task. Dismiss only hides the UI, doesn't cancel execution. |
| **`stop_headless_agent` not in tool-schemas.ts** | 🟡 MEDIUM | Workflow editor doesn't know about the stop tool. Users can't add a "stop agent" step. |

### Infrastructure Gaps

| Gap | Impact |
|-----|--------|
| **In-memory only** | All subagent state lives in Python's `_running_subagents` dict. Process restart = all history lost. No Supabase table. |
| **No HTTP API from cloud-ai** | Everything flows through AI's tool calls over WebSocket. Can't externally query/manage subagents. |
| **No rate limiting** | No cap on concurrent subagents per user. |
| **No cost tracking** | Sub-agent LLM usage not tracked separately. |
| **No heartbeat/timeout** | If cloud-ai crashes mid-execution, Python side shows task as "running" forever. |
| **No cleanup scheduler** | `cleanup_completed_subagents()` exists but nothing calls it periodically. |

---

## End-to-End Flow (When Working)

```
1. User/Agent invokes `deploy_headless_agent`
2. Desktop routes as `kind: cloud` → execCloudTool() → WebSocket to cloud-ai
3. Cloud-AI calls execLocalTool('subagent_spawn') → Python registers task
4. Cloud-AI fires runHeadlessTask() async (fire-and-forget)
5. Returns { ok: true, taskId } immediately
6. runHeadlessTask() streams execution:
   - Tool calls/results flushed via execLocalTool('subagent_update')
   - AbortController stored for cancellation
7. Dashboard polls GET /v1/subagents/list every 3s → shows progress
8. On completion → final status update pushed to Python agent
```

---

## What's Left to Fix (Priority Order)

### P0 — Must Fix for Testing
1. **Add compact-mode subagent indicator** — Even a small badge/pill in `InputArea` showing "2 agents running" with click-to-expand
2. **Register `subagent_stop` in dispatch.py** — Add to `TOOL_CATEGORIES` and handler map alongside the other 4 subagent tools

### P1 — Should Fix
3. **Add stop button to SubagentDashboard** — A red "Stop" / ⏹ button on running tasks that calls `stop_headless_agent`
4. **Add `stop_headless_agent` to tool-schemas.ts** — So workflows can stop agents too
5. **Add HTTP stop endpoint** — `POST /v1/subagents/{task_id}/stop` in Python agent routes

### P2 — Nice to Have
6. **Persist subagent tasks to Supabase** — Survive process restarts
7. **Add heartbeat/timeout** — Detect crashed executions, auto-mark as failed after N minutes
8. **Rate limiting** — Cap concurrent subagents per user (e.g., 5)
9. **Cost tracking** — Track tokens per subagent task
10. **Cleanup scheduler** — Periodic `cleanup_completed_subagents()` call or TTL-based eviction

---

## File Reference Map

| Component | File |
|-----------|------|
| Deploy tool (cloud) | `apps/cloud-ai/src/tools/deploy-headless-agent.ts` |
| Status tool (cloud) | `apps/cloud-ai/src/tools/get-headless-agent-status.ts` |
| List tool (cloud) | `apps/cloud-ai/src/tools/list-headless-agent-tasks.ts` |
| Stop tool (cloud) | `apps/cloud-ai/src/tools/stop-headless-agent.ts` |
| Agent factory (cloud) | `apps/cloud-ai/src/agents/headless-agent.ts` |
| Tool registry (cloud) | `apps/cloud-ai/src/agents/stuard/tools.ts` |
| Python subagent tools | `apps/agent/app/tools/subagents.py` |
| Python dispatch | `apps/agent/app/tools/dispatch.py` |
| Python HTTP routes | `apps/agent/app/routes/core.py` |
| Dashboard hook | `apps/desktop/src/renderer/hooks/useSubagentDashboard.ts` |
| Dashboard UI | `apps/desktop/src/renderer/components/chat-view/SubagentDashboard.tsx` |
| ChatView (mount point) | `apps/desktop/src/renderer/components/ChatView.tsx` |
| InputArea (compact, no subagent) | `apps/desktop/src/renderer/components/InputArea.tsx` |
| App.tsx (mode routing) | `apps/desktop/src/renderer/App.tsx` |
| Tool schemas (workflow) | `apps/desktop/src/renderer/workflows/constants/tool-schemas.ts` |
| Test cases doc | `docs/SUBAGENT_TEST_CASES.md` |
