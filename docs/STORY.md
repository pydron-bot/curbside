# Curbside — the story

The story jobs, their cast and the script. The data lives in
`src/systems/missionsData.ts` and is the source of truth: if you edit a
line there, update it here too (and the other way round).

There are two arcs on the payphones:

- **KEEP IT LOUD**, the main story (`arc: 'main'`, ids `s1`–`s6`; chapter
  2, `s7`–`s12`, is scripted below but not built yet). Job 1
  is the live cold open (no phone); the rest ring by day and in the evening
  (sunrise to midnight) from the city's three phones. It carries the
  story's 30% of completion.
- **The Night Shift**, the side story (`arc: 'night'`, ids `m1`–`m13`):
  the Graveyard Shift jobs from before V2, with the same ids, so a save
  keeps its progress. It rings only after dark (sunset to sunrise), and
  only from the docks-yard phone, with a moon (☾) on the radar and on the
  call card. PROGRESS shows it on its own row; it isn't weighted.

In the evening both can ring at once, never at the same phone.

## Premise: KEEP IT LOUD

You fitted car alarms for twenty years; half the alarms in Cobble Row are
yours. Mayor Prudence Lull, chasing the national *Quietest City* award,
passes the **Quiet Streets Act**: from midnight, car alarms, chimes,
buskers and kebab vans are banned after ten. Her American consultant wrote
"curbside nuisances" into the Act, nobody fixed the spelling, and the kerb
traders wear it as a badge: "We're the Curbside." (One joke, not a running
gag.)

You're sacked the same night. You're waiting for the night bus with your
toolbox when a getaway crashes at your shelter with the door open. You get
in. Lose the heat and a payphone rings: Doreen from the ice cream van needs
someone with nothing to lose. The kerbside traders (Doreen, Lionel the
busker, the kebab shop) hire you to keep the city loud, and every job asks
for mayhem, not stealth. No main job fails you for getting stars: the
villain wants the city quiet.

**The player** is an alarm fitter, never named or gendered. The traders
call you **"Alarms"**. Your trade is the joke that runs under the mayhem:
every crash, bullet and blast sets off "your" alarms.

## Tone

- **Comic.** Crime caper, not grimdark. Threats are real, but the people
  making them are ridiculous. Every call has at least one joke.
- **British English:** pavement, nan, lolly, lollipop man, kerb.
- **Short.** At most three lines per call (the card staggers three; a test
  enforces it). Keep a line under about 100 characters so the card fits
  the iPhone's 852×340 layout (a test allows 105). One or two sentences
  each.
- **Voices:**
  - **Doreen** runs the ice cream van and the traders. Brisk, warm, a bit
    menacing; she gives the instruction and pays in ice cream. Ends on a
    dry one-word kicker ("Lovely.").
  - **Lionel** is a busker and a performer at all times: grand,
    self-pitying, devoted to his hat.
  - **Mayor Lull** speaks in council notices on the radio: soft, prim,
    everything "quietly". She never shouts. She's never seen.
  - **Vex** is dry and in charge, and ends calls with the instruction.
  - **Tuna** panics, overshares and gets the last word.
  - **Pike** was pompous in chapter 1 and is pompous and broke in chapter 2.
  - **Clamp** speaks like a council letter: formal, no contractions,
    "Good evening."
  - **Manny** (main story, chapter 2) runs the kebab shop. Deadpan and
    solemn, measures life in the spit's years: "Twenty-two years."
  - **Todd** is Lull's American consultant (chapter 2, one job). Upbeat
    business-speak that never stops; the only American English in the
    story.
- **Objective lines** are capitals, under about 38 characters (a test
  allows 40), and say what to do: `STEAL …`, `BRING IT TO …`,
  `MAKE COBBLE ROW LOUD`.

## Cast

| Speaker label | Who | Drawn as | Card badge |
| --- | --- | --- | --- |
| `DOREEN` | Runs the ice cream van, and the kerb traders. Lost her chimes to the Act. | `player_f`, mint shirt (job 4) | mint |
| `LIONEL` | Busker. Red waistcoat, a hat that is his livelihood. | `ped_slim`, red shirt | violet |
| `MAYOR LULL` | Mayor Prudence Lull. Wants the *Quietest City* award. Heard on the radio, never seen. | — | pearl |
| `VEX` | Runs the Graveyard Shift. Orange hair, blue overalls, toolbelt. | `vex` GLB | pink |
| `LIL' TUNA` | Vex's mechanic. Short, pink hoodie, big headphones. | `tuna` GLB | yellow |
| `DEACON PIKE` | Leader of the Chrome Saints in chapter 1. Ruined and broke in chapter 2, and a reluctant informant. Sells Doreen the Mayor's diary (main story, job 11). | `pike` GLB | steel blue |
| `COMMISSIONER CLAMP` | Parking Commissioner, runs the city impound. Grey suit, clipboard. | `ped_coat`, grey shirt | traffic-cone orange |
| `MANNY` | Runs the kebab shop on Cobble Row; the third trader (main story, chapter 2). | `ped_stocky`, white shirt (apron) | chilli red (to add) |
| `TODD` | Todd Bramble, of Bramble Strategic: Lull's American consultant, who wrote the Act (main story, job 10). | `ped_slim`, lanyard-blue shirt | to add |
| — | Lull's wardens (main story, jobs 3, 9, 12) and Clamp's (Night Shift job 13). Hi-vis yellow. | `ped_stocky` | — |
| — | The Graveyard Shift's tow truck (main story, job 4): Vex's crew, on a council contract. | `tow_truck`, Shift blue `#3c5a8c` | — |
| — | Lull's limo (jobs 5 and 12), pearl; the award judges' coach (job 6), navy; the council's diggers (job 7), yellow. Nobody inside is seen. | `limo`, `bus`, a digger (to make) | — |
| — | The Collector, Pike's money man (Night Shift job 7). | `pike` GLB | — |

