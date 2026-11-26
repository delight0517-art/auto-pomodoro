'use strict';
const fs = require('node:fs');

// Conf reparses the complete session archive for every get(); retain values
// only while the file identity and timestamps match, including external writes.
module.exports = function cacheStoreReads(store) {
  const get = store.get.bind(store);
  let snapshot;
  let version;
  const currentVersion = () => {
    let nextVersion;
    try {
      const stat = fs.statSync(store.path, { bigint: true });
      nextVersion = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch (error) {
      snapshot = undefined;
      version = undefined;
      return null;
    }
    if (nextVersion !== version) {
      snapshot = undefined;
      version = nextVersion;
    }
    return version;
  };
  store.getRevision = currentVersion;
  store.get = (key, defaultValue) => {
    if (currentVersion() === null) return get(key, defaultValue);
    if (snapshot === undefined) snapshot = store.store;
    // Reuse Conf's dotted-key lookup against one validated file snapshot.
    const value = store._get.call({ store: snapshot }, key);
    return value === undefined ? defaultValue : structuredClone(value);
  };
  return store;
};
