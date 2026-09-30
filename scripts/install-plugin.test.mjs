import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { applyInstallation, planInstallation } from './install-plugin.mjs';
import { inspectPackage, probeServer, verifyMarketplace } from './verify-plugin.mjs';

const workspace = await mkdtemp(path.join(os.tmpdir(), 'hermes-plugin-tests-'));
let fixtureNumber = 0;
after(() => {
  // The user's deletion policy requires recoverable cleanup. CI temporary files
  // can remain in the runner's temporary directory when trash is unavailable.
  if (process.platform === 'darwin') spawnSync('trash', [workspace], { stdio: 'ignore' });
});

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function fixture() {
  const base = path.join(workspace, String(++fixtureNumber));
  const root = path.join(base, 'package');
  const home = path.join(base, 'home');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'skills', 'hermes'), { recursive: true });
  await mkdir(path.join(root, '.agents', 'plugins'), { recursive: true });
  await mkdir(home, { recursive: true });
  const plugin = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'hermes-chatgpt-extension', version: '0.1.0', description: 'Hermes fixture',
    extensions: { 'com.openai': { interface: { displayName: 'Hermes' } } },
  };
  const mcp = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { hermes: { type: 'stdio', command: 'node',
      args: ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio'], cwd: '${PLUGIN_ROOT}' } },
  };
  const marketplace = {
    name: 'hermes-local', plugins: [{ name: plugin.name,
      source: { source: 'local', path: './' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' }],
  };
  await writeFile(path.join(root, 'plugin.json'), JSON.stringify(plugin));
  await writeFile(path.join(root, 'mcp.json'), JSON.stringify(mcp));
  await writeFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), JSON.stringify(marketplace));
  await writeFile(path.join(root, 'skills', 'hermes', 'SKILL.md'),
    '---\nname: hermes\ndescription: Work with Hermes.\n---\nOpen the UI.\n');
  await writeFile(path.join(root, 'dist', 'server.cjs'), 'process.exit(0);\n');
  await writeFile(path.join(root, 'dist', 'ui.html'), '<!doctype html><html><body>Hermes</body></html>');
  return { root, home, plugin, mcp };
}

async function personalMarketplace(home, data) {
  const file = path.join(home, '.agents', 'plugins', 'marketplace.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return file;
}

async function packageContents(root) {
  const content = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) content.push(...await packageContents(target));
    else content.push(await readFile(target, 'utf8'));
  }
  return content;
}

test('planning is dry and portable manifests validate', async () => {
  const { root, home } = await fixture();
  await inspectPackage(root);
  await verifyMarketplace(root);
  const plan = await planInstallation({ root, home });
  assert.equal(plan.snapshots.length, 5);
  assert.equal(await exists(path.join(home, '.codex')), false);
  assert.equal(await exists(plan.marketplacePath), false);
});

test('install preserves personal marketplace fields and references private config without copying it', async () => {
  const { root, home } = await fixture();
  const previous = { name: 'personal-existing', interface: { displayName: 'My tools' }, custom: { preserve: true },
    plugins: [{ name: 'unrelated', source: { source: 'local', path: './elsewhere' }, custom: 'keep' }] };
  await personalMarketplace(home, previous);
  const config = path.join(root, 'hermes.config.json');
  const secret = 'private-configuration-content-must-stay-put';
  await writeFile(config, JSON.stringify({ token: secret }));
  const originalMcp = await readFile(path.join(root, 'mcp.json'), 'utf8');
  const plan = await planInstallation({ root, home, config });
  const result = await applyInstallation(plan);
  const installedMarketplace = JSON.parse(await readFile(result.marketplacePath, 'utf8'));
  assert.deepEqual(installedMarketplace.plugins[0], previous.plugins[0]);
  assert.deepEqual(installedMarketplace.interface, previous.interface);
  assert.deepEqual(installedMarketplace.custom, previous.custom);
  assert.equal(installedMarketplace.name, previous.name);
  assert.equal(installedMarketplace.plugins.length, 2);
  assert.equal(await readFile(result.marketplaceBackup, 'utf8'), JSON.stringify(previous));
  assert.equal(await readFile(path.join(root, 'mcp.json'), 'utf8'), originalMcp);
  assert.equal(await exists(path.join(result.destination, 'hermes.config.json')), false);
  const { server } = await inspectPackage(result.destination);
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio', '--config', config]);
  for (const text of await packageContents(result.destination)) assert.ok(!text.includes(secret));
});

