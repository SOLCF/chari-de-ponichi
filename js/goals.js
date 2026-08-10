/* goals.js — 目標（章）とマイルストーンのデータ定義、および進捗の算出。
 *
 * 章は積み上げ式。第1章を走り切ったら第2章が始まり、必要な総距離は加算されていく。
 * milestones の km は「その章に入ってからの距離」で、章の distanceKm 以下に収める。
 */
(function (global) {
  'use strict';

  var CHAPTERS = [
    {
      id: 'japan',
      name: '日本一周',
      subtitle: '海岸線をたどって、ぐるり一周',
      icon: '🚲',
      distanceKm: 12000,
      scale: 'linear',
      milestones: [
        { km: 150, name: '箱根越え' },
        { km: 350, name: '名古屋' },
        { km: 550, name: '大阪' },
        { km: 750, name: '岡山' },
        { km: 950, name: '広島' },
        { km: 1150, name: '本州最西端・下関' },
        { km: 1300, name: '福岡' },
        { km: 1700, name: '長崎' },
        { km: 2100, name: '熊本' },
        { km: 2500, name: '本土最南端・佐多岬' },
        { km: 2900, name: '宮崎' },
        { km: 3300, name: '大分' },
        { km: 3600, name: '四国上陸・松山' },
        { km: 3900, name: '室戸岬' },
        { km: 4200, name: '徳島' },
        { km: 4500, name: '淡路島をわたって神戸' },
        { km: 4900, name: '山陰海岸・鳥取砂丘' },
        { km: 5300, name: '出雲大社' },
        { km: 5700, name: '萩' },
        { km: 6100, name: '丹後半島' },
        { km: 6400, name: '金沢' },
        { km: 6800, name: '能登半島一周' },
        { km: 7100, name: '新潟' },
        { km: 7600, name: '佐渡ヶ島' },
        { km: 8000, name: '男鹿半島' },
        { km: 8400, name: '本州最北端・竜飛岬' },
        { km: 8700, name: '北海道上陸・函館' },
        { km: 9100, name: '札幌' },
        { km: 9500, name: '最北端・宗谷岬' },
        { km: 10000, name: 'オホーツク海・網走' },
        { km: 10400, name: '知床' },
        { km: 10800, name: '襟裳岬' },
        { km: 11100, name: '本州へ戻る' },
        { km: 11400, name: '仙台' },
        { km: 11700, name: '水戸' },
        { km: 12000, name: '日本橋へ帰還', goal: true }
      ]
    },
    {
      id: 'world',
      name: '世界一周',
      subtitle: '赤道ひとまわり 40,075km',
      icon: '🌏',
      distanceKm: 40075,
      scale: 'linear',
      milestones: [
        { km: 2000, name: 'グアム' },
        { km: 5000, name: 'ハワイ' },
        { km: 9000, name: 'サンフランシスコ' },
        { km: 13000, name: 'ニューヨーク' },
        { km: 18000, name: '大西洋を越えてリスボン' },
        { km: 20038, name: '地球の裏側（対蹠点）' },
        { km: 22000, name: 'ジブラルタル海峡' },
        { km: 25000, name: 'カイロ' },
        { km: 28000, name: 'ドバイ' },
        { km: 32000, name: 'ムンバイ' },
        { km: 35000, name: 'シンガポール' },
        { km: 37500, name: '香港' },
        { km: 40075, name: '日本へ帰還', goal: true }
      ]
    },
    {
      id: 'moon',
      name: '月旅行',
      subtitle: '地球から月まで 384,400km',
      icon: '🌕',
      distanceKm: 384400,
      scale: 'linear',
      milestones: [
        { km: 100, name: 'カーマンライン（宇宙のはじまり）' },
        { km: 400, name: '国際宇宙ステーション' },
        { km: 2000, name: 'ヴァン・アレン帯' },
        { km: 20200, name: 'GPS衛星の軌道' },
        { km: 35786, name: '静止軌道' },
        { km: 96100, name: '月まで 1/4' },
        { km: 192200, name: '月まで半分' },
        { km: 288300, name: '月まで 3/4' },
        { km: 344000, name: '月の重力圏に突入' },
        { km: 384400, name: '月面着陸', goal: true }
      ]
    },
    {
      id: 'mars',
      name: '火星旅行',
      subtitle: '最接近時の火星まで 5,576万km',
      icon: '🔴',
      distanceKm: 55760000,
      scale: 'log',
      milestones: [
        { km: 384400, name: '月を通過' },
        { km: 1500000, name: 'ラグランジュ点 L2' },
        { km: 5000000, name: '深宇宙へ' },
        { km: 15000000, name: '地球が点になる' },
        { km: 27880000, name: '航路の折り返し' },
        { km: 40000000, name: '火星が肉眼で見える' },
        { km: 54600000, name: '火星の重力圏' },
        { km: 55760000, name: '火星着陸', goal: true }
      ]
    },
    {
      id: 'lightyear',
      name: '1光年',
      subtitle: '光が1年かけて進む距離 9兆4,607億km',
      icon: '✨',
      distanceKm: 9460730472581,
      scale: 'log',
      milestones: [
        { km: 78000000, name: '小惑星帯' },
        { km: 628000000, name: '木星' },
        { km: 1275000000, name: '土星' },
        { km: 2721000000, name: '天王星' },
        { km: 4351000000, name: '海王星' },
        { km: 5900000000, name: '冥王星' },
        { km: 18000000000, name: 'ヘリオポーズ（太陽圏の果て）' },
        { km: 25000000000, name: 'ボイジャー1号に追いつく' },
        { km: 300000000000, name: 'オールトの雲' },
        { km: 1000000000000, name: '1兆km' },
        { km: 4730365236290, name: '半光年' },
        { km: 9460730472581, name: '1光年到達', goal: true }
      ]
    }
  ];

  // 走行中はホーム画面が毎秒描き直され、そのたびに章を組み立て直すことになる。
  // 上書き設定が変わらない限り作り直す必要はないので、結果を持ち回す。
  var cacheKey = null;
  var cacheVal = null;

  /* 章の目標距離が設定で上書きされていれば、それを反映した配列を返す。
   * 距離を変えた場合はマイルストーンの位置も比例で伸縮させ、
   * 「最後のマイルストーン = 章のゴール」の関係を保つ。 */
  function chapters() {
    var ov = (global.CP.settings.get().goalOverrides) || {};
    var key = JSON.stringify(ov);
    if (key === cacheKey) return cacheVal;

    cacheKey = key;
    cacheVal = build(ov);
    return cacheVal;
  }

  function build(ov) {
    return CHAPTERS.map(function (c) {
      var override = Number(ov[c.id]);
      if (!isFinite(override) || override <= 0 || override === c.distanceKm) return c;
      var k = override / c.distanceKm;
      return {
        id: c.id,
        name: c.name,
        subtitle: c.subtitle,
        icon: c.icon,
        distanceKm: override,
        scale: c.scale,
        customized: true,
        milestones: c.milestones.map(function (m) {
          return { km: m.km * k, name: m.name, goal: m.goal };
        })
      };
    });
  }

  /* 各章の開始地点（総距離ベース）を求める */
  function offsets() {
    var list = chapters();
    var out = [];
    var acc = 0;
    for (var i = 0; i < list.length; i++) {
      out.push(acc);
      acc += list[i].distanceKm;
    }
    return out;
  }

  function grandTotalKm() {
    var list = chapters();
    var acc = 0;
    for (var i = 0; i < list.length; i++) acc += list[i].distanceKm;
    return acc;
  }

  /* 総距離(km)から現在の章と章内の進捗を求める。
   * 全章走破後は最終章の完了状態を返す（index は最終章のまま） */
  function locate(totalKm) {
    var list = chapters();
    var offs = offsets();
    for (var i = 0; i < list.length; i++) {
      var end = offs[i] + list[i].distanceKm;
      if (totalKm < end || i === list.length - 1) {
        var into = Math.min(totalKm - offs[i], list[i].distanceKm);
        return {
          index: i,
          chapter: list[i],
          offsetKm: offs[i],
          intoKm: Math.max(0, into),
          ratio: Math.max(0, Math.min(1, into / list[i].distanceKm)),
          completed: totalKm >= end,
          allDone: (i === list.length - 1) && totalKm >= end
        };
      }
    }
    return null;
  }

  /* 次に到達するマイルストーン。章をまたいで探す。すべて達成済みなら null */
  function nextMilestone(totalKm) {
    var list = chapters();
    var offs = offsets();
    for (var i = 0; i < list.length; i++) {
      var ms = list[i].milestones;
      for (var j = 0; j < ms.length; j++) {
        var absKm = offs[i] + ms[j].km;
        if (absKm > totalKm) {
          return {
            chapter: list[i],
            chapterIndex: i,
            milestone: ms[j],
            absKm: absKm,
            remainKm: absKm - totalKm
          };
        }
      }
    }
    return null;
  }

  /* fromKm から toKm の間に新しく通過したマイルストーンを列挙する。
   * 達成演出（一度に複数を跨ぐこともある）に使う */
  function crossed(fromKm, toKm) {
    if (!(toKm > fromKm)) return [];
    var list = chapters();
    var offs = offsets();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var ms = list[i].milestones;
      for (var j = 0; j < ms.length; j++) {
        var absKm = offs[i] + ms[j].km;
        if (absKm > fromKm && absKm <= toKm) {
          out.push({ chapter: list[i], chapterIndex: i, milestone: ms[j], absKm: absKm });
        }
      }
    }
    return out;
  }

  /* 進捗バーの表示比率。桁が大きすぎる章は対数目盛りにしないと
   * いつまでもバーが動かず、進んでいる実感が持てない */
  function displayRatio(chapter, intoKm) {
    if (intoKm <= 0) return 0;
    if (chapter.scale !== 'log') {
      return Math.min(1, intoKm / chapter.distanceKm);
    }
    // 1km を起点にした対数スケール
    var a = Math.log10(Math.max(1, intoKm));
    var b = Math.log10(Math.max(10, chapter.distanceKm));
    return Math.max(0, Math.min(1, a / b));
  }

  global.CP = global.CP || {};
  global.CP.goals = {
    raw: CHAPTERS,
    chapters: chapters,
    offsets: offsets,
    grandTotalKm: grandTotalKm,
    locate: locate,
    nextMilestone: nextMilestone,
    crossed: crossed,
    displayRatio: displayRatio
  };
})(this);
