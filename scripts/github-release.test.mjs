import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { publishGithubRelease, resolveGithubTag, validateReleaseTag } from './github-release.mjs';
import { sha256 } from './package-release.mjs';

const name = 'hermes-chatgpt-extension', tag = 'v0.3.0', commit = 'a'.repeat(40);
const pkg = { name, version: '0.3.0', license: 'MIT' };
const lock = { name, version: pkg.version, packages: { '': { name, version: pkg.version } } };

test('release tag requires matching package, plugin and both lockfile versions', () => {
  assert.deepEqual(validateReleaseTag(tag, pkg, pkg, lock), { version: '0.3.0', prerelease: false });
  assert.throws(() => validateReleaseTag('v0.3.1', pkg, pkg, lock), /exactly match/);
  assert.throws(() => validateReleaseTag(tag, pkg, { ...pkg, version: '0.2.3' }, lock), /versions must match/);
  assert.throws(() => validateReleaseTag(tag, pkg, pkg, { ...lock, version: '0.2.3' }), /versions must match/);
  assert.throws(() => validateReleaseTag(tag, pkg, pkg, { ...lock, packages: { '': { name, version: '0.2.3' } } }), /versions must match/);
  assert.throws(() => validateReleaseTag(tag, pkg, { ...pkg, license: 'private' }, lock));
});

test('release versions accept prereleases and reject unsafe or invalid identifiers', () => {
  for (const version of ['1.0.0-rc.1', '2.0.0-beta-next.0']) {
    const metadata = { ...pkg, version };
    assert.equal(validateReleaseTag(`v${version}`, metadata, metadata,
      { name, version, packages: { '': { name, version } } }).prerelease, true);
  }
  for (const version of ['01.0.0', '1.0.0-rc..1', '1.0.0-01', '1.0.0/../../private', '1.0.0\nother=value']) {
    assert.throws(() => validateReleaseTag(`v${version}`, { ...pkg, version }, pkg, lock));
  }
});

function scenario({ existing = null, initial = [], immutable = false, conflict = false, incomplete = false,
  corruptUpload = false, moved = false, annotated = false, moveAfterUpload = false, outage = false } = {}) {
  const bytes = new Map(), calls = [];
  const assets = [`${name}-0.3.0.zip`, `${name}-0.3.0-source.zip`, 'SHA256SUMS'].map(name => {
    const content = Buffer.from(`Known release fixture ${name}\n`);
    return { name, path: `/release/${name}`, hash: sha256(content), size: content.length, content };
  });
  let release = existing === null ? null : { tag_name: tag, draft: existing === 'draft', immutable,
    html_url: 'https://github.com/example/hermes/releases/tag/v0.3.0', assets: [] };
  const store = (expected, content = expected.content, state = 'uploaded') => {
    const asset = { id: bytes.size + 1, name: expected.name, state, size: content.length };
    bytes.set(asset.id, content);
    release.assets.push(asset);
  };
  for (const name of initial) {
    const expected = assets.find(asset => asset.name === name);
    store(expected, conflict ? Buffer.alloc(expected.size, 88) : expected.content, incomplete ? 'starter' : 'uploaded');
  }
  const run = async (args, options) => {
    calls.push(args);
    if (args[0] === 'release' && args[1] === 'view') {
      assert.equal(args[2], tag);
      assert.deepEqual(args.slice(-2), ['--json', 'databaseId']);
      if (outage) throw new Error('GitHub unavailable');
      if (!release) { assert.equal(options.allowMissing, true); return null; }
      return Buffer.from(JSON.stringify({ databaseId: 123 }));
    }
    if (args[0] === 'api') {
      const currentCommit = moved || moveAfterUpload && bytes.size > 0 ? 'b'.repeat(40) : commit;
      if (args[1] === 'repos/example/hermes/git/ref/tags/v0.3.0') {
        return Buffer.from(JSON.stringify({ ref: `refs/tags/${tag}`,
          object: annotated ? { type: 'tag', sha: 'c'.repeat(40) } : { type: 'commit', sha: currentCommit } }));
      }
      if (args[1] === `repos/example/hermes/git/tags/${'c'.repeat(40)}`) {
        assert.equal(annotated, true);
        return Buffer.from(JSON.stringify({ object: { type: 'commit', sha: currentCommit } }));
      }
      if (args[1] === 'repos/example/hermes/releases/123') {
        assert.ok(release);
        return Buffer.from(JSON.stringify(release));
      }
      // The REST tag lookup does not return drafts, unlike the CLI lookup above.
      if (args[1].includes('/releases/tags/')) return release?.draft ? null : Buffer.from(JSON.stringify(release));
      if (args[1].includes('/releases/assets/')) {
        assert.deepEqual(args.slice(2), ['--header', 'Accept: application/octet-stream']);
        return bytes.get(Number(args[1].split('/').at(-1)));
      }
    }
    if (args[0] === 'release' && args[1] === 'create') {
      assert.ok(args.includes('--draft')); assert.ok(args.includes('--verify-tag'));
      assert.equal(release, null);
      release = { tag_name: tag, draft: true, immutable: false,
        html_url: 'https://github.com/example/hermes/releases/tag/v0.3.0', assets: [] };
      return Buffer.from('Created draft');
    }
    if (args[0] === 'release' && args[1] === 'upload') {
      assert.ok(!args.includes('--clobber'));
      for (const file of args.slice(3, args.indexOf('--repo'))) {
        const asset = assets.find(asset => asset.name === path.basename(file));
        assert.ok(!release.assets.some(item => item.name === asset.name));
        store(asset, corruptUpload ? Buffer.alloc(asset.size, 88) : asset.content);
      }
      return Buffer.from('Uploaded');
    }
    if (args[0] === 'release' && args[1] === 'edit') {
      assert.ok(args.includes('--draft=false'));
      assert.equal(release.assets.length, 3);
      for (const expected of assets) {
        const asset = release.assets.find(item => item.name === expected.name);
        assert.equal(sha256(bytes.get(asset.id)), expected.hash);
      }
      release.draft = false;
      return Buffer.from('Published');
    }
    throw new Error(`Unexpected GitHub command ${args.join(' ')}`);
  };
  const publish = () => publishGithubRelease({ repository: 'example/hermes', tag, commit, assets, notesFile: '/release/notes.md', run });
  return { publish, calls, assets, get writes() { return calls.filter(args =>
    args[0] === 'release' && ['create', 'upload', 'edit'].includes(args[1])); }, get release() { return release; } };
}