The card picks a badge colour from the speaker label (`badgeFor` and
`BADGES` in `src/ui/progressScreens.ts`, colours in `src/ui/progress.css`):
TUNA, PIKE, CLAMP, DOREEN, LIONEL and LULL have their own, and anyone else
gets Vex's pink. A new speaker needs a line in both; a test checks every
speaker in the story has one.

## Places

| District | Name | In the story |
| --- | --- | --- |
| downtown | GLASS HEIGHTS | Lull's wardens and Lionel (job 3); Lull's ribbon (job 5); where the judges' coach sets off (job 6); the impound's spit van (job 8); Todd's hotel (job 10); the Mayor's street (job 11); the Town Hall, where her convoy leaves (job 12); the safehouse, the city impound, Clamp's office |
| oldtown | COBBLE ROW | the street you wired (job 2); Doreen's pitch (job 4); the coach's race (job 6); the diggers and Lionel's kerb (job 7); Manny's kebab shop (job 8); the Saints' vans (Night Shift) |
| arts | NEON MILE | where Lionel plays (jobs 3 and 9); the Shift's truck with Doreen's van (job 4); the coach's fire and turf flare-up (job 6); Tuna's hide-outs, Clamp's tow-away zone (Night Shift) |
| industrial | RUSTWATER DOCKS | the docks yard and its phone: the Night Shift's |
| residential | MAPLE FLATS | the Collector, Pike's bus shelter (Night Shift, and where Pike found the diary for job 11) |
| — | the outer ring road | Todd's drop (job 10); the convoy's way out (job 12) |

There are four payphones. The main story (after the cold open) rings from three
(`phone-oldtown`, which stands just inside Glass Heights by Cobble Row,
`phone-arts`, `phone-suburbs`) and two main jobs in a row never ring the
same one; the Night Shift rings only from `phone-docks`. Tests check that
the people, cars and areas are in the districts the dialogue names.

## KEEP IT LOUD, chapter 1 (6 jobs, $12,300)

| # | Id | Job | Phone | Pay | What happens |
| --- | --- | --- | --- | --- | --- |
| 1 | `s1-wrongstop` | WRONG STOP | none (the cold open) | $300 | A getaway crashes at your bus shelter: GET IN · LOSE THE HEAT. |
| 2 | `s2-noise` | MAKE SOME NOISE | oldtown | $1,000 | 2,500 points of mayhem in Cobble Row, with a street race started there to crash into. |
| 3 | `s3-quiet` | QUIET PLEASE | suburbs | $1,500 | Flatten Lull's two wardens in Glass Heights, pick up Lionel, get him to Neon Mile. |
| 4 | `s4-problems` | NINETY-NINE PROBLEMS | arts | $2,000 | Take Doreen's van back off a Graveyard Shift tow truck, unscratched, and bring it to her in Cobble Row. The Night Shift's one cameo. |
| 5 | `s5-ribbon` | RIBBON CUTTING | oldtown | $2,500 | Wreck the Mayor's limo as it leaves her Silent Zone ribbon in Glass Heights. |
| 6 | `s6-quietest` | QUIETEST CITY | suburbs | $5,000 | 5,000 points of mayhem round the award judges' coach as it tours, with a race, a fire and a turf flare-up started along its route. **STORY COMPLETE.** |

The cold open runs once (a fresh save's first PLAY; Settings → REPLAY
OPENING for another go). Once it has run, `s2` rings whether or not `s1`
was passed (died on the way, say), and a save from before the cold open
with real play skips it altogether and starts at `s2`. Doreen introduces
herself in `s1`'s outro, so `s2`'s call opens with Lull's notice instead
(the backstory beat, which the outline had on a radio card).

### 1. WRONG STOP

`s1-wrongstop` · no phone (`direct`: the cold open starts it) · $300

PLAY drops the camera on a bus pulling in at the shelter nearest the
safehouse, with you standing at it. Sirens off screen; then a getaway
comes down the far lane flat out, swerves across and piles into the kerb
a few steps away, and its driver legs it. No card, no call: the only
prompt over the live crash.

1. **GET IN · LOSE THE HEAT.** The crashed getaway (it's the job's car;
   wrecked, the job fails: THE GETAWAY IS WRECKED). Getting in is TAKE
   THE HEAT: the chase's cops are yours, at 2 stars, and the stamp lands.
   If the chase couldn't start, the getaway is already there, crashed,
   and getting in brings the same.
2. **LOSE THE HEAT.** The one main job that asks it: the stars came with
   the car.

