import assert from "node:assert/strict";
import test from "node:test";

import { createMusicController, getGameplayBpm, getMenuBpm } from "../src/audio/music.js";
import { FakeAudioContext, FakeGain } from "./helpers/web-audio.mjs";

function createFakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setIntervalFn(callback, delay) {
      const id = nextId++;
      active.set(id, { callback, delay });
      return id;
    },
    clearIntervalFn(id) {
      active.delete(id);
    },
    get activeCount() {
      return active.size;
    }
  };
}

test("gameplay tempo is constant within a level and rises in discrete level steps", () => {
  const levelOne = getGameplayBpm(1);
  const levelTwo = getGameplayBpm(2);
  assert(Number.isFinite(getMenuBpm()) && getMenuBpm() > 0);
  assert(Number.isFinite(levelOne) && levelOne > 0);
  assert(levelTwo > levelOne);
  assert(getGameplayBpm(5) > levelTwo);
  assert.equal(getGameplayBpm(2.1), levelTwo);
  assert.equal(getGameplayBpm(2.9), levelTwo);
  assert.equal(getGameplayBpm(0), levelOne);
  assert.equal(getGameplayBpm(9999), getGameplayBpm(99999), "tempo must remain capped at high levels");
});

test("Amur Waves menu BGM and Kalinka gameplay BGM follow the audio scene", () => {
  const context = new FakeAudioContext({ currentTime: 12 });
  const output = new FakeGain();
  const timers = createFakeTimers();
  const music = createMusicController(timers);

  music.setScene("menu");
  music.attach({ context, output });
  assert(context.oscillators.length >= 8, "menu lead, bass, and waltz chord stabs should be scheduled");
  assert.equal(timers.activeCount, 1);
  assert.equal(music.getState().playing, true);
  assert.equal(music.getState().bpm, getMenuBpm());

  const menuBatch = context.oscillators.length;
  music.setScene("gameplay");
  assert(context.oscillators.length > menuBatch, "gameplay lead and bass should replace the menu arrangement");
  assert.equal(timers.activeCount, 1);
  assert.equal(music.getState().playing, true);
  assert.equal(music.getState().bpm, getGameplayBpm(1));

  const firstBatch = context.oscillators.length;
  music.setIntensity(4);
  assert(context.oscillators.length > firstBatch, "new-level notes should be rescheduled");
  assert.equal(music.getState().bpm, getGameplayBpm(4));
  assert.equal(timers.activeCount, 1);

  music.setScene("paused");
  assert.equal(music.getState().playing, false);
  assert.equal(timers.activeCount, 0);

  music.setScene("gameplay");
  assert.equal(music.getState().playing, true);
  assert.equal(timers.activeCount, 1);

  music.setScene("gameover");
  assert.equal(music.getState().playing, false);
  assert.equal(timers.activeCount, 0);

  music.setScene("menu");
  assert.equal(music.getState().playing, true);
  assert.equal(timers.activeCount, 1);

  music.dispose();
  assert.equal(timers.activeCount, 0);
});