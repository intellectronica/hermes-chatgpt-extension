import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { sha256 } from './package-release.mjs';
import { readZip } from './release-zip.mjs';
import { inspectPackage, probeServer, verifyMarketplace } from './verify-plugin.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const pluginName = 'hermes-chatgpt-extension';
const runtimeFiles = new Set([
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'plugin.json', 'mcp.json',
  '.agents/plugins/marketplace.json', 'dist/server.cjs', 'dist/ui.html', 'dist/THIRD_PARTY_LICENSES.txt',
  'assets/nous-girl.png', 'assets/nous-girl-dark.png', 'skills/hermes/SKILL.md',
  'examples/config.local.json', 'examples/config.ssh.json', 'examples/config.ssh-attach.json',
  'examples/config.http.json', 'examples/config.multiple.json',
  'scripts/install-plugin.mjs', 'scripts/verify-plugin.mjs',
]);
const sourceFiles = new Set([
  '.gitignore', '.env.example', 'AGENTS.md', 'TODO.md', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts',
  '.github/workflows/ci.yml', 'scripts/build.mjs', 'scripts/bundle-licenses.mjs',
  'scripts/package-release.mjs', 'scripts/release-zip.mjs', 'scripts/verify-release.mjs',
  'scripts/install-plugin.test.mjs', 'scripts/package-release.test.mjs', 'scripts/bundle-licenses.test.mjs',
]);

function allowedFile(relative, kind) {
  if (runtimeFiles.has(relative) || kind === 'source' && sourceFiles.has(relative)) return true;
  const parts = relative.split('/');
  if (!/^[A-Za-z0-9_.\/-]+$/.test(relative) || parts.some(part => !part || part === '.' || part === '..' ||
      part.startsWith('.') || /^(?:node_modules|work|outputs|release|private|secrets?|credentials?|hermes\.config)(?:[.-]|$)/i.test(part))) return false;
  return kind === 'source' && /^(?:src|tests|docs)\/.+\.(?:ts|tsx|css|html|md)$/.test(relative);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Inspect all content before extracting or executing the project's release scripts. */
export function validateReleaseZip(bytes, { fileName } = {}) {
  const entries = readZip(bytes);
  assert.ok(entries.length > 0, 'The release ZIP is empty.');
  const roots = new Set(entries.map(entry => entry.name.split('/')[0]));
  assert.equal(roots.size, 1, 'Release entries must have one common root.');
  const prefix = [...roots][0];
  const manifestEntry = entries.find(entry => entry.name === `${prefix}/RELEASE_MANIFEST.json`);
  assert.ok(manifestEntry, 'The release manifest is missing.');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.bytes.toString('utf8')); }
  catch { throw new Error('The release manifest is invalid JSON.'); }
  assert.ok(object(manifest), 'The release manifest must be an object.');
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'kind', 'name', 'version']);
  assert.equal(manifest.name, pluginName, 'Unexpected release plugin name.');
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  assert.ok(manifest.kind === 'plugin' || manifest.kind === 'source', 'Unexpected release kind.');
  assert.equal(prefix, `${manifest.name}-${manifest.version}`, 'Release root does not match the manifest.');
  const expectedName = `${prefix}${manifest.kind === 'source' ? '-source' : ''}.zip`;
  if (fileName !== undefined) assert.equal(fileName, expectedName, 'ZIP filename does not match the manifest.');
  assert.ok(object(manifest.files), 'The manifest files must be an object.');
  const files = entries.filter(entry => entry !== manifestEntry).map(entry => ({
    relative: entry.name.slice(prefix.length + 1), bytes: entry.bytes,
  }));
  const listed = Object.keys(manifest.files).sort();
  assert.deepEqual(files.map(file => file.relative).sort(), listed, 'ZIP entries do not exactly match the manifest.');
  for (const file of files) {
    assert.ok(allowedFile(file.relative, manifest.kind), 'Release contains a private or excluded entry.');
    assert.match(manifest.files[file.relative] ?? '', /^[a-f0-9]{64}$/, 'Invalid manifest file hash.');
    assert.equal(sha256(file.bytes), manifest.files[file.relative], 'Release file hash mismatch.');
  }
  for (const required of [...runtimeFiles, ...(manifest.kind === 'source' ? sourceFiles : [])]) {
    assert.ok(Object.hasOwn(manifest.files, required), `Required release file is missing: ${required}`);
  }
  if (manifest.kind === 'source') for (const directory of ['src', 'tests', 'docs']) {
    assert.ok(files.some(file => file.relative.startsWith(`${directory}/`)), `Source archive is missing ${directory}/.`);
  }
  const jsonFile = relative => {
    try { return JSON.parse(files.find(file => file.relative === relative).bytes.toString('utf8')); }
    catch { throw new Error('Release package metadata is invalid JSON.'); }
  };
  const plugin = jsonFile('plugin.json'), pkg = jsonFile('package.json'), mcp = jsonFile('mcp.json');
  assert.equal(plugin.name, manifest.name); assert.equal(plugin.version, manifest.version);
  assert.equal(pkg.name, manifest.name); assert.equal(pkg.version, manifest.version);
  assert.equal(plugin.license, 'MIT'); assert.equal(pkg.license, 'MIT');
  assert.deepEqual(mcp.mcpServers?.hermes?.args, ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio'],
    'Release MCP configuration must not reference private configuration.');
  return { prefix, expectedName, manifest, files, entries };
}

