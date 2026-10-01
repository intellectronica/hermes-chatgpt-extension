import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesConnection } from '../src/hermes/connection';
import type { ConnectionConfig } from '../src/shared/types';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }));

const connections: HermesConnection[] = [];
const children: FixtureChild[] = [];
const credential = 'fixture-session-credential';
const config = (): ConnectionConfig => ({ id: 'gateway', label: 'Gateway', kind: 'http', baseUrl: 'https://hermes.example.org/services/hermes/', tokenEnv: 'HERMES_CONNECTION_TEST_TOKEN' });
const connect = (value: ConnectionConfig = config()): HermesConnection => {
  const connection = new HermesConnection(value);
  connections.push(connection);
  return connection;
};

/** Local process/tunnel fixture: never invokes SSH or starts a Hermes backend. */
class FixtureChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  payload?: Record<string, unknown>;
  listener?: Server;
  kill = vi.fn((_signal?: NodeJS.Signals) => { this.stop(); return true; });

  constructor(args: readonly string[]) {
    super();
    children.push(this);
    this.stdin.on('finish', () => this.stop());
    if (args.includes('-N')) {
      const forward = args[args.indexOf('-L') + 1];
      const port = Number(forward.split(':')[1]);
      this.listener = createServer(socket => socket.end());
      this.listener.listen(port, '127.0.0.1');
    } else {
      this.stdin.once('data', data => {
        this.payload = JSON.parse(data.toString());
        setImmediate(() => this.stdout.write('HERMES_BACKEND_READY port=45555\n'));
      });
    }
  }

  private stop(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.listener?.close();
    setImmediate(() => this.emit('exit', 0, null));
  }
}

