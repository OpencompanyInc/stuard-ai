import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, getSupabaseService } from '../supabase';
import { resolveEmbedder } from '../utils/embeddings';
import { embed } from 'ai';

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
    const { name, description, spec, category, tags, icon, publisherName } = body;

    if (!name || !description || !spec) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'name, description, and spec are required' }));
      return true;
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
      try {
        embedding = await generateWorkflowEmbedding(name, description, tags || []);
      } catch (embeddingError) {
        console.warn('[marketplace] embedding generation skipped:', embeddingError);
        // Continue without embedding - search will fall back to text matching
      }
      
      const slug = generateSlug(name);

      const insertData: any = {
        publisher_id: user.userId,
        publisher_name: publisherName || user.email?.split('@')[0] || 'Anonymous',
        slug,
        name,
        description,
        version: spec.version || '1',
        spec,
        category: category || 'general',
        tags: tags || [],
        icon: icon || null,
        status: 'published',
        published_at: new Date().toISOString(),
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

      console.log('[marketplace] published workflow:', data?.slug);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflow: data }));
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
            .or(`name.ilike.%${query}%,description.ilike.%${query}%`);
          
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
  if (pathname.startsWith('/v1/marketplace/workflow/') && method === 'GET') {
    const slug = pathname.replace('/v1/marketplace/workflow/', '');
    
    const supabase = getSupabaseService();
    if (!supabase) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Database not available' }));
      return true;
    }

    try {
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('id, slug, name, description, version, spec, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at, published_at')
        .eq('slug', slug)
        .eq('status', 'published')
        .single();

      if (error || !data) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end(JSON.stringify({ error: 'Workflow not found' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify({ ok: true, workflow: data }));
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
        .select('id, slug, name, description, version, category, tags, icon, status, rating_avg, rating_count, download_count, created_at, published_at')
        .eq('publisher_id', user.userId)
        .order('created_at', { ascending: false });

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to fetch workflows' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflows: data || [] }));
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
    const { name, description, spec, category, tags, icon, changelog, version } = body;

    if (!spec) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'spec is required' }));
      return true;
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
        .select('id, publisher_id, version, spec')
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
      if (description || name || tags) {
        try {
          embedding = await generateWorkflowEmbedding(
            name || '',
            description || '',
            tags || []
          );
        } catch {
          // Continue without embedding
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
      if (category) updateData.category = category;
      if (tags) updateData.tags = tags;
      if (icon !== undefined) updateData.icon = icon;
      if (embedding) updateData.embedding = embedding;

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

      console.log('[marketplace] updated workflow:', data?.slug, 'to version', newVersion);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflow: data, previousVersion: oldVersion }));
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
        .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at')
        .eq('status', 'published')
        .eq('featured', true)
        .order('rating_avg', { ascending: false })
        .limit(12);

      // If we have featured workflows, return them
      if (featured && featured.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, workflows: featured }));
        return true;
      }

      // Otherwise, return popular workflows (sorted by downloads, then rating)
      const { data: popular } = await supabase
        .from('marketplace_workflows')
        .select('id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at')
        .eq('status', 'published')
        .order('download_count', { ascending: false })
        .order('rating_avg', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, workflows: popular || [] }));
    } catch (e: any) {
      console.error('[marketplace] featured error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message || 'Failed to fetch featured' }));
    }
    return true;
  }

  return false;
}
