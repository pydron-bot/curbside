# Curbside — the story

The story jobs, their cast and the script. The data lives in
`src/systems/missionsData.ts` and is the source of truth: if you edit a
line there, update it here too (and the other way round).

## Premise

The **Graveyard Shift** is a night-time tow crew that tows rather more than
it should. The player answers a payphone, passes Vex's audition and ends up
on the crew. Chapter 1 is the war with Deacon Pike's Chrome Saints. In
chapter 2, *The Ledger*, Pike's money leads to the man who was running him
all along: the city's Parking Commissioner.

## Tone

- **Comic.** Crime caper, not grimdark. Threats are real, but the people
  making them are ridiculous. Every call has at least one joke.
- **British English:** pavement, nan, lolly, lollipop man, kerb.
- **Short.** At most three lines per call (the card staggers three; a test
  enforces it). Keep a line under about 100 characters so the card fits
  the iPhone's 852×340 layout. One or two sentences each.
- **Voices:**
  - **Vex** is dry and in charge, and ends calls with the instruction.
  - **Tuna** panics, overshares and gets the last word.
  - **Pike** was pompous in chapter 1 and is pompous and broke in chapter 2.
  - **Clamp** speaks like a council letter: formal, no contractions,
    "Good evening."
- **Objective lines** are capitals, under about 38 characters, and say what
  to do: `STEAL …`, `BRING IT TO …`, `LOSE THE HEAT`.

## Cast

| Speaker label | Who | Drawn as | Card badge |
| --- | --- | --- | --- |
| `VEX` | Runs the Graveyard Shift. Orange hair, blue overalls, toolbelt. | `vex` GLB | pink |
| `LIL' TUNA` | Vex's mechanic. Short, pink hoodie, big headphones. | `tuna` GLB | yellow |
| `DEACON PIKE` | Leader of the Chrome Saints in chapter 1. Ruined and broke in chapter 2, and a reluctant informant. | `pike` GLB | steel blue |
| `COMMISSIONER CLAMP` | Parking Commissioner, runs the city impound. Grey suit, clipboard. | `ped_coat`, grey shirt | traffic-cone orange |
| — | The Collector, Pike's money man (chapter 1, job 7). | `pike` GLB | — |
| — | Clamp's traffic wardens (chapter 2, job 5). Hi-vis yellow. | `ped_stocky` | — |
| — | The Mayor. Mentioned, never seen. | — | — |

The card picks a badge colour from the speaker label: TUNA, PIKE and CLAMP
have their own, and anyone else gets Vex's pink
(`DialogueCard.show` in `src/ui/progressScreens.ts`, colours in
`src/ui/progress.css`). A new speaker needs a line in both.

## Places

The district names are still placeholders (`DISTRICT_NAMES` in
`src/world/districts.ts`). Chapter 2 uses them, and a test checks that its
spawns really are in the districts the dialogue names. Chapter 1's text
still says "arts quarter", "suburbs" and "old town".

| District | Name | In the story |
| --- | --- | --- |
| downtown | GLASS HEIGHTS | the safehouse, the city impound, Clamp's office |
| oldtown | COBBLE ROW | the Saints' vans (ch. 1) |
| arts | NEON MILE | Tuna's hide-outs (ch. 1), Clamp's tow-away zone (ch. 2) |
| industrial | RUSTWATER DOCKS | the docks yard, where Vex takes deliveries |
| residential | MAPLE FLATS | the Collector (ch. 1), Pike's bus shelter (ch. 2) |

There are four payphones, and two jobs in a row never ring the same one.
`phone-oldtown` actually stands just inside Glass Heights.

## Chapter 1 (8 jobs, $13,800)

| # | Job | Phone | Pay | What happens |
| --- | --- | --- | --- | --- |
| 1 | WRONG NUMBER | oldtown | $500 | Vex's audition: steal a sedan and deliver it to the docks yard without a scratch. |
| 2 | TUNA RUN | arts | $700 | Pick up Lil' Tuna, stranded in the arts quarter, and take him to the safehouse against the clock. |
| 3 | SAINTS' PAINT | suburbs | $1,200 | Steal the Saints' purple sports car, lose the 2 stars they call down and deliver it. |
| 4 | SPECIAL DELIVERY | docks | $900 | Find three parcels Tuna dropped out of a moving van. ("Why are my parcels warm.") |
| 5 | SPARE PARTS | oldtown | $1,500 | Wreck the Saints' three parts vans with a shotgun. Pike's first threat. |
| 6 | MIDNIGHT EXPRESS | arts | $2,000 | Night. Pike has put a price on Tuna's head: get him to the docks through checkpoints at 3 stars. |
| 7 | COLLECTION DAY | suburbs | $2,000 | Take down Pike's armed money man, the Collector. His ledger says Pike owes everyone, *including us*. |
| 8 | LAST CALL | docks | $5,000 | Steal Pike's black sports car, survive his 4-star tip-off and bring it home. The Saints scatter. **CHAPTER 1 COMPLETE.** |

## Chapter 2: The Ledger (5 jobs, $12,500)

The hook is the Collector's ledger from job 7. Every month Pike paid two
grand to "C", for "parking". C is **Commissioner Clamp**, who runs the
city's parking and impound. He tows cars legally, sells them back and tows
them again. Every crew pays him or loses its wheels. Pike paid, and Pike
ran the streets. With Pike gone, Clamp wants the Graveyard Shift's yard.
The chapter goes from his ticket to his limo, and it ends with the city
needing a new tow crew.

### 9. FINE PRINT

