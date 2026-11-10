/**
 * The story jobs, in two arcs. The main story, KEEP IT LOUD (arc 'main', ids
 * s1-s6, and chapter 2 from s7, being built): Mayor Lull's Quiet Streets Act has banned car alarms, chimes and
 * buskers, and the kerb traders (DOREEN of the ice cream van, LIONEL the
 * busker) hire the sacked alarm fitter to keep the city loud. It rings by
 * day and in the evening from the city's phones. The Night Shift side story
 * (arc 'night', the old Graveyard Shift jobs m1-m13, ids kept so saves keep
 * their progress) rings only after dark from the docks-yard phone: VEX's
 * tow crew, chapter 1 the war with DEACON PIKE's Chrome Saints, chapter 2
 * THE LEDGER and COMMISSIONER CLAMP. Each job pays and unlocks the next in
 * its arc; s1, WRONG STOP, is the cold open's and rings no phone. The
 * script and the cast are in docs/STORY.md. Positions come from the road
 * grid (kerbs) and the pavement paths, so everything spawns clear of
 * buildings; the docks and the safehouse are passed in.
 */
import { corePavement } from '../game/modes/places';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK } from '../world/city';
import { DIR_VEC, dirHeading, type Dir } from '../world/roads';
import { NIGHT_PHONE, type MissionDef } from './missions';
import { LULL_LIMO_PAINT } from './charges';
import { GETAWAY_TAG, OPENING_JOB } from '../game/opening';
import type { MapEdits } from '../world/mapEdits';
import { ACTIVE_MAP } from '../world/shippedMap';
import { editMissions } from './storyEdits';

type Point = { x: number; z: number };

/** Parked at the right-hand kerb, `along` m out of crossing (ix, iz) heading `d`. */
function kerb(ix: number, iz: number, d: Dir, along: number): { x: number; z: number; heading: number } {
  const v = DIR_VEC[d];
  const right = 5.5;
  return { x: ix * BLOCK_SIZE + v.x * along - v.z * right, z: iz * BLOCK_SIZE + v.z * along + v.x * right, heading: dirHeading(d) };
}

/** On the pavement beside a kerb() spot (the walking line, as crowd.ts walks it). */
function kerbside(ix: number, iz: number, d: Dir, along: number): Point {
  const v = DIR_VEC[d];
  const right = ROAD_WIDTH / 2 + SIDEWALK / 2;
  return { x: ix * BLOCK_SIZE + v.x * along - v.z * right, z: iz * BLOCK_SIZE + v.z * along + v.x * right };
}

/**
 * Where Vex waits for a delivery at the docks yard: beside the bay's mouth,
 * just inside the lot (the bay you drive into faces `heading`).
 */
function besideBay(bay: Point & { heading?: number; halfWidth?: number; halfLength?: number }): Point {
  const h = bay.heading ?? 0;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const back = (bay.halfLength ?? 4.6) - 1;
  const side = (bay.halfWidth ?? 3.6) + 1.8;
  return { x: bay.x - fx * back + fz * side, z: bay.z - fz * back - fx * side };
}

const pt = (p: Point): [number, number] => [p.x, p.z];

const VEX = 'VEX';
const TUNA = "LIL' TUNA";
const PIKE = 'DEACON PIKE';
const CLAMP = 'COMMISSIONER CLAMP';
const DOREEN = 'DOREEN';
const LIONEL = 'LIONEL';
const LULL = 'MAYOR LULL';
const MANNY = 'MANNY';

/** Clamp's tow trucks: traffic-cone orange, apart from the city's yellow ones. */
const CLAMP_ORANGE = '#e0661f';
/** Doreen's van behind the Shift's truck on the hook, m centre to centre (the truck's reach 3.5, the hook's gap, the van's 2.8). */
const HOOK_BEHIND = 6.9;
/** The Graveyard Shift's blue (Vex's truck, the crew's). */
const SHIFT_BLUE = '#3c5a8c';
/** Doreen: ice cream van mint. */
const DOREEN_MINT = '#bfe8d8';
/** Wardens' hi-vis (Clamp's in the Night Shift, Lull's in the main story). */
const HI_VIS = '#d4e23c';
/** The council's own vans: municipal white. */
const COUNCIL_WHITE = '#e4e4dc';

/** The jobs, with the map's edits (`edits`, default the map this page plays: phones the jobs ring from, spots moved; systems/storyEdits.ts). */
export function buildMissions(docks: Point & { heading?: number; halfWidth?: number; halfLength?: number }, safehouse: Point, edits: MapEdits = ACTIVE_MAP): MissionDef[] {
  return editMissions(writtenMissions(docks, safehouse), edits);
}

