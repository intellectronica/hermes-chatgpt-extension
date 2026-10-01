import { describe, expect, it } from 'vitest';
import type { ActionArgs, ActionName, ChatArchiveResult, ChatSnapshot, CronJob, CronRun, ModelCatalogue, SessionSummary } from '../src/shared/types';
import type { HermesApi } from '../src/web/api';
import { chatKey, ownerKey, WorkspaceStore } from '../src/web/store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(profile = 'A', cursor = 1, text = profile): ChatSnapshot {
  return { connectionId: 'local', profile, id: 'same-id', status: 'idle', cursor, epoch: 'one',
    model: 'shared-model', provider: `provider-${profile}`, modelId: catalogue(profile).defaultModelId, reasoningEffort: 'medium',
    messages: [{ id: 'm1', role: 'assistant', content: text }], tools: [], questions: [] };
}

function catalogue(profile = 'A'): ModelCatalogue {
  const models = [
    { id: JSON.stringify([`provider-${profile}`, 'shared-model']), model: 'shared-model', label: 'Shared model', provider: `provider-${profile}`, reasoningSupported: true },
    { id: JSON.stringify([`guarded-${profile}`, 'shared-model']), model: 'shared-model', label: 'Shared model', provider: `guarded-${profile}`, reasoningSupported: true, canDisableReasoning: false },
    { id: JSON.stringify([`provider-${profile}`, 'simple-model']), model: 'simple-model', label: 'Simple model', provider: `provider-${profile}`, reasoningSupported: false },
  ];
  return { connectionId: 'local', profile, models, defaultModelId: models[0].id, defaultReasoningEffort: 'medium', reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] };
}

