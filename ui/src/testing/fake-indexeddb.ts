// Seam 3 helper: happy-dom has no IndexedDB, so the phone's storage is this in-memory stand-in.
// It covers what `phone-files.ts` uses and nothing more. Values are kept as they are, not cloned.

/** A request that has already finished. Its handlers are called on a later microtask, as in a browser. */
function finished<T>(result: T, events: ("onupgradeneeded" | "onsuccess")[] = ["onsuccess"]) {
  const request: { result: T; error: null; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = { result, error: null }
  queueMicrotask(() => { for (const event of events) request[event]?.() })
  return request
}

/** A fresh, empty phone storage. The setup file installs one as `indexedDB` before each test. */
export function fakeIndexedDb() {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>()
  return {
    open(name: string) {
      const isNew = !databases.has(name)
      if (isNew) databases.set(name, new Map())
      const stores = databases.get(name)!
      const database = {
        createObjectStore(storeName: string) { stores.set(storeName, new Map()) },
        transaction(storeName: string) {
          const records = stores.get(storeName)
          if (!records) throw new DOMException(`No object store "${storeName}"`, "NotFoundError")
          const transaction: { objectStore: () => object; error: null; oncomplete?: () => void } = {
            objectStore: () => ({
              put: (value: unknown, key: IDBValidKey) => finished(void records.set(key, value)),
              get: (key: IDBValidKey) => finished(records.get(key)),
              delete: (key: IDBValidKey) => finished(void records.delete(key)),
            }),
            error: null,
          }
          // completes after the requests made in the same turn have reported
          setTimeout(() => transaction.oncomplete?.())
          return transaction
        },
        close() {},
      }
      return finished(database, isNew ? ["onupgradeneeded", "onsuccess"] : ["onsuccess"])
    },
  }
}
