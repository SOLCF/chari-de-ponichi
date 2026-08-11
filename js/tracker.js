/* tracker.js — GPS測位ループと距離の積算。
 *
 * 【重要】位置情報 API を触るのはこのファイルだけに閉じる。
 * 他のファイルから navigator.geolocation を直接呼ばないこと。
 * 将来 Capacitor でネイティブ化するとき、差し替えるのはここだけで済むようにする。
 */
(function (global) {
  'use strict';

  var geo = null;      // 起動時に CP.geo を解決する
  var settings = null;
  var store = null;

  // watchPosition と getCurrentPosition を切り替えるしきい値。
  // これ以下の間隔なら GPS を回しっぱなしにした方がむしろ効率が良い
  // （毎回起動し直すと初回測位のたびに電力を食うため）
  var CONTINUOUS_MAX_SEC = 10;

  // ネイティブ時、この距離だけ動くまで OS 側が通知を上げない。
  // 静止中の測位を丸ごと省けるので電池に効く。
  // ノイズ判定のしきい値（両点の精度の和＝おおむね20〜40m）より小さくしてあるので、
  // 距離計算に使えたはずの点を取りこぼすことはない
  var NATIVE_DISTANCE_FILTER_M = 10;

  var state = {
    status: 'idle',      // idle | acquiring | tracking
    sessionMeters: 0,
    elapsedSec: 0,
    movingSec: 0,
    speedKmh: null,
    accuracy: null,
    lastReason: null,
    lastFixAt: null,
    fixCount: 0,
    rejectCount: 0,
    gapNoticeSec: 0,     // 直近で検出した計測中断の長さ（UIで一度だけ知らせる）
    error: null,
    needsSettings: false,  // 権限を拒否された。端末の設定画面へ誘導する
    wakeLockActive: false
  };

  var session = null;    // 走行中のセッション
  var anchor = null;     // 直前に採用した測位点
  var watchId = null;
  var timer = null;
  var tickStartedAt = 0;
  var lastFixTime = 0;   // 直前に処理した測位点の時刻。間引きの基準（実時間ではない）
  var wakeLock = null;
  var listeners = [];
  var uiTimer = null;
  var nativeWatchId = null;
  var nativeWatchToken = 0;

  /* ---------- 公開 API ---------- */

  function init() {
    geo = global.CP.geo;
    settings = global.CP.settings;
    store = global.CP.store;

    // 画面が戻ってきたら Wake Lock を取り直す（OSが自動で解放するため）
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible' && state.status === 'tracking') {
        requestWakeLock();
        // バックグラウンドに落ちている間、測位ループのタイマーも止まっている。
        // 復帰したら即座に測り直す。
        // ネイティブでは前面サービスが動き続けているので、やり直す必要はない
        if (!isNative() && isDutyCycleMode()) armTimer(0);
      }
    });
  }

  /* ---------- 実行環境 ---------- */

  /* Capacitor でネイティブとして動いているか。
   * ネイティブではブリッジが自動で注入されるので、バンドラを使わずに
   * window.Capacitor.Plugins からプラグインを直接叩ける */
  function isNative() {
    return !!(global.Capacitor &&
              typeof global.Capacitor.isNativePlatform === 'function' &&
              global.Capacitor.isNativePlatform());
  }

  function nativePlugin() {
    return (global.Capacitor && global.Capacitor.Plugins &&
            global.Capacitor.Plugins.BackgroundGeolocation) || null;
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function getState() { return state; }

  function isSupported() {
    if (isNative()) return !!nativePlugin();
    return !!(global.navigator && global.navigator.geolocation);
  }

  function start() {
    if (state.status !== 'idle') return;
    if (!isSupported()) {
      state.error = 'この端末では位置情報が使えません';
      emit();
      return;
    }

    session = {
      id: 's' + Date.now(),
      startedAt: Date.now(),
      endedAt: null,
      meters: 0,
      elapsedSec: 0,
      movingSec: 0,
      points: 0
    };

    anchor = null;
    lastFixTime = 0;
    state.status = 'acquiring';
    state.sessionMeters = 0;
    state.elapsedSec = 0;
    state.movingSec = 0;
    state.speedKmh = null;
    state.accuracy = null;
    state.lastReason = null;
    state.lastFixAt = null;
    state.fixCount = 0;
    state.rejectCount = 0;
    state.gapNoticeSec = 0;
    state.error = null;
    state.needsSettings = false;

    startPositioning();
    requestWakeLock();

    // 経過時間の表示を毎秒進める
    uiTimer = global.setInterval(function () {
      if (!session) return;
      state.elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
      emit();
    }, 1000);

    emit();
  }

  function stop() {
    if (state.status === 'idle') return;

    stopPositioning();
    releaseWakeLock();
    if (uiTimer) { global.clearInterval(uiTimer); uiTimer = null; }

    if (session) {
      session.endedAt = Date.now();
      session.elapsedSec = Math.floor((session.endedAt - session.startedAt) / 1000);
      session.meters = state.sessionMeters;
      session.movingSec = state.movingSec;
      // 1m も進まなかったセッションは履歴を汚すだけなので残さない
      if (session.meters >= 1) {
        store.putSession(session);
      } else {
        store.deleteSession(session.id);
      }
    }

    session = null;
    anchor = null;
    state.status = 'idle';
    state.speedKmh = null;
    emit();
  }

  /* 設定が変わったとき、走行を止めずに測位ループへ反映する */
  function refresh() {
    if (state.status === 'idle') return;
    stopPositioning();
    startPositioning();
    if (settings.get().keepAwake) requestWakeLock(); else releaseWakeLock();
  }

  function consumeGapNotice() {
    var s = state.gapNoticeSec;
    state.gapNoticeSec = 0;
    return s;
  }

  /* ---------- 測位ループ ---------- */

  function isDutyCycleMode() {
    return settings.get().intervalSec > CONTINUOUS_MAX_SEC;
  }

  function posOptions(timeoutMs) {
    return {
      enableHighAccuracy: settings.get().highAccuracy,
      timeout: timeoutMs,
      maximumAge: 0   // 古いキャッシュ位置は距離計算を狂わせるので必ず新規測位
    };
  }

  function startPositioning() {
    if (isNative()) {
      // ネイティブ: 前面サービスに任せる。画面が消えても止まらない
      startNative();
    } else if (isDutyCycleMode()) {
      // 間隔が長いとき: 1点取ったら GPS を解放し、次の周期まで休ませる
      armTimer(0);
    } else {
      // 間隔が短いとき: measure しっぱなしにして GPS を温かい状態に保つ。
      // 届いた点のうち、間隔に満たないものは handleFix 側で間引く
      watchId = global.navigator.geolocation.watchPosition(
        onPosition, onPositionError, posOptions(30000)
      );
    }
  }

  function stopPositioning() {
    stopNative();
    if (watchId !== null) {
      global.navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timer) { global.clearTimeout(timer); timer = null; }
  }

  /* ---------- ネイティブの測位（前面サービス） ---------- */

  function startNative() {
    var bg = nativePlugin();
    if (!bg) {
      state.error = '位置情報の機能を読み込めませんでした';
      emit();
      return;
    }

    // addWatcher の解決を待つ間に停止されることがある。
    // トークンで世代を見て、古い watcher は解決と同時に捨てる
    var token = ++nativeWatchToken;

    bg.addWatcher({
      backgroundTitle: 'チャリでポンイチ',
      backgroundMessage: '日本一周に向けて記録中',
      requestPermissions: true,
      stale: false,
      distanceFilter: NATIVE_DISTANCE_FILTER_M
    }, onNativePosition).then(function (id) {
      if (token !== nativeWatchToken) { bg.removeWatcher({ id: id }); return; }
      nativeWatchId = id;
    }).catch(function () {
      state.error = '位置情報の取得を開始できませんでした';
      emit();
    });
  }

  function stopNative() {
    nativeWatchToken++;
    var bg = nativePlugin();
    if (bg && nativeWatchId) {
      try { bg.removeWatcher({ id: nativeWatchId }); } catch (e) { /* 無視 */ }
    }
    nativeWatchId = null;
  }

  /* 端末の設定画面を開く。権限を拒否されたときの逃げ道 */
  function openLocationSettings() {
    var bg = nativePlugin();
    if (bg && bg.openSettings) bg.openSettings();
  }

  function armTimer(waitMs) {
    if (timer) global.clearTimeout(timer);
    timer = global.setTimeout(tick, Math.max(0, waitMs));
  }

  function tick() {
    timer = null;
    if (state.status === 'idle') return;
    tickStartedAt = Date.now();
    // 測位に手間取っても次の周期を潰さない程度の待ち時間を与える
    var timeoutMs = Math.min(60000, Math.max(20000, settings.get().intervalSec * 1000));
    global.navigator.geolocation.getCurrentPosition(
      function (pos) { onPosition(pos); scheduleNextTick(); },
      function (err) { onPositionError(err); scheduleNextTick(); },
      posOptions(timeoutMs)
    );
  }

  function scheduleNextTick() {
    if (state.status === 'idle' || !isDutyCycleMode()) return;
    var intervalMs = settings.get().intervalSec * 1000;
    var spent = Date.now() - tickStartedAt;
    armTimer(intervalMs - spent);
  }

  function onPosition(pos) {
    handleFix({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      acc: pos.coords.accuracy,
      // 端末がドップラー由来の速度を返すならそちらの方が正確なので表示に使う
      devSpeed: (pos.coords.speed != null && isFinite(pos.coords.speed)) ? pos.coords.speed : null,
      t: pos.timestamp || Date.now()
    }, !isDutyCycleMode());
  }

  /* プラグインからの測位。第2引数にエラーが入ることがある */
  function onNativePosition(location, err) {
    if (err) { onNativeError(err); return; }
    if (!location) return;

    handleFix({
      lat: location.latitude,
      lon: location.longitude,
      acc: location.accuracy,
      devSpeed: (location.speed != null && isFinite(location.speed)) ? location.speed : null,
      t: location.time || Date.now()
    }, true);   // プラグインは動いた分だけ次々に上げてくるので、必ず間引く
  }

  /* 測位点を1件受け取る。Web もネイティブもここへ集約し、
   * これ以降のフィルタと距離の積算（processFix）は共通のものを使う。 */
  function handleFix(fix, throttle) {
    // 設定間隔より細かく届いた点を間引く。
    // 0.8 を掛けているのは端末側の揺らぎで毎回わずかに早着するのを許すため。
    //
    // 判定に使うのは実時間ではなく測位点の時刻。
    // ネイティブではまとめて配信されることがあり、実時間で見ると
    // 同時に届いた点を1つ残して捨ててしまい、その分の距離が消える
    if (throttle && lastFixTime) {
      var intervalMs = settings.get().intervalSec * 1000;
      if ((fix.t - lastFixTime) < intervalMs * 0.8) return;
    }
    lastFixTime = fix.t;
    processFix(fix);
  }

  function processFix(fix) {
    var f = settings.filters();
    var prevAnchor = anchor;
    var r = geo.evaluate(prevAnchor, fix, f);

    state.accuracy = fix.acc;
    state.lastReason = r.reason;
    state.lastFixAt = Date.now();

    if (r.reason === 'gap' && prevAnchor) {
      state.gapNoticeSec = Math.round((fix.t - prevAnchor.t) / 1000);
    }

    if (r.addMeters > 0) {
      var dtSec = (fix.t - prevAnchor.t) / 1000;
      state.sessionMeters += r.addMeters;
      state.movingSec += dtSec;
      store.addGpsMeters(r.addMeters);

      if (session) {
        session.meters = state.sessionMeters;
        session.movingSec = state.movingSec;
        session.elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000);
        session.points += 1;
        // 測位のたびに保存する。アプリが落ちても直前までの記録が残る
        store.putSession(session);
        store.appendPoint(session.id, fix);
      }
      state.fixCount += 1;
    } else if (r.reason !== 'first' && r.reason !== 'gap') {
      state.rejectCount += 1;
    }

    // 速度表示は端末の値を優先し、無ければ区間から求めた値を使う
    if (fix.devSpeed != null) {
      state.speedKmh = fix.devSpeed * 3.6;
    } else if (r.speedKmh != null) {
      state.speedKmh = (r.reason === 'ok') ? r.speedKmh : 0;
    }

    if (r.newAnchor) anchor = fix;
    if (state.status === 'acquiring' && (r.reason === 'first' || r.reason === 'ok')) {
      state.status = 'tracking';
    }
    state.error = null;
    emit();
  }

  function onNativeError(err) {
    if (err && err.code === 'NOT_AUTHORIZED') {
      state.error = '位置情報の利用が許可されていません。設定から許可してください。';
      state.needsSettings = true;
      stop();
      return;
    }
    state.error = '位置情報の取得に失敗しました';
    emit();
  }

  function onPositionError(err) {
    if (err && err.code === 1) {          // PERMISSION_DENIED
      state.error = '位置情報の利用が許可されていません。ブラウザの設定から許可してください。';
      stop();
      return;
    }
    if (err && err.code === 2) {          // POSITION_UNAVAILABLE
      state.error = '現在地を取得できません。空の見える場所へ移動してみてください。';
    } else if (err && err.code === 3) {   // TIMEOUT
      state.error = '測位に時間がかかっています…';
    } else {
      state.error = '位置情報の取得に失敗しました';
    }
    emit();
  }

  /* ---------- Wake Lock（走行中の画面消灯を防ぐ） ---------- */

  function requestWakeLock() {
    if (!settings.get().keepAwake) return;
    if (!global.navigator.wakeLock) return;
    if (wakeLock) return;
    global.navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      state.wakeLockActive = true;
      lock.addEventListener('release', function () {
        wakeLock = null;
        state.wakeLockActive = false;
        emit();
      });
      emit();
    }).catch(function () {
      // electron/省電力モードなどで拒否されることがある。致命的ではないので黙って諦める
      state.wakeLockActive = false;
    });
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) { /* 無視 */ }
      wakeLock = null;
    }
    state.wakeLockActive = false;
  }

  /* ---------- 通知 ---------- */

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { console.error(e); }
    }
  }

  global.CP = global.CP || {};
  global.CP.tracker = {
    init: init,
    start: start,
    stop: stop,
    refresh: refresh,
    onChange: onChange,
    getState: getState,
    isSupported: isSupported,
    isNative: isNative,
    openLocationSettings: openLocationSettings,
    consumeGapNotice: consumeGapNotice,
    CONTINUOUS_MAX_SEC: CONTINUOUS_MAX_SEC
  };
})(this);
