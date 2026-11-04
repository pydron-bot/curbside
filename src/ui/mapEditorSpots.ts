/**
 * The map editor's round 3 panels (W3-D): what the side panel adds for a
 * payphone (the jobs it rings for, MOVE A JOB HERE), a story spot (RINGS
 * FROM, how its crossings drag), a frenzy token (an added one's goal,
 * target, time and gift), a pickup (an added one's kind), a landmark (it
 * snaps to a block of its shape) and a block or road's "can host" list.
 * HTML strings for ui/mapEditor.ts, which wires their data-act buttons and
 * data-input fields.
 */
import type { Anchor } from '../game/mapAnchors';
import type { PhoneJob } from '../game/mapSpots';
import type { SceneHost } from '../game/sceneHosts';
import { ACTIVE_FRENZIES, FRENZIES, customFrenzy } from '../game/modes/frenzies';
import { FRENZY_GIFTS, FRENZY_GOALS, FRENZY_LIMITS, NEEDS_CAR_GOALS, SECONDS_STEP } from '../game/modes/frenzyLimits';
import { PICKUP_ITEMS, type MapEdits, type SpotEdit } from '../world/mapEdits';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const opt = (value: string, label: string, on: boolean) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
const arcName = (j: PhoneJob) => (j.arc === 'night' ? 'NIGHT SHIFT' : 'MAIN STORY');

/** The job a story anchor belongs to (`story:<job>/<path>`). */
export function storyJob(id: string): string | null {
  return id.startsWith('story:') ? id.slice(6, id.indexOf('/')) : null;
}

export interface SpotPanelInputs {
  edits: MapEdits;
  /** Every job that rings a phone, with its phone on these edits (mapSpots phoneJobs). */
  jobs: readonly PhoneJob[];
  /** The payphones on the map. */
  phones: readonly Anchor[];
  /** The spot's edit, if any. */
  edit?: SpotEdit;
  /** The story spot's kind (mapSpots storySpotKind). */
  storyKind?: string | null;
  /** It can be turned (a story job's parked car). */
  turnable: boolean;
}

/** The panel's round 3 part for spot `a` (empty for spots it has nothing to add to). */
export function spotPanelHtml(a: Anchor, d: SpotPanelInputs): string {
  if (a.landmark) {
    const built = a.landmark === 'station' || a.landmark === 'hospital';
    const moved = d.edits.landmarks?.find((l) => l.id === a.landmark);
    return `<p class="me-note">Drag it to another ${built ? 'built-up block (it takes the pavement on the same side)' : 'open lot (its bay goes on the road edge)'}: it snaps to a block it fits, ringed green while you drag. Its props and keep-out go with it.</p>
      ${moved ? `<p class="me-note edited">Moved to block ${moved.at[0]},${moved.at[1]}</p><div class="me-row"><button type="button" class="me-btn" data-act="r3resetLandmark" data-arg="${a.landmark}">AS GENERATED</button></div>` : ''}`;
  }
  if (a.group === 'payphone') return phonePanel(a, d);
  if (a.group === 'story') return storyPanel(a, d);
  if (a.group === 'frenzy') return frenzyPanel(a, d);
  if (a.group === 'pickup') {
    if (d.edit?.add !== 'pickup') return '';
    return `<label class="me-field">KIND <select data-input="r3pickup">${PICKUP_ITEMS.map((k) => opt(k, k.toUpperCase(), d.edit?.pickup === k)).join('')}</select></label>`;
  }
  return '';
}

function phonePanel(a: Anchor, d: SpotPanelInputs): string {
  const here = d.jobs.filter((j) => j.phone === a.id);
  const others = d.jobs.filter((j) => j.phone !== a.id);
  return `<h4>RINGS FOR <b>${here.length}</b></h4>
    ${here.length ? '<p class="me-note">To remove this phone, move its jobs to another phone first.</p>' : ''}
    ${
      here.length
        ? `<ul class="me-list">${here
            .map(
              (j) =>
                `<li><button type="button" class="me-item" data-act="r3job" data-arg="${esc(j.id)}"><i style="background:#ffb13c"></i>${esc(j.title)} <em>${arcName(j)}</em></button>${
                  j.phone !== j.written ? `<button type="button" class="me-mini" data-act="r3jobHome" data-arg="${esc(j.id)}" title="Back to ${esc(j.written)}">OWN PHONE</button>` : ''
                }</li>`,
            )
            .join('')}</ul>`
        : `<p class="me-note${a.added ? ' bad' : ''}">No job rings it${a.added ? ': move one here, or remove it' : ''}.</p>`
    }
    <label class="me-field">MOVE A JOB HERE <select data-input="r3jobHere"><option value="">—</option>${others.map((j) => opt(j.id, `${j.title} · ${arcName(j)} · now ${j.phone}`, false)).join('')}</select></label>
    <p class="me-note">One arc to a phone: the main story rings by day, the Night Shift after dark, and both can ring at once.</p>`;
}

