# City life: street scenes

Scenes run by the `CityLife` director; the director, budgets and how to add a scene are in [city-life.md](city-life.md).

**People** (`scenes/buses.ts`, `iceCream.ts`, `vendors.ts`, `buskers.ts`,
`fights.ts`, `muggings.ts`, `witnesses.ts`, `pavement.ts`; rules in
`systems/streetPeople.ts` and `systems/witnesses.ts`, tested). The scenes
hold at most 24 people between them (`scenes/people.ts` PEOPLE_CAP: on
top of the crowd's own count, so past it queues and crowds stop drawing
people in).

- **Bus stops**: the 86 shelters (`dressing.street.busStops`, `life.stops`)
  are the only stops. The four nearest within 110 m gather riders over
  time: passers-by drift over and wait in a line along the front facing
  the road (a Gathering crowd placed by `shelterSpot`, 4–5 each, giving up
  after 70–150 s), and one coming into range out of view may already have
  one or two waiting. A bus near the player (in traffic, or brought in
  every 45–90 s while people wait and none is about) turns at junctions
  toward the nearest shelter with riders (`routeToward`), pulls in at its
  bay (`pullIn` to stopX/Z), hisses open (`busStop`): one or two step off
  the middle door and walk on, the riders walk to the front door and
  vanish into it, and it pulls out once they're aboard (4–14 s). It stops
  at an empty shelter 30% of the time.
- **The ice cream van**: one in traffic within 150 m (or one brought in
  every 90–180 s) pulls in mid-block at the kerb (`BUS_PULL_IN`), beside a
  park or open plaza (anywhere else 25% of the time), every 30–60 s;
  `iceCream` plays the jingle; passers-by queue at the hatch on the
  pavement side (Gathering queue, 6, one served every 3.2 s: a cheer and
  `iceCreamServed`); it shuts after 16–40 s and drives on. Take it while
  it's open and the queue comes after you: *VAN NICKED*, below.
- **Food carts** (`dressing.street.vendors`): the five nearest within 90 m
  get a vendor at `vendorX/Z` (put there out of view) and a queue at the
  serving side, served every 4.5 s. How readily people join follows the
  hour (`cartBusyness`: a lunch peak at 13:00 and an evening one at
  18:30, near nothing in the small hours); a cart coming into range at a
  busy hour may already have a customer or two. A kerb cart's first
  customer stands on the walking line; the rest step off it toward the
  shopfronts (`cartSpot`), and **walkers step round** anyone a scene holds
  standing (`Pavement`: eased across their way, `sidestep`, before the
  static collision), so nobody walks through a queue or jams on it.
- **Buskers**: every 50–120 s (not while wanted) a busker sets up at the
  edge of an open plaza or a park 25–90 m off, out of view, facing the
  pavement, and dances (the Cheer clip, a wave every few beats) for
  70–110 s; up to 7 passers-by watch in an arc in front (Gathering crowd)
  for 12–28 s each, and now and then one tips: a coin glints in an arc
  into the hat (`peopleLook`).
