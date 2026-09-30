import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPackage } from './verify-plugin.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markerName = '.hermes-plugin-install.json';
const packageFiles = ['plugin.json', 'mcp.json', 'dist/server.cjs', 'dist/ui.html'];

async function statOrMissing(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readOrMissing(file) {
  const stat = await statOrMissing(file);
  if (!stat) return null;
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${file} must be a regular file.`);
  return readFile(file, 'utf8');
}

async function rejectSymlinkAncestors(home, target) {
  const relative = path.relative(home, target);
  assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  let current = home;
  for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stat = await statOrMissing(current);
    assert.ok(!stat?.isSymbolicLink(), `Refusing a symlink in the installation path: ${current}`);
  }
}

async function collectFiles(root, relative) {
  const absolute = path.join(root, relative);
  const stat = await lstat(absolute);
  assert.ok(!stat.isSymbolicLink(), `Refusing to package symlink: ${relative}`);
  if (stat.isFile()) return [relative];
  assert.ok(stat.isDirectory(), `Unsupported package entry: ${relative}`);
  const children = (await readdir(absolute)).sort();
  const files = [];
  for (const child of children) files.push(...await collectFiles(root, path.join(relative, child)));
  return files;
}

/** Construct a guarded plan; it has no filesystem or host configuration side effects. */
export async function planInstallation({ root = packageRoot, home = os.homedir(), replace = false, config } = {}) {
  root = path.resolve(root);
  home = path.resolve(home);
  const { plugin, mcp } = await inspectPackage(root);
  const destination = path.join(home, '.codex', 'plugins', plugin.name);
  const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
  await rejectSymlinkAncestors(home, destination);
  await rejectSymlinkAncestors(home, marketplacePath);
  const before = await readOrMissing(marketplacePath);
  const marketplace = before === null
    ? { name: 'personal', interface: { displayName: 'Personal plugins' }, plugins: [] }
    : JSON.parse(before);
  assert.ok(typeof marketplace.name === 'string' && marketplace.name.trim(), 'The existing marketplace must have a name.');
  assert.ok(Array.isArray(marketplace.plugins), 'The existing marketplace must have a plugins array.');
  const sourcePath = `./${path.relative(home, destination).split(path.sep).join('/')}`;
  const matching = marketplace.plugins.filter((entry) => entry?.name === plugin.name);
  assert.ok(matching.length <= 1, 'The marketplace contains duplicate Hermes entries; resolve them before installing.');
  if (matching.length) {
    const source = matching[0].source;
    const originalPath = typeof source === 'string' ? source : source?.source === 'local' ? source.path : null;
    assert.equal(originalPath, sourcePath, 'An existing Hermes entry points elsewhere; it will not be overwritten.');
  } else {
    marketplace.plugins.push({
      name: plugin.name,
      source: { source: 'local', path: sourcePath },
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
      category: 'Productivity',
    });
  }
  const destinationStat = await statOrMissing(destination);
  let previousMarker = null;
  if (destinationStat) {
    assert.ok(destinationStat.isDirectory(), 'The destination must be a directory.');
    const marker = await readOrMissing(path.join(destination, markerName));
    assert.ok(marker, 'The destination is unmanaged and will not be overwritten.');
    previousMarker = JSON.parse(marker);
    assert.equal(previousMarker.plugin, plugin.name, 'The existing installation belongs to another plugin.');
    assert.ok(replace, 'A managed installation already exists; use --replace to keep a backup and replace it.');
    if (config === undefined) {
      const previousMcp = JSON.parse(await readOrMissing(path.join(destination, 'mcp.json')));
      const previousArgs = previousMcp?.mcpServers?.hermes?.args;
      if (Array.isArray(previousArgs) && previousArgs[2] === '--config') config = previousArgs[3];
    }
  }
  if (config !== undefined) {
    assert.ok(typeof config === 'string' && path.isAbsolute(config), '--config must be an absolute path.');
    const configStat = await lstat(config);
    assert.ok(configStat.isFile() && !configStat.isSymbolicLink(), '--config must refer to an existing regular file.');
    mcp.mcpServers.hermes.args = ['${PLUGIN_ROOT}/dist/server.cjs', '--stdio', '--config', config];
  }
  const files = [...packageFiles, ...await collectFiles(root, 'skills/hermes')];
  const snapshots = [];
  for (const relative of files) {
    const stat = await lstat(path.join(root, relative));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Refusing non-regular package file: ${relative}`);
    const bytes = relative === 'mcp.json' && config !== undefined
      ? Buffer.from(`${JSON.stringify(mcp, null, 2)}\n`)
      : await readFile(path.join(root, relative));
    snapshots.push({ relative, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return {
    root, home, plugin, destination, marketplacePath, before,
    after: `${JSON.stringify(marketplace, null, 2)}\n`,
    marketplaceName: marketplace.name, preservedEntries: marketplace.plugins.length - (matching.length ? 0 : 1),
    previousMarker, snapshots, config,
  };
}

/** Apply the specific plan only while its original marketplace and destination still match. */
export async function applyInstallation(plan) {
  const { home, destination, marketplacePath, plugin, snapshots } = plan;
  await rejectSymlinkAncestors(home, destination);
  await rejectSymlinkAncestors(home, marketplacePath);
  assert.ok(await readOrMissing(marketplacePath) === plan.before, 'The marketplace changed after planning; rerun the installer.');
  const currentDestination = await statOrMissing(destination);
  if (plan.previousMarker) {
    const currentMarker = await readOrMissing(path.join(destination, markerName));
    assert.ok(currentMarker && JSON.stringify(JSON.parse(currentMarker)) === JSON.stringify(plan.previousMarker),
      'The installation changed after planning; rerun the installer.');
  } else assert.equal(currentDestination, null, 'The installation destination appeared after planning; it will not be overwritten.');

  const suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const staging = `${destination}.staging-${suffix}`;
  const backup = plan.previousMarker ? `${destination}.backup-${suffix}` : null;
  const marketplaceBackup = plan.before === null ? null : `${marketplacePath}.backup-${suffix}`;
  const temporaryMarketplace = `${marketplacePath}.staging-${suffix}`;
  const installId = randomUUID();
  let previousMoved = false;
  let installed = false;
  let marketplaceWritten = false;
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await mkdir(path.dirname(marketplacePath), { recursive: true });
    await mkdir(staging);
    for (const { relative, bytes } of snapshots) {
      const target = path.join(staging, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(path.join(staging, markerName), `${JSON.stringify({
      plugin: plugin.name, version: plugin.version, installId,
      installedAt: new Date().toISOString(),
      files: Object.fromEntries(snapshots.map(({ relative, sha256 }) => [relative, sha256])),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await inspectPackage(staging);
    assert.ok(await readOrMissing(marketplacePath) === plan.before, 'The marketplace changed during staging; rerun the installer.');
    if (marketplaceBackup) await writeFile(marketplaceBackup, plan.before, { flag: 'wx', mode: 0o600 });
    await writeFile(temporaryMarketplace, plan.after, { flag: 'wx', mode: 0o600 });
    if (backup) { await rename(destination, backup); previousMoved = true; }
    else assert.equal(await statOrMissing(destination), null, 'The destination appeared during staging.');
    await rename(staging, destination);
    installed = true;
    assert.ok(await readOrMissing(marketplacePath) === plan.before, 'The marketplace changed before publication; rerun the installer.');
    await rename(temporaryMarketplace, marketplacePath);
    marketplaceWritten = true;
    return { destination, marketplacePath, backup, marketplaceBackup, installId };
  } catch (error) {
    // Preserve recoverable files rather than delete anything or overwrite a concurrent edit.
    if (installed && !marketplaceWritten) {
      const marker = await readOrMissing(path.join(destination, markerName));
      if (marker && JSON.parse(marker).installId === installId) {
        await rename(destination, `${destination}.failed-${suffix}`);
        if (previousMoved) await rename(backup, destination);
      }
    } else if (previousMoved && !installed && (await statOrMissing(destination)) === null) {
      await rename(backup, destination);
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = { apply: false, replace: false, home: os.homedir() };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--home') {
      assert.ok(args[index + 1], '--home needs a directory.');
      options.home = path.resolve(args[++index]);
    } else if (arg === '--config') {
      assert.ok(args[index + 1], '--config needs an absolute file path.');
      options.config = args[++index];
    } else if (arg === '--help') {
      console.log('Usage: node scripts/install-plugin.mjs [--dry-run | --apply] [--replace] [--config ABSOLUTE_PATH] [--home DIRECTORY]');
      console.log('Dry-run is the default. --apply copies compiled files and guardedly merges one personal marketplace entry.');
      console.log('--replace preserves backups of an earlier managed install. --home supports an isolated test home.');
      console.log('--config references an existing private configuration; its contents are never copied. Replacement preserves the earlier reference.');
      console.log('This script does not change Codex config, enable the plugin, restart the app or create a chat.');
      return;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  const plan = await planInstallation(options);
  console.log(`Plugin: ${plan.plugin.name} ${plan.plugin.version}`);
  console.log(`Copy ${plan.snapshots.length} compiled package files to ${plan.destination}`);
  if (plan.config) console.log(`Reference existing configuration: ${plan.config}`);
  console.log(`Merge marketplace ${plan.marketplacePath}, preserving ${plan.preservedEntries} existing entries.`);
  if (!options.apply) {
    console.log('Dry-run complete; no files or host settings changed. Pass --apply to install the files.');
    return;
  }
  const result = await applyInstallation(plan);
  console.log('Plugin files and marketplace entry installed.');
  if (result.backup) console.log(`Previous plugin preserved at ${result.backup}`);
  if (result.marketplaceBackup) console.log(`Previous marketplace preserved at ${result.marketplaceBackup}`);
  const detailUrl = `codex://plugins/${encodeURIComponent(plan.plugin.name)}?marketplacePath=${encodeURIComponent(plan.marketplacePath)}`;
  console.log(`Open its install/detail page: ${detailUrl}`);
  console.log('Select Install/Enable in Codex. If the source is not discovered, follow the documented desktop refresh/restart flow yourself.');
  console.log('After installation, open Hermes from the sidebar or existing chat panel. Embedded rendering remains a host acceptance check.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Plugin installation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
