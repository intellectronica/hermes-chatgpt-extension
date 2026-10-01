import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import postcss from 'postcss';

// These npm distributions omit their licence files. Preserve verified upstream
// notices offline, pinned to the installed versions; an unknown version fails.
const upstreamLicenses = [
  {
    "name": "@cfworker/json-schema",
    "version": "4.1.1",
    "license": "MIT",
    "source": "https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md",
    "sha256": "376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094",
    "text": "MIT License\n\nCopyright (c) 2020 Jeremy Danyow\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
  },
  {
    "name": "react-remove-scroll-bar",
    "version": "2.3.8",
    "license": "MIT",
    "source": "https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE",
    "sha256": "a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84",
    "text": "MIT License\n\nCopyright (c) 2025 Anton Korzunov <thekashey@gmail.com>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n",
    "note": "The npm distribution declares MIT and this author but omits its licence file. Its published gitHead is unavailable upstream; this is the verified upstream project notice at the pinned source revision, not a claimed matching release commit."
  },
  {
    "name": "rehype-katex",
    "version": "7.0.1",
    "license": "MIT",
    "source": "https://github.com/remarkjs/remark-math/blob/88a9497e1ede93b958237c85edbf5651faeca7af/license",
    "sha256": "cb992262f361a5359e6771c28740d33c7041e15332ae8537fae40538992591a9",
    "text": "(The MIT License)\n\nCopyright (c) 2017 Junyoung Choi <fluke8259@gmail.com>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
  },
  {
    "name": "remark-math",
    "version": "6.0.0",
    "license": "MIT",
    "source": "https://github.com/remarkjs/remark-math/blob/d5d0660b150810a535bbb07eac6cc96a4510aa24/license",
    "sha256": "cb992262f361a5359e6771c28740d33c7041e15332ae8537fae40538992591a9",
    "text": "(The MIT License)\n\nCopyright (c) 2017 Junyoung Choi <fluke8259@gmail.com>\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
  }
];

// Canonical licence body, without the example copyright-holder placeholders:
// https://openfontlicense.org/documents/OFL.txt
// Font-specific copyright and reserved names come from installed font metadata.
const openFontLicense = "-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------\n\nPREAMBLE\nThe goals of the Open Font License (OFL) are to stimulate worldwide\ndevelopment of collaborative font projects, to support the font creation\nefforts of academic and linguistic communities, and to provide a free and\nopen framework in which fonts may be shared and improved in partnership\nwith others.\n\nThe OFL allows the licensed fonts to be used, studied, modified and\nredistributed freely as long as they are not sold by themselves. The\nfonts, including any derivative works, can be bundled, embedded,\nredistributed and/or sold with any software provided that any reserved\nnames are not used by derivative works. The fonts and derivatives,\nhowever, cannot be released under any other type of license. The\nrequirement for fonts to remain under this license does not apply\nto any document created using the fonts or their derivatives.\n\nDEFINITIONS\n\"Font Software\" refers to the set of files released by the Copyright\nHolder(s) under this license and clearly marked as such. This may\ninclude source files, build scripts and documentation.\n\n\"Reserved Font Name\" refers to any names specified as such after the\ncopyright statement(s).\n\n\"Original Version\" refers to the collection of Font Software components as\ndistributed by the Copyright Holder(s).\n\n\"Modified Version\" refers to any derivative made by adding to, deleting,\nor substituting -- in part or in whole -- any of the components of the\nOriginal Version, by changing formats or by porting the Font Software to a\nnew environment.\n\n\"Author\" refers to any designer, engineer, programmer, technical\nwriter or other person who contributed to the Font Software.\n\nPERMISSION & CONDITIONS\nPermission is hereby granted, free of charge, to any person obtaining\na copy of the Font Software, to use, study, copy, merge, embed, modify,\nredistribute, and sell modified and unmodified copies of the Font\nSoftware, subject to the following conditions:\n\n1) Neither the Font Software nor any of its individual components,\nin Original or Modified Versions, may be sold by itself.\n\n2) Original or Modified Versions of the Font Software may be bundled,\nredistributed and/or sold with any software, provided that each copy\ncontains the above copyright notice and this license. These can be\nincluded either as stand-alone text files, human-readable headers or\nin the appropriate machine-readable metadata fields within text or\nbinary files as long as those fields can be easily viewed by the user.\n\n3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder. This restriction only applies to the primary font name as\npresented to the users.\n\n4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\nSoftware shall not be used to promote, endorse or advertise any\nModified Version, except to acknowledge the contribution(s) of the\nCopyright Holder(s) and the Author(s) or with their explicit written\npermission.\n\n5) The Font Software, modified or unmodified, in part or in whole,\nmust be distributed entirely under this license, and must not be\ndistributed under any other license. The requirement for fonts to\nremain under this license does not apply to any document created\nusing the Font Software.\n\nTERMINATION\nThis license becomes null and void if any of the above conditions are\nnot met.\n\nDISCLAIMER\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\nOF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\nCOPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nINCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\nDAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\nOTHER DEALINGS IN THE FONT SOFTWARE.\n";

