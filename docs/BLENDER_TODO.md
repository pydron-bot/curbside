# Blender work list (for the session with Blender)

_Written 2026-10-30 alongside the game overhaul on branch `claude/game-overhaul`._

The code side of the overhaul (rendering, audio, UI, police, missions) is
being done without Blender, so the art is still the original placeholder
GLBs. This is the asset work that would lift the game most, in priority
order, with the exact contracts the game code now relies on. Everything
stays procedural in `blender/generators/` and is rebuilt with
`npm run assets`.

**Without the Blender app** (a cloud container), the pip `bpy` module
(Blender 5.2 LTS as a Python module, about 400 MB) builds the same GLBs, to
within 1 ULP. Keep the venv outside the repo:

```sh
python3 -m venv /tmp/bpy && /tmp/bpy/bin/pip install bpy==5.2.3   # Python 3.13
/tmp/bpy/bin/python blender/build_assets.py -- --out public/assets
python3 blender/check_assets.py
```

`--thumbs` doesn't work there (EEVEE needs libEGL); check the look in the
game instead (Playwright + SwiftShader).

**Please work on your own branch off `claude/game-overhaul`** (e.g.
`blender/assets`) and keep to `blender/`, `public/assets/` and this file, so
the code streams and the asset work merge without conflicts. Note anything the
game needs to wire up (new clip names, new GLBs) at the bottom of this
file; the code side will pick it up.

## How the game uses the GLBs now (read before changing anything)

The new renderer batches everything, which turns some names into hard
contracts:

- **Characters (`player.glb`)** are not drawn as separate meshes any more.
  At load, `src/render/characterModel.ts` merges the rigid body parts into
  ONE geometry, skinned to their parent bone, and draws every person in the
  city as one GPU-skinned `InstancedMesh` (one draw call, up to 80 people).
  - Parts stay **rigid meshes parented to bones** (no vertex weights). Each
    vertex follows the bone its mesh hangs off.
  - Bone names: `root`, `hips`, `chest`, `head`, `arm.L/R`, `leg.L/R`.
    You can add bones, but keep the total ≤ 12: each bone costs 4 texels
    per person per frame.
  - Outfit colours come from the **material name suffix**: `*_skin`,
    `*_hair`, `*_shirt`, `*_pants`, `*_shoes`. The game recolours per person
    through a palette, so any new part must use one of these five suffixes.
    Untextured, flat colour only: UVs and other attributes are stripped.
  - Clips are looked up **by name**: `Idle` (2 s loop) and `Walk` (1 s loop,
    matched to 1.6 m/s) today.
- **Vehicles (`vehicles.glb`)**: one root node per archetype, named exactly
  as the archetype key (`sedan`, `compact`, `sports`, `van`, `police`,
  `taxi`, `pickup`). At load, `src/render/vehicleModels.ts` merges all of an
  archetype's parts into one geometry. Each vertex is tagged with its part
  kind from the **material name**: `paint` (tinted per car), `glass`,
  `headlight`, `taillight` (lit as brake lights), `tyre`, `trim`,
  `siren_red`, `siren_blue` (flash when the police light bar is on).
  Anything else counts as "other" (fixed colour).
  - Front wheels are named `<arch>_wheel_FL` / `_FR`, with their origin at
    the hub; they steer about that origin in the shader.
  - Every car of one archetype is one instanced draw call (up to 48).
- **Units and axes**: 1 unit = 1 m, glTF Y-up, models face Blender −Y (game
  +Z), origin at ground centre. Flat-shaded low-poly; colour comes from
  material base colours (no textures).
- **Budgets** (iPhone 15 Pro target): ≤ 600 tris per person, ≤ 1,500 per car,
  ≤ 300 per small prop. Everything is instanced, so triangle count matters
  more than object count.

## 1. Character animation clips (highest value)

The on-foot game is all running, punching and shooting, but the only clips
are Idle and Walk; the game fakes the rest (tipping the whole body over when
knocked down, swinging one arm for a punch). Add these to `player.glb`, on
the same armature, using these exact names:

