/**
 * Live-page tests against index.html (real gen, energy, elem chart, calcDmg, battles).
 * Run: node tests/tutorial-integration.mjs
 */
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8765;

function serve() {
  const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webm": "video/webm", ".mp4": "video/mp4"};
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("no"); return;
    }
    res.writeHead(200, {"content-type": types[path.extname(file)] || "application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  });
}

function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function boot(browser, init) {
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem("codexbeasts.introSeen", "1");
    localStorage.setItem("codexbeasts.qte", "auto");
  });
  if (init) await page.addInitScript(init);
  await page.goto("http://127.0.0.1:" + PORT + "/index.html", {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.CBTutorial && window.CB && window.energy);
  return {page, errors};
}

const queue = [];
function check(name, fn) { queue.push([name, fn]); }

const server = serve();
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

try {
  check("fresh save allows one summon then seals every scan path", async () => {
    const {page, errors} = await boot(browser);
    const first = await page.evaluate(() => {
      newGame("Ada", 0, 2, false);
      const before = energy();
      const code = "123456789012";
      const ok = addCode(code, "manual");
      const s = CB.save();
      return {
        ok, before, after: energy(),
        status: s.tutorial.status, stage: s.tutorial.stage, creature: s.tutorial.creature,
        order: s.order.slice(), shards: s.tracer.shards, items: s.inv.map(i => i.k)
      };
    });
    assert.equal(first.ok, true);
    assert.equal(first.before, 6);
    assert.equal(first.after, 5);
    assert.equal(first.status, "active");
    assert.equal(first.stage, 1);
    assert.equal(first.order.length, 1);
    assert.deepEqual(first.items.sort(), ["catalyst", "herb", "herb", "herb", "tonic_s"].sort());

    const blocked = await page.evaluate((code) => {
      const n = energy();
      const dupe = addCode(code, "manual");
      const other = addCode("987654321098", "manual");
      const friend = addCode("CBX1|not-a-friend", "manual");
      const battle = (function () { startBattle("ai"); return document.querySelector(".screen.on").id; })();
      show("team");
      const afterTeam = document.querySelector(".screen.on").id;
      show("market");
      const afterMarket = document.querySelector(".screen.on").id;
      show("items");
      const afterItems = document.querySelector(".screen.on").id;
      const demo = document.getElementById("demoBtn");
      demo.click();
      return {
        dupe, other, friend, n, energy: energy(), battle, afterTeam, afterMarket, afterItems,
        order: CB.save().order.length, cam: document.getElementById("camBtn").disabled
      };
    }, first.creature);
    assert.equal(blocked.dupe, false);
    assert.equal(blocked.other, false);
    assert.equal(blocked.friend, false);
    assert.equal(blocked.energy, 5, "failed scans must not spend the daily allowance");
    assert.equal(blocked.order, 1);
    assert.equal(blocked.afterTeam, "s-campaign");
    assert.equal(blocked.afterMarket, "s-campaign");
    assert.equal(blocked.afterItems, "s-campaign");
    assert.equal(blocked.cam, true);
    assert.ok(errors.filter(e => !/Audio|decode|NotAllowed|play\(\)/.test(e)).length === 0, errors.join("\n"));
    await page.close();
  });

  check("trial state, roster and remaining scans survive reload", async () => {
    const {page} = await boot(browser);
    await page.evaluate(() => {
      newGame("Ada", 0, 0, false);
      addCode("123456789012", "manual");
    });
    await page.reload({waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.CBTutorial);
    const again = await page.evaluate(() => {
      const s = CB.save();
      const n = energy();
      const extra = addCode("111111111111", "manual");
      return {status: s.tutorial.status, stage: s.tutorial.stage, order: s.order.slice(), n, after: energy(), extra, items: s.inv.length};
    });
    assert.equal(again.status, "active");
    assert.equal(again.stage, 1);
    assert.deepEqual(again.order, ["123456789012"]);
    assert.equal(again.extra, false);
    assert.equal(again.n, 5);
    assert.equal(again.after, 5);
    assert.equal(again.items, 5);
    await page.close();
  });

  check("same-day clear unlocks the five remaining scans and five potions once", async () => {
    const {page} = await boot(browser);
    const summary = await page.evaluate(async () => {
      newGame("Ada", 1, 1, false);
      addCode("246801357924", "manual");
      const herbsBefore = CB.save().inv.filter(i => i.k === "herb").length;
      const orderBefore = CB.save().order.slice();
      const winsBefore = CB.save().wins || 0;
      const shardsBefore = CB.save().tracer.shards;
      const lvlBefore = CB.save().col[orderBefore[0]].lvl;

      function strikeOf(u) { return actsOf(u).find(a => a.k === "st"); }
      function essOf(u) { return actsOf(u).find(a => a && a.t === "ess" && a.k === "a1" && !a.locked); }
      function play(stage) {
        const ok = CBTutorial.startStage(stage);
        if (!ok || !B || !B.tutorial) return {ok: false, stage, status: CBTutorial.state()};
        const p = B.units.filter(u => u.side === 0)[0];
        const foes = B.units.filter(u => u.side === 1);
        if (stage === 1) {
          if (foes.length) return {ok: false, why: "stage1 had a foe"};
          const N = Math.round(Math.sqrt(B.map.length));
          const R = reachable(B, p);
          let dest = null;
          for (const k of R.keys()) {
            const x = k % N, y = (k / N) | 0;
            if (x !== p.x || y !== p.y) { dest = {x, y}; break; }
          }
          if (!dest) return {ok: false, why: "no legal move", move: p.c.move};
          const ox = p.x, oy = p.y;
          doMove(B, p, dest.x, dest.y);
          if (p.x === ox && p.y === oy) return {ok: false, why: "move did not stick"};
          beginTurn();
          return {ok: true, cleared: CBTutorial.state().cleared.slice()};
        }
        if (foes.length !== 1) return {ok: false, why: "foe count", n: foes.length};
        const e = foes[0];
        const dist = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
        if (stage === 2) {
          const a = strikeOf(p);
          if (dist > a.r) return {ok: false, why: "strike range", dist, r: a.r};
          const res = doAct(B, p, a, e);
          beginTurn();
          return {ok: CBTutorial.state().cleared[1], dmg: res.dmg, em: res.em};
        }
        const a = essOf(p);
        if (!a) return {ok: false, why: "no essence", el: p.c.el, ab: p.c.ab};
        if (dist > a.r || dist <= 1) return {ok: false, why: "essence placement", dist, r: a.r, el: p.c.el};
        const preview = calcDmg(B, p, p.x, p.y, e, a);
        const me0 = p.me;
        const res = doAct(B, p, a, e);
        const info = {el: p.c.el, enemy: e.c.el, dist, dmg: res.dmg, em: res.em, bm: res.bm, me0, me1: p.me, meSpent: res.meSpent, biome: B.biome};
        beginTurn();
        return Object.assign(info, {ok: !!CBTutorial.state().cleared[stage - 1]});
      }

      const s1 = play(1);
      const s2 = play(2);
      const s3 = play(3);
      const s4 = play(4);
      const early = CBTutorial.startStage(1);
      const state = CBTutorial.state();

      CBTutorial.startStage(5);
      const p = B.units.filter(u => u.side === 0)[0];
      const e = B.units.filter(u => u.side === 1)[0];
      const herbBeforeFight = CB.save().inv.filter(i => i.k === "herb").length;
      takeItem("herb");
      p.hp = 1;
      e.x = p.x; e.y = Math.max(0, p.y - 1);
      doAct(B, e, strikeOf(e), p);
      nextTurn(B);
      beginTurn();
      const afterLoss = {
        status: CBTutorial.state().status,
        stage: CBTutorial.state().stage,
        order: CB.save().order.slice(),
        lvl: CB.save().col[CB.save().order[0]].lvl,
        wins: CB.save().wins || 0,
        shards: CB.save().tracer.shards,
        herbs: CB.save().inv.filter(i => i.k === "herb").length,
        potions: CB.save().inv.filter(i => i.src === "tutorial:potion").length
      };

      function fight() {
        let steps = 0;
        while (B && !B.over && steps++ < 120) {
          const u = B.units[B.queue[B.qi]];
          if (!u || !u.alive) { nextTurn(B); continue; }
          if (u.side === 0) {
            const plan = aiPlan(B, u);
            if (plan) {
              doMove(B, u, plan.x, plan.y);
              if (plan.a && plan.t) doAct(B, u, plan.a, plan.t);
            }
            nextTurn(B);
          } else aiTurn(B);
        }
        const acts = B && B.tutorial ? B.tutorial.playerActs : 0;
        const win = !!(B && B.winner === 0);
        if (B && B.over) beginTurn();
        return {win, acts, steps};
      }
      CBTutorial.startStage(5);
      const fought = fight();
      const s = CB.save();
      return {
        s1, s2, s3, s4, early, stageAfter4: state.stage,
        herbsBefore, herbBeforeFight, afterLoss, fought,
        energy: energy(),
        potions: s.inv.filter(i => i.src === "tutorial:potion").length,
        herbs: s.inv.filter(i => i.k === "herb").length,
        order: s.order.slice(),
        lvl: s.col[s.order[0]].lvl,
        wins: s.wins || 0,
        shards: s.tracer.shards,
        status: s.tutorial.status,
        rewarded: s.tutorial.rewarded,
        lvlBefore, winsBefore, shardsBefore, orderBefore
      };
    });
    assert.equal(summary.s1.ok, true, JSON.stringify(summary.s1));
    assert.equal(summary.s2.ok, true, JSON.stringify(summary.s2));
    assert.equal(summary.s2.em, 1, "Strike is physical and not super effective");
    assert.equal(summary.s3.ok, true, JSON.stringify(summary.s3));
    assert.ok(summary.s3.meSpent > 0, "the special must spend magic energy");
    assert.equal(summary.s3.me1, summary.s3.me0 - summary.s3.meSpent);
    assert.equal(summary.s4.ok, true, JSON.stringify(summary.s4));
    assert.ok(summary.s4.em > 1, "stage 4 hit must be super effective");
    assert.equal(summary.early, false);
    assert.equal(summary.stageAfter4, 5);
    assert.equal(summary.afterLoss.status, "active");
    assert.equal(summary.afterLoss.stage, 5);
    assert.deepEqual(summary.afterLoss.order, summary.orderBefore);
    assert.equal(summary.afterLoss.lvl, summary.lvlBefore);
    assert.equal(summary.afterLoss.wins, summary.winsBefore);
    assert.equal(summary.afterLoss.shards, summary.shardsBefore);
    assert.equal(summary.afterLoss.herbs, summary.herbBeforeFight, "a used herb is restored when the lesson ends");
    assert.equal(summary.afterLoss.potions, 0);
    assert.equal(summary.fought.win, true, JSON.stringify(summary.fought));
    assert.ok(summary.fought.acts >= 1);
    assert.equal(summary.status, "complete");
    assert.equal(summary.rewarded, true);
    assert.equal(summary.potions, 5);
    assert.equal(summary.herbs, summary.herbsBefore + 5);
    assert.equal(summary.energy, 5);
    assert.deepEqual(summary.order, summary.orderBefore);
    assert.equal(summary.lvl, summary.lvlBefore);
    assert.equal(summary.wins, summary.winsBefore);
    assert.equal(summary.shards, summary.shardsBefore);

    const twice = await page.evaluate(() => {
      const before = CB.save().inv.filter(i => i.src === "tutorial:potion").length;
      CBTutorial.replay();
      const st = CBTutorial.state();
      function strikeOf(u) { return actsOf(u).find(a => a.k === "st"); }
      function essOf(u) { return actsOf(u).find(a => a.t === "ess" && a.k === "a1"); }
      function quick(stage) {
        CBTutorial.startStage(stage);
        const p = B.units.filter(u => u.side === 0)[0];
        const e = B.units.filter(u => u.side === 1)[0];
        if (stage === 1) {
          const N = Math.round(Math.sqrt(B.map.length));
          for (const k of reachable(B, p).keys()) {
            const x = k % N, y = (k / N) | 0;
            if (x !== p.x || y !== p.y) { doMove(B, p, x, y); break; }
          }
          beginTurn();
          return;
        }
        const a = stage === 2 ? strikeOf(p) : essOf(p);
        doAct(B, p, a, e);
        beginTurn();
      }
      quick(1); quick(2); quick(3); quick(4);
      CBTutorial.startStage(5);
      let steps = 0;
      while (B && !B.over && steps++ < 120) {
        const u = B.units[B.queue[B.qi]];
        if (!u || !u.alive) { nextTurn(B); continue; }
        if (u.side === 0) {
          const plan = aiPlan(B, u);
          if (plan) { doMove(B, u, plan.x, plan.y); if (plan.a && plan.t) doAct(B, u, plan.a, plan.t); }
          nextTurn(B);
        } else aiTurn(B);
      }
      if (B && B.over) beginTurn();
      return {
        replay: st.replay, status: CB.save().tutorial.status,
        potions: CB.save().inv.filter(i => i.src === "tutorial:potion").length,
        before
      };
    });
    assert.equal(twice.replay, true);
    assert.equal(twice.status, "complete");
    assert.equal(twice.potions, twice.before);
    await page.close();
  });

  check("midnight during the trial refreshes the normal day and adds nothing on clear", async () => {
    const {page} = await boot(browser);
    const out = await page.evaluate(() => {
      newGame("Ada", 0, 0, false);
      addCode("135790246801", "manual");
      const spent = energy();
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(15, 0, 0, 0);
      CB7.setNow(() => d);
      const rolled = energy();
      const blocked = addCode("333333333333", "manual");
      const still = energy();
      CB.save().tutorial.cleared = [true, true, true, true, false];
      CB.save().tutorial.stage = 5;
      CBTutorial.startStage(5);
      let steps = 0;
      while (B && !B.over && steps++ < 120) {
        const u = B.units[B.queue[B.qi]];
        if (!u || !u.alive) { nextTurn(B); continue; }
        if (u.side === 0) {
          const plan = aiPlan(B, u);
          if (plan) { doMove(B, u, plan.x, plan.y); if (plan.a && plan.t) doAct(B, u, plan.a, plan.t); }
          nextTurn(B);
        } else aiTurn(B);
      }
      const acts = B && B.tutorial && B.tutorial.playerActs;
      if (B && B.over) beginTurn();
      return {spent, rolled, blocked, still, after: energy(), status: CB.save().tutorial.status, acts, potions: CB.save().inv.filter(i => i.src === "tutorial:potion").length};
    });
    assert.equal(out.spent, 5);
    assert.equal(out.rolled, 6);
    assert.equal(out.blocked, false);
    assert.equal(out.still, 6);
    assert.equal(out.after, 6);
    assert.equal(out.status, "complete");
    assert.ok(out.acts >= 1);
    assert.equal(out.potions, 5);
    await page.close();
  });

  check("an unearned stage-5 wipe does not clear the trial or pay potions", async () => {
    const {page} = await boot(browser);
    const out = await page.evaluate(() => {
      newGame("Ada", 0, 0, false);
      addCode("135790246801", "manual");
      CB.save().tutorial.cleared = [true, true, true, true, false];
      CB.save().tutorial.stage = 5;
      CBTutorial.startStage(5);
      const e = B.units.filter(u => u.side === 1)[0];
      e.hp = 0; e.alive = false;
      nextTurn(B);
      beginTurn();
      const s = CB.save();
      return {status: s.tutorial.status, stage: s.tutorial.stage, potions: s.inv.filter(i => i.src === "tutorial:potion").length, order: s.order.length};
    });
    assert.equal(out.status, "active");
    assert.equal(out.stage, 5);
    assert.equal(out.potions, 0);
    assert.equal(out.order, 1);
    await page.close();
  });

  check("every element picks a real disadvantage and can finish essence and stage 4", async () => {
    const {page} = await boot(browser);
    const rows = await page.evaluate(() => {
      newGame("Ada", 0, 0, false);
      const out = [];
      const els = CBTutorial.core.ELEMENTS;
      function codeFor(el) {
        for (let n = 0; n < 30000; n++) {
          const code = String(n).padStart(12, "0");
          const c = gen(code, 1);
          if (c.el === el && c.rar === 0) return code;
        }
        return null;
      }
      for (const el of els) {
        const code = codeFor(el);
        const m = CBTutorial.matchupFor(el, null);
        const live = elemMult(el, m.enemyEl);
        const back = elemMult(m.enemyEl, el);
        CB.save().col = {};
        CB.save().order = [code];
        CB.save().col[code] = {lvl: 5, xp: 0, t: 1, rk: {a1: 1, a2: 1}, sp: 0, baby: 1, v17: 1};
        CB.save().tutorial = {v: 1, status: "active", stage: 3, cleared: [true, true, false, false, false], creature: code, rewarded: false, potionsGranted: 0, legacy: false, replay: false};
        const started = CBTutorial.startStage(3);
        const p = B.units.filter(u => u.side === 0)[0];
        const e = B.units.filter(u => u.side === 1)[0];
        const ess = actsOf(p).find(a => a.t === "ess" && a.k === "a1");
        const dist = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
        const before = calcDmg(B, p, p.x, p.y, e, ess).dmg;
        const boosted = Object.assign({}, p.c, {ess: p.c.ess + 30});
        const withEss = calcDmg(B, {c: boosted, x: p.x, y: p.y}, p.x, p.y, e, ess).dmg;
        const powered = Object.assign({}, p.c, {pow: p.c.pow + 30});
        const withPow = calcDmg(B, {c: powered, x: p.x, y: p.y}, p.x, p.y, e, ess).dmg;
        const me0 = p.me;
        const strike = actsOf(p).find(a => a.k === "st");
        const meStrike = p.me;
        doAct(B, p, strike, e);
        const afterStrike = p.me;
        const cast = doAct(B, p, ess, e);
        const me1 = p.me;
        const blocked = doAct(B, p, ess, e);
        const restored = CBTutorial.recoverMagic(p);
        const me2 = p.me;
        beginTurn();
        CB.save().tutorial.stage = 4;
        CB.save().tutorial.cleared = [true, true, true, false, false];
        CBTutorial.startStage(4);
        const p4 = B.units.filter(u => u.side === 0)[0];
        const e4 = B.units.filter(u => u.side === 1)[0];
        const ess4 = actsOf(p4).find(a => a.t === "ess");
        const res = calcDmg(B, p4, p4.x, p4.y, e4, ess4);
        const text = (B.tutorial.match && B.tutorial.match.text) || "";
        const foeCount = B.units.filter(u => u.side === 1).length;
        doAct(B, p4, ess4, e4);
        beginTurn();
        out.push({
          el, code, enemy: m.enemyEl, biome: m.biome, kind: m.kind, live, back,
          started, dist, r: ess.r, me0, meStrike, afterStrike, me1, meSpent: cast && cast.meSpent, blocked: !!(blocked && blocked.noMe), restored, me2, before, withEss, withPow,
          em: res.em, bm: res.bm, pm: m.playerMult, foeCount, text,
          cleared3: CB.save().tutorial.cleared[2],
          baby: p.c.baby || p.c.ab[1].locked
        });
      }
      return out;
    });
    assert.equal(rows.length, 8);
    for (const row of rows) {
      assert.equal(row.live, 1.5, row.el);
      assert.equal(row.back, 0.7, row.el);
      assert.equal(row.started, true, JSON.stringify(row));
      assert.ok(row.dist <= row.r && row.dist > 1, row.el + " placement " + row.dist);
      assert.equal(row.afterStrike, row.me0, row.el + " Strike must not spend magic energy");
      assert.equal(row.meSpent, 4, row.el);
      assert.equal(row.me1, row.me0 - 4, row.el);
      assert.equal(row.blocked, true, row.el + " a second special in the same turn is exhausted");
      assert.ok(row.restored >= 4 && row.me2 >= 4, row.el + " recovery");
      assert.ok(row.withEss > row.before, row.el + " essence still prices damage");
      assert.equal(row.withPow, row.before, row.el + " Power must not price an essence art");
      assert.equal(row.foeCount, 1, row.el);
      assert.ok(row.em > 1, row.el + " em " + row.em);
      assert.ok(Math.abs(row.bm - row.pm) < 0.02, row.el + " bm " + row.bm + " vs " + row.pm);
      if (row.kind === "shared-boost") assert.match(row.text, /not a one-sided weakness/);
      if (row.kind !== "shared-boost" && row.bm <= 1.001) assert.doesNotMatch(row.text, /hinders/);
      assert.equal(row.cleared3, true, row.el);
    }
    await page.close();
  });

  check("legacy saves keep creatures and items and are not locked or paid", async () => {
    const {page} = await boot(browser, () => {
      const d = new Date();
      const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const save = {
        col: {
          "000000000021": {lvl: 12, xp: 4, t: 1, rk: {a1: 2, a2: 1}, sp: 1, baby: 0, v17: 1},
          "000000000022": {lvl: 7, xp: 1, t: 2, rk: {a1: 1, a2: 1}, sp: 0, baby: 1, v17: 1}
        },
        order: ["000000000021", "000000000022"],
        team: ["000000000021"],
        team2: [],
        v: 2,
        wins: 4,
        tracer: {id: "T9", name: "Sean", em: 1, col: 2, lvl: 6, xp: 12, shards: 80, crystals: 2, slotsC: 0, slotsI: 0, seen: ["Griffin"], streak: {last: null, day: 3, weeks: 1}, av: "ranger"},
        inv: [{id: "it-keep", k: "salve", tr: true, src: "starter", t: 1}],
        energy: {day: day, n: 4},
        friends: {}
      };
      localStorage.setItem("codexbeasts.v1", JSON.stringify(save));
    });
    const out = await page.evaluate(() => {
      const s = CB.save();
      const screen = document.querySelector(".screen.on") && document.querySelector(".screen.on").id;
      show("team");
      const team = document.querySelector(".screen.on").id;
      const shardsBefore = s.tracer.shards;
      const scanned = addCode("444444444444", "manual");
      return {
        status: s.tutorial.status, legacy: s.tutorial.legacy, reason: s.tutorial.reason,
        order: s.order.slice(),
        lvl: s.col["000000000021"].lvl,
        sp: s.col["000000000021"].sp,
        name: s.tracer.name, shardsBefore, shards: s.tracer.shards, wins: s.wins,
        salve: s.inv.some(i => i.id === "it-keep" && i.k === "salve"),
        potions: s.inv.filter(i => i.src === "tutorial:potion").length,
        energy: energy(),
        screen, team, scanned
      };
    });
    assert.equal(out.status, "skipped");
    assert.equal(out.legacy, true);
    assert.deepEqual(out.order.slice(0, 2), ["000000000021", "000000000022"]);
    assert.equal(out.lvl, 12);
    assert.equal(out.sp, 1);
    assert.equal(out.name, "Sean");
    assert.equal(out.shardsBefore, 80);
    assert.equal(out.shards, 82, "a normal legacy scan still pays its usual shards");
    assert.equal(out.wins, 4);
    assert.equal(out.salve, true);
    assert.equal(out.potions, 0);
    assert.equal(out.energy, 3, "a legacy tracer can still spend a normal scan");
    assert.equal(out.scanned, true);
    assert.equal(out.team, "s-team");
    await page.close();
  });

  check("starter pack cannot skip the trial on a new game", async () => {
    const {page} = await boot(browser);
    const out = await page.evaluate(() => {
      newGameForm();
      const box = document.querySelector("#starter");
      const form = {disabled: !!(box && box.disabled), checked: !!(box && box.checked)};
      document.querySelectorAll(".modal").forEach(m => m.remove());
      newGame("Bea", 2, 3, true);
      const beforeScan = CB.save().order.length;
      const first = addCode("888777666555", "manual");
      const second = addCode("111222333444", "manual");
      const s = CB.save();
      return {
        form, beforeScan, first, second, status: s.tutorial.status, n: s.order.length,
        energy: energy(), potionName: ITEMS.herb.n, potionId: "herb"
      };
    });
    assert.equal(out.form.disabled, true);
    assert.equal(out.form.checked, false);
    assert.equal(out.beforeScan, 0, "the pack must not add eight beasts");
    assert.equal(out.first, true);
    assert.equal(out.second, false);
    assert.equal(out.status, "active");
    assert.equal(out.n, 1);
    assert.equal(out.energy, 5);
    assert.equal(out.potionName, "Healing Potion");
    assert.equal(out.potionId, "herb");
    await page.close();
  });

  check("the chart is flat, centered, and every unfinished node is yellow", async () => {
    const {page} = await boot(browser);
    const out = await page.evaluate(async () => {
      newGame("Ada", 0, 1, false);
      addCode("123456789012", "manual");
      if (typeof closeReveal === "function") closeReveal();
      show("campaign");
      const camp = document.getElementById("s-campaign");
      camp.classList.add("pflip");
      await new Promise(r => setTimeout(r, 400));
      const cs = getComputedStyle(camp);
      const frame = document.getElementById("tutMap").getBoundingClientRect();
      const nodes = [...document.querySelectorAll("#tutMap .tut-node")];
      const boxes = nodes.map(n => {
        const r = n.getBoundingClientRect();
        return {cls: n.className, w: r.width, mid: (r.left + r.right) / 2, top: r.top, text: n.innerText.replace(/\s+/g, " ")};
      });
      const mid = (frame.left + frame.right) / 2;
      return {
        transform: cs.transform, animation: cs.animationName, opacity: cs.opacity,
        count: nodes.length, mid, boxes,
        lead: document.querySelector(".tut-lead").innerText
      };
    });
    assert.equal(out.count, 5);
    assert.equal(out.transform, "none");
    assert.ok(out.animation === "none" || out.animation === "");
    assert.equal(out.boxes.filter(b => b.cls.includes("yellow")).length, 5);
    assert.match(out.lead, /yellow/);
    assert.match(out.lead, /green/);
    for (const b of out.boxes) {
      assert.ok(b.w > 140, b.text);
      assert.ok(Math.abs(b.mid - out.mid) < 30, b.text + " mid " + b.mid + " frame " + out.mid);
      assert.match(b.text, /[A-Za-z]/);
    }
    await page.close();
  });

  check("empty legacy shell is a new tracer, not a locked veteran", async () => {
    const {page} = await boot(browser, () => {
      localStorage.setItem("codexbeasts.v1", JSON.stringify({col: {}, order: [], team: [], team2: []}));
    });
    const out = await page.evaluate(() => {
      const s = CB.save();
      const beforeItems = s.inv.map(i => i.k);
      const ok = addCode("555666777888", "manual");
      return {status: s.tutorial && CBTutorial.state().status, beforeItems, ok, energy: energy(), order: s.order.length, name: s.tracer && s.tracer.name};
    });
    assert.equal(out.ok, true);
    assert.equal(out.status, "active");
    assert.equal(out.energy, 5);
    assert.equal(out.order, 1);
    assert.ok(out.beforeItems.includes("herb"));
    await page.close();
  });
  let failed = 0;
  for (const [name, fn] of queue) {
    try {
      await fn();
      console.log("ok", name);
    } catch (e) {
      failed++;
      console.error("FAIL", name, e && e.stack || e);
    }
  }
  if (failed) {
    console.error(failed + " integration test(s) failed");
    process.exitCode = 1;
  } else console.log("integration passed", queue.length);
} finally {
  await browser.close();
  server.close();
}
