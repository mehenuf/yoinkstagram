import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { ArchiveQueue } from './queue.mjs';

function setup(t, resolve, onUpdate = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'archivist-queue-'));
  const vault = { current: { username: 'earlier_account', session: { sessionid: 'test' } } };
  const worker = {
    request: (command, _payload, onEvent) => ({ id: command, promise: Promise.resolve(resolve(command, onEvent)) }),
    close: () => {},
  };
  const filename = join(directory, 'queue.json');
  const queue = new ArchiveQueue({ filename, destination: directory, worker, vault, version: 'test', onUpdate });
  t.after(async () => {
    await queue.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const request = { targetType: 'profile', targets: ['test'], destination: directory };
  return { queue, request, filename };
}

test('retry keeps the file total and adds the files saved by the new attempt', async (t) => {
  let attempt = 0;
  const { queue, request } = setup(t, () => [
    { status: 'partial', files: 3, items: 2 },
    { status: 'completed', files: 2, items: 4 },
  ][attempt++]);
  queue.enqueue(request);
  await setImmediate();
  const { id } = queue.snapshot().jobs[0];
  queue.retryJob(id);
  assert.equal(queue.snapshot().jobs[0].files, 3);
  await setImmediate();
  const [job] = queue.snapshot().jobs;
  assert.equal(job.status, 'completed');
  assert.equal(job.files, 5);
  assert.equal(job.items, 4);
});

test('pending two-factor keeps a queued download idle until the challenge is discarded', async (t) => {
  const { queue, request } = setup(t, (command) => ({ status: command === 'login' ? 'two-factor' : 'completed' }));
  assert.equal((await queue.authenticate('login', {})).status, 'two-factor');
  queue.enqueue(request);
  await setImmediate();
  assert.equal(queue.snapshot().jobs[0].status, 'queued');
  await queue.cancelAuth();
  await setImmediate();
  assert.equal(queue.snapshot().jobs[0].status, 'completed');
  assert.equal(queue.snapshot().account, 'earlier_account');
});

test('a rate-limited job enters cooldown and persists across retries without dropping from queue', async (t) => {
  let attempts = 0;
  const { queue, request } = setup(t, (_command, onEvent) => {
    attempts += 1;
    onEvent({ event: 'cooldown', seconds: 0.2 });
    return { status: 'failed', code: 'rate-limited', files: 1 };
  });
  queue.enqueue(request);
  await setImmediate();
  assert.equal(queue.snapshot().jobs[0].status, 'cooldown');
  assert.equal(queue.snapshot().jobs[0].files, 1);
  await setTimeout(350);
  assert.equal(attempts, 2);
  assert.equal(queue.snapshot().jobs[0].status, 'cooldown');
  assert.equal(queue.snapshot().jobs[0].files, 2);
});

test('an Instagram checkpoint pauses the queue before dispatching the next job', async (t) => {
  const { queue, request } = setup(t, () => ({ status: 'failed', code: 'checkpoint-required' }));
  queue.enqueue(request);
  queue.enqueue(request);
  await setImmediate();
  assert.equal(queue.snapshot().paused, true);
  assert.deepEqual(queue.snapshot().jobs.map((job) => job.status), ['failed', 'queued']);
});

test('status snapshots omit logs while job details and persisted history keep them', async (t) => {
  const broadcasts = [];
  const { queue, request, filename } = setup(t, () => ({ status: 'completed', message: 'Archive saved.' }),
    (state) => broadcasts.push(state));
  queue.enqueue(request);
  await setImmediate();

  const [job] = queue.snapshot().jobs;
  assert.equal(job.status, 'completed');
  assert.equal(Object.hasOwn(job, 'logs'), false);
  assert.ok(broadcasts.some((state) => state.jobs[0]?.status === 'completed'));
  assert.ok(broadcasts.every((state) => state.jobs.every((summary) => !Object.hasOwn(summary, 'logs'))));
  assert.equal(queue.getJobLogs(job.id)[0].message, 'Archive saved.');
  assert.equal(JSON.parse(readFileSync(filename, 'utf8')).jobs[0].logs[0].message, 'Archive saved.');
});