class FakeApi implements HermesApi {
  calls: { action: ActionName; args: ActionArgs }[] = [];
  overrides: Partial<Record<ActionName, (args: ActionArgs) => Promise<unknown>>> = {};
  async call<T>(action: ActionName, args: ActionArgs = {}): Promise<T> {
    this.calls.push({ action, args });
    const handler = this.overrides[action];
    if (handler) return await handler(args) as T;
    const defaults: Partial<Record<ActionName, unknown>> = {
      list_connections: [{ id: 'local', label: 'Local Hermes', kind: 'http', status: 'connected' }],
      list_profiles: [{ name: 'A', isDefault: true }, { name: 'B' }],
      list_sessions: [], list_cron_jobs: [], get_cron_runs: [],
      list_models: catalogue(args.profile),
      configure_chat: { chat: { ...snapshot(args.profile, 2), ...(args.modelId ? { modelId: args.modelId } : {}), ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}) } },
      open_chat: snapshot(args.profile), get_chat: snapshot(args.profile), send_message: snapshot(args.profile),
      archive_chat: { connectionId: args.connectionId, profile: args.profile, sessionId: args.sessionId, archived: args.archived },
    };
    return defaults[action] as T;
  }
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('workspace isolation', () => {
  it('rejects stale session lists after A → B → A, even when the owner matches again', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    const reads: ReturnType<typeof deferred<SessionSummary[]>>[] = [];
    api.overrides.list_sessions = () => {
      const read = deferred<SessionSummary[]>(); reads.push(read); return read.promise;
    };
    const oldA = store.selectProfile('A');
    const oldB = store.selectProfile('B');
    const newA = store.selectProfile('A');
    reads[2].resolve([{ id: 'new', title: 'Current A', profile: 'A' }]);
    await newA;
    reads[0].resolve([{ id: 'old', title: 'Stale A', profile: 'A' }]);
    reads[1].resolve([{ id: 'wrong', title: 'Profile B', profile: 'B' }]);
    await Promise.all([oldA, oldB]);
    expect(store.getSnapshot().sessions.map((session) => session.title)).toEqual(['Current A']);
  });

  it('preserves independent drafts and rejects an old chat poll after A → B → A', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    await store.openSession('same-id');
    store.setDraft('Draft for A');
    const oldPoll = deferred<ChatSnapshot>();
    api.overrides.get_chat = () => oldPoll.promise;
    const oldRead = store.refreshChat();
    await store.selectProfile('B');
    await store.openSession('same-id');
    store.setDraft('Draft for B');
    expect(store.getChat()?.profile).toBe('B');
    api.overrides.open_chat = async (args) => snapshot(args.profile, 20, 'Current A');
    await store.selectProfile('A');
    await tick();
    oldPoll.resolve(snapshot('A', 99, 'Stale A'));
    await oldRead;
    expect(store.getChat()?.messages[0].content).toBe('Current A');
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Draft for A');
    await store.selectProfile('B');
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Draft for B');
    expect(api.calls.filter((call) => call.action === 'get_chat')[0].args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id' });
  });

  it('keeps a send attached to A while B is visible, then restores A’s result', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    await store.openSession('same-id');
    store.setDraft('Message for A');
    const sent = deferred<ChatSnapshot>();
    api.overrides.send_message = () => sent.promise;
    const sending = store.send();
    await store.selectProfile('B');
    await store.openSession('same-id');
    sent.resolve(snapshot('A', 4, 'A’s answer'));
    await sending;
    expect(store.getChat()?.profile).toBe('B');
    expect(store.getSnapshot().chats[chatKey({ connectionId: 'local', profile: 'A', sessionId: 'same-id' })].messages[0].content).toBe('A’s answer');
    expect(api.calls.find((call) => call.action === 'send_message')?.args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id', text: 'Message for A' });
  });

  it('blocks duplicate sends after a lost acknowledgement and checks the original session without resending', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    await store.openSession('same-id');
    api.overrides.send_message = async () => { throw new Error('Lost acknowledgement'); };
    store.setDraft('Do this once');
    await store.send();
    store.setDraft('Try again');
    await store.send();
    const unknown = snapshot('A', 2); unknown.status = 'unknown';
    api.overrides.get_chat = async () => unknown;
    await store.refreshChat();
    await store.send();
    expect(api.calls.filter((call) => call.action === 'send_message')).toHaveLength(1);
    expect(store.getSnapshot().uncertain[chatKey({ connectionId: 'local', profile: 'A', sessionId: 'same-id' })]).toBeTruthy();
    expect(store.getSnapshot().attempted[chatKey({ connectionId: 'local', profile: 'A', sessionId: 'same-id' })]).toBe('Do this once');
    api.overrides.get_chat = async () => snapshot('A', 1, 'Old idle state');
    await store.refreshChat();
    expect(store.getChat()?.status).toBe('unknown');
    expect(store.getSnapshot().uncertain[chatKey({ connectionId: 'local', profile: 'A', sessionId: 'same-id' })]).toBeTruthy();
    api.overrides.get_chat = async () => snapshot('A', 3, 'Confirmed result');
    await store.refreshChat();
    expect(store.getSnapshot().uncertain).toEqual({});
    expect(store.getSnapshot().attempted).toEqual({});
    expect(store.getChat()?.messages[0].content).toBe('Confirmed result');
  });

  it('does not let an older idle poll overwrite the acknowledged streaming turn', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    await store.openSession('same-id');
    const poll = deferred<ChatSnapshot>();
    api.overrides.get_chat = () => poll.promise;
    const reading = store.refreshChat();
    const streaming = snapshot('A', 2, 'Started'); streaming.status = 'streaming';
    api.overrides.send_message = async () => streaming;
    store.setDraft('Start');
    await store.send();
    poll.resolve(snapshot('A', 1, 'Before send'));
    await reading;
    expect(store.getChat()?.status).toBe('streaming');
    expect(store.getChat()?.messages[0].content).toBe('Started');
  });

  it('rejects a chat returned with another profile’s ownership', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    api.overrides.open_chat = async () => snapshot('B');
    await store.openSession('same-id');
    expect(store.getChat()).toBeUndefined();
    expect(store.getSnapshot().error).toBeTruthy();
  });

  it('keeps the cron tab open when changing to a profile with a remembered chat', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    await store.openSession('same-id');
    await store.selectProfile('B');
    store.setTab('cron');
    await store.selectProfile('A');
    await tick();
    expect(store.getSnapshot().tab).toBe('cron');
    expect(store.getSnapshot().sessionId).toBe('same-id');
    expect(api.calls.filter((call) => call.action === 'list_cron_jobs').at(-1)?.args.profile).toBe('A');
  });
});

