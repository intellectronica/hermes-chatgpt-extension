import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHermesService } from '../hermes/service';
import { loadConfig } from './config';
import { startHttpBridge } from './http';
import { createMcpServer } from './mcp';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function main(): Promise<void> {
  const config = await loadConfig(argument('--config'));
  const service = createHermesService(config);
  const directory = typeof __dirname === 'string' ? __dirname : resolve('dist');
  const html = await readFile(resolve(directory, 'ui.html'), 'utf8');
  let close: () => Promise<void>;
  if (process.argv.includes('--http')) {
    const port = Number(argument('--port') ?? 4318);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be between 0 and 65535.');
    const bridge = await startHttpBridge(service, html, { port });
    close = bridge.close;
    process.stderr.write(`Hermes app: ${bridge.url}\n`);
  } else {
    const server = createMcpServer(service, html);
    await server.connect(new StdioServerTransport());
    close = () => server.close();
    process.stdin.once('end', () => void shutdown());
  }
  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 20_000);
    timeout.unref();
    try { await close(); await service.dispose(); }
    finally { clearTimeout(timeout); process.exit(0); }
  }
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch(() => {
  // Error objects can include upstream secrets. Startup diagnostics stay bounded and generic.
  process.stderr.write('Hermes bridge could not start. Check the build, connection configuration and selected port.\n');
  process.exitCode = 1;
});
