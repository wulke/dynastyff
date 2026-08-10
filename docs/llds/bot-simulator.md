# LLD: Bot Simulator

## Context

The bot simulator drives automated pick and trade decisions for all non-user teams. It is invoked by the draft engine during the bot chain — once per bot turn. It is stateless between calls; all state it needs (rosters, available players, pick assets, archetypes) is passed in or queried from SQLite. Its output is either a pick (player_id) or a trade proposal.

Drives specs: `docs/specs/bot-simulator-specs.md`, `docs/specs/startup-pick-values-specs.md`

## Responsibilities

- Determine whether to attempt a trade or make a pick for the current bot turn
- If trading: identify the best trade partner and construct a value-positive offer per the bot's archetype
- During the bot chain, proactively target the user's team with trade offers when value and archetype fit justify it
- If picking: select a player using dynasty value as the primary driver, with positional need, position bias, youth bias, and handcuff fit acting only as a bounded tiebreaker — not something that can override a real value gap
- Evaluate incoming trade offers from other bots (accept/decline based on archetype and value threshold)
- Evaluate user counter-offers with the same dynasty-value and stickiness rules used for all incoming offers

## Bot Archetypes

Archetypes are loaded from `config/archetypes.json` once at server startup. The startup loader validates all six archetypes and injects the parsed config into the bot-chain coordinator so trade evaluation and future bot decision logic share one source of truth.

| Archetype | Pick Bias | Trade Aggressiveness | Asset Stickiness | Description |
|---|---|---|---|---|
| `win_now` | Veterans, proven starters | High — willing to give future picks | Low on future picks, high on young players | Targets established players; trades away draft capital freely |
| `punt` | Young players, high upside | High — trades current picks for future capital | Low on current picks, high on picks 2–3 years out | Rebuilding; prefers to trade out of picks for future assets |
| `rb_heavy` | RB at every opportunity | Medium | Very high on RBs — won't trade top RBs | Prioritizes RB regardless of positional value; stubbornly holds RBs |
| `qb_early` | QB in first 3 rounds | Medium | High on starting QB | Reaches for QB early; builds around elite QB in superflex |
| `bpa` | Pure dynasty value | Low | Low — value-driven trades only | Takes best available by dynasty value; trades when value gap is significant |
| `balanced` | Positional need-weighted | Medium | Moderate across all positions | Reasonable facsimile of an experienced manager |

### Archetype Config Shape

`config/archetypes.json` stores one object per archetype with these active fields:

- `randomness` — global noise factor for bot pick sampling (`0.0–1.0`, default `0.3`); jitters sampling weight by up to `± randomness × 100%` of score
- `acceptanceThreshold` — minimum `value_received / value_sent` ratio required for the archetype to accept an incoming trade
- `needModifier` — archetype need-bias band half-width (`0.0–1.0`); bounds how far need/position/youth/handcuff bias can move a player's score away from pure dynasty value (see Need Bias Band below)
- `valueWeight` — archetype multiplier applied to `dynastyValue`
- `preferredPositionValueFloors` — minimum `dynasty_value` per position for a player to enter the candidate pool; acts as a hard pre-filter before scoring (see Candidate Filtering and Selection)
- `candidatePoolThreshold` — maximum fractional score drop from the top-scored player for inclusion in the weighted-random candidate pool (`0.0–1.0`); e.g. `0.25` keeps all players scoring within 25% of the top score (see Candidate Filtering and Selection)
- `tradeAggressivenessProbability` — per-turn probability that the archetype evaluates a trade before picking

The server loads this file once, passes the parsed object into `createBotChainCoordinator`, and the coordinator forwards the config into pick-selection and trade-evaluation helpers. `createBotChainCoordinator` may also receive a direct `randomness` override for tests or future runtime tuning; that override takes precedence over the startup-loaded config value. The JSON defaults match `DFF-BOT-002`, `DFF-BOT-003`, `DFF-BOT-031`, and `DFF-BOT-040`.

