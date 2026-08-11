/* build-www.js — 配信対象のファイルを www/ へ集める。
 *
 * GitHub Pages はリポジトリ直下を配信しているので、その配置は変えたくない。
 * 一方 Capacitor は webDir にアプリの中身だけが入っていることを前提にするため、
 * ここで必要なものだけを www/ へコピーしている。
 *
 *   node scripts/build-www.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

/* sw.js は意図的に含めない。
 * ネイティブでは WebView がローカルから直接読むので Service Worker は不要で、
 * むしろ古いキャッシュを返して更新が端末に届かなくなる事故のもとになる。 */
const ITEMS = [
  'index.html',
  'manifest.webmanifest',
  'css',
  'js',
  'data',
  'icons'
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let copied = 0;
for (const item of ITEMS) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) {
    console.error(`  見つかりません: ${item}`);
    process.exitCode = 1;
    continue;
  }
  fs.cpSync(src, path.join(out, item), { recursive: true });
  copied++;
  console.log(`  ${item}`);
}

console.log(`www/ に ${copied} 項目をコピーしました`);
