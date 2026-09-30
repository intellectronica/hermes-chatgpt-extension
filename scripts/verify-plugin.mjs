import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

export async function inspectPackage(root = packageRoot, { requireBuild = true } = {}) {
  const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const mcp = JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8'));
  assert.equal(plugin.$schema, pluginSchema, 'Use the canonical portable plugin schema.');
  assert.match(plugin.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.ok(plugin.name.length <= 64, 'Plugin name exceeds 64 characters.');
  assert.ok(typeof plugin.version === 'string' && plugin.version.length > 0);
  assert.ok(typeof plugin.description === 'string' && plugin.description.length > 0);
  const portableFields = new Set([
    '$schema', 'name', 'version', 'description', 'author', 'homepage',
    'repository', 'license', 'keywords', 'extensions',
  ]);
  for (const field of Object.keys(plugin)) {
    assert.ok(portableFields.has(field), `Unsupported portable manifest field: ${field}`);
  }
  assert.ok(plugin.extensions?.['com.openai']?.interface?.displayName);
  assert.equal(mcp.$schema, mcpSchema, 'Use the canonical portable MCP schema.');
  assert.deepEqual(Object.keys(mcp).sort(), ['$schema', 'mcpServers'].sort());
  assert.deepEqual(Object.keys(mcp.mcpServers), ['hermes']);
  const server = mcp.mcpServers.hermes;
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'node', 'Use the installed Node runtime, without shell interpolation.');
  const baseArgs = ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio'];
  assert.deepEqual(server.args?.slice(0, 2), baseArgs);
  assert.ok(server.args.length === 2 || (server.args.length === 4 &&
    server.args[2] === '--config' && typeof server.args[3] === 'string' && path.isAbsolute(server.args[3])),
  'Use the bundled stdio server and, optionally, an absolute configuration path.');
  assert.equal(server.cwd, '${PLUGIN_ROOT}');
  assert.deepEqual(Object.keys(server).sort(), ['type', 'command', 'args', 'cwd'].sort());

  const skillPath = path.join(root, 'skills', 'hermes', 'SKILL.md');
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /^---\r?\nname: hermes\r?\ndescription: .+\r?\n---/);
  assert.ok(!(await lstat(skillPath)).isSymbolicLink(), 'Package skills must not be symlinks.');
  if (requireBuild) {
    for (const relative of ['dist/server.cjs', 'dist/ui.html']) {
      const file = await lstat(path.join(root, relative));
      assert.ok(file.isFile() && !file.isSymbolicLink(), `${relative} must be a bundled regular file.`);
      assert.ok(file.size > 0, `${relative} is empty.`);
    }
    const ui = await readFile(path.join(root, 'dist/ui.html'), 'utf8');
    assert.match(ui, /<html[\s>]|<!doctype html>/i, 'The UI must be a complete HTML resource.');
    assert.ok(!/<script[^>]+src=["'](?:\.?\/|\/)/i.test(ui), 'The UI must bundle its JavaScript.');
    assert.ok(!/<link[^>]+href=["'](?:\.?\/|\/)/i.test(ui), 'The UI must bundle its CSS.');
  }
  return { root: path.resolve(root), plugin, mcp, server };
}

export async function verifyMarketplace(root = packageRoot) {
  const marketplacePath = path.join(root, '.agents', 'plugins', 'marketplace.json');
  const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
  assert.ok(typeof marketplace.name === 'string' && marketplace.name.length > 0);
  assert.ok(Array.isArray(marketplace.plugins));
  const entries = marketplace.plugins.filter((entry) => entry.name === 'hermes-chatgpt-extension');
  assert.equal(entries.length, 1, 'The marketplace must contain one Hermes entry.');
  const entry = entries[0];
  assert.deepEqual(entry.source, { source: 'local', path: './' });
  assert.equal(entry.policy?.installation, 'AVAILABLE');
  assert.equal(entry.category, 'Productivity');
  return { marketplacePath, marketplace };
}

/** Probe the bundled stdio server; never submit prompts or call Hermes write tools. */
export async function probeServer(root = packageRoot, { timeoutMs = 15_000 } = {}) {
  const { server } = await inspectPackage(root);
  const expand = (value) => value.replaceAll('${PLUGIN_ROOT}', path.resolve(root));
  const child = spawn(process.execPath, server.args.map(expand), {
    cwd: expand(server.cwd),
    env: { ...process.env, PLUGIN_ROOT: path.resolve(root) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let nextId = 0;
  let stderrSeen = false;
  const pending = new Map();
  const rejectAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  child.on('error', rejectAll);
  child.stdin.on('error', rejectAll);
  child.on('exit', (code) => rejectAll(new Error(`MCP server exited before verification finished (${code}).`)));
  child.stderr.on('data', () => { stderrSeen = true; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) {
      rejectAll(new Error('MCP output exceeded the verification limit.'));
      child.kill();
      return;
    }
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { rejectAll(new Error('The stdio server wrote non-JSON output to stdout.')); continue; }
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`MCP ${entry.method} returned protocol error ${message.error.code}.`));
      else entry.resolve(message.result);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP ${method} timed out.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'hermes-plugin-verifier', version: '0.1.0' },
    });
    assert.ok(initialized.serverInfo?.name, 'Server initialization must identify the MCP server.');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const { tools } = await request('tools/list');
    assert.ok(Array.isArray(tools), 'tools/list must return tools.');
    const opener = tools.find((tool) => tool.name === 'open_hermes');
    assert.ok(opener, 'The opening tool must be named open_hermes.');
    const resourceUri = opener._meta?.ui?.resourceUri;
    assert.match(resourceUri ?? '', /^ui:\/\//, 'The opening tool must link to a UI resource.');
    const entrypoints = opener._meta?.['openai/ui']?.entrypoints ?? [];
    assert.ok(entrypoints.some((entry) => entry.type === 'global'), 'Advertise a global entrypoint.');
    assert.ok(entrypoints.some((entry) => entry.type === 'thread'), 'Advertise a thread entrypoint.');
    const { contents } = await request('resources/read', { uri: resourceUri });
    const resource = contents?.find((entry) => entry.uri === resourceUri);
    assert.equal(resource?.mimeType, 'text/html;profile=mcp-app');
    assert.ok(typeof resource.text === 'string' && resource.text.length > 0);
    return { serverName: initialized.serverInfo.name, toolCount: tools.length, resourceUri, stderrSeen };
  } finally {
    rejectAll(new Error('Verification closed.'));
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(['--metadata-only', '--probe', '--help']);
  for (const arg of args) assert.ok(allowed.has(arg), `Unknown option: ${arg}`);
  if (args.has('--help')) {
    console.log('Usage: node scripts/verify-plugin.mjs [--metadata-only | --probe]');
    console.log('Checks portable packaging and compiled assets. --probe also reads MCP tools and UI without sending Hermes prompts.');
    return;
  }
  assert.ok(!(args.has('--metadata-only') && args.has('--probe')), '--probe requires built assets.');
  await inspectPackage(packageRoot, { requireBuild: !args.has('--metadata-only') });
  await verifyMarketplace(packageRoot);
  console.log('Portable plugin, stdio configuration, skill and local marketplace: verified.');
  if (!args.has('--metadata-only')) console.log('Bundled server and self-contained UI assets: verified.');
  if (args.has('--probe')) {
    const result = await probeServer(packageRoot);
    console.log(`MCP initialization, ${result.toolCount} tools, global/thread entrypoints and UI resource: verified.`);
    if (result.stderrSeen) console.log('The server also wrote diagnostics to stderr; their contents were not displayed.');
  }
  console.log('Codex embedding is a separate acceptance check; this script does not install or render the plugin.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Plugin verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
