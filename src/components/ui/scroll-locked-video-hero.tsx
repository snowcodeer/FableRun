"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";

const DEFAULT_VIDEO = "/cliffhanger-intro.mp4";

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

type BodyStyleSnapshot = Pick<
  CSSStyleDeclaration,
  | "position"
  | "top"
  | "left"
  | "right"
  | "width"
  | "overflow"
  | "touchAction"
  | "overscrollBehavior"
>;

export interface ScrollLockedVideoHeroProps {
  videoSrc?: string;
  eyebrow?: string;
  title?: string;
  tagline?: string;
  scrollHint?: string;
  continueLabel?: string;
  scrubDistance?: number;
  onContinue: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * A one-shot cinematic reveal. While the reveal is active, wheel/touch/keyboard
 * input scrubs the provided video. At completion the document is immediately
 * unlocked; it never re-locks. Every inline body style touched here is restored
 * to its exact previous value, including on unmount and video failure.
 */
export default function ScrollLockedVideoHero({
  videoSrc = DEFAULT_VIDEO,
  eyebrow = "FableRun · Episode 01",
  title = "THE CITY ISN’T EMPTY",
  tagline = "Run the story. Change the ending.",
  scrollHint = "Swipe to begin",
  continueLabel = "Start your story",
  scrubDistance = 1250,
  onContinue,
  className,
  style,
}: ScrollLockedVideoHeroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const taglineRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const lockSnapshotRef = useRef<BodyStyleSnapshot | null>(null);
  const lockScrollYRef = useRef(0);
  const lockedRef = useRef(false);
  const releaseRef = useRef<() => void>(() => undefined);
  const completeRef = useRef<() => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [progress, setProgress] = useState(0);

  const continueIntoStory = useCallback(() => {
    releaseRef.current();
    onContinue();
  }, [onContinue]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const body = document.body;
    let duration = 0;
    let targetProgress = reduceMotion ? 1 : 0;
    let currentProgress = targetProgress;
    let lastAnnouncedProgress = -1;
    let rafId = 0;
    let touchY = 0;
    let seeking = false;
    let pendingTime: number | null = null;
    let completed = false;

    const releaseLock = () => {
      if (!lockedRef.current) return;

      lockedRef.current = false;
      const snapshot = lockSnapshotRef.current;
      if (snapshot) {
        body.style.position = snapshot.position;
        body.style.top = snapshot.top;
        body.style.left = snapshot.left;
        body.style.right = snapshot.right;
        body.style.width = snapshot.width;
        body.style.overflow = snapshot.overflow;
        body.style.touchAction = snapshot.touchAction;
        body.style.overscrollBehavior = snapshot.overscrollBehavior;
      }
      window.scrollTo({ top: lockScrollYRef.current, behavior: "instant" });
    };

    const engageLock = () => {
      if (reduceMotion || lockedRef.current) return;

      lockScrollYRef.current = window.scrollY;
      lockSnapshotRef.current = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
        touchAction: body.style.touchAction,
        overscrollBehavior: body.style.overscrollBehavior,
      };
      body.style.position = "fixed";
      body.style.top = `-${lockScrollYRef.current}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
      body.style.overscrollBehavior = "none";
      lockedRef.current = true;
    };

    const finishReveal = () => {
      if (completed) return;
      completed = true;
      targetProgress = 1;
      currentProgress = 1;
      setProgress(1);
      setRevealed(true);
      releaseLock();
    };

    releaseRef.current = releaseLock;
    completeRef.current = finishReveal;

    const seekTo = (time: number) => {
      if (!Number.isFinite(time) || duration <= 0) return;
      if (seeking) {
        pendingTime = time;
        return;
      }
      seeking = true;
      try {
        video.currentTime = time;
      } catch {
        seeking = false;
      }
    };

    const onSeeked = () => {
      seeking = false;
      if (pendingTime !== null) {
        const nextTime = pendingTime;
        pendingTime = null;
        seekTo(nextTime);
      }
    };

    const onLoaded = () => {
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      setReady(true);
      if (reduceMotion) {
        try {
          video.currentTime = duration * 0.92;
        } catch {
          // The poster-like fallback remains visible if seeking is unavailable.
        }
        finishReveal();
      }
    };

    const onFailure = () => {
      setFailed(true);
      setReady(true);
      finishReveal();
    };

    const addDelta = (delta: number) => {
      if (!lockedRef.current || completed) return;
      targetProgress = clamp(targetProgress + delta / scrubDistance);
      if (targetProgress >= 0.995) finishReveal();
    };

    const onWheel = (event: WheelEvent) => {
      if (!lockedRef.current) return;
      event.preventDefault();
      addDelta(event.deltaY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      touchY = event.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!lockedRef.current) return;
      const nextY = event.touches[0]?.clientY ?? touchY;
      const delta = touchY - nextY;
      touchY = nextY;
      event.preventDefault();
      addDelta(delta * 1.45);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!lockedRef.current) return;
      const forwardKeys = ["ArrowDown", "PageDown", " "];
      const backwardKeys = ["ArrowUp", "PageUp"];
      if (forwardKeys.includes(event.key)) {
        event.preventDefault();
        addDelta(event.key === " " ? 260 : 140);
      } else if (backwardKeys.includes(event.key)) {
        event.preventDefault();
        addDelta(-140);
      } else if (event.key === "End" || event.key === "Escape") {
        event.preventDefault();
        finishReveal();
      }
    };

    const frame = () => {
      currentProgress += (targetProgress - currentProgress) * 0.16;
      if (Math.abs(targetProgress - currentProgress) < 0.0005) {
        currentProgress = targetProgress;
      }

      seekTo(currentProgress * duration);

      const title = titleRef.current;
      const taglineElement = taglineRef.current;
      const progressElement = progressRef.current;
      if (title) {
        const titleAmount = 1 - clamp(currentProgress / 0.38);
        title.style.opacity = String(titleAmount);
        title.style.transform = `translateY(${(1 - titleAmount) * -24}px) scale(${0.96 + titleAmount * 0.04})`;
        title.style.filter = `blur(${(1 - titleAmount) * 9}px)`;
      }
      if (taglineElement) {
        const taglineAmount = clamp((currentProgress - 0.7) / 0.24);
        taglineElement.style.opacity = String(taglineAmount);
        taglineElement.style.transform = `translateY(${(1 - taglineAmount) * 18}px)`;
        taglineElement.style.filter = `blur(${(1 - taglineAmount) * 8}px)`;
      }
      if (progressElement) {
        progressElement.style.transform = `scaleX(${currentProgress})`;
      }
      video.style.transform = `scale(${1.02 + currentProgress * 0.075})`;

      const rounded = Math.round(currentProgress * 20) * 5;
      if (rounded !== lastAnnouncedProgress) {
        lastAnnouncedProgress = rounded;
        setProgress(rounded / 100);
      }
      if (!completed) rafId = requestAnimationFrame(frame);
    };

    engageLock();
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("canplay", onLoaded, { once: true });
    video.addEventListener("error", onFailure);
    video.addEventListener("seeked", onSeeked);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onLoaded();
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    rafId = requestAnimationFrame(frame);

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("error", onFailure);
      video.removeEventListener("seeked", onSeeked);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(rafId);
      releaseLock();
      releaseRef.current = () => undefined;
      completeRef.current = () => undefined;
    };
  }, [scrubDistance, videoSrc]);

  const handleHeroKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (revealed && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      continueIntoStory();
    }
  };

  return (
    <section
      className={`cinematic-hero ${className ?? ""}`}
      style={style}
      aria-label="FableRun cinematic introduction"
      onKeyDown={handleHeroKeyDown}
    >
      <video
        ref={videoRef}
        className={`cinematic-hero__video ${ready && !failed ? "is-ready" : ""}`}
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      />

      <div className="cinematic-hero__fallback" aria-hidden="true">
        <Image
          className="cinematic-hero__poster"
          src="/images/cliffhanger-hero-v2.png"
          alt=""
          fill
          priority
          sizes="100vw"
        />
      </div>
      <div className="cinematic-hero__wash" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />
      <div className="fog-layer fog-layer--one" aria-hidden="true" />
      <div className="fog-layer fog-layer--two" aria-hidden="true" />

      <header className="cinematic-hero__masthead">
        <a className="wordmark" href="#intro-title" aria-label="FableRun home">
          FABLE<span>RUN</span>
        </a>
        <div className="signal-chip">
          <i aria-hidden="true" /> Adaptive story
        </div>
      </header>

      <div ref={titleRef} className="cinematic-hero__title-wrap">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="intro-title">{title}</h1>
      </div>

      <div ref={taglineRef} className="cinematic-hero__tagline">
        <p>{tagline}</p>
        <span>The plot sets the pace. Your run writes what happens next.</span>
      </div>

      <div className="cinematic-hero__radar" aria-hidden="true">
        <i />
        <b />
      </div>

      <div className="cinematic-hero__footer">
        <div className="cinematic-hero__status">
          <span>Story status</span>
          <strong>{failed ? "Fallback ready" : ready ? "Ready to run" : "Loading story"}</strong>
        </div>

        {!revealed ? (
          <div className="scrub-hint" aria-hidden="true">
            <div className="scrub-hint__line" />
            <span>{scrollHint}</span>
          </div>
        ) : (
          <button className="primary-action primary-action--hero" onClick={continueIntoStory} autoFocus>
            <span>{continueLabel}</span>
            <ArrowIcon />
          </button>
        )}
      </div>

      <button
        type="button"
        className="skip-intro"
        onClick={() => {
          if (revealed) continueIntoStory();
          else {
            completeRef.current();
            window.setTimeout(continueIntoStory, 80);
          }
        }}
      >
        {revealed ? "Continue" : "Skip intro"}
      </button>

      <div
        className="cinematic-hero__progress-track"
        role="progressbar"
        aria-label="Cinematic reveal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div ref={progressRef} className="cinematic-hero__progress" />
      </div>
    </section>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
