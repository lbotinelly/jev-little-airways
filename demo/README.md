# Little Airways — Golden Hour (decomposed source)

A miniature island world, little planes, and a sky full of decisions. Originally
built as a single packed HTML by another agent; decomposed here into editable
source files with three.js loaded from CDN. Behavior is unchanged — same seed,
same simulation, same visuals (verified side-by-side against the packed original).

## Files

| File | Role |
|---|---|
| `index.html` | Shell: DOM, CSS, accessibility controls, import map, module entry, `#api-panel` dialog |
| `server.mjs` | Dev server: static files + `POST /jev` proxy to api.typesafe.ai (no localhost CORS there) |
| `js/browser.mjs` | Entry point — DOM events, wall clock, `LittleAirways` + `__chatDreamLoop` public APIs, API-panel wiring |
| `js/world.mjs` | Scene generation, flight simulation, `DecisionClient` (the `ask(state, questions)` judgment boundary) + `mockAsk` provider |
| `js/hud.mjs` | In-scene 2D HUD painter (immediate-mode geometry + bitmap font, region hit-testing) |
| `js/jev-monitor.mjs` | Jev data monitor drawer (`J` / JEV DATA button): live decisions grid + every exchange in Jev API format |
| `js/jev-provider.mjs` | Live decision provider: little-airways.ask.v1 ↔ TypeSafe/Jev `choice` questions via `/jev`; exports `toJevRequest` |
| `js/font-atlas.mjs` | Embedded bitmap font atlas (the one asset that stays local) |

three.js **r186** (`three/webgpu`, `three/tsl`) is pinned from cdn.jsdelivr.net
via the import map in `index.html`. The embedded builds in the original pack
were byte-identical to the official npm r186 files, so this is a pure swap.

## Run

With the proxy (needed for live Jev; also fine for mock):

```
node server.mjs          # http://localhost:8765  (optional port arg)
```

Mock-only works on any static server that types `.mjs` as `text/javascript`
(Python 3.12+ `http.server` does). URL params: `?size=small|medium|large` and
`?seed=<uint32>` reproduce any world.

## Controls

Keys 1–5 toggle engine / radio / radar / fuel leak / hydraulics failures on the
selected plane · R restores · Space pauses · 1×/2×/4× speed · Tab cycles planes ·
J toggles the Jev monitor · H help · C hides UI · Home resets camera · drag
orbits · wheel zooms.

## Simulation notes (tuned 2026-09-17)

- **Fuel leaks bite**: drain scales with severity (≈0.9 %/s at full severity —
  roughly 1–2 minutes of fuel from a healthy tank). The decision state carries
  the estimates that trigger choices: `fuel` (fraction),
  `fuelMinutesRemaining` (M), `destinationMinutesRemaining` (O), and
  `minutesToReach` per airport — so "can I make it?" is a direct M-vs-O
  comparison for both the mock and live Jev.
- **Airliners fly long haul**: destination questions state the policy
  (airliners take the long legs between majors, light aircraft hop nearby),
  and the mock scores for ~80% of the longest available leg vs ~25% for props.
  Observed on seed 42042: jets avg 55 units vs props 20.
- **Runways are real**: approaches are shaped to cross the runway threshold
  already aligned (into wind where possible), planes decelerate during rollout
  on the runway surface, and departures accelerate along the runway before
  climbing out. Only one aircraft may occupy a runway at a time: on final,
  planes request a slot; if it's taken they join a holding pattern, and when
  two or more are waiting the tower asks a `landing_order` question through
  the same ask() boundary (mock: emergencies and low fuel first; live: Jev
  decides). A short-final guard sends a plane around if the slot changes hands
  underneath it. Verified: 0 simultaneous-occupancy violations across 4×-speed
  stress runs with four planes converged on one airport.
- **Departures are proper**: after their rest, aircraft taxi through a 180° turn
  and take off in the opposite direction of landing, rolling about half the
  runway (speed ramps from taxi to cruise) before lifting off near the far end.
- **Questions are asked well when it matters**: when a mayday is nearby, the
  traffic-response question switches to an operational prompt ("another aircraft
  has priority…") with criteria that explain what each option does. Measured on
  live Jev: same conflicting-arrival state, terse labels → give-way 0.46 vs
  maintain 0.41 (a coin flip); operational criteria → give-way 0.70 / maintain
  0.05. When paths don't conflict — or the healthy plane will be on the ground
  first — Jev correctly maintains. Display labels stay short; only the model
  sees the long form.

## Swapping the decision provider (the Jev seam)

Every discretionary choice goes through a validated, versioned contract
(`little-airways.ask.v1`): categorical/boolean questions in; probabilities that
must sum to 1, a confidence in [0,1], and `factors: string[]` out.

**From the UI:** click **MOCK / API** in the left rail → paste your key
(`console.typesafe.ai/keys`) → **Fly on Jev**. The key is stored only in this
browser's localStorage and sent only to your local proxy; **Use mock** switches
back (the key stays stored so you can flip again). The panel shows live call,
error, token, and latency counts. Booleans map to Jev `choice` true/false so
every answer carries real probabilities and confidence; `factors` are honest
state facts generated locally (Jev has no factors field).

**From the console:**

```js
LittleAirways.connectJev('apikey_…')   // switch to live Jev
LittleAirways.restoreMock()            // back to the mock
LittleAirways.clearJevKey()            // remove the stored key
LittleAirways.setDecisionProvider(fn)  // any custom provider
```

`LittleAirways.exportState()` downloads `{request: {state, questions}, response}`
pairs — ready-made fixtures for testing a real provider offline.

**Jev monitor** (`J`, or the JEV DATA rail button): a drawer with a decisions
grid (every plane's current choice, confidence, mayday/traffic/approach state)
and a live feed of every `ask()` exchange rendered as raw Jev JSON — request
`{state, model, questions}` and response `{answers, usage}` — with latency,
token counts, and a running cost estimate. Click a plane card to filter the
feed to that aircraft. Mock exchanges are reshaped into Jev format and labeled.

Observed live (2026-09-17): jev-1.13.0 via the proxy at ~160–185 ms per call,
4 questions batched per plane per 1.6 s think; a long session's Jev traffic ran
with 0 errors. Cost at $0.042/MTok input + free output ≈ a few cents per
10-minute session at the default 9-plane world.

## Provenance

- Original packed single-file build (gzip+base64 module payload, offline):
  `../archive/little-airways-packed-original.html`
- The previous independently built diorama (superseded, kept for harvesting):
  `../archive/zcode-diorama-round3.html`
