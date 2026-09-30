import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealHermesService } from '../src/hermes/service.js';
import { HermesRpcClient } from '../src/hermes/rpc.js';
import type { ChatRef } from '../src/shared/types.js';

interface Stored {
  runtime: string;
  rows: Record<string, unknown>[];
  running: boolean;
  inflight?: Record<string, unknown>;
}

/** A real HTTP/WS peer implementing the pinned Hermes contract subset, without any model calls. */
class Backend {
  server: Server;
  ws: WebSocketServer;
  sockets = new Set<WebSocket>();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  responses: Record<string, unknown>[] = [];
  reads: { path: string; profile: string | null }[] = [];
  sessions = new Map<string, Stored>();
  url = '';
  token = 'fixture-secret-that-must-never-leak';
  epoch = 'epoch-one';
  dropPromptAck = false;
  rejectReads = false;
  seq = new Map<string, number>();

  constructor() {
    this.server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      this.reads.push({ path: url.pathname, profile: url.searchParams.get('profile') });
      if (request.headers['x-hermes-session-token'] !== this.token || this.rejectReads) {
        response.writeHead(401).end(JSON.stringify({ error: this.token })); return;
      }
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/cron/jobs') {
        const profiles = url.searchParams.get('profile') === 'all' ? ['default', 'work'] : [url.searchParams.get('profile')!];
        response.end(JSON.stringify(profiles.map(profile => ({ id: 'same-job', profile, name: `${profile} job`, enabled: true, schedule_display: 'Every hour', last_status: 'delivery_failed', last_run_at: '2026-09-30T12:00:00Z', last_error: null }))));
      } else if (url.pathname === '/api/cron/jobs/same-job/runs') {
        response.end(JSON.stringify({ runs: [
          { id: 'run-one', profile: url.searchParams.get('profile'), title: 'Script-only run', source: 'cron', preview: 'Saved output', started_at: 1_796_000_000 },
          { id: 'run-two', profile: url.searchParams.get('profile'), status: 'delivery_failed', execution_status: 'success', delivery_status: 'failed' },
          { id: 'run-three', profile: url.searchParams.get('profile'), status: 'delivery_queued' },
        ] }));
      } else response.writeHead(404).end('{}');
    });
    this.ws = new WebSocketServer({ server: this.server });
    this.ws.on('connection', (socket, request) => {
      if (new URL(request.url!, 'http://127.0.0.1').searchParams.get('token') !== this.token) { socket.close(4401); return; }
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: this.epoch } } }));
      socket.on('message', data => {
        const frame = JSON.parse(data.toString());
        if (!frame.method) { this.responses.push(frame); return; }
        const params = frame.params ?? {};
        this.calls.push({ method: frame.method, params });
        const profile = params.profile ?? 'default';
        const key = `${profile}|same-session`;
        let session = this.sessions.get(key);
        const answer = (result: unknown): void => { socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })); };
        switch (frame.method) {
          case 'client.capabilities': answer({ server_requests: ['approval', 'clarify', 'secret'], declines_not_shown: true }); break;
          case 'profiles.list': answer({ profiles: [{ name: 'default', model: 'configured-model', is_default: true }, { name: 'work', model: 'another-model' }] }); break;
          case 'session.list': answer({ sessions: session ? [{ id: 'same-session', title: `${profile} conversation`, started_at: 1_796_000_000, source: 'codex-extension' }] : [] }); break;
          case 'session.create':
          case 'session.resume': {
            if (!session) { session = { runtime: `${profile}.runtime`, rows: [], running: false }; this.sessions.set(key, session); }
            answer({ session_id: session.runtime, stored_session_id: 'same-session', messages: session.rows, running: session.running, inflight: session.inflight, info: { stored_session_id: 'same-session', model: `${profile}-model` }, open_requests: [] });
            break;
          }
          case 'prompt.submit':
            session!.running = true;
            session!.rows.push({ row_id: session!.rows.length + 1, role: 'user', text: params.text });
            if (!this.dropPromptAck) answer({ status: 'streaming', user_row_id: session!.rows.length });
            break;
          case 'session.interrupt':
            answer({ status: 'interrupted', interrupted: true }); break;
          case 'session.events.since': answer({ events: [], epoch: this.epoch, latest_seq: 0, truncated: false, open_requests: [] }); break;
          default: socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `Do not echo ${this.token}` } }));
        }
      });
    });
  }

  async start(): Promise<void> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  }

  emit(profile: string, type: string, payload: Record<string, unknown> = {}): void {
    const seq = (this.seq.get(profile) ?? 0) + 1;
    this.seq.set(profile, seq);
    if (type === 'message.complete') {
      const stored = this.sessions.get(`${profile}|same-session`)!;
      stored.running = false;
      if (payload.text) stored.rows.push({ row_id: stored.rows.length + 1, role: 'assistant', text: payload.text });
    }
    for (const socket of this.sockets) socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id: `${profile}.runtime`, seq, payload } }));
  }

  request(profile: string, id: string, method: string, params: Record<string, unknown>): void {
    for (const socket of this.sockets) socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: { session_id: `${profile}.runtime`, ...params } }));
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await new Promise<void>(resolve => this.ws.close(() => this.server.close(() => resolve())));
  }
}

