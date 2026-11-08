"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/tutorial-core.js");

function blank() {
  return {col: {}, order: [], team: [], team2: [], tracer: {lvl: 1, xp: 0, shards: 0, crystals: 0, seen: []}, inv: [], wins: 0};
}

test("new save with no creatures waits for one scan", () => {
  const save = blank();
  const res = Core.migrate(save);
  assert.equal(res.policy, "new-player");
  assert.equal(save.tutorial.status, "await-scan");
  assert.equal(Core.gatesClosed(save.tutorial), false);
  assert.equal(Core.scanDecision(save.tutorial, {energy: 6}).allow, true);
  assert.equal(Core.scanDecision(save.tutorial, {energy: 6}).reason, "first-scan");
});

test("legacy roster is waived with no potion grant and no lock", () => {
  const save = blank();
  save.order = ["111", "222"];
  save.col = {111: {lvl: 8, name: "keep"}, 222: {lvl: 4}};
  save.wins = 3;
  save.tracer.lvl = 4;
  save.tracer.shards = 40;
  save.inv = [{id: "a", k: "salve", src: "starter"}];
  const res = Core.migrate(save);
  assert.equal(res.policy, "legacy-skip-no-reward");
  assert.equal(save.tutorial.status, "skipped");
  assert.equal(save.tutorial.legacy, true);
  assert.equal(save.tutorial.rewarded, false);
  assert.equal(Core.rewardPlan(save.tutorial).grant, 0);
  assert.equal(Core.gatesClosed(save.tutorial), false);
  assert.equal(Core.gameUnlocked(save.tutorial), true);
  assert.deepEqual(save.order, ["111", "222"]);
  assert.equal(save.inv[0].k, "salve");
  assert.equal(save.tracer.shards, 40);
});

test("existing tutorial record is not reclassified", () => {
  const save = blank();
  save.order = ["111"];
  save.tutorial = Core.fresh();
  Core.onFirstSummon(save.tutorial, "111");
  const res = Core.migrate(save);
  assert.equal(res.policy, "existing");
  assert.equal(save.tutorial.status, "active");
  assert.equal(save.tutorial.creature, "111");
});

test("reload after the first summon cannot open a second scan", () => {
  const save = blank();
  save.tutorial = Core.fresh();
  save.order = ["999"];
  save.col = {999: {lvl: 5}};
  Core.normalize(save);
  assert.equal(save.tutorial.status, "active");
  assert.equal(save.tutorial.creature, "999");
  assert.equal(Core.scanDecision(save.tutorial, {energy: 5}).allow, false);
  assert.equal(Core.scanDecision(save.tutorial, {friend: true, energy: 5}).allow, false);
});

test("stage order is strict and action flags do not skip", () => {
  const t = Core.fresh();
  Core.onFirstSummon(t, "1");
  assert.equal(Core.canStart(t, 2).ok, false);
  assert.equal(Core.canStart(t, 1).ok, true);
  assert.equal(Core.advance(t, 2).ok, false);
  assert.equal(t.stage, 1);
  assert.equal(Core.advance(t, 1).ok, true);
  assert.equal(t.stage, 2);
  assert.equal(Core.advance(t, 2).ok, true);
  assert.equal(Core.advance(t, 4).ok, false);
  Core.advance(t, 3);
  Core.advance(t, 4);
  assert.equal(Core.advance(t, 5).ok, true);
  assert.equal(t.status, "complete");
  assert.equal(Core.advance(t, 5).ok, false);
});

test("potions are planned once, never for legacy or replay", () => {
  const t = Core.fresh();
  Core.onFirstSummon(t, "1");
  for (let i = 1; i <= 5; i++) Core.advance(t, i);
  assert.equal(t.status, "complete");
  const plan = Core.rewardPlan(t);
  assert.equal(plan.grant, 5);
  assert.equal(plan.item, "herb");
  Core.notePotions(t, 5);
  assert.equal(Core.rewardPlan(t).grant, 0);
  const again = Core.replayFrom(t);
  assert.equal(again.replay, true);
  assert.equal(again.rewarded, true);
  assert.equal(Core.rewardPlan(again).grant, 0);
  assert.equal(Core.gatesClosed(again), true);
  const legacy = Core.waived("legacy-roster", true);
  assert.equal(Core.rewardPlan(legacy).grant, 0);
});

test("partial potion grant resumes up to five and then stops", () => {
  const t = Core.fresh();
  Core.onFirstSummon(t, "1");
  for (let i = 1; i <= 5; i++) Core.advance(t, i);
  Core.notePotions(t, 2);
  assert.equal(t.rewarded, false);
  assert.equal(Core.rewardPlan(t).grant, 3);
  Core.notePotions(t, 3);
  assert.equal(t.rewarded, true);
  assert.equal(Core.rewardPlan(t).grant, 0);
});

