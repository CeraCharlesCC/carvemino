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
  assert.equal(getMenuBpm(), 104);
  assert.equal(getGameplayBpm(1), 116);
  assert.equal(getGameplayBpm(2), 123);
  assert.equal(getGameplayBpm(5), 144);
  assert.equal(getGameplayBpm(99), 200);
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
  assert.equal(music.getState().bpm, 104);

  const menuBatch = context.oscillators.length;
  music.setScene("gameplay");
  assert(context.oscillators.length > menuBatch, "gameplay lead and bass should replace the menu arrangement");
  assert.equal(timers.activeCount, 1);
  assert.equal(music.getState().playing, true);
  assert.equal(music.getState().bpm, 116);

  const firstBatch = context.oscillators.length;
  music.setIntensity(4);
  assert(context.oscillators.length > firstBatch, "new-level notes should be rescheduled");
  assert.equal(music.getState().bpm, 137);
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