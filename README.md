# Little Airways 🛩️

**A toy archipelago where the planes actually think.**

A show-and-tell capability study for [Jev](https://typesafe.ai), TypeSafe's System One
decision model — built the way modern demos get built: **visuals by GPT-6 Astra** through
the [Dream Loop](#how-the-presentation-was-made) skill, **simulation and ATC logic by
GLM 5.3**, and **every in-flight judgment made live by Jev**: divert or continue, declare
an emergency or keep it routine, give way, hold, even *who lands first* when two aircraft
want the same runway.

> Each airplane only has information about itself and its surroundings (plus nearby
> traffic) — and all decisions come back from the model as typed probabilities with
> calibrated confidence, in about 150 ms.

![Little Airways flying on live Jev](resources/screenshots/jev-demo.mp4)

---

## What you're looking at

A golden-hour island world in a glass dome. Airliners fly the long legs between major
airports; little props hop between nearby strips. Every ~1.6 s, each aircraft asks the
model four questions in one batched request:

| Question | Options |
|---|---|
| **route** | continue / divert to *airport* / hold |
| **broadcast** | declare an emergency? |
| **response** | maintain / give way / relay the mayday / hold / divert |
| **clearance** | approach / go around |

When an aircraft can't reach its destination, or planes queue for one runway, the
decisions follow — no scripts, no behavior trees. The tower asks the model to sequence
landings (`landing_order`); the fuel-leak drama plays out because the state carries
honest estimates: `fuel`, `fuelMinutesRemaining`, `destinationMinutesRemaining`, and
`minutesToReach` per airport — "can I make it?" is a one-line comparison the model makes
itself.

Press **J** and the **Jev monitor** opens: every plane's current decision, and every
request/response rendered as raw Jev API JSON (`{state, model, questions}` →
`{answers, usage}`) with latency, token counts, and a running cost estimate. Pause the
feed and read at your leisure.

## The interesting bits (what we learned)

These are small experiments, but they're the reason this repo exists.

**1. Ask the question well.** With terse option labels, live Jev barely committed to
giving way for a conflicting emergency arrival — 0.46 give-way vs 0.41 maintain, a coin
flip. Same state, same model, operationally-worded criteria ("climb or offset now so the
emergency aircraft has a clear approach") → **0.70 give-way / 0.05 maintain**. The
judgment was always there; the question wasn't. (The demo now switches to the rich
wording automatically whenever a mayday is nearby.)

**2. Decisions need estimates, not raw data.** An early version sent `faults.fuel: 0.83`
and a fuel percentage. The model correctly answered "keep cruising" — it had no idea the
tank would be empty in ninety seconds. Sending comparable time estimates (fuel vs ETA)
is what makes the drama findable.

**3. Safety invariants in code, judgment in the model.** Only one aircraft may occupy a
runway — enforced deterministically by the simulation (slot requests, holds, a
short-final go-around guard). *Which* waiting aircraft lands first is a judgment — and
that's the model's call, with fuel and emergency state in view. Verified: zero
simultaneous-occupancy violations across 4×-speed stress runs with four planes converged
on one airport.

**4. Calibrated confidence is visible.** A Cessna with a rough engine and comfortable
fuel asked "declare an emergency?" got 52/48 at **confidence 0.04** — the model saying
"I genuinely don't know" — while the divert question next to it sat at a decisive 0.99.
That honesty is the product pitch, and the demo makes it legible.

**5. The economics are silly.** At $0.042/MTok input (output tokens free), an evening of
nine planes thinking is single-digit cents. The monitor shows the meter running.

## How the presentation was made

The world wasn't hand-modeled — it was dreamt:

1. **Target render.** A generated "playful snowglobe ATC diorama" image was locked as
   the target (`resources/dream-loop/target-render.png`).
2. **Dream Loop, two agents.** The [Dream Loop](https://github.com/agents/skills) skill
   orchestrates subagents to iterate a live build toward the target render. GPT-6 Astra
   ran it and produced the single-file build you can still run offline
   (`originals/little-airways-astra-single-file.html`). In parallel, GLM 5.3 ran its own
   three rounds (`resources/dream-loop/glm-round-*.png`) — Astra's won on visuals, and
   its build became the demo.
3. **Decomposed and wired.** The winning build was unpacked into editable source
   (`demo/`), three.js moved to CDN, and the judgment layer built out: the validated
   `ask(state, questions)` boundary, the Jev provider, the tower logic, runway-aware
   ground movement, and the monitor.

The prompts and round-by-round renders are in `resources/dream-loop/`.

## Run it

```bash
cd demo
node server.mjs          # http://localhost:8765  (any recent Node; no dependencies)
```

The server also proxies `POST /jev` to `api.typesafe.ai` — the API allows no localhost
CORS origins, and keys belong server-side anyway. On Windows, `start.bat` / `stop.bat`
at the repo root do the same.

**It boots in mock mode** — a hand-tuned stand-in provider, no key needed. To fly on
real Jev: click **MOCK / API**, paste a key from
[console.typesafe.ai/keys](https://console.typesafe.ai/keys), hit **Fly on Jev**. The
key lives only in your browser's localStorage and only travels to your local proxy.

| Key | Action |
|---|---|
| **1–5** | toggle engine / radio / radar / fuel leak / hydraulics failures |
| **R** | restore the selected aircraft |
| **J** | Jev data monitor (pause it to read) |
| **Space / speed** | pause time / 1× 2× 4× |
| **Tab** | cycle aircraft |
| **drag / wheel** | orbit / zoom the snowglobe |
| **H / C / Home** | help / hide UI / reset camera |

Deep-dive docs: [`demo/README.md`](demo/README.md). Capability research that started all
this: [`research/jev-typesafe-dossier.md`](research/jev-typesafe-dossier.md).

## Repo layout

```
demo/         the runnable demo (three.js WebGPU via CDN, zero build step)
research/     the Jev capability dossier (live-captured API behavior, pricing, patterns)
resources/    dream-loop artifacts (target, prompts, rounds) and screenshots
originals/    the Astra single-file build (fully offline) and the GLM round-3 build
```

## Credits & license

- **Visuals:** GPT-6 Astra, via the Dream Loop skill (original single-file build in
  `originals/`).
- **Simulation, ATC logic, Jev wiring, monitor:** GLM 5.3 (ZCode).
- **Judgment:** Jev (`jev-1.13.0` at time of recording), by [TypeSafe AI](https://typesafe.ai).
- **three.js** r186, MIT, loaded from CDN inside the demo.

Demo code: MIT (see `LICENSE`). This is an independent community project — not
affiliated with or endorsed by TypeSafe AI. Jev access was via their early access
program; availability, pricing, and behavior described here are as observed in
September 2026.
