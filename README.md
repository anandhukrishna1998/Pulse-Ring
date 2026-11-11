# PULSE RING

## About

**[Play PULSE RING Live →](https://anandhukrishna1998.github.io/Pulse-Ring/)**

A zero-dependency, high-DPI HTML5 Canvas precision timing game built with vanilla HTML, CSS, and ES Modules. Open the live game and play immediately—snap the orbiting pulse inward through concentric rings as it passes each amber target arc.

## Gameplay & Modes

- **Hit & Perfect Timing:**
  - **Hit:** Snap inside the amber target arc (`+1` streak) to advance to the next inner ring or clear the level.
  - **Perfect:** Snap inside the inner center notch (`28%` of the half-arc) for a `+2` streak bonus, harmonic shimmer chime, and double ripple.
  - **Miss:** Resets the current streak to `0` (`160ms` bounce guard before instant 1-tap/`Space` retry).
- **Smooth Difficulty Curve:**
  - **Levels 1–2:** `2` concentric rings spinning in the same direction.
  - **Levels 3–5:** `2` rings, `+4%` speed per level, alternating spin directions.
  - **Levels 6–12:** `3` rings, alternating spin, subtle sinusoidal arc drift and breathing on the outer ring.
  - **Levels 13+:** `4` rings, sinusoidal drift on the outer two rings (with breathing on the outermost ring), asymptotic speed cap (`3.30 rad/s`), and minimum arc floor (`0.46 rad`).
  - Frame-rate independent physics (`dt <= 0.05s`) keep orbital speed consistent across 60Hz, 120Hz, and 144Hz displays.
- **Endless Mode (Default):** Advances level-by-level. Missing retries the current level immediately; progress persists locally under `pulse-ring:endless`.
- **Daily Challenge (`DAILY` / `D`):** Deterministic UTC daily levels (`YYYY-MM-DD`) seeded via FNV-1a + Mulberry32 (`pulse-ring:<YYYY-MM-DD>:level:<L>`). Starts at Level `01`; missing ends the run, records daily stats under `pulse-ring:daily:<YYYY-MM-DD>`, and reveals a 1-click **Share Result** button alongside instant replay:
  ```text
  PULSE RING · Daily YYYY-MM-DD
  Level XX · Streak XX · X Perfects
  ```

## Controls & Shortcuts

| Input | Action |
|---|---|
| `Tap` / `Click` (arena) or `Space` / `Enter` | Snap orb inward / Retry after miss |
| `D` | Toggle Endless / Daily Challenge mode |
| `M` | Mute / unmute audio |
| `T` | Switch Dark / Light theme |
| `?` or `H` | Open or close the Rules & shortcuts popover (pauses game) |
| `Escape` | Close the Rules popover and restore focus |

## Visuals, Audio & Accessibility

- **Light & Dark Parity:** Defaults to the OS `prefers-color-scheme` on first visit and persists manual choices in `pulse-ring:theme` (`#0F1117` dark ground / `#F6F4EF` light ground).
- **Procedural Web Audio Synth:** Synthesizes all audio in real time via `AudioContext` (`sine` + `triangle` oscillators with exponential gain envelopes)—stepping up a C-major pentatonic ladder (`C5`–`E6`), adding an octave-fifth shimmer on `PERFECT`, an ascending chord on level clear, and a `185Hz → 120Hz` sweep on miss (`pulse-ring:muted`).
- **Accessibility & Reduced Motion:**
  - Native `<button>` HUD controls with `44px × 44px` minimum targets, visible `:focus-visible` outlines, and pointer-blur handling so clicking HUD toggles never steals `Space` from gameplay.
  - Polite `aria-live="polite"` announcements for level advances, perfect snaps, misses, mode switches, and clipboard feedback.
  - Mobile-safe `100dvh` viewport with `touch-action: none` and `env(safe-area-inset-*)` padding.
  - Automatic pause on hidden browser tabs (`visibilitychange`) or when the Rules dialog is open.
  - Honors `prefers-reduced-motion: reduce` by removing orb trails, snap glide tweening, and CSS transitions while keeping gameplay physics unchanged.
  - Safe `localStorage` wrapper falls back cleanly to in-memory state in restricted/private browsing contexts.

## Running Locally & Tests

Because the app loads native ES Modules (`./src/main.js`), serve the directory over HTTP rather than opening `index.html` via `file://`:

```bash
# Option 1: Node serve
npx serve .

# Option 2: Python built-in HTTP server
python -m http.server 8080
```

Then open the local URL (e.g. `http://localhost:8080`) in your browser.

Run the test suite with Node's built-in test runner (Node 24+, zero npm packages required):

```bash
node --test tests/*.test.js
```

## Project Structure

```text
pulse-ring/
├── .github/
│   └── workflows/
│       └── pages.yml              # GitHub Actions static Pages deployment
├── docs/
│   └── plan.md                    # Implementation plan
├── src/
│   ├── audio/
│   │   └── synth.js               # Procedural Web Audio pentatonic synthesizer
│   ├── game/
│   │   ├── difficulty.js          # Progression curve & deterministic level generator
│   │   ├── geometry.js            # Angle normalization & wrap-around arc collision
│   │   ├── state.js               # Pure state machine & frame-independent loop logic
│   │   └── storage.js             # Safe localStorage wrapper (theme, muted, endless, daily)
│   ├── math/
│   │   └── prng.js                # FNV-1a + Mulberry32 PRNG & UTC YYYY-MM-DD keys
│   ├── render/
│   │   └── canvas-renderer.js     # DPR-scaled 2D Canvas renderer & reduced-motion support
│   ├── ui/
│   │   └── hud.js                 # Accessible DOM HUD, rules popover & Daily share UI
│   └── main.js                    # Entry bootstrap, RAF loop & input wiring
├── styles/
│   └── main.css                   # Theme tokens, responsive grid, focus & reduced-motion rules
├── tests/
│   ├── difficulty.test.js
│   ├── geometry.test.js
│   ├── hud.test.js
│   ├── main.test.js
│   ├── prng.test.js
│   ├── renderer.test.js
│   ├── state.test.js
│   ├── storage.test.js
│   └── synth.test.js
├── DESIGN.md                      # Design & architecture specification
├── README.md
└── index.html                     # Static entry point
```
