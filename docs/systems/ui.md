# UI

Plain DOM over the canvas, one stylesheet per area (`tokens.css` for the
shared palette and safe-area edges, `title.css`, `menu.css`, `hud.css`,
`radar.css`, `touch.css`). `FrontDoor` (`src/ui/frontDoor.ts`) owns the
flow between title, pause, settings, how-to, rotate and countdown and
routes keyboard / gamepad navigation (`Input.consumeNav`) to whichever
screen is on top; `main.ts` hands it a few hooks. The HUD only writes to
the DOM what changed since the last frame; nothing in the per-frame paths
allocates.

Buttons act on taps, not clicks. A browser only makes a click from a lone
finger, and in play a thumb is nearly always on the stick or the pedals, so
`onTap(el, fn)` (`src/ui/tap.ts`; the decision, `tapTracker.ts`, is
unit-tested) judges touch and pen presses from pointer events: lifted within
14 px of where it landed, within 1.5 s, still over the button, its list not
scrolling (nor flung just before). `fn` runs in the touchend that follows (a
user gesture on every engine) and that touchend is cancelled, so no click
acts twice or lands on whatever the tap uncovered. With several fingers on
buttons the first to lift as a tap acts and the rest lift as nothing; a lone
finger held longer than 1.5 s is left to the browser's click, as before.
Mouse, keyboard and VoiceOver still arrive as click. `onTap` drops focus
before `fn` (so Enter can't click a mouse-focused button as well).
`MenuNav.add` uses it for every item; a new one-off button should too, never
a bare `click` listener.

Top centre on a phone holds one thing at a time: the radio's NOW PLAYING
card (`radioToast.ts`, `audio.css`) sits under the pause button, and the
activity card, stars and stamp step down by its measured height
(`--radio-step` on `body`, set when it shows); under a job card
(`body[data-activity]`) it shrinks to one line, the station. A mission's
new objective (`#act-banner[data-tone='info']`) rises into the card and
fades after 1.2 s rather than sitting over the car. `smoke.mjs`
`radioCheck` holds this.

Safe areas come from `env(safe-area-inset-*)` through `--safe-t/r/b/l` on
`:root`; a test can override those to emulate a notched phone
(`safeArea.ts` reads them back for JS layout). The touch layout is checked
at 852×393 and 852×340 (Safari's toolbar showing).

API for other systems:

```ts
// Look
look.time.set(22); look.time.speed = 0   // pin the clock (missions); speed is game hours per second
look.time.hour                           // current hour, 0..24
look.cars.setSiren(vehicle, on)          // police light bar + red/blue wash on the road
look.lighting.sky                        // current SkyState (night, exposure, ...)
worldUniforms.uWetness.value = 0..1      // wet roads (shaderLib.ts)
look.exposureBoost = 1.8                 // flash multiplier on the sky's exposure (ease it back to 1 yourself)
look.addGlowSource((glows, view) => …)   // add faked lights each frame: glows.addFlat / addUpright (glowSprites.ts)

// UI
frontDoor.title.addMode({ id, label, sub?, onSelect })   // a mode under PLAY (e.g. CHAOS RUN); removeMode(id).
                                                         // Picking it starts a fresh run like PLAY, then calls
                                                         // onSelect() to set the mode up on top of it.
frontDoor.play(mode?)                                    // the PLAY path itself (closes the title, fresh run)
onTap(el, fn, { clickOnly? })                            // a button that works with a thumb on the stick (tap.ts)
radar.setBlip(id, { x, z, kind?, colour?, icon?, pulse?, edgeArrow?, size? })
radar.removeBlip(id)
radar.setWaypoint(x, z) / radar.clearWaypoint()          // route along the roads + rim arrow when off-radar
hud.score.notice(text, kind?)                            // a feed line without points
scanner.setEnabled(on)                                   // the police scanner's lines and pings (City life, Police scanner)
haptics.pulse(strength0to1, ms)                          // also fired by crash / explosion / shot / hurt events;
                                                         // haptics.enabled is off behind the title
```

Kinds: `objective`, `enemy`, `police`, `pickup`, `friend`, `shop`, `race`,
`marker` (each has a default colour).

**Title highlights** (`game/attractHighlights.ts`; when and which is
`ui/attractShow.ts`, pure and tested; the camera is `ui/titleCamera.ts`).
Behind the title the camera cruises after traffic (`ui/attract.ts`); after
10–14 s, then every 15–25 s of cruising, it cuts to something happening:
a police chase (the getaway; a scooter one in four), a street race (the
leader, then the winner), a car fire and its truck (framed together as the
truck comes in), a turf war, an accident and the argument, the ice cream
van and its queue, a bus pulling in at a stop, a busker and the crowd, a
mugging (the mugger), stray dogs after a runner. A shuffled round, never the
same twice running. The scene is started round the camera with the TEST
menu's `SceneStarter`; `CityLife.featured` lifts its holds (the title, the
cold open) and its people gather (`lively`), every other scene
stays held, so there's one at a time. It's followed through its
`subject()` until that says it's over (then 3 s more) or for 25–40 s; one
with nothing to show 8 s after starting, or that won't start, is skipped
for the next (four refusals in a row: cruise again). Close by and on
screen the camera glides over; otherwise the city fades out over 0.3 s
(`.title-fade`, under the menu), the camera jumps and the streets are
filled round it, and it fades back in over 0.5 s. A caption fades in for
~4.5 s under the version, top right (`POLICE CHASE` / `NEON MILE`: the
district). A scene the show moved on from is reset once out of view (or
after 30 s); the fire, the turf war and the dogs wind down by themselves.
Highlights start only with the title open (not under Settings or How to
play). PLAY stops the show, clears `featured` and resets every scene with
the run (no title actors, no stars).
**Framing:** what the camera follows sits in the middle of the free area
right of the menu column, not the screen centre: `TitleScreen.menuRight`
(`.title-main`'s right edge in px, measured by a ResizeObserver, never per
frame) → half of it in px (`freeCentreOffsetPx`, capped at 70% of the width)
→ ground metres through the rig's camera (`groundPerPx`: height, tilt, FOV,
aspect; exact on the ground line through the look point, checked against the
projection at 852×393, 852×340, 1280×720 and 1920×1080) taken off the
camera's x, eased (`TitleFraming`, 2.5/s) as the layout changes or the
title closes. A gentler look-ahead behind the title (`LEAD_ATTRACT`; FxDirector
only sets the lead in play) and no lead of the attract camera's own on a
highlight keep a racer at 30 m/s in that area on a 340 px-high screen; in
play the rig is as before.