test("clearing the trial does not mint scans", () => {
  assert.equal(Core.scansAfterClear(5), 5);
  assert.equal(Core.scansAfterClear(6), 6);
  assert.equal(Core.scansAfterClear(0), 0);
  assert.equal(Core.DAILY_SCANS, 6);
});

test("screens and battles stay shut while the trial is active", () => {
  const t = Core.fresh();
  Core.onFirstSummon(t, "1");
  assert.equal(Core.screenAllowed(t, "team", false), false);
  assert.equal(Core.screenAllowed(t, "market", false), false);
  assert.equal(Core.screenAllowed(t, "battle", false), false);
  assert.equal(Core.screenAllowed(t, "battle", true), true);
  assert.equal(Core.screenAllowed(t, "campaign", false), true);
  assert.equal(Core.screenAllowed(t, "scan", false), true);
  t.status = "complete";
  assert.equal(Core.screenAllowed(t, "team", false), true);
});

test("every element has one real disadvantage and honest biome text", () => {
  const misleading = /punish|hinder/i;
  for (const el of Core.ELEMENTS) {
    const enemy = Core.disadvantageElement(el);
    assert.ok(enemy, el);
    assert.equal(Core.BEATS[el], enemy);
    assert.notEqual(enemy, el);
    const plain = Core.matchup(el, {});
    assert.equal(plain.ok, true);
    assert.equal(plain.enemyEl, enemy);
    assert.equal(plain.typeMult, 1.5);
    assert.equal(plain.playerMult >= 1, true, el + " biome " + plain.biome + " " + plain.playerMult);
    const land = Core.pickBiome(el, enemy);
    if (land.em >= 1) assert.equal(misleading.test(plain.text) && /hinders/.test(plain.text), false);
    if (plain.kind === "shared-boost") {
      assert.match(plain.text, /not a one-sided weakness/);
      assert.ok(plain.playerMult > 1 && plain.enemyMult > 1);
    }
    if (plain.kind === "neutral") assert.match(plain.text, /neutral/);
    if (plain.kind === "player-boost" && plain.enemyMult < 0.999) assert.match(plain.text, /hinders/);
    if (plain.kind === "player-boost" && Math.abs(plain.enemyMult - 1) < 0.001) assert.match(plain.text, /neutral/);
    const prism = Core.matchup(el, {cv: "Prism"});
    assert.match(prism.text, /Prismatic/);
    assert.doesNotMatch(prism.text, /coat makes the attack super effective/);
    const other = Core.ELEMENTS.find(x => x !== el && x !== land.biomeEl);
    const off = Core.matchup(el, {cv: other});
    assert.match(off.text, /does not match this biome/);
  }
});

test("Earth vs Air and Arcane vs Light are not sold as one-sided ground", () => {
  const earth = Core.matchup("Earth", {});
  assert.equal(earth.enemyEl, "Air");
  assert.equal(earth.kind, "shared-boost");
  assert.match(earth.text, /not a one-sided weakness/);
  const arcane = Core.matchup("Arcane", {});
  assert.equal(arcane.enemyEl, "Light");
  assert.equal(arcane.kind, "shared-boost");
  const light = Core.matchup("Light", {});
  assert.equal(light.biome, "Ruins");
  assert.doesNotMatch(light.text, /Windswept Plains helps Light/);
  const water = Core.matchup("Water", {});
  assert.equal(water.enemyEl, "Fire");
  assert.equal(water.biome, "Water");
  assert.ok(water.enemyMult < 1);
});

test("an unknown element refuses a fake advantage", () => {
  const m = Core.matchup("Metal", {});
  assert.equal(m.ok, false);
  assert.match(m.text, /will not invent/);
});

test("starter pack waiver is not a legacy roster wipe", () => {
  const save = blank();
  save.tutorial = Core.waived("starter-pack", false);
  save.order = ["1","2","3","4","5","6","7","8"];
  Core.migrate(save);
  assert.equal(save.tutorial.status, "skipped");
  assert.equal(save.tutorial.legacy, false);
  assert.equal(save.order.length, 8);
  assert.equal(Core.rewardPlan(save.tutorial).grant, 0);
});

test("stage copy names mythology, legend, and other origins without skipping the move", () => {
  const a = Core.stageBrief(1, {tracer: "Ada", creature: "Young Griffin", origin: "mythology"});
  assert.match(a.body, /mythology, folklore, and urban legend/);
  assert.match(a.body, /created through other means/);
  assert.match(a.ask, /actually move/);
  const b = Core.stageBrief(3, {ability: "Flame Burst", essence: 20, cooldown: 1, magic: 4, magicCost: 4, magicRegen: 4});
  assert.match(b.body, /Magic energy is the pool a special spends/);
  assert.match(b.ask, /spends 4 magic energy/);
  assert.doesNotMatch(b.body + b.ask, /cooldown is its cost|strikes with Essence/);
  const c = Core.stageBrief(5, {});
  assert.match(c.ask, /have to win/);
  assert.match(c.body, /full health/);
  assert.match(c.body, /does not take your items/);
});