### Archetype Assignment

At draft creation, each bot team is randomly assigned one archetype. No two teams are forced to have different archetypes — random assignment may produce duplicate archetypes, which is realistic.

## Pick Decision Flow

```
bot's turn
    │
    ▼
evaluate trade opportunity
    ├── trade score > threshold? → construct offer → emit to draft engine
    └── no worthwhile trade
            │
            ▼
    score available players:
    dynastyValue × valueWeight × needFactor
    (needFactor bounded to archetype's need-bias band; see Need Bias Band)
            │
            ▼
    filter candidates: floor pre-filter → score remaining → tier filter
            │
            ▼
    weighted random selection within candidate pool,
    sampling weight jittered by ± randomness × 100% of score
            │
            ▼
    return player_id
```

### Slot Eligibility Map

Each roster slot type has a fixed set of positions that can fill it:

| Slot | Eligible Positions |
|---|---|
| `QB` | QB |
| `RB` | RB |
| `WR` | WR |
| `TE` | TE |
| `FLEX` | RB, WR, TE |
| `SF` | QB, RB, WR, TE |
| `bench` | QB, RB, WR, TE |

The map is a static constant extensible for future slot types (e.g. IDP).

### Slot Need (Step Function)

For each available player, compute `slotNeed` based on eligibility-weighted unfilled slots:

1. For each unfilled slot whose eligibility set includes the player's position, add `1 / eligibilitySetSize` to a running total
2. If the total > 0: `slotNeed = total`
3. If the total = 0: `slotNeed = 0.3` (saturation floor — bench depth still has some value)

`rosterConfig` (QB/RB/WR/TE/FLEX/SF/bench counts) must be passed into the scoring function to determine total slot counts; a bot's current roster entries are diffed against these counts to determine unfilled slots. When rostered players could fit multiple slot types, assignment is greedy: fill the most restrictive eligible slots first so shared slots such as `FLEX`, `SF`, and `bench` stay open as long as possible.

### Need Bias Band (value-first, need as tiebreaker)

`slotNeed` (and the position/youth/handcuff signals below) never multiply `dynastyValue` directly — they only nudge the score within a bounded band sized per archetype by `needModifier`. This replaces the unbounded `slotNeed × needModifier` multiplier that let need overpower value and produce unrealistic positional reaches.

1. **Normalize** `slotNeed` to `0–1`: `normalizedNeed = clamp(slotNeed / NEED_NORMALIZATION_CAP, 0, 1)`, where `NEED_NORMALIZATION_CAP = 2.0` (a raw `slotNeed` of 2.0 or higher already represents "high need" and saturates).
2. **Compute archetype bias signals**, each `0–1`, only the ones relevant to the archetype/player are computed:
   - `positionBias` — `rb_heavy`: `1.0` if player is `RB`, else `0`. `qb_early`: `1.0` if player is `QB` and `round ≤ 3`, else `0`.
   - `youthBias` (`punt` only) — `1.0` for rookies; otherwise `clamp((30 − age) / 30, 0, 1)`.
   - `handcuffBias` — `1.0` if the candidate RB's `nflTeam` matches the `nflTeam` of an already-rostered RB, else `0`.
3. **Combine**: `combinedBias = max(normalizedNeed, positionBias, youthBias, handcuffBias)` (whichever signals apply to that archetype/player).
4. **Map to a bounded multiplier**: `needFactor = 1 + (combinedBias − 0.5) × 2 × needModifier`, clamped to `[1 − needModifier, 1 + needModifier]`.
5. **Score**: `score = dynastyValue × valueWeight × needFactor`.

If no bias signals apply (`combinedBias = 0`), `needFactor` resolves to `1 − needModifier`. That slight downward nudge is intentional: "no need / no fit" sits below the neutral midpoint instead of being treated as a positive signal.

`needModifier` is now a band half-width (`0.0–1.0`), not a raw multiplier:

