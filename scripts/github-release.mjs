import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { sha256 } from './package-release.mjs';
import { inspectRelease } from './verify-release.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const pluginName = 'hermes-chatgpt-extension';

export function validateReleaseTag(tag, pkg, plugin, lock) {
  assert.equal(pkg.name, pluginName);
  assert.equal(plugin.name, pkg.name);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages?.['']?.name, pkg.name);
  assert.equal(pkg.license, 'MIT');
  assert.equal(plugin.license, 'MIT');
  assert.match(pkg.version ?? '', /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+)?$/,
    'Release versions must use MAJOR.MINOR.PATCH with an optional prerelease.');
  const prerelease = pkg.version.split('-').slice(1).join('-');
  assert.ok(!prerelease.split('.').some(part => /^0\d+$/.test(part)), 'Numeric prerelease identifiers cannot have leading zeroes.');
  for (const version of [plugin.version, lock.version, lock.packages[''].version]) {
    assert.equal(version, pkg.version, 'Package, plugin and lockfile versions must match.');
  }
  assert.equal(tag, `v${pkg.version}`, 'The release tag must exactly match the package version.');
  return { version: pkg.version, prerelease: prerelease.length > 0 };
}

async function metadata(tag) {
  const files = await Promise.all(['package.json', 'plugin.json', 'package-lock.json'].map(async name =>
    JSON.parse(await readFile(path.join(packageRoot, name), 'utf8'))));
  return validateReleaseTag(tag, ...files);
}

async function githubCommand(args, { allowMissing = false } = {}) {
  try {
    const result = await execute('gh', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return result.stdout;
  } catch (error) {
    const detail = error.stderr?.toString() ?? '';
    if (allowMissing && (/\(HTTP 404\)/.test(detail) || /^release not found\s*$/i.test(detail))) return null;
    throw new Error(`GitHub command failed: ${detail.trim().slice(0, 1000) || error.message}`);
  }
}

/** Resolve the explicit tag reference, including annotated tags, without branch-name ambiguity. */
export async function resolveGithubTag({ repository, tag, run = githubCommand }) {
  assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  const api = `repos/${repository}`;
  const json = async endpoint => JSON.parse((await run(['api', endpoint])).toString());
  const reference = await json(`${api}/git/ref/tags/${tag}`);
  assert.equal(reference.ref, `refs/tags/${tag}`, 'GitHub did not return the requested tag reference.');
  let object = reference.object;
  for (let depth = 0; object?.type === 'tag'; depth++) {
    assert.ok(depth < 5, 'Too many nested annotated tags.');
    assert.match(object.sha ?? '', /^[a-f0-9]{40}$/, 'Invalid annotated tag SHA.');
    object = (await json(`${api}/git/tags/${object.sha}`)).object;
  }
  assert.equal(object?.type, 'commit', 'The release tag must resolve to a commit.');
  assert.match(object.sha ?? '', /^[a-f0-9]{40}$/, 'Invalid release commit SHA.');
  return object.sha;
}

/** Resume partial uploads, but never replace an existing release asset. */
export async function publishGithubRelease({ repository, tag, commit, assets, notesFile, run = githubCommand }) {
  assert.match(repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'GITHUB_REPOSITORY must identify the release repository.');
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'GITHUB_SHA must identify the checked-out release commit.');
  const prefix = `${pluginName}-${tag.slice(1)}`;
  assert.deepEqual(assets.map(asset => asset.name).sort(), [`${prefix}.zip`, `${prefix}-source.zip`, 'SHA256SUMS'].sort());
  for (const asset of assets) {
    assert.match(asset.hash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 64 * 1024 * 1024);
  }
  const api = `repos/${repository}`;
  const json = async (args, options) => {
    const bytes = await run(args, options);
    return bytes === null ? null : JSON.parse(bytes.toString());
  };
  const verifyTagCommit = async () => {
    const remote = await resolveGithubTag({ repository, tag, run });
    assert.equal(remote, commit, 'The remote release tag no longer points to the checked-out commit.');
  };
  const getRelease = async () => {
    // REST's tag lookup excludes drafts. The CLI also looks up drafts through GraphQL.
    const found = await json(['release', 'view', tag, '--repo', repository, '--json', 'databaseId'], { allowMissing: true });
    if (!found) return null;
    assert.ok(Number.isSafeInteger(found.databaseId) && found.databaseId > 0, 'Invalid GitHub release ID.');
    return json(['api', `${api}/releases/${found.databaseId}`]);
  };
  const checkAsset = async (release, expected) => {
    const asset = release.assets.find(item => item.name === expected.name);
    if (!asset) return false;
    assert.equal(asset.state, 'uploaded', `Release asset ${expected.name} has an incomplete upload; resolve it before retrying.`);
    assert.equal(asset.size, expected.size, `Existing release asset ${expected.name} differs; publish a new version.`);
    assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, 'Invalid GitHub release asset ID.');
    const bytes = await run(['api', `${api}/releases/assets/${asset.id}`, '--header', 'Accept: application/octet-stream']);
    assert.equal(sha256(bytes), expected.hash, `Existing release asset ${expected.name} differs; publish a new version.`);
    return true;
  };

  await verifyTagCommit();
  let release = await getRelease();
  if (!release) {
    const args = ['release', 'create', tag, '--repo', repository, '--draft', '--verify-tag',
      '--title', `Hermes ${tag}`, '--notes-file', notesFile];
    if (tag.includes('-')) args.push('--prerelease');
    await run(args);
    release = await getRelease();
    assert.ok(release, 'The draft release was not created.');
  }
  assert.equal(release.tag_name, tag);
  assert.ok(Array.isArray(release.assets), 'GitHub did not return release assets.');
  const missing = [];
  for (const asset of assets) if (!await checkAsset(release, asset)) missing.push(asset);
  assert.ok(!release.immutable || missing.length === 0,
    'An immutable published release cannot accept missing assets. Push a new version tag so this workflow uploads before publishing.');
  if (missing.length > 0) {
    await run(['release', 'upload', tag, ...missing.map(asset => asset.path), '--repo', repository]);
  }
  release = await getRelease();
  assert.ok(release, 'The release disappeared during upload.');
  for (const asset of assets) assert.ok(await checkAsset(release, asset), `Release asset ${asset.name} is missing after upload.`);
  await verifyTagCommit();
  if (release.draft) await run(['release', 'edit', tag, '--repo', repository, '--draft=false', '--verify-tag']);
  release = await getRelease();
  assert.ok(release && !release.draft, 'The release was not published.');
  return release.html_url;
}

