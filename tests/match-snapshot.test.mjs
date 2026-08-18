import test from "node:test";
import assert from "node:assert/strict";

import {
  createMatch,
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch,
  stepMatch
} from "../src/domain/match.js";
import { defineSurvivalPolicy } from "../src/domain/match/survival.js";
import { defineVersusPolicy } from "../src/domain/match/versus.js";
import { makeTestRules } from "./helpers/rules.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeVersusPolicy(id = "snapshot-versus-policy") {
  return defineVersusPolicy({
    id,
    lineClearAttackRows: [0, 0, 1, 2, 4],
    garbageWarningWorldTicks: 20,
    cancellation: true
  });
}

test("match snapshot round trip preserves the complete deterministic hash", () => {
  const rules = makeTestRules();
  const policy = makeVersusPolicy();
  const match = createMatch({
    id: "snapshot-round-trip",
    playerIds: ["host", "joiner"],
    seed: 0x12345678,
    rules,
    policy
  });
  match.policyState.nextGarbageSequence = 7;
  match.policyState.pendingAttacks.push({ sourcePlayerId: "host", rows: 1 });

  const beforeHash = hashMatch(match);
  const snapshot = snapshotMatch(match);
  const wireCopy = clone(snapshot);

  assert.deepEqual(snapshot.playerIds, ["host", "joiner"]);
  assert.equal(snapshot.players.length, 2);
  assert.deepEqual(snapshot.policyState, {
    nextGarbageSequence: 7,
    pendingAttacks: [{ sourcePlayerId: "host", rows: 1 }]
  });
  assert.doesNotThrow(() => JSON.stringify(snapshot));

  snapshot.playerIds[0] = "mutated";
  snapshot.policyState.pendingAttacks[0].rows = 4;
  snapshot.players[0].game.board.cells[0] = 8;
  assert.equal(match.players[0].id, "host");
  assert.equal(match.policyState.pendingAttacks[0].rows, 1);
  assert.equal(getPlayerGame(match, "host").board.cells[0], 0);
  assert.equal(hashMatch(match), beforeHash, "snapshot mutations must not leak into live state");

  const restored = restoreMatch(wireCopy, { rules, policy });
  assert.equal(hashMatch(restored), beforeHash);
  assert.deepEqual(snapshotMatch(restored), wireCopy);
  wireCopy.policyState.pendingAttacks[0].rows = 4;
  wireCopy.players[0].game.board.cells[0] = 8;
  assert.equal(restored.policyState.pendingAttacks[0].rows, 1);
  assert.equal(getPlayerGame(restored, "host").board.cells[0], 0);
});

test("match snapshots require explicit policy state serialization hooks", () => {
  const rules = makeTestRules();
  const policy = {
    id: "no-snapshot-hooks-policy",
    validatePlayerIds() {},
    createState() { return {}; },
    beforeStep() {},
    onGameEvent() {},
    afterStep() {}
  };
  const match = createMatch({
    id: "no-snapshot-hooks",
    playerIds: ["solo"],
    rules,
    policy
  });

  assert.throws(() => snapshotMatch(match), /snapshotState must be a function/);
});

test("createMatch enforces identifiers that can be represented by match snapshots", () => {
  const rules = makeTestRules();
  const policy = makeVersusPolicy("identifier-versus-policy");

  assert.throws(
    () => createMatch({ id: 123, playerIds: ["a", "b"], rules, policy }),
    /match id must be a non-empty string/
  );
  assert.throws(
    () => createMatch({ id: "", playerIds: ["a", "b"], rules, policy }),
    /match id must be a non-empty string/
  );
  assert.throws(
    () => createMatch({ id: "valid", playerIds: ["a", 2], rules, policy }),
    /playerIds\[1\] must be a non-empty string/
  );
  assert.throws(
    () => createMatch({ id: "valid", playerIds: ["a", "  "], rules, policy }),
    /playerIds\[1\] must be a non-empty string/
  );
});

test("match policies cannot finish with result shapes the match snapshot contract cannot restore", () => {
  const rules = makeTestRules();
  const policy = {
    id: "unsupported-result-policy",
    validatePlayerIds() {},
    createState() { return {}; },
    snapshotState() { return {}; },
    restoreState() { return {}; },
    beforeStep() {},
    onGameEvent() {},
    afterStep(context) {
      context.finish({ type: "custom-result", atMatchTick: context.matchTick });
    }
  };
  const match = createMatch({
    id: "unsupported-result-match",
    playerIds: ["solo"],
    rules,
    policy
  });

  assert.throws(() => stepMatch(match, {}), /match policy result\.type is unsupported: custom-result/);
  assert.equal(match.status, "playing");
  assert.equal(match.result, null);
});