describe('archive ownership and acknowledgement', () => {
  const ref = { connectionId: 'local', profile: 'A', sessionId: 'same-id' };
  const session = (profile = 'A'): SessionSummary => ({ id: 'same-id', title: `${profile} chat`, profile });

  it('keeps the row until ACK, blocks duplicates, then clears only the selected chat and preserves its drafts and new-chat settings', async () => {
    const api = new FakeApi(); api.overrides.list_sessions = async (args) => [session(args.profile)];
    const store = new WorkspaceStore(api); await store.initialise();
    store.setDraft('New A draft'); await store.chooseModel(catalogue().models[2].id);
    const newDraftKey = store.getDraftKey(); const newChoice = store.getSnapshot().draftChoices[newDraftKey];
    await store.openSession(ref.sessionId); store.setDraft('Saved A draft');
    const ack = deferred<ChatArchiveResult>(); api.overrides.archive_chat = () => ack.promise;
    const archiving = store.archiveChat(ref);
    expect(store.getSnapshot().sessions).toEqual([session()]);
    expect(store.getSnapshot().sessionId).toBe(ref.sessionId);
    expect(store.canArchiveChat(ref)).toBe(false);
    await store.archiveChat(ref);
    expect(api.calls.filter((call) => call.action === 'archive_chat')).toHaveLength(1);
    api.overrides.list_sessions = async () => [];
    await store.loadProfileSessions();
    expect(store.getSnapshot().sessions).toEqual([session()]);
    ack.resolve({ ...ref, archived: true }); await archiving;
    expect(store.getSnapshot().sessions).toEqual([]);
    expect(store.getSnapshot().sessionId).toBeNull();
    expect(store.getSnapshot().drafts[chatKey(ref)]).toBe('Saved A draft');
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('New A draft');
    expect(store.getSnapshot().draftChoices[newDraftKey]).toEqual(newChoice);
    expect(store.getSnapshot().archiveNotices[chatKey(ref)].ref).toEqual(ref);
  });

  it.each(['lost ACK', 'wrong owner', 'wrong operation'])('preserves the row and active draft after %s', async (failure) => {
    const api = new FakeApi(); api.overrides.list_sessions = async (args) => [session(args.profile)];
    const store = new WorkspaceStore(api); await store.initialise(); await store.openSession(ref.sessionId); store.setDraft('Do not lose this');
    api.overrides.archive_chat = async () => {
      if (failure === 'lost ACK') throw new Error('Lost acknowledgement');
      return { ...ref, ...(failure === 'wrong owner' ? { profile: 'B' } : {}), archived: failure !== 'wrong operation' };
    };
    expect(await store.archiveChat(ref)).toBe(false);
    expect(store.getSnapshot().sessions).toEqual([session()]);
    expect(store.getSnapshot().sessionId).toBe(ref.sessionId);
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Do not lose this');
    expect(store.getSnapshot().archiveNotices).toEqual({});
    expect(store.getSnapshot().archiveErrors[chatKey(ref)]).toBeTruthy();
    expect(store.canArchiveChat(ref)).toBe(true);
  });

  it('archives A while B is visible and restores the same A owner without changing B’s chat or settings', async () => {
    const api = new FakeApi(); api.overrides.list_sessions = async (args) => [session(args.profile)];
    const store = new WorkspaceStore(api); await store.initialise(); await store.openSession(ref.sessionId);
    const ack = deferred<ChatArchiveResult>(); api.overrides.archive_chat = () => ack.promise;
    const archiving = store.archiveChat(ref);
    await store.selectProfile('B'); await store.openSession('same-id'); store.setDraft('B draft');
    const bSelection = store.getModelSelection(); const bChat = store.getChat();
    ack.resolve({ ...ref, archived: true }); await archiving;
    expect(store.getChat()).toEqual(bChat);
    expect(store.getSnapshot().profileSections[ownerKey('local', 'A')].sessions).toEqual([]);
    expect(store.getSnapshot().sessions).toEqual([session('B')]);
    api.overrides.archive_chat = async (args) => ({ connectionId: args.connectionId, profile: args.profile, sessionId: args.sessionId, archived: args.archived });
    await store.archiveChat(ref, false); await tick();
    expect(api.calls.filter((call) => call.action === 'archive_chat').map((call) => call.args)).toEqual([{ ...ref, archived: true }, { ...ref, archived: false }]);
    expect(store.getSnapshot().profileSections[ownerKey('local', 'A')].sessions).toEqual([session()]);
    expect(store.getChat()).toEqual(bChat);
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('B draft');
    expect(store.getModelSelection()).toEqual(bSelection);
    expect(store.getSnapshot().archiveNotices[chatKey(ref)].archived).toBe(false);
  });

  it('rejects a stale list after archive ACK and clears the same selected chat after A → B → A', async () => {
    const api = new FakeApi(); api.overrides.list_sessions = async (args) => [session(args.profile)];
    const store = new WorkspaceStore(api); await store.initialise(); await store.openSession(ref.sessionId);
    const ack = deferred<ChatArchiveResult>(); api.overrides.archive_chat = () => ack.promise;
    const archiving = store.archiveChat(ref);
    await store.selectProfile('B'); await store.selectProfile('A'); await tick();
    expect(store.getSnapshot().sessionId).toBe(ref.sessionId);
    const list = deferred<SessionSummary[]>(); api.overrides.list_sessions = () => list.promise;
    const reading = store.loadProfileSessions();
    ack.resolve({ ...ref, archived: true }); await archiving;
    list.resolve([session()]); await reading;
    expect(store.getSnapshot().sessionId).toBeNull();
    expect(store.getSnapshot().sessions).toEqual([]);
    expect(store.getSnapshot().profileSections[ownerKey('local', 'A')].sessions).toEqual([]);
  });

  it('does not archive a live turn or an unknown prompt handoff', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api); await store.initialise();
    api.overrides.open_chat = async () => ({ ...snapshot(), status: 'streaming' }); await store.openSession(ref.sessionId);
    expect(await store.archiveChat(ref)).toBe(false);
    api.overrides.open_chat = async () => ({ ...snapshot('A', 2), status: 'unknown' }); await store.openSession(ref.sessionId);
    expect(await store.archiveChat(ref)).toBe(false);
    expect(api.calls.filter((call) => call.action === 'archive_chat')).toHaveLength(0);
  });
});

