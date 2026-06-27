
import { type IncomingMessage, type ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { resolveGoogleAccountForRoute } from './integrations/google-shared';
import { getCloudReminders, syncReminderToCloud } from '../tools/cloud-reminder-tools';

function computeRange(view: string, refDate?: Date): { start: Date; end: Date } {
  const now = refDate ? new Date(refDate) : new Date();
  if (isNaN(now.getTime())) {
     // Fallback to actual now if invalid
     now.setTime(Date.now());
  }
  const start = new Date(now);
  const end = new Date(now);

  if (view === 'month') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0); // last day of month
    // Pad for visual calendar
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday
  } else if (view === 'week') {
    start.setDate(start.getDate() - start.getDay());
    end.setDate(start.getDate() + 6);
  } else {
    // Today
    // No op, start/end are now
  }
  
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  // Ensure end is at least end of day for safety
  if (view === 'today') {
    end.setDate(start.getDate());
    end.setHours(23, 59, 59, 999);
  } else {
    // Already handled
  }

  // Slightly buffer
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function handleCalendarRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');

  if (req.method === 'GET' && path === '/v1/calendar/events') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const viewParam = (parsedUrl.searchParams.get('view') || 'today').toLowerCase();
      const view = viewParam === 'week' || viewParam === 'month' ? viewParam : 'today';
      const dateParam = parsedUrl.searchParams.get('date');
      
      const acc = await resolveGoogleAccountForRoute(authUser.userId);
      if (!acc) {
        const body = JSON.stringify({ ok: false, error: 'google_not_connected' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const scopes = acc.scopes;
      const needsScope = 'https://www.googleapis.com/auth/calendar.events';
      if (!scopes.includes(needsScope) && !scopes.includes('https://www.googleapis.com/auth/calendar')) {
        const body = JSON.stringify({ ok: false, error: 'missing_scopes', missing: [needsScope] });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const { start, end } = computeRange(view, dateParam ? new Date(dateParam) : undefined);
      const accessToken = acc.accessToken;

      const params = new URLSearchParams();
      params.set('singleEvents', 'true');
      params.set('orderBy', 'startTime');
      params.set('maxResults', '250');
      params.set('timeMin', start.toISOString());
      params.set('timeMax', end.toISOString());

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent('primary')}/events?${params.toString()}`;
      const apiRes = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data: any = await (async () => { try { return await apiRes.json(); } catch { return null; } })();

      if (!apiRes.ok) {
        const msg = (data && (data.error?.message || data.error || data.message)) || `${apiRes.status} ${apiRes.statusText}`;
        const body = JSON.stringify({ ok: false, error: 'google_api_error', message: msg });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const blocks = items.map((ev: any) => {
        const startField = ev?.start || {};
        const endField = ev?.end || {};
        const start = startField.dateTime || startField.date || '';
        const end = endField.dateTime || endField.date || '';
        const allDay = !!startField.date; // if date is set but dateTime is not, it's all day
        return {
          id: ev.id,
          title: ev.summary || '(No Title)',
          start,
          end,
          allDay,
          description: ev.description || '',
          location: ev.location || '',
          attendees: Array.isArray(ev.attendees) ? ev.attendees.map((a: any) => a.email || a.displayName).filter(Boolean) : [],
          htmlLink: ev.htmlLink,
          source: 'google',
          original: ev,
        };
      });

      const body = JSON.stringify({ ok: true, blocks, range: { start: start.toISOString(), end: end.toISOString() } });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  // New Route: PATCH /v1/calendar/events/:id
  if (req.method === 'PATCH' && path.startsWith('/v1/calendar/events/')) {
    try {
      const eventId = path.split('/').pop();
      if (!eventId) throw new Error('missing_id');

      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      // Read body
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const rawBody = Buffer.concat(buffers).toString();
      let updates: any = {};
      try { updates = JSON.parse(rawBody); } catch {}

      const acc = await resolveGoogleAccountForRoute(authUser.userId);
      if (!acc) {
        const body = JSON.stringify({ ok: false, error: 'google_not_connected' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const scopes = acc.scopes;
      const needsScope = 'https://www.googleapis.com/auth/calendar.events';
      if (!scopes.includes(needsScope) && !scopes.includes('https://www.googleapis.com/auth/calendar')) {
        const body = JSON.stringify({ ok: false, error: 'missing_scopes', missing: [needsScope] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const accessToken = acc.accessToken;

      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
      const apiRes = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
      const data: any = await (async () => { try { return await apiRes.json(); } catch { return null; } })();

      if (!apiRes.ok) {
        const msg = (data && (data.error?.message || data.error || data.message)) || `${apiRes.status} ${apiRes.statusText}`;
        const body = JSON.stringify({ ok: false, error: 'google_api_error', message: msg });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const body = JSON.stringify({ ok: true, event: data });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  // GET /v1/tasks/google — Google Tasks for the dashboard, mirrors /v1/calendar/events.
  // Read-only listing across the user's task lists; the desktop merges these alongside
  // local unified tasks (same way Google Calendar events merge with local blocks).
  if (req.method === 'GET' && path === '/v1/tasks/google') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const acc = await resolveGoogleAccountForRoute(authUser.userId);
      if (!acc) {
        const body = JSON.stringify({ ok: false, error: 'google_not_connected' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const scopes = acc.scopes;
      const needsScope = 'https://www.googleapis.com/auth/tasks';
      if (!scopes.includes(needsScope) && !scopes.includes('https://www.googleapis.com/auth/tasks.readonly')) {
        const body = JSON.stringify({ ok: false, error: 'missing_scopes', missing: [needsScope] });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      const accessToken = acc.accessToken;
      const showCompleted = (parsedUrl.searchParams.get('showCompleted') || 'false').toLowerCase() === 'true';
      const perList = Math.min(100, Math.max(1, Number(parsedUrl.searchParams.get('maxResults') || 100)));

      const gfetch = async (url: string) => {
        const r = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });
        const j: any = await (async () => { try { return await r.json(); } catch { return null; } })();
        return { r, j };
      };

      const listsRes = await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
      if (!listsRes.r.ok) {
        const msg = (listsRes.j && (listsRes.j.error?.message || listsRes.j.error || listsRes.j.message)) || `${listsRes.r.status} ${listsRes.r.statusText}`;
        const body = JSON.stringify({ ok: false, error: 'google_api_error', message: msg });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return true;
      }

      // Cap to the first 10 lists so a user with many lists can't fan out unbounded.
      const lists = (Array.isArray(listsRes.j?.items) ? listsRes.j.items : []).slice(0, 10);
      const perListItems = await Promise.all(lists.map(async (l: any) => {
        const listId = String(l.id);
        const listTitle = String(l.title || 'Tasks');
        const params = new URLSearchParams();
        params.set('maxResults', String(perList));
        params.set('showCompleted', showCompleted ? 'true' : 'false');
        if (showCompleted) params.set('showHidden', 'true');
        const tr = await gfetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?${params.toString()}`);
        const tItems = Array.isArray(tr.j?.items) ? tr.j.items : [];
        return tItems
          .filter((t: any) => !t.deleted)
          .map((t: any) => ({
            id: String(t.id),
            title: t.title || '(No title)',
            notes: t.notes || '',
            due: t.due || '',
            status: t.status || 'needsAction',
            completed: t.status === 'completed',
            completedAt: t.completed || '',
            updated: t.updated || '',
            position: t.position || '',
            parent: t.parent || '',
            listId,
            listTitle,
            webLink: t.webViewLink || 'https://tasks.google.com/',
            source: 'google',
          }));
      }));

      const items = perListItems.flat();
      const body = JSON.stringify({
        ok: true,
        items,
        lists: lists.map((l: any) => ({ id: String(l.id), title: String(l.title || 'Tasks') })),
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  // PATCH /v1/tasks/google/:id — update a Google task (used to check it off from the
  // dashboard). Requires the task list id in the body since Google scopes tasks per list.
  if (req.method === 'PATCH' && path.startsWith('/v1/tasks/google/')) {
    try {
      const taskId = decodeURIComponent(path.split('/').pop() || '');
      if (!taskId) throw new Error('missing_id');

      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      let updates: any = {};
      try { updates = JSON.parse(Buffer.concat(buffers).toString() || '{}'); } catch {}

      const listId = String(updates.listId || '');
      if (!listId) {
        const body = JSON.stringify({ ok: false, error: 'missing_list_id' });
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const acc = await resolveGoogleAccountForRoute(authUser.userId);
      if (!acc) {
        const body = JSON.stringify({ ok: false, error: 'google_not_connected' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      // Writing requires the full tasks scope (tasks.readonly can't mutate).
      if (!acc.scopes.includes('https://www.googleapis.com/auth/tasks')) {
        const body = JSON.stringify({ ok: false, error: 'missing_scopes', missing: ['https://www.googleapis.com/auth/tasks'] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const patchBody: any = {};
      if (typeof updates.completed === 'boolean') {
        patchBody.status = updates.completed ? 'completed' : 'needsAction';
        // Google keeps the old completion timestamp unless we explicitly clear it.
        if (!updates.completed) patchBody.completed = null;
      }
      if (typeof updates.title === 'string') patchBody.title = updates.title;
      if (typeof updates.notes === 'string') patchBody.notes = updates.notes;
      if (typeof updates.due === 'string') patchBody.due = updates.due;

      const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
      const apiRes = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      const data: any = await (async () => { try { return await apiRes.json(); } catch { return null; } })();

      if (!apiRes.ok) {
        const msg = (data && (data.error?.message || data.error || data.message)) || `${apiRes.status} ${apiRes.statusText}`;
        const body = JSON.stringify({ ok: false, error: 'google_api_error', message: msg });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const body = JSON.stringify({ ok: true, task: data });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  // POST /v1/reminders/cloud — sync a reminder to cloud for SMS/WhatsApp delivery
  if (req.method === 'POST' && path === '/v1/reminders/cloud') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

      const { message, scheduledAt, deliveryMethod, recurrence } = payload || {};
      if (!scheduledAt) {
        const body = JSON.stringify({ ok: false, error: 'scheduledAt is required' });
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      await syncReminderToCloud(authUser.userId, {
        when: scheduledAt,
        message: message || 'Reminder',
        recurrence: recurrence || null,
        cloud_notify_method: deliveryMethod || 'sms',
      });

      const body = JSON.stringify({ ok: true });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  // GET /v1/reminders/cloud — cloud reminders for the dashboard
  if (req.method === 'GET' && path === '/v1/reminders/cloud') {
    try {
      const auth = String(req.headers['authorization'] || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authUser = token ? await verifyToken(token) : null;
      if (!authUser) {
        const body = JSON.stringify({ ok: false, error: 'unauthorized' });
        res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const status = parsedUrl.searchParams.get('status') || 'pending';
      const startParam = parsedUrl.searchParams.get('start') || undefined;
      const endParam = parsedUrl.searchParams.get('end') || undefined;

      const reminders = await getCloudReminders(authUser.userId, {
        status,
        start: startParam,
        end: endParam,
      });

      const items = reminders.map((r: any) => ({
        id: r.id,
        message: r.title || r.message || 'Reminder',
        whenIso: r.remind_at,
        whenEpochMs: new Date(r.remind_at).getTime(),
        deliveryMethod: r.delivery_method,
        status: r.status,
        source: 'cloud',
      }));

      const body = JSON.stringify({ ok: true, items });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return true;
    } catch (e) {
      console.error(e);
      const body = JSON.stringify({ ok: false, error: 'server_error' });
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
      return true;
    }
  }

  return false;
}
