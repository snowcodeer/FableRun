# Cliffhanger Build Log

## Current architecture

- Next.js App Router with React, TypeScript, and Tailwind CSS.
- Deterministic client-side story state machine; live and demo inputs share the same scoring path.
- Browser geolocation with timed simulation fallback; precise coordinates remain in memory only.
- Web Audio and speech synthesis fallback, with a server-only ElevenLabs route when configured.
- Local-first run state with no authentication or database dependency.

## Important assumptions

- The first episode targets a condensed hackathon demo while preserving the shape of an 8–12 minute real run.
- Demo mode is explicitly labelled and can accelerate intervals without changing story logic.
- Missing GPS, motion access, or ElevenLabs must never block the complete experience.
- Stable milestones are pushed to the private `snowcodeer/FableRun` remote and deployed to the canonical Vercel alias.

## Major decisions

- Use deterministic authored nodes instead of runtime LLM generation so every branch is safe and demonstrable.
- Score relative to calibration and selected difficulty so the experience rewards personal effort rather than elite speed.
- Keep exact GPS samples on-device and expose only derived pace/distance to the story engine and spectator view.
- Build original procedural audio layers and browser speech fallback to avoid copyrighted assets and network fragility.

## Implementation plan

1. Scaffold the application, design tokens, and quality gates.
2. Implement the authored episode, interval scoring, and branching outcomes.
3. Add geolocation, simulation, narration, and adaptive audio services.
4. Build the cinematic mobile run, decisions, endings, summary, and spectator view.
5. Verify the complete loop in live-fallback and demo modes, then deploy and test over HTTPS.

## Completed milestones

- Repository and environment audit completed.
- Next.js 16 mobile application scaffold and cinematic design system completed.
- Deterministic 575-second real / 102-second demo story graph implemented and validated.
- GPS-derived tracking, deterministic simulation, adaptive Web Audio, wake lock, and server-only narration route implemented.
- Landing, personalisation, permissions, calibration, live HUD, choice, endings, summary, demo controls, and spectator surfaces implemented.
- Scroll-scrub zombie reveal adapted with safe body-style restoration and accessible escape paths.
- Private Git remote configured at `snowcodeer/FableRun`; `main` is pushed.
- Vercel project configured with explicit Next.js preset; `https://fablerun.vercel.app` is live and externally returns HTTP 200.
- ElevenLabs key is present locally and as an encrypted Vercel Production variable; its value has not been read, logged, or committed.
- Original zombie chase artwork and a bundled 8-second intro video now anchor the scroll reveal without a third-party media dependency.
- The interface is wired to the canonical story controller, tracking, adaptive audio, wake lock, and narration hooks; the temporary five-scene adapter has been removed.
- Local mobile E2E proved personalisation, strong rescue and miss/survival branches, cooldown/summary, pause/resume, early safe ending, and zero browser console errors.
- Local narration evidence proved configured server-side ElevenLabs audio and an in-memory cache miss followed by a hit.
- Production deployment from source milestone `cd9b5b6` completed and the canonical alias returned HTTP 200; the hero asset returned 200 and the local intro video returned 206 range delivery.
- Production mobile E2E at 390×844 proved intro release, exact body unlock, personalisation with Zoe, the multi-node strong route, a personalized decision, rescue ending, cooldown, summary, and zero console errors.
- Production desktop spectator QA at 1440×900 proved the live story node, distance, interval, threat, and event feed without horizontal overflow.
- Production narration returned configured `audio/mpeg` with matching non-empty bodies and a cache miss followed by a hit; fallback source remains explicitly visible in the run HUD.

## Known limitations

- Live outdoor GPS behavior still requires a physical run; automated QA covers deterministic GPS available/noisy/unavailable states and the shared derived-metrics contract.
- Native speech playback policies vary by browser, so the UI reports whether ElevenLabs or the device fallback is active and never blocks a run.
- Production acceptance must be repeated after each stable deployment because build success alone is not runtime proof.

## Next highest-priority task

- Run a physical outdoor GPS session before treating live pace acquisition as field-proven; keep deploying each green `main` milestone to the canonical alias for observable acceptance.