describe('cron inspection ownership', () => {
  it('uses each job’s owner in the all-profile view and rejects a late same-ID response', async () => {
    const api = new FakeApi();
    const store = new WorkspaceStore(api);
    await store.initialise();
    const jobs: CronJob[] = ['A', 'B'].map((profile) => ({ id: 'same-job', profile, name: `${profile} job`, schedule: '0 8 * * *', enabled: true }));
    api.overrides.list_cron_jobs = async () => jobs;
    store.setAllProfiles(true);
    await tick();
    const reads: ReturnType<typeof deferred<CronRun[]>>[] = [];
    api.overrides.get_cron_runs = () => { const read = deferred<CronRun[]>(); reads.push(read); return read.promise; };
    const oldA = store.openJob(jobs[0]);
    const currentB = store.openJob(jobs[1]);
    reads[1].resolve([{ id: 'B-run', profile: 'B', jobId: 'same-job', title: 'B result', status: 'success' }]);
    await currentB;
    reads[0].resolve([{ id: 'A-run', profile: 'A', jobId: 'same-job', title: 'A result', status: 'success' }]);
    await oldA;
    expect(store.getSnapshot().selectedJob?.profile).toBe('B');
    expect(store.getSnapshot().runs[0].title).toBe('B result');
    expect(api.calls.filter((call) => call.action === 'get_cron_runs').map((call) => call.args.profile)).toEqual(['A', 'B']);
    expect(api.calls.find((call) => call.action === 'list_cron_jobs')?.args.profile).toBe('all');
    expect(api.calls.every((call) => !String(call.action).includes('trigger'))).toBe(true);
  });
});