const services: RealHermesService[] = [];
const backends: Backend[] = [];

async function fixture(): Promise<{ service: RealHermesService; backend: Backend; ref: ChatRef }> {
  const backend = new Backend(); await backend.start(); backends.push(backend);
  process.env.HERMES_FIXTURE_TOKEN = backend.token;
  const service = new RealHermesService([{ id: 'remote', label: 'Fixture', kind: 'http', baseUrl: backend.url, tokenEnv: 'HERMES_FIXTURE_TOKEN' }]);
  services.push(service);
  const chat = await service.openChat({ connectionId: 'remote', profile: 'default' });
  return { service, backend, ref: { connectionId: 'remote', profile: 'default', sessionId: chat.id } };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()));
  await Promise.all(backends.splice(0).map(backend => backend.close()));
  delete process.env.HERMES_FIXTURE_TOKEN;
});

describe('Hermes ownership and transport behaviour', () => {
  it('scopes same-ID sessions and late events to their original profile', async () => {
    const { service, backend, ref } = await fixture();
    const work = await service.openChat({ connectionId: 'remote', profile: 'work' });
    await service.sendMessage(ref, 'Default request');
    backend.emit('default', 'message.delta', { text: 'Default reply' });
    backend.emit('default', 'message.complete', { text: 'Default reply', status: 'complete' });
    await vi.waitFor(async () => expect((await service.getChat(ref)).messages.at(-1)?.content).toBe('Default reply'));
    const workView = await service.getChat({ ...ref, profile: 'work', sessionId: work.id });
    expect(workView.messages).toEqual([]);
    expect(backend.calls.find(call => call.method === 'prompt.submit')?.params).toMatchObject({ profile: 'default', session_id: 'default.runtime' });
    expect(backend.calls.filter(call => call.method === 'session.create').every(call => !('model' in call.params) && !('provider' in call.params) && !('cwd' in call.params))).toBe(true);
  });

  it('never resends a prompt after a lost acknowledgement and backend reconnect', async () => {
    const { service, backend, ref } = await fixture();
    backend.dropPromptAck = true;
    await service.sendMessage(ref, 'One request');
    await vi.waitFor(() => expect(backend.calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1));
    for (const socket of backend.sockets) socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 25));
    // Authoritative resume reports the running session without sending the message a second time.
    const restored = await service.getChat(ref);
    expect(restored.status).toBe('streaming');
    expect(restored.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(backend.calls.filter(call => call.method === 'prompt.submit')).toHaveLength(1);
    expect(backend.calls.some(call => call.method === 'session.resume')).toBe(true);
    expect(backend.calls.filter(call => call.method === 'session.resume').every(call => call.params.lazy === true)).toBe(true);
  });

  it('restores inflight text and a retained failure from a lazy authoritative resume', async () => {
    const { service, backend, ref } = await fixture();
    const stored = backend.sessions.get('default|same-session')!;
    stored.running = true;
    stored.rows = [{ _row_id: 17, role: 'user', text: 'Original request' }];
    stored.inflight = { user: 'Original request', assistant: 'Partial answer', streaming: true };
    for (const socket of backend.sockets) socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 25));
    const restored = await service.getChat(ref);
    expect(restored.status).toBe('streaming');
    expect(restored.messages.map(message => [message.role, message.content])).toEqual([['user', 'Original request'], ['assistant', 'Partial answer']]);
    expect(backend.calls.filter(call => call.method === 'prompt.submit')).toEqual([]);
    stored.running = false;
    stored.inflight = { user: 'Original request', assistant: 'Partial answer', streaming: false, status: 'error', error: 'The provider stopped.' };
    for (const socket of backend.sockets) socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 25));
    const failed = await service.getChat(ref);
    expect(failed.status).toBe('interrupted');
    expect(failed.error).toBe('The provider stopped.');
    expect(backend.calls.filter(call => call.method === 'prompt.submit')).toEqual([]);
  });

  it('keeps stop acknowledgement separate from final completion', async () => {
    const { service, backend, ref } = await fixture();
    await service.sendMessage(ref, 'Do some work');
    expect((await service.interruptChat(ref)).status).toBe('streaming');
    backend.emit('default', 'message.complete', { text: 'Stopped.', status: 'interrupted' });
    await vi.waitFor(async () => expect((await service.getChat(ref)).status).toBe('interrupted'));
  });

  it('offers actual approval choices and answers only the selected conversation', async () => {
    const { service, backend, ref } = await fixture();
    await service.openChat({ connectionId: 'remote', profile: 'work' });
    backend.request('default', 'srq-7', 'approval', { command: 'safe command', description: 'Needs approval', choices: ['once', 'session', 'always', 'deny'] });
    await vi.waitFor(async () => expect((await service.getChat(ref)).questions).toHaveLength(1));
    const question = (await service.getChat(ref)).questions[0]!;
    expect(question.options?.map(option => option.value)).toEqual(['once', 'session', 'deny']);
    await expect(service.answerQuestion({ ...ref, profile: 'work' }, question.id, 'once')).rejects.toThrow('no longer pending');
    await service.answerQuestion(ref, question.id, 'once');
    await vi.waitFor(() => expect(backend.responses).toContainEqual({ jsonrpc: '2.0', id: 'srq-7', result: { choice: 'once' } }));
  });

  it('collects clarification answers by upstream qid and cancels withdrawn requests', async () => {
    const { service, backend, ref } = await fixture();
    backend.request('default', 'srq-8', 'clarify', { questions: [{ qid: 'a', question: 'First?' }, { qid: 'b', question: 'Second?', choices: ['One', 'Two'] }] });
    await vi.waitFor(async () => expect((await service.getChat(ref)).questions).toHaveLength(2));
    let questions = (await service.getChat(ref)).questions;
    await service.answerQuestion(ref, questions[0]!.id, 'Alpha');
    expect(backend.responses).toEqual([]);
    await service.answerQuestion(ref, questions[1]!.id, 'Two');
    await vi.waitFor(() => expect(backend.responses[0]).toMatchObject({ id: 'srq-8', result: { answers: { a: 'Alpha', b: 'Two' } } }));
    backend.request('default', 'srq-9', 'approval', { command: 'command', choices: ['once', 'deny'] });
    await vi.waitFor(async () => expect((await service.getChat(ref)).questions).toHaveLength(1));
    backend.emit('default', 'request.cancel', { id: 'srq-9', method: 'approval', reason: 'timeout' });
    await vi.waitFor(async () => expect((await service.getChat(ref)).questions).toHaveLength(0));
  });

  it('fails unsupported peer requests clearly without exposing credentials', async () => {
    const { service, backend, ref } = await fixture();
    backend.request('default', 'srq-10', 'secret', { env_var: 'PRIVATE_KEY', prompt: backend.token });
    await vi.waitFor(() => expect(backend.responses[0]).toMatchObject({ id: 'srq-10', error: { code: -32601 } }));
    expect((await service.getChat(ref)).questions).toEqual([]);
    expect(JSON.stringify(backend.responses)).not.toContain(backend.token);
  });

  it('bounds streamed text/tool results and redacts the upstream transport token', async () => {
    const { service, backend, ref } = await fixture();
    backend.emit('default', 'message.delta', { text: `${backend.token} ${'a'.repeat(30_000)}` });
    backend.emit('default', 'tool.start', { tool_id: 'tool-1', name: 'terminal', args: { command: 'inspect' } });
    backend.emit('default', 'tool.complete', { tool_id: 'tool-1', name: 'terminal', result_text: `${backend.token} ${'b'.repeat(9_000)}` });
    await vi.waitFor(async () => expect((await service.getChat(ref)).tools[0]?.state).toBe('completed'));
    const result = await service.getChat(ref);
    expect(result.messages[0]!.content.length).toBeLessThan(24_100);
    expect(result.tools[0]!.output!.length).toBeLessThan(6_100);
    expect(JSON.stringify(result)).not.toContain(backend.token);
    expect(JSON.stringify(await service.listConnections())).not.toContain('token');
  });

  it('uses only GET cron routes and preserves execution/delivery uncertainty', async () => {
    const { service, backend } = await fixture();
    const jobs = await service.listCron('remote', 'all');
    expect(jobs.map(job => job.profile)).toEqual(['default', 'work']);
    expect(jobs[0]).toMatchObject({ lastStatus: 'unknown', deliveryStatus: 'failed' });
    const runs = await service.getCronRuns('remote', 'work', 'same-job');
    expect(runs[0]).toMatchObject({ profile: 'work', jobId: 'same-job', status: 'unknown', deliveryStatus: 'unknown' });
    expect(runs[1]).toMatchObject({ status: 'success', deliveryStatus: 'failed' });
    expect(runs[2]).toMatchObject({ status: 'unknown', deliveryStatus: 'pending' });
    expect(backend.reads).toEqual([{ path: '/api/cron/jobs', profile: 'all' }, { path: '/api/cron/jobs/same-job/runs', profile: 'work' }]);
  });

  it('rejects invalid owners and hides upstream authentication error bodies', async () => {
    const { service, backend } = await fixture();
    await expect(service.openChat({ connectionId: 'remote', profile: 'all' })).rejects.toThrow('concrete');
    await expect(service.listCron('remote', '../work')).rejects.toThrow('concrete');
    backend.rejectReads = true;
    await expect(service.listCron('remote', 'work')).rejects.toThrow('authentication failed');
    try { await service.listCron('remote', 'work'); } catch (error) { expect(String(error)).not.toContain(backend.token); }
  });
});

describe('JSON-RPC correlation', () => {
  it('returns generic errors rather than upstream secret-bearing diagnostics', async () => {
    const backend = new Backend(); await backend.start(); backends.push(backend);
    const url = backend.url.replace('http:', 'ws:') + `/api/ws?token=${backend.token}`;
    const rpc = new HermesRpcClient(() => url, { onEvent() {}, onRequest() {}, onDisconnect() {} });
    await rpc.connect();
    for (const socket of backend.sockets) { socket.send('null'); socket.send('[]'); socket.send('"invalid"'); }
    await expect(rpc.request('unknown.method')).rejects.toThrow('Hermes refused the operation.');
    rpc.dispose();
  });
});