const noticeName = /^(?:licen[cs]e|licen[cs]ing|notice|copyright|copying|ofl|unlicen[cs]e)/i;
const licenceName = /^(?:licen[cs]e|copying|ofl|unlicen[cs]e)/i;
const noticeDirectory = /^(?:licen[cs]es|notices|legal)$/i;
const fontExtension = /\.(?:woff2?|ttf|otf|eot)$/i;

function portable(path) {
  return path.split(sep).join('/');
}

async function packageForFile(file, cache) {
  let directory = dirname(file);
  const visited = [];
  while (directory !== dirname(directory)) {
    if (cache.has(directory)) {
      const value = cache.get(directory);
      for (const path of visited) cache.set(path, value);
      return value;
    }
    visited.push(directory);
    let json;
    try {
      json = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (json?.name && json?.version) {
      const value = { root: directory, ...json };
      for (const path of visited) cache.set(path, value);
      return value;
    }
    directory = dirname(directory);
  }
  throw new Error('A contributing bundle input has no owning package.json.');
}

async function readNotices(directory, packageRoot, result, recurse = false) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && (recurse || noticeDirectory.test(entry.name))) {
      await readNotices(path, packageRoot, result, true);
    } else if (entry.isFile() && (recurse || noticeName.test(entry.name))) {
      const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
      if (text.includes('\0') || !text.trim()) throw new Error('An upstream licence or notice file is empty or binary.');
      result.set(portable(relative(packageRoot, path)), text);
    }
  }
}

