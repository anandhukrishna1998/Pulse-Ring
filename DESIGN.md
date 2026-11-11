# PULSE RING — Design & Architecture Specification

## 1. Product Intent & Experience Principles

**PULSE RING** is a zero-friction, precision-timed kinetic browser game built for instant play on desktop and mobile via GitHub Pages. Opening the page lands the player directly on a live orbiting ring—no hero wall, no login gate, no modal clutter.

### Core Principles
- **Immediate Instrument:** The concentric ring arena is the entire visual anchor, live on frame one.
- **Tactile Precision:** Frame-rate independent physics (`dt` in seconds), crisp high-DPI Canvas rendering, and zero-latency input (`pointerdown` + `Space`/`Enter`) ensure 60Hz, 120Hz, and 144Hz devices play identically.
- **Smooth Mastery Curve:** Progression scales monotonically and asymptotically—introducing alternating spin, 3–4 rings, and gentle arc drift without sudden unfair walls.
- **Universal Shared Daily:** Deterministic seeded levels (`YYYY-MM-DD` UTC) let players everywhere play the exact same Daily Challenge sequence simultaneously and copy a clean text summary in one tap.

### Non-Goals / Anti-Goals
- No third-party frameworks, CDNs, bundlers, image assets, or audio files.
- No blocking modal game-over screens or fake global leaderboards.
- No gradient-text clichés, cluttered sidebars, or decorative card chrome.

---

## 2. Approaches Considered

| Approach | Trade-offs | Decision |
|---|---|---|
| **HTML5 2D Canvas (`DPR`-scaled) + Semantic DOM HUD + Vanilla ES Modules** | Zero dependencies, instant load, crisp sub-pixel arcs & tapered orb trails at 120/144fps, native DOM accessibility (`button`, `aria-live`, focus rings) for HUD. | **Selected** |
| **Pure SVG DOM Animation** | Clean DOM semantics, but per-frame attribute churn and glow/trail compositing stutter on mobile WebKit. | Rejected |
| **WebGL / Three.js** | Rich shaders, but heavy bundle/setup overhead and unnecessary complexity for crisp 2D geometric precision. | Rejected |

---

## 3. Visual World, Color System & Typography

**Visual World:** Precision optical instrument / architectural timepiece. Clean hairline geometry, calibrated luminous indicators, and calm negative space.

### Color Tokens (Full Light & Dark Parity)

| Role | Dark Mode (Default) | Light Mode | Notes / Contrast |
|---|---|---|---|
| Ground (`--bg-ground`) | `#0F1117` | `#F6F4EF` | Deep obsidian-slate / warm gallery paper |
| Radial Depth (`--bg-glow`) | `#161B26` | `#FFFFFF` | Subtle centered ambient lift behind rings |
| Surface Popover (`--bg-surface`) | `#171B24` | `#FFFFFF` | `?` rules popover & hover pills |
| Hairline Border (`--border-subtle`) | `rgba(203, 213, 225, 0.18)` | `rgba(43, 46, 56, 0.16)` | Crisp outline controls |
| Primary Ink (`--text-primary`) | `#E2E8F0` | `#1E2028` | ≥ 14:1 contrast on ground |
| Secondary Ink (`--text-muted`) | `#94A3B8` | `#525766` | ≥ 6.2:1 WCAG AA contrast on ground |
| Active Ring (`--ring-active`) | `#CBD5E1` | `#2B2E38` | Crisp silver / charcoal slate |
| Inactive Ring (`--ring-idle`) | `rgba(203, 213, 225, 0.22)` | `rgba(43, 46, 56, 0.18)` | Clear depth hierarchy |
| Target Arc (`--arc-target`) | `#F59E0B` | `#D97706` | Warm luminous / rich amber (≥ 3:1 graphic contrast) |
| Perfect Notch (`--arc-perfect`) | `#FDE68A` | `#92400E` | Inner 28% sweet-spot indicator |
| Orb & Trail (`--orb-color`) | `#FB7185` | `#E11D48` | Glowing coral-rose / crimson-coral |
| Orb Core (`--orb-core`) | `#FFF1F2` | `#FFFFFF` | High-clarity focal center |
| Miss Pulse (`--miss-color`) | `#F87171` | `#DC2626` | Gentle ring pulse on miss |
| Focus Ring (`--focus-ring`) | `#F59E0B` | `#B45309` | 2px offset visible keyboard focus |

