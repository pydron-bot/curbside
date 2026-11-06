# Controls

| | Keyboard & mouse | Touch | Gamepad |
|---|---|---|---|
| Walk / run (on foot) | WASD / arrows, Shift sprints | left stick (appears under the thumb): push further to run | left stick, A sprints |
| Aim (on foot) | mouse (crosshair cursor) | right half: drag the aim stick | right stick |
| Punch / fire (hold for SMG) | left click, Space / J | FIRE button; push the aim stick past half-way; tap the right half | RT or X |
| Throw a grenade / molotov | aim with the mouse (it lands at the cursor), click | drag the aim stick (further = further, full push = full range) and let go; or FIRE | right stick, RT / X |
| Drive-by (pistol / SMG) | left click / J in a car | car FIRE button (inboard of the pedals) | X |
| A stolen service vehicle's tool: hose (fire truck, hold; aim with the mouse), chime (ice cream van), winch (tow truck) | left click / J (instead of the drive-by) | the car FIRE button becomes HOSE / CHIME / WINCH; drag it to aim the hose | X (right stick aims the hose) |
| Switch weapon (also in a car) | wheel, right click, Q / Tab (Shift+Tab back) | ⇄ | RB / LB |
| Set off sticky charges (on foot or in a car, only in play) | G | BOOM (shows while a charge is out) | D-pad down |
| Enter / exit car | E / F / Enter | door button (pulses next to a car) | Y |
| Steer | A/D, ←/→ | **Point** (default): stick = where to go, push further = more gas; **Classic**: stick left/right | left stick |
| Gas / brake-reverse | W/S, ↑/↓ | pedal pad: GAS / BRAKE — slide between them without lifting | RT / LT |
| Handbrake (+ gas from a stop: burnout) | Space | HAND, or the DRIFT band (GAS + HAND with one thumb) | A |
| Nitro | Shift in a car | NOS (fills the button) | B |
| Pause | P / Esc | ❚❚ top centre (also automatic on app switch / portrait) | Start (B resumes) |
| Menus | arrows + Enter, Esc / Backspace back | tap | D-pad / left stick + A, B back |
| Next radio station | R | tap the "now playing" card (it shows as a chase comes in: tap it for the radio) | Select / View |

OBSERVE (on the title and in the pause menu, once the cold open has run or
with Test tools on) is a free camera over the city with no player: its
controls are under [*UI → Observe mode*](ui.md).

Settings (title or pause menu): master / effects / music volume, sound with
the iPhone silent switch on, graphics quality, touch steering
(point / classic), left-handed layout (mirrors the controls and the HUD),
perf overlay (Off / FPS / Full); under TESTING, Test tools (TEST in the
pause menu, below). In the
header, VERSION HISTORY: every release from `core/changelog.ts`, newest
first (the version also shows top right on the title screen and on the
pause card), and STORY · REPLAY OPENING: a fresh run straight into the
cold open (`SettingsPanel.addLink`; in a run it asks TAP AGAIN first,
since it throws the run away). Playtest labels over what the city's people and cars are
doing: `settings.debugLabels`, Shift+L (see [*City life*](city-life.md)).

