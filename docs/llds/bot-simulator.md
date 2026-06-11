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

Archetypes are hardcoded constants. Each archetype defines a weight profile applied to pick and trade decisions.

| Archetype | Pick Bias | Trade Aggressiveness | Asset Stickiness | Description |
|---|---|---|---|---|
| `win_now` | Veterans, proven starters | High — willing to give future picks | Low on future picks, high on young players | Targets established players; trades away draft capital freely |
| `punt` | Young players, high upside | High — trades current picks for future capital | Low on current picks, high on picks 2–3 years out | Rebuilding; prefers to trade out of picks for future assets |
| `rb_heavy` | RB at every opportunity | Medium | Very high on RBs — won't trade top RBs | Prioritizes RB regardless of positional value; stubbornly holds RBs |
| `qb_early` | QB in first 3 rounds | Medium | High on starting QB | Reaches for QB early; builds around elite QB in superflex |
| `bpa` | Pure dynasty value | Low | Low — value-driven trades only | Takes best available by dynasty value; trades when value gap is significant |
| `balanced` | Positional need-weighted | Medium | Moderate across all positions | Reasonable facsimile of an experienced manager |

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
    dynasty_value × positional_need_multiplier × archetype_bias
            │
            ▼
    apply noise: weighted random selection from top-scored players
            │
            ▼
    return player_id
```

### Positional Need Multiplier

For each available player, multiply their dynasty value by a positional need factor based on the bot's current roster vs. target roster slots:

- **Empty slot** (0 players at position): 1.5×
- **Starting depth** (below starter count): 1.2×
- **Bench depth** (starters filled, bench open): 1.0×
- **Position saturated** (all slots filled): 0.6×

FLEX and SF slots count toward RB/WR/TE and QB/RB/WR/TE respectively.

### Archetype Bias

Applied after positional need multiplier. Archetypes modify the effective score for specific player types:

- `rb_heavy`: RB score × 1.4
- `qb_early`: QB score × 1.6 in rounds 1–4, × 1.0 thereafter
- `win_now`: players age ≤ 26 score × 0.85; age ≥ 28 score × 1.15
- `punt`: players age ≤ 24 score × 1.2; age ≥ 29 score × 0.8
- `bpa` / `balanced`: no additional bias

### Noise

After scoring, the bot does not deterministically take the top player. It selects via weighted random sampling where probability is proportional to score. A global `randomness` setting (0.0–1.0, default 0.3) flattens the score distribution — at 0.0 the top player is always taken; at 1.0 all scored players are equally likely.

## Trade Decision Flow

### Initiating a Trade

Before picking, a bot evaluates whether to trade. Steps:

1. **Check trade aggressiveness**: each archetype has a base probability of attempting a trade evaluation per turn (e.g. `win_now`: 25%, `punt`: 35%, `bpa`: 10%)
2. **Identify want**: the highest-value player on any team that fits the bot's archetype bias and positional stickiness rules
3. **Identify fodder**: assets the bot is willing to move — determined by archetype stickiness (e.g. `rb_heavy` will not include top RBs in fodder)
4. **Construct offer**: assemble fodder assets that match or slightly exceed the target asset's dynasty value per the bot's archetype tilt
5. **Score the offer**: if offer value ≥ target value × archetype acceptance threshold, submit to draft engine; otherwise skip and pick

### Evaluating an Incoming Trade (bot receiving from another bot)

1. Sum dynasty value of assets received vs. assets sent
2. Apply archetype tilt: does the incoming asset fit the bot's positional preference? Does the outgoing asset violate stickiness rules?
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
| Archetype storage | Hardcoded constants | Database-backed profiles | Low-ceremony for v1; archetypes are logic not config; easy to replace with prompt-driven profiles later |
| Noise model | Weighted random sampling with flattened score distribution | Top-N random pick, Gaussian jitter | Probability proportional to score captures "bots mostly pick well but not always"; configurable randomness parameter makes variance tunable |
| Trade evaluation | Value math + archetype tilt | Pure value math | Archetype stickiness is what makes bots feel like real managers — an RB-heavy bot won't trade its best RB for equivalent value |
| Bot-to-bot trade resolution | Single offer, accept/decline | Multi-round counter-negotiation | Sufficient realism without an unbounded negotiation loop; trade history captures all decisions for post-draft review |
| Positional need multiplier | Continuous scale (0.6–1.5×) | Binary (need/no-need) | Continuous scale allows fine-grained prioritization when a team is thin at a position but not empty |

## Open Questions

- [ ] Should bots ever make "irrational" trades that hurt their value, to simulate poor real-world managers? Or is sub-optimal play modeled solely through noise?
- [ ] How should a bot handle a pick slot it acquired via trade that lands at a position where it still has no preference? (e.g. `rb_heavy` traded for a late pick in a round with no RBs left)
