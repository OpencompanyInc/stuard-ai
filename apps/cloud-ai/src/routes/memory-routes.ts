/**
 * Memory API Routes
 * 
 * HTTP endpoints for conversation memory, spaces, and security settings.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { hasClientBridge } from '../tools/bridge';
import * as memory from '../memory/conversations';

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

export async function handleMemoryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method || 'GET';

  // Check bridge availability for routes that need it
  const needsBridge = path.startsWith('/v1/memory/');
  if (needsBridge && !hasClientBridge()) {
    return json(res, { ok: false, error: 'No client bridge available' }, 503), true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONVERSATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/conversations - List conversations
  if (path === '/v1/memory/conversations' && method === 'GET') {
    const status = url.searchParams.get('status') as 'active' | 'archived' | null;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    try {
      const conversations = await memory.listConversations({ 
        status: status || undefined, 
        limit, 
        offset 
      });
      return json(res, { ok: true, conversations, count: conversations.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/conversations - Create conversation
  if (path === '/v1/memory/conversations' && method === 'POST') {
    const body = await readBody(req);
    const { title, model, conversation_id } = body;

    try {
      const conversation = await memory.createConversation(title, model, conversation_id);
      if (!conversation) {
        return json(res, { ok: false, error: 'failed_to_create' }, 500), true;
      }
      return json(res, { ok: true, conversation }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/conversations/search - Search conversations
  if (path === '/v1/memory/conversations/search' && method === 'POST') {
    const body = await readBody(req);
    const { query, limit, threshold } = body;

    if (!query) {
      return json(res, { ok: false, error: 'missing_query' }, 400), true;
    }

    try {
      const results = await memory.searchConversations(query, { limit, threshold });
      return json(res, { ok: true, results, count: results.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // GET /v1/memory/conversations/:id - Get conversation
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+$/) && method === 'GET') {
    const id = path.split('/v1/memory/conversations/')[1];

    try {
      const conversation = await memory.getConversation(id);
      if (!conversation) {
        return json(res, { ok: false, error: 'not_found' }, 404), true;
      }
      return json(res, { ok: true, conversation }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // PATCH /v1/memory/conversations/:id - Update conversation
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+$/) && method === 'PATCH') {
    const id = path.split('/v1/memory/conversations/')[1];
    const body = await readBody(req);
    const { title, status } = body;

    try {
      const conversation = await memory.updateConversation(id, { title, status });
      if (!conversation) {
        return json(res, { ok: false, error: 'not_found' }, 404), true;
      }
      return json(res, { ok: true, conversation }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/conversations/:id/messages - Get messages
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+\/messages$/) && method === 'GET') {
    const id = path.split('/v1/memory/conversations/')[1].replace('/messages', '');
    const start_turn = url.searchParams.get('start_turn');
    const end_turn = url.searchParams.get('end_turn');
    const limit = url.searchParams.get('limit');

    try {
      const messages = await memory.getMessages(id, {
        start_turn: start_turn ? parseInt(start_turn, 10) : undefined,
        end_turn: end_turn ? parseInt(end_turn, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return json(res, { ok: true, messages, count: messages.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/conversations/:id/messages - Add message
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+\/messages$/) && method === 'POST') {
    const id = path.split('/v1/memory/conversations/')[1].replace('/messages', '');
    const body = await readBody(req);
    const { role, content, tool_calls, tool_results, attachments } = body;

    if (!role || !content) {
      return json(res, { ok: false, error: 'missing_role_or_content' }, 400), true;
    }

    try {
      const message = await memory.addMessage(id, role, content, {
        tool_calls,
        tool_results,
        attachments,
      });
      if (!message) {
        return json(res, { ok: false, error: 'failed_to_add' }, 500), true;
      }
      return json(res, { ok: true, message }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SEGMENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/conversations/:id/segments - Get segments
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+\/segments$/) && method === 'GET') {
    const id = path.split('/v1/memory/conversations/')[1].replace('/segments', '');

    try {
      const segments = await memory.getSegments(id);
      return json(res, { ok: true, segments, count: segments.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/segments/search - Search segments
  if (path === '/v1/memory/segments/search' && method === 'POST') {
    const body = await readBody(req);
    const { query, limit, threshold } = body;

    if (!query) {
      return json(res, { ok: false, error: 'missing_query' }, 400), true;
    }

    try {
      const results = await memory.searchSegments(query, { limit, threshold });
      return json(res, { ok: true, results, count: results.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SPACES
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/spaces - List spaces
  if (path === '/v1/memory/spaces' && method === 'GET') {
    const type = url.searchParams.get('type') as any;
    const include_archived = url.searchParams.get('include_archived') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    try {
      const spaces = await memory.listSpaces({ type, include_archived, limit });
      return json(res, { ok: true, spaces, count: spaces.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/spaces - Create space
  if (path === '/v1/memory/spaces' && method === 'POST') {
    const body = await readBody(req);
    const { name, type, description, icon, color } = body;

    if (!name || !type) {
      return json(res, { ok: false, error: 'missing_name_or_type' }, 400), true;
    }

    try {
      const space = await memory.createSpace(name, type, { description, icon, color });
      if (!space) {
        return json(res, { ok: false, error: 'failed_to_create' }, 500), true;
      }
      return json(res, { ok: true, space }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // GET /v1/memory/spaces/:id - Get space
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+$/) && method === 'GET') {
    const id = path.split('/v1/memory/spaces/')[1];

    try {
      const space = await memory.getSpace(id);
      if (!space) {
        return json(res, { ok: false, error: 'not_found' }, 404), true;
      }
      return json(res, { ok: true, space }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // PATCH /v1/memory/spaces/:id - Update space
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+$/) && method === 'PATCH') {
    const id = path.split('/v1/memory/spaces/')[1];
    const body = await readBody(req);
    const { name, description, icon, color, archived } = body;

    try {
      const space = await memory.updateSpace(id, { name, description, icon, color, archived });
      if (!space) {
        return json(res, { ok: false, error: 'not_found' }, 404), true;
      }
      return json(res, { ok: true, space }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // DELETE /v1/memory/spaces/:id - Delete space
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+$/) && method === 'DELETE') {
    const id = path.split('/v1/memory/spaces/')[1];

    try {
      const deleted = await memory.deleteSpace(id);
      return json(res, { ok: true, deleted }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SPACE ITEMS
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/spaces/:id/items - Get space items
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+\/items$/) && method === 'GET') {
    const id = path.split('/v1/memory/spaces/')[1].replace('/items', '');
    const type = url.searchParams.get('type') as any;
    const pinned_only = url.searchParams.get('pinned_only') === 'true';
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    try {
      const items = await memory.getSpaceItems(id, { type, pinned_only, limit });
      return json(res, { ok: true, items, count: items.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/spaces/:id/items - Add space item
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+\/items$/) && method === 'POST') {
    const id = path.split('/v1/memory/spaces/')[1].replace('/items', '');
    const body = await readBody(req);
    const { type, content, title, metadata, added_by, pinned } = body;

    if (!type || !content) {
      return json(res, { ok: false, error: 'missing_type_or_content' }, 400), true;
    }

    try {
      const item = await memory.addSpaceItem(id, type, content, {
        title,
        metadata,
        added_by,
        pinned,
      });
      if (!item) {
        return json(res, { ok: false, error: 'failed_to_add' }, 500), true;
      }
      return json(res, { ok: true, item }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // PATCH /v1/memory/items/:id - Update space item
  if (path.match(/^\/v1\/memory\/items\/[^/]+$/) && method === 'PATCH') {
    const id = path.split('/v1/memory/items/')[1];
    const body = await readBody(req);
    const { title, content, metadata, pinned } = body;

    try {
      const item = await memory.updateSpaceItem(id, { title, content, metadata, pinned });
      if (!item) {
        return json(res, { ok: false, error: 'not_found' }, 404), true;
      }
      return json(res, { ok: true, item }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // DELETE /v1/memory/items/:id - Delete space item
  if (path.match(/^\/v1\/memory\/items\/[^/]+$/) && method === 'DELETE') {
    const id = path.split('/v1/memory/items/')[1];

    try {
      const deleted = await memory.deleteSpaceItem(id);
      return json(res, { ok: true, deleted }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SPACE-CONVERSATION LINKS
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/spaces/:id/conversations - Get space conversations
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+\/conversations$/) && method === 'GET') {
    const id = path.split('/v1/memory/spaces/')[1].replace('/conversations', '');

    try {
      const conversations = await memory.getSpaceConversations(id);
      return json(res, { ok: true, conversations, count: conversations.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/spaces/:id/conversations - Link conversation to space
  if (path.match(/^\/v1\/memory\/spaces\/[^/]+\/conversations$/) && method === 'POST') {
    const id = path.split('/v1/memory/spaces/')[1].replace('/conversations', '');
    const body = await readBody(req);
    const { conversation_id, relevance_score, auto_linked } = body;

    if (!conversation_id) {
      return json(res, { ok: false, error: 'missing_conversation_id' }, 400), true;
    }

    try {
      const linked = await memory.linkConversationToSpace(id, conversation_id, {
        relevance_score,
        auto_linked,
      });
      return json(res, { ok: linked }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // GET /v1/memory/conversations/:id/spaces - Get conversation spaces
  if (path.match(/^\/v1\/memory\/conversations\/[^/]+\/spaces$/) && method === 'GET') {
    const id = path.split('/v1/memory/conversations/')[1].replace('/spaces', '');

    try {
      const spaces = await memory.getConversationSpaces(id);
      return json(res, { ok: true, spaces, count: spaces.length }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/security - Get security settings
  if (path === '/v1/memory/security' && method === 'GET') {
    try {
      const settings = await memory.getSecuritySettings();
      if (!settings) {
        return json(res, { ok: false, error: 'failed_to_get_settings' }, 500), true;
      }
      return json(res, { ok: true, settings }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // PATCH /v1/memory/security - Update security settings
  if (path === '/v1/memory/security' && method === 'PATCH') {
    const body = await readBody(req);
    const { memory_lock_enabled, lock_timeout_minutes, biometric_enabled, sync_enabled } = body;

    try {
      const updated = await memory.updateSecuritySettings({
        memory_lock_enabled,
        lock_timeout_minutes,
        biometric_enabled,
        sync_enabled,
      });
      return json(res, { ok: updated }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/security/password - Set password
  if (path === '/v1/memory/security/password' && method === 'POST') {
    const body = await readBody(req);
    const { password, current_password } = body;

    if (!password) {
      return json(res, { ok: false, error: 'missing_password' }, 400), true;
    }

    try {
      const result = await memory.setMemoryPassword(password, current_password);
      return json(res, result), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // POST /v1/memory/security/verify - Verify password
  if (path === '/v1/memory/security/verify' && method === 'POST') {
    const body = await readBody(req);
    const { password } = body;

    if (!password) {
      return json(res, { ok: false, error: 'missing_password' }, 400), true;
    }

    try {
      const valid = await memory.verifyMemoryPassword(password);
      return json(res, { ok: true, valid }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════════

  // GET /v1/memory/stats - Get memory stats
  if (path === '/v1/memory/stats' && method === 'GET') {
    try {
      const stats = await memory.getMemoryStats();
      if (!stats) {
        return json(res, { ok: false, error: 'failed_to_get_stats' }, 500), true;
      }
      return json(res, { ok: true, stats }), true;
    } catch (error) {
      return json(res, { ok: false, error: String(error) }, 500), true;
    }
  }

  return false;
}
