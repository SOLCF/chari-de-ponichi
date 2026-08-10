/* app.js — 起動と配線。各モジュールを繋ぐだけで、ロジックはここに書かない。 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var doc = global.document;
  var CP = global.CP;

  function el(id) { return doc.getElementById(id); }

  function boot() {
    CP.VERSION = VERSION;
    CP.ui.init();
    CP.tracker.init();

    // 起動時点までの距離は「演出済み」として扱う。
    // そうしないとバックアップ復元やアプリ再起動のたびに
    // 過去のマイルストーンが一気に祝われてしまう
    CP.store.setSeenMeters(CP.store.totalMeters());

    wireTabs();
    wireHome();
    wireSettings();

    CP.tracker.onChange(onTrackerChange);
    CP.ui.renderHome();
    el('appVersion').textContent = 'チャリでポンイチ v' + VERSION;

    if (global.matchMedia) {
      global.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (CP.settings.get().theme === 'auto') CP.ui.applyTheme();
      });
    }

    registerServiceWorker();
  }

  /* ---------- タブ ---------- */

  function wireTabs() {
    var tabs = doc.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        CP.ui.showView(this.getAttribute('data-view'));
      });
    }
  }

  /* ---------- ホーム ---------- */

  function wireHome() {
    el('btnStartStop').addEventListener('click', function () {
      if (CP.tracker.getState().status === 'idle') {
        CP.tracker.start();
      } else {
        var st = CP.tracker.getState();
        var km = (st.sessionMeters / 1000).toFixed(2);
        CP.tracker.stop();
        CP.ui.toast('今回の走行 ' + km + ' km を記録しました');
      }
    });

    el('celClose').addEventListener('click', function () {
      CP.ui.closeCelebration();
    });

    // 走行中に戻ってきたとき、止まっていた間の状況を伝える
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible') CP.ui.renderHome();
    });
  }

  /* 測位のたびに呼ばれる。マイルストーン通過の検出もここで行う */
  function onTrackerChange() {
    var totalM = CP.store.totalMeters();
    var seenM = CP.store.getProgress().seenM;

    if (totalM > seenM) {
      var hits = CP.goals.crossed(seenM / 1000, totalM / 1000);
      CP.store.setSeenMeters(totalM);
      if (hits.length) {
        for (var i = 0; i < hits.length; i++) {
          if (hits[i].milestone.goal) CP.store.recordClear(hits[i].chapter.id);
        }
        CP.ui.queueCelebrations(hits);
      }
    }

    var gap = CP.tracker.consumeGapNotice();
    if (gap > 0) {
      CP.ui.toast(Math.round(gap / 60) + '分ほど計測が中断していました。その間の距離は加算していません');
    }

    CP.ui.renderHome();
  }

  /* ---------- 設定 ---------- */

  function wireSettings() {
    el('optHighAccuracy').addEventListener('change', function () {
      CP.settings.set('highAccuracy', this.checked);
      CP.tracker.refresh();
    });

    el('optKeepAwake').addEventListener('change', function () {
      CP.settings.set('keepAwake', this.checked);
      CP.tracker.refresh();
    });

    el('optTheme').addEventListener('change', function () {
      CP.settings.set('theme', this.value);
      CP.ui.applyTheme();
    });

    el('btnManualAdd').addEventListener('click', function () {
      var input = el('manualKm');
      var km = Number(input.value);
      if (!isFinite(km) || km === 0) {
        CP.ui.toast('加える距離を入力してください');
        return;
      }
      CP.store.addManualMeters(km * 1000);
      // 手動分でもマイルストーンは祝う
      onTrackerChange();
      CP.ui.renderSettings();
      input.value = '';
      CP.ui.toast((km > 0 ? '+' : '') + km + ' km を総距離に反映しました');
    });

    el('btnExport').addEventListener('click', exportBackup);

    el('btnImport').addEventListener('click', function () { el('importFile').click(); });
    el('importFile').addEventListener('change', importBackup);

    el('btnReset').addEventListener('click', function () {
      if (!global.confirm('総距離・走行記録・設定をすべて消します。この操作は取り消せません。続けますか？')) return;
      if (!global.confirm('本当に消してよいですか？ 先にバックアップを保存しておくことをおすすめします。')) return;
      CP.tracker.stop();
      CP.store.resetAll().then(function () {
        CP.settings.reset();
        CP.ui.applyTheme();
        CP.ui.renderHome();
        CP.ui.renderSettings();
        CP.ui.toast('すべてのデータを消しました');
      });
    });
  }

  function exportBackup() {
    var data = JSON.stringify(CP.store.exportAll(), null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'chari-pon-ichi-' + d.getFullYear() +
      pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    CP.ui.toast('バックアップを保存しました');
  }

  function importBackup(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        CP.store.importAll(JSON.parse(reader.result));
        CP.store.setSeenMeters(CP.store.totalMeters());
        CP.ui.applyTheme();
        CP.ui.renderHome();
        CP.ui.renderSettings();
        CP.ui.toast('バックアップから復元しました');
      } catch (err) {
        CP.ui.toast('復元できませんでした: ' + err.message);
      }
    };
    reader.onerror = function () { CP.ui.toast('ファイルを読み込めませんでした'); };
    reader.readAsText(file);
    e.target.value = '';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ---------- Service Worker ---------- */

  function registerServiceWorker() {
    if (!('serviceWorker' in global.navigator)) return;
    // file:// で開いたときは登録できない。開発中に落ちても困るので握りつぶす
    global.navigator.serviceWorker.register('sw.js').catch(function () { /* 無視 */ });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(this);
