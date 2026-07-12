/************************************************************
 * idb.js — IndexedDB 얇은 래퍼 (LOCAL_STORAGE_SPEC)
 * ----------------------------------------------------------
 * 스토어: drafts · cache · queue · jobs · kv
 * Vanilla JS에서 IndexedDB의 장황함을 1회 포장.
 ************************************************************/
import { CONFIG } from './config.js';

const STORES = ['drafts', 'cache', 'queue', 'jobs', 'kv'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 미지원')); return; }
    const req = indexedDB.open(CONFIG.IDB_NAME, CONFIG.IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const idb = {
  get(store, key) { return tx(store, 'readonly', os => reqP(os.get(key))); },
  put(store, key, value) { return tx(store, 'readwrite', os => reqP(os.put(value, key))); },
  del(store, key) { return tx(store, 'readwrite', os => reqP(os.delete(key))); },
  keys(store) { return tx(store, 'readonly', os => reqP(os.getAllKeys())); },
  all(store) { return tx(store, 'readonly', os => reqP(os.getAll())); },
  clear(store) { return tx(store, 'readwrite', os => reqP(os.clear())); },
};
