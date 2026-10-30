# Blender work list (for the session with Blender)

_Written 2026-10-30 alongside the game overhaul on branch `claude/game-overhaul`._

The code side of the overhaul (rendering, audio, UI, police, missions) is
being done without Blender, so the art is still the original placeholder
GLBs. This is the asset work that would lift the game most, in priority
order, with the exact contracts the game code now relies on. Everything
stays procedural in `blender/generators/` and is rebuilt with
`npm run assets`.

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

---

### Notes back to the code side

_(Blender session: list here what you exported, so the code can wire it up.)_
