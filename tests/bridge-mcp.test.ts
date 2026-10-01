import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/bridge/mcp';
import { fakeService } from './helpers/service';

describe('portable embedded MCP app', () => {
  it('advertises entrypoints and app-only writes, serves HTML and keeps transcripts UI-only', async () => {
    const server = createMcpServer(fakeService(), '<html>Hermes app</html>');
    const client = new Client({ name: 'integration-test', version: '1.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const list = await client.listTools();
      const uri = (list.tools.find(tool => tool.name === 'open_hermes')?._meta?.ui as { resourceUri: string }).resourceUri;
      expect(uri).toMatch(/^ui:\/\/hermes\/v0\.2\.1\/app-[a-f0-9]{16}\.html$/);
      expect(list.tools.every(tool => (tool._meta?.ui as { resourceUri?: string })?.resourceUri === uri)).toBe(true);
      expect(list.tools.find(tool => tool.name === 'open_hermes')?._meta?.['openai/ui']).toMatchObject({ entrypoints: [{ type: 'global' }, { type: 'thread' }] });
      expect(list.tools.find(tool => tool.name === 'send_message')?._meta?.ui).toMatchObject({ visibility: ['app'] });
      expect(list.tools.find(tool => tool.name === 'list_models')?._meta?.ui).toMatchObject({ visibility: ['app'] });
      expect(list.tools.find(tool => tool.name === 'configure_chat')).toMatchObject({
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
        _meta: { ui: { visibility: ['app'] } },
      });
      const resource = await client.readResource({ uri });
      expect(resource.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: '<html>Hermes app</html>' });
      const result = await client.callTool({ name: 'get_chat', arguments: { connectionId: 'remote', profile: 'default', sessionId: 'stored-1' } });
      expect(JSON.stringify(result.content)).not.toContain('Private transcript content');
      expect(result._meta).toMatchObject({ data: { messages: [{ content: 'Private transcript content.' }] } });
      const models = await client.callTool({ name: 'list_models', arguments: { connectionId: 'remote', profile: 'default' } });
      expect(JSON.stringify(models.content)).not.toContain('model-default');
      expect(models._meta).toMatchObject({ data: { defaultModelId: '["provider","model-default"]' } });
      const invalid = await client.callTool({ name: 'open_chat', arguments: { connectionId: 'remote', profile: 'all' } });
      expect(invalid.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });

  it('uses a new host cache key for changed UI while retaining one key for identical builds', async () => {
    const inspect = async (html: string) => {
      const server = createMcpServer(fakeService(), html);
      const client = new Client({ name: 'cache-test', version: '1.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const tools = await client.listTools();
        const uri = (tools.tools[0]?._meta?.ui as { resourceUri: string }).resourceUri;
        const resource = await client.readResource({ uri });
        expect(resource.contents[0]).toMatchObject({ uri, text: html });
        return uri;
      } finally { await client.close(); await server.close(); }
    };
    const original = await inspect('<html>Original</html>');
    expect(await inspect('<html>Original</html>')).toBe(original);
    expect(await inspect('<html>Native interface update</html>')).not.toBe(original);
  });
});