| Clip | Length | Notes |
|---|---|---|
| `Run` | 0.6 s loop | Sprint stride for ~5.5 m/s. Arms pump, slight forward lean. |
| `Punch` | 0.35 s one-shot | Right jab: wind-up, extend, recover. |
| `Aim` | 0.3 s loop or hold pose | Right arm (or both arms for SMG/shotgun) raised forward, holding a gun. |
| `Shoot` | 0.12 s one-shot | Small recoil kick on top of `Aim`. |
| `Fall` | 0.5 s one-shot | Knocked backwards onto the ground; ends lying flat. |
| `Down` | 1 s loop | Lying on the ground (tiny breathing motion). |
| `GetUp` | 0.9 s one-shot | From `Down` back to standing. |
| `EnterCar` | 0.5 s one-shot (optional) | Reach forward and duck; the game hides the body at the end. |

The code side will play these by name when present and fall back to the
current fakes otherwise, so they can land in any order.

## 2. Character variety

Every pedestrian is currently the same body with a different palette.

- **2–3 body variants** (e.g. slim, stocky, a longer coat or dress
  silhouette) as **separate root objects** in `player.glb`, named `ped_*`,
  each its own armature with the same bone names and clips. The game can
  batch each variant as one more draw call. Keep the outfit material suffixes.
- **A police officer** (`cop`): peaked cap, short-sleeved shirt, belt with
  holster, built from the same rig. Cops on foot are coming with the wanted
  level. The game will colour them navy via the palette, so the cap and
  badge can use `*_hair` / `*_shoes`, or a fixed-colour material for the
  badge.
- Optional accessories that work through the palette: cap, backpack,
  sunglasses (fixed colour).

## 3. Props (new `props.glb`, one root per prop)

The city's street furniture is shader paint or boxes today. Low-poly props
that the game will instance by root name, each with its origin at the ground
contact point:

- `streetlamp`: replaces today's five boxes. ~6 m pole, arm over the road,
  lamp head. The light pool on the ground is shader-faked; the head material
  should be called `lamp` so it can glow at night.
- `traffic_light`: pole and head with `light_red` / `light_amber` /
  `light_green` materials (for future working lights).
- `hydrant`, `bench`, `trash_bin`, `dumpster`, `bollard`, `newspaper_box`,
  `mailbox`.
- `payphone`: mission givers in M7 need these. Make it visible from 20–50 m
  up: a coloured hood or sign on top.
- Rooftop set (seen from above all the time): `ac_unit`, `vent`, `water_tank`
  (on legs), `satellite_dish`, `rooftop_door`, `antenna`.
- `tree_round`, `tree_tall`, `palm`: canopies readable from directly above.
- `ramp`: for stunt jumps, 6 m long, 1.6 m high at the lip, plus a smaller
  `kicker`.

## 4. Pickups and weapons

- In-hand guns (`pistol`, `smg`, `shotgun`), parented to `arm.R`, or as
  loose models the game attaches at the hand.
- Pickup props seen from above: weapon crates (one per gun, with a coloured
  stripe), `health_kit` (white box, red cross), `package` (hidden-package
  collectible), `cash` (bundle of notes).

## 5. More vehicles

The new archetypes need code too (handling specs, spawn mix); the code side
will add them once the models exist. Follow the existing contract (root name
= archetype key, material names, wheel names):

- `bus` (12 m), `ambulance` (`siren_red` / `siren_blue` bar), `firetruck`,
  `garbage_truck`, `police_suv`, `muscle` (classic muscle car), `limo`.
- A small `cop_bike` or scooter is fun but needs different physics; lowest
  priority.

## 6. Debris for explosions (nice to have)

`debris.glb`: a few car-part chunks (`door`, `hood`, `bumper`, `wheel`, two
or three twisted panels), ≤ 80 tris each, using the `paint` / `trim` / `tyre`
materials so they pick up the exploding car's colour. The effects code will
throw them out of explosions as instanced debris.

## 7. Police (requested by the heat stream)

The wanted level and police are in (`src/systems/police.ts`, README
*Heat*). Today they make do with stand-ins; these would lift them most:

- **`heli`** (police helicopter, new root in `vehicles.glb` or its own
  `heli.glb`): ~12 m long, dark blue/white, seen from directly above, so
  the silhouette and the rotor disc matter most. Put the main rotor and
  tail rotor on separate nodes named `heli_rotor_main` / `heli_rotor_tail`
  (origin at the hub, spinning about local Y / X) so the game can spin
  them; a `searchlight` material on the nose lamp. ≤ 1,500 tris. The game
  currently draws only its shadow and searchlight pool (`render/heatLook.ts`).
- **`swat`** van archetype (same contract as the other vehicles): a boxy
  armoured van, dark paint, push bar, roof light bar using `siren_red` /
  `siren_blue`. Today SWAT units are the `van` model painted dark, with
  the light-bar glow faked on the roof.
