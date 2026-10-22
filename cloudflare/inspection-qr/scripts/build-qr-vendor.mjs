import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { build } = wranglerRequire('esbuild');
const result = await build({ entryPoints: [require.resolve('qrcode/lib/browser.js')], bundle: true, minify: true, platform: 'browser', format: 'iife', globalName: 'BazQrEncoder', write: false });
const license = await readFile(require.resolve('qrcode/license'), 'utf8');
await writeFile(new URL('../../../js/vendor/qrcode-1.5.4.min.js', import.meta.url), '/*! qrcode 1.5.4 (MIT). See qrcode-LICENSE.txt */\n' + result.outputFiles[0].text);
await writeFile(new URL('../../../js/vendor/qrcode-LICENSE.txt', import.meta.url), license);
