/* japan.js — 日本地図のシルエットを SVG パスに変換する。
 *
 * 座標は data/japan.json が唯一の出処。アプリの背景と tools/make-icons.ps1 の
 * アイコン生成が同じファイルを読むので、地図を直したい場合はそちらだけ触ればよい。
 */
(function (global) {
  'use strict';

  var cache = null;
  var pending = null;

  function load() {
    if (cache) return Promise.resolve(cache);
    if (pending) return pending;
    pending = fetch('data/japan.json')
      .then(function (r) {
        if (!r.ok) throw new Error('地図データを読めませんでした');
        return r.json();
      })
      .then(function (j) { cache = j; pending = null; return j; });
    return pending;
  }

  /* 等距円筒図法。日本の緯度帯だけを描くので、経度に cos(基準緯度) を掛けて
   * 横の縮みを合わせれば、見た目には十分な形になる。 */
  function project(data) {
    var k = Math.cos((data.lat0 || 38) * Math.PI / 180);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    var rings = data.islands.map(function (island) {
      return island.ring.map(function (p) {
        var x = p[0] * k;
        var y = -p[1];                 // 北を上にするので緯度は符号を反転する
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        return [x, y];
      });
    });

    return {
      rings: rings,
      minX: minX, minY: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /* 指定した幅に収まる SVG のパスと viewBox を作る */
  function toSvg(data, width) {
    var p = project(data);
    var scale = width / p.width;
    var height = p.height * scale;

    var d = p.rings.map(function (ring) {
      var parts = ring.map(function (pt, i) {
        var x = (pt[0] - p.minX) * scale;
        var y = (pt[1] - p.minY) * scale;
        return (i === 0 ? 'M' : 'L') + round(x) + ' ' + round(y);
      });
      return parts.join('') + 'Z';
    }).join('');

    return {
      d: d,
      width: width,
      height: height,
      viewBox: '0 0 ' + round(width) + ' ' + round(height)
    };
  }

  function round(n) { return Math.round(n * 100) / 100; }

  global.CP = global.CP || {};
  global.CP.japan = {
    load: load,
    project: project,
    toSvg: toSvg
  };
})(this);