| Archetype | `needModifier` (band) | `valueWeight` | `candidatePoolThreshold` | Bias signals folded into the band |
|---|---|---|---|---|
| `bpa` | 0.05 | 1.0 | 0.10 | needBias only — near-pure dynasty value sort |
| `balanced` | 0.25 | 0.8 | 0.25 | needBias only |
| `win_now` | 0.25 | 0.6 | 0.15 | needBias only |
| `punt` | 0.25 | 0.9 | 0.35 | needBias, youthBias |
| `rb_heavy` | 0.25 | 0.7 | 0.25 | needBias, positionBias (RB) |
| `qb_early` | 0.25 | 0.5 | 0.25 | needBias, positionBias (QB, rounds ≤ 3) |

`win_now` intentionally uses the same `0.25` band as the other non-BPA archetypes. Its contender identity comes from lower `valueWeight`, startup/trade preferences, and willingness to spend future picks, not from allowing pick-time need bias to reach farther than the shared cap.

No archetype can move a player's score by more than `± needModifier × 100%` of its pure `dynastyValue × valueWeight` baseline — a real value gap larger than that band always wins.

### Candidate Filtering and Selection

Pick selection is a three-stage pipeline: floor pre-filter → tier filter → weighted random sampling. Collapsing all available players into one full-pool lottery would dilute the score signal across hundreds of players and produce near-random pick order regardless of dynasty value; the two filters together ensure the random selection operates only over a realistic contender window.

**Stage 1 — Floor pre-filter (before scoring)**

Exclude any player whose `dynasty_value` is below the archetype's `preferredPositionValueFloors[position]`. This removes clearly below-threshold players before scoring runs.

Graceful fallback: if the floor filter would produce an empty pool, skip it and use all available players. The scoring's need-based bias will naturally guide the bot toward under-filled positions regardless.

**Stage 2 — Tier filter (after scoring)**

Score all players surviving the floor filter. Keep only those whose score is within `candidatePoolThreshold` of the top score:

```
maxScore = max(score) across all candidates
candidates = players where score >= maxScore × (1 − candidatePoolThreshold)
```

The `candidatePoolThreshold` is configured per archetype (e.g. `bpa: 0.10`, `punt: 0.35`). A tighter threshold means fewer candidates and a more deterministic pick; a wider threshold allows more upsets driven by archetype bias and randomness.

Graceful fallback: if the tier filter somehow produces an empty pool (degenerate scores), fall back to the single top-scored player.

**Stage 3 — Weighted random sampling**

From the filtered candidate pool, select via weighted random sampling:

```
weight = max(score × (1 + randomness × (random() − 0.5) × 2), 0)
```

The jitter scales with the player's own score (`±randomness × 100%`), so the `randomness` setting has a consistent effect regardless of dynasty-value scale. At `0.0` the top-scored player is always taken; at `1.0` any player in the candidate pool can occasionally jump to the top of the sample. With the tier filter applied first, only players with scores close to the best candidate's score are eligible — preserving the "occasional human misjudgment" feel without producing impossible picks.

## Trade Decision Flow

### Initiating a Trade

Before picking, a bot evaluates whether to trade. Steps:

1. **Check trade aggressiveness**: draw once with the coordinator's injected `random`; attempt trade construction only when `random() < tradeAggressivenessProbability` for the initiating bot's archetype.
2. **Build candidate targets**: for every other team, construct its tradeable asset pool using that team's archetype and roster so its protected players are excluded. The pool includes rostered players, unfilled startup pick slots, and owned future picks. Rank each asset by the initiating bot's archetype-fit score, then by raw dynasty value; the first asset is the target.
3. **Identify fodder**: construct the initiating bot's tradeable asset pool. Protected players are computed from the initiating bot's current roster before offer assembly:
   - `rb_heavy`: exclude the top-2 RBs by `dynasty_value`
   - `qb_early`: exclude the highest-value QB on roster
   - `win_now`: exclude proven starters (`age >= 27` and `dynasty_value >= 4000`)
   - non-player assets are unaffected by stickiness
