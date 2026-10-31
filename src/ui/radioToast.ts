/**
 * "Now playing" card for the procedural radio: drops in at the top of the
 * screen when you get into a car, change station or (in a car) a new song
 * starts, with the song and its (made-up) artist under the station. Tap it
 * (touch) or press R (keyboard) to change station.
 */
import './audio.css';
import type { GameAudio } from '../audio/gameAudio';
import type { Station } from '../audio/music/stations';
import { events } from '../core/events';

const SHOW_MS = 2600;

export function mountRadioToast(root: HTMLElement, audio: GameAudio): { show(station?: Station): void } {
  const el = document.createElement('div');
  el.id = 'radio';
  el.hidden = true;
  const tune = window.matchMedia?.('(pointer: coarse)').matches ? 'TAP TO TUNE' : 'R TO TUNE';
  el.innerHTML = `
    <div class="radio-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="radio-text"><small>NOW PLAYING · ${tune}</small><b></b><span class="radio-song"></span></div>`;
  root.append(el);
  const name = el.querySelector('b')!;
  const songLine = el.querySelector<HTMLElement>('.radio-song')!;
  let inCar = false;
  const setSong = () => {
    const song = audio.song;
    songLine.textContent = song ? `${song.title} — ${song.artist}` : '';
    songLine.hidden = !song;
  };
  let hideTimer = 0;
  let goneTimer = 0;

  const show = (station: Station = audio.station) => {
    name.textContent = station.name;
    el.dataset.station = station.id;
    setSong();
    window.clearTimeout(hideTimer);
    window.clearTimeout(goneTimer);
    el.hidden = false;
    // Next frame, so the slide-in transition runs from the hidden position.
    requestAnimationFrame(() => el.classList.add('in'));
    hideTimer = window.setTimeout(() => {
      el.classList.remove('in');
      goneTimer = window.setTimeout(() => (el.hidden = true), 400);
    }, SHOW_MS);
  };

  audio.onStationChange((s) => show(s));
  audio.onSongChange((_song, s) => {
    // Retuning: the new station's first song lands a bar later, so just update the card.
    if (!el.hidden) setSong();
    else if (inCar) show(s);
  });
  events.on('enterVehicle', () => {
    inCar = true;
    show();
  });
  events.on('exitVehicle', () => (inCar = false));
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    audio.nextStation();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey) audio.nextStation();
  });
  return { show };
}
