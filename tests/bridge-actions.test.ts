import { describe, expect, it } from 'vitest';
import { dispatchAction, publicError } from '../src/bridge/actions';
import { fakeService } from './helpers/service';
import { parseConfig } from '../src/bridge/config';

describe('explicit action ownership', () => {
  it('passes the complete stored-session owner without changing profile', async () => {
    const service = fakeService();
    await dispatchAction(service, 'send_message', { connectionId: 'remote', profile: 'research', sessionId: 'stored-1', text: ' Hello ' });
    expect(service.sendMessage).toHaveBeenCalledWith({ connectionId: 'remote', profile: 'research', sessionId: 'stored-1' }, 'Hello');
  });
  it('rejects mutations on all profiles, absent ownership and unknown operations', async () => {
    const service = fakeService();
    await expect(dispatchAction(service, 'open_chat', { connectionId: 'remote', profile: 'all' })).rejects.toMatchObject({ code: 'invalid_profile' });
    await expect(dispatchAction(service, 'send_message', { text: 'Hello' })).rejects.toMatchObject({ code: 'invalid_arguments' });
    await expect(dispatchAction(service, 'run_cron_job', {})).rejects.toMatchObject({ code: 'unsupported_action' });
    expect(service.sendMessage).not.toHaveBeenCalled();
  });
  it('allows all-profile read-only cron filtering', async () => {
    const service = fakeService();
    await dispatchAction(service, 'list_cron_jobs', { connectionId: 'remote', profile: 'all' });
    expect(service.listCron).toHaveBeenCalledWith('remote', 'all');
  });
  it('archives and restores only an explicitly owned stored conversation', async () => {
    const service = fakeService();
    const ref = { connectionId: 'remote', profile: 'research', sessionId: 'stored-1' };
    for (const archived of [true, false]) {
      await expect(dispatchAction(service, 'archive_chat', { ...ref, archived })).resolves.toEqual({ ...ref, archived });
      expect(service.archiveChat).toHaveBeenLastCalledWith(ref, archived);
    }
    for (const args of [{ ...ref, profile: 'all', archived: true }, { ...ref }, { connectionId: 'remote', archived: true }]) {
      await expect(dispatchAction(service, 'archive_chat', args)).rejects.toMatchObject({ code: expect.stringMatching(/invalid_(arguments|profile)/) });
    }
    expect(service.archiveChat).toHaveBeenCalledTimes(2);
  });
  it('scopes model reads and configuration to the explicit profile and stored conversation', async () => {
    const service = fakeService();
    await dispatchAction(service, 'list_models', { connectionId: 'remote', profile: 'research' });
    expect(service.listModels).toHaveBeenCalledWith('remote', 'research');
    const modelId = JSON.stringify(['provider', 'model-default']);
    await dispatchAction(service, 'configure_chat', { connectionId: 'remote', profile: 'research', sessionId: 'stored-1', modelId, reasoningEffort: 'high', confirm: true });
    expect(service.configureChat).toHaveBeenCalledWith({ connectionId: 'remote', profile: 'research', sessionId: 'stored-1' }, { modelId, reasoningEffort: 'high', confirm: true });
  });
  it('rejects model changes without a complete owner or selection, unsupported levels and provider secrets', async () => {
    const service = fakeService();
    const owner = { connectionId: 'remote', profile: 'research', sessionId: 'stored-1' };
    for (const args of [
      { ...owner, profile: 'all', modelId: 'model' },
      { connectionId: 'remote', profile: 'research', modelId: 'model' },
      { ...owner, confirm: true },
      { ...owner, reasoningEffort: 'unbounded' },
      { ...owner, modelId: 'model', apiKey: 'secret' },
      { ...owner, modelId: 'model', scope: 'profile' },
    ]) await expect(dispatchAction(service, 'configure_chat', args)).rejects.toMatchObject({ code: expect.stringMatching(/invalid_(arguments|profile)/) });
    expect(service.configureChat).not.toHaveBeenCalled();
  });
  it('inherits new-chat defaults and requires an explicit action to change saved-chat settings', async () => {
    const service = fakeService();
    await dispatchAction(service, 'open_chat', { connectionId: 'remote', profile: 'research' });
    expect(service.openChat).toHaveBeenCalledWith({ connectionId: 'remote', profile: 'research' });
    await expect(dispatchAction(service, 'open_chat', { connectionId: 'remote', profile: 'research', sessionId: 'stored-1', modelId: 'model' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  });
  it('bounds errors and removes credentials', () => {
    const result = publicError(new Error('Failed Authorization=abc password=xyz Bearer topsecret at https://alice:secret@example.org/'));
    expect(result.message).not.toMatch(/abc|xyz|topsecret|alice:secret/);
    expect(publicError(new Error('x'.repeat(1000))).message.length).toBe(500);
  });
});

describe('trusted connection configuration', () => {
  it('accepts the optional automated-chat visibility setting without changing its default', () => {
    expect(parseConfig({ connections: [] }).sidebar).toBeUndefined();
    expect(parseConfig({ connections: [], sidebar: { showAutomatedChats: true } }).sidebar).toEqual({ showAutomatedChats: true });
    expect(() => parseConfig({ connections: [], sidebar: { showAutomatedChats: 'true' } })).toThrow();
  });
  it('accepts private managed SSH and HTTPS backends', () => {
    expect(parseConfig({ connections: [{ id: 'remote', label: 'Remote', kind: 'ssh', ssh: { host: 'example-host', mode: 'managed' } }] }).connections).toHaveLength(1);
    expect(parseConfig({ connections: [{ id: 'remote', label: 'Remote', kind: 'http', baseUrl: 'https://hermes.example.org', tokenEnv: 'HERMES_TOKEN' }] }).connections).toHaveLength(1);
  });
  it('rejects insecure remote HTTP and embedded URL credentials', () => {
    for (const baseUrl of ['http://remote.example.org:9119', 'https://alice:password@example.org', 'https://example.org/?token=x']) {
      expect(() => parseConfig({ connections: [{ id: 'remote', label: 'Remote', kind: 'http', baseUrl }] })).toThrow();
    }
  });
  it('rejects duplicate IDs and SSH injection', () => {
    const connection = { id: 'remote', label: 'Remote', kind: 'ssh', ssh: { host: 'example-host' } };
    expect(() => parseConfig({ connections: [connection, connection] })).toThrow();
    expect(() => parseConfig({ connections: [{ ...connection, ssh: { host: 'host; printenv' } }] })).toThrow();
  });
});
