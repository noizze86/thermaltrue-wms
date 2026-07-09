const DB_NAME = "thermaltrue-offline"
const DB_VERSION = 1
const CACHE_STORE = "cache"
const QUEUE_STORE = "queue"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" })
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true })
        store.createIndex("status", "status", { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Cache ──

export interface CacheEntry<T = unknown> {
  key: string
  data: T
  cachedAt: number
}

export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly")
    const store = tx.objectStore(CACHE_STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve((req.result as CacheEntry<T>)?.data ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function setCache<T = unknown>(key: string, data: T): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite")
    const store = tx.objectStore(CACHE_STORE)
    store.put({ key, data, cachedAt: Date.now() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearCache(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite")
    tx.objectStore(CACHE_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Queue ──

export interface QueueItem {
  id?: number
  action: string
  payload: unknown
  createdAt: number
  status: "pending" | "syncing" | "failed"
  error?: string
}

export async function addToQueue(action: string, payload: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).add({ action, payload, createdAt: Date.now(), status: "pending" })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPendingQueue(): Promise<QueueItem[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly")
    const index = tx.objectStore(QUEUE_STORE).index("status")
    const req = index.getAll("pending")
    req.onsuccess = () => resolve(req.result as QueueItem[])
    req.onerror = () => reject(req.error)
  })
}

export async function getQueueLength(): Promise<number> {
  const items = await getPendingQueue()
  return items.length
}

export async function markQueueItem(id: number, status: "syncing" | "failed", error?: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    const store = tx.objectStore(QUEUE_STORE)
    const req = store.get(id)
    req.onsuccess = () => {
      const item = req.result as QueueItem
      if (item) {
        item.status = status
        if (error) item.error = error
        store.put(item)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeQueueItem(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearQueue(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Sync ──

export type SyncHandler = (item: QueueItem) => Promise<void>

let _syncHandler: SyncHandler | null = null

export function setSyncHandler(handler: SyncHandler) {
  _syncHandler = handler
}

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (!_syncHandler) return { synced: 0, failed: 0 }
  const items = await getPendingQueue()
  let synced = 0
  let failed = 0
  for (const item of items) {
    if (!item.id) continue
    try {
      await markQueueItem(item.id, "syncing")
      await _syncHandler(item)
      await removeQueueItem(item.id)
      synced++
    } catch (e) {
      await markQueueItem(item.id, "failed", String(e))
      failed++
    }
  }
  return { synced, failed }
}

// ── Online status ──

export function onOnlineChange(handler: (online: boolean) => void): () => void {
  const onOnline = () => handler(true)
  const onOffline = () => handler(false)
  window.addEventListener("online", onOnline)
  window.addEventListener("offline", onOffline)
  handler(navigator.onLine)
  return () => {
    window.removeEventListener("online", onOnline)
    window.removeEventListener("offline", onOffline)
  }
}