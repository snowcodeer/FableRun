"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAdaptiveAudio } from "@/hooks/use-adaptive-audio";
import { WaitlistForm } from "@/components/waitlist-form";

type ReelPhase =
  | "setup"
  | "hook"
  | "boyfriend"
  | "drop"
  | "chase"
  | "pace"
  | "choice"
  | "turn"
  | "rescue"
  | "loss"
  | "sprint"
  | "end";
type VideoSource = "sample" | "upload" | "camera";

const REEL_DURATION_SECONDS = 120;
const SIGNUP_URL = "https://fablerun.vercel.app/waitlist";

const reelCopy: Record<Exclude<ReelPhase, "setup">, {
  eyebrow: string;
  headline: string;
  caption: string;
}> = {
  hook: {
    eyebrow: "FABLE RUN · SESSION 01",
    headline: "RUN STARTED",
    caption: "00:00 · 0.00 km",
  },
  boyfriend: {
    eyebrow: "COMPANION TRACKER",
    headline: "CONNECTED",
    caption: "Boyfriend · 6m behind",
  },
  drop: {
    eyebrow: "EMERGENCY BROADCAST",
    headline: "OUTBREAK DETECTED",
    caption: "Audio intensity rising",
  },
  chase: {
    eyebrow: "LIVE WARNING",
    headline: "FALLING BACK",
    caption: "Companion · 24m",
  },
  pace: {
    eyebrow: "PACE RESPONSE",
    headline: "THREAT +12M",
    caption: "Pace below target",
  },
  choice: {
    eyebrow: "VOICE CHOICE",
    headline: "GO BACK?",
    caption: "Say anything or tap",
  },
  turn: {
    eyebrow: "CHOICE ACCEPTED",
    headline: "ROUTE REVERSED",
    caption: "Rescue branch active",
  },
  rescue: {
    eyebrow: "RESCUE SPRINT",
    headline: "8M AWAY",
    caption: "Companion signal weak",
  },
  loss: {
    eyebrow: "COMPANION TRACKER",
    headline: "SIGNAL LOST",
    caption: "No pulse detected",
  },
  sprint: {
    eyebrow: "FINAL INTERVAL",
    headline: "400M LEFT",
    caption: "Pursuit mix · maximum",
  },
  end: {
    eyebrow: "RUN COMPLETE",
    headline: "NEW PB",
    caption: "3.20 km · 5:08/km",
  },
};

function phaseFor(seconds: number): Exclude<ReelPhase, "setup"> {
  if (seconds < 4) return "hook";
  if (seconds < 11) return "boyfriend";
  if (seconds < 18) return "drop";
  if (seconds < 32) return "chase";
  if (seconds < 45) return "pace";
  if (seconds < 59) return "choice";
  if (seconds < 73) return "turn";
  if (seconds < 88) return "rescue";
  if (seconds < 101) return "loss";
  if (seconds < 112) return "sprint";
  return "end";
}

function mixFor(phase: Exclude<ReelPhase, "setup">) {
  if (phase === "hook") return { intensity: 0.08, pace: 0.16, performance: 0.4 };
  if (phase === "boyfriend") return { intensity: 0.14, pace: 0.24, performance: 0.35 };
  if (phase === "drop") return { intensity: 0.62, pace: 0.58, performance: 0.2 };
  if (phase === "chase") return { intensity: 1, pace: 1, performance: -0.25 };
  if (phase === "pace") return { intensity: 0.86, pace: 0.62, performance: -0.5 };
  if (phase === "choice") return { intensity: 0.82, pace: 0.72, performance: -0.4 };
  if (phase === "turn") return { intensity: 0.9, pace: 0.82, performance: 0.1 };
  if (phase === "rescue") return { intensity: 1, pace: 1, performance: -0.8 };
  if (phase === "loss") return { intensity: 0.32, pace: 0.2, performance: -0.85 };
  if (phase === "sprint") return { intensity: 1, pace: 1, performance: 0.82 };
  return { intensity: 0.74, pace: 0.62, performance: 0.8 };
}

function formatRemaining(seconds: number) {
  const remaining = Math.max(0, Math.ceil(REEL_DURATION_SECONDS - seconds));
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
}