test('new releases remain drafts until all uploaded bytes have been verified', async () => {
  const fixture = scenario();
  assert.equal(await fixture.publish(), 'https://github.com/example/hermes/releases/tag/v0.3.0');
  assert.equal(fixture.release.draft, false);
  const commands = fixture.writes;
  assert.deepEqual(commands.map(args => args[1]), ['create', 'upload', 'edit']);
  assert.equal(fixture.calls.filter(args => args[1]?.includes('/releases/assets/')).length, 3);
});

test('annotated release tags are peeled through the Git tag API before publication', async () => {
  const fixture = scenario({ annotated: true });
  await fixture.publish();
  assert.equal(fixture.release.draft, false);
  assert.equal(fixture.calls.filter(args => args[1] === `repos/example/hermes/git/tags/${'c'.repeat(40)}`).length, 2);
  assert.ok(!fixture.calls.some(args => args[1]?.includes('/commits/')));
});

test('invalid and cyclic tag objects fail through bounded, explicit reference lookup', async () => {
  for (const object of [{ type: 'tree', sha: commit }, { type: 'tag', sha: 'c'.repeat(40) }]) {
    let reads = 0;
    const run = async args => {
      reads++;
      if (args[1] === `repos/example/hermes/git/ref/tags/${tag}`) {
        return Buffer.from(JSON.stringify({ ref: `refs/tags/${tag}`, object }));
      }
      assert.equal(args[1], `repos/example/hermes/git/tags/${'c'.repeat(40)}`);
      return Buffer.from(JSON.stringify({ object }));
    };
    await assert.rejects(resolveGithubTag({ repository: 'example/hermes', tag, run }), /resolve to a commit|nested annotated tags/);
    assert.ok(reads <= 6);
  }
});

test('a retry resumes a partial draft and uploads only missing assets', async () => {
  const fixture = scenario({ existing: 'draft', initial: [`${name}-0.3.0.zip`] });
  await fixture.publish();
  const upload = fixture.calls.find(args => args[1] === 'upload');
  assert.ok(!upload.includes(`/release/${name}-0.3.0.zip`));
  assert.ok(upload.includes(`/release/${name}-0.3.0-source.zip`));
  assert.equal(fixture.release.draft, false);
});

test('published mutable releases receive missing packages without editing their metadata', async () => {
  const fixture = scenario({ existing: 'published' });
  await fixture.publish();
  assert.deepEqual(fixture.writes.map(args => args[1]), ['upload']);
});

test('rerunning a complete immutable release verifies its bytes without any writes', async () => {
  const fixture = scenario({ existing: 'published', immutable: true,
    initial: [`${name}-0.3.0.zip`, `${name}-0.3.0-source.zip`, 'SHA256SUMS'] });
  await fixture.publish();
  assert.equal(fixture.writes.length, 0);
});

test('immutable releases with missing assets fail before writing', async () => {
  const fixture = scenario({ existing: 'published', immutable: true });
  await assert.rejects(fixture.publish(), /immutable published release cannot accept missing assets/);
  assert.equal(fixture.writes.length, 0);
});

test('existing corrupt or incomplete assets are preserved and block further uploads', async () => {
  for (const options of [{ conflict: true }, { incomplete: true }]) {
    const fixture = scenario({ existing: 'draft', initial: [`${name}-0.3.0.zip`], ...options });
    await assert.rejects(fixture.publish(), /differs|incomplete upload/);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.release.draft, true);
  }
});

test('an upload with wrong bytes is never published', async () => {
  const fixture = scenario({ corruptUpload: true });
  await assert.rejects(fixture.publish(), /differs/);
  assert.equal(fixture.release.draft, true);
  assert.equal(fixture.calls.some(args => args[1] === 'edit'), false);
});

test('a tag moved during upload leaves the verified packages in a draft', async () => {
  const fixture = scenario({ moveAfterUpload: true });
  await assert.rejects(fixture.publish(), /no longer points/);
  assert.equal(fixture.release.draft, true);
  assert.equal(fixture.calls.some(args => args[1] === 'edit'), false);
});

test('a moved tag or GitHub failure cannot create a release', async () => {
  for (const options of [{ moved: true }, { outage: true }]) {
    const fixture = scenario(options);
    await assert.rejects(fixture.publish(), /no longer points|unavailable/);
    assert.equal(fixture.writes.length, 0);
  }
});
