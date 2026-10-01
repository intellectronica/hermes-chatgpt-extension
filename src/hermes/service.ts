import { randomUUID } from 'node:crypto';
import type { ChatConfiguration, ChatConfigurationResult, ChatMessage, ChatRef, ChatSnapshot, ConnectionConfig, ConnectionSummary, CronJob, CronRun, HermesConfig, HermesService, JsonValue, ModelCatalogue, ModelOption, OpenChatArgs, Profile, Question, SessionSummary, ToolActivity } from '../shared/types.js';
import { HermesConnection } from './connection.js';
import { HermesRpcClient, HermesRpcError, HermesTransportError, object, type RpcFrame } from './rpc.js';
import { avatarData, isModelToken, isReasoningEffort, modelId, REASONING_EFFORTS } from './models.js';

const MAX_MESSAGES = 250;
const MAX_TOOLS = 100;
const MAX_TEXT = 24_000;
const MAX_TOOL_TEXT = 6_000;
const MAX_CHATS = 100;
const MAX_MODELS = 1_000;
const METADATA_TTL = 60_000;

function text(value: unknown, limit = MAX_TEXT): string {
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try { return text(JSON.stringify(value), limit); } catch { return '[unsupported content]'; }
  }
  return text(String(value), limit);
}

function safeText(value: unknown, connection: HermesConnection, limit = MAX_TEXT): string {
  return connection.redact(text(value, limit))
    .replace(/(\b(?:Bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=: ]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1[redacted]@');
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const date = new Date(typeof value === 'number' ? value < 1e12 ? value * 1000 : value : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function validProfile(profile: string, allowAll = false): void {
  if (!profile || !/^[A-Za-z0-9._-]{1,128}$/.test(profile) || profile === 'all' && !allowAll) {
    throw new Error('Select a concrete Hermes profile.');
  }
}

function validId(id: string): void {
  if (!id || id.length > 256 || /[\x00-\x1f]/.test(id)) throw new Error('A valid Hermes identifier is required.');
}

function executionStatus(value: unknown): string {
  const status = text(value, 100);
  return !status || status.startsWith('delivery_') ? 'unknown' : status;
}

interface PendingQuestion {
  peerId: string | number;
  kind: 'approval' | 'clarify';
  choices?: Set<string>;
  qid?: string;
  answers?: Record<string, string | null>;
  questionIds?: string[];
}

interface ChatRecord {
  ref: ChatRef;
  snapshot: ChatSnapshot;
  generation: number;
  lastSeq: number;
  pending: Map<string, PendingQuestion>;
  attaching?: Promise<void>;
  sending: boolean;
  assistantId?: string;
  lastUsed: number;
  lastSynced: number;
  configuring: boolean;
  /** Accepted session-only settings while a lazy snapshot cannot describe them. */
  acknowledgedModel?: { model: string; provider: string };
  confirmation?: { modelId: string; reasoningEffort?: string };
}

interface ConnectionRecord {
  connection: HermesConnection;
  rpc: HermesRpcClient;
  chats: Map<string, ChatRecord>;
  epoch?: string;
  catalogues: Map<string, { value: ModelCatalogue; fetched: number; generation: number }>;
  avatars: Map<string, { data?: string; fetched: number; generation: number }>;
}

export class RealHermesService implements HermesService {
  private readonly connections = new Map<string, ConnectionRecord>();
  private disposed = false;

  constructor(config: HermesConfig | ConnectionConfig[]) {
    const configs = Array.isArray(config) ? config : config.connections;
    for (const config of configs) {
      if (!config.id || this.connections.has(config.id)) throw new Error('Hermes connection IDs must be unique.');
      const connection = new HermesConnection(config);
      const record = { connection, chats: new Map<string, ChatRecord>(), catalogues: new Map(), avatars: new Map() } as ConnectionRecord;
      record.rpc = new HermesRpcClient(() => connection.wsUrl(), {
        onEvent: event => this.handleEvent(record, event),
        onRequest: frame => this.handleRequest(record, frame),
        onDisconnect: () => {
          connection.noteRpcState(false);
          for (const chat of record.chats.values()) {
            chat.generation = 0;
            chat.snapshot.status = 'unknown';
            chat.snapshot.error = 'Connection lost. Reconnect to inspect stored history; a pending message will not be resent.';
            chat.snapshot.cursor += 1;
          }
        },
      });
      this.connections.set(config.id, record);
    }
  }

  async listConnections(): Promise<ConnectionSummary[]> {
    return [...this.connections.values()].map(record => record.connection.summary());
  }

  private connection(id: string): ConnectionRecord {
    if (this.disposed) throw new Error('The Hermes service is closed.');
    const record = this.connections.get(id);
    if (!record) throw new Error('The selected Hermes connection is not configured.');
    return record;
  }

  private async connected(id: string): Promise<ConnectionRecord> {
    const record = this.connection(id);
    await record.connection.start();
    try { await record.rpc.connect(); }
    catch { record.connection.noteRpcState(false, 'Could not connect to Hermes. Check the backend and authentication.'); throw new HermesTransportError('Could not connect to Hermes. Check the backend and authentication.'); }
    record.connection.noteRpcState(true);
    return record;
  }

  async listProfiles(connectionId: string): Promise<Profile[]> {
    const record = await this.connected(connectionId);
    const result = object(await record.rpc.request('profiles.list', { profile: 'default', include_sessions: false }, 60_000));
    if (Array.isArray(result.profiles) && result.profiles.length > 100) throw new Error('This Hermes view supports up to 100 profiles.');
    const profiles = rows(result.profiles).filter(row => typeof row.name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(row.name));
    if (profiles.filter(row => row.has_avatar === true || row.name === 'default').length > 16) throw new Error('This Hermes view supports up to 16 profile avatars.');
    const values = await Promise.all(profiles.map(async (row): Promise<Profile> => {
      const name = String(row.name);
      const [reasoning, avatar] = await Promise.allSettled([
        record.rpc.request('config.get', { profile: name, key: 'reasoning' }, 30_000),
        row.has_avatar === true || name === 'default' ? this.profileAvatar(record, name) : Promise.resolve(undefined),
      ]);
      if (avatar.status === 'rejected') throw new Error('A Hermes profile avatar could not be safely loaded. Check its format, size and connection.');
      return {
        name, label: safeText(row.display_name || name, record.connection, 200),
        ...(row.model ? { model: safeText(row.model, record.connection, 200) } : {}),
        ...(row.provider ? { provider: safeText(row.provider, record.connection, 200) } : {}),
        ...(reasoning.status === 'fulfilled' && typeof object(reasoning.value).value === 'string' ? { reasoningEffort: safeText(object(reasoning.value).value, record.connection, 100) } : {}),
        ...(avatar.status === 'fulfilled' && avatar.value ? { avatar: avatar.value } : {}), isDefault: row.is_default === true,
      };
    }));
    let avatarBytes = 0;
    for (const profile of values) {
      avatarBytes += profile.avatar?.length ?? 0;
    }
    if (avatarBytes > 8_000_000) throw new Error('The profile avatars exceed this view’s 8 MB display limit.');
    return values;
  }

  private async profileAvatar(record: ConnectionRecord, profile: string): Promise<string | undefined> {
    const cached = record.avatars.get(profile);
    if (cached && cached.generation === record.rpc.generation && Date.now() - cached.fetched < METADATA_TTL) return cached.data;
    const result = await record.rpc.request('profiles.get_asset', { profile, name: profile, asset: 'avatar' }, 30_000);
    const data = avatarData(result);
    if (object(result).found === true && !data) throw new Error('Hermes returned an unsupported or oversized profile avatar.');
    if (record.avatars.size >= 16 && !record.avatars.has(profile)) record.avatars.delete(record.avatars.keys().next().value!);
    record.avatars.set(profile, { data, fetched: Date.now(), generation: record.rpc.generation });
    return data;
  }

  async listModels(connectionId: string, profile: string): Promise<ModelCatalogue> {
    validProfile(profile);
    const record = await this.connected(connectionId);
    const cached = record.catalogues.get(profile);
    if (cached && cached.generation === record.rpc.generation && Date.now() - cached.fetched < METADATA_TTL) return this.catalogueSnapshot(cached.value);
    const [options, reasoning] = await Promise.all([
      record.rpc.request('model.options', { profile, explicit_only: true, include_unconfigured: false }, 60_000),
      record.rpc.request('config.get', { profile, key: 'reasoning' }, 30_000),
    ]);
    const raw = object(options);
    const models: ModelOption[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.providers) && raw.providers.length > 100) throw new Error('The Hermes model catalogue exceeds this view’s provider limit.');
    for (const provider of rows(raw.providers)) {
      if (!isModelToken(provider.slug)) continue;
      const unavailable = new Set(Array.isArray(provider.unavailable_models) ? provider.unavailable_models : []);
      for (const model of Array.isArray(provider.models) ? provider.models : []) {
        if (!isModelToken(model) || unavailable.has(model)) continue;
        const id = modelId(provider.slug, model);
        if (seen.has(id)) continue;
        if (models.length >= MAX_MODELS) throw new Error('The Hermes model catalogue exceeds this view’s 1,000-model limit.');
        const capabilities = object(object(provider.capabilities)[model]);
        models.push({ id, model, label: safeText(model, record.connection, 512), provider: provider.slug,
          providerLabel: safeText(provider.name || provider.slug, record.connection, 200),
          ...(typeof capabilities.reasoning === 'boolean' ? { reasoningSupported: capabilities.reasoning } : {}),
          ...(typeof capabilities.can_disable_reasoning === 'boolean' ? { canDisableReasoning: capabilities.can_disable_reasoning } : {}),
        });
        seen.add(id);
      }
    }
    const value: ModelCatalogue = { connectionId, profile, models,
      defaultModelId: isModelToken(raw.provider) && isModelToken(raw.model) ? modelId(raw.provider, raw.model) : '',
      defaultReasoningEffort: safeText(object(reasoning).value, record.connection, 100) || undefined,
      reasoningEfforts: [...REASONING_EFFORTS],
    };
    record.catalogues.set(profile, { value, fetched: Date.now(), generation: record.rpc.generation });
    if (record.catalogues.size > 100) record.catalogues.delete(record.catalogues.keys().next().value!);
    return this.catalogueSnapshot(value);
  }

  private catalogueSnapshot(value: ModelCatalogue): ModelCatalogue {
    return { ...value, models: value.models.map(model => ({ ...model })), reasoningEfforts: [...value.reasoningEfforts] };
  }

  async listSessions(connectionId: string, profile: string): Promise<SessionSummary[]> {
    validProfile(profile);
    const record = await this.connected(connectionId);
    const result = object(await record.rpc.request('session.list', { profile, limit: 100 }, 60_000));
    return rows(result.sessions).slice(0, 100).map(row => ({
      id: text(row.id, 256), title: safeText(row.title || 'Untitled chat', record.connection, 200), profile,
      updatedAt: iso(row.last_active ?? row.started_at), source: text(row.source, 100),
    })).filter(row => row.id);
  }

  async openChat(args: OpenChatArgs): Promise<ChatSnapshot> {
    validProfile(args.profile);
    if (args.sessionId) return this.getChat({ connectionId: args.connectionId, profile: args.profile, sessionId: args.sessionId });
    const record = await this.connected(args.connectionId);
    const config = record.connection.config;
    // Omitting cwd preserves Hermes's profile-specific terminal setting. Explicit remote cwd never inherits the Mac's cwd.
    const result = object(await record.rpc.request('session.create', {
      profile: args.profile, source: 'codex-extension', close_on_disconnect: false,
      ...(config.cwd ? { cwd: config.cwd, cwd_explicit: true } : {}),
    }, 60_000));
    const storedId = text(result.stored_session_id || object(result.info).stored_session_id, 256);
    const runtimeId = text(result.session_id, 256);
    if (!storedId || !runtimeId) throw new Error('The Hermes backend did not return supported session identifiers.');
    const ref = { connectionId: args.connectionId, profile: args.profile, sessionId: storedId };
    const chat = this.newRecord(ref, runtimeId);
    this.applySession(record, chat, result);
    this.keepChat(record, chat);
    await this.hydrateSelection(record, chat);
    return this.snapshot(chat);
  }

  private newRecord(ref: ChatRef, runtimeId?: string): ChatRecord {
    return {
      ref: { ...ref }, generation: 0, lastSeq: 0, pending: new Map(), sending: false, configuring: false, lastUsed: Date.now(), lastSynced: 0,
      snapshot: { connectionId: ref.connectionId, profile: ref.profile, id: ref.sessionId, runtimeId, status: 'connecting', messages: [], tools: [], questions: [], cursor: 0 },
    };
  }

  private key(ref: ChatRef): string { return JSON.stringify([ref.profile, ref.sessionId]); }

  private keepChat(record: ConnectionRecord, chat: ChatRecord): void {
    record.chats.set(this.key(chat.ref), chat);
    if (record.chats.size <= MAX_CHATS) return;
    const inactive = [...record.chats.entries()].filter(([, candidate]) => candidate !== chat && !candidate.sending && candidate.snapshot.status !== 'streaming' && candidate.pending.size === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const oldest = inactive[0];
    if (oldest) record.chats.delete(oldest[0]);
  }

  private async chat(ref: ChatRef): Promise<{ record: ConnectionRecord; chat: ChatRecord }> {
    validProfile(ref.profile);
    validId(ref.sessionId);
    const record = await this.connected(ref.connectionId);
    let chat = record.chats.get(this.key(ref));
    if (!chat) { chat = this.newRecord(ref); this.keepChat(record, chat); }
    chat.lastUsed = Date.now();
    if (chat.generation !== record.rpc.generation || chat.snapshot.status === 'unknown' && !chat.sending || chat.snapshot.status === 'streaming' && Date.now() - chat.lastSynced > 15_000) {
      if (!chat.attaching) chat.attaching = this.attach(record, chat).finally(() => { chat!.attaching = undefined; });
      await chat.attaching;
    }
    if (!chat.snapshot.provider || !chat.snapshot.reasoningEffort) await this.hydrateSelection(record, chat);
    return { record, chat };
  }

  private async attach(record: ConnectionRecord, chat: ChatRecord): Promise<void> {
    const priorRuntime = chat.snapshot.runtimeId;
    const priorEpoch = chat.snapshot.epoch;
    const priorSeq = chat.lastSeq;
    const result = object(await record.rpc.request('session.resume', {
      // A cold ordinary resume can auto-continue a crashed turn. Lazy/watch resume never starts one;
      // prompt.submit upgrades it only when the user deliberately sends a message.
      profile: chat.ref.profile, session_id: chat.ref.sessionId, source: 'codex-extension', lazy: true, inline_images: false, close_on_disconnect: false,
    }, 60_000));
    this.applySession(record, chat, result);
    await this.hydrateSelection(record, chat);
    if (priorRuntime && priorRuntime === chat.snapshot.runtimeId && priorEpoch && priorEpoch === record.rpc.epoch && priorSeq > 0) {
      try {
        const replay = object(await record.rpc.request('session.events.since', { profile: chat.ref.profile, session_id: priorRuntime, last_seen: priorSeq }, 15_000));
        // History and inflight above are authoritative. Replay work/control state without duplicating text.
        if (!replay.truncated) for (const event of rows(replay.events)) {
          if (!text(event.type).startsWith('message.')) this.handleEvent(record, event);
          else if (typeof event.seq === 'number') chat.lastSeq = Math.max(chat.lastSeq, event.seq);
        }
        this.recoverRequests(record, rows(replay.open_requests));
      } catch { /* The authoritative resume is sufficient when no event ring remains. */ }
    }
  }

  private applySession(record: ConnectionRecord, chat: ChatRecord, result: Record<string, unknown>): void {
    const info = object(result.info);
    chat.snapshot.runtimeId = text(result.session_id, 256) || chat.snapshot.runtimeId;
    if (!chat.snapshot.runtimeId) throw new Error('The Hermes backend did not return a supported runtime session.');
    chat.snapshot.messages = rows(result.messages).filter(row => row.display_kind !== 'hidden').slice(-MAX_MESSAGES).map((row, index) => this.message(record.connection, row, index));
    this.applyInfo(record, chat, info);
    const inflight = object(result.inflight);
    const running = result.running === true || info.running === true || inflight.streaming === true || ['starting', 'waiting', 'working', 'streaming', 'resuming'].includes(text(result.status));
    chat.snapshot.status = running ? 'streaming' : inflight.error ? 'interrupted' : 'idle';
    chat.snapshot.error = inflight.error ? safeText(inflight.error, record.connection, 1_000) : undefined;
    chat.snapshot.epoch = record.rpc.epoch;
    chat.snapshot.cursor += 1;
    chat.generation = record.rpc.generation;
    chat.lastSynced = Date.now();
    chat.pending.clear();
    chat.snapshot.questions = [];
    chat.assistantId = undefined;
    if (Object.keys(inflight).length) {
      const input = safeText(inflight.display_kind === 'process_complete' ? object(inflight.display_metadata).display_text : inflight.user, record.connection);
      // The durable user row may already be in history while its assistant response is still live.
      const tail = chat.snapshot.messages.at(-1);
      if (input && inflight.display_kind !== 'hidden' && !(tail?.role === 'user' && tail.content === input)) {
        chat.snapshot.messages.push({ id: `inflight-user-${randomUUID()}`, role: 'user', content: input });
      }
      const assistant = safeText(inflight.assistant, record.connection);
      if (assistant) {
        chat.assistantId = `inflight-assistant-${randomUUID()}`;
        chat.snapshot.messages.push({ id: chat.assistantId, role: 'assistant', content: assistant });
      }
    } else if (chat.snapshot.status === 'streaming') {
      const tail = chat.snapshot.messages.at(-1);
      chat.assistantId = tail?.role === 'assistant' ? tail.id : undefined;
    } else chat.assistantId = undefined;
    chat.snapshot.messages = chat.snapshot.messages.slice(-MAX_MESSAGES);
    this.recoverRequests(record, rows(result.open_requests));
  }

  private applyInfo(record: ConnectionRecord, chat: ChatRecord, info: Record<string, unknown>): void {
    // A lazy fallback lacks the session pin/provider. An accepted config.set is stronger evidence.
    if (info.lazy !== true || !chat.acknowledgedModel) {
      if (typeof info.model === 'string' && info.model) chat.snapshot.model = safeText(info.model, record.connection, 512);
      if (typeof info.provider === 'string' && info.provider) chat.snapshot.provider = safeText(info.provider, record.connection, 512);
    }
    if (typeof info.reasoning_effort === 'string' && info.reasoning_effort) chat.snapshot.reasoningEffort = safeText(info.reasoning_effort, record.connection, 100);
    chat.snapshot.modelId = isModelToken(chat.snapshot.model) && isModelToken(chat.snapshot.provider) ? modelId(chat.snapshot.provider, chat.snapshot.model) : undefined;
  }

  private async hydrateSelection(record: ConnectionRecord, chat: ChatRecord): Promise<boolean> {
    if (!chat.snapshot.provider) {
      try {
        const catalogue = await this.listModels(chat.ref.connectionId, chat.ref.profile);
        const matching = catalogue.models.filter(model => model.model === chat.snapshot.model);
        const selected = matching.find(model => model.id === catalogue.defaultModelId) || (matching.length === 1 ? matching[0] : undefined);
        if (selected) { chat.snapshot.provider = selected.provider; chat.snapshot.modelId = selected.id; }
      } catch { /* Chat/history still work when provider discovery is unavailable. */ }
    }
    try {
      const result = object(await record.rpc.request('config.get', { profile: chat.ref.profile, session_id: chat.snapshot.runtimeId, key: 'reasoning' }, 30_000));
      if (typeof result.value === 'string' && result.value) { chat.snapshot.reasoningEffort = safeText(result.value, record.connection, 100); return true; }
    } catch { /* Missing reasoning evidence remains unset. */ }
    return false;
  }

  private turnBlocksSettings(chat: ChatRecord): boolean {
    return chat.sending || chat.snapshot.status === 'streaming' || chat.snapshot.status === 'unknown' || chat.pending.size > 0;
  }

  async configureChat(ref: ChatRef, configuration: ChatConfiguration): Promise<ChatConfigurationResult> {
    if (configuration.reasoningEffort !== undefined && !isReasoningEffort(configuration.reasoningEffort)) throw new Error('Select one of Hermes’s supported reasoning levels.');
    if (configuration.modelId === undefined && configuration.reasoningEffort === undefined) throw new Error('Choose a model or reasoning level.');
    const { record, chat } = await this.chat(ref);
    if (chat.sending || chat.configuring || chat.snapshot.status === 'streaming' || chat.pending.size) throw new Error('Wait for the current turn or question before changing its model.');
    if (chat.snapshot.status === 'unknown') throw new Error('Reconnect and inspect the conversation before changing its model.');
    chat.configuring = true;
    try {
      const catalogue = await this.listModels(ref.connectionId, ref.profile);
      // A turn started by another attached client can arrive while the catalogue is loading.
      if (this.turnBlocksSettings(chat)) throw new Error('Wait for the current turn or question before changing its model.');
      const selected = catalogue.models.find(model => model.id === (configuration.modelId ?? chat.snapshot.modelId));
      if (configuration.modelId !== undefined && !selected) throw new Error('That model is not available in the selected Hermes profile.');
      if (configuration.reasoningEffort !== undefined && selected?.reasoningSupported === false) throw new Error('That model does not expose a reasoning control in Hermes.');
      if (configuration.reasoningEffort === 'none' && selected?.canDisableReasoning === false) throw new Error('That model requires reasoning to stay enabled.');
      if (configuration.confirm && (!chat.confirmation || chat.confirmation.modelId !== configuration.modelId || chat.confirmation.reasoningEffort !== configuration.reasoningEffort)) throw new Error('Review this model selection before confirming it.');
      if (configuration.modelId !== undefined && selected) {
        const result = object(await record.rpc.request('config.set', {
          profile: ref.profile, session_id: chat.snapshot.runtimeId, key: 'model', scope: 'session',
          value: `${selected.model} --provider ${selected.provider} --session${configuration.reasoningEffort ? ` --reasoning ${configuration.reasoningEffort}` : ''}`,
          confirm_expensive_model: configuration.confirm === true,
        }, 60_000));
        if (result.confirm_required === true) {
          chat.confirmation = { modelId: selected.id, ...(configuration.reasoningEffort ? { reasoningEffort: configuration.reasoningEffort } : {}) };
          return { chat: this.snapshot(chat), confirmation: { title: 'Confirm model change', message: safeText(result.confirm_message || result.warning || 'Hermes needs confirmation for this model selection.', record.connection, 4_000), ...chat.confirmation } };
        }
        if (result.scope && result.scope !== 'session') throw new Error('Hermes did not acknowledge a conversation-only model change.');
        if (!isModelToken(result.value)) throw new Error('Hermes returned an unsupported model acknowledgement.');
        chat.acknowledgedModel = { model: result.value, provider: selected.provider };
        chat.snapshot.model = result.value;
        chat.snapshot.provider = selected.provider;
        chat.snapshot.modelId = modelId(selected.provider, result.value);
      } else {
        const result = object(await record.rpc.request('config.set', { profile: ref.profile, session_id: chat.snapshot.runtimeId, key: 'reasoning', scope: 'session', value: configuration.reasoningEffort }, 30_000));
        if (result.scope && result.scope !== 'session') throw new Error('Hermes did not acknowledge a conversation-only reasoning change.');
        if (!isReasoningEffort(result.value)) throw new Error('Hermes returned an unsupported reasoning acknowledgement.');
        chat.snapshot.reasoningEffort = result.value;
      }
      chat.confirmation = undefined;
      if (configuration.modelId && configuration.reasoningEffort) chat.snapshot.reasoningEffort = undefined;
      const hasEffortEvidence = await this.hydrateSelection(record, chat);
      if (configuration.modelId && configuration.reasoningEffort && (!hasEffortEvidence || chat.snapshot.reasoningEffort !== configuration.reasoningEffort)) {
        chat.snapshot.reasoningEffort = undefined;
        chat.snapshot.error = 'The model change was accepted, but Hermes has not confirmed the requested reasoning level. Inspect the selection before sending.';
      }
      chat.snapshot.cursor += 1;
      return { chat: this.snapshot(chat) };
    } catch (error) {
      if (error instanceof HermesTransportError && error.ambiguous) {
        chat.snapshot.status = 'unknown';
        chat.snapshot.error = 'The model change outcome is unknown. Reconnect to inspect this conversation; the change will not be repeated automatically.';
        chat.snapshot.cursor += 1;
      }
      throw error;
    } finally { chat.configuring = false; }
  }

  private message(connection: HermesConnection, row: Record<string, unknown>, index: number): ChatMessage {
    const role = ['user', 'assistant', 'tool', 'system'].includes(text(row.role)) ? text(row.role) as ChatMessage['role'] : 'system';
    return {
      id: row._row_id !== undefined || row.row_id !== undefined ? `row-${text(row._row_id ?? row.row_id, 50)}` : `history-${index}`,
      role, content: safeText(row.text ?? row.content, connection), createdAt: iso(row.timestamp),
      ...(row.name ? { name: safeText(row.name, connection, 100) } : {}),
    };
  }

  async getChat(ref: ChatRef): Promise<ChatSnapshot> {
    const { chat } = await this.chat(ref);
    return this.snapshot(chat);
  }

  async sendMessage(ref: ChatRef, input: string): Promise<ChatSnapshot> {
    if (!input.trim() || input.length > 64_000) throw new Error('Enter a message of up to 64,000 characters.');
    const { record, chat } = await this.chat(ref);
    if (chat.sending || chat.configuring || chat.snapshot.status === 'streaming' || chat.pending.size) throw new Error('Wait for the current turn or question before sending another message.');
    if (chat.snapshot.status === 'unknown') throw new Error('Reconnect and inspect stored history before sending another message.');
    chat.sending = true;
    chat.assistantId = undefined;
    chat.snapshot.messages.push({ id: `user-${randomUUID()}`, role: 'user', content: safeText(input, record.connection), createdAt: new Date().toISOString() });
    chat.snapshot.messages = chat.snapshot.messages.slice(-MAX_MESSAGES);
    chat.snapshot.tools = [];
    chat.snapshot.error = undefined;
    chat.snapshot.status = 'streaming';
    chat.snapshot.cursor += 1;
    // The operation returns immediately; the bridge polls snapshots. Never retry this request automatically.
    void record.rpc.request('prompt.submit', { profile: ref.profile, session_id: chat.snapshot.runtimeId, text: input }, 1_800_000).catch(error => {
      if (chat.snapshot.status === 'idle' || chat.snapshot.status === 'interrupted') return;
      chat.snapshot.status = error instanceof HermesTransportError && error.ambiguous ? 'unknown' : 'interrupted';
      chat.snapshot.error = error instanceof HermesTransportError ? error.message : 'Hermes refused the message. Inspect the session before trying again.';
      chat.snapshot.cursor += 1;
    }).finally(() => { chat.sending = false; });
    return this.snapshot(chat);
  }

  async interruptChat(ref: ChatRef): Promise<ChatSnapshot> {
    const { record, chat } = await this.chat(ref);
    const result = object(await record.rpc.request('session.interrupt', { profile: ref.profile, session_id: chat.snapshot.runtimeId }, 30_000));
    if (result.status === 'not_interrupted' && chat.snapshot.status !== 'streaming') chat.snapshot.status = 'idle';
    else chat.snapshot.error = 'Stopping the turn. Waiting for Hermes to report its final state.';
    chat.snapshot.cursor += 1;
    return this.snapshot(chat);
  }

  async answerQuestion(ref: ChatRef, questionId: string, response: JsonValue): Promise<ChatSnapshot> {
    const { record, chat } = await this.chat(ref);
    const pending = chat.pending.get(questionId);
    if (!pending) throw new Error('This question is no longer pending in the selected conversation.');
    if (pending.kind === 'approval') {
      const choice = response === true ? 'once' : response === false ? 'deny' : response;
      if (typeof choice !== 'string' || !pending.choices?.has(choice)) throw new Error('Select one of the offered approval choices.');
      record.rpc.respond(pending.peerId, { choice });
      chat.pending.delete(questionId);
      chat.snapshot.questions = chat.snapshot.questions.filter(question => question.id !== questionId);
    } else {
      if (response !== null && typeof response !== 'string') throw new Error('A clarification answer must be text, or null to skip.');
      if (typeof response === 'string' && response.length > 8_000) throw new Error('The clarification answer is too long.');
      pending.answers![pending.qid!] = response;
      chat.pending.delete(questionId);
      chat.snapshot.questions = chat.snapshot.questions.filter(question => question.id !== questionId);
      if (pending.questionIds!.every(id => !chat.pending.has(id))) record.rpc.respond(pending.peerId, { answers: pending.answers });
    }
    chat.snapshot.cursor += 1;
    return this.snapshot(chat);
  }

  private recoverRequests(record: ConnectionRecord, requests: Record<string, unknown>[]): void {
    for (const request of requests) {
      const frame = object(request.frame);
      this.handleRequest(record, (frame.method ? frame : request) as RpcFrame);
    }
  }

  private handleRequest(record: ConnectionRecord, frame: RpcFrame): void {
    if (frame.id === undefined || frame.id === null) return;
    const params = object(frame.params);
    const chat = [...record.chats.values()].find(candidate => candidate.snapshot.runtimeId === params.session_id);
    if (!chat || !['approval', 'clarify'].includes(frame.method ?? '')) { record.rpc.rejectRequest(frame.id); return; }
    if (frame.method === 'approval') {
      const id = String(frame.id);
      if (chat.pending.has(id)) return;
      // Permanent approval mutates backend policy; the first version offers only once/session/deny.
      const choices = Array.isArray(params.choices) && params.choices.length ? params.choices.filter(value => ['once', 'session', 'deny'].includes(String(value))).map(String) : ['once', 'deny'];
      if (!choices.includes('deny')) choices.push('deny');
      chat.pending.set(id, { peerId: frame.id, kind: 'approval', choices: new Set(choices) });
      chat.snapshot.questions.push({ id, kind: 'approval', title: 'Approval needed', prompt: safeText([params.description, params.command].filter(Boolean).join('\n'), record.connection, 4_000), options: choices.map(value => ({ value, label: value === 'once' ? 'Allow once' : value === 'session' ? 'Allow in this session' : 'Deny' })) });
    } else {
      const questions = rows(params.questions).slice(0, 5);
      if (!questions.length) { record.rpc.rejectRequest(frame.id, -32602); return; }
      const answers = object(params.answers) as Record<string, string | null>;
      const questionIds = questions.map(question => `${frame.id}:${text(question.qid, 128)}`);
      for (const [index, question] of questions.entries()) {
        const id = questionIds[index]!;
        const qid = text(question.qid, 128);
        if (!qid || qid in answers || chat.pending.has(id)) continue;
        chat.pending.set(id, { peerId: frame.id, kind: 'clarify', qid, answers, questionIds });
        chat.snapshot.questions.push({ id, kind: 'clarify', title: 'Hermes has a question', prompt: safeText(question.question, record.connection, 4_000), ...(Array.isArray(question.choices) ? { options: question.choices.slice(0, 20).map(choice => ({ value: text(choice, 500), label: safeText(choice, record.connection, 500) })) } : {}) });
      }
    }
    chat.snapshot.questions = chat.snapshot.questions.slice(-20);
    chat.snapshot.cursor += 1;
  }

  private handleEvent(record: ConnectionRecord, event: Record<string, unknown>): void {
    const type = text(event.type, 100);
    const payload = object(event.payload);
    if (type === 'gateway.ready') {
      const epoch = text(payload.replay_epoch, 200);
      if (epoch && record.epoch && record.epoch !== epoch) {
        for (const chat of record.chats.values()) {
          chat.generation = 0; chat.lastSeq = 0; chat.pending.clear(); chat.snapshot.questions = [];
          chat.acknowledgedModel = undefined; chat.confirmation = undefined; chat.snapshot.provider = undefined; chat.snapshot.modelId = undefined; chat.snapshot.reasoningEffort = undefined;
          chat.snapshot.status = 'unknown'; chat.snapshot.error = 'The Hermes backend restarted. Reload stored history; in-flight work is not guaranteed to survive.'; chat.snapshot.cursor += 1;
        }
      }
      if (epoch) record.epoch = epoch;
      return;
    }
    const chat = [...record.chats.values()].find(candidate => candidate.snapshot.runtimeId === event.session_id);
    if (!chat) return;
    if (typeof event.seq === 'number') {
      if (event.seq <= chat.lastSeq) return;
      chat.lastSeq = event.seq;
    }
    if (type === 'message.start') { chat.snapshot.status = 'streaming'; chat.assistantId = undefined; }
    if (type === 'message.delta') {
      chat.snapshot.status = 'streaming';
      let message = chat.snapshot.messages.find(message => message.id === chat.assistantId);
      if (!message) {
        chat.assistantId = `assistant-${randomUUID()}`;
        message = { id: chat.assistantId, role: 'assistant', content: '' };
        chat.snapshot.messages.push(message);
      }
      message.content = safeText(message.content + text(payload.text), record.connection);
    }
    if (type === 'message.interim') {
      const message = chat.snapshot.messages.find(message => message.id === chat.assistantId);
      if (message && payload.already_streamed === true) message.content = safeText(payload.text, record.connection);
      else chat.snapshot.messages.push({ id: `interim-${randomUUID()}`, role: 'assistant', content: safeText(payload.text, record.connection) });
      chat.assistantId = undefined;
    }
    if (type === 'message.complete') {
      const message = chat.snapshot.messages.find(message => message.id === chat.assistantId);
      const body = safeText(payload.text, record.connection);
      if (message) message.content = body || message.content;
      else if (body) chat.snapshot.messages.push({ id: `assistant-${randomUUID()}`, role: 'assistant', content: body });
      chat.snapshot.status = payload.status === 'interrupted' ? 'interrupted' : payload.status === 'error' ? 'interrupted' : 'idle';
      chat.snapshot.error = payload.status === 'error' ? safeText(payload.failure_reason || payload.error || 'The Hermes turn failed.', record.connection, 1_000) : undefined;
      chat.assistantId = undefined;
    }
    if (type === 'session.info') {
      this.applyInfo(record, chat, payload);
    }
    if (type === 'tool.start' || type === 'tool.generating' || type === 'tool.complete') {
      const id = text(payload.tool_id, 200);
      if (id) {
        let tool = chat.snapshot.tools.find(tool => tool.id === id);
        if (!tool) { tool = { id, name: safeText(payload.name || 'Tool', record.connection, 100), state: 'running' }; chat.snapshot.tools.push(tool); }
        if (payload.args || payload.args_text || payload.preview) tool.input = safeText(payload.args_text ?? payload.preview ?? payload.args, record.connection, MAX_TOOL_TEXT);
        if (type === 'tool.complete') {
          const result = object(payload.result);
          tool.state = result.error || result.is_error === true || result.success === false ? 'error' : 'completed';
          tool.output = safeText(payload.result_text ?? payload.summary ?? payload.result, record.connection, MAX_TOOL_TEXT);
        }
      }
    }
    if (type === 'request.cancel') {
      const peerId = payload.id;
      for (const [id, pending] of chat.pending) if (pending.peerId === peerId) chat.pending.delete(id);
      chat.snapshot.questions = chat.snapshot.questions.filter(question => chat.pending.has(question.id));
    }
    if (type === 'error' || type === 'session.error') chat.snapshot.error = safeText(payload.message || payload.text || 'Hermes reported an error.', record.connection, 1_000);
    chat.snapshot.messages = chat.snapshot.messages.slice(-MAX_MESSAGES);
    chat.snapshot.tools = chat.snapshot.tools.slice(-MAX_TOOLS);
    chat.snapshot.cursor += 1;
  }

  async listCron(connectionId: string, profile: string): Promise<CronJob[]> {
    validProfile(profile, true);
    const record = this.connection(connectionId);
    const result = await record.connection.get(`/api/cron/jobs?profile=${encodeURIComponent(profile)}`);
    return rows(result).slice(0, 1_000).map(row => {
      const owner = text(row.profile ?? row.profile_name ?? (profile === 'all' ? '' : profile), 128);
      return {
        id: text(row.id, 256), profile: owner, name: safeText(row.name || 'Unnamed job', record.connection, 200),
        schedule: safeText(row.schedule_display ?? object(row.schedule).value ?? row.schedule, record.connection, 200), enabled: row.enabled !== false,
        nextRunAt: iso(row.next_run_at), lastRunAt: iso(row.last_run_at), lastStatus: executionStatus(row.last_execution_status ?? row.execution_status ?? row.last_status),
        lastError: safeText(row.last_error, record.connection, 1_000) || undefined,
        timezone: text(row.timezone ?? row.schedule_timezone ?? object(row.schedule).timezone, 100) || undefined,
        deliveryStatus: text(row.delivery_status, 100) || (row.last_status === 'delivery_failed' ? 'failed' : row.last_status === 'delivery_queued' ? 'pending' : 'unknown'),
      };
    }).filter(job => job.id && job.profile && (profile === 'all' || job.profile === profile));
  }

  async getCronRuns(connectionId: string, profile: string, jobId: string, limit = 20): Promise<CronRun[]> {
    validProfile(profile);
    validId(jobId);
    const record = this.connection(connectionId);
    const boundedLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.floor(limit) : 20));
    const result = object(await record.connection.get(`/api/cron/jobs/${encodeURIComponent(jobId)}/runs?profile=${encodeURIComponent(profile)}&limit=${boundedLimit}`));
    return rows(result.runs).slice(0, boundedLimit).filter(row => !row.profile || row.profile === profile).map(row => ({
      id: text(row.id, 256), profile, jobId, title: safeText(row.title || 'Cron run', record.connection, 200),
      status: executionStatus(row.execution_status ?? row.status ?? (row.is_active === true ? 'running' : 'unknown')),
      startedAt: iso(row.started_at), finishedAt: iso(row.finished_at ?? row.ended_at), output: safeText(row.output ?? row.preview, record.connection, MAX_TOOL_TEXT) || undefined,
      deliveryStatus: text(row.delivery_status, 100) || (row.status === 'delivery_failed' ? 'failed' : row.status === 'delivery_queued' ? 'pending' : 'unknown'),
    })).filter(run => run.id);
  }

  private snapshot(chat: ChatRecord): ChatSnapshot {
    return { ...chat.snapshot, messages: chat.snapshot.messages.map(message => ({ ...message })), tools: chat.snapshot.tools.map(tool => ({ ...tool })), questions: chat.snapshot.questions.map(question => ({ ...question, ...(question.options ? { options: question.options.map(option => ({ ...option })) } : {}) })) };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const record of this.connections.values()) record.rpc.dispose();
    await Promise.all([...this.connections.values()].map(record => record.connection.dispose()));
    this.connections.clear();
  }
}

export { RealHermesService as HermesAdapter };

export function createHermesService(config: HermesConfig): HermesService {
  return new RealHermesService(config);
}
