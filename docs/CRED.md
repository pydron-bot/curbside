# CRED and perks — design note

A roguelite layer for free roam. You will die and get busted a lot. Each
life now also leaves you a little stronger.

## The loop

1. **A life is a run.** WASTED or BUSTED already takes your guns, your
   unbanked chain and some cash. That stays as it is.
2. **Every life earns CRED,** and only CRED survives everything. It's a
   separate currency from cash, which fines and the shop take away again.
   CRED only goes up.
3. **CRED fills levels.** Each level is one pick from three perks, made
   right there on the WASTED / BUSTED screen. The respawn waits while you
   choose.
4. **Perks are permanent, small and capped:** eight perks with four ranks
   each, so 32 picks in all.
5. **Perks are off in scored modes** (the Chaos Run and races), so bests,
   medals and any future leaderboard compare like with like.

## Numbers (2026-11-01, tune from real play)

**CRED for a life** (`credForLife`):

    points / 400 + seconds alive / 6 + cash earned / 50 + 5 × s(s+1)/2   (s = peak stars, 0..5)

"Cash earned" is jobs, fares, races and the like. Banked chains and LEVEL
UP payouts don't count: a chain's points already do, and its cash grows with
stars, so counting it too paid one chain three times. That's what took a
first playtest to level 5 in five minutes (one 52,000-point life at 5 stars
came to about 1,100 CRED).

| Life | CRED |
| --- | --- |
| A quick death (25 s, 1,200 points) | ~7 |
| A good three minutes (20,000 points, 3 stars, a $1,000 job) | ~130 |
| A wild five minutes (52,000 points, 5 stars, chains only) | ~255 |
| Reaching 5 stars, on its own | 75 |

**Level n** costs 100 + 50 × (n − 1). The first level comes after one
good life; level 5 (1,000 CRED) after four wild lives or seven or eight
good ones; maxing everything takes 28,000 CRED, roughly a hundred wild
lives. Once everything is maxed, each further level pays $500.

**Perks** (per rank, ×4 at max):

| Group | Perk | Per rank | Maxed |
| --- | --- | --- | --- |
| SURVIVE | TOUGH | +15 max health | +60 |
| SURVIVE | KEVLAR | 25 armour at the start of each life | a full vest |
| WHEELS | BODYWORK | your car takes 10% less damage | −40% |
| WHEELS | NITRO JUNKIE | nitro fills 15% faster | +60% |
| HEAT | SLIPPERY | cops take 15% longer to cuff you | +60% |
| HEAT | GHOST | stars fade 8% sooner | −32% time unseen |
| MONEY | HUSTLER | hospital bills and fines 20% less | −80% |
| MONEY | BANKER | banked chains pay 10% more | +40% |

These stack with the package perks and TOUGH SKIN from the shop. Those
reward exploring and spending, and they still apply in scored modes as
before. The perks touch other stats, so the two systems don't double up
much.

**Offers** are three different perks that aren't maxed yet, drawn with a
seed from the level number. Reloading shows the same three, so you can't
reroll by restarting.

## Is 5 stars still scary?

From `tools/tune/heat.mjs 12 [--tough] [--perks]`, 12 seeded 5-star chases
each:

| Run | Escaped | How it ended |
| --- | --- | --- |
| Normal car, no perks | 0/12 | car lost in a median 33 s |
| Normal car, every perk maxed | 0/12 | car lost in a median 45 s |
| Indestructible car, no perks | 0/12 | best was down to 4 stars |
| Indestructible car, every perk maxed | 0/12 | 2 got down to 3 stars, 1 to 2 stars |

Maxed perks buy time, not escapes. The bot drives worse than a person, so
treat this as a comparison, not a verdict.

## Where it lives

- `src/game/cred.ts`: the rules. Pure and tested (`tests/cred.test.ts`).
- `src/game/credKeeper.ts`: counts each life, awards CRED, opens LEVEL UP,
  and applies the effects every sim step.
- `src/ui/perkCard.ts`: the LEVEL UP card.
- The CRED line and level bar on the death screen: `src/ui/wastedScreen.ts`.
- The knobs on each system: `Nitro.fill`, `BustMeter.slow`,
  `Wanted.evadeScale` and `DamageState.taken` (`tests/perkHooks.test.ts`).
- The save: `save.cred` holds `{ total, picked, perks }` and is sanitised
  on load.

## Open questions

- **Pacing:** tune the CRED weights and the level curve from real play. The
  play log could record CRED per life.
- **Stars:** do they give too much? Forcing 3 stars and dying straight away
  is worth 30 CRED. In real play stars cost effort; watch for farming.
- **More perks later** (a start-of-life weapon tier, crate ammo, a faster
  carjack). Every new perk lengthens the road to maxed.
