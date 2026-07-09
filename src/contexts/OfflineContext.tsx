import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import { getQueueLength, addToQueue, syncQueue, onOnlineChange, setSyncHandler, getCache, setCache } from "../lib/offline"
import type { QueueItem } from "../lib/offline"
import { toast } from "../hooks/use-toast"

interface OfflineContextType {
  isOnline: boolean
  isSyncing: boolean
  queueLength: number
  lastSync: number | null
  offlineQuery: <T>(key: string, fetcher: () => Promise<T>) => Promise<T>
  enqueueMutation: (action: string, payload: unknown) => Promise<void>
  triggerSync: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  isSyncing: false,
  queueLength: 0,
  lastSync: null,
  offlineQuery: async (_, fetcher) => fetcher(),
  enqueueMutation: async () => {},
  triggerSync: async () => {},
})

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [queueLen, setQueueLen] = useState(0)
  const [lastSync, setLastSync] = useState<number | null>(null)

  const refreshQueueLen = useCallback(async () => {
    const len = await getQueueLength()
    setQueueLen(len)
  }, [])

  const triggerSync = useCallback(async () => {
    if (isSyncing || !navigator.onLine) return
    setIsSyncing(true)
    try {
      const result = await syncQueue()
      if (result.synced > 0) {
        toast({ title: "Sync Complete", description: `${result.synced} synced, ${result.failed} failed` })
      }
      setLastSync(Date.now())
    } catch {
      toast({ title: "Sync Failed", description: "Could not sync offline queue", variant: "destructive" })
    }
    setIsSyncing(false)
    await refreshQueueLen()
  }, [isSyncing, refreshQueueLen])

  useEffect(() => {
    const unsub = onOnlineChange(async (online) => {
      setIsOnline(online)
      if (online) {
        await refreshQueueLen()
        triggerSync()
      }
    })
    refreshQueueLen()
    return unsub
  }, [refreshQueueLen, triggerSync])

  const offlineQuery = useCallback(async <T,>(key: string, fetcher: () => Promise<T>): Promise<T> => {
    if (!navigator.onLine) {
      const cached = await getCache<T>(key)
      if (cached !== null) return cached
      throw new Error("You are offline and no cached data is available.")
    }
    try {
      const data = await fetcher()
      await setCache(key, data)
      return data
    } catch (e) {
      const cached = await getCache<T>(key)
      if (cached !== null) return cached
      throw e
    }
  }, [])

  const enqueueMutation = useCallback(async (action: string, payload: unknown) => {
    if (navigator.onLine) {
      throw new Error("Cannot enqueue mutation while online. Call the API directly.")
    }
    await addToQueue(action, payload)
    toast({ title: "Queued Offline", description: `"${action}" will sync when online` })
    await refreshQueueLen()
  }, [refreshQueueLen])

  return (
    <OfflineContext.Provider value={{
      isOnline,
      isSyncing,
      queueLength: queueLen,
      lastSync,
      offlineQuery,
      enqueueMutation,
      triggerSync,
    }}>
      {children}
    </OfflineContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useOffline = () => useContext(OfflineContext)

// eslint-disable-next-line react-refresh/only-export-components
export function registerSyncHandler(handler: (item: QueueItem) => Promise<void>) {
  setSyncHandler(handler)
}