4. **Construct offer**: assemble the initiating bot's movable fodder into the lowest-total package that meets `targetDynastyValue × initiatingArchetype.acceptanceThreshold`. Asset values use the common player, future-pick, and conservative startup-pick value pipeline. No protected asset may enter the package.
5. **Submit or fall back**: if no package clears the threshold, return the normal pick action. Otherwise emit a bot-to-bot `BotTradeAction` containing the package as `assetsSent`, the target as `assetsReceived`, and `isBotToBot: true`; the coordinator creates the pending trade and awaits the receiving team's one-pass evaluation before continuing the bot chain.

Target selection is deliberately global rather than user-only. The proactive bot-to-user path below remains a separate, human-decision flow: it may pause for the user and applies its own cooldown. The pre-pick bot-to-bot loop performs no counter-negotiation; a rejected offer leaves the current draft slot open and the bot proceeds to its ordinary pick selection.

#### Pre-pick Trade Loop Data Flow

```
current bot turn
    │
    ▼
random() < archetype.tradeAggressivenessProbability?
    ├── no ───────────────────────────────────────────────→ select normal pick
    └── yes
         │
         ▼
scan every other team's tradeable asset pool
    │    (receiver stickiness applied)
    ▼
choose highest-ranked archetype-fit target
    │
    ▼
assemble initiating bot's unprotected assets
    │    total ≥ target value × initiating acceptance threshold?
    ├── no ───────────────────────────────────────────────→ select normal pick
    └── yes ─→ emit pending bot-to-bot offer → receiver evaluates once
                                                    │
                                       accepted or declined
                                                    ▼
                                            resume bot chain
```

### Proactive Bot-to-User Offers

When the draft engine calls the bot simulator for a live bot turn, the proactive-offer path narrows the partner search to the user's team so the server can pause on a human decision point without introducing bot-to-bot negotiation loops.

1. **Roll for intent**: the bot only enters this path when `random() < tradeAggressivenessProbability`
2. **Apply cooldown**: if the same bot already initiated a user-targeted offer in either of the previous two rounds, skip this pass so offers do not repeat every turn
3. **Build the user's tradeable pool**: include rostered players, unresolved startup pick slots, and future picks currently owned by the user
4. **Rank desired user assets**: multiply dynasty value by an archetype-fit modifier
   - `rb_heavy`: prefer RBs
   - `qb_early`: prefer QBs
   - `punt`: prefer rookies, younger players, and future picks
   - `win_now`: prefer current-production players and startup slots over distant picks
   - `bpa` / `balanced`: stay close to pure dynasty value
5. **Build the bot's movable pool**: reuse the standard tradeable-asset builder so protected players remain unavailable, then prefer lower-fit outbound assets first
6. **Assemble a realistic offer**: choose one to three outbound assets whose total value stays below the requested side while still landing inside a minimum band, so the bot is seeking a modest edge instead of proposing an obvious non-starter
7. **Emit a user-targeted proposal**: when a rational package exists, return a trade action with `initiating_team_id = botTeamId`, `receiving_team_id = userTeamId`, and `is_bot_to_bot = false`
8. **Otherwise pick**: if no package clears the value and fit gates, continue through normal pick selection

### Counter-Offer Handling

The existing UI counter flow reuses `POST /drafts/:id/trade-offer`: it dismisses the incoming bot offer locally, flips the assets, and submits a new user-initiated proposal to the same bot.

Server-side behavior for that path:

1. Resolve the original bot-to-user offer as `declined`
2. Keep the bot chain paused
3. Evaluate the user's counter with the same acceptance-threshold and protected-asset logic used for any other incoming trade
4. Emit the new `trade_offered` / `trade_resolved` lifecycle for the counter outcome, then resume the chain only after that counter resolves

