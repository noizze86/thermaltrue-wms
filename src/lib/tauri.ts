type TauriCore = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

function getTauri(): TauriCore | undefined {
  if (typeof window === "undefined") return undefined
  const w = window as unknown as Record<string, unknown>
  const tauri = w.__TAURI__ as Record<string, unknown> | undefined
  if (!tauri) return undefined
  if (typeof tauri.invoke === "function") return tauri as unknown as TauriCore
  const core = tauri.core as Record<string, unknown> | undefined
  if (core && typeof core.invoke === "function") return core as unknown as TauriCore
  return undefined
}

export function isTauri(): boolean {
  return getTauri() !== undefined
}

export function isTauriInvokeAvailable(): boolean {
  return isTauri()
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const tauri = getTauri()
  if (!tauri) return null
  try {
    return await tauri.invoke<T>(cmd, args)
  } catch {
    return null
  }
}
