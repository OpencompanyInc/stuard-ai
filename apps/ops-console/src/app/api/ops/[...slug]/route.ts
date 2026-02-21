import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, verifyOpsToken } from '../../../lib/supabase-server';

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

// ── GET handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  if (!verifyOpsToken(req)) return err(401, 'unauthorized');
  const supabase = getSupabase();
  if (!supabase) return err(500, 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const { slug } = await params;
  const route = slug.join('/');
  const sp = req.nextUrl.searchParams;

  // ── analytics ──
  // Only track operational/usage data — no private data (conversations, messages, memories)
  if (route === 'analytics') {
    const days = Math.min(90, Math.max(1, Number(sp.get('days') || 30)));
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [profilesRes, usageRes, profilesTotal] = await Promise.all([
      supabase.from('profiles').select('created_at').gte('created_at', since),
      supabase.from('usage_events').select('model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at').gte('created_at', since),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);

    function groupByDay(items: Record<string, string>[], dateField = 'created_at') {
      const map: Record<string, number> = {};
      for (const item of items || []) {
        const d = item[dateField]?.slice(0, 10);
        if (d) map[d] = (map[d] || 0) + 1;
      }
      const result: { date: string; count: number }[] = [];
      const start = new Date(since);
      const end = new Date();
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        result.push({ date: key, count: map[key] || 0 });
      }
      return result;
    }

    const modelMap: Record<string, { tokens: number; cost: number; count: number; promptTokens: number; completionTokens: number }> = {};
    for (const u of usageRes.data || []) {
      const m = u.model || 'unknown';
      if (!modelMap[m]) modelMap[m] = { tokens: 0, cost: 0, count: 0, promptTokens: 0, completionTokens: 0 };
      modelMap[m].tokens += u.total_tokens || 0;
      modelMap[m].cost += Number(u.cost_usd) || 0;
      modelMap[m].count += 1;
      modelMap[m].promptTokens += u.prompt_tokens || 0;
      modelMap[m].completionTokens += u.completion_tokens || 0;
    }

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

    const usageTrend: { date: string; tokens: number; cost: number; requests: number }[] = [];
    for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      usageTrend.push({ date: key, tokens: usageByDay[key]?.tokens || 0, cost: usageByDay[key]?.cost || 0, requests: usageByDay[key]?.requests || 0 });
    }

    const totalTokens = (usageRes.data || []).reduce((s: number, u: Record<string, number>) => s + (u.total_tokens || 0), 0);
    const totalCost = (usageRes.data || []).reduce((s: number, u: Record<string, number>) => s + (Number(u.cost_usd) || 0), 0);
    const totalRequests = (usageRes.data || []).length;

    return ok({
      period: { days, since },
      signupTrend: groupByDay(profilesRes.data || []),
      usageTrend,
      modelBreakdown: Object.entries(modelMap).map(([model, d]) => ({ model, ...d })).sort((a, b) => b.tokens - a.tokens),
      totals: {
        users: profilesTotal.count || 0,
        periodSignups: (profilesRes.data || []).length,
        totalTokens,
        totalCost: Math.round(totalCost * 100) / 100,
        totalRequests,
      },
    });
  }

  // ── users ──
  if (route === 'users') {
    const limitRaw = Number(sp.get('limit') || 100);
    const offsetRaw = Number(sp.get('offset') || 0);
    const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));
    const offset = Math.max(0, Math.floor(offsetRaw));
    const q = (sp.get('q') || '').trim().toLowerCase();

    let authUsers: { id: string; email?: string; last_sign_in_at?: string; created_at: string }[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users?.length) break;
        authUsers.push(...data.users.map(u => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at || undefined, created_at: u.created_at })));
        hasMore = data.users.length === 1000;
        page++;
      }
    } catch { /* continue without emails */ }

    const emailMap: Record<string, { email: string; lastSignIn: string | null; createdAt: string }> = {};
    for (const u of authUsers) emailMap[u.id] = { email: u.email || '', lastSignIn: u.last_sign_in_at || null, createdAt: u.created_at };

    const { data: profiles, count: totalProfiles } = await supabase
      .from('profiles')
      .select('user_id, plan, status, monthly_token_limit, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: usageData } = await supabase.from('usage_events').select('user_id, total_tokens, cost_usd').gte('created_at', thirtyDaysAgo);
    const usageMap: Record<string, { tokens: number; cost: number; requests: number }> = {};
    for (const u of usageData || []) {
      if (!usageMap[u.user_id]) usageMap[u.user_id] = { tokens: 0, cost: 0, requests: 0 };
      usageMap[u.user_id].tokens += u.total_tokens || 0;
      usageMap[u.user_id].cost += Number(u.cost_usd) || 0;
      usageMap[u.user_id].requests += 1;
    }

    let users = (profiles || []).map((p: Record<string, unknown>) => {
      const authInfo = emailMap[p.user_id as string] || { email: '', lastSignIn: null, createdAt: p.created_at };
      const usage = usageMap[p.user_id as string] || { tokens: 0, cost: 0, requests: 0 };
      return {
        id: p.user_id,
        email: authInfo.email,
        plan: p.plan,
        status: p.status,
        monthlyTokenLimit: p.monthly_token_limit,
        createdAt: p.created_at,
        lastSignIn: authInfo.lastSignIn,
        tokensLast30d: usage.tokens,
        costLast30d: Math.round(usage.cost * 100) / 100,
        requestsLast30d: usage.requests,
      };
    });

    if (q) {
      users = users.filter(u => u.email?.toLowerCase().includes(q) || (u.plan as string)?.toLowerCase().includes(q) || (u.id as string)?.toLowerCase().includes(q));
    }

    const planBreakdown: Record<string, number> = {};
    for (const p of profiles || []) planBreakdown[p.plan] = (planBreakdown[p.plan] || 0) + 1;

    return ok({ users, total: totalProfiles || 0, limit, offset, planBreakdown });
  }

  // ── beta-users ──
  if (route === 'beta-users') {
    const { data, error } = await supabase.from('beta_users').select('*').order('created_at', { ascending: false });
    if (error) return err(500, error.message);
    return ok({ users: data || [] });
  }

  // ── waitlist ──
  if (route === 'waitlist') {
    const q = (sp.get('q') || '').trim();
    const limitRaw = Number(sp.get('limit') || 50);
    const offsetRaw = Number(sp.get('offset') || 0);
    const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));
    const offset = Math.max(0, Math.floor(offsetRaw));

    let query = supabase
      .from('waitlist')
      .select('id,email,name,company,use_case,referral_source,position,created_at,notified', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/,/g, ' ');
      query = query.or(`email.ilike.%${esc}%,name.ilike.%${esc}%,company.ilike.%${esc}%,use_case.ilike.%${esc}%,referral_source.ilike.%${esc}%`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return err(500, error.message);
    return ok({ entries: data || [], total: count || 0, limit, offset });
  }

  // ── deployments ──
  if (route === 'deployments') {
    const channel = sp.get('channel') || undefined;
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit') || 30)));
    let query = supabase.from('deployments').select('*').order('created_at', { ascending: false }).limit(limit);
    if (channel) query = query.eq('channel', channel);
    const { data, error } = await query;
    if (error) return err(500, error.message);
    const latestByChannel: Record<string, unknown> = {};
    for (const d of data || []) {
      if (!latestByChannel[d.channel]) latestByChannel[d.channel] = d;
    }
    return ok({ deployments: data || [], latestByChannel });
  }

  // ── database-stats ──
  if (route === 'database-stats') {
    const tables = [
      'profiles', 'devices', 'usage_events',
      'shared_spaces', 'space_shares',
      'webhooks', 'webhook_events', 'webhook_providers', 'webhook_queue',
      'marketplace_workflows', 'marketplace_ratings', 'marketplace_downloads',
      'external_accounts', 'beta_users', 'waitlist', 'feedback', 'feedback_comments',
    ];
    const counts: Record<string, number> = {};
    await Promise.all(tables.map(async (table) => {
      try {
        const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
        counts[table] = count || 0;
      } catch { counts[table] = -1; }
    }));
    return ok({ tables: counts, timestamp: new Date().toISOString() });
  }

  // ── recent-activity ──
  if (route === 'recent-activity') {
    const activityLimit = Math.min(100, Math.max(1, Number(sp.get('limit') || 30)));
    // Only show operational activity — no private data (conversations, messages, memories)
    const [recentProfiles, recentFeedback, recentDownloads, recentBeta, recentWaitlist] = await Promise.all([
      supabase.from('profiles').select('user_id, plan, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('feedback').select('id, type, status, title, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('marketplace_downloads').select('id, workflow_id, created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('beta_users').select('email, access_level, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('waitlist').select('email, name, created_at').order('created_at', { ascending: false }).limit(5),
    ]);

    const userIds = new Set<string>();
    for (const p of recentProfiles.data || []) userIds.add(p.user_id);
    const emailLookup: Record<string, string> = {};
    if (userIds.size > 0) {
      try {
        const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        for (const u of data?.users || []) {
          if (userIds.has(u.id)) emailLookup[u.id] = u.email || u.id.slice(0, 8);
        }
      } catch { /* continue */ }
    }

    type Activity = { type: string; description: string; timestamp: string; meta?: Record<string, unknown> };
    const activities: Activity[] = [];
    for (const p of recentProfiles.data || []) {
      const email = emailLookup[p.user_id] || p.user_id.slice(0, 8);
      activities.push({ type: 'signup', description: `${email} signed up (${p.plan})`, timestamp: p.created_at });
    }
    for (const f of recentFeedback.data || []) activities.push({ type: 'feedback', description: `New ${f.type}: ${f.title || 'Untitled'}`, timestamp: f.created_at, meta: { status: f.status } });
    for (const d of recentDownloads.data || []) activities.push({ type: 'download', description: 'Workflow downloaded', timestamp: d.created_at });
    for (const b of recentBeta.data || []) activities.push({ type: 'beta', description: `${b.email} added as ${b.access_level}`, timestamp: b.created_at });
    for (const w of recentWaitlist.data || []) activities.push({ type: 'waitlist', description: `${w.name || w.email} joined waitlist`, timestamp: w.created_at });

    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return ok({ activities: activities.slice(0, activityLimit) });
  }

  // ── sync-systems ──
  if (route === 'sync-systems') {
    // Only track infrastructure health — no private data (conversations, messages, memories)
    const [
      sharedSpacesResult, webhooksResult,
      webhookQueueResult, devicesResult,
      marketplaceResult, feedbackResult,
    ] = await Promise.all([
      supabase.from('shared_spaces').select('id, synced_at', { count: 'exact', head: false }).order('synced_at', { ascending: false }).limit(5),
      supabase.from('webhooks').select('id, is_active, trigger_count', { count: 'exact', head: false }),
      supabase.from('webhook_queue').select('id, status', { count: 'exact', head: false }).eq('status', 'pending'),
      supabase.from('devices').select('id, status, last_seen_at, platform', { count: 'exact', head: false }),
      supabase.from('marketplace_workflows').select('id, download_count', { count: 'exact', head: false }),
      supabase.from('feedback').select('id, type, status', { count: 'exact', head: false }),
    ]);

    const whData = webhooksResult.data || [];
    const activeWebhooks = whData.filter((w: Record<string, boolean>) => w.is_active).length;
    const totalTriggers = whData.reduce((s: number, w: Record<string, number>) => s + (w.trigger_count || 0), 0);

    const devData = devicesResult.data || [];
    const onlineDevices = devData.filter((d: Record<string, string>) => d.status === 'online').length;
    const platformCounts: Record<string, number> = {};
    devData.forEach((d: Record<string, string>) => { if (d.platform) platformCounts[d.platform] = (platformCounts[d.platform] || 0) + 1; });

    const mpData = marketplaceResult.data || [];
    const totalDownloads = mpData.reduce((s: number, w: Record<string, number>) => s + (w.download_count || 0), 0);

    const fbData = feedbackResult.data || [];
    const openBugs = fbData.filter((f: Record<string, string>) => f.type === 'bug' && f.status === 'open').length;
    const openFeatures = fbData.filter((f: Record<string, string>) => f.type === 'feature' && f.status === 'open').length;

    return ok({
      timestamp: new Date().toISOString(),
      systems: {
        sharedSpaces: { status: 'operational', total: sharedSpacesResult.count || 0, recentSync: sharedSpacesResult.data?.[0]?.synced_at || null },
        webhooks: { status: 'operational', total: webhooksResult.count || 0, active: activeWebhooks, totalTriggers, pendingDeliveries: webhookQueueResult.count || 0 },
        devices: { status: 'operational', total: devicesResult.count || 0, online: onlineDevices, byPlatform: platformCounts },
        marketplace: { status: 'operational', workflows: marketplaceResult.count || 0, totalDownloads },
        feedback: { status: 'operational', total: feedbackResult.count || 0, openBugs, openFeatures },
      },
    });
  }

  // ── server-status (local Next.js info) ──
  if (route === 'server-status') {
    const mem = process.memoryUsage();
    const uptimeSec = process.uptime();
    return ok({
      environment: process.env.NODE_ENV || 'development',
      isProduction: process.env.NODE_ENV === 'production',
      publicUrl: 'http://localhost:3001',
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
  }

  // ── feedback (list) ──
  if (route === 'feedback') {
    const type = sp.get('type') || undefined; // 'bug' | 'feature' | undefined
    const status = sp.get('status') || undefined; // 'open' | 'in_progress' | 'resolved' | 'closed'
    const limitRaw = Number(sp.get('limit') || 50);
    const offsetRaw = Number(sp.get('offset') || 0);
    const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));
    const offset = Math.max(0, Math.floor(offsetRaw));

    let query = supabase
      .from('feedback')
      .select('id, type, status, priority, title, description, reporter_email, assigned_to, created_at, updated_at, resolved_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return err(500, error.message);

    // Stats summary
    const { data: allFeedback } = await supabase.from('feedback').select('type, status, priority');
    const stats = {
      total: allFeedback?.length || 0,
      openBugs: allFeedback?.filter(f => f.type === 'bug' && f.status === 'open').length || 0,
      openFeatures: allFeedback?.filter(f => f.type === 'feature' && f.status === 'open').length || 0,
      inProgress: allFeedback?.filter(f => f.status === 'in_progress').length || 0,
      resolved: allFeedback?.filter(f => f.status === 'resolved' || f.status === 'closed').length || 0,
      byPriority: {
        critical: allFeedback?.filter(f => f.priority === 'critical').length || 0,
        high: allFeedback?.filter(f => f.priority === 'high').length || 0,
        medium: allFeedback?.filter(f => f.priority === 'medium').length || 0,
        low: allFeedback?.filter(f => f.priority === 'low').length || 0,
      },
    };

    // Fetch comments count per feedback item
    const ids = (data || []).map(d => d.id);
    let commentCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: comments } = await supabase.from('feedback_comments').select('feedback_id').in('feedback_id', ids);
      for (const c of comments || []) commentCounts[c.feedback_id] = (commentCounts[c.feedback_id] || 0) + 1;
    }

    return ok({
      items: (data || []).map(d => ({ ...d, commentCount: commentCounts[d.id] || 0 })),
      total: count || 0,
      limit,
      offset,
      stats,
    });
  }

  // ── feedback/:id (single with comments) ──
  if (slug[0] === 'feedback' && slug[1]) {
    const feedbackId = slug[1];
    const { data: item, error } = await supabase.from('feedback').select('*').eq('id', feedbackId).single();
    if (error) return err(404, 'Feedback item not found');

    const { data: comments } = await supabase
      .from('feedback_comments')
      .select('id, author, content, created_at')
      .eq('feedback_id', feedbackId)
      .order('created_at', { ascending: true });

    return ok({ item, comments: comments || [] });
  }

  return err(404, 'Unknown ops route');
}

