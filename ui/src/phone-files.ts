// The phone's copy of the files of the job in progress: one PDF, or photos in the order they were
// shared or picked. The service worker puts a share here, the app puts picked files here, and every
// upload reads from here. It lives in IndexedDB, so it is still there after a full page load, and it
// also works over plain HTTP. The app clears it when the person leaves the job.

const databaseName = "print-buddy"
const storeName = "phone-files"
/** The store holds one record: the files of the one job a phone can have in progress. */
const key = "job"

function openDatabase(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
  const open = indexedDB.open(databaseName, 1)
  open.onupgradeneeded = () => { open.result.createObjectStore(storeName) }
  open.onsuccess = () => resolve(open.result)
  open.onerror = () => reject(open.error)
  return promise
}

/** Runs one request in its own transaction and resolves once the transaction is on disk. */
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  try {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    const transaction = database.transaction(storeName, mode)
    const request = work(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = transaction.onabort = () => reject(transaction.error)
    return await promise
  } finally {
    database.close()
  }
}

export const phoneFiles = {
  /** Replaces what the phone holds with these files. */
  async keep(files: File[]): Promise<void> {
    await run("readwrite", store => store.put(files, key))
  },

  /** The files the phone holds, in the order they were kept. Empty when it holds none. */
  async held(): Promise<File[]> {
    return (await run<File[] | undefined>("readonly", store => store.get(key))) ?? []
  },

  /** The person left the job: the phone forgets the files. */
  async clear(): Promise<void> {
    await run("readwrite", store => store.delete(key))
  },
}