- **`cop`** character (already in §2): officers are the player model in
  navy through the palette; a peaked cap (`*_hair`) and a holster would
  sell it. Clips that would help: `Aim` (pistol raised, from §1),
  `Arrested` (kneeling, hands behind the head, ~1 s loop) for the BUSTED
  moment.
- Props in `props.glb`: `barrier` (police sawhorse with stripes, for
  roadblocks beside the cars), `spray_booth` (an open-fronted garage shell
  ~6 × 9 m, its mouth facing local −Z, for the Pay 'n' Spray bays, which
  are only glowing floor markings now) and `police_sign` (a blue lamp or
  sign over the station door).

## 8. Second round (for features added since §1–7)

The game gained new weapons, combat moves and activities after the first
list; these still use stand-ins. Same contracts as above (material
suffixes on bodies, fixed colours elsewhere, origins on the ground, game +Z
forward). In priority order:

1. **New weapons** (`weapons.glb`, same grip/`muzzle` contract):
   `grenade`, `molotov` (bottle with a rag), `rocket_launcher` (shoulder
   tube, `muzzle` at the front), plus a `rocket` projectile root (≤ 60
   tris, nose +Z) that the game flies.
2. **Pickup crates** (`pickups.glb`) for the new pickup kinds: `crate_grenade`,
   `crate_molotov`, `crate_rocket` (same crate as the guns, with their own
   stripe colours), `armour` (a folded vest), `ammo_box`. Today these reuse
   the gun crate.
3. **Clips** (every character GLB, same rules as §1):

| Clip | Length | Notes |
|---|---|---|
| `Throw` | 0.4 s one-shot | overhand throw (grenade, molotov); release at ~55% |
| `AimRocket` / `ShootRocket` | 0.3 s loop / 0.2 s | launcher on the right shoulder; a bigger kick |
| `Punch2`, `Uppercut` | 0.33 s / 0.4 s | the second (left hook) and third hit of the 3-punch combo (`Punch` is the first) |
| `Stagger` | 0.3 s one-shot | rocked back by a hit, back to neutral |
| `Hail` | 1 s loop | arm raised to wave down a taxi (taxi fares) |
| `Cower` | 1 s loop | crouched, arms over the head (panicking bystanders) |
| `Cheer` | 1 s loop (optional) | for mission end cards / the title attract |

4. **Story characters** for the payphone missions (a tow crew, Vex and Lil'
   Tuna, against Deacon Pike), as separate body GLBs like §2: `vex`
   (overalls, tool belt, short hair), `tuna` (hoodie, big headphones, short
   and wide), `pike` (long coat over a suit, slicked hair). They only need to
   read as different silhouettes from 20–50 m up.
5. **Vehicles** (`vehicles.glb`, car contract): `tow_truck` (the crew's
   truck: boom and hook at the back, `amber` beacon) and `ice_cream_van`
   (a big roof cone, pastel `paint`, for fun).
6. **Activity props** (`props.glb`):
   - `start_gantry`: a chequered start/finish arch, ~12 m wide over the road
     (races).
   - `export_bay`: an open garage with a big '$' sign readable from above
     (car exports at the docks).
   - `safehouse_door`: a garage door with a light over it (the shop).
   - `frenzy_token`: a chunky floating '!' gem, ≤ 120 tris, origin at its
     centre (it spins and bobs).
   - `traffic_cone` and `road_barrier_long` (a 4 m concrete jersey
     barrier), for dressing roadblocks and races.
7. **Ambient life (optional, fun):** `pigeon` (≤ 40 tris, one rigid body,
   plus a `Flap` clip on a 2-bone rig) for flocks that scatter when a car
   comes through.

The code side will wire these in by name when they land, falling back to
today's stand-ins until then. Badge on the cop: the code side will add a
sixth fixed-colour slot so `*_badge` works; until then leave it out.

## 9. Two-wheelers (code side adds the physics)

The code side is adding bike handling (lean into turns, quick acceleration,
low health, rider thrown off in a hard crash), so the models can be built
now against this contract:

- **`scooter`** (civilian, ~1.8 m long, 0.7 m wide) and **`cop_bike`** (police
  motorbike, ~2.2 m, `siren_red` / `siren_blue` lights front and back) as new
  roots in `vehicles.glb`, with the usual car contract (`paint`, `trim`,
  `tyre`, `headlight`, `taillight` material names; origin on the ground at the
  centre; nose toward game +Z). ≤ 600 tris each.