async function noticesForPackage(pkg) {
  const files = new Map();
  const directories = new Set([pkg.root]);
  for (const input of pkg.inputs) {
    let directory = dirname(input);
    while (directory !== pkg.root && directory.startsWith(pkg.root + sep)) {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const directory of [...directories].sort()) await readNotices(directory, pkg.root, files);
  const licences = [...files].filter(([path]) => licenceName.test(path.split('/').at(-1)));
  if (!licences.length) {
    const source = upstreamLicenses.find(item => item.name === pkg.name && item.version === pkg.version);
    if (!source || pkg.license !== source.license) {
      throw new Error(`Missing full licence for bundled dependency ${pkg.name}@${pkg.version}; add a verified upstream notice before building.`);
    }
    if (createHash('sha256').update(source.text).digest('hex') !== source.sha256) throw new Error(`Changed pinned upstream licence for ${pkg.name}.`);
    files.set('Verified upstream licence', source.text);
    return { files, source };
  }
  if (!licences.some(([, text]) => text.trim().length >= 100)) throw new Error(`Incomplete licence for bundled dependency ${pkg.name}@${pkg.version}.`);
  return { files };
}

function fontNames(data) {
  if (data.length < 12) throw new Error('Invalid font metadata.');
  let table;
  for (let index = 0; index < data.readUInt16BE(4); index++) {
    const offset = 12 + index * 16;
    if (data.toString('ascii', offset, offset + 4) === 'name') table = data.readUInt32BE(offset + 8);
  }
  if (table === undefined) throw new Error('Missing font copyright/licence metadata.');
  const strings = table + data.readUInt16BE(table + 4);
  const records = new Map();
  for (let index = 0; index < data.readUInt16BE(table + 2); index++) {
    const offset = table + 6 + index * 12;
    const platform = data.readUInt16BE(offset);
    const id = data.readUInt16BE(offset + 6);
    if (![0, 13, 14].includes(id)) continue;
    const start = strings + data.readUInt16BE(offset + 10);
    const bytes = Buffer.from(data.subarray(start, start + data.readUInt16BE(offset + 8)));
    const text = [0, 3].includes(platform) ? bytes.swap16().toString('utf16le') : bytes.toString('latin1');
    if (text.trim()) records.set(id, text);
  }
  return records;
}

async function fontNotices(css, packages, bundledFonts) {
  const references = new Map();
  postcss.parse(css).walkAtRules('font-face', rule => {
    const declarations = Object.fromEntries((rule.nodes ?? []).filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    for (const match of (declarations.src ?? '').matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g)) {
      const url = match[1] ?? match[2] ?? match[3];
      if (url.startsWith('data:')) {
        const family = (declarations['font-family'] ?? '').replace(/["']/g, '').trim();
        const bold = Number(declarations['font-weight']) >= 600;
        const italic = declarations['font-style'] === 'italic';
        const variant = bold ? (italic ? 'BoldItalic' : 'Bold') : (italic ? 'Italic' : 'Regular');
        if (!bundledFonts.some(file => file.split(sep).at(-1).replace(/\.(?:woff2?|ttf)$/, '') === `${family}-${variant}`)) {
          throw new Error(`Embedded font ${family} has no accounted bundle input or font-specific licence.`);
        }
        continue;
      }
      if (!url.startsWith('https://cdn.openai.com/common/fonts/katex/')) throw new Error(`Unaccounted font reference in shipped CSS (${declarations['font-family']}); verify its font-specific licence.`);
      const name = new URL(url).pathname.split('/').at(-1);
      if (!/^KaTeX_[A-Za-z0-9]+-(?:Regular|Bold|Italic|BoldItalic)\.woff2$/.test(name)) throw new Error('Unknown SDK KaTeX font reference.');
      references.set(name, url);
    }
  });
  for (const file of bundledFonts) {
    if (!/^KaTeX_[A-Za-z0-9]+-(?:Regular|Bold|Italic|BoldItalic)\.(?:woff2?|ttf)$/.test(file.split(sep).at(-1))) {
      throw new Error('A bundled font has no verified font-specific notice; add its upstream copyright/licence before building.');
    }
  }
  if (!references.size && !bundledFonts.length) return { text: '', referenceCount: 0, bundledCount: 0 };
  const katex = [...packages.values()].find(pkg => pkg.name === 'katex');
  if (!katex) throw new Error('The SDK font references have no installed KaTeX release for attribution.');
  const names = new Set([...references.keys(), ...bundledFonts.map(file => file.split(sep).at(-1))].map(name => name.replace(/\.(?:woff2?|ttf)$/, '.ttf')));
  const notices = new Set();
  for (const name of [...names].sort()) {
    const metadata = fontNames(await readFile(resolve(katex.root, 'dist/fonts', name)));
    const licence = metadata.get(13);
    if (!metadata.get(0) || !licence?.includes('SIL Open Font License, Version 1.1') || !licence.includes('Reserved Font Name')) {
      throw new Error(`Missing or changed font-specific licence metadata for ${name}.`);
    }
    notices.add(licence);
  }
  const lines = [
    'FONT REFERENCES AND FONT-SPECIFIC NOTICES',
    `Corresponding font attribution comes from katex@${katex.version}'s installed font metadata.`,
    `Font files bundled by esbuild: ${bundledFonts.length}.`,
    `External font URLs referenced by the shipped SDK CSS: ${references.size}.`,
    'The CDN references are external resources, not embedded font bytes. Their CDN revision is not pinned by the SDK stylesheet.',
    'The embedded plugin permits data: fonts only; it does not permit these remote font loads.',
    '',
    ...[...references].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, url]) => `${name}: ${url}`),
    '',
    ...[...notices].sort().flatMap(notice => [notice, '']),
    'Full licence governing the font-specific notices above:',
    'Source: https://openfontlicense.org/documents/OFL.txt',
    '',
    openFontLicense.trimEnd(),
    '',
  ];
  return { text: lines.join('\n'), referenceCount: references.size, bundledCount: bundledFonts.length };
}

