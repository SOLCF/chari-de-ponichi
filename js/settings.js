/* settings.js — 設定のデフォルト値・制約・読み書き。
 *
 * しきい値をコードに直書きせず、すべてここに集約する。
 * tracker.js は毎回 CP.settings.get() を読むので、変更は即座に測位ループへ反映される。
 */
(function (global) {
  'use strict';

  var KEY = 'chari-pon-ichi:settings:v1';

  var DEFAULTS = {
    intervalSec: 15,        // GPS取得間隔
    maxSpeedKmh: 60,        // これを超える移動はGPSの飛びとして破棄
    minSpeedKmh: 1.5,       // これ未満は停止中として加算しない
    maxAccuracyM: 30,       // これより粗い測位点は捨てる
    gapResetSec: 300,       // これ以上の空白は「計測中断」とみなし基準点を置き直す
    highAccuracy: true,     // enableHighAccuracy
    keepAwake: true,        // 走行中に画面を点灯維持する
    theme: 'dark',          // 'dark' | 'light' | 'auto'
    goalOverrides: {}       // {章id: km} 目標距離の上書き。goals.js が比例でマイルストーンも伸縮させる
  };

  // 設定画面のスライダー範囲とプリセット。UI はこの定義から自動生成する
  var SPEC = {
    intervalSec: {
      label: 'GPS取得間隔',
      unit: '秒',
      min: 5, max: 300, step: 1, log: true,
      help: '短いほど正確ですが電池を消費します。長いと曲がり角をショートカットして距離が短めに出ます。',
      presets: [
        { label: '5秒 / 最も正確', value: 5 },
        { label: '15秒 / 標準', value: 15 },
        { label: '30秒 / 省エネ', value: 30 },
        { label: '60秒 / 最省エネ', value: 60 }
      ]
    },
    maxSpeedKmh: {
      label: '上限速度',
      unit: 'km/h',
      min: 20, max: 1000, step: 1, log: true,
      help: 'これを超える移動はGPSの飛びとみなして捨てます。下り坂で高速に出るなら上げてください。1000にすると実質フィルタなしとなり、飛行機の移動まで距離に乗ります。',
      presets: [
        { label: 'ママチャリ 40', value: 40 },
        { label: '標準 60', value: 60 },
        { label: 'ロード 80', value: 80 },
        { label: '新幹線 320', value: 320 },
        { label: 'なんでもあり 1000', value: 1000 }
      ]
    },
    minSpeedKmh: {
      label: '下限速度',
      unit: 'km/h',
      min: 0, max: 10, step: 0.1, log: false,
      help: 'これ未満は停止中とみなして加算しません。0にすると信号待ちのGPSのふらつきまで距離に乗ります。',
      presets: [
        { label: '押し歩きも含める 0.5', value: 0.5 },
        { label: '標準 1.5', value: 1.5 },
        { label: '厳しめ 3.0', value: 3 }
      ]
    },
    maxAccuracyM: {
      label: '精度しきい値',
      unit: 'm',
      min: 5, max: 100, step: 1, log: false,
      help: 'これより粗い測位点を捨てます。厳しくしすぎるとビル街や林道で測位が通らず距離が欠けます。',
      presets: [
        { label: '厳しい 15', value: 15 },
        { label: '標準 30', value: 30 },
        { label: 'ゆるい 60', value: 60 }
      ]
    },
    gapResetSec: {
      label: '中断とみなす時間',
      unit: '秒',
      min: 60, max: 1800, step: 10, log: false,
      help: 'この時間を超えて測位が途切れたら、間の移動は距離に加算せず現在地を基準点として計測を再開します。',
      presets: [
        { label: '1分', value: 60 },
        { label: '5分', value: 300 },
        { label: '15分', value: 900 }
      ]
    }
  };

  var cache = null;

  function clampOne(key, value) {
    var spec = SPEC[key];
    if (!spec) return value;
    var n = Number(value);
    if (!isFinite(n)) return DEFAULTS[key];
    return Math.min(spec.max, Math.max(spec.min, n));
  }

  function normalize(raw) {
    var out = {};
    for (var k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      var v = (raw && raw[k] !== undefined) ? raw[k] : DEFAULTS[k];
      out[k] = (typeof DEFAULTS[k] === 'number') ? clampOne(k, v) : v;
    }
    return out;
  }

  function get() {
    if (cache) return cache;
    var raw = null;
    try {
      var s = global.localStorage.getItem(KEY);
      if (s) raw = JSON.parse(s);
    } catch (e) {
      // 壊れた設定でアプリごと落とさない。既定値で続行する
      console.warn('設定の読み込みに失敗しました。既定値を使います', e);
    }
    cache = normalize(raw);
    return cache;
  }

  function set(key, value) {
    var s = get();
    s[key] = (typeof DEFAULTS[key] === 'number') ? clampOne(key, value) : value;
    persist(s);
    return s[key];
  }

  function replaceAll(obj) {
    cache = normalize(obj);
    persist(cache);
    return cache;
  }

  function reset() {
    return replaceAll(null);
  }

  function persist(s) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      console.warn('設定の保存に失敗しました', e);
    }
  }

  /* tracker.js / geo.js が期待するフィルタ設定の形に切り出す */
  function filters() {
    var s = get();
    return {
      maxAccuracyM: s.maxAccuracyM,
      minSpeedKmh: s.minSpeedKmh,
      maxSpeedKmh: s.maxSpeedKmh,
      gapResetSec: s.gapResetSec
    };
  }

  global.CP = global.CP || {};
  global.CP.settings = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    SPEC: SPEC,
    get: get,
    set: set,
    replaceAll: replaceAll,
    reset: reset,
    filters: filters
  };
})(this);
