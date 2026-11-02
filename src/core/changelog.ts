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