async function regularFile(file, limit) {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'Release input must be a bounded regular file.');
  return readFile(file);
}

/** Check external checksums independently of the internal manifest. */
export async function inspectRelease(output) {
  const checksumText = (await regularFile(path.join(output, 'SHA256SUMS'), 16_384)).toString('utf8');
  const sums = new Map();
  for (const line of checksumText.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+\.zip)$/.exec(line);
    assert.ok(match, 'Invalid SHA256SUMS entry.');
    assert.ok(!sums.has(match[2]), 'Duplicate SHA256SUMS entry.');
    sums.set(match[2], match[1]);
  }
  assert.equal(sums.size, 2, 'Verify the plugin and source ZIP together.');
  assert.deepEqual((await readdir(output)).filter(name => name.endsWith('.zip')).sort(), [...sums.keys()].sort(),
    'Release ZIPs do not exactly match SHA256SUMS.');
  const archives = [];
  for (const [fileName, hash] of sums) {
    const bytes = await regularFile(path.join(output, fileName), 64 * 1024 * 1024);
    assert.equal(sha256(bytes), hash, 'External release SHA-256 mismatch.');
    archives.push({ ...validateReleaseZip(bytes, { fileName }), sha256: hash });
  }
  assert.deepEqual(archives.map(archive => archive.manifest.kind).sort(), ['plugin', 'source']);
  assert.equal(archives[0].prefix, archives[1].prefix, 'Plugin and source releases must have the same version.');
  const plugin = archives.find(archive => archive.manifest.kind === 'plugin');
  const source = archives.find(archive => archive.manifest.kind === 'source');
  for (const file of plugin.files) assert.equal(source.manifest.files[file.relative], plugin.manifest.files[file.relative],
    'Plugin and source runtime files differ.');
  return archives;
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function treeFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Installed package must not contain symlinks.');
    if (entry.isDirectory()) result.push(...await treeFiles(target));
    else { assert.ok(entry.isFile(), 'Installed package contains a non-file.'); result.push(target); }
  }
  return result;
}

