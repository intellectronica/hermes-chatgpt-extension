import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealHermesService } from '../src/hermes/service.js';
import { HermesRpcClient } from '../src/hermes/rpc.js';
import { modelId, REASONING_EFFORTS } from '../src/hermes/models.js';
import type { ChatRef } from '../src/shared/types.js';

interface Stored {
  runtime: string;
  rows: Record<string, unknown>[];
  running: boolean;
  inflight?: Record<string, unknown>;
  model: string;
  provider: string;
  effort: string;
  archived?: boolean;
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
  delayOptions = false;
  pendingOptions: (() => void)[] = [];
  failReasoningRead = false;
  lazySnapshot = false;
  avatar = { found: true, mime: 'image/png', size: 8, data: 'data:image/png;base64,iVBORw0KGgo=' };
  extraModels: string[] = [];
  archiveAck?: boolean;
  archiveKey?: string;
  pinnedArchivedRows: Record<string, unknown>[] = [];
  sessionRows?: Record<string, unknown>[];
  sessionListQueries: string[] = [];

  constructor() {
    this.server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      this.reads.push({ path: url.pathname, profile: url.searchParams.get('profile') });
      if (request.headers['x-hermes-session-token'] !== this.token || this.rejectReads) {
        response.writeHead(401).end(JSON.stringify({ error: this.token })); return;
      }
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/profiles/sessions') {
        this.sessionListQueries.push(url.search);
        const profile = url.searchParams.get('profile');
        const excluded = new Set((url.searchParams.get('exclude_sources') ?? '').split(','));
        const candidates = this.sessionRows ?? [...this.sessions.entries()].filter(([key]) => key.startsWith(`${profile}|`)).map(([, stored]) => ({
          id: 'same-session', profile, title: `${profile} conversation`, source: 'codex-extension', started_at: 1_796_000_000, archived: stored.archived,
        }));
        const filtered = candidates.filter(row => row.profile === profile && !row.archived && !excluded.has(String(row.source)));
        const offset = Number(url.searchParams.get('offset')) || 0;
        response.end(JSON.stringify({ sessions: [...filtered.slice(offset, offset + Number(url.searchParams.get('limit'))), ...this.pinnedArchivedRows], total: filtered.length, errors: {} }));
      } else if (url.pathname === '/api/cron/jobs') {
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
          case 'profiles.list': answer({ profiles: [{ name: 'default', model: 'default-model', provider: 'fixture', is_default: true, has_avatar: false }, { name: 'work', model: 'work-model', provider: 'fixture', has_avatar: true }] }); break;
          case 'profiles.get_asset': answer(this.avatar); break;
          case 'model.options': {
            const reply = (): void => answer({ model: `${profile}-model`, provider: 'fixture', providers: [
              { slug: 'fixture', name: 'Profile provider', api_url: `https://user:${this.token}@private.test`, models: [`${profile}-model`, 'alternate', 'no-reasoning', 'required-reasoning', 'guarded', 'locked', 'injected --global', ...this.extraModels], unavailable_models: ['locked'], capabilities: { [`${profile}-model`]: { reasoning: true }, alternate: { reasoning: true }, 'no-reasoning': { reasoning: false }, 'required-reasoning': { reasoning: true, can_disable_reasoning: false } } },
              { slug: 'other', name: 'Other provider', models: ['alternate'], capabilities: { alternate: { reasoning: true } } },
            ] });
            if (this.delayOptions) this.pendingOptions.push(reply); else reply();
            break;
          }
          case 'config.get':
            if (this.failReasoningRead && params.session_id) socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 5001, message: this.token } }));
            else answer({ value: params.session_id && session ? session.effort : profile === 'default' ? 'high' : 'low' });
            break;
          case 'config.set': {
            if (!session || params.scope !== 'session') throw new Error('Fixture settings require exact session scope.');
            if (params.key === 'model') {
              const tokens = String(params.value).split(' ');
              if (!tokens.includes('--session') || tokens.includes('--global')) throw new Error('A model selection must carry --session and never --global.');
              if (tokens[0] === 'guarded' && !params.confirm_expensive_model) { answer({ key: 'model', value: 'guarded', scope: 'session', confirm_required: true, confirm_message: 'This model costs more.' }); break; }
              session.model = tokens[0]!;
              session.provider = tokens[tokens.indexOf('--provider') + 1]!;
              if (tokens.includes('--reasoning')) session.effort = tokens[tokens.indexOf('--reasoning') + 1]!;
              answer({ key: 'model', value: session.model, scope: 'session' });
            } else { session.effort = String(params.value); answer({ key: 'reasoning', value: session.effort, scope: 'session' }); }
            break;
          }
          case 'session.list': answer({ sessions: session && !session.archived ? [{ id: 'same-session', title: `${profile} conversation`, started_at: 1_796_000_000, source: 'codex-extension' }] : [] }); break;
          case 'session.archive':
            if (!session || params.session_id !== 'same-session') throw new Error('Fixture archive requires a stored ID and its exact profile.');
            session.archived = params.archived === true;
            answer({ archived: this.archiveAck ?? session.archived, session_key: this.archiveKey ?? 'same-session' });
            break;
          case 'session.create':
          case 'session.resume': {
            if (!session) { session = { runtime: `${profile}.runtime`, rows: [], running: false, model: `${profile}-model`, provider: 'fixture', effort: profile === 'default' ? 'high' : 'low' }; this.sessions.set(key, session); }
            answer({ session_id: session.runtime, stored_session_id: 'same-session', messages: session.rows, running: session.running, inflight: session.inflight, info: { stored_session_id: 'same-session', model: this.lazySnapshot ? `${profile}-model` : session.model, ...(!this.lazySnapshot ? { provider: session.provider, reasoning_effort: session.effort } : { lazy: true }) }, open_requests: [] });
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

async function fixture(showAutomatedChats = false): Promise<{ service: RealHermesService; backend: Backend; ref: ChatRef }> {
  const backend = new Backend(); await backend.start(); backends.push(backend);
  process.env.HERMES_FIXTURE_TOKEN = backend.token;
  const service = new RealHermesService({ connections: [{ id: 'remote', label: 'Fixture', kind: 'http', baseUrl: backend.url, tokenEnv: 'HERMES_FIXTURE_TOKEN' }], sidebar: { showAutomatedChats } });
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
  it('excludes automated sources before the sidebar limit without dropping older human chats', async () => {
    const { service, backend } = await fixture();
    backend.sessionRows = [
      ...Array.from({ length: 130 }, (_, index) => ({ id: `cron-${index}`, profile: 'default', source: 'cron', title: 'Job run' })),
      ...['kanban', 'tool', 'oneshot'].map(source => ({ id: source, profile: 'default', source, title: 'Internal task' })),
      ...['cli', 'desktop', 'codex-extension', 'api_server', 'telegram', 'unknown'].map(source => ({ id: source, profile: 'default', source, title: 'Conversation' })),
      { id: 'legacy', profile: 'default', title: 'Older conversation' },
      { id: 'retagged-cron', profile: 'default', source: 'api_server', created_source: 'cron', title: 'Routed job run' },
    ];
    backend.pinnedArchivedRows = [{ id: 'archived-pin', profile: 'default', title: 'Pinned archive', archived: true }];
    expect((await service.listSessions('remote', 'default')).map(row => row.id)).toEqual(['cli', 'desktop', 'codex-extension', 'api_server', 'telegram', 'unknown', 'legacy']);
    const query = new URLSearchParams(backend.sessionListQueries.at(-1));
    expect(query.get('exclude_sources')).toBe('cron,kanban,tool,oneshot');
    expect(query.get('archived')).toBe('exclude');
    expect(query.get('profile')).toBe('default');
    expect(backend.reads.every(read => read.path !== '/api/sessions')).toBe(true);
  });

  it('can include automated sources through the bridge configuration', async () => {
    const { service, backend } = await fixture(true);
    backend.sessionRows = ['cron', 'tool', 'kanban', 'oneshot', 'cli'].map(source => ({ id: source, source, profile: 'default', title: 'Stored chat' }));
    expect(await service.listSessions('remote', 'default')).toHaveLength(5);
    expect(new URLSearchParams(backend.sessionListQueries.at(-1)).has('exclude_sources')).toBe(false);
  });

  it('fills the bounded visible list across pages when retagged automation occupies a page', async () => {
    const { service, backend } = await fixture();
    backend.sessionRows = [
      ...Array.from({ length: 100 }, (_, index) => ({ id: `retagged-${index}`, profile: 'default', source: 'cli', created_source: 'cron', title: 'Retagged run' })),
      { id: 'human', profile: 'default', source: 'cli', title: 'Human conversation' },
    ];
    expect((await service.listSessions('remote', 'default')).map(row => row.id)).toEqual(['human']);
    expect(backend.sessionListQueries.map(query => new URLSearchParams(query).get('offset'))).toEqual(['0', '100']);
  });

  it('archives and restores by durable owner without deleting history or changing another profile', async () => {
    const { service, backend, ref } = await fixture();
    await service.openChat({ connectionId: 'remote', profile: 'work' });
    backend.sessions.get('default|same-session')!.rows.push({ row_id: 1, role: 'assistant', text: 'Preserved history' });
    await expect(service.archiveChat(ref, true)).resolves.toEqual({ ...ref, archived: true });
    expect(await service.listSessions('remote', 'default')).toEqual([]);
    expect(await service.listSessions('remote', 'work')).toHaveLength(1);
    expect(backend.sessions.get('default|same-session')!.rows).toHaveLength(1);
    await expect(service.archiveChat(ref, false)).resolves.toEqual({ ...ref, archived: false });
    expect(await service.listSessions('remote', 'default')).toHaveLength(1);
    expect(backend.calls.filter(call => call.method === 'session.archive').map(call => call.params)).toEqual([
      { profile: 'default', session_id: 'same-session', archived: true },
      { profile: 'default', session_id: 'same-session', archived: false },
    ]);
    expect(backend.calls.some(call => /delete|prompt.submit/.test(call.method))).toBe(false);
  });

  it('requires an archive acknowledgement and blocks archiving an active managed turn', async () => {
    const { service, backend, ref } = await fixture();
    backend.archiveAck = false;
    await expect(service.archiveChat(ref, true)).rejects.toThrow('did not confirm');
    await service.archiveChat(ref, false);
    backend.archiveKey = 'another-session';
    await expect(service.archiveChat(ref, false)).rejects.toThrow('did not confirm');
    backend.archiveKey = undefined;
    await service.sendMessage(ref, 'Fixture-only message');
    const before = backend.calls.filter(call => call.method === 'session.archive').length;
    await expect(service.archiveChat(ref, true)).rejects.toThrow('finish');
    expect(backend.calls.filter(call => call.method === 'session.archive')).toHaveLength(before);
    await expect(service.archiveChat({ ...ref, profile: 'all' }, true)).rejects.toThrow('concrete');
  });

  it('inherits each profile’s model and effort without session-create overrides', async () => {
    const { service, backend, ref } = await fixture();
    expect(await service.getChat(ref)).toMatchObject({ model: 'default-model', provider: 'fixture', modelId: modelId('fixture', 'default-model'), reasoningEffort: 'high' });
    const work = await service.openChat({ connectionId: 'remote', profile: 'work' });
    expect(work).toMatchObject({ model: 'work-model', provider: 'fixture', modelId: modelId('fixture', 'work-model'), reasoningEffort: 'low' });
    expect(backend.calls.filter(call => call.method === 'session.create').every(call => !('model' in call.params) && !('provider' in call.params) && !('reasoning_effort' in call.params))).toBe(true);
  });

  it('fetches actual profile avatars and returns only safe, available provider/model pairs', async () => {
    const { service, backend } = await fixture();
    const profiles = await service.listProfiles('remote');
    expect(profiles.map(profile => profile.reasoningEffort)).toEqual(['high', 'low']);
    expect(profiles.every(profile => profile.avatar === backend.avatar.data)).toBe(true);
    expect(backend.calls.find(call => call.method === 'profiles.get_asset' && call.params.name === 'default')?.params).toEqual({ name: 'default', profile: 'default', asset: 'avatar' });
    const catalogue = await service.listModels('remote', 'default');
    expect(catalogue.defaultModelId).toBe(modelId('fixture', 'default-model'));
    expect(catalogue.models.some(model => model.id === catalogue.defaultModelId)).toBe(true);
    expect(catalogue.models.filter(model => model.model === 'alternate').map(model => model.id)).toEqual([modelId('fixture', 'alternate'), modelId('other', 'alternate')]);
    expect(catalogue.models.some(model => model.model === 'locked' || model.model.includes('--global'))).toBe(false);
    expect(catalogue.reasoningEfforts).toEqual([...REASONING_EFFORTS]);
    expect(JSON.stringify(catalogue)).not.toContain(backend.token);
    expect(JSON.stringify(catalogue)).not.toContain('api_url');
  });

  it('changes model and effort in one acknowledged session-only transaction', async () => {
    const { service, backend, ref } = await fixture();
    const work = await service.openChat({ connectionId: 'remote', profile: 'work' });
    const result = await service.configureChat(ref, { modelId: modelId('other', 'alternate'), reasoningEffort: 'xhigh' });
    expect(result.chat).toMatchObject({ model: 'alternate', provider: 'other', modelId: modelId('other', 'alternate'), reasoningEffort: 'xhigh' });
    expect(backend.calls.filter(call => call.method === 'config.set')).toEqual([{ method: 'config.set', params: { profile: 'default', session_id: 'default.runtime', key: 'model', scope: 'session', value: 'alternate --provider other --session --reasoning xhigh', confirm_expensive_model: false } }]);
    expect(await service.getChat({ connectionId: 'remote', profile: 'work', sessionId: work.id })).toMatchObject({ model: 'work-model', reasoningEffort: 'low' });
    expect((await service.listModels('remote', 'default')).defaultModelId).toBe(modelId('fixture', 'default-model'));
    expect(backend.calls.some(call => call.method === 'prompt.submit')).toBe(false);
  });

  it('rejects unavailable/injected models and unsupported reasoning before any settings write', async () => {
    const { service, backend, ref } = await fixture();
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'locked') })).rejects.toThrow('not available');
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'injected --global') })).rejects.toThrow('not available');
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'no-reasoning'), reasoningEffort: 'high' })).rejects.toThrow('does not expose');
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'required-reasoning'), reasoningEffort: 'none' })).rejects.toThrow('requires reasoning');
    await expect(service.configureChat(ref, { reasoningEffort: 'show' })).rejects.toThrow('supported reasoning');
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'alternate'), confirm: true })).rejects.toThrow('Review');
    expect(backend.calls.filter(call => call.method === 'config.set')).toEqual([]);
  });

  it('requires an exact, owner-scoped confirmation for guarded model choices', async () => {
    const { service, backend, ref } = await fixture();
    const pending = await service.configureChat(ref, { modelId: modelId('fixture', 'guarded'), reasoningEffort: 'high' });
    expect(pending.confirmation).toMatchObject({ title: 'Confirm model change', message: 'This model costs more.', modelId: modelId('fixture', 'guarded'), reasoningEffort: 'high' });
    expect(pending.chat.model).toBe('default-model');
    expect(backend.sessions.get('default|same-session')!.model).toBe('default-model');
    await expect(service.configureChat(ref, { modelId: modelId('fixture', 'guarded'), reasoningEffort: 'low', confirm: true })).rejects.toThrow('Review');
    const work = await service.openChat({ connectionId: 'remote', profile: 'work' });
    await expect(service.configureChat({ ...ref, profile: 'work', sessionId: work.id }, { modelId: modelId('fixture', 'guarded'), reasoningEffort: 'high', confirm: true })).rejects.toThrow('Review');
    const confirmed = await service.configureChat(ref, { modelId: modelId('fixture', 'guarded'), reasoningEffort: 'high', confirm: true });
    expect(confirmed.confirmation).toBeUndefined();
    expect(confirmed.chat.model).toBe('guarded');
    expect(backend.calls.filter(call => call.method === 'config.set')).toHaveLength(2);
    expect(backend.calls.some(call => call.method === 'prompt.submit')).toBe(false);
  });

  it('locks settings during catalogue loading and refuses a turn arriving from another client', async () => {
    const { service, backend, ref } = await fixture();
    backend.delayOptions = true;
    const changing = service.configureChat(ref, { modelId: modelId('fixture', 'alternate') });
    const rejected = expect(changing).rejects.toThrow('Wait for the current turn');
    await vi.waitFor(() => expect(backend.pendingOptions).toHaveLength(1));
    await expect(service.sendMessage(ref, 'Must not start while settings are loading')).rejects.toThrow('Wait for the current turn');
    backend.emit('default', 'message.start');
    await vi.waitFor(async () => expect((await service.getChat(ref)).status).toBe('streaming'));
    for (const reply of backend.pendingOptions.splice(0)) reply();
    await rejected;
    expect(backend.calls.filter(call => call.method === 'config.set' || call.method === 'prompt.submit')).toEqual([]);
  });

  it('retains accepted pins on lazy client reconnect and clears them after a backend epoch change', async () => {
    const { service, backend, ref } = await fixture();
    await service.configureChat(ref, { modelId: modelId('other', 'alternate'), reasoningEffort: 'xhigh' });
    backend.lazySnapshot = true;
    for (const socket of backend.sockets) socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(await service.getChat(ref)).toMatchObject({ model: 'alternate', provider: 'other', reasoningEffort: 'xhigh' });
    backend.epoch = 'epoch-two';
    const stored = backend.sessions.get('default|same-session')!;
    stored.model = 'default-model'; stored.provider = 'fixture'; stored.effort = 'high';
    for (const socket of backend.sockets) socket.terminate();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(await service.getChat(ref)).toMatchObject({ model: 'default-model', provider: 'fixture', reasoningEffort: 'high' });
    expect(backend.calls.filter(call => call.method === 'config.set')).toHaveLength(1);
  });

  it('reports missing effort evidence rather than keeping the old value after a combined change', async () => {
    const { service, backend, ref } = await fixture();
    backend.failReasoningRead = true;
    const result = await service.configureChat(ref, { modelId: modelId('fixture', 'alternate'), reasoningEffort: 'xhigh' });
    expect(result.chat.model).toBe('alternate');
    expect(result.chat.reasoningEffort).toBeUndefined();
    expect(result.chat.error).toContain('has not confirmed');
  });

  it('reports catalogue and avatar limits explicitly', async () => {
    const { service, backend } = await fixture();
    backend.extraModels = Array.from({ length: 1_001 }, (_, index) => `extra-${index}`);
    await expect(service.listModels('remote', 'default')).rejects.toThrow('1,000-model limit');
    backend.avatar = { found: true, mime: 'image/jpeg', size: 8, data: 'data:image/png;base64,iVBORw0KGgo=' };
    await expect(service.listProfiles('remote')).rejects.toThrow('could not be safely loaded');
  });

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
