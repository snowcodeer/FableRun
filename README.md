# Cliffhanger

**An adaptive audio adventure where the plot creates the workout—and the runner’s real performance changes what happens next.**

[Live production demo](https://fablerun.vercel.app) · [Source repository](https://github.com/snowcodeer/FableRun)

Cliffhanger turns a real run into a cinematic zombie escape. The first episode, **Last Light**, learns the runner’s comfortable baseline, delivers three finite high-intensity pushes with recovery dialogue, adapts the threat and story to relative performance, offers a meaningful route choice, and always continues to a safe ending.

## Experience

- Cinematic scroll-scrub intro with skip, keyboard, touch, reduced-motion, and video-failure exits.
- Personalisation by the name and relationship of the person the runner is trying to save.
- Live GPS-derived pace and distance, with exact coordinates retained only in volatile on-device memory.
- Deterministic simulation mode for standing, easy running, sprinting, GPS failure, interval outcomes, and accelerated judging.
- Configurable story graph with strong-success, success, near-miss, and miss outcomes; misses redirect the story rather than end it.
- Server-side ElevenLabs narration when configured, with automatic browser speech fallback.
- Original procedural Web Audio layers for heartbeat, atmosphere, percussion, bass, and chase intensity.
- Minimal one-hand run HUD, pause/end safety control, route decision, multiple endings, summary, and large-screen spectator view.

## Architecture

```text
Next.js App Router
├── src/components/              cinematic client experience and HUD
├── src/lib/story/               authored nodes, scoring, transitions, summaries
├── src/hooks/                   GPS/demo, narration, adaptive audio, wake lock
├── src/lib/platform/            browser-independent runtime primitives and types
└── src/app/api/narrate/         server-only ElevenLabs proxy
```

The story graph is deterministic and authored in TypeScript; it does not depend on an LLM being available during a run. Live GPS and demo simulation expose the same derived-metrics contract. No authentication or database is required.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app remains fully demonstrable without an ElevenLabs key.

For remote narration, set the server-only variable in `.env.local`:

```text
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

The voice ID is optional and selects the in-world dispatcher voice; the route has a safe code fallback. Never prefix either variable with `NEXT_PUBLIC_`. `.env.local` is ignored and must not be committed.

## Quality gates

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Story engine tests compile to a temporary directory and run with Node’s test runner; see `src/lib/story/__tests__/engine.test.ts`.

## Deployment

The production project is `fablerun` on Vercel and is pinned to [fablerun.vercel.app](https://fablerun.vercel.app). `vercel.json` explicitly selects the Next.js framework preset. Configure `ELEVENLABS_API_KEY` as an encrypted Vercel Production variable, then deploy a green milestone with:

```bash
vercel deploy --prod --yes --logs
```

After deployment, verify the canonical alias—not only the generated deployment URL—on a mobile viewport and check `/api/narrate` without exposing response audio or provider secrets.

## Privacy and safety

- Exact latitude/longitude samples never leave the tracking hook and are cleared on reset/unmount.
- Only derived pace, distance, accuracy state, and story progress reach the experience layer.
- GPS denial, noisy readings, missing motion access, provider failure, and unstable data all have finite fallbacks.
- Every effort is timed; the app never asks for indefinite acceleration.
- Missing an interval changes the story without shame. Pause/end-run remains prominent.

## Visual references

These references informed hierarchy and interaction patterns; Cliffhanger’s artwork, HUD, copy, and component system are original adaptations rather than copies.

- [STUP running UI — high-contrast dark telemetry](https://dribbble.com/shots/27590823-STUP-Smart-Running-Fitness-App-UI)
- [Stride running UI — glanceable condensed live metrics](https://dribbble.com/shots/27655358-Stride-Running-App-UI)
- [Sci-fi mobile game HUD — spatial status hierarchy](https://dribbble.com/shots/24481025-Sci-fi-video-game-interface)
- [21st.dev scroll-video hero collection](https://21st.dev/community/components/explore/nt-scroll-video-hero-prompt)
- [21st.dev waveform collection](https://21st.dev/community/components/s/waveform)
- [ZRX / Zombies, Run! — narrative running category reference](https://zombiesrungame.com/)

## Project record

See [BUILD_LOG.md](./BUILD_LOG.md) for assumptions, decisions, completed milestones, limitations, and the next integration task.
