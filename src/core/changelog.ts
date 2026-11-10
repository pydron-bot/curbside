/**
 * The game's version and what each release brought, newest first. The
 * version is Major.Minor.Patch: a minor step per feature release, a patch
 * for fixes. Shown on the title screen and in Settings → Version history;
 * package.json's version must match (tests/changelog.test.ts). Add an entry
 * at the top with each release to main.
 */
export interface Release {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  notes: readonly string[];
}

export const CHANGELOG: readonly Release[] = [
  {
    version: '0.33.0',
    date: '2026-11-10',
    title: 'Kerb Removal Order',
    notes: [
      'KEEP IT LOUD, chapter 2: six new story jobs once QUIETEST CITY is done. Lull blames the goat on "the Curbside" and orders the kerbs dug up. Wreck her diggers, steal back a kebab spit before it goes cold, keep her wardens off Lionel\'s comeback gig, give her consultant a lift, wire up the Mayor\'s own street, and see her out of town. It ends on STORY COMPLETE.',
      'New faces: Manny of the kebab shop, and Todd, Lull\'s consultant, who talks the whole way to the ring road. His lines come up where the police scanner\'s do, and the scanner waits for him.',
      'QUIETEST CITY now closes chapter 1. The story\'s share of completion is spread over all twelve jobs, so a finished chapter 1 counts for half of it.',
    ],
  },
  {
    version: '0.32.3',
    date: '2026-11-06',
    title: 'Travelling light',
    notes: [
      'The game starts with less code to read: the map editor, the TEST menu, the LOOK panel and this version history now load the first time they\'re opened (they still work offline).',
    ],
  },
  {
    version: '0.32.2',
    date: '2026-11-06',
    title: 'Back on your feet',
    notes: [
      'Thrown off a motorbike or scooter, you no longer get up tilted, lying flat or facing the wrong way: the bike\'s lean and tilt stayed on your body after the fall.',
    ],
  },
  {
    version: '0.32.1',
    date: '2026-11-05',
    title: 'Which way up',
    notes: [
      'Bug reports now say what the player\'s body is doing on foot (knocked down or up, the animation playing, which way up it stands), to track down a player seen lying flat while aiming.',
    ],
  },
  {
    version: '0.32.0',
    date: '2026-11-04',
    title: 'Power cut',
    notes: [
      'Diagnostics: LOW POWER TESTS, three switches for hunting down what slows the game in Low Power Mode: one simulation step a frame (slow motion below 60 fps), half the street crowd, half the traffic. They stay on until switched off.',
    ],
  },
  {
    version: '0.31.1',
    date: '2026-11-04',
    title: 'Mind the bollards',
    notes: [
      'Map editor: after VIEW IN 3D, a car that had already planned to turn into a street you\'d just made pedestrian (or removed) now picks another way, instead of driving down it.',
    ],
  },
  {
    version: '0.31.0',
    date: '2026-11-04',
    title: 'Under the bonnet',
    notes: [
      'Diagnostics: GPU BREAKDOWN. Pause on a busy moment and press RUN: for about 15 seconds the paused scene is redrawn with one part left out at a time (shadows, buildings, glows, people, smoke…), and the report shows what each one costs the phone\'s graphics chip.',
    ],
  },
  {
    version: '0.30.1',
    date: '2026-11-04',
    title: 'Sun through the leaves',
    notes: [
      'Tree shadows: dappled light is now round flecks of sun inside the shadow, which keeps its shape. Before, the shadow broke up into blobs and at the slider\'s top end almost vanished.',
      'Low Power Mode on iPhone: the automatic graphics setting no longer drops to low (losing the shadows) when that doesn\'t make the game any smoother. A drop now has to prove it helps over several seconds, and is checked again after it\'s kept.',
      'Perf overlay and Diagnostics: a "tail" figure, the browser\'s own time after each frame, so a report shows where slow frames go.',
    ],
  },
  {
    version: '0.30.0',
    date: '2026-11-04',
    title: 'Open files',
    notes: [
      'Map editor: IMPORT loads a city.json (or drop the file onto the editor). It replaces your local edits as one step, so UNDO brings them back; anything in the file the game can\'t read is listed and skipped.',
    ],
  },
  {
    version: '0.29.0',
    date: '2026-11-04',
    title: 'Street plans',
    notes: [
      'Map editor: a street can be paved over as a pedestrian street (bollards at each end, benches and planters down the middle, people strolling on it, no traffic) or removed outright, merging the blocks either side into one bigger block. A merged block\'s panel lists the roads removed inside it, each with PUT BACK.',
      'Add payphones and choose which phone each story job rings from; any payphone, the original four too, can be removed once no job rings from it.',
      'Make your own frenzies: pick the goal, the target, the time limit and a gift weapon. They count toward 100%.',
      'Story jobs\' spots, drive routes and race steps can be moved; so can the docks yard, the Pay \'n\' Spray bays, the police station and the hospital, and pickups can be moved, removed or added.',
      'The editor shows shop doors and road works up close, and lists which street scenes a block or road can host.',
      'VIEW IN 3D now rebuilds everything, jobs, frenzies, gangs, buses and all, so you can carry on playing on your edits with no reload.',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-11-03',
    title: 'Map makers',
    notes: [
      'Map editor: PLACE now adds new stunt ramps, kickers, gang hangouts and hidden packages, not just street props.',
      'Hidden packages stay put: they no longer shift when a block is edited, and the editor can move, remove or add them (the map wants 40).',
      'A block can be cleared to an empty lot (waste ground with dumped junk), or given another district\'s building style while keeping its own district.',
      'VIEW IN 3D rebuilds the city in place, with no reload, and drops you into observe mode over your edit. PLAY ON EDITS restarts the game on them.',
      'Click again on a spot in the editor to step through everything stacked there.',
    ],
  },
  {
    version: '0.27.0',
    date: '2026-11-03',
    title: 'Look book',
    notes: [
      'TEST → LOOK: a slim panel down the edge of the screen with about fifty sliders over the look (sky and light by time of day, the colour grade, neon and night, the daytime effects), applied live while you play and kept on this device.',
      'Each slider shows how far it is from the shipped look, with a reset per slider and RESET ALL; the clock can be held at any hour while you tune.',
      'EXPORT downloads look.json, to hand over and ship as the game\'s look.',
      'The panel folds to a tab on the edge, and moves to the other side of the screen.',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-11-03',
    title: 'Day out',
    notes: [
      'Trees sway in the wind, harder when it rains, with sunlight dappling through their leaves onto the grass.',
      'Plaza fountains spray, lit cyan at night, with a faint rainbow in the spray on sunny days.',
      'Sprinklers sweep the lawns of the parks, most in the suburbs and the old town.',
      'Morning mist drifts through the old town and the suburbs at dawn and burns off as the sun climbs.',
      'Billboards: most of downtown\'s roof signs show painted adverts by day and switch to neon at night.',
      'Seagulls wheel over the docks\' shore, their shadows sweeping the quay.',
      'The street art is toned down: fewer, more faded painted crossings, roof murals, logos and bay numbers, and fewer basketball courts.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-03',
    title: 'Sunny side',
    notes: [
      'Cloud shadows drift across the city on sunny days.',
      'Rooftop pools: turquoise water with sunlight rippling on it, and underwater lights at night.',
      'The sun glints off cars as they turn, off metal roofs and skylights, and off the pools.',
      'Each part of town paints its crossings its own way: rainbow in the arts quarter, white and cyan downtown, hazard stripes at the docks, brick red in the old town, pastel blue in the suburbs.',
      'Seen from above: murals on arts-quarter roofs, company logos on downtown\'s, giant bay numbers on the docks\' sheds, and basketball courts in the parks.',
      'Now and then a plane or a blimp passes over, its shadow sweeping across the streets.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-11-03',
    title: 'After hours',
    notes: [
      'The city goes to bed: windows go dark one by one as the night wears on, TVs flicker blue in some, and flats in the arts quarter glow pink and cyan.',
      'Better rain: drops ripple across the puddles, cars throw spray off their tyres, and wet cars gleam.',
      'Fireworks over downtown at midnight, their colours lighting up the streets below.',
      'Explosions send a bright shockwave racing across the ground and flash the walls around them.',
      'When you\'re wanted, red and blue light pulses at the edges of the screen, faster with every star.',
      'WASTED and BUSTED now glow in the title screen\'s neon, with a VHS glitch.',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-11-03',
    title: 'Neon nights',
    notes: [
      'Neon and traffic lights now shine in the wet road at night: every shopfront tube, rooftop sign and signal streaks across the asphalt in its own colour, more so in the rain.',
      'Police light bars wash the buildings and the street around them red and blue.',
      'String lights hang across the arts quarter\'s streets: rows of warm and coloured bulbs over the traffic.',
      'Rooftop neon signs come alive: some cycle through colours, some run chase lights, some light up along their length and go out again.',
      'Searchlights sweep the night sky from downtown\'s tallest roofs.',
      'Steam drifts up from vents in the road at night, lit pink, cyan or warm by the lights around it.',
    ],
  },
  {
    version: '0.22.1',
    date: '2026-11-03',
    title: 'Fixes',
    notes: ['The street lamps\' reflections on the road at night no longer break up into cut-off wedges in the middle of junctions.'],
  },
  {
    version: '0.22.0',
    date: '2026-11-03',
    title: 'Neon city',
    notes: [
      'The city now looks like the title screen: a new colour grade with violet shadows and warm pink highlights, a pink-and-magenta sunset into a violet dusk, and nights under a cyan moon.',
      'Neon on the rooftops: glowing tubes along the roof edges and down the corners of buildings, and lit signs leaning over the roofs, most of all in the arts quarter and downtown. A few of them flicker.',
      'Wet-look streets at night: the roads take on a damp sheen, street lamps streak across the asphalt, and tail lights smear red behind the traffic.',
      'Sports cars come with neon underglow in pink, cyan, violet or green, and now and then other cars do too. Fast cars leave light trails at night.',
      'Headlights no longer throw extra beams out to the sides: each beam now starts at the car\'s own lamps.',
      'The HUD matches the logo: a neon rim on the radar, a hot-pink health bar and a cyan car-health ring.',
      'New in Settings → Extras: Neon filter, the title screen\'s tint and scanlines over the game (off by default).',
      'Downtown picks up some Art Deco pastels: aqua, periwinkle and lilac.',
    ],
  },
  {
    version: '0.21.2',
    date: '2026-11-03',
    title: 'Sticky charge models',
    notes: [
      'The sticky charge has a proper model, in your hand and stuck to a car: a taped brick with a red detonator box and a stubby aerial. The blinking light now sits on the detonator.',
      'Car panels thrown out of explosions have a folded edge, so they read as bits of car rather than flat chips (and show up better at night).',
      'Deacon Pike\'s long coat now moves with his legs, so it no longer hangs through the seat when he rides a bike.',
    ],
  },
  {
    version: '0.21.1',
    date: '2026-11-03',
    title: 'Fixes',
    notes: [
      'Driving fast north or south, the camera no longer pushes your car up under the job card and the stars, or down under the scanner\'s subtitle: it keeps you in the clear middle of the screen and climbs a little to show the road ahead.',
      'The white van (the one parked by the safehouse) no longer looks like it is going backwards: its bonnet is now at the front.',
      'The wanted stars should no longer leave a stray star beside or between them on iPhone.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-03',
    title: 'Map editor',
    notes: [
      'A map editor, for testing on a desktop (TEST → MAP → MAP EDITOR, with Test tools on): the whole city from above. Change a block (buildings, park, plaza or car park, its district, its layout and how tall it builds), close a road or make it one-way, move the safehouse, payphones, frenzy tokens, gang hangouts and ramps, and place or remove street furniture. Select a road, block or crossing to see everything that relies on it, races and story jobs included; anything an edit breaks shows in red. VIEW IN 3D plays your edits; EXPORT writes the map file that ships.',
      'Closed roads in a shipped map get barriers at both ends, and traffic, the police, buses and story drivers keep off them (and keep to one-way streets).',
      'The street furniture, bus stops, food carts and shopfronts have been laid out afresh (same streets, a new arrangement), so editing one block never moves anything in another. The opening scene now plays at a bus shelter closer to the safehouse.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-02',
    title: 'Sticky charge',
    notes: [
      'New weapon, the STICKY CHARGE: throw it and it sticks to the first car it hits, then rides along wherever that car goes. Set it off when you choose with BOOM (on touch; the button shows while a charge is out), G on the keyboard or D-pad down on a controller, on foot or from your own car. Every charge you have out goes at once; three at most. A throw that misses lies on the road and still goes off.',
      'Lionel hands you two in RIBBON CUTTING. Pass that job and STICKY CHARGES are on the safehouse shelf: two for $700.',
      'New stamp, PARTING GIFT: set off a charge on a car someone else is driving while you are 30 m away or more, or on the cash van or the Mayor\'s limo from anywhere.',
    ],
  },
  {
    version: '0.19.1',
    date: '2026-11-02',
    title: 'New weapon models',
    notes: [
      'The air horn, taser, stinger and smoke grenade now show in your hand, and each has its own crate in the street with the weapon on the lid.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-02',
    title: 'Room to grow',
    notes: [
      'Groundwork for a bigger city. Nothing moves in the city you know: a test build can now add a ring of new streets round it (add ?city=24 or ?city=32 to the address), with its own save so your real one is untouched. The new streets are blank for now; their districts and things to do come next.',
      'Smoke costs less to draw: the buildings that hide it are only drawn near the camera.',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-02',
    title: 'Taser, stinger and smoke',
    notes: [
      'New weapon, the TASER: two darts that drop one person for a few seconds without hurting them. Stop a mugger or a fleeing suspect and it is HAVE-A-GO HERO; a tased runner gives up, and when the police cuff them it is your CITIZEN\'S ARREST. Tasing a police officer is still a crime. Look for electric-blue-ringed crates.',
      'New weapon, the STINGER: a spike strip you throw across the road on foot or drop out of the back of your car. Anything that drives over it bursts its tyres, slews and limps on its rims, police included, so it shakes a chase without a shot (SPIKED). Look for steel-ringed crates.',
      'New weapon, the SMOKE GRENADE: a thick cloud for about ten seconds that the police cannot see into, out of or through, and nor can the helicopter\'s spotlight. Police cars that drive into it get lost: some crawl to a stop, some stop dead with their hazards on, some take a wrong turn. Officers cough, people walk out of it and traffic brakes hard. Look for pale-grey-ringed crates.',
      'The shop sells all four new-wave weapons: the AIR HORN, TASER, STINGERS and SMOKE GRENADES.',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-11-02',
    title: 'Air horn',
    notes: [
      'New weapon, the AIR HORN: a deafening blast that makes people cover their ears and scatter, startles drivers into braking and swerving, and sets off car alarms (DOMINO pays). It is a nuisance, not assault: a whole canister never earns a star. Look for pink-ringed crates in the street.',
      'Observe mode\'s START SOMETHING list now scrolls on phones, so every scene can be reached.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-02',
    title: 'Race crasher',
    notes: [
      'Gatecrash a street race: pull onto its route going its way and you are in. Win and the leader\'s car is yours (RACE CRASHER).',
      'Drive off in the ice cream van while people are queueing and the queue comes after you on foot (VAN NICKED).',
      'Your best moment: the best stamp of each life is photographed as it lands and shown on WASTED and BUSTED with its name, place and time. SHARE sends the picture.',
      'A cleaner start for new players: the title shows PLAY and SETTINGS, and OBSERVE, CHARACTER and HOW TO PLAY appear after the opening. PROGRESS lists what is still to come and when it opens.',
      'Fixed thin black lines that flickered across the road at the end of headlight beams.',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-11-02',
    title: 'Wrong stop',
    notes: [
      "A new game now opens in the street: you're waiting at a bus stop when a police chase's getaway car crashes at the kerb in front of you. Get in and lose the heat. It plays once; Settings → REPLAY OPENING plays it again. Chaos Run, frenzies, races, exports and taxi fares open up after the second story job.",
      'KEEP IT LOUD chapter 1 is complete: take Doreen\'s van back off a tow truck without a scratch, wreck the Mayor\'s limo at a ribbon cutting, and cause chaos round the judges\' coach for the finale.',
      'Borrowed Blues: steal a fire truck and hose people flat or put out fires, an ice cream van and play the chime to pull a queue, or a tow truck and winch wrecks to the docks yard for cash. After dark Vex rings with tow contracts.',
      'OBSERVE, on the title and the pause menu: a free camera over the living city with no player and no HUD. Pan, zoom and rotate, follow any car or person, jump to the next incident, start any street scene, and change the time and the weather.',
      "Your mess becomes the city's problem: crash into someone and they get out to argue, then a patrol takes a statement and a tow truck clears up. Gunfire sets off car alarms and someone calls it in. Each link in the chain you started pays a DOMINO bonus.",
      'A police scanner calls out what is happening round the city and marks it on the radar, and names your car and district when you are wanted. It can be turned off in Settings.',
      'On phones, long stamp names no longer cover the NOS button in a Chaos Run.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-11-02',
    title: "The city doesn't stop for you",
    notes: [
      "Being wanted no longer clears the streets: street races, fights, muggings, turf wars, accidents and police chases keep happening while the cops are after you, a little less often the more stars you have. Some turn up on the road ahead, so your chase runs straight through them.",
      "Join in a police chase: steal the getaway car and its cops are yours (TAKE THE HEAT, 2 stars). Ram the getaway to a stop by a patrol for a CITIZEN'S ARREST and a reward with no heat. Flooring a fleeing suspect or a mugger is a HAVE-A-GO HERO, not an assault.",
      'Big stamps name your best mayhem (BARBECUE SEASON, BANK HOLIDAY and more), and people nearby get their phones out to film it.',
      'Six new things happen in the city: a cash-in-transit van on its rounds, kebab-shop chucking-out time, a funeral procession, burst hydrants, hen and stag congas, and a film shoot in Glass Heights. Each one can be joined in or wrecked.',
      "A new main story begins, KEEP IT LOUD: Mayor Lull wants the quietest city in the country, and the street's traders want you to keep it loud. Jobs 2 and 3 are in; the opening and the rest come next.",
      "The Graveyard Shift's thirteen jobs are now the Night Shift side story: they ring after dark from the docks phone. Progress is kept, but the PROGRESS page counts story completion from the new main story, so it starts at 0% again.",
      'Chaos Run gets the living city too.',
    ],
  },
  {
    version: '0.13.1',
    date: '2026-11-02',
    title: 'No more black screen on High',
    notes: [
      'On the High graphics setting, part of the screen could turn black and stay black, mostly with cars driving in view. The glow effect could pick up one bad pixel and smear it across the screen; it now ignores bad pixels and caps extreme brightness.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-02',
    title: 'Real street furniture',
    notes: [
      'Road works, food carts, bus shelters and the rest of the new kerbside furniture are proper models now instead of boxes: barrels and barriers with blinking lamps, a mini digger, skips, a hot-dog cart under its umbrella, a coffee cart, fruit stands, bike racks, café tables and more.',
      "Café umbrellas are red and cream instead of plain white.",
    ],
  },
  {
    version: '0.12.2',
    date: '2026-11-02',
    title: 'Better performance reports',
    notes: [
      'Coming back to the game after switching apps no longer shows up as a slow moment in the performance log.',
      'The performance log looks closer at the first 30 seconds after the game starts, and notes when each model finishes loading.',
      'The game no longer lowers its graphics settings while models are still loading.',
    ],
  },
  {
    version: '0.12.1',
    date: '2026-11-02',
    title: 'Lighter smoke',
    notes: [
      'Big explosions and fires keep their frame rate better on phones: thick smoke is drawn at half resolution, with the same look.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-02',
    title: 'Smoother city, livelier title',
    notes: [
      'The title camera keeps the action in the open space right of the menu.',
      'After a while the title screen cuts to something happening in the city (a police chase, a street race, a fire, a turf war, the ice cream van...) and follows it, with a caption.',
      'Street props draw only their own shapes: 3–9× fewer triangles per frame, same look.',
      'Small props and rubble are lit by just the street lamps that reach them at night.',
      'People, traffic and dogs far off screen think less often; anything near you or in a fight stays at full speed.',
      'TEST → Scenes: dogs chase a runner.',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-01',
    title: 'Version numbers, bug reports and smoother mayhem',
    notes: [
      'The version shows on the title screen.',
      'Settings → Version history lists every release.',
      'REPORT BUG (the bug on the pause card, with test tools or the perf overlay on): a screenshot, where you are and what just happened, shared from your phone with a note.',
      'The performance log notes what was on screen (particles, fires, glows, people, cars, scenes) and catches every slow stretch.',
      'Heavy mayhem keeps its frame rate better on phones: smoke thins sooner when the screen fills, and many fires share their flames.',
      'Settings → Test tools adds TEST to the pause menu for playtesting: god mode, weapons, wanted level, spawn any vehicle, time of day, rain, slow motion, teleport from the city map, start any street scene, and save tools (CRED, cash, story jobs, tutorial, reset, export and import). God mode moved there; any of it marks the life (no CRED, bests or medals).',
      'For playtesting: labels over the people and cars doing something (medics, chases, queues, gangs...); Shift+L on a keyboard.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-01',
    title: 'The living city',
    notes: [
      'The knocked out stay down; an ambulance takes them to the new hospital.',
      'Fires after explosions bring out fire trucks; tow trucks clear wrecks, crashes and the odd parked car.',
      'Parked cars at the kerb and in car parks, with alarms when hit.',
      'Anyone armed who is knocked out drops their gun.',
      'Street props: road works, food carts, bus shelters, café tables, planters and more.',
      'Buses stop for riders; the ice cream van and food carts get queues; buskers draw crowds.',
      'Fights between people, muggings to stop, and witnesses who phone in your crimes.',
      'Crowds follow the hour and the rain (umbrellas, nightlife in the Neon Mile); stray dogs; pigeons land again.',
      'Gang turf fights, police chases you are not in, night street races, accidents and double-parked trucks.',
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-01',
    title: 'CRED pacing and god mode',
    notes: [
      'Banked chains no longer count three times toward CRED: levels come at a steadier pace.',
      "God mode for testing (Settings → Controls): you can't die or be busted; no CRED or bests.",
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-01',
    title: 'CRED and perks',
    notes: ['Every life earns CRED; each level is a pick of three perks that last for good.', 'PROGRESS shows your level and every rank.'],
  },
  {
    version: '0.8.0',
    date: '2026-11-01',
    title: 'The Ledger and the music',
    notes: [
      'Story chapter 2, The Ledger: five jobs against Commissioner Clamp.',
      'Four radio stations, a title theme, stings, chase music and music on foot.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-31',
    title: 'Turf and replays',
    notes: [
      'District names and an area card; the VIPERS hold the Neon Mile, with respect to earn.',
      'A female player body, picked on the title screen.',
      'Mission cars you drive, and REPEAT JOB replays after the story.',
      'A rendered drum kit and four songs per station, with titles on the radio card.',
      'An INSTALL button and a home-screen icon.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-31',
    title: 'Tuned for the phone',
    notes: [
      'A perf overlay and a Diagnostics sheet with Share / Copy.',
      'Fast cars no longer pass through walls; furniture is solid.',
      'Traffic gives way at junctions; race gold is in reach in any car.',
      'Live touch tuning and a destruction test.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-30',
    title: 'Real models, online',
    notes: [
      'Characters, cars, a police helicopter, scooters and motorbikes, weapons, props and landmarks from Blender.',
      'Story characters on the street; pigeons on the plazas.',
      'Playable at deeek.org/curbside.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-30',
    title: 'Heat and chaos',
    notes: [
      "Wanted stars, police pursuits, BUSTED and Pay 'n' Spray.",
      'Cash, chaos chains to bank, the Chaos Run and activities.',
      'New handling, damage, weapons, drive-bys and stunt ramps.',
      'Explosions, tyre smoke, rain and camera shake.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-30',
    title: 'Sound, look and menus',
    notes: ['Synthesised sound and adaptive music.', 'Day, golden hour and night lighting.', 'Title screen, menus, touch controls, HUD and radar.'],
  },
  {
    version: '0.2.0',
    date: '2026-10-30',
    title: 'Solid ground',
    notes: ['Quality tiers and dynamic resolution.', 'Smarter traffic and a busier street.', 'Updates wait for a good moment; recovery from a lost display.'],
  },
  {
    version: '0.1.0',
    date: '2026-10-29',
    title: 'First playable',
    notes: ['Drive, steal and fight in a top-down city.', 'Weapons, people who fight back, health, a taxi and pickups.'],
  },
];

/** The running version, e.g. "0.11.0". */
export const VERSION: string = CHANGELOG[0].version;

/** Compare two Major.Minor.Patch versions: < 0 if a is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
