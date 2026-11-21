import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { absolutePath, jobRequest } from './job-request.mjs';
import { readState, selectRunnable, writeState } from './state.mjs';

const activeStatuses = new Set(['running', 'cooldown']);
const outcomes = new Set(['completed', 'partial', 'failed', 'canceled']);
const phases = { completed: 'Completed', partial: 'Partially completed', failed: 'Failed', canceled: 'Canceled' };
const levels = new Set(['info', 'warn', 'error']);

function cleanText(value, fallback = '') {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 2500) || fallback
    : fallback;
}

function updateCounts(job, event, earlierFiles) {
  if (Number.isSafeInteger(event.items) && event.items >= 0) job.items = event.items;
  if (Number.isSafeInteger(event.files) && event.files >= 0) job.files = earlierFiles + event.files;
}

function log(job, level, message) {
  if (!message) return;
  job.logs.push({ at: Date.now(), level, message });
  if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
}

export class ArchiveQueue {
  #operation = null;
  #pendingAuthReset = null;
  #authGeneration = 0;
  #codeTimer = null;
  #dispatchTimer = null;
  #updateTimer = null;
  #closed = false;

  constructor({ filename, destination, worker, vault, version, onUpdate }) {
    this.filename = filename;
    this.worker = worker;
    this.vault = vault;
    this.version = version;
    this.onUpdate = onUpdate;
    this.state = readState(filename, destination);
  }

  snapshot() {
    const { jobs, ...rest } = this.state;
    return {
      ...rest,
      jobs: jobs.map(({ logs, rateLimitRetries, ...summary }) => summary),
      account: this.vault.current?.username ?? null,
      version: this.version,
    };
  }

  get destination() {
    return this.state.settings.destination;
  }

  getJobLogs(id) {
    return this.#job(id).logs;
  }

  #publish() {
    if (!this.#closed) this.onUpdate(this.snapshot());
  }

