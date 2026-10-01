import type {
  ChatArchiveResult, ChatConfiguration, ChatConfigurationResult, ChatRef, ChatSnapshot, ConnectionSummary, CronJob, CronRun,
  JsonValue, ModelCatalogue, ModelOption, Profile, SessionSummary,
} from '../shared/types';
import { ActionError, friendlyError, type HermesApi } from './api';

export const ownerKey = (connectionId: string, profile: string) => JSON.stringify([connectionId, profile]);
export const chatKey = (ref: ChatRef) => JSON.stringify([ref.connectionId, ref.profile, ref.sessionId]);
export const snapshotRef = (chat: ChatSnapshot): ChatRef => ({ connectionId: chat.connectionId, profile: chat.profile, sessionId: chat.id });

export interface ProfileSection {
  expanded: boolean;
  sessions: SessionSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}
const emptySection = (): ProfileSection => ({ expanded: false, sessions: [], loading: false, loaded: false, error: null });

type DraftChoice = Pick<ChatConfiguration, 'modelId' | 'reasoningEffort'>;
export interface ModelConfirmation {
  ref: ChatRef;
  title: string;
  message: string;
  modelId: string;
  reasoningEffort?: string;
}

export interface ArchiveNotice {
  ref: ChatRef;
  title: string;
  archived: boolean;
}

export interface WorkspaceState {
  connections: ConnectionSummary[];
  profiles: Profile[];
  sessions: SessionSummary[];
  profileSections: Record<string, ProfileSection>;
  modelCatalogues: Record<string, ModelCatalogue>;
  modelsLoading: Record<string, boolean>;
  modelsError: Record<string, string>;
  draftChoices: Record<string, DraftChoice>;
  confirmations: Record<string, ModelConfirmation>;
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
  archivePending: Record<string, 'archive' | 'restore'>;
  archiveErrors: Record<string, string>;
  archiveNotices: Record<string, ArchiveNotice>;
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
  connections: [], profiles: [], sessions: [], profileSections: {}, modelCatalogues: {}, modelsLoading: {},
  modelsError: {}, draftChoices: {}, confirmations: {}, connectionId: '', profile: '', sessionId: null,
  tab: 'chat', connectionState: 'disconnected', loading: true, profilesLoading: false,
  sessionsLoading: false, chatLoading: false, error: null, chats: {}, drafts: {}, pending: {},
  uncertain: {}, attempted: {}, archivePending: {}, archiveErrors: {}, archiveNotices: {},
  cron: [], allProfiles: false, cronLoading: false, cronError: null,
  selectedJob: null, runs: [], runsLoading: false, runsError: null,
});

/** Navigation generations reject late responses, even after A → B → A. */
export class WorkspaceStore {
  private state = initialState();
  private readonly listeners = new Set<() => void>();
  private ownerGeneration = 0;
  private connectionGeneration = 0;
  private sessionGeneration = 0;
  private cronGeneration = 0;
  private jobGeneration = 0;
  private started = false;
  private lastSession: Record<string, string | null> = {};
  private requestSequence: Record<string, number> = {};
  private sectionSequence: Record<string, number> = {};
  private catalogueSequence: Record<string, number> = {};
  private archiveRows: Record<string, { session: SessionSummary; index: number }> = {};

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

  getCatalogue() {
    return this.state.modelCatalogues[ownerKey(this.state.connectionId, this.state.profile)];
  }