- **Wheels:** name the front wheel `<arch>_wheel_FL` (one wheel on the centre
  line; the existing loader already steers anything matching `_wheel_F[LR]`)
  and the rear `<arch>_wheel_RL`. Origins at the hubs.
- **No rider in the model.** The rider is a normal character from the
  character batch, placed on the seat by the game. Add an empty named
  `<arch>_seat` at the hips position so the game knows where to put them.
- **Clip `Ride`** (1 s loop, in every character GLB): seated with the hips at
  the seat height of a scooter (~0.75 m), hands forward on the bars, feet on
  the deck. Barely moving, a slight sway is enough. The game leans the whole
  bike and rider together by rolling the root, so don't lean in the clip.
- Optional: `cop_bike` saddlebags in `trim`, and a windscreen in `glass`.

---

### Notes back to the code side

_Blender session 2026-10-30, branch `blender/assets`. Items 1–9 are all done
(the `cop_bike` from §5 landed with §9); §7, §8 and §9 notes are
at the end. Run
`python3 blender/check_assets.py` after `npm run assets`: it parses every GLB
and checks budgets, material names, bones and clip lengths against this file._

**1. Clips (`player.glb`, and every body below).** All clips key every bone, so
each one can be played or crossfaded on its own. Lengths are whole frames at 24 fps:

| Clip | Length | Notes |
|---|---|---|
| `Idle`, `Walk` | 2 s, 1 s | unchanged look, but see the timing fix below |
| `Run` | 0.625 s loop | authored for 5.5 m/s; exported as `runSpeed` next to `walkSpeed` in the rig's extras |
| `Punch` | 0.333 s | right jab; replaces the `punchArm` fake in `CharacterModel` |
| `Aim` / `AimBoth` | 0.292 s loop | one-handed (pistol) / two-handed (SMG, shotgun) |
| `Shoot` / `ShootBoth` | 0.125 s | full poses (aim + kick), not additive: play over the matching Aim |
| `Fall` | 0.5 s | ends flat on the back, head ~1.7 m behind the feet |
| `Down` | 1 s loop | lying, breathing |
| `GetUp` | 0.917 s | from `Down` back to standing |
| `EnterCar` | 0.5 s | reach and duck; hide the body at the end |

- `Fall` / `Down` / `GetUp` lay the body down with the **root bone** (rotated
  and lifted 0.15 m so the back rests on the ground). When playing them, stop
  tipping `CharacterModel.body` and base `lying` on the clip instead, or the
  body goes over twice.
- **Timing fix:** clips used to start at frame 1, so the exporter put the
  first key at 1/24 s. three.js held that pose for the gap, so every Walk
  cycle froze for a frame and ran 1.042 s instead of 1 s. Clips now key from
  frame 0.

**2. Bodies: one GLB each, not extra roots in `player.glb`.**
`CharacterBatch.useModel` merges every mesh in a file into one person, so
variants inside `player.glb` would all be drawn on top of each other. Each body
is a separate file with the same structure (one rig root, same 8 bones, same
clips), so it works with the existing loader as one more batch:
`new CharacterBatch('assets/cop.glb')`.
- `ped_slim.glb` (taller, narrow, backpack), `ped_stocky.glb` (broad, rounder
  torso, baseball cap), `ped_coat.glb` (knee-length coat/dress, long hair),
  `cop.glb` (peaked cap, short sleeves, duty belt and holster).
- Accessories are baked into the variants because the batch can't toggle
  parts per person. Their slots: backpack = `pants`, ball cap = `hair`.
- Cop: cap crown = `hair` (set it navy), brim, cap band, belt and holster =
  `shoes`. **No badge:** an unknown material suffix falls back to the
  `skin` slot, so a fixed-colour part isn't possible in a character file.
  If you want one, add a sixth slot to `SLOTS`.
- All bodies are 484–592 tris.

**3. `props.glb`:** roots `streetlamp`, `traffic_light`, `hydrant`, `bench`,
`trash_bin`, `dumpster`, `bollard`, `newspaper_box`, `mailbox`, `payphone`,
`ac_unit`, `vent`, `water_tank`, `satellite_dish`, `rooftop_door`, `antenna`,
`tree_round`, `tree_tall`, `palm`, `ramp`, `kicker` (40–204 tris).
- Origins are at the ground contact point. Roots are laid out side by side in
  the file, so reset `position` on load as `VehicleModels` does.
