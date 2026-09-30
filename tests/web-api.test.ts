import { describe, expect, it, vi } from 'vitest';
import { ActionError, createHttpApi, resultData } from '../src/web/api';
import { formatInstant, safeMarkdownUrl } from '../src/web/format';

describe('UI transport', () => {
  it('reads full UI data from metadata without using model-visible summaries', () => {
    expect(resultData({ _meta: { data: ['private transcript'] }, content: [{ type: 'text', text: 'Conversation opened' }] })).toEqual(['private transcript']);
    expect(() => resultData({ structuredContent: { messages: ['unsafe fallback'] } })).toThrow(ActionError);
  });

  it('uses only the same-origin bridge with its HttpOnly cookie and explicit ownership', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { status: 'idle' } }), { status: 200 }));
    const api = createHttpApi(fetcher);
    await api.call('get_chat', { connectionId: 'remote', profile: 'A', sessionId: 'stored' });
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe('/api/actions');
    expect(options?.credentials).toBe('same-origin');
    expect(options?.body).toBe(JSON.stringify({ action: 'get_chat', args: { connectionId: 'remote', profile: 'A', sessionId: 'stored' } }));
    expect(options?.headers).not.toHaveProperty('Authorization');
  });

  it('surfaces bounded operational errors from both HTTP and MCP metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Start the configured Hermes backend.' } }), { status: 502 }));
    await expect(createHttpApi(fetcher).call('list_profiles', { connectionId: 'local' })).rejects.toThrow('Start the configured Hermes backend.');
    expect(() => resultData({ isError: true, _meta: { error: { code: 'unknown', message: 'Check the original session.' } }, content: [] })).toThrow('Check the original session.');
  });
});

describe('safe presentation', () => {
  it('blocks local, script and credential-bearing Markdown URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///private', '/api/actions', 'https://user:secret@example.com']) expect(safeMarkdownUrl(url)).toBe('');
    expect(safeMarkdownUrl('https://example.com/page')).toBe('https://example.com/page');
    expect(safeMarkdownUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });

  it('uses Zürich display time and keeps unavailable timestamps unknown', () => {
    expect(formatInstant('2026-09-30T12:00:00Z')).toContain('14:00');
    expect(formatInstant()).toBe('Unknown');
    expect(formatInstant('invalid')).toBe('Unknown');
  });
});
