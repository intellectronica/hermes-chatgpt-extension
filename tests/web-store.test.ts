import { describe, expect, it } from 'vitest';
import type { ActionArgs, ActionName, ChatSnapshot, CronJob, CronRun, SessionSummary } from '../src/shared/types';
import type { HermesApi } from '../src/web/api';
import { chatKey, WorkspaceStore } from '../src/web/store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(profile = 'A', cursor = 1, text = profile): ChatSnapshot {
  return { connectionId: 'local', profile, id: 'same-id', status: 'idle', cursor, epoch: 'one',
    messages: [{ id: 'm1', role: 'assistant', content: text }], tools: [], questions: [] };
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
      open_chat: snapshot(args.profile), get_chat: snapshot(args.profile), send_message: snapshot(args.profile),
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