- `streetlamp`: the arm reaches 1.85 m toward the model's front (game +Z), so
  face +Z at the road. The head's underside uses material `lamp`.
- `traffic_light`: lenses `light_red` / `light_amber` / `light_green` face +Z.
- `ramp` (6 m long, 1.6 m lip, 3.2 m wide) and `kicker` (2.5 m, 0.6 m): the low
  edge is at −Z and the lip at +Z, so a car driving +Z goes up and off.
  The top of the lip uses a `hazard` stripe.
- `payphone`: a blue sign on a yellow hood, readable from above.
- Every material in this file is fixed colour.

**4. `weapons.glb`** (`pistol`, `smg`, `shotgun`; 48–88 tris):
- Origin is at the grip, the barrel points game +Z, and Y is up.
- Each root has a `muzzle` extra: the distance in metres from the grip to the
  muzzle along +Z, for muzzle flashes.

**`pickups.glb`** (`crate_pistol`, `crate_smg`, `crate_shotgun`, `health_kit`,
`package`, `cash`; 36–168 tris): origin is at ground centre. Each crate has the
gun lying on its lid plus a coloured stripe (pistol yellow, SMG orange, shotgun
red).

**5. `vehicles.glb`, new roots:** `police_suv`, `muscle`, `limo` (car builder),
and `bus` (12 m), `ambulance` (6 m), `firetruck` (9.2 m), `garbage_truck`
(8.6 m). All are under 700 tris, and the original seven are unchanged.
- The bodies use `paint`, so pick the colour at spawn: ambulance white, fire
  truck red, police SUV white (its doors/roof are `trim`).
- Siren bars use `siren_red` / `siren_blue` on `police_suv`, `ambulance` (cab
  bar plus two module corner flashers) and `firetruck`.
- New fixed-colour materials: `chrome`, `sign` (bus destination board),
  `amb_red`, `hazard`, `amber` (garbage beacon), `dark`.
- Extra rear axles on the trucks are named `_wheel_RL2` / `_RR2`. They don't
  steer, and the `_F[LR]$` test leaves them alone.

**6. `debris.glb`:** `door`, `hood`, `bumper`, `wheel`, `panel_a/b/c`, all
18–56 tris. Origins are at the chunk centre so they can tumble, and they use
only `paint` / `trim` / `tyre`.

**7. Police (second pass, same day).**
- **`heli.glb`**, its own file, because `VehicleModels` would merge the rotors
  into the body.
  - The root is `heli`: 476 tris, about 12.5 m long, with the nose toward
    game +Z and the origin on the ground under the skids.
  - `heli_rotor_main` (four blades, ~11 m disc) is a child node at the hub
    (0, 3.15, −0.2): spin it about local Y. `heli_rotor_tail` sits at
    (0.32, 2.35, −7.35): spin it about local X. Neither node is rotated, so
    their local axes match the root's.
  - The nose lamp uses material `searchlight`, and the belly strobes use
    `siren_red` / `siren_blue`. Everything else is fixed colour (dark blue,
    white tail boom and roof stripe, and the `glass` / `trim` materials).
- **`swat`** is a new root in `vehicles.glb` with the usual car contract:
  540 tris, 6 m long. It has a slab-sided armoured body with slit windows, a
  push bar, side steps, a roof rack and a cab light bar (`siren_red` /
  `siren_blue`). The body is `paint`, so paint it dark at spawn.
- **`Arrested`** is a 1 s loop in every character GLB: kneeling, with hands
  behind the head. The rig has no knees, so the hips drop 0.56 m and the
  straight legs lie back along the ground. Like `Fall`, it moves the root
  bone, so don't tip `CharacterModel.body` while it plays. The cop's peaked
  cap and holster are already in `cop.glb` (§2).
- **Props** (new roots in `props.glb`):
  - `barrier` (216 tris): a 2.4 m sawhorse with orange/white striped boards,
    facing ±Z.
  - `spray_booth` (120 tris): an open-fronted shell 6 m wide × 9 m deep ×
    4.5 m high, with **its mouth facing game −Z**. It has a magenta
    `spray_sign` over the mouth and on the roof edge (readable from above),
    a rolled-up door and a nozzle bar inside.
  - `police_sign` (72 tris): origin on the ground at the wall face, with a
    blue `police_lamp` at 3.4 m and a POLICE board at 3 m, both sticking out
    toward +Z. Glow `police_lamp` at night, the way `lamp` glows.

