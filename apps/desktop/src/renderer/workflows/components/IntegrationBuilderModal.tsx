/**
 * IntegrationBuilderModal
 *
 * Form-based authoring + test runner for declarative integration manifests.
 * Drafts persist in localStorage; secrets are memory-only and travel to
 * cloud-ai's run-draft route per execution. The form state IS the manifest
 * (with light shape-conversions for args/headers/query/body), so saving is
 * just a snapshot of the current state — no JSON parsing on the happy path.
 *
 * The build pane is split into expandable sections (Identity / Auth / Hosts
 * / Tools / Ping). Power users can flip to a read-only JSON view to copy or
 * paste the manifest, but JSON is never required to ship a draft.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle, Check, ChevronDown, ChevronRight, Code2, Copy, FileJson,
  Globe, Key, Loader2, Play, Plug, Plus, Save, Send, Boxes, Trash2,
  Wand2, X, Zap, Lock, Hash, ToggleLeft, AlignLeft, MessageSquare, Rocket,
  Upload, Sparkles, ArrowUp, CheckCircle2, Search, ExternalLink, Link2, Brain,
} from "lucide-react";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import { supabase } from "../../lib/supabaseClient";
import { getCloudAiHttp } from "../../utils/cloud";
import {
  fetchInstalledIntegrations,
  deployIntegration,
  uninstallIntegration,
} from "../../utils/installedIntegrations";
import { ModelSelector } from "../../components/ModelSelector";
import type { ModelSourcePreference, ReasoningLevel } from "../../hooks/usePreferences";
import { Shimmer } from "../../components/ai-elements/Shimmer";
import { confirmDialog } from "./ConfirmDialog";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "../../components/ai-elements/ChainOfThought";

const DRAFTS_KEY = "stuard:integration_drafts";

const IB_BUTTON =
  "border wf-border-subtle wf-fg-muted wf-hover-bg hover:wf-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const IB_ICON_BUTTON =
  "wf-fg-faint wf-hover-fg wf-hover-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const IB_INPUT =
  "wf-input focus:outline-none";
const IB_ACTIVE =
  "border-[color-mix(in_srgb,var(--wf-accent)_55%,var(--wf-border))] bg-[color-mix(in_srgb,var(--wf-accent)_10%,transparent)] text-[var(--wf-fg)]";

// ─── Form-state types ────────────────────────────────────────────────────
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

type AuthStrategy =
  | { type: "bearer"; tokenField: string; scheme?: string }
  | { type: "apiKey"; keyField: string; in: "header"; headerName: string; prefix?: string }
  | { type: "apiKey"; keyField: string; in: "query"; paramName: string }
  | { type: "basic"; userField: string; passField: string }
  | { type: "oauth2"; authorizeUrl: string; tokenUrl: string; clientIdField: string; clientSecretField: string; scopes?: string[]; scheme?: string; extraAuthParams?: Record<string, string> }
  | { type: "none" };

/** Reserved secret key written by the OAuth callback once a user connects. */
const OAUTH_ACCESS_TOKEN_KEY = "oauth_access_token";

interface AuthField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  hint?: string;
}

type ArgType = "string" | "number" | "integer" | "boolean";
interface ToolArg {
  name: string;
  type: ArgType;
  required: boolean;
  description?: string;
}

interface KVPair { k: string; v: string; }

type BodyForm =
  | { kind: "none" }
  | { kind: "json"; valueText: string }
  | { kind: "form"; fields: KVPair[] }
  | { kind: "text"; contentType: string; value: string };

interface Tool {
  name: string;
  description: string;
  args: ToolArg[];
  method: HttpMethod;
  urlTemplate: string;
  headers: KVPair[];
  query: KVPair[];
  body: BodyForm;
}

interface Draft {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  auth: { strategy: AuthStrategy; fields: AuthField[] };
  outbound_hosts: string[];
  tools: Tool[];
  ping?: { method: HttpMethod; urlTemplate: string };
}

// ─── Quick-start presets ─────────────────────────────────────────────────
const PRESETS: Array<{ id: string; label: string; description: string; build: () => Draft }> = [
  {
    id: "bearer",
    label: "Bearer token (Authorization header)",
    description: "Stripe, OpenAI, Linear, most modern SaaS",
    build: () => ({
      slug: "my-integration",
      name: "My Integration",
      description: "What this integration does in one line.",
      icon: "🧩",
      category: "Other",
      version: "0.1.0",
      auth: {
        strategy: { type: "bearer", tokenField: "api_key" },
        fields: [{ name: "api_key", label: "API Key", secret: true, required: true, placeholder: "sk_..." }],
      },
      outbound_hosts: ["api.example.com"],
      tools: [],
    }),
  },
  {
    id: "apikey-header",
    label: "API key in custom header",
    description: "Resend (Authorization: Bearer …), Notion (Notion-Version), etc.",
    build: () => ({
      slug: "my-integration",
      name: "My Integration",
      description: "",
      icon: "🧩",
      category: "Other",
      version: "0.1.0",
      auth: {
        strategy: { type: "apiKey", keyField: "api_key", in: "header", headerName: "X-API-Key" },
        fields: [{ name: "api_key", label: "API Key", secret: true, required: true }],
      },
      outbound_hosts: ["api.example.com"],
      tools: [],
    }),
  },
  {
    id: "apikey-query",
    label: "API key in query param",
    description: "Some legacy and weather/maps APIs",
    build: () => ({
      slug: "my-integration",
      name: "My Integration",
      description: "",
      icon: "🧩",
      category: "Other",
      version: "0.1.0",
      auth: {
        strategy: { type: "apiKey", keyField: "api_key", in: "query", paramName: "apikey" },
        fields: [{ name: "api_key", label: "API Key", secret: true, required: true }],
      },
      outbound_hosts: ["api.example.com"],
      tools: [],
    }),
  },
  {
    id: "oauth2",
    label: "OAuth 2.0 (Connect button)",
    description: "Google, Slack, Notion — user signs in via consent, no key pasting",
    build: () => ({
      slug: "my-integration",
      name: "My Integration",
      description: "",
      icon: "🔐",
      category: "Other",
      version: "0.1.0",
      auth: {
        strategy: {
          type: "oauth2",
          authorizeUrl: "https://provider.com/oauth/authorize",
          tokenUrl: "https://provider.com/oauth/token",
          clientIdField: "client_id",
          clientSecretField: "client_secret",
          scopes: [],
        },
        fields: [
          { name: "client_id", label: "Client ID", secret: true, required: true },
          { name: "client_secret", label: "Client Secret", secret: true, required: true },
        ],
      },
      outbound_hosts: ["api.example.com"],
      tools: [],
    }),
  },
  {
    id: "none",
    label: "No auth (public API)",
    description: "Public read-only APIs",
    build: () => ({
      slug: "my-integration",
      name: "My Integration",
      description: "",
      icon: "🧩",
      category: "Other",
      version: "0.1.0",
      auth: { strategy: { type: "none" }, fields: [] },
      outbound_hosts: ["api.example.com"],
      tools: [],
    }),
  },
];

const EMPTY_TOOL: Tool = {
  name: "new_tool",
  description: "",
  args: [],
  method: "GET",
  urlTemplate: "https://api.example.com/path",
  headers: [],
  query: [],
  body: { kind: "none" },
};

// ─── Form ↔ manifest conversion ──────────────────────────────────────────
function toManifest(d: Draft): any {
  const tools = d.tools.map(t => ({
    name: t.name,
    description: t.description,
    args: argsToJsonSchema(t.args),
    request: {
      method: t.method,
      urlTemplate: t.urlTemplate,
      ...(t.headers.length ? { headers: kvToRecord(t.headers) } : {}),
      ...(t.query.length ? { query: kvToRecord(t.query) } : {}),
      ...(bodyToManifest(t.body) ? { body: bodyToManifest(t.body)! } : {}),
    },
  }));
  return {
    slug: d.slug,
    name: d.name,
    description: d.description,
    icon: d.icon,
    category: d.category,
    version: d.version,
    auth: d.auth,
    outbound_hosts: d.outbound_hosts.filter(Boolean),
    tools,
    ...(d.ping ? { ping: d.ping } : {}),
  };
}

function argsToJsonSchema(args: ToolArg[]) {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const a of args) {
    if (!a.name) continue;
    properties[a.name] = { type: a.type, ...(a.description ? { description: a.description } : {}) };
    if (a.required) required.push(a.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function kvToRecord(pairs: KVPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { k, v } of pairs) if (k.trim()) out[k.trim()] = v;
  return out;
}

function bodyToManifest(b: BodyForm): any | null {
  if (b.kind === "none") return null;
  if (b.kind === "json") {
    try { return { kind: "json", value: JSON.parse(b.valueText || "null") }; }
    catch { return { kind: "json", value: b.valueText }; }
  }
  if (b.kind === "form") return { kind: "form", fields: kvToRecord(b.fields) };
  if (b.kind === "text") return { kind: "text", contentType: b.contentType, value: b.value };
  return null;
}

function recordToKv(rec: Record<string, string> | undefined): KVPair[] {
  if (!rec) return [];
  return Object.entries(rec).map(([k, v]) => ({ k, v }));
}

function fromManifest(m: any): Draft {
  return {
    slug: m.slug || "",
    name: m.name || "",
    description: m.description || "",
    icon: m.icon || "🧩",
    category: m.category || "Other",
    version: m.version || "0.1.0",
    auth: { strategy: m.auth?.strategy || { type: "none" }, fields: m.auth?.fields || [] },
    outbound_hosts: Array.isArray(m.outbound_hosts) ? m.outbound_hosts : [],
    tools: Array.isArray(m.tools) ? m.tools.map(toolFromManifest) : [],
    ...(m.ping ? { ping: { method: m.ping.method || "GET", urlTemplate: m.ping.urlTemplate || "" } } : {}),
  };
}

function toolFromManifest(t: any): Tool {
  const props: Record<string, any> = t.args?.properties || {};
  const req: string[] = t.args?.required || [];
  const args: ToolArg[] = Object.entries(props).map(([name, schema]: [string, any]) => ({
    name,
    type: (["string","number","integer","boolean"].includes(schema?.type) ? schema.type : "string") as ArgType,
    required: req.includes(name),
    description: schema?.description || "",
  }));
  let body: BodyForm = { kind: "none" };
  const b = t.request?.body;
  if (b?.kind === "json") body = { kind: "json", valueText: JSON.stringify(b.value ?? {}, null, 2) };
  else if (b?.kind === "form") body = { kind: "form", fields: recordToKv(b.fields) };
  else if (b?.kind === "text") body = { kind: "text", contentType: b.contentType || "text/plain", value: b.value || "" };
  return {
    name: t.name || "",
    description: t.description || "",
    args,
    method: t.request?.method || "GET",
    urlTemplate: t.request?.urlTemplate || "",
    headers: recordToKv(t.request?.headers),
    query: recordToKv(t.request?.query),
    body,
  };
}

// ─── localStorage ────────────────────────────────────────────────────────
interface DraftMap { [slug: string]: any }
function loadDrafts(): DraftMap {
  try { const r = localStorage.getItem(DRAFTS_KEY); return r ? (JSON.parse(r) || {}) : {}; } catch { return {}; }
}
function saveDrafts(d: DraftMap): void {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch { /* quota */ }
}

// Deployed integrations now live server-side (custom_integrations table, secrets
// encrypted with per-user envelope encryption). The modal reads/writes them via
// the helpers in utils/installedIntegrations.ts; only drafts remain in localStorage.

async function getToken(): Promise<string | null> {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || null; }
  catch { return null; }
}

