import { readFileSync, rmSync } from 'node:fs';
import { atomicWrite } from './state.mjs';

function valid(value) {
  return value && typeof value.username === 'string' && value.username.length > 0
    && value.session && typeof value.session === 'object' && !Array.isArray(value.session)
    && typeof value.session.sessionid === 'string' && value.session.sessionid.length > 0
    && Object.values(value.session).every((entry) => typeof entry === 'string');
}

export class SessionVault {
  #generation = 0;
  current = null;

  constructor(filename, storage) {
    this.filename = filename;
    this.storage = storage;
  }

  async #provider() {
    if (process.platform !== 'linux' && await this.storage.isAsyncEncryptionAvailable?.()) return 'async';
    if (!this.storage.isEncryptionAvailable?.()) return null;
    if (process.platform === 'linux' && !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(this.storage.getSelectedStorageBackend?.())) {
      return null;
    }
    return 'sync';
  }

  async restore() {
    try {
      const encrypted = readFileSync(this.filename);
      const provider = await this.#provider();
      if (!provider) return;
      const plaintext = provider === 'async'
        ? (await this.storage.decryptStringAsync(encrypted)).result
        : this.storage.decryptString(encrypted);
      const session = JSON.parse(plaintext);
      if (valid(session)) this.current = session;
    } catch {
      // A missing or unavailable OS credential store is equivalent to being signed out.
    }
  }

  async replace(session) {
    if (!valid(session)) throw new Error('Instagram did not return a valid session.');
    const generation = ++this.#generation;
    let encrypted;
    try {
      const provider = await this.#provider();
      if (provider === 'async') encrypted = await this.storage.encryptStringAsync(JSON.stringify(session));
      if (provider === 'sync') encrypted = this.storage.encryptString(JSON.stringify(session));
    } catch {
      // Session persistence can be unavailable when the operating system is locked.
    }
    if (this.#generation !== generation) return false;

    if (encrypted) {
      try {
        atomicWrite(this.filename, encrypted);
      } catch {
        encrypted = null;
      }
    }
    if (!encrypted) rmSync(this.filename, { force: true });
    this.current = session;
    return Boolean(encrypted);
  }

  clear() {
    this.#generation += 1;
    this.current = null;
    rmSync(this.filename, { force: true });
  }
}
