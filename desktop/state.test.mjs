import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readState, writeState, selectRunnable } from './state.mjs';

test('recover an interrupted download and retain the server cooldown', (t) => {
  const path = mkdtempSync(join(tmpdir(), 'archivist-state-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const filename = join(path, 'state.json');
  writeState(filename, {
    paused: false,
    cooldownUntil: 20_000,
    jobs: [{ id: 'running', status: 'running' }, { id: 'done', status: 'completed' }],
  });

  const restored = readState(filename);
  assert.equal(restored.jobs[0].status, 'interrupted');
  assert.equal(restored.jobs[1].status, 'completed');
  assert.equal(restored.cooldownUntil, 20_000);
  assert.deepEqual(readdirSync(path), ['state.json']);
});

test('the next queued job waits for an active cooldown or pause', () => {
  const history = { id: 'done', status: 'completed' };
  const first = { id: 'first', status: 'queued' };
  const second = { id: 'second', status: 'queued' };
  const state = { jobs: [history, first, second], paused: false, cooldownUntil: 5_000 };

  assert.equal(selectRunnable(state, 4_999), undefined);
  assert.equal(selectRunnable(state, 5_000)?.id, 'first');
  assert.equal(selectRunnable({ ...state, paused: true }, 10_000), undefined);
});