> **DOREEN:** You're the alarm fitter. Lost your job tonight, I heard. I lost my chimes.
> **DOREEN:** Lull's banned anything louder than a sigh. Fancy keeping this city loud? It pays.
> **DOREEN:** Badly. But in ice cream.

The outro plays on the debrief card (Doreen on the nearest payphone).
Story job 2 also opens the side modes: Chaos Run, frenzies, races,
exports and taxi fares stay hidden from a brand-new player until it's
passed.

### 2. MAKE SOME NOISE

`s2-noise` · phone-oldtown · $1,000

> **MAYOR LULL:** Mayor Lull. From midnight, car alarms are illegal. So are chimes. And buskers. And joy.
> **MAYOR LULL:** Alarm fitters, please hand in your alarms. Quietly.
> **DOREEN:** Twenty years you wired Cobble Row. Every alarm on that street is yours. Remind them.

1. **MAKE COBBLE ROW LOUD · 0 / 2,500.** A `mayhem` step: score awards
   count while you're anywhere in Cobble Row (outside it, the radar points
   there). A street race is started once you're within 160 m of the middle
   of it (a `scene` action, featured so it runs even with you wanted; if it
   can't start, nothing depends on it).

> **DOREEN:** Heard that from the docks. The council's lodged a complaint. Lovely.
> **MAYOR LULL:** Mayor Lull. Noise in Cobble Row has been noted. Wardens are on their way. Quietly.

### 3. QUIET PLEASE

`s3-quiet` · phone-suburbs · $1,500

> **LIONEL:** Two wardens have nicked my hat. My hat is my livelihood. And my hat.
> **LIONEL:** They're in Glass Heights, writing me up for unlicensed joy. I'm hiding behind a bin.
> **DOREEN:** Flatten the wardens, pick Lionel up and get him to Neon Mile. The Mile likes a song.

1. **FLATTEN THE WARDENS · 0/2.** Two of Lull's wardens on a Glass Heights
   pavement, hi-vis, unarmed but they fight (as Clamp's do in NO PARKING).
   Lionel waits round the corner of the block.
2. **GET A CAR.**
3. **PICK UP LIONEL.**
4. **GET LIONEL TO NEON MILE.** He gets out at a kerb on the Mile.

Until he's in the car the job fails if Lionel is knocked down: NOT LIONEL!
HE WAS ON YOUR SIDE.

> **LIONEL:** I'd pay you, but it's in the hat, and the hat's evidence.
> **LIONEL:** Neon Mile! An audience! Several of them are even awake!
> **DOREEN:** Lull will send more wardens. Good. Means it's working.

### 4. NINETY-NINE PROBLEMS

`s4-problems` · phone-arts · $2,000

The main story's one brush with the Night Shift: Lull has hired Vex's crew
to tow the traders' vans. Towing is never a main-story verb: you take the
van back, you don't hook it.

> **DOREEN:** They're towing my van. Council contract. Some night crew in blue.
> **VEX:** Nothing personal. Council pays by the van. You pay in compliments.
> **DOREEN:** It's on their hook on Neon Mile. Box them in at a light. Not one scratch, mind. She's vintage.

1. **TAKE THE VAN BACK · DON'T SCRATCH IT.** The Shift's tow truck (blue,
   as Vex's) stands at a Neon Mile kerb with Doreen's mint ice cream van
   on its hook, and pulls away into traffic once you're within 35 m (or
   it's hit), at 10 m/s with the van trailing. The crew lets the van go
   where it stands when the truck is caught standing for a moment with
   you within 24 m (a red light, boxed in by your car), when its driver's
   gone (carjacked, bailed out after a ram, the truck wrecked), or the
   moment you get into the van itself (on foot, while it waits at a light).
2. **BRING IT TO DOREEN IN COBBLE ROW.** Doreen waits on the pavement at
   her pitch.

The job fails if the van is wrecked, scratched (under 90% health, at any
point: YOU SCRATCHED DOREEN'S VAN) or, once it's yours, left behind.

> **DOREEN:** Not a scratch. Thirty years she's played Greensleeves. She's earned a lie-down.
> **VEX:** Council's docking my pay for that. Worth it. You drive like somebody's nan.
> **DOREEN:** Free cones for life. Small ones. Lovely.

### 5. RIBBON CUTTING

`s5-ribbon` · phone-oldtown · $2,500

> **MAYOR LULL:** Mayor Lull. Today I open our first Silent Zone, in Glass Heights. Please don't clap.
> **DOREEN:** She cuts her ribbon, then she's off in that limo. I want it in bits.
> **LIONEL:** Take these. Fireworks. The sticky ones go off when you say. The council calls them evidence.

1. **WRECK THE MAYOR'S LIMO.** You're given grenades and two sticky
   charges (W3-B; passing the job puts them in the shop). The pearl limo
   stands at the ribbon outside the Town Hall in Glass Heights until
   you're within 50 m (or it's hit), then drives off into traffic: ram it,
   bomb it, chase it, or stick a charge on it and pick your moment (that's
   PARTING GIFT). Lull's in it, and is never seen.

> **MAYOR LULL:** Mayor Lull. The Silent Zone is closed for repairs. As is my limo. Quietly.
> **LIONEL:** That bang! The reverb! Glass Heights hasn't had applause like it since the eighties.
> **DOREEN:** She'll be cross now. Lovely.

### 6. QUIETEST CITY

`s6-quietest` · phone-suburbs · $5,000 · night (21:00)

> **MAYOR LULL:** Mayor Lull. The award judges tour our streets tonight. They will see nothing. That's the point.
> **DOREEN:** Coach leaves Glass Heights at nine. Make sure they see everything.
> **LIONEL:** I've done a running order. A race, a fire, a punch-up. Then me, obviously.

1. **GIVE THE JUDGES A SHOW · 0 / 5,000.** A `mayhem` step whose area is
   100 m round the judges' coach, wherever it's got to (on the radar
   throughout, ringed in the street). The coach waits at its Glass Heights
   kerb until you're within 60 m, then tours at a sightseer's 8 m/s, round
   and round: north out of Glass Heights, into Cobble Row, along the top
   of Neon Mile, down the Mile and back. On its route, each once you're
   within 140 m of its crossing: a **street race** in Cobble Row, a **car
   fire** on Neon Mile (a fire truck comes) and a **turf flare-up** where
   the VIPERS' Mile meets Glass Heights (`scene` actions: featured, and
   none of them needed).

> **MAYOR LULL:** Quietest City has gone to a village with one goat. The goat was louder than you lot, apparently.
> **LIONEL:** A judge asked for my autograph. Well. He asked where the toilets were. Same thing.
> **DOREEN:** 'Curbside nuisances', she wrote. Can't even spell kerb. We're the Curbside, then. Lovely.

The debrief says **STORY COMPLETE**; the main story's phones then ring
with its jobs again as REPEAT JOBs.

## KEEP IT LOUD, chapter 2 (6 jobs, $24,500)

**Scripted, not in the game yet.** The ids, phones, pay and steps below
are what `missionsData.ts` should get (`chapter: 2`). What the engine and
assets still need is under *Building chapter 2* at the end.

Lull loses the award to the goat and blames "the Curbside". Her answer is
the **Kerb Removal Order**: no kerb, no kerbside, no Curbside. Her diggers
start on Cobble Row. The kebab shop joins the traders at last. Her
consultant leaks the Act's first draft, which exempts the Mayor's own
street. You wire that street with alarms, and Lull leaves town for the
goat's village with the whole city going off around her convoy.

| # | Id | Job | Phone | Pay | What happens |
| --- | --- | --- | --- | --- | --- |
| 7 | `s7-nokerb` | NO KERB, NO CURBSIDE | oldtown | $3,000 | Wreck the council's three diggers while they rip up Cobble Row's kerbs. |
| 8 | `s8-doner` | DONER | arts | $3,000 | Steal Manny's impounded kebab spit back from the impound and get it home before it goes cold. The Night Shift's second and last cameo. |
| 9 | `s9-openmic` | OPEN MIC | suburbs | $3,500 | Keep Lull's wardens off Lionel's comeback gig on Neon Mile for three minutes. |
| 10 | `s10-permission` | PLANNING PERMISSION | oldtown | $3,500 | Drive Lull's consultant to the ring road for the Act's first draft. He talks the whole way. |
| 11 | `s11-alarmcall` | ALARM CALL | arts | $4,000 | Fit five alarms on the Mayor's street, then set them all off. |
| 12 | `s12-loudest` | LOUDEST CITY | suburbs | $7,500 | Give Lull's leaving convoy a send-off, then wreck her limo. **STORY COMPLETE.** |

No two jobs in a row ring from the same phone, `s6` included (suburbs, then
oldtown). Chapter 2 rings once `s6` is passed. `s6`'s debrief then says
CHAPTER 1 COMPLETE (`endsChapter()`), and `s12` takes STORY COMPLETE.

### 7. NO KERB, NO CURBSIDE

`s7-nokerb` · phone-oldtown · $3,000

> **MAYOR LULL:** Mayor Lull. From Monday, kerbs are abolished. Pavements will simply... end. Quietly.
> **LIONEL:** Three diggers in Cobble Row. One's eyeing up my kerb. I've told it I'm a listed building.
> **DOREEN:** No kerb, no kerbside, no us. Wreck her diggers before they're done with Cobble Row.

1. **WRECK THE COUNCIL'S 3 DIGGERS.** Each digger works a Cobble Row kerb
   inside a roadworks pen (barriers, cones, a trench; the W3-C roadworks
   scene is the dressing). When you get within 50 m (or it's hit), it climbs
   out and trundles off into traffic at 6 m/s, slow and heavy, so it takes
   some wrecking. Driven, like Clamp's tow trucks in TOW-AWAY ZONE.
   Lionel sits on his kerb by the third digger, so mind him.

> **LIONEL:** My kerb lives! Fourteen years I've sat on that kerb. It knows all my sad songs.
> **MAYOR LULL:** Mayor Lull. Three council diggers have been lost. Kerbs will now be removed by hand. Quietly.
> **DOREEN:** By hand. Those kerbs are older than she is. Let her try. Lovely.

### 8. DONER

`s8-doner` · phone-arts · $3,000

Manny, who runs the kebab shop on Cobble Row, joins the traders. The spit
is at the city impound in Glass Heights, which Vex's crew now runs on a
council contract (the Night Shift's ending, and Vex's council work in
NINETY-NINE PROBLEMS). The lines make sense whether or not the player has
played the Night Shift.

> **DOREEN:** Lull's had Manny's kebab spit impounded. Twenty-two years it's turned. Never once stopped.
> **MANNY:** It is still turning. In the impound. I can feel it. Bring it home before it goes cold.
> **VEX:** Impound's mine now. Council contract. If someone nicked that spit, I'd have to ring the cops.

1. **TAKE THE SPIT VAN.** A council van at the impound kerb in Glass
   Heights, with the spit in the back, still lit.
2. **GET IT TO MANNY'S BEFORE IT COOLS.** 150 s, 2 stars (Vex rings the
   cops, as promised). Manny waits outside his shop on Cobble Row, in an
   apron.

The job fails if the van is wrecked or left behind, or the time runs out:
THE SPIT WENT COLD.

> **MANNY:** Still turning. Twenty-two years. Tonight everybody eats free. Not you. You, half price.
> **VEX:** Told the cops it went thataway. Every way's thataway if you point enough.
> **DOREEN:** That's the three of us, then. The chimes, the hat and the kebab shop. Lovely.

### 9. OPEN MIC

`s9-openmic` · phone-suburbs · $3,500 · evening (20:00)

> **LIONEL:** My comeback gig. Neon Mile, eight o'clock. Three minutes. It's one song, but it builds.
> **MAYOR LULL:** Mayor Lull. Unlicensed singing will be met by wardens. From both ends of the street.
> **DOREEN:** Keep them off him till he's done. All of it. Even the kazoo bit.

1. **GET TO LIONEL'S GIG ON NEON MILE.** Lionel stands on a Mile pavement
   with his hat out and the night crowd round him.
2. **KEEP THE WARDENS OFF LIONEL.** Survive 180 s. Lull's wardens (hi-vis,
   unarmed but they fight) walk in from both ends of the block in pairs,
   about every 25 s, heading for Lionel. Flatten them, run them down or
   block the pavement.

The job fails if a warden reaches Lionel (LIONEL'S BEEN WRITTEN UP) or you
knock him down (NOT LIONEL! HE WAS ON YOUR SIDE). Hitting the crowd doesn't
fail it.

> **LIONEL:** They shouted 'more'! Or possibly 'no more'. Either way, they were listening.
> **MAYOR LULL:** Mayor Lull. Fourteen wardens have resigned. They say the song is still in their heads.
> **DOREEN:** Fourteen wardens and a kazoo solo. You've earned a cone. Lovely.

(Fourteen is about what three minutes of pairs comes to. Keep the line
matching if the timing changes.)

### 10. PLANNING PERMISSION

`s10-permission` · phone-oldtown · $3,500

Todd Bramble is Lull's American consultant and wrote the Quiet Streets
Act. He has quit and wants out of the city. American English is his alone,
and so is the only callback to the spelling: he confesses it, once, in the
car.

> **DOREEN:** Lull's consultant has quit. Wrote her Act, he did. He'll swap us the first draft for a lift.
> **TODD:** Todd Bramble, Bramble Strategic. Love what you're doing. Get me to the ring road, we'll circle back.
> **LIONEL:** He's outside the hotel in Glass Heights. Bring a car. And earplugs. He's been talking since Tuesday.

1. **GET A CAR.**
2. **PICK UP TODD IN GLASS HEIGHTS.** He's outside the hotel with a wheelie
   case.
3. **GET TODD TO THE RING ROAD.** 150 s, 2 stars: Lull has reported her
   consultant stolen. The drop is a kerb on the outer ring road, on the far
   side of the city from Glass Heights.

Until Todd's in the car the job fails if he's knocked down (THAT WAS YOUR
LIFT HOME, TODD). It also fails if the time runs out (TODD MISSED HIS
FLIGHT).

**In the car** Todd talks the whole way. One line about every 15 s, on the
feed, not a card; in this order, and the rest are dropped if you arrive
early:

> **TODD:** So the Act. Fun story. The brief was 'quiet'. I heard 'quiet' and thought: synergy.
> **TODD:** Is this a stick shift? I've never been in a stick shift. Is that legal here?
> **TODD:** Are those sirens for us? Love that. That's engagement.
> **TODD:** Small thing. The spelling in the Act? Me. Nobody corrected me. Very polite country.
> **TODD:** Your driving is extremely disruptive. In my industry that's the highest compliment.
> **TODD:** I'm writing a book about this ride. Chapter one: Disruption. Chapter two: also you.

> **TODD:** This is me. Love the energy. The draft's in your glovebox. Page four. Have a great life.
> **DOREEN:** Page four. 'Exempt: the Mayor's own street, for essential noise.' She's got a hot tub.
> **LIONEL:** If her street's exempt, an alarm there's perfectly legal. Now who do we know who fits alarms?

### 11. ALARM CALL

`s11-alarmcall` · phone-arts · $4,000 · night (22:00)

Pike's cameo in the main story. He's down on his luck, living by a Maple
Flats bus shelter (the Night Shift's FALLEN SAINT), and introduces himself
for players who don't know him.

> **DEACON PIKE:** Deacon Pike. You don't know me. I found the Mayor's diary in a bin. I live by the bin.
> **DEACON PIKE:** Tonight says: 'Bed at ten. Earplugs out. Sleep like a baby.' The page is twenty quid.
> **DOREEN:** Paid him in cones. Five cars on her street, five of your alarms. Then wake her up.

1. **FIT 5 ALARMS ON THE MAYOR'S STREET.** Five cars parked along a quiet
   Glass Heights street outside Lull's house. Walk up to each (a `collect`
   step; the cars are spawned parked, tagged `alarm1`–`alarm5`).
2. **WAKE THE MAYOR · 0 / 2,500.** A `mayhem` step, 60 m round her house.
   Hitting the cars you wired sets their alarms off (the alarms scene), which
   is the quickest way to the points.

> **MAYOR LULL:** Mayor Lull. There are five car alarms outside my house. I have counted them. Many times.
> **DEACON PIKE:** I've never been on this side of a good deed. It's itchy. Twenty quid, though.
> **DOREEN:** Hear that? Every one of them yours. Twenty years' work in one street. Lovely.

### 12. LOUDEST CITY

`s12-loudest` · phone-suburbs · $7,500 · dusk (19:00)

> **MAYOR LULL:** Mayor Lull. Today I leave to present the award to its village. Please line the streets. Silently.
> **DOREEN:** Limo, two warden vans, out by the ring road. Give her the send-off she's earned.
> **LIONEL:** Every busker in town's out. Every chime, every alarm. She'll hear us from the goat.

1. **GIVE LULL A SEND-OFF · 0 / 6,000.** A `mayhem` step, 100 m round the
   limo wherever it's got to. The convoy (Lull's pearl limo, then two
   hi-vis warden vans) waits outside the Town Hall in Glass Heights until
   you're within 60 m, then tours at 9 m/s, round and round: Glass Heights,
   Cobble Row, down Neon Mile, then a stretch of the ring road. Along its
   route, each once you're within 140 m: a **street race**, a **car fire**,
   a **turf flare-up** and an **alarms** scene, all `scene` actions,
   featured, none needed.
2. **WRECK THE MAYOR'S LIMO.** The convoy speeds up (14 m/s) and makes for
   the ring road. Wrecking a warden van doesn't count.

> **MAYOR LULL:** Mayor Lull. I have taken a post in the village. The goat is very quiet. We understand each other.
> **LIONEL:** The council's new motto: 'Loud and proud.' Well. I'm shouting it from the Town Hall steps.
> **DOREEN:** Kerbs back, chimes back, alarms back. Cones for life, Alarms. Medium ones. Lovely.

The debrief says **STORY COMPLETE**, and the phones then ring with all twelve
jobs as REPEAT JOBs.

### Building chapter 2

What the script needs that the game doesn't have yet:

| Job | Needs | Notes |
| --- | --- | --- |
| 7 | A driven **digger** | `mini_digger` is only a static street prop. It needs a vehicle: a GLB per `docs/BLENDER_TODO.md`, a `VehicleArchetype`, slow and heavy. A yellow `van` could stand in to start with. The roadworks pen comes with W3-C. |
| 8 | **Manny** | A ped (`ped_stocky`, white shirt for the apron) and a badge colour: `MANNY` in `BADGES` and `progress.css` (chilli red). |
| 9 | **Wardens walking in** | A new start action: waves of hostile peds that walk to a tagged ped. Plus a fail when one reaches him (`reached`). |
| 10 | **Todd**; **lines during a job** | A ped (`ped_slim`, a lanyard blue shirt) and badge `TODD`. A `say` action: timed feed lines while a step runs (the feed already shows mission text), skipped once the step ends. It's the one new engine feature here and reusable everywhere. The drop point comes from `roads.ts`'s outer ring road. |
| 11 | Nothing new | `collect`, parked `spawnCar` and `mayhem` with `near`. Pike's GLB exists. Optional: a step that counts tagged cars whose alarms have gone off. |
| 12 | **A convoy** | Two vans following the limo. Either a `follow: tag` option on driven cars, or three cars on the same route with staggered starts. Also a speed change between steps (`cruise` set by a later step's start). |

Also:

- **Completion:** the story stays 30% of completion, split over 12 jobs.
  A save that finished chapter 1 drops from 30% to 15% for the story part,
  as happened when the Night Shift grew a chapter.
- **The dialogue tests** cover chapter 2 as soon as it's in
  `missionsData.ts`: three lines a call, about 100 characters a line,
  objectives under 40, a badge for every speaker, and people in the
  districts the lines name.
- **An order to build in:** 11, 12 and 8 need the least (8 needs only
  Manny). Then 10 (`say`), 9 (waves), and 7 (the digger).

## The Night Shift (side story)

The **Graveyard Shift** is a night-time tow crew that tows rather more than
it should. The player answers the docks-yard phone after dark, passes
Vex's audition and ends up on the crew. Chapter 1 is the war with Deacon
Pike's Chrome Saints. In chapter 2, *The Ledger*, Pike's money leads to the
man who was running him all along: the city's Parking Commissioner.

Every Night Shift job rings from `phone-docks`, after dark only. Vex's
opener on job 1 links it to the main story:

> **VEX:** Heard you've a day job now. Cute. The night's still mine, and wrecks need hooking.
> **VEX:** Name's Vex. I run the Graveyard Shift. Towing, mostly. The 'mostly' pays better.
> **VEX:** Audition's simple: bring me a sedan, any sedan, to the docks yard. Don't scratch it. I'm sentimental.

### Night Shift chapter 1: the Chrome Saints (8 jobs, $13,800)

| # | Job | Pay | What happens |
| --- | --- | --- | --- |
| 1 | WRONG NUMBER | $500 | Vex's audition: steal a sedan and deliver it to the docks yard without a scratch. |
| 2 | TUNA RUN | $700 | Pick up Lil' Tuna, stranded in Neon Mile, and take him to the safehouse against the clock. |
| 3 | SAINTS' PAINT | $1,200 | Steal the Saints' purple sports car, lose the 2 stars they call down and deliver it. |
| 4 | SPECIAL DELIVERY | $900 | Find three parcels Tuna dropped out of a moving van. ("Why are my parcels warm.") |
| 5 | SPARE PARTS | $1,500 | Wreck the Saints' three parts vans with a shotgun. Pike's first threat. |
| 6 | MIDNIGHT EXPRESS | $2,000 | Night. Pike has put a price on Tuna's head: get him to the docks through checkpoints at 3 stars. |
| 7 | COLLECTION DAY | $2,000 | Take down Pike's armed money man, the Collector, in Maple Flats. His ledger says Pike owes everyone, *including us*. |
| 8 | LAST CALL | $5,000 | Steal Pike's black sports car, survive his 4-star tip-off and bring it home. The Saints scatter. **CHAPTER 1 COMPLETE.** |

### Night Shift chapter 2: The Ledger (5 jobs, $12,500)

The hook is the Collector's ledger from job 7. Every month Pike paid two
grand to "C", for "parking". C is **Commissioner Clamp**, who runs the
city's parking and impound. He tows cars legally, sells them back and tows
them again. Every crew pays him or loses its wheels. Pike paid, and Pike
ran the streets. With Pike gone, Clamp wants the Graveyard Shift's yard.
The chapter goes from his ticket to his limo, and it ends with the city
needing a new tow crew.

#### 9. FINE PRINT

`m9-fineprint` · $1,500

> **LIL' TUNA:** Cracked the Collector's ledger. Every month Pike paid two grand to someone called 'C'. For 'parking'.
> **VEX:** And now someone's towed MY tow truck. From MY yard. The ticket's signed 'Commissioner Clamp'.
> **VEX:** It's at the city impound in Glass Heights. Bring it home. Nobody tows the Graveyard Shift.

1. **TAKE BACK VEX'S TOW TRUCK.** Vex's tow truck, in Graveyard blue, is parked at the impound kerb in Glass Heights.
2. **THE IMPOUND CALLED THE COPS: LOSE THEM.** 2 stars.
3. **BRING THE TRUCK HOME TO THE DOCKS.** At least 30% health. Vex waits in the yard.

The job fails if the truck is wrecked or left behind.

> **VEX:** My truck. They washed it. I will never forgive them.
> **VEX:** C for Clamp. Pike was paying off the Parking Commissioner. We've got a bigger fish to fry, kid.
> **LIL' TUNA:** Can we not say 'fish' and 'fry' together? Around me? Thanks.

#### 10. FALLEN SAINT

`m10-fallen` · $1,500

> **DEACON PIKE:** Don't hang up. Please. I've never said please before. It tastes like pennies.
> **DEACON PIKE:** Clamp took everything. My cars, my chrome, my good collar. I live in a Maple Flats bus shelter now.
> **VEX:** He'll spill on Clamp for a lift. Pick him up. He rides in the back. He doesn't touch the radio.

1. **GET A CAR.**
2. **PICK UP PIKE IN MAPLE FLATS.** 120 s. He's at a bus stop, and he's friendly this time.
3. **GET PIKE TO THE SAFEHOUSE.** 120 s, 2 stars. Clamp has tipped off the cops.

> **DEACON PIKE:** Clamp doesn't steal cars. He tows them, legally. Sells them back to you. Then tows them again.
> **DEACON PIKE:** Every crew in town pays him or walks. I paid. You didn't. So now he wants your yard.
> **VEX:** He does what we do, but with paperwork. That's disgusting.

#### 11. TOW-AWAY ZONE

`m11-towaway` · $2,000

> **VEX:** Clamp's made all of Neon Mile a tow-away zone. His trucks are hauling off every car on the street.
> **LIL' TUNA:** They took the ice cream van! With the man still in it! He's still serving, off the back of a truck!
> **VEX:** Three of his trucks are working the Mile. Orange, flashing, smug. Here, have something that burns.

1. **WRECK CLAMP'S 3 TOW TRUCKS.** 210 s. You're given molotovs. The trucks are orange (the city's own are yellow) and *driven*: they pull out into traffic as the job starts. This is the first story job with moving targets.
2. **LIE LOW: LOSE THE HEAT.**

> **LIL' TUNA:** The ice cream man's free! He gave me a lolly. I think it was a bribe. I've accepted it.
> **COMMISSIONER CLAMP:** Commissioner Clamp. Damaging city vehicles carries a fine of... everything you own. Good evening.
> **VEX:** He sounds like a voicemail.

#### 12. PAPER TRAIL

`m12-papertrail` · $2,500 · night (22:00)

> **DEACON PIKE:** Clamp keeps everything on paper. Every bribe, every tow. Alphabetised. Colour-coded. A monster.
> **DEACON PIKE:** Tonight four clerks drive his files to the shredder. And every one of them stops for a kebab.
> **VEX:** So that's four boxes outside four kebab shops. Grab them and bring them to me at the docks.

1. **GRAB CLAMP'S 4 BOXES OF FILES.** 240 s. The boxes are spread round town: two in Cobble Row, one in Neon Mile, one in Rustwater.
2. **GET THE FILES TO THE DOCKS YARD.** 150 s, 2 stars. Vex waits in the yard.

> **LIL' TUNA:** Box four is just his lunch receipts. He's had the same soup every day for eleven years.
> **VEX:** Box one's the good one. Clamp's been towing the Mayor's cars too. And selling them back to her.
> **DEACON PIKE:** He towed the Mayor? ...I'm almost proud of him.

#### 13. NO PARKING

`m13-noparking` · $5,000 · night (23:45)

> **COMMISSIONER CLAMP:** Graveyard Shift. I have read your file. It is thick. From midnight, your yard is a no-parking zone.
> **VEX:** He's outside his office in Glass Heights, guarding his limo with two traffic wardens.
> **VEX:** Put him down, take the limo, bring it home. Without a car he's just a man with a clipboard.

1. **TAKE DOWN COMMISSIONER CLAMP.** 150 s. You're given an SMG. Clamp is armed. His two wardens, in hi-vis, are unarmed but fight.
2. **TAKE CLAMP'S LIMO.** It's beige.
3. **EVERY COP IN TOWN: HIT THE CHECKPOINTS.** 120 s, 4 stars. Three checkpoints toward the docks.
4. **PARK THE LIMO IN THE DOCKS YARD.**

The job fails if the limo is wrecked or left behind. This is the end of the
Night Shift: **NIGHT SHIFT COMPLETE.**

> **VEX:** Clamp's limo. In my yard. After midnight. Tuna, what's the rule?
> **LIL' TUNA:** NO PARKING! I've had a wheel clamp ready since Tuesday. I've named it Gerald.
> **VEX:** The Mayor got the files, Clamp's a lollipop man now, and the city needs a new tow crew. Guess who.

### Vex's tow contracts (the towing side job)

Not a job on the phone list: towing is a side job (V2-09, the README's
*Borrowed Blues*). Steal any tow truck and the action button winches; haul
a wreck to the docks yard and the yard pays by its condition. After dark,
on duty in a tow truck with nothing on the hook, Vex now and then rings
(`☾ TOW CONTRACT`, at most once every 150 s) with a crashed car left at a
kerb nearby: on the radar, $250 on top if it reaches the yard in four
minutes. The lines live in `src/game/modes/serviceMode.ts` (`VEX_CALLS`,
in turn):

> **VEX:** That's one of my trucks you're in. Keep it. I've a job, and the job's a wreck.
> **VEX:** Someone left a car in the road. The council pays me to move it. I pay you.
> **VEX:** Hook it and get it to the yard before the council's man does. It's on your radar.

> **VEX:** Night shift, kid. Another one for the yard. Council money, so nobody asks.
> **VEX:** It's had a bump. Don't give it another. Or do: scrap pays too, just less.
> **VEX:** It's on your radar. Hook it, haul it, don't stop for chips.

## How it plays out in the game

- Each arc runs in the order above. Its next job is the first one the save
  hasn't passed, so a save from before V2 that had finished the Graveyard
  Shift's chapter 1 rings for FINE PRINT after dark, and for MAKE SOME
  NOISE by day.
- The debrief on LAST CALL says CHAPTER 1 COMPLETE (`chapter` on
  `MissionDef`, `endsChapter()` over the arc), NO PARKING's says NIGHT
  SHIFT COMPLETE and the main story's last job's STORY COMPLETE.
- After an arc is done its phone rings with its jobs again as REPEAT JOBs,
  at half pay.
- The main story is worth 30% of completion, split evenly over its jobs.
  The Night Shift isn't weighted: PROGRESS shows it as its own row.

## Stamps

The names stamped across the screen for the player's biggest mayhem
(BARBECUE SEASON, ENDANGERED PANDAS, FARES PLEASE …) live with their
rules in `src/systems/stamps.ts` (the full table is in the README,
*Named mayhem*). They're in the same voice as the calls: comic, British
(bank holidays, panda cars, last orders), a phrase you'd hear down the
pub rather than a game term. At most 20 characters, the line under it at
most 30 (a test checks, for the 852×340 layout), and never a name from
another game.

## Threads for later

- **The Mayor** owes the Graveyard Shift (Clamp's files) and is the main
  story's villain: who tells whom? (Chapter 2 doesn't settle it: Vex just
  runs the impound on a council contract.)
- **Pike** has a redemption arc going, is living in a bus shelter and, in
  ALARM CALL, has done his first good deed. A third main-story or Night
  Shift turn for him could follow.
- **Who runs the city** after Lull leaves for the goat's village.
- **The VIPERS** run Neon Mile in free roam and never appear in the story.
- **Clamp as a lollipop man** outside a Maple Flats school: a cameo
  waiting to happen.
- **Quiet Wardens** in free roam after the finale (V2-15): two hi-vis
  wardens walk up to a busker or a queue, lecture, then act.