// ─── AI assistant message shape ──────────────────────────────────────────
// Assistant turns are built incrementally as SSE events stream in. Each
// `AssistantPart` is one element in the chain-of-thought trace.
type AssistantPart =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; id: string; name: string; args: any; result?: any; status: "running" | "done" | "error" }
  | { kind: "text"; text: string };

interface AiUserMsg { role: "user"; content: string }
interface AiAssistantMsg {
  role: "assistant";
  parts: AssistantPart[];
  text: string;           // running prose only (no reasoning/tool noise)
  startedAt: number;
  finishedAt?: number;
  isStreaming?: boolean;
}
type AiMessage = AiUserMsg | AiAssistantMsg;

// History payload to the server is plain {role, content} pairs so the
// server prompt stays cheap; reasoning/tool noise lives only on the client.
function toHistoryPayload(msgs: AiMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return msgs.map((m) => (m.role === "user"
    ? { role: "user" as const, content: m.content }
    : { role: "assistant" as const, content: m.text || "" }));
}

interface IntegrationBuilderModalProps {
  open: boolean;
  onClose: () => void;
  selectedModelId: string | "auto";
  onSelectModel: (id: string | "auto") => void;
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
  /** When provided, the builder opens seeded with this manifest (edit flow). */
  seedManifest?: any | null;
}