**8. Second round (same day).** All seven items are done, pigeon included.
`check_assets.py` knows the new clips, files and budgets.
1. **`weapons.glb`** new roots: `grenade`, `molotov`, `rocket_launcher`,
   `rocket`.
   - `grenade` and `molotov` have their origin in the middle of the fist and
     `muzzle` = 0. The molotov's neck and rag point up (+Y).
   - `rocket_launcher` has its origin at the pistol grip under the 1.1 m
     tube and `muzzle` = 0.76.
   - `rocket` (54 tris) has its origin at its centre with the nose toward
     +Z.
2. **`pickups.glb`** new roots:
   - `crate_grenade` (green stripe), `crate_molotov` (purple) and
     `crate_rocket` (white, and a longer 1.05 m crate so the launcher fits).
   - `armour` (a folded vest) and `ammo_box` (olive, with a yellow stencil
     band).
3. **Clips** in every character GLB (22 clips now):
   - `Throw` is 0.417 s, releasing at frame 5.5 (0.229 s, 55%).
   - `AimRocket` is a 0.292 s hold with the right hand at the tube's grip
     below the shoulder and the left hand forward on the tube.
     `ShootRocket` (0.208 s) is a full pose with a heavy kick that pushes
     the root back 0.12 m.
   - `Punch2` (0.333 s, left hook) and `Uppercut` (0.417 s, the right hand
     drives up at 0.21 s) both start and end at rest, so the combo
     `Punch` → `Punch2` → `Uppercut` can cross-fade.
   - `Stagger` is 0.292 s.
   - `Hail`, `Cower` and `Cheer` are 1 s loops. `Cower` kneels like
     `Arrested`, dropping the root 0.52 m, so don't tip the body while it
     plays.
4. **Story bodies**, one GLB each with the usual rig and clips:
   - `vex.glb`: overalls, with the bib and straps in the `pants` slot over a
     `shirt` tee, a tool belt with side pouches in `shoes`, and short
     orange `hair`.
   - `tuna.glb`: short and wide, with a hoodie (`shirt`, hood down at the
     back) and big headphones in `shoes`.
   - `pike.glb`: tall, with an ankle-length coat and raised collar
     (`shirt`), the suit in `pants` and slicked-back `hair`.
   - Default colours are set in the GLB. Override them through the
     palette as usual.
5. **`vehicles.glb`** new roots, both with the car contract:
   - `tow_truck` (6.3 m): cab, a low deck with lockers, a yellow `hazard`
     boom angled back with a cable and `chrome` hook, an underlift bar, and
     an `amber` beacon bar on the cab.
   - `ice_cream_van` (5.4 m): a pastel `paint` body. On the +X (left) side
     it has a serving hatch with a pink and white striped awning, and on the
     other side a pink sign band. A wafer cone with two scoops sits on the
     roof. New fixed colours: `wafer`, `scoop_pink`, `scoop_cream`,
     `awning_pink`, `awning_white`.
6. **`props.glb`** new roots:
   - `start_gantry`: a 12.5 m span across X, with a chequered beam at
     5.5–6.5 m that is two blocks deep, so it reads as chequer from the side
     and from above.
   - `export_bay`: an open garage 7 × 10 × 5 m with its **mouth facing game
     −Z** (like the spray booth) and a green `export_sign` lintel. The big
     '$' lies flat on the roof, with the top of the glyph toward −Z.
   - `safehouse_door`: wall-mounted like `police_sign`, with its origin on
     the ground at the wall face. It's a 3.2 × 2.9 m roller door facing
     +Z, with a `lamp` light over it.
   - `frenzy_token` (24 tris): a red `frenzy` '!' with its origin at the
     centre.
   - `traffic_cone`.
   - `road_barrier_long`: a 4 m jersey barrier along X with a hazard band
     on top.
7. **`pigeon.glb`** (34 tris):
   - A rigid body under the armature object, plus bones `wing.L` / `wing.R`
     with one wing each. The rest pose has the wings folded.
   - `Flap` is a 0.25 s loop that spreads the wings and beats them.
   - The origin is on the ground with the beak toward +Z, and every
     material is fixed colour.
- **File sizes:** the character GLBs are ~165 KB each, but only ~70 KB of
  that is animation data. The rest is glTF JSON (an accessor per channel),
  which gzips well over HTTP. I couldn't make the Blender exporter options
  shrink it. If it matters, strip the constant translation/scale tracks at
  load time or with gltf-transform.

