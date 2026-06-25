# Stuard MCP Server

Exposes Stuard to **external MCP clients** (Claude Code, Codex, Cursor, Claude Desktop) so a
coding agent can read/write tasks, search memories & projects, inspect/create agents and
workflows, **discover and run any tool the main Stuard agent can run**, and ask the user
questions asynchronously.

> This is the *inverse* of `src/routes/mcp.ts` + `src/mcp/*`, which make Stuard an MCP **client**
> (consuming Notion/Linear/Stripe). This document covers Stuard as an MCP **server**.

## Topology: local front door, cloud engine

Coding agents (Claude Code/Codex/Cursor) run on the same device as the Stuard desktop app, so the
thing they connect to is **local**. The desktop, in turn, makes the authenticated request to the
cloud:

```
Claude Code / Codex / Cursor ──(http 127.0.0.1)──► Stuard desktop (local proxy) ──(authed https)──► cloud /mcp/server
```

Two tiers:

1. **Local front door** — `apps/desktop` (`services/mcp-local-server.ts`). A loopback HTTP server
   bound to `127.0.0.1`. It is a *thin authenticated reverse proxy*: it validates a local token,
   swaps in the desktop's auto-refreshed cloud token, and forwards the MCP Streamable HTTP traffic
   (POST/GET/DELETE, including the SSE stream and `mcp-session-id` continuity) to the cloud engine.
   This is what the coding agent's `.mcp.json` points at.

2. **Cloud engine** — `apps/cloud-ai` (`/mcp/server`). All tool logic lives here, reusing the
   orchestrator's own path: registry + semantic search (`runToolSearch` → Supabase
   `tool_embeddings`), the executor (`execute_tool`), and the desktop relay (`bridge.ts`). Device
   tools relay back over the desktop's existing cloud WS — and since the desktop running the local
   proxy *is* that desktop, it's online by definition (no "desktop offline" gap in practice).

Why this split (vs. a fully local native server): the coding agent only ever talks to localhost
(no cloud auth/PAT to paste), zero tool logic is duplicated, and device tools work because the
proxying desktop is the relay target. Search/execute are cloud-centric anyway, so reimplementing
them in Electron would just fork the registry.

## Endpoints

Local (what coding agents use):
```
POST/GET/DELETE  http://127.0.0.1:<port>/mcp     (default port 8788; STUARD_MCP_PORT to override)
Authorization: Bearer <local token>              (generated; written to userData/mcp-config.json)
```

Cloud engine (what the desktop proxies to):
```
POST/GET/DELETE  /mcp/server                     (MCP Streamable HTTP transport)
Authorization: Bearer <Stuard cloud token>       (injected by the desktop; see "Auth")
```

The cloud endpoint is served by `@mastra/mcp`'s `MCPServer.startHTTP({ url, httpPath, req, res })`,
which speaks Streamable HTTP over raw Node `req`/`res` — matching cloud-ai's router model. A single
`MCPServer` singleton holds the tools; **per-request user context is injected via the bridge ALS**
(`withClientBridge` / `runWithSecrets`), not via server construction, so one instance serves all users.

## Execution context (the key trick)

Each MCP HTTP request is wrapped in the same AsyncLocalStorage bridge context the chat path uses:

```ts
const ws = getDesktopWs(userId);            // the user's connected desktop socket, if any
const run = () => mcpServer.startHTTP({ url, httpPath: '/mcp/server', req, res });
if (ws) await withClientBridge(ws, run, { userId });   // device tools relay to desktop
else    await runWithSecrets({ userId }, run);          // cloud tools run; device tools error cleanly
```

- **Registry / custom-integration tools** run inline in cloud-ai.
- **Device tools** (`hasClientBridge()` true) relay to the desktop and resolve via
  `handleClientToolMessage` — identical to a normal chat turn.
- **Desktop offline** → `hasClientBridge()` is false, so `execute_tool` skips the bridge fallback
  and device-only tools return a clean "not found / desktop required" instead of `ECONNREFUSED`.

## Tools exposed

