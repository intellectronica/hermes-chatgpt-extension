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
  it('bounds errors and removes credentials', () => {
    const result = publicError(new Error('Failed Authorization=abc password=xyz Bearer topsecret at https://alice:secret@example.org/'));
    expect(result.message).not.toMatch(/abc|xyz|topsecret|alice:secret/);
    expect(publicError(new Error('x'.repeat(1000))).message.length).toBe(500);
  });
});

describe('trusted connection configuration', () => {
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
