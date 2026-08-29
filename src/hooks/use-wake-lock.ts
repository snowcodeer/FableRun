"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  WakeLockNavigatorLike,
  WakeLockResult,
  WakeLockSentinelLike,
  WakeLockStatus,
} from "@/lib/platform/wake-lock";

function subscribeToWakeLockSupport(): () => void {
  return () => undefined;
}

function getWakeLockSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "wakeLock" in navigator &&
    Boolean((navigator as WakeLockNavigatorLike).wakeLock)
  );
}

/** Optional screen Wake Lock with visibility-change reacquisition. */
export function useWakeLock(active = false): WakeLockResult {
  const supported = useSyncExternalStore(
    subscribeToWakeLockSupport,
    getWakeLockSupport,
    () => false,
  );
  const [status, setStatus] = useState<WakeLockStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const desiredRef = useRef(active);
  const requestVersionRef = useRef(0);

  const request = useCallback(async (): Promise<boolean> => {
    desiredRef.current = true;
    const wakeLock = (navigator as WakeLockNavigatorLike).wakeLock;
    if (!wakeLock) {
      setStatus("unsupported");
      return false;
    }
    if (sentinelRef.current && !sentinelRef.current.released) return true;

    setStatus("requesting");
    setError(null);
    const requestVersion = ++requestVersionRef.current;
    try {
      const sentinel = await wakeLock.request("screen");
      if (
        requestVersion !== requestVersionRef.current ||
        !desiredRef.current
      ) {
        await sentinel.release();
        return false;
      }
      sentinelRef.current = sentinel;
      sentinel.addEventListener(
        "release",
        () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setStatus("released");
          }
        },
        { once: true },
      );
      setStatus("active");
      return true;
    } catch (wakeLockError) {
      if (
        requestVersion !== requestVersionRef.current ||
        !desiredRef.current
      ) {
        return false;
      }
      setError(
        wakeLockError instanceof Error
          ? wakeLockError.message
          : "Screen wake lock could not be acquired.",
      );
      setStatus("error");
      return false;
    }
  }, []);

  const release = useCallback(async (): Promise<void> => {
    desiredRef.current = false;
    requestVersionRef.current += 1;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel && !sentinel.released) await sentinel.release();
    setStatus(sentinel ? "released" : "idle");
  }, []);

  useEffect(() => {
    desiredRef.current = active;
    const task = setTimeout(() => {
      if (active) void request();
      else void release();
    }, 0);
    return () => clearTimeout(task);
  }, [active, release, request]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && desiredRef.current) {
        void request();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      desiredRef.current = false;
      requestVersionRef.current += 1;
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [request]);

  return {
    supported,
    status: supported ? status : "unsupported",
    error,
    request,
    release,
  };
}