| MCP tool | Backs onto | Notes |
|---|---|---|
| `stuard_search_tools` | `search_tools` (chat surface) | Semantic search over everything the **main agent** can discover. Returns compact input signatures. |
| `stuard_execute_tool` | `execute_tool` | Runs any tool by name. Honors `INTERNAL_TOOLS` refusal. `background:true` → returns a `job_id` instead of blocking. |
| `stuard_ask` | `ask_user` over the bridge (non-blocking) | Sends a question to the user; returns a `job_id` immediately. The reply lands on the job later. |
| `stuard_status` | job store | Poll a `job_id` for lifecycle + result/reply. |
| `stuard_inbox` | job store | List the caller's recent jobs (like listing an SMS thread). |

The high-level CRUD surfaces (tasks / memories / projects / agents / workflows) are reachable
*today* via `stuard_search_tools` + `stuard_execute_tool` (that's "all the ones the main agent can
access"). Dedicated first-class `stuard_*` CRUD tools are an optional later convenience layer.

## Async job model (Telnyx-style)

MCP calls are synchronous, but "ask the user" and long tool runs are not. So both create a **job**
identified by an id (the SID), and the caller polls `stuard_status`:

```
queued → delivered → awaiting_reply ─┬─→ completed     (reply / results landed)
                  └→ running ────────┤
                                     ├─→ failed
                                     ├─→ expired        (hit expires_in, no reply)
                                     └─→ dismissed      (user closed it)
```

Jobs are user-scoped (`status`/`inbox` only return the caller's). The store is in-memory in the
long-lived cloud-ai process with a 24h TTL; swap `mcp-server/job-store.ts` for Supabase if
cross-instance durability is needed.

## Security

- **Surface = `chat`.** Per product decision, the MCP client gets the same toolset the main agent
  has. `INTERNAL_TOOLS` remain non-callable (file-index plumbing). If we later want a tighter
  external surface, add an `'mcp'` value to `ToolSurface` and gate in `isToolDiscoverableForSurface`.
- **Writes / real-world actions** inherit the same gating the agent already applies (e.g. local
  agent permission prompts via the desktop). Nothing here bypasses those.
- **Two-token model:**
  - *Local token* (`slmcp_…`) — the coding agent presents this to the loopback server in
    `Authorization: Bearer`. Generated once, persisted in `userData/mcp-local-token.json` (mode
    0600), and never leaves the device. Loopback binding + this token keep other local processes
    from hijacking the user's Stuard session.
  - *Cloud token* — the desktop's own auto-refreshed Stuard access token (`getValidMainAccessToken`),
    swapped in for the upstream call and verified cloud-side by `verifyAccessToken`. Never exposed
    to the coding agent. Auth is isolated in `authenticateMcpRequest` (cloud) so a future
    per-client PAT swap stays localized.

## Files

Cloud engine (`apps/cloud-ai`):
- `src/mcp-server/job-store.ts` — async job store + lifecycle (unit-tested).
- `src/mcp-server/tools.ts` — the 5 MCP tools (wrap existing `search_tools`/`execute_tool`/`ask_user`).
- `src/mcp-server/server.ts` — `MCPServer` singleton.
- `src/routes/mcp-server.ts` — `/mcp/server` route: auth → bridge context → `startHTTP`.
- Wired in `src/routes/index.ts` before `handleMCPRoutes`.

Local front door (`apps/desktop`):
- `src/main/services/mcp-local-server.ts` — loopback proxy + local-token mgmt + config snippet.
- Exported from `src/main/services/index.ts`; started/stopped in `src/main/app.ts` (startup step
  after the cloud WS; shutdown alongside the other services).

## Follow-ups

1. Settings UI + IPC surfacing `getMcpLocalServerInfo()` (URL + token + copy-paste config). Today
   the snippet is written to `userData/mcp-config.json`.
2. Per-integration token injection parity with `prepareChatRequest` (so cloud OAuth tools work
   even without the desktop bridge; today bridged device execution supplies its own tokens).
3. Optional first-class `stuard_*` CRUD tools for the common surfaces.
4. Stdio transport variant for coding agents that prefer spawning a command over HTTP.
5. Rate limiting (mirror `desktop-tool-relay`'s per-user bucket).</invoke>
