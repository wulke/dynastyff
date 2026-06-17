# EARS Specs: Bot Simulator

Drives: `docs/llds/bot-simulator.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Archetype Configuration

**DFF-BOT-001** `[x]`
The system shall load archetype acceptance thresholds, pick-scoring modifiers (`needModifier`, `valueWeight`), preferred-position value floors, and trade aggressiveness probabilities from a configurable JSON file (`config/archetypes.json`) once at startup and inject that config into the bot-chain coordinator.

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
The system shall use the following default preferred-position value floors (minimum dynasty_value for a player at a preferred position to be considered available before fallback triggers), overridable via `config/archetypes.json`:
- `win_now`: 3500
- `punt`: 2500
- `rb_heavy`: 3500 (RBs only); 2000 (other positions)
- `qb_early`: 4000 (QBs only); 2000 (other positions)
- `bpa`: 2500
- `balanced`: 2500

---

## Archetype Assignment

**DFF-BOT-010** `[ ]`
When a draft is created, the system shall randomly assign one archetype to each bot team from the set: `win_now`, `punt`, `rb_heavy`, `qb_early`, `bpa`, `balanced`.

**DFF-BOT-011** `[ ]`
The system shall allow multiple bot teams to share the same archetype; no uniqueness constraint applies to archetype assignment.

---

## Pick Scoring

**DFF-BOT-020** `[ ]`
When computing a pick score for an available player, the system shall compute: `score = dynastyValue × valueWeight × (slotNeed × needModifier) × youthModifier + handcuffBonus + noise × random()`.

**DFF-BOT-021** `[ ]`
The system shall compute `slotNeed` as the sum of eligibility-weighted unfilled slots for that position, and shall step to `0.3` (saturation floor) once all eligible slots are filled.

**DFF-BOT-022** `[ ]`
The system shall apply the following `needModifier` and `valueWeight` per archetype:
- `bpa`: needModifier 0.1, valueWeight 1.0 (near-pure dynasty value sort)
- `balanced`: needModifier 1.0, valueWeight 0.8
- `win_now`: needModifier 1.3, valueWeight 0.6
- `punt`: needModifier 0.4, valueWeight 0.9
- `rb_heavy`: needModifier 1.0, valueWeight 0.7; RB slot need additionally multiplied by 1.5
- `qb_early`: needModifier 1.0, valueWeight 0.5; QB slot need additionally multiplied by 2.0 in rounds ≤ 3 only

**DFF-BOT-023** `[ ]`
The system shall define a static `SLOT_ELIGIBILITY` map that specifies which positions can fill each roster slot type:
- `QB` → `[QB]`
- `RB` → `[RB]`
- `WR` → `[WR]`
- `TE` → `[TE]`
- `FLEX` → `[RB, WR, TE]`
- `SF` → `[QB, RB, WR, TE]`
- `bench` → `[QB, RB, WR, TE]`

**DFF-BOT-024** `[ ]`
When computing `slotNeed` for a position, the system shall count all unfilled roster slots whose eligibility set includes that position, weighted by `1 / eligibilitySetSize` (fractional contribution per shared slot).

**DFF-BOT-025** `[ ]`
For the `punt` archetype, the system shall apply a `youthModifier` of `1.0 + max(0, (30 − age) / 30) × 0.4` to non-rookie players; rookies (`isRookie = true`) shall receive a flat `youthModifier` of `1.3`. All other archetypes shall use `youthModifier = 1.0`.

**DFF-BOT-026** `[ ]`
When scoring an available RB whose `nflTeam` matches the `nflTeam` of any RB already on the bot's roster, the system shall add a handcuff bonus of `0.15 × player.dynastyValue` to that player's score.

---

## Noise and Selection

**DFF-BOT-030** `[x]`
When selecting a player to draft, the system shall use weighted random sampling where each player's selection probability is proportional to their computed pick score.

**DFF-BOT-031** `[x]`
The system shall support a configurable `randomness` parameter (0.0–1.0, default 0.3) that flattens the score distribution: at 0.0 the highest-scored player is always selected; at 1.0 all available players are equally likely.

---

## Trade Initiation

**DFF-BOT-040** `[x]`
Before each bot pick, the system shall evaluate whether to initiate a trade based on the bot's archetype trade aggressiveness probability: `win_now` 25%, `punt` 35%, `rb_heavy` 20%, `qb_early` 20%, `bpa` 10%, `balanced` 15%.

**DFF-BOT-041** `[ ]`
When a bot evaluates a trade, the system shall scan all other teams' rosters and pick slots to identify the highest-value asset that fits the bot's archetype preference and does not violate its stickiness rules.

**DFF-BOT-042** `[ ]`
The system shall apply the following stickiness rules: `rb_heavy` shall not include its top-2 RBs as trade fodder; `qb_early` shall not include its starting QB as trade fodder; `win_now` shall not include proven starters (age ≥ 27, dynasty_value ≥ 4000) as trade fodder.

**DFF-BOT-043** `[ ]`
When constructing a trade offer, the system shall assemble fodder assets whose total dynasty value meets or exceeds the target asset's dynasty value multiplied by the initiating bot's archetype acceptance threshold (see DFF-BOT-002).

**DFF-BOT-044** `[ ]`
If no trade offer can be constructed that meets the value threshold, the system shall skip the trade attempt and proceed to pick selection.

---

## Trade Evaluation (Receiving Bot)

**DFF-BOT-050** `[ ]`
When a bot receives a trade offer from another bot, the system shall accept the trade if: the total dynasty value received meets or exceeds the total dynasty value sent multiplied by the receiving bot's acceptance threshold (see DFF-BOT-002), and no stickiness rule is violated for assets being sent.

**DFF-BOT-051** `[ ]`
If a trade offer violates a receiving bot's stickiness rules for any outgoing asset, the system shall decline the trade regardless of value math.

---

## Pick Fallback

**DFF-BOT-060** `[ ]`
When no available player at a bot's preferred positions has a dynasty_value at or above the bot's archetype value floor (see DFF-BOT-003), the system shall first attempt to trade the current pick slot for future pick assets before making a selection.

**DFF-BOT-061** `[ ]`
If the trade-out attempt fails (no team accepts within one evaluation pass), the system shall fill open roster slots by positional need priority before selecting BPA.

**DFF-BOT-062** `[ ]`
If all roster slots are filled and no positional needs remain, the system shall select the highest-scored available player by dynasty value with noise applied.
