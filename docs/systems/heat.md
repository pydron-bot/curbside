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
of sight one star drops, and the clock restarts on the next (3★ ≈ 36 s
unseen). Sightings and witnessed crimes reset it; the radio keeps units on
your real position for 2 s after each sighting.

**Response** (`systems/police.ts`): units by stars 2 / 3 / 4 / 6 / 7 (at
1–2★ half of them may be a police bike, one officer, never more than one
on the road; from 3★ half the cars are police SUVs; SWAT trucks from 4★,
220 HP), arriving one at a time on a lane 75–140 m
away from where the police believe you are (your real position only
while they're seeing or tracking you, so breaking line of sight works),
out of view, heading your way and already rolling (mostly ahead on a
fresh call, from all round mid-chase, so outrunning them can work). Sight:
each car sees you within 20 m, or 62 m with a clear line past buildings
(officers 15 / 40 m), checked 4×/s per unit (one ray per car) and shared
over the radio. Units 210 m from the last sighting out of view, or wedged
for good, recycle and a fresh one comes. 1–2★ follow and box you in; from 3★ they ram and PIT, and every
25 s at speed a roadblock (2–3 cars across the road 120–170 m ahead,
mid-block, officers behind them) goes up; from 4★ passengers shoot at your
car (every ~2 s within 20 m); 5★ adds the helicopter
(`systems/helicopter.ts`): a shadow and a searchlight that keeps you seen
while it's on you, flying at 27 m/s so a fast car can outrun it, and
leaving to refuel for 30 s after every 45 s on station (longer than the
21 s unseen that drops a star at 5★). Stopped near you, officers get out (crowd peds
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
over your speed every 2.6 s and PIT the rear quarter; box in a stopped car
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
officers, the helicopter. All the faked light (searchlight, bays, station)
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
// Bus: { type: 'wanted', level, prev, reason } · { type: 'busted', fine } · { type: 'horn', x, z, duration }
//      { type: 'respray', x, z, cleared }; pedDown/explosion/bulletHit/enterVehicle carry `cop` / `police` flags.
```