### Evaluating an Incoming Trade (bot receiving from another bot)

1. Sum dynasty value of assets received vs. assets sent
2. Apply archetype tilt: does the incoming asset fit the bot's positional preference? Does any outgoing player asset appear in the receiving bot's protected-asset set for its archetype?
3. Accept if: value received ≥ value sent × acceptance threshold AND no stickiness violation
4. Decline otherwise

### Tradeable Asset Scoring

Bots score every tradeable asset through the same dynasty-value pipeline before applying the offer/accept threshold math:

- `player`: use the player's persisted `dynasty_value`
- `future_pick`: use the joined `pick_values` round-level `dynasty_value`
- `pick_slot`: treat any unfilled startup draft slot still owned by a bot team as a tradeable asset and resolve its `dynasty_value` from a conservative startup-pick map keyed by global `pick_number`

The conservative startup-pick map starts from the draft's ETL `startupPickValues`, then applies a per-slot floor of `min(etlValue, derivedValue)` where `derivedValue = available_players[G - current_pick_number - 1]?.dynasty_value ?? 0`. If `current_pick_number` is `null` or `available_players` is empty, the bot falls back to the ETL value alone. The map-build loop is the extension point for future archetype-specific overrides.

If a `pick_slot` global pick number is missing from both the ETL and derived inputs, the bot scores that asset as `dynasty_value = 0`. Filled startup slots are not tradeable.

### Trade Fallback

If a bot attempted to initiate a trade but no suitable offer was constructed (no willing partners, no valuable fodder), it falls back to the pick decision flow.

### Pick Fallback (preferred players exhausted)

If no available QB/RB/WR/TE satisfies the current archetype's configured
`preferredPositionValueFloors` value for that position, the bot does not use
the normal floor-filter fallback. It instead performs this bounded sequence:

1. Offer the current, still-open startup pick slot to another bot for one of
   that team's future-pick assets. The receiving bot evaluates that proposal
   once using its normal acceptance threshold and stickiness rules.
2. On no proposal or a declined proposal, determine the unfilled roster slots
   using the same restrictive-slot-first assignment as pick scoring. Select
   from the available players at the highest-need open position; ties follow
   `QB`, `RB`, `WR`, `TE`. This bypasses the configured value floor because
   filling the active roster is now more important than waiting for an
   unavailable value tier.
3. If every configured roster slot is filled, select BPA from all available
   players. BPA sampling uses raw dynasty value and the configured randomness
   jitter, without archetype or roster-need modifiers.

