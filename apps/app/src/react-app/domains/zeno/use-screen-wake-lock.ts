import { useEffect } from "react";

export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !navigator.wakeLock) return;
    let stopped = false, pending = false; let lock: WakeLockSentinel | null = null;
    const acquire = async () => { if (stopped || pending || document.visibilityState !== "visible" || (lock && !lock.released)) return; pending = true; try { const next = await navigator.wakeLock.request("screen"); if (stopped || document.visibilityState !== "visible") await next.release(); else lock = next; } catch { /* Screen wake lock is optional and permission denial needs no interruption. */ } finally { pending = false; } };
    const visibility = () => { if (document.visibilityState === "visible") void acquire(); else { void lock?.release().catch(() => {}); lock = null; } };
    void acquire(); document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; document.removeEventListener("visibilitychange", visibility); void lock?.release().catch(() => {}); };
  }, [enabled]);
}
