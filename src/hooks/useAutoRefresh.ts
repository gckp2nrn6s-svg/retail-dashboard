"use client";
import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-refresh hook. Calls `fn` immediately, then every `intervalMs`.
 * Pauses when the tab is hidden, resumes when visible.
 * Returns a manual `refresh` function.
 */
export function useAutoRefresh(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fnRef.current(), intervalMs);
  }, [intervalMs]);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    fnRef.current(); // immediate call
    start();

    const onVisibility = () => {
      if (document.hidden) stop();
      else { fnRef.current(); start(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [start, stop]);

  return useCallback(() => fnRef.current(), []);
}
