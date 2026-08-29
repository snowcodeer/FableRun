"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ScrollLockedVideoHero from "@/components/ui/scroll-locked-video-hero";
import { useAdaptiveAudio } from "@/hooks/use-adaptive-audio";
import { useNarration } from "@/hooks/use-narration";
import { useRunTracking } from "@/hooks/use-run-tracking";
import { useWakeLock } from "@/hooks/use-wake-lock";
import {
  advanceRun,
  chooseRoute,
  createReadyRunState,
  getCurrentScene,
  getDecisionModel,
  getEndingModel,
  getSummaryModel,
  latestPerformanceResponse,
  livePerformance,
  narrationPrefetchLines,
  paceLabel,
  runnerProfileFromForm,
  threatDistanceFor,
  type DemoIntervalResult,
  type StorySceneModel,
} from "@/lib/cliffhanger-controller";
import type { CharacterGender, RunState } from "@/lib/story";
import {
  fallbackStoryContinuation,
  type CanonicalStoryChoice,
  type StoryContinuation,
} from "@/lib/story/freeform-choice";
import type { DemoGpsCondition, DemoPace } from "@/lib/platform/run-tracking";

type Stage =
  | "landing"
  | "profile"
  | "permissions"
  | "calibration"
  | "briefing"
  | "run"
  | "choice"
  | "ending"
  | "summary";
type Difficulty = "beginner" | "regular" | "intense";
type Relationship = "Partner" | "Friend" | "Sibling" | "Parent";
type PermissionState = "idle" | "ready" | "fallback";
type VoiceChoiceStatus = "idle" | "listening" | "thinking" | "ready" | "error";
type RunResult = DemoIntervalResult;

const AUDIO_TEST_LINE = "Control here. Comms are online. Keep moving.";

interface Profile {
  savee: string;
  saveeGender: CharacterGender;
  relationship: Relationship;
  difficulty: Difficulty;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export interface FableRunAppProps {
  episodeTitle?: string;
  initialDemoMode?: boolean;
}

const difficultyCopy: Record<Difficulty, { label: string; detail: string; time: string }> = {
  beginner: { label: "Beginner", detail: "Shorter pushes, longer cover", time: "8 min" },
  regular: { label: "Regular", detail: "Balanced cinematic intervals", time: "10 min" },
  intense: { label: "Intense", detail: "Fast cuts, tighter recoveries", time: "12 min" },
};

export default function FableRunApp({
  episodeTitle = "Last Light",
  initialDemoMode = true,
}: FableRunAppProps) {
  const [stage, setStage] = useState<Stage>("landing");
  const [profile, setProfile] = useState<Profile>({
    savee: "Natalie",
    saveeGender: "female",
    relationship: "Partner",
    difficulty: "regular",
  });
  const [demoMode, setDemoMode] = useState(initialDemoMode);
  const [locationState, setLocationState] = useState<PermissionState>("idle");
  const [audioState, setAudioState] = useState<PermissionState>("idle");
  const [microphoneState, setMicrophoneState] = useState<PermissionState>("idle");
  const [motionState, setMotionState] = useState<PermissionState>("idle");
  const [calibrationTime, setCalibrationTime] = useState(12);
  const [storyState, setStoryState] = useState<RunState | null>(null);
  const [sceneTime, setSceneTime] = useState(10);
  const [paused, setPaused] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [result, setResult] = useState<RunResult>("success");
  const [choice, setChoice] = useState<CanonicalStoryChoice | null>(null);
  const [voiceChoiceStatus, setVoiceChoiceStatus] = useState<VoiceChoiceStatus>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceChoiceError, setVoiceChoiceError] = useState<string | null>(null);
  const [storyContinuation, setStoryContinuation] = useState<StoryContinuation | null>(null);
  const [demoPace, setDemoPace] = useState<DemoPace>("easy");
  const [demoGps, setDemoGps] = useState<DemoGpsCondition>("available");
  const [demoTimeScale, setDemoTimeScale] = useState(4);
  const [forceBrowserVoice, setForceBrowserVoice] = useState(false);
  const stageTitleRef = useRef<HTMLHeadingElement>(null);
  const sceneStartRef = useRef({ distanceMeters: 0, elapsedMs: 0 });
  const baselineSpeedRef = useRef(2.55);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const storyChoiceRequestRef = useRef<AbortController | null>(null);

  const tracking = useRunTracking({
    mode: demoMode ? "demo" : "live",
    demoPace,
    demoOutcome: result === "miss" ? "miss" : "success",
    demoGps,
    demoTimeScale,
  });
  const audioMix = useAdaptiveAudio();
  const narration = useNarration();
  const wakeLock = useWakeLock(false);
  const prefetchNarration = narration.prefetch;
  const setAudioMix = audioMix.setMix;
  const setAudioDucked = audioMix.setDucked;