export default function ReelDemo() {
  const [phase, setPhase] = useState<ReelPhase>("setup");
  const [elapsed, setElapsed] = useState(0);
  const [videoSource, setVideoSource] = useState<VideoSource>("sample");
  const [videoUrl, setVideoUrl] = useState("/cliffhanger-intro.mp4");
  const [sourceLabel, setSourceLabel] = useState("Demo footage");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef(0);
  const frameRef = useRef<FrameRequestCallback>(() => undefined);
  const startedAtRef = useRef(0);
  const currentPhaseRef = useRef<Exclude<ReelPhase, "setup">>("hook");
  const {
    mood,
    pause: pauseAudio,
    setMix: setAudioMix,
    start: startAudio,
    stop: stopAudio,
  } = useAdaptiveAudio({ intensity: 0.08, pace: 0.1, performance: 0.2 });

  const activeCopy = phase === "setup" ? reelCopy.hook : reelCopy[phase];
  const progress = Math.min(100, (elapsed / REEL_DURATION_SECONDS) * 100);
  const countdown = formatRemaining(elapsed);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  const stopTake = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    videoRef.current?.pause();
    setAudioMix(mixFor("end"));
    setElapsed(REEL_DURATION_SECONDS);
    setPhase("end");
  }, [setAudioMix]);

  const frame = useCallback((now: number) => {
    const nextElapsed = Math.min(
      REEL_DURATION_SECONDS,
      (now - startedAtRef.current) / 1_000,
    );
    const nextPhase = phaseFor(nextElapsed);
    if (nextPhase !== currentPhaseRef.current) {
      currentPhaseRef.current = nextPhase;
      setAudioMix(mixFor(nextPhase));
      setPhase(nextPhase);
    }
    setElapsed(nextElapsed);
    if (nextElapsed >= REEL_DURATION_SECONDS) {
      stopTake();
      return;
    }
    animationRef.current = requestAnimationFrame((nextNow) => frameRef.current(nextNow));
  }, [setAudioMix, stopTake]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const startTake = async () => {
    cancelAnimationFrame(animationRef.current);
    setCameraError(null);
    setElapsed(0);
    currentPhaseRef.current = "hook";
    setPhase("hook");
    setAudioMix(mixFor("hook"));
    await startAudio();

    const video = videoRef.current;
    if (video) {
      if (videoSource !== "camera") video.currentTime = 0;
      await video.play().catch(() => undefined);
    }
    startedAtRef.current = performance.now();
    animationRef.current = requestAnimationFrame((now) => frameRef.current(now));
  };

  const resetTake = () => {
    cancelAnimationFrame(animationRef.current);
    setElapsed(0);
    setPhase("setup");
    setAudioMix(mixFor("hook"));
    void pauseAudio();
    const video = videoRef.current;
    if (video && videoSource !== "camera") {
      video.pause();
      video.currentTime = 0;
    }
  };

  const chooseVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    stopCamera();
    releaseObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setVideoUrl(objectUrl);
    setVideoSource("upload");
    setSourceLabel(file.name);
    setCameraError(null);
    setPhase("setup");
    setElapsed(0);
    window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = 0;
      void video.play().then(() => video.pause()).catch(() => undefined);
    }, 0);
  };

  const useCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is unavailable here. Choose a running clip instead.");
      return;
    }
    try {
      stopCamera();
      releaseObjectUrl();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setVideoUrl("");
      setVideoSource("camera");
      setSourceLabel("Live front camera");
      setCameraError(null);
      setPhase("setup");
      setElapsed(0);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
    } catch {
      setCameraError("Camera access is off. Choose a running clip or enable camera permission.");
    }
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
      stopCamera();
      releaseObjectUrl();
      void stopAudio();
    };
  }, [releaseObjectUrl, stopAudio, stopCamera]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videoSource === "camera") return;
    video.srcObject = null;
    video.load();
  }, [videoSource, videoUrl]);

  const horde = useMemo(
    () => Array.from({ length: 9 }, (_, index) => (
      <i key={index} style={{ "--horde-index": index } as React.CSSProperties} />
    )),
    [],
  );

  return (
    <main className={`reel-page reel-phase-${phase}`}>
      <section className="reel-frame" aria-label="FableRun vertical reel preview">
        <video
          ref={videoRef}
          className="reel-video"
          src={videoSource === "camera" ? undefined : videoUrl}
          muted
          playsInline
          loop
          preload="metadata"
        />
        <div className="reel-video-wash" aria-hidden="true" />
        <div className="reel-apocalypse" aria-hidden="true" />
        <div className="reel-boyfriend" aria-hidden="true">
          <i />
          <span>{phase === "loss" || phase === "end" ? "SIGNAL LOST" : "BOYFRIEND · 24M"}</span>
        </div>
        <div className="reel-horde" aria-hidden="true">{horde}</div>
        <div className="reel-scanlines" aria-hidden="true" />

        <header className="reel-header">
          <Link href="/" className="reel-wordmark">FABLE<span>RUN</span></Link>
          <div className="reel-rec"><i /> 9:16 TAKE</div>
        </header>

        <div className="reel-location-chip">LONDON HACKATHON · LIVE</div>

        <div className="reel-story-copy" aria-live="polite">
          <p>{activeCopy.eyebrow}</p>
          <h1>{activeCopy.headline}</h1>
          <span>{activeCopy.caption}</span>
        </div>

        {(["drop", "chase", "pace", "turn", "rescue"] as ReelPhase[]).includes(phase) && (
          <div className="reel-alert"><i /> VOLUME UP · THREAT NEARBY</div>
        )}

        {(["chase", "pace", "turn", "rescue", "sprint"] as ReelPhase[]).includes(phase) && (
          <div className="reel-run-hud">
            <div><span>PACE</span><strong>{phase === "pace" ? "6:18" : phase === "sprint" ? "4:48" : "5:42"}<small>/km</small></strong></div>
            <div><span>{phase === "sprint" ? "FINISH" : "THREAT"}</span><strong>{phase === "rescue" ? "8" : phase === "sprint" ? "400" : "18"}<small>m</small></strong></div>
            <div className="reel-threat-track"><i /><b /></div>
          </div>
        )}

        {phase === "choice" && (
          <div className="reel-choice-card">
            <div className="reel-choice-wave">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
            <p>“I’m going back for him!”</p>
            <div><span>A · GO BACK</span><span>B · KEEP RUNNING</span></div>
          </div>
        )}

        {phase === "turn" && (
          <div className="reel-choice-card reel-choice-card--accepted">
            <div className="reel-choice-wave">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
            <p>Freeform choice accepted</p>
            <div><span>STORY REWRITTEN</span><span>ROUTE REVERSED</span></div>
          </div>
        )}

        {phase === "loss" && (
          <div className="reel-signal-lost" role="status">
            <span>COMPANION TRACKER</span>
            <strong>NO PULSE DETECTED</strong>
          </div>
        )}

        {phase !== "setup" && (
          <div className="reel-timeline">
            <span>{countdown}</span>
            <i><b style={{ width: `${progress}%` }} /></i>
            <em>{mood}</em>
          </div>
        )}

        {phase === "setup" && (
          <div className="reel-setup">
            <p className="reel-setup__eyebrow">Reel Mode · 2 minute demo</p>
            <h1>Your run.<br />Our apocalypse.</h1>
            <p>A complete two-minute arc: London hackathon, live apocalypse, voice choice, failed rescue, and one boyfriend who should have trained harder.</p>
            <div className="reel-source-card">
              <span>Background video</span>
              <strong>{sourceLabel}</strong>
              <small>{videoSource === "sample" ? "Replace this before filming your final take." : "Ready for your take."}</small>
            </div>
            <div className="reel-source-actions">
              <label>
                <input type="file" accept="video/*" onChange={chooseVideo} />
                Choose running clip
              </label>
              <button type="button" onClick={useCamera}>Use live camera</button>
            </div>
            {cameraError && <p className="reel-error" role="alert">{cameraError}</p>}
            <button className="reel-start" type="button" onClick={startTake}>
              <span>Start 9:16 take</span><PlayIcon />
            </button>
            <small className="reel-tip">Start your phone’s screen recording first. Headphones make the beat drop cleaner.</small>
          </div>
        )}

        {phase === "end" && (
          <div className="reel-end-cta">
            <div>
              <span>YOUR TURN</span>
              <strong>RUN THE NEXT EPISODE.</strong>
              <p>Scan to join the FableRun beta.</p>
            </div>
            <a href={SIGNUP_URL} target="_blank" rel="noreferrer" aria-label="Sign up for FableRun">
              <QRCodeSVG
                value={SIGNUP_URL}
                size={116}
                bgColor="#f7f7f4"
                fgColor="#0b0b0d"
                level="M"
                marginSize={1}
                title="FableRun signup QR code"
              />
              <small>SCAN TO RUN</small>
            </a>
            <WaitlistForm compact source="reel" />
            <div className="reel-end-actions">
              <button type="button" onClick={startTake}>Replay</button>
              <button type="button" onClick={resetTake}>Change clip</button>
              <Link href="/waitlist">Open full signup</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function PlayIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" /></svg>;
}
