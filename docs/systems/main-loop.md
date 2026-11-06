# Main loop and wiring

`src/main.ts` builds every system, wires them together, and runs the frame
loop. Logic belongs in modules; main.ts holds the order things happen in.

## A frame

`frame(now)` runs once per `requestAnimationFrame`, in this order:

1. Fit the canvas, work out the frame's time (`frameSeconds`, capped at
   0.25 s), poll the gamepad, update the menus. Paused: redraw if needed
   and stop here.
2. Aim and actions: mouse aim, the fire slot (combat, drive-bys, a service
   vehicle's tool), DETONATE, getting in and out of cars.
3. `maintainPopulation()` every 0.25 s (traffic and crowd around the player).
4. The simulation: `loop.advance(simDt, simulate)` runs `simulate(1/60)` as
   many fixed steps as `simDt` holds. `simDt` is `frameSeconds` scaled by
   hit-stop, cards (`progress.simScale()`), TEST slow motion and the best
   moment's capture.
5. Presentation, interpolated between the last two steps: car meshes,
   people (`people.update`), pigeons, `fx.update`, the city mood,
   `destruction.update`, then **the frame systems** (below), the HUD,
   progress, heat's HUD, the camera, audio, radar, threats, `look.update`,
   `look.render`, labels, and the frame stats.

`simulate(dt)` is the world step: obstacles, driving (player, traffic, police,
scenes' cars), physics, the crowd, collisions and crash damage, stunts, drift
and near-miss scoring, pickups, then `heat.step`, `combat.step`,
`cityLife.step`, `progress.step`, respawns, fire and explosions, and people
against cars and walls. Observe mode's `holdsRun` freezes the player's side
of it; `simLod` thins out what's off screen.

## Frame systems

Looks and overlays that only present something register themselves where
main.ts makes them, and the frame loop runs them all at step 5, in the order
they were added (`src/core/frameSystems.ts`):

```ts
const steamLook = new SteamLook(effects, planSteamVents(city.seed));
frameSystems.add('steamLook', 'world', (dt, f) => steamLook.update(dt, f.view));
```

Each picks a clock:

- `real`: `frameSeconds`, wall time since the last frame.
- `world`: `real` × hit-stop × TEST slow motion. For anything that should
  freeze with the people on a big hit.
- `sim`: the simulation's time this frame, which also stops for cards and
  the end of a Chaos Run.

`f.view` is the ground the camera sees, worked out once a frame for every
system. Names must be unique (a name added twice throws, which catches a
look merged in twice). Registered today: combat, stinger, charge, smoke,
steam, water and city-life looks, fireworks, street life, stamps and the
RACE CRASHER blips.

Keep a system explicit in `frame()` instead when its place in the order
matters to something else: people before the camera, the camera before
audio, everything before `look.update` and `look.render`, labels after the
render.

## `window.__ub`

The smoke test, the tuning harnesses and the console reach the game through
`window.__ub` (`src/core/debugHandle.ts`). Each system is exposed right after
main.ts makes it:

```ts
const nitro = new Nitro(events);
expose('nitro', nitro);
```

`exposeGetter(name, get)` is for a value that changes (`paused`, `simTime`,
`observe`). The harness controls (`startGame`, `stepFrame`, `fastForward`,
`mapEditor`, the getters) sit together at the end of main.ts, where
`installDebugHandle()` puts the object on the window once everything is in
it. A name exposed twice throws. The tools depend on these names, so don't
rename one without searching `tools/`.

## Adding a system

Build it in its module (pure logic with tests in `tests/`), then in main.ts:
construct it near the systems it depends on, `frameSystems.add` it if it draws
every frame, subscribe to `events` for what it reacts to, and `expose` it if
a harness or the console needs it. Each of those is a line next to the
construction, so a feature branch rarely touches the frame loop, `simulate`
or the end of the file. Imports are the exception: they stay in the order
they were added. Sorting them changes the order of the bundled CSS (each UI
module imports its own stylesheet), so append new imports and resolve
import conflicts by keeping both sides.
