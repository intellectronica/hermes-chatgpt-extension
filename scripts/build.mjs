import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/web/main.tsx'],
  bundle: true,
  write: false,
  outdir: 'dist/web',
  format: 'iife',
  platform: 'browser',
  conditions: ['browser', 'style', 'import'],
  target: ['chrome120'],
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl', '.svg': 'dataurl' },
});
const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
if (!js) throw new Error('The UI build did not produce JavaScript.');
const compiled = await postcss([tailwind({ base: process.cwd(), optimize: true })]).process(css, { from: resolve('src/web/styles.css') });
const template = await readFile('src/web/index.html', 'utf8');
const html = template
  .replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/g, '')
  .replace('</head>', () => `<style>${compiled.css.replaceAll('</style', '<\\/style')}</style></head>`)
  .replace('</body>', () => `<script>${js.replaceAll('</script', '<\\/script')}</script></body>`);
// Replacement strings treat vendor code's $&/$' sequences as template directives.
// Parse the final HTML and validate its actual script, catching broken inline bundling.
const document = new JSDOM(html).window.document;
if (document.scripts.length !== 1 || document.scripts[0].src) throw new Error('The UI must contain one self-contained script.');
new Script(document.scripts[0].textContent ?? '', { filename: 'ui.html' });
await writeFile('dist/ui.html', html);
await build({
  entryPoints: ['src/bridge/main.ts'],
  bundle: true,
  outfile: 'dist/server.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  minify: false,
});
process.stdout.write(`Built the bridge and single-file UI (${Math.round(Buffer.byteLength(html) / 1024)} KiB).\n`);
