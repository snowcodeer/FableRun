"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clamp,
  DEMO_SPEED_METERS_PER_SECOND,
  distanceBetween,
  paceFromSpeed,
  type CoordinateSample,
  type DemoDescriptor,
  type GpsStatus,
  type RunCalibration,
  type RunMetrics,
  type RunPhase,
  type RunTrackingOptions,
  type RunTrackingResult,
} from "@/lib/platform/run-tracking";

const BASELINE_SAMPLE_TARGET = 3;
const DEFAULT_MAX_ACCURACY_METERS = 65;
const MAX_PLAUSIBLE_SPEED_MPS = 13;

const INITIAL_CALIBRATION: RunCalibration = {
  status: "idle",
  sampleCount: 0,
  progress: 0,
  accuracyMeters: null,
};

const INITIAL_METRICS: RunMetrics = {
  phase: "idle",
  gpsStatus: "idle",
  calibration: INITIAL_CALIBRATION,
  distanceMeters: 0,
  elapsedMs: 0,
  speedMps: 0,
  paceSecondsPerKm: null,
  accuracyMeters: null,
};

function geolocationMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Enable it in browser settings or use demo mode.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "A GPS position is currently unavailable. Move to an open area or use demo mode.";
  }
  if (error.code === error.TIMEOUT) {
    return "GPS acquisition timed out. FableRun will keep trying.";
  }
  return "The browser could not read your location.";
}

function geolocationStatus(error: GeolocationPositionError): GpsStatus {
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.POSITION_UNAVAILABLE) return "unavailable";
  return "error";
}

/**
 * Tracks a live or deterministic demo run through one metrics contract.
 * Exact coordinates live only in an internal ref: they are not returned,
 * persisted, logged, or sent over the network, and are cleared on teardown.
 */
