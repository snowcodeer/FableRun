"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  NarrationLine,
  NarrationPrefetchResult,
  NarrationResult,
  NarrationSpeakOptions,
  NarrationStatus,
  NarrationUnavailableReason,
  NarrationUnavailableResponse,
  NarrationVoiceRole,
} from "@/lib/platform/narration";

export interface UseNarrationResult {
  status: NarrationStatus;
  source: NarrationResult["source"];
  muted: boolean;
  error: string | null;
  speak: (text: string, options?: NarrationSpeakOptions) => Promise<NarrationResult>;
  /** Warm predictable lines without playing them. Audio stays in page memory. */
  prefetch: (lines: readonly (string | NarrationLine)[]) => Promise<NarrationPrefetchResult>;
  cancel: () => void;
  setMuted: (muted: boolean) => void;
}

interface RemoteNarrationResult {
  blob: Blob | null;
  reason: NarrationUnavailableReason | null;
}

const MAX_PREFETCH_LINES = 12;
const MAX_CLIENT_CACHE_BYTES = 8 * 1_024 * 1_024;

function narrationCacheKey(text: string, voice: NarrationVoiceRole): string {
  return `${voice}\u0000${text}`;
}

function normalizeSpeechValue(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value ?? fallback));
}

function browserVoiceFor(role: NarrationVoiceRole): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const preferredNames = role === "character_female"
    ? /samantha|victoria|karen|moira|tessa|female/i
    : role === "character_male"
      ? /daniel|alex|oliver|thomas|male/i
      : /daniel|george|arthur|oliver/i;
  return voices.find((voice) => /^en[-_]gb$/i.test(voice.lang) && preferredNames.test(voice.name))
    ?? voices.find((voice) => preferredNames.test(voice.name))
    ?? voices.find((voice) => /^en[-_]gb$/i.test(voice.lang));
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
    async (
      text: string,
      voice: NarrationVoiceRole,
      controller: AbortController,
    ): Promise<RemoteNarrationResult> => {
      try {
        const response = await fetch("/api/narrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, voice }),
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
      const voiceRole = options.voice ?? "narrator";
      utterance.lang = options.lang ?? "en-GB";
      utterance.voice = browserVoiceFor(voiceRole) ?? null;
      utterance.rate = normalizeSpeechValue(
        options.rate,
        voiceRole === "character_female" ? 1 : voiceRole === "character_male" ? 0.94 : 0.96,
        0.5,
        2,
      );
      utterance.pitch = normalizeSpeechValue(
        options.pitch,
        voiceRole === "character_female" ? 1.06 : voiceRole === "character_male" ? 0.86 : 0.82,
        0,
        2,
      );
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

      const voice = options.voice ?? "narrator";
      const cacheKey = narrationCacheKey(trimmedText, voice);
      const cachedAudio = getCachedAudio(cacheKey);
      if (cachedAudio) {
        const played = await playRemoteAudio(cachedAudio);
        if (played) return { source: "elevenlabs", ok: true };
        return speakInBrowser(trimmedText, options);
      }

      const controller = new AbortController();
      requestRef.current = controller;
      setStatus("loading");
      try {
        const remote = await fetchRemoteAudio(trimmedText, voice, controller);
        if (controller.signal.aborted) return { source: "none", ok: false };
        if (remote.blob) {
          cacheAudio(cacheKey, remote.blob);
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
    async (lines: readonly (string | NarrationLine)[]): Promise<NarrationPrefetchResult> => {
      const normalized = lines
        .map((line) => typeof line === "string" ? { text: line, voice: "narrator" as const } : {
          text: line.text,
          voice: line.voice ?? "narrator",
        })
        .map((line) => ({ ...line, text: line.text.trim() }))
        .filter((line) => line.text.length > 0);
      const uniqueLines = Array.from(
        new Map(
          normalized.map((line) => [narrationCacheKey(line.text, line.voice), line]),
        ).values(),
      ).slice(0, MAX_PREFETCH_LINES);
      let ready = 0;
      let unavailable = 0;

      await Promise.all(
        uniqueLines.map(async ({ text, voice }) => {
          if (text.length > 800) {
            unavailable += 1;
            return;
          }
          const cacheKey = narrationCacheKey(text, voice);
          if (getCachedAudio(cacheKey)) {
            ready += 1;
            return;
          }

          const controller = new AbortController();
          prefetchRequestsRef.current.add(controller);
          try {
            const remote = await fetchRemoteAudio(text, voice, controller);
            if (remote.blob) {
              cacheAudio(cacheKey, remote.blob);
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

      return { requested: uniqueLines.length, ready, unavailable };
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
