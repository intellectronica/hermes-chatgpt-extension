import type {
  ChatRef, ChatSnapshot, ConnectionSummary, CronJob, CronRun,
  JsonValue, Profile, SessionSummary,
} from '../shared/types';
import { ActionError, friendlyError, type HermesApi } from './api';

export const ownerKey = (connectionId: string, profile: string) => JSON.stringify([connectionId, profile]);
export const chatKey = (ref: ChatRef) => JSON.stringify([ref.connectionId, ref.profile, ref.sessionId]);
export const snapshotRef = (chat: ChatSnapshot): ChatRef => ({ connectionId: chat.connectionId, profile: chat.profile, sessionId: chat.id });

export interface WorkspaceState {
  connections: ConnectionSummary[];
  profiles: Profile[];
  sessions: SessionSummary[];
  connectionId: string;
  profile: string;
  sessionId: string | null;
  tab: 'chat' | 'cron';
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  loading: boolean;
  profilesLoading: boolean;
  sessionsLoading: boolean;
  chatLoading: boolean;
  error: string | null;
  chats: Record<string, ChatSnapshot>;
  drafts: Record<string, string>;
  pending: Record<string, boolean>;
  uncertain: Record<string, string>;
  attempted: Record<string, string>;
  cron: CronJob[];
  allProfiles: boolean;
  cronLoading: boolean;
  cronError: string | null;
  selectedJob: CronJob | null;
  runs: CronRun[];
  runsLoading: boolean;
  runsError: string | null;
}

const initialState = (): WorkspaceState => ({
  connections: [], profiles: [], sessions: [], connectionId: '', profile: '', sessionId: null,
  tab: 'chat', connectionState: 'disconnected', loading: true, profilesLoading: false,
  sessionsLoading: false, chatLoading: false, error: null, chats: {}, drafts: {}, pending: {},
  uncertain: {}, attempted: {}, cron: [], allProfiles: false, cronLoading: false, cronError: null,
  selectedJob: null, runs: [], runsLoading: false, runsError: null,
});

/** Navigation generations reject late responses, even after A → B → A. */
export class WorkspaceStore {
  private state = initialState();
  private readonly listeners = new Set<() => void>();
  private ownerGeneration = 0;
  private sessionGeneration = 0;
  private cronGeneration = 0;
  private jobGeneration = 0;
  private started = false;
  private lastSession: Record<string, string | null> = {};
  private requestSequence: Record<string, number> = {};

  constructor(private readonly api: HermesApi) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  getRef(): ChatRef | null {
    const { connectionId, profile, sessionId } = this.state;
    return connectionId && profile && sessionId ? { connectionId, profile, sessionId } : null;
  }

  getChat(): ChatSnapshot | undefined {
    const ref = this.getRef();
    return ref ? this.state.chats[chatKey(ref)] : undefined;
  }

  getDraftKey(): string {
    const { connectionId, profile, sessionId } = this.state;
    return JSON.stringify([connectionId, profile, sessionId]);
  }

  setDraft(text: string) {
    this.update({ drafts: { ...this.state.drafts, [this.getDraftKey()]: text } });
  }

  setTab(tab: 'chat' | 'cron') {
    this.update({ tab });
    if (tab === 'cron') void this.loadCron();
  }

  async initialise() {
    if (this.started) return;
    this.started = true;
    try {
      const connections = await this.api.call<ConnectionSummary[]>('list_connections');
      this.update({ connections, loading: false });
      if (connections.length) await this.selectConnection(connections[0].id);
    } catch (error) {
      this.update({ loading: false, error: friendlyError(error), connectionState: 'error' });
    }
  }

  async selectConnection(connectionId: string) {
    const generation = ++this.ownerGeneration;
    ++this.sessionGeneration;
    ++this.cronGeneration;
    ++this.jobGeneration;
    this.update({ connectionId, profile: '', profiles: [], sessions: [], sessionId: null, profilesLoading: true,
      sessionsLoading: false, error: null, chatLoading: false, cron: [], selectedJob: null, runs: [],
      cronLoading: false, runsLoading: false, cronError: null, runsError: null, connectionState: 'connecting' });
    try {
      const profiles = await this.api.call<Profile[]>('list_profiles', { connectionId });
      if (generation !== this.ownerGeneration) return;
      this.update({ profiles, profilesLoading: false, connectionState: 'connected' });
      const profile = profiles.find((item) => item.isDefault)?.name ?? profiles[0]?.name;
      if (profile) await this.selectProfile(profile);
    } catch (error) {
      if (generation === this.ownerGeneration) this.update({ profilesLoading: false, connectionState: 'error', error: friendlyError(error) });
    }
  }

