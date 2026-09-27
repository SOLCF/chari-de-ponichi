/* make-card.js — 贈呈カード(印刷用HTML)を組み立てる。
 *
 *   node tools/card/make-card.js
 *   → tools/card/gift-card.html
 *
 * QRコードは tools/card/qr.svg を読んで HTML に直接埋め込む。
 * 外部ファイルを参照しないので、この1ファイルだけ持ち歩けばどこでも印刷できる。
 *
 * QRを作り直すとき（配布URLが変わったときだけ必要）:
 *   npx -y qrcode@1 -t svg -e M -o tools/card/qr.svg "<URL>"
 */
'use strict';

const fs = require('fs');
const path = require('path');

const here = __dirname;

// ---- ここを書き換えれば刷り直せる --------------------------------------
const CARD = {
  appName: 'チャリでポンイチ',
  tagline: '日本一周から、その先へ。',
  message: [
    'いつも走っているあなたに。',
    'これからは、その距離が旅になります。'
  ],
  credits: [
    ['原案', 'Daïsuké K.', '〈Le Randonneur〉'],
    ['製作', '芥川', ''],
  ],
  date: '2026年10月',
  url: 'https://github.com/SOLCF/chari-de-ponichi/releases/download/latest/app-release.apk'
};
// ------------------------------------------------------------------------

// QR は黒モジュールの path だけ取り出す。白地の矩形はカード側の背景に任せる
const qrSvg = fs.readFileSync(path.join(here, 'qr.svg'), 'utf8');
const viewBox = (qrSvg.match(/viewBox="([^"]+)"/) || [])[1];
const qrPaths = (qrSvg.match(/<path[^>]*>/g) || [])
  .filter(p => p.includes('stroke='))
  .join('');

if (!viewBox || !qrPaths) {
  console.error('qr.svg を読めませんでした。先に QR を生成してください。');
  process.exit(1);
}

const creditRows = CARD.credits.map(([label, name, alias]) => `
        <div class="credit-row">
          <span class="credit-label">${label}</span>
          <span class="credit-value">${name}${alias ? ` <em>${alias}</em>` : ''}</span>
        </div>`).join('');

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${CARD.appName} — 贈呈カード</title>
<style>
  /* A4 に A5 のカードを1枚。家庭用プリンタでそのまま刷れる。
     切り取り線に沿って切ると A5 のカードになる */
  @page { size: A4 portrait; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
    background: #d8d4cc;
    display: flex;
    justify-content: center;
    padding: 20px;
    color: #1d2430;
  }

  .sheet {
    width: 210mm;
    height: 297mm;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 切り取り線。印刷したとき薄く出る程度にとどめる */
  .card {
    width: 148mm;
    height: 210mm;
    border: 1px dashed #c9c2b4;
    background: linear-gradient(160deg, #fdfcf7 0%, #f4efe3 100%);
    padding: 12mm 13mm;
    display: flex;
    flex-direction: column;
    text-align: center;
  }

  .icon { width: 26mm; height: 26mm; margin: 0 auto; border-radius: 6mm; }

  .app-name {
    font-size: 24pt;
    font-weight: 700;
    letter-spacing: .06em;
    margin-top: 6mm;
  }
  .tagline { font-size: 10pt; color: #6b6558; margin-top: 2mm; letter-spacing: .04em; }

  .rule { border: 0; border-top: 1px solid #ded7c8; margin: 5mm 0; }

  .story { font-size: 10.5pt; line-height: 1.95; color: #3a4150; }
  .story b { font-weight: 700; }

  .message {
    font-size: 11pt;
    line-height: 2.0;
    margin-top: 5mm;
    color: #1d2430;
  }

  /* margin-top:auto で QR とクレジットをカードの下端に寄せる。
     余白は中ほどに集まり、下がきちんと揃う */
  .install {
    display: flex;
    gap: 6mm;
    align-items: center;
    text-align: left;
    margin-top: auto;
    padding-top: 4mm;
  }
  .qr { width: 30mm; height: 30mm; flex: none; }
  .qr rect { fill: #fff; }
  .qr path { stroke: #1d2430; }

  .steps { font-size: 8.5pt; line-height: 1.85; color: #3a4150; }
  .steps b { display: block; font-size: 9.5pt; margin-bottom: 1.5mm; }
  .steps ol { margin: 0; padding-left: 1.2em; }

  .credits {
    margin-top: 5mm;
    padding-top: 4mm;
    border-top: 1px solid #ded7c8;
    display: inline-block;
    text-align: left;
    align-self: center;
  }
  .credit-row { display: flex; gap: 5mm; align-items: baseline; margin-bottom: 1.5mm; }
  .credit-label {
    font-size: 7.5pt; color: #6b6558; letter-spacing: .16em; width: 7mm; flex: none;
  }
  .credit-value { font-size: 12pt; }
  .credit-value em { font-size: 8pt; color: #6b6558; font-style: normal; }
  .date { font-size: 8.5pt; color: #6b6558; margin-top: 2.5mm; padding-left: 12mm; }

  @media print {
    body { background: #fff; padding: 0; display: block; }
    .sheet { width: auto; height: auto; }
    .card { border-color: #e4ded1; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="card">
      <img class="icon" src="../../icons/icon-512.png" alt="">

      <div class="app-name">${CARD.appName}</div>
      <div class="tagline">${CARD.tagline}</div>

      <hr class="rule">

      <div class="story">
        自転車で、日本を一周する。<br>
        <b>12,000 km</b> を走りきったら、次は世界一周。<br>
        その次は月、火星、そして <b>1光年</b>。
      </div>

      <div class="message">
        ${CARD.message.join('<br>')}
      </div>

      <hr class="rule">

      <div class="install">
        <svg class="qr" viewBox="${viewBox}" shape-rendering="crispEdges">${qrPaths}</svg>
        <div class="steps">
          <b>入れかた</b>
          <ol>
            <li>スマホのカメラでQRを読む</li>
            <li>ダウンロードしたファイルを開く</li>
            <li>「提供元不明のアプリ」を許可する</li>
          </ol>
        </div>
      </div>

      <div class="credits">
${creditRows}
        <div class="date">${CARD.date}</div>
      </div>
    </div>
  </div>
</body>
</html>
`;

const out = path.join(here, 'gift-card.html');
fs.writeFileSync(out, html, 'utf8');
console.log('書き出しました: ' + path.relative(path.join(here, '..', '..'), out));
console.log('ブラウザで開いて Ctrl+P → 「背景のグラフィック」を有効にして印刷してください。');
