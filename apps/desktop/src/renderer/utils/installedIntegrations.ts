/**
 * Client for deployed custom integrations (the secure server-side store added
 * in cloud-ai: custom_integrations table + /v1/integrations/installed routes).
 *
 * Shared by the Integration Builder (deploy/uninstall), the workflow tool
 * palette, and the bot tool picker so all three surfaces see the same set of
 * the user's deployed integration tools. Manifests come back without secrets.
 */
import { supabase } from "../lib/supabaseClient";
import { getCloudAiHttp } from "./cloud";

export interface InstalledIntegration {
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  category: string | null;
  version: string;
  manifest: any;
  enabled: boolean;
  configuredSecrets: string[];
  createdAt: string;
  updatedAt: string;
}

/** One compiled tool derived from an integration manifest, for palettes/pickers. */
export interface InstalledToolEntry {
  /** Compiled tool name `${slug}_${tool}` — what the agent/workflow calls. */
  name: string;
  slug: string;
  toolName: string;
  label: string;
  description: string;
  category: string;
  icon: string | null;
  /** JSON-schema args (manifest tool args). */
  args: any;
}

async function getToken(): Promise<string | null> {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || null; }
  catch { return null; }
}

/** Mirror of compiledToolName() in cloud-ai/src/integrations/compile-tools.ts. */
export function compiledToolName(slug: string, toolName: string): string {
  const frag = (s: string) => String(s || "").toLowerCase().replace(/-/g, "_").replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${frag(slug)}_${frag(toolName)}`;
}

export async function fetchInstalledIntegrations(): Promise<InstalledIntegration[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    const r = await fetch(`${getCloudAiHttp()}/v1/integrations/installed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const json = await r.json().catch(() => null);
    const integrations: InstalledIntegration[] = Array.isArray(json?.integrations) ? json.integrations : [];
    // Keep the main process in sync so execTool routes these tool names to
    // cloud-ai and the bot tool picker can list them.
    try {
      const names = toToolEntries(integrations).map((t) => t.name);
      (window as any).desktopAPI?.integrationsSyncToolNames?.(names);
    } catch { /* main process unavailable (web build) */ }
    return integrations;
  } catch { return []; }
}

/** Deploy (upsert) an integration manifest + secrets to the secure store. */
export async function deployIntegration(manifest: any, secrets: Record<string, string>, enabled = true): Promise<{ ok: boolean; error?: string; integration?: InstalledIntegration }> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not signed in." };
  try {
    const r = await fetch(`${getCloudAiHttp()}/v1/integrations/installed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, secrets, enabled }),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json?.ok) return { ok: false, error: json?.detail || json?.error || `HTTP ${r.status}` };
    return { ok: true, integration: json.integration };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function setIntegrationEnabled(slug: string, enabled: boolean): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const r = await fetch(`${getCloudAiHttp()}/v1/integrations/installed/${encodeURIComponent(slug)}/enabled`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    return r.ok;
  } catch { return false; }
}

export async function uninstallIntegration(slug: string): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const r = await fetch(`${getCloudAiHttp()}/v1/integrations/installed/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch { return false; }
}

/** Flatten enabled integrations into compiled tool entries for palettes/pickers. */
export function toToolEntries(integrations: InstalledIntegration[]): InstalledToolEntry[] {
  const out: InstalledToolEntry[] = [];
  for (const integ of integrations) {
    if (!integ.enabled) continue;
    const tools = Array.isArray(integ.manifest?.tools) ? integ.manifest.tools : [];
    for (const t of tools) {
      if (!t?.name) continue;
      out.push({
        name: compiledToolName(integ.slug, t.name),
        slug: integ.slug,
        toolName: t.name,
        label: `${integ.name || integ.slug}: ${t.name}`,
        description: t.description || "",
        category: integ.category || "Integrations",
        icon: integ.icon ?? null,
        args: t.args || { type: "object", properties: {} },
      });
    }
  }
  return out;
}
