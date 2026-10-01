import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { collectBundleLicenses } from './bundle-licenses.mjs';

// All attribution and package data are synthetic. Tests do not read installed
// dependency licences, real configuration or a network endpoint.
const fixtureLicense = `MIT License

Copyright (c) 2026 Synthetic Fixture Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const workspace = await mkdtemp(path.join(os.tmpdir(), 'hermes-license-tests-'));
let fixtureNumber = 0;
after(() => {
  // Use recoverable cleanup on macOS. CI can leave its isolated temporary files
  // in the runner's temporary directory when trash is unavailable.
  if (process.platform === 'darwin') spawnSync('trash', [workspace], { stdio: 'ignore' });
});

async function fixture() {
  const root = path.join(workspace, String(++fixtureNumber));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
  await writeFile(path.join(root, 'src', 'main.js'), 'export const app = true;\n');
  return root;
}

async function dependency(root, name, { license = fixtureLicense, declaredLicense = 'MIT', notices = {} } = {}) {
  const directory = path.join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: declaredLicense }));
  await writeFile(path.join(directory, 'index.js'), 'export const dependency = true;\n');
  if (license !== null) await writeFile(path.join(directory, 'LICENSE'), license);
  for (const [file, text] of Object.entries(notices)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), text);
  }
  return `node_modules/${name}/index.js`;
}

function bundle(name, inputs, legalComments = '') {
  return {
    name,
    legalComments,
    metafile: {
      outputs: {
        [`dist/${name}.js`]: {
          inputs: Object.fromEntries(Object.entries(inputs).map(([input, bytesInOutput]) => [input, { bytesInOutput }])),
        },
      },
    },
  };
}

test('preserves complete licence, NOTICE, copyright and vendor legal comments', async () => {
  const root = await fixture();
  const notice = 'Synthetic attribution\nThe following credited work is included.\n';
  const copyright = 'Copyright (c) 2026 Additional Synthetic Fixture Authors\n';
  const input = await dependency(root, '@fixture/library', { notices: { NOTICE: notice, 'CopyrightNotice.txt': copyright } });
  const legalComments = '/*! Additional synthetic vendor legal comment. */';
  const result = await collectBundleLicenses({ root, bundles: [bundle('UI', { [input]: 30, 'src/main.js': 10 }, legalComments)] });

  assert.equal(result.packageCount, 1);
  assert.ok(result.text.includes(fixtureLicense.trimEnd()));
  assert.ok(result.text.includes(notice.trimEnd()));
  assert.ok(result.text.includes(copyright.trimEnd()));
  assert.ok(result.text.includes(legalComments));
  assert.ok(result.text.includes('@fixture/library@1.0.0'));
  assert.ok(result.text.includes('--- NOTICE ---'));
  assert.ok(result.text.includes('Declared licence: MIT'));
  assert.ok(!result.text.includes('fixture-app@'));
  assert.ok(!result.text.includes(root));
});

test('excludes zero-byte inputs and shares a package notice across UI and server', async () => {
  const root = await fixture();
  const input = await dependency(root, 'shared-fixture');
  const unused = await dependency(root, 'unused-fixture', { license: null });
  const result = await collectBundleLicenses({
    root,
    bundles: [bundle('UI', { [input]: 30, [unused]: 0 }), bundle('server', { [input]: 20 })],
  });

  assert.equal(result.packageCount, 1);
  assert.equal(result.text.match(/shared-fixture@1\.0\.0/g)?.length, 1);
  assert.ok(result.text.includes('Bundled in: UI, server'));
  assert.ok(!result.text.includes('unused-fixture'));
});

test('retains notices alongside a contributing nested input', async () => {
  const root = await fixture();
  await dependency(root, 'nested-fixture', { notices: { 'lib/NOTICE.txt': 'Nested synthetic attribution.\n' } });
  const input = 'node_modules/nested-fixture/lib/main.js';
  await writeFile(path.join(root, input), 'export const nested = true;\n');
  const result = await collectBundleLicenses({ root, bundles: [bundle('UI', { [input]: 30 })] });
  assert.ok(result.text.includes('--- lib/NOTICE.txt ---'));
  assert.ok(result.text.includes('Nested synthetic attribution.'));
});

test('requires esbuild metafiles', async () => {
  const root = await fixture();
  await assert.rejects(() => collectBundleLicenses({ root, bundles: [] }), /requires.*metafiles/);
  await assert.rejects(() => collectBundleLicenses({ root, bundles: [{ name: 'UI' }] }), /requires.*metafiles/);
});

test('rejects a contributing dependency without a complete upstream licence', async () => {
  const root = await fixture();
  const input = await dependency(root, 'missing-fixture', { license: null });
  await assert.rejects(() => collectBundleLicenses({ root, bundles: [bundle('server', { [input]: 30 })] }), /Missing full licence.*missing-fixture@1\.0\.0/);
});

test('rejects a short SPDX identifier in place of the full licence', async () => {
  const root = await fixture();
  const input = await dependency(root, 'incomplete-fixture', { license: 'SPDX-License-Identifier: MIT\n' });
  await assert.rejects(() => collectBundleLicenses({ root, bundles: [bundle('UI', { [input]: 30 })] }), /Incomplete licence.*incomplete-fixture/);
});

for (const [description, license] of [['empty', ''], ['binary', Buffer.from([0, 1, 2, 3])]]) {
  test(`rejects ${description === 'empty' ? 'an' : 'a'} ${description} upstream licence file`, async () => {
    const root = await fixture();
    const input = await dependency(root, 'invalid-fixture', { license });
    await assert.rejects(() => collectBundleLicenses({ root, bundles: [bundle('UI', { [input]: 30 })] }), /empty or binary/);
  });
}

test('rejects an explicitly unlicensed dependency', async () => {
  const root = await fixture();
  const input = await dependency(root, 'unlicensed-fixture', { declaredLicense: 'UNLICENSED' });
  await assert.rejects(() => collectBundleLicenses({ root, bundles: [bundle('UI', { [input]: 30 })] }), /declares no redistribution licence/);
});

for (const [description, privatePath] of [
  ['macOS home', ['', 'Users', 'synthetic-build-owner', 'private', ''].join('/')],
  ['Unix home', ['', 'home', 'synthetic-build-owner', 'private', ''].join('/')],
  ['Windows home', ['C:', 'Users', 'synthetic-build-owner', 'private'].join('\\')],
]) {
  test(`rejects ${description} paths in upstream notices`, async () => {
    const root = await fixture();
    const input = await dependency(root, 'private-path-fixture', { notices: { NOTICE: `Synthetic notice\n${privatePath}\n` } });
    await assert.rejects(() => collectBundleLicenses({ root, bundles: [bundle('server', { [input]: 30 })] }), /private absolute path/);
  });
}

test('rejects the actual build root in retained vendor legal comments', async () => {
  const root = await fixture();
  const input = await dependency(root, 'comment-path-fixture');
  await assert.rejects(() => collectBundleLicenses({
    root,
    bundles: [bundle('UI', { [input]: 30 }, `/*! Synthetic build origin: ${root} */`)],
  }), /private absolute path/);
});

test('rejects font URLs without verified font-specific attribution', async () => {
  const root = await fixture();
  const input = await dependency(root, 'font-css-fixture');
  await assert.rejects(() => collectBundleLicenses({
    root,
    bundles: [bundle('UI', { [input]: 30 })],
    css: '@font-face{font-family:Unknown;src:url(https://fonts.example.invalid/font.woff2)}',
  }), /Unaccounted font reference/);
});

test('rejects embedded fonts without an accounted bundle input', async () => {
  const root = await fixture();
  const input = await dependency(root, 'embedded-font-fixture');
  await assert.rejects(() => collectBundleLicenses({
    root,
    bundles: [bundle('UI', { [input]: 30 })],
    css: '@font-face{font-family:Unknown;src:url(data:font/woff2;base64,AAAA)}',
  }), /no accounted bundle input or font-specific licence/);
});
