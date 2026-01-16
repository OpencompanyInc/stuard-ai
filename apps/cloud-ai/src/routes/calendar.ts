
import { type IncomingMessage, type ServerResponse } from 'http';
import { verifyToken } from '../supabase';
import { getExternalAccount, refreshGoogleTokenIfNeeded } from './integrations/google-shared';

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
      
      const acc = await getExternalAccount(authUser.userId, 'google');
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

      const scopes = Array.isArray(acc.scopes) ? acc.scopes.map((s: any) => String(s)) : [];
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
      let accessToken = String(acc.access_token || '');
      accessToken = await refreshGoogleTokenIfNeeded(authUser.userId, acc);

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

      const acc = await getExternalAccount(authUser.userId, 'google');
      if (!acc) {
        const body = JSON.stringify({ ok: false, error: 'google_not_connected' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      const scopes = Array.isArray(acc.scopes) ? acc.scopes.map((s: any) => String(s)) : [];
      const needsScope = 'https://www.googleapis.com/auth/calendar.events';
      if (!scopes.includes(needsScope) && !scopes.includes('https://www.googleapis.com/auth/calendar')) {
        const body = JSON.stringify({ ok: false, error: 'missing_scopes', missing: [needsScope] });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(body);
        return true;
      }

      let accessToken = String(acc.access_token || '');
      accessToken = await refreshGoogleTokenIfNeeded(authUser.userId, acc);

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

  return false;
}
