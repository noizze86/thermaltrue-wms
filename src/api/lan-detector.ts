import { isTauriInvokeAvailable, tauriInvoke } from "../lib/tauri";

const CACHE_KEY = "wms_api_url_cache";
const MAX_ENTRIES = 5;
const TTL_MS = 10 * 60 * 1000;

interface ApiUrlEntry {
  id: string;
  url: string;
  hitCount: number;
  lastSeen: number;
  lastSuccess: number;
}

interface ApiUrlCache {
  entries: ApiUrlEntry[];
  preferredId: string | null;
  lastUpdated: number;
}

function readCache(): ApiUrlCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function saveCache(cache: ApiUrlCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function getBestValidEntry(cache: ApiUrlCache): ApiUrlEntry | null {
  const now = Date.now();
  const sorted = [...cache.entries].sort((a, b) => {
    if (a.id === cache.preferredId) return -1;
    if (b.id === cache.preferredId) return 1;
    return b.hitCount - a.hitCount || b.lastSeen - a.lastSeen;
  });
  return sorted.find(e => now - e.lastSuccess < TTL_MS) || null;
}

function getAnyEntry(cache: ApiUrlCache): ApiUrlEntry | null {
  if (!cache.entries.length) return null;
  return [...cache.entries].sort((a, b) => b.hitCount - a.hitCount || b.lastSeen - a.lastSeen)[0];
}

export function addEntry(url: string) {
  const cache = readCache() || { entries: [], preferredId: null, lastUpdated: 0 };
  const now = Date.now();
  const existing = cache.entries.find(e => e.url === url);
  if (existing) {
    existing.hitCount++;
    existing.lastSeen = now;
    existing.lastSuccess = now;
  } else {
    const id = `lan-${url.replace(/[^a-zA-Z0-9]/g, "-")}`;
    cache.entries.push({ id, url, hitCount: 1, lastSeen: now, lastSuccess: now });
    cache.entries.sort((a, b) => b.hitCount - a.hitCount || b.lastSeen - a.lastSeen);
    if (cache.entries.length > MAX_ENTRIES) cache.entries = cache.entries.slice(0, MAX_ENTRIES);
  }
  cache.lastUpdated = now;
  saveCache(cache);
}

function bumpHit(id: string) {
  const cache = readCache();
  if (!cache) return;
  const entry = cache.entries.find(e => e.id === id);
  if (entry) {
    entry.hitCount++;
    entry.lastSeen = Date.now();
    saveCache(cache);
  }
}

export async function detectApiUrlTauri(): Promise<string | null> {
  if (!isTauriInvokeAvailable()) return null
  const url = await tauriInvoke<string>("get_detected_api_url", { ports: [3000, 3001, 3002] })
  if (url) addEntry(url)
  return url
}

function generateIPRange(base: string, start: number, end: number): string[] {
  const ips: string[] = []
  for (let i = start; i <= end; i++) ips.push(`${base}.${i}`)
  return ips
}

const COMMON_SUBNETS: [string, number, number][] = [
  ["192.168.0", 100, 120],
  ["192.168.1", 100, 120],
  ["192.168.100", 100, 120],
  ["10.0.0", 100, 120],
  ["10.0.1", 100, 120],
  ["172.16.0", 100, 120],
]

async function tryProbe(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal, method: "GET" })
    return res.ok
  } catch {
    return false
  }
}

export async function scanSubnetBrowser(port: number = 3000, timeoutPerProbe: number = 2000, scheme: string = "http"): Promise<string | null> {
  const ips = COMMON_SUBNETS.flatMap(([base, s, e]) => generateIPRange(base, s, e))
  const baseUrl = (ip: string) => `${scheme}://${ip}:${port}`

  for (let i = 0; i < ips.length; i += 6) {
    const batch = ips.slice(i, i + 6)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutPerProbe)

    const results = await Promise.allSettled(
      batch.map(ip => tryProbe(baseUrl(ip), controller.signal))
    )
    clearTimeout(timer)

    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === "fulfilled" && r.value) {
        const url = baseUrl(batch[j])
        addEntry(url)
        return url
      }
    }
  }
  return null
}

export async function detectApiUrl(): Promise<string | null> {
  // 1. Tauri invoke — scan LAN interfaces via Rust
  const tauriUrl = await detectApiUrlTauri()
  if (tauriUrl) return tauriUrl

  // 2. Cache valid
  const cache = readCache()
  if (cache) {
    const valid = getBestValidEntry(cache)
    if (valid) {
      try {
        const res = await fetch(`${valid.url}/api/health`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          bumpHit(valid.id)
          return valid.url
        }
      } catch { /* stale */ }
    }
  }

  // 3. Env var fallback
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) {
    try {
      const res = await fetch(`${envUrl}/api/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        addEntry(envUrl)
        return envUrl
      }
    } catch { /* down */ }
  }

  // 4. JS subnet scan — HTTP
  let subnetUrl = await scanSubnetBrowser(3000)
  if (subnetUrl) return subnetUrl
  subnetUrl = await scanSubnetBrowser(3001)
  if (subnetUrl) return subnetUrl

  // 5. JS subnet scan — HTTPS
  subnetUrl = await scanSubnetBrowser(443, 2000, "https")
  if (subnetUrl) return subnetUrl
  subnetUrl = await scanSubnetBrowser(8443, 2000, "https")
  if (subnetUrl) return subnetUrl

  // 6. Expired cache (last resort)
  return cache ? (getAnyEntry(cache)?.url ?? null) : null
}

export function getDetectedUrl(): string | null {
  const cache = readCache();
  if (!cache) return null;
  return getBestValidEntry(cache)?.url ?? getAnyEntry(cache)?.url ?? null;
}

export function getDetectedUrlDisplay(): { url: string; isExpired: boolean } | null {
  const cache = readCache();
  if (!cache) return null;
  const best = getBestValidEntry(cache);
  if (best) return { url: best.url, isExpired: false };
  const any = getAnyEntry(cache);
  if (any) return { url: any.url, isExpired: Date.now() - any.lastSuccess >= TTL_MS };
  return null;
}