`m9-fineprint` · phone-oldtown · $1,500

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

### 10. FALLEN SAINT

`m10-fallen` · phone-arts · $1,500

> **DEACON PIKE:** Don't hang up. Please. I've never said please before. It tastes like pennies.
> **DEACON PIKE:** Clamp took everything. My cars, my chrome, my good collar. I live in a Maple Flats bus shelter now.
> **VEX:** He'll spill on Clamp for a lift. Pick him up. He rides in the back. He doesn't touch the radio.

1. **GET A CAR.**
2. **PICK UP PIKE IN MAPLE FLATS.** 120 s. He's at a bus stop, and he's friendly this time.
3. **GET PIKE TO THE SAFEHOUSE.** 120 s, 2 stars. Clamp has tipped off the cops.

> **DEACON PIKE:** Clamp doesn't steal cars. He tows them, legally. Sells them back to you. Then tows them again.
> **DEACON PIKE:** Every crew in town pays him or walks. I paid. You didn't. So now he wants your yard.
> **VEX:** He does what we do, but with paperwork. That's disgusting.

### 11. TOW-AWAY ZONE

`m11-towaway` · phone-docks · $2,000

> **VEX:** Clamp's made all of Neon Mile a tow-away zone. His trucks are hauling off every car on the street.
> **LIL' TUNA:** They took the ice cream van! With the man still in it! He's still serving, off the back of a truck!
> **VEX:** Three of his trucks are working the Mile. Orange, flashing, smug. Here, have something that burns.

1. **WRECK CLAMP'S 3 TOW TRUCKS.** 210 s. You're given molotovs. The trucks are orange (the city's own are yellow) and *driven*: they pull out into traffic as the job starts. This is the first story job with moving targets.
2. **LIE LOW: LOSE THE HEAT.**

> **LIL' TUNA:** The ice cream man's free! He gave me a lolly. I think it was a bribe. I've accepted it.
> **COMMISSIONER CLAMP:** Commissioner Clamp. Damaging city vehicles carries a fine of... everything you own. Good evening.
> **VEX:** He sounds like a voicemail.

### 12. PAPER TRAIL

`m12-papertrail` · phone-suburbs · $2,500 · night (22:00)

> **DEACON PIKE:** Clamp keeps everything on paper. Every bribe, every tow. Alphabetised. Colour-coded. A monster.
> **DEACON PIKE:** Tonight four clerks drive his files to the shredder. And every one of them stops for a kebab.
> **VEX:** So that's four boxes outside four kebab shops. Grab them and bring them to me at the docks.

1. **GRAB CLAMP'S 4 BOXES OF FILES.** 240 s. The boxes are spread round town: two in Cobble Row, one in Neon Mile, one in Rustwater.
2. **GET THE FILES TO THE DOCKS YARD.** 150 s, 2 stars. Vex waits in the yard.

> **LIL' TUNA:** Box four is just his lunch receipts. He's had the same soup every day for eleven years.
> **VEX:** Box one's the good one. Clamp's been towing the Mayor's cars too. And selling them back to her.
> **DEACON PIKE:** He towed the Mayor? ...I'm almost proud of him.

### 13. NO PARKING

`m13-noparking` · phone-oldtown · $5,000 · night (23:45)

> **COMMISSIONER CLAMP:** Graveyard Shift. I have read your file. It is thick. From midnight, your yard is a no-parking zone.
> **VEX:** He's outside his office in Glass Heights, guarding his limo with two traffic wardens.
> **VEX:** Put him down, take the limo, bring it home. Without a car he's just a man with a clipboard.

1. **TAKE DOWN COMMISSIONER CLAMP.** 150 s. You're given an SMG. Clamp is armed. His two wardens, in hi-vis, are unarmed but fight.
2. **TAKE CLAMP'S LIMO.** It's beige.
3. **EVERY COP IN TOWN: HIT THE CHECKPOINTS.** 120 s, 4 stars. Three checkpoints toward the docks.
4. **PARK THE LIMO IN THE DOCKS YARD.**

The job fails if the limo is wrecked or left behind. This is the end of the
story: **STORY COMPLETE.**

> **VEX:** Clamp's limo. In my yard. After midnight. Tuna, what's the rule?
> **LIL' TUNA:** NO PARKING! I've had a wheel clamp ready since Tuesday. I've named it Gerald.
> **VEX:** The Mayor got the files, Clamp's a lollipop man now, and the city needs a new tow crew. Guess who.

## How it plays out in the game

- Jobs run in the order above. The next job is the first one the save
  hasn't passed, so a save that had finished chapter 1 rings for FINE
  PRINT. The debrief on LAST CALL says CHAPTER 1 COMPLETE (`chapter` on
  `MissionDef`, `endsChapter()`), and NO PARKING's says STORY COMPLETE.
- After the story, REPEAT JOBs rotate through all thirteen at half pay.
- The story is worth 30% of completion, split evenly over all thirteen
  jobs. A save that had passed chapter 1 drops from 30% to about 18% for
  the story part until it plays chapter 2.

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

- **The Mayor** now owes the Graveyard Shift, or owns it. She could be
  chapter 3's patron, or its villain.
- **Pike** has a redemption arc going and is living in a bus shelter.
- **The VIPERS** run Neon Mile in free roam and never appear in the story.
  With the Saints gone and Clamp out, who's moving in?
- **Clamp as a lollipop man** outside a Maple Flats school: a cameo
  waiting to happen.
- **The district names** are placeholders. Settle them, then update
  chapter 1's text ("arts quarter", "suburbs", "old town") and chapter 2's.
