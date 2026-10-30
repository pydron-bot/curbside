# Backlog: scoped to-do items (2026-10-30)

Every item from the handoff to-do list, plus gaps found on the way, checked against the code on `claude/game-overhaul` at 00c4d65 by read-only investigators. Causes marked *confirmed* were confirmed from the code (often reproduced in headless Chromium); line numbers will drift as the code changes. The order to work in is in `docs/HANDOFF.md` → *To do*.

Size: **S** under ~1 h, **M** a few hours, **L** a day or more. **cloud** means it can be done and verified without the iPhone or a person playing; **you** means it needs the user (device, real play, or a decision).

## Known minor issues: UI and HUD

### settings-scroll-340: Settings sheet overflows at 852x340 (Safari toolbar showing) [S, cloud]

**Findings:** I measured it in Playwright (iOS UA, 852x340 @3x, isMobile, hasTouch). The safe areas were emulated by overriding --safe-l/r 59px and --safe-b 21px on :root. Results: the card is 734x311, the header 59px, and .sheet-body has scrollHeight 300 against clientHeight 250, so it overflows by 50px. Without the iPhone insets it overflows by 39px. At 852x393 it fits, with 3px to spare (card 361 vs 364 available). The 'Show FPS' row sits below the fold (screenshot: (a throwaway scratch script)). The right column (CONTROLS + DISPLAY) is 280px tall; the left is 216. Height budget: the overlay padding is --edge-t 8 and --edge-b max(10, safe-b=21) (src/ui/menu.css:3-14, tokens.css:9-13). The card is max-height 100% with overflow hidden (menu.css:273-279). .sheet-head has padding 8/6 around a 44px close button plus a 1px border, 59px in total (menu.css:281-287, 298-308). .sheet-body padding is 6px top and 14px bottom (menu.css:320-326). Section gap is 2px and h3 margin is 8px 6px 2px (menu.css:336-347). .srow has min-height 48 and padding 2px 8px (menu.css:349-358). The existing @media (max-height:420px){.srow{min-height:44px}} (menu.css:361-365) only shrinks toggle rows: slider rows (.slider height 44, menu.css:399) and choice rows (.segmented button min-height 44, menu.css:478) stay at 48 because of the 2px row padding. Measured row heights: 48,48,48,44,48,44,44,48,44.

**Cause:** Confirmed by measurement. The sheet's natural height is 361px (59 head + 300 body + 2 border), while the overlay leaves 311px at 852x340 with iPhone insets. The short-screen media query was tuned for 393px. It also misses the slider and choice rows, which are 44px controls plus 4px of row padding.

**Fix:** Add an @media (max-height: 380px) compact block in menu.css, so 393 keeps its current look. Changes: .srow{padding-block:0} saves 8px on the right column's two choice rows. .sheet-head{padding:0 4px 0 18px} gives a 45px head (saves 14). .sheet-body{padding:2px 14px 6px} saves 12. .settings-grid h3{margin:4px 6px 2px} saves 8 across two h3s. .settings-grid section,.settings-col{gap:0} saves 12 across 6 gaps. Total about 54px, against the 50px overflow. Also fix the existing 420px rule so slider and choice rows really are 44 (padding-block:0), as its comment claims. Three columns is not a fix: the 4-button Graphics segmented control (~210px) plus a label won't fit in a ~223px column at a 706px body width.

**Risks:** Only about 4px of margin at 340 after the change, so any future settings row will overflow again. The compact head trims the neon top-edge breathing room. The scroll container stays as a fallback, so the worst case is the current behaviour.

**Verify:** Re-run (a throwaway scratch script) Expect overflow <= 0 at 852x340 with and without insets, and an unchanged layout at 852x393 and 1280x720. Screenshot each. Also open Settings from the pause menu with the keyboard and step through every row to check the focus ring isn't clipped.

**Needs from the user:** A quick look on the real iPhone in Safari with the toolbar showing. iOS fonts (Avenir Next / Arial Black) differ from the Linux fallbacks, but row heights are fixed by min-heights, so the measurement should carry over.

### ctxlost-reload-nav: Context-lost 'RELOAD THE GAME' button unreachable by keyboard/pad [S, cloud]

**Findings:** PauseOverlay builds the reload button with a plain click listener (src/ui/pauseOverlay.ts:77-80) and never calls this.nav.add for it. Only resume, settings, how-to, restart, quit and update are registered (pauseOverlay.ts:82-88). menuButton sets tabIndex=-1 (menu.ts:150), so native Tab focus can't reach it either. Separately, FrontDoor.showPause only pushes the pause panel for reason 'paused'; for 'contextLost' it calls closeFrom(i) (src/ui/frontDoor.ts:111-121). The nav stack is therefore empty, and route() drops every nav command ('in play: menu keys are game keys', frontDoor.ts:160-165). offerReload (pauseOverlay.ts:142-146) also doesn't move the focus highlight. Playwright check: start a game, call WEBGL_lose_context.loseContext(), call pause.offerReload(stub), then press ArrowDown, ArrowUp, Enter and Space. Results: frontDoor.stack top was null, the RELOAD button had no .nav-item class, nav-focus stayed on the hidden RESUME button, and the stub was called 0 times.

**Cause:** Confirmed. The reload button isn't a MenuNav item, and the pause panel isn't on FrontDoor's nav stack while the context is lost, so no keyboard or pad command can reach it.

**Fix:** pauseOverlay.ts: replace the click listener with this.nav.add({ el: this.reload, activate: () => this.onReload?.() }). nav.add already wires click, and keeping both would fire it twice. In offerReload(), when the offer is non-null, call this.nav.focusElement(this.reload). frontDoor.ts showPause(): for 'contextLost', close anything opened above the pause panel and make sure the pause panel is on the stack (closeFrom(i); this.stack.push(this.pause)), so route() delivers confirm and arrows to it. back() already does nothing for contextLost, and togglePause already returns early unless the reason is 'paused'. On restore, setPaused(false) and hidePause() pop it, or setPaused(true,'paused') finds it already on the stack.

**Risks:** The pause panel is now on the stack during context loss, including when the title is open (stack [title, pause]). The restore path's hidePause()/closeFrom must pop it, and the paths above do. The UPDATE READY button can also be visible on this card and is already a nav item, so arrows may move between UPDATE and RELOAD, which is fine.

**Verify:** Re-run (a throwaway scratch script) (context-lost part). Expect the stack top to be PauseOverlay, RELOAD to carry .nav-item and .nav-focus, and the stub to be called once after Enter. Repeat with the gamepad A path via input.pushNav if wanted. Then call restoreContext() and check that the game resumes and the stack is empty, and that pausing mid-menu then losing and restoring the context returns to the PAUSED menu.

### radio-feed-overlap: Radio 'now playing' card overlaps long score-feed lines [S, cloud]

**Findings:** #radio is fixed at top centre, 52px under the pause button, with translate(-50%) (src/ui/audio.css:2-29). It is about 230px wide with 'BREAKNECK FM' and stays up for 2.6s (radioToast.ts:11). It shows on every enterVehicle (radioToast.ts:41). The score feed is right-anchored under the score (hud.css:402-410, 494-519), with white-space:nowrap and no max-width, so long lines grow leftward toward the centre. On touch in a car the feed is pushed a further 72px left to clear EXIT (hud.css:887-889). Long lines are raised on the same enterVehicle event, e.g. ExportMode's 'EXPORT: ANY ICE CREAM VAN' (src/game/modes/exportMode.ts:64-70) plus a CARJACK award. Playwright geometry (feed lines plus the radio card forced in): at 852x393 with insets in a car, the radio spans x 311-541 and y 56-98; the EXPORT line spans x 473-721 and y 68-84, overlapping by 68px horizontally. At 852x340 in a car the overlap is 35px. At 852x393 on foot there is a 4px gap. On desktop 1280x720 there is no overlap (line starts at x=987).

**Cause:** Confirmed. The feed's width is unbounded (nowrap) while the radio card occupies the top-centre band at the same height. On touch in a car the 72px EXIT margin pushes feed lines into that band.

**Fix:** Bound the feed horizontally so it can't cross into the radio's centre column. Give #score a --feed-gap custom property (0 on foot, 72px in a car on touch, used for both margin-right and the left-handed margin-left). Set .score-feed{max-width:calc(50vw - var(--edge-r) - 125px - var(--feed-gap))}, where 125px is half the radio's max-width (give #radio max-width:240px) plus a small gap. Let the label wrap inside it: .feed-line span{white-space:normal; text-align:right; text-wrap:balance}, and keep the points <b> nowrap. Mirror the alignment for data-hand='left'. Alternative, if two-line feed entries look bad: drop the radio card lower (top ≈ edge-t + 52 + feed height) only on touch in car mode.

**Risks:** Wrapped lines make the feed taller and could reach the activity card or timer under it on 340px-high screens (unconfirmed; check). It is CSS-only, so there are no per-frame costs. The left-handed layout needs the mirrored rule.

**Verify:** Re-run (a throwaway scratch script) Note that the HUD resets data-mode each frame, so set the mode via __ub.touch.setMode('car', false), or board a car, rather than writing body.dataset. Assert no rect intersection between #radio and any .feed-line at 852x393 and 852x340 (car and foot, right- and left-handed) and at 1280x720. Screenshot each with an active frenzy or mission card to check vertical clearance.

**Needs from the user:** Pick between wrapping long feed lines and moving the radio card. Wrapping is the recommendation.

### frenzy-failed-behind-wasted: No FRENZY FAILED banner when a frenzy ends by death or arrest [S, cloud]

**Findings:** FrenzyMode fails the run on playerDied and busted (src/game/modes/frenzyMode.ts:52-54). end(false) raises the banner only under `else if (ctx.live)` (frenzyMode.ts:131-134). ctx.live is playing() && player.alive && !player.arrested (src/game/progressDirector.ts:171-174). Player.die() sets dead before it emits playerDied (src/game/player.ts:247-251), and arrest() sets custody before it emits busted (player.ts:197-204). ctx.live is therefore always false in this handler, and the banner is skipped. The director already has a mechanism for this: holdBanners queues banners while dead or busted and releaseBanner() shows them on 'respawn' (progressDirector.ts:151-156, src/ui/progressHud.ts:173-210). RaceMode uses it with `ctx.live || why === 'WASTED' || why === 'BUSTED'` (src/game/modes/raceMode.ts:144-147). Playwright check: begin frenzy token 0, fast-forward 4s (phase live), player.arrest(), fast-forward 8s through the release. Result: the run ended, but ui.banner was never called (0 banners), so nothing was held for the respawn.

**Cause:** Confirmed. The frenzy's fail branch is gated on ctx.live, which is already false when the death or arrest events fire. No banner is ever raised, so the hold-until-respawn path never sees one.

**Fix:** Pass a reason through: bus.on('playerDied', () => fail('WASTED')) and bus.on('busted', () => fail('BUSTED')). Make it end(passed: boolean, why?: string), with the fail branch `else if (ctx.live || why)`, calling ctx.ui.banner('FRENZY FAILED', 'fail', why ?? 'TOUCH THE TOKEN TO RETRY'), as RaceMode does. holdBanners then queues it behind the WASTED/BUSTED card, and the respawn or release event shows it. Optionally play audio.ui('fail') only when ctx.live, so the sting doesn't sound under the WASTED card. RaceMode currently plays it either way, so keep consistent with whatever is chosen.

**Risks:** Quit, restart and Chaos Run go through reset(), not end(), so they stay silent. resetAll() calls clearBanner(), which drops a held banner (progressDirector.ts:340-355), so a held banner can't leak into a fresh run. The sub-line choice ('WASTED' vs a retry hint) is cosmetic.

**Verify:** Unit test (vitest, node): build FrenzyMode with a fake ModeCtx (live=false, a ui.banner spy, a real EventBus). Start a run via the private begin(), step past FRENZY_COUNTDOWN, emit playerDied, and expect banner('FRENZY FAILED','fail','WASTED'). Do the same for busted. Playwright: the frenzy part of (a throwaway scratch script) Expect one banner call with held=true during custody, then #act-banner showing 'FRENZY FAILED' after the release, with a few real frames run so the HUD updates.

### bike-prompt-and-ring: Bike prompt says 'STEAL THIS CAR'; player car-marker ring is fixed-size [S, cloud]

**Findings:** Prompt: main.ts reduces the nearest enterable vehicle to 'jack' or 'enter' (src/main.ts:1014-1015, with HudFrame.nearCar typed at src/ui/hud.ts:25-26). Hud.updatePrompt hard-codes the text as 'STEAL THIS CAR' or 'GET IN' (hud.ts:314-319). isBike() exists (src/entities/vehicle.ts:200-202) and is already imported in main.ts:18, but it isn't used here. Ring: Look.addMarker draws the driving ring at a constant 6.4x6.4 m with the chevron 3.4 m ahead, whatever the vehicle (src/render/look.ts:208-233). PlayerView carries no size (look.ts:26-35; filled at main.ts:982-993). The ring sprite's line is at 0.82 of the half-size (glowSprites.ts:154-156), so it draws at a 2.62 m radius. That clears a sedan (body reach 2.36 m, vehicle.ts:118) by about 0.26 m. The scooter's reach is only 0.86 m (makeBody(0.44,-0.4,0.42,2,0.31), vehicle.ts:439), so the ring is about 3x its size. The opposite case: the bus reach is 6.13 m (vehicle.ts:437), so the same ring is likely hidden under the bus body (visually unconfirmed).

**Cause:** Confirmed from code. The HUD text has no vehicle-type input, and the marker ring and chevron use sedan constants instead of the vehicle's CarBody.reach.

**Fix:** Prompt: add `nearBike: boolean` to HudFrame and createHudFrame. In main.ts:1015 set hudFrame.nearBike = nearCar !== null && isBike(nearCar.archetype). In updatePrompt use jack ? (bike ? 'STEAL THIS BIKE' : 'STEAL THIS CAR') : (bike ? 'GET ON' : 'GET IN'). These are string literals, so there is no per-frame allocation, and the existing compare-by-text skip still works. Ring: add `reach: number` to PlayerView, filled in viewOfPlayer() as (v.sim.body ?? CAR_BODY).reach (0 on foot). In addMarker use size = 2 * (reach + 0.3) / 0.82, which gives 6.49 for a sedan (≈ today's 6.4), 2.83 for the scooter and 3.4 for the cop bike, and ahead = reach + 1.0 (3.36 for a sedan). Shrink the chevron for bikes (e.g. scale by min(1, reach/2.36), clamped to ≥0.6). For long vehicles, either let the ring grow (bus ≈ 15.7 m) or cap it. The cap is a judgement call; an elliptical ring via addFlat(width≠height) oriented by heading is an option.

**Risks:** Changing PlayerView is a compatible field addition, and main.ts is the only producer. Sedan-class rings change by about 1%. A bus ring that grows to ~16 m may read as an area marker rather than 'your vehicle', which is why the cap or ellipse is the user's call. The glow batch is shared, so there is no draw-call cost.

**Verify:** Playwright at 1280x720: __ub.startGame(), teleport the player next to the spawn-corner scooter (or a jacked cop bike) and next to a sedan, run a couple of frames, and read .hud-prompt .txt. Expect 'GET ON' / 'STEAL THIS BIKE' and 'GET IN' / 'STEAL THIS CAR'. Board the scooter, a sedan and the bus in turn; screenshot top-down and compare ring radius to body size. Optionally extract the prompt choice into a pure function with a vitest case. tsc --noEmit for the new fields.

**Needs from the user:** Decide how the ring should look around long vehicles (bus, firetruck): grow with the body, cap at some size, or go elliptical. The scooter fix doesn't depend on it.

**Also noticed:**

- src/ui/menu.css:361-365: the short-screen rule claims rows drop to 44pt 'so both columns fit without scrolling at 393 high', but slider and choice rows stay at 48px (44px control plus .srow padding 2px top and bottom, menu.css:349-358). Only toggle rows shrink. The sheet fits at 852x393 with just 3px spare.
- src/render/look.ts:227-231: the same fixed 6.4 m ring and 3.4 m chevron are likely hidden under long vehicles (bus reach 6.13 m, firetruck 4.72 m; vehicle.ts:433-437). Visually unconfirmed. Covered as a decision in the bike/ring item.

**Suggested order:** All five are small (S) and confirmed from code; four were also reproduced in headless Chromium. Do them as one 'minor UI polish' branch. The two pure-logic fixes go first because they're mechanical and testable: frenzy-failed-behind-wasted (mirror RaceMode's reason, add a vitest case) and ctxlost-reload-nav (nav.add plus stack push). Then the two CSS fixes, settings-scroll-340 and radio-feed-overlap, checked together in one Playwright pass at 1280x720, 852x393 and 852x340 with emulated insets; the scratch scripts already measure both. Do bike-prompt-and-ring last, because the ring size for long vehicles needs a quick design call from the user. Finish with a single on-device check on the iPhone for the two layout fixes.

## Known minor issues: simulation

### minor-smash: SMASH goes to the player even when another car hits them while they're stopped [S, cloud]

**Findings:** In the car-on-car loop (src/main.ts:628-659), collideVehicles (src/systems/physics.ts:159-219) fills CarContact.closingA/closingB, the closing speed each car brought (physics.ts:194-205). That value is already used for damage (crashDamage, main.ts:637-638) but not for scoring. The score check at main.ts:652-653 is only `if (involvesPlayer && impact > 6) award(score.award('smash', Math.round(impact * 4)))`. So the player gets SMASH points, a combo bump and credit toward the 'fz-smash' frenzy (src/game/modes/frenzies.ts:39, counted at :61) and the Chaos Run 'smash' category (src/game/modes/chaosRun.ts:64) whenever they are rear-ended or T-boned while stopped, or rammed or PIT-ed by a cop or road rager. heat.playerCrash (src/game/heat.ts:231-262) already works out who rammed whom for police through rammedBy (heat.ts:463-472). The score check above it does not. No test covers this: main.ts is wiring, and tests/score.test.ts only tests the Score class.

**Cause:** Confirmed from the code. SMASH depends only on whether the player was involved and on the total impact (main.ts:652). The player's own share of the closing speed is never checked, though contact.closingA/B has it.