- **Scuffles** (at most two, `BUSY`): someone running (a ped fleeing,
  or the player sprinting) barges a walker (`barges`): the player knocks
  them into whoever's beside them and those two square up; a fleeing ped
  is gone after by the one they barged (any temper, or a calm one 40% of
  the time). Also a stray round from someone else's gun (a temper, or one
  in three, goes for a passer-by who fired it) and someone pushing in at a
  cart or the ice cream van (`Fights.queueJump`). A shove each way, then
  the one shoved backs down and walks off (35% if calm, 10% if not), or
  6–10 s of fists (`setOn` both ways; knocked over, the other stands over
  them till they're up). 30% end in a knockout (the loser starts low), the
  ambulance comes for them; otherwise the more hurt walks off and the
  other raises a fist. Up to 7 watch in a ring (Gathering crowd).
- **Muggings** (every 90–180 s, `BUSY`): a passer-by on screen 10–40 m
  off is rushed by someone close by, who snatches their bag (`mugging`)
  and sprints corner to corner round the blocks, crossing at the corners
  (`nextCorner`), ringed in red; the victim shouts and points (waving,
  facing them) for 5 s. Knock the mugger over and the bag drops (a pulsing
  amber ring, 45 s): walk over it to hand it back (`bagReturned`, the
  victim cheers: HAVE-A-GO HERO, the `haveAGo` award and **$50** through
  `deps.reward` → `progress.pay`; cash, not CRED; the taser floors one
  too). Knocking the mugger
  down isn't an assault (`PedAgent.suspect` while they run) nor called in
  by passers-by. Ignored,
  they get away (65 m clear, or 35 s).
- **Witnesses** (`heat.ts` hook `witnesses`, `scenes/witnesses.ts`): a
  **lesser crime** (`DELAYED_CRIMES`: knocking a civilian down, a
  carjacking) that only passers-by saw (on screen, no police within 60 m)
  goes to whoever saw it: within 26 m and facing within 75° of it (or
  right beside it), the five nearest. The nearest calls it in on their
  phone (the one-handed aim pose with nothing in the hand, `CrowdPed.phone`,
  and a lit screen in the glow batch); one in five of the rest calls too
  (at most two per crime), half film it, the rest run. The call takes
  3–5 s; it gets through (`heat.called(crime)`: the heat lands and the
  police get a fix on you, `witnessCall`) unless every caller is knocked
  down or scared off, or you get 45 m from them first. A second crime
  close by while a call is on goes on the same call. With nobody who saw
  it (or no phone free: 6 at once), heat counts it at once as before.
  Gunfire, explosions and everything against the police stay immediate.
  After a named-mayhem stamp (Effects and camera, *Named mayhem*),
  `witnesses.film(x, z)` stops up to four passers-by walking in view (not
  within 6 m) to film it for 3–5 s: people already on the street, inside
  the scenes' people cap and the 6 phones, no call made.
- **Fires and fire trucks** (`scenes/fireCrews.ts`; rules in
  `systems/emergency.ts` FireBoard): a car that blows up leaves its wreck
  burning (the fire follows it if it's shoved), a grenade or rocket within
  4.5 m of a building sets the wall alight. A fire flares up over 2.5 s,
  burns 75 s and dies down over the last 12 (a blast within 5 m feeds it
  instead); 6 at most (a new one takes the oldest's place). After 4 s a
  fire within 150 m with 20 s still to burn calls a fire truck
  (ServiceRun, `#c3191c`, lights and siren). It pulls up, the siren stops
  (lights on), two firefighters (`ped_stocky`, tan coat, yellow helmet)
  step down, walk to either side of the fire and hose it: 7 s for a full
  fire with one hose, half that with two (hosed down, it never flares
  back); then back in and off as traffic (take the truck while they're
  out and they hose on by hand: *Borrowed Blues*). 2 trucks at most; none behind
  the title, in a timed race or quiet mission, or the cold open (fires there burn out by
  themselves). The look (`render/emergencyLook.ts` fireLook): bigger
  flame particles than a burning car's, smoke from 3 m downwind (it's
  drawn over the flames), embers, a flickering orange pool on the ground
  (brighter at night); arcing water drops (streaks in the smoke pool,
  started along their flight so a slow frame still shows a jet) and steam
  where they land. Nothing hurts anyone (a molotov's fire still does).
  Street events: `fire`, `fireTruck`, `hose` (the pump's hiss), `fireOut`.
- **Tow trucks** (`scenes/tows.ts`; `towPose`, `towPriority`, `winch` in
  `systems/emergency.ts`): every 45–90 s (`BUSY`: none in a timed race,
  the cold open or behind the title; less often while wanted) a tow truck (`tow_truck`,
  `#e8b923`, claimed in traffic within 140 m or brought in) comes for a
  car within 110 m: a wreck whose fire is out (the player's included)
  (or a crash or dumped getaway car flagged `towable`) first, then an abandoned car, then, one pick in two, a parked one;
  never a car still burning, a bike or anything longer than a pickup, an
  activity's car, or the car the player just left unless it's a wreck. It
  drives over, then lines up 3 m to the side of the car and just beyond
  it, tail to it, facing the way it came (`pullIn`), so the car goes on
  the hook by its nose or its back; winches it up over 2.5 s (`tow`
  event) and drives off as calm traffic with the car trailing like a
  trailer (no speed of its own, so no skids). The amber beacon on the cab
  turns throughout (towLook). Both are retired once far and unseen (or
  40 s towing unseen). Take the truck, knock its driver out or get into
  the towed car and the tow's off: the car stays, an ordinary abandoned
  car. One at a time (a crash's own follow-on tow, V2-10, may come while
  another's out: two at most).
- **Car alarms** (`scenes/alarms.ts`, `AlarmBoard`): a crash against a
  parked car (any car's: the contact point on its body, ±0.6 m), a bullet
  into one, or a blast within 14 m sets its alarm off: the four
  indicators flash amber at 2 Hz with a wash on the road (alarmLook), and
  a `street` event `alarm` every 1.6 s plays one cycle of its siren
  (`sfx.carAlarm`: whoops, a hi-lo two-tone, or chirps and two honks, one
  per spot, through a little distorted horn speaker). It stops after
  20 s, or when the car's driven off (getting in clears `parked`), towed,
  wrecked or recycled; set off again, it starts over. 4 at once; not
  behind the title.

**Borrowed Blues** (V2-09; `scenes/serviceTools.ts`, rules pure and
tested in `systems/serviceTools.ts`, `tests/serviceTools.test.ts`). Steal
a service vehicle and its tool works, on one action slot (the fire
button's: left click / J, the pad's X, the touch car FIRE button showing
the tool's icon and name; no drive-by from these three). `main.ts` hands
the press, the hold and the aim to `cityLife.tools.control()` each frame
and caps the player's throttle through `tools.limit()`; the pay is
[*Progression*](progression.md), [*Borrowed Blues duty*](progression.md).

- **Hose (fire truck):** held, the roof monitor (0.45 × the body's reach
  ahead, 2.7 m up) sprays a cone 16 m long, ±13° (`hoseHit`), cut short by
  the first building in its way (`clipJet`). It points where you aim (the
  mouse cursor, the right stick, or a drag on the touch HOSE button, read
  like the twin-stick aim pad), else at a burning fire within 60° of the
  nose, else straight on (`hoseHeading`). Everyone in it is knocked flat
  and back along the jet (6 m/s at the nozzle, half at the far end, down
  2.2 s, each at most once in 1.4 s: `pedDown`, cause `water`, the
  player's: assault, as a punch); a moving bike's rider is thrown off;
  cars are shoved along it (9 m/s²); a car that has caught (burning down
  to its blast) is doused, its health lifted just over the fire line
  (`douse`); a fire it reaches goes out at three crew hoses' pace (a full
  fire in ~2.3 s; `FireBoard.hose`, `street` `fireOut`). The jet is
  Effects' soft pool (64 drops a second at 17 m/s, streaks along their
  flight) with steam where it lands on a fire and a splash off the road
  (`render/emergencyLook.ts` `toolsLook`). **Stranded crews:** take a fire
  truck from a fire while its crew is out and the two firefighters stay
  on the pavement, wave after it and hose on by hand at a crew's pace, so
  the borrowed monitor beats them to it if you're quick; out (or burnt
  out), they walk off as passers-by.
- **Chime (ice cream van):** a press plays the jingle (and again every
  6 s, for 30 s; press again to stop it). Parked (under 0.8 m/s) while it
  plays, the van anchors a queue at its hatch (a `Gathering` queue, up to
  9, recruited from calm passers-by within 45 m, `roomFor` permitting)
  that's never served: it waits there, a lure, while you get out and do
  what you like. Drive the van 6 m off and they run after it (*VAN
  NICKED*, below: unpaid, it's your queue); 15 s after the chime stops
  they're let go, walking on (`Chime`).
- **Winch (tow truck):** a press, stopped (under 3 m/s), hooks the car
  whose nearer end is closest to the hook (0.6 m behind the truck's tail)
  within 4.5 m (`hookDistance`): a wreck whose fire is out, a crash or
  dumped getaway left `towable`, or an abandoned car; never a parked one,
  one someone's driving or a scene's using, a police car, a bike, anything
  burning or longer than a pickup, or one already delivered (`hookable`).
  It's winched on over 1.6 s (the truck held to a crawl) and trails on the
  hook as the city's tows do (`towPose` as a trailer: it follows the
  truck's own path through a turn, < 1 m inside it on a 9 m radius, so it
  doesn't swing out over the kerb; `towedPose`), carried with no speed of
  its own; the truck is held to 15 m/s with no nitro (`capThrottle`). A
  press away from the yard drops it where it is; stopped in the docks
  yard, it's delivered (`tool` `deliver` with its condition). Get out and
  the car stays hooked to the parked truck; get into another vehicle and
  it's dropped. An amber beacon turns on the cab while a car's on.
- **The guard:** the player's borrowed vehicle (the one they're in, or
  left standing as their last) and the car on its hook are never taken by
  the city: `CityLife.keeps(v)` (`d.keep` plus `tools.guards(v)`) is what
  `ServiceRun.call`'s claim, the ice cream van and bus scenes' adoption,
  the tow trucks' pick, the double-parking and accident picks ask, a city
  tow truck on its way drops a car the player hooks first, and population
  upkeep keeps the hooked car. Ambulance, bus and police duty wait for a
  later version.

```ts
life.tools.control(pressed, held, aimHeading | null)   // main.ts, every frame (the fire slot in one of the three)
life.tools.limit(controls)                              // the player's controls, each step: the tow cap
life.tools.truck · .tool · .hooked · .delivered · .yard · .hosing · .chime · .queue · .guards(v)
life.keeps(v)                                            // no scene may take it (an activity's, or the guard's)
// Events: { type: 'tool', tool: 'hose' | 'chime' | 'winch', what, x, z, condition?, wrecked? } with what:
//   hoseOn · spray (the pump, every 1.1 s) · hoseOff · fireOut · chime · queue · release · hook · unhook · deliver · noHook.
```

**Budget:** no mesh, program or batch: the jet and steam are the soft
pool's particles, the beacon and the yard's ring the glow batch, the
queue people already on the street. iPhone profile (852×393, `medium`),
the ice cream van and a busker forced beside the spawn, a borrowed fire
truck turned on the five people in reach and hosing for 60 frames: 49
draw calls before the truck, 60 with it in view (its model and shadow
pass), 58.8 on average (61 at most) while it hosed and knocked four of
them flat.

**VAN NICKED** (V2-12; rules pure and tested in `systems/vanNicked.ts`,
`tests/crashers.test.ts`; `scenes/vanNicked.ts`). Drive off in an ice
cream van while people are queueing at it and the queue comes after you
on foot.

- **Whose queue:** the city's van taken while it's open (`IceCream` hands
  its queue to `life.vanNicked.take()` as the player gets in) pays
  `vanNicked` (300) and its stamp with two or more queueing, once (a van
  the player's left has no driver to open it again). The player's own
  chime queue (*Borrowed Blues*) chases the same way when they drive off
  from it, and pays nothing (it's your van, and the chime is free).
- **Off after it:** they stand staring until the van's 5 m from where it
  stood (`NICK_OFF`; 8 s of it not going and they walk on, unpaid), then
  `street` `vanNicked` (a record scratch: the van's music dragged to a
  stop; the scanner's QUEUE IN PURSUIT line) and they run at the player
  (in the van or out of it, at an officer's 5 m/s, in a ring round them:
  `surroundSpot`), waving their arms. Each gives up after 9–15 s of their
  own, or once the player's 32 m ahead of them; a 1.6 s glare and they
  walk on as passers-by. Caught up, they stand round you waving; nobody
  throws a punch.
- **Not heat:** held by the scene (`agent.scene`), they're no witness and
  make no call; none of it touches the police. They aren't `suspect`
  either: knocking one down (hosed, run over, punched) is an assault like
  anyone else's, and they drop out of the chase (handed back to the
  street, so the ambulance comes for the knocked out). The carjack itself
  is a carjack as ever.
- **Ice cream after all:** one who reaches the van parked with its chime
  playing (`tools.chime.on` and anchored) joins the chime queue there.

```ts
life.vanNicked.take(van, gathering, own, moving) → n   // drain a queue into the chase (IceCream on the theft, ServiceTools on the chime's release)
life.vanNicked.chasers · .van · .chasing · .own · .counts { city, own, paid, gaveUp, queued }
```

A headless check, `tools/tune/crashers.mjs` ([*Tuning harnesses*](testing.md)):
2026-11-02, the dev server, two runs of 12 races and 6 vans (the rendered
frames make runs differ a little). Races (a sports car put beside the
leader, a bot driving the route): all 24 joined, won 9 and 7 (in 10–16
s), the rest beaten; the RACE CRASHER stamp on every win; every prize
pulled up 10–20 m past the line (before the fix to finish it there,
100–250 m back where it was when the player crossed), its driver out
5–20 s after the win, and taken through the real enter button with no
carjack. Vans (the van forced open beside the player, taken through the
enter button and driven off at half throttle): 12 queues of 6, all chased
from 1.25 s, VAN NICKED paid and stamped, the nearest chaser 1.4–2.7 m
from the van, all given up in 5–12 s, and no star from any of it (one
passer-by's call, about the carjack). **Budget:** nothing new drawn: the
chasers are the queue (people already out), the markers and the prize's
ring the glow batch.