export function useRunTracking(options: RunTrackingOptions): RunTrackingResult {
  const optionsRef = useRef(options);

  const [metrics, setMetrics] = useState<RunMetrics>(INITIAL_METRICS);
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<RunPhase>("idle");
  const watchIdRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rawCoordinatesRef = useRef<CoordinateSample[]>([]);
  const baselineSamplesRef = useRef<CoordinateSample[]>([]);
  const lastAcceptedRef = useRef<CoordinateSample | null>(null);
  const noisyReadingsRef = useRef(0);
  const distanceRef = useRef(0);
  const elapsedBeforeSegmentRef = useRef(0);
  const segmentStartedAtRef = useRef<number | null>(null);
  const demoLastTickRef = useRef<number | null>(null);

  const setPhase = useCallback((phase: RunPhase) => {
    phaseRef.current = phase;
    setMetrics((previous) => ({ ...previous, phase }));
  }, []);

  const currentElapsed = useCallback((): number => {
    if (segmentStartedAtRef.current === null) return elapsedBeforeSegmentRef.current;
    return (
      elapsedBeforeSegmentRef.current +
      (performance.now() - segmentStartedAtRef.current)
    );
  }, []);

  const displayedElapsed = useCallback((): number => {
    const scale =
      optionsRef.current.mode === "demo"
        ? clamp(optionsRef.current.demoTimeScale ?? 1, 1, 20)
        : 1;
    return currentElapsed() * scale;
  }, [currentElapsed]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation?.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const stopTicker = useCallback(() => {
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = null;
    demoLastTickRef.current = null;
  }, []);

  const handleLivePosition = useCallback((position: GeolocationPosition) => {
    if (phaseRef.current !== "calibrating" && phaseRef.current !== "running") {
      return;
    }

    const sample: CoordinateSample = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Math.max(0, position.coords.accuracy),
      timestamp: position.timestamp,
    };

    // Coordinates deliberately remain in volatile memory and are bounded.
    rawCoordinatesRef.current.push(sample);
    if (rawCoordinatesRef.current.length > 16) rawCoordinatesRef.current.shift();

    const accuracyLimit =
      clamp(
        optionsRef.current.maxAccuracyMeters ?? DEFAULT_MAX_ACCURACY_METERS,
        5,
        250,
      );

    if (sample.accuracy > accuracyLimit) {
      noisyReadingsRef.current += 1;
      const hasRepeatedNoise = noisyReadingsRef.current >= BASELINE_SAMPLE_TARGET;
      setMetrics((previous) => ({
        ...previous,
        phase: hasRepeatedNoise ? "running" : previous.phase,
        gpsStatus: "noisy",
        accuracyMeters: sample.accuracy,
        speedMps: 0,
        paceSecondsPerKm: null,
        calibration: {
          ...previous.calibration,
          status: hasRepeatedNoise ? "degraded" : "collecting",
        },
      }));
      if (hasRepeatedNoise) phaseRef.current = "running";
      setError("GPS accuracy is too low; noisy readings are being ignored.");
      return;
    }

    noisyReadingsRef.current = 0;
    setError(null);

    if (baselineSamplesRef.current.length < BASELINE_SAMPLE_TARGET) {
      baselineSamplesRef.current.push(sample);
      const sampleCount = baselineSamplesRef.current.length;
      const ready = sampleCount >= BASELINE_SAMPLE_TARGET;
      const bestAccuracy = Math.min(
        ...baselineSamplesRef.current.map((item) => item.accuracy),
      );
      lastAcceptedRef.current = sample;
      if (ready) phaseRef.current = "running";

      setMetrics((previous) => ({
        ...previous,
        phase: ready ? "running" : "calibrating",
        gpsStatus: ready ? "ready" : "calibrating",
        accuracyMeters: sample.accuracy,
        calibration: {
          status: ready ? "ready" : "collecting",
          sampleCount,
          progress: Math.min(1, sampleCount / BASELINE_SAMPLE_TARGET),
          accuracyMeters: bestAccuracy,
        },
      }));
      return;
    }

    const previousSample = lastAcceptedRef.current;
    lastAcceptedRef.current = sample;
    let speedMps = 0;

    if (previousSample) {
      const segmentMeters = distanceBetween(previousSample, sample);
      const seconds = Math.max(0.1, (sample.timestamp - previousSample.timestamp) / 1_000);
      const measuredSpeed = segmentMeters / seconds;
      const jitterFloor = Math.max(2.5, (sample.accuracy + previousSample.accuracy) * 0.18);

      if (segmentMeters >= jitterFloor && measuredSpeed <= MAX_PLAUSIBLE_SPEED_MPS) {
        distanceRef.current += segmentMeters;
        const deviceSpeed = position.coords.speed;
        speedMps =
          deviceSpeed !== null &&
          deviceSpeed >= 0 &&
          deviceSpeed <= MAX_PLAUSIBLE_SPEED_MPS
            ? deviceSpeed
            : measuredSpeed;
      }
    }

    setMetrics((previous) => {
      const smoothedSpeed = previous.speedMps * 0.45 + speedMps * 0.55;
      return {
        ...previous,
        phase: "running",
        gpsStatus: "ready",
        distanceMeters: distanceRef.current,
        speedMps: smoothedSpeed,
        paceSecondsPerKm: paceFromSpeed(smoothedSpeed),
        accuracyMeters: sample.accuracy,
        calibration: {
          ...previous.calibration,
          status: "ready",
        },
      };
    });
  }, []);

  const handleLiveError = useCallback((positionError: GeolocationPositionError) => {
    const gpsStatus = geolocationStatus(positionError);
    const terminal =
      gpsStatus === "denied" || gpsStatus === "unavailable";
    if (terminal && phaseRef.current === "calibrating") phaseRef.current = "running";
    setError(geolocationMessage(positionError));
    setMetrics((previous) => ({
      ...previous,
      phase:
        terminal && previous.phase === "calibrating" ? "running" : previous.phase,
      gpsStatus,
      speedMps: 0,
      paceSecondsPerKm: null,
      calibration: {
        ...previous.calibration,
        status: terminal ? "unavailable" : previous.calibration.status,
      },
    }));
    if (gpsStatus === "denied") stopWatch();
  }, [stopWatch]);

  const startLiveWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      phaseRef.current = "running";
      setError("This browser does not provide geolocation. Use demo mode instead.");
      setMetrics((previous) => ({
        ...previous,
        phase: "running",
        gpsStatus: "unavailable",
        calibration: { ...previous.calibration, status: "unavailable" },
      }));
      return;
    }

    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleLivePosition,
      handleLiveError,
      {
        enableHighAccuracy: true,
        maximumAge: 1_000,
        timeout: 12_000,
      },
    );
  }, [handleLiveError, handleLivePosition, stopWatch]);

  const startElapsedTicker = useCallback(() => {
    stopTicker();
    tickerRef.current = setInterval(() => {
      if (phaseRef.current !== "calibrating" && phaseRef.current !== "running") {
        return;
      }
      setMetrics((previous) => ({ ...previous, elapsedMs: currentElapsed() }));
    }, 250);
  }, [currentElapsed, stopTicker]);

  const startDemoTicker = useCallback(() => {
    stopTicker();
    demoLastTickRef.current = performance.now();
    tickerRef.current = setInterval(() => {
      if (phaseRef.current !== "running") return;

      const now = performance.now();
      const previousTick = demoLastTickRef.current ?? now;
      demoLastTickRef.current = now;
      const demoPace = optionsRef.current.demoPace ?? "easy";
      const gps = optionsRef.current.demoGps ?? "available";
      const scale = clamp(optionsRef.current.demoTimeScale ?? 1, 1, 20);
      const speedMps =
        gps === "available" ? DEMO_SPEED_METERS_PER_SECOND[demoPace] : 0;
      distanceRef.current += speedMps * ((now - previousTick) / 1_000) * scale;

      setMetrics((previous) => ({
        ...previous,
        elapsedMs: currentElapsed() * scale,
        distanceMeters: distanceRef.current,
        speedMps,
        paceSecondsPerKm: paceFromSpeed(speedMps),
      }));
    }, 200);
  }, [currentElapsed, stopTicker]);

  const clearVolatileRun = useCallback(() => {
    rawCoordinatesRef.current = [];
    baselineSamplesRef.current = [];
    lastAcceptedRef.current = null;
    noisyReadingsRef.current = 0;
    distanceRef.current = 0;
    elapsedBeforeSegmentRef.current = 0;
    segmentStartedAtRef.current = null;
  }, []);

  const start = useCallback(() => {
    stopWatch();
    stopTicker();
    clearVolatileRun();
    setError(null);
    segmentStartedAtRef.current = performance.now();

    if (optionsRef.current.mode === "demo") {
      const gps = optionsRef.current.demoGps ?? "available";
      phaseRef.current = "running";
      setMetrics({
        ...INITIAL_METRICS,
        phase: "running",
        gpsStatus: gps === "available" ? "ready" : gps,
        accuracyMeters: gps === "available" ? 5 : gps === "noisy" ? 95 : null,
        calibration: {
          status: gps === "available" ? "ready" : gps === "noisy" ? "degraded" : "unavailable",
          sampleCount: gps === "available" ? BASELINE_SAMPLE_TARGET : 0,
          progress: gps === "available" ? 1 : 0,
          accuracyMeters: gps === "available" ? 5 : gps === "noisy" ? 95 : null,
        },
      });
      startDemoTicker();
      return;
    }

    phaseRef.current = "calibrating";
    setMetrics({
      ...INITIAL_METRICS,
      phase: "calibrating",
      gpsStatus: "requesting",
      calibration: { ...INITIAL_CALIBRATION, status: "collecting" },
    });
    startElapsedTicker();
    startLiveWatch();
  }, [clearVolatileRun, startDemoTicker, startElapsedTicker, startLiveWatch, stopTicker, stopWatch]);

  const pause = useCallback(() => {
    if (phaseRef.current !== "running" && phaseRef.current !== "calibrating") return;
    elapsedBeforeSegmentRef.current = currentElapsed();
    segmentStartedAtRef.current = null;
    lastAcceptedRef.current = null;
    stopWatch();
    stopTicker();
    setPhase("paused");
    setMetrics((previous) => ({
      ...previous,
      speedMps: 0,
      paceSecondsPerKm: null,
      elapsedMs: displayedElapsed(),
    }));
  }, [currentElapsed, displayedElapsed, setPhase, stopTicker, stopWatch]);

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused") return;
    segmentStartedAtRef.current = performance.now();
    phaseRef.current = "running";
    setMetrics((previous) => ({ ...previous, phase: "running" }));
    if (optionsRef.current.mode === "demo") startDemoTicker();
    else {
      startElapsedTicker();
      startLiveWatch();
    }
  }, [startDemoTicker, startElapsedTicker, startLiveWatch]);

  const stop = useCallback(() => {
    if (phaseRef.current === "idle" || phaseRef.current === "stopped") return;
    elapsedBeforeSegmentRef.current = currentElapsed();
    segmentStartedAtRef.current = null;
    stopWatch();
    stopTicker();
    setPhase("stopped");
    setMetrics((previous) => ({
      ...previous,
      elapsedMs: displayedElapsed(),
      speedMps: 0,
      paceSecondsPerKm: null,
    }));
  }, [currentElapsed, displayedElapsed, setPhase, stopTicker, stopWatch]);

  const reset = useCallback(() => {
    stopWatch();
    stopTicker();
    clearVolatileRun();
    phaseRef.current = "idle";
    setError(null);
    setMetrics(INITIAL_METRICS);
  }, [clearVolatileRun, stopTicker, stopWatch]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    return () => {
      stopWatch();
      stopTicker();
      rawCoordinatesRef.current = [];
      baselineSamplesRef.current = [];
      lastAcceptedRef.current = null;
    };
  }, [stopTicker, stopWatch]);

  const demo: DemoDescriptor | null =
    options.mode === "demo"
      ? {
          label: `DEMO · ${(options.demoPace ?? "easy").toUpperCase()} · ${(options.demoOutcome ?? "success").toUpperCase()} · GPS ${(options.demoGps ?? "available").toUpperCase()} · ${clamp(options.demoTimeScale ?? 1, 1, 20)}×`,
          pace: options.demoPace ?? "easy",
          outcome: options.demoOutcome ?? "success",
          gps: options.demoGps ?? "available",
          timeScale: clamp(options.demoTimeScale ?? 1, 1, 20),
        }
      : null;

  return {
    ...metrics,
    source: options.mode === "demo" ? "demo" : "gps",
    demo,
    error,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