**Fix:** Add a pure predicate to src/systems/score.ts, for example `smashCredit(impact, own, other)`. It returns true when impact > 6, own >= ~3 m/s and own >= ~35-40% of max(0,own)+max(0,other). With that rule head-ons still count, while being rear-ended, T-boned or PIT-ed does not. In main.ts, set `own = a === driving ? contact.closingA : contact.closingB` (and `other` to the other car's share) and award SMASH only when the predicate passes. Keep the crash event, heat.playerCrash and nearMissAt.set as they are. Apply the same check to the `byPlayer` flag passed to throwRider at main.ts:642-643 (see extra findings).

**Risks:** The SMASH x12 frenzy (50 s) gets harder, because it was partly being completed by traffic and cops hitting you. Re-check it's still achievable. contact.closingA/B comes from the first overlapping circle pair, the same pair that produced the impulse, so the two are consistent.

**Verify:** Extend tests/score.test.ts with predicate cases built from real collideVehicles contacts (as in tests/physics.test.ts:82-93): a stopped player rear-ended at 15 m/s gives no SMASH; the player at 15 m/s into a parked car gives SMASH; an equal head-on gives SMASH; being T-boned while driving across gives none. Optionally run Playwright: start the game with window.__ub, have an AI car drive into the stopped player, and check no 'award' event of kind 'smash' fires. Whether __ub exposes the event bus is unconfirmed.

**Needs from the user:** Decide whether a head-on should still count as SMASH (proposed: yes) and the threshold (around 3 m/s own closing, around 40% share). Optionally decide whether a civilian who rams your stopped car should still panic or rage (heat.playerCrash); proposed: leave as is.

### minor-props: Knock-over furniture isn't solid to people, and a fast bike tunnels through thin posts and bollards [M, cloud]

**Findings:** (1) The knockables are hydrants (r 0.25), bins, newspaper boxes and mailboxes (r 0.32), benches (r 0.95) (src/world/streetProps.ts:132-138), and race cones (r 0.3, src/world/landmarkProps.ts:~133). They exist only in Knockables (src/systems/knockables.ts), whose step() (:63-91) checks vehicles only. The people collision grid is built at main.ts:144 from city.obstacles plus dressing.solids, and SOLID_HALF (streetProps.ts:126-131) contains only streetlamp, traffic_light, bollard and dumpster. People resolve against that grid, the ramps and vehicles (main.ts:724-735), so the player and the crowd walk straight through every standing hydrant, bin and bench. (2) Posts are AABB solids: lamp and signal poles are 0.4 m (half 0.2) and bollards 0.28 m (half 0.14). collideVehicleStatic (physics.ts:109-150) resolves each body circle at its end-of-step position through resolveCircle/circleVsRect (src/world/collision.ts:71-112). When a circle centre lands inside the box, circleVsRect pushes it out through the nearest face, so a centre already past the box's middle comes out the far side. The cop_bike has 0.45 m circles (src/entities/vehicle.ts:440) and maxSpeed 38 (:394), x1.25 with nitro (:474) = 47.5 m/s, i.e. 0.79 m per 1/60 s step. That is more than post half-width plus radius (0.65 m). I measured this in a scratch harness: real stepVehicle and collideVehicleStatic, 672 hits per row at mixed angles, offsets and phases. At 47.5 m/s a cop_bike's circle passes a 0.4 m post while still overlapping it in 38/672 hits (~6%), and passes a 0.28 m bollard in 94/672 (~14%, 10 of them with the circle centre going clean through). At 38 m/s without nitro the rates are ~1% and ~3-4%. The scooter (30 m/s max) and every car never tunnel. Knockables themselves are always caught, because the overlapping circles cover the whole body. Existing tests: tests/knockables.test.ts covers cars only, tests/physics.test.ts:147-167 covers bikes at 8 m/s only, and nothing covers people against knockables.

**Cause:** Both confirmed from the code. (1) Knockables were never added to people's collision; they are only checked against cars. (2) The static resolve is a single end-of-step position check, with no swept or substepped test. At cop-bike nitro speed one step is longer than a thin post plus the bike's 0.45 m circle.

**Fix:** (1) Add `Knockables.collidePed(p, radius)`. It reuses the existing 16 m bucket map, skips knocked items, pushes the person out and removes their inward velocity (same idea as removeInward in physics.ts). Call it after collidePedStatic for the player and the crowd in main.ts, gated on look.props.loaded like knockables.step is. Give benches a box footprint for this check: an optional half-extents field on KnockableItem, computed in streetProps put() with the same quarter-turn swap as SOLID_HALF. The 0.95 m knock circle plus PED_RADIUS reaches 1.3 m from BENCH_LINE (10.55), past the pavement walk line WALK_INSET 9.5 (src/systems/crowd.ts:106), so walkers would be shoved at every bench. It allocates nothing; with ~60 people it is at most 4 bucket lookups each per step. (2) Substep rather than use a minimum radius. Give collideVehicleStatic an optional previous position (v.prev, copied at main.ts:574). When the step's travel exceeds ~0.75 x body radius, resolve at n = ceil(travel / (0.75 r)) points along the move and stop at the first contact. Only bikes above ~20 m/s and nitro sports cars above ~44 m/s pay for 1-2 extra passes. A minimum radius would need posts at least ~0.7 m wide (half-width plus radius > 0.79). That is visibly wrong for a 0.4 m pole, makes cars stop short of posts, and is still marginal for bollards. An exact swept circle-vs-AABB test is more code. Substepping is the cheapest fix.

**Risks:** Crowd agents could get pinned on a bin while path-following (re-run tests/crowd.test.ts 'walks between corners'). Props must not be solid before props.glb loads. A respawn or spawn point on a prop gets nudged. With substepping, fast bikes hit posts more often, so bikeThrows fires more at nitro (the intended effect). The ramp grid resolve (main.ts:618) should use the same substep path.

**Verify:** tests/knockables.test.ts: a person can't walk through a standing hydrant or bench, walks through a knocked one, and a bench footprint doesn't reach the walk line. tests/streetProps.test.ts: bench boxes stay off WALK_INSET. tests/physics.test.ts 'vehicle bodies': a cop_bike at terminalSpeed(spec, true) into a 0.4 m post and a 0.28 m bollard, swept over many step phases and offsets, never ends up past or overlapping it. The scratch harness tunnel.test.ts can seed that test; it showed 38/672 and 94/672 overlapping passes before any fix. Optionally run Playwright: walk the on-foot player into a hydrant via window.__ub and check their position stops at it.

**Needs from the user:** Confirm benches should block people as their real box shape (proposed), and that people only collide with furniture, without knocking it over themselves. Nothing else is needed.

### minor-junction-turns: Junction clipping: left turns don't give way to the opposite queue (worse with long vehicles) [M, cloud]

**Findings:** driveAi (src/systems/traffic.ts:224-361) has only two guards. One is the traffic light, read only in the 'approach' phase (traffic.ts:240-244, 301-312). The other is clearDistance (traffic.ts:481-503), a straight corridor 30 m ahead along the car's current heading (lateral < 1.1 + halfWidth). In the 'turning' phase the driver steers straight at exitPoint (traffic.ts:216-218; src/world/roads.ts:70-72). Nothing makes a left-turner (ai.next === turnLeft(ai.dir)) give way to oncoming traffic. Nothing stops a right-turner and the opposite left-turner from taking the same exit lane at once. Commit fc8d356 (vehicleObstacles, and the long vehicle keeping its gap from its own nose) fixed queueing within one lane. tests/longVehicles.test.ts covers only a straight-on queue at a fixed red. I ran scratch sims with the real driveAi, stepVehicle and collideVehicles. (a) A bus, fire truck, garbage truck, limo, tow truck or SWAT truck turning left or right past cross-street queues held at red stays at least ~5 m from them, so red-held queues are not clipped. (b) A busy signalled junction with the real 24 s cycle and 4 cars per approach, 80 runs of 60 s. Sedans only: 76 contacts above 1 m/s, every one a left-turner against the opposite approach during the same green (35 left vs straight, 39 left vs right-turner merging into the same exit lane). With a long vehicle added on each approach: ~100 contacts, 36-42 involving the long vehicle, nearly all the same opposite-approach left-turn conflict. Long vehicles make it worse because they turn at 6 m/s (TURN_SPEED) with bodies up to ~12 m, so they sit in the conflict area longer. The 'queued cars' they clip are most likely the opposite queue pulling away on the same green.

**Cause:** Confirmed by code and simulation: driveAi has no right-of-way at junctions, so a left turn never gives way to the opposite approach. Long vehicles occupy the conflict area for longer, which makes it visible, but the gap affects every vehicle. fc8d356 only fixed same-lane queueing.

**Fix:** Add a left-turn yield to driveAi for calm drivers (not panic or urgent). Near the entry waypoint, and until committed, a left-turner checks the obstacle list for vehicle points that are on the opposite approach (lanePoint(ix, iz, reverse(dir), along) for along in about [-30, +ROAD_WIDTH/2]) or inside the junction box, and moving toward or through it. To know that, Obstacle gets vx/vz fields, filled in vehicleObstacles and in main.ts addObstacle (main.ts:545-553); they are zero for people, which are skipped by owner. Stopped vehicles (queued at red, or a waiting opposite left-turner) don't count, which prevents two opposite left-turners waiting on each other forever. Scale the time window by the turner's own clearing time ((2*reach + ROAD_WIDTH) / turnSpeed), so a bus waits for a bigger gap. While waiting, wantSpeed = 0 and the wait counts as `queued`, so the 4 s gridlock breaker (traffic.ts:349-353) doesn't fire. Once committed past the entry, never stop in the box, and clear it on amber or red like a real driver. Police and pursuit controllers don't go through driveAi and are unaffected.

**Risks:** A left-turner facing steady oncoming traffic could wait through a whole green. It then needs the 'clear the junction once committed' rule, or it gets stranded in the box at red and the cross traffic hits it. More waiting could trip isHopeless or recycling, and throughput drops a little. The extra obstacle pass per turning driver costs about the same as one clearDistance call. pursuit.ts and police.ts read Obstacle, so the new fields must be optional.

**Verify:** tests/longVehicles.test.ts: a bus and a fire truck turning left, with an oncoming queue released on the same green, make no contact above 0.5 and complete the turn once clear. tests/signals.test.ts 'traffic and the lights': a sedan's left turn gives way; opposite left-turners both go with no deadlock; a left-turner caught at amber clears the box. Add a Monte Carlo busy-junction test (seed it from the scratch harness junction5.test.ts): contacts drop from ~76 per 80 runs to ~0, and every car gets through within N seconds. Optionally run Playwright at a signalled junction with window.__ub.fastForward to look at buses turning.

**Needs from the user:** Confirm this matches the clipping they saw. The simulation says red-held cross queues are not hit; the contacts are opposite-approach left-turn conflicts. Accept slightly slower junctions (left-turners now wait).

**Also noticed:**

- src/main.ts:642-643 with :783-786: throwRider(a, impact, b === driving) awards HIT & RUN and provokes the rider whenever an NPC bike crashes hard into the player's car, even a stationary one. It has the same cause as the SMASH bug (the player was involved, not who rammed) and should use the same check.
- src/main.ts:645-648: markPlayerHit is applied to both cars in any collision involving the player. If an NPC rear-ends your stopped car and blows up within ATTRIBUTION_SECONDS (src/systems/damage.ts:29), combat.ts:516 counts the blast as yours (blamesPlayer gives byPlayer: wreck frenzy credit and heat). Same pattern again.
- src/game/heat.ts:253-262: any calm civilian in a crash above 6 m/s with the player rolls panic, rage or bail, even when it was the one that drove into your stopped car. A driver who rear-ends you then chasing you with road rage is odd; worth deciding along with the SMASH fix.
- Unsignalled junctions (30% of inner junctions plus the outer ring; src/world/signals.ts:26, 37-40) get no give-way rule either. README says they are 'left to give way', but driveAi does nothing when signals.at returns null, so cross traffic there relies only on the straight-ahead clearDistance. This comes from reading the code; I did not simulate it.
- Bollards (src/world/streetProps.ts:129, 0.28 m) are thinner than the '0.4 m posts' HANDOFF mentions and tunnel more often (~14% of cop-bike nitro hits against ~6% for posts). Police bikes in pursuit at 38 m/s also tunnel occasionally, not just the player.
- Scratch harnesses (vitest, no repo changes): (a throwaway scratch script) and (a throwaway scratch script) Run them with `npx vitest run --config vitest.config.mts --silent=false` from that folder.

**Suggested order:** Do minor-smash first. It is an S change: one pure check in score.ts, a test, and two lines of main.ts. Fold in the same check for HIT & RUN from NPC bikes and the crash-blame flag, because all three share the cause. Next, minor-props as two small commits: the substepped static resolve in physics.ts with a cop-bike physics test, then furniture solid to people (Knockables.collidePed, bench box footprint, main.ts wiring). Both are self-contained and zero-alloc. Leave minor-junction-turns last. It is the only behavioural change with deadlock risk and needs a busy-junction Monte Carlo test, and it should be reframed from 'long vehicles' to 'left turns don't give way', which also fixes sedans. All three are pure logic that can be verified here with vitest; finish with the usual Playwright smoke test (1280x720 and 852x393) before pushing.

## Gaps the old to-do list missed

### pwa-stale-glb: Installed copies of the game never pick up changed GLB art (the service worker precaches them with revision: null) [S, cloud]

**Findings:** vite-plugin-pwa's default `dontCacheBustURLsMatching` is `^assets/` (node_modules/vite-plugin-pwa/dist/index.js:830). It assumes every file in Vite's assetsDir has a hashed name. The Blender GLBs are copied unhashed from public/assets/ into dist/assets/, so the generated sw.js lists every one with `revision: null` (assets/vehicles.glb, props.glb, weapons.glb, heli.glb and the rest). I proved it in a Playwright run against a scratch build served at /curbside/. Steps: install the service worker. Ship a 'new deploy' where only sw.js and vehicles.glb change. Update, then post SKIP_WAITING. Result: the precache still holds the old 682,700-byte vehicles.glb, and `fetch('assets/vehicles.glb')` from the page returns the old bytes, not the new 682,718. Scripts: (a throwaway scratch script) and (a throwaway scratch script) vite.config.ts:29 `includeAssets` also overlaps `globPatterns` (vite.config.ts:46), so the 4 icons are precached twice: 29 manifest entries, 25 unique.

**Cause:** Confirmed. Workbox uses the bare URL as the cache key when `revision` is null. A GLB rebuilt under the same name has the same key, so a new service worker sees it as already cached and never downloads it again. JS and CSS are fine because their names are hashed.

**Fix:** In vite.config.ts `workbox`, set `dontCacheBustURLsMatching: /^assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|css)$/` so only hashed bundles skip revisioning and the GLBs get md5 revisions. Drop `includeAssets` (globPatterns already covers the icons) or narrow it. Expect a one-time ~2.8 MB GLB re-download for existing installs on the first deploy with the fix. Add a short why-comment.

**Risks:** If the regex is wrong, hashed bundles get revisioned too. That is harmless, just an extra query param. Check that sw.js shows md5 revisions for *.glb and null for index-*.js and three-*.js.

**Verify:** Build to a scratch outDir and grep sw.js for `assets/vehicles.glb",revision:"<md5>"`. Rerun the scratch pwa.cjs flow (v1 to v2 with a changed vehicles.glb). The cached and fetched byte count should now equal v2.

**Needs from the user:** Ship this before the Blender adjustment pass (to-do #3). Otherwise the iPhone home-screen app will keep showing the old guns, helicopter and so on after the art is fixed.

### m8-closeout: Close out M8's remaining done-when checks and replace the obsolete 'Lighthouse PWA pass' [S, cloud]

**Findings:** docs/PLAN.md:145 says M8 is done when we have: icons, offline caching verified, install prompt, Lighthouse PWA pass, performance pass on real devices, and deploy. PLAN.md:21 and README.md (M8 Ship) only track the real-device pass, which is to-do #1. Status of each:
- Deploy: done. `gh run list` shows the last two Pages runs succeeded.
- Offline caching: now verified here. A scratch build at /curbside/ was installed, then the context went offline and reloaded. It booted in about 20 s on SwiftShader with zero console or page errors, startGame() ran, and the screenshot shows the GLB models loaded ((a throwaway scratch script)).
- Install: CDP `Page.getInstallabilityErrors` returns [] and the manifest has no errors, so Chrome can install it. iOS gets an Add-to-Home-Screen tip (src/ui/titleScreen.ts:187-201). There is no `beforeinstallprompt` handling for an in-game Install button on Android or desktop, so those players rely on the browser's own UI.
- Lighthouse: not in node_modules or installed globally. Fetching it with `npx -y lighthouse` was denied by this session's permission policy. Lighthouse 12+ (latest 13.6.0) also no longer has a PWA category, so the criterion can't be met as written.
- Icons: present (192, 512, maskable, svg) but they are M0 placeholders (see icons-splash).

**Cause:** The PLAN's M8 criteria predate the overhaul, and the handoff only carried over the real-device item. Lighthouse dropped its PWA audits in v12.

**Fix:** Update docs/PLAN.md M8 (row 21 and the done-when at 145): mark offline and install as verified, and replace 'Lighthouse PWA pass' with the scripted checks: CDP installability, offline reload, and the update-delivers-new-GLB check from pwa-stale-glb. Make those checks part of the committed smoke script (see smoke-ci). Optionally add a small Install button driven by `beforeinstallprompt` on the pause or title screen for Android and desktop. M8 is then done once to-do #1 (real-device pass) is.

**Risks:** Doc-only, apart from the optional button.

**Verify:** Rerun (a throwaway scratch script) and pwa.cjs against a /curbside/ build. The final iOS install check is part of to-do #1.

**Needs from the user:** Decide whether an Android/desktop Install button is wanted. If you still want a Lighthouse report for accessibility or best practices, allow `npx lighthouse` (it downloads to the npx cache, not the repo). Its performance score is meaningless on SwiftShader anyway.

### settings-bricks-boot: An unknown stored setting crashes the game at boot, with no recovery [S, cloud]

**Findings:** src/core/settings.ts:43 spreads `JSON.parse(localStorage['curbside.settings'])` over the defaults without checking any values. src/render/quality.ts:99 then runs `QUALITY_TIERS[tierForPreset(settings.quality, device)]`, and tierForPreset (quality.ts:91-94) passes any non-'auto' string straight through. I confirmed this in Playwright: with `{"quality":"ultra"}` stored, the page throws `Cannot read properties of undefined (reading 'maxPixelRatio')`, `__ub` never appears, and the screen stays black. On an iPhone home-screen app the only fix is deleting the app, which also wipes the save. The save module guards against exactly this case (progressSave.ts migrateSave mentions 'an older build (a second tab, a PWA before its update applies)'); settings don't. tests/ has no settings test.

**Cause:** Confirmed. Settings load with no per-field validation. Any rename or removal of a preset or steering value in a later build, a newer tab writing a value an older PWA doesn't know, or a hand edit makes `current` undefined at module init.

**Fix:** Add a pure `sanitizeSettings(raw: unknown): Settings` in src/core/settings.ts:
- volumes: finite numbers clamped to 0..1
- quality and steering: must be in their allowed lists
- the rest: booleans
- anything else: falls back to its default
Use it in load(). Also make tierForPreset fall back to the auto tier for unknown names. Add tests/settings.test.ts. Optionally carry unknown keys through, as the save does.

**Risks:** Low. Make sure a sanitised object still writes back compatibly, so an older build doesn't drop a newer build's keys.

**Verify:** Unit tests for garbage, null, wrong types and unknown enum values. Rerun (a throwaway scratch script) and expect `__ub` present with no page errors.

### update-reloads-midrun: A downloaded app update reloads mid-run (after a bust, or on any app switch) and throws away the current run [S, cloud]

**Findings:** src/core/updateGate.ts:1-8 says an update waits until 'reloading can't cost the player anything'. But main.ts:1180-1190 calls `updates.atSafePoint()` on every `visibilitychange` to hidden during play, and main.ts:531-538 `releasePlayer()` calls it after a BUST. After a bust the run continues: `score.resetRun()` only runs in respawnPlayer, main.ts:511-512. Persistent progress is flushed first (the pause event and progressDirector.ts:157-163), but the run's score, unbanked chain, wanted level, current car and any active activity are lost. On a phone: launch, the update downloads in the background, glance at a notification, come back to the title screen.

**Cause:** Confirmed from the code. 'Page hidden' and 'released after a bust' are treated as safe points even when a run is in progress. Whether the README's 'App updates wait for respawn, the page being hidden...' is the intended trade-off is a design decision.

**Fix:** On visibilitychange, apply only when `frontDoor.inTitle`, or when the page comes back after a long absence (for example hidden for 10+ minutes). Remove the call from releasePlayer, or apply there only if the run's score is 0. Respawn after WASTED, the title screen, and the pause screen's 'restart now' remain safe points. Update the UpdateGate doc comment and README Status line 121.

**Risks:** Updates take longer to land on devices that are never backgrounded long or never die. The pause-screen 'restart now' still covers that.

**Verify:** Playwright: stub `updates.markReady()` via __ub, start a run, fastForward, dispatch visibilitychange with document.hidden mocked, and assert no reload happened (simTime keeps going, score kept). Unit-test any new timing logic in UpdateGate.

**Needs from the user:** Confirm the intended behaviour. This matters most during to-do #1 and #2, when you'll deploy often and play on the phone.

### smoke-ci: No committed browser smoke test, and CI only tests on push to main [M, cloud]

**Findings:** CLAUDE.md asks for Playwright + SwiftShader checks at 1280×720 and 852×393/852×340 before every push, but no script exists in the repo: tools/ only has make-icons.mjs and drive-snapshot.py, and there's no e2e folder. So each session rewrites the harness. .github/workflows/pages.yml runs only `on: push: [main]` plus workflow_dispatch: no pull_request trigger, so stream or feature branches get no CI before merging. blender/check_assets.py (contracts currently pass: 'all contracts OK') isn't run in CI either. The biggest untested modules are the wiring around the unit-tested logic: main.ts (1284 lines), progressDirector.ts (598), modes/missionMode.ts (721), chaosRunMode.ts (283), taxiMode.ts (255), frenzyMode.ts (207), heatPresenter.ts (196), plus core/settings.ts. A boot-time wiring crash would pass `npm test` and deploy.

**Cause:** Confirmed. The overhaul's Playwright checks were ad hoc and never committed. The Pages workflow is deploy-only.

**Fix:** Commit tools/smoke.mjs (Playwright, SwiftShader flags) that:
- builds with CURBSIDE_BASE=/curbside/ and serves it
- checks desktop and iPhone viewports
- fails on any page error
- runs startGame(), fastForward(30), and asserts draw calls under 150 on the 'medium' tier
- runs the offline, installability and GLB-update checks from m8-closeout
Add a ci.yml for pull_request and non-main pushes: npm ci, tsc, vitest, `python3 blender/check_assets.py public/assets`, and optionally the smoke test with `npx playwright install chromium`. Keep pages.yml as is or have it reuse ci.yml.

**Risks:** SwiftShader in CI is slow (~1 fps), so keep the smoke test on fastForward and draw-call counts, never frame timing. Flaky timeouts if it waits on rendered frames.

**Verify:** Run tools/smoke.mjs locally against the current build (it should pass). Break a wiring line in a scratch copy and confirm it fails. Watch the first ci.yml run on a test branch.

**Needs from the user:** Decide whether Playwright becomes a devDependency (it adds CI time and a browser download) or the smoke test stays local-only, run from the global Playwright install.

### repo-hygiene: Clean up 12 worktrees, 15 merged branches, a stale local main and the stale dist/ [S, cloud]

**Findings:** Every branch is merged into origin/main (`git branch -a --no-merged origin/main` is empty).
- Worktrees: `git worktree list` shows 12 at /home/user/cs-{assets,audio,core,feel,fx,heat,look,people,play,qa,ui,world}, each holding a stage*/ branch. All are clean with no stashes. They block `git branch -d` until removed.
- Remote branches: origin has 15 (`gh api .../branches`): main, claude/game-overhaul, blender/assets and 12 stage*/.
- Local main: at 40074a4, 194 commits behind origin/main (00c4d65). The checkout is on claude/game-overhaul, which equals origin/main, so a fresh `git checkout main` here would land on the old M5 game.
- dist/: ignored, not tracked (.gitignore:2), but stale. It was built at 20:32, before the stage6 merge, and only has player.glb and vehicles.glb plus a 513 kB main chunk, so `vite preview` would serve an old game.
- Docs: README.md:20 `npm test # vitest (physics, loop)` is out of date (there are 59 test files, 606 tests, all passing). The vite.config.ts:16 comment says three.js is ~540 kB / 137 kB gzip; it is now 634 kB / 159 kB.

**Cause:** Confirmed. Worktree-per-stream workflow leftovers. HANDOFF.md:19-22 says the branches can be deleted but nobody did.

**Fix:** 1. `git worktree remove` each /home/user/cs-*.
2. `git branch -d` the 12 stage*/ branches.
3. `git push origin --delete` the 12 stage*/ branches and blender/assets.
4. `git checkout main && git merge --ff-only origin/main`, then decide whether to keep claude/game-overhaul.
5. `rm -rf dist`.
6. Fix the two stale doc and comment lines.
7. Update HANDOFF 'Branches'.

**Risks:** Low: everything is merged. Note the branch tips first (`git branch -av > /tmp/...`) in case one is wanted later.

**Verify:** `git worktree list` shows one entry, `git branch -a` shows main (plus any kept branch), `gh api repos/pydron-bot/curbside/branches` matches, and `git rev-parse main origin/main` agree.

**Needs from the user:** OK to delete remote branches on pydron-bot/curbside (it needs a push and can't be undone without the SHAs). Say whether claude/game-overhaul should go too, and whether the hive1 checkout (~/dev/curbside) has its own worktrees to clean.

### shared-origin-landing: To-do #4 (deeek.org landing page) shares an origin with Curbside, which needs a few constraints [S, cloud]

**Findings:** Curbside is served at deeek.org/curbside/, the same origin as the user site and every other deeek.org/<repo>/. localStorage (curbside.save, curbside.settings, curbside.best, curbside.station, curbside.a2hsTip), Cache Storage, the storage quota and `navigator.storage.persist()` (titleScreen.ts enterGameMode) are all per-origin and therefore shared. Curbside's service worker scope is /curbside/ (generated manifest `scope:"/curbside/"`). Before it installs, though, a root-scoped service worker from the landing page would control /curbside/ navigations, and a navigateFallback there would serve the landing page instead of the game. /home/user/pydron-bot.github.io currently has a plain index.html with no service worker or storage use. HANDOFF.md:81-84 says none of this.

**Cause:** Confirmed by the architecture (GitHub Pages project sites under a user-site custom domain share one origin). Nothing is broken today; it's a trap for the next task.

**Fix:** Add a short 'same origin' note to HANDOFF #4 and the pydron-bot.github.io README:
- the landing page registers no service worker, or only one with a narrow scope and no navigateFallback
- it never calls localStorage.clear() or caches.delete() broadly
- other projects prefix their storage keys
Optionally move Curbside to its own subdomain later (curbside.deeek.org) if isolation matters, but that would orphan existing saves.

**Risks:** None (docs). Moving to a subdomain would lose current localStorage saves.

**Verify:** After the landing page ships, load /curbside/ in a fresh Playwright profile and then offline. Curbside's service worker should control the page, and `caches.keys()` should show only scoped workbox caches.

**Needs from the user:** Whether any future deeek.org project will be a PWA (which would make scoping matter more).

### icons-splash: The home-screen icon is still the M0 placeholder; check iOS launch screen and manifest polish [S, cloud]

**Findings:** public/icons/icon-512.png is a flat procedural crossroads with a red box, made by tools/make-icons.mjs back at M0. icon-192.png is 892 bytes. index.html:13 uses icon-192.png as the apple-touch-icon (iOS wants 180×180 and scales the rest). There are no `apple-touch-startup-image` links. What iOS 17/18 shows on launch without them (blank screen vs background_color) is unconfirmed. The manifest has no `id` and no `screenshots` (Chrome's richer install sheet on Android and desktop uses screenshots). These are not install blockers: CDP reports no installability errors.

**Cause:** Placeholder art never revisited once the overhaul's look and Blender assets landed.

**Fix:** Render a new icon from the game itself: a Playwright top-down screenshot of a car at the night look, cropped, with a maskable variant that has a safe zone. Alternatively, extend tools/make-icons.mjs. Add a 180×180 apple-touch-icon, `id: '/curbside/'`, and 1-2 landscape `screenshots` to the manifest. Decide on iOS startup images after seeing the launch on the device during to-do #1.

**Risks:** Changing `id` later would make Chrome treat it as a different app, so set it once and keep it.

**Verify:** Build, check that the manifest icons resolve under /curbside/, CDP installability shows no errors, and look at the icon on the home screen during to-do #1.

**Needs from the user:** Art approval. Note what the iPhone shows at launch during the real-device pass.

**Also noticed:**

- Build is clean: `npx tsc --noEmit` exits 0 and `CURBSIDE_BASE=/curbside/ npx vite build` reports no warnings. index-*.js is 591.6 kB (205.8 kB gzip), three-*.js 633.9 kB (159.3 kB gzip), CSS 59.3 kB (14.2 kB gzip). Precache is 29 entries (25 unique) and 3,925 KiB, of which about 2.7 MB is GLBs. Both chunks are under the 800 kB warning limit (vite.config.ts:20); the game chunk is at 74% of it. That's fine for iPhone load and well under PLAN's 30 MB budget. Log: (a throwaway scratch script)
- `npx vitest run`: 59 files, 606 tests, all pass in ~5 s, matching HANDOFF.md:61.
- src/render/worldProps.ts:119 loads props.glb, pickups.glb and debris.glb with one Promise.all (propModels.ts:120). If one fails (even the 23 KB debris.glb), none of the props, landmarks or pickups models load. Every GLB load (main.ts:226, heliModel.ts:71, heldWeapons.ts:83, characterModel.ts:145, pigeonMesh.ts:132) only logs console.error and keeps the placeholder for the whole session, with no retry. A blip on the first, pre-precache visit leaves boxes until the next launch. Low risk once the service worker is installed.
- A Workbox update is only checked on navigation: main.ts:1148 `registerSW({ immediate: true, ... })` has no `onRegisteredSW` periodic `r.update()`. A home-screen app that is resumed rather than relaunched won't see new deploys until iOS kills and relaunches it. Unconfirmed how often that happens on the device.
- window.__ub (main.ts:1226-1284) is exposed in production builds, including fastForward, setPaused and every system. That's fine for a single-player static game, but it is an easy cheat hook if an online leaderboard (HANDOFF idea #6) ever happens.
- The save lives only in localStorage (progressSave.ts) and there is no export or import. Played in a Safari tab rather than from the home screen, WebKit's storage policies could evict it after weeks without a visit. Unconfirmed: check what `navigator.storage.persist()` returns on the iPhone during to-do #1.
- README.md:20 and vite.config.ts:16 have stale comments (test scope; three.js size). Both are folded into repo-hygiene.
- The Pages deploy itself is healthy (last two runs succeeded: 51 s and 4 m). deeek.org isn't reachable from this container (proxy 403), and the repo's Pages and environment API endpoints are blocked by the proxy, so the live site and the 'Review deployments' gate couldn't be checked from here.

**Suggested order:** Do pwa-stale-glb first, before any Blender adjustment pass (to-do #3) ships. Otherwise the iPhone home-screen app keeps the old art and the real-device pass checks stale assets. Batch it with settings-bricks-boot and update-reloads-midrun: three small fixes, all verifiable here with the scratch Playwright scripts, that remove ways a deploy can strand or annoy the one real player. Then do repo-hygiene and m8-closeout together (docs plus branch cleanup, after you approve remote deletes), and build smoke-ci so to-do #1 and #2 tuning deploys get checked automatically. Leave shared-origin-landing as a note on to-do #4, and do icons-splash during the real-device pass, when the launch screen can actually be seen.

## 1. Real-device pass: diagnostics to build first

### perf-overlay: Frame-time stats collector and a fuller perf overlay (also fixes the stale or 0 fps readout) [M, cloud]

**Findings:** What exists today: Settings > Show FPS (settings.ts:23,35; settingsPanel.ts:100) or `?debug` (hud.ts:118,186-188) shows one `.hud-debug` line, polled 4 times a second (hud.ts:272-275). Its text comes from main.ts:1039: `resolution.summary() · W×H · N dc`. summary() (dynamicResolution.ts:343-348) gives the fps from ResolutionController.lastInterval plus pixel ratio, tier and ' capped'. Draw calls are counted over the whole frame, which is correct (look.ts:106,155).

The fps number is only written in judgeWindow (dynamicResolution.ts:218). That runs after the 3 s warmup, and only once a full 1 s window has passed. Any frame over 200 ms (STALL_MS) calls holdOff(1) and throws the window away (dynamicResolution.ts:183-185). The value is also a 5% trimmed mean (dynamicResolution.ts:210).

Confirmed in a headless run (852×393 @3x, iPhone UA, ?debug, on foot and in a car): the line read `0 fps · 1.50x medium · 852×393 · 42 dc` the whole time. The overlay never shows hitches, percentiles, JS time per frame, the detected refresh rate (controller.refreshInterval exists, dynamicResolution.ts:122, but DynamicResolution keeps the controller private), the ladder level i/n, drop or raise history, triangles, or geometry/texture/program counts. The line is also hidden outside the play scene (hud.css:21-25).

**Cause:** Confirmed: the overlay reuses the resolution controller's judged-window mean. By design that mean leaves out warmup, stalls and outliers, so it can't show jank, and it reads 0 or a stale value whenever windows aren't being judged.

**Fix:** 1. Add a pure module, src/core/frameStats.ts. It keeps preallocated Float32Array rings: about 600 frame intervals and 600 JS-ms values. sample(intervalMs, jsMs) records a frame. summarize(out) fills a reused object with: fps over the last 1 s; p50, p95, p99 and max over about 10 s (copy and sort into a preallocated scratch array, at most 4 times a second); and hitch counts per minute above 50 ms and above 100 ms. No allocation.
2. In frame() (main.ts:841), take `t0 = performance.now()` at the top and call `frameStats.sample(elapsed*1000, performance.now()-t0)` next to resolution.sample (main.ts:975).
3. Add DynamicResolution.state(): level, ladder length, refresh Hz, last verdict, drop and raise counters.
4. A 'full' overlay mode shows three short lines, placed top-centre beside the pause button. Bottom centre (where the line sits now) is under the tutorial card and between the stick and the pedals (scratchpad car.png). The lines:
   - fps, p50/p95/p99/max ms, hitches per minute, JS p95
   - tier, ratio, level i/n, verdict, refresh Hz
   - draw calls, triangles, geometries/textures/programs
   When the steady refresh is about 33 ms, label it '30 Hz (Low Power Mode?)', because Safari throttles rAF in Low Power Mode.
5. Keep the existing one-line mode, built from the new stats instead of lastInterval.

**Risks:** The overlay must cost nothing when off, and stay allocation-free when on. DOM text writes stay at 4 Hz through textSetter, and the sort runs at most 4 times a second. Measuring perturbs results slightly; keep the JS-ms timing to two performance.now() calls. Safari coarsens performance.now() to about 1 ms, which is fine for percentiles.

**Verify:** - Add tests/frameStats.test.ts covering percentiles, ring wrap, hitch counting, and a steady 33 ms run being flagged as a 30 Hz cap.
- Playwright at 852×393 @3x (also 852×340) and 1280×720 with ?debug:
  - the overlay text matches the expected regex;
  - under SwiftShader it now shows about 1 fps with large p95, not '0 fps';
  - its bounding box doesn't intersect .pedal-pad, .stick-base, .hud-pause or #score;
  - renderer.info.render.calls is unchanged with the overlay on vs off.

### diag-report: Session perf log (persisted) and a Diagnostics sheet with Share/Copy report [M, cloud]

**Findings:** - Nothing records performance over time, and there's no export. The diagnostics that do exist can only be reached from a desktop console: window.__ub (main.ts:1226-1284) and audio.debug (gameAudio.ts:525). An iPhone tester can't read them without a Mac and Web Inspector.
- Nothing measures thermal behaviour.
- Nothing notices an iOS memory kill: the WebContent process is killed and the page silently reloads.
- Context loss is handled (main.ts:1190-1222) but not counted.
- Audio state changes, including 'interrupted' from calls or Siri, are handled (gameAudio.ts:611-616) but not logged.
- The infrastructure for a sheet is already there: overlay() (menu.ts:154), the Panel interface (menu.ts:166), FrontDoor.openPanel (frontDoor.ts:144) and PauseOverlay.addButton (pauseOverlay.ts:131). ProgressDirector already plugs PROGRESS and SHOP in this way (progressDirector.ts:141-142).

**Cause:** Missing feature. The current tools assume a desktop console. Unconfirmed but likely: WebKit has no thermal or compute-pressure API, so throttling can only be inferred from frame times over time.

**Fix:** 1. Add src/core/sessionLog.ts (pure). Every 10 s it appends {t, fps, p50, p95, p99, jsP95, hitches, tier, ratio, level, verdict, dc, tris, audioState, device, paused} to a 360-entry ring. It also keeps an event list with timestamps:
   - tier and ratio changes (hook DynamicResolution.apply);
   - webglcontextlost and webglcontextrestored;
   - audio statechange (add an onStateChange listener API to GameAudio);
   - visibility and pause;
   - gamepad connect.
2. Persist the log to localStorage 'curbside.diag' every 30 s and on pagehide / visibility hidden, inside try/catch.
3. Boot marker: set 'curbside.diag.alive' on boot and clear it on pagehide. If it's present at the next boot, flag 'previous session ended without pagehide (possible memory kill)'. Caveat: a force-quit from the app switcher can also skip pagehide.
4. Static snapshot for the report:
   - build id, UA, standalone (navigator.standalone or display-mode), dpr, screen, inner size, visualViewport, safeInsets();
   - WebGL2, MAX_TEXTURE_SIZE, MSAA samples, unmasked renderer;
   - settings, quality preset and ladder;
   - a subset of audio.debug, navigator.audioSession?.type, ctx.sampleRate, baseLatency and outputLatency;
   - gamepad id, mapping, axes and buttons, and whether vibrationActuator exists;
   - wake lock state, and whether the haptic switch exists.
5. Add src/ui/diagnosticsSheet.ts, a ui-sheet panel showing:
   - a summary and per-10 s fps/p95 and level sparklines on a 2D canvas (not WebGL);
   - SHARE (navigator.share({title,text}) opens the iOS share sheet: Notes, Messages, AirDrop);
   - COPY (navigator.clipboard.writeText inside the click);
   - a fallback selectable <textarea>;
   - 'previous session' to share the last persisted log.
6. Thermal is inferred: p50 rising at a fixed level, or tier drops after several minutes of steady play, suggest throttling.

**Risks:** - localStorage writes must be throttled and wrapped in try/catch (Private mode, quota).
- The log must not grow without bound (fixed ring).
- navigator.share and clipboard need transient activation, so call them directly in the click handler.
- A JSON report of a few tens of KB is fine for share and clipboard.
- The diag code must stay out of hot paths: it samples every 10 s.

**Verify:** - Unit tests for sessionLog: ring wrap, event capping, serialisation, and alive-marker logic with fake storage.
- Playwright (Chromium with clipboard-read/write granted):
  - pause, open DIAGNOSTICS, click COPY, read the clipboard JSON and check the required fields;
  - fastForward, reload the page, check the previous-session log is offered and the alive flag reports correctly;
  - mock navigator.share and check it receives the text.
- Screenshot the sheet at 852×340 so it scrolls rather than clips.

### overlay-in-app: Make the overlay and diagnostics reachable in the home-screen app (Settings choice and a pause-menu button) [S, cloud]

**Findings:** `?debug` is read once from location.search (hud.ts:118). The installed app launches its manifest start_url '.' (vite.config.ts manifest), so there's no way to pass the flag there. The only in-app switch is the boolean Show FPS toggle (settingsPanel.ts:100; settings.ts:23), which gives the single line. The Settings sheet already scrolls at 852×340 (HANDOFF known issue), so adding rows makes that worse.

**Cause:** The debug switch was designed for desktop URLs. Settings has no tri-state for the overlay.

**Fix:** - Replace the showFps toggle with a choice row, 'Perf overlay: Off / FPS / Full'. In settings.ts add perfOverlay: 'off' | 'fps' | 'full', defaulting to 'off'. In load(), migrate a legacy showFps:true to 'fps'. Extend ChoiceKey in settingsPanel.ts:8.
- `?debug` forces 'full' for the session without persisting it.
- When the overlay isn't Off, show a DIAGNOSTICS button added with frontDoor.pause.addButton (pauseOverlay.ts:131) that opens the sheet with frontDoor.openPanel (frontDoor.ts:144). Hidden buttons are skipped by MenuNav.
- Batch this with diag-report.

**Risks:** - The settings migration must keep existing players' choice.
- Keep the same number of rows so the 852×340 sheet doesn't grow.
- Extending a ChoiceKey with a third string type is straightforward.

**Verify:** - Unit test settings load() migration (showFps:true becomes 'fps').
- Playwright: switch the row to Full, check the overlay appears and the DIAGNOSTICS button shows in the pause grid with keyboard/pad navigation reaching it; Off hides both.
- Screenshot at 852×340.

### build-stamp: Show a build id (commit and date) in Settings, the pause card and the report [S, cloud]

**Findings:** No version or commit is shown anywhere. package.json's version 0.1.0 is unused, and there's no `define` or import.meta.env build id. The PWA uses registerType 'prompt' (vite.config.ts:24-28) and UpdateGate defers reloads (main.ts:1140-1148). The installed app also has its own storage and service worker. So the phone can easily be running an older build than the one just pushed, and the tester can't tell.

**Cause:** Missing feature, which matters because of the deliberate update deferral.

**Fix:** - In vite.config.ts, add `define: { __BUILD__: JSON.stringify(`${(process.env.GITHUB_SHA ?? <git rev-parse --short HEAD via execSync, try/catch> ?? 'dev').slice(0,7)} ${new Date().toISOString().slice(0,16)}Z`) }`. The Pages workflow (.github/workflows/pages.yml) runs on Actions, so GITHUB_SHA is set.
- Declare `__BUILD__` in a .d.ts.
- Render it in small type in the settings sheet footer and under PAUSED, and put it in the diagnostics report.

**Risks:** Vitest shares the Vite config, so define applies in tests too. Guard with `typeof __BUILD__ !== 'undefined'` if any module is imported outside Vite. Keep execSync failure-tolerant (no git in some environments).

**Verify:** - Run `GITHUB_SHA=abc1234def CURBSIDE_BASE=/curbside/ npx vite build` (in a scratch copy or worktree, not the tracked dist) and grep the output for abc1234.
- npm test still passes.
- Playwright: the stamp is visible in Settings and on the pause card.

### wake-lock: Keep the screen awake while playing (Screen Wake Lock) [S, cloud]

**Findings:** Nothing uses the Screen Wake Lock API (grep for wakeLock in src: no hits). Touches reset iOS's auto-lock timer, but some play may not:
- a Bluetooth-controller-only session (unconfirmed whether gamepad input resets the idle timer for Safari pages);
- a long phone-call card, or hands-off moments.
The screen then dims and locks at Auto-Lock (often 30 s). Locking hides the page, which pauses the game (main.ts:1176-1186), suspends audio, and can drop the GL context. Safari has navigator.wakeLock since 16.4, but reports say it didn't work in home-screen web apps before iOS 18.4 (unconfirmed). Headless Chromium exposes navigator.wakeLock, so it can be exercised here.

**Cause:** Missing feature.

**Fix:** - Add src/ui/wakeLock.ts with a class ScreenAwake and a method set(want: boolean).
- When want is true and document.visibilityState is 'visible', request('screen') and keep the sentinel. Release it otherwise.
- Request again on visibilitychange to visible, and on the sentinel's 'release' event if still wanted. Feature-detect and wrap everything in try/catch.
- Wiring in main.ts: want = playing && !paused. set(true) in startGame (inside the PLAY gesture), set(!p) in setPaused, set(false) in enterTitle.
- Report the state in diagnostics: supported, active, last error.

**Risks:** - Battery drain if it's held on the title or pause menu, so only hold it during active play.
- On older iOS in standalone mode it may silently fail, so log it rather than assume.
- Make sure release and request don't leak sentinels on rapid pause/resume.

**Verify:** - Unit test with a mocked navigator.wakeLock and document.visibilityState: requested on play, released on pause and title, requested again on visible, and a single sentinel across rapid toggles.
- Playwright Chromium: after startGame the sentinel is active (expose it through __ub); after pause it's released.
- Device: Auto-Lock 30 s, play 60 s with the controller only (in the checklist).

### input-probes: On-device probes: iOS haptic switch, gamepad rumble and a live pad readout (in the Diagnostics sheet) [S, cloud]

**Findings:** iPhone haptics rely on the iOS 18 `<input type=checkbox switch>` toggle trick (haptics.ts:1-12,115-127; kept rendered off-screen by tokens.css:43-53). The tick is fired with label.click() from:
- pointerdown/pointerup capture handlers on the touch layer (touchControls.ts:128);
- press handlers (touchControls.ts:390,426,433; carButtons.ts:39,47).

None of this has run on hardware. Unknowns:
(a) Does a click from a touch pointerdown count? In the HTML spec, touch activation comes from pointerup/touchend; WebKit's behaviour for this trick is unconfirmed. If it doesn't, every press tick (pedals, FIRE, ENTER/EXIT, NOS) is silently lost.
(b) Is a gesture needed at all? If not, the 220 ms queue (haptics.ts:18,61-68) could fire crash ticks immediately.

Event ticks (crash, explosion, hurt) only play if a finger goes down or up within 220 ms. With both thumbs held while driving they'll mostly be dropped.

Rumble uses pad.vibrationActuator.playEffect('dual-rumble') (haptics.ts:82-98). Support in iOS Safari is unconfirmed, and failures are swallowed (.catch(() => {})).

There's no pad readout. firstPad() takes the first connected pad without checking mapping === 'standard' (input.ts:631-636), and button indices assume the standard mapping (input.ts:103-119).

**Cause:** The iOS haptic path and rumble support can't be verified without hardware. The code fails silently by design, so a device session can't tell 'unsupported' from 'broken' without probes.

**Fix:** 1. Add a HAPTICS row to the Diagnostics sheet with four test pads. Each fires the switch from a different trigger:
   - on touch pointerdown;
   - on pointerup;
   - on click;
   - from a 500 ms setTimeout (no gesture).
   Each calls a new Haptics.probeTick() that bypasses the rate limit, and a counter of the switch's 'change' events proves the toggle ran.
2. A RUMBLE button that calls playEffect and prints the resolved value or the error text, or 'no vibrationActuator'.
3. A live pad line while the sheet is open (pollGamepad already runs while paused, main.ts:854): id, mapping, axes count, pressed button indices, LT/RT values.
4. Count haptic ticks queued, delivered and expired into the session log, so a play session shows how many event ticks were lost.

**Risks:** - Synthetic label clicks bubble: harmless today (no document-level click handlers), but keep the probes inside the sheet.
- probeTick must respect the Vibration setting only where it makes sense; probes can ignore it so a disabled setting isn't mistaken for no support.

**Verify:** - Playwright with an iPhone UA (the haptic switch exists, as confirmed in the probe run): each probe increments the switch's change counter.
- RUMBLE with no pad prints 'no gamepad'.
- Mock navigator.getGamepads to check the readout text.
- The real verification is on the device (checklist section D/E).

**Needs from the user:** The answers (which probes buzz, the rumble result, the pad mapping) can only come from the iPhone and a controller during the device session.

### touch-tuning: Optional: live touch-tuning panel so the feel can be tuned on the phone without redeploying [M, cloud]

**Findings:** The touch-feel numbers are module constants:
- touchControls.ts:33-47: STICK_R 58, STEER_DZ 0.08, STEER_EXPO 1.5, DRIVE_DZ 0.1, DRIVE_EXPO 1.15, WALK_DZ, AIM_DZ 0.14, AIM_R 52, TAP_MS, TAP_PX;
- pedalZones.ts:28,53-54: PEDAL_REACH 1.45, CHORD_INTO_HAND, CHORD_INTO_GAS;
- steering.ts:36-71: point-to-steer DIRECTIONAL gain 2.2, deadzone 0.1, lift, corner, brake and reverse parameters, declared `as const`;
- touch.css: pedal and button sizes.
Each tuning round today means edit, push to main, Pages deploy (tests and build), then waiting out the PWA update deferral on the phone.

**Cause:** The values are compile-time constants, which is fine for shipping but slow for tuning on a device.

**Fix:** - Add src/core/touchTuning.ts (pure): a mutable object whose defaults are the current constants, with clamped ranges, persisted to localStorage 'curbside.tune', and read at use time.
- touchControls.ts, pedalsAt and directionalControls read from it. Pedal scale goes through a CSS variable (--pedal-scale) on .pedal-pad.
- Add a TOUCH TUNING section to the Diagnostics sheet: −/+ steppers for about 8 key values (stick radius, steer deadzone and expo, directional gain and deadzone, pedal reach, pedal scale, aim deadzone), plus RESET.
- Put the values in the report, so the chosen numbers can then be baked in as new defaults.
- Only active when the perf overlay isn't Off.

**Risks:** - Removing `as const` from DIRECTIONAL loosens its types.
- Tests that import PEDAL_REACH (tests/pedalZones.test.ts:2,54) and the steering defaults must keep passing.
- A bad persisted value could make the controls unusable, so clamp every value, provide RESET, and ignore tuning when diagnostics are off.
- Read the values without per-frame allocation.

**Verify:** - Unit tests: pedalsAt with a custom reach; clamping; persistence round-trip; defaults equal today's constants (no behaviour change when untouched).
- Playwright at 852×393: change the stick radius and pedal scale, then check the .stick-base size and pedal bounding boxes change, and reload keeps them.
- npm test passes.

**Needs from the user:** Decide whether you want this before the device session. It turns 'touch feel' notes into concrete numbers but costs a few hours. Without it, tuning goes round deploys.

### device-checklist: The iPhone 15 Pro device session: steps and what to record [M, you]

**Findings:** Nothing has run on real hardware (HANDOFF.md 'To do' #1). The numbers so far come from headless SwiftShader: 38-56 draw calls on the medium tier, no real fps. iOS behaviour that only a device can confirm:
- Safari's rAF cap (60 Hz on ProMotion by default, about 30 Hz in Low Power Mode);
- thermal throttling over 10-20 minutes;
- silent switch vs navigator.audioSession 'playback' (gameAudio.ts:149-159, mix.ts:145-154, default ignoreSilentSwitch true at settings.ts:30), and that 'playback' stops the player's own music app;
- audio recovery after a call or Siri;
- the iOS 18 switch haptic and whether press ticks fire;
- gamepad mapping and rumble;
- Safari's toolbar and edge swipes vs the stick;
- separate storage for the home-screen app.

**Cause:** No hardware in the loop yet.

**Fix:** Ship the diagnostics items first, then run this session (about 1.5-2 h).

PREP:
1. In Settings or on the pause card, check the build id matches the latest commit. If not, background the app to take the update.
2. Record: iOS version, battery %, Low Power Mode (OFF for the main run), brightness (~50%), not charging, in a case or not, room temperature. Set Auto-Lock to 30 s. Turn on Settings > Sounds & Haptics > System Haptics.
3. In the game: Graphics Auto, Perf overlay Full.

A. SAFARI TAB:
1. Cold load, timing how long until the title appears.
2. First tap on the title: does music start?
3. Silent switch ON with 'Sound with silent switch on' ON, then OFF: record whether you hear sound each time.
4. Start Apple Music or Spotify first, then tap in: does it stop? Set Master to 0: does it come back?
5. Play 3 min (on foot, driving, a 3+ star chase). Screenshot the overlay in a busy scene; note fps, p95, p99, JS p95, tier/ratio, draw calls.
6. With the toolbar showing vs hidden: does any control sit under it? Does the stick at the left edge trigger back-swipe, or the bottom edge the toolbar or home gesture? Note the inner size from the report (expect about 852×393, or about 852×340 with the toolbar). Does the Settings sheet scroll?
7. Rotate to portrait and back: rotate card, then 3-2-1 with thumbs held.
8. Go home for 10 s and come back: pause card, any GL-context card, audio after RESUME.
9. Trigger Siri or an incoming call mid-drive, return, tap: does audio come back? Note the audio state in the report.

B. THERMAL SOAK:
1. 15-20 min of continuous play (Chaos Runs plus a 4-5 star chase).
2. Screenshot the overlay at 1, 5, 10, 15 and 20 min. Note the minute the phone feels warm and when it feels hot, and the battery drop.
3. At the end: Pause > DIAGNOSTICS > SHARE the report (to Notes or Messages).
4. Repeat 5 min with Low Power Mode ON: expect a 30 Hz cap with no resolution drops.
5. Optional: 2 min each at High, Med and Low in the same busy spot, to calibrate the tiers.

C. HOME-SCREEN APP:
1. Share > Add to Home Screen. Its storage is separate from Safari, so turn the overlay on again.
2. Check the HUD stays clear of the Dynamic Island in both landscape directions, and test the home-indicator swipe vs the stick.
3. Repeat A5 and B for 5 min. Share the report.
4. Wake lock: play with the controller only for 60 s (the screen should stay on); leave it paused for 60 s.
5. After a new deploy, does 'UPDATE READY' show up?

D. HAPTICS (iOS 18+):
1. Diagnostics > HAPTICS: tap each probe (down, up, click, timer) and record which ones buzz.
2. In play: do FIRE, ENTER/EXIT, GAS/BRAKE/HAND, NOS and the drive-by button tick?
3. Crash while holding both thumbs down: tick or not? Crash then lift a thumb straight away: tick?
4. Turn Vibration OFF: everything should stop.

E. BLUETOOTH CONTROLLER (note the model):
1. Press a button on the title: do the prompts switch to pad glyphs?
2. From the report: pad id, mapping ('standard'?), axes and buttons, vibrationActuator present?
3. Map check: left stick, right stick aim, RT/LT analog gas/brake, A handbrake/sprint, X fire, Y enter/exit, B nitro, LB/RB weapon, Start pause, Select radio, d-pad menus. Note any button iOS takes for itself.
4. RUMBLE result.
5. Switch the pad off mid-drive: nothing should stay held.

F. TOUCH FEEL (5 min each, write 3 notes per control):
- point-to-steer (overshoot, deadzone, auto-gas, three-point turns) vs Classic;
- pedal reach without looking, accidental BRAKE, finding the DRIFT band, accidental EXIT;
- walk/run threshold, aim tap-to-fire, grenade on release, left-handed layout;
- no pinch zoom, magnifier or text selection.
- If the tuning panel is in, try values and keep the best (they go in the report).

WHAT TO SEND BACK:
- the shared reports (Safari, home-screen app, Low Power Mode, previous-session if one is flagged);
- the screenshots;
- your notes for A-F.

**Risks:** - Results vary with temperature, battery level, Low Power Mode and whether it's charging, so record them.
- The first minutes after install include shader compiles and asset downloads; judge steady-state performance after about 1 min.
- The home-screen app won't see Safari's settings or save.

**Verify:** The session itself is the verification. Output: three or more diagnostics reports with timelines, plus notes per section A-F, which then drive the 'tune from what you find' follow-ups (quality tier ladder, touch constants, haptic delivery strategy, audio session default).

**Needs from the user:** Needs your iPhone 15 Pro (iOS version noted), about 1.5-2 hours, a Bluetooth controller (Xbox, DualSense or MFi), and a music app for the audio-mixing check. Afterwards, send the shared diagnostics reports, screenshots and notes.

**Also noticed:**

- src/render/dynamicResolution.ts:343-348 summary() reads '0 fps' until the first judged window and after every stall reset. Confirmed headless: the overlay read '0 fps · 1.50x medium · 852×393 · 42 dc' the whole run. Covered by perf-overlay, listed here because it's a bug on its own.
- src/ui/haptics.ts:18,61-68 with src/ui/touchControls.ts:128: event-driven iOS ticks (crash, explosion, hurt) are only delivered on a pointerdown/pointerup within 220 ms. With both thumbs held while driving, most will never play. A design limit worth confirming on device before tuning.
- src/ui/hud.css:21-25: the FPS/debug line is hidden outside the play scene, so title/attract performance and the shader warm-up behind the title can't be read on device.
- iOS detection is copy-pasted three times: src/ui/haptics.ts:108, src/ui/settingsPanel.ts:22, src/ui/titleScreen.ts:190. A different handheld test is in src/render/quality.ts:79-82. A shared helper in src/core would keep them consistent.
- src/audio/mix.ts:145-154 with settings.ts:30 (ignoreSilentSwitch defaults to true): the 'playback' audio session stops the player's own music app as soon as the first title tap creates the AudioContext. The README acknowledges it; it's a product decision to confirm on device.
- src/audio/gameAudio.ts:611-616: an 'interrupted' context (call or Siri) relies on the next gesture's resume(), and there's no path to recreate the context if resume() keeps failing. Unconfirmed whether that happens on current iOS; the audio-state events in the session log would show it.
- src/core/input.ts:631-636: firstPad() takes the first connected pad without checking mapping === 'standard', so a non-standard pad would be mis-mapped silently (the button indices are at input.ts:103-119).
- vite.config.ts manifest: display 'fullscreen' and orientation 'landscape' are ignored by iOS (the app runs as standalone and can rotate). Harmless, since rotateOverlay.ts handles portrait, but don't count on either on iPhone.
- Platform behaviour to warn the user about: a home-screen web app on iOS has storage separate from Safari, so settings (curbside.settings), the progress save and the radio station don't carry over between the Safari tab and the installed app.

**Suggested order:** Ship the diagnostics in two small batches before touching the phone. Batch 1, about half a day: build-stamp, perf-overlay and overlay-in-app, so every screenshot carries real percentiles and the build id, including in the home-screen app. Batch 2, about half a day: diag-report plus input-probes, so a 20-minute soak comes back as one shared report with a timeline (this is the thermal evidence), and the haptics/rumble/pad questions get definite answers in a single pass. wake-lock is a small real UX fix; ship it in either batch so the controller test isn't spoiled by auto-lock. touch-tuning is optional. Build it only if you want to settle touch feel on the phone in one sitting rather than over several deploy rounds. Then run the device-checklist session and feed the reports back for to-do #1's 'tune from what you find'.

## Per-frame allocation and performance

### anim-bake: Bake clip samplers into Float32Arrays (the known ~10 KB/frame animation garbage) [M, cloud]

**Findings:** Measured in the dev build in headless Chromium 153 (Chrome's V8 engine) at 852x393 with 23 people, after warm-up: __ub.people.update allocates 10.5 KB/frame (11.4 KB/frame during real frames). Breakdown: Pose.overlay (src/render/characterAnim.ts:118-138, evaluate calls at :126 and :132) 6.1 KB self, three's Interpolant.evaluate 0.9 KB, Quaternion.slerpFlat 0.7 KB. The other ~1.9 KB is in CharacterModel.update (src/render/characterModel.ts:619, overlays at :685-688), poseCrowdPed (src/render/peoplePose.ts:158, Math.hypot at :170) and PeoplePose.update (:82-85). A micro-benchmark in the same page gives ~29 B per Interpolant.evaluate and ~250 B per 8-bone overlay. ClipBank (characterAnim.ts:80, helper at :251) wraps every track in three's own interpolant. All five body GLBs carry 446 STEP and 106 LINEAR samplers, so three interpolant classes run (Discrete, QuaternionLinear, Linear). Most rotation tracks are 2-key STEP constants (for example Walk's root, hips and head), and they are re-sampled every frame anyway.

**Cause:** The mechanism is confirmed; how the bytes split between sites is not. Interpolant.evaluate (node_modules/three/src/math/Interpolant.js:92-248) reads t1 = pp[i1] and t0 = pp[i1-1] at :96-97 and :220-221. These reads can deliberately return undefined (an out-of-range read ends the seek), so V8 keeps t0 and t1 tagged and boxes each Float32 load into a HeapNumber. It then calls interpolate_(i1, t0, t, t1) at :248, a call that goes to three different classes. QuaternionLinearInterpolant.js:37 passes a double alpha to the static Quaternion.slerpFlat. Doubles passed to functions V8 does not inline get boxed. A replacement proves the fix: a baked, single-class sampler measured 12.9 B per overlay (only the test harness's own boxing) against 259 B, and ran in 0.16 us against 0.66 us per overlay.

**Fix:** At load, have ClipBank resample each (clip, bone) into one Float32Array per clip, laid out [bone][frame][xyzw], at a fixed 30 fps, plus a Float32Array for the root position. Collapse constant tracks to a single frame, or to null (= rest pose). Pose keeps Float32Array q (bones x 4) and p (3). Overlay works out the frame index and blend fraction once, then runs one loop with the math written inline: nlerp between frames, then slerp or nlerp into the pose, with no method calls and no Quaternion objects. Pose.apply then calls bone.quaternion.set(...). Bake from KeyframeTrack.createInterpolant() once, so hand-built test clips and any cubic-spline tracks still work. Memory is about 23 clips x 8 bones x ~30 frames x 16 B, roughly 90 KB per body, under 1 MB in total. Keep the Pose/Layer/ClipData API so characterModel.ts barely changes. While there, replace Math.hypot in poseCrowdPed (peoplePose.ts:170) and posePlayer (:98) with Math.sqrt(x*x+z*z).

**Risks:** Resampling at 30 fps could move a STEP switch by up to 1/30 s. Every STEP track in these GLBs is a 2-key constant, so in practice nothing changes. nlerp and slerp differ imperceptibly at these frame gaps. Time t == duration must clamp to the last frame, and durations must stay exact, because GetUp, Throw and EnterCar timing depend on them. JavaScriptCore (Safari on the iPhone) does not box doubles, so on the iPhone this is a CPU win, not a garbage win.

**Verify:** Add a test to tests/characterAnim.test.ts: for every clip and bone, compare the baked sampler with the old Interpolant at 200 random times (quaternion dot > 0.9999). The existing ~20 characterAnim tests must still pass. For allocation, use Playwright plus the Chrome DevTools Protocol sampling heap profiler (HeapProfiler.startSampling with samplingInterval 64 and includeObjectsCollectedByMinor/MajorGC) around 1000 calls of __ub.people.update(1/60,1,null) after 4000 warm-up calls (phase A of (a throwaway scratch script)). Expect under 2 KB/frame, down from 10.5. Also take screenshots at 852x393.

**Needs from the user:** Optional: a glance on the device at walk, run, aim and fall after the change.

### pose-offscreen: Skip bone sampling for people outside the view [S, cloud]

**Findings:** PeoplePose.update (src/render/peoplePose.ts:82-85) poses every crowd member every frame. For each one, CharacterModel.update (src/render/characterModel.ts:619-733) samples all layers, applies them (pose.apply at :705) and runs rig.updateMatrixWorld(true) at :732. Only afterwards does CharacterBatch.flush (characterModel.ts:178) drop anyone outside the visible ground plus CULL_MARGIN (8 m). In one sample at 852x393, 23 people were posed and 3 were drawn. StreetLife.update also poses bike riders. Posing all 23 cost 0.085 ms/frame on desktop V8, and almost all of that work, and of the ~10 KB/frame of garbage, went to people nobody saw.

**Cause:** Confirmed from the code: the posing path has no visibility input; people are culled only at flush.

**Fix:** Pass last frame's view rectangle (the one the look already hands to flush, or rig.visibleGround) into PeoplePose, and give CharacterModel.update a 'visible' flag: inside the view plus a margin larger than CULL_MARGIN, e.g. 12 m. When not visible, still advance timers, stepDown/wantFull and Layer.step, so Fall → Down → GetUp and EnterCar timing stay right. Skip pose.rest/overlay/apply, the fakes and rig.updateMatrixWorld, and mark the model stale so its first visible frame does a full pose. Always pose the player.

**Risks:** A person walking into view could show one stale pose if the margin is too small. Force a full pose after rig.snapTo, a respawn or a teleport. update() called without a view (the tests) must default to visible. HeldWeapons and gripMatrix read arm matrices only for people shown, so they are unaffected.

**Verify:** Unit test: a model updated while invisible for N frames and then visible must end with the same bone quaternions as one updated visible throughout. In Playwright, log posed vs drawn per frame and time __ub.people.update (0.085 ms for 23 people before). Take 852x393 screenshots of people walking into frame to check for pops.

### hypot-hot-loops: Math.hypot in the per-step crowd-vs-car loop and per-frame scans (largest V8 garbage in the sim) [M, cloud]

**Findings:** One 1/60 s sim step allocates 37-46 KB on desktop V8: 46 KB/step over 1200 warmed fastForward steps, 37 KB/step in steady real frames. That is about 4x the known animation figure, and docs/HANDOFF.md doesn't mention it. Top sites per step: stepCrowdPed 13.5 KB plus the Math.hypot builtin 8.6 KB (7 KB of it called from stepCrowdPed), simulate 7.9 KB, collideVehicleStatic 7.6 KB, driveAi 1.6 KB, StaticGrid.near 1.5 KB. stepCrowdPed (src/systems/crowd.ts:280-308) calls speed(v) = Math.hypot(v.vx, v.vz) (src/entities/vehicle.ts:512-514) for every car and every pedestrian before any distance check: 22 x 30, about 660 calls per step. Per-frame callers: nearestEnterable (src/main.ts:456-469, called from updateHud) runs bodyDistance (src/systems/physics.ts:88-97, one hypot per body circle) and speed() on every vehicle, 5.5 KB/frame; poseCrowdPed (peoplePose.ts:170); PigeonLook.update (src/render/pigeonMesh.ts:156-165); driveAi (src/systems/traffic.ts:241, 244, 260). There are 205 Math.hypot call sites in src. Micro-benchmark in Chrome 153: Math.hypot(a, b) allocates 26 B per call, Math.sqrt(a*a+b*b) nothing.

**Cause:** Confirmed by micro-benchmark: V8 does not inline Math.hypot. Its builtin boxes the arguments and allocates a FixedDoubleArray and a HeapNumber on every call. JavaScriptCore does not box doubles, so on the iPhone this is a host-call CPU cost per pair rather than garbage; that cost was not measured.

**Fix:** Use Math.sqrt(x*x + z*z), inline or as a tiny len2 helper, in every per-step and per-frame path; leave Math.hypot in one-off code. In stepCrowdPed, first reject any car more than 17 m away on either axis: dodge needs along ≤ 16 m and lateral ≤ 3 m, touchesCar needs ≤ 8 m. Then compare squared speed (sp2 < 9) before taking a sqrt. Better still, compute each vehicle's speed once per step into a Float64Array next to vehicleStates (built at main.ts:596-598). In nearestEnterable, reject on a cheap squared centre distance (ENTER_RANGE + body reach) before calling bodyDistance or speed.

**Risks:** Math.hypot and Math.sqrt(x²+z²) can differ in the last bit, so a test that asserts exact positions might shift slightly. The crowd reject distance must stay at least as large as dodge's reach, or pedestrians stop leaping clear of fast cars.

**Verify:** npm test, especially the crowd, physics, traffic and pedestrian suites. Run the sampling heap profiler around fastForward after a 30 s warm-up (phase B of profile.cjs): stepCrowdPed plus hypot should fall from ~22 KB/step to under 2 KB/step, and nearestEnterable from 5.5 KB/frame to ~0 (frames.cjs output grouped with group.cjs, same scratch folder). Compare ms per step from fastForward(50) before and after.

**Needs from the user:** Decide whether garbage that only exists in V8 (desktop Chrome) is worth M-sized work before the iPhone Safari timeline shows whether garbage collection is visible at all on JavaScriptCore.

### sim-call-boxing: Remaining sim garbage: vehicle-pair masses, StaticGrid contacts, playerTarget [M, cloud]

**Findings:** After the hypot fix, the next sim sites are simulate itself (~8 KB/step) and collideVehicleStatic plus StaticGrid.near (~9 KB/step). The vehicle-pair loop (src/main.ts:628-660) reads VEHICLE_SPECS[...].mass for both cars (:632-633). Those masses are non-integers (0.85, 1.15 and so on; src/entities/vehicle.ts:217-411), and they are passed as arguments to collideVehicles (src/systems/physics.ts:159), which the profiler shows as its own frame, i.e. not inlined. That is 435 pairs per step, and the masses are passed before collideVehicles' own cheap reject runs. Reading the masses alone measured 0.8 B per pair, so the cost comes from passing them to the call. collideVehicleStatic (physics.ts:109) calls StaticGrid.resolveCircle (src/world/collision.ts:71) for each body circle, which calls near() (:47) and circleVsRect for every box nearby. circleVsRect (collision.ts:91-112) returns a new {nx, nz, depth} object for every contact; collidePedStatic does the same for each pedestrian every step. Those contact objects are the one engine-independent allocation in the sim hot path. playerTarget() (main.ts:825) builds a new Target object every step (about 52 B/step).

**Cause:** Partly confirmed. V8 boxes doubles passed to functions it does not inline. The contact objects and the Target object are confirmed allocations. How the ~17 KB/step splits between these sites is not confirmed, because V8's sampling profiler charges allocations in inlined callees to the caller.

**Fix:** Pass the spec objects (or archetypes) to collideVehicles and read mass inside, after the AABB reject; or move the reject into the caller. Change circleVsRect to fill an out: Contact and return a boolean; resolveCircle keeps a reused 'deepest' scratch object (fields copied in) and returns it or null. Reuse one module-level Target in playerTarget. Then profile simulate again; to see what remains, temporarily split it into named helper functions, because the profiler only reports per function.

**Risks:** resolveCircle's result becomes a shared object, so grep all callers and make sure none holds it across another call (physics.ts:115-117 and :224-226 read it immediately). Before reusing the Target, check that stepHostile, stepArrest and provoke never store it.

**Verify:** npm test (physics, crowd, longVehicles, ramps, police). Re-run the profiler around fastForward: simulate + collideVehicleStatic + near should fall from ~17 KB/step. Target after this item and hypot-hot-loops: under 5 KB per step in total.

### upload-ranges: Per-frame updateRanges churn in instanced batches (vehicleBatch.flush ~10 KB/frame) [S, cloud]

**Findings:** vehicleBatch.flush allocates ~10 KB/frame in steady state: uploadRange 4.5 KB, the Array push builtin 1.3 KB, the function itself 3 KB. It calls uploadRange for 4 attributes of all 19 car archetypes every frame (src/render/vehicleBatch.ts:180-189), including the ~15 with no car in view (only 4 car batches were visible in the sample, and their meshes are hidden, so three never uploads them). uploadRange (src/render/glowSprites.ts:115-119) calls clearUpdateRanges and then addUpdateRange, which in three r186 pushes a new {start, count} object. three's WebGLAttributes.updateBuffer then sorts the ranges with a new arrow-function comparator and clears them with length = 0, which drops the array's backing store so the next push has to reallocate it. Micro-benchmark: 88 B per upload today, and still 70 B when one range object is reused. About 30 call sites in src use this pattern (propBatch, contactShadows, glows, pigeons, combatLook, heldWeapons, characterModel, fxDebris, effects). These objects and arrays are allocated on JavaScriptCore too. The upload volume itself is fine: ~28 bufferSubData calls and ~4 KB per frame, with no zero-length uploads (WebGL2 treats length 0 as 'to the end').

**Cause:** Confirmed: three's updateRanges path creates range objects, comparator closures and new backing stores on every upload, and the empty archetypes add ~60 of the ~76 calls per frame for nothing.

**Fix:** (1) In vehicleBatch.flush, skip uploadRange when n === 0 and !uploadAll; the mesh is hidden, so there is nothing to upload. (2) For small buffers (car batches 48 instances, combatLook 24, heldWeapons 48, pigeons 64, contact shadows 160), stop using ranges and just set needsUpdate = true. With no ranges, three uploads the whole array in one bufferSubData with no sort, closure or objects, at the cost of a few KB more upload. Keep ranges for the big buffers (props, glows at 384, decal dirty spans). Put the size threshold inside the shared uploadRange helper.

**Risks:** Uploading big buffers whole would cost bandwidth on the iPhone, so keep the threshold small (about 8 KB or less). The uploadAll pass after vehicles.glb loads must still upload everything once.

**Verify:** Before and after, run uploads.cjs (tallies bufferSubData calls and KB per frame) and frames.cjs plus group.cjs: vehicleBatch.flush should be under 2 KB/frame, upload KB within a few KB of today. Screenshots at desktop 1280x720 and 852x393 of traffic, sirens and night headlights should be unchanged.

### shadow-depth-flip: Shadow pass rebuilds three's program parameters twice per frame [S, cloud]

**Findings:** Counting getParameters calls (through Material.customProgramCacheKey) over 6 real frames gave 2 per frame, both for MeshDepthMaterial. The shadow casters fall into two groups: 32 city chunks plus the boundary walls are InstancedMesh with instanceColor (src/world/cityMesh.ts:154-162, :369-376); 19 car batches are InstancedMesh without instanceColor and have no customDepthMaterial (src/render/vehicleBatch.ts:262-265). Props and characters have their own customDepthMaterial. So chunks and cars both render through three's single shared default depth material (WebGLShadowMap's _depthMaterial), and WebGLRenderer.setProgram sees materialProperties.instancingColor flip between them. Each flip calls getProgram, which builds getParameters (a ~100-field object) and getProgramCacheKey (an array plus a join). That shows as about 3.4 KB/frame under WebGLShadowMap.render, plus CPU. It applies on the iPhone: the medium tier, the handheld default, keeps a 1024 shadow map (src/render/quality.ts:45-55); only the low tier skips the shadow pass.

**Cause:** Confirmed: one shared default depth material serves instanced meshes that differ in instanceColor.

**Fix:** Give the car batches one shared, module-level customDepthMaterial = new MeshDepthMaterial() (default packing, same as three's own) so each depth material always sees the same instancing and instancingColor state. Pickups and the progress meshes already match the chunks (instanceColor on). Make sure warmShaders (src/main.ts:231, :1135) compiles the new depth program, so nothing compiles mid-play.

**Risks:** If the new depth program is not precompiled, it compiles the first time cars cast a shadow, which breaks the rule against compiling shaders mid-play. Shadow output must look identical.

**Verify:** programs.cjs (counts customProgramCacheKey calls per frame) should show 0 per frame after the first. renderer.info.programs.length must not grow during play. Shadow screenshots on the desktop high tier and at 852x393 on the medium tier should match.

**Also noticed:**

- README.md:329-334 says what still allocates each frame is mostly three.js's per-person AnimationMixer plus V8 number boxing. There has been no AnimationMixer for a while (README.md:837 and src/render/characterAnim.ts say so). docs/HANDOFF.md:96-97 lists only the ~10 KB/frame from animation sampling, but the sim allocates 37-46 KB per step on V8, which the docs never mention.
- Desktop V8 totals in steady state (Chromium 153, 256x144, 607 frames): ~37 KB per sim step plus ~69 KB per frame from everything else, so about 110 KB/frame (~6.5 MB/s) at 60 fps. Animation is about 10% of that. The largest per-frame sources outside the sim: poseCrowdPed 11.4 KB, WebGLRenderer.render 10.3 KB (three internals: shadow pass 3.4, renderScene 4.0, render-list sort 1.2, projectObject 1.2), vehicleBatch.flush 10.1, nearestEnterable 5.5, Radar.draw 4.4, pigeons ~5.6, characterBodies.flush 2.7.
- CPU is small on desktop V8: one sim step takes ~0.15 ms and posing 23 people ~0.085 ms. The iPhone pass should first find out whether frames are limited by the GPU or by JavaScript (Safari Web Inspector Timelines on the device: JavaScript Allocations, Memory, and the frame timeline with GC events, for ~60 s of driving and ~60 s on foot) before investing in the M-sized boxing work. JavaScriptCore was not measured here; Playwright's WebKit cannot report allocation statistics.
- src/ui/radar.ts:332 builds ctx.font from a template string for every icon blip on every redraw (30 Hz), so it creates a string and the browser re-parses the font each time. Cache the font string per rounded radius.
- Pose.apply (src/render/characterAnim.ts:141-150) copies into bone.quaternion. That fires Object3D's onQuaternionChange (node_modules/three/src/core/Object3D.js:151-158), which recomputes each bone's Euler angles (a matrix plus asin/atan2) for every bone of every posed person every frame. This is CPU only; the cost was not measured.
- StaticGrid.cellKey (src/world/collision.ts:86-89) packs keys larger than V8's small-integer range, but a micro-benchmark showed no boxing, because TurboFan (V8's optimizing compiler) looks up int32 Map keys directly. No change is needed.
- V8's sampling heap profiler charges allocations in inlined functions to the caller, so line-level attribution inside simulate and stepCrowdPed needs micro-benchmarks or temporarily split functions. Reusable scratch scripts are in (a throwaway scratch script) (profile.cjs, frames.cjs, group.cjs, micro.cjs, micro2.cjs, micro3.cjs, programs.cjs, uploads.cjs, timing.cjs, plus the raw .heapprofile files) and could become a tools/alloc-profile script that reports bytes per frame and per step for each fix.

**Suggested order:** Do the three small fixes that also help the iPhone first, as one batch: pose-offscreen, shadow-depth-flip and upload-ranges. They cut CPU work and remove allocations that happen on JavaScriptCore too, and each can be checked here with the scratch scripts. Next, anim-bake closes the HANDOFF item and makes sampling ~4x faster. Leave hypot-hot-loops and sim-call-boxing for last: their garbage only happens in desktop Chrome's V8, where it is larger (~40 KB per sim step) but harmless in absolute terms. Before investing in those two, record a Safari Web Inspector timeline on the iPhone, and turn the profiling script into a tools/ script so every change shows a before/after bytes-per-frame number.

## 2. Tuning from real play

### tune-chaos-medals: Chaos Run medal lines (15k / 40k / 80k) [M, you]

**Findings:** The lines are hard-coded at src/game/modes/chaosRun.ts:23 (CHAOS_MEDALS). They are read by chaosMedal() and nextMedal() at :43-56, by the HUD goal strings at chaosRunMode.ts:31-36, and in finish() at chaosRunMode.ts:214-226, which takes finalScore from score.total at :220 and saves it with recordMedal.

The score economy depends on these constants: CHAOS_RUN_SECONDS 120 (chaosRun.ts:14), BOOM_BONUS +5 s (:16), COMBO_BONUS +3 s at x5 (:18-19), CHAOS_CAR_HEALTH x1.5 (:29) and CHAOS_LOADOUT pistol (:36). Point values are BASE_POINTS (score.ts:19-31), COMBO_WINDOW 3 s and MAX_COMBO x10 (score.ts:56-57), and DRIFT_RATE (score.ts:59). Near misses (main.ts:124-125, 682-695) and smashes (main.ts:652-653: 60 + impact*4) are scored in main.ts simulate(), not in a module.

The README says the lines are the reviewer's judgement, not data. The headless 'reckless autopilot' it cites is not in the repo (tools/ has only drive-snapshot.py and make-icons.mjs).

I ran a measurement. It patches __ub.input.readVehicle with a naive bot that steers at the nearest car, full throttle, handbrake on sharp angles, nitro held. It starts runs with frontDoor.play(progress.chaos.titleMode) and runs them with fastForward. A full 2:00 run takes about 1 s of wall time in headless Chromium, because fastForward does not render.

Results over 20 runs: median 6.3k, p75 about 16k, max 28.5k. 5 of 20 reached bronze, none reached silver. 2 runs were WASTED and 1 BUSTED. Points by category over all runs: boom 48%, smash 27%, drift 6%, hit & run 5%, near miss 4%.

**Cause:** There is no data yet on what humans score. The lines came from one review plus an autopilot whose code was not kept. Bronze looks about right: a mindless rammer gets there 1 time in 4. Silver and gold depend on combo chaining (up to x10), and no bot here models that.

**Fix:** 1. Commit the bot harness as tools/tune/chaos.mjs (Playwright + __ub, no game-code change; it patches input.readVehicle). Give it 2-3 fixed-seed bot types: rammer, near-miss weaver (overtakes traffic close at speed), and drifter (handbrake at junctions). It prints score percentiles and points by category, so any later scoring change can be checked against stored bot baselines.
2. Once real-play logs exist (see tune-telemetry), set bronze near a new player's median run, silver near an experienced player's p75, and gold near a strong player's best. Change only CHAOS_MEDALS; the HUD goals, results card and title line all derive from it.
3. If gold needs to stay reachable without endless time extensions, consider capping total bonus time.

**Risks:** The bot only gives a lower bound and a relative check; using bot numbers as absolute lines would make silver and gold too easy or too hard. Medals already in saves are never taken back, so raising the lines only affects new runs. Touch and keyboard players will score differently, so log the input device.

**Verify:** Harness: `node tools/tune/chaos.mjs 50` against a dev server prints percentiles; about 1 s per run in SwiftShader, so 50 runs take about a minute. Unit tests: tests/chaosRun.test.ts already covers chaosMedal and nextMedal; update the expected thresholds when the lines change. Device: the telemetry log shows medal rates before and after.

**Needs from the user:** Play 10-20 Chaos Runs on the iPhone and on desktop with telemetry on, then share the log. Decide the target: what share of first-week runs should reach each medal.

### tune-race-dev-times: Race developer times (DEV_SPEED / DEV_CORNER), with a ramp on the Old Town racing line [M, cloud]

**Findings:** The constants are at src/game/modes/races.ts:65-67 (DEV_SPEED 36 m/s, DEV_CORNER 1.2 s, DEV_LAUNCH 2 s), MEDAL_FACTORS gold 1.05 / silver 1.2 / bronze 1.4 (:60) and GIVE_UP_FACTOR 2.5 (:63). devTime() at :109 is length/36 + corners*1.2 + 2. It is used by RaceRun (:146), raceMedal (:113-115), the timeout (:179), the GOLD time on the HUD (raceMode.ts:115) and medals and pay at the finish (raceMode.ts:125-140). Computed dev times: downtown 41.8, harbour 62.0, oldtown 46.0, arts 47.2, suburbs 46.0, ring 61.3 s.

I ran a headless check with vitest from a scratch dir. It uses the real stepVehicle, the city plus dressing StaticGrid, ramps and RaceRun, and an empty city (no traffic). A braking-aware bot that keeps to the right-hand lane, does not drift and uses no nitro, with a parameter sweep:
- Sports car: 36.6 / 55.0 / 40.9 / 41.5 / 39.9 / 54.3 s, which is x0.86-0.89 of dev on all six courses.
- With the 0.5 nitro tank a race starts with: x0.85-0.88.
- Muscle car: x0.95-0.98.
- Sedan: x1.05-1.13, so even a perfect line misses gold in a sedan.

The formula keeps a steady ratio across courses (spread 0.03), so only the overall scale and the car need tuning. Gold leaves about 17% for traffic and human error in a sports car. This contradicts the README's 'autopilot lands silver' (maybe that run had traffic; unconfirmed).

Ramp hazard, confirmed: Old Town leg 5, [-6,-3] to [-6,-6], travelling north, has a stunt ramp at (-384, -369) facing south (placeRamps(1337), ramps.ts:95). It sits on the centreline 15 m before checkpoint 5, and its back is solid (rampSolids, ramps.ts:139). A bot aiming at the gate centre hits it at full speed (impact 14.9) and stalls, so Old Town failed until the bot kept right. The racing line into that right turn runs on exactly that side of the road. Old Town leg 1 also has a launch ramp 46 m before corner checkpoint 1: at race speed the jump (about 1.3 s, about 50 m) lands right at the corner. Harbour leg 5 and Suburbs leg 6 have launch ramps mid-leg, which look harmless. Races do not reset the nitro tank (raceMode.ts has no nitro reference), so a full tank carried in is worth about 2 s.

**Cause:** The dev-time model was set by hand and checked with an autopilot that is not in the repo. Race courses and ramp placement are authored separately, and no test checks one against the other, so the Old Town course runs into the back of a ramp. The dev time ignores the car, although any car can be used.

**Fix:** 1. Add tests/raceDevTime.test.ts with the empty-city bot (about 150 lines, about 1 s to run). Assert the sports-bot/dev ratio is within about [0.8, 0.95] for every course, so a handling change flags a re-tune automatically. The README asks for that re-tune today but nothing checks it.
2. Add a test that no race leg has a ramp or kicker facing against travel, and none within about 60 m before a corner checkpoint. Fix Old Town by changing its nodes, which is safer than changing placeRamps: ramp positions are seeded and other content depends on them.
3. Optionally scale dev time by the car's terminal speed relative to the sports car, or label gold as a sports-car time. This is a design call.
4. Set the final MEDAL_FACTORS or DEV_SPEED from logged human time/dev ratios. If the user wants gold harder, the bot data suggests DEV_SPEED around 38-39, or gold at about x0.98.

**Risks:** Changing dev times changes medal payouts ($800/400/200); medals and times already won stay. Moving Old Town nodes changes a published course; best times saved for race-oldtown would no longer be comparable, so consider resetting that id. The bot ignores traffic and traffic lights, so add a with-traffic run (in-browser via __ub) before tightening.

**Verify:** Vitest: the new bot ratio test and the ramp-on-course test (both pure, no rendering). Optional Playwright: run each course in-browser with traffic via __ub (call begin through the race start, patch input.readVehicle, fastForward) and compare with the empty-city time. Device: the logged time/dev ratio by course and car.

**Needs from the user:** Decide whether gold should be reachable in any car or only in fast ones, and whether launch ramps on race courses are a feature. Final factor tuning needs logged human race times (see tune-telemetry).

### tune-five-star-escape: 5-star difficulty: helicopter refuel window, resprays, wrecking pursuers [M, you]

**Findings:** Helicopter (src/systems/helicopter.ts): HELI_FROM 5 (:7), HELI_SPEED 27 m/s (:8), HELI_ACCEL 7, SPOT_RADIUS 7.5 m (:11), HELI_SPAWN 150 / HELI_GONE 260, HELI_SHIFT 45 s on station, HELI_REFUEL 30 s away (:21-22). Shift logic is in police.ts:798-834: the shift timer starts when the heli spawns and runs whether or not it sees you.

Police (src/systems/police.ts): UNITS_BY_STARS [0,2,3,4,6,7] (:33), SWAT_BY_STARS [..,2,3] (:35), SPAWN_EVERY at 5 stars 1.2 s (:46), SPAWN_RANGE 75-140 (:49), DESPAWN_RANGE 210 (:55), sight 20/62 m for cars and 15/40 m for officers (:57-61), CAR_SHOT_RANGE 20 / CAR_SHOT_EVERY 2.2 (:77-78), CRUISE/TOP_BY_STARS (:80-81), ROADBLOCK_EVERY 25 (:86).

Wanted (src/systems/wanted.ts): EVADE_BASE 6 + EVADE_PER_STAR 3 means 21 s unseen to drop from 5 stars (:62-63); SEARCH_AFTER 1.5 (:60); RESPONSE_GRACE 8 (:69). Outs: respray (heat.ts:38 SPRAY_COST 400; fails if seen going in) and wrecking units.

I ran a measurement in headless Chromium with the real simulate(), so bullets, rams and crash damage are all in. Setup: fresh sports car at a random inner crossing, heat.wanted.force(5), and a bot that drives junction to junction, picks the exit with the least police and heli pressure, swerves round traffic and backs out when stuck. About 0.2-0.9 s wall time per chase.
- Stock car: wrecked in 20 of 20 runs at 12-56 s (median about 17 s), so always before the heli's first 45 s shift ended. Damage was about half the bot's own wall hits, the rest bullets and rams.
- Indestructible car (isolates the evasion rules): 7/10 dropped to 4 stars, 2/10 to 3 stars, 0/10 fully escaped in 180 s, 3/10 BUSTED when boxed in.

Caveats: force(5) starts with no units on the street, unlike a real build-up. The bot drives badly, hits walls, and its rams on cops push heat back up. The README's earlier run (code not kept) reported 5 stars dropping to 4 or 3 about 3 in 4 within 3 minutes.

**Cause:** Unconfirmed whether 5 stars is too hard for humans. What the code shows: the escape window opens only after 45 s on station (shift timer) and then needs 21 s unseen within the 30 s refuel. Meanwhile 7 units + 3 SWAT spawn every 1.2 s and 4-5 star passengers shoot the car every 2.2 s within 20 m. A scripted driver never keeps a 90 HP sports car that long, so for a weak driver the refuel window is effectively unreachable.

**Fix:** 1. Commit the chase harness as tools/tune/heat.mjs (Playwright + __ub; patches input.readVehicle). Use fixed seeds, a built-up start (raise stars through crimes or force(3) then force(5), not force(5) cold), and outcome logging: time to 4 / 3 / 0 stars, busted, wasted, car wrecked, heli sightings, and damage split by source using crash and bulletHit events. Use it only for A/B comparisons of knobs, never as an absolute verdict.
2. Candidate knobs if real play says it is too hard:
- HELI_SHIFT 45 to about 30-35, or count the shift only while the spotlight is off you.
- CAR_SHOT_EVERY or CAR_SHOT_RANGE at 5 stars.
- SPAWN_EVERY[5] or SWAT_BY_STARS[5].
- A short HUD hint when the heli leaves ('CHOPPER REFUELLING'), so players learn the window.
3. Decide a target, for example: a competent driver in a healthy sports car escapes 5 stars about 1 in 3 within 3 minutes, with a respray as the reliable out.

**Risks:** Tuning for a bot can make 5 stars trivial for a good human. Shift and shot changes also affect missions that force stars (wanted.force, missions.ts 'wanted' step). Keep the 1-2 star experience unchanged (separate arrays per star level).

**Verify:** Harness: `node tools/tune/heat.mjs 40 --stars 5` reports escape, drop and bust rates before and after a knob change, with the same seeds. Unit tests: tests/police.test.ts 'helicopter' and tests/heat.test.ts 'five stars put the helicopter up' must still pass; add a test for any new shift rule. Device: telemetry chase records (time at 5 stars, how it ended).

**Needs from the user:** Play real chases to 5 stars with telemetry on, then answer two things: does it feel hopeless or fair, and which outs do you actually use (refuel window, respray, wrecking cops)? Then set a target escape rate. The harness and A/B runs can be done in the cloud.

### tune-telemetry: Local play telemetry so real play produces tuning data [M, cloud]

**Findings:** Today the save (src/game/progressSave.ts:20-39 LifetimeStats, :41-66 SaveData) keeps only lifetime counters (wasted, busted, maxStars via progress.ts:206-208), the best score per mode, medals, and the best race time per course (raceMode.ts:133-135). Nothing is kept per run: no list of Chaos Run scores or end reasons, no race attempts with time vs dev and car, and nothing about chases (time at each star level, how they ended).

migrateSave copies unknown top-level fields through (progressSave.ts:139), so a new field is backward compatible. A separate localStorage key would keep the save small.

The chase signals are already on the bus: 'wanted' events carry level, prev and reason (lost / evaded / respray / busted / died / reset), plus 'busted', 'playerDied' and 'respray'. Race and Chaos Run endings are not: RaceMode.end (raceMode.ts:125) and ChaosRunMode.finish (chaosRunMode.ts:214) write to progress directly.

Useful context fields already exist: input.lastDevice (input.ts:257) and the quality tier. Settings already has a debug toggle pattern (settingsPanel.ts:100, showFps).

**Cause:** Nothing records per-run results, so the user's real play can't inform the tuning.

**Fix:** 1. New pure module src/game/playLog.ts with unit tests. It subscribes to the bus and keeps a ring buffer of the last about 200 entries in localStorage under 'curbside.playlog', each stamped with build id, device (touch / keys / pad from input.lastDevice) and quality tier. Entry kinds:
- chaos: score, end reason, bonusTime, elapsed, tally by category, medal.
- race: id, time, dev, ratio, medal or fail reason, car archetype, nitro at start.
- chase: peak stars, seconds at each level, heli shifts and refuels seen, whether the car was kept, end reason from the wanted event (evaded / lost / respray / busted / died).
2. Add one compatible bus event, e.g. { type: 'activityEnd', kind: 'race' | 'chaosRun', ... }, emitted from raceMode.end and chaosRunMode.finish. Add a no-op case to GameAudio's exhaustive switch (gameAudio.ts:517).
3. Export: a 'Copy play log' row in Settings using navigator.share or the clipboard (needs a user gesture; works in iOS Safari over HTTPS), plus __ub.playLog for desktop.
4. Add tools/tune/playlog.mjs, which prints medal rates, race time/dev ratios by course and car, and 5-star outcomes.

It stays local only, with no network and no backend.

**Risks:** Bus listeners must not allocate per frame; write only at activity or chase ends and on page hide, not every step. localStorage quota is shared with the save, so cap the size. The new event type must keep GameAudio's never-check compiling. The clipboard needs a user gesture on iOS.

**Verify:** Vitest: feed synthetic bus events (wanted 0 to 5 to 4 to 0 'evaded', activityEnd race and chaos) into playLog with a fake storage, and assert the entries, ring-buffer cap and sanitising. Playwright (desktop 1280x720 and 852x393): run a bot Chaos Run and a forced chase via __ub.fastForward, then check that localStorage 'curbside.playlog' has the entries and that the Settings export row copies valid JSON. npm test and npm run build stay green.

**Needs from the user:** Agree to local-only logging and choose where the export lives (Settings row, behind a toggle or always on). After that, play and send the exported JSON back.

**Also noticed:**

- Race-course hazard (confirmed): Old Town leg 5, [-6,-3] to [-6,-6] at src/game/modes/races.ts:39, runs north into the solid back of a stunt ramp at (-384,-369) facing south (placeRamps(1337), src/world/ramps.ts:95; solid parts at ramps.ts:139). The ramp sits on the centreline 15 m before checkpoint 5, in the oncoming lane, which is where the racing line into that right turn runs. A gate-centred line hits it at about 40 m/s. Leg 1 also has a launch ramp at (-128,-271) that lands right at corner checkpoint 1.
- Chaos Run results can show less than the HUD did: finalScore is taken from score.total when time runs out (src/game/modes/chaosRunMode.ts:220), but the sim keeps running through the 1.1 s slow-mo (simScale, :157-163). Awards in that time, such as a drift banking after its 0.35 s grace (src/systems/score.ts), raise the HUD score but not the results card or the saved best. Seen in the code, not in play.
- The headless tuning harnesses the README relies on (heat: 'a copy of the sim loop drives a getaway car'; races: 'a braking-aware autopilot lands silver'; Chaos Run: 'a reckless autopilot ... scored 1-6.6k') are not in the repo; tools/ has only drive-snapshot.py and make-icons.mjs. The results can't be reproduced.
- The README says the race autopilot 'lands silver'. My empty-city sports-car bot runs x0.86-0.89 of dev on all six courses, which is gold with about 17% to spare. The difference may be traffic; unconfirmed.
- Race dev times ignore the car (any car may race, raceMode.ts:58-65). In a sedan even an ideal bot runs x1.05-1.13 of dev, so gold is out of reach; muscle x0.95-0.98, sports x0.86-0.89.
- Races don't reset the nitro tank (src/game/modes/raceMode.ts never touches nitro; nitro.reset() is only at main.ts:517). A full tank carried in is worth about 2 s (about 3-4% of a course), which the dev time doesn't account for.
- Tooling note: a Playwright harness that patches __ub.input.readVehicle and calls __ub.fastForward needs no game-code change. A 2-minute Chaos Run simulates in about 1 s of wall time even in SwiftShader, because nothing renders. The scratch scripts are (a throwaway scratch script), (a throwaway scratch script) and (a throwaway scratch script) (run with vitest --config (a throwaway scratch script)).

**Suggested order:** Ship telemetry first (M, cloud-doable). Then the iPhone pass in to-do #1 produces tuning data at the same time, and every later tuning decision has real numbers behind it. Next, do the race item, which can be finished from the cloud: fix the Old Town ramp conflict, add the bot-ratio test and the ramp-on-course test. Then commit the shared __ub bot harness (tools/tune) for Chaos Run and chases, so bot baselines and A/B checks exist. Only after a week or so of logged real play, change CHAOS_MEDALS, MEDAL_FACTORS/DEV_*, and the heli and police knobs, checking each change against the harness so it doesn't swing too far.

## 3. Blender adjustment pass

### toolchain-bpy: Toolchain: build the GLBs in the cloud with the pip 'bpy' module [S, cloud]

**Findings:** Python is 3.13.17 and pip reaches PyPI through the proxy. `pip index versions bpy` lists 5.1.0 to 5.2.3. The committed GLBs were exported by 'Khronos glTF Blender I/O v5.2.41', i.e. Blender 5.2 (docs/PLAN.md:39 also says Blender 5.2). bpy-5.2.3-cp313-manylinux_2_28_x86_64.whl is 402.8 MB and downloaded in about 4.6 s. Installing it in a venv took 12 s, and the venv with its dependencies (numpy etc.) is about 1.0 GB. `import bpy` gives '5.2.3 LTS', with io_scene_gltf2 present. Run as-is with the venv's python, blender/build_assets.py fails characters, vehicles and props with ModuleNotFoundError for bmesh/mathutils. Cause: in the pip module those only exist after `import bpy`, but characters.py:28 imports bmesh first and props.py:19 imports mathutils first, and build_assets.py:16-33 never imports bpy. A 5-line wrapper that does `import bpy` and then runpy's build_assets.py (scratch: (a throwaway scratch script)) builds all 7 generators in 15.5 s into a scratch dir. The output matches the committed public/assets: debris/pigeon/weapons.glb are byte-identical, and the other 12 have identical glTF JSON with float differences of at most 6e-8 (1 ULP). `python3 blender/check_assets.py <out>` gives 'all contracts OK'. Rendering: Cycles on the CPU works (a 128 px still in 0.3 s). Workbench and EEVEE abort with 'Couldn't open libEGL.so.1', so `--thumbs` (EEVEE, lib/common.py:205) does not work here. __pycache__/ and blender/thumbs/ are already in .gitignore.

**Cause:** Confirmed: build_assets.py assumes it runs inside the Blender binary, where bmesh/mathutils are preloaded. Under pip bpy they appear only after `import bpy`.

**Fix:** Add `import bpy  # noqa: F401 (pip bpy: registers bmesh/mathutils)` near the top of blender/build_assets.py, before the generator imports. It does nothing inside Blender. Document the recipe in README/BLENDER_TODO: `python3 -m venv /tmp/bpy && /tmp/bpy/bin/pip install bpy==5.2.3 && /tmp/bpy/bin/python blender/build_assets.py -- --out public/assets && python3 blender/check_assets.py`. Optionally add an `assets:py` npm script and blender/requirements.txt pinning bpy==5.2.3. Keep the venv outside the repo. For previews, use the game in Playwright, or a Cycles-CPU still instead of --thumbs.

**Risks:** Each fresh container has to download 400 MB again (about 20 s total). bpy 5.2.3 LTS differs from the desktop 5.2.x by patch level only, and the output matched to 1 ULP. There is no Blender GUI, so visual checks go through the game (Playwright + SwiftShader) or Cycles stills. EEVEE thumbnails would need libEGL, maybe via apt libegl1/libegl-mesa0 (unconfirmed, and not tried).

**Verify:** Rebuild into a temp dir and diff against public/assets (scratch tools/glbdiff.py), run check_assets.py, then npm test and npm run build.

**Needs from the user:** Nothing required. Optionally decide whether the cloud bpy build is the official path, or whether you still want final rebuilds done in desktop Blender 5.2.

### weapons-held: Weapons in hand: chunkier, accented guns; grenade/molotov visible; launcher on the shoulder (AimRocket) [M, cloud]

**Findings:** Guns are built in blender/generators/pickups.py:53-116 (pistol 0.035 m wide, SMG 0.045, shotgun barrel r=0.018). The game puts each weapon's origin at the centre of the right fist box (characterModel.ts:999-1012 gripFrame; the hand box is 0.09x0.1x0.1, characters.py:273). The grenade body (r=0.035, 0.08 tall, pickups.py:86-93) therefore sits almost entirely inside the fist, which confirms 'vanishes in the fist'. Drawing: heldWeapons.ts:65-71 uses a plain MeshLambertMaterial with per-vertex material colours and no self-light, so a dark accent stays dark at night. The stripe_<gun> materials are defined in pickups.py:46-47 but only the crates use them. The crates reuse the same gun builders with their own scales (pickups.py:144-150), so changing gun geometry also changes the crates. AimRocket: characters.py:440-449, where arm.R is (-55,0,-18). That puts the hand about 0.32 m below the shoulder, and the launcher tube is only 0.11 m above the grip (pickups.py:106-116), so the tube sits at about 1.2 m. projectiles.ts:79 ROCKET_HEIGHT = 1.2 matches that low tube. heldWeapons.ts:127 places muzzle flashes at grip height, `out.set(0, 0, muzzle)`, ignoring how high the barrel sits above the grip.

**Cause:** Confirmed from the geometry: life-size gun cross-sections of 3.5-4.5 cm are a pixel or two at 20-27 m. The grenade is smaller than the fist. AimRocket's straight rigid arm pitched only 55 degrees keeps the hand, and so the tube, low.

**Fix:** Generator (pickups.py): widen the guns' X/Z extents by 30-50% and keep their lengths. Add a top accent strip on each gun using the existing stripe_<gun> materials. Grenade r about 0.06; molotov bottle a little fatter. Retune the crate scale table (pickups.py:146) so the lid guns stay the same size. Launcher: lift the tube to about 0.2 m above the grip and move it back so its rear passes the shoulder. Export a new `muzzleY` extra next to `muzzle`, and re-centre crate_rocket's lid gun. characters.py:440-449: raise arm.R to about -75 (hand about 0.14 m below the shoulder) in AimRocket and ShootRocket, and adjust arm.L to match. Code: HeldWeapons reads muzzleY in muzzleOf/placeShot (heldWeapons.ts:127). Raise ROCKET_HEIGHT to about 1.45 (projectiles.ts:79). Optional: a self-lit term for accent vertices in HeldWeapons' shader so the stripe reads at night. Optional code-only interim: a per-kind scale in the instance matrix in HeldWeapons.flush (e.g. grenade x2), with muzzle distances scaled to match.

**Risks:** Gun builder changes also change the crate pickups. Raising the tube moves the rocket's spawn height, its muzzle flash and the tracer start, which must stay consistent. The two-handed SMG/shotgun AimBoth grip is unaffected. A self-lit accent adds a shader change that must be precompiled at start-up (no mid-play compiles).

**Verify:** check_assets.py (weapons.glb budget is 300, rocket 60); npm test (characterAnim grip test at tests/characterAnim.test.ts:159). Playwright at 852x393@3x and 1280x720: give each weapon via window.__ub, aim, fastForward, then screenshot by day and at night. Check that the launcher sits at shoulder height and that the muzzle flash lands at the tube mouth.

**Needs from the user:** Pick the look: bigger only, or bigger plus the coloured accent (crate stripe colours). Final readability call on the iPhone (ties into to-do #1).

### clips-getup-throw: Character clips: GetUpFast and an earlier Throw release [M, cloud]

**Findings:** GetUp is 0.917 s (characters.py:399-408). The game starts it GETUP_LEAD = 0.7 s before the ped may move and plays it up to GETUP_RUSH = 2.2x (characterModel.ts:427-428, getUpSpeed at 915-918, played at 659-661). That is 1.31x in the common 2.5 s knock-down (crowd.ts:84 KNOCKDOWN_SECONDS), 1.6x when already up, and up to 2.2x on short downs; blast knock-downs are 2 s (combat.ts:552). Throw is 0.417 s with its release at frame 5.5, 0.229 s (characters.py:429-437). The game starts it 0.1 s in at 1.6x (THROW_FROM/THROW_SPEED, characterModel.ts:437-438, used at 756-759) so the release lands about 0.08 s after the press. check_assets.py:18-25 CHAR_CLIPS has no GetUpFast. tests/characterAnim.test.ts:44-45 lists clips and short lengths.

**Cause:** Confirmed: the clip timing doesn't match the sim's timing (GetUp is longer than the 0.7 s lead; Throw releases at 55% while the sim throws on the press). Why GETUP_LEAD was set to 0.7 rather than to the clip length is unconfirmed.

**Fix:** Generator (characters.py animate()): add a `GetUpFast` action, about 12 frames (0.5 s), a compressed GetUp. Re-key Throw so the release is at about 25% (around frame 2.5 of 10), keeping the 0.417 s length. Add 'GetUpFast': (0.5, 0.05) to check_assets CHAR_CLIPS. Code (characterModel.ts): when entering 'getup', play GetUpFast if the bank has it and downLeft (or the 'already up' case) would rush GetUp past about 1.2x. Set THROW_FROM = 0 and THROW_SPEED = 1. Extend tests/characterAnim.test.ts (ALL/SHORT, plus a case where a short knock-down picks GetUpFast at no more than about 1.2x). Cheaper code-only option for GetUp: raise GETUP_LEAD to about 0.92 so GetUp plays at 1x in a 2.5 s knock-down.

**Risks:** All 8 character GLBs are rebuilt, about 165 KB each, so one more clip adds roughly 3 KB per file. Retiming Throw changes the doc's 'release at 55%' contract, so update BLENDER_TODO. Peds rising earlier with a longer lead may look 'up' while still unable to move.

**Verify:** check_assets.py, then npm test (characterAnim suite). Playwright: knock a ped down via __ub, fastForward in small steps and sample the hips angle / clip names; throw a grenade and check the hand release time against the projectile spawn.

**Needs from the user:** Choose: a new GetUpFast clip, or just a longer GETUP_LEAD (no Blender).

### characters-looks: Bodies and ambient: cop cap band/badge, bigger slim backpack, Pike collar, paler pigeons (Pike-on-bike coat: won't fix) [M, cloud]

**Findings:** Cop: the cap crown is `hair`, and the brim, capband, belt and holster are `shoes` (characters.py:208-213, 258-260). The game already supports a fixed-colour `*_badge` slot (characterModel.ts:40-46; slot from the material suffix at 266-267, last material wins, so one badge colour per file). But check_assets.py:15 CHAR_SLOTS lacks 'badge' and would reject it. SWAT officers also wear cop.glb (police.ts:596-598), so a fixed band shows on them too. Slim backpack: characters.py:228-230, a 0.34*sw x 0.16 x 0.4 bevelled box in the `pants` slot. ped_slim is at 592/600 tris, and the bevel costs 44 tris against 12 for a plain box. Pike: the coat and raised collar are `shirt` (34,34,40), and the hair is near-black (characters.py:102-106, 253-257). Pigeon: body (140,146,160), wings (84,88,100) (pigeon.py:21-22), 34/40 tris; pigeonMesh.ts:235 takes colours straight from the materials, drawn at 1.3x (pigeonMesh.ts:35). Pike's coat through the seat: riders are always the `player` body (main.ts:380-384, streetLife.ts:114), so nothing ever seats Pike.

**Cause:** Confirmed: dark-on-dark palette choices for the cop band, Pike's collar and pigeon wings. The backpack is too small and is tinted by the pants colour. The Pike/bike clash can't happen in the current code.

**Fix:** characters.py: move cop_capband to a new `cop_badge` material (light silver/white) and add a small chest badge box in the same material (+12 tris, cop is at 568). Make the slim backpack an unbevelled, bigger, boxier block (about 0.42 x 0.26 x 0.46), which frees about 32 tris. Move Pike's collar to a `pike_badge` pale-grey material (or add two lapel boxes). pigeon.py: lighten the wings/back or add pale wing-bar colours; recolour rather than add geometry (only 6 tris spare). check_assets.py: add 'badge' to CHAR_SLOTS. Code: none required. Skip the Pike coat split unless a story beat ever seats him.

**Risks:** Budgets: slim is 8 tris from its cap unless the bevel goes. The badge slot holds a single colour per file. The Collector (Pike in white) gets the same collar.

**Verify:** check_assets.py (budgets, slots), npm test. Playwright at night (fastForward to the night half of the 12-minute day) from the iPhone camera height: screenshot a cop group, a slim ped, Pike in LAST CALL, and a pigeon flock.

**Needs from the user:** OK that SWAT get the same light cap band, which is fixed colour and not outfit-controlled. Colour picks for Pike's collar and the pigeons. Night readability judged on device.

### props-world: Props and landmarks: rooftop caps, lamp/signal heads, police sign and safehouse door from above, booth roof, gantry span (+ heli scale knob) [M, cloud]

**Findings:** Rooftop: water_tank_roof and rooftop_door_roof use `dark` (36,38,42), about 0.018 linear (props.py:223, 249-251). The code recolours them via PART_COLOURS (propModels.ts:89-94, applied at 174-175). Streetlamp: the head is `pole` grey on top, with `lamp` only on the underside (props.py:82-90). Traffic light: the lenses face +Z along the road (props.py:93-104). surfaceFor() maps by material and root name (propModels.ts:43-54), so any extra `light_red/amber/green` part on traffic_light is lit by the signal cycle automatically (propBatch.ts:410). Police sign: a dark `police_sign_cap` sits directly over the blue lamp (props.py:373-375). Safehouse: a dark `safehouse_door_shade` sits over its lamp (props.py:441-443). So from overhead both lamps are covered by near-black caps, in addition to the awnings (2.8 m high, 1.1 m deep, buildingPlans.ts:54-55). The night halos hard-code the lamp offsets (worldProps.ts:146-149: out 0.7 / 0.4, y 3.4). booth_roof (80,84,90) is shared by spray_booth and export_bay (props.py:68, 352, 401) and is cut away via SURF.roof. start_gantry is built at a 12.5 m span (props.py:380-392, 240 tris), and the code stretches it by GANTRY_HALF_SPAN/GANTRY_MODEL_HALF = 8.6/6.25 = 1.376 (landmarkProps.ts:61-63, 119). Heli: drawn at SCALE 0.55 (heliModel.ts:19); HANDOFF to-do #3 says it is large at night on phones, which is a code-only knob.

**Cause:** Confirmed: near-black materials on the faces that are seen from above; lamps hidden under dark caps; a model span that doesn't match the 16 m road.

**Fix:** props.py: give the water-tank lid and stair-hut roof their own tar-grey and weathered-wood materials, then delete the PART_COLOURS entries. Give the streetlamp a bigger head or a top-visible `lamp` lens. On traffic_light, add three small top-facing plates in light_red/amber/green, lit automatically (164 to about 200 tris). Police sign: replace the dark cap with a `police_lamp` lamp box or canopy pushed past 1.1 m. Safehouse: a canopy or lamp box past the awning, with its top in `lamp`. Then update the halo offsets in worldProps.ts:146-149, or read them via PropModels.node(). Lighten booth_roof and/or add a roof stripe; this affects export_bay too, or split the materials. Build start_gantry at a 17.2 m span (about 11 chequer columns). Either add it to PROP_BUDGET_OVERRIDE (about 320) or build it as one white beam plus black blocks only. Then set GANTRY_MODEL_HALF = 8.6, or read the model's dims. Heli: tweak SCALE only after a device look.

**Risks:** Shared materials: booth_roof is on two landmarks. Constants that duplicate model geometry: gantry half-span and wall-lamp offsets. Prop budgets: start_gantry would exceed 300 with square chequers. The roof cut-away depends on the `booth_roof` name staying the same.

**Verify:** check_assets.py; npm test (tests/landmarks.test.ts, streetProps.test.ts). Playwright screenshots from the play camera over a race start, the police station, the safehouse, a spray booth and a block of roofs, by day and at night, at 852x393@3x and 1280x720. Check that draw calls are unchanged via renderer.info.

**Needs from the user:** Visual taste calls (roof colours, canopy shape). Whether the heli really needs shrinking, which needs a phone at night.

### pickups-debris: Pickup model scale and debris panel trim (low value) [S, cloud]

**Findings:** Pickups are life-size (crates 0.7 m) and drawn at MODEL_SCALE 1.7 (pickupMesh.ts:61, 119). The `package` root is also drawn at 1.8 (missionMode.ts:669) and 1.6 (packageMode.ts:105). panel_a/b/c are a single `paint` hull each, 18-22 tris (debris.py:63-73), against an 80-tri budget.

**Cause:** Confirmed. The scale is a deliberate code workaround, and it works at no cost because it is an instance scale. The panels have no second material for shape. Their 'black specks at night' is lighting, and trim (24,26,30) is dark too, so trim helps by day only (night part unconfirmed).

**Fix:** Recommended: leave the pickup scale in code. If you do rebuild the pickups 1.5x (pickups.py:135-217), change MODEL_SCALE to about 1.13 and the two `package` scales together. debris.py: add a thin `trim` rim or strip to each panel (+12 tris). For night readability, consider a code-side ember tint in the debris shader (not scoped).

**Risks:** Rescaling pickups means touching three call sites, and the glow rings are tuned to the current size.

**Verify:** check_assets.py (debris allows only paint/trim/tyre). Playwright: blow up a car via __ub and screenshot debris by day; screenshot pickups.

**Needs from the user:** Agree to skip the pickup rescale (no visible gain).

### rocket-projectile: Fly the 'rocket' model (and optionally grenade/molotov) instead of box stand-ins [M, cloud]

**Findings:** All projectiles are one InstancedMesh(BoxGeometry) with a per-instance colour (combatLook.ts:13, 54-62). place() scales the box to 0.22 x 0.22 x 0.95 for rockets, 0.17 x 0.17 x 0.42 for molotovs and 0.3 x 0.3 x 0.36 for grenades, oriented yaw = atan2(vx,vz) with roll = spin (combatLook.ts:139-161). The tail flame and smoke are emitted 0.6 m behind the centre (combatLook.ts:80-90). weapons.glb has a `rocket` root (pickups.py:119-126): 54 tris, origin at its centre, nose +Z, olive/warhead/gunmetal, about 0.1 m across and 0.58 m long. HeldWeapons maps the 'rocket' weapon kind to `rocket_launcher` and never reads `rocket` (heldWeapons.ts:23-31). Rockets fly at a fixed ROCKET_HEIGHT 1.2 (projectiles.ts:79). Shaders are precompiled once at start (main.ts:1087-1094, post.ts:73-84), so a material whose program changes when a GLB arrives would compile mid-play.

**Cause:** Confirmed: not wired. The code never looks up the `rocket` root.

**Fix:** In CombatLook, load weapons.glb once. Share the parse with HeldWeapons through a memoised loader, or have HeldWeapons expose the loaded scene. Merge `rocket`, and optionally `grenade` and `molotov`, into one geometry with an aKind attribute. Use HeldWeapons' select trick: a per-instance aSel, with other kinds' vertices collapsed in the vertex shader. Create the material at construction as MeshLambertMaterial({vertexColors:true}) with that onBeforeCompile and a customProgramCacheKey, so the program is the same before and after load. Keep the box fallback with a white `color` attribute plus instance colour. Draw the models above life size: rocket about 1.7x (similar to the stand-in), grenade about 4x, molotov about 2x. Keep the yaw/roll maths (nose +Z already matches) and the 0.6 m tail offset. Still one draw call, only while something flies.

**Risks:** Shader warm-up: any variant change after load would compile mid-play. A duplicate weapons.glb fetch/parse if the load isn't shared. Scale tuning against the existing glow, shadow and trail sizes.

**Verify:** npm test and npm run build. Playwright (SwiftShader): __ub.startGame(), give the launcher and grenades, fire/throw, fastForward(0.1). Check renderer.info.render.calls and programs.length are unchanged versus the stand-in, and screenshot the projectile in flight at 852x393@3x.

**Also noticed:**

- blender/build_assets.py:16-33 never imports bpy, so under the pip `bpy` module characters.py:28 (`import bmesh`) and props.py:19 (`from mathutils import Matrix`) fail. It only works inside the Blender binary.
- blender/check_assets.py:15 CHAR_SLOTS lacks 'badge', although the game supports a fixed-colour `*_badge` slot (src/render/characterModel.ts:40-46). Adding the cop badge the docs invite would fail the checker.
- src/render/heldWeapons.ts:127 muzzleOf uses `out.set(0, 0, muzzle)`, so muzzle flashes and tracer starts sit at grip height. The launcher tube is 0.11 m above the grip (and SMG/shotgun barrels about 0.07 m), so flashes are slightly low.
- src/systems/projectiles.ts:79 ROCKET_HEIGHT = 1.2 is tied to the current low AimRocket tube (shoulder 1.42 - 0.32 + 0.11 ≈ 1.2). Raising the tube needs this changed too.
- blender/generators/props.py:373-375 and 441-443: the police sign's dark `police_sign_cap` and the safehouse's dark `safehouse_door_shade` sit directly over their lamps, so from overhead both lamps show as near-black squares. This is a cause beyond the awnings mentioned in BLENDER_TODO.
- src/render/worldProps.ts:146-149 hard-codes the wall-lamp halo offsets (out 0.7 / 0.4 m, y 3.4 m), and src/world/landmarkProps.ts:63 hard-codes GANTRY_MODEL_HALF = 6.25. Both duplicate GLB geometry and silently go wrong if the models change. PropModels.dims()/node() could supply them.
- The `package` pickup model is scaled separately in three places: src/render/pickupMesh.ts:61 (1.7, crates), src/game/modes/missionMode.ts:669 (1.8) and src/game/modes/packageMode.ts:105 (1.6).
- blender/generators/pickups.py:144-150: crates reuse the gun builder functions, so any held-weapon remodel also changes every crate_* pickup.
- SWAT officers on foot use cop.glb (src/systems/police.ts:596-598), and the badge slot ignores outfits, so any fixed-colour cop detail also appears on SWAT.
- ped_slim.glb is at 592/600 tris (the backpack's bevel alone costs 44 tris compared with 12 for a plain box). Any slim-body addition has to trade the bevel away.
- Pike never rides: bike riders are always created from the `player` body (src/main.ts:380-384, src/game/streetLife.ts:114), so the 'Pike coat through the seat' note can't happen today.
- Headless bpy can't render EEVEE/Workbench (missing libEGL.so.1), so `npm run assets -- --thumbs` won't work in the cloud. Cycles on the CPU does render (0.3 s for a 128 px still).

**Suggested order:** Fix the toolchain first. It is a one-line `import bpy` in build_assets.py plus a documented venv recipe. The pip bpy 5.2.3 build reproduces every committed GLB to 1 ULP in 15 s, so all the generator work below can be done and checked in the cloud. Then do the two pure-code wins that need no new art: wire the rocket projectile model, and decide on GetUp/Throw timing (the GETUP_LEAD/THROW constants alone may be enough). After that, batch the generator changes one GLB file at a time, each with its matching src/ constants and a check_assets + npm test + Playwright day/night screenshot pass: weapons.glb with the AimRocket pose (HeldWeapons muzzleY, ROCKET_HEIGHT), then the character GLBs (GetUpFast/Throw, cop badge plus the check_assets slot, slim backpack, Pike collar), then props.glb (rooftop caps so PART_COLOURS can go, lamp/signal tops, sign/door canopies and halo offsets, booth roof, 17.2 m gantry), then pigeon/debris. Skip the pickup rescale and the Pike coat split, which have no visible gain. Leave the final 'reads from 20-60 m' and heli-size calls for the iPhone pass (to-do #1).

## 4. deeek.org landing page

### hub-screenshots: Capture Curbside screenshots for the hub card and OG images (shared input for the other items) [S, cloud]

**Findings:** Neither repo has a screenshot. The only images are the PWA icons in /home/user/curbside/public/icons (icon.svg is a 100x100 top-down road with a red car; icon-192/512 and maskable-512 PNGs are made by tools/make-icons.mjs). I checked that a headless capture works here. With the dev server on port 5317 and Playwright on SwiftShader, I called __ub.look.time.set(19.2) and __ub.fastForward(4) and captured two 1200x630 shots in about a minute: the title screen (wordmark and menu over the dusk city) and a gameplay view after startGame(). Both look good. They are in (a throwaway scratch script) (og-title-1200x630.png, 752 KB; play-1200x630.png, 453 KB), and the script is shot.cjs in the same folder. ImageMagick, ffmpeg and PIL are installed for conversion. Curbside does not depend on Playwright; it is installed globally only.

**Cause:** Nothing is broken. The images were simply never made, and the hub README's to-do asks for 'a screenshot'.

**Fix:** Extend shot.cjs. Before the title capture, hide .title-modes, .title-row and .title-hints with injected CSS, which leaves the wordmark and tagline over the attract city (a cleaner OG image). Capture a 1200x630 OG image, a 16:9 card image (1280x720, exported at 960x540) and optionally a gameplay shot. Convert to JPEG/WebP at q~80 (target 100-200 KB each). Optionally commit the script as curbside tools/screenshots.mjs, importing Playwright dynamically and noting that it relies on a global install, so screenshots can be redone after the Blender art pass.

**Risks:** SwiftShader output depends on the quality tier the headless browser auto-picks, so shots may differ slightly from an iPhone. The art will change after to-do #3 (Blender pass), so the shots will need redoing.

**Verify:** Look at the images. Check 1200x630, under 300 KB for the OG image (WhatsApp/iMessage preview limits), and that the wordmark is legible at about 400 px wide (a phone share-sheet preview).

**Needs from the user:** Choose which shot represents the game: the clean title wordmark or a gameplay moment (a car chase or explosion would need scripting through __ub, e.g. heat or explode). Say whether the capture script should be committed to curbside/tools.

### hub-page: Build the deeek.org hub page: static project list with Curbside as the featured card [M, cloud]

**Findings:** /home/user/pydron-bot.github.io holds only CNAME (deeek.org), README.md and a placeholder index.html. The placeholder is one dark card linking to /curbside/ (index.html:51) with inline CSS tokens --bg #111214, --fg #f3efe2, --accent #ff3d8b and --accent-2 #2ee6ff (index.html:11-16). These have drifted from the game's tokens in /home/user/curbside/src/ui/tokens.css:15-27 (--ink #f6f1e4, --neon-pink #ff2e88, --neon-cyan #2ee6ff, --neon-yellow #ffd23f, --hud-font, --display-font). The game uses no webfonts, only system stacks, so the hub can copy them as they are. The Curbside wordmark is pure CSS (title.css:58-125: .wordmark/.wm gradient text, cyan outline, pink drip; tagline at :162) and can be reused for the card title. The site deploys with the classic branch build: the 'pages build and deployment' runs for a7a143a and 241e9e8 both succeeded (run 41134572982). That means Jekyll processes the site, and there is no .nojekyll. The account has three public repos: curbside, DMW-SelfHost (no description, not reachable from this session, Pages status unknown) and the site repo itself. Curbside's service worker lives at /curbside/sw.js, and the built manifest has scope /curbside/ (dist/manifest.webmanifest), so it cannot control the root site. Its NavigationRoute(createHandlerBoundToURL('index.html')) only covers /curbside/*. The reverse is the real risk: a root SW with a navigation fallback would answer a first visit to /curbside/ before Curbside's own SW installs, and a root manifest with scope '/' would pull /curbside/ into the hub's installed-app window. Git: origin is https://github.com/pydron-bot/pydron-bot.github.io. `git ls-remote` works, and origin/main = local HEAD 241e9e8. Both existing commits carry this session's Claude-Session trailer and are live, so pushing from this container has already worked; the repo is also in the session's allowed list. The local clone has no remote-tracking refs, so `git status -sb` shows just '## main'.

**Cause:** The page is a placeholder by design (commit a7a143a). The to-do is open in the hub README.md and in curbside docs/HANDOFF.md:81-84.

**Fix:** Write a single static index.html with inline CSS and no build step, in the README's 'plain static HTML/CSS' spirit. Copy the tokens and font stacks from tokens.css. Header: deeek.org plus a one-line intro. Featured Curbside card, two columns at 720 px and up, stacked on phones: a 16:9 <picture> (webp with jpg fallback, explicit width/height, eager load), the CSS wordmark, the tagline 'STEAL · DRIFT · CAUSE CHAOS', a one-line pitch, a big Play button to /curbside/ in the same tab (so iOS Add to Home Screen picks up Curbside's manifest), a 'phone (landscape) · keyboard · gamepad' note and a Source link to github.com/pydron-bot/curbside. Below that, a <ul> grid of further project cards, added by hand, plus a 'more soon' tile. Keep the list static rather than generated: api.github.com does allow CORS, but unauthenticated calls are limited to 60/h per IP, return no screenshots or pitches, and would list non-web repos (DMW-SelfHost, the site repo itself). If automation is wanted later, a build-time Action could generate it. Add safe-area padding, a 16 px gutter and prefers-reduced-motion handling for any wordmark animation. Do not register a service worker or link a manifest. Add .nojekyll for predictable serving, so README.md is not turned into /README.html (unconfirmed exact path). Add a 404.html using absolute asset paths, since Pages serves it for any unknown path on the domain, including /<missing-repo>/. Never create a folder named after a project repo; which one wins on a collision is unconfirmed. Update the hub README's To do section and HANDOFF #4 when done.

**Risks:** Pushing to main publishes immediately. A root-scoped SW or manifest would interfere with Curbside, so avoid both. Relative image paths in 404.html break at nested URLs, so use absolute ones. Keep total page weight small (screenshots under about 200 KB) for phones on cellular.

**Verify:** Build a Pages-like mirror in the scratch dir: copy the hub repo as the site root, then `CURBSIDE_BASE=/curbside/ npx vite build --outDir <scratch>/site/curbside --emptyOutDir` (keeps the repo's dist/ untouched), then `python3 -m http.server` on 5317. In Playwright at 390x844, 852x393, 852x340, 1280x720 and 1920x1080: no horizontal scroll (scrollWidth <= innerWidth), all images have naturalWidth > 0, no console errors, Play navigates to /curbside/ and #title appears, and navigator.serviceWorker.getRegistrations() shows only the /curbside/ scope. Open a missing path to check that 404.html renders with its assets. Take screenshots for the user to approve before pushing.

**Needs from the user:** Decide on: (1) branding for 'deeek' — a header line, any about/contact text, and whether to link the GitHub profile; (2) whether DMW-SelfHost or anything else belongs on the hub, with what blurb and link (it would need adding to this session to inspect it); (3) whether to push straight to main, which goes live within about a minute with no tests or review gate, or push a branch and open a PR for review first.

### hub-social-meta: Favicon, touch icon and Open Graph/Twitter meta for deeek.org [S, cloud]

**Findings:** The hub index.html has <title>, a description ('Projects by deeek.') and theme-color (index.html:6-8), but no <link rel=icon> (browsers will request /favicon.ico and get a 404), no apple-touch-icon, and no og:* or twitter:* tags, so shared deeek.org links show a bare preview. No deeek-branded icon exists. The only icon art is Curbside's (public/icons/icon.svg, 345 bytes), and using it would make the hub look like the game.

**Cause:** The placeholder page was minimal by design.

**Fix:** Make a small 'd' monogram favicon.svg in the hub palette (pink/cyan on #111214), plus a 180x180 apple-touch-icon.png and a 32x32 favicon.ico generated with ImageMagick from the SVG; commit them at the hub root. Add og:title, og:description, og:type=website, og:url=https://deeek.org/, og:image=https://deeek.org/og.jpg (absolute, 1200x630, from hub-screenshots; to start, the Curbside title shot works as the site image), og:image:width/height, og:image:alt, twitter:card=summary_large_image, and <link rel=canonical href=https://deeek.org/>. Keep theme-color #111214.

**Risks:** Social scrapers cache aggressively, so a wrong image sticks until re-scraped (use the Facebook/LinkedIn debuggers after deploy). We cannot run those scrapers from here.

**Verify:** In the local mirror, check every <link rel=icon> and og:image URL returns 200 with the right content-type, the image is 1200x630 and under 300 KB, and the tags are in <head>. After deploy the user pastes https://deeek.org/ into iMessage/Slack/Discord and checks the preview, since deeek.org is unreachable from this container.

**Needs from the user:** Approve the monogram, or supply a logo. Say whether the site-level OG image should be the Curbside shot or a 'deeek.org' title card.

### curbside-og-meta: Curbside: add a description and OG/Twitter meta so deeek.org/curbside/ links preview well [S, cloud]

**Findings:** /home/user/curbside/index.html:3-15 has viewport, theme-color, apple-* metas, an icon and a title, but no <meta name=description> and no og:* or twitter:* tags. Vite rewrites root-relative public paths in index.html with the base (dist/index.html shows /curbside/icons/icon.svg). A root-relative og:image would therefore become '/curbside/og.jpg', which is not the absolute URL scrapers expect (the exact Vite 8 handling of meta content is unconfirmed). Workbox precaches '**/*.{js,css,html,png,svg,glb,ktx2,json}' (vite.config.ts:46), so a .png OG image would add to every player's SW install download, while a .jpg would not.

**Cause:** Sharing was never in scope for the game page.

**Fix:** Add public/og.jpg (1200x630, from hub-screenshots). In index.html add <meta name=description> matching the manifest text (vite.config.ts:35), og:title 'Curbside', og:description, og:type=website, og:url=https://deeek.org/curbside/, og:image=https://deeek.org/curbside/og.jpg (an absolute URL; this is a metadata URL, not an asset load, so the 'use publicUrl' rule doesn't apply, and a short comment should say why), and twitter:card=summary_large_image.

**Risks:** The .jpg must stay out of the precache, and the build check below confirms it. Pushing to curbside main runs tests and deploys, and the github-pages environment may need approval in Actions.

**Verify:** Run npm test. Run `CURBSIDE_BASE=/curbside/ npx vite build --outDir <scratch>/cs-dist --emptyOutDir`, then grep the output index.html for the og tags (absolute URLs intact) and confirm sw.js's precache list has no og.jpg. Check the image is served at /curbside/og.jpg in the local mirror.

**Needs from the user:** Choose the image (shared with hub-screenshots) and the one-line pitch.

### curbside-linkback: Curbside: small 'deeek.org' link back to the hub from the title screen (and How to Play) [S, cloud]

**Findings:** The game has no outbound link (no 'deeek' or 'href' in src/ui/*.ts). The title column (src/ui/titleScreen.ts:58-66) has the wordmark, tagline, .title-modes, .title-row (Settings / How to play) and .title-best. The bottom-right corner is already taken by .title-hints and the iOS .a2hs tip (title.css:274-308). The title uses MenuNav, so keyboard and gamepad only reach elements added with nav.add() (titleScreen.ts:81-98). blockBrowserGestures (src/ui/gestures.ts:12-29) cancels touchstart only on play surfaces, not on the title overlay, so an anchor there would still get taps. The manifest is display: fullscreen with scope /curbside/ (vite.config.ts:36; dist manifest), so in the home-screen app an out-of-scope link opens in Safari's in-app view, not inside the game.

**Cause:** There was no hub to link to before this to-do.

**Fix:** In TitleScreen, add a small anchor under .title-best, e.g. 'MORE AT DEEEK.ORG' styled like .title-best (11px, --ink-dim). Point it at the absolute 'https://deeek.org/', because '/' would reload the game itself on the dev server and on hive1 where base is '/'. Register it with nav.add({ el, activate: () => location.assign(url) }) so keyboard and pad users can reach it. Optionally add the same line to the How to Play panel footer (src/ui/howToPlay.ts). Do not add it to the pause screen, where a mid-run mis-tap would end the run. Put the CSS in title.css.

**Risks:** The title column is already tight at 852x340 (the Safari toolbar case; HANDOFF lists a related Settings scroll issue), so an extra line could push items or clip. Avoid placing it where a thumb resting for PLAY could hit it.

**Verify:** Run npm test. In Playwright at 1280x720, 852x393 @3x and 852x340, take title screenshots and check the link is visible, does not overlap .title-hints or .a2hs, and does not scroll the title. Check keyboard arrows/Tab and a simulated gamepad reach it via MenuNav, and that activating it navigates (intercept the navigation).

**Needs from the user:** Say whether a way out of the game is wanted on the title at all, or only in How to Play; and choose the wording.

### pages-domain-check: Confirm the live site, HTTPS and domain settings (user-side; blocked from the cloud) [S, you]

**Findings:** From this container `curl -sSI https://deeek.org/`, https://deeek.org/curbside/ and https://www.deeek.org/ all fail with 'CONNECT tunnel failed, response 403'. The proxy status lists connect_rejected entries for deeek.org:443, pydron-bot.github.io is also refused, and plain http fails DNS. `gh api repos/.../pages` is refused by the proxy for both repos. Indirect evidence the sites are up: the latest Pages runs succeeded for curbside (run 41134549868 for 00c4d65, 21:55) and the user site (run 41134572982 for 241e9e8, 21:55). The hub README documents DNS as four A records plus a www CNAME, with no AAAA records mentioned.

**Cause:** The live checks are blocked by this session's network policy, not by a fault in the site, so the live state is unconfirmed.

**Fix:** No code change. The user checks on a real network and in the GitHub UI, as listed in needs_from_user.

**Risks:** None from us. If HTTPS is not enforced, http:// visitors stay on plain HTTP, and the service worker and PWA install need HTTPS.

**Verify:** The user's browser checks. Cross-check that the 'pages build and deployment' run for the hub commit succeeds via the GitHub MCP actions_list, which works from here.

**Needs from the user:** Load https://deeek.org/ and https://deeek.org/curbside/ on desktop and on the iPhone. In pydron-bot.github.io Settings → Pages, confirm 'DNS check successful' and that 'Enforce HTTPS' is ticked, and check www.deeek.org redirects. Recommended: verify deeek.org under the account's Settings → Pages (takeover protection). Optional: add GitHub's AAAA records at GoDaddy for IPv6. Optional: set the curbside repo's About → Website to https://deeek.org/curbside/ (its description currently reads 'Browser based City game').

**Also noticed:**

- /home/user/curbside/index.html:3-15 has no <meta name=description> and no og:* or twitter:* tags, so shared deeek.org/curbside/ links get a bare preview (covered by curbside-og-meta).
- /home/user/pydron-bot.github.io/index.html:6-16 has no favicon (browsers will 404 on /favicon.ico), and its colour tokens have drifted from /home/user/curbside/src/ui/tokens.css:15-20 (#ff3d8b vs --neon-pink #ff2e88, #f3efe2 vs --ink #f6f1e4).
- The pydron-bot.github.io repo has no .nojekyll, and the classic 'pages build and deployment' (Jekyll) publishes it, so README.md is probably also served as a rendered page (exact path unconfirmed).
- The local hub clone has no remote-tracking refs (/home/user/pydron-bot.github.io/.git/refs/remotes is missing), so `git status -sb` shows no ahead/behind. `git ls-remote` shows origin/main = 241e9e8 = local HEAD; run `git fetch origin` before starting work.
- Curbside's service worker navigation fallback (dist/sw.js: NavigationRoute(createHandlerBoundToURL('index.html')) with no denylist, from the vite.config.ts:45-48 workbox config) answers every navigation under /curbside/ with the game shell. Harmless today, but any future extra page under /curbside/ would be shadowed for returning players unless navigateFallbackDenylist is set.
- The account also has pydron-bot/DMW-SelfHost (public, no description). It is not in this session's allowed repos, so whether it has Pages or belongs on the hub is unknown.
- The proxy blocks deeek.org:443 and *.github.io, and the gh Pages API path is refused, so no live-site or HTTPS verification is possible from this container. The GitHub MCP actions_list does work and shows the last Pages deploys of both repos succeeded.
- /home/user/curbside/docs/HANDOFF.md:81-84 and the hub README 'To do' both track this item and will need updating when it ships.

**Suggested order:** Do hub-screenshots first; the images are already shown to work from here and they feed every other item. Then hub-page and hub-social-meta together as one commit to pydron-bot.github.io, checked in a local mirror that copies the GitHub Pages layout (hub at the root, Curbside built at /curbside/) before anything is pushed. Pushing that repo's main goes live at once, so get the user's OK on a screenshot or open a PR first. Then curbside-og-meta and curbside-linkback as one small curbside commit, which goes through the tests and Pages workflow. The user does pages-domain-check on a real network, since deeek.org is unreachable from this container. The whole cluster is about half a day, it is independent of the game to-dos, and the user needs to answer a few branding questions first.

## 6. Ideas not started

### police-chatter: Police radio chatter (a synthesised dispatcher plus subtitles) [M, cloud]

**Findings:** All audio is synthesised Web Audio with no audio files (README Audio; src/audio/).

- **Sirens:** SirenVoice (src/audio/loops.ts:312-401) is a saw and a square through a 1.4 kHz bandpass, with LFO pitch and doppler. It has three styles (loops.ts:314-321), and HeatPresenter.voiceSirens/sirenStyle picks one for each of the nearest 5 units (src/game/heatPresenter.ts:150-198). There is also an ambient sfx.distantSiren (src/audio/sfx.ts:990-1004).
- **Radio stations:** these are procedural music (src/audio/music/stations.ts:352). MusicPlayer.duck(depth, release) already exists (musicPlayer.ts:249-253).
- **Recipe building blocks:** Voice.osc/noise/filter/shaper (src/audio/synth.ts:164-315). Voice categories and limits are in LIMITS (src/audio/gameAudio.ts:89).
- **No speech or chatter exists.** GameAudio.onWanted only plays the star sting or the success chime (gameAudio.ts:1044-1048).
- **Hooks already on the bus (src/core/events.ts):** 'wanted' {level, prev, reason} (:100), pedDown.cop (:77), explosion.police (:33), enterVehicle.police (:81), busted, respray.
- **What the bus lacks:**
  - The 'wanted' event does not say which crime. Wanted.raised() (src/systems/wanted.ts:212-219) emits reason 'crime' only, although commit() knows the Crime (wanted.ts:128).
  - Roadblock deployment (src/systems/police.ts:765-786), the helicopter going on station or refuelling (police.ts:801-810) and losing sight (wanted.searching, read in heatPresenter.ts:107) are state only, not events.
- **Text for describing the suspect:**
  - colourName() and CAR_NAMES (src/game/modes/exports.ts:52-119, :67) can already produce 'YELLOW SPORTS'.
  - No district display names exist (src/world/districts.ts:11-14 has ids only).
- **Places text could go:** feed.notice (src/ui/scoreHud.ts:113), the wanted pop words (src/ui/wantedHud.ts:23), and the radio card (src/ui/radioToast.ts). The radio card already has a known overlap with long feed lines (HANDOFF to-do #5).

**Cause:** Not started. Nothing models dispatch. The wanted event has no crime field. Police state changes (roadblock, helicopter, lost sight) are polled state, not events.

**Fix:** The smallest version worth shipping has four parts.

1. **Dispatch logic.** A pure src/game/dispatch.ts with Vitest tests turns events and state changes into short lines, with priority and cooldowns (one transmission at a time, at least about 6 s apart, low-priority lines dropped). Examples:
   - 'ALL UNITS, SHOTS FIRED IN OLD TOWN, SUSPECT IN A YELLOW SPORTS HEADING NORTH'
   - OFFICER DOWN / STOLEN UNIT / ROADBLOCK IN PLACE / AIR ONE ON STATION / AIR ONE REFUELLING / LOST VISUAL / CODE 4, SUSPECT GONE / SUSPECT IN CUSTODY
   The car comes from colourName/CAR_NAMES ('ON FOOT' otherwise), the compass heading from velocity, and the district from a new districtAt(x, z).
2. **Event changes.** Add an optional `crime?: Crime` to the 'wanted' event (raised(prev, crime)). For roadblock, helicopter and lost sight, either poll state edges in HeatPresenter (presentation only, no new event), or add a single 'dispatch' event and its case in GameAudio's exhaustive switch (gameAudio.ts:455-521).
3. **The sound.** A recipe sfx.radioChatter(v, syllables):
   - a squelch-open noise click;
   - pseudo-speech: a pulse or saw at about 120-160 Hz through two bandpass 'formants' that step between vowel targets every 70-140 ms, gated per syllable;
   - band-limited to 300-3000 Hz, with waveshaper grit and a hiss bed;
   - a squelch tail and a roger beep.
   It gets a new 'radio' category with limit 1 and ducks the music to about 0.5. It is non-positional (it's the player's scanner).
4. **Subtitle and setting.** One subtitle line under the wanted stars, written with KeyedText so nothing allocates per frame, plus a 'Police radio' toggle in Settings.

Later extensions: positional chatter from parked units within about 25 m, and the scanner replacing the music station while driving a stolen police car.

**Risks:** - Clutter in 5-star chases, handled by rate limiting and priority.
- Subtitle collisions at 852x340 with the stars, activity card and radio card (the overlap is already a known issue).
- Node churn: about 15 nodes per transmission, freed by Voice.dispose.
- A new event must keep GameAudio's exhaustive `never` switch compiling.
- It depends on district display names (see districts-landmarks).

**Verify:** - **Vitest:** dispatch.ts (line choice per crime and state edge, cooldowns, priority, suspect description, heading words). Node cleanup in the style of tests/audioEngine.test.ts.
- **Offline render:** render the recipe with an OfflineAudioContext through window.__ub.audio to check level and band.
- **Playwright + SwiftShader:**
  - __ub.startGame(), __ub.heat.wanted.force(3) or (5), then __ub.fastForward(30) to raise a roadblock and the helicopter.
  - Assert the subtitle text and that only one transmission voice is live (audio.debug).
  - Screenshots at 1280x720, 852x393@3x and 852x340.
  - Draw calls unchanged.

**Needs from the user:** - How the dispatcher should sound: police codes ('10-31') or plain English, and how chatty.
- Confirm the synthesised babble with subtitles. The rule is no audio files; recorded or TTS voice would break it. The Web Speech API can't go through the Web Audio mix (no radio filter, and the volume sliders and silent-switch handling don't apply to it).
- Whether the babble sounds good needs the user's ears on a real device.

### districts-landmarks: More districts and landmarks (name the districts first, then one signature landmark per district) [M, you]

**Findings:** - **The districts:** five (src/world/districts.ts:11-14), styled in DISTRICT_STYLES (:49-140). districtOf (:150-161) assigns them: downtown within 3.1 blocks of the centre, then wobbly NW/NE/SE/SW quarters.
- **The order of DISTRICTS is a shader index:**
  - buildings: src/world/cityMesh.ts:128, :454-496 (uniform arrays sized by DISTRICTS.length), :529 (STYLE; industrial has its own GLSL branch);
  - ground: src/world/ground.ts:101-103 (16x16 block data texture).
  Adding a style entry mostly resizes itself, but a new look needs shader work.
- **The city is fixed:** 16x16 blocks of 64 m (src/world/city.ts:13-20), seed 1337 (src/main.ts:137). BLOCKS_PER_SIDE/HALF_EXTENT/WORLD_LIMIT appear about 86 times across 21 files, so growing the map is expensive.
- **Layout is safe to restyle:** makeBuilding consumes the same random numbers whatever the district (city.ts:130-156). Reassigning districts changes looks, not layout.
- **District names are never shown.** Mission text says 'arts quarter', 'suburbs' and 'old town' (src/systems/missionsData.ts:94, :255).
- **The radar tint doesn't match the districts.** cityMap.districtHue (src/ui/cityMap.ts:27-31) uses its own geometry: a 164 m downtown versus about 198 m, and straight borders. Building.district already exists (city.ts:33).
- **Today's landmarks are all functional:** spray bays and the station (src/world/landmarks.ts), the safehouse, docks, payphones and frenzies (src/game/modes/places.ts). They are drawn as props.glb roots in one 'landmarks' PropBatch family (src/render/worldProps.ts:73).
- **Draw-call cost of a big model:** a family draws every member model's vertices for every instance (README World, Families). A large landmark mesh should get its own family or InstancedMesh, which is one more draw call.
- **Blender is not installed in this container.** The models come from the Blender session (docs/BLENDER_TODO.md contracts).
- **The city name and district names are still open** (docs/PLAN.md section 9).

**Cause:** Not started. Districts are visual only, with no names, no gameplay identity and no sightseeing landmarks. The radar tint is a separate approximation.

**Fix:** **Phase A (S, cloud-doable; also unblocks radio chatter and gang turf):**
- DISTRICT_NAMES plus a districtAt(x, z) helper in districts.ts.
- A small area-name card ('OLD TOWN') when the player crosses into a district, debounced and kept clear of the radio and activity cards.
- Radar tint from bd.district instead of districtHue.

**Phase B (M code plus Blender):** one signature landmark per district on a chosen block, for example a downtown fountain plaza, an old-town clock tower or market, an arts-quarter theatre marquee, dock cranes with containers, and a suburban ballpark or water tower.
- Do it as a post-pass after generateCity: replace that block's buildings with the landmark footprint and leave the random sequence alone.
- Each landmark is a new props.glb root (contract added to BLENDER_TODO).
- Draw them in their own batch so they don't inflate the shared family.
- Add collision solids through landmarkProps-style solids, plus a radar icon.
- Stand-in boxes until the GLB arrives (the existing pattern).

**A 6th district** (a waterfront with water, edges and falling in) is L and should wait.

**Risks:** - **Existing saves:** hidden packages are saved by index (src/game/progressSave.ts:54-55) into a list seeded from the city (src/game/modes/packages.ts). Changing a block's contents can silently re-seat found parcels. Keep landmark blocks away from package spots, or migrate.
- **Placement conflicts:** landmark blocks must avoid payphones, frenzy spots, race courses, spray bays and mission spawns. tests/places.test.ts, landmarks.test.ts and missions.test.ts:210 catch most of this.
- **Budget:** each landmark batch is +1 draw call (+1 in the shadow pass) when in view.
- The area card adds another top-of-screen element at 852x340.

**Verify:** - **Vitest:** districtAt and names for every block, landmark placement clear of the protected spots, package positions unchanged (snapshot the 40 positions).
- **Playwright:** teleport the player across a border via __ub.player and check the area card text. Screenshot the radar to confirm the tint matches the districts.
- **Phase B:** draw calls stay within budget at 852x393 ('medium') and 1280x720 ('high'), with no shader compile after start (look debug).

**Needs from the user:** - The city name, the district display names and their tone (PLAN section 9 left them open).
- Which landmarks.
- The Blender session has to model them; Blender isn't available here.

Phase A (names, area card, radar tint) is cloud-doable on its own.

### gangs-respect: Gangs and respect (one rival gang with turf, respect saved, hostile on sight below a threshold) [L, cloud]

**Findings:** - **Gangs exist only in the story data.** The Graveyard Shift (Vex, Lil' Tuna) and Deacon Pike's Chrome Saints live in mission data (src/systems/missionsData.ts:1-8, :45-47). The last mission's outro says 'The Saints are scattering' (:286-289), so a post-story gang needs a story decision.
- **No faction concept in the crowd:**
  - PedRole is 'civilian' | 'cop' (src/systems/crowd.ts:23).
  - Temper calm/fighter/armed is rolled about 70/20/10 (crowd.ts:205-208).
  - provoke() makes fighters or armed peds hostile for 15 s; they give up at 40 m (crowd.ts:102-103, :214-232).
- **Mission runtime already does 'hostile people waiting at a spot who turn on you':** they materialise within 60 m and provoke within 18 m, with outfits and bodies (src/game/modes/missionMode.ts:38, :45, :409-440). This is the template for gang hangouts.
- **Gang colours cost no extra draw calls:** Population.addPed(agent, outfit, body) (src/game/population.ts:274) recolours through the outfit palette, and crowd bodies are already batched (src/game/bodies.ts header).
- **Gang cars are possible:** Population.takeVehicle(archetype, paint) (population.ts:301), TRAFFIC_MIX (population.ts:116).
- **The bus can't tell who was hit:** pedDown has a `cop?` flag but no faction (src/core/events.ts:67-78).
- **The save is safe to extend:** it has no respect field, but migrateSave carries unknown fields through and sanitises known ones (src/game/progressSave.ts:134-160). A `respect` record is safe to add.
- **Turf is ready-made:** districts give natural turf (src/world/districts.ts:150-161).

**Cause:** Not started. There is no faction on people, no respect state, and no turf.

**Fix:** The smallest version worth shipping has five parts.

1. **Rules.** A pure src/game/gangs.ts with tests:
   - GangDef {id, name, shirt/pants colours, turf district, car archetype and paint}.
   - Respect from -100 to 100 per gang, changed by bus events: a member knocked down by the player is -10 with that gang and +5 with its rival; their car wrecked is -15; story passes set a baseline.
   - Thresholds: below -25, armed members open fire on sight within about 18 m; above 50, members ignore you.
2. **Runtime.** A src/game/modes/gangMode.ts:
   - 4-6 seeded hangouts in the turf (alley mouths and plazas via pavement()), with 2-3 members each, materialised like mission peds.
   - Crowd bodies in gang colours.
   - PedAgent gets `gang?: string`, and pedDown gets an optional `gang` field.
3. **Save:** add `respect`.
4. **HUD:** a turf name on the district area card, and respect bars on the PROGRESS page.
5. **Later:** gang cars in turf traffic, gang jobs from a turf payphone (mission engine), drive-bys, backup when respect is high.

**Risks:** - **Crowd budget:** members count toward the crowd and the per-body instance batches.
- **Phone playability:** armed members on every corner could make a district unplayable on a phone.
- **Police overlap:** gang gunfire near police isn't a player crime today, which is good, but check that police don't target gang peds by mistake.
- **Conflicts with mission peds** in the same blocks.
- **Save field:** must be sanitised.
- **Dependency:** the district names and area card come first.

**Verify:** - **Vitest:** respect deltas and clamps, thresholds, save migration with and without `respect`.
- **Playwright:**
  - Teleport into the turf via __ub.player, fastForward(5), and count peds in gang outfits.
  - Knock one down (or set respect low through __ub.progress) and confirm members switch to fight/shoot.
  - Draw calls unchanged on 'medium' and 'high'.
- Real play to tune ranges and counts.

**Needs from the user:** - Which gangs: Saints remnants after LAST CALL, or a new crew.
- Their turf and colours.
- What respect unlocks (safe passage, shop discounts, jobs, backup).
- How violent turf should be on a phone.

Tuning hostility needs real play.

### missions-store: Missions beyond the first eight: replays, driven target cars, then a second chapter [M, cloud]

**Findings:** **The engine** (src/systems/missions.ts) is pure and tested:
- 10 step kinds (:57-74);
- actions spawnCar, spawnPed, wanted, give, board, alight (:23-37);
- fail conditions wrecked and lost (:40-45);
- an optional hour pin (:84-85).

**The data:** 8 jobs written in TypeScript (src/systems/missionsData.ts:62-335).
- Positions come from helpers kerb(), kerbside(), pavement() and besideBay(), plus the runtime docks and safehouse (:16-60).
- That is why they aren't JSON: positions depend on the city and on placements.

**Ordering:**
- MissionMode.next is the first id not in save.missions (src/game/modes/missionMode.ts:159-163).
- 4 payphones (src/game/modes/places.ts:34-39) take turns.
- After job 8 the debrief says STORY COMPLETE (missionMode.ts:273-277) and the phones never ring again. There is no replay and there are no side jobs.

**`drive` is declared but not implemented:** spawnCar's `drive?: boolean` (missions.ts:24-25) is ignored. act() (missionMode.ts:326-331) calls ProgressDirector.spawnCar (src/game/progressDirector.ts:194-202), which always parks the car (v.ai = null). Chase, tail or intercept jobs can't be authored yet.

**Save and completion:**
- save.missions holds ids (src/game/progressSave.ts:59-60), pruned to known ids at boot (progressSave.ts:181-187; progressDirector.ts:130).
- Completion counts the story as 30% × passed/defined (src/game/progressStats.ts:10, :42). Adding jobs lowers every existing save's percentage.

**Tests:**
- tests/missions.test.ts:193-195 hard-codes exactly eight jobs.
- :206-224 check that phones alternate, spawns are clear of buildings, and every tag is spawned. These generalise to new data.

**Cause:** Content stops at eight and nothing replaces it. The engine already supports more; there is just no replay or post-story path, and the declared driven-car action is missing.

**Fix:** This is the smallest version worth shipping. I read 'store of missions' as a bigger stock of jobs plus a way to replay them.

1. **Implement `drive`.** In act(), give the car a driver with createDriver + rerouteAi, as police.ts:770-772 does for roadblock cars, and keep it pinned. A pure traffic test should show it follows lanes.
2. **Replays.** Once the story is done, the phones ring with passed jobs on rotation as REPEAT JOB, at reduced pay and with no completion credit.
3. **Chapter 2.** Four new data jobs using existing step kinds plus driven cars. Optionally a 5th, downtown payphone (a PHONE_SPOTS entry). Reuse the existing story and crowd bodies so there's no new GLB and no new draw calls. Generalise the test from 'eight' to per-chapter counts, and decide how completion counts a chapter.

Later (M): a seeded 'odd jobs' generator from templates (deliver archetype X, collect N parcels, wreck a tagged moving car, tail without being seen).

Moving the definitions to JSON isn't worth it yet: it would need a position vocabulary to replace the helper calls.

**Risks:** - **Cash economy:** shop items cost $1,500-3,000, and rewards today are $500-5,000.
- **Completion %:** it shifts for existing saves.
- **Driven targets:** they must survive traffic recycling (pinned) and not get stuck. Traffic's unstick logic helps.
- **New phone spot:** it must avoid other placements (tests/places.test.ts).
- **Hour pins:** jobs like MIDNIGHT EXPRESS pin the clock and restore it on fail.

**Verify:** - **Vitest:**
  - generalised mission-data tests (count per chapter, phones alternate, spawns clear, tags spawned);
  - a driven-car test (the car advances along lanes over N steps);
  - replay selection after all ids are passed.
- **Playwright:**
  - Set __ub.progress.progress.data.missions to all 8 ids and check that progress.missions.ringing is not null.
  - Teleport the player beside the phone, step and fastForward, and assert the card and run state.
  - Check that a driven target car moves.
- Real play to tune timers.

**Needs from the user:** - Story direction for chapter 2: the antagonist after Pike, tone, and characters. The user may want to write or approve the dialogue.
- How many jobs, and the pay scale.
- Whether replays pay.
- How completion % should count new chapters.
- Confirm what 'store' meant: a stock of jobs, or a shop that sells or unlocks them (that would hang off src/game/modes/shop.ts).

### online-leaderboard: Online leaderboard (needs a small backend; decision required) [M, you]

**Findings:** **What could be ranked:**
- Chaos Run final score and medal, recorded at src/game/modes/chaosRunMode.ts:213-225, with the results card at :249-263.
- Race best times (src/game/modes/raceMode.ts:133-136).
- Both are saved locally only (progressSave best/medals/raceTimes).

**Fairness:** runs aren't comparable or reproducible today.
- The sim's rand is mulberry32(Date.now()) (src/main.ts:145).
- The Chaos Run start crossing and paint come from it (chaosRunMode.ts:91-103).
- police.ts:421 borrowCar defaults to Math.random (callers at :412 and :770 pass ctx.rand).

**Hosting:**
- The game is static on GitHub Pages (.github/workflows/pages.yml).
- deeek.org DNS is at GoDaddy (docs/HANDOFF.md:14-18).
- The PWA precaches only build files (vite.config.ts:45-46), so API calls would go to the network.
- There is no CSP.

**Cause:** Not started. A static site can't store shared scores; any client can post any number.

**Fix:** **Phase 1 (S, no backend):** a SHARE button on the Chaos Run results card and the race medal card. It uses navigator.share (iOS Safari supports it) with a clipboard fallback: 'CURBSIDE CHAOS RUN 52,310 SILVER deeek.org/curbside'. Optionally add a daily-seed Chaos Run, the same start for everyone that day, to make comparisons fair.

**Phase 2 (M):** a minimal score API plus an opt-in board.
- **Client:** a src/game/leaderboard.ts module that builds the payload {board, initials (3 letters), score, build, breakdown}, keeps an offline queue in localStorage, uses fetch with a timeout, and never blocks the card.
- **Settings:** an opt-in 'Online leaderboard' toggle, off by default.

**Backend options:**
- **A. Cloudflare Worker + D1 or KV.** Free tier ample at hobby scale. CORS can be locked to https://deeek.org. The API lives on *.workers.dev unless deeek.org DNS moves to Cloudflare (custom domains need the zone there). Needs a Cloudflare account and an API-token secret for deploys. Rate-limit by IP hashed with a daily salt, without storing it.
- **B. Supabase (Postgres + RLS + an RPC insert with checks).** Free tier, but free projects can pause when idle (check the current policy). The anon key ships in the client.
- **C. Firebase Firestore.** Security rules validate shape and range, and App Check (reCAPTCHA) slows scripts. Adds a Google project and SDK weight unless the REST API is used.
- **D. GitHub-only (friends board).** SUBMIT opens a prefilled issue, and an Action validates it and commits public/leaderboard.json. No server, but it needs a GitHub account (exposes the username), takes minutes, and each submission redeploys Pages.
- **E. Hosted leaderboard SaaS.** Least code, but brings vendor terms and a third-party privacy policy.

**Cheating, in tiers:**
1. Plausibility caps: score versus run length including bonus seconds; race time no faster than a fraction of the developer time.
2. A breakdown consistency check (the results categories must sum to the total).
3. Daily seed plus input-log replay verification on the server. This is L+ and unconfirmed: the sim isn't proven deterministic, because of the Math.random default and possible Math.sin/hypot differences between V8 and JavaScriptCore.
4. An admin delete endpoint and an initials blocklist.

**Privacy:** opt-in, initials only, no account, no stored IP. A random per-install id would let players replace their own entry but is a pseudonymous identifier. Add a short note in Settings or How to Play.

**Risks:** - **Forged scores:** unavoidable with a static client; mitigation only.
- **Abuse and moderation load.**
- **Free-tier changes, or projects pausing when idle.**
- **Offline PWA:** submissions must queue and never block play.
- **Personal data:** adding a third-party endpoint sends player data off-site and needs an opt-in.
- **Luck:** random-start runs aren't comparable without a daily seed.

**Verify:** - **Vitest:** payload building, plausibility checks, offline queue and retry, settings opt-in default off.
- **Playwright:** finish a Chaos Run quickly (__ub.fastForward past 120 s), check the SHARE button and the clipboard/share fallback text, intercept the fetch with page.route to test submit and offline queueing.
- **Backend:** its own tests (Miniflare/wrangler dev for a Worker, or Supabase local) once chosen.

**Needs from the user:** - Whether to have a global board at all, or share-only.
- If yes: the provider (Cloudflare / Supabase / Firebase / GitHub-only), with the user's account and secrets.
- Which boards (Chaos Run; a daily-seed Chaos Run; per-race times).
- The naming policy (initials versus names).
- How much cheating is acceptable.
- Whether to move deeek.org DNS to Cloudflare for an api subdomain.

Phase 1 (share) is cloud-doable once approved.

**Also noticed:**

- src/systems/missions.ts:24-25 declares spawnCar `drive?: boolean`, but src/game/modes/missionMode.ts:326-331 ignores it, and ProgressDirector.spawnCar (src/game/progressDirector.ts:194-202) always parks the car (v.ai = null). A job written with drive: true silently gets a parked car; no current job uses it.
- src/ui/cityMap.ts:27-31 tints the radar with its own district geometry (a downtown radius of 0.32 x 512 = 164 m, straight quadrant borders). The real districts (src/world/districts.ts:142-161) use 3.1 blocks (about 198 m) and wobbly borders, so radar colours are wrong near borders. Building.district (src/world/city.ts:33) could be used directly at cityMap.ts:70-72.
- After the eighth mission the payphones never ring again: MissionMode.next returns null (src/game/modes/missionMode.ts:159-163) and nothing replaces it. There is no replay and no post-story content.
- Hidden packages are saved by index (src/game/progressSave.ts:54-55) into a list seeded from the city layout (src/game/modes/packages.ts). Any change to block contents (landmark blocks, new lots) can silently move found or unfound parcels under existing saves.
- tests/missions.test.ts:193-195 hard-codes exactly eight missions, so it will fail on the first new job; generalise it to per-chapter counts.
- Completion counts the story as missions passed / missions defined (src/game/progressStats.ts:10, 42), so adding jobs lowers every existing save's completion %.
- The 'wanted' event (src/core/events.ts:100) carries no crime: Wanted.raised() (src/systems/wanted.ts:212-219) emits reason 'crime' only, although commit() knows the Crime (wanted.ts:128). Radio chatter or gang respect would need an optional `crime` field.
- Runs aren't reproducible. The sim's rand is seeded from Date.now() (src/main.ts:145), the Chaos Run start crossing comes from it (src/game/modes/chaosRunMode.ts:91-103), and police.ts:421 borrowCar defaults to Math.random (both callers, :412 and :770, pass ctx.rand today). This matters for any daily-seed or replay-verified leaderboard.
- District names are never shown anywhere in the game (DISTRICTS has ids only, src/world/districts.ts:11-14), though mission dialogue refers to 'the arts quarter', 'the suburbs' and 'the old town' (src/systems/missionsData.ts:94, 255). The city name, district names and tone are still an open decision (docs/PLAN.md section 9).
- Blender is not installed in this cloud container, so any new landmark or gang art has to come from the Blender session on hive1 (docs/BLENDER_TODO.md contracts).

**Suggested order:** Start with Phase A of districts (names, an area card, a radar tint from Building.district; S). It is cheap, fixes a real mismatch, and is a prerequisite for radio chatter lines and gang turf. Next, police radio chatter (M): it is presentation only and low risk, reuses the bus, the siren and synth building blocks, and colourName/CAR_NAMES, and makes a big difference to how chases feel. Then missions (M): implement the missing `drive` action, add replays after STORY COMPLETE, then a chapter-2 data pack once the user gives story direction. Do gangs (L) after that, because they build on districts and the mission-ped runtime and need design decisions. Batch the landmark models into the existing Blender adjustment pass (to-do #3). For the leaderboard, ship only the share button until the user picks a backend and an anti-cheat level. All of this sits behind to-do #1-#3 (real-device pass, tuning, Blender pass) in the handoff's priority order.
