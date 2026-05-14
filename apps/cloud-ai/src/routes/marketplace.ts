import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getSupabaseService } from '../supabase';
import { resolveEmbedder } from '../utils/embeddings';
import { embed } from 'ai';
import { analyzeWorkflowSecurity, quickSecurityCheck, type SecurityAnalysisResult } from '../marketplace/security-analyzer';
import { pingIndexNow, workflowUrl } from '../utils/indexnow';

// Helper to read JSON body
async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Generate embedding for workflow description
async function generateWorkflowEmbedding(name: string, description: string, tags: string[]): Promise<number[] | null> {
  try {
    const { embedder } = await resolveEmbedder();
    const text = [name, description, ...tags].filter(Boolean).join(' ');
    const { embedding } = await embed({ model: embedder as any, value: text });
    return embedding as number[];
  } catch (e) {
    console.error('[marketplace] embedding generation failed:', e);
    return null;
  }
}

// Generate a URL-friendly slug from name
function generateSlug(name: string, id?: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const suffix = id ? `-${id.slice(0, 8)}` : `-${Math.random().toString(36).slice(2, 8)}`;
  return base + suffix;
}

function sanitizeHandle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 32);
}

function buildShortDescription(description: string, shortDescription?: string | null): string {
  const normalized = (shortDescription || description || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 160);
}

function normalizeWorkflowMedia(media: any): Array<{
  media_type: 'image' | 'video';
  url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  sort_order: number;
}> {
  if (!Array.isArray(media)) return [];
  return media
    .map((item: any, index) => {
      const mediaType = item?.media_type === 'video' ? 'video' : item?.media_type === 'image' ? 'image' : null;
      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      if (!mediaType || !url) return null;
      return {
        media_type: mediaType,
        url,
        thumbnail_url: typeof item?.thumbnail_url === 'string' && item.thumbnail_url.trim() ? item.thumbnail_url.trim() : null,
        alt_text: typeof item?.alt_text === 'string' && item.alt_text.trim() ? item.alt_text.trim() : null,
        sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
      };
    })
    .filter(Boolean) as Array<{
      media_type: 'image' | 'video';
      url: string;
      thumbnail_url: string | null;
      alt_text: string | null;
      sort_order: number;
    }>;
}

function inferPrimaryImage(media: Array<{ media_type: 'image' | 'video'; url: string; thumbnail_url: string | null }>): string | null {
  const firstImage = media.find((item) => item.media_type === 'image');
  return firstImage?.thumbnail_url || firstImage?.url || null;
}

async function ensureUniqueCreatorHandle(supabase: any, requestedHandle: string, userId: string): Promise<string> {
  const base = sanitizeHandle(requestedHandle) || `creator-${userId.slice(0, 6)}`;
  let candidate = base;

  for (let i = 0; i < 20; i++) {
    const { data } = await supabase
      .from('marketplace_creators')
      .select('user_id')
      .eq('handle', candidate)
      .maybeSingle();

    if (!data || data.user_id === userId) {
      return candidate;
    }

    const suffix = `${i + 2}`;
    candidate = `${base.slice(0, Math.max(3, 31 - suffix.length))}${suffix}`;
  }

  return `${base.slice(0, 24)}-${userId.slice(0, 6)}`;
}