/** Generate complete notices from actual esbuild output contributions, offline. */
export async function collectBundleLicenses({ bundles, css = '', root = process.cwd() }) {
  root = resolve(root);
  if (!bundles?.length || bundles.some(bundle => !bundle.metafile?.outputs)) throw new Error('Licence generation requires the UI and server esbuild metafiles.');
  const packages = new Map();
  const packageCache = new Map();
  const bundledFonts = new Set();
  for (const bundle of bundles) {
    const included = new Set();
    for (const output of Object.values(bundle.metafile.outputs)) {
      for (const [input, contribution] of Object.entries(output.inputs)) if (contribution.bytesInOutput > 0) included.add(input);
    }
    for (const input of included) {
      const file = resolve(root, input);
      const pkg = await packageForFile(file, packageCache);
      if (pkg.root === root) continue;
      const key = pkg.root;
      if (!packages.has(key)) packages.set(key, { ...pkg, inputs: new Set(), bundles: new Set() });
      packages.get(key).inputs.add(file);
      packages.get(key).bundles.add(bundle.name);
      if (fontExtension.test(extname(file))) bundledFonts.add(file);
    }
  }
  const lines = [
    'THIRD-PARTY COPYRIGHT AND LICENCE NOTICES',
    'Generated from the dependencies contributing bytes to the UI/server esbuild bundles.',
    'Includes dependency licence/NOTICE files, retained vendor legal comments and font-specific notices.',
    'Build tools which do not contribute distributed code are not included.',
    'Upstream text is preserved; package identifiers, paths and public sources identify its scope.',
    '',
  ];
  const ordered = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  for (const pkg of ordered) {
    const { files, source } = await noticesForPackage(pkg);
    const licence = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'not declared');
    if (/UNLICENSED/i.test(licence)) throw new Error(`Bundled package ${pkg.name}@${pkg.version} declares no redistribution licence.`);
    lines.push('='.repeat(78), `${pkg.name}@${pkg.version}`, `Declared licence: ${licence}`, `Bundled in: ${[...pkg.bundles].sort().join(', ')}`);
    if (source) lines.push(`Verified upstream source: ${source.source}`, `Notice SHA-256: ${source.sha256}`, ...(source.note ? [source.note] : []));
    for (const [file, text] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) lines.push('', `--- ${file} ---`, '', text.trimEnd());
    lines.push('');
  }
  for (const bundle of bundles) {
    if (!bundle.legalComments?.trim()) continue;
    lines.push('='.repeat(78), `RETAINED VENDOR LEGAL COMMENTS (${bundle.name})`, '', bundle.legalComments.trimEnd(), '');
  }
  const fonts = await fontNotices(css, packages, [...bundledFonts]);
  if (fonts.text) lines.push('='.repeat(78), fonts.text);
  const text = lines.join('\n') + '\n';
  if (text.includes(root) || /(?:\/Users\/[^\s/]+\/|\/home\/[^\s/]+\/|[A-Za-z]:\\Users\\)/.test(text)) throw new Error('A licence notice contains a private absolute path; inspect its source before distribution.');
  return { text, packageCount: packages.size, referencedFontCount: fonts.referenceCount, bundledFontCount: fonts.bundledCount };
}
