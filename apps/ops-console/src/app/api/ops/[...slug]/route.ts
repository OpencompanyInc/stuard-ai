import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, verifyOpsToken } from '../../../lib/supabase-server';

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

type FeedbackRow = Record<string, unknown>;
type FeedbackCommentRow = Record<string, unknown>;

function normalizePriority(row: FeedbackRow): string {
  const severity = typeof row.severity === 'string' ? row.severity : null;
  const priority = typeof row.priority === 'string' ? row.priority : null;
  return (priority || severity || 'medium').toLowerCase();
}

function normalizeFeedbackItem(row: FeedbackRow): Record<string, unknown> {
  const metadata = (row.metadata && typeof row.metadata === 'object') ? (row.metadata as Record<string, unknown>) : {};
  const reporterEmail = typeof row.reporter_email === 'string'
    ? row.reporter_email
    : (typeof metadata.reporter_email === 'string' ? metadata.reporter_email : null);
  const assignedTo = typeof row.assigned_to === 'string'
    ? row.assigned_to
    : (typeof metadata.assigned_to === 'string' ? metadata.assigned_to : null);
  const resolvedAt = typeof row.resolved_at === 'string'
    ? row.resolved_at
    : (typeof metadata.resolved_at === 'string' ? metadata.resolved_at : null);

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    priority: normalizePriority(row),
    title: row.title,
    description: row.description,
    reporter_email: reporterEmail,
    assigned_to: assignedTo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: resolvedAt,
  };
}

function normalizeFeedbackComment(comment: FeedbackCommentRow): Record<string, unknown> {
  let author = 'user';
  if (typeof comment.author === 'string' && comment.author.trim()) author = comment.author;
  else if (comment.is_admin === true) author = 'ops-console';
  else if (typeof comment.user_id === 'string' && comment.user_id.trim()) author = comment.user_id;

  return {
    id: comment.id,
    author,
    content: comment.content,
    created_at: comment.created_at,
  };
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

    const authUsers: { id: string; email?: string; last_sign_in_at?: string; created_at: string }[] = [];
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
      'shared_spaces', 'space_shares', 'memory_outbox', 'external_accounts',
      'webhooks', 'webhook_events', 'webhook_providers', 'webhook_queue',
      'marketplace_workflows', 'marketplace_workflow_versions', 'marketplace_ratings', 'marketplace_downloads',
      'beta_users', 'waitlist', 'feedback', 'feedback_comments',
      'support_tickets', 'support_ticket_messages',
      'deployments', 'cloud_engines', 'storage_usage', 'compute_billing_events', 'vm_snapshots',
      'vm_metrics_history', 'terminal_sessions', 'vm_deployments',
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
      // Select full row to avoid coupling to a single schema variant.
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return err(500, error.message);

    // Stats summary
    const { data: allFeedback } = await supabase.from('feedback').select('*');
    const stats = {
      total: allFeedback?.length || 0,
      openBugs: allFeedback?.filter(f => f.type === 'bug' && f.status === 'open').length || 0,
      openFeatures: allFeedback?.filter(f => f.type === 'feature' && f.status === 'open').length || 0,
      inProgress: allFeedback?.filter(f => f.status === 'in_progress').length || 0,
      resolved: allFeedback?.filter(f => f.status === 'resolved' || f.status === 'closed').length || 0,
      byPriority: {
        critical: allFeedback?.filter(f => normalizePriority(f) === 'critical').length || 0,
        high: allFeedback?.filter(f => normalizePriority(f) === 'high').length || 0,
        medium: allFeedback?.filter(f => normalizePriority(f) === 'medium').length || 0,
        low: allFeedback?.filter(f => normalizePriority(f) === 'low').length || 0,
      },
    };

    // Fetch comments count per feedback item
    const ids = (data || []).map(d => d.id);
    const commentCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: comments } = await supabase.from('feedback_comments').select('feedback_id').in('feedback_id', ids);
      for (const c of comments || []) commentCounts[c.feedback_id] = (commentCounts[c.feedback_id] || 0) + 1;
    }

    return ok({
      items: (data || []).map(d => ({ ...normalizeFeedbackItem(d), commentCount: commentCounts[String(d.id)] || 0 })),
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
      .select('*')
      .eq('feedback_id', feedbackId)
      .order('created_at', { ascending: true });

    return ok({ item: normalizeFeedbackItem(item as FeedbackRow), comments: (comments || []).map(normalizeFeedbackComment) });
  }

  // ── support (list tickets with stats) ──
  if (route === 'support') {
    const status = sp.get('status') || undefined;
    const priority = sp.get('priority') || undefined;
    const category = sp.get('category') || undefined;
    const q = (sp.get('q') || '').trim();
    const limit = Math.max(1, Math.min(200, Number(sp.get('limit') || 50)));
    const offset = Math.max(0, Number(sp.get('offset') || 0));

    let query = supabase
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .order('last_message_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (category) query = query.eq('category', category);
    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/,/g, ' ');
      query = query.or(`subject.ilike.%${esc}%,email.ilike.%${esc}%,name.ilike.%${esc}%`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) return err(500, error.message);

    const { data: allTickets } = await supabase.from('support_tickets').select('status, priority, last_message_by');
    const stats = {
      total: allTickets?.length || 0,
      open: allTickets?.filter(t => t.status === 'open').length || 0,
      pending: allTickets?.filter(t => t.status === 'pending').length || 0,
      awaitingUser: allTickets?.filter(t => t.status === 'awaiting_user').length || 0,
      resolved: allTickets?.filter(t => t.status === 'resolved' || t.status === 'closed').length || 0,
      needsReply: allTickets?.filter(t => (t.status === 'open' || t.status === 'pending') && t.last_message_by === 'user').length || 0,
      urgent: allTickets?.filter(t => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length || 0,
    };

    // message counts per ticket
    const ids = (data || []).map(d => d.id);
    const messageCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: msgs } = await supabase.from('support_ticket_messages').select('ticket_id').in('ticket_id', ids);
      for (const m of msgs || []) messageCounts[m.ticket_id] = (messageCounts[m.ticket_id] || 0) + 1;
    }

    return ok({
      tickets: (data || []).map(t => ({ ...t, messageCount: messageCounts[String(t.id)] || 0 })),
      total: count || 0,
      limit,
      offset,
      stats,
    });
  }

  // ── support/:id (single ticket with all messages including internal notes) ──
  if (slug[0] === 'support' && slug[1]) {
    const ticketId = slug[1];
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', ticketId)
      .maybeSingle();
    if (error) return err(500, error.message);
    if (!ticket) return err(404, 'Ticket not found');

    const { data: messages } = await supabase
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    const messagesWithUrls = await signSupportAttachmentUrls(supabase, messages || []);
    return ok({ ticket, messages: messagesWithUrls });
  }

  return err(404, 'Unknown ops route');
}

