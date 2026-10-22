// Alarmları ve olayları basit bir JSON dosyasında saklar (kişisel kullanım için yeterli).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_EVENTS = 500;

export function createStore(path) {
  let state = { watches: [], events: [] };
  if (path) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  function save() {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${path}.tmp`, path);
  }

  return {
    listWatches: () => state.watches,
    getWatch: (id) => state.watches.find((w) => w.id === id),
    addWatch(watch) {
      state.watches.push(watch);
      save();
      return watch;
    },
    updateWatch(id, patch) {
      const watch = state.watches.find((w) => w.id === id);
      if (!watch) return null;
      Object.assign(watch, patch);
      save();
      return watch;
    },
    removeWatch(id) {
      const before = state.watches.length;
      state.watches = state.watches.filter((w) => w.id !== id);
      state.events = state.events.filter((e) => e.watchId !== id);
      save();
      return state.watches.length !== before;
    },
    addEvents(events) {
      if (!events.length) return;
      state.events = [...events, ...state.events].slice(0, MAX_EVENTS);
      save();
    },
    listEvents({ since, watchId, limit = 100 } = {}) {
      return state.events
        .filter((e) => (!since || e.at > since) && (!watchId || e.watchId === watchId))
        .slice(0, limit);
    },
  };
}
