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

export async function detectApiUrl(): Promise<string | null> {
  const cache = readCache();
  if (cache) {
    const valid = getBestValidEntry(cache);
    if (valid) {
      try {
        const res = await fetch(`${valid.url}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          bumpHit(valid.id);
          return valid.url;
        }
      } catch { /* stale, continue scanning */ }
    }
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const url = await invoke<string | null>("get_detected_api_url");
    if (url) {
      addEntry(url);
      return url;
    }
  } catch { /* not in Tauri */ }

  const fallback = import.meta.env.VITE_API_URL || "http://localhost:3000";
  try {
    const res = await fetch(`${fallback}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      addEntry(fallback);
      return fallback;
    }
  } catch { /* server down */ }

  return cache ? (getAnyEntry(cache)?.url ?? null) : null;
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