  #persist() {
    this.#commit(this.state);
  }

  #commit(next) {
    writeState(this.filename, next);
    this.state = next;
    clearTimeout(this.#updateTimer);
    this.#updateTimer = null;
    this.#publish();
  }

  #persistOrPause() {
    try {
      this.#persist();
    } catch {
      // Keep the in-memory queue available, and wait for a manual resume after storage recovers.
      this.state.paused = true;
      this.#publish();
    }
  }

  #persistSoon() {
    this.#updateTimer ??= setTimeout(() => {
      this.#updateTimer = null;
      this.#persistOrPause();
    }, 350);
  }

  start() {
    this.#persistOrPause();
    this.#dispatch();
  }

  enqueue(input) {
    const request = jobRequest(input);
    const timestamp = Date.now();
    const job = {
      id: randomUUID(), request,
      status: 'queued', createdAt: timestamp, updatedAt: timestamp,
      items: 0, files: 0, phase: 'Queued', logs: [],
    };
    this.#commit({ ...this.state, jobs: [...this.state.jobs, job] });
    this.#dispatch();
  }

  pauseQueue(paused) {
    if (typeof paused !== 'boolean') throw new Error('Invalid queue state.');
    this.#commit({ ...this.state, paused });
    this.#dispatch();
  }

  #job(id) {
    const job = this.state.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error('This download is no longer in the queue.');
    return job;
  }

  cancelJob(id) {
    const job = this.#job(id);
    if (job.status === 'queued') {
      const canceled = { ...job, logs: [...job.logs] };
      this.#finish(canceled, { status: 'canceled', message: 'Canceled before starting.' });
      this.#replaceJob(job, canceled);
    } else if (activeStatuses.has(job.status) && this.#operation?.job === job) {
      if (!this.#operation.cancelRequested) {
        this.worker.cancel(this.#operation.id);
        this.#operation.cancelRequested = true;
        job.phase = 'Canceling';
        job.message = undefined;
        job.updatedAt = Date.now();
        this.#persistOrPause();
      }
    } else {
      return;
    }
    this.#dispatch();
  }

  #replaceJob(previous, next) {
    this.#commit({ ...this.state, jobs: this.state.jobs.map((job) => job === previous ? next : job) });
  }

  retryJob(id) {
    const job = this.#job(id);
    if (job.status === 'queued' || activeStatuses.has(job.status)) return;
    const retry = {
      ...job,
      status: 'queued', phase: 'Queued', message: undefined, updatedAt: Date.now(), items: 0,
      rateLimitRetries: 0,
      logs: [...job.logs],
    };
    log(retry, 'info', 'Queued again. Existing downloaded files will be reused.');
    this.#replaceJob(job, retry);
    this.#dispatch();
  }

  removeJob(id) {
    const job = this.#job(id);
    if (activeStatuses.has(job.status)) throw new Error('Cancel the active download before removing it.');
    this.#commit({ ...this.state, jobs: this.state.jobs.filter((candidate) => candidate !== job) });
    this.#dispatch();
  }

  setSettings(settings) {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');
    const next = { ...this.state.settings };
    if (settings.destination !== undefined) next.destination = absolutePath(settings.destination);
    if (typeof settings.reduceMotion === 'boolean') next.reduceMotion = settings.reduceMotion;
    this.#commit({ ...this.state, settings: next });
  }

  #dispatch() {
    clearTimeout(this.#dispatchTimer);
    this.#dispatchTimer = null;
    if (this.#closed || this.#operation) return;
    if (this.#pendingAuthReset) {
      void this.#clearWorkerAuth();
      return;
    }
    if (this.#codeTimer) return;
    const now = Date.now();
    if (this.state.cooldownUntil && this.state.cooldownUntil <= now) {
      this.state.cooldownUntil = null;
      this.#persistOrPause();
    }
    const job = selectRunnable(this.state, now);
    if (job) {
      void this.#run(job);
      return;
    }
    if (this.state.cooldownUntil > now) {
      this.#dispatchTimer = setTimeout(() => this.#dispatch(), Math.min(this.state.cooldownUntil - now, 2_147_483_647));
    }
  }

  async #run(job) {
    const operation = { job, id: null, cancelRequested: false, earlierFiles: job.files ?? 0 };
    this.#operation = operation;
    try {
      const request = jobRequest(job.request);
      const session = request.useSession ? this.vault.current : null;
      if (request.useSession && !session) throw new Error('Sign in to Instagram before running this download.');
      mkdirSync(request.destination, { recursive: true });
      Object.assign(job, { status: 'running', phase: 'Starting', updatedAt: Date.now() });
      this.#persist();
      const { id, promise } = this.worker.request('download', { request, ...session }, (event) => this.#event(operation, event));
      operation.id = id;
      const outcome = await promise;
      if (this.#closed) return;
      if (outcome.code === 'session-expired' && session) this.vault.clear();
      if (outcome.code === 'checkpoint-required') this.state.paused = true;
      if (outcome.code === 'rate-limited') this.#finishRateLimited(operation, outcome);
      else this.#finish(job, outcome, operation.earlierFiles);
    } catch (error) {
      if (this.#closed) return;
      if (error.code === 'WORKER_UNAVAILABLE') this.state.paused = true;
      this.#finish(job, { status: 'failed', message: cleanText(error.message, 'The download could not start.') });
    } finally {
      this.#operation = null;
      if (!this.#closed) {
        this.#persistOrPause();
        queueMicrotask(() => this.#dispatch());
      }
    }
  }

  #finishRateLimited({ job, cancelRequested, earlierFiles }, outcome) {
    if (cancelRequested) {
      this.#finish(job, { ...outcome, status: 'canceled', message: 'Canceled during Instagram’s cooldown.' }, earlierFiles);
      return;
    }
    if (!job.rateLimitRetries && this.state.cooldownUntil > Date.now()) {
      const message = 'Instagram requested a cooldown. This download will retry when the cooldown ends.';
      Object.assign(job, {
        status: 'queued', phase: 'Waiting for Instagram', message, updatedAt: Date.now(), rateLimitRetries: 1,
      });
      updateCounts(job, outcome, earlierFiles);
      log(job, 'warn', message);
      return;
    }
    const status = earlierFiles > 0 || outcome.files > 0 ? 'partial' : 'failed';
    this.#finish(job, { ...outcome, status }, earlierFiles);
  }

  #finish(job, event, earlierFiles = 0) {
    const status = outcomes.has(event.status) ? event.status : 'failed';
    const message = cleanText(event.message);
    Object.assign(job, { status, phase: phases[status], message: message || undefined, updatedAt: Date.now() });
    updateCounts(job, event, earlierFiles);
    log(job, status === 'failed' ? 'error' : status === 'partial' ? 'warn' : 'info', message);
  }

  #event(operation, event) {
    const job = operation.job;
    if (event.event === 'cooldown' && Number.isFinite(event.seconds) && event.seconds > 0) {
      const deadline = Date.now() + Math.ceil(event.seconds * 1000);
      this.state.cooldownUntil = Math.max(this.state.cooldownUntil || 0, deadline);
      if (job && !operation.cancelRequested) {
        job.status = 'cooldown';
        job.phase = 'Waiting for Instagram';
        job.message = cleanText(event.message);
        job.updatedAt = Date.now();
      }
      this.#persistOrPause();
      return;
    }
    if (!job || !['log', 'progress'].includes(event.event)) return;
    if (event.event === 'log') {
      log(job, levels.has(event.level) ? event.level : 'info', cleanText(event.message));
    } else {
      updateCounts(job, event, operation.earlierFiles);
      if (!operation.cancelRequested && (job.status !== 'cooldown' || this.state.cooldownUntil <= Date.now())) {
        if (job.status === 'cooldown') job.message = undefined;
        job.status = 'running';
        job.phase = cleanText(event.phase, 'Downloading');
      }
    }
    job.updatedAt = Date.now();
    this.#persistSoon();
  }

  async authenticate(command, payload) {
    if (this.#operation || this.#pendingAuthReset) {
      return { status: 'failed', message: 'Wait for the active operation to finish or cancel it, then sign in.' };
    }
    if (command === 'two-factor' && !this.#codeTimer) {
      return { status: 'failed', message: 'Your verification request expired. Start sign-in again.' };
    }
    if (command === 'login' && this.#codeTimer) {
      return { status: 'two-factor', message: 'Enter the current verification code or return to sign-in.' };
    }
    if (this.state.cooldownUntil > Date.now()) {
      return { status: 'failed', message: 'Instagram is limiting requests. Sign in after the cooldown ends.' };
    }
    const generation = ++this.#authGeneration;
    const operation = { auth: true, id: null };
    this.#operation = operation;
    try {
      const { id, promise } = this.worker.request(command, payload, (event) => this.#event(operation, event));
      operation.id = id;
      const result = await promise;
      if (generation !== this.#authGeneration || this.#closed) return { status: 'failed', message: 'Sign-in was canceled.' };

      const message = cleanText(result.message);
      if (result.status === 'two-factor') {
        this.#codeTimer ??= setTimeout(() => void this.cancelAuth(), 600_000);
        return { status: 'two-factor', message };
      }
      this.#releaseCode();
      if (result.status === 'authenticated') {
        const remembered = await this.vault.replace({ username: result.username, session: result.session });
        if (generation !== this.#authGeneration || this.#closed) return { status: 'failed', message: 'Sign-in was canceled.' };
        this.#publish();
        return {
          status: 'authenticated', username: result.username,
          message: remembered ? message : 'Signed in for this app session. The system credential store is unavailable.',
        };
      }
      if (result.status === 'checkpoint') return { status: 'checkpoint', message, url: cleanText(result.url) };
      return { status: 'failed', message: message || 'Instagram sign-in failed.' };
    } catch (error) {
      this.#releaseCode();
      return { status: 'failed', message: cleanText(error.message, 'Instagram sign-in failed.') };
    } finally {
      this.#operation = null;
      this.#dispatch();
    }
  }

  #releaseCode() {
    clearTimeout(this.#codeTimer);
    this.#codeTimer = null;
  }

  cancelAuth() {
    if (!this.#codeTimer && !this.#operation?.auth && !this.#pendingAuthReset) return Promise.resolve();
    return this.#resetAuth(false);
  }

  logout() {
    this.vault.clear();
    void this.#resetAuth(true);
    this.#publish();
  }

  #resetAuth(cancelDownload) {
    this.#authGeneration += 1;
    this.#releaseCode();
    this.#pendingAuthReset ??= Promise.withResolvers();
    const { promise } = this.#pendingAuthReset;
    if (this.#operation?.auth || (cancelDownload && this.#operation?.job?.request.useSession)) {
      this.worker.cancel(this.#operation.id);
      this.#operation.cancelRequested = true;
      if (this.#operation.job) {
        this.#operation.job.phase = 'Canceling';
        this.#operation.job.message = undefined;
      }
    }
    this.#dispatch();
    return promise;
  }

  async #clearWorkerAuth() {
    const reset = this.#pendingAuthReset;
    this.#operation = { id: null };
    try {
      await this.worker.request('logout').promise;
    } catch {
      // An exited worker has already discarded its in-memory session.
    } finally {
      this.#pendingAuthReset = null;
      this.#operation = null;
      reset.resolve();
      this.#dispatch();
    }
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#dispatchTimer);
    clearTimeout(this.#updateTimer);
    this.#releaseCode();
    this.#pendingAuthReset?.resolve();
    try {
      this.#persist();
    } finally {
      await this.worker.close();
    }
  }
}