```ts
__ub.highlights.show.phase / .current   // 'cruise' | 'cue' | 'watch' | 'linger'; the highlight id
__ub.highlights.show.timing             // SHOW_TIMING: cruise, first, settle, watch, linger, tries (mutable for a test)
```

## Observe mode

OBSERVE (`ui/observeMode.ts`; the pure logic is `game/observe.ts`, tested
in `tests/observe.test.ts`) hands you the camera over the live city with
no player: no HUD, radar, score, stars or touch controls
(`body[data-scene='observe']`). It's on the title beside CHAOS RUN
(`TitleScreen.addEntry`: laid out like a mode, starts no run) and in the
pause menu (`PauseOverlay.addButton`), both once the cold open has run or
whenever Test tools are on (`ObserveDeps.offered`, from
`ProgressDirector.offer`).

| | Keyboard & mouse | Touch | Gamepad |
|---|---|---|---|
| Pan | WASD / arrows, or drag | one-finger drag | left stick |
| Zoom | wheel, Z / X (or + / −) | pinch | right stick up / down |
| Rotate | Q / E | two-finger twist | right stick left / right |
| Follow a car or person | click it; F or Enter: what's in the middle | tap it | A: what's in the middle |
| Next incident / start one / time / rain | N / I / T / U | the strip | Y / X / RB / LB |
| Leave | Esc, or EXIT | EXIT | B or Start |

**Camera.** `ObserveCamera` holds where it looks, its height and its yaw
(`CameraRig.yaw` turns the view; 0, as in play, keeps screen-up along
world −Z). A held pan eases to a speed of 0.9 m/s per m of height, at most
70 m/s (the streets fill round the camera at that pace); a drag keeps the
ground under the finger (`groundPerPx`); wheel and pinch zoom by a factor.
Every frame it's clamped: the focus stays over the city (±`HALF_EXTENT`),
the height between 12 m over open street and the tier's cap, and 8 m over
the tallest roof within 14 m of where the camera itself is (behind the
look point by its tilt, a little ahead of a pan: `roofFloor`). The rig
eases to it with no look-ahead and a quicker zoom (7/s); over 46 m
`Look.fogPush` pushes the fog out by the difference so the streets stay as
clear as from play height.