async function main() {
  const [command, tag, ...extra] = process.argv.slice(2);
  assert.ok((command === 'check' || command === 'publish') && tag && extra.length === 0,
    'Usage: node scripts/github-release.mjs <check|publish> vMAJOR.MINOR.PATCH');
  const { version } = await metadata(tag);
  if (command === 'check') { console.log(`Validated release tag ${tag}.`); return; }
  const output = path.join(packageRoot, 'release');
  const archives = await inspectRelease(output);
  assert.ok(archives.every(archive => archive.manifest.version === version), 'Built ZIPs do not match the release tag.');
  const assets = await Promise.all([...archives.map(archive => archive.expectedName), 'SHA256SUMS'].map(async name => {
    const file = path.join(output, name), bytes = await readFile(file);
    return { name, path: file, hash: sha256(bytes), size: bytes.length };
  }));
  const notesFile = path.join(output, 'release-notes.md');
  await writeFile(notesFile, `Hermes chat, profiles and scheduled jobs inside Codex. Connect to one or more local or remote Hermes instances using SSH or a desktop HTTP gateway.\n\n` +
    `Download **${pluginName}-${version}.zip** for the ready-to-install plugin. It includes the compiled server and UI; Node.js 22 or later is required.\n\n` +
    `The **${pluginName}-${version}-source.zip** contains the allowlisted source without Git history. **SHA256SUMS** checks both ZIPs.\n\n` +
    `Extract the plugin ZIP and follow its README to configure your connections and install it in Codex. Your configuration and credentials stay outside the plugin.\n\n` +
    `Built, tested and verified by GitHub Actions on Node.js 22 and 24. Released under the MIT licence with bundled third-party notices.\n`);
  const url = await publishGithubRelease({ repository: process.env.GITHUB_REPOSITORY, tag, commit: process.env.GITHUB_SHA, assets, notesFile });
  console.log(`Published verified release: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(`GitHub release failed: ${error.message}`); process.exitCode = 1; });
}
