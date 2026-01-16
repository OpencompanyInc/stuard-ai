/**
 * Knowledge Graph API Routes
 * 
 * HTTP endpoints for managing the Entity-Fact Knowledge Graph.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { writeLog } from '../utils/logger';
import {
  buildKnowledgeContext,
  buildQuickContext,
  getKnowledgeStats,
  getIdentityLens,
  getDirectiveLens,
  getBioLens,
} from '../knowledge';
import { execLocalTool, hasClientBridge } from '../tools/bridge';

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

async function getAuth(req: IncomingMessage): Promise<{ userId: string } | null> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return verifyToken(token);
}

export async function handleKnowledgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method || 'GET';

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/stats - Get knowledge graph statistics
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/stats' && method === 'GET') {
    try {
      const stats = await getKnowledgeStats();
      return json(res, { ok: true, stats }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/context - Build context block for a query
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/context' && method === 'GET') {
    const query = url.searchParams.get('q') || '';
    const includeIdentity = url.searchParams.get('identity') !== 'false';
    const includeDirectives = url.searchParams.get('directives') !== 'false';
    const includeBio = url.searchParams.get('bio') === 'true';
    const maxFacts = parseInt(url.searchParams.get('maxFacts') || '8', 10);

    try {
      const context = await buildKnowledgeContext(query, {
        includeIdentity,
        includeDirectives,
        includeBio,
        maxGlobalFacts: maxFacts,
        detectEntities: true,
      });
      return json(res, { ok: true, ...context }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/quick - Get quick context (identity + directives only)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/quick' && method === 'GET') {
    try {
      const text = await buildQuickContext();
      return json(res, { ok: true, text }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/identity - Get identity lens (core profile)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/identity' && method === 'GET') {
    try {
      const facts = await getIdentityLens();
      return json(res, { ok: true, facts }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/directives - Get directive lens (system instructions)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/directives' && method === 'GET') {
    try {
      const facts = await getDirectiveLens();
      return json(res, { ok: true, facts }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/bio - Get bio lens (personal facts)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/bio' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    try {
      const facts = await getBioLens(limit);
      return json(res, { ok: true, facts }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/entities - List all entities
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/entities' && method === 'GET') {
    const type = url.searchParams.get('type') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const entities = await execLocalTool('knowledge_list_entities', { type, limit }, undefined, 5000);
      return json(res, { ok: true, entities }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /v1/knowledge/entities - Create a new entity
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/entities' && method === 'POST') {
    const body = await readBody(req);
    const { name, type, summary } = body;
    
    if (!name) {
      return json(res, { ok: false, error: 'name is required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_create_entity', {
        name,
        type: type || 'topic',
        summary: summary || '',
      }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/entities/:name - Get entity context by name
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path.startsWith('/v1/knowledge/entities/') && method === 'GET') {
    const name = decodeURIComponent(path.split('/v1/knowledge/entities/')[1] || '');
    
    if (!name) {
      return json(res, { ok: false, error: 'Entity name required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_get_entity_context', { name }, undefined, 5000);
      return json(res, { ok: true, ...result }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /v1/knowledge/facts - Add a new fact
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/facts' && method === 'POST') {
    const body = await readBody(req);
    const { category, subtype, text, entity_id, attribute_key, source } = body;
    
    if (!category || !subtype || !text) {
      return json(res, { ok: false, error: 'category, subtype, and text are required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_add_fact', {
        category,
        subtype,
        text,
        entity_id,
        attribute_key,
        source: source || 'user_manual',
      }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /v1/knowledge/profile - Update core profile fact
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/profile' && method === 'POST') {
    const body = await readBody(req);
    const { key, value } = body;
    
    if (!key || !value) {
      return json(res, { ok: false, error: 'key and value are required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_upsert_core', {
        key,
        value,
        source: 'user_manual',
      }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /v1/knowledge/instructions - Add system instruction
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/instructions' && method === 'POST') {
    const body = await readBody(req);
    const { text } = body;
    
    if (!text) {
      return json(res, { ok: false, error: 'text is required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_add_fact', {
        category: 'instruction',
        subtype: 'system',
        text,
        source: 'user_manual',
      }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE /v1/knowledge/facts/:id - Delete a fact
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path.startsWith('/v1/knowledge/facts/') && method === 'DELETE') {
    const id = path.split('/v1/knowledge/facts/')[1] || '';
    
    if (!id) {
      return json(res, { ok: false, error: 'Fact ID required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_delete_fact', { id }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE /v1/knowledge/entities/:id - Delete an entity
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path.startsWith('/v1/knowledge/entities/') && method === 'DELETE') {
    const id = path.split('/v1/knowledge/entities/')[1] || '';
    
    if (!id) {
      return json(res, { ok: false, error: 'Entity ID required' }, 400), true;
    }
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_delete_entity', { id }, undefined, 5000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/procedural - Get procedural snippets
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/procedural' && method === 'GET') {
    const entityId = url.searchParams.get('entity_id') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const facts = await execLocalTool('knowledge_get_procedural', { entity_id: entityId, limit }, undefined, 5000);
      return json(res, { ok: true, facts }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/events - Get event history
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/events' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const facts = await execLocalTool('knowledge_get_events', { limit }, undefined, 5000);
      return json(res, { ok: true, facts }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /v1/knowledge/graph - Get knowledge graph (nodes + edges)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (path === '/v1/knowledge/graph' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const threshold = parseFloat(url.searchParams.get('threshold') || '0.7');
    
    if (!hasClientBridge()) {
      return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
    }
    
    try {
      const result = await execLocalTool('knowledge_get_graph', { limit, threshold }, undefined, 10000);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  return false;
}
