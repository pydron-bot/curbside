# Police scanner

Part of the living city ([city-life.md](city-life.md)).

**Police scanner** (V2-11; rules and lines pure and tested in
`systems/scanner.ts`, `tests/scanner.test.ts`; the bus wiring in
`game/scanner.ts`, the subtitle in `ui/scannerHud.ts` and `scanner.css`).
The city's street events become short dispatcher lines ("RTC IN COBBLE
ROW. TWO CARS, TWO TEMPERS.") with a radar ping on the incident:

- **Topics:** each street event worth a call (`STREET_TOPICS`: chase,
  race, accident, scuffle, mugging, turf war, fire, the cash van and its
  spilled cash, chucking-out time, the funeral, a burst hydrant, the
  conga, the film shoot, shots fired (V2-10); as chatter a double-parked
  lorry, a car alarm, a busker, the ice cream van; and the closing lines: an arrest, a suspect
  down, a citizen's arrest, a bag handed back; V2-12's gatecrashing: a
  race joined and won (both 3, said over the race's ping; the win closes
  it) and a van nicked (2)) has a priority (1 chatter,
  2 an incident, 3 a spilled cash van, 4 the player's own), a cooldown
  (45–240 s) and one or two lines, `{place}` the district
  (`DISTRICT_NAMES`). Nothing over 220 m off; at most 64 characters with
  the longest district and car (a test).
- **One at a time:** one line waits, the heavier offer winning (a newer
  one of the same weight replaces it), dropped 6 s after it was offered.
  Lines go out `GAP` apart by the stars (6, 7, 8, 9, 11, 14 s at 0–5★);
  the player's own wait only for the one on screen (4.5 s). An offer
  within 40 m of a ping is the same incident (a fight at an accident, the
  cash van's next stop) and is said only if it outranks it.
- **While wanted:** street lines below an incident aren't said from 1★,
  and from 4★ only the spilled cash van gets through (at 5★ one line every
  14 s at most; a waiting line that no longer makes the cut when the
  stars go up is dropped). A star gained names who's sent, the car and
  the district ("ALL UNITS, NEON MILE: RED SALOON. IN A HURRY."; 5★
  "EVERYONE TO NEON MILE, CHOPPER UP. RED SALOON."): the colour from
  `exports.colourName`, the model in the dispatcher's words (SALOON,
  HATCHBACK, BIN LORRY; police and emergency vehicles "STOLEN PANDA CAR"),
  `SUSPECT ON FOOT` on foot (`describeSuspect`). Crossing into another
  district (checked twice a second, 30 s cooldown) and getting into
  another vehicle (15 s) are called too; losing the stars, a respray and a
  bust each have a line; a star dropping or dying, none.
- **Pings:** a topic with a `scene` (CityLife's label for it) drops an
  orange `!` on the radar where it happened (pulsing, pinned to the rim
  when off it), two at most (a third takes the oldest no heavier). It
  follows the scene's `subject()` while that's within 90 m (a chase, a
  conga), and goes when the scene's `running` is 0 (after a 2 s grace), a
  closing event comes within 140 m (`fireOut`, `raceWon`, `arrest`,
  `suspectDown`, `citizensArrest`, `bagReturned`) or its time is up (40–150
  s; a fire, whose scene counts trucks, only by that and `fireOut`).
  Asked 4× a second.
- **Out:** `Scanner.step()` once a frame emits the line as `scanner {kind,
  text, priority, x, z, hold}`. Listeners: the subtitle and `GameAudio`
  (a squelch, a few syllables of radio burble and a roger pip,
  non-positional, `sfx.squelch`); the session log gets a `scanner` line.
  Nothing behind the title (the show's scenes stay quiet); a fresh run
  starts clean.
- **Story lines share it:** a `voice` event (a job's `say` lines, Todd
  in the passenger seat) takes the subtitle under the speaker's name in
  the mission card's cyan, no on-air light; while it's up the dispatcher
  holds his line (`busy`; it goes stale as any waiting line does).
- **Subtitle:** one element, `SCANNER` and an on-air light over the line
  (two lines at most), faded in for its `hold` (3.2–5.5 s by length) on
  the frame clock, so it waits while paused. On touch it runs along the
  bottom edge between the resting steer stick (edge + 150 px) and the
  right thumb's buttons (edge + 292 px: the pedal pad and FIRE in a car,
  the resting aim pad on foot), under the marker prompt, mirrored
  left-handed; on keyboard and pad it's centred above the prompts (bottom
  + 98 px). Blue edge for the player's own lines, orange for the cash, amber
  for the rest. The smoke test holds it up with three stars, a stamp and
  the radio's card, on foot and in a car, and checks it's clear of them
  all (`iphone-852x340-scanner.png`).
- **Off:** Settings → Display → Police scanner (`settings.scanner`,
  default on), or `scanner.setEnabled(false)` from outside (observe mode):
  nothing said, pings off the radar, the subtitle down.

```ts
scanner.setEnabled(on)                // with the setting: off hides it all (observe mode)
scanner.say(topic?)                   // a line now near the player's, whatever the rules (__ub.scanner.say('fire'))
scanner.feed.pings · .stars · .said   // the two ping slots, the stars it knows, lines so far
// Event: { type: 'scanner', kind: ScannerTopic, text, priority: 1..4, x, z, hold }
```

**Budget:** no mesh, draw call or program; one DOM element written when
a line comes or goes, two radar blips set only when they move; nothing
allocated per frame.