async function ensureCreatorProfile(
  supabase: any,
  user: { userId: string; email?: string | null },
  publisherName?: string,
  creatorProfile?: any
) {
  const { data: existingCreator } = await supabase
    .from('marketplace_creators')
    .select('user_id, handle, display_name, bio, avatar_url, hero_image_url, website_url, verified, follower_count, workflow_count')
    .eq('user_id', user.userId)
    .maybeSingle();

  const displayName = (creatorProfile?.display_name || existingCreator?.display_name || publisherName || user.email?.split('@')[0] || 'Anonymous').trim();
  const requestedHandle = creatorProfile?.handle || existingCreator?.handle || displayName || user.email?.split('@')[0] || user.userId.slice(0, 8);
  const handle = await ensureUniqueCreatorHandle(supabase, requestedHandle, user.userId);

  const payload = {
    user_id: user.userId,
    handle,
    display_name: displayName,
    bio: typeof creatorProfile?.bio === 'string' ? creatorProfile.bio.trim() || null : existingCreator?.bio || null,
    avatar_url: typeof creatorProfile?.avatar_url === 'string' ? creatorProfile.avatar_url.trim() || null : existingCreator?.avatar_url || null,
    hero_image_url: typeof creatorProfile?.hero_image_url === 'string' ? creatorProfile.hero_image_url.trim() || null : existingCreator?.hero_image_url || null,
    website_url: typeof creatorProfile?.website_url === 'string' ? creatorProfile.website_url.trim() || null : existingCreator?.website_url || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('marketplace_creators')
    .upsert(payload, { onConflict: 'user_id' })
    .select('user_id, handle, display_name, bio, avatar_url, hero_image_url, website_url, verified, follower_count, workflow_count')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function replaceWorkflowMedia(supabase: any, workflowId: string, media: any) {
  const normalizedMedia = normalizeWorkflowMedia(media);

  const { error: deleteError } = await supabase
    .from('marketplace_workflow_media')
    .delete()
    .eq('workflow_id', workflowId);

  if (deleteError) {
    throw deleteError;
  }

  if (normalizedMedia.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('marketplace_workflow_media')
    .insert(normalizedMedia.map((item) => ({ ...item, workflow_id: workflowId })))
    .select('id, workflow_id, media_type, url, thumbnail_url, alt_text, sort_order');

  if (error) {
    throw error;
  }

  return data || [];
}

async function getFollowingCreatorIds(supabase: any, viewerUserId: string | undefined, creatorIds: string[]) {
  if (!viewerUserId || creatorIds.length === 0) {
    return new Set<string>();
  }

  const { data } = await supabase
    .from('marketplace_creator_follows')
    .select('creator_id')
    .eq('follower_id', viewerUserId)
    .in('creator_id', creatorIds);

  return new Set((data || []).map((item: any) => item.creator_id));
}

async function enrichWorkflows(supabase: any, workflows: any[], viewerUserId?: string) {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return [];
  }

  const creatorIds = Array.from(new Set(workflows.map((workflow) => workflow.publisher_id).filter(Boolean)));
  const workflowIds = workflows.map((workflow) => workflow.id).filter(Boolean);

  const [{ data: creators }, { data: media }, followingIds] = await Promise.all([
    creatorIds.length
      ? supabase
          .from('marketplace_creators')
          .select('user_id, handle, display_name, bio, avatar_url, hero_image_url, website_url, verified, follower_count, workflow_count')
          .in('user_id', creatorIds)
      : Promise.resolve({ data: [] }),
    workflowIds.length
      ? supabase
          .from('marketplace_workflow_media')
          .select('id, workflow_id, media_type, url, thumbnail_url, alt_text, sort_order')
          .in('workflow_id', workflowIds)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    getFollowingCreatorIds(supabase, viewerUserId, creatorIds),
  ]);

  const creatorMap = new Map(
    (creators || []).map((creator: any) => [
      creator.user_id,
      {
        id: creator.user_id,
        handle: creator.handle,
        display_name: creator.display_name,
        bio: creator.bio,
        avatar_url: creator.avatar_url,
        hero_image_url: creator.hero_image_url,
        website_url: creator.website_url,
        verified: Boolean(creator.verified),
        follower_count: creator.follower_count || 0,
        workflow_count: creator.workflow_count || 0,
        is_following: followingIds.has(creator.user_id),
      },
    ])
  );

  const mediaMap = new Map<string, any[]>();
  for (const item of media || []) {
    const existing = mediaMap.get(item.workflow_id) || [];
    existing.push(item);
    mediaMap.set(item.workflow_id, existing);
  }

  return workflows.map((workflow) => ({
    ...workflow,
    short_description: workflow.short_description || buildShortDescription(workflow.description || '', workflow.short_description),
    creator: workflow.publisher_id ? creatorMap.get(workflow.publisher_id) : undefined,
    media: mediaMap.get(workflow.id) || [],
  }));
}

async function hydrateWorkflowRows(supabase: any, workflowIds: string[], viewerUserId?: string) {
  if (!workflowIds.length) {
    return [];
  }

  const { data } = await supabase
    .from('marketplace_workflows')
    .select('id, slug, name, description, short_description, version, spec, category, tags, icon, thumbnail_url, cover_image_url, rating_avg, rating_count, download_count, publisher_id, publisher_name, created_at, updated_at, published_at, status, locked')
    .in('id', workflowIds);

  const ordered = workflowIds
    .map((workflowId) => (data || []).find((workflow: any) => workflow.id === workflowId))
    .filter(Boolean);

  return enrichWorkflows(supabase, ordered, viewerUserId);
}

async function getCreatorProfileByHandle(supabase: any, handle: string, viewerUserId?: string) {
  const normalizedHandle = sanitizeHandle(decodeURIComponent(handle));
  const { data } = await supabase
    .from('marketplace_creators')
    .select('user_id, handle, display_name, bio, avatar_url, hero_image_url, website_url, verified, follower_count, workflow_count')
    .eq('handle', normalizedHandle)
    .maybeSingle();

  if (!data) {
    return null;
  }

  const followingIds = await getFollowingCreatorIds(supabase, viewerUserId, [data.user_id]);

  return {
    id: data.user_id,
    handle: data.handle,
    display_name: data.display_name,
    bio: data.bio,
    avatar_url: data.avatar_url,
    hero_image_url: data.hero_image_url,
    website_url: data.website_url,
    verified: Boolean(data.verified),
    follower_count: data.follower_count || 0,
    workflow_count: data.workflow_count || 0,
    is_following: followingIds.has(data.user_id),
  };
}

export async function handleMarketplaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL
): Promise<boolean> {
  const { pathname } = parsedUrl;
  const method = req.method?.toUpperCase() || 'GET';

  // POST /v1/marketplace/publish - Publish a workflow
  if (pathname === '/v1/marketplace/publish' && method === 'POST') {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const body = await readBody(req);
    const {
      name,
      description,
      shortDescription,
      spec,
      category,
      tags,
      icon,
      publisherName,
      thumbnailUrl,
      coverImageUrl,
      media,
      creatorProfile,
      locked,
    } = body;

    if (!name || !description || !spec) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'name, description, and spec are required' }));
      return true;
    }

    // Quick security check for obvious blockers
    const quickCheck = quickSecurityCheck(spec);
    if (quickCheck.blocked) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ 
        error: 'Security check failed', 
        reason: quickCheck.reason,
        code: 'SECURITY_BLOCKED'
      }));
      return true;
    }

    // Full AI-powered security analysis
    let securityAnalysis: SecurityAnalysisResult | null = null;
    try {
      console.log('[marketplace] Running security analysis for:', name);
      securityAnalysis = await analyzeWorkflowSecurity(spec, name, description);
      console.log('[marketplace] Security analysis result:', {
        passed: securityAnalysis.passed,
        score: securityAnalysis.overallScore,
        riskLevel: securityAnalysis.riskLevel,
        issueCount: securityAnalysis.issues.length
      });

      if (!securityAnalysis.passed) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ 
          error: 'Workflow did not pass security review',
          code: 'SECURITY_REVIEW_FAILED',
          analysis: {
            passed: securityAnalysis.passed,
            score: securityAnalysis.overallScore,
            riskLevel: securityAnalysis.riskLevel,
            issues: securityAnalysis.issues,
            warnings: securityAnalysis.warnings,
            summary: securityAnalysis.summary,
            recommendations: securityAnalysis.recommendations
          }
        }));
        return true;
      }
    } catch (analysisError) {
      console.error('[marketplace] Security analysis error (non-blocking):', analysisError);
      // Continue with publishing but flag for manual review
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Generate embedding from description (non-blocking - we can still publish without it)
      let embedding: number[] | null = null;
      let creator: any = null;
      const normalizedMedia = normalizeWorkflowMedia(media);
      try {
        embedding = await generateWorkflowEmbedding(name, description, tags || []);
      } catch (embeddingError) {
        console.warn('[marketplace] embedding generation skipped:', embeddingError);
        // Continue without embedding - search will fall back to text matching
      }

      try {
        creator = await ensureCreatorProfile(supabase, user, publisherName, creatorProfile);
      } catch (creatorError) {
        console.warn('[marketplace] creator profile upsert skipped:', creatorError);
      }
      
      const slug = generateSlug(name);

      const insertData: any = {
        publisher_id: user.userId,
        publisher_name: creator?.display_name || publisherName || user.email?.split('@')[0] || 'Anonymous',
        slug,
        name,
        description,
        short_description: buildShortDescription(description, shortDescription),
        version: spec.version || '1',
        spec,
        category: category || 'general',
        tags: tags || [],
        icon: icon || null,
        thumbnail_url: thumbnailUrl || inferPrimaryImage(normalizedMedia),
        cover_image_url: coverImageUrl || inferPrimaryImage(normalizedMedia),
        locked: Boolean(locked),
        status: 'published',
        published_at: new Date().toISOString(),
        security_score: securityAnalysis?.overallScore ?? null,
        security_risk_level: securityAnalysis?.riskLevel ?? null,
      };
      
      // Only include embedding if we have one
      if (embedding) {
        insertData.embedding = embedding;
      }

      const { data, error } = await supabase
        .from('marketplace_workflows')
        .insert(insertData)
        .select('id, slug, name')
        .single();

      if (error) {
        console.error('[marketplace] publish error:', error);
        // Provide more specific error messages
        let userMessage = 'Failed to publish workflow';
        if (error.code === '23505') { // Unique violation
          userMessage = 'A workflow with this name already exists. Try a different name.';
        } else if (error.message?.includes('permission')) {
          userMessage = 'You do not have permission to publish workflows.';
        }
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: userMessage }));
        return true;
      }

      try {
        await replaceWorkflowMedia(supabase, data.id, normalizedMedia);
      } catch (mediaError) {
        console.warn('[marketplace] workflow media save skipped:', mediaError);
      }

      const [workflow] = await hydrateWorkflowRows(supabase, [data.id], user.userId);

      console.log('[marketplace] published workflow:', data?.slug);
      if (data?.slug) pingIndexNow([workflowUrl(data.slug)]);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflow: workflow || data }));
    } catch (e: any) {
      console.error('[marketplace] publish exception:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Publish failed' }));
    }
    return true;
  }

  // GET /v1/marketplace/search - Search workflows by semantic similarity
  if (pathname === '/v1/marketplace/search' && method === 'GET') {
    const query = parsedUrl.searchParams.get('q') || '';
    const category = parsedUrl.searchParams.get('category');
    const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '20', 10), 50);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      let results: any[] = [];

      if (query.trim()) {
        // Try semantic search with embeddings first
        let useSemanticSearch = true;
        let embedding: number[] | null = null;
        
        try {
          embedding = await generateWorkflowEmbedding(query, '', []);
        } catch {
          console.warn('[marketplace] embedding generation failed, using text search');
          useSemanticSearch = false;
        }
        
        if (useSemanticSearch && embedding) {
          // Use pgvector cosine similarity search
          const { data, error } = await supabase.rpc('search_marketplace_workflows', {
            query_embedding: embedding,
            match_threshold: 0.25, // Lower threshold for more results
            match_count: limit,
            filter_category: category || null,
          });
          
          if (error) {
            console.error('[marketplace] search rpc error:', error);
            useSemanticSearch = false;
          } else if (data && data.length > 0) {
            results = data;
          } else {
            // Semantic search returned no results, try text search
            useSemanticSearch = false;
          }
        }
        
        // Fallback to text search if semantic search fails or returns no results
        if (!useSemanticSearch || results.length === 0) {
          let queryBuilder = supabase
            .from('marketplace_workflows')
            .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at')
            .eq('status', 'published')
            .or(`name.ilike.%${query}%,description.ilike.%${query}%,publisher_name.ilike.%${query}%`);
          
          if (category) {
            queryBuilder = queryBuilder.eq('category', category);
          }
          
          const { data: fallbackData, error: fallbackError } = await queryBuilder
            .order('download_count', { ascending: false })
            .limit(limit)
            .range(offset, offset + limit - 1);
            
          if (fallbackError) {
            console.error('[marketplace] text search error:', fallbackError);
          }
          results = fallbackData || [];
        }
      } else {
        // No query - return popular/recent workflows
        let queryBuilder = supabase
          .from('marketplace_workflows')
          .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at')
          .eq('status', 'published');
        
        if (category) {
          queryBuilder = queryBuilder.eq('category', category);
        }
        
        const { data, error } = await queryBuilder
          .order('download_count', { ascending: false })
          .order('rating_avg', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          console.error('[marketplace] list error:', error);
        }
        results = data || [];
      }

      const workflowIds = results.map((workflow) => workflow.id).filter(Boolean);
      if (workflowIds.length > 0) {
        const hydrated = await hydrateWorkflowRows(supabase, workflowIds, user?.userId);
        if (results.some((workflow) => typeof workflow.similarity === 'number')) {
          const similarityMap = new Map(results.map((workflow) => [workflow.id, workflow.similarity]));
          results = hydrated.map((workflow) => ({ ...workflow, similarity: similarityMap.get(workflow.id) }));
        } else {
          results = hydrated;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, results, count: results.length }));
    } catch (e: any) {
      console.error('[marketplace] search exception:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Search failed' }));
    }
    return true;
  }

  // GET /v1/marketplace/workflow/:slug - Get a single workflow
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+$/) && method === 'GET') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();

      if (error || !data) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      const [workflow] = await hydrateWorkflowRows(supabase, [data.id], user?.userId);

      if (!workflow) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ ok: true, workflow }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch workflow' }));
    }
    return true;
  }

  // POST /v1/marketplace/workflow/:slug/download - Track a download
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+\/download$/) && method === 'POST') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '').replace('/download', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Get workflow ID by slug
      const { data: workflow, error: fetchError } = await supabase
        .from('marketplace_workflows')
        .select('id, spec')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

      if (fetchError) {
        console.error('[marketplace] download fetch error:', fetchError);
      }

      if (!workflow) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      // Track download (don't fail if tracking fails)
      try {
        await supabase.from('marketplace_downloads').insert({
          workflow_id: workflow.id,
          user_id: user?.userId || null,
        });
      } catch (trackError) {
        console.error('[marketplace] download tracking error:', trackError);
        // Continue anyway - the download itself should still succeed
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ ok: true, spec: workflow.spec }));
    } catch (e: any) {
      console.error('[marketplace] download exception:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: e.message || 'Download failed' }));
    }
    return true;
  }

  // POST /v1/marketplace/workflow/:slug/rate - Rate a workflow
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+\/rate$/) && method === 'POST') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '').replace('/rate', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const body = await readBody(req);
    const { rating, review } = body;

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: 'Rating must be between 1 and 5' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Get workflow ID by slug
      const { data: workflow } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

      if (!workflow) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      // Check if user already rated this workflow
      const { data: existingRating } = await supabase
        .from('marketplace_ratings')
        .select('id')
        .eq('workflow_id', workflow.id)
        .eq('user_id', user.userId)
        .single();

      let ratingError;
      if (existingRating) {
        // Update existing rating
        const { error } = await supabase
          .from('marketplace_ratings')
          .update({
            rating: Math.round(rating),
            review: review || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingRating.id);
        ratingError = error;
      } else {
        // Insert new rating
        const { error } = await supabase
          .from('marketplace_ratings')
          .insert({
            workflow_id: workflow.id,
            user_id: user.userId,
            rating: Math.round(rating),
            review: review || null,
          });
        ratingError = error;
      }

      if (ratingError) {
        console.error('[marketplace] rating error:', ratingError);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to save rating' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Rating failed' }));
    }
    return true;
  }

  // GET /v1/marketplace/my-workflows - Get current user's published workflows
  if (pathname === '/v1/marketplace/my-workflows' && method === 'GET') {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('publisher_id', user.userId)
        .order('created_at', { ascending: false });

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to fetch workflows' }));
        return true;
      }

      const workflows = await hydrateWorkflowRows(supabase, (data || []).map((item: any) => item.id), user.userId);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflows }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch workflows' }));
    }
    return true;
  }

  // PUT /v1/marketplace/workflow/:slug - Update an existing workflow
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+$/) && method === 'PUT') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const body = await readBody(req);
    const {
      name,
      description,
      shortDescription,
      spec,
      category,
      tags,
      icon,
      thumbnailUrl,
      coverImageUrl,
      media,
      creatorProfile,
      changelog,
      version,
      locked,
    } = body;

    if (!spec) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'spec is required' }));
      return true;
    }

    // Security checks for updated spec
    const quickCheck = quickSecurityCheck(spec);
    if (quickCheck.blocked) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        error: 'Security check failed',
        reason: quickCheck.reason,
        code: 'SECURITY_BLOCKED'
      }));
      return true;
    }

    let securityAnalysis: SecurityAnalysisResult | null = null;
    try {
      console.log('[marketplace] Running security analysis for update:', name || slug);
      securityAnalysis = await analyzeWorkflowSecurity(spec, name || slug, description || '');
      console.log('[marketplace] Update security analysis:', {
        passed: securityAnalysis.passed,
        score: securityAnalysis.overallScore,
        riskLevel: securityAnalysis.riskLevel,
        issueCount: securityAnalysis.issues.length
      });

      if (!securityAnalysis.passed) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: 'Workflow update did not pass security review',
          code: 'SECURITY_REVIEW_FAILED',
          analysis: {
            passed: securityAnalysis.passed,
            score: securityAnalysis.overallScore,
            riskLevel: securityAnalysis.riskLevel,
            issues: securityAnalysis.issues,
            warnings: securityAnalysis.warnings,
            summary: securityAnalysis.summary,
            recommendations: securityAnalysis.recommendations
          }
        }));
        return true;
      }
    } catch (analysisError) {
      console.error('[marketplace] Update security analysis error (non-blocking):', analysisError);
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Get existing workflow and verify ownership
      const { data: existing, error: fetchError } = await supabase
        .from('marketplace_workflows')
        .select('id, publisher_id, version, spec, name, description, tags')
        .eq('slug', slug)
        .single();

      if (fetchError || !existing) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      if (existing.publisher_id !== user.userId) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'You can only update your own workflows' }));
        return true;
      }

      // Calculate new version number
      const oldVersion = existing.version || '1';
      let newVersion = version;
      if (!newVersion) {
        // Auto-increment version
        const vParts = oldVersion.split('.');
        if (vParts.length >= 2) {
          // Increment minor version: 1.0 -> 1.1
          vParts[vParts.length - 1] = String(parseInt(vParts[vParts.length - 1] || '0', 10) + 1);
          newVersion = vParts.join('.');
        } else {
          // Simple version: 1 -> 2
          newVersion = String(parseInt(oldVersion, 10) + 1);
        }
      }

      // Store old version in version history
      try {
        await supabase.from('marketplace_workflow_versions').insert({
          workflow_id: existing.id,
          version: oldVersion,
          spec: existing.spec,
          changelog: changelog || null,
        });
      } catch (versionError) {
        console.warn('[marketplace] failed to store version history:', versionError);
        // Continue with update anyway
      }

      // Generate new embedding if description changed
      let embedding: number[] | null = null;
      const normalizedMedia = media !== undefined ? normalizeWorkflowMedia(media) : null;
      if (description || name || tags) {
        try {
          embedding = await generateWorkflowEmbedding(
            name || existing.name || '',
            description || existing.description || '',
            tags || existing.tags || []
          );
        } catch {
          // Continue without embedding
        }
      }

      if (creatorProfile) {
        try {
          await ensureCreatorProfile(supabase, user, name || existing.name, creatorProfile);
        } catch (creatorError) {
          console.warn('[marketplace] creator profile update skipped:', creatorError);
        }
      }

      // Build update data
      const updateData: any = {
        spec,
        version: newVersion,
        updated_at: new Date().toISOString(),
      };

      if (name) updateData.name = name;
      if (description) updateData.description = description;
      if (creatorProfile?.display_name) updateData.publisher_name = creatorProfile.display_name;
      if (description || shortDescription !== undefined) {
        updateData.short_description = buildShortDescription(description || existing.description || '', shortDescription);
      }
      if (category) updateData.category = category;
      if (tags) updateData.tags = tags;
      if (icon !== undefined) updateData.icon = icon;
      if (locked !== undefined) updateData.locked = Boolean(locked);
      if (thumbnailUrl !== undefined) {
        updateData.thumbnail_url = thumbnailUrl || inferPrimaryImage(normalizedMedia || []);
      } else if (normalizedMedia) {
        updateData.thumbnail_url = inferPrimaryImage(normalizedMedia);
      }
      if (coverImageUrl !== undefined) {
        updateData.cover_image_url = coverImageUrl || inferPrimaryImage(normalizedMedia || []);
      } else if (normalizedMedia) {
        updateData.cover_image_url = inferPrimaryImage(normalizedMedia);
      }
      if (embedding) updateData.embedding = embedding;
      if (securityAnalysis) {
        updateData.security_score = securityAnalysis.overallScore;
        updateData.security_risk_level = securityAnalysis.riskLevel;
      }

      const { data, error } = await supabase
        .from('marketplace_workflows')
        .update(updateData)
        .eq('id', existing.id)
        .select('id, slug, name, version')
        .single();

      if (error) {
        console.error('[marketplace] update error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to update workflow' }));
        return true;
      }

      if (normalizedMedia) {
        try {
          await replaceWorkflowMedia(supabase, existing.id, normalizedMedia);
        } catch (mediaError) {
          console.warn('[marketplace] workflow media update skipped:', mediaError);
        }
      }

      const [workflow] = await hydrateWorkflowRows(supabase, [existing.id], user.userId);

      console.log('[marketplace] updated workflow:', data?.slug, 'to version', newVersion);
      if (data?.slug) pingIndexNow([workflowUrl(data.slug)]);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflow: workflow || data, previousVersion: oldVersion }));
    } catch (e: any) {
      console.error('[marketplace] update exception:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Update failed' }));
    }
    return true;
  }

  // GET /v1/marketplace/workflow/:slug/versions - Get version history
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+\/versions$/) && method === 'GET') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '').replace('/versions', '');

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Get workflow ID by slug
      const { data: workflow } = await supabase
        .from('marketplace_workflows')
        .select('id, version')
        .eq('slug', slug)
        .single();

      if (!workflow) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      // Get version history
      const { data: versions, error } = await supabase
        .from('marketplace_workflow_versions')
        .select('id, version, changelog, created_at')
        .eq('workflow_id', workflow.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[marketplace] versions fetch error:', error);
      }

      // Include current version at the top
      const allVersions = [
        { version: workflow.version, changelog: 'Current version', created_at: new Date().toISOString(), current: true },
        ...(versions || []).map((v: any) => ({ ...v, current: false })),
      ];

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, versions: allVersions }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch versions' }));
    }
    return true;
  }

  // GET /v1/marketplace/creator/:handle - Get creator profile and published workflows
  if (pathname.match(/^\/v1\/marketplace\/creator\/[^/]+$/) && method === 'GET') {
    const handle = pathname.replace('/v1/marketplace/creator/', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const creator = await getCreatorProfileByHandle(supabase, handle, user?.userId);
      if (!creator) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Creator not found' }));
        return true;
      }

      const { data } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('publisher_id', creator.id)
        .eq('status', 'published')
        .order('featured', { ascending: false })
        .order('download_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      const workflows = await hydrateWorkflowRows(supabase, (data || []).map((item: any) => item.id), user?.userId);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, creator, workflows }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch creator' }));
    }
    return true;
  }

  // POST /v1/marketplace/creator/:handle/follow - Follow a creator
  if (pathname.match(/^\/v1\/marketplace\/creator\/[^/]+\/follow$/) && method === 'POST') {
    const handle = pathname.replace('/v1/marketplace/creator/', '').replace('/follow', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const creator = await getCreatorProfileByHandle(supabase, handle, user.userId);
      if (!creator) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Creator not found' }));
        return true;
      }

      if (creator.id === user.userId) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'You cannot follow yourself' }));
        return true;
      }

      const { error } = await supabase
        .from('marketplace_creator_follows')
        .upsert({ creator_id: creator.id, follower_id: user.userId }, { onConflict: 'creator_id,follower_id' });

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to follow creator' }));
        return true;
      }

      const updatedCreator = await getCreatorProfileByHandle(supabase, handle, user.userId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, creator: updatedCreator }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Follow failed' }));
    }
    return true;
  }

  // DELETE /v1/marketplace/creator/:handle/follow - Unfollow a creator
  if (pathname.match(/^\/v1\/marketplace\/creator\/[^/]+\/follow$/) && method === 'DELETE') {
    const handle = pathname.replace('/v1/marketplace/creator/', '').replace('/follow', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const creator = await getCreatorProfileByHandle(supabase, handle, user.userId);
      if (!creator) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Creator not found' }));
        return true;
      }

      const { error } = await supabase
        .from('marketplace_creator_follows')
        .delete()
        .eq('creator_id', creator.id)
        .eq('follower_id', user.userId);

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to unfollow creator' }));
        return true;
      }

      const updatedCreator = await getCreatorProfileByHandle(supabase, handle, user.userId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, creator: updatedCreator }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Unfollow failed' }));
    }
    return true;
  }

  // POST /v1/marketplace/check-updates - Check for updates on downloaded workflows
  if (pathname === '/v1/marketplace/check-updates' && method === 'POST') {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const body = await readBody(req);
    const { workflows } = body; // Array of { slug, version }

    if (!Array.isArray(workflows)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'workflows array is required' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const slugs = workflows.map((w: any) => w.slug).filter(Boolean);
      if (slugs.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, updates: [] }));
        return true;
      }

      // Get current versions for all slugs
      const { data: currentWorkflows, error } = await supabase
        .from('marketplace_workflows')
        .select('slug, version, name, updated_at')
        .in('slug', slugs)
        .eq('status', 'published');

      if (error) {
        console.error('[marketplace] check-updates error:', error);
      }

      // Compare versions
      const updates: any[] = [];
      for (const w of workflows) {
        const current = (currentWorkflows || []).find((c: any) => c.slug === w.slug);
        if (current && current.version !== w.version) {
          updates.push({
            slug: w.slug,
            name: current.name,
            currentVersion: w.version,
            latestVersion: current.version,
            updatedAt: current.updated_at,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, updates }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Check failed' }));
    }
    return true;
  }

  // DELETE /v1/marketplace/workflow/:slug - Unpublish/remove a workflow
  if (pathname.match(/^\/v1\/marketplace\/workflow\/[^/]+$/) && method === 'DELETE') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '');
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // Only allow owner to delete
      const { error } = await supabase
        .from('marketplace_workflows')
        .update({ status: 'removed', updated_at: new Date().toISOString() })
        .eq('slug', slug)
        .eq('publisher_id', user.userId);

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to remove workflow' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Remove failed' }));
    }
    return true;
  }

  // GET /v1/marketplace/categories - List available categories
  if (pathname === '/v1/marketplace/categories' && method === 'GET') {
    const categories = [
      { id: 'productivity', name: 'Productivity', description: 'Task management, scheduling, and efficiency tools' },
      { id: 'automation', name: 'Automation', description: 'File processing, system tasks, and repetitive workflows' },
      { id: 'data', name: 'Data Processing', description: 'Data extraction, transformation, and analysis' },
      { id: 'integration', name: 'Integrations', description: 'Connect apps and services together' },
      { id: 'ai', name: 'AI & ML', description: 'Workflows using AI models and machine learning' },
      { id: 'media', name: 'Media', description: 'Image, video, and audio processing' },
      { id: 'developer', name: 'Developer', description: 'Development and DevOps workflows' },
      { id: 'communication', name: 'Communication', description: 'Email, messaging, and notifications' },
      { id: 'general', name: 'General', description: 'Miscellaneous workflows' },
    ];

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, categories }));
    return true;
  }

  // GET /v1/marketplace/featured - Get featured workflows (falls back to popular if none)
  if (pathname === '/v1/marketplace/featured' && method === 'GET') {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    const user = auth ? await verifyToken(auth) : null;
    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      // First try to get featured workflows
      const { data: featured } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('status', 'published')
        .eq('featured', true)
        .order('rating_avg', { ascending: false })
        .limit(12);

      // If we have featured workflows, return them
      if (featured && featured.length > 0) {
        const workflows = await hydrateWorkflowRows(supabase, featured.map((item: any) => item.id), user?.userId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, workflows }));
        return true;
      }

      // Otherwise, return popular workflows (sorted by downloads, then rating)
      const { data: popular } = await supabase
        .from('marketplace_workflows')
        .select('id')
        .eq('status', 'published')
        .order('download_count', { ascending: false })
        .order('rating_avg', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12);

      const workflows = await hydrateWorkflowRows(supabase, (popular || []).map((item: any) => item.id), user?.userId);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflows }));
    } catch (e: any) {
      console.error('[marketplace] featured error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch featured' }));
    }
    return true;
  }

  return false;
}
