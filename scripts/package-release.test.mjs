import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectReleaseFiles, packageRelease, sha256 } from './package-release.mjs';
import { crc32, readZip, zipEntries } from './release-zip.mjs';
import { inspectRelease, validateReleaseZip, verifyRelease } from './verify-release.mjs';

const workspace = await mkdtemp(path.join(os.tmpdir(), 'hermes release tests '));
let fixtureNumber = 0;
after(() => {
  // Recoverable cleanup locally; disposable CI files can remain in the runner temp directory.
  if (process.platform === 'darwin') spawnSync('trash', [workspace], { stdio: 'ignore' });
});
const mockServer = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const allowed = ['HOME', 'PATH', 'PLUGIN_ROOT', 'XDG_CONFIG_HOME'];
// CoreFoundation injects this non-secret encoding key when Node starts on macOS.
if (process.platform === 'darwin') allowed.push('__CF_USER_TEXT_ENCODING');
if (Object.keys(process.env).some(key => !allowed.includes(key))) throw Error('Unexpected inherited environment');
if (process.env.XDG_CONFIG_HOME !== path.join(process.env.HOME, '.config')) throw Error('Wrong isolated config directory');
const configIndex = process.argv.indexOf('--config');
if (configIndex < 0) throw Error('Missing explicit config reference');
const config = JSON.parse(fs.readFileSync(process.argv[configIndex + 1], 'utf8'));
if (JSON.stringify(config) !== '{"connections":[]}') throw Error('Unexpected Hermes target');
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(path.join(process.env.HOME, 'probe-methods.jsonl'), JSON.stringify(request.method) + '\n');
  if (!request.id) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: {
    name: 'hermes-release-fixture', title: 'Hermes', version: '0.3.0',
    icons: ['light','dark'].map(theme => ({ src: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', sizes: ['256x256'], theme }))
  } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'open_hermes', title: 'Hermes', _meta: {
    ui: { resourceUri: 'ui://hermes/release-fixture' }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] }
  } }] };
  else if (request.method === 'resources/read') result = { contents: [{ uri: request.params.uri,
    mimeType: 'text/html;profile=mcp-app', text: fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8') }] };
  else { process.stderr.write('Unexpected action'); process.exit(1); }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
`;

async function put(root, relative, data) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

async function fixture() {
  const base = path.join(workspace, `fixture ${++fixtureNumber}`), root = path.join(base, 'source package');
  const output = path.join(base, 'release output');
  const plugin = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'hermes-chatgpt-extension',
    version: '0.3.0', license: 'MIT', description: 'Hermes release fixture',
    extensions: { 'com.openai': { interface: { displayName: 'Hermes', logo: './assets/nous-girl.png', logoDark: './assets/nous-girl-dark.png' } } } };
  const mcp = { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { hermes: {
    type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio'], cwd: '${PLUGIN_ROOT}',
  } } };
  await put(root, 'plugin.json', plugin); await put(root, 'mcp.json', mcp);
  await put(root, 'package.json', { name: plugin.name, version: plugin.version, license: 'MIT', type: 'module' });
  await put(root, 'LICENSE', 'MIT License\nFixture permission notice.\n');
  await put(root, 'README.md', '# Release fixture\n');
  await put(root, 'THIRD_PARTY_NOTICES.md', 'Fixture asset notices.\n');
  await put(root, 'dist/THIRD_PARTY_LICENSES.txt', 'Fixture dependency notices.\n');
  await put(root, 'dist/server.cjs', mockServer);
  await put(root, 'dist/ui.html', '<!doctype html><html><body>Release fixture</body></html>');
  await put(root, '.agents/plugins/marketplace.json', { name: 'hermes-local', plugins: [{ name: plugin.name,
    source: { source: 'local', path: './' }, policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' }] });
  for (const asset of ['nous-girl.png', 'nous-girl-dark.png']) await put(root, `assets/${asset}`, Buffer.from([137, 80, 78, 71]));
  await put(root, 'skills/hermes/SKILL.md', '---\nname: hermes\ndescription: Work with Hermes.\n---\nOpen the UI.\n');
  for (const name of ['local', 'ssh', 'ssh-attach', 'http', 'multiple']) await put(root, `examples/config.${name}.json`, { connections: [] });
  for (const name of ['install-plugin.mjs', 'verify-plugin.mjs']) {
    await put(root, `scripts/${name}`, await readFile(fileURLToPath(new URL(name, import.meta.url))));
  }
  for (const name of ['.gitignore', '.env.example', 'AGENTS.md', 'TODO.md', 'package-lock.json', 'tsconfig.json',
    'vitest.config.ts', '.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/build.mjs', 'scripts/bundle-licenses.mjs',
    'scripts/github-release.mjs', 'scripts/github-release.test.mjs',
    'scripts/package-release.mjs', 'scripts/release-zip.mjs', 'scripts/verify-release.mjs',
    'scripts/install-plugin.test.mjs', 'scripts/package-release.test.mjs', 'scripts/bundle-licenses.test.mjs',
    'src/index.ts', 'tests/smoke.test.ts', 'docs/setup.md']) {
    await put(root, name, `Fixture source: ${name}\n`);
  }
  const sentinel = 'DO-NOT-DISTRIBUTE-PRIVATE-FIXTURE';
  for (const name of ['.env', '.env.local', 'hermes.config.json', '.git/config', '.git/logs/HEAD',
    'work/experiment.md', 'outputs/private.txt', 'node_modules/package/index.js', 'private-token.txt', 'dist/debug.log']) await put(root, name, sentinel);
  return { root, output, plugin, mcp, sentinel };
}

function archiveByKind(archives, kind) {
  return archives.find(archive => kind === 'source' ? archive.name.endsWith('-source.zip') : !archive.name.endsWith('-source.zip'));
}

async function editArchive(archive, edit) {
  const entries = readZip(await readFile(archive.path));
  const next = zipEntries(edit(entries));
  await writeFile(archive.path, next);
  return next;
}

function alterManifest(entries, modify) {
  return entries.map(entry => entry.name.endsWith('/RELEASE_MANIFEST.json') ? {
    ...entry, bytes: Buffer.from(JSON.stringify(modify(JSON.parse(entry.bytes.toString('utf8'))))),
  } : entry);
}

test('CRC-32 uses the independent standard known vector; hashes are standard SHA-256', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('release allowlist excludes private files, history, dependencies and work from both deterministic ZIPs', async () => {
  const { root, output, sentinel } = await fixture();
  const first = await packageRelease({ root, output });
  const saved = await Promise.all(first.map(archive => readFile(archive.path)));
  const second = await packageRelease({ root, output });
  assert.deepEqual(first.map(archive => archive.sha256), second.map(archive => archive.sha256));
  for (const [index, archive] of first.entries()) {
    assert.deepEqual(await readFile(archive.path), saved[index]);
    const entries = readZip(saved[index]);
    const kind = archive.name.endsWith('-source.zip') ? 'source' : 'plugin';
    const parsed = validateReleaseZip(saved[index], { fileName: archive.name });
    assert.equal(parsed.manifest.kind, kind);
    assert.ok(entries.every(entry => !entry.bytes.includes(Buffer.from(sentinel))));
    assert.ok(entries.every(entry => !/(?:\/\.git\/|\/\.env(?:$|\.(?!example$))|\/work\/|\/outputs\/|\/node_modules\/|\/hermes\.config\.json$)/.test(entry.name)));
    assert.equal(parsed.manifest.files['src/index.ts'] !== undefined, kind === 'source');
    assert.equal(parsed.manifest.files['.env.example'] !== undefined, kind === 'source');
    assert.equal(createHash('sha256').update(saved[index]).digest('hex'), archive.sha256);
  }
  assert.equal((await inspectRelease(output)).length, 2);
});

test('allowlisted source or asset symlinks are refused', async () => {
  const { root } = await fixture();
  await rename(path.join(root, 'assets/nous-girl.png'), path.join(root, 'assets/elsewhere.png'));
  await symlink('elsewhere.png', path.join(root, 'assets/nous-girl.png'));
  await assert.rejects(collectReleaseFiles(root), /regular|symlink/);
  const other = await fixture();
  await symlink('../README.md', path.join(other.root, 'src/linked.ts'));
  await assert.rejects(collectReleaseFiles(other.root, 'source'), /source symlink/);
});

test('release packaging refuses an MCP manifest with a private configuration reference', async () => {
  const { root, output, mcp } = await fixture();
  mcp.mcpServers.hermes.args.push('--config', path.join(root, 'hermes.config.json'));
  await put(root, 'mcp.json', mcp);
  await assert.rejects(packageRelease({ root, output }), /must not reference private configuration/);
});

test('ZIP writer and reader reject traversal, duplicates, damaged data and non-regular entries', () => {
  const entry = { name: 'root/a.txt', bytes: Buffer.from('hello world') };
  for (const name of ['../a.txt', '/a.txt', 'C:/a.txt', 'root/../a.txt', 'root\\a.txt', 'root/./a.txt']) {
    assert.throws(() => zipEntries([{ ...entry, name }]), /Unsafe ZIP entry path/);
  }
  assert.throws(() => zipEntries([entry, entry]), /Duplicate ZIP/);
  const valid = zipEntries([entry]);
  assert.deepEqual(readZip(valid), [entry]);
  const traversal = Buffer.from(valid);
  let offset = -1;
  while ((offset = traversal.indexOf('root/a.txt', offset + 1)) !== -1) traversal.write('../x/a.txt', offset);
  assert.throws(() => readZip(traversal), /Unsafe ZIP entry path/);
  const directory = valid.readUInt32LE(valid.length - 6);
  const crc = Buffer.from(valid); crc.writeUInt32LE((crc.readUInt32LE(directory + 16) ^ 1) >>> 0, directory + 16);
  assert.throws(() => readZip(crc));
  const symlink = Buffer.from(valid); symlink.writeUInt32LE((0o120777 << 16) >>> 0, directory + 38);
  assert.throws(() => readZip(symlink), /regular files/);
  assert.throws(() => readZip(valid.subarray(0, valid.length - 1)), /Missing ZIP directory/);
});

test('internal manifest detects changed bytes and both missing and unlisted entries', async () => {
  const { root, output } = await fixture();
  const archive = archiveByKind(await packageRelease({ root, output }), 'plugin');
  const entries = readZip(await readFile(archive.path));
  const changed = entries.map(entry => entry.name.endsWith('/README.md') ? { ...entry, bytes: Buffer.from('Changed content') } : entry);
  assert.throws(() => validateReleaseZip(zipEntries(changed)), /file hash mismatch/);
  assert.throws(() => validateReleaseZip(zipEntries(entries.filter(entry => !entry.name.endsWith('/README.md')))), /exactly match/);
  assert.throws(() => validateReleaseZip(zipEntries([...entries, { name: entries[0].name.split('/')[0] + '/extra.txt', bytes: Buffer.from('extra') }])), /exactly match/);
  const removed = alterManifest(entries.filter(entry => !entry.name.endsWith('/README.md')), manifest => {
    delete manifest.files['README.md']; return manifest;
  });
  assert.throws(() => validateReleaseZip(zipEntries(removed)), /Required release file is missing/);
});

test('manifest membership cannot legitimise private files or extra runtime source', async () => {
  const { root, output } = await fixture();
  const archives = await packageRelease({ root, output });
  for (const [kind, relative] of [['plugin', '.env'], ['plugin', 'src/index.ts'], ['source', 'docs/private.md'], ['source', '.git/config']]) {
    const archive = archiveByKind(archives, kind), entries = readZip(await readFile(archive.path));
    const bytes = Buffer.from('Never distribute'), prefix = entries[0].name.split('/')[0];
    const edited = alterManifest([...entries, { name: `${prefix}/${relative}`, bytes }], manifest => {
      manifest.files[relative] = sha256(bytes); return manifest;
    });
    assert.throws(() => validateReleaseZip(zipEntries(edited)), /private or excluded/);
  }
});

test('external checksums detect altered ZIPs and reject missing, duplicate or unchecked archives', async () => {
  const { root, output } = await fixture();
  const archives = await packageRelease({ root, output }), archive = archiveByKind(archives, 'plugin');
  await editArchive(archive, entries => entries.map(entry => entry.name.endsWith('/README.md') ? { ...entry, bytes: Buffer.from('Changed') } : entry));
  await assert.rejects(inspectRelease(output), /External release SHA-256 mismatch/);
  await packageRelease({ root, output });
  const original = await readFile(path.join(output, 'SHA256SUMS'), 'utf8');
  await writeFile(path.join(output, 'SHA256SUMS'), original + original.split('\n')[0] + '\n');
  await assert.rejects(inspectRelease(output), /Duplicate SHA256SUMS/);
  await writeFile(path.join(output, 'SHA256SUMS'), original.split('\n')[0] + '\n');
  await assert.rejects(inspectRelease(output), /plugin and source ZIP together/);
  await writeFile(path.join(output, 'SHA256SUMS'), original);
  await writeFile(path.join(output, 'unchecked.zip'), 'Unchecked archive');
  await assert.rejects(inspectRelease(output), /exactly match SHA256SUMS/);
});

test('isolated install and MCP probes work without dependencies and never call Hermes actions', async () => {
  const { root, output } = await fixture();
  await packageRelease({ root, output });
  const originalMcp = await readFile(path.join(root, 'mcp.json'));
  const result = await verifyRelease({ output, scratchRoot: workspace, timeoutMs: 3000 });
  assert.ok(result.workspace.includes(' '));
  assert.equal(result.checks.length, 2);
  for (const check of result.checks) {
    assert.equal(check.probe.toolCount, 1);
    assert.equal(check.probe.stderrSeen, false);
    const methods = (await readFile(path.join(check.home, 'probe-methods.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'resources/read']);
    assert.deepEqual(JSON.parse(await readFile(check.config, 'utf8')), { connections: [] });
    assert.deepEqual((await readdir(check.home)).sort(), ['.agents', '.codex', 'probe-methods.jsonl']);
    const installed = JSON.parse(await readFile(path.join(check.installed, 'mcp.json'), 'utf8'));
    assert.equal(installed.mcpServers.hermes.args[3], check.config);
  }
  assert.deepEqual(await readFile(path.join(root, 'mcp.json')), originalMcp);
});

test('bundled installer executes through an aliased directory and really installs', async () => {
  const { root } = await fixture();
  const base = path.dirname(root), alias = path.join(base, 'aliased package'), home = path.join(base, 'fresh alias home');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(home);
  const config = path.join(base, 'private-config.json');
  await writeFile(config, '{"connections":[]}');
  const result = spawnSync(process.execPath, [path.join(alias, 'scripts', 'install-plugin.mjs'), '--home', home, '--config', config, '--apply'], {
    env: { PATH: path.dirname(process.execPath), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, 'Alias-path installer did not complete.');
  assert.match(result.stdout, /Plugin files and marketplace entry installed/);
  const plugin = JSON.parse(await readFile(path.join(home, '.codex', 'plugins', 'hermes-chatgpt-extension', 'plugin.json'), 'utf8'));
  assert.equal(plugin.version, '0.3.0');
});