  getModelSelection(): { catalogue?: ModelCatalogue; model?: ModelOption; label: string; reasoningEffort?: string; profileDefault: boolean } {
    const catalogue = this.getCatalogue();
    const profile = this.state.profiles.find((item) => item.name === this.state.profile);
    // A reconnect must reveal the refreshed session settings, never an old optimistic choice.
    const chat = this.state.chatLoading ? undefined : this.getChat();
    const choice = this.state.sessionId ? undefined : this.state.draftChoices[this.getDraftKey()];
    const id = this.state.sessionId ? chat?.modelId : choice?.modelId ?? catalogue?.defaultModelId;
    const model = catalogue?.models.find((item) => item.id === id)
      ?? (chat?.model ? catalogue?.models.find((item) => item.model === chat.model && item.provider === chat.provider) : undefined);
    return { catalogue, model, label: model?.label ?? (this.state.sessionId ? chat?.model ?? (this.state.chatLoading ? 'Loading model…' : 'Model unavailable') : profile?.model ?? 'Profile model'),
      reasoningEffort: model?.reasoningSupported === false ? undefined : this.state.sessionId ? chat?.reasoningEffort : choice?.reasoningEffort ?? catalogue?.defaultReasoningEffort ?? profile?.reasoningEffort,
      profileDefault: this.state.sessionId ? Boolean(chat?.modelId && chat.modelId === catalogue?.defaultModelId && (model?.reasoningSupported === false || (chat.reasoningEffort && chat.reasoningEffort === catalogue?.defaultReasoningEffort))) : !choice };
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
    const connectionGeneration = ++this.connectionGeneration;
    const generation = ++this.ownerGeneration;
    ++this.sessionGeneration;
    ++this.cronGeneration;
    ++this.jobGeneration;
    this.update({ connectionId, profile: '', profiles: [], sessions: [], sessionId: null, profilesLoading: true,
      sessionsLoading: false, error: null, chatLoading: false, cron: [], selectedJob: null, runs: [],
      cronLoading: false, runsLoading: false, cronError: null, runsError: null, connectionState: 'connecting' });
    try {
      const profiles = await this.api.call<Profile[]>('list_profiles', { connectionId });
      if (generation !== this.ownerGeneration || connectionGeneration !== this.connectionGeneration) return;
      this.update({ profiles, profilesLoading: false, connectionState: 'connected' });
      const profile = profiles.find((item) => item.isDefault)?.name ?? profiles[0]?.name;
      if (profile) await this.selectProfile(profile);
    } catch (error) {
      if (generation === this.ownerGeneration) this.update({ profilesLoading: false, connectionState: 'error', error: friendlyError(error) });
    }
  }

  async selectProfile(profile: string, targetSession?: string) {
    if (!this.state.profiles.some((item) => item.name === profile)) return;
    const generation = ++this.ownerGeneration;
    ++this.sessionGeneration;
    ++this.cronGeneration;
    ++this.jobGeneration;
    const connectionId = this.state.connectionId;
    const sectionKey = ownerKey(connectionId, profile);
    const section = this.state.profileSections[sectionKey];
    const sessionId = targetSession ?? this.lastSession[sectionKey] ?? null;
    this.update({ profile, sessionId, sessions: section?.sessions ?? [], sessionsLoading: true, error: null,
      profileSections: { ...this.state.profileSections, [sectionKey]: { ...(section ?? emptySection()), expanded: true } },
      cron: [], selectedJob: null, runs: [], cronError: null, runsError: null, chatLoading: false,
      cronLoading: false, runsLoading: false });
    if (sessionId) void this.openSession(sessionId, false);
    if (this.state.tab === 'cron') void this.loadCron();
    await Promise.all([this.loadProfileSessions(connectionId, profile, generation), this.loadModels(connectionId, profile)]);
  }

  toggleProfile(profile: string) {
    const key = ownerKey(this.state.connectionId, profile);
    if (profile !== this.state.profile) { void this.selectProfile(profile); return; }
    const section = this.state.profileSections[key];
    const expanded = !section?.expanded;
    this.update({ profileSections: { ...this.state.profileSections, [key]: { ...(section ?? emptySection()), expanded } } });
    if (expanded && !section?.loaded && !section?.loading) void this.loadProfileSessions(this.state.connectionId, profile, this.ownerGeneration);
  }

  async openProfileSession(profile: string, sessionId: string) {
    if (profile === this.state.profile) return this.openSession(sessionId);
    this.update({ tab: 'chat' });
    return this.selectProfile(profile, sessionId);
  }

  newProfileChat(profile: string) {
    if (profile !== this.state.profile) void this.selectProfile(profile);
    if (this.state.profile === profile) this.newChat();
  }