export function IntegrationBuilderModal({
  open,
  onClose,
  selectedModelId,
  onSelectModel,
  modelSource,
  onModelSourceChange,
  reasoningLevel,
  onReasoningLevelChange,
  seedManifest,
}: IntegrationBuilderModalProps) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;

  const [drafts, setDrafts] = useState<DraftMap>({});
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(PRESETS[0].build());
  const [dirty, setDirty] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [viewMode, setViewMode] = useState<"form" | "json">("form");
  const [openSection, setOpenSection] = useState<string>("identity");

  // Runner state
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [argValues, setArgValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Right pane tab + AI assistant + installed map + transient toast
  const [rightTab, setRightTab] = useState<"test" | "ai">("ai");
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  // Deployed integrations come from the secure server-side store, keyed by slug.
  const [installed, setInstalled] = useState<Record<string, { enabled: boolean; oauthConnected?: boolean }>>({});
  const [deploying, setDeploying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const showToast = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshInstalled = useCallback(async () => {
    const list = await fetchInstalledIntegrations();
    const map: Record<string, { enabled: boolean; oauthConnected?: boolean }> = {};
    for (const i of list) map[i.slug] = { enabled: i.enabled, oauthConnected: Array.isArray(i.configuredSecrets) && i.configuredSecrets.includes(OAUTH_ACCESS_TOKEN_KEY) };
    setInstalled(map);
    // Let the workflow palette + bot tool picker re-pull the deployed set.
    try { window.dispatchEvent(new CustomEvent("stuard:integrations-changed")); } catch { /* noop */ }
  }, []);

  // ─── Initialize on open ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const m = loadDrafts();
    setDrafts(m);
    // Edit flow: a deployed integration's manifest seeds the form directly so
    // the user can revise and re-deploy it (drafts live in localStorage, but a
    // deployed integration may not have a local draft).
    if (seedManifest && typeof seedManifest === "object") {
      setActiveSlug(typeof seedManifest.slug === "string" ? seedManifest.slug : null);
      setDraft(fromManifest(seedManifest));
      setShowPresets(false);
    } else {
      // "New tool": always start from a clean slate. (Existing drafts remain
      // reachable via the draft selector in the header — we must NOT silently
      // re-open the first saved draft here, or "New" feels like it edits an
      // existing tool.)
      setActiveSlug(null);
      setDraft(PRESETS[0].build());
      setShowPresets(true);
    }
    setDirty(false);
    setResult(null);
    setRunError(null);
    void refreshInstalled();
    setAiMessages([]);
    setAiInput("");
    setAiError(null);
    setRightTab("ai");
  }, [open]);

  // ─── Mutators ───────────────────────────────────────────────────────────
  const update = useCallback((fn: (d: Draft) => Draft) => {
    setDraft(prev => fn(prev));
    setDirty(true);
  }, []);

  const onPickPreset = useCallback((id: string) => {
    const p = PRESETS.find(x => x.id === id);
    if (!p) return;
    setDraft(p.build());
    setActiveSlug(null);
    setShowPresets(false);
    setDirty(true);
    setOpenSection("identity");
  }, []);

  const onSave = useCallback(() => {
    if (!draft.slug.trim()) return;
    const manifest = toManifest(draft);
    const next = { ...drafts, [draft.slug]: manifest };
    setDrafts(next);
    saveDrafts(next);
    setActiveSlug(draft.slug);
    setDirty(false);
  }, [draft, drafts]);

  const onSelectDraft = useCallback((slug: string) => {
    const m = drafts[slug];
    if (!m) return;
    setActiveSlug(slug);
    setDraft(fromManifest(m));
    setDirty(false);
    setResult(null);
    setRunError(null);
    setShowPresets(false);
  }, [drafts]);

  const onDeleteActive = useCallback(async () => {
    if (!activeSlug) return;
    const ok = await confirmDialog({
      title: `Delete draft “${drafts[activeSlug]?.name || activeSlug}”?`,
      message: "This removes the saved draft from this device. Deployed tools stay live until you uninstall them.",
      confirmLabel: "Delete draft",
      tone: "danger",
    });
    if (!ok) return;
    const next = { ...drafts };
    delete next[activeSlug];
    setDrafts(next);
    saveDrafts(next);
    const remaining = Object.keys(next);
    if (remaining.length > 0) onSelectDraft(remaining[0]);
    else { setActiveSlug(null); setShowPresets(true); }
  }, [activeSlug, drafts, onSelectDraft]);

  // ─── Deploy (secure server-side store) ─────────────────────────────────
  // The manifest + credentials are POSTed to cloud-ai, which encrypts secrets
  // with per-user envelope encryption and makes the tools available to the main
  // agent (via search_tools/execute_tool), bots, and workflows.
  const isInstalled = !!installed[draft.slug];
  const onDeployLocally = useCallback(async () => {
    if (!draft.slug.trim()) { showToast("error", "Slug is required before deploying"); return; }
    if (!draft.tools.length) { showToast("error", "Add at least one tool before deploying"); return; }
    setDeploying(true);
    const manifest = toManifest(draft);
    const res = await deployIntegration(manifest, secrets);
    setDeploying(false);
    if (!res.ok) { showToast("error", res.error || "Deploy failed."); return; }
    // Keep a local draft copy so it survives modal re-open.
    const nextDrafts = { ...drafts, [draft.slug]: manifest };
    setDrafts(nextDrafts);
    saveDrafts(nextDrafts);
    setActiveSlug(draft.slug);
    setDirty(false);
    await refreshInstalled();
    showToast("success", `Deployed "${draft.name || draft.slug}". Its tools are now available to the agent, bots, and workflows.`);
  }, [draft, secrets, drafts, showToast, refreshInstalled]);

  const onUninstall = useCallback(async () => {
    if (!isInstalled) return;
    const ok0 = await confirmDialog({
      title: `Uninstall “${draft.name || draft.slug}”?`,
      message: "Its tools will stop working for your agents, bots, and workflows. You can re-deploy anytime.",
      confirmLabel: "Uninstall",
      tone: "danger",
    });
    if (!ok0) return;
    setDeploying(true);
    const ok = await uninstallIntegration(draft.slug);
    setDeploying(false);
    if (!ok) { showToast("error", "Uninstall failed."); return; }
    await refreshInstalled();
    showToast("success", `Uninstalled "${draft.slug}".`);
  }, [draft.slug, isInstalled, showToast, refreshInstalled]);

  // ─── Connect (OAuth 2.0 — bring-your-own-client) ───────────────────────
  // Opens the provider consent flow in the browser; cloud-ai exchanges the
  // code and writes the token into the integration's encrypted secret bag.
  // We poll the deployed integration until its configuredSecrets reports the
  // access token, then mark it connected.
  const onConnectOAuth = useCallback(async () => {
    if (!isInstalled) { showToast("error", "Deploy the integration first, then Connect."); return; }
    const token = await getToken();
    if (!token) { showToast("error", "Sign in again to connect."); return; }
    const url = `${getCloudAiHttp()}/integrations/custom/${encodeURIComponent(draft.slug)}/oauth/connect?token=${encodeURIComponent(token)}`;
    try { (window as any).desktopAPI?.openExternal?.(url); } catch { window.open(url, "_blank"); }
    setConnecting(true);
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const list = await fetchInstalledIntegrations();
        const me = list.find((x) => x.slug === draft.slug);
        if (me && Array.isArray(me.configuredSecrets) && me.configuredSecrets.includes(OAUTH_ACCESS_TOKEN_KEY)) {
          await refreshInstalled();
          showToast("success", `Connected "${draft.name || draft.slug}". Its tools can now call the API.`);
          return;
        }
      }
      showToast("error", "Didn't see a completed connection. Finish the consent in your browser, then try again.");
    } finally {
      setConnecting(false);
    }
  }, [draft.slug, draft.name, isInstalled, showToast, refreshInstalled]);

  // ─── Publish (clipboard until marketplace lands) ───────────────────────
  const onPublish = useCallback(async () => {
    if (!draft.slug.trim()) { showToast("error", "Slug is required before publishing"); return; }
    if (!draft.tools.length) { showToast("error", "Add at least one tool before publishing"); return; }
    const manifest = toManifest(draft);
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      showToast("success", "Manifest copied to clipboard. Marketplace publish coming soon — share the JSON for now.");
    } catch {
      showToast("error", "Couldn't copy to clipboard.");
    }
  }, [draft, showToast]);

  // ─── AI assistant (SSE streaming with tool calls + chain-of-thought) ──
  const onStopAi = useCallback(() => {
    try { aiAbortRef.current?.abort(); } catch {}
  }, []);

  const onSendAi = useCallback(async () => {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    setAiInput("");
    setAiError(null);

    const userMsg: AiUserMsg = { role: "user", content: text };
    const assistantMsg: AiAssistantMsg = {
      role: "assistant",
      parts: [],
      text: "",
      startedAt: Date.now(),
      isStreaming: true,
    };
    const prior = aiMessages;
    setAiMessages([...prior, userMsg, assistantMsg]);
    setAiBusy(true);

    // Mutator on the last (assistant) message.
    const patchAssistant = (mut: (m: AiAssistantMsg) => AiAssistantMsg) => {
      setAiMessages((all) => {
        if (!all.length) return all;
        const idx = all.length - 1;
        const last = all[idx];
        if (last.role !== "assistant") return all;
        const next = all.slice();
        next[idx] = mut(last);
        return next;
      });
    };

    const appendReasoning = (delta: string) => {
      patchAssistant((m) => {
        const parts = m.parts.slice();
        const tail = parts[parts.length - 1];
        if (tail && tail.kind === "reasoning") {
          parts[parts.length - 1] = { ...tail, text: tail.text + delta };
        } else {
          parts.push({ kind: "reasoning", text: delta });
        }
        return { ...m, parts };
      });
    };
    const appendText = (delta: string) => {
      patchAssistant((m) => {
        const parts = m.parts.slice();
        const tail = parts[parts.length - 1];
        if (tail && tail.kind === "text") {
          parts[parts.length - 1] = { ...tail, text: tail.text + delta };
        } else {
          parts.push({ kind: "text", text: delta });
        }
        return { ...m, parts, text: m.text + delta };
      });
    };
    const addToolCall = (id: string, name: string, args: any) => {
      patchAssistant((m) => ({
        ...m,
        parts: [...m.parts, { kind: "tool", id, name, args, status: "running" }],
      }));
    };
    const completeToolCall = (id: string, name: string, result: any) => {
      patchAssistant((m) => {
        const parts = m.parts.slice();
        let i = parts.length - 1;
        for (; i >= 0; i--) {
          const p = parts[i];
          if (p.kind === "tool" && p.id === id) {
            const errored = result && typeof result === "object" && result.error;
            parts[i] = { ...p, result, status: errored ? "error" : "done" };
            break;
          }
        }
        if (i < 0) {
          parts.push({ kind: "tool", id, name, args: {}, result, status: "done" });
        }
        return { ...m, parts };
      });
    };

    const ac = new AbortController();
    aiAbortRef.current = ac;

    let finalReply: string | null = null;
    let finalManifest: any = null;

    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in — sign in again to use the assistant.");
      const r = await fetch(`${getCloudAiHttp()}/v1/integrations/ai-assist`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: text,
          manifest: toManifest(draft),
          history: toHistoryPayload(prior),
          ...(selectedModelId && selectedModelId !== "auto" ? { modelId: selectedModelId } : {}),
          ...(selectedModelId && selectedModelId !== "auto" && modelSource ? { modelSource } : {}),
          ...(reasoningLevel ? { reasoningLevel } : {}),
        }),
        signal: ac.signal,
      });

      if (!r.ok || !r.body) {
        const fallback = await r.text().catch(() => "");
        let parsed: any = null;
        try { parsed = JSON.parse(fallback); } catch {}
        const detail = parsed?.detail || parsed?.error || fallback || `HTTP ${r.status}`;
        throw new Error(detail);
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // SSE = lines of "data: <json>\n\n" + ": ping" comments. Parse loosely.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt: any = null;
          try { evt = JSON.parse(payload); } catch { continue; }
          switch (evt?.type) {
            case "reasoning-delta":
              if (typeof evt.text === "string" && evt.text) appendReasoning(evt.text);
              break;
            case "text-delta":
              if (typeof evt.text === "string" && evt.text) appendText(evt.text);
              break;
            case "tool-call":
              addToolCall(String(evt.id || `tc_${Date.now()}`), String(evt.name || ""), evt.args ?? {});
              break;
            case "tool-result":
              completeToolCall(String(evt.id || ""), String(evt.name || ""), evt.result ?? null);
              break;
            case "done":
              finalReply = typeof evt.reply === "string" ? evt.reply : null;
              if (evt.manifest && typeof evt.manifest === "object") finalManifest = evt.manifest;
              break;
            case "error":
              throw new Error(evt.detail || evt.error || "stream_error");
            default:
              break;
          }
        }
      }
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "Stopped." : (e?.message || String(e));
      setAiError(msg);
      patchAssistant((m) => ({
        ...m,
        parts: [...m.parts, { kind: "text", text: `\n\n_${msg}_` }],
        text: (m.text || "") + `\n\n_${msg}_`,
        isStreaming: false,
        finishedAt: Date.now(),
      }));
      setAiBusy(false);
      aiAbortRef.current = null;
      return;
    }

    // Final consolidation — replace running text with server-cleaned reply
    // (the server strips the manifest's fenced block from the prose for us).
    patchAssistant((m) => ({
      ...m,
      text: finalReply ?? m.text,
      isStreaming: false,
      finishedAt: Date.now(),
    }));
    setAiBusy(false);
    aiAbortRef.current = null;

    if (finalManifest) {
      try {
        const nextDraft = fromManifest(finalManifest);
        setDraft(nextDraft);
        setDirty(true);
        showToast("success", "AI updated the manifest. Review the form, then Save.");
      } catch (e: any) {
        setAiError(`Could not apply changes: ${e?.message || e}`);
      }
    }
  }, [aiInput, aiBusy, aiMessages, draft, selectedModelId, modelSource, reasoningLevel, showToast]);

  // ─── Test-runner: tool selection + arg form ─────────────────────────────
  useEffect(() => {
    if (!draft.tools.length) { setSelectedTool(""); return; }
    if (!draft.tools.find(t => t.name === selectedTool)) setSelectedTool(draft.tools[0].name);
  }, [draft.tools, selectedTool]);

  const activeTool = useMemo(() => draft.tools.find(t => t.name === selectedTool) || null, [draft.tools, selectedTool]);
  useEffect(() => {
    // Reset arg values when switching tools so we don't carry stale fields.
    setArgValues({});
  }, [selectedTool]);

  // ─── Run / Ping ─────────────────────────────────────────────────────────
  const callDraftEndpoint = useCallback(async (suffix: "run-draft" | "ping-draft") => {
    setRunError(null);
    setResult(null);

    const coercedArgs: Record<string, any> = {};
    if (suffix === "run-draft") {
      if (!activeTool) { setRunError("Add at least one tool, then select it."); return; }
      if (draft.auth.strategy.type === "oauth2" && !isInstalled) {
        setRunError("OAuth tools run through the deployed integration. Deploy and Connect first, then test.");
        return;
      }
      for (const a of activeTool.args) {
        const raw = argValues[a.name];
        if (raw === undefined || raw === null || raw === "") {
          if (a.required) { setRunError(`Missing required arg: ${a.name}`); return; }
          continue;
        }
        if (a.type === "number" || a.type === "integer") {
          const n = Number(raw); if (Number.isNaN(n)) { setRunError(`${a.name} must be a number`); return; }
          coercedArgs[a.name] = a.type === "integer" ? Math.trunc(n) : n;
        } else if (a.type === "boolean") {
          coercedArgs[a.name] = raw === true || raw === "true";
        } else {
          coercedArgs[a.name] = String(raw);
        }
      }
    }

    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in — sign in again to mint a fresh Supabase token.");
      // OAuth integrations have no static token to send in a draft, so testing
      // a tool runs the DEPLOYED integration server-side (which uses the
      // connected token + auto-refresh) instead of the stateless run-draft path.
      const useDeployedRun = suffix === "run-draft" && draft.auth.strategy.type === "oauth2";
      const url = useDeployedRun
        ? `${getCloudAiHttp()}/v1/integrations/run`
        : `${getCloudAiHttp()}/v1/integrations/${suffix}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          useDeployedRun
            ? { slug: draft.slug, toolName: activeTool!.name, args: coercedArgs }
            : suffix === "run-draft"
              ? { manifest: toManifest(draft), secrets, toolName: activeTool!.name, args: coercedArgs }
              : { manifest: toManifest(draft), secrets }
        ),
      });
      // Read body as text first so we can show it raw when JSON parsing fails
      // (e.g. an HTML 401 page from a proxy, an empty body from a route that
      // doesn't exist on this cloud-ai build, etc.).
      const rawText = await r.text();
      let json: any = null;
      try { json = JSON.parse(rawText); } catch { /* not JSON */ }

      if (!r.ok || !json?.ok) {
        const friendly = json?.detail || json?.message || json?.error;
        const bodyExcerpt = (rawText || "").trim().slice(0, 600);
        const lines: string[] = [];
        lines.push(`HTTP ${r.status} ${r.statusText} from ${url}`);
        if (friendly) lines.push(friendly);
        if (!friendly && bodyExcerpt) lines.push(`Body: ${bodyExcerpt}`);
        if (r.status === 401) {
          lines.push(
            json?.error === "EXPIRED_TOKEN" || json?.error === "MISSING_TOKEN" || json?.error === "INVALID_TOKEN"
              ? "→ Your Supabase session is bad. Sign out and back in."
              : !json
                ? "→ cloud-ai may be running an older build (route returns no JSON). Restart cloud-ai and try again."
                : "→ Auth was rejected. If the body has no detail, restart cloud-ai or re-sign-in."
          );
        }
        setRunError(lines.join("\n"));
        if (json?.result) setResult(json.result);
      } else {
        setResult(json.result);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      const isAuth = /signed in/i.test(msg);
      setRunError(isAuth ? msg : `${msg}\n→ Couldn't reach cloud-ai at ${getCloudAiHttp()}. Check it's running and the URL matches.`);
    } finally {
      setBusy(false);
    }
  }, [draft, secrets, activeTool, argValues, isInstalled]);

  // ─── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); onSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onSave]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center backdrop-blur-md p-4 animate-in fade-in duration-200"
      style={{ background: d ? "rgba(2, 6, 23, 0.78)" : "rgba(15, 23, 42, 0.18)" }}
    >
      <div
        className="wf-bg-elevated wf-fg w-full max-w-[1320px] rounded-[24px] border wf-border shadow-2xl overflow-hidden flex flex-col h-[90vh] animate-in zoom-in-95 duration-200 relative"
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b wf-border" style={{ background: "var(--wf-bg)" }}>
          {/* Title row */}
          <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="wf-feature-tile__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]">
                <Plug className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[16px] font-semibold wf-fg truncate leading-none">Integration Builder</h2>
                  {isInstalled && (
                    <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 flex items-center gap-1 font-medium shrink-0">
                      <CheckCircle2 className="w-3 h-3" /> Deployed
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] wf-fg-muted leading-none truncate">
                  Connect any HTTP API and ship its tools to agents, workflows &amp; chat.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <select
                  value={activeSlug ?? ""}
                  onChange={(e) => e.target.value ? onSelectDraft(e.target.value) : setShowPresets(true)}
                  className="wf-input text-[12px] rounded-full pl-3.5 pr-8 py-1.5 appearance-none cursor-pointer max-w-[190px] truncate"
                >
                  <option value="">— New draft —</option>
                  {Object.keys(drafts).map(s => (<option key={s} value={s}>{drafts[s]?.name || s}</option>))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 wf-fg-faint" />
              </div>
              <button onClick={onClose} className={`p-1.5 rounded-full ${IB_ICON_BUTTON}`} title="Close"><X className="w-5 h-5" /></button>
            </div>
          </div>

          {/* Toolbar row */}
          <div className="px-5 pb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full p-0.5 wf-surface-muted">
                <SegBtn active={viewMode === "form"} onClick={() => setViewMode("form")} icon={<AlignLeft className="w-3.5 h-3.5" />} label="Form" />
                <SegBtn active={viewMode === "json"} onClick={() => setViewMode("json")} icon={<Code2 className="w-3.5 h-3.5" />} label="JSON" />
              </div>
              <button onClick={() => setShowPresets(true)} className={`px-3 py-1.5 rounded-full text-[12px] flex items-center gap-1.5 ${IB_BUTTON}`} title="Start from a preset">
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onSave} disabled={!draft.slug} className={`px-3 py-1.5 rounded-full text-[12px] flex items-center gap-1.5 ${IB_BUTTON}`} title="Save draft (Cmd/Ctrl+S)">
                <Save className="w-3.5 h-3.5" /> Save{dirty ? " •" : ""}
              </button>
              <button onClick={onPublish} disabled={!draft.slug} className={`px-3 py-1.5 rounded-full text-[12px] flex items-center gap-1.5 ${IB_BUTTON}`} title="Copy manifest for sharing (full marketplace publish coming soon)">
                <Upload className="w-3.5 h-3.5" /> Publish
              </button>
              {activeSlug && (
                <button onClick={onDeleteActive} className="p-1.5 rounded-full text-rose-400 hover:bg-rose-500/15 transition-colors" title="Delete draft">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              {draft.auth.strategy.type === "oauth2" && isInstalled && (
                <button
                  onClick={onConnectOAuth}
                  disabled={connecting}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold flex items-center gap-1.5 ${installed[draft.slug]?.oauthConnected ? IB_BUTTON : "wf-primary-btn disabled:opacity-40 disabled:cursor-not-allowed"}`}
                  title={installed[draft.slug]?.oauthConnected ? "Reconnect — re-run the provider sign-in" : "Sign in to the provider to authorize this integration"}
                >
                  {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  {connecting ? "Connecting…" : installed[draft.slug]?.oauthConnected ? "Reconnect" : "Connect"}
                </button>
              )}
              <button
                onClick={isInstalled ? onUninstall : onDeployLocally}
                disabled={!draft.slug || deploying}
                className={`px-4 py-1.5 rounded-full text-[12px] font-semibold flex items-center gap-1.5 ${isInstalled ? IB_BUTTON : "wf-primary-btn disabled:opacity-40 disabled:cursor-not-allowed"}`}
                title={isInstalled ? "Click to uninstall — tools are live for the agent, bots & workflows" : "Encrypt + store credentials server-side and expose this integration's tools"}
              >
                {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isInstalled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Rocket className="w-3.5 h-3.5" />}
                {deploying ? "Working…" : isInstalled ? "Deployed" : "Deploy"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        {showPresets ? (
          <PresetPicker dark={d} onPick={onPickPreset} onCancel={() => { if (activeSlug) setShowPresets(false); }} hasExisting={!!activeSlug} />
        ) : (
          <div className="flex-1 min-h-0 grid" style={{ gridTemplateColumns: "3fr 2fr", borderColor: 'var(--wf-border)' }}>
            {/* LEFT — Build pane (form OR raw JSON) */}
            <div className="flex flex-col min-h-0" style={{ borderRight: '1px solid var(--wf-border)' }}>
              {viewMode === "form" ? (
                <FormView
                  draft={draft}
                  update={update}
                  openSection={openSection}
                  setOpenSection={setOpenSection}
                  dark={d}
                />
              ) : (
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                  <JsonView draft={draft} setDraft={(d2) => { setDraft(d2); setDirty(true); }} dark={d} />
                </div>
              )}
            </div>

            {/* RIGHT — Test runner or AI assistant */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b wf-border-subtle">
                <RightTabButton active={rightTab === "ai"} onClick={() => setRightTab("ai")} icon={<Sparkles className="w-3.5 h-3.5" />} label="Build with AI" />
                <RightTabButton active={rightTab === "test"} onClick={() => setRightTab("test")} icon={<Zap className="w-3.5 h-3.5" />} label="Test" />
              </div>
              {rightTab === "test" ? (
                <TestPane
                  dark={d}
                  draft={draft}
                  secrets={secrets}
                  setSecrets={setSecrets}
                  selectedTool={selectedTool}
                  setSelectedTool={setSelectedTool}
                  argValues={argValues}
                  setArgValues={setArgValues}
                  busy={busy}
                  result={result}
                  runError={runError}
                  onRun={() => callDraftEndpoint("run-draft")}
                  onPing={() => callDraftEndpoint("ping-draft")}
                />
              ) : (
                <AIPane
                  dark={d}
                  messages={aiMessages}
                  input={aiInput}
                  setInput={setAiInput}
                  onSend={onSendAi}
                  onStop={onStopAi}
                  busy={aiBusy}
                  error={aiError}
                  selectedModelId={selectedModelId}
                  onSelectModel={onSelectModel}
                  modelSource={modelSource}
                  onModelSourceChange={onModelSourceChange}
                  reasoningLevel={reasoningLevel}
                  onReasoningLevelChange={onReasoningLevelChange}
                />
              )}
            </div>
          </div>
        )}

        {toast && (
          <div className="absolute bottom-5 right-5 z-[1100]">
            <div className={`px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-2.5 max-w-[480px] ${toast.kind === "success" ? "wf-panel wf-fg" : "bg-rose-500/15 border-rose-500/30 text-rose-200"}`}>
              {toast.kind === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span className="text-[12.5px]">{toast.text}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RightTabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] font-medium flex items-center gap-1.5 rounded-t-lg border-b-2 transition-colors ${active ? "wf-fg border-[var(--wf-accent)]" : "wf-fg-muted border-transparent wf-hover-fg"}`}
    >
      {icon}{label}
    </button>
  );
}

/** Pill segmented-control button used in the builder header (Form / JSON). */
function SegBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors ${active ? "wf-bg-elevated wf-fg shadow-sm" : "wf-fg-muted wf-hover-fg"}`}
    >
      {icon}{label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Preset picker
// ════════════════════════════════════════════════════════════════════════
function PresetPicker({ dark, onPick, onCancel, hasExisting }: {
  dark: boolean; onPick: (id: string) => void; onCancel: () => void; hasExisting: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-10 flex flex-col items-center">
      <div className="max-w-[760px] w-full">
        <h2 className="text-[20px] font-semibold wf-fg mb-2">How does this service sign you in?</h2>
        <p className="text-[13px] wf-fg-muted mb-8">
          Pick whichever sounds right — if you’re not sure, choose “API key” or just switch to <span className="wf-fg font-medium">Build with AI</span> and describe what you want. You can change everything later.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className="wf-card wf-card-interactive group text-left p-4 rounded-[18px]"
            >
              <div className="flex items-start gap-3">
                <span className="wf-icon-chip group-hover:text-[color:var(--wf-accent)] transition-colors flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]">
                  <Key className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold wf-fg mb-1 leading-tight">{p.label}</div>
                  <div className="text-[12px] wf-fg-muted leading-relaxed">{p.description}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        {hasExisting && (
          <div className="mt-8 text-center">
            <button onClick={onCancel} className="text-[12.5px] wf-fg-muted hover:wf-fg">Cancel and go back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Form view — collapsible sections
// ════════════════════════════════════════════════════════════════════════
const FORM_STEPS = [
  { id: "identity", label: "Basics", icon: Boxes, hint: "Give your tool a name and a one-line description." },
  { id: "auth", label: "Connect", icon: Lock, hint: "How should Stuard sign in to this service? Most use an API key." },
  { id: "hosts", label: "Web access", icon: Globe, hint: "Which web addresses is this tool allowed to reach?" },
  { id: "tools", label: "Actions", icon: Wand2, hint: "The things your agents and workflows can do with it." },
  { id: "ping", label: "Test connection", icon: Send, hint: "Optional: a quick check to confirm your keys work." },
] as const;

function FormView({ draft, update, openSection, setOpenSection, dark }: {
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  openSection: string;
  setOpenSection: (s: string) => void;
  dark: boolean;
}) {
  const doneMap: Record<string, boolean> = {
    identity: !!(draft.name.trim() && draft.slug.trim()),
    auth: draft.auth.strategy.type === "none" || draft.auth.fields.length > 0,
    hosts: draft.outbound_hosts.filter(Boolean).length > 0,
    tools: draft.tools.length > 0,
    ping: true,
  };
  const steps = FORM_STEPS.map((s) => ({ ...s, done: doneMap[s.id] }));
  let activeIdx = steps.findIndex((s) => s.id === openSection);
  if (activeIdx < 0) activeIdx = 0;
  const current = steps[activeIdx];
  const go = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, activeIdx + delta))];
    if (next) setOpenSection(next.id);
  };
  const StepIcon = current.icon;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Stepper */}
      <div className="px-6 pt-5 pb-4 border-b wf-border-subtle">
        <StepRail steps={steps} activeId={current.id} onPick={setOpenSection} />
      </div>

      {/* Active step */}
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar px-6 py-6">
        <div className="mb-6 flex items-start gap-3.5">
          <span className="wf-icon-chip flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]">
            <StepIcon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[18px] font-semibold wf-fg leading-tight">{current.label}</h3>
            <p className="mt-1 text-[13px] wf-fg-muted leading-relaxed">{current.hint}</p>
          </div>
        </div>

        {current.id === "identity" && (
          <div className="space-y-4">
            <Grid2>
              <Field label="Name" hint="Shown to users">
                <Input value={draft.name} onChange={v => update(d => ({ ...d, name: v }))} placeholder="My Integration" />
              </Field>
              <Field label="Slug" hint="URL-safe id; used for env vars">
                <Input value={draft.slug} onChange={v => update(d => ({ ...d, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} placeholder="my-integration" mono />
              </Field>
              <Field label="Version" hint="Semver">
                <Input value={draft.version} onChange={v => update(d => ({ ...d, version: v }))} placeholder="0.1.0" mono />
              </Field>
              <Field label="Category">
                <Input value={draft.category} onChange={v => update(d => ({ ...d, category: v }))} placeholder="Payments / DevOps / Email …" />
              </Field>
              <Field label="Icon" hint="Emoji or lucide id">
                <Input value={draft.icon} onChange={v => update(d => ({ ...d, icon: v }))} placeholder="🧩" />
              </Field>
            </Grid2>
            <Field label="Description" hint="One line about what this integration does">
              <Input value={draft.description} onChange={v => update(d => ({ ...d, description: v }))} placeholder="Send transactional email via …" />
            </Field>
          </div>
        )}

        {current.id === "auth" && (
          <AuthEditor auth={draft.auth} setAuth={a => update(d => ({ ...d, auth: a }))} />
        )}

        {current.id === "hosts" && (
          <HostsEditor hosts={draft.outbound_hosts} setHosts={hs => update(d => ({ ...d, outbound_hosts: hs }))} />
        )}

        {current.id === "tools" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] wf-fg-muted">
                {draft.tools.length} tool{draft.tools.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => update(d => ({ ...d, tools: [...d.tools, { ...EMPTY_TOOL, name: `tool_${d.tools.length + 1}` }] }))}
                className={`px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-1 ${IB_BUTTON}`}
              >
                <Plus className="w-3.5 h-3.5" /> Add tool
              </button>
            </div>
            {draft.tools.length === 0 ? (
              <div className="rounded-2xl border border-dashed wf-border p-8 text-center">
                <div className="wf-icon-chip mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[13px]">
                  <Wand2 className="w-5 h-5" />
                </div>
                <p className="text-[13px] wf-fg-muted">No tools yet. Add the first action this integration exposes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {draft.tools.map((t, i) => (
                  <ToolEditor
                    key={i}
                    tool={t}
                    authFields={draft.auth.fields}
                    onChange={(nt) => update(d => ({ ...d, tools: d.tools.map((x, j) => j === i ? nt : x) }))}
                    onDelete={() => update(d => ({ ...d, tools: d.tools.filter((_, j) => j !== i) }))}
                    dark={dark}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {current.id === "ping" && (
          <PingEditor ping={draft.ping} setPing={p => update(d => ({ ...d, ping: p }))} />
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t wf-border-subtle">
        <button
          onClick={() => go(-1)}
          disabled={activeIdx <= 0}
          className={`px-3.5 py-2 rounded-lg text-[12.5px] flex items-center gap-1.5 ${IB_BUTTON}`}
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back
        </button>
        <span className="text-[11.5px] wf-fg-faint">Step {activeIdx + 1} of {steps.length}</span>
        <button
          onClick={() => go(1)}
          disabled={activeIdx >= steps.length - 1}
          className="px-4 py-2 rounded-lg text-[12.5px] font-semibold flex items-center gap-1.5 wf-primary-btn disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Guided step rail — turns the section accordion into a wizard-like flow
// ════════════════════════════════════════════════════════════════════════
function StepRail({ steps, activeId, onPick }: {
  steps: Array<{ id: string; label: string; done: boolean }>;
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
      {steps.map((s, i) => {
        const active = s.id === activeId;
        return (
          <React.Fragment key={s.id}>
            <button
              onClick={() => onPick(s.id)}
              className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                active
                  ? "wf-fg font-semibold border-[color:var(--wf-border)] bg-[var(--wf-hover)]"
                  : "wf-border-subtle wf-fg-muted hover:bg-[var(--wf-hover)]"
              }`}
              title={s.label}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold ${
                s.done
                  ? "bg-emerald-500/20 text-emerald-400"
                  : active
                    ? "wf-accent-soft-bg text-[color:var(--wf-accent)]"
                    : "wf-fg-faint border wf-border-subtle"
              }`}>
                {s.done ? <Check className="w-2.5 h-2.5" /> : i + 1}
              </span>
              {s.label}
            </button>
            {i < steps.length - 1 && <div className="h-px w-3 shrink-0" style={{ background: "var(--wf-border)" }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Section primitive
// ════════════════════════════════════════════════════════════════════════
function Section({ title, icon, open, onToggle, dark, right, children }: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  dark: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="wf-card rounded-[14px]">
      <button onClick={onToggle} className="w-full px-3 py-2.5 flex items-center justify-between text-left">
        <div className="flex items-center gap-2 text-[13px] font-semibold wf-fg">
          {open ? <ChevronDown className="w-3.5 h-3.5 wf-fg-faint" /> : <ChevronRight className="w-3.5 h-3.5 wf-fg-faint" />}
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-2">{right}</div>
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Field / Input primitives
// ════════════════════════════════════════════════════════════════════════
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium wf-fg-muted block">{label}{hint && <span className="ml-2 wf-fg-faint font-normal">— {hint}</span>}</label>
      {children}
    </div>
  );
}
function Input({ value, onChange, placeholder, mono, type, password }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string; password?: boolean;
}) {
  return (
    <input
      type={password ? "password" : (type || "text")}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-[12.5px] px-3 py-2 rounded-[10px] ${IB_INPUT} ${mono ? "font-mono" : ""}`}
    />
  );
}
function Select<T extends string>({ value, onChange, options, mono }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; mono?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`w-full text-[12.5px] px-3 py-2 rounded-[10px] ${IB_INPUT} ${mono ? "font-mono" : ""}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function TextArea({ value, onChange, placeholder, rows = 4, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean;
}) {
  return (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      className={`w-full text-[12.5px] px-3 py-2 rounded-[10px] ${IB_INPUT} resize-y ${mono ? "font-mono" : ""}`}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════
// Auth editor
// ════════════════════════════════════════════════════════════════════════
/** Read-only redirect URL the user must whitelist in their OAuth provider app. */
function OAuthRedirectHint() {
  const redirectUrl = `${getCloudAiHttp()}/integrations/custom/oauth/callback`;
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(redirectUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };
  return (
    <div className="rounded-lg border wf-border-subtle p-3 space-y-2" style={{ background: "var(--wf-bg)" }}>
      <div className="text-[11.5px] font-semibold wf-fg">Step 1 — Add this redirect URI to your provider's OAuth app</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11.5px] wf-fg break-all rounded-md px-2 py-1.5 wf-surface-muted">{redirectUrl}</code>
        <button onClick={onCopy} className={`p-1.5 rounded-md ${IB_ICON_BUTTON}`} title="Copy redirect URI">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="text-[11px] wf-fg-muted leading-relaxed space-y-1">
        <p>
          Paste it <span className="wf-fg font-medium">exactly</span> — it must match character-for-character
          (same scheme, host, port, and no trailing <code className="wf-surface-muted rounded px-1">/</code>). The field is named:
        </p>
        <ul className="space-y-0.5 pl-1">
          <li>• <span className="wf-fg font-medium">Google</span> — APIs &amp; Services → Credentials → your <span className="wf-fg font-medium">Web application</span> client → <span className="wf-fg font-medium">Authorized redirect URIs</span></li>
          <li>• <span className="wf-fg font-medium">GitHub</span> — OAuth App → <span className="wf-fg font-medium">Authorization callback URL</span></li>
          <li>• <span className="wf-fg font-medium">Notion / Slack / others</span> — usually <span className="wf-fg font-medium">Redirect URI(s)</span> or <span className="wf-fg font-medium">Callback URL</span></li>
        </ul>
      </div>
    </div>
  );
}

function AuthEditor({ auth, setAuth }: { auth: Draft["auth"]; setAuth: (a: Draft["auth"]) => void }) {
  const strategy = auth.strategy;

  const setStrategy = (type: AuthStrategy["type"]) => {
    if (type === "bearer") setAuth({ ...auth, strategy: { type: "bearer", tokenField: auth.fields[0]?.name || "api_key" } });
    else if (type === "apiKey") setAuth({ ...auth, strategy: { type: "apiKey", keyField: auth.fields[0]?.name || "api_key", in: "header", headerName: "X-API-Key" } });
    else if (type === "basic") setAuth({ ...auth, strategy: { type: "basic", userField: "username", passField: "password" } });
    else if (type === "oauth2") setAuth({
      ...auth,
      strategy: {
        type: "oauth2",
        authorizeUrl: "",
        tokenUrl: "",
        clientIdField: auth.fields[0]?.name || "client_id",
        clientSecretField: auth.fields[1]?.name || "client_secret",
        scopes: [],
      },
      // OAuth needs exactly the user's client id + secret. Seed them if absent.
      fields: auth.fields.length ? auth.fields : [
        { name: "client_id", label: "Client ID", secret: true, required: true },
        { name: "client_secret", label: "Client Secret", secret: true, required: true },
      ],
    });
    else setAuth({ ...auth, strategy: { type: "none" } });
  };

  return (
    <div className="space-y-3">
      <Field label="Auth type">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {(["bearer", "apiKey", "basic", "oauth2", "none"] as const).map(t => (
            <button
              key={t}
              onClick={() => setStrategy(t)}
              className={`px-2.5 py-1.5 text-[11.5px] font-medium rounded-lg border transition-colors ${strategy.type === t ? IB_ACTIVE : "wf-border-subtle wf-fg-muted wf-hover-bg hover:wf-fg"}`}
            >
              {t === "bearer" ? "Bearer" : t === "apiKey" ? "API key" : t === "basic" ? "Basic" : t === "oauth2" ? "OAuth 2.0" : "None"}
            </button>
          ))}
        </div>
      </Field>

      {strategy.type === "bearer" && (
        <Grid2>
          <Field label="Token field" hint="Which auth field holds the bearer token">
            <Input value={strategy.tokenField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, tokenField: v } })} mono />
          </Field>
          <Field label="Scheme (optional)" hint="e.g. token, Bearer (default), Basic">
            <Input value={strategy.scheme || ""} onChange={v => setAuth({ ...auth, strategy: { ...strategy, scheme: v || undefined } })} placeholder="Bearer" mono />
          </Field>
        </Grid2>
      )}

      {strategy.type === "apiKey" && (
        <>
          <Grid2>
            <Field label="Key field">
              <Input value={strategy.keyField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, keyField: v } })} mono />
            </Field>
            <Field label="Sent in">
              <Select<"header"|"query">
                value={strategy.in}
                onChange={(v) => {
                  if (v === "header") setAuth({ ...auth, strategy: { type: "apiKey", keyField: strategy.keyField, in: "header", headerName: (strategy as any).headerName || "X-API-Key" } });
                  else setAuth({ ...auth, strategy: { type: "apiKey", keyField: strategy.keyField, in: "query", paramName: (strategy as any).paramName || "apikey" } });
                }}
                options={[{ value: "header", label: "Header" }, { value: "query", label: "Query param" }]}
              />
            </Field>
          </Grid2>
          {strategy.in === "header" ? (
            <Grid2>
              <Field label="Header name"><Input value={strategy.headerName} onChange={v => setAuth({ ...auth, strategy: { ...strategy, headerName: v } })} mono /></Field>
              <Field label="Value prefix (optional)" hint="e.g. Bearer, Token"><Input value={strategy.prefix || ""} onChange={v => setAuth({ ...auth, strategy: { ...strategy, prefix: v || undefined } })} mono /></Field>
            </Grid2>
          ) : (
            <Field label="Query param name"><Input value={strategy.paramName} onChange={v => setAuth({ ...auth, strategy: { ...strategy, paramName: v } })} mono /></Field>
          )}
        </>
      )}

      {strategy.type === "basic" && (
        <Grid2>
          <Field label="Username field"><Input value={strategy.userField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, userField: v } })} mono /></Field>
          <Field label="Password field"><Input value={strategy.passField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, passField: v } })} mono /></Field>
        </Grid2>
      )}

      {strategy.type === "oauth2" && (
        <div className="space-y-3">
          <Grid2>
            <Field label="Authorize URL" hint="Provider consent endpoint">
              <Input value={strategy.authorizeUrl} onChange={v => setAuth({ ...auth, strategy: { ...strategy, authorizeUrl: v } })} placeholder="https://provider.com/oauth/authorize" mono />
            </Field>
            <Field label="Token URL" hint="Code exchange + refresh">
              <Input value={strategy.tokenUrl} onChange={v => setAuth({ ...auth, strategy: { ...strategy, tokenUrl: v } })} placeholder="https://provider.com/oauth/token" mono />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="Client ID field" hint="Which field holds the client id">
              <Input value={strategy.clientIdField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, clientIdField: v } })} mono />
            </Field>
            <Field label="Client Secret field" hint="Which field holds the client secret">
              <Input value={strategy.clientSecretField} onChange={v => setAuth({ ...auth, strategy: { ...strategy, clientSecretField: v } })} mono />
            </Field>
          </Grid2>
          <Field label="Scopes" hint="Space- or comma-separated">
            <Input
              value={(strategy.scopes || []).join(" ")}
              onChange={v => setAuth({ ...auth, strategy: { ...strategy, scopes: v.split(/[\s,]+/).filter(Boolean) } })}
              placeholder="read write offline_access"
            />
          </Field>
          <Field label="Extra authorize params" hint="key=value pairs added to the consent URL (e.g. Google offline access)">
            <Input
              value={Object.entries(strategy.extraAuthParams || {}).map(([k, v]) => `${k}=${v}`).join(" ")}
              onChange={v => {
                const params: Record<string, string> = {};
                for (const pair of v.split(/[\s,]+/).filter(Boolean)) {
                  const idx = pair.indexOf("=");
                  if (idx <= 0) continue;
                  params[pair.slice(0, idx)] = pair.slice(idx + 1);
                }
                setAuth({ ...auth, strategy: { ...strategy, extraAuthParams: Object.keys(params).length ? params : undefined } });
              }}
              placeholder="access_type=offline prompt=consent"
              mono
            />
          </Field>
          <OAuthRedirectHint />
          <p className="text-[11.5px] wf-fg-muted leading-relaxed">
            <span className="wf-fg font-medium">Step 2</span> — enter the app's
            <span className="wf-fg font-medium"> client id &amp; secret</span> in the fields below.
            <span className="wf-fg font-medium"> Step 3</span> — hit <span className="wf-fg font-medium">Deploy</span>, then click the
            <span className="wf-fg font-medium"> Connect</span> button that appears to run the provider sign-in. Don't add token fields; Stuard fetches and refreshes those for you.
          </p>
          <p className="text-[11px] wf-fg-faint leading-relaxed">
            Tip: to keep access alive after the first hour you need a refresh token. For Google put
            <code className="wf-surface-muted rounded px-1 mx-0.5">access_type=offline</code> and
            <code className="wf-surface-muted rounded px-1 mx-0.5">prompt=consent</code> in <span className="wf-fg-muted font-medium">Extra authorize params</span>; for most other providers add the
            <code className="wf-surface-muted rounded px-1 mx-0.5">offline_access</code> scope above.
          </p>
        </div>
      )}

      {/* Auth fields — what we ask the user for at connect time */}
      <div className="pt-1">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11.5px] font-semibold wf-fg-muted">Fields users provide</div>
          <button
            onClick={() => setAuth({ ...auth, fields: [...auth.fields, { name: `field_${auth.fields.length + 1}`, label: "", secret: true, required: true }] })}
            className="text-[11px] flex items-center gap-1 wf-fg-muted hover:wf-fg"
          >
            <Plus className="w-3 h-3" /> Add field
          </button>
        </div>
        {auth.fields.length === 0 ? (
          <div className="text-[11.5px] wf-fg-faint italic">No fields. Add at least one for the strategy to work.</div>
        ) : (
          <div className="space-y-2">
            {auth.fields.map((f, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--wf-border)" }}>
                <Grid2>
                  <Field label="Name (id)" hint="Referenced as {{secrets.<name>}}">
                    <Input value={f.name} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, name: v.replace(/[^a-zA-Z0-9_]/g, "_") } : x) })} mono />
                  </Field>
                  <Field label="Label" hint="Shown in the connect form">
                    <Input value={f.label} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, label: v } : x) })} />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Placeholder">
                    <Input value={f.placeholder || ""} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, placeholder: v } : x) })} />
                  </Field>
                  <Field label="Hint">
                    <Input value={f.hint || ""} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, hint: v } : x) })} />
                  </Field>
                </Grid2>
                <div className="flex items-center gap-4 text-[11.5px]">
                  <Checkbox checked={f.secret} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, secret: v } : x) })} label="Secret (masked)" />
                  <Checkbox checked={f.required} onChange={v => setAuth({ ...auth, fields: auth.fields.map((x, j) => j === i ? { ...x, required: v } : x) })} label="Required" />
                  <div className="flex-1" />
                  <button onClick={() => setAuth({ ...auth, fields: auth.fields.filter((_, j) => j !== i) })} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--wf-accent)]" />
      <span className="wf-fg-muted">{label}</span>
    </label>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Hosts editor (chips)
