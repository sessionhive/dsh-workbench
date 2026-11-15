'use strict';

/**
 * Agent 战术大屏：本地衍生页的补丁。
 *
 * 上游 index.html 原样保留；这里只做三件事：
 * 1. 在 </head> 前注入 window.__WB 数据桥（渲染进程定时推送会话/派单快照）；
 * 2. 注入 window.__WBU 小工具（词、时间、标签替换），供神经星环使用；
 * 3. 在 NEURAL 主题的「模拟」段旁插入数据接入代码：把作者的模拟词库、链路、日志和计数
 *    换成工作台的真实会话与派单数据。视觉、动画、布局都不改。
 *
 * 每个接入块都带自己的标记，重复执行保持幂等；上游更新后重新执行即可。
 */

const PATCH_TAG = 'wbpatch-v16';
const BRIDGE_MARKER = 'id="__wbBridge"';
const BRIDGE = `<script id="__wbBridge">
/* ${PATCH_TAG} */
window.__WBU = {
  PALETTE: ['#7cc8ff', '#a093ff', '#ff86c2', '#ffae80', '#49e3f2', '#8ef0c4', '#ffd27a', '#6f8dff', '#ff9a6a', '#e07bff', '#9ee6ff', '#d6c4ff'],
  pad2: function (n) { return String(n).padStart(2, '0'); },
  short: function (value, limit) {
    var text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  },
  norm: function (value) { return String(value == null ? '' : value).replace(/\\s+/g, '').toLowerCase(); },
  when: function (at) {
    var d = new Date(at || Date.now());
    return this.pad2(d.getHours()) + ':' + this.pad2(d.getMinutes());
  },
  stamp: function (el, text) {
    if (!el) return;
    var node = el.firstChild;
    while (node && node.nodeType !== 3) node = node.nextSibling;
    if (node) node.nodeValue = text + ' · ';
    else el.insertBefore(document.createTextNode(text + ' · '), el.firstChild);
  },
  set: function (SR, selector, text) {
    var el = SR.querySelector(selector);
    if (el) el.textContent = text;
  },
  match: function (list, name) {
    var key = this.norm(name);
    if (!key) return -1;
    var i;
    for (i = 0; i < list.length; i++) { if (this.norm(list[i]) === key) return i; }
    for (i = 0; i < list.length; i++) {
      var item = this.norm(list[i]);
      if (item && (item.indexOf(key) >= 0 || key.indexOf(item) >= 0)) return i;
    }
    return -1;
  },
  KINDS: {
    created: '建单', dispatched: '派单', delivered: '送达', acked: '回执',
    started: '开工', submitted: '提交', verified: '验收', rejected: '退回',
    closed: '关单', close: '关单', submit: '提交', ack: '回执', deliver: '送达', dispatch: '派单', start: '开工', verify: '验收', reject: '退回', handoff: '交接', wake: '唤醒', comment: '备注', heartbeat: '心跳', event: '事件', progress: '进度', takeover: '接手'
  },
  kindOf: function (kind) {
    var key = this.norm(kind);
    return this.KINDS[key] || this.short(kind || '事件', 3);
  },
  agentIndex: function (snap, key) {
    var list = snap.agents || [];
    var k = this.norm(key);
    if (!k) return -1;
    var i;
    for (i = 0; i < list.length; i++) {
      if (this.norm(list[i].id) === k || this.norm(list[i].name) === k) return i;
    }
    for (i = 0; i < list.length; i++) {
      var name = this.norm(list[i].name);
      if (name && (name.indexOf(k) >= 0 || k.indexOf(name) >= 0)) return i;
    }
    return -1;
  },
  who: function (snap, name) {
    var list = snap.agents || [];
    var i = this.agentIndex(snap, name);
    return i >= 0 ? list[i].name : String(name || '');
  },
  flowText: function (snap, from, to, limit) {
    var a = this.who(snap, from), b = this.who(snap, to);
    return this.short(b ? a + ' → ' + b : a, limit || 18);
  },
  subscribe: function (fn) {
    if (!window.__WB) return;
    var ready = false;
    window.__WB.on(function (snap) {
      if (!ready) { ready = true; setTimeout(function () { fn(snap); }, 0); return; }
      fn(snap);
    });
  },
  pulses: function (snap, limit) { return (snap.pulses || []).slice(0, limit || 40); },
  digest: function (snap, limit) {
    var out = [], seen = {}, list = this.pulses(snap, 80);
    for (var i = 0; i < list.length; i++) {
      var p = list[i], key = (p.kind || '') + '|' + (p.text || '');
      if (!p.text || seen[key]) continue;
      seen[key] = true;
      out.push(p);
      if (out.length >= (limit || 20)) break;
    }
    return out;
  },
};
window.__WB = {
  snap: null,
  subs: [],
  push: function (snap) {
    this.snap = snap;
    for (var i = 0; i < this.subs.length; i++) {
      try { this.subs[i](snap); } catch (error) { console.error(error); }
    }
  },
  on: function (fn) {
    this.subs.push(fn);
    if (this.snap) { try { fn(this.snap); } catch (error) { console.error(error); } }
    return function () { this.subs = this.subs.filter(function (item) { return item !== fn; }); };
  }
};
</script>`;