  async loadProfileSessions(connectionId = this.state.connectionId, profile = this.state.profile, generation = this.ownerGeneration) {
    const key = ownerKey(connectionId, profile);
    const connectionGeneration = this.connectionGeneration;
    const sequence = this.sectionSequence[key] = (this.sectionSequence[key] ?? 0) + 1;
    const previous = this.state.profileSections[key];
    this.update({ profileSections: { ...this.state.profileSections, [key]: { ...(previous ?? emptySection()), loading: true, error: null } } });
    try {
      let sessions = await this.api.call<SessionSummary[]>('list_sessions', { connectionId, profile });
      if (connectionGeneration !== this.connectionGeneration || sequence !== this.sectionSequence[key]) return;
      if (sessions.some((session) => session.profile !== profile)) throw new ActionError('The bridge returned conversations owned by another profile. Reconnect to refresh the list.');
      // A concurrent list cannot make an archive or restore look acknowledged early.
      for (const [refKey, operation] of Object.entries(this.state.archivePending)) {
        const row = this.archiveRows[refKey];
        if (!row || refKey !== chatKey({ connectionId, profile, sessionId: row.session.id })) continue;
        if (operation === 'restore') sessions = sessions.filter((session) => session.id !== row.session.id);
        else if (!sessions.some((session) => session.id === row.session.id)) {
          sessions = [...sessions]; sessions.splice(Math.min(row.index, sessions.length), 0, row.session);
        }
      }
      const selected = generation === this.ownerGeneration && connectionId === this.state.connectionId && profile === this.state.profile;
      this.update({ profileSections: { ...this.state.profileSections, [key]: { ...this.state.profileSections[key], sessions, loading: false, loaded: true, error: null } },
        ...(selected ? { sessions, sessionsLoading: false } : {}) });
    } catch (error) {
      if (connectionGeneration !== this.connectionGeneration || sequence !== this.sectionSequence[key]) return;
      const message = friendlyError(error);
      this.update({ profileSections: { ...this.state.profileSections, [key]: { ...this.state.profileSections[key], loading: false, error: message } },
        ...(generation === this.ownerGeneration ? { sessionsLoading: false } : {}) });
    }
  }

  async loadModels(connectionId = this.state.connectionId, profile = this.state.profile) {
    if (!connectionId || !profile) return;
    const key = ownerKey(connectionId, profile);
    const connectionGeneration = this.connectionGeneration;
    const sequence = this.catalogueSequence[key] = (this.catalogueSequence[key] ?? 0) + 1;
    const modelsError = { ...this.state.modelsError }; delete modelsError[key];
    this.update({ modelsLoading: { ...this.state.modelsLoading, [key]: true }, modelsError });
    try {
      const catalogue = await this.api.call<ModelCatalogue>('list_models', { connectionId, profile });
      if (connectionGeneration !== this.connectionGeneration || sequence !== this.catalogueSequence[key]) return;
      if (catalogue.connectionId !== connectionId || catalogue.profile !== profile) throw new ActionError('The model list belongs to another profile. Refresh it before choosing a model.');
      this.update({ modelCatalogues: { ...this.state.modelCatalogues, [key]: catalogue }, modelsLoading: { ...this.state.modelsLoading, [key]: false } });
    } catch (error) {
      if (connectionGeneration !== this.connectionGeneration || sequence !== this.catalogueSequence[key]) return;
      this.update({ modelsError: { ...this.state.modelsError, [key]: friendlyError(error) }, modelsLoading: { ...this.state.modelsLoading, [key]: false } });
    }
  }

  newChat() {
    ++this.sessionGeneration;
    this.lastSession[ownerKey(this.state.connectionId, this.state.profile)] = null;
    this.update({ sessionId: null, tab: 'chat', chatLoading: false, error: null });
  }

