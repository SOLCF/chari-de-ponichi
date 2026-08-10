/* ui.js — 画面の描画。ここから位置情報 API や localStorage を直接触らないこと
 * （それぞれ tracker.js / store.js 経由）。 */
(function (global) {
  'use strict';

  var doc = global.document;
  var fmt, goals, store, settings, tracker, geo;

  var RING_C = 2 * Math.PI * 96;   // リングの円周。style.css の dasharray と一致させる
  var celebrateQueue = [];
  var toastTimer = null;
  var openChapters = {};

  function el(id) { return doc.getElementById(id); }

  function init() {
    fmt = global.CP.fmt;
    goals = global.CP.goals;
    store = global.CP.store;
    settings = global.CP.settings;
    tracker = global.CP.tracker;
    geo = global.CP.geo;

    applyTheme();
    buildFilterControls();
    buildGoalControls();
  }

  /* ---------- テーマ ---------- */

  function applyTheme() {
    var t = settings.get().theme;
    if (t === 'auto') {
      t = global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light' : 'dark';
    }
    doc.documentElement.setAttribute('data-theme', t);
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f4f6fb' : '#0f1420');
  }

  /* ---------- ビュー切り替え ---------- */

  function showView(name) {
    var views = doc.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) {
      views[i].classList.toggle('is-active', views[i].id === 'view-' + name);
    }
    var tabs = doc.querySelectorAll('.tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('is-active', tabs[j].getAttribute('data-view') === name);
    }
    if (name === 'log') renderLog();
    if (name === 'journey') renderJourney();
    if (name === 'settings') renderSettings();
    global.scrollTo(0, 0);
  }

  /* ---------- ホーム ---------- */

  function renderHome() {
    var totalKm = store.totalMeters() / 1000;
    var loc = goals.locate(totalKm);
    if (!loc) return;

    el('chapterIcon').textContent = loc.chapter.icon;
    el('chapterName').textContent = loc.chapter.name;
    el('chapterSub').textContent = loc.allDone
      ? 'すべての目標を走破しました'
      : loc.chapter.subtitle;

    var ratio = goals.displayRatio(loc.chapter, loc.intoKm);
    el('ringBar').style.strokeDashoffset = String(RING_C * (1 - ratio));

    el('totalKm').textContent = fmt.km(totalKm);
    el('chapterPct').textContent = fmt.pct((loc.intoKm / loc.chapter.distanceKm) * 100);

    renderNextCard(totalKm);
    renderLive();
  }

  function renderNextCard(totalKm) {
    var next = goals.nextMilestone(totalKm);
    var card = el('nextCard');
    if (!next) {
      card.querySelector('.next-label').textContent = 'コンプリート';
      el('nextName').textContent = '行けるところまで行きました';
      el('nextRemain').textContent = '総距離 ' + fmt.km(totalKm) + ' km';
      el('nextEta').textContent = '';
      return;
    }
    card.querySelector('.next-label').textContent =
      (next.chapterIndex === goals.locate(totalKm).index)
        ? '次のマイルストーン'
        : '次の目標「' + next.chapter.name + '」';
    el('nextName').textContent = next.milestone.name;
    el('nextRemain').textContent = 'あと ' + fmt.km(next.remainKm) + ' km';
    var pace = paceKmPerDay();
    el('nextEta').textContent = pace > 0
      ? fmt.eta(next.remainKm, pace) + '（直近のペース 1日 ' + pace.toFixed(1) + 'km）'
      : '';
  }

  function renderLive() {
    var st = tracker.getState();
    var running = st.status !== 'idle';

    el('liveStats').hidden = !running;
    el('btnLabel').textContent = running ? 'ストップ' : 'スタート';
    el('btnStartStop').classList.toggle('is-stop', running);
    el('actionHint').textContent = running
      ? (st.wakeLockActive ? '画面が消えないようにしています' : '画面が消えると計測が止まります')
      : '走り出す前にスタートを押してください';

    var err = el('errorMsg');
    err.hidden = !st.error;
    if (st.error) err.textContent = st.error;

    if (!running) return;

    var d = fmt.shortDistance(st.sessionMeters);
    el('sessDist').textContent = d.value;
    el('sessDistUnit').textContent = d.unit;
    el('sessTime').textContent = fmt.duration(st.elapsedSec);
    el('sessSpeed').textContent = fmt.speed(st.speedKmh);
    el('sessAvg').textContent = st.movingSec > 5
      ? fmt.speed((st.sessionMeters / st.movingSec) * 3.6)
      : '--';

    var dot = el('gpsDot');
    var text = el('gpsText');
    dot.className = 'gps-dot';
    if (st.status === 'acquiring') {
      dot.classList.add('is-searching');
      text.textContent = '現在地を探しています…';
    } else if (st.lastReason === 'ok' || st.lastReason === 'first') {
      dot.classList.add('is-good');
      text.textContent = '計測中';
    } else if (st.lastReason === 'accuracy') {
      dot.classList.add('is-bad');
      text.textContent = geo.REASON_LABEL.accuracy;
    } else {
      dot.classList.add('is-warn');
      text.textContent = geo.REASON_LABEL[st.lastReason] || '待機中';
    }
    el('gpsAcc').textContent = st.accuracy ? '±' + Math.round(st.accuracy) + 'm' : '';
  }

  /* 直近30日の実績から 1日あたりの平均距離を出す。
   *
   * 走った日が2日以下のうちは 0 を返して見積もりを出さない。
   * 初日に1回走っただけで「あと約5年」などと出しても、それは実力ではなく
   * 分母の都合でしかなく、かえって萎える。
   * 分母を最低7日とするのも同じ理由（1回の遠出でペースが跳ね上がらないように）。 */
  function paceKmPerDay() {
    var list = store.listSessions();
    var since = Date.now() - 30 * 86400000;
    var meters = 0;
    var earliest = null;
    var days = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i].startedAt >= since) {
        meters += list[i].meters || 0;
        days[new Date(list[i].startedAt).toDateString()] = true;
        if (earliest === null || list[i].startedAt < earliest) earliest = list[i].startedAt;
      }
    }
    if (meters <= 0 || earliest === null) return 0;
    if (Object.keys(days).length < 3) return 0;
    var span = Math.max(7, (Date.now() - earliest) / 86400000);
    return (meters / 1000) / span;
  }

  /* ---------- 記録 ---------- */

  function renderLog() {
    var list = store.listSessions().slice().sort(function (a, b) {
      return b.startedAt - a.startedAt;
    });

    var summary = el('logSummary');
    var totalKm = store.totalMeters() / 1000;
    var monthKm = 0;
    var longest = 0;
    var thisMonth = new Date();
    for (var i = 0; i < list.length; i++) {
      var d = new Date(list[i].startedAt);
      if (d.getFullYear() === thisMonth.getFullYear() && d.getMonth() === thisMonth.getMonth()) {
        monthKm += (list[i].meters || 0) / 1000;
      }
      if ((list[i].meters || 0) > longest) longest = list[i].meters;
    }
    summary.innerHTML =
      cell(fmt.km(totalKm), '総距離 km') +
      cell(fmt.km(monthKm), '今月 km') +
      cell(String(list.length), '走行回数');

    var out = [];
    var curMonth = '';
    var monthSum = 0;
    var buffer = [];

    function flush() {
      if (!curMonth) return;
      out.push('<div class="month-head"><span>' + esc(curMonth) +
        '</span><b>' + fmt.km(monthSum / 1000) + ' km</b></div>');
      out.push(buffer.join(''));
      buffer = [];
      monthSum = 0;
    }

    for (var k = 0; k < list.length; k++) {
      var s = list[k];
      var m = fmt.ym(s.startedAt);
      if (m !== curMonth) { flush(); curMonth = m; }
      monthSum += s.meters || 0;
      var dist = fmt.shortDistance(s.meters || 0);
      var avg = s.movingSec > 5 ? fmt.speed(((s.meters || 0) / s.movingSec) * 3.6) + ' km/h' : '';
      buffer.push(
        '<div class="log-item">' +
          '<div class="log-date">' + esc(fmt.dateTime(s.startedAt)) + '</div>' +
          '<div class="log-dist">' + dist.value + '<small>' + dist.unit + '</small></div>' +
          '<div class="log-meta">' + esc(fmt.durationJa(s.elapsedSec || 0)) +
            (avg ? '<br>' + esc(avg) : '') + '</div>' +
        '</div>'
      );
    }
    flush();

    el('logList').innerHTML = out.length ? out.join('')
      : '<div class="empty">まだ記録がありません。<br>「走行」タブからスタートしてみましょう。</div>';
  }

  function cell(value, label) {
    return '<div class="summary-cell"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ---------- 旅路 ---------- */

  function renderJourney() {
    var totalKm = store.totalMeters() / 1000;
    var loc = goals.locate(totalKm);
    var list = goals.chapters();
    var offs = goals.offsets();
    var grand = goals.grandTotalKm();

    el('journeyTotal').innerHTML =
      '<b>' + esc(fmt.km(totalKm)) + ' km</b> 走りました<br>' +
      '全行程 ' + esc(fmt.km(grand)) + ' km のうち ' +
      esc(fmt.pct((totalKm / grand) * 100));

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var into = Math.max(0, Math.min(c.distanceKm, totalKm - offs[i]));
      var clear = totalKm >= offs[i] + c.distanceKm;
      var locked = totalKm < offs[i];
      var isOpen = openChapters[c.id] !== undefined ? openChapters[c.id] : (i === loc.index);
      var ratio = goals.displayRatio(c, into);

      var cls = 'chap' + (clear ? ' is-clear' : '') + (locked ? ' is-locked' : '') +
                (isOpen ? ' is-open' : '');
      var state = clear ? 'クリア' : (locked ? '未開放' : fmt.pct(into / c.distanceKm * 100));

      var ms = [];
      for (var j = 0; j < c.milestones.length; j++) {
        var m = c.milestones[j];
        var done = into >= m.km;
        var isNext = !done && (j === 0 || into >= c.milestones[j - 1].km);
        ms.push(
          '<div class="ms' + (done ? ' is-done' : '') + (isNext ? ' is-next' : '') +
            (m.goal ? ' is-goal' : '') + '">' +
            '<span class="ms-mark">' + (done ? '●' : (isNext ? '◉' : '○')) + '</span>' +
            '<span class="ms-name">' + esc(m.name) + '</span>' +
            '<span class="ms-km">' + esc(fmt.km(m.km)) + '</span>' +
          '</div>'
        );
      }

      out.push(
        '<div class="' + cls + '" data-chapter="' + esc(c.id) + '">' +
          '<div class="chap-head">' +
            '<span class="chap-icon">' + c.icon + '</span>' +
            '<span class="chap-title"><b>' + esc(c.name) + '</b><span>' +
              esc(fmt.km(c.distanceKm)) + ' km — ' + esc(c.subtitle) + '</span></span>' +
            '<span class="chap-state' + (clear ? ' is-clear' : '') + '">' + esc(state) + '</span>' +
          '</div>' +
          '<div class="chap-bar"><i style="width:' + (ratio * 100).toFixed(2) + '%"></i></div>' +
          '<div class="ms-list">' + ms.join('') + '</div>' +
        '</div>'
      );
    }
    el('journeyList').innerHTML = out.join('');

    var heads = el('journeyList').querySelectorAll('.chap-head');
    for (var h = 0; h < heads.length; h++) {
      heads[h].addEventListener('click', function () {
        var chap = this.parentNode;
        var id = chap.getAttribute('data-chapter');
        chap.classList.toggle('is-open');
        openChapters[id] = chap.classList.contains('is-open');
      });
    }
  }

  /* ---------- 設定 ---------- */

  var FILTER_ORDER = ['intervalSec', 'maxSpeedKmh', 'minSpeedKmh', 'maxAccuracyM', 'gapResetSec'];

  function buildFilterControls() {
    var host = el('filterControls');
    var out = [];
    for (var i = 0; i < FILTER_ORDER.length; i++) {
      var key = FILTER_ORDER[i];
      var spec = settings.SPEC[key];
      var presets = spec.presets.map(function (p) {
        return '<button type="button" class="preset" data-key="' + key +
               '" data-value="' + p.value + '">' + esc(p.label) + '</button>';
      }).join('');
      out.push(
        '<div class="ctrl" data-key="' + key + '">' +
          '<div class="ctrl-head">' +
            '<span class="ctrl-name">' + esc(spec.label) + '</span>' +
            '<span class="ctrl-value" data-role="value"></span>' +
          '</div>' +
          '<p class="ctrl-help">' + esc(spec.help) + '</p>' +
          '<input type="range" min="0" max="1000" step="1" data-role="range" data-key="' + key + '">' +
          '<div class="presets">' + presets + '</div>' +
        '</div>'
      );
    }
    out.push('<div class="btn-row"><button type="button" class="btn-sub" id="btnResetFilters">初期値に戻す</button></div>');
    host.innerHTML = out.join('');

    var ranges = host.querySelectorAll('input[data-role="range"]');
    for (var r = 0; r < ranges.length; r++) {
      ranges[r].addEventListener('input', function () {
        var key = this.getAttribute('data-key');
        var v = fromSlider(settings.SPEC[key], Number(this.value));
        settings.set(key, v);
        paintControl(key);
        // 設定値そのものは即座に反映される。測位ループの張り直しだけは、
        // スライダーを動かしている最中に何度も GPS を止め直さないよう間を置く
        refreshSoon();
      });
    }
    var presetBtns = host.querySelectorAll('.preset');
    for (var p = 0; p < presetBtns.length; p++) {
      presetBtns[p].addEventListener('click', function () {
        var key = this.getAttribute('data-key');
        settings.set(key, Number(this.getAttribute('data-value')));
        paintControl(key);
        tracker.refresh();
      });
    }
    el('btnResetFilters').addEventListener('click', function () {
      var d = settings.DEFAULTS;
      for (var i = 0; i < FILTER_ORDER.length; i++) settings.set(FILTER_ORDER[i], d[FILTER_ORDER[i]]);
      renderSettings();
      tracker.refresh();
      toast('計測の設定を初期値に戻しました');
    });
  }

  var refreshTimer = null;
  function refreshSoon() {
    if (refreshTimer) global.clearTimeout(refreshTimer);
    refreshTimer = global.setTimeout(function () {
      refreshTimer = null;
      tracker.refresh();
    }, 400);
  }

  function paintControl(key) {
    var spec = settings.SPEC[key];
    var v = settings.get()[key];
    var ctrl = doc.querySelector('.ctrl[data-key="' + key + '"]');
    if (!ctrl) return;
    ctrl.querySelector('[data-role="value"]').innerHTML =
      esc(String(v)) + '<small>' + esc(spec.unit) + '</small>';
    var range = ctrl.querySelector('[data-role="range"]');
    if (doc.activeElement !== range) range.value = String(toSlider(spec, v));
    var presets = ctrl.querySelectorAll('.preset');
    for (var i = 0; i < presets.length; i++) {
      presets[i].classList.toggle('is-on', Number(presets[i].getAttribute('data-value')) === v);
    }
  }

  /* スライダーの位置(0-1000)と実際の値の相互変換。
   * 対数目盛りにすると、実用域である小さい値を細かく刻みつつ
   * 上限の 1000km/h まで一本のスライダーで届く */
  function toSlider(spec, v) {
    var t;
    if (spec.log) {
      var a = Math.log(spec.min), b = Math.log(spec.max);
      t = (Math.log(Math.max(spec.min, v)) - a) / (b - a);
    } else {
      t = (v - spec.min) / (spec.max - spec.min);
    }
    return Math.round(Math.max(0, Math.min(1, t)) * 1000);
  }

  function fromSlider(spec, p) {
    var t = Math.max(0, Math.min(1, p / 1000));
    var v;
    if (spec.log) {
      var a = Math.log(spec.min), b = Math.log(spec.max);
      v = Math.exp(a + (b - a) * t);
    } else {
      v = spec.min + (spec.max - spec.min) * t;
    }
    return niceRound(v, spec);
  }

  // 対数スライダーは端数だらけの値になるので、桁に応じて丸めて読みやすくする
  function niceRound(v, spec) {
    if (spec.step < 1) return Math.round(v * 10) / 10;
    if (v < 100) return Math.round(v);
    if (v < 300) return Math.round(v / 5) * 5;
    return Math.round(v / 10) * 10;
  }

  function buildGoalControls() {
    var host = el('goalControls');
    var list = goals.raw;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push(
        '<div class="goal-row">' +
          '<span class="goal-name">' + list[i].icon + ' ' + esc(list[i].name) + '</span>' +
          '<input type="number" min="1" step="1" data-goal="' + esc(list[i].id) + '">' +
          '<span class="manual-unit">km</span>' +
        '</div>'
      );
    }
    host.innerHTML = out.join('');
    var inputs = host.querySelectorAll('input[data-goal]');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('change', function () {
        var id = this.getAttribute('data-goal');
        var v = Number(this.value);
        var ov = Object.assign({}, settings.get().goalOverrides || {});
        var base = null;
        for (var k = 0; k < goals.raw.length; k++) if (goals.raw[k].id === id) base = goals.raw[k];
        if (!isFinite(v) || v <= 0) {
          delete ov[id];
          this.value = String(base.distanceKm);
        } else if (v === base.distanceKm) {
          delete ov[id];
        } else {
          ov[id] = v;
        }
        settings.set('goalOverrides', ov);
        renderHome();
        toast(base.name + 'の目標を ' + fmt.km(Number(this.value)) + ' km にしました');
      });
    }
  }

  function renderSettings() {
    for (var i = 0; i < FILTER_ORDER.length; i++) paintControl(FILTER_ORDER[i]);

    var s = settings.get();
    el('optHighAccuracy').checked = !!s.highAccuracy;
    el('optKeepAwake').checked = !!s.keepAwake;
    el('optTheme').value = s.theme;

    var ov = s.goalOverrides || {};
    var inputs = doc.querySelectorAll('input[data-goal]');
    for (var j = 0; j < inputs.length; j++) {
      var id = inputs[j].getAttribute('data-goal');
      var base = null;
      for (var k = 0; k < goals.raw.length; k++) if (goals.raw[k].id === id) base = goals.raw[k];
      inputs[j].value = String(ov[id] || base.distanceKm);
    }

    var p = store.getProgress();
    el('manualBreakdown').textContent =
      'GPSで計測: ' + fmt.km(p.gpsM / 1000) + ' km ／ 手動補正: ' +
      (p.manualM >= 0 ? '+' : '') + fmt.km(p.manualM / 1000) + ' km';
  }

  /* ---------- 達成演出 ---------- */

  /* 一度に何か所も通過したときは、全部を順番に見せると
   * 「つづける」を延々と押させることになる（手動補正で大きく足したときに起きる）。
   * 章クリアと最後の1件だけを見せ、残りは件数でまとめる。 */
  function queueCelebrations(items) {
    if (!items.length) return;

    var picked = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].milestone.goal) picked.push(items[i]);
    }
    var last = items[items.length - 1];
    if (picked.indexOf(last) < 0) picked.push(last);
    picked.sort(function (a, b) { return a.absKm - b.absKm; });

    var omitted = items.length - picked.length;
    if (omitted > 0) picked[picked.length - 1].omitted = omitted;

    for (var j = 0; j < picked.length; j++) celebrateQueue.push(picked[j]);
    if (!el('celebrate').hidden) return;
    showNextCelebration();
  }

  function showNextCelebration() {
    var item = celebrateQueue.shift();
    if (!item) { el('celebrate').hidden = true; return; }
    var isGoal = !!item.milestone.goal;
    el('celIcon').textContent = isGoal ? '🏁' : item.chapter.icon;
    el('celKicker').textContent = isGoal ? item.chapter.name + ' クリア' : '到達';
    el('celName').textContent = item.milestone.name;
    var sub = isGoal
      ? '総距離 ' + fmt.km(item.absKm) + ' km。次の目標がはじまります。'
      : '総距離 ' + fmt.km(item.absKm) + ' km 地点';
    if (item.omitted) sub += '\n途中の ' + item.omitted + ' か所も通過しました。';
    el('celSub').textContent = sub;
    el('celebrate').hidden = false;
  }

  function closeCelebration() {
    if (celebrateQueue.length) { showNextCelebration(); return; }
    el('celebrate').hidden = true;
  }

  /* ---------- トースト ---------- */

  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () { t.hidden = true; }, 2600);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.CP = global.CP || {};
  global.CP.ui = {
    init: init,
    showView: showView,
    renderHome: renderHome,
    renderLive: renderLive,
    renderLog: renderLog,
    renderJourney: renderJourney,
    renderSettings: renderSettings,
    applyTheme: applyTheme,
    queueCelebrations: queueCelebrations,
    closeCelebration: closeCelebration,
    toast: toast
  };
})(this);
