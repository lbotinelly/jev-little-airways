# How the presentation was made (Dream Loop + two frontier models)

The visual target was never modeled by hand. The workflow:

1. **Lock a target render.** A generated image — "playful snowglobe ATC diorama, golden
   hour, low-poly archipelago, cute little planes" — was chosen as the dream
   (`target-render.png`).

2. **Run the Dream Loop skill with two different frontier models in parallel.**
   Dream Loop hands a subagent the target image plus the current screenshot and asks it
   to close the gap — iterate, screenshot, repeat.

   - **GPT-6 Astra's build** shipped as one self-contained 1.06 MB HTML file (the whole
     app plus three.js r186 as a gzip+base64 module payload — it still runs fully
     offline: see `../../originals/little-airways-astra-single-file.html`). Its
     golden-hour lighting, glass dome, and painterly HUD won on visuals.

   - **GLM 5.3's build** (`glm-round-1/2/3.png`) reached a clean dusk diorama in three
     rounds — the staged "Cessna N42 loses its engine" opening and the tiered
     think-cadence design came from this lineage, and were later harvested into the
     project.

3. **Decompose the winner.** Astra's build was unpacked into editable source (the
   embedded three.js was verified byte-identical to official npm r186 and swapped for a
   CDN import), and the judgment layer was built out on top of the `ask(state,
   questions)` seam its mock already exposed.

## The original prompt

The exact prompt that kicked off the Astra build (verbatim):

> @DreamLoop Build me a graphics demo: a playful low-poly world; procedurally
> generated archipelago, golden-hour light, toy-like charm (match the target image
> provided). Cute little planes fly routes between airports. Click a plane to see its
> "mind" (live probability bars over its current decisions) and inject failures
> (engine, radio, radar, fuel leak, hydraulics) that ripple visibly through the world:
> maydays, attention rings, nearby planes reacting and diverting. A communication log
> narrates it all; bigger maps have more airports. Route every decision through a mock
> ask(state, questions) module shaped like a real API (typed questions in,
> probabilities + confidence out) so a real decision-model API can swap in later.
> Three.js in browser, >60fps, single index.html, no build step. Ideate freely on the
> art, names, and little delights.

Two lines in there did the heavy lifting: *"route every decision through a mock
ask(state, questions) module shaped like a real API"* — the seam that let Jev drop in
weeks later without touching the world — and *"ideate freely on the art, names, and
little delights"*, which is where "A pocketful of sunshine" and "Kettle on" came from.

The rest — runway occupancy, tower sequencing, takeoff rolls, the Jev monitor — grew
from living with the demo.