**TEST menu** (Settings → Test tools; `game/testTools.ts` the actions,
`ui/testMenu.ts` the sheet, `ui/teleportMap.ts` the map): a TEST chip in
the pause card's corner (it costs the card no row) opens a tabbed sheet of
big buttons, keyboard / pad navigable, Back to the pause menu, ▶ to play.
Each button acts at once and says what it did (a strip on the sheet and the
HUD feed). PLAYER: god mode (hits land but take no health, the police never
cuff you, the heart turns gold; it moved here from Settings, same
`settings.godMode`), heal and full armour, every weapon full, wanted 0–5,
clear. CARS: spawn any of the 19 vehicles beside you (on the nearest lane;
GET IN puts you in it), repair the car you're in, flip / unstick (onto the
nearest clear lane). WORLD: dawn / noon / golden hour / dusk / midnight,
freeze the clock, rain on / off / auto (at once, not over the ramp), slow
motion 0.25× / 0.5× / 1× (it scales the sim's time like a hit-stop, people,
pigeons and combat effects with it; the camera and audio keep real time),
LABELS (`settings.debugLabels`). LOOK: opens the look tuning panel over
live play ([*Look → Tuning*](look.md)). MAP: the whole city (the radar's
drawing); tap a spot to go to the nearest road or pavement there (with the
car: the nearer lane, facing its traffic, out of the junction), or SAFEHOUSE,
HOSPITAL, NEON MILE, DOCKS. SCENES: start any city scene near you now (the
scenes' `force()` / `begin()` / `soon()`; the fire blows up a car 11–24 m
off and calls the truck; the tow leaves a car for the truck; DOGS CHASE A
RUNNER sets a passer-by running past a dog or two; RAIN CROWD turns the
rain on; TURF WAR still waits for its holds). The starting is
`game/sceneStarter.ts` (`SceneStarter.start(id, x, z, heading)`), shared
with the title's highlights. SAVE: +1 CRED
level, max perks, reset CRED, +$10,000, unlock all jobs, jump to any story
job, grouped by arc and chapter (it becomes its arc's next job; you land
by its payphone, and the clock jumps to 21:00 for a Night Shift job by day), opening done /
reset (the next PLAY has the cold open), reset the save, export (share sheet, else clipboard) and import (a
pasted save, sanitised like a loaded one: `migrateSave`, `pruneSave`);
reset and import write the save and reload. Destructive ones take a second
press. Anything but LABELS and EXPORT is a cheat: `player.markCheated()`
taints the life like god mode (`Player.tainted`: CredKeeper pays no CRED,
no free-roam or Chaos Run best or medal), a TEST tag shows by the heart, and
respawning clears it (slow motion or god mode left on taint the next life
too). Turning Test tools off turns god mode and slow motion off. Pure and
tested: `game/testSpots.ts` (teleport snapping, spawn spots), `game/saveTools.ts`
(the save edits, export / import). Nothing drawn in normal play: the
spawned cars and scenes are the usual batches.

**Touch tuning** (for the device session): with the Perf overlay on (or
`?debug`), pause → DIAGNOSTICS → TOUCH TUNING has −/+ steppers for stick
radius, point-to-steer gain and deadzone, classic steer deadzone and expo,
drive / walk / aim deadzones, aim radius, pedal reach and pedal size, and
RESET (`core/touchTuning.ts`, `ui/tuningProbe.ts`). Changes apply at once
(resume and drive, pause and adjust) and are saved in `curbside.tune`;
every value is clamped to a range. Tuning applies only while the overlay is
on: turn it off and the shipped feel is back. The report's `TUNE` line and
`tune` JSON list the values that differ from the defaults, the numbers to
bake in as new constants.

**Perf log** (`ui/diagnostics.ts`, `core/sessionLog.ts`): every 10 s
(every 2 s for the first 30 s, the start-up) the session log samples frame times, tier, ratio and draw calls, and `n`: what
was on screen (`core/sceneCounts.ts`, filled by `render/sceneCensus.ts`
from counters the pools and batches already keep): live fire / smoke
particles, big ones (over 2.5 m) and their **fill** (quad area over the
visible ground, nearer the camera counting bigger: screens of overdraw),
glows drawn and their fill, fires (in view / burning), burning cars,
explosions in the last 10 s, rubble drawn / live, people and cars drawn /
shown, and the city scenes running by kind. Frames are also judged in 1 s
windows: one whose p95 is over 25 ms logs a **dip** with the same counts
and the window's JS p95 (`js`: high means the main thread was the
bottleneck, low the GPU or the browser; at most one per 5 s; the newest 60
kept in `dips`), so a drop names what was on screen. The frame that spans
an app switch (any `visibilitychange`) is kept out of the dips and the
frame stats. Each model file logs an `asset` event as it arrives, and
holds dynamic resolution off for 2 s (its uploads and first draws). The Full overlay shows the counts on two more lines
(`fx hot/soft big fill · glow n (fill) · fire seen/all burn boom`,
`ppl · cars · scenes`), the Diagnostics summary an `ON SCREEN` line and the
recent dips. Nothing is allocated per frame. The **tail** (`tail p50/p95`
in the Full overlay, `tailP50` / `tailP95` in samples) is the browser's
own work after the frame's JS: a message posted at the end of each frame
lands once style, layout and the compositing commit are done (in Safari
the commit hands the WebGL frame to the GPU process). Frame interval −
JS − tail is time spent waiting: a high tail with low JS points at the
browser or the GPU process, a low one at the GPU itself or a cap. The
overlay's `30 Hz (Low Power Mode?)` shows when the fastest 5% of frames
sit at ~33 ms, however many miss a tick.