  canArchiveChat(ref: ChatRef): boolean {
    const key = chatKey(ref);
    const chat = this.state.chats[key];
    return Boolean(ref.connectionId && ref.profile && ref.sessionId) && !this.state.pending[key]
      && !this.state.archivePending[key] && !this.state.uncertain[key] && !this.state.confirmations[key]
      && chat?.status !== 'streaming' && chat?.status !== 'unknown' && chat?.status !== 'connecting'
      && !chat?.questions.length;
  }

  /** Archive is reversible metadata; never infer ownership from the active view. */
  async archiveChat(ref: ChatRef, archived = true): Promise<boolean> {
    const key = chatKey(ref);
    const sectionKey = ownerKey(ref.connectionId, ref.profile);
    if (!ref.connectionId || !ref.profile || !ref.sessionId || this.state.pending[key] || this.state.archivePending[key] || (archived && !this.canArchiveChat(ref))) return false;
    const section = this.state.profileSections[sectionKey];
    const index = section?.sessions.findIndex((session) => session.id === ref.sessionId) ?? -1;
    if (archived && index >= 0) this.archiveRows[key] = { session: section!.sessions[index], index };
    const errors = { ...this.state.archiveErrors }; delete errors[key];
    this.update({ archiveErrors: errors, archivePending: { ...this.state.archivePending, [key]: archived ? 'archive' : 'restore' },
      pending: { ...this.state.pending, [key]: true } });
    try {
      const result = await this.api.call<ChatArchiveResult>('archive_chat', { ...ref, archived });
      if (result.connectionId !== ref.connectionId || result.profile !== ref.profile || result.sessionId !== ref.sessionId || result.archived !== archived) {
        throw new ActionError('Hermes returned an archive acknowledgement for another conversation. Refresh the list before trying again.');
      }
      // Reject every list started before this ACK, including a same-owner A → B → A read.
      this.sectionSequence[sectionKey] = (this.sectionSequence[sectionKey] ?? 0) + 1;
      const current = this.state.profileSections[sectionKey];
      let sessions = current?.sessions ?? [];
      const row = this.archiveRows[key];
      if (archived) sessions = sessions.filter((session) => session.id !== ref.sessionId);
      else if (row && !sessions.some((session) => session.id === ref.sessionId)) {
        sessions = [...sessions]; sessions.splice(Math.min(row.index, sessions.length), 0, row.session);
      }
      const selectedOwner = this.state.connectionId === ref.connectionId && this.state.profile === ref.profile;
      const selectedChat = selectedOwner && this.state.sessionId === ref.sessionId;
      if (archived && this.lastSession[sectionKey] === ref.sessionId) this.lastSession[sectionKey] = null;
      if (archived && selectedChat) ++this.sessionGeneration;
      this.update({ profileSections: { ...this.state.profileSections, [sectionKey]: { ...(current ?? emptySection()), sessions, loading: false } },
        ...(selectedOwner ? { sessions, sessionsLoading: false } : {}),
        ...(archived && selectedChat ? { sessionId: null, chatLoading: false } : {}),
        archiveNotices: { ...this.state.archiveNotices, [key]: { ref: { ...ref }, title: row?.session.title || 'Conversation', archived } } });
      if (!archived) void this.loadProfileSessions(ref.connectionId, ref.profile);
      return true;
    } catch (error) {
      this.update({ archiveErrors: { ...this.state.archiveErrors, [key]: friendlyError(error) } });
      return false;
    } finally {
      const archivePending = { ...this.state.archivePending }; delete archivePending[key];
      this.update({ archivePending, pending: { ...this.state.pending, [key]: false } });
    }
  }

  dismissArchiveNotice(ref: ChatRef) {
    const archiveNotices = { ...this.state.archiveNotices }; delete archiveNotices[chatKey(ref)];
    this.update({ archiveNotices });
  }

  private configurationBlocked(ref = this.getRef()) {
    const key = ref ? chatKey(ref) : this.getDraftKey();
    const chat = ref ? this.state.chats[key] : undefined;
    return this.state.chatLoading || this.state.pending[key] || this.state.uncertain[key] || this.state.confirmations[key]
      || chat?.status === 'streaming' || chat?.status === 'unknown' || chat?.status === 'connecting' || Boolean(chat?.questions.length);
  }

