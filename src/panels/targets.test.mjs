import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTargets } from './targets.ts';

test('normalizes profile links and deduplicates handles case-insensitively', () => {
  assert.deepEqual(normalizeTargets('profile', '@example, instagram.com/EXAMPLE/?igsh=abc\nsecond'), [
    'example',
    'second',
  ]);
});

test('accepts post links and preserves case-sensitive shortcodes', () => {
  assert.deepEqual(normalizeTargets('post', 'https://www.instagram.com/reel/Ab_C-1/?hl=en\nabc-1'), [
    'Ab_C-1',
    'abc-1',
  ]);
});

test('rejects host impersonators and multi-part paths', () => {
  assert.throws(() => normalizeTargets('post', 'https://instagram.com.evil.example/p/Abc123/'));
  assert.throws(() => normalizeTargets('profile', 'https://www.instagram.com/p/Abc123/'));
});

test('extracts the numeric ID from an Instagram location link', () => {
  assert.deepEqual(normalizeTargets('location', 'https://www.instagram.com/explore/locations/123456/place/'), ['123456']);
});