/** The jobs as written. */
function writtenMissions(docks: Point & { heading?: number; halfWidth?: number; halfLength?: number }, safehouse: Point): MissionDef[] {
  const saintCar = kerb(-4, 4, 1, 26);
  const vans = [kerb(-3, -3, 1, 18), kerb(-3, -3, 1, 23.5), kerb(-3, -3, 1, 29)];
  const pikeCar = kerb(5, 6, 0, 30);
  // Deacon Pike himself, guarding his car from the pavement beside it.
  const pike = kerbside(5, 6, 0, 30);
  // Vex waits at the docks yard for whatever you bring her.
  const vex = besideBay(docks);
  const tuna = corePavement(9, 3, 2, 0.5);
  const tuna2 = corePavement(11, 2, 3, 0.5);
  const collector = corePavement(3, 12, 0, 0.5);
  const parcels = [corePavement(10, 9, 0, 0.5), corePavement(12, 6, 3, 0.4), corePavement(9, 12, 1, 0.6)];
  // Chapter 2. Vex's tow truck, impounded on a Glass Heights kerb.
  const shiftTruck = kerb(-1, 0, 2, 26);
  // Pike, down on his luck at a Maple Flats bus stop.
  const pikeStop = corePavement(3, 11, 1, 0.5);
  // Clamp's trucks out working Neon Mile (they drive off as you arrive).
  const tows = [kerb(2, -4, 1, 20), kerb(6, -1, 1, 20), kerb(5, -5, 3, 20)];
  // Four boxes of files outside four kebab shops round town (two in Cobble Row, Neon Mile, Rustwater).
  const files = [corePavement(6, 2, 2, 0.5), corePavement(13, 3, 1, 0.5), corePavement(2, 6, 0, 0.5), corePavement(11, 11, 3, 0.5)];
  // Clamp's limo outside his office in Glass Heights, Clamp beside it, a warden either side.
  const limo = kerb(1, -1, 0, 26);
  const clamp = kerbside(1, -1, 0, 26);
  const wardens = [kerbside(1, -1, 0, 18), kerbside(1, -1, 0, 34)];
  // KEEP IT LOUD. Cobble Row, the street the player wired: a crossing in the middle of it.
  const cobble = { x: -4 * BLOCK_SIZE, z: -4 * BLOCK_SIZE };
  // Lull's two wardens writing Lionel up in Glass Heights; Lionel hiding round the corner.
  const lullWardens = [corePavement(9, 6, 0, 0.35), corePavement(9, 6, 0, 0.7)];
  const lionel = corePavement(9, 6, 1, 0.55);
  // Where Lionel plays on Neon Mile.
  const mile = kerb(5, -4, 0, 26);
  const spareLionel = [{ down: 'lionel', reason: 'NOT LIONEL! HE WAS ON YOUR SIDE' }];
  // The Graveyard Shift's truck on Neon Mile with Doreen's van on its hook, and Doreen's pitch in Cobble Row.
  const shiftTow = kerb(2, -5, 1, 26);
  const hookedVan = kerb(2, -5, 1, 26 - HOOK_BEHIND);
  const pitch = kerb(-3, -5, 1, 30);
  const doreen = kerbside(-3, -5, 1, 30);
  const vanFails = [
    { wrecked: 'doreenvan', reason: "DOREEN'S VAN IS WRECKED" },
    { damaged: 'doreenvan', reason: "YOU SCRATCHED DOREEN'S VAN" },
  ];
  // The Mayor's limo at her ribbon outside the Town Hall in Glass Heights.
  const ribbon = kerb(-2, 0, 1, 26);
  // The judges' coach: leaves Glass Heights and tours Cobble Row and Neon Mile, round and round.
  const coach = kerb(-1, 0, 0, 26);
  const tour: Array<[number, number]> = [
    [-1, -3],
    [-4, -4],
    [0, -6],
    [3, -5],
    [3, -2],
    [0, -1],
  ];
  // Along it: a race in Cobble Row, a fire on the Mile, a turf flare-up where the Mile meets Glass Heights.
  const node = (i: number) => ({ x: tour[i][0] * BLOCK_SIZE, z: tour[i][1] * BLOCK_SIZE });
  // KEEP IT LOUD, chapter 2. Manny's spit in a council van at the city impound (Glass Heights), and his shop in Cobble Row.
  const spitVan = kerb(-1, 0, 2, 26);
  const mannyShop = kerb(-5, -6, 1, 30);
  const manny = kerbside(-5, -6, 1, 30);
  // The Mayor's street in Glass Heights: five cars along it to wire, her house halfway down.
  const lullStreet = [12, 20, 28, 36, 44];
  const lullHouse = kerbside(2, 1, 2, 28);
  // Her leaving convoy outside the Town Hall: the limo, then two warden vans behind it.
  const convoy = [kerb(-2, 0, 1, 34), kerb(-2, 0, 1, 26), kerb(-2, 0, 1, 18)];
  // Its tour: up out of Glass Heights, Cobble Row, the ring road across the top, down Neon Mile and home.
  const sendOff: Array<[number, number]> = [
    [-2, -3],
    [-5, -5],
    [-5, -8],
    [3, -8],
    [3, -3],
    [0, -1],
  ];
  const via = (i: number) => ({ x: sendOff[i][0] * BLOCK_SIZE, z: sendOff[i][1] * BLOCK_SIZE });

  return [
    // ── KEEP IT LOUD (the main story) ──
    {
      // The cold open (game/modes/openingMode.ts starts it at PLAY, lending it the crashed getaway): no call, no phone.
      id: OPENING_JOB,
      title: 'WRONG STOP',
      arc: 'main',
      phone: '',
      direct: true,
      reward: 300,
      intro: [],
      outro: [
        { who: DOREEN, text: "You're the alarm fitter. Lost your job tonight, I heard. I lost my chimes." },
        { who: DOREEN, text: "Lull's banned anything louder than a sigh. Fancy keeping this city loud? It pays." },
        { who: DOREEN, text: 'Badly. But in ice cream.' },
      ],
      steps: [
        {
          kind: 'enter',
          tag: GETAWAY_TAG,
          text: 'GET IN · LOSE THE HEAT',
          fail: [{ wrecked: GETAWAY_TAG, reason: 'THE GETAWAY IS WRECKED' }],
        },
        // The stars come with the car (TAKE THE HEAT): the one main job that asks you to lose them.
        { kind: 'loseHeat', text: 'LOSE THE HEAT' },
      ],
    },
    {
      id: 's2-noise',
      title: 'MAKE SOME NOISE',
      arc: 'main',
      phone: 'phone-oldtown',
      reward: 1000,
      // Doreen introduced herself after the cold open; Lull's notice is the backstory beat.
      intro: [
        { who: LULL, text: 'Mayor Lull. From midnight, car alarms are illegal. So are chimes. And buskers. And joy.' },
        { who: LULL, text: 'Alarm fitters, please hand in your alarms. Quietly.' },
        { who: DOREEN, text: 'Twenty years you wired Cobble Row. Every alarm on that street is yours. Remind them.' },
      ],
      outro: [
        { who: DOREEN, text: "Heard that from the docks. The council's lodged a complaint. Lovely." },
        { who: LULL, text: 'Mayor Lull. Noise in Cobble Row has been noted. Wardens are on their way. Quietly.' },
      ],
      steps: [
        {
          kind: 'mayhem',
          points: 2500,
          near: { ...cobble, district: 'oldtown' },
          text: 'MAKE COBBLE ROW LOUD',
          // A street race through it: something to crash into.
          start: [{ do: 'scene', scene: 'race', ...cobble, r: 160 }],
        },
      ],
    },
    {
      id: 's3-quiet',
      title: 'QUIET PLEASE',
      arc: 'main',
      phone: 'phone-suburbs',
      reward: 1500,
      intro: [
        { who: LIONEL, text: 'Two wardens have nicked my hat. My hat is my livelihood. And my hat.' },
        { who: LIONEL, text: "They're in Glass Heights, writing me up for unlicensed joy. I'm hiding behind a bin." },
        { who: DOREEN, text: 'Flatten the wardens, pick Lionel up and get him to Neon Mile. The Mile likes a song.' },
      ],
      outro: [
        { who: LIONEL, text: "I'd pay you, but it's in the hat, and the hat's evidence." },
        { who: LIONEL, text: 'Neon Mile! An audience! Several of them are even awake!' },
        { who: DOREEN, text: "Lull will send more wardens. Good. Means it's working." },
      ],
      steps: [
        {
          kind: 'knockOutAll',
          tags: ['lullwarden1', 'lullwarden2'],
          text: 'FLATTEN THE WARDENS',
          fail: spareLionel,
          start: [
            ...lullWardens.map((p, i) => ({ do: 'spawnPed' as const, tag: `lullwarden${i + 1}`, ...p, shirt: HI_VIS, hostile: true, body: 'ped_stocky' as const })),
            // A busker's red waistcoat.
            { do: 'spawnPed', tag: 'lionel', ...lionel, shirt: '#a8322b', body: 'ped_slim' },
          ],
        },
        { kind: 'enter', text: 'GET A CAR', fail: spareLionel },
        {
          kind: 'pickup',
          tag: 'lionel',
          text: 'PICK UP LIONEL',
          fail: spareLionel,
          done: [{ do: 'board', tag: 'lionel' }],
        },
        {
          kind: 'deliver',
          x: mile.x,
          z: mile.z,
          r: 9,
          text: 'GET LIONEL TO NEON MILE',
          done: [{ do: 'alight', tag: 'lionel' }],
        },
      ],
    },
    {
      id: 's4-problems',
      title: 'NINETY-NINE PROBLEMS',
      arc: 'main',
      phone: 'phone-arts',
      reward: 2000,
      // The Night Shift's one cameo: Lull has hired Vex's crew to tow the traders' vans.
      intro: [
        { who: DOREEN, text: "They're towing my van. Council contract. Some night crew in blue." },
        { who: VEX, text: 'Nothing personal. Council pays by the van. You pay in compliments.' },
        { who: DOREEN, text: "It's on their hook on Neon Mile. Box them in at a light. Not one scratch, mind. She's vintage." },
      ],
      outro: [
        { who: DOREEN, text: "Not a scratch. Thirty years she's played Greensleeves. She's earned a lie-down." },
        { who: VEX, text: "Council's docking my pay for that. Worth it. You drive like somebody's nan." },
        { who: DOREEN, text: 'Free cones for life. Small ones. Lovely.' },
      ],
      steps: [
        {
          kind: 'enter',
          tag: 'doreenvan',
          text: "TAKE THE VAN BACK · DON'T SCRATCH IT",
          // The truck pulls away as you come; caught standing (a light, boxed in), carjacked or stopped, the crew lets the van go.
          start: [
            { do: 'spawnCar', tag: 'shifttow', archetype: 'tow_truck', paint: SHIFT_BLUE, ...shiftTow, drive: true, wait: 35, cruise: 10 },
            { do: 'spawnCar', tag: 'doreenvan', archetype: 'ice_cream_van', paint: DOREEN_MINT, ...hookedVan },
            { do: 'tow', tag: 'doreenvan', truck: 'shifttow' },
          ],
          fail: vanFails,
        },
        {
          kind: 'deliver',
          tag: 'doreenvan',
          x: pitch.x,
          z: pitch.z,
          r: 9,
          text: 'BRING IT TO DOREEN IN COBBLE ROW',
          start: [{ do: 'spawnPed', tag: 'doreen', ...doreen, shirt: DOREEN_MINT, body: 'player_f' }],
          fail: [...vanFails, { lost: 'doreenvan', reason: "YOU LEFT DOREEN'S VAN BEHIND" }],
        },
      ],
    },
    {
      id: 's5-ribbon',
      title: 'RIBBON CUTTING',
      arc: 'main',
      phone: 'phone-oldtown',
      reward: 2500,
      intro: [
        { who: LULL, text: "Mayor Lull. Today I open our first Silent Zone, in Glass Heights. Please don't clap." },
        { who: DOREEN, text: "She cuts her ribbon, then she's off in that limo. I want it in bits." },
        { who: LIONEL, text: 'Take these. Fireworks. The sticky ones go off when you say. The council calls them evidence.' },
      ],
      outro: [
        { who: LULL, text: 'Mayor Lull. The Silent Zone is closed for repairs. As is my limo. Quietly.' },
        { who: LIONEL, text: "That bang! The reverb! Glass Heights hasn't had applause like it since the eighties." },
        { who: DOREEN, text: "She'll be cross now. Lovely." },
      ],
      steps: [
        {
          kind: 'destroy',
          tags: ['lulllimo'],
          text: "WRECK THE MAYOR'S LIMO",
          // Parked at the ribbon until you're close (or it's hit), then off into traffic.
          start: [
            { do: 'give', weapon: 'grenade' },
            // W3-B: two sticky charges, in hand; passing puts them in the shop (modes/shop.ts CHARGE_JOB).
            { do: 'give', weapon: 'charge' },
            { do: 'spawnCar', tag: 'lulllimo', archetype: 'limo', paint: LULL_LIMO_PAINT, ...ribbon, drive: true, wait: 50 },
          ],
        },
      ],
    },
    {
      id: 's6-quietest',
      title: 'QUIETEST CITY',
      arc: 'main',
      phone: 'phone-suburbs',
      reward: 5000,
      // The coach leaves at nine.
      hour: 21,
      intro: [
        { who: LULL, text: "Mayor Lull. The award judges tour our streets tonight. They will see nothing. That's the point." },
        { who: DOREEN, text: 'Coach leaves Glass Heights at nine. Make sure they see everything.' },
        { who: LIONEL, text: "I've done a running order. A race, a fire, a punch-up. Then me, obviously." },
      ],
      outro: [
        { who: LULL, text: 'Quietest City has gone to a village with one goat. The goat was louder than you lot, apparently.' },
        { who: LIONEL, text: 'A judge asked for my autograph. Well. He asked where the toilets were. Same thing.' },
        { who: DOREEN, text: "'Curbside nuisances', she wrote. Can't even spell kerb. We're the Curbside, then. Lovely." },
      ],
      steps: [
        {
          kind: 'mayhem',
          points: 5000,
          // Counted round the coach wherever it's got to (its radius: in sight of its windows, more or less).
          near: { x: coach.x, z: coach.z, r: 100, tag: 'coach' },
          text: 'GIVE THE JUDGES A SHOW',
          start: [
            // It waits at its kerb until you turn up, then tours at a sightseer's pace.
            { do: 'spawnCar', tag: 'coach', archetype: 'bus', paint: '#24305e', ...coach, drive: true, wait: 60, cruise: 8, route: tour },
            // Each once you're within 140 m of its crossing: you're with the coach, a little behind or ahead of it.
            { do: 'scene', scene: 'race', ...node(1), r: 140 },
            { do: 'scene', scene: 'fire', ...node(3), r: 140 },
            { do: 'scene', scene: 'turf', ...node(4), r: 140 },
          ],
        },
      ],
    },
    // ── KEEP IT LOUD, chapter 2: the Kerb Removal Order ──
    {
      id: 's8-doner',
      title: 'DONER',
      arc: 'main',
      chapter: 2,
      phone: 'phone-arts',
      reward: 3000,
      // Manny joins the traders. The impound is Vex's now (NO PARKING), on a council contract as in NINETY-NINE PROBLEMS.
      intro: [
        { who: DOREEN, text: "Lull's had Manny's kebab spit impounded. Twenty-two years it's turned. Never once stopped." },
        { who: MANNY, text: 'It is still turning. In the impound. I can feel it. Bring it home before it goes cold.' },
        { who: VEX, text: "Impound's mine now. Council contract. Can't hand it over. I can go for a very long tea, mind." },
      ],
      outro: [
        { who: MANNY, text: 'Still turning. Twenty-two years. Tonight everybody eats free. Not you. You, half price.' },
        { who: VEX, text: "Council asked where the spit went. I said thataway. Every way's thataway if you point enough." },
        { who: DOREEN, text: "That's the three of us, then. The chimes, the hat and the kebab shop. Lovely." },
      ],
      steps: [
        {
          kind: 'enter',
          tag: 'spitvan',
          text: 'TAKE THE SPIT VAN',
          start: [{ do: 'spawnCar', tag: 'spitvan', archetype: 'van', paint: COUNCIL_WHITE, ...spitVan }],
          fail: [{ wrecked: 'spitvan', reason: 'THE SPIT VAN IS WRECKED' }],
        },
        {
          kind: 'deliver',
          tag: 'spitvan',
          x: mannyShop.x,
          z: mannyShop.z,
          r: 9,
          text: "GET IT TO MANNY'S BEFORE IT COOLS",
          // The clock starts once you're in: the spit's lit, and it won't stay warm.
          timer: 90,
          timeout: 'THE SPIT WENT COLD',
          // A white apron.
          start: [{ do: 'spawnPed', tag: 'manny', ...manny, shirt: '#f2efe6', body: 'ped_stocky' }],
          fail: [
            { wrecked: 'spitvan', reason: 'THE SPIT VAN IS WRECKED' },
            { lost: 'spitvan', reason: 'YOU LEFT THE SPIT BEHIND' },
          ],
        },
      ],
    },
    {
      id: 's11-alarmcall',
      title: 'ALARM CALL',
      arc: 'main',
      chapter: 2,
      phone: 'phone-oldtown',
      reward: 4000,
      // She's in bed at ten.
      hour: 22,
      // Pike's one main-story cameo: he introduces himself for players who never did the Night Shift.
      intro: [
        { who: PIKE, text: "Deacon Pike. You don't know me. I found the Mayor's diary in a bin. I live by the bin." },
        { who: PIKE, text: "Tonight says: 'Bed at ten. Earplugs out. Sleep like a baby.' The page is twenty quid." },
        { who: DOREEN, text: 'Paid him in cones. Five cars on her street, five of your alarms. Then wake her up.' },
      ],
      outro: [
        { who: LULL, text: 'Mayor Lull. There are five car alarms outside my house. I have counted them. Many times.' },
        { who: PIKE, text: "I've never been on this side of a good deed. It's itchy. Twenty quid, though." },
        { who: DOREEN, text: 'Hear that? Every one of them yours. Twenty years of work in one street. Lovely.' },
      ],
      steps: [
        {
          kind: 'collect',
          points: lullStreet.map((along) => pt(kerbside(2, 1, 2, along))),
          text: "FIT 5 ALARMS ON THE MAYOR'S STREET",
          // Posh cars, parked like the city's own: hit one and its alarm goes off.
          start: lullStreet.map((along, i) => ({
            do: 'spawnCar' as const,
            tag: `alarm${i + 1}`,
            archetype: (['sedan', 'sports', 'compact', 'sedan', 'sports'] as const)[i],
            paint: ['#1f2a44', '#d9d4c7', '#6b1f2a', '#2f3a33', '#e8e2d0'][i],
            ...kerb(2, 1, 2, along),
            parked: true,
          })),
        },
        {
          kind: 'mayhem',
          points: 2000,
          near: { ...lullHouse, r: 60 },
          text: 'WAKE THE MAYOR',
        },
      ],
    },
    {
      id: 's12-loudest',
      title: 'LOUDEST CITY',
      arc: 'main',
      chapter: 2,
      phone: 'phone-suburbs',
      reward: 7500,
      // She leaves at dusk.
      hour: 19,
      intro: [
        { who: LULL, text: 'Mayor Lull. Today I leave to present the award to its village. Please line the streets. Silently.' },
        { who: DOREEN, text: "Limo, two warden vans, out by the ring road. Give her the send-off she's earned." },
        { who: LIONEL, text: "Every busker in town's out. Every chime, every alarm. She'll hear us from the goat." },
      ],
      outro: [
        { who: LULL, text: 'Mayor Lull. I have taken a post in the village. The goat is very quiet. We understand each other.' },
        { who: LIONEL, text: "The council's new motto: 'Loud and proud.' Well. I'm shouting it from the Town Hall steps." },
        { who: DOREEN, text: 'Kerbs back, chimes back, alarms back. Cones for life, Alarms. Medium ones. Lovely.' },
      ],
      steps: [
        {
          kind: 'mayhem',
          points: 6000,
          near: { x: convoy[0].x, z: convoy[0].z, r: 100, tag: 'lulllimo' },
          text: 'GIVE LULL A SEND-OFF',
          start: [
            // The limo pulls out first (it wakes from further off), its vans behind it on the same route.
            { do: 'spawnCar', tag: 'lulllimo', archetype: 'limo', paint: LULL_LIMO_PAINT, ...convoy[0], drive: true, wait: 80, cruise: 9, route: sendOff },
            { do: 'spawnCar', tag: 'convoyvan1', archetype: 'van', paint: HI_VIS, ...convoy[1], drive: true, wait: 60, cruise: 9, route: sendOff },
            { do: 'spawnCar', tag: 'convoyvan2', archetype: 'van', paint: HI_VIS, ...convoy[2], drive: true, wait: 60, cruise: 9, route: sendOff },
            // Along the route, in its order: an alarm in Glass Heights, a race in Cobble Row, a fire on the ring road, a turf flare-up on the Mile.
            { do: 'scene', scene: 'alarm', ...via(0), r: 140 },
            { do: 'scene', scene: 'race', ...via(1), r: 140 },
            { do: 'scene', scene: 'fire', ...via(3), r: 140 },
            { do: 'scene', scene: 'turf', ...via(4), r: 140 },
          ],
        },
        {
          kind: 'destroy',
          tags: ['lulllimo'],
          text: "WRECK THE MAYOR'S LIMO",
          // Seen off: the convoy puts its foot down.
          start: [
            { do: 'drive', tag: 'lulllimo', cruise: 14 },
            { do: 'drive', tag: 'convoyvan1', cruise: 14 },
            { do: 'drive', tag: 'convoyvan2', cruise: 14 },
          ],
        },
      ],
    },
    // ── NIGHT SHIFT, chapter 1: the Chrome Saints ──
    {
      id: 'm1-audition',
      title: 'WRONG NUMBER',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 500,
      intro: [
        { who: VEX, text: "Heard you've a day job now. Cute. The night's still mine, and wrecks need hooking." },
        { who: VEX, text: "Name's Vex. I run the Graveyard Shift. Towing, mostly. The 'mostly' pays better." },
        { who: VEX, text: "Audition's simple: bring me a sedan, any sedan, to the docks yard. Don't scratch it. I'm sentimental." },
      ],
      outro: [{ who: VEX, text: 'Huh. All four wheels. Most auditions bring me three.' }],
      steps: [
        { kind: 'enter', archetype: 'sedan', text: 'STEAL A SEDAN' },
        {
          kind: 'deliver',
          archetype: 'sedan',
          x: docks.x,
          z: docks.z,
          r: 7,
          minHealth: 0.5,
          text: 'DELIVER IT TO THE DOCKS YARD',
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
        },
      ],
    },
    {
      id: 'm2-tuna',
      title: 'TUNA RUN',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 700,
      intro: [
        { who: VEX, text: 'My mechanic, Lil\' Tuna, is stranded in Neon Mile. Again.' },
        { who: TUNA, text: "It's not my fault the bus driver hates me! I only fixed his horn a LITTLE." },
        { who: VEX, text: 'Pick him up and bring him to the safehouse. Quickly. He talks when he gets bored.' },
      ],
      outro: [{ who: TUNA, text: 'You drive like my nan. That is a compliment. My nan did the Monte Carlo rally. In a stolen hearse.' }],
      steps: [
        { kind: 'enter', text: 'GET A CAR' },
        {
          kind: 'pickup',
          tag: 'tuna',
          text: "PICK UP LIL' TUNA",
          timer: 100,
          start: [{ do: 'spawnPed', tag: 'tuna', ...tuna, body: 'tuna' }],
          done: [{ do: 'board', tag: 'tuna' }],
        },
        {
          kind: 'deliver',
          x: safehouse.x,
          z: safehouse.z,
          r: 9,
          text: 'DROP TUNA AT THE SAFEHOUSE',
          timer: 90,
          done: [{ do: 'alight', tag: 'tuna' }],
        },
      ],
    },
    {
      id: 'm3-saints',
      title: "SAINTS' PAINT",
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 1200,
      intro: [
        { who: VEX, text: 'The Chrome Saints parked their pride and joy on my turf. Purple sports car. Ugly as sin.' },
        { who: VEX, text: "Steal it, lose whatever heat it brings, and get it to the docks. Pike's going to cry chrome tears." },
      ],
      outro: [{ who: VEX, text: "Smells like cheap cologne and victory. Tuna's already pulling the stereo." }],
      steps: [
        {
          kind: 'enter',
          tag: 'saintcar',
          text: "STEAL THE SAINTS' PURPLE SPORTS CAR",
          start: [{ do: 'spawnCar', tag: 'saintcar', archetype: 'sports', paint: '#7a2f5a', ...saintCar }],
          fail: [{ wrecked: 'saintcar', reason: "THE SAINTS' CAR IS WRECKED" }],
        },
        {
          kind: 'loseHeat',
          text: 'THE SAINTS CALLED THE COPS: LOSE THEM',
          start: [{ do: 'wanted', stars: 2 }],
          fail: [
            { wrecked: 'saintcar', reason: "THE SAINTS' CAR IS WRECKED" },
            { lost: 'saintcar', reason: 'YOU LEFT THE CAR BEHIND' },
          ],
        },
        {
          kind: 'deliver',
          tag: 'saintcar',
          x: docks.x,
          z: docks.z,
          r: 7,
          minHealth: 0.3,
          text: 'BRING IT TO THE DOCKS YARD',
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
          fail: [
            { wrecked: 'saintcar', reason: "THE SAINTS' CAR IS WRECKED" },
            { lost: 'saintcar', reason: 'YOU LEFT THE CAR BEHIND' },
          ],
        },
      ],
    },
    {
      id: 'm4-parcels',
      title: 'SPECIAL DELIVERY',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 900,
      intro: [
        { who: TUNA, text: "Okay. Okay okay okay. So. I may have dropped three of Vex's parcels out of a moving van." },
        { who: TUNA, text: "Across town. In public. Grab them before she finds out? Please. I'm too pretty for the harbour." },
      ],
      outro: [
        { who: VEX, text: 'Tuna. Why are my parcels warm.' },
        { who: TUNA, text: '...No further questions.' },
      ],
      steps: [
        { kind: 'collect', points: parcels.map(pt), text: "FIND TUNA'S 3 LOST PARCELS", timer: 160 },
        { kind: 'goto', x: safehouse.x, z: safehouse.z, r: 9, text: 'BRING THEM TO THE SAFEHOUSE', timer: 120 },
      ],
    },
    {
      id: 'm5-vans',
      title: 'SPARE PARTS',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 1500,
      intro: [
        { who: VEX, text: 'The Saints are running stolen parts out of three vans parked in Cobble Row.' },
        { who: VEX, text: "I want those vans turned into modern art. The burning kind. Tuna 'found' you a shotgun." },
      ],
      outro: [
        { who: PIKE, text: "So you're the Graveyard Shift's new toy. Enjoy the sunshine, kid. While it lasts." },
        { who: VEX, text: "He's monologuing. That means we're winning." },
      ],
      steps: [
        {
          kind: 'destroy',
          tags: ['van1', 'van2', 'van3'],
          text: "WRECK THE SAINTS' 3 VANS",
          timer: 180,
          start: [
            { do: 'give', weapon: 'shotgun' },
            ...vans.map((p, i) => ({ do: 'spawnCar' as const, tag: `van${i + 1}`, archetype: 'van' as const, paint: '#2a2833', ...p })),
          ],
        },
        { kind: 'loseHeat', text: 'LIE LOW: LOSE THE HEAT' },
      ],
    },
    {
      id: 'm6-midnight',
      title: 'MIDNIGHT EXPRESS',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 2000,
      hour: 23.5,
      intro: [
        { who: VEX, text: "Pike's put a price on Tuna's head. He's hiding in Neon Mile." },
        { who: VEX, text: 'Get him to the docks before the Saints do. And drive like the cops are already behind you.' },
        { who: VEX, text: 'Because they will be.' },
      ],
      outro: [{ who: TUNA, text: "I've decided I live in your car now. I'll need a cup holder." }],
      steps: [
        { kind: 'enter', text: 'GET A CAR' },
        {
          kind: 'pickup',
          tag: 'tuna2',
          text: 'PICK UP TUNA BEFORE THE SAINTS DO',
          timer: 100,
          start: [{ do: 'spawnPed', tag: 'tuna2', ...tuna2, body: 'tuna' }],
          done: [{ do: 'board', tag: 'tuna2' }],
        },
        {
          kind: 'race',
          nodes: [[3, -5], [3, -3], [5, -3], [5, 0], [7, 0], [7, 3]],
          text: 'SHAKE THE SAINTS: HIT THE CHECKPOINTS',
          timer: 150,
          start: [{ do: 'wanted', stars: 3 }],
        },
        {
          kind: 'deliver',
          x: docks.x,
          z: docks.z,
          r: 8,
          text: 'GET TUNA TO THE DOCKS YARD',
          timer: 120,
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
          done: [{ do: 'alight', tag: 'tuna2' }],
        },
      ],
    },
    {
      id: 'm7-collector',
      title: 'COLLECTION DAY',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 2000,
      intro: [
        { who: VEX, text: "Pike's money man, the Collector, does his rounds in Maple Flats today." },
        { who: VEX, text: "Put him on the pavement. He's packing, so bring something louder than manners. Here's a pistol." },
      ],
      outro: [{ who: VEX, text: 'His ledger says Pike owes everyone in this city. Including us, now.' }],
      steps: [
        {
          kind: 'goto',
          x: collector.x,
          z: collector.z,
          r: 28,
          text: 'FIND THE COLLECTOR IN MAPLE FLATS',
          start: [
            { do: 'give', weapon: 'pistol' },
            // Pike's money man dresses like his boss, in white.
            { do: 'spawnPed', tag: 'collector', ...collector, shirt: '#e5e5e5', armed: true, hostile: true, body: 'pike' },
          ],
        },
        { kind: 'knockOut', tag: 'collector', text: 'TAKE DOWN THE COLLECTOR', timer: 120 },
        { kind: 'loseHeat', text: 'LOSE THE HEAT' },
      ],
    },
    {
      id: 'm8-lastcall',
      title: 'LAST CALL',
      arc: 'night',
      phone: NIGHT_PHONE,
      reward: 5000,
      intro: [
        { who: PIKE, text: "Enough. Walk away from Vex and I'll let you live. Refuse, and every cop in the city gets your plate." },
        { who: VEX, text: "Kid. He's bluffing about the living part, not the cops." },
        { who: VEX, text: "Steal his black sports car, ride out the storm he calls down, and bring it home." },
      ],
      outro: [
        { who: VEX, text: "Pike's finished. The Saints are scattering. And you, kid..." },
        { who: VEX, text: "...you're on the Graveyard Shift. Permanently." },
        { who: TUNA, text: 'Group hug? No? Okay. Cool. Cool cool cool.' },
      ],
      steps: [
        {
          kind: 'enter',
          tag: 'pikecar',
          text: "STEAL PIKE'S BLACK SPORTS CAR",
          start: [
            { do: 'spawnCar', tag: 'pikecar', archetype: 'sports', paint: '#1f2328', ...pikeCar },
            { do: 'spawnPed', tag: 'pike', ...pike, hostile: true, body: 'pike' },
          ],
          fail: [{ wrecked: 'pikecar', reason: "PIKE'S CAR IS WRECKED" }],
        },
        {
          kind: 'survive',
          seconds: 45,
          text: 'SURVIVE THE TIP-OFF',
          start: [{ do: 'wanted', stars: 4 }],
          fail: [
            { wrecked: 'pikecar', reason: "PIKE'S CAR IS WRECKED" },
            { lost: 'pikecar', reason: 'YOU LEFT THE CAR BEHIND' },
          ],
        },
        {
          kind: 'loseHeat',
          text: 'LOSE THE COPS',
          fail: [
            { wrecked: 'pikecar', reason: "PIKE'S CAR IS WRECKED" },
            { lost: 'pikecar', reason: 'YOU LEFT THE CAR BEHIND' },
          ],
        },
        {
          kind: 'deliver',
          tag: 'pikecar',
          x: docks.x,
          z: docks.z,
          r: 7,
          text: 'BRING IT HOME TO THE DOCKS',
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
          fail: [
            { wrecked: 'pikecar', reason: "PIKE'S CAR IS WRECKED" },
            { lost: 'pikecar', reason: 'YOU LEFT THE CAR BEHIND' },
          ],
        },
      ],
    },
    // ── NIGHT SHIFT, chapter 2: THE LEDGER ──
    {
      id: 'm9-fineprint',
      title: 'FINE PRINT',
      arc: 'night',
      chapter: 2,
      phone: NIGHT_PHONE,
      reward: 1500,
      intro: [
        { who: TUNA, text: "Cracked the Collector's ledger. Every month Pike paid two grand to someone called 'C'. For 'parking'." },
        { who: VEX, text: "And now someone's towed MY tow truck. From MY yard. The ticket's signed 'Commissioner Clamp'." },
        { who: VEX, text: "It's at the city impound in Glass Heights. Bring it home. Nobody tows the Graveyard Shift." },
      ],
      outro: [
        { who: VEX, text: 'My truck. They washed it. I will never forgive them.' },
        { who: VEX, text: "C for Clamp. Pike was paying off the Parking Commissioner. We've got a bigger fish to fry, kid." },
        { who: TUNA, text: "Can we not say 'fish' and 'fry' together? Around me? Thanks." },
      ],
      steps: [
        {
          kind: 'enter',
          tag: 'shifttruck',
          text: "TAKE BACK VEX'S TOW TRUCK",
          start: [{ do: 'spawnCar', tag: 'shifttruck', archetype: 'tow_truck', paint: '#3c5a8c', ...shiftTruck }],
          fail: [{ wrecked: 'shifttruck', reason: "VEX'S TRUCK IS WRECKED" }],
        },
        {
          kind: 'loseHeat',
          text: 'THE IMPOUND CALLED THE COPS: LOSE THEM',
          start: [{ do: 'wanted', stars: 2 }],
          fail: [
            { wrecked: 'shifttruck', reason: "VEX'S TRUCK IS WRECKED" },
            { lost: 'shifttruck', reason: 'YOU LEFT THE TRUCK BEHIND' },
          ],
        },
        {
          kind: 'deliver',
          tag: 'shifttruck',
          x: docks.x,
          z: docks.z,
          r: 8,
          minHealth: 0.3,
          text: 'BRING THE TRUCK HOME TO THE DOCKS',
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
          fail: [
            { wrecked: 'shifttruck', reason: "VEX'S TRUCK IS WRECKED" },
            { lost: 'shifttruck', reason: 'YOU LEFT THE TRUCK BEHIND' },
          ],
        },
      ],
    },
    {
      id: 'm10-fallen',
      title: 'FALLEN SAINT',
      arc: 'night',
      chapter: 2,
      phone: NIGHT_PHONE,
      reward: 1500,
      intro: [
        { who: PIKE, text: "Don't hang up. Please. I've never said please before. It tastes like pennies." },
        { who: PIKE, text: 'Clamp took everything. My cars, my chrome, my good collar. I live in a Maple Flats bus shelter now.' },
        { who: VEX, text: "He'll spill on Clamp for a lift. Pick him up. He rides in the back. He doesn't touch the radio." },
      ],
      outro: [
        { who: PIKE, text: 'Clamp doesn\'t steal cars. He tows them, legally. Sells them back to you. Then tows them again.' },
        { who: PIKE, text: "Every crew in town pays him or walks. I paid. You didn't. So now he wants your yard." },
        { who: VEX, text: "He does what we do, but with paperwork. That's disgusting." },
      ],
      steps: [
        { kind: 'enter', text: 'GET A CAR' },
        {
          kind: 'pickup',
          tag: 'pike',
          text: 'PICK UP PIKE IN MAPLE FLATS',
          timer: 120,
          start: [{ do: 'spawnPed', tag: 'pike', ...pikeStop, body: 'pike' }],
          done: [{ do: 'board', tag: 'pike' }],
        },
        {
          kind: 'deliver',
          x: safehouse.x,
          z: safehouse.z,
          r: 9,
          text: 'GET PIKE TO THE SAFEHOUSE',
          timer: 120,
          start: [{ do: 'wanted', stars: 2 }],
          done: [{ do: 'alight', tag: 'pike' }],
        },
      ],
    },
    {
      id: 'm11-towaway',
      title: 'TOW-AWAY ZONE',
      arc: 'night',
      chapter: 2,
      phone: NIGHT_PHONE,
      reward: 2000,
      intro: [
        { who: VEX, text: "Clamp's made all of Neon Mile a tow-away zone. His trucks are hauling off every car on the street." },
        { who: TUNA, text: "They took the ice cream van! With the man still in it! He's still serving, off the back of a truck!" },
        { who: VEX, text: 'Three of his trucks are working the Mile. Orange, flashing, smug. Here, have something that burns.' },
      ],
      outro: [
        { who: TUNA, text: "The ice cream man's free! He gave me a lolly. I think it was a bribe. I've accepted it." },
        { who: CLAMP, text: 'Commissioner Clamp. Damaging city vehicles carries a fine of... everything you own. Good evening.' },
        { who: VEX, text: 'He sounds like a voicemail.' },
      ],
      steps: [
        {
          kind: 'destroy',
          tags: ['tow1', 'tow2', 'tow3'],
          text: "WRECK CLAMP'S 3 TOW TRUCKS",
          timer: 210,
          start: [
            { do: 'give', weapon: 'molotov' },
            ...tows.map((p, i) => ({ do: 'spawnCar' as const, tag: `tow${i + 1}`, archetype: 'tow_truck' as const, paint: CLAMP_ORANGE, drive: true, ...p })),
          ],
        },
        { kind: 'loseHeat', text: 'LIE LOW: LOSE THE HEAT' },
      ],
    },
    {
      id: 'm12-papertrail',
      title: 'PAPER TRAIL',
      arc: 'night',
      chapter: 2,
      phone: NIGHT_PHONE,
      reward: 2500,
      hour: 22,
      intro: [
        { who: PIKE, text: 'Clamp keeps everything on paper. Every bribe, every tow. Alphabetised. Colour-coded. A monster.' },
        { who: PIKE, text: 'Tonight four clerks drive his files to the shredder. And every one of them stops for a kebab.' },
        { who: VEX, text: "So that's four boxes outside four kebab shops. Grab them and bring them to me at the docks." },
      ],
      outro: [
        { who: TUNA, text: "Box four is just his lunch receipts. He's had the same soup every day for eleven years." },
        { who: VEX, text: "Box one's the good one. Clamp's been towing the Mayor's cars too. And selling them back to her." },
        { who: PIKE, text: 'He towed the Mayor? ...I\'m almost proud of him.' },
      ],
      steps: [
        { kind: 'collect', points: files.map(pt), text: "GRAB CLAMP'S 4 BOXES OF FILES", timer: 240 },
        {
          kind: 'goto',
          x: docks.x,
          z: docks.z,
          r: 9,
          text: 'GET THE FILES TO THE DOCKS YARD',
          timer: 150,
          start: [
            { do: 'wanted', stars: 2 },
            { do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' },
          ],
        },
      ],
    },
    {
      id: 'm13-noparking',
      title: 'NO PARKING',
      arc: 'night',
      chapter: 2,
      phone: NIGHT_PHONE,
      reward: 5000,
      hour: 23.75,
      intro: [
        { who: CLAMP, text: 'Graveyard Shift. I have read your file. It is thick. From midnight, your yard is a no-parking zone.' },
        { who: VEX, text: "He's outside his office in Glass Heights, guarding his limo with two traffic wardens." },
        { who: VEX, text: "Put him down, take the limo, bring it home. Without a car he's just a man with a clipboard." },
      ],
      outro: [
        { who: VEX, text: "Clamp's limo. In my yard. After midnight. Tuna, what's the rule?" },
        { who: TUNA, text: "NO PARKING! I've had a wheel clamp ready since Tuesday. I've named it Gerald." },
        { who: VEX, text: "The Mayor got the files, Clamp's a lollipop man now, and the city needs a new tow crew. Guess who." },
      ],
      steps: [
        {
          kind: 'knockOut',
          tag: 'clamp',
          text: 'TAKE DOWN COMMISSIONER CLAMP',
          timer: 150,
          start: [
            { do: 'give', weapon: 'smg' },
            { do: 'spawnCar', tag: 'limo', archetype: 'limo', paint: '#cbb994', ...limo },
            // A grey suit and a coat; his wardens in hi-vis.
            { do: 'spawnPed', tag: 'clamp', ...clamp, shirt: '#7d838c', armed: true, hostile: true, body: 'ped_coat' },
            ...wardens.map((p, i) => ({ do: 'spawnPed' as const, tag: `warden${i + 1}`, ...p, shirt: HI_VIS, hostile: true, body: 'ped_stocky' as const })),
          ],
          fail: [{ wrecked: 'limo', reason: "CLAMP'S LIMO IS WRECKED" }],
        },
        {
          kind: 'enter',
          tag: 'limo',
          text: "TAKE CLAMP'S LIMO",
          fail: [{ wrecked: 'limo', reason: "CLAMP'S LIMO IS WRECKED" }],
        },
        {
          kind: 'race',
          nodes: [[1, 1], [3, 1], [3, 3]],
          text: 'EVERY COP IN TOWN: HIT THE CHECKPOINTS',
          timer: 120,
          start: [{ do: 'wanted', stars: 4 }],
          fail: [
            { wrecked: 'limo', reason: "CLAMP'S LIMO IS WRECKED" },
            { lost: 'limo', reason: 'YOU LEFT THE LIMO BEHIND' },
          ],
        },
        {
          kind: 'deliver',
          tag: 'limo',
          x: docks.x,
          z: docks.z,
          r: 8,
          text: 'PARK THE LIMO IN THE DOCKS YARD',
          start: [{ do: 'spawnPed', tag: 'vex', ...vex, body: 'vex' }],
          fail: [
            { wrecked: 'limo', reason: "CLAMP'S LIMO IS WRECKED" },
            { lost: 'limo', reason: 'YOU LEFT THE LIMO BEHIND' },
          ],
        },
      ],
    },
  ];
}