  async selectProfile(profile: string) {
    const generation = ++this.ownerGeneration;
    ++this.sessionGeneration;
    ++this.cronGeneration;
    ++this.jobGeneration;
    const connectionId = this.state.connectionId;
    const sessionId = this.lastSession[ownerKey(connectionId, profile)] ?? null;
    this.update({ profile, sessionId, sessions: [], sessionsLoading: true, error: null,
      cron: [], selectedJob: null, runs: [], cronError: null, runsError: null, chatLoading: false,
      cronLoading: false, runsLoading: false });
    if (sessionId) void this.openSession(sessionId, false);
    if (this.state.tab === 'cron') void this.loadCron();
    try {
      const sessions = await this.api.call<SessionSummary[]>('list_sessions', { connectionId, profile });
      if (generation !== this.ownerGeneration) return;
      if (sessions.some((session) => session.profile !== profile)) throw new ActionError('The bridge returned conversations owned by another profile. Reconnect to refresh the list.');
      this.update({ sessions, sessionsLoading: false });
    } catch (error) {
      if (generation === this.ownerGeneration) this.update({ sessionsLoading: false, error: friendlyError(error) });
    }
  }

  newChat() {
    ++this.sessionGeneration;
    this.lastSession[ownerKey(this.state.connectionId, this.state.profile)] = null;
    this.update({ sessionId: null, tab: 'chat', chatLoading: false, error: null });
  }

  private cacheChat(chat: ChatSnapshot, expected: ChatRef): boolean {
    // A malformed bridge response must never cross a selected session's ownership.
    if (chat.connectionId !== expected.connectionId || chat.profile !== expected.profile || chat.id !== expected.sessionId) {
      throw new ActionError('The bridge returned a conversation owned by another profile. Reconnect to check its ownership.');
    }
    const key = chatKey(expected);
    const previous = this.state.chats[key];
    if (previous && previous.epoch === chat.epoch && previous.cursor > chat.cursor) return false;
    this.update({ chats: { ...this.state.chats, [key]: chat } });
    return true;
  }