// ════════════════════════════════════════════════════════════════════════
function HostsEditor({ hosts, setHosts }: { hosts: string[]; setHosts: (h: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (hosts.includes(v)) { setInput(""); return; }
    setHosts([...hosts, v]);
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="text-[11.5px] wf-fg-muted">
        Hostnames you'll request. Localhost &amp; private IPs are blocked unconditionally. Wildcards like <code className="wf-fg-faint">*.example.com</code> supported.
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hosts.map(h => (
          <span key={h} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border wf-border-subtle wf-fg-muted text-[11.5px] font-mono">
            {h}
            <button onClick={() => setHosts(hosts.filter(x => x !== h))} className="hover:text-rose-300">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {hosts.length === 0 && <span className="text-[11.5px] wf-fg-faint italic">No hosts yet.</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="api.example.com"
          className={`flex-1 text-[12.5px] font-mono px-3 py-2 rounded-[10px] ${IB_INPUT}`}
        />
        <button onClick={add} className={`px-3 py-2 rounded-lg text-[12px] flex items-center gap-1 ${IB_BUTTON}`}>
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tool editor
// ════════════════════════════════════════════════════════════════════════
function ToolEditor({ tool, authFields, onChange, onDelete, dark }: {
  tool: Tool;
  authFields: AuthField[];
  onChange: (t: Tool) => void;
  onDelete: () => void;
  dark: boolean;
}) {
  const [open, setOpen] = useState(true);
  const methodOptions: Array<{ value: HttpMethod; label: string }> = [
    { value: "GET", label: "GET" }, { value: "POST", label: "POST" }, { value: "PUT", label: "PUT" },
    { value: "PATCH", label: "PATCH" }, { value: "DELETE", label: "DELETE" }, { value: "HEAD", label: "HEAD" },
  ];
  return (
    <div className="wf-card rounded-[12px]">
      <div className="px-3 py-2 flex items-center gap-2">
        <button onClick={() => setOpen(o => !o)} className="wf-fg-faint">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className={`text-[10.5px] font-bold font-mono px-1.5 py-0.5 rounded ${methodColor(tool.method)}`}>{tool.method}</span>
        <input
          value={tool.name}
          onChange={(e) => onChange({ ...tool, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") })}
          placeholder="tool_name"
          className="flex-1 text-[12.5px] font-mono bg-transparent focus:outline-none wf-fg"
        />
        <button onClick={onDelete} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: "var(--wf-border)" }}>
          <div className="pt-3">
            <Field label="Description" hint="Plain English — the agent reads this">
              <Input value={tool.description} onChange={v => onChange({ ...tool, description: v })} placeholder="Create a customer in Stripe" />
            </Field>
          </div>
          <Grid2>
            <Field label="Method">
              <Select<HttpMethod> value={tool.method} onChange={(m) => onChange({ ...tool, method: m })} options={methodOptions} mono />
            </Field>
            <Field label="URL" hint="Supports {{args.x}} and {{secrets.x}}">
              <Input value={tool.urlTemplate} onChange={v => onChange({ ...tool, urlTemplate: v })} mono placeholder="https://api.example.com/path/{{args.id}}" />
            </Field>
          </Grid2>

          {/* Args */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11.5px] font-semibold wf-fg-muted">Args ({tool.args.length})</div>
              <button onClick={() => onChange({ ...tool, args: [...tool.args, { name: `arg${tool.args.length + 1}`, type: "string", required: false }] })} className="text-[11px] flex items-center gap-1 wf-fg-muted hover:wf-fg">
                <Plus className="w-3 h-3" /> Add arg
              </button>
            </div>
            {tool.args.length === 0 ? (
              <div className="text-[11.5px] wf-fg-faint italic">No args.</div>
            ) : (
              <div className="space-y-1.5">
                {tool.args.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1.5fr_1fr_auto_auto] gap-2 items-center">
                    <input
                      value={a.name}
                      onChange={(e) => onChange({ ...tool, args: tool.args.map((x, j) => j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") } : x) })}
                      placeholder="arg_name"
                      className="text-[12px] font-mono px-2 py-1.5 rounded border"
                      style={{ background: "var(--wf-bg-elevated, #141414)", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
                    />
                    <select
                      value={a.type}
                      onChange={(e) => onChange({ ...tool, args: tool.args.map((x, j) => j === i ? { ...x, type: e.target.value as ArgType } : x) })}
                      className="text-[12px] px-2 py-1.5 rounded border"
                      style={{ background: "var(--wf-bg-elevated, #141414)", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="integer">integer</option>
                      <option value="boolean">boolean</option>
                    </select>
                    <Checkbox checked={a.required} onChange={(v) => onChange({ ...tool, args: tool.args.map((x, j) => j === i ? { ...x, required: v } : x) })} label="req" />
                    <button onClick={() => onChange({ ...tool, args: tool.args.filter((_, j) => j !== i) })} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Headers + Query */}
          <Grid2>
            <KvList
              title="Headers"
              pairs={tool.headers}
              onChange={(p) => onChange({ ...tool, headers: p })}
              keyPlaceholder="Content-Type"
              valuePlaceholder="application/json"
              authFields={authFields}
            />
            <KvList
              title="Query params"
              pairs={tool.query}
              onChange={(p) => onChange({ ...tool, query: p })}
              keyPlaceholder="limit"
              valuePlaceholder="{{args.limit}}"
              authFields={authFields}
            />
          </Grid2>

          {/* Body */}
          <BodyEditor body={tool.body} setBody={(b) => onChange({ ...tool, body: b })} method={tool.method} />
        </div>
      )}
    </div>
  );
}

function methodColor(m: HttpMethod): string {
  switch (m) {
    case "GET": return "bg-blue-500/10 text-blue-300";
    case "POST": return "bg-blue-500/15 text-blue-300";
    case "PUT": return "bg-amber-500/15 text-amber-300";
    case "PATCH": return "bg-amber-500/15 text-amber-300";
    case "DELETE": return "bg-rose-500/15 text-rose-300";
    default: return "wf-fg-faint";
  }
}

function KvList({ title, pairs, onChange, keyPlaceholder, valuePlaceholder }: {
  title: string;
  pairs: KVPair[];
  onChange: (p: KVPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  authFields: AuthField[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11.5px] font-semibold wf-fg-muted">{title}</div>
        <button onClick={() => onChange([...pairs, { k: "", v: "" }])} className="text-[11px] flex items-center gap-1 wf-fg-muted hover:wf-fg">
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {pairs.length === 0 ? (
        <div className="text-[11.5px] wf-fg-faint italic">None.</div>
      ) : (
        <div className="space-y-1">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5 items-center">
              <input value={p.k} onChange={(e) => onChange(pairs.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder={keyPlaceholder} className="text-[12px] font-mono px-2 py-1.5 rounded border" style={{ background: "var(--wf-bg-elevated, #141414)", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }} />
              <input value={p.v} onChange={(e) => onChange(pairs.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder={valuePlaceholder} className="text-[12px] font-mono px-2 py-1.5 rounded border" style={{ background: "var(--wf-bg-elevated, #141414)", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }} />
              <button onClick={() => onChange(pairs.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BodyEditor({ body, setBody, method }: { body: BodyForm; setBody: (b: BodyForm) => void; method: HttpMethod }) {
  const isGetLike = method === "GET" || method === "HEAD";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[11.5px] font-semibold wf-fg-muted">Body</div>
        <select
          value={body.kind}
          onChange={(e) => {
            const k = e.target.value as BodyForm["kind"];
            if (k === "none") setBody({ kind: "none" });
            else if (k === "json") setBody({ kind: "json", valueText: "{\n  \n}" });
            else if (k === "form") setBody({ kind: "form", fields: [] });
            else setBody({ kind: "text", contentType: "text/plain", value: "" });
          }}
          className="text-[11.5px] px-2 py-1 rounded border"
          style={{ background: "var(--wf-bg-elevated, #141414)", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
        >
          <option value="none">None</option>
          <option value="json">JSON</option>
          <option value="form">Form (x-www-form-urlencoded)</option>
          <option value="text">Raw text</option>
        </select>
        {isGetLike && body.kind !== "none" && (
          <span className="text-[10.5px] text-amber-300">GET/HEAD usually have no body</span>
        )}
      </div>
      {body.kind === "json" && (
        <TextArea
          value={body.valueText}
          onChange={(v) => setBody({ kind: "json", valueText: v })}
          placeholder={`{\n  "email": "{{args.email}}"\n}`}
          rows={6}
          mono
        />
      )}
      {body.kind === "form" && (
        <KvList
          title="Form fields"
          pairs={body.fields}
          onChange={(p) => setBody({ kind: "form", fields: p })}
          keyPlaceholder="email"
          valuePlaceholder="{{args.email}}"
          authFields={[]}
        />
      )}
      {body.kind === "text" && (
        <div className="space-y-2">
          <Field label="Content-Type">
            <Input value={body.contentType} onChange={(v) => setBody({ kind: "text", contentType: v, value: body.value })} mono />
          </Field>
          <TextArea value={body.value} onChange={(v) => setBody({ kind: "text", contentType: body.contentType, value: v })} mono rows={5} />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Ping editor
// ════════════════════════════════════════════════════════════════════════
function PingEditor({ ping, setPing }: { ping?: Draft["ping"]; setPing: (p: Draft["ping"]) => void }) {
  const enabled = !!ping;
  return (
    <div className="space-y-3">
      <Checkbox
        checked={enabled}
        onChange={(v) => setPing(v ? { method: "GET", urlTemplate: "https://api.example.com/me" } : undefined)}
        label="Enable a connection-test endpoint"
      />
      {enabled && ping && (
        <Grid2>
          <Field label="Method">
            <Select<HttpMethod>
              value={ping.method}
              onChange={(m) => setPing({ ...ping, method: m })}
              options={[{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }, { value: "HEAD", label: "HEAD" }]}
            />
          </Field>
          <Field label="URL">
            <Input value={ping.urlTemplate} onChange={(v) => setPing({ ...ping, urlTemplate: v })} mono />
          </Field>
        </Grid2>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// JSON view (read-only preview + copy + paste-import)
// ════════════════════════════════════════════════════════════════════════
function JsonView({ draft, setDraft, dark }: { draft: Draft; setDraft: (d: Draft) => void; dark: boolean }) {
  const text = useMemo(() => JSON.stringify(toManifest(draft), null, 2), [draft]);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState(text);
  const [pasteErr, setPasteErr] = useState<string | null>(null);

  useEffect(() => { if (!pasteMode) setPasteText(text); }, [text, pasteMode]);

  const applyPaste = () => {
    try {
      const m = JSON.parse(pasteText);
      setDraft(fromManifest(m));
      setPasteMode(false);
      setPasteErr(null);
    } catch (e: any) {
      setPasteErr(e?.message || "Invalid JSON");
    }
  };

  return (
    <div className="p-4 flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11.5px] font-semibold wf-fg-muted uppercase tracking-wider flex items-center gap-1.5">
          <FileJson className="w-3.5 h-3.5" /> Manifest JSON
        </div>
        <div className="flex items-center gap-2">
          {pasteMode ? (
            <>
              <button onClick={applyPaste} className="text-[11.5px] px-2 py-1 rounded wf-primary-btn flex items-center gap-1"><Check className="w-3 h-3" /> Apply</button>
              <button onClick={() => { setPasteMode(false); setPasteErr(null); }} className="text-[11.5px] px-2 py-1 rounded wf-fg-muted hover:wf-fg">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => { try { navigator.clipboard.writeText(text); } catch {} }} className="text-[11.5px] flex items-center gap-1 wf-fg-muted hover:wf-fg"><Copy className="w-3 h-3" /> Copy</button>
              <button onClick={() => { setPasteText(text); setPasteMode(true); }} className={`text-[11.5px] px-2 py-1 rounded ${IB_BUTTON}`}>Edit JSON</button>
            </>
          )}
        </div>
      </div>
      {pasteErr && <div className="mb-2 p-2 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-[12px]">{pasteErr}</div>}
      <textarea
        value={pasteMode ? pasteText : text}
        onChange={(e) => pasteMode && setPasteText(e.target.value)}
        readOnly={!pasteMode}
        spellCheck={false}
        className="flex-1 w-full p-3 font-mono text-[12.5px] leading-[1.55] rounded-lg border resize-none focus:outline-none"
        style={{ background: dark ? "#0f0f0f" : "#fafafa", borderColor: "var(--wf-border)", color: "var(--wf-fg)", tabSize: 2 }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Test pane
// ════════════════════════════════════════════════════════════════════════
function TestPane({ dark, draft, secrets, setSecrets, selectedTool, setSelectedTool, argValues, setArgValues, busy, result, runError, onRun, onPing }: {
  dark: boolean;
  draft: Draft;
  secrets: Record<string, string>;
  setSecrets: (fn: ((s: Record<string, string>) => Record<string, string>) | Record<string, string>) => void;
  selectedTool: string;
  setSelectedTool: (s: string) => void;
  argValues: Record<string, any>;
  setArgValues: (fn: ((s: Record<string, any>) => Record<string, any>) | Record<string, any>) => void;
  busy: boolean;
  result: any;
  runError: string | null;
  onRun: () => void;
  onPing: () => void;
}) {
  const activeTool = draft.tools.find(t => t.name === selectedTool);
  return (
    <div className="flex flex-col min-h-0 overflow-auto custom-scrollbar flex-1">
      {/* Credentials */}
      <div className="p-4 space-y-3 border-b wf-border-subtle">
        <div className="text-[11px] font-semibold wf-fg-muted uppercase tracking-wider">Credentials (memory-only)</div>
        {draft.auth.fields.length === 0 ? (
          <div className="text-[12px] wf-fg-faint italic">No auth fields declared. Add some in the <strong>Authentication</strong> section on the left.</div>
        ) : draft.auth.fields.map(f => (
          <div key={f.name} className="space-y-1">
            <label className="text-[11px] font-medium wf-fg-muted flex items-center gap-1.5">
              <span>{f.label || f.name}</span>
              {f.required && <span className="text-rose-400">*</span>}
              <code className="text-[10px] opacity-60">{`{{secrets.${f.name}}}`}</code>
            </label>
            <input
              type={f.secret === false ? "text" : "password"}
              placeholder={f.placeholder || ""}
              value={secrets[f.name] || ""}
              onChange={(e) => setSecrets({ ...secrets, [f.name]: e.target.value })}
              className={`w-full text-[12.5px] font-mono px-3 py-2 rounded-lg ${IB_INPUT}`}
              style={{ background: dark ? "#141414" : "#fff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
            />
            {f.hint && <div className="text-[10.5px] wf-fg-faint">{f.hint}</div>}
          </div>
        ))}
      </div>

      {/* Call */}
      <div className="p-4 space-y-3 border-b wf-border-subtle">
        <div className="text-[11px] font-semibold wf-fg-muted uppercase tracking-wider">Call</div>
        <Field label="Tool">
          <select
            value={selectedTool}
            onChange={(e) => setSelectedTool(e.target.value)}
            className="w-full text-[12.5px] px-3 py-2 rounded-lg border"
            style={{ background: dark ? "#141414" : "#fff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
            disabled={!draft.tools.length}
          >
            {!draft.tools.length && <option value="">(add a tool first)</option>}
            {draft.tools.map(t => (
              <option key={t.name} value={t.name}>{t.method}  {t.name}</option>
            ))}
          </select>
        </Field>

        {/* Args form auto-generated from selected tool */}
        {activeTool && activeTool.args.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-medium wf-fg-muted">Args</div>
            {activeTool.args.map(a => (
              <ArgInput
                key={a.name}
                arg={a}
                value={argValues[a.name]}
                onChange={(v) => setArgValues({ ...argValues, [a.name]: v })}
                dark={dark}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onRun}
            disabled={busy || !activeTool}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold flex items-center gap-1.5 wf-primary-btn disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run
          </button>
          <button
            onClick={onPing}
            disabled={busy || !draft.ping}
            className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold flex items-center gap-1.5 ${IB_BUTTON}`}
            title={draft.ping ? "Run the ping probe" : "Enable a ping probe in the form to use this"}
          >
            <Wand2 className="w-3.5 h-3.5" /> Ping
          </button>
        </div>
      </div>

      {/* Response */}
      <div className="p-4 flex-1 min-h-0 flex flex-col">
        <div className="text-[11px] font-semibold wf-fg-muted uppercase tracking-wider mb-2 flex items-center justify-between">
          <span>Response</span>
          {result != null && (
            <button onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(result, null, 2)); } catch {} }} className="text-[10.5px] wf-fg-faint hover:wf-fg flex items-center gap-1">
              <Copy className="w-3 h-3" /> copy
            </button>
          )}
        </div>
        {runError && (
          <div className="text-[12px] mb-2 p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 break-words whitespace-pre-wrap font-mono max-h-[260px] overflow-auto">
            <div className="flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{runError}</span>
            </div>
          </div>
        )}
        {result != null ? <ResponseView result={result} dark={dark} /> : (
          <div className="text-[12px] wf-fg-faint italic">Run a tool to see the response.</div>
        )}
      </div>
    </div>
  );
}

function ArgInput({ arg, value, onChange, dark }: { arg: ToolArg; value: any; onChange: (v: any) => void; dark: boolean }) {
  const baseStyle = { background: dark ? "#141414" : "#fff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" };
  const icon =
    arg.type === "boolean" ? <ToggleLeft className="w-3 h-3" /> :
    arg.type === "string" ? <AlignLeft className="w-3 h-3" /> :
    <Hash className="w-3 h-3" />;
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium wf-fg-muted flex items-center gap-1.5">
        {icon}
        <code className="font-mono">{arg.name}</code>
        <span className="opacity-60">{arg.type}</span>
        {arg.required && <span className="text-rose-400">*</span>}
      </label>
      {arg.description && <div className="text-[10.5px] wf-fg-faint">{arg.description}</div>}
      {arg.type === "boolean" ? (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")} className="w-full text-[12.5px] px-3 py-2 rounded-lg border" style={baseStyle}>
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          type={arg.type === "number" || arg.type === "integer" ? "number" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full text-[12.5px] font-mono px-3 py-2 rounded-lg ${IB_INPUT}`}
          style={baseStyle}
        />
      )}
    </div>
  );
}

function ResponseView({ result, dark }: { result: any; dark: boolean }) {
  const txt = JSON.stringify(result, null, 2);
  const status = typeof result?.status === "number" ? result.status : null;
  const ok = result?.ok === true;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-2 text-[11px] wf-fg-muted">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${ok ? "wf-surface-muted wf-fg" : "bg-rose-500/15 text-rose-300"}`}>{ok ? "OK" : "ERR"}</span>
        {status !== null && <span>HTTP {status}</span>}
        {typeof result?.elapsed_ms === "number" && <span>{result.elapsed_ms} ms</span>}
      </div>
      <pre className="flex-1 overflow-auto font-mono text-[12px] leading-[1.55] p-3 rounded-lg border" style={{ background: dark ? "#0f0f0f" : "#fafafa", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}>
{txt}
      </pre>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AI Assistant pane — streamed chain-of-thought with web_search/scrape_url
// ════════════════════════════════════════════════════════════════════════
function AIPane({
  dark,
  messages,
  input,
  setInput,
  onSend,
  onStop,
  busy,
  error,
  selectedModelId,
  onSelectModel,
  modelSource,
  onModelSourceChange,
  reasoningLevel,
  onReasoningLevelChange,
}: {
  dark: boolean;
  messages: AiMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  error: string | null;
  selectedModelId: string | "auto";
  onSelectModel: (id: string | "auto") => void;
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
}) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const SUGGESTIONS = [
    "Look up Resend's API and add a send_email tool",
    "Why might my Run return HTTP 422?",
    "Add a created_after query arg to the list tool",
    "Add a ping endpoint that hits /me",
  ];

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div ref={scrollerRef} className="flex-1 overflow-auto custom-scrollbar p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="text-[13px] wf-fg-muted leading-[1.55]">
              I can research APIs on the web, build tools, fix manifests, and explain errors. I see your current draft, so reference it directly — "look up Notion's API and add a search_pages tool", "the URL for create_subscription is wrong, fix it", etc.
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-[11.5px] px-2.5 py-1.5 rounded-lg border wf-border-subtle wf-fg-muted hover:wf-fg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((m, i) => (
          <AiMessageRow key={i} msg={m} dark={dark} />
        ))}
        {error && (
          <div className="text-[12px] p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 whitespace-pre-wrap font-mono">
            {error}
          </div>
        )}
      </div>

      <div className="border-t wf-border-subtle p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10.5px] wf-fg-faint">Uses the same model selector as Workflow AI.</div>
          <ModelSelector
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            modelSource={modelSource}
            onModelSourceChange={onModelSourceChange}
            reasoningLevel={reasoningLevel}
            onReasoningLevelChange={onReasoningLevelChange}
            side="top"
            align="end"
            variant="glass"
            portal
            panelWidth={340}
          />
        </div>
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !busy) { e.preventDefault(); onSend(); }
            }}
            placeholder="Ask the assistant to add a tool, look up a doc, or fix an error…"
            rows={2}
            className={`w-full text-[12.5px] px-3 py-2 pr-12 rounded-xl ${IB_INPUT} resize-none`}
            style={{ background: dark ? "#141414" : "#fff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
          />
          {busy ? (
            <button
              onClick={onStop}
              className="absolute right-2 bottom-2 p-1.5 rounded-lg wf-bg-overlay border wf-border-subtle wf-fg-muted hover:wf-fg"
              title="Stop"
            >
              <span className="block w-3 h-3" style={{ background: "currentColor" }} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim()}
              className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              title="Send (Enter)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[10.5px] wf-fg-faint">Researches with web search + scrape, then edits the manifest in place — review and Save.</div>
      </div>
    </div>
  );
}

function AiMessageRow({ msg, dark }: { msg: AiMessage; dark: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[88%] px-3 py-2 rounded-2xl rounded-br-md text-[12.5px] leading-[1.5] whitespace-pre-wrap break-words border"
          style={{
            background: "color-mix(in srgb, var(--wf-fg, #fff) 10%, transparent)",
            borderColor: "var(--wf-border)",
            color: "var(--wf-fg)",
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }
  return <AssistantTurn msg={msg} dark={dark} />;
}

function AssistantTurn({ msg, dark }: { msg: AiAssistantMsg; dark: boolean }) {
  const traceSteps = useMemo(() => msg.parts.filter((p) => p.kind === "reasoning" || p.kind === "tool"), [msg.parts]);
  const hasTrace = traceSteps.length > 0 || msg.isStreaming;
  const durationSec = msg.finishedAt ? Math.max(1, Math.round((msg.finishedAt - msg.startedAt) / 1000)) : null;
  const headerLabel = msg.isStreaming
    ? "Thinking…"
    : durationSec != null
      ? `Thought for ${durationSec < 60 ? `${durationSec}s` : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`}`
      : "Thought";

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-semibold wf-fg-muted uppercase tracking-wider">
        Assistant
      </div>

      {hasTrace && (
        <ChainOfThought defaultOpen={msg.isStreaming ?? false} className="w-full">
          <ChainOfThoughtHeader>
            <span className="text-[12px] wf-fg-muted flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" />
              {msg.isStreaming ? <Shimmer as="span" duration={2.4} spread={3}>{headerLabel}</Shimmer> : headerLabel}
            </span>
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {traceSteps.length === 0 && msg.isStreaming && (
              <ChainOfThoughtStep status="active" isLast label={<Shimmer as="span" duration={2.4} spread={3}>Reading the manifest…</Shimmer>} />
            )}
            {traceSteps.map((part, i) => {
              const isLast = i === traceSteps.length - 1;
              if (part.kind === "reasoning") {
                const isActive = msg.isStreaming && isLast;
                const label = summarizeReasoning(part.text);
                return (
                  <ChainOfThoughtStep
                    key={`r-${i}`}
                    status={isActive ? "active" : "complete"}
                    isLast={isLast}
                    label={isActive ? <Shimmer as="span" duration={2.4} spread={3}>{label}</Shimmer> : label}
                  >
                    {part.text && (
                      <div
                        className="scrollbar-none max-h-40 overflow-y-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed"
                        style={{
                          background: "color-mix(in srgb, var(--wf-fg, #fff) 6%, transparent)",
                          color: "color-mix(in srgb, var(--wf-fg, #fff) 70%, transparent)",
                        }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                      </div>
                    )}
                  </ChainOfThoughtStep>
                );
              }
              // tool
              return (
                <ChainOfThoughtStep
                  key={part.id || `t-${i}`}
                  status={part.status === "running" ? "active" : part.status === "error" ? "error" : "complete"}
                  isLast={isLast}
                  label={
                    part.status === "running" && msg.isStreaming
                      ? <Shimmer as="span" duration={2.4} spread={3}>{renderToolLabel(part) as any}</Shimmer>
                      : (renderToolLabel(part) as any)
                  }
                >
                  <ToolStepBody part={part} />
                </ChainOfThoughtStep>
              );
            })}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}

      {msg.text && !msg.isStreaming && (
        <div
          className="text-[13px] leading-[1.6] wf-fg rounded-xl px-3 py-2.5 prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-[13px] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[11px]"
          style={{ background: dark ? "#141414" : "#f4f4f5" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
        </div>
      )}

      {msg.isStreaming && msg.text && (
        <div
          className="text-[13px] leading-[1.6] wf-fg-muted rounded-xl px-3 py-2.5 whitespace-pre-wrap break-words"
          style={{ background: dark ? "#141414" : "#f4f4f5" }}
        >
          {msg.text}
          <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "currentColor", opacity: 0.6 }} />
        </div>
      )}
    </div>
  );
}

function summarizeReasoning(content: string): string {
  const plain = content.replace(/\s+/g, " ").trim();
  if (!plain) return "Reasoning";
  const first = plain.split(/[.?!]/)[0]?.trim() || plain;
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
}

function renderToolLabel(part: Extract<AssistantPart, { kind: "tool" }>): React.ReactNode {
  const a = part.args && typeof part.args === "object" ? part.args : {};
  if (part.name === "web_search") {
    const q = typeof a.query === "string" ? a.query : "";
    return (
      <span className="flex items-center gap-1.5">
        <Search className="w-3 h-3 wf-fg-faint" />
        {q ? <>Searched the web for <code className="wf-bg-overlay wf-fg-muted px-1 py-[1px] rounded-md text-[10.5px] font-mono align-baseline">{truncate(q, 56)}</code></> : "Searched the web"}
      </span>
    );
  }
  if (part.name === "scrape_url") {
    let urls: string[] = [];
    if (typeof a.urls === "string") urls = [a.urls];
    else if (Array.isArray(a.urls)) urls = a.urls.map((u: any) => String(u));
    const host = urls[0] ? (() => { try { return new URL(urls[0]).hostname.replace(/^www\./, ""); } catch { return urls[0]; } })() : "";
    const more = urls.length > 1 ? ` +${urls.length - 1}` : "";
    return (
      <span className="flex items-center gap-1.5">
        <Link2 className="w-3 h-3 wf-fg-faint" />
        {host ? <>Scraped <code className="wf-bg-overlay wf-fg-muted px-1 py-[1px] rounded-md text-[10.5px] font-mono align-baseline">{host}{more}</code></> : "Scraped page"}
      </span>
    );
  }
  return <span>{part.name || "Tool"}</span>;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ToolStepBody({ part }: { part: Extract<AssistantPart, { kind: "tool" }> }) {
  if (part.status === "running") return null;
  const r = part.result;
  if (!r) return null;

  if (part.name === "web_search" && Array.isArray(r.results) && r.results.length > 0) {
    return (
      <div className="space-y-1 mt-0.5">
        {r.results.slice(0, 5).map((item: any, i: number) => (
          <a
            key={i}
            href={item.url}
            onClick={(e) => { e.preventDefault(); try { (window as any).desktopAPI?.openExternal?.(item.url); } catch {} }}
            className="block text-[11px] rounded-md px-2 py-1.5 border wf-border-subtle wf-hover-bg group"
          >
            <div className="font-medium wf-fg truncate">{item.title || item.url}</div>
            {item.snippet && <div className="wf-fg-muted text-[10.5px] line-clamp-2 mt-0.5">{item.snippet}</div>}
            <div className="wf-fg-faint text-[10px] font-mono truncate mt-0.5 flex items-center gap-1">
              <ExternalLink className="w-2.5 h-2.5" />
              {(() => { try { return new URL(item.url).hostname.replace(/^www\./, "") + new URL(item.url).pathname; } catch { return item.url; } })()}
            </div>
          </a>
        ))}
      </div>
    );
  }

  if (part.name === "scrape_url" && Array.isArray(r.results)) {
    return (
      <div className="space-y-1 mt-0.5">
        {r.results.map((item: any, i: number) => {
          const host = (() => { try { return new URL(item.url).hostname.replace(/^www\./, ""); } catch { return item.url; } })();
          const preview = String(item.content || "").slice(0, 240);
          return (
            <div key={i} className="text-[11px] rounded-md px-2 py-1.5 border wf-border-subtle">
              <div className="font-mono text-[10px] wf-fg-muted truncate">{host}</div>
              {preview && <div className="wf-fg-faint text-[10.5px] mt-1 line-clamp-3">{preview}{item.truncated ? "…" : ""}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  if (r.error) {
    return (
      <div className="text-[11px] rounded-md px-2 py-1.5 bg-rose-500/10 border border-rose-500/25 text-rose-300 flex gap-1.5">
        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
        <span>{String(r.error)}</span>
      </div>
    );
  }
  return null;
}
