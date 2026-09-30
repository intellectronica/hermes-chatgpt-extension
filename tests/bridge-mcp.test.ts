import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, APP_URI } from '../src/bridge/mcp';
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
      expect(list.tools.find(tool => tool.name === 'open_hermes')?._meta?.['openai/ui']).toMatchObject({ entrypoints: [{ type: 'global' }, { type: 'thread' }] });
      expect(list.tools.find(tool => tool.name === 'send_message')?._meta?.ui).toMatchObject({ visibility: ['app'] });
      const resource = await client.readResource({ uri: APP_URI });
      expect(resource.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: '<html>Hermes app</html>' });
      const result = await client.callTool({ name: 'get_chat', arguments: { connectionId: 'remote', profile: 'default', sessionId: 'stored-1' } });
      expect(JSON.stringify(result.content)).not.toContain('Private transcript content');
      expect(result._meta).toMatchObject({ data: { messages: [{ content: 'Private transcript content.' }] } });
      const invalid = await client.callTool({ name: 'open_chat', arguments: { connectionId: 'remote', profile: 'all' } });
      expect(invalid.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
