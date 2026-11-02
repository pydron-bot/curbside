/**
 * "Now playing" card for the procedural radio: drops in at the top of the
 * screen when you get into a car, change station or (in a car) a new song
 * starts, with the song and its (made-up) artist under the station. Tap it
 * (touch) or press R (keyboard) to change station. While the chase plays it
 * names the chase instead, as it comes in and when you get into a car, and
 * the same tap or R is the way back to the radio.
 */
import './audio.css';
import type { GameAudio } from '../audio/gameAudio';
import { CHASE_STATION } from '../audio/music/chase';
import type { Station } from '../audio/music/stations';
import { events } from '../core/events';

const SHOW_MS = 2600;
/** A stamp's whole show, ms (ui/stamp.css's 1.9 s animation). */
const STAMP_MS = 1900;

export function mountRadioToast(root: HTMLElement, audio: GameAudio): { show(station?: Station): void } {
  const el = document.createElement('div');
  el.id = 'radio';
  el.hidden = true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const tune = coarse ? 'TAP TO TUNE' : 'R TO TUNE';
  const back = coarse ? 'TAP FOR RADIO' : 'R FOR RADIO';
  el.innerHTML = `
    <div class="radio-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="radio-text"><small></small><b></b><span class="radio-song"></span></div>`;
  root.append(el);
  const hint = el.querySelector('small')!;
  const name = el.querySelector('b')!;
  const songLine = el.querySelector<HTMLElement>('.radio-song')!;
  let inCar = false;
  const setSong = () => {
    const song = audio.song;
    songLine.textContent = song ? `${song.title} — ${song.artist}` : '';
    songLine.hidden = !song;
  };
  const chaseShown = () => el.dataset.station === CHASE_STATION.id;
  let hideTimer = 0;
  let goneTimer = 0;
  // A mayhem stamp needs the space under the stars more than the station name
  // does (on a phone under an activity card, the card pushed it onto NOS):
  // the card leaves as a stamp lands and waits for its show to end.
  let stampEnds = 0;
  let waitTimer = 0;

  const hide = () => {
    window.clearTimeout(waitTimer);
    window.clearTimeout(hideTimer);
    el.classList.remove('in');
    goneTimer = window.setTimeout(() => (el.hidden = true), 400);
  };

  /** The radio's card (`station`, or the car radio's), or the chase's while it plays and no station is asked for. */
  const show = (station?: Station) => {
    const wait = stampEnds - performance.now();
    if (wait > 0) {
      window.clearTimeout(waitTimer);
      waitTimer = window.setTimeout(() => show(station), wait);
      return;
    }
    const chase = !station && audio.playingScore;
    const s = chase ? CHASE_STATION : (station ?? audio.station);
    hint.textContent = `NOW PLAYING · ${chase ? back : tune}`;
    name.textContent = s.name;
    el.dataset.station = s.id;
    if (chase) songLine.hidden = true;
    else setSong();
    window.clearTimeout(hideTimer);
    window.clearTimeout(goneTimer);
    el.hidden = false;
    // Next frame, so the slide-in transition runs from the hidden position.
    requestAnimationFrame(() => el.classList.add('in'));
    hideTimer = window.setTimeout(hide, SHOW_MS);
  };

  audio.onStationChange((s) => show(s));
  audio.onScoreChange((playing) => {
    if (playing) show();
    // The radio's back: in a car its card takes over; on foot the chase's just goes.
    else if (!el.hidden && chaseShown()) {
      if (inCar) show();
      else hide();
    }
  });
  audio.onSongChange((_song, s) => {
    // Retuning: the new station's first song lands a bar later, so just update the card.
    if (!el.hidden) {
      if (!chaseShown()) setSong();
    } else if (inCar) show(s);
  });
  events.on('enterVehicle', () => {
    inCar = true;
    show();
  });
  events.on('exitVehicle', () => (inCar = false));
  events.on('stamp', () => {
    stampEnds = performance.now() + STAMP_MS;
    hide();
  });
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    audio.nextStation();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey) audio.nextStation();
  });
  return { show };
}