  async chooseModel(modelId: string) {
    const catalogue = this.getCatalogue();
    const model = catalogue?.models.find((item) => item.id === modelId);
    if (!model || !catalogue || this.configurationBlocked()) return;
    let reasoningEffort = this.getModelSelection().reasoningEffort;
    if (model.reasoningSupported === false) reasoningEffort = undefined;
    else if (reasoningEffort === 'none' && model.canDisableReasoning === false) {
      reasoningEffort = catalogue.reasoningEfforts.find((effort) => effort === catalogue.defaultReasoningEffort && effort !== 'none')
        ?? catalogue.reasoningEfforts.find((effort) => effort !== 'none');
    }
    return this.chooseConfiguration({ modelId, ...(reasoningEffort ? { reasoningEffort } : {}) });
  }

  async chooseReasoning(reasoningEffort: string) {
    const selection = this.getModelSelection();
    if (!selection.catalogue?.reasoningEfforts.includes(reasoningEffort) || selection.model?.reasoningSupported === false
      || (reasoningEffort === 'none' && selection.model?.canDisableReasoning === false) || this.configurationBlocked()) return;
    const draftChoice = !this.getRef() ? this.state.draftChoices[this.getDraftKey()] : undefined;
    return this.chooseConfiguration({ ...(draftChoice?.modelId ? { modelId: draftChoice.modelId } : {}), reasoningEffort });
  }

  async useProfileDefault() {
    const catalogue = this.getCatalogue();
    if (!catalogue || this.configurationBlocked()) return;
    if (!this.getRef()) {
      const draftChoices = { ...this.state.draftChoices }; delete draftChoices[this.getDraftKey()];
      this.update({ draftChoices });
      return;
    }
    const model = catalogue.models.find((item) => item.id === catalogue.defaultModelId);
    return this.chooseConfiguration({ modelId: catalogue.defaultModelId,
      ...(catalogue.defaultReasoningEffort && model?.reasoningSupported !== false ? { reasoningEffort: catalogue.defaultReasoningEffort } : {}) });
  }