describe('native profile sections and conversation settings', () => {
  it('keeps expanded profile histories separate and opens each child with its owner', async () => {
    const api = new FakeApi();
    api.overrides.list_sessions = async (args) => [{ id: 'same-id', profile: args.profile!, title: `${args.profile} chat` }];
    const store = new WorkspaceStore(api);
    await store.initialise();
    store.setDraft('A draft');
    await store.selectProfile('B');
    store.setDraft('B draft');
    expect(store.getSnapshot().profileSections[ownerKey('local', 'A')].sessions[0].title).toBe('A chat');
    expect(store.getSnapshot().profileSections[ownerKey('local', 'B')].sessions[0].title).toBe('B chat');
    await store.openProfileSession('A', 'same-id');
    await tick();
    expect(store.getChat()?.profile).toBe('A');
    expect(api.calls.filter((call) => call.action === 'open_chat').at(-1)?.args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id' });
    store.toggleProfile('A');
    expect(store.getSnapshot().profileSections[ownerKey('local', 'A')].expanded).toBe(false);
    expect(store.getSnapshot().profileSections[ownerKey('local', 'B')].expanded).toBe(true);
    store.newChat();
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('A draft');
  });

  it('rejects a stale catalogue after A → B → A and preserves opaque provider/model choices per draft', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api);
    await store.initialise();
    const reads: ReturnType<typeof deferred<ModelCatalogue>>[] = [];
    api.overrides.list_models = () => { const read = deferred<ModelCatalogue>(); reads.push(read); return read.promise; };
    const oldA = store.selectProfile('A'); const oldB = store.selectProfile('B'); const currentA = store.selectProfile('A');
    const newest = catalogue('A'); newest.models[1].label = 'Current guarded model';
    reads[2].resolve(newest); await currentA;
    reads[0].resolve(catalogue('A')); reads[1].resolve(catalogue('B')); await Promise.all([oldA, oldB]);
    expect(store.getCatalogue()?.models[1].label).toBe('Current guarded model');
    await store.chooseModel(newest.models[1].id);
    await store.chooseReasoning('xhigh');
    api.overrides.list_models = async (args) => catalogue(args.profile);
    await store.selectProfile('B');
    expect(store.getModelSelection().model?.id).toBe(catalogue('B').defaultModelId);
    expect(store.getModelSelection().reasoningEffort).toBe('medium');
    await store.selectProfile('A');
    expect(store.getModelSelection().model?.id).toBe(newest.models[1].id);
    expect(store.getModelSelection().reasoningEffort).toBe('xhigh');
    expect(api.calls.filter((call) => call.action === 'configure_chat')).toHaveLength(0);
  });

  it('stops before a prompt for a guarded model, preserves its draft and requires an explicit exact confirmation', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api);
    await store.initialise();
    const modelId = catalogue().models[1].id;
    api.overrides.configure_chat = async (args) => args.confirm ? { chat: { ...snapshot('A', 3), modelId, reasoningEffort: 'high' } } : {
      chat: snapshot('A', 2), confirmation: { title: 'Expensive model', message: 'Hermes asks you to confirm this selection.', modelId, reasoningEffort: 'high' },
    };
    store.setDraft('Keep this draft'); await store.chooseModel(modelId); await store.chooseReasoning('high'); await store.send();
    expect(api.calls.filter((call) => call.action === 'send_message')).toHaveLength(0);
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Keep this draft');
    expect(store.getSnapshot().uncertain).toEqual({});
    expect(store.getSnapshot().confirmations[store.getDraftKey()].message).toBe('Hermes asks you to confirm this selection.');
    expect(store.canArchiveChat(store.getRef()!)).toBe(false);
    await store.archiveChat(store.getRef()!);
    expect(api.calls.filter((call) => call.action === 'archive_chat')).toHaveLength(0);
    await store.send();
    expect(api.calls.filter((call) => call.action === 'configure_chat')).toHaveLength(1);
    await store.selectProfile('B');
    await store.confirmConfiguration();
    expect(api.calls.filter((call) => call.action === 'configure_chat')).toHaveLength(1);
    await store.selectProfile('A'); await tick();
    await store.confirmConfiguration();
    expect(api.calls.filter((call) => call.action === 'configure_chat').at(-1)?.args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id', modelId, reasoningEffort: 'high', confirm: true });
    expect(api.calls.filter((call) => call.action === 'send_message')).toHaveLength(0);
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Keep this draft');
    await store.send();
    expect(api.calls.filter((call) => call.action === 'send_message')).toHaveLength(1);
    store.newChat(); expect(store.getModelSelection().profileDefault).toBe(true);
  });

  it('cancels without sending and distinguishes configuration failures from an unknown prompt handoff', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api);
    await store.initialise();
    const modelId = catalogue().models[1].id;
    api.overrides.configure_chat = async () => ({ chat: snapshot(), confirmation: { title: 'Confirm model', message: 'Continue?', modelId, reasoningEffort: 'medium' } });
    store.setDraft('Preserved'); await store.chooseModel(modelId); await store.send();
    store.cancelConfiguration();
    expect(store.getSnapshot().confirmations).toEqual({});
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Preserved');
    expect(store.getModelSelection().model?.id).toBe(catalogue().defaultModelId);
    store.newChat(); store.setDraft('Still preserved'); await store.chooseModel(modelId);
    api.overrides.configure_chat = async () => { throw new Error('Configuration failed'); };
    await store.send();
    expect(store.getSnapshot().drafts[store.getDraftKey()]).toBe('Still preserved');
    expect(store.getSnapshot().uncertain).toEqual({});
    expect(api.calls.filter((call) => call.action === 'send_message')).toHaveLength(0);
    expect(store.getSnapshot().error).toBeTruthy();
  });

  it('changes effort without changing a saved model, applies actual defaults and respects capability limits', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api);
    await store.initialise(); await store.openSession('same-id');
    await store.chooseReasoning('high');
    expect(api.calls.filter((call) => call.action === 'configure_chat').at(-1)?.args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id', reasoningEffort: 'high' });
    await store.useProfileDefault();
    expect(api.calls.filter((call) => call.action === 'configure_chat').at(-1)?.args).toEqual({ connectionId: 'local', profile: 'A', sessionId: 'same-id', modelId: catalogue().defaultModelId, reasoningEffort: 'medium' });
    await store.chooseModel(catalogue().models[2].id);
    const count = api.calls.filter((call) => call.action === 'configure_chat').length;
    await store.chooseReasoning('high');
    expect(api.calls.filter((call) => call.action === 'configure_chat')).toHaveLength(count);
    const waiting = snapshot('A', 10); waiting.questions = [{ id: 'q', title: 'Wait', kind: 'clarify', prompt: 'Answer me' }];
    api.overrides.get_chat = async () => waiting; await store.refreshChat();
    await store.chooseModel(catalogue().models[0].id);
    expect(api.calls.filter((call) => call.action === 'configure_chat')).toHaveLength(count);
  });

  it('uses refreshed authoritative settings after restart and never fills unknown effort from the profile default', async () => {
    const api = new FakeApi(); const store = new WorkspaceStore(api);
    await store.initialise(); await store.openSession('same-id');
    await store.chooseReasoning('ultra');
    const restarted = { ...snapshot('A', 1), epoch: 'restarted', reasoningEffort: undefined, model: undefined, modelId: undefined, provider: undefined, error: 'Model settings could not be read back.' };
    api.overrides.get_chat = async () => restarted; await store.refreshChat();
    expect(store.getModelSelection().reasoningEffort).toBeUndefined();
    expect(store.getModelSelection().model).toBeUndefined();
    expect(store.getModelSelection().label).toBe('Model unavailable');
    expect(store.getChat()?.error).toBe('Model settings could not be read back.');
  });
});
