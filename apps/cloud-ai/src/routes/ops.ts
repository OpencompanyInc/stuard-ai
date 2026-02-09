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
  // GET /v1/ops/deployments - Get deployment info (from memory, for display)
  // ─────────────────────────────────────────────────────────────────────────
  if (path === "/v1/ops/deployments" && req.method === "GET") {
    try {
      const auth = await requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.error === "forbidden" ? 403 : 401, { ok: false, error: auth.error });
        return true;
      }

      // Return current deployment info
      json(res, 200, {
        ok: true,
        current: {
          environment: ENVIRONMENT,
          url: CLOUD_PUBLIC_URL,
          nodeEnv: process.env.NODE_ENV,
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
        channels: [
          { name: "stable", url: "https://api.stuard.ai", description: "Production releases" },
          { name: "beta", url: "https://beta-api.stuard.ai", description: "Early access features" },
          { name: "staging", url: "https://staging-api.stuard.ai", description: "Internal testing" },
        ],
      });
      return true;
    } catch (err: any) {
      console.error("Get deployments error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  return false;
}
