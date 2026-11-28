// Zapis lokalny (IndexedDB, awaryjnie localStorage) – dane przetrwają zamknięcie aplikacji.
window.Store = (() => {
  'use strict';
  // wersja testowa (KN_CONFIG.env) ma osobną bazę – ten sam adres co produkcja, więc inaczej by się mieszały
  const ENV = (window.KN_CONFIG || {}).env;
  const DB = 'kamienickie-nutki' + (ENV ? '-' + ENV : '');
  const OS = 'kv';
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(OS);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }

  async function get(key) {
    try {
      const d = await db();
      return await new Promise((resolve, reject) => {
        const q = d.transaction(OS).objectStore(OS).get(key);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    } catch (e) {
      try {
        const v = localStorage.getItem('kn-' + key);
        return v ? JSON.parse(v) : undefined;
      } catch (e2) {
        return undefined;
      }
    }
  }

  async function set(key, value) {
    try {
      const d = await db();
      await new Promise((resolve, reject) => {
        const t = d.transaction(OS, 'readwrite');
        t.objectStore(OS).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    } catch (e) {
      try { localStorage.setItem('kn-' + key, JSON.stringify(value)); } catch (e2) { /* trudno */ }
    }
  }

  return { get, set };
})();
