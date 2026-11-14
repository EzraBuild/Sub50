import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BPM_RANGE, Meter, groove, grooveLevels } from './beat';

test('same track and position → same picture on every device', () => {
  const a = grooveLevels(groove('dQw4w9WgXcQ', 32), 42.137);
  const b = grooveLevels(groove('dQw4w9WgXcQ', 32), 42.137);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, grooveLevels(groove('N9U9A4_cgyI', 32), 42.137), 'another track grooves differently');
});

test('levels stay in range and the tempo is plausible', () => {
  for (const id of ['dQw4w9WgXcQ', 'N9U9A4_cgyI', 'abc', '']) {
    const g = groove(id, 24);
    assert.ok(g.bpm >= BPM_RANGE[0] && g.bpm <= BPM_RANGE[1], `${g.bpm}`);
    for (let t = 0; t < 30; t += 0.173) for (const v of grooveLevels(g, t)) assert.ok(v >= 0 && v <= 1);
  }
});

test('the lows jump on the beat and fall before the next one', () => {
  const g = groove('dQw4w9WgXcQ', 32);
  const beat = 60 / g.bpm;
  let onBeat = 0;
  let late = 0;
  for (let i = 8; i < 40; i++) {
    onBeat += grooveLevels(g, i * beat + 0.01)[0]!;
    late += grooveLevels(g, i * beat + beat * 0.85)[0]!;
  }
  assert.ok(onBeat > late * 1.4, `on ${onBeat.toFixed(2)} vs late ${late.toFixed(2)}`);
});

test('meter: fast attack, slower fall, peak holds then drops', () => {
  const m = new Meter();
  m.step([1], 16);
  assert.ok(m.levels[0]! > 0.6, 'attack');
  for (let i = 0; i < 5; i++) m.step([1], 16);
  m.step([0], 100);
  assert.ok(m.levels[0]! > 0.8 && m.levels[0]! < 0.95, 'falls ~1.2/s, not instantly');
  const peak = m.peaks[0]!;
  m.step([0], 100);
  assert.equal(m.peaks[0], peak, 'peak holds');
  for (let i = 0; i < 20; i++) m.step([0], 100);
  assert.equal(m.levels[0], 0);
  assert.ok(m.peaks[0]! < peak, 'then drops');
});
