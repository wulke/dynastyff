# EARS Specs: Bot Simulator

Drives: `docs/llds/bot-simulator.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Archetype Configuration

**DFF-BOT-001** `[x]`
The system shall load archetype acceptance thresholds, pick-scoring modifiers (`needModifier`, `valueWeight`), preferred-position value floors, candidate pool thresholds (`candidatePoolThreshold`), and trade aggressiveness probabilities from a configurable JSON file (`config/archetypes.json`) once at startup and inject that config into the bot-chain coordinator.

**DFF-BOT-004** `[x]`
The system shall load a global bot-pick `randomness` parameter (`0.0–1.0`, default `0.3`) from `config/archetypes.json`, and `createBotChainCoordinator` shall allow a direct `randomness` option to override that startup-loaded value.

**DFF-BOT-002** `[x]`
The system shall use the following default acceptance thresholds (minimum value_received / value_sent ratio for a trade to be accepted), overridable via `config/archetypes.json`:
- `win_now`: 0.85
- `punt`: 1.15
- `rb_heavy`: 0.95
- `qb_early`: 0.95
- `bpa`: 1.05
- `balanced`: 1.00

**DFF-BOT-003** `[x]`
The system shall use the following default preferred-position value floors (minimum `dynasty_value` per position for a player to enter the candidate pool; players below the floor are excluded before scoring), overridable via `config/archetypes.json`:
- `win_now`: 3500 (all positions)
- `punt`: 2500 (all positions)
- `rb_heavy`: 3500 (RBs); 2000 (all other positions)
- `qb_early`: 4000 (QBs); 2000 (all other positions)
- `bpa`: 2500 (all positions)
- `balanced`: 2500 (all positions)

---

## Archetype Assignment

**DFF-BOT-010** `[ ]`
When a draft is created, the system shall randomly assign one archetype to each bot team from the set: `win_now`, `punt`, `rb_heavy`, `qb_early`, `bpa`, `balanced`.

**DFF-BOT-011** `[ ]`
The system shall allow multiple bot teams to share the same archetype; no uniqueness constraint applies to archetype assignment.

---

## Pick Scoring

**DFF-BOT-020** `[x]` → #160
When computing a pick score for an available player, the system shall compute: `score = dynastyValue × valueWeight × needFactor`, where `needFactor` is a bounded multiplier derived from need, position, youth, and handcuff bias signals (see DFF-BOT-024 through DFF-BOT-027). Dynasty value shall always dominate the score; no combination of bias signals shall move `needFactor` outside the archetype's bounded band.

**DFF-BOT-021** `[x]`
The system shall compute `slotNeed` as the sum of eligibility-weighted unfilled slots for that position, and shall step to `0.3` (saturation floor) once all eligible slots are filled.

**DFF-BOT-022** `[x]` → #160
The system shall treat `needModifier` as a per-archetype need-bias band half-width (`0.0–1.0`) bounding how far `needFactor` can move from `1.0`, and shall apply the following `needModifier` and `valueWeight` per archetype:
- `bpa`: needModifier 0.05, valueWeight 1.0 (near-pure dynasty value sort)
- `balanced`: needModifier 0.25, valueWeight 0.8
- `win_now`: needModifier 0.25, valueWeight 0.6 (same band as the other non-BPA archetypes; its identity comes from lower `valueWeight` and aggressive trade behavior, not a wider pick-scoring band)
- `punt`: needModifier 0.25, valueWeight 0.9
- `rb_heavy`: needModifier 0.25, valueWeight 0.7
- `qb_early`: needModifier 0.25, valueWeight 0.5

**DFF-BOT-023** `[x]`
The system shall define a static `SLOT_ELIGIBILITY` map that specifies which positions can fill each roster slot type:
- `QB` → `[QB]`
- `RB` → `[RB]`
- `WR` → `[WR]`
- `TE` → `[TE]`
- `FLEX` → `[RB, WR, TE]`
- `SF` → `[QB, RB, WR, TE]`
- `bench` → `[QB, RB, WR, TE]`

**DFF-BOT-024** `[x]`
When computing `slotNeed` for a position, the system shall count all unfilled roster slots whose eligibility set includes that position, weighted by `1 / eligibilitySetSize` (fractional contribution per shared slot).

Requirement-ID suffixes such as `DFF-BOT-024a` are reserved for non-breaking insertions between existing IDs, so downstream references do not need to be renumbered.

**DFF-BOT-024a** `[x]` → #160
The system shall normalize `slotNeed` to a `0–1` `normalizedNeed` value via `clamp(slotNeed / 2.0, 0, 1)` before it contributes to `needFactor`.

**DFF-BOT-025** `[x]` → #160
For the `punt` archetype, the system shall compute a `youthBias` bias signal of `1.0` for rookies (`isRookie = true`) and `clamp((30 − age) / 30, 0, 1)` for non-rookies; this signal contributes to `needFactor` alongside `normalizedNeed` per DFF-BOT-027. All other archetypes shall not compute a `youthBias` signal.

**DFF-BOT-026** `[x]` → #160
For an available RB whose `nflTeam` matches the `nflTeam` of any RB already on the bot's roster, the system shall compute a `handcuffBias` signal of `1.0` (else `0`); this signal contributes to `needFactor` per DFF-BOT-027 for all archetypes.

**DFF-BOT-027** `[x]` → #160
The system shall compute a `positionBias` signal of `1.0` (else `0`) for: `rb_heavy` when the candidate is `RB`; `qb_early` when the candidate is `QB` and `round ≤ 3`. All other archetypes shall not compute a `positionBias` signal. The system shall then compute `combinedBias = max(normalizedNeed, positionBias, youthBias, handcuffBias)` over whichever signals apply to the archetype/player, and `needFactor = clamp(1 + (combinedBias − 0.5) × 2 × needModifier, 1 − needModifier, 1 + needModifier)`.

---

## Candidate Filtering and Selection

**DFF-BOT-028** `[x]` → #163
Before scoring available players, the system shall apply a floor pre-filter: exclude any player whose `dynasty_value` is below the archetype's `preferredPositionValueFloors` value for that player's position. If the floor filter would produce an empty candidate pool, the system shall skip the filter and use all available players.

**DFF-BOT-029** `[x]` → #163
After scoring the floor-filtered candidates, the system shall apply a tier filter: retain only players whose score is at or above `maxScore × (1 − candidatePoolThreshold)`, where `maxScore` is the highest score in the filtered pool and `candidatePoolThreshold` is the archetype's configured value. The system shall use the following default `candidatePoolThreshold` per archetype, overridable via `config/archetypes.json`:
- `bpa`: 0.10
- `win_now`: 0.15
- `balanced`: 0.25
- `rb_heavy`: 0.25
- `qb_early`: 0.25
- `punt`: 0.35

If the tier filter produces an empty pool (degenerate case), the system shall fall back to the single top-scored player.

---

## Noise and Selection

**DFF-BOT-030** `[x]` → #160
When selecting a player to draft, the system shall use weighted random sampling over the tier-filtered candidate pool (see DFF-BOT-028, DFF-BOT-029), where each player's sampling weight is `max(score × (1 + randomness × (random() − 0.5) × 2), 0)` — a percentage jitter of the player's own score, not an additive constant, with the final weight floored at `0` — so the configured `randomness` value has a consistent effect regardless of dynasty-value scale.

**DFF-BOT-031** `[x]` → #160
The system shall support a configurable `randomness` parameter (0.0–1.0, default 0.3): at 0.0 the highest-scored player in the candidate pool is always selected; at 1.0 sampling weight can swing by up to ±100% of score, letting any player within the candidate pool occasionally outrank the nominal top pick.

---

## Trade Initiation

**DFF-BOT-040** `[x]`
Before each bot pick, the system shall evaluate whether to initiate a trade based on the bot's archetype trade aggressiveness probability: `win_now` 25%, `punt` 35%, `rb_heavy` 20%, `qb_early` 20%, `bpa` 10%, `balanced` 15%.

**DFF-BOT-041** `[x]`
When a bot's pre-pick trade roll succeeds, the system shall scan every other team's rostered players, unfilled startup pick slots, and owned future picks; exclude assets protected by the receiving team's stickiness rules; and select the highest-ranked remaining asset using the initiating bot's archetype-fit score, with raw dynasty value as the tie-breaker.

**DFF-BOT-042** `[x]`
The system shall apply the following stickiness rules: `rb_heavy` shall not include its top-2 RBs as trade fodder; `qb_early` shall not include its starting QB as trade fodder; `win_now` shall not include proven starters (age ≥ 27, dynasty_value ≥ 4000) as trade fodder.

**DFF-BOT-043** `[x]`
When constructing a pre-pick trade offer, the system shall assemble only the initiating bot's movable, non-protected assets into a package whose total dynasty value is greater than or equal to the selected target asset's dynasty value multiplied by the initiating bot's archetype acceptance threshold (see DFF-BOT-002), using the shared player, future-pick, and startup-pick valuation pipeline.

**DFF-BOT-044** `[x]`
If a pre-pick trade roll does not succeed, no eligible target exists, or no non-protected fodder package meets the value threshold, then the system shall skip the trade attempt and proceed to normal pick selection. When a package is available, the system shall submit a bot-to-bot trade proposal and await the receiving bot's one-pass evaluation before resuming the bot chain.

**DFF-BOT-045** `[ ]` → #87
When a bot evaluates proactive trade opportunities during its turn, the system shall evaluate the user's tradeable assets by dynasty value and archetype fit before defaulting to a pick.

**DFF-BOT-046** `[ ]` → #87
When a proactive bot-to-user offer clears the bot's value-gain threshold, the system shall emit a `trade_offered` proposal with `is_bot_to_bot: false` and pause the bot chain until the trade resolves.

**DFF-BOT-047** `[ ]` → #87
When the user counters a pending bot-to-user offer, the targeted bot shall evaluate that counter with the same acceptance-threshold and stickiness rules used for any incoming trade and shall accept or decline accordingly.

**DFF-BOT-048** `[ ]` → #87
The system shall suppress repeat proactive bot-to-user offers from the same bot within a short cooldown window so bots do not propose trades every turn.

---

## Trade Evaluation (Receiving Bot)

**DFF-BOT-050** `[x]`
When a bot receives a trade offer from another bot, the system shall accept the trade if: the total dynasty value received meets or exceeds the total dynasty value sent multiplied by the receiving bot's acceptance threshold (see DFF-BOT-002), and no stickiness rule is violated for assets being sent.

**DFF-BOT-051** `[x]`
If a trade offer violates a receiving bot's stickiness rules for any outgoing asset, the system shall decline the trade regardless of value math.

---

## Pick Fallback

**DFF-BOT-060** `[x]` → #146
When no available QB/RB/WR/TE player has a dynasty_value at or above the bot's archetype-configured value floor for that player's position (see DFF-BOT-003), the system shall first attempt once to trade the current open pick slot for a future pick asset before making a selection.

**DFF-BOT-061** `[x]` → #146
If the trade-out attempt has no proposal or fails (no team accepts within one evaluation pass), the system shall fill open roster slots by positional need priority before selecting BPA, using restrictive-slot-first assignment and `QB`, `RB`, `WR`, `TE` as the tie order.

**DFF-BOT-062** `[x]` → #146
If all roster slots are filled and no positional needs remain, the system shall select an available player by raw dynasty value with configured noise applied, without archetype or roster-need modifiers.

---

## Full-Draft Characterization

**DFF-BOT-063** `[ ]` → #147
When `createBotChainCoordinator` receives a non-negative finite `pickDelayMs` override, the system shall use that fixed delay for each bot turn; when the override is `0`, the system shall not wait before processing a bot turn; when it is omitted, the system shall retain the randomized 3–5 second production delay.

**DFF-BOT-064** `[ ]` → #147
When the isolated slow full-draft characterization test runs a seeded 12-team, 20-round draft with only bot teams, a reusable realistic player fixture, and `pickDelayMs: 0`, the system shall complete all 240 picks in under five seconds and verify that `rb_heavy` teams have a higher RB roster share than `bpa` teams, `punt` teams have a lower average roster age than `win_now` teams, `qb_early` teams take their first QB earlier than `balanced` teams, and `bpa` teams have the highest average dynasty value per roster slot.
