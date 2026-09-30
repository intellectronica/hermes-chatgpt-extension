import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HermesService } from '../shared/types';
import { actionSchemas, actionSummary, dispatchAction, publicError } from './actions';

export const APP_URI = 'ui://hermes/app.html';

export function createMcpServer(service: HermesService, html: string): McpServer {
  const server = new McpServer({ name: 'hermes', version: '0.1.0' });
  new OpenAIExtensions(server);
  const resourceMeta = {
    ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
    'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] },
    'openai/widgetDescription': 'Hermes conversations, profiles and cron jobs in a familiar chat interface.',
  };
  registerAppResource(server, 'Hermes', APP_URI, {
    description: 'Hermes chat and cron interface',
    _meta: resourceMeta,
  }, async () => ({
    contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: resourceMeta }],
  }));
  registerAppTool(server, 'open_hermes', {
    title: 'Open Hermes',
    description: 'Open the Hermes app to chat with Hermes, switch profiles and view scheduled jobs.',
    inputSchema: z.object({}).shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: APP_URI, visibility: ['model', 'app'] },
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
    },
  }, async () => ({
    content: [{ type: 'text', text: 'Hermes is open. Use its app composer to talk with Hermes.' }],
    _meta: { data: { connections: await service.listConnections() } },
  }));

  const descriptions: Record<keyof typeof actionSchemas, string> = {
    list_connections: 'List configured Hermes connections.',
    list_profiles: 'List the profiles on one Hermes connection.',
    list_sessions: 'List saved Hermes conversations for one connection and profile.',
    open_chat: 'Open a saved Hermes conversation, or create a new one in the selected profile.',
    get_chat: 'Read the current Hermes conversation snapshot, including streamed output and questions.',
    send_message: 'Submit a message to the selected Hermes conversation. Never automatically retry an uncertain result.',
    interrupt_chat: 'Ask Hermes to stop the selected conversation.',
    answer_question: 'Answer a pending Hermes approval or clarification request.',
    list_cron_jobs: 'Inspect scheduled Hermes jobs for a profile or all profiles. This never changes or runs a job.',
    get_cron_runs: 'Inspect recorded runs of a scheduled Hermes job.',
  };
  const appOnly = new Set(['list_sessions', 'open_chat', 'get_chat', 'send_message', 'interrupt_chat', 'answer_question']);
  const mutating = new Set(['open_chat', 'send_message', 'interrupt_chat', 'answer_question']);
  for (const name of Object.keys(actionSchemas) as (keyof typeof actionSchemas)[]) {
    registerAppTool(server, name, {
      description: descriptions[name],
      inputSchema: actionSchemas[name].shape,
      annotations: {
        readOnlyHint: !mutating.has(name),
        destructiveHint: name === 'send_message' || name === 'answer_question',
        openWorldHint: name === 'send_message' || name === 'answer_question',
        idempotentHint: !mutating.has(name),
      },
      _meta: { ui: { resourceUri: APP_URI, visibility: appOnly.has(name) ? ['app'] : ['model', 'app'] } },
    }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const data = await dispatchAction(service, name, args);
        return { content: [{ type: 'text', text: actionSummary(name, data) }], _meta: { data } };
      } catch (error) {
        const { code, message } = publicError(error);
        return { isError: true, content: [{ type: 'text', text: message }], _meta: { error: { code, message } } };
      }
    });
  }
  return server;
}
