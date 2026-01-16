/**
 * Beta Access Check API
 * Checks if the authenticated user has access to beta/staging update channels
 */

import type { IncomingMessage, ServerResponse } from "http";
import { verifyToken, getSupabaseService } from "../supabase";

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

export async function handleBetaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const path = parsedUrl.pathname;

  // GET /v1/beta/check - Check beta access for authenticated user
  if (path === "/v1/beta/check" && req.method === "GET") {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        json(res, 401, { ok: false, beta: false, staging: false, error: "unauthorized" });
        return true;
      }

      const token = authHeader.slice(7);
      const user = await verifyToken(token);
      if (!user?.email) {
        json(res, 401, { ok: false, beta: false, staging: false, error: "unauthorized" });
        return true;
      }

      const email = user.email.toLowerCase();

      // Check beta_users table
      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 200, { ok: true, beta: false, staging: false });
        return true;
      }
      
      const { data, error } = await supabase
        .from("beta_users")
        .select("access_level, expires_at")
        .eq("email", email)
        .single();

      if (error || !data) {
        // Not in beta program
        json(res, 200, { ok: true, beta: false, staging: false });
        return true;
      }

      // Check if access has expired
      if (data.expires_at) {
        const expiresAt = new Date(data.expires_at);
        if (expiresAt < new Date()) {
          json(res, 200, { ok: true, beta: false, staging: false });
          return true;
        }
      }

      const level = String(data.access_level || "").toLowerCase();
      json(res, 200, {
        ok: true,
        beta: level === "beta" || level === "staging" || level === "all",
        staging: level === "staging" || level === "all",
        access_level: level,
      });
      return true;
    } catch (err: any) {
      console.error("Beta check error:", err);
      json(res, 500, { ok: false, beta: false, staging: false, error: "internal_error" });
      return true;
    }
  }

  // POST /v1/beta/invite - Admin endpoint to add beta user
  if (path === "/v1/beta/invite" && req.method === "POST") {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return true;
      }

      const token = authHeader.slice(7);
      const user = await verifyToken(token);
      if (!user?.email) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return true;
      }

      // Check if requester has 'all' access (admin)
      const supabase = getSupabaseService();
      if (!supabase) {
        json(res, 500, { ok: false, error: "service_unavailable" });
        return true;
      }
      
      const { data: requesterAccess } = await supabase
        .from("beta_users")
        .select("access_level")
        .eq("email", user.email.toLowerCase())
        .single();

      if (requesterAccess?.access_level !== "all") {
        json(res, 403, { ok: false, error: "forbidden" });
        return true;
      }

      const body = await readBody(req);
      const email = body.email?.toLowerCase()?.trim();
      const access_level = body.access_level || "beta";

      if (!email) {
        json(res, 400, { ok: false, error: "email_required" });
        return true;
      }

      // Insert or update beta user
      const { data, error } = await supabase
        .from("beta_users")
        .upsert(
          {
            email,
            access_level,
            invited_by: user.email,
            notes: body.notes,
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
      console.error("Beta invite error:", err);
      json(res, 500, { ok: false, error: "internal_error" });
      return true;
    }
  }

  return false;
}