### Typography
- **Font Stack:** Zero-network geometric sans stack (`"Avenir Next", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif`) for instant zero-CLS load and offline reliability.
- **Numerals:** `font-variant-numeric: tabular-nums` enforced on `LEVEL`, `STREAK / BEST`, and the Canvas core counter `(N)` so digits never jitter during gameplay.
- **Title Treatment:** `PULSE RING` centered in top HUD with `0.22em` tracking, clean medium weight, zero decorative eyebrow labels.

---

## 4. Layout & Responsive Viewport Wireframe

Full-viewport locked grid (`100dvh`, `overflow: hidden`, `env(safe-area-inset-*)` padding) so mobile rapid taps never scroll or zoom (`touch-action: none` on arena).

### Desktop (`>= 640px`)
```text
+-----------------------------------------------------------------------+
|  LEVEL 04                   PULSE RING        [DAILY]  [M]  [T]  [?]  |
|  STREAK 12 / BEST 18                                                  |
+-----------------------------------------------------------------------+
|                                                                       |
|                              . - ~ - .                                |
|                          . '   [===]   ' .                            |
|                        /    . - ~ - .    \                           |
|                       |    /    (2)    \    |                          |
|                        \    ' - ~ - '    /                           |
|                          ' .           . '                            |
|                              ' - ~ - '                                |
|                                                                       |
+-----------------------------------------------------------------------+
|               Tap anywhere or press Space to snap inward              |
+-----------------------------------------------------------------------+
```

### Mobile (`< 640px`)
```text
+---------------------------------------+
| PULSE RING       [DAILY] [M] [T] [?]  |
| LEVEL 04           STREAK 12 / BEST 18|
+---------------------------------------+
|                                       |
|               ( Arena )               |
|                                       |
+---------------------------------------+
|  Tap anywhere or press Space to snap  |
+---------------------------------------+
```

---

## 5. Core Gameplay Mechanics, Math & Difficulty Curve

