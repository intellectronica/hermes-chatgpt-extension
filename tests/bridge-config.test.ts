import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, parseConfig } from '../src/bridge/config';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node:os', () => ({ homedir: vi.fn() }));

const root = resolve('work/configuration-fixture');
const files = new Map<string, string>();
const http = { id: 'gateway', label: 'Gateway', kind: 'http', baseUrl: 'https://hermes.example.org/hermes', tokenEnv: 'HERMES_GATEWAY_TOKEN' };
const managed = { id: 'remote', label: 'Remote', kind: 'ssh', ssh: { host: 'ssh-alias', mode: 'managed' } };
const json = (connections: unknown[]): string => JSON.stringify({ connections });

beforeEach(() => {
  files.clear();
  vi.stubEnv('HERMES_EXTENSION_CONFIG', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', resolve(root, 'xdg'));
  vi.spyOn(process, 'cwd').mockReturnValue(resolve(root, 'working'));
  vi.mocked(homedir).mockReturnValue(resolve(root, 'home'));
  vi.mocked(readFile).mockImplementation(async path => {
    const value = files.get(String(path));
    if (value === undefined) throw Object.assign(new Error('Fixture file missing'), { code: 'ENOENT' });
    return value;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('portable Hermes configuration', () => {
  it('loads an explicit file before env/discovery and resolves tokens relative to that file', async () => {
    const file = resolve(root, 'shared/config.json');
    files.set(file, json([{ ...http, tokenEnv: undefined, tokenFile: './secrets/session.token' }]));
    vi.stubEnv('HERMES_EXTENSION_CONFIG', resolve(root, 'wrong.json'));
    const config = await loadConfig(file);
    expect(config.connections[0].tokenFile).toBe(resolve(root, 'shared/secrets/session.token'));
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(config.connections[0].baseUrl).toBe(http.baseUrl);
  });

  it('expands the current local home in config/token paths without expanding remote paths locally', async () => {
    const file = resolve(root, 'home/config/settings.json');
    files.set(file, json([{ ...http, tokenEnv: undefined, tokenFile: '~/secrets/session.token' }, { ...managed, ssh: { ...managed.ssh, hermesHome: '~/.hermes', repoPath: '~/agents/hermes', pythonPath: '~/agents/hermes/venv/bin/python' } }]));
    const config = await loadConfig('~/config/settings.json');
    expect(config.connections[0].tokenFile).toBe(resolve(root, 'home/secrets/session.token'));
    expect(config.connections[1].ssh?.hermesHome).toBe('~/.hermes');
    expect(config.connections[1].ssh?.pythonPath).toBe('~/agents/hermes/venv/bin/python');
  });

  it('discovers cwd first and the XDG user directory second, without reading any personal files', async () => {
    const userPath = resolve(root, 'xdg/hermes-chatgpt-extension/hermes.config.json');
    files.set(userPath, json([http]));
    expect((await loadConfig()).connections[0].id).toBe('gateway');
    files.set(resolve(root, 'working/hermes.config.json'), json([managed]));
    expect((await loadConfig()).connections[0].id).toBe('remote');
  });

  it('uses ~/.config when XDG_CONFIG_HOME is absent or relative', async () => {
    files.set(resolve(root, 'home/.config/hermes-chatgpt-extension/hermes.config.json'), json([managed]));
    for (const value of [undefined, 'relative/config']) {
      vi.stubEnv('XDG_CONFIG_HOME', value);
      expect((await loadConfig()).connections[0].id).toBe('remote');
    }
  });

  it('returns an empty setup only when every implicit file is missing', async () => {
    expect(await loadConfig()).toEqual({ connections: [] });
    await expect(loadConfig('hermes.config.json')).rejects.toThrow('Cannot read');
    vi.stubEnv('HERMES_EXTENSION_CONFIG', 'missing.json');
    await expect(loadConfig()).rejects.toThrow('Cannot read');
    vi.stubEnv('HERMES_EXTENSION_CONFIG', '');
    await expect(loadConfig()).rejects.toThrow('Cannot read');
  });

  it('does not bypass malformed or invalid selected files to reach another configured backend', async () => {
    files.set(resolve(root, 'xdg/hermes-chatgpt-extension/hermes.config.json'), json([http]));
    files.set(resolve(root, 'working/hermes.config.json'), '{broken');
    await expect(loadConfig()).rejects.toThrow('Cannot read');
    files.set(resolve(root, 'working/hermes.config.json'), json([{ ...http, tokenEnv: undefined }]));
    await expect(loadConfig()).rejects.toThrow('exactly one');
  });

  it('rejects a missing or ambiguous credential and settings from another connection mode', () => {
    const attach = { ...managed, tokenEnv: 'HERMES_TOKEN', ssh: { host: 'ssh-alias', mode: 'attach', remotePort: 9119 } };
    for (const connection of [
      { ...http, tokenEnv: undefined },
      { ...http, tokenFile: 'session.token' },
      { ...http, ssh: managed.ssh },
      { ...managed, baseUrl: http.baseUrl },
      { ...managed, tokenEnv: 'HERMES_TOKEN' },
      { ...managed, ssh: { ...managed.ssh, remotePort: 9119 } },
      { ...managed, ssh: { ...managed.ssh, remoteHost: 'localhost' } },
      { ...managed, ssh: { ...managed.ssh, rendezvousDir: '~/.hermes/shared' } },
      { ...attach, ssh: { ...attach.ssh, remotePort: undefined } },
      { ...attach, ssh: { ...attach.ssh, repoPath: '~/hermes' } },
    ]) expect(() => parseConfig({ connections: [connection] })).toThrow();
    expect(parseConfig({ connections: [attach, http] }).connections).toHaveLength(2);
  });

  it('rejects insecure URLs, control characters and SSH option/shell injection without exposing values', async () => {
    for (const baseUrl of ['https://user:secret@example.org', 'https://example.org/?token=secret', 'https://example.org/#secret', 'http://lan.example.org', 'file:///tmp/server', 'not-a-url', 'https://example.org\\escape', ' https://example.org']) {
      files.set(resolve(root, 'bad.json'), json([{ ...http, baseUrl }]));
      try { await loadConfig(resolve(root, 'bad.json')); expect.fail('Invalid URL must fail'); }
      catch (error) { expect((error as Error).message).not.toContain('secret'); }
    }
    for (const ssh of [{ host: '-Fconfig' }, { host: 'host;command' }, { host: 'good', user: '-option' }, { host: 'good', pythonPath: 'relative/python' }, { host: 'good', hermesHome: '~/home\ncommand' }]) expect(() => parseConfig({ connections: [{ ...managed, ssh }] })).toThrow();
    expect(parseConfig({ connections: [{ ...managed, ssh: { host: '2001:db8::1' } }] }).connections).toHaveLength(1);
  });

  it('requires unique instance IDs and bounds the connection roster', () => {
    expect(() => parseConfig({ connections: [managed, managed] })).toThrow('unique');
    expect(() => parseConfig({ connections: Array.from({ length: 31 }, (_, index) => ({ ...managed, id: `server-${index}` })) })).toThrow();
  });

  it('validates every generic distributed example without using it to open a connection', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    for (const name of ['config.local.json', 'config.ssh.json', 'config.ssh-attach.json', 'config.http.json', 'config.multiple.json']) {
      const source = await actual.readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8');
      const config = parseConfig(JSON.parse(source));
      expect(config.connections.length).toBeGreaterThan(0);
      for (const connection of config.connections) {
        if (connection.ssh) expect(connection.ssh.host).toMatch(/^hermes-/);
        if (connection.baseUrl) expect(new URL(connection.baseUrl).hostname).toMatch(/^(127\.0\.0\.1|hermes\.example\.org)$/);
      }
    }
  });
});
