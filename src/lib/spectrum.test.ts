import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spectrumToColumns } from './spectrum';

const RATE = 48_000;
const BINS = 2048; // fftSize 4096 → ~11.7 Hz per bin

function toneAt(hz: number, level = 255): Uint8Array {
  const bins = new Uint8Array(BINS);
  bins[Math.round(hz / (RATE / 2 / BINS))] = level;
  return bins;
}

const loudest = (cols: number[]) => cols.indexOf(Math.max(...cols));

test('silence is flat zero, one value per column', () => {
  const cols = spectrumToColumns(new Uint8Array(BINS), RATE, 56);
  assert.equal(cols.length, 56);
  assert.ok(cols.every((v) => v === 0));
});

test('a bass note lights the left, a hi-hat the right, in order of pitch', () => {
  const bass = loudest(spectrumToColumns(toneAt(80), RATE, 56));
  const voice = loudest(spectrumToColumns(toneAt(1000), RATE, 56));
  const hat = loudest(spectrumToColumns(toneAt(8000), RATE, 56));
  assert.ok(bass < 10, `bass at column ${bass}`);
  assert.ok(hat > 45, `hat at column ${hat}`);
  assert.ok(bass < voice && voice < hat);
});

test('levels stay within 0..1 even with the high-end lift', () => {
  const full = new Uint8Array(BINS).fill(255);
  for (const v of spectrumToColumns(full, RATE, 56)) assert.ok(v >= 0 && v <= 1);
});
