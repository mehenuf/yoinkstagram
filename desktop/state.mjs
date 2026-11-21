import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function atomicWrite(filename, contents) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  mkdirSync(dirname(filename), { recursive: true });
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flush: true });
    renameSync(temporary, filename);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeState(filename, state) {
  atomicWrite(filename, JSON.stringify(state));
}

export function readState(filename, destination = '') {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(filename, 'utf8')) || {};
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const jobs = Array.isArray(saved.jobs) ? saved.jobs.filter((job) => job && typeof job.id === 'string') : [];
  const now = Date.now();
  const cooldownUntil = Number.isFinite(saved.cooldownUntil) ? saved.cooldownUntil : null;
  const isCoolingDown = cooldownUntil && cooldownUntil > now;

  return {
    jobs: jobs.map((job) => {
      if (job.status === 'cooldown' && isCoolingDown) {
        return job;
      }
      if (job.status === 'running') {
        return {
          ...job,
          status: 'interrupted',
          phase: 'Interrupted',
          message: 'The app closed before this download finished. Retry to continue.',
          updatedAt: now,
        };
      }
      if (job.status === 'cooldown') {
        return {
          ...job,
          status: 'queued',
          phase: 'Queued',
          message: 'Ready to resume.',
          updatedAt: now,
        };
      }
      return job;
    }),
    paused: saved.paused === true,
    cooldownUntil,
    settings: {
      destination: typeof saved.settings?.destination === 'string' ? saved.settings.destination : destination,
      reduceMotion: saved.settings?.reduceMotion === true,
    },
  };
}

export function selectRunnable(state, now = Date.now()) {
  if (state.paused || (state.cooldownUntil && state.cooldownUntil > now)) return undefined;
  return state.jobs.find((job) => job.status === 'queued');
}
