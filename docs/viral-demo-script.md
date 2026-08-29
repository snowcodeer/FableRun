# FableRun two-minute viral demo — finished cut

## The idea

A vertical run that plays completely in-world. You never explain the product or address the audience. You speak to Joon; Joon answers; FableRun interrupts the run through its narrator, warnings, music and live HUD. The features reveal themselves through the emergency.

**Runtime:** 2:00

**Format:** 9:16 vertical

**Demo page:** `/reel`

**Signup page and QR target:** `/waitlist`

## Final edit script and shot list

| Time | Picture / sound | Dialogue in the finished cut |
| --- | --- | --- |
| 0:00–0:11 | Start mid-run on the first selfie take. The clean FableRun HUD shows `RUN STARTED`, then `JOON CONNECTED`. Calm pulse sits beneath the real location audio. | **YOU:** “I’m at London’s first running hackathon. Joon, keep up!” **JOON, behind you:** “I’m right here. Why are you sprinting already?” **YOU:** “Because we need to win!” |
| 0:11–0:13 | A loud two-tone emergency siren interrupts the run. The screen changes to the red apocalypse state and flashes `RUN FASTER`. | **SIREN ONLY** |
| 0:13–0:17.5 | The score ducks beneath the configured ElevenLabs narrator. The horde silhouettes, threat bar and distance appear over the live footage. | **NARRATOR:** “London just fell—and there are zombies forty-two metres behind you.” |
| 0:17.5–0:34.5 | Cut to the second running take. The pursuit score starts and the HUD closes from 42m to 31m. | **YOU:** “Joon—run!” **JOON:** “I am running!” **JOON:** “Wait, my leg’s gone!” **YOU:** “Keep going. Don’t stop!” **NARRATOR:** “Pursuit distance: thirty-one metres.” |
| 0:34.5–0:44.3 | The pace panel warns `THREAT +12M`. The edit keeps the live run breath and uses the next take without presenter dialogue. | **YOU:** “Don’t stop. Stay with me, Joon!” **NARRATOR:** “Pace below target. The horde is closing.” **YOU:** “I’m coming back for you!” |
| 0:44.3–0:48.3 | A reframed running insert creates space for FableRun’s voice decision. The app shows a live waveform plus the two fallback buttons. | **NARRATOR:** “Companion pace critical. Continue to safety—or go back.” |
| 0:48.3–0:55.9 | Return to the synced choice take. The runner answers aloud without touching the buttons. | **YOU:** “Wait, I’m going back. Keep talking to me, Joon.” **JOON:** “You idiot—don’t come back!” **YOU:** “Too late!” |
| 0:55.9–1:01.9 | The HUD confirms `ROUTE REVERSED`. | **YOU:** “I can see you. Keep moving.” |
| 1:01.9–1:11.9 | The rescue state tightens to `8M AWAY`; Joon remains a separate off-camera character voice rather than the narrator. | **YOU:** “I can see you. Keep moving. Joon! Joon!” |
| 1:11.9–1:19 | Joon’s captured line is cut off by impact and radio static. The music falls into a deliberate vacuum and the app changes to `SIGNAL LOST`. | **JOON:** “Don’t stop. Just—” **STATIC / IMPACT** **NARRATOR:** “Companion signal lost. No pulse detected.” |
| 1:19–1:27.2 | Reframed running inserts rebuild momentum. The three-stage score shifts into its fastest pursuit state. | **NARRATOR:** “Final interval. Four hundred metres. Pursuit distance: twelve metres.” |
| 1:27.2–1:54 | Use the final 26.8-second clip uninterrupted as the climax. The HUD holds `400M LEFT`; the score crescendos while the live breathing remains audible. | **YOU, during the sprint:** “Joon! Joon! We won!” **YOU, after looking around:** “Wait, Joon?” |
| 1:54–2:00 | Instant hard cut to a motionless black-and-red end card: `JOIN THE RACE.`, large QR, and `fablerun.vercel.app/waitlist`. | **NARRATOR:** “Join FableRun now.” |

## On-screen text

Keep the overlay to these short app events only:

- `RUN STARTED`
- `COMPANION CONNECTED`
- `RUN FASTER`
- `FALLING BACK`
- `THREAT +12M`
- `GO BACK?`
- `ROUTE REVERSED`
- `8M AWAY`
- `SIGNAL LOST`
- `400M LEFT`
- `JOIN THE RACE.`

Do not put explanatory presenter text on screen. Social captions can transcribe the live dialogue later, but the FableRun capture itself should look like an actual running app in use.

## Performance and edit notes

- Begin mid-motion. The first frame should already feel alive.
- Deliver the opening line to Joon while running; it should feel caught live rather than presented.
- Make the siren an interruption. Duck the calm score, let the narrator finish the London warning, then switch hard into the pursuit music.
- Use three visual modes: face camera, full-screen running footage with HUD, and close app cutaways. Avoid rapid random cuts.
- Keep narrator, Joon and runner voices clearly distinct. No one explains the feature set.
- Leave a short silence immediately after `SIGNAL LOST`; the empty space sells the loss before the final sprint.
- Let “Wait, Joon?” hang for roughly one second, then hard-cut with no transition to `JOIN THE RACE.`
- Let the narrator deliver “Join FableRun now” over the still end card. Hold the QR and printed waitlist link motionless until 2:00.
- Keep the QR large, high-contrast and unobstructed. The same end card includes a native email field for viewers already watching on their phone.

## Finished master

- Local export: `output/demo-edit/FableRun-viral-demo-final.mp4` (ignored by Git)
- 1080 × 1920, H.264, 30 fps, AAC stereo, exactly 2:00
- Integrated mix: −14 LUFS; true peak: −1 dBFS
- QR export check: decodes to `https://fablerun.vercel.app/waitlist`
- The production app remains unchanged; this edit and `/reel` are demo-only.