**9. Two-wheelers (same day).** `check_assets.py` checks the wheel names and
the `_seat` empty.
- **`scooter`** (208 tris, 1.8 m) and **`cop_bike`** (332 tris, 2.2 m) are new
  roots in `vehicles.glb`.
  - Each has one front wheel `<arch>_wheel_FL` and one rear wheel
    `<arch>_wheel_RL`, both on the centre line with origins at the hubs.
    Wheel radius is 0.22 m (scooter) and 0.32 m (cop bike).
  - Body panels are `paint`, and the seat, bars, forks and engine are
    `trim`.
  - `cop_bike` has `siren_red` / `siren_blue` pairs on the fairing (front)
    and on a mast over the rear rack. It also has a `glass` windscreen,
    `trim` saddlebags and a `chrome` exhaust.
  - The seat cushion mesh is called `<arch>_saddle`, so its name can't
    clash with the empty.
- **`<arch>_seat`** is an empty (a node with no mesh) at the rider's hip
  position:
  - scooter: (0, 0.75, −0.32) in glTF coordinates, i.e. 0.32 m behind the
    centre.
  - cop_bike: (0, 0.86, −0.28).
- **`Ride`** is a 1 s loop in every character GLB. It drops the root so the
  hips sit **0.75 m above the character's root on every body** (short Tuna
  and tall Pike included).
  - **Put the rider's root at the seat position minus 0.75 m in Y**, with
    the same heading as the bike. The feet then land on the scooter's deck,
    and the hands land on the bars of both bikes; I checked this in three.js
    for player, tuna, pike and cop.
  - There's no lean in the clip, only a slight shoulder sway.
- **Known issue:** Pike's ankle-length coat is rigid on the hips, so when
  he's seated it hangs straight down through the bike. If he needs to ride,
  either accept it or tell me and I'll split the coat onto the leg bones.

---

### Code side integrated: people (2026-10-30, branch `stage6/people`)

Wired in (README → *Look → People* has the details):

