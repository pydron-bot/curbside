/**
 * What the radar's letters mean, for How to Play and the PROGRESS page
 * (the blips themselves are set by heatPresenter and the activity modes).
 */
export const RADAR_LEGEND: ReadonlyArray<readonly [icon: string, meaning: string]> = [
  ['H', 'Safehouse: the shop'],
  ['M', 'Ringing payphone: a job'],
  ['S', "Pay 'n' Spray: lose the heat"],
  ['★', 'Police station'],
  ['!', 'Frenzy'],
  ['R', 'Checkpoint race'],
  ['$', 'Docks: car exports'],
  ['T', 'Taxi fare'],
  ['?', 'Hidden package (with the scanner)'],
];

/** One line: "H safehouse: the shop · M ringing payphone: a job · …". */
export const RADAR_LEGEND_LINE = RADAR_LEGEND.map(([icon, text]) => `${icon} ${text.charAt(0).toLowerCase()}${text.slice(1)}`).join(' · ');