/* ---------------- NEURAL 神经星环 ---------------- */
const NEURAL_MARKER = '/* ================= 2. 模拟状态（接真实数据时替换这一段） ================= */';
const NEURAL_ADAPTER = `/* ===== WBNEURAL 工作台真实数据 ===== */
(function () {
  var WB = window.__WB, U = window.__WBU;
  if (!WB || !U) return;
  var muted = false;
  var wbWork = 0, wbInstalled = false;
  var wbKey = '', wbDirty = true, wbPtC = null, wbLnC = null;
  var wbSeen = {}, wbSeenN = 0, wbPrimed = false;
  var wbCapSig = '', wbCapAt = 0;

  function wbHexOf(c) { return ((c[0] * 255) | 0) + ',' + ((c[1] * 255) | 0) + ',' + ((c[2] * 255) | 0); }
  function wbNearest(x, y, z) {
    var best = 0, bd = 1e9, c, q, d;
    for (c = 0; c < NCL; c++) {
      q = CL[c];
      d = (x - q.x) * (x - q.x) + (y - q.y) * (y - q.y) + (z - q.z) * (z - q.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /* 星环颜色在 buildBrain 时烤进了顶点属性；会话标识色变化后按最近神经团重新上色。 */
  function wbRecolor() {
    if (!glOK || !brainPts || !brainLines || !CL.length) return;
    wbDirty = false;
    var pg = brainPts.geometry, pp = pg.getAttribute('position'), pc = pg.getAttribute('col'), pgrp = pg.getAttribute('grp');
    var n = pp.count, i, c, k, v;
    if (!wbPtC || wbPtC.length !== n) {
      wbPtC = new Uint8Array(n);
      for (i = 0; i < n; i++) wbPtC[i] = wbNearest(pp.getX(i), pp.getY(i), pp.getZ(i));
    }
    for (i = 0; i < n; i++) {
      c = AGC[wbPtC[i]] || [1, 1, 1];
      k = pgrp.getX(i) === 13 ? 0.72 : 1;
      pc.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
    }
    pc.needsUpdate = true;
    var lg = brainLines.geometry, lp = lg.getAttribute('position'), lc = lg.getAttribute('col'), lgrp = lg.getAttribute('grp');
    var ln = lp.count;
    if (!wbLnC || wbLnC.length !== ln) {
      wbLnC = new Uint8Array(ln);
      for (i = 0; i < ln; i++) wbLnC[i] = wbNearest(lp.getX(i), lp.getY(i), lp.getZ(i));
    }
    for (i = 0; i < ln; i++) {
      c = AGC[wbLnC[i]] || [1, 1, 1];
      v = lgrp.getX(i);
      if (v === 13) c = [c[0] * 0.8 + 0.2, c[1] * 0.8 + 0.2, c[2] * 0.8 + 0.2];
      k = v === 13 ? 0.72 : 1;
      lc.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
    }
    lc.needsUpdate = true;
  }
  /* 协作脉动：默认慢频微亮，有会话在跑时换成更快的节律，突触束是主角。 */
  function wbInstall() {
    if (wbInstalled) return;
    wbInstalled = true;
    var capEl = SR.querySelector('#cap');
    var mCapEl = SR.querySelector('#mCap');
    var capKEl = SR.querySelector('#capK');
    var capTEl = SR.querySelector('#capT');
    try {
      var capStyle = document.createElement('style');
      capStyle.textContent = '#cap,#mCap{transition:opacity .7s ease}';
      SR.appendChild(capStyle);
    } catch (error) { /* 影子根不支持追加样式时保持原样 */ }
    var orig = updateScene;
    updateScene = function (dt) {
      orig(dt);
      var t = animT, i, b, hot;
      AF[0] = Math.max(AF[0], wbWork > 0 ? 0.55 + 0.18 * Math.sin(t * 4.4) : 0.45 + 0.1 * Math.sin(t * 0.95));
      for (i = 0; i < BUN.length; i++) {
        b = BUN[i];
        hot = AG[b.a].wbWork || AG[b.b].wbWork || (b.a === 0 && wbWork > 0);
        AF[b.g * 2] = Math.max(AF[b.g * 2], hot ? 0.5 + 0.26 * Math.sin(t * 4.8 + i * 1.6) : 0.2 + 0.1 * Math.sin(t * 1.05 + i * 1.1));
      }
      AF[26] = Math.max(AF[26], 0.12 + 0.06 * Math.sin(t * 1.35));
      AMBIENT.chatter = wbWork > 0 ? 3.4 : 1.3;
      AMBIENT.spark = wbWork > 0 ? 1.4 : 0.5;
      if (tapeRing) tapeRing.visible = false;
      for (i = 1; i < NCL; i++) {
        var aa = AG[i];
        if (aa.wbWork) {
          AF[i * 2] = Math.max(AF[i * 2], 0.5 + 0.26 * Math.sin(t * 6.4 + i * 1.9));
          /* 工作态行常亮：进度条与描边持续高亮，不随事件闪烁。 */
          aa.hitT = 1;
        } else {
          aa.hitT = 0;
        }
        /* 空位保持真正的待机：不再显示模拟任务与进度。 */
        if (aa.k === 'IDLE') {
          aa.cur = null;
          aa.prog = 0;
          aa.outs = 0;
          if (aa.inbox && aa.inbox.length) aa.inbox.length = 0;
        }
        /* 环带第二行跟随实时状态：在跑 / 排队 / 待命。 */
        aa.zh = aa.cur || aa.wbWork
          ? '在跑'
          : (aa.inbox && aa.inbox.length) || aa.wbOpen ? '排队' : '待命';
      }
      /* 突触日志（最近一次脉冲）只在触发时短暂出现，随后淡出。 */
      if (capEl) {
        var capSig = (capKEl ? capKEl.textContent : '') + '|' + (capTEl ? capTEl.textContent : '');
        var now = performance.now();
        if (capSig !== wbCapSig) { wbCapSig = capSig; wbCapAt = now; }
        var vis = now - wbCapAt < 3800 ? '1' : '0';
        if (capEl.style.opacity !== vis) capEl.style.opacity = vis;
        if (mCapEl && mCapEl.style.opacity !== vis) mCapEl.style.opacity = vis;
      }
      if (wbDirty) wbRecolor();
    };
    /* 环带：保留会话名称（24/19px），状态行换成工作台真实数据。 */
    function wbStatusLine(k) {
      var a = AG[k];
      if (!a) return;
      /* 状态行优先贴近左侧列表：在办单号 + 单名 + 进度，其次排队与今日完成。 */
      var txt = a.wbStatus || '';
      if (a.k === 'IDLE') {
        txt = '待接入 · 空闲位';
      } else if (k === 0) {
        var cLine = '';
        try { if (typeof lastDispatch === 'string') cLine = '派单 ' + lastDispatch + ' · 在途 ' + inFlight(); } catch (e) { /* 保持快照值 */ }
        txt = cLine || a.wbStatus || '';
      } else if (k === NCL - 1) {
        var rLine = '';
        try { if (typeof crawl !== 'undefined') rLine = '巡检 · 已读 ' + fmt(crawl.read) + ' 页'; } catch (e) { /* 保持快照值 */ }
        txt = rLine || a.wbStatus || '';
      } else if (a.cur) {
        txt = a.cur.id + ' · ' + U.short(a.cur.name || '在办', 5) + ' ' + Math.round((a.prog || 0) * 100) + '%';
      } else if (a.inbox && a.inbox.length) {
        txt = '排队 ' + a.inbox.length + ' · ' + a.inbox[0].id;
      } else if (!a.wbOwn) {
        txt = '待命 · 今日 ' + (a.outs || 0) + ' 单';
      }
      if (!txt) return;
      var th = secAng(k), flip = Math.sin(th + spinA()) < -1e-4;
      var w = (RW / NCL) * .93, on = k === 0 || a.cur || a.wbWork;
      var dots = (a.wbOpen || 0) + (a.inbox && a.inbox.length ? a.inbox.length : 0);
      drawAt(ringCtx, uOf(th) * RW, 78, flip, function (q) {
        q.textBaseline = 'middle';
        q.textAlign = 'left';
        q.font = '500 15px ' + MONO;
        q.fillStyle = on ? 'rgba(205,224,245,.72)' : 'rgba(188,208,232,.42)';
        q.fillText(txt, -w / 2 + 14, 13);
        if (dots > 0) {
          q.textAlign = 'right';
          q.globalAlpha = on ? 0.9 : 0.45;
          q.fillStyle = a.col;
          for (var p = 0; p < Math.min(4, dots); p++) q.fillRect(w / 2 - 13 - p * 9, 8, 6, 6);
          q.globalAlpha = 1;
        }
      });
    }
    var origRing = drawRing;
    drawRing = function () {
      var ft = ringCtx.fillText;
      ringCtx.fillText = function (text, x, y) {
        var mm = /([0-9]+)px/.exec(ringCtx.font || '');
        var px = mm ? parseFloat(mm[1]) : 0;
        if (px === 15 || px === 17) return;
        return ft.call(ringCtx, text, x, y);
      };
      try { origRing(); } finally { ringCtx.fillText = ft; }
      for (var k = 0; k < NCL; k++) wbStatusLine(k);
      ringTex.needsUpdate = true;
    };
  }
  /* 派单：一团星光沿着突触束飞向另一团星光，落点再扫一圈。 */
  function wbComet(snap, pulse) {
    var from = U.agentIndex(snap, pulse.from), to = U.agentIndex(snap, pulse.to);
    if (to < 0) to = from;
    if (to < 0) return;
    var a = from < 0 ? 0 : from + 1, b = to + 1, i;
    if (b > 12) b = 12;
    if (a === b) b = (a % 12) + 1;
    if (!glOK) return;
    sendSignal(a, b, AG[a].col, function () {}, 'dispatch');
    AG[a].flash = Math.max(AG[a].flash, 0.7);
    AG[b].flash = 1;
    AG[b].hitT = AG[b].wbWork ? 1.2 : 0;
    for (i = 0; i < BUN.length; i++) {
      if (BUN[i].a === Math.min(a, b) && BUN[i].b === Math.max(a, b)) { bunHot[BUN[i].g] = 1; break; }
    }
    scanAt(b);
  }
  function wbFire(snap) {
    var list = snap.pulses || [], i, p, key, fresh = [];
    for (i = 0; i < list.length && i < 40; i++) {
      p = list[i];
      if (!p || !p.at) continue;
      key = p.at + '|' + (p.kind || '') + '|' + (p.from || '') + '|' + (p.to || '') + '|' + (p.text || '');
      if (wbSeen[key]) continue;
      wbSeen[key] = 1;
      wbSeenN++;
      fresh.push(p);
    }
    if (wbSeenN > 400) { wbSeen = {}; wbSeenN = 0; }
    if (!wbPrimed) { wbPrimed = true; return; }
    var n = 0;
    for (i = 0; i < fresh.length && n < 2; i++) {
      key = U.norm(fresh[i].kind);
      if (key !== 'dispatch' && key !== 'dispatched' && key !== 'handoff' && key !== 'wake' && key !== 'takeover') continue;
      (function (pulse, delay) { window.setTimeout(function () { wbComet(snap, pulse); }, delay); })(fresh[i], n * 240);
      n++;
    }
  }
  var apply = function (snap) {
    if (!snap || !snap.agents || !snap.agents.length) return;
    if (!muted) {
      muted = true;
      log = function (ai) { if (AG[ai] && AG[ai].wbWork) AG[ai].hitT = 1.2; };
    }
    var list = snap.agents.slice(0, 12);
    var i;
    wbWork = 0;
    for (i = 0; i < 12; i++) {
      var src = list[i], ag = AG[i + 1];
      if (!ag) continue;
      if (!src) {
        ag.k = 'IDLE';
        ag.zh = '待命';
        ag.wbName = '待命';
        ag.role = '空闲位';
        ag.col = U.PALETTE[i % U.PALETTE.length];
        ag.wbWork = false;
        ag.wbStatus = '待接入 · 空闲位';
        ag.wbOpen = 0;
        ag.wbOwn = false;
        AGC[i + 1] = hex3(ag.col);
        continue;
      }
      ag.k = U.short(String(src.name || '').split('·')[0].trim(), 5);
      ag.zh = '';
      ag.wbName = ag.k;
      ag.role = U.short(src.role || src.scene || '会话', 12);
      ag.col = src.color || U.PALETTE[i % U.PALETTE.length];
      ag.wbWork = !!src.working;
      if (ag.wbWork) wbWork++;
      AGC[i + 1] = hex3(ag.col);
      /* 环带内容：在办单数、今日完成、最新一单的编号与简称。 */
      var openN = 0, doneN = 0, top = null;
      for (var j = 0; j < (snap.tasks || []).length; j++) {
        var task = snap.tasks[j];
        if (task.owner !== src.name && (task.flow || []).indexOf(src.name) < 0) continue;
        if (task.done) { doneN++; continue; }
        openN++;
        if (!top || (task.updatedAt || 0) > (top.updatedAt || 0)) top = task;
      }
      ag.wbOpen = openN;
      ag.wbDone = doneN;
      ag.wbOwn = openN > 0 || doneN > 0;
      ag.wbZh = ag.wbWork ? '在跑' : openN ? '排队' : '待命';
      ag.zh = ag.wbZh;
      ag.wbStatus = ag.wbWork
        ? (top ? U.short(top.id, 8) + ' · ' + U.short(top.title, 7) : '正在接力')
        : (openN
          ? '接单 ' + U.short(top.id, 8) + ' · ' + U.short(top.title, 7)
          : (doneN ? '今日完成 ' + doneN : '等派单 · ' + U.short(ag.role, 8)));
    }
    /* 中枢与巡检也给出可读的一行，避免环带出现空洞。 */
    var openAll = 0, doneAll = 0;
    for (i = 0; i < (snap.tasks || []).length; i++) {
      if (snap.tasks[i].done) doneAll++; else openAll++;
    }
    if (AG[0]) {
      AG[0].wbZh = '中枢';
      AG[0].wbOwn = true;
      var sesN = snap.stats && snap.stats.sessions ? snap.stats.sessions : list.length;
      AG[0].wbStatus = '会话 ' + sesN + ' · 在途 ' + openAll;
    }
    if (AG[NCL - 1]) {
      var evN = snap.stats && snap.stats.eventsToday ? snap.stats.eventsToday : 0;
      AG[NCL - 1].wbZh = '巡检';
      AG[NCL - 1].wbOwn = true;
      AG[NCL - 1].wbStatus = '巡检 · ' + evN + ' 条事件';
    }
    var ck = '';
    for (i = 0; i < AGC.length; i++) ck += wbHexOf(AGC[i]);
    if (ck !== wbKey) { wbKey = ck; wbDirty = true; }
    rows.forEach(function (row, index) {
      var kEl = row.el.querySelector('.k'), zEl = row.el.querySelector('.z');
      row.el.style.setProperty('--c', AG[index].col);
      if (kEl) kEl.textContent = AG[index].k;
      if (zEl) zEl.textContent = (AG[index].wbName || AG[index].zh) + ' · ' + AG[index].role;
    });
    var chains = (snap.tasks || []).filter(function (t) { return t.flow && t.flow.length >= 2; }).slice(0, 11);
    chains.forEach(function (task, index) {
      var path = task.flow
        .map(function (name) { var k = U.agentIndex(snap, name); return k < 0 || k > 11 ? -1 : k + 1; })
        .filter(function (k) { return k > 0; });
      WF[index] = {
        id: WF[index].id,
        zh: U.short(task.stage || '链路', 4),
        ch: WF[index].ch,
        path: path.length >= 2 ? path : WF[index].path,
        names: [U.short(task.title, 14)]
      };
    });
    feed.length = 0;
    U.digest(snap, 20).forEach(function (p) {
      var who = U.agentIndex(snap, p.to);
      if (who < 0) who = U.agentIndex(snap, p.from);
      feed.push({
        t: U.when(p.at),
        a: who < 0 || who > 11 ? 0 : who + 1,
        verb: U.kindOf(p.kind),
        text: U.short(p.text || U.flowText(snap, p.from, p.to, 16), 16),
        kind: ''
      });
    });
    feedDirty = capDirty = tapeDirty = true;
    if (feed[0]) {
      caption = { a: feed[0].a, verb: feed[0].verb, text: feed[0].text, kind: '' };
      lastDispatch = String(feed[0].text).split(' ')[0];
    }
    if (snap.stats) {
      window.__wbNeuralStats = snap.stats;
      total = snap.stats.doneToday || 0;
      passN = snap.stats.doneToday || 0;
      failN = snap.stats.overdue || 0;
      crawl.read = snap.stats.eventsToday || 0;
      crawl.patrols = snap.stats.handoffs || 0;
    }
    if (!window.__wbNeuralPatched) {
      window.__wbNeuralPatched = true;
      var origBottom = renderBottom;
      renderBottom = function () {
        origBottom();
        var st = window.__wbNeuralStats || {};
        var done = st.doneToday || 0, bad = st.overdue || 0;
        $('#bOut').textContent = fmt(done);
        $('#bOutS').innerHTML = '今日完成 <b>' + done + '</b> · 在跑 <b>' + (st.working || 0) + '</b> · 会话 <b>' + (st.sessions || 0) + '</b>';
        $('#bPass').textContent = (done / Math.max(1, done + bad) * 100).toFixed(1) + '%';
        $('#bPassS').innerHTML = '通过 <b>' + done + '</b> · 打回 <b>' + bad + '</b>';
        $('#cwR').textContent = fmt(st.eventsToday || 0);
        $('#cwP').textContent = fmt(st.handoffs || 0);
      };
    }
    U.stamp(SR.querySelector('.sub2'), '真实会话 · ' + (snap.stats.sessions || list.length) + ' 个会话接力 · ' + (snap.stats.orders || 0) + ' 单派单');
    U.set(SR, '.hd .sub', 'CHIEF 拆单 · ' + list.length + ' 个会话接力 · CRAWLER 巡检');
    U.set(SR, '.m-title i', '神经星环 · 真实会话');
    wbInstall();
    wbFire(snap);
  };
  U.subscribe(apply);
})();
`;

function insertBefore(html, marker, token, block) {
  if (!marker || !html.includes(marker) || html.includes(token)) return html;
  return html.replace(marker, `${block}\n${marker}`);
}

function patchAgentDisplay(html) {
  let out = String(html || '');
  if (!out.includes('<html')) return out;

  if (!out.includes(BRIDGE_MARKER)) {
    out = out.replace('</head>', `${BRIDGE}\n</head>`);
  }

  out = insertBefore(out, NEURAL_MARKER, 'WBNEURAL 工作台真实数据', NEURAL_ADAPTER);

  return out;
}

module.exports = { patchAgentDisplay, PATCH_TAG };