beforeEach(() => {
  vi.stubEnv('HERMES_CONNECTION_TEST_TOKEN', credential);
  vi.mocked(spawn).mockImplementation((_command, args) => new FixtureChild(args as string[]) as unknown as ChildProcessWithoutNullStreams);
});
afterEach(async () => {
  await Promise.all(connections.splice(0).map(connection => connection.dispose()));
  expect(children.splice(0).every(child => child.exitCode === 0)).toBe(true);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('portable backend connections', () => {
  it('uses the same proxy path for REST and WSS, with credentials confined to upstream requests', async () => {
    const fetchFixture = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [] })));
    vi.stubGlobal('fetch', fetchFixture);
    const connection = connect();
    await connection.start();
    const ws = new URL(connection.wsUrl());
    expect(ws.protocol).toBe('wss:');
    expect(ws.pathname).toBe('/services/hermes/api/ws');
    expect(ws.searchParams.get('token')).toBe(credential);
    expect(await connection.get('/api/profiles/sessions?profile=default')).toEqual({ sessions: [] });
    const [request, options] = fetchFixture.mock.calls[0];
    expect(String(request)).toBe('https://hermes.example.org/services/hermes/api/profiles/sessions?profile=default');
    expect(options.headers.Authorization).toBe(`Bearer ${credential}`);
    expect(options.redirect).toBe('error');
    expect(JSON.stringify(connection.summary())).not.toContain(credential);
    expect(connection.redact(`prefix ${credential} suffix`)).toBe('prefix [redacted] suffix');
  });

  it('keeps distinct instance credentials and paths separate', async () => {
    vi.stubEnv('HERMES_OTHER_TEST_TOKEN', 'other-instance-credential');
    const first = connect();
    const second = connect({ ...config(), id: 'other', baseUrl: 'https://other.example.org/mount', tokenEnv: 'HERMES_OTHER_TEST_TOKEN' });
    await Promise.all([first.start(), second.start()]);
    expect(new URL(first.wsUrl()).searchParams.get('token')).toBe(credential);
    expect(new URL(second.wsUrl()).searchParams.get('token')).toBe('other-instance-credential');
    expect(new URL(second.wsUrl()).pathname).toBe('/mount/api/ws');
    expect(first.summary().id).not.toBe(second.summary().id);
  });

  it('refuses a missing URL, unsafe URLs and missing/ambiguous credentials before a request', async () => {
    const fetchFixture = vi.fn();
    vi.stubGlobal('fetch', fetchFixture);
    for (const value of [
      { ...config(), baseUrl: undefined },
      { ...config(), baseUrl: 'http://remote.example.org' },
      { ...config(), baseUrl: 'https://private:credential@example.org' },
      { ...config(), tokenEnv: undefined },
      { ...config(), tokenFile: '/fixture/credential' },
    ]) {
      const connection = connect(value);
      await expect(connection.start()).rejects.toThrow();
      expect(JSON.stringify(connection.summary())).not.toContain('private:credential');
    }
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it('rejects prefix traversal and unsupported routes before forwarding a credential', async () => {
    const fetchFixture = vi.fn();
    vi.stubGlobal('fetch', fetchFixture);
    const connection = connect();
    for (const path of ['/other', '//other.example.org/api/profile', '/api/../../admin', '/api/%2e%2e/admin', '/api/%2e%2e%2fadmin', '/api/foo#fragment', '/api/evil\\path', '/api/%invalid']) await expect(connection.get(path)).rejects.toThrow('Unsupported Hermes read route');
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it('checks private token-file permissions and bounds invalid credentials without exposing their contents', async () => {
    const file = { ...config(), tokenEnv: undefined, tokenFile: '/fixture/session.token' };
    const privateStat = { isFile: () => true, size: 20, mode: 0o100600, uid: process.getuid?.() ?? 0 };
    vi.mocked(stat).mockResolvedValue(privateStat as Awaited<ReturnType<typeof stat>>);
    vi.mocked(readFile).mockResolvedValue(` ${credential}\n`);
    const valid = connect(file);
    await valid.start();
    expect(new URL(valid.wsUrl()).searchParams.get('token')).toBe(credential);
    vi.mocked(stat).mockResolvedValue({ ...privateStat, mode: 0o100644 } as Awaited<ReturnType<typeof stat>>);
    if (process.platform !== 'win32') await expect(connect(file).start()).rejects.toThrow('owner-only');
    vi.mocked(stat).mockResolvedValue({ ...privateStat, size: 16_385 } as Awaited<ReturnType<typeof stat>>);
    await expect(connect(file).start()).rejects.toThrow('small private files');
    for (const token of ['secret\r\nInjected: value', 'x'.repeat(16_385), '']) {
      vi.stubEnv('HERMES_CONNECTION_TEST_TOKEN', token);
      const connection = connect();
      await expect(connection.start()).rejects.toThrow();
      expect(JSON.stringify(connection.summary())).not.toContain('Injected');
    }
  });

  it('attaches through an explicit IPv6 loopback tunnel without launching a remote runtime', async () => {
    const connection = connect({ id: 'attached', label: 'Attached', kind: 'ssh', tokenEnv: 'HERMES_CONNECTION_TEST_TOKEN', ssh: { host: 'ssh-alias', user: 'hermes', port: 2222, mode: 'attach', remoteHost: '[::1]', remotePort: 9123 } });
    await connection.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = vi.mocked(spawn).mock.calls[0];
    expect(command).toBe('ssh');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('hermes@ssh-alias');
    expect(args).toContain('2222');
    expect(args).toContainEqual(expect.stringMatching(/^127\.0\.0\.1:\d+:\[::1\]:9123$/));
    expect(args?.join(' ')).not.toContain(credential);
    expect(new URL(connection.wsUrl()).searchParams.get('token')).toBe(credential);
    await connection.dispose();
    expect(children[0].exitCode).toBe(0);
  });

  it('sends managed configuration and a fresh token only through supervisor stdin and stops only its owned children', async () => {
    const connection = connect({ id: 'managed', label: 'Managed', kind: 'ssh', ssh: { host: 'ssh-alias', mode: 'managed', hermesHome: '~/data/hermes', repoPath: '~/apps/hermes-agent', pythonPath: '~/apps/hermes-agent/.venv/bin/python' } });
    await connection.start();
    expect(spawn).toHaveBeenCalledTimes(2);
    const payload = children[0].payload!;
    expect(payload).toMatchObject({ hermesHome: '~/data/hermes', repoPath: '~/apps/hermes-agent', pythonPath: '~/apps/hermes-agent/.venv/bin/python' });
    expect(String(payload.token)).toHaveLength(43);
    const args = vi.mocked(spawn).mock.calls.flatMap(call => call[1] as string[]).join(' ');
    expect(args).not.toContain(String(payload.token));
    expect(new URL(connection.wsUrl()).searchParams.get('token')).toBe(payload.token);
    await connection.dispose();
    expect(children.every(child => child.exitCode === 0)).toBe(true);
    expect(children[0].kill).not.toHaveBeenCalled();
  });

  it('rejects wrong-mode fields and unsafe SSH destinations without invoking SSH', async () => {
    const base: ConnectionConfig = { id: 'remote', label: 'Remote', kind: 'ssh', ssh: { host: 'ssh-alias', mode: 'managed' } };
    for (const value of [
      { ...base, tokenEnv: 'HERMES_CONNECTION_TEST_TOKEN' },
      { ...base, ssh: { ...base.ssh!, remotePort: 9119 } },
      { ...base, ssh: { ...base.ssh!, rendezvousDir: '~/unimplemented' } },
      { ...base, ssh: { ...base.ssh!, host: '-Fconfig' } },
      { ...base, ssh: { ...base.ssh!, user: '-option' } },
      { ...base, ssh: { ...base.ssh!, port: 0 } },
      { ...base, ssh: { ...base.ssh!, mode: 'unknown' } } as unknown as ConnectionConfig,
      { ...base, tokenEnv: 'HERMES_CONNECTION_TEST_TOKEN', ssh: { ...base.ssh!, mode: 'attach' as const } },
    ]) await expect(connect(value).start()).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
});
