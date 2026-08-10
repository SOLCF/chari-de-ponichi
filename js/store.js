/* store.js — 永続化の抽象化層。
 *
 * アプリの他の場所から localStorage / indexedDB を直接触らないこと。
 * ここだけを差し替えれば、将来 Capacitor の Preferences や SQLite へ移行できる。
 *
 *   進捗と設定と走行サマリ … localStorage（小さく、同期的に読めることが重要）
 *   走行の軌跡点          … IndexedDB（量が増えるので分離。失敗しても計測は続行する）
 */
(function (global) {
  'use strict';

  var PROGRESS_KEY = 'chari-pon-ichi:progress:v1';
  var SESSIONS_KEY = 'chari-pon-ichi:sessions:v1';
  var DB_NAME = 'chari-pon-ichi';
  var DB_STORE = 'points';

  var progressCache = null;
  var sessionsCache = null;
  var dbPromise = null;

  /* ---------- 進捗 ---------- */

  function defaultProgress() {
    return {
      gpsM: 0,          // GPSで積算した距離 (m)
      manualM: 0,       // 手動補正で足した距離 (m)
      seenM: 0,         // マイルストーン達成演出を済ませた地点 (m)
      startedAt: Date.now(),
      clears: []        // {chapterId, at} 章クリアの履歴
    };
  }

  function getProgress() {
    if (progressCache) return progressCache;
    var raw = readJSON(PROGRESS_KEY);
    var p = defaultProgress();
    if (raw) {
      for (var k in p) {
        if (raw[k] !== undefined && raw[k] !== null) p[k] = raw[k];
      }
    }
    // 数値が壊れていても 0 として続行する（NaN が総距離に伝染するのを防ぐ）
    p.gpsM = safeNum(p.gpsM);
    p.manualM = safeNum(p.manualM);
    p.seenM = safeNum(p.seenM);
    progressCache = p;
    return p;
  }

  function totalMeters() {
    var p = getProgress();
    return p.gpsM + p.manualM;
  }

  function saveProgress() {
    writeJSON(PROGRESS_KEY, getProgress());
  }

  /* GPS由来の距離を加算する。測位のたびに呼ばれるので即座に永続化する
   * （タブが落ちても直前の測位までは残る） */
  function addGpsMeters(m) {
    if (!(m > 0)) return totalMeters();
    var p = getProgress();
    p.gpsM += m;
    saveProgress();
    return totalMeters();
  }

  /* 手動補正。負の値も許す（乗せすぎた分を引く） */
  function addManualMeters(m) {
    m = safeNum(m);
    var p = getProgress();
    p.manualM += m;
    // 総距離が負にならないよう下限を張る
    if (p.gpsM + p.manualM < 0) p.manualM = -p.gpsM;
    saveProgress();
    return totalMeters();
  }

  function setSeenMeters(m) {
    var p = getProgress();
    p.seenM = safeNum(m);
    saveProgress();
  }

  function recordClear(chapterId) {
    var p = getProgress();
    for (var i = 0; i < p.clears.length; i++) {
      if (p.clears[i].chapterId === chapterId) return;
    }
    p.clears.push({ chapterId: chapterId, at: Date.now() });
    saveProgress();
  }

  /* ---------- 走行セッション ---------- */

  function listSessions() {
    if (sessionsCache) return sessionsCache;
    var raw = readJSON(SESSIONS_KEY);
    sessionsCache = Array.isArray(raw) ? raw : [];
    return sessionsCache;
  }

  function saveSessions() {
    writeJSON(SESSIONS_KEY, listSessions());
  }

  /* 走行中のセッションを upsert する。同じ id なら上書き。
   * 走行中も定期的に呼ばれるので、途中でアプリが落ちても記録が残る */
  function putSession(session) {
    var list = listSessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === session.id) {
        list[i] = session;
        saveSessions();
        return;
      }
    }
    list.push(session);
    // 新しい順に使うことが多いので保存は時系列のまま、表示側で反転する
    saveSessions();
  }

  function deleteSession(id) {
    var list = listSessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list.splice(i, 1);
        saveSessions();
        break;
      }
    }
    deletePoints(id);
  }

  /* ---------- 軌跡点 (IndexedDB) ---------- */

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!global.indexedDB) { resolve(null); return; }
      var req;
      try {
        req = global.indexedDB.open(DB_NAME, 1);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          var os = db.createObjectStore(DB_STORE, { keyPath: 'k', autoIncrement: true });
          os.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      // 軌跡が保存できなくても計測そのものは続けたいので、失敗は null で握りつぶす
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function appendPoint(sessionId, point) {
    return openDb().then(function (db) {
      if (!db) return;
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).add({
          sessionId: sessionId,
          t: point.t,
          lat: round6(point.lat),
          lon: round6(point.lon),
          acc: Math.round(point.acc || 0)
        });
      } catch (e) { /* 保存失敗は無視 */ }
    });
  }

  function getPoints(sessionId) {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readonly');
          var idx = tx.objectStore(DB_STORE).index('sessionId');
          var req = idx.getAll(sessionId);
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    });
  }

  function deletePoints(sessionId) {
    return openDb().then(function (db) {
      if (!db) return;
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        var idx = tx.objectStore(DB_STORE).index('sessionId');
        var req = idx.openCursor(sessionId);
        req.onsuccess = function () {
          var c = req.result;
          if (c) { c.delete(); c.continue(); }
        };
      } catch (e) { /* 無視 */ }
    });
  }

  function clearAllPoints() {
    return openDb().then(function (db) {
      if (!db) return;
      try {
        db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).clear();
      } catch (e) { /* 無視 */ }
    });
  }

  /* ---------- エクスポート / インポート / リセット ---------- */

  function exportAll() {
    return {
      app: 'chari-pon-ichi',
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: getProgress(),
      sessions: listSessions(),
      settings: global.CP.settings.get()
    };
  }

  function importAll(obj) {
    if (!obj || obj.app !== 'chari-pon-ichi') {
      throw new Error('このアプリのバックアップファイルではありません');
    }
    if (obj.progress) {
      progressCache = null;
      writeJSON(PROGRESS_KEY, obj.progress);
      progressCache = null;
      getProgress();
    }
    if (Array.isArray(obj.sessions)) {
      sessionsCache = obj.sessions;
      saveSessions();
    }
    if (obj.settings) {
      global.CP.settings.replaceAll(obj.settings);
    }
  }

  function resetAll() {
    progressCache = defaultProgress();
    sessionsCache = [];
    saveProgress();
    saveSessions();
    return clearAllPoints();
  }

  /* ---------- 小物 ---------- */

  function readJSON(key) {
    try {
      var s = global.localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      console.warn('読み込みに失敗しました: ' + key, e);
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('保存に失敗しました: ' + key, e);
      return false;
    }
  }

  function safeNum(n) {
    n = Number(n);
    return isFinite(n) ? n : 0;
  }

  function round6(n) { return Math.round(n * 1e6) / 1e6; }

  global.CP = global.CP || {};
  global.CP.store = {
    getProgress: getProgress,
    totalMeters: totalMeters,
    addGpsMeters: addGpsMeters,
    addManualMeters: addManualMeters,
    setSeenMeters: setSeenMeters,
    recordClear: recordClear,
    listSessions: listSessions,
    putSession: putSession,
    deleteSession: deleteSession,
    appendPoint: appendPoint,
    getPoints: getPoints,
    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll
  };
})(this);