// ── POST handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  if (!verifyOpsToken(req)) return err(401, 'unauthorized');
  const supabase = getSupabase();
  if (!supabase) return err(500, 'Supabase not configured.');
  const { slug } = await params;
  const route = slug.join('/');
  const body = await req.json().catch(() => ({}));

  // ── beta-users (upsert) ──
  if (route === 'beta-users') {
    const email = body.email?.toLowerCase()?.trim();
    const access_level = String(body.access_level || 'beta').trim().toLowerCase();
    const notes = body.notes || null;
    const expires_at = body.expires_at || null;
    if (!email) return err(400, 'email_required');
    if (!['beta', 'staging', 'all'].includes(access_level)) return err(400, 'invalid_access_level');

    const { data, error } = await supabase
      .from('beta_users')
      .upsert({ email, access_level, invited_by: 'ops-console', notes, expires_at }, { onConflict: 'email' })
      .select()
      .single();
    if (error) return err(500, error.message);
    return ok({ user: data });
  }

  // ── waitlist/promote ──
  if (route === 'waitlist/promote') {
    const email = body.email?.toLowerCase()?.trim();
    const access_level = String(body.access_level || 'beta').trim().toLowerCase();
    const removeFromWaitlist = body.removeFromWaitlist !== false;
    if (!email) return err(400, 'email_required');
    if (!['beta', 'staging', 'all'].includes(access_level)) return err(400, 'invalid_access_level');

    const { data: waitlistEntry, error: wlErr } = await supabase.from('waitlist').select('*').eq('email', email).maybeSingle();
    if (wlErr) return err(500, wlErr.message);
    if (!waitlistEntry) return err(404, 'waitlist_entry_not_found');

    const { data: betaUser, error: betaErr } = await supabase
      .from('beta_users')
      .upsert({ email, access_level, invited_by: 'ops-console', notes: null, expires_at: null }, { onConflict: 'email' })
      .select()
      .single();
    if (betaErr) return err(500, betaErr.message);

    let waitlistAction = { ok: true, action: 'none' };
    if (removeFromWaitlist) {
      const { error } = await supabase.from('waitlist').delete().eq('id', waitlistEntry.id);
      waitlistAction = error ? { ok: false, action: 'delete' } : { ok: true, action: 'delete' };
    }
    return ok({ user: betaUser, waitlistEntry, waitlistAction });
  }

  // ── feedback (create) ──
  if (route === 'feedback') {
    const { type, title, description, reporter_email, priority } = body;
    if (!type || !['bug', 'feature'].includes(type)) return err(400, 'type must be bug or feature');
    if (!title?.trim()) return err(400, 'title_required');

    const { data, error } = await supabase
      .from('feedback')
      .insert({
        type,
        status: 'open',
        priority: priority || 'medium',
        title: title.trim(),
        description: description || null,
        reporter_email: reporter_email || null,
      })
      .select()
      .single();
    if (error) return err(500, error.message);
    return ok({ item: data }, 201);
  }

  // ── feedback/:id/comments (add comment) ──
  if (slug[0] === 'feedback' && slug[1] && slug[2] === 'comments') {
    const feedbackId = slug[1];
    const { content, author } = body;
    if (!content?.trim()) return err(400, 'content_required');

    const { data, error } = await supabase
      .from('feedback_comments')
      .insert({ feedback_id: feedbackId, content: content.trim(), author: author || 'ops-console' })
      .select()
      .single();
    if (error) return err(500, error.message);
    return ok({ comment: data }, 201);
  }

  // ── deployments (record) ──
  if (route === 'deployments') {
    const { channel, version, git_branch, git_commit_sha, git_tag, targets, workflow_run_url, workflow_run_id, metadata } = body;
    if (!channel || !['beta', 'staging', 'production'].includes(channel)) return err(400, 'Invalid channel');

    const { data, error } = await supabase
      .from('deployments')
      .insert({
        channel,
        version: version || null,
        status: 'pending',
        git_branch: git_branch || null,
        git_commit_sha: git_commit_sha || null,
        git_tag: git_tag || null,
        triggered_by: 'ops-console',
        targets: targets || { website: true, cloud: true, desktop: true },
        workflow_run_url: workflow_run_url || null,
        workflow_run_id: workflow_run_id || null,
        metadata: metadata || {},
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return err(500, error.message);
    return ok({ deployment: data }, 201);
  }

  return err(404, 'Unknown ops route');
}

// ── DELETE handler ───────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  if (!verifyOpsToken(req)) return err(401, 'unauthorized');
  const supabase = getSupabase();
  if (!supabase) return err(500, 'Supabase not configured.');
  const { slug } = await params;

  // ── beta-users/:email ──
  if (slug[0] === 'beta-users' && slug[1]) {
    const email = decodeURIComponent(slug[1]).toLowerCase().trim();
    if (!email) return err(400, 'email_required');
    const { error } = await supabase.from('beta_users').delete().eq('email', email);
    if (error) return err(500, error.message);
    return ok({});
  }

  return err(404, 'Unknown ops route');
}

