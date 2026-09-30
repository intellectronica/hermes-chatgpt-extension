import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HermesService } from '../shared/types';
import { ActionError, dispatchAction, publicError } from './actions';

function equals(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new ActionError('unsupported_media_type', 'Use application/json.', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256_000) throw new ActionError('body_too_large', 'This request is too large.', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ActionError('invalid_json', 'This request is not valid JSON.'); }
}

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

export async function startHttpBridge(service: HermesService, html: string, options: { port?: number } = {}) {
  const token = randomBytes(32).toString('hex');
  let port = options.port ?? 4318;
  let cookieName = '';
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host ?? '')) throw new ActionError('invalid_host', 'Use the loopback bridge address.', 403);
      const origin = request.headers.origin;
      const ownOrigin = `http://${request.headers.host}`;
      if (origin && origin !== ownOrigin) throw new ActionError('invalid_origin', 'This origin is not allowed.', 403);
      const route = new URL(request.url ?? '/', ownOrigin).pathname;
      if (request.method === 'GET' && route === '/') {
        response.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api`);
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        response.end(html);
        return;
      }
      if (request.method === 'GET' && route === '/health') { json(response, 200, { status: 'ok', version: '0.1.0' }); return; }
      if (request.method !== 'POST' || route !== '/api/actions') { json(response, 404, { error: { code: 'not_found', message: 'This route does not exist.' } }); return; }
      const cookies = new Map((request.headers.cookie ?? '').split(';').map(value => {
        const i = value.indexOf('='); return [value.slice(0, i).trim(), value.slice(i + 1)];
      }));
      const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const validBearer = bearer.length > 0 && equals(bearer, token);
      const validCookie = !!origin && origin === ownOrigin && equals(cookies.get(cookieName) ?? '', token);
      if (!validBearer && !validCookie) throw new ActionError('unauthorised', 'Reload the bridge page to reconnect.', 401);
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ActionError('invalid_request', 'This action request is invalid.');
      const { action, args, ...extra } = body as Record<string, unknown>;
      if (typeof action !== 'string' || Object.keys(extra).length) throw new ActionError('invalid_request', 'This action request is invalid.');
      const data = await dispatchAction(service, action, args ?? {});
      json(response, 200, { data });
    } catch (error) {
      const { code, message, status } = publicError(error);
      json(response, status, { error: { code, message } });
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  port = (server.address() as AddressInfo).port;
  cookieName = `hermes_bridge_${port}`;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
