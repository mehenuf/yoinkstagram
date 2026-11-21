import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

class WorkerError extends Error {
  constructor(message) {
    super(message);
    this.code = 'WORKER_UNAVAILABLE';
  }
}

export class WorkerHost {
  #process = null;
  #pending = new Map();
  #closed = false;
  #shutdown = null;

  constructor({ packaged, projectPath, resourcesPath }) {
    this.packaged = packaged;
    this.projectPath = projectPath;
    this.resourcesPath = resourcesPath;
  }

  #start() {
    if (this.#closed) throw new WorkerError('The download engine is shutting down.');
    if (this.#process) return this.#process;

    const windows = process.platform === 'win32';
    const localPython = join(this.projectPath, '.venv', windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python');
    const python = process.env.ARCHIVIST_PYTHON || (existsSync(localPython) ? localPython : windows ? 'python' : 'python3');
    const bundled = join(this.resourcesPath, 'engine', windows ? 'archivist-engine.exe' : 'archivist-engine');
    const child = spawn(this.packaged ? bundled : python, this.packaged ? [] : ['-u', '-m', 'engine'], {
      cwd: this.packaged ? this.resourcesPath : this.projectPath,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#process = child;

    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const operation = event && this.#pending.get(event.id);
      if (!operation || this.#process !== child) return;
      if (event.event === 'result') {
        this.#pending.delete(event.id);
        operation.resolve(event);
      } else {
        operation.onEvent?.(event);
      }
    });
    child.stderr.resume();

    const stopped = () => {
      if (this.#process !== child) return;
      this.#process = null;
      const message = this.packaged
        ? 'The bundled download engine stopped. Restart Yoinkstagram and retry the job.'
        : 'The download engine stopped. Verify Python and the dependencies in requirements.txt, then retry.';
      this.#rejectPending(new WorkerError(message));
    };
    child.on('error', stopped);
    child.stdin.on('error', stopped);
    output.on('error', stopped);
    child.on('close', stopped);
    return child;
  }

  #rejectPending(error) {
    for (const operation of this.#pending.values()) operation.reject(error);
    this.#pending.clear();
  }

  #send(message) {
    const child = this.#start();
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(command, payload = {}, onEvent) {
    const id = randomUUID();
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onEvent });
      try {
        this.#send({ id, command, ...payload });
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
    return { id, promise };
  }

  cancel(targetId) {
    if (this.#process?.stdin.writable && this.#pending.has(targetId)) {
      this.#send({ id: randomUUID(), command: 'cancel', targetId });
    }
  }

  close() {
    if (this.#shutdown) return this.#shutdown;
    this.#closed = true;
    this.#rejectPending(new WorkerError('The download engine is shutting down.'));
    const child = this.#process;
    if (!child) return Promise.resolve();
    this.#shutdown = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 36_000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (child.stdin.writable) child.stdin.end();
    });
    return this.#shutdown;
  }
}