**Zoom-out per tier** (`OBSERVE_MAX_HEIGHT`): high 150 m, medium 130 m, low
100 m. Draw calls grow slowly with height; what bounds it is the streets
(the crowd lives within 60 m of the focus, traffic within 160 m) and the
phone's fill. Measured (SwiftShader, a fire and a chase on, worst of noon,
22:00 and 03:00, rotated 0° and 45°): `medium` at 852×393 peaks at 84 draw
calls at 130 m (81 at 110 m), `high` at 1280×720 at 108 at 150 m. The
smoke test checks the widest zoom, turned 45°, on every profile.

**The city lives with nobody playing.** The attract camera stands in as the
focus (`attract.active`: heat, combat, the crowd's target, stamps and the
marker all see "not playing") and is moved with this camera
(`attract.jump`), so Population, the scenes, `simLod`, the sound and the
pigeons work round where you look. `CityLifeDeps.observing` makes
`CityLife.live` true: no title, tutorial or activity holds, nor stars, and
people gather (`lively`) and fights, muggings, the food carts' rushes and
the ambulances' patients start as in play; anything that waits on the
player (`d.playing()`: handing a bag back, the film shoot made real, turf
on you) stays off. Over 64 m, `Population.maintain` keeps its spawns out
of a view shrunk about the focus to what 64 m sees (`spawnShield`,
`MaintainContext.spawnView`), not all of it: from high up the spawn rings
lie inside the view and the streets would empty (someone may appear at the
far edge, a few pixels tall). Nothing vanishes inside the real view. After
a long pan (over 110 m), once the camera slows, the streets are filled
round it (`maintainPopulation(true)`).

**Follow.** A tap or click (under 10 px and 450 ms) picks the car or person
under it (`pickFollow`: footprint plus a slop that grows with the zoom,
nearest edge first, a person over a car about as near); the camera rides
along (velocity fed forward, the gap closed, up to 80 m/s) until you pan
or drag, or it's recycled. NEXT INCIDENT visits the running scenes with a
`subject()` in turn (`nextLive`) and follows it: close and on screen it
glides, otherwise it fades across like the title's cut (0.3 s out, jump,
streets filled, 0.5 s in) with a caption (`POLICE CHASE` / `NEON MILE`).
Nothing on: it starts one of the title's highlights near the camera (its
hours kept), as the show would.

**Start.** START opens a palette of every city scene (the TEST menu's
`SCENES` but rain, the V2 incidents included), started round the camera
with `SceneStarter.start` like the TEST menu but with no test tools and no
taint. A scene with a subject is followed into view (one that has nothing
to show yet, a turf war gathering or a fight squaring up, is waited on for
up to 10 s); the ambulance, the alarm and the food carts happen round the
point. Some need the spot (an accident wants two cars close, a bus a
shelter near), as in the TEST menu. TIME moves the day on to the next of
dawn, noon, golden hour, dusk, night and the small hours (`nextHour`);
RAIN starts or stops a shower at once (for 10 minutes, then the weather's
own cycle).

**No UI in the way.** One strip (EXIT, NEXT INCIDENT, FOLLOW / LET GO,
START, TIME, RAIN), key or pad hints under it, a result line over it; it
fades after 4 s without input (`IdleFade`; not while the palette is open)
and comes back on any key, mouse move, touch or stick. The district's
name shows top right as you cross into it. Labels hide under 700 px wide,
the hints at 340 px high.

**Leaving** (EXIT, Esc, Start or B: `ObserveMode` is a sheet on FrontDoor's
stack, the palette over it) restores what you came from. From the title:
its camera and show start again where you are, its menu opens. From a
paused run: the run was held all along. `holdsRun` makes main.ts skip
heat, score, stunts, nitro, the activity's clocks (`progress.step`,
`simScale`) and the player's own step and collisions, and treat the
player's car, the activity's cars, the police units' cars and any road
rager after the player as held (`held(v)`): not driven, not hit, not hurt,
put back where they were each step. On the way out each held car's state
and damage, the player on foot, the hour and the weather are put back as
they were on the way in, the streets are filled round the player, the
camera snaps back to its spot and height, and the pause menu is up again.
An app switch while observing doesn't pause (nothing to lose; from the
title it's also a safe point for an app update).

```ts
__ub.observe.enterFromTitle() / .enterFromRun() / .exit()
__ub.observe.cam                          // ObserveCamera: x, z, height, yaw (clamped every frame)
__ub.observe.next() / .spawn(sceneId) / .nudgeTime() / .toggleRain()
__ub.observe.active / .holdsRun / .held(vehicle)
```