// ── Support attachment helpers ─────────────────────────────────────────────
const SUPPORT_BUCKET = 'support-attachments';
const SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
const SUPPORT_MAX_ATTACHMENTS = 5;
const SUPPORT_ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
]);
const SUPPORT_SIGNED_TTL = 3600;

type AttachmentRecord = { path: string; name: string; mime: string; size: number };

function validateSupportAttachments(raw: unknown): { ok: true; value: AttachmentRecord[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments_must_be_array' };
  if (raw.length > SUPPORT_MAX_ATTACHMENTS) return { ok: false, error: 'too_many_attachments' };
  const out: AttachmentRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'invalid_attachment' };
    const a = item as Record<string, unknown>;
    const path = typeof a.path === 'string' ? a.path : '';
    const name = typeof a.name === 'string' ? a.name : '';
    const mime = typeof a.mime === 'string' ? a.mime : '';
    const size = typeof a.size === 'number' ? a.size : -1;
    if (!path || path.includes('..')) return { ok: false, error: 'invalid_attachment_path' };
    if (!name) return { ok: false, error: 'attachment_name_required' };
    if (!SUPPORT_ALLOWED_MIME.has(mime)) return { ok: false, error: 'unsupported_attachment_type' };
    if (!Number.isFinite(size) || size < 0 || size > SUPPORT_MAX_BYTES) return { ok: false, error: 'attachment_too_large' };
    out.push({ path, name, mime, size });
  }
  return { ok: true, value: out };
}