- **Clips (§1, §7, §8.3):** all 22, by name, sampled per bone without an
  `AnimationMixer` (`render/characterAnim.ts`). Walk/Run share one gait
  phase at the exported `walkSpeed` / `runSpeed`. Aim / AimBoth / AimRocket
  by weapon with Shoot / ShootBoth / ShootRocket per shot, Punch → Punch2 →
  Uppercut for the combo, Throw, Stagger, Fall → Down → GetUp, Arrested
  (BUSTED), EnterCar (at the driver's door, then the body is hidden),
  Hail (taxi fares, mission characters waiting), Cower (timid bystanders
  beside gunfire), Cheer (mission pass, Chaos Run medal), Ride (API only:
  `model.riding`, root at the seat minus 0.75 m). As the notes asked,
  `CharacterModel.body` is no longer tipped while Fall / Down / GetUp /
  Arrested / Cower play: the root bone lays the body down. The upper-body
  clips are laid over the legs on arm.L/R, chest and head only.
- **Bodies (§2, §8.4):** one batch per GLB. The crowd mixes `player`,
  `ped_slim`, `ped_stocky`, `ped_coat`; officers wear `cop`; Tuna wears
  `tuna`, Vex waits at the docks yard in `vex`, Pike guards his car in LAST
  CALL in `pike`, and the Collector wears `pike` in white.
- **`*_badge`:** the sixth palette slot exists (fixed colour: the GLB's own,
  never an outfit's). A badge mesh on `cop.glb` with a `cop_badge` material
  will just work.
- **Weapons (§4, §8.1):** all six in the right fist (grip origin, barrel +Z),
  one instanced draw call; the `muzzle` extra places muzzle flashes and
  tracer starts. `rocket` isn't used yet (projectiles keep their stand-in).
- **Pigeon (§8.7):** body + `wing.L` / `wing.R` with `Flap` sampled into
  the vertex shader; flocks scatter at cars, runners and gunfire.

What looks off in game, for a future adjustment pass (judged from 20 m up
on the iPhone profile and 27 m on desktop, by day and at night):

1. **Weapons read as thin dark slivers.** From 20–27 m the pistol and
   SMG are a few dark pixels against the arm; the grenade and molotov
   vanish in the fist. Chunkier silhouettes (+30–50% across) or a light
   accent (the crate stripe colours: pistol yellow, SMG orange, shotgun
   red) on the top of each gun would make the held weapon readable.
2. **AimRocket holds the tube low.** The right hand sits ~0.33 m below the
   shoulder and the tube only 0.11 m above the grip, so the launcher reads
   as hip-held rather than on the shoulder. Raise arm.R in AimRocket /
   ShootRocket, or move the tube higher over the grip in `rocket_launcher`.
3. **Cops from above.** The cap crown is the main read; the game now uses a
   lighter police blue shirt and navy cap, but a light cap band or the badge
   (now possible, see above) would set officers apart from dark-clad
   civilians at night.
4. **Street bodies from 27 m.** The stocky ball cap (the game gives it cap
   colours) and the coat's hem read; the slim body's backpack barely shows
   from above. A bigger, boxier backpack would help.
5. **GetUp is often rushed.** Ordinary knock-downs last 2.5 s and the game
   starts GetUp 0.7 s before the ped may move, playing it up to 2.2× to
   fit. A second, quicker `GetUpFast` (~0.5 s) would look less sped up.
6. **Throw releases late for the game.** The game throws on the press (the
   grenade leaves at once), so the clip starts 0.1 s in at 1.6× (release
   ~0.08 s after the press). A clip with its release at ~25% would line up
   without speeding it up.
7. **Pigeons are hard to see at night** (dark grey on dark asphalt, 34
   tris, drawn 1.3× by the game and lit by street lamps). A paler back or
   white wing bars would keep flocks readable after dark.
8. **Pike at night:** the black coat on dark asphalt nearly disappears; a
   lighter collar or lapels (`badge` or `hair` slot) would help. Vex's
   orange hair and Tuna's teal headphones read well from above.

## Code side integrated: world, props and vehicles (stage 6)

props.glb, pickups.glb, debris.glb, heli.glb and the twelve new
`vehicles.glb` roots are now in the game (see README → *World*). Material
names are the contract: `lamp`, `light_red/amber/green`, `police_lamp`,
`spray_sign` / `export_sign` / `payphone_sign` / `stripe_*`, `hazard` /
`cone_orange` / `barrier_orange`, `ramp`, `frenzy`, `booth_roof`,
`searchlight`, `siren_red/blue` and `paint` get special shading; keep
them. Root names are looked up by name, and the bikes' `<arch>_seat`
empties and the helicopter's `heli_rotor_main` / `heli_rotor_tail` nodes
are used.

Things that look off from the game camera (high, near top-down), for a
future Blender pass. The code works round each one for now:
- ~~**Near-black tops on the rooftop kit.**~~ Done: `rooftop_door_roof`
  is `tar_roof` (tar grey, about 0.12 linear) and `water_tank_roof` is
  `tank_lid` (weathered boards), so the code's `PART_COLOURS` recolour
  is gone.
- **Lamp and signal heads are tiny from above.** The `streetlamp` head and
  the `traffic_light` lenses are a few pixels on a phone, and the lenses
  face along the road, so from above you can't see which one is lit. The
  code draws a coloured glow beside the lit lens and a pool on the lanes
  at night. A top-visible hood or backplate in the signal's colour (or a
  slightly bigger head) would help.
- **The police sign and the safehouse door are hard to spot.** They're flat
  on a wall and often sit under the building's awnings, so from above the
  door is mostly hidden and the sign is a thin blue line. The code adds a
  night halo for each lamp. A small canopy, or a lamp box that pokes out
  over the pavement, would show from above.
- **The spray booth roof (`booth_roof`, 0.08) is very dark at night,** so
  only the sign reads. Try a lighter roof or a painted stripe. (The code
  cuts the roof away while the player is inside.)
- **`start_gantry` is 12.5 m between pillars, but roads are 16 m wide,** so
  the code stretches it ×1.376 across to put the pillars on the kerbs
  (±8.6 m). Building it at that span would keep the chequers square.
- **The pickups are life-size** (0.3–0.6 m), which is too small at the
  game's zoom. They're drawn ×1.7. Modelling them about 1.5× would let
  the code drop the scale.
- **`heli` is life-size** (about 12 m). It flies under the camera, so
  perspective blows it up, and it's drawn ×0.55. That's fine as it is,
  just don't be surprised.
- **`panel_a`–`panel_c` are `paint` only.** They tumble as flat chips of
  colour, and at night they're black specks. A `trim` edge would give them
  some shape (the door, hood, bumper and wheel are fine).
- **Bikes:** Pike's coat still passes through the seat when he rides, as
  noted in §9.
