import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPackage, verifyMarketplace } from './verify-plugin.mjs';
import { zipEntries } from './release-zip.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFiles = [
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'plugin.json', 'mcp.json',
  '.agents/plugins/marketplace.json', 'dist/server.cjs', 'dist/ui.html', 'dist/THIRD_PARTY_LICENSES.txt',
  'assets/nous-girl.png', 'assets/nous-girl-dark.png', 'skills/hermes/SKILL.md',
  'examples/config.local.json', 'examples/config.ssh.json', 'examples/config.ssh-attach.json',
  'examples/config.http.json', 'examples/config.multiple.json',
  'scripts/install-plugin.mjs', 'scripts/verify-plugin.mjs',
];
const sourceFiles = ['.gitignore', '.env.example', 'AGENTS.md', 'TODO.md', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts',
  '.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/build.mjs', 'scripts/bundle-licenses.mjs',
  'scripts/github-release.mjs', 'scripts/github-release.test.mjs',
  'scripts/package-release.mjs', 'scripts/release-zip.mjs', 'scripts/verify-release.mjs',
  'scripts/install-plugin.test.mjs', 'scripts/package-release.test.mjs', 'scripts/bundle-licenses.test.mjs'];

async function sourceTree(root, directory) {
  const result = [];
  for (const name of (await readdir(path.join(root, directory))).sort()) {
    const relative = `${directory}/${name}`, stat = await lstat(path.join(root, relative));
    assert.ok(!stat.isSymbolicLink(), `Refusing a source symlink: ${relative}`);
    if (stat.isDirectory()) result.push(...await sourceTree(root, relative));
    else if (/\.(?:ts|tsx|css|html|md)$/.test(name)) result.push(relative);
  }
  return result;
}

/** Explicit allowlist; ignores .git, node_modules, environment/config files and work output. */
export async function collectReleaseFiles(root = packageRoot, kind = 'plugin') {
  assert.ok(kind === 'plugin' || kind === 'source');
  const files = [...runtimeFiles];
  if (kind === 'source') files.push(...sourceFiles, ...await sourceTree(root, 'src'),
    ...await sourceTree(root, 'tests'), ...await sourceTree(root, 'docs'));
  return Promise.all([...new Set(files)].sort().map(async relative => {
    for (let current = path.dirname(relative); current !== '.'; current = path.dirname(current)) {
      assert.ok(!(await lstat(path.join(root, current))).isSymbolicLink(), `Refusing a package symlink: ${current}`);
    }
    const stat = await lstat(path.join(root, relative));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Package file must be regular: ${relative}`);
    return { relative, bytes: await readFile(path.join(root, relative)) };
  }));
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function packageRelease({ root = packageRoot, output = path.join(root, 'release') } = {}) {
  const { plugin, server } = await inspectPackage(root);
  await verifyMarketplace(root);
  assert.equal(server.args.length, 2, 'Release manifests must not reference private configuration.');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version); assert.equal(pkg.license, 'MIT');
  assert.match(plugin.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  await mkdir(output, { recursive: true });
  const prefix = `${plugin.name}-${plugin.version}`, archives = [];
  for (const kind of ['plugin', 'source']) {
    const files = await collectReleaseFiles(root, kind);
    const manifest = { name: plugin.name, version: plugin.version, kind, files: Object.fromEntries(files.map(file => [file.relative, sha256(file.bytes)])) };
    const entries = [...files.map(file => ({ name: `${prefix}/${file.relative}`, bytes: file.bytes })),
      { name: `${prefix}/RELEASE_MANIFEST.json`, bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') }];
    const bytes = zipEntries(entries), name = `${prefix}${kind === 'source' ? '-source' : ''}.zip`;
    await writeFile(path.join(output, name), bytes);
    archives.push({ name, path: path.join(output, name), sha256: sha256(bytes), fileCount: entries.length });
  }
  await writeFile(path.join(output, 'SHA256SUMS'), archives.map(archive => `${archive.sha256}  ${archive.name}\n`).join(''));
  return archives;
}

function isEntrypoint() {
  try { return process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}

if (isEntrypoint()) {
  packageRelease().then(archives => {
    for (const archive of archives) console.log(`Prepared ${archive.name}: ${archive.fileCount} allowlisted files, SHA-256 ${archive.sha256}`);
  }).catch(error => { console.error(`Release packaging failed: ${error.message}`); process.exitCode = 1; });
}