test("restored versus state preserves future garbage identity, winner, and hash", () => {
  const rules = makeTestRules();
  const policy = makeVersusPolicy("continuation-versus-policy");
  const original = createMatch({
    id: "continuation-match",
    playerIds: ["a", "b"],
    seed: 42,
    rules,
    policy
  });
  original.policyState.nextGarbageSequence = 11;
  original.policyState.pendingAttacks.push({ sourcePlayerId: "a", rows: 2 });
  const restored = restoreMatch(snapshotMatch(original), { rules, policy });

  const originalEvents = stepMatch(original, {});
  const restoredEvents = stepMatch(restored, {});
  const originalGarbage = originalEvents.find((event) => event.type === "GARBAGE_SENT");
  const restoredGarbage = restoredEvents.find((event) => event.type === "GARBAGE_SENT");

  assert(originalGarbage);
  assert(restoredGarbage);
  assert.equal(originalGarbage.packet.id, "continuation-match:g11");
  assert.deepEqual(restoredGarbage.packet, originalGarbage.packet);
  assert.equal(hashMatch(restored), hashMatch(original));

  for (const match of [original, restored]) {
    const defeated = getPlayerGame(match, "b");
    defeated.status = "gameover";
    defeated.gameOverReason = "spawn-blocked";
  }
  const originalFinishEvents = stepMatch(original, {});
  const restoredFinishEvents = stepMatch(restored, {});

  assert.deepEqual(restored.result, original.result);
  assert.deepEqual(restored.result, {
    type: "winner",
    winnerId: "a",
    atMatchTick: 1
  });
  assert.deepEqual(restoredFinishEvents, originalFinishEvents);
  assert.equal(hashMatch(restored), hashMatch(original));

  const recoveredFinished = restoreMatch(snapshotMatch(restored), { rules, policy });
  assert.deepEqual(recoveredFinished.result, restored.result);
  assert.equal(hashMatch(recoveredFinished), hashMatch(restored));
});

test("restore rejects hostile match snapshots before exposing recovered state", () => {
  const rules = makeTestRules();
  const policy = makeVersusPolicy("hostile-versus-policy");
  const match = createMatch({
    id: "hostile-match",
    playerIds: ["a", "b"],
    seed: 99,
    rules,
    policy
  });
  match.policyState.pendingAttacks.push({ sourcePlayerId: "a", rows: 1 });
  stepMatch(match, {});
  const base = snapshotMatch(match);

  const cases = [
    ["unknown top-level field", (snapshot) => { snapshot.hostile = true; }, /hostile is not supported/],
    ["unknown schema", (snapshot) => { snapshot.schemaVersion += 1; }, /Unsupported match snapshot schema/],
    ["ruleset binding", (snapshot) => { snapshot.rulesetId = "other-rules"; }, /ruleset mismatch/],
    ["policy binding", (snapshot) => { snapshot.policyId = "other-policy"; }, /policy mismatch/],
    ["roster order", (snapshot) => { snapshot.playerIds.reverse(); }, /players\[0\]\.id must match/],
    ["game snapshot", (snapshot) => { snapshot.players[0].game.board.width += 1; }, /must match ruleset width/],
    [
      "invalid garbage sequence",
      (snapshot) => { snapshot.policyState.nextGarbageSequence = 0; },
      /nextGarbageSequence must be an integer >= 1/
    ],
    [
      "rolled-back garbage sequence",
      (snapshot) => { snapshot.policyState.nextGarbageSequence = 1; },
      /nextGarbageSequence must be greater than reserved garbage sequence 1/
    ],
    [
      "rolled-back active game clock",
      (snapshot) => { snapshot.players[0].game.stepTick -= 1; },
      /stepTick must equal matchTick while playing/
    ],
    [
      "unknown pending attack source",
      (snapshot) => { snapshot.policyState.pendingAttacks = [{ sourcePlayerId: "intruder", rows: 1 }]; },
      /sourcePlayerId must identify a match player/
    ],
    ["injected policy state", (snapshot) => { snapshot.policyState.extra = true; }, /extra is not supported/],
    ["playing result injection", (snapshot) => { snapshot.result = { type: "draw", atMatchTick: 0 }; }, /must be null/],
    [
      "unsupported terminal result",
      (snapshot) => {
        snapshot.status = "finished";
        snapshot.result = { type: "custom-result", atMatchTick: snapshot.matchTick - 1 };
      },
      /result\.type is unsupported/
    ]
  ];

  for (const [name, mutate, expected] of cases) {
    const snapshot = clone(base);
    mutate(snapshot);
    assert.throws(() => restoreMatch(snapshot, { rules, policy }), expected, name);
  }
});

test("survival policy state is serialized and restored explicitly", () => {
  const rules = makeTestRules();
  const policy = defineSurvivalPolicy({
    id: "snapshot-survival-policy",
    garbageWarningWorldTicks: 30,
    firstWaveMatchTick: 0,
    waveIntervalMatchTicks: 60,
    rowsPerWaveStepMatchTicks: 120,
    maximumRowsPerWave: 4
  });
  const match = createMatch({
    id: "snapshot-survival",
    playerIds: ["solo"],
    seed: 7,
    rules,
    policy
  });
  stepMatch(match, {});

  const snapshot = snapshotMatch(match);
  const restored = restoreMatch(snapshot, { rules, policy });

  assert.deepEqual(snapshot.policyState, { nextWave: 2 });
  assert.equal(hashMatch(restored), hashMatch(match));
  assert.deepEqual(snapshotMatch(restored), snapshot);

  const stale = clone(snapshot);
  stale.policyState.nextWave = 1;
  assert.throws(
    () => restoreMatch(stale, { rules, policy }),
    /survival policy state\.nextWave must be 2 at matchTick 1/
  );

  const advanced = clone(snapshot);
  advanced.policyState.nextWave = 3;
  assert.throws(
    () => restoreMatch(advanced, { rules, policy }),
    /survival policy state\.nextWave must be 2 at matchTick 1/
  );
});