async function signSupportAttachmentUrls<T extends { attachments?: unknown }>(
  db: import('@supabase/supabase-js').SupabaseClient,
  rows: T[]
): Promise<T[]> {
  const paths = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.attachments)) {
      for (const a of row.attachments) {
        if (a && typeof a === 'object' && typeof (a as { path?: unknown }).path === 'string') {
          paths.add((a as { path: string }).path);
        }
      }
    }
  }
  if (paths.size === 0) return rows;

  const urlMap = new Map<string, string>();
  const { data } = await db.storage.from(SUPPORT_BUCKET).createSignedUrls([...paths], SUPPORT_SIGNED_TTL);
  for (const entry of data || []) {
    if (entry.path && entry.signedUrl) urlMap.set(entry.path, entry.signedUrl);
  }

  return rows.map(row => {
    if (!Array.isArray(row.attachments)) return row;
    const next = (row.attachments as Array<Record<string, unknown>>).map(a => ({
      ...a,
      url: typeof a.path === 'string' ? urlMap.get(a.path) || null : null,
    }));
    return { ...row, attachments: next };
  });
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

    const sharedPayload = {
      type,
      status: 'open',
      title: title.trim(),
      description: description || '',
    };

    const modernInsert = await supabase
      .from('feedback')
      .insert({
        ...sharedPayload,
        severity: priority || 'medium',
        metadata: reporter_email ? { reporter_email } : {},
      })
      .select()
      .single();

    if (!modernInsert.error) return ok({ item: normalizeFeedbackItem(modernInsert.data as FeedbackRow) }, 201);

    const legacyInsert = await supabase
      .from('feedback')
      .insert({
        ...sharedPayload,
        priority: priority || 'medium',
        reporter_email: reporter_email || null,
      })
      .select()
      .single();
    if (legacyInsert.error) return err(500, modernInsert.error.message);
    return ok({ item: normalizeFeedbackItem(legacyInsert.data as FeedbackRow) }, 201);
  }

  // ── feedback/:id/comments (add comment) ──
  if (slug[0] === 'feedback' && slug[1] && slug[2] === 'comments') {
    const feedbackId = slug[1];
    const { content, author } = body;
    if (!content?.trim()) return err(400, 'content_required');

    const modernInsert = await supabase
      .from('feedback_comments')
      .insert({ feedback_id: feedbackId, content: content.trim(), is_admin: true })
      .select()
      .single();

    if (!modernInsert.error) return ok({ comment: normalizeFeedbackComment(modernInsert.data as FeedbackCommentRow) }, 201);

    const legacyInsert = await supabase
      .from('feedback_comments')
      .insert({ feedback_id: feedbackId, content: content.trim(), author: author || 'ops-console' })
      .select()
      .single();
    if (legacyInsert.error) return err(500, modernInsert.error.message);
    return ok({ comment: normalizeFeedbackComment(legacyInsert.data as FeedbackCommentRow) }, 201);
  }

  // ── support/:id/messages (staff reply or internal note) ──
  if (slug[0] === 'support' && slug[1] && slug[2] === 'messages') {
    const ticketId = slug[1];
    const content = String(body.content || '').trim();
    const internal = body.internal === true || body.internal_note === true;
    const authorName = body.author_name ? String(body.author_name).trim() : 'Stuard Support';
    if (!content) return err(400, 'content_required');
    if (content.length > 10000) return err(400, 'content_too_long');

    const attachmentsValidation = validateSupportAttachments(body.attachments);
    if (!attachmentsValidation.ok) return err(400, attachmentsValidation.error);

    const { data: message, error } = await supabase
      .from('support_ticket_messages')
      .insert({
        ticket_id: ticketId,
        author_type: 'staff',
        author_name: authorName,
        content,
        internal_note: internal,
        attachments: attachmentsValidation.value,
      })
      .select()
      .single();
    if (error) return err(500, error.message);
    const [signed] = await signSupportAttachmentUrls(supabase, [message]);
    return ok({ message: signed }, 201);
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
        targets: targets || { website: true, cloud: true, desktop: true, vm: false },
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
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    const metadataUpdates: Record<string, unknown> = {};
    if (body.status) {
      updates.status = body.status;
      if (['resolved', 'closed'].includes(body.status)) metadataUpdates.resolved_at = now;
    }
    if (body.priority) updates.severity = body.priority;
    if (body.assigned_to !== undefined) metadataUpdates.assigned_to = body.assigned_to;
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (Object.keys(metadataUpdates).length > 0) {
      updates.metadata = metadataUpdates;
    }

    const modernUpdate = await supabase.from('feedback').update(updates).eq('id', feedbackId).select().single();
    if (!modernUpdate.error) return ok({ item: normalizeFeedbackItem(modernUpdate.data as FeedbackRow) });

    const legacyUpdates: Record<string, unknown> = { updated_at: now };
    if (body.status) {
      legacyUpdates.status = body.status;
      if (['resolved', 'closed'].includes(body.status)) legacyUpdates.resolved_at = now;
    }
    if (body.priority) legacyUpdates.priority = body.priority;
    if (body.assigned_to !== undefined) legacyUpdates.assigned_to = body.assigned_to;
    if (body.title) legacyUpdates.title = body.title;
    if (body.description !== undefined) legacyUpdates.description = body.description;

    const legacyUpdate = await supabase.from('feedback').update(legacyUpdates).eq('id', feedbackId).select().single();
    if (legacyUpdate.error) return err(500, modernUpdate.error.message);
    return ok({ item: normalizeFeedbackItem(legacyUpdate.data as FeedbackRow) });
  }

  // ── support/:id (update status / priority / assignment) ──
  if (slug[0] === 'support' && slug[1]) {
    const ticketId = slug[1];
    const updates: Record<string, unknown> = {};
    const VALID_STATUS = ['open', 'pending', 'awaiting_user', 'resolved', 'closed'];
    const VALID_PRIORITY = ['low', 'medium', 'high', 'urgent'];
    if (body.status) {
      if (!VALID_STATUS.includes(body.status)) return err(400, 'invalid_status');
      updates.status = body.status;
      if (['resolved', 'closed'].includes(body.status)) updates.resolved_at = new Date().toISOString();
      if (body.status === 'open') updates.resolved_at = null;
    }
    if (body.priority) {
      if (!VALID_PRIORITY.includes(body.priority)) return err(400, 'invalid_priority');
      updates.priority = body.priority;
    }
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to || null;
    if (body.category) updates.category = body.category;

    if (Object.keys(updates).length === 0) return err(400, 'no_fields');

    const { data, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticketId)
      .select()
      .single();
    if (error) return err(500, error.message);
    return ok({ ticket: data });
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
