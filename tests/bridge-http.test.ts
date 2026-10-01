import { afterEach, describe, expect, it } from 'vitest';
import { startHttpBridge } from '../src/bridge/http';
import { request } from 'node:http';
import { fakeService } from './helpers/service';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function fixture() {
  const service = fakeService();
  const bridge = await startHttpBridge(service, '<html><body>Hermes</body></html>', { port: 0 });
  cleanups.push(bridge.close);
  const page = await fetch(bridge.url);
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  return { service, bridge, page, cookie };
}

describe('loopback bridge authentication', () => {
  it('keeps tokens in an HttpOnly strict cookie and permits owned same-origin actions', async () => {
    const { bridge, page, cookie } = await fixture();
    expect(page.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/api');
    expect(await page.text()).not.toContain(cookie.split('=')[1]);
    const response = await fetch(`${bridge.url}/api/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: bridge.url },
      body: JSON.stringify({ action: 'list_profiles', args: { connectionId: 'remote' } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ name: 'default' }, { name: 'research' }] });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('blocks unauthenticated access, cross-site actions and DNS rebinding', async () => {
    const { bridge, cookie, service } = await fixture();
    const body = JSON.stringify({ action: 'list_connections', args: {} });
    const noAuth = await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(noAuth.status).toBe(401);
    const noOrigin = await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body });
    expect(noOrigin.status).toBe(401);
    const crossSite = await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://attacker.example' }, body });
    expect(crossSite.status).toBe(403);
    const rebindStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${bridge.url}/api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end(body);
    });
    expect(rebindStatus).toBe(403);
    expect(service.listConnections).not.toHaveBeenCalled();
  });
  it('rejects invalid media, oversized bodies and unsupported mutations', async () => {
    const { bridge, cookie } = await fixture();
    const headers = { Cookie: cookie, Origin: bridge.url };
    expect((await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers, body: '{}' })).status).toBe(415);
    expect((await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(256_000) }) })).status).toBe(413);
    const response = await fetch(`${bridge.url}/api/actions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run_cron_job', args: {} }) });
    expect(response.status).toBe(400);
  });
});
