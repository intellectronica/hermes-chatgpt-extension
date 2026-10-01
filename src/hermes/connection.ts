import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createServer, connect as connectTcp } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ConnectionConfig, ConnectionSummary } from '../shared/types.js';
import { HermesTransportError } from './rpc.js';
import { backendBaseUrl, backendRoute } from './urls.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_HTTP_BYTES = 8 * 1024 * 1024;

/** The supervisor owns exactly one child process group, and stops it when its SSH stdin closes.
 * Ordinary serve (without HERMES_DESKTOP) does not start Hermes's desktop cron scheduler.
 * The documented public_url env override keeps this private listener token-gated on loopback.
 * No remote credential files, configuration files or service-manager operations are involved.
 */
export const MANAGED_SUPERVISOR = String.raw`
import json, os, signal, subprocess, sys, threading
payload = json.loads(sys.stdin.readline())
home = os.path.abspath(os.path.expanduser(payload.get('hermesHome') or '~/.hermes'))
repo = os.path.abspath(os.path.expanduser(payload.get('repoPath') or os.path.join(home, 'hermes-agent')))
if payload.get('pythonPath'):
    python = os.path.expanduser(payload['pythonPath'])
else:
    python = next((p for p in [os.path.join(repo, 'venv/bin/python'), os.path.join(repo, '.venv/bin/python')] if os.path.isfile(p) and os.access(p, os.X_OK)), None)
if not os.path.isdir(repo) or not python or not os.path.isfile(python) or not os.access(python, os.X_OK):
    sys.exit('Configure an existing Hermes repository and runtime pythonPath; this connector does not prepare environments.')
env = os.environ.copy()
env['HERMES_HOME'] = home
env['HERMES_DASHBOARD_SESSION_TOKEN'] = payload['token']
env['HERMES_DASHBOARD_PUBLIC_URL'] = 'http://127.0.0.1'
env.pop('HERMES_DESKTOP', None)
env['HERMES_PARENT_PID'] = str(os.getpid())
# Official launch policy skips source-update dependency sync. Activate only an existing
# runtime, then require web dependencies BEFORE importing the web server's lazy installer.
env['HERMES_DISABLE_LAZY_INSTALLS'] = '1'
entrypoint = """import importlib.util, runpy
if importlib.util.find_spec('hermes_bootstrap') is not None:
    import hermes_bootstrap
try:
    import fastapi, uvicorn, multipart
except ImportError:
    raise SystemExit('Prepare Hermes server dependencies separately before connecting.')
runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)
"""
child = subprocess.Popen([python, '-c', entrypoint, '-p', 'default', 'serve', '--isolated', '--host', '127.0.0.1', '--port', '0'], cwd=repo, env=env, start_new_session=True)
lock = threading.Lock()
def stop(*_):
    with lock:
        if child.poll() is not None:
            return
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        except ProcessLookupError:
            pass
def watch_input():
    for _ in sys.stdin:
        pass
    stop()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
threading.Thread(target=watch_input, daemon=True).start()
try:
    code = child.wait()
finally:
    stop()
sys.exit(code)
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function sshArgs(config: ConnectionConfig): string[] {
  const ssh = config.ssh;
  if (!ssh || !/^[A-Za-z0-9_.:[\]-]+$/.test(ssh.host) || ssh.host.startsWith('-')) {
    throw new HermesTransportError('A valid SSH host is required.');
  }
  if (ssh.user && (!/^[A-Za-z0-9_.-]+$/.test(ssh.user) || ssh.user.startsWith('-'))) throw new HermesTransportError('Invalid SSH user.');
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (ssh.port !== undefined) {
    if (!Number.isInteger(ssh.port) || ssh.port < 1 || ssh.port > 65535) throw new HermesTransportError('Invalid SSH port.');
    args.push('-p', String(ssh.port));
  }
  return args;
}

function destination(config: ConnectionConfig): string {
  return config.ssh!.user ? `${config.ssh!.user}@${config.ssh!.host}` : config.ssh!.host;
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return server.close(() => reject(new Error('Could not allocate a loopback port.')));
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function portReady(port: number): Promise<boolean> {
  return new Promise(resolveReady => {
    const socket = connectTcp({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    const done = (ok: boolean): void => { socket.destroy(); resolveReady(ok); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function tokenFromConfig(config: ConnectionConfig): Promise<string> {
  if (Boolean(config.tokenEnv) === Boolean(config.tokenFile)) throw new HermesTransportError('Attached backends need exactly one Hermes token environment variable or private token file.');
  if (config.tokenEnv) {
    const token = process.env[config.tokenEnv]?.trim();
    if (!token) throw new HermesTransportError('The configured Hermes credential environment variable is empty.');
    if (token.length > 16_384 || /[\x00-\x1f\x7f]/.test(token)) throw new HermesTransportError('The configured Hermes credential is invalid.');
    return token;
  }
  if (config.tokenFile) {
    if (config.tokenFile.startsWith('~') && !config.tokenFile.startsWith('~/')) throw new HermesTransportError('Use an absolute tokenFile path or ~/ for the current user’s home directory.');
    const path = config.tokenFile.startsWith('~/') ? resolve(homedir(), config.tokenFile.slice(2)) : resolve(config.tokenFile);
    const info = await stat(path);
    if (!info.isFile() || info.size > 16_384 || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || typeof process.getuid === 'function' && info.uid !== process.getuid()))) {
      throw new HermesTransportError('Hermes token files must be small private files with owner-only permissions.');
    }
    const token = (await readFile(path, 'utf8')).trim();
    if (!token) throw new HermesTransportError('The configured Hermes token file is empty.');
    if (token.length > 16_384 || /[\x00-\x1f\x7f]/.test(token)) throw new HermesTransportError('The configured Hermes credential is invalid.');
    return token;
  }
  throw new HermesTransportError('Configure a Hermes token environment variable or private token file for an attached backend.');
}

/** Server-owned credentials, tunnel and managed-child lifecycle; no public configuration output. */
export class HermesConnection {
  private token = '';
  private endpoint?: string;
  private tunnel?: ChildProcessWithoutNullStreams;
  private supervisor?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private disposed = false;
  private state: ConnectionSummary['status'] = 'disconnected';
  private error?: string;

  constructor(readonly config: ConnectionConfig) {}

  summary(): ConnectionSummary {
    return { id: this.config.id, label: this.config.label, kind: this.config.kind, status: this.state, ...(this.error ? { error: this.error } : {}) };
  }

  noteRpcState(connected: boolean, error?: string): void {
    this.state = connected ? 'connected' : error ? 'error' : 'disconnected';
    this.error = error;
  }

  async start(): Promise<void> {
    if (this.disposed) throw new HermesTransportError('Hermes connection is closed.');
    if (this.endpoint && (this.config.kind === 'http' || (this.tunnel?.exitCode === null && this.tunnel.signalCode === null))) return;
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startInternal(): Promise<void> {
    this.state = 'connecting';
    this.error = undefined;
    try {
      if (this.config.kind === 'http') {
        if (this.config.ssh) throw new HermesTransportError('HTTP connections cannot include SSH settings.');
        let endpoint: string;
        try { endpoint = backendBaseUrl(this.config.baseUrl); }
        catch (error) { throw new HermesTransportError((error as Error).message); }
        this.token = await tokenFromConfig(this.config);
        this.endpoint = endpoint;
      } else {
        const ssh = this.config.ssh;
        if (!ssh) throw new HermesTransportError('SSH connection configuration is missing.');
        if (ssh.mode !== undefined && ssh.mode !== 'attach' && ssh.mode !== 'managed') throw new HermesTransportError('SSH mode must be attach or managed.');
        if (this.config.baseUrl) throw new HermesTransportError('SSH connections cannot include baseUrl.');
        if (Object.hasOwn(ssh, 'rendezvousDir')) throw new HermesTransportError('SSH rendezvousDir is not supported. Each managed connection owns its backend.');
        if (ssh.mode !== 'attach' && (ssh.remoteHost !== undefined || ssh.remotePort !== undefined || this.config.tokenEnv !== undefined || this.config.tokenFile !== undefined)) throw new HermesTransportError('Managed SSH cannot include attach listener or token settings.');
        if (ssh.mode === 'attach' && (ssh.hermesHome !== undefined || ssh.repoPath !== undefined || ssh.pythonPath !== undefined)) throw new HermesTransportError('SSH attach mode cannot include managed runtime paths.');
        const remoteHost = ssh.remoteHost ?? '127.0.0.1';
        if (!LOOPBACK_HOSTS.has(remoteHost)) throw new HermesTransportError('The remote Hermes listener must be on loopback.');
        await this.stopChildren();
        let remotePort = ssh.remotePort;
        if (ssh.mode !== 'attach') {
          this.token = randomBytes(32).toString('base64url');
          remotePort = await this.startManaged();
        } else this.token = await tokenFromConfig(this.config);
        if (remotePort === undefined || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new HermesTransportError('SSH attach mode needs an explicit valid remotePort.');
        const port = await reservePort();
        const args = [...sshArgs(this.config), '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:${remoteHost === '::1' ? '[::1]' : remoteHost}:${remotePort}`, destination(this.config)];
        const tunnel = spawn('ssh', args, { stdio: 'pipe' });
        this.tunnel = tunnel;
        // Drain diagnostics without forwarding credentials or command text to UI/logs.
        tunnel.stdin.on('error', () => {});
        tunnel.stderr.on('data', () => {});
        tunnel.stdout.on('data', () => {});
        let failed = false;
        tunnel.once('error', () => { failed = true; });
        tunnel.once('exit', () => { failed = true; if (this.tunnel === tunnel) { this.endpoint = undefined; this.state = 'disconnected'; } });
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && !failed) {
          if (await portReady(port)) { this.endpoint = `http://127.0.0.1:${port}`; break; }
          await new Promise(resolveWait => setTimeout(resolveWait, 80));
        }
        if (!this.endpoint) throw new HermesTransportError('Could not open the SSH tunnel. Check SSH agent access and the remote host.');
      }
      this.state = 'connected';
    } catch (error) {
      const message = error instanceof HermesTransportError ? error.message : 'Could not establish the Hermes connection.';
      await this.stopChildren();
      this.endpoint = undefined;
      this.state = 'error';
      this.error = message;
      throw new HermesTransportError(message);
    }
  }

  private async startManaged(): Promise<number> {
    const args = [...sshArgs(this.config), destination(this.config), `python3 -u -c ${shellQuote(MANAGED_SUPERVISOR)}`];
    const supervisor = spawn('ssh', args, { stdio: 'pipe' });
    this.supervisor = supervisor;
    const ssh = this.config.ssh!;
    supervisor.stderr.on('data', () => {});
    return new Promise<number>((resolvePort, reject) => {
      let buffer = '';
      let settled = false;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new HermesTransportError('The private remote Hermes backend did not start. Check remote python3, repository and interpreter paths, and prepared server dependencies.'));
      };
      const timeout = setTimeout(fail, 90_000);
      timeout.unref();
      supervisor.stdin.once('error', fail);
      supervisor.once('error', fail);
      supervisor.once('exit', () => { if (this.supervisor === supervisor) { this.endpoint = undefined; this.state = 'disconnected'; } fail(); });
      supervisor.stdout.on('data', data => {
        buffer = (buffer + data.toString()).slice(-32_768);
        const match = buffer.match(/HERMES_BACKEND_READY port=(\d+)/);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      });
      supervisor.stdin.write(`${JSON.stringify({ token: this.token, hermesHome: ssh.hermesHome, repoPath: ssh.repoPath, pythonPath: ssh.pythonPath })}\n`);
    });
  }

  wsUrl(): string {
    if (!this.endpoint) throw new HermesTransportError('Hermes is not connected.');
    const url = backendRoute(this.endpoint, '/api/ws');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.token);
    return url.href;
  }

  async get(path: string): Promise<unknown> {
    await this.start();
    // Callers choose from fixed read-only routes; a path can never retarget credentials.
    let url: URL;
    try { url = backendRoute(this.endpoint!, path); }
    catch { throw new HermesTransportError('Unsupported Hermes read route.'); }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'X-Hermes-Session-Token': this.token, Authorization: `Bearer ${this.token}` },
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      });
    } catch { throw new HermesTransportError('The Hermes read request failed. Check the backend connection.'); }
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'Hermes authentication failed. Check the backend credential.' : `Hermes could not complete the read request (HTTP ${response.status}).`;
      throw new HermesTransportError(message);
    }
    if (!response.body) throw new HermesTransportError('Hermes returned an empty response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTTP_BYTES) { await reader.cancel(); throw new HermesTransportError('Hermes returned more data than this view can display.'); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HermesTransportError('Hermes returned an unsupported response.'); }
  }

  redact(value: string): string {
    return this.token ? value.replaceAll(this.token, '[redacted]') : value;
  }

  private async stopChildren(): Promise<void> {
    const children = [{ child: this.tunnel, managed: false }, { child: this.supervisor, managed: true }];
    this.tunnel = undefined;
    this.supervisor = undefined;
    this.endpoint = undefined;
    for (const { child, managed } of children) {
      if (!child) continue;
      if (child.exitCode !== null || child.signalCode !== null) continue;
      // EOF tells our remote supervisor to gracefully stop only its own child group.
      child.stdin.end();
      if (!managed) child.kill('SIGTERM');
      await new Promise<void>(resolveExit => {
        let settled = false;
        const done = (): void => { if (settled) return; settled = true; clearTimeout(timeout); resolveExit(); };
        const timeout = setTimeout(() => { child.kill('SIGTERM'); done(); }, 18_000);
        child.once('exit', done);
      });
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.starting?.catch(() => {});
    await this.stopChildren();
    this.token = '';
    this.state = 'disconnected';
  }
}