async function installAndProbe(archive, workspace, timeoutMs) {
  const base = path.join(workspace, `${archive.manifest.kind} package`);
  await mkdir(base);
  for (const entry of archive.entries) {
    const target = path.join(base, ...entry.name.split('/'));
    assert.ok(target.startsWith(`${base}${path.sep}`), 'Archive extraction escaped its directory.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { flag: 'wx', mode: 0o600 });
  }
  const root = path.join(base, archive.prefix), home = path.join(workspace, `${archive.manifest.kind} fresh home`);
  await mkdir(home);
  assert.deepEqual(await readdir(home), []);
  await inspectPackage(root); await verifyMarketplace(root);
  assert.equal(await exists(path.join(root, 'node_modules')), false, 'Release must not require node_modules.');
  const privateDirectory = path.join(workspace, `${archive.manifest.kind} private configuration`);
  await mkdir(privateDirectory);
  const config = path.join(privateDirectory, 'hermes.config.json'), token = path.join(privateDirectory, 'private-session.token');
  const configBytes = Buffer.from('{\n\t"connections": []\n}\n');
  const sentinel = `release-verifier-private-token-${randomUUID()}`;
  await writeFile(config, configBytes, { mode: 0o600 });
  await writeFile(token, sentinel, { mode: 0o600 });
  const originalMcp = await readFile(path.join(root, 'mcp.json'));
  const environment = { PATH: path.dirname(process.execPath), HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const installer = path.join(root, 'scripts', 'install-plugin.mjs');
  for (const mode of ['--dry-run', '--apply']) {
    try {
      const result = await execute(process.execPath, [installer, '--home', home, '--config', config, mode], {
        cwd: root, env: environment, timeout: timeoutMs, maxBuffer: 512 * 1024,
      });
      assert.ok(result.stdout.includes(mode === '--dry-run' ? 'Dry-run complete' : 'Plugin files and marketplace entry installed'),
        'The bundled installer did not run its CLI.');
    } catch { throw new Error(`Bundled installer ${mode} failed in the isolated home.`); }
    if (mode === '--dry-run') {
      assert.equal(await exists(path.join(home, '.codex')), false, 'Dry-run wrote plugin files.');
      assert.equal(await exists(path.join(home, '.agents')), false, 'Dry-run wrote a marketplace.');
    }
  }
  const installed = path.join(home, '.codex', 'plugins', archive.manifest.name);
  const { server } = await inspectPackage(installed);
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio', '--config', config]);
  assert.deepEqual(await readFile(path.join(root, 'mcp.json')), originalMcp, 'Installer modified source mcp.json.');
  assert.deepEqual(await readFile(config), configBytes, 'Installer modified private configuration.');
  assert.equal(await readFile(token, 'utf8'), sentinel);
  for (const file of await treeFiles(installed)) {
    const relative = path.relative(installed, file).split(path.sep).join('/');
    assert.ok(!/(?:^|\/)(?:hermes\.config\.json|private-session\.token|node_modules)(?:\/|$)/.test(relative),
      'Private configuration or dependencies were copied into the plugin.');
    const bytes = await readFile(file);
    assert.ok(!bytes.includes(Buffer.from(sentinel)), 'Private token content was copied into the plugin.');
    assert.ok(!bytes.equals(configBytes), 'Private configuration content was copied into the plugin.');
  }
  const probe = await probeServer(installed, { timeoutMs, environment });
  return { kind: archive.manifest.kind, installed, root, home, config, token, probe };
}

/** Execute only trusted project release artifacts; checksums are not a publisher signature. */
export async function verifyRelease({ output = path.join(packageRoot, 'release'), scratchRoot = os.tmpdir(), timeoutMs = 20_000 } = {}) {
  const archives = await inspectRelease(path.resolve(output));
  const workspace = await realpath(await mkdtemp(path.join(scratchRoot, 'hermes release verify ')));
  const checks = [];
  for (const archive of archives) checks.push(await installAndProbe(archive, workspace, timeoutMs));
  // Retain temporary files for inspection/recoverable cleanup; never permanently delete them.
  return { workspace, archives: archives.map(archive => ({ name: archive.expectedName, kind: archive.manifest.kind,
    sha256: archive.sha256, fileCount: archive.entries.length })), checks };
}

async function main() {
  let output;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--directory') {
      assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), '--directory requires a value.');
      output = args[++index];
    } else if (args[index] === '--help') {
      console.log('Usage: node scripts/verify-release.mjs [--directory RELEASE_DIRECTORY]');
      console.log('Checks both ZIPs, SHA256SUMS, manifests and isolated install/MCP probes using Node only.');
      console.log('Use trusted project artifacts. No Hermes prompts or action tools are called; temporary evidence is retained.');
      return;
    } else throw new Error('Unknown release verification option.');
  }
  const result = await verifyRelease({ output });
  for (const archive of result.archives) console.log(`Verified ${archive.name}: ${archive.fileCount} files, SHA-256 ${archive.sha256}`);
  console.log('Both packages installed and initialized without node_modules, using isolated homes and empty Hermes connections.');
  console.log(`Temporary verification evidence retained at ${result.workspace}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(`Release verification failed: ${error.message}`); process.exitCode = 1; });
}
