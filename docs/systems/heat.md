# Heat

Mayhem has a cost now. **Wanted level** (`systems/wanted.ts`, pure): heat
0–5, stars = floor(heat). A crime counts if it's on screen or within 60 m
of any police (car, officer, helicopter): knocking someone down +0.3
(with your own car: `stepCrowdPed` reports the car that hit them, so a
unit running down its officer beside you isn't on you),
carjack +0.35, a shot +0.05 (at most +0.5 per 5 s), an air horn blast
+0.1 (a nuisance: at most +0.2 per 5 s), tasing someone as knocking them
down (an officer +1), a civilian's tyres on your stinger as a nuisance
(a patrol car's as shooting at the police; nothing while you're wanted),
an explosion you
caused +0.6 (not your own car going up, even after you bail out of it
burning: `explosion.ownCar`; a sticky charge's is its car's explosion or a
grenade's, seen where it goes up, and sticking one on is no crime), clearly ramming a police car
+0.6 (bumps in a chase don't count, nor does smashing through a roadblock
or a chasing cop driving into you), bullets into one +0.15 (capped),
knocking down an officer +1 (at most +1 per 5 s), wrecking a police car
+1; stealing one sets at least 1★, and taking a police chase's getaway
at least 2★ (`tookGetaway`; both in `CRIME_FLOOR`: they count unseen).
Flooring a fleeing suspect (a chase's, a mugger: `pedDown.suspect`) isn't
an assault. Knocking a civilian down and carjacking
seen only by passers-by (no police near) wait for one of them to phone it
in, 3–5 s, and can be stopped (City life, [*Witnesses*](city-scenes.md)). Civilian crimes stop at 3★; 4–5★ need
attacks on the police. Below a star, heat fades after 10 quiet seconds.
A new star (or a witnessed crime) is called in: for 8 s dispatch tracks
you while units respond, and the evasion clock waits. **Evasion:** once no
cop has seen you for 1.5 s the stars blink; after 6 s + 3 s per star out
of sight (but at most 15 s at 4★ and 16 s at 5★, `EVADE_TOP`) one star
drops, and the clock restarts on the next (3★ ≈ 36 s unseen, 5★ 67 s).
Sightings and witnessed crimes reset it; the radio keeps units on your real
position for 2 s after each sighting.

**Ways to lose them** (stage 4; rules in `systems/wanted.ts`, pure and tested
in `tests/chaseRules.test.ts`):

- **NEW WHEELS:** getting into a car this chase hasn't seen you in (`Heat`
  keeps the set, from the car the chase started in), while no cop can see
  you, halves the wait for the current star (`NEW_WHEELS_SHARE` 0.5) until
  it drops or they spot you. Once per star, so hopping between two cars adds
  nothing; a police car never counts. The scanner doesn't call a switch it
  didn't see. HUD: a NEW WHEELS pop and a yellow `NEW WHEELS · ½ THE WAIT`
  line under the stars.
- **LYING LOW:** stopped (under 0.6 m/s; on foot, under 0.4) in a car park
  or an alley while unseen, the evasion clock runs twice as fast
  (`LIE_LOW_RATE`). Hideouts (`systems/hideouts.ts`) come from the city data:
  every block the ground draws as a car park, and every gap of 2.5–6 m
  between two buildings of a block facing each other along 8 m or more with
  nothing standing in it (the gaps the dumpsters use); a block-sized grid
  finds the one you're in without allocating. HUD: in one while wanted, a
  small line under the stars (`ALLEY · STOP TO LIE LOW`, green `LYING LOW ·
  2× FASTER` once it counts); the first time on a device it says `CAR PARK:
  STOP OUT OF SIGHT TO LIE LOW` for 6 s (`localStorage`
  `curbside.hint.lieLow`).
- **Where they think you are:** while wanted and the police don't know where
  you are (not seen, not tracked), the radar shows a cross on their last
  sighting (`police.target`, where the units are driving) and a dashed
  search ring round it, 20 m wide when they lose you and growing 7 m/s to
  140 m (`searchRadius(police.lostFor)`). Reinforcements spawn round that
  point, never within 110 m of you while they've lost you
  (`LOST_SPAWN_CLEAR`: a car appearing round the corner from someone nobody
  can find handed the chase straight back).

**See it coming:** a roadblock going up raises a `roadblock` event (its
centre and the way you're coming); the scanner calls it (`ROADBLOCK UP IN
<district>…`, cooldown 10 s) and the radar marks it with a pulsing red `=`
blip, pinned to the rim while it's off the radar, until it packs up. It goes
up 120–170 m ahead, so a few seconds before you get there.

**GOT AWAY:** losing the heat (reason `evaded`, not a respray: a respray you
paid for pays nothing back) pays cash by the chase's peak stars plus so much
a second wanted at 2★ or more (`Wanted.chaseTime`, first 180 s), capped at
$1,500 (`getawayPay` in `game/heat.ts`): 2★ $75 + $0.5/s, 3★ $200 + $1/s,
4★ $400 + $2/s, 5★ $700 + $3/s. Nothing below 2★, so a star gained and lost
in a loop is worth nothing; a quick 2★ is under $100, two minutes at 5★
about $1,000 (a good story job). The 'wanted' event carries `peak` and
`chaseTime` on `evaded`; the progress director pays it as `GOT AWAY +$…` in
the feed with the register's ching, in free roam and jobs but not in the
Chaos Run or a race (their EVADED points already count). As cash earned it
adds to the life's CRED (cash / 50, [CRED.md](../CRED.md)).

**Response** (`systems/police.ts`): units by stars 2 / 3 / 4 / 5 / 6 (at
1–2★ half of them may be a police bike, one officer, never more than one
on the road; from 3★ half the cars are police SUVs; SWAT trucks from 4★,
1 then 2, 220 HP), arriving one at a time (every 5 / 3 / 2 / 2.2 / 2 s) on a lane 75–140 m
away from where the police believe you are (your real position only
while they're seeing or tracking you, so breaking line of sight works),
out of view, heading your way and already rolling (mostly ahead on a
fresh call, from all round mid-chase, so outrunning them can work). Sight:
each car sees you within 20 m, or 62 m with a clear line past buildings
(officers 15 / 40 m), checked 4×/s per unit (one ray per car) and shared
over the radio. Units 210 m from the last sighting out of view, or wedged
for good, recycle and a fresh one comes. 1–2★ follow and box you in; from 3★ they ram and PIT, and every
25 s at speed a roadblock (2–3 cars across the road 120–170 m ahead,
mid-block, officers behind them, who fire at a car coming through from 8 m)
goes up; from 4★ passengers shoot at your car within 20 m (each car every
~5 s at 4★, ~6 s at 5★, and the whole force at most once every 3 / 4 s,
`FORCE_SHOT_GAP`); other officers on foot don't shoot at a moving car; 5★
adds the helicopter (`systems/helicopter.ts`): a shadow and a searchlight
that keeps you seen while it's on you, flying at 24 m/s so a fast car can
outrun it, and leaving to refuel for 40 s after every 30 s on station
(longer than the 16 s unseen that drops a star at 5★). Searching (not
knowing where you are) they cruise at 20 / 22 / 25 / 23 / 23 m/s. Stopped near you, officers get out (crowd peds
with role 'cop', navy uniforms through the outfit palette): they run you
down at 5 m/s (you sprint at 6), go for your door if your car is stopped,
and shoot from 2★ at someone armed or running (from 3★ on sight), but
never at someone standing still with empty hands: they come to cuff
them, so giving up is always a way out alive. When the heat drops, spare
units collect their officers (waiting at most 12 s for them) and go back
to patrolling as traffic. A unit whose car is wrecked, on fire or stolen
fights on on foot. Police cars are lent by Population (`takeVehicle`,
flagged `police`, so traffic upkeep leaves them alone).

**Pursuit driving** (`systems/pursuit.ts`, pure): without its own clear
view, or over 70 m away, follow the lanes junction to junction toward
where you are (or were last seen) — driveAi in a hurry: half the gap,
12 m/s corners, overtaking through the oncoming lane, the turn at each
junction chosen toward the goal, and traffic's unstick logic; in view,
steer for an intercept point (lead = gap ÷ closing speed, ≤ 1.2 s),
swerving round cars, settling 10 m behind; from behind or alongside only
(never head-on: an oncoming pursuer slows, passes and turns), ram at 5 m/s
over your speed every 2.6 s (3.4 s at 4★, 4 s at 5★: `ramEvery`) and PIT the rear quarter; box in a stopped car
(near end, far end, sides). Backs out of walls like traffic.

**Busted** (`systems/arrest.ts`): on foot, an officer within 1.3 m for 1 s
while you're slower than 2.8 m/s (0.5 s if you're knocked down); in a car,
under 1 m/s for 2 s with a police car touching or an officer at your door.
A meter under the stars shows the grip; it waits while a 3-2-1 holds the
car (`HeatDeps.held`). Busted: 25% of the run score
fined (`HeatDeps.bustFine`; none in a Chaos Run, where being cut short is
the cost, so its results add up), weapons taken, held 3.5 s (BUSTED
screen, blue: points lost and the cash fine), then released on
the steps of the police station (blue marker, ★ on the radar). Dying also
clears the heat.

**Pay 'n' Spray** (`world/landmarks.ts`): four bays on open lots, one per
quarter of the city (glowing gates, 'S' on the radar; the nearest pulses
and points the way while you're wanted). Stop inside for 2 s: new paint,
fully repaired, and the heat is gone, unless the police saw you drive in.
It costs `SPRAY_COST` ($400, $100 with the shop's spray card), charged
through `HeatDeps.pay`: broke means no respray.

**Traffic reacts** (`systems/traffic.ts`): hit a driver hard and 55% panic
(twice cruise speed, half the gap, honking, through corners) for 10 s,
25% road-rage after you with the pursuit controller for 12 s (no arrests),
20% stop and bail out. Drivers held up by you honk after 1.5 s, panic near
gunfire, and pull over to the kerb and slow for a siren behind them (or
coming head-on).

**Score:** COP RAM 200, COP CAR WRECKED 750, EVADED 1,000 × peak stars
for losing a 3★+ chase; joining a city police chase (City life, *Traffic
scenes*): TAKE THE HEAT 500, CITIZEN'S ARREST 400, HAVE-A-GO HERO 250.
Officers never fire on a player with no stars (`holdsFire`, checked in
main.ts's crowd step: a scene's officer whose own fight is over would
otherwise fall back on the player). **Audio:** a star gained plays the star sting, a
chase lost or resprayed the success chime, BUSTED its own sting (cuffs,
cell door) with the world muffled; the wanted level is the music's
intensity floor; sirens wail, yelp when ramming, two-tone when boxing in
(the nearest five); the helicopter has a rotor loop (`audio.rotor(x, z)`);
honks are `horn` events. **HUD** (`ui/wantedHud.ts`, `wanted.css`): five
stars under the pause button that flash in with a "WANTED / HOT PURSUIT /
ROADBLOCKS / SWAT / CHOPPER" pop, blink while you're out of sight, fade
with "EVADED"; arrest and respray meters. The police scanner calls each
star with your car's colour and the district (City life, *Police
scanner*). Radar: flashing police cars,
officers, the helicopter, a roadblock's `=` marker and, while they've lost
you, the search ring (*Ways to lose them*). All the faked light (searchlight, bays, station)
goes through the shared glow batch (`render/heatLook.ts`): no extra draw
calls beyond one instanced police-car mesh.

**Tuning** was done headless: a copy of the sim loop drives a getaway car
against each level over many seeds (`__ub.fastForward(seconds)` does the
same in the browser). Over 3 minutes, a sports car whose driver turns
away from the police at each junction shakes a 3★ chase about half the
time (and drops at least a star in all but 1 in 8), and gets 5★ down to
4★ or 3★ about 3 times in 4; a reckless driver taking random turns
escapes far less often (drops a star at 3★ about 1 time in 2). Resprays
and wrecking pursuers are the other ways out. Most damage in a chase
comes from the player's own crashes.

**Stage 4 (2026-11-14): 5 stars you can survive.** Measured with
`tools/tune/heat.mjs` (20 seeded chases, 180 s, [testing.md](testing.md)),
the 5-star sports car went from lost in a median 40 s to 101 s. What
changed, all at 4–5★ unless said: the player's car takes 0.25 / 0.15 of
crash damage instead of 0.6 (`PURSUIT_CRASH_SHARE`, 0.5 at 3★; by the
chase's peak, so a car that brought 5★ down to 3★ keeps it: `Heat.crashShare`);
passengers fire every ~5 / 6 s (was 2.2) and the force at most every 3 / 4 s
(`FORCE_SHOT_GAP`); officers on foot no longer shoot at a moving car, a
roadblock's only from 8 m (most of the bullets were theirs); rams every
3.4 / 4 s; 5 / 6 units (was 6 / 7), SWAT 1 / 2 (was 2 / 3), every 2.2 / 2 s
(was 1.6 / 1.2); searching at 23 m/s; the helicopter at 24 m/s (was 27),
30 s on station and 40 s away (was 45 / 30); 15 / 16 s unseen a star (was
18 / 21); and at every level no reinforcement within 110 m of a player
the police have lost. Before → after (stock car; tough car = health kept
topped up, evasion alone):

| 20 chases | escaped | busted | car lost | lasted (median) | ≤4★ |
|---|---|---|---|---|---|
| 5★ stock | 0 → 1 | 0 → 1 | 20 → 14 | 40 → 101 s | 3 → 8 |
| 5★ tough | 0 → 1 | 4 → 2 | – | – | 8 → 11 (≤3★ 2 → 8) |
| 3★ stock | 1–2 → 3 | 0 → 0 | 18 → 17 | 39 → 93 s | – |
| 3★ tough | 4 → 8 | 0 → 3 | 2 → 0 | – | – |

Damage a 5★ chase did to the car (55 HP either way, in 2.5× the time):
walls 27% → 7%, bullets 52% → 40%, other cars 21% → 53%. The target was a
median of 75 s or more (met) and 3 escapes in 20 (missed: 1 in 20, 1 in 40
over 40 seeds; a full escape needs about 70 s unseen and the bot rarely
manages it at 3★ on the way down). 3★ is no walkover: the stock car is still
lost in 17 of 20, and 3 escape.

The ways out, each as a bot habit (`--wheels`, `--lielow`, `--believed`).
The bot breaks line of sight rarely and by luck, so it's also run starting
lost (`--lost`: put 4–5 blocks from the last sighting, tough car). Escapes
of 20, median time to clean:

| | plain | NEW WHEELS | LYING LOW | WHERE THEY THINK |
|---|---|---|---|---|
| 5★ stock | 1 | 1 (lasted 127 s: a fresh car) | 0 | 3 |
| 3★ tough, lost | 7 (40 s) | 4 (24 s) | 1 | 10 (34 s) |
| 5★ tough, lost | 2 (67 s) | 1 (45 s) | 0 | 5 (80 s) |

Steering away from the search ring is worth the most to the bot. NEW
WHEELS gets it clean sooner when it works but costs a 2 s stop that gets
it boxed in more often (busted 0 → 6 of 20 at 5★, starting lost). The bot can't use LYING
LOW: driving in at walking pace it's seen on the way (a car passing an alley
used to see you from 20 m whatever the walls: lying low now needs a clear
line past 7 m, `HIDDEN_PROXIMITY`) and stopping where units pass gets it
cuffed. The rules themselves are exact (tests); whether people use them is
for the owner's play. GOT AWAY paid $992 for the 5★ escape, $237–703 at 3★
(more where the chase climbed).

API for other systems:

```ts
heat.wanted.level / .heat / .searching    // read the stars
heat.wanted.commit(crime, witnessed)      // report a crime ('assault', 'carjack', 'gunfire', ...)
heat.wanted.force(stars)                  // scripted chases, missions
heat.wanted.clear(reason)                 // e.g. a mission's reward
heat.called(crime)                        // a witness's call got through (HeatDeps.witnesses held it: City life, Witnesses)
heat.police.units / .heli / .seen          // read the response
heat.adopt(v, aboard)                     // a scene's police car joins the pursuit (police.adopt, within the level's unit cap)
heat.shops / heat.station                 // landmarks (world/landmarks.ts)
heat.hideouts.at(x, z) / heat.hideout     // car parks and alleys (systems/hideouts.ts)
heat.wanted.newWheels / .lyingLow / .chaseTime / .switchedCar(seen) / .hiding
heat.crashShare                            // the player's car's crash share now
heat.police.target / .lostFor / .roadblock // the believed position, seconds lost (searchRadius), the latest roadblock
getawayPay(peak, seconds)                 // game/heat.ts
// Bus: { type: 'wanted', level, prev, reason, peak?, chaseTime? } · { type: 'busted', fine } · { type: 'horn', x, z, duration }
//      { type: 'respray', x, z, cleared } · { type: 'roadblock', x, z, dirX, dirZ };
//      pedDown/explosion/bulletHit/enterVehicle carry `cop` / `police` flags.
```
