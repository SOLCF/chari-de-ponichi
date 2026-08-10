/* geo.js — 距離計算と測位点フィルタ。
 *
 * このファイルは純粋関数のみで構成する。GPS・DOM・localStorage には一切触らない。
 * test/geo.test.html がこの前提（同じ入力なら必ず同じ出力）で検証しているので、
 * 副作用をここに持ち込まないこと。
 */
(function (global) {
  'use strict';

  // 地球の平均半径 (m)。IUGG の平均半径 R1
  var EARTH_R = 6371008.8;

  // ノイズ判定の下限 (m)。accuracy を 0 や極端に小さく報告する端末があるため、
  // これ未満のしきい値にはしない
  var NOISE_FLOOR_MIN_M = 5;

  function toRad(deg) { return deg * Math.PI / 180; }

  /* 2点間の大円距離をメートルで返す（Haversine）。
   * pt は {lat, lon} を持つオブジェクト。 */
  function haversine(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLon = toRad(b.lon - a.lon);
    var la1 = toRad(a.lat);
    var la2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* 測位点の採否を判定する。
   *
   * anchor: 直前に「採用した」点 {lat, lon, acc, t}。t はミリ秒。初回は null。
   * cur   : 今回の点 {lat, lon, acc, t}
   * f     : フィルタ設定 {maxAccuracyM, minSpeedKmh, maxSpeedKmh, gapResetSec}
   *
   * 戻り値 {accept, addMeters, speedKmh, reason, newAnchor}
   *   accept    … この点を新しい anchor として採用するか
   *   addMeters … 総距離に加算すべきメートル数（棄却時は 0）
   *   reason    … 判定理由。UI のデバッグ表示とテストで使う
   *   newAnchor … true なら anchor を cur に進める。false なら anchor を据え置く
   *
   * 【anchor を据え置く設計について】
   * ノイズ・停止として棄却したとき anchor を進めないのが重要。据え置くことで、
   * ゆっくり進んだ分の変位が anchor から累積し、いずれしきい値を超えて
   * まとめて加算される。つまり低速走行でも距離を取りこぼさない。
   * 逆に本当に静止しているなら変位は伸びず d/Δt が 0 に収束するので、
   * いつまでも棄却され続けてドリフトが乗らない。
   */
  function evaluate(anchor, cur, f) {
    // 粗すぎる測位点は問答無用で捨てる。anchor も動かさない
    if (cur.acc != null && cur.acc > f.maxAccuracyM) {
      return res(false, 0, null, 'accuracy', false);
    }

    // 初回、または前回から離れすぎた時刻の点は距離を出さずに基準点だけ置き直す
    if (!anchor) {
      return res(true, 0, null, 'first', true);
    }

    var dtSec = (cur.t - anchor.t) / 1000;

    // 時刻が巻き戻っている／同時刻。端末時計の補正などで起こりうる
    if (dtSec <= 0) {
      return res(false, 0, null, 'time', false);
    }

    // 長時間の空白 = アプリがバックグラウンドに落ちていた等。
    // ここで基準点を置き直さないと、遠く離れた現在地が延々 jump 判定され続けて
    // 復帰できなくなる（デッドロック）。距離は加算せず基準だけ現在地へ移す。
    if (dtSec > f.gapResetSec) {
      return res(true, 0, null, 'gap', true);
    }

    var d = haversine(anchor, cur);

    // 測位誤差の範囲内の動きはノイズとみなす。
    //
    // しきい値に「大きい方の accuracy」ではなく「両点の accuracy の和」を使う。
    // 見ているのは2つの測位値の差であり、その不確かさは片方の誤差より大きいため。
    // 実際、精度10mの端末が静止していても両点が逆方向に振れれば20m近く離れて見える。
    // 最大値を使うと、この程度のドリフトが素通りして停車中に距離が増えてしまう。
    var noiseFloor = Math.max(NOISE_FLOOR_MIN_M, (anchor.acc || 0) + (cur.acc || 0));
    if (d < noiseFloor) {
      return res(false, 0, 0, 'noise', false);
    }

    var speedKmh = (d / dtSec) * 3.6;

    // 上限超え = GPS の飛び。点そのものが信用できないので基準点も動かさない
    if (speedKmh > f.maxSpeedKmh) {
      return res(false, 0, speedKmh, 'jump', false);
    }

    // 下限未満 = 停止中とみなして加算しない。基準点は据え置く（上の説明を参照）
    if (speedKmh < f.minSpeedKmh) {
      return res(false, 0, speedKmh, 'stationary', false);
    }

    return res(true, d, speedKmh, 'ok', true);
  }

  function res(accept, addMeters, speedKmh, reason, newAnchor) {
    return {
      accept: accept,
      addMeters: addMeters,
      speedKmh: speedKmh,
      reason: reason,
      newAnchor: newAnchor
    };
  }

  /* 測位点の列をまとめて処理して合計距離(m)と内訳を返す。
   * 実走ログの再計算とテストで使う。points は時刻順の {lat,lon,acc,t} 配列。 */
  function reduceTrack(points, f) {
    var anchor = null;
    var total = 0;
    var counts = { ok: 0, first: 0, gap: 0, noise: 0, jump: 0, stationary: 0, accuracy: 0, time: 0 };

    for (var i = 0; i < points.length; i++) {
      var r = evaluate(anchor, points[i], f);
      counts[r.reason] = (counts[r.reason] || 0) + 1;
      total += r.addMeters;
      if (r.newAnchor) anchor = points[i];
    }
    return { meters: total, counts: counts, anchor: anchor };
  }

  /* 判定理由を日本語ラベルにする（UI のGPSステータス表示用） */
  var REASON_LABEL = {
    ok: '計測中',
    first: '基準点を取得',
    gap: '計測が中断していました',
    noise: '誤差の範囲（停止中）',
    jump: 'GPSの飛びを除外',
    stationary: '停止中',
    accuracy: '測位精度が不足',
    time: '時刻異常'
  };

  global.CP = global.CP || {};
  global.CP.geo = {
    EARTH_R: EARTH_R,
    NOISE_FLOOR_MIN_M: NOISE_FLOOR_MIN_M,
    haversine: haversine,
    evaluate: evaluate,
    reduceTrack: reduceTrack,
    REASON_LABEL: REASON_LABEL
  };
})(this);
