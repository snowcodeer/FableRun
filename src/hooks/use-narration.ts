"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  NarrationPrefetchResult,
  NarrationResult,
  NarrationSpeakOptions,
  NarrationStatus,
  NarrationUnavailableReason,
  NarrationUnavailableResponse,
} from "@/lib/platform/narration";

export interface UseNarrationResult {
  status: NarrationStatus;
  source: NarrationResult["source"];
  muted: boolean;
  error: string | null;
  speak: (text: string, options?: NarrationSpeakOptions) => Promise<NarrationResult>;
  /** Warm predictable lines without playing them. Audio stays in page memory. */
  prefetch: (texts: readonly string[]) => Promise<NarrationPrefetchResult>;
  cancel: () => void;
  setMuted: (muted: boolean) => void;
}

interface RemoteNarrationResult {
  blob: Blob | null;
  reason: NarrationUnavailableReason | null;
}

const MAX_PREFETCH_LINES = 12;
const MAX_CLIENT_CACHE_BYTES = 8 * 1_024 * 1_024;

function normalizeSpeechValue(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value ?? fallback));
}

/** ElevenLabs narration with an automatic, dependency-free browser fallback. */
export function useNarration(): UseNarrationResult {
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const [source, setSource] = useState<NarrationResult["source"]>("none");
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const audioCacheRef = useRef(new Map<string, Blob>());
  const audioCacheBytesRef = useRef(0);
  const prefetchRequestsRef = useRef(new Set<AbortController>());
  const browserCancelRef = useRef<(() => void) | null>(null);

  const clearRemoteAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    clearRemoteAudio();
    browserCancelRef.current?.();
    browserCancelRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setStatus("idle");
    setSource("none");
  }, [clearRemoteAudio]);

  const getCachedAudio = useCallback((text: string): Blob | null => {
    const cached = audioCacheRef.current.get(text);
    if (!cached) return null;
    audioCacheRef.current.delete(text);
    audioCacheRef.current.set(text, cached);
    return cached;
  }, []);

  const cacheAudio = useCallback((text: string, blob: Blob) => {
    if (blob.size === 0 || blob.size > MAX_CLIENT_CACHE_BYTES) return;
    const existing = audioCacheRef.current.get(text);
    if (existing) audioCacheBytesRef.current -= existing.size;
    audioCacheRef.current.delete(text);
    audioCacheRef.current.set(text, blob);
    audioCacheBytesRef.current += blob.size;

    while (audioCacheBytesRef.current > MAX_CLIENT_CACHE_BYTES) {
      const oldestKey = audioCacheRef.current.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      const oldest = audioCacheRef.current.get(oldestKey);
      audioCacheRef.current.delete(oldestKey);
      audioCacheBytesRef.current -= oldest?.size ?? 0;
    }
  }, []);

  const fetchRemoteAudio = useCallback(
    async (text: string, controller: AbortController): Promise<RemoteNarrationResult> => {
      try {
        const response = await fetch("/api/narrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (response.ok && response.headers.get("content-type")?.startsWith("audio/")) {
          const blob = await response.blob();
          if (blob.size > 0) return { blob, reason: null };
        }

        let reason: NarrationUnavailableReason = "provider_error";
        try {
          const payload = (await response.json()) as NarrationUnavailableResponse;
          if (payload.status === "unavailable") reason = payload.reason;
        } catch {
          // Invalid responses are normal fallback cases, never fatal to the run.
        }
        return { blob: null, reason };
      } catch (remoteError) {
        if (controller.signal.aborted) throw remoteError;
        return { blob: null, reason: "provider_error" };
      }
    },
    [],
  );

  const playRemoteAudio = useCallback(
    async (blob: Blob): Promise<boolean> => {
      clearRemoteAudio();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.muted = mutedRef.current;
      objectUrlRef.current = objectUrl;
      audioRef.current = audio;
      audio.onended = () => {
        clearRemoteAudio();
        setStatus("idle");
      };
      audio.onerror = () => {
        clearRemoteAudio();
        setStatus("error");
      };
      try {
        await audio.play();
        setSource("elevenlabs");
        setStatus("speaking");
        return true;
      } catch {
        clearRemoteAudio();
        return false;
      }
    },
    [clearRemoteAudio],
  );

  const speakInBrowser = useCallback(
    async (
      text: string,
      options: NarrationSpeakOptions,
    ): Promise<NarrationResult> => {
      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        setStatus("unavailable");
        setSource("none");
        setError("Narration is unavailable in this browser.");
        return { source: "none", ok: false, reason: "browser_unsupported" };
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang ?? "en-GB";
      utterance.rate = normalizeSpeechValue(options.rate, 0.96, 0.5, 2);
      utterance.pitch = normalizeSpeechValue(options.pitch, 0.82, 0, 2);
      utterance.volume = mutedRef.current ? 0 : 1;

      return new Promise<NarrationResult>((resolve) => {
        let settled = false;
        const finish = (result: NarrationResult, nextStatus: NarrationStatus) => {
          if (settled) return;
          settled = true;
          if (browserCancelRef.current === cancelPending) {
            browserCancelRef.current = null;
          }
          setStatus(nextStatus);
          resolve(result);
        };
        const cancelPending = () => {
          if (settled) return;
          settled = true;
          resolve({ source: "none", ok: false });
        };
        browserCancelRef.current = cancelPending;
        utterance.onstart = () => {
          if (settled) return;
          setSource("browser");
          setStatus("speaking");
        };
        utterance.onend = () => {
          finish({ source: "browser", ok: true }, "idle");
        };
        utterance.onerror = () => {
          if (settled) return;
          setError("Browser narration could not be played.");
          finish(
            { source: "browser", ok: false, reason: "playback_blocked" },
            "error",
          );
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
    },
    [],
  );

  const speak = useCallback(
    async (
      text: string,
      options: NarrationSpeakOptions = {},
    ): Promise<NarrationResult> => {
      const trimmedText = text.trim();
      if (!trimmedText || mutedRef.current) {
        return { source: "none", ok: false };
      }

      cancel();
      setError(null);
      if (options.preferRemote === false) {
        return speakInBrowser(trimmedText, options);
      }

      const cachedAudio = getCachedAudio(trimmedText);
      if (cachedAudio) {
        const played = await playRemoteAudio(cachedAudio);
        if (played) return { source: "elevenlabs", ok: true };
        return speakInBrowser(trimmedText, options);
      }

      const controller = new AbortController();
      requestRef.current = controller;
      setStatus("loading");
      try {
        const remote = await fetchRemoteAudio(trimmedText, controller);
        if (controller.signal.aborted) return { source: "none", ok: false };
        if (remote.blob) {
          cacheAudio(trimmedText, remote.blob);
          const played = await playRemoteAudio(remote.blob);
          if (played) return { source: "elevenlabs", ok: true };
        }
        const fallback = await speakInBrowser(trimmedText, options);
        return fallback.ok || !remote.reason
          ? fallback
          : { ...fallback, reason: remote.reason };
      } catch (narrationError) {
        if (controller.signal.aborted) return { source: "none", ok: false };
        setError(
          narrationError instanceof Error
            ? narrationError.message
            : "Remote narration failed; using the browser voice.",
        );
        return speakInBrowser(trimmedText, options);
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [
      cacheAudio,
      cancel,
      fetchRemoteAudio,
      getCachedAudio,
      playRemoteAudio,
      speakInBrowser,
    ],
  );

  const prefetch = useCallback(
    async (texts: readonly string[]): Promise<NarrationPrefetchResult> => {
      const uniqueTexts = Array.from(
        new Set(texts.map((text) => text.trim()).filter(Boolean)),
      ).slice(0, MAX_PREFETCH_LINES);
      let ready = 0;
      let unavailable = 0;

      await Promise.all(
        uniqueTexts.map(async (text) => {
          if (text.length > 800) {
            unavailable += 1;
            return;
          }
          if (getCachedAudio(text)) {
            ready += 1;
            return;
          }

          const controller = new AbortController();
          prefetchRequestsRef.current.add(controller);
          try {
            const remote = await fetchRemoteAudio(text, controller);
            if (remote.blob) {
              cacheAudio(text, remote.blob);
              ready += 1;
            } else {
              unavailable += 1;
            }
          } catch {
            unavailable += 1;
          } finally {
            prefetchRequestsRef.current.delete(controller);
          }
        }),
      );

      return { requested: uniqueTexts.length, ready, unavailable };
    },
    [cacheAudio, fetchRemoteAudio, getCachedAudio],
  );

  const setMuted = useCallback(
    (nextMuted: boolean) => {
      mutedRef.current = nextMuted;
      setMutedState(nextMuted);
      if (audioRef.current) audioRef.current.muted = nextMuted;
      if (nextMuted && typeof window !== "undefined") {
        cancel();
      }
    },
    [cancel],
  );

  useEffect(() => {
    const requests = prefetchRequestsRef.current;
    const audioCache = audioCacheRef.current;
    return () => {
      cancel();
      for (const controller of requests) controller.abort();
      requests.clear();
      audioCache.clear();
      audioCacheBytesRef.current = 0;
    };
  }, [cancel]);

  return { status, source, muted, error, speak, prefetch, cancel, setMuted };
}
