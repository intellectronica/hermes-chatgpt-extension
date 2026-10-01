import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { HermesService } from '../shared/types';
import { hermesBrandDark, hermesBrandLight } from '../shared/hermes-brand';
import { actionSchemas, actionSummary, dispatchAction, publicError } from './actions';
import { VERSION } from '../shared/version';

// Hosts cache templates by URI. The content hash also separates local rebuilds
// within one plugin version, so stale HTML cannot occupy the new build's key.
export function appResourceUri(html: string): string {
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
  return `ui://hermes/v${VERSION}/app-${hash}.html`;
}

export function createMcpServer(service: HermesService, html: string): McpServer {
  const server = new McpServer({ name: 'hermes', title: 'Hermes', version: VERSION, icons: [
    { src: hermesBrandLight, mimeType: 'image/png', sizes: ['256x256'], theme: 'light' },
    { src: hermesBrandDark, mimeType: 'image/png', sizes: ['256x256'], theme: 'dark' },
  ] });
  const appUri = appResourceUri(html);
  new OpenAIExtensions(server);
  const resourceMeta = {
    ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
    'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] },
    'openai/widgetDescription': 'Hermes conversations, profiles and cron jobs in a familiar chat interface.',
  };
  registerAppResource(server, 'Hermes', appUri, {
    description: 'Hermes chat and cron interface',
    _meta: resourceMeta,
  }, async () => ({
    contents: [{ uri: appUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: resourceMeta }],
  }));
  registerAppTool(server, 'open_hermes', {
    title: 'Hermes',
    description: 'Open the Hermes app to chat with Hermes, switch profiles and view scheduled jobs.',
    inputSchema: z.object({}).shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: appUri, visibility: ['model', 'app'] },
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
    archive_chat: 'Archive or restore one Hermes conversation without deleting its stored history.',
    list_models: 'Read the selected Hermes profile’s model catalogue and default model/reasoning settings.',
    open_chat: 'Open a saved Hermes conversation, or create a new one in the selected profile.',
    configure_chat: 'Change only the selected Hermes conversation’s model or reasoning effort. Honour any required Hermes confirmation.',
    get_chat: 'Read the current Hermes conversation snapshot, including streamed output and questions.',
    send_message: 'Submit a message to the selected Hermes conversation. Never automatically retry an uncertain result.',
    interrupt_chat: 'Ask Hermes to stop the selected conversation.',
    answer_question: 'Answer a pending Hermes approval or clarification request.',
    list_cron_jobs: 'Inspect scheduled Hermes jobs for a profile or all profiles. This never changes or runs a job.',
    get_cron_runs: 'Inspect recorded runs of a scheduled Hermes job.',
  };
  const appOnly = new Set(['list_sessions', 'archive_chat', 'list_models', 'configure_chat', 'open_chat', 'get_chat', 'send_message', 'interrupt_chat', 'answer_question']);
  const mutating = new Set(['archive_chat', 'configure_chat', 'open_chat', 'send_message', 'interrupt_chat', 'answer_question']);
  for (const name of Object.keys(actionSchemas) as (keyof typeof actionSchemas)[]) {
    registerAppTool(server, name, {
      description: descriptions[name],
      inputSchema: actionSchemas[name].shape,
      annotations: {
        readOnlyHint: !mutating.has(name),
        destructiveHint: name === 'send_message' || name === 'answer_question',
        openWorldHint: name === 'send_message' || name === 'answer_question',
        idempotentHint: !mutating.has(name) || name === 'configure_chat' || name === 'archive_chat',
      },
      _meta: { ui: { resourceUri: appUri, visibility: appOnly.has(name) ? ['app'] : ['model', 'app'] } },
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