The coordinator records that the fallback trade-out has been evaluated for a
pick number before awaiting its resolution, so a declined offer cannot restart
the fallback trade loop on the same current slot.

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Archetype storage | Startup-loaded JSON config (`config/archetypes.json`) | Database-backed profiles | Keeps archetype tuning editable without source edits while still staying local-first and deterministic at runtime |
| Noise model | Weighted random sampling, score-relative percentage jitter | Top-N random pick, Gaussian jitter, additive jitter | Probability proportional to score captures "bots mostly pick well but not always"; jitter must scale with score or it's invisible at dynasty-value magnitude (the bug that motivated this change — see #160) |
| Trade evaluation | Value math + archetype tilt | Pure value math | Archetype stickiness is what makes bots feel like real managers — an RB-heavy bot won't trade its best RB for equivalent value |
| Bot-to-bot trade resolution | Single offer, accept/decline | Multi-round counter-negotiation | Sufficient realism without an unbounded negotiation loop; trade history captures all decisions for post-draft review |
| Positional need model | Step function (1.0 need / 0.3 floor) + eligibility-weighted fractional slots, normalized and bounded into a per-archetype need-bias band | Continuous 4-step scale, binary need/no-need, unbounded multiplier (original design) | Step function is predictable and tunable; the unbounded multiplier let need overpower dynasty value and produce unrealistic reaches (#160), so it now only nudges score within a bounded band — value always wins a real gap |
| Handcuff bonus | Bias signal folded into the need-bias band (capped at the archetype's `needModifier` band width) | Flat additive +0.15 × dynastyValue (original design) | The flat additive version was itself unbounded relative to value at small `dynastyValue` deltas; folding it into the same bounded band keeps every non-value signal under one consistent cap |
| Punt youth bias | Bias signal (age-based, folded into the need-bias band) + flat rookie boost | Age-bracket cutoffs (≤24 / ≥29); standalone unbounded youthModifier multiplier (original design) | Smooth formula avoids cliff edges at age boundaries; folding it into the bounded band (rather than a separate ×1.0–1.4 multiplier) prevents it from stacking with need to override value |

## Open Questions

- [ ] Should bots ever make "irrational" trades that hurt their value, to simulate poor real-world managers? Or is sub-optimal play modeled solely through noise?
- [ ] How should a bot handle a pick slot it acquired via trade that lands at a position where it still has no preference? (e.g. `rb_heavy` traded for a late pick in a round with no RBs left)

## Full-Draft Characterization Harness

### Interface / Data Model

`createBotChainCoordinator` accepts an optional `pickDelayMs` override. When it
is omitted, each bot turn continues to use the existing randomized 3–5 second
delay. When it is `0`, the coordinator does not wait before evaluating a bot
turn. A non-negative finite override uses that fixed delay for every bot turn.

The server test fixture exports approximately 300 realistic draftable players.
Each fixture player has a stable ID, name, position (`QB`, `RB`, `WR`, or
`TE`), NFL team, age, rookie flag, and dynasty value. Its position, age, and
value distribution intentionally leaves enough viable candidates for all 240
slots in a 12-team, 20-round draft.

### Logic Flow

1. Create a 12-team, 20-round draft with no user-controlled team.
2. Seed the reusable player fixture into the test database and assign a
   deterministic mix of bot archetypes, including at least two teams for each
   compared archetype.
3. Create the bot-chain coordinator with `pickDelayMs: 0`, a seeded random
   source, and the normal archetype configuration.
4. Trigger the chain and await idle completion.
5. Query persisted picks and rosters, then characterize the completed draft:
   - `rb_heavy` teams have a higher RB roster share than `bpa` teams;
   - `punt` teams have a lower average roster age than `win_now` teams;
   - `qb_early` teams take their first QB at a lower global pick number than
     `balanced` teams;
   - `bpa` teams have the highest average dynasty value per roster slot;
   - persisted pick count equals `teamCount × rounds`.
6. Place the test in a `slow`-named suite and make the default server-test
   command exclude that suite; expose an explicit command for running it.

### Edge Case Probe

- `pickDelayMs` is omitted -> preserve the production randomized delay.
- `pickDelayMs: 0` -> no timer is scheduled, so the characterization run does
  not inherit wall-clock delay.
- Invalid negative, non-finite, or `NaN` override -> reject it at coordinator
  construction instead of silently using an unintended delay.
- Fixture is reused by another test -> IDs remain stable and the caller seeds
  only the isolated temporary database it owns.
- A statistical condition is made unstable by randomness -> use a seeded random
  source and compare archetype groups, not individual exact picks.
- Fewer than 240 fixture players are available -> the test fixture contract
  fails before draft execution rather than producing a partial draft.

### Decision

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Delay test seam | `pickDelayMs` coordinator override | Replace injected `sleep`; global timer mocking | Keeps production timing intact and makes a zero-delay full simulation declarative. |
| Fixture form | Shared typed deterministic factory | Inline 300-row SQL; live ETL data | Reusable, readable, offline, and unaffected by ETL drift. |
| Assertion style | Group-level statistical properties | Exact draft-board snapshots | Validates archetype differentiation without treating one random draft ordering as a public contract. |
| Test isolation | `slow` suite excluded by default, opt-in command | Run in all server tests; omit from CI | Preserves fast feedback while retaining a repeatable realism regression test. |
