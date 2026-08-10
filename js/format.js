/* format.js — 表示用の書式化。純粋関数のみ。 */
(function (global) {
  'use strict';

  /* 距離(km)を読みやすい文字列にする。
   * 桁が大きくなると 12,345,678 km では読めないので 万・億・兆 に切り替える。 */
  function km(v) {
    if (!isFinite(v)) return '0';
    if (v < 10) return trim(v.toFixed(2));
    if (v < 1000) return trim(v.toFixed(1));
    if (v < 100000) return Math.round(v).toLocaleString('ja-JP');
    return bigJa(Math.round(v));
  }

  /* 万・億・兆で丸める。上位2単位まで出す（例: 9兆4607億 / 38万4400） */
  function bigJa(n) {
    var units = [[1e12, '兆'], [1e8, '億'], [1e4, '万']];
    for (var i = 0; i < units.length; i++) {
      var size = units[i][0], name = units[i][1];
      if (n >= size) {
        var hi = Math.floor(n / size);
        var lo = Math.floor(n % size);
        var s = hi.toLocaleString('ja-JP') + name;
        if (lo > 0 && i < units.length - 1) {
          var next = units[i + 1];
          var mid = Math.floor(lo / next[0]);
          if (mid > 0) s += mid.toLocaleString('ja-JP') + next[1];
        } else if (lo > 0 && i === units.length - 1) {
          s += lo.toLocaleString('ja-JP');
        }
        return s;
      }
    }
    return n.toLocaleString('ja-JP');
  }

  /* 走行中の細かい距離。1km未満はメートル表示の方が動きが見えて楽しい */
  function shortDistance(meters) {
    if (meters < 1000) return { value: String(Math.round(meters)), unit: 'm' };
    return { value: trim((meters / 1000).toFixed(2)), unit: 'km' };
  }

  function duration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  function durationJa(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + '時間' + m + '分';
    if (m > 0) return m + '分';
    return sec + '秒';
  }

  function speed(kmh) {
    if (kmh == null || !isFinite(kmh)) return '--';
    return trim(Math.max(0, kmh).toFixed(1));
  }

  function date(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function dateTime(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + pad(d.getMinutes());
  }

  function ym(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  }

  /* 残り距離とペースから到達時期を見積もる。
   * 月より先はとんでもない数字になるが、それも含めて楽しむための表示 */
  function eta(remainKm, kmPerDay) {
    if (!(kmPerDay > 0)) return 'ペース計測中';
    var days = remainKm / kmPerDay;
    if (days < 1) return 'あと1日たらず';
    if (days < 60) return 'あと約' + Math.ceil(days) + '日';
    var months = days / 30.44;
    if (months < 24) return 'あと約' + Math.round(months) + 'か月';
    var years = days / 365.25;
    if (years < 10000) return 'あと約' + Math.round(years).toLocaleString('ja-JP') + '年';
    return 'あと約' + bigJa(Math.round(years)) + '年';
  }

  /* 進捗の百分率。1光年の章では 1.41e-11% のような指数表記になってしまうので、
   * 桁に応じて小数点以下を伸ばし、それでも表せない小ささは「未満」で丸める。 */
  function pct(v) {
    if (!isFinite(v) || v <= 0) return '0%';
    if (v >= 10) return v.toFixed(1) + '%';
    if (v >= 1) return v.toFixed(2) + '%';
    if (v >= 0.01) return v.toFixed(3) + '%';
    if (v >= 0.0001) return v.toFixed(5) + '%';
    return '0.0001%未満';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // 12.30 → 12.3、12.00 → 12 のように末尾の 0 を落とす
  function trim(s) {
    if (s.indexOf('.') < 0) return s;
    return s.replace(/\.?0+$/, '');
  }

  global.CP = global.CP || {};
  global.CP.fmt = {
    km: km,
    bigJa: bigJa,
    shortDistance: shortDistance,
    pct: pct,
    duration: duration,
    durationJa: durationJa,
    speed: speed,
    date: date,
    dateTime: dateTime,
    ym: ym,
    eta: eta
  };
})(this);