  const previewState = useMemo(
    () => createReadyRunState({
      profile: runnerProfileFromForm(profile),
      difficulty: profile.difficulty,
      demoMode,
    }),
    [demoMode, profile],
  );
  const activeStoryState = storyState ?? previewState;
  const scene = getCurrentScene(activeStoryState);
  const sceneIndex = Math.max(0, scene.intervalNumber - 1);
  const distance = tracking.distanceMeters / 1_000;
  const elapsed = Math.round(tracking.elapsedMs / 1_000);
  const threatDistance = threatDistanceFor(activeStoryState);
  const completedMovement = Math.max(0, scene.intervalNumber - 1);
  const decisionModel = getDecisionModel(activeStoryState);
  const endingModel = getEndingModel(activeStoryState);
  const summaryModel = getSummaryModel(activeStoryState);
  const averagePace = distance > 0.01 && elapsed > 0 ? elapsed / distance : null;
  const runProgress = Math.min(
    100,
    ((completedMovement + (1 - sceneTime / Math.max(1, scene.durationSeconds))) /
      scene.totalMovementScenes) * 100,
  );
  const activeVoiceLabel = scene.speaker === "relationship"
    ? `${profile.savee.toUpperCase()} · ${profile.saveeGender === "female" ? "EMILIA" : "ARCHER"}`
    : "GEORGE · CONTROL";

  useEffect(() => {
    if (stage === "landing") return;
    const timeout = window.setTimeout(() => stageTitleRef.current?.focus(), 120);
    return () => window.clearTimeout(timeout);
  }, [stage, spectator]);