### Coordinate & Timing Rules
- Angles live in `[0, 2π)` radians (`0` = 3 o'clock, increasing clockwise).
- Shortest signed angular difference handles wrap-around cleanly across `0 / 2π`:
  `diff(a, b) = ((a - b) mod 2π + 3π) mod 2π - π` in `[-π, π)`.
- **Hit Evaluation:**
  - Let `delta = |diff(orbAngle, arcCenter)|` and `halfArc = arcWidth / 2`.
  - `delta <= halfArc * 0.28` -> `PERFECT` (harmonic boost, crisp ripple, `+2` streak bonus or `perfect` badge; wait: let's define streak cleanly: each snapped ring adds `+1` to streak, and a `PERFECT` snap grants an extra `+1` multiplier bonus (`+2` total streak) + brighter chord!). Let's state this clearly in `?` rules!
  - `delta <= halfArc` -> `HIT` (`+1` streak, inward snap).
  - `delta > halfArc` -> `MISS` (streak resets to `0`, soft low tone + gentle pulse).

### Smooth Level Progression Curve
- **Levels 1–2:** `2` concentric rings, generous target arcs (`1.36 rad` / `78°` on L1, `1.26 rad` / `72°` on L2), gentle base speed (`1.55 rad/s` on L1, `1.62 rad/s` on L2), all rings spin **same direction (`+1`)**, no arc drift.
- **Levels 3–5:** `2` concentric rings, **`+4%` speed per level** (`speed(L) = 1.62 * 1.04^(L - 2)` -> L3 `1.685`, L4 `1.752`, L5 `1.822 rad/s`), slightly tighter arcs (`1.16 -> 1.00 rad`), **alternating spin directions** (`ring 0: +1`, `ring 1: -1`), no arc drift.
- **Levels 6–10:** **`3` concentric rings**, smooth asymptotic speed growth continuing from Level 5, alternating directions (`+1, -1, +1`), **subtly drifting/breathing target arcs on outer rings** (sinusoidal phase oscillation ±`0.24–0.38 rad` at slow `0.45–0.70 rad/s` + gentle `±8%` breathing on outer ring only, inner rings steady).
- **Levels 11+:** **`3–4` concentric rings** (`3` rings on L11–13, `4` rings on L14+ or deterministic L11+ cadence reaching `4` rings cleanly by L13+), **asymptotic speed cap** (`speed(L) = 3.30 - (3.30 - speed5) * exp(-0.075 * (L - 5))`), target arc width asymptotically floored at `0.46 rad` (`~26.4°`) so every level remains humanly playable and fair.
- Inner rings receive a subtle `+7%` per-ring angular offset (`speed * (1 + 0.07 * ringIndex)`) so smaller inner radii maintain responsive visual pacing.

### Mode & Seed Design
- **Endless Mode (Default):** Advances level-by-level; `currentLevel`, `bestLevel`, and `bestStreak` persist in `localStorage`. Missing on Level `L` resets the current level's rings (`ringIndex = 0`, `streak = 0`) for instant 1-tap retry on Level `L`.
- **Daily Mode (`DAILY` toggle):** Uses UTC date key `YYYY-MM-DD` (via `getDailyDateKey(date)`). Each level `L` derives its deterministic PRNG (`mulberry32(fnv1a32("pulse-ring:" + dateKey + ":level:" + L))`), generating identical arc placements, spin parity, and drift phases for every player worldwide on that date.
  - A Daily run starts at Daily Level 1.
  - Missing ends that Daily run (`MISSED` state), updates `dailyBestLevel` / `dailyBestStreak` in `localStorage`, and reveals a subtle, non-blocking **"Share Result"** copy button in the footer alongside instant 1-tap/`Space` replay from Daily Level 1.
  - Share output format (clean plain text, zero spam):
    ```text
    PULSE RING · Daily YYYY-MM-DD
    Level XX · Streak XX · XX Perfects
    ```

---

## 6. UI States Matrix (`ui-states`)

| State | Visual & Canvas Behavior | Controls & Footer |
|---|---|---|
| **First Use (Level 1)** | Live orbiting orb on outer ring immediately; core displays `(2)`. | Footer shows `"Tap anywhere or press Space to snap inward"`; fades softly after first snap. |
| **Playing** | Active ring bright, inner rings subdued, tapered orb trail, subtle arc breathing (L6+). | Top HUD live; `aria-live` quiet during frames, announces level start only. |
| **Snapping (`140ms`)** | Smooth inward radial glide (instant if `prefers-reduced-motion`), ripple wave (`PERFECT` double wave), chime note. | Buffered extra snap taps ignored for `140ms` to prevent accidental double-fire. |
| **Level Clear (`260ms`)** | Concentric pulse bloom + ascending harmonic chord; smoothly spawns next level rings. | `LEVEL` & `STREAK` update immediately with tabular stability. |
| **Missed (Endless)** | Soft red/coral pulse along missed ring + warm low tone; core holds. | Footer displays `"Missed — tap anywhere or press Space to retry"`. Retry cooldown `160ms` prevents accidental bounce, then 1-tap/`Space` resets level instantly. |
| **Missed (Daily Run)** | Same gentle ring pulse + low tone; Daily run stats locked for summary. | Footer displays `"Daily run · Level XX · Streak XX"` + 1-click `Share Result` button (`e.stopPropagation()`) + `"Tap or Space to run again"`. |
| **Paused (`?` Popover or Hidden Tab)** | Physics `dt` frozen cleanly; orb pauses in place with zero drift. | Closing `?` popover (`Escape`, `?`, button toggle, or backdrop click) restores focus to `?` trigger and resumes. |
| **Clipboard Copy Feedback** | N/A | `Share Result` button transitions to `"Copied"` (`2s`); falls back cleanly to `execCommand` or inline selectable text if Clipboard API is restricted. |
| **Storage Restricted / Offline** | Game runs completely in memory; zero network calls required after load. | Safe `try/catch` around `localStorage` prevents runtime errors in strict private modes. |

---

## 7. Accessibility & Reduced Motion (`fixing-accessibility`)

- **Native Controls:** All top HUD controls (`DAILY`, Sound Mute, Theme, Rules `?`) and `Share Result` are native `<button>` elements with explicit `aria-label`, `aria-pressed` / `aria-expanded`, and minimum `44px × 44px` hit areas.
- **Keyboard Discipline:**
  - `Space` / `Enter` snaps inward (and retries after miss), **except** when focus is inside a button or dialog. Pointer clicks on HUD toggle buttons release focus (`if (e.detail > 0) btn.blur()`) so subsequent `Space` presses play the game instead of toggling Sound/Theme.
  - Global shortcuts (disabled while typing or modifier keys held): `M` (Mute), `T` (Theme), `D` (Daily mode), `?` or `H` (Rules popover), `Escape` (Close popover).
  - Visible `:focus-visible` ring (`2px solid var(--focus-ring)`, `2px` offset) in both themes.
- **Screen Reader Support:** `<canvas>` carries `tabindex="0"`, `role="application"`, and descriptive `aria-label`; a polite `aria-live="polite"` region announces level advances, `PERFECT` snaps (concisely), misses, mode switches, and clipboard copy results.
- **Reduced Motion (`prefers-reduced-motion: reduce`):** Replaces multi-frame particle trails with a clean static orb halo, turns radial ripples into subtle opacity flashes, and eliminates radial snap tween delay without altering game physics fairness.

---

## 8. Procedural Web Audio Architecture

- **Zero Assets:** Built exclusively on `AudioContext` / `webkitAudioContext` oscillators (`sine` + soft `triangle` overtone) with exponential gain envelopes (zero clicks/pops).
- **Safe Unlock:** Lazily instantiated and resumed inside the first `pointerdown` or `keydown` handler.
- **Pentatonic Harmonic Ladder:** C-major / A-minor pentatonic frequencies (`C5, D5, E5, G5, A5, C6, D6, E6`) step upward cleanly with consecutive streak/ring progress; `PERFECT` adds a crisp octave fifth shimmer; `LEVEL_CLEAR` plays a soft ascending two-note fifth/octave chime; `MISS` plays a gentle muffled `180Hz -> 130Hz` sine drop.

---

## 9. Deployment & Repository Layout

```text
pulse-ring/
├── .github/
│   └── workflows/
│       └── pages.yml        # GitHub Actions static Pages deployment
├── docs/
│   └── plan.md              # Implementation plan (writing-plans format)
├── src/
│   ├── audio/
│   │   └── synth.js         # Procedural Web Audio API pentatonic synthesizer
│   ├── game/
│   │   ├── difficulty.js    # Smooth progression curve & level generator
│   │   ├── geometry.js      # Angle normalization & wrap-around arc collision
│   │   ├── state.js         # Pure state transitions & frame-independent loop logic
│   │   └── storage.js       # Safe localStorage wrapper (theme, mute, endless, daily)
│   ├── math/
│   │   └── prng.js          # Deterministic FNV-1a + Mulberry32 & UTC date keys
│   ├── render/
│   │   └── canvas-renderer.js # DPR-aware 2D Canvas renderer & reduced-motion support
│   ├── ui/
│   │   └── hud.js           # Accessible DOM HUD, shortcuts, rules popover, share UI
│   └── main.js              # Entry bootstrap, RAF loop, input wiring
├── styles/
│   └── main.css             # Theme tokens, responsive grid, WCAG focus & motion rules
├── tests/
│   ├── prng.test.js         # Deterministic seed & date key tests
│   ├── geometry.test.js     # Angle wrap-around & hit/perfect/miss tests
│   ├── difficulty.test.js   # Curve monotonicity, alternating spin, drift, speed cap tests
│   └── state.test.js        # State transitions, streak, daily mode & storage tests
├── DESIGN.md
├── README.md
└── index.html
```

All asset references in `index.html`, `styles/main.css`, and `src/` use relative `./` paths for seamless root or subpath (`https://<user>.github.io/pulse-ring/`) hosting on GitHub Pages.
