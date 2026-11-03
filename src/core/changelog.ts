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