  useEffect(() => () => {
    speechRecognitionRef.current?.abort();
    storyChoiceRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (stage !== "calibration" || paused) return;
    const timer = window.setInterval(() => {
      setCalibrationTime((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => setStage("briefing"), 250);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, paused]);

  useEffect(() => {
    if (stage !== "run" || paused || spectator) return;
    const timer = window.setInterval(() => {
      const decrement = demoMode ? Math.max(1, Math.round(demoTimeScale / 2)) : 1;
      setSceneTime((current) => Math.max(0, current - decrement));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [demoMode, demoTimeScale, paused, spectator, stage]);

  useEffect(() => {
    if (stage === "permissions") {
      void prefetchNarration([AUDIO_TEST_LINE]);
    }
  }, [prefetchNarration, stage]);

  useEffect(() => {
    if (stage === "briefing" || storyState) {
      void prefetchNarration(narrationPrefetchLines(activeStoryState));
    }
    if (!storyState) return;
    setAudioMix({
      intensity: scene.musicIntensity,
      performance: result === "strong" ? 0.8 : result === "miss" ? -0.7 : result === "near" ? -0.25 : 0.25,
      pace: Math.min(1, Math.max(0, (tracking.speedMps - 0.6) / 3.4)),
    });
  }, [activeStoryState, prefetchNarration, result, scene.musicIntensity, setAudioMix, stage, storyState, tracking.speedMps]);

  useEffect(() => {
    setAudioDucked(narration.status === "loading" || narration.status === "speaking");
  }, [narration.status, setAudioDucked]);

  const recentEvent = useMemo(
    () => latestPerformanceResponse(activeStoryState),
    [activeStoryState],
  );

  const goTo = (next: Stage) => {
    setStage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = profile.savee.trim() || "Alex";
    const next = { ...profile, savee: trimmed };
    setProfile(next);
    try {
      window.localStorage.setItem("fablerun-profile", JSON.stringify(next));
    } catch {
      // Continue without persistence.
    }
    goTo("permissions");
  };

  const requestLocation = () => {
    if (demoMode || !navigator.geolocation) {
      setLocationState("fallback");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setLocationState("ready"),
      () => setLocationState("fallback"),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 3000 },
    );
  };

  const enableAudio = async () => {
    try {
      await audioMix.start();
      const test = await narration.speak(AUDIO_TEST_LINE, { preferRemote: true });
      setAudioState(test.source === "elevenlabs" ? "ready" : "fallback");
    } catch {
      setAudioState("fallback");
    }
  };

  const requestMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneState("fallback");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneState("ready");
    } catch {
      setMicrophoneState("fallback");
    }
  };

  const beginCalibration = () => {
    if (locationState === "idle") setLocationState("fallback");
    if (audioState === "idle") setAudioState("fallback");
    if (microphoneState === "idle") setMicrophoneState("fallback");
    if (motionState === "idle") setMotionState("fallback");
    setCalibrationTime(12);
    tracking.start();
    goTo("calibration");
  };

  const startRun = () => {
    const nextState = createReadyRunState({
      profile: runnerProfileFromForm(profile),
      difficulty: profile.difficulty,
      demoMode,
    });
    const nextScene = getCurrentScene(nextState);
    setStoryState(nextState);
    setSceneTime(nextScene.durationSeconds);
    setChoice(null);
    setVoiceTranscript("");
    setVoiceChoiceStatus("idle");
    setVoiceChoiceError(null);
    setStoryContinuation(null);
    setPaused(false);
    tracking.reset();
    tracking.start();
    sceneStartRef.current = { distanceMeters: 0, elapsedMs: 0 };
    void audioMix.start();
    void wakeLock.request();
    void narration.speak(nextScene.story, {
      preferRemote: !forceBrowserVoice,
      voice: nextScene.voice,
    });
    goTo("run");
  };

  const advanceScene = () => {
    if (!storyState) return;
    if (storyState.currentNodeId === "final_choice") {
      goTo("choice");
      return;
    }
    const segmentDistance = Math.max(
      0,
      tracking.distanceMeters - sceneStartRef.current.distanceMeters,
    );
    const segmentElapsed = Math.max(
      1,
      (tracking.elapsedMs - sceneStartRef.current.elapsedMs) / 1_000,
    );
    if (!scene.isHighIntensity && tracking.speedMps > 0.6) {
      baselineSpeedRef.current = tracking.speedMps;
    }
    const performance = !demoMode && scene.isHighIntensity
      ? livePerformance(storyState, {
          baselineSpeedMps: baselineSpeedRef.current,
          distanceMeters: segmentDistance,
          durationSeconds: segmentElapsed,
          speedMps: tracking.speedMps,
        })
      : undefined;
    const nextState = advanceRun({
      state: storyState,
      result,
      performance,
      elapsedSeconds: Math.min(scene.durationSeconds, Math.round(segmentElapsed)),
    });
    const nextScene = getCurrentScene(nextState);
    setStoryState(nextState);
    setSceneTime(nextScene.durationSeconds);
    sceneStartRef.current = {
      distanceMeters: tracking.distanceMeters,
      elapsedMs: tracking.elapsedMs,
    };
    void narration.speak(nextScene.story, {
      preferRemote: !forceBrowserVoice,
      voice: nextScene.voice,
    });
    if (nextState.currentNodeId === "final_choice") goTo("choice");
    else if (nextState.currentNodeId.startsWith("ending_")) {
      tracking.stop();
      void audioMix.pause();
      void wakeLock.release();
      goTo("ending");
    } else if (nextState.currentNodeId === "summary") {
      tracking.stop();
      void audioMix.stop();
      narration.cancel();
      void wakeLock.release();
      goTo("summary");
    } else goTo("run");
  };

  const selectChoice = (nextChoice: CanonicalStoryChoice) => {
    if (!storyState) return;
    speechRecognitionRef.current?.abort();
    storyChoiceRequestRef.current?.abort();
    const nextState = chooseRoute(storyState, nextChoice);
    const nextScene = getCurrentScene(nextState);
    setChoice(nextChoice);
    setStoryState(nextState);
    setSceneTime(nextScene.durationSeconds);
    sceneStartRef.current = {
      distanceMeters: tracking.distanceMeters,
      elapsedMs: tracking.elapsedMs,
    };
    void narration.speak(nextScene.story, {
      preferRemote: !forceBrowserVoice,
      voice: nextScene.voice,
    });
    goTo("run");
  };

  const startListeningForChoice = () => {
    if (voiceChoiceStatus === "thinking") return;
    if (voiceChoiceStatus === "listening") {
      speechRecognitionRef.current?.stop();
      return;
    }

    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setMicrophoneState("fallback");
      setVoiceChoiceStatus("error");
      setVoiceChoiceError("Voice input is not available in this browser. Type your move or use either route button.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      let hasFinalResult = false;
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
        hasFinalResult ||= event.results[index]?.isFinal === true;
      }
      if (transcript.trim()) setVoiceTranscript(transcript.trim().slice(0, 280));
      if (hasFinalResult) recognition.stop();
    };
    recognition.onerror = (event) => {
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      if (denied) setMicrophoneState("fallback");
      setVoiceChoiceStatus("error");
      setVoiceChoiceError(
        denied
          ? "Microphone access is off. Type your move or use either route button."
          : "I couldn’t hear that clearly. Try again or type your move.",
      );
    };
    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setVoiceChoiceStatus((current) => current === "listening" ? "idle" : current);
    };
    speechRecognitionRef.current = recognition;
    setStoryContinuation(null);
    setVoiceChoiceError(null);
    setVoiceChoiceStatus("listening");
    try {
      recognition.start();
      setMicrophoneState("ready");
    } catch {
      speechRecognitionRef.current = null;
      setVoiceChoiceStatus("error");
      setVoiceChoiceError("The microphone is busy. Try again or type your move.");
    }
  };

  const submitFreeformChoice = async (event: FormEvent) => {
    event.preventDefault();
    const choiceText = voiceTranscript.trim();
    if (choiceText.length < 2) {
      setVoiceChoiceStatus("error");
      setVoiceChoiceError("Say or type what you want to do next.");
      return;
    }

    speechRecognitionRef.current?.stop();
    storyChoiceRequestRef.current?.abort();
    const controller = new AbortController();
    storyChoiceRequestRef.current = controller;
    setStoryContinuation(null);
    setVoiceChoiceError(null);
    setVoiceChoiceStatus("thinking");

    let continuation = fallbackStoryContinuation(choiceText, profile.savee);
    try {
      const response = await fetch("/api/story/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          choiceText,
          relationshipName: profile.savee,
          relationshipLabel: profile.relationship.toLowerCase(),
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          continuation?: StoryContinuation;
        };
        if (payload.continuation) continuation = payload.continuation;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("FableRun used the local story bridge.", error);
    } finally {
      if (storyChoiceRequestRef.current === controller) {
        storyChoiceRequestRef.current = null;
      }
    }

    setStoryContinuation(continuation);
    setVoiceChoiceStatus("ready");
    void narration.speak(continuation.reply.replaceAll("“", "").replaceAll("”", ""), {
      preferRemote: !forceBrowserVoice,
      voice: profile.saveeGender === "female" ? "character_female" : "character_male",
    });
  };

  const pauseRun = () => {
    setPaused(true);
    tracking.pause();
    void audioMix.pause();
    narration.cancel();
    void wakeLock.release();
  };

  const resumeRun = () => {
    setPaused(false);
    tracking.resume();
    void audioMix.resume();
    void wakeLock.request();
  };

  const endSafely = () => {
    if (!storyState) return;
    let safeState = storyState;
    for (let guard = 0; guard < 14 && !safeState.currentNodeId.startsWith("ending_"); guard += 1) {
      safeState = safeState.currentNodeId === "final_choice"
        ? chooseRoute(safeState, choice ?? "rescue_together")
        : advanceRun({ state: safeState, result: "miss" });
    }
    setResult("miss");
    setStoryState(safeState);
    setPaused(false);
    tracking.stop();
    void audioMix.pause();
    narration.cancel();
    void wakeLock.release();
    goTo("ending");
  };

  useEffect(() => {
    if (stage !== "run" || sceneTime > 0 || paused || spectator) return;
    const timer = window.setTimeout(advanceScene, 0);
    return () => window.clearTimeout(timer);
  });

  if (stage === "landing") {
    return <ScrollLockedVideoHero onContinue={() => goTo("profile")} />;
  }

  if (spectator) {
    return (
      <SpectatorView
        scene={scene}
        sceneIndex={sceneIndex}
        sceneTime={sceneTime}
        profile={profile}
        distance={distance}
        threatDistance={threatDistance}
        recentEvent={recentEvent}
        onExit={() => setSpectator(false)}
        headingRef={stageTitleRef}
      />
    );
  }

  return (
    <main className={`app-shell stage-${stage}`}>
      <AmbientChrome />
      {stage !== "run" && <AppHeader onHome={() => goTo("landing")} demoMode={demoMode} />}

      {stage === "profile" && (
        <section className="screen screen--form">
          <ProgressHeader current={1} total={3} label="Create your stakes" />
          <div className="screen__copy">
            <p className="eyebrow danger">Your story</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>Who gets you to the finish line?</h1>
            <p>We’ll thread them into the story. Nothing leaves this device.</p>
          </div>
          <form className="profile-form" onSubmit={saveProfile}>
            <label className="field-label" htmlFor="savee">Who are you trying to save?</label>
            <div className="name-field">
              <span aria-hidden="true">01</span>
              <input
                id="savee"
                value={profile.savee}
                onChange={(event) => setProfile({ ...profile, savee: event.target.value })}
                placeholder="Their first name"
                autoComplete="off"
                maxLength={24}
                required
              />
            </div>

            <fieldset>
              <legend className="field-label">They’re your…</legend>
              <div className="choice-grid choice-grid--relationship">
                {(["Partner", "Friend", "Sibling", "Parent"] as Relationship[]).map((relationship) => (
                  <ChoiceButton
                    key={relationship}
                    selected={profile.relationship === relationship}
                    onClick={() => setProfile({ ...profile, relationship })}
                  >
                    {relationship}
                  </ChoiceButton>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="field-label">Choose their voice</legend>
              <div className="choice-grid choice-grid--gender">
                <ChoiceButton
                  selected={profile.saveeGender === "female"}
                  onClick={() => setProfile({ ...profile, saveeGender: "female" })}
                >
                  Female voice
                </ChoiceButton>
                <ChoiceButton
                  selected={profile.saveeGender === "male"}
                  onClick={() => setProfile({ ...profile, saveeGender: "male" })}
                >
                  Male voice
                </ChoiceButton>
              </div>
              <p className="cast-note">
                {profile.savee || "Your character"} speaks in their own scenes; Control narrates the rest.
              </p>
            </fieldset>

            <fieldset>
              <legend className="field-label">Choose the pressure</legend>
              <div className="difficulty-stack">
                {(Object.keys(difficultyCopy) as Difficulty[]).map((difficulty) => {
                  const item = difficultyCopy[difficulty];
                  return (
                    <button
                      type="button"
                      className={`difficulty-card ${profile.difficulty === difficulty ? "is-selected" : ""}`}
                      key={difficulty}
                      onClick={() => setProfile({ ...profile, difficulty })}
                      aria-pressed={profile.difficulty === difficulty}
                    >
                      <i aria-hidden="true"><b /><b /><b /></i>
                      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                      <em>{item.time}</em>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <button className="primary-action" type="submit">
              <span>Build my episode</span><ArrowIcon />
            </button>
          </form>
        </section>
      )}

      {stage === "permissions" && (
        <section className="screen screen--permissions">
          <ProgressHeader current={2} total={3} label="Systems check" />
          <div className="screen__copy">
            <p className="eyebrow safe">Private by design</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>Ready your field kit.</h1>
            <p>FableRun uses live signals only to pace this episode. Precise location stays on your phone.</p>
          </div>

          <div className="permission-list">
            <PermissionCard
              icon="⌖"
              title="Location"
              detail="Distance and relative pace"
              state={locationState}
              onClick={requestLocation}
              action="Enable GPS"
            />
            <PermissionCard
              icon="◖))"
              title="Audio"
              detail="Narration, signals and adaptive mix"
              state={audioState}
              onClick={enableAudio}
              action="Test audio"
            />
            <PermissionCard
              icon="●"
              title="Microphone"
              detail="Speak any move at story choices"
              state={microphoneState}
              onClick={requestMicrophone}
              action="Enable voice choices"
            />
            <PermissionCard
              icon="≈"
              title="Motion"
              detail="Optional cadence enhancement"
              state={motionState}
              onClick={() => setMotionState("fallback")}
              action="Use timed fallback"
            />
          </div>

          <div className="demo-switch-card">
            <div><span className="demo-pill">Demo mode</span><strong>Reliable simulation</strong><small>Runs without GPS or external voice services.</small></div>
            <button
              type="button"
              className={`toggle ${demoMode ? "is-on" : ""}`}
              role="switch"
              aria-checked={demoMode}
              aria-label="Enable judging simulation"
              onClick={() => setDemoMode(!demoMode)}
            ><i /></button>
          </div>

          <button className="primary-action" onClick={beginCalibration}>
            <span>Calibrate my pace</span><ArrowIcon />
          </button>
          <button className="text-action" onClick={beginCalibration}>Continue with safe fallbacks</button>
        </section>
      )}

      {stage === "calibration" && (
        <section className="screen screen--calibration">
          <ProgressHeader current={3} total={3} label="Pace calibration" />
          <div className="calibration-orbit" aria-hidden="true">
            <div className="radar-sweep" />
            <i className="runner-dot" />
            <span className="threat-dot threat-dot--a" />
            <span className="threat-dot threat-dot--b" />
          </div>
          <div className="calibration-copy">
            <p className="eyebrow safe">Finding your pace</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>Walk, then find your easy run.</h1>
            <p>No heroics yet. We’re learning what “fast” means for you.</p>
          </div>
          <div className="calibration-metric">
            <strong>{`00:${String(calibrationTime).padStart(2, "0")}`}</strong>
            <span>Calibration remaining</span>
          </div>
          <div className="waveform waveform--wide" aria-label="Audio signal active">
            {Array.from({ length: 28 }, (_, index) => <i key={index} style={{ "--wave": `${24 + ((index * 17) % 62)}%` } as React.CSSProperties} />)}
          </div>
          <button className="secondary-action" onClick={() => goTo("briefing")}>Use demo baseline · 6:12 /km</button>
        </section>
      )}

      {stage === "briefing" && (
        <section className="screen screen--briefing">
          <div className="episode-art" aria-hidden="true">
            <div className="moon" /><div className="skyline" /><div className="episode-art__figure" />
            <span>EP. 01</span>
          </div>
          <div className="briefing-copy">
            <p className="eyebrow danger">Episode 01</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>{episodeTitle}</h1>
            <p>“{profile.savee} is trapped beyond the bridge. The shelter doors close in ten minutes.”</p>
          </div>
          <div className="briefing-stats">
            <span><b>{difficultyCopy[profile.difficulty].time}</b> episode</span><span><b>3</b> pushes</span><span><b>3</b> endings</span>
          </div>
          <div className="safety-note"><ShieldIcon /><span><strong>Your body, your call.</strong> Slow down or end safely at any time. The story always continues.</span></div>
          <button className="primary-action primary-action--danger" onClick={startRun}>
            <span>Start episode</span><PlayIcon />
          </button>
        </section>
      )}

      {stage === "run" && (
        <section className={`run-screen intensity-${scene.instruction.toLowerCase()}`}>
          <div className="run-screen__fog" aria-hidden="true" />
          <header className="run-header">
            <div className="live-mark"><i /> Live run</div>
            <button className="demo-label-button" onClick={() => setDemoOpen(!demoOpen)} aria-expanded={demoOpen}>
              Demo <ChevronIcon />
            </button>
          </header>

          <div className="run-progress" aria-label={`${Math.round(runProgress)} percent through episode`}><i style={{ width: `${runProgress}%` }} /></div>

          <div className="run-primary">
            <p className="eyebrow">Interval {scene.intervalNumber} · {scene.label}</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>{scene.instruction}</h1>
            <div className="run-countdown" aria-live="polite">{formatTime(sceneTime)}</div>
            <div className="target-line"><i /> {scene.cue}</div>
          </div>

          <div className="story-transmission">
            <div className="waveform" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--wave": `${18 + ((index * 23) % 70)}%` } as React.CSSProperties} />)}
            </div>
            <blockquote>“{scene.story}”</blockquote>
            <span>
              {narration.source === "elevenlabs"
                ? activeVoiceLabel
                : narration.source === "browser"
                  ? `${scene.speaker === "relationship" ? profile.savee.toUpperCase() : "CONTROL"} · DEVICE FALLBACK`
                  : activeVoiceLabel}
              {` · SCORE ${audioMix.mood.toUpperCase()}`}
            </span>
          </div>

          <div className="run-metrics">
            <Metric label="Pace" value={paceLabel(tracking.paceSecondsPerKm)} unit="/km" />
            <Metric label="Distance" value={distance.toFixed(2)} unit="km" />
            <div className="threat-metric">
              <div><span>Threat distance</span><strong>{threatDistance}<small>m</small></strong></div>
              <div className="threat-track"><i style={{ width: `${Math.max(12, Math.min(90, threatDistance / 1.7))}%` }} /><b /></div>
              <em>{threatDistance < 60 ? "Closing" : "Held"}</em>
            </div>
          </div>

          <div className="run-actions">
            <button className="pause-button" onClick={pauseRun}><PauseIcon /> Pause</button>
            <button className="spectator-button" onClick={() => setSpectator(true)}><ScreenIcon /> Spectator</button>
          </div>

          {demoOpen && (
            <aside className="demo-console" aria-label="Demo simulation controls">
              <div><span className="demo-pill">Simulation</span><strong>Choose interval result</strong><button onClick={() => setDemoOpen(false)} aria-label="Close demo controls">×</button></div>
              <div className="demo-results">
                {(["strong", "success", "near", "miss"] as RunResult[]).map((item) => (
                  <button key={item} className={result === item ? "is-active" : ""} onClick={() => setResult(item)}>{item === "near" ? "Near miss" : item}</button>
                ))}
              </div>
              <div className="demo-results" aria-label="Simulated pace">
                {(["still", "easy", "sprint"] as DemoPace[]).map((item) => (
                  <button key={item} className={demoPace === item ? "is-active" : ""} onClick={() => setDemoPace(item)}>{item} pace</button>
                ))}
              </div>
              <div className="demo-results" aria-label="Simulated GPS condition">
                {(["available", "noisy", "unavailable"] as DemoGpsCondition[]).map((item) => (
                  <button key={item} className={demoGps === item ? "is-active" : ""} onClick={() => setDemoGps(item)}>GPS {item}</button>
                ))}
              </div>
              <div className="demo-results" aria-label="Narration source">
                <button className={!forceBrowserVoice ? "is-active" : ""} onClick={() => setForceBrowserVoice(false)}>Cast voices</button>
                <button className={forceBrowserVoice ? "is-active" : ""} onClick={() => setForceBrowserVoice(true)}>Browser fallback</button>
                <button onClick={() => setDemoTimeScale((value) => value >= 20 ? 1 : value + 4)}>{demoTimeScale}× time</button>
              </div>
              <p>{recentEvent}</p>
              <button className="secondary-action" onClick={advanceScene}>{scene.id === "cooldown" ? "Complete episode" : scene.id.startsWith("final_sprint") ? "Resolve ending" : scene.id === "final_choice" ? "Trigger decision" : "Advance story node"}</button>
            </aside>
          )}

          {paused && (
            <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
              <div className="pause-card">
                <p className="eyebrow safe">WORKOUT PAUSED</p>
                <h2 id="pause-title">Take the time you need.</h2>
                <p>The swarm can wait. Your safety can’t.</p>
                <button className="primary-action" onClick={resumeRun}><span>Resume safely</span><PlayIcon /></button>
                <button className="end-action" onClick={endSafely}>End run & hear my safe ending</button>
              </div>
            </div>
          )}
        </section>
      )}

      {stage === "choice" && (
        <section className="screen screen--choice">
          <div className="decision-timer"><span>Decision window</span><strong>OPEN</strong></div>
          <div className="choice-copy">
            <p className="eyebrow danger">Story choice</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>You choose the next move.</h1>
            <p>“{decisionModel?.prompt ?? "Choose the safest route for you."}”</p>
          </div>
          <form className={`voice-choice voice-choice--${voiceChoiceStatus}`} onSubmit={submitFreeformChoice}>
            <div className="voice-choice__header">
              <div className="voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
              <div>
                <strong>{voiceChoiceStatus === "listening" ? "Listening…" : "Choose in your own words"}</strong>
                <small>Say any move. FableRun will write it into the episode.</small>
              </div>
            </div>
            <div className="voice-choice__composer">
              <button
                type="button"
                className={`mic-button ${voiceChoiceStatus === "listening" ? "is-listening" : ""}`}
                onClick={startListeningForChoice}
                disabled={voiceChoiceStatus === "thinking"}
                aria-label={voiceChoiceStatus === "listening" ? "Stop listening" : "Speak your story choice"}
                aria-pressed={voiceChoiceStatus === "listening"}
              >
                <MicIcon />
              </button>
              <label className="voice-choice__input">
                <span className="sr-only">Your next story move</span>
                <textarea
                  value={voiceTranscript}
                  onChange={(event) => {
                    setVoiceTranscript(event.target.value.slice(0, 280));
                    setStoryContinuation(null);
                    setVoiceChoiceError(null);
                    if (voiceChoiceStatus !== "listening") setVoiceChoiceStatus("idle");
                  }}
                  placeholder="I climb the loading crane and signal from above…"
                  rows={2}
                  maxLength={280}
                  disabled={voiceChoiceStatus === "thinking"}
                />
              </label>
              <button
                type="submit"
                className="voice-choice__send"
                disabled={voiceChoiceStatus === "thinking" || voiceTranscript.trim().length < 2}
                aria-label="Continue story with this move"
              >
                {voiceChoiceStatus === "thinking" ? <i aria-hidden="true" /> : <ArrowIcon />}
              </button>
            </div>
            <p className="voice-choice__status" aria-live="polite">
              {voiceChoiceStatus === "listening" && "Speak now — tap the microphone when you’re done."}
              {voiceChoiceStatus === "thinking" && "Writing your move into the episode…"}
              {voiceChoiceStatus === "idle" && "Microphone optional · typing works too"}
              {voiceChoiceStatus === "error" && voiceChoiceError}
              {voiceChoiceStatus === "ready" && `Story route ready · ${storyContinuation?.source === "openai" ? "AI directed" : "instant safe bridge"}`}
            </p>

            {storyContinuation && (
              <div className="voice-choice__result">
                <span>{profile.savee} answers</span>
                <blockquote>{storyContinuation.reply}</blockquote>
                <button type="button" onClick={() => selectChoice(storyContinuation.routeId)}>
                  Continue · {storyContinuation.routeLabel}<ArrowIcon />
                </button>
              </div>
            )}
          </form>

          <div className="choice-divider"><span>or use a quick choice</span></div>
          <div className="route-choices">
            {(decisionModel?.options ?? []).map((option, index) => (
              <button key={option.id} onClick={() => selectChoice(option.id as CanonicalStoryChoice)}><span>{index === 0 ? "A" : "B"}</span><div><strong>{option.label}</strong><small>{option.description}</small></div><ArrowIcon /></button>
            ))}
          </div>
        </section>
      )}

      {stage === "ending" && (
        <section className={`screen screen--ending ending-${result}`}>
          <div className="ending-light" aria-hidden="true" />
          <div className="ending-copy">
            <p className="eyebrow safe">Run complete · {formatElapsed(Math.round(summaryModel.elapsedSeconds))}</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>{endingModel.title}</h1>
            <blockquote>“{endingModel.story}”</blockquote>
            <p>{summaryModel.encouragement}</p>
          </div>
          <div className="ending-badge"><i>✓</i><span><strong>{result === "strong" ? "Strong finish" : "Story complete"}</strong><small>Episode 02 unlocked</small></span></div>
          <button className="primary-action" onClick={advanceScene}><span>Begin safe cooldown</span><ArrowIcon /></button>
        </section>
      )}

      {stage === "summary" && (
        <section className="screen screen--summary">
          <div className="summary-heading">
            <p className="eyebrow safe">Episode complete</p>
            <h1 ref={stageTitleRef} tabIndex={-1}>{summaryModel.outcomeTitle}</h1>
            <p>{episodeTitle} · {summaryModel.outcomeText}</p>
          </div>
          <div className="summary-hero-stat"><strong>{formatElapsed(Math.round(summaryModel.elapsedSeconds))}</strong><span>STORY TIME</span></div>
          <div className="summary-grid">
            <Metric label="Distance" value={distance.toFixed(2)} unit="km" />
            <Metric label="Average pace" value={paceLabel(averagePace)} unit="/km" />
            <Metric label="Threat gap" value={`+${threatDistance}`} unit="m" />
            <Metric label="Story score" value={String(Math.round(summaryModel.averageScore ?? 0))} unit="%" />
          </div>
          <div className="interval-report">
            <div><span>Interval performance</span><strong>{summaryModel.completedIntervals} / 3 completed</strong></div>
            {(activeStoryState.scores.length ? activeStoryState.scores : [0, 0, 0]).map((value, index) => (
              <div className="interval-row" key={index}><span>0{index + 1}</span><i><b style={{ width: `${value}%` }} /></i><em>{value >= 85 ? "STRONG" : value >= 70 ? "HELD" : "STORY SHIFT"}</em></div>
            ))}
          </div>
          <div className="story-impact"><span>Your story impact</span><p>{summaryModel.encouragement} {profile.savee} remembers your {choice === "rescue_together" ? "decision to go back together" : "signal from the rooftop"}.</p></div>
          <button className="primary-action" onClick={() => { setChoice(null); setStoryState(null); tracking.reset(); goTo("briefing"); }}><span>Run it differently</span><RestartIcon /></button>
          <button className="text-action" onClick={() => goTo("landing")}>Return to title</button>
        </section>
      )}
    </main>
  );
}

function AmbientChrome() {
  return <><div className="noise-layer" aria-hidden="true" /><div className="global-grid" aria-hidden="true" /><div className="global-vignette" aria-hidden="true" /></>;
}

function AppHeader({ onHome, demoMode }: { onHome: () => void; demoMode: boolean }) {
  return (
    <header className="app-header">
      <button className="wordmark wordmark--button" onClick={onHome}>FABLE<span>RUN</span></button>
      {demoMode && <span className="demo-pill">Demo mode</span>}
    </header>
  );
}

function ProgressHeader({ current, total, label }: { current: number; total: number; label: string }) {
  return <div className="step-header"><span>{String(current).padStart(2, "0")} / {String(total).padStart(2, "0")}</span><i><b style={{ width: `${(current / total) * 100}%` }} /></i><em>{label}</em></div>;
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={selected ? "is-selected" : ""} onClick={onClick} aria-pressed={selected}><i>{selected ? "✓" : ""}</i>{children}</button>;
}

function PermissionCard({ icon, title, detail, state, action, onClick }: { icon: string; title: string; detail: string; state: PermissionState; action: string; onClick: () => void }) {
  return (
    <button className={`permission-card state-${state}`} onClick={onClick}>
      <i className="permission-card__icon" aria-hidden="true">{icon}</i>
      <span><strong>{title}</strong><small>{state === "ready" ? "Ready" : state === "fallback" ? "Safe fallback ready" : detail}</small></span>
      <em>{state === "idle" ? action : state === "ready" ? "✓" : "SIM"}</em>
    </button>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;
}

function SpectatorView({ scene, sceneIndex, sceneTime, profile, distance, threatDistance, recentEvent, onExit, headingRef }: { scene: StorySceneModel; sceneIndex: number; sceneTime: number; profile: Profile; distance: number; threatDistance: number; recentEvent: string; onExit: () => void; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <main className="spectator-view">
      <AmbientChrome />
      <header><div className="wordmark">FABLE<span>RUN</span></div><p>Interactive stories control the workout. The workout controls the ending.</p><div className="live-mark"><i /> Runner live</div></header>
      <section className="spectator-stage">
        <div className="spectator-scene">
          <p className="eyebrow danger">SCENE {String(sceneIndex + 1).padStart(2, "0")} · {scene.label.toUpperCase()}</p>
          <h1 ref={headingRef} tabIndex={-1}>{scene.instruction}</h1>
          <div className="spectator-time">{formatTime(sceneTime)}</div>
          <blockquote>“{scene.story}”</blockquote>
          <div className="spectator-wave" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <i key={index} style={{ height: `${14 + ((index * 31) % 72)}%` }} />)}</div>
        </div>
        <aside className="spectator-data">
          <div className="spectator-runner"><span>Runner</span><strong>Runner 01</strong><small>Running to {profile.savee}</small></div>
          <div className="spectator-metrics"><Metric label="Distance" value={distance.toFixed(2)} unit="km" /><Metric label="Interval" value={String(scene.intervalNumber).padStart(2, "0")} unit={`/ ${String(scene.totalMovementScenes).padStart(2, "0")}`} /></div>
          <div className="spectator-threat"><span>Threat distance</span><strong>{threatDistance}<small> metres</small></strong><i><b style={{ width: `${Math.min(90, threatDistance / 1.7)}%` }} /></i></div>
          <div className="event-log"><span>Recent story event</span><p>{recentEvent}</p></div>
        </aside>
      </section>
      <button className="spectator-exit" onClick={onExit}>Exit spectator view</button>
    </main>
  );
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ArrowIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg>; }
function ChevronIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 9 5 5 5-5" /></svg>; }
function PlayIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" /></svg>; }
function PauseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 6v12M16 6v12" /></svg>; }
function ScreenIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="1" /><path d="M9 21h6M12 18v3" /></svg>; }
function RestartIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8V3m0 0h5M4 3l4 4a7 7 0 1 1-2 7" /></svg>; }
function ShieldIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 2.8 8.3 7 10 4.2-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>; }
function MicIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></svg>; }
