// 서버(server/pomodoro-api.js)와 Electron 메인(main/main.js)이 **같은** 병합 규칙을
// 써야 하는 함수들. 원래 server/pomodoro-api.js 안에만 정의돼 있었는데,
// main/main.js의 normalizeApiState()가 이걸 그대로 호출하면서 import는 하지 않아
// 모든 API 스냅샷 파싱이 ReferenceError로 죽는 사고가 있었다(2026-08-23 — 맥이
// 윈도우의 "쉬는 시간"을 몇 시간째 못 받던 원인). 복붙으로 두 벌을 만들면 규칙이
// 갈라지므로, 한 곳에 두고 양쪽이 require 한다.

function identityKeyOf(item) {
  if (!item || typeof item !== 'object') return undefined;
  return item.id ?? item.bundleId ?? item.domain ?? item.name;
}

// Merges `incoming` into `base` without ever deleting something `base` has
// and `incoming` doesn't know about. Objects merge key-by-key (recursively).
// Arrays of plain values are replaced (an intentional list edit, e.g. the
// user's selected app list). Arrays of tagged objects are merged by identity
// so a client that isn't aware of extra per-item fields (like a Windows tag
// color) won't strip them when it re-saves the list.
function deepMergeAdditive(base, incoming) {
  if (Array.isArray(incoming)) {
    if (!Array.isArray(base)) return incoming;
    const incomingAreObjects = incoming.every((item) => item && typeof item === 'object');
    const baseAreObjects = base.every((item) => item && typeof item === 'object');
    if (incomingAreObjects && baseAreObjects) {
      const baseByKey = new Map(base.map((item) => [identityKeyOf(item), item]));
      return incoming.map((item) => {
        const key = identityKeyOf(item);
        const existing = key !== undefined ? baseByKey.get(key) : undefined;
        return existing ? deepMergeAdditive(existing, item) : item;
      });
    }
    return incoming;
  }
  if (incoming && typeof incoming === 'object') {
    const result = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = deepMergeAdditive(result[key], value);
    }
    return result;
  }
  return incoming;
}

module.exports = { identityKeyOf, deepMergeAdditive };