**GPU breakdown** (Diagnostics → GPU BREAKDOWN → RUN; `core/gpuBreakdown.ts`,
`ui/gpuProbe.ts`, `render/gpuLayers.ts`): Safari has no GPU timer, so with
the game paused the frozen scene is drawn again and again and each frame is
waited for (a 1-pixel `readPixels`): everything, then each part left out in
turn (sun shadow pass, buildings, ground, props and trees, people and
birds, cars, glows, fire/smoke/rain, contact shadows, rubble, everything
else; then half the pixels, then nothing at all), then everything again to
show drift as the phone warms. 6 warm-up and 20 measured frames a step,
about 15 s. Each part's cost is the full frame's median minus the median
with it left out. Parts are found by their objects' names (`layerOf`) and
hidden with an empty layer mask (the batches rewrite `visible` every
frame); lights are never touched, so nothing recompiles; half the pixels
goes through `DynamicResolution.probeScale`. The result goes into the
report (`gpuBreakdown`, and its lines in the summary). Pause on the busy
moment you want measured; closing the sheet stops a run and puts
everything back.

**Low Power tests** (Diagnostics → LOW POWER TESTS; `core/perfTests.ts`,
`ui/perfTestProbe.ts`): three switches, each taking away one kind of
processor work, to find what iOS Low Power Mode is short of (the GPU
breakdown showed the graphics chip isn't: 11–14 ms a busy frame there).
SIM 1 STEP caps the fixed 60 Hz sim at one step a frame (`FixedStep.
maxStepsPerFrame`; at 30 fps it plays in slow motion, physics untouched,
the sim's cost per frame halved); CROWD ½ and TRAFFIC ½ halve the
population's targets (and the city's traffic scale), thinning as people
and cars leave range. Saved in `curbside.perftests` until switched off
(read before the first street is filled, so a relaunch starts thinned);
each change is a `perftests` event in the session log, the overlay says
`TEST …`, the report carries `perfTests`.

**Report bug** (`ui/bugReport.ts`): with test tools on
(`settings.testTools`), the Perf overlay on or `?debug`, a bug button sits
in the pause card's top corner (the Diagnostics sheet has a REPORT BUG tab
too). It captures the moment: the game view (one frame rendered through
`Look` and copied in the same task, 960 px wide JPEG; no
`preserveDrawingBuffer`), position, heading, vehicle, health, wanted level,
time of day, weather, tier and activity, the on-screen counts, the last
30 s of bus events (a preallocated 600-slot ring, `core/eventTrail.ts`,
rows `[secondsAgo, type, x, z, value, word, byPlayer]`) and the whole
Diagnostics report. Type a note, then SHARE: the JPEG and a JSON file go
to the share sheet (`navigator.share` with files; `.txt` if JSON is
refused). Cancelling is just noted; no share API or a refusal saves both
files instead; COPY copies the JSON. The smoke test runs the flow with the
share sheet mocked.
