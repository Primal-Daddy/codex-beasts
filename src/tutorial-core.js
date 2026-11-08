/* Codex Beasts — five-stage trial rules.
   Pure data and decisions. The browser shell in tutorial.js applies them
   to the live save, scanner, and battle functions.

   Migration policy (v1):
   - A save that already has a tutorial record is left as it is.
   - A save with any creature, win, tracer level above 1, friend, or claimed
     mission is an established Tracer. The trial is waived (status "skipped"),
     the roster and items are not touched, and the five-potion reward is NOT granted.
   - A save with a Tracer but no creatures is a new hunter: exactly one successful
     summon is allowed, then the trial locks scanning and the rest of the game.
   - Choosing the 8-creature starter pack at a new game waives the trial the same
     way (those beasts were not a single first scan) and does not grant potions.
   - Replaying the trial never grants potions again.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CBTutorialCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 1;
  var POTION_ITEM = "herb";
  var POTION_COUNT = 5;
  var POTION_SRC = "tutorial:potion";
  var DAILY_SCANS = 6;

  /* Mirrors v17.1 index.html. Integration tests compare these to live calcDmg. */
  var BEATS = {Water:"Fire", Fire:"Nature", Nature:"Earth", Earth:"Air", Air:"Water", Light:"Shadow", Shadow:"Arcane", Arcane:"Light"};
  var ELEMENTS = ["Fire","Water","Earth","Air","Light","Shadow","Arcane","Nature"];
  var BIOME_BONUS = {
    Forest:{Nature:1.25, Fire:1.1},
    Mountain:{Earth:1.25, Air:1.15},
    Water:{Water:1.25, Fire:0.75},
    Desert:{Fire:1.15, Water:0.85, Nature:0.9},
    Swamp:{Shadow:1.2, Nature:1.1, Light:0.85},
    Tundra:{Water:1.2, Air:1.1, Fire:0.8},
    Volcanic:{Fire:1.3, Water:0.8, Nature:0.8},
    Ruins:{Arcane:1.25, Light:1.15}
  };
  var BIOME_EL = {Plains:"Light", Forest:"Nature", Mountain:"Earth", Water:"Water", Desert:"Fire", Swamp:"Shadow", Tundra:"Air", Volcanic:"Fire", Ruins:"Arcane"};
  var BIOME_NAMES = ["Plains","Forest","Mountain","Water","Desert","Swamp","Tundra","Volcanic","Ruins"];
  var BNAME = {Plains:"Windswept Plains", Forest:"Elderwood Forest", Mountain:"Crag Peaks", Water:"Sunken Shoals", Desert:"Scorched Dunes", Swamp:"Mirefen Swamp", Tundra:"Frozen Tundra", Volcanic:"Volcanic Wastes", Ruins:"Forgotten Ruins"};
  var BICON = {Plains:"🌾", Forest:"🌲", Mountain:"⛰️", Water:"🌊", Desert:"🏜️", Swamp:"🪷", Tundra:"❄️", Volcanic:"🌋", Ruins:"🏛️"};
  var FIELD = 0.75; // HB in the battle script: bonuses are softened by this factor

  var STAGES = [
    {id:1, name:"First Steps", kicker:"Move"},
    {id:2, name:"The Strike", kicker:"One foe"},
    {id:3, name:"Essence", kicker:"Magic cost"},
    {id:4, name:"The Land", kicker:"Matchup"},
    {id:5, name:"The Proving", kicker:"Win it"}
  ];

  function hbm(m) { return 1 + ((m || 1) - 1) * FIELD; }
  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(/0$/, "").replace(/\.0$/, ""); }
  function fresh() {
    return {
      v: VERSION,
      status: "await-scan",
      stage: 0,
      cleared: [false, false, false, false, false],
      creature: null,
      rewarded: false,
      potionsGranted: 0,
      legacy: false,
      replay: false,
      reason: null
    };
  }
  function waived(reason, legacy) {
    return {
      v: VERSION,
      status: "skipped",
      stage: 0,
      cleared: [false, false, false, false, false],
      creature: null,
      rewarded: false,
      potionsGranted: 0,
      legacy: !!legacy,
      replay: false,
      reason: reason
    };
  }
  function established(save) {
    if (!save) return false;
    if ((save.order || []).length > 0) return true;
    if ((save.wins || 0) > 0) return true;
    var t = save.tracer;
    if (t && (t.lvl || 1) > 1) return true;
    if (save.friends && Object.keys(save.friends).length) return true;
    var ms = save.ms;
    if (ms) {
      var kinds = ["d", "w", "m"];
      for (var i = 0; i < kinds.length; i++) {
        var block = ms[kinds[i]];
        if (block && block.l && block.l.some(function (x) { return x && x.c; })) return true;
      }
    }
    return false;
  }

  /* Returns {changed, policy}. Mutates save.tutorial only. */
  function migrate(save) {
    if (!save) return {changed: false, policy: "no-save"};
    if (save.tutorial && save.tutorial.v >= 1) {
      normalize(save);
      return {changed: false, policy: "existing"};
    }
    if (established(save)) {
      save.tutorial = waived("legacy-roster", true);
      return {changed: true, policy: "legacy-skip-no-reward"};
    }
    save.tutorial = fresh();
    return {changed: true, policy: "new-player"};
  }

  function normalize(save) {
    var t = save && save.tutorial;
    if (!t) return;
    t.v = t.v || VERSION;
    t.cleared = (t.cleared || [false, false, false, false, false]).slice(0, 5);
    while (t.cleared.length < 5) t.cleared.push(false);
    t.potionsGranted = t.potionsGranted || 0;
    t.rewarded = !!t.rewarded;
    t.legacy = !!t.legacy;
    t.replay = !!t.replay;
    if (t.potionsGranted >= POTION_COUNT) t.rewarded = true;
    if (t.status === "await-scan" && save.order && save.order.length > 0 && !t.legacy) {
      /* Reload landed between the summon being saved and the trial flag. Do not offer a second scan. */
      t.status = "active";
      t.stage = t.stage > 0 ? t.stage : 1;
      t.creature = t.creature || save.order[0];
    }
    if (t.status === "active") {
      var next = 1;
      for (var i = 0; i < 5; i++) { if (t.cleared[i]) next = i + 2; else break; }
      t.stage = Math.max(1, Math.min(5, next > 5 ? 5 : next));
      if (t.cleared.every(Boolean)) t.status = "complete";
    }
  }

  function gatesClosed(t) { return !!(t && t.status === "active"); }
  function gameUnlocked(t) { return !t || t.status === "complete" || t.status === "skipped"; }

  function scanDecision(t, ctx) {
    ctx = ctx || {};
    if (!t || gameUnlocked(t)) return {allow: true, reason: "open"};
    if (t.status === "active" || gatesClosed(t)) {
      return {allow: false, reason: "tutorial-lock", message: "The trial is open. Scanning stays sealed until you finish all five stages."};
    }
    if (t.status === "await-scan") {
      if (ctx.friend) return {allow: true, reason: "friend-before-summon"};
      if ((ctx.energy || 0) <= 0) return {allow: true, reason: "depleted-passes-to-game"};
      return {allow: true, reason: "first-scan"};
    }
    return {allow: false, reason: "unknown", message: "Scanning is not available."};
  }

  function onFirstSummon(t, code) {
    if (!t || t.status !== "await-scan") return t;
    t.status = "active";
    t.stage = 1;
    t.creature = code;
    t.cleared = [false, false, false, false, false];
    return t;
  }

  function screenAllowed(t, screen, tutorialBattle) {
    if (!gatesClosed(t)) return true;
    if (screen === "campaign" || screen === "scan" || screen === "home") return true;
    if (screen === "battle") return !!tutorialBattle;
    return false;
  }

  function canStart(t, stage) {
    if (!t || t.status !== "active") return {ok: false, reason: "not-active"};
    stage = stage | 0;
    if (stage < 1 || stage > 5) return {ok: false, reason: "bad-stage"};
    if (t.cleared[stage - 1]) return {ok: false, reason: "already"};
    if (t.stage !== stage) return {ok: false, reason: "order"};
    for (var i = 0; i < stage - 1; i++) if (!t.cleared[i]) return {ok: false, reason: "order"};
    return {ok: true};
  }

  function advance(t, stage) {
    var gate = canStart(t, stage);
    if (!gate.ok && !(t && t.cleared && t.cleared[stage - 1])) {
      if (!t || t.status !== "active") return {ok: false, reason: gate.reason || "not-active"};
      if (t.stage !== stage) return {ok: false, reason: "order"};
    }
    if (!t || t.status !== "active") return {ok: false, reason: "not-active"};
    if (t.stage !== stage) return {ok: false, reason: "order"};
    if (t.cleared[stage - 1]) return {ok: false, reason: "already"};
    t.cleared[stage - 1] = true;
    if (stage < 5) t.stage = stage + 1;
    else {
      t.status = "complete";
      t.stage = 5;
    }
    return {ok: true, status: t.status, stage: t.stage};
  }

  function rewardPlan(t) {
    if (!t) return {grant: 0, item: POTION_ITEM, reason: "no-state"};
    if (t.legacy || t.replay || t.status === "skipped") return {grant: 0, item: POTION_ITEM, reason: t.legacy ? "legacy" : (t.replay ? "replay" : "skipped")};
    if (t.rewarded) return {grant: 0, item: POTION_ITEM, reason: "already"};
    var need = POTION_COUNT - (t.potionsGranted || 0);
    if (need <= 0) return {grant: 0, item: POTION_ITEM, reason: "already"};
    return {grant: need, item: POTION_ITEM, src: POTION_SRC, reason: "first-clear"};
  }

  function notePotions(t, n) {
    t.potionsGranted = (t.potionsGranted || 0) + (n | 0);
    if (t.potionsGranted >= POTION_COUNT) t.rewarded = true;
    return t.potionsGranted;
  }

  /* Completion must not mint scans. The number unlocked is whatever the normal
     daily function returns after its own midnight refresh. */
  function scansAfterClear(currentAllowance) {
    return currentAllowance;
  }

  function disadvantageElement(el) {
    var enemy = BEATS[el];
    if (!enemy) return null;
    return enemy;
  }

  function pickBiome(playerEl, enemyEl) {
    var rows = BIOME_NAMES.map(function (b) {
      var row = BIOME_BONUS[b] || {};
      var rawP = row[playerEl] == null ? 1 : row[playerEl];
      var rawE = row[enemyEl] == null ? 1 : row[enemyEl];
      return {biome: b, name: BNAME[b], icon: BICON[b], rawP: rawP, rawE: rawE, pm: hbm(rawP), em: hbm(rawE)};
    });
    function best(list) {
      return list.slice().sort(function (a, b) {
        if (b.pm !== a.pm) return b.pm - a.pm;
        return a.em - b.em;
      })[0];
    }
    var genuine = rows.filter(function (r) { return r.pm > 1.001 && r.em <= 1.001; });
    if (genuine.length) return tag(best(genuine), "player-boost");
    var shared = rows.filter(function (r) { return r.pm > 1.001 && r.pm + 0.001 >= r.em; });
    if (shared.length) return tag(best(shared), "shared-boost");
    var neutral = rows.filter(function (r) { return Math.abs(r.pm - 1) < 0.001 && Math.abs(r.em - 1) < 0.001; });
    if (neutral.length) return tag(neutral[0], "neutral");
    var least = rows.slice().sort(function (a, b) { return (b.pm - b.em) - (a.pm - a.em); })[0];
    return tag(least, least.pm < 0.999 ? "player-hindered" : "mixed");
  }
  function tag(row, kind) {
    row.kind = kind;
    row.biomeEl = BIOME_EL[row.biome] || null;
    return row;
  }

  function matchup(el, ctx) {
    ctx = ctx || {};
    var enemy = disadvantageElement(el);
    if (!enemy) {
      return {ok: false, reason: "no-disadvantage", text: el + " has no element it beats on the Codex chart. This trial will not invent one."};
    }
    var land = pickBiome(el, enemy);
    var text = describe(el, enemy, land, ctx);
    return {
      ok: true,
      playerEl: el,
      enemyEl: enemy,
      biome: land.biome,
      biomeName: land.name,
      biomeIcon: land.icon,
      biomeEl: land.biomeEl,
      kind: land.kind,
      playerMult: land.pm,
      enemyMult: land.em,
      typeMult: 1.5,
      resistMult: 0.7,
      text: text
    };
  }

  function describe(p, e, land, ctx) {
    var lines = [];
    lines.push(p + " essence is super effective against " + e + " (×1.5). " + e + " essence against " + p + " is resisted (×0.7). A physical Strike is never super effective.");
    var pf = fmt(land.pm), ef = fmt(land.em), place = land.name;
    if (land.kind === "player-boost" && land.em < 0.999) {
      lines.push(place + " helps " + p + " (×" + pf + " after the field factor) and hinders " + e + " (×" + ef + ").");
    } else if (land.kind === "player-boost") {
      lines.push(place + " helps " + p + " (×" + pf + "). " + e + " is neutral on this ground — the land does not punish them.");
    } else if (land.kind === "shared-boost") {
      lines.push(place + " lifts both " + p + " (×" + pf + ") and " + e + " (×" + ef + "). The ground is not a one-sided weakness. Your clear edge is the type chart.");
    } else if (land.kind === "neutral") {
      lines.push(place + " gives neither of you a biome bonus. The ground is neutral; the land will not win this for you.");
    } else if (land.pm < 0.999) {
      lines.push(place + " would hinder " + p + " (×" + pf + "). That is not an advantage, and this trial does not pretend it is.");
    } else {
      lines.push(place + ": " + p + " ×" + pf + ", " + e + " ×" + ef + ".");
    }
    if (ctx.cv === "Prism") {
      lines.push("A Prismatic coat resists every element when you are hit, and it adds no biome damage bonus.");
    } else if (ctx.cv && land.biomeEl && ctx.cv === land.biomeEl) {
      lines.push("Your " + ctx.cv + " colour variant also adds its home-biome bonus on this ground.");
    } else if (ctx.cv) {
      lines.push("Your " + ctx.cv + " colour variant does not match this biome, so it adds no extra biome damage.");
    }
    return lines.join(" ");
  }

  function stageBrief(stage, info) {
    info = info || {};
    var beast = info.creature || "your beast";
    var origin = info.origin || "a story";
    var who = info.tracer ? ("Tracer " + info.tracer) : "Tracer";
    if (stage === 1) {
      return {
        title: "The empty field",
        ask: "Tap a blue tile and actually move.",
        body: who + " and " + beast + " stand alone. No rival shares this field. Codex Beasts are beings from mythology, folklore, and urban legend — and some were created through other means: rites, dreams, and stories. Yours began as " + origin + "."
      };
    }
    if (stage === 2) {
      return {
        title: "A true strike",
        ask: "Choose Strike, tap the foe, and confirm.",
        body: "One foe is here. The blow has to land through the real battle. Ending the turn does not count."
      };
    }
    if (stage === 3) {
      var ab = info.ability || "Your essence art";
      return {
        title: "Essence, the magic",
        ask: "Land " + ab + ". A Strike will not finish this lesson.",
        body: ab + " is magic. It strikes with Essence (" + (info.essence != null ? info.essence : "your magic stat") + "), not Power, then cools down — that cooldown is its cost" + (info.cooldown != null ? " (" + info.cooldown + " turn)" : "") + ". This foe stands where every first beast's special can reach."
      };
    }
    if (stage === 4) {
      return {
        title: "Land and blood",
        ask: "Land your essence art. Read the preview before you confirm.",
        body: info.matchText || "Read the type chart before you strike. The words match the real multipliers."
      };
    }
    return {
      title: "The proving",
      ask: "Win the battle. You have to win; nothing ends this for you.",
      body: "A full battle against one disadvantaged foe. Take normal turns. If you fall, you are recalled at full health. Your only beast is not lost, and the trial does not take your items."
    };
  }

  function objectiveLabel(stage) {
    return ["Move to a blue tile", "Land a Strike", "Land your essence art", "Land a super-effective essence hit", "Win the battle"][stage - 1] || "";
  }

  function replayFrom(t) {
    var next = fresh();
    next.status = "active";
    next.stage = 1;
    next.creature = t && t.creature || null;
    next.rewarded = true;
    next.potionsGranted = Math.max(POTION_COUNT, (t && t.potionsGranted) || 0);
    next.replay = true;
    next.legacy = !!(t && t.legacy);
    next.reason = "replay";
    return next;
  }

  return {
    VERSION: VERSION,
    POTION_ITEM: POTION_ITEM,
    POTION_COUNT: POTION_COUNT,
    POTION_SRC: POTION_SRC,
    DAILY_SCANS: DAILY_SCANS,
    BEATS: BEATS,
    ELEMENTS: ELEMENTS,
    BIOME_BONUS: BIOME_BONUS,
    BIOME_EL: BIOME_EL,
    BIOME_NAMES: BIOME_NAMES,
    BNAME: BNAME,
    BICON: BICON,
    STAGES: STAGES,
    FIELD: FIELD,
    hbm: hbm,
    fresh: fresh,
    waived: waived,
    established: established,
    migrate: migrate,
    normalize: normalize,
    gatesClosed: gatesClosed,
    gameUnlocked: gameUnlocked,
    scanDecision: scanDecision,
    onFirstSummon: onFirstSummon,
    screenAllowed: screenAllowed,
    canStart: canStart,
    advance: advance,
    rewardPlan: rewardPlan,
    notePotions: notePotions,
    scansAfterClear: scansAfterClear,
    disadvantageElement: disadvantageElement,
    pickBiome: pickBiome,
    matchup: matchup,
    stageBrief: stageBrief,
    objectiveLabel: objectiveLabel,
    replayFrom: replayFrom
  };
});
