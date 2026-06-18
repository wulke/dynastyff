# LLD: Bot Simulator

## Context

The bot simulator drives automated pick and trade decisions for all non-user teams. It is invoked by the draft engine during the bot chain — once per bot turn. It is stateless between calls; all state it needs (rosters, available players, pick assets, archetypes) is passed in or queried from SQLite. Its output is either a pick (player_id) or a trade proposal.

Drives specs: `docs/specs/bot-simulator-specs.md`, `docs/specs/startup-pick-values-specs.md`

## Responsibilities

- Determine whether to attempt a trade or make a pick for the current bot turn
- If trading: identify the best trade partner and construct a value-positive offer per the bot's archetype
- If picking: select a player using dynasty value × positional need multiplier × noise, prioritizing team needs and depth over blind BPA
- Evaluate incoming trade offers from other bots (accept/decline based on archetype and value threshold)

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

- `randomness` — global score-flattening factor for bot pick sampling (`0.0–1.0`, default `0.3`)
- `acceptanceThreshold` — minimum `value_received / value_sent` ratio required for the archetype to accept an incoming trade
- `needModifier` — archetype multiplier applied to `slotNeed`
- `valueWeight` — archetype multiplier applied to `dynastyValue`
- `preferredPositionValueFloors` — minimum `dynasty_value` required by position before a preferred-player fallback should trigger
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
    dynastyValue × valueWeight × (slotNeed × needModifier) × youthModifier
    + handcuffBonus + noise × random()
            │
            ▼
    apply noise: weighted random selection from top-scored players
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

### Archetype Need Modifier

Applied as a multiplier on `slotNeed`. Position-specific overrides apply on top:

| Archetype | `needModifier` | `valueWeight` | Position Override |
|---|---|---|---|
| `bpa` | 0.1 | 1.0 | — |
| `balanced` | 1.0 | 0.8 | — |
| `win_now` | 1.3 | 0.6 | — |
| `punt` | 0.4 | 0.9 | — |
| `rb_heavy` | 1.0 | 0.7 | RB slot need × 1.5 |
| `qb_early` | 1.0 | 0.5 | QB slot need × 2.0 in rounds ≤ 3 |

### Youth Modifier (punt only)

For `punt` archetype: `youthModifier = 1.0 + max(0, (30 − age) / 30) × 0.4`. Rookies (`isRookie = true`) use a flat `youthModifier = 1.3`. All other archetypes: `youthModifier = 1.0`.

### Handcuff Bonus

For RB players only: if the candidate's `nflTeam` matches the `nflTeam` of any RB already on the bot's roster, add `0.15 × player.dynastyValue` to the player's score. This is additive — it only flips a pick decision when two players are within ~15% in value.

### Noise

After scoring, the bot does not deterministically take the top player. It selects via weighted random sampling where probability is proportional to score. A global `randomness` setting (0.0–1.0, default 0.3) flattens the score distribution before sampling — at 0.0 the top player is always taken; at 1.0 all scored players are equally likely.

## Trade Decision Flow

### Initiating a Trade

Before picking, a bot evaluates whether to trade. Steps:

1. **Check trade aggressiveness**: each archetype has a base probability of attempting a trade evaluation per turn (e.g. `win_now`: 25%, `punt`: 35%, `bpa`: 10%)
2. **Identify want**: the highest-value player on any team that fits the bot's archetype bias and positional stickiness rules
3. **Identify fodder**: assets the bot is willing to move — determined by archetype stickiness. Protected players are computed from the initiating bot's current roster before offer assembly:
   - `rb_heavy`: exclude the top-2 RBs by `dynasty_value`
   - `qb_early`: exclude the highest-value QB on roster
   - `win_now`: exclude proven starters (`age >= 27` and `dynasty_value >= 4000`)
   - non-player assets are unaffected by stickiness
4. **Construct offer**: assemble fodder assets that match or slightly exceed the target asset's dynasty value per the bot's archetype tilt
5. **Score the offer**: if offer value ≥ target value × archetype acceptance threshold, submit to draft engine; otherwise skip and pick

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

If all players at preferred positions are gone:
1. Attempt to trade the current pick slot for future capital
2. If no trade partner accepts: fill open roster slots by need priority (empty positions first, then depth)
3. Final fallback: weighted random from remaining available players by dynasty value (BPA with noise)

## Decisions

| Decision | Chosen | Alternatives | Rationale |
|---|---|---|---|
| Archetype storage | Startup-loaded JSON config (`config/archetypes.json`) | Database-backed profiles | Keeps archetype tuning editable without source edits while still staying local-first and deterministic at runtime |
| Noise model | Weighted random sampling with flattened score distribution | Top-N random pick, Gaussian jitter | Probability proportional to score captures "bots mostly pick well but not always"; configurable randomness parameter makes variance tunable |
| Trade evaluation | Value math + archetype tilt | Pure value math | Archetype stickiness is what makes bots feel like real managers — an RB-heavy bot won't trade its best RB for equivalent value |
| Bot-to-bot trade resolution | Single offer, accept/decline | Multi-round counter-negotiation | Sufficient realism without an unbounded negotiation loop; trade history captures all decisions for post-draft review |
| Positional need model | Step function (1.0 need / 0.3 floor) + eligibility-weighted fractional slots | Continuous 4-step scale, binary need/no-need | Step function is predictable and tunable; noise covers close-call variance; fractional slot weighting handles FLEX/SF correctly without over-engineering |
| Handcuff bonus | Additive +0.15 × dynastyValue for same-team RBs | Multiplicative boost | Additive caps the effect — only flips picks when players are within ~15% value; multiplicative could let a worthless handcuff beat a legitimately better player |
| Punt youth bias | youthModifier formula on age + flat rookie boost | Age-bracket cutoffs (≤24 / ≥29) | Smooth formula avoids cliff edges at age boundaries; flat rookie bonus handles missing age data |

## Open Questions

- [ ] Should bots ever make "irrational" trades that hurt their value, to simulate poor real-world managers? Or is sub-optimal play modeled solely through noise?
- [ ] How should a bot handle a pick slot it acquired via trade that lands at a position where it still has no preference? (e.g. `rb_heavy` traded for a late pick in a round with no RBs left)
