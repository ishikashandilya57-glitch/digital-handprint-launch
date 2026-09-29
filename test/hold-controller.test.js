'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HoldController = require('../public/hold-controller');

test('an early release resets progress and permits a retry', () => {
  let time = 0, queued, completed = 0, progress = [];
  const hold = new HoldController({ duration: 2000, now: () => time, schedule: fn => { queued = fn; return 1; }, cancel: () => {}, onProgress: value => progress.push(value), onComplete: () => completed++ });
  hold.start(); time = 700; queued(); hold.stop();
  assert.equal(progress.at(-1), 0); assert.equal(completed, 0); assert.equal(hold.completed, false);
  hold.start(); time = 2700; queued();
  assert.equal(completed, 1); assert.equal(hold.completed, true);
});
