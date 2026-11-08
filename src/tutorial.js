/* Codex Beasts — first Campaign feature: the mandatory five-stage trial.
   Hooks the live scanner, navigation, items, and battle (v17.1). Does not
   replace damage, movement, biomes, or saves. See tutorial-core.js for the
   migration and reward rules. */
(function () {
  "use strict";
  var Core = window.CBTutorialCore;
  if (!Core) { console.warn("tutorial: core missing"); return; }

  /* Magic energy is a battle pool specials spend. It is not the Essence
     damage stat and not the cooldown. One special costs ME.cost. The start
     of that creature's turn restores ME.regen, so a single special each
     turn stays affordable. A second special in the same turn, or a pool
     below the cost, is refused. */
  var ME = { max: 8, cost: 4, regen: 4 };
  function magicCost(a) { return a && a.t === "ess" && a.k !== "st" ? ME.cost : 0; }
  function ensureMe(u) {
    if (!u) return;
    if (!u.meMax) u.meMax = ME.max;
    if (u.me == null) u.me = u.meMax;
  }
  function recoverMagic(u) {
    if (!u || !u.alive) return 0;
    ensureMe(u);
    var before = u.me | 0;
    u.me = Math.min(u.meMax, before + ME.regen);
    return u.me - before;
  }

  var SAVE_KEY = "codexbeasts.v1";
  var boardN = 8;

  function save() { return (window.CB && CB.save) ? CB.save() : null; }
  function tut() { var s = save(); return s && s.tutorial; }
  function writeSave() {
    try {
      if (!localStorage.getItem(SAVE_KEY)) return;
      var s = save();
      if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function toast(m) { try { if (typeof window.toast === "function") window.toast(m); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]; }); }
  function Nof(st) { return st && st.map ? Math.round(Math.sqrt(st.map.length)) || boardN : boardN; }
  function unitNow(st) {
    if (!st || !st.queue) return null;
    return st.units[st.queue[st.qi]] || null;
  }
  function battleOn() {
    try { return typeof B !== "undefined" && B && B.tutorial; } catch (e) { return false; }
  }
  function allowScreen(screen) {
    return Core.screenAllowed(tut(), screen, battleOn());
  }

  function bootMigrate() {
    var s = save();
    if (!s) return;
    var had = !!(s.tutorial && s.tutorial.v);
    var res = Core.migrate(s);
    Core.normalize(s);
    if ((res.changed || !had) && localStorage.getItem(SAVE_KEY)) writeSave();
  }

  function paintLock() {
    var on = Core.gatesClosed(tut());
    document.body.classList.toggle("tut-lock", on);
    var cam = document.getElementById("camBtn");
    var man = document.getElementById("manBtn");
    var manual = document.getElementById("manual");
    if (on) {
      if (cam) cam.disabled = true;
      if (man) man.disabled = true;
      if (manual) manual.disabled = true;
    }
    var note = document.getElementById("tutEnergyNote");
    var host = document.getElementById("energy");
    if (!host) return;
    if (!note) { note = document.createElement("div"); note.id = "tutEnergyNote"; note.className = "tut-energy"; host.appendChild(note); }
    var t = tut();
    if (!t) { note.textContent = ""; return; }
    var n = 0;
    try { n = window.energy ? energy() : 0; } catch (e) { n = 0; }
    if (t.status === "active") note.innerHTML = "Trial in progress. Scanning is sealed. Finishing unlocks today's remaining scans: <b>" + n + "</b>. No extra scans are added.";
    else if (t.status === "await-scan") note.innerHTML = "A new Tracer may complete <b>one</b> summon. The five-stage trial is required after that.";
    else note.textContent = "";
  }

  function hook(name, fn) {
    var o = window[name];
    if (typeof o !== "function") return;
    window[name] = fn(o);
  }

  hook("addCode", function (orig) {
    return function (raw, src) {
      var t = tut();
      var friend = String(raw || "").trim().indexOf("CBX1|") === 0;
      var decision = Core.scanDecision(t, {friend: friend, energy: (function(){ try { return energy(); } catch (e) { return 1; } })()});
      if (!decision.allow) { toast(decision.message || "Scanning is sealed."); paintLock(); return false; }
      var s = save();
      var before = s && s.order ? s.order.length : 0;
      var result;
      try { result = orig.apply(this, arguments); }
      finally { try { noteSummon(raw, before); } catch (e) { console.warn(e); } }
      return result;
    };
  });

  function noteSummon(raw, before) {
    var s = save();
    var t = s && s.tutorial;
    if (!s || !t || t.status !== "await-scan") { paintLock(); return; }
    if (!s.order || s.order.length !== before + 1) { paintLock(); return; }
    var code = (typeof normCode === "function") ? normCode(raw) : String(raw || "").trim();
    if (s.order.indexOf(code) < 0) code = s.order[s.order.length - 1];
    Core.onFirstSummon(t, code);
    writeSave();
    paintLock();
    renderCampaign();
    announce();
  }

  function announce() {
    var t = tut();
    if (!t || t.status !== "active") return;
    var old = document.getElementById("tutCall");
    if (old) old.remove();
    var d = document.createElement("div");
    d.id = "tutCall";
    d.className = "toast";
    d.style.zIndex = "80";
    d.innerHTML = "Your first beast is bound. The five-stage trial comes before any other scan.<br><button class='pri' id='tutOpen' style='margin-top:6px'>Open the chart</button>";
    (document.getElementById("toasts") || document.body).appendChild(d);
    var b = d.querySelector("#tutOpen");
    if (b) b.onclick = function () { d.remove(); if (typeof show === "function") show("campaign"); };
  }

  hook("startCam", function (orig) {
    return async function () {
      if (Core.gatesClosed(tut())) { toast("The trial is open. The scanner stays sealed."); paintLock(); return; }
      return orig.apply(this, arguments);
    };
  });
  hook("scanFrame", function (orig) {
    return async function () {
      if (Core.gatesClosed(tut())) return;
      return orig.apply(this, arguments);
    };
  });
  hook("show", function (orig) {
    return function (screen) {
      if (!allowScreen(screen)) {
        toast("Finish the five-stage trial before the rest of the Codex.");
        screen = "campaign";
      }
      var r = orig.call(this, screen);
      if (screen === "campaign") {
        var camp = document.getElementById("s-campaign");
        if (camp) camp.classList.remove("pflip");
        renderCampaign();
      }
      if (screen === "scan") paintLock();
      if (screen !== "battle") { clearCoach(); var bar = document.getElementById("meBar"); if (bar) bar.remove(); }
      return r;
    };
  });
  hook("startBattle", function (orig) {
    return function () {
      if (Core.gatesClosed(tut()) && !(battleOn() && B._startingTutorial)) {
        toast("Open battles wait until the trial is won.");
        if (typeof show === "function") show("campaign");
        return;
      }
      return orig.apply(this, arguments);
    };
  });
  hook("buyItem", function (orig) {
    return function () {
      if (Core.gatesClosed(tut())) { toast("The market waits until the trial ends."); return; }
      return orig.apply(this, arguments);
    };
  });
  hook("buyRefresh", function (orig) {
    return function () {
      if (Core.gatesClosed(tut())) { toast("Scanner refresh waits until the trial ends."); return; }
      return orig.apply(this, arguments);
    };
  });
  hook("releaseCreature", function (orig) {
    return function (code) {
      var t = tut();
      var s = save();
      if (t && (t.status === "active" || t.status === "await-scan") && s && ((s.order || []).length <= 1 || code === t.creature)) {
        toast("This beast is bound to the trial and cannot be released.");
        return false;
      }
      return orig.apply(this, arguments);
    };
  });
  hook("renderEnergy", function (orig) {
    return function () {
      var r = orig.apply(this, arguments);
      paintLock();
      return r;
    };
  });
  hook("newGame", function (orig) {
    return function (nm, em, col, pack) {
      var r = orig.apply(this, arguments);
      var s = save();
      if (s) {
        if (pack) {
          s.col = {};
          s.order = [];
          s.team = [];
          s.team2 = [];
          if (s.tracer) s.tracer.seen = [];
          toast("The starter pack opens after the five-stage trial. One barcode comes first.");
        }
        s.tutorial = Core.fresh();
        writeSave();
      }
      paintLock();
      if (pack && typeof show === "function") show("scan");
      return r;
    };
  });
  hook("newGameForm", function (orig) {
    return function () {
      var r = orig.apply(this, arguments);
      var box = document.querySelector("#starter");
      if (box) {
        box.checked = false;
        box.disabled = true;
        if (box.parentNode && !box.parentNode.querySelector(".tut-packnote")) {
          var note = document.createElement("small");
          note.className = "tut-packnote";
          note.textContent = " Opens after the five-stage trial.";
          box.parentNode.appendChild(note);
        }
      }
      return r;
    };
  });

  function snapshot() {
    var s = save();
    if (!s) return null;
    return {
      inv: JSON.parse(JSON.stringify(s.inv || [])),
      col: JSON.parse(JSON.stringify(s.col || {})),
      order: (s.order || []).slice(),
      team: (s.team || []).slice(),
      team2: (s.team2 || []).slice(),
      wins: s.wins || 0,
      shards: s.tracer ? s.tracer.shards : 0,
      txp: s.tracer ? s.tracer.xp : 0,
      tlvl: s.tracer ? s.tracer.lvl : 1,
      crystals: s.tracer ? (s.tracer.crystals || 0) : 0,
      ms: s.ms ? JSON.parse(JSON.stringify(s.ms)) : null,
      lure: s.lure || null
    };
  }
  function restore(snap) {
    var s = save();
    if (!s || !snap) return;
    s.inv = snap.inv;
    s.col = snap.col;
    s.order = snap.order;
    s.team = snap.team;
    s.team2 = snap.team2;
    s.wins = snap.wins;
    if (s.tracer) {
      s.tracer.shards = snap.shards;
      s.tracer.xp = snap.txp;
      s.tracer.lvl = snap.tlvl;
      s.tracer.crystals = snap.crystals;
    }
    if (snap.ms) s.ms = snap.ms;
    s.lure = snap.lure;
    writeSave();
  }

  function findCode(el) {
    if (!findCode.cache) findCode.cache = {};
    if (findCode.cache[el]) return findCode.cache[el];
    var gen = window.gen;
    var best = null;
    for (var n = 0; n < 30000; n++) {
      var code = String(n).padStart(12, "0");
      var c = gen(code, 1);
      if (c.el === el && c.rar === 0) { findCode.cache[el] = code; return code; }
      if (!best && c.el === el) best = code;
    }
    findCode.cache[el] = best;
    return best;
  }

  function layout(st, stage) {
    var N = Nof(st);
    st.feat = st.feat.map(function () { return 0; });
    if (stage >= 5) {
      /* A few rough tiles and one rise, no pits or walls, so a lone beast cannot be boxed in. */
      st.feat[N * 4 + 2] = 1;
      st.feat[N * 3 + 5] = 2;
    }
    var p = st.units.filter(function (u) { return u.side === 0; })[0];
    var e = st.units.filter(function (u) { return u.side === 1; })[0];
    if (p) { p.x = 3; p.y = 6; p.hp = p.c.hp; }
    if (e) {
      if (stage === 2) { e.x = 3; e.y = 5; }
      else if (stage === 3 || stage === 4) { e.x = 3; e.y = 4; }
      else { e.x = 4; e.y = 4; }
      e.hp = e.c.hp;
    }
    st.stash = [];
  }

  function dummyHit(player, foe, biome, ability) {
    var st = {biome: biome, map: new Array(boardN * boardN).fill(biome), feat: new Array(boardN * boardN).fill(0)};
    var A = {c: player, x: 0, y: 0, side: 0, hp: player.hp};
    var D = {c: foe, x: 1, y: 0, side: 1, hp: foe.hp};
    return calcDmg(st, A, 0, 0, D, ability);
  }

  function tuneFoe(player, enemyEl, biome, stage) {
    var code = findCode(enemyEl);
    if (!code) return null;
    var lvl = Math.max(1, (player.lvl || 5) - 1);
    var foe = gen(code, lvl, 0, {a1: 1, a2: 1}, 0, true);
    foe.cv = null;
    foe.cvt = "";
    var ess = (player.ab || []).filter(function (a) { return a && a.t === "ess" && !a.locked; })[0] || player.ab[0];
    var strike = {k: "st", n: "Strike", t: "phys", r: 1, pw: 1, cd: 0};
    var hit = dummyHit(player, foe, biome, ess);
    if (stage < 5) {
      foe.hp = Math.max(foe.hp, (hit.dmg || 1) * 30);
      return {foe: foe, ess: ess, hit: hit};
    }
    var guard = 0;
    function enemyStrike() {
      var back = dummyHit(foe, player, biome, strike);
      var essBack = foe.ab && foe.ab[0] ? dummyHit(foe, player, biome, foe.ab[0]) : back;
      return Math.max(back.dmg || 1, essBack.dmg || 1);
    }
    while (enemyStrike() * 5 >= player.hp && guard++ < 10) {
      foe.pow = Math.max(4, Math.round(foe.pow * 0.72));
      foe.ess = Math.max(4, Math.round(foe.ess * 0.72));
    }
    hit = dummyHit(player, foe, biome, ess);
    foe.hp = Math.max((hit.dmg || 1) * 3, (hit.dmg || 1) + 1);
    return {foe: foe, ess: ess, hit: hit};
  }

  function predictWin(player, foe, biome) {
    var st = newBattle([player], [foe], 7, {domA: null, biome: biome});
    layout(st, 5);
    st.tutorial = null;
    var steps = 0;
    while (!st.over && steps++ < 80) {
      var u = unitNow(st);
      if (!u || !u.alive) { nextTurn(st); continue; }
      var plan = aiPlan(st, u);
      if (plan) {
        doMove(st, u, plan.x, plan.y);
        if (plan.a && plan.t) doAct(st, u, plan.a, plan.t);
      }
      nextTurn(st);
    }
    return st.winner === 0;
  }

  function ensureFair(player, pack, biome) {
    var foe = pack.foe;
    var tries = 0;
    while (tries++ < 6 && !predictWin(player, foe, biome)) {
      foe.pow = Math.max(4, Math.round(foe.pow * 0.75));
      foe.ess = Math.max(4, Math.round(foe.ess * 0.75));
      var ess = pack.ess;
      var hit = dummyHit(player, foe, biome, ess);
      foe.hp = Math.max((hit.dmg || 1) * 3, (hit.dmg || 1) + 1);
    }
    return foe;
  }

  function playerCreature() {
    var s = save();
    var t = tut();
    if (!s) return null;
    var code = t && t.creature && s.col[t.creature] ? t.creature : (s.order || [])[0];
    if (!code || typeof owned !== "function") return null;
    t && (t.creature = code);
    return owned(code);
  }

  function startStage(stage) {
    var t = tut();
    var gate = Core.canStart(t, stage);
    if (!gate.ok) {
      toast(gate.reason === "order" ? "Later stages stay shut until the glowing one is cleared." : "That stage is not open.");
      return false;
    }
    var player = playerCreature();
    if (!player) { toast("The trial needs your first beast."); return false; }
    var match = null;
    if (stage >= 4) {
      match = Core.matchup(player.el, {cv: player.cv || null});
      if (!match.ok) { toast(match.text); return false; }
    }
    var biome = match ? match.biome : (player.el === "Water" ? "Water" : "Plains");
    var foe = null;
    if (stage > 1) {
      var enemyEl = stage >= 4 ? match.enemyEl : player.el;
      /* Stages 2–3 may face any element. Stages 4–5 must be the chart disadvantage. */
      if (stage < 4) enemyEl = Core.disadvantageElement(player.el) || player.el;
      var pack = tuneFoe(player, enemyEl, biome, stage);
      if (!pack) { toast("No foe could be called."); return false; }
      foe = stage === 5 ? ensureFair(player, pack, biome) : pack.foe;
    }
    var snap = snapshot();
    var teamsB = foe ? [foe] : [];
    B = newBattle([player], teamsB, 11 + stage, {domA: null, biome: biome});
    B.mode = "ai";
    B.tutorial = {stage: stage, hit: null, playerActs: 0, match: match};
    B._snap = snap;
    B._startingTutorial = true;
    layout(B, stage);
    B.stash = [];
    dismissCall();
    if (typeof show === "function") show("battle");
    B._startingTutorial = false;
    buildBoard();
    B.stash = [];
    B.units.forEach(ensureMe);
    if (stage === 3) {
      var learner = B.units.filter(function (u) { return u.side === 0; })[0];
      var art = learner && (learner.c.ab || []).filter(function (a) { return a.t === "ess" && !a.locked; })[0];
      if (learner) { learner.meMax = magicCost(art) || ME.cost; learner.me = learner.meMax; }
    }
    beginTurn();
    paintCoach();
    paintMagic();
    return true;
  }

  function finishLesson(stage) {
    if (finishLesson.busy) return;
    var t = tut();
    if (!t || t.status !== "active" || t.stage !== stage || t.cleared[stage - 1]) return;
    if (typeof B === "undefined" || !B || !B.tutorial || B.tutorial.stage !== stage) return;
    finishLesson.busy = true;
    try {
      restore(B._snap);
      var adv = Core.advance(t, stage);
      if (!adv.ok) return;
      writeSave();
      B = null;
      clearCoach();
      if (typeof show === "function") show("campaign");
      toast("Stage " + stage + " cleared.");
    } finally { finishLesson.busy = false; }
  }

  function grantPotions() {
    var t = tut();
    var plan = Core.rewardPlan(t);
    if (!plan.grant) return 0;
    var n = 0;
    for (var i = 0; i < plan.grant; i++) {
      var it = grantItem(plan.item, Core.POTION_SRC, true);
      if (!it) break;
      n++;
    }
    Core.notePotions(t, n);
    writeSave();
    return n;
  }

  function remaining() {
    try { return energy(); } catch (e) { return 0; }
  }

  function finishVictory() {
    var t = tut();
    if (!t) return;
    var snap = B && B._snap;
    restore(snap);
    var adv = Core.advance(t, 5);
    if (!adv.ok) { B = null; clearCoach(); if (typeof show === "function") show("campaign"); return; }
    var n = grantPotions();
    var scans = Core.scansAfterClear(remaining());
    writeSave();
    B = null;
    clearCoach();
    if (typeof show === "function") show("campaign");
    var m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = "<div class='box' id='tutVictory'><h2>The chart is yours</h2><p>The trial is complete. Today's remaining scans are open: <b>" + scans + "</b>. Nothing extra was added.</p><p>Healing potions, once: <b>" + n + " Healing Potions</b>.</p><button class='pri' id='tutDone' style='width:100%'>Walk the Codex</button></div>";
    document.body.appendChild(m);
    m.querySelector("#tutDone").onclick = function () { m.remove(); };
  }

  function finishDefeat() {
    restore(B && B._snap);
    var code = tut() && tut().creature;
    B = null;
    clearCoach();
    if (typeof show === "function") show("campaign");
    var still = save() && code && save().col[code];
    var m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = "<div class='box' id='tutVictory'><h2>Recalled</h2><p>" + (still ? "Your beast is still with you, at full health. Nothing was taken from your pack." : "Your roster was left as it was.") + "</p><button class='pri' id='tutRetry' style='width:100%;margin-bottom:6px'>Try the proving again</button><button id='tutBack' style='width:100%'>Return to the chart</button></div>";
    document.body.appendChild(m);
    m.querySelector("#tutRetry").onclick = function () { m.remove(); startStage(5); };
    m.querySelector("#tutBack").onclick = function () { m.remove(); };
  }

  hook("checkOver", function (orig) {
    return function (st) {
      if (st && st.tutorial && st.tutorial.stage < 5) return;
      return orig.apply(this, arguments);
    };
  });
  hook("doMove", function (orig) {
    return function (st, u, x, y) {
      var ox = u.x, oy = u.y;
      var r = orig.apply(this, arguments);
      if (st && st.tutorial && st.tutorial.stage === 1 && u && u.side === 0 && (u.x !== ox || u.y !== oy)) {
        st.tutorial.hit = "move";
        setTimeout(function () { if (st.tutorial && st.tutorial.hit === "move") finishLesson(1); }, 450);
      }
      return r;
    };
  });
  hook("newBattle", function (orig) {
    return function () {
      var st = orig.apply(this, arguments);
      if (st && st.units) st.units.forEach(ensureMe);
      return st;
    };
  });
  hook("nextTurn", function (orig) {
    return function (st) {
      var r = orig.apply(this, arguments);
      if (!st || st.over) return r;
      var u = st.queue ? st.units[st.queue[st.qi]] : null;
      var gained = recoverMagic(u);
      if (gained > 0 && st === B) {
        var note = document.getElementById("meBar");
        if (note) note.dataset.gain = "+" + gained;
      }
      return r;
    };
  });
  hook("aiPlan", function (orig) {
    return function (st, u) {
      var plan = orig.apply(this, arguments);
      if (plan && plan.a && magicCost(plan.a) > ((u && u.me) || 0)) {
        var key = plan.a.k;
        var prev = u.cd ? u.cd[key] : 0;
        if (u.cd) u.cd[key] = 99;
        var again = orig.call(this, st, u);
        if (u.cd) u.cd[key] = prev;
        return again;
      }
      return plan;
    };
  });
  hook("panelTurn", function (orig) {
    return function () {
      var r = orig.apply(this, arguments);
      try {
        var u = ui && ui.sel;
        if (!u) return r;
        ensureMe(u);
        document.querySelectorAll("#bPanel .acts button").forEach(function (b) {
          var a = (typeof actsOf === "function" ? actsOf(u) : []).filter(function (act) {
            return b.textContent.replace(/^\s+/, "").indexOf(act.n) === 0;
          })[0];
          var cost = magicCost(a);
          if (!cost) return;
          b.insertAdjacentHTML("beforeend", "<br><span class='mecost'>" + cost + " magic energy</span>");
          if ((u.me | 0) < cost) {
            b.disabled = true;
            b.insertAdjacentHTML("beforeend", "<br><span>Not enough magic energy</span>");
          }
        });
      } catch (e) {}
      return r;
    };
  });
  hook("doAct", function (orig) {
    return function (st, u, a, t, mul) {
      var cost = magicCost(a);
      if (u && cost) {
        ensureMe(u);
        if ((u.me | 0) < cost) {
          if (st === B) toast("Not enough magic energy. It returns at the start of your turn.");
          return {dmg: 0, em: 1, bm: 1, res: 1, bst: 1, heal: 0, eff: null, kill: false, noMe: true, meSpent: 0, cost: cost};
        }
        u.me -= cost;
      }
      var res = orig.apply(this, arguments);
      if (res && cost) { res.meSpent = cost; res.meLeft = u.me; if (st === B) { paintMagic(); if (st.tutorial) paintCoach(); } }
      if (st && st.tutorial && u && u.side === 0 && a && !(res && res.noMe)) {
        st.tutorial.playerActs = (st.tutorial.playerActs || 0) + 1;
        var stage = st.tutorial.stage;
        if (stage === 2 && a.k === "st" && res && res.dmg > 0) st.tutorial.hit = "strike";
        if (stage === 3 && a.t === "ess" && a.k === "a1" && res && res.dmg > 0 && res.meSpent > 0) st.tutorial.hit = "special";
        if (stage === 4 && a.t === "ess" && res && res.em > 1 && res.dmg > 0) st.tutorial.hit = "super";
      }
      return res;
    };
  });
  hook("beginTurn", function (orig) {
    return function () {
      if (battleOn() && B.tutorial.hit && B.tutorial.stage < 5) {
        finishLesson(B.tutorial.stage);
        return;
      }
      var r = orig.apply(this, arguments);
      paintCoach();
      paintMagic();
      return r;
    };
  });
  hook("aiAnimate", function (orig) {
    return function (u) {
      if (battleOn() && B.tutorial.stage < 5) {
        nextTurn(B);
        beginTurn();
        return;
      }
      return orig.apply(this, arguments);
    };
  });
  hook("endBattle", function (orig) {
    return function () {
      if (battleOn() && B.tutorial.stage === 5) {
        var win = B.winner === 0;
        var acts = B.tutorial.playerActs || 0;
        if (win && acts < 1) {
          toast("A victory has to be earned in the fight.");
          finishDefeat();
          return;
        }
        if (win) finishVictory();
        else finishDefeat();
        return;
      }
      return orig.apply(this, arguments);
    };
  });
  hook("syncTokens", function (orig) {
    return function () {
      var r = orig.apply(this, arguments);
      paintCoach();
      paintMagic();
      return r;
    };
  });
  hook("placeStashes", function (orig) {
    return function (st) {
      if (st && st.tutorial) return [];
      return orig.apply(this, arguments);
    };
  });

  function clearCoach() {
    document.body.classList.remove("tut-battle");
    var c = document.getElementById("tutCoach");
    if (c) c.remove();
  }
  function paintCoach() {
    if (!battleOn() || !document.getElementById("s-battle")) { document.body.classList.remove("tut-battle"); return; }
    document.body.classList.add("tut-battle");
    var stage = B.tutorial.stage;
    var s = save();
    var player = (B.units || []).filter(function (u) { return u.side === 0; })[0];
    var c = player && player.c;
    var ab = c && (c.ab || []).filter(function (a) { return a.t === "ess" && !a.locked; })[0];
    var info = {
      tracer: s && s.tracer && s.tracer.name,
      creature: c && c.name,
      origin: originLine(c),
      ability: ab && ab.n,
      essence: c && c.ess,
      cooldown: ab && ab.cd,
      magic: player && player.me,
      magicCost: magicCost(ab),
      magicRegen: ME.regen,
      matchText: B.tutorial.match && B.tutorial.match.text
    };
    var brief = Core.stageBrief(stage, info);
    var host = document.getElementById("dio") || document.getElementById("s-battle");
    var el = document.getElementById("tutCoach");
    if (!el) { el = document.createElement("div"); el.id = "tutCoach"; host.appendChild(el); }
    el.innerHTML = "<span class='who'>" + esc(info.tracer ? ("Tracer " + info.tracer) : "Tracer") + (c ? " · " + esc(c.base) : "") + " · stage " + stage + " of 5</span><b>" + esc(brief.title) + "</b><span class='ask'>" + esc(brief.ask || "") + "</span><span class='body'>" + esc(brief.body) + "</span>";
  }
  function originLine(c) {
    if (!c) return "a story with more than one beginning";
    if (c.origin === "Mythology") return "mythology";
    if (c.origin === "Cryptid") return "an urban legend";
    if (c.origin === "Fantasy") return "a being created through story and craft, not one ancient cult";
    return c.origin || "a story with more than one beginning";
  }

  function nodeClass(t, stage) {
    if (t && t.cleared && t.cleared[stage - 1]) return "done";
    if (t && t.status === "active" && t.stage === stage) return "yellow now";
    return "yellow locked";
  }
  function paintMagic() {
    if (typeof B === "undefined" || !B || !B.units || !document.getElementById("s-battle")) return;
    var u = B.queue ? B.units[B.queue[B.qi]] : null;
    if (!u || !u.alive) u = B.units.filter(function (x) { return x.side === 0 && x.alive; })[0];
    if (!u) return;
    ensureMe(u);
    var host = document.getElementById("dio") || document.getElementById("s-battle");
    var bar = document.getElementById("meBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "meBar"; host.appendChild(bar); }
    var pct = Math.max(0, Math.min(100, Math.round(100 * (u.me || 0) / u.meMax)));
    var dry = (u.me | 0) < ME.cost;
    bar.className = dry ? "dry" : "";
    var gain = bar.dataset.gain ? " " + bar.dataset.gain : "";
    bar.innerHTML = "<span>Magic energy " + (u.me | 0) + "/" + u.meMax + gain + "</span><b><i style=\"width:" + pct + "%\"></i></b>" + (dry ? "<em>Not enough magic energy</em>" : "");
    var acts = (typeof actsOf === "function") ? actsOf(u) : [];
    document.querySelectorAll("#g16cards .sc").forEach(function (btn, i) {
      var a = acts[i];
      if (!a || btn.querySelector(".mecost")) return;
      var cost = magicCost(a);
      if (!cost) return;
      var s = document.createElement("small");
      s.className = "mecost";
      s.textContent = cost + " energy";
      btn.appendChild(s);
      if ((u.me | 0) < cost) btn.classList.add("cd");
    });
  }

  function dismissCall() {
    var call = document.getElementById("tutCall");
    if (call) call.remove();
  }
  function renderCampaign() {
    dismissCall();
    var root = document.getElementById("s-campaign");
    if (!root) return;
    var t = tut() || Core.fresh();
    var s = save();
    var player = null;
    try { player = playerCreature(); } catch (e) {}
    var match = player ? Core.matchup(player.el, {cv: player.cv || null}) : null;
    var brief = (t.status === "active" && t.stage) ? Core.stageBrief(t.stage, {
      tracer: s && s.tracer && s.tracer.name,
      creature: player && player.name,
      origin: originLine(player),
      ability: player && player.ab && player.ab[0] && player.ab[0].n,
      essence: player && player.ess,
      cooldown: player && player.ab && player.ab[0] && player.ab[0].cd,
      matchText: match && match.text
    }) : null;
    var lead = "Five stages, in order. Every unfinished stage glows yellow. A finished stage turns solid green. You cannot skip ahead.";
    if (t.status === "await-scan") lead = "The chart is awake, but the first stage opens after one barcode beast answers.";
    if (t.status === "skipped" && t.legacy) lead = "This Codex was already walked before the trial existed. Your beasts and items are unchanged, and the five potions were not added. You may revisit the lessons; they will not pay twice.";
    if (t.status === "complete" && !t.replay) lead = "The five stages are sealed. The roads of the Codex are open.";
    var nodes = "<ol class='tut-road'>" + Core.STAGES.map(function (st, i) {
      var cls = nodeClass(t, st.id);
      var mark = cls === "done" ? "✓" : (cls.indexOf("now") >= 0 ? "●" : "○");
      var join = i ? "<i class='tut-join'></i>" : "";
      return "<li>" + join + "<button type='button' class='tut-node " + cls + "' data-stage='" + st.id + "'><span class='n'>" + mark + " " + st.id + "</span>" + esc(st.name) + "<small>" + esc(st.kicker) + (cls.indexOf("now") >= 0 ? " · now" : "") + "</small></button></li>";
    }).join("") + "</ol>";
    var go = "";
    if (t.status === "active") go = "<button class='tut-go' id='tutGo'>Enter stage " + t.stage + "</button>";
    var again = (t.status === "complete" || t.status === "skipped") ? "<button class='tut-replay' id='tutReplay'>Revisit the trial · no extra potions</button>" : "";
    var guide = brief ? "<div class='tut-guide'><b>Stage " + t.stage + " · " + esc(brief.title) + "</b><br>" + esc(brief.ask || "") + "<br>" + esc(brief.body) + "</div>" : "";
    root.innerHTML = "<div class='scrhead'><h1>Campaign</h1><button class='homeb' id='tutHome'>🏠 Menu</button></div>" +
      "<div class='tut-frame'><div class='tut-scroll' id='tutScroll'><div class='tut-parchment' id='tutMap'>" +
      "<i class='tut-seal tl'></i><i class='tut-seal tr'></i><i class='tut-seal bl'></i><i class='tut-seal br'></i>" +
      "<div class='tut-kicker'>Field chart</div><h2>The First Tracing</h2>" +
      "<p class='tut-lead'>" + esc(lead) + "</p>" +
      nodes + guide + go + again +
      "<p class='tut-note'>Codex Beasts come from mythology, lore, and urban legend, or were created through more than one means. This chart teaches the field. It is not a longer campaign.</p>" +
      "</div></div></div>";
    var home = document.getElementById("tutHome");
    if (home) home.onclick = function () { if (typeof showTitle === "function") showTitle(true); };
    root.querySelectorAll(".tut-node").forEach(function (btn) {
      btn.onclick = function () {
        var stage = +btn.dataset.stage;
        var cur = tut();
        if (!cur || cur.status !== "active") { toast("The trial is not waiting on that node."); return; }
        if (cur.cleared[stage - 1]) { toast("That stage is already sealed."); return; }
        if (cur.stage !== stage) { toast("The road is walked in order. Only the stage marked now will open."); return; }
        startStage(stage);
      };
    });
    var g = document.getElementById("tutGo");
    if (g) g.onclick = function () { var cur = tut(); if (cur) startStage(cur.stage); };
    var rp = document.getElementById("tutReplay");
    if (rp) rp.onclick = function () { replay(); };
    var sc = document.getElementById("tutScroll");
    var active = root.querySelector(".tut-node.now");
    if (sc && active) active.scrollIntoView({block: "center"});
  }

  function replay() {
    var s = save();
    if (!s || !s.tutorial) return;
    if (s.tutorial.status === "active") { toast("You are already on the chart."); return; }
    var creature = s.tutorial.creature && s.col[s.tutorial.creature] ? s.tutorial.creature : (s.order || [])[0];
    if (!creature) { toast("Revisit the trial once you have a beast."); return; }
    s.tutorial = Core.replayFrom(s.tutorial);
    s.tutorial.creature = creature;
    writeSave();
    renderCampaign();
    paintLock();
    toast("The trial is open again. Potions will not be paid a second time.");
  }

  var demo = document.getElementById("demoBtn");
  if (demo) demo.addEventListener("click", function (e) {
    var t = tut();
    if (t && (t.status === "await-scan" || t.status === "active")) {
      e.stopImmediatePropagation();
      e.preventDefault();
      toast(t.status === "active" ? "Finish the trial before adding more beasts." : "The trial begins with one barcode. A demo pack is only offered when you start a game and tick the starter pack.");
    }
  }, true);

  var quit = document.getElementById("bQuit");
  if (quit) {
    var prevQuit = quit.onclick;
    quit.onclick = function () {
      if (battleOn()) {
        inkConfirm("Leave this lesson?", "Your beast is recalled. The stage stays open, and nothing is lost.", "Leave", function () {
          restore(B._snap);
          B = null;
          clearCoach();
          show("campaign");
        });
        return;
      }
      if (prevQuit) return prevQuit.apply(quit, arguments);
    };
  }

  var campBtn = document.getElementById("mCamp");
  if (campBtn) campBtn.innerHTML = "🗺️ Campaign<small>Five-stage trial</small>";

  bootMigrate();
  paintLock();
  if (document.getElementById("s-campaign") && document.getElementById("s-campaign").classList.contains("on")) renderCampaign();

  window.CBTutorial = {
    core: Core,
    magicCost: magicCost,
    magicMax: ME.max,
    magicRegen: ME.regen,
    recoverMagic: recoverMagic,
    state: function () { return tut(); },
    startStage: startStage,
    replay: replay,
    render: renderCampaign,
    remainingScans: remaining,
    matchupFor: function (el, cv) { return Core.matchup(el, {cv: cv || null}); }
  };
})();