  private async chooseConfiguration(choice: DraftChoice) {
    const ref = this.getRef();
    if (!ref) {
      this.update({ draftChoices: { ...this.state.draftChoices, [this.getDraftKey()]: choice } });
      return;
    }
    const key = chatKey(ref);
    const generation = this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
    this.update({ pending: { ...this.state.pending, [key]: true }, error: null });
    try {
      await this.applyConfiguration(ref, choice);
    } catch (error) {
      if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) this.update({ error: friendlyError(error) });
    } finally {
      this.update({ pending: { ...this.state.pending, [key]: false } });
    }
  }

  private async applyConfiguration(ref: ChatRef, choice: DraftChoice, confirm = false): Promise<boolean> {
    const result = await this.api.call<ChatConfigurationResult>('configure_chat', { ...ref, ...choice, ...(confirm ? { confirm: true } : {}) });
    const key = chatKey(ref);
    this.cacheChat(result.chat, ref);
    const confirmations = { ...this.state.confirmations };
    if (result.confirmation) {
      // The approved transaction must be exactly the one Hermes describes.
      if (choice.modelId && result.confirmation.modelId !== choice.modelId) throw new ActionError('Hermes returned a confirmation for a different model. Refresh the conversation before changing it.');
      if (choice.reasoningEffort && result.confirmation.reasoningEffort !== choice.reasoningEffort) throw new ActionError('Hermes returned a confirmation for different reasoning settings. Refresh the conversation before changing them.');
      confirmations[key] = { ref, ...result.confirmation };
    } else {
      delete confirmations[key];
    }
    this.update({ confirmations });
    return !result.confirmation;
  }

  async confirmConfiguration() {
    const ref = this.getRef();
    if (!ref) return;
    const key = chatKey(ref);
    const confirmation = this.state.confirmations[key];
    if (!confirmation || this.state.pending[key] || this.state.chats[key]?.status === 'streaming' || this.state.uncertain[key]) return;
    const generation = this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
    this.update({ pending: { ...this.state.pending, [key]: true }, error: null });
    try {
      await this.applyConfiguration(ref, { modelId: confirmation.modelId, ...(confirmation.reasoningEffort ? { reasoningEffort: confirmation.reasoningEffort } : {}) }, true);
    } catch (error) {
      // Retrying a guarded transaction always requires another explicit click.
      if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) this.update({ error: friendlyError(error) });
    } finally {
      this.update({ pending: { ...this.state.pending, [key]: false } });
    }
  }

  cancelConfiguration() {
    const ref = this.getRef();
    if (!ref || this.state.pending[chatKey(ref)]) return;
    const confirmations = { ...this.state.confirmations }; delete confirmations[chatKey(ref)];
    this.update({ confirmations });
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
    const originalRef = this.getRef();
    if (!text || !profile || !connectionId || this.configurationBlocked()) return;
    const generation = this.sessionGeneration;
    const ownerGeneration = this.ownerGeneration;
    const draftKey = this.getDraftKey();
    const rawDraft = this.state.drafts[draftKey];
    const choice = !originalRef ? this.state.draftChoices[draftKey] : undefined;
    const provisionalKey = JSON.stringify([connectionId, profile, sessionId]);
    if (this.state.pending[provisionalKey]) return;
    this.update({ pending: { ...this.state.pending, [provisionalKey]: true }, error: null });
    let ref = originalRef;
    let promptSubmitted = false;
    try {
      if (!ref) {
        const chat = await this.api.call<ChatSnapshot>('open_chat', { connectionId, profile });
        ref = { connectionId, profile, sessionId: chat.id };
        this.cacheChat(chat, ref);
        this.lastSession[ownerKey(connectionId, profile)] = chat.id;
        if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) this.update({ sessionId: chat.id });
        // Until an actual send begins, preserve the draft through model confirmation or failure.
        const draftChoices = { ...this.state.draftChoices }; delete draftChoices[draftKey];
        this.update({ drafts: { ...this.state.drafts, [draftKey]: this.state.drafts[draftKey] === rawDraft ? '' : this.state.drafts[draftKey], [chatKey(ref)]: rawDraft }, draftChoices });
      }
      const key = chatKey(ref);
      // Invalidate polls that started before this mutation, including delayed idle snapshots.
      this.requestSequence[key] = (this.requestSequence[key] ?? 0) + 1;
      this.update({ pending: { ...this.state.pending, [key]: true } });
      if (choice && !await this.applyConfiguration(ref, choice)) { void this.reloadSessions(connectionId, profile, ownerGeneration); return; }
      const draftChoices = { ...this.state.draftChoices }; delete draftChoices[draftKey];
      this.update({ drafts: { ...this.state.drafts, [key]: '' }, draftChoices, attempted: { ...this.state.attempted, [key]: text } });
      promptSubmitted = true;
      const chat = await this.api.call<ChatSnapshot>('send_message', { ...ref, text });
      this.cacheChat(chat, ref);
      const attempted = { ...this.state.attempted }; delete attempted[key];
      this.update({ attempted });
      void this.reloadSessions(connectionId, profile, ownerGeneration);
    } catch (error) {
      if (ref && promptSubmitted) {
        this.update({ uncertain: { ...this.state.uncertain, [chatKey(ref)]:
          'The send outcome is unknown. Check this conversation before sending another message.' } });
      } else if (generation === this.sessionGeneration && ownerGeneration === this.ownerGeneration) {
        const draftChoices = { ...this.state.draftChoices }; delete draftChoices[draftKey];
        this.update({ error: friendlyError(error), draftChoices });
      }
    } finally {
      const pending = { ...this.state.pending, [provisionalKey]: false };
      if (ref) pending[chatKey(ref)] = false;
      this.update({ pending });
    }
  }

  private async reloadSessions(connectionId: string, profile: string, generation: number) {
    await this.loadProfileSessions(connectionId, profile, generation);
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