// ── PATCH handler ────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  if (!verifyOpsToken(req)) return err(401, 'unauthorized');
  const supabase = getSupabase();
  if (!supabase) return err(500, 'Supabase not configured.');
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));

  // ── feedback/:id (update status, assignment, priority) ──
  if (slug[0] === 'feedback' && slug[1]) {
    const feedbackId = slug[1];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status) {
      updates.status = body.status;
      if (['resolved', 'closed'].includes(body.status)) updates.resolved_at = new Date().toISOString();
    }
    if (body.priority) updates.priority = body.priority;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;

    const { data, error } = await supabase.from('feedback').update(updates).eq('id', feedbackId).select().single();
    if (error) return err(500, error.message);
    return ok({ item: data });
  }

  // ── deployments/:id ──
  if (slug[0] === 'deployments' && slug[1]) {
    const deployId = slug[1];
    const updates: Record<string, unknown> = {};
    if (body.status) updates.status = body.status;
    if (body.error_message !== undefined) updates.error_message = body.error_message;
    if (body.duration_seconds !== undefined) updates.duration_seconds = body.duration_seconds;
    if (body.completed_at) updates.completed_at = body.completed_at;
    if (body.metadata) updates.metadata = body.metadata;
    if (body.status && ['deployed', 'failed', 'rolled_back'].includes(body.status) && !body.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    const { data, error } = await supabase.from('deployments').update(updates).eq('id', deployId).select().single();
    if (error) return err(500, error.message);
    return ok({ deployment: data });
  }

  return err(404, 'Unknown ops route');
}
