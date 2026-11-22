# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Budi-ren/Token-Launch-Radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/Budi-ren/Token-Launch-Radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A dashboard that ranks pre-token protocols by what their launch would be
worth, and shows how to farm each one. Built by an AI agent for make.fun's
"Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only, no network.
`main.ts` reads the sealed snapshot, writes `out/board.json` (226 rows),
`out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes
`out/dossier.json`. Open `out/dashboard/index.html` in a browser to use it.

## The model (radar-2)

Implied value is the entry's own claim, never make.fun's. It follows only
from the snapshot's figures, and no protocol name is special-cased:

```
implied = round( tvl_usd x peer_multiple
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.02 x min(chains - 1, 5)) )
```

- **Peer multiple**: for each category, the median market-cap / TVL of
  that category's live-token protocols in this same snapshot — but only
  when at least 3 such peers exist. With fewer peers the global median
  (0.214) is used instead, because a single outlier would distort the
  category. Multiples are clamped to 0.08–0.80. The median, not the mean,
  is used because a few live tokens have ratios in the hundreds.
- **Growth**: 7-day TVL change, clamped to −60%…+120%, weight 0.5.
- **Maturity**: age since first listed (unknown age = 365 days), 0.6–1.0.
- **Chains**: +2% per extra chain, up to +10% for 6+ chains.

The board covers all 40 watchlist protocols, plus every rankable
pre-token protocol below the $50M floor, by TVL (186 early rows, 226
total). Protocols at or above the floor that the watchlist leaves out are
not added: the watchlist rule screened them out as wrapped, staked or
bridged products of a token that already trades. Live-token protocols are
kept apart in a separate view with their market caps, never ranked as
launches. A protocol "records no token" in the snapshot; that is not
proof it has none.

Top of the board (snapshot 2026-11-14): Steakhouse Financial
$511,417,128 · Gauntlet $304,587,637 · Veda $292,838,688 ·
USDD $150,347,953 · Upshift $105,060,531.

## Farm plans

Every row carries a 7-step farm plan derived from that protocol's own
record (category, chains, TVL, age): a fresh wallet, the main position
with a stated capital and gas cost, one qualifying action a week, a hold
of 30–60 days, a weekly points check, claiming only from the protocol's
own published link, and a farm log. Costs and times are in each step.

## Data source

Snapshot: DefiLlama protocol index, fetched 2026-11-14
(`input/snapshot.json` in the kit), 758 protocols at or above $5M TVL,
40 on the watchlist (floor $50M). The snapshot is sealed and never
updated; the program reads it as given.

## Dashboard

Static page, no network, no framework: `dashboard/index.html`,
`app.css`, `app.js`, rendered from `data.js`. Search, category and chain
filters, sorting by implied value / TVL / growth / age / name, a
pre-token board and a live-token view, and a detail drawer for every
protocol with its implied-value breakdown, live comparables in its
category, and its farm plan.
