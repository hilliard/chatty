import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeTimestamp } from '../src/scripts/timestamps.mjs';

const now = new Date(2026, 8, 30, 15, 0, 0);
const ago = seconds => new Date(now.getTime() - seconds * 1000);
test('recent timestamps transition at minute and hour boundaries', () => {
  for (const [seconds, label] of [[0, 'Just now'], [59, 'Just now'], [60, '1m ago'], [300, '5m ago'], [3599, '59m ago'], [3600, '1h ago'], [7200, '2h ago'], [86399, '23h ago']]) {
    assert.equal(relativeTimestamp(ago(seconds), now, 'en-US'), label);
  }
});
test('older timestamps use yesterday, weekday, then absolute date', () => {
  assert.equal(relativeTimestamp(new Date(2026, 8, 29, 14), now, 'en-US'), 'Yesterday');
  assert.equal(relativeTimestamp(new Date(2026, 8, 28, 14), now, 'en-US'), 'Monday');
  assert.equal(relativeTimestamp(new Date(2026, 8, 23, 14), now, 'en-US'), 'Wednesday');
  assert.equal(relativeTimestamp(new Date(2026, 8, 22, 14), now, 'en-US'), 'Sep 22');
  assert.equal(relativeTimestamp(new Date(2025, 8, 22, 14), now, 'en-US'), 'Sep 22, 2025');
});
test('labels advance when the client clock advances', () => {
  const sent = ago(300);
  assert.equal(relativeTimestamp(sent, now), '5m ago');
  assert.equal(relativeTimestamp(sent, new Date(now.getTime() + 60000)), '6m ago');
});
test('clock skew never creates negative ages and invalid values are harmless', () => {
  assert.equal(relativeTimestamp(ago(-120), now), 'Just now');
  assert.equal(relativeTimestamp('invalid', now), '');
});