test('a concurrent marketplace edit is preserved without exposing its content in errors', async () => {
  const { root, home } = await fixture();
  const marketplacePath = await personalMarketplace(home, { name: 'personal', plugins: [] });
  const plan = await planInstallation({ root, home });
  const edited = JSON.stringify({ name: 'personal', private: 'do-not-print-this-content', plugins: [] });
  await writeFile(marketplacePath, edited);
  await assert.rejects(applyInstallation(plan), (error) => {
    assert.match(error.message, /marketplace changed after planning/);
    assert.ok(!error.message.includes('do-not-print-this-content'));
    return true;
  });
  assert.equal(await readFile(marketplacePath, 'utf8'), edited);
  assert.equal(await exists(plan.destination), false);
});

test('a Hermes marketplace entry owned by another source is refused', async () => {
  const { root, home, plugin } = await fixture();
  await personalMarketplace(home, { name: 'personal', plugins: [
    { name: plugin.name, source: { source: 'local', path: './someone-elses-plugin' } },
  ] });
  await assert.rejects(planInstallation({ root, home }), /points elsewhere/);
});

test('replacement never overwrites an unmanaged destination', async () => {
  const { root, home, plugin } = await fixture();
  const destination = path.join(home, '.codex', 'plugins', plugin.name);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'my-file.txt'), 'retain me');
  await assert.rejects(planInstallation({ root, home, replace: true }), /unmanaged/);
  assert.equal(await readFile(path.join(destination, 'my-file.txt'), 'utf8'), 'retain me');
});

test('managed replacement keeps a recoverable backup and the previous config reference', async () => {
  const { root, home, plugin } = await fixture();
  const config = path.join(root, 'hermes.config.json');
  await writeFile(config, '{}');
  const first = await applyInstallation(await planInstallation({ root, home, config }));
  await writeFile(path.join(first.destination, 'personal-note.txt'), 'retain in backup');
  plugin.version = '0.2.0';
  await writeFile(path.join(root, 'plugin.json'), JSON.stringify(plugin));
  const second = await applyInstallation(await planInstallation({ root, home, replace: true }));
  assert.equal(await readFile(path.join(second.backup, 'personal-note.txt'), 'utf8'), 'retain in backup');
  const installed = await inspectPackage(second.destination);
  assert.equal(installed.plugin.version, '0.2.0');
  assert.equal(installed.server.args[3], config);
  const marketplace = JSON.parse(await readFile(second.marketplacePath, 'utf8'));
  assert.equal(marketplace.plugins.filter((entry) => entry.name === plugin.name).length, 1);
});

test('a symlink in the installation path is refused', async () => {
  const { root, home } = await fixture();
  const elsewhere = path.join(workspace, 'symlink-target');
  await mkdir(elsewhere);
  await symlink(elsewhere, path.join(home, '.codex'));
  await assert.rejects(planInstallation({ root, home }), /symlink in the installation path/);
  assert.deepEqual(await readdir(elsewhere), []);
});

test('configuration paths must be absolute existing regular files', async () => {
  const { root, home } = await fixture();
  await assert.rejects(planInstallation({ root, home, config: './hermes.config.json' }), /absolute path/);
  await assert.rejects(planInstallation({ root, home, config: root }), /existing regular file/);
});

test('MCP probing reads only initialization, tools and resource, without executing tools', async () => {
  const { root } = await fixture();
  const mock = `
    const rl = require('node:readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const request = JSON.parse(line);
      if (!request.id) return;
      let result;
      if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'hermes-test', version: '1' } };
      else if (request.method === 'tools/list') result = { tools: [{ name: 'open_hermes', _meta: { ui: { resourceUri: 'ui://hermes/app' }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] } } }] };
      else if (request.method === 'resources/read') result = { contents: [{ uri: request.params.uri, mimeType: 'text/html;profile=mcp-app', text: '<html>Hermes</html>' }] };
      else { process.stderr.write('Unexpected method'); process.exit(1); }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
    });
  `;
  await writeFile(path.join(root, 'dist', 'server.cjs'), mock);
  const result = await probeServer(root, { timeoutMs: 2000 });
  assert.equal(result.toolCount, 1);
  assert.equal(result.resourceUri, 'ui://hermes/app');
  assert.equal(result.stderrSeen, false);
});
