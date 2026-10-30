/**
 * The story: eight payphone jobs for the Graveyard Shift, a night-time tow
 * crew that tows rather more than it should, run by VEX, with her mechanic
 * LIL' TUNA, against DEACON PIKE and his Chrome Saints. Each job pays and
 * unlocks the next; the phones ring when a job is waiting. Positions come
 * from the road grid (kerbs) and the pavement paths, so everything spawns
 * clear of buildings; the docks and the safehouse are passed in.
 */
import { pavement } from '../game/modes/places';
import { BLOCK_SIZE, ROAD_WIDTH, SIDEWALK } from '../world/city';
import { DIR_VEC, dirHeading, type Dir } from '../world/roads';
import type { MissionDef } from './missions';

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

export function buildMissions(docks: Point & { heading?: number; halfWidth?: number; halfLength?: number }, safehouse: Point): MissionDef[] {
  const saintCar = kerb(-4, 4, 1, 26);
  const vans = [kerb(-3, -3, 1, 18), kerb(-3, -3, 1, 23.5), kerb(-3, -3, 1, 29)];
  const pikeCar = kerb(5, 6, 0, 30);
  // Deacon Pike himself, guarding his car from the pavement beside it.
  const pike = kerbside(5, 6, 0, 30);
  // Vex waits at the docks yard for whatever you bring her.
  const vex = besideBay(docks);
  const tuna = pavement(9, 3, 2, 0.5);
  const tuna2 = pavement(11, 2, 3, 0.5);
  const collector = pavement(3, 12, 0, 0.5);
  const parcels = [pavement(10, 9, 0, 0.5), pavement(12, 6, 3, 0.4), pavement(9, 12, 1, 0.6)];

  return [
    {
      id: 'm1-audition',
      title: 'WRONG NUMBER',
      phone: 'phone-oldtown',
      reward: 500,
      intro: [
        { who: VEX, text: "You the one who keeps setting my street on fire? Don't answer. I like a confident driver." },
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
      phone: 'phone-arts',
      reward: 700,
      intro: [
        { who: VEX, text: 'My mechanic, Lil\' Tuna, is stranded in the arts quarter. Again.' },
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
      phone: 'phone-suburbs',
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
      phone: 'phone-docks',
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
      phone: 'phone-oldtown',
      reward: 1500,
      intro: [
        { who: VEX, text: 'The Saints are running stolen parts out of three vans parked in the old town.' },
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
      phone: 'phone-arts',
      reward: 2000,
      hour: 23.5,
      intro: [
        { who: VEX, text: "Pike's put a price on Tuna's head. He's hiding in the arts quarter." },
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
      phone: 'phone-suburbs',
      reward: 2000,
      intro: [
        { who: VEX, text: "Pike's money man, the Collector, does his rounds in the suburbs today." },
        { who: VEX, text: "Put him on the pavement. He's packing, so bring something louder than manners. Here's a pistol." },
      ],
      outro: [{ who: VEX, text: 'His ledger says Pike owes everyone in this city. Including us, now.' }],
      steps: [
        {
          kind: 'goto',
          x: collector.x,
          z: collector.z,
          r: 28,
          text: 'FIND THE COLLECTOR IN THE SUBURBS',
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
      phone: 'phone-docks',
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
  ];
}
