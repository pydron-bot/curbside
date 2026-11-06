# Audio

Everything is synthesised at runtime with the Web Audio API: no audio files,
no dependencies. `GameAudio` (`src/audio/gameAudio.ts`) owns it all; `main.ts`
only creates it, feeds it one mutable `AudioFrame` per frame and forwards pause.

- **Unlock and lifecycle.** One `AudioContext`, created on the first
  tap / click / key (iOS needs a user gesture; a one-sample silent buffer
  completes the unlock). Only that happens inside the gesture handler: noise
  buffers, the reverb impulse and the graph are built in the next few tasks,
  so the first touch doesn't drop frames. Interrupted or suspended contexts
  resume on the next gesture. A hidden page suspends it; pausing silences the
  world and muffles the music (UI sounds still play), and 45 s of pause
  suspends it to save battery. Master volume at 0 keeps the context
  suspended; music volume at 0 stops the sequencer and unhooks the music
  graph, so muted music costs no CPU.
- **iOS audio session.** On iOS 16.4+ `navigator.audioSession.type` is
  `'playback'`, so the silent switch doesn't mute the game (setting
  `ignoreSilentSwitch`; false → `'ambient'`). `'playback'` also stops other
  apps' audio, so while the game is turned all the way down (master 0, or
  SFX and music both 0) it drops to `'ambient'` and the player's own music
  keeps playing. A sound-settings screen should explain the toggle as "Play
  sound with the silent switch on".
- **Mix.** World sounds (muted on pause, muffled by close blasts, hits and
  death, with a synthetic street reverb) and UI/stingers → SFX bus; music →
  its own bus; both → master → glue compressor → limiter. Bus gains follow
  `settings.masterVolume / sfxVolume / musicVolume` (squared slider curve).
  The world muffle and the music duck are each one merged state (`Dip` in
  `mix.ts`): the deepest pull wins and the longest hold is kept, so a hurt in
  the same frame as a close blast or the killing blow can't cut the blast's
  deafening or the WASTED muffle short.
- **Spatial.** One-shots are placed relative to the camera focus: inverse
  distance falloff with a floor (far events are quiet, not silent), stereo pan
  by screen x, air-absorption lowpass and more reverb with distance. Sirens
  also get doppler.
- **Budget.** One-shots are capped per category (oldest stolen) and overall,
  rate-gated per event type (a 30-car chain reaction makes two booms), and
  every node is disconnected when its voice ends; `audio.debug` shows live
  node and voice counts. Continuous voices push parameters at ~45 Hz.
- **Events.** It subscribes to every `GameEvent` on the bus (`src/core/events.ts`);
  nothing in the simulation calls it directly.
