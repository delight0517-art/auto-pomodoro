'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIRECTORY_NAME = 'Auto Pomodoro Login';
const FILE_NAME = 'credentials.v1.bin';
const MAGIC = Buffer.from('APLOGIN1');
const ALLOWED_KEYS = new Set([
  'cloudAccount.token',
  'cloudAccount.username',
  'cloudAccount.password',
  'timerCloud.username',
  'timerCloud.pin',
]);

function createReinstallCredentialStore({ safeStorage, getAppDataPath, platform = process.platform, io = fs }) {
  function isAvailable() {
    return (platform === 'darwin' || platform === 'win32')
      && typeof safeStorage?.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable();
  }

  function locations() {
    const root = path.resolve(getAppDataPath(), DIRECTORY_NAME);
    return { root, file: path.join(root, FILE_NAME) };
  }

  function readAll() {
    if (!isAvailable()) return {};
    const { root, file } = locations();
    try {
      if (io.lstatSync(root).isSymbolicLink() || io.lstatSync(file).isSymbolicLink()) {
        throw new Error('Refusing to read a linked login vault path.');
      }
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
    const encrypted = io.readFileSync(file);
    if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unsupported login vault format.');
    const decoded = JSON.parse(safeStorage.decryptString(encrypted.subarray(MAGIC.length)));
    if (!decoded || decoded.version !== 1 || !decoded.credentials || typeof decoded.credentials !== 'object') return {};
    return Object.fromEntries(Object.entries(decoded.credentials)
      .filter(([key, value]) => ALLOWED_KEYS.has(key) && typeof value === 'string'));
  }

  function writeAll(credentials) {
    if (!isAvailable()) throw new Error('OS-protected credential storage is unavailable.');
    const { root, file } = locations();
    try {
      if (io.lstatSync(root).isSymbolicLink()) throw new Error('Refusing to write a linked login vault directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    io.mkdirSync(root, { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, credentials }));
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
      io.writeFileSync(temporary, Buffer.concat([MAGIC, encrypted]), { flag: 'wx', mode: 0o600 });
      io.chmodSync(temporary, 0o600);
      io.renameSync(temporary, file);
      io.chmodSync(file, 0o600);
    } finally {
      try { io.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  return {
    isAvailable,
    get(key) {
      if (!ALLOWED_KEYS.has(key)) throw new Error('Unsupported credential key.');
      return readAll()[key] ?? null;
    },
    set(key, value) {
      if (!ALLOWED_KEYS.has(key) || typeof value !== 'string' || value.length === 0) throw new Error('Invalid credential entry.');
      const credentials = readAll();
      credentials[key] = value;
      writeAll(credentials);
      return true;
    },
    delete(key) {
      if (!ALLOWED_KEYS.has(key)) throw new Error('Unsupported credential key.');
      const credentials = readAll();
      if (!(key in credentials)) return false;
      delete credentials[key];
      if (Object.keys(credentials).length) {
        writeAll(credentials);
      } else {
        const { root, file } = locations();
        try { io.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { io.rmdirSync(root); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; }
      }
      return true;
    },
  };
}

let defaultStore;
function getDefaultStore() {
  if (defaultStore) return defaultStore;
  const electron = require('electron');
  defaultStore = createReinstallCredentialStore({
    safeStorage: electron.safeStorage,
    getAppDataPath: () => electron.app.getPath('appData'),
  });
  return defaultStore;
}

module.exports = { createReinstallCredentialStore, get: (...args) => getDefaultStore().get(...args),
  set: (...args) => getDefaultStore().set(...args), delete: (...args) => getDefaultStore().delete(...args),
  isAvailable: () => getDefaultStore().isAvailable() };
