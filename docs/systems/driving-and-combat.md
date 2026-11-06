# Driving and combat

Numbers come from scratch sims of the real `stepVehicle` /
`collideVehicleStatic` (and the tests pin them).

**Driving** (`entities/vehicle.ts`, pure). Each car reaches exactly its
`maxSpeed` flat out (the engine's taper is solved against drag 0.04):
sedan 33 m/s, compact 30, sports 42, van 27, taxi 32, pickup 31, police 34
(0–100 km/h: sports 2.3 s, police 3.4, sedan 4.3). Grip turns a car only
as fast as its lateral limit (`latAccel`, 16 van … 26 sports, yaw ≤ a/v):
a right angle flat out at 28 m/s runs 36 m on and scrubs speed, so brake
or drift; town speeds don't notice. The handbrake kicks the rear loose
(`slide` = 1): on the throttle the drift holds (sedan ~28°, sports ~37°,
van ~17°), countersteer straightens it, lifting off grips it up in a
fraction of a second, and part of the scrubbed sideways speed goes into
forward speed so drifts keep their pace. Handbrake + throttle from a stop
is a burnout (smoke, donuts with the wheel) that charges in 0.9 s and
launches the car ~40% quicker to 20 m/s. Per archetype: steering response
15 sports … 6 van (twitchy vs heavy), mass 0.85 compact … 1.6 van (who
shoves whom). Nitro (`game/nitro.ts`): ×1.7 power and ×1.25 top speed for
3.2 s a tank; the tank fills by drifting (0.14/s), near misses (+0.15)
and stunts (+0.3). Directional touch steering brakes into corners it
can't take on grip (16 m/s for a right angle, more for gentle bends).

**Walls and crashes** (`systems/physics.ts`, `systems/damage.ts`). A wall
stops only the speed into it; the speed along it is scrubbed by up to 45%
with the square of the hit, and a nose-in glance swings the car parallel:
at 25 m/s a 5° glance keeps its pace, 15° keeps ~20 m/s, head-on stops.
Crashes cost nothing below 6 m/s, then 2.6 HP per m/s: a traffic sedan
(100 HP) smokes after one 28 m/s head-on and burns after a third 20 m/s
hit. In a car-on-car crash the rammer takes 30% of what the car it hits
takes (65% each head-on), scaled by mass. The player's own car takes
`PLAYER_CRASH_SHARE` (60%) of crash damage, since smashing is what scores:
a 21 m/s wall hit costs a sports car 26% instead of 43%, ramming a parked
car at 28 m/s ~10 HP (6 such rams and a sedan still isn't on fire), two
28 m/s head-ons into buildings leave it smoking. The Chaos Run's sports car
has ×1.5 health (135). Health: sedan 100, compact and sports 90,
van 140, police 130, taxi 100, pickup 125; fire at 20%, burning 4.5 s.
Blasts (`BLASTS`): a car going up does 85 at the centre to 0 at 9 m and
sets cars within 4.8 m (of their nearest part) alight on a 0.5–1.9 s fuse
instead, so a jam goes up in a rippling chain (your own car gets 3–4 s to
bail out); grenades 105 / 8 m, rockets 160 / 10 m. Landing a jump
costs 3 HP per m/s of vertical speed over 10. NPC bullets do 8 to the
player (6 beyond 14 m) and 45% of that to cars, so 4★ chases are
survivable, and spread 60% wider at a running target.

**The player** (`game/player.ts`): body armour (0–100) soaks every hit
first and is lost on death; health creeps back to 40 at 4/s after 6 s
unhurt. Crates: health +50, armour +50, ammo (half a clip for each gun
owned, 3 blasts for an air horn, 2 taser cartridges), weapons (capped: pistol 120, SMG 300,
shotgun 48, grenades 12, molotovs 10, rockets 8, air horn 12, taser 8, stinger 4,
smoke grenades 6, sticky charges 6: never in a crate).

**On foot** (`game/combat.ts`, `systems/crowd.ts`, `systems/weapons.ts`).
Everyone, officers included, has 100 HP: pistol 34 (3 hits), SMG 15 (~7),
shotgun 7 × 16 (one blast up close, thinner at range). A hit staggers for
0.3 s (no walking, no attacking, the next attack pushed back); 0 HP is a
knockout: down 8 s, then they run with no grudge (a passer-by
knocked out near you stays down for the ambulance instead: [*City life*](city-life.md);
anyone armed drops their gun). Only a knockout scores
KNOCKOUT. Punches chain jab (22), jab (22), hook (40, knocks down) within
0.75 s. Firing locks on: hostiles (fighters, shooters, police while
wanted) at any angle first, else the best target in a 90° cone; with a
deliberate aim only within ~20° of it; it lets go 0.6 s after the last
shot, and you strafe while locked (a red ring marks the target). Spread
blooms per shot (pistol +0.04, SMG +0.03 rad) and settles in about a
second; running widens it. Grenades land where you aim (the cursor, the
stick's reach, or a target near the aim line; unaimed, a lob of half the
range or onto someone in front within it), bounce and go off after
2 s; molotovs burst into a 3.2 m fire for 6 s that sets people running
alight (22 HP/s) and cooks cars (12 HP/s); rockets fly at 26 m/s, arm
after 3 m and blow up on the first thing they touch (75 m max); their
lock-on and aim assist ignore anything within 8 m (inside their own blast). While a
grenade or molotov is in hand, a landing ring and a dotted arc show
where it will land, 1 m short of any wall on the way (`clampThrowToWalls`:
it would bounce back off it; the ring turns red when a wall cuts it short,
and a throw a wall would drop within 3 m of your own feet doesn't go) (a touch tap on FIRE throws right there). On touch
the aim stick only aims a throwable (it never auto-fires one): let go to
throw where the ring is, or slide back to the centre first to cancel.

**Drive-bys**: in a car, FIRE shoots a pistol or SMG (picking one if
something else is held) out of whichever side window has the best target
within 1.2 rad of square (hostiles first), with ×1.5 spread; an aim
(mouse, right stick) picks the window. Never hits your own car; heat
applies like any gunfire.

**The air horn** (W3-B, `systems/airHorn.ts`, `Combat.blowHorn`): held,
aimed and fired like a pistol (on foot only, no lock-on); a crate is a
canister of 6 blasts (12 at most; an ammo crate adds 3), one every 1.1 s.
A blast is a cone 14 m long and ±0.5 rad (~29°) wide, the hose's maths
(`serviceTools.coneHit`, its jet ±0.23 rad), and a wall between stops it
for whoever's behind (`hornClear`, the hose's `clipJet` per target). No
damage and no knock-downs: within 2.5 m people reel (a 0.45 s stagger,
pushed back) and cover their ears; within 8 m they cover their ears for
0.7 s (the cower pose) and then run; further off they scatter for 4 s.
The police, anyone fighting, the fallen and the burning don't budge.
Drivers in the cone (not the police, not one in a rage) stamp on the brake
for 0.8–2 s (40% jerk the wheel ±0.6 as they do), sit stalled, then honk
back (`traffic.startleDriver`). Parked cars in the cone go off
(`scenes/alarms.ts`; the first blast that sets one off in 40–70 s is a
chain of the player's: blast, alarm, DOMINO ×2; `LOUD`: not while wanted),
pigeons and stray dogs scatter, and a scanner line goes out (NOISE
COMPLAINT IN …, 90 s cooldown). Heat: a public-order nuisance, +0.1 a
witnessed blast, at most +0.2 per 5 s, so a whole canister never makes a
star. The sound is a synthesised three-reed chord (`sfx.airHorn`); the look
is three pale shock rings down the cone from Effects' pooled fake lights
(no draw call of its own). Pickups: a pink-ringed `crate_horn`; in the
hand, `weapons.glb`'s `air_horn` (a red canister, the trumpet forward).

**The taser** (W3-B, `systems/taser.ts`, `Combat.tase`): held, aimed and
locked on like a pistol (on foot only; with it in hand the lock-on flags a
fleeing suspect, a mugger or a chase's runner, as hostile, so it picks
them out first); a crate is 4 cartridges (8 at most; an ammo crate adds 2),
one shot every 1.4 s. Each shot is a pair of darts 8 m along the lock or
the aim that stops at the first person (0.55 m either side of the line),
car or wall: whoever it reaches is stunned, knocked down where they stand
(a 0.8 m/s slide) for 4 s with no hit points lost (so never a KNOCKOUT),
then up: ordinary people provoked (fighters come at you, the calm run),
officers back on the job. People within 7 m step back for 3 s; it's no
gunshot, so nobody else panics and no `shot` goes out. It's reported as a
`taser` event (hit or miss, where the darts stopped) and then an ordinary
`pedDown` (cause `taser`), so it means what any floor means: a civilian is
an assault (+0.3, witnesses phone it in), an officer is still a crime
(`copDown`, +1, and an attack on a city chase's police: the handoff
rules), and a fleeing suspect is a have-a-go, not an assault. A mugger
drops the bag (hand it back: HAVE-A-GO HERO, $50); a chase's suspect on foot
pays HAVE-A-GO HERO and **gives up to you**, armed or not: they kneel once
they're up (a shoot-out with the officers is over), and when the officers
cuff them within 30 s it's your **CITIZEN'S ARREST** too ($150,
`chaseHandoff.tasedArrest`). The look is two thin wires from the taser in
hand to the darts, shooting out in 0.06 s and crackling blue-white for
0.8 s (0.25 s on a miss): streaks in the hot particle batch like tracers
(`Effects.wire`, at most 4 at once), with sparks and a cold flicker on the
ground from Effects' pooled fake lights, so no draw call and no real
light. The sound is the cartridge's pop, then ~0.8 s of the current's dry
ticking over a thin buzz (`sfx.taser`, one gated noise source). Pickups:
an electric-blue-ringed `crate_taser`; in the hand, `weapons.glb`'s
`taser` (a stubby yellow pistol, the cartridge on its nose).

**The stinger** (W3-B, `systems/stinger.ts`, `Combat.throwIt` /
`dropStinger`): a folding spike strip, thrown like a grenade on foot (16 m
at most, the landing ring as usual) or, the one throwable that goes out of
a car, dropped 1.2 m behind the back bumper. A crate is 2 (4 at most). On a
straight road it squares itself across one carriageway (`ROAD_WIDTH / 2`,
more if it lands over the middle) and stays on the tarmac; in a junction or
off the road it lies square to the throw or the drive. At most 3 are down
(the oldest is pulled up), each for 40 s or 6 cars. Any car whose wheels
cross it on the ground (one in the air over it is spared) gets its tyres
burst (`tyresBurst`): a slew (a yaw kick up to 1.4 rad/s and the rear let
loose, full from 20 m/s), then life on the rims, kept on `DamageState`
until a respray or another car (`FLAT_*` in `entities/vehicle.ts`: half the
top speed, less grip and brakes, a pull to one side). Traffic brakes hard
and sits 1.5–3 s, then limps on; police in a chase limp on and fall
behind, so it shakes a chase without a shot. A police car's tyres on your
strip pay **SPIKED** (300) and a scanner line (UNIT DOWN TO ITS RIMS IN …,
60 s cooldown). Heat: a civilian's tyres are a nuisance, a patrol car's an
attack on the police, and nothing once you're already wanted (it mustn't
restart the clock it's there to beat); your own car's tyres are free. The
look is the one flat prop, built in code (`render/stingerLook.ts`: a black
hinged strip, yellow hinge blocks, two rows of spikes, drawn above life
size across like guns in hand), one instanced mesh that draws only while a
strip is down or flying; it unrolls from the middle in 0.3 s, tumbles
folded in flight, glints in headlights, and in hand a ghost shows where it
would lie. Flats scrape rim streaks and sparks (`fxDriving`). The sound is
the sections slapping out (`sfx`, ~0.45 s) and the burst's double bang,
hiss and flapping rubber that slows with the car (~1.3 s). Pickups: a
steel-ringed `crate_stinger`; in the hand, `weapons.glb`'s `stinger`
(the strip folded into a block).

**The smoke grenade** (W3-B, `systems/smoke.ts`, `Combat.pourSmoke` /
`stepSmoke`): thrown like a grenade (20 m at most, the grenade's arc and
bounce); a crate is 2 (6 at most). It hisses into life 1.2 s after the
throw and pours a cloud that billows from 2.5 m to 6.5 m across in 1.5 s
(a road and a pavement either side), thick for 9 s, then thins away over
2.5 s, which is only the look: a thinning cloud does nothing. At most 2
clouds at once (another throw replaces the oldest). **Sight**
(`systems/sight.ts` `sees`, `SmokeView.blocks`): nobody sees into, out of
or through a thick cloud beyond arm's length (2.5 m), so a police car or
officer inside one or looking through it loses you and drops into search,
and the helicopter's spotlight finds nothing but smoke while you're in
one. **Police cars** that drive into it are confused (`Daze`, one per
unit in `systems/police.ts`): a third each crawl to a stop, stop dead with
their hazards blinking, or take a wrong turn at the next junction
(`wrongWay`, at most 9 m/s, forgotten after 12 s), so a chase visibly
scatters; a crawl or a stop ends 0.6 s after they're out of it, a wrong
turn is taken whatever the cloud does. **Officers on foot** (and anyone
fighting or shooting) stop and cough, no running, no shots; **people**
cough and walk out of it; **traffic** brakes hard and sits there until
it's clear (rear-end shunts welcome). The player's cloud puts a scanner
line out (SMOKE ON THE STREET IN …, 60 s cooldown); it's no crime. The
look (`render/smokeLook.ts`) is billows from Effects' soft smoke pool in
the low-resolution pass like every other smoke, scaled by the tier's
`particleScale` (about 17 live per cloud on low, 26 on medium, 34 on
high, under the low tier's `smokeMax`), so it adds no draw call while
anything else smokes and one otherwise; emission stops 1.2 s before the
cloud stops being thick, so it thins as its effect ends. The budget check
is `tools/tune/mayhem.mjs --scenario smoke --seconds 12` (two clouds on
the player on foot). The sound is the cap's pop and ~3 s of gas hiss over
a low rush (`sfx.smokePop`), and coughs (`sfx.cough`, deeper for an
officer, one at a time). Pickups: a pale-grey-ringed `crate_smoke`; in
the hand, `weapons.glb`'s `smoke_grenade`.

**The sticky charge** (W3-B, `systems/charges.ts` pure and tested in
`tests/charges.test.ts`; `Combat.detonate`, `stickCharge`): thrown like a
grenade (16 m at most), but its aim picks out cars, not people, and leads
one on the move by the throw's flight time. In flight it **sticks** to the
first unwrecked car it comes within 0.25 m of (below 1.7 m; not the one
you're in) and rides along in that car's frame wherever it goes, a tow
truck's hook included; one that touches no car lies where it lands, or
against the wall it hits, and can still be set off. **DETONATE** (G,
D-pad down, the touch BOOM button) sets every charge out off at once, from
anywhere, on foot or in a car, and only in play (`canDetonate`: never on
the title, paused, under a menu or panel (TEST, the map editor,
Settings), in Observe, under a card, or WASTED / BUSTED; the presses are
drained every frame either way, and a pause's `resetAll` drops any
pending). One on a car **blows the car** through its own sequence:
`markPlayerHit` then `ignite` on a 0.05 s fuse, so the car wrecks on the
next damage step and `vehicleExploded` does the rest (the car's blast,
fire chain, debris, KABOOM, heat), the player's doing; one on the road
goes off as a grenade's blast. A car wrecked some other way first takes
its charge with it and the wreck is yours. **Three** out at most (stuck,
lying or in flight); a fourth throw is refused, nothing spent, with a
CHARGES OUT notice; the first one out says how to set it off on the
device in use. A car carrying one is never recycled (`charges.cars` into
`maintainPopulation`'s keep list and city life's `keep`), so it's there
when you press; one lying on the road is forgotten once you're 400 m
away, and one on a car its own system retires (a police unit) goes with
it. The cash van (`CASH_PAINT`) and the Mayor's pearl limo
(`LULL_LIMO_PAINT`) always earn **PARTING GIFT**, any other car only when
someone else was driving it and you were 30 m off or more
(`partingGift`). It's a story reward: RIBBON CUTTING (`s5-ribbon`) hands
you two, in hand, and passing it puts STICKY CHARGES in the shop; never
in a crate. The look (`render/chargeLook.ts`) is props.glb's
`charge_stuck` (BLENDER_TODO §15; a code-built brick until props.glb
loads): a dark brick taped round the middle with a red detonator box
whose top face (`charge_glow`) the blinking light sits over, 3× life size, seated on the
car as drawn this frame (on the roof over the cabin, else at the hood
line, from `look.cars.dims`) so it doesn't shiver on a fast car; a
blinking red light and a red ring on the road round its car (the shared
glow mesh), one instanced mesh with the stingers' material (no new
program) that draws only while one is out or flying. The sound is a wet
thud and two arming beeps (`sfx.chargeStick`; a dud click when refused)
and the plunger's clack and rising beep (`sfx.detonator`); the bangs are
the car's or the grenade's own. In the hand, `weapons.glb`'s
`sticky_charge`, held 1.4× life size like the other thrown weapons.

**Stunts** (`world/ramps.ts`, `systems/stunts.ts`). Ten stunt ramps
(6 × 3.2 m, 1.6 m lip, matching the `ramp` model in props.glb) on road
centrelines just past a junction (one a block east of the spawn corner),
and eight smaller kickers (2.5 × 2.2 m, 0.6 m lip, the `kicker` model)
at least 120 m from any ramp; traffic in their lanes never touches them.
A car lined up on the front climbs the slope and flies off the lip with
vy = 0.36 × speed off a ramp, 0.24 × off a kicker (a drop at a crawl):
~1 s and ~28 m at 28 m/s off a ramp.
A ramp's sides and back are solid to cars and people alike.
Airborne: gravity 22, no grip or steering, cars pass over people and
other cars, the body pitches with the arc, the contact shadow stays on
the road. STUNT = 1000/s of airtime + 20/m + 500 per half-turn of spin
(GREAT ≥ 2000, INSANE ≥ 3500, 180/360 prefixes); jumps over 0.9 s get a
beat of slow motion near the top.

**Character clips** (`render/characterModel.ts`, `characterAnim.ts`):
every gameplay state plays its Blender clip, found by name (each missing
one falls back to a procedural fake): Idle/Walk/Run by speed; the aim per
weapon (pistol `Aim`, SMG/shotgun `AimBoth`, launcher `AimRocket`; a gun is
lowered while sprinting unaimed) with its `Shoot*` kick per shot; the jab,
left hook and uppercut of the combo (`Punch`, `Punch2`, `Uppercut`);
`Throw` for grenades and molotovs; `Stagger` on a hit; knocked down
`Fall` → `Down` → `GetUp`, the get-up timed to end as they're allowed up
(`GetUpFast` after a short knock-down);
`Arrested` when BUSTED; `EnterCar` at the driver's door before the body
vanishes; `Hail`, `Cower`, `Cheer`, `Ride`. See [*Look → People*](look.md).

**Budget**: ramps +1 draw call (+1 in the shadow pass) when in view,
projectiles +1 only while something flies; rings, arcs, fire glows and
shadows go into the shared glow and shadow meshes. Measured with
`?debug`: 43–56 calls on the iPhone profile in fights, chases, jumps and
night rain, 55–69 on desktop (a 5-star chase with grenade spam). Combat
allocates nothing per bullet. The sim's per-step hot paths avoid garbage
too (sidewalk corners into a reused point, `len2` (`core/len.ts`) in place
of `Math.hypot`, which V8 doesn't inline and allocates for, cheap rejects
before the per-car / per-crate work, static contacts into reused objects,
indexed loops in `simulate`, last-step state copied field by field). In
headless Chromium (V8) on 2026-10-31 a sim step allocated ~12 KB (from
~55) and posing the crowd ~1.1 KB a frame (from ~3.5); what remains is
mostly V8 number boxing, which JSC on the iPhone doesn't do (it NaN-boxes
doubles).

**Simulation level of detail** (`systems/simLod.ts`, pure, tested). The
street's ambient agents think every step only where the player could see or
reach them: on screen (the visible ground plus 10 m, wider than the draw
cull) or within 25 m. Off screen within 80 m they tick at 15 Hz, further at
5 Hz, each on its own round-robin bucket (a clock per agent, `newSimClock`)
so the work spreads evenly over the steps, and a tick integrates all the
time owed since the last one, so they cover the same ground; back at the
full rate the debt is paid at once, 10 m before anyone can see it.
`SimLod.begin(x, z, view)` once a step, `tier(x, z)`, `due(clock, tier, dt,
pinned)` → the dt to integrate (0: skip this step), `settle(clock)` to
think now between ticks.

- **Traffic** (`main.ts driveCar`): a calm driver off screen runs `driveAi`
  (the obstacle scans) on its tick and `holdAi` between, which keeps the last
  decision but still steers for the lane every step and brakes within the
  room it had (the stop line, the car ahead), so it stops where it would
  have; reaching a waypoint makes it think at once. Within 25 m of a
  junction, or crossing one, a far driver thinks at 15 Hz, not 5
  (`nearJunction`: lights and cross traffic). Physics, ramps and every
  collision stay every step for every vehicle.
- **Walkers** (`stepCrowdPed` with the owed dt): street people and a scene's
  people; their car and wall collisions, and the pavement's side-steps
  (`scenes/pavement.ts`), run on their ticks too. Posing already skips
  whoever is off screen (`PeoplePose`).
- **Stray dogs** (`scenes/strayDogs.ts`, `DogPack.stepDog`): the runners and
  cars are gathered only on a step some dog ticks.
- **Always every step**: the player's car, police units and officers, road
  ragers and panicking drivers (`fullRateDriver`: mood, `urgent`, pulling over
  for a siren, held up by the player), any car a scene is driving (chases,
  races, call-outs, the bus), anyone fighting, shooting, reeling or on fire,
  people other systems own (gangs, story characters, fares: `fullRatePed`), a
  dog on a chase, and anything within 25 m. The scene director, heat, combat
  and pigeons (per frame, ~0.02 ms) are left as they were.

The schedule is deterministic (a step counter and the order agents were
made in), so seeded harness runs still repeat, though not with the old
numbers (agents now draw on the shared random stream in another order).
`__ub.simLod.enabled = false` runs everything every step, for A/B checks;
`__ub.simProfile` (`core/sectionTimes.ts`) times the sim by system:
`start()`, then `summary()` (mean, p95, max JS ms per frame) or `last(i)`.
Measured 2026-11-01 on the iPhone profile (852×393, 'medium') in headless
Chromium, rendering stubbed, scenes forced (`fight`, `iceCream`,
`chaseCar`, `race`, `ambulance`, `dogs` and ten more), LOD on and off in
alternate blocks of 150 frames (so both sample the same city), median of
three runs, JS ms per frame, mean (top 1% of frames dropped) / p95, and the
whole sim step's median:

| | downtown, day | Neon Mile, 23:00 | Neon Mile, 3★ |
|---|---|---|---|
| traffic AI | 0.110 / 0.21 → 0.090 / 0.18 | 0.134 / 0.18 → 0.099 / 0.16 | 0.138 / 0.25 → 0.099 / 0.16 |
| crowd step | 0.062 / 0.12 → 0.037 / 0.08 | 0.070 / 0.12 → 0.040 / 0.08 | 0.096 / 0.14 → 0.051 / 0.10 |
| crowd collisions | 0.060 / 0.12 → 0.028 / 0.06 | 0.074 / 0.14 → 0.030 / 0.06 | 0.091 / 0.14 → 0.044 / 0.09 |
| whole sim step (p50) | 0.515 → 0.445 | 0.470 → 0.395 | 0.575 → 0.450 |

Off screen about three quarters of the crowd and over half the moving
traffic tick slow. Vehicle physics, collisions, posing, scenes, heat and
pigeons are unchanged within noise. Behaviour, LOD off / on: nothing on
screen moved more than a stride a frame either way (45 s chasing round at
up to 32 m/s, and the title's cruise); ambient traffic over 16 seeds ×
300 s: 482 / 484 AI crashes (71 / 68 more than 80 m off), 114 / 132
people knocked down, mean speed 5.14 / 5.27 m/s, stopped 40% / 39% of the
time; scenes forced every 40 s for 240 s (six seeds): ice creams served
122 / 135, chases ended by arrests and take-downs as before; the people a
bus stop, a busker and the carts gathered while 70 m off screen stand on
the same spots either way.

API for other systems:

```ts
player.armour / player.addArmour(n)        // 0..MAX_ARMOUR (100); returns what was taken (a shop can sell it)
combat.collect(kind)                        // apply a pickup (false = can't use it now)
combat.blast('grenade' | 'rocket' | 'car', x, z, byPlayer)   // an explosion through the normal blast path
combat.projectiles.throw('grenade' | 'molotov', x, z, toX, toZ, byPlayer) / .fireRocket(x, z, dx, dz, byPlayer)
combat.projectiles.addFire(x, z, byPlayer)  // a fire patch
combat.lock / combat.marker                 // the lock-on target, the throw marker (.blocked: a wall cut it short)
nitro.charge / nitro.add(amount)            // 0..1 tank
hurtPed(agent, damage, fromX, fromZ, knock?) // systems/crowd.ts: 'none' | 'hit' | 'down' | 'ko'
ramps (world/ramps.ts: placeRamps, rampAt, rideRamps) · StuntTracker (systems/stunts.ts)
// Bus: { type: 'jump', x, z, speed, airtime, involvesPlayer } · { type: 'land', x, z, impact, involvesPlayer }
//      { type: 'stunt', x, z, airtime, distance, spin, points, label } · { type: 'boost', on, x, z }
//      { type: 'throw', x, z, toX, toZ, weapon, byPlayer } · { type: 'ignite', x, z, radius, byPlayer }
//      explosion.source ('vehicle' | 'grenade' | 'rocket'), shot.driveBy, punch.combo, pedDown.ko / cause 'fire',
//      playerHurt.armour / .absorbed.
```
