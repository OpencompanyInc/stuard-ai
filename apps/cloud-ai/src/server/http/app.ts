
import http from 'http';
import { handleHttpRoutes } from '../../routes';

export function createHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    let parsedUrl: URL;
    try { parsedUrl = new URL(url, 'http://localhost'); } catch { parsedUrl = new URL('http://localhost/'); }
    
    // CORS preflight support
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    
    if (await handleHttpRoutes(req, res, parsedUrl)) return;
    
    res.writeHead(404).end();
  });

  // Increase HTTP keep-alive and headers timeouts to be friendly to long-lived WS
  try {
    (server as any).keepAliveTimeout = Number(process.env.CLOUD_HTTP_KEEPALIVE_MS || 120000);
    (server as any).headersTimeout = Number(process.env.CLOUD_HTTP_HEADERS_TIMEOUT_MS || 120000);
  } catch { }

  return server;
}
