/**
 * W3-D: the map editor's logic (game/mapEditorState.ts): the preview leaves
 * the game's districts alone, undo / redo, the view, hit-testing, what the
 * tools write, the overlay's routes and the problems an edit raises.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  EditHistory,
  applySpotEdits,
  baseBlocks,
  blockIndex,
  buildPreview,
  describeChange,
  editBlock,
  editorLookAt,
  fitView,
  flipRoad,
  lookParam,
  moveAddedProp,
  moveSpot,
  panBy,
  pickAt,
  picksAt,
  nextPick,
  anchorShown,
  PROPS_FROM_SCALE,
  placeProp,
  placeSpot,
  propsOnMap,
  removeProp,
  removeSpot,
  rerollBlock,
  resetSpot,
  restoreProp,
  roadState,
  routeLine,
  selectionCentre,
  setRoad,
  spotRule,
  toScreen,
  toWorld,
  turnSpot,
  zoomAt,
  type MapView,
  type PreviewInputs,
} from '../src/game/mapEditorState';
import { dependentsOf, districtBlockAt, routeNodes, type Node } from '../src/game/mapAnchors';
import { CORE_OFFSET, generateCity, BLOCKS_PER_SIDE } from '../src/world/city';
import { districtOf } from '../src/world/districts';
import { roadRules } from '../src/world/roadRules';
import { NO_EDITS, diffMapEdits, parseMapEdits, serializeMapEdits, withBlockEdit, type MapEdits } from '../src/world/mapEdits';
import { generatePickups } from '../src/world/pickups';
import { placeKickers, placeRamps } from '../src/world/ramps';
import { SHIPPED_MAP } from '../src/world/shippedMap';

afterEach(() => void generateCity(1337));

const big = placeRamps(1337);
const inputs: PreviewInputs = { pickups: generatePickups(1337), ramps: [...big, ...placeKickers(1337, big)] };
const allDistricts = () => {
  const out: string[] = [];
  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx++) for (let bz = 0; bz < BLOCKS_PER_SIDE; bz++) out.push(districtOf(bx, bz));
  return out.join();
};

describe('the preview', () => {
  const plain = buildPreview(SHIPPED_MAP, inputs, SHIPPED_MAP);
  const base = baseBlocks(1337, SHIPPED_MAP);

  it('shows the shipped city with no problems, its props and anchors', () => {
    expect(plain.problems).toEqual([]);
    expect(plain.anchors.length).toBeGreaterThan(150);
    expect(plain.props.length).toBeGreaterThan(1000);
    expect(plain.kinds.length).toBe(plain.city.blocks.length);
    expect(base.length).toBe(plain.city.blocks.length);
    expect(plain.kinds.filter((k) => k === 'carpark').length).toBeGreaterThan(0);
  });

  it("leaves the game's road rules as they were (generateCity installs them for the whole game's traffic)", () => {
    // The game was built with one road closed; the editor previews another closed and a one-way.
    const game: MapEdits = { ...NO_EDITS, roads: [{ a: [0, 0], b: [1, 0], closed: true }] };
    generateCity(1337, game);
    const local: MapEdits = { ...NO_EDITS, roads: [{ a: [3, 3], b: [3, 4], closed: true }, { a: [5, 5], b: [5, 6], oneWay: true }] };
    buildPreview(local, inputs, game);
    baseBlocks(1337, game);
    const rules = roadRules();
    expect(rules.isClosed(0, 0, 1, 0)).toBe(true);
    expect(rules.isClosed(3, 3, 3, 4)).toBe(false);
    expect(rules.allows(5, 6, 0)).toBe(true);
    generateCity(1337);
    expect(roadRules().empty).toBe(true);
  });

  it("leaves the game's districts as they were (generateCity paints them for the whole game)", () => {
    // The game was built with a repaint; the editor previews a different one.
    const game: MapEdits = { ...NO_EDITS, blocks: [{ at: [2, 2], district: 'industrial' }] };
    generateCity(1337, game);
    const before = allDistricts();
    expect(districtOf(2 + CORE_OFFSET, 2 + CORE_OFFSET)).toBe('industrial');
    const local: MapEdits = { ...NO_EDITS, blocks: [{ at: [9, 9], district: 'oldtown' }, { at: [2, 2], district: 'arts' }] };
    const p = buildPreview(local, inputs, game);
    expect(p.city.blocks[blockIndex(p.city, 9 + CORE_OFFSET, 9 + CORE_OFFSET)].district).toBe('oldtown');
    expect(allDistricts()).toBe(before);
    baseBlocks(1337, game);
    expect(allDistricts()).toBe(before);
  });

  it('turns a repaint under a job written for its district into a problem', () => {
    const job = plain.anchors.find((a) => a.district === 'oldtown')!;
    const d = districtBlockAt(job.points[0].x, job.points[0].z);
    const local = editBlock(SHIPPED_MAP, d.bx, d.bz, { district: 'arts' }, base[blockIndex(plain.city, d.bx, d.bz)]);
    const p = buildPreview(local, inputs, SHIPPED_MAP);
    expect(p.problems.some((x) => x.id === job.id && x.problem.includes('written for oldtown'))).toBe(true);
    expect(p.problems.find((x) => x.id === job.id)!.points.length).toBeGreaterThan(0);
    // ...and the overlay of that block lists the job.
    expect(dependentsOf(p.anchors, { kind: 'block', bx: d.bx, bz: d.bz }).some((a) => a.id === job.id)).toBe(true);
  });

  it('flags a race over a road the edits closed, and one run the wrong way up a one-way street', () => {
    const race = plain.anchors.find((a) => a.group === 'race')!;
    const nodes = routeNodes(race.route!)!;
    const [a, b] = [nodes[1], nodes[2]];
    const closed = buildPreview(setRoad(SHIPPED_MAP, a, b, 'closed'), inputs, SHIPPED_MAP);
    const shut = closed.problems.find((x) => x.id === race.id)!;
    expect(shut.problem).toContain('closed road');
    expect(shut.segments).toEqual([[a, b]]);
    const wrong = buildPreview(setRoad(SHIPPED_MAP, a, b, 'oneWayBack'), inputs, SHIPPED_MAP);
    expect(wrong.problems.some((x) => x.id === race.id && x.problem.includes('wrong way'))).toBe(true);
    const right = buildPreview(setRoad(SHIPPED_MAP, a, b, 'oneWay'), inputs, SHIPPED_MAP);
    expect(right.problems.some((x) => x.id === race.id)).toBe(false);
  });

  it('moves and removes spots, and flags a removal the game needs', () => {
    const moved = moveSpot(SHIPPED_MAP, 'fz-drift', 100.04, 50, { x: 0, z: 0 });
    const { anchors, moved: m } = applySpotEdits(plain.anchors, moved);
    const token = plain.anchors.find((a) => a.id === 'fz-drift');
    if (token) {
      expect(anchors.find((a) => a.id === 'fz-drift')!.points[0]).toEqual({ x: 100, z: 50 });
      expect(m.get('fz-drift')!.from).toEqual(token.points[0]);
    }
    const gone = applySpotEdits(plain.anchors, removeSpot(SHIPPED_MAP, plain.anchors.find((a) => a.group === 'ramp')!.id));
    expect(gone.removed.length).toBe(1);
    expect(gone.anchors.length).toBe(plain.anchors.length - 1);
    // The safehouse can't go: the tool refuses, and a file that does it is flagged.
    expect(removeSpot(SHIPPED_MAP, 'safehouse')).toBe(SHIPPED_MAP);
    const forced: MapEdits = { ...SHIPPED_MAP, spots: [{ id: 'safehouse', removed: true }] };
    const p = buildPreview(forced, inputs, SHIPPED_MAP);
    expect(p.problems.some((x) => x.id === 'safehouse' && x.problem.includes("can't be removed"))).toBe(true);
    // Frenzy tokens stay too (each one counts toward 100%).
    expect(removeSpot(SHIPPED_MAP, 'fz-drift')).toBe(SHIPPED_MAP);
  });
});

describe('spot rules (the engine table, mapAnchors spotRules)', () => {
  it('keeps the safehouse, payphones and frenzy tokens, lets hangouts and ramps go, turns ramps, and nothing else moves', () => {
    const fixed = { movable: true, removable: false, turnable: false };
    expect(spotRule('safehouse')).toEqual(fixed);
    expect(spotRule('phone-docks')).toEqual(fixed);
    expect(spotRule('fz-drift')).toEqual(fixed);
    expect(spotRule('vipers-0')).toEqual({ movable: true, removable: true, turnable: false });
    expect(spotRule('ramp-3')).toEqual({ movable: true, removable: true, turnable: true });
    const none = { movable: false, removable: false, turnable: false };
    expect(spotRule('station')).toEqual(none);
    expect(spotRule('story:s1/steps.0')).toEqual(none);
  });
});

describe('undo history', () => {
  it('undoes and redoes snapshots, ignores no-ops, and a new edit drops the redo', () => {
    const h = new EditHistory(NO_EDITS);
    const a = withBlockEdit(NO_EDITS, [1, 1], { kind: 'park' });
    const b = withBlockEdit(a, [2, 2], { kind: 'plaza' });
    expect(h.apply(a)).toBe(true);
    expect(h.apply(withBlockEdit(NO_EDITS, [1, 1], { kind: 'park' }))).toBe(false);
    h.apply(b);
    expect(h.undo()).toBe(true);
    expect(h.current).toBe(a);
    expect(h.undo()).toBe(true);
    expect(h.current).toBe(NO_EDITS);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(h.current).toBe(a);
    h.apply(withRoadOnly());
    expect(h.canRedo).toBe(false);
  });
});

const withRoadOnly = () => setRoad(NO_EDITS, [0, 0], [1, 0], 'closed');

describe('the view', () => {
  it('maps world to screen and back, zooms about the cursor and pans', () => {
    const v: MapView = { cx: 0, cz: 0, scale: 1, width: 800, height: 600 };
    fitView(v, 600);
    expect(v.scale).toBe(0.5);
    const s = toScreen(v, 100, -40);
    expect(toWorld(v, s.sx, s.sy)).toEqual({ x: 100, z: -40 });
    const under = toWorld(v, 650, 120);
    zoomAt(v, 650, 120, 3);
    const after = toWorld(v, 650, 120);
    expect(after.x).toBeCloseTo(under.x);
    expect(after.z).toBeCloseTo(under.z);
    const cx = v.cx;
    panBy(v, 30, 0, 1000);
    expect(v.cx).toBeCloseTo(cx - 30 / v.scale);
    zoomAt(v, 0, 0, 1e6);
    expect(v.scale).toBe(12);
  });
});

describe('detail anchors', () => {
  it('draws hydrants and carts only zoomed in, unless they are a dependent, a problem or the selection', () => {
    const p = buildPreview(SHIPPED_MAP, inputs, SHIPPED_MAP);
    const hydrant = p.anchors.find((a) => a.group === 'hydrant')!;
    const cart = p.anchors.find((a) => a.group === 'vendor')!;
    const phone = p.anchors.find((a) => a.group === 'payphone')!;
    expect(anchorShown(hydrant, 1)).toBe(false);
    expect(anchorShown(cart, 1)).toBe(false);
    expect(anchorShown(phone, 1)).toBe(true);
    expect(anchorShown(hydrant, PROPS_FROM_SCALE)).toBe(true);
    expect(anchorShown(hydrant, 1, new Set([hydrant.id]))).toBe(true);
    // Zoomed out, the map shows the hand-placed things, not hundreds of hydrants and carts.
    const detail = p.anchors.filter((a) => a.group === 'hydrant' || a.group === 'vendor').length;
    expect(detail).toBeGreaterThan(100);
    expect(p.anchors.filter((a) => anchorShown(a, 1)).length).toBe(p.anchors.length - detail);
  });
});

describe('picking', () => {
  const p = buildPreview(SHIPPED_MAP, inputs, SHIPPED_MAP);
  it('hits an anchor first, then (zoomed in) a prop, then the road, then the block', () => {
    const safe = p.anchors.find((a) => a.id === 'safehouse')!.points[0];
    expect(pickAt(safe, p.anchors, p.props, 2)).toEqual({ kind: 'anchor', id: 'safehouse' });
    expect(pickAt({ x: safe.x + 1, z: safe.z }, p.anchors, p.props, 2)).toEqual({ kind: 'anchor', id: 'safehouse' });
    // (Hydrants are anchors now, for the burst-hydrant scene: a bench is just a prop.)
    const prop = p.props.find((q) => q.kind === 'bench' && !p.anchors.some((a) => a.points.some((pt) => Math.hypot(pt.x - q.x, pt.z - q.z) < 10)))!;
    expect(pickAt({ x: prop.x + 0.2, z: prop.z }, p.anchors, p.props, 4)).toMatchObject({ kind: 'prop', prop: { kind: 'bench' } });
    // Zoomed out, props aren't drawn, so not picked.
    expect(pickAt({ x: prop.x + 0.2, z: prop.z }, p.anchors, p.props, 0.5)?.kind).not.toBe('prop');
    expect(pickAt({ x: 128, z: 128 }, [], [], 1)).toEqual({ kind: 'junction', ix: 2, iz: 2 });
    expect(pickAt({ x: 128, z: 160 }, [], [], 1)).toEqual({ kind: 'segment', a: [2, 2], b: [2, 3] });
    const blk = pickAt({ x: 160, z: 160 }, [], [], 1);
    expect(blk?.kind).toBe('block');
    expect(selectionCentre(blk!, [])).toEqual({ x: 160, z: 160 });
  });
  it('clicking again steps through what is stacked at a point, round to the top', () => {
    // The safehouse's door has a story job's spot on it, and both stand on a block.
    const safe = p.anchors.find((a) => a.id === 'safehouse')!.points[0];
    const stack = picksAt(safe, p.anchors, p.props, 2);
    expect(stack[0]).toEqual({ kind: 'anchor', id: 'safehouse' });
    expect(stack.length).toBeGreaterThan(2);
    expect(stack.at(-1)?.kind).toBe('block');
    expect(nextPick(stack, null)).toEqual(stack[0]);
    expect(nextPick(stack, stack[0])).toEqual(stack[1]);
    expect(nextPick(stack, stack.at(-1)!)).toEqual(stack[0]);
    // Something not in the stack: the top.
    expect(nextPick(stack, { kind: 'junction', ix: 9, iz: 9 })).toEqual(stack[0]);
    expect(nextPick([], stack[0])).toBeNull();
  });
});

describe('tools', () => {
  const base = { kind: 'buildings' as const, district: 'downtown' as const };
  it('edits a block, and setting it back to generated is no edit at all', () => {
    let e = editBlock(NO_EDITS, 3 + CORE_OFFSET, 4 + CORE_OFFSET, { kind: 'park' }, base);
    expect(e.blocks).toEqual([{ at: [3, 4], kind: 'park' }]);
    e = editBlock(e, 3 + CORE_OFFSET, 4 + CORE_OFFSET, { height: 1.234 }, base);
    expect(e.blocks[0].height).toBe(1.23);
    e = rerollBlock(e, 3 + CORE_OFFSET, 4 + CORE_OFFSET, base);
    e = rerollBlock(e, 3 + CORE_OFFSET, 4 + CORE_OFFSET, base);
    expect(e.blocks[0].variant).toBe(2);
    e = editBlock(e, 3 + CORE_OFFSET, 4 + CORE_OFFSET, { kind: 'buildings', height: 1, variant: undefined }, base);
    expect(e.blocks).toEqual([]);
    expect(editBlock(NO_EDITS, 0, 0, { height: 9 }, base).blocks[0].height).toBe(1.6);
  });

  it('opens, closes and flips roads', () => {
    const a: Node = [1, 2];
    const b: Node = [2, 2];
    let e = setRoad(NO_EDITS, a, b, 'oneWay');
    expect(roadState(e, b, a)).toEqual({ mode: 'oneWay', from: a, to: b });
    e = flipRoad(e, a, b);
    expect(roadState(e, a, b)).toEqual({ mode: 'oneWay', from: b, to: a });
    e = setRoad(e, a, b, 'closed');
    expect(roadState(e, a, b).mode).toBe('closed');
    expect(setRoad(e, b, a, 'open').roads).toEqual([]);
  });

  it('moves and turns spots (back home clears the move), and resets them', () => {
    let e = moveSpot(NO_EDITS, 'ramp-0', 10, 20, { x: 0, z: 0 });
    e = turnSpot(e, 'ramp-0', Math.PI / 2, 0);
    expect(e.spots).toEqual([{ id: 'ramp-0', x: 10, z: 20, heading: 1.57 }]);
    e = moveSpot(e, 'ramp-0', 0.02, 0, { x: 0, z: 0 });
    expect(e.spots).toEqual([{ id: 'ramp-0', heading: 1.57 }]);
    expect(resetSpot(e, 'ramp-0').spots).toEqual([]);
  });

  it('adds new spots with new ids, and moves, turns and removes them', () => {
    let { edits: e, id } = placeSpot(NO_EDITS, 'kicker', 100.04, 64);
    expect(id).toBe('ramp-18');
    expect(e.spots).toEqual([{ id: 'ramp-18', add: 'kicker', x: 100, z: 64 }]);
    const second = placeSpot(e, 'package', 10, 10);
    expect(second.id).toBe('pkg-40');
    e = moveSpot(second.edits, id, 120, 64, { x: 0, z: 0 });
    expect(e.spots.find((s) => s.id === id)).toEqual({ id, add: 'kicker', x: 120, z: 64 });
    e = turnSpot(e, id, Math.PI / 2, 0);
    expect(e.spots.find((s) => s.id === id)).toMatchObject({ add: 'kicker', heading: 1.57 });
    // AS GENERATED has nothing to go back to; REMOVE drops the entry.
    expect(resetSpot(e, id)).toBe(e);
    e = removeSpot(e, id);
    expect(e.spots.map((s) => s.id)).toEqual(['pkg-40']);
    expect(describeChange({ section: 'spots', key: 'pkg-40', after: e.spots[0] })).toBe('Spot pkg-40: package added at 10, 10');
    expect(describeChange({ section: 'spots', key: 'pkg-40', before: e.spots[0] })).toBe('Spot pkg-40: no longer added');
    // The preview draws it, and it can be picked.
    const p = buildPreview(e, inputs, SHIPPED_MAP);
    expect(p.anchors.find((a) => a.id === 'pkg-40')).toMatchObject({ group: 'package', added: true });
    expect(p.problems.filter((x) => x.id === 'packages')).toEqual([expect.objectContaining({ problem: expect.stringMatching(/^41 on the map/) })]);
  });

  it('places, moves, removes and restores props', () => {
    let e = placeProp(NO_EDITS, 'bench', 10.04, 5);
    expect(e.props).toEqual([{ kind: 'bench', x: 10, z: 5 }]);
    const shown = propsOnMap({ street: { props: [] } } as never, e);
    expect(shown).toEqual([{ kind: 'bench', x: 10, z: 5, heading: 0, origin: 'added' }]);
    e = moveAddedProp(e, shown[0], 12, 6, Math.PI);
    expect(e.props).toEqual([{ kind: 'bench', x: 12, z: 6, heading: 3.14 }]);
    expect(removeProp(e, { ...shown[0], x: 12, z: 6 }).props).toEqual([]);
    const gen = { kind: 'hydrant', x: 3, z: 4, heading: 0, origin: 'generated' as const };
    const r = removeProp(NO_EDITS, gen);
    expect(r.props).toEqual([{ kind: 'hydrant', x: 3, z: 4, removed: true }]);
    const ghost = propsOnMap({ street: { props: [{ kind: 'hydrant', x: 3.2, z: 4, heading: 0 }] } } as never, r);
    expect(ghost[0].origin).toBe('removed');
    expect(restoreProp(r, ghost[0]).props).toEqual([]);
  });

  it('describes each change for the CHANGES list', () => {
    let e = withBlockEdit(NO_EDITS, [5, 6], { kind: 'carpark', district: 'oldtown' });
    e = setRoad(e, [0, 0], [1, 0], 'oneWay');
    e = removeSpot(e, 'ramp-3');
    e = placeProp(e, 'trash_bin', 1, 2);
    const lines = diffMapEdits(NO_EDITS, e).map(describeChange);
    expect(lines).toEqual([
      'Block 5,6: car park, district oldtown',
      'Road 0,0→1,0: one-way east',
      'Spot ramp-3: removed',
      'Prop trash bin at 1, 2: added',
    ]);
    // The exported text is the canonical file.
    expect(parseMapEdits(JSON.parse(serializeMapEdits(e))).problems).toEqual([]);
  });

  it('draws a course through every crossing and a drive route as a loop', () => {
    const line = routeLine({ id: 'r', group: 'race', label: '', points: [], route: [[0, 0], [2, 0], [2, 1]] });
    expect(line).toEqual({ points: [{ x: 0, z: 0 }, { x: 64, z: 0 }, { x: 128, z: 0 }, { x: 128, z: 64 }], fixed: true });
    const via = routeLine({ id: 'v', group: 'story', label: '', points: [], via: [[0, 0], [1, 1]] });
    expect(via?.fixed).toBe(false);
    expect(via?.points.length).toBe(3);
  });
});

describe('VIEW IN 3D', () => {
  it('round-trips the look parameter, only with ?map=local', () => {
    expect(editorLookAt(`?map=local&look=${lookParam({ x: 120.4, z: -33.6 })}`)).toEqual({ x: 120, z: -34 });
    expect(editorLookAt('?look=1,2')).toBeNull();
    expect(editorLookAt('?map=local&look=nope')).toBeNull();
  });
});
