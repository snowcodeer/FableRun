"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdaptiveAudioEngine,
  type AdaptiveAudioMix,
  type AdaptiveAudioResult,
  type AdaptiveAudioStatus,
} from "@/lib/platform/adaptive-audio";

/** React lifecycle wrapper around Cliffhanger's procedural Web Audio score. */
export function useAdaptiveAudio(
  initialMix: AdaptiveAudioMix = { intensity: 0, performance: 0 },
): AdaptiveAudioResult {
  const supported = AdaptiveAudioEngine.isSupported();
  const engineRef = useRef<AdaptiveAudioEngine | null>(null);
  const operationRef = useRef(0);
  const [status, setStatus] = useState<AdaptiveAudioStatus>(
    supported ? "idle" : "unsupported",
  );
  const [muted, setMutedState] = useState(false);
  const [mix, setMixState] = useState<Required<AdaptiveAudioMix>>({
    intensity: Math.min(1, Math.max(0, initialMix.intensity)),
    performance: Math.min(1, Math.max(-1, initialMix.performance ?? 0)),
  });

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new AdaptiveAudioEngine();
    return engineRef.current;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setStatus("unsupported");
      return false;
    }
    const operation = ++operationRef.current;
    setStatus("starting");
    try {
      const engine = getEngine();
      engine.setMix(mix);
      engine.setMuted(muted);
      const started = await engine.start();
      if (operation === operationRef.current) {
        setStatus(started ? "running" : "error");
      }
      return started;
    } catch {
      if (operation === operationRef.current) setStatus("error");
      return false;
    }
  }, [getEngine, mix, muted, supported]);

  const pause = useCallback(async () => {
    const operation = ++operationRef.current;
    await engineRef.current?.pause();
    if (operation === operationRef.current) {
      setStatus((previous) =>
        previous === "unsupported" || previous === "idle" ? previous : "paused",
      );
    }
  }, []);

  const resume = useCallback(async (): Promise<boolean> => {
    if (!engineRef.current) return start();
    const operation = ++operationRef.current;
    try {
      const resumed = await engineRef.current.resume();
      if (operation === operationRef.current) {
        setStatus(resumed ? "running" : "error");
      }
      return resumed;
    } catch {
      if (operation === operationRef.current) setStatus("error");
      return false;
    }
  }, [start]);

  const stop = useCallback(async () => {
    const operation = ++operationRef.current;
    const engine = engineRef.current;
    engineRef.current = null;
    await engine?.stop();
    if (operation === operationRef.current) {
      setStatus(supported ? "stopped" : "unsupported");
    }
  }, [supported]);

  const setMix = useCallback((nextMix: AdaptiveAudioMix) => {
    const normalized = {
      intensity: Math.min(1, Math.max(0, nextMix.intensity)),
      performance: Math.min(1, Math.max(-1, nextMix.performance ?? 0)),
    };
    setMixState(normalized);
    engineRef.current?.setMix(normalized);
  }, []);

  const setMuted = useCallback((nextMuted: boolean) => {
    setMutedState(nextMuted);
    engineRef.current?.setMuted(nextMuted);
  }, []);

  const toggleMuted = useCallback(() => {
    setMutedState((previous) => {
      const next = !previous;
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.stop();
    };
  }, []);

  return {
    supported,
    status,
    muted,
    mix,
    start,
    pause,
    resume,
    stop,
    setMix,
    setMuted,
    toggleMuted,
  };
}