- **Title theme and stings.** The game has a tune of its own: a two-bar
  hook in A minor (`themes.ts`: a falling call on a 3+3+2, the flat sixth
  sighing on to the fifth, then a climb home), written out note for note
  (a song's `melody` plays as written instead of a composed lead). On the
  title GameAudio's `'menu'` plays it as a theme instead of the station's
  menu tier: a station off the dial with its own chords and a 30-bar loop
  that builds a little (intro, the hook, the beat comes in, the hook with
  drums, a breath; 72 s at 100 BPM). `'game'` brings the radio back with
  its next song (its first, at boot); `audio.station`, the saved station
  and the NOW PLAYING card stay the radio's (a retune on the title is kept
  for the game, and a station heard on foot doesn't carry over: off the
  game the music is put back on the radio's station, silently under the
  theme). Every sting and UI sound is tuned to the key the music is
  in (the song's own, transposition included), and to its mode: a song is
  major when its tonic chords have the major third (or, with no tonic
  chord, when its chords hold the key's major third rather than its minor
  one; `songMajor` in `stations.ts`, `Arranger.major` next to `key`, the
  next song's mid-switch). INSERT COIN's four songs and GETAWAY's dominant
  blues (Hot Wire Strut) are major, everything else minor. Over a major
  song the count-in goes I - IV - V to a major GO, a job starts on the hook
  re-spelled major and fails on to the relative minor (sad, but no minor
  third against the radio's major one), awards climb the major
  pentatonic, KABOOM stabs a major tenth and a UI fail falls through the
  fourth; minor songs get exactly what they had. WASTED and BUSTED stay
  minor (the music stops). The new stings quote the
  hook: WASTED (heavy, then the tape sags) and BUSTED (cold, sinking to the
  flat fifth) over their slam and clang; a payphone job starts on a bar of
  heist pulse under the hook, passes on it in the major, fails on it losing
  its nerve (the starts cycle four leads and tempos by job, the passes
  three, the fails two; the radio dips under them); the 3-2-1-GO before a
  Chaos Run, race or frenzy is a hit per number, building over a riser to
  the tonic with the music held down, and GO lands a big hit; in a car it
  drops the radio back in hard on a chorus, a few layers up (on foot the
  street plays on: a frenzy started on foot runs to whatever is playing
  nearby, or to silence). Getting into a car puts the radio back on your
  station at once, so a run's count-in is in its key. Scores are
  pure data (`stings.ts`), played by one gliding lead and bass per sting,
  chord stabs and takes of the radio's own drum kit.
- **The chase.** From 3 stars the radio gives way to a score of the game's
  own (`music/chase.ts`), off the dial like the theme: the hook on a brass
  lead over a breakbeat, a reese bass pushing octaves and saw stabs on the
  hook's 3+3+2, E minor, 141 BPM at 3 stars up to 150 at 5 (two cues, the
  second a minor third up, alternating each time round its 36-bar loop: the
  hook in every chorus, a driving verse, a two-bar breath). It comes in on
  the next bar line, risen into over what's left of the bar and landing on
  a crash, with no static (it's score, not a retune), and follows the
  wanted level and play through the usual intensity floor; at one or two
  stars it carries on, calmer. When the police lose you (back to 0 stars:
  evaded, resprayed) it calms down, two drumless bars of the hook, and
  hands back to the radio's next song; back to 3 stars during those, it
  carries on (at one or two it hands back all the same). WASTED and BUSTED
  fade the music out as before (and it stays out: a death clears the stars
  before the music hears of it, so the chase is dropped only once the
  music is off) and drop the chase; after respawn it's the radio, or what
  the street plays, with the respawn sting in its key. R (or tapping the
  card) during a chase is the player's call: the chase drops for the next
  station and stays away for the rest of that chase, until the stars are
  back to 0 and up to 3 again. It plays in your ears on foot too, never
  through the street below; on foot its last bar fades out, so the street
  takes over from silence, not with the radio's next song in your ears. The
  radio card names it while it plays: it drops in as the chase comes in and
  when you get into a car during one, CURBSIDE PURSUIT in the police's red
  and blue over `NOW PLAYING · R FOR RADIO` (`TAP FOR RADIO` on touch), and
  that tap or R is the skip (`audio.playingScore`, `audio.onScoreChange`).
  The mechanism is the theme's: an `Arranger`
  plays a `Theme` instead of the radio (`theme` in 'menu', `score` in
  'game'), and a Theme without a set tempo or tiers follows the intensity
  under its own form, section rules (`shape`) and `outro`.
- **Music on foot.** Out of the car the radio isn't in your ears: you hear
  music faintly from the street as you pass it (`streetMusic.ts`), one
  station at a time on the one music player, through a street chain on the
  music path (`StreetChain` in `loops.ts`: a lowpass, a pan and a gain;
  open in the car, the chase and the title). The car you got out of plays
  your station where you left it, so its radio fades as you walk away (and
  comes back as you walk back), unless it's a police car or SUV, a SWAT
  van, an ambulance, a fire truck or a two-wheeler (no radio worth hearing,
  like those at the kerb); about one in three parked cars has its radio on
  (nobody in it, not police, not wrecked or burning; the station a hash of
  where it's first heard parked, kept while it stays about there, so a
  nudge from traffic or a blast doesn't retune it or switch it off; moved
  6 m it's been re-parked and picks again: the van by the spawn point plays
  the first station); half the neon-lit shopfronts and a quarter of those
  with awnings play their district (NEON MILE funk or phonk, GLASS HEIGHTS
  synthwave or breaks, COBBLE ROW lo-fi, RUSTWATER DOCKS dub, MAPLE FLATS
  chiptune or lo-fi, a fifth or two of each with something else; 591 in
  the city, in a 32 m grid built once); and each VIPERS hangout's boombox plays
  SIDEWAYS 808 while its crew stands about calm, loud enough to carry 30 m
  or so. When the crew turns on you or gets knocked about it's cut with a
  record scratch, and back once they've settled for 12 s (`gangMode` emits
  `'boombox'` events, `{ id, x, z, on, cut }`; `stepBoombox` in `gangs.ts`).
  Each emitter falls off with distance to silence at its range and is
  muffled, as if through a car body or a shop door, until you're close, and
  panned by where it is; levels against the car radio (1): your car 0.5,
  parked cars and shops 0.34 up close (about −14 dB at a few metres), the
  boombox 0.62. The loudest is heard, but another station takes over only
  when it's 1.6× louder than the loudest playing the current one, so
  walking between two doesn't flap; the change fades out, retunes quietly
  from the top of a phrase and fades back in. Nothing in range for 4 s and
  the music goes dormant (no notes booked) until something is. Stepping out
  of the car carries the radio on from your ears down to the street; after
  WASTED or BUSTED (the music was off) and after the chase, the street
  starts from silence instead. Getting into a car puts the radio back on
  your station (with the usual static when that's a change, seamless when
  it's already playing it) and NOW PLAYING as usual; songs heard from the
  street never pop the card. R on foot retunes the car radio for next time
  and shows the card with its name (by your own car you hear it retune).
  The street is scanned every 0.2 s with nothing allocated but a parked
  car's record the first time it's heard (`ParkedRadios`).
- **Music.** A look-ahead scheduler (25 ms timer, 0.12 s ahead on the audio
  clock) plays original songs in seven styles: NIGHTDRIVE FM (synthwave),
  BREAKNECK 99.1 (breakbeat), LOW TIDE (lo-fi), SIDEWAYS 808 (phonk),
  GETAWAY 104.3 (funk and disco), DUBWISE 88.8 (dub) and INSERT COIN
  (chiptune), four songs each (made-up
  titles and artists, `stations.ts` `songs`), each in its own key with its
  own verse and chorus chords and melody. A song runs through a form (intro
  4 bars, verse 8, chorus 8, break 4, chorus 8, outro 4; `sequencer.ts`
  `FORM` / `shapeTier`): while calm the intro and outro are drumless, the
  melody waits for the chorus and the break drops to chords and arp; from
  intensity 3 (a chase) every section plays in full. Then the next song;
  retuning picks up a station with its next song. Intensity 0–5 layers in
  kick, snare, arps, lead, crashes and risers, opens the filter and lifts
  the tempo; changes land on bar lines with a fill, tempo glides. It follows
  chaos (combos, explosions, speed) above a floor set with `setIntensity`.
  `'menu'` mode plays the title theme (or, with no theme set, the station's
  drumless menu tier). Drums play
  from a kit rendered per station sound (`drumKit.ts`: layered, saturated
  hits, 808-style metal hats, a four-hand clap, up to three takes each in
  round robin, one crash take shared by every kit), rendered a take at a
  time and never two in a frame: in idle time from the moment audio
  unlocks, whatever is on screen (`MusicPlayer.warmKits`: the radio's kit,
  then the chase's, then the rest, the two shared crash takes before any
  other; behind the title a take 40 ms after the last, in play gently,
  150 ms apart, so with PLAY as the first tap every kit is in some 15-20 s
  into play; nothing warms while the music is at volume 0), or a take a frame when a station is heard before its kit is
  in (warming waits for it); the live drum voices stand in until each part
  is in. The
  NOW PLAYING card shows the song and artist (`audio.song`,
  `audio.onSongChange`) and drops in for each new song while you drive.
- **Station instruments.** Each station's `StationSound` picks its
  timbres; the mono bass and lead are reshaped per station (no extra
  oscillators): an 808 (sine boom, slides, a drive patched into the bass
  chain only while it plays), slap bass (thumb, popped octaves, ghost notes
  and a fret click), a deep sub, the 8-bit stepped triangle; pulse-wave,
  brass and melodica leads; per-note cowbell, pulse arps, reggae skanks,
  auto-wah guitar chops and an 8-bit pad. Custom oscillator shapes
  (`waves.ts`) are built once per context. Patterns add `~` (hold and
  slide into the next note, across the bar line too), `g` (ghost note) and
  `4` (fourth) for bass and `r` / `t` (32nd and triplet rolls) for drums;
  phonk's arp yields to the lead so one cowbell plays riff and melody. Dub
  sets its own echo (send, feedback, a darker repeat) and throws the
  rimshot, skanks and each section's last bar into it. The kits add a hard
  kick, a reggae rimshot and the chip kit (an LFSR noise channel, its
  93-step metallic mode for hats, a stepped-triangle kick, 4-bit volume).
  New stations go on the end of `STATIONS`: the saved station is an index.

| Module | What |
|---|---|
| `carSound.ts` | 5-speed gearbox / RPM model, per-archetype engine profiles, squeal and road-noise amounts (pure, tested) |
| `mix.ts`, `voices.ts`, `chaos.ts` | falloff/pan/doppler math, voice limiter and rate gate, chaos → intensity (pure, tested) |
| `music/theory.ts`, `music/stations.ts`, `music/sequencer.ts` | chords, voice leading, lead composer, station data, step clock and arranger (pure, tested) |
| `music/drumKit.ts`, `music/waves.ts` | rendered drum kits and the chip noise channel, custom oscillator shapes (pure, tested) |
| `synth.ts` | noise buffers, node-tracking `Voice`, envelopes, reverb impulse |
| `sfx.ts`, `loops.ts`, `music/musicPlayer.ts` | one-shot recipes, continuous voices (engine, tyres, fire, ambience, sirens), music instruments |
| `music/themes.ts`, `music/stings.ts` | the title theme and its hook; the stings built on it as scores in the song's key and mode (pure, tested), played by `sfx.playSting` |
| `music/chase.ts`, `streetMusic.ts` | the chase score and when it plays; music on foot: emitters, falloff, muffle and pan, stations by district and hash, the switch with its hysteresis, the shop grid, the boomboxes (pure, tested) |

API for other systems:

```ts
audio.update(dt, frame)              // per frame: listener x/z, player car (describeCar) or null, footSpeed, health, vehicles (fires)
                                     // and the cars driven and last got out of (playerCar, lastCar: radios on foot)
audio.streetShops(buildings, plans)  // once at wiring: the shopfronts that play music on foot
audio.siren(id, x, z, on, style?)    // call every frame while it sounds; 'twoTone' | 'wail' | 'yelp'; stale ids fade out after 1 s
audio.horn(x, z, duration?)
audio.ui('click' | 'confirm' | 'back' | 'countdown' | 'go' | 'success' | 'fail' | 'cash' | 'star')
audio.countIn(n)                     // a run's 3-2-1-GO: 3, 2, 1 as each number shows, 0 on GO
audio.missionCue('start' | 'passed' | 'failed', index)  // a payphone job's music (index: the job's)
audio.setPaused(bool)
audio.setIntensity(0..5)             // music floor, e.g. the wanted level
audio.setMusicMode('game' | 'menu' | 'off')
audio.nextStation()                  // also R / tapping the radio card (mid-chase: drops the chase)
audio.playingScore                   // the chase is playing instead of the radio
audio.onScoreChange(fn)              // fn(true) as the chase comes in, fn(false) when the radio's back
audio.unlock()                       // call from a title screen's tap
audio.debug                          // state, voices, nodes, engine, music, street (on foot), chaos, muffle
```

To audition sounds without playing, render them offline: every recipe takes
a `Voice` on any `BaseAudioContext`, so an `OfflineAudioContext` in the dev
page can render and analyse them (`window.__ub.audio` and `__ub.events` are
exposed for emitting test events).
