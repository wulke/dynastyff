# EARS Specs: Bot Simulator

Drives: `docs/llds/bot-simulator.md`

Status markers: `[x]` implemented · `[ ]` gap · `[D]` deferred

---

## Archetype Configuration

**DFF-BOT-001** `[ ]`
The system shall load all archetype parameters (bias multipliers, aggressiveness probabilities, acceptance thresholds, value floors, and stickiness rules) from a configurable JSON file (`config/archetypes.json`) at startup.

**DFF-BOT-002** `[ ]`
The system shall use the following default acceptance thresholds (minimum value_received / value_sent ratio for a trade to be accepted), overridable via `config/archetypes.json`:
- `win_now`: 0.85
- `punt`: 1.15
- `rb_heavy`: 0.95
- `qb_early`: 0.95
- `bpa`: 1.05
- `balanced`: 1.00

**DFF-BOT-003** `[ ]`
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
When computing a pick score for an available player, the system shall multiply the player's dynasty_value by the positional need multiplier and by the archetype bias multiplier.

**DFF-BOT-021** `[ ]`
The system shall apply the following positional need multipliers based on the bot's current roster vs. target roster slots: 1.5× for an empty position slot, 1.2× for below-starter count, 1.0× for bench depth, and 0.6× for a saturated position.

**DFF-BOT-022** `[ ]`
The system shall apply the following default archetype bias multipliers, overridable via `config/archetypes.json`:
- `rb_heavy`: RB dynasty_value × 1.4
- `qb_early`: QB dynasty_value × 1.6 in rounds 1–4, × 1.0 in rounds 5+
- `win_now`: players age ≤ 26 × 0.85, players age ≥ 28 × 1.15
- `punt`: players age ≤ 24 × 1.2, players age ≥ 29 × 0.8
- `bpa`, `balanced`: no additional multiplier

**DFF-BOT-023** `[ ]`
The system shall treat FLEX slots as satisfiable by RB, WR, or TE when computing positional need multipliers.

**DFF-BOT-024** `[ ]`
The system shall treat Superflex slots as satisfiable by QB, RB, WR, or TE when computing positional need multipliers.

---

## Noise and Selection

**DFF-BOT-030** `[ ]`
When selecting a player to draft, the system shall use weighted random sampling where each player's selection probability is proportional to their computed pick score.

**DFF-BOT-031** `[ ]`
The system shall support a configurable `randomness` parameter (0.0–1.0, default 0.3) that flattens the score distribution: at 0.0 the highest-scored player is always selected; at 1.0 all available players are equally likely.

---

## Trade Initiation

**DFF-BOT-040** `[ ]`
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