  async openSession(sessionId: string, activateTab = true) {
    const generation = ++this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    const { connectionId, profile } = this.state;
    const ref = { connectionId, profile, sessionId };
    this.lastSession[ownerKey(connectionId, profile)] = sessionId;
    this.update({ sessionId, ...(activateTab ? { tab: 'chat' as const } : {}), chatLoading: true, error: null });
    try {
      const chat = await this.api.call<ChatSnapshot>('open_chat', ref);
      if (generation !== this.sessionGeneration || ownerGeneration !== this.ownerGeneration) return;
      this.cacheChat(chat, ref);
      this.update({ chatLoading: false, connectionState: 'connected' });
    } catch (error) {
      if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) {
        this.update({ chatLoading: false, error: friendlyError(error), connectionState: 'error' });
      }
    }
  }

  async refreshChat() {
    const ref = this.getRef();
    if (!ref || this.state.chatLoading || this.state.pending[chatKey(ref)]) return;
    const key = chatKey(ref);
    const sequence = this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
    const generation = this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    try {
      const chat = await this.api.call<ChatSnapshot>('get_chat', ref);
      if (generation !== this.sessionGeneration || ownerGeneration !== this.ownerGeneration || sequence !== this.requestSequence[key]) return;
      if (!this.cacheChat(chat, ref)) return;
      const uncertain = { ...this.state.uncertain };
      const attempted = { ...this.state.attempted };
      // The bridge resolves ambiguous handoff. Its unknown status continues blocking new sends.
      if (chat.status === 'idle' || chat.status === 'streaming' || chat.status === 'interrupted') { delete uncertain[key]; delete attempted[key]; }
      this.update({ connectionState: 'connected', error: null, uncertain, attempted });
    } catch (error) {
      if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration && sequence === this.requestSequence[key]) {
        this.update({ connectionState: 'error', error: friendlyError(error) });
      }
    }
  }

  async reconnect() {
    if (!this.state.connectionId) {
      this.started = false;
      this.update({ loading: true, error: null });
      return this.initialise();
    }
    const ref = this.getRef();
    this.update({ error: null, connectionState: 'connecting' });
    if (ref) await this.refreshChat();
    else await this.selectConnection(this.state.connectionId);
  }

  async send() {
    const { connectionId, profile, sessionId } = this.state;
    const text = this.state.drafts[this.getDraftKey()]?.trim();
    const current = this.getChat();
    const originalRef = this.getRef();
    if (!text || !profile || !connectionId || this.state.chatLoading || current?.status === 'streaming'
      || current?.status === 'unknown' || (originalRef && (this.state.pending[chatKey(originalRef)] || this.state.uncertain[chatKey(originalRef)]))) return;
    const generation = this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    const draftKey = this.getDraftKey();
    const provisionalKey = JSON.stringify([connectionId, profile, sessionId]);
    if (this.state.pending[provisionalKey]) return;
    this.update({ pending: { ...this.state.pending, [provisionalKey]: true }, error: null });
    let ref = originalRef;
    try {
      if (!ref) {
        const chat = await this.api.call<ChatSnapshot>('open_chat', { connectionId, profile });
        ref = { connectionId, profile, sessionId: chat.id };
        this.cacheChat(chat, ref);
        this.lastSession[ownerKey(connectionId, profile)] = chat.id;
        if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) this.update({ sessionId: chat.id });
      }
      const key = chatKey(ref);
      // Invalidate polls that started before this mutation, including delayed idle snapshots.
      this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
      this.update({ pending: { ...this.state.pending, [key]: true }, drafts: { ...this.state.drafts, [draftKey]: '' }, attempted: { ...this.state.attempted, [key]: text } });
      const chat = await this.api.call<ChatSnapshot>('send_message', { ...ref, text });
      this.cacheChat(chat, ref);
      const attempted = { ...this.state.attempted }; delete attempted[key];
      this.update({ attempted });
      if (ownerGeneration === this.ownerGeneration) void this.reloadSessions(connectionId, profile, ownerGeneration);
    } catch (error) {
      if (ref) {
        this.update({ uncertain: { ...this.state.uncertain, [chatKey(ref)]:
          'The send outcome is unknown. Check this conversation before sending another message.' } });
      } else if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) {
        this.update({ error: friendlyError(error) });
      }
    } finally {
      const pending = { ...this.state.pending, [provisionalKey]: false };
      if (ref) pending[chatKey(ref)] = false;
      this.update({ pending });
    }
  }

  private async reloadSessions(connectionId: string, profile: string, generation: number) {
    try {
      const sessions = await this.api.call<SessionSummary[]>('list_sessions', { connectionId, profile });
      if (generation === this.ownerGeneration && sessions.every((session) => session.profile === profile)) this.update({ sessions });
    } catch { /* The chat result remains usable; the next profile refresh reloads the rail. */ }
  }

  private async mutateChat(action: 'interrupt_chat' | 'answer_question', args: { questionId?: string; response?: JsonValue } = {}) {
    const ref = this.getRef();
    if (!ref) return;
    const key = chatKey(ref);
    if (this.state.pending[key]) return;
    const generation = this.ownerGeneration;
    this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
    this.update({ pending: { ...this.state.pending, [key]: true }, error: null });
    try {
      const chat = await this.api.call<ChatSnapshot>(action, { ...ref, ...args });
      this.cacheChat(chat, ref);
    } catch (error) {
      if (generation === this.ownerGeneration) this.update({ error: friendlyError(error) });
    } finally {
      this.update({ pending: { ...this.state.pending, [key]: false } });
    }
  }

  interrupt = () => this.mutateChat('interrupt_chat');
  answer = (questionId: string, response: JsonValue) => this.mutateChat('answer_question', { questionId, response });

  setAllProfiles(allProfiles: boolean) {
    this.update({ allProfiles });
    void this.loadCron();
  }

  async loadCron() {
    const generation = ++this.cronGeneration;
    const ownerGeneration = this.ownerGeneration;
    const { connectionId, profile, allProfiles } = this.state;
    if (!connectionId || !profile) return;
    ++this.jobGeneration;
    this.update({ cronLoading: true, cronError: null, selectedJob: null, runs: [], runsLoading: false });
    try {
      const cron = await this.api.call<CronJob[]>('list_cron_jobs', { connectionId, profile: allProfiles ? 'all' : profile });
      if (generation !== this.cronGeneration || ownerGeneration !== this.ownerGeneration) return;
      if (!allProfiles && cron.some((job) => job.profile !== profile)) throw new ActionError('The bridge returned jobs owned by another profile. Refresh the list.');
      this.update({ cron, cronLoading: false });
    } catch (error) {
      if (generation === this.cronGeneration && ownerGeneration === this.ownerGeneration) this.update({ cronLoading: false, cronError: friendlyError(error) });
    }
  }

  async openJob(job: CronJob) {
    const generation = ++this.jobGeneration;
    const ownerGeneration = this.ownerGeneration;
    const connectionId = this.state.connectionId;
    this.update({ selectedJob: job, runs: [], runsLoading: true, runsError: null });
    try {
      const runs = await this.api.call<CronRun[]>('get_cron_runs', { connectionId, profile: job.profile, jobId: job.id, limit: 20 });
      if (generation !== this.jobGeneration || ownerGeneration !== this.ownerGeneration) return;
      if (runs.some((run) => run.profile !== job.profile || run.jobId !== job.id)) throw new ActionError('The bridge returned runs owned by another job. Refresh its details.');
      this.update({ runs, runsLoading: false });
    } catch (error) {
      if (generation === this.jobGeneration && ownerGeneration === this.ownerGeneration) this.update({ runsLoading: false, runsError: friendlyError(error) });
    }
  }

  closeJob() {
    ++this.jobGeneration;
    this.update({ selectedJob: null, runs: [], runsLoading: false, runsError: null });
  }
}
