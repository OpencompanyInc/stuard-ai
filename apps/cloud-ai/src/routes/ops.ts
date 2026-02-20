/**
 * Ops Dashboard API Routes
 * 
 * Admin-only endpoints for deployment management, beta access control,
 * and system monitoring.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { verifyToken, getSupabaseService } from "../supabase";
import { ENVIRONMENT, IS_PRODUCTION, PORT, CLOUD_PUBLIC_URL } from "../utils/config";

function json(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

async function requireAdmin(req: IncomingMessage): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "unauthorized" };
  }

  const token = authHeader.slice(7);
  const user = await verifyToken(token);
  if (!user?.email) {
    return { ok: false, error: "unauthorized" };
  }

  const email = user.email.toLowerCase();
  const supabase = getSupabaseService();
  if (!supabase) {
    return { ok: false, error: "service_unavailable" };
  }

  // Check if user has 'all' access (admin)
  const { data } = await supabase
    .from("beta_users")
    .select("access_level")
    .eq("email", email)
    .single();

  if (data?.access_level !== "all") {
    return { ok: false, error: "forbidden" };
  }

  return { ok: true, email };
}

export async function handleOpsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const path = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/status - Get current environment status
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/status" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      json(res, 200, {
        ok: true,
        environment: ENVIRONMENT,
        isProduction: IS_PRODUCTION,
        port: PORT,
        publicUrl: CLOUD_PUBLIC_URL,
        nodeEnv: process.env.NODE_ENV,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (err: any) {
      console.error("Ops status error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/beta-users - List all beta users
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/beta-users" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const { data, error } = await supabase
        .from("beta_users")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, { ok: true, users: data || [] });
      return true;
    } catch (err: any) {
      console.error("List beta users error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/ops/beta-users - Add/update beta user
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/beta-users" && req.method === "POST") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const body = await readBody(req);
      const email = body.email?.toLowerCase()?.trim();
      const access_level = String(body.access_level || "beta").trim().toLowerCase();
      const notes = body.notes || null;
      const expires_at = body.expires_at || null;

      if (!email) {
        json(res, 400, { ok: false, error: "email_required" });
        return true;
      }

      if (!["beta", "staging", "all"].includes(access_level)) {
        json(res, 400, { ok: false, error: "invalid_access_level" });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const { data, error } = await supabase
        .from("beta_users")
        .upsert(
          {
            email,
            access_level,
            invited_by: auth.email,
            notes,
            expires_at,
          },
          { onConflict: "email" }
        )
        .select()
        .single();

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, { ok: true, user: data });
      return true;
    } catch (err: any) {
      console.error("Add beta user error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /v1/ops/beta-users/:email - Remove beta user
  // ─────────────────────────────────────────────────────────────────────────
  if (path.startsWith("/v1/ops/beta-users/") && req.method === "DELETE") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const email = decodeURIComponent(path.split("/v1/ops/beta-users/")[1] || "").toLowerCase().trim();
      if (!email) {
        json(res, 400, { ok: false, error: "email_required" });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const { error } = await supabase
        .from("beta_users")
        .delete()
        .eq("email", email);

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, { ok: true });
      return true;
    } catch (err: any) {
      console.error("Delete beta user error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  if (path === "/v1/ops/waitlist" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const q = (searchParams.get("q") || "").trim();
      const limitRaw = Number(searchParams.get("limit") || 50);
      const offsetRaw = Number(searchParams.get("offset") || 0);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

      let query = supabase
        .from("waitlist")
        .select("id,email,name,company,use_case,referral_source,position,created_at,notified", { count: "exact" })
        .order("created_at", { ascending: false });

      if (q) {
        const esc = q.replace(/%/g, "\\%").replace(/,/g, " ");
        query = query.or(
          `email.ilike.%${esc}%,name.ilike.%${esc}%,company.ilike.%${esc}%,use_case.ilike.%${esc}%,referral_source.ilike.%${esc}%`
        );
      }

      const { data, error, count } = await query.range(offset, offset + limit - 1);

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, {
        ok: true,
        entries: data || [],
        total: count || 0,
        limit,
        offset,
      });
      return true;
    } catch (err: any) {
      console.error("List waitlist error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  if (path === "/v1/ops/waitlist/promote" && req.method === "POST") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const body = await readBody(req);
      const email = body.email?.toLowerCase()?.trim();
      const access_level = String(body.access_level || "beta").trim().toLowerCase();
      const notes = body.notes || null;
      const expires_at = body.expires_at || null;
      const removeFromWaitlist = body.removeFromWaitlist !== false;
      const markNotified = body.markNotified === true;

      if (!email) {
        json(res, 400, { ok: false, error: "email_required" });
        return true;
      }

      if (!["beta", "staging", "all"].includes(access_level)) {
        json(res, 400, { ok: false, error: "invalid_access_level" });
        return true;
      }

      const { data: waitlistEntry, error: waitlistError } = await supabase
        .from("waitlist")
        .select("id,email,name,company,use_case,referral_source,position,created_at,notified")
        .eq("email", email)
        .maybeSingle();

      if (waitlistError) {
        json(res, 500, { ok: false, error: waitlistError.message });
        return true;
      }

      if (!waitlistEntry) {
        json(res, 404, { ok: false, error: "waitlist_entry_not_found" });
        return true;
      }

      const { data: betaUser, error: betaError } = await supabase
        .from("beta_users")
        .upsert(
          {
            email,
            access_level,
            invited_by: auth.email,
            notes,
            expires_at,
          },
          { onConflict: "email" }
        )
        .select()
        .single();

      if (betaError) {
        json(res, 500, { ok: false, error: betaError.message });
        return true;
      }

      let waitlistAction: { ok: boolean; action: string; error?: string } = { ok: true, action: "none" };
      if (removeFromWaitlist) {
        const { error } = await supabase.from("waitlist").delete().eq("id", waitlistEntry.id);
        if (error) waitlistAction = { ok: false, action: "delete", error: error.message };
        else waitlistAction = { ok: true, action: "delete" };
      } else if (markNotified) {
        const { error } = await supabase.from("waitlist").update({ notified: true }).eq("id", waitlistEntry.id);
        if (error) waitlistAction = { ok: false, action: "mark_notified", error: error.message };
        else waitlistAction = { ok: true, action: "mark_notified" };
      }

      json(res, 200, {
        ok: true,
        user: betaUser,
        waitlistEntry,
        waitlistAction,
      });
      return true;
    } catch (err: any) {
      console.error("Promote waitlist error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/sync-systems - Get sync system health and stats
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/sync-systems" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      // Gather stats from all sync-related tables in parallel
      const [
        sharedSpacesResult,
        memoryOutboxResult,
        webhooksResult,
        webhookEventsResult,
        webhookQueueResult,
        devicesResult,
        conversationsResult,
        messagesResult,
        marketplaceResult,
        feedbackResult,
      ] = await Promise.all([
        supabase.from("shared_spaces").select("id, synced_at", { count: "exact", head: false }).order("synced_at", { ascending: false }).limit(5),
        supabase.from("memory_outbox").select("id, status, attempts, created_at", { count: "exact", head: false }),
        supabase.from("webhooks").select("id, is_active, trigger_count", { count: "exact", head: false }),
        supabase.from("webhook_events").select("id, status, created_at", { count: "exact", head: false }).order("created_at", { ascending: false }).limit(10),
        supabase.from("webhook_queue").select("id, status", { count: "exact", head: false }).eq("status", "pending"),
        supabase.from("devices").select("id, status, last_seen_at, platform", { count: "exact", head: false }),
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase.from("messages").select("id", { count: "exact", head: true }),
        supabase.from("marketplace_workflows").select("id, download_count", { count: "exact", head: false }),
        supabase.from("feedback").select("id, type, status", { count: "exact", head: false }),
      ]);

      // Calculate memory outbox stats
      const memoryOutboxData = memoryOutboxResult.data || [];
      const pendingOutbox = memoryOutboxData.filter((m: any) => m.status === "pending").length;
      const failedOutbox = memoryOutboxData.filter((m: any) => m.status === "failed").length;

      // Calculate webhook stats
      const webhooksData = webhooksResult.data || [];
      const activeWebhooks = webhooksData.filter((w: any) => w.is_active).length;
      const totalTriggers = webhooksData.reduce((sum: number, w: any) => sum + (w.trigger_count || 0), 0);

      // Calculate webhook events by status
      const webhookEventsData = webhookEventsResult.data || [];
      const eventsByStatus: Record<string, number> = {};
      webhookEventsData.forEach((e: any) => {
        eventsByStatus[e.status] = (eventsByStatus[e.status] || 0) + 1;
      });

      // Calculate device stats
      const devicesData = devicesResult.data || [];
      const onlineDevices = devicesData.filter((d: any) => d.status === "online").length;
      const platformCounts: Record<string, number> = {};
      devicesData.forEach((d: any) => {
        if (d.platform) platformCounts[d.platform] = (platformCounts[d.platform] || 0) + 1;
      });

      // Calculate marketplace stats
      const marketplaceData = marketplaceResult.data || [];
      const totalDownloads = marketplaceData.reduce((sum: number, w: any) => sum + (w.download_count || 0), 0);

      // Calculate feedback stats
      const feedbackData = feedbackResult.data || [];
      const openBugs = feedbackData.filter((f: any) => f.type === "bug" && f.status === "open").length;
      const openFeatures = feedbackData.filter((f: any) => f.type === "feature" && f.status === "open").length;

      json(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        systems: {
          sharedSpaces: {
            status: "operational",
            total: sharedSpacesResult.count || 0,
            recentSync: sharedSpacesResult.data?.[0]?.synced_at || null,
          },
          memoryOutbox: {
            status: failedOutbox > 10 ? "degraded" : "operational",
            total: memoryOutboxResult.count || 0,
            pending: pendingOutbox,
            failed: failedOutbox,
          },
          webhooks: {
            status: "operational",
            total: webhooksResult.count || 0,
            active: activeWebhooks,
            totalTriggers,
            pendingDeliveries: webhookQueueResult.count || 0,
            recentEventsByStatus: eventsByStatus,
          },
          devices: {
            status: "operational",
            total: devicesResult.count || 0,
            online: onlineDevices,
            byPlatform: platformCounts,
          },
          conversations: {
            status: "operational",
            total: conversationsResult.count || 0,
            messages: messagesResult.count || 0,
          },
          marketplace: {
            status: "operational",
            workflows: marketplaceResult.count || 0,
            totalDownloads,
          },
          feedback: {
            status: "operational",
            total: feedbackResult.count || 0,
            openBugs,
            openFeatures,
          },
        },
      });
      return true;
    } catch (err: any) {
      console.error("Sync systems status error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/database-stats - Get database table statistics
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/database-stats" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      // Get counts for all main tables
      const tables = [
        "profiles", "conversations", "messages", "devices", "usage_events",
        "shared_spaces", "space_shares", "memory_outbox",
        "webhooks", "webhook_events", "webhook_providers", "webhook_queue",
        "marketplace_workflows", "marketplace_ratings", "marketplace_downloads",
        "external_accounts", "beta_users", "waitlist", "feedback", "feedback_comments"
      ];

      const counts: Record<string, number> = {};
      
      await Promise.all(
        tables.map(async (table) => {
          try {
            const { count } = await supabase.from(table).select("id", { count: "exact", head: true });
            counts[table] = count || 0;
          } catch {
            counts[table] = -1; // Table might not exist
          }
        })
      );

      json(res, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        tables: counts,
      });
      return true;
    } catch (err: any) {
      console.error("Database stats error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/analytics - Time-series analytics for dashboard charts
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/analytics" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const days = Math.min(90, Math.max(1, Number(searchParams.get("days") || 30)));
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const [profilesRes, convsRes, usageRes, msgsRes, profilesTotal, convsTotal, msgsTotal] = await Promise.all([
        supabase.from("profiles").select("created_at").gte("created_at", since),
        supabase.from("conversations").select("created_at, model").gte("created_at", since),
        supabase.from("usage_events").select("model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at").gte("created_at", since),
        supabase.from("messages").select("created_at, role").gte("created_at", since),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase.from("messages").select("id", { count: "exact", head: true }),
      ]);

      function groupByDay(items: any[], dateField = "created_at") {
        const map: Record<string, number> = {};
        for (const item of items || []) {
          const d = item[dateField]?.slice(0, 10);
          if (d) map[d] = (map[d] || 0) + 1;
        }
        // Fill missing days with 0
        const result: { date: string; count: number }[] = [];
        const start = new Date(since);
        const end = new Date();
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          result.push({ date: key, count: map[key] || 0 });
        }
        return result;
      }

      // Model breakdown from usage_events
      const modelMap: Record<string, { tokens: number; cost: number; count: number; promptTokens: number; completionTokens: number }> = {};
      for (const u of usageRes.data || []) {
        const m = u.model || "unknown";
        if (!modelMap[m]) modelMap[m] = { tokens: 0, cost: 0, count: 0, promptTokens: 0, completionTokens: 0 };
        modelMap[m].tokens += u.total_tokens || 0;
        modelMap[m].cost += Number(u.cost_usd) || 0;
        modelMap[m].count += 1;
        modelMap[m].promptTokens += u.prompt_tokens || 0;
        modelMap[m].completionTokens += u.completion_tokens || 0;
      }

      // Usage trend by day
      const usageByDay: Record<string, { tokens: number; cost: number; requests: number }> = {};
      for (const u of usageRes.data || []) {
        const d = u.created_at?.slice(0, 10);
        if (d) {
          if (!usageByDay[d]) usageByDay[d] = { tokens: 0, cost: 0, requests: 0 };
          usageByDay[d].tokens += u.total_tokens || 0;
          usageByDay[d].cost += Number(u.cost_usd) || 0;
          usageByDay[d].requests += 1;
        }
      }

      // Fill missing days for usage trend
      const usageTrend: { date: string; tokens: number; cost: number; requests: number }[] = [];
      const startDate = new Date(since);
      const endDate = new Date();
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        usageTrend.push({ date: key, tokens: usageByDay[key]?.tokens || 0, cost: usageByDay[key]?.cost || 0, requests: usageByDay[key]?.requests || 0 });
      }

      // Message role breakdown
      const roleBreakdown: Record<string, number> = {};
      for (const m of msgsRes.data || []) {
        const role = m.role || "unknown";
        roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
      }

      const totalTokens = (usageRes.data || []).reduce((s: number, u: any) => s + (u.total_tokens || 0), 0);
      const totalCost = (usageRes.data || []).reduce((s: number, u: any) => s + (Number(u.cost_usd) || 0), 0);

      json(res, 200, {
        ok: true,
        period: { days, since },
        signupTrend: groupByDay(profilesRes.data || []),
        conversationTrend: groupByDay(convsRes.data || []),
        messageTrend: groupByDay(msgsRes.data || []),
        usageTrend,
        modelBreakdown: Object.entries(modelMap).map(([model, d]) => ({ model, ...d })).sort((a, b) => b.tokens - a.tokens),
        roleBreakdown,
        totals: {
          users: profilesTotal.count || 0,
          conversations: convsTotal.count || 0,
          messages: msgsTotal.count || 0,
          periodSignups: (profilesRes.data || []).length,
          periodConversations: (convsRes.data || []).length,
          periodMessages: (msgsRes.data || []).length,
          totalTokens,
          totalCost: Math.round(totalCost * 100) / 100,
        },
      });
      return true;
    } catch (err: any) {
      console.error("Analytics error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/users - List all users with usage stats
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/users" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const limitRaw = Number(searchParams.get("limit") || 100);
      const offsetRaw = Number(searchParams.get("offset") || 0);
      const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));
      const offset = Math.max(0, Math.floor(offsetRaw));
      const q = (searchParams.get("q") || "").trim().toLowerCase();

      // Get auth users for emails
      let authUsers: any[] = [];
      try {
        const pageSize = 1000;
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: pageSize });
          if (error || !data?.users?.length) break;
          authUsers.push(...data.users);
          hasMore = data.users.length === pageSize;
          page++;
        }
      } catch {
        // Fallback: continue without emails
      }

      const emailMap: Record<string, { email: string; lastSignIn: string | null; createdAt: string }> = {};
      for (const u of authUsers) {
        emailMap[u.id] = { email: u.email || "", lastSignIn: u.last_sign_in_at || null, createdAt: u.created_at };
      }

      // Get profiles with basic info
      const { data: profiles, count: totalProfiles } = await supabase
        .from("profiles")
        .select("user_id, plan, status, monthly_token_limit, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      // Get usage aggregates per user (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: usageData } = await supabase
        .from("usage_events")
        .select("user_id, total_tokens, cost_usd")
        .gte("created_at", thirtyDaysAgo);

      const usageMap: Record<string, { tokens: number; cost: number; requests: number }> = {};
      for (const u of usageData || []) {
        if (!usageMap[u.user_id]) usageMap[u.user_id] = { tokens: 0, cost: 0, requests: 0 };
        usageMap[u.user_id].tokens += u.total_tokens || 0;
        usageMap[u.user_id].cost += Number(u.cost_usd) || 0;
        usageMap[u.user_id].requests += 1;
      }

      // Get conversation counts per user
      const { data: convData } = await supabase
        .from("conversations")
        .select("user_id");

      const convMap: Record<string, number> = {};
      for (const c of convData || []) {
        convMap[c.user_id] = (convMap[c.user_id] || 0) + 1;
      }

      let users = (profiles || []).map((p: any) => {
        const authInfo = emailMap[p.user_id] || { email: "", lastSignIn: null, createdAt: p.created_at };
        const usage = usageMap[p.user_id] || { tokens: 0, cost: 0, requests: 0 };
        return {
          id: p.user_id,
          email: authInfo.email,
          plan: p.plan,
          status: p.status,
          monthlyTokenLimit: p.monthly_token_limit,
          createdAt: p.created_at,
          lastSignIn: authInfo.lastSignIn,
          conversations: convMap[p.user_id] || 0,
          tokensLast30d: usage.tokens,
          costLast30d: Math.round(usage.cost * 100) / 100,
          requestsLast30d: usage.requests,
        };
      });

      // Client-side search filter
      if (q) {
        users = users.filter((u: any) => u.email?.toLowerCase().includes(q) || u.plan?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q));
      }

      // Plan breakdown
      const planBreakdown: Record<string, number> = {};
      for (const p of profiles || []) {
        planBreakdown[p.plan] = (planBreakdown[p.plan] || 0) + 1;
      }

      json(res, 200, {
        ok: true,
        users,
        total: totalProfiles || 0,
        limit,
        offset,
        planBreakdown,
      });
      return true;
    } catch (err: any) {
      console.error("List users error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/recent-activity - Activity feed
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/recent-activity" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const activityLimit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 30)));

      // Fetch recent items from multiple tables in parallel
      const [recentConvs, recentProfiles, recentFeedback, recentDownloads, recentBeta, recentWaitlist] = await Promise.all([
        supabase.from("conversations").select("id, user_id, title, model, created_at").order("created_at", { ascending: false }).limit(15),
        supabase.from("profiles").select("user_id, plan, created_at").order("created_at", { ascending: false }).limit(10),
        supabase.from("feedback").select("id, type, status, title, created_at").order("created_at", { ascending: false }).limit(10),
        supabase.from("marketplace_downloads").select("id, workflow_id, created_at").order("created_at", { ascending: false }).limit(10),
        supabase.from("beta_users").select("email, access_level, created_at").order("created_at", { ascending: false }).limit(5),
        supabase.from("waitlist").select("email, name, created_at").order("created_at", { ascending: false }).limit(5),
      ]);

      // Get emails for user_ids
      const userIds = new Set<string>();
      for (const c of recentConvs.data || []) userIds.add(c.user_id);
      for (const p of recentProfiles.data || []) userIds.add(p.user_id);

      let emailLookup: Record<string, string> = {};
      if (userIds.size > 0) {
        try {
          const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          for (const u of data?.users || []) {
            if (userIds.has(u.id)) emailLookup[u.id] = u.email || u.id.slice(0, 8);
          }
        } catch {
          // Continue without emails
        }
      }

      type Activity = { type: string; description: string; timestamp: string; meta?: any };
      const activities: Activity[] = [];

      for (const c of recentConvs.data || []) {
        const email = emailLookup[c.user_id] || c.user_id.slice(0, 8);
        activities.push({ type: "conversation", description: `${email} started "${c.title || "Untitled"}"`, timestamp: c.created_at, meta: { model: c.model } });
      }
      for (const p of recentProfiles.data || []) {
        const email = emailLookup[p.user_id] || p.user_id.slice(0, 8);
        activities.push({ type: "signup", description: `${email} signed up (${p.plan})`, timestamp: p.created_at });
      }
      for (const f of recentFeedback.data || []) {
        activities.push({ type: "feedback", description: `New ${f.type}: ${f.title || "Untitled"}`, timestamp: f.created_at, meta: { status: f.status } });
      }
      for (const d of recentDownloads.data || []) {
        activities.push({ type: "download", description: `Workflow downloaded`, timestamp: d.created_at });
      }
      for (const b of recentBeta.data || []) {
        activities.push({ type: "beta", description: `${b.email} added as ${b.access_level}`, timestamp: b.created_at });
      }
      for (const w of recentWaitlist.data || []) {
        activities.push({ type: "waitlist", description: `${w.name || w.email} joined waitlist`, timestamp: w.created_at });
      }

      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      json(res, 200, { ok: true, activities: activities.slice(0, activityLimit) });
      return true;
    } catch (err: any) {
      console.error("Recent activity error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/server-status - Cloud server runtime info
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/server-status" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const mem = process.memoryUsage();
      const uptimeSec = process.uptime();

      json(res, 200, {
        ok: true,
        environment: ENVIRONMENT,
        isProduction: IS_PRODUCTION,
        publicUrl: CLOUD_PUBLIC_URL,
        nodeVersion: process.version,
        uptime: {
          seconds: Math.floor(uptimeSec),
          human: uptimeSec < 3600
            ? `${Math.floor(uptimeSec / 60)}m ${Math.floor(uptimeSec % 60)}s`
            : uptimeSec < 86400
            ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
            : `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h`,
        },
        memory: {
          rss: Math.round(mem.rss / 1048576),
          heapUsed: Math.round(mem.heapUsed / 1048576),
          heapTotal: Math.round(mem.heapTotal / 1048576),
          external: Math.round(mem.external / 1048576),
        },
        startedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (err: any) {
      console.error("Server status error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/ops/deployments - List deployment history from Supabase
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/deployments" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const channel = searchParams.get("channel") || undefined;
      const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 30)));

      let query = supabase
        .from("deployments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (channel) query = query.eq("channel", channel);

      const { data, error, count } = await query;
      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      // Latest deploy per channel
      const latestByChannel: Record<string, any> = {};
      for (const d of data || []) {
        if (!latestByChannel[d.channel]) latestByChannel[d.channel] = d;
      }

      json(res, 200, {
        ok: true,
        deployments: data || [],
        latestByChannel,
        current: {
          environment: ENVIRONMENT,
          url: CLOUD_PUBLIC_URL,
          nodeEnv: process.env.NODE_ENV,
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
        channels: [
          { name: "production", url: "https://api.stuard.ai", description: "Production releases" },
          { name: "beta", url: "https://beta-api.stuard.ai", description: "Early access features" },
          { name: "staging", url: "https://staging-api.stuard.ai", description: "Internal testing" },
        ],
      });
      return true;
    } catch (err: any) {
      console.error("List deployments error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/ops/deployments - Record a new deployment
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/deployments" && req.method === "POST") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const body = await readBody(req);
      const { channel, version, git_branch, git_commit_sha, git_tag, targets, workflow_run_url, workflow_run_id, metadata } = body;

      if (!channel || !["beta", "staging", "production"].includes(channel)) {
        json(res, 400, { ok: false, error: "Invalid channel. Must be beta, staging, or production." });
        return true;
      }

      const { data, error } = await supabase
        .from("deployments")
        .insert({
          channel,
          version: version || null,
          status: "pending",
          git_branch: git_branch || null,
          git_commit_sha: git_commit_sha || null,
          git_tag: git_tag || null,
          triggered_by: auth.email,
          targets: targets || { website: true, cloud: true, desktop: true },
          workflow_run_url: workflow_run_url || null,
          workflow_run_id: workflow_run_id || null,
          metadata: metadata || {},
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 201, { ok: true, deployment: data });
      return true;
    } catch (err: any) {
      console.error("Record deployment error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /v1/ops/deployments/:id - Update deployment status
  // ─────────────────────────────────────────────────────────────────────────
  const deployPatchMatch = path.match(/^\/v1\/ops\/deployments\/([a-f0-9-]+)$/);
  if (deployPatchMatch && req.method === "PATCH") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const deployId = deployPatchMatch[1];
      const body = await readBody(req);
      const { status, error_message, duration_seconds, completed_at, metadata } = body;

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (error_message !== undefined) updates.error_message = error_message;
      if (duration_seconds !== undefined) updates.duration_seconds = duration_seconds;
      if (completed_at) updates.completed_at = completed_at;
      if (metadata) updates.metadata = metadata;

      // Auto-set completed_at for terminal statuses
      if (status && ["deployed", "failed", "rolled_back"].includes(status) && !completed_at) {
        updates.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("deployments")
        .update(updates)
        .eq("id", deployId)
        .select()
        .single();

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, { ok: true, deployment: data });
      return true;
    } catch (err: any) {
      console.error("Update deployment error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/ops/deployments/callback - CI/CD webhook callback (no auth needed, uses secret)
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/deployments/callback" && req.method === "POST") {
    try {
      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }

      const body = await readBody(req);
      const { deployment_id, channel, secret, status, error_message, duration_seconds, workflow_run_url } = body;

      // Validate callback secret
      const expectedSecret = process.env.OPS_DEPLOY_CALLBACK_SECRET || process.env.DEPLOY_CALLBACK_SECRET;
      if (!expectedSecret || secret !== expectedSecret) {
        json(res, 401, { ok: false, error: "invalid_secret" });
        return true;
      }

      // Find the deployment: by ID, or by latest pending for channel
      let targetId = deployment_id;
      if (!targetId && channel) {
        const { data: found } = await supabase
          .from("deployments")
          .select("id")
          .eq("channel", channel)
          .in("status", ["pending", "building", "deploying"])
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        targetId = found?.id;
      }

      if (!targetId) {
        json(res, 400, { ok: false, error: "deployment_id or channel required" });
        return true;
      }

      const updates: Record<string, any> = {};
      if (status) updates.status = status;
      if (error_message) updates.error_message = error_message;
      if (duration_seconds) updates.duration_seconds = duration_seconds;
      if (workflow_run_url) updates.workflow_run_url = workflow_run_url;
      if (status && ["deployed", "failed", "rolled_back"].includes(status)) {
        updates.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("deployments")
        .update(updates)
        .eq("id", targetId)
        .select()
        .single();

      if (error) {
        json(res, 500, { ok: false, error: error.message });
        return true;
      }

      json(res, 200, { ok: true, deployment: data });
      return true;
    } catch (err: any) {
      console.error("Deploy callback error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  return false;
}
