import { vi } from 'vitest';
import type { HermesService, ChatSnapshot } from '../../src/shared/types';

export const chatFixture: ChatSnapshot = {
  connectionId: 'remote', profile: 'default', id: 'stored-1', runtimeId: 'runtime-1',
  status: 'idle', messages: [{ id: 'message-1', role: 'assistant', content: 'Private transcript content.' }],
  tools: [], questions: [], cursor: 1,
};

export function fakeService(): HermesService {
  return {
    listConnections: vi.fn(async () => [{ id: 'remote', label: 'Remote Hermes', kind: 'ssh' as const, status: 'connected' as const }]),
    listProfiles: vi.fn(async () => [{ name: 'default', isDefault: true }, { name: 'research' }]),
    listSessions: vi.fn(async () => [{ id: 'stored-1', title: 'Test conversation', profile: 'default' }]),
    archiveChat: vi.fn(async (ref, archived) => ({ ...ref, archived })),
    listModels: vi.fn(async (connectionId: string, profile: string) => ({ connectionId, profile, defaultModelId: '["provider","model-default"]', defaultReasoningEffort: 'medium',
      reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      models: [{ id: '["provider","model-default"]', model: 'model-default', label: 'Default model', provider: 'provider', reasoningSupported: true }] })),
    openChat: vi.fn(async () => structuredClone(chatFixture)),
    configureChat: vi.fn(async () => ({ chat: structuredClone(chatFixture) })),
    getChat: vi.fn(async () => structuredClone(chatFixture)),
    sendMessage: vi.fn(async () => ({ ...structuredClone(chatFixture), status: 'streaming' as const })),
    interruptChat: vi.fn(async () => ({ ...structuredClone(chatFixture), status: 'interrupted' as const })),
    answerQuestion: vi.fn(async () => structuredClone(chatFixture)),
    listCron: vi.fn(async () => [{ id: 'job-1', profile: 'research', name: 'Research digest', schedule: '0 9 * * *', enabled: true }]),
    getCronRuns: vi.fn(async () => [{ id: 'run-1', jobId: 'job-1', profile: 'research', title: 'Research digest', status: 'completed' }]),
    dispose: vi.fn(async () => {}),
  };
}