function storyPanel(a: Anchor, d: SpotPanelInputs): string {
  const id = storyJob(a.id);
  const job = d.jobs.find((j) => j.id === id);
  const how =
    d.storyKind === 'via' || d.storyKind === 'nodes'
      ? 'Drag one of its crossings (the squares) to move it: it snaps to the nearest crossing.'
      : d.storyKind === 'points'
        ? 'Drag one of its points (the squares) to move it.'
        : `Drag it to move it${d.turnable ? '; R turns it a quarter' : ''}. Its job uses it where it stands.`;
  const ring = job
    ? `<label class="me-field">RINGS FROM <select data-input="r3ringFrom" data-job="${esc(job.id)}">${d.phones.map((p) => opt(p.id, `${p.label}${p.id === job.written ? ' (written for)' : ''}`, p.id === job.phone)).join('')}</select></label>`
    : '<p class="me-note">Starts without a call (the cold open).</p>';
  const turn = d.turnable ? `<div class="me-row"><button type="button" class="me-btn" data-act="turnSpot" data-arg="${-Math.PI / 2}">TURN ⟲</button><button type="button" class="me-btn" data-act="turnSpot" data-arg="${Math.PI / 2}">TURN ⟳</button></div>` : '';
  return `<p class="me-note">${how}</p>${turn}<h4>THE JOB</h4>${ring}`;
}

function frenzyPanel(a: Anchor, d: SpotPanelInputs): string {
  const e = d.edit;
  if (e?.add !== 'frenzy') {
    const f = (ACTIVE_FRENZIES.find((x) => x.id === a.id) ?? FRENZIES.find((x) => x.id === a.id))!;
    return f ? `<p class="me-note">${esc(f.title)} in ${f.seconds} s${f.gift ? ` · hands over a ${f.gift}` : ''}${f.needsCar ? ' · needs a car' : ''} (a shipped frenzy: its goal is the game's)</p>` : '';
  }
  const def = customFrenzy(e);
  const l = FRENZY_LIMITS[def.goal];
  return `<h4>FRENZY <span class="me-sub">${esc(def.title)} · ${def.seconds} S${def.needsCar ? ' · NEEDS A CAR' : ''}</span></h4>
    <label class="me-field">GOAL <select data-input="r3goal">${FRENZY_GOALS.map((g) => opt(g, `${FRENZY_LIMITS[g].label}${NEEDS_CAR_GOALS.has(g) ? ' (car)' : ''}`, g === def.goal)).join('')}</select></label>
    <label class="me-field">TARGET <input type="number" data-input="r3target" min="${l.target[0]}" max="${l.target[1]}" step="${l.step}" value="${def.target}"><small>${l.target[0]}–${l.target[1]}</small></label>
    <label class="me-field">SECONDS <input type="number" data-input="r3seconds" min="${l.seconds[0]}" max="${l.seconds[1]}" step="${SECONDS_STEP}" value="${def.seconds}"><small>${l.seconds[0]}–${l.seconds[1]}</small></label>
    <label class="me-field">GIFT <select data-input="r3gift">${opt('', 'NONE', !def.gift)}${FRENZY_GIFTS.map((g) => opt(g, g.toUpperCase(), g === def.gift)).join('')}</select></label>
    <p class="me-note">Plays like a shipped frenzy: pays $1,000 the first time, turns gold, counts toward 100%.</p>`;
}

/** The "can host" lines for a block or road: what the run-time scenes could pick there. */
export function canHostHtml(hosts: readonly SceneHost[] | undefined): string {
  if (!hosts?.length) return '';
  return `<h4>CAN HOST <span class="me-sub">scenes that pick their spot near the player</span></h4><ul class="me-hosts">${hosts
    .map((h) => `<li>${esc(h.scene)}${h.count > 1 ? ` <b>×${h.count}</b>` : ''}</li>`)
    .join('')}</ul>`;
}

/** PLACE's pickups optgroup. */
export function pickupOptions(): string {
  return `<optgroup label="PICKUPS">${PICKUP_ITEMS.map((k) => `<option value="spot:pickup:${k}">PICKUP: ${k.toUpperCase()}</option>`).join('')}</optgroup>`;
}